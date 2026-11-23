import { describe, expect, it } from "vitest";
import {
  KLASSA_MODELL,
  STANDARDINSTÄLLNING,
  Klassningsfel,
  klassningIExport,
  klassningsText,
  läsKlassning,
  läsKlassningsinställning,
  modellTillText,
  prövaKlassning,
  textTillNivåer,
} from "./klassning";

describe("klassningsinställningen", () => {
  it("är AV som förval, med den neutrala modellen", () => {
    expect(läsKlassningsinställning(undefined)).toEqual(STANDARDINSTÄLLNING);
    expect(STANDARDINSTÄLLNING.på).toBe(false);
    expect(STANDARDINSTÄLLNING.modell.id).toBe(KLASSA_MODELL.id);
  });

  it("en inbyggd modell läses alltid ur produkten – filen kan inte skriva om dess nivåer", () => {
    const inst = läsKlassningsinställning({ på: true, modell: { id: KLASSA_MODELL.id, nivåer: [{ namn: "Påhittad" }] } });
    expect(inst.modell).toBe(KLASSA_MODELL);
  });

  it("en egen modell utan nivåer faller tillbaka på standardmodellen", () => {
    expect(läsKlassningsinställning({ på: true, modell: { id: "egen", nivåer: [] } }).modell).toBe(KLASSA_MODELL);
  });
});

describe("modellen som text", () => {
  it("indragna rader och rader som börjar med \\ blir undernivåer", () => {
    const n = textTillNivåer("Nivå 0 - Öppen\nNivå 2 - Hemlig\n\\2.1 Hemlig A\n   2.2 Hemlig B\n\n");
    expect(n.map((x) => [x.namn, x.djup])).toEqual([
      ["Nivå 0 - Öppen", 0],
      ["Nivå 2 - Hemlig", 0],
      ["2.1 Hemlig A", 1],
      ["2.2 Hemlig B", 1],
    ]);
    expect(n.map((x) => x.id)).toEqual(["niva-0-oppen", "niva-2-hemlig", "2-1-hemlig-a", "2-2-hemlig-b"]);
  });

  it("två nivåer med samma namn får olika id:n, och den första är aldrig en undernivå", () => {
    const n = textTillNivåer("  Först\nNivå 2\nNivå 2");
    expect(n[0].djup).toBe(0);
    expect(new Set(n.map((x) => x.id)).size).toBe(3);
  });

  it("text → modell → text är stabilt", () => {
    const text = modellTillText({ ...KLASSA_MODELL, nivåer: textTillNivåer("A\n  B\nC") });
    expect(text).toBe("A\n  B\nC");
  });
});

describe("klassningen på en process eller skiss", () => {
  const på = { ...STANDARDINSTÄLLNING, på: true };

  it("prövas mot modellen och stämplas", () => {
    const k = prövaKlassning(på, undefined, { nivå: "niva-2", namn: "fel" }, "Anna", "2026-01-01T00:00:00.000Z");
    expect(k).toEqual({ nivå: "niva-2", namn: "Nivå 2 – Betydande skada", satt: "2026-01-01T00:00:00.000Z", sattAv: "Anna" });
    expect(() => prövaKlassning(på, undefined, { nivå: "niva-9" }, "Anna")).toThrow(Klassningsfel);
  });

  it("samma nivå igen behåller tid och person; null tar bort; avstängd behåller filens", () => {
    const k = prövaKlassning(på, undefined, { nivå: "niva-1" }, "Anna", "2026-01-01T00:00:00.000Z")!;
    expect(prövaKlassning(på, k, { nivå: "niva-1" }, "Bo")).toBe(k);
    expect(prövaKlassning(på, k, null, "Bo")).toBeUndefined();
    expect(prövaKlassning(STANDARDINSTÄLLNING, k, null, "Bo")).toBe(k);
  });

  it("texten följer modellens namn, och namnet när den sattes om nivån försvunnit", () => {
    const k = läsKlassning({ nivå: "niva-3", namn: "Gammalt namn", satt: "2026-01-01T00:00:00.000Z" });
    expect(klassningsText(på, k)).toBe("Nivå 3 – Allvarlig skada");
    expect(klassningsText(på, { ...k!, nivå: "borta" })).toBe("Gammalt namn");
    expect(klassningsText(STANDARDINSTÄLLNING, k)).toBe("");
    expect(klassningIExport({ ...på, visaIExport: false }, k)).toBe("");
  });

  it("läsningen släpper inget oprövat igenom", () => {
    expect(läsKlassning({ nivå: "<script>", namn: "x" })).toBeUndefined();
    expect(läsKlassning({ nivå: "a", namn: "" })).toBeUndefined();
  });
});
