/**
 * Scenens geometri – pulsernas vägar och pratbubblornas lägen. Rena
 * funktioner, så att redigeringen, presentationen och det egna fönstret ritar
 * samma sak.
 */

import type { ScenFigur } from "@/core/ram-scen";
import { figurRuta } from "./scen-figurer";

export interface Punkt {
  x: number;
  y: number;
}

/**
 * Hur långt (skärmpixlar) pekaren ska röra sig innan ett nedslag på en figur
 * räknas som en flytt och inte ett klick. Figurerna går att dra med alla
 * verktyg; utan tröskeln blev varje klick med "Puls mellan" en liten flytt.
 */
export const DRAG_TRÖSKEL = 4;

export function ärDragning(från: Punkt, till: Punkt): boolean {
  return Math.hypot(till.x - från.x, till.y - från.y) >= DRAG_TRÖSKEL;
}

/** Luft mellan figurens kant och pulsens ände. */
const ÄNDLUFT = 10;

/**
 * Var en stråle från mitten mot `mot` lämnar figurens ruta (plus luft). Pulsen
 * ska börja vid figuren, inte mitt i den – annars går den genom kundens
 * ansikte.
 */
function kantpunkt(f: ScenFigur, mot: Punkt): Punkt {
  const [, , w, h] = figurRuta(f);
  const dx = mot.x - f.x;
  const dy = mot.y - f.y;
  const hw = w / 2 + ÄNDLUFT;
  const hh = h / 2 + ÄNDLUFT;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity, 1);
  return { x: f.x + dx * t, y: f.y + dy * t };
}

/**
 * Pulsens väg från → till: en mjuk båge som alltid buktar UPPÅT (över
 * gatan, inte ner i marken), så att två pulser åt var sitt håll mellan samma
 * figurer inte lägger sig ovanpå varandra – den ena buktar mer.
 */
export function pulsVäg(från: ScenFigur, till: ScenFigur): { d: string; mitt: Punkt } {
  const a = kantpunkt(från, till);
  const b = kantpunkt(till, från);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // Normalen som pekar uppåt.
  let nx = -(b.y - a.y) / dist;
  let ny = (b.x - a.x) / dist;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  // Vänster→höger buktar mindre än höger→vänster: fram och tillbaka syns båda.
  const bukt = dist * (a.x <= b.x ? 0.16 : 0.3);
  const c = { x: mx + nx * bukt, y: my + ny * bukt };
  const f = (n: number) => n.toFixed(1);
  return {
    d: `M${f(a.x)},${f(a.y)} Q${f(c.x)},${f(c.y)} ${f(b.x)},${f(b.y)}`,
    // Kurvans mitt (t = 0,5), där etiketten står.
    mitt: { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y },
  };
}

/** Bryter en text i rader på högst `max` tecken, på ord. */
export function brytRader(text: string, max: number): string[] {
  const rader: string[] = [];
  for (const stycke of text.split("\n")) {
    let rad = "";
    for (const ord of stycke.split(/\s+/).filter(Boolean)) {
      if (rad && (rad + " " + ord).length > max) {
        rader.push(rad);
        rad = ord;
      } else rad = rad ? `${rad} ${ord}` : ord;
    }
    rader.push(rad);
  }
  return rader;
}

/** Textrutans typografi – rubriken i accentfärg, brödtexten under. */
export const TEXTRUTA = { rubrik: 17, text: 17, rad: 24, luft: 16, tecken: 8.9 };

/**
 * En textrutas rader och höjd. Rubriken bryts inte (den ska vara kort);
 * brödtexten bryts på ord efter rutans bredd.
 */
export function textrutaLäge(t: { bredd: number; rubrik?: string; text: string; skala?: number }): {
  rubrik: string | null;
  rader: string[];
  h: number;
  /** Måtten efter skalan – ritningen använder samma. */
  m: { rubrik: number; text: number; rad: number; luft: number; skiljare: number };
} {
  const k = t.skala ?? 1;
  const m = {
    rubrik: TEXTRUTA.rubrik * k,
    text: TEXTRUTA.text * k,
    rad: TEXTRUTA.rad * k,
    luft: TEXTRUTA.luft * k,
    skiljare: 10 * k,
  };
  const perRad = Math.max(6, Math.floor((t.bredd - 2 * m.luft) / (TEXTRUTA.tecken * k)));
  const rubrik = t.rubrik?.trim() ? t.rubrik.trim() : null;
  const rader = t.text.trim() ? brytRader(t.text, perRad) : [];
  const h = m.luft * 2 + (rubrik ? m.rad + (rader.length ? m.skiljare : 0) : 0) + rader.length * m.rad;
  return { rubrik, rader, h: Math.max(h, 48 * k), m };
}

/** Ljus färg? Avgör om rubriken ska vara mörk i stället för accentfärgad. */
export function ärLjus(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

export const BUBBLA_TEXT = 17;
const BUBBLA_RAD = 22;
const TECKEN = 8.6;

/**
 * Pratbubblans ruta och spets. Bubblan står snett ovanför figuren, och vänder
 * åt vänster när den annars hade gått ut ur bilden till höger.
 */
export function bubblaLäge(
  f: ScenFigur,
  text: string,
  scenBredd: number,
): { x: number; y: number; w: number; h: number; rader: string[]; spets: string; sx: number } {
  const rader = brytRader(text, 30);
  const w = Math.max(80, Math.max(...rader.map((r) => r.length)) * TECKEN + 28);
  const h = rader.length * BUBBLA_RAD + 20;
  const [rx, ry, rw] = figurRuta(f);
  const åtHöger = rx + rw * 0.6 + w < scenBredd - 10;
  const x = åtHöger ? rx + rw * 0.6 : rx + rw * 0.4 - w;
  const y = Math.max(8, ry - h - 18);
  // Spetsen pekar ner mot figurens överkant.
  const sx = åtHöger ? x + 22 : x + w - 22;
  const spets = `M${sx - 9},${y + h - 1} L${åtHöger ? sx - 14 : sx + 14},${y + h + 16} L${sx + 9},${y + h - 1} Z`;
  return { x, y, w, h, rader, spets, sx };
}
