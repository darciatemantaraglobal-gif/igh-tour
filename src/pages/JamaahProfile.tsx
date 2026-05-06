import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Camera, Upload, Trash2, FileText, Plane, HeartPulse, ShieldCheck, FolderOpen, ExternalLink, Pencil, Save, X, ScanLine, CheckCircle2, FileKey, CreditCard, Clock, Plus, Wallet, Copy, Share2, Link as LinkIcon,
} from "lucide-react";
import { useTripsStore, useJamaahStore, useDocsStore, type Jamaah, type JamaahDoc, type DocCategory } from "@/store/tripsStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scanPassport, countPassportDataFields, failedChecksumLabels } from "@/lib/ocrPassport";
import { useRegional } from "@/lib/regional";
import {
  listPaymentsByJamaah, createPayment, deletePayment, sumPaid, paymentStatus,
  uploadPaymentProof, getProofSignedUrl,
  PAYMENT_TYPE_LABEL, type Payment, type PaymentType,
} from "@/features/payments/paymentsRepo";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result as string);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}


// ── Doc category config ────────────────────────────────────────────────────────
const DOC_CATEGORIES: { key: DocCategory; label: string; icon: React.ElementType; color: string }[] = [
  { key: "passport", label: "Paspor",                 icon: ShieldCheck, color: "text-[hsl(var(--primary))]" },
  { key: "medical",  label: "Buku Vaksin",            icon: HeartPulse,  color: "text-[hsl(var(--primary))]" },
  { key: "other",    label: "Foto Background Putih",  icon: FolderOpen,  color: "text-[hsl(var(--primary))]" },
  { key: "visa",     label: "Visa",                   icon: FileText,    color: "text-[hsl(var(--primary))]" },
  { key: "ticket",   label: "Tiket Pesawat",          icon: Plane,       color: "text-[hsl(var(--primary))]" },
];

// ── Payment section ───────────────────────────────────────────────────────────
function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function BookingCodeShare({ code, jamaahName }: { code: string; jamaahName: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/cek/${encodeURIComponent(code)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link disalin — siap di-share ke jamaah.");
      setTimeout(() => setCopied(false), 1800);
    } catch { toast.error("Gagal menyalin link."); }
  };

  const sendWa = () => {
    const text = `Assalamu'alaikum ${jamaahName},\n\nBerikut link untuk cek status booking Umrah Anda di IGH Tour:\n${url}\n\nKode booking: *${code}*\n\nTerima kasih.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50/60 p-3 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-[140px]">
        <p className="text-[10px] uppercase tracking-wider text-orange-700/80 font-semibold">Kode Booking Jamaah</p>
        <p className="font-mono font-bold text-orange-700 text-sm mt-0.5">{code}</p>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 truncate">Bagikan ke jamaah biar mereka cek sendiri.</p>
      </div>
      <Button size="sm" variant="outline" onClick={copyLink} className="h-8 rounded-lg">
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-600" /> : <LinkIcon className="h-3.5 w-3.5 mr-1" />}
        {copied ? "Tersalin" : "Salin Link"}
      </Button>
      <Button size="sm" onClick={sendWa} className="h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white">
        <Share2 className="h-3.5 w-3.5 mr-1" /> WhatsApp
      </Button>
    </div>
  );
}

function PaymentSection({ jamaahId, tripId, pricePerPax }: { jamaahId: string; tripId: string; pricePerPax?: number }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const proofRef = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<{ type: PaymentType; amount: string; method: string; paidAt: string; notes: string }>({
    type: "dp", amount: "", method: "Transfer Bank", paidAt: today, notes: "",
  });

  const reload = async () => {
    setLoading(true);
    try { setPayments(await listPaymentsByJamaah(jamaahId)); }
    catch (err) { console.error(err); toast.error("Gagal memuat pembayaran."); }
    finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [jamaahId]);

  const handleAdd = async () => {
    const amt = parseFloat(form.amount.replace(/[^0-9.]/g, ""));
    if (!amt || amt <= 0) { toast.error("Jumlah pembayaran harus lebih dari 0."); return; }
    if (!form.paidAt) { toast.error("Tanggal pembayaran wajib diisi."); return; }
    if (proofFile && proofFile.size > 12 * 1024 * 1024) {
      toast.error("Bukti transfer maks. 12 MB."); return;
    }
    const snapshot = { ...form };
    const proofSnap = proofFile;
    // Tutup form langsung — save jalan di background
    setForm({ type: "dp", amount: "", method: "Transfer Bank", paidAt: today, notes: "" });
    setProofFile(null);
    if (proofRef.current) proofRef.current.value = "";
    setShowForm(false);
    setAdding(true);
    try {
      let proofUrl: string | undefined;
      if (proofSnap) {
        proofUrl = await uploadPaymentProof(proofSnap, jamaahId);
      }
      await createPayment({
        jamaahId, tripId, type: snapshot.type,
        amount: amt, method: snapshot.method, paidAt: snapshot.paidAt, notes: snapshot.notes,
        proofUrl,
      });
      toast.success("Pembayaran tercatat.");
      await reload();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Gagal menyimpan pembayaran.";
      toast.error(msg);
    } finally { setAdding(false); }
  };

  const openProof = async (path: string) => {
    const url = await getProofSignedUrl(path);
    if (!url) { toast.error("Gagal membuat link bukti."); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deletePayment(deleteId);
      toast.success("Pembayaran dihapus.");
      setDeleteId(null);
      await reload();
    } catch { toast.error("Gagal menghapus."); }
  };

  const total = sumPaid(payments);
  const price = pricePerPax ?? 0;
  const outstanding = price > 0 ? Math.max(0, price - total) : 0;
  const status = paymentStatus(price, payments);

  const statusBadge = (() => {
    if (payments.length === 0) return { label: "Belum bayar", color: "bg-red-100 text-red-700" };
    if (price > 0 && status === "lunas") return { label: "Lunas", color: "bg-emerald-100 text-emerald-700" };
    if (price > 0) return { label: "Sebagian", color: "bg-amber-100 text-amber-700" };
    return { label: "Tercatat", color: "bg-blue-100 text-blue-700" };
  })();

  const typeBadge = (t: PaymentType) => {
    const map: Record<PaymentType, string> = {
      dp: "bg-blue-100 text-blue-700",
      installment: "bg-indigo-100 text-indigo-700",
      final: "bg-emerald-100 text-emerald-700",
      refund: "bg-red-100 text-red-700",
      other: "bg-gray-100 text-gray-700",
    };
    return map[t];
  };

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[hsl(var(--border))] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Wallet className="h-4 w-4 text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold text-[hsl(var(--card-foreground))]">Pembayaran</h3>
          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md", statusBadge.color)}>
            {statusBadge.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight">Total dibayar</p>
            <p className="text-sm font-bold text-[hsl(var(--primary))] leading-tight">{fmtIDR(total)}</p>
            {price > 0 && (
              <p className={cn("text-[10px] leading-tight mt-0.5", outstanding > 0 ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold")}>
                {outstanding > 0 ? `Sisa ${fmtIDR(outstanding)}` : `Lunas dari ${fmtIDR(price)}`}
              </p>
            )}
          </div>
          <Button size="sm" onClick={() => setShowForm((s) => !s)} variant={showForm ? "outline" : "default"}
            className={cn("h-8 text-xs rounded-xl", !showForm && "gradient-primary text-white hover:opacity-90")}>
            {showForm ? <><X className="h-3 w-3 mr-1" /> Batal</> : <><Plus className="h-3 w-3 mr-1" /> Tambah</>}
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="px-5 py-4 border-b border-[hsl(var(--border))] grid gap-3 sm:grid-cols-2 bg-orange-50/40">
          <div className="space-y-1">
            <Label className="text-xs">Jenis</Label>
            <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as PaymentType }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent style={{ background: "#fff" }}>
                {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentType[]).map((k) => (
                  <SelectItem key={k} value={k}>{PAYMENT_TYPE_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Jumlah (IDR)</Label>
            <Input type="number" min={0} inputMode="numeric" placeholder="cth: 5000000"
              value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Metode</Label>
            <Input value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              placeholder="Transfer / Cash / QRIS" className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tanggal</Label>
            <Input type="date" value={form.paidAt}
              onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Catatan (opsional)</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="cth: Transfer dari rekening BCA xxx" className="h-9" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Bukti Transfer (opsional, JPG/PNG/PDF maks 12 MB)</Label>
            <div className="flex items-center gap-2">
              <input ref={proofRef} type="file" accept="image/*,application/pdf" className="hidden"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="outline" size="sm" onClick={() => proofRef.current?.click()}
                className="h-9 rounded-xl">
                <Upload className="h-3.5 w-3.5 mr-1.5" /> {proofFile ? "Ganti File" : "Pilih File"}
              </Button>
              {proofFile && (
                <span className="text-[11px] text-[hsl(var(--muted-foreground))] truncate flex-1">
                  {proofFile.name} ({Math.round(proofFile.size / 1024)} KB)
                </span>
              )}
              {proofFile && (
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => { setProofFile(null); if (proofRef.current) proofRef.current.value = ""; }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button size="sm" onClick={handleAdd} disabled={adding}
              className="h-9 rounded-xl gradient-primary text-white hover:opacity-90">
              <Save className="h-3 w-3 mr-1" /> {adding ? "Menyimpan…" : "Simpan Pembayaran"}
            </Button>
          </div>
        </div>
      )}

      <div className="divide-y divide-[hsl(var(--border))]">
        {loading ? (
          <p className="px-5 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">Memuat…</p>
        ) : payments.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
            Belum ada pembayaran tercatat.
          </p>
        ) : payments.map((p) => (
          <div key={p.id} className="px-5 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md", typeBadge(p.type))}>
                  {PAYMENT_TYPE_LABEL[p.type]}
                </span>
                <span className={cn(
                  "text-sm font-bold",
                  p.type === "refund" ? "text-red-600" : "text-[hsl(var(--card-foreground))]"
                )}>
                  {p.type === "refund" ? "-" : ""}{fmtIDR(p.amount)}
                </span>
              </div>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                {p.paidAt} · {p.method || "—"}{p.notes ? ` · ${p.notes}` : ""}
              </p>
            </div>
            {p.proofUrl && (
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-blue-50 hover:text-blue-600"
                title="Lihat bukti transfer" onClick={() => openProof(p.proofUrl!)}>
                <FileText className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-red-50 hover:text-red-500"
              onClick={() => setDeleteId(p.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent style={{ background: "#fff" }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pembayaran?</AlertDialogTitle>
            <AlertDialogDescription>
              Catatan pembayaran ini akan dihapus permanen. Aksi ini akan tercatat di Audit Log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Doc item ──────────────────────────────────────────────────────────────────
function DocItem({ doc, onDelete }: { doc: JamaahDoc; onDelete: () => void }) {
  const isImage = doc.fileType === "image";

  const open = () => {
    const w = window.open();
    if (!w) return;
    if (isImage) {
      w.document.write(`<img src="${doc.dataUrl}" style="max-width:100%;"/>`);
    } else {
      w.document.write(`<iframe src="${doc.dataUrl}" style="width:100%;height:100vh;border:none;"></iframe>`);
    }
  };

  return (
    <div className="group flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-white p-3 hover:shadow-sm transition-all">
      {isImage ? (
        <img src={doc.dataUrl} alt={doc.label} className="h-12 w-12 rounded-lg object-cover shrink-0 border border-[hsl(var(--border))]" />
      ) : (
        <div className="h-12 w-12 flex items-center justify-center shrink-0">
          <FileText className="h-6 w-6" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[hsl(var(--card-foreground))] truncate">{doc.label}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{doc.fileName}</p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg hover:bg-[hsl(var(--secondary))]" onClick={open}>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg hover:bg-red-50 hover:text-red-500" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Doc upload section ────────────────────────────────────────────────────────
function DocSection({
  category, label, icon: Icon, color, docs, jamaahId,
}: {
  category: DocCategory; label: string; icon: React.ElementType; color: string;
  docs: JamaahDoc[]; jamaahId: string;
}) {
  const addDocument = useDocsStore((s) => s.addDocument);
  const removeDoc = useDocsStore((s) => s.removeDoc);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<JamaahDoc | null>(null);

  const catDocs = docs.filter((d) => d.category === category);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File terlalu besar (maks 5 MB)."); return; }
    setUploading(true);
    try {
      const dataUrl = await fileToBase64(file);
      const fileType = file.type.startsWith("image/") ? "image" : "pdf";
      await addDocument({ jamaahId, category, label: file.name.replace(/\.[^.]+$/, ""), fileName: file.name, fileType, dataUrl });
      toast.success("Dokumen berhasil diunggah.");
    } catch {
      toast.error("Gagal mengunggah dokumen.");
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await removeDoc(deleteTarget.id);
    toast.success("Dokumen dihapus.");
    setDeleteTarget(null);
  };

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2.5">
          <div className={cn("h-7 w-7 flex items-center justify-center", color)}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold text-[hsl(var(--card-foreground))]">{label}</span>
          {catDocs.length > 0 && (
            <span className="text-xs bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded-full">{catDocs.length}</span>
          )}
        </div>
        <div>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={handleUpload} />
          <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg border-[hsl(var(--border))]"
            onClick={() => inputRef.current?.click()} disabled={uploading}>
            <Upload className="h-3 w-3 mr-1.5" />
            {uploading ? "Mengunggah…" : "Unggah"}
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {catDocs.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-6 rounded-xl border-2 border-dashed border-[hsl(var(--border))] gap-2 cursor-pointer hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))] transition-all"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Klik untuk unggah PNG / PDF</p>
          </div>
        ) : (
          catDocs.map((doc) => (
            <DocItem key={doc.id} doc={doc} onDelete={() => setDeleteTarget(doc)} />
          ))
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent style={{ background: "#fff", color: "hsl(var(--foreground))" }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Dokumen?</AlertDialogTitle>
            <AlertDialogDescription>Dokumen ini akan dihapus permanen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── JAMAAH PROFILE PAGE ────────────────────────────────────────────────────────
export default function JamaahProfile() {
  const { id: tripId, jamaahId } = useParams<{ id: string; jamaahId: string }>();
  const navigate = useNavigate();
  const trips = useTripsStore((s) => s.trips);
  const { formatDate } = useRegional();
  const { jamaah, fetchJamaah, patchJamaah, getOne } = useJamaahStore();
  const { docs, fetchDocs } = useDocsStore();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const ocrInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Jamaah>>({});
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  // Foto di-fetch terpisah karena listJamaah sengaja exclude photo_data_url
  // (bisa ratusan KB base64 per orang). Hanya JamaahProfile yang butuh foto penuh.
  const [localPhotoDataUrl, setLocalPhotoDataUrl] = useState<string | undefined>();

  const trip = trips.find((t) => t.id === tripId);
  const person = jamaah.find((j) => j.id === jamaahId);

  useEffect(() => {
    if (tripId) fetchJamaah(tripId);
    if (jamaahId) fetchDocs(jamaahId);
  }, [tripId, jamaahId, fetchJamaah, fetchDocs]);

  // Fetch foto terpisah — getOne pakai select("*") yang include photo_data_url.
  useEffect(() => {
    if (!jamaahId) return;
    getOne(jamaahId).then((full) => {
      if (full?.photoDataUrl) setLocalPhotoDataUrl(full.photoDataUrl);
    });
  }, [jamaahId]);

  useEffect(() => {
    if (person) setForm({ name: person.name, phone: person.phone, birthDate: person.birthDate, passportNumber: person.passportNumber, passportExpiry: person.passportExpiry, gender: person.gender, needsReview: person.needsReview });
  }, [person?.id]);

  const handleOcrScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrLoading(true);
    setOcrProgress(0);
    setEditing(true);
    try {
      const result = await scanPassport(file, setOcrProgress, { aiOnly: true });
      if (result.checksums && !result.mrzValid) {
        toast.warning(`MRZ checksum gagal: ${failedChecksumLabels(result).join(", ")}. Cek ulang manual sebelum simpan.`, { duration: 6000 });
      } else if (result.mrzValid) {
        toast.success("MRZ checksum valid.");
      }
      const filled: Partial<Jamaah> = { ...form };
      if (result.name) filled.name = result.name;
      if (result.passportNumber) filled.passportNumber = result.passportNumber;
      if (result.birthDate) filled.birthDate = result.birthDate;
      if (result.gender) filled.gender = result.gender;
      filled.needsReview = result.checksums ? !result.mrzValid : false;
      setForm(filled);
      const fieldsFound = countPassportDataFields(result);
      if (fieldsFound > 0) {
        toast.success(`OCR berhasil! ${fieldsFound} field terisi otomatis.`);
      } else {
        toast.warning("Teks MRZ tidak terbaca. Pastikan foto paspor jelas dan terbuka.");
      }
    } catch (err) {
      toast.error(`Gagal memproses paspor: ${(err as Error).message}`, { duration: 7000 });
    }
    setOcrLoading(false);
    if (ocrInputRef.current) ocrInputRef.current.value = "";
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !jamaahId) return;
    if (file.size > 12 * 1024 * 1024) { toast.error("Foto terlalu besar (maks 12 MB)."); return; }
    const dataUrl = await fileToBase64(file);
    await patchJamaah(jamaahId, { photoDataUrl: dataUrl });
    setLocalPhotoDataUrl(dataUrl);
    toast.success("Foto profil diperbarui.");
  };

  const handleSave = () => {
    if (!jamaahId || !form.name) { toast.error("Nama wajib diisi."); return; }
    const snapshot = { ...form };
    // Keluar mode edit langsung — save di background
    setEditing(false);
    void (async () => {
      try {
        await patchJamaah(jamaahId, snapshot);
        toast.success("Data jamaah diperbarui.");
      } catch {
        toast.error("Gagal memperbarui data jamaah.");
      }
    })();
  };

  if (!person) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-[hsl(var(--muted-foreground))]">Jamaah tidak ditemukan.</p>
        <Button variant="outline" onClick={() => navigate(-1)} className="mt-4">← Kembali</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top bar: Kembali ke Paket + Simpan (saat editing) */}
      <div className="flex items-center justify-between gap-3 sticky top-0 z-10 bg-[hsl(var(--background))]/80 backdrop-blur-sm py-1 -mx-2 px-2">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="outline" size="sm" onClick={() => navigate(`/paket/${tripId}`)}
            className="h-9 rounded-xl gap-1.5 shrink-0">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Kembali ke Paket</span>
          </Button>
          <div className="text-sm text-[hsl(var(--muted-foreground))] truncate">
            <span className="cursor-pointer hover:text-[hsl(var(--primary))]" onClick={() => navigate("/")}>Paket Trip</span>
            <span className="mx-1.5">›</span>
            <span className="cursor-pointer hover:text-[hsl(var(--primary))]" onClick={() => navigate(`/paket/${tripId}`)}>{trip?.name}</span>
            <span className="mx-1.5">›</span>
            <span className="font-medium text-[hsl(var(--card-foreground))]">{person.name}</span>
          </div>
        </div>
        {editing && (
          <Button size="sm" onClick={handleSave} disabled={saving}
            className="h-9 rounded-xl gradient-primary text-white hover:opacity-90 shrink-0">
            <Save className="h-3.5 w-3.5 mr-1.5" /> {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        )}
      </div>

      {/* Profile card */}
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
        {/* Gradient banner */}
        <div className={cn(
          "h-28 bg-gradient-to-r",
          person.gender === "P" ? "from-pink-400 to-rose-500" : "from-blue-400 to-indigo-500"
        )} />

        <div className="px-6 pb-6">
          {/* Avatar row */}
          <div className="flex items-end justify-between -mt-12 mb-4">
            <div className="relative">
              <div className={cn(
                "h-24 w-24 rounded-2xl border-4 border-white shadow-md overflow-hidden flex items-center justify-center text-white text-3xl font-bold",
                person.gender === "P" ? "bg-gradient-to-br from-pink-400 to-rose-500" : "bg-gradient-to-br from-blue-400 to-indigo-500"
              )}>
                {localPhotoDataUrl
                  ? <img src={localPhotoDataUrl} alt={person.name} className="h-full w-full object-cover" />
                  : person.name.charAt(0).toUpperCase()}
              </div>
              <button
                onClick={() => photoInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white/90 shadow-sm flex items-center justify-center hover:bg-white transition-colors"
              >
                <Camera className="h-3.5 w-3.5 text-white" />
              </button>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            </div>

            <div className="flex items-center gap-2 mb-1 flex-wrap justify-end">
              <input ref={ocrInputRef} type="file" accept="image/*" className="hidden" onChange={handleOcrScan} />
              <Button variant="outline" size="sm" className="h-8 text-xs rounded-xl border-violet-200 text-violet-700 hover:bg-violet-50"
                onClick={() => ocrInputRef.current?.click()} disabled={ocrLoading}>
                <ScanLine className="h-3 w-3 mr-1" />
                {ocrLoading ? (ocrProgress < 35 ? "Memuat AI…" : `OCR ${ocrProgress}%`) : "Scan Paspor (OCR)"}
              </Button>
              {editing ? (
                <>
                  <Button variant="outline" size="sm" className="h-8 text-xs rounded-xl" onClick={() => setEditing(false)}>
                    <X className="h-3 w-3 mr-1" /> Batal
                  </Button>
                  <Button size="sm" className="h-8 text-xs rounded-xl gradient-primary text-white hover:opacity-90"
                    onClick={handleSave} disabled={saving}>
                    <Save className="h-3 w-3 mr-1" /> {saving ? "Menyimpan…" : "Simpan"}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" className="h-8 text-xs rounded-xl" onClick={() => setEditing(true)}>
                  <Pencil className="h-3 w-3 mr-1" /> Edit Data
                </Button>
              )}
            </div>
          </div>

          {/* Info form / display */}
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-[hsl(var(--muted-foreground))]">Nama Lengkap *</Label>
                <Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[hsl(var(--muted-foreground))]">Jenis Kelamin</Label>
                <Select value={form.gender ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, gender: v as "L" | "P" }))}>
                  <SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent style={{ background: "#fff", color: "hsl(var(--foreground))" }}>
                    <SelectItem value="L">Laki-laki</SelectItem>
                    <SelectItem value="P">Perempuan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[hsl(var(--muted-foreground))]">No. HP</Label>
                <Input value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[hsl(var(--muted-foreground))]">Tanggal Lahir</Label>
                <Input type="date" value={form.birthDate ?? ""} onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[hsl(var(--muted-foreground))]">No. Paspor</Label>
                <Input value={form.passportNumber ?? ""} onChange={(e) => setForm((f) => ({ ...f, passportNumber: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[hsl(var(--muted-foreground))]">Tgl. Expired Paspor</Label>
                <Input type="date" value={form.passportExpiry ?? ""} onChange={(e) => setForm((f) => ({ ...f, passportExpiry: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.needsReview}
                    onChange={(e) => setForm((f) => ({ ...f, needsReview: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border-amber-300 text-amber-600 focus:ring-amber-400"
                  />
                  <span>Tandai "Perlu Review" (mis. hasil OCR perlu diverifikasi)</span>
                </label>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-[hsl(var(--card-foreground))]">{person.name}</h2>
                {person.needsReview && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-200" title="MRZ checksum gagal saat OCR — verifikasi data manual">
                    ⚠ PERLU REVIEW
                  </span>
                )}
              </div>
              {person.gender && (
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full mt-1 inline-block",
                  person.gender === "P" ? "bg-pink-50 text-pink-500" : "bg-blue-50 text-blue-500")}>
                  {person.gender === "P" ? "Perempuan" : "Laki-laki"}
                </span>
              )}
              <div className="mt-3 grid gap-y-2 gap-x-6 sm:grid-cols-2 text-sm">
                {[
                  { label: "No. HP", value: person.phone },
                  { label: "Tanggal Lahir", value: person.birthDate ? formatDate(person.birthDate, "full") : "" },
                  { label: "No. Paspor", value: person.passportNumber },
                ].map(({ label, value }) => value ? (
                  <div key={label}>
                    <span className="text-xs text-[hsl(var(--muted-foreground))] block">{label}</span>
                    <span className="font-medium text-[hsl(var(--card-foreground))]">{value}</span>
                  </div>
                ) : null)}
              </div>
              {person.bookingCode && <BookingCodeShare code={person.bookingCode} jamaahName={person.name} />}
            </div>
          )}
        </div>
      </div>

      {/* Gamified Progress Tracker */}
      {(() => {
        const steps = [
          { key: "Daftar",   icon: CheckCircle2, label: "Terdaftar", check: () => true },
          { key: "Paspor",   icon: FileKey,      label: "Paspor",    check: () => docs.some((d) => d.category === "passport") },
          { key: "Visa",     icon: ShieldCheck,  label: "Visa",      check: () => docs.some((d) => d.category === "visa") },
          { key: "Bayar",    icon: CreditCard,   label: "Pembayaran",check: () => docs.some((d) => d.category === "other") },
          { key: "Tiket",    icon: Plane,        label: "Tiket",     check: () => docs.some((d) => d.category === "ticket") },
          { key: "Siap",     icon: Clock,        label: "Siap Berangkat", check: () => ["passport","visa","ticket"].every((c) => docs.some((d) => d.category === c)) },
        ];
        const completed = steps.filter((s) => s.check()).length;
        const pct = Math.round((completed / steps.length) * 100);

        return (
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[hsl(var(--border))] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[hsl(var(--card-foreground))]">Progres Kelengkapan</h3>
              <span className="text-sm font-bold text-orange-500">{pct}%</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, background: "linear-gradient(90deg, #f97316, #fb923c)" }}
                />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {steps.map((step) => {
                  const done = step.check();
                  const Icon = step.icon;
                  return (
                    <div key={step.key} className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-xl text-center transition-all",
                      done ? "bg-orange-50 border border-orange-200" : "bg-gray-50 border border-gray-100"
                    )}>
                      <div className={cn(
                        "h-7 w-7 rounded-full flex items-center justify-center",
                        done ? "bg-orange-500" : "bg-gray-200"
                      )}>
                        <Icon className={cn("h-3.5 w-3.5", done ? "text-white" : "text-gray-400")} strokeWidth={2} />
                      </div>
                      <span className={cn("text-[10px] font-medium leading-tight", done ? "text-orange-700" : "text-gray-400")}>{step.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Payments */}
      {jamaahId && trip && (
        <PaymentSection jamaahId={jamaahId} tripId={trip.id} pricePerPax={trip.pricePerPax} />
      )}

      {/* Document sections */}
      <div>
        <h3 className="text-sm font-semibold text-[hsl(var(--card-foreground))] mb-3">Pemberkasan & Dokumen</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {DOC_CATEGORIES.map((cat) => (
            <DocSection
              key={cat.key}
              category={cat.key}
              label={cat.label}
              icon={cat.icon}
              color={cat.color}
              docs={docs}
              jamaahId={jamaahId!}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
