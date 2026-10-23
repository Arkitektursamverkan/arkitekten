/**
 * REGRESSION: en HUKI-koppling förklarade sig inte.
 *
 * "U" bredvid en gul roll säger ingenting för den som inte kan modelleringsreglerna
 * utantill. Förklaringen fanns (`relationHint`) men satt där pekaren inte kom
 * åt den – det man faktiskt pekade på var stumt (synpunkt 2026-09-04).
 *
 * Bokstaven skrivs numera inte ut alls (beslut 2026-09-07, `apRelationEtikett`):
 * ansvarslinjen bär betydelsen med sin färg. Då är STRECKET det man pekar på,
 * och förklaringen måste sitta där – på ett svep som tar emot pekaren längs
 * linjen.
 *
 * Ett webbläsartest och inte ett enhetstest: felet var att förklaringen inte gick
 * att PEKA PÅ, och det syns bara i en riktig layout.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("hovertext på affärsprocessens kopplingar", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    const { page } = rigg;
    // Exempelpaketets affärsprocess, öppnad ur menyn (sökningen fäller ut grenen).
    await page.fill(".ark-meny-filter", "Rekrytering");
    await page.locator(".ark-flow-menyval", { hasText: "Rekrytering" }).click();
    await page.waitForSelector(".ark-ap-nod", { timeout: 20_000 });
    await page.waitForTimeout(600);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
  });

  it("HUKI-strecket bär sin förklaring och går att peka på", async () => {
    const { page } = rigg;
    // En punkt mitt på varje svep med en HUKI-förklaring, i skärmkoordinater.
    const svep = await page.evaluate(() =>
      [...document.querySelectorAll<SVGPathElement>("path.ark-edge-hint")]
        .map((p) => {
          const titel = p.querySelector("title")?.textContent ?? "";
          const pt = p.getPointAtLength(p.getTotalLength() / 2);
          const s = new DOMPoint(pt.x, pt.y).matrixTransform(p.getScreenCTM()!);
          return { titel, pekare: getComputedStyle(p).pointerEvents, x: s.x, y: s.y };
        })
        .filter((s) => /^[HUKI] – /.test(s.titel)),
    );
    expect(svep.length, "ingen HUKI-koppling bär en förklaring").toBeGreaterThan(0);
    // "U – Utför: ”Rekryterande chef” utför ”Ta fram kravprofil”"
    for (const s of svep) {
      expect(s.titel).toMatch(/^[HUKI] – (Huvudansvar|Utför|Konsulteras|Informeras): /);
      // Träffytan ligger på STRECKET – annars äter svepet klick i hela sin ruta.
      expect(s.pekare).toBe("stroke");
    }

    // Utan pekbarhet visas ingen hovertext hur rätt den än är: mitt på
    // strecket ska det översta elementet vara ett svep med en HUKI-förklaring.
    const träffar = await page.evaluate(
      (punkter) =>
        punkter.map(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return el?.matches("path.ark-edge-hint")
            ? (el.querySelector("title")?.textContent ?? "")
            : "";
        }),
      svep.map(({ x, y }) => ({ x, y })),
    );
    expect(
      träffar.filter((t) => /^[HUKI] – /.test(t)).length,
      "ingen HUKI-förklaring går att peka på",
    ).toBeGreaterThan(0);
    expect(rigg.fel).toEqual([]);
  });
});
