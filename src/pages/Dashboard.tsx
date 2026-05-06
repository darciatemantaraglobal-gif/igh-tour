import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LiveClock } from "@/components/LiveClock";
import { AdminWhatsappCard } from "@/components/AdminWhatsappCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Plus, MapPin, Calendar as CalendarIcon, Trash2, Plane, Camera, Calculator, Users, CheckCircle, TrendingUp, ArrowRight, FileBarChart, Bus, Train, AlertCircle, Clock, Star, ChevronRight, Wallet, RefreshCw } from "lucide-react";
import { useTripsStore, type Trip } from "@/store/tripsStore";
import { listAllAgencyJamaah } from "@/features/trips/tripsRepo";
import { listAllAgencyPayments, sumPaid, type Payment } from "@/features/payments/paymentsRepo";
import type { Jamaah } from "@/features/trips/tripsRepo";
import { useRatesStore } from "@/store/ratesStore";
import { usePackagesStore } from "@/store/packagesStore";
import { useAuthStore } from "@/store/authStore";
import { formatDateStr, getLocale, useT } from "@/lib/regional";
import { useRegionalStore } from "@/store/regionalStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { motion, type Variants } from "framer-motion";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] },
  }),
};

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};


function getGreeting(name: string, t: ReturnType<typeof useT>): string {
  const h = new Date().getHours();
  const prefix =
    h < 5 ? t.greeting_early_morning :
    h < 12 ? t.greeting_morning :
    h < 15 ? t.greeting_day :
    h < 18 ? t.greeting_afternoon : t.greeting_evening;
  const firstName = name.split(" ")[0];
  return `${prefix}, ${firstName}!`;
}

function formatTodayFull(locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  Calculated: "bg-blue-50 text-blue-600",
  Confirmed: "bg-amber-50 text-amber-600",
  Paid: "bg-emerald-50 text-emerald-700",
  Completed: "bg-purple-50 text-purple-700",
};

const EMOJIS = ["🕌", "🌴", "🗼", "🏝️", "🏔️", "🌸", "🌍", "✈️", "🛕", "🏖️", "🌺", "🎑"];

const GRADIENTS: [string, string][] = [
  ["#7C5FF5", "#9B84F7"],
  ["#3B82F6", "#60A5FA"],
  ["#10B981", "#34D399"],
  ["#F59E0B", "#FBBF24"],
  ["#EF4444", "#F87171"],
  ["#8B5CF6", "#A78BFA"],
  ["#06B6D4", "#22D3EE"],
  ["#EC4899", "#F472B6"],
];

function cardGradient(id: string): [string, string] {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return GRADIENTS[hash % GRADIENTS.length];
}

function formatDate(iso: string) {
  if (!iso) return "—";
  const { timezone, language, dateFormat } = useRegionalStore.getState();
  return formatDateStr(iso, dateFormat, timezone, getLocale(language), "short");
}

function formatShortDate(iso: string) {
  if (!iso) return "—";
  const { timezone, language } = useRegionalStore.getState();
  const locale = getLocale(language);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: timezone }).format(
    new Date(iso + "T00:00:00")
  );
}

function nightCount(start: string, end: string) {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  const d = Math.round(diff / 86400000);
  return d > 0 ? `${d} hari` : "—";
}

function daysUntil(iso: string) {
  const diff = new Date(iso + "T00:00:00").getTime() - Date.now();
  const d = Math.ceil(diff / 86400000);
  if (d < 0) return "Selesai";
  if (d === 0) return "Hari ini";
  return `${d} hari lagi`;
}

// ── ADD TRIP DIALOG ────────────────────────────────────────────────────────────
function AddTripDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addTrip = useTripsStore((s) => s.addTrip);
  const [form, setForm] = useState({ name: "", destination: "", startDate: "", endDate: "", emoji: "🕌", quotaPax: "" as string, pricePerPax: "" as string });
  const [loading, setLoading] = useState(false);

  const reset = () => setForm({ name: "", destination: "", startDate: "", endDate: "", emoji: "🕌", quotaPax: "", pricePerPax: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.destination || !form.startDate || !form.endDate) {
      toast.error("Harap lengkapi semua field.");
      return;
    }
    const quotaNum = form.quotaPax.trim() === "" ? undefined : Math.max(1, parseInt(form.quotaPax, 10) || 0);
    const priceNum = form.pricePerPax.trim() === "" ? undefined : Math.max(0, parseFloat(form.pricePerPax.replace(/[^0-9.]/g, "")) || 0);
    const draft = {
      name: form.name,
      destination: form.destination,
      startDate: form.startDate,
      endDate: form.endDate,
      emoji: form.emoji,
      quotaPax: quotaNum,
      pricePerPax: priceNum,
    };
    // Tutup dialog langsung — save jalan di background
    reset();
    onClose();
    void (async () => {
      try {
        await addTrip(draft);
        toast.success(`Paket "${draft.name}" berhasil ditambahkan.`);
      } catch {
        toast.error(`Gagal menyimpan "${draft.name}". Coba lagi.`);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden rounded-2xl border border-[hsl(var(--border))] shadow-xl bg-white">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[hsl(var(--border))]">
          <DialogTitle className="text-[14px] font-bold text-[hsl(var(--foreground))] flex items-center gap-2">
            <span className="text-lg">{form.emoji}</span>
            Tambah Paket Trip
          </DialogTitle>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">Isi detail trip baru Anda</p>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pt-3.5 pb-4 space-y-3">
          {/* Emoji picker */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Ikon</p>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((e) => (
                <button key={e} type="button" onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                  className={cn(
                    "h-8 w-8 rounded-xl text-base flex items-center justify-center border-2 transition-all duration-150",
                    form.emoji === e
                      ? "border-[hsl(var(--primary))] bg-orange-50 scale-110 shadow-sm"
                      : "border-[hsl(var(--border))] hover:border-orange-300 hover:bg-orange-50/50"
                  )}>{e}</button>
              ))}
            </div>
          </div>

          {/* Name + Destination */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Nama Paket *</Label>
              <Input
                className="h-8 text-[12.5px] rounded-xl"
                placeholder="Umrah Ramadhan"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Destinasi *</Label>
              <Select value={form.destination} onValueChange={(v) => setForm((f) => ({ ...f, destination: v }))}>
                <SelectTrigger className="h-8 text-[12.5px] rounded-xl">
                  <SelectValue placeholder="Pilih rute" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mekkah - Madinah - Thaif">Mekkah - Madinah - Thaif</SelectItem>
                  <SelectItem value="Mekkah - Madinah">Mekkah - Madinah</SelectItem>
                  <SelectItem value="Madinah - Mekkah">Madinah - Mekkah</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Berangkat *</Label>
              <Input className="h-8 text-[12.5px] rounded-xl" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Pulang *</Label>
              <Input className="h-8 text-[12.5px] rounded-xl" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </div>
          </div>

          {/* Quota & Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Kuota Pax (opsional)</Label>
              <Input
                className="h-8 text-[12.5px] rounded-xl"
                type="number" min={1} inputMode="numeric"
                placeholder="cth: 40"
                value={form.quotaPax}
                onChange={(e) => setForm((f) => ({ ...f, quotaPax: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Harga / Pax (IDR)</Label>
              <Input
                className="h-8 text-[12.5px] rounded-xl"
                type="number" min={0} inputMode="numeric"
                placeholder="cth: 35000000"
                value={form.pricePerPax}
                onChange={(e) => setForm((f) => ({ ...f, pricePerPax: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-snug -mt-1">
            Harga dipakai buat hitung sisa tagihan jamaah & alert H-30 belum lunas.
          </p>

          {/* Footer */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              className="flex-1 h-9 rounded-xl text-[12.5px] font-semibold bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--border))] transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-9 rounded-xl text-[12.5px] font-bold text-white transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}
            >
              {loading ? "Menyimpan…" : "Simpan Paket"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── TRIP CARD ──────────────────────────────────────────────────────────────────
function TripCard({ trip, onDelete }: { trip: Trip; onDelete: (t: Trip) => void }) {
  const navigate = useNavigate();
  const patchTrip = useTripsStore((s) => s.patchTrip);
  const [from, to] = cardGradient(trip.id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      await patchTrip(trip.id, { coverImage: reader.result as string });
      toast.success("Foto cover berhasil diperbarui.");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <motion.div
      className="group relative rounded-xl md:rounded-2xl overflow-hidden cursor-pointer border border-[hsl(var(--border))] bg-white"
      onClick={() => navigate(`/trips/${trip.id}`)}
      variants={fadeUp}
      whileHover={{ y: -3, boxShadow: "0 10px 28px -6px hsl(27 91% 54% / 0.14)" }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {/* Cover area */}
      <div
        className="relative h-24 sm:h-32 md:h-40 flex items-center justify-center overflow-hidden"
        style={trip.coverImage ? {} : { background: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        {trip.coverImage ? (
          <img
            src={trip.coverImage}
            alt={trip.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <span className="text-4xl md:text-7xl drop-shadow-lg select-none">{trip.emoji}</span>
        )}

        {/* Overlay gradient for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />

        {/* Duration badge */}
        <span className="absolute bottom-2 left-2 md:bottom-3 md:left-3 text-[10px] md:text-[11px] font-semibold bg-white/20 backdrop-blur-sm text-white px-2 md:px-2.5 py-0.5 md:py-1 rounded-full z-10">
          {nightCount(trip.startDate, trip.endDate)}
        </span>

        {/* Change photo button */}
        <button
          className="absolute bottom-2 right-2 md:bottom-3 md:right-3 h-6 w-6 md:h-7 md:w-7 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/50 flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all z-10"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          title="Ganti foto"
        >
          <Camera strokeWidth={1.5} className="h-3.5 w-3.5 text-white" />
        </button>

        {/* Delete */}
        <button
          className="absolute top-2 right-2 md:top-3 md:right-3 h-6 w-6 md:h-7 md:w-7 rounded-full bg-white/20 backdrop-blur-sm hover:bg-red-500 flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all z-10"
          onClick={(e) => { e.stopPropagation(); onDelete(trip); }}
          title="Hapus paket"
        >
          <Trash2 strokeWidth={1.5} className="h-3.5 w-3.5 text-white" />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoChange}
        />
      </div>

      {/* Info */}
      <div className="p-2.5 md:p-3.5">
        <h3 className="font-semibold text-[13px] md:text-[13.5px] text-[hsl(var(--foreground))] line-clamp-1">{trip.name}</h3>
        <div className="flex items-center gap-1 mt-0.5 md:mt-1 text-[11px] md:text-xs text-[hsl(var(--muted-foreground))]">
          <MapPin strokeWidth={1.5} className="h-3 w-3 shrink-0 text-[hsl(var(--primary))]" />
          <span className="line-clamp-1">{trip.destination}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-[11px] md:text-xs text-[hsl(var(--muted-foreground))]">
          <CalendarIcon strokeWidth={1.5} className="h-3 w-3 shrink-0" />
          <span>{formatDate(trip.startDate)} – {formatDate(trip.endDate)}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── RIGHT PANEL ────────────────────────────────────────────────────────────────
function RightPanel({ trips, totalJamaah }: { trips: Trip[]; totalJamaah: number }) {
  const navigate = useNavigate();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const rates = useRatesStore((s) => s.rates);

  const upcoming = [...trips]
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, 4);

  const active = trips.filter((t) => new Date(t.endDate).getTime() >= Date.now()).length;
  const done = trips.length - active;

  return (
    <div className="w-72 xl:w-80 shrink-0 border-l border-[hsl(var(--border))] flex flex-col overflow-auto">
      <div className="p-5 space-y-5">
        {/* Mini calendar */}
        <div>
          <h3 className="text-[13px] font-semibold text-[hsl(var(--foreground))] mb-3">Kalender</h3>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-2 overflow-hidden">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              className="w-full"
              classNames={{
                months: "w-full",
                month: "w-full space-y-2",
                caption: "flex justify-center items-center gap-2 px-1 pt-1",
                caption_label: "text-[13px] font-semibold text-[hsl(var(--foreground))]",
                nav: "flex items-center gap-1",
                nav_button: cn(
                  "h-7 w-7 rounded-lg flex items-center justify-center",
                  "bg-white border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]",
                  "hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--primary))] transition-smooth"
                ),
                nav_button_previous: "",
                nav_button_next: "",
                table: "w-full border-collapse",
                head_row: "flex w-full",
                head_cell: "text-[hsl(var(--muted-foreground))] text-[11px] font-medium flex-1 text-center py-1",
                row: "flex w-full mt-1",
                cell: "flex-1 text-center text-[12px] relative p-0",
                day: cn(
                  "h-7 w-7 mx-auto rounded-lg font-medium text-[12px]",
                  "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--primary))]",
                  "transition-smooth"
                ),
                day_selected: "!bg-[hsl(var(--primary))] !text-white !rounded-lg hover:!bg-[hsl(var(--primary))]",
                day_today: "font-bold text-[hsl(var(--primary))] underline decoration-[hsl(var(--primary))]",
                day_outside: "text-[hsl(var(--muted-foreground))] opacity-40",
                day_disabled: "text-[hsl(var(--muted-foreground))] opacity-30",
              }}
            />
          </div>
        </div>

        {/* Upcoming trips */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-[hsl(var(--foreground))]">Jadwal Terdekat</h3>
            <button className="text-[11px] text-[hsl(var(--primary))] font-medium hover:underline">Lihat semua</button>
          </div>

          {upcoming.length === 0 ? (
            <div className="text-center py-8 text-xs text-[hsl(var(--muted-foreground))]">
              Belum ada jadwal trip.
            </div>
          ) : (
            <div className="space-y-2.5">
              {upcoming.map((trip) => {
                const [from] = cardGradient(trip.id);
                const countDown = daysUntil(trip.startDate);
                const isPast = countDown === "Selesai";
                return (
                  <div key={trip.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-2.5">
                    <div className="h-10 w-10 rounded-xl shrink-0 flex items-center justify-center text-2xl overflow-hidden"
                      style={{ background: `${from}22` }}>
                      {trip.coverImage ? (
                        <img src={trip.coverImage} alt={trip.name} className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <span className="text-xl">{trip.emoji}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-semibold text-[hsl(var(--foreground))] truncate">{trip.name}</p>
                      <div className="flex items-center gap-1 mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                        <CalendarIcon strokeWidth={1.5} className="h-3 w-3 shrink-0" />
                        <span>{formatShortDate(trip.startDate)} – {formatShortDate(trip.endDate)}</span>
                      </div>
                    </div>
                    <span className={cn(
                      "text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap",
                      isPast ? "bg-gray-100 text-gray-500" : "bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"
                    )}>
                      {countDown}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Transportation quick access */}
        <div>
          <h3 className="text-[13px] font-semibold text-[hsl(var(--foreground))] mb-3">Transportasi</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Plane, label: "Pesawat" },
              { icon: Bus, label: "Bus" },
              { icon: Train, label: "Kereta" },
            ].map((t) => (
              <button key={t.label}
                className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))] transition-smooth group">
                <t.icon strokeWidth={1.5} className="h-5 w-5" />
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))]">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Laporan ringkasan */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-[hsl(var(--foreground))]">Laporan</h3>
            <button
              onClick={() => navigate("/progress")}
              className="text-[11px] text-[hsl(var(--primary))] font-medium hover:underline"
            >
              Lihat detail
            </button>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-3.5 space-y-3">
            {[
              { icon: Plane, label: "Total Paket Trip", value: trips.length },
              { icon: CheckCircle, label: "Trip Selesai", value: done },
              { icon: TrendingUp, label: "Trip Aktif", value: active },
              { icon: Users, label: "Total Jamaah", value: totalJamaah },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className="h-8 w-8 flex items-center justify-center shrink-0">
                  <item.icon strokeWidth={1.5} className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{item.label}</p>
                </div>
                <span className="text-[14px] font-bold text-[hsl(var(--foreground))]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Kalkulator cepat */}
        <div>
          <h3 className="text-[13px] font-semibold text-[hsl(var(--foreground))] mb-3">Kalkulator</h3>
          <div
            onClick={() => navigate("/calculator")}
            className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3.5 cursor-pointer hover:border-[hsl(var(--primary))] hover:shadow-sm transition-all group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="h-9 w-9 flex items-center justify-center shrink-0">
                <Calculator strokeWidth={1.5} className="h-4.5 w-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[hsl(var(--foreground))]">Kalkulator Paket</p>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Hitung biaya trip + PDF</p>
              </div>
              <ArrowRight strokeWidth={1.5} className="h-4 w-4 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] transition-colors" />
            </div>
            {/* Rate preview */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { currency: "USD", rate: rates.USD },
                { currency: "SAR", rate: rates.SAR },
              ].map((r) => (
                <div key={r.currency} className="rounded-xl bg-[hsl(var(--secondary))] px-2.5 py-2 text-center">
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{r.currency} → IDR</p>
                  <p className="text-[12px] font-bold text-[hsl(var(--foreground))]">
                    {r.rate.toLocaleString("id-ID")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Laporan lengkap cta */}
        <button
          onClick={() => navigate("/progress")}
          className="w-full flex items-center gap-2.5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))] transition-all group"
        >
          <FileBarChart strokeWidth={1.5} className="h-4.5 w-4.5 text-[hsl(var(--primary))]" />
          <span className="text-[13px] font-medium text-[hsl(var(--foreground))] flex-1 text-left">Lihat Laporan Lengkap</span>
          <ArrowRight strokeWidth={1.5} className="h-4 w-4 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] transition-colors" />
        </button>
      </div>
    </div>
  );
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
// ── PAYMENT ALERTS (H-30 belum lunas) ──────────────────────────────────────────
interface UnpaidAlert {
  jamaah: Jamaah;
  trip: Trip;
  daysLeft: number;
  paid: number;
  outstanding: number;
}

function fmtIDRShort(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function PaymentAlerts({ trips, allJamaah }: { trips: Trip[]; allJamaah: Jamaah[] }) {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<UnpaidAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Tunggu jamaah tersedia sebelum mulai (data sudah di-fetch paralel di Dashboard).
    if (allJamaah.length === 0) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Hanya fetch payments — jamaah sudah diterima sebagai prop, tidak perlu
        // listAllAgencyJamaah() lagi (menghilangkan double round-trip ke Supabase).
        const allPayments = await listAllAgencyPayments();
        if (cancelled) return;
        const byJamaah = new Map<string, Payment[]>();
        for (const p of allPayments) {
          const arr = byJamaah.get(p.jamaahId) ?? [];
          arr.push(p);
          byJamaah.set(p.jamaahId, arr);
        }
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tripById = new Map(trips.map((t) => [t.id, t] as const));
        const out: UnpaidAlert[] = [];
        for (const j of allJamaah) {
          const trip = tripById.get(j.tripId);
          if (!trip || !trip.startDate || !trip.pricePerPax || trip.pricePerPax <= 0) continue;
          const dep = new Date(trip.startDate);
          if (isNaN(dep.getTime())) continue;
          const days = Math.ceil((dep.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (days < 0 || days > 30) continue;
          const paid = sumPaid(byJamaah.get(j.id) ?? []);
          const outstanding = trip.pricePerPax - paid;
          if (outstanding <= 0) continue;
          out.push({ jamaah: j, trip, daysLeft: days, paid, outstanding });
        }
        out.sort((a, b) => a.daysLeft - b.daysLeft);
        setAlerts(out);
      } catch (err) {
        console.error("[payment-alerts]", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // allJamaah: reference berubah hanya saat mount & manual refresh — aman sebagai dep.
  }, [trips, allJamaah]);

  if (loading) return null;
  if (alerts.length === 0) return null;

  const totalOutstanding = alerts.reduce((s, a) => s + a.outstanding, 0);

  return (
    <motion.div
      className="mb-4 md:mb-5"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.14, ease: "easeOut" }}
    >
      <div className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-orange-50 overflow-hidden">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full px-4 md:px-5 py-3 flex items-center justify-between gap-3 hover:bg-red-100/40 transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-xl bg-red-500 flex items-center justify-center shrink-0">
              <Wallet strokeWidth={2} className="h-4 w-4 text-white" />
            </div>
            <div className="text-left min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[13.5px] md:text-[14px] font-bold text-red-700">Tagihan Belum Lunas (H-30)</h2>
                <span className="h-5 px-2 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center">{alerts.length}</span>
              </div>
              <p className="text-[11px] text-red-600/80 mt-0.5 truncate">
                Total kurang bayar: <strong>{fmtIDRShort(totalOutstanding)}</strong>
              </p>
            </div>
          </div>
          <ChevronRight strokeWidth={2} className={cn("h-4 w-4 text-red-500 shrink-0 transition-transform", !collapsed && "rotate-90")} />
        </button>

        {!collapsed && (
          <div className="px-3 md:px-4 pb-3 md:pb-4 space-y-2">
            {alerts.slice(0, 8).map((a) => (
              <button
                key={a.jamaah.id}
                onClick={() => navigate(`/trips/${a.trip.id}/jamaah/${a.jamaah.id}`)}
                className="w-full flex items-center gap-3 rounded-xl bg-white border border-red-100 p-3 hover:border-red-300 hover:shadow-sm transition-all text-left"
              >
                <div className={cn(
                  "h-9 w-9 rounded-xl shrink-0 flex items-center justify-center text-white text-sm font-bold",
                  a.daysLeft <= 7 ? "bg-red-500" : a.daysLeft <= 14 ? "bg-orange-500" : "bg-amber-500"
                )}>
                  {a.daysLeft <= 0 ? "H!" : `H-${a.daysLeft}`}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[hsl(var(--foreground))] truncate">{a.jamaah.name}</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                    {a.trip.emoji} {a.trip.name}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[12.5px] font-bold text-red-600 leading-tight">{fmtIDRShort(a.outstanding)}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">kurang</p>
                </div>
                <ChevronRight strokeWidth={1.5} className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0" />
              </button>
            ))}
            {alerts.length > 8 && (
              <p className="text-center text-[11px] text-red-600/70 pt-1">
                +{alerts.length - 8} jamaah lainnya — buka tiap paket buat detail.
              </p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { trips, loadingTrips, fetchTrips, removeTrip } = useTripsStore();
  const { items: packages, loaded: packagesLoaded, refresh: refreshPackages } = usePackagesStore();
  const user = useAuthStore((s) => s.user);
  const { language } = useRegionalStore();
  const locale = getLocale(language);
  const t = useT();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Trip | null>(null);
  const [tab, setTab] = useState<"all" | "upcoming" | "done">("all");
  const [totalJamaah, setTotalJamaah] = useState(0);
  const [allJamaah, setAllJamaah] = useState<Jamaah[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const STATUS_LABELS: Record<string, string> = {
    Draft: t.status_draft,
    Calculated: t.status_calculated,
    Confirmed: t.status_confirmed,
    Paid: t.status_paid,
    Completed: t.status_completed,
  };

  // Satu useEffect, semua fetch jalan paralel sejak mount — tidak ada waterfall.
  // fetchTrips & refreshPackages adalah referensi stabil dari Zustand (tidak perlu
  // dimasukkan ke deps array — referensinya tidak pernah berubah antar render).
  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      fetchTrips(),
      refreshPackages(),
      listAllAgencyJamaah(),
    ]).then(([, , jamaahResult]) => {
      if (!alive) return;
      const rows = jamaahResult.status === "fulfilled" ? jamaahResult.value : [];
      setTotalJamaah(rows.length);
      setAllJamaah(rows);
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const [, , jamaah] = await Promise.all([
        fetchTrips(),
        refreshPackages(),
        listAllAgencyJamaah().catch(() => [] as Jamaah[]),
      ]);
      setTotalJamaah(jamaah.length);
      setAllJamaah(jamaah);
      toast.success("Data dashboard diperbarui dari Supabase.");
    } catch (err) {
      toast.error(`Gagal memuat ulang: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = trips.filter((t) => {
    if (tab === "all") return true;
    const past = new Date(t.endDate).getTime() < Date.now();
    return tab === "done" ? past : !past;
  });

  const activeTrips = trips.filter((t) => new Date(t.endDate).getTime() >= Date.now()).length;
  const doneTrips = trips.length - activeTrips;

  const pendingPackages = packages.filter((p) => !["Paid", "Completed"].includes(p.status));
  const nearestDeparture = [...packages]
    .filter((p) => p.departureDate && new Date(p.departureDate + "T00:00:00").getTime() >= Date.now())
    .sort((a, b) => new Date(a.departureDate!).getTime() - new Date(b.departureDate!).getTime())[0];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await removeTrip(deleteTarget.id);
      toast.success(`Paket "${deleteTarget.name}" dihapus.`);
      setDeleteTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Hapus trip gagal.";
      console.error("[Dashboard] hapus trip gagal:", err);
      toast.error(msg);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ── Main content ── */}
      <div className="flex-1 overflow-auto min-w-0 p-3 md:p-6 lg:p-8 pb-6">

        {/* ── Greeting hero ── */}
        <motion.div
          className="mb-3 md:mb-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            className="relative overflow-hidden rounded-2xl md:rounded-3xl border border-orange-100 p-3 md:p-5"
            style={{
              background:
                "linear-gradient(135deg, #fff7ed 0%, #ffedd5 45%, #fed7aa 100%)",
            }}
          >
            {/* Decorative glow */}
            <div
              className="absolute -top-12 -right-10 h-32 w-32 rounded-full pointer-events-none opacity-60"
              style={{ background: "radial-gradient(circle, #fb923c33, transparent 70%)" }}
            />
            <div
              className="absolute -bottom-8 -left-6 h-24 w-24 rounded-full pointer-events-none opacity-50"
              style={{ background: "radial-gradient(circle, #f9731633, transparent 70%)" }}
            />

            <div className="relative flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-[15.5px] md:text-[22px] font-extrabold text-orange-950 leading-tight tracking-tight">
                  {getGreeting(user?.displayName ?? "Admin", t)} <span className="inline-block">👋</span>
                </h1>
                <p className="text-[11px] md:text-[12.5px] text-orange-700/80 mt-1 capitalize font-medium">
                  {formatTodayFull(locale)}
                </p>
                {nearestDeparture ? (
                  <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    <div className="inline-flex items-center gap-1.5 bg-white/80 backdrop-blur text-orange-700 rounded-full pl-2 pr-3 py-1 text-[11px] font-semibold border border-orange-200/60 shadow-sm">
                      <Plane strokeWidth={2} className="h-3 w-3 shrink-0" />
                      <span className="opacity-80">{t.dash_nearest_departure}</span>
                      <strong className="truncate max-w-[120px]">{nearestDeparture.name}</strong>
                      <span className="text-orange-500 shrink-0">· {daysUntil(nearestDeparture.departureDate!)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11.5px] text-orange-800/70 mt-2.5 italic leading-snug">
                    {t.dash_no_schedule}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  title="Muat ulang data dari Supabase"
                  aria-label="Refresh dashboard"
                  className="group inline-flex items-center gap-1.5 h-8 md:h-9 px-2.5 md:px-3 rounded-full bg-white/80 backdrop-blur border border-orange-200/70 text-orange-700 hover:bg-white hover:border-orange-300 shadow-sm text-[11px] md:text-[12px] font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <RefreshCw
                    strokeWidth={2.2}
                    className={cn("h-3.5 w-3.5 md:h-4 md:w-4", refreshing && "animate-spin")}
                  />
                  <span className="hidden sm:inline">{refreshing ? "Memuat…" : "Refresh"}</span>
                </button>
                <div className="hidden md:flex h-12 w-12 rounded-2xl bg-white/70 backdrop-blur items-center justify-center shadow-sm border border-orange-100">
                  <Plane strokeWidth={1.5} className="h-6 w-6 text-orange-500" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Live Clock (multi-timezone) ── */}
        <motion.div
          className="mb-3 md:mb-5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <LiveClock />
        </motion.div>

        {/* ── Admin WhatsApp quick-contact (untuk admin internal) ── */}
        <motion.div
          className="mb-3 md:mb-5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.07, ease: [0.16, 1, 0.3, 1] }}
        >
          <AdminWhatsappCard />
        </motion.div>

        {/* ── Primary stat cards (4 main metrics) ── */}
        <motion.div
          className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3 md:gap-2.5 md:mb-5"
          variants={stagger}
          initial="hidden"
          animate="visible"
        >
          {[
            { icon: Plane, label: t.dash_total_trip, value: trips.length, tint: "from-blue-50 to-sky-50", iconBg: "bg-blue-500/10 text-blue-600", onClick: () => {} },
            { icon: TrendingUp, label: t.dash_active_trip, value: activeTrips, tint: "from-emerald-50 to-teal-50", iconBg: "bg-emerald-500/10 text-emerald-600", onClick: () => setTab("upcoming") },
            { icon: CheckCircle, label: t.dash_done_trip, value: doneTrips, tint: "from-purple-50 to-fuchsia-50", iconBg: "bg-purple-500/10 text-purple-600", onClick: () => setTab("done") },
            { icon: Users, label: t.dash_total_jamaah, value: totalJamaah, tint: "from-orange-50 to-amber-50", iconBg: "bg-orange-500/10 text-orange-600", onClick: () => navigate("/progress") },
          ].map((stat) => (
            <motion.button
              key={stat.label}
              onClick={stat.onClick}
              className={cn(
                "relative overflow-hidden flex items-center gap-2.5 rounded-2xl border border-[hsl(var(--border))] p-3 md:p-3.5 hover:shadow-md hover:border-[hsl(var(--primary))]/40 transition-all duration-200 text-left active:scale-[0.97]",
                "bg-gradient-to-br", stat.tint
              )}
              variants={fadeUp}
            >
              <div className={cn("h-8 w-8 md:h-10 md:w-10 rounded-xl flex items-center justify-center shrink-0", stat.iconBg)}>
                <stat.icon strokeWidth={2} className="h-[16px] w-[16px] md:h-5 md:w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] md:text-[22px] font-extrabold text-[hsl(var(--foreground))] leading-none tracking-tight tabular-nums">{stat.value}</p>
                <p className="text-[10.5px] md:text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 md:mt-1 truncate font-medium">{stat.label}</p>
              </div>
            </motion.button>
          ))}
        </motion.div>

        {/* ── Secondary package stats (desktop only — too dense on mobile) ── */}
        <motion.div
          className="hidden md:grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
        >
          {[
            { icon: Star, label: t.dash_total_packages, value: packages.length, color: "bg-amber-50 text-amber-600", onClick: () => navigate("/packages") },
            { icon: AlertCircle, label: t.dash_need_action, value: pendingPackages.length, color: pendingPackages.length > 0 ? "bg-red-50 text-red-500" : "bg-gray-50 text-gray-400", onClick: () => navigate("/packages") },
            { icon: Clock, label: t.dash_paid_packages, value: packages.filter(p => p.status === "Paid").length, color: "bg-emerald-50 text-emerald-600", onClick: () => navigate("/packages") },
            { icon: CheckCircle, label: t.dash_completed_packages, value: packages.filter(p => p.status === "Completed").length, color: "bg-purple-50 text-purple-600", onClick: () => navigate("/packages") },
          ].map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="flex items-center gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-white p-3 hover:shadow-sm hover:border-[hsl(var(--primary))]/40 transition-all text-left active:scale-[0.98]"
            >
              <item.icon strokeWidth={1.5} className="h-5 w-5 text-orange-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-[18px] font-bold text-[hsl(var(--foreground))] leading-none">{item.value}</p>
                <p className="text-[10.5px] text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{item.label}</p>
              </div>
            </button>
          ))}
        </motion.div>

        {/* ── Mobile: compact package summary chips ── */}
        <motion.div
          className="md:hidden flex items-center gap-2 mb-3.5 -mx-3 px-3 overflow-x-auto scrollbar-none"
          style={{ scrollSnapType: "x proximity" }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
        >
          {[
            { icon: Star, label: t.dash_total_packages, value: packages.length, color: "text-amber-600 bg-amber-50 border-amber-100" },
            { icon: AlertCircle, label: t.dash_need_action, value: pendingPackages.length, color: pendingPackages.length > 0 ? "text-red-600 bg-red-50 border-red-100" : "text-gray-400 bg-gray-50 border-gray-100" },
            { icon: Clock, label: t.dash_paid_packages, value: packages.filter(p => p.status === "Paid").length, color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
            { icon: CheckCircle, label: t.dash_completed_packages, value: packages.filter(p => p.status === "Completed").length, color: "text-purple-600 bg-purple-50 border-purple-100" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => navigate("/packages")}
              className={cn("shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-semibold active:scale-95 transition-transform", item.color)}
              style={{ scrollSnapAlign: "start" }}
            >
              <item.icon strokeWidth={2} className="h-3.5 w-3.5" />
              <span className="tabular-nums font-extrabold">{item.value}</span>
              <span className="opacity-80">{item.label}</span>
            </button>
          ))}
        </motion.div>

        {/* ── Payment alerts H-30 ── */}
        <PaymentAlerts trips={trips} allJamaah={allJamaah} />

        {/* ── Perlu Perhatian ── */}
        {pendingPackages.length > 0 && (
          <motion.div
            className="mb-4 md:mb-5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.18, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <AlertCircle strokeWidth={1.5} className="h-4 w-4 text-amber-500" />
                <h2 className="text-[13.5px] md:text-[14px] font-bold text-[hsl(var(--foreground))]">{t.dash_needs_attention}</h2>
                <span className="h-5 px-2 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center">{pendingPackages.length}</span>
              </div>
              <button onClick={() => navigate("/packages")}
                className="text-[11px] text-[hsl(var(--primary))] font-medium hover:underline flex items-center gap-1">
                {t.dash_view_all} <ChevronRight strokeWidth={2} className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2">
              {pendingPackages.slice(0, 4).map((pkg) => (
                <div
                  key={pkg.id}
                  onClick={() => navigate("/packages")}
                  className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 cursor-pointer hover:border-[hsl(var(--primary))]/40 hover:shadow-sm transition-all"
                >
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center text-lg shrink-0"
                    style={{ background: "linear-gradient(135deg,#fff7ed,#fed7aa)" }}>
                    {pkg.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-semibold text-[hsl(var(--foreground))] truncate">{pkg.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                      <MapPin strokeWidth={1.5} className="h-3 w-3 shrink-0" />
                      <span className="truncate">{pkg.destination}</span>
                      {pkg.departureDate && (
                        <>
                          <span>·</span>
                          <CalendarIcon strokeWidth={1.5} className="h-3 w-3 shrink-0" />
                          <span>{daysUntil(pkg.departureDate)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={cn("text-[10px] font-semibold px-2 py-1 rounded-full shrink-0", STATUS_COLORS[pkg.status] ?? "bg-gray-100 text-gray-500")}>
                    {STATUS_LABELS[pkg.status] ?? pkg.status}
                  </span>
                </div>
              ))}
              {pendingPackages.length > 4 && (
                <button onClick={() => navigate("/packages")}
                  className="w-full py-2 text-[12px] text-[hsl(var(--primary))] font-medium rounded-xl border border-dashed border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))] transition-colors">
                  +{pendingPackages.length - 4} paket lainnya
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Kalkulator & Laporan shortcut bar ── */}
        <motion.div
          className="grid grid-cols-2 gap-2 mb-3.5 md:gap-2.5 md:mb-5"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.22, ease: "easeOut" }}
        >
          <button
            onClick={() => navigate("/calculator")}
            className="flex items-center gap-1.5 md:gap-2 rounded-lg md:rounded-xl border border-[hsl(var(--border))] bg-white px-2.5 md:px-3 py-2 md:py-2.5 hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))] transition-[border-color,background-color] duration-200 group active:scale-[0.98]"
          >
            <Calculator strokeWidth={1.5} className="h-4 w-4 text-[hsl(var(--primary))] shrink-0" />
            <span className="text-[12px] md:text-[13px] font-medium text-[hsl(var(--foreground))] truncate">{t.dash_open_calculator}</span>
            <ArrowRight strokeWidth={1.5} className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] transition-colors ml-auto shrink-0" />
          </button>
          <button
            onClick={() => navigate("/progress")}
            className="flex items-center gap-1.5 md:gap-2 rounded-lg md:rounded-xl border border-[hsl(var(--border))] bg-white px-2.5 md:px-3 py-2 md:py-2.5 hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))] transition-[border-color,background-color] duration-200 group active:scale-[0.98]"
          >
            <FileBarChart strokeWidth={1.5} className="h-4 w-4 text-[hsl(var(--primary))] shrink-0" />
            <span className="text-[12px] md:text-[13px] font-medium text-[hsl(var(--foreground))] truncate">{t.dash_progress_report}</span>
            <ArrowRight strokeWidth={1.5} className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] transition-colors ml-auto shrink-0" />
          </button>
        </motion.div>

        {/* Section header */}
        <div className="flex items-center justify-between gap-2.5 mb-3 md:gap-3 md:mb-4">
          <div>
            <h1 className="text-base md:text-xl font-bold text-[hsl(var(--foreground))]">{t.dash_packages_title}</h1>
              <div className="flex gap-2.5 md:gap-3 mt-1">
              {[["all", t.dash_filter_all], ["upcoming", t.dash_filter_active], ["done", t.dash_filter_done]].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key as typeof tab)}
                  className={cn(
                    "text-[12px] md:text-[13px] font-medium pb-1 border-b-2 transition-smooth",
                    tab === key
                      ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                      : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Cards grid */}
        {loadingTrips ? (
          <div className="grid gap-2.5 md:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden animate-pulse">
                <div className="h-36 bg-[hsl(var(--secondary))]" />
                <div className="p-3.5 space-y-2">
                  <div className="h-3.5 bg-[hsl(var(--secondary))] rounded w-3/4" />
                  <div className="h-3 bg-[hsl(var(--secondary))] rounded w-1/2" />
                  <div className="h-3 bg-[hsl(var(--secondary))] rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="relative overflow-hidden rounded-3xl border border-orange-100 bg-gradient-to-br from-white via-orange-50/40 to-amber-50/60 px-5 py-8 md:p-10 text-center flex flex-col items-center justify-center"
          >
            {/* Decorative blob */}
            <div
              className="absolute -top-16 -right-12 h-40 w-40 rounded-full pointer-events-none opacity-50"
              style={{ background: "radial-gradient(circle, #fb923c44, transparent 70%)" }}
            />
            <div
              className="absolute -bottom-12 -left-10 h-32 w-32 rounded-full pointer-events-none opacity-40"
              style={{ background: "radial-gradient(circle, #f9731644, transparent 70%)" }}
            />

            <div className="relative">
              <div className="inline-flex h-16 w-16 md:h-20 md:w-20 items-center justify-center rounded-2xl bg-white shadow-sm border border-orange-100 mb-4">
                <Plane strokeWidth={1.5} className="h-8 w-8 md:h-10 md:w-10 text-orange-500" />
              </div>
              <h2 className="text-[16px] md:text-lg font-bold text-[hsl(var(--foreground))]">{t.dash_no_packages}</h2>
              <p className="text-[12.5px] md:text-sm text-[hsl(var(--muted-foreground))] mt-1.5 max-w-xs mx-auto leading-relaxed">
                {t.dash_no_packages_desc}
              </p>
              <Button
                onClick={() => navigate("/packages")}
                className="mt-5 rounded-2xl px-5 h-11 text-[13px] font-bold shadow-md"
                style={{ background: "linear-gradient(135deg,#f97316,#ea580c)", color: "white" }}
              >
                <Plus strokeWidth={2} className="h-4 w-4 mr-1.5" /> {t.dash_create_first}
              </Button>
            </div>
          </motion.div>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((trip) => (
              <TripCard key={trip.id} trip={trip} onDelete={setDeleteTarget} />
            ))}
            {/* Add card */}
            <button onClick={() => setAddOpen(true)}
              className="rounded-xl md:rounded-2xl border-2 border-dashed border-[hsl(var(--border))] flex flex-col items-center justify-center gap-2 md:gap-3 min-h-[120px] sm:min-h-[220px] hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))] transition-all group">
              <div className="h-9 w-9 md:h-11 md:w-11 flex items-center justify-center transition-colors">
                <Plus strokeWidth={1.5} className="h-5 w-5 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))]" />
              </div>
              <span className="text-xs md:text-sm text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] font-medium">{t.dash_add_package}</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Right panel (desktop only) ── */}
      <div className="hidden xl:block">
        <RightPanel trips={trips} totalJamaah={totalJamaah} />
      </div>

      <AddTripDialog open={addOpen} onClose={() => setAddOpen(false)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent style={{ background: "#fff", color: "hsl(var(--foreground))" }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.dash_delete_title}</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>"{deleteTarget?.name}"</strong> {t.dash_delete_desc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.btn_cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white">{t.btn_delete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
