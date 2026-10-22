/**
 * REGRESSION i en riktig webbläsare: flyttknappen var osynlig.
 *
 * Att flytta en process mellan kategorier fanns hela tiden – knappen satt på
 * kortet – men den var `opacity: 0` tills pekaren råkade hamna där. Funktionen
 * fanns alltså bara för den som redan visste om den (synpunkt 2026-09-07). Det är
 * ett rent CSS-fel: DOM:en såg likadan ut hela tiden, så bara en riktig
 * webbläsare kan se skillnaden.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, flödenFingeravtryck, startaAppen } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("katalogens strukturknappar", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  const flödenFöre = flödenFingeravtryck();

  beforeAll(async () => {
    // Katalogen är monterad hela tiden men dold tills man öppnar den – vänta
    // på menyn och gå in via knappen, som en användare gör.
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    await rigg.page.getByRole("button", { name: /Processkatalog/ }).first().click();
    await rigg.page.waitForTimeout(500);
    // Katalogen visar en nivå i taget: gå ned tills korten syns.
    for (let i = 0; i < 4; i++) {
      if (await rigg.page.locator(".ark-kort").count()) break;
      await rigg.page.locator(".ark-nivarad-knapp").first().click();
      await rigg.page.waitForTimeout(300);
    }
    await rigg.page.waitForSelector(".ark-kort", { timeout: 20_000 });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    expect(flödenFingeravtryck(), "testerna ändrade flows/").toBe(flödenFöre);
  });

  it("flyttknappen syns på kortet utan att man först pekar på det", async () => {
    const synlighet = await rigg.page.evaluate(() => {
      const knapp = document.querySelector<HTMLElement>(".ark-kort-flytt");
      if (!knapp) return null;
      const cs = getComputedStyle(knapp);
      const r = knapp.getBoundingClientRect();
      return { opacity: Number(cs.opacity), display: cs.display, bredd: r.width };
    });
    expect(synlighet, "kortet har ingen flyttknapp alls").not.toBeNull();
    expect(synlighet!.display).not.toBe("none");
    expect(synlighet!.opacity, "knappen är osynlig tills man hovrar").toBeGreaterThan(0.2);
    expect(synlighet!.bredd).toBeGreaterThan(8);
  });

  it("toppen säger att strukturen går att ändra", async () => {
    const text = await rigg.page.textContent(".ark-katalog-hjalp");
    expect(text ?? "").toContain("Flytta en process");
  });

  it("knappen öppnar flyttdialogen med kategori och underkategori", async () => {
    await rigg.page.locator(".ark-kort-flytt").first().click();
    await rigg.page.waitForSelector(".ark-flyttadialog", { timeout: 10_000 });
    const etiketter = await rigg.page.$$eval(".ark-flyttadialog .ark-field-label", (n) =>
      n.map((e) => e.textContent?.trim() ?? ""),
    );
    expect(etiketter).toEqual(
      expect.arrayContaining(["Kategori i katalogen", "Underkategori"]),
    );
    // Avbryt – testet ska inte ändra de riktiga sparade flödena.
    await rigg.page.getByRole("button", { name: "Avbryt" }).click();
  });
});

/**
 * Samma flytt, men DÄR MAN STÅR: i den öppna processens huvud.
 *
 * Katalogens knapp fanns och var testad, och ändå fanns ingen väg för den som
 * satt i processen. Huvudet har därför samma knapp – och den prövas i en
 * riktig webbläsare, för det var just "syns den?" som var frågan.
 */
describe.skipIf(!chromium)("flytta från den öppna processen", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  const flödenFöre = flödenFingeravtryck();

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    for (const sel of [".ark-meny-kategori-titel", ".ark-meny-arende"]) {
      for (let varv = 0; varv < 4; varv++) {
        const stängda = rigg.page.locator(`${sel}:has(.ark-meny-pil:text-is("▸"))`);
        const antal = await stängda.count();
        if (!antal) break;
        for (let i = 0; i < antal; i++) await stängda.nth(0).click().catch(() => {});
        await rigg.page.waitForTimeout(150);
      }
    }
    await rigg.page.locator(".ark-flow-menyval").first().click();
    await rigg.page.waitForSelector(".react-flow__node-process", { timeout: 20_000 });
    await rigg.page.waitForTimeout(400);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    expect(flödenFingeravtryck(), "testerna ändrade flows/").toBe(flödenFöre);
  });

  it("knappen står i huvudet och öppnar samma dialog", async () => {
    const knapp = rigg.page.getByRole("button", { name: /Flytta i katalogen/ });
    expect(await knapp.count(), "ingen flyttknapp i processens huvud").toBe(1);
    await expect(knapp.first().isVisible()).resolves.toBe(true);

    await knapp.first().click();
    await rigg.page.waitForSelector(".ark-flyttadialog", { timeout: 10_000 });
    const nu = await rigg.page.textContent(".ark-flytta-nu");
    expect(nu ?? "", "dialogen säger inte var processen ligger nu").toContain("Ligger nu i");

    // Avbryt – testet ska inte ändra de riktiga sparade flödena.
    await rigg.page.getByRole("button", { name: "Avbryt" }).click();
  });
});
