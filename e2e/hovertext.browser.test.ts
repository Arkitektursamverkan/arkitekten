/**
 * REGRESSION: bokstaven på en HUKI-koppling förklarade sig inte.
 *
 * "U" bredvid en gul roll säger ingenting för den som inte kan modelleringsreglerna
 * utantill. Förklaringen fanns (`relationHint`) men satt bara på det osynliga
 * svepet längs strecket – etiketten själv hade `pointer-events: none` och
 * ingen titel alls, så det man faktiskt pekar på var stumt (synpunkt 2026-09-04).
 *
 * Ett webbläsartest och inte ett enhetstest: felet var att etiketten inte gick
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
    for (const sel of [".ark-meny-kategori-titel", ".ark-meny-arende"]) {
      for (let varv = 0; varv < 4; varv++) {
        const stängda = page.locator(`${sel}:has(.ark-meny-pil:text-is("▸"))`);
        const antal = await stängda.count();
        if (!antal) break;
        for (let i = 0; i < antal; i++) await stängda.nth(0).click().catch(() => {});
        await page.waitForTimeout(150);
      }
    }
    // Sista flödet i menyn är en affärsprocess (kategorin ligger sist).
    await page.locator(".ark-flow-menyval").last().click();
    await page.waitForSelector(".ark-ap-nod", { timeout: 20_000 });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
  });

  it("HUKI-bokstaven bär sin egen förklaring och går att peka på", async () => {
    const bokstav = rigg.page.locator(".ark-edge-label").filter({ hasText: /^[HUKI]$/ }).first();
    expect(await bokstav.count()).toBe(1);

    const titel = await bokstav.getAttribute("title");
    // "U – Utför: ”Ekonom” utför ”Läser in filen i PM”"
    expect(titel).toMatch(/^[HUKI] – (Huvudansvar|Utför|Konsulteras|Informeras): /);

    // Utan pekbarhet visas ingen hovertext hur rätt den än är.
    expect(
      await bokstav.evaluate((el) => getComputedStyle(el).pointerEvents),
    ).not.toBe("none");
    await bokstav.hover(); // ska inte kastas: elementet tar emot pekaren
  });
});
