// @vitest-environment happy-dom
/**
 * Bildredigerarens hjälp att hitta rätt: verktyg som kräver en FIGUR tänder
 * figurerna det går att använda på.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TOM_RAMSCEN, nyFigur, standardScen, type Scen } from "@/core/ram-scen";
import { ScenBild } from "./ScenBild";
import { tändaFigurer, type ScenVerktyg } from "./ScenRedigerare";

const scen: Scen = {
  ...standardScen(),
  figurer: [
    nyFigur("person", "Enhetschef", 400, 650),
    nyFigur("dokument", "Agenda", 600, 630),
    nyFigur("person", "Dold", 800, 650),
  ],
};
const [chef, agenda, dold] = scen.figurer.map((f) => f.id);
const rs = {
  ...TOM_RAMSCEN,
  dolda: [dold],
  markeringar: [{ figur: agenda, verktyg: "farg" as const, färg: "#e8590c" }],
};
const tända = (v: ScenVerktyg) => [...tändaFigurer(v, scen, rs)].sort();

describe("tändaFigurer – vilka figurer verktyget går att använda på", () => {
  /**
   * REGRESSION: verktyg som bara verkar på en figur gav ingen ledning – man
   * klickade på en ledig plats och ingenting hände (2026-10-13, först om
   * Pratbubbla, sedan "gör samma för de andra verktygen").
   */
  it("REGRESSION: figurverktygen tänder de synliga figurerna", () => {
    for (const v of ["farg", "blink", "puls", "koppla", "bubbla"] as const) {
      expect(tända(v), v).toEqual([chef, agenda].sort());
    }
  });

  it("Visa/dölj tänder även de dolda, Sudda bara figurer med något att sudda", () => {
    expect(tända("dolj")).toEqual([chef, agenda, dold].sort());
    expect(tända("sudd")).toEqual([agenda]);
  });

  it("verktyg som inte kräver en figur tänder ingenting", () => {
    for (const v of ["flytta", "textruta", "pulspunkt", "tabort"] as const) expect(tända(v), v).toEqual([]);
  });
});

describe("ScenBild – tända figurer", () => {
  it("ritar en tänd ram per figur i mängden, men aldrig i presentationen", () => {
    const set = new Set([chef, agenda]);
    const med = render(<ScenBild scen={scen} rs={rs} läge="redigera" prefix="t1" tända={set} visaDolda={false} />);
    expect(med.container.querySelectorAll(".ark-scen-tand")).toHaveLength(2);
    med.unmount();
    const visa = render(<ScenBild scen={scen} rs={rs} läge="visa" prefix="t2" tända={set} />);
    expect(visa.container.querySelectorAll(".ark-scen-tand")).toHaveLength(0);
  });
});
