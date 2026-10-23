/**
 * REGRESSION: två processer ritades ovanpå varandra.
 *
 * Verktygen ligger som lager i arbetsytan och lever hela sessionen – det är
 * det som gör att man kan hoppa mellan ett flödesschema och en affärsprocess
 * utan att tappa zoom och läge. Det inaktiva lagret döljs med `visibility`,
 * men `visibility` ÄRVS och kan tas tillbaka av ett barn: React Flow sätter
 * `visibility: visible` på sina noder. Följden var att flödesschemats pooler
 * och rutor lyste igenom under affärsprocessen, och skärmen visade två
 * processer samtidigt (iakttagelse 2026-09-04).
 *
 * Enhetstesterna kan inte se det här: DOM:en är identisk, det är den ärvda
 * synligheten som skiljer. Därför ett webbläsartest.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen, öppnaUrMenyn } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("arbetsytans lager", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;


  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
  });

  it("ett dolt verktygslager syns inte – inte heller dess React Flow-noder", async () => {
    const { page } = rigg;

    // 1. Ett flödesschema (React Flow) …
    await öppnaUrMenyn(page, "Beställ behörighet");
    await page.waitForSelector(".react-flow__node-pool", { timeout: 20_000 });

    // 2. … och sedan en affärsprocess, som monterar ett ANDRA lager.
    await öppnaUrMenyn(page, "Rekrytering");
    await page.waitForSelector(".ark-ap-nod", { timeout: 20_000 });

    const lager = await page.evaluate(() =>
      [...document.querySelectorAll(".ark-verktygslager")].map((el) => ({
        dolt: getComputedStyle(el).visibility === "hidden",
        // Ättlingar som ritas trots att lagret är dolt – det var felet.
        synligaÄttlingar: [...el.querySelectorAll("*")].filter(
          (b) => getComputedStyle(b).visibility === "visible",
        ).length,
      })),
    );

    expect(lager.length).toBe(2); // båda verktygen lever kvar
    const dolda = lager.filter((l) => l.dolt);
    expect(dolda.length).toBe(1);
    expect(dolda[0].synligaÄttlingar).toBe(0);
  });
});
