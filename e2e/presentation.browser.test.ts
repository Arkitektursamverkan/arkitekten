/**
 * En process i kategorin PRESENTATION öppnas i det avskalade utseendet
 * (tools/ramar/avskalad.ts) – inte i affärsprocessverktygets rityta.
 *
 * REGRESSION (synpunkt 2026-09-30): "Men den ser ju likadan ut som innan!" –
 * det avskalade utseendet fanns bara i Ramar, och processen som flyttats till
 * Presentation öppnades från katalogen med samma rityta som förut.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, flödenFingeravtryck, startaAppen } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("processer i kategorin Presentation", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  const flödenFöre = flödenFingeravtryck();

  async function öppna(sök: string) {
    await rigg.page.getByRole("button", { name: /Processkatalog/ }).first().click();
    await rigg.page.waitForTimeout(500);
    await rigg.page.fill(".ark-katalog-sok", sök);
    await rigg.page.waitForTimeout(600);
    await rigg.page.locator(".ark-kort").first().click();
    await rigg.page.waitForTimeout(1500);
  }

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    expect(flödenFingeravtryck(), "testet ändrade flows/").toBe(flödenFöre);
  });

  it("REGRESSION: öppnas avskalad – och FÖRBLIR avskalad i redigeringsläget, där rutorna går att dra", async () => {
    // Andra omgången: "om jag tar redigera så kommer jag till den tidigare".
    const { page } = rigg;
    await öppna("Uthyrning ordinarie (demo)");
    expect(await page.locator(".ark-ap-avskalad svg").count()).toBe(1);
    await page.getByRole("button", { name: /Redigera/ }).first().click();
    await page.waitForTimeout(600);
    expect(await page.locator(".ark-ap-avskalad.redigerar svg").count()).toBe(1);

    const ruta = page.locator('.ark-ap-avskalad [data-ark-nod="kredit"]');
    const före = (await ruta.boundingBox())!;
    const cx = före.x + före.width / 2;
    const cy = före.y + före.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx + 10 * i, cy);
      await page.waitForTimeout(15);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const efter = (await ruta.boundingBox())!;
    expect(efter.x - före.x).toBeGreaterThan(30);
    // Bara sidledes – snäppningen håller rutan på sin mittlinje.
    expect(Math.abs(efter.y - före.y)).toBeLessThan(2);

    // Ändringen är osparad; Klar ber om att spara. Ångra i stället.
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
  });

  it("REGRESSION: kopplingarnas ändar går att flytta till en annan sida av rutan", async () => {
    // "Jag vill kunna ändra kopplingarna var de går in i rutorna."
    const { page } = rigg;
    const handtag = page.locator('.ark-ap-avskalad [data-avsk-kant="publicera->anmal"][data-avsk-ande="target"]');
    expect(await handtag.count()).toBe(1);
    const före = (await handtag.boundingBox())!;
    const anmal = (await page.locator('.ark-ap-avskalad [data-ark-nod="anmal"] rect').first().boundingBox())!;
    // Från ovansidan till vänstersidan.
    await page.mouse.move(före.x + före.width / 2, före.y + före.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(
        före.x + ((anmal.x - före.x) * i) / 8,
        före.y + ((anmal.y + anmal.height / 2 - före.y) * i) / 8,
      );
      await page.waitForTimeout(15);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const efter = (await handtag.boundingBox())!;
    expect(Math.abs(efter.x + efter.width / 2 - anmal.x)).toBeLessThan(4);
    expect(Math.abs(efter.y + efter.height / 2 - (anmal.y + anmal.height / 2))).toBeLessThan(4);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
  });

  it("REGRESSION: ett klick på en ruta öppnar inspektören, och innehållet ändras där", async () => {
    // "Vill också kunna redigera innehållet i objekten."
    const { page } = rigg;
    await page.locator('.ark-ap-avskalad [data-ark-nod="kredit"]').click();
    await page.waitForTimeout(300);
    const text = page.locator('.ark-ap-inspektor input[value="Utför kreditupplysning"]');
    expect(await page.locator(".ark-ap-inspektor").isVisible()).toBe(true);
    expect(await text.count()).toBe(1);
    await text.fill("Gör kreditkontroll");
    await text.press("Enter");
    await page.waitForTimeout(400);
    expect(await page.locator('.ark-ap-avskalad [data-ark-nod="kredit"]').textContent()).toContain("Gör kreditkontroll");
    await page.keyboard.press("Escape");
    await page.locator(".ark-ap-avskalad-bild").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
  });

  it("en process i en annan kategori öppnas som vanligt", async () => {
    await öppna("2.2.1");
    expect(await rigg.page.locator(".ark-ap-avskalad").count()).toBe(0);
  });
});
