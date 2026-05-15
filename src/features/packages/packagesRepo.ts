import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { requireAgencyId, getCurrentAgencyId } from "@/store/authStore";
import { makePersistedCache } from "@/lib/persistedCache";

export type PackageStatus = "Draft" | "Calculated" | "Confirmed" | "Paid" | "Completed";
export type HotelLevel = "Bintang 3" | "Bintang 4" | "Bintang 5";

export interface Package {
  id: string;
  name: string;
  destination: string;
  people: number;
  days: number;
  hpp: number;
  totalIDR: number;
  status: PackageStatus;
  emoji: string;
  coverImage?: string;
  departureDate?: string;
  returnDate?: string;
  airline?: string;
  hotelLevel?: HotelLevel;
  notes?: string;
  facilities?: string[];
  createdAt: string;
  updatedAt: string;
}

export type PackageDraft = Omit<Package, "id" | "createdAt" | "updatedAt">;

/**
 * Kolom yang di-fetch untuk list & detail view — exclude `agency_id` dan field
 * internal DB yang tidak dibutuhkan di klien.
 */
const PACKAGES_COLS = [
  "id", "name", "destination", "people", "days", "hpp", "total_idr",
  "status", "emoji", "cover_image", "departure_date", "return_date",
  "airline", "hotel_level", "notes", "facilities", "created_at", "updated_at",
].join(",");

// Source of truth = Supabase. Tapi kita tetap simpan write-through cache di
// localStorage per-agency, supaya:
//   1) Refresh page = data tetap muncul instant (gak nunggu round-trip Supabase).
//   2) Kalau Supabase error/offline/RLS-blocked → user tetap lihat data terakhir
//      yg sukses, bukan list kosong yg keliatan kayak "data hilang".
export const PACKAGES_KEY = "packages";
const persistedCache = makePersistedCache<Package>("packages");

let _cache: Package[] | null = null;
function loadStore(): Package[] {
  if (_cache === null) {
    // Lazy-init dari localStorage saat pertama kali dipanggil per-page-load.
    _cache = persistedCache.read(getCurrentAgencyId());
  }
  return _cache.slice();
}
function saveStore(items: Package[]) {
  _cache = items.slice();
  persistedCache.write(getCurrentAgencyId(), _cache);
}

const fromRow = (r: Record<string, unknown>): Package => ({
  id: String(r.id),
  name: String(r.name ?? ""),
  destination: String(r.destination ?? ""),
  people: Number(r.people ?? 1),
  days: Number(r.days ?? 1),
  hpp: Number(r.hpp ?? 0),
  totalIDR: Number(r.total_idr ?? 0),
  status: (r.status as PackageStatus) ?? "Draft",
  emoji: String(r.emoji ?? "📦"),
  coverImage: (r.cover_image as string) ?? undefined,
  departureDate: (r.departure_date as string) ?? undefined,
  returnDate: (r.return_date as string) ?? undefined,
  airline: (r.airline as string) ?? undefined,
  hotelLevel: (r.hotel_level as HotelLevel) ?? undefined,
  notes: (r.notes as string) ?? undefined,
  facilities: (r.facilities as string[]) ?? undefined,
  createdAt: String(r.created_at ?? new Date().toISOString()),
  updatedAt: String(r.updated_at ?? new Date().toISOString()),
});
const toRow = (p: Package, agencyId?: string) => ({
  id: p.id, name: p.name, destination: p.destination,
  people: p.people, days: p.days, hpp: p.hpp, total_idr: p.totalIDR,
  status: p.status, emoji: p.emoji, cover_image: p.coverImage ?? null,
  departure_date: p.departureDate ?? null, return_date: p.returnDate ?? null, airline: p.airline ?? null,
  hotel_level: p.hotelLevel ?? null, notes: p.notes ?? null,
  facilities: p.facilities ?? null,
  created_at: p.createdAt, updated_at: p.updatedAt,
  ...(agencyId ? { agency_id: agencyId } : {}),
});

export async function listPackages(): Promise<Package[]> {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase!.from("packages").select(PACKAGES_COLS).order("created_at", { ascending: false });
      if (error) throw error;
      const items = (data ?? []).map(fromRow);
      saveStore(items);
      return items;
    } catch (err) {
      // Supabase gagal (network/RLS/timeout/dll). Jangan return [] kosong —
      // fallback ke cache lokal supaya user tetap lihat data terakhir.
      const cached = loadStore();
      console.warn(
        `[packages] list dari Supabase gagal, pakai cache lokal (${cached.length} item):`,
        err,
      );
      return cached;
    }
  }
  return loadStore();
}

export async function getPackage(id: string): Promise<Package | null> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase!.from("packages").select(PACKAGES_COLS).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? fromRow(data) : null;
  }
  return loadStore().find((p) => p.id === id) ?? null;
}

/** Wrap Supabase PostgrestError (plain object) into a proper Error so that
 *  `catch` blocks can reliably use `err instanceof Error` and `.message`. */
function sbErr(error: { message?: string; details?: string; hint?: string; code?: string }): Error {
  const parts = [error.message, error.details, error.hint].filter(Boolean);
  const msg = parts.join(" — ") || "Supabase error (no message)";
  return Object.assign(new Error(msg), { supabaseCode: error.code });
}

export async function createPackage(draft: PackageDraft, preId?: string): Promise<Package> {
  const now = new Date().toISOString();
  const pkg: Package = { ...draft, id: preId ?? `p-${Date.now()}`, createdAt: now, updatedAt: now };
  if (isSupabaseConfigured()) {
    const agencyId = requireAgencyId();
    const { error } = await supabase!.from("packages").insert(toRow(pkg, agencyId));
    if (error) throw sbErr(error);
  }
  saveStore([pkg, ...loadStore()]);
  return pkg;
}

export async function updatePackage(id: string, patch: Partial<PackageDraft>): Promise<Package> {
  const items = loadStore();
  const idx = items.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Package ${id} not found`);
  const updated: Package = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
  items[idx] = updated;
  if (isSupabaseConfigured()) {
    const { error } = await supabase!.from("packages").update(toRow(updated)).eq("id", id);
    if (error) throw sbErr(error);
  }
  saveStore(items);
  return updated;
}

export async function deletePackage(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    // ⚠️ Penting: chain `.select('id')` setelah `.delete()` supaya kita dapat
    // balikan baris yg ke-delete. Tanpa ini, kalau RLS policy nge-blok DELETE,
    // Supabase NGGAK ngelempar error — cuma return 0 rows. Akibatnya cache
    // dibersihin di klien, tapi row di DB masih ada → muncul lagi pas refresh.
    const { data, error } = await supabase!
      .from("packages")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      console.error(`[packages] DELETE id=${id} gagal:`, error);
      throw sbErr(error);
    }
    if (!data || data.length === 0) {
      const msg =
        `Hapus paket gagal — server tidak menghapus baris (kemungkinan ` +
        `RLS DELETE policy nge-blok). Cek policy "packages_delete" di Supabase.`;
      console.error(`[packages] DELETE id=${id} silently blocked:`, { data });
      throw new Error(msg);
    }
  }
  // Hanya bersihin cache lokal SETELAH server konfirmasi delete sukses.
  saveStore(loadStore().filter((p) => p.id !== id));
}

export async function bulkUpsertPackages(items: Package[]) {
  if (!isSupabaseConfigured() || items.length === 0) return;
  const agencyId = requireAgencyId();
  const { error } = await supabase!.from("packages").upsert(items.map((p) => toRow(p, agencyId)));
  if (error) throw error;
}
