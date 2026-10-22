/**
 * INNEHÅLLSPAKET – en installations innehåll som filer: processerna, visuali-
 * seringarna och symbolstilarna. Samma tanke som portalens innehållspaket
 * (arkitekturportalen/docs/INNEHALLSPAKET.md): flytta innehåll mellan
 * installationer, lägga in ett exempel i en ny, spara det i ett eget repo.
 *
 * Ett paket är en katalog:
 *
 *   pack.json           { format, version, namn, beskrivning, antal }
 *   flows/<id>.json     processer, med hela sin historik
 *   ramar/<id>.json     visualiseringar
 *   stilar/<id>.json    symbolstilar
 *
 * IMPORTEN SKRIVER ALDRIG ÖVER. Finns ett flöde med samma id redan rörs det
 * inte – en befintlig version får aldrig skrivas över (invariant 11). Det gäller
 * visualiseringar och stilar också. Valet av stil (`vald.json`) följer aldrig
 * med: det är installationens, inte paketets.
 *
 *   npx tsx server/innehallspaket.mts list
 *   npx tsx server/innehallspaket.mts export <katalog> --namn <namn> [--utan-egna]
 *   npx tsx server/innehallspaket.mts import <katalog|exempelnamn> [--torrkorning]
 *
 * Katalogerna är installationens (FLOWS_DIR, RAMAR_DIR, STILAR_DIR).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { läsSymbolstil } from "../src/tools/affarsprocess/symbolstil";
import { installningarUrMiljö, type Installningar } from "./installningar";

export const FORMAT = "arkitekten.innehallspaket";
export const VERSION = 1;
const SAFE_ID = /^[a-z0-9-]{1,64}$/;

/** Paketen som följer med produkten (neutrala exempel). */
export const EXEMPELKATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "innehallspaket");

type Sort = "flows" | "ramar" | "stilar";
const SORTER: Sort[] = ["flows", "ramar", "stilar"];

export interface Paketinfo {
  format: string;
  version: number;
  namn: string;
  beskrivning?: string;
  antal?: Partial<Record<Sort, number>>;
}

export interface Importrapport {
  inlagda: string[];
  oförändrade: string[];
  /** Fanns redan med annat innehåll – rördes inte. */
  befintliga: string[];
  fel: string[];
}

function katalogFör(inst: Pick<Installningar, "flowsDir" | "ramarDir" | "stilarDir">, sort: Sort): string {
  return sort === "flows" ? inst.flowsDir : sort === "ramar" ? inst.ramarDir : inst.stilarDir;
}

const jsonFiler = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "vald.json").sort() : [];

export function läsPaketinfo(dir: string): Paketinfo {
  const fil = path.join(dir, "pack.json");
  if (!fs.existsSync(fil)) throw new Error(`${dir} är inget innehållspaket (pack.json saknas).`);
  const info = JSON.parse(fs.readFileSync(fil, "utf8")) as Paketinfo;
  if (info.format !== FORMAT) throw new Error(`Okänt paketformat: ${String(info.format)}.`);
  if (info.version > VERSION) throw new Error(`Paketet är version ${info.version}; den här Arkitekten läser till och med ${VERSION}.`);
  return info;
}

/** Prövar en fil ur ett paket. Kastar med ett begripligt fel. */
function prövaFil(sort: Sort, id: string, data: unknown): void {
  if (!SAFE_ID.test(id)) throw new Error("ogiltigt id i filnamnet");
  if (!data || typeof data !== "object") throw new Error("inte ett JSON-objekt");
  const d = data as Record<string, unknown>;
  if (sort === "stilar") {
    if (läsSymbolstil(d).id !== id) throw new Error("stilens id stämmer inte med filnamnet");
    return;
  }
  if (d.id !== id) throw new Error("id:t stämmer inte med filnamnet");
  if (sort === "flows" && (typeof d.name !== "string" || typeof d.draft !== "object"))
    throw new Error("saknar namn eller mellanlager");
}

export function importera(
  inst: Pick<Installningar, "flowsDir" | "ramarDir" | "stilarDir">,
  paket: string,
  { torrkörning = false }: { torrkörning?: boolean } = {},
): Importrapport {
  läsPaketinfo(paket);
  const r: Importrapport = { inlagda: [], oförändrade: [], befintliga: [], fel: [] };
  for (const sort of SORTER) {
    const mål = katalogFör(inst, sort);
    for (const f of jsonFiler(path.join(paket, sort))) {
      const id = f.slice(0, -5);
      const namn = `${sort}/${f}`;
      let data: unknown;
      try {
        data = JSON.parse(fs.readFileSync(path.join(paket, sort, f), "utf8"));
        prövaFil(sort, id, data);
      } catch (e) {
        r.fel.push(`${namn}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const målfil = path.join(mål, f);
      if (fs.existsSync(målfil)) {
        const befintlig = JSON.parse(fs.readFileSync(målfil, "utf8"));
        (isDeepStrictEqual(befintlig, data) ? r.oförändrade : r.befintliga).push(namn);
        continue;
      }
      if (!torrkörning) {
        fs.mkdirSync(mål, { recursive: true });
        fs.writeFileSync(målfil, JSON.stringify(data, null, 2), "utf8");
      }
      r.inlagda.push(namn);
    }
  }
  return r;
}

export function exportera(
  inst: Pick<Installningar, "flowsDir" | "ramarDir" | "stilarDir">,
  ut: string,
  { namn, beskrivning, utanEgna = false }: { namn: string; beskrivning?: string; utanEgna?: boolean },
): Paketinfo {
  if (fs.existsSync(ut) && fs.readdirSync(ut).length) throw new Error(`${ut} finns redan och är inte tom.`);
  const antal: Partial<Record<Sort, number>> = {};
  for (const sort of SORTER) {
    const källa = katalogFör(inst, sort);
    let n = 0;
    for (const f of jsonFiler(källa)) {
      const text = fs.readFileSync(path.join(källa, f), "utf8");
      // Användarnas egna processer (Mina processer) kan lämnas hemma.
      if (sort === "flows" && utanEgna && JSON.parse(text).ägare) continue;
      fs.mkdirSync(path.join(ut, sort), { recursive: true });
      fs.writeFileSync(path.join(ut, sort, f), text, "utf8");
      n++;
    }
    if (n) antal[sort] = n;
  }
  const info: Paketinfo = { format: FORMAT, version: VERSION, namn, ...(beskrivning ? { beskrivning } : {}), antal };
  fs.mkdirSync(ut, { recursive: true });
  fs.writeFileSync(path.join(ut, "pack.json"), JSON.stringify(info, null, 2) + "\n", "utf8");
  return info;
}

/** Exempelpaketen som följer med produkten. */
export function exempelpaket(): Array<{ katalog: string; info: Paketinfo }> {
  if (!fs.existsSync(EXEMPELKATALOG)) return [];
  return fs
    .readdirSync(EXEMPELKATALOG)
    .map((d) => path.join(EXEMPELKATALOG, d))
    .filter((d) => fs.existsSync(path.join(d, "pack.json")))
    .map((katalog) => ({ katalog, info: läsPaketinfo(katalog) }));
}

/* ---- Kommandoraden ---- */

if (process.argv[1] && /innehallspaket\.mts$/.test(process.argv[1])) {
  const [kommando, mål, ...resten] = process.argv.slice(2);
  const flagga = (n: string) => resten.includes(n);
  const värde = (n: string) => {
    const i = resten.indexOf(n);
    return i >= 0 ? resten[i + 1] : undefined;
  };
  const inst = installningarUrMiljö(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  try {
    if (kommando === "list") {
      for (const { katalog, info } of exempelpaket())
        console.log(`${path.basename(katalog)}\t${info.namn}${info.beskrivning ? ` – ${info.beskrivning}` : ""}`);
    } else if (kommando === "export" && mål) {
      const info = exportera(inst, path.resolve(mål), {
        namn: värde("--namn") ?? path.basename(mål),
        beskrivning: värde("--beskrivning"),
        utanEgna: flagga("--utan-egna"),
      });
      console.log(`Exporterat till ${mål}: ${JSON.stringify(info.antal)}`);
    } else if (kommando === "import" && mål) {
      const katalog = fs.existsSync(mål) ? mål : path.join(EXEMPELKATALOG, mål);
      const r = importera(inst, katalog, { torrkörning: flagga("--torrkorning") });
      const rad = (rubrik: string, l: string[]) => l.length && console.log(`${rubrik} (${l.length}):\n  ${l.join("\n  ")}`);
      rad(flagga("--torrkorning") ? "Skulle läggas in" : "Inlagda", r.inlagda);
      rad("Oförändrade", r.oförändrade);
      rad("Fanns redan med annat innehåll – rördes inte", r.befintliga);
      rad("Fel", r.fel);
      if (r.fel.length) process.exitCode = 1;
    } else {
      console.error("Användning: list | export <katalog> --namn <namn> [--utan-egna] | import <katalog|exempel> [--torrkorning]");
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
