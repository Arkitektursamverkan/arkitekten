/**
 * Webbläsartester: ta bort, bryta och lägga till i kedjan – och helskärmen.
 *
 * REGRESSION: en aktivitet som tolkats fram (AI eller regelparsern) gick inte
 * att ta bort i Affärsprocess, och kedjan gick inte att bryta – bara fria
 * objekt ur paletten hade en borttagning.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AFFARSPROCESS_EXEMPEL, SYSTEMPROCESS_EXEMPEL, findChromium, startaAppen } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("Affärsprocess: kedjan och helskärmen", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen({ ny: { verktyg: "Affärsprocess", text: AFFARSPROCESS_EXEMPEL } });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
  });

  const ytansText = () =>
    rigg.page.evaluate(() => document.querySelector(".ark-tool-stage .react-flow")?.textContent ?? "");
  const antalKanter = () => rigg.page.evaluate(() => document.querySelectorAll(".react-flow__edge").length);

  it("en tolkad aktivitet tas bort ur kedjan", async () => {
    const { page } = rigg;
    expect(await ytansText()).toContain("Skapa kravprofil");
    await page.locator(".react-flow__node", { hasText: "Skapa kravprofil" }).first().click();
    await page.waitForSelector(".ark-ap-inspektor", { timeout: 5_000 });
    await page.getByRole("button", { name: "Ta bort ur kedjan" }).click();
    await page.waitForTimeout(400);
    const text = await ytansText();
    expect(text).not.toContain("Skapa kravprofil");
    // Kedjan sluts: resten står kvar.
    expect(text).toContain("Annonsera tjänst");
    expect(rigg.fel).toEqual([]);
  });

  it("en ny aktivitet läggs in efter ett steg och öppnas för namnbyte", async () => {
    const { page } = rigg;
    await page.locator(".react-flow__node", { hasText: "Annonsera tjänst" }).first().click();
    await page.waitForSelector(".ark-ap-inspektor", { timeout: 5_000 });
    await page.getByRole("button", { name: "+ Lägg till aktivitet efter" }).click();
    await page.waitForTimeout(400);
    expect(await ytansText()).toContain("Ny aktivitet");
    const panel = await page.evaluate(() => document.querySelector(".ark-ap-inspektor input") as HTMLInputElement | null);
    expect(panel).not.toBeNull();
    const namn = await page.locator(".ark-ap-inspektor input").first().inputValue();
    expect(namn).toBe("Ny aktivitet");
    expect(rigg.fel).toEqual([]);
  });

  it("kedjan bryts vid en vald pil", async () => {
    const { page } = rigg;
    await page.keyboard.press("Escape");
    // Pilarnas mittpunkter i skärmkoordinater – kedjepilarna har ingen HUKI-hovertext.
    const punkter = await page.evaluate(() =>
      [...document.querySelectorAll<SVGGElement>(".react-flow__edge")]
        .filter((g) => !/^[HUKI] – /.test(g.querySelector("path.ark-edge-hint title")?.textContent ?? ""))
        .map((g) => {
          const p = g.querySelector(".react-flow__edge-path") as SVGPathElement;
          const pt = p.getPointAtLength(p.getTotalLength() * 0.5);
          const s = new DOMPoint(pt.x, pt.y).matrixTransform(p.getScreenCTM()!);
          return { x: s.x, y: s.y };
        }),
    );
    const före = await antalKanter();
    let bröt = false;
    for (const pt of punkter) {
      await page.mouse.click(pt.x, pt.y);
      const knapp = page.getByRole("button", { name: /Bryt kedjan här/ });
      if (await knapp.isVisible().catch(() => false)) {
        await knapp.click();
        bröt = true;
        break;
      }
    }
    expect(bröt, "ingen pil gav knappen Bryt kedjan här").toBe(true);
    await page.waitForTimeout(400);
    expect(await antalKanter()).toBeLessThan(före);
    expect(rigg.fel).toEqual([]);
  });

  it("helskärmen visar bara ritytan, låst, och Esc avslutar", async () => {
    const { page } = rigg;
    await page.getByRole("button", { name: /Helskärm/ }).click();
    await page.waitForSelector(".ark-tool-stage.ark-helskarm", { timeout: 5_000 });
    const läge = await page.evaluate(() => {
      const yta = document.querySelector(".ark-tool-stage")!.getBoundingClientRect();
      // Verktygsraden ligger under ritytan: punkten där den stod tillhör nu ritytan.
      const vrad = document.querySelector(".ark-vrad")!.getBoundingClientRect();
      const överst = document.elementFromPoint(vrad.left + 20, vrad.top + vrad.height / 2);
      return {
        fyller: yta.width >= window.innerWidth - 1 && yta.height >= window.innerHeight - 1,
        radenSkymd: !!överst?.closest(".ark-tool-stage"),
        flyttbara: document.querySelectorAll(".react-flow__node.draggable").length,
        minikarta: getComputedStyle(document.querySelector(".react-flow__minimap")!).display,
      };
    });
    expect(läge).toEqual({ fyller: true, radenSkymd: true, flyttbara: 0, minikarta: "none" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(await page.locator(".ark-tool-stage.ark-helskarm").count()).toBe(0);
    expect(rigg.fel).toEqual([]);
  });
});

describe.skipIf(!chromium)("Systemprocess: helskärmen", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen({ ny: { verktyg: "Systemprocess", text: SYSTEMPROCESS_EXEMPEL } });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
  });

  it("samma knapp, samma läge: bara ritytan, låst, och Esc avslutar", async () => {
    const { page } = rigg;
    await page.getByRole("button", { name: /Helskärm/ }).click();
    await page.waitForSelector(".ark-tool-stage.ark-helskarm", { timeout: 5_000 });
    const läge = await page.evaluate(() => {
      const yta = document.querySelector(".ark-tool-stage")!.getBoundingClientRect();
      return {
        fyller: yta.width >= window.innerWidth - 1 && yta.height >= window.innerHeight - 1,
        flyttbara: document.querySelectorAll(".react-flow__node.draggable").length,
      };
    });
    expect(läge).toEqual({ fyller: true, flyttbara: 0 });
    await page.getByRole("button", { name: /Avsluta helskärm/ }).click();
    await page.waitForTimeout(300);
    expect(await page.locator(".ark-tool-stage.ark-helskarm").count()).toBe(0);
    expect(rigg.fel).toEqual([]);
  });
});
