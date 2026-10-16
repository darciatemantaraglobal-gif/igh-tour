/**
 * Shared storage helpers untuk per-package calculation rows (hotels,
 * transports, visas, dst). Pola write-through:
 *   - localStorage = cache instan (sync read, gak perlu round-trip ke cloud)
 *   - cloud (Supabase `package_calculations` table) = source of truth lintas-device
 *
 * Dipake bareng oleh:
 *   - `Calculator.tsx`        → write saat user "Create Paket Trip" (createPackage flow)
 *   - `PackageDetail.tsx`     → read saat halaman rincian paket di-load,
 *                               write saat user edit rows langsung di sana
 *
 * Tujuan: data baris kalkulator yg user input di Kalkulator otomatis kebawa
 * ke /packages/[id] tanpa input ulang, dan tetap muncul instan saat refresh
 * (dari localStorage) sambil background-sync dari cloud.
 */
import { useSyncExternalStore } from "react";
import { pushPackageCalc } from "./cloudSync";
import { isSupabaseConfigured } from "./supabase";
import { useAuthStore } from "@/store/authStore";

/** localStorage key — versioned biar kalau struktur breaking change bisa
 *  bump versi tanpa nge-corrupt cache lama. Dipertahankan dari implementasi
 *  awal di PackageDetail.tsx supaya cache user existing tetap kebaca. */
export const PACKAGE_CALC_STORAGE_KEY = "travelhub.package.calculations.v1";

function getScopedKey(): string {
  try {
    const agencyId = useAuthStore.getState().agency?.id;
    return agencyId ? `${PACKAGE_CALC_STORAGE_KEY}:${agencyId}` : PACKAGE_CALC_STORAGE_KEY;
  } catch {
    return PACKAGE_CALC_STORAGE_KEY;
  }
}

/** Baca seluruh map `{ [packageId]: payload }` dari localStorage.
 *  Return {} kalau parse error atau format invalid (object check). */
export function readPackageCalcStore(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const key = getScopedKey();
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(
        "[packageCalc] localStorage payload bukan object — di-reset:",
        parsed,
      );
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    console.warn("[packageCalc] gagal parse localStorage:", err);
    return {};
  }
}

/** Baca payload mentah utk satu packageId. Return `null` kalau belum ada
 *  entry — caller bertanggung jawab utk validasi shape & merge dgn default. */
export function loadPackageCalcRaw(packageId: string): unknown | null {
  const stored = readPackageCalcStore()[packageId];
  return stored === undefined ? null : stored;
}

/** Write hanya ke localStorage (no cloud push). Dipakai internal & utk
 *  bulk operations yg gak perlu langsung sync. */
export function savePackageCalcLocal(packageId: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const key = getScopedKey();
    const all = readPackageCalcStore();
    all[packageId] = value;
    localStorage.setItem(key, JSON.stringify(all));
  } catch (err) {
    if (err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22)) {
      console.warn("[packageCalc] localStorage quota terlampaui. Data disimpan di cloud.");
    } else {
      console.warn("[packageCalc] gagal save ke localStorage:", err);
    }
  }
}

/** Write-through: localStorage (instan) + cloud push (best-effort,
 *  fire-and-forget). Cloud failure di-log tapi gak nge-throw — UX tetap
 *  smooth, data udah aman di cache lokal.
 *
 *  Side-effect: update `PackageCalcSyncStatus` per packageId selama proses
 *  push. UI komponen yang subscribe via `usePackageCalcSyncStatus(id)`
 *  bakal re-render otomatis (idle → syncing → synced/local-only). */
export function savePackageCalc(packageId: string, value: unknown): Promise<boolean> {
  savePackageCalcLocal(packageId, value);
  // Supabase belum siap (env var kosong / user belum login) → cuma local cache.
  // Tetap dianggep sukses dari sisi UX, tapi badge di-set "local-only".
  if (!isSupabaseConfigured()) {
    setPackageCalcSyncStatus(packageId, "local-only");
    return Promise.resolve(false);
  }
  setPackageCalcSyncStatus(packageId, "syncing");
  // Resolve true = sampai cloud, false = cuma local. Caller boleh abaikan
  // (fire-and-forget) atau pakai buat kasih tau user kalau cloud gagal.
  return pushPackageCalc(packageId, value)
    .then(() => {
      setPackageCalcSyncStatus(packageId, "synced");
      return true;
    })
    .catch((err) => {
      console.warn(
        `[packageCalc] cloud push gagal utk packageId=${packageId}:`,
        err,
      );
      setPackageCalcSyncStatus(packageId, "local-only");
      return false;
    });
}

// ── Sync Status Store ──────────────────────────────────────────────────────
// In-memory pub/sub buat track status sinkronisasi cloud per packageId.
// Dipake utk render badge "Tersinkron / Local saja / Menyinkronkan…" di UI
// tanpa harus polling atau buka DevTools. Re-render via `useSyncExternalStore`.

/** Status sinkronisasi terakhir utk satu packageId.
 *  - `idle`        → belum ada save/pull aktivitas (initial state, abu-abu)
 *  - `syncing`     → push ke cloud lagi in-flight (amber, animated)
 *  - `synced`      → save terakhir berhasil sampe cloud (hijau)
 *  - `local-only`  → save terakhir cuma ke localStorage (Supabase off /
 *                    push gagal — abu-abu tua, butuh perhatian) */
export type PackageCalcSyncStatus = "idle" | "syncing" | "synced" | "local-only";

const statusByPackage = new Map<string, PackageCalcSyncStatus>();
const statusListeners = new Set<() => void>();

export function setPackageCalcSyncStatus(
  packageId: string,
  status: PackageCalcSyncStatus,
): void {
  statusByPackage.set(packageId, status);
  for (const l of statusListeners) l();
}

export function getPackageCalcSyncStatus(
  packageId: string | undefined,
): PackageCalcSyncStatus {
  if (!packageId) return "idle";
  return statusByPackage.get(packageId) ?? "idle";
}

function subscribePackageCalcSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** React hook utk subscribe status sinkronisasi cloud satu packageId.
 *  Re-render otomatis tiap kali `setPackageCalcSyncStatus(packageId, …)`
 *  dipanggil (dari savePackageCalc atau caller external seperti
 *  PackageDetail pull effect). SSR-safe (return "idle" di server snapshot). */
export function usePackageCalcSyncStatus(
  packageId: string | undefined,
): PackageCalcSyncStatus {
  return useSyncExternalStore(
    subscribePackageCalcSyncStatus,
    () => getPackageCalcSyncStatus(packageId),
    () => "idle",
  );
}
