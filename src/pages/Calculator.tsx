import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { differenceInCalendarDays, format, parse, isValid } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Calculator as CalcIcon, Hotel, Bus, Globe, UserCheck, TrendingUp, Plus, Trash2, ChevronDown, ChevronUp, FileText, RotateCcw, Moon, Compass, Users, Plane, Download } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { PdfPreviewDialog } from "@/components/PdfPreviewDialog";
import { LivePdfThumbnail } from "@/components/LivePdfThumbnail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { IghPdfData } from "@/lib/generateIghPdf";
import { usePackagesStore } from "@/store/packagesStore";
import type { PackageDraft } from "@/features/packages/packagesRepo";
import {
  computeProfessionalQuote,
  computeGeneralQuote,
  computeGroupMatrix,
  defaultPaxTiers,
  ROOM_SHARING,
  resolveRoomRate,
  type HotelRow,
  type TransportRow,
  type TicketRow,
  type VisaRow,
  type DestinationRow,
  type FnBRow,
  type StaffRow,
  type GeneralCostRow,
  type CalcCurrency,
  type CalcMode,
  type CostUnit,
} from "@/features/calculator/pricing";
import { GroupMatrixSection, DEFAULT_GROUP_SETTINGS, type GroupSettings } from "@/features/calculator/GroupMatrixSection";
import { HotelRatesCell } from "@/features/calculator/HotelRatesCell";
import { QuotationMetaSection } from "@/features/calculator/QuotationMetaSection";
import { cn } from "@/lib/utils";
import { useRatesStore } from "@/store/ratesStore";
import { useRegional } from "@/lib/regional";
import { savePackageCalc } from "@/lib/packageCalcStorage";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalcState {
  mode: CalcMode;
  packageName: string;
  destination: string;
  pax: number;
  hotels: HotelRow[];
  transports: TransportRow[];
  tickets: TicketRow[];
  visas: VisaRow[];
  destinations: DestinationRow[];
  fnbs: FnBRow[];
  staffs: StaffRow[];
  generalCosts: GeneralCostRow[];
  commissionFee: number;
  marginPercent: number;
  discount: number;
  localRateSAR: number;
  localRateUSD: number;
  groupSettings: GroupSettings;
  // PDF / quotation meta
  quoteNumber: string;
  customerName: string;
  dateRange: string;
  hotelMakkahName: string;
  hotelMadinahName: string;
  makkahNightsOverride?: number;
  madinahNightsOverride?: number;
  includedItems: string[];
  excludedItems: string[];
  // Group offer extras
  tier: string;
  title: string;
  subtitle: string;
  makkahStars: number;
  madinahStars: number;
  usdToSar: number;
  website: string;
  contactPhone: string;
  contactName: string;
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

// ── Autosave ke localStorage ──
// Restore state terakhir kalau halaman ke-refresh / crash. Versioning pake key
// ber-suffix biar kalau struktur CalcState berubah breaking, key lama
// di-skip & user dapat default fresh.
const STORAGE_KEY = "igh:calculator:state:v1";
const STORAGE_DEBOUNCE_MS = 600;

function loadFromStorage(): CalcState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CalcState>;
    // Sanity check minimal — pastikan field-field krusial ada
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.hotels)) return null;
    // Merge dengan default biar field baru yang ditambah belakangan tetap ada
    return { ...makeDefault(), ...parsed } as CalcState;
  } catch (err) {
    console.warn("Gagal load state kalkulator dari localStorage", err);
    return null;
  }
}

function saveToStorage(state: CalcState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // QuotaExceededError dll — diam aja, autosave best-effort
    console.warn("Gagal save state kalkulator ke localStorage", err);
  }
}

function clearStorage(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

function makeDefault(): CalcState {
  return {
    mode: "umroh_private",
    packageName: "",
    destination: "",
    pax: 1,
    hotels: [
      { id: "h1", label: "Makkah", days: 4, pricePerNight: 0, rooms: 1 },
      { id: "h2", label: "Madinah", days: 3, pricePerNight: 0, rooms: 1 },
    ],
    transports: [{ id: "t1", label: "All Transport", fleet: 1, pricePerFleet: 0 }],
    tickets: [{ id: "tk1", label: "CGK - JED - CGK", flightType: "Return", pricePerPax: 0, currency: "IDR" }],
    visas: [{ id: "v1", label: "Visa Umroh", pricePerPax: 0 }],
    destinations: [{ id: "d1", label: "Tasreh", pricePerPax: 0 }],
    fnbs: [{ id: "f1", label: "Zam-zam", pricePerPax: 0 }],
    staffs: [
      { id: "s1", label: "Akomodasi Guide", numStaff: 1, totalCost: 0 },
      { id: "s2", label: "Muthowif", numStaff: 1, totalCost: 0 },
    ],
    generalCosts: DEFAULT_GENERAL_COSTS.map((c) => ({ ...c })),
    commissionFee: 0,
    marginPercent: 10,
    discount: 0,
    localRateSAR: 0,
    localRateUSD: 0,
    groupSettings: { ...DEFAULT_GROUP_SETTINGS },
    quoteNumber: "",
    customerName: "",
    dateRange: "",
    hotelMakkahName: "",
    hotelMadinahName: "",
    includedItems: [],
    excludedItems: [],
    tier: "",
    title: "",
    subtitle: "",
    makkahStars: 5,
    madinahStars: 5,
    usdToSar: 3.75,
    website: "",
    contactPhone: "",
    contactName: "",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const M = { fontFamily: "'Manrope', sans-serif" };

// Parse a range string like "01 Juli 2026 - 07 Juli 2026" → { from, to }
function parseRangeStrict(s: string): { from?: Date; to?: Date } | null {
  if (!s?.trim()) return null;
  const parts = s.split(/\s*(?:-|–|s\/d|sd|sampai)\s*/i);
  const tryParse = (raw: string): Date | undefined => {
    if (!raw?.trim()) return undefined;
    for (const fmt of ["dd MMMM yyyy", "dd MMM yyyy", "d MMMM yyyy", "d MMM yyyy", "yyyy-MM-dd", "dd/MM/yyyy"]) {
      const d = parse(raw.trim(), fmt, new Date(), { locale: idLocale });
      if (isValid(d)) return d;
    }
    const d = new Date(raw);
    return isValid(d) ? d : undefined;
  };
  const from = tryParse(parts[0]);
  if (!from) return null;
  return { from, to: tryParse(parts[1] ?? "") };
}

function fmtSAR(v: number) {
  if (!v) return "—";
  return "SAR " + v.toLocaleString("id-ID");
}
function fmtUSD(v: number) {
  if (!v) return "—";
  return "USD " + v.toLocaleString("id-ID");
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
  "CT MAKKAH",
  "CT MADINAH",
  "HOTEL STATION MAKKAH/MADINAH",
  "JED-MEK", "MEK-JED",
  "JED-MED", "MED-JED",
  "MED-MEK", "MEK-MED",
  "MED-MED",
  "THAIF",
];
const FLIGHT_ROUTE_SUGGESTIONS = [
  "CGK - JED - CGK",
  "CGK - MED - CGK",
  "SUB - JED - SUB",
  "SUB - MED - SUB",
  "KNO - JED - KNO",
  "KNO - MED - KNO",
  "UPG - JED - UPG",
  "UPG - MED - UPG",
  "BPN - JED - BPN",
  "SOC - JED - SOC",
  "PDG - JED - PDG",
  "BTH - JED - BTH",
  "CGK - JED",
  "CGK - MED",
  "JED - CGK",
  "MED - CGK",
  "SUB - JED",
  "SUB - MED",
  "JED - SUB",
  "MED - SUB",
  "KNO - JED",
  "KNO - MED",
  "JED - KNO",
  "MED - KNO",
  "UPG - JED",
  "UPG - MED",
  "JED - UPG",
  "MED - UPG",
];
const ROOM_TYPES = ["Quad", "Triple", "Double"] as const;
const ROOM_CAPACITY: Record<typeof ROOM_TYPES[number], number> = { Quad: 4, Triple: 3, Double: 2 };
const AIRLINES = [
  "Saudia Airlines", "Ettihad Airways", "Emirates Airways", "Turkish Airways",
  "Egypt Air", "Lion Air", "Scoot", "Flynas", "Flyadeal",
];
const DESTINATION_PRESETS = [
  "Mekkah - Madinah - Thaif",
  "Mekkah - Madinah",
  "Madinah - Mekkah",
];

function SelectCell({
  value, onChange, options, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={M}
      className="w-full h-7 rounded-lg border border-orange-200 bg-white px-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
    >
      <option value="">{placeholder ?? "Pilih"}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Calculator() {
  const rates = useRatesStore((s) => s.rates);
  const { formatCurrency } = useRegional();

  const [calc, setCalc] = useState<CalcState>(() => {
    const restored = loadFromStorage();
    return restored ?? makeDefault();
  });
  // Tandai apakah state awal hasil restore — buat tampilin toast info sekali.
  const wasRestoredRef = useRef<boolean>(loadFromStorage() !== null);
  const didShowRestoreToastRef = useRef(false);
  const [showSummary, setShowSummary] = useState(true);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const navigate = useNavigate();
  const createPackage = usePackagesStore((s) => s.create);

  function update(value: CalcState) {
    setCalc(value);
  }

  const setField = <K extends keyof CalcState>(key: K, value: CalcState[K]) => {
    const next = { ...calc, [key]: value };
    update(next);
  };

  // ── Auto-fill hotel "Lama Hari" dari periode trip ──
  // Begitu user pilih range tanggal, total malam = (tgl_pulang - tgl_berangkat).
  // Distribusi: kalau ada hotel Makkah & Madinah → 60/40 (atau pakai rasio existing
  // kalau user udah custom). Kalau cuma 1 hotel → semua malam ke situ.
  const lastAutoRangeRef = useRef<string>("");
  useEffect(() => {
    if (calc.mode === "umum") return;
    if (!calc.dateRange || calc.dateRange === lastAutoRangeRef.current) return;
    const range = parseRangeStrict(calc.dateRange);
    if (!range?.from || !range?.to) return;
    const totalNights = Math.max(1, differenceInCalendarDays(range.to, range.from));
    const hotels = calc.hotels;
    if (!hotels.length) return;

    const makkahIdx = hotels.findIndex((h) => /makk?ah/i.test(h.label));
    const madinahIdx = hotels.findIndex((h) => /madin/i.test(h.label));

    let nextHotels: HotelRow[];
    if (makkahIdx >= 0 && madinahIdx >= 0) {
      const curMakkah = hotels[makkahIdx].days || 0;
      const curMadinah = hotels[madinahIdx].days || 0;
      const sum = curMakkah + curMadinah;
      let makkahN: number;
      let madinahN: number;
      if (sum > 0 && sum !== totalNights) {
        // Pertahankan rasio yang user udah set
        makkahN = Math.max(1, Math.round((curMakkah / sum) * totalNights));
        madinahN = Math.max(1, totalNights - makkahN);
      } else if (sum === totalNights) {
        return; // udah pas, skip
      } else {
        // Default Umroh: 60/40 Makkah/Madinah
        makkahN = Math.max(1, Math.round(totalNights * 0.6));
        madinahN = Math.max(1, totalNights - makkahN);
      }
      nextHotels = hotels.map((h, i) =>
        i === makkahIdx ? { ...h, days: makkahN } :
        i === madinahIdx ? { ...h, days: madinahN } : h
      );
    } else if (hotels.length === 1) {
      if (hotels[0].days === totalNights) return;
      nextHotels = [{ ...hotels[0], days: totalNights }];
    } else {
      // Distribusi merata
      const sumExisting = hotels.reduce((s, h) => s + (h.days || 0), 0);
      if (sumExisting === totalNights) return;
      const base = Math.floor(totalNights / hotels.length);
      const remainder = totalNights - base * hotels.length;
      nextHotels = hotels.map((h, i) => ({ ...h, days: base + (i < remainder ? 1 : 0) }));
    }

    lastAutoRangeRef.current = calc.dateRange;
    update({ ...calc, hotels: nextHotels });
    toast.message(`Lama hari hotel di-update otomatis: ${totalNights} malam`, {
      duration: 2500,
    });
  }, [calc.dateRange, calc.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const sarRate = calc.localRateSAR > 0 ? calc.localRateSAR : (rates.SAR ?? 1);
  const usdRate = calc.localRateUSD > 0 ? calc.localRateUSD : (rates.USD ?? 1);
  const safePax = Math.max(1, calc.pax);

  const effectiveRates = useMemo(() => ({
    ...rates,
    SAR: calc.localRateSAR > 0 ? calc.localRateSAR : (rates.SAR ?? 1),
    USD: calc.localRateUSD > 0 ? calc.localRateUSD : (rates.USD ?? 1),
  }), [calc.localRateSAR, calc.localRateUSD, rates]);

  const quote = useMemo(() => {
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

  // ── Row updaters ─────────────────────────────────────────────────────────────

  function updateHotel(id: string, patch: Partial<HotelRow>) {
    update({ ...calc, hotels: calc.hotels.map((h) => h.id === id ? { ...h, ...patch } : h) });
  }
  function addHotel() {
    update({ ...calc, hotels: [...calc.hotels, { id: `h${Date.now()}`, label: "Hotel", days: 1, pricePerNight: 0, rooms: 1 }] });
  }
  function removeHotel(id: string) {
    update({ ...calc, hotels: calc.hotels.filter((h) => h.id !== id) });
  }

  function updateTransport(id: string, patch: Partial<TransportRow>) {
    update({ ...calc, transports: calc.transports.map((t) => t.id === id ? { ...t, ...patch } : t) });
  }
  function addTransport() {
    update({ ...calc, transports: [...calc.transports, { id: `t${Date.now()}`, label: "Transport", fleet: 1, pricePerFleet: 0 }] });
  }
  function removeTransport(id: string) {
    update({ ...calc, transports: calc.transports.filter((t) => t.id !== id) });
  }

  function updateTicket(id: string, patch: Partial<TicketRow>) {
    update({ ...calc, tickets: calc.tickets.map((t) => t.id === id ? { ...t, ...patch } : t) });
  }
  function addTicket() {
    update({ ...calc, tickets: [...calc.tickets, { id: `tk${Date.now()}`, label: "Rute Baru", flightType: "Return", pricePerPax: 0, currency: "IDR" as const }] });
  }
  function removeTicket(id: string) {
    update({ ...calc, tickets: calc.tickets.filter((t) => t.id !== id) });
  }

  function updateVisa(id: string, patch: Partial<VisaRow>) {
    update({ ...calc, visas: calc.visas.map((v) => v.id === id ? { ...v, ...patch } : v) });
  }
  function addVisa() {
    update({ ...calc, visas: [...calc.visas, { id: `v${Date.now()}`, label: "Visa", pricePerPax: 0 }] });
  }
  function removeVisa(id: string) {
    update({ ...calc, visas: calc.visas.filter((v) => v.id !== id) });
  }

  function updateDest(id: string, patch: Partial<DestinationRow>) {
    update({ ...calc, destinations: calc.destinations.map((d) => d.id === id ? { ...d, ...patch } : d) });
  }
  function addDest() {
    update({ ...calc, destinations: [...calc.destinations, { id: `d${Date.now()}`, label: "Destinasi", pricePerPax: 0 }] });
  }
  function removeDest(id: string) {
    update({ ...calc, destinations: calc.destinations.filter((d) => d.id !== id) });
  }

  function updateFnB(id: string, patch: Partial<FnBRow>) {
    update({ ...calc, fnbs: calc.fnbs.map((f) => f.id === id ? { ...f, ...patch } : f) });
  }
  function addFnB() {
    update({ ...calc, fnbs: [...calc.fnbs, { id: `f${Date.now()}`, label: "F&B", pricePerPax: 0 }] });
  }
  function removeFnB(id: string) {
    update({ ...calc, fnbs: calc.fnbs.filter((f) => f.id !== id) });
  }

  function updateStaff(id: string, patch: Partial<StaffRow>) {
    update({ ...calc, staffs: calc.staffs.map((s) => s.id === id ? { ...s, ...patch } : s) });
  }
  function addStaff() {
    update({ ...calc, staffs: [...calc.staffs, { id: `s${Date.now()}`, label: "Guide", numStaff: 1, totalCost: 0 }] });
  }
  function removeStaff(id: string) {
    update({ ...calc, staffs: calc.staffs.filter((s) => s.id !== id) });
  }

  function updateGeneralCost(id: string, patch: Partial<GeneralCostRow>) {
    update({ ...calc, generalCosts: calc.generalCosts.map((c) => c.id === id ? { ...c, ...patch } : c) });
  }
  function addGeneralCost() {
    update({ ...calc, generalCosts: [...calc.generalCosts, { id: `g${Date.now()}`, category: "lainnya", label: "Biaya Tambahan", qty: 1, amount: 0, currency: "IDR" as CalcCurrency, unit: "pax" as CostUnit }] });
  }
  function removeGeneralCost(id: string) {
    update({ ...calc, generalCosts: calc.generalCosts.filter((c) => c.id !== id) });
  }

  function handleReset() {
    setResetConfirmOpen(true);
  }

  function confirmReset() {
    const fresh = makeDefault();
    update(fresh);
    lastAutoRangeRef.current = ""; // reset auto-fill guard juga
    clearStorage();                  // hapus juga snapshot localStorage
    wasRestoredRef.current = false;
    setResetConfirmOpen(false);
    toast.success("Kalkulator di-reset ke default");
  }

  // ── Restore toast: tampil sekali pas mount kalau ada state yang dipulihkan ──
  useEffect(() => {
    if (didShowRestoreToastRef.current) return;
    didShowRestoreToastRef.current = true;
    if (!wasRestoredRef.current) return;
    toast.message("Sesi sebelumnya dipulihkan", {
      description: "Kalkulasi terakhir ditemukan & dimuat otomatis.",
      duration: 4000,
      action: {
        label: "Mulai Baru",
        onClick: () => setResetConfirmOpen(true),
      },
    });
  }, []);

  // ── Autosave: simpan state ke localStorage tiap kali calc berubah (debounced) ──
  useEffect(() => {
    const t = window.setTimeout(() => saveToStorage(calc), STORAGE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [calc]);


  // ── Group matrix (untuk PDF mode "umroh_group") ──
  const groupTiers = useMemo(
    () => defaultPaxTiers(calc.groupSettings.minPax, calc.groupSettings.maxPax, calc.groupSettings.step),
    [calc.groupSettings.minPax, calc.groupSettings.maxPax, calc.groupSettings.step],
  );
  const groupMatrix = useMemo(() => {
    if (calc.mode !== "umroh_group") return null;
    return computeGroupMatrix({
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
      rates: effectiveRates,
      tiers: groupTiers,
      roomTypes: calc.groupSettings.roomTypes.length > 0 ? calc.groupSettings.roomTypes : ["Quad", "Triple", "Double"],
      displayCurrency: "USD",
      roundTo: calc.groupSettings.roundTo,
    });
  }, [calc, effectiveRates, groupTiers]);

  // ── Data untuk PDF template IGH ──
  const ighPdfData = useMemo<IghPdfData>(() => {
    // Resolve hotel Makkah/Madinah dari array hotels[]:
    //  1. Cari row yg label-nya menyebut kota (mis. "Makkah", "Hotel Makkah X")
    //  2. Kalau gak ketemu, cocokin label CONTAINS nama explicit dari field
    //     `hotelMakkahName`/`hotelMadinahName` (mis. user rename ke nama hotel
    //     beneran tapi lupa nyantumin kota)
    //  3. Last resort: pakai konvensi posisi (hotels[0] = Makkah, hotels[1] =
    //     Madinah, sesuai default form). Bug sebelumnya: kalau user rename
    //     label-nya jadi nama hotel ("Safwa Tower"), regex gak match dan
    //     `days` jatuh ke 0 → "0 Malam" muncul di PDF.
    const findByCity = (re: RegExp) => calc.hotels.find((h) => re.test(h.label || ""));
    const findByExplicitName = (name: string) => {
      const needle = name?.trim().toLowerCase();
      if (!needle) return undefined;
      return calc.hotels.find((h) => (h.label || "").toLowerCase().includes(needle));
    };
    const makkahHotel =
      findByCity(/makk?ah/i)
      ?? findByExplicitName(calc.hotelMakkahName)
      ?? calc.hotels[0];
    const madinahHotel =
      findByCity(/madin/i)
      ?? findByExplicitName(calc.hotelMadinahName)
      ?? (calc.hotels.length > 1 ? calc.hotels[1] : undefined);

    // Auto-derive "Sudah Termasuk" dari form: visa, tiket, hotel, F&B, destinasi.
    // Cuma item yg punya label & ada price > 0 (atau set manual) yg ikut.
    const derivedIncluded: string[] = [];
    for (const v of calc.visas) {
      const label = v.label?.trim();
      if (label) derivedIncluded.push(label);
    }
    for (const t of calc.tickets) {
      const label = t.label?.trim();
      if (label) {
        derivedIncluded.push(t.flightType ? `Tiket ${label} (${t.flightType})` : `Tiket ${label}`);
      }
    }
    if (makkahHotel?.label) {
      derivedIncluded.push(`Hotel Makkah ${makkahHotel.label} (${makkahHotel.days || 0} Malam)`);
    }
    if (madinahHotel?.label) {
      derivedIncluded.push(`Hotel Madinah ${madinahHotel.label} (${madinahHotel.days || 0} Malam)`);
    }
    for (const d of calc.destinations) {
      const label = d.label?.trim();
      if (label) derivedIncluded.push(label);
    }
    for (const f of calc.fnbs) {
      const label = f.label?.trim();
      if (label) derivedIncluded.push(`Konsumsi ${label}`);
    }

    // Default "Belum Termasuk" yg umum di package umroh — user bisa override
    // lewat calc.excludedItems kalau perlu.
    const defaultExcluded = [
      "Pengeluaran pribadi (laundry, telepon, dll)",
      "Vaksin Meningitis",
      "Kelebihan bagasi pesawat",
      "Tour tambahan di luar itinerary",
      "Biaya pembuatan paspor",
    ];

    const userIncluded = calc.includedItems.map((s) => s.trim()).filter(Boolean);
    const userExcluded = calc.excludedItems.map((s) => s.trim()).filter(Boolean);

    // Format timeline pakai date-fns. Kita build DUA versi:
    //  - `timeline` (Full)  → "01 September 2026 - 09 September 2026 (9 hari)"
    //  - `timelineShort`    → "01 - 09 Sep 2026 (9 hari)" kalau same month/year
    //                          / "01 Sep - 03 Okt 2026" kalau beda bulan
    //                          / "01 Sep 2026 - 03 Jan 2027" kalau beda tahun
    // Generator pilih versi mana berdasar `cfg.dateDisplayMode` (default Short).
    let timeline = calc.dateRange || "";
    let timelineShort = calc.dateRange || "";
    const range = parseRangeStrict(calc.dateRange);
    if (range?.from) {
      const fromStrFull = format(range.from, "dd MMMM yyyy", { locale: idLocale });
      if (range.to) {
        const toStrFull = format(range.to, "dd MMMM yyyy", { locale: idLocale });
        const days = differenceInCalendarDays(range.to, range.from) + 1;
        timeline = `${fromStrFull} - ${toStrFull} (${days} hari)`;
        // ── Short: collapse parts yang sama antar tanggal ──
        // date-fns "MMM" id locale = "Jan, Feb, Mar, Apr, Mei, Jun, Jul, Agu,
        // Sep, Okt, Nov, Des" → 3-letter, hemat space.
        const sameYear = range.from.getFullYear() === range.to.getFullYear();
        const sameMonth = sameYear && range.from.getMonth() === range.to.getMonth();
        const fromDay = format(range.from, "dd", { locale: idLocale });
        const toDay = format(range.to, "dd", { locale: idLocale });
        const fromMon = format(range.from, "MMM", { locale: idLocale });
        const toMon = format(range.to, "MMM", { locale: idLocale });
        const fromYr = format(range.from, "yyyy", { locale: idLocale });
        const toYr = format(range.to, "yyyy", { locale: idLocale });
        if (sameMonth) {
          timelineShort = `${fromDay} - ${toDay} ${toMon} ${toYr} (${days} hari)`;
        } else if (sameYear) {
          timelineShort = `${fromDay} ${fromMon} - ${toDay} ${toMon} ${toYr} (${days} hari)`;
        } else {
          timelineShort = `${fromDay} ${fromMon} ${fromYr} - ${toDay} ${toMon} ${toYr} (${days} hari)`;
        }
      } else {
        timeline = fromStrFull;
        timelineShort = format(range.from, "dd MMM yyyy", { locale: idLocale });
      }
    }

    // ── Group pricing rows: convert matrix cells (tier × room) → 1 row per tier
    //    Bawa dua nilai per kamar: `quad/triple/double` di display currency
    //    (USD by default) + `quadIDR/...` canonical IDR. Ini bikin generator
    //    PDF bisa konversi ke currency apapun (USD/IDR/SAR) tanpa rounding error.
    const isGroupMode = calc.mode === "umroh_group";
    type GRow = {
      paxLabel: string;
      quad?: number;    triple?: number;    double?: number;
      quadIDR?: number; tripleIDR?: number; doubleIDR?: number;
    };
    let groupPricingRows: GRow[] | undefined;
    if (isGroupMode && groupMatrix) {
      const byTier = new Map<string, GRow>();
      for (const cell of groupMatrix.cells) {
        const key = `${cell.tier.min}-${cell.tier.max}`;
        const label = cell.tier.min === cell.tier.max
          ? `${cell.tier.min}`
          : `${cell.tier.min}-${cell.tier.max}`;
        const row = byTier.get(key) ?? { paxLabel: label };
        if (cell.room === "Quad")   { row.quad   = cell.perPaxDisplay; row.quadIDR   = cell.perPaxIDR; }
        if (cell.room === "Triple") { row.triple = cell.perPaxDisplay; row.tripleIDR = cell.perPaxIDR; }
        if (cell.room === "Double") { row.double = cell.perPaxDisplay; row.doubleIDR = cell.perPaxIDR; }
        byTier.set(key, row);
      }
      groupPricingRows = Array.from(byTier.values());
    }

    return {
      projectName:
        calc.title?.trim() ||
        calc.packageName?.trim() ||
        (calc.customerName ? `Umroh ${calc.customerName}` : "Penawaran Paket"),
      timeline,
      timelineShort,
      customerName: calc.customerName || "—",
      date: new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }),
      hotelMakkah: calc.hotelMakkahName || makkahHotel?.label || "",
      makkahNights: (typeof calc.makkahNightsOverride === "number" && calc.makkahNightsOverride > 0)
        ? calc.makkahNightsOverride
        : (makkahHotel?.days || 0),
      hotelMadinah: calc.hotelMadinahName || madinahHotel?.label || "",
      madinahNights: (typeof calc.madinahNightsOverride === "number" && calc.madinahNightsOverride > 0)
        ? calc.madinahNightsOverride
        : (madinahHotel?.days || 0),
      pax: calc.pax || 0,
      pricePerPaxIDR: quote?.perPaxFinal ?? 0,
      kursIdrPerUsd: effectiveRates.USD,
      kursIdrPerSar: effectiveRates.SAR,
      included: userIncluded.length > 0 ? userIncluded : derivedIncluded.slice(0, 5),
      excluded: userExcluded.length > 0 ? userExcluded : defaultExcluded,
      mode: isGroupMode ? "group" : "private",
      groupPricing: groupPricingRows,
      // Source currency dari perPaxDisplay di matrix — saat ini hardcoded USD
      // di computeGroupMatrix call (line ~748). Kalau berubah, sinkronin.
      displayCurrency: "USD",
    };
  }, [calc, quote, effectiveRates.USD, effectiveRates.SAR, groupMatrix]);

  // ── Buat Trip otomatis dari hasil kalkulasi ──
  function parseDateRange(s: string): { start?: string; end?: string } {
    if (!s) return {};
    const parts = s.split(/\s*(?:-|–|s\/d|sd|sampai)\s*/i);
    const tryParse = (raw: string) => {
      if (!raw) return undefined;
      const months: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6,
        agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
      };
      const m = raw.trim().match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})/);
      if (m) {
        const day = Number(m[1]);
        const mon = months[m[2].slice(0, 3).toLowerCase()];
        let year = Number(m[3]);
        if (year < 100) year += 2000;
        if (Number.isFinite(day) && mon != null) {
          return new Date(Date.UTC(year, mon, day)).toISOString().slice(0, 10);
        }
      }
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
    };
    return { start: tryParse(parts[0]), end: tryParse(parts[1] ?? parts[0]) };
  }

  async function handleCreateTrip() {
    if (creatingTrip) return;
    setCreatingTrip(true);
    try {
      const parsed = parseDateRange(calc.dateRange);

      const name =
        calc.title?.trim() ||
        calc.packageName?.trim() ||
        (calc.customerName ? `Umroh ${calc.customerName}` : "Paket Baru IGH Tour");

      const destination =
        calc.destination?.trim() ||
        (calc.mode !== "umum"
          ? [calc.hotelMakkahName, calc.hotelMadinahName]
              .filter(Boolean)
              .join(" & ")
              .trim() || "Makkah & Madinah"
          : "Trip");

      const totalDays = calc.hotels.reduce((acc, h) => acc + (h.days || 0), 0) || 7;

      const isUmrah = /umroh|umrah|haji|hajj|makkah|madinah/i.test(name + " " + destination);
      const emoji = isUmrah ? "🕋" : "✈️";

      const stars = calc.makkahStars ?? calc.madinahStars ?? 0;
      const hotelLevel =
        stars >= 5 ? "Bintang 5" :
        stars >= 4 ? "Bintang 4" :
        stars >= 3 ? "Bintang 3" : undefined;

      const facilities = calc.includedItems?.filter((s) => s.trim()) ?? [];
      const exclusions = calc.excludedItems?.filter((s) => s.trim()) ?? [];

      const airline =
        calc.tickets?.find((t) => t.airline?.trim())?.airline?.trim() || undefined;

      const descriptionParts = [
        calc.subtitle?.trim(),
        calc.tier?.trim(),
        calc.hotelMakkahName ? `Hotel Makkah: ${calc.hotelMakkahName}` : "",
        calc.hotelMadinahName ? `Hotel Madinah: ${calc.hotelMadinahName}` : "",
        airline ? `Maskapai: ${airline}` : "",
        calc.customerName ? `Customer: ${calc.customerName}` : "",
        exclusions.length ? `Belum termasuk: ${exclusions.join(", ")}` : "",
      ].filter(Boolean);

      const draft: PackageDraft = {
        name,
        destination,
        people: Math.max(1, calc.pax || 1),
        days: totalDays,
        hpp: Math.round(quote.hpp || 0),
        totalIDR: Math.round(quote.finalPrice || 0),
        status: "Calculated",
        emoji,
        departureDate: parsed.start || undefined,
        airline,
        hotelLevel: hotelLevel as PackageDraft["hotelLevel"],
        facilities: facilities.length ? facilities : undefined,
        notes: descriptionParts.length ? descriptionParts.join(" | ") : undefined,
      };

      const newPkg = await createPackage(draft);

      // Persist seluruh row kalkulator (hotels/transports/visas/dst) ke
      // package_calculations[newPkg.id] supaya pas user buka /packages/[id],
      // semua input udah otomatis ke-load (bukan form kosong).
      // Project hanya field yg ada di ProfessionalCalcState — PDF/quotation
      // metadata (customerName, dateRange, dst) gak di-carry karena
      // PackageDetail.calc shape-nya beda & gak butuh field itu.
      const calcRowsPayload = {
        mode: calc.mode,
        packageName: name,
        destination,
        pax: Math.max(1, calc.pax || 1),
        hotels: calc.hotels,
        transports: calc.transports,
        tickets: calc.tickets,
        visas: calc.visas,
        destinations: calc.destinations,
        fnbs: calc.fnbs,
        staffs: calc.staffs,
        generalCosts: calc.generalCosts,
        commissionFee: calc.commissionFee,
        marginPercent: calc.marginPercent,
        discount: calc.discount,
        groupSettings: calc.groupSettings,
      };
      // Write-through: localStorage instan + cloud push (best-effort).
      // PackageDetail bakal nge-read dari localStorage dulu (fast path),
      // lalu pullPackageCalc nge-overwrite dgn versi cloud kalau beda.
      savePackageCalc(newPkg.id, calcRowsPayload);

      toast.success("Paket Trip berhasil dibuat!", {
        description: `${name} · ${formatCurrency(quote.finalPrice)}`,
        action: {
          label: "Lihat Paket",
          onClick: () => navigate(`/packages/${newPkg.id}`),
        },
      });
      navigate("/packages");
    } catch (err) {
      console.error("create package failed", err);
      const msg = err instanceof Error ? err.message : "Coba lagi.";
      toast.error("Gagal membuat Paket Trip", { description: msg });
    } finally {
      setCreatingTrip(false);
    }
  }

  return (
    <div className="pwa-compact-form space-y-2.5 md:space-y-5 max-w-5xl mx-auto" style={M}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 md:gap-2 min-w-0">
          <CalcIcon strokeWidth={2} className="h-4 w-4 md:h-5 md:w-5 text-orange-500 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-[14px] md:text-lg font-bold text-[hsl(var(--foreground))] leading-tight truncate" style={M}>
              Kalkulator Profesional
            </h1>
            <p className="text-[10px] text-muted-foreground leading-tight hidden sm:block" style={M}>
              Kalkulasi biaya paket Umroh, Haji &amp; Trip
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <button
            onClick={handleReset}
            style={M}
            className="flex items-center gap-1 h-7 md:h-8 px-2 md:px-3 rounded-lg md:rounded-xl border border-orange-200 text-orange-600 bg-white hover:bg-orange-50 text-[10.5px] md:text-[11px] font-semibold transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
          <Button
            onClick={() => setPdfOpen(true)}
            disabled={quote.finalPrice === 0}
            className="h-7 md:h-8 px-2 md:px-3 rounded-lg md:rounded-xl gradient-primary text-white text-[10.5px] md:text-[11px] font-semibold"
          >
            <FileText className="h-3.5 w-3.5 mr-1" /> PDF
          </Button>
        </div>
      </div>

      {/* ── Mode switcher ── */}
      <div className="flex items-center gap-1 p-1 rounded-xl border border-orange-200 bg-orange-50/50 self-start flex-wrap">
        {([
          { mode: "umroh_private" as CalcMode, label: "Umroh Private", icon: Moon },
          { mode: "umroh_group"   as CalcMode, label: "Umroh Group",   icon: Users },
          { mode: "umum"          as CalcMode, label: "Umum",          icon: Compass },
        ]).map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            onClick={() => setField("mode", mode)}
            style={M}
            className={cn(
              "px-2.5 py-1.5 rounded-lg text-[10.5px] md:text-[11.5px] font-bold transition-all inline-flex items-center gap-1.5 whitespace-nowrap",
              calc.mode === mode
                ? "bg-orange-500 text-white shadow-sm"
                : "text-orange-600 hover:bg-orange-100"
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Editable rates strip ── */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
        <p style={M} className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Override Kurs (khusus halaman ini)</p>
        <div className="flex flex-wrap gap-2">
          {(["SAR", "USD"] as const).map((cur) => {
            const storeVal = rates[cur] ?? 0;
            const localVal = cur === "SAR" ? calc.localRateSAR : calc.localRateUSD;
            const active = localVal > 0;
            return (
              <div
                key={cur}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors ${active ? "bg-orange-50 border-orange-200" : "bg-white border-slate-200"}`}
              >
                <span style={M} className="text-[10px] font-bold text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-100 shrink-0">{cur}</span>
                <span style={M} className="text-[11px] text-muted-foreground">= Rp</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={storeVal.toLocaleString("id-ID")}
                  value={localVal > 0 ? localVal.toLocaleString("id-ID") : ""}
                  onChange={(e) => {
                    const stripped = e.target.value.replace(/\./g, "").replace(/[^0-9]/g, "");
                    setField(cur === "SAR" ? "localRateSAR" : "localRateUSD", stripped ? Number(stripped) : 0);
                  }}
                  style={M}
                  className="h-6 w-28 text-[11px] font-bold border-0 bg-transparent shadow-none p-0 focus:outline-none"
                />
                {active ? (
                  <button
                    type="button"
                    onClick={() => setField(cur === "SAR" ? "localRateSAR" : "localRateUSD", 0)}
                    style={M}
                    className="text-[10px] text-orange-400 hover:text-orange-600 font-medium shrink-0"
                  >↩ Reset</button>
                ) : (
                  <span style={M} className="text-[10px] text-slate-400 italic shrink-0">(dari Pengaturan)</span>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
            <span style={M} className="text-[10px] font-bold text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-100 shrink-0">IDR</span>
            <span style={M} className="text-[11px] text-muted-foreground">= Rp</span>
            <span style={M} className="text-[11px] font-bold text-slate-800 font-mono">1</span>
            <span style={M} className="text-[10px] text-slate-400 italic shrink-0">(basis)</span>
          </div>
        </div>
      </div>

      {/* ── Package Info ── */}
      <div className="rounded-xl border border-orange-200 bg-white p-3 md:p-4 space-y-2.5 md:space-y-3">
        <p style={M} className="text-[10px] font-extrabold uppercase tracking-wide text-orange-600">Info Paket</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3">
          <div className="col-span-2 space-y-1">
            <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Nama Paket</label>
            <input
              type="text"
              value={calc.packageName}
              onChange={(e) => setField("packageName", e.target.value)}
              placeholder="cth: Umrah Ramadhan 2026"
              style={M}
              className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </div>
          <div className="space-y-1">
            <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Destinasi</label>
            <select
              value={calc.destination}
              onChange={(e) => setField("destination", e.target.value)}
              style={M}
              className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400"
            >
              <option value="">Pilih rute</option>
              {DESTINATION_PRESETS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label style={M} className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Jumlah Pax</label>
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
          </div>
        </div>
      </div>

      {/* ══ MODE-SPECIFIC SECTION ══ */}

      {calc.mode !== "umum" && (<>

        {/* ── HOTEL TABLE ── */}
        <div className="overflow-hidden rounded-xl border border-orange-200">
          <SectionHeader icon={Hotel} title="Hotel" currency="SAR / USD" color="bg-blue-500" onAdd={addHotel} />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Nama Hotel</Th>
                  <Th>Tipe Kamar</Th>
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
                  // Active rate honors per-room-type pricing (or supplement
                  // fallback) when roomType is set; otherwise base/Quad.
                  const activeRate = h.roomType ? resolveRoomRate(h, h.roomType) : (h.pricePerNight ?? 0);
                  const foreignAmount = h.days * activeRate * h.rooms;
                  const totalIDR = foreignAmount * rate;
                  const capacity = h.roomType ? ROOM_CAPACITY[h.roomType] : 0;
                  const perPaxIDR = capacity > 0
                    ? (h.days * activeRate * rate) / capacity
                    : totalIDR / safePax;
                  return (
                    <tr key={h.id} className="hover:bg-orange-50/30 transition-colors">
                      <Td><TextCell value={h.label} onChange={(v) => updateHotel(h.id, { label: v })} placeholder="Nama hotel" /></Td>
                      <Td>
                        <SelectCell
                          value={h.roomType ?? ""}
                          onChange={(v) => updateHotel(h.id, { roomType: (v || undefined) as HotelRow["roomType"] })}
                          options={ROOM_TYPES}
                          placeholder="Tipe"
                        />
                      </Td>
                      <Td right><NumCell value={h.days} onChange={(v) => updateHotel(h.id, { days: v })} /></Td>
                      <Td>
                        <HotelRatesCell hotel={h} onChange={(patch) => updateHotel(h.id, patch)} />
                      </Td>
                      <Td right><NumCell value={h.rooms} onChange={(v) => updateHotel(h.id, { rooms: v })} /></Td>
                      <Td right bold mono>{formatCurrency(totalIDR)}</Td>
                      <Td right muted mono>
                        {formatCurrency(perPaxIDR)}
                        {capacity > 0 && <div style={M} className="text-[9px] text-slate-400 font-normal">÷ {capacity} pax/kamar</div>}
                      </Td>
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
                      <Td><SelectCell value={t.label} onChange={(v) => updateTransport(t.id, { label: v })} options={TRANSPORT_TYPES} placeholder="Jenis" /></Td>
                      <Td><SelectCell value={t.route ?? ""} onChange={(v) => updateTransport(t.id, { route: v })} options={ROUTE_OPTIONS} placeholder="Rute" /></Td>
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
                  <Th>Maskapai</Th>
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
                      <Td><SelectCell value={tk.airline ?? ""} onChange={(v) => updateTicket(tk.id, { airline: v })} options={AIRLINES} placeholder="Maskapai" /></Td>
                      <Td><TextCell value={tk.label} onChange={(v) => updateTicket(tk.id, { label: v })} placeholder="cth: CGK - JED - CGK" suggestions={FLIGHT_ROUTE_SUGGESTIONS} listId={`flight-routes-${tk.id}`} /></Td>
                      <Td>
                        <select
                          value={tk.flightType === "Open Jaw" ? "Return" : tk.flightType}
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
                  <SubtotalRow
                    label="SUBTOTAL TIKET"
                    usdAmount={quote.breakdown.filter(b => b.category === "Tiket").reduce((s, b) => s + b.notesUSD, 0)}
                    groupIDR={quote.ticketIDR}
                    perPaxIDR={quote.ticketIDR / safePax}
                    formatCurrency={formatCurrency}
                  />
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── VISA TABLE ── */}
        <div className="overflow-hidden rounded-xl border border-orange-200">
          <SectionHeader icon={Globe} title="Visa" currency="SAR / USD" color="bg-indigo-500" onAdd={addVisa} />
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

        {/* ── DESTINATION TABLE ── */}
        <div className="overflow-hidden rounded-xl border border-orange-200">
          <SectionHeader icon={Globe} title="Destinasi / Ziarah" currency="SAR / USD" color="bg-emerald-500" onAdd={addDest} />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Nama Destinasi</Th>
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
                      <Td><TextCell value={d.label} onChange={(v) => updateDest(d.id, { label: v })} placeholder="cth: Tasreh" /></Td>
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
          <SectionHeader icon={Globe} title="F&B / Konsumsi" currency="SAR / USD" color="bg-amber-500" onAdd={addFnB} />
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

      {/* ── INFO PENAWARAN + EXCLUDE LIST (untuk PDF) ── */}
      <QuotationMetaSection
        value={{
          quoteNumber: calc.quoteNumber,
          customerName: calc.customerName,
          dateRange: calc.dateRange,
          hotelMakkahName: calc.hotelMakkahName,
          hotelMadinahName: calc.hotelMadinahName,
          makkahNightsOverride: calc.makkahNightsOverride,
          madinahNightsOverride: calc.madinahNightsOverride,
          includedItems: calc.includedItems,
          excludedItems: calc.excludedItems,
          tier: calc.tier,
          title: calc.title,
          subtitle: calc.subtitle,
          makkahStars: calc.makkahStars,
          madinahStars: calc.madinahStars,
          usdToSar: calc.usdToSar,
          website: calc.website,
          contactPhone: calc.contactPhone,
          contactName: calc.contactName,
        }}
        onChange={(meta) => update({ ...calc, ...meta })}
      />

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
        <>
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

        </>
      )}

      {/* ── PDF EXPORT (template IGH Tour) ── */}
      <PdfExportCard
        data={ighPdfData}
        finalPrice={quote.finalPrice}
        perPax={quote.perPaxFinal}
        formatCurrency={formatCurrency}
        onOpenPdf={() => setPdfOpen(true)}
        onCreateTrip={handleCreateTrip}
        creatingTrip={creatingTrip}
      />


      {/* ── SUMMARY OUTPUT (private + umum modes) ── */}
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

              {/* Group Matrix Summary — khusus mode "umroh_group" */}
              {calc.mode === "umroh_group" && groupMatrix && (() => {
                const rooms = calc.groupSettings.roomTypes.length > 0
                  ? calc.groupSettings.roomTypes
                  : (["Quad", "Triple", "Double"] as const);
                // Pivot cells jadi map: tier.label → room → cell
                const byTier = new Map<string, { tier: typeof groupMatrix.cells[0]["tier"]; cells: Map<string, typeof groupMatrix.cells[0]> }>();
                for (const c of groupMatrix.cells) {
                  const key = c.tier.label;
                  if (!byTier.has(key)) byTier.set(key, { tier: c.tier, cells: new Map() });
                  byTier.get(key)!.cells.set(c.room, c);
                }
                const tierRows = Array.from(byTier.values());

                // ── Export matriks ke CSV (Excel-friendly) ──
                const exportMatrixCsv = () => {
                  const esc = (v: string | number) => {
                    const s = String(v);
                    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                  };
                  const projectName = calc.projectName?.trim() || "Penawaran-Grup";
                  const cur = groupMatrix.displayCurrency;
                  const lines: string[] = [];
                  lines.push(`Matriks Harga Jual per Tier - ${projectName}`);
                  lines.push(`Display Currency:;${cur}`);
                  lines.push(`Margin:;${calc.marginPercent}%`);
                  lines.push(`Round To:;${calc.groupSettings.roundTo}`);
                  lines.push("");
                  lines.push(["Pax Tier", ...rooms, `HPP/pax (IDR)`].map(esc).join(";"));
                  for (const { tier, cells } of tierRows) {
                    const sample = Array.from(cells.values())[0];
                    const row: (string | number)[] = [tier.label];
                    for (const r of rooms) {
                      const cell = cells.get(r);
                      row.push(cell ? cell.perPaxDisplay : "");
                    }
                    row.push(sample ? Math.round(sample.hppPerPaxIDR) : "");
                    lines.push(row.map(esc).join(";"));
                  }
                  lines.push("");
                  lines.push(`Fixed Grup (IDR);${Math.round(groupMatrix.fixedTotalIDR)}`);
                  lines.push(`Per-Pax Flat (IDR);${Math.round(groupMatrix.perPaxFlatIDR)}`);
                  // BOM biar Excel kenal UTF-8 (karakter Rp/€/dll. aman)
                  const csv = "\uFEFF" + lines.join("\r\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  const safeName = projectName.replace(/[^a-z0-9-_ ]/gi, "_").trim() || "matriks-grup";
                  a.href = url;
                  a.download = `${safeName}_matriks-harga.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  toast.success("Matriks harga berhasil diunduh (CSV).");
                };
                // Tier dengan profit margin paling sehat (selisih jual − HPP terbesar per pax) sebagai "Best"
                const bestTier = tierRows.reduce<{ label: string; profit: number } | null>((best, row) => {
                  const sample = Array.from(row.cells.values())[0];
                  if (!sample) return best;
                  const profit = sample.perPaxIDR - sample.hppPerPaxIDR;
                  if (!best || profit > best.profit) return { label: row.tier.label, profit };
                  return best;
                }, null);
                return (
                  <div className="rounded-xl border-2 border-orange-300 overflow-hidden bg-gradient-to-br from-orange-50/40 to-white">
                    <div className="px-4 py-2.5 bg-gradient-to-r from-orange-100 to-amber-50 border-b-2 border-orange-300 flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-orange-700" />
                        <p style={M} className="text-[11px] md:text-[12px] font-extrabold uppercase tracking-wider text-orange-800">
                          Matriks Harga Jual per Tier
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p style={M} className="text-[10px] text-orange-700/80">
                          Display: <span className="font-bold">{groupMatrix.displayCurrency}</span>
                          {" · "}Round: <span className="font-bold">{calc.groupSettings.roundTo > 0 ? formatCurrency(calc.groupSettings.roundTo) : "—"}</span>
                        </p>
                        <button
                          type="button"
                          onClick={exportMatrixCsv}
                          className="h-7 px-2.5 rounded-lg text-[10px] md:text-[11px] font-bold text-white inline-flex items-center gap-1 transition-all hover:brightness-110 active:scale-95"
                          style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}
                          title="Unduh matriks harga sebagai CSV (bisa dibuka di Excel/Google Sheets)"
                        >
                          <Download className="h-3 w-3" />
                          Excel/CSV
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[11px] md:text-[12px]">
                        <thead>
                          <tr className="bg-orange-50/70">
                            <th style={M} className="px-3 py-2 text-left font-extrabold text-orange-800 uppercase tracking-wide text-[10px] md:text-[11px]">Pax Tier</th>
                            {rooms.map((r) => (
                              <th key={r} style={M} className="px-3 py-2 text-right font-extrabold text-orange-800 uppercase tracking-wide text-[10px] md:text-[11px]">{r}</th>
                            ))}
                            <th style={M} className="px-3 py-2 text-right font-extrabold text-orange-800 uppercase tracking-wide text-[10px] md:text-[11px]">HPP/pax</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tierRows.map(({ tier, cells }) => {
                            const sampleCell = Array.from(cells.values())[0];
                            const isBest = bestTier?.label === tier.label;
                            return (
                              <tr key={tier.label} className={cn(
                                "border-t border-orange-100 hover:bg-orange-50/40 transition-colors",
                                isBest && "bg-emerald-50/40"
                              )}>
                                <td style={M} className="px-3 py-2 font-bold text-slate-700">
                                  <span className="inline-flex items-center gap-1.5">
                                    {tier.label}
                                    {isBest && (
                                      <span className="text-[9px] font-extrabold uppercase tracking-wide bg-emerald-200 text-emerald-800 rounded px-1.5 py-0.5">
                                        Best
                                      </span>
                                    )}
                                  </span>
                                </td>
                                {rooms.map((r) => {
                                  const cell = cells.get(r);
                                  return (
                                    <td key={r} style={M} className="px-3 py-2 text-right font-mono font-semibold text-orange-700">
                                      {cell ? formatCurrency(cell.perPaxDisplay) : "—"}
                                    </td>
                                  );
                                })}
                                <td style={M} className="px-3 py-2 text-right font-mono text-[10px] md:text-[11px] text-slate-500">
                                  {sampleCell ? formatCurrency(sampleCell.hppPerPaxIDR) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Footer ringkasan komponen biaya */}
                    <div className="px-4 py-2.5 bg-orange-50/40 border-t border-orange-200 grid grid-cols-2 md:grid-cols-3 gap-3 text-[10px] md:text-[11px]">
                      <div>
                        <p style={M} className="text-orange-700/70 uppercase tracking-wide font-bold">Fixed Grup</p>
                        <p style={M} className="font-mono font-extrabold text-slate-800">{formatCurrency(groupMatrix.fixedTotalIDR)}</p>
                        <p style={M} className="text-slate-500">Transport + Staff + Komisi</p>
                      </div>
                      <div>
                        <p style={M} className="text-orange-700/70 uppercase tracking-wide font-bold">Per-Pax Flat</p>
                        <p style={M} className="font-mono font-extrabold text-slate-800">{formatCurrency(groupMatrix.perPaxFlatIDR)}</p>
                        <p style={M} className="text-slate-500">Tiket + Visa + Destinasi + F&B</p>
                      </div>
                      <div className="col-span-2 md:col-span-1">
                        <p style={M} className="text-orange-700/70 uppercase tracking-wide font-bold">Margin Setting</p>
                        <p style={M} className="font-mono font-extrabold text-emerald-700">+{calc.marginPercent}%</p>
                        <p style={M} className="text-slate-500">
                          Rate SAR <span className="font-mono">{fmtSAR(1)}</span> · USD <span className="font-mono">{fmtUSD(1)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

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
                          { label: "🛂 Visa", idr: quote.visaIDR, sar: quote.breakdown.filter(b => b.category === "Visa").reduce((s, b) => s + b.notesSAR, 0), usd: quote.breakdown.filter(b => b.category === "Visa").reduce((s, b) => s + b.notesUSD, 0) },
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button
                      onClick={() => setPdfOpen(true)}
                      disabled={quote.finalPrice === 0}
                      className="w-full h-9 md:h-11 rounded-xl gradient-primary text-white text-sm"
                      style={M}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" /> Lihat & Ekspor PDF
                    </Button>
                    <Button
                      onClick={handleCreateTrip}
                      disabled={creatingTrip || quote.finalPrice === 0}
                      variant="outline"
                      className="w-full h-9 md:h-11 rounded-xl border-orange-300 text-orange-700 hover:bg-orange-50 text-sm"
                      style={M}
                    >
                      <Plane className="h-3.5 w-3.5 mr-1.5" />
                      {creatingTrip ? "Membuat Trip…" : "Buat Trip"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <PdfPreviewDialog open={pdfOpen} onOpenChange={setPdfOpen} data={ighPdfData} />

      {/* ── FOOTER: Reset Default ── */}
      <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-orange-100">
        <p className="text-[11px] text-muted-foreground" style={M}>
          Selesai? Reset semua field buat mulai kalkulasi baru.
        </p>
        <Button
          onClick={handleReset}
          variant="outline"
          className="h-9 px-4 rounded-xl border-orange-300 text-orange-700 hover:bg-orange-50 text-[12px] font-semibold"
          style={M}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset Default
        </Button>
      </div>

      {/* ── Confirm dialog buat reset ── */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset semua field kalkulator?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua data kalkulasi (hotel, transport, tiket, visa, harga, dll) akan dikembalikan ke kondisi awal.
              Tindakan ini <span className="font-bold text-red-600">tidak bisa dibatalkan</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmReset}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Ya, Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── PDF Export Card (uses new IGH template generator) ────────────────────────

function PdfExportCard({
  data,
  finalPrice,
  perPax,
  formatCurrency,
  onOpenPdf,
  onCreateTrip,
  creatingTrip,
}: {
  data: IghPdfData;
  finalPrice: number;
  perPax: number;
  formatCurrency: (n: number) => string;
  onOpenPdf: () => void;
  onCreateTrip: () => void;
  creatingTrip: boolean;
}) {
  return (
    <div className="rounded-xl border-2 border-orange-300 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 md:px-5 py-3 md:py-4 bg-gradient-to-r from-orange-600 to-orange-500 text-white">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 md:h-4 md:w-4" />
          <span style={M} className="font-extrabold text-[12px] md:text-[14px] uppercase tracking-wide">
            PDF Penawaran IGH Tour
          </span>
        </div>
        <span style={M} className="text-[10px] md:text-[11px] opacity-90 hidden sm:inline">
          {data.pax} pax · {data.makkahNights + data.madinahNights} malam
        </span>
      </div>

      <div className="p-3 md:p-4 grid md:grid-cols-[200px_minmax(0,1fr)_auto] gap-4 items-start">
        {/* ── Live thumbnail PDF — auto-refresh tiap field calculator berubah ── */}
        <div className="w-full md:w-[200px]">
          <LivePdfThumbnail data={data} onClick={onOpenPdf} />
          <p className="text-[9px] text-center text-muted-foreground mt-1.5 font-medium" style={M}>
            Live preview · auto-update
          </p>
        </div>

        <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-white to-orange-50/40 p-3">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700 mb-2" style={M}>
            Pemetaan Data Template
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]" style={M}>
            <dt className="text-muted-foreground">Project Name</dt>
            <dd className="font-bold text-orange-700 truncate">{data.projectName || "—"}</dd>
            <dt className="text-muted-foreground">Timeline</dt>
            <dd className="font-semibold truncate">{data.timeline || "—"}</dd>
            <dt className="text-muted-foreground">Customer</dt>
            <dd className="font-semibold truncate">{data.customerName || "—"}</dd>
            <dt className="text-muted-foreground">Hotel Makkah</dt>
            <dd className="font-semibold truncate">{data.hotelMakkah || "—"} · {data.makkahNights} mlm</dd>
            <dt className="text-muted-foreground">Hotel Madinah</dt>
            <dd className="font-semibold truncate">{data.hotelMadinah || "—"} · {data.madinahNights} mlm</dd>
            <dt className="text-muted-foreground">Sudah Termasuk</dt>
            <dd className="font-semibold">{data.included.length} item</dd>
            <dt className="text-muted-foreground">Belum Termasuk</dt>
            <dd className="font-semibold">{data.excluded.length} item</dd>
          </dl>
          <p className="text-[10px] text-muted-foreground mt-2" style={M}>
            Klik thumbnail kiri buat preview ukuran penuh.
          </p>
        </div>

        <div className="flex flex-col gap-3 md:w-64">
          <div className="rounded-xl bg-orange-50 border border-orange-200 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700" style={M}>Harga Final</p>
            <p className="text-[13px] font-extrabold text-orange-800 mt-0.5 font-mono" style={M}>
              {formatCurrency(finalPrice)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5" style={M}>
              {formatCurrency(perPax)}/pax · {data.pax} pax
            </p>
          </div>
          <Button
            onClick={onOpenPdf}
            className="w-full h-10 md:h-11 rounded-xl gradient-primary text-white text-sm"
            style={M}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" /> Lihat &amp; Ekspor PDF
          </Button>
          <Button
            onClick={onCreateTrip}
            disabled={creatingTrip || finalPrice === 0}
            variant="outline"
            className="w-full h-10 md:h-11 rounded-xl border-orange-300 text-orange-700 hover:bg-orange-50 text-sm"
            style={M}
          >
            <Plane className="h-3.5 w-3.5 mr-1.5" />
            {creatingTrip ? "Membuat Trip…" : "Buat Trip"}
          </Button>
        </div>
      </div>
    </div>
  );
}
