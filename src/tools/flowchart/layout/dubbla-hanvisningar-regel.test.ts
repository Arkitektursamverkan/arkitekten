/**
 * Regeln i `döljDubblaHänvisningar` prövad på SYNTETISKA data – modellen och
 * utlägget byggs för hand, så att testet inte behöver någon installations
 * flöden (invariant 12). Det täcker det som förr bevakades på ett riktigt flöde.
 */

import { describe, expect, it } from "vitest";
import type { ProcessModel } from "@/core/model";
import type { LaidOutPageRef, LayoutResult } from "./layout";
import { döljDubblaHänvisningar } from "./dubbla-hanvisningar";

const modell = (kanter: Array<[string, string, string?]>) =>
  ({ edges: kanter.map(([source, target, label], i) => ({ id: `e${i}`, source, target, ...(label ? { label } : {}) })) }) as unknown as ProcessModel;

const märke = (nodeId: string, edgeSource: string, edgeTarget: string, sida: "in" | "ut", text: string): LaidOutPageRef => ({
  nodeId,
  edgeSource,
  edgeTarget,
  sida,
  text,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  page: 1,
  fromX: 0,
  fromY: 0,
  toX: 0,
  toY: 0,
});
const utlägg = (pageRefs: LaidOutPageRef[]) => ({ pageRefs }) as unknown as LayoutResult;

describe("dubbla sidhänvisningar (syntetiskt)", () => {
  /**
   * REGRESSION: en beslutsruta fick två identiska "från del 2" staplade på
   * varandra – ett från sekvenspilen s10→s11 och ett från datalagrets
   * streckade association s9→s11 över samma snitt. Regeln fanns bara i ett
   * skript, och testet som bevakade den läste en installations flöde som inte
   * ligger i git – så sedan omgång 3 bevakades den inte alls i repot.
   */
  it("REGRESSION: behåller sekvenspilens märke och döljer artefaktens", () => {
    const m = modell([["s10", "s11"]]);
    const lay = utlägg([märke("s11", "s9", "s11", "in", "från del 2"), märke("s11", "s10", "s11", "in", "från del 2")]);
    expect(döljDubblaHänvisningar(m, lay)).toEqual({ "s9->s11": { hideRefIn: true } });
  });

  it("utgående märken döljs med hideRefOut", () => {
    const m = modell([["s3", "s7"]]);
    const lay = utlägg([märke("s3", "s3", "s7", "ut", "till del 3"), märke("s3", "s3", "d1", "ut", "till del 3")]);
    expect(döljDubblaHänvisningar(m, lay)).toEqual({ "s3->d1": { hideRefOut: true } });
  });

  it("etiketten följer med i nyckeln – två pilar kan dela nodpar (invariant 3)", () => {
    const m = modell([["b1", "s5", "Ja"]]);
    const lay = utlägg([märke("s5", "b1", "s5", "in", "från del 1"), märke("s5", "x", "s5", "in", "från del 1")]);
    expect(döljDubblaHänvisningar(m, lay)).toEqual({ "x->s5": { hideRefIn: true } });
    // Två sekvenspilar med etikett: den första behålls, den andra döljs med etiketten i nyckeln.
    const m2 = modell([["b1", "s5", "Ja"], ["b2", "s5", "Nej"]]);
    const lay2 = utlägg([märke("s5", "b1", "s5", "in", "från del 1"), märke("s5", "b2", "s5", "in", "från del 1")]);
    expect(döljDubblaHänvisningar(m2, lay2)).toEqual({ "b2->s5#Nej": { hideRefIn: true } });
  });

  it("utan sekvenspil behålls det första märket", () => {
    const lay = utlägg([märke("s2", "d1", "s2", "in", "från del 1"), märke("s2", "d2", "s2", "in", "från del 1")]);
    expect(döljDubblaHänvisningar(modell([]), lay)).toEqual({ "d2->s2": { hideRefIn: true } });
  });

  it("olika text, olika nod eller olika sida är inga dubbletter", () => {
    const m = modell([["s1", "s2"]]);
    const lay = utlägg([
      märke("s2", "s1", "s2", "in", "från del 1"),
      märke("s2", "d1", "s2", "in", "från del 3"),
      märke("s4", "d1", "s4", "in", "från del 1"),
      märke("s2", "s2", "s9", "ut", "från del 1"),
    ]);
    expect(döljDubblaHänvisningar(m, lay)).toEqual({});
  });
});
