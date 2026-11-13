/**
 * Symbolstilen: standardstilen är neutral, ett paket kan byta färger, typsnitt
 * och aktörssymbol, och ett paket kan aldrig smuggla in markup i SVG:n.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { ApNode } from "@/core/affarsprocess";
import { apKontur, apMarkerDefs, apNodeSvg, apHörnradie, apShapeSvg } from "./former";
import { STANDARDSYMBOLER } from "./standardsymboler";
import { läsSymbol } from "./symbolform";
import { NEUTRAL_STIL, läsSymbolstil, sättSymbolstil, symbolstil } from "./symbolstil";

afterEach(() => sättSymbolstil(null));

const aktivitet = { id: "a", kind: "aktivitet", label: "Genomför urval", sourceIndex: 0 } as ApNode;

describe("standardstilen", () => {
  it("är aktiv utan val, med en person som aktörssymbol och utan skugga", () => {
    expect(symbolstil().id).toBe("neutral");
    expect(apShapeSvg("roll", 60, 50)).toContain("<circle");
    expect(apShapeSvg("aktivitet", 120, 50).match(/<rect/g)).toHaveLength(1);
  });

  it("har en symbol för varje sort, och varje symbol går att läsa som ett pakets", () => {
    for (const [nyckel, symbol] of Object.entries(STANDARDSYMBOLER)) {
      // Samma prövning som ett paket får – produktens symboler är ett giltigt exempel.
      expect(läsSymbol(JSON.parse(JSON.stringify(symbol)), nyckel)).toEqual(symbol);
      const [sort, variant] = nyckel.split(":");
      expect(apShapeSvg(sort as ApNode["kind"], 120, 60, variant)).not.toBe("");
    }
    expect(apShapeSvg("vo", 60, 32, "dokument")).not.toBe(apShapeSvg("vo", 60, 32));
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
  };

  /** Ett paket med egna symboler: en rund aktör, en egen pilspets och en rund forumsymbol. */
  const medSymboler = {
    ...paket,
    symboler: {
      roll: [{ form: "ellips", x: [0, 0.5], y: 14, rx: 12, ry: 9, linje: "linje", bredd: 2 }],
      krav: [{ form: "polygon", punkter: [{ min: [16, [0, 0.18]] }, 1, [-1, 1], [0, 0, 0.5], 1, [-1, 0, 1]], fyll: "#00ff00" }],
      risk: [{ form: "tecken", x: [0, 0.5], y: 20, tecken: "<!>", storlek: 12 }],
    },
    pilspets: ["M", 0, 0, "L", 10, 5, "L", 0, 10, "Z"],
    forumKontur: "ellips",
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
    expect(apMarkerDefs()).toContain("#abcdef");
    expect(apHörnradie()).toBe(9);
  });

  it("egna symboler ersätter produktens – sort för sort – och måtten räknas ur rutans bredd och höjd", () => {
    const standardAktivitet = apShapeSvg("aktivitet", 120, 50);
    sättSymbolstil(läsSymbolstil(medSymboler));
    // Rollen är paketets ellips, mitt i rutan, i stilens linjefärg.
    expect(apShapeSvg("roll", 60, 50)).toBe(
      `<ellipse cx="30" cy="14" rx="12" ry="9" fill="${NEUTRAL_STIL.former.roll.fill}" stroke="${NEUTRAL_STIL.former.roll.stroke}" stroke-width="2"/>`,
    );
    // min(16, 18 % av bredden), högerkanten och halva höjden.
    expect(apShapeSvg("krav", 50, 40)).toContain('points="9,1 49,20 1,39"');
    expect(apShapeSvg("krav", 200, 40)).toContain('points="16,1 199,20 1,39"');
    // En sort paketet inte nämner ritas som förut (här med paketets skugga).
    expect(apShapeSvg("aktivitet", 120, 50)).toContain(standardAktivitet.replace(NEUTRAL_STIL.former.aktivitet.fill, "#123456"));
    // Pilspetsen och forumets kontur följer paketet.
    expect(apMarkerDefs()).toContain('d="M 0 0 L 10 5 L 0 10 Z"');
    expect(apKontur("forum", 120, 70, 10).botten).toBeLessThan(apKontur("forum", 120, 70, 60).botten);
    sättSymbolstil(null);
    expect(apKontur("forum", 120, 70, 10).botten).toBe(apKontur("forum", 120, 70, 60).botten);
  });

  it("REGRESSION-skydd: en symbol kan inte bära markup – tecken kodas, allt annat är tal och kända ord", () => {
    sättSymbolstil(läsSymbolstil(medSymboler));
    expect(apShapeSvg("risk", 60, 32)).toContain(">&lt;!&gt;</text>");
    const med = (symboler: unknown) => () => läsSymbolstil({ ...paket, symboler });
    expect(med({ roll: [{ form: "bana", d: ["M", 0, 0, 'L"/><script>', 1, 1] }] })).toThrow(/kommando/);
    expect(med({ roll: [{ form: "bana", d: ["M", "0", "0"] }] })).toThrow(/kommando/);
    expect(med({ roll: [{ form: "cirkel", x: "1\" onload=\"x", y: 1, r: 1 }] })).toThrow(/mått/);
    expect(med({ roll: [{ form: "cirkel", x: 1, y: 1, r: 1, fyll: "url(#x)" }] })).toThrow(/färg/);
    expect(med({ roll: [{ form: "script" }] })).toThrow(/Okänd form/);
    expect(med({ roll: [{ form: "tecken", x: 1, y: 1, tecken: "<script>", storlek: 12 }] })).toThrow(/tecken/);
    expect(med({ robot: [] })).toThrow(/Okänd symbol/);
    expect(med({ roll: Array(30).fill({ form: "cirkel", x: 1, y: 1, r: 1 }) })).toThrow(/högst/);
    expect(med({ roll: [{ form: "cirkel", x: 1e9, y: 1, r: 1 }] })).toThrow(/tal/);
    expect(() => läsSymbolstil({ ...paket, pilspets: ["M", [0, 1], 0] })).toThrow(/Pilspetsen/);
    expect(() => läsSymbolstil({ ...paket, forumKontur: "stjärna" })).toThrow(/forumkontur/);
    // Okända fält på en ritdel följer inte med.
    const stil = läsSymbolstil({ ...paket, symboler: { roll: [{ form: "cirkel", x: 1, y: 1, r: 1, onload: "x" }] } });
    expect(JSON.stringify(stil.symboler)).not.toContain("onload");
  });

  it("REGRESSION-skydd: en färg eller ett typsnitt med markup avvisas", () => {
    expect(() => läsSymbolstil({ ...paket, former: { aktivitet: { fill: '"/><script>x</script>' } } })).toThrow(/färg/);
    expect(() => läsSymbolstil({ ...paket, teckensnitt: 'Arial" onload="x' })).toThrow(/typsnitt/);
    expect(() => läsSymbolstil({ ...paket, id: "../stigen" })).toThrow(/id/);
    expect(() => läsSymbolstil({ ...paket, hörnradie: 500 })).toThrow(/Hörnradien/);
  });
});
