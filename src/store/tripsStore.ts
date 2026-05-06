import { create } from "zustand";
import {
  listTrips, createTrip, updateTrip, deleteTrip,
  listJamaah, createJamaah, createJamaahBulk, updateJamaah, deleteJamaah, getJamaah,
  listDocs, addDoc, deleteDoc,
  type Trip, type Jamaah, type JamaahDoc, type DocCategory,
} from "@/features/trips/tripsRepo";
import { syncBus } from "@/lib/syncBus";

interface TripsState {
  trips: Trip[];
  loadingTrips: boolean;
  fetchTrips: () => Promise<void>;
  addTrip: (draft: Omit<Trip, "id" | "createdAt">) => Promise<Trip>;
  patchTrip: (id: string, patch: Partial<Trip>) => Promise<void>;
  removeTrip: (id: string) => Promise<void>;
}

export const useTripsStore = create<TripsState>((set) => ({
  trips: [],
  loadingTrips: false,

  fetchTrips: async () => {
    set({ loadingTrips: true });
    try {
      const data = await listTrips();
      set({ trips: data, loadingTrips: false });
    } catch (err) {
      // Jangan timpa trips jadi [] — biar UI tetap nampilin data lama (kalau ada)
      // daripada keliatan "hilang" gara-gara hiccup network/RLS.
      console.error("[tripsStore] fetchTrips failed:", err);
      set((s) => ({ trips: s.trips, loadingTrips: false }));
    }
  },

  addTrip: async (draft) => {
    const t = await createTrip(draft);
    set((s) => ({ trips: [t, ...s.trips] }));
    syncBus.emit({ type: "trips", action: "create", id: t.id });
    return t;
  },

  patchTrip: async (id, patch) => {
    const updated = await updateTrip(id, patch);
    set((s) => ({ trips: s.trips.map((t) => (t.id === id ? updated : t)) }));
    syncBus.emit({ type: "trips", action: "update", id });
  },

  removeTrip: async (id) => {
    await deleteTrip(id);
    set((s) => ({ trips: s.trips.filter((t) => t.id !== id) }));
    syncBus.emit({ type: "trips", action: "delete", id });
  },
}));

interface JamaahState {
  jamaah: Jamaah[];
  loadingJamaah: boolean;
  fetchJamaah: (tripId: string) => Promise<void>;
  addJamaah: (draft: Omit<Jamaah, "id" | "createdAt">) => Promise<Jamaah>;
  addJamaahBulk: (
    drafts: Omit<Jamaah, "id" | "createdAt">[],
    onProgress?: (uploaded: number, total: number) => void,
  ) => Promise<Jamaah[]>;
  patchJamaah: (id: string, patch: Partial<Jamaah>) => Promise<void>;
  removeJamaah: (id: string) => Promise<void>;
  getOne: (id: string) => Promise<Jamaah | null>;
}

export const useJamaahStore = create<JamaahState>((set) => ({
  jamaah: [],
  loadingJamaah: false,

  fetchJamaah: async (tripId) => {
    set({ loadingJamaah: true });
    const data = await listJamaah(tripId);
    set((s) => ({
      // Pertahankan jamaah dari trip LAIN, hanya ganti jamaah milik tripId ini.
      jamaah: [...s.jamaah.filter((j) => j.tripId !== tripId), ...data],
      loadingJamaah: false,
    }));
  },

  addJamaah: async (draft) => {
    const j = await createJamaah(draft);
    set((s) => ({ jamaah: [...s.jamaah, j] }));
    syncBus.emit({ type: "jamaah", action: "create", id: j.id });
    return j;
  },

  addJamaahBulk: async (drafts, onProgress) => {
    const created = await createJamaahBulk(drafts, onProgress);
    set((s) => ({ jamaah: [...s.jamaah, ...created] }));
    for (const j of created) syncBus.emit({ type: "jamaah", action: "create", id: j.id });
    return created;
  },

  patchJamaah: async (id, patch) => {
    const updated = await updateJamaah(id, patch);
    set((s) => ({ jamaah: s.jamaah.map((j) => (j.id === id ? updated : j)) }));
    syncBus.emit({ type: "jamaah", action: "update", id });
  },

  removeJamaah: async (id) => {
    await deleteJamaah(id);
    set((s) => ({ jamaah: s.jamaah.filter((j) => j.id !== id) }));
    syncBus.emit({ type: "jamaah", action: "delete", id });
  },

  getOne: getJamaah,
}));

interface DocsState {
  docs: JamaahDoc[];
  loadingDocs: boolean;
  fetchDocs: (jamaahId: string) => Promise<void>;
  addDocument: (draft: Omit<JamaahDoc, "id" | "createdAt">) => Promise<JamaahDoc>;
  removeDoc: (id: string) => Promise<void>;
}

export const useDocsStore = create<DocsState>((set) => ({
  docs: [],
  loadingDocs: false,

  fetchDocs: async (jamaahId) => {
    set({ loadingDocs: true });
    const data = await listDocs(jamaahId);
    set((s) => ({
      // Pertahankan docs milik jamaah LAIN, hanya ganti docs milik jamaahId ini.
      docs: [...s.docs.filter((d) => d.jamaahId !== jamaahId), ...data],
      loadingDocs: false,
    }));
  },

  addDocument: async (draft) => {
    const d = await addDoc(draft);
    set((s) => ({ docs: [...s.docs, d] }));
    syncBus.emit({ type: "docs", action: "create", id: d.id });
    return d;
  },

  removeDoc: async (id) => {
    await deleteDoc(id);
    set((s) => ({ docs: s.docs.filter((d) => d.id !== id) }));
    syncBus.emit({ type: "docs", action: "delete", id });
  },
}));

export type { Trip, Jamaah, JamaahDoc, DocCategory };
