/**
 * "Räta upp kopplingarna" – linjerar markerade objekt så att strecken emellan
 * dem blir raka, vågrätt eller lodrätt.
 *
 * Routern rätar redan ut BRUS på egen hand: ligger två motstående portar inom
 * några pixlar från varandra dras de till samma linje (`RAK_TOLERANS` i
 * edge-router). Det som blir kvar är RIKTIG förskjutning – två objekt som står
 * tio–femtio pixlar isär i höjdled fastän kopplingen mellan dem läses som
 * vågrät. Den kan inte rätas i ritningen, bara i utlägget: objekten måste
 * flytta på sig ("det innebär ju att objekten måste linjera upp så klart",
 * beslut 2026-09-08). Därför är det här en ÅTGÄRD användaren utlöser, inte en
 * regel som verkställs i tysthet.
 *
 * Modulen räknar bara – den skriver ingenting. ApTool tar emot lägena och lägger
 * dem i mellanlagret som vilket musdrag som helst, så ångra fungerar som vanligt.
 */

import { ikonPortRuta } from "./former";
import type { ApLaidOutNode, ApLayout } from "./layout-affarsprocess";

/** Axeln en koppling linjeras på: "y" = vågrätt streck, "x" = lodrätt. */
type Axel = "x" | "y";

export interface Flytt {
  /** Objektets id. */
  id: string;
  /** Nytt läge i FRIA layoutens koordinater (invariant 5). */
  position: { x: number; y: number };
}

/**
 * SYMBOLENS mitt, inte rutans.
 *
 * Pilarna fäster i symbolen, och för ikontyperna (verksamhetsobjekt, cylinder,
 * aktör) sitter den högt upp i rutan med namnet under. Linjerade vi rutornas
 * mitt skulle en aktivitet och ett verksamhetsobjekt hamna på samma rutmitt men
 * med portarna kvar på var sin höjd – alltså precis det krokiga streck vi
 * försöker bli av med.
 */
function symbolMitt(n: ApLaidOutNode): { x: number; y: number } {
  const ikon = ikonPortRuta(n.node.kind, n.w, n.h);
  return {
    x: n.x + (ikon ? ikon.x + ikon.w / 2 : n.w / 2),
    y: n.y + (ikon ? ikon.y + ikon.h / 2 : n.h / 2),
  };
}

/** Enkel union-find över objekt-id:n. */
class Klasser {
  private far = new Map<string, string>();

  rot(id: string): string {
    const f = this.far.get(id);
    if (f === undefined || f === id) return id;
    const r = this.rot(f);
    this.far.set(id, r);
    return r;
  }

  slåIhop(a: string, b: string): void {
    const ra = this.rot(a);
    const rb = this.rot(b);
    if (ra !== rb) this.far.set(ra, rb);
  }

  samma(a: string, b: string): boolean {
    return this.rot(a) === this.rot(b);
  }
}

/** Medianen – det värde som flyttar FÄRST objekt. */
function median(tal: number[]): number {
  const s = [...tal].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Räknar fram nya lägen så att kopplingarna MELLAN de markerade objekten blir
 * raka. Objekt utanför markeringen rörs aldrig, och kopplingar ut ur
 * markeringen räknas inte – man rätar upp det man pekat ut, inget annat.
 *
 * Returnerar bara de objekt som faktiskt flyttar.
 */
export function rätaUppKopplingar(lo: ApLayout, markerade: readonly string[]): Flytt[] {
  const valda = new Set(markerade);
  const platsAv = new Map(
    lo.nodes.filter((n) => valda.has(n.node.id)).map((n) => [n.node.id, n]),
  );
  if (platsAv.size < 2) return [];

  const mittAv = new Map<string, { x: number; y: number }>();
  for (const [id, n] of platsAv) mittAv.set(id, symbolMitt(n));

  /**
   * Vilken axel varje koppling ska linjeras på, och hur snett den ligger.
   *
   * Riktningen läses ur objektens LÄGEN, inte ur anslutningssidorna: sidorna
   * väljs av routern utifrån samma lägen, och en koppling som ska bli vågrät
   * kan mycket väl ha fått en L-formad sidsättning just för att den ligger
   * snett. Ligger objekten längre isär i sidled än i höjdled är strecket menat
   * som vågrätt.
   */
  const kandidater: { a: string; b: string; axel: Axel; avvikelse: number }[] = [];
  for (const rel of lo.relations) {
    if (!valda.has(rel.source) || !valda.has(rel.target)) continue;
    if (rel.source === rel.target) continue;
    const ma = mittAv.get(rel.source)!;
    const mb = mittAv.get(rel.target)!;
    const dx = Math.abs(ma.x - mb.x);
    const dy = Math.abs(ma.y - mb.y);
    const axel: Axel = dx >= dy ? "y" : "x";
    const avvikelse = axel === "y" ? dy : dx;
    if (avvikelse === 0) continue; // redan rak
    kandidater.push({ a: rel.source, b: rel.target, axel, avvikelse });
  }
  if (!kandidater.length) return [];

  /**
   * DE RAKASTE FÖRST.
   *
   * Kopplingarna slås ihop till linjer i tur och ordning, och en koppling som
   * redan nästan är rak bär mer information om vad användaren menade än en som
   * ligger snett på tvären. Tas de i den ordningen blir det den snedaste som
   * får stå tillbaka när två krav krockar, inte den som råkade komma först i
   * modellen.
   */
  kandidater.sort((p, q) => p.avvikelse - q.avvikelse);

  const linjer: Record<Axel, Klasser> = { x: new Klasser(), y: new Klasser() };
  for (const k of kandidater) {
    /**
     * KROCKVAKT: två objekt får aldrig hamna på samma linje i BÅDA led.
     *
     * Med a–b vågrät, b–c lodrät och a–c vågrät hamnar b och c på samma y
     * (via a) och samma x (via varandra) – alltså ovanpå varandra. Den
     * kopplingen hoppas över i stället; den ligger sist i ordningen ovan, så
     * det är den snedaste av dem som offras.
     */
    const annan: Axel = k.axel === "x" ? "y" : "x";
    if (linjer[annan].samma(k.a, k.b)) continue;
    linjer[k.axel].slåIhop(k.a, k.b);
  }

  const flyttar = new Map<string, { x: number; y: number }>();
  for (const axel of ["x", "y"] as const) {
    const grupper = new Map<string, string[]>();
    for (const id of platsAv.keys()) {
      const rot = linjer[axel].rot(id);
      grupper.set(rot, [...(grupper.get(rot) ?? []), id]);
    }
    for (const medlemmar of grupper.values()) {
      if (medlemmar.length < 2) continue;
      const mål = median(medlemmar.map((id) => mittAv.get(id)![axel]));
      for (const id of medlemmar) {
        const delta = mål - mittAv.get(id)![axel];
        if (delta === 0) continue;
        const nu = flyttar.get(id) ?? { x: 0, y: 0 };
        flyttar.set(id, { ...nu, [axel]: delta });
      }
    }
  }

  const ut: Flytt[] = [];
  for (const [id, delta] of flyttar) {
    const n = platsAv.get(id)!;
    // Lägena sparas i FRIA ramen (invariant 5): skärmläget minus objektets
    // förskjutning, precis som ett musdrag skriver dem.
    ut.push({
      id,
      position: { x: n.x - n.dx + delta.x, y: n.y - n.dy + delta.y },
    });
  }
  return ut;
}
