/**
 * Cloud sync helpers for data yang masih simpen di localStorage langsung
 * (notes + per-package calculations + pdf templates).
 *
 * Pola: localStorage tetep jadi cache instant-read, tapi setiap mutasi juga
 * di-push ke Supabase. Saat app start, `pullAll()` narik ulang dari cloud.
 */
import { supabase, isSupabaseConfigured } from "./supabase";
import { requireAgencyId } from "@/store/authStore";
import {
  mergeConfig,
  DEFAULT_IGH_LAYOUT,
  savePresetsCache,
  type IghLayoutConfig,
  type IghLayoutMode,
  type IghLayoutPreset,
} from "./ighPdfConfig";

// ── PACKAGE CALCULATIONS ────────────────────────────────────────────────────

export interface PackageCalcRow {
  package_id: string;
  payload: unknown;
  updated_at?: string;
}

export async function pullPackageCalc(packageId: string): Promise<unknown | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase!
    .from("package_calculations").select("payload").eq("package_id", packageId).maybeSingle();
  if (error) {
    // Sebelumnya silently return null → user gak tau cloud sync gagal.
    // Sekarang log warning supaya gampang di-debug dari DevTools console.
    console.warn(
      `[cloudSync] pullPackageCalc(${packageId}) gagal:`,
      error.message ?? error,
    );
    return null;
  }
  return data?.payload ?? null;
}

export async function pushPackageCalc(packageId: string, payload: unknown): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const agencyId = requireAgencyId();
  await supabase!.from("package_calculations").upsert({
    package_id: packageId, agency_id: agencyId, payload, updated_at: new Date().toISOString(),
  });
}

export async function pullAllPackageCalcs(): Promise<Record<string, unknown>> {
  if (!isSupabaseConfigured()) return {};
  const { data, error } = await supabase!.from("package_calculations").select("package_id,payload");
  if (error) return {};
  const out: Record<string, unknown> = {};
  for (const row of data ?? []) out[(row as PackageCalcRow).package_id] = (row as PackageCalcRow).payload;
  return out;
}

// ── NOTES ───────────────────────────────────────────────────────────────────

export interface NoteCloud {
  id: string;
  title: string;
  content: string;
  color: string;
  pinned?: boolean;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

const noteFromRow = (r: Record<string, unknown>): NoteCloud => ({
  id: String(r.id),
  title: String(r.title ?? ""),
  content: String(r.content ?? ""),
  color: String(r.color ?? "bg-white border-slate-200"),
  pinned: Boolean(r.pinned),
  tags: (r.tags as string[]) ?? [],
  createdAt: Number(r.created_at ?? Date.now()),
  updatedAt: Number(r.updated_at ?? Date.now()),
});
const noteToRow = (n: NoteCloud, agencyId?: string) => ({
  id: n.id, title: n.title, content: n.content, color: n.color,
  pinned: !!n.pinned, tags: n.tags ?? [],
  created_at: n.createdAt, updated_at: n.updatedAt,
  ...(agencyId ? { agency_id: agencyId } : {}),
});

export async function pullNotes(): Promise<NoteCloud[] | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase!.from("notes").select("*");
  if (error) return null;
  return (data ?? []).map(noteFromRow);
}

export async function pushNotes(notes: NoteCloud[]): Promise<void> {
  if (!isSupabaseConfigured() || notes.length === 0) return;
  const agencyId = requireAgencyId();
  await supabase!.from("notes").upsert(notes.map((n) => noteToRow(n, agencyId)));
}

export async function deleteNoteCloud(id: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabase!.from("notes").delete().eq("id", id);
}

/** Sync seluruh notes set: hapus yg di cloud tapi gak ada lokal, upsert sisanya. */
export async function syncNotesFull(notes: NoteCloud[]): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const cloud = await pullNotes();
  if (!cloud) return;
  const localIds = new Set(notes.map((n) => n.id));
  const toDelete = cloud.filter((c) => !localIds.has(c.id)).map((c) => c.id);
  if (toDelete.length > 0) await supabase!.from("notes").delete().in("id", toDelete);
  if (notes.length > 0) await pushNotes(notes);
}

// ── PDF TEMPLATES ───────────────────────────────────────────────────────────
// Tabel `pdf_templates` schema: id text, agency_id uuid, name text,
// payload jsonb, created_at timestamptz. Seluruh field PdfTemplate kecuali
// id/name/createdAt disimpan di kolom `payload`.

export interface PdfTemplateCloud {
  id: string;
  name: string;
  createdAt: number;
  // Sisanya (orientation, backgroundImage, fields, dst.) disimpan di payload.
  // Pakai unknown supaya helper ini netral terhadap shape PdfTemplate.
  payload: Record<string, unknown>;
}

const tmplFromRow = (r: Record<string, unknown>): PdfTemplateCloud => {
  const payload = (r.payload as Record<string, unknown>) ?? {};
  // created_at dari Postgres = ISO timestamptz; konversi ke ms epoch.
  const createdRaw = r.created_at;
  const createdAt =
    typeof createdRaw === "string"
      ? new Date(createdRaw).getTime()
      : Number(createdRaw ?? Date.now());
  return {
    id: String(r.id),
    name: String(r.name ?? payload.name ?? ""),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    payload,
  };
};

const tmplToRow = (t: PdfTemplateCloud, agencyId?: string) => ({
  id: t.id,
  name: t.name,
  payload: t.payload,
  created_at: new Date(t.createdAt).toISOString(),
  ...(agencyId ? { agency_id: agencyId } : {}),
});

export async function pullPdfTemplates(): Promise<PdfTemplateCloud[] | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase!
    .from("pdf_templates")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return null;
  return (data ?? []).map(tmplFromRow);
}

export async function pushPdfTemplate(t: PdfTemplateCloud): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const agencyId = requireAgencyId();
  const { error } = await supabase!
    .from("pdf_templates")
    .upsert(tmplToRow(t, agencyId));
  if (error) throw error;
}

export async function deletePdfTemplateCloud(id: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  await supabase!.from("pdf_templates").delete().eq("id", id);
}

/** Full reconcile: hapus yg di cloud tapi gak ada lokal, upsert sisanya. */
export async function syncPdfTemplatesFull(templates: PdfTemplateCloud[]): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const cloud = await pullPdfTemplates();
  if (!cloud) return;
  const localIds = new Set(templates.map((t) => t.id));
  const toDelete = cloud.filter((c) => !localIds.has(c.id)).map((c) => c.id);
  if (toDelete.length > 0) {
    await supabase!.from("pdf_templates").delete().in("id", toDelete);
  }
  if (templates.length > 0) {
    const agencyId = requireAgencyId();
    await supabase!
      .from("pdf_templates")
      .upsert(templates.map((t) => tmplToRow(t, agencyId)));
  }
}

// ── PDF LAYOUT PRESETS (Tuner) ──────────────────────────────────────────────
// Tabel `pdf_layout_presets` schema: id text PK, agency_id uuid, name text,
// payload jsonb (= IghLayoutConfig), created_at + updated_at timestamptz.

// Marker key untuk simpen mode di dalam jsonb payload (back-compat dgn schema
// existing yg gak punya kolom `mode`). Preset lama tanpa marker = legacy
// universal (ditampilin di kedua mode).
const MODE_MARKER_KEY = "__mode";

const presetFromRow = (r: Record<string, unknown>): IghLayoutPreset => {
  const rawPayload = (r.payload as Record<string, unknown>) ?? {};
  // Pisahkan marker dari config asli supaya mergeConfig gak ngeliat field aneh.
  const { [MODE_MARKER_KEY]: rawMode, ...cfgRaw } = rawPayload;
  const mode: IghLayoutMode | undefined =
    rawMode === "private" || rawMode === "group" ? rawMode : undefined;
  const created = typeof r.created_at === "string" ? Date.parse(r.created_at) : Number(r.created_at ?? Date.now());
  const updated = typeof r.updated_at === "string" ? Date.parse(r.updated_at) : Number(r.updated_at ?? created);
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    config: mergeConfig(DEFAULT_IGH_LAYOUT, cfgRaw as Partial<IghLayoutConfig>),
    createdAt: Number.isFinite(created) ? created : Date.now(),
    updatedAt: Number.isFinite(updated) ? updated : Date.now(),
    mode,
  };
};

const presetToRow = (p: IghLayoutPreset, agencyId: string) => {
  // Embed mode di dalam payload jsonb biar kompatibel dengan schema existing
  // yang gak punya kolom `mode`. Kalau mode undefined, jangan tulis marker
  // (preset jadi "legacy/universal").
  const payload: Record<string, unknown> = { ...(p.config as unknown as Record<string, unknown>) };
  if (p.mode) payload[MODE_MARKER_KEY] = p.mode;
  return {
    id: p.id,
    name: p.name,
    payload,
    agency_id: agencyId,
    created_at: new Date(p.createdAt).toISOString(),
    updated_at: new Date(p.updatedAt).toISOString(),
  };
};

// Reserved ID prefix untuk menyimpan "active config" lintas device.
// Record ini tidak pernah ditampilkan di daftar preset user.
const ACTIVE_CONFIG_ID_PREFIX = "__active__:";

/** Pull semua preset agency aktif → simpan ke localStorage cache → return list. */
export async function pullPdfLayoutPresets(): Promise<IghLayoutPreset[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase!
    .from("pdf_layout_presets")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("pullPdfLayoutPresets failed", error);
    return [];
  }
  // Saring reserved __active__:* entries supaya tidak muncul di daftar preset.
  const list = (data ?? [])
    .filter((r) => !String((r as Record<string, unknown>).id ?? "").startsWith(ACTIVE_CONFIG_ID_PREFIX))
    .map(presetFromRow);
  savePresetsCache(list);
  return list;
}

/**
 * Simpan config aktif (bukan preset bernama) ke cloud supaya sync lintas device.
 * Pakai reserved ID `__active__:private` / `__active__:group`.
 * Fire-and-forget — tidak perlu di-await.
 */
export async function pushActiveLayoutConfig(
  config: IghLayoutConfig,
  mode: IghLayoutMode,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const agencyId = requireAgencyId();
    const id = `${ACTIVE_CONFIG_ID_PREFIX}${mode}`;
    const payload: Record<string, unknown> = {
      ...(config as unknown as Record<string, unknown>),
      [MODE_MARKER_KEY]: mode,
    };
    await supabase!.from("pdf_layout_presets").upsert({
      id,
      name: id,
      payload,
      agency_id: agencyId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Silent — cross-device sync bersifat best-effort
  }
}

/**
 * Ambil config aktif dari cloud untuk mode tertentu.
 * Return null kalau belum ada (user belum pernah sync dari device manapun).
 */
export async function pullActiveLayoutConfig(
  mode: IghLayoutMode,
): Promise<IghLayoutConfig | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const id = `${ACTIVE_CONFIG_ID_PREFIX}${mode}`;
    const { data, error } = await supabase!
      .from("pdf_layout_presets")
      .select("payload")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const rawPayload = (data.payload as Record<string, unknown>) ?? {};
    const { [MODE_MARKER_KEY]: _mode, ...cfgRaw } = rawPayload;
    return mergeConfig(DEFAULT_IGH_LAYOUT, cfgRaw as Partial<IghLayoutConfig>);
  } catch {
    return null;
  }
}

/** Upsert satu preset (insert kalau ID baru, update kalau sudah ada). */
export async function upsertPdfLayoutPreset(p: IghLayoutPreset): Promise<IghLayoutPreset> {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync belum tersedia");
  if (p.builtin) throw new Error("Built-in preset tidak bisa diubah");
  const agencyId = requireAgencyId();
  const { data, error } = await supabase!
    .from("pdf_layout_presets")
    .upsert(presetToRow(p, agencyId))
    .select()
    .single();
  if (error || !data) throw error ?? new Error("Gagal simpan preset");
  return presetFromRow(data as Record<string, unknown>);
}

export async function deletePdfLayoutPreset(id: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (id.startsWith("builtin:")) throw new Error("Built-in preset tidak bisa dihapus");
  const { error } = await supabase!.from("pdf_layout_presets").delete().eq("id", id);
  if (error) throw error;
}
