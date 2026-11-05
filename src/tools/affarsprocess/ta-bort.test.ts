/**
 * Ta bort, bryta och lägga till i kedjan (lagg-till.ts).
 *
 * REGRESSION: bara fria objekt ur paletten gick att ta bort. En aktivitet som
 * AI:n eller regelparsern tolkat fram var ett kedjesteg, och för den fanns
 * ingen borttagning i Affärsprocess – inte heller gick kedjan att bryta.
 */

import { describe, expect, it } from "vitest";
import { compileAp, setStepAp, voId } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { kanTaBort, läggTillAktivitetEfter, läggTillObjekt, taBortKedjepil, taBortObjekt } from "./lagg-till";

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 3, ...extra };
}

function draftMed(steps: DraftStep[]): ProcessDraft {
  return {
    ...emptyDraft(),
    title: "Test",
    lanes: [makeLane("Användare", 0)],
    steps,
    meta: { ...emptyDraft().meta, origin: "ai" },
  };
}

const KEDJA = draftMed([
  steg("s1", "activity", "Ta emot ärende"),
  steg("s2", "activity", "Diarieför ärende"),
  steg("s3", "activity", "Besvara ärende"),
]);

/** Kedjepilarna mellan stegen, oavsett om ett verksamhetsobjekt står emellan. */
function följer(d: ProcessDraft, från: string, till: string): boolean {
  return compileAp(d).relations.some(
    (r) => r.kant?.source === från && r.kant?.target === till,
  );
}

describe("taBortObjekt", () => {
  it("REGRESSION: en tolkad aktivitet går att ta bort och kedjan sluts runt luckan", () => {
    expect(kanTaBort(KEDJA, "s2")).toBe(true);
    const d = taBortObjekt(KEDJA, ["s2"]);
    expect(d.steps.map((s) => s.id)).toEqual(["s1", "s3"]);
    const m = compileAp(d);
    expect(m.nodes.some((n) => n.id === "s2")).toBe(false);
    expect(följer(d, "s1", "s3")).toBe(true);
  });

  it("aktivitetens satelliter och ut-objekt följer med", () => {
    const med = setStepAp(KEDJA, "s2", { roller: [{ namn: "Registrator" }], output: "Diarienummer" });
    expect(compileAp(med).nodes.some((n) => n.anchorId === "s2")).toBe(true);
    const m = compileAp(taBortObjekt(med, ["s2"]));
    expect(m.nodes.some((n) => n.anchorId === "s2" || n.id === voId("s2"))).toBe(false);
  });

  it("handritade pilar till steget tas bort med det – ingen kant utan nod", () => {
    const d = taBortObjekt({ ...KEDJA, extraEdges: [{ source: "s1", target: "s2" }, { source: "s3", target: "s1" }] }, ["s2"]);
    expect(d.extraEdges).toEqual([{ source: "s3", target: "s1" }]);
  });

  it("flera på en gång, fria objekt också; satelliter och okända id:n rörs inte", () => {
    const { draft: medFri, nodId } = läggTillObjekt(KEDJA, "roll", { x: 0, y: 0 });
    const d = taBortObjekt(medFri, ["s1", nodId!, "roll_s2_x", "finns-inte"]);
    expect(d.steps.map((s) => s.id)).toEqual(["s2", "s3"]);
    expect(d.apFria ?? []).toEqual([]);
    expect(kanTaBort(d, "roll_s2_x")).toBe(false);
  });
});

describe("taBortKedjepil", () => {
  it("bryter kedjan mellan två tolkade steg – stegen står kvar", () => {
    expect(följer(KEDJA, "s1", "s2")).toBe(true);
    const d = taBortKedjepil(KEDJA, { source: "s1", target: "s2" });
    expect(följer(d, "s1", "s2")).toBe(false);
    expect(följer(d, "s2", "s3")).toBe(true);
    expect(d.steps).toEqual(KEDJA.steps);
  });
});

describe("läggTillAktivitetEfter", () => {
  it("lägger en ny aktivitet i kedjan direkt efter steget", () => {
    const { draft: d, nodId } = läggTillAktivitetEfter(KEDJA, "s1");
    expect(nodId).toBe("s4");
    expect(d.steps.map((s) => s.id)).toEqual(["s1", "s4", "s2", "s3"]);
    expect(följer(d, "s1", "s4")).toBe(true);
    expect(följer(d, "s4", "s2")).toBe(true);
    expect(följer(d, "s1", "s2")).toBe(false);
  });

  it("efter en regel hamnar den nya aktiviteten efter regelns grenar", () => {
    const medRegel = draftMed([
      steg("s1", "decision", "Komplett?"),
      steg("s2", "activity", "Begär komplettering", { branchOf: { stepId: "s1", label: "Nej" } }),
      steg("s3", "activity", "Handlägg"),
    ]);
    const { draft: d, nodId } = läggTillAktivitetEfter(medRegel, "s1");
    expect(d.steps.map((s) => s.id)).toEqual(["s1", "s2", nodId, "s3"]);
    expect(d.steps.find((s) => s.id === nodId)?.branchOf).toBeUndefined();
  });
});
