/**
 * Geometri för kanternas kopplingspunkter.
 *
 * Ligger som rena funktioner utanför React så att matematiken går att testa.
 * Det är medvetet: själva musgesten går inte att verifiera i den här miljön,
 * men allt den räknar ut kan testas – då återstår bara händelsekopplingen som
 * osäker faktor i stället för hela kedjan.
 */

import type { EdgeSide } from "@/core/model";
import { pickEdgeSides } from "../layout/edge-router";

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Punkten på en given sida av en ruta.
 *
 * `pos` är var LÄNGS sidan punkten sitter: 0 = början (vänster/överst),
 * 1 = slutet, 0,5 = mitten (förvalet). Fyra mittpunkter räckte inte – pilar
 * ska kunna fästa en bit in på kanten, och två pilar till samma sida ska kunna
 * gå bredvid varandra.
 */
export function portPoint(box: Box, side: EdgeSide, pos = 0.5): Point {
  const p = Math.min(1, Math.max(0, pos));
  switch (side) {
    case "top":
      return { x: box.x + box.w * p, y: box.y };
    case "bottom":
      return { x: box.x + box.w * p, y: box.y + box.h };
    case "left":
      return { x: box.x, y: box.y + box.h * p };
    case "right":
      return { x: box.x + box.w, y: box.y + box.h * p };
  }
}

/**
 * Kopplingspunkterna längs varje sida (0–1).
 *
 * EN uppsättning för hela appen: ändpunktsdraget snäpper mot dem, och det är
 * dem ytan visar när en koppling är vald. Annars fäster pilarna på ställen där
 * det inte finns någon kopplingspunkt att peka på – "de ligger ju på andra
 * ställen".
 * Fem per sida: en mitt på och två åt vardera hållet, så två pilar till samma
 * sida kan gå bredvid varandra i stället för ovanpå varandra.
 */
export const KOPPLINGSPUNKTER = [0.15, 0.3, 0.5, 0.7, 0.85];

/** Närmaste kopplingspunkt till en andel längs sidan. */
export function snäppPunkt(andel: number): number {
  return KOPPLINGSPUNKTER.reduce((bäst, p) =>
    Math.abs(p - andel) < Math.abs(bäst - andel) ? p : bäst,
  );
}

/**
 * Var längs en sida en punkt ligger (0–1). Motsatsen till `portPoint` – används
 * när man DRAGIT en ändpunkt och vill veta vilken kopplingspunkt det blev.
 */
export function sidePos(box: Box, side: EdgeSide, p: Point): number {
  const andel =
    side === "top" || side === "bottom"
      ? box.w === 0
        ? 0.5
        : (p.x - box.x) / box.w
      : box.h === 0
        ? 0.5
        : (p.y - box.y) / box.h;
  return Math.min(1, Math.max(0, andel));
}

/**
 * Vilken sida av rutan som ligger närmast en punkt.
 *
 * Jämför avståndet till varje sidas mittpunkt. Enkelt och förutsägbart – drar
 * man mot ovansidan får man toppen, oavsett var längs kanten man släpper.
 */
export function nearestSide(box: Box, p: Point): EdgeSide {
  const sides: EdgeSide[] = ["top", "right", "bottom", "left"];
  let bästa: EdgeSide = "top";
  let minsta = Infinity;
  for (const side of sides) {
    const q = portPoint(box, side);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < minsta) {
      minsta = d;
      bästa = side;
    }
  }
  return bästa;
}

/**
 * Vilken ruta pekaren är över. Träffar man ingen ruta väljs den närmaste inom
 * `radie` – annars är det för lätt att missa och tappa dragningen.
 */
export function hitBox(boxes: Box[], p: Point, radie = 60): Box | null {
  for (const b of boxes) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
  }
  let närmast: Box | null = null;
  let minsta = radie * radie;
  for (const b of boxes) {
    const cx = Math.max(b.x, Math.min(p.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(p.y, b.y + b.h));
    const d = (cx - p.x) ** 2 + (cy - p.y) ** 2;
    if (d < minsta) {
      minsta = d;
      närmast = b;
    }
  }
  return närmast;
}

/**
 * Automatiskt sidval enligt ISO 5807 – samma regel som canvas och exportörerna
 * använder när användaren inte valt sida själv. Ligger här så att ändens
 * utgångsläge kan ritas på rätt ställe innan något dragits.
 *
 * EN regel, en plats: funktionen ÄR `pickEdgeSides`, bara med namngivna fält.
 * Reglerna låg tidigare kopierade här, och en ändring i den ena flyttade
 * handtaget till en annan sida än pilen faktiskt ritades på.
 */
export function autoSides(
  a: Box,
  b: Box,
  /**
   * Kantens etikett. MÅSTE skickas med (invariant 3): `pickEdgeSides` läser den
   * för att avgöra om kanten är en GREN – och en gren lämnar botten i stället
   * för sidan. Utan etiketten svarade den här funktionen "höger" om en Nej-pil
   * som ritades ut ur botten, så dragghandtaget hamnade på en sida där ingen pil
   * fanns. Man greppade där pilen syntes, fick inget grepp, och kunde varken
   * flytta kopplingspunkten eller förstå varför.
   */
  label?: string,
): { source: EdgeSide; target: EdgeSide } {
  const [source, target] = pickEdgeSides(a, b, { label });
  return { source, target };
}
