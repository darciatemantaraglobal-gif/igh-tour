import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Calendar, MapPin, CheckCircle2, AlertCircle, Loader2, ArrowRight, Wallet } from "lucide-react";
import { lookupBooking, type BookingStatus } from "@/features/portal/portalRepo";
import { motion } from "framer-motion";

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}
function fmtDate(s?: string) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  } catch { return s; }
}

const TYPE_LABEL: Record<string, string> = {
  dp: "DP", installment: "Cicilan", final: "Pelunasan", refund: "Refund", other: "Lainnya",
};

export default function PublicCheck() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState(code ?? "");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BookingStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const doLookup = async (c: string) => {
    if (!c || c.trim().length < 4) { setErr("Kode booking minimal 4 karakter."); return; }
    setLoading(true); setErr(null); setData(null);
    const res = await lookupBooking(c);
    if (res.ok) {
      setData(res.data);
    } else if ((res as { error?: string }).error === "not_found") {
      setErr("Kode booking tidak ditemukan. Cek lagi atau hubungi admin.");
    } else if ((res as { error?: string }).error === "invalid_code") {
      setErr("Format kode tidak valid.");
    } else {
      setErr("Gagal terhubung ke server. Coba lagi nanti.");
    }
    setLoading(false);
  };

  useEffect(() => { if (code) doLookup(code); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [code]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = input.trim().toUpperCase();
    if (c) navigate(`/cek/${encodeURIComponent(c)}`, { replace: true });
    else doLookup(input);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 flex items-center justify-between border-b border-orange-100/60 bg-white/70 backdrop-blur">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo-igh-tour.png" alt="IGH Tour" className="h-8 w-auto" />
          <span className="text-sm font-bold text-orange-700">IGH Tour</span>
        </Link>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Cek Status Booking</span>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Cek Status Booking Umrah</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Masukkan kode booking yang kamu terima dari admin IGH Tour buat lihat detail paket & status pembayaran.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="cth: IGH-AB23CD"
              className="h-11 text-sm rounded-xl flex-1 bg-white"
              autoFocus
            />
            <Button type="submit" disabled={loading}
              className="h-11 px-5 rounded-xl gradient-primary text-white hover:opacity-90">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="h-4 w-4 mr-1.5" />Cari</>}
            </Button>
          </form>

          {err && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{err}</p>
            </div>
          )}
        </motion.div>

        {data && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mt-6 space-y-4"
          >
            {/* Trip card */}
            <div className="rounded-2xl bg-white border border-orange-100 overflow-hidden shadow-sm">
              <div className="bg-gradient-to-br from-orange-500 to-rose-500 text-white px-5 py-4">
                <p className="text-[11px] uppercase tracking-wider opacity-90">Paket Perjalanan</p>
                <h2 className="text-lg font-bold mt-1">{data.trip.emoji} {data.trip.name}</h2>
              </div>
              <div className="p-5 space-y-3 text-sm">
                <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                  <MapPin className="h-4 w-4" /> <span>{data.trip.destination || "—"}</span>
                </div>
                <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
                  <Calendar className="h-4 w-4" />
                  <span>{fmtDate(data.trip.startDate)} → {fmtDate(data.trip.endDate)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[hsl(var(--border))]">
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Atas Nama</p>
                    <p className="font-semibold text-[hsl(var(--foreground))]">{data.jamaah.name}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Kode Booking</p>
                    <p className="font-mono font-bold text-orange-700">{data.jamaah.bookingCode}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment summary */}
            <div className={`rounded-2xl border p-5 ${
              data.status === "lunas" ? "bg-emerald-50 border-emerald-200" :
              (data.status === "sebagian" || data.totalPaid > 0) ? "bg-amber-50 border-amber-200" :
              "bg-red-50 border-red-200"
            }`}>
              <div className="flex items-start gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-white shrink-0 ${
                  data.status === "lunas" ? "bg-emerald-500" :
                  (data.status === "sebagian" || data.totalPaid > 0) ? "bg-amber-500" : "bg-red-500"
                }`}>
                  {data.status === "lunas" ? <CheckCircle2 className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                </div>
                <div className="flex-1">
                  <p className="text-[11px] uppercase tracking-wider opacity-80">Status Pembayaran</p>
                  <h3 className="text-lg font-bold capitalize">
                    {data.status === "lunas" ? "Lunas — Siap Berangkat" :
                     (data.status === "sebagian" || data.totalPaid > 0) ? "Sudah Bayar DP / Sebagian" :
                     "Belum Ada Pembayaran"}
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Total Dibayar</p>
                      <p className="font-bold">{fmtIDR(data.totalPaid)}</p>
                    </div>
                    {data.trip.pricePerPax && (
                      <div>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {data.outstanding > 0 ? "Sisa Tagihan" : "Total Paket"}
                        </p>
                        <p className={`font-bold ${data.outstanding > 0 ? "text-red-700" : "text-emerald-700"}`}>
                          {fmtIDR(data.outstanding > 0 ? data.outstanding : data.trip.pricePerPax)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Payment history */}
            {data.payments.length > 0 && (
              <div className="rounded-2xl bg-white border border-[hsl(var(--border))] overflow-hidden">
                <div className="px-5 py-3 border-b border-[hsl(var(--border))]">
                  <h3 className="text-sm font-semibold">Riwayat Pembayaran</h3>
                </div>
                <div className="divide-y divide-[hsl(var(--border))]">
                  {data.payments.map((p, i) => (
                    <div key={i} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{TYPE_LABEL[p.type] ?? p.type}</p>
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {fmtDate(p.paidAt)} · {p.method || "—"}
                        </p>
                      </div>
                      <p className={`text-sm font-bold ${p.type === "refund" ? "text-red-600" : "text-emerald-700"}`}>
                        {p.type === "refund" ? "-" : ""}{fmtIDR(p.amount)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-center pt-2">
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                Ada pertanyaan? Hubungi admin IGH Tour untuk bantuan lebih lanjut.
              </p>
            </div>
          </motion.div>
        )}

        {!data && !err && !loading && !code && (
          <div className="mt-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
            <ArrowRight className="h-4 w-4 inline mr-1" />
            Masukkan kode di atas untuk mulai.
          </div>
        )}
      </main>

      <footer className="px-4 py-4 text-center text-[10px] text-[hsl(var(--muted-foreground))] border-t border-orange-100/60">
        © IGH Tour — Manajemen Umrah & Haji
      </footer>
    </div>
  );
}
