import { useMemo } from "react";
import { Users, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeGroupMatrix,
  defaultPaxTiers,
  ROOM_SHARING,
  type RoomType,
  type PaxTier,
  type CalcCurrency,
  type HotelRow,
  type TransportRow,
  type TicketRow,
  type VisaRow,
  type DestinationRow,
  type FnBRow,
  type StaffRow,
} from "./pricing";
import type { Rates } from "@/lib/exchangeRates";

export interface GroupSettings {
  minPax: number;
  maxPax: number;
  step: number;
  roomTypes: RoomType[];
  displayCurrency: CalcCurrency;
  roundTo: number;
}

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  minPax: 12,
  maxPax: 47,
  step: 4,
  roomTypes: ["Quad", "Triple", "Double"],
  displayCurrency: "USD",
  roundTo: 50,
};

interface Props {
  settings: GroupSettings;
  onChange: (next: GroupSettings) => void;
  inputs: {
    hotels: HotelRow[];
    transports: TransportRow[];
    tickets: TicketRow[];
    visas: VisaRow[];
    destinations: DestinationRow[];
    fnbs: FnBRow[];
    staffs: StaffRow[];
    commissionFee: number;
    marginPercent: number;
    marginMode?: "percent" | "fixed";
    marginFixed?: number;
    discount: number;
  };
  rates: Rates;
}

const ALL_ROOMS: RoomType[] = ["Quad", "Triple", "Double"];

function fmt(n: number, cur: CalcCurrency) {
  if (cur === "IDR") {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
}

export function GroupMatrixSection({ settings, onChange, inputs, rates }: Props) {
  const tiers: PaxTier[] = useMemo(
    () => defaultPaxTiers(settings.minPax, settings.maxPax, settings.step),
    [settings.minPax, settings.maxPax, settings.step],
  );

  const quote = useMemo(
    () => computeGroupMatrix({
      ...inputs,
      rates,
      tiers,
      roomTypes: settings.roomTypes.length > 0 ? settings.roomTypes : ALL_ROOMS,
      displayCurrency: settings.displayCurrency,
      roundTo: settings.roundTo,
    }),
    [inputs, rates, tiers, settings.roomTypes, settings.displayCurrency, settings.roundTo],
  );

  const activeRooms = settings.roomTypes.length > 0 ? settings.roomTypes : ALL_ROOMS;

  function toggleRoom(r: RoomType) {
    const has = settings.roomTypes.includes(r);
    const next = has ? settings.roomTypes.filter((x) => x !== r) : [...settings.roomTypes, r];
    onChange({ ...settings, roomTypes: next.length > 0 ? next : ALL_ROOMS });
  }

  return (
    <div className="space-y-3">
      {/* ── Settings panel ── */}
      <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-3 space-y-3">
        <div className="flex items-center gap-1.5">
          <Settings2 className="h-3.5 w-3.5 text-orange-600" />
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-orange-700">
            Group Matrix Settings
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-600">Min Pax</span>
            <input
              type="number"
              min={1}
              value={settings.minPax}
              onChange={(e) => onChange({ ...settings, minPax: Math.max(1, parseInt(e.target.value) || 1) })}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-600">Max Pax</span>
            <input
              type="number"
              min={settings.minPax}
              value={settings.maxPax}
              onChange={(e) => onChange({ ...settings, maxPax: Math.max(settings.minPax, parseInt(e.target.value) || settings.minPax) })}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-600">Step (selisih tier)</span>
            <input
              type="number"
              min={1}
              value={settings.step}
              onChange={(e) => onChange({ ...settings, step: Math.max(1, parseInt(e.target.value) || 1) })}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-600">Display Currency</span>
            <select
              value={settings.displayCurrency}
              onChange={(e) => onChange({ ...settings, displayCurrency: e.target.value as CalcCurrency })}
              className="h-8 px-2 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold"
            >
              <option value="IDR">IDR (Rupiah)</option>
              <option value="USD">USD (Dollar)</option>
              <option value="SAR">SAR (Riyal)</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold text-slate-600">Tipe Kamar:</span>
          {ALL_ROOMS.map((r) => {
            const active = activeRooms.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => toggleRoom(r)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border",
                  active
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
                )}
              >
                {r} <span className="opacity-70">({ROOM_SHARING[r]}/kmr)</span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-600">Round ke:</span>
            <select
              value={settings.roundTo}
              onChange={(e) => onChange({ ...settings, roundTo: parseInt(e.target.value) })}
              className="h-7 px-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold"
            >
              <option value={0}>tidak dibulatkan</option>
              <option value={1}>1</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={1000}>1.000</option>
              <option value={10000}>10.000</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Matrix output ── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-gradient-to-r from-orange-500 to-amber-500 text-white">
          <Users className="h-4 w-4" />
          <span className="text-[12px] font-extrabold uppercase tracking-wider">
            Matrix Harga Group ({settings.displayCurrency})
          </span>
          <span className="ml-auto text-[10px] opacity-80">
            harga/pax · sudah include margin{" "}
            {inputs.marginMode === "fixed"
              ? `IDR ${(inputs.marginFixed ?? 0).toLocaleString("id-ID")}/pax`
              : `${inputs.marginPercent}%`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-bold text-slate-600 border-b border-slate-200">
                  TOTAL PAX
                </th>
                {activeRooms.map((r) => (
                  <th key={r} className="text-right px-3 py-2 font-bold text-slate-600 border-b border-slate-200">
                    {r.toUpperCase()}
                    <div className="text-[9px] font-normal text-slate-400">
                      {ROOM_SHARING[r]} org / kamar
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, i) => (
                <tr key={`${tier.min}-${tier.max}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  <td className="px-3 py-2 font-bold text-slate-700 border-b border-slate-100">
                    {tier.min}{tier.max !== tier.min ? `–${tier.max}` : ""} PAX
                  </td>
                  {activeRooms.map((r) => {
                    const cell = quote.cells.find(
                      (c) => c.tier.min === tier.min && c.tier.max === tier.max && c.room === r,
                    );
                    return (
                      <td key={r} className="px-3 py-2 text-right font-mono font-semibold text-orange-600 border-b border-slate-100">
                        {cell ? fmt(cell.perPaxDisplay, settings.displayCurrency) : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* footer breakdown */}
        <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[10.5px] text-slate-600 grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1">
          <div>
            <span className="font-bold">Fixed grup:</span> {fmt(quote.fixedTotalIDR, "IDR")}
            <span className="text-slate-400"> (transport + staff + komisi)</span>
          </div>
          <div>
            <span className="font-bold">Per-pax flat:</span> {fmt(quote.perPaxFlatIDR, "IDR")}
            <span className="text-slate-400"> (tiket + visa + dest + fnb)</span>
          </div>
          <div>
            <span className="font-bold">Hotel (per kamar / stay):</span>{" "}
            {quote.hotelBreakdown.map((h) => {
              const r = h.ratesPerRoomIDR;
              const allEqual = r.Quad === r.Triple && r.Triple === r.Double;
              if (allEqual) {
                return `${h.label} ${fmt(r.Quad, "IDR")}`;
              }
              return `${h.label} Q ${fmt(r.Quad, "IDR")} · T ${fmt(r.Triple, "IDR")} · D ${fmt(r.Double, "IDR")}`;
            }).join("  ·  ")}
          </div>
        </div>
      </div>
    </div>
  );
}
