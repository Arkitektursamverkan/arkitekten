/**
 * MALLEN för BMT-exporten (`src/tools/affarsprocess/bmt.ts`): en vanlig
 * modellexport ur mål-repositoryt. Utan den finns ingen export – knappen
 * visas inte. Filen läses vid varje begäran, som logotypen, så att en ny mall
 * gäller utan omstart.
 *
 * Två källor:
 *   1. miljön: `ARK_BMT_MALL` (sökväg till filen) – den som installerar pekar
 *      ut en fil den själv lagt dit,
 *   2. uppladdningen: en administratör laddar upp mallen under Inställningar
 *      och den sparas som `bmt-mall.bmt` i `STILAR_DIR`, bredvid
 *      installationens övriga val (klassning.json, kategorier.json). Det är
 *      vägen för den som inte når serverns filer.
 * Miljön vinner när den pekar på en läsbar mall, som för utseendet.
 *
 * Mallen bär repositoryts profil, scheman, språk och användare. Den behöver
 * inte innehålla någon process – en export av en tom modell räcker – och ska
 * vara LITEN: en export av hela repositoryt fungerar men skickas till
 * webbläsaren vid varje export.
 */

import fs from "node:fs";
import path from "node:path";
import { inställningarUrMall } from "../src/core/bmt-mall";
import { läsZip } from "../src/core/zip";
import { Användarfel } from "./fel";

/** Övre gräns – en mall är en enda modell, sällan över någon megabyte. */
export const MAX_MALL = 40 * 1024 * 1024;

/** Den uppladdade mallens filnamn i `STILAR_DIR`. */
export const BMT_MALLFIL = "bmt-mall.bmt";

export type BmtMallKälla = "miljö" | "uppladdad";

export interface BmtMallInfo {
  /** Var mallen kommer ifrån, eller null när installationen inte har någon. */
  källa: BmtMallKälla | null;
  /** Byte. */
  storlek?: number;
  /** När filen senast skrevs (ISO). */
  ändrad?: string;
}

export function bmtMallFil(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.ARK_BMT_MALL?.trim() || undefined;
}

/** Filens innehåll om den är ett zip-arkiv av rimlig storlek, annars null. */
function läsFil(fil: string): { data: Buffer; ändrad: Date } | null {
  try {
    const st = fs.statSync(fil);
    if (!st.isFile() || st.size === 0 || st.size > MAX_MALL) return null;
    const data = fs.readFileSync(fil);
    // Ett zip-arkiv börjar med "PK\x03\x04".
    return data.length >= 4 && data.readUInt32LE(0) === 0x04034b50 ? { data, ändrad: st.mtime } : null;
  } catch {
    return null;
  }
}

/** Pekar miljön ut en mall som inte går att läsa? (Startens varning.) */
export function miljönsBmtMallOläsbar(env: NodeJS.ProcessEnv = process.env): boolean {
  const fil = bmtMallFil(env);
  return Boolean(fil) && !läsFil(fil!);
}

function gällande(dir: string, env: NodeJS.ProcessEnv): { källa: BmtMallKälla; data: Buffer; ändrad: Date } | null {
  const urMiljön = bmtMallFil(env);
  const egen = urMiljön ? läsFil(urMiljön) : null;
  if (egen) return { källa: "miljö", ...egen };
  const uppladdad = läsFil(path.join(dir, BMT_MALLFIL));
  return uppladdad ? { källa: "uppladdad", ...uppladdad } : null;
}

/** Mallens innehåll, eller null när installationen inte har någon läsbar mall. */
export function läsBmtMall(dir: string, env: NodeJS.ProcessEnv = process.env): Buffer | null {
  return gällande(dir, env)?.data ?? null;
}

/** Vad Inställningar visar om mallen – aldrig serverns sökväg. */
export function bmtMallInfo(dir: string, env: NodeJS.ProcessEnv = process.env): BmtMallInfo {
  const m = gällande(dir, env);
  return m ? { källa: m.källa, storlek: m.data.length, ändrad: m.ändrad.toISOString() } : { källa: null };
}

/**
 * Sparar en uppladdad mall (administratören). Filen PRÖVAS först med samma
 * läsare som exporten använder – en fil som exporten inte kan bygga på ska
 * avvisas här, inte ge en knapp som felar för alla.
 */
export async function sparaBmtMall(dir: string, data: Buffer): Promise<void> {
  if (data.length === 0) throw new Användarfel("Filen är tom.");
  if (data.length > MAX_MALL) throw new Användarfel(`Mallen är för stor (högst ${Math.round(MAX_MALL / (1024 * 1024))} MB).`);
  if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50)
    throw new Användarfel("Filen är inte en modellexport (.bmt) – den ska vara ett zip-arkiv.");
  try {
    inställningarUrMall(await läsZip(new Uint8Array(data)));
  } catch (e) {
    throw new Användarfel(
      `Filen går inte att använda som mall: ${e instanceof Error ? e.message : "arkivet gick inte att läsa."}`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  const fil = path.join(dir, BMT_MALLFIL);
  const tmp = `${fil}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, fil);
}

/** Tar bort den uppladdade mallen. En mall ur miljön rörs aldrig. */
export function taBortBmtMall(dir: string): void {
  fs.rmSync(path.join(dir, BMT_MALLFIL), { force: true });
}
