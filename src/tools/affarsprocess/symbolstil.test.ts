/**
 * Symbolstilen: standardstilen är neutral, ett paket kan byta färger, typsnitt
 * och aktörssymbol, och ett paket kan aldrig smuggla in markup i SVG:n.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { ApNode } from "@/core/affarsprocess";
import { apMarkerDefs, apNodeSvg, apHörnradie, apShapeSvg } from "./former";
import { NEUTRAL_STIL, läsSymbolstil, sättSymbolstil, symbolstil } from "./symbolstil";

afterEach(() => sättSymbolstil(null));

const aktivitet = { id: "a", kind: "aktivitet", label: "Genomför urval", sourceIndex: 0 } as ApNode;

describe("standardstilen", () => {
  it("är aktiv utan val, med en person som aktörssymbol och utan skugga", () => {
    expect(symbolstil().id).toBe("neutral");
    expect(apShapeSvg("roll", 60, 50)).toContain("<circle");
    expect(apShapeSvg("aktivitet", 120, 50).match(/<rect/g)).toHaveLength(1);
  });
});

describe("ett stilpaket", () => {
  const paket = {
    id: "egen",
    namn: "Egen stil",
    teckensnitt: "Georgia, serif",
    former: { aktivitet: { fill: "#123456" } },
    huki: { I: "#abcdef" },
    hörnradie: 9,
    skugga: true,
    aktör: "arbetsplats",
  };

  it("byter det som anges och tar resten ur standardstilen", () => {
    const stil = läsSymbolstil(paket);
    expect(stil.former.aktivitet.fill).toBe("#123456");
    expect(stil.former.aktivitet.stroke).toBe(NEUTRAL_STIL.former.aktivitet.stroke);
    expect(stil.huki.I).toBe("#abcdef");
    expect(stil.huki.H).toBe(NEUTRAL_STIL.huki.H);
  });

  it("slår igenom i formerna, typsnittet, pilspetsarna och hörnradien", () => {
    sättSymbolstil(läsSymbolstil(paket));
    const svg = apNodeSvg(aktivitet, 0, 0, 120, 50);
    expect(svg).toContain("#123456");
    expect(svg).toContain('font-family="Georgia, serif"');
    // Skuggan är en andra ruta under aktiviteten.
    expect(apShapeSvg("aktivitet", 120, 50).match(/<rect/g)).toHaveLength(2);
    expect(apShapeSvg("roll", 60, 50)).not.toContain("<circle");
    expect(apMarkerDefs()).toContain("#abcdef");
    expect(apHörnradie()).toBe(9);
  });

  it("REGRESSION-skydd: en färg eller ett typsnitt med markup avvisas", () => {
    expect(() => läsSymbolstil({ ...paket, former: { aktivitet: { fill: '"/><script>x</script>' } } })).toThrow(/färg/);
    expect(() => läsSymbolstil({ ...paket, teckensnitt: 'Arial" onload="x' })).toThrow(/typsnitt/);
    expect(() => läsSymbolstil({ ...paket, id: "../stigen" })).toThrow(/id/);
    expect(() => läsSymbolstil({ ...paket, aktör: "robot" })).toThrow(/aktörssymbol/);
    expect(() => läsSymbolstil({ ...paket, hörnradie: 500 })).toThrow(/Hörnradien/);
  });
});
