/**
 * Installationens KATEGORIREGISTER (core/kategoriregister.ts) – filen
 * `kategorier.json` i `STILAR_DIR`, bredvid klassningsinställningen: samma
 * katalog som bryggan redan skriver installationens val i, så inget nytt
 * behöver monteras. Filen skrivs bara av bryggan.
 */

import fs from "node:fs";
import path from "node:path";
import { läsKategoriregister, type Kategoriregister } from "../src/core/kategoriregister";

export const KATEGORIFIL = "kategorier.json";

export function läsKategoriregisterFil(dir: string): Kategoriregister {
  try {
    return läsKategoriregister(JSON.parse(fs.readFileSync(path.join(dir, KATEGORIFIL), "utf8")));
  } catch {
    return läsKategoriregister(null);
  }
}

/** Sparar registret. Det som sparas är det prövade, och skrivningen är atomär. */
export function sparaKategoriregister(dir: string, reg: Kategoriregister): Kategoriregister {
  const prövat = läsKategoriregister(reg);
  fs.mkdirSync(dir, { recursive: true });
  const fil = path.join(dir, KATEGORIFIL);
  const tmp = `${fil}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(prövat, null, 2), "utf8");
  fs.renameSync(tmp, fil);
  return prövat;
}
