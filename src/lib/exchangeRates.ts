export type Currency = "USD" | "SAR" | "IDR";
export type Rates = Record<Currency, number>;

const CACHE_KEY = "igh.rates.cache.v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface RatesCache {
  rates: Rates;
  fetchedAt: number;
}

function loadCache(): RatesCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c: RatesCache = JSON.parse(raw);
    if (Date.now() - c.fetchedAt > CACHE_TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}

function saveCache(rates: Rates) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() }));
}

async function fetchWithTimeout(url: string, ms = 6000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Primary: fawazahmed0 currency-api — free, no key, multi-source aggregator
// (mid-market rates very close to XE / Wise). Two CDN endpoints for redundancy.
async function fetchFromCurrencyApi(): Promise<Rates> {
  const endpoints = [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/idr.json",
    "https://latest.currency-api.pages.dev/v1/currencies/idr.json",
  ];
  let lastErr: unknown;
  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`currency-api ${res.status}`);
      const data = await res.json();
      const idrTable = data?.idr ?? {};
      const usdPerIdr = Number(idrTable.usd);
      const sarPerIdr = Number(idrTable.sar);
      if (!usdPerIdr || !sarPerIdr) throw new Error("Invalid rate data");
      return {
        IDR: 1,
        USD: Math.round(1 / usdPerIdr),
        SAR: Math.round(1 / sarPerIdr),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("currency-api unreachable");
}

// Fallback: Frankfurter (ECB rates, weekday-only)
async function fetchFromFrankfurter(): Promise<Rates> {
  // Use the Vite proxy path when running in dev server (any non-production build).
  // Checking import.meta.env.DEV is reliable across all hosting environments
  // (localhost, Replit, Codespaces, etc.) unlike port/hostname sniffing.
  const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
  const url = isDev
    ? "/api/frankfurter/latest?from=IDR&to=USD,SAR"
    : "https://api.frankfurter.app/latest?from=IDR&to=USD,SAR";

  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error("Frankfurter API error");
  const data = await res.json();
  const usdPerIdr = data.rates?.USD ?? 0;
  const sarPerIdr = data.rates?.SAR ?? 0;
  if (!usdPerIdr || !sarPerIdr) throw new Error("Invalid rate data");
  return {
    IDR: 1,
    USD: Math.round(1 / usdPerIdr),
    SAR: Math.round(1 / sarPerIdr),
  };
}

const FALLBACK_RATES: Rates = { USD: 16000, SAR: 4250, IDR: 1 };

export async function getExchangeRates(): Promise<Rates> {
  const cached = loadCache();
  if (cached) return cached.rates;

  try {
    const rates = await fetchFromCurrencyApi();
    saveCache(rates);
    return rates;
  } catch {
    try {
      const rates = await fetchFromFrankfurter();
      saveCache(rates);
      return rates;
    } catch {
      return FALLBACK_RATES;
    }
  }
}

export function getMockRates(): Rates {
  const cached = loadCache();
  return cached?.rates ?? FALLBACK_RATES;
}

export function convertToIDR(amount: number, from: Currency, rates: Rates): number {
  return amount * (rates[from] ?? 1);
}

export function applyMarkup(rates: Rates, markupPct: number): Rates {
  const factor = 1 + markupPct / 100;
  return {
    IDR: 1,
    USD: Math.round(rates.USD * factor),
    SAR: Math.round(rates.SAR * factor),
  };
}
