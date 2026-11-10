import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutModel } from "@/tools/flowchart/layout/layout";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import {
  addStepAfter,
  allLanes,
  clearPositions,
  compileDraft,
  edgeKey,
  emptyDraft,
  isEdgeRemoved,
  materializeEnd,
  setAutoLabel,
  setAutoPosition,
  setAutoLane,
  setPagePin,
  setTextStyle,
  moveLane,
  moveStep,
  moveStepTo,
  normalizeOrder,
  pairMessageSteps,
  removeEdge,
  removeStep,
  renameLane,
  addManualEdge,
  setEdgeLabel,
  etikettHinder,
  grenEtiketter,
  läggTillFritt,
  kopplingHinder,
  resetEdgeSides,
  setEdgeLabelPos,
  setEdgeWaypoint,
  setEdgeWaypoint2,
  restoreEdge,
  setEdgeSides,
  setLaneHeight,
  setStepPosition,
  syncStepTypes,
  updateStep,
  type ProcessDraft,
  makeLane,
  type DraftStep,
} from "./draft";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";

const TEXT = `Driftfråga ny
Fel uppkommer → Medarbetare → Startar Portalen → Fyller i formulär → Power Automate flödet triggas (↓ Om klassificering = Hög prioritet → Teamschatt skapas) → Mejl skickas till handläggaren`;

describe("textToDraft – platt steglista", () => {
  const draft = textToDraft(TEXT);

  it("sätter titel och ursprung", () => {
    expect(draft.title).toBe("Driftfråga ny");
    expect(draft.meta.origin).toBe("rules");
  });

  it("skapar ett steg per meningsbärande fragment", () => {
    // "Medarbetare" är ett aktörsfragment → swimlane-kontext, inte eget steg.
    expect(draft.steps.map((s) => s.text)).not.toContain("Medarbetare");
    expect(draft.steps.length).toBeGreaterThanOrEqual(5);
  });

  it("ger stegen stabila id:n i flödesordning", () => {
    expect(draft.steps[0].id).toBe("s1");
    expect(draft.steps.map((s) => s.id)).toEqual([...new Set(draft.steps.map((s) => s.id))]);
  });

  it("hänger grensteg under sitt beslut", () => {
    const decision = draft.steps.find((s) => s.type === "decision");
    expect(decision).toBeDefined();
    const branch = draft.steps.filter((s) => s.branchOf?.stepId === decision!.id);
    expect(branch.length).toBeGreaterThanOrEqual(1);
    expect(branch[0].branchOf!.label).toBe("Ja");
  });

  it("ligger steg efter parentesen kvar i huvudflödet", () => {
    const last = draft.steps[draft.steps.length - 1];
    expect(last.branchOf).toBeUndefined();
  });
});

describe("compileDraft – deterministisk kompilering", () => {
  const model = compileDraft(textToDraft(TEXT));

  it("skapar en nod per steg (plus auto-slut)", () => {
    const fromText = model.nodes.filter((n) => n.sourceIndex >= 0);
    expect(fromText.length).toBe(textToDraft(TEXT).steps.length);
  });

  it("behåller stegets id som nod-id (så positioner överlever redigering)", () => {
    expect(model.nodes.some((n) => n.id === "s1")).toBe(true);
  });

  it("grenar beslutet med Ja och låter Nej falla igenom", () => {
    const d = model.nodes.find((n) => n.type === "decision")!;
    const out = model.edges.filter((e) => e.source === d.id);
    expect(out.map((e) => e.label).sort()).toEqual(["Ja", "Nej"]);
  });

  it("återförenar grenen i nästa huvudflödessteg", () => {
    const d = model.nodes.find((n) => n.type === "decision")!;
    const ja = model.edges.find((e) => e.source === d.id && e.label === "Ja")!;
    const nej = model.edges.find((e) => e.source === d.id && e.label === "Nej")!;
    // Grensvansen och Nej-vägen ska mynna i samma nod.
    const jaTail = model.edges.find((e) => e.source === ja.target)!;
    expect(jaTail.target).toBe(nej.target);
  });

  it("avslutar flödet med ett slut-event", () => {
    expect(model.nodes.some((n) => n.type === "end")).toBe(true);
  });

  it("håller meddelanden utanför sekvensflödet", () => {
    // Ett meddelande går till en annan DELTAGARE och bor därför i
    // `messageFlows`, aldrig som en streckad kant i `edges`.
    expect(model.edges.some((e) => e.kind === "message")).toBe(false);
    for (const mf of model.messageFlows) {
      expect(model.pools.find((p) => p.id === mf.poolId)?.blackBox).toBe(true);
    }
  });

  it("datalager ligger som artefakter, aldrig i sekvensflödet", () => {
    const storeIds = new Set(model.dataStores.map((ds) => ds.id));
    expect(model.edges.some((e) => storeIds.has(e.source) || storeIds.has(e.target))).toBe(false);
    // Och varje lager är kopplat med minst en dataassociation.
    for (const ds of model.dataStores) {
      expect(model.dataAssociations.some((a) => a.dataStoreId === ds.id)).toBe(true);
    }
  });
});

describe("redigering av mellanlagret", () => {
  const draft = textToDraft(TEXT);

  it("byter typ på ett steg och slår igenom i modellen", () => {
    const target = draft.steps[2];
    const edited = updateStep(draft, target.id, { type: "system" });
    const model = compileDraft(edited);
    expect(model.nodes.find((n) => n.id === target.id)!.type).toBe("system");
    expect(edited.meta.origin).toBe("manual");
  });

  it("byte till datalager flyttar steget UT ur sekvensflödet", () => {
    // Datalager är artefakter i BPMN – de blir ingen nod och ingen kant.
    const target = draft.steps[2];
    const model = compileDraft(updateStep(draft, target.id, { type: "datastore" }));
    expect(model.nodes.some((n) => n.id === target.id)).toBe(false);
    expect(model.dataStores.some((d) => d.id === target.id)).toBe(true);
    expect(model.edges.some((e) => e.source === target.id || e.target === target.id)).toBe(false);
  });

  it("flyttar ett steg inom sitt scope och ändrar flödesordningen", () => {
    const a = draft.steps[1].id;
    const b = draft.steps[2].id;
    const moved = moveStep(draft, b, -1);
    expect(moved.steps[1].id).toBe(b);
    expect(moved.steps[2].id).toBe(a);
    const model = compileDraft(moved);
    expect(model.edges.some((e) => e.source === b && e.target === a)).toBe(true);
  });

  it("flyttar ett beslut som ett block – grenstegen följer med", () => {
    const last = draft.steps[draft.steps.length - 1];
    const d = draft.steps.find((s) => s.type === "decision")!;
    // Sista huvudflödessteget flyttas upp förbi HELA beslutsblocket.
    const moved = moveStep(draft, last.id, -1);
    const idxLast = moved.steps.findIndex((s) => s.id === last.id);
    const idxDecision = moved.steps.findIndex((s) => s.id === d.id);
    expect(idxLast).toBeLessThan(idxDecision);
    // Beslutets grensteg ligger kvar direkt efter beslutet.
    expect(moved.steps[idxDecision + 1].branchOf?.stepId).toBe(d.id);
    // Och grenen kompilerar fortfarande korrekt.
    const model = compileDraft(moved);
    const out = model.edges.filter((e) => e.source === d.id);
    expect(out.map((e) => e.label).sort()).toEqual(["Ja", "Nej"]);
  });

  it("tar bort ett steg och lyfter dess grensteg till huvudflödet", () => {
    const d = draft.steps.find((s) => s.type === "decision")!;
    const removed = removeStep(draft, d.id);
    expect(removed.steps.some((s) => s.id === d.id)).toBe(false);
    expect(removed.steps.every((s) => s.branchOf?.stepId !== d.id)).toBe(true);
    // Inget steg tappas – bara beslutet självt försvinner.
    expect(removed.steps.length).toBe(draft.steps.length - 1);
  });

  it("drar ett steg till en ny plats i huvudflödet", () => {
    const last = draft.steps[draft.steps.length - 1];
    const moved = moveStepTo(draft, last.id, 0);
    expect(moved.steps[0].id).toBe(last.id);
    expect(moved.steps[0].branchOf).toBeUndefined();
    // Kompilerar fortfarande till ett giltigt flöde.
    expect(compileDraft(moved).nodes.length).toBeGreaterThan(0);
  });

  it("drar ett steg IN i en gren – det ärver grenens tillhörighet", () => {
    const ordnad = normalizeOrder(draft);
    const d = ordnad.steps.find((s) => s.type === "decision")!;
    const grenSteg = ordnad.steps.find((s) => s.branchOf?.stepId === d.id)!;
    const grenIdx = ordnad.steps.findIndex((s) => s.id === grenSteg.id);
    const tidigt = ordnad.steps[1]; // ett steg ur huvudflödet

    // Släpp direkt EFTER grensteget = sist i Ja-grenen.
    const moved = moveStepTo(ordnad, tidigt.id, grenIdx + 1);
    const flyttat = moved.steps.find((s) => s.id === tidigt.id)!;
    expect(flyttat.branchOf).toEqual({ stepId: d.id, label: "Ja" });

    // Grenen har nu två steg och nås fortfarande via beslutets Ja-kant.
    const model = compileDraft(moved);
    const ja = model.edges.find((e) => e.source === d.id && e.label === "Ja")!;
    expect(ja.target).toBe(grenSteg.id);
    expect(model.edges.some((e) => e.source === grenSteg.id && e.target === tidigt.id)).toBe(true);
  });

  it("släpp på egen plats ändrar ingenting", () => {
    const ordnad = normalizeOrder(draft);
    const i = 2;
    expect(moveStepTo(ordnad, ordnad.steps[i].id, i)).toBe(ordnad);
  });

  it("drar ett grensteg UT till huvudflödet", () => {
    const branch = draft.steps.find((s) => s.branchOf)!;
    const moved = moveStepTo(draft, branch.id, 0);
    expect(moved.steps[0].id).toBe(branch.id);
    expect(moved.steps[0].branchOf).toBeUndefined();
  });

  it("tar med grenstegen när ett beslut dras", () => {
    const d = draft.steps.find((s) => s.type === "decision")!;
    const grenar = draft.steps.filter((s) => s.branchOf?.stepId === d.id).map((s) => s.id);
    const moved = moveStepTo(draft, d.id, 0);

    expect(moved.steps[0].id).toBe(d.id);
    // Grenstegen ligger direkt efter beslutet och hänger kvar under det.
    expect(moved.steps.slice(1, 1 + grenar.length).map((s) => s.id)).toEqual(grenar);
    expect(moved.steps[1].branchOf?.stepId).toBe(d.id);

    const model = compileDraft(moved);
    expect(model.edges.filter((e) => e.source === d.id).map((e) => e.label).sort()).toEqual([
      "Ja",
      "Nej",
    ]);
  });

  it("ignorerar släpp inuti det egna blocket", () => {
    const d = draft.steps.find((s) => s.type === "decision")!;
    const i = draft.steps.findIndex((s) => s.id === d.id);
    expect(moveStepTo(draft, d.id, i + 1)).toBe(draft);
    expect(moveStepTo(draft, d.id, i)).toBe(draft);
  });

  it("tappar inga steg oavsett var man släpper", () => {
    for (let i = 0; i <= draft.steps.length; i++) {
      const moved = moveStepTo(draft, draft.steps[1].id, i);
      expect(moved.steps).toHaveLength(draft.steps.length);
      expect(new Set(moved.steps.map((s) => s.id)).size).toBe(draft.steps.length);
    }
  });

  it("sparar manuell position på steget och för den vidare till noden", () => {
    const flyttat = setStepPosition(draft, "s2", { x: 240, y: 80 });
    expect(flyttat.steps.find((s) => s.id === "s2")!.position).toEqual({ x: 240, y: 80 });

    const nod = compileDraft(flyttat).nodes.find((n) => n.id === "s2")!;
    expect(nod.position).toEqual({ x: 240, y: 80 });
    // Övriga steg ligger kvar på auto-layout.
    expect(compileDraft(flyttat).nodes.find((n) => n.id === "s1")!.position).toBeNull();
  });

  it("nollar alla positioner med clearPositions", () => {
    const flyttat = setStepPosition(setStepPosition(draft, "s1", { x: 1, y: 2 }), "s2", {
      x: 3,
      y: 4,
    });
    const rensat = clearPositions(flyttat);
    expect(rensat.steps.every((s) => s.position === null)).toBe(true);
    expect(compileDraft(rensat).nodes.every((n) => n.position === null)).toBe(true);
  });

  it("sätter kopplingspunkter på rätt kant", () => {
    const med = setEdgeSides(draft, "s1", "s2", { sourceSide: "top", targetSide: "bottom" });
    const model = compileDraft(med);
    const kant = model.edges.find((e) => e.source === "s1" && e.target === "s2")!;
    expect(kant.sourceSide).toBe("top");
    expect(kant.targetSide).toBe("bottom");
    // Andra kanter påverkas inte.
    expect(model.edges.filter((e) => e.sourceSide !== undefined)).toHaveLength(1);
  });

  it("slår ihop sidor så att en ände kan ändras utan att nolla den andra", () => {
    const steg1 = setEdgeSides(draft, "s1", "s2", { sourceSide: "top" });
    const steg2 = setEdgeSides(steg1, "s1", "s2", { targetSide: "left" });
    const kant = compileDraft(steg2).edges.find((e) => e.source === "s1" && e.target === "s2")!;
    expect(kant.sourceSide).toBe("top");
    expect(kant.targetSide).toBe("left");
  });

  it("REGRESSION: ett SIDBYTE släpper brytpunkten – den hörde till den gamla vägen", () => {
    // Brytpunkten sattes för den gamla vägen. Behölls den när man flyttade en
    // kopplingspunkt tvingades vägen fortfarande genom den, och eftersom en
    // manuell brytpunkt stänger av väjningen skar linjen rakt genom målobjektet.
    // Det såg ut som att sidobytet inte gick att göra, fast valet sparades.
    const medBöj = setEdgeWaypoint(draft, "s1", "s2", { x: 200, y: 90 });
    expect(medBöj.edgeStyles?.[edgeKey("s1", "s2")]?.waypoint).toEqual({ x: 200, y: 90 });

    const bytt = setEdgeSides(medBöj, "s1", "s2", { targetSide: "right" });
    expect(bytt.edgeStyles?.[edgeKey("s1", "s2")]?.targetSide).toBe("right");
    expect(bytt.edgeStyles?.[edgeKey("s1", "s2")]?.waypoint).toBeUndefined();
  });

  it("andra brytpunkten kräver en första, och försvinner med den och vid sidbyte", () => {
    const utan = setEdgeWaypoint2(draft, "s1", "s2", { x: 40, y: 90 });
    expect(utan).toBe(draft);
    const en = setEdgeWaypoint(draft, "s1", "s2", { x: 200, y: 90 });
    const två = setEdgeWaypoint2(en, "s1", "s2", { x: 40, y: 90 });
    expect(två.edgeStyles?.[edgeKey("s1", "s2")]).toMatchObject({ waypoint: { x: 200, y: 90 }, waypoint2: { x: 40, y: 90 } });
    // Att flytta den första rör inte den andra.
    const flyttad = setEdgeWaypoint(två, "s1", "s2", { x: 220, y: 90 });
    expect(flyttad.edgeStyles?.[edgeKey("s1", "s2")]?.waypoint2).toEqual({ x: 40, y: 90 });
    expect(setEdgeWaypoint2(två, "s1", "s2", null).edgeStyles?.[edgeKey("s1", "s2")]?.waypoint2).toBeUndefined();
    expect(setEdgeWaypoint(två, "s1", "s2", null).edgeStyles?.[edgeKey("s1", "s2")]).toBeUndefined();
    const bytt = setEdgeSides(två, "s1", "s2", { targetSide: "right" });
    expect(bytt.edgeStyles?.[edgeKey("s1", "s2")]?.waypoint2).toBeUndefined();
  });

  it("men SAMMA sida igen, eller bara en punkt längs sidan, rör inte brytpunkten", () => {
    const medBöj = setEdgeSides(
      setEdgeWaypoint(draft, "s1", "s2", { x: 200, y: 90 }),
      "s1",
      "s2",
      { targetSide: "right" },
    );
    // Böjen är borta av sidbytet ovan – sätt en ny och rör INTE sidan.
    const igen = setEdgeWaypoint(medBöj, "s1", "s2", { x: 210, y: 95 });
    const sammaSida = setEdgeSides(igen, "s1", "s2", { targetSide: "right" });
    expect(sammaSida.edgeStyles?.[edgeKey("s1", "s2")]?.waypoint).toEqual({ x: 210, y: 95 });
    // Att flytta fästpunkten LÄNGS sidan är inget sidbyte.
    const längsSidan = setEdgeSides(igen, "s1", "s2", { targetPos: 0.3 });
    expect(längsSidan.edgeStyles?.[edgeKey("s1", "s2")]?.waypoint).toEqual({ x: 210, y: 95 });
    expect(längsSidan.edgeStyles?.[edgeKey("s1", "s2")]?.targetPos).toBe(0.3);
  });

  it("REGRESSION: en handritad pil blir inte en DUBBLETT av en märkt gren", () => {
    // Ritade man en egen pil längs en väg som redan hade en grenkant fick man två
    // pilar ovanpå varandra, varav bara den ena bar etikett. Det såg ut som att
    // "Nej" hade försvunnit – i själva verket låg en omärkt pil över den.
    const grenkant = compileDraft(draft).edges.find((e) => e.label);
    expect(grenkant, "flödet måste ha en märkt grenkant för det här testet").toBeTruthy();
    const dubbel = addManualEdge(draft, grenkant!.source, grenkant!.target);
    const kanter = compileDraft(dubbel).edges.filter(
      (e) => e.source === grenkant!.source && e.target === grenkant!.target,
    );
    expect(kanter).toHaveLength(1);
    expect(kanter[0].label).toBe(grenkant!.label); // etiketten är den som består
  });

  it("REGRESSION: en omärkt pil äger par-nyckeln – den märkta ärver den inte", () => {
    // Par-nyckeln utan etikett läses som RESERV för märkta kanter
    // (bakåtkompatibelt). Finns det en omärkt kant på SAMMA par är nyckeln dess
    // egen. Utan spärren flyttade ett drag i den omärkta pilen även den märkta,
    // och kopplingspunkten gick aldrig att lägga där man ville.
    const grenkant = compileDraft(draft).edges.find((e) => e.label)!;
    const { source, target } = grenkant;

    // Utan någon omärkt kant på paret gäller reserven som förr – gammal data
    // som sparades innan etiketten blev en del av nyckeln ska fortsätta fungera.
    const baraParNyckel = setEdgeSides(draft, source, target, { targetSide: "left" });
    expect(
      compileDraft(baraParNyckel).edges.find((e) => e.source === source && e.target === target)!
        .targetSide,
    ).toBe("left");

    // Med en handritad kant på samma par äger DEN nyckeln, och grenkanten
    // lämnas i fred. (Den handritade ritas inte som en andra pil – se testet
    // ovan – men posten finns kvar i mellanlagret och äger nyckeln.)
    const medOmärkt = addManualEdge(baraParNyckel, source, target);
    expect(
      compileDraft(medOmärkt).edges.find((e) => e.source === source && e.target === target)!
        .targetSide,
    ).toBeUndefined();
  });

  /**
   * ETIKETTEN PÅ EN KOPPLING är tre olika saker beroende på vilken sorts pil det är.
   * En gren äger sin etikett i STEGEN (branchOf.label) och i nycklarna för
   * kopplingspunkter och borttagna pilar; en handritad pil i sin egen post; en
   * härledd kedjepil har ingen egen plats och får den bland kantens
   * presentationsval. Alla tre måste gå att skriva – man ser bara en pil.
   */
  describe("setEdgeLabel", () => {
    const grenKant = () => compileDraft(draft).edges.find((e) => e.label)!;

    it("döper om en GREN – hela grenen följer med", () => {
      const g = grenKant();
      const bytt = setEdgeLabel(draft, g.source, g.target, g.label, "Kanske");
      expect(
        compileDraft(bytt).edges.find((e) => e.source === g.source && e.target === g.target)!.label,
      ).toBe("Kanske");
      // Varje steg i grenen bär den nya etiketten – annars delas grenen i två.
      const kvar = bytt.steps.filter((s) => s.branchOf?.stepId === g.source && s.branchOf.label === g.label);
      expect(kvar).toHaveLength(0);
    });

    it("REGRESSION: en omdöpt gren tar med sig sina sparade val", () => {
      // Kopplingspunkter och borttagna pilar nycklas med etiketten
      // (s4->s13#Nej). Utan migrering pekade de på ett namn som inte längre
      // fanns, och pilen hoppade tillbaka till automatiskt läge.
      const g = grenKant();
      const med = setEdgeSides(draft, g.source, g.target, { targetSide: "left" }, g.label);
      expect(Object.keys(med.edgeStyles ?? {})).toContain(edgeKey(g.source, g.target, g.label));

      const bytt = setEdgeLabel(med, g.source, g.target, g.label, "Kanske");
      expect(Object.keys(bytt.edgeStyles ?? {})).toContain(edgeKey(g.source, g.target, "Kanske"));
      expect(Object.keys(bytt.edgeStyles ?? {})).not.toContain(edgeKey(g.source, g.target, g.label));
      expect(
        compileDraft(bytt).edges.find((e) => e.source === g.source && e.target === g.target)!.targetSide,
      ).toBe("left");
    });

    it("vägrar en tom grenetikett och en krock med en syskongren", () => {
      const g = grenKant();
      const syskon = grenEtiketter(draft, g.source).find((l) => l !== g.label);
      expect(etikettHinder(draft, g.source, g.label, "  ")).toMatch(/måste ha ett svar/);
      if (syskon) expect(etikettHinder(draft, g.source, g.label, syskon)).toMatch(/redan en gren/);
      // …och draften lämnas orörd när man ändå försöker.
      expect(setEdgeLabel(draft, g.source, g.target, g.label, "  ")).toBe(draft);
    });

    /**
     * REGRESSION: regelns MOTSATTA väg (Nej när bara Ja har steg) gick inte att
     * döpa om. Etiketten härleddes ur grenen, och ändringen sparades på en
     * nyckel kompileringen aldrig läste – dubbelklick, skriv, ingenting hände
     * (2026-10-13, "Accepterar enhetschefen?" i mötesprocessen).
     */
    describe("REGRESSION: regelns motsatta väg", () => {
      const st = (id: string, type: DraftStep["type"], text: string, extra: Partial<DraftStep> = {}): DraftStep => ({
        id,
        type,
        text,
        laneId: "A",
        sourceIndex: -1,
        ...extra,
      });
      const MÖTE: ProcessDraft = {
        ...textToDraft("Möte\nx"),
        lanes: [makeLane("A", 0)],
        steps: [
          st("kalla", "activity", "Kalla chefer"),
          st("accept", "decision", "Accepterar chefen?", { gateway: "exclusive" }),
          st("komplettera", "activity", "Komplettera agenda", { branchOf: { stepId: "accept", label: "Ja" } }),
          st("forbered", "activity", "Förbered möte"),
        ],
      };
      const beslut = MÖTE.steps.find((s) => s.type === "decision")!;
      const nej = () => (d: ProcessDraft) =>
        compileDraft(d).edges.find((e) => e.source === beslut.id && e.target === "forbered")!;

      it("går att döpa om, och kopplingens sparade val följer med", () => {
        const n = nej()(MÖTE);
        expect(n.label).toBe("Nej");
        const med = setEdgeSides(MÖTE, n.source, n.target, { targetSide: "right" }, "Nej");
        const bytt = setEdgeLabel(med, n.source, n.target, "Nej", "Avslår");
        expect(bytt.steps.find((s) => s.id === beslut.id)?.motsattEtikett).toBe("Avslår");
        const efter = nej()(bytt);
        expect(efter.label).toBe("Avslår");
        expect(efter.targetSide).toBe("right");
        expect(Object.keys(bytt.edgeStyles ?? {})).not.toContain(edgeKey(n.source, n.target, "Nej"));
      });

      it("vägrar tomt namn och krock med den uttalade grenen", () => {
        expect(etikettHinder(MÖTE, beslut.id, "Nej", "")).toMatch(/måste ha ett svar/);
        expect(etikettHinder(MÖTE, beslut.id, "Nej", "Ja")).toMatch(/redan en gren/);
        // …och omvänt: Ja får inte döpas till den motsatta vägens namn.
        expect(etikettHinder(MÖTE, beslut.id, "Ja", "Nej")).toMatch(/redan en gren/);
      });

      it("byter den UTTALADE grenen namn står den motsatta kvar", () => {
        // Ja → Godkänd gjorde annars Nej till "Annars" – med nycklarna kvar på #Nej.
        const ja = compileDraft(MÖTE).edges.find((e) => e.source === beslut.id && e.label === "Ja")!;
        const bytt = setEdgeLabel(MÖTE, ja.source, ja.target, "Ja", "Godkänd");
        expect(nej()(bytt).label).toBe("Nej");
      });
    });

    it("en HANDRITAD pil bär etiketten i sin egen post, och tom text tar bort den", () => {
      // s1 är en STARTPUNKT och går inte att koppla TILL – därav s3→s2.
      const med = addManualEdge(draft, "s3", "s2");
      const märkt = setEdgeLabel(med, "s3", "s2", undefined, "Tillbaka");
      expect(märkt.extraEdges?.find((e) => e.source === "s3")?.label).toBe("Tillbaka");
      expect(compileDraft(märkt).edges.find((e) => e.source === "s3" && e.target === "s2")?.label).toBe("Tillbaka");
      const tömd = setEdgeLabel(märkt, "s3", "s2", "Tillbaka", "");
      expect(tömd.extraEdges?.find((e) => e.source === "s3")?.label).toBeUndefined();
    });

    it("en HÄRLEDD kedjepil får sin etikett bland kantens presentationsval", () => {
      // Varken gren eller handritad – utan det här fallet hände ingenting alls
      // när man skrev en etikett på en vanlig pil.
      const kedja = compileDraft(draft).edges.find((e) => !e.label)!;
      const med = setEdgeLabel(draft, kedja.source, kedja.target, undefined, "Startar");
      expect(med.edgeStyles?.[edgeKey(kedja.source, kedja.target)]?.label).toBe("Startar");
      expect(
        compileDraft(med).edges.find((e) => e.source === kedja.source && e.target === kedja.target)!.label,
      ).toBe("Startar");
      // Tom text tar bort posten helt när inget annat val finns kvar i den.
      const tömd = setEdgeLabel(med, kedja.source, kedja.target, "Startar", "");
      expect(tömd.edgeStyles?.[edgeKey(kedja.source, kedja.target)]).toBeUndefined();
    });
  });

  /**
   * BPMN: ett slut har inget utgående flöde, en start inget inkommande. Utan
   * spärren ritades pilen ändå, och kompileringen degraderade slutet till en
   * AKTIVITET för att modellen skulle gå ihop – man drog en koppling och fick
   * sitt "Klart" förvandlat, utan att något sade varför.
   */
  it("REGRESSION: en handritad koppling försvinner inte när man döper den till Ja", () => {
    // Tog man tidigare bort ett besluts grenpilar låg deras nycklar kvar
    // (s4->s5#Ja). Drog man sedan en EGEN koppling mellan samma par och skrev
    // "Ja" – det man naturligt sätter på en pil ut ur ett beslut – träffade
    // etiketten den gamla nyckeln, och både kopplingen och etiketten försvann i
    // samma ögonblick som man skrev den.
    const gren = compileDraft(draft).edges.find((e) => e.label)!;
    const utanGren = removeEdge(draft, gren.source, gren.target, gren.label);
    expect(utanGren.removedEdges).toContain(edgeKey(gren.source, gren.target, gren.label));

    const egen = addManualEdge(utanGren, gren.source, gren.target);
    const finns = (d: typeof draft) =>
      compileDraft(d).edges.some((e) => e.source === gren.source && e.target === gren.target);
    expect(finns(egen), "den egna kopplingen ska ritas").toBe(true);

    const märkt = setEdgeLabel(egen, gren.source, gren.target, undefined, gren.label!);
    expect(finns(märkt), "…och får inte försvinna av etiketten").toBe(true);
    expect(
      compileDraft(märkt).edges.find((e) => e.source === gren.source && e.target === gren.target)!.label,
    ).toBe(gren.label);
  });

  it("REGRESSION: en handritad koppling till ett DATALAGER visar sin etikett", () => {
    // Etiketten hamnade på kopplingens egen post, men associationen läste bara
    // kantens presentationsval – så den skrevs och syntes aldrig.
    const medLager: ProcessDraft = {
      ...draft,
      steps: [
        ...draft.steps,
        {
          id: "dl1",
          type: "datastore",
          text: 'Loggpost sparas i SP-listan "Kommentar"',
          laneId: "SharePoint",
          sourceIndex: -1,
        },
      ],
    };
    const lager = compileDraft(medLager).dataStores[0];
    expect(lager, "flödet måste ha ett datalager för det här testet").toBeTruthy();
    const med = addManualEdge(medLager, "s2", lager.id);
    const märkt = setEdgeLabel(med, "s2", lager.id, undefined, "Sparas");
    expect(märkt.extraEdges?.find((e) => e.target === lager.id)?.label).toBe("Sparas");
    const a = compileDraft(märkt).dataAssociations.find(
      (x) => x.nodeId === "s2" && x.dataStoreId === lager.id,
    );
    expect(a, "associationen ska finnas").toBeTruthy();
    expect(a!.label).toBe("Sparas");
  });

  describe("kopplingHinder", () => {
    const slut = () => compileDraft(draft).nodes.find((n) => n.type === "end")!;
    const start = () => compileDraft(draft).nodes.find((n) => n.type === "start")!;

    it("går inte att koppla FRÅN ett slut", () => {
      const e = slut();
      // Bara egna steg går att spärra – ett auto-slut finns inte i steglistan.
      if (!draft.steps.some((s) => s.id === e.id)) return;
      expect(kopplingHinder(draft, e.id, "s2")).toMatch(/slut/);
      expect(addManualEdge(draft, e.id, "s2")).toBe(draft);
    });

    it("går inte att koppla TILL en startpunkt", () => {
      const s = start();
      expect(kopplingHinder(draft, "s3", s.id)).toMatch(/startpunkt/);
      expect(addManualEdge(draft, "s3", s.id)).toBe(draft);
    });

    it("REGRESSION: slutet behåller sin typ när man kopplar TILL det", () => {
      // Att koppla in i ett slut är helt giltigt – det är bara utgående flöde
      // som inte finns. Spärren får inte träffa fel håll.
      const e = slut();
      if (!draft.steps.some((s) => s.id === e.id)) return;
      const med = addManualEdge(draft, "s3", e.id);
      expect(med).not.toBe(draft);
      expect(compileDraft(med).nodes.find((n) => n.id === e.id)!.type).toBe("end");
    });

    it("två vanliga objekt går att koppla ihop", () => {
      expect(kopplingHinder(draft, "s2", "s4")).toBeNull();
    });
  });

  /**
   * FRITT OBJEKT – placerat ur verktygsradens palett.
   *
   * Flödesschemat kedjar steg efter ORDNING, så ett nytt steg hamnar annars
   * automatiskt i kedjan och ritar om flödet. Samma krav som i affärsprocessen: ett placerat
   * objekt ligger fritt tills man drar en koppling – annars ser det ut som att
   * objekt försvinner.
   */
  describe("läggTillFritt / knytIn", () => {
    it("ett placerat objekt ritas men ändrar INTE flödet", () => {
      const före = compileDraft(draft);
      const { draft: med, id } = läggTillFritt(draft, {
        type: "activity",
        text: "Nytt",
        laneId: "Portalen",
      });
      const efter = compileDraft(med);
      expect(med.fria).toEqual([id]);
      // Objektet finns…
      expect(efter.nodes.some((n) => n.id === id)).toBe(true);
      // …men ingen enda koppling har ändrats.
      expect(efter.edges.map((e) => `${e.source}->${e.target}`)).toEqual(
        före.edges.map((e) => `${e.source}->${e.target}`),
      );
    });

    it("ett fritt objekt får inget auto-slut", () => {
      // Det är terminalt (ingen utgång), men ett "Klart" på ett objekt man just
      // lagt ut är brus – det hör inte till flödet förrän man knutit in det.
      const { draft: med, id } = läggTillFritt(draft, {
        type: "activity",
        text: "Nytt",
        laneId: "Portalen",
      });
      expect(compileDraft(med).nodes.some((n) => n.id === `end_${id}`)).toBe(false);
    });

    it("en koppling knyter in objektet – och ger BARA den pil man ritade", () => {
      const { draft: med, id } = läggTillFritt(draft, {
        type: "activity",
        text: "Nytt",
        laneId: "Portalen",
      });
      const inknutet = addManualEdge(med, "s1", id);
      expect(inknutet.fria).toBeUndefined();
      const kanterIn = compileDraft(inknutet)
        .edges.filter((e) => e.target === id)
        .map((e) => e.source);
      // Objektet ligger sist i ordningen och skulle annars OCKSÅ få kedjepilen
      // från steget före – två pilar in, varav en man inte bett om.
      expect(kanterIn).toEqual(["s1"]);
    });

    it("REGRESSION: auto-slutets pil går att sätta etikett på", () => {
      // Den pilen skapas i normalizeFlowEvents, inte via addEdge, och läste
      // därför aldrig kantens presentationsval. Man skrev en etikett och
      // ingenting hände.
      const slut = compileDraft(draft).edges.find((e) => e.target.startsWith("end_"));
      expect(slut, "flödet måste ha ett auto-slut för det här testet").toBeTruthy();
      const med = setEdgeLabel(draft, slut!.source, slut!.target, undefined, "Avslutas");
      expect(
        compileDraft(med).edges.find((e) => e.target === slut!.target)!.label,
      ).toBe("Avslutas");
    });

    it("ritar man just kedjepilen behålls den", () => {
      const { draft: med, id } = läggTillFritt(draft, {
        type: "activity",
        text: "Nytt",
        laneId: "Portalen",
      });
      const sista = draft.steps[draft.steps.length - 1].id;
      const inknutet = addManualEdge(med, sista, id);
      expect(compileDraft(inknutet).edges.filter((e) => e.target === id).map((e) => e.source)).toEqual([sista]);
    });
  });

  it("tar bort överstyrningen helt när båda sidorna nollas", () => {
    const med = setEdgeSides(draft, "s1", "s2", { sourceSide: "top" });
    const utan = resetEdgeSides(med, "s1", "s2");
    expect(utan.edgeStyles?.[edgeKey("s1", "s2")]).toBeUndefined();
    const kant = compileDraft(utan).edges.find((e) => e.source === "s1" && e.target === "s2")!;
    expect(kant.sourceSide).toBeUndefined();
  });

  it("REGRESSION: två pilar mellan samma nodpar kan tas bort och styras var för sig", () => {
    // En gren som bara innehåller ett datalager hoppar tillbaka till beslutet:
    // både "Ja" och "Nej" landar då i nästa steg – två pilar, samma nodpar.
    const d: ProcessDraft = {
      ...emptyDraft(),
      steps: [
        { id: "s1", type: "start", text: "Start", laneId: "Användare", sourceIndex: 0 },
        { id: "s2", type: "decision", text: "Ok?", laneId: "Användare", sourceIndex: 1 },
        {
          id: "s3",
          type: "datastore",
          text: "Logg",
          laneId: "SharePoint",
          sourceIndex: 2,
          branchOf: { stepId: "s2", label: "Ja" },
        },
        { id: "s4", type: "activity", text: "Vidare", laneId: "Användare", sourceIndex: 3 },
      ],
    };
    const m0 = compileDraft(d);
    const par = m0.edges.filter((e) => e.source === "s2" && e.target === "s4");
    expect(par.map((e) => e.label).sort()).toEqual(["Ja", "Nej"]);

    // Ta bort BARA Ja-pilen – Nej ska vara kvar.
    const utanJa = compileDraft(removeEdge(d, "s2", "s4", "Ja"));
    const kvar = utanJa.edges.filter((e) => e.source === "s2" && e.target === "s4");
    expect(kvar.map((e) => e.label)).toEqual(["Nej"]);

    // En brytpunkt på Nej-pilen får inte smitta Ja-pilen.
    const medWp = compileDraft(setEdgeWaypoint(d, "s2", "s4", { x: 10, y: 20 }, "Nej"));
    const [ja, nej] = ["Ja", "Nej"].map((l) =>
      medWp.edges.find((e) => e.source === "s2" && e.target === "s4" && e.label === l)!,
    );
    expect(nej.waypoint).toEqual({ x: 10, y: 20 });
    expect(ja.waypoint).toBeUndefined();

    // Bakåtkompatibelt: en gammal borttagning utan etikett träffar båda.
    const utanBåda = compileDraft(removeEdge(d, "s2", "s4"));
    expect(utanBåda.edges.some((e) => e.source === "s2" && e.target === "s4")).toBe(false);
  });

  it("REGRESSION: kopplingspunkter går att styra på dataassociationer", () => {
    // Sidovalen togs emot men applicerades aldrig på streckade kopplingar –
    // 'Loggpost skapas' satt fast i botten→topp hur man än valde.
    const d = textToDraft(`Test
Fel uppkommer → Power Automate flödet triggas → Loggpost skapas → Mejl skickas till handläggaren`);
    const m0 = compileDraft(d);
    const skriv = m0.dataAssociations.find((a) => a.direction === "write")!;
    expect(skriv).toBeDefined();

    // Källsidan (varifrån kopplingen går) väljs om till höger.
    const med = setEdgeSides(d, skriv.nodeId, skriv.dataStoreId, { sourceSide: "right" });
    const efter = compileDraft(med).dataAssociations.find((a) => a.direction === "write")!;
    expect(efter.sourceSide).toBe("right");
    expect(efter.targetSide).toBeUndefined();

    // Läsriktningen nycklas lager→nod.
    const läs = m0.dataAssociations.find((a) => a.direction === "read");
    if (läs) {
      const med2 = setEdgeSides(d, läs.dataStoreId, läs.nodeId, { sourceSide: "left", targetSide: "bottom" });
      const efter2 = compileDraft(med2).dataAssociations.find((a) => a.direction === "read")!;
      expect(efter2.sourceSide).toBe("left");
      expect(efter2.targetSide).toBe("bottom");
    }
  });

  it("REGRESSION: utgångssidan går att styra på meddelandeflöden", () => {
    // Mottagaren får inte vara en bana i processen (då blir det sekvensflöde i
    // stället) – kommunikatörerna deltar inte och ger en äkta mottagarpool.
    const d = textToDraft(`Test
Fel uppkommer → Mejl skickas till kommunikatörerna → Klart nu`);
    const m0 = compileDraft(d);
    const mf = m0.messageFlows[0];
    expect(mf).toBeDefined();
    const med = setEdgeSides(d, mf.nodeId, mf.poolId, { sourceSide: "left" });
    expect(compileDraft(med).messageFlows[0].sourceSide).toBe("left");
  });

  it("textstorlek och textplacering per steg följer med till modellen", () => {
    const med = setTextStyle(draft, "s2", { textSize: 0.7, textPlacement: "top" });
    const nod = compileDraft(med).nodes.find((n) => n.id === "s2")!;
    expect(nod.textSize).toBe(0.7);
    expect(nod.textPlacement).toBe("top");
    // Nollas med undefined.
    const utan = setTextStyle(med, "s2", { textSize: undefined, textPlacement: undefined });
    const nod2 = compileDraft(utan).nodes.find((n) => n.id === "s2")!;
    expect(nod2.textSize).toBeUndefined();
    expect(nod2.textPlacement).toBeUndefined();
  });

  it("en sidpinne följer med till modellen och nollas av återställ layout", () => {
    const med = setPagePin(draft, "s3", 2);
    expect(compileDraft(med).nodes.find((n) => n.id === "s3")!.pagePin).toBe(2);
    // Pinnen nollar stegets gamla läge (förra delens koordinatram).
    const medPos = setPagePin(setStepPosition(draft, "s3", { x: 5, y: 5 }), "s3", 1);
    expect(medPos.steps.find((s) => s.id === "s3")!.position).toBeNull();
    // Återställ layout släpper alla pinnar.
    expect(compileDraft(clearPositions(med)).nodes.find((n) => n.id === "s3")!.pagePin).toBeUndefined();
  });

  it("sparar och nollar en manuell brytpunkt på en koppling", () => {
    const med = setEdgeWaypoint(draft, "s1", "s2", { x: 140, y: 90 });
    const kant = compileDraft(med).edges.find((e) => e.source === "s1" && e.target === "s2")!;
    expect(kant.waypoint).toEqual({ x: 140, y: 90 });
    // null tar bort den och städar bort tomma edge-stilen.
    const utan = setEdgeWaypoint(med, "s1", "s2", null);
    expect(utan.edgeStyles?.[edgeKey("s1", "s2")]).toBeUndefined();
  });

  it("sparar etikettens läge längs kopplingen som ANDEL, och nollar den", () => {
    const med = setEdgeLabelPos(draft, "s1", "s2", 0.3);
    expect(compileDraft(med).edges.find((e) => e.source === "s1" && e.target === "s2")!.labelPos).toBe(0.3);
    // Andelen klipps till 0–1 – en dragning utanför vägens ändar får inte
    // spara ett läge som `pointAlongPath` inte kan hitta.
    expect(setEdgeLabelPos(draft, "s1", "s2", 1.8).edgeStyles?.[edgeKey("s1", "s2")]?.labelPos).toBe(1);
    // null återställer till automatiskt läge och städar bort den tomma stilen.
    expect(setEdgeLabelPos(med, "s1", "s2", null).edgeStyles?.[edgeKey("s1", "s2")]).toBeUndefined();
    // …men bara etiketten: en brytpunkt på samma kant ska vara kvar.
    const båda = setEdgeLabelPos(setEdgeWaypoint(draft, "s1", "s2", { x: 50, y: 60 }), "s1", "s2", 0.8);
    expect(setEdgeLabelPos(båda, "s1", "s2", null).edgeStyles?.[edgeKey("s1", "s2")]).toEqual({
      waypoint: { x: 50, y: 60 },
    });
  });

  it("brytpunkt och kopplingspunkt lever sida vid sida – att nolla den ena behåller den andra", () => {
    const both = setEdgeWaypoint(setEdgeSides(draft, "s1", "s2", { sourceSide: "top" }), "s1", "s2", {
      x: 50,
      y: 60,
    });
    expect(both.edgeStyles?.[edgeKey("s1", "s2")]).toEqual({ sourceSide: "top", waypoint: { x: 50, y: 60 } });
    // Nolla brytpunkten: kopplingspunkten ska vara kvar.
    const bara = setEdgeWaypoint(both, "s1", "s2", null);
    expect(bara.edgeStyles?.[edgeKey("s1", "s2")]).toEqual({ sourceSide: "top" });
  });

  it("behåller positioner och kopplingspunkter genom en spara-runda", () => {
    const med = setEdgeSides(setStepPosition(draft, "s3", { x: 10, y: 20 }), "s1", "s2", {
      sourceSide: "bottom",
    });
    const kopia: ProcessDraft = JSON.parse(JSON.stringify(med));
    const model = compileDraft(kopia);
    expect(model.nodes.find((n) => n.id === "s3")!.position).toEqual({ x: 10, y: 20 });
    expect(model.edges.find((e) => e.source === "s1")!.sourceSide).toBe("bottom");
  });

  it("tar bort en koppling ur diagrammet", () => {
    const före = compileDraft(draft).edges.length;
    const utan = removeEdge(draft, "s1", "s2");

    const model = compileDraft(utan);
    expect(model.edges.some((e) => e.source === "s1" && e.target === "s2")).toBe(false);
    expect(model.edges).toHaveLength(före - 1);
    // Ingen ny "Klart"-nod trollas fram bara för att flödet klipptes.
    expect(model.nodes.filter((n) => n.label === "Klart")).toHaveLength(
      compileDraft(draft).nodes.filter((n) => n.label === "Klart").length,
    );
    // Noderna finns kvar – bara kopplingen är borta.
    expect(model.nodes.some((n) => n.id === "s1")).toBe(true);
    expect(model.nodes.some((n) => n.id === "s2")).toBe(true);
    expect(isEdgeRemoved(utan, "s1", "s2")).toBe(true);
  });

  it("tar tillbaka en borttagen koppling", () => {
    const utan = removeEdge(draft, "s1", "s2");
    const åter = restoreEdge(utan, "s1", "s2");
    expect(isEdgeRemoved(åter, "s1", "s2")).toBe(false);
    expect(compileDraft(åter).edges).toEqual(compileDraft(draft).edges);
  });

  it("tar inte bort samma koppling två gånger", () => {
    const en = removeEdge(draft, "s1", "s2");
    expect(removeEdge(en, "s1", "s2")).toBe(en);
    expect(en.removedEdges).toHaveLength(1);
  });

  it("borttagning påverkar bara den valda kopplingen", () => {
    const model = compileDraft(removeEdge(draft, "s1", "s2"));
    const kvar = compileDraft(draft).edges.filter(
      (e) => !(e.source === "s1" && e.target === "s2"),
    );
    expect(model.edges.map((e) => `${e.source}->${e.target}`)).toEqual(
      kvar.map((e) => `${e.source}->${e.target}`),
    );
  });

  it("borttagningen överlever en spara-runda", () => {
    const utan = removeEdge(draft, "s1", "s2");
    const kopia: ProcessDraft = JSON.parse(JSON.stringify(utan));
    expect(compileDraft(kopia).edges.some((e) => e.source === "s1" && e.target === "s2")).toBe(
      false,
    );
  });

  it("lägger till ett nytt steg efter ett givet steg", () => {
    const first = draft.steps[0];
    const added = addStepAfter(draft, first.id, {
      type: "activity",
      text: "Nytt steg",
      laneId: "Användare",
    });
    expect(added.steps[1].text).toBe("Nytt steg");
    const model = compileDraft(added);
    expect(model.edges.some((e) => e.source === first.id && e.target === added.steps[1].id)).toBe(
      true,
    );
  });
});

describe("syncStepTypes – listan säger inte emot diagrammet", () => {
  it("degraderar ett 'slut' som har ett nästa steg", () => {
    // Ett slut mitt i flödet är strukturellt omöjligt – det ritas som en
    // aktivitet och ska då också visas så i steglistan.
    const d = textToDraft(`Test
Fel uppkommer → Fyller i formulär → Mejl skickas till handläggaren`);
    const mitten = d.steps[1];
    const med = syncStepTypes(updateStep(d, mitten.id, { type: "end" }));
    expect(med.steps.find((s) => s.id === mitten.id)!.type).toBe("activity");
  });

  it("behåller ett slut som faktiskt avslutar flödet", () => {
    const d = textToDraft(`Test
Fel uppkommer → Fyller i formulär`);
    const sista = d.steps[d.steps.length - 1];
    const med = syncStepTypes(updateStep(d, sista.id, { type: "end" }));
    expect(med.steps.find((s) => s.id === sista.id)!.type).toBe("end");
  });

  it("varje stegs typ matchar nodens typ i modellen", () => {
    const d = textToDraft(TEXT);
    const byId = new Map(compileDraft(d).nodes.map((n) => [n.id, n.type]));
    for (const s of d.steps) expect(s.type).toBe(byId.get(s.id));
  });
});

describe("simbanor", () => {
  const draft = textToDraft(TEXT);

  it("listar alla banor i visningsordning, även autoskapade", () => {
    const banor = allLanes(draft);
    // Alla banor som stegen pekar på finns med.
    for (const s of draft.steps) {
      expect(banor.some((l) => l.id === s.laneId)).toBe(true);
    }
    // Ordningen är sammanhängande 0..n.
    expect(banor.map((l) => l.order)).toEqual(banor.map((_, i) => i));
  });

  it("flyttar en bana och slår igenom i diagrammet", () => {
    const banor = allLanes(draft);
    const andra = banor[1].id;
    const flyttad = moveLane(draft, andra, -1);

    expect(allLanes(flyttad)[0].id).toBe(andra);
    expect(compileDraft(flyttad).swimlanes[0].id).toBe(andra);
  });

  it("flyttar inte förbi kanterna", () => {
    const banor = allLanes(draft);
    expect(moveLane(draft, banor[0].id, -1)).toBe(draft);
    expect(moveLane(draft, banor[banor.length - 1].id, 1)).toBe(draft);
  });

  it("byter namn på en bana och tar med stegen", () => {
    const bana = allLanes(draft)[0].id;
    const antal = draft.steps.filter((s) => s.laneId === bana).length;
    const döpt = renameLane(draft, bana, "Ny bana");

    expect(döpt.steps.filter((s) => s.laneId === "Ny bana")).toHaveLength(antal);
    expect(döpt.steps.some((s) => s.laneId === bana)).toBe(false);
    expect(compileDraft(döpt).swimlanes.some((l) => l.id === "Ny bana")).toBe(true);
  });

  it("behåller ordningen genom en spara-runda", () => {
    const banor = allLanes(draft);
    const flyttad = moveLane(draft, banor[banor.length - 1].id, -1);
    const kopia: ProcessDraft = JSON.parse(JSON.stringify(flyttad));
    expect(compileDraft(kopia).swimlanes.map((l) => l.id)).toEqual(
      compileDraft(flyttad).swimlanes.map((l) => l.id),
    );
  });
});

describe("automatiska slut-event", () => {
  const draft = textToDraft(TEXT);

  it("går att göra redigerbara och flytta till en annan bana", () => {
    const model = compileDraft(draft);
    const auto = model.nodes.find((n) => n.type === "end" && n.sourceIndex < 0)!;
    const efter = model.edges.find((e) => e.target === auto.id)!.source;

    const med = materializeEnd(draft, efter);
    const slutSteg = med.steps.find((s) => s.type === "end")!;
    expect(slutSteg.text).toBe("Klart");

    // Nu går det att byta bana på det – vilket var hela poängen.
    const flyttat = updateStep(med, slutSteg.id, { laneId: "Avslutat" });
    const nyModell = compileDraft(flyttat);
    expect(nyModell.nodes.find((n) => n.id === slutSteg.id)!.laneId).toBe("Avslutat");
    expect(nyModell.swimlanes.some((l) => l.id === "Avslutat")).toBe(true);
  });

  it("går att döpa om direkt på canvasen utan att materialisera", () => {
    const auto = compileDraft(draft).nodes.find((n) => n.type === "end" && n.sourceIndex < 0)!;
    const döpt = setAutoLabel(draft, auto.id, "Ärendet avslutat");
    expect(compileDraft(döpt).nodes.find((n) => n.id === auto.id)!.label).toBe("Ärendet avslutat");
    // Tomt namn återgår till "Klart".
    expect(compileDraft(setAutoLabel(döpt, auto.id, "  ")).nodes.find((n) => n.id === auto.id)!.label).toBe(
      "Klart",
    );
  });

  it("går att flytta direkt på canvasen – läget överlever en omkompilering", () => {
    const auto = compileDraft(draft).nodes.find((n) => n.type === "end" && n.sourceIndex < 0)!;
    const flyttat = setAutoPosition(draft, auto.id, { x: 640, y: 480 });
    expect(compileDraft(flyttat).nodes.find((n) => n.id === auto.id)!.position).toEqual({ x: 640, y: 480 });
  });

  it("går att flytta till en annan simbana – och släpper då sitt gamla läge", () => {
    const auto = compileDraft(draft).nodes.find((n) => n.type === "end" && n.sourceIndex < 0)!;
    const flyttat = setAutoLane(setAutoPosition(draft, auto.id, { x: 640, y: 480 }), auto.id, "SharePoint");
    const nod = compileDraft(flyttat).nodes.find((n) => n.id === auto.id)!;
    expect(nod.laneId).toBe("SharePoint");
    // Läget från förra banan hänger inte kvar och drar upp den.
    expect(nod.position).toBeNull();
  });

  it("tar bort pilen till ett auto-slut utan att trolla fram en ny", () => {
    const model = compileDraft(draft);
    const auto = model.nodes.find((n) => n.type === "end" && n.sourceIndex < 0)!;
    const efter = model.edges.find((e) => e.target === auto.id)!.source;

    const utan = compileDraft(removeEdge(draft, efter, auto.id));
    // Pilen är borta och ingen ny återskapas – men slut-noden ligger kvar där
    // den var i stället för att se ut att ha försvunnit.
    expect(utan.edges.some((e) => e.target === auto.id)).toBe(false);
    expect(utan.nodes.some((n) => n.id === auto.id)).toBe(true);
  });

  it("REGRESSION: omdöpt auto-slut fastnar aldrig på fel nod när flödet redigeras", () => {
    // Räknar-baserade id:n (auto1, auto2 …) förskjöts när terminalen byttes –
    // namnet hoppade då tyst över till ett HELT ANNAT slut-event. Härledda id:n
    // (end_<nodId>) kan inte förskjutas: namnet hör till sin föregångare.
    const m0 = compileDraft(draft);
    const auto = m0.nodes.find((n) => n.type === "end" && n.sourceIndex < 0)!;
    const föregångare = m0.edges.find((e) => e.target === auto.id)!.source;
    expect(auto.id).toBe(`end_${föregångare}`);

    const döpt = setAutoLabel(draft, auto.id, "Ärendet klart");

    // Ett nytt steg sist i flödet gör DET till terminal i stället. Det nya
    // slutet ska INTE ärva namnet (gamla schemat gav det samma id → namnet
    // hoppade med). Namnet ligger kvar nycklat på den gamla föregångaren.
    const redigerad = addStepAfter(döpt, null, {
      type: "activity",
      text: "Nytt sista steg",
      laneId: "Användare",
    });
    const m1 = compileDraft(redigerad);
    const nyaSlut = m1.nodes.filter((n) => n.type === "end" && n.sourceIndex < 0);
    expect(nyaSlut.length).toBeGreaterThan(0);
    expect(nyaSlut.every((n) => n.label === "Klart")).toBe(true);

    // Tas det nya steget bort igen blir den gamla noden terminal – och namnet
    // KOMMER TILLBAKA, eftersom id:t är detsamma som när det döptes.
    const nytt = redigerad.steps.find((s) => s.text === "Nytt sista steg")!;
    const återställd = compileDraft(removeStep(redigerad, nytt.id));
    expect(återställd.nodes.find((n) => n.id === `end_${föregångare}`)!.label).toBe("Ärendet klart");
  });

  it("skapar inget extra auto-slut när ett riktigt slutsteg finns", () => {
    // Auto-noder = de som inte finns som steg i draften. sourceIndex duger
    // inte som kännetecken; manuellt tillagda steg har också −1.
    const autoNoder = (d: ProcessDraft) => {
      const m = compileDraft(d);
      const ids = new Set(d.steps.map((s) => s.id));
      return m.nodes.filter((n) => n.type === "end" && !ids.has(n.id));
    };

    const model = compileDraft(draft);
    const auto = autoNoder(draft);
    const efter = model.edges.find((e) => e.target === auto[0].id)!.source;

    const medDraft = materializeEnd(draft, efter);
    // Ett auto-slut färre, ett riktigt slutsteg mer – inte båda.
    expect(compileDraft(medDraft).nodes.filter((n) => n.type === "end")).toHaveLength(
      model.nodes.filter((n) => n.type === "end").length,
    );
    expect(autoNoder(medDraft)).toHaveLength(auto.length - 1);
  });
});

describe("BPMN-korrekthet i kompileringen", () => {
  // Eget flöde: behöver både datalager och notifieringar.
  const BPMN_TEXT = `Driftfråga
Fel uppkommer → Fyller i formulär → Driftfråga inkommer i SP-listan "Inkorgen" → Power Automate flödet triggas → Mejlbekräftelse skickas till användaren → Mejl skickas till handläggaren → Loggpost skapas`;
  const draft = textToDraft(BPMN_TEXT);
  const model = compileDraft(draft);

  it("datalager ligger som artefakter, aldrig i sekvensflödet", () => {
    expect(model.dataStores.length).toBeGreaterThan(0);
    const artefaktIds = new Set(model.dataStores.map((d) => d.id));
    for (const e of model.edges) {
      expect(artefaktIds.has(e.source), `kant från datalager: ${e.source}`).toBe(false);
      expect(artefaktIds.has(e.target), `kant till datalager: ${e.target}`).toBe(false);
    }
    // Och de finns inte heller bland noderna.
    expect(model.nodes.some((n) => artefaktIds.has(n.id))).toBe(false);
  });

  it("varje datalager har minst en dataassociation", () => {
    for (const ds of model.dataStores) {
      expect(
        model.dataAssociations.some((a) => a.dataStoreId === ds.id),
        `datalagret "${ds.label}" saknar association`,
      ).toBe(true);
    }
  });

  it("flödet går förbi datalagret utan att brytas", () => {
    // Steget före och efter ett datalager ska vara direkt kopplade.
    const ordnad = normalizeOrder(draft);
    const i = ordnad.steps.findIndex((s) => s.type === "datastore");
    const före = ordnad.steps[i - 1];
    const efter = ordnad.steps[i + 1];
    if (före && efter) {
      expect(model.edges.some((e) => e.source === före.id && e.target === efter.id)).toBe(true);
    }
  });

  it("inga sekvensflöden är markerade som meddelandeflöden", () => {
    // Den gamla regeln streckade kanter till/från notifieringar inom samma
    // pool, vilket är ett formellt BPMN-fel.
    expect(model.edges.every((e) => e.kind !== "message")).toBe(true);
  });

  it("meddelanden går ut till en svart-låda-pool", () => {
    expect(model.messageFlows.length).toBeGreaterThan(0);
    for (const f of model.messageFlows) {
      const pool = model.pools.find((p) => p.id === f.poolId);
      expect(pool, "meddelandeflöde pekar på okänd pool").toBeDefined();
      expect(pool!.blackBox).toBe(true);
      // Avsändaren är en riktig nod i processens pool.
      expect(model.nodes.some((n) => n.id === f.nodeId)).toBe(true);
    }
  });

  it("alla lanes hör till processens egen pool", () => {
    const huvud = model.pools.find((p) => !p.blackBox)!;
    expect(huvud).toBeDefined();
    for (const l of model.swimlanes) expect(l.poolId).toBe(huvud.id);
  });

  it("mottagaren kan ändras i mellanlagret", () => {
    const notis = draft.steps.find((s) => s.type === "notification")!;
    const ändrad = compileDraft(updateStep(draft, notis.id, { recipient: "Extern part" }));
    expect(ändrad.pools.some((p) => p.blackBox && p.title === "Extern part")).toBe(true);
  });

  it("tom mottagare ger inget meddelandeflöde", () => {
    let d = draft;
    for (const s of draft.steps.filter((s) => s.type === "notification")) {
      d = updateStep(d, s.id, { recipient: undefined });
    }
    expect(compileDraft(d).messageFlows).toHaveLength(0);
    expect(compileDraft(d).pools.filter((p) => p.blackBox)).toHaveLength(0);
  });
});

describe("dataassociationer pekar på verkliga utförare", () => {
  const bygg = (text: string) => compileDraft(textToDraft(`Test\n${text}`));
  const skrivare = (m: ReturnType<typeof bygg>, lager: string) => {
    const ds = m.dataStores.find((d) => d.label.includes(lager))!;
    const a = m.dataAssociations.find((x) => x.dataStoreId === ds.id && x.direction === "write");
    return m.nodes.find((n) => n.id === a?.nodeId);
  };

  it("ett mejl skapar ingen loggpost", () => {
    // Regressionen: pilen till loggposten kom från mejlutskicket,
    // bara för att mejlet stod närmast före i texten.
    const m = bygg(
      "Power Automate flödet triggas → Mejl skickas till handläggaren → Loggpost skapas",
    );
    const w = skrivare(m, "Loggpost");
    expect(w?.type).not.toBe("notification");
    expect(w?.label).toMatch(/Power Automate/);
  });

  it("en gateway skriver inte till ett datalager", () => {
    const m = bygg(
      "Power Automate flödet triggas (↓ Om hög prioritet → Teamschatt skapas) → Loggpost skapas",
    );
    expect(skrivare(m, "Loggpost")?.type).not.toBe("decision");
  });

  it("läsningen får passera en gateway", () => {
    const m = bygg(
      "Fyller i formulär → Driftfråga inkommer i SP-listan Inkorgen (↓ Om hög prioritet → Teamschatt skapas) → Power Automate flödet triggas",
    );
    const ds = m.dataStores[0];
    const läs = m.dataAssociations.filter((a) => a.dataStoreId === ds.id && a.direction === "read");
    expect(läs.length).toBeGreaterThan(0);
    expect(m.nodes.find((n) => n.id === läs[0].nodeId)?.type).toBe("system");
  });

  it("läsningen bryts av ett mejl – inget långt bort läser lagret", () => {
    const m = bygg(
      "Power Automate flödet triggas → Loggpost skapas → Mejl skickas till användaren → Fyller i formulär",
    );
    const ds = m.dataStores[0];
    expect(m.dataAssociations.filter((a) => a.dataStoreId === ds.id && a.direction === "read")).toHaveLength(
      0,
    );
  });

  it("varje association pekar på en nod som finns i modellen", () => {
    const m = bygg(
      "Fyller i formulär → Driftfråga inkommer i SP-listan Inkorgen → Power Automate flödet triggas → Mejl skickas till handläggaren → Loggpost skapas",
    );
    expect(m.dataAssociations.length).toBeGreaterThan(0);
    for (const a of m.dataAssociations) {
      expect(m.nodes.some((n) => n.id === a.nodeId), `saknar nod ${a.nodeId}`).toBe(true);
      expect(m.dataStores.some((d) => d.id === a.dataStoreId)).toBe(true);
    }
  });
});

describe("mottagare som redan är en bana i processen", () => {
  // "Fel uppkommer" ger en Användare-bana – utan den finns ingen krock att testa.
  const draft = textToDraft(`Test
Fel uppkommer → Fyller i formulär → Power Automate flödet triggas → Mejlbekräftelse skickas till användaren`);

  it("ger ingen svart låda med samma namn som en bana", () => {
    const m = compileDraft(draft);
    const banor = new Set(m.swimlanes.map((l) => l.id));
    for (const p of m.pools.filter((p) => p.blackBox)) {
      expect(banor.has(p.title), `"${p.title}" finns både som bana och svart låda`).toBe(false);
    }
  });

  it("ritar det som intern kommunikation och säger varför", () => {
    // "Användare" är en bana här, så mejlet korsar ingen poolgräns och är
    // därmed inget meddelandeflöde.
    const m = compileDraft(draft);
    expect(m.messageFlows).toHaveLength(0);
    expect(m.meta.warnings.some((w) => /deltar i processen/.test(w))).toBe(true);
  });

  it("behåller meddelandeflödet när mottagaren är utanför processen", () => {
    const utanför = textToDraft(`Test
Fel uppkommer → Fyller i formulär → Power Automate flödet triggas → Mejl skickas till handläggaren`);
    const m = compileDraft(utanför);
    expect(m.swimlanes.some((l) => l.id === "Handläggare")).toBe(false);
    expect(m.messageFlows).toHaveLength(1);
    expect(m.pools.find((p) => p.id === m.messageFlows[0].poolId)?.title).toBe("Handläggare");
  });
});

describe("strikt BPMN – meddelandeflöde bara mellan pooler", () => {
  const TEXT_MSG = `Test
Fel uppkommer → Får via mejl bekräftelse på att ärendet inkommit → Power Automate flödet triggas → Mejlbekräftelse skickas till användaren → Mejl skickas till handläggaren`;
  const draft = textToDraft(TEXT_MSG);
  const model = compileDraft(draft);

  it("varje meddelandeflöde går till en svart-låda-pool", () => {
    expect(model.messageFlows.length).toBeGreaterThan(0);
    for (const f of model.messageFlows) {
      const pool = model.pools.find((p) => p.id === f.poolId);
      expect(pool?.blackBox, "meddelandeflöde måste korsa en poolgräns").toBe(true);
    }
  });

  it("inget meddelandeflöde går till en deltagare som är en bana", () => {
    const banor = new Set(model.swimlanes.map((l) => l.id));
    for (const f of model.messageFlows) {
      const pool = model.pools.find((p) => p.id === f.poolId)!;
      expect(banor.has(pool.title)).toBe(false);
    }
  });

  it("mottagningen flyttas till EFTER sitt utskick", () => {
    // Texten beskriver mejlet ur användarens vy först – en omöjlig ordning:
    // användaren kan inte ta emot innan systemet skickat.
    const iUtskick = draft.steps.findIndex((s) => /mejlbekräftelse skickas/i.test(s.text));
    const iMottagning = draft.steps.findIndex((s) => s.messageDirection === "receive");
    expect(iUtskick).toBeGreaterThanOrEqual(0);
    expect(iMottagning).toBeGreaterThan(iUtskick);
  });

  it("kopplingen mellan banorna är ett SEKVENSFLÖDE, inte streckat", () => {
    const utskick = model.nodes.find((n) => /mejlbekräftelse skickas/i.test(n.label))!;
    const mottagning = model.nodes.find((n) => n.messageDirection === "receive")!;
    const kant = model.edges.find(
      (e) => e.source === utskick.id && e.target === mottagning.id,
    );
    expect(kant, "utskick och mottagning ska kopplas med sekvensflöde").toBeDefined();
    expect(kant!.kind).not.toBe("message");
    expect(utskick.laneId).not.toBe(mottagning.laneId);
    // Och ingen dubblett som meddelandeflöde.
    expect(model.messageFlows.some((f) => f.nodeId === utskick.id)).toBe(false);
  });

  it("pairMessageSteps är idempotent", () => {
    const en = pairMessageSteps(draft);
    const två = pairMessageSteps(en);
    expect(två.steps.map((s) => s.id)).toEqual(en.steps.map((s) => s.id));
  });

  it("saknas mottagningssteg säger modellen det i stället för att tiga", () => {
    const utan = textToDraft(`Test
Fel uppkommer → Fyller i formulär → Power Automate flödet triggas → Mejlbekräftelse skickas till användaren`);
    const m = compileDraft(utan);
    expect(m.messageFlows).toHaveLength(0);
    expect(m.meta.warnings.some((w) => /mottagningssteg/.test(w))).toBe(true);
  });
});

describe("gren-rader och lanehöjd", () => {
  const TEXT = `Test
Fel uppkommer → Power Automate flödet triggas (↓ Om hög prioritet → Teamschatt skapas → Chattmeddelande genereras) → Loggpost skapas`;
  const model = compileDraft(textToDraft(TEXT));

  it("grensteg får en egen rad (laneRow > 0), huvudflödet rad 0", () => {
    const gren = model.nodes.find((n) => /teamschatt/i.test(n.label))!;
    const huvud = model.nodes.find((n) => /flödet triggas/i.test(n.label))!;
    expect(gren.laneRow).toBeGreaterThan(0);
    expect(huvud.laneRow ?? 0).toBe(0);
  });

  it("en gren växer INTE banan automatiskt – default är en rad", () => {
    // Auto-staplingen förkastades (3 objekt på höjden "ser inte klokt ut").
    // Utan manuell höjd radar banan upp allt på EN rad, oavsett grenar. Banans
    // höjd kan variera några px (en gateway är högre än en aktivitet) men det får
    // aldrig bli en extra rad.
    const med = layoutModel(model);
    const laneMed = med.lanes.find((l) => l.id === "Power Automate")!;
    const paNoder = med.nodes.filter((n) => n.node.laneId === "Power Automate");
    const rader = new Set(paNoder.map((n) => Math.round((n.y + n.h / 2 - laneMed.y) / 30))).size;
    expect(rader).toBe(1);
  });

  // Innehållet (flows/) ligger inte i git – i en ren klon hoppas testet över.
  // Alla flöden med genuint parallella steg i Power Automate-banan prövas, så
  // att testet inte hänger på en viss installations flödesnamn.
  it.skipIf(!fs.existsSync("flows"))("parallella steg staplas lodrätt som default; kort höjd sprider på färre rader", () => {
    // Där har Power Automate genuint parallella steg (samma rank). AUTO
    // staplar dem lodrätt (flera rader) så sidbredden hålls; drar man in
    // banan lägre sprids de i sidled på FÄRRE rader.
    const rader = (draft: any) => {
      const vy = filterByPerspective(compileDraft(draft), "system");
      const lay = layoutModel(vy);
      const lane = lay.lanes.find((l) => l.id === "Power Automate");
      if (!lane) return 0;
      const yer = lay.nodes
        .filter((n) => n.node.laneId === "Power Automate")
        .map((n) => Math.round((n.y + n.h / 2 - lane.y) / 30));
      return new Set(yer).size;
    };
    let prövade = 0;
    for (const fil of fs.readdirSync("flows").filter((f) => f.endsWith(".json") && !f.startsWith("ap-"))) {
      const flow = JSON.parse(fs.readFileSync(`flows/${fil}`, "utf8"));
      if (!flow.draft?.steps || flow.draft.diagramType === "affarsprocess") continue;
      // Testet mäter MOTORNS radläggning – de manuellt dragna positionerna i
      // den sparade filen nollas, annars ligger noderna där de släpptes
      // oavsett vad radläggningen bestämmer.
      const grund = clearPositions(flow.draft);
      const auto = rader(grund);
      if (auto <= 1) continue; // inga parallella steg i banan
      const lågt = rader(setLaneHeight(grund, "Power Automate", 130));
      expect(lågt, fil).toBeLessThan(auto); // lägre bana → färre rader
      prövade++;
    }
    if (prövade === 0) console.warn("inget flöde med parallella Power Automate-steg att pröva");
  });

  it("manuell höjd GÖR banan högre", () => {
    const draft = setLaneHeight(textToDraft(TEXT), "Power Automate", 400);
    const lane = layoutModel(compileDraft(draft)).lanes.find((l) => l.id === "Power Automate")!;
    expect(Math.round(lane.h)).toBe(400);
  });

  it("manuell höjd respekteras till 100 % – för liten höjd ger ett RÅD, inget veto", () => {
    // Användaren äger banhöjden. Tidigare klampades den till innehållshöjden –
    // det såg ut som att banan inte gick att minska. Nu gäller valet exakt,
    // och layouten rapporterar en rekommenderad minsta höjd i stället.
    const draft = setLaneHeight(textToDraft(TEXT), "Power Automate", 40);
    const lay = layoutModel(compileDraft(draft));
    const lane = lay.lanes.find((l) => l.id === "Power Automate")!;
    expect(Math.round(lane.h)).toBe(40);
    const varning = lay.laneVarningar?.find((v) => v.laneId === "Power Automate");
    expect(varning, "för liten höjd ska ge en rekommendation").toBeDefined();
    expect(varning!.rekommenderad).toBeGreaterThan(40);
  });

  it("null återställer till automatisk höjd", () => {
    const draft = setLaneHeight(setLaneHeight(textToDraft(TEXT), "Power Automate", 400), "Power Automate", null);
    const lane = layoutModel(compileDraft(draft)).lanes.find((l) => l.id === "Power Automate")!;
    expect(lane.h).not.toBe(400);
  });

  it("grenar som inte krockar i kolumnled delar rad (banan blir inte onödigt hög)", () => {
    // Två grenar långt ifrån varandra i flödet ska kunna ligga på samma rad.
    const bred = compileDraft(textToDraft(`Test
Start (↓ Om A → Gren A1 → Gren A2) → Mellansteg → Beslut två (↓ Om B → Gren B1 → Gren B2) → Slut`));
    const rader = bred.nodes.filter((n) => (n.laneRow ?? 0) > 0).map((n) => n.laneRow ?? 0);
    // Båda grenarna ligger i huvudflödets bana och krockar inte → en gren-rad.
    expect(Math.max(0, ...rader)).toBeLessThanOrEqual(1);
  });
});

describe("setLaneHeight per del", () => {
  const d = textToDraft(TEXT);

  it("sätter och tar bort en per-del-höjd utan att röra den globala", () => {
    const med = setLaneHeight(setLaneHeight(d, "Power Automate", 300), "Power Automate", 180, 1);
    const lane = allLanes(med).find((l) => l.id === "Power Automate")!;
    expect(lane.height).toBe(300);
    expect(lane.pageHeights).toEqual({ 1: 180 });

    // null med del tar bort delens åsidosättande – globalen står kvar.
    const utanDel = setLaneHeight(med, "Power Automate", null, 1);
    const lane2 = allLanes(utanDel).find((l) => l.id === "Power Automate")!;
    expect(lane2.pageHeights).toBeUndefined();
    expect(lane2.height).toBe(300);

    // null med del när ingen del-höjd finns nollar i stället globalen –
    // så läser dubbelklicket naturligt i flersidigt läge.
    const helAuto = setLaneHeight(utanDel, "Power Automate", null, 1);
    expect(allLanes(helAuto).find((l) => l.id === "Power Automate")!.height).toBeUndefined();
  });
});

describe("ett slut i en gren", () => {
  const L = "Användare";
  const steg = (id: string, type: DraftStep["type"], text: string, extra: Partial<DraftStep> = {}): DraftStep => ({
    id,
    type,
    text,
    laneId: L,
    sourceIndex: -1,
    ...extra,
  });
  const draft = (grenslut: DraftStep["type"]): ProcessDraft => ({
    ...emptyDraft(),
    lanes: [makeLane(L, 0)],
    steps: [
      steg("start", "start", "Jag har en idé"),
      steg("bra", "decision", "Tillräckligt bra?", { gateway: "exclusive" }),
      steg("visa", "activity", "Visar chefen", { branchOf: { stepId: "bra", label: "Ja" } }),
      steg("stopp", grenslut, "Inget att ta vidare", { branchOf: { stepId: "bra", label: "Nej" } }),
      steg("presentera", "activity", "Presentation för chefen"),
    ],
  });

  it("REGRESSION: ett slut sist i en gren återförenades med huvudflödet och gjordes om till en aktivitet", () => {
    const m = compileDraft(draft("end"));
    expect(m.nodes.find((n) => n.id === "stopp")?.type).toBe("end");
    expect(m.edges.filter((e) => e.source === "stopp")).toEqual([]);
    // Ja-grenen går vidare som förut.
    expect(m.edges.some((e) => e.source === "visa" && e.target === "presentera")).toBe(true);
  });

  it("en aktivitet sist i en gren återförenas fortfarande", () => {
    const m = compileDraft(draft("activity"));
    expect(m.edges.some((e) => e.source === "stopp" && e.target === "presentera")).toBe(true);
  });
});
