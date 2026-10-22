/**
 * Installationens symbolstilar – katalogen `STILAR_DIR`.
 *
 * Varje `*.json` i katalogen är en stil (src/tools/affarsprocess/symbolstil.ts),
 * lagd där av den som installerar – typiskt ur ett innehållspaket. Standard-
 * stilen finns alltid och behöver ingen fil. Valet står i `vald.json`
 * (`{ "id": "…" }`) och skrivs bara av en administratör via bryggan.
 *
 * Bryggan och flödestjänsten läser SAMMA katalog, så appen och portalens
 * bilder alltid har samma stil. Valet läses om när filen ändrats – ingen
 * omstart behövs efter ett byte.
 */

import fs from "node:fs";
import path from "node:path";
import { NEUTRAL_STIL, läsSymbolstil, type Symbolstil } from "../src/tools/affarsprocess/symbolstil";

const VALD = "vald.json";

export interface Stilkatalog {
  stilar: Symbolstil[];
  /** Filer som inte gick att läsa – visas för administratören, stoppar inget. */
  fel: string[];
}

/** Standardstilen först, sedan paketen i namnordning. En trasig fil hoppas över. */
export function läsStilar(dir: string): Stilkatalog {
  const stilar: Symbolstil[] = [NEUTRAL_STIL];
  const fel: string[] = [];
  if (!fs.existsSync(dir)) return { stilar, fel };
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== VALD).sort()) {
    try {
      const stil = läsSymbolstil(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (stilar.some((s) => s.id === stil.id)) throw new Error(`id:t ${stil.id} finns redan`);
      stilar.push(stil);
    } catch (e) {
      fel.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { stilar, fel };
}

let cache: { nyckel: string; stil: Symbolstil } | null = null;

/** Ändringstiderna som avgör om valet måste läsas om. */
function nyckel(dir: string): string {
  if (!fs.existsSync(dir)) return dir;
  return `${dir}|${fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`)
    .join(",")}`;
}

/** Den valda stilen; standardstilen om inget är valt eller valet inte finns. */
export function valdStil(dir: string): Symbolstil {
  const n = nyckel(dir);
  if (cache?.nyckel === n) return cache.stil;
  let id = NEUTRAL_STIL.id;
  try {
    id = String(JSON.parse(fs.readFileSync(path.join(dir, VALD), "utf8")).id ?? id);
  } catch {
    /* inget val – standardstilen */
  }
  const stil = läsStilar(dir).stilar.find((s) => s.id === id) ?? NEUTRAL_STIL;
  cache = { nyckel: n, stil };
  return stil;
}

/** Väljer en stil (administratören). Ett okänt id är ett fel, inte ett tyst byte. */
export function väljStil(dir: string, id: string): Symbolstil {
  const stil = läsStilar(dir).stilar.find((s) => s.id === id);
  if (!stil) throw new Error(`Symbolstilen ${id} finns inte.`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, VALD), JSON.stringify({ id }, null, 2), "utf8");
  cache = null;
  return stil;
}
