/**
 * Avståndet mellan de markerade objekten (layout/avstand.ts), i båda verktygen.
 *
 * Kontrakt som låses:
 *  - markeringen ändrar mellanrummen MELLAN de markerade kolumnerna, också
 *    genom kolumner där inget är markerat, och inget annat,
 *  - faktorn sätts på alla objekt i de kolumnerna (en gren delar mellanrum
 *    med huvudflödet),
 *  - faktorn kläms till 0,3–2 och 1 tar bort den,
 *  - flödesschemats och affärsprocessens layout gör pilen kortare/längre,
 *    och resten av diagrammet står still i förhållande till sina grannar.
 */
import { describe, expect, it } from "vitest";
import { compileAp } from "@/core/affarsprocess";
import { compileDraft, emptyDraft, makeLane, setKolumnAvstånd, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { layoutAp } from "@/tools/affarsprocess/layout-affarsprocess";
import {
  AVSTÅND_MAX,
  AVSTÅND_MIN,
  avståndFör,
  avståndsMål,
  klämAvstånd,
  kolumnFaktorer,
  tolkaProcent,
} from "./avstand";
import { computeRanks, layoutModel } from "./layout";

function steg(id: string, type: NodeType, text: string): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 0 };
}

const DRAFT: ProcessDraft = {
  ...emptyDraft(),
  title: "Avstånd",
  lanes: [makeLane("Användare", 0)],
  steps: [
    steg("s0", "start", "Behov uppstår"),
    steg("a1", "activity", "Registrera ansökan"),
    steg("a2", "activity", "Bedöm ansökan"),
    steg("a3", "activity", "Skicka beslut"),
  ],
};

describe("avståndsMål", () => {
  const kolumner = new Map([
    ["a", 0],
    ["b", 1],
    ["gren", 1],
    ["c", 2],
    ["d", 3],
  ]);

  it("tar alla objekt i kolumnerna från den vänstraste markerade fram till den högraste", () => {
    expect(avståndsMål(kolumner, ["a", "c"])?.sort()).toEqual(["a", "b", "gren"]);
  });

  it("ger null när markeringen står i en enda kolumn", () => {
    expect(avståndsMål(kolumner, ["b", "gren"])).toBeNull();
    expect(avståndsMål(kolumner, [])).toBeNull();
    expect(avståndsMål(kolumner, ["okänd"])).toBeNull();
  });

  it("läser markeringens faktor ur den första målnoden som har en", () => {
    expect(avståndFör(["a", "b"], { b: 0.5 })).toBe(0.5);
    expect(avståndFör(["a"], undefined)).toBe(1);
  });
});

describe("faktorn", () => {
  it("kläms och avrundas till hela procent", () => {
    expect(klämAvstånd(0.05)).toBe(AVSTÅND_MIN);
    expect(klämAvstånd(9)).toBe(AVSTÅND_MAX);
    expect(klämAvstånd(0.7000000001)).toBe(0.7);
    expect(klämAvstånd(0.654)).toBe(0.65);
    // ±10 från ett inskrivet tal ger ett jämnt tal, inte 0,5499999.
    expect(klämAvstånd(0.65 - 0.1)).toBe(0.55);
    expect(klämAvstånd(Number.NaN)).toBe(1);
  });

  it("ett inskrivet procenttal tolkas och kläms", () => {
    expect(tolkaProcent("65")).toBe(0.65);
    expect(tolkaProcent(" 65 % ")).toBe(0.65);
    expect(tolkaProcent("72,4")).toBe(0.72);
    expect(tolkaProcent("10")).toBe(AVSTÅND_MIN);
    expect(tolkaProcent("500")).toBe(AVSTÅND_MAX);
    expect(tolkaProcent("")).toBeNull();
    expect(tolkaProcent("abc")).toBeNull();
  });

  it("per kolumn är den största bland kolumnens objekt", () => {
    const f = kolumnFaktorer([
      { kolumn: 1, avståndEfter: 0.5 },
      { kolumn: 1, avståndEfter: 0.8 },
      { kolumn: 2 },
    ]);
    expect(f.get(1)).toBeCloseTo(0.8);
    expect(f.has(2)).toBe(false);
  });

  it("1 eller null tar bort faktorn ur mellanlagret, och resten av draften står kvar", () => {
    const satt = setKolumnAvstånd({ ...DRAFT, autoLabels: { x: "y" } }, ["a1", "a2"], 0.5);
    expect(satt.kolumnAvstånd).toEqual({ a1: 0.5, a2: 0.5 });
    expect(satt.autoLabels).toEqual({ x: "y" });
    expect(setKolumnAvstånd(satt, ["a1"], 1).kolumnAvstånd).toEqual({ a2: 0.5 });
    expect(setKolumnAvstånd(satt, ["a2"], null).kolumnAvstånd).toEqual({ a1: 0.5 });
  });
});

describe("flödesschemats layout", () => {
  const x = (d: ProcessDraft) => {
    const lo = layoutModel(compileDraft(d));
    return (id: string) => lo.nodes.find((n) => n.node.id === id)!.x;
  };

  it("gör mellanrummen mellan de markerade tätare, och flyttar resten lika långt", () => {
    const före = x(DRAFT);
    const mål = avståndsMål(computeRanks(compileDraft(DRAFT)), ["a1", "a2"])!;
    expect(mål).toEqual(["a1"]);
    const efter = x(setKolumnAvstånd(DRAFT, mål, 0.5));
    expect(efter("s0")).toBe(före("s0"));
    expect(efter("a1")).toBe(före("a1"));
    const krympt = före("a2") - efter("a2");
    expect(krympt).toBeGreaterThan(0);
    // Mellanrummet a2 → a3 är orört: a3 flyttar lika långt som a2.
    expect(före("a3") - efter("a3")).toBeCloseTo(krympt);
  });

  it("gör dem glesare", () => {
    const före = x(DRAFT);
    const efter = x(setKolumnAvstånd(DRAFT, ["s0", "a1", "a2"], 2));
    expect(efter("a3") - efter("s0")).toBeGreaterThan(före("a3") - före("s0"));
  });
});

describe("affärsprocessens layout", () => {
  it("gör pilen mellan de markerade kortare", () => {
    const lägen = (d: ProcessDraft) => {
      const lo = layoutAp(compileAp(d));
      return (id: string) => lo.nodes.find((n) => n.node.id === id)!;
    };
    const före = lägen(DRAFT);
    const kolumnAv = new Map(
      layoutAp(compileAp(DRAFT)).nodes.flatMap((n) => (n.kolumn === undefined ? [] : [[n.node.id, n.kolumn] as const])),
    );
    const mål = avståndsMål(kolumnAv, ["a1", "a2"])!;
    expect(mål).toContain("a1");
    const efter = lägen(setKolumnAvstånd(DRAFT, mål, 0.5));
    const lucka = (l: typeof före, a: string, b: string) => l(b).x - (l(a).x + l(a).w);
    expect(lucka(efter, "a1", "a2")).toBeLessThan(lucka(före, "a1", "a2"));
    expect(lucka(efter, "a2", "a3")).toBeCloseTo(lucka(före, "a2", "a3"));
  });
});
