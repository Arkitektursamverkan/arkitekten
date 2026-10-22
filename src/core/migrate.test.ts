import { describe, expect, it } from "vitest";
import { compileDraft, type ProcessDraft, type DraftStep } from "./draft";
import { migrateDraft } from "./migrate";

/** Bygger en draft ur en kompakt beskrivning – lättare att läsa i testen. */
function draftAv(steps: Partial<DraftStep>[]): ProcessDraft {
  return {
    title: "Test",
    lanes: [],
    steps: steps.map((s, i) => ({
      id: `s${i + 1}`,
      type: "activity",
      text: `Steg ${i + 1}`,
      laneId: "Användare",
      sourceIndex: i,
      ...s,
    })) as DraftStep[],
    meta: { sourceText: "", origin: "rules", sourceFragments: [], warnings: [] },
  };
}

describe("migrateDraft – notifieringar", () => {
  it("flyttar notifieringar ut ur kanalbanan till utföraren", () => {
    const d = draftAv([
      { text: "Flödet triggas", type: "system", laneId: "Power Automate" },
      { text: "Mejl skickas till användaren", type: "notification", laneId: "Kommunikationsmedel" },
    ]);
    const { draft } = migrateDraft(d);
    expect(draft.steps[1].laneId).toBe("Power Automate");
  });

  it("hoppar över datalager när utföraren söks", () => {
    // Ett datalager skickar inga mejl – bekräftelsen ska inte hamna i dess bana.
    const d = draftAv([
      { text: "Flödet triggas", type: "system", laneId: "Power Automate" },
      { text: "Loggpost skrivs", type: "datastore", laneId: "SharePoint" },
      { text: "Bekräftelsemejl till användaren", type: "notification", laneId: "Kommunikationsmedel" },
    ]);
    expect(migrateDraft(d).draft.steps[2].laneId).toBe("Power Automate");
  });

  it("sätter mottagare ur texten och ger ett meddelandeflöde", () => {
    const d = draftAv([
      { text: "Flödet triggas", type: "system", laneId: "Power Automate" },
      { text: "Mejl skickas till handläggaren", type: "notification", laneId: "Kommunikationsmedel" },
    ]);
    const { draft } = migrateDraft(d);
    expect(draft.steps[1].recipient).toBe("Handläggare");

    const model = compileDraft(draft);
    expect(model.messageFlows).toHaveLength(1);
    expect(model.pools.find((p) => p.id === model.messageFlows[0].poolId)?.title).toBe(
      "Handläggare",
    );
  });

  it("rör inte en notifiering som redan har mottagare", () => {
    const d = draftAv([
      { text: "Mejl till användaren", type: "notification", laneId: "Power Automate", recipient: "Extern" },
    ]);
    expect(migrateDraft(d).draft.steps[0].recipient).toBe("Extern");
  });
});

describe("migrateDraft – beslut", () => {
  it("flyttar ett beslut vars grenar bara ligger i kanalbanor", () => {
    const d = draftAv([
      { text: "Flödet triggas", type: "system", laneId: "Power Automate" },
      { text: "Hög prioritet?", type: "decision", laneId: "Användare" },
      {
        text: "Teamschatt skapas",
        type: "notification",
        laneId: "Kommunikationsmedel",
        branchOf: { stepId: "s2", label: "Ja" },
      },
    ]);
    expect(migrateDraft(d).draft.steps[1].laneId).toBe("Power Automate");
  });

  it("LÄMNAR ett beslut vars grenar säger emot steget före", () => {
    // Den parallella gatewayen hör till Power Automate även om steget före
    // ligger i SharePoint. En gissning som flyttar fel är värre än att låta bli.
    const d = draftAv([
      { text: "Post skapas", type: "datastore", laneId: "SharePoint" },
      { text: "Två flöden startar parallellt", type: "decision", laneId: "Power Automate" },
      {
        text: "Flöde A startar",
        type: "system",
        laneId: "Power Automate",
        branchOf: { stepId: "s2", label: "A" },
      },
    ]);
    expect(migrateDraft(d).draft.steps[1].laneId).toBe("Power Automate");
  });
});

describe("migrateDraft – bevarar handarbete", () => {
  const bas = draftAv([
    { text: "Flödet triggas", type: "system", laneId: "Power Automate" },
    { text: "Fyller i formulär", laneId: "Portalen", position: { x: 10, y: 20 } },
    { text: "Mejl till handläggaren", type: "notification", laneId: "Kommunikationsmedel", position: { x: 5, y: 5 } },
  ]);

  it("rensar ALLA positioner när någon bana ändrats", () => {
    // Banbytet flyttar hela layoutens referensram: banorna får nya y-lägen och
    // diagrammet en annan bredd. Kvarvarande positioner pekar då på lägen som
    // inte finns – objekt hamnar utanför sidan eller ovanpå varandra.
    const { draft } = migrateDraft(bas);
    expect(draft.steps.every((s) => !s.position)).toBe(true);
  });

  it("rör inte positioner när ingenting behövde flyttas", () => {
    const orört = draftAv([
      { text: "Flödet triggas", type: "system", laneId: "Power Automate" },
      { text: "Fyller i formulär", laneId: "Portalen", position: { x: 10, y: 20 } },
    ]);
    const { draft, changes } = migrateDraft(orört);
    expect(changes).toEqual([]);
    expect(draft.steps[1].position).toEqual({ x: 10, y: 20 });
  });

  it("behåller kopplingspunkter och borttagna kanter", () => {
    const med: ProcessDraft = {
      ...bas,
      edgeStyles: { "s1->s2": { sourceSide: "top" } },
      removedEdges: ["s2->s3"],
    };
    const { draft } = migrateDraft(med);
    expect(draft.edgeStyles).toEqual({ "s1->s2": { sourceSide: "top" } });
    expect(draft.removedEdges).toEqual(["s2->s3"]);
  });

  it("behåller antalet steg och deras id:n", () => {
    const { draft } = migrateDraft(bas);
    expect(draft.steps.map((s) => s.id).sort()).toEqual(bas.steps.map((s) => s.id).sort());
  });

  it("är idempotent – andra körningen ändrar ingenting", () => {
    const en = migrateDraft(bas);
    const två = migrateDraft(en.draft);
    expect(två.changes).toEqual([]);
    expect(två.draft.steps).toEqual(en.draft.steps);
  });
});
