import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MapPin, Users, Calendar, MoreHorizontal, Plus, Search, Pencil, Trash2, Package as PackageIcon,
  Plane, Star, Calculator, ScanLine, WalletCards, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { usePackages } from "@/features/packages/usePackages";
import { PackageFormDialog } from "@/features/packages/PackageFormDialog";
import type { Package } from "@/features/packages/packagesRepo";
import { listAllAgencyJamaah, type Jamaah } from "@/features/trips/tripsRepo";
import { computeProfessionalQuote, type HotelRow, type TransportRow, type VisaRow, type DestinationRow, type StaffRow } from "@/features/calculator/pricing";
import { useRatesStore } from "@/store/ratesStore";
import { useRegional } from "@/lib/regional";

const statusVariant: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Calculated: "bg-primary/10 text-primary",
  Confirmed: "bg-warning/10 text-warning",
  Paid: "bg-success/10 text-success",
  Completed: "bg-emerald-500/10 text-emerald-600",
};


interface ProfessionalCalcState {
  packageName: string;
  destination: string;
  pax: number;
  hotels: HotelRow[];
  transports: TransportRow[];
  visas: VisaRow[];
  destinations: DestinationRow[];
  staffs: StaffRow[];
  commissionFee: number;
  marginPercent: number;
  discount: number;
}

type EnrichedPackage = Package & {
  startDate?: string;
  departureDate?: string;
  returnDate?: string;
  airline?: string;
  maskapai?: string;
  hotelLevel?: string | number;
  hotelStars?: string | number;
  hotel?: string;
};

const CALC_STORAGE_KEY = "travelhub.package.calculations.v1";

function readPackageCalculations(): Record<string, ProfessionalCalcState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CALC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getDepartureInfo(pkg: EnrichedPackage, occupied: number) {
  const dateValue = pkg.departureDate ?? pkg.startDate;
  if (occupied >= pkg.people) {
    return { status: "Full", label: "Kuota penuh", className: "bg-emerald-500 text-white" };
  }
  if (!dateValue) {
    return { status: "Active", label: "Jadwal belum set", className: "bg-orange-500 text-white" };
  }
  const now = new Date();
  const departure = new Date(dateValue);
  const diffDays = Math.ceil((departure.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays < 0) {
    return { status: "Departed", label: "Selesai", className: "bg-slate-700 text-white" };
  }
  return { status: "Active", label: `⏳ ${diffDays} Hari Lagi`, className: "bg-orange-500 text-white" };
}

function getLogistics(pkg: EnrichedPackage) {
  const airline = pkg.airline ?? pkg.maskapai ?? "Maskapai belum set";
  const hotel = pkg.hotelLevel ?? pkg.hotelStars ?? pkg.hotel ?? "Hotel belum set";
  const hotelLabel = typeof hotel === "number" ? `${hotel}★` : String(hotel).includes("★") ? String(hotel) : String(hotel);
  return { airline, hotel: hotelLabel, days: `${pkg.days} Hari` };
}

export default function Packages() {
  const navigate = useNavigate();
  const { items, loading, create, update, remove } = usePackages();
  const rates = useRatesStore((s) => s.rates);
  const { formatCurrency } = useRegional();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Package | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState(0);
  const [allJamaah, setAllJamaah] = useState<Jamaah[]>([]);

  useEffect(() => {
    const refreshLocalData = () => setLocalVersion((v) => v + 1);
    window.addEventListener("focus", refreshLocalData);
    return () => {
      window.removeEventListener("focus", refreshLocalData);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    listAllAgencyJamaah()
      .then((rows) => { if (alive) setAllJamaah(rows); })
      .catch(() => { if (alive) setAllJamaah([]); });
    return () => { alive = false; };
  }, [localVersion, items.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) => p.name.toLowerCase().includes(q) || p.destination.toLowerCase().includes(q),
    );
  }, [items, query]);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (pkg: Package) => { setEditing(pkg); setFormOpen(true); };

  const jamaahByPackage = useMemo(() => {
    return allJamaah.reduce<Record<string, Jamaah[]>>((acc, jamaah) => {
      acc[jamaah.tripId] = [...(acc[jamaah.tripId] ?? []), jamaah];
      return acc;
    }, {});
  }, [allJamaah]);

  const calculations = useMemo(() => readPackageCalculations(), [localVersion, items]);

  const getFinancialSnapshot = (pkg: Package, occupied: number) => {
    const calc = calculations[pkg.id];
    if (calc && calc.hotels && Array.isArray(calc.hotels)) {
      const quote = computeProfessionalQuote({ ...calc, rates });
      const safePax = Math.max(1, calc.pax || 1);
      const revenue = Number.isFinite(quote.perPaxFinal) ? quote.perPaxFinal * occupied : 0;
      const margin = Number.isFinite(quote.netProfit) ? (quote.netProfit / safePax) * occupied : 0;
      return { revenue: Math.max(0, revenue), margin: Math.max(0, margin) };
    }
    const safePeople = Math.max(1, pkg.people || 1);
    const perPax = pkg.people > 0 ? (pkg.totalIDR || 0) / safePeople : 0;
    const hppPerPax = pkg.people > 0 ? (pkg.hpp || 0) / safePeople : 0;
    const margin = (perPax - hppPerPax) * occupied;
    const safeRevenue = Number.isFinite(perPax * occupied) ? perPax * occupied : 0;
    const safeMargin = Number.isFinite(margin) ? margin : 0;
    return { revenue: Math.max(0, safeRevenue), margin: Math.max(0, safeMargin) };
  };

  const openShortcut = (event: React.MouseEvent, path: string) => {
    event.stopPropagation();
    navigate(path);
  };

  const handleSubmit = async (draft: Parameters<typeof create>[0]) => {
    if (editing) {
      await update(editing.id, draft);
      toast.success("Paket diperbarui");
    } else {
      await create(draft);
      toast.success("Paket dibuat");
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await remove(deletingId);
      toast.success("Paket dihapus");
      setDeletingId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Hapus paket gagal.";
      console.error("[Packages] hapus paket gagal:", err);
      toast.error(msg);
    }
  };

  const deletingPkg = items.find((p) => p.id === deletingId);

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base md:text-2xl font-bold text-[hsl(var(--foreground))] leading-tight">Paket Trip</h1>
          <p className="text-[11px] md:text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Kelola semua paket perjalanan kamu.</p>
        </div>
        <Button
          onClick={openCreate}
          className="btn-glow h-8 md:h-9 px-2.5 md:px-3 rounded-xl text-[12px] md:text-sm shrink-0"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Tambah
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
        <Input
          placeholder="Cari paket..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 md:h-9 text-[12.5px] md:text-sm rounded-xl bg-[hsl(var(--secondary))] border-0 focus-visible:ring-1 focus-visible:ring-[hsl(var(--primary))]"
        />
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))] py-4 text-center">Memuat paket…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-[hsl(var(--border))] py-10 text-center space-y-3">
          <PackageIcon strokeWidth={1.5} className="h-8 w-8 text-[hsl(var(--muted-foreground))] mx-auto" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {query ? "Paket tidak ditemukan." : "Belum ada paket."}
          </p>
          {!query && (
            <Button variant="outline" onClick={openCreate} className="h-8 text-sm rounded-xl">
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Buat paket pertama
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 md:gap-4">
          {filtered.map((pkg) => {
            const enriched = pkg as EnrichedPackage;
            const occupied = jamaahByPackage[pkg.id]?.length ?? 0;
            const occupancyPct = Math.min(100, Math.round((occupied / Math.max(1, pkg.people)) * 100));
            const departure = getDepartureInfo(enriched, occupied);
            const logistics = getLogistics(enriched);
            const financial = getFinancialSnapshot(pkg, occupied);
            const progressColor = occupancyPct >= 90 ? "from-emerald-500 to-green-500" : occupancyPct >= 60 ? "from-amber-400 to-orange-500" : "from-orange-300 to-amber-400";

            return (
              <div
                key={pkg.id}
                onClick={() => navigate(`/packages/${pkg.id}`)}
                className="group overflow-hidden rounded-3xl border border-orange-100 bg-white shadow-[0_14px_40px_-24px_rgba(249,115,22,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-[0_20px_48px_-24px_rgba(15,23,42,0.30)]"
                style={{ fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif" }}
              >
                <div className="relative h-16 md:h-24 overflow-hidden">
                  {pkg.coverImage ? (
                    <img src={pkg.coverImage} alt={pkg.name} className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-4xl"
                      style={{ background: `linear-gradient(135deg,hsl(27 91% 54%),hsl(16 88% 58%))` }}
                    >
                      {pkg.emoji}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                  <Badge className={`${departure.className} border-0 absolute top-3 right-3 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-sm`}>
                    {departure.status}
                  </Badge>
                  <div className="absolute bottom-3 left-3 right-3 min-w-0">
                    <p className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-orange-700 backdrop-blur-sm">
                      <Calendar className="h-3 w-3 shrink-0" />
                      <span className="truncate">{departure.label}</span>
                    </p>
                  </div>
                </div>

                <div className="p-2.5 md:p-4 space-y-2 md:space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[13px] md:text-[15px] font-extrabold leading-tight text-slate-950 truncate">{pkg.name}</h3>
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-500 truncate">
                        <MapPin className="h-3 w-3 shrink-0 text-orange-500" />
                        {pkg.destination}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-full" onClick={(e) => e.stopPropagation()}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="text-sm">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(pkg); }}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); setDeletingId(pkg.id); }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Hapus
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="rounded-xl md:rounded-2xl bg-orange-50/70 p-2 md:p-3 space-y-1.5 md:space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-600">Okupansi Jemaah</span>
                      <span className="font-extrabold text-slate-900">{occupied} / {pkg.people} Jemaah</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-orange-100">
                      <div className={`h-full rounded-full bg-gradient-to-r ${progressColor} transition-all duration-500`} style={{ width: `${occupancyPct}%` }} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 md:gap-2">
                    <div className="rounded-xl md:rounded-2xl border border-slate-100 bg-slate-50 p-2 md:p-3">
                      <p className="flex items-center gap-1 text-[9px] md:text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        <WalletCards className="h-3 w-3" />
                        Revenue
                      </p>
                      <p className="mt-0.5 md:mt-1 text-[11.5px] md:text-[13px] font-extrabold text-slate-950 truncate">{formatCurrency(Math.round(financial.revenue))}</p>
                    </div>
                    <div className="rounded-xl md:rounded-2xl border border-emerald-100 bg-emerald-50/70 p-2 md:p-3">
                      <p className="flex items-center gap-1 text-[9px] md:text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        <TrendingUp className="h-3 w-3" />
                        Margin
                      </p>
                      <p className="mt-0.5 md:mt-1 text-[11.5px] md:text-[13px] font-extrabold text-emerald-700 truncate">{formatCurrency(Math.round(financial.margin))}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-orange-100 bg-orange-50/50 px-2.5 py-1.5 text-[10.5px] md:text-[11px]">
                    <span className="font-semibold text-slate-600">HPP{pkg.people > 0 ? ` (${pkg.people} pax)` : ""}</span>
                    <span className="font-extrabold text-orange-700">{pkg.hpp > 0 ? formatCurrency(Math.round(pkg.hpp)) : "—"}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-1 md:gap-1.5 text-[9.5px] md:text-[10px] font-semibold text-slate-600">
                    <span className="flex min-w-0 items-center gap-1 rounded-lg md:rounded-xl bg-white px-1.5 md:px-2 py-1.5 md:py-2 ring-1 ring-slate-100">
                      <Plane className="h-3 w-3 shrink-0 text-orange-500" />
                      <span className="truncate">{logistics.airline}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1 rounded-lg md:rounded-xl bg-white px-1.5 md:px-2 py-1.5 md:py-2 ring-1 ring-slate-100">
                      <Star className="h-3 w-3 shrink-0 text-orange-500" />
                      <span className="truncate">{logistics.hotel}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1 rounded-lg md:rounded-xl bg-white px-1.5 md:px-2 py-1.5 md:py-2 ring-1 ring-slate-100">
                      <Calendar className="h-3 w-3 shrink-0 text-orange-500" />
                      <span className="truncate">{logistics.days}</span>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 border-t border-orange-100 bg-slate-50/80">
                  <button
                    type="button"
                    onClick={(e) => openShortcut(e, `/packages/${pkg.id}?tab=calculator`)}
                    className="flex items-center justify-center gap-1 md:gap-1.5 px-1.5 md:px-2 py-2 md:py-2.5 text-[10.5px] md:text-[11px] font-bold text-slate-600 transition-colors hover:bg-orange-50 hover:text-orange-600"
                  >
                    <Calculator className="h-3.5 w-3.5" />
                    Kalkulasi
                  </button>
                  <button
                    type="button"
                    onClick={(e) => openShortcut(e, `/packages/${pkg.id}?tab=jamaah`)}
                    className="flex items-center justify-center gap-1 md:gap-1.5 border-x border-orange-100 px-1.5 md:px-2 py-2 md:py-2.5 text-[10.5px] md:text-[11px] font-bold text-slate-600 transition-colors hover:bg-orange-50 hover:text-orange-600"
                  >
                    <Users className="h-3.5 w-3.5" />
                    Jemaah
                  </button>
                  <button
                    type="button"
                    onClick={(e) => openShortcut(e, `/packages/${pkg.id}?tab=jamaah&ocr=1`)}
                    className="flex items-center justify-center gap-1 md:gap-1.5 px-1.5 md:px-2 py-2 md:py-2.5 text-[10.5px] md:text-[11px] font-bold text-slate-600 transition-colors hover:bg-orange-50 hover:text-orange-600"
                  >
                    <ScanLine className="h-3.5 w-3.5" />
                    OCR
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PackageFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent className="max-w-sm w-[calc(100%-2rem)] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Hapus paket ini?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              "{deletingPkg?.name}" akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="flex-1 h-9 rounded-xl text-sm">Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="flex-1 h-9 rounded-xl text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
