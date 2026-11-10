/**
 * Perspektivfiltret bygger om kanterna från grunden. Varje fält som inte
 * uttryckligen kopieras försvinner tyst – och eftersom filtret körs i sista
 * steget före ritningen ser det ut som om editorn ignorerar användarens val.
 * Exakt så tappades kopplingspunkterna en gång; därav testerna nedan.
 */

import { describe, expect, it } from "vitest";
import { compileDraft, setEdgeSides, setEdgeWaypoint } from "@/core/draft";
import { textToDraft } from "./parser/toDraft";
import { filterByPerspective } from "./perspective";

const TEXT = `Driftfråga ny
Fel uppkommer → Startar Portalen → Fyller i formulär → Mejl skickas till handläggaren → Power Automate flödet triggas → Loggpost skapas`;

const draft = textToDraft(TEXT);

describe("filterByPerspective – bevarar kantegenskaper", () => {
  it("REGRESSION: behåller manuellt valda kopplingspunkter", () => {
    const med = setEdgeSides(draft, "s1", "s2", { sourceSide: "top", targetSide: "bottom" });
    const model = compileDraft(med);

    for (const p of ["system", "business"] as const) {
      const kant = filterByPerspective(model, p).edges.find(
        (e) => e.source === "s1" && e.target === "s2",
      );
      expect(kant, `kanten ska finnas i ${p}-vyn`).toBeDefined();
      expect(kant!.sourceSide, `sourceSide i ${p}-vyn`).toBe("top");
      expect(kant!.targetSide, `targetSide i ${p}-vyn`).toBe("bottom");
    }
  });

  it("REGRESSION: behåller en manuell brytpunkt genom filtret", () => {
    // Filtret byggde om kanterna fält för fält och tappade waypoint – kanten
    // gick runt rätt sida under själva draget men hoppade tillbaka vid släpp.
    const med = setEdgeWaypoint(draft, "s1", "s2", { x: 140, y: 260 });
    const model = compileDraft(med);
    for (const p of ["system", "business"] as const) {
      const kant = filterByPerspective(model, p).edges.find(
        (e) => e.source === "s1" && e.target === "s2",
      );
      expect(kant?.waypoint, `waypoint i ${p}-vyn`).toEqual({ x: 140, y: 260 });
    }
  });

  it("behåller meddelandeflödet och dess mottagarpool genom filtret", () => {
    const model = compileDraft(draft);
    const notis = model.nodes.find((n) => n.type === "notification")!;
    const original = model.messageFlows.filter((mf) => mf.nodeId === notis.id);
    expect(original.length).toBeGreaterThan(0);

    const vy = filterByPerspective(model, "system");
    const filtrerad = vy.messageFlows.filter((mf) => mf.nodeId === notis.id);
    expect(filtrerad).toHaveLength(original.length);
    // Mottagarpoolen måste följa med, annars går pilen ut i tomma intet.
    for (const mf of filtrerad) {
      expect(vy.pools.find((p) => p.id === mf.poolId)?.blackBox).toBe(true);
    }
  });

  it("datalager ligger utanför kanterna även efter filtrering", () => {
    const vy = filterByPerspective(compileDraft(draft), "system");
    const storeIds = new Set(vy.dataStores.map((ds) => ds.id));
    expect(storeIds.size).toBeGreaterThan(0);
    expect(vy.edges.some((e) => storeIds.has(e.source) || storeIds.has(e.target))).toBe(false);
  });

  it("släpper målsidan när kanten hoppar förbi dolda noder", () => {
    // I verksamhetsvyn döljs tekniska noder; kanten får ett nytt mål och den
    // valda målsidan pekar då på något som inte längre ritas.
    const model = compileDraft(draft);
    const teknisk = model.nodes.find((n) => !n.perspectives.includes("business"))!;
    const inkommande = model.edges.find((e) => e.target === teknisk.id)!;

    const med = setEdgeSides(draft, inkommande.source, teknisk.id, {
      sourceSide: "right",
      targetSide: "left",
    });
    const vy = filterByPerspective(compileDraft(med), "business");

    const omdirigerad = vy.edges.filter((e) => e.source === inkommande.source);
    for (const e of omdirigerad) {
      // Källsidan gäller fortfarande – källnoden är kvar och synlig.
      expect(e.sourceSide).toBe("right");
      // Målsidan gäller bara om kanten faktiskt går till sitt ursprungliga mål.
      if (e.target !== teknisk.id) expect(e.targetSide).toBeUndefined();
    }
  });

  it("REGRESSION: varje synlig nod har kvar sin bana", () => {
    // Banor filtrerades på BANANS perspektiv och noder på NODENS. En nod kunde
    // därför överleva medan dess bana föll bort – då fanns inget band att ligga
    // i och noden försvann tyst ur diagrammet. Så tappade verksamhetsvyn sin
    // automatiska slutnod, som ärver bana från sista steget men syns i båda vyerna.
    const model = compileDraft(draft);
    for (const p of ["business", "system"] as const) {
      const vy = filterByPerspective(model, p);
      const banor = new Set(vy.swimlanes.map((l) => l.id));
      for (const n of vy.nodes) {
        expect(banor.has(n.laneId), `${n.id} "${n.label}" saknar bana ${n.laneId} i ${p}-vyn`).toBe(true);
      }
      for (const ds of vy.dataStores) {
        expect(banor.has(ds.laneId), `datalagret ${ds.id} saknar bana i ${p}-vyn`).toBe(true);
      }
    }
  });

  it("REGRESSION: slutnoden finns kvar i verksamhetsvyn", () => {
    const vy = filterByPerspective(compileDraft(draft), "business");
    expect(vy.nodes.some((n) => n.type === "end"), "flödet har inget slut").toBe(true);
  });

  it("tomma banor ritas fortfarande inte", () => {
    const vy = filterByPerspective(compileDraft(draft), "business");
    const bebodda = new Set([
      ...vy.nodes.map((n) => n.laneId),
      ...vy.dataStores.map((ds) => ds.laneId),
    ]);
    expect(vy.swimlanes.every((l) => bebodda.has(l.id))).toBe(true);
  });

  it("REGRESSION: banan man drog ut sista objektet ur står kvar i redigeringen", () => {
    // Banan försvann, så objektet hamnade på samma plats på skärmen och det såg
    // ut som att draget inte gjort något. Utan listan ritas tomma banor inte.
    const modell = compileDraft(draft);
    const tom = { ...modell.swimlanes[0], id: "Tom", title: "Tom" };
    const medTom = { ...modell, swimlanes: [...modell.swimlanes, tom] };
    expect(filterByPerspective(medTom, "system").swimlanes.some((l) => l.id === "Tom")).toBe(false);
    expect(filterByPerspective(medTom, "system", new Set(["Tom"])).swimlanes.some((l) => l.id === "Tom")).toBe(true);
  });

  it("påverkar inte kanter utan valda sidor", () => {
    const model = compileDraft(draft);
    const vy = filterByPerspective(model, "system");
    expect(vy.edges.every((e) => e.sourceSide === undefined)).toBe(true);
    expect(vy.edges.every((e) => e.targetSide === undefined)).toBe(true);
  });
});
