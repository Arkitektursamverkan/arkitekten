/**
 * SISTA STRÄCKAN in i målet går att dra i sidled (beslut 2026-09-30).
 *
 * 2.2.1:s "Byter annonstyp" går som en räls under kedjan tillbaka till
 * "Publicerar lägenhet". Med en enda brytpunkt låg den sista lodräta sträckan
 * fast framför målets port – rakt genom Lägenhetsförvaltare, Kundkoordinator
 * och RitoCad – och ingenting gick att dra för att flytta den. Handtaget mitt
 * på sträckan sätter kantens andra brytpunkt.
 *
 * Andra omgången samma dag: handtaget satt mitt på sträckan, nedanför skärmen,
 * och brytpunktens handtag tusentals pixlar bort till höger – "nu kan jag bara
 * hantera högra delen av flödet". Man tar nu tag i LINJEN där man ser den.
 *
 * I en riktig webbläsare, för att gesten hänger på React Flows koordinater och
 * på att handtaget ligger ovanpå kanternas träffytor.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen } from "./harness";

const chromium = findChromium();
const KANT = "s_1890dd5d->s_2a1e704f";

describe.skipIf(!chromium)("affärsprocess: sista sträckan in i målet", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    await rigg.page.getByRole("button", { name: /Processkatalog/ }).first().click();
    await rigg.page.waitForTimeout(500);
    await rigg.page.fill(".ark-katalog-sok", "2.2.1");
    await rigg.page.waitForTimeout(600);
    await rigg.page.locator(".ark-kort").first().click();
    await rigg.page.waitForSelector(".ark-ap-nod", { timeout: 20_000 });
    // Ett flöde öppnas LÅST (visning) – handtagen finns bara i redigeringen.
    await rigg.page.getByRole("button", { name: /Redigera/ }).first().click();
    await rigg.page.waitForTimeout(1200);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (rigg) expect(rigg.flöden(), "testet ändrade flows/").toBe(rigg.flödenFöre);
  });

  it("REGRESSION: 'Byter annonstyp' gick in genom målets satelliter och sista sträckan gick inte att flytta", async () => {
    const { page } = rigg;
    // Rälsen ligger under kedjan, nedanför ett 1000 px högt fönster.
    await page.setViewportSize({ width: 1600, height: 1400 });
    await page.waitForTimeout(300);
    const linje = page.locator(`[data-edge-grepp="${KANT}:via2.x"]`);
    expect(await linje.count(), "sista sträckan går inte att ta i").toBe(1);
    const före = (await linje.boundingBox())!;

    // Satelliterna under målet: sträckan ska hamna till vänster om dem.
    const satelliter = await page.$$eval(".react-flow__node", (noder) =>
      noder
        .filter((n) => /Lägenhetsförvaltare|Kundkoordinator|RitoCad/.test(n.textContent ?? ""))
        .map((n) => n.getBoundingClientRect())
        .map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
    );
    const cx = före.x + före.width / 2;
    const nära = satelliter.filter((r) => Math.abs(r.x + r.w / 2 - cx) < 150 && r.y > före.y - 50 && r.y < före.y + före.height);
    expect(nära.length, "hittade inte satelliterna vid sträckan").toBeGreaterThan(0);
    const vänsterKant = Math.min(...nära.map((r) => r.x));
    // Ta i linjen strax NEDANFÖR satelliterna – där man ser den, inte långt ner.
    const cy = Math.max(...nära.map((r) => r.y + r.h)) + 30;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const mål = vänsterKant - 30;
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(cx + ((mål - cx) * i) / 10, cy + 40 * (i / 10));
      await page.waitForTimeout(15);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    const efter = (await linje.boundingBox())!;
    // Sträckan flyttade i sidled till vänster om satelliterna …
    expect(efter.x + efter.width / 2).toBeLessThan(vänsterKant);
    // … och bara i sidled: den går fortfarande från rälsen upp till målet.
    expect(Math.abs(efter.y - före.y)).toBeLessThan(40);

    // Rälsen går också att ta i där man ser den – nära vänsterkanten – och
    // flyttas upp och ner.
    const räls = page.locator(`[data-edge-grepp="${KANT}:via.y"]`);
    expect(await räls.count()).toBe(1);
    const r0 = (await räls.boundingBox())!;
    const rx = Math.min(r0.x + 120, 1500);
    const ry = r0.y + r0.height / 2;
    await page.mouse.move(rx, ry);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(rx + 3 * i, ry - 6 * i);
      await page.waitForTimeout(15);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const r1 = (await räls.boundingBox())!;
    expect(r0.y - r1.y).toBeGreaterThan(40);
    // KÄND, SEDAN TIDIGARE: att dra en brytpunkt i en stor affärsprocess loggar
    // React Flows "Maximum update depth exceeded" (StoreUpdater). Den kommer
    // lika mycket av det gamla brytpunktshandtaget och är inte det här testets
    // sak – alla ANDRA fel ska fortfarande fälla det.
    expect(rigg.fel.filter((f) => !f.includes("Maximum update depth exceeded"))).toEqual([]);
  });
});
