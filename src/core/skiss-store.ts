/**
 * Lagringen för systemskisser – samma upplägg som ramserierna: disk via
 * ark-bryggan (`skisser/*.json`) när servern kör, annars localStorage.
 *
 * Skisserna ligger i en EGEN katalog, inte bland flödena: en systemskiss är
 * ingen process (core/systemskiss.ts). Allt som läses går genom `läsSkiss`.
 */

import { bridgeJson, isJson } from "./flow-store";
import type { FlowStatus } from "./status";
import { läggTillSkissversion, läsSkiss, sammanfattaSkiss, type SkissSammanfattning, type Systemskiss } from "./systemskiss";

/** Vad sparningen ska bli: utkast (förval) eller fastslagen, och en frivillig kommentar. */
export interface Sparval {
  status?: FlowStatus;
  label?: string;
}

export interface SkissStore {
  kind: "disk" | "local";
  list(): Promise<SkissSammanfattning[]>;
  load(id: string): Promise<Systemskiss>;
  /**
   * Sparar och returnerar skissen SOM DEN SPARADES (bryggan stämplar skapare,
   * tid och synlighet, och lägger en ny version sist när något ändrats).
   */
  save(skiss: Systemskiss, val?: Sparval): Promise<Systemskiss>;
  remove(id: string): Promise<void>;
}

function tolka(rå: unknown): Systemskiss {
  const skiss = läsSkiss(rå);
  if (!skiss) throw new Error("Skissen gick inte att läsa.");
  return skiss;
}

const diskStore: SkissStore = {
  kind: "disk",
  async list() {
    return (await bridgeJson("/__ark/skisser")).skisser as SkissSammanfattning[];
  },
  async load(id) {
    return tolka((await bridgeJson(`/__ark/skisser/${encodeURIComponent(id)}`)).skiss);
  },
  async save(skiss, val) {
    // Historiken skickas inte – bryggan bygger den ur filen (invariant 11).
    const { versioner: _v, ...utan } = skiss;
    const svar = await bridgeJson(`/__ark/skisser/${encodeURIComponent(skiss.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...utan, sparval: { status: val?.status, label: val?.label } }),
    });
    return tolka(svar.skiss);
  },
  async remove(id) {
    await bridgeJson(`/__ark/skisser/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

const LS_PREFIX = "ark.skiss.";

/** localStorage-lagring. `storage` injiceras för test. */
export function createLocalSkissStore(storage: Storage): SkissStore {
  const read = (key: string): Systemskiss | null => {
    try {
      return läsSkiss(JSON.parse(storage.getItem(key) ?? ""));
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
        .filter((s): s is Systemskiss => s !== null)
        .map(sammanfattaSkiss)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    async load(id) {
      const s = read(LS_PREFIX + id);
      if (!s) throw new Error("Skissen finns inte.");
      return s;
    },
    async save(skiss, val) {
      const nu = new Date().toISOString();
      const sparad = { ...läggTillSkissversion(read(LS_PREFIX + skiss.id), skiss, { ...val, nu }), savedAt: nu };
      storage.setItem(LS_PREFIX + skiss.id, JSON.stringify(sparad));
      return sparad;
    },
    async remove(id) {
      storage.removeItem(LS_PREFIX + id);
    },
  };
}

let cached: SkissStore | null = null;

/** Disk om bryggan svarar, annars webbläsaren – samma tysta reserv som flödena. */
export async function getSkissStore(): Promise<SkissStore> {
  if (cached) return cached;
  try {
    const res = await fetch("/__ark/skisser");
    // Också 401 betyder att bryggan finns (se getFlowStore).
    if (isJson(res)) {
      cached = diskStore;
      return cached;
    }
  } catch {
    // ingen brygga
  }
  cached = createLocalSkissStore(window.localStorage);
  return cached;
}
