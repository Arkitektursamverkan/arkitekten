/**
 * Bildfliken: en LEVANDE BILD av vad som händer, parallellt med flödet.
 *
 * Samma tanke som flödesfliken: det fasta hör till SERIEN, det som händer hör
 * till RAMEN. Serien bär en scen – en bakgrund (en ritad stad, en tom yta
 * eller en egen bild) med utplacerade figurer: hyresgästen, huvudkontoret,
 * en hantverkare, ikoner. Varje ram säger vad som händer i den: vilka figurer
 * som lyfts fram, vilka pulser som går mellan dem, vad som sägs i
 * pratbubblorna och vilka figurer som inte syns ännu.
 *
 * Figurerna flyttas i scenen, inte i ramen – huvudkontoret ligger på samma
 * ställe genom hela berättelsen, annars hoppar bilden mellan ramarna.
 *
 * STABILA ID:N (invariant 2): standardscenens figurer har fasta namn
 * (`hyresgast`, `huvudkontor`, `bostad`); nya figurer får ett id när de skapas,
 * och det lagras. Allt i ramarna pekar på figurerna med de id:na.
 *
 * Helpers sprider (invariant 4).
 */

import { nyttRamId, type Ram, type RamVerktyg, type Ramserie } from "./ram";

/** Scenens bredd. Höjden följer bakgrunden (staden: 900). */
export const SCEN_BREDD = 1600;
export const STAD_HÖJD = 900;

/**
 * Figurerna som finns att ställa i scenen. En LISTA och inte bara en typ: den
 * som tar emot en scen utifrån (AI-presentationen, tools/ramar/
 * ai-presentation.ts) måste kunna fråga om en figurtyp finns.
 */
export const FIGURTYPER = [
  "hyresgast",
  "huvudkontor",
  "bostadshus",
  "person",
  "hantverkare",
  "handlaggare",
  "dator",
  "mobil",
  "system",
  "moln",
  "dokument",
  "mejl",
  "nyckel",
  "varning",
  "klar",
  "klocka",
  "servicebil",
] as const;

export type FigurTyp = (typeof FIGURTYPER)[number];

export interface ScenFigur {
  id: string;
  typ: FigurTyp;
  /** Namnet som står under figuren. Tom sträng = inget namn. */
  namn: string;
  /** Figurens MITT i scenens koordinater. */
  x: number;
  y: number;
  /** Storleksfaktor. Saknas = 1. */
  skala?: number;
}

export type ScenBakgrund =
  | { typ: "stad" }
  | { typ: "tom" }
  /** En uppladdad bild som data-URL, med sina egna mått. */
  | { typ: "bild"; data: string; bredd: number; höjd: number };

export interface Scen {
  bakgrund: ScenBakgrund;
  figurer: ScenFigur[];
}

export interface FigurMarkering {
  figur: string;
  verktyg: RamVerktyg;
  färg: string;
}

/** En puls FRÅN en figur TILL en annan – t.ex. en felanmälan till huvudkontoret. */
export interface ScenPuls {
  id: string;
  från: string;
  till: string;
  färg: string;
  /** Kort etikett mitt på pulsen, t.ex. "Felanmälan". */
  text?: string;
}

export interface ScenBubbla {
  figur: string;
  text: string;
}

/**
 * En fristående TEXTRUTA i bilden – en bildtext, inte en pratbubbla: den hör
 * inte till någon figur. Rubrik (kort, i accentfärg) och en brödtext, som
 * "AS IT IS · T+72h · Three days later" i frames.png. Hör till RAMEN, så varje
 * ram kan säga sitt; "Kopiera" tar med den till nästa.
 */
export interface ScenTextruta {
  id: string;
  /** Övre vänstra hörnet i scenens koordinater. */
  x: number;
  y: number;
  bredd: number;
  rubrik?: string;
  text: string;
  /** Storleksfaktor för text och luft (0,75 liten, 1 normal, 1,3 stor). Saknas = 1. */
  skala?: number;
  /** Bakgrundsfärg (#rrggbb). Saknas = mörk, halvgenomskinlig. */
  bakgrund?: string;
  /** Textfärg (#rrggbb). Saknas = vit. */
  textfärg?: string;
}

/**
 * En PULSPUNKT: en liten cirkel med ringar som pulserar utåt, fritt placerad –
 * t.ex. i ett fönster på bostaden. Hör till ramen, som textrutorna.
 */
export interface ScenPulspunkt {
  id: string;
  /** Punktens MITT i scenens koordinater. */
  x: number;
  y: number;
  färg: string;
  /** 0,6 liten, 1 normal, 1,6 stor. Saknas = 1. */
  storlek?: number;
}

export function nyPulspunkt(x: number, y: number, färg: string): ScenPulspunkt {
  return { id: nyttRamId("punkt"), x: Math.round(x), y: Math.round(y), färg };
}

export function läggTillPulspunkt(rs: RamScen, p: ScenPulspunkt): RamScen {
  return { ...rs, pulspunkter: [...rs.pulspunkter, p] };
}

export function ändraPulspunkt(rs: RamScen, id: string, f: (p: ScenPulspunkt) => ScenPulspunkt): RamScen {
  return { ...rs, pulspunkter: rs.pulspunkter.map((p) => (p.id === id ? f(p) : p)) };
}

export function taBortPulspunkt(rs: RamScen, id: string): RamScen {
  return { ...rs, pulspunkter: rs.pulspunkter.filter((p) => p.id !== id) };
}

/** Döljer en figur i ramen (idempotent – till skillnad från `växlaDold`). */
export function döljIRam(rs: RamScen, figur: string): RamScen {
  return rs.dolda.includes(figur) ? rs : { ...rs, dolda: [...rs.dolda, figur] };
}

/**
 * Samma ändring i VARJE ram som har något i bildfliken. Används för "ta bort
 * från alla ramar": en textruta eller pulspunkt följer med när man kopierar en
 * ram (samma id), så den kan finnas i många.
 */
export function iAllaRamar(serie: Ramserie, f: (rs: RamScen) => RamScen): Ramserie {
  return {
    ...serie,
    ramar: serie.ramar.map((r) => (r.scen ? { ...r, scen: f(ramScen(r)) } : r)),
  };
}

/**
 * Lägger till en figur i scenen – men SYNLIG BARA I RAMEN man står i. I alla
 * andra ramar är den dold ("om jag står i en annan ram och lägger till en
 * figur så läggs den till i alla ramar", beslut 2026-09-30). Scenen äger
 * figurens plats, ramarna vad som syns; Visa/dölj och "Tona in från ram N"
 * tar in den i fler.
 */
export function läggTillFigurIRam(serie: Ramserie, figur: ScenFigur, ramId: string): Ramserie {
  const medFigur = ändraScen(serie, (sc) => läggTillFigur(sc, figur));
  return {
    ...medFigur,
    ramar: medFigur.ramar.map((r) => (r.id === ramId ? r : ändraRamScen(r, (rs) => döljIRam(rs, figur.id)))),
  };
}

/**
 * En NY, tom ram som fortsätter bilden från ramen före: samma figurer syns och
 * samma är dolda – men inga markeringar, pulser, bubblor eller textrutor.
 * Annars dök en figur som bara hör till en ram upp igen i varje ny ram.
 */
export function fortsättBild(ny: Ram, före: Ram | null | undefined): Ram {
  if (!före?.scen) return ny;
  const dolda = ramScen(före).dolda;
  return dolda.length ? { ...ny, scen: { ...TOM_RAMSCEN, dolda: [...dolda] } } : ny;
}

/** Färdiga färger i textrutans väljare – mörk och vit först, sedan husets. */
export const TEXTRUTA_BAKGRUNDER = ["#0f172a", "#ffffff", "#1f5c9e", "#2f7a3e", "#b42318", "#e8590c"];
export const TEXTRUTA_TEXTFÄRGER = ["#f8fafc", "#1f2937", "#fbbf24", "#93c5fd", "#86efac", "#fca5a5"];

/** Minsta bredd – en kort etikett ska få vara liten. */
export const TEXTRUTA_MIN_BREDD = 120;

/** Det som händer i bilden i EN ram. */
export interface RamScen {
  markeringar: FigurMarkering[];
  pulser: ScenPuls[];
  bubblor: ScenBubbla[];
  /** Figurer som INTE syns i den här ramen (tonas in/ut mellan ramarna). */
  dolda: string[];
  /** Fristående textrutor (bildtexter). Saknas i ramar sparade före dem. */
  textrutor: ScenTextruta[];
  /** Pulserande punkter. Saknas i ramar sparade före dem. */
  pulspunkter: ScenPulspunkt[];
  /**
   * Figurer som står på en EGEN plats i den här ramen (mitt, som i scenen).
   * Saknas = scenens plats. Så kan hyresgästen stå vid bostaden i en ram och
   * vid huvudkontoret i nästa.
   */
  figurLägen: Record<string, { x: number; y: number }>;
}

export const TOM_RAMSCEN: RamScen = {
  markeringar: [],
  pulser: [],
  bubblor: [],
  dolda: [],
  textrutor: [],
  pulspunkter: [],
  figurLägen: {},
};

/** Figurerna som de står i en viss ram – ramens egna platser ovanpå scenens. */
export function figurerIRam(scen: Scen, rs: RamScen): ScenFigur[] {
  const egna = rs.figurLägen ?? {};
  return scen.figurer.map((f) => (egna[f.id] ? { ...f, ...egna[f.id] } : f));
}

/**
 * FLYTTAR ett objekt – i den här ramen, eller lika mycket i ALLA ramar.
 *
 * "Om jag flyttar ett visst objekt vill jag kunna välja att flytta på alla
 * ramar" (beslut 2026-09-30). Standard är ramen man står i, som för att lägga
 * till och ta bort. "Alla ramar" flyttar objektet med samma förskjutning
 * överallt där det finns – en figur som går från bostaden till huvudkontoret
 * mellan ramarna fortsätter att gå så.
 *
 * `dx`/`dy` är förflyttningen; objektet pekas ut med sort och id. En figur i
 * "bara den här ramen" får en egen plats i ramen (`figurLägen`).
 */
export function flyttaObjekt(
  serie: Ramserie,
  ramId: string,
  mål: { typ: "figur" | "text" | "punkt"; id: string },
  dx: number,
  dy: number,
  allaRamar: boolean,
): Ramserie {
  const flytta = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
  const iRam = (rs: RamScen): RamScen => {
    if (mål.typ === "text") return ändraTextruta(rs, mål.id, flytta);
    if (mål.typ === "punkt") return ändraPulspunkt(rs, mål.id, flytta);
    return rs;
  };
  if (mål.typ !== "figur") {
    return allaRamar
      ? iAllaRamar(serie, iRam)
      : { ...serie, ramar: serie.ramar.map((r) => (r.id === ramId ? ändraRamScen(r, iRam) : r)) };
  }
  const scen = serieScen(serie);
  const figur = scen.figurer.find((f) => f.id === mål.id);
  if (!figur) return serie;
  if (allaRamar) {
    // Scenens plats OCH varje rams egna plats – lika mycket.
    const medScen = ändraScen(serie, (sc) => ändraFigur(sc, mål.id, flytta));
    return iAllaRamar(medScen, (rs) =>
      rs.figurLägen?.[mål.id] ? { ...rs, figurLägen: { ...rs.figurLägen, [mål.id]: flytta(rs.figurLägen[mål.id]) } } : rs,
    );
  }
  return {
    ...serie,
    ramar: serie.ramar.map((r) =>
      r.id !== ramId
        ? r
        : ändraRamScen(r, (rs) => {
            const nu = rs.figurLägen?.[mål.id] ?? { x: figur.x, y: figur.y };
            return { ...rs, figurLägen: { ...rs.figurLägen, [mål.id]: flytta(nu) } };
          }),
    ),
  };
}

/** Figuren tillbaka till scenens plats i den här ramen. */
export function scenensPlats(rs: RamScen, figur: string): RamScen {
  if (!rs.figurLägen?.[figur]) return rs;
  const { [figur]: _, ...kvar } = rs.figurLägen;
  return { ...rs, figurLägen: kvar };
}

/** Bredden en ny textruta får. */
export const TEXTRUTA_BREDD = 520;

export function nyTextruta(x: number, y: number): ScenTextruta {
  return { id: nyttRamId("text"), x: Math.round(x), y: Math.round(y), bredd: TEXTRUTA_BREDD, rubrik: "", text: "" };
}

export function läggTillTextruta(rs: RamScen, t: ScenTextruta): RamScen {
  return { ...rs, textrutor: [...rs.textrutor, t] };
}

export function ändraTextruta(rs: RamScen, id: string, f: (t: ScenTextruta) => ScenTextruta): RamScen {
  return { ...rs, textrutor: rs.textrutor.map((t) => (t.id === id ? f(t) : t)) };
}

export function taBortTextruta(rs: RamScen, id: string): RamScen {
  return { ...rs, textrutor: rs.textrutor.filter((t) => t.id !== id) };
}

/** Scenen en ny serie får – och en gammal serie som sparades före bildfliken. */
export function standardScen(): Scen {
  return {
    bakgrund: { typ: "stad" },
    figurer: [
      { id: "bostad", typ: "bostadshus", namn: "Bostad", x: 330, y: 560 },
      { id: "hyresgast", typ: "hyresgast", namn: "Hyresgäst", x: 480, y: 650 },
      { id: "huvudkontor", typ: "huvudkontor", namn: "Huvudkontor", x: 1200, y: 545 },
    ],
  };
}

export function serieScen(serie: Ramserie): Scen {
  return serie.scen ?? standardScen();
}

export function ramScen(ram: Ram): RamScen {
  return { ...TOM_RAMSCEN, ...ram.scen };
}

export function scenHöjd(scen: Scen): number {
  const b = scen.bakgrund;
  return b.typ === "bild" ? Math.round((SCEN_BREDD * b.höjd) / Math.max(1, b.bredd)) : STAD_HÖJD;
}

/* ---- Scenen (serien) ---- */

export function ändraScen(serie: Ramserie, f: (s: Scen) => Scen): Ramserie {
  return { ...serie, scen: f(serieScen(serie)) };
}

export function läggTillFigur(scen: Scen, figur: ScenFigur): Scen {
  return { ...scen, figurer: [...scen.figurer, figur] };
}

export function nyFigur(typ: FigurTyp, namn: string, x: number, y: number): ScenFigur {
  return { id: nyttRamId("fig"), typ, namn, x, y };
}

export function ändraFigur(scen: Scen, id: string, f: (fig: ScenFigur) => ScenFigur): Scen {
  return { ...scen, figurer: scen.figurer.map((x) => (x.id === id ? f(x) : x)) };
}

/**
 * Tar bort en figur ur scenen – och allt i ramarna som pekar på den. En puls
 * till en figur som inte finns kan inte ritas, och skulle annars ligga kvar
 * osynlig i filen för alltid.
 */
export function taBortFigur(serie: Ramserie, id: string): Ramserie {
  const scen = serieScen(serie);
  return {
    ...serie,
    scen: { ...scen, figurer: scen.figurer.filter((f) => f.id !== id) },
    ramar: serie.ramar.map((r) => {
      if (!r.scen) return r;
      const rs = ramScen(r);
      return {
        ...r,
        scen: {
          ...rs,
          markeringar: rs.markeringar.filter((m) => m.figur !== id),
          pulser: rs.pulser.filter((p) => p.från !== id && p.till !== id),
          bubblor: rs.bubblor.filter((b) => b.figur !== id),
          dolda: rs.dolda.filter((d) => d !== id),
          figurLägen: scenensPlats(rs, id).figurLägen,
        },
      };
    }),
  };
}

/* ---- Det som händer (ramen) ---- */

export function ändraRamScen(ram: Ram, f: (rs: RamScen) => RamScen): Ram {
  return { ...ram, scen: f(ramScen(ram)) };
}

/** Samma regel som i flödet: samma verktyg och färg igen tar bort markeringen. */
export function växlaFigurMarkering(rs: RamScen, m: FigurMarkering): RamScen {
  const befintlig = rs.markeringar.find((x) => x.figur === m.figur);
  const övriga = rs.markeringar.filter((x) => x.figur !== m.figur);
  if (befintlig && befintlig.verktyg === m.verktyg && befintlig.färg === m.färg) {
    return { ...rs, markeringar: övriga };
  }
  return { ...rs, markeringar: [...övriga, m] };
}

/** En puls från → till. Finns den redan tas den bort (klicket växlar). */
export function växlaPuls(rs: RamScen, från: string, till: string, färg: string): RamScen {
  if (från === till) return rs;
  const finns = rs.pulser.find((p) => p.från === från && p.till === till);
  if (finns) return { ...rs, pulser: rs.pulser.filter((p) => p !== finns) };
  return { ...rs, pulser: [...rs.pulser, { id: nyttRamId("puls"), från, till, färg }] };
}

export function ändraPuls(rs: RamScen, id: string, f: (p: ScenPuls) => ScenPuls): RamScen {
  return { ...rs, pulser: rs.pulser.map((p) => (p.id === id ? f(p) : p)) };
}

export function taBortPuls(rs: RamScen, id: string): RamScen {
  return { ...rs, pulser: rs.pulser.filter((p) => p.id !== id) };
}

/** Sätter figurens pratbubbla. Tom text tar bort den. */
export function sättBubbla(rs: RamScen, figur: string, text: string): RamScen {
  const övriga = rs.bubblor.filter((b) => b.figur !== figur);
  return { ...rs, bubblor: text.trim() ? [...övriga, { figur, text }] : övriga };
}

export function växlaDold(rs: RamScen, figur: string): RamScen {
  return {
    ...rs,
    dolda: rs.dolda.includes(figur) ? rs.dolda.filter((d) => d !== figur) : [...rs.dolda, figur],
  };
}

/** Suddet: allt ramen säger om figuren – markering och bubbla – men inte figuren själv. */
export function suddaFigur(rs: RamScen, figur: string): RamScen {
  return {
    ...rs,
    markeringar: rs.markeringar.filter((m) => m.figur !== figur),
    bubblor: rs.bubblor.filter((b) => b.figur !== figur),
  };
}

/**
 * "Tona in": figuren syns från och med ramen `index` – dold i alla ramar före,
 * synlig i den och alla efter. Det vanliga sättet att låta något dyka upp i
 * berättelsen, i ett klick i stället för ett per ram.
 */
export function synsFrånRam(serie: Ramserie, figur: string, index: number): Ramserie {
  return {
    ...serie,
    ramar: serie.ramar.map((r, i) => {
      const rs = ramScen(r);
      const dold = rs.dolda.includes(figur);
      if (i < index && !dold) return { ...r, scen: { ...rs, dolda: [...rs.dolda, figur] } };
      if (i >= index && dold) return { ...r, scen: { ...rs, dolda: rs.dolda.filter((d) => d !== figur) } };
      return r;
    }),
  };
}
