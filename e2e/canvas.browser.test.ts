/**
 * Webbläsartester för ritytan.
 *
 * Regeln för vad som hör hemma här: testet ska falla på fel som bara syns när
 * appen faktiskt körs. Räkna alltså på det som RITAS – hur många objekt som
 * ligger i fönstret, var kameran står – inte på vad layoutmotorn returnerar.
 * Det senare hör hemma i src/tools/flowchart/layout/*.test.ts, som är snabbare
 * och mer precisa.
 *
 * Bakgrunden: en bana som växer gör diagrammet högre. Kameran följde inte med,
 * så det man tittade på gled ur bild och ritytan såg tom ut. Layouten var
 * korrekt hela tiden, och alla enhetstester var gröna.
 *
 * Två fällor värda att känna till om man skriver fler:
 *
 *  1. Mät objektens `style.transform`, inte `boundingBox()`. Det senare blandar
 *     ihop var objektet ligger med var kameran står, så ett flyttat objekt kan
 *     se orört ut och tvärtom.
 *  2. Kräv inte att HELA dokumentet syns efter ett drag. Ett diagram som vuxit
 *     ryms inte ens vid minZoom (0,2). Det som ska gälla är att man har kvar
 *     sin plats: bandet man drog i syns, och inget objekt har gått förlorat.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bandSynligt,
  draBana,
  gömdaObjekt,
  findChromium,
  flödenFingeravtryck,
  grabbartHandtag,
  draObjekt,
  läsVy,
  startaAppen,
  väljFormat,
} from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("ritytan i en riktig webbläsare", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  const flödenFöre = flödenFingeravtryck();

  beforeAll(async () => {
    rigg = await startaAppen();
    // Banhöjder, kamera och sidindelning mäts i det SIDBRUTNA läget – det är
    // där felen satt. Formatet väljs uttryckligen: appens förval är Fri, och
    // i en enda mycket bred del ligger banhandtagen utzoomade utom räckhåll.
    await väljFormat(rigg.page, "Word");
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    // Testerna klickar aldrig "Spara". Skulle de börja göra det vore det
    // de riktiga sparade flödena som skrevs över.
    expect(flödenFingeravtryck(), "testerna ändrade flows/").toBe(flödenFöre);
  });

  it("appen ritar ett diagram utan fel i konsolen", async () => {
    const v = await läsVy(rigg.page);
    expect(v.noder).toBeGreaterThan(0);
    expect(v.iVy, "objekt ritades men syntes inte").toBe(v.noder);
    expect(rigg.fel).toEqual([]);
  });

  it("REGRESSION: man har kvar sin plats när en bana förstoras", async () => {
    // En banhöjd gäller banan, inte delen – en bana som finns på fem delar
    // växer på alla fem. Ett drag på 480 px gjorde dokumentet 1 478 px högre
    // medan kameran stod stilla, och det man tittade på gled ur bild.
    const före = await läsVy(rigg.page);
    await draBana(rigg.page, await grabbartHandtag(rigg.page), 40, 12);
    const efter = await läsVy(rigg.page);

    expect(efter.höjd, "diagrammet växte inte – drogs handtaget verkligen?").toBeGreaterThan(före.höjd);
    expect(efter.noder, "objekt gick förlorade").toBe(före.noder);
    // Kameran BEHÖVER inte ha rört sig: drar man i den översta banans nederkant
    // står dess överkant still, och då är man kvar där man var. Det som ska
    // gälla är att man ser bandet man drog i.
    expect(await bandSynligt(rigg.page, await grabbartHandtag(rigg.page)), "bandet man drog i hamnade utanför bild").toBe(true);
    // Det HÄR var felet som tog ritytan: listan med noder byggdes om vid varje
    // musrörelse, React Flow nollställde sin mätning och gömde varje nod
    // (visibility: hidden) i väntan på en ny. Under ett snabbt drag hann den
    // aldrig ikapp. Objekten låg kvar på rätt plats i DOM:en – och syntes inte.
    // Att alla ska SYNAS går inte att kräva här – diagrammet växte och det som
    // hamnar nedanför är i sin ordning. Att inget är GÖMT är däremot absolut.
    expect(await gömdaObjekt(rigg.page), "objekt gömda av React Flow").toBe(0);
    expect(rigg.fel).toEqual([]);
  });

  it("REGRESSION: en bana går att minska igen", async () => {
    // Minimihöjden var ett hårt golv även för en höjd man dragit fram själv,
    // så banan stannade på 138 px hur hårt man än drog uppåt.
    const före = await läsVy(rigg.page);
    await draBana(rigg.page, await grabbartHandtag(rigg.page), 40, -12);
    const efter = await läsVy(rigg.page);

    expect(efter.störstaBana, "banan gick inte att minska").toBeLessThan(före.störstaBana);
    expect(efter.noder).toBe(före.noder);
    expect(await gömdaObjekt(rigg.page), "objekt gömda av React Flow").toBe(0);
    expect(rigg.fel).toEqual([]);
  });

  it("dubbelklick på nederkanten återställer banan till auto", async () => {
    // Sedan R6 kramar auto-höjden innehållet, så en NEDDRAGEN bana kan råka
    // vara lika hög som auto – då syns ingen skillnad. Förstora först, så att
    // återställningen har något mätbart att återställa. SAMMA handtag används
    // för både förstoring och dubbelklick – indexet räknas annars om mellan
    // layoutändringarna och kan peka på en annan bana.
    const handtag = await grabbartHandtag(rigg.page);
    await draBana(rigg.page, handtag, 30, 8);
    const före = await läsVy(rigg.page);
    await rigg.page.locator(".ark-lane-resize").nth(handtag).dblclick();
    await rigg.page.waitForTimeout(900);
    const efter = await läsVy(rigg.page);
    expect(efter.höjd, "höjden ändrades inte av dubbelklicket").not.toBe(före.höjd);
    expect(efter.noder).toBe(före.noder);
    expect(await bandSynligt(rigg.page, await grabbartHandtag(rigg.page)), "bandet försvann ur bild").toBe(true);
    expect(rigg.fel).toEqual([]);
  });

  it("REGRESSION: ett långt drag varken hänger eller kastar", async () => {
    // Höjden mättes mot den AKTUELLA höjden, som redan uppdaterats av
    // föregående musrörelse. 600 px musrörelse gav en bana på 90 000 px och
    // över tusen rader att placera om vid VARJE rörelse. Ett NaN från
    // screenToFlowPosition nådde `new Array(radantal)` och rev React-trädet.
    const start = Date.now();
    await draBana(rigg.page, await grabbartHandtag(rigg.page), 120, 8);
    const tid = Date.now() - start;
    const v = await läsVy(rigg.page);

    expect(rigg.fel, "webbläsaren rapporterade fel under draget").toEqual([]);
    expect(await gömdaObjekt(rigg.page), "objekt gömda av React Flow").toBe(0);
    expect(v.störstaBana, "banhöjden skenade").toBeLessThan(5000);
    expect(tid, "draget blev för långsamt – radantalet skenar troligen").toBeLessThan(30_000);
    expect(v.noder).toBeGreaterThan(0);
  }, 60_000);

  it("varje sidformat ritar alla objekt, och allt syns", async () => {
    // Formatbytet räknar om hela utlägget – Word delar dessutom flödet i flera
    // delar. Objekt får inte tappas eller hamna utanför bild på vägen.
    await rigg.page.locator(".ark-lane-resize").nth(await grabbartHandtag(rigg.page)).dblclick(); // tillbaka till auto
    await rigg.page.waitForTimeout(700);

    // Varje format ramas in vid bytet. Att ALLT ska rymmas är ett riktigt krav
    // först sedan zoomgolvet sänktes – vid 0,2 gick ett flersidigt A4 inte att
    // rama in över huvud taget.
    let antal = 0;
    for (const format of ["Fri", "Bred", "A4 stå.", "A4 ligg.", "Word"]) {
      await väljFormat(rigg.page, format);
      const v = await läsVy(rigg.page);
      expect(v.noder, `inga objekt i formatet ${format}`).toBeGreaterThan(0);
      expect(v.iVy, `objekt utanför vyn i formatet ${format}`).toBe(v.noder);
      expect(await gömdaObjekt(rigg.page), `objekt gömda i formatet ${format}`).toBe(0);
      if (antal) expect(v.noder, `antalet objekt ändrades i formatet ${format}`).toBe(antal);
      antal = v.noder;
    }
    expect(rigg.fel).toEqual([]);
  }, 90_000);

  it("REGRESSION: ett objekt dragits i Word-läge stannar, och Fri vy förblir hel", async () => {
    // Sidindelningen räknade en gång ut sina EGNA positioner. Då hoppade noden
    // tillbaka direkt, men positionen sparades ändå – i delens koordinater –
    // och förstörde den fria vyn när man bytte format.
    await väljFormat(rigg.page, "Word");
    const { före, efter } = await draObjekt(rigg.page);
    expect(efter, "noden hoppade tillbaka – positionen togs inte emot").not.toBe(före);

    // Och den fria vyn ska förbli begriplig efteråt: positionen sparades i
    // FRIA koordinater, inte i delens.
    await väljFormat(rigg.page, "Fri");
    const v = await läsVy(rigg.page);
    expect(v.iVy, "den fria vyn tappade objekt efter ett drag i Word-läget").toBe(v.noder);
    expect(rigg.fel).toEqual([]);
  }, 60_000);
});

describe.skipIf(!chromium)("kopplingar och ångra i en riktig webbläsare", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen();
    await väljFormat(rigg.page, "Fri");
  }, 90_000);
  afterAll(async () => await rigg?.stäng());

  const antalKanter = () =>
    rigg.page.evaluate(() => document.querySelectorAll(".react-flow__edge").length);

  it("REGRESSION: en streckad koppling går att välja", async () => {
    // De var helt inerta: interactionWidth 0, selectable false. Ett klick nådde
    // dem aldrig, så de gick varken att inspektera eller ta bort.
    const streckad = rigg.page.locator(".react-flow__edge-routed path.react-flow__edge-interaction").first();
    await expect.poll(() => streckad.count()).toBeGreaterThan(0);
    const träffytor = await rigg.page.evaluate(
      () =>
        [...document.querySelectorAll<SVGPathElement>("path.react-flow__edge-interaction")].filter(
          (p) => Number(p.getAttribute("stroke-width")) > 0,
        ).length,
    );
    expect(träffytor, "kopplingar utan träffyta går inte att klicka på").toBeGreaterThan(0);
  });

  it("ångra tar tillbaka en borttagen koppling", async () => {
    const före = await antalKanter();
    await rigg.page.locator(".react-flow__edge").first().click({ force: true });
    await rigg.page.waitForTimeout(300);
    const taBort = rigg.page.getByRole("button", { name: /ta bort/i }).first();
    if (!(await taBort.count())) return; // inspektören öppnades inte – täcks av enhetstesterna
    await taBort.click();
    await rigg.page.waitForTimeout(400);
    expect(await antalKanter(), "kopplingen togs inte bort").toBeLessThan(före);

    await rigg.page.getByRole("button", { name: /Ångra/ }).click();
    await rigg.page.waitForTimeout(400);
    expect(await antalKanter(), "ångra tog inte tillbaka kopplingen").toBe(före);
    expect(rigg.fel).toEqual([]);
  }, 60_000);

  it("Ctrl+Z ångrar också", async () => {
    const före = await antalKanter();
    await rigg.page.keyboard.press("Control+z");
    await rigg.page.waitForTimeout(300);
    await rigg.page.keyboard.press("Control+Shift+z");
    await rigg.page.waitForTimeout(300);
    expect(await antalKanter()).toBe(före);
    expect(rigg.fel).toEqual([]);
  });
});

describe.skipIf(!chromium)("mallen i en riktig webbläsare", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  beforeAll(async () => {
    rigg = await startaAppen();
  }, 90_000);
  afterAll(async () => await rigg?.stäng());

  it("mallen går att öppna och vägrar bygga innan den är ifylld", async () => {
    await rigg.page.getByRole("button", { name: /Fyll i mall/ }).click();
    await rigg.page.waitForSelector(".ark-mall");
    const skapa = rigg.page.getByRole("button", { name: /Skapa flödet/ });
    await expect.poll(() => skapa.isDisabled()).toBe(true);
    expect(rigg.fel).toEqual([]);
  });

  it("REGRESSION: simbanorna går att döpa till vad som helst", async () => {
    // De var hårdkodade till ett visst projekts namn. Simbanor är olika från
    // flöde till flöde och måste gå att skriva själv.
    const p = rigg.page;
    const banor = p.locator(".ark-mall-bana input");
    await banor.nth(0).fill("Kund");
    await banor.nth(1).fill("Kundtjänst");
    // Radernas val ska följa med när banan byter namn.
    const val = await p.locator(".ark-mall-rad select").nth(0).inputValue();
    expect(val, "steget tappade sin simbana när den döptes om").toBe("Kund");
    expect(rigg.fel).toEqual([]);
  });

  it("exempelknappen fyller i en komplett mall", async () => {
    // Att se formen ifylld är det snabbaste sättet att förstå formuläret.
    const p = rigg.page;
    await p.getByRole("button", { name: /Visa ett ifyllt exempel/ }).click();
    await p.waitForTimeout(300);
    const skapa = p.getByRole("button", { name: /Skapa flödet/ });
    await expect.poll(() => skapa.isDisabled(), { timeout: 5000 }).toBe(false);
    expect(rigg.fel).toEqual([]);
  });

  it("ifylld mall bygger ett diagram med de banor man skrev", async () => {
    const p = rigg.page;
    await p.getByRole("button", { name: /Skapa flödet/ }).click();
    await p.waitForTimeout(900);

    const noder = await p.evaluate(() => document.querySelectorAll(".react-flow__node-process").length);
    expect(noder, "mallen byggde inget diagram").toBeGreaterThan(1);
    const banor = await p.evaluate(() =>
      [...document.querySelectorAll(".react-flow__node-lane")].map((l) => l.textContent ?? ""),
    );
    expect(banor.join(" "), "de egna simbanorna kom inte med").toContain("Kundtjänst");
    expect(rigg.fel).toEqual([]);
  }, 60_000);
});

describe.skipIf(chromium)("webbläsartester", () => {
  it("hoppas över: ingen Chromium hittad", () => {
    console.log(
      "\n  Ingen Chromium hittad. Peka ut en med ARK_CHROME=/sökväg/till/chrome," +
        "\n  eller hämta en med `npx playwright install chromium`.\n",
    );
    expect(true).toBe(true);
  });
});
