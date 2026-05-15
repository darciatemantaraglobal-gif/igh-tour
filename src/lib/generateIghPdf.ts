import { PDFDocument, PDFName, PDFString, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  DEFAULT_IGH_LAYOUT,
  FONT_FAMILY_URLS,
  mergeConfig,
  type IghFontFamily,
  type IghLayoutConfig,
  type IghSection,
  type IghTextAlign,
} from "./ighPdfConfig";
import {
  loadIghAdminSettings,
  formatWhatsappDisplay,
  whatsappDigits,
  whatsappUrl,
} from "./ighSettings";

export type { IghLayoutConfig } from "./ighPdfConfig";

/**
 * Generator PDF berbasis template `igh-blank-template.pdf`.
 *
 * Semua koordinat hidup di `ighPdfConfig.ts` dan bisa di-tune via PdfLayoutTuner.
 * Override teks per-section juga didukung (kalau diisi, menimpa data kalkulator).
 */

const TEMPLATE_URL = "/igh-blank-template.pdf";
const TEMPLATE_GROUP_URL = "/templates/IGH_Blank_Template_Group.pdf";

// Template canonical pixel size (matches the 150-DPI render of igh-template.pdf)
const TPL_W_PX = 740;
const PAGE_W = 413.9506;
const PAGE_H = 572.532;
const SCALE = PAGE_W / TPL_W_PX; // ≈ 0.5594

// Brand colors — Orange #F28E34 untuk semua data isian
const ORANGE: RGB = rgb(0xF2 / 255, 0x8E / 255, 0x34 / 255);
const GREY_MUTED: RGB = rgb(0.45, 0.45, 0.45);
const DARK: RGB = rgb(0.13, 0.13, 0.13);
const WHITE: RGB = rgb(1, 1, 1);
// WhatsApp brand green #25D366
const WA_GREEN: RGB = rgb(0x25 / 255, 0xD3 / 255, 0x66 / 255);

export interface IghGroupPricingRow {
  /** Label kolom Total Pax (mis. "10-15"). */
  paxLabel: string;
  /** Harga per-pax sudah dalam display currency (USD/SAR/IDR). 0/undefined = "—". */
  quad?: number;
  triple?: number;
  double?: number;
  /** Canonical IDR values per kamar — dipake kalau pdfCurrency != displayCurrency
   *  supaya konversi akurat ke target apapun. Optional utk back-compat. */
  quadIDR?: number;
  tripleIDR?: number;
  doubleIDR?: number;
}

export interface IghPdfData {
  projectName: string;
  /** Format lengkap (default render mode `Full`):
   *  "01 September 2026 - 09 September 2026 (9 hari)". */
  timeline: string;
  /** Format ringkas (render mode `Short`, default):
   *  "01 - 09 Sep 2026 (9 hari)" / "01 Sep - 03 Okt 2026 (33 hari)".
   *  Optional — kalau gak di-pass, generator fallback ke `timeline` apa adanya. */
  timelineShort?: string;
  customerName: string;
  date: string;
  hotelMakkah: string;
  makkahNights: number;
  hotelMadinah: string;
  madinahNights: number;
  pax: number;
  pricePerPaxIDR: number;
  kursIdrPerUsd?: number;
  /** IDR per 1 SAR — dipake utk konversi ke/dari SAR di PDF. */
  kursIdrPerSar?: number;
  included: string[];
  excluded: string[];
  /** Mode template. Default 'private' (template lama). */
  mode?: "private" | "group";
  /** Data tabel grup — dipakai cuma kalau mode='group'. */
  groupPricing?: IghGroupPricingRow[];
  /** Source currency dari nilai numeric `quad/triple/double` di groupPricing.
   *  Default "USD" (back-compat). Kalau `cfg.pdfCurrency` beda dari ini,
   *  generator otomatis konversi via IDR canonical / kurs. */
  displayCurrency?: "USD" | "IDR" | "SAR";
  /** Catatan tambahan yang ditulis di bawah baris disclaimer harga.
   *  Kosong/undefined = tidak ada teks tambahan. */
  pricingNote?: string;
}

// ── Coordinate helpers ─────────────────────────────────────────────────────

function pxRect(leftPx: number, topPx: number, widthPx: number, heightPx: number) {
  const x = leftPx * SCALE;
  const w = widthPx * SCALE;
  const h = heightPx * SCALE;
  const y = PAGE_H - topPx * SCALE - h;
  return { x, y, width: w, height: h };
}

function drawText(
  page: PDFPage,
  text: string,
  opts: {
    leftPx: number;
    topPx: number;
    size: number;
    minSize?: number;
    font: PDFFont;
    color: RGB;
    maxWidthPx?: number;
  },
) {
  let size = opts.size;
  const minSize = opts.minSize ?? Math.max(8, opts.size - 6);
  const maxW = opts.maxWidthPx ? opts.maxWidthPx * SCALE : Infinity;
  while (size > minSize && opts.font.widthOfTextAtSize(text, size) > maxW) size -= 0.5;
  const value =
    opts.font.widthOfTextAtSize(text, size) > maxW
      ? truncateToWidth(text, opts.font, size, maxW)
      : text;
  const x = opts.leftPx * SCALE;
  const y = PAGE_H - opts.topPx * SCALE - size * 0.78;
  page.drawText(value, { x, y, size, font: opts.font, color: opts.color });
}

/** Versi `drawText` yang sadar alignment. `anchorXPx` interpretasinya:
 *   - "left"   → batas kiri teks (sama dengan `drawText`)
 *   - "center" → titik tengah horizontal teks
 *   - "right"  → batas kanan teks
 *  Size udah di-resolve di luar (skip auto-shrink) supaya semua baris di
 *  multi-line block ukurannya konsisten. */
function drawTextAligned(
  page: PDFPage,
  text: string,
  opts: {
    anchorXPx: number;
    topPx: number;
    size: number;
    font: PDFFont;
    color: RGB;
    align: IghTextAlign;
    maxWidthPx?: number;
  },
) {
  const size = opts.size;
  const maxW = opts.maxWidthPx ? opts.maxWidthPx * SCALE : Infinity;
  const value =
    opts.font.widthOfTextAtSize(text, size) > maxW
      ? truncateToWidth(text, opts.font, size, maxW)
      : text;
  const textW = opts.font.widthOfTextAtSize(value, size);
  const anchorXPt = opts.anchorXPx * SCALE;
  let x: number;
  if (opts.align === "left") x = anchorXPt;
  else if (opts.align === "right") x = anchorXPt - textW;
  else x = anchorXPt - textW / 2;
  const y = PAGE_H - opts.topPx * SCALE - size * 0.78;
  page.drawText(value, { x, y, size, font: opts.font, color: opts.color });
}

function drawTextCentered(
  page: PDFPage,
  text: string,
  opts: {
    leftPx: number;
    topPx: number;
    widthPx: number;
    heightPx: number;
    size: number;
    minSize?: number;
    font: PDFFont;
    color: RGB;
    yOffsetPdf?: number;
  },
) {
  const r = pxRect(opts.leftPx, opts.topPx, opts.widthPx, opts.heightPx);
  const maxW = r.width - 16;
  const minSize = opts.minSize ?? 10;
  let size = opts.size;
  let textW = opts.font.widthOfTextAtSize(text, size);
  while (textW > maxW && size > minSize) {
    size -= 0.5;
    textW = opts.font.widthOfTextAtSize(text, size);
  }
  let value = text;
  if (textW > maxW) {
    value = truncateToWidth(text, opts.font, size, maxW);
    textW = opts.font.widthOfTextAtSize(value, size);
  }
  const cap = size * 0.70;
  const x = r.x + (r.width - textW) / 2;
  const yOff = opts.yOffsetPdf ?? 0;
  const y = r.y + (r.height - cap) / 2 + yOff;
  page.drawText(value, { x, y, size, font: opts.font, color: opts.color });
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid) + ellipsis, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ellipsis;
}

// ── Public API ─────────────────────────────────────────────────────────────

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal ambil ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── Cache template & font bytes di module scope ─────────────────────────────
// Asset ini static (di-serve dari /public) jadi aman di-cache selama umur tab.
// Tanpa cache, tiap regenerate PDF nge-fetch ulang ~150KB template + ~1MB font
// (3 weights × 1+ family). Worst case di Bulk OCR sesi panjang bisa puluhan MB
// transfer + parse cost yang sebenarnya redundant.
//
// Pakai promise-cache (bukan bytes-cache) supaya request paralel pertama kali
// gak ngirim 2 fetch buat URL yang sama (request coalescing).
const bytesCache = new Map<string, Promise<Uint8Array>>();
function fetchBytesCached(url: string): Promise<Uint8Array> {
  let p = bytesCache.get(url);
  if (!p) {
    p = fetchBytes(url).catch((e) => {
      // Hapus dari cache supaya retry berikutnya bisa fetch ulang.
      bytesCache.delete(url);
      throw e;
    });
    bytesCache.set(url, p);
  }
  return p;
}

/** Format IDR ringkas utk hemat ruang di tabel:
 *   - >= 1 miliar → "1,2 M"   (1 desimal koma, satuan Miliar)
 *   - >= 1 juta   → "30,5 jt" (1 desimal koma, satuan juta)
 *   - < 1 juta    → "Rp 500.000" (full format id-ID)
 *  Decimal ".0" di-trim supaya 30 jt (bukan "30,0 jt"). */
function fmtCompactIdr(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const trim = (s: string) => s.replace(/,0$/, "");
  if (n >= 1_000_000_000) {
    return `${trim((n / 1_000_000_000).toFixed(1).replace(".", ","))} M`;
  }
  if (n >= 1_000_000) {
    return `${trim((n / 1_000_000).toFixed(1).replace(".", ","))} jt`;
  }
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** Format IDR lengkap dengan ribuan titik: "Rp 30.123.456".
 *  Selalu prefix "Rp " + locale id-ID. Dipakai kalau user pilih
 *  priceDisplayMode === "full" di Layout Tuner. */
function fmtFullIdr(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** Format harga sesuai mata uang target & display mode. Style:
 *   - IDR + "compact" → "30,5 jt" / "1,2 M" / "Rp 500.000" (hemat kolom)
 *   - IDR + "full"    → "Rp 30.123.456" (nominal lengkap dengan titik ribuan)
 *   - SAR             → "SAR 3,500"          (en-US, no decimals)
 *   - USD             → "$1,776"             (en-US, no decimals)
 *  0/undefined/NaN → "—".
 *  `mode` cuma ngaruh ke IDR; USD/SAR selalu lengkap (ga pernah compact). */
function fmtCurrency(
  n: number | undefined,
  currency: "USD" | "IDR" | "SAR",
  mode: "full" | "compact" = "compact",
): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "—";
  if (currency === "IDR") return mode === "full" ? fmtFullIdr(n) : fmtCompactIdr(n);
  const rounded = Math.round(n);
  if (currency === "SAR") return `SAR ${rounded.toLocaleString("en-US")}`;
  return `$${rounded.toLocaleString("en-US")}`;
}

/** Convert antar currency lewat IDR canonical. `valueIDR` (kalau ada) dipakai
 *  duluan supaya akurat. Fallback: konversi dari `valueDisplay` di
 *  `sourceCur` → IDR → target.
 *  - kursUSD = IDR per 1 USD (mis. 16500)
 *  - kursSAR = IDR per 1 SAR (mis. 4400)
 *  Return value dalam target currency. */
function convertViaIdr(
  valueDisplay: number | undefined,
  valueIDR: number | undefined,
  sourceCur: "USD" | "IDR" | "SAR",
  targetCur: "USD" | "IDR" | "SAR",
  kursUSD = 1,
  kursSAR = 1,
): number | undefined {
  if (sourceCur === targetCur) return valueDisplay;
  // Resolve canonical IDR — prefer explicit IDR field kalau ada.
  let idr: number | undefined;
  if (typeof valueIDR === "number" && Number.isFinite(valueIDR) && valueIDR > 0) {
    idr = valueIDR;
  } else if (typeof valueDisplay === "number" && Number.isFinite(valueDisplay) && valueDisplay > 0) {
    if (sourceCur === "IDR") idr = valueDisplay;
    else if (sourceCur === "USD") idr = valueDisplay * (kursUSD || 1);
    else                         idr = valueDisplay * (kursSAR || 1);
  } else {
    return undefined;
  }
  if (targetCur === "IDR") return idr;
  if (targetCur === "USD") return idr / (kursUSD || 1);
  return idr / (kursSAR || 1);
}

/** Pilih nilai dari override teks vs data kalkulator. */
function pick(override: string | undefined, fallback: string): string {
  const v = (override ?? "").trim();
  return v.length > 0 ? override! : fallback;
}

export async function buildIghPdf(data: IghPdfData, layout?: Partial<IghLayoutConfig>): Promise<Uint8Array> {
  const cfg = mergeConfig(DEFAULT_IGH_LAYOUT, layout);
  const isGroup = data.mode === "group";
  // Format harga global utk semua call site fmtCurrency di file ini.
  // Default "compact" supaya preset/storage lama yg belum punya field ini
  // tetap render dengan satuan ringkas (jt/M) — backward compatible.
  const priceMode: "full" | "compact" = cfg.priceDisplayMode ?? "compact";
  const defaultTplUrl = isGroup ? TEMPLATE_GROUP_URL : TEMPLATE_URL;

  // Custom background template logic:
  //   - PDF custom → load file itu sebagai base PDF (sama treatment kayak default)
  //   - Image custom → bikin PDF baru ukuran A5 (PAGE_W × PAGE_H), embed image
  //     full-bleed sebagai background, lalu generator naro teks di atasnya
  //   - null/undefined → pakai template default IGH (`/igh-blank-template*.pdf`)
  // Failure di custom URL (404, network, parse error) → auto-fallback ke default
  // supaya generator gak crash kalo file di Storage hilang/corrupt.
  const customTpl = cfg.customTemplate;
  let pdf: PDFDocument;
  if (customTpl?.type === "pdf") {
    try {
      const bytes = await fetchBytes(customTpl.url);
      pdf = await PDFDocument.load(bytes);
    } catch (e) {
      console.warn("[pdf] custom template PDF gagal di-load, fallback ke default", e);
      pdf = await PDFDocument.load(await fetchBytesCached(defaultTplUrl));
    }
  } else if (customTpl?.type === "image") {
    pdf = await PDFDocument.create();
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    try {
      const bytes = await fetchBytes(customTpl.url);
      const isPng = /\.png(\?|$)/i.test(customTpl.url) || /image\/png/i.test(customTpl.name);
      const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      // Cover-fit: scale image biar nutup full page (mungkin crop sedikit) — sama
      // kayak background-size: cover di CSS. Jaga aspect ratio.
      const ir = img.width / img.height;
      const pr = PAGE_W / PAGE_H;
      let drawW: number, drawH: number;
      if (ir > pr) {
        drawH = PAGE_H;
        drawW = drawH * ir;
      } else {
        drawW = PAGE_W;
        drawH = drawW / ir;
      }
      page.drawImage(img, {
        x: (PAGE_W - drawW) / 2,
        y: (PAGE_H - drawH) / 2,
        width: drawW,
        height: drawH,
      });
    } catch (e) {
      console.warn("[pdf] custom template gambar gagal di-load, page kosong sebagai background", e);
    }
  } else {
    pdf = await PDFDocument.load(await fetchBytesCached(defaultTplUrl));
  }
  pdf.registerFontkit(fontkit);

  const usedFamilies = new Set<IghFontFamily>([cfg.fonts.family]);
  for (const fam of Object.values(cfg.fonts.overrides ?? {})) {
    if (fam) usedFamilies.add(fam);
  }
  const familyFonts: Record<string, { regular: PDFFont; semiBold: PDFFont; bold: PDFFont }> = {};
  await Promise.all(
    Array.from(usedFamilies).map(async (fam) => {
      const urls = FONT_FAMILY_URLS[fam];
      const [regBytes, sbBytes, boldBytes] = await Promise.all([
        fetchBytesCached(urls.regular),
        fetchBytesCached(urls.semiBold),
        fetchBytesCached(urls.bold),
      ]);
      familyFonts[fam] = {
        regular: await pdf.embedFont(regBytes, { subset: true }),
        semiBold: await pdf.embedFont(sbBytes, { subset: true }),
        bold: await pdf.embedFont(boldBytes, { subset: true }),
      };
    }),
  );

  void (await pdf.embedFont(StandardFonts.Helvetica));

  const fontFor = (section: IghSection, weight: "regular" | "semiBold" | "bold"): PDFFont => {
    const fam = cfg.fonts.overrides?.[section] ?? cfg.fonts.family;
    const set = familyFonts[fam] ?? familyFonts[cfg.fonts.family];
    return set[weight];
  };

  const page = pdf.getPage(0);

  // ── 1. PROJECT name + timeline ──
  // Mendukung manual line break (\n) DAN auto-wrap saat satu baris kepanjangan.
  // Step:
  //   1. Split text dgn `\n` → manual lines (preserve user intent).
  //   2. Per manual line, auto-wrap kalau lebar > projMaxW.
  //   3. Auto-shrink global size (turun 1pt) sampai total lines <= MAX_LINES.
  //   4. Render tiap line di Y = topPx + i * lineAdvance dgn alignment user.
  //   5. Subtitle (timeline tanggal) dihitung dari Y baris terakhir + gap →
  //      otomatis turun saat judul jadi 2-4 baris, gak nimpa hotel section.
  const projectName = pick(cfg.projectName.text, (data.projectName || "—").trim());
  const projMaxW = 285 * SCALE;
  const projBold = fontFor("projectName", "bold");
  const projReg = fontFor("projectName", "regular");
  const projAlign: IghTextAlign = cfg.projectName.align ?? "left";
  // 4 baris cukup untuk: "PT NAMA AGENCY" / "Umrah 9 Hari" / "VIP Plus" / "Mei 2026"
  // — kalau lebih dari ini, biasanya udah berbenturan dgn hotel section.
  const MAX_TITLE_LINES = 4;
  const manualSegments = projectName.split("\n");
  let projSize = cfg.projectName.size;
  let projLines: string[] = [];
  while (projSize > 14) {
    projLines = [];
    for (const seg of manualSegments) {
      // Empty manual line (user double-tap Enter) = preserved as blank gap.
      if (!seg.trim()) {
        projLines.push("");
        continue;
      }
      const wrapped = wrapAtSize(seg, projBold, projSize, projMaxW);
      projLines.push(...wrapped);
    }
    if (projLines.length <= MAX_TITLE_LINES) break;
    projSize -= 1;
  }
  if (projLines.length > MAX_TITLE_LINES) projLines = projLines.slice(0, MAX_TITLE_LINES);
  // Pakai lineGap absolut (px) supaya user bisa rapetin/longgarin tanpa tergantung font size.
  const projLH = projSize + cfg.projectName.lineGapPx;
  let py = cfg.projectName.topPx;
  for (const line of projLines) {
    // Skip drawText untuk baris kosong tapi tetep advance Y supaya gap visible.
    if (line) {
      drawTextAligned(page, line, {
        anchorXPx: cfg.projectName.xPx,
        topPx: py,
        size: projSize,
        font: projBold,
        color: ORANGE,
        align: projAlign,
        maxWidthPx: 285,
      });
    }
    py += projLH;
  }

  // Timeline (Periode) — "21 Mei 2026 - 29 Mei 2026 (9 hari)"
  // Y dihitung dinamis: end-of-title (py, sudah include semua baris title) +
  // mainHeaderGap + offset Y opsional. Jadi kalau title jadi 2-4 baris,
  // subtitle otomatis turun gak tumpang tindih.
  // X mengikuti alignment title supaya konsisten visual (left-aligned title
  // → subtitle juga left, dst).
  // Resolve order: mainHeaderGap (canonical) → headerSubtitleGap (deprecated,
  // preset lama) → 6 (hardcoded asli) supaya preset lama tetap render identik.
  const subtitleGap = cfg.mainHeaderGap ?? cfg.headerSubtitleGap ?? 6;
  const subtitleXOff = cfg.headerSubtitleOffset?.xPx ?? 0;
  const subtitleYOff = cfg.headerSubtitleOffset?.yPx ?? 0;
  // Lebar subtitle = config (default 285). Kalau timeline kepanjangan, di-wrap
  // ke baris berikutnya pakai wrapAtSize (greedy by space) sebelum di-truncate.
  // Sinkron dgn bbox di PdfInteractiveOverlay supaya Edit Mode tampilannya pas.
  // Font size & format tanggal sekarang config-driven (bukan hardcoded 11pt /
  // Full lagi) supaya bisa di-tune live dari PdfLayoutTuner.
  const SUBTITLE_PT = cfg.subtitleFontSize ?? 11;
  const subtitleWidthPx = cfg.subtitleWidthPx ?? 285;
  const subtitleMaxW = subtitleWidthPx * SCALE;
  const dateMode = cfg.dateDisplayMode ?? "Short";
  // Pilih sumber teks: Short pakai `timelineShort` kalau ada (Calculator
  // selalu provide), Full pakai `timeline` legacy. Fallback chain di-jaga
  // supaya legacy data (cuma `timeline`) tetap render walau mode "Short".
  const timelineText =
    (dateMode === "Short" ? (data.timelineShort || data.timeline) : data.timeline) || "—";
  const subtitleLines = wrapAtSize(timelineText, projReg, SUBTITLE_PT, subtitleMaxW);
  // Line advance untuk subtitle: ratio 1.25× size. Cocok dgn bbox heightPx
  // ratio TEXT_HEIGHT_RATIO (1.61) di overlay → bbox tetap nge-cover semua line.
  const subtitleLineAdvancePx = SUBTITLE_PT * 1.25;
  let subtitleY = py + subtitleGap + subtitleYOff;
  for (const line of subtitleLines) {
    drawTextAligned(page, line, {
      anchorXPx: cfg.projectName.xPx + subtitleXOff,
      topPx: subtitleY,
      size: SUBTITLE_PT,
      font: projReg,
      color: GREY_MUTED,
      align: projAlign,
      maxWidthPx: subtitleWidthPx,
    });
    subtitleY += subtitleLineAdvancePx;
  }

  // ── 2. HEADER META (Invoice to & Date) ──
  // Date dan Invoice punya Y independen (customerYPx / dateYPx). Kalau belum
  // di-set di preset (legacy), fallback ke `topPx` supaya tampilan lama gak
  // berubah.
  const metaReg = fontFor("metaInfo", "regular");
  const customerY = cfg.metaInfo.customerYPx ?? cfg.metaInfo.topPx;
  const dateY = cfg.metaInfo.dateYPx ?? cfg.metaInfo.topPx;
  drawText(page, pick(cfg.metaInfo.customerText, data.customerName || "—"), {
    leftPx: cfg.metaInfo.customerXPx, topPx: customerY, size: cfg.metaInfo.size,
    font: metaReg, color: ORANGE, maxWidthPx: 175,
  });
  drawText(page, pick(cfg.metaInfo.dateText, data.date || "—"), {
    leftPx: cfg.metaInfo.dateXPx, topPx: dateY, size: cfg.metaInfo.size,
    font: metaReg, color: ORANGE, maxWidthPx: 175,
  });

  // ── 3. HOTEL SECTION ──
  const hotelBold = fontFor("hotel", "bold");
  const hotelReg = fontFor("hotel", "regular");
  // Subtitle "X Malam" scaling proportional ke hotel.size dengan rasio 0.45,
  // clamp 7..14 agar tetap readable dan tidak overlap dengan elemen di bawahnya.
  const subtitleSize = Math.max(7, Math.min(14, cfg.hotel.size * 0.45));
  drawText(page, pick(cfg.hotel.makkahText, data.hotelMakkah || "—"), {
    leftPx: cfg.hotel.makkahXPx, topPx: cfg.hotel.topPx, size: cfg.hotel.size,
    minSize: 12, font: hotelBold, color: ORANGE, maxWidthPx: 285,
  });
  drawText(page, `${Math.max(0, data.makkahNights || 0)} Malam`, {
    leftPx: cfg.hotel.makkahXPx, topPx: cfg.hotel.topPx + cfg.hotel.subtitleOffsetPx, size: subtitleSize, font: hotelReg, color: DARK,
  });
  drawText(page, pick(cfg.hotel.madinahText, data.hotelMadinah || "—"), {
    leftPx: cfg.hotel.madinahXPx, topPx: cfg.hotel.topPx, size: cfg.hotel.size,
    minSize: 12, font: hotelBold, color: ORANGE, maxWidthPx: 285,
  });
  drawText(page, `${Math.max(0, data.madinahNights || 0)} Malam`, {
    leftPx: cfg.hotel.madinahXPx, topPx: cfg.hotel.topPx + cfg.hotel.subtitleOffsetPx, size: subtitleSize, font: hotelReg, color: DARK,
  });

  // ── 4. PRICING ──
  if (isGroup) {
    // Group template: tabel 4 kolom (Total Pax | Quad | Triple | Double),
    // multi-row stacked. Color ORANGE, true center horizontal & vertical.
    const gp = cfg.groupPricing;
    const groupBold = fontFor("groupPricing", "bold");
    const rows = data.groupPricing ?? [];
    // Resolve target currency: pdfCurrency (Tuner dropdown) menang.
    // Fallback: parse dari legacy currencySymbol field ("Rp"/"SAR"/"$").
    const targetCur: "USD" | "IDR" | "SAR" =
      cfg.pdfCurrency ??
      (gp.currencySymbol.trim().toLowerCase().startsWith("rp") ? "IDR"
        : gp.currencySymbol.trim().toUpperCase().startsWith("SAR") ? "SAR"
        : "USD");
    const sourceCur: "USD" | "IDR" | "SAR" = data.displayCurrency ?? "USD";
    const kursUSD = data.kursIdrPerUsd ?? 1;
    const kursSAR = data.kursIdrPerSar ?? 1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const topPx = gp.topPx + i * gp.rowSpacingPx;
      // Lebar kolom virtual buat truncation budget; cukup besar.
      const COL_W = 110;
      // Helper: render satu sel di X-center tertentu, true-center vertikal.
      const cell = (centerXPx: number, text: string) => {
        drawTextCentered(page, text, {
          leftPx: centerXPx - COL_W / 2,
          topPx,
          widthPx: COL_W,
          heightPx: gp.cellHeightPx,
          size: gp.size,
          minSize: 9,
          font: groupBold,
          color: ORANGE,
        });
      };
      const q = convertViaIdr(row.quad,   row.quadIDR,   sourceCur, targetCur, kursUSD, kursSAR);
      const t = convertViaIdr(row.triple, row.tripleIDR, sourceCur, targetCur, kursUSD, kursSAR);
      const d = convertViaIdr(row.double, row.doubleIDR, sourceCur, targetCur, kursUSD, kursSAR);
      cell(gp.paxCenterXPx, row.paxLabel || "—");
      cell(gp.quadCenterXPx + gp.quadXOffsetPx,   fmtCurrency(q, targetCur, priceMode));
      cell(gp.tripleCenterXPx + gp.tripleXOffsetPx, fmtCurrency(t, targetCur, priceMode));
      cell(gp.doubleCenterXPx + gp.doubleXOffsetPx, fmtCurrency(d, targetCur, priceMode));
    }
  } else {
    // Private template: 2 kotak orange (Pax + Harga per Pax).
    const priceBold = fontFor("pricing", "bold");
    const PAX_BOX = { leftPx: cfg.pricing.paxXPx, topPx: cfg.pricing.topPx, widthPx: 114, heightPx: 61 };
    const PRICE_BOX = { leftPx: cfg.pricing.priceXPx, topPx: cfg.pricing.topPx, widthPx: 406, heightPx: 61 };
    const paxText = pick(cfg.pricing.paxText, String(Math.max(0, data.pax || 0)));
    // Convert IDR price-per-pax → target PDF currency (USD/IDR/SAR).
    const targetCur = cfg.pdfCurrency ?? "IDR"; // legacy default for private = IDR
    const priceInTarget = convertViaIdr(
      undefined,
      data.pricePerPaxIDR || 0,
      "IDR",
      targetCur,
      data.kursIdrPerUsd ?? 1,
      data.kursIdrPerSar ?? 1,
    );
    const priceText = pick(
      cfg.pricing.priceText,
      fmtCurrency(targetCur === "IDR" ? (data.pricePerPaxIDR || 0) : priceInTarget, targetCur, priceMode),
    );
    drawTextCentered(page, paxText, {
      ...PAX_BOX, size: cfg.pricing.size + 4, minSize: 14, font: priceBold, color: WHITE,
      yOffsetPdf: cfg.pricing.yOffsetPdf,
    });
    drawTextCentered(page, priceText, {
      ...PRICE_BOX, size: cfg.pricing.size, minSize: 12, font: priceBold, color: WHITE,
      yOffsetPdf: cfg.pricing.yOffsetPdf,
    });
  }

  // ── 4b. PRICING NOTE (catatan tambahan di bawah disclaimer) ──
  if (data.pricingNote?.trim()) {
    const noteFont = fontFor("pricing", "regular");
    drawText(page, data.pricingNote.trim(), {
      leftPx: 47,
      topPx: 657,
      size: 7.5,
      font: noteFont,
      color: DARK,
      maxWidthPx: 646,
    });
  }

  // ── 5. CHECKLIST ──
  // ── 6. FOOTER (WhatsApp icon + clickable nomor admin) ──
  // Posisi WA dibaca dari `cfg.whatsappPosition` bila ada, biar bisa di-drag
  // mandiri lewat Edit Mode tanpa nyentuh field footer lainnya. Fallback ke
  // legacy `footer.topPx`/`waXPx` supaya preset lama tetap render persis sama.
  if (cfg.footer.showWhatsapp) {
    const admin = loadIghAdminSettings();
    const digits = whatsappDigits(admin.adminWhatsapp);
    if (digits.length >= 8) {
      const waYPx = cfg.whatsappPosition?.yPx ?? cfg.footer.topPx;
      const waXPx = cfg.whatsappPosition?.xPx ?? cfg.footer.waXPx;
      drawWhatsappFooter(page, pdf, {
        topPx: waYPx,
        leftXPx: waXPx,
        iconSizePt: cfg.footer.waIconSizePt,
        textSizePt: cfg.footer.size,
        font: fontFor("footer", "semiBold"),
        displayNumber: formatWhatsappDisplay(admin.adminWhatsapp),
        url: whatsappUrl(admin.adminWhatsapp),
      });
    }
  }

  const listFont = fontFor("checklist", "semiBold");
  const firstBaselinePxResolved = cfg.checklist.firstBaselinePx + cfg.checklist.yOffsetPx;
  // Izinkan hingga 10 item; batas nyata ditentukan oleh `footerCutoffPx` di bawah
  // sehingga tidak ada item yang overlap dengan footer, apapun mode-nya.
  const MAX_LIST_ROWS = 10;
  // Batas bawah (template-px) agar teks checklist tidak menembus area footer.
  // Margin 10px dari garis footer memberikan breathing room visual.
  const footerCutoffPx = cfg.footer.topPx - 10;
  const includedItems = splitOverrideOrUse(cfg.checklist.includedText, data.included);
  const excludedItems = splitOverrideOrUse(cfg.checklist.excludedText, data.excluded);
  const bulletSymbol = (cfg.checklist.listBullet ?? "•").trim();
  drawList(
    page, includedItems,
    firstBaselinePxResolved, cfg.checklist.rowSpacingPx, MAX_LIST_ROWS,
    cfg.checklist.leftXPx, listFont, cfg.checklist.size,
    cfg.checklist.sudahTermasukAlign ?? "center", bulletSymbol,
    footerCutoffPx,
  );
  drawList(
    page, excludedItems,
    firstBaselinePxResolved, cfg.checklist.rowSpacingPx, MAX_LIST_ROWS,
    cfg.checklist.rightXPx, listFont, cfg.checklist.size,
    cfg.checklist.belumTermasukAlign ?? "center", bulletSymbol,
    footerCutoffPx,
  );

  return pdf.save();
}


/**
 * Render WhatsApp icon + nomor admin di footer, dengan link annotation
 * yang membuka https://wa.me/{digits} saat di-klik di PDF reader.
 *
 * Layout: [green WA bubble icon] [4pt gap] [nomor +62 ...]
 * Position dihitung dari template-px coords (sejajar dengan IG handle yg
 * sudah pre-printed pada template).
 */
function drawWhatsappFooter(
  page: PDFPage,
  pdf: PDFDocument,
  opts: {
    topPx: number;
    leftXPx: number;
    iconSizePt: number;
    textSizePt: number;
    font: PDFFont;
    displayNumber: string;
    url: string;
  },
) {
  const baseX = opts.leftXPx * SCALE;
  // Konversi top-px → PDF baseline. IG di template baseline ~yMin=498pt
  // (pdftotext, top-down). Pakai konversi standar pxRect agar konsisten
  // dengan elemen lain.
  const baseY = PAGE_H - opts.topPx * SCALE;
  const r = opts.iconSizePt / 2;
  const cx = baseX + r;
  const cy = baseY + r * 0.4; // sedikit naik supaya optical-center sejajar teks

  // 1) Bubble hijau WhatsApp (lingkaran filled).
  page.drawCircle({ x: cx, y: cy, size: r, color: WA_GREEN, borderWidth: 0 });

  // 2) Phone receiver (white SVG path) — minimalis, terbaca jelas pada r=4.5.
  // Path origin pada (0,0); di-translate via x/y dan di-scale ke r.
  // Bentuk: gagang telepon klasik (atas-kiri ke bawah-kanan).
  const phonePath =
    "M 1.05 1.95 c 0.30 0.40 0.78 0.92 1.45 1.55 c 0.67 0.63 1.20 1.05 1.55 1.30 " +
    "c 0.20 0.14 0.40 0.10 0.58 -0.05 l 0.50 -0.50 c 0.20 -0.20 0.45 -0.22 0.70 -0.10 " +
    "l 1.45 0.75 c 0.25 0.13 0.30 0.40 0.15 0.65 c -0.40 0.65 -1.00 1.10 -1.85 1.20 " +
    "c -0.85 0.10 -1.95 -0.20 -3.05 -0.95 c -1.10 -0.75 -2.10 -1.85 -2.85 -3.05 " +
    "c -0.75 -1.10 -1.05 -2.20 -0.95 -3.05 c 0.10 -0.85 0.55 -1.45 1.20 -1.85 " +
    "c 0.25 -0.15 0.52 -0.10 0.65 0.15 l 0.75 1.45 c 0.12 0.25 0.10 0.50 -0.10 0.70 " +
    "l -0.50 0.50 c -0.15 0.18 -0.19 0.38 -0.05 0.58 z";
  // Skala: path digambar di kotak ~7x7 unit. Mau ngepas dalam diameter 2r,
  // tapi visually ~70% diameter biar ada padding hijau di sekitar gagang.
  const pathScale = (2 * r * 0.55) / 7;
  // Center the 7x7 glyph in the bubble (origin top-left in SVG; pdf-lib
  // drawSvgPath flips Y for us — the path coords above use SVG convention).
  const svgX = cx - 3.5 * pathScale;
  const svgY = cy + 3.5 * pathScale;
  page.drawSvgPath(phonePath, {
    x: svgX,
    y: svgY,
    scale: pathScale,
    color: WHITE,
    borderWidth: 0,
  });

  // 3) Nomor WA di kanan icon.
  const gap = 4;
  const textX = cx + r + gap;
  // Vertical center text relative to icon — gunakan cap-height approx 0.7 size.
  const textY = cy - opts.textSizePt * 0.32;
  page.drawText(opts.displayNumber, {
    x: textX,
    y: textY,
    size: opts.textSizePt,
    font: opts.font,
    color: DARK,
  });

  // 4) Clickable link annotation menutupi seluruh icon + teks.
  const textWidth = opts.font.widthOfTextAtSize(opts.displayNumber, opts.textSizePt);
  const annotX1 = baseX;
  const annotY1 = cy - r - 1;
  const annotX2 = textX + textWidth + 1;
  const annotY2 = cy + r + 1;
  const linkAnnot = pdf.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [annotX1, annotY1, annotX2, annotY2],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "URI",
      URI: PDFString.of(opts.url),
    },
  });
  const linkRef = pdf.context.register(linkAnnot);
  // Append ke Annots array existing (atau bikin baru).
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing && "push" in (existing as object)) {
    // PDFArray — pdf-lib exposes .push for arrays.
    (existing as { push: (x: unknown) => void }).push(linkRef);
  } else {
    page.node.set(PDFName.of("Annots"), pdf.context.obj([linkRef]));
  }
}

function splitOverrideOrUse(override: string | undefined, fallback: string[]): string[] {
  const v = (override ?? "").trim();
  if (!v) return fallback;
  return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** Draw checklist column dengan teks horizontal. `anchorXPx` = titik X di
 *  template-px; arti titik tergantung `align`:
 *    - "center" → titik tengah teks (lebar dihitung lalu dibagi 2)
 *    - "left"   → koordinat awal teks (left edge)
 *    - "right"  → batas akhir teks (right edge)
 *
 *  `bullet` (optional, default "•") di-prepend di depan baris pertama dgn 1
 *  space separator. String kosong = no bullet (back-compat).
 *
 *  ── MULTI-LINE WRAP DGN HANGING INDENT ──
 *  Tiap item kalo kepanjangan di-wrap ke beberapa baris (`wrapAtSize`).
 *  Bullet cuma muncul di baris pertama; baris lanjutan di-indent supaya start
 *  sejajar dgn awal teks (di-bawah teks, bukan di bawah bullet) — gaya
 *  "hanging indent" yg standar di list typography. Ini ngegantiin truncate
 *  pakai "..." (perilaku lama) karena info penting (mis. nama hotel lengkap)
 *  sebelumnya kepotong.
 *
 *  ── DYNAMIC ROW HEIGHT ──
 *  Item 1 di start `firstBaselinePx`. Item berikutnya di-stack ke bawah:
 *  baseline-nya = baseline item sebelumnya + (wrappedLines × lineAdvance)
 *  + extraGap (= rowSpacingPx - lineAdvance, biar gap antar-item tetap konsisten
 *  walau item multi-line). Ini bikin item bawah otomatis turun gak overlap
 *  walau item atas wrap ke 2-3 baris.
 *
 *  ── ALIGN BEHAVIOR DGN MULTI-LINE ──
 *  Untuk align "center"/"right", lebar block dihitung dari baris terpanjang +
 *  prefix → block di-position relatif ke anchor. Bullet & semua continuation
 *  lines pakai X yg sama (left edge of block + prefixW utk continuation),
 *  jadi visual rapi: bullet di kiri, teks rata kiri di sebelah bullet.
 */
function drawList(
  page: PDFPage,
  items: string[],
  firstBaselinePx: number,
  rowSpacingPx: number,
  maxRows: number,
  anchorXPx: number,
  font: PDFFont,
  baseSize = 10,
  align: "left" | "center" | "right" = "center",
  bullet = "•",
  /** Batas bawah (template-px). Baris yang baseline-nya ≥ nilai ini tidak
   *  di-render supaya tidak overlap dengan footer template. */
  maxBaselinePx?: number,
) {
  const cleaned = items.map((s) => s.trim()).filter(Boolean).slice(0, maxRows);
  // Width budget per row ~ 235px (kolom asli template). Padding 8px disisain
  // utk breathing room dari border template.
  const COL_WIDTH = 235;
  const maxW = (COL_WIDTH - 8) * SCALE;
  const anchorXPt = anchorXPx * SCALE;
  const prefix = bullet ? `${bullet} ` : "";
  // User control via slider — gak auto-shrink lagi krn user bisa atur sendiri
  // ukuran font (range 7..12). Auto-shrink lama bikin item pertama besar dan
  // item terakhir kecil — inkonsisten visual.
  const size = baseSize;
  const prefixW = font.widthOfTextAtSize(prefix, size);
  // Line advance dlm template-px: konversi dari pt (size*1.25) lewat SCALE.
  // SCALE = pt/template-px → template-px = pt / SCALE.
  const lineAdvancePx = (size * 1.25) / SCALE;
  // Default rowSpacingPx (mis. 28px) menampung ±1 baris (size 10pt → ~22px).
  // Kalau item multi-line, kita hitung extra-gap supaya jarak antar item
  // (= rowSpacingPx - 1 lineAdvance) konsisten regardless dari berapa baris
  // item sebelumnya.
  const interItemGapPx = Math.max(rowSpacingPx - lineAdvancePx, lineAdvancePx * 0.4);

  let cursorBaselinePx = firstBaselinePx;
  for (let i = 0; i < cleaned.length; i++) {
    // Wrap body dlm budget (maxW - prefixW) supaya continuation line gak
    // ngelewatin border kolom kanan. Kalo 1 word aja udah > budget,
    // wrapAtSize tetep return [original] (no infinite loop).
    const bodyMaxW = Math.max(0, maxW - prefixW);
    const wrappedBody = wrapAtSize(cleaned[i], font, size, bodyMaxW);

    // Lebar block = prefix + baris terpanjang. Dipakai utk alignment
    // center/right (block di-treat sbg unit visual).
    const longestLineW = wrappedBody.reduce(
      (mx, ln) => Math.max(mx, font.widthOfTextAtSize(ln, size)),
      0,
    );
    const blockW = prefixW + longestLineW;
    let blockLeftPt: number;
    if (align === "left")        blockLeftPt = anchorXPt;
    else if (align === "right")  blockLeftPt = anchorXPt - blockW;
    else                          blockLeftPt = anchorXPt - blockW / 2;
    const textXPt = blockLeftPt + prefixW;

    for (let li = 0; li < wrappedBody.length; li++) {
      // Hentikan rendering kalau baseline sudah melewati batas footer.
      if (maxBaselinePx !== undefined && cursorBaselinePx >= maxBaselinePx) return;
      const y = PAGE_H - cursorBaselinePx * SCALE;
      if (li === 0 && prefix) {
        // Baris pertama: bullet + teks. Render terpisah supaya bullet stay
        // di kiri (block edge) dan teks start di textXPt — exact alignment
        // dgn continuation lines berikut.
        page.drawText(prefix, { x: blockLeftPt, y, size, font, color: DARK });
        page.drawText(wrappedBody[li], { x: textXPt, y, size, font, color: DARK });
      } else {
        // Continuation (atau no-bullet case): teks aja, di textXPt.
        page.drawText(wrappedBody[li], { x: textXPt, y, size, font, color: DARK });
      }
      cursorBaselinePx += lineAdvancePx;
    }
    // After last line of this item, ganti lineAdvancePx (already added) dgn
    // interItemGapPx supaya jarak antar item konsisten. Kalau item ini cuma
    // 1 baris → cursor maju 1 lineAdvance + interItemGap = ~rowSpacingPx
    // (preserve perilaku lama). Kalau multi-line → cursor maju N baris +
    // gap konsisten.
    cursorBaselinePx += interItemGapPx - lineAdvancePx;
  }
}

function wrapAtSize(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

export async function downloadIghPdf(
  data: IghPdfData,
  fileName?: string,
  layout?: Partial<IghLayoutConfig>,
): Promise<void> {
  const bytes = await buildIghPdf(data, layout);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = (data.projectName || "IGH-Penawaran").replace(/[^a-z0-9-_]+/gi, "_");
  a.download = fileName || `${safe}_${(data.customerName || "Customer").replace(/[^a-z0-9-_]+/gi, "_")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function renderIghPdfPreview(
  data: IghPdfData,
  scale = 1.5,
  layout?: Partial<IghLayoutConfig>,
): Promise<string> {
  const bytes = await buildIghPdf(data, layout);
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas.toDataURL("image/png");
}
