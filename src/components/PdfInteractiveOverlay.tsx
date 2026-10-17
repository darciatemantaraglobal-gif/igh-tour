import { useEffect, useMemo, useRef, useState } from "react";
import type { IghLayoutConfig, IghLayoutMode } from "@/lib/ighPdfConfig";

/**
 * Overlay drag-and-resize ala Canva di atas preview PDF.
 *
 * Koordinat di config = "template space" 740-px wide, top-left origin.
 * Image preview di-render dengan width tertentu di CSS — kita hitung
 * scale = displayedImgWidth / 740 untuk konversi bolak-balik.
 *
 * Selama drag/resize, perubahan ditahan di state lokal (ghost) dan baru
 * di-commit ke onChange saat pointer dilepas → cuma 1x re-render PDF.
 */

const TEMPLATE_WIDTH_PX = 740;
const TEMPLATE_HEIGHT_PX = 1024;
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 64;

// ── Geometri PDF (sinkron sama generateIghPdf.ts) ──────────────────────────
// PAGE_W=413.9506pt, TPL_W_PX=740 → SCALE = 0.5594.
// Konversi font-size (PDF point) → template-px: 1/SCALE ≈ 1.788.
const PDF_SCALE = 413.9506 / TEMPLATE_WIDTH_PX;
const PT_TO_TPL_PX = 1 / PDF_SCALE;

/**
 * `drawText` di generateIghPdf naruh BASELINE di:
 *   y_baseline_from_top_pt = topPx*SCALE + size*0.78
 * Jadi di template-px:
 *   baseline_tpl = topPx + size * 0.78 / SCALE ≈ topPx + size*1.394
 *   cap_top_tpl  = baseline_tpl - 0.7*size/SCALE ≈ topPx + size*0.143
 *   descender_tpl ≈ baseline_tpl + 0.2*size/SCALE ≈ topPx + size*1.752
 * Total tinggi visual text ≈ size * 1.61 template-px, mulai sedikit di bawah topPx.
 */
const TEXT_TOP_OFFSET_RATIO = 0.143; // cap-top relatif terhadap topPx, dlm satuan size
const TEXT_HEIGHT_RATIO = 1.61;       // tinggi cap-to-descender, dlm satuan size

function textBoxY(topPx: number, size: number): number {
  return topPx + size * TEXT_TOP_OFFSET_RATIO;
}
function textBoxH(size: number): number {
  return size * TEXT_HEIGHT_RATIO;
}

// ── Canvas-based text width estimator ──────────────────────────────────────
// Bukan pengganti font.widthOfTextAtSize pdf-lib (beda subset), tapi cukup
// akurat (~5-8% margin) buat nentuin apakah projectName wrap ke 2 baris.
let _measureCtx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx) return _measureCtx;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  _measureCtx = c.getContext("2d");
  return _measureCtx;
}

// Memo cache untuk wrapText (Batch 2 perf): hindari measure berulang saat drag.
// Key = `${weight}|${sizePt}|${maxWidthPx}|${text}`. Cap 200 entri (LRU sederhana
// via Map insertion order: oldest dihapus saat melebihi limit).
const _wrapCache = new Map<string, string[]>();
const _WRAP_CACHE_MAX = 200;

/** Bagi text jadi baris-baris ala wrapAtSize (greedy by space). */
function wrapText(text: string, maxWidthPx: number, sizePt: number, weight = "bold"): string[] {
  const cacheKey = `${weight}|${sizePt}|${maxWidthPx}|${text}`;
  const cached = _wrapCache.get(cacheKey);
  if (cached) {
    // LRU touch: re-insert biar jadi paling baru.
    _wrapCache.delete(cacheKey);
    _wrapCache.set(cacheKey, cached);
    return cached;
  }
  const ctx = measureCtx();
  if (!ctx) return [text];
  ctx.font = `${weight} ${sizePt}px Poppins, "Helvetica Neue", Arial, sans-serif`;
  const maxWInCssPx = maxWidthPx / PT_TO_TPL_PX;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [text || ""];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (ctx.measureText(trial).width <= maxWInCssPx) {
      line = trial;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  const result = lines.length ? lines : [text];
  _wrapCache.set(cacheKey, result);
  if (_wrapCache.size > _WRAP_CACHE_MAX) {
    // Hapus entri tertua (Map insertion-order keys).
    const firstKey = _wrapCache.keys().next().value;
    if (firstKey !== undefined) _wrapCache.delete(firstKey);
  }
  return result;
}

/** Hitung jumlah baris projectName: split('\n') dulu (manual line break dari
 *  user), lalu auto-wrap tiap segmen. Sinkron dgn generator (MAX 4 baris). */
function projectNameLineCount(text: string, baseSize: number): number {
  if (!text || !text.trim()) return 1;
  const PROJ_MAX_W_TPL = 285; // template-px, sesuai generator
  const MAX_LINES = 4; // sinkron dgn generateIghPdf MAX_TITLE_LINES
  const segments = text.split("\n");
  let size = baseSize;
  while (size > 14) {
    let total = 0;
    for (const seg of segments) {
      if (!seg.trim()) {
        total += 1; // empty manual line tetep advance Y
        continue;
      }
      const lines = wrapText(seg, PROJ_MAX_W_TPL, size);
      total += Math.max(1, lines.length);
    }
    if (total <= MAX_LINES) return Math.max(1, total);
    size -= 1;
  }
  return MAX_LINES;
}

type ElementKey =
  | "projectName"
  | "headerTimeline"
  | "metaInfoCustomer"
  | "metaInfoDate"
  | "hotelMakkah"
  | "hotelMadinah"
  | "pricing"
  | "groupPricing"
  | "pricingNote"
  | "checklist"
  | "whatsapp";

interface OverlayElement {
  key: ElementKey;
  label: string;
  /** Bounding box di template-px (top-left origin). */
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  /** Font size yang dikontrol oleh resize handle. */
  size: number;
}

/** Bounding-box visual yg presisi sesuai geometri PDF beneran. */
function buildElements(
  layout: IghLayoutConfig,
  mode: IghLayoutMode,
  projectNameText: string,
  timelineText: string,
): OverlayElement[] {
  const els: OverlayElement[] = [];

  // ── Project Name ── (auto-wrap up to 2 baris, maxWidthPx=285)
  {
    const s = layout.projectName.size;
    const text = (layout.projectName.text?.trim() || projectNameText || "").trim();
    const lines = projectNameLineCount(text, s);
    // Per generator: lineAdvance = size*1.05 (pt→px) + lineGapPx (template-px)
    const lineAdvance = s * 1.05 * PT_TO_TPL_PX + layout.projectName.lineGapPx;
    const heightPx = (lines - 1) * lineAdvance + textBoxH(s);
    els.push({
      key: "projectName",
      label: lines > 1 ? `Project Name (${lines} baris)` : "Project Name",
      xPx: layout.projectName.xPx,
      yPx: textBoxY(layout.projectName.topPx, s),
      widthPx: 285,
      heightPx,
      size: s,
    });

    // ── Header Timeline (subtitle tanggal di bawah Project Name) ──
    // Bbox dihitung sinkron dgn generateIghPdf: end-of-title = topPx + lines *
    // (size + lineGapPx). Subtitle Y = endOfTitle + mainHeaderGap + offsetY.
    // X = projectName.xPx + offsetX. Subtitle size = layout.subtitleFontSize
    // (default 11pt) — sinkron 1:1 dgn generator.
    // Lebar = layout.subtitleWidthPx (default 285) → kalau user kasih nilai
    // lebih besar via Tuner, bbox biru ikut melebar. Kalau timeline kepanjangan
    // setelah lebar maksimal pun, di-wrap multi-line di generator → bbox tinggi
    // disesuaikan jumlah baris yg sebenernya akan dirender.
    // Bbox ini draggable independen dari projectName (handler di applyTranslate
    // cuma update headerSubtitleOffset, gak nyentuh projectName.topPx).
    const subtitleSize = layout.subtitleFontSize ?? 11;
    const endOfTitlePx = layout.projectName.topPx + lines * lineAdvance;
    const subtitleGapPx = layout.mainHeaderGap ?? layout.headerSubtitleGap ?? 6;
    const subtitleXOffPx = layout.headerSubtitleOffset?.xPx ?? 0;
    const subtitleYOffPx = layout.headerSubtitleOffset?.yPx ?? 0;
    const subtitleWidthPx = layout.subtitleWidthPx ?? 285;
    // Estimasi jumlah baris subtitle pakai measureCtx (regular weight). Kalau
    // teks fit dalam 1 baris → 1, kalau enggak → multi-line. Min 1 baris supaya
    // bbox tetap kelihatan walau text kosong.
    const subtitleTextTrim = (timelineText || "").trim();
    const subtitleLines = subtitleTextTrim
      ? wrapText(subtitleTextTrim, subtitleWidthPx, subtitleSize, "normal").length
      : 1;
    const subtitleLineAdvancePx = subtitleSize * 1.25;
    const subtitleHeightPx =
      (subtitleLines - 1) * subtitleLineAdvancePx + textBoxH(subtitleSize);
    els.push({
      key: "headerTimeline",
      label: "Tanggal (Subtitle)",
      xPx: layout.projectName.xPx + subtitleXOffPx,
      yPx: textBoxY(endOfTitlePx + subtitleGapPx + subtitleYOffPx, subtitleSize),
      widthPx: subtitleWidthPx,
      heightPx: subtitleHeightPx,
      size: subtitleSize,
    });
  }

  // ── Meta Info — split jadi 2 bounding box terpisah (Date & Client) ──
  // Tiap elemen punya X & Y mandiri (customerXPx/customerYPx vs dateXPx/dateYPx)
  // sehingga bisa di-drag independen tanpa saling nimpa. Lebar visual = budget
  // maxWidthPx=175 di generator (drawText).
  {
    const s = layout.metaInfo.size;
    const META_W = 175;
    const customerY = layout.metaInfo.customerYPx ?? layout.metaInfo.topPx;
    const dateY = layout.metaInfo.dateYPx ?? layout.metaInfo.topPx;
    els.push({
      key: "metaInfoDate",
      label: "Date",
      xPx: layout.metaInfo.dateXPx,
      yPx: textBoxY(dateY, s),
      widthPx: META_W,
      heightPx: textBoxH(s),
      size: s,
    });
    els.push({
      key: "metaInfoCustomer",
      label: "Invoice to",
      xPx: layout.metaInfo.customerXPx,
      yPx: textBoxY(customerY, s),
      widthPx: META_W,
      heightPx: textBoxH(s),
      size: s,
    });
  }

  // ── Hotel (Makkah + Madinah dipisah jadi 2 object terpilih sendiri-sendiri) ──
  // Tiap kolom punya nama hotel + subtitle "X Malam" (size 9) di topPx+38.
  {
    const s = layout.hotel.size;
    const top = textBoxY(layout.hotel.topPx, s);
    // Subtitle "X Malam" pada topPx + subtitleOffsetPx, size=9 → bottom ≈ ... + 9*1.752
    const subtitleBottom = layout.hotel.topPx + layout.hotel.subtitleOffsetPx + 9 * (TEXT_TOP_OFFSET_RATIO + TEXT_HEIGHT_RATIO);
    const colHeight = subtitleBottom - top;
    const COL_WIDTH = 220; // visual nama hotel biasanya pendek

    els.push({
      key: "hotelMakkah",
      label: "Hotel Makkah",
      xPx: layout.hotel.makkahXPx,
      yPx: top,
      widthPx: COL_WIDTH,
      heightPx: colHeight,
      size: s,
    });
    els.push({
      key: "hotelMadinah",
      label: "Hotel Madinah",
      xPx: layout.hotel.madinahXPx,
      yPx: top,
      widthPx: COL_WIDTH,
      heightPx: colHeight,
      size: s,
    });
  }

  if (mode === "group") {
    // ── Pricing Table (Group) — N rows, 4 kolom ──
    // Cell width fix di generator = 110px, height = cellHeightPx, top row baris pertama.
    // Baris sebenernya tergantung data; pakai estimasi 6 untuk visual handle.
    const gp = layout.groupPricing;
    const ROWS = 6;
    const left = gp.paxCenterXPx - 55; // 110/2
    const right = gp.doubleCenterXPx + gp.doubleXOffsetPx + 55;
    els.push({
      key: "groupPricing",
      label: "Pricing Table",
      xPx: left,
      yPx: gp.topPx,
      widthPx: right - left,
      heightPx: (ROWS - 1) * gp.rowSpacingPx + gp.cellHeightPx,
      size: gp.size,
    });
  } else {
    // ── Pricing (Private) — 2 kotak orange, lebar fix 114 + 406 ──
    // Generator: PAX_BOX widthPx=114, PRICE_BOX widthPx=406, both heightPx=61, topPx=topPx
    const p = layout.pricing;
    const left = Math.min(p.paxXPx, p.priceXPx);
    const paxRight = p.paxXPx + 114;
    const priceRight = p.priceXPx + 406;
    const right = Math.max(paxRight, priceRight);
    els.push({
      key: "pricing",
      label: "Pricing",
      xPx: left,
      yPx: p.topPx,
      widthPx: right - left,
      heightPx: 61,
      size: p.size,
    });
  }

  // ── Pricing Note (Catatan Tambahan) ──
  {
    const pn = layout.pricingNote ?? { xPx: 53, topPx: 632, size: 7.5, align: "left", maxWidthPx: 646 };
    els.push({
      key: "pricingNote",
      label: "Catatan Tambahan",
      xPx: pn.xPx,
      yPx: textBoxY(pn.topPx, pn.size),
      widthPx: pn.maxWidthPx ?? 646,
      heightPx: textBoxH(pn.size),
      size: pn.size,
    });
  }

  // ── WhatsApp footer — icon hijau + nomor admin ──
  // Cuma ditampilkan kalau footer.showWhatsapp=true. Posisi dibaca dari
  // whatsappPosition (fallback ke legacy footer.topPx/waXPx). Bbox kira-kira:
  // icon diameter (iconSizePt/SCALE) + 4pt gap + nomor (~80pt = ~143px).
  if (layout.footer.showWhatsapp) {
    const waX = layout.whatsappPosition?.xPx ?? layout.footer.waXPx;
    const waY = layout.whatsappPosition?.yPx ?? layout.footer.topPx;
    const iconPx = layout.footer.waIconSizePt / 0.5594; // SCALE constant ≈ pt→tpl-px
    const numWidthPx = 150; // approx untuk "+62 8XX-XXXX-XXXX" pada 7pt
    els.push({
      key: "whatsapp",
      label: "WhatsApp",
      // Top icon kira-kira 1.4× radius di atas baseline (cy = baseY + r*0.4)
      xPx: waX,
      yPx: waY - iconPx * 0.7,
      widthPx: iconPx + 4 + numWidthPx,
      heightPx: iconPx + 2,
      size: layout.footer.size,
    });
  }

  // ── Checklist — 5 baris, baselinePx = posisi BASELINE (bukan top!) ──
  {
    const c = layout.checklist;
    const s = c.size;
    // Cap-top untuk row pertama: baselinePx - 0.7*size/SCALE
    const capTop = c.firstBaselinePx - 0.7 * s * PT_TO_TPL_PX;
    // Descender row terakhir (row index 4): baseline + 0.2*size/SCALE
    const lastBaseline = c.firstBaselinePx + 4 * c.rowSpacingPx + c.yOffsetPx;
    const descBottom = lastBaseline + 0.2 * s * PT_TO_TPL_PX;
    // Lebar kolom asli template = 235px. Box = dari kiri kolom kiri sampai kanan kolom kanan.
    const left = Math.min(c.leftXPx, c.rightXPx) - 235 / 2;
    const right = Math.max(c.leftXPx, c.rightXPx) + 235 / 2;
    els.push({
      key: "checklist",
      label: "Checklist",
      xPx: left,
      yPx: capTop,
      widthPx: right - left,
      heightPx: descBottom - capTop,
      size: s,
    });
  }

  return els;
}

/** Apply translasi (dxPx, dyPx) di template-space pada section tertentu. */
function applyTranslate(
  layout: IghLayoutConfig,
  key: ElementKey,
  dxPx: number,
  dyPx: number,
): IghLayoutConfig {
  const next = { ...layout };
  switch (key) {
    case "projectName":
      next.projectName = {
        ...layout.projectName,
        xPx: layout.projectName.xPx + dxPx,
        topPx: layout.projectName.topPx + dyPx,
      };
      break;
    case "headerTimeline": {
      // Subtitle Tanggal di-drag mandiri → cuma update headerSubtitleOffset
      // (xPx & yPx). Project Name TIDAK ikut bergerak. Resolve current offset
      // dari layout, fallback {0,0} kalau preset lama belum punya field.
      const curOff = layout.headerSubtitleOffset ?? { xPx: 0, yPx: 0 };
      next.headerSubtitleOffset = {
        xPx: curOff.xPx + dxPx,
        yPx: curOff.yPx + dyPx,
      };
      break;
    }
    case "metaInfoCustomer": {
      // Resolve current Y untuk customer (fallback ke legacy topPx supaya
      // preset lama yg belum punya customerYPx tetap geser dari posisi visual
      // yg user lihat sekarang, bukan dari 0).
      const curY = layout.metaInfo.customerYPx ?? layout.metaInfo.topPx;
      next.metaInfo = {
        ...layout.metaInfo,
        customerXPx: layout.metaInfo.customerXPx + dxPx,
        customerYPx: curY + dyPx,
      };
      break;
    }
    case "metaInfoDate": {
      const curY = layout.metaInfo.dateYPx ?? layout.metaInfo.topPx;
      next.metaInfo = {
        ...layout.metaInfo,
        dateXPx: layout.metaInfo.dateXPx + dxPx,
        dateYPx: curY + dyPx,
      };
      break;
    }
    case "hotelMakkah":
      next.hotel = {
        ...layout.hotel,
        makkahXPx: layout.hotel.makkahXPx + dxPx,
        topPx: layout.hotel.topPx + dyPx,
      };
      break;
    case "hotelMadinah":
      next.hotel = {
        ...layout.hotel,
        madinahXPx: layout.hotel.madinahXPx + dxPx,
        topPx: layout.hotel.topPx + dyPx,
      };
      break;
    case "pricing":
      next.pricing = {
        ...layout.pricing,
        paxXPx: layout.pricing.paxXPx + dxPx,
        priceXPx: layout.pricing.priceXPx + dxPx,
        topPx: layout.pricing.topPx + dyPx,
      };
      break;
    case "groupPricing":
      next.groupPricing = {
        ...layout.groupPricing,
        paxCenterXPx: layout.groupPricing.paxCenterXPx + dxPx,
        quadCenterXPx: layout.groupPricing.quadCenterXPx + dxPx,
        tripleCenterXPx: layout.groupPricing.tripleCenterXPx + dxPx,
        doubleCenterXPx: layout.groupPricing.doubleCenterXPx + dxPx,
        topPx: layout.groupPricing.topPx + dyPx,
      };
      break;
    case "checklist":
      next.checklist = {
        ...layout.checklist,
        leftXPx: layout.checklist.leftXPx + dxPx,
        rightXPx: layout.checklist.rightXPx + dxPx,
        firstBaselinePx: layout.checklist.firstBaselinePx + dyPx,
      };
      break;
    case "pricingNote": {
      const cur = layout.pricingNote ?? { xPx: 53, topPx: 632, size: 7.5, align: "left", maxWidthPx: 646 };
      next.pricingNote = {
        ...cur,
        xPx: cur.xPx + dxPx,
        topPx: cur.topPx + dyPx,
      };
      break;
    }
    case "whatsapp": {
      // Drag WA = update whatsappPosition. Resolve current X/Y dari struktur baru
      // (whatsappPosition) atau fallback ke legacy footer fields supaya preset
      // lama tetap geser dari posisi visual yg user lihat sekarang, bukan dari 0.
      const curX = layout.whatsappPosition?.xPx ?? layout.footer.waXPx;
      const curY = layout.whatsappPosition?.yPx ?? layout.footer.topPx;
      next.whatsappPosition = {
        xPx: curX + dxPx,
        yPx: curY + dyPx,
      };
      break;
    }
  }
  return next;
}

/** Update font size pada section tertentu (dipakai oleh resize handle). */
function applyResize(
  layout: IghLayoutConfig,
  key: ElementKey,
  newSize: number,
): IghLayoutConfig {
  const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(newSize)));
  const next = { ...layout };
  switch (key) {
    case "projectName":
      next.projectName = { ...layout.projectName, size: clamped };
      break;
    case "metaInfoCustomer":
    case "metaInfoDate":
      // Font size shared utk konsistensi visual antara Date & Invoice.
      next.metaInfo = { ...layout.metaInfo, size: clamped };
      break;
    case "hotelMakkah":
    case "hotelMadinah":
      next.hotel = { ...layout.hotel, size: clamped };
      break;
    case "pricing":
      next.pricing = { ...layout.pricing, size: clamped };
      break;
    case "groupPricing":
      next.groupPricing = { ...layout.groupPricing, size: clamped };
      break;
    case "pricingNote": {
      const cur = layout.pricingNote ?? { xPx: 53, topPx: 632, size: 7.5, align: "left", maxWidthPx: 646 };
      next.pricingNote = { ...cur, size: clamped };
      break;
    }
    case "checklist":
      next.checklist = { ...layout.checklist, size: clamped };
      break;
  }
  return next;
}

interface Props {
  /** Config aktif (committed). */
  layout: IghLayoutConfig;
  mode: IghLayoutMode;
  /** Dipanggil cuma di akhir drag/resize → 1x re-render PDF. */
  onChange: (next: IghLayoutConfig) => void;
  /** Bounding box image preview di koordinat container overlay (px). */
  imgRect: { left: number; top: number; width: number; height: number } | null;
  /** Aktifkan / matikan layer interaktif. */
  enabled: boolean;
  /** Teks project name dari kalkulator — buat ngitung wrap multi-line. */
  projectNameText?: string;
  /** Teks timeline (tanggal) dari kalkulator — buat ngitung tinggi bbox
   *  subtitle saat di-wrap multi-line. Default "" → bbox 1 baris. */
  timelineText?: string;
}

type DragState =
  | { kind: "move"; keys: ElementKey[]; startX: number; startY: number }
  | { kind: "resize"; key: ElementKey; corner: 0 | 1 | 2 | 3; startX: number; startY: number; startSize: number; startDiag: number };

/** Gabungkan beberapa OverlayElement jadi 1 bounding-box pseudo-element buat snap. */
function unionBox(els: OverlayElement[]): OverlayElement | null {
  if (!els.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of els) {
    minX = Math.min(minX, e.xPx);
    minY = Math.min(minY, e.yPx);
    maxX = Math.max(maxX, e.xPx + e.widthPx);
    maxY = Math.max(maxY, e.yPx + e.heightPx);
  }
  return {
    key: els[0].key,
    label: "group",
    xPx: minX,
    yPx: minY,
    widthPx: maxX - minX,
    heightPx: maxY - minY,
    size: els[0].size,
  };
}

const SNAP_THRESHOLD_TPL = 3; // template-px (~1.5 CSS-px di display ratio 0.5)

/** Element keys yang berbasis teks (punya baseline yang bermakna untuk align). */
const TEXT_KEYS: ReadonlySet<ElementKey> = new Set<ElementKey>([
  "projectName", "headerTimeline", "metaInfoCustomer", "metaInfoDate", "hotelMakkah", "hotelMadinah", "checklist",
]);

/** Hitung baseline-Y (template-px) elemen text dari cap-top (yPx).
 *  baseline = topPx + size*1.394 = (topPx + size*0.143) + size*1.251 = yPx + size*1.251 */
function elementBaseline(el: OverlayElement): number {
  return el.yPx + el.size * 1.251;
}

/** Snap dx/dy supaya edge dragged element nempel ke salah satu kandidat dari elemen lain. */
function applySnap(
  dragged: OverlayElement,
  others: OverlayElement[],
  dx: number,
  dy: number,
  /** Baseline-Y dragged elements (template-px, sebelum delta) untuk baseline snap. */
  extraDraggedY: number[] = [],
  /** Kandidat baseline-Y dari other text elements (template-px). */
  extraOthersY: number[] = [],
): { dx: number; dy: number; xGuides: number[]; yGuides: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const o of others) {
    xs.push(o.xPx, o.xPx + o.widthPx, o.xPx + o.widthPx / 2);
    ys.push(o.yPx, o.yPx + o.heightPx, o.yPx + o.heightPx / 2);
  }
  // Tambahin garis bantu page edges juga (kiri, tengah, kanan halaman).
  xs.push(0, TEMPLATE_WIDTH_PX / 2, TEMPLATE_WIDTH_PX);
  // Baseline kandidat dari elemen text lain.
  for (const v of extraOthersY) ys.push(v);

  const left = dragged.xPx + dx;
  const right = left + dragged.widthPx;
  const cx = left + dragged.widthPx / 2;
  const top = dragged.yPx + dy;
  const bottom = top + dragged.heightPx;
  const cy = top + dragged.heightPx / 2;

  // Y-edges yang akan kita coba snap-kan ke kandidat ys.
  // Selain bbox top/center/bottom, juga semua baseline elemen yg lagi di-drag.
  const draggedYEdges: number[] = [top, cy, bottom, ...extraDraggedY.map((v) => v + dy)];

  let bestX: { delta: number; value: number } | null = null;
  for (const edge of [left, cx, right]) {
    for (const v of xs) {
      const d = v - edge;
      if (Math.abs(d) <= SNAP_THRESHOLD_TPL && (!bestX || Math.abs(d) < Math.abs(bestX.delta))) {
        bestX = { delta: d, value: v };
      }
    }
  }
  let bestY: { delta: number; value: number } | null = null;
  for (const edge of draggedYEdges) {
    for (const v of ys) {
      const d = v - edge;
      if (Math.abs(d) <= SNAP_THRESHOLD_TPL && (!bestY || Math.abs(d) < Math.abs(bestY.delta))) {
        bestY = { delta: d, value: v };
      }
    }
  }

  const xGuides: number[] = [];
  const yGuides: number[] = [];
  let outDx = dx;
  let outDy = dy;
  if (bestX) { outDx = dx + bestX.delta; xGuides.push(bestX.value); }
  if (bestY) { outDy = dy + bestY.delta; yGuides.push(bestY.value); }
  return { dx: outDx, dy: outDy, xGuides, yGuides };
}

export function PdfInteractiveOverlay({ layout, mode, onChange, imgRect, enabled, projectNameText = "", timelineText = "" }: Props) {
  // Ghost layout dipakai cuma selama drag aktif. Null = pakai `layout`.
  const [ghost, setGhost] = useState<IghLayoutConfig | null>(null);
  const [selected, setSelected] = useState<Set<ElementKey>>(() => new Set());
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const dragRef = useRef<DragState | null>(null);

  // Reset ghost & selection kalo overlay dimatiin.
  useEffect(() => {
    if (!enabled) {
      setGhost(null);
      setSelected(new Set());
      setGuides({ x: [], y: [] });
      dragRef.current = null;
    }
  }, [enabled]);

  const effective = ghost ?? layout;
  const elements = useMemo(
    () => buildElements(effective, mode, projectNameText, timelineText),
    [effective, mode, projectNameText, timelineText],
  );
  const baseElements = useMemo(
    () => buildElements(layout, mode, projectNameText, timelineText),
    [layout, mode, projectNameText, timelineText],
  );

  const scale = imgRect ? imgRect.width / TEMPLATE_WIDTH_PX : 0;

  // ── Refs untuk handler stabil (Bug A fix) ──
  // Tanpa refs, kalau scale berubah saat drag aktif (window resize, tuner toggle,
  // dialog animation), closure listener masih pakai scale lama → ghost melenceng.
  const layoutRef = useRef(layout);
  const scaleRef = useRef(scale);
  const baseElementsRef = useRef(baseElements);
  const onChangeRef = useRef(onChange);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { baseElementsRef.current = baseElements; }, [baseElements]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Stable handler refs — di-attach sekali, dipakai sampai unmount.
  const moveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const upHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  // rAF throttle (Batch 2 perf): coalesce pointermove ke 60fps biar gak overload
  // re-render saat user drag cepet di trackpad/mouse high-poll-rate.
  const rafIdRef = useRef<number | null>(null);
  const pendingEventRef = useRef<{ clientX: number; clientY: number; altKey: boolean; shiftKey: boolean } | null>(null);

  if (!moveHandlerRef.current) {
    const processMove = (ev: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean }) => {
      const st = dragRef.current;
      if (!st) return;
      const s = scaleRef.current;
      const baseEls = baseElementsRef.current;
      const layoutNow = layoutRef.current;
      const toTpl = (px: number) => (s > 0 ? px / s : 0);
      // ── Inline body (sebelumnya di moveHandlerRef): ──
      if (st.kind === "move") {
        const e = ev;
        const rawDx = toTpl(e.clientX - st.startX);
        const rawDy = toTpl(e.clientY - st.startY);
        const draggedSet = new Set(st.keys);
        const draggedEls = baseEls.filter((el) => draggedSet.has(el.key));
        const others = baseEls.filter((el) => !draggedSet.has(el.key));
        const groupBox = unionBox(draggedEls);
        let dx = rawDx;
        let dy = rawDy;
        let xGuides: number[] = [];
        let yGuides: number[] = [];
        // Snap DEFAULT-ON. Tahan Alt/Option untuk drag bebas (sub-pixel).
        if (groupBox && !e.altKey) {
          const otherBaselines = others
            .filter((el) => TEXT_KEYS.has(el.key))
            .map(elementBaseline);
          const draggedBaselines = draggedEls
            .filter((el) => TEXT_KEYS.has(el.key))
            .map(elementBaseline);
          const snapped = applySnap(
            groupBox, others, rawDx, rawDy,
            draggedBaselines, otherBaselines,
          );
          dx = snapped.dx; dy = snapped.dy;
          xGuides = snapped.xGuides; yGuides = snapped.yGuides;
        }
        setGuides({ x: xGuides, y: yGuides });
        let next = layoutNow;
        const hasBothHotel = st.keys.includes("hotelMakkah") && st.keys.includes("hotelMadinah");
        for (const k of st.keys) {
          const dyForKey = hasBothHotel && k === "hotelMadinah" ? 0 : dy;
          next = applyTranslate(next, k, dx, dyForKey);
        }
        setGhost(next);
      } else {
        const curDx = ev.clientX - st.startX;
        const curDy = ev.clientY - st.startY;
        const signX = st.corner === 1 || st.corner === 2 ? 1 : -1;
        const signY = st.corner === 2 || st.corner === 3 ? 1 : -1;
        const projected = signX * curDx + signY * curDy;
        const newDiagCss = Math.max(8, st.startDiag + projected);
        const ratio = newDiagCss / st.startDiag;
        setGhost(applyResize(layoutNow, st.key, st.startSize * ratio));
      }
    };

    moveHandlerRef.current = (e: PointerEvent) => {
      e.preventDefault();
      // Snapshot field yang dipakai (PointerEvent ter-recycle setelah handler return).
      pendingEventRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
      };
      if (rafIdRef.current !== null) return; // sudah ada frame pending → coalesce
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const ev = pendingEventRef.current;
        pendingEventRef.current = null;
        if (ev && dragRef.current) processMove(ev);
      });
    };
  }
  if (!upHandlerRef.current) {
    upHandlerRef.current = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      if (moveHandlerRef.current) window.removeEventListener("pointermove", moveHandlerRef.current);
      if (upHandlerRef.current) window.removeEventListener("pointerup", upHandlerRef.current);
      // Cancel pending rAF biar gak fire setelah pointer up.
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingEventRef.current = null;
      dragRef.current = null;
      setGuides({ x: [], y: [] });
      setGhost((g) => {
        if (g) onChangeRef.current(g);
        return null;
      });
      e.preventDefault();
    };
  }

  function startMove(e: React.PointerEvent, key: ElementKey) {
    if (!enabled) return;
    e.stopPropagation();
    e.preventDefault();
    const shift = e.shiftKey || e.metaKey || e.ctrlKey;
    // Tentukan selection set baru + keys yg akan di-drag.
    let nextSelected: Set<ElementKey>;
    if (shift) {
      // Shift-click: toggle membership tanpa mulai drag (kecuali kalau
      // setelah toggle elemen ini tetap selected, baru drag group).
      nextSelected = new Set(selected);
      if (nextSelected.has(key)) {
        nextSelected.delete(key);
      } else {
        nextSelected.add(key);
      }
      setSelected(nextSelected);
      // Kalau di-deselect, jangan mulai drag.
      if (!nextSelected.has(key)) return;
    } else if (selected.has(key) && selected.size > 1) {
      // Klik biasa di anggota grup yg sudah selected → drag seluruh grup,
      // selection tidak berubah.
      nextSelected = selected;
    } else {
      // Klik biasa di luar grup → singleton selection.
      nextSelected = new Set([key]);
      setSelected(nextSelected);
    }
    dragRef.current = {
      kind: "move",
      keys: Array.from(nextSelected),
      startX: e.clientX,
      startY: e.clientY,
    };
    if (moveHandlerRef.current) window.addEventListener("pointermove", moveHandlerRef.current);
    if (upHandlerRef.current) window.addEventListener("pointerup", upHandlerRef.current);
  }

  function startResize(
    e: React.PointerEvent,
    key: ElementKey,
    corner: 0 | 1 | 2 | 3,
    currentSize: number,
    cssWidth: number,
    cssHeight: number,
  ) {
    if (!enabled) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(new Set([key]));
    const diag = Math.max(8, Math.hypot(cssWidth, cssHeight));
    dragRef.current = {
      kind: "resize",
      key,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      startSize: currentSize,
      startDiag: diag,
    };
    if (moveHandlerRef.current) window.addEventListener("pointermove", moveHandlerRef.current);
    if (upHandlerRef.current) window.addEventListener("pointerup", upHandlerRef.current);
  }

  // Cleanup global listeners + pending rAF on unmount.
  useEffect(() => {
    return () => {
      if (moveHandlerRef.current) window.removeEventListener("pointermove", moveHandlerRef.current);
      if (upHandlerRef.current) window.removeEventListener("pointerup", upHandlerRef.current);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // ── Keyboard nudging (Batch 2): arrow keys = 1 px, Shift+arrow = 10 px ──
  // Aktif hanya saat overlay enabled + ada elemen terpilih. Skip kalau user
  // lagi ngetik di input/textarea/contenteditable, atau kalau modifier
  // Ctrl/Cmd/Alt aktif (biar gak bentrok dgn shortcut undo/redo & free-move).
  useEffect(() => {
    if (!enabled || selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k !== "ArrowLeft" && k !== "ArrowRight" && k !== "ArrowUp" && k !== "ArrowDown") return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
      const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
      const keys = Array.from(selected);
      const hasBothHotel = keys.includes("hotelMakkah") && keys.includes("hotelMadinah");
      let next = layoutRef.current;
      for (const key of keys) {
        const dyForKey = hasBothHotel && key === "hotelMadinah" ? 0 : dy;
        next = applyTranslate(next, key, dx, dyForKey);
      }
      onChangeRef.current(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, selected]);

  if (!enabled || !imgRect || scale <= 0) return null;

  return (
    <div
      className="absolute z-20"
      style={{
        left: imgRect.left,
        top: imgRect.top,
        width: imgRect.width,
        height: imgRect.height,
        pointerEvents: "none",
      }}
      onPointerDown={() => setSelected(new Set())}
    >
      {/* Snap guide lines — merah, full-width/height, hilang pas drag selesai */}
      {guides.x.map((vx, i) => (
        <div
          key={`gx-${i}`}
          style={{
            position: "absolute",
            left: vx * scale,
            top: 0,
            width: 1,
            height: imgRect.height,
            background: "#ef4444",
            pointerEvents: "none",
            boxShadow: "0 0 4px rgba(239,68,68,0.6)",
            zIndex: 30,
          }}
        />
      ))}
      {guides.y.map((vy, i) => (
        <div
          key={`gy-${i}`}
          style={{
            position: "absolute",
            top: vy * scale,
            left: 0,
            height: 1,
            width: imgRect.width,
            background: "#ef4444",
            pointerEvents: "none",
            boxShadow: "0 0 4px rgba(239,68,68,0.6)",
            zIndex: 30,
          }}
        />
      ))}

      {/* Footer safe-zone guide (Batch 2) — garis dashed amber tipis di Y=960
          template-px. Penanda batas aman supaya checklist gak nubruk kontak
          IG/email IGH Tour. Statis, gak ikut snap, hanya visual. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 960 * scale,
          height: 0,
          borderTop: "1px dashed rgba(217,119,6,0.55)",
          pointerEvents: "none",
          zIndex: 24,
        }}
      >
        <span
          style={{
            position: "absolute",
            right: 4,
            top: -11,
            fontSize: 8,
            fontWeight: 700,
            color: "#92400e",
            background: "rgba(254,243,199,0.92)",
            padding: "0 4px",
            borderRadius: 2,
            border: "1px solid rgba(217,119,6,0.4)",
            lineHeight: "11px",
            letterSpacing: 0.2,
          }}
        >
          ⚠ Batas footer
        </span>
      </div>

      {/* Background catcher — klik di luar elemen → deselect */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: "auto" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          setSelected(new Set());
        }}
      />

      {elements.map((el) => {
        const left = el.xPx * scale;
        const top = el.yPx * scale;
        // Clamp height ke area image biar handle bawah tetep ke-klik
        const maxH = imgRect.height - top - 1;
        const cssW = Math.max(24, el.widthPx * scale);
        const cssH = Math.max(18, Math.min(el.heightPx * scale, maxH));
        // Label auto-flip (Batch 2): kalau elemen terlalu mepet ke top image,
        // pindahkan label ke bawah bbox supaya gak ke-clip.
        const labelBelow = top < 16;
        const isSelected = selected.has(el.key);
        const draggingState = dragRef.current;
        const isDragging =
          ghost !== null &&
          draggingState !== null &&
          ((draggingState.kind === "move" && draggingState.keys.includes(el.key)) ||
            (draggingState.kind === "resize" && draggingState.key === el.key));
        return (
          <div
            key={el.key}
            className={`absolute group ${
              isSelected
                ? "ring-1 ring-blue-500"
                : "ring-1 ring-blue-300/0 hover:ring-blue-400/60"
            }`}
            style={{
              left,
              top,
              width: cssW,
              height: cssH,
              pointerEvents: "auto",
              cursor: isSelected ? "move" : "pointer",
              background: isSelected
                ? "rgba(59,130,246,0.05)"
                : "rgba(59,130,246,0.0)",
              borderRadius: 2,
              transition: "background 120ms",
              boxShadow: isDragging ? "0 6px 14px rgba(15,23,42,0.16)" : undefined,
              opacity: isDragging ? 0.85 : 1,
            }}
            onPointerDown={(e) => startMove(e, el.key)}
          >
            {/* Label tag — kecil, auto-flip ke bawah jika terlalu mepet top image. */}
            <span
              className={`absolute left-0 inline-flex items-center h-3 px-1 rounded-sm text-[8px] font-bold whitespace-nowrap select-none ${
                isSelected
                  ? "bg-blue-600 text-white"
                  : "bg-white/95 border border-blue-200 text-blue-700 opacity-0 group-hover:opacity-100"
              }`}
              style={{
                pointerEvents: "none",
                transition: "opacity 120ms",
                ...(labelBelow ? { top: cssH + 2 } : { top: -14 }),
              }}
            >
              {el.label}
              {isSelected && (
                <span className="ml-1 font-normal opacity-80">· {Math.round(el.size)}pt</span>
              )}
            </span>

            {/* Resize handles 4 sudut — cuma muncul saat single selection */}
            {isSelected && selected.size === 1 &&
              ([0, 1, 2, 3] as const).map((corner) => {
                const positions = [
                  { left: -3, top: -3, cursor: "nwse-resize" },
                  { right: -3, top: -3, cursor: "nesw-resize" },
                  { right: -3, bottom: -3, cursor: "nwse-resize" },
                  { left: -3, bottom: -3, cursor: "nesw-resize" },
                ] as const;
                const p = positions[corner];
                return (
                  <span
                    key={corner}
                    onPointerDown={(e) => startResize(e, el.key, corner, el.size, cssW, cssH)}
                    style={{
                      position: "absolute",
                      width: 7,
                      height: 7,
                      background: "white",
                      border: "1.25px solid #2563eb",
                      borderRadius: 2,
                      cursor: p.cursor,
                      pointerEvents: "auto",
                      ...p,
                    }}
                  />
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

export { TEMPLATE_WIDTH_PX, TEMPLATE_HEIGHT_PX };
