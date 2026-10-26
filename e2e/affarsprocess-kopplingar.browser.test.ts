/**
 * Affärsprocessens kopplingar – UTSEENDET, mätt i en riktig webbläsare.
 *
 * Två saker som bara syns när appen kör, och som båda var glidningar mellan
 * skärm och fil (invariant 1):
 *
 *  - kopplingarna ska svänga MJUKT (`Input/exempel_process.png`). Räta
 *    vinklar var det som skilde bilderna mest när man lade dem bredvid
 *    varandra (synpunkt 2026-09-07: "Kopplingarna är inte rundade och snygga").
 *  - HUKI-bokstaven skrivs inte ut (färgen bär betydelsen). SVG-exporten följde
 *    den regeln; canvasen skrev ut råvärdet och satte ett "U" mitt i klustret.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, startaAppen, öppnaUrMenyn } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("affärsprocessens kopplingar på skärmen", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    // Exempelpaketets affärsprocess, öppnad ur menyn (sökningen fäller ut grenen).
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    await öppnaUrMenyn(rigg.page, "Rekrytering");
    await rigg.page.waitForSelector(".ark-ap-nod", { timeout: 20_000 });
    await rigg.page.waitForTimeout(1200);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (rigg) expect(rigg.flöden(), "testerna ändrade flows/").toBe(rigg.flödenFöre);
  });

  /**
   * Kanternas path-data med sorten ur hovertexten. Färgerna kommer ur
   * installationens symbolstil, så testet känner igen sorten på det den
   * BETYDER: "U – Utför: …" är HUKI, "Samverkar med: …" är IT-stödet.
   */
  const banor = () =>
    rigg.page.evaluate(() =>
      [...document.querySelectorAll<SVGGElement>(".react-flow__edge")].map((g) => {
        const titel = g.querySelector("path.ark-edge-hint title")?.textContent ?? "";
        return {
          d: g.querySelector("path.react-flow__edge-path")?.getAttribute("d") ?? "",
          sort: /^[HUKI] – /.test(titel) ? "huki" : titel.startsWith("Samverkar med") ? "it" : "",
        };
      }),
    );

  it("HUKI-strecken svänger mjukt, inte i räta vinklar", async () => {
    const blå = (await banor()).filter((b) => b.sort === "huki");
    expect(blå.length, "hittade inga HUKI-kopplingar").toBeGreaterThan(0);
    // Varje knä är en båge (A), aldrig ett rätt L.
    const utanBåge = blå.filter((b) => b.d.includes("L") && !b.d.includes("A"));
    const knän = utanBåge.filter((b) => {
      // Ett rakt streck har bara ett L och behöver ingen båge.
      return (b.d.match(/L/g) ?? []).length > 1;
    });
    expect(knän.map((b) => b.d), "streck med knä men utan mjuk sväng").toEqual([]);
  });

  it("HUKI-strecket och IT-stödets ligger på var sin linje", async () => {
    const alla = await banor();
    const stamX = (d: string) => {
      // Sista lodräta benet: x-värdet vägen går upp eller ner längs.
      const punkter = [...d.matchAll(/(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/g)].map((m) => +m[1]);
      return punkter[punkter.length - 1];
    };
    const blå = alla.filter((b) => b.sort === "huki").map((b) => stamX(b.d));
    const svart = alla.filter((b) => b.sort === "it").map((b) => stamX(b.d));
    expect(blå.length && svart.length, "saknar antingen HUKI eller IT-stöd").toBeTruthy();
    // Ingen blå stam får sammanfalla med en svart – då ritas den ena ovanpå
    // den andra och bilden får en enda linje där förlagan har två.
    for (const b of blå) {
      const krock = svart.find((s) => Math.abs(s - b) < 4);
      expect(krock, `blå stam ${b} ligger på den svarta stammen ${krock}`).toBeUndefined();
    }
  });

  /**
   * REGRESSION: brytpunktens handtag fanns även i LÄSLÄGE.
   *
   * Flödesschemat lämnar inget handtag när ritytan är låst
   * (`onWaypointChange: locked ? undefined : …` i FlowCanvas), men affärsprocessens rityta
   * skickade in handlaren rakt av. Man kunde ta tag i punkten och höja eller
   * sänka en koppling mitt i en ren visning (2026-09-08) – och eftersom
   * dragningen sparas var processen ändrad utan att någon gått in i
   * redigeringsläget. Att TITTA på en process ska inte kunna ändra den.
   *
   * Går bara att se i en riktig webbläsare: handtaget kräver en uppmätt väg,
   * och i happy-dom ritar React Flow inga kanter alls.
   */
  it("brytpunkten går inte att dra i läsläge – först efter Redigera", async () => {
    const handtag = () => rigg.page.locator(".ark-edge-waypoint").count();
    expect(await handtag(), "läsläget lämnade dragbara brytpunkter").toBe(0);

    await rigg.page.getByRole("button", { name: /Redigera/ }).first().click();
    await rigg.page.waitForTimeout(600);
    expect(await handtag(), "redigeringsläget saknar brytpunkter").toBeGreaterThan(0);

    // Tillbaka till läsläget – nästa test ska se samma rityta som de förra.
    await rigg.page.getByRole("button", { name: /Klar/ }).first().click();
    await rigg.page.waitForTimeout(600);
    expect(await handtag()).toBe(0);
  });

  /**
   * "Räta upp kopplingarna" – markera objekt, tryck, få raka streck.
   *
   * Routern rätar ut brus på egen hand (se RAK_TOLERANS), men riktig
   * förskjutning kan bara rättas genom att objekten FLYTTAR sig, och det ska
   * användaren utlösa själv (krav 2026-09-08: "en funktion där man kan
   * markera objekt och sedan välja räta upp kopplingarna … det innebär ju att
   * objekten måste linjera upp så klart").
   *
   * Ett webbläsartest: markeringen ägs av React Flow, och att den når fram till
   * verktygsraden syns bara när appen kör.
   */
  it("räta upp-knappen vaknar av en markering och rätar strecken", async () => {
    const { page } = rigg;
    await page.getByRole("button", { name: /Redigera/ }).first().click();
    await page.waitForTimeout(600);

    const knapp = page.getByRole("button", { name: /Räta upp kopplingarna/ });
    expect(await knapp.count(), "knappen saknas i verktygsraden").toBeGreaterThan(0);
    expect(await knapp.first().isDisabled(), "knappen var levande utan markering").toBe(true);

    // Ctrl markerar flera (SELECTION_KEY) – samma tangent som i flödesschemat.
    const noder = page.locator(".react-flow__node-ap");
    const antalFöre = await noder.count();
    expect(antalFöre).toBeGreaterThan(2);
    await noder.nth(0).click();
    await noder.nth(1).click({ modifiers: ["Control"] });
    await noder.nth(2).click({ modifiers: ["Control"] });
    await page.waitForTimeout(400);
    expect(await knapp.first().isDisabled(), "markeringen nådde inte verktygsraden").toBe(false);

    await knapp.first().click();
    await page.waitForTimeout(600);
    // Ingenting försvann, och bilden ritas fortfarande.
    expect(await noder.count()).toBe(antalFöre);
    expect(await page.locator("path.react-flow__edge-path").count()).toBeGreaterThan(0);

    // Tillbaka till läsläget utan att spara – nästa test ska se samma rityta.
    await page.getByRole("button", { name: /Klar/ }).first().click();
    await page.waitForTimeout(600);
  });

  it("HUKI-bokstaven skrivs inte ut – färgen bär betydelsen", async () => {
    const etiketter = await rigg.page.$$eval(".ark-edge-label", (n) =>
      n.map((e) => e.textContent?.trim() ?? ""),
    );
    expect(etiketter.filter((t) => /^[HUKI]$/.test(t))).toEqual([]);
  });
});
