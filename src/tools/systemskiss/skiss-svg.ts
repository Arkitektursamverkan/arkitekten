/**
 * Systemskissens RITARE – geometri och SVG på EN plats (invariant 1).
 *
 * Ritytan (SkissCanvas) lägger exakt den här markupen på skärmen och
 * exporten skriver den till fil, så skärm och fil kan inte glida isär.
 * Träffytorna räknas ur samma geometri (`träffISkiss`) – ritytan frågar
 * aldrig DOM:en var något ligger.
 *
 * Kopplingarna routas med samma `edge-router` som processverktygen:
 * `pickEdgeSides` väljer sidor, `routeEdge` går runt de andra objekten,
 * `labelAnchor` sätter etiketten. Ingen av reglerna får kopieras hit.
 *
 * Ren modul utan DOM – går att köra i bryggan och i tester. ALLT som kommer
 * ur skissen escapas eller är tal; färgerna är nycklar som slås upp här.
 */

import { revisionAvVersion, revisionsMått, revisionsRuta, type Revision } from "@/tools/flowchart/export/revision";
import { skissVersioner, type SkissKoppling, type SkissObjekt, type SkissSort, type SkissZon, type Systemskiss, type ZonFärg } from "@/core/systemskiss";
import {
  labelAnchor,
  pickEdgeSides,
  pointsToPath,
  routeEdge,
  type Point,
  type Rect,
  type Side,
} from "@/tools/flowchart/layout/edge-router";
import { esc, wrap } from "@/tools/flowchart/render/text-util";

/* ------------------------------------------------------------------ */
/* Utseendet                                                           */
/* ------------------------------------------------------------------ */

export const SKISS_TECKENSNITT = '"Segoe UI", system-ui, -apple-system, Arial, sans-serif';

/** Sortens färg (bandet med symbolen, och rutans kant). */
export const SORT_FÄRG: Record<SkissSort, string> = {
  server: "#1f5c9e",
  tjanst: "#6b4aa0",
  databas: "#2e7d5b",
  container: "#0e7490",
  lagring: "#8a6d1f",
  klient: "#475467",
  anvandare: "#b54708",
  natverk: "#3b5bdb",
  brandvagg: "#b42318",
  moln: "#5b6b7f",
  anteckning: "#c9a227",
};

export const ZON_STIL: Record<ZonFärg, { kant: string; fyll: string; namn: string }> = {
  bla: { kant: "#2f77c4", fyll: "#f1f6fc", namn: "Blå" },
  gron: { kant: "#2e7d5b", fyll: "#eff8f3", namn: "Grön" },
  gul: { kant: "#b7791f", fyll: "#fdf7e6", namn: "Gul" },
  rod: { kant: "#b42318", fyll: "#fdf1ef", namn: "Röd" },
  lila: { kant: "#6b4aa0", fyll: "#f5f1fa", namn: "Lila" },
  gra: { kant: "#667085", fyll: "#f5f6f8", namn: "Grå" },
};

const TEXT = "#101828";
const DÄMPAD = "#475467";
const LINJE = "#56607a";
const ANTECKNING = { fyll: "#fff8db", kant: "#e3cd7c" };

/** Bandet med symbolen, till vänster i rutan. */
const BAND = 36;
const NAMN = { storlek: 13, radhöjd: 17, tecken: 7.1 };
const UNDER = { storlek: 11.5, radhöjd: 15, tecken: 6.1 };
/** Rutornas brödtext – den minsta text som bär innehåll. Utskriften mäter läsbarheten på den. */
export const SKISS_BRÖDTEXT = UNDER.storlek;
const LUFT = { över: 11, under: 11, mellan: 3, sida: 10 };
/** Zonens rubrikremsa – där man tar tag i zonen. */
export const ZON_RUBRIK = 28;

/**
 * Sortens symbol, ritad i en ruta 24 × 24 med vita streck. Ren markup utan
 * något ur skissen i sig.
 */
function symbol(sort: SkissSort): string {
  switch (sort) {
    case "server":
      return '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M6.5 7.5h.01M6.5 16.5h.01M10 7.5h7M10 16.5h7"/>';
    case "tjanst":
      return '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6 6.5h.01M9 6.5h.01M7 13h10M7 16.5h6"/>';
    case "databas":
      return '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>';
    case "container":
      return '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9"/>';
    case "lagring":
      return '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>';
    case "klient":
      return '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16v4"/>';
    case "anvandare":
      return '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>';
    case "natverk":
      return '<circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="5" r="1.8"/><circle cx="19.5" cy="5" r="1.8"/><circle cx="4.5" cy="19" r="1.8"/><circle cx="19.5" cy="19" r="1.8"/><path d="M6 6.3l3.7 3.5M18 6.3l-3.7 3.5M6 17.7l3.7-3.5M18 17.7l-3.7-3.5"/>';
    case "brandvagg":
      return '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.3h18M3 14.7h18M9 4v5.3M15 4v5.3M12 9.3v5.4M9 14.7V20M15 14.7V20"/>';
    case "moln":
      return '<path d="M7 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.75 4.75 0 0 1-.5 9.5H7z"/>';
    case "anteckning":
      return "";
  }
}

/** Symbolen som fristående liten SVG – paletten visar samma symbol som bilden. */
export function sortIkonSvg(sort: SkissSort, storlek = 16): string {
  const inre =
    sort === "anteckning"
      ? '<path d="M5 3h10l4 4v14H5V3zM15 3v4h4M8 12h8M8 16h6"/>'
      : symbol(sort);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${storlek}" height="${storlek}" viewBox="0 0 24 24" fill="none" stroke="${SORT_FÄRG[sort]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inre}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Geometrin                                                           */
/* ------------------------------------------------------------------ */

export interface ObjektLayout {
  objekt: SkissObjekt;
  /** Rutan som den RITAS – höjden växer när texten kräver det. */
  ruta: Rect;
  namnRader: string[];
  textRader: string[];
  /** Textens förstoring i rutan – 1 utom i en utskrift (se `fyllRutor`). */
  skala: number;
}

export interface LayoutVal {
  /**
   * Rutornas text förstoras så att den fyller rutan, högst `TEXT_MAX` gånger
   * – rutan växer inte. Utskriften slår på det: en stor skiss skalas ned för
   * att rymmas på bladet, och texten blev oläslig fast rutorna hade plats för
   * större text. Anteckningarna förstoras för sig (per zon eller rad), övriga
   * rutor med EN gemensam förstoring för hela skissen – flödet ska se likadant
   * ut i varje ruta.
   */
  fyllRutor?: boolean;
}

/** Högsta förstoringen av en text i en utskrift. */
export const TEXT_MAX = 2;

export interface KopplingLayout {
  koppling: SkissKoppling;
  punkter: Point[];
  etikett: Point | null;
}

export interface SkissGeometri {
  objekt: Map<string, ObjektLayout>;
  kopplingar: KopplingLayout[];
  /** Allt som ritas, med marginal. */
  gräns: Rect;
}

function brytText(text: string, max: number, maxRader: number): string[] {
  const ut: string[] = [];
  for (const stycke of text.split(/\r?\n/)) {
    if (!stycke.trim()) continue;
    ut.push(...wrap(stycke.trim(), max, maxRader));
  }
  return ut.slice(0, maxRader);
}

/** Textens höjd i rutan (utan luften över och under) vid förstoringen `f`. */
function texthöjd(namn: number, text: number, f: number): number {
  return (namn * NAMN.radhöjd + (text ? (namn ? LUFT.mellan : 0) + text * UNDER.radhöjd : 0)) * f;
}

function layoutVid(o: SkissObjekt, f: number, maxNamn: number, maxText: number) {
  const band = o.sort === "anteckning" ? 0 : BAND;
  const bredd = Math.max(40, o.b - band - 2 * LUFT.sida);
  const namnRader = brytText(o.namn, Math.max(6, Math.floor(bredd / (NAMN.tecken * f))), maxNamn);
  const textRader = brytText(o.text ?? "", Math.max(8, Math.floor(bredd / (UNDER.tecken * f))), maxText);
  return { namnRader, textRader, innehåll: LUFT.över + texthöjd(namnRader.length, textRader.length, f) + LUFT.under };
}

/** Största förstoringen (steg om 0,05) där ALL text i rutan ryms i rutan som den är – inget kapas. */
export function rutansSkala(o: SkissObjekt): number {
  if (layoutVid(o, 1, 4, 12).innehåll > o.h) return 1;
  let bäst = 1;
  for (let steg = 1; 1 + steg * 0.05 <= TEXT_MAX + 1e-9; steg++) {
    const f = 1 + steg * 0.05;
    const l = layoutVid(o, f, 99, 99);
    if (l.innehåll > o.h || l.namnRader.length > 4) break;
    bäst = f;
  }
  return bäst;
}

/**
 * `skala` > 1 förstorar rutans text – värdet ska komma ur `rutansSkala`, så
 * att texten ryms.
 */
export function objektLayout(o: SkissObjekt, skala = 1): ObjektLayout {
  const f = skala;
  const { namnRader, textRader, innehåll } = f === 1 ? layoutVid(o, 1, 4, 12) : layoutVid(o, f, 99, 99);
  return { objekt: o, ruta: { x: o.x, y: o.y, w: o.b, h: Math.max(o.h, innehåll) }, namnRader, textRader, skala: f };
}

/**
 * Förstoringen per ruta i en utskrift. Anteckningar som hör ihop – i samma
 * zon, eller utan zon på samma rad med samma höjd – får SAMMA förstoring, den
 * minsta av deras: en rad gula rutor med olika textstorlek ser ut som ett fel.
 * Övriga rutor är en enda grupp för hela skissen.
 */
function textskalor(skiss: Systemskiss): Map<string, number> {
  const grupp = (o: SkissObjekt): string => {
    const cx = o.x + o.b / 2;
    const cy = o.y + o.h / 2;
    const zon = skiss.zoner
      .filter((z) => cx >= z.x && cx <= z.x + z.b && cy >= z.y && cy <= z.y + z.h)
      .sort((a, b) => a.b * a.h - b.b * b.h)[0];
    return zon ? `zon:${zon.id}` : `rad:${Math.round(o.y)}:${Math.round(o.h)}`;
  };
  const minst = new Map<string, number>();
  const per = new Map<string, string>();
  for (const o of skiss.objekt) {
    const g = o.sort === "anteckning" ? grupp(o) : "rutor";
    per.set(o.id, g);
    minst.set(g, Math.min(minst.get(g) ?? Infinity, rutansSkala(o)));
  }
  return new Map([...per].map(([id, g]) => [id, minst.get(g) ?? 1]));
}

const zonRuta = (z: SkissZon): Rect => ({ x: z.x, y: z.y, w: z.b, h: z.h });

/** Var på en sida en port sitter: `andel` 0–1 längs sidan. */
function port(r: Rect, sida: Side, andel: number): Point {
  switch (sida) {
    case "top":
      return { x: r.x + r.w * andel, y: r.y };
    case "bottom":
      return { x: r.x + r.w * andel, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h * andel };
    case "right":
      return { x: r.x + r.w, y: r.y + r.h * andel };
  }
}

/**
 * Hela skissens geometri. Flera kopplingar på samma sida av ett objekt
 * FÖRDELAS längs sidan, i den ordning deras andra ändar ligger – annars låg
 * de på varandra och en server med fem kopplingar såg ut att ha en.
 */
export function skissGeometri(skiss: Systemskiss, val: LayoutVal = {}): SkissGeometri {
  const objekt = new Map<string, ObjektLayout>();
  const skalor = val.fyllRutor ? textskalor(skiss) : null;
  for (const o of skiss.objekt) objekt.set(o.id, objektLayout(o, skalor?.get(o.id) ?? 1));

  interface Ände {
    index: number;
    slut: "från" | "till";
    läge: number;
  }
  const sidor: { k: SkissKoppling; a: Rect; b: Rect; sa: Side; sb: Side; pa: number; pb: number }[] = [];
  const perSida = new Map<string, Ände[]>();
  const mitt = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  for (const k of skiss.kopplingar) {
    const a = objekt.get(k.från)?.ruta;
    const b = objekt.get(k.till)?.ruta;
    if (!a || !b) continue;
    const [sa, sb] = pickEdgeSides(a, b);
    const index = sidor.push({ k, a, b, sa, sb, pa: 0.5, pb: 0.5 }) - 1;
    const längs = (sida: Side, andra: Rect) => (sida === "top" || sida === "bottom" ? mitt(andra).x : mitt(andra).y);
    for (const [nyckel, ände] of [
      [`${k.från}|${sa}`, { index, slut: "från", läge: längs(sa, b) }],
      [`${k.till}|${sb}`, { index, slut: "till", läge: längs(sb, a) }],
    ] as [string, Ände][]) {
      perSida.set(nyckel, [...(perSida.get(nyckel) ?? []), ände]);
    }
  }
  for (const ändar of perSida.values()) {
    ändar.sort((x, y) => x.läge - y.läge || x.index - y.index);
    ändar.forEach((ä, i) => {
      const andel = (i + 1) / (ändar.length + 1);
      if (ä.slut === "från") sidor[ä.index].pa = andel;
      else sidor[ä.index].pb = andel;
    });
  }

  const kopplingar: KopplingLayout[] = sidor.map(({ k, a, b, sa, sb, pa, pb }) => {
    const hinder: Rect[] = [];
    for (const [id, l] of objekt) if (id !== k.från && id !== k.till) hinder.push(l.ruta);
    const punkter = routeEdge({ from: port(a, sa, pa), fromSide: sa, to: port(b, sb, pb), toSide: sb, obstacles: hinder });
    return { koppling: k, punkter, etikett: k.etikett ? labelAnchor(punkter) : null };
  });

  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const ta = (x: number, y: number) => {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
  };
  for (const r of [...skiss.zoner.map(zonRuta), ...[...objekt.values()].map((l) => l.ruta)]) {
    ta(r.x, r.y);
    ta(r.x + r.w, r.y + r.h);
  }
  for (const k of kopplingar) for (const p of k.punkter) ta(p.x, p.y);
  const M = 30;
  const gräns: Rect = Number.isFinite(x1)
    ? { x: x1 - M, y: y1 - M, w: x2 - x1 + 2 * M, h: y2 - y1 + 2 * M }
    : { x: 0, y: 0, w: 480, h: 280 };
  return { objekt, kopplingar, gräns };
}

/* ------------------------------------------------------------------ */
/* Träffytor                                                           */
/* ------------------------------------------------------------------ */

export interface SkissTräff {
  typ: "objekt" | "zon" | "koppling";
  id: string;
}

const i = (r: Rect, p: Point, m = 0) => p.x >= r.x - m && p.x <= r.x + r.w + m && p.y >= r.y - m && p.y <= r.y + r.h + m;

function avståndTillSträcka(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Etikettens ruta runt sitt ankare – samma mått som den ritas med. */
function etikettRuta(text: string, p: Point): Rect {
  const b = Math.max(24, text.length * 6.3 + 12);
  return { x: p.x - b / 2, y: p.y - 9, w: b, h: 18 };
}

/**
 * Det som ligger under punkten: objekt överst, sedan kopplingar, sedan zoner.
 * En ZON träffas bara i rubrikremsan och på kanten – ytan inuti är ritytan,
 * annars gick en skiss med en stor zon inte att panorera.
 */
export function träffISkiss(skiss: Systemskiss, g: SkissGeometri, p: Point, tolerans = 6): SkissTräff | null {
  for (let n = skiss.objekt.length - 1; n >= 0; n--) {
    const l = g.objekt.get(skiss.objekt[n].id);
    if (l && i(l.ruta, p)) return { typ: "objekt", id: l.objekt.id };
  }
  for (let n = g.kopplingar.length - 1; n >= 0; n--) {
    const k = g.kopplingar[n];
    if (k.etikett && k.koppling.etikett && i(etikettRuta(k.koppling.etikett, k.etikett), p))
      return { typ: "koppling", id: k.koppling.id };
    for (let s = 0; s < k.punkter.length - 1; s++)
      if (avståndTillSträcka(p, k.punkter[s], k.punkter[s + 1]) <= tolerans) return { typ: "koppling", id: k.koppling.id };
  }
  const zoner = [...skiss.zoner].sort((a, b) => a.b * a.h - b.b * b.h);
  for (const z of zoner) {
    const r = zonRuta(z);
    if (!i(r, p, tolerans)) continue;
    const iRubrik = p.y <= r.y + ZON_RUBRIK;
    const inre: Rect = { x: r.x + tolerans, y: r.y + tolerans, w: r.w - 2 * tolerans, h: r.h - 2 * tolerans };
    if (iRubrik || !i(inre, p)) return { typ: "zon", id: z.id };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Ritningen                                                           */
/* ------------------------------------------------------------------ */

const nr = (n: number) => (Number.isFinite(n) ? +n.toFixed(1) : 0);

function zonSvg(z: SkissZon): string {
  const stil = ZON_STIL[z.färg] ?? ZON_STIL.gra;
  return (
    `<g data-skiss-zon="${esc(z.id)}">` +
    `<rect x="${nr(z.x)}" y="${nr(z.y)}" width="${nr(z.b)}" height="${nr(z.h)}" rx="10" fill="${stil.fyll}" stroke="${stil.kant}" stroke-width="1.4" stroke-dasharray="7 4"/>` +
    `<text x="${nr(z.x + 12)}" y="${nr(z.y + 19)}" font-size="12.5" font-weight="650" fill="${stil.kant}">${esc(z.namn)}</text>` +
    `</g>`
  );
}

function objektSvg(l: ObjektLayout): string {
  const { objekt: o, ruta: r } = l;
  const anteckning = o.sort === "anteckning";
  const färg = SORT_FÄRG[o.sort] ?? SORT_FÄRG.server;
  const band = anteckning ? 0 : BAND;
  const f = l.skala;
  const höjd = texthöjd(l.namnRader.length, l.textRader.length, f);
  let y = r.y + (r.h - höjd) / 2;
  const tx = r.x + band + LUFT.sida;
  let text = "";
  for (const rad of l.namnRader) {
    text += `<text x="${nr(tx)}" y="${nr(y + (NAMN.radhöjd - 4.5) * f)}" font-size="${nr(NAMN.storlek * f)}" font-weight="650" fill="${TEXT}">${esc(rad)}</text>`;
    y += NAMN.radhöjd * f;
  }
  if (l.textRader.length && l.namnRader.length) y += LUFT.mellan * f;
  for (const rad of l.textRader) {
    text += `<text x="${nr(tx)}" y="${nr(y + (UNDER.radhöjd - 4) * f)}" font-size="${nr(UNDER.storlek * f)}" fill="${DÄMPAD}">${esc(rad)}</text>`;
    y += UNDER.radhöjd * f;
  }
  const kropp = anteckning
    ? `<rect x="${nr(r.x)}" y="${nr(r.y)}" width="${nr(r.w)}" height="${nr(r.h)}" rx="4" fill="${ANTECKNING.fyll}" stroke="${ANTECKNING.kant}" stroke-width="1.2"/>`
    : `<rect x="${nr(r.x)}" y="${nr(r.y)}" width="${nr(r.w)}" height="${nr(r.h)}" rx="8" fill="#ffffff" stroke="${färg}" stroke-width="1.5"/>` +
      // Bandet: rundat åt vänster som rutan, rakt åt höger.
      `<path d="M${nr(r.x + 8)},${nr(r.y)} H${nr(r.x + BAND)} V${nr(r.y + r.h)} H${nr(r.x + 8)} a8,8 0 0 1 -8,-8 V${nr(r.y + 8)} a8,8 0 0 1 8,-8 z" fill="${färg}"/>` +
      `<g transform="translate(${nr(r.x + (BAND - 22) / 2)},${nr(r.y + (r.h - 22) / 2)}) scale(0.9167)" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${symbol(o.sort)}</g>`;
  return `<g data-skiss-objekt="${esc(o.id)}">${kropp}${text}</g>`;
}

/** En fylld pilspets i `spets`, riktad från `bak`. */
function pilspets(bak: Point, spets: Point): string {
  const l = Math.hypot(spets.x - bak.x, spets.y - bak.y) || 1;
  const ux = (spets.x - bak.x) / l;
  const uy = (spets.y - bak.y) / l;
  const L = 9;
  const B = 4;
  const bx = spets.x - ux * L;
  const by = spets.y - uy * L;
  return `<polygon points="${nr(spets.x)},${nr(spets.y)} ${nr(bx - uy * B)},${nr(by + ux * B)} ${nr(bx + uy * B)},${nr(by - ux * B)}" fill="${LINJE}"/>`;
}

function kopplingSvg(l: KopplingLayout): string {
  const { koppling: k, punkter: p } = l;
  if (p.length < 2) return "";
  let ut = `<g data-skiss-koppling="${esc(k.id)}">`;
  ut += `<path d="${pointsToPath(p, 6)}" fill="none" stroke="${LINJE}" stroke-width="1.5"${k.linje === "streckad" ? ' stroke-dasharray="6 4"' : ""}/>`;
  if (k.pil !== "ingen") ut += pilspets(p[p.length - 2], p[p.length - 1]);
  if (k.pil === "båda") ut += pilspets(p[1], p[0]);
  if (k.etikett && l.etikett) {
    const r = etikettRuta(k.etikett, l.etikett);
    ut +=
      `<rect x="${nr(r.x)}" y="${nr(r.y)}" width="${nr(r.w)}" height="${nr(r.h)}" rx="4" fill="#ffffff" stroke="#d7dce4" stroke-width="0.8"/>` +
      `<text x="${nr(l.etikett.x)}" y="${nr(l.etikett.y + 4)}" font-size="11" text-anchor="middle" fill="${DÄMPAD}">${esc(k.etikett)}</text>`;
  }
  return ut + "</g>";
}

/**
 * Bildens INNEHÅLL (utan `<svg>`-omslag), i skissens egna koordinater: zoner
 * underst (störst först, så en zon i en zon syns), sedan kopplingar, sedan
 * objekt.
 */
export function skissInnehåll(skiss: Systemskiss, g: SkissGeometri = skissGeometri(skiss)): string {
  const zoner = [...skiss.zoner].sort((a, b) => b.b * b.h - a.b * a.h);
  return (
    zoner.map(zonSvg).join("") +
    g.kopplingar.map(kopplingSvg).join("") +
    skiss.objekt.map((o) => objektSvg(g.objekt.get(o.id)!)).join("")
  );
}

/**
 * Hela bilden som fristående SVG – exporten. Med `revision` får bilden samma
 * revisionsruta som processernas exporter (version, status, klassning –
 * tools/flowchart/export/revision.ts), under bilden till vänster.
 */
export function skissSvg(skiss: Systemskiss, revision?: Revision, val: LayoutVal = {}): { svg: string; bredd: number; höjd: number } {
  const g = skissGeometri(skiss, val);
  const { x, y } = g.gräns;
  const rm = revisionsMått(revision);
  const luft = rm.h ? 12 : 0;
  const w = Math.max(g.gräns.w, rm.w + 24);
  const h = g.gräns.h + rm.h + luft;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${nr(w)}" height="${nr(h)}" viewBox="${nr(x)} ${nr(y)} ${nr(w)} ${nr(h)}" font-family='${SKISS_TECKENSNITT}'>` +
    `<title>${esc(skiss.namn)}</title>` +
    `<rect x="${nr(x)}" y="${nr(y)}" width="${nr(w)}" height="${nr(h)}" fill="#ffffff"/>` +
    skissInnehåll(skiss, g) +
    revisionsRuta(x + 12, y + g.gräns.h, revision) +
    `</svg>`;
  return { svg, bredd: w, höjd: h };
}

/**
 * Revisionsrutan för en version av skissen (index -1 = senaste) – samma
 * funktion som processernas exporter stämplar med. `klassning` är den färdiga
 * texten ur `klassningIExport` (tom = ingen rad).
 */
export function skissRevision(s: Systemskiss, index: number, osparat: boolean, klassning = ""): Revision | undefined {
  const rev = revisionAvVersion({ savedAt: s.savedAt, versions: skissVersioner(s) }, index, osparat);
  return klassning ? { ...rev, klassning } : rev;
}
