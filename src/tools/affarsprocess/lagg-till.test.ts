/**
 * Tester för palettens placerings- och inknytningslogik (lagg-till.ts).
 *
 * REGRESSION: ett placerat objekt kedjades tidigare in DIREKT (addStepAfter)
 * – flödet ritades om och det såg ut som att andra aktiviteter försvann.
 * Kontraktet nu: placering ger ett FRITT objekt utan någon koppling alls;
 * först en dragen pil knyter in det, och då konverteras det till sin
 * riktiga form i mellanlagret.
 */

import { describe, expect, it } from "vitest";
import { compileAp, satellitId, voId, voInId } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { bytFriNamn, knytIhop, läggTillObjekt, taBortFri } from "./lagg-till";

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 0, ...extra };
}

function draftMed(steps: DraftStep[]): ProcessDraft {
  return { ...emptyDraft(), title: "Test", lanes: [makeLane("Användare", 0)], steps };
}

const BAS = draftMed([
  steg("s1", "activity", "Genomför urval"),
  steg("s2", "activity", "Fatta beslut"),
]);
const POS = { x: 100, y: 200 };

describe("läggTillObjekt – fria objekt", () => {
  it("REGRESSION: en placerad aktivitet rör INTE kedjan – inga steg, inga relationer", () => {
    const res = läggTillObjekt(BAS, "aktivitet", POS);
    // Stegen är orörda – ingen annan aktivitet kan "försvinna".
    expect(res.draft.steps).toEqual(BAS.steps);
    expect(res.nodId).toBe("fri_1");
    const m = compileAp(res.draft);
    const fri = m.nodes.find((n) => n.id === "fri_1")!;
    expect(fri.kind).toBe("aktivitet");
    expect(fri.position).toEqual(POS);
    // Helt okopplad tills en pil dras.
    expect(m.relations.some((r) => r.source === "fri_1" || r.target === "fri_1")).toBe(false);
  });

  it("id:n lagras och förskjuts aldrig – ta bort fri_1, nästa blir fri_3", () => {
    let d = läggTillObjekt(BAS, "roll", POS).draft;
    d = läggTillObjekt(d, "krav", POS).draft;
    d = taBortFri(d, "fri_1");
    const res = läggTillObjekt(d, "tid", POS);
    expect(res.nodId).toBe("fri_3");
    expect(d.apFria?.map((f) => f.id)).toEqual(["fri_2"]);
  });

  it("namnbyte på fritt objekt behåller id och position", () => {
    const placerad = läggTillObjekt(BAS, "roll", POS).draft;
    const bytt = bytFriNamn(placerad, "fri_1", "HR-partner");
    expect(bytt.apFria?.[0]).toEqual({ id: "fri_1", kind: "roll", namn: "HR-partner" });
    expect(bytt.autoPositions?.["fri_1"]).toEqual(POS);
    expect(compileAp(bytt).nodes.find((n) => n.id === "fri_1")?.label).toBe("HR-partner");
  });
});

describe("knytIhop – pilen konverterar", () => {
  it("fri roll + pil till aktivitet → satellit i ap-blocket, position följer med", () => {
    const placerad = läggTillObjekt(BAS, "roll", POS).draft;
    const knuten = knytIhop(placerad, "fri_1", "s1");
    expect(knuten.apFria).toEqual([]);
    expect(knuten.steps[0].ap?.roller).toEqual([{ namn: "Ny roll", huki: "U" }]);
    const nyttId = satellitId("roll", "s1", "Ny roll");
    expect(knuten.autoPositions?.[nyttId]).toEqual(POS);
    expect(knuten.autoPositions?.["fri_1"]).toBeUndefined();
    const m = compileAp(knuten);
    expect(m.relations.find((r) => r.source === nyttId && r.target === "s1")?.kind).toBe("huki");
  });

  it("fritt VO: pil FRÅN steget ger ut-objekt, pil TILL steget ger in-objekt", () => {
    const medUt = knytIhop(läggTillObjekt(BAS, "vo", POS).draft, "s1", "fri_1");
    expect(medUt.steps[0].ap?.output).toBe("Nytt objekt");
    expect(medUt.autoPositions?.[voId("s1")]).toEqual(POS);

    const medIn = knytIhop(läggTillObjekt(BAS, "vo", POS).draft, "fri_1", "s1");
    expect(medIn.steps[0].ap?.input).toBe("Nytt objekt");
    expect(medIn.autoPositions?.[voInId("s1")]).toEqual(POS);
  });

  it("fri aktivitet + pil från ett steg → riktigt kedjesteg EFTER steget", () => {
    const placerad = läggTillObjekt(BAS, "aktivitet", POS).draft;
    const knuten = knytIhop(placerad, "s1", "fri_1");
    expect(knuten.apFria).toEqual([]);
    expect(knuten.steps.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
    const nytt = knuten.steps[1];
    expect(nytt.text).toBe("Ny aktivitet");
    expect(nytt.position).toEqual(POS);
  });

  it("fri aktivitet + pil TILL ett steg → kedjesteg FÖRE steget", () => {
    const placerad = läggTillObjekt(BAS, "aktivitet", POS).draft;
    const knuten = knytIhop(placerad, "fri_1", "s2");
    expect(knuten.steps.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
  });

  it("upptagen tid → objektet förblir fritt med en vanlig koppling", () => {
    const bas = draftMed([steg("s1", "activity", "Genomför urval", { ap: { tid: "Inom 5 dagar" } })]);
    const placerad = läggTillObjekt(bas, "tid", POS).draft;
    const knuten = knytIhop(placerad, "fri_1", "s1");
    expect(knuten.apFria?.length).toBe(1); // kvar som fritt objekt
    expect(knuten.steps[0].ap?.tid).toBe("Inom 5 dagar"); // orört
    expect(knuten.extraEdges).toEqual([{ source: "fri_1", target: "s1" }]);
    // Relationen ritas med rätt sort (Adresserar för tid).
    const m = compileAp(knuten);
    expect(m.relations.find((r) => r.source === "fri_1")?.kind).toBe("adresserar");
  });

  it("steg ↔ steg → manuellt dragen koppling som vanligt", () => {
    const knuten = knytIhop(BAS, "s2", "s1");
    expect(knuten.extraEdges).toEqual([{ source: "s2", target: "s1" }]);
  });
});
