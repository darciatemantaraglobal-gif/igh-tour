import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTripsStore, useJamaahStore, useDocsStore } from "@/store/tripsStore";
import type { Trip, Jamaah } from "@/store/tripsStore";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  UserCheck, FileKey, CreditCard, BadgeCheck, Plane,
  ChevronDown, ChevronUp, Search, Users, TrendingUp,
  Activity, Check, ArrowRight, Undo2, Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePackages } from "@/features/packages/usePackages";
import type { Package, PackageStatus } from "@/features/packages/packagesRepo";
import { toast } from "sonner";

// ── Jamaah step config ────────────────────────────────────────────────────────
const JAMAAH_STEPS = [
  { key: "registered", label: "Terdaftar",      icon: UserCheck,  color: "#f97316" },
  { key: "docs",       label: "Dokumen",         icon: FileKey,    color: "#8b5cf6" },
  { key: "paid",       label: "Pembayaran",      icon: CreditCard, color: "#0ea5e9" },
  { key: "approved",   label: "Disetujui",       icon: BadgeCheck, color: "#10b981" },
  { key: "departed",   label: "Siap Berangkat",  icon: Plane,      color: "#f59e0b" },
];

// ── Package step config ───────────────────────────────────────────────────────
import { FileEdit, Calculator, CheckCircle2, Trophy } from "lucide-react";

const PKG_STEPS: { key: PackageStatus; icon: React.ElementType; label: string; desc: string }[] = [
  { key: "Draft",       icon: FileEdit,     label: "Draft",      desc: "Dibuat" },
  { key: "Calculated",  icon: Calculator,   label: "Kalkulasi",  desc: "Harga dihitung" },
  { key: "Confirmed",   icon: CheckCircle2, label: "Konfirmasi", desc: "Klien setuju" },
  { key: "Paid",        icon: CreditCard,   label: "Dibayar",    desc: "Pembayaran lunas" },
  { key: "Completed",   icon: Trophy,       label: "Selesai",    desc: "Trip rampung" },
];

const statusBadge: Record<PackageStatus, string> = {
  Draft:      "bg-muted text-muted-foreground",
  Calculated: "bg-primary/10 text-primary",
  Confirmed:  "bg-warning/10 text-warning",
  Paid:       "bg-success/10 text-success",
  Completed:  "bg-emerald-500/10 text-emerald-600",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

// ── Compute jamaah step ────────────────────────────────────────────────────────
function computeJamaahStep(j: Jamaah, docCats: string[]): number {
  const hasPassport = docCats.includes("passport");
  const hasVisa = docCats.includes("visa");
  const hasTicket = docCats.includes("ticket");
  if (hasPassport && hasVisa && hasTicket) return 4;
  if ((hasPassport || hasVisa) && j.passportNumber) return 3;
  if (hasPassport || hasVisa) return 2;
  if (j.name && j.phone) return 1;
  return 0;
}

// ── Jamaah progress row ────────────────────────────────────────────────────────
function JamaahRow({ jamaah, step, tripId }: { jamaah: Jamaah; step: number; tripId: string }) {
  const navigate = useNavigate();
  const pct = Math.round((step / (JAMAAH_STEPS.length - 1)) * 100);
  const stepColor = JAMAAH_STEPS[Math.min(step, JAMAAH_STEPS.length - 1)].color;

  return (
    <div
      className="flex items-center gap-2 py-2 px-3 md:py-3 md:px-4 hover:bg-orange-50/50 rounded-xl cursor-pointer transition-colors"
      onClick={() => navigate(`/trips/${tripId}/jamaah/${jamaah.id}`)}
    >
      <div className="h-9 w-9 rounded-full shrink-0 overflow-hidden bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
        {jamaah.photoDataUrl ? (
          <img src={jamaah.photoDataUrl} alt={jamaah.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-white text-xs font-bold">{jamaah.name.substring(0, 2).toUpperCase()}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] md:text-[13px] font-semibold text-[hsl(var(--foreground))] truncate">{jamaah.name}</span>
          <span className="text-[11px] font-bold ml-2 shrink-0" style={{ color: stepColor }}>{pct}%</span>
        </div>
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, #f97316, ${stepColor})` }}
          />
        </div>
        <div className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
          {JAMAAH_STEPS[Math.min(step, JAMAAH_STEPS.length - 1)].label}
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-1 shrink-0">
        {JAMAAH_STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className="h-7 w-7 rounded-full flex items-center justify-center"
              style={{
                background: done ? s.color : active ? `${s.color}22` : "#f3f4f6",
                outline: active ? `2px solid ${s.color}` : "none",
                outlineOffset: "1px",
              }}
            >
              <Icon
                className="h-3 w-3"
                style={{ color: done ? "#fff" : active ? s.color : "#9ca3af" }}
                strokeWidth={2}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Trip accordion ─────────────────────────────────────────────────────────────
function TripBlock({ trip, jamaahList, docMap }: { trip: Trip; jamaahList: Jamaah[]; docMap: Record<string, string[]> }) {
  const [open, setOpen] = useState(true);
  const steps = jamaahList.map((j) => computeJamaahStep(j, docMap[j.id] ?? []));
  const avgPct = jamaahList.length
    ? Math.round((steps.reduce((a, b) => a + b, 0) / (jamaahList.length * (JAMAAH_STEPS.length - 1))) * 100)
    : 0;

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-3 md:px-5 md:py-3.5 hover:bg-orange-50/40 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}>
            <Plane className="h-4 w-4 text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0 text-left">
            <div className="text-[12px] md:text-[13px] font-bold text-[hsl(var(--foreground))] truncate">{trip.name}</div>
            <div className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">{jamaahList.length} jamaah · Progres {avgPct}%</div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          <svg className="h-9 w-9 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="14" fill="none" stroke="#f1f5f9" strokeWidth="4" />
            <circle cx="18" cy="18" r="14" fill="none" stroke="#f97316" strokeWidth="4"
              strokeDasharray={`${(avgPct / 100) * 88} 88`} strokeLinecap="round" />
          </svg>
          {open ? <ChevronUp className="h-4 w-4 text-[hsl(var(--muted-foreground))]" /> : <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />}
        </div>
      </button>

      {open && (
        <div className="divide-y divide-[hsl(var(--border))]">
          {jamaahList.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">Belum ada jamaah di trip ini.</div>
          ) : (
            jamaahList.map((j, i) => (
              <JamaahRow key={j.id} jamaah={j} step={steps[i]} tripId={trip.id} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Package tracker card ───────────────────────────────────────────────────────
function PackageTrackerSection() {
  const { items, loading, update } = usePackages();

  const sorted = useMemo(
    () => [...items].sort((a, b) =>
      PKG_STEPS.findIndex((s) => s.key === a.status) - PKG_STEPS.findIndex((s) => s.key === b.status)
    ),
    [items]
  );

  const setStatus = async (pkg: Package, status: PackageStatus) => {
    if (pkg.status === status) return;
    await update(pkg.id, { status });
    toast.success(`${pkg.name} → ${status}`);
  };

  const advance  = (pkg: Package) => { const i = PKG_STEPS.findIndex((s) => s.key === pkg.status); if (i < PKG_STEPS.length - 1) setStatus(pkg, PKG_STEPS[i + 1].key); };
  const rollback = (pkg: Package) => { const i = PKG_STEPS.findIndex((s) => s.key === pkg.status); if (i > 0) setStatus(pkg, PKG_STEPS[i - 1].key); };

  if (loading) return null;
  if (sorted.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-[12.5px] md:text-sm font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 md:h-4 md:w-4 text-[hsl(var(--primary))]" strokeWidth={1.5} />
        Status Paket
      </h2>
      {sorted.map((pkg) => {
        const currentIdx = PKG_STEPS.findIndex((s) => s.key === pkg.status);
        const progressPct = (currentIdx / (PKG_STEPS.length - 1)) * 100;
        return (
          <div key={pkg.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white shadow-sm overflow-hidden">
            <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-bold truncate">{pkg.name}</span>
                  <Badge className={cn(statusBadge[pkg.status], "border-0 text-[10px] px-1.5 h-4 shrink-0 font-medium")}>{pkg.status}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span className="truncate">{pkg.destination}</span>
                  <span className="flex items-center gap-0.5 shrink-0"><Clock className="h-2.5 w-2.5" />{timeAgo(pkg.updatedAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="outline" size="icon" className="h-7 w-7 rounded-lg" onClick={() => rollback(pkg)} disabled={currentIdx === 0} title="Mundur"><Undo2 className="h-3 w-3" /></Button>
                <Button size="sm" className="h-7 px-2.5 rounded-lg text-[11px] font-semibold gradient-primary text-white" onClick={() => advance(pkg)} disabled={currentIdx === PKG_STEPS.length - 1}>Lanjut <ArrowRight className="h-3 w-3 ml-1" /></Button>
              </div>
            </div>
            <div className="px-3 pb-3">
              <div className="relative">
                <div className="absolute left-0 right-0 top-4 h-0.5 bg-[hsl(var(--border))]" />
                <div className="absolute left-0 top-4 h-0.5 gradient-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
                <div className="relative grid grid-cols-5">
                  {PKG_STEPS.map((step, idx) => {
                    const isComplete = idx < currentIdx;
                    const isCurrent  = idx === currentIdx;
                    const Icon = step.icon;
                    return (
                      <button key={step.key} type="button" onClick={() => setStatus(pkg, step.key)}
                        className="flex flex-col items-center text-center focus:outline-none group/step">
                        <div className={cn("h-8 w-8 flex items-center justify-center bg-white z-10 cursor-pointer group-hover/step:scale-110 transition-all",
                          isCurrent && "text-[hsl(var(--primary))] scale-110", !isComplete && !isCurrent && "text-[hsl(var(--muted-foreground))]")}>
                          {isComplete ? <Check className="h-3.5 w-3.5 text-[hsl(var(--primary))]" /> : <Icon className="h-3.5 w-3.5" />}
                        </div>
                        <div className="mt-1.5">
                          <div className={cn("text-[10px] font-semibold leading-tight",
                            isCurrent ? "text-[hsl(var(--primary))]" : isComplete ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]")}>
                            {step.label}
                          </div>
                          <div className="text-[9px] text-[hsl(var(--muted-foreground))] mt-0.5">{step.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ProgressTracker() {
  const trips = useTripsStore((s) => s.trips);
  const { jamaah, fetchJamaah } = useJamaahStore();
  const { docs, fetchDocs } = useDocsStore();
  const [search, setSearch] = useState("");
  // useRef bukan useState → tracking tanpa memicu re-render tambahan.
  const loadedTripsRef = useRef<Set<string>>(new Set());
  const fetchedDocsRef = useRef<Set<string>>(new Set());

  // Fetch jamaah hanya untuk trip yang BELUM pernah di-load.
  useEffect(() => {
    trips.forEach((t) => {
      if (!loadedTripsRef.current.has(t.id)) {
        loadedTripsRef.current.add(t.id);
        fetchJamaah(t.id);
      }
    });
  }, [trips]);

  // Fetch docs hanya untuk jamaah yang BELUM pernah di-fetch.
  // Dependency: array jamaah (bukan .length) supaya ikut trigger saat jamaah
  // dari trip lain ditambahkan ke store (reference berubah, length bisa sama).
  useEffect(() => {
    jamaah.forEach((j) => {
      if (!fetchedDocsRef.current.has(j.id)) {
        fetchedDocsRef.current.add(j.id);
        fetchDocs(j.id);
      }
    });
  }, [jamaah]);

  // Build docMap: jamaahId → category[]
  const docMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    docs.forEach((d) => {
      if (!map[d.jamaahId]) map[d.jamaahId] = [];
      if (!map[d.jamaahId].includes(d.category)) map[d.jamaahId].push(d.category);
    });
    return map;
  }, [docs]);

  const totalJamaah = jamaah.length;
  const steps = jamaah.map((j) => computeJamaahStep(j, docMap[j.id] ?? []));
  const fullyDone = steps.filter((s) => s >= JAMAAH_STEPS.length - 1).length;
  const avgStep = totalJamaah ? steps.reduce((a, b) => a + b, 0) / totalJamaah : 0;
  const overallPct = Math.round((avgStep / (JAMAAH_STEPS.length - 1)) * 100);

  const filteredTrips = trips.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    jamaah.some((j) => j.tripId === t.id && j.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-3xl mx-auto space-y-3 md:space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1 className="text-base md:text-2xl font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
          <TrendingUp strokeWidth={1.5} className="h-4 w-4 md:h-5 md:w-5 text-[hsl(var(--primary))]" />
          Progress Tracker
        </h1>
        <p className="text-xs md:text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
          Pantau kelengkapan dokumen & status jamaah dan paket trip secara real-time.
        </p>
      </motion.div>

      {/* Summary cards */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}
        className="grid grid-cols-3 gap-2">
        {[
          { label: "Total Jamaah", value: totalJamaah, icon: Users, color: "#f97316" },
          { label: "Siap Berangkat", value: fullyDone, icon: Plane, color: "#10b981" },
          { label: "Progres Rata-rata", value: `${overallPct}%`, icon: TrendingUp, color: "#8b5cf6" },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-[hsl(var(--border))] bg-white px-2 py-2.5 md:px-4 md:py-3.5 text-center">
            <div className="h-7 w-7 md:h-8 md:w-8 rounded-xl mx-auto mb-1 md:mb-1.5 flex items-center justify-center" style={{ background: `${card.color}18` }}>
              <card.icon className="h-3.5 w-3.5 md:h-4 md:w-4" style={{ color: card.color }} strokeWidth={2} />
            </div>
            <div className="text-base md:text-lg font-bold text-[hsl(var(--foreground))]">{card.value}</div>
            <div className="text-[9px] md:text-[10px] text-[hsl(var(--muted-foreground))] leading-tight">{card.label}</div>
          </div>
        ))}
      </motion.div>

      {/* Overall progress bar */}
      {totalJamaah > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 md:px-5 md:py-4">
          <div className="flex items-center justify-between mb-1.5 md:mb-2">
            <span className="text-[12px] md:text-sm font-semibold text-[hsl(var(--foreground))]">Progres Jamaah Keseluruhan</span>
            <span className="text-[12px] md:text-sm font-bold text-orange-500">{overallPct}%</span>
          </div>
          <div className="w-full h-2 md:h-3 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${overallPct}%` }}
              transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #f97316, #fb923c, #fbbf24)" }}
            />
          </div>
          <div className="flex justify-between mt-2">
            {JAMAAH_STEPS.map((s) => (
              <div key={s.key} className="flex flex-col items-center gap-0.5">
                <div className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[8px] text-[hsl(var(--muted-foreground))] block">{s.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Package tracker */}
      <PackageTrackerSection />

      {/* Jamaah search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-[hsl(var(--muted-foreground))]" strokeWidth={1.5} />
        <Input placeholder="Cari trip atau nama jamaah…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="pl-8 md:pl-10 h-9 md:h-10 text-[12.5px] md:text-sm rounded-xl bg-white border-[hsl(var(--border))]" />
      </div>

      {/* Trip blocks */}
      {filteredTrips.length === 0 ? (
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-white py-10 md:py-16 text-center">
          <TrendingUp className="h-8 w-8 md:h-10 md:w-10 mx-auto mb-2 md:mb-3 text-gray-200" />
          <p className="text-[12.5px] md:text-sm text-[hsl(var(--muted-foreground))] px-4">
            {trips.length === 0 ? "Belum ada trip. Buat trip terlebih dahulu di Dashboard." : "Tidak ada hasil untuk pencarian ini."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 md:space-y-4">
          {filteredTrips.map((trip, i) => (
            <motion.div key={trip.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 + i * 0.06 }}>
              <TripBlock trip={trip} jamaahList={jamaah.filter((j) => j.tripId === trip.id)} docMap={docMap} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
