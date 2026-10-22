/**
 * SVG-exporten för affärsprocesser.
 *
 * REGRESSION (skärm ↔ fil): exporten ropade `pickEdgeSides(a, b)` UTAN
 * layoutens förval medan canvasen skickade med det. In-objektets pil pekade
 * därför åt olika håll i appen och i filen. Båda läser nu `layout.sides`.
 */

import { describe, expect, it } from "vitest";
import { compileAp } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { apHörnradie, ikonPortRuta } from "./former";
import { layoutAp } from "./layout-affarsprocess";
import { renderApSvg } from "./svg-affarsprocess";

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 0, ...extra };
}
function draftMed(steps: DraftStep[]): ProcessDraft {
  return { ...emptyDraft(), title: "Test", lanes: [makeLane("Användare", 0)], steps };
}

describe("renderApSvg – användarens val följer med till filen", () => {
  const MED_ROLL = draftMed([
    steg("a1", "activity", "Genomför urval", {
      ap: { roller: [{ namn: "HR", huki: "U" }], output: null },
    }),
  ]);

  /**
   * REGRESSION: exporten läser bara layouten – den har ingen draft att fråga.
   * Valde man en kopplingspunkt på skärmen ritade filen ändå den automatiska,
   * och samma sak med en dragen brytpunkt. Nu bär layouten användarens val.
   */
  it("REGRESSION: en vald kopplingspunkt ritas likadant i filen", () => {
    const model = compileAp(MED_ROLL);
    const rel = model.relations.find((r) => r.kind === "huki")!;
    const styles = { [`${rel.source}->${rel.target}#U`]: { targetSide: "left" as const } };
    const lo = layoutAp(model, { edgeStyles: styles });
    const akt = lo.nodes.find((n) => n.node.id === "a1")!;
    const svg = renderApSvg(lo);

    // Någon väg SLUTAR i aktivitetens vänsterkant, mitt på höjden.
    const slut = [...svg.matchAll(/<path d="M[^"]*?([\d.]+),([\d.]+)"/g)].map((m) => ({
      x: +m[1],
      y: +m[2],
    }));
    const nära = (a: number, b: number) => Math.abs(a - b) <= 1.5;
    expect(
      slut.some((p) => nära(p.x, akt.x) && nära(p.y, akt.y + akt.h / 2)),
      `ingen väg slutar i vänsterkanten: ${JSON.stringify(slut)}`,
    ).toBe(true);
  });

  it("den andra brytpunkten ritas i filen också", () => {
    const model = compileAp(MED_ROLL);
    const rel = model.relations.find((r) => r.kind === "huki")!;
    const nyckel = `${rel.source}->${rel.target}#U`;
    // Sista sträckan finns bara när båda ändarna ligger på SAMMA axel. Rollen
    // står numera bredvid klustrets stam och kopplar ut åt sidan, så valet
    // "ut ur ikonens topp" görs uttryckligen här.
    const bas = { sourceSide: "top" as const, waypoint: { x: 300, y: 200 } };
    const en = renderApSvg(layoutAp(model, { edgeStyles: { [nyckel]: bas } }));
    const två = renderApSvg(
      layoutAp(model, { edgeStyles: { [nyckel]: { ...bas, waypoint2: { x: 20, y: 200 } } } }),
    );
    expect(två).not.toBe(en);
  });

  it("REGRESSION: en dragen brytpunkt ritas i filen också", () => {
    const model = compileAp(MED_ROLL);
    const rel = model.relations.find((r) => r.kind === "huki")!;
    const utan = renderApSvg(layoutAp(model));
    const med = renderApSvg(
      layoutAp(model, {
        edgeStyles: { [`${rel.source}->${rel.target}#U`]: { waypoint: { x: 300, y: 200 } } },
      }),
    );
    expect(med).not.toBe(utan);
    // Vägen ska VIKA vid brytpunkten. Koordinaten står inte längre ordagrant i
    // filen: knäna är rundade (apHörnradie), så hörnet ersätts av två punkter
    // och en båge en radie ut på varje ben. Testet mäter därför avsikten –
    // att vägen passerar tätt förbi punkten – i stället för strängen.
    const punkter = [...med.matchAll(/(\d+\.\d+),(\d+\.\d+)/g)].map((m) => ({
      x: +m[1],
      y: +m[2],
    }));
    const avstånd = Math.min(
      ...punkter.map((p) => Math.hypot(p.x - 300, p.y - 200)),
    );
    expect(avstånd, `ingen punkt nära brytpunkten: närmast ${avstånd.toFixed(1)} px`).toBeLessThanOrEqual(
      apHörnradie() + 1,
    );
  });
});

describe("renderApSvg", () => {
  it("REGRESSION: in-objektets pil lämnar objektets HÖGERKANT, precis som på skärmen", () => {
    const model = compileAp(
      draftMed([
        steg("a1", "activity", "Annonsera tjänst"),
        steg("a2", "activity", "Genomför urval", { ap: { input: "Ansökningar" } }),
      ]),
    );
    const lo = layoutAp(model);
    const inVo = lo.nodes.find((n) => n.node.id === "vo_in_a2")!;
    const svg = renderApSvg(lo);

    // Startpunkterna för alla vägar i filen. (Toleransen finns för att
    // routern kan lägga en port på halv pixel – testet handlar om VILKEN
    // kant pilen lämnar, inte om en halv pixel.)
    const starter = [...svg.matchAll(/<path d="M(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
      x: +m[1],
      y: +m[2],
    }));
    const nära = (a: number, b: number) => Math.abs(a - b) <= 1;

    // Porten sitter på SYMBOLEN, inte på etikettrutans kant (ikonPortRuta).
    const ikon = ikonPortRuta(inVo.node.kind, inVo.w, inVo.h)!;
    const ix = inVo.x + ikon.x;
    const iy = inVo.y + ikon.y;
    expect(
      starter.some((p) => nära(p.x, ix + ikon.w) && nära(p.y, iy + ikon.h / 2)),
      `ingen väg startar i symbolens högerkant: ${JSON.stringify(starter)}`,
    ).toBe(true);
    expect(
      starter.some((p) => nära(p.x, ix + ikon.w / 2) && nära(p.y, iy)),
      "pilen gick fortfarande ur överkanten",
    ).toBe(false);
  });
});

describe("renderApSvg – revisionsrutan", () => {
  const FLÖDE = draftMed([
    steg("a1", "activity", "Hämtar filer", { ap: { output: null } }),
  ]);

  it("stämplar figuren med version, datum och namn", () => {
    const lo = layoutAp(compileAp(FLÖDE));
    const svg = renderApSvg(lo, {
      revision: { version: "v6", datum: "2026-07-28T09:19:10.653Z", ändradAv: "Test Testsson" },
    });
    expect(svg).toContain("Version 6 · 2026-07-28");
    expect(svg).toContain("Justerad av Test Testsson");
    // Figuren växer på höjden så rutan får plats under utlägget.
    const höjd = Number(/height="([\d.]+)"/.exec(svg)![1]);
    expect(höjd).toBeGreaterThan(lo.height);
  });

  it("utan revision är exporten oförändrad", () => {
    const lo = layoutAp(compileAp(FLÖDE));
    expect(renderApSvg(lo, { revision: undefined })).toBe(renderApSvg(lo));
    expect(renderApSvg(lo)).not.toContain("Justerad av");
  });
});
