/**
 * Lagringen för ramserier – samma upplägg som flödesbiblioteket: disk via
 * ark-bryggan (`ramar/*.json`) när dev-servern kör, annars localStorage.
 *
 * Ramarna ligger i en EGEN katalog, inte bland flödena. En ramserie är ingen
 * process – den har ingen historik, ingen status och ingen plats i katalogen –
 * och i `flows/` hade både katalogen, speglingen till EA-portalen och
 * versionsreglerna (invariant 11) behövt lära sig att hoppa över den.
 */

import { bridgeJson, isJson } from "./flow-store";
import { sammanfatta, type Ramserie, type RamserieSammanfattning } from "./ram";

export interface RamStore {
  kind: "disk" | "local";
  list(): Promise<RamserieSammanfattning[]>;
  load(id: string): Promise<Ramserie>;
  save(serie: Ramserie): Promise<void>;
  remove(id: string): Promise<void>;
}

const diskStore: RamStore = {
  kind: "disk",
  async list() {
    return (await bridgeJson("/__ark/ramar")).ramar as RamserieSammanfattning[];
  },
  async load(id) {
    return (await bridgeJson(`/__ark/ramar/${encodeURIComponent(id)}`)).serie as Ramserie;
  },
  async save(serie) {
    await bridgeJson(`/__ark/ramar/${encodeURIComponent(serie.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(serie),
    });
  },
  async remove(id) {
    await bridgeJson(`/__ark/ramar/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

const LS_PREFIX = "ark.ramserie.";

/** localStorage-lagring. `storage` injiceras för test. */
export function createLocalRamStore(storage: Storage): RamStore {
  const read = (key: string): Ramserie | null => {
    try {
      return JSON.parse(storage.getItem(key) ?? "");
    } catch {
      return null;
    }
  };
  return {
    kind: "local",
    async list() {
      return Object.keys(storage)
        .filter((k) => k.startsWith(LS_PREFIX))
        .map(read)
        .filter((s): s is Ramserie => s !== null)
        .map(sammanfatta)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    async load(id) {
      const s = read(LS_PREFIX + id);
      if (!s) throw new Error("Visualiseringen finns inte.");
      return s;
    },
    async save(serie) {
      storage.setItem(LS_PREFIX + serie.id, JSON.stringify(serie));
    },
    async remove(id) {
      storage.removeItem(LS_PREFIX + id);
    },
  };
}

/**
 * Sänds när en ramserie sparats UTANFÖR Ramar (AI-presentationen skapar en
 * från verktygen). Ramar ligger monterad och läser annars bara sin lista en
 * gång – samma väg som FLOWS_CHANGED för flödena.
 */
export const RAMAR_CHANGED = "ark:ramar-changed";

export function meddelaRamarÄndrade(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(RAMAR_CHANGED));
}

let cached: RamStore | null = null;

/** Disk om bryggan svarar, annars webbläsaren – samma tysta reserv som flödena. */
export async function getRamStore(): Promise<RamStore> {
  if (cached) return cached;
  try {
    const res = await fetch("/__ark/ramar");
    if (isJson(res) && res.ok) {
      cached = diskStore;
      return cached;
    }
  } catch {
    // ingen brygga
  }
  cached = createLocalRamStore(window.localStorage);
  return cached;
}
