/**
 * Systemskiss – en FRI skiss över en systemmiljö: servrar, tjänster, databaser,
 * nät och hur de hänger ihop.
 *
 * En systemskiss är INGEN process. Den har inget mellanlager, ingen tolkning
 * och ingen plats i processkatalogen – man ställer ut objekt, ramar in dem i
 * zoner (en miljö, ett nät, en värd) och drar kopplingar mellan dem. Därför
 * har den en egen modell och en egen lagring (core/skiss-store.ts), precis som
 * ramserierna: i `flows/` hade katalogen, speglingen till EA-portalen och
 * versionsreglerna behövt lära sig att hoppa över den.
 *
 * STABILA ID:N (invariant 2): varje objekt, zon och koppling får ett
 * slumpat id när det skapas – aldrig en räknare, som förskjuts när något tas
 * bort.
 *
 * Hjälparna returnerar `{ ...skiss, ändratFält }` (invariant 4). Det som kommer
 * UTIFRÅN – en fil, en begäran till bryggan – går däremot alltid genom
 * `läsSkiss`, som bygger om skissen fält för fält: bilden ritas som SVG-markup
 * och får aldrig bära något som inte prövats här.
 *
 * Modulen är beroendefri (ren TS, inget DOM): både bryggan och webbläsaren
 * laddar den.
 */

import type { Ägare } from "./behorighet";

/* ------------------------------------------------------------------ */
/* Datamodellen                                                        */
/* ------------------------------------------------------------------ */

/** Objektens sorter. Utseendet (färg, symbol) bor i tools/systemskiss/skiss-svg.ts. */
export const SKISS_SORTER = [
  { id: "server", namn: "Server" },
  { id: "tjanst", namn: "Tjänst" },
  { id: "databas", namn: "Databas" },
  { id: "container", namn: "Container" },
  { id: "lagring", namn: "Lagring" },
  { id: "klient", namn: "Klient" },
  { id: "anvandare", namn: "Användare" },
  { id: "natverk", namn: "Nätverk" },
  { id: "brandvagg", namn: "Brandvägg" },
  { id: "moln", namn: "Extern tjänst" },
  { id: "anteckning", namn: "Anteckning" },
] as const;

export type SkissSort = (typeof SKISS_SORTER)[number]["id"];

/** Zonernas färger – nycklar, inte färgvärden: värdena bor hos ritaren. */
export const ZON_FÄRGER = ["bla", "gron", "gul", "rod", "lila", "gra"] as const;
export type ZonFärg = (typeof ZON_FÄRGER)[number];

export type Pil = "till" | "båda" | "ingen";
export type Linje = "hel" | "streckad";

export interface SkissObjekt {
  id: string;
  sort: SkissSort;
  namn: string;
  /** Det som står under namnet: operativsystem, storlek, adress … Radbrytningar behålls. */
  text?: string;
  x: number;
  y: number;
  /** Bredd och MINSTA höjd – rutan växer nedåt när texten kräver det. */
  b: number;
  h: number;
}

/** En ram runt det som hör ihop: en miljö, ett nät, en värd. */
export interface SkissZon {
  id: string;
  namn: string;
  färg: ZonFärg;
  x: number;
  y: number;
  b: number;
  h: number;
}

export interface SkissKoppling {
  id: string;
  /** Objektens id:n. */
  från: string;
  till: string;
  /** T.ex. protokoll och port: "HTTPS 443". */
  etikett?: string;
  pil: Pil;
  linje: Linje;
}

export interface Systemskiss {
  id: string;
  namn: string;
  beskrivning?: string;
  /**
   * Dold = bara administratörer ser skissen (core/behorighet.ts). Skrivs BARA
   * av bryggan på en administratörs begäran (server/atkomst.ts).
   */
  dold?: boolean;
  savedAt: string;
  /** Den som skapade skissen. Skrivs bara av bryggan, vid skapandet. */
  skapadAv?: Ägare;
  objekt: SkissObjekt[];
  zoner: SkissZon[];
  kopplingar: SkissKoppling[];
}

/** Det listan visar. */
export interface SkissSammanfattning {
  id: string;
  namn: string;
  beskrivning?: string;
  dold?: boolean;
  savedAt: string;
  skapadAv?: Ägare;
  antalObjekt: number;
}

export function sammanfattaSkiss(s: Systemskiss): SkissSammanfattning {
  return {
    id: s.id,
    namn: s.namn,
    beskrivning: s.beskrivning,
    dold: s.dold || undefined,
    savedAt: s.savedAt,
    skapadAv: s.skapadAv,
    antalObjekt: s.objekt?.length ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Mått och gränser                                                    */
/* ------------------------------------------------------------------ */

/** Rutnätet objekt och zoner fäster mot. */
export const SKISS_RUTNÄT = 10;

export const OBJEKT_MÅTT = { b: 170, h: 64, minB: 90, minH: 44, maxB: 600, maxH: 600 } as const;
export const ZON_MÅTT = { b: 420, h: 260, minB: 120, minH: 80, maxB: 6000, maxH: 6000 } as const;

const MAX = { objekt: 400, zoner: 100, kopplingar: 800, namn: 120, text: 600, beskrivning: 2000, koordinat: 50_000 } as const;

const ID = /^[a-z0-9-]{1,64}$/;

export function fäst(v: number): number {
  return Math.round(v / SKISS_RUTNÄT) * SKISS_RUTNÄT;
}

/* ------------------------------------------------------------------ */
/* Id:n                                                                */
/* ------------------------------------------------------------------ */

function slump(längd: number): string {
  const tecken = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = new Uint8Array(längd);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (v) => tecken[v % tecken.length]).join("");
}

/** Ett nytt, slumpat id för ett objekt ("o"), en zon ("z") eller en koppling ("k"). */
export function nyttSkissId(prefix: "o" | "z" | "k"): string {
  return `${prefix}-${slump(8)}`;
}

/**
 * En NY skiss id: namnets slug och en slumpad svans. Svansen gör att två
 * skisser kan heta likadant – och att ett id aldrig kan krocka med en dold
 * skiss, vars existens då hade röjts för den som inte får se den.
 */
export function skissId(namn: string): string {
  const slug = namn
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${slug || "skiss"}-${slump(6)}`;
}

/* ------------------------------------------------------------------ */
/* Skapa och ändra                                                     */
/* ------------------------------------------------------------------ */

export function nySkiss(namn: string, dold = false): Systemskiss {
  return {
    id: skissId(namn),
    namn: namn.trim(),
    ...(dold ? { dold: true } : {}),
    savedAt: new Date().toISOString(),
    objekt: [],
    zoner: [],
    kopplingar: [],
  };
}

export function sortNamn(sort: SkissSort): string {
  return SKISS_SORTER.find((s) => s.id === sort)?.namn ?? sort;
}

/** Lägger till ett objekt med mitten i (x, y). Returnerar skissen och det nya id:t. */
export function läggTillObjekt(
  skiss: Systemskiss,
  sort: SkissSort,
  x: number,
  y: number,
): { skiss: Systemskiss; id: string } {
  const id = nyttSkissId("o");
  const b = sort === "anteckning" ? 200 : OBJEKT_MÅTT.b;
  const h = sort === "anteckning" ? 80 : OBJEKT_MÅTT.h;
  const objekt: SkissObjekt = {
    id,
    sort,
    namn: sort === "anteckning" ? "Anteckning" : sortNamn(sort),
    x: fäst(x - b / 2),
    y: fäst(y - h / 2),
    b,
    h,
  };
  return { skiss: { ...skiss, objekt: [...skiss.objekt, objekt] }, id };
}

export function läggTillZon(skiss: Systemskiss, x: number, y: number): { skiss: Systemskiss; id: string } {
  const id = nyttSkissId("z");
  const zon: SkissZon = {
    id,
    namn: "Zon",
    färg: ZON_FÄRGER[skiss.zoner.length % ZON_FÄRGER.length],
    x: fäst(x - ZON_MÅTT.b / 2),
    y: fäst(y - ZON_MÅTT.h / 2),
    b: ZON_MÅTT.b,
    h: ZON_MÅTT.h,
  };
  return { skiss: { ...skiss, zoner: [...skiss.zoner, zon] }, id };
}

/**
 * Drar en koppling mellan två objekt. Samma par i samma riktning kopplas inte
 * två gånger, och ett objekt kopplas inte till sig självt – då returneras
 * skissen oförändrad och den befintliga kopplingens id (eller null).
 */
export function läggTillKoppling(
  skiss: Systemskiss,
  från: string,
  till: string,
): { skiss: Systemskiss; id: string | null } {
  const finns = (id: string) => skiss.objekt.some((o) => o.id === id);
  if (från === till || !finns(från) || !finns(till)) return { skiss, id: null };
  const redan = skiss.kopplingar.find((k) => k.från === från && k.till === till);
  if (redan) return { skiss, id: redan.id };
  const id = nyttSkissId("k");
  const koppling: SkissKoppling = { id, från, till, pil: "till", linje: "hel" };
  return { skiss: { ...skiss, kopplingar: [...skiss.kopplingar, koppling] }, id };
}

export function ändraObjekt(skiss: Systemskiss, id: string, ändring: Partial<Omit<SkissObjekt, "id">>): Systemskiss {
  return { ...skiss, objekt: skiss.objekt.map((o) => (o.id === id ? { ...o, ...ändring } : o)) };
}

export function ändraZon(skiss: Systemskiss, id: string, ändring: Partial<Omit<SkissZon, "id">>): Systemskiss {
  return { ...skiss, zoner: skiss.zoner.map((z) => (z.id === id ? { ...z, ...ändring } : z)) };
}

export function ändraKoppling(
  skiss: Systemskiss,
  id: string,
  ändring: Partial<Omit<SkissKoppling, "id">>,
): Systemskiss {
  return { ...skiss, kopplingar: skiss.kopplingar.map((k) => (k.id === id ? { ...k, ...ändring } : k)) };
}

/** Tar bort objekt, zoner och kopplingar. Ett borttaget objekts kopplingar följer med. */
export function taBortUrSkiss(skiss: Systemskiss, ids: Iterable<string>): Systemskiss {
  const bort = new Set(ids);
  return {
    ...skiss,
    objekt: skiss.objekt.filter((o) => !bort.has(o.id)),
    zoner: skiss.zoner.filter((z) => !bort.has(z.id)),
    kopplingar: skiss.kopplingar.filter((k) => !bort.has(k.id) && !bort.has(k.från) && !bort.has(k.till)),
  };
}

const mittI = (r: { x: number; y: number; b: number; h: number }, z: SkissZon) => {
  const mx = r.x + r.b / 2;
  const my = r.y + r.h / 2;
  return mx >= z.x && mx <= z.x + z.b && my >= z.y && my <= z.y + z.h;
};

/**
 * Det som FÖLJER MED när man flyttar `ids`: en zon tar med sig objekten och de
 * mindre zonerna vars mitt ligger i den. Tillhörigheten är alltså geometrisk
 * och räknas när draget BÖRJAR – inget lagras, och det som dras ut ur en zon
 * har därmed lämnat den.
 */
export function medföljande(skiss: Systemskiss, ids: Iterable<string>): Set<string> {
  const ut = new Set(ids);
  const kö = skiss.zoner.filter((z) => ut.has(z.id));
  while (kö.length > 0) {
    const zon = kö.pop()!;
    for (const o of skiss.objekt) if (mittI(o, zon)) ut.add(o.id);
    for (const z of skiss.zoner) {
      if (ut.has(z.id) || z.b * z.h >= zon.b * zon.h || !mittI(z, zon)) continue;
      ut.add(z.id);
      kö.push(z);
    }
  }
  return ut;
}

/** Flyttar objekt och zoner (dx, dy) från sina lägen i `utgång`. */
export function flyttaISkiss(utgång: Systemskiss, ids: ReadonlySet<string>, dx: number, dy: number): Systemskiss {
  const flytt = <T extends { id: string; x: number; y: number }>(v: T): T =>
    ids.has(v.id) ? { ...v, x: fäst(v.x + dx), y: fäst(v.y + dy) } : v;
  return { ...utgång, objekt: utgång.objekt.map(flytt), zoner: utgång.zoner.map(flytt) };
}

const kläm = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Ny storlek på ett objekt eller en zon, fäst mot rutnätet och inom gränserna. */
export function ändraStorlek(skiss: Systemskiss, id: string, b: number, h: number): Systemskiss {
  if (skiss.zoner.some((z) => z.id === id))
    return ändraZon(skiss, id, {
      b: kläm(fäst(b), ZON_MÅTT.minB, ZON_MÅTT.maxB),
      h: kläm(fäst(h), ZON_MÅTT.minH, ZON_MÅTT.maxH),
    });
  return ändraObjekt(skiss, id, {
    b: kläm(fäst(b), OBJEKT_MÅTT.minB, OBJEKT_MÅTT.maxB),
    h: kläm(fäst(h), OBJEKT_MÅTT.minH, OBJEKT_MÅTT.maxH),
  });
}

/** En kopia av objekten, förskjuten ett par rutor. Kopplingar MELLAN de kopierade följer med. */
export function dupliceraISkiss(skiss: Systemskiss, ids: ReadonlySet<string>): { skiss: Systemskiss; nya: string[] } {
  const karta = new Map<string, string>();
  const objekt = skiss.objekt
    .filter((o) => ids.has(o.id))
    .map((o) => {
      const id = nyttSkissId("o");
      karta.set(o.id, id);
      return { ...o, id, x: o.x + 2 * SKISS_RUTNÄT, y: o.y + 2 * SKISS_RUTNÄT };
    });
  const zoner = skiss.zoner
    .filter((z) => ids.has(z.id))
    .map((z) => {
      const id = nyttSkissId("z");
      karta.set(z.id, id);
      return { ...z, id, x: z.x + 2 * SKISS_RUTNÄT, y: z.y + 2 * SKISS_RUTNÄT };
    });
  const kopplingar = skiss.kopplingar
    .filter((k) => karta.has(k.från) && karta.has(k.till))
    .map((k) => ({ ...k, id: nyttSkissId("k"), från: karta.get(k.från)!, till: karta.get(k.till)! }));
  return {
    skiss: {
      ...skiss,
      objekt: [...skiss.objekt, ...objekt],
      zoner: [...skiss.zoner, ...zoner],
      kopplingar: [...skiss.kopplingar, ...kopplingar],
    },
    nya: [...karta.values()],
  };
}

/* ------------------------------------------------------------------ */
/* Läsningen utifrån – fält för fält                                   */
/* ------------------------------------------------------------------ */

const sträng = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const tal = (v: unknown, min: number, max: number, reserv: number): number =>
  typeof v === "number" && Number.isFinite(v) ? kläm(Math.round(v), min, max) : reserv;
const lista = (v: unknown, max: number): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : [])
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
    .slice(0, max);
const giltigtId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

/**
 * Bygger en skiss ur något som kommit UTIFRÅN (en fil, en begäran). Allt
 * okänt faller bort, tal blir tal inom rimliga gränser, text kapas och
 * kopplingar som pekar på något som inte finns stryks. `null` när det inte är
 * en skiss alls (id eller namn saknas).
 *
 * Varför så strängt: bilden byggs som SVG-markup ur de här fälten, och en
 * skiss som en användare sparar öppnas av andra. Ett "tal" som i själva verket
 * är en sträng med markup får aldrig nå ritaren.
 */
export function läsSkiss(rå: unknown): Systemskiss | null {
  if (!rå || typeof rå !== "object") return null;
  const r = rå as Record<string, unknown>;
  const namn = sträng(r.namn, MAX.namn).trim();
  if (!giltigtId(r.id) || !namn) return null;

  const sedda = new Set<string>();
  const nytt = (id: unknown): id is string => {
    if (!giltigtId(id) || sedda.has(id)) return false;
    sedda.add(id);
    return true;
  };
  const K = MAX.koordinat;

  const objekt: SkissObjekt[] = [];
  for (const o of lista(r.objekt, MAX.objekt)) {
    if (!nytt(o.id)) continue;
    const sort = SKISS_SORTER.find((s) => s.id === o.sort)?.id ?? "server";
    const text = sträng(o.text, MAX.text);
    objekt.push({
      id: o.id as string,
      sort,
      namn: sträng(o.namn, MAX.namn),
      ...(text.trim() ? { text } : {}),
      x: tal(o.x, -K, K, 0),
      y: tal(o.y, -K, K, 0),
      b: tal(o.b, OBJEKT_MÅTT.minB, OBJEKT_MÅTT.maxB, OBJEKT_MÅTT.b),
      h: tal(o.h, OBJEKT_MÅTT.minH, OBJEKT_MÅTT.maxH, OBJEKT_MÅTT.h),
    });
  }
  const objektId = new Set(objekt.map((o) => o.id));

  const zoner: SkissZon[] = [];
  for (const z of lista(r.zoner, MAX.zoner)) {
    if (!nytt(z.id)) continue;
    zoner.push({
      id: z.id as string,
      namn: sträng(z.namn, MAX.namn),
      färg: ZON_FÄRGER.find((f) => f === z.färg) ?? "gra",
      x: tal(z.x, -K, K, 0),
      y: tal(z.y, -K, K, 0),
      b: tal(z.b, ZON_MÅTT.minB, ZON_MÅTT.maxB, ZON_MÅTT.b),
      h: tal(z.h, ZON_MÅTT.minH, ZON_MÅTT.maxH, ZON_MÅTT.h),
    });
  }

  const kopplingar: SkissKoppling[] = [];
  for (const k of lista(r.kopplingar, MAX.kopplingar)) {
    if (typeof k.från !== "string" || typeof k.till !== "string") continue;
    if (k.från === k.till || !objektId.has(k.från) || !objektId.has(k.till)) continue;
    if (!nytt(k.id)) continue;
    const etikett = sträng(k.etikett, MAX.namn).trim();
    kopplingar.push({
      id: k.id as string,
      från: k.från,
      till: k.till,
      ...(etikett ? { etikett } : {}),
      pil: k.pil === "båda" || k.pil === "ingen" ? k.pil : "till",
      linje: k.linje === "streckad" ? "streckad" : "hel",
    });
  }

  const beskrivning = sträng(r.beskrivning, MAX.beskrivning).trim();
  const s = r.skapadAv as Record<string, unknown> | undefined;
  const skapadAv =
    s && typeof s === "object" && typeof s.id === "string" && s.id
      ? { id: s.id.slice(0, 200), namn: sträng(s.namn, 200) }
      : undefined;
  const savedAt = typeof r.savedAt === "string" && !Number.isNaN(Date.parse(r.savedAt)) ? r.savedAt : new Date(0).toISOString();

  return {
    id: r.id,
    namn,
    ...(beskrivning ? { beskrivning } : {}),
    ...(r.dold === true ? { dold: true } : {}),
    savedAt,
    ...(skapadAv ? { skapadAv } : {}),
    objekt,
    zoner,
    kopplingar,
  };
}

/** Innehållet som avgör om skissen har osparade ändringar – tidsstämpel och skapare räknas inte. */
export function skissNyckel(s: Systemskiss): string {
  const { savedAt: _t, skapadAv: _s, ...innehåll } = s;
  return JSON.stringify(innehåll);
}
