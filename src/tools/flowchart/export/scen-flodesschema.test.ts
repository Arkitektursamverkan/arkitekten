/**
 * Systemprocessens scen måste vara SAMMA bild som SVG-exporten ritar – samma
 * löfte som `tools/affarsprocess/scen-affarsprocess.test.ts` håller för Affärsprocess. Glider de
 * isär visar EA-portalen en annan bild än den som står i styrdokumentet.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import type { SavedFlow } from "@/core/flow-store";
import { textToDraft } from "../parser/toDraft";
import { byggFlödesScen, byggFlödesUtlägg } from "./scen-flodesschema";
import { renderSvgSized } from "./svg";

const TEXT = `Driftfråga ny
Fel uppkommer → Användare → Fyller i formulär → System sparar ärendet (↓ Om prioritet = Hög → Handläggare larmas) → Handläggare tar emot ärendet`;

function exempel(): SavedFlow {
  const draft = textToDraft(TEXT);
  return {
    id: "driftfraga-ny",
    name: "Driftfråga ny",
    savedAt: "2026-10-22T08:00:00.000Z",
    rawText: TEXT,
    draft,
    view: { perspective: "system", pageFormat: "free", scale: 1, spacing: 1, textScale: 1 },
    versions: [{ savedAt: "2026-10-22T08:00:00.000Z", rawText: TEXT, draft, status: "fastslagen" }],
  } as SavedFlow;
}

/** Systemprocesserna på disk. Saknas de finns inget mer att bevaka. */
function flöden(): { fil: string; flöde: SavedFlow }[] {
  if (!fs.existsSync("flows")) return [];
  return fs
    .readdirSync("flows")
    .filter((f) => !f.startsWith("ap-") && f.endsWith(".json"))
    .sort()
    .map((fil) => ({ fil, flöde: JSON.parse(fs.readFileSync(`flows/${fil}`, "utf8")) as SavedFlow }));
}

const ALLA = [{ fil: "exempel", flöde: exempel() }, ...flöden()];

describe("Systemprocessens scen", () => {
  /**
   * Kanter, banor, artefakter och etiketter ska stå tecken-för-tecken i
   * exportörens SVG, ritad ur samma utlägg. Skrivs någon regel av i
   * scenbyggaren upptäcks det här, inte i portalen.
   */
  it.each(ALLA)("$fil: scenen är exportörens bild", ({ flöde }) => {
    const scen = byggFlödesScen(flöde, { version: "aktuell" });
    const { lo, modell, textScale } = byggFlödesUtlägg(flöde, { version: "aktuell" });
    const svg = renderSvgSized(modell, lo, "type", textScale).svg;

    const iSvg = new Set(Array.from(svg.matchAll(/ d="([^"]+)"/g), (m) => m[1]));
    expect(scen.kanter.filter((k) => !iSvg.has(k.d)).map((k) => k.id)).toEqual([]);
    for (const k of scen.kanter) if (k.etikettSvg) expect(svg).toContain(k.etikettSvg);
    expect(svg).toContain(scen.bakgrund!);
    expect(svg).toContain(scen.artefakter!);
    expect(svg).toContain(`<defs>${scen.defs}</defs>`);
  });

  it("varje objekt bär färdig form i lokala koordinater", () => {
    const scen = byggFlödesScen(exempel());
    expect(scen.familj).toBe("flodesschema");
    expect(scen.noder.length).toBeGreaterThan(3);
    for (const n of scen.noder) {
      expect(n.svg, `${n.id} saknar form`).not.toBe("");
      // Lokalt: formen börjar i origo, placeringen står i x/y.
      expect(n.svg).not.toContain(`x="${n.x}"`);
    }
    for (const k of scen.kanter) expect(scen.defs).toContain(`id="${k.markör}"`);
    expect(scen.figurer?.length).toBeGreaterThan(0);
  });

  it("visar den fastslagna versionen och dess beteckning", () => {
    const scen = byggFlödesScen(exempel());
    expect(scen.flöde.status).toBe("fastslagen");
    expect(scen.flöde.beteckning).toBe("1.0");
  });
});
