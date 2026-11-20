/**
 * Systemskissen i en riktig webbläsare: från startsidans kort till en sparad
 * skiss, ritad med musen.
 *
 * Det enhetstesterna inte ser är musen och fokus: objekt dras, kopplingen dras
 * ur handtaget, och tangenterna ska nå fram också när man just klickat på ett
 * objekt.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("systemskiss", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-start" });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (rigg) expect(rigg.flöden(), "testerna ändrade flows/").toBe(rigg.flödenFöre);
  });

  const sparad = () => {
    const dir = rigg.data.skisserDir;
    const filer = existsSync(dir) ? readdirSync(dir) : [];
    return filer.length === 1 ? JSON.parse(readFileSync(join(dir, filer[0]), "utf8")) : null;
  };
  const rutor = () =>
    rigg.page.$$eval("[data-skiss-objekt] > rect:first-child", (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }),
    );
  const kopplingar = () => rigg.page.locator("[data-skiss-koppling]").count();

  it("nås från startsidan – inte ur menyn – och en ny skiss sparas direkt", async () => {
    const { page } = rigg;
    expect(await page.locator(".ark-sidebar", { hasText: "Systemskiss" }).count()).toBe(0);
    await page.locator(".ark-start").getByRole("button", { name: /Systemskiss/ }).click();
    await page.getByLabel("Skissens namn").fill("Utvecklingsmiljö");
    await page.getByRole("button", { name: "Skapa" }).click();
    await page.waitForSelector(".ark-skiss-svg");
    expect(sparad()).toMatchObject({ namn: "Utvecklingsmiljö", objekt: [] });
  });

  it("objekt läggs till, dras på plats och kopplas ihop med handtaget", async () => {
    const { page } = rigg;
    await page.getByTitle("Lägg till: Server").click();
    await page.getByLabel("Namn", { exact: true }).fill("Webbserver");
    await page.getByTitle("Lägg till: Databas").click();
    let r = await rutor();
    await page.mouse.move(r[1].x, r[1].y);
    await page.mouse.down();
    await page.mouse.move(r[1].x + 300, r[1].y + 160, { steps: 8 });
    await page.mouse.up();
    r = await rutor();
    expect(r[1].x - r[0].x).toBeGreaterThan(250);

    await page.mouse.click(r[0].x, r[0].y);
    const grepp = (await page.locator(".ark-skiss-grepp.koppla").boundingBox())!;
    await page.mouse.move(grepp.x + grepp.width / 2, grepp.y + grepp.height / 2);
    await page.mouse.down();
    await page.mouse.move(r[1].x, r[1].y, { steps: 8 });
    await page.mouse.up();
    expect(await kopplingar()).toBe(1);
    await page.getByLabel("Etikett", { exact: true }).fill("SQL 5432");
    expect(await page.locator(".ark-skiss-svg").textContent()).toContain("SQL 5432");
  });

  it("REGRESSION: efter ett klick på ett objekt låg fokus på sidan, och Ctrl+S och Delete nådde aldrig skissen", async () => {
    const { page } = rigg;
    const r = await rutor();
    await page.mouse.click(r[1].x, r[1].y);
    await page.keyboard.press("Control+s");
    await page.waitForSelector(".ark-hint--kvitto");
    expect(sparad().objekt.map((o: { namn: string }) => o.namn)).toEqual(["Webbserver", "Databas"]);
    expect(sparad().kopplingar).toHaveLength(1);

    // Delete tar bort det markerade objektet och dess koppling; ångra ger tillbaka båda.
    await page.keyboard.press("Delete");
    expect((await rutor()).length).toBe(1);
    expect(await kopplingar()).toBe(0);
    await page.keyboard.press("Control+z");
    expect((await rutor()).length).toBe(2);
    expect(await kopplingar()).toBe(1);
    expect(rigg.fel.filter((f) => !/404/.test(f))).toEqual([]);
  });
});
