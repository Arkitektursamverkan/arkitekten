/**
 * Tester för "räta upp kopplingarna".
 *
 * Kontraktet som låses: kopplingar MELLAN markerade objekt blir raka, objekt
 * utanför markeringen rörs aldrig, färst möjliga objekt flyttar, och två objekt
 * hamnar aldrig ovanpå varandra.
 */

import { describe, expect, it } from "vitest";
import { compileAp } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { ikonPortRuta } from "./former";
import { layoutAp, type ApLayout } from "./layout-affarsprocess";
import { rätaUppKopplingar } from "./rata-upp";

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Processen", sourceIndex: 0, ...extra };
}

function draftMed(steps: DraftStep[], extra?: Partial<ProcessDraft>): ProcessDraft {
  return { ...emptyDraft(), title: "Test", lanes: [makeLane("Processen", 0)], steps, ...extra };
}

/** Symbolens mitt – samma regel som modulen linjerar efter. */
function mitt(lo: ApLayout, id: string) {
  const n = lo.nodes.find((p) => p.node.id === id)!;
  expect(n, `${id} saknas i utlägget`).toBeDefined();
  const ikon = ikonPortRuta(n.node.kind, n.w, n.h);
  return {
    x: n.x + (ikon ? ikon.x + ikon.w / 2 : n.w / 2),
    y: n.y + (ikon ? ikon.y + ikon.h / 2 : n.h / 2),
  };
}

/** Bygger ett utlägg och lägger på flyttarna, så resultatet går att mäta. */
function efterUppräting(draft: ProcessDraft, markerade: string[]) {
  const lo = layoutAp(compileAp(draft));
  const flyttar = rätaUppKopplingar(lo, markerade);
  const autoPositions = { ...draft.autoPositions };
  let steps = draft.steps;
  for (const f of flyttar) {
    if (steps.some((s) => s.id === f.id)) {
      steps = steps.map((s) => (s.id === f.id ? { ...s, position: f.position } : s));
    } else {
      autoPositions[f.id] = f.position;
    }
  }
  return {
    flyttar,
    lo: layoutAp(compileAp({ ...draft, steps, autoPositions })),
  };
}

/** Tre aktiviteter i rad, utan verksamhetsobjekt emellan: a1 → a2 → a3. */
const KEDJA = draftMed([
  steg("a1", "activity", "Tar emot ärendet", { ap: { output: null } }),
  steg("a2", "activity", "Bedömer ärendet", { ap: { output: null } }),
  steg("a3", "activity", "Avslutar ärendet", { ap: { output: null } }),
]);

/** KEDJA med ett objekt draget ur linje i höjdled. */
function medSnedställd(id: string, dy: number, dx = 0): ProcessDraft {
  const utgång = layoutAp(compileAp(KEDJA));
  const n = utgång.nodes.find((p) => p.node.id === id)!;
  return draftMed(
    KEDJA.steps.map((s) =>
      s.id === id ? { ...s, position: { x: n.x - n.dx + dx, y: n.y - n.dy + dy } } : s,
    ),
  );
}

describe("rätaUppKopplingar", () => {
  /**
   * Grundfallet: ett objekt i kedjan har dragits ur linje. Efter uppträtningen
   * ligger hela kedjans symboler på samma höjd igen.
   */
  it("lägger en snedställd kedja på EN vågrät linje", () => {
    const snett = medSnedställd("a2", 40);
    const före = layoutAp(compileAp(snett));
    expect(mitt(före, "a2").y).not.toBeCloseTo(mitt(före, "a1").y, 1);

    const ids = ["a1", "a2", "a3"];
    const { lo } = efterUppräting(snett, ids);
    const höjder = ids.map((id) => mitt(lo, id).y);
    for (const h of höjder) expect(h).toBeCloseTo(höjder[0], 5);
  });

  /**
   * FÄRST OBJEKT FLYTTAR. Ligger tre objekt rätt och ett fel är det det fjärde
   * som ska röra sig – inte alla fyra mot ett medelvärde. Därför medianen.
   */
  it("flyttar bara objektet som ligger fel", () => {
    const { flyttar } = efterUppräting(medSnedställd("a2", 40), ["a1", "a2", "a3"]);
    expect(flyttar.map((f) => f.id)).toEqual(["a2"]);
  });

  /** Ett redan rakt flöde ska inte röras alls. */
  it("ett rakt flöde ger inga flyttar", () => {
    const lo = layoutAp(compileAp(KEDJA));
    const ids = lo.nodes.map((n) => n.node.id);
    expect(rätaUppKopplingar(lo, ids)).toEqual([]);
  });

  /** Markeringen avgränsar: omarkerade objekt rörs aldrig. */
  it("rör inte objekt utanför markeringen", () => {
    // a3 är snedställd men OMARKERAD; a1–a2 ligger redan rakt.
    const snett = medSnedställd("a3", 40);
    const lo = layoutAp(compileAp(snett));
    expect(rätaUppKopplingar(lo, ["a1", "a2"])).toEqual([]);
  });

  it("rätar bara kopplingar INOM markeringen, inte ut ur den", () => {
    // a2 snedställd. Markerar man a2 och a3 rätas den kopplingen – och a1,
    // som ligger utanför, står kvar där den står.
    const snett = medSnedställd("a2", 40);
    const { flyttar, lo } = efterUppräting(snett, ["a2", "a3"]);
    expect(flyttar.map((f) => f.id)).not.toContain("a1");
    expect(mitt(lo, "a2").y).toBeCloseTo(mitt(lo, "a3").y, 5);
  });

  /** Färre än två markerade objekt kan inte ha en koppling emellan sig. */
  it("ett ensamt objekt ger inga flyttar", () => {
    const lo = layoutAp(compileAp(KEDJA));
    expect(rätaUppKopplingar(lo, ["a1"])).toEqual([]);
    expect(rätaUppKopplingar(lo, [])).toEqual([]);
  });

  /**
   * RIKTNINGEN läses ur lägena. Ett objekt som ligger rakt under sitt
   * föregående ska linjeras i sidled (lodrätt streck), inte dras upp i höjd.
   */
  it("ett objekt under sitt föregående linjeras i SIDLED, inte i höjdled", () => {
    const utgång = layoutAp(compileAp(KEDJA));
    const a1 = utgång.nodes.find((n) => n.node.id === "a1")!;
    const a2 = utgång.nodes.find((n) => n.node.id === "a2")!;
    // a2 rakt ner under a1, med 25 px snedhet i sidled.
    const under = draftMed(
      KEDJA.steps.map((s) =>
        s.id === "a2"
          ? { ...s, position: { x: a1.x - a1.dx + 25, y: a2.y - a2.dy + 320 } }
          : s,
      ),
    );
    const före = layoutAp(compileAp(under));
    const { flyttar, lo } = efterUppräting(under, ["a1", "a2"]);
    expect(flyttar.length).toBeGreaterThan(0);
    // Sidled rättas: symbolerna hamnar på samma lodräta linje …
    expect(mitt(lo, "a1").x).toBeCloseTo(mitt(lo, "a2").x, 5);
    // … och höjden rörs inte – de ska stå kvar över och under varandra.
    for (const id of ["a1", "a2"]) {
      expect(mitt(lo, id).y, `${id} drogs i höjdled`).toBeCloseTo(mitt(före, id).y, 5);
    }
  });

  /**
   * TVÅ objekt har ingen "rätt" av de två – de möts på mitten. Med en längre
   * kedja vinner däremot majoriteten (medianen), se testet ovan.
   */
  it("två markerade objekt möts på mitten", () => {
    const snett = medSnedställd("a2", 40);
    const före = layoutAp(compileAp(snett));
    const mål = (mitt(före, "a1").y + mitt(före, "a2").y) / 2;
    const { lo } = efterUppräting(snett, ["a1", "a2"]);
    expect(mitt(lo, "a1").y).toBeCloseTo(mål, 5);
    expect(mitt(lo, "a2").y).toBeCloseTo(mål, 5);
  });

  /**
   * KROCKVAKTEN: en triangel av kopplingar kan kräva att två objekt hamnar på
   * samma linje i båda led – alltså ovanpå varandra. Då offras den snedaste
   * kopplingen i stället.
   */
  it("lägger aldrig två objekt ovanpå varandra", () => {
    const triangel = draftMed([
      steg("a1", "activity", "Ett", { ap: { output: null } }),
      steg("a2", "activity", "Två", { ap: { output: null } }),
      steg("a3", "activity", "Tre", { ap: { output: null } }),
    ], {
      extraEdges: [{ source: "a3", target: "a1" }],
    });
    const ids = ["a1", "a2", "a3"];
    const { lo: efter } = efterUppräting(triangel, ids);
    const punkter = ids.map((id) => mitt(efter, id));
    for (let i = 0; i < punkter.length; i++) {
      for (let j = i + 1; j < punkter.length; j++) {
        const samma =
          Math.abs(punkter[i].x - punkter[j].x) < 0.5 &&
          Math.abs(punkter[i].y - punkter[j].y) < 0.5;
        expect(samma, `${ids[i]} och ${ids[j]} hamnade på samma punkt`).toBe(false);
      }
    }
  });
});
