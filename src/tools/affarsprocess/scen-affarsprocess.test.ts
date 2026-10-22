/**
 * Scenen som lämnar huset måste vara SAMMA bild som Arkitekten själv ritar.
 *
 * Scenen finns för att EA-portalen ska slippa äga layoutregler. Det löftet är
 * bara värt något så länge scenen och exportören håller ihop – och det är
 * precis en sådan glidning (skärm mot fil) som en gång tvingade fram
 * invariant 1. Testerna nedan låser ihop dem.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import type { SavedFlow } from "@/core/flow-store";
import { byggApScen, byggUtlägg } from "./scen-affarsprocess";
import { apFigurer } from "./figurer";
import { renderApSvg } from "./svg-affarsprocess";

/** Affärsprocesserna på disk. Saknas de (tom kassering) finns inget att bevaka. */
function apFlöden(): { fil: string; flöde: SavedFlow }[] {
  if (!fs.existsSync("flows")) return [];
  return fs
    .readdirSync("flows")
    .filter((f) => f.startsWith("ap-") && f.endsWith(".json"))
    .sort()
    .map((fil) => ({
      fil,
      flöde: JSON.parse(fs.readFileSync(`flows/${fil}`, "utf8")) as SavedFlow,
    }));
}

const FLÖDEN = apFlöden();

describe("affärsprocessscenen", () => {
  /**
   * REGRESSION: kanterna måste ruttas av edge-routern och INGEN annanstans.
   * Skrivs rutten av – i scenbyggaren, i tjänsten eller hos mottagaren – ritar
   * portalen en annan väg än exporten, och felet upptäcks först när någon
   * jämför en skärmbild med en exporterad fil. Det här testet gör jämförelsen
   * varje gång i stället.
   */
  it.each(FLÖDEN)("$fil: varje bana är exportörens bana", ({ flöde }) => {
    const scen = byggApScen(flöde);
    // Samma utlägg som scenen kom ur – annars jämförs två saker som råkar bli
    // lika i stället för en sak med sig själv.
    const { lo, textScale } = byggUtlägg(flöde);
    const svg = renderApSvg(lo, { textScale });
    const iSvg = new Set(Array.from(svg.matchAll(/ d="([^"]+)"/g), (m) => m[1]));

    const saknade = scen.kanter.filter((k) => !iSvg.has(k.d)).map((k) => k.id);
    expect(saknade).toEqual([]);
  });

  /**
   * REGRESSION: kontraktet lovar att mottagaren aldrig behöver efterberäkna
   * något. Tappas nodens färdiga SVG bort – eller markörerna den refererar
   * till – tvingas portalen rita om formerna själv, och då är hela poängen med
   * scenen borta.
   */
  it.each(FLÖDEN)("$fil: varje objekt bär färdig form, och markörerna följer med", ({ flöde }) => {
    const scen = byggApScen(flöde);
    expect(scen.defs).toContain("ap-arrow-flode");
    // En markör per ansvarstyp – de har var sin färg.
    expect(scen.defs).toContain("ap-arrow-huki-U");
    expect(scen.defs).toContain("ap-arrow-huki-I");
    for (const n of scen.noder) {
      expect(n.svg, `${n.id} saknar form`).not.toBe("");
      expect(n.w).toBeGreaterThan(0);
      expect(n.h).toBeGreaterThan(0);
    }
    // Varje kant pekar på en markör som verkligen finns i defs.
    for (const k of scen.kanter) {
      // Kanten PEKAR UT sin markör – mottagaren ska aldrig gissa den ur typen.
      expect(k.markör, `${k.id} saknar markör`).toBeTruthy();
      expect(scen.defs, `${k.id} pekar på okänd markör ${k.markör}`).toContain(
        `id="${k.markör}"`,
      );
    }
  });

  /**
   * Invariant 9: status och beteckning HÄRLEDS ur historiken. Scenen skickar
   * med dem som avläst värde – räknar någon om dem i portalen glider siffran
   * från statusen den beskriver.
   */
  it("visar den fastslagna versionen när en sådan finns", () => {
    const medFastslagen = FLÖDEN.find((f) => (f.flöde.versions ?? []).some((v) => v.status === "fastslagen"));
    if (!medFastslagen) return; // alla affärsprocesser är utkast i dag – regeln ska ändå tåla det
    const scen = byggApScen(medFastslagen.flöde);
    expect(scen.flöde.status).toBe("fastslagen");
  });

  /**
   * Teckenförklaringen följer med ut. Utan den kan portalen inte förklara sin
   * egen bild: affärsprocessens ansvarslinjer bär HUKI-bokstaven i FÄRGEN och skriver
   * aldrig ut den, så en gul linje går inte att slå upp någonstans hos
   * mottagaren.
   */
  it.each(FLÖDEN)("$fil: figurförteckningen följer med i scenen", ({ flöde }) => {
    const scen = byggApScen(flöde);
    const grupper = scen.figurer ?? [];
    expect(grupper.length).toBeGreaterThan(0);
    expect(grupper.map((g) => g.titel)).toContain("Objekt");

    for (const g of grupper) {
      for (const f of g.figurer) {
        // Symbolen kommer FÄRDIG – annars måste mottagaren rita om den.
        expect(f.svg, `${f.nyckel} saknar form`).not.toBe("");
        expect(f.w).toBeGreaterThan(0);
        expect(f.h).toBeGreaterThan(0);
        expect(f.namn).toBeTruthy();
        expect(f.betydelse).toBeTruthy();
        expect(f.antal).toBeGreaterThan(0);
        /**
         * Fragmentet är SJÄLVSTÄNDIGT. Refererade det en markör i `defs` skulle
         * pilspetsen försvinna så fort portalen ritar förklaringen utanför
         * scenens egen <svg> – och det är precis vad en faktaruta i ett
         * sidopanelsläge gör.
         */
        expect(f.svg).not.toContain("url(#");
      }
    }
  });

  /**
   * EN REGEL, EN PLATS: portalens förklaring och appens faktaruta är samma
   * lista. Byggde scenen en egen kunde de förklara samma symbol olika.
   */
  it.each(FLÖDEN)("$fil: scenens förteckning är appens förteckning", ({ flöde }) => {
    const scen = byggApScen(flöde);
    const { modell } = byggUtlägg(flöde);
    expect(scen.figurer).toEqual(apFigurer(modell));
  });

  it("kan bygga en scen ur flödets aktuella innehåll", () => {
    if (!FLÖDEN.length) return;
    const scen = byggApScen(FLÖDEN[0].flöde, { version: "aktuell" });
    expect(scen.format).toBe("ark-scen");
    expect(scen.noder.length).toBeGreaterThan(0);
  });
});
