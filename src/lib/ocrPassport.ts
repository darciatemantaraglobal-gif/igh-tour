import type { Worker as TesseractWorker } from "tesseract.js";
import { supabase } from "./supabase";

/* ────────────────────────────── Reusable Tesseract worker pool ──────────────
 * createWorker() butuh ~600-1200 ms (download core+traineddata, init API).
 * Sebelumnya: 1 worker dibuat & di-terminate per scanPassport() call → tiap
 * foto kena init cost penuh. Untuk Bulk OCR (dialog spawn 4 paralel), ini
 * artinya 4 init paralel SETIAP foto.
 *
 * Sekarang: pool berisi N worker yang dibuat lazy on first lease, dan
 * di-reuse antar scanPassport() call. Lease()/release() serialize akses ke
 * tiap worker sehingga setParameters/recognize aman walaupun banyak caller
 * paralel.
 *
 * Hemat ~30-40% wall-time di Bulk OCR (init cost ter-amortisasi).
 */

const POOL_SIZE = 4;

interface PooledWorker {
  worker: TesseractWorker;
  /** Logger yang dipakai untuk recognize() yang sedang berjalan. Diset
   *  per-lease karena createWorker hanya menerima logger sekali (saat init). */
  setLogger: (fn: ((m: { status?: string; progress?: number }) => void) | null) => void;
}

const _pooled: PooledWorker[] = [];
const _idle: PooledWorker[] = [];
const _waiters: Array<(w: PooledWorker) => void> = [];
let _creatingCount = 0;

async function createPooledWorker(): Promise<PooledWorker> {
  let activeLogger: ((m: { status?: string; progress?: number }) => void) | null = null;
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (activeLogger) activeLogger(m);
    },
  });
  const pw: PooledWorker = {
    worker,
    setLogger: (fn) => {
      activeLogger = fn;
    },
  };
  _pooled.push(pw);
  return pw;
}

async function leaseWorker(): Promise<PooledWorker> {
  // Ada idle? langsung pakai.
  const idle = _idle.shift();
  if (idle) return idle;
  // Belum mencapai POOL_SIZE? bikin baru.
  if (_pooled.length + _creatingCount < POOL_SIZE) {
    _creatingCount++;
    try {
      const pw = await createPooledWorker();
      return pw;
    } finally {
      _creatingCount--;
    }
  }
  // Pool full → tunggu giliran.
  return new Promise<PooledWorker>((resolve) => {
    _waiters.push(resolve);
  });
}

function releaseWorker(pw: PooledWorker) {
  pw.setLogger(null);
  const next = _waiters.shift();
  if (next) {
    next(pw);
  } else {
    _idle.push(pw);
  }
}

/**
 * Terminate semua worker di pool. Panggil saat sesi OCR batch selesai
 * (mis. setelah Bulk OCR Dialog ditutup) untuk free memory Tesseract WASM.
 * Idempotent — aman dipanggil berkali-kali.
 */
export async function disposeOcrWorkerPool(): Promise<void> {
  // Hanya boleh dispose kalau tidak ada worker yg sedang dipakai.
  if (_pooled.length !== _idle.length) {
    // Ada worker yang masih leased — biarkan, jangan terminate paksa.
    return;
  }
  const toKill = _pooled.splice(0, _pooled.length);
  _idle.length = 0;
  await Promise.all(
    toKill.map((pw) =>
      pw.worker
        .terminate()
        .catch((e) => console.warn("[ocr-pool] terminate failed", e)),
    ),
  );
}

export interface PassportData {
  name?: string;
  passportNumber?: string;
  nationality?: string;
  birthDate?: string;
  expiryDate?: string;
  gender?: "L" | "P";
  checksums?: {
    passportNumber: boolean;
    birthDate: boolean;
    expiryDate: boolean;
    composite: boolean;
  };
  mrzValid?: boolean;
  /** "tesseract" (gratis, lokal) atau "openai" (fallback AI berbayar) */
  source?: "tesseract" | "openai";
}

/* ────────────────────────────── ICAO 9303 helpers ────────────────────────────── */

function mrzCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const ch = field[i];
    let v = 0;
    if (ch >= "0" && ch <= "9") v = ch.charCodeAt(0) - 48;
    else if (ch >= "A" && ch <= "Z") v = ch.charCodeAt(0) - 55;
    else v = 0;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

function checkField(field: string, expectedChar: string): boolean {
  if (!/^\d$/.test(expectedChar)) return false;
  return mrzCheckDigit(field) === Number(expectedChar);
}

export function countPassportDataFields(p: PassportData): number {
  const dataKeys: (keyof PassportData)[] = [
    "name",
    "passportNumber",
    "nationality",
    "birthDate",
    "expiryDate",
    "gender",
  ];
  return dataKeys.filter((k) => p[k] != null && p[k] !== "").length;
}

export function failedChecksumLabels(p: PassportData): string[] {
  if (!p.checksums) return [];
  const labels: Record<keyof NonNullable<PassportData["checksums"]>, string> = {
    passportNumber: "No. Paspor",
    birthDate: "Tgl Lahir",
    expiryDate: "Tgl Expired",
    composite: "Komposit",
  };
  return (Object.keys(p.checksums) as (keyof typeof labels)[])
    .filter((k) => !p.checksums![k])
    .map((k) => labels[k]);
}

/* ────────────────────────────── Progress mapping ────────────────────────────── */

function mapProgress(status: string, rawProgress: number): number {
  const p = Math.max(0, Math.min(1, rawProgress));
  switch (status) {
    case "loading tesseract core":
      return Math.round(p * 8);
    case "initializing tesseract":
      return Math.round(8 + p * 4);
    case "loading language traineddata":
      return Math.round(12 + p * 12);
    case "initializing api":
      return Math.round(24 + p * 4);
    case "recognizing text":
      return Math.round(28 + p * 70);
    default:
      return Math.round(p * 28);
  }
}

/* ────────────────────────────── File → DataURL ────────────────────────────── */

function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/* ────────────────────────────── Image preprocessing ────────────────────────────── */

/**
 * Otsu's method — finds the optimal threshold from the image histogram.
 * Far more robust than a fixed 127 cutoff for varied lighting.
 */
function otsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Crop bottom `cropFrac` of the image, binarize with Otsu, scale 2×.
 * Returns a high-contrast PNG ideal for Tesseract MRZ recognition.
 */
async function preprocessForMRZ(
  img: HTMLImageElement,
  cropFrac: number,
  thresholdOffset = 0
): Promise<string> {
  const cropH = Math.round(img.height * cropFrac);
  const cropY = img.height - cropH;

  const crop = document.createElement("canvas");
  crop.width = img.width;
  crop.height = cropH;
  const cCtx = crop.getContext("2d", { willReadFrequently: true })!;
  cCtx.drawImage(img, 0, cropY, img.width, cropH, 0, 0, img.width, cropH);

  const id = cCtx.getImageData(0, 0, crop.width, crop.height);
  const d = id.data;

  // Build grayscale buffer for Otsu
  const gray = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
  }

  const t = Math.max(0, Math.min(255, otsuThreshold(gray) + thresholdOffset));

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = gray[j] > t ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  cCtx.putImageData(id, 0, 0);

  const out = document.createElement("canvas");
  out.width = crop.width * 2;
  out.height = crop.height * 2;
  const oCtx = out.getContext("2d")!;
  oCtx.imageSmoothingEnabled = false;
  oCtx.drawImage(crop, 0, 0, out.width, out.height);

  return out.toDataURL("image/png");
}

/* ────────────────────────────── MRZ parsing ────────────────────────────── */

/** Char correction for numeric MRZ zones. */
function fixNumericZone(s: string): string {
  return s
    .replace(/O/g, "0")
    .replace(/D/g, "0")
    .replace(/Q/g, "0")
    .replace(/I/g, "1")
    .replace(/L/g, "1")
    .replace(/S/g, "5")
    .replace(/Z/g, "2")
    .replace(/B/g, "8")
    .replace(/G/g, "6");
}

/** Char correction for alpha MRZ zones. */
function fixAlphaZone(s: string): string {
  return s
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/5/g, "S")
    .replace(/8/g, "B");
}

function cleanLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s\u00A0]/g, "")
    .replace(/[^A-Z0-9<]/g, "<");
}

/**
 * Pad/truncate to exactly 44 chars.
 * If line is too short, pad with `<` at the end (filler positions).
 */
function normalizeLine(l: string): string {
  if (l.length >= 44) return l.slice(0, 44);
  return l.padEnd(44, "<");
}

/**
 * Find the two MRZ lines from raw OCR output.
 * Looks for line 1 starting with `P<` and line 2 matching the data pattern,
 * then falls back to "two longest plausible lines".
 */
function extractMRZLines(text: string): [string, string] | null {
  const all = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length >= 30);
  if (all.length === 0) return null;

  const padded = all.map(normalizeLine);

  // Strategy 1: find a P-starting line followed by another long line
  for (let i = 0; i < padded.length - 1; i++) {
    if (padded[i].startsWith("P") && padded[i + 1].length === 44) {
      return [padded[i], padded[i + 1]];
    }
  }

  // Strategy 2: find any line where positions [10..12] look like a 3-letter
  // country code AND [0..8] look like passport-numbery → that's line 2.
  // The line above should be line 1.
  for (let i = 1; i < padded.length; i++) {
    const l = padded[i];
    const nat = l.slice(10, 13);
    const pn = l.slice(0, 9);
    if (/^[A-Z<]{3}$/.test(nat) && /^[A-Z0-9<]{9}$/.test(pn) && /\d/.test(pn)) {
      return [padded[i - 1], l];
    }
  }

  // Strategy 3: just two longest lines
  const sorted = [...padded].sort((a, b) => {
    const aScore = a.replace(/</g, "").length;
    const bScore = b.replace(/</g, "").length;
    return bScore - aScore;
  });
  if (sorted.length >= 2) {
    // Make sure we return them in correct order (line1 before line2 in source)
    const idxA = padded.indexOf(sorted[0]);
    const idxB = padded.indexOf(sorted[1]);
    if (idxA < idxB) return [sorted[0], sorted[1]];
    return [sorted[1], sorted[0]];
  }

  return null;
}

function parseMRZ(text: string): PassportData {
  const pair = extractMRZLines(text);
  if (!pair) return {};

  const [rawLine1, rawLine2] = pair;
  const line1 = rawLine1;
  const line2 = rawLine2;
  const result: PassportData = {};

  try {
    // Passport number — alpha+digit zone, no aggressive numeric fix
    const passportRaw = line2.slice(0, 9).replace(/</g, "");
    if (passportRaw.length >= 5) result.passportNumber = passportRaw;

    // Nationality — pure alpha
    const nat = fixAlphaZone(line2.slice(10, 13)).replace(/</g, "");
    if (nat.length >= 2) result.nationality = nat;

    // DOB — pure numeric
    const dobRaw = fixNumericZone(line2.slice(13, 19));
    if (/^\d{6}$/.test(dobRaw)) {
      const yy = parseInt(dobRaw.slice(0, 2));
      const mm = dobRaw.slice(2, 4);
      const dd = dobRaw.slice(4, 6);
      const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
      result.birthDate = `${yyyy}-${mm}-${dd}`;
    }

    // Sex
    const sex = line2[20];
    if (sex === "M") result.gender = "L";
    else if (sex === "F") result.gender = "P";

    // Expiry date — pure numeric
    const expRaw = fixNumericZone(line2.slice(21, 27));
    if (/^\d{6}$/.test(expRaw)) {
      const yy = parseInt(expRaw.slice(0, 2));
      const mm = expRaw.slice(2, 4);
      const dd = expRaw.slice(4, 6);
      const yyyy = 2000 + yy;
      result.expiryDate = `${yyyy}-${mm}-${dd}`;
    }

    // Name — pure alpha
    const namePart = fixAlphaZone(line1.slice(5, 44));
    const sepIdx = namePart.indexOf("<<");
    let fullName = "";
    if (sepIdx !== -1) {
      const surname = namePart.slice(0, sepIdx).replace(/</g, " ").trim();
      const given = namePart.slice(sepIdx + 2).replace(/</g, " ").replace(/\s+/g, " ").trim();
      fullName = given ? `${given} ${surname}`.trim() : surname;
    } else {
      fullName = namePart.replace(/</g, " ").trim();
    }
    if (fullName.length > 2) result.name = fullName;

    // Checksums — use the corrected fields
    const passportField = line2.slice(0, 9);
    const passportCheckChar = line2[9];
    const dobField = fixNumericZone(line2.slice(13, 19));
    const dobCheckChar = line2[19];
    const expField = fixNumericZone(line2.slice(21, 27));
    const expCheckChar = line2[27];
    const compositeField =
      line2.slice(0, 10) +
      line2.slice(13, 20) +
      line2.slice(21, 28) +
      line2.slice(28, 42) +
      line2[42];
    const compositeCheckChar = line2[43];

    result.checksums = {
      passportNumber: checkField(passportField, passportCheckChar),
      birthDate: checkField(dobField, dobCheckChar),
      expiryDate: checkField(expField, expCheckChar),
      composite: checkField(compositeField, compositeCheckChar),
    };
    result.mrzValid =
      result.checksums.passportNumber &&
      result.checksums.birthDate &&
      result.checksums.expiryDate &&
      result.checksums.composite;
  } catch {
    /* swallow */
  }

  return result;
}

/* ────────────────────────────── Result scoring ────────────────────────────── */

/**
 * Score a parse result so we can pick the best candidate from multiple OCR passes.
 * Checksum passes are weighted highest, then number of fields extracted.
 */
function scoreResult(p: PassportData): number {
  let score = 0;
  if (p.checksums) {
    if (p.checksums.passportNumber) score += 30;
    if (p.checksums.birthDate) score += 25;
    if (p.checksums.expiryDate) score += 25;
    if (p.checksums.composite) score += 40;
  }
  score += countPassportDataFields(p) * 5;
  return score;
}

/* ────────────────────────────── AI fallback (OpenAI via Edge Function) ────────────────────────────── */

/**
 * Compress an image data URL down so the OpenAI call stays cheap & fast.
 * Targets ~1280px on the long edge as JPEG q=0.85 — plenty for MRZ.
 */
async function compressForAI(dataUrl: string, maxEdge = 1280): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.85);
}

/* ── OpenAI direct call (browser → OpenAI API) ─────────────────────────── */

const OPENAI_SYSTEM_PROMPT = `You are an OCR engine specialized in reading the Machine Readable Zone (MRZ) of international passports (ICAO 9303 TD3 format, two lines of 44 characters each).

Look at the bottom of the passport photo for the MRZ strip. Extract EXACTLY these 5 fields and return ONLY a JSON object (no prose, no markdown fences) with this exact shape:

{
  "name": "FULL NAME AS PRINTED (given names then surname, single space separated)",
  "passportNumber": "DOCUMENT NUMBER (alphanumeric, no '<' fillers)",
  "birthDate": "YYYY-MM-DD",
  "gender": "L for male, P for female",
  "expiryDate": "YYYY-MM-DD",
  "mrzValid": true
}

Rules:
- Only return the 5 fields above plus mrzValid. Do not return nationality or any other field.
- If a field is unreadable, set it to null (do NOT guess).
- For 2-digit years in MRZ: if year > 30 it means 19xx, otherwise 20xx for birth date. Expiry is always 20xx.
- Set mrzValid to true only if you successfully read all check digits and they all match.
- gender must be exactly "L" (laki-laki) or "P" (perempuan), null if unreadable.
- Return ONLY the JSON object, nothing else.`;

interface OpenAIParsed {
  name: string | null;
  passportNumber: string | null;
  birthDate: string | null;
  expiryDate: string | null;
  gender: "L" | "P" | null;
  mrzValid: boolean;
}

function normalizeOpenAIParsed(parsed: OpenAIParsed): PassportData {
  const out: PassportData = { source: "openai", mrzValid: parsed.mrzValid === true };
  if (typeof parsed.name === "string" && parsed.name.trim()) out.name = parsed.name.trim();
  if (typeof parsed.passportNumber === "string" && parsed.passportNumber.trim()) {
    out.passportNumber = parsed.passportNumber.replace(/[<\s]/g, "").toUpperCase();
  }
  if (typeof parsed.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.birthDate)) {
    out.birthDate = parsed.birthDate;
  }
  if (typeof parsed.expiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.expiryDate)) {
    out.expiryDate = parsed.expiryDate;
  }
  if (parsed.gender === "L" || parsed.gender === "P") out.gender = parsed.gender;
  return out;
}

async function callOpenAIDirect(dataUrl: string, apiKey: string): Promise<PassportData> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // cheapest OpenAI model with vision
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: OPENAI_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Read the MRZ from this passport and return the JSON." },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errTxt.slice(0, 200) || res.statusText}`);
  }

  const completion = await res.json();
  const raw = completion?.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") {
    throw new Error("OpenAI returned empty response.");
  }

  let parsed: OpenAIParsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  return normalizeOpenAIParsed(parsed);
}

/**
 * AI OCR untuk paspor.
 *
 * Strategi:
 * 1. Kalo `VITE_OPENAI_API_KEY` ada di env → panggil OpenAI gpt-4o-mini langsung dari browser.
 *    (Paling cepat & ga butuh Edge Function deploy.)
 * 2. Kalo ga ada → fallback ke Supabase Edge Function `ocr-passport` (yang juga proxy ke OpenAI).
 *
 * `throwOnError=true` → throw Error dengan pesan jelas (dipake AI-only mode).
 * `throwOnError=false` (default) → return null biar caller bisa fallback ke Tesseract.
 */
export async function scanPassportAI(
  imageSource: string | File,
  opts?: { throwOnError?: boolean },
): Promise<PassportData | null> {
  const throwOnError = opts?.throwOnError === true;
  const openaiKey = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim();

  try {
    const rawDataUrl =
      imageSource instanceof File || imageSource instanceof Blob
        ? await fileToDataUrl(imageSource)
        : imageSource;
    const dataUrl = await compressForAI(rawDataUrl);

    // Path 1: direct OpenAI dari browser
    if (openaiKey) {
      return await callOpenAIDirect(dataUrl, openaiKey);
    }

    // Path 2: fallback ke Supabase Edge Function
    if (!supabase) {
      throw new Error(
        "VITE_OPENAI_API_KEY belum di-set & Supabase belum dikonfigurasi. Set salah satu.",
      );
    }
    const { data, error } = await supabase.functions.invoke<{
      name?: string;
      passportNumber?: string;
      nationality?: string;
      birthDate?: string;
      expiryDate?: string;
      gender?: "L" | "P";
      mrzValid?: boolean;
      error?: string;
    }>("ocr-passport", { body: { imageDataUrl: dataUrl } });

    if (error) throw new Error(error.message || "Gagal panggil Edge Function ocr-passport.");
    if (!data) throw new Error("Edge Function tidak mengembalikan data.");
    if (data.error) throw new Error(data.error);
    return {
      name: data.name,
      passportNumber: data.passportNumber,
      nationality: data.nationality,
      birthDate: data.birthDate,
      expiryDate: data.expiryDate,
      gender: data.gender,
      mrzValid: data.mrzValid === true,
      source: "openai",
    };
  } catch (e) {
    if (throwOnError) throw e;
    return null;
  }
}

/* ────────────────────────────── Main entry ────────────────────────────── */

/**
 * OCR a passport image. Tries multiple preprocessing variants and PSM modes
 * and picks the result with the highest checksum/field score.
 *
 * Hybrid mode (default): if Tesseract result fails MRZ checksums, automatically
 * fall back to OpenAI gpt-4o-mini via the Supabase Edge Function. Set
 * `useAIFallback=false` to force Tesseract-only.
 */
export async function scanPassport(
  imageSource: string | File,
  onProgress?: (pct: number) => void,
  opts?: { useAIFallback?: boolean; aiOnly?: boolean },
): Promise<PassportData> {
  const useAIFallback = opts?.useAIFallback !== false;
  const aiOnly = opts?.aiOnly === true;
  const dataUrl =
    imageSource instanceof File || imageSource instanceof Blob
      ? await fileToDataUrl(imageSource)
      : imageSource;

  // AI-only mode: skip Tesseract sepenuhnya, langsung ke OpenAI Edge Function.
  // Throws kalo gagal supaya UI bisa nampilin alasan jelas.
  if (aiOnly) {
    if (onProgress) onProgress(20);
    const ai = await scanPassportAI(dataUrl, { throwOnError: true });
    if (onProgress) onProgress(100);
    if (!ai) throw new Error("AI OCR tidak mengembalikan hasil.");
    return ai;
  }

  const img = await loadImage(dataUrl);

  // Build several preprocessed variants (different crop heights & threshold offsets).
  // More variants → higher chance one of them yields a clean MRZ.
  const variants = await Promise.all([
    preprocessForMRZ(img, 0.32, 0),
    preprocessForMRZ(img, 0.28, 0),
    preprocessForMRZ(img, 0.38, 0),
    preprocessForMRZ(img, 0.32, -15), // slightly darker → connects broken strokes
  ]);

  const pooled = await leaseWorker();
  const { worker } = pooled;
  // Pasang logger khusus untuk lease ini; di-clear oleh releaseWorker().
  pooled.setLogger((m) => {
    if (onProgress && m.progress !== undefined && m.status) {
      const base = mapProgress(m.status, m.progress);
      onProgress(Math.min(95, base));
    }
  });

  try {
    // Reset PSM tiap lease karena worker re-used dan param dari panggilan
    // sebelumnya (mis. PSM 7/11) bisa "nempel".
    await worker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
      tessedit_pageseg_mode: "6" as never,
    });

    let best: PassportData = {};
    let bestScore = -1;

    // Pass 1-N: each variant with PSM 6 (uniform block of text)
    for (const v of variants) {
      const { data } = await worker.recognize(v);
      const parsed = parseMRZ(data.text);
      const s = scoreResult(parsed);
      if (s > bestScore) {
        bestScore = s;
        best = parsed;
      }
      // Short-circuit if all checksums passed already
      if (parsed.mrzValid) {
        if (onProgress) onProgress(100);
        return { ...parsed, source: "tesseract" };
      }
    }

    // Pass: PSM 7 (single text line) on the strongest crop
    if (bestScore < 80) {
      await worker.setParameters({ tessedit_pageseg_mode: "7" as never });
      const { data } = await worker.recognize(variants[0]);
      const parsed = parseMRZ(data.text);
      const s = scoreResult(parsed);
      if (s > bestScore) {
        bestScore = s;
        best = parsed;
      }
    }

    // Final fallback: PSM 11 (sparse text) on the original full image —
    // sometimes the MRZ strip has context (like rotation) the crop misses.
    if (bestScore < 50) {
      await worker.setParameters({ tessedit_pageseg_mode: "11" as never });
      const { data } = await worker.recognize(dataUrl);
      const parsed = parseMRZ(data.text);
      const s = scoreResult(parsed);
      if (s > bestScore) {
        best = parsed;
      }
    }

    // Tesseract done. If MRZ checksums failed and AI fallback enabled, try OpenAI.
    if (useAIFallback && !best.mrzValid) {
      if (onProgress) onProgress(96);
      const ai = await scanPassportAI(dataUrl);
      if (ai && (ai.mrzValid || countPassportDataFields(ai) > countPassportDataFields(best))) {
        if (onProgress) onProgress(100);
        return ai;
      }
    }

    if (onProgress) onProgress(100);
    return { ...best, source: best.source ?? "tesseract" };
  } finally {
    // Worker dikembalikan ke pool — TIDAK di-terminate (di-reuse di scan
    // berikutnya). Pemanggil bertanggung jawab call disposeOcrWorkerPool()
    // saat sesi batch selesai (mis. dialog ditutup).
    releaseWorker(pooled);
  }
}
