/**
 * Konfigurasi koordinat untuk generator PDF IGH.
 * Dipakai oleh `generateIghPdf.ts` dan komponen `PdfLayoutTuner` untuk
 * tuning visual real-time tanpa edit kode.
 *
 * Semua koordinat dalam "template space" 740-px wide (top-left origin).
 */

export type IghFontFamily = "Montserrat" | "Poppins" | "Sk-Modernist";
/** Horizontal text alignment relative to the slider X coordinate.
 *  - "center" (default): X = horizontal center of the text
 *  - "left":            X = left edge (start) of the text
 *  - "right":           X = right edge (end) of the text */
export type IghTextAlign = "left" | "center" | "right";

/** Mata uang yang dipakai utk render harga di PDF. Independent dari
 *  display currency di kalkulator — kalau beda, generator otomatis konversi
 *  pakai exchange rate yang dibawa data paket. */
export type IghPdfCurrency = "USD" | "IDR" | "SAR";
export type IghSection =
  | "projectName"
  | "metaInfo"
  | "pricing"
  | "groupPricing"
  | "checklist"
  | "hotel"
  | "footer"
  | "pricingNote";

/** URL dari tiap weight per family. Semua di-load via fontkit pdf-lib. */
export const FONT_FAMILY_URLS: Record<IghFontFamily, { regular: string; semiBold: string; bold: string }> = {
  Montserrat: {
    regular: "/fonts/Montserrat-Regular.ttf",
    semiBold: "/fonts/Montserrat-SemiBold.ttf",
    bold: "/fonts/Montserrat-Bold.ttf",
  },
  Poppins: {
    regular: "/fonts/Poppins-Regular.ttf",
    semiBold: "/fonts/Poppins-SemiBold.ttf",
    bold: "/fonts/Poppins-Bold.ttf",
  },
  "Sk-Modernist": {
    regular: "/fonts/Sk-Modernist-Regular.otf",
    // Sk-Modernist tidak punya SemiBold — fallback ke Bold.
    semiBold: "/fonts/Sk-Modernist-Bold.otf",
    bold: "/fonts/Sk-Modernist-Bold.otf",
  },
};

export interface IghLayoutConfig {
  projectName: {
    /** X (top-left, template px). Interpretasinya tergantung `align`:
     *   - "left"   → X = batas kiri tiap baris (default, kompat lama)
     *   - "center" → X = titik tengah horizontal tiap baris
     *   - "right"  → X = batas kanan tiap baris */
    xPx: number;
    /** Y (top-left, template px) baris pertama */
    topPx: number;
    /** Font size awal (auto-shrink kalau kepanjangan) */
    size: number;
    /** Jarak vertikal absolut (px) antar baris bila project name multi-line */
    lineGapPx: number;
    /** Override teks. Kosong = pakai data dari kalkulator.
     *  Mendukung manual line break (\n) — tiap baris di-render terpisah. */
    text?: string;
    /** Horizontal alignment tiap baris judul. Default "left" supaya preset
     *  lama (yg belum punya field ini) tetap render identik. */
    align?: IghTextAlign;
  };
  metaInfo: {
    /** X invoice/customer */
    customerXPx: number;
    /** X tanggal */
    dateXPx: number;
    /** Y default untuk kedua field (legacy single-Y). Dipakai sebagai fallback
     *  kalau `customerYPx` / `dateYPx` belum di-set. */
    topPx: number;
    /** Y independen untuk Invoice/Customer. Undefined = pakai `topPx`. */
    customerYPx?: number;
    /** Y independen untuk Date. Undefined = pakai `topPx`. */
    dateYPx?: number;
    /** Font size */
    size: number;
    /** Override teks */
    customerText?: string;
    dateText?: string;
  };
  hotel: {
    /** X kolom Makkah */
    makkahXPx: number;
    /** X kolom Madinah */
    madinahXPx: number;
    /** Y nama hotel */
    topPx: number;
    /** Font size nama hotel */
    size: number;
    /** Jarak vertikal (px) dari nama hotel ke subtitle "X Malam".
     *  Subtitle digambar di topPx + subtitleOffsetPx, jadi saat nama hotel
     *  digeser (drag), subtitle ikut bergeser proporsional. */
    subtitleOffsetPx: number;
    /** Override teks */
    makkahText?: string;
    madinahText?: string;
    /** Override label header (misal: "HOTEL KAIRO" / "HOTEL 1") */
    makkahHeader?: string;
    madinahHeader?: string;
  };
  pricing: {
    /** X kotak Pax */
    paxXPx: number;
    /** X kotak Harga */
    priceXPx: number;
    /** Y top kotak (kedua kotak sejajar) */
    topPx: number;
    /** Font size harga (pax akan +4) */
    size: number;
    /** Vertical center offset (pdf-units). Negatif = naik, positif = turun. */
    yOffsetPdf: number;
    /** Override teks */
    paxText?: string;
    priceText?: string;
  };
  /** Group pricing table (template `IGH_Blank_Template_Group.pdf`).
   *  4 kolom: Total Pax | Quad | Triple | Double, multi-row stacked vertical. */
  groupPricing: {
    /** Y baris pertama (top-px). */
    topPx: number;
    /** Jarak vertikal antar baris (px). */
    rowSpacingPx: number;
    /** X center kolom Total Pax. */
    paxCenterXPx: number;
    /** X center kolom Quad. */
    quadCenterXPx: number;
    /** X center kolom Triple. */
    tripleCenterXPx: number;
    /** X center kolom Double. */
    doubleCenterXPx: number;
    /** X-offset independen per kolom harga (px). */
    quadXOffsetPx: number;
    tripleXOffsetPx: number;
    doubleXOffsetPx: number;
    /** Tinggi virtual cell utk true vertical centering (px). */
    cellHeightPx: number;
    /** Font size text harga / pax. */
    size: number;
    /** Currency symbol prefix (mis. "$" atau "Rp"). */
    currencySymbol: string;
  };
  checklist: {
    /** X column kiri (Sudah) — tengah kolom */
    leftXPx: number;
    /** X column kanan (Belum) — tengah kolom */
    rightXPx: number;
    /** Baseline (top-px) row pertama (digit "01") */
    firstBaselinePx: number;
    /** Jarak antar baris (px) */
    rowSpacingPx: number;
    /** Y offset untuk geser teks ke atas/bawah supaya pas di tengah dua garis */
    yOffsetPx: number;
    /** Font size item teks */
    size: number;
    /** Override teks (newline-separated, max 5 baris) */
    includedText?: string;
    excludedText?: string;
    /** Horizontal alignment of "Sudah Termasuk" text relative to `leftXPx`.
     *  Default "center" (back-compat: existing presets continue to render
     *  centered around the slider X). */
    sudahTermasukAlign?: IghTextAlign;
    /** Horizontal alignment of "Belum Termasuk" text relative to `rightXPx`.
     *  Default "center". */
    belumTermasukAlign?: IghTextAlign;
    /** Simbol bullet yang otomatis dipasang di depan tiap baris checklist
     *  (Sudah / Belum Termasuk). Default "•". String kosong = tidak ada bullet
     *  (back-compat utk preset lama yang gak punya field ini → tetap dapat
     *  default "•" via mergeConfig). */
    listBullet?: string;
  };
  fonts: {
    /** Default family untuk semua section (kecuali yg di-override) */
    family: IghFontFamily;
    /** Override per section. Kalau null/undefined → pakai `family`. */
    overrides?: Partial<Record<IghSection, IghFontFamily>>;
  };
  /** Custom background template — override file template default (private/group).
   *  Bisa PDF (1 halaman, ukuran sama dgn template asli) atau gambar (PNG/JPG)
   *  yang di-render full-bleed sebagai background page baru.
   *  null/undefined = pakai template default IGH (`/igh-blank-template.pdf` atau
   *  `/templates/IGH_Blank_Template_Group.pdf`). */
  customTemplate?: {
    /** Public URL ke file di Supabase Storage (`pdf-templates` bucket). */
    url: string;
    /** Tipe file — menentukan cara render di pdf-lib. */
    type: "pdf" | "image";
    /** Original filename buat ditampilin di UI. */
    name: string;
    /** Storage path buat cleanup saat di-replace/reset (`{agency_id}/{file}`). */
    storagePath: string;
    /** Timestamp upload (ms) buat ditampilin di UI. */
    uploadedAt: number;
  } | null;
  /** Mata uang yang dipakai render harga di PDF (matrix grup + box harga
   *  private). Default "USD". Kalau beda dengan source unit di data paket,
   *  generator otomatis konversi via `kursIdrPerUsd` / `kursIdrPerSar`. */
  pdfCurrency?: IghPdfCurrency;
  /** Footer kontak admin — IG handle sudah pre-printed di template,
   *  WA di-render programmatic (icon + nomor + clickable link annotation). */
  footer: {
    /** Y baseline (top-px) sejajar dengan teks instagram pada template. */
    topPx: number;
    /** X kiri elemen WA (icon green circle). Tune kalau mau geser kiri/kanan. */
    waXPx: number;
    /** Diameter icon WA (pt PDF, bukan template-px). */
    waIconSizePt: number;
    /** Font size nomor WA (pt PDF). */
    size: number;
    /** Tampilkan WA di footer. False = matiin elemen WA tanpa hapus dari config. */
    showWhatsapp: boolean;
  };
  /** Posisi WhatsApp icon + nomor (template-px, top-left origin).
   *  Override `footer.waXPx` & `footer.topPx` legacy bila ada. Dibikin field
   *  terpisah supaya bisa di-drag mandiri dari Edit Mode tanpa nyentuh
   *  field footer lainnya (font size, icon size, dst). Optional → preset
   *  lama yang belum punya field ini tetap dirender pakai legacy values. */
  whatsappPosition?: {
    xPx: number;
    yPx: number;
  };
  /** Jarak vertikal (template-px) antara baris terakhir Project Name dengan
   *  baris timeline/tanggal di bawahnya ("21 Mei 2026 - 29 Mei 2026 (9 hari)").
   *  Default baru = 25. Legacy preset yg belum punya field ini fallback ke
   *  `headerSubtitleGap`, lalu ke 6 (hardcoded lama) supaya tampilan lama
   *  tetap persis sama.
   *
   *  Field ini menggantikan `headerSubtitleGap` (deprecated). Generator &
   *  tuner sudah pakai `mainHeaderGap` sebagai sumber utama; field lama
   *  cuma dipakai sebagai fallback baca-saja untuk preset yg belum migrasi. */
  mainHeaderGap?: number;
  /** @deprecated Pakai `mainHeaderGap`. Field lama, di-keep untuk
   *  backward-compat saat baca preset/storage lama. */
  headerSubtitleGap?: number;
  /** Offset fine-tune posisi timeline subtitle (delta dari posisi yg dihitung
   *  via `headerSubtitleGap`). Buat geser mandiri kalau title-nya 2 baris atau
   *  butuh nudge halus. Default {0,0}. */
  headerSubtitleOffset?: {
    xPx: number;
    yPx: number;
  };
  /** Lebar (template-px) bounding box subtitle "Tanggal" di bawah Project Name.
   *  Dipakai sebagai `maxWidthPx` di generator: kalau teks kepanjangan, di-wrap
   *  ke baris berikutnya (multi-line) sebelum di-truncate. Juga dipakai sebagai
   *  lebar bbox biru di Edit Mode supaya visual sinkron dgn output PDF.
   *  Default 285 (kompat lama, sebelumnya hardcoded). Range UI: 100..600. */
  subtitleWidthPx?: number;
  /** Ukuran font (pt) utk teks subtitle "Tanggal" di bawah Project Name.
   *  Dipakai oleh generator (drawing) DAN overlay (bbox sizing) supaya Edit
   *  Mode visual sinkron 1:1 dgn output PDF. Default 11pt (kompat lama,
   *  sebelumnya hardcoded `SUBTITLE_PT = 11`). Range UI: 6..14. */
  subtitleFontSize?: number;
  /** Format tampilan tanggal pada subtitle.
   *  - `"Full"`  → "01 September 2026 - 09 September 2026 (9 hari)" (lengkap).
   *  - `"Short"` (default) → "01 - 09 Sep 2026 (9 hari)" / "01 Sep - 03 Okt 2026"
   *    (ringkas, hemat ruang biar gak kepotong di subtitle width).
   *  Cuma berlaku kalau Calculator nge-pass `timelineShort` (built dari
   *  range tanggal real). Kalau cuma punya 1 string `timeline` legacy,
   *  generator pakai itu apa adanya. */
  dateDisplayMode?: "Full" | "Short";
  /** Format tampilan harga di tabel matrix & box harga.
   *  - `"compact"` (default) → ringkas pakai satuan: "30,5 jt", "1,2 M".
   *  - `"full"` → nominal lengkap dengan ribuan: "Rp 30.123.456".
   *  Cuma berlaku utk currency IDR. USD/SAR selalu pakai en-US lengkap.
   *  Field opsional → preset lama yang belum punya field ini fallback ke
   *  `"compact"` supaya tampilan default tetap sama. */
  priceDisplayMode?: "full" | "compact";
  /** Posisi, ukuran, dan alignment Catatan Tambahan (Pricing Note) di PDF. */
  pricingNote?: {
    xPx: number;
    topPx: number;
    size: number;
    align?: IghTextAlign;
    maxWidthPx?: number;
  };
}

export const DEFAULT_IGH_LAYOUT: IghLayoutConfig = {
  projectName: { xPx: 55, topPx: 257, size: 18, lineGapPx: 2 },
  metaInfo: { customerXPx: 335, dateXPx: 538, topPx: 259, size: 11 },
  hotel: { makkahXPx: 51, madinahXPx: 407, topPx: 395, size: 16, subtitleOffsetPx: 32 },
  pricing: { paxXPx: 47, priceXPx: 272, topPx: 518, size: 22, yOffsetPdf: -8 },
  groupPricing: {
    topPx: 510,
    rowSpacingPx: 28,
    paxCenterXPx: 95,
    quadCenterXPx: 280,
    tripleCenterXPx: 465,
    doubleCenterXPx: 650,
    quadXOffsetPx: 0,
    tripleXOffsetPx: 0,
    doubleXOffsetPx: 0,
    cellHeightPx: 24,
    size: 14,
    currencySymbol: "$",
  },
  checklist: {
    leftXPx: 212,   // tengah kolom kiri (95 + 235/2)
    rightXPx: 576,  // tengah kolom kanan (459 + 235/2)
    firstBaselinePx: 715,
    rowSpacingPx: 28,
    yOffsetPx: 0,
    size: 9,
    sudahTermasukAlign: "center",
    belumTermasukAlign: "center",
    listBullet: "•",
  },
  fonts: { family: "Poppins", overrides: {} },
  pdfCurrency: "USD",
  // Footer (sejajar dengan "instagram.com/igh.tour" pre-printed pada template).
  // Instagram di template ada di template-px ~75..198 (kiri), email ~526..668
  // (kanan). WA di-tengahin di antara keduanya: starts ~310px, baseline 891.
  footer: { topPx: 891, waXPx: 290, waIconSizePt: 9, size: 7, showWhatsapp: true },
  whatsappPosition: { xPx: 290, yPx: 891 },
  mainHeaderGap: 8,
  headerSubtitleOffset: { xPx: 0, yPx: 0 },
  subtitleWidthPx: 285,
  subtitleFontSize: 9,
  dateDisplayMode: "Short",
  priceDisplayMode: "compact",
  pricingNote: { xPx: 53, topPx: 632, size: 7.5, align: "left", maxWidthPx: 646 },
};

const STORAGE_KEY = "igh:pdf-layout-config";
const PRESETS_CACHE_KEY = "igh:pdf-layout-presets-cache";

export interface IghLayoutPreset {
  id: string;
  name: string;
  config: IghLayoutConfig;
  createdAt: number;
  updatedAt: number;
  /** Built-in preset (read-only safety net). Tidak disimpan di cloud. */
  builtin?: boolean;
  /** Mode template preset ini dirancang untuk. `undefined` = legacy/universal
   *  (preset lama sebelum kolom mode diintroduce; ditampilkan di kedua mode). */
  mode?: IghLayoutMode;
}

/** Built-in preset yang selalu tersedia — safety net kalau cloud kosong. */
export const BUILTIN_PRESET: IghLayoutPreset = {
  id: "builtin:igh-official-default",
  name: "IGH Official Default",
  config: DEFAULT_IGH_LAYOUT,
  createdAt: 0,
  updatedAt: 0,
  builtin: true,
  mode: "private",
};

/** Layout 1:1 dengan template `IGH_Blank_Template_Group.pdf` (kicau.jpg).
 *  Project name di atas, Date kiri / Invoice kanan, hotel Makkah/Madinah
 *  sejajar baris label, tabel 4 kolom centered di divider asli template,
 *  checklist sejajar nomor 01..05. Semua font Poppins, warna data ORANGE. */
export const GROUP_LAYOUT: IghLayoutConfig = {
  projectName: { xPx: 55, topPx: 90, size: 20, lineGapPx: 2 },
  // Group template: Date di kiri, Invoice to di kanan (kebalik dari Private)
  metaInfo: { customerXPx: 365, dateXPx: 55, topPx: 273, size: 11 },
  hotel: { makkahXPx: 55, madinahXPx: 384, topPx: 343, size: 16, subtitleOffsetPx: 32 },
  // Pricing private boxes tidak dipakai di group mode — biarin default.
  pricing: { paxXPx: 47, priceXPx: 272, topPx: 518, size: 22, yOffsetPdf: -8 },
  groupPricing: {
    topPx: 440,
    rowSpacingPx: 28,
    // Column centers diukur dari divider tabel asli (36/215/397/555/706).
    paxCenterXPx: 126,
    quadCenterXPx: 306,
    tripleCenterXPx: 476,
    doubleCenterXPx: 631,
    quadXOffsetPx: 0,
    tripleXOffsetPx: 0,
    doubleXOffsetPx: 0,
    cellHeightPx: 24,
    size: 14,
    currencySymbol: "$",
  },
  checklist: {
    leftXPx: 200,
    rightXPx: 542,
    firstBaselinePx: 775,
    rowSpacingPx: 26,
    yOffsetPx: 0,
    size: 9,
    sudahTermasukAlign: "center",
    belumTermasukAlign: "center",
    listBullet: "•",
  },
  fonts: { family: "Poppins", overrides: {} },
  pdfCurrency: "USD",
  // Group template footer kemungkinan beda posisi — default sama dulu, bisa
  // di-tune via PdfLayoutTuner per-mode storage.
  footer: { topPx: 891, waXPx: 290, waIconSizePt: 9, size: 7, showWhatsapp: true },
  whatsappPosition: { xPx: 290, yPx: 891 },
  mainHeaderGap: 8,
  headerSubtitleOffset: { xPx: 0, yPx: 0 },
  subtitleWidthPx: 285,
  subtitleFontSize: 9,
  dateDisplayMode: "Short",
  priceDisplayMode: "compact",
  pricingNote: { xPx: 53, topPx: 632, size: 7.5, align: "left", maxWidthPx: 646 },
};

/** Built-in starter buat template Grup, dikalibrasi 1:1 ke kicau.jpg.
 *  User bisa Save as New ke cloud dengan nama lain (mis. "Grup Standard Standard"). */
export const BUILTIN_GROUP_PRESET: IghLayoutPreset = {
  id: "builtin:igh-grup-standard",
  name: "Grup Standard",
  config: GROUP_LAYOUT,
  createdAt: 0,
  updatedAt: 0,
  builtin: true,
  mode: "group",
};

export const BUILTIN_PRESETS: IghLayoutPreset[] = [BUILTIN_PRESET, BUILTIN_GROUP_PRESET];

/** Cache lokal (cepat, sinkron) — diisi ulang dari cloud setiap kali pull. */
export function loadPresetsCache(): IghLayoutPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as IghLayoutPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.config)
      .map((p) => ({ ...p, config: mergeConfig(DEFAULT_IGH_LAYOUT, p.config) }));
  } catch {
    return [];
  }
}

export function savePresetsCache(presets: IghLayoutPreset[]) {
  try {
    localStorage.setItem(PRESETS_CACHE_KEY, JSON.stringify(presets.filter((p) => !p.builtin)));
  } catch {
    /* noop */
  }
}

/** Susun list yang ditampilkan di UI: built-in di atas, lalu cloud presets.
 *  Kalau `mode` di-pass, list di-filter:
 *  - built-in dengan mode mismatch → disembunyiin (cuma yg match yg muncul)
 *  - cloud preset dengan mode mismatch → disembunyiin
 *  - cloud preset legacy (mode === undefined) → ditampilin di kedua mode (back-compat) */
export function withBuiltins(
  presets: IghLayoutPreset[],
  mode?: IghLayoutMode,
): IghLayoutPreset[] {
  const cloud = presets.filter((p) => !p.builtin);
  const builtins = mode
    ? BUILTIN_PRESETS.filter((p) => p.mode === mode)
    : BUILTIN_PRESETS;
  const filteredCloud = mode
    ? cloud.filter((p) => p.mode === undefined || p.mode === mode)
    : cloud;
  return [...builtins, ...filteredCloud];
}

export type IghLayoutMode = "private" | "group";

const MODE_STORAGE_KEYS: Record<IghLayoutMode, string> = {
  private: STORAGE_KEY,
  group: "igh:pdf-layout-config-group",
};

const MODE_DEFAULTS: Record<IghLayoutMode, IghLayoutConfig> = {
  private: DEFAULT_IGH_LAYOUT,
  group: GROUP_LAYOUT,
};

/** Load layout untuk mode tertentu. Per-mode storage biar tuning Grup
 *  ga ngerusak preset Private (dan sebaliknya). */
export function loadIghLayoutConfig(mode: IghLayoutMode = "private"): IghLayoutConfig {
  const def = MODE_DEFAULTS[mode];
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEYS[mode]);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<IghLayoutConfig>;
    return mergeConfig(def, parsed);
  } catch {
    return def;
  }
}

export function saveIghLayoutConfig(cfg: IghLayoutConfig, mode: IghLayoutMode = "private") {
  try {
    localStorage.setItem(MODE_STORAGE_KEYS[mode], JSON.stringify(cfg));
  } catch {
    /* noop */
  }
}

export function mergeConfig(
  base: IghLayoutConfig,
  override?: Partial<IghLayoutConfig>,
): IghLayoutConfig {
  if (!override) return base;
  return {
    projectName: { ...base.projectName, ...(override.projectName ?? {}) },
    metaInfo: { ...base.metaInfo, ...(override.metaInfo ?? {}) },
    hotel: { ...base.hotel, ...(override.hotel ?? {}) },
    pricing: { ...base.pricing, ...(override.pricing ?? {}) },
    groupPricing: { ...base.groupPricing, ...(override.groupPricing ?? {}) },
    checklist: { ...base.checklist, ...(override.checklist ?? {}) },
    footer: { ...base.footer, ...(override.footer ?? {}) },
    fonts: {
      ...base.fonts,
      ...(override.fonts ?? {}),
      overrides: {
        ...(base.fonts.overrides ?? {}),
        ...(override.fonts?.overrides ?? {}),
      },
    },
    // customTemplate adalah object atomik — override penuh, bukan shallow merge
    // (karena url/type/path saling tergantung). undefined = inherit dari base.
    customTemplate:
      "customTemplate" in (override as object)
        ? (override as { customTemplate?: IghLayoutConfig["customTemplate"] }).customTemplate ?? null
        : base.customTemplate ?? null,
    // pdfCurrency: scalar override. Kalau override punya field (termasuk
    // explicitly undefined utk reset → fallback "USD"), pakai itu.
    pdfCurrency:
      "pdfCurrency" in (override as object)
        ? (override as { pdfCurrency?: IghPdfCurrency }).pdfCurrency ?? base.pdfCurrency ?? "USD"
        : base.pdfCurrency ?? "USD",
    // Header gap & timeline subtitle offset — scalar/atomik. Override penuh
    // kalau ada di payload, fallback ke base. Wajib di-carry biar tuning
    // user gak hilang setelah reload (mergeConfig dipanggil di loadPresetsCache
    // dan loadIghLayoutConfig).
    mainHeaderGap:
      override.mainHeaderGap ?? base.mainHeaderGap ?? base.headerSubtitleGap,
    headerSubtitleGap:
      override.headerSubtitleGap ?? base.headerSubtitleGap,
    headerSubtitleOffset: override.headerSubtitleOffset
      ? { ...(base.headerSubtitleOffset ?? { xPx: 0, yPx: 0 }), ...override.headerSubtitleOffset }
      : base.headerSubtitleOffset,
    // subtitleWidthPx: scalar override. Preset lama yg belum punya field ini
    // fallback ke base (default 285) → tampilan lama tetap identik.
    subtitleWidthPx:
      "subtitleWidthPx" in (override as object)
        ? (override as { subtitleWidthPx?: number }).subtitleWidthPx ?? base.subtitleWidthPx ?? 285
        : base.subtitleWidthPx ?? 285,
    // subtitleFontSize: scalar override. Default 11 (kompat dgn legacy
    // hardcoded SUBTITLE_PT). Range valid 6..14 (di-clamp di Tuner UI, bukan
    // di sini, supaya preset cloud yg edit manual bisa pake nilai apapun).
    subtitleFontSize:
      "subtitleFontSize" in (override as object)
        ? (override as { subtitleFontSize?: number }).subtitleFontSize ?? base.subtitleFontSize ?? 11
        : base.subtitleFontSize ?? 11,
    // dateDisplayMode: scalar override. Default "Short" (compact) supaya teks
    // tanggal default-nya gak kepotong. Preset lama yg belum punya field ini
    // tetap dapet "Short" by default → tampilan SUBTLY berubah jd lebih ringkas
    // (acceptable trade-off vs truncated text).
    dateDisplayMode:
      "dateDisplayMode" in (override as object)
        ? (override as { dateDisplayMode?: "Full" | "Short" }).dateDisplayMode ?? base.dateDisplayMode ?? "Short"
        : base.dateDisplayMode ?? "Short",
    whatsappPosition: override.whatsappPosition
      ? { ...(base.whatsappPosition ?? { xPx: 0, yPx: 0 }), ...override.whatsappPosition }
      : base.whatsappPosition,
    // priceDisplayMode: scalar override. Kalau override punya field, pakai itu;
    // kalau enggak, fallback ke base. Default global = "compact" supaya preset
    // lama yg belum punya field ini tetap render dgn satuan ringkas.
    priceDisplayMode:
      "priceDisplayMode" in (override as object)
        ? (override as { priceDisplayMode?: "full" | "compact" }).priceDisplayMode ?? base.priceDisplayMode ?? "compact"
        : base.priceDisplayMode ?? "compact",
    pricingNote: override.pricingNote
      ? { ...(base.pricingNote ?? { xPx: 53, topPx: 632, size: 7.5, align: "left", maxWidthPx: 646 }), ...override.pricingNote }
      : base.pricingNote ?? { xPx: 53, topPx: 632, size: 7.5, align: "left", maxWidthPx: 646 },
  };
}
