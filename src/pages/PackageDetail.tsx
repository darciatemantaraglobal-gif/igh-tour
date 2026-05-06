import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Calculator, Calendar, CreditCard, FileKey, Layers,
  MapPin, Plus, Save, ScanLine, Trash2, Users, TrendingUp,
  Hotel, Bus, Globe, UserCheck, ChevronDown, ChevronUp,
} from "lucide-react";
import BulkOcrDialog from "@/components/BulkOcrDialog";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  computeProfessionalQuote, computeGeneralQuote, resolveRoomRate,
  type HotelRow, type TransportRow, type TicketRow, type VisaRow,
  type DestinationRow, type FnBRow, type StaffRow,
  type GeneralCostRow, type CalcCurrency, type CalcMode, type CostUnit,
} from "@/features/calculator/pricing";
import { GroupMatrixSection, DEFAULT_GROUP_SETTINGS, type GroupSettings } from "@/features/calculator/GroupMatrixSection";
import { HotelRatesCell } from "@/features/calculator/HotelRatesCell";
import { usePackages } from "@/features/packages/usePackages";
import { scanPassport, countPassportDataFields, failedChecksumLabels } from "@/lib/ocrPassport";
import { cn } from "@/lib/utils";
import { useRatesStore } from "@/store/ratesStore";
import { useJamaahStore, type Jamaah } from "@/store/tripsStore";
import { useRegional } from "@/lib/regional";
import { isSupabaseConfigured } from "@/lib/supabase";
import { pullPackageCalc } from "@/lib/cloudSync";
import {
  savePackageCalc,
  loadPackageCalcRaw,
  setPackageCalcSyncStatus,
  usePackageCalcSyncStatus,
  type PackageCalcSyncStatus,
} from "@/lib/packageCalcStorage";
import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { JamaahDetailDrawer, PaymentStatusPill } from "@/components/JamaahDetailDrawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { buildGoogleCalendarUrl, downloadICS } from "@/lib/calendarExport";
import { CalendarPlus, Download, ExternalLink } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProfessionalCalcState {
  mode: CalcMode;
  packageName: string;
  destination: string;
  pax: number;
  // Umroh mode fields
  hotels: HotelRow[];
  transports: TransportRow[];
  tickets: TicketRow[];
  visas: VisaRow[];
  destinations: DestinationRow[];
  fnbs: FnBRow[];
  staffs: StaffRow[];
  // Umum mode fields
  generalCosts: GeneralCostRow[];
  // Shared financial params
  commissionFee: number;
  marginPercent: number;
  discount: number;
  groupSettings: GroupSettings;
}

// ── Storage ───────────────────────────────────────────────────────────────────
// Read/write helpers (`savePackageCalc`, `loadPackageCalcRaw`) di-extract ke
// `src/lib/packageCalcStorage.ts` supaya bisa dipake juga dari Calculator.tsx
// (saat user "Create Paket Trip" — payload row dipush bareng ke localStorage
// + cloud, jadi PackageDetail langsung dapet datanya tanpa input ulang).
//
// Helper di bawah ini cuma layer typed merge: ngambil raw payload dari
// shared store lalu nge-merge dgn `fallback` yg shape-nya `ProfessionalCalcState`.

function loadPackageCalc(packageId: string, fallback: ProfessionalCalcState): ProfessionalCalcState {
  const raw = loadPackageCalcRaw(packageId);
  if (raw === null) return fallback;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(
      `[PackageDetail] payload local utk packageId=${packageId} format invalid ` +
      `(expected object, got ${Array.isArray(raw) ? "array" : typeof raw}) — pakai fallback`,
    );
    return fallback;
  }
  const stored = raw as Partial<ProfessionalCalcState>;
  return {
    ...fallback,
    ...stored,
    mode:
      stored.mode === "umum" || stored.mode === "umroh_private" || stored.mode === "umroh_group"
        ? stored.mode
        : (stored.mode as unknown) === "umroh"
          ? "umroh_private"
          : fallback.mode,
    hotels: stored.hotels ?? fallback.hotels,
    transports: stored.transports ?? fallback.transports,
    tickets: stored.tickets ?? fallback.tickets,
    visas: stored.visas ?? fallback.visas,
    destinations: stored.destinations ?? fallback.destinations,
    fnbs: stored.fnbs ?? fallback.fnbs,
    staffs: (stored.staffs ?? fallback.staffs).map((s: StaffRow) => ({ numStaff: 1, ...s })),
    generalCosts: stored.generalCosts ?? fallback.generalCosts,
    groupSettings: { ...fallback.groupSettings, ...(stored.groupSettings ?? {}) },
  };
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_GENERAL_COSTS: GeneralCostRow[] = [
  { id: "g1", category: "akomodasi", label: "Hotel / Penginapan",   qty: 3, amount: 0, currency: "IDR", unit: "pax"   },
  { id: "g2", category: "tiket",     label: "Tiket Pesawat PP",     qty: 1, amount: 0, currency: "IDR", unit: "pax"   },
  { id: "g3", category: "transport", label: "Bus / Kendaraan",      qty: 1, amount: 0, currency: "IDR", unit: "group" },
  { id: "g4", category: "visa",      label: "Visa & Dokumen",       qty: 1, amount: 0, currency: "IDR", unit: "pax"   },
  { id: "g5", category: "makan",     label: "Makan & Minum",        qty: 7, amount: 0, currency: "IDR", unit: "pax"   },
  { id: "g6", category: "atraksi",   label: "Atraksi & Wisata",     qty: 1, amount: 0, currency: "IDR", unit: "pax"   },
  { id: "g7", category: "guide",     label: "Guide & Staff",        qty: 1, amount: 0, currency: "IDR", unit: "group" },
];

function makeDefault(pax: number, name: string, dest: string): ProfessionalCalcState {
  return {
    mode: "umroh_private",
    packageName: name,
    destination: dest,
    pax,
    hotels: [
      { id: "h1", label: "Makkah", days: 4, pricePerNight: 0, rooms: 1 },
      { id: "h2", label: "Madinah", days: 3, pricePerNight: 0, rooms: 1 },
    ],
    transports: [{ id: "t1", label: "All Transport", fleet: 1, pricePerFleet: 0 }],
    tickets: [{ id: "tk1", label: "SUB - JED", flightType: "Return", pricePerPax: 0, currency: "IDR" }],
    visas: [{ id: "v1", label: "Visa Umroh", pricePerPax: 0 }],
    destinations: [
      { id: "d1", label: "Tasreh", pricePerPax: 0 },
    ],
    fnbs: [{ id: "f1", label: "Zam-zam", pricePerPax: 0 }],
    staffs: [
      { id: "s1", label: "Akomodasi Guide", numStaff: 1, totalCost: 0 },
      { id: "s2", label: "Muthowif", numStaff: 1, totalCost: 0 },
    ],
    generalCosts: DEFAULT_GENERAL_COSTS.map((c) => ({ ...c })),
    commissionFee: 0,
    marginPercent: 10,
    discount: 0,
    groupSettings: { ...DEFAULT_GROUP_SETTINGS },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const M = { fontFamily: "'Manrope', sans-serif" };

function fmtSAR(v: number) {
  if (!v) return "—";
  return "SAR " + v.toLocaleString("id-ID");
}
function fmtUSD(v: number) {
  if (!v) return "—";
  return "USD " + v.toLocaleString("id-ID");
}
/** Compact IDR number for narrow mobile stat cards: 0→0, <1Jt→full, <1M→1,2 Jt, else→1,2 M */
function fmtCompactIDR(v: number): string {
  if (!v || isNaN(v)) return "Rp 0";
  if (Math.abs(v) >= 1_000_000_000) return "Rp " + (v / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " M";
  if (Math.abs(v) >= 1_000_000) return "Rp " + (v / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " Jt";
  return "Rp " + Math.round(v).toLocaleString("id-ID");
}

const statusVariant: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Calculated: "bg-primary/10 text-primary",
  Confirmed: "bg-warning/10 text-warning",
  Paid: "bg-success/10 text-success",
  Completed: "bg-emerald-500/10 text-emerald-600",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Spreadsheet cell helpers ──────────────────────────────────────────────────

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={M}
      className={cn(
        "px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-orange-700 border-b border-orange-200 bg-orange-50/80 whitespace-nowrap",
        right && "text-right"
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, right, muted, bold, mono }: {
  children: React.ReactNode; right?: boolean; muted?: boolean; bold?: boolean; mono?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-2.5 py-1.5 text-[12px] border-b border-orange-50",
        right && "text-right",
        muted && "text-[hsl(var(--muted-foreground))]",
        bold && "font-bold",
        mono && "font-mono"
      )}
    >
      {children}
    </td>
  );
}

function NumCell({ value, onChange, placeholder }: {
  value: number; onChange: (v: number) => void; placeholder?: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value > 0 ? value.toLocaleString("id-ID") : ""}
      onChange={(e) => {
        const stripped = e.target.value.replace(/\./g, "").replace(/[^0-9]/g, "");
        onChange(stripped ? Number(stripped) : 0);
      }}
      placeholder={placeholder ?? "0"}
      style={M}
      className="w-full h-7 rounded-lg border border-orange-200 bg-white px-2 text-[12px] text-right focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
    />
  );
}

const TRANSPORT_TYPES = ["Camry", "GMC", "Staria", "Hiace", "Coaster", "Bus", "HHR Train"];
const ROUTE_OPTIONS = [
  "JED-MEK", "MEK-JED",
  "JED-MED", "MED-JED",
  "MED-MEK", "MEK-MED",
  "MED-MED",
  "THAIF",
];

function TextCell({ value, onChange, placeholder, suggestions, listId }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  suggestions?: string[]; listId?: string;
}) {
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ""}
        list={suggestions && listId ? listId : undefined}
        style={M}
        className="w-full h-7 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
      />
      {suggestions && listId && (
        <datalist id={listId}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  currency,
  onAdd,
  color,
}: {
  icon: React.ElementType;
  title: string;
  currency: string;
  onAdd: () => void;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-t-xl border border-b-0 border-orange-200" style={{ background: "linear-gradient(135deg,#fff7ed,#ffedd5)" }}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-orange-500 shrink-0" strokeWidth={2} />
        <span style={M} className="text-[12px] font-bold text-orange-800">{title}</span>
        <span style={M} className="text-[10px] font-semibold text-orange-500 bg-orange-100 px-1.5 py-0.5 rounded">
          {currency}
        </span>
      </div>
      <button
        onClick={onAdd}
        style={M}
        className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-white border border-orange-200 hover:bg-orange-50 rounded-lg px-2 py-1 transition-colors"
      >
        <Plus className="h-3 w-3" /> Tambah Baris
      </button>
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-7 w-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

const CUR_STYLE: Record<"IDR" | "SAR" | "USD", string> = {
  IDR: "bg-emerald-500 text-white",
  SAR: "bg-blue-500 text-white",
  USD: "bg-violet-500 text-white",
};
function RowCurrencyToggle({ value, onChange }: { value: "IDR" | "SAR" | "USD"; onChange: (v: "IDR" | "SAR" | "USD") => void }) {
  return (
    <div className="flex rounded-md border border-orange-200 overflow-hidden shrink-0">
      {(["IDR", "SAR", "USD"] as const).map((cur, i) => (
        <button
          key={cur}
          type="button"
          onClick={() => onChange(cur)}
          style={M}
          className={`h-7 px-1.5 text-[9px] font-bold transition-colors ${value === cur ? CUR_STYLE[cur] : "bg-white text-slate-400 hover:bg-slate-50"} ${i > 0 ? "border-l border-orange-200" : ""}`}
        >{cur}</button>
      ))}
    </div>
  );
}

const CATS: Array<{ value: string; emoji: string; label: string }> = [
  { value: "",          emoji: "•",  label: "—"           },
  { value: "akomodasi", emoji: "🏨", label: "Akomodasi"   },
  { value: "transport", emoji: "🚌", label: "Transport"   },
  { value: "tiket",     emoji: "✈️", label: "Tiket"       },
  { value: "visa",      emoji: "🪪", label: "Visa"        },
  { value: "makan",     emoji: "🍽️", label: "Makan"       },
  { value: "atraksi",   emoji: "🎭", label: "Atraksi"     },
  { value: "guide",     emoji: "👨‍✈️", label: "Guide"      },
  { value: "lainnya",   emoji: "📦", label: "Lainnya"     },
];
function UnitToggle({ value, onChange }: { value: CostUnit; onChange: (v: CostUnit) => void }) {
  return (
    <div className="flex rounded-md border border-orange-200 overflow-hidden shrink-0">
      {(["pax", "group"] as const).map((u, i) => (
        <button key={u} type="button" onClick={() => onChange(u)} style={M}
          className={`h-7 px-1.5 text-[9px] font-bold transition-colors ${value === u ? "bg-orange-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50"} ${i > 0 ? "border-l border-orange-200" : ""}`}
        >{u === "pax" ? "/pax" : "/grup"}</button>
      ))}
    </div>
  );
}

function SubtotalRow({ label, sarAmount, usdAmount, groupIDR, perPaxIDR, formatCurrency }: {
  label: string;
  sarAmount?: number;
  usdAmount?: number;
  groupIDR: number;
  perPaxIDR: number;
  formatCurrency: (v: number) => string;
}) {
  const hasSAR = sarAmount !== undefined && sarAmount > 0;
  const hasUSD = usdAmount !== undefined && usdAmount > 0;
  const foreignDisplay = hasSAR && hasUSD
    ? <><span className="text-blue-700">{fmtSAR(sarAmount!)}</span> <span className="text-orange-400">+</span> <span className="text-violet-700">{fmtUSD(usdAmount!)}</span></>
    : hasSAR ? <span className="text-blue-700">{fmtSAR(sarAmount!)}</span>
    : hasUSD ? <span className="text-violet-700">{fmtUSD(usdAmount!)}</span>
    : <span className="text-muted-foreground">—</span>;

  return (
    <tr className="bg-orange-50/50">
      <td colSpan={2} style={M} className="px-2.5 py-2 text-[11px] font-extrabold text-orange-700 uppercase tracking-wider border-t-2 border-orange-200">
        {label}
      </td>
      <td style={M} className="px-2.5 py-2 text-[11px] font-bold text-right border-t-2 border-orange-200 font-mono">
        {foreignDisplay}
      </td>
      <td style={M} className="px-2.5 py-2 text-[11px] font-bold text-right text-orange-700 border-t-2 border-orange-200 font-mono">
        {formatCurrency(groupIDR)}
      </td>
      <td style={M} className="px-2.5 py-2 text-[11px] font-bold text-right text-orange-600 border-t-2 border-orange-200 font-mono">
        {formatCurrency(perPaxIDR)}
      </td>
      <td className="border-t-2 border-orange-200" />
    </tr>
  );
}

// ── AddJamaahDialog ───────────────────────────────────────────────────────────

function AddJamaahWithOcrDialog({ open, packageId, onClose }: { open: boolean; packageId: string; onClose: () => void }) {
  const addJamaah = useJamaahStore((s) => s.addJamaah);
  const photoRef = useRef<HTMLInputElement>(null);
  const ocrRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ name: "", phone: "", birthDate: "", passportNumber: "", gender: "" as "L" | "P" | "" });
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [mrzInvalid, setMrzInvalid] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);

  const reset = () => {
    setForm({ name: "", phone: "", birthDate: "", passportNumber: "", gender: "" });
    setPhotoDataUrl(undefined);
    setOcrLoading(false);
    setOcrProgress(0);
  };

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Foto maks. 2 MB."); return; }
    setPhotoDataUrl(await fileToBase64(file));
    event.target.value = "";
  };

  const handleOcr = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setOcrLoading(true);
    setOcrProgress(0);
    try {
      const result = await scanPassport(file, setOcrProgress, { aiOnly: true });
      if (result.checksums && !result.mrzValid) {
        toast.warning(`MRZ checksum gagal: ${failedChecksumLabels(result).join(", ")}. Cek ulang manual sebelum simpan.`, { duration: 6000 });
      }
      setForm((prev) => ({
        ...prev,
        name: result.name || prev.name,
        birthDate: result.birthDate || prev.birthDate,
        passportNumber: result.passportNumber || prev.passportNumber,
        gender: result.gender || prev.gender,
      }));
      setMrzInvalid(result.checksums ? !result.mrzValid : false);
      const found = countPassportDataFields(result);
      if (found > 0) toast.success(`OCR berhasil, ${found} field terisi.`);
      else toast.warning("MRZ paspor belum kebaca. Coba foto yang lebih jelas.");
    } catch (e) {
      toast.error(`Gagal scan paspor: ${(e as Error).message}`, { duration: 7000 });
    } finally {
      setOcrLoading(false);
      event.target.value = "";
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) { toast.error("Nama jamaah wajib diisi."); return; }
    const snapshot = { ...form };
    const photoSnap = photoDataUrl;
    const mrzSnap = mrzInvalid;
    // Tutup dialog langsung — save jalan di background
    reset();
    onClose();
    void (async () => {
      try {
        await addJamaah({ ...snapshot, tripId: packageId, photoDataUrl: photoSnap, needsReview: mrzSnap });
        toast.success(`Jamaah "${snapshot.name}" ditambahkan.`);
      } catch {
        toast.error(`Gagal menyimpan "${snapshot.name}".`);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl border border-[hsl(var(--border))] shadow-xl bg-white">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[hsl(var(--border))]">
          <DialogTitle className="text-[14px] font-bold text-[hsl(var(--foreground))]">Tambah Jamaah ke Paket</DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">Data jamaah untuk paket ini</p>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          {/* Photo + OCR row */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => photoRef.current?.click()}
              className={cn("h-14 w-14 rounded-xl overflow-hidden flex items-center justify-center text-white font-bold text-xl shrink-0 transition-all", form.gender === "P" ? "bg-gradient-to-br from-pink-400 to-rose-500" : "bg-gradient-to-br from-blue-400 to-indigo-500")}>
              {photoDataUrl ? <img src={photoDataUrl} alt="Foto jamaah" className="h-full w-full object-cover" /> : (form.name.charAt(0).toUpperCase() || "?")}
            </button>
            <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/jpg" className="hidden" onChange={handlePhoto} />

            <div className="flex-1 rounded-xl border border-orange-200 bg-orange-50/60 px-3 py-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-[11.5px] font-semibold text-orange-800">Scan Paspor OCR</p>
                <p className="text-[10px] text-orange-700/80 leading-tight">Isi otomatis dari foto MRZ</p>
              </div>
              <input ref={ocrRef} type="file" accept="image/*" className="hidden" onChange={handleOcr} />
              <button type="button" onClick={() => ocrRef.current?.click()} disabled={ocrLoading}
                className="h-10 sm:h-7 min-w-[64px] px-3 rounded-lg text-[12px] sm:text-[11px] font-semibold border border-orange-200 bg-white text-orange-700 hover:bg-orange-50 active:bg-orange-100 transition-colors disabled:opacity-60 flex items-center gap-1.5 shrink-0 touch-manipulation">
                <ScanLine className="h-4 w-4 sm:h-3 sm:w-3" />
                {ocrLoading ? (ocrProgress < 35 ? "Memuat…" : `${ocrProgress}%`) : "Scan"}
              </button>
            </div>
          </div>

          {/* Nama */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Nama Lengkap *</label>
            <Input className="h-8 text-[12.5px] rounded-xl" value={form.name} placeholder="Nama sesuai paspor" onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} autoFocus />
          </div>

          {/* Gender + HP */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Kelamin</label>
              <Select value={form.gender} onValueChange={(value) => setForm((prev) => ({ ...prev, gender: value as "L" | "P" }))}>
                <SelectTrigger className="h-8 text-[12.5px] rounded-xl"><SelectValue placeholder="Pilih" /></SelectTrigger>
                <SelectContent style={{ background: "#fff" }}>
                  <SelectItem value="L">Laki-laki</SelectItem>
                  <SelectItem value="P">Perempuan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">No. HP</label>
              <Input className="h-8 text-[12.5px] rounded-xl" value={form.phone} placeholder="08xx" onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
            </div>
          </div>

          {/* Lahir + Paspor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tgl. Lahir</label>
              <Input className="h-8 text-[12.5px] rounded-xl" type="date" value={form.birthDate} onChange={(e) => setForm((prev) => ({ ...prev, birthDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">No. Paspor</label>
              <Input className="h-8 text-[12.5px] rounded-xl font-mono" value={form.passportNumber} placeholder="A1234567" onChange={(e) => setForm((prev) => ({ ...prev, passportNumber: e.target.value }))} />
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => { reset(); onClose(); }}
              className="flex-1 h-9 rounded-xl text-[12.5px] font-semibold bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--border))] transition-colors">
              Batal
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 h-9 rounded-xl text-[12.5px] font-bold text-white transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}>
              {saving ? "Menyimpan…" : "Tambah Jamaah"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function JamaahMiniCard({
  jamaah,
  onDelete,
  onOpen,
}: {
  jamaah: Jamaah;
  onDelete: (jamaah: Jamaah) => void;
  onOpen: (jamaah: Jamaah) => void;
}) {
  // Whole card is clickable utk buka detail drawer. Tombol delete (anak) pakai
  // stopPropagation supaya gak ikut nge-trigger open drawer pas user nge-klik.
  const status = jamaah.paymentStatus ?? "Belum Lunas";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(jamaah)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(jamaah);
        }
      }}
      className="rounded-xl border border-[hsl(var(--border))] bg-white p-2.5 flex items-center gap-2.5 cursor-pointer hover:border-[hsl(var(--primary))/0.4] hover:shadow-sm transition-all"
    >
      <div className={cn("h-10 w-10 rounded-xl overflow-hidden flex items-center justify-center text-white font-bold text-sm shrink-0", jamaah.gender === "P" ? "bg-gradient-to-br from-pink-400 to-rose-500" : "bg-gradient-to-br from-blue-400 to-indigo-500")}>
        {jamaah.photoDataUrl ? <img src={jamaah.photoDataUrl} alt={jamaah.name} className="h-full w-full object-cover" /> : jamaah.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[12.5px] font-semibold truncate flex-1 min-w-0" style={M}>{jamaah.name}</p>
          <PaymentStatusPill status={status} size="xs" />
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-muted-foreground">
          {jamaah.passportNumber && <span className="inline-flex items-center gap-0.5 font-mono"><FileKey className="h-2.5 w-2.5 shrink-0" />{jamaah.passportNumber}</span>}
          {jamaah.phone && <span className="inline-flex items-center gap-0.5"><CreditCard className="h-2.5 w-2.5 shrink-0" />{jamaah.phone}</span>}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(jamaah); }}
        className="h-7 w-7 rounded-lg hover:bg-red-50 hover:text-red-500 flex items-center justify-center text-muted-foreground transition-colors shrink-0"
        title="Hapus jamaah"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Sync Status Badge ─────────────────────────────────────────────────────────
// Pill kecil di header buat kasih tau user status sinkronisasi data kalkulator
// ke cloud. 4 state visual:
//   - synced     → hijau, icon Cloud           ("Tersinkron")
//   - syncing    → amber, Loader2 animated     ("Menyinkronkan…")
//   - local-only → slate, icon CloudOff        ("Hanya lokal")
//   - idle       → slate-300, icon Cloud muted ("Belum disimpan")
// Subscribe ke status via `usePackageCalcSyncStatus(packageId)`. Status
// di-update otomatis tiap kali `savePackageCalc` jalan atau pull cloud sukses.

const SYNC_STATUS_COPY: Record<
  PackageCalcSyncStatus,
  { label: string; title: string; classes: string; icon: typeof Cloud; spin?: boolean }
> = {
  synced: {
    label: "Tersinkron",
    title: "Data kalkulator udah aman di cloud",
    classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: Cloud,
  },
  syncing: {
    label: "Menyinkronkan…",
    title: "Lagi push ke cloud",
    classes: "bg-amber-50 text-amber-700 border-amber-200",
    icon: Loader2,
    spin: true,
  },
  "local-only": {
    label: "Hanya lokal",
    title: "Data cuma kesimpan di browser ini — cloud sync gagal/belum aktif",
    classes: "bg-slate-100 text-slate-600 border-slate-200",
    icon: CloudOff,
  },
  idle: {
    label: "Belum disimpan",
    title: "Belum ada perubahan yang di-sync",
    classes: "bg-slate-50 text-slate-500 border-slate-200",
    icon: Cloud,
  },
};

function SyncStatusBadge({ packageId }: { packageId: string | undefined }) {
  const status = usePackageCalcSyncStatus(packageId);
  const cfg = SYNC_STATUS_COPY[status];
  const Icon = cfg.icon;
  return (
    <span
      title={cfg.title}
      data-testid={`sync-badge-${status}`}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] md:text-[10px] font-semibold leading-none ${cfg.classes}`}
    >
      <Icon className={`h-2.5 w-2.5 md:h-3 md:w-3 ${cfg.spin ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">{cfg.label}</span>
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PackageDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { items, loading, update } = usePackages();
  const rates = useRatesStore((s) => s.rates);
  const { formatCurrency, formatDate } = useRegional();
  const { jamaah, loadingJamaah, fetchJamaah, removeJamaah } = useJamaahStore();
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") === "jamaah" ? "jamaah" : "calculator");
  const [deleteTarget, setDeleteTarget] = useState<Jamaah | null>(null);
  // Detail drawer — `detailJamaahId` jadi source-of-truth supaya drawer auto-refresh
  // saat data jamaah di-update di store (mis. abis save → form re-sync ke nilai baru).
  const [detailJamaahId, setDetailJamaahId] = useState<string | null>(null);
  const detailJamaah = useMemo(
    () => jamaah.find((j) => j.id === detailJamaahId) ?? null,
    [jamaah, detailJamaahId],
  );
  const [showSummary, setShowSummary] = useState(true);
  const [localRateSAR, setLocalRateSAR] = useState(0);
  const [localRateUSD, setLocalRateUSD] = useState(0);
  const pkg = items.find((item) => item.id === id);
  const [calc, setCalc] = useState<ProfessionalCalcState | null>(null);

  useEffect(() => {
    if (id) fetchJamaah(id);
  }, [id, fetchJamaah]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    setActiveTab(tab === "jamaah" ? "jamaah" : "calculator");
    if (searchParams.get("ocr") === "1") {
      setAddOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("ocr");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!id || !pkg) return;
    const fallback = makeDefault(Math.max(1, pkg.people), pkg.name, pkg.destination);
    setCalc(loadPackageCalc(id, fallback));
    if (isSupabaseConfigured()) {
      void pullPackageCalc(id).then((cloud) => {
        if (!cloud) {
          // Belum ada row di cloud (paket baru, atau pull error udah di-log
          // di pullPackageCalc). Biarin status tetep "idle" — bakal jadi
          // "synced" otomatis abis user save pertama kali.
          return;
        }
        // Validasi shape sebelum di-merge ke state. Cloud bisa balikin
        // payload aneh (object kosong, array, primitive) kalau ada bug
        // di sisi penulis — lebih baik log + skip drpd nge-corrupt UI.
        if (typeof cloud !== "object" || Array.isArray(cloud)) {
          console.warn(
            `[PackageDetail] cloud calc payload utk packageId=${id} format invalid ` +
            `(expected object, got ${Array.isArray(cloud) ? "array" : typeof cloud}):`,
            cloud,
          );
          return;
        }
        setCalc({ ...fallback, ...(cloud as Partial<ProfessionalCalcState>) });
        // Cloud berhasil di-pull & shape-nya valid → tandain "synced" supaya
        // badge di header langsung nyala hijau pas pertama buka halaman.
        setPackageCalcSyncStatus(id, "synced");
      });
    } else {
      // Supabase belum di-config → kasih tau badge bahwa data cuma di local.
      setPackageCalcSyncStatus(id, "local-only");
    }
  }, [id, pkg?.id]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!id || !calc) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      savePackageCalc(id, calc);
    }, 1500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [id, calc]);

  const effectiveRates = useMemo(() => ({
    ...rates,
    SAR: localRateSAR > 0 ? localRateSAR : (rates.SAR ?? 1),
    USD: localRateUSD > 0 ? localRateUSD : (rates.USD ?? 1),
  }), [localRateSAR, localRateUSD, rates]);

  const quote = useMemo(() => {
    if (!calc) return null;
    if (calc.mode === "umum") {
      return computeGeneralQuote({ pax: calc.pax, costs: calc.generalCosts, commissionFee: calc.commissionFee, marginPercent: calc.marginPercent, discount: calc.discount, rates: effectiveRates });
    }
    return computeProfessionalQuote({
      pax: calc.pax,
      hotels: calc.hotels,
      transports: calc.transports,
      tickets: calc.tickets ?? [],
      visas: calc.visas,
      destinations: calc.destinations,
      fnbs: calc.fnbs ?? [],
      staffs: calc.staffs,
      commissionFee: calc.commissionFee,
      marginPercent: calc.marginPercent,
      discount: calc.discount,
      rates: effectiveRates,
    });
  }, [calc, effectiveRates]);

  // ── State updaters ──────────────────────────────────────────────────────────

  const setField = <K extends keyof ProfessionalCalcState>(key: K, value: ProfessionalCalcState[K]) =>
    setCalc((prev) => prev ? { ...prev, [key]: value } : prev);

  function updateHotel(rowId: string, patch: Partial<HotelRow>) {
    setCalc((prev) => prev ? { ...prev, hotels: prev.hotels.map((h) => h.id === rowId ? { ...h, ...patch } : h) } : prev);
  }
  function addHotel() {
    setCalc((prev) => prev ? { ...prev, hotels: [...prev.hotels, { id: `h${Date.now()}`, label: "Hotel", days: 1, pricePerNight: 0, rooms: 1 }] } : prev);
  }
  function removeHotel(rowId: string) {
    setCalc((prev) => prev ? { ...prev, hotels: prev.hotels.filter((h) => h.id !== rowId) } : prev);
  }

  function updateTransport(rowId: string, patch: Partial<TransportRow>) {
    setCalc((prev) => prev ? { ...prev, transports: prev.transports.map((t) => t.id === rowId ? { ...t, ...patch } : t) } : prev);
  }
  function addTransport() {
    setCalc((prev) => prev ? { ...prev, transports: [...prev.transports, { id: `t${Date.now()}`, label: "Transport", fleet: 1, pricePerFleet: 0 }] } : prev);
  }
  function removeTransport(rowId: string) {
    setCalc((prev) => prev ? { ...prev, transports: prev.transports.filter((t) => t.id !== rowId) } : prev);
  }

  function updateTicket(rowId: string, patch: Partial<TicketRow>) {
    setCalc((prev) => prev ? { ...prev, tickets: prev.tickets.map((t) => t.id === rowId ? { ...t, ...patch } : t) } : prev);
  }
  function addTicket() {
    setCalc((prev) => prev ? { ...prev, tickets: [...prev.tickets, { id: `tk${Date.now()}`, label: "Rute Baru", flightType: "Return", pricePerPax: 0, currency: "IDR" as const }] } : prev);
  }
  function removeTicket(rowId: string) {
    setCalc((prev) => prev ? { ...prev, tickets: prev.tickets.filter((t) => t.id !== rowId) } : prev);
  }

  function updateVisa(rowId: string, patch: Partial<VisaRow>) {
    setCalc((prev) => prev ? { ...prev, visas: prev.visas.map((v) => v.id === rowId ? { ...v, ...patch } : v) } : prev);
  }
  function addVisa() {
    setCalc((prev) => prev ? { ...prev, visas: [...prev.visas, { id: `v${Date.now()}`, label: "Visa", pricePerPax: 0 }] } : prev);
  }
  function removeVisa(rowId: string) {
    setCalc((prev) => prev ? { ...prev, visas: prev.visas.filter((v) => v.id !== rowId) } : prev);
  }

  function updateFnB(rowId: string, patch: Partial<FnBRow>) {
    setCalc((prev) => prev ? { ...prev, fnbs: prev.fnbs.map((f) => f.id === rowId ? { ...f, ...patch } : f) } : prev);
  }
  function addFnB() {
    setCalc((prev) => prev ? { ...prev, fnbs: [...prev.fnbs, { id: `f${Date.now()}`, label: "F&B", pricePerPax: 0 }] } : prev);
  }
  function removeFnB(rowId: string) {
    setCalc((prev) => prev ? { ...prev, fnbs: prev.fnbs.filter((f) => f.id !== rowId) } : prev);
  }

  function updateDest(rowId: string, patch: Partial<DestinationRow>) {
    setCalc((prev) => prev ? { ...prev, destinations: prev.destinations.map((d) => d.id === rowId ? { ...d, ...patch } : d) } : prev);
  }
  function addDest() {
    setCalc((prev) => prev ? { ...prev, destinations: [...prev.destinations, { id: `d${Date.now()}`, label: "Destinasi", pricePerPax: 0 }] } : prev);
  }
  function removeDest(rowId: string) {
    setCalc((prev) => prev ? { ...prev, destinations: prev.destinations.filter((d) => d.id !== rowId) } : prev);
  }

  function updateStaff(rowId: string, patch: Partial<StaffRow>) {
    setCalc((prev) => prev ? { ...prev, staffs: prev.staffs.map((s) => s.id === rowId ? { ...s, ...patch } : s) } : prev);
  }
  function addStaff() {
    setCalc((prev) => prev ? { ...prev, staffs: [...prev.staffs, { id: `s${Date.now()}`, label: "Guide", numStaff: 1, totalCost: 0 }] } : prev);
  }
  function removeStaff(rowId: string) {
    setCalc((prev) => prev ? { ...prev, staffs: prev.staffs.filter((s) => s.id !== rowId) } : prev);
  }

  function updateGeneralCost(rowId: string, patch: Partial<GeneralCostRow>) {
    setCalc((prev) => prev ? { ...prev, generalCosts: prev.generalCosts.map((c) => c.id === rowId ? { ...c, ...patch } : c) } : prev);
  }
  function addGeneralCost() {
    setCalc((prev) => prev ? { ...prev, generalCosts: [...prev.generalCosts, { id: `g${Date.now()}`, category: "lainnya", label: "Biaya Tambahan", qty: 1, amount: 0, currency: "IDR" as CalcCurrency, unit: "pax" as CostUnit }] } : prev);
  }
  function removeGeneralCost(rowId: string) {
    setCalc((prev) => prev ? { ...prev, generalCosts: prev.generalCosts.filter((c) => c.id !== rowId) } : prev);
  }

  const syncToPackage = async () => {
    if (!id || !pkg || !calc || !quote) return;
    await update(id, {
      name: calc.packageName || pkg.name,
      destination: calc.destination || pkg.destination,
      people: calc.pax,
      totalIDR: quote.finalPrice,
      status: "Calculated",
    });
    toast.success("Kalkulasi berhasil disimpan ke paket.");
  };

  const handleDeleteJamaah = async () => {
    if (!deleteTarget) return;
    await removeJamaah(deleteTarget.id);
    toast.success(`Jamaah "${deleteTarget.name}" dihapus.`);
    setDeleteTarget(null);
  };

  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">Memuat detail paket…</div>;
  if (!pkg) return (
    <div className="py-20 text-center space-y-3">
      <p className="text-sm text-muted-foreground">Paket tidak ditemukan.</p>
      <Button variant="outline" onClick={() => navigate("/packages")}>Kembali ke Paket</Button>
    </div>
  );
  if (!calc) return <div className="py-12 text-center text-sm text-muted-foreground">Menyiapkan kalkulator paket…</div>;

  const sarRate = localRateSAR > 0 ? localRateSAR : (rates.SAR ?? 1);
  const usdRate = localRateUSD > 0 ? localRateUSD : (rates.USD ?? 1);
  const safePax = Math.max(1, calc.pax);

  return (
    <div className="space-y-3 md:space-y-5 max-w-5xl mx-auto" style={M}>

      {/* ── Header ── */}
      <div className="flex items-start gap-2 md:gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/packages")} className="rounded-xl shrink-0 h-8 w-8 md:h-10 md:w-10">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <span className="text-xl md:text-3xl">{pkg.emoji}</span>
            <h1 className="text-base md:text-2xl font-bold truncate" style={M}>
              {pkg.name}
              {(() => {
                const dep = pkg.departureDate;
                const ret = pkg.returnDate;
                if (!dep && !ret) return null;
                if (dep && ret) {
                  const startStr = formatDate(dep, "short");
                  const endStr = formatDate(ret, "short");
                  // Drop trailing year on the start date when both fall in the same year
                  // to produce a tidy range like "25 Apr - 03 Mei 2026".
                  const startYear = startStr.match(/\d{4}\s*$/)?.[0]?.trim();
                  const endYear = endStr.match(/\d{4}\s*$/)?.[0]?.trim();
                  const startTrim =
                    startYear && endYear && startYear === endYear
                      ? startStr.replace(/\s*\d{4}\s*$/, "")
                      : startStr;
                  return (
                    <span className="text-muted-foreground font-semibold"> — {startTrim} – {endStr}</span>
                  );
                }
                return (
                  <span className="text-muted-foreground font-semibold"> — {formatDate((dep ?? ret)!, "full")}</span>
                );
              })()}
            </h1>
            <Badge className={`${statusVariant[pkg.status]} border-0 text-[10px] px-1.5 py-0.5`}>{pkg.status}</Badge>
            <SyncStatusBadge packageId={id} />
          </div>
          <div className="mt-0.5 flex flex-wrap gap-2 md:gap-3 text-xs md:text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 md:h-3.5 md:w-3.5" />{pkg.destination}</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3 md:h-3.5 md:w-3.5" />{jamaah.length}/{pkg.people} pax</span>
            <span className="hidden sm:inline-flex items-center gap-1"><Calendar className="h-3 w-3 md:h-3.5 md:w-3.5" />{formatDate(pkg.updatedAt ?? "")}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {pkg.departureDate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-xl h-8 px-2.5 md:h-10 md:px-3 border-orange-200 text-orange-600 hover:bg-orange-50" title="Sinkron ke kalender">
                  <CalendarPlus className="h-3.5 w-3.5 md:mr-1" />
                  <span className="text-xs">Kalender</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[11px]">Sinkron ke Kalender</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    const url = buildGoogleCalendarUrl({
                      title: `${pkg.emoji ?? "✈️"} ${pkg.name}`,
                      description: `Paket Umrah/Haji IGH Tour\nDestinasi: ${pkg.destination}\nJamaah: ${jamaah.length}/${pkg.people} pax\nTotal: Rp ${pkg.totalIDR.toLocaleString("id-ID")}`,
                      location: pkg.destination,
                      startDate: pkg.departureDate!,
                      allDay: true,
                    });
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                  className="text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-2" />
                  Tambah ke Google Calendar
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    downloadICS(
                      {
                        title: `${pkg.emoji ?? "✈️"} ${pkg.name}`,
                        description: `Paket Umrah/Haji IGH Tour\nDestinasi: ${pkg.destination}\nJamaah: ${jamaah.length}/${pkg.people} pax`,
                        location: pkg.destination,
                        startDate: pkg.departureDate!,
                        allDay: true,
                      },
                      `${pkg.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`
                    );
                    toast.success("File .ics berhasil diunduh");
                  }}
                  className="text-xs"
                >
                  <Download className="h-3.5 w-3.5 mr-2" />
                  Unduh .ics (Apple/Outlook)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button onClick={() => setAddOpen(true)} size="sm" className="gradient-primary text-white rounded-xl shrink-0 h-8 px-3 text-xs md:h-10 md:px-4 md:text-sm">
            <Plus className="h-3.5 w-3.5 mr-1" /> Jamaah
          </Button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-3 gap-1.5 md:gap-3">
        <div className="rounded-xl md:rounded-2xl border bg-white px-2.5 py-2 md:p-4">
          <p className="text-[9.5px] md:text-xs text-muted-foreground leading-tight" style={M}>Total Paket</p>
          <p className="mt-0.5 text-[12px] md:text-xl font-bold text-orange-600 leading-tight tabular-nums" style={M}>{fmtCompactIDR(pkg.totalIDR)}</p>
        </div>
        <div className="rounded-xl md:rounded-2xl border bg-white px-2.5 py-2 md:p-4">
          <p className="text-[9.5px] md:text-xs text-muted-foreground leading-tight" style={M}>Per Jamaah</p>
          <p className="mt-0.5 text-[12px] md:text-xl font-bold leading-tight tabular-nums" style={M}>{fmtCompactIDR(pkg.people > 0 ? pkg.totalIDR / pkg.people : 0)}</p>
        </div>
        <div className="rounded-xl md:rounded-2xl border bg-white px-2.5 py-2 md:p-4">
          <p className="text-[9.5px] md:text-xs text-muted-foreground leading-tight" style={M}>Jamaah</p>
          <p className="mt-0.5 text-[12px] md:text-xl font-bold leading-tight" style={M}>{jamaah.length} <span className="text-muted-foreground font-medium">/ {pkg.people}</span></p>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSearchParams({ tab: v }, { replace: true }); }} className="space-y-3 md:space-y-4">
        <TabsList className="grid w-full grid-cols-2 rounded-xl h-9 md:h-10 md:rounded-2xl">
          <TabsTrigger value="calculator" className="rounded-lg md:rounded-xl text-xs md:text-sm" style={M}>
            <Calculator className="h-3.5 w-3.5 mr-1 md:mr-1.5" />Kalkulator
          </TabsTrigger>
          <TabsTrigger value="jamaah" className="rounded-lg md:rounded-xl text-xs md:text-sm" style={M}>
            <Users className="h-3.5 w-3.5 mr-1 md:mr-1.5" />Jamaah
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════════════
            KALKULATOR TAB
        ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="calculator" className="space-y-3 md:space-y-4">

          {/* ── Mode switcher + kurs strip (combined row on mobile) ── */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 rounded-xl border border-orange-200 bg-orange-50/50 flex-wrap">
              {([
                { mode: "umroh_private" as CalcMode, label: "🕌 Umroh Private" },
                { mode: "umroh_group"   as CalcMode, label: "👥 Umroh Group"   },
                { mode: "umum"          as CalcMode, label: "🗺️ Umum"          },
              ]).map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => setField("mode", mode)}
                  style={M}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-[10.5px] md:text-[11.5px] font-bold transition-all whitespace-nowrap",
                    calc.mode === mode
                      ? "bg-orange-500 text-white shadow-sm"
                      : "text-orange-600 hover:bg-orange-100"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(["SAR", "USD"] as const).map((cur) => {
                const storeVal = rates[cur] ?? 0;
                const localVal = cur === "SAR" ? localRateSAR : localRateUSD;
                const setLocal = cur === "SAR" ? setLocalRateSAR : setLocalRateUSD;
                const active = localVal > 0;
                return (
                  <div
                    key={cur}
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors ${active ? "bg-orange-50 border-orange-200" : "bg-slate-50 border-slate-200"}`}
                  >
                    <span style={M} className="text-[10px] font-bold text-slate-600 uppercase shrink-0">{cur}</span>
                    <span style={M} className="text-[10px] text-muted-foreground">=</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder={storeVal.toLocaleString("id-ID")}
                      value={localVal > 0 ? localVal.toLocaleString("id-ID") : ""}
                      onChange={(e) => {
                        const stripped = e.target.value.replace(/\./g, "").replace(/[^0-9]/g, "");
                        setLocal(stripped ? Number(stripped) : 0);
                      }}
                      style={M}
                      className="h-5 w-20 text-[10px] font-bold border-0 bg-transparent shadow-none p-0 focus:outline-none text-slate-800"
                    />
                    {active && (
                      <button
                        type="button"
                        onClick={() => setLocal(0)}
                        style={M}
                        className="text-[9px] text-orange-400 hover:text-orange-600 font-medium shrink-0 ml-0.5"
                      >↩</button>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center gap-1 rounded-lg bg-slate-50 border border-slate-200 px-2 py-1">
                <span style={M} className="text-[10px] font-bold text-slate-600 uppercase shrink-0">IDR</span>
                <span style={M} className="text-[10px] text-muted-foreground">=</span>
                <span style={M} className="text-[10px] font-bold text-slate-800 font-mono">1</span>
              </div>
            </div>
          </div>

          {/* ── Package Info ── */}
          <div className="rounded-xl border border-orange-200 bg-white p-3 md:p-4 space-y-2.5 md:space-y-3">
            <p style={M} className="text-[10px] font-extrabold uppercase tracking-wide text-orange-600">Info Paket</p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 md:gap-3">
              <div className="col-span-2 md:col-span-3 space-y-1">
                <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Nama Paket</label>
                <input
                  type="text"
                  value={calc.packageName}
                  onChange={(e) => setField("packageName", e.target.value)}
                  style={M}
                  className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
              </div>
              <div className="col-span-1 md:col-span-2 space-y-1">
                <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Destinasi</label>
                <input
                  type="text"
                  value={calc.destination}
                  onChange={(e) => setField("destination", e.target.value)}
                  style={M}
                  className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
              </div>
              <div className="col-span-1 md:col-span-1 space-y-1">
                <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Jumlah Pax</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={calc.pax > 0 ? calc.pax.toLocaleString("id-ID") : ""}
                    onChange={(e) => {
                      const stripped = e.target.value.replace(/\./g, "").replace(/[^0-9]/g, "");
                      setField("pax", Math.max(1, stripped ? Number(stripped) : 1));
                    }}
                    style={M}
                    className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2 text-[12px] text-right focus:outline-none focus:ring-1 focus:ring-orange-400"
                  />
                  <button
                    onClick={() => setField("pax", Math.max(1, jamaah.length))}
                    title="Pakai jumlah jamaah terdaftar"
                    style={M}
                    className="shrink-0 h-8 px-2 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-bold transition-colors"
                  >
                    ={jamaah.length}
                  </button>
                </div>
              </div>
              {/* Dual date row — Tanggal Berangkat + Tanggal Pulang.
                  Auto-computes pkg.days dari selisih hari (inklusif start),
                  dan langsung di-persist ke kolom departure_date / return_date
                  via update() (auto-sync). Validation: tanggal pulang ≥ berangkat. */}
              <div className="col-span-1 md:col-span-3 space-y-1">
                <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Tanggal Berangkat</label>
                <input
                  type="date"
                  value={pkg.departureDate ?? ""}
                  onChange={(e) => {
                    const dep = e.target.value || undefined;
                    let ret = pkg.returnDate;
                    // Validation: jika tanggal pulang lebih awal dari berangkat baru,
                    // kosongkan supaya user pilih ulang (hindari data error).
                    if (dep && ret && ret < dep) ret = undefined;
                    const patch: Partial<typeof pkg> = { departureDate: dep, returnDate: ret };
                    if (dep && ret) {
                      const ms = new Date(ret + "T00:00:00").getTime() - new Date(dep + "T00:00:00").getTime();
                      const diff = Math.round(ms / 86400000) + 1;
                      if (diff > 0) patch.days = diff;
                    }
                    update(id!, patch);
                  }}
                  style={M}
                  className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
              </div>
              <div className="col-span-1 md:col-span-3 space-y-1">
                <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">
                  Tanggal Pulang
                  {pkg.departureDate && pkg.returnDate && (
                    <span className="ml-1.5 text-[9px] text-orange-500 normal-case font-semibold">
                      · {Math.max(1, Math.round((new Date(pkg.returnDate + "T00:00:00").getTime() - new Date(pkg.departureDate + "T00:00:00").getTime()) / 86400000) + 1)} Hari
                    </span>
                  )}
                </label>
                <input
                  type="date"
                  value={pkg.returnDate ?? ""}
                  min={pkg.departureDate ?? undefined}
                  onChange={(e) => {
                    const ret = e.target.value || undefined;
                    // Guard: jika user pilih tanggal pulang lebih awal dari berangkat,
                    // tolak (browser min sudah cegah, tapi belt-and-suspenders).
                    if (ret && pkg.departureDate && ret < pkg.departureDate) {
                      toast.error("Tanggal pulang tidak boleh sebelum tanggal berangkat.");
                      return;
                    }
                    const patch: Partial<typeof pkg> = { returnDate: ret };
                    if (ret && pkg.departureDate) {
                      const ms = new Date(ret + "T00:00:00").getTime() - new Date(pkg.departureDate + "T00:00:00").getTime();
                      const diff = Math.round(ms / 86400000) + 1;
                      if (diff > 0) patch.days = diff;
                    }
                    update(id!, patch);
                  }}
                  disabled={!pkg.departureDate}
                  style={M}
                  className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400 disabled:bg-slate-50 disabled:text-muted-foreground disabled:cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* ══ MODE-SPECIFIC INPUT SECTION ══ */}
          {calc.mode !== "umum" && (<>

          {/* ── HOTEL TABLE ── */}
          <div className="overflow-hidden rounded-xl border border-orange-200">
            <SectionHeader icon={Hotel} title="Hotel" currency="SAR / USD" color="bg-blue-500" onAdd={addHotel} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Nama Hotel</Th>
                    <Th right>Hari</Th>
                    <Th right>Rate / Malam (Q · T · D)</Th>
                    <Th right>Kamar</Th>
                    <Th right>Total IDR</Th>
                    <Th right>Per Pax IDR</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {calc.hotels.map((h) => {
                    const cur = h.currency ?? "SAR";
                    const rate = cur === "SAR" ? sarRate : cur === "USD" ? usdRate : 1;
                    // Active rate respects per-room-type pricing when
                    // roomType is set (or supplement fallback); otherwise base.
                    const activeRate = h.roomType ? resolveRoomRate(h, h.roomType) : (h.pricePerNight ?? 0);
                    const foreignAmount = h.days * activeRate * h.rooms;
                    const totalIDR = foreignAmount * rate;
                    return (
                      <tr key={h.id} className="hover:bg-orange-50/30 transition-colors">
                        <Td><TextCell value={h.label} onChange={(v) => updateHotel(h.id, { label: v })} placeholder="Nama hotel" /></Td>
                        <Td right><NumCell value={h.days} onChange={(v) => updateHotel(h.id, { days: v })} /></Td>
                        <Td>
                          <HotelRatesCell hotel={h} onChange={(patch) => updateHotel(h.id, patch)} />
                        </Td>
                        <Td right><NumCell value={h.rooms} onChange={(v) => updateHotel(h.id, { rooms: v })} /></Td>
                        <Td right bold mono>{formatCurrency(totalIDR)}</Td>
                        <Td right muted mono>{formatCurrency(totalIDR / safePax)}</Td>
                        <td className="px-1 py-1.5 border-b border-orange-50"><DeleteBtn onClick={() => removeHotel(h.id)} /></td>
                      </tr>
                    );
                  })}
                  {quote && (
                    <SubtotalRow
                      label="SUBTOTAL HOTEL"
                      sarAmount={quote.breakdown.filter(b => b.category === "Hotel").reduce((s, b) => s + b.notesSAR, 0)}
                      usdAmount={quote.breakdown.filter(b => b.category === "Hotel").reduce((s, b) => s + b.notesUSD, 0)}
                      groupIDR={quote.hotelIDR}
                      perPaxIDR={quote.hotelIDR / safePax}
                      formatCurrency={formatCurrency}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── TRANSPORT TABLE ── */}
          <div className="overflow-hidden rounded-xl border border-orange-200">
            <SectionHeader icon={Bus} title="Transportasi" currency="SAR / USD" color="bg-blue-600" onAdd={addTransport} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Jenis</Th>
                    <Th>Rute</Th>
                    <Th right>Jumlah</Th>
                    <Th right>Harga</Th>
                    <Th right>Total Asing</Th>
                    <Th right>Total IDR (Grup)</Th>
                    <Th right>Per Pax IDR</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {calc.transports.map((t) => {
                    const cur = t.currency ?? "SAR";
                    const rate = cur === "SAR" ? sarRate : cur === "USD" ? usdRate : 1;
                    const foreignAmount = t.fleet * t.pricePerFleet;
                    const totalIDR = foreignAmount * rate;
                    return (
                      <tr key={t.id} className="hover:bg-orange-50/30 transition-colors">
                        <Td><TextCell value={t.label} onChange={(v) => updateTransport(t.id, { label: v })} placeholder="cth: Hiace" suggestions={TRANSPORT_TYPES} listId="dl-transport-types-pkg" /></Td>
                        <Td><TextCell value={t.route ?? ""} onChange={(v) => updateTransport(t.id, { route: v })} placeholder="cth: JED-MED" suggestions={ROUTE_OPTIONS} listId="dl-routes-pkg" /></Td>
                        <Td right><NumCell value={t.fleet} onChange={(v) => updateTransport(t.id, { fleet: v })} /></Td>
                        <Td right>
                          <div className="flex items-center gap-1">
                            <NumCell value={t.pricePerFleet} onChange={(v) => updateTransport(t.id, { pricePerFleet: v })} />
                            <RowCurrencyToggle value={cur} onChange={(v) => updateTransport(t.id, { currency: v })} />
                          </div>
                        </Td>
                        <Td right muted mono>{cur === "SAR" ? fmtSAR(foreignAmount) : fmtUSD(foreignAmount)}</Td>
                        <Td right bold mono>{formatCurrency(totalIDR)}</Td>
                        <Td right muted mono>{formatCurrency(totalIDR / safePax)}</Td>
                        <td className="px-1 py-1.5 border-b border-orange-50"><DeleteBtn onClick={() => removeTransport(t.id)} /></td>
                      </tr>
                    );
                  })}
                  {quote && (
                    <SubtotalRow
                      label="SUBTOTAL TRANSPORT"
                      sarAmount={quote.breakdown.filter(b => b.category === "Transport").reduce((s, b) => s + b.notesSAR, 0)}
                      usdAmount={quote.breakdown.filter(b => b.category === "Transport").reduce((s, b) => s + b.notesUSD, 0)}
                      groupIDR={quote.transportIDR}
                      perPaxIDR={quote.transportIDR / safePax}
                      formatCurrency={formatCurrency}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── AIRLINE TICKET TABLE ── */}
          <div className="overflow-hidden rounded-xl border border-orange-200">
            <SectionHeader icon={Globe} title="Tiket Pesawat" currency="IDR / USD" color="bg-sky-500" onAdd={addTicket} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Rute</Th>
                    <Th>Jenis</Th>
                    <Th right>Harga/Pax</Th>
                    <Th>Mata Uang</Th>
                    <Th right>Total Grup (IDR)</Th>
                    <Th right>Per Pax (IDR)</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {(calc.tickets ?? []).map((tk) => {
                    const totalIDR = tk.currency === "SAR"
                      ? tk.pricePerPax * safePax * sarRate
                      : tk.currency === "USD"
                      ? tk.pricePerPax * safePax * usdRate
                      : tk.pricePerPax * safePax;
                    return (
                      <tr key={tk.id} className="hover:bg-orange-50/30 transition-colors">
                        <Td><TextCell value={tk.label} onChange={(v) => updateTicket(tk.id, { label: v })} placeholder="cth: SUB - JED" /></Td>
                        <Td>
                          <select
                            value={tk.flightType}
                            onChange={(e) => updateTicket(tk.id, { flightType: e.target.value })}
                            style={M}
                            className="h-7 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400 w-full"
                          >
                            <option value="Return">Return</option>
                            <option value="One Way">One Way</option>
                          </select>
                        </Td>
                        <Td right><NumCell value={tk.pricePerPax} onChange={(v) => updateTicket(tk.id, { pricePerPax: v })} /></Td>
                        <Td>
                          <RowCurrencyToggle value={tk.currency} onChange={(v) => updateTicket(tk.id, { currency: v })} />
                        </Td>
                        <Td right bold mono>{formatCurrency(totalIDR)}</Td>
                        <Td right muted mono>{formatCurrency(totalIDR / safePax)}</Td>
                        <td className="px-1 py-1.5 border-b border-orange-50"><DeleteBtn onClick={() => removeTicket(tk.id)} /></td>
                      </tr>
                    );
                  })}
                  {quote && (
                    <tr className="bg-orange-50/50">
                      <td colSpan={4} style={M} className="px-2.5 py-2 text-[11px] font-extrabold text-orange-700 uppercase tracking-wider border-t-2 border-orange-200">SUBTOTAL TIKET</td>
                      <td style={M} className="px-2.5 py-2 text-[11px] font-bold text-right text-orange-700 border-t-2 border-orange-200 font-mono">{formatCurrency(quote.ticketIDR)}</td>
                      <td style={M} className="px-2.5 py-2 text-[11px] font-bold text-right text-orange-600 border-t-2 border-orange-200 font-mono">{formatCurrency(quote.ticketIDR / safePax)}</td>
                      <td className="border-t-2 border-orange-200" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── VISA TABLE ── */}
          <div className="overflow-hidden rounded-xl border border-orange-200">
            <SectionHeader icon={Globe} title="Visa" currency="SAR / USD" color="bg-violet-500" onAdd={addVisa} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Jenis Visa</Th>
                    <Th right>Harga/Pax</Th>
                    <Th right>Pax</Th>
                    <Th right>Total Asing</Th>
                    <Th right>Total IDR (Grup)</Th>
                    <Th right>Per Pax IDR</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {calc.visas.map((v) => {
                    const cur = v.currency ?? "USD";
                    const rate = cur === "SAR" ? sarRate : cur === "USD" ? usdRate : 1;
                    const foreignAmount = v.pricePerPax * safePax;
                    const totalIDR = foreignAmount * rate;
                    return (
                      <tr key={v.id} className="hover:bg-orange-50/30 transition-colors">
                        <Td><TextCell value={v.label} onChange={(val) => updateVisa(v.id, { label: val })} placeholder="cth: Visa Umroh" /></Td>
                        <Td right>
                          <div className="flex items-center gap-1">
                            <NumCell value={v.pricePerPax} onChange={(val) => updateVisa(v.id, { pricePerPax: val })} />
                            <RowCurrencyToggle value={cur} onChange={(val) => updateVisa(v.id, { currency: val })} />
                          </div>
                        </Td>
                        <Td right muted>{safePax}</Td>
                        <Td right muted mono>{cur === "SAR" ? fmtSAR(foreignAmount) : fmtUSD(foreignAmount)}</Td>
                        <Td right bold mono>{formatCurrency(totalIDR)}</Td>
                        <Td right muted mono>{formatCurrency(totalIDR / safePax)}</Td>
                        <td className="px-1 py-1.5 border-b border-orange-50"><DeleteBtn onClick={() => removeVisa(v.id)} /></td>
                      </tr>
                    );
                  })}
                  {quote && (
                    <SubtotalRow
                      label="SUBTOTAL VISA"
                      sarAmount={quote.breakdown.filter(b => b.category === "Visa").reduce((s, b) => s + b.notesSAR, 0)}
                      usdAmount={quote.breakdown.filter(b => b.category === "Visa").reduce((s, b) => s + b.notesUSD, 0)}
                      groupIDR={quote.visaIDR}
                      perPaxIDR={quote.visaIDR / safePax}
                      formatCurrency={formatCurrency}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── DESTINATION & F&B TABLE ── */}
          <div className="overflow-hidden rounded-xl border border-orange-200">
            <SectionHeader icon={Globe} title="Destinasi" currency="SAR / USD" color="bg-emerald-500" onAdd={addDest} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Keterangan</Th>
                    <Th right>Harga/Pax</Th>
                    <Th right>Pax</Th>
                    <Th right>Total Asing</Th>
                    <Th right>Total IDR (Grup)</Th>
                    <Th right>Per Pax IDR</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {calc.destinations.map((d) => {
                    const cur = d.currency ?? "SAR";
                    const rate = cur === "SAR" ? sarRate : cur === "USD" ? usdRate : 1;
                    const foreignAmount = d.pricePerPax * safePax;
                    const totalIDR = foreignAmount * rate;
                    return (
                      <tr key={d.id} className="hover:bg-orange-50/30 transition-colors">
                        <Td><TextCell value={d.label} onChange={(v) => updateDest(d.id, { label: v })} placeholder="cth: City Tour" /></Td>
                        <Td right>
                          <div className="flex items-center gap-1">
                            <NumCell value={d.pricePerPax} onChange={(v) => updateDest(d.id, { pricePerPax: v })} />
                            <RowCurrencyToggle value={cur} onChange={(v) => updateDest(d.id, { currency: v })} />
                          </div>
                        </Td>
                        <Td right muted>{safePax}</Td>
                        <Td right muted mono>{cur === "SAR" ? fmtSAR(foreignAmount) : fmtUSD(foreignAmount)}</Td>
                        <Td right bold mono>{formatCurrency(totalIDR)}</Td>
                        <Td right muted mono>{formatCurrency(totalIDR / safePax)}</Td>
                        <td className="px-1 py-1.5 border-b border-orange-50"><DeleteBtn onClick={() => removeDest(d.id)} /></td>
                      </tr>
                    );
                  })}
                  {quote && (
                    <SubtotalRow
                      label="SUBTOTAL DESTINASI"
                      sarAmount={quote.breakdown.filter(b => b.category === "Destinasi").reduce((s, b) => s + b.notesSAR, 0)}
                      usdAmount={quote.breakdown.filter(b => b.category === "Destinasi").reduce((s, b) => s + b.notesUSD, 0)}
                      groupIDR={quote.destinationIDR}
                      perPaxIDR={quote.destinationIDR / safePax}
                      formatCurrency={formatCurrency}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── F&B TABLE ── */}
          <div className="overflow-hidden rounded-xl border border-orange-200">
            <SectionHeader icon={Globe} title="F&B (Konsumsi / Zam-zam)" currency="SAR / USD" color="bg-teal-500" onAdd={addFnB} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Jenis Konsumsi</Th>
                    <Th right>Harga/Pax</Th>
                    <Th right>Pax</Th>
                    <Th right>Total Asing</Th>
                    <Th right>Total IDR (Grup)</Th>
                    <Th right>Per Pax IDR</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {(calc.fnbs ?? []).map((f) => {
                    const cur = f.currency ?? "SAR";
                    const rate = cur === "SAR" ? sarRate : cur === "USD" ? usdRate : 1;
                    const foreignAmount = f.pricePerPax * safePax;
                    const totalIDR = foreignAmount * rate;
                    return (
                      <tr key={f.id} className="hover:bg-orange-50/30 transition-colors">
                        <Td><TextCell value={f.label} onChange={(v) => updateFnB(f.id, { label: v })} placeholder="cth: Zam-zam" /></Td>
                        <Td right>
                          <div className="flex items-center gap-1">
                            <NumCell value={f.pricePerPax} onChange={(v) => updateFnB(f.id, { pricePerPax: v })} />
                            <RowCurrencyToggle value={cur} onChange={(v) => updateFnB(f.id, { currency: v })} />
                          </div>
                        </Td>
                        <Td right muted>{safePax}</Td>
                        <Td right muted mono>{cur === "SAR" ? fmtSAR(foreignAmount) : fmtUSD(foreignAmount)}</Td>
                        <Td right bold mono>{formatCurrency(totalIDR)}</Td>
                        <Td right muted mono>{formatCurrency(totalIDR / safePax)}</Td>
                        <td className="px-1 py-1.5 border-b border-orange-50"><DeleteBtn onClick={() => removeFnB(f.id)} /></td>
                      </tr>
                    );
                  })}
                  {quote && (
                    <SubtotalRow
                      label="SUBTOTAL F&B"
                      sarAmount={quote.breakdown.filter(b => b.category === "F&B").reduce((s, b) => s + b.notesSAR, 0)}
                      usdAmount={quote.breakdown.filter(b => b.category === "F&B").reduce((s, b) => s + b.notesUSD, 0)}
                      groupIDR={quote.fnbIDR}
                      perPaxIDR={quote.fnbIDR / safePax}
                      formatCurrency={formatCurrency}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── STAFF TABLE ── */}
          <div className="overflow-hidden rounded-xl border border-orange-200">
            <SectionHeader icon={UserCheck} title="Cost for Staff" currency="SAR / USD" color="bg-orange-500" onAdd={addStaff} />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Jabatan / Nama</Th>
                    <Th right>Jml Staff</Th>
                    <Th right>Total Biaya</Th>
                    <Th right>Per Pax Asing</Th>
                    <Th right>Total IDR (Grup)</Th>
                    <Th right>Per Pax IDR</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody>
                  {calc.staffs.map((s) => {
                    const cur = s.currency ?? "SAR";
                    const rate = cur === "SAR" ? sarRate : cur === "USD" ? usdRate : 1;
                    const count = Math.max(1, (s as StaffRow).numStaff ?? 1);
                    const totalForeign = s.totalCost * count;
                    const totalIDR = totalForeign * rate;
                    const perPaxForeign = totalForeign / safePax;
                    return (
                      <tr key={s.id} className="hover:bg-orange-50/30 transition-colors">
                        <Td><TextCell value={s.label} onChange={(v) => updateStaff(s.id, { label: v })} placeholder="cth: Muthowif" /></Td>
                        <Td right><NumCell value={(s as StaffRow).numStaff ?? 1} onChange={(v) => updateStaff(s.id, { numStaff: v })} /></Td>
                        <Td right>
                          <div className="flex items-center gap-1">
                            <NumCell value={s.totalCost} onChange={(v) => updateStaff(s.id, { totalCost: v })} />
                            <RowCurrencyToggle value={cur} onChange={(v) => updateStaff(s.id, { currency: v })} />
                          </div>
                        </Td>
                        <Td right muted mono>{cur === "SAR" ? fmtSAR(perPaxForeign) : fmtUSD(perPaxForeign)}</Td>
                        <Td right bold mono>{formatCurrency(totalIDR)}</Td>
                        <Td right muted mono>{formatCurrency(totalIDR / safePax)}</Td>
                        <td className="px-1 py-1.5 border-b border-orange-50"><DeleteBtn onClick={() => removeStaff(s.id)} /></td>
                      </tr>
                    );
                  })}
                  {quote && (
                    <SubtotalRow
                      label="SUBTOTAL STAFF"
                      sarAmount={quote.breakdown.filter(b => b.category === "Staff").reduce((s, b) => s + b.notesSAR, 0)}
                      usdAmount={quote.breakdown.filter(b => b.category === "Staff").reduce((s, b) => s + b.notesUSD, 0)}
                      groupIDR={quote.staffIDR}
                      perPaxIDR={quote.staffIDR / safePax}
                      formatCurrency={formatCurrency}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>

          </>)}

          {/* ── UMUM MODE TABLE ── */}
          {calc.mode === "umum" && (
            <div className="overflow-hidden rounded-xl border border-orange-200">
              <div className="flex items-center justify-between px-3 py-2.5 rounded-t-xl border border-b-0 border-orange-200" style={{ background: "linear-gradient(135deg,#fff7ed,#ffedd5)" }}>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-orange-500" strokeWidth={2} />
                  <span style={M} className="text-[12px] font-bold text-orange-800">Rincian Biaya</span>
                  <span style={M} className="text-[10px] font-semibold text-orange-500 bg-orange-100 px-1.5 py-0.5 rounded">IDR / SAR / USD</span>
                </div>
                <button onClick={addGeneralCost} style={M} className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-white border border-orange-200 hover:bg-orange-50 rounded-lg px-2 py-1 transition-colors">
                  <Plus className="h-3 w-3" /> Tambah Baris
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <Th>Kategori</Th>
                      <Th>Keterangan</Th>
                      <Th right>Harga Satuan</Th>
                      <Th right>Qty</Th>
                      <Th>Kurs</Th>
                      <Th>Basis</Th>
                      <Th right>Total Grup</Th>
                      <Th right>Per Pax</Th>
                      <Th> </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.generalCosts.map((c) => {
                      const rowQty = c.qty ?? 1;
                      const multiplier = (c.unit === "pax" ? safePax : 1) * rowQty;
                      const groupIDR = c.currency === "IDR" ? c.amount * multiplier : c.currency === "SAR" ? c.amount * multiplier * sarRate : c.amount * multiplier * usdRate;
                      return (
                        <tr key={c.id} className="hover:bg-orange-50/30 transition-colors">
                          <Td>
                            <select value={c.category ?? ""} onChange={(e) => updateGeneralCost(c.id, { category: e.target.value })} style={M}
                              className="h-7 w-28 rounded-md border border-orange-200 bg-white px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-orange-400">
                              {CATS.map((cat) => <option key={cat.value} value={cat.value}>{cat.emoji} {cat.label}</option>)}
                            </select>
                          </Td>
                          <Td><TextCell value={c.label} onChange={(v) => updateGeneralCost(c.id, { label: v })} placeholder="cth: Hotel Makkah" /></Td>
                          <Td right><NumCell value={c.amount} onChange={(v) => updateGeneralCost(c.id, { amount: v })} /></Td>
                          <Td right><NumCell value={rowQty} onChange={(v) => updateGeneralCost(c.id, { qty: Math.max(1, v) })} /></Td>
                          <Td><RowCurrencyToggle value={c.currency} onChange={(v) => updateGeneralCost(c.id, { currency: v })} /></Td>
                          <Td><UnitToggle value={c.unit} onChange={(v) => updateGeneralCost(c.id, { unit: v })} /></Td>
                          <Td right bold mono>
                            <div>{formatCurrency(groupIDR)}</div>
                            {c.amount > 0 && <div style={M} className="text-[9px] text-slate-400 font-normal">{c.amount.toLocaleString("id-ID")}{c.currency !== "IDR" ? ` ${c.currency}` : ""} × {rowQty}{c.unit === "pax" ? ` × ${safePax}p` : " (fix)"}</div>}
                          </Td>
                          <Td right muted mono>{formatCurrency(groupIDR / safePax)}</Td>
                          <td className="px-1 py-1.5 border-b border-orange-50"><DeleteBtn onClick={() => removeGeneralCost(c.id)} /></td>
                        </tr>
                      );
                    })}
                    {quote && calc.generalCosts.length > 0 && (
                      <tr className="bg-orange-50/50">
                        <td colSpan={6} style={M} className="px-2.5 py-2 text-[11px] font-extrabold text-orange-700 uppercase tracking-wider border-t-2 border-orange-200">TOTAL BIAYA</td>
                        <td style={M} className="px-2.5 py-2 text-[11px] font-bold text-right text-orange-700 border-t-2 border-orange-200 font-mono">{formatCurrency(quote.hpp)}</td>
                        <td style={M} className="px-2.5 py-2 text-[11px] font-bold text-right text-orange-600 border-t-2 border-orange-200 font-mono">{formatCurrency(quote.hpp / safePax)}</td>
                        <td className="border-t-2 border-orange-200" />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── FINANCIAL PARAMETERS ── */}
          <div className="rounded-xl border border-orange-200 bg-white overflow-hidden">
            <div className="px-3 md:px-4 py-2.5 md:py-3 border-b border-orange-100 bg-orange-50/60">
              <p style={M} className="text-[10px] font-extrabold uppercase tracking-wide text-orange-700 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Parameter Finansial
              </p>
            </div>
            <div className="p-3 md:p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
              <div className="space-y-2">
                <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">
                  Commission Fee Admin (IDR Tetap)
                </label>
                <NumCell value={calc.commissionFee} onChange={(v) => setField("commissionFee", v)} placeholder="0" />
                <p style={M} className="text-[10px] text-muted-foreground">Nominal IDR tambahan di atas HPP</p>
              </div>
              <div className="space-y-2">
                <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">
                  Acceptable Profit / Margin ({calc.marginPercent}%)
                </label>
                <Slider
                  value={[calc.marginPercent]}
                  min={0} max={50} step={1}
                  onValueChange={(v) => setField("marginPercent", v[0])}
                />
                <div className="flex justify-between text-[10px] text-orange-400 font-medium">
                  <span>0%</span><span>25%</span><span>50%</span>
                </div>
              </div>
              <div className="space-y-2">
                <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">
                  Discount (IDR dikurangkan)
                </label>
                <NumCell value={calc.discount} onChange={(v) => setField("discount", v)} placeholder="0" />
                <p style={M} className="text-[10px] text-muted-foreground">Mengurangi Selling Price akhir</p>
              </div>
            </div>
          </div>

          {/* ── GROUP MATRIX OUTPUT (only in umroh_group mode) ── */}
          {calc.mode === "umroh_group" && (
            <GroupMatrixSection
              settings={calc.groupSettings}
              onChange={(next) => setField("groupSettings", next)}
              inputs={{
                hotels: calc.hotels,
                transports: calc.transports,
                tickets: calc.tickets,
                visas: calc.visas,
                destinations: calc.destinations,
                fnbs: calc.fnbs,
                staffs: calc.staffs,
                commissionFee: calc.commissionFee,
                marginPercent: calc.marginPercent,
                discount: calc.discount,
              }}
              rates={effectiveRates}
            />
          )}

          {/* ── SUMMARY OUTPUT TABLE (private + umum modes) ── */}
          {quote && calc.mode !== "umroh_group" && (
            <div className="rounded-xl border-2 border-orange-300 bg-white overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-3 md:px-5 py-3 md:py-4 bg-gradient-to-r from-orange-600 to-orange-500 text-white"
                onClick={() => setShowSummary((v) => !v)}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  <span style={M} className="font-extrabold text-[12px] md:text-[14px] uppercase tracking-wide">Ringkasan Kalkulasi</span>
                </div>
                {showSummary ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {showSummary && (
                <div className="p-3 md:p-4 space-y-3 md:space-y-4">

                  {/* Main summary table */}
                  <div className="overflow-x-auto rounded-xl border border-orange-200">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr style={{ background: "linear-gradient(135deg,#fff7ed,#ffedd5)" }}>
                          <Th>Komponen</Th>
                          <Th right>Total Grup (IDR)</Th>
                          <Th right>Per Pax (IDR)</Th>
                          <Th right>Referensi (SAR)</Th>
                          <Th right>Referensi (USD)</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {(calc.mode === "umum"
                          ? quote.breakdown.map((b) => ({ label: b.label, idr: b.groupIDR, sar: b.notesSAR, usd: b.notesUSD }))
                          : [
                              { label: "🏨 Hotel / Penginapan", idr: quote.hotelIDR, sar: quote.breakdown.filter(b => b.category === "Hotel").reduce((s, b) => s + b.notesSAR, 0), usd: 0 },
                              { label: "🚌 Transportasi", idr: quote.transportIDR, sar: quote.breakdown.filter(b => b.category === "Transport").reduce((s, b) => s + b.notesSAR, 0), usd: 0 },
                              { label: "✈️ Tiket Pesawat", idr: quote.ticketIDR, sar: 0, usd: quote.breakdown.filter(b => b.category === "Tiket").reduce((s, b) => s + b.notesUSD, 0) },
                              { label: "🛂 Visa", idr: quote.visaIDR, sar: 0, usd: quote.breakdown.filter(b => b.category === "Visa").reduce((s, b) => s + b.notesUSD, 0) },
                              { label: "🗺️ Destinasi", idr: quote.destinationIDR, sar: quote.breakdown.filter(b => b.category === "Destinasi").reduce((s, b) => s + b.notesSAR, 0), usd: 0 },
                              { label: "🍽️ F&B / Konsumsi", idr: quote.fnbIDR, sar: quote.breakdown.filter(b => b.category === "F&B").reduce((s, b) => s + b.notesSAR, 0), usd: 0 },
                              { label: "👤 Staff / Guide", idr: quote.staffIDR, sar: quote.breakdown.filter(b => b.category === "Staff").reduce((s, b) => s + b.notesSAR, 0), usd: 0 },
                            ]
                        ).filter(r => r.idr > 0).map((r) => (
                          <tr key={r.label} className="hover:bg-orange-50/20">
                            <td style={M} className="px-3 py-2 text-[12px] border-b border-orange-50">{r.label}</td>
                            <td style={M} className="px-3 py-2 text-[12px] font-semibold text-right border-b border-orange-50 font-mono">{formatCurrency(r.idr)}</td>
                            <td style={M} className="px-3 py-2 text-[12px] text-right text-muted-foreground border-b border-orange-50 font-mono">{formatCurrency(r.idr / safePax)}</td>
                            <td style={M} className="px-3 py-2 text-[11px] text-right text-slate-600 border-b border-orange-50 font-mono">{r.sar > 0 ? fmtSAR(r.sar) : "—"}</td>
                            <td style={M} className="px-3 py-2 text-[11px] text-right text-slate-600 border-b border-orange-50 font-mono">{r.usd > 0 ? fmtUSD(r.usd) : "—"}</td>
                          </tr>
                        ))}

                        {/* HPP row */}
                        <tr style={{ background: "#fff7ed" }}>
                          <td style={M} className="px-3 py-2.5 text-[12px] font-extrabold text-orange-800 border-t-2 border-orange-300">
                            💰 TOTAL BUDGET (HPP)
                          </td>
                          <td style={M} className="px-3 py-2.5 text-[13px] font-extrabold text-orange-800 text-right border-t-2 border-orange-300 font-mono">{formatCurrency(quote.hpp)}</td>
                          <td style={M} className="px-3 py-2.5 text-[12px] font-bold text-orange-700 text-right border-t-2 border-orange-300 font-mono">{formatCurrency(quote.hpp / safePax)}</td>
                          <td style={M} className="px-3 py-2.5 text-[11px] text-slate-600 text-right border-t-2 border-orange-300 font-mono">{fmtSAR(quote.totalSAR)}</td>
                          <td style={M} className="px-3 py-2.5 text-[11px] text-slate-600 text-right border-t-2 border-orange-300 font-mono">{fmtUSD(quote.totalUSD)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Selling price breakdown */}
                  <div className="grid sm:grid-cols-2 gap-4">

                    {/* Left: price build-up */}
                    <div className="rounded-xl border border-orange-200 overflow-hidden">
                      <div className="px-4 py-2.5 bg-orange-50 border-b border-orange-200">
                        <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700">Pembentukan Harga Jual</p>
                      </div>
                      <div className="p-3 space-y-2">
                        {[
                          { label: "Total Budget (HPP)", value: quote.hpp, sub: `${formatCurrency(quote.hpp / safePax)}/pax`, color: "" },
                          { label: `+ Commission Fee Admin`, value: quote.commissionFee, sub: `${formatCurrency(quote.commissionFee / safePax)}/pax`, color: "text-amber-600" },
                          { label: `+ Profit Margin (${calc.marginPercent}%)`, value: quote.marginIDR, sub: `${formatCurrency(quote.marginIDR / safePax)}/pax`, color: "text-emerald-600" },
                        ].map((r) => (
                          <div key={r.label} className="flex items-center justify-between gap-2">
                            <div>
                              <p style={M} className={`text-[11px] font-semibold ${r.color || "text-[hsl(var(--foreground))]"}`}>{r.label}</p>
                              <p style={M} className="text-[10px] text-muted-foreground">{r.sub}</p>
                            </div>
                            <p style={M} className={`text-[12px] font-bold font-mono text-right ${r.color}`}>{formatCurrency(r.value)}</p>
                          </div>
                        ))}
                        <div className="border-t border-orange-200 pt-2 flex items-center justify-between">
                          <div>
                            <p style={M} className="text-[11px] font-bold text-orange-800">= Selling Price</p>
                            <p style={M} className="text-[10px] text-muted-foreground">{formatCurrency(quote.sellingPrice / safePax)}/pax</p>
                          </div>
                          <p style={M} className="text-[13px] font-extrabold text-orange-700 font-mono">{formatCurrency(quote.sellingPrice)}</p>
                        </div>
                        {calc.discount > 0 && (
                          <div className="flex items-center justify-between">
                            <p style={M} className="text-[11px] font-semibold text-red-600">- Discount</p>
                            <p style={M} className="text-[12px] font-bold text-red-600 font-mono">- {formatCurrency(quote.discount)}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: final price & net profit */}
                    <div className="space-y-3">
                      <div
                        className="rounded-xl p-4 text-white relative overflow-hidden"
                        style={{ background: "linear-gradient(135deg,#ea580c,#f97316 60%,#fb923c)" }}
                      >
                        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 90% 10%,white 0%,transparent 55%)" }} />
                        <div className="relative">
                          <p style={M} className="text-[10px] font-bold uppercase tracking-wide opacity-75">Harga Jual Final</p>
                          <p style={M} className="text-xl md:text-2xl font-extrabold mt-1 font-mono">{formatCurrency(quote.finalPrice)}</p>
                          <div className="mt-2.5 pt-2.5 border-t border-white/20 grid grid-cols-2 gap-2">
                            <div>
                              <p style={M} className="text-[10px] opacity-70">Per Pax ({safePax} pax)</p>
                              <p style={M} className="text-sm md:text-base font-bold font-mono">{formatCurrency(quote.perPaxFinal)}</p>
                            </div>
                            <div>
                              <p style={M} className="text-[10px] opacity-70">HPP per Pax</p>
                              <p style={M} className="text-sm md:text-base font-bold font-mono">{formatCurrency(quote.hpp / safePax)}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Net profit card */}
                      <div className={cn(
                        "rounded-xl border p-3 md:p-4",
                        quote.netProfit >= 0
                          ? "bg-emerald-50 border-emerald-200"
                          : "bg-red-50 border-red-200"
                      )}>
                        <p style={M} className={`text-[10px] font-extrabold uppercase tracking-wider ${quote.netProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                          Net Profit
                        </p>
                        <p style={M} className={`text-lg md:text-xl font-extrabold font-mono mt-0.5 ${quote.netProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {quote.netProfit >= 0 ? "+" : ""}{formatCurrency(quote.netProfit)}
                        </p>
                        <p style={M} className="text-[10px] text-muted-foreground mt-0.5">
                          {formatCurrency(quote.netProfit / safePax)}/pax
                          {quote.netProfit < 0 && " ⚠️ di bawah modal!"}
                        </p>
                      </div>

                      <Button onClick={syncToPackage} className="w-full h-9 md:h-11 rounded-xl gradient-primary text-white text-sm" style={M}>
                        <Save className="h-3.5 w-3.5 mr-1.5" /> Simpan ke Paket
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════════
            JAMAAH TAB
        ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="jamaah" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-[13px]" style={M}>Jamaah Paket</h2>
              <p className="text-[11px] text-muted-foreground leading-tight">{jamaah.length}/{pkg.people} terdaftar</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setAddOpen(true)}
                className="h-8 px-2.5 rounded-xl text-[11.5px] font-semibold border border-[hsl(var(--border))] bg-white text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] flex items-center gap-1 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Satu
              </button>
              <button onClick={() => setBulkOpen(true)}
                className="h-8 px-2.5 rounded-xl text-[11.5px] font-bold text-white flex items-center gap-1 transition-all"
                style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}>
                <Layers className="h-3.5 w-3.5" /> Bulk OCR
              </button>
            </div>
          </div>
          {loadingJamaah ? (
            <p className="text-[12px] text-muted-foreground py-8 text-center">Memuat jamaah…</p>
          ) : jamaah.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-[hsl(var(--border))] py-10 text-center space-y-3">
              <Users className="h-7 w-7 mx-auto text-muted-foreground opacity-60" />
              <p className="text-[12px] text-muted-foreground">Belum ada jamaah di paket ini.</p>
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => setAddOpen(true)}
                  className="h-8 px-3 rounded-xl text-[11.5px] font-semibold border border-[hsl(var(--border))] bg-white hover:bg-[hsl(var(--secondary))] flex items-center gap-1 transition-colors">
                  <Plus className="h-3.5 w-3.5" /> Satu Jamaah
                </button>
                <button onClick={() => setBulkOpen(true)}
                  className="h-8 px-3 rounded-xl text-[11.5px] font-bold text-white flex items-center gap-1"
                  style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}>
                  <Layers className="h-3.5 w-3.5" /> Bulk Scan
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {jamaah.map((person) => (
                <JamaahMiniCard
                  key={person.id}
                  jamaah={person}
                  onDelete={setDeleteTarget}
                  onOpen={(j) => setDetailJamaahId(j.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ── */}
      {id && <AddJamaahWithOcrDialog open={addOpen} packageId={id} onClose={() => setAddOpen(false)} />}
      {id && (
        <BulkOcrDialog
          open={bulkOpen}
          tripId={id}
          onClose={() => { setBulkOpen(false); fetchJamaah(id); }}
        />
      )}

      <JamaahDetailDrawer
        jamaah={detailJamaah}
        open={!!detailJamaah}
        onOpenChange={(o) => { if (!o) setDetailJamaahId(null); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(value) => !value && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus jamaah?</AlertDialogTitle>
            <AlertDialogDescription>Data "{deleteTarget?.name}" akan dihapus dari paket ini.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteJamaah} className="bg-red-500 hover:bg-red-600 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
