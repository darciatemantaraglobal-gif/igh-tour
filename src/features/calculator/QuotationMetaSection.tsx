import { useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, FileText, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { DateRangePicker } from "@/components/ui/date-range-picker";

export interface QuotationMeta {
  quoteNumber: string;
  customerName: string;
  dateRange: string;
  hotelMakkahName: string;
  hotelMadinahName: string;
  /** Override manual jumlah malam Makkah di PDF. 0/undefined = pakai auto dari hotel row. */
  makkahNightsOverride?: number;
  /** Override manual jumlah malam Madinah di PDF. 0/undefined = pakai auto dari hotel row. */
  madinahNightsOverride?: number;
  includedItems: string[];
  excludedItems: string[];
  // ── Group offer (PDF gaya "Penawaran Paket LA") ──
  tier: string;            // cth: "Premium"
  title: string;           // judul utama, bisa multi-line
  subtitle: string;        // cth: "Program 7 Malam"
  makkahStars: number;     // 1..5
  madinahStars: number;    // 1..5
  usdToSar: number;        // cth: 3.75
  website: string;         // cth: "www.umrahservice.co"
  contactPhone: string;    // cth: "+62 812-8955-2018"
  contactName: string;     // cth: "M. FARUQ AL ISLAM"
}

interface Props {
  value: QuotationMeta;
  onChange: (next: QuotationMeta) => void;
}

const M = { fontFamily: "'Manrope', sans-serif" };

// ── Template storage helpers (localStorage) ────────────────────────────────
interface ListTemplate { name: string; items: string[]; updatedAt: number }

function tplStorageKey(kind: "included" | "excluded") {
  return `igh:list-templates:${kind}`;
}
function loadTemplates(kind: "included" | "excluded"): ListTemplate[] {
  try {
    const raw = localStorage.getItem(tplStorageKey(kind));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t.name === "string") : [];
  } catch { return []; }
}
function saveTemplates(kind: "included" | "excluded", list: ListTemplate[]) {
  localStorage.setItem(tplStorageKey(kind), JSON.stringify(list));
}

function ListEditor({
  title, color, kind, items, onChange,
}: {
  title: string;
  color: "green" | "red";
  kind: "included" | "excluded";
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const palette = color === "green"
    ? { bg: "bg-emerald-50", border: "border-emerald-200", chip: "bg-emerald-100 text-emerald-700", btn: "border-emerald-300 text-emerald-700 hover:bg-emerald-100" }
    : { bg: "bg-rose-50", border: "border-rose-200", chip: "bg-rose-100 text-rose-700", btn: "border-rose-300 text-rose-700 hover:bg-rose-100" };

  const [templates, setTemplates] = useState<ListTemplate[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setTemplates(loadTemplates(kind)); }, [kind]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function handleSave() {
    const cleaned = items.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      toast.error("Isi dulu minimal 1 item sebelum disimpan jadi template");
      return;
    }
    const name = window.prompt("Nama template:", "")?.trim();
    if (!name) return;
    const next = [...templates.filter((t) => t.name !== name), { name, items: cleaned, updatedAt: Date.now() }]
      .sort((a, b) => a.name.localeCompare(b.name));
    saveTemplates(kind, next);
    setTemplates(next);
    toast.success(`Template "${name}" disimpan`);
  }

  function handleLoad(tpl: ListTemplate) {
    onChange([...tpl.items]);
    setMenuOpen(false);
    toast.success(`Template "${tpl.name}" dimuat`);
  }

  function handleAppend(tpl: ListTemplate) {
    const existing = new Set(items.map((s) => s.trim().toLowerCase()).filter(Boolean));
    const additions = tpl.items.filter((s) => !existing.has(s.trim().toLowerCase()));
    if (additions.length === 0) {
      toast.message(`Semua item dari "${tpl.name}" sudah ada`);
    } else {
      onChange([...items.filter((s) => s.trim()), ...additions]);
      toast.success(`+${additions.length} item dari "${tpl.name}"`);
    }
    setMenuOpen(false);
  }

  function handleDelete(tpl: ListTemplate) {
    if (!window.confirm(`Hapus template "${tpl.name}"?`)) return;
    const next = templates.filter((t) => t.name !== tpl.name);
    saveTemplates(kind, next);
    setTemplates(next);
    toast.success(`Template "${tpl.name}" dihapus`);
  }

  return (
    <div className={`rounded-xl border ${palette.border} ${palette.bg} p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <span style={M} className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700">{title}</span>
        <div className="flex items-center gap-1">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border ${palette.btn} text-[10.5px] font-bold bg-white`}
              title="Muat template tersimpan"
            >
              <Bookmark className="h-3 w-3" /> Template
              <ChevronDown className="h-3 w-3" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-30 w-64 rounded-lg border border-slate-200 bg-white shadow-lg p-1 max-h-72 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => { handleSave(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Save className="h-3.5 w-3.5" /> Simpan list saat ini sebagai template…
                </button>
                <div className="my-1 h-px bg-slate-100" />
                {templates.length === 0 ? (
                  <p className="px-2 py-2 text-[10.5px] text-slate-400 italic">Belum ada template tersimpan.</p>
                ) : (
                  templates.map((tpl) => (
                    <div key={tpl.name} className="flex items-center gap-1 group">
                      <button
                        type="button"
                        onClick={() => handleLoad(tpl)}
                        className="flex-1 text-left px-2 py-1.5 rounded-md text-[11px] font-semibold text-slate-700 hover:bg-slate-100 truncate"
                        title={`${tpl.items.length} item — klik untuk replace`}
                      >
                        {tpl.name}
                        <span className="ml-1 text-slate-400 font-normal">({tpl.items.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAppend(tpl)}
                        className="px-1.5 h-6 rounded text-[10px] font-bold text-slate-500 hover:text-emerald-700 hover:bg-emerald-50"
                        title="Tambahkan ke list (tanpa replace)"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(tpl)}
                        className="px-1.5 h-6 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                        title="Hapus template"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onChange([...items, ""])}
            className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border ${palette.btn} text-[10.5px] font-bold bg-white`}
          >
            <Plus className="h-3 w-3" /> Tambah
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {items.length === 0 && (
          <p className="text-[10.5px] text-slate-400 italic">Belum ada item — klik "Tambah"</p>
        )}
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <span className={`shrink-0 w-5 h-5 rounded ${palette.chip} text-[10px] font-extrabold inline-flex items-center justify-center`}>
              {idx + 1}
            </span>
            <input
              type="text"
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[idx] = e.target.value;
                onChange(next);
              }}
              placeholder="cth: Visa Umroh"
              style={M}
              className="flex-1 h-7 rounded-md border border-slate-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuotationMetaSection({ value, onChange }: Props) {
  function set<K extends keyof QuotationMeta>(key: K, v: QuotationMeta[K]) {
    onChange({ ...value, [key]: v });
  }
  return (
    <div className="rounded-xl border border-orange-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-200">
        <FileText className="h-3.5 w-3.5 text-orange-600" />
        <span style={M} className="text-[11.5px] font-extrabold uppercase tracking-wider text-orange-700">
          Info Penawaran (untuk PDF)
        </span>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="flex flex-col gap-1">
            <span style={M} className="text-[10px] font-bold text-slate-600">No. Quote</span>
            <input
              type="text"
              value={value.quoteNumber}
              onChange={(e) => set("quoteNumber", e.target.value)}
              placeholder="3345"
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={M} className="text-[10px] font-bold text-slate-600">Tier / Badge</span>
            <select
              value={value.tier}
              onChange={(e) => set("tier", e.target.value)}
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            >
              <option value="">— tanpa badge —</option>
              <option value="Premium">Premium</option>
              <option value="Reguler">Reguler</option>
              <option value="Promo">Promo</option>
              <option value="VIP">VIP</option>
              <option value="Spesial">Spesial</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span style={M} className="text-[10px] font-bold text-slate-600">Customer (penerima penawaran)</span>
            <input
              type="text"
              value={value.customerName}
              onChange={(e) => set("customerName", e.target.value)}
              placeholder="cth: IGH Tour"
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
          <label className="flex flex-col gap-1 col-span-2 md:col-span-3">
            <span style={M} className="text-[10px] font-bold text-slate-600">Judul Penawaran (boleh panjang)</span>
            <input
              type="text"
              value={value.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="cth: Penawaran Paket LA Umrah Bintang 5 Awal Musim"
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={M} className="text-[10px] font-bold text-slate-600">Sub-judul / Pill</span>
            <input
              type="text"
              value={value.subtitle}
              onChange={(e) => set("subtitle", e.target.value)}
              placeholder="cth: Program 7 Malam"
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span style={M} className="text-[10px] font-bold text-slate-600">Tanggal Trip / Periode</span>
            <DateRangePicker
              value={value.dateRange}
              onChange={(v) => set("dateRange", v)}
              placeholder="Pilih periode trip"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={M} className="text-[10px] font-bold text-slate-600">KURS 1 USD = … SAR</span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={value.usdToSar || ""}
              onChange={(e) => set("usdToSar", parseFloat(e.target.value) || 0)}
              placeholder="3.75"
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={M} className="text-[10px] font-bold text-slate-600">Bintang Hotel Makkah</span>
            <select
              value={value.makkahStars}
              onChange={(e) => set("makkahStars", parseInt(e.target.value) || 5)}
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            >
              {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{"★".repeat(s)} ({s})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span style={M} className="text-[10px] font-bold text-slate-600">Bintang Hotel Madinah</span>
            <select
              value={value.madinahStars}
              onChange={(e) => set("madinahStars", parseInt(e.target.value) || 5)}
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            >
              {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{"★".repeat(s)} ({s})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span style={M} className="text-[10px] font-bold text-slate-600">Hotel Makkah</span>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={value.hotelMakkahName}
                onChange={(e) => set("hotelMakkahName", e.target.value)}
                placeholder="cth: Pullman Zamzam Makkah"
                style={M}
                className="flex-1 h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={value.makkahNightsOverride ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value) || 0);
                    set("makkahNightsOverride", v as number);
                  }}
                  placeholder="auto"
                  title="Jumlah malam Makkah di PDF (kosong = otomatis dari hotel row)"
                  style={M}
                  className="w-16 h-8 px-2 rounded-lg border border-orange-300 bg-orange-50 text-[12px] font-bold text-orange-700 focus:outline-none focus:ring-1 focus:ring-orange-400 text-center"
                />
                <span style={M} className="text-[10px] font-bold text-slate-500 whitespace-nowrap">mlm</span>
              </div>
            </div>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span style={M} className="text-[10px] font-bold text-slate-600">Hotel Madinah</span>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={value.hotelMadinahName}
                onChange={(e) => set("hotelMadinahName", e.target.value)}
                placeholder="cth: Frontel Al Harithia"
                style={M}
                className="flex-1 h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={value.madinahNightsOverride ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value) || 0);
                    set("madinahNightsOverride", v as number);
                  }}
                  placeholder="auto"
                  title="Jumlah malam Madinah di PDF (kosong = otomatis dari hotel row)"
                  style={M}
                  className="w-16 h-8 px-2 rounded-lg border border-orange-300 bg-orange-50 text-[12px] font-bold text-orange-700 focus:outline-none focus:ring-1 focus:ring-orange-400 text-center"
                />
                <span style={M} className="text-[10px] font-bold text-slate-500 whitespace-nowrap">mlm</span>
              </div>
            </div>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span style={M} className="text-[10px] font-bold text-slate-600">Website</span>
            <input
              type="text"
              value={value.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="cth: www.agensitravel.co.id"
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={M} className="text-[10px] font-bold text-slate-600">No. Kontak</span>
            <input
              type="text"
              value={value.contactPhone}
              onChange={(e) => set("contactPhone", e.target.value)}
              placeholder="cth: +62 812-0000-0000"
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={M} className="text-[10px] font-bold text-slate-600">Nama Kontak</span>
            <input
              type="text"
              value={value.contactName}
              onChange={(e) => set("contactName", e.target.value)}
              placeholder="cth: Nama Kontak"
              style={M}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <ListEditor
            title="Harga Sudah Termasuk"
            color="green"
            kind="included"
            items={value.includedItems}
            onChange={(next) => set("includedItems", next)}
          />
          <ListEditor
            title="Harga Tidak Termasuk"
            color="red"
            kind="excluded"
            items={value.excludedItems}
            onChange={(next) => set("excludedItems", next)}
          />
        </div>
      </div>
    </div>
  );
}
