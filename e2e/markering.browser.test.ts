/**
 * Webbläsartester för MARKERINGSRAMEN: dra en ram på tom yta, markera flera
 * objekt, flytta dem tillsammans (beslut 2026-09-07).
 *
 * Varför i en riktig webbläsare: gesten hänger på saker som bara finns när
 * appen körs. Ramen startar bara när musnedslaget landar på själva ritytan –
 * och banbanden täcker hela diagramytan, så den kräver att banden släpper
 * igenom musen. Och flytten sparas bara om ALLA markerade objekt får sin nya
 * plats; sparas bara det man höll i hoppar de andra tillbaka vid nästa
 * omritning, vilket inget komponenttest märker.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, objektPositioner, startaAppen } from "./harness";

const chromium = findChromium();

interface Ruta {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Drar en markeringsram runt två objekt och svarar med id:na som blev
 * markerade. Ramen räknas ur BÅDAS rutor (min/max) – tas hörnet bara ur det
 * första objektet hamnar det andra utanför så fort det ligger högre upp, och
 * testet mäter då fel sak. Starthörnet måste ligga på tom rityta: ramen börjar
 * bara där.
 */
async function draRam(page: Awaited<ReturnType<typeof startaAppen>>["page"], a: Ruta, b: Ruta, nodklass: string) {
  const slut = { x: Math.max(a.x + a.w, b.x + b.w) + 24, y: Math.max(a.y + a.h, b.y + b.h) + 24 };
  // Leta ett hörn som ligger på SJÄLVA ritytan. React Flow startar ramen bara
  // när nedslagets target är ritytan – en pil eller ett märke i vägen räcker
  // för att gesten ska utebli, precis som för den som drar med musen.
  let start: { x: number; y: number } | null = null;
  for (const marginal of [24, 40, 60, 80]) {
    const p = { x: Math.min(a.x, b.x) - marginal, y: Math.min(a.y, b.y) - marginal };
    const påRitytan = await page.evaluate(
      (q) => document.elementFromPoint(q.x, q.y) === document.querySelector(".react-flow__pane"),
      p,
    );
    if (påRitytan) {
      start = p;
      break;
    }
  }
  expect(start, "hittade ingen tom rityta att börja ramen på").not.toBeNull();
  if (!start) throw new Error("ingen startpunkt");

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(
      start.x + ((slut.x - start.x) * i) / 10,
      start.y + ((slut.y - start.y) * i) / 10,
    );
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  return page.$$eval(`${nodklass}.selected`, (n) => n.map((e) => e.getAttribute("data-id") ?? ""));
}

describe.skipIf(!chromium)("markera flera objekt med en ram", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  /** Fäller ut menyn hela vägen ner till flödesraderna (som lager-testet). */
  async function fällUtMenyn() {
    for (const sel of [".ark-meny-kategori-titel", ".ark-meny-arende"]) {
      for (let varv = 0; varv < 4; varv++) {
        const stängda = rigg.page.locator(`${sel}:has(.ark-meny-pil:text-is("▸"))`);
        const antal = await stängda.count();
        if (!antal) break;
        for (let i = 0; i < antal; i++) await stängda.nth(0).click().catch(() => {});
        await rigg.page.waitForTimeout(150);
      }
    }
  }

  beforeAll(async () => {
    // Appen börjar i katalogen; ett flöde måste öppnas innan det finns en
    // rityta att dra ramar på.
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    await fällUtMenyn();
    await rigg.page.locator(".ark-flow-menyval").first().click();
    await rigg.page.waitForSelector(".react-flow__node-process", { timeout: 20_000 });
    // Ett öppnat flöde visas i LÄSLÄGE, där vänsterdraget panorerar. Ramen hör
    // till redigeringsläget – det är hela poängen med gesten.
    await rigg.page.getByRole("button", { name: "✎ Redigera" }).click();
    await rigg.page.waitForTimeout(700);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (rigg) expect(rigg.flöden(), "testerna ändrade flows/").toBe(rigg.flödenFöre);
  });

  /** Två objekt som ligger bredvid varandra, med plats runt om att dra i. */
  const målObjekt = () =>
    rigg.page.evaluate(() => {
      const alla = [...document.querySelectorAll<HTMLElement>(".react-flow__node-process")]
        .map((n) => {
          const r = n.getBoundingClientRect();
          return { id: n.getAttribute("data-id") ?? "", x: r.x, y: r.y, w: r.width, h: r.height };
        })
        // Håll god marginal till panelen till vänster och till fönsterkanterna.
        .filter(
          (k) =>
            k.w > 8 &&
            k.x > 640 &&
            k.x + k.w < innerWidth - 60 &&
            k.y > 160 &&
            k.y + k.h < innerHeight - 140,
        )
        .sort((a, b) => a.x - b.x);
      return alla.slice(0, 2);
    });

  it("bandet under pekaren släpper igenom musen till ritytan", async () => {
    const mål = await målObjekt();
    expect(mål.length, "hittade inte två objekt att rama in").toBe(2);
    // Punkten strax ovanför det första objektet ligger MITT I ett banband.
    const påRitytan = await rigg.page.evaluate(
      (p) => document.elementFromPoint(p.x, p.y) === document.querySelector(".react-flow__pane"),
      { x: mål[0].x - 24, y: mål[0].y - 24 },
    );
    expect(påRitytan, "nedslaget landade på ett band i stället för på ritytan").toBe(true);
  });

  it("ramen markerar alla objekt den nuddar, och draget flyttar dem tillsammans", async () => {
    const mål = await målObjekt();
    const [a, b] = mål;
    const markerade = await draRam(rigg.page, a, b, ".react-flow__node-process");
    expect(markerade, "ramen markerade inte båda objekten").toEqual(
      expect.arrayContaining([a.id, b.id]),
    );

    // …och nu FLYTTAS de tillsammans. Draget tas i mitten av det första
    // objektet – där markeringens egen dragruta ligger.
    const före = await objektPositioner(rigg.page);
    await rigg.page.mouse.move(a.x + a.w / 2, a.y + a.h / 2);
    await rigg.page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await rigg.page.mouse.move(a.x + a.w / 2, a.y + a.h / 2 + i * 5);
      await rigg.page.waitForTimeout(10);
    }
    await rigg.page.mouse.up();
    // Vänta ut omkompileringen: sparades bara det ena objektets läge hoppar
    // det andra tillbaka här, och det är precis felet testet ska fånga.
    await rigg.page.waitForTimeout(700);

    const efter = await objektPositioner(rigg.page);
    expect(efter[a.id], `${a.id} flyttades inte`).not.toBe(före[a.id]);
    expect(efter[b.id], `${b.id} följde inte med markeringen`).not.toBe(före[b.id]);
  });

  /**
   * Växeln mellan markering och hand. Gesterna delar vänsterknapp, så valet
   * måste synas OCH kännas: pekaren är ett kryss i markeringsläget och en hand
   * i flyttläget – annars lovar handen en flytt som inte händer.
   */
  it("växeln byter både gest och pekare", async () => {
    const pekare = () =>
      rigg.page.evaluate(
        () => getComputedStyle(document.querySelector(".react-flow__pane")!).cursor,
      );
    const kamera = () =>
      rigg.page.evaluate(
        () => document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "",
      );

    expect(await pekare(), "markeringsläget ska ha kryss, inte hand").toBe("crosshair");

    await rigg.page.getByRole("button", { name: "Flytta vyn" }).click();
    await rigg.page.waitForTimeout(150);
    expect(await pekare()).toBe("grab");

    // …och nu flyttar vänsterdraget vyn i stället för att rita en ram.
    const tom = await rigg.page.evaluate(() => {
      const pane = document.querySelector(".react-flow__pane")!;
      for (let y = 200; y < innerHeight - 200; y += 20) {
        for (let x = 700; x < innerWidth - 200; x += 20) {
          if (document.elementFromPoint(x, y) === pane) return { x, y };
        }
      }
      return null;
    });
    expect(tom, "hittade ingen tom rityta att panorera från").not.toBeNull();
    const före = await kamera();
    await rigg.page.mouse.move(tom!.x, tom!.y);
    await rigg.page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await rigg.page.mouse.move(tom!.x - i * 8, tom!.y - i * 4);
      await rigg.page.waitForTimeout(10);
    }
    await rigg.page.mouse.up();
    await rigg.page.waitForTimeout(200);
    expect(await kamera(), "handen flyttade inte vyn").not.toBe(före);
    expect(
      await rigg.page.$$eval(".react-flow__node-process.selected", (n) => n.length),
      "handen ritade en markeringsram i stället för att flytta vyn",
    ).toBe(0);

    // Tillbaka till markering: krysset kommer igen.
    await rigg.page.getByRole("button", { name: "Markera" }).click();
    await rigg.page.waitForTimeout(150);
    expect(await pekare()).toBe("crosshair");
  });
});

/**
 * Samma gest i verktyget Affärsprocess. Motorn är en annan (egen layout, egna former),
 * men musen ska göra samma sak – gestkonstanterna delas i canvas-gester.ts.
 */
describe.skipIf(!chromium)("markera flera affärsprocessobjekt med en ram", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;

  beforeAll(async () => {
    rigg = await startaAppen({ väntaPå: ".ark-meny-kategori-titel" });
    for (const sel of [".ark-meny-kategori-titel", ".ark-meny-arende"]) {
      for (let varv = 0; varv < 4; varv++) {
        const stängda = rigg.page.locator(`${sel}:has(.ark-meny-pil:text-is("▸"))`);
        const antal = await stängda.count();
        if (!antal) break;
        for (let i = 0; i < antal; i++) await stängda.nth(0).click().catch(() => {});
        await rigg.page.waitForTimeout(150);
      }
    }
    // Sista menyvalet är en affärsprocess (samma väg som lager-testet tar).
    await rigg.page.locator(".ark-flow-menyval").last().click();
    await rigg.page.waitForSelector(".ark-ap-nod", { timeout: 20_000 });
    await rigg.page.getByRole("button", { name: "✎ Redigera" }).click();
    await rigg.page.waitForTimeout(700);
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (rigg) expect(rigg.flöden(), "testerna ändrade flows/").toBe(rigg.flödenFöre);
  });

  it("ramen markerar alla objekt den nuddar", async () => {
    const mål = await rigg.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".react-flow__node-ap")]
        .map((n) => {
          const r = n.getBoundingClientRect();
          return { id: n.getAttribute("data-id") ?? "", x: r.x, y: r.y, w: r.width, h: r.height };
        })
        .filter(
          (k) =>
            k.w > 8 &&
            k.x > 640 &&
            k.x + k.w < innerWidth - 60 &&
            k.y > 160 &&
            k.y + k.h < innerHeight - 140,
        )
        .sort((a, b) => a.x - b.x)
        .slice(0, 2),
    );
    expect(mål.length, "hittade inte två affärsprocessobjekt att rama in").toBe(2);
    const [a, b] = mål;
    const markerade = await draRam(rigg.page, a, b, ".react-flow__node-ap");
    expect(markerade, "ramen markerade inte båda objekten").toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
  });
});
