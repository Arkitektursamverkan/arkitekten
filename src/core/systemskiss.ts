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
import { läsKlassning, type Klassning } from "./klassning";
import { normaliseraStatus, sammanfattaStatus, senasteFastslagnaIndex, type FlowStatus } from "./status";

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

/**
 * Ett LAGER – en del av skissen man kan visa för sig, t.ex. en applikation.
 * Ett objekt eller en zon hör till HÖGST ett lager; det som inte hör till
 * något är GEMENSAMT och visas när det hänger ihop med det som är framme.
 * Se `filtreraSkiss`.
 */
export interface SkissLager {
  id: string;
  namn: string;
}

export interface SkissObjekt {
  id: string;
  sort: SkissSort;
  namn: string;
  /** Lagrets id. Saknas = hör inte till något lager och visas alltid. */
  lager?: string;
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
  /** Lagrets id, som för objekten. */
  lager?: string;
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

/**
 * Var i Arkitekturportalen skissen VISAS: på en server, under fliken
 * Systemskiss. Skrivs BARA av bryggan på en administratörs begäran
 * (server/atkomst.ts) – som `dold`. En publicerad skiss lämnas ut av
 * flödestjänsten och syns i portalen för dem som får se servern där, också
 * när den är dold i Arkitekten: att publicera är ett eget beslut.
 */
export interface SkissPublicering {
  /** Serverns nod-id i portalen. */
  eaNodId: string;
  /** Serverns namn när den valdes – bara för visning här. */
  servernamn?: string;
  publiceradAt: string;
}

/**
 * Det som VERSIONERAS: bilden och dess namn och beskrivning. Synlighet,
 * publicering och klassning sitter på skissen och är ingen ny version
 * (som placeringen och publiceringen av en process, invariant 11).
 */
export interface SkissInnehåll {
  namn: string;
  beskrivning?: string;
  lager?: SkissLager[];
  objekt: SkissObjekt[];
  zoner: SkissZon[];
  kopplingar: SkissKoppling[];
}

/**
 * En sparad version. Beteckningen (0.1, 1.0 …) lagras INTE – den härleds ur
 * historikens statusar med samma funktion som processerna (core/status.ts,
 * invariant 9).
 */
export interface SkissVersion {
  /** Löpande: v1, v2 … */
  id: string;
  savedAt: string;
  /** Den inloggade som sparade. Skrivs av bryggan. */
  savedBy?: string;
  status: FlowStatus;
  /** Frivillig kommentar. */
  label?: string;
  innehåll: SkissInnehåll;
}

export interface Systemskiss {
  id: string;
  namn: string;
  beskrivning?: string;
  publicering?: SkissPublicering;
  /** Informationsklassningen (core/klassning.ts). Ingen ny version. */
  klassning?: Klassning;
  /**
   * Historiken, äldst först; sista posten = innehållet ovan. Skrivs BARA av
   * `läggTillSkissversion` – bryggan bygger den ur FILEN, aldrig ur begäran,
   * så en tidigare version kan inte skrivas om (invariant 11). Saknas på
   * skisser från före versionerna: då läses skissen som en enda version
   * (`skissVersioner`), och den blir v1 vid nästa sparning.
   */
  versioner?: SkissVersion[];
  /**
   * Dold = bara administratörer ser skissen (core/behorighet.ts). Skrivs BARA
   * av bryggan på en administratörs begäran (server/atkomst.ts).
   */
  dold?: boolean;
  savedAt: string;
  /** Den som skapade skissen. Skrivs bara av bryggan, vid skapandet. */
  skapadAv?: Ägare;
  /** Lagren, i den ordning de visas. Saknas = skissen har inga lager. */
  lager?: SkissLager[];
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
  /** Nuvarande beteckning och status – härledda (core/status.ts). */
  beteckning: string;
  status: FlowStatus;
  fastslagenBeteckning?: string;
  klassning?: Klassning;
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
    ...sammanfattaStatus(skissVersioner(s)),
    ...(s.klassning ? { klassning: s.klassning } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Versionerna                                                         */
/* ------------------------------------------------------------------ */

/** Skissens nuvarande innehåll – det som versioneras. */
export function skissensInnehåll(s: SkissInnehåll): SkissInnehåll {
  return {
    namn: s.namn,
    ...(s.beskrivning ? { beskrivning: s.beskrivning } : {}),
    ...(s.lager?.length ? { lager: s.lager } : {}),
    objekt: s.objekt,
    zoner: s.zoner,
    kopplingar: s.kopplingar,
  };
}

const innehållsNyckel = (i: SkissInnehåll) => JSON.stringify(skissensInnehåll(i));

/**
 * Historiken. En skiss från före versionerna har ingen – den LÄSES som en
 * enda version (utkast, med filens tidpunkt och ingen påhittad person), så
 * att beteckningen är 0.1 och innehållet finns kvar som v1 när den sparas.
 */
export function skissVersioner(s: Systemskiss): SkissVersion[] {
  if (s.versioner?.length) return s.versioner;
  return [{ id: "v1", savedAt: s.savedAt, status: "utkast", innehåll: skissensInnehåll(s) }];
}

export interface NyVersion {
  status?: FlowStatus;
  label?: string;
  savedBy?: string;
  nu?: string;
}

/**
 * Skapar sparningen en ny version? Samma tre skäl som för en process
 * (`skaparNyVersion` i flow-store): nytt innehåll, en kommentar eller en
 * begärd ny status (Fastslå). Ny version utan begärd status = utkast.
 */
export function skaparNySkissversion(befintlig: Systemskiss | null, ny: SkissInnehåll, v: NyVersion): boolean {
  if (!befintlig) return true;
  const alla = skissVersioner(befintlig);
  const sista = alla[alla.length - 1];
  return (
    innehållsNyckel(sista.innehåll) !== innehållsNyckel(ny) ||
    Boolean(v.label?.trim()) ||
    // Bara en BEGÄRD status räknas: en vanlig sparning (ny klassning, dold)
    // av en fastslagen skiss ska inte bli ett utkast med samma innehåll.
    (v.status !== undefined && normaliseraStatus(sista.status) !== normaliseraStatus(v.status))
  );
}

/**
 * Skissen som den ska sparas: `ny` med historiken ur `befintlig` (FILEN) och
 * – om något ändrats – en ny version sist. Begärans egen historik används
 * aldrig. En befintlig version rörs aldrig (invariant 11).
 */
export function läggTillSkissversion(befintlig: Systemskiss | null, ny: Systemskiss, v: NyVersion = {}): Systemskiss {
  const tidigare = befintlig ? skissVersioner(befintlig) : [];
  const nu = v.nu ?? new Date().toISOString();
  const versioner = skaparNySkissversion(befintlig, ny, v)
    ? [
        ...tidigare,
        {
          id: `v${tidigare.length + 1}`,
          savedAt: nu,
          ...(v.savedBy?.trim() ? { savedBy: v.savedBy.trim() } : {}),
          status: normaliseraStatus(v.status),
          ...(v.label?.trim() ? { label: v.label.trim().slice(0, MAX.namn) } : {}),
          innehåll: skissensInnehåll(ny),
        },
      ]
    : tidigare;
  return { ...ny, versioner };
}

/** Skissen med en äldre versions innehåll – för att titta på den eller exportera den. */
export function skissVidVersion(s: Systemskiss, index: number): Systemskiss {
  const v = skissVersioner(s)[index];
  if (!v) return s;
  const { beskrivning: _b, lager: _l, ...utan } = s;
  return { ...utan, ...v.innehåll };
}

/**
 * Den version portalen visar: senaste FASTSLAGNA, annars den senaste – samma
 * regel som för processerna, så länge något är fastslaget.
 */
export function publiceradVersionsindex(s: Systemskiss): number {
  const v = skissVersioner(s);
  const fast = senasteFastslagnaIndex(v);
  return fast === -1 ? v.length - 1 : fast;
}

/* ------------------------------------------------------------------ */
/* Mått och gränser                                                    */
/* ------------------------------------------------------------------ */

/** Rutnätet objekt och zoner fäster mot. */
export const SKISS_RUTNÄT = 10;

export const OBJEKT_MÅTT = { b: 170, h: 64, minB: 90, minH: 44, maxB: 600, maxH: 600 } as const;
export const ZON_MÅTT = { b: 420, h: 260, minB: 120, minH: 80, maxB: 6000, maxH: 6000 } as const;

const MAX = { versioner: 1000, lager: 60, objekt: 400, zoner: 100, kopplingar: 800, namn: 120, text: 600, beskrivning: 2000, koordinat: 50_000 } as const;

const ID = /^[a-z0-9-]{1,64}$/;
/** Ett nod-id i portalen: bokstäver, siffror och bindestreck (ett UUID). */
const NOD_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Prefixet en skiss bär hos flödestjänsten, där den delar lista med flödena. */
export const SKISS_TJÄNSTPREFIX = "sk-";

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

/** Ett nytt, slumpat id för ett objekt ("o"), en zon ("z"), en koppling ("k") eller ett lager ("l"). */
export function nyttSkissId(prefix: "o" | "z" | "k" | "l"): string {
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
  lager?: string,
): { skiss: Systemskiss; id: string } {
  const id = nyttSkissId("o");
  const b = sort === "anteckning" ? 200 : OBJEKT_MÅTT.b;
  const h = sort === "anteckning" ? 80 : OBJEKT_MÅTT.h;
  const objekt: SkissObjekt = {
    id,
    sort,
    namn: sort === "anteckning" ? "Anteckning" : sortNamn(sort),
    ...(lager ? { lager } : {}),
    x: fäst(x - b / 2),
    y: fäst(y - h / 2),
    b,
    h,
  };
  return { skiss: { ...skiss, objekt: [...skiss.objekt, objekt] }, id };
}

export function läggTillZon(skiss: Systemskiss, x: number, y: number, lager?: string): { skiss: Systemskiss; id: string } {
  const id = nyttSkissId("z");
  const zon: SkissZon = {
    id,
    namn: "Zon",
    ...(lager ? { lager } : {}),
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
/* Lager                                                               */
/* ------------------------------------------------------------------ */

export function läggTillLager(skiss: Systemskiss, namn: string): { skiss: Systemskiss; id: string } {
  const id = nyttSkissId("l");
  return { skiss: { ...skiss, lager: [...(skiss.lager ?? []), { id, namn: namn.trim() || "Lager" }] }, id };
}

export function döpOmLager(skiss: Systemskiss, id: string, namn: string): Systemskiss {
  return { ...skiss, lager: (skiss.lager ?? []).map((l) => (l.id === id ? { ...l, namn } : l)) };
}

/** Lägger objekt och zoner i ett lager – eller utanför alla (`lager` undefined). */
export function sättLager(skiss: Systemskiss, ids: Iterable<string>, lager: string | undefined): Systemskiss {
  const mål = new Set(ids);
  const byt = <T extends { id: string; lager?: string }>(v: T): T => {
    if (!mål.has(v.id)) return v;
    const { lager: _gammalt, ...resten } = v;
    return (lager ? { ...resten, lager } : resten) as T;
  };
  return { ...skiss, objekt: skiss.objekt.map(byt), zoner: skiss.zoner.map(byt) };
}

/** Luften mellan en hopdragen zon och det som står i den; rubriken behöver mer upptill. */
const ZONLUFT = { sida: 30, över: 50, under: 30 } as const;

/** Zonen hopdragen kring det av `innehåll` som har sin mitt i den. Tom zon = oförändrad. */
function krympZon(zon: SkissZon, innehåll: { x: number; y: number; b: number; h: number }[]): SkissZon {
  const i = innehåll.filter((v) => mittI(v, zon));
  if (i.length === 0) return zon;
  const x1 = Math.max(zon.x, Math.min(...i.map((v) => v.x)) - ZONLUFT.sida);
  const y1 = Math.max(zon.y, Math.min(...i.map((v) => v.y)) - ZONLUFT.över);
  const x2 = Math.min(zon.x + zon.b, Math.max(...i.map((v) => v.x + v.b)) + ZONLUFT.sida);
  const y2 = Math.min(zon.y + zon.h, Math.max(...i.map((v) => v.y + v.h)) + ZONLUFT.under);
  return { ...zon, x: x1, y: y1, b: Math.max(ZON_MÅTT.minB, x2 - x1), h: Math.max(ZON_MÅTT.minH, y2 - y1) };
}

/** Tar bort ett lager. Det som låg i det finns kvar, utanför alla lager. */
export function taBortLager(skiss: Systemskiss, id: string): Systemskiss {
  const iLagret = [...skiss.objekt, ...skiss.zoner].filter((v) => v.lager === id).map((v) => v.id);
  const utan = sättLager(skiss, iLagret, undefined);
  return { ...utan, lager: (skiss.lager ?? []).filter((l) => l.id !== id) };
}

/**
 * Skissen som den ser ut med BARA vissa lager framme – REGELN BOR HÄR, och
 * ritytan, exporten och det som lämnas ut till andra system frågar alla den.
 *
 * `aktiva` null = allt visas. Annars skalas allt bort som inte har med de
 * aktiva lagren att göra. Kvar blir:
 *  - det som ligger i ett aktivt lager (kärnan),
 *  - med `grannar`: objekt i ANDRA lager som är direkt kopplade till kärnan –
 *    lagrets integrationer,
 *  - GEMENSAMMA objekt (utan lager) som hänger ihop med kärnan: direkt
 *    kopplade, eller kopplade dit genom andra gemensamma objekt (användaren
 *    bakom proxyn). Ett gemensamt objekt utan koppling till lagret DÖLJS –
 *    "det som inte har med applikationen att göra" gäller också det
 *    gemensamma (produktägarens besked 2026-11-20).
 *
 * En koppling visas när båda ändarna syns OCH den har med kärnan att göra
 * (eller går mellan två gemensamma objekt som syns). En granne drar alltså
 * inte in sina egna kopplingar till annat.
 *
 * Lägena rörs inte: den filtrerade bilden är samma bild med färre saker i.
 * Undantaget är de GEMENSAMMA zonerna (utan lager – servern som allt står i):
 * de dras ihop kring det som är kvar i dem, och en som blivit tom döljs.
 */
export function filtreraSkiss(skiss: Systemskiss, aktiva: ReadonlySet<string> | null, grannar = true): Systemskiss {
  if (!aktiva) return skiss;
  const iAktivt = (v: { lager?: string }) => Boolean(v.lager && aktiva.has(v.lager));
  const kärna = new Set(skiss.objekt.filter(iAktivt).map((o) => o.id));
  const gemensamma = new Set(skiss.objekt.filter((o) => !o.lager).map((o) => o.id));
  const synliga = new Set(kärna);
  // Gemensamma objekt: de som når kärnan, direkt eller genom andra gemensamma.
  let nya = [...kärna];
  while (nya.length > 0) {
    const från = new Set(nya);
    nya = [];
    for (const k of skiss.kopplingar)
      for (const [a, b] of [[k.från, k.till], [k.till, k.från]])
        if (från.has(a) && gemensamma.has(b) && !synliga.has(b)) {
          synliga.add(b);
          nya.push(b);
        }
  }
  if (grannar)
    for (const k of skiss.kopplingar) {
      if (kärna.has(k.från)) synliga.add(k.till);
      if (kärna.has(k.till)) synliga.add(k.från);
    }
  const objekt = skiss.objekt.filter((o) => synliga.has(o.id));
  const lagerzoner = skiss.zoner.filter(iAktivt);
  const innehåll = [...objekt, ...lagerzoner];
  return {
    ...skiss,
    objekt,
    zoner: skiss.zoner
      .filter((z) => (z.lager ? iAktivt(z) : innehåll.some((v) => mittI(v, z))))
      .map((z) => (z.lager ? z : krympZon(z, innehåll))),
    kopplingar: skiss.kopplingar.filter(
      (k) =>
        synliga.has(k.från) &&
        synliga.has(k.till) &&
        (kärna.has(k.från) || kärna.has(k.till) || (gemensamma.has(k.från) && gemensamma.has(k.till))),
    ),
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
export function läsSkiss(rå: unknown, inneVersion = false): Systemskiss | null {
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

  const lager: SkissLager[] = [];
  for (const l of lista(r.lager, MAX.lager)) {
    if (!nytt(l.id)) continue;
    lager.push({ id: l.id as string, namn: sträng(l.namn, MAX.namn) });
  }
  const lagerId = new Set(lager.map((l) => l.id));
  const iLager = (v: unknown) => (typeof v === "string" && lagerId.has(v) ? { lager: v } : {});

  const objekt: SkissObjekt[] = [];
  for (const o of lista(r.objekt, MAX.objekt)) {
    if (!nytt(o.id)) continue;
    const sort = SKISS_SORTER.find((s) => s.id === o.sort)?.id ?? "server";
    const text = sträng(o.text, MAX.text);
    objekt.push({
      id: o.id as string,
      sort,
      namn: sträng(o.namn, MAX.namn),
      ...iLager(o.lager),
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
      ...iLager(z.lager),
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
  const p = r.publicering as Record<string, unknown> | undefined;
  const eaNodId = p && typeof p === "object" && typeof p.eaNodId === "string" && NOD_ID.test(p.eaNodId) ? p.eaNodId : "";
  const servernamn = eaNodId ? sträng(p!.servernamn, MAX.namn).trim() : "";
  const publicering: SkissPublicering | undefined = eaNodId
    ? {
        eaNodId,
        ...(servernamn ? { servernamn } : {}),
        publiceradAt:
          typeof p!.publiceradAt === "string" && !Number.isNaN(Date.parse(p!.publiceradAt)) ? p!.publiceradAt : new Date(0).toISOString(),
      }
    : undefined;
  const savedAt = typeof r.savedAt === "string" && !Number.isNaN(Date.parse(r.savedAt)) ? r.savedAt : new Date(0).toISOString();
  const klassning = läsKlassning(r.klassning);

  // Varje versions innehåll prövas med SAMMA regler som skissen själv.
  const versioner: SkissVersion[] = [];
  if (!inneVersion) {
    for (const v of lista(r.versioner, Infinity).slice(-MAX.versioner)) {
      const rå = v.innehåll && typeof v.innehåll === "object" ? (v.innehåll as Record<string, unknown>) : null;
      // En version utan eget namn får skissens – den ska aldrig falla bort ur historiken.
      const inn = rå ? läsSkiss({ ...rå, namn: sträng(rå.namn, MAX.namn).trim() || namn, id: r.id }, true) : null;
      if (!inn) continue;
      const vSavedAt = typeof v.savedAt === "string" && !Number.isNaN(Date.parse(v.savedAt)) ? v.savedAt : savedAt;
      const savedBy = sträng(v.savedBy, 200).trim();
      const label = sträng(v.label, MAX.namn).trim();
      versioner.push({
        id: `v${versioner.length + 1}`,
        savedAt: vSavedAt,
        ...(savedBy ? { savedBy } : {}),
        status: normaliseraStatus(v.status),
        ...(label ? { label } : {}),
        innehåll: skissensInnehåll(inn),
      });
    }
  }

  return {
    id: r.id,
    namn,
    ...(beskrivning ? { beskrivning } : {}),
    ...(r.dold === true ? { dold: true } : {}),
    ...(publicering ? { publicering } : {}),
    ...(klassning ? { klassning } : {}),
    savedAt,
    ...(skapadAv ? { skapadAv } : {}),
    ...(lager.length ? { lager } : {}),
    objekt,
    zoner,
    kopplingar,
    ...(versioner.length ? { versioner } : {}),
  };
}

/** Innehållet som avgör om skissen har osparade ändringar – tidsstämpel och skapare räknas inte. */
export function skissNyckel(s: Systemskiss): string {
  const { savedAt: _t, skapadAv: _s, versioner: _v, ...innehåll } = s;
  // Tidpunkten för publiceringen är serverns; servern den pekar på är innehåll.
  if (innehåll.publicering) innehåll.publicering = { ...innehåll.publicering, publiceradAt: "" };
  return JSON.stringify(innehåll);
}
