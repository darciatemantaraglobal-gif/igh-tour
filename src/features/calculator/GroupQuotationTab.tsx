import { useState, useMemo } from "react";
import { Plus, Trash2, Download, FileText, Zap, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Exported types ─────────────────────────────────────────────────────────────

export interface PriceTier {
  minPax: number;
  maxPax: number;
  pricePerPax: number;
}

export interface GroupQuotation {
  packageName: string;
  duration: string;
  itinerary: string;
  hotelSummary: string;
  includes: string[];
  excludes: string[];
  basePricePerPax: number;
  useAutoCalc: boolean;
  tiers: PriceTier[];
  notes: string;
}

// Standard tier ranges (15-49 pax, 6 bands)
const STANDARD_TIERS: PriceTier[] = [
  { minPax: 15, maxPax: 19, pricePerPax: 0 },
  { minPax: 20, maxPax: 24, pricePerPax: 0 },
  { minPax: 25, maxPax: 29, pricePerPax: 0 },
  { minPax: 30, maxPax: 34, pricePerPax: 0 },
  { minPax: 35, maxPax: 39, pricePerPax: 0 },
  { minPax: 40, maxPax: 49, pricePerPax: 0 },
];

export const DEFAULT_GROUP_QUOTATION: GroupQuotation = {
  packageName: "",
  duration: "",
  itinerary: "",
  hotelSummary: "",
  includes: [
    "Tiket pesawat PP (kelas ekonomi)",
    "Akomodasi hotel bintang sesuai program",
    "Visa Umroh",
    "Transportasi full AC selama program",
    "Makan 3× sehari sesuai program",
    "Air zam-zam 5 liter per jamaah",
    "Bimbingan Muthowif berpengalaman",
    "Perlengkapan ibadah (koper, seragam, dll)",
  ],
  excludes: [
    "Biaya paspor & perpanjangan paspor",
    "Biaya vaksinasi meningitis & biaya PCR",
    "Tips untuk guide & driver lokal",
    "Pengeluaran dan keperluan pribadi",
    "Biaya kelebihan bagasi pesawat",
  ],
  basePricePerPax: 0,
  useAutoCalc: true,
  tiers: STANDARD_TIERS.map((t) => ({ ...t })),
  notes: "",
};

// Auto-markup per tier: descending as pax grows (economies of scale)
// Tier 0 (15-19 pax) = smallest group → highest markup
const AUTO_MARKUPS = [0.30, 0.25, 0.20, 0.15, 0.10, 0.05];

function computeAutoTierPrices(base: number, tiers: PriceTier[]): PriceTier[] {
  if (!base) return tiers;
  return tiers.map((t, i) => ({
    ...t,
    // Round up to nearest Rp 50.000 for clean quotation numbers
    pricePerPax: Math.ceil((base * (1 + (AUTO_MARKUPS[i] ?? 0.05))) / 50_000) * 50_000,
  }));
}

// ── Style constants ────────────────────────────────────────────────────────────

const M = { fontFamily: "'Manrope', sans-serif" };

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmtIDR(n: number) {
  return n ? "Rp " + Math.round(n).toLocaleString("id-ID") : "—";
}

// ── Small shared sub-components ───────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-orange-200 bg-white overflow-hidden">
      <div
        className="px-4 py-2.5 border-b border-orange-100"
        style={{ background: "linear-gradient(135deg,#fff7ed,#ffedd5)" }}
      >
        <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700">
          {title}
        </p>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={M} className="text-[10px] font-bold uppercase tracking-wider text-orange-700 mb-1.5">
      {children}
    </p>
  );
}

function TextInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={M}
      className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
    />
  );
}

function NumInput({
  value, onChange, placeholder,
}: { value: number; onChange: (v: number) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value > 0 ? value.toLocaleString("id-ID") : ""}
      onChange={(e) => {
        const s = e.target.value.replace(/\./g, "").replace(/[^0-9]/g, "");
        onChange(s ? Number(s) : 0);
      }}
      placeholder={placeholder ?? "0"}
      style={M}
      className="w-full h-8 rounded-lg border border-orange-200 bg-white px-2.5 text-[12px] text-right font-mono focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
    />
  );
}

function ListEditor({
  items, onChange, placeholder,
}: { items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-orange-400 text-xs w-4 text-center shrink-0">•</span>
          <input
            type="text"
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            style={M}
            className="flex-1 h-7 rounded-lg border border-orange-200 bg-white px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors shrink-0"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        style={M}
        className="flex items-center gap-1 text-[11px] font-semibold text-orange-600 hover:text-orange-700 mt-1 transition-colors"
      >
        <Plus className="h-3 w-3" /> Tambah
      </button>
    </div>
  );
}

// ── Live Preview ──────────────────────────────────────────────────────────────

function QuotationPreview({
  q, computedTiers,
}: { q: GroupQuotation; computedTiers: PriceTier[] }) {
  return (
    <div className="space-y-5 bg-white rounded-xl border border-orange-100 p-5 md:p-6">
      {/* Header */}
      <div className="text-center border-b-2 border-orange-200 pb-4">
        <p style={M} className="text-[10px] font-bold uppercase tracking-widest text-orange-500 mb-1">
          IGH Tour
        </p>
        <h2 style={M} className="text-base font-extrabold text-orange-700 uppercase tracking-wide">
          Penawaran Harga Grup Umroh & Haji
        </h2>
        <h3 style={M} className="text-[15px] font-bold text-[hsl(var(--foreground))] mt-1">
          {q.packageName || <span className="text-muted-foreground italic font-normal">Nama Paket</span>}
        </h3>
        {q.duration && (
          <p style={M} className="text-[12px] text-muted-foreground mt-0.5">{q.duration}</p>
        )}
      </div>

      {/* Hotel */}
      {q.hotelSummary && (
        <div>
          <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700 mb-1.5">
            🏨 Hotel
          </p>
          <p style={M} className="text-[12px]">{q.hotelSummary}</p>
        </div>
      )}

      {/* Itinerary */}
      {q.itinerary && (
        <div>
          <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700 mb-1.5">
            📋 Itinerary Singkat
          </p>
          <p style={M} className="text-[12px] whitespace-pre-wrap leading-relaxed">{q.itinerary}</p>
        </div>
      )}

      {/* Include / Exclude */}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 mb-2">
            ✅ Include
          </p>
          <ul className="space-y-1">
            {q.includes.filter(Boolean).map((item, i) => (
              <li key={i} style={M} className="text-[12px] flex gap-2 items-start">
                <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                <span>{item}</span>
              </li>
            ))}
            {q.includes.filter(Boolean).length === 0 && (
              <li style={M} className="text-[11px] text-muted-foreground italic">—</li>
            )}
          </ul>
        </div>
        <div>
          <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-red-700 mb-2">
            ❌ Exclude
          </p>
          <ul className="space-y-1">
            {q.excludes.filter(Boolean).map((item, i) => (
              <li key={i} style={M} className="text-[12px] flex gap-2 items-start">
                <span className="text-red-400 shrink-0 mt-0.5">✗</span>
                <span>{item}</span>
              </li>
            ))}
            {q.excludes.filter(Boolean).length === 0 && (
              <li style={M} className="text-[11px] text-muted-foreground italic">—</li>
            )}
          </ul>
        </div>
      </div>

      {/* Price Table */}
      <div>
        <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700 mb-2">
          💰 Harga Per Peserta
        </p>
        <div className="overflow-x-auto rounded-xl border border-orange-200">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "linear-gradient(135deg,#ea580c,#f97316)" }}>
                <th style={M} className="px-3 py-2.5 text-left text-[10px] font-bold text-white">
                  Jumlah Peserta
                </th>
                <th style={M} className="px-3 py-2.5 text-right text-[10px] font-bold text-white">
                  Harga / Pax
                </th>
                <th style={M} className="px-3 py-2.5 text-right text-[10px] font-bold text-white hidden sm:table-cell">
                  Markup vs Base
                </th>
              </tr>
            </thead>
            <tbody>
              {computedTiers.map((tier, i) => (
                <tr
                  key={i}
                  className={cn(
                    "border-b border-orange-50 last:border-0",
                    i % 2 === 0 ? "bg-white" : "bg-orange-50/40",
                  )}
                >
                  <td style={M} className="px-3 py-2.5 text-[12px] font-semibold">
                    {tier.minPax} – {tier.maxPax} orang
                  </td>
                  <td style={M} className="px-3 py-2.5 text-[13px] font-bold text-orange-700 text-right font-mono">
                    {fmtIDR(tier.pricePerPax)}
                  </td>
                  <td style={M} className="px-3 py-2.5 text-[11px] text-muted-foreground text-right font-mono hidden sm:table-cell">
                    {q.basePricePerPax > 0 && tier.pricePerPax > 0
                      ? `+${Math.round((tier.pricePerPax / q.basePricePerPax - 1) * 100)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {q.basePricePerPax > 0 && (
          <p style={M} className="text-[10px] text-muted-foreground mt-1.5 text-right">
            * Harga berdasarkan HPP Rp {q.basePricePerPax.toLocaleString("id-ID")}/pax
          </p>
        )}
      </div>

      {/* Notes */}
      {q.notes && (
        <div className="border-t border-orange-100 pt-4">
          <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700 mb-1.5">
            📝 Catatan
          </p>
          <p style={M} className="text-[12px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {q.notes}
          </p>
        </div>
      )}
    </div>
  );
}

// ── PDF Export ────────────────────────────────────────────────────────────────

async function exportGroupQuotationPdf(
  q: GroupQuotation,
  computedTiers: PriceTier[],
): Promise<void> {
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  const margin = 48;
  const contentW = width - margin * 2;

  // Colors
  const orange    = rgb(0.914, 0.341, 0.075);
  const orangeHdr = rgb(1.000, 0.929, 0.863);
  const orangeRow = rgb(1.000, 0.969, 0.941);
  const white     = rgb(1, 1, 1);
  const dark      = rgb(0.12, 0.12, 0.12);
  const muted     = rgb(0.50, 0.50, 0.50);
  const emerald   = rgb(0.047, 0.573, 0.431);
  const red       = rgb(0.75, 0.15, 0.15);

  // Helper: fill rect (y = top of rect in document coords, grows downward)
  function fillRect(
    x: number, yTop: number, w: number, h: number,
    color: ReturnType<typeof rgb>,
  ) {
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, color });
  }

  // Helper: draw text; y = top baseline of text line
  function drawText(
    text: string, x: number, yTop: number,
    opts: { font?: typeof bold; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) {
    const size = opts.size ?? 10;
    page.drawText(text.replace(/[^\x20-\x7E]/g, ""), {
      x,
      y: yTop - size,
      font: opts.font ?? reg,
      size,
      color: opts.color ?? dark,
    });
  }

  // Helper: horizontal rule
  function hRule(yTop: number, color: ReturnType<typeof rgb> = rgb(0.87, 0.87, 0.87)) {
    page.drawLine({ start: { x: margin, y: yTop }, end: { x: margin + contentW, y: yTop }, thickness: 0.5, color });
  }

  // Helper: section header banner
  function sectionHeader(label: string, yTop: number): number {
    const h = 19;
    fillRect(margin, yTop, contentW, h, orangeHdr);
    hRule(yTop - h, orange);
    drawText(label.toUpperCase(), margin + 8, yTop - 4, { font: bold, size: 8, color: orange });
    return yTop - h - 6;
  }

  // Helper: simple text wrap
  function wrapText(text: string, maxW: number, size: number, font: typeof reg): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  let y = height; // tracks current top position

  // ── Header banner ──────────────────────────────────────────────────────────
  const bannerH = 64;
  fillRect(0, height, width, bannerH, orange);

  // Agency label
  drawText("IGH TOUR", margin, height - 10, { font: bold, size: 9, color: rgb(1, 0.9, 0.8) });

  // Document title (centered)
  const titleStr = "PENAWARAN HARGA GRUP UMROH & HAJI";
  const titleSz = 11;
  drawText(
    titleStr,
    width / 2 - bold.widthOfTextAtSize(titleStr, titleSz) / 2,
    height - 10,
    { font: bold, size: titleSz, color: white },
  );

  // Package name
  const pkgName = q.packageName || "Nama Paket";
  const pkgSz = 15;
  drawText(
    pkgName,
    width / 2 - bold.widthOfTextAtSize(pkgName, pkgSz) / 2,
    height - 26,
    { font: bold, size: pkgSz, color: white },
  );

  // Duration
  if (q.duration) {
    const durSz = 9;
    drawText(
      q.duration,
      width / 2 - reg.widthOfTextAtSize(q.duration, durSz) / 2,
      height - 44,
      { size: durSz, color: rgb(1, 0.88, 0.78) },
    );
  }

  y = height - bannerH - 8;

  // ── Hotel ──────────────────────────────────────────────────────────────────
  if (q.hotelSummary) {
    y = sectionHeader("Hotel", y);
    for (const line of wrapText(q.hotelSummary, contentW - 16, 10, reg)) {
      drawText(line, margin + 8, y, { size: 10 });
      y -= 14;
    }
    y -= 6;
  }

  // ── Itinerary ──────────────────────────────────────────────────────────────
  if (q.itinerary) {
    y = sectionHeader("Itinerary Singkat", y);
    for (const rawLine of q.itinerary.split("\n").slice(0, 20)) {
      if (y < margin + 100) break;
      for (const line of wrapText(rawLine || " ", contentW - 16, 9, reg)) {
        drawText(line, margin + 8, y, { size: 9 });
        y -= 13;
      }
    }
    y -= 6;
  }

  // ── Include / Exclude (two columns) ───────────────────────────────────────
  const incItems = q.includes.filter(Boolean);
  const excItems = q.excludes.filter(Boolean);

  if (incItems.length > 0 || excItems.length > 0) {
    y = sectionHeader("Include & Exclude", y);

    const colW = (contentW - 10) / 2;

    // Column sub-headers
    const subHH = 14;
    fillRect(margin, y, colW, subHH, rgb(0.925, 0.969, 0.945));
    drawText("INCLUDE", margin + 6, y - 3, { font: bold, size: 7, color: emerald });
    fillRect(margin + colW + 10, y, colW, subHH, rgb(1, 0.95, 0.95));
    drawText("EXCLUDE", margin + colW + 10 + 6, y - 3, { font: bold, size: 7, color: red });
    y -= subHH + 2;

    const maxRows = Math.max(incItems.length, excItems.length);
    for (let i = 0; i < maxRows; i++) {
      if (y < margin + 100) break;
      if (incItems[i]) {
        drawText("• " + incItems[i], margin + 6, y, { size: 9, color: emerald });
      }
      if (excItems[i]) {
        drawText("• " + excItems[i], margin + colW + 10 + 6, y, { size: 9, color: red });
      }
      y -= 12;
    }
    y -= 6;
  }

  // ── Price Table ────────────────────────────────────────────────────────────
  y = sectionHeader("Harga Per Peserta", y);

  const rowH = 20;
  const col2X = margin + contentW * 0.48;
  const col3X = margin + contentW * 0.75;

  // Table header row
  fillRect(margin, y, contentW, rowH, orange);
  drawText("JUMLAH PESERTA", margin + 8, y - 5, { font: bold, size: 8.5, color: white });
  drawText("HARGA / PAX", col2X, y - 5, { font: bold, size: 8.5, color: white });
  drawText("MARKUP", col3X, y - 5, { font: bold, size: 8.5, color: white });
  y -= rowH;

  computedTiers.forEach((tier, i) => {
    if (y < margin + 40) return;
    fillRect(margin, y, contentW, rowH, i % 2 === 0 ? white : orangeRow);
    page.drawLine({
      start: { x: margin, y: y - rowH },
      end: { x: margin + contentW, y: y - rowH },
      thickness: 0.3,
      color: rgb(0.9, 0.87, 0.83),
    });
    drawText(`${tier.minPax} - ${tier.maxPax} orang`, margin + 8, y - 5, { size: 10 });
    const priceStr = tier.pricePerPax
      ? "Rp " + tier.pricePerPax.toLocaleString("id-ID")
      : "-";
    drawText(priceStr, col2X, y - 5, { font: bold, size: 10, color: orange });
    if (q.basePricePerPax > 0 && tier.pricePerPax > 0) {
      const markup = Math.round((tier.pricePerPax / q.basePricePerPax - 1) * 100);
      drawText(`+${markup}%`, col3X, y - 5, { size: 9, color: muted });
    }
    y -= rowH;
  });

  if (q.basePricePerPax > 0) {
    y -= 4;
    const noteStr = `* Harga berdasarkan HPP Rp ${q.basePricePerPax.toLocaleString("id-ID")}/pax`;
    drawText(noteStr, margin + contentW - reg.widthOfTextAtSize(noteStr, 8), y, {
      size: 8, color: muted,
    });
    y -= 14;
  }
  y -= 6;

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (q.notes) {
    y = sectionHeader("Catatan", y);
    for (const rawLine of q.notes.split("\n")) {
      if (y < margin + 40) break;
      for (const line of wrapText(rawLine || " ", contentW - 16, 9, reg)) {
        drawText(line, margin + 8, y, { size: 9, color: muted });
        y -= 13;
      }
    }
    y -= 6;
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerY = margin + 24;
  hRule(footerY + 12);
  drawText(
    "Dokumen disiapkan oleh IGH Tour  •  Harga berlaku sesuai periode yang disepakati",
    margin,
    footerY + 6,
    { size: 7.5, color: muted },
  );

  // ── Download ───────────────────────────────────────────────────────────────
  const bytes = await doc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `penawaran-${(q.packageName || "grup").replace(/\s+/g, "-").toLowerCase()}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Main component ─────────────────────────────────────────────────────────────

interface GroupQuotationTabProps {
  quotation: GroupQuotation;
  onChange: (q: GroupQuotation) => void;
  perPaxFromCalc: number;
  hotelNamesFromCalc: string[];
  packageNameFromCalc: string;
  durationFromCalc: string;
}

export default function GroupQuotationTab({
  quotation: q,
  onChange,
  perPaxFromCalc,
  hotelNamesFromCalc,
  packageNameFromCalc,
  durationFromCalc,
}: GroupQuotationTabProps) {
  const [exporting, setExporting] = useState(false);

  function patch(updates: Partial<GroupQuotation>) {
    onChange({ ...q, ...updates });
  }

  // Computed tiers: auto-calculated when toggle on, otherwise use stored values
  const computedTiers = useMemo(() => {
    if (q.useAutoCalc && q.basePricePerPax > 0) {
      return computeAutoTierPrices(q.basePricePerPax, q.tiers);
    }
    return q.tiers;
  }, [q.useAutoCalc, q.basePricePerPax, q.tiers]);

  function handleBasePrice(v: number) {
    if (q.useAutoCalc && v > 0) {
      patch({ basePricePerPax: v, tiers: computeAutoTierPrices(v, q.tiers) });
    } else {
      patch({ basePricePerPax: v });
    }
  }

  function handleAutoCalcToggle(checked: boolean) {
    if (checked && q.basePricePerPax > 0) {
      patch({ useAutoCalc: true, tiers: computeAutoTierPrices(q.basePricePerPax, q.tiers) });
    } else {
      patch({ useAutoCalc: checked });
    }
  }

  function resetToStandardTiers() {
    const reset = STANDARD_TIERS.map((t) => ({ ...t }));
    patch({
      tiers: q.useAutoCalc && q.basePricePerPax > 0
        ? computeAutoTierPrices(q.basePricePerPax, reset)
        : reset,
    });
  }

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      await exportGroupQuotationPdf(q, computedTiers);
      toast.success("PDF penawaran berhasil diunduh.");
    } catch (err) {
      toast.error("Gagal export PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4" style={M}>

      {/* ── Section A: Package Info ─────────────────────────────────────────── */}
      <SectionCard title="Bagian A — Informasi Paket">

        <div className="grid md:grid-cols-2 gap-3">
          {/* Nama Paket */}
          <div>
            <FieldLabel>Nama Paket</FieldLabel>
            <div className="flex gap-1.5">
              <TextInput
                value={q.packageName}
                onChange={(v) => patch({ packageName: v })}
                placeholder="Nama paket untuk penawaran"
              />
              {packageNameFromCalc && q.packageName !== packageNameFromCalc && (
                <button
                  type="button"
                  onClick={() => patch({ packageName: packageNameFromCalc })}
                  title={`Ambil "${packageNameFromCalc}" dari kalkulator`}
                  style={M}
                  className="shrink-0 h-8 px-2 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-bold transition-colors"
                >
                  ↙ Kalkulator
                </button>
              )}
            </div>
          </div>

          {/* Durasi */}
          <div>
            <FieldLabel>Durasi</FieldLabel>
            <div className="flex gap-1.5">
              <TextInput
                value={q.duration}
                onChange={(v) => patch({ duration: v })}
                placeholder="cth: 9 Hari 8 Malam"
              />
              {durationFromCalc && (
                <button
                  type="button"
                  onClick={() => patch({ duration: durationFromCalc })}
                  title={`Ambil "${durationFromCalc}" dari tanggal paket`}
                  style={M}
                  className="shrink-0 h-8 px-2 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-bold transition-colors whitespace-nowrap"
                >
                  ↙ {durationFromCalc}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Hotel */}
        <div>
          <FieldLabel>Daftar Hotel</FieldLabel>
          <div className="flex gap-1.5">
            <TextInput
              value={q.hotelSummary}
              onChange={(v) => patch({ hotelSummary: v })}
              placeholder="cth: Makkah: Al Marwa Rayhaan 5★ · Madinah: Anwar Al Madinah 4★"
            />
            {hotelNamesFromCalc.length > 0 && (
              <button
                type="button"
                onClick={() => patch({ hotelSummary: hotelNamesFromCalc.join(" · ") })}
                style={M}
                className="shrink-0 h-8 px-2 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-bold transition-colors whitespace-nowrap"
              >
                ↙ Hotel
              </button>
            )}
          </div>
        </div>

        {/* Itinerary */}
        <div>
          <FieldLabel>Itinerary Singkat</FieldLabel>
          <textarea
            value={q.itinerary}
            onChange={(e) => patch({ itinerary: e.target.value })}
            placeholder={"Hari 1: Berangkat dari SUB – tiba JED\nHari 2: Transfer ke Makkah, umroh wajib\n..."}
            rows={5}
            style={M}
            className="w-full rounded-lg border border-orange-200 bg-white px-2.5 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none"
          />
        </div>

        {/* Include / Exclude */}
        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <FieldLabel>Include (Termasuk dalam Paket)</FieldLabel>
            <ListEditor
              items={q.includes}
              onChange={(items) => patch({ includes: items })}
              placeholder="cth: Tiket pesawat PP"
            />
          </div>
          <div>
            <FieldLabel>Exclude (Tidak Termasuk)</FieldLabel>
            <ListEditor
              items={q.excludes}
              onChange={(items) => patch({ excludes: items })}
              placeholder="cth: Pengeluaran pribadi"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <FieldLabel>Catatan Tambahan</FieldLabel>
          <textarea
            value={q.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Syarat & ketentuan, batas pendaftaran, kontak, dll..."
            rows={2}
            style={M}
            className="w-full rounded-lg border border-orange-200 bg-white px-2.5 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none"
          />
        </div>
      </SectionCard>

      {/* ── Section B: Price Tiers ──────────────────────────────────────────── */}
      <SectionCard title="Bagian B — Struktur Harga Grup">

        {/* Base Price row */}
        <div>
          <FieldLabel>Base Price / Pax (HPP Acuan)</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[150px] max-w-[220px]">
              <NumInput value={q.basePricePerPax} onChange={handleBasePrice} placeholder="0" />
            </div>
            {perPaxFromCalc > 0 && (
              <button
                type="button"
                onClick={() => handleBasePrice(perPaxFromCalc)}
                style={M}
                className="h-8 px-3 rounded-lg border border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[11px] font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Zap className="h-3 w-3" />
                Ambil dari Kalkulasi ({fmtIDR(perPaxFromCalc)})
              </button>
            )}
          </div>
          <p style={M} className="text-[10px] text-muted-foreground mt-1.5">
            HPP per pax dari tab Kalkulator — digunakan sebagai dasar perhitungan harga tier grup.
          </p>
        </div>

        {/* Auto-calc toggle */}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-orange-50/60 border border-orange-200 px-3 py-3">
          <div>
            <p style={M} className="text-[12px] font-semibold text-orange-800">Hitung Otomatis</p>
            <p style={M} className="text-[10px] text-orange-600 mt-0.5">
              Tier dihitung otomatis:{" "}
              {AUTO_MARKUPS.map((m) => `+${Math.round(m * 100)}%`).join(", ")} dari base price
            </p>
          </div>
          <Switch checked={q.useAutoCalc} onCheckedChange={handleAutoCalcToggle} />
        </div>

        {/* Tier table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <FieldLabel>Tabel Harga Tier</FieldLabel>
            <button
              type="button"
              onClick={resetToStandardTiers}
              style={M}
              className="flex items-center gap-1 text-[10px] font-semibold text-orange-600 hover:text-orange-700 border border-orange-200 bg-white hover:bg-orange-50 rounded-lg px-2 py-1 transition-colors"
            >
              <RotateCcw className="h-2.5 w-2.5" /> Tier Standar (15–49)
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-orange-200">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: "linear-gradient(135deg,#fff7ed,#ffedd5)" }}>
                  <th style={M} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-orange-700 border-b border-orange-200">
                    #
                  </th>
                  <th style={M} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-orange-700 border-b border-orange-200">
                    Jumlah Peserta
                  </th>
                  <th style={M} className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-orange-700 border-b border-orange-200">
                    Harga / Pax
                  </th>
                  <th style={M} className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-orange-700 border-b border-orange-200 hidden sm:table-cell">
                    Markup
                  </th>
                </tr>
              </thead>
              <tbody>
                {computedTiers.map((tier, i) => (
                  <tr
                    key={i}
                    className={cn(
                      "border-b border-orange-50 last:border-0 transition-colors",
                      i % 2 === 0 ? "bg-white" : "bg-orange-50/30",
                    )}
                  >
                    <td style={M} className="px-3 py-2 text-[11px] text-muted-foreground">{i + 1}</td>
                    <td style={M} className="px-3 py-2 text-[12px] font-semibold">
                      {tier.minPax} – {tier.maxPax} orang
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {q.useAutoCalc ? (
                        <span style={M} className="text-[12px] font-bold text-orange-700 font-mono">
                          {fmtIDR(tier.pricePerPax)}
                        </span>
                      ) : (
                        <NumInput
                          value={tier.pricePerPax}
                          onChange={(v) => {
                            const next = [...q.tiers];
                            next[i] = { ...next[i], pricePerPax: v };
                            patch({ tiers: next });
                          }}
                        />
                      )}
                    </td>
                    <td style={M} className="px-3 py-2 text-[11px] text-right text-muted-foreground font-mono hidden sm:table-cell">
                      {q.basePricePerPax > 0 && tier.pricePerPax > 0
                        ? `+${Math.round((tier.pricePerPax / q.basePricePerPax - 1) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!q.useAutoCalc && (
            <p style={M} className="text-[10px] text-muted-foreground mt-2">
              Mode manual aktif — isi harga per pax langsung untuk setiap tier.
            </p>
          )}
        </div>
      </SectionCard>

      {/* ── Live Preview ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border-2 border-dashed border-orange-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-orange-50/70 border-b border-orange-200 flex items-center justify-between">
          <p style={M} className="text-[10px] font-extrabold uppercase tracking-wider text-orange-700 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Preview Penawaran
          </p>
          <p style={M} className="text-[10px] text-muted-foreground">Update langsung setiap form berubah</p>
        </div>
        <div className="p-4 md:p-5">
          <QuotationPreview q={q} computedTiers={computedTiers} />
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportPdf}
          disabled={exporting}
          style={M}
          className="rounded-xl border-orange-200 text-orange-700 hover:bg-orange-50 h-9 px-4"
        >
          <Download className="h-3.5 w-3.5 mr-1.5" />
          {exporting ? "Membuat PDF…" : "Export PDF"}
        </Button>
      </div>
    </div>
  );
}
