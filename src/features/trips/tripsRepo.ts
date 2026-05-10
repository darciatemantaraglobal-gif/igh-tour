import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  uploadJamaahPhoto,
  uploadJamaahPhotoWithPath,
  uploadJamaahDoc,
  removeJamaahPhotos,
  isDataUrl,
} from "@/lib/supabaseStorage";
import { requireAgencyId, getCurrentAgencyId } from "@/store/authStore";
import { makePersistedCache } from "@/lib/persistedCache";

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  emoji: string;
  coverImage?: string;
  quotaPax?: number;
  pricePerPax?: number;
  createdAt: string;
}

/**
 * Status pembayaran jamaah — di-enforce via CHECK constraint di Postgres
 * (lihat migration `2026_04_25_jamaah_payment_status.sql`). Kalau nambah
 * value baru di sini, JANGAN lupa update CHECK constraint juga.
 */
export type PaymentStatus = "Belum Lunas" | "DP" | "Lunas";

export interface Jamaah {
  id: string;
  tripId: string;
  name: string;
  phone: string;
  birthDate: string;
  passportNumber: string;
  /** ISO date YYYY-MM-DD — passport expiry (from MRZ field 2 cols 21-27) */
  passportExpiry?: string;
  gender: "L" | "P" | "";
  photoDataUrl?: string;
  needsReview?: boolean;
  bookingCode?: string;
  paymentStatus?: PaymentStatus;
  createdAt: string;
}

export function generateBookingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "IGH-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export type DocCategory = "passport" | "visa" | "ticket" | "medical" | "other";

export interface JamaahDoc {
  id: string;
  jamaahId: string;
  category: DocCategory;
  label: string;
  fileName: string;
  fileType: "image" | "pdf";
  dataUrl: string;
  createdAt: string;
}

// Source of truth = Supabase. Tapi kita maintain write-through cache di
// localStorage per-agency — supaya data nggak "hilang" pas refresh kalau
// Supabase lagi error/offline/RLS-blocked, dan supaya UI bisa render instant
// tanpa nunggu round-trip cloud setiap reload.
export const TRIPS_KEY = "trips";
export const JAMAAH_KEY = "jamaah";
export const DOCS_KEY = "docs";

const tripsCache = makePersistedCache<Trip>("trips");
const jamaahCache = makePersistedCache<Jamaah>("jamaah");
const docsCache = makePersistedCache<JamaahDoc>("jamaah_docs");

function cacheFor(key: string): { read: () => unknown[]; write: (items: unknown[]) => void } {
  const agencyId = getCurrentAgencyId();
  if (key === TRIPS_KEY)
    return {
      read: () => tripsCache.read(agencyId),
      write: (items) => tripsCache.write(agencyId, items as Trip[]),
    };
  if (key === JAMAAH_KEY)
    return {
      read: () => jamaahCache.read(agencyId),
      write: (items) => jamaahCache.write(agencyId, items as Jamaah[]),
    };
  if (key === DOCS_KEY)
    return {
      read: () => docsCache.read(agencyId),
      write: (items) => docsCache.write(agencyId, items as JamaahDoc[]),
    };
  // Fallback (gak akan kepake — semua key di atas sudah di-handle).
  return { read: () => [], write: () => {} };
}

// Lazy in-memory mirror — first read hydrates dari localStorage.
const _mem: Record<string, unknown[] | undefined> = {};
function load<T>(key: string, def: T[]): T[] {
  if (_mem[key] === undefined) _mem[key] = cacheFor(key).read();
  return ((_mem[key] as T[] | undefined) ?? def).slice() as T[];
}
function save<T>(key: string, data: T[]) {
  _mem[key] = data.slice();
  cacheFor(key).write(data);
}

// ── Mappers (snake_case ↔ camelCase) ────────────────────────────────────────

const tripFromRow = (r: Record<string, unknown>): Trip => ({
  id: String(r.id),
  name: String(r.name ?? ""),
  destination: String(r.destination ?? ""),
  startDate: String(r.start_date ?? ""),
  endDate: String(r.end_date ?? ""),
  emoji: String(r.emoji ?? "✈️"),
  coverImage: (r.cover_image as string) ?? undefined,
  quotaPax: r.quota_pax == null ? undefined : Number(r.quota_pax),
  pricePerPax: r.price_per_pax == null ? undefined : Number(r.price_per_pax),
  createdAt: String(r.created_at ?? new Date().toISOString()),
});
const tripToRow = (t: Trip, agencyId?: string) => ({
  id: t.id, name: t.name, destination: t.destination,
  start_date: t.startDate, end_date: t.endDate, emoji: t.emoji,
  cover_image: t.coverImage ?? null,
  quota_pax: t.quotaPax ?? null,
  price_per_pax: t.pricePerPax ?? null,
  created_at: t.createdAt,
  ...(agencyId ? { agency_id: agencyId } : {}),
});

/** Coerce nilai apapun ke PaymentStatus yang valid; fallback "Belum Lunas". */
function coercePaymentStatus(v: unknown): PaymentStatus {
  return v === "Lunas" || v === "DP" ? v : "Belum Lunas";
}

const jamaahFromRow = (r: Record<string, unknown>): Jamaah => ({
  id: String(r.id),
  tripId: String(r.trip_id),
  name: String(r.name ?? ""),
  phone: String(r.phone ?? ""),
  birthDate: String(r.birth_date ?? ""),
  passportNumber: String(r.passport_number ?? ""),
  passportExpiry: (r.passport_expiry as string) ?? undefined,
  gender: ((r.gender as string) ?? "") as "L" | "P" | "",
  photoDataUrl: (r.photo_data_url as string) ?? undefined,
  needsReview: Boolean(r.needs_review),
  bookingCode: (r.booking_code as string) ?? undefined,
  paymentStatus: coercePaymentStatus(r.payment_status),
  createdAt: String(r.created_at ?? new Date().toISOString()),
});
const jamaahToRow = (j: Jamaah, agencyId?: string) => ({
  id: j.id, trip_id: j.tripId, name: j.name, phone: j.phone,
  birth_date: j.birthDate, passport_number: j.passportNumber, gender: j.gender,
  passport_expiry: j.passportExpiry ?? null,
  photo_data_url: j.photoDataUrl ?? null,
  needs_review: !!j.needsReview,
  booking_code: j.bookingCode ?? null,
  payment_status: j.paymentStatus ?? "Belum Lunas",
  created_at: j.createdAt,
  ...(agencyId ? { agency_id: agencyId } : {}),
});

const docFromRow = (r: Record<string, unknown>): JamaahDoc => ({
  id: String(r.id),
  jamaahId: String(r.jamaah_id),
  category: (r.category as DocCategory) ?? "other",
  label: String(r.label ?? ""),
  fileName: String(r.file_name ?? ""),
  fileType: (r.file_type as "image" | "pdf") ?? "image",
  dataUrl: String(r.data_url ?? ""),
  createdAt: String(r.created_at ?? new Date().toISOString()),
});
const docToRow = (d: JamaahDoc, agencyId?: string) => ({
  id: d.id, jamaah_id: d.jamaahId, category: d.category, label: d.label,
  file_name: d.fileName, file_type: d.fileType, data_url: d.dataUrl,
  created_at: d.createdAt,
  ...(agencyId ? { agency_id: agencyId } : {}),
});

// ── TRIPS ───────────────────────────────────────────────────────────────────

export async function listTrips(): Promise<Trip[]> {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase!.from("trips").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      const trips = (data ?? []).map(tripFromRow);
      save(TRIPS_KEY, trips);
      return trips;
    } catch (err) {
      // Supabase gagal — fallback ke cache lokal supaya UI gak kosong.
      const cached = load<Trip>(TRIPS_KEY, []);
      console.warn(
        `[trips] list dari Supabase gagal, pakai cache lokal (${cached.length} item):`,
        err,
      );
      return cached;
    }
  }
  return load<Trip>(TRIPS_KEY, []);
}

export async function createTrip(draft: Omit<Trip, "id" | "createdAt">): Promise<Trip> {
  const t: Trip = { ...draft, id: `t-${Date.now()}`, createdAt: new Date().toISOString() };
  if (isSupabaseConfigured()) {
    const agencyId = requireAgencyId();
    const { error } = await supabase!.from("trips").insert(tripToRow(t, agencyId));
    if (error) throw error;
  }
  save(TRIPS_KEY, [t, ...load<Trip>(TRIPS_KEY, [])]);
  return t;
}

export async function updateTrip(id: string, patch: Partial<Trip>): Promise<Trip> {
  const trips = load<Trip>(TRIPS_KEY, []);
  const idx = trips.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error("Trip not found");
  const updated = { ...trips[idx], ...patch };
  trips[idx] = updated;
  if (isSupabaseConfigured()) {
    const { error } = await supabase!.from("trips").update(tripToRow(updated)).eq("id", id);
    if (error) throw error;
  }
  save(TRIPS_KEY, trips);
  return updated;
}

export async function deleteTrip(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    // Lihat catatan di deletePackage: tanpa `.select()`, RLS-blocked DELETE
    // gak ngelempar error — kita harus verifikasi rows yg ke-delete.
    const { data, error } = await supabase!
      .from("trips")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      console.error(`[trips] DELETE id=${id} gagal:`, error);
      throw error;
    }
    if (!data || data.length === 0) {
      const msg =
        `Hapus trip gagal — server tidak menghapus baris (kemungkinan ` +
        `RLS DELETE policy nge-blok). Cek policy "trips_delete" di Supabase.`;
      console.error(`[trips] DELETE id=${id} silently blocked:`, { data });
      throw new Error(msg);
    }
  }
  // Server (or local-only mode) confirmed → bersihin cache lokal.
  const deletedJamaahIds = new Set(
    load<Jamaah>(JAMAAH_KEY, []).filter((j) => j.tripId === id).map((j) => j.id),
  );
  save(TRIPS_KEY, load<Trip>(TRIPS_KEY, []).filter((t) => t.id !== id));
  save(JAMAAH_KEY, load<Jamaah>(JAMAAH_KEY, []).filter((j) => j.tripId !== id));
  save(DOCS_KEY, load<JamaahDoc>(DOCS_KEY, []).filter((d) => !deletedJamaahIds.has(d.jamaahId)));
}

// ── JAMAAH ──────────────────────────────────────────────────────────────────

/**
 * Kolom yang di-fetch untuk list view — sengaja exclude `photo_data_url`.
 * Kolom ini bisa berisi base64 ratusan KB per jamaah; tidak dibutuhkan di
 * list view manapun (TripDetail, ProgressTracker, Dashboard, ExportCenter).
 * Untuk detail + foto lengkap, pakai `getJamaahWithPhoto(id)`.
 */
const JAMAAH_LIST_COLS = [
  "id", "trip_id", "name", "phone", "birth_date",
  "passport_number", "passport_expiry", "gender",
  "needs_review", "booking_code", "payment_status", "created_at",
].join(",");

export async function listAllAgencyJamaah(): Promise<Jamaah[]> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase!.from("jamaah").select(JAMAAH_LIST_COLS);
    if (error) throw error;
    return (data ?? []).map(jamaahFromRow);
  }
  return load<Jamaah>(JAMAAH_KEY, []);
}

export async function listJamaah(tripId: string): Promise<Jamaah[]> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase!
      .from("jamaah")
      .select(JAMAAH_LIST_COLS)
      .eq("trip_id", tripId);
    if (error) throw error;
    const list = (data ?? []).map(jamaahFromRow);
    // Merge into local cache — pertahankan photoDataUrl dari cache supaya
    // data foto offline tidak hilang saat list view di-refetch.
    const all = load<Jamaah>(JAMAAH_KEY, []);
    const prevForTrip = new Map(
      all.filter((j) => j.tripId === tripId).map((j) => [j.id, j]),
    );
    const toCache = list.map((j) => ({
      ...j,
      photoDataUrl: prevForTrip.get(j.id)?.photoDataUrl,
    }));
    save(JAMAAH_KEY, [...all.filter((j) => j.tripId !== tripId), ...toCache]);
    return list;
  }
  return load<Jamaah>(JAMAAH_KEY, []).filter((j) => j.tripId === tripId);
}

export async function createJamaah(draft: Omit<Jamaah, "id" | "createdAt">): Promise<Jamaah> {
  const id = `j-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let photoUrl = draft.photoDataUrl;
  if (isSupabaseConfigured() && isDataUrl(photoUrl)) {
    photoUrl = await uploadJamaahPhoto(id, draft.passportNumber, photoUrl as string);
  }
  const j: Jamaah = {
    ...draft,
    photoDataUrl: photoUrl,
    id,
    bookingCode: draft.bookingCode || generateBookingCode(),
    createdAt: new Date().toISOString(),
  };
  if (isSupabaseConfigured()) {
    const agencyId = requireAgencyId();
    const { error } = await supabase!.from("jamaah").insert(jamaahToRow(j, agencyId));
    if (error) throw error;
  }
  save(JAMAAH_KEY, [...load<Jamaah>(JAMAAH_KEY, []), j]);
  return j;
}

/**
 * Bulk insert beberapa jamaah dalam satu round-trip ke Supabase.
 * - Upload foto paralel dengan concurrency limit (hindari rate-limit Storage).
 * - Track storage path setiap foto yg berhasil ke-upload, supaya bisa rollback
 *   (cleanup orphan) kalau INSERT row di tabel `jamaah` gagal.
 * - Satu INSERT untuk semua row, satu localStorage write di akhir.
 */
const BULK_PHOTO_UPLOAD_CONCURRENCY = 6;

export async function createJamaahBulk(
  drafts: Omit<Jamaah, "id" | "createdAt">[],
  onProgress?: (uploaded: number, total: number) => void,
): Promise<Jamaah[]> {
  if (drafts.length === 0) return [];

  // Generate ID + booking code dulu di klien.
  const baseList: Jamaah[] = drafts.map((d, i) => ({
    ...d,
    id: `j-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    bookingCode: d.bookingCode || generateBookingCode(),
    createdAt: new Date().toISOString(),
  }));

  let uploaded = 0;
  onProgress?.(0, baseList.length);
  const list: Jamaah[] = new Array(baseList.length);
  /** Path foto yang sukses ter-upload — dipakai utk rollback kalau INSERT gagal. */
  const uploadedPaths: string[] = [];
  let uploadFailures = 0;

  // Worker-pool buat batasin paralelisme upload (storage rate-limit safe).
  let cursor = 0;
  const worker = async () => {
    while (cursor < baseList.length) {
      const i = cursor++;
      const j = baseList[i];
      let photo = j.photoDataUrl;
      if (isSupabaseConfigured() && isDataUrl(photo)) {
        try {
          const r = await uploadJamaahPhotoWithPath(j.id, j.passportNumber, photo as string);
          photo = r.url;
          if (r.path) uploadedPaths.push(r.path);
          // r.path null artinya helper return data URL asli (upload gagal di-swallow).
          if (!r.path && isDataUrl(r.url)) uploadFailures++;
        } catch (err) {
          console.warn("[bulk] gagal upload foto:", err);
          uploadFailures++;
        }
      }
      list[i] = { ...j, photoDataUrl: photo };
      uploaded++;
      onProgress?.(uploaded, baseList.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BULK_PHOTO_UPLOAD_CONCURRENCY, baseList.length) }, worker),
  );

  // ⚡ SATU KALI upsert untuk semua row (1 round-trip).
  // Pakai upsert (bukan insert) supaya retry setelah error tetap idempoten:
  // kalau ID sudah ada (mis. user retry setelah network blip), row di-update
  // bukan dilempar duplicate-PK error. ID generate di klien, jadi konflik
  // ID hanya terjadi pada retry (sangat aman untuk pola bulk).
  if (isSupabaseConfigured()) {
    const agencyId = requireAgencyId();
    const { error } = await supabase!
      .from("jamaah")
      .upsert(list.map((j) => jamaahToRow(j, agencyId)));
    if (error) {
      if (uploadedPaths.length > 0) {
        // Best-effort cleanup; jangan throw kalau cleanup gagal supaya error
        // utama (insert) tetep yg disurface ke user.
        try { await removeJamaahPhotos(uploadedPaths); }
        catch (e) { console.warn("[bulk] cleanup orphan photos failed", e); }
      }
      throw error;
    }
  }

  // Satu kali tulis ke localStorage juga.
  save(JAMAAH_KEY, [...load<Jamaah>(JAMAAH_KEY, []), ...list]);

  if (uploadFailures > 0) {
    // Surface jumlah foto yg gagal upload via console — caller (UI) bisa baca
    // dari log atau kita expand kontrak nanti utk passing detail ke onProgress.
    console.warn(`[bulk] ${uploadFailures} foto gagal di-upload (data jamaah tetep masuk).`);
  }
  return list;
}

export async function updateJamaah(id: string, patch: Partial<Jamaah>): Promise<Jamaah> {
  const all = load<Jamaah>(JAMAAH_KEY, []);
  const idx = all.findIndex((j) => j.id === id);
  if (idx === -1) throw new Error("Jamaah not found");
  const merged = { ...all[idx], ...patch };
  if (isSupabaseConfigured() && isDataUrl(merged.photoDataUrl)) {
    merged.photoDataUrl = await uploadJamaahPhoto(id, merged.passportNumber, merged.photoDataUrl!);
  }
  all[idx] = merged;
  if (isSupabaseConfigured()) {
    const { error } = await supabase!.from("jamaah").update(jamaahToRow(merged)).eq("id", id);
    if (error) throw error;
  }
  save(JAMAAH_KEY, all);
  return merged;
}

export async function deleteJamaah(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase!
      .from("jamaah")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      console.error(`[jamaah] DELETE id=${id} gagal:`, error);
      throw error;
    }
    if (!data || data.length === 0) {
      const msg =
        `Hapus jamaah gagal — server tidak menghapus baris (kemungkinan ` +
        `RLS DELETE policy nge-blok). Cek policy "jamaah_delete" di Supabase.`;
      console.error(`[jamaah] DELETE id=${id} silently blocked:`, { data });
      throw new Error(msg);
    }
  }
  save(JAMAAH_KEY, load<Jamaah>(JAMAAH_KEY, []).filter((j) => j.id !== id));
  save(DOCS_KEY, load<JamaahDoc>(DOCS_KEY, []).filter((d) => d.jamaahId !== id));
}

export async function getJamaah(id: string): Promise<Jamaah | null> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase!.from("jamaah").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? jamaahFromRow(data) : null;
  }
  return load<Jamaah>(JAMAAH_KEY, []).find((j) => j.id === id) ?? null;
}

/**
 * Seperti `getJamaah` tapi namanya eksplisit: ini SATU-SATUNYA fungsi yang
 * me-request `photo_data_url` dari Supabase. Pakai hanya di halaman detail
 * (JamaahProfile) — jangan dipanggil dari list/card view.
 */
export const getJamaahWithPhoto = getJamaah;

// ── DOCUMENTS ───────────────────────────────────────────────────────────────

export async function listDocs(jamaahId: string): Promise<JamaahDoc[]> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase!.from("jamaah_docs").select("*").eq("jamaah_id", jamaahId);
    if (error) throw error;
    const list = (data ?? []).map(docFromRow);
    const others = load<JamaahDoc>(DOCS_KEY, []).filter((d) => d.jamaahId !== jamaahId);
    save(DOCS_KEY, [...others, ...list]);
    return list;
  }
  return load<JamaahDoc>(DOCS_KEY, []).filter((d) => d.jamaahId === jamaahId);
}

export async function addDoc(draft: Omit<JamaahDoc, "id" | "createdAt">): Promise<JamaahDoc> {
  const id = `d-${Date.now()}`;
  let url = draft.dataUrl;
  if (isSupabaseConfigured() && isDataUrl(url)) {
    url = await uploadJamaahDoc(draft.jamaahId, draft.category, draft.fileName, url);
  }
  const d: JamaahDoc = { ...draft, dataUrl: url, id, createdAt: new Date().toISOString() };
  if (isSupabaseConfigured()) {
    const agencyId = requireAgencyId();
    const { error } = await supabase!.from("jamaah_docs").insert(docToRow(d, agencyId));
    if (error) throw error;
  }
  save(DOCS_KEY, [...load<JamaahDoc>(DOCS_KEY, []), d]);
  return d;
}

export async function deleteDoc(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase!
      .from("jamaah_docs")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      console.error(`[jamaah_docs] DELETE id=${id} gagal:`, error);
      throw error;
    }
    if (!data || data.length === 0) {
      const msg =
        `Hapus dokumen gagal — server tidak menghapus baris (kemungkinan ` +
        `RLS DELETE policy nge-blok). Cek policy "jamaah_docs_delete" di Supabase.`;
      console.error(`[jamaah_docs] DELETE id=${id} silently blocked:`, { data });
      throw new Error(msg);
    }
  }
  save(DOCS_KEY, load<JamaahDoc>(DOCS_KEY, []).filter((d) => d.id !== id));
}

// ── Bulk push helpers (used by migration) ───────────────────────────────────

export async function bulkUpsertTrips(trips: Trip[]) {
  if (!isSupabaseConfigured() || trips.length === 0) return;
  const agencyId = requireAgencyId();
  const { error } = await supabase!.from("trips").upsert(trips.map((t) => tripToRow(t, agencyId)));
  if (error) throw error;
}
export async function bulkUpsertJamaah(jamaah: Jamaah[]) {
  if (!isSupabaseConfigured() || jamaah.length === 0) return;
  const agencyId = requireAgencyId();
  // Upload base64 photos ke bucket dulu, ganti URL-nya
  const migrated: Jamaah[] = [];
  for (const j of jamaah) {
    if (isDataUrl(j.photoDataUrl)) {
      const url = await uploadJamaahPhoto(j.id, j.passportNumber, j.photoDataUrl!);
      migrated.push({ ...j, photoDataUrl: url });
    } else {
      migrated.push(j);
    }
  }
  const { error } = await supabase!.from("jamaah").upsert(migrated.map((j) => jamaahToRow(j, agencyId)));
  if (error) throw error;
  // Update local cache dengan URL baru
  const all = load<Jamaah>(JAMAAH_KEY, []);
  const next = all.map((existing) => migrated.find((m) => m.id === existing.id) ?? existing);
  save(JAMAAH_KEY, next);
}
export async function bulkUpsertDocs(docs: JamaahDoc[]) {
  if (!isSupabaseConfigured() || docs.length === 0) return;
  const agencyId = requireAgencyId();
  const migrated: JamaahDoc[] = [];
  for (const d of docs) {
    if (isDataUrl(d.dataUrl)) {
      const url = await uploadJamaahDoc(d.jamaahId, d.category, d.fileName, d.dataUrl);
      migrated.push({ ...d, dataUrl: url });
    } else {
      migrated.push(d);
    }
  }
  const { error } = await supabase!.from("jamaah_docs").upsert(migrated.map((d) => docToRow(d, agencyId)));
  if (error) throw error;
  const all = load<JamaahDoc>(DOCS_KEY, []);
  const next = all.map((existing) => migrated.find((m) => m.id === existing.id) ?? existing);
  save(DOCS_KEY, next);
}
