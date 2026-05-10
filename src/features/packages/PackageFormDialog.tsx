import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Camera, Trash2, NotebookPen, ImagePlus, Package } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Package as PackageType, PackageDraft, PackageStatus, HotelLevel } from "@/features/packages/packagesRepo";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: PackageType | null;
  onSubmit: (draft: PackageDraft) => Promise<void> | void;
}

const STATUSES: PackageStatus[] = ["Draft", "Calculated", "Confirmed", "Paid", "Completed"];
const HOTEL_LEVELS: HotelLevel[] = ["Bintang 3", "Bintang 4", "Bintang 5"];
const AIRLINES = ["Saudia Airlines", "Ettihad Airways", "Emirates Airways", "Turkish Airways", "Egypt Air", "Lion Air", "Scoot", "Flynas", "Flyadeal"];
const DESTINATION_PRESETS = ["Mekkah - Madinah - Thaif", "Mekkah - Madinah", "Madinah - Mekkah"];

const FACILITIES_LIST = [
  "Makan 3x/Hari",
  "Hotel Makkah",
  "Hotel Madinah",
  "Transport Lokal",
  "Pesawat PP",
  "Visa Umrah",
  "Manasik",
  "Perlengkapan",
  "Asuransi",
  "Tour Guide",
];

const empty: PackageDraft = {
  name: "",
  destination: "",
  people: 1,
  days: 7,
  hpp: 0,
  totalIDR: 0,
  status: "Draft",
  emoji: "✈️",
  coverImage: undefined,
  departureDate: "",
  returnDate: "",
  airline: "",
  hotelLevel: undefined,
  notes: "",
  facilities: [],
};

const lbl = "text-[10px] md:text-[10.5px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wide";
const inp = "h-8 md:h-9 text-[12.5px] md:text-[13px] rounded-lg md:rounded-xl border border-[hsl(var(--border))] bg-white placeholder:text-gray-400 focus:border-orange-400 focus:ring-orange-400/20 transition-all";
const sel = "h-8 md:h-9 text-[12.5px] md:text-[13px] rounded-lg md:rounded-xl border border-[hsl(var(--border))] bg-white focus:border-orange-400 transition-all";

export function PackageFormDialog({ open, onOpenChange, initial, onSubmit }: Props) {
  const [draft, setDraft] = useState<PackageDraft>(empty);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof PackageDraft, string>>>({});
  const [coverHover, setCoverHover] = useState(false);
  const [vvHeight, setVvHeight] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Track visual viewport so the dialog shrinks when the soft keyboard opens.
  // Without this, on mobile the footer (with the "Tambah Paket" button) sits
  // hidden underneath the keyboard whenever an input is focused.
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => setVvHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open]);

  const toggleFacility = (fac: string) => {
    const current = draft.facilities ?? [];
    const updated = current.includes(fac) ? current.filter((f) => f !== fac) : [...current, fac];
    set("facilities", updated);
  };

  useEffect(() => {
    if (open) {
      setDraft(initial ? { ...initial } : empty);
      setErrors({});
    }
  }, [open, initial]);

  const set = <K extends keyof PackageDraft>(key: K, value: PackageDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => set("coverImage", ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof PackageDraft, string>> = {};
    if (!draft.name.trim()) errs.name = "Wajib diisi";
    if (!draft.destination.trim()) errs.destination = "Wajib diisi";
    if ((draft.people ?? 0) < 1) errs.people = "Min 1";
    if ((draft.days ?? 0) < 1) errs.days = "Min 1";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("Kamu sedang offline — periksa koneksi internet.", { duration: 5000 });
      return;
    }
    const snapshot = { ...draft };
    // Tutup dialog langsung — save jalan di background
    onOpenChange(false);
    void (async () => {
      try {
        await Promise.resolve(onSubmit(snapshot));
        toast.success(`Paket "${snapshot.name}" tersimpan.`);
      } catch (err) {
        console.error("Gagal simpan paket:", err);
        const msg =
          (err as { message?: string; hint?: string; details?: string })?.message ||
          (err as { hint?: string })?.hint ||
          (err as { details?: string })?.details ||
          (typeof err === "string" ? err : "") ||
          "Gagal menyimpan paket";
        toast.error(msg, { duration: 6000 });
      }
    })();
  };

  // Hanya nama + destinasi yang benar-benar wajib; sisanya opsional supaya
  // user bisa langsung simpan paket draft & lengkapi detail belakangan.
  const canSave = !!draft.name.trim() && !!draft.destination.trim();

  // Render via portal so the dialog sits on document.body, escaping any
  // transformed ancestor (e.g. <motion.main>) that would otherwise trap a
  // `position: fixed` element — this is what was hiding the footer behind
  // the bottom nav on mobile.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => onOpenChange(false)}
          />

          {/* Dialog */}
          <motion.div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center md:p-4 pointer-events-none">
            <motion.div
              className="relative w-full md:max-w-lg pointer-events-auto rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col bg-white border border-[hsl(var(--border))]"
              style={{
                maxHeight: vvHeight
                  ? `calc(${Math.max(280, vvHeight - 8)}px - env(safe-area-inset-top))`
                  : "calc(92dvh - env(safe-area-inset-top))",
              }}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            >
              {/* ── Header ── */}
              <div
                className="flex items-center justify-between px-4 md:px-5 pb-3 md:pb-4 border-b border-[hsl(var(--border))] shrink-0"
                style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
              >
                <div className="flex items-center gap-2.5 md:gap-3 min-w-0">
                  <div className="h-8 w-8 md:h-9 md:w-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}>
                    <Package strokeWidth={1.8} className="h-4 w-4 md:h-4.5 md:w-4.5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[13.5px] md:text-[14.5px] font-bold text-[hsl(var(--foreground))] leading-tight truncate">
                      {initial ? "Edit Paket Trip" : "Tambah Paket Trip"}
                    </h2>
                    <p className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                      Isi informasi lengkap paket perjalanan
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onOpenChange(false)}
                  className="h-7 w-7 md:h-8 md:w-8 rounded-full bg-[hsl(var(--secondary))] flex items-center justify-center hover:bg-gray-200 transition-colors shrink-0 ml-3"
                >
                  <X strokeWidth={2} className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                </button>
              </div>

              {/* ── Body ── */}
              <div className="overflow-y-auto flex-1 px-4 md:px-5 py-3 md:py-4 space-y-3 md:space-y-4">

                {/* Cover Photo */}
                <div className="space-y-1.5">
                  <p className={lbl}>Foto Cover <span className="normal-case font-normal text-gray-400">· opsional</span></p>
                  {draft.coverImage ? (
                    <div
                      className="relative h-24 md:h-32 rounded-xl md:rounded-2xl overflow-hidden border border-[hsl(var(--border))] cursor-pointer"
                      onMouseEnter={() => setCoverHover(true)}
                      onMouseLeave={() => setCoverHover(false)}
                    >
                      <img src={draft.coverImage} alt="cover" className="w-full h-full object-cover" />
                      <AnimatePresence>
                        {coverHover && (
                          <motion.div
                            className="absolute inset-0 bg-black/45 flex items-center justify-center gap-2.5"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                          >
                            <button
                              type="button"
                              onClick={() => fileRef.current?.click()}
                              className="h-8 px-3.5 rounded-xl bg-white text-[11.5px] font-semibold flex items-center gap-1.5 hover:bg-orange-50 transition-colors"
                            >
                              <Camera strokeWidth={2} className="h-3.5 w-3.5" />
                              Ganti Foto
                            </button>
                            <button
                              type="button"
                              onClick={() => set("coverImage", undefined)}
                              className="h-8 px-3.5 rounded-xl bg-red-500 text-white text-[11.5px] font-semibold flex items-center gap-1.5 hover:bg-red-600 transition-colors"
                            >
                              <Trash2 strokeWidth={2} className="h-3.5 w-3.5" />
                              Hapus
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="w-full h-16 md:h-24 rounded-xl md:rounded-2xl border-2 border-dashed border-[hsl(var(--border))] flex flex-col items-center justify-center gap-1 md:gap-2 hover:border-orange-400 hover:bg-orange-50/40 transition-all group"
                    >
                      <ImagePlus strokeWidth={1.5} className="h-4 w-4 md:h-5 md:w-5 text-gray-300 group-hover:text-orange-400 transition-colors" />
                      <span className="text-[11px] md:text-[11.5px] text-gray-400 group-hover:text-orange-500 transition-colors">Klik untuk unggah foto cover</span>
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                </div>

                {/* Divider label */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-[hsl(var(--border))]" />
                  <span className="text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider px-1">Informasi Paket</span>
                  <div className="flex-1 h-px bg-[hsl(var(--border))]" />
                </div>

                {/* Row 1: Nama Paket */}
                <div className="space-y-1.5">
                  <p className={lbl}>Nama Paket <span className="text-red-400 normal-case font-bold">*</span></p>
                  <Input
                    placeholder="Umrah Ramadhan"
                    value={draft.name}
                    onChange={(e) => { set("name", e.target.value); setErrors(p => ({ ...p, name: undefined })); }}
                    className={inp + (errors.name ? " border-red-400" : "")}
                    autoFocus
                  />
                  {errors.name && <p className="text-[10px] text-red-500">{errors.name}</p>}
                </div>

                {/* Row 2: Tgl. Berangkat + Tgl. Pulang */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:gap-3">
                  <div className="space-y-1.5">
                    <p className={lbl}>Tgl. Berangkat</p>
                    <Input
                      type="date"
                      value={draft.departureDate ?? ""}
                      onChange={(e) => {
                        const dep = e.target.value;
                        set("departureDate", dep);
                        setErrors(p => ({ ...p, departureDate: undefined }));
                        if (draft.returnDate && dep && draft.returnDate < dep) {
                          set("returnDate", "");
                        }
                      }}
                      className={inp + (errors.departureDate ? " border-red-400" : "")}
                    />
                    {errors.departureDate && <p className="text-[10px] text-red-500">{errors.departureDate}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <p className={lbl}>
                      Tgl. Pulang
                      {draft.departureDate && draft.returnDate && draft.returnDate >= draft.departureDate && (
                        <span className="ml-1.5 text-[9px] text-orange-500 normal-case font-semibold">
                          · {Math.max(1, Math.round((new Date(draft.returnDate + "T00:00:00").getTime() - new Date(draft.departureDate + "T00:00:00").getTime()) / 86400000) + 1)} Hari
                        </span>
                      )}
                    </p>
                    <Input
                      type="date"
                      value={draft.returnDate ?? ""}
                      min={draft.departureDate ?? undefined}
                      disabled={!draft.departureDate}
                      onChange={(e) => { set("returnDate", e.target.value); }}
                      className={inp + " disabled:bg-slate-50 disabled:text-muted-foreground disabled:cursor-not-allowed"}
                    />
                  </div>
                </div>

                {/* Row 3: Destinasi + Durasi */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:gap-3">
                  <div className="space-y-1.5">
                    <p className={lbl}>Destinasi <span className="text-red-400 normal-case font-bold">*</span></p>
                    <Select
                      value={draft.destination}
                      onValueChange={(v) => { set("destination", v); setErrors(p => ({ ...p, destination: undefined })); }}
                    >
                      <SelectTrigger className={sel + (errors.destination ? " border-red-400" : "")}>
                        <SelectValue placeholder="Pilih rute" />
                      </SelectTrigger>
                      <SelectContent>
                        {DESTINATION_PRESETS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.destination && <p className="text-[10px] text-red-500">{errors.destination}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <p className={lbl}>Durasi (Hari) <span className="text-red-400 normal-case font-bold">*</span></p>
                    <Input
                      type="number"
                      min={1}
                      value={draft.days}
                      onChange={(e) => { set("days", Math.max(1, Number(e.target.value))); setErrors(p => ({ ...p, days: undefined })); }}
                      className={inp + (errors.days ? " border-red-400" : "")}
                    />
                    {errors.days && <p className="text-[10px] text-red-500">{errors.days}</p>}
                  </div>
                </div>

                {/* Row 4: Status + Kuota */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:gap-3">
                  <div className="space-y-1.5">
                    <p className={lbl}>Status</p>
                    <Select value={draft.status} onValueChange={(v) => set("status", v as PackageStatus)}>
                      <SelectTrigger className={sel}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <p className={lbl}>Kuota (Pax) <span className="text-red-400 normal-case font-bold">*</span></p>
                    <Input
                      type="number"
                      min={1}
                      value={draft.people}
                      onChange={(e) => { set("people", Math.max(1, Number(e.target.value))); setErrors(p => ({ ...p, people: undefined })); }}
                      className={inp + (errors.people ? " border-red-400" : "")}
                    />
                    {errors.people && <p className="text-[10px] text-red-500">{errors.people}</p>}
                  </div>
                </div>

                {/* Row 5: Hotel + Maskapai */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:gap-3">
                  <div className="space-y-1.5">
                    <p className={lbl}>Level Hotel <span className="text-red-400 normal-case font-bold">*</span></p>
                    <Select
                      value={draft.hotelLevel ?? ""}
                      onValueChange={(v) => { set("hotelLevel", v as HotelLevel); setErrors(p => ({ ...p, hotelLevel: undefined })); }}
                    >
                      <SelectTrigger className={sel + (errors.hotelLevel ? " border-red-400" : "")}>
                        <SelectValue placeholder="Pilih" />
                      </SelectTrigger>
                      <SelectContent>
                        {HOTEL_LEVELS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.hotelLevel && <p className="text-[10px] text-red-500">{errors.hotelLevel}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <p className={lbl}>Maskapai <span className="text-red-400 normal-case font-bold">*</span></p>
                    <Select
                      value={draft.airline ?? ""}
                      onValueChange={(v) => { set("airline", v); setErrors(p => ({ ...p, airline: undefined })); }}
                    >
                      <SelectTrigger className={sel + (errors.airline ? " border-red-400" : "")}>
                        <SelectValue placeholder="Pilih" />
                      </SelectTrigger>
                      <SelectContent>
                        {AIRLINES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.airline && <p className="text-[10px] text-red-500">{errors.airline}</p>}
                  </div>
                </div>

                {/* Divider label */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-[hsl(var(--border))]" />
                  <span className="text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider px-1">Fasilitas & Catatan</span>
                  <div className="flex-1 h-px bg-[hsl(var(--border))]" />
                </div>

                {/* Fasilitas */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <NotebookPen strokeWidth={1.8} className="h-3.5 w-3.5 text-orange-500" />
                    <p className={lbl}>Fasilitas yang Tersedia</p>
                  </div>
                  <div className="flex flex-wrap gap-1 md:gap-1.5">
                    {FACILITIES_LIST.map((fac) => {
                      const active = (draft.facilities ?? []).includes(fac);
                      return (
                        <button
                          key={fac}
                          type="button"
                          onClick={() => toggleFacility(fac)}
                          className={`text-[10.5px] md:text-[11px] font-semibold px-2.5 md:px-3 py-0.5 md:py-1 rounded-full border transition-all ${
                            active
                              ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                              : "bg-white text-gray-500 border-gray-200 hover:border-orange-300 hover:text-orange-600"
                          }`}
                        >
                          {fac}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Catatan */}
                <div className="space-y-1.5">
                  <p className={lbl}>Catatan Tambahan</p>
                  <textarea
                    value={draft.notes ?? ""}
                    onChange={(e) => set("notes", e.target.value)}
                    rows={2}
                    placeholder="Catatan khusus untuk paket ini..."
                    className="w-full text-[12.5px] md:text-[13px] rounded-lg md:rounded-xl border border-[hsl(var(--border))] bg-white px-3 md:px-3.5 py-2 md:py-2.5 placeholder:text-gray-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 outline-none transition-all resize-none"
                  />
                </div>

              </div>

              {/* ── Footer (always visible — keyboard-safe via vvHeight) ── */}
              <div className="px-4 md:px-5 py-2.5 md:py-3.5 border-t border-[hsl(var(--border))] flex gap-2 md:gap-2.5 shrink-0 bg-white shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.08)] pb-[max(10px,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                  className="flex-1 h-10 md:h-10 rounded-xl text-[13px] font-semibold bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !canSave}
                  className="flex-[1.4] md:flex-1 h-10 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
                  style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}
                >
                  {saving ? (
                    <>
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      Menyimpan...
                    </>
                  ) : (
                    <>
                      <Check strokeWidth={2.5} className="h-4 w-4" />
                      {initial ? "Simpan Perubahan" : "Tambah Paket"}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
