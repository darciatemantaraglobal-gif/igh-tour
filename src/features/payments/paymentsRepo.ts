import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { requireAgencyId } from "@/store/authStore";

export type PaymentType = "dp" | "installment" | "final" | "refund" | "other";

export interface Payment {
  id: string;
  jamaahId: string;
  tripId?: string;
  type: PaymentType;
  amount: number;
  method: string;
  paidAt: string;
  notes: string;
  proofUrl?: string;
  createdAt: string;
}

const PROOF_BUCKET = "payment-proofs";

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

export async function uploadPaymentProof(file: File, jamaahId: string): Promise<string> {
  if (!isSupabaseConfigured()) throw new Error("Supabase belum dikonfigurasi.");
  const agencyId = requireAgencyId();
  const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || "bin").toLowerCase();
  const path = `${agencyId}/${safeName(jamaahId)}_${Date.now()}.${ext}`;
  const { error } = await supabase!.storage.from(PROOF_BUCKET).upload(path, file, {
    upsert: false, contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

export async function getProofSignedUrl(path: string): Promise<string | null> {
  if (!isSupabaseConfigured() || !path) return null;
  const { data, error } = await supabase!.storage.from(PROOF_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function deletePaymentProof(path: string): Promise<void> {
  if (!isSupabaseConfigured() || !path) return;
  await supabase!.storage.from(PROOF_BUCKET).remove([path]);
}

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  dp: "DP / Down Payment",
  installment: "Angsuran",
  final: "Pelunasan",
  refund: "Refund",
  other: "Lainnya",
};

const fromRow = (r: Record<string, unknown>): Payment => ({
  id: String(r.id),
  jamaahId: String(r.jamaah_id),
  tripId: (r.trip_id as string) ?? undefined,
  type: (r.type as PaymentType) ?? "other",
  amount: Number(r.amount ?? 0),
  method: String(r.method ?? ""),
  paidAt: String(r.paid_at ?? ""),
  notes: String(r.notes ?? ""),
  proofUrl: (r.proof_url as string) ?? undefined,
  createdAt: String(r.created_at ?? new Date().toISOString()),
});

const toRow = (p: Payment, agencyId?: string) => ({
  id: p.id,
  jamaah_id: p.jamaahId,
  trip_id: p.tripId ?? null,
  type: p.type,
  amount: p.amount,
  method: p.method,
  paid_at: p.paidAt,
  notes: p.notes,
  proof_url: p.proofUrl ?? null,
  created_at: p.createdAt,
  ...(agencyId ? { agency_id: agencyId } : {}),
});

export async function listPaymentsByJamaah(jamaahId: string): Promise<Payment[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase!
    .from("payments").select("*").eq("jamaah_id", jamaahId).order("paid_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function listPaymentsByTrip(tripId: string): Promise<Payment[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase!
    .from("payments").select("*").eq("trip_id", tripId);
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function createPayment(draft: Omit<Payment, "id" | "createdAt">): Promise<Payment> {
  const p: Payment = { ...draft, id: `pay-${Date.now()}`, createdAt: new Date().toISOString() };
  if (isSupabaseConfigured()) {
    const agencyId = requireAgencyId();
    const { error } = await supabase!.from("payments").insert(toRow(p, agencyId));
    if (error) throw error;
  }
  return p;
}

export async function deletePayment(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    // Satu query: DELETE ... RETURNING proof_url — tidak perlu SELECT dulu.
    const { data, error } = await supabase!
      .from("payments")
      .delete()
      .eq("id", id)
      .select("proof_url");
    if (error) {
      console.error(`[payments] DELETE id=${id} gagal:`, error);
      throw error;
    }
    if (!data || data.length === 0) {
      throw new Error(
        "Hapus pembayaran gagal — server tidak menghapus baris " +
        "(kemungkinan RLS DELETE policy nge-blok). Cek policy \"payments_delete\" di Supabase.",
      );
    }
    const proofPath = (data[0]?.proof_url as string) || "";
    if (proofPath) await deletePaymentProof(proofPath);
  }
}

export async function listAllAgencyPayments(): Promise<Payment[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase!.from("payments").select("*");
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export function sumPaid(payments: Payment[]): number {
  return payments.reduce((s, p) => s + (p.type === "refund" ? -p.amount : p.amount), 0);
}

export type PaymentStatus = "lunas" | "sebagian" | "belum";

export function paymentStatus(totalPrice: number, payments: Payment[]): PaymentStatus {
  const paid = sumPaid(payments);
  if (paid <= 0) return "belum";
  if (paid >= totalPrice && totalPrice > 0) return "lunas";
  return "sebagian";
}
