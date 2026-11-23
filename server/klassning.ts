/**
 * Installationens KLASSNINGSINSTÄLLNING (core/klassning.ts) – filen
 * `klassning.json` i `STILAR_DIR`.
 *
 * Varför i stilkatalogen: det är katalogen där installationens visningsval
 * redan står (`vald.json`), och flödestjänsten och bryggan läser den båda –
 * inget nytt att montera. Filen skrivs bara av en administratör via bryggan
 * och läses om när den ändrats (ingen omstart). Saknas filen är klassning AV.
 */

import fs from "node:fs";
import path from "node:path";
import { läsKlassningsinställning, type Klassningsinställning } from "../src/core/klassning";

export const KLASSNINGSFIL = "klassning.json";

let cache: { nyckel: string; inst: Klassningsinställning } | null = null;

export function läsKlassningsinställningFil(dir: string): Klassningsinställning {
  const fil = path.join(dir, KLASSNINGSFIL);
  let nyckel = "saknas";
  try {
    nyckel = String(fs.statSync(fil).mtimeMs);
  } catch {
    /* ingen fil – förvalet */
  }
  if (cache?.nyckel === `${fil}|${nyckel}`) return cache.inst;
  let inst = läsKlassningsinställning(null);
  try {
    inst = läsKlassningsinställning(JSON.parse(fs.readFileSync(fil, "utf8")));
  } catch {
    /* trasig eller saknad fil – förvalet (av) */
  }
  cache = { nyckel: `${fil}|${nyckel}`, inst };
  return inst;
}

/** Sparar inställningen (administratören). Det som sparas är det prövade. */
export function sparaKlassningsinställning(dir: string, rå: unknown): Klassningsinställning {
  const inst = läsKlassningsinställning(rå);
  fs.mkdirSync(dir, { recursive: true });
  const fil = path.join(dir, KLASSNINGSFIL);
  const tmp = `${fil}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(inst, null, 2), "utf8");
  fs.renameSync(tmp, fil);
  cache = null;
  return inst;
}
