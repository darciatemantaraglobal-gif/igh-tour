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
// Varian layout 2-halaman: template halaman 1 TANPA kotak Sudah/Belum Termasuk
// (ruangnya dipakai catatan), + template halaman rincian (logo + footer saja).
const TEMPLATE_PRIVATE_NOLIST_URL = "/templates/IGH_Blank_Private_NoList.pdf";
const TEMPLATE_GROUP_NOLIST_URL = "/templates/IGH_Blank_Group_NoList.pdf";
const TEMPLATE_DETAIL_URL = "/templates/IGH_Blank_Detail.pdf";

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
  /** Label header kustom untuk Hotel 1 (mis. "HOTEL KAIRO" / "HOTEL 1") */
  hotelMakkahHeader?: string;
  hotelMadinah: string;
  madinahNights: number;
  /** Label header kustom untuk Hotel 2 (mis. "HOTEL ALEXANDRIA" / "HOTEL 2") */
  hotelMadinahHeader?: string;
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
  /** Layout 2 halaman (default true): halaman 1 = harga + catatan, halaman 2 =
   *  daftar Sudah/Belum Termasuk. false = layout lama (daftar di halaman 1).
   *  Diabaikan kalau user pakai custom template. */
  listsOnPage2?: boolean;
  /** Poin tambahan di halaman 1, di bawah disclaimer harga (layout 2 halaman). */
  topNotes?: string[];
  /** Poin tambahan di halaman 2, di bawah daftar Sudah/Belum Termasuk. */
  bottomNotes?: string[];
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

/** Area disclaimer statis "* Harga sewaktu-waktu…" di template private (pt,
 *  top-down dari tepi atas page). */
const STATIC_DISCLAIMER_PT = { left: 26, right: 388, top: 333, bottom: 347 };
/** Kotak oranye Pax & Harga di template private (pt, top-down). */
const PRIVATE_PAX_BOX_PT = { left: 26.0, top: 289.8, right: 90.6, bottom: 325.3 };
const PRIVATE_PRICE_BOX_PT = { left: 152.3, top: 289.8, right: 380.4, bottom: 325.3 };

/** Baris bernomor 01–05 di bawah pill Sudah/Belum Termasuk (pt, top-down).
 *  `centersPt` = titik tengah vertikal tiap nomor; `left`/`right` = x awal
 *  teks (sesudah nomor) & batas kanan garis tiap kolom. */
type ListRows = { centersPt: number[]; left: { x: number; maxX: number }; right: { x: number; maxX: number } };
const PRIVATE_LIST_ROWS: ListRows = {
  centersPt: [404.4, 419.8, 435.9, 450.6, 465.3],
  left: { x: 50, maxX: 183 },
  right: { x: 254, maxX: 386.5 },
};
const GROUP_LIST_ROWS: ListRows = {
  centersPt: [420.0, 432.7, 445.85, 457.9, 470.0],
  left: { x: 46, maxX: 193.5 },
  right: { x: 240, maxX: 387.5 },
};

/** Satu item per baris template, rata kiri sesudah nomor, di tengah vertikal
 *  baris (gak nempel garis). Item kepanjangan dipotong "…". */
function drawTemplateRows(
  page: PDFPage,
  items: string[],
  centersPt: number[],
  col: { x: number; maxX: number },
  font: PDFFont,
  size: number,
) {
  const cleaned = items.map((s) => s.trim()).filter(Boolean).slice(0, centersPt.length);
  cleaned.forEach((item, i) => {
    const text = truncateToWidth(item, font, size, col.maxX - col.x);
    // Baseline = tengah baris + setengah tinggi huruf (cap ≈ 0.7em).
    const y = PAGE_H - (centersPt[i] + size * 0.42);
    page.drawText(text, { x: col.x, y, size, font, color: DARK });
  });
}

/** Garis pemisah di bawah judul/tanggal pada template private (pt, top-down). */
const TITLE_DIVIDER_PT = 195.6;
/** Baseline teks instagram/email di footer template (pt, top-down). */
const FOOTER_TEXT_BASELINE_PT = 503.66;
/** Garis horizontal di atas footer template (pt, top-down). */
const FOOTER_RULE_PT = 486;

/** Catatan multi-baris: wrap ke `maxWidthPx`, kecilkan font sampai muat di
 *  `bottomPt`, baris yg tetap gak muat dipotong "…". Kalau blok teks numpuk
 *  dgn `maskBefore`, area itu ditutup putih dulu. Return posisi bawah (pt). */
function drawWrappedNote(
  page: PDFPage,
  text: string,
  opts: {
    anchorXPx: number;
    topPx: number;
    size: number;
    minSize: number;
    bottomPt: number;
    font: PDFFont;
    color: RGB;
    align: IghTextAlign;
    maxWidthPx?: number;
    maskBefore?: { left: number; right: number; top: number; bottom: number };
  },
): number {
  const maxW = opts.maxWidthPx ? opts.maxWidthPx * SCALE : PAGE_W;
  const topPt = opts.topPx * SCALE;
  const fit = (size: number) => {
    const lines = text.split(/\r?\n/).flatMap((para) => wrapAtSize(para, opts.font, size, maxW));
    return { size, lines, lineH: size * 1.25 };
  };
  let r = fit(opts.size);
  while (r.size > opts.minSize && topPt + r.lines.length * r.lineH > opts.bottomPt) {
    r = fit(Math.max(opts.minSize, r.size - 0.25));
  }
  const maxLines = Math.max(1, Math.floor((opts.bottomPt - topPt) / r.lineH));
  let lines = r.lines;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = truncateToWidth(`${lines[maxLines - 1]} ${r.lines.slice(maxLines).join(" ")}`, opts.font, r.size, maxW);
  }
  const bottomPt = topPt + lines.length * r.lineH;

  const m = opts.maskBefore;
  if (m && topPt < m.bottom && bottomPt > m.top) {
    page.drawRectangle({
      x: m.left, y: PAGE_H - m.bottom, width: m.right - m.left, height: m.bottom - m.top,
      color: WHITE, borderWidth: 0,
    });
  }

  const anchorXPt = opts.anchorXPx * SCALE;
  lines.forEach((ln, i) => {
    const w = opts.font.widthOfTextAtSize(ln, r.size);
    const x = opts.align === "left" ? anchorXPt : opts.align === "right" ? anchorXPt - w : anchorXPt - w / 2;
    const y = PAGE_H - topPt - i * r.lineH - r.size * 0.78;
    page.drawText(ln, { x, y, size: r.size, font: opts.font, color: opts.color });
  });
  return bottomPt;
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
  // Layout 2 halaman cuma utk template bawaan; custom template punya area daftar
  // sendiri jadi tetap pakai alur lama (daftar di halaman 1).
  const twoPage = !cfg.customTemplate && data.listsOnPage2 !== false;
  const defaultTplUrl = isGroup
    ? (twoPage ? TEMPLATE_GROUP_NOLIST_URL : TEMPLATE_GROUP_URL)
    : (twoPage ? TEMPLATE_PRIVATE_NOLIST_URL : TEMPLATE_URL);

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
  // Private: judul sebaris dgn kolom "Invoice to" → jangan sampai mepet/nabrak.
  const projMaxWPx = isGroup ? 285 : Math.min(285, cfg.metaInfo.customerXPx - cfg.projectName.xPx - 16);
  const projMaxW = projMaxWPx * SCALE;
  const projBold = fontFor("projectName", "bold");
  const projReg = fontFor("projectName", "regular");
  const projAlign: IghTextAlign = cfg.projectName.align ?? "left";
  // 4 baris cukup untuk: "PT NAMA AGENCY" / "Umrah 9 Hari" / "VIP Plus" / "Mei 2026"
  // — kalau lebih dari ini, biasanya udah berbenturan dgn hotel section.
  const MAX_TITLE_LINES = 4;
  const manualSegments = projectName.split("\n");
  // Jarak antar baris dlm template-px: tinggi font (pt → px) + lineGapPx.
  // Sebelumnya `size + lineGapPx` (pt dicampur px) → baris judul saling dempet.
  const titleLineAdvancePx = (size: number) => (size * 1.05) / SCALE + cfg.projectName.lineGapPx;
  // Template private bawaan: judul + tanggal harus selesai di atas garis
  // pemisah (y≈195pt), kalau nggak nabrak label "Hotel Makkah".
  const titleBottomPx = !isGroup && !cfg.customTemplate ? TITLE_DIVIDER_PT / SCALE - 6 : Infinity;
  const titleSubtitleGapPx = cfg.mainHeaderGap ?? cfg.headerSubtitleGap ?? 6;
  const titleSubtitleH = ((cfg.subtitleFontSize ?? 11) * 1.25) / SCALE;
  let projSize = cfg.projectName.size;
  let projLines: string[] = [];
  const MIN_TITLE_PT = 13;
  for (;;) {
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
    const blockH = projLines.length * titleLineAdvancePx(projSize) + titleSubtitleGapPx + titleSubtitleH;
    if (projLines.length <= MAX_TITLE_LINES && cfg.projectName.topPx + blockH <= titleBottomPx) break;
    if (projSize <= MIN_TITLE_PT) break;
    projSize = Math.max(MIN_TITLE_PT, projSize - 0.5);
  }
  // Masih gak muat di ukuran minimum → batasi jumlah baris, sisa dipotong "…".
  const roomPx = titleBottomPx - cfg.projectName.topPx - titleSubtitleGapPx - titleSubtitleH;
  const maxTitleLines = Math.max(1, Math.min(MAX_TITLE_LINES, Math.floor(roomPx / titleLineAdvancePx(projSize))));
  if (projLines.length > maxTitleLines) {
    const rest = projLines.slice(maxTitleLines - 1).join(" ");
    projLines = [...projLines.slice(0, maxTitleLines - 1), truncateToWidth(rest, projBold, projSize, projMaxW)];
  }
  // Pakai lineGap absolut (px) supaya user bisa rapetin/longgarin tanpa tergantung font size.
  const projLH = titleLineAdvancePx(projSize);
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
        maxWidthPx: projMaxWPx,
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
  const subtitleSize = Math.max(8, Math.min(14, cfg.hotel.size * 0.45));
  // Lebar kolom dihitung dari posisi config supaya auto-shrink tidak cap font
  // size di nilai rendah untuk nama hotel yang panjang (bug: slider font size
  // seolah tidak berpengaruh ke Hotel Madinah kalau namanya panjang).
  const TPL_W_PX = 740;
  const RIGHT_MARGIN_PX = 47;
  const COLUMN_GAP_PX = 30;
  const makkahColWidthPx = cfg.hotel.madinahXPx - cfg.hotel.makkahXPx - COLUMN_GAP_PX;
  const madinahColWidthPx = TPL_W_PX - cfg.hotel.madinahXPx - RIGHT_MARGIN_PX;
  const makkahHotelText = pick(cfg.hotel.makkahText, data.hotelMakkah);
  const madinahHotelText = pick(cfg.hotel.madinahText, data.hotelMadinah);

  const makkahHeader = cfg.hotel.makkahHeader || data.hotelMakkahHeader;
  const madinahHeader = cfg.hotel.madinahHeader || data.hotelMadinahHeader;

  // Custom header Hotel 1
  if (makkahHeader && makkahHeader.toUpperCase() !== "HOTEL MAKKAH") {
    const rect = pxRect(cfg.hotel.makkahXPx - 2, cfg.hotel.topPx - 24, 180, 18);
    page.drawRectangle({ ...rect, color: WHITE });
    drawText(page, makkahHeader.toUpperCase(), {
      leftPx: cfg.hotel.makkahXPx, topPx: cfg.hotel.topPx - 23, size: 8.5,
      font: hotelBold, color: GREY_MUTED, maxWidthPx: makkahColWidthPx,
    });
  }

  // Custom header Hotel 2 (atau cover jika kosong)
  if (madinahHeader && madinahHeader.toUpperCase() !== "HOTEL MADINAH") {
    const rect = pxRect(cfg.hotel.madinahXPx - 2, cfg.hotel.topPx - 24, 180, 18);
    page.drawRectangle({ ...rect, color: WHITE });
    if (madinahHotelText && madinahHotelText !== "—") {
      drawText(page, madinahHeader.toUpperCase(), {
        leftPx: cfg.hotel.madinahXPx, topPx: cfg.hotel.topPx - 23, size: 8.5,
        font: hotelBold, color: GREY_MUTED, maxWidthPx: madinahColWidthPx,
      });
    }
  } else if (!madinahHotelText || madinahHotelText === "—") {
    const rect = pxRect(cfg.hotel.madinahXPx - 2, cfg.hotel.topPx - 24, 180, 18);
    page.drawRectangle({ ...rect, color: WHITE });
  }

  if (makkahHotelText && makkahHotelText !== "—") {
    drawText(page, makkahHotelText, {
      leftPx: cfg.hotel.makkahXPx, topPx: cfg.hotel.topPx, size: cfg.hotel.size,
      font: hotelBold, color: ORANGE, maxWidthPx: makkahColWidthPx,
    });
    if ((data.makkahNights || 0) > 0) {
      drawText(page, `${data.makkahNights} Malam`, {
        leftPx: cfg.hotel.makkahXPx, topPx: cfg.hotel.topPx + cfg.hotel.subtitleOffsetPx, size: subtitleSize, font: hotelReg, color: DARK,
      });
    }
  }

  if (madinahHotelText && madinahHotelText !== "—") {
    drawText(page, madinahHotelText, {
      leftPx: cfg.hotel.madinahXPx, topPx: cfg.hotel.topPx, size: cfg.hotel.size,
      font: hotelBold, color: ORANGE, maxWidthPx: madinahColWidthPx,
    });
    if ((data.madinahNights || 0) > 0) {
      drawText(page, `${data.madinahNights} Malam`, {
        leftPx: cfg.hotel.madinahXPx, topPx: cfg.hotel.topPx + cfg.hotel.subtitleOffsetPx, size: subtitleSize, font: hotelReg, color: DARK,
      });
    }
  }

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
    // Template bawaan: pakai geometri kotak oranye yg persis (diukur dari PDF
    // template) + tanpa yOffset, supaya angka benar-benar di tengah kotak.
    // Custom template tetap ikut posisi dari Tuner.
    const builtinBox = !cfg.customTemplate;
    const boxPx = (b: { left: number; top: number; right: number; bottom: number }) => ({
      leftPx: b.left / SCALE, topPx: b.top / SCALE, widthPx: (b.right - b.left) / SCALE, heightPx: (b.bottom - b.top) / SCALE,
    });
    const PAX_BOX = builtinBox
      ? boxPx(PRIVATE_PAX_BOX_PT)
      : { leftPx: cfg.pricing.paxXPx, topPx: cfg.pricing.topPx, widthPx: 114, heightPx: 61 };
    const PRICE_BOX = builtinBox
      ? boxPx(PRIVATE_PRICE_BOX_PT)
      : { leftPx: cfg.pricing.priceXPx, topPx: cfg.pricing.topPx, widthPx: 406, heightPx: 61 };
    const priceYOffset = builtinBox ? 0 : cfg.pricing.yOffsetPdf;
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
      yOffsetPdf: priceYOffset,
    });
    drawTextCentered(page, priceText, {
      ...PRICE_BOX, size: cfg.pricing.size, minSize: 12, font: priceBold, color: WHITE,
      yOffsetPdf: priceYOffset,
    });
  }

  // ── 4b. PRICING NOTE (catatan / T&C di bawah harga) ──
  // Teks di-wrap multi-baris (bukan dipotong "…"). Kalau posisinya numpuk
  // dgn disclaimer statis template ("* Harga sewaktu-waktu…"), disclaimer itu
  // ditutup supaya catatan user menggantikannya, bukan saling timpa.
  let noteBottomPt = 0;
  if (data.pricingNote?.trim()) {
    const pNote = cfg.pricingNote ?? { xPx: 53, topPx: 632, size: 7.5, align: "left", maxWidthPx: 646 };
    const noteFont = fontFor(cfg.fonts.overrides?.pricingNote ? "pricingNote" : "pricing", "regular");
    // Batas bawah: pill "Sudah/Belum Termasuk" (layout lama) atau maksimal 4 baris.
    const pillTopPt = twoPage ? Infinity : isGroup ? 390 : 369;
    // Layout lama private: posisi lama (657px ≈ 367pt) mepet pill dan gak
    // ada ruang buat wrap → pakai slot disclaimer statis (ditutup di bawah).
    let noteTopPt = pNote.topPx * SCALE;
    if (!twoPage && !isGroup && noteTopPt > STATIC_DISCLAIMER_PT.bottom - 2 && noteTopPt < pillTopPt + 20) {
      noteTopPt = STATIC_DISCLAIMER_PT.top + 2.5;
    }
    const bottomLimitPt = noteTopPt < pillTopPt - 4
      ? Math.min(pillTopPt - 2, noteTopPt + pNote.size * 1.25 * 4)
      : noteTopPt + pNote.size * 1.25 * 4;
    const noteBottom = drawWrappedNote(page, data.pricingNote.trim(), {
      anchorXPx: pNote.xPx,
      topPx: noteTopPt / SCALE,
      size: pNote.size,
      minSize: 6,
      bottomPt: bottomLimitPt,
      font: noteFont,
      color: DARK,
      align: pNote.align ?? "left",
      maxWidthPx: pNote.maxWidthPx ?? 646,
      maskBefore: isGroup ? undefined : STATIC_DISCLAIMER_PT,
    });
    noteBottomPt = noteBottom;
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
        alignToTemplate: cfg.customTemplate ? undefined : { baselineTopPt: FOOTER_TEXT_BASELINE_PT, centerXPt: PAGE_W / 2 },
      });
    }
  }

  const listFont = fontFor("checklist", "semiBold");
  const includedItems = splitOverrideOrUse(cfg.checklist.includedText, data.included);
  const excludedItems = splitOverrideOrUse(cfg.checklist.excludedText, data.excluded);
  const topNotes = (data.topNotes ?? []).map((x) => x.trim()).filter(Boolean);
  const bottomNotes = (data.bottomNotes ?? []).map((x) => x.trim()).filter(Boolean);

  if (twoPage) {
    // ── LAYOUT 2 HALAMAN ──
    // Halaman 1: ruang bekas kotak Sudah/Belum Termasuk dipakai poin tambahan.
    // Halaman 2: daftar lengkap + poin tambahan bawah.
    if (topNotes.length > 0) {
      drawBulletBlock(page, topNotes, {
        x: 29.5,
        topPt: Math.max(!isGroup && !data.pricingNote?.trim() ? 366 : 392, noteBottomPt + 8),
        bottomPt: 478,
        maxW: PAGE_W - 58,
        size: 8.5,
        font: fontFor("checklist", "regular"),
      });
    }
    if (includedItems.length > 0 || excludedItems.length > 0 || bottomNotes.length > 0) {
      await appendDetailPages(pdf, {
        included: includedItems,
        excluded: excludedItems,
        notes: bottomNotes,
        projectName,
        timeline: data.timelineShort || data.timeline || "",
        regular: fontFor("checklist", "regular"),
        semiBold: fontFor("checklist", "semiBold"),
        bold: fontFor("checklist", "bold"),
        useTemplate: true,
      });
    }
    return pdf.save();
  }

  // ── LAYOUT LAMA: daftar di halaman 1 ──
  const firstBaselinePxResolved = cfg.checklist.firstBaselinePx + cfg.checklist.yOffsetPx;
  // Izinkan hingga 10 item; batas nyata ditentukan oleh `footerCutoffPx` di bawah
  // sehingga tidak ada item yang overlap dengan footer, apapun mode-nya.
  const MAX_LIST_ROWS = 10;
  // Batas bawah (template-px) agar teks checklist tidak menembus garis footer
  // template (y≈486pt) maupun baris WA/instagram di bawahnya.
  const footerCutoffPx = Math.min(cfg.footer.topPx - 10, FOOTER_RULE_PT / SCALE - 8);
  const bulletSymbol = (cfg.checklist.listBullet ?? "•").trim();

  // Kalau list kepanjangan, halaman 1 cuma jadi RINGKASAN (muat di 5 baris
  // template, tiap item 1 baris) dan daftar lengkapnya pindah ke halaman
  // rincian. Tanpa ini, item ke-6 dst numpuk & saling timpa di halaman 1.
  const needsDetailPage = Math.max(includedItems.length, excludedItems.length) > DETAIL_PAGE_THRESHOLD;
  const summarize = (items: string[]): string[] => {
    const cleaned = items.map((x) => x.trim()).filter(Boolean);
    if (!needsDetailPage || cleaned.length <= DETAIL_PAGE_THRESHOLD) return cleaned;
    const lineW = (235 - 8) * SCALE - listFont.widthOfTextAtSize(`${bulletSymbol} `, cfg.checklist.size);
    const head = cleaned
      .slice(0, DETAIL_PAGE_THRESHOLD - 1)
      .map((x) => truncateToWidth(x, listFont, cfg.checklist.size, lineW));
    return [...head, `+${cleaned.length - head.length} poin lainnya (hal. 2)`];
  };
  if (!cfg.customTemplate) {
    // Template bawaan: tiap item ditaruh persis di baris bernomor 01–05,
    // rata kiri setelah nomor & di tengah vertikal antar garis.
    const rows = isGroup ? GROUP_LIST_ROWS : PRIVATE_LIST_ROWS;
    const rowSize = Math.min(cfg.checklist.size, 9);
    drawTemplateRows(page, summarize(includedItems), rows.centersPt, rows.left, listFont, rowSize);
    drawTemplateRows(page, summarize(excludedItems), rows.centersPt, rows.right, listFont, rowSize);
  } else {
    drawList(
      page, summarize(includedItems),
      firstBaselinePxResolved, cfg.checklist.rowSpacingPx, MAX_LIST_ROWS,
      cfg.checklist.leftXPx, listFont, cfg.checklist.size,
      cfg.checklist.sudahTermasukAlign ?? "center", bulletSymbol,
      footerCutoffPx,
    );
    drawList(
      page, summarize(excludedItems),
      firstBaselinePxResolved, cfg.checklist.rowSpacingPx, MAX_LIST_ROWS,
      cfg.checklist.rightXPx, listFont, cfg.checklist.size,
      cfg.checklist.belumTermasukAlign ?? "center", bulletSymbol,
      footerCutoffPx,
    );
  }

  if (needsDetailPage) {
    await appendDetailPages(pdf, {
      included: includedItems,
      excluded: excludedItems,
      notes: [],
      projectName,
      timeline: data.timelineShort || data.timeline || "",
      regular: fontFor("checklist", "regular"),
      semiBold: fontFor("checklist", "semiBold"),
      bold: fontFor("checklist", "bold"),
      useTemplate: false,
    });
  }

  return pdf.save();
}

/** Jumlah baris yg muat rapi di halaman 1 (nomor 01–05 di template). Lebih
 *  dari ini → halaman rincian ditambahkan. */
const DETAIL_PAGE_THRESHOLD = 5;

const DETAIL_GREEN: RGB = rgb(153 / 255, 204 / 255, 51 / 255);
const DETAIL_RED: RGB = rgb(236 / 255, 78 / 255, 78 / 255);
const DETAIL_RULE: RGB = rgb(0.82, 0.83, 0.88);

/** Path SVG rounded-rect (pdf-lib `drawRectangle` gak punya radius). Origin
 *  kiri-atas, dipakai dgn `drawSvgPath` yg flip sumbu Y otomatis. */
function roundedRectPath(w: number, h: number, r: number): string {
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} ` +
    `H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

/** Bagi item ke beberapa halaman berdasarkan tinggi tiap item (hasil wrap). */
function paginateItems(heights: number[], pageBudget: number): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  heights.forEach((h, i) => {
    if (used + h > pageBudget && pages[pages.length - 1].length > 0) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(i);
    used += h;
  });
  return pages;
}

/** Gambar list bullet dgn wrap + hanging indent. Berhenti kalau mentok
 *  `bottomPt`. Return posisi top (pt) setelah blok terakhir. */
function drawBulletBlock(
  page: PDFPage,
  items: string[],
  o: { x: number; topPt: number; bottomPt: number; maxW: number; size: number; font: PDFFont; color?: RGB },
): number {
  const lineH = o.size * 1.3;
  const gap = 3.5;
  const bulletW = o.font.widthOfTextAtSize("•  ", o.size);
  let top = o.topPt;
  for (const item of items) {
    const lines = wrapAtSize(item, o.font, o.size, o.maxW - bulletW);
    if (top + lines.length * lineH > o.bottomPt) break;
    lines.forEach((ln, li) => {
      const y = PAGE_H - (top + li * lineH + o.size * 0.85);
      if (li === 0) page.drawText("•", { x: o.x, y, size: o.size, font: o.font, color: o.color ?? DARK });
      page.drawText(ln, { x: o.x + bulletW, y, size: o.size, font: o.font, color: o.color ?? DARK });
    });
    top += lines.length * lineH + gap;
  }
  return top;
}

async function appendDetailPages(
  pdf: PDFDocument,
  o: {
    included: string[];
    excluded: string[];
    /** Poin tambahan (di bawah dua kolom). */
    notes: string[];
    projectName: string;
    timeline: string;
    regular: PDFFont;
    semiBold: PDFFont;
    bold: PDFFont;
    /** true = pakai template bawaan "Detail" (logo + footer sudah ada).
     *  false = halaman putih; logo & footer digambar manual. */
    useTemplate: boolean;
  },
) {
  let logo: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  let detailTpl: PDFDocument | null = null;
  if (o.useTemplate) {
    try {
      detailTpl = await PDFDocument.load(await fetchBytesCached(TEMPLATE_DETAIL_URL));
    } catch (e) {
      console.warn("[pdf] template halaman rincian gagal di-load, pakai halaman putih", e);
    }
  }
  if (!detailTpl) {
    try {
      logo = await pdf.embedPng(await fetchBytesCached("/logo-igh-tour-text.png"));
    } catch (e) {
      console.warn("[pdf] logo halaman rincian gagal di-load, dilewati", e);
    }
  }

  const MARGIN = 30;
  const COL_W = 168;
  const COL_GAP = PAGE_W - MARGIN * 2 - COL_W * 2;
  const SIZE = 9;
  const LINE_H = SIZE * 1.3;
  const ITEM_GAP = 3.5;
  const BULLET_W = o.regular.widthOfTextAtSize("•  ", SIZE);
  const LIST_TOP = 168;     // top-down dari tepi atas page (pt)
  const LIST_BOTTOM = 470;  // di atas garis footer
  const textW = COL_W - BULLET_W;

  const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  const cols = [
    { items: clean(o.included), x: MARGIN, color: DETAIL_GREEN, title: "Sudah Termasuk" },
    { items: clean(o.excluded), x: MARGIN + COL_W + COL_GAP, color: DETAIL_RED, title: "Belum Termasuk" },
  ].map((c) => {
    const wrapped = c.items.map((t) => wrapAtSize(t, o.regular, SIZE, textW));
    const heights = wrapped.map((l) => l.length * LINE_H + ITEM_GAP);
    return { ...c, wrapped, heights, pages: paginateItems(heights, LIST_BOTTOM - LIST_TOP) };
  });
  const listPages = cols.some((c) => c.items.length > 0)
    ? Math.max(...cols.map((c) => c.pages.length), 1)
    : 0;
  const notes = clean(o.notes);

  // Tinggi akhir list di halaman terakhir → nentuin catatan muat di situ atau pindah halaman.
  const usedOnLastListPage = listPages === 0 ? LIST_TOP : LIST_TOP + Math.max(
    ...cols.map((c) => (c.pages[listPages - 1] ?? []).reduce((sum, i) => sum + c.heights[i], 0)),
  );
  const NOTES_HEAD_H = 22;
  const notesLines = notes.map((t) => wrapAtSize(t, o.regular, SIZE, PAGE_W - MARGIN * 2 - BULLET_W).length);
  const notesH = notesLines.reduce((sum, n) => sum + n * LINE_H + ITEM_GAP, 0) + NOTES_HEAD_H;
  const notesFitOnLastListPage = listPages > 0 && usedOnLastListPage + 14 + notesH <= LIST_BOTTOM;
  const pageCount = listPages + (notes.length > 0 && !notesFitOnLastListPage ? 1 : 0);

  for (let pi = 0; pi < pageCount; pi++) {
    let page: PDFPage;
    if (detailTpl) {
      const [copied] = await pdf.copyPages(detailTpl, [0]);
      page = pdf.addPage(copied);
    } else {
      page = pdf.addPage([PAGE_W, PAGE_H]);
    }
    const yTop = (top: number) => PAGE_H - top;
    const isListPage = pi < listPages;

    if (!detailTpl) {
      // Halaman putih: logo + judul + footer digambar manual.
      if (logo) {
        const lw = 56;
        const lh = (lw * logo.height) / logo.width;
        page.drawImage(logo, { x: MARGIN, y: yTop(26) - lh, width: lw, height: lh });
      }
      const titleX = MARGIN + 80;
      page.drawText("Rincian Paket", { x: titleX, y: yTop(52), size: 15, font: o.bold, color: ORANGE });
      const nameLines = wrapAtSize(o.projectName || "—", o.semiBold, 9, PAGE_W - titleX - MARGIN).slice(0, 2);
      nameLines.forEach((ln, i) => {
        page.drawText(ln, { x: titleX, y: yTop(70 + i * 12), size: 9, font: o.semiBold, color: DARK });
      });
      if (o.timeline) {
        page.drawText(o.timeline, { x: titleX, y: yTop(70 + nameLines.length * 12 + 2), size: 8, font: o.regular, color: GREY_MUTED });
      }
      page.drawLine({
        start: { x: MARGIN, y: yTop(486) }, end: { x: PAGE_W - MARGIN, y: yTop(486) },
        thickness: 0.6, color: DETAIL_RULE,
      });
      page.drawText("@", { x: MARGIN, y: yTop(502), size: 8, font: o.bold, color: ORANGE });
      page.drawText("instagram.com/igh.tour", { x: MARGIN + 12, y: yTop(502), size: 7, font: o.regular, color: DARK });
      const mail = "igh.tours.travel@gmail.com";
      const mw = o.regular.widthOfTextAtSize(mail, 7);
      page.drawText("@", { x: PAGE_W - MARGIN - mw - 12, y: yTop(502), size: 8, font: o.bold, color: ORANGE });
      page.drawText(mail, { x: PAGE_W - MARGIN - mw, y: yTop(502), size: 7, font: o.regular, color: DARK });
      const tag = "Pilihanmu untuk menjelajah";
      page.drawText(tag, { x: (PAGE_W - o.regular.widthOfTextAtSize(tag, 7)) / 2, y: yTop(523), size: 7, font: o.regular, color: GREY_MUTED });
      const big = "Timur Tengah!";
      page.drawText(big, { x: (PAGE_W - o.bold.widthOfTextAtSize(big, 14)) / 2, y: yTop(540), size: 14, font: o.bold, color: ORANGE });
    }
    // Garis pemisah di bawah logo.
    page.drawLine({
      start: { x: MARGIN, y: yTop(118) }, end: { x: PAGE_W - MARGIN, y: yTop(118) },
      thickness: 0.6, color: DETAIL_RULE,
    });

    let cursorAfterLists = LIST_TOP;
    if (isListPage) {
      for (const c of cols) {
        // Pill judul kolom.
        const pw = 112, ph = 17;
        const px = c.x + (COL_W - pw) / 2;
        page.drawSvgPath(roundedRectPath(pw, ph, 4), { x: px, y: yTop(132), color: c.color, borderWidth: 0 });
        const tw = o.bold.widthOfTextAtSize(c.title, 9.5);
        page.drawText(c.title, { x: px + (pw - tw) / 2, y: yTop(132) - 12, size: 9.5, font: o.bold, color: WHITE });

        let cursor = LIST_TOP;
        for (const idx of c.pages[pi] ?? []) {
          const lines = c.wrapped[idx];
          lines.forEach((ln, li) => {
            const y = yTop(cursor + li * LINE_H + SIZE * 0.85);
            if (li === 0) page.drawText("•", { x: c.x + 4, y, size: SIZE, font: o.regular, color: DARK });
            page.drawText(ln, { x: c.x + 4 + BULLET_W, y, size: SIZE, font: o.regular, color: DARK });
          });
          cursor += c.heights[idx];
        }
        cursorAfterLists = Math.max(cursorAfterLists, cursor);
        if (c.items.length === 0 && pi === 0) {
          page.drawText("—", { x: c.x + 4, y: yTop(LIST_TOP + SIZE * 0.85), size: SIZE, font: o.regular, color: GREY_MUTED });
        }
      }
    }

    // Poin tambahan: di bawah list (halaman list terakhir) atau halaman sendiri.
    const notesHere = notes.length > 0 && (isListPage ? pi === listPages - 1 && notesFitOnLastListPage : true);
    if (notesHere) {
      const headTop = isListPage ? cursorAfterLists + 14 : LIST_TOP - 24;
      page.drawText("Catatan Tambahan", { x: MARGIN, y: yTop(headTop + 9), size: 9.5, font: o.bold, color: ORANGE });
      drawBulletBlock(page, notes, {
        x: MARGIN + 4,
        topPt: headTop + NOTES_HEAD_H,
        bottomPt: LIST_BOTTOM,
        maxW: PAGE_W - MARGIN * 2 - 4,
        size: SIZE,
        font: o.regular,
      });
    }
  }
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
    /** Template bawaan: baseline teks disamakan dgn instagram/email (pt,
     *  top-down) & blok icon+nomor di-tengah halaman. Override topPx/leftXPx. */
    alignToTemplate?: { baselineTopPt: number; centerXPt: number };
  },
) {
  const gap = 4;
  const textWidth = opts.font.widthOfTextAtSize(opts.displayNumber, opts.textSizePt);
  const baseX = opts.alignToTemplate
    ? opts.alignToTemplate.centerXPt - (opts.iconSizePt + gap + textWidth) / 2
    : opts.leftXPx * SCALE;
  // Konversi top-px → PDF baseline. IG di template baseline ~yMin=498pt
  // (pdftotext, top-down). Pakai konversi standar pxRect agar konsisten
  // dengan elemen lain.
  const baseY = PAGE_H - opts.topPx * SCALE;
  const r = opts.iconSizePt / 2;
  const cx = baseX + r;
  const cy = opts.alignToTemplate
    ? PAGE_H - opts.alignToTemplate.baselineTopPt + opts.textSizePt * 0.32
    : baseY + r * 0.4; // sedikit naik supaya optical-center sejajar teks

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
    (existing as unknown as { push: (x: unknown) => void }).push(linkRef);
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
  /** Batas bawah (template-px). Semua item selalu di-render dengan auto-fit
   *  spacing; nilai ini hanya dipakai sebagai safety-stop jika teks benar-benar
   *  tidak muat bahkan setelah kompresi. */
  maxBaselinePx?: number,
) {
  const cleaned = items.map((s) => s.trim()).filter(Boolean).slice(0, maxRows);
  if (cleaned.length === 0) return;

  // Width budget per row ~ 235px (kolom asli template). Padding 8px disisain
  // utk breathing room dari border template.
  const COL_WIDTH = 235;
  const maxW = (COL_WIDTH - 8) * SCALE;
  const anchorXPt = anchorXPx * SCALE;
  const prefix = bullet ? `${bullet} ` : "";
  const size = baseSize;
  const prefixW = font.widthOfTextAtSize(prefix, size);

  // Line advance dlm template-px: konversi dari pt (size*1.25) lewat SCALE.
  const lineAdvancePx = (size * 1.25) / SCALE;

  // Pre-wrap semua item sekaligus agar bisa hitung total height sebelum render.
  const bodyMaxW = Math.max(0, maxW - prefixW);
  const allWrapped = cleaned.map((item) => wrapAtSize(item, font, size, bodyMaxW));
  const totalLines = allWrapped.reduce((s, l) => s + l.length, 0);

  // ── AUTO-FIT: hitung interItemGapPx yang muat di available space ──
  //
  // Derivasi kursornya per item (n_i = jumlah baris item ke-i):
  //   inner loop  : cursor += n_i * lineAdvancePx
  //   outer adjust: cursor += interItemGapPx - lineAdvancePx
  //   net per item: (n_i - 1) * lineAdvancePx + interItemGapPx
  //
  // Posisi baris TERAKHIR item ke-k (0-indexed, dari firstBaselinePx) =
  //   sum_{i=0}^{k-1} [(n_i-1)*lineAdvancePx + interItemGapPx]   ← sebelum item k
  //   + (n_k - 1) * lineAdvancePx                                 ← baris terakhir item k
  //
  // Untuk item TERAKHIR (k = nItems-1):
  //   posisi baris terakhir = (totalLines - nItems) * lineAdvancePx
  //                         + (nItems - 1)          * interItemGapPx
  //
  // Supaya semua masuk: posisi ≤ availablePx = maxBaselinePx - firstBaselinePx
  //   → interItemGapPx ≤ (availablePx - (totalLines - nItems) * lineAdvancePx) / (nItems - 1)
  //
  // Catatan: nItems = 1 tidak butuh kompresi (tidak ada gap antar item).
  // Net advance per item 1-baris = interItemGapPx (lihat derivasi di atas), jadi
  // default-nya HARUS rowSpacingPx. Sebelumnya `rowSpacingPx - lineAdvancePx`
  // (≈9px < tinggi 1 baris ≈22px) → item numpuk & saling timpa walau cuma 3 item.
  let interItemGapPx = Math.max(rowSpacingPx, lineAdvancePx);
  if (maxBaselinePx !== undefined && cleaned.length > 1) {
    const availablePx = maxBaselinePx - firstBaselinePx;
    const textOnlyPx  = (totalLines - cleaned.length) * lineAdvancePx;
    if (textOnlyPx < availablePx) {
      const maxGapPx = (availablePx - textOnlyPx) / (cleaned.length - 1);
      // Minimum gap = 15% tinggi baris — agar ada sedikit breathing room antar item.
      const minGapPx = lineAdvancePx * 0.9; // jangan lebih rapat dari 1 baris → gak saling timpa
      interItemGapPx = Math.max(minGapPx, Math.min(interItemGapPx, maxGapPx));
    }
    // Kalau textOnlyPx >= availablePx (teks terlalu padat bahkan tanpa gap),
    // biarkan interItemGapPx default — item tetap di-render, lebih baik dari hilang.
  }

  let cursorBaselinePx = firstBaselinePx;
  for (let i = 0; i < allWrapped.length; i++) {
    const wrappedBody = allWrapped[i];

    // Lebar block = prefix + baris terpanjang. Dipakai utk alignment center/right.
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
      // Safety-stop: hanya aktif kalau teks benar-benar meluber bahkan setelah auto-fit.
      if (maxBaselinePx !== undefined && cursorBaselinePx >= maxBaselinePx) return;
      const y = PAGE_H - cursorBaselinePx * SCALE;
      if (li === 0 && prefix) {
        page.drawText(prefix, { x: blockLeftPt, y, size, font, color: DARK });
        page.drawText(wrappedBody[li], { x: textXPt, y, size, font, color: DARK });
      } else {
        page.drawText(wrappedBody[li], { x: textXPt, y, size, font, color: DARK });
      }
      cursorBaselinePx += lineAdvancePx;
    }
    // Ganti advance terakhir (lineAdvancePx) dengan interItemGapPx.
    // Net per 1-line item = interItemGapPx; per N-line item = (N-1)*lineAdvancePx + interItemGapPx.
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

/** Render SEMUA halaman PDF jadi data-URL PNG (halaman 1 = penawaran, sisanya
 *  = halaman rincian bila ada). */
export async function renderIghPdfPages(
  data: IghPdfData,
  scale = 1.5,
  layout?: Partial<IghLayoutConfig>,
): Promise<string[]> {
  const bytes = await buildIghPdf(data, layout);
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const urls: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    urls.push(canvas.toDataURL("image/png"));
  }
  return urls;
}

/** Preview halaman 1 saja (dipakai thumbnail). */
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
