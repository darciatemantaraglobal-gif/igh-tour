/**
 * Realtime sync — subscribe ke perubahan tabel dari device lain & refresh stores.
 */
import { supabase, isSupabaseConfigured } from "./supabase";
import { useTripsStore, useJamaahStore } from "@/store/tripsStore";
import { usePackagesStore } from "@/store/packagesStore";
import { pullPdfLayoutPresets } from "./cloudSync";
import { useSyncStatusStore } from "@/store/syncStatusStore";
import type { RealtimeChannel } from "@supabase/supabase-js";

let channel: RealtimeChannel | null = null;

/** Listeners untuk preset Tuner — komponen tuner subscribe biar UI auto-refresh. */
type PresetListener = () => void;
const presetListeners = new Set<PresetListener>();

export function onPdfPresetsChanged(fn: PresetListener): () => void {
  presetListeners.add(fn);
  return () => presetListeners.delete(fn);
}

/**
 * Debounce helper — cegah multiple rapid-fire refetch saat banyak baris
 * berubah sekaligus (contoh: bulk import jamaah atau sync dari device lain).
 */
function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return function (this: unknown, ...args: Parameters<T>) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  } as T;
}

export function startRealtimeSync(): () => void {
  if (!isSupabaseConfigured() || channel) return () => undefined;

  // Debounced handlers — 600 ms window cukup untuk menggabungkan burst changes
  // tanpa terasa lambat bagi user (operasi tunggal masih near-instant).
  const debouncedFetchTrips = debounce(
    () => void useTripsStore.getState().fetchTrips(),
    600,
  );
  const debouncedRefreshPackages = debounce(
    () => void usePackagesStore.getState().refresh(),
    600,
  );
  const debouncedRefreshPresets = debounce(() => {
    void pullPdfLayoutPresets().then(() => {
      for (const fn of presetListeners) fn();
    });
  }, 600);

  // Per-trip debounce map — setiap trip_id punya debounce sendiri supaya
  // perubahan di trip berbeda tetap di-fetch masing-masing, tapi burst
  // changes di trip yang sama digabung.
  const jamaahDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();
  const debouncedFetchJamaah = (tripId: string) => {
    const existing = jamaahDebounceMap.get(tripId);
    if (existing) clearTimeout(existing);
    jamaahDebounceMap.set(
      tripId,
      setTimeout(() => {
        jamaahDebounceMap.delete(tripId);
        void useJamaahStore.getState().fetchJamaah(tripId);
      }, 600),
    );
  };

  channel = supabase!
    .channel("igh-tour-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, () => {
      debouncedFetchTrips();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "jamaah" }, (payload) => {
      const tripId =
        (payload.new as { trip_id?: string } | null)?.trip_id ??
        (payload.old as { trip_id?: string } | null)?.trip_id;
      if (tripId) debouncedFetchJamaah(tripId);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "packages" }, () => {
      debouncedRefreshPackages();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "pdf_layout_presets" }, () => {
      // Refresh cache lalu broadcast ke semua tuner yang sedang dibuka.
      debouncedRefreshPresets();
    })
    .subscribe((status) => {
      // Map realtime channel status → sync indicator
      const sync = useSyncStatusStore.getState();
      if (status === "SUBSCRIBED") sync.markSyncOk();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") sync.markSyncError(`Realtime: ${status}`);
      else if (status === "CLOSED") sync.setOnline(navigator.onLine);
    });

  return () => {
    // Bersihkan semua pending debounce timers sebelum unsubscribe
    for (const timer of jamaahDebounceMap.values()) clearTimeout(timer);
    jamaahDebounceMap.clear();
    if (channel) {
      void supabase!.removeChannel(channel);
      channel = null;
    }
  };
}
