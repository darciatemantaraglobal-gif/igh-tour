/**
 * Professional pricing engine for IGH Tour package calculator.
 * Supports three modes:
 *   - "umroh_private" : structured umroh calc, private/family group
 *   - "umroh_group"   : structured umroh calc, large group / open trip
 *   - "umum"          : flexible row-based calculator for any trip type
 */

import { type Rates } from "@/lib/exchangeRates";

export type CalcCurrency = "IDR" | "SAR" | "USD";
export type CalcMode = "umroh_private" | "umroh_group" | "umum";

// ── Umroh Mode Input Structures ───────────────────────────────────────────────

export interface HotelRow {
  id: string;
  label: string;
  days: number;
  /** Base / Quad rate per room per night (back-compat single-rate field). */
  pricePerNight: number;
  rooms: number;         // number of rooms
  roomType?: "Quad" | "Triple" | "Double"; // sharing type — Quad=4, Triple=3, Double=2
  currency?: "IDR" | "SAR" | "USD"; // default SAR
  // ── Granular per-room-type rates (per room per night, in `currency`) ──
  /** Triple-room nightly rate. If unset, falls back per `useSupplement`. */
  pricePerNightTriple?: number;
  /** Double-room nightly rate. If unset, falls back per `useSupplement`. */
  pricePerNightDouble?: number;
  /** When true, Triple/Double rates = `pricePerNight` + supplement. */
  useSupplement?: boolean;
  /** Supplement added to base for Triple rooms (only if `useSupplement`). */
  supplementTriple?: number;
  /** Supplement added to base for Double rooms (only if `useSupplement`). */
  supplementDouble?: number;
}

/**
 * Resolve the per-room nightly rate for a given room type, applying the
 * supplement-fallback rule:
 *   - Quad   → always base `pricePerNight`
 *   - Triple → if `useSupplement` → base + supplementTriple
 *              else → explicit pricePerNightTriple, or base if unset
 *   - Double → same pattern with supplementDouble / pricePerNightDouble
 */
export function resolveRoomRate(h: HotelRow, room: "Quad" | "Triple" | "Double"): number {
  const base = h.pricePerNight ?? 0;
  if (room === "Quad") return base;
  if (h.useSupplement) {
    const supp = room === "Triple" ? (h.supplementTriple ?? 0) : (h.supplementDouble ?? 0);
    return base + supp;
  }
  const explicit = room === "Triple" ? h.pricePerNightTriple : h.pricePerNightDouble;
  if (typeof explicit === "number" && explicit > 0) return explicit;
  return base;
}

export interface TransportRow {
  id: string;
  label: string;          // Jenis (e.g. "Hiace", "Bus 50 seat")
  route?: string;         // Rute (e.g. "JED-MED")
  fleet: number;          // Jumlah
  pricePerFleet: number;  // Harga per unit (in selected currency)
  currency?: "IDR" | "SAR" | "USD"; // default SAR
}

export interface TicketRow {
  id: string;
  label: string;       // route e.g. "SUB - JED"
  flightType: string;  // e.g. "Return" / "One Way"
  airline?: string;    // e.g. "Saudia Airlines"
  pricePerPax: number; // price per person
  currency: "IDR" | "SAR" | "USD";
}

export interface VisaRow {
  id: string;
  label: string;
  pricePerPax: number; // currency per pax
  currency?: "IDR" | "SAR" | "USD"; // default USD
}

export interface DestinationRow {
  id: string;
  label: string;
  pricePerPax: number; // currency per pax
  currency?: "IDR" | "SAR" | "USD"; // default SAR
}

export interface FnBRow {
  id: string;
  label: string;
  pricePerPax: number; // currency per pax
  currency?: "IDR" | "SAR" | "USD"; // default SAR
}

export interface StaffRow {
  id: string;
  label: string;
  numStaff?: number; // number of staff (optional, for display only)
  totalCost: number; // currency total for whole group
  currency?: "IDR" | "SAR" | "USD"; // default SAR
}

// ── Umum Mode Input Structure ─────────────────────────────────────────────────

export type CostUnit = "group" | "pax";

export interface GeneralCostRow {
  id: string;
  category?: string;  // e.g. "akomodasi", "transport", "tiket", "visa", "makan", "atraksi", "guide", "lainnya"
  label: string;
  qty?: number;       // unit multiplier (nights, buses, etc.) — default 1
  amount: number;
  currency: CalcCurrency;
  unit: CostUnit; // "group" = fixed total; "pax" = amount × pax count
}

// ── Shared Output ─────────────────────────────────────────────────────────────

export interface BreakdownRow {
  id: string;
  category: string;
  label: string;
  notesSAR: number;
  notesUSD: number;
  groupIDR: number;
  perPaxIDR: number;
}

export interface ProfessionalQuote {
  breakdown: BreakdownRow[];
  hotelIDR: number;
  transportIDR: number;
  ticketIDR: number;
  visaIDR: number;
  destinationIDR: number;
  fnbIDR: number;
  staffIDR: number;
  hpp: number;
  commissionFee: number;
  marginIDR: number;
  sellingPrice: number;
  discount: number;
  finalPrice: number;
  perPaxFinal: number;
  netProfit: number;
  totalSAR: number;
  totalUSD: number;
}

// ── Shared Financial Rollup ───────────────────────────────────────────────────

function rollup(
  hpp: number,
  commissionFee: number,
  marginIDR: number,
  discount: number,
  safePax: number,
): Pick<ProfessionalQuote, "hpp" | "commissionFee" | "marginIDR" | "sellingPrice" | "discount" | "finalPrice" | "perPaxFinal" | "netProfit"> {
  const sellingPrice = hpp + commissionFee + marginIDR;
  const finalPrice = Math.max(0, sellingPrice - discount);
  const perPaxFinal = finalPrice / safePax;
  const netProfit = finalPrice - hpp - commissionFee;
  return { hpp, commissionFee, marginIDR, sellingPrice, discount, finalPrice, perPaxFinal, netProfit };
}

// ── Umroh / Haji Mode ─────────────────────────────────────────────────────────

export interface ProfessionalCalcInput {
  pax: number;
  hotels: HotelRow[];
  transports: TransportRow[];
  tickets?: TicketRow[];
  visas: VisaRow[];
  destinations: DestinationRow[];
  fnbs?: FnBRow[];
  staffs: StaffRow[];
  commissionFee: number;
  marginPercent: number;
  /** "percent" = pakai marginPercent (default), "fixed" = pakai marginFixed (IDR/pax) */
  marginMode?: "percent" | "fixed";
  /** Profit per pax dalam IDR, dipakai hanya jika marginMode === "fixed" */
  marginFixed?: number;
  discount: number;
  rates: Rates;
}

export function computeProfessionalQuote(input: ProfessionalCalcInput): ProfessionalQuote {
  const { pax, hotels, transports, visas, destinations, staffs, commissionFee, marginPercent, discount, rates } = input;
  const tickets = input.tickets ?? [];
  const fnbs = input.fnbs ?? [];
  const safePax = Math.max(1, pax);
  const sarRate = rates.SAR ?? 1;
  const usdRate = rates.USD ?? 1;

  const breakdown: BreakdownRow[] = [];
  let totalSAR = 0;
  let totalUSD = 0;

  // helper: resolve amount → IDR and track foreign totals
  function toIDR(amount: number, cur: "IDR" | "SAR" | "USD"): number {
    if (cur === "SAR") return amount * sarRate;
    if (cur === "USD") return amount * usdRate;
    return amount;
  }
  function trackForeign(amount: number, cur: "IDR" | "SAR" | "USD") {
    if (cur === "SAR") totalSAR += amount;
    else if (cur === "USD") totalUSD += amount;
  }

  // ── 1. Hotel (currency per room per night × rooms × days) ─────────────────
  // If `roomType` is set, use the room-specific rate (Quad/Triple/Double)
  // resolved via `resolveRoomRate` (handles explicit rates + supplement
  // fallback). Otherwise fall back to the base `pricePerNight` (back-compat).
  let hotelIDR = 0;
  for (const h of hotels) {
    const cur = h.currency ?? "SAR";
    const ratePerNight = h.roomType ? resolveRoomRate(h, h.roomType) : (h.pricePerNight ?? 0);
    const foreignAmount = h.days * ratePerNight * h.rooms;
    const idr = toIDR(foreignAmount, cur);
    trackForeign(foreignAmount, cur);
    hotelIDR += idr;
    breakdown.push({ id: h.id, category: "Hotel", label: h.label || "Hotel", notesSAR: cur === "SAR" ? foreignAmount : 0, notesUSD: cur === "USD" ? foreignAmount : 0, groupIDR: idr, perPaxIDR: idr / safePax });
  }

  // ── 2. Transport (currency per fleet × fleet count) ───────────────────────
  let transportIDR = 0;
  for (const t of transports) {
    const cur = t.currency ?? "SAR";
    const foreignAmount = t.fleet * t.pricePerFleet;
    const idr = toIDR(foreignAmount, cur);
    trackForeign(foreignAmount, cur);
    transportIDR += idr;
    breakdown.push({ id: t.id, category: "Transport", label: t.label || "Transportasi", notesSAR: cur === "SAR" ? foreignAmount : 0, notesUSD: cur === "USD" ? foreignAmount : 0, groupIDR: idr, perPaxIDR: idr / safePax });
  }

  // ── 3. Airline Ticket (IDR / SAR / USD per pax) ────────────────────────────
  let ticketIDR = 0;
  for (const tk of tickets) {
    const foreignAmount = tk.pricePerPax * safePax;
    const idr = toIDR(foreignAmount, tk.currency);
    trackForeign(foreignAmount, tk.currency);
    ticketIDR += idr;
    breakdown.push({ id: tk.id, category: "Tiket", label: `${tk.label}${tk.flightType ? ` (${tk.flightType})` : ""}`, notesSAR: tk.currency === "SAR" ? foreignAmount : 0, notesUSD: tk.currency === "USD" ? foreignAmount : 0, groupIDR: idr, perPaxIDR: idr / safePax });
  }

  // ── 4. Visa (currency per pax, default USD) ────────────────────────────────
  let visaIDR = 0;
  for (const v of visas) {
    const cur = v.currency ?? "USD";
    const foreignAmount = v.pricePerPax * safePax;
    const idr = toIDR(foreignAmount, cur);
    trackForeign(foreignAmount, cur);
    visaIDR += idr;
    breakdown.push({ id: v.id, category: "Visa", label: v.label || "Visa", notesSAR: cur === "SAR" ? foreignAmount : 0, notesUSD: cur === "USD" ? foreignAmount : 0, groupIDR: idr, perPaxIDR: idr / safePax });
  }

  // ── 5. Destination (currency per pax, default SAR) ────────────────────────
  let destinationIDR = 0;
  for (const d of destinations) {
    const cur = d.currency ?? "SAR";
    const foreignAmount = d.pricePerPax * safePax;
    const idr = toIDR(foreignAmount, cur);
    trackForeign(foreignAmount, cur);
    destinationIDR += idr;
    breakdown.push({ id: d.id, category: "Destinasi", label: d.label || "Destinasi", notesSAR: cur === "SAR" ? foreignAmount : 0, notesUSD: cur === "USD" ? foreignAmount : 0, groupIDR: idr, perPaxIDR: idr / safePax });
  }

  // ── 6. F&B (currency per pax, default SAR) ────────────────────────────────
  let fnbIDR = 0;
  for (const f of fnbs) {
    const cur = f.currency ?? "SAR";
    const foreignAmount = f.pricePerPax * safePax;
    const idr = toIDR(foreignAmount, cur);
    trackForeign(foreignAmount, cur);
    fnbIDR += idr;
    breakdown.push({ id: f.id, category: "F&B", label: f.label || "F&B", notesSAR: cur === "SAR" ? foreignAmount : 0, notesUSD: cur === "USD" ? foreignAmount : 0, groupIDR: idr, perPaxIDR: idr / safePax });
  }

  // ── 7. Staff (currency group cost, default SAR) ───────────────────────────
  // totalCost = biaya per orang staff. Dikali numStaff (default 1) buat dapet
  // total grup. Misal Muthowif SAR 250 × 5 staff = SAR 1.250.
  let staffIDR = 0;
  for (const s of staffs) {
    const cur = s.currency ?? "SAR";
    const count = Math.max(1, s.numStaff ?? 1);
    const totalForeign = s.totalCost * count;
    const idr = toIDR(totalForeign, cur);
    trackForeign(totalForeign, cur);
    staffIDR += idr;
    breakdown.push({
      id: s.id,
      category: "Staff",
      label: s.label || "Guide",
      notesSAR: cur === "SAR" ? totalForeign : 0,
      notesUSD: cur === "USD" ? totalForeign : 0,
      groupIDR: idr,
      perPaxIDR: idr / safePax,
    });
  }

  const hpp = hotelIDR + transportIDR + ticketIDR + visaIDR + destinationIDR + fnbIDR + staffIDR;

  const effectiveMarginIDR = input.marginMode === "fixed"
    ? (input.marginFixed ?? 0) * safePax
    : hpp * (input.marginPercent / 100);

  return {
    breakdown,
    hotelIDR, transportIDR, ticketIDR, visaIDR, destinationIDR, fnbIDR, staffIDR,
    totalSAR, totalUSD,
    ...rollup(hpp, commissionFee, effectiveMarginIDR, discount, safePax),
  };
}

// ── Umum (General) Mode ───────────────────────────────────────────────────────

export interface GeneralCalcInput {
  pax: number;
  costs: GeneralCostRow[];
  commissionFee: number;
  marginPercent: number;
  discount: number;
  rates: Rates;
}

export function computeGeneralQuote(input: GeneralCalcInput): ProfessionalQuote {
  const { pax, costs, commissionFee, marginPercent, discount, rates } = input;
  const safePax = Math.max(1, pax);
  const sarRate = rates.SAR ?? 1;
  const usdRate = rates.USD ?? 1;

  const breakdown: BreakdownRow[] = [];
  let totalSAR = 0;
  let totalUSD = 0;
  let totalIDR = 0;

  for (const c of costs) {
    const multiplier = (c.unit === "pax" ? safePax : 1) * (c.qty ?? 1);
    let sarRef = 0;
    let usdRef = 0;
    let groupIDR = 0;

    if (c.currency === "IDR") {
      groupIDR = c.amount * multiplier;
    } else if (c.currency === "SAR") {
      sarRef = c.amount * multiplier;
      groupIDR = sarRef * sarRate;
      totalSAR += sarRef;
    } else {
      usdRef = c.amount * multiplier;
      groupIDR = usdRef * usdRate;
      totalUSD += usdRef;
    }

    totalIDR += groupIDR;
    breakdown.push({
      id: c.id,
      category: "Biaya",
      label: c.label || "Item",
      notesSAR: sarRef,
      notesUSD: usdRef,
      groupIDR,
      perPaxIDR: groupIDR / safePax,
    });
  }

  return {
    breakdown,
    hotelIDR: 0, transportIDR: 0, ticketIDR: 0, visaIDR: 0, destinationIDR: 0, fnbIDR: 0, staffIDR: 0,
    totalSAR, totalUSD,
    ...rollup(totalIDR, commissionFee, marginPercent, discount, safePax),
  };
}

// ── Umroh Group Matrix Mode ───────────────────────────────────────────────────
// Untuk open-trip / paket grup: hitung harga per pax untuk berbagai
// kombinasi (jumlah pax × tipe kamar). Karena biaya FIXED (bus, staff)
// dibagi rata ke pax, dan biaya HOTEL dibagi ke sharing per kamar
// (Quad=4, Triple=3, Double=2), tiap kombinasi punya harga beda.

export type RoomType = "Quad" | "Triple" | "Double";

export const ROOM_SHARING: Record<RoomType, number> = {
  Quad: 4,
  Triple: 3,
  Double: 2,
};

export interface PaxTier {
  min: number;
  max: number;
}

export interface GroupMatrixInput {
  /** Hotel rows — `rooms` field ignored, dihitung otomatis dari pax/sharing */
  hotels: HotelRow[];
  /** Transport — biaya FIXED per fleet (ga digantung pax) */
  transports: TransportRow[];
  /** Tiket — per pax flat */
  tickets?: TicketRow[];
  /** Visa — per pax flat */
  visas: VisaRow[];
  /** Destinasi/tasreh — per pax flat */
  destinations: DestinationRow[];
  /** F&B — per pax flat */
  fnbs?: FnBRow[];
  /** Staff/guide — total grup, FIXED */
  staffs: StaffRow[];
  commissionFee: number; // IDR, di-add per grup
  marginPercent: number;
  /** "percent" = pakai marginPercent (default), "fixed" = pakai marginFixed (IDR/pax) */
  marginMode?: "percent" | "fixed";
  /** Profit per pax dalam IDR, dipakai hanya jika marginMode === "fixed" */
  marginFixed?: number;
  discount: number;      // IDR, di-subtract per grup
  rates: Rates;
  /** Tier pax yang mau dihitung */
  tiers: PaxTier[];
  /** Tipe kamar yang ditampilkan */
  roomTypes: RoomType[];
  /** Currency display untuk tabel matrix output */
  displayCurrency: CalcCurrency;
  /** Round per-pax ke kelipatan ini di display currency. 0 = no rounding */
  roundTo?: number;
}

export interface GroupMatrixCell {
  tier: PaxTier;
  room: RoomType;
  pax: number;        // pax yang dipake utk hitung (= tier.min, konservatif)
  rooms: number;      // jumlah kamar dipakai (= ceil(pax/sharing))
  perPaxIDR: number;
  perPaxDisplay: number;     // dalam displayCurrency, sudah di-round
  hppPerPaxIDR: number;
  hotelPerPaxIDR: number;    // hotel cost share for this room type, per pax
}

export interface HotelMatrixBreakdown {
  hotelId: string;
  label: string;
  nights: number;
  /** Per-room price for the entire stay (nights × rate), in IDR, per room type. */
  ratesPerRoomIDR: Record<RoomType, number>;
}

export interface GroupMatrixQuote {
  cells: GroupMatrixCell[];
  fixedTotalIDR: number;     // total biaya fixed grup (transport+staff+commission)
  perPaxFlatIDR: number;     // total biaya per-pax flat (tiket+visa+dest+fnb)
  /** @deprecated kept for back-compat — use `hotelBreakdown` instead. */
  hotelPerNightIDR: { hotelId: string; label: string; pricePerRoomIDR: number; nights: number }[];
  hotelBreakdown: HotelMatrixBreakdown[];
  displayCurrency: CalcCurrency;
  totalSAR: number;
  totalUSD: number;
}

function toIDRWith(amount: number, cur: "IDR" | "SAR" | "USD", rates: Rates): number {
  const sarRate = rates.SAR ?? 1;
  const usdRate = rates.USD ?? 1;
  if (cur === "SAR") return amount * sarRate;
  if (cur === "USD") return amount * usdRate;
  return amount;
}

export function computeGroupMatrix(input: GroupMatrixInput): GroupMatrixQuote {
  const {
    hotels, transports, visas, destinations, staffs,
    commissionFee, marginPercent, marginMode, marginFixed, discount, rates,
    tiers, roomTypes, displayCurrency,
  } = input;
  const tickets = input.tickets ?? [];
  const fnbs = input.fnbs ?? [];
  const roundTo = input.roundTo ?? 0;
  const sarRate = rates.SAR ?? 1;
  const usdRate = rates.USD ?? 1;

  let totalSAR = 0;
  let totalUSD = 0;
  const trackForeign = (amt: number, cur: "IDR" | "SAR" | "USD") => {
    if (cur === "SAR") totalSAR += amt;
    else if (cur === "USD") totalUSD += amt;
  };

  // ── Per-pax flat (tiket + visa + dest + fnb), dalam IDR per orang
  let perPaxFlatIDR = 0;
  for (const tk of tickets) {
    perPaxFlatIDR += toIDRWith(tk.pricePerPax, tk.currency, rates);
    trackForeign(tk.pricePerPax, tk.currency);
  }
  for (const v of visas) {
    const cur = v.currency ?? "USD";
    perPaxFlatIDR += toIDRWith(v.pricePerPax, cur, rates);
    trackForeign(v.pricePerPax, cur);
  }
  for (const d of destinations) {
    const cur = d.currency ?? "SAR";
    perPaxFlatIDR += toIDRWith(d.pricePerPax, cur, rates);
    trackForeign(d.pricePerPax, cur);
  }
  for (const f of fnbs) {
    const cur = f.currency ?? "SAR";
    perPaxFlatIDR += toIDRWith(f.pricePerPax, cur, rates);
    trackForeign(f.pricePerPax, cur);
  }

  // ── Fixed grup (transport + staff + commission), dalam IDR total grup
  let fixedTotalIDR = 0;
  for (const t of transports) {
    const cur = t.currency ?? "SAR";
    const amt = t.fleet * t.pricePerFleet;
    fixedTotalIDR += toIDRWith(amt, cur, rates);
    trackForeign(amt, cur);
  }
  for (const s of staffs) {
    const cur = s.currency ?? "SAR";
    fixedTotalIDR += toIDRWith(s.totalCost, cur, rates);
    trackForeign(s.totalCost, cur);
  }
  fixedTotalIDR += commissionFee;

  // ── Hotel: per-room price for the full stay, computed per ROOM TYPE.
  //    Rate per night is room-type-specific (resolveRoomRate handles
  //    explicit rates + supplement fallback). Multiplied by nights to get
  //    the cost of ONE room for the whole stay, in IDR.
  const hotelBreakdown: HotelMatrixBreakdown[] = hotels.map((h) => {
    const cur = h.currency ?? "SAR";
    const ratesPerRoomIDR: Record<RoomType, number> = {
      Quad:   toIDRWith(resolveRoomRate(h, "Quad"),   cur, rates) * h.days,
      Triple: toIDRWith(resolveRoomRate(h, "Triple"), cur, rates) * h.days,
      Double: toIDRWith(resolveRoomRate(h, "Double"), cur, rates) * h.days,
    };
    return {
      hotelId: h.id,
      label: h.label || "Hotel",
      nights: h.days,
      ratesPerRoomIDR,
    };
  });
  // Foreign-currency tracking — sum of all 3 room rates × nights so SAR/USD
  // ticker reflects the full quoted spectrum (informational only).
  for (const h of hotels) {
    const cur = h.currency ?? "SAR";
    const sumRates = resolveRoomRate(h, "Quad") + resolveRoomRate(h, "Triple") + resolveRoomRate(h, "Double");
    trackForeign(sumRates * h.days, cur);
  }
  // Back-compat: keep old shape pointing at Quad rate.
  const hotelPerNightIDR = hotelBreakdown.map((b) => ({
    hotelId: b.hotelId,
    label: b.label,
    pricePerRoomIDR: b.ratesPerRoomIDR.Quad,
    nights: b.nights,
  }));

  // ── Build cells. Each cell uses the room-type-specific hotel cost so
  //    the spread between Quad/Triple/Double reflects real hotel pricing,
  //    not just the divide-by-sharing math on a single rate.
  const cells: GroupMatrixCell[] = [];
  for (const tier of tiers) {
    const pax = Math.max(1, tier.min); // konservatif: harga buat skenario pax minimum
    for (const room of roomTypes) {
      const sharing = ROOM_SHARING[room];
      const rooms = pax / sharing; // proporsional, tanpa pembulatan agar harga turun konsisten
      // Hotel total grup utk room type ini = sum(harga 1 kamar × jumlah kamar)
      const hotelTotalIDR = hotelBreakdown.reduce(
        (sum, h) => sum + h.ratesPerRoomIDR[room] * rooms,
        0,
      );
      const hotelPerPaxIDR = hotelTotalIDR / pax; // share of hotel per pax
      const hppGroupIDR = fixedTotalIDR + hotelTotalIDR + perPaxFlatIDR * pax;
      const hppPerPaxIDR = hppGroupIDR / pax;
      const marginGroupIDR = marginMode === "fixed"
        ? (marginFixed ?? 0) * pax
        : hppGroupIDR * (marginPercent / 100);
      const sellingGroupIDR = hppGroupIDR + marginGroupIDR - discount;
      const perPaxIDR = Math.max(0, sellingGroupIDR / pax);

      // convert to display currency
      let perPaxDisplay: number;
      if (displayCurrency === "USD") perPaxDisplay = perPaxIDR / (usdRate || 1);
      else if (displayCurrency === "SAR") perPaxDisplay = perPaxIDR / (sarRate || 1);
      else perPaxDisplay = perPaxIDR;

      if (roundTo > 0) {
        perPaxDisplay = Math.round(perPaxDisplay / roundTo) * roundTo;
      }

      cells.push({ tier, room, pax, rooms, perPaxIDR, perPaxDisplay, hppPerPaxIDR, hotelPerPaxIDR });
    }
  }

  return {
    cells,
    fixedTotalIDR,
    perPaxFlatIDR,
    hotelPerNightIDR,
    hotelBreakdown,
    displayCurrency,
    totalSAR,
    totalUSD,
  };
}

/**
 * Generate default tiers: [min..max] dengan step.
 * Arrahmah pakai step 4 dari 12 sampai 47.
 */
export function defaultPaxTiers(min = 12, max = 47, step = 4): PaxTier[] {
  const tiers: PaxTier[] = [];
  for (let lo = min; lo <= max; lo += step) {
    const hi = Math.min(max, lo + step - 1);
    tiers.push({ min: lo, max: hi });
    if (hi === max) break;
  }
  return tiers;
}

// ── Legacy compat (used by Calculator page and calculatorStore) ───────────────

export interface CostInput {
  id: string;
  label: string;
  amount: number;
}

export interface Quote {
  totalCost: number;
  marginAmount: number;
  finalPrice: number;
  perPerson: number;
  breakdown: { id: string; label: string; amount: number; converted: number }[];
}

export function computeQuote(input: {
  costs: CostInput[];
  people: number;
  currency: string;
  marginPercent: number;
  rates: Rates;
}): Quote {
  const { costs, people, currency, marginPercent, rates } = input;
  const safePeople = Math.max(1, people);
  const rate = (rates as Record<string, number>)[currency] ?? 1;

  const breakdown = costs.map((c) => ({
    id: c.id,
    label: c.label,
    amount: c.amount,
    converted: c.amount * rate,
  }));

  const totalCost = breakdown.reduce((s, b) => s + b.converted, 0);
  const marginAmount = totalCost * (marginPercent / 100);
  const finalPrice = totalCost + marginAmount;
  const perPerson = finalPrice / safePeople;

  return { totalCost, marginAmount, finalPrice, perPerson, breakdown };
}
