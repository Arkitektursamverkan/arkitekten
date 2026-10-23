/**
 * Bildfliken i Ramar: figurer går att ta bort ur scenen.
 *
 * REGRESSION (synpunkt 2026-09-30): "Jag kan inte ta bort objekt i Bild. Ex
 * Hyresgäst." Borttagningen fanns, men bara bakom verktyget Flytta + ett klick
 * + en knapp i raden ovanför. Med det förvalda verktyget fanns ingen väg, och
 * Delete gjorde ingenting.
 *
 * Serien skapas men SPARAS ALDRIG – ramar/ och flows/ ska vara orörda efteråt.
 */

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen } from "./harness";

const chromium = findChromium();
const ramarFingeravtryck = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().join(",") : "");

describe.skipIf(!chromium)("Ramar – bildfliken", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  let ramarFöre = "";

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    ramarFöre = ramarFingeravtryck(rigg.data.ramarDir);
    const { page } = rigg;
    page.on("dialog", (d) => void d.accept());
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByRole("button", { name: /Visualisering/ }).first().click();
    await page.waitForTimeout(800);
    await page.selectOption('select[aria-label="Process"]', "ap-demo-uthyrning-ordinarie");
    await page.fill('input[aria-label="Seriens namn"]', "Prov (sparas inte)");
    await page.getByRole("button", { name: "Skapa" }).click();
    await page.waitForTimeout(1000);
    await page.click("button[role=tab]:has-text('Bild')");
    await page.waitForTimeout(500);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (rigg) expect(rigg.flöden(), "testet ändrade flows/").toBe(rigg.flödenFöre);
    if (rigg) expect(ramarFingeravtryck(rigg.data.ramarDir), "testet sparade en ramserie").toBe(ramarFöre);
  });

  async function mitt(id: string) {
    const bb = (await rigg.page.locator(`[data-figur=${id}]`).boundingBox())!;
    return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
  }

  const dold = async (id: string) =>
    (await rigg.page.locator(`[data-figur=${id}]`).getAttribute("class"))?.includes("dold") ?? false;
  const synlighet = (id: string) =>
    rigg.page.locator(`[data-figur=${id}]`).evaluate((e) => (e as HTMLElement).style.opacity);

  it("REGRESSION: verktyget Ta bort tar bort en figur ur DEN HÄR ramen – den finns kvar i de andra", async () => {
    // "Standard är enbart från befintlig ram" – förut försvann figuren ur alla ramar.
    const { page } = rigg;
    // Två ramar FÖRST – borttagningen i ram 1 får inte röra ram 2.
    const ramar = page.locator(".ark-ramar-lista li");
    await page.locator(".ark-ramar-lista button", { hasText: /^✚ Ny$/ }).click();
    await page.waitForTimeout(200);
    await ramar.first().click();
    await page.waitForTimeout(200);
    await page.click("button.ark-ramar-verktyg:has-text('Ta bort')");
    const p = await mitt("hyresgast");
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    expect(await dold("hyresgast")).toBe(true);
    // REGRESSION ("Ta bort funkar inte på Hyresgäst"): figuren låg kvar
    // halvgenomskinlig i redigeringen och såg orörd ut. Nu försvinner den …
    expect(await synlighet("hyresgast")).toBe("0");
    // … och syns svagt bara när man arbetar med Visa/dölj, för att kunna ta tillbaka den.
    await page.click("button.ark-ramar-verktyg:has-text('Visa/dölj')");
    await page.waitForTimeout(200);
    expect(Number(await synlighet("hyresgast"))).toBeGreaterThan(0);
    // I ram 2 syns den som vanligt.
    await ramar.nth(1).click();
    await page.waitForTimeout(300);
    expect(await dold("hyresgast")).toBe(false);
    // En NY ram efter ram 1 fortsätter dess bild – där är den dold.
    await ramar.first().click();
    await page.waitForTimeout(200);
    await page.locator(".ark-ramar-lista button", { hasText: /^✚ Ny$/ }).click();
    await page.waitForTimeout(300);
    expect(await dold("hyresgast")).toBe(true);
    // Tillbaka till ram 3 (den gamla ram 2) för testerna nedan.
    await ramar.nth(2).click();
    await page.waitForTimeout(300);
    expect(await dold("hyresgast")).toBe(false);
  });

  it("REGRESSION: en figur man drar blir vald; Delete tar bort den ur ramen, 'från alla ramar' ur scenen", async () => {
    const { page } = rigg;
    await page.click("button.ark-ramar-verktyg:has-text('Puls mellan')");
    const dra = async (id: string) => {
      const p = await mitt(id);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(p.x - 8 * i, p.y);
        await page.waitForTimeout(15);
      }
      await page.mouse.up();
      await page.waitForTimeout(200);
    };
    await dra("huvudkontor");
    expect(await page.getByRole("button", { name: "Ta bort från den här ramen" }).count()).toBe(1);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    expect(await dold("huvudkontor")).toBe(true);
    expect(await synlighet("huvudkontor")).toBe("0");

    await dra("hyresgast");
    await page.getByRole("button", { name: "… från alla ramar" }).click();
    await page.waitForTimeout(300);
    expect(await page.locator("[data-figur=hyresgast]").count()).toBe(0);
  });

  it("REGRESSION: textrutan – en bildtext, inte en pratbubbla – skapas med ett klick, skrivs, flyttas och tas bort", async () => {
    // "Jag vill också ha ett verktyg som är textruta, alltså inte pratbubbla."
    const { page } = rigg;
    await page.click("button.ark-ramar-verktyg:has-text('Textruta')");
    const yta = (await page.locator(".ark-ramar-bild--scen svg").boundingBox())!;
    // Uppe i himlen – tom yta, ingen figur.
    await page.mouse.click(yta.x + yta.width * 0.45, yta.y + yta.height * 0.12);
    await page.waitForTimeout(300);
    expect(await page.locator("[data-textruta]").count()).toBe(1);
    // Textfältet får fokus direkt.
    await page.keyboard.type("Tre dagar senare är systemet tillbaka");
    await page.fill('input[aria-label="Textrutans rubrik"]', "SÅ HÄR ÄR DET · Dag 3");
    await page.waitForTimeout(200);
    const ruta = page.locator("[data-textruta]");
    expect(await ruta.textContent()).toContain("Tre dagar senare");
    expect(await ruta.textContent()).toContain("Dag 3");

    const före = (await ruta.boundingBox())!;
    await page.mouse.move(före.x + 30, före.y + 20);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(före.x + 30 + 15 * i, före.y + 20);
      await page.waitForTimeout(15);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect((await ruta.boundingBox())!.x - före.x).toBeGreaterThan(40);

    // Mindre ruta, och egna färger på bakgrund och text.
    const bredFöre = (await ruta.boundingBox())!.width;
    await page.selectOption('select[aria-label="Textrutans storlek"]', "0.75");
    await page.locator('.ark-ramar-inspektor input[type="range"]').fill("160");
    await page.click('button[aria-label="Bakgrund #ffffff"]');
    await page.click('button[aria-label="Text #1f2937"]');
    await page.waitForTimeout(200);
    expect((await ruta.boundingBox())!.width).toBeLessThan(bredFöre / 2);
    expect(await ruta.locator("rect").first().getAttribute("fill")).toBe("#ffffff");
    expect(await ruta.locator("text").last().getAttribute("fill")).toBe("#1f2937");

    await page.keyboard.press("Delete");
    await page.waitForTimeout(200);
    expect(await page.locator("[data-textruta]").count()).toBe(0);
  });

  it("REGRESSION: en pulserande punkt går att sätta ovanpå en figur – t.ex. i ett fönster på Bostad", async () => {
    // "Jag vill kunna lägga till en liten cirkel som pulserar. Typ i ett av fönsterna på Bostad."
    const { page } = rigg;
    await page.click("button.ark-ramar-verktyg:has-text('Pulspunkt')");
    const bostad = (await page.locator("[data-figur=bostad]").boundingBox())!;
    // Figurens läge i scenen står i dess transform – rutan på skärmen påverkas av hover-skuggan.
    const läge = () => page.locator("[data-figur=bostad] > g").first().getAttribute("transform");
    const lägeFöre = await läge();
    await page.mouse.click(bostad.x + bostad.width * 0.3, bostad.y + bostad.height * 0.35);
    await page.waitForTimeout(300);
    const punkt = page.locator("[data-pulspunkt]");
    expect(await punkt.count()).toBe(1);
    // Den pulserar – ringarna har SMIL-animationer.
    expect(await punkt.locator("animate").count()).toBeGreaterThan(0);
    // Figuren flyttades inte av klicket.
    expect(await läge()).toBe(lägeFöre);

    await page.selectOption('select[aria-label="Pulspunktens storlek"]', "0.6");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(200);
    expect(await punkt.count()).toBe(0);
  });

  it("REGRESSION: en figur som läggs till i en ram syns bara i den ramen", async () => {
    // "Om jag står i en annan ram och lägger till en figur så läggs den till i alla ramar."
    const { page } = rigg;
    const ramar = page.locator(".ark-ramar-lista li");
    const antal = await ramar.count();
    expect(antal).toBeGreaterThan(1);
    await ramar.nth(antal - 1).click(); // den sista ramen
    await page.waitForTimeout(200);
    const före = await page.locator("[data-figur]").count();
    await page.getByRole("button", { name: /Figur\/ikon/ }).click();
    await page.locator(".ark-ramar-palett-ruta", { hasText: "Hantverkare" }).first().click();
    await page.waitForTimeout(300);
    expect(await page.locator("[data-figur]").count()).toBe(före + 1);
    const id = (await page.locator("[data-figur]").last().getAttribute("data-figur"))!;
    expect(await synlighet(id)).not.toBe("0");
    // I den första ramen är den dold.
    await ramar.first().click();
    await page.waitForTimeout(300);
    expect(await dold(id)).toBe(true);
    expect(await synlighet(id)).toBe("0");
  });

  it("REGRESSION: färgen byter färg på det som är valt – en figurs blinkning, en pulspunkt", async () => {
    // "Jag vill kunna ange färg för Blinka, puls – ja alla objekt under Bild."
    const { page } = rigg;
    const bild = page.locator(".ark-ramar-bild--scen svg");
    const GRÖN = "#2b8a3e";
    const LILA = "#7048e8";
    // Färgvalet står i bildflikens verktygsrad.
    expect(await page.locator(".ark-ramar-lada--scen .ark-ramar-fargrad").count()).toBe(1);

    await page.click("button.ark-ramar-verktyg:has-text('Blinka')");
    const p = await mitt("bostad");
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(200);
    expect(await bild.innerHTML()).not.toContain(GRÖN);

    // Välj figuren och klicka på grönt – blinkningen byter färg.
    await page.click("button.ark-ramar-verktyg:has-text('Flytta')");
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(200);
    expect(await page.locator(".ark-ramar-figurmarkering").textContent()).toContain("Blinka");
    await page.click(`.ark-ramar-lada--scen button[aria-label="Färg ${GRÖN}"]`);
    await page.waitForTimeout(200);
    expect(await bild.innerHTML()).toContain(GRÖN);

    // En pulspunkt byter också färg när den är vald.
    await page.click("button.ark-ramar-verktyg:has-text('Pulspunkt')");
    const yta = (await bild.boundingBox())!;
    await page.mouse.click(yta.x + yta.width * 0.8, yta.y + yta.height * 0.15);
    await page.waitForTimeout(200);
    await page.click(`.ark-ramar-lada--scen button[aria-label="Färg ${LILA}"]`);
    await page.waitForTimeout(200);
    // Kärnan – den med vit kant (den sista är den streckade markeringsringen).
    expect(await page.locator(`[data-pulspunkt] circle[stroke="#ffffff"]`).last().getAttribute("fill")).toBe(LILA);
  });

  it("REGRESSION: en flytt gäller den här ramen – eller, som val, alla ramar", async () => {
    // "Om jag flyttar ett visst objekt vill jag kunna välja att flytta på alla ramar."
    const { page } = rigg;
    const ramar = page.locator(".ark-ramar-lista li");
    const läge = () => page.locator("[data-figur=bostad] > g").first().getAttribute("transform");
    const dra = async (dx: number) => {
      const p = await mitt("bostad");
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(p.x + (dx * i) / 6, p.y);
        await page.waitForTimeout(15);
      }
      await page.mouse.up();
      await page.waitForTimeout(200);
    };
    await page.click("button.ark-ramar-verktyg:has-text('Flytta')");

    await ramar.nth(1).click();
    await page.waitForTimeout(200);
    const ram2Före = await läge();
    await ramar.first().click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Den här ramen", exact: true }).click();
    const ram1Före = await läge();
    await dra(80);
    const ram1Efter = await läge();
    expect(ram1Efter).not.toBe(ram1Före);
    await ramar.nth(1).click();
    await page.waitForTimeout(200);
    expect(await läge()).toBe(ram2Före); // ram 2 orörd

    // Alla ramar: flyttar i ram 2 flyttar också ram 1.
    await page.getByRole("button", { name: "Alla ramar", exact: true }).click();
    await dra(-60);
    const ram2Efter = await läge();
    expect(ram2Efter).not.toBe(ram2Före);
    await ramar.first().click();
    await page.waitForTimeout(200);
    expect(await läge()).not.toBe(ram1Efter);
  });
});
