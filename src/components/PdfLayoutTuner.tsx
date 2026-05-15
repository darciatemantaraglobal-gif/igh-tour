import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlignCenter, AlignLeft, AlignRight, Bookmark, ClipboardCopy, FileImage, Loader2, Pencil, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { uploadPdfTemplate, removePdfTemplate } from "@/lib/supabaseStorage";
import {
  BUILTIN_PRESET,
  DEFAULT_IGH_LAYOUT,
  GROUP_LAYOUT,
  loadPresetsCache,
  saveIghLayoutConfig,
  withBuiltins,
  type IghFontFamily,
  type IghLayoutConfig,
  type IghLayoutMode,
  type IghLayoutPreset,
  type IghPdfCurrency,
  type IghSection,
  type IghTextAlign,
} from "@/lib/ighPdfConfig";
import {
  deletePdfLayoutPreset,
  pullActiveLayoutConfig,
  pullPdfLayoutPresets,
  pushActiveLayoutConfig,
  upsertPdfLayoutPreset,
} from "@/lib/cloudSync";
import { onPdfPresetsChanged } from "@/lib/supabaseRealtime";

const FONT_OPTIONS: { value: IghFontFamily; label: string; hint: string }[] = [
  { value: "Poppins", label: "Poppins", hint: "Modern · Geometric" },
  { value: "Montserrat", label: "Montserrat", hint: "Classic · Elegant" },
  { value: "Sk-Modernist", label: "Sk-Modernist", hint: "Minimal · Clean" },
];

const SECTION_LABELS: { key: IghSection; label: string }[] = [
  { key: "projectName", label: "Project Name" },
  { key: "metaInfo", label: "Meta Info" },
  { key: "hotel", label: "Hotel" },
  { key: "pricing", label: "Pricing (Private)" },
  { key: "groupPricing", label: "Pricing (Group)" },
  { key: "checklist", label: "Checklist" },
];

interface Props {
  config: IghLayoutConfig;
  mode?: IghLayoutMode;
  onChange: (next: IghLayoutConfig) => void;
  onClose: () => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, unit, onChange }: SliderRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-mono text-slate-500">
          {value.toFixed(step < 1 ? 2 : 0)}
          {unit ?? ""}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? value)}
      />
    </div>
  );
}

interface TextRowProps {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onChange: (v: string) => void;
}

interface AlignRowProps {
  label: string;
  value: IghTextAlign;
  onChange: (v: IghTextAlign) => void;
}

/** Segmented control: Left | Center | Right alignment toggle. Sits below
 *  the related X-coordinate slider so users see immediately how the anchor
 *  point is interpreted. */
function AlignRow({ label, value, onChange }: AlignRowProps) {
  const opts: { v: IghTextAlign; Icon: typeof AlignLeft; title: string }[] = [
    { v: "left",   Icon: AlignLeft,   title: "Left — X = awal teks" },
    { v: "center", Icon: AlignCenter, title: "Center — X = tengah teks" },
    { v: "right",  Icon: AlignRight,  title: "Right — X = batas akhir teks" },
  ];
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-slate-700">{label}</div>
      <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 gap-0.5">
        {opts.map(({ v, Icon, title }) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              title={title}
              onClick={() => onChange(v)}
              className={
                "h-6 px-2 rounded inline-flex items-center justify-center transition-colors " +
                (active
                  ? "bg-white text-orange-600 shadow-sm ring-1 ring-orange-200"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-100")
              }
            >
              <Icon className="h-3 w-3" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TextRow({ label, value, placeholder, multiline, onChange }: TextRowProps) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-slate-700">{label}</div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full text-[10px] font-mono rounded-md border border-slate-200 bg-white px-2 py-1.5 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-300 resize-y"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-7 text-[10px] font-mono"
        />
      )}
    </div>
  );
}

export function PdfLayoutTuner({ config, mode = "private", onChange, onClose }: Props) {
  const [local, setLocal] = useState<IghLayoutConfig>(config);
  const [cloudPresets, setCloudPresets] = useState<IghLayoutPreset[]>(() => loadPresetsCache());
  const [activePresetId, setActivePresetId] = useState<string | "">("");
  const [presetName, setPresetName] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  // "Sync subtitle distance" lock — kalau ON, ubah Font Size hotel auto
  // recalculate Subtitle Gap proporsional (ratio gap/size dipertahankan).
  const [syncHotelSubtitle, setSyncHotelSubtitle] = useState(false);
  const [hotelSubtitleRatio, setHotelSubtitleRatio] = useState(
    () => config.hotel.subtitleOffsetPx / Math.max(1, config.hotel.size),
  );

  // ── Sync `local` saat prop `config` berubah dari luar ──
  // Tanpa ini, undo/redo, switch mode, atau drag commit dari overlay bikin
  // panel Tuner tampil nilai stale → slider berikutnya akan write balik nilai
  // lama ke parent (silent data loss).
  // Pakai ref + JSON-compare biar gak loop dengan effect debounce di bawah.
  const lastSeenConfigRef = useRef(config);
  useEffect(() => {
    if (config === lastSeenConfigRef.current) return;
    // Skip kalau perubahan berasal dari local user (config === local).
    // JSON.stringify cukup ringan (<1KB) dibanding lag akibat re-render full.
    const a = JSON.stringify(config);
    const b = JSON.stringify(local);
    if (a !== b) setLocal(config);
    lastSeenConfigRef.current = config;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // List yang ditampilkan: built-in selalu di atas, lalu cloud — di-filter per mode.
  const visiblePresets = withBuiltins(cloudPresets, mode);
  const activePreset = visiblePresets.find((p) => p.id === activePresetId);
  const isBuiltinActive = !!activePreset?.builtin;

  // Reset selected preset kalau mode ganti & preset aktif gak match mode baru.
  useEffect(() => {
    if (!activePresetId) return;
    const stillVisible = visiblePresets.some((p) => p.id === activePresetId);
    if (!stillVisible) {
      setActivePresetId("");
      setPresetName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Debounce upstream notify by 350ms biar slider drag/typing ga lag.
  // Cloud push pakai debounce 2s (lebih hemat request Supabase).
  useEffect(() => {
    const t = window.setTimeout(() => {
      onChange(local);
      saveIghLayoutConfig(local, mode);
      // Tandai bahwa state ini = config terbaru, jadi sync-from-prop di atas
      // gak ngira ini perubahan eksternal & loop re-set local.
      lastSeenConfigRef.current = local;
    }, 350);
    const tCloud = window.setTimeout(() => {
      void pushActiveLayoutConfig(local, mode);
    }, 2000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(tCloud);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  // Initial pull dari cloud + subscribe realtime → kalau device lain mutasi,
  // list di sini auto refresh.
  // Juga pull "active config" — config terakhir yg disimpan dari device manapun —
  // supaya buka di laptop baru tetap pakai setting yang sama.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      pullPdfLayoutPresets(),
      pullActiveLayoutConfig(mode),
    ]).then(([list, activeConfig]) => {
      if (cancelled) return;
      setCloudPresets(list);
      if (activeConfig) {
        setLocal(activeConfig);
        saveIghLayoutConfig(activeConfig, mode);
        lastSeenConfigRef.current = activeConfig;
      }
    });
    const off = onPdfPresetsChanged(() => {
      void pullPdfLayoutPresets().then((list) => {
        if (!cancelled) setCloudPresets(list);
      });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  function handleApplyPreset(id: string) {
    setActivePresetId(id);
    if (!id) return;
    const p = visiblePresets.find((x) => x.id === id);
    if (!p) return;
    setLocal(p.config);
    setPresetName(p.builtin ? "" : p.name);
    toast.success(`Preset "${p.name}" diterapkan`);
  }

  async function handleSaveAsNew() {
    const name = presetName.trim();
    if (!name) {
      toast.error("Kasih nama preset dulu");
      return;
    }
    setPresetBusy(true);
    try {
      const now = Date.now();
      const created = await upsertPdfLayoutPreset({
        id: `preset_${now}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        config: local,
        createdAt: now,
        updatedAt: now,
        mode,
      });
      const list = await pullPdfLayoutPresets();
      setCloudPresets(list);
      setActivePresetId(created.id);
      toast.success(`Preset "${created.name}" disimpan ke cloud`);
    } catch (e) {
      toast.error(`Gagal simpan preset: ${(e as Error).message}`);
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleUpdateActive() {
    if (!activePresetId) {
      toast.error("Pilih preset dulu, atau pakai Save as New");
      return;
    }
    if (isBuiltinActive) {
      toast.error("Preset bawaan tidak bisa diubah");
      return;
    }
    const existing = cloudPresets.find((p) => p.id === activePresetId);
    if (!existing) {
      toast.error("Preset tidak ditemukan");
      return;
    }
    setPresetBusy(true);
    try {
      const updated = await upsertPdfLayoutPreset({
        ...existing,
        name: presetName.trim() || existing.name,
        config: local,
        updatedAt: Date.now(),
        // Preserve existing.mode kalau sudah ada (legacy preset stay legacy
        // sampai user save baru). Kalau belum ada, isi sesuai mode aktif.
        mode: existing.mode ?? mode,
      });
      const list = await pullPdfLayoutPresets();
      setCloudPresets(list);
      toast.success(`Preset "${updated.name}" diperbarui`);
    } catch (e) {
      toast.error(`Gagal update preset: ${(e as Error).message}`);
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleDeleteActive() {
    if (!activePresetId) return;
    if (isBuiltinActive) {
      toast.error("Preset bawaan tidak bisa dihapus");
      return;
    }
    const p = cloudPresets.find((x) => x.id === activePresetId);
    setPresetBusy(true);
    try {
      await deletePdfLayoutPreset(activePresetId);
      const list = await pullPdfLayoutPresets();
      setCloudPresets(list);
      setActivePresetId("");
      setPresetName("");
      toast.success(`Preset "${p?.name ?? ""}" dihapus`);
    } catch (e) {
      toast.error(`Gagal hapus preset: ${(e as Error).message}`);
    } finally {
      setPresetBusy(false);
    }
  }

  function patch<K extends keyof IghLayoutConfig>(
    section: K,
    p: Partial<IghLayoutConfig[K]>,
  ) {
    setLocal((prev) => ({ ...prev, [section]: { ...prev[section], ...p } }));
  }

  async function handleCopy() {
    try {
      const json = JSON.stringify(local, null, 2);
      await navigator.clipboard.writeText(json);
      toast.success("Config tersalin ke clipboard");
    } catch {
      toast.error("Gagal copy ke clipboard");
    }
  }

  function handleReset() {
    setLocal(mode === "group" ? GROUP_LAYOUT : DEFAULT_IGH_LAYOUT);
    toast.message(`Reset ke default (${mode === "group" ? "Grup" : "Private"})`);
  }

  // ── Custom Background Template ──────────────────────────────────────────
  // State khusus buat upload progress, supaya tombol bisa di-disable + spinner
  // muncul tanpa rebuild seluruh tuner.
  const [tplBusy, setTplBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleTemplateUpload(file: File) {
    if (tplBusy) return;
    // Guard ukuran: 10MB cap supaya gak nge-block UI lama-lama. PDF/image
    // background normalnya <2MB, jadi 10MB udah generous.
    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX) {
      toast.error(`File terlalu besar (max ${(MAX / 1024 / 1024).toFixed(0)}MB)`);
      return;
    }
    setTplBusy(true);
    const previousPath = local.customTemplate?.storagePath;
    // Safety net: jika upload stuck (misal Supabase down), release busy state
    // otomatis setelah 30 detik supaya tombol tidak terkunci selamanya.
    const UPLOAD_TIMEOUT_MS = 30_000;
    let releaseTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      setTplBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.error("Upload timeout. Coba lagi atau cek koneksi.");
    }, UPLOAD_TIMEOUT_MS);
    try {
      const result = await uploadPdfTemplate(file, mode);
      // Replace dulu di config — layout auto-save trigger live preview rebuild.
      setLocal((prev) => ({
        ...prev,
        customTemplate: {
          url: result.url,
          type: result.type,
          name: file.name,
          storagePath: result.path,
          uploadedAt: Date.now(),
        },
      }));
      // Cleanup file lama setelah replace sukses (best-effort, gak block UI).
      if (previousPath && previousPath !== result.path) {
        void removePdfTemplate(previousPath);
      }
      toast.success(`Background di-upload: ${file.name}`);
    } catch (e) {
      toast.error(`Gagal upload: ${(e as Error).message}`);
    } finally {
      if (releaseTimeout) { clearTimeout(releaseTimeout); releaseTimeout = null; }
      setTplBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleTemplateReset() {
    if (tplBusy) return;
    const previousPath = local.customTemplate?.storagePath;
    setLocal((prev) => ({ ...prev, customTemplate: null }));
    if (previousPath) void removePdfTemplate(previousPath);
    toast.message("Background dikembalikan ke template IGH default");
  }

  return (
    <div className="w-72 shrink-0 border-l border-[hsl(var(--border))] bg-slate-50/80 backdrop-blur-sm flex flex-col">
      <div className="px-3 py-2 border-b border-[hsl(var(--border))] flex items-center justify-between bg-white">
        <div className="flex flex-col">
          <span className="text-[11px] font-bold text-slate-700">Layout Tuner</span>
          <span className="text-[9px] text-slate-400">Auto-save · live preview</span>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          title="Tutup tuner"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* MATA UANG PDF — pilih currency utk render harga (matrix grup + box harga) */}
        <section className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            Mata Uang PDF
          </h4>
          <Select
            value={local.pdfCurrency ?? "USD"}
            onValueChange={(v) => setLocal({ ...local, pdfCurrency: v as IghPdfCurrency })}
          >
            <SelectTrigger className="h-8 text-xs bg-white" data-testid="select-pdf-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD" data-testid="select-pdf-currency-usd">USD ($)</SelectItem>
              <SelectItem value="IDR" data-testid="select-pdf-currency-idr">IDR (Rp)</SelectItem>
              <SelectItem value="SAR" data-testid="select-pdf-currency-sar">SAR (SR)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[9px] leading-tight text-slate-500">
            Otomatis konversi pakai kurs dari Settings kalau beda mata uang.
          </p>

          {/* FORMAT HARGA — full vs compact. Cuma ngaruh ke IDR; USD/SAR
              selalu lengkap. Live preview via debounce path yg sama kayak
              field lain (setLocal → effect → onChange → re-render PDF). */}
          <div className="pt-1.5 border-t border-emerald-200/70 space-y-1">
            <label className="text-[10px] font-semibold text-emerald-700">
              Format Harga
            </label>
            <Select
              value={local.priceDisplayMode ?? "compact"}
              onValueChange={(v) =>
                setLocal({ ...local, priceDisplayMode: v as "full" | "compact" })
              }
            >
              <SelectTrigger
                className="h-8 text-xs bg-white"
                data-testid="select-price-display-mode"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="compact"
                  data-testid="select-price-display-mode-compact"
                >
                  Singkat (30,1 jt)
                </SelectItem>
                <SelectItem
                  value="full"
                  data-testid="select-price-display-mode-full"
                >
                  Lengkap (Rp 30.123.456)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[9px] leading-tight text-slate-500">
              Berlaku utk currency IDR. USD/SAR selalu pakai format lengkap.
            </p>
          </div>
        </section>

        {/* PRESETS */}
        <section className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/50 p-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-orange-700 flex items-center gap-1">
            <Bookmark className="h-3 w-3" />
            Presets
          </h4>
          <Select
            value={activePresetId || "__none__"}
            onValueChange={(v) => handleApplyPreset(v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="h-7 text-[10px]">
              <SelectValue placeholder="Pilih preset…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-[10px] italic text-slate-500">
                — tidak ada —
              </SelectItem>
              {visiblePresets.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-[10px]">
                  {p.builtin ? `★ ${p.name}` : p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Nama preset baru…"
            className="h-7 text-[10px]"
          />
          <div className="flex gap-1">
            <button
              onClick={handleSaveAsNew}
              disabled={presetBusy}
              title="Save as new preset (cloud-synced)"
              className="flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="h-3 w-3" />
              Save as New
            </button>
            <button
              onClick={handleUpdateActive}
              disabled={!activePresetId || isBuiltinActive || presetBusy}
              title={isBuiltinActive ? "Preset bawaan tidak bisa diubah" : "Update preset aktif"}
              className="flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Pencil className="h-3 w-3" />
              Update
            </button>
            <button
              onClick={handleDeleteActive}
              disabled={!activePresetId || isBuiltinActive || presetBusy}
              title={isBuiltinActive ? "Preset bawaan tidak bisa dihapus" : "Hapus preset aktif"}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-rose-500 bg-white border border-slate-200 hover:bg-rose-50 hover:border-rose-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <p className="text-[9px] text-slate-500 leading-snug">
            ★ <span className="font-semibold">{BUILTIN_PRESET.name}</span> selalu ada sebagai
            safety-net. Preset lain tersimpan di cloud per-agency dan auto-sync antar device.
          </p>
        </section>

        {/* BACKGROUND TEMPLATE (custom upload) */}
        <section className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/50 p-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-sky-700 flex items-center gap-1">
            <FileImage className="h-3 w-3" />
            Background Template
          </h4>
          {local.customTemplate ? (
            <div className="rounded-md bg-white border border-sky-200 px-2 py-1.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="inline-flex items-center justify-center h-4 px-1.5 rounded bg-sky-100 text-sky-700 font-bold text-[9px] uppercase">
                  {local.customTemplate.type}
                </span>
                <span className="font-mono text-slate-700 truncate" title={local.customTemplate.name}>
                  {local.customTemplate.name}
                </span>
              </div>
              <div className="text-[9px] text-slate-400">
                Diupload {new Date(local.customTemplate.uploadedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-white/60 border border-dashed border-sky-200 px-2 py-1.5 text-[10px] text-slate-500 italic">
              Pakai template default IGH
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleTemplateUpload(f);
            }}
          />
          <div className="flex gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={tplBusy}
              title="Upload PDF atau gambar (PNG/JPG) sebagai background"
              className="flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-bold text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {tplBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {local.customTemplate ? "Ganti" : "Upload"}
            </button>
            <button
              onClick={handleTemplateReset}
              disabled={!local.customTemplate || tplBusy}
              title="Kembalikan ke template default IGH"
              className="h-7 px-2 inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
          <p className="text-[9px] text-slate-500 leading-snug">
            Upload <span className="font-semibold">PDF</span> (1 halaman, ukuran A5) atau{" "}
            <span className="font-semibold">PNG/JPG</span> sebagai background. Tersimpan per-agency
            di cloud untuk mode <span className="font-semibold">{mode === "group" ? "Grup" : "Private"}</span>.
            Save preset di atas kalau mau dipake antar device.
          </p>
        </section>

        {/* FONT FAMILY (global) */}
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Font Family (Global)
          </h4>
          <Select
            value={local.fonts.family}
            onValueChange={(v) =>
              setLocal((prev) => ({ ...prev, fonts: { ...prev.fonts, family: v as IghFontFamily } }))
            }
          >
            <SelectTrigger className="h-8 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                  <span className="font-semibold">{opt.label}</span>
                  <span className="ml-1.5 text-[9px] text-slate-400">{opt.hint}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[9px] text-slate-400 leading-snug">
            Default untuk semua section. Bisa override per-section di bawah.
          </p>
        </section>

        {/* PER-SECTION FONT OVERRIDES */}
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Override per Section
          </h4>
          <div className="space-y-1.5">
            {SECTION_LABELS.map(({ key, label }) => {
              const overridden = local.fonts.overrides?.[key];
              const value = overridden ?? "__default__";
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-600 w-20 shrink-0">{label}</span>
                  <Select
                    value={value}
                    onValueChange={(v) => {
                      setLocal((prev) => {
                        const ov = { ...(prev.fonts.overrides ?? {}) };
                        if (v === "__default__") delete ov[key];
                        else ov[key] = v as IghFontFamily;
                        return { ...prev, fonts: { ...prev.fonts, overrides: ov } };
                      });
                    }}
                  >
                    <SelectTrigger className="h-7 text-[10px] flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__" className="text-[10px] italic text-slate-500">
                        Pakai default
                      </SelectItem>
                      {FONT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-[10px]">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </section>

        {/* PROJECT NAME */}
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Project Name
          </h4>
          <TextRow
            label="Edit Teks (override) — Enter = baris baru"
            value={local.projectName.text ?? ""}
            placeholder="Kosong = pakai data kalkulator. Tekan Enter untuk baris baru."
            multiline
            onChange={(v) => patch("projectName", { text: v })}
          />
          <SliderRow
            label="X Position"
            value={local.projectName.xPx}
            min={20} max={700} step={1} unit="px"
            onChange={(v) => patch("projectName", { xPx: v })}
          />
          <AlignRow
            label="Alignment Judul"
            value={local.projectName.align ?? "left"}
            onChange={(v) => patch("projectName", { align: v })}
          />
          <SliderRow
            label="Y Position"
            value={local.projectName.topPx}
            min={220} max={300} step={1} unit="px"
            onChange={(v) => patch("projectName", { topPx: v })}
          />
          <SliderRow
            label="Font Size"
            value={local.projectName.size}
            min={14} max={28} step={1} unit="pt"
            onChange={(v) => patch("projectName", { size: v })}
          />
          <SliderRow
            label="Line Gap (jarak antar baris)"
            value={local.projectName.lineGapPx}
            min={-4} max={20} step={0.5} unit="px"
            onChange={(v) => patch("projectName", { lineGapPx: v })}
          />

          {/* MAIN HEADER GAP — jarak Title (Project Name) ke baris timeline
              tanggal di bawahnya. Dipisah dari lineGapPx (yg cuma antar baris
              title). Range 10-100 supaya bisa rapet atau renggang sesuai
              kebutuhan. Field canonical = `mainHeaderGap` (default 25); field
              lama `headerSubtitleGap` masih dibaca untuk preset lama tapi
              tidak ditulis ulang. */}
          <div className="pt-2 mt-1 border-t border-slate-200">
            <SliderRow
              label="Jarak Judul ke Tanggal"
              value={local.mainHeaderGap ?? local.headerSubtitleGap ?? 25}
              min={10} max={100} step={1} unit="px"
              onChange={(v) =>
                setLocal((prev) => ({ ...prev, mainHeaderGap: v }))
              }
            />
            <SliderRow
              label="X Offset (subtitle)"
              value={local.headerSubtitleOffset?.xPx ?? 0}
              min={-100} max={100} step={1} unit="px"
              onChange={(v) =>
                setLocal((prev) => ({
                  ...prev,
                  headerSubtitleOffset: {
                    xPx: v,
                    yPx: prev.headerSubtitleOffset?.yPx ?? 0,
                  },
                }))
              }
            />
            <SliderRow
              label="Y Offset (subtitle)"
              value={local.headerSubtitleOffset?.yPx ?? 0}
              min={-30} max={30} step={1} unit="px"
              onChange={(v) =>
                setLocal((prev) => ({
                  ...prev,
                  headerSubtitleOffset: {
                    xPx: prev.headerSubtitleOffset?.xPx ?? 0,
                    yPx: v,
                  },
                }))
              }
            />
            {/* LEBAR KOTAK SUBTITLE — kalau tanggal panjang (mis. "01 September
                2026 - 09 September 2026"), default 285px bisa kepotong dgn "...".
                Bikin lebar lebih besar supaya muat 1 baris, atau biarin di-wrap
                multi-line di generator kalau lebar maksimal pun masih kurang. */}
            <SliderRow
              label="Lebar Kotak Subtitle"
              value={local.subtitleWidthPx ?? 285}
              min={100} max={600} step={5} unit="px"
              onChange={(v) =>
                setLocal((prev) => ({ ...prev, subtitleWidthPx: v }))
              }
            />
            {/* FONT SIZE TANGGAL — sebelumnya hardcoded 11pt di generator.
                Range 6..14 supaya mencakup tanggal yg dipadetin (6-7pt) sampe
                tanggal yg di-emphasize (13-14pt). Live preview lewat path yg
                sama dgn slider lain (setLocal → debounce → onChange). */}
            <SliderRow
              label="Font Size Tanggal"
              value={local.subtitleFontSize ?? 11}
              min={6} max={14} step={0.5} unit="pt"
              onChange={(v) =>
                setLocal((prev) => ({ ...prev, subtitleFontSize: v }))
              }
            />
            {/* FORMAT TANGGAL — Short ringkas (default, hemat ruang) vs Full
                lengkap. Ngaruh ke sumber teks subtitle: generator pilih
                `data.timelineShort` atau `data.timeline` berdasar mode ini. */}
            <div className="pt-2 mt-2 border-t border-slate-200/70 space-y-1.5">
              <label className="text-[10px] font-semibold text-slate-600">
                Format Tanggal
              </label>
              <div
                role="radiogroup"
                aria-label="Format tanggal subtitle"
                className="flex gap-1.5"
                data-testid="radio-date-display-mode"
              >
                {(["Short", "Full"] as const).map((opt) => {
                  const active = (local.dateDisplayMode ?? "Short") === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() =>
                        setLocal((prev) => ({ ...prev, dateDisplayMode: opt }))
                      }
                      data-testid={`radio-date-display-mode-${opt.toLowerCase()}`}
                      className={[
                        "flex-1 h-7 rounded-md text-[10.5px] font-semibold border transition-colors",
                        active
                          ? "bg-emerald-500 border-emerald-500 text-white shadow-sm"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {opt === "Short" ? "Singkat" : "Lengkap"}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-slate-400 leading-snug">
                <strong>Singkat:</strong> "01 - 09 Sep 2026 (9 hari)" ·{" "}
                <strong>Lengkap:</strong> "01 September 2026 - 09 September 2026 (9 hari)".
              </p>
            </div>
            <p className="text-[9px] text-slate-400 leading-snug mt-1">
              Jarak utama dihitung otomatis dari bawah judul. Pakai X/Y Offset
              untuk fine-tune mandiri (mis. judul 2 baris). <strong>Lebar Kotak</strong>{" "}
              menentukan kapan teks tanggal mulai turun ke baris bawah (auto-wrap).
            </p>
          </div>
        </section>

        {/* META INFO — split jadi 2 sub-section: Date & Client.
            Tiap sub-section punya X & Y mandiri biar bisa di-tune independen
            tanpa saling ngedorong. Font size shared utk konsistensi visual. */}
        <section className="space-y-3">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Meta Info (Date & Invoice to)
          </h4>

          {/* ── DATE SECTION ── */}
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Date Section
            </div>
            <TextRow
              label="Date (override)"
              value={local.metaInfo.dateText ?? ""}
              placeholder="Kosong = pakai tanggal"
              onChange={(v) => patch("metaInfo", { dateText: v })}
            />
            <SliderRow
              label="X Date"
              value={local.metaInfo.dateXPx}
              min={40} max={700} step={1} unit="px"
              onChange={(v) => patch("metaInfo", { dateXPx: v })}
            />
            <SliderRow
              label="Y Date"
              value={local.metaInfo.dateYPx ?? local.metaInfo.topPx}
              min={235} max={310} step={1} unit="px"
              onChange={(v) => patch("metaInfo", { dateYPx: v })}
            />
          </div>

          {/* ── CLIENT SECTION ── */}
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Client Section
            </div>
            <TextRow
              label="Invoice to (override)"
              value={local.metaInfo.customerText ?? ""}
              placeholder="Kosong = pakai nama customer"
              onChange={(v) => patch("metaInfo", { customerText: v })}
            />
            <SliderRow
              label="X Invoice"
              value={local.metaInfo.customerXPx}
              min={40} max={700} step={1} unit="px"
              onChange={(v) => patch("metaInfo", { customerXPx: v })}
            />
            <SliderRow
              label="Y Invoice"
              value={local.metaInfo.customerYPx ?? local.metaInfo.topPx}
              min={235} max={310} step={1} unit="px"
              onChange={(v) => patch("metaInfo", { customerYPx: v })}
            />
          </div>

          <SliderRow
            label="Font Size (shared)"
            value={local.metaInfo.size}
            min={9} max={18} step={0.5} unit="pt"
            onChange={(v) => patch("metaInfo", { size: v })}
          />
        </section>

        {/* HOTEL */}
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Hotel (Makkah / Madinah)
          </h4>
          <TextRow
            label="Hotel Makkah (override)"
            value={local.hotel.makkahText ?? ""}
            placeholder="Kosong = pakai data"
            onChange={(v) => patch("hotel", { makkahText: v })}
          />
          <TextRow
            label="Hotel Madinah (override)"
            value={local.hotel.madinahText ?? ""}
            placeholder="Kosong = pakai data"
            onChange={(v) => patch("hotel", { madinahText: v })}
          />
          <SliderRow
            label="X Makkah"
            value={local.hotel.makkahXPx}
            min={20} max={200} step={1} unit="px"
            onChange={(v) => patch("hotel", { makkahXPx: v })}
          />
          <SliderRow
            label="X Madinah"
            value={local.hotel.madinahXPx}
            min={350} max={560} step={1} unit="px"
            onChange={(v) => patch("hotel", { madinahXPx: v })}
          />
          <SliderRow
            label="Y Position"
            value={local.hotel.topPx}
            min={360} max={440} step={1} unit="px"
            onChange={(v) => patch("hotel", { topPx: v })}
          />
          <SliderRow
            label="Font Size"
            value={local.hotel.size}
            min={14} max={28} step={0.5} unit="pt"
            onChange={(v) => {
              if (syncHotelSubtitle) {
                const nextGap = Math.min(
                  50,
                  Math.max(20, Math.round(hotelSubtitleRatio * v)),
                );
                patch("hotel", { size: v, subtitleOffsetPx: nextGap });
              } else {
                patch("hotel", { size: v });
              }
            }}
          />
          <label className="flex items-center gap-2 text-[10px] text-slate-700 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={syncHotelSubtitle}
              onChange={(e) => {
                const on = e.target.checked;
                setSyncHotelSubtitle(on);
                if (on) {
                  setHotelSubtitleRatio(
                    local.hotel.subtitleOffsetPx / Math.max(1, local.hotel.size),
                  );
                }
              }}
              className="h-3 w-3 accent-orange-500"
            />
            <span className="font-medium">Sync subtitle distance</span>
            <span className="text-slate-400">
              (lock gap ÷ size ratio)
            </span>
          </label>
          <SliderRow
            label="Subtitle Gap"
            value={local.hotel.subtitleOffsetPx}
            min={20} max={50} step={1} unit="px"
            onChange={(v) => {
              patch("hotel", { subtitleOffsetPx: v });
              if (syncHotelSubtitle) {
                setHotelSubtitleRatio(v / Math.max(1, local.hotel.size));
              }
            }}
          />
        </section>

        {/* PRICING */}
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Pricing Boxes (Pax / Price)
          </h4>
          <TextRow
            label="Pax (override)"
            value={local.pricing.paxText ?? ""}
            placeholder="Kosong = pakai jumlah pax"
            onChange={(v) => patch("pricing", { paxText: v })}
          />
          <TextRow
            label="Harga (override)"
            value={local.pricing.priceText ?? ""}
            placeholder='Kosong = pakai "Rp. 0"'
            onChange={(v) => patch("pricing", { priceText: v })}
          />
          <SliderRow
            label="X Pax Box"
            value={local.pricing.paxXPx}
            min={20} max={200} step={1} unit="px"
            onChange={(v) => patch("pricing", { paxXPx: v })}
          />
          <SliderRow
            label="X Price Box"
            value={local.pricing.priceXPx}
            min={200} max={400} step={1} unit="px"
            onChange={(v) => patch("pricing", { priceXPx: v })}
          />
          <SliderRow
            label="Y Position"
            value={local.pricing.topPx}
            min={480} max={560} step={1} unit="px"
            onChange={(v) => patch("pricing", { topPx: v })}
          />
          <SliderRow
            label="Font Size (Harga)"
            value={local.pricing.size}
            min={14} max={32} step={0.5} unit="pt"
            onChange={(v) => patch("pricing", { size: v })}
          />
          <SliderRow
            label="Vertical Center Offset"
            value={local.pricing.yOffsetPdf}
            min={-20} max={20} step={0.5} unit="pt"
            onChange={(v) => patch("pricing", { yOffsetPdf: v })}
          />
          <p className="text-[9px] text-slate-400 leading-snug">
            Negatif = naik, positif = turun. Tuning visual center kotak orange.
          </p>
        </section>

        {/* GROUP PRICING TABLE */}
        <section className="space-y-2 rounded-lg border border-orange-100 bg-orange-50/30 p-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-orange-700">
            Pricing Table — Group
          </h4>
          <p className="text-[9px] text-slate-500 leading-snug">
            Khusus template <span className="font-semibold">IGH Blank Template Group</span> —
            tabel 4 kolom (Pax · Quad · Triple · Double). Aktif kalau PDF di-generate
            dari Kalkulator Grup.
          </p>
          <SliderRow
            label="Y Position (baris pertama)"
            value={local.groupPricing.topPx}
            min={420} max={620} step={1} unit="px"
            onChange={(v) => patch("groupPricing", { topPx: v })}
          />
          <SliderRow
            label="Row Spacing (antar baris)"
            value={local.groupPricing.rowSpacingPx}
            min={14} max={48} step={1} unit="px"
            onChange={(v) => patch("groupPricing", { rowSpacingPx: v })}
          />
          <SliderRow
            label="X Center · Total Pax"
            value={local.groupPricing.paxCenterXPx}
            min={20} max={250} step={1} unit="px"
            onChange={(v) => patch("groupPricing", { paxCenterXPx: v })}
          />
          <SliderRow
            label="X Center · Quad"
            value={local.groupPricing.quadCenterXPx}
            min={150} max={400} step={1} unit="px"
            onChange={(v) => patch("groupPricing", { quadCenterXPx: v })}
          />
          <SliderRow
            label="X Center · Triple"
            value={local.groupPricing.tripleCenterXPx}
            min={300} max={560} step={1} unit="px"
            onChange={(v) => patch("groupPricing", { tripleCenterXPx: v })}
          />
          <SliderRow
            label="X Center · Double"
            value={local.groupPricing.doubleCenterXPx}
            min={460} max={720} step={1} unit="px"
            onChange={(v) => patch("groupPricing", { doubleCenterXPx: v })}
          />
          <div className="pt-1 border-t border-orange-100/80" />
          <p className="text-[9px] font-semibold text-slate-600">
            X-Offset per kolom (geser independen):
          </p>
          <SliderRow
            label="↔ Quad X-Offset"
            value={local.groupPricing.quadXOffsetPx}
            min={-40} max={40} step={0.5} unit="px"
            onChange={(v) => patch("groupPricing", { quadXOffsetPx: v })}
          />
          <SliderRow
            label="↔ Triple X-Offset"
            value={local.groupPricing.tripleXOffsetPx}
            min={-40} max={40} step={0.5} unit="px"
            onChange={(v) => patch("groupPricing", { tripleXOffsetPx: v })}
          />
          <SliderRow
            label="↔ Double X-Offset"
            value={local.groupPricing.doubleXOffsetPx}
            min={-40} max={40} step={0.5} unit="px"
            onChange={(v) => patch("groupPricing", { doubleXOffsetPx: v })}
          />
          <SliderRow
            label="Cell Height (vertical center)"
            value={local.groupPricing.cellHeightPx}
            min={14} max={48} step={1} unit="px"
            onChange={(v) => patch("groupPricing", { cellHeightPx: v })}
          />
          <SliderRow
            label="Font Size"
            value={local.groupPricing.size}
            min={9} max={22} step={0.5} unit="pt"
            onChange={(v) => patch("groupPricing", { size: v })}
          />
          <TextRow
            label="Currency Symbol"
            value={local.groupPricing.currencySymbol}
            placeholder="$ / Rp / SAR"
            onChange={(v) => patch("groupPricing", { currencySymbol: v })}
          />
        </section>

        {/* CHECKLIST */}
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Checklist (Sudah / Belum)
          </h4>
          <TextRow
            label="Sudah Termasuk (override)"
            value={local.checklist.includedText ?? ""}
            placeholder="1 baris per item, kosong = pakai data"
            multiline
            onChange={(v) => patch("checklist", { includedText: v })}
          />
          <TextRow
            label="Belum Termasuk (override)"
            value={local.checklist.excludedText ?? ""}
            placeholder="1 baris per item, kosong = pakai data"
            multiline
            onChange={(v) => patch("checklist", { excludedText: v })}
          />
          <SliderRow
            label="X Kolom Kiri (Sudah Termasuk)"
            value={local.checklist.leftXPx}
            min={120} max={320} step={1} unit="px"
            onChange={(v) => patch("checklist", { leftXPx: v })}
          />
          <AlignRow
            label="Alignment Sudah Termasuk"
            value={local.checklist.sudahTermasukAlign ?? "center"}
            onChange={(v) => patch("checklist", { sudahTermasukAlign: v })}
          />
          <SliderRow
            label="X Kolom Kanan (Belum Termasuk)"
            value={local.checklist.rightXPx}
            min={460} max={680} step={1} unit="px"
            onChange={(v) => patch("checklist", { rightXPx: v })}
          />
          <AlignRow
            label="Alignment Belum Termasuk"
            value={local.checklist.belumTermasukAlign ?? "center"}
            onChange={(v) => patch("checklist", { belumTermasukAlign: v })}
          />
          <TextRow
            label="Simbol List"
            value={local.checklist.listBullet ?? "•"}
            placeholder="• / - / ● / ★ (kosong = no bullet)"
            onChange={(v) => patch("checklist", { listBullet: v })}
          />
          <SliderRow
            label="Y Baris Pertama"
            value={local.checklist.firstBaselinePx}
            min={690} max={740} step={1} unit="px"
            onChange={(v) => patch("checklist", { firstBaselinePx: v })}
          />
          <SliderRow
            label="Row Gap"
            value={local.checklist.rowSpacingPx}
            min={16} max={48} step={1} unit="px"
            onChange={(v) => patch("checklist", { rowSpacingPx: v })}
          />
          <SliderRow
            label="Checklist Y Offset"
            value={local.checklist.yOffsetPx}
            min={-15} max={15} step={0.5} unit="px"
            onChange={(v) => patch("checklist", { yOffsetPx: v })}
          />
          <SliderRow
            label="Font Size"
            value={local.checklist.size}
            min={7} max={14} step={0.5} unit="pt"
            onChange={(v) => patch("checklist", { size: v })}
          />
          <p className="text-[9px] text-slate-400 leading-snug">
            Y Offset menggeser semua teks naik/turun supaya pas di tengah dua garis.
          </p>
        </section>

        {/* FOOTER WHATSAPP — posisi icon hijau + nomor admin di footer.
            Range Y dilebarin sampai 1010px supaya bisa nempel ke batas bawah
            halaman A5 (template-px ≈ 1023). Range X juga full-width. */}
        <section className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Footer WhatsApp
          </h4>
          <SliderRow
            label="X WhatsApp"
            value={local.whatsappPosition?.xPx ?? local.footer.waXPx}
            min={40} max={680} step={1} unit="px"
            onChange={(v) =>
              setLocal((prev) => ({
                ...prev,
                whatsappPosition: {
                  xPx: v,
                  yPx: prev.whatsappPosition?.yPx ?? prev.footer.topPx,
                },
              }))
            }
          />
          <SliderRow
            label="Y WhatsApp"
            value={local.whatsappPosition?.yPx ?? local.footer.topPx}
            min={700} max={1010} step={1} unit="px"
            onChange={(v) =>
              setLocal((prev) => ({
                ...prev,
                whatsappPosition: {
                  xPx: prev.whatsappPosition?.xPx ?? prev.footer.waXPx,
                  yPx: v,
                },
              }))
            }
          />
          <p className="text-[9px] text-slate-400 leading-snug">
            Y default <strong>891px</strong> sejajar dengan teks Instagram pre-printed.
            Geser sampai mendekati <strong>1010px</strong> kalau mau ke batas bawah.
          </p>
        </section>
      </div>

      <div className="p-2 border-t border-[hsl(var(--border))] bg-white flex gap-2">
        <button
          onClick={handleReset}
          className="flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
        <button
          onClick={handleCopy}
          className="flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-bold text-white transition-colors"
          style={{ background: "#F28E34" }}
        >
          <ClipboardCopy className="h-3 w-3" />
          Copy Config
        </button>
      </div>
    </div>
  );
}
