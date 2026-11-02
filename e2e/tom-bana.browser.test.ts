/**
 * REGRESSION: ett objekt ensamt i översta banan drogs till banan under. Banan
 * försvann, objektet hamnade på samma plats på skärmen och det såg ut som att
 * draget inte gjort något. Nu står den tömda banan kvar under redigeringen.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen, öppnaUrMenyn } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("tömd bana", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    await öppnaUrMenyn(rigg.page, "Beställ behörighet");
    await rigg.page.waitForSelector(".react-flow__node-process", { timeout: 20_000 });
    await rigg.page.getByRole("button", { name: "✎ Redigera" }).click();
    await rigg.page.waitForTimeout(700);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (rigg) expect(rigg.flöden(), "testerna ändrade flows/").toBe(rigg.flödenFöre);
  });

  const banor = () => rigg.page.locator(".react-flow__node-lane").count();
  const banaMitt = (i: number) =>
    rigg.page.evaluate((n) => {
      const r = document.querySelectorAll(".react-flow__node-lane")[n].getBoundingClientRect();
      return r.y + r.height / 2;
    }, i);

  async function draTill(y: number) {
    const b = (await rigg.page.locator('.react-flow__node-process[data-id="s1"]').boundingBox())!;
    const x = b.x + b.width / 2;
    const start = b.y + b.height / 2;
    await rigg.page.mouse.move(x, start);
    await rigg.page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await rigg.page.mouse.move(x, start + ((y - start) * i) / 12);
      await rigg.page.waitForTimeout(10);
    }
    await rigg.page.mouse.up();
    await rigg.page.waitForTimeout(800);
  }

  const s1Mitt = async () => {
    const b = (await rigg.page.locator('.react-flow__node-process[data-id="s1"]').boundingBox())!;
    return b.y + b.height / 2;
  };

  it("banan står kvar, objektet syns i den nya banan och går att dra tillbaka", async () => {
    expect(await banor()).toBe(2);
    const förstaBanan = await banaMitt(0);
    await draTill(await banaMitt(1));
    expect(await banor(), "den tömda banan försvann").toBe(2);
    expect(await s1Mitt(), "objektet ligger kvar i översta banan").toBeGreaterThan(förstaBanan + 20);

    await draTill(await banaMitt(0));
    expect(await banor()).toBe(2);
    const y = await s1Mitt();
    const r = await rigg.page.evaluate(() => {
      const b = document.querySelectorAll(".react-flow__node-lane")[0].getBoundingClientRect();
      return { y: b.y, h: b.height };
    });
    expect(y, "objektet kom inte tillbaka till översta banan").toBeLessThan(r.y + r.h);
  });
});
