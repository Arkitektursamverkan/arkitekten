/**
 * KONTROLLEN och SKÄRMARNA: flödet och bilden på halva skärmen var, eller på
 * varsin skärm, styrt från huvudfönstret (krav 2026-09-30: "kontrollen som
 * gör att jag kan visa Flöde och Bild på t.ex. halva skärmen var").
 *
 * Serien skapas men sparas aldrig – ramar/ och flows/ ska vara orörda.
 */

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen } from "./harness";

const chromium = findChromium();
const ramarFingeravtryck = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().join(",") : "");

describe.skipIf(!chromium)("Ramar – kontrollen och skärmarna", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  let ramarFöre = "";

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    ramarFöre = ramarFingeravtryck(rigg.data.ramarDir);
    const { page } = rigg;
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.getByRole("button", { name: /Visualisering/ }).first().click();
    await page.waitForTimeout(800);
    await page.selectOption('select[aria-label="Process"]', "ap-demo-uthyrning-ordinarie");
    await page.fill('input[aria-label="Seriens namn"]', "Prov (sparas inte)");
    await page.getByRole("button", { name: "Skapa" }).click();
    await page.waitForTimeout(1000);
    // Två ramar att bläddra mellan.
    await page.locator(".ark-ramar-lista button", { hasText: /^✚ Ny$/ }).click();
    await page.waitForTimeout(200);
    await page.locator(".ark-ramar-lista li").first().click();
    await page.waitForTimeout(200);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (rigg) expect(rigg.flöden(), "testet ändrade flows/").toBe(rigg.flödenFöre);
    if (rigg) expect(ramarFingeravtryck(rigg.data.ramarDir), "testet sparade en ramserie").toBe(ramarFöre);
  });

  it("REGRESSION: en skärm visar flöde och bild på halva skärmen var – och kontrollen byter vy och bläddrar", async () => {
    const { page } = rigg;
    await page.getByRole("button", { name: /Kontroll/ }).click();
    await page.waitForTimeout(300);
    expect(await page.locator(".ark-kontroll-panel").isVisible()).toBe(true);

    const [skärm] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByRole("button", { name: "⧉ Flöde + bild" }).click(),
    ]);
    await skärm.waitForLoadState();
    await skärm.waitForSelector(".ark-ramfonster-yta", { timeout: 15_000 });
    await skärm.waitForTimeout(800);
    // Båda: två ytor sida vid sida, lika breda.
    const ytor = skärm.locator(".ark-ramfonster-yta");
    expect(await ytor.count()).toBe(2);
    const [a, b] = [await ytor.nth(0).boundingBox(), await ytor.nth(1).boundingBox()];
    expect(Math.abs(a!.width - b!.width)).toBeLessThan(4);
    expect(await ytor.nth(0).locator("svg [data-ark-nod]").count()).toBeGreaterThan(0); // flödet
    expect(await ytor.nth(1).locator("[data-figur]").count()).toBeGreaterThan(0); // bilden

    // Kontrollen ser skärmen och byter dess vy.
    await page.waitForTimeout(300);
    expect(await page.locator(".ark-kontroll-skarm").count()).toBe(1);
    await page.locator(".ark-kontroll-skarm button", { hasText: "Flöde" }).click();
    await skärm.waitForTimeout(400);
    expect(await skärm.locator(".ark-ramfonster-yta").count()).toBe(1);
    expect(await skärm.locator(".ark-ramfonster-yta svg [data-ark-nod]").count()).toBeGreaterThan(0);

    // Bläddra från kontrollen – skärmen följer.
    await page.getByRole("button", { name: "Nästa ram" }).click();
    await skärm.waitForTimeout(400);
    expect(await skärm.locator(".ark-ramfonster-rubrik").textContent()).toContain("2 / 2");
    await skärm.close();
  });
});
