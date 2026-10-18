import { resolveWhatsappPosition, type IghLayoutConfig, type IghLayoutMode } from "./ighPdfConfig";
import { formatWhatsappDisplay, loadIghAdminSettings } from "./ighSettings";

let measureCtx: CanvasRenderingContext2D | null = null;

/** Lebar nomor WA (pt) pada `footer.size` — estimasi canvas, cukup dekat dgn
 *  pdf-lib buat posisi auto-tengah di Tuner & Edit Mode. */
export function waNumberWidthPt(layout: IghLayoutConfig): number {
  const text = formatWhatsappDisplay(loadIghAdminSettings().adminWhatsapp) || "+62 800-0000-0000";
  if (!measureCtx && typeof document !== "undefined") {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  // Rata-rata lebar glyph nomor WA di Poppins SemiBold ≈ 0.566em (diukur dari PDF).
  const estimate = text.length * layout.footer.size * 0.566;
  if (!measureCtx) return estimate;
  const font = `600 ${layout.footer.size}px Poppins`;
  // Font web belum ke-load → canvas pakai font fallback (lebar beda). Pakai
  // estimasi dulu & minta browser load Poppins buat pengukuran berikutnya.
  if (typeof document !== "undefined" && document.fonts && !document.fonts.check(font)) {
    void document.fonts.load(font);
    return estimate;
  }
  measureCtx.font = `${font}, "Helvetica Neue", Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

/** Posisi WA efektif (template-px) persis seperti yg dipakai generator —
 *  termasuk mode auto-tengah selama posisi masih default. */
export function effectiveWhatsappPosition(layout: IghLayoutConfig, mode: IghLayoutMode = "private") {
  return resolveWhatsappPosition(layout, waNumberWidthPt(layout), mode);
}
