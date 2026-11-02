/**
 * Perspektivfilter (KRAV 4): verksamhets- vs systemvy.
 *
 * Verksamhetsvyn döljer tekniska noder (system, integration, notifiering,
 * datalager) och rent tekniska swimlanes. Kanter som pekar på en dold nod
 * "hoppas över" så att flödet förblir sammanhängande.
 */

import type { Perspective, ProcessModel } from "@/core/model";

/**
 * `behållBanor` är banor som ritas även tomma: den man just dragit ut sista
 * objektet ur ska stå kvar i redigeringen. Bilder och export skickar aldrig med den.
 */
export function filterByPerspective(
  model: ProcessModel,
  p: Perspective,
  behållBanor?: ReadonlySet<string>,
): ProcessModel {
  const keep = new Set(
    model.nodes.filter((n) => n.perspectives.includes(p)).map((n) => n.id),
  );

  // Bygg kanter: hoppa förbi dolda noder så flödet inte bryts.
  const adj = new Map<string, string[]>();
  for (const e of model.edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
  }

  const edges = [];
  const seen = new Set<string>();
  for (const e of model.edges) {
    if (!keep.has(e.source)) continue;
    // Följ kedjan tills vi når en synlig målnod.
    const targets = resolveVisibleTargets(e.target, keep, adj, new Set());
    for (const t of targets) {
      const key = `${e.source}->${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // SPRID originalkanten – bygg aldrig om den fält för fält. Varje
      // handbyggd kopia har tappat ett manuellt val i sista steget före
      // ritningen (först kopplingspunkterna, sedan sidhänvisningarna, senast
      // brytpunkten) och användarens ändring såg ut att ignoreras. Med
      // spridningen överlever även FRAMTIDA fält som standard.
      //
      // Källsidans val gäller alltid (källnoden är kvar). Målsidans gäller
      // bara när kanten går direkt till sitt ursprungliga mål – har vi hoppat
      // förbi dolda noder pekar valen på en nod som inte längre ritas.
      const direkt = keep.has(e.target);
      edges.push({
        ...e,
        id: `${e.id}_${t}`,
        target: t,
        label: direkt ? e.label : undefined,
        targetSide: direkt ? e.targetSide : undefined,
        waypoint: direkt ? e.waypoint : undefined,
        hideRefIn: direkt ? e.hideRefIn : undefined,
        perspectives: [p],
      });
    }
  }

  // Artefakter och meddelandeflöden filtreras på sina egna perspektiv, och
  // associationer följer med bara om båda ändarna är kvar.
  const dataStores = model.dataStores.filter((ds) => ds.perspectives.includes(p));
  const storeIds = new Set(dataStores.map((ds) => ds.id));
  const dataAssociations = model.dataAssociations.filter(
    (a) => keep.has(a.nodeId) && storeIds.has(a.dataStoreId),
  );
  const messageFlows = model.messageFlows.filter((f) => keep.has(f.nodeId));
  const poolIds = new Set(messageFlows.map((f) => f.poolId));

  const laneUsed = new Set([
    ...[...keep].map((id) => model.nodes.find((n) => n.id === id)!.laneId),
    ...dataStores.map((ds) => ds.laneId),
  ]);

  return {
    ...model,
    nodes: model.nodes.filter((n) => keep.has(n.id)),
    edges,
    dataStores,
    dataAssociations,
    messageFlows,
    // Mottagarpooler utan kvarvarande meddelandeflöde ska inte ritas.
    pools: model.pools.filter((pool) => !pool.blackBox || poolIds.has(pool.id)),
    // En bana som fortfarande RYMMER något synligt måste ritas, även om banans
    // egna perspektiv inte innehåller p. Filtrerades banan bort hade noden inget
    // band att ligga i och försvann tyst ur diagrammet – så tappade t.ex.
    // verksamhetsvyn sin slutnod. Banans perspektiv styr i praktiken redan vilka
    // noder som överlever (via `laneDefaultPerspectives`); tomma banor faller
    // bort på `laneUsed` som förut.
    swimlanes: model.swimlanes
      .filter((l) => laneUsed.has(l.id) || behållBanor?.has(l.id))
      .map((l) => (laneUsed.has(l.id) ? l : { ...l, ritasTom: true })),
  };
}

function resolveVisibleTargets(
  start: string,
  keep: Set<string>,
  adj: Map<string, string[]>,
  visited: Set<string>,
): string[] {
  if (keep.has(start)) return [start];
  if (visited.has(start)) return [];
  visited.add(start);
  const out: string[] = [];
  for (const next of adj.get(start) ?? []) {
    for (const t of resolveVisibleTargets(next, keep, adj, visited)) {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}
