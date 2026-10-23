/**
 * Webbläsartester för verktyget "Affärsprocess".
 *
 * REGRESSION (struktur): typen låg först som en väljare INUTI flödesschemat –
 * kravet är att den ska vara ett eget verktyg i skalet. Testet
 * låser att verktyget finns i sidomenyn, ritar processflödet med satelliter
 * vid byte, och att flödesschemat inte har någon diagramtypsväljare.
 *
 * Fas 5 (direktredigering): att dra ett objekt på ytan flyttar det PÅ
 * RIKTIGT – positionen överlever omkompileringen (sparas i mellanlagret som
 * fria koordinater) – och klick öppnar inspektörspanelen.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AFFARSPROCESS_EXEMPEL, findChromium, startaAppen } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("Affärsprocess som eget verktyg", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    // Affärsprocess är ett eget verktyg: det väljs när processen skapas, och
    // flödesschemat har ingen diagramtypsväljare.
    rigg = await startaAppen({ ny: { verktyg: "Affärsprocess", text: AFFARSPROCESS_EXEMPEL } });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
  });

  it("ritar exempelprocessen med kedja och satelliter", async () => {
    const text = await rigg.page.evaluate(
      () => document.querySelector(".ark-tool-main")?.textContent ?? "",
    );
    expect(text).toContain("Genomför urval");
    expect(text).toContain("ReachMee"); // [IT: …]-satelliten
    expect(text).toContain("Öka mångfald"); // [Krav: …]-satelliten
  });

  /**
   * Krav: "Jag vill kunna ha olika kopplingspunkter på själva objektet."
   * Klick på en koppling visar dragbara ändpunkter; drar man en till en annan
   * sida av objektet fäster pilen där i stället – och valet överlever att
   * layouten byggs om (det sparas i mellanlagret).
   */
  it("kopplingspunkten går att flytta till en annan sida av objektet", async () => {
    const { page } = rigg;
    /** Sista punkten på en kants väg, i skärmkoordinater. */
    const slut = (id: string) =>
      page.evaluate((i) => {
        const g = [...document.querySelectorAll<SVGGElement>(".react-flow__edge")].find(
          (e) => e.getAttribute("data-id") === i,
        );
        const p = g?.querySelector(".react-flow__edge-path") as SVGPathElement | null;
        if (!p) return null;
        const pt = p.getPointAtLength(p.getTotalLength());
        const s = new DOMPoint(pt.x, pt.y).matrixTransform(p.getScreenCTM()!);
        return { x: Math.round(s.x), y: Math.round(s.y) };
      }, id);

    // En HUKI-koppling känns igen på hovertexten ("U – Utför: …"), inte på
    // färgen – den kommer ur installationens symbolstil. Ta den LÄNGSTA –
    // tidigare tester har flyttat ett par objekt, och en koppling vars två
    // ändar nästan ligger på varandra säger ingenting om kopplingspunkter.
    const kant = await page.evaluate(() => {
      let bäst: { id: string; x: number; y: number; längd: number } | null = null;
      for (const g of [...document.querySelectorAll<SVGGElement>(".react-flow__edge")]) {
        const p = g.querySelector(".react-flow__edge-path") as SVGPathElement | null;
        const titel = g.querySelector("path.ark-edge-hint title")?.textContent ?? "";
        if (!p || !/^[HUKI] – /.test(titel)) continue;
        const längd = p.getTotalLength();
        if (bäst && längd <= bäst.längd) continue;
        const pt = p.getPointAtLength(längd * 0.5);
        const s = new DOMPoint(pt.x, pt.y).matrixTransform(p.getScreenCTM()!);
        bäst = { id: g.getAttribute("data-id")!, x: s.x, y: s.y, längd };
      }
      return bäst;
    });
    expect(kant, "hittade ingen HUKI-koppling").not.toBeNull();

    const före = await slut(kant!.id);
    // Klicket skickas till kantens EGET element. En klickpunkt räknad ur
    // geometrin (eller elementets mitt) kan hamna i en grannkants osynliga
    // träffyta, och då väljs fel koppling.
    await page.evaluate((i) => {
      const p = document.querySelector(`.react-flow__edge[data-id="${i}"] .react-flow__edge-path`);
      p?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, kant!.id);
    await page.waitForTimeout(300);
    const punkter = await page
      .locator(".ark-endpoint")
      .evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
      );
    expect(punkter, "inga dragbara ändpunkter på den valda kopplingen").toHaveLength(2);

    // MÅLändens handtag är det som ligger vid vägens slut (pilspetsen).
    const avst = (p: { x: number; y: number }) =>
      Math.hypot(p.x - före!.x, p.y - före!.y);
    const mål = avst(punkter[0]) <= avst(punkter[1]) ? punkter[0] : punkter[1];
    // …och objektet den fäster i är det som ligger vid vägens SLUT.
    const akt = (await page.evaluate((p) => {
      // Objektet vid pilspetsen letas GEOMETRISKT: kantens egna osynliga svep
      // ligger överst just där, så elementFromPoint hittar bara kanten.
      let bäst: { id: string | null; x: number; y: number; width: number; height: number } | null =
        null;
      let minsta = 14;
      for (const el of [...document.querySelectorAll(".react-flow__node")]) {
        const r = el.getBoundingClientRect();
        const dx = Math.max(r.left - p.x, 0, p.x - r.right);
        const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
        const avstånd = Math.hypot(dx, dy);
        if (avstånd <= minsta) {
          minsta = avstånd;
          bäst = { id: el.getAttribute("data-id"), x: r.x, y: r.y, width: r.width, height: r.height };
        }
      }
      return bäst;
    }, före!))!;
    expect(akt, "hittade inget objekt vid pilspetsen").not.toBeNull();
    await page.mouse.move(mål.x, mål.y);
    await page.mouse.down();
    await page.mouse.move(akt.x + 3, akt.y + akt.height / 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(800);

    const efter = await slut(kant!.id);
    expect(efter, "pilen slutar på samma ställe som förut").not.toEqual(före);
    // Den fäster i aktivitetens VÄNSTERkant (mitten är en av punkterna).
    expect(Math.abs(efter!.x - akt.x)).toBeLessThan(8);
    expect(Math.abs(efter!.y - (akt.y + akt.height / 2))).toBeLessThan(12);

    // De VALBARA punkterna syns medan kopplingen är vald: fem per sida på
    // vartdera objektet.
    expect(await page.locator(".ark-endpoint-val").count()).toBe(40);

    // Dubbelklick på ändpunkten tar bort den valda kopplingspunkten, så pilen
    // går tillbaka till den automatiska – och kan väljas på nytt.
    const kvar = await page
      .locator(".ark-endpoint")
      .evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
      );
    const närmast = kvar.reduce((a, b) =>
      Math.hypot(a.x - efter!.x, a.y - efter!.y) <= Math.hypot(b.x - efter!.x, b.y - efter!.y) ? a : b,
    );
    await page.mouse.dblclick(närmast.x, närmast.y);
    await page.waitForTimeout(700);
    expect(await slut(kant!.id), "kopplingspunkten gick inte att ta bort").toEqual(före);
    expect(rigg.fel).toEqual([]);
  });

  it("ett draget objekt flyttar sig och STANNAR där det släpptes", async () => {
    const { page } = rigg;
    const nod = page.locator('.react-flow__node[data-id="s2"]');
    const före = await nod.evaluate((el) => (el as HTMLElement).style.transform);

    const box = (await nod.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Förbi nodeDragThreshold i små steg, som en riktig hand.
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();

    // Ge omkompileringen (draft → modell → layout) en chans att rita om.
    await page.waitForTimeout(300);
    const efter = await nod.evaluate((el) => (el as HTMLElement).style.transform);
    expect(efter, "objektet flyttades inte").not.toBe(före);

    // Positionen ska ha SPARATS – den överlever att layouten byggs om (den
    // kommer ur mellanlagret, inte ur React Flows interna dragläge).
    await page.waitForTimeout(200);
    const kvar = await nod.evaluate((el) => (el as HTMLElement).style.transform);
    expect(kvar).toBe(efter);
    expect(rigg.fel).toEqual([]);
  });

  it("klick på en aktivitet öppnar inspektören med satellitgrupperna", async () => {
    const { page } = rigg;
    // s3 – inte s2, som dragtestet nyss flyttade (kan ligga delvis under ett
    // grannobjekt efter draget, och då är mittpunkten inte klickbar).
    await page.locator('.react-flow__node[data-id="s3"]').click();
    await page.waitForSelector(".ark-ap-inspektor", { timeout: 5_000 });
    const panel = await page.evaluate(
      () => document.querySelector(".ark-ap-inspektor")?.textContent ?? "",
    );
    expect(panel).toContain("Roller");
    expect(panel).toContain("IT-stöd");
    expect(panel).toContain("Krav");
    expect(panel).toContain("Ut-objekt");
    expect(rigg.fel).toEqual([]);
  });

  /**
   * REGRESSION: Shift-linjeringen fanns bara i flödesschemat. I affärsprocessvyn hände
   * ingenting när man höll inne Shift och drog ett objekt – linjeringsregeln var låst till flödesschemats nodtyp. Gesten
   * ska vara densamma i båda vyerna: röd hjälplinje medan man drar, och den
   * linjerade positionen ska ÖVERLEVA släppet (den går via mellanlagret).
   */
  it("REGRESSION: Shift linjerar ett draget objekt mot grannarna", async () => {
    const { page } = rigg;
    // s3:s roll – s2 har flyttats av dragtestet ovanför, och ett handtag kan
    // då ligga över objektet. Hjälplinjen måste vara OBJEKTENS (.ark-guide utan
    // .ark-edge-guide), annars kunde testet gå igenom på en kant-linjering.
    const id = "roll_s3_hr";
    const nod = page.locator(`.react-flow__node[data-id="${id}"]`);
    const box = (await nod.boundingBox())!;
    const x0 = box.x + box.width / 2;
    const y0 = box.y + box.height / 2;

    let hjälplinje = false;
    try {
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.keyboard.down("Shift");
      for (let dx = 4; dx <= 200 && !hjälplinje; dx += 4) {
        await page.mouse.move(x0 + dx, y0 + 2);
        await page.waitForTimeout(25);
        hjälplinje = await page.evaluate(
          () => document.querySelectorAll(".ark-guide:not(.ark-edge-guide)").length > 0,
        );
      }
    } finally {
      // MÅSTE släppas även om svepet misslyckas: en musknapp och en Shift som
      // blir kvar nere följer med in i NÄSTA test i filen, och då faller tester
      // som inte har med linjeringen att göra. (Det hände: kontrollpanelen
      // vägrade öppna sig i en full körning, men gick i en ensam.)
      await page.mouse.up();
      await page.keyboard.up("Shift");
    }
    expect(hjälplinje, "ingen röd hjälplinje under Shift-draget").toBe(true);
    await page.waitForTimeout(500);

    // Hjälplinjerna släcks vid släpp …
    expect(await page.evaluate(() => document.querySelectorAll(".ark-guide").length)).toBe(0);
    // … och objektet ligger kvar i linje med minst en granne efter att
    // positionen gått genom mellanlagret och layouten byggts om.
    const iLinje = await page.evaluate((valt) => {
      const mitt = (n: HTMLElement, axel: 1 | 2) => {
        const t = /translate\((-?[\d.]+)px, *(-?[\d.]+)px\)/.exec(n.style.transform);
        if (!t) return null;
        return +t[axel] + (axel === 1 ? n.offsetWidth : n.offsetHeight) / 2;
      };
      const alla = [...document.querySelectorAll<HTMLElement>(".react-flow__node")];
      const jag = alla.find((n) => n.getAttribute("data-id") === valt)!;
      return alla.some((n) => {
        if (n === jag) return false;
        const dx = mitt(n, 1);
        const dy = mitt(n, 2);
        const jx = mitt(jag, 1);
        const jy = mitt(jag, 2);
        return (
          (dx !== null && jx !== null && Math.abs(dx - jx) < 0.6) ||
          (dy !== null && jy !== null && Math.abs(dy - jy) < 0.6)
        );
      });
    }, id);
    expect(iLinje, "linjeringen överlevde inte släppet").toBe(true);
    expect(rigg.fel).toEqual([]);
  });

  /**
   * REGRESSION: verksamhetsobjektets ruta är lika bred som namnet under
   * symbolen. Pilen fäste i RUTANS kant och slutade långt ifrån den lilla
   * symbolen, mitt för texten – "stort avstånd mellan koppling och
   * verksamhetsobjekt". Kopplingspunkterna ska sitta på symbolen, och
   * det måste gälla React Flows egna handtag också, inte bara routern.
   */
  it("REGRESSION: pilen möter verksamhetsobjektets symbol, inte etikettrutans kant", async () => {
    const { page } = rigg;
    const mått = await page.evaluate(() => {
      // Ett verksamhetsobjekt i kedjan (liten symbol med namnet under).
      const nod = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].find((n) =>
        n.querySelector(".ark-ap-nod[title='Verksamhetsobjekt']"),
      );
      if (!nod) return null;
      const id = nod.getAttribute("data-id");
      const ruta = nod.getBoundingClientRect();
      const symbol = nod.querySelector("rect, path")!.getBoundingClientRect();
      // Kantens väg: sista punkten i den kant som går TILL objektet.
      const vägar = [...document.querySelectorAll<SVGGElement>(".react-flow__edge")]
        .filter((g) => (g.getAttribute("data-id") ?? "").length > 0)
        .map((g) => ({
          d: g.querySelector(".react-flow__edge-path")?.getAttribute("d") ?? "",
          el: g.querySelector(".react-flow__edge-path") as SVGPathElement,
        }))
        .filter((v) => v.d);
      // Båda ändarna på varje väg – objektet kan vara källa eller mål.
      const slutpunkter = vägar.flatMap((v) =>
        [0, v.el.getTotalLength()].map((l) => {
          const p = v.el.getPointAtLength(l);
          const skärm = new DOMPoint(p.x, p.y).matrixTransform(v.el.getScreenCTM()!);
          return { x: skärm.x, y: skärm.y };
        }),
      );
      return {
        id,
        rutaVänster: ruta.left,
        rutaMittY: ruta.top + ruta.height / 2,
        symbol: { v: symbol.left, h: symbol.right, mittY: symbol.top + symbol.height / 2 },
        slutpunkter,
      };
    });
    expect(mått, "hittade inget verksamhetsobjekt").not.toBeNull();
    const m = mått!;
    // Symbolen är smalare än rutan – annars säger testet ingenting.
    expect(m.symbol.v).toBeGreaterThan(m.rutaVänster);
    // Någon pil slutar VID symbolen, inte vid rutans kant längre ner.
    const träff = m.slutpunkter.some(
      (p) =>
        (Math.abs(p.x - m.symbol.v) < 10 || Math.abs(p.x - m.symbol.h) < 10) &&
        Math.abs(p.y - m.symbol.mittY) < 10,
    );
    // …och den möter INTE rutans mittlinje, som ligger nere i etiketten.
    expect(Math.abs(m.symbol.mittY - m.rutaMittY)).toBeGreaterThan(6);
    expect(
      träff,
      `ingen pil möter symbolen (symbol ${m.symbol.v.toFixed(0)},${m.symbol.mittY.toFixed(0)} – slut ${JSON.stringify(m.slutpunkter.map((p) => [Math.round(p.x), Math.round(p.y)]))})`,
    ).toBe(true);
    expect(rigg.fel).toEqual([]);
  });

  /**
   * REGRESSION: rollkopplingen ritades med bara bokstaven "U" och ingen
   * förklaring någonstans på ytan – den som inte kan modelleringsreglerna kunde inte ta
   * reda på vad den betydde. Hovertexten ska sitta på HELA kopplingens bana.
   * Bokstaven skrivs numera inte ut alls – ansvarslinjerna skiljs åt med färg
   * (beslut 2026-09-07, se `apRelationEtikett`) – så hovertexten är det enda
   * stället där innebörden står i klartext.
   */
  it("kopplingen bär en hovertext som förklarar HUKI-bokstaven", async () => {
    const { page } = rigg;
    const etiketter = await page.evaluate(() =>
      [...document.querySelectorAll(".ark-edge-label")].map((e) => (e.textContent ?? "").trim()),
    );
    expect(etiketter.filter((t) => /^[HUKI]$/.test(t)), "HUKI-bokstaven ritas ut igen").toEqual([]);

    const svep = await page.evaluate(() =>
      [...document.querySelectorAll("path.ark-edge-hint")].map((p) => ({
        titel: p.querySelector("title")?.textContent ?? "",
        pekare: getComputedStyle(p).pointerEvents,
      })),
    );
    const roll = svep.find((s) => s.titel.startsWith("U – Utför:"));
    expect(roll, `ingen förklaring på rollkopplingen: ${JSON.stringify(svep.slice(0, 5))}`)
      .toBeTruthy();
    expect(roll!.titel).toContain("utför");
    // Träffytan ska ligga på STRECKET – annars äter det osynliga svepet klick
    // i hela sin omslutande ruta.
    expect(roll!.pekare).toBe("stroke");
    expect(rigg.fel).toEqual([]);
  });

  /**
   * Krav: "jag vill kunna ändra storleken på texten på respektive objekt".
   * Klick på en ROLL öppnar aktivitetens panel – storleken ska ändå gälla
   * rollen man klickade på, och grannen ska vara orörd.
   */
  it("textstorleken går att ändra per objekt", async () => {
    const { page } = rigg;
    // s4:s roller – s2 har flyttats av dragtestet ovanför, och då kan dess
    // satellitstreck ha krympt så att objektet ligger under ett handtag.
    const roll = "roll_s4_rekryterande-chef";
    const granne = "roll_s4_hr";
    const font = (id: string) =>
      page.evaluate(
        (i) =>
          document.querySelector(`.react-flow__node[data-id="${i}"] text`)?.getAttribute("font-size") ??
          "",
        id,
      );
    const före = await font(roll);
    const grannFöre = await font(granne);
    expect(före).not.toBe("");

    await page.locator(`.react-flow__node[data-id="${roll}"]`).click();
    await page.waitForSelector(".ark-ap-textstorlek", { timeout: 5_000 });
    const grupp = page.locator(".ark-ap-textstorlek");
    await grupp.locator("button", { hasText: "A+" }).click();
    await page.waitForTimeout(400);

    expect(await font(roll), "textstorleken ändrades inte").not.toBe(före);
    expect(await font(granne), "grannens text ändrades också").toBe(grannFöre);
    expect(await grupp.locator(".ark-ap-textstorlek-varde").textContent()).toContain("110");

    // Återställ, så efterföljande tester ser exempelflödet som vanligt.
    await grupp.locator("button", { hasText: "Återställ" }).click();
    await page.waitForTimeout(400);
    expect(await font(roll)).toBe(före);
    expect(rigg.fel).toEqual([]);
  });

  /**
   * Krav: "Jag ska kunna påverka kopplingarna t.ex. ner mot HUKI."
   * Handtaget mitt på satellitstrecket låg tidigare under bokstavens vita
   * etikettruta och gick inte att greppa. Nu står bokstaven bredvid strecket
   * och handtaget sitter mitt på – draget ska ändra banan OCH överleva att
   * layouten byggs om (brytpunkten sparas i mellanlagret).
   */
  it("satellitkopplingen går att böja med sitt handtag", async () => {
    const { page } = rigg;
    const handtag = page.locator('.ark-edge-waypoint[data-edge="roll_s4_rekryterande-chef->s4"]');
    expect(await handtag.count(), "inget handtag på HUKI-kopplingen").toBe(1);

    const vägar = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].map((p) =>
          p.getAttribute("d"),
        ),
      );
    const före = await vägar();
    const b = (await handtag.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const efter = await vägar();
    expect(efter.filter((d, i) => d !== före[i]).length, "ingen kant ändrade väg").toBe(1);
    // Brytpunkten är sparad – handtaget markeras som satt efter omritningen.
    expect(await page.locator(".ark-edge-waypoint.set").count()).toBeGreaterThan(0);

    // Dubbelklick nollar den igen, så nästa test ser exempelflödet som vanligt.
    await page.locator(".ark-edge-waypoint.set").first().dblclick();
    await page.waitForTimeout(900);
    expect(await page.locator(".ark-edge-waypoint.set").count()).toBe(0);
    expect(rigg.fel).toEqual([]);
  });

  it("\"i\"-ikonens beskrivning syns i hovertexten", async () => {
    const { page } = rigg;
    // Exempelflödets aktiviteter saknar beskrivning; ge en och kontrollera att
    // både ikonen och hovertexten följer med.
    await page.locator('.react-flow__node[data-id="s3"]').click();
    await page.waitForSelector(".ark-ap-inspektor", { timeout: 5_000 });
    const fält = page.locator(".ark-ap-inspektor input").nth(1);
    await fält.fill("Annonsen läggs ut i ReachMee samma dag.");
    await fält.press("Enter");
    await page.waitForTimeout(500);

    const titel = await page.evaluate(
      () =>
        document
          .querySelector('.react-flow__node[data-id="s3"] .ark-ap-nod')
          ?.getAttribute("title") ?? "",
    );
    expect(titel).toContain("Annonsen läggs ut i ReachMee");
    expect(rigg.fel).toEqual([]);
  });

  it("affärsprocesskontrollen listar anmärkningar och klick markerar objektet", async () => {
    const { page } = rigg;
    // Exempelprocessen har roller men inga beskrivningar → kontrollen ger råd.
    // Märket bor i rullgardinen "Granska".
    await page.getByRole("button", { name: /^Granska/ }).click();
    const badge = page.locator(".ark-trace-badge");
    expect(await badge.textContent()).toContain("Affärsprocesskontroll");
    await badge.click();
    await page.waitForSelector(".ark-ap-kontroll", { timeout: 5_000 });
    const rader = page.locator(".ark-ap-anmarkning");
    expect(await rader.count()).toBeGreaterThan(0);
    // Klick på en anmärkning öppnar objektets panel.
    await rader.first().click();
    await page.waitForSelector(".ark-ap-inspektor", { timeout: 5_000 });
    expect(rigg.fel).toEqual([]);
  });

  it("paletten placerar en roll med klick-klick och öppnar inspektören", async () => {
    const { page } = rigg;
    const före = await page.locator(".ark-ap-nod").count();
    // Paletten är infälld tills man öppnar den.
    await page.getByRole("button", { name: "▧ Objekt" }).click();
    await page.locator(".ark-ap-palettobjekt", { hasText: "Roll" }).first().click();
    // Klicka strax under en aktivitet – satelliten hängs på närmaste utförare.
    const akt = page.locator('.react-flow__node[data-id="s2"]');
    const box = (await akt.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height + 40);
    await page.waitForTimeout(400);
    expect(await page.locator(".ark-ap-nod").count()).toBeGreaterThan(före);
    // Inspektören öppnas på det nya objektet så det kan döpas om direkt.
    // ("Ny roll" bor i ett INPUT-värde – textContent ser det inte.)
    await page.waitForSelector(".ark-ap-inspektor", { timeout: 5_000 });
    const värden = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>(".ark-ap-inspektor input")].map(
        (i) => i.value,
      ),
    );
    expect(värden).toContain("Ny roll");
    expect(rigg.fel).toEqual([]);
  });

  it("panelerna går att fälla in och ut", async () => {
    const { page } = rigg;
    // Objektpaletten: verktygsradens "▧ Objekt" fäller ut, ✕ fäller in.
    const objekt = page.getByRole("button", { name: "▧ Objekt" });
    if (!(await page.locator(".ark-ap-palett").count())) await objekt.click();
    await page.locator('.ark-ap-palett .ark-stang[title="Stäng objektpaletten"]').click();
    expect(await page.locator(".ark-ap-palett").count()).toBe(0);
    await objekt.click();
    expect(await page.locator(".ark-ap-palett").count()).toBe(1);
    // Beskrivningen (texten processen kommer ur), likadant.
    const beskrivning = page.getByRole("button", { name: "✎ Beskrivning" });
    if (!(await page.locator(".ark-textdock").count())) await beskrivning.click();
    await page.locator('.ark-textdock .ark-stang[title="Stäng beskrivningen"]').click();
    expect(await page.locator(".ark-textdock").count()).toBe(0);
    await beskrivning.click();
    expect(await page.locator(".ark-textdock").count()).toBe(1);
    expect(rigg.fel).toEqual([]);
  });

  /**
   * Krav: "bryt ut de olika flödena och lägg dessa i en meny för sig
   * alternativt under dess huvudförälder". Menyn är navigeringen: ett klick på
   * ett flöde öppnar det i sitt eget verktyg. Trädet visas i läsläget – i
   * redigeringen döljs det, så testet lämnar redigeringen först.
   */
  it("flödena listas i menyn under sin kategori och går att öppna därifrån", async () => {
    const { page } = rigg;
    await page.getByRole("button", { name: "✓ Klar" }).click();
    const kategori = page.locator(".ark-meny-kategori-titel", { hasText: "Exempel" });
    await kategori.waitFor({ timeout: 10_000 });
    // Varje kategori visar sitt antal.
    expect(await kategori.textContent()).toMatch(/Exempel\s*2/);

    // Sökningen fäller ut de grenar som har träffar. Exempelpaketets
    // affärsprocess: verktyget byts och flödet laddas.
    await page.fill(".ark-meny-filter", "Rekrytering");
    await page.locator(".ark-flow-menyval", { hasText: "Rekrytering" }).click();
    await page.waitForSelector(".ark-ap-nod", { timeout: 10_000 });
    expect(await page.locator(".ark-navval.active").innerText()).toContain("Rekrytering");
    expect(await page.locator(".ark-tool-main").innerText()).toContain("Genomför urval");
    expect(rigg.fel).toEqual([]);
  });

  it("kan byta till en systemprocess ur menyn utan fel", async () => {
    const { page } = rigg;
    await page.fill(".ark-meny-filter", "Beställ behörighet");
    await page.locator(".ark-flow-menyval", { hasText: "Beställ behörighet" }).click();
    await page.waitForSelector(".react-flow__node-process", { timeout: 10_000 });
    // Det andra verktyget ligger kvar monterat i ett dolt lager (aria-hidden).
    // Huvudet i det SYNLIGA lagret säger vilket verktyg som visar flödet …
    const aktivt = page.locator('.ark-verktygslager:not([aria-hidden="true"])');
    expect(await aktivt.locator(".ark-flow-header-verktyg").textContent()).toContain("Systemprocess");
    // … och affärsprocessen syns inte under det (båda ritades förr ovanpå varandra).
    const synligaAp = await page.evaluate(
      () =>
        [...document.querySelectorAll(".ark-ap-nod")].filter((e) =>
          e.checkVisibility({ visibilityProperty: true }),
        ).length,
    );
    expect(synligaAp).toBe(0);
    expect(rigg.fel).toEqual([]);
  });
});
