/**
 * Ramar – en BERÄTTELSE om en befintlig process, i bilder.
 *
 * En ramserie pekar på ett sparat flöde (flödesschema eller affärsprocess) och bär en
 * följd av ramar. Varje ram säger vad som ska lyftas fram: ett objekt får en
 * färgad kant, en koppling pulserar från källa till mål, något blinkar. Själva
 * processen ritas ALDRIG om här – ramen läggs som ett lager ovanpå exportens
 * egen SVG (se `tools/ramar/effekter.ts`), så en ram kan inte visa en annan
 * process än den verktygen ritar (invariant 1).
 *
 * MÅLEN NYCKLAS STABILT (invariant 2). Ett objekt pekas ut med sitt nod-id,
 * en koppling med `edgeKey(källa, mål, etikett)` – ALDRIG med modellens
 * `e1`/`r7`, som är räknare och förskjuts av minsta ändring i processen. Så
 * följer en markering med när processen sparas om, och den som pekar på något
 * som tagits bort redovisas i stället för att hamna på fel objekt.
 *
 * Helpers här returnerar `{ ...serie, ändratFält }` av samma skäl som
 * draft-helpers (invariant 4): okända fält ska överleva en redigering.
 */

import type { Ägare } from "./behorighet";
import { edgeKey } from "./draft";
import type { RamScen, Scen } from "./ram-scen";

/* ------------------------------------------------------------------ */
/* Märkningen i SVG:n – EN plats                                       */
/* ------------------------------------------------------------------ */

/** Attributet som bär ett objekts id i exportens SVG. */
export const RAM_NOD_ATTR = "data-ark-nod";
/** Objektets ruta ("x y b h") i samma koordinatram som elementet självt. */
export const RAM_RUTA_ATTR = "data-ark-ruta";
/** Attributet som bär en kopplings stabila nyckel. */
export const RAM_KANT_ATTR = "data-ark-kant";

/**
 * Kopplingens nyckel i ramarna. Samma som kantstilarnas (invariant 3): Ja och
 * Nej mellan samma nodpar är två olika kopplingar.
 */
export function ramKantNyckel(source: string, target: string, label?: string): string {
  return edgeKey(source, target, label);
}

/** Attributsträng för ett objekts grupp. `esc` görs av anroparen. */
export function ramNodAttribut(
  esc: (s: string) => string,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const r = [x, y, w, h].map((v) => +v.toFixed(1)).join(" ");
  return `${RAM_NOD_ATTR}="${esc(id)}" ${RAM_RUTA_ATTR}="${r}"`;
}

/** Attributsträng för en kopplings väg. */
export function ramKantAttribut(
  esc: (s: string) => string,
  source: string,
  target: string,
  label?: string,
): string {
  return `${RAM_KANT_ATTR}="${esc(ramKantNyckel(source, target, label))}"`;
}

/* ------------------------------------------------------------------ */
/* Datamodellen                                                        */
/* ------------------------------------------------------------------ */

/**
 * Verktygslådan. Varje verktyg är ett SÄTT att sticka ut:
 *  - "farg":  en fast kant i vald färg (objekt) eller en färgad, tjockare linje
 *  - "blink": samma sak, men den blinkar
 *  - "puls":  kopplingen får en puls som vandrar från källa till mål; ett
 *             objekt får en ring som vidgas och tonar bort
 */
export type RamVerktyg = "farg" | "blink" | "puls";

export const RAM_VERKTYG: { id: RamVerktyg; namn: string; ikon: string; hjälp: string }[] = [
  { id: "farg", namn: "Färgkant", ikon: "▢", hjälp: "Fast kant i vald färg" },
  { id: "blink", namn: "Blinka", ikon: "✺", hjälp: "Blinkar i vald färg" },
  { id: "puls", namn: "Puls", ikon: "≋", hjälp: "En puls vandrar längs kopplingen – ringar kring ett objekt" },
];

/** Förvalda färger i lådan. Egen färg går alltid att välja. */
export const RAM_FÄRGER = ["#e8590c", "#1f5c9e", "#2b8a3e", "#c2255c", "#f59f00", "#7048e8"];

export interface RamMål {
  typ: "nod" | "kant";
  /** Nod-id, eller `ramKantNyckel` för en koppling. */
  id: string;
}

export interface Markering {
  mål: RamMål;
  verktyg: RamVerktyg;
  färg: string;
}

export interface Ram {
  /** Skapas en gång och lagras – aldrig räknat ur listans ordning. */
  id: string;
  rubrik: string;
  /** Berättelsen till bilden. Visas under den och i presentationen. */
  text?: string;
  /** Tona ner allt som INTE är markerat. */
  strålkastare?: boolean;
  /**
   * Zooma in på det markerade. I presentationen beskärs bilden till
   * markeringarna (med luft runt); i redigeringen visas utsnittet som en
   * streckad ram, så att resten av processen fortfarande går att klicka på.
   */
  zooma?: boolean;
  markeringar: Markering[];
  /** Vad som händer i bildfliken (ram-scen.ts). Saknas = ingenting ännu. */
  scen?: RamScen;
}

export interface Ramserie {
  id: string;
  namn: string;
  /** Flödet serien berättar om (ett id ur flödesbiblioteket). */
  flödeId: string;
  savedAt: string;
  ramar: Ram[];
  /**
   * Bildflikens scen: bakgrund och figurer (ram-scen.ts). Saknas = standard-
   * scenen, så serier sparade före bildfliken öppnas utan migrering.
   */
  scen?: Scen;
  /**
   * Hur processen ritas i Ramar. Saknas = "verktyg": exportörens egen bild,
   * som förut. "avskalad" = presentationsstilen i tools/ramar/avskalad.ts
   * (zoner, numrerade rutor, mörk bakgrund) – bara för affärsprocesser.
   */
  stil?: RamStil;
  /**
   * Vem som skapade serien. Stämplas av bryggan vid skapandet och följer sedan
   * med – ramarna är offentliga, men bara skaparen (och en administratör) tar
   * bort dem (core/behorighet.ts).
   */
  skapadAv?: Ägare;
}

export type RamStil = "verktyg" | "avskalad";

/** Det listan visar. */
export interface RamserieSammanfattning {
  id: string;
  namn: string;
  flödeId: string;
  savedAt: string;
  antalRamar: number;
  skapadAv?: Ägare;
}

/* ------------------------------------------------------------------ */
/* Helpers – alla sprider                                              */
/* ------------------------------------------------------------------ */

/** Ett id som skapas EN gång och sedan lagras. */
export function nyttRamId(prefix = "ram"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Filsäkert id för en serie: `ramar-<slug>`. Tar hänsyn till upptagna. */
export function serieId(namn: string, upptagna: Iterable<string> = []): string {
  const slug =
    namn
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "serie";
  const tagna = new Set(upptagna);
  let id = `ramar-${slug}`;
  for (let i = 2; tagna.has(id); i++) id = `ramar-${slug}-${i}`;
  return id;
}

export function nyRam(rubrik: string): Ram {
  return { id: nyttRamId(), rubrik, markeringar: [] };
}

export function nySerie(namn: string, flödeId: string, upptagna: Iterable<string> = []): Ramserie {
  return {
    id: serieId(namn, upptagna),
    namn,
    flödeId,
    savedAt: new Date().toISOString(),
    ramar: [nyRam("Ram 1")],
  };
}

function sammaMål(a: RamMål, b: RamMål): boolean {
  return a.typ === b.typ && a.id === b.id;
}

/**
 * Ett klick med ett verktyg på ett mål.
 *
 * Ett mål bär EN markering per ram. Samma verktyg i samma färg igen tar bort
 * den (klicket växlar); ett annat verktyg eller en annan färg ersätter den.
 */
export function växlaMarkering(ram: Ram, m: Markering): Ram {
  const befintlig = ram.markeringar.find((x) => sammaMål(x.mål, m.mål));
  const övriga = ram.markeringar.filter((x) => !sammaMål(x.mål, m.mål));
  if (befintlig && befintlig.verktyg === m.verktyg && befintlig.färg === m.färg) {
    return { ...ram, markeringar: övriga };
  }
  return { ...ram, markeringar: [...övriga, m] };
}

export function taBortMarkering(ram: Ram, mål: RamMål): Ram {
  return { ...ram, markeringar: ram.markeringar.filter((x) => !sammaMål(x.mål, mål)) };
}

export function ändraRam(serie: Ramserie, id: string, f: (r: Ram) => Ram): Ramserie {
  return { ...serie, ramar: serie.ramar.map((r) => (r.id === id ? f(r) : r)) };
}

/** Lägger en ny ram EFTER `efter` (eller sist). */
export function läggTillRam(serie: Ramserie, ram: Ram, efter?: string): Ramserie {
  const i = efter ? serie.ramar.findIndex((r) => r.id === efter) : -1;
  const ramar = [...serie.ramar];
  ramar.splice(i >= 0 ? i + 1 : ramar.length, 0, ram);
  return { ...serie, ramar };
}

/** En kopia av ramen, direkt efter den – nästa steg i berättelsen börjar oftast där. */
export function duplicera(ram: Ram): Ram {
  return {
    ...ram,
    id: nyttRamId(),
    rubrik: `${ram.rubrik} (kopia)`,
    markeringar: ram.markeringar.map((m) => ({ ...m, mål: { ...m.mål } })),
    // Nästa steg i berättelsen börjar där det förra slutade – också i bilden.
    ...(ram.scen ? { scen: structuredClone(ram.scen) } : {}),
  };
}

export function taBortRam(serie: Ramserie, id: string): Ramserie {
  return { ...serie, ramar: serie.ramar.filter((r) => r.id !== id) };
}

export function flyttaRam(serie: Ramserie, id: string, steg: -1 | 1): Ramserie {
  const i = serie.ramar.findIndex((r) => r.id === id);
  const j = i + steg;
  if (i < 0 || j < 0 || j >= serie.ramar.length) return serie;
  const ramar = [...serie.ramar];
  [ramar[i], ramar[j]] = [ramar[j], ramar[i]];
  return { ...serie, ramar };
}

export function sammanfatta(s: Ramserie): RamserieSammanfattning {
  return {
    id: s.id,
    namn: s.namn,
    flödeId: s.flödeId,
    savedAt: s.savedAt,
    antalRamar: s.ramar?.length ?? 0,
    skapadAv: s.skapadAv,
  };
}
