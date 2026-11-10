/**
 * AI-svaret → mellanlagret. Fälten som gör tolkningen KONSEKVENT med de andra
 * diagrammen måste överleva mappningen – annars ritas AI-flöden annorlunda än
 * regel-flöden (t.ex. mejl i en egen kanalbana i stället för meddelandeflöden).
 */

import { describe, expect, it } from "vitest";
import { compileDraft } from "@/core/draft";
import { toDraft, type AiDraftResponse } from "./schema";

const SVAR: AiDraftResponse = {
  aiText: "Test\nFlödet triggas → Mejl skickas till användaren",
  title: "Test",
  subtitle: null,
  lanes: [{ id: "Power Automate", title: "Power Automate" }],
  steps: [
    {
      id: "s1",
      type: "system",
      text: "Flödet triggas",
      laneId: "Power Automate",
      gateway: null,
      branchOfStepId: null,
      branchLabel: null,
      sourceText: "flödet triggas",
      note: null,
      recipient: null,
      messageDirection: null,
    },
    {
      id: "s2",
      type: "notification",
      text: "Mejl skickas till användaren",
      laneId: "Power Automate",
      gateway: null,
      branchOfStepId: null,
      branchLabel: null,
      sourceText: "mejl skickas till användaren",
      note: null,
      recipient: "Användare",
      messageDirection: "send",
    },
  ],
};

describe("AI-schemats mappning till mellanlagret", () => {
  it("REGRESSION: recipient följer med och blir ett meddelandeflöde", () => {
    // Utan recipient i schemat hamnade AI-tolkade mejl i en egen kanalbana
    // (Kommunikationsmedel) utan mottagare – inkonsekvent med regelmotorn och
    // de andra diagrammen, där mejl ligger hos avsändaren med meddelandeflöde
    // till en mottagarpool.
    const draft = toDraft(SVAR, "råtext");
    expect(draft.steps[1].recipient).toBe("Användare");
    expect(draft.steps[1].messageDirection).toBe("send");

    const model = compileDraft(draft);
    const mf = model.messageFlows.find((f) => f.nodeId === "s2");
    expect(mf, "mejlet ska ge ett meddelandeflöde").toBeDefined();
    expect(model.pools.find((p) => p.id === mf!.poolId)?.title).toBe("Användare");
  });

  it("REGRESSION: steg utan källfras är TILLÄGG – utanför spårbarheten", () => {
    // Ett underförstått steg (t.ex. ett mottagningssteg som strikt BPMN kräver)
    // har ingen fras i källtexten. Räknades det som textfragment kunde det
    // aldrig bevisas mot texten och valideringen slog falskt larm.
    const svar: AiDraftResponse = {
      ...SVAR,
      steps: [
        ...SVAR.steps,
        {
          id: "s3",
          type: "notification",
          text: "Användaren får mejlet",
          laneId: "Power Automate",
          gateway: null,
          branchOfStepId: null,
          branchLabel: null,
          sourceText: null,
          note: "Underförstått mottagningssteg.",
          recipient: null,
          messageDirection: "receive",
        },
      ],
    };
    const draft = toDraft(svar, "råtext");
    const tillägg = draft.steps.find((s) => s.id === "s3")!;
    expect(tillägg.sourceIndex).toBe(-1);
    expect(draft.meta.sourceFragments).not.toContain("Användaren får mejlet");
    // Steg MED källfras spåras precis som förut.
    expect(draft.steps[0].sourceIndex).toBeGreaterThanOrEqual(0);
  });

  it("recipient ignoreras på steg som inte är notifieringar", () => {
    const svar: AiDraftResponse = {
      ...SVAR,
      steps: [{ ...SVAR.steps[0], recipient: "Användare", messageDirection: "send" }],
    };
    const draft = toDraft(svar, "råtext");
    expect(draft.steps[0].recipient).toBeUndefined();
    expect(draft.steps[0].messageDirection).toBeUndefined();
  });

  it("satellitannoteringar i stegtexten lyfts till ap-blocket – samma syntax som regelparsern", () => {
    const svar: AiDraftResponse = {
      ...SVAR,
      steps: [
        {
          ...SVAR.steps[0],
          text: "Genomför urval [Roll: HR U] [IT: Rekryteringssystem] [Krav: Öka mångfald]",
        },
      ],
    };
    const draft = toDraft(svar, "råtext");
    expect(draft.steps[0].text).toBe("Genomför urval");
    expect(draft.steps[0].ap?.roller).toEqual([{ namn: "HR", huki: "U" }]);
    expect(draft.steps[0].ap?.applikationer).toEqual(["Rekryteringssystem"]);
    expect(draft.steps[0].ap?.krav).toEqual(["Öka mångfald"]);
  });
});
