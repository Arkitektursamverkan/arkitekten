/**
 * Dubbla sidhänvisningar på SAMMA objekt – vilket märke som ska döljas.
 *
 * Går både en sekvenspil och en streckad association över samma snitt till
 * samma ruta får rutan två märken med exakt samma text ("från del 2") staplade
 * på varandra. De säger inget nytt – flödet fortsätter ju från en och samma
 * del. Sekvenspilens märke behålls (det är flödet), artefaktens döljs.
 *
 * EN REGEL, EN PLATS. Regeln fanns först bara i skriptet som skapade
 * avvikelseflödena, så flöden som ändrats efteråt i appen kunde få tillbaka
 * dubbelmärket utan att något upptäckte det – precis det som hände "byt
 * avdelning/enhet". Nu läser både generatorn och rättningsskriptet härifrån.
 */

import { edgeKey } from "@/core/draft";
import type { EdgeSides } from "@/core/draft";
import type { ProcessModel } from "@/core/model";
import type { LayoutResult } from "./layout";

/**
 * Kantstilarna som döljer de överflödiga märkena, redo att slås ihop med
 * draftens `edgeStyles`. Tom post = inget att dölja.
 */
export function döljDubblaHänvisningar(
  modell: ProcessModel,
  lay: LayoutResult,
): Record<string, EdgeSides> {
  const sekvens = new Set<string>(modell.edges.map((e) => `${e.source}->${e.target}`));
  const etikett = new Map<string, string | undefined>(
    modell.edges.map((e) => [`${e.source}->${e.target}`, e.label]),
  );

  const grupper = new Map<string, typeof lay.pageRefs>();
  for (const r of lay.pageRefs) {
    const k = `${r.nodeId}|${r.sida}|${r.text}`;
    (grupper.get(k) ?? grupper.set(k, []).get(k)!).push(r);
  }

  const ut: Record<string, EdgeSides> = {};
  for (const flock of grupper.values()) {
    if (flock.length < 2) continue;
    // Behåll sekvenspilens märke; finns ingen sekvenspil behålls det första.
    const behåll = flock.find((r) => sekvens.has(`${r.edgeSource}->${r.edgeTarget}`)) ?? flock[0];
    for (const r of flock) {
      if (r === behåll) continue;
      const par = `${r.edgeSource}->${r.edgeTarget}`;
      // Etiketten måste med i nyckeln – två pilar kan dela nodpar.
      const nyckel = edgeKey(r.edgeSource, r.edgeTarget, etikett.get(par) ?? undefined);
      ut[nyckel] = { ...(ut[nyckel] ?? {}), [r.sida === "in" ? "hideRefIn" : "hideRefOut"]: true };
    }
  }
  return ut;
}
