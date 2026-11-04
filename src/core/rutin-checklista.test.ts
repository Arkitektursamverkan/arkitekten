import { describe, expect, it } from "vitest";
import { delaChecklista, harChecklista } from "./rutin";
import { compileAp, idEfterLyft, lyftUtChecklistor, satellitId } from "./affarsprocess";
import type { ProcessDraft } from "./draft";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";
import { toDraft } from "@/tools/flowchart/ai/schema";

const KRAV = "Rutin uppdatering brandväggar – ☐ Ladda ner firmware, för brandväggar ☐ Ta backup av konfigurationen";

describe("delaChecklista", () => {
  it("delar namnet före rutorna från momenten", () => {
    expect(delaChecklista(KRAV)).toEqual({
      namn: "Rutin uppdatering brandväggar",
      rutin: "Ladda ner firmware, för brandväggar\nTa backup av konfigurationen",
    });
  });

  it("tar kolon och förbockade rutor, och heter Rutin utan namn", () => {
    expect(delaChecklista("☑ Ta backup ☐ Starta om")).toEqual({ namn: "Rutin", rutin: "Ta backup\nStarta om" });
    expect(delaChecklista("Kontroll: ☐ A")).toEqual({ namn: "Kontroll", rutin: "A" });
  });

  it("ett krav utan rutor är inget att dela", () => {
    expect(harChecklista("Inga ändringar runt den 1:e")).toBe(false);
    expect(delaChecklista("Inga ändringar runt den 1:e")).toBeNull();
  });
});

function draftMedKrav(krav: string[], extra: Partial<ProcessDraft> = {}): ProcessDraft {
  const d = textToDraft("P\nStart → Uppdatera brandväggar → Klart");
  return {
    ...d,
    diagramType: "affarsprocess",
    steps: d.steps.map((s) => (s.text === "Uppdatera brandväggar" ? { ...s, ap: { krav } } : s)),
    ...extra,
  };
}

describe("lyftUtChecklistor", () => {
  it("REGRESSION: en checklista i ett krav blev kravets namn och ingen rutin (patchningsprocessen)", () => {
    const d = lyftUtChecklistor(draftMedKrav([KRAV, "Inga ändringar runt den 1:e"]));
    const steg = d.steps.find((s) => s.text === "Uppdatera brandväggar")!;
    expect(steg.ap?.krav).toEqual(["Rutin uppdatering brandväggar", "Inga ändringar runt den 1:e"]);
    const krav = compileAp(d).nodes.find((n) => n.kind === "krav" && n.label === "Rutin uppdatering brandväggar");
    expect(krav?.rutin).toBe("Ladda ner firmware, för brandväggar\nTa backup av konfigurationen");
  });

  it("flyttar sparad position till det nya id:t och skriver aldrig över en rutin", () => {
    const steg = draftMedKrav([KRAV]).steps.find((s) => s.text === "Uppdatera brandväggar")!;
    const gammalt = satellitId("krav", steg.id, KRAV);
    const nytt = satellitId("krav", steg.id, "Rutin uppdatering brandväggar");
    const d = lyftUtChecklistor(
      draftMedKrav([KRAV], {
        autoPositions: { [gammalt]: { x: 10, y: 20 } },
        apRutiner: { [nytt]: { text: "Skriven för hand" } },
      }),
    );
    expect(d.autoPositions?.[nytt]).toEqual({ x: 10, y: 20 });
    expect(d.autoPositions?.[gammalt]).toBeUndefined();
    expect(d.apRutiner?.[nytt]?.text).toBe("Skriven för hand");
    expect(idEfterLyft(draftMedKrav([KRAV]), gammalt)).toBe(nytt);
  });

  it("lyfter bara det utpekade kravet och lämnar en draft utan checklistor orörd", () => {
    const utan = draftMedKrav(["Inga ändringar"]);
    expect(lyftUtChecklistor(utan)).toBe(utan);
    const två = draftMedKrav([KRAV, "Annan – ☐ X"]);
    const steg = två.steps.find((s) => s.text === "Uppdatera brandväggar")!;
    const d = lyftUtChecklistor(två, satellitId("krav", steg.id, KRAV));
    expect(d.steps.find((s) => s.id === steg.id)?.ap?.krav).toEqual(["Rutin uppdatering brandväggar", "Annan – ☐ X"]);
  });
});

describe("tolkningen skapar rutinen", () => {
  it("REGRESSION: regelparsern klippte checklistan vid strecket och läste parentesen som gren", () => {
    const d = textToDraft(
      "P\nStart → Kontrollera kompatibilitet [Roll: IT U] [Krav: Rutin kompatibilitet – ☐ Brandväggar (uppgraderingsväg) ☐ Switchar] → Klart",
    );
    expect(d.steps.map((s) => s.text)).toEqual(["Start", "Kontrollera kompatibilitet", "Klart"]);
    const steg = d.steps[1];
    expect(steg.ap?.krav).toEqual(["Rutin kompatibilitet"]);
    expect(d.apRutiner?.[satellitId("krav", steg.id, "Rutin kompatibilitet")]?.text).toBe(
      "Brandväggar (uppgraderingsväg)\nSwitchar",
    );
  });

  it("AI-svarets checklista blir en rutin", () => {
    const d = toDraft(
      {
        aiText: "",
        title: "P",
        lanes: [{ id: "A", title: "A" }],
        steps: [
          { id: "s1", type: "activity", text: `Uppdatera brandväggar [Krav: ${KRAV}]`, laneId: "A" },
        ],
      } as never,
      "",
    );
    expect(d.steps[0].ap?.krav).toEqual(["Rutin uppdatering brandväggar"]);
    expect(d.apRutiner?.[satellitId("krav", "s1", "Rutin uppdatering brandväggar")]?.text).toContain("Ta backup");
  });
});
