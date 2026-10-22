/**
 * Webbläsartester för kanternas etiketter, brytpunkter och banbyte.
 *
 * Tre buggar som bara syntes i riktig webbläsare:
 *  1. Ja/Nej-etiketterna försvann helt när grenpilarna korsade en sidbrytning –
 *     sidhänvisningen bar inte etiketten.
 *  2. Brytpunktshandtagen låg UNDER kanternas osynliga träffytor (z-index) och
 *     gick inte att greppa – "dra i banan" var dött fast handtagen syntes.
 *  3. Ett objekt gick inte att dra NEDÅT till en annan bana: banan växte ner
 *     runt objektet i stället (den omsluter sina noder), så bandgränsen flydde.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChromium, flödenFingeravtryck, startaAppen, väljFormat } from "./harness";

const chromium = findChromium();

describe.skipIf(!chromium)("kanter och banbyte i riktig webbläsare", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  const flödenFöre = flödenFingeravtryck();

  beforeAll(async () => {
    rigg = await startaAppen();
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    expect(flödenFingeravtryck(), "testerna ändrade flows/").toBe(flödenFöre);
  });

  it("REGRESSION: Ja/Nej följer med sidhänvisningen när grenen korsar ett snitt", async () => {
    // Sidhänvisningar finns bara i ett SIDBRUTET format – välj Word uttryckligen
    // (förvalet är Fri, och testet ska inte hänga på det produktbeslutet).
    // Exempelflödets Ja/Nej-pilar korsar ett snitt i Word-bredden.
    await väljFormat(rigg.page, "Word");
    const märken = await rigg.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".react-flow__node")]
        .map((n) => n.textContent ?? "")
        .filter((t) => t.includes("del ")),
    );
    const medEtikett = märken.filter((t) => /Ja|Nej/.test(t));
    expect(medEtikett.length, `sidhänvisningar: ${JSON.stringify(märken)}`).toBeGreaterThan(0);
  });

  it("REGRESSION: Ja/Nej syns som kantetiketter i fri form", async () => {
    await väljFormat(rigg.page, "Fri");
    // Etiketterna är pekartransparenta (pointer-events: none) så elementFromPoint
    // duger inte som synlighetsmått – mät geometri och att inget NODLAGER ligger
    // över (etikettlagret har z-index 3, över kanternas träffytor).
    const etiketter = await rigg.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".ark-edge-label")].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent,
          synlig:
            r.width > 0 &&
            r.height > 0 &&
            getComputedStyle(el).visibility !== "hidden" &&
            Number(getComputedStyle(el.closest(".react-flow__edgelabel-renderer")!).zIndex) >= 3,
        };
      }),
    );
    const jaNej = etiketter.filter((e) => e.text === "Ja" || e.text === "Nej");
    expect(jaNej.length, `etiketter: ${JSON.stringify(etiketter)}`).toBeGreaterThanOrEqual(2);
    expect(jaNej.every((e) => e.synlig), "etikett gömd eller under kanternas lager").toBe(true);
  });

  it("Shift-linjering: brytpunkten fäster mot en annan kants linje med röd hjälplinje", async () => {
    // Synpunkt: "jag försöker få linjerna på kopplingarna att linjera horisontellt
    // – näst intill omöjligt" på fri hand. Med Shift ska brytpunkten fästa mot
    // andra kanters raka segment, med samma röda hjälplinjer som objekten.
    const handtag = await rigg.page.evaluate(() => {
      const alla = [...document.querySelectorAll<HTMLElement>(".ark-edge-waypoint")];
      for (let i = 0; i < alla.length; i++) {
        const r = alla[i].getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        if (cx < 100 || cx > innerWidth - 100 || cy < 150 || cy > innerHeight - 200) continue;
        if (document.elementFromPoint(cx, cy) === alla[i]) return { cx, cy };
      }
      return null;
    });
    expect(handtag, "inget träffbart brytpunktshandtag i vyn").not.toBeNull();

    const vägar = () =>
      rigg.page.evaluate(() =>
        [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].map(
          (p) => p.getAttribute("d") ?? "",
        ),
      );
    const före = await vägar();

    await rigg.page.mouse.move(handtag!.cx, handtag!.cy);
    await rigg.page.mouse.down();
    await rigg.page.keyboard.down("Shift");
    // Svep lodrätt tills en VÅGRÄT röd hjälplinje dyker upp (bredare än hög)
    // – då ligger brytpunkten exakt i höjd med en annan kants linje.
    let linjeSedd = false;
    for (let dy = -90; dy <= 90; dy += 4) {
      await rigg.page.mouse.move(handtag!.cx, handtag!.cy + dy);
      await rigg.page.waitForTimeout(10);
      const vågrät = await rigg.page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".ark-edge-guide")].some(
          (g) => g.offsetWidth > g.offsetHeight,
        ),
      );
      if (vågrät) {
        linjeSedd = true;
        break; // släpp medan linjen syns – punkten är snappad
      }
    }
    expect(linjeSedd, "ingen röd hjälplinje under Shift-svepet").toBe(true);
    await rigg.page.mouse.up();
    await rigg.page.keyboard.up("Shift");
    await rigg.page.waitForTimeout(400);

    // Hjälplinjen släcks vid släpp.
    expect(await rigg.page.evaluate(() => document.querySelectorAll(".ark-edge-guide").length)).toBe(0);

    // Den ändrade kantens vågräta segment ligger nu EXAKT i höjd med en annan
    // kants segment – det var själva poängen med gesten.
    const efter = await vägar();
    const ändrad = efter.findIndex((d, i) => d !== före[i]);
    expect(ändrad, "ingen kant ändrades av draget").toBeGreaterThanOrEqual(0);
    const delarHöjd = await rigg.page.evaluate(
      ([allaD, ändradIndex]) => {
        const ysAv = (d: string) => {
          const pts = [...d.matchAll(/(-?[\d.]+)[, ](-?[\d.]+)/g)].map((m) => ({
            x: Number(m[1]),
            y: Number(m[2]),
          }));
          const ys: number[] = [];
          for (let i = 0; i < pts.length - 1; i++) {
            if (Math.abs(pts[i].y - pts[i + 1].y) < 0.01 && Math.abs(pts[i].x - pts[i + 1].x) > 1)
              ys.push(pts[i].y);
          }
          return ys;
        };
        const dList = allaD as string[];
        const egna = ysAv(dList[ändradIndex as number]);
        const andras = dList.flatMap((d, i) => (i === (ändradIndex as number) ? [] : ysAv(d)));
        return egna.some((y) => andras.some((a) => Math.abs(a - y) < 0.01));
      },
      [efter, ändrad] as const,
    );
    expect(delarHöjd, "den dragna kanten delar ingen exakt höjd med någon annan kant").toBe(true);

    // Städa: nolla brytpunkten så nästa test möter samma utgångsläge.
    const satt = await rigg.page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ark-edge-waypoint.set");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (satt) await rigg.page.mouse.dblclick(satt.x, satt.y);
    await rigg.page.waitForTimeout(200);
  });

  it("REGRESSION: brytpunktshandtaget går att träffa och dra – kanten byter väg", async () => {
    // Hitta ett handtag som pekaren faktiskt når (mitt i vyn, oskymt).
    const handtag = await rigg.page.evaluate(() => {
      const alla = [...document.querySelectorAll<HTMLElement>(".ark-edge-waypoint")];
      for (let i = 0; i < alla.length; i++) {
        const r = alla[i].getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        if (cx < 100 || cx > innerWidth - 100 || cy < 100 || cy > innerHeight - 150) continue;
        if (document.elementFromPoint(cx, cy) === alla[i]) return { i, cx, cy };
      }
      return null;
    });
    expect(handtag, "inget träffbart brytpunktshandtag i vyn").not.toBeNull();

    const vägarFöre = await rigg.page.evaluate(() =>
      [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].map((p) =>
        p.getAttribute("d"),
      ),
    );

    await rigg.page.mouse.move(handtag!.cx, handtag!.cy);
    await rigg.page.mouse.down();
    for (let s = 1; s <= 8; s++) {
      await rigg.page.mouse.move(handtag!.cx, handtag!.cy + s * 8);
      await rigg.page.waitForTimeout(15);
    }
    await rigg.page.mouse.up();
    await rigg.page.waitForTimeout(400);

    const vägarEfter = await rigg.page.evaluate(() =>
      [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].map((p) =>
        p.getAttribute("d"),
      ),
    );
    expect(vägarEfter, "ingen kant bytte väg av draget").not.toEqual(vägarFöre);
    // En satt brytpunkt markeras på handtaget.
    const satta = await rigg.page.evaluate(
      () => document.querySelectorAll(".ark-edge-waypoint.set").length,
    );
    expect(satta).toBeGreaterThan(0);

    // Dubbelklick nollar brytpunkten – och det ska SYNAS att den nollats.
    // (Dubbelklicken svaldes länge av canvasens dubbelklick-zoom.)
    const satt = await rigg.page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".ark-edge-waypoint.set");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    expect(satt).not.toBeNull();
    await rigg.page.mouse.dblclick(satt!.cx, satt!.cy);
    await rigg.page.waitForTimeout(400);
    expect(
      await rigg.page.evaluate(() => document.querySelectorAll(".ark-edge-waypoint.set").length),
      "brytpunkten nollades inte av dubbelklicket",
    ).toBe(0);
  });

  it("REGRESSION: det går att dra en pil FRÅN ett datalager (Loggpost skapas)", async () => {
    // Cylinderns handtag var gömda och odragbara – det gick inte att dra en
    // koppling från t.ex. "Loggpost skapas" alls, trots att ett datalager är
    // en giltig ände på en dataassociation.
    const start = await rigg.page.evaluate(() => {
      const ds = document.querySelector<HTMLElement>(".react-flow__node-datastore");
      if (!ds) return null;
      const handtag = ds.querySelector<HTMLElement>(".react-flow__handle-right.source");
      if (!handtag) return { saknarHandtag: true } as const;
      const h = handtag.getBoundingClientRect();
      // Ett mål att koppla till: närmaste processnod till höger om lagret.
      const dsRect = ds.getBoundingClientRect();
      const mål = [...document.querySelectorAll<HTMLElement>(".react-flow__node-process")]
        .map((n) => n.getBoundingClientRect())
        .filter((r) => r.width > 8 && r.x > dsRect.x + dsRect.width)
        .sort((a, b) => a.x - b.x)[0];
      if (!mål) return null;
      return {
        saknarHandtag: false,
        hx: h.x + h.width / 2,
        hy: h.y + h.height / 2,
        // Släpp PÅ målets vänstra kant – kopplingen fäster i ett målhandtag,
        // inte i nodens mitt.
        mx: mål.x + 2,
        my: mål.y + mål.height / 2,
      } as const;
    });
    expect(start, "hittade inget datalager med mål i vyn").not.toBeNull();
    expect((start as { saknarHandtag: boolean }).saknarHandtag, "datalagret saknar dragbart handtag").toBe(false);
    const s = start as { hx: number; hy: number; mx: number; my: number };

    const kanterFöre = await rigg.page.evaluate(
      () => document.querySelectorAll(".react-flow__edge").length,
    );
    await rigg.page.mouse.move(s.hx, s.hy);
    await rigg.page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await rigg.page.mouse.move(s.hx + ((s.mx - s.hx) * i) / 10, s.hy + ((s.my - s.hy) * i) / 10);
      await rigg.page.waitForTimeout(15);
    }
    await rigg.page.mouse.up();
    await rigg.page.waitForTimeout(500);

    const kanterEfter = await rigg.page.evaluate(
      () => document.querySelectorAll(".react-flow__edge").length,
    );
    expect(kanterEfter, "ingen koppling skapades av draget från datalagret").toBeGreaterThan(kanterFöre);
    expect(rigg.fel).toEqual([]);
  });

  it("REGRESSION: ett objekt släppt i bandet NEDANFÖR byter bana på riktigt", async () => {
    // Ta ett processobjekt vars band har ett band under sig, och dra det dit.
    const mål = await rigg.page.evaluate(() => {
      const band = [...document.querySelectorAll<HTMLElement>(".ark-lane")]
        .map((l) => {
          const r = l.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height };
        })
        .sort((a, b) => a.top - b.top);
      for (const n of document.querySelectorAll<HTMLElement>(".react-flow__node-process")) {
        const r = n.getBoundingClientRect();
        if (r.width < 8) continue;
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        if (cx < 150 || cx > innerWidth - 150 || cy < 120) continue;
        const i = band.findIndex((b) => cy >= b.top && cy < b.bottom);
        if (i >= 0 && i + 1 < band.length && band[i + 1].height > 40 && band[i + 1].bottom < innerHeight - 60) {
          const träff = document.elementFromPoint(cx, cy);
          if (!träff?.closest(".react-flow__node-process")) continue;
          return {
            id: n.getAttribute("data-id"),
            cx,
            cy,
            // Mitt i bandet under.
            målY: (band[i + 1].top + band[i + 1].bottom) / 2,
          };
        }
      }
      return null;
    });
    expect(mål, "hittade inget objekt med ett band under sig").not.toBeNull();

    await rigg.page.mouse.move(mål!.cx, mål!.cy);
    await rigg.page.mouse.down();
    for (let s = 1; s <= 12; s++) {
      await rigg.page.mouse.move(mål!.cx, mål!.cy + ((mål!.målY - mål!.cy) * s) / 12);
      await rigg.page.waitForTimeout(15);
    }
    await rigg.page.mouse.up();
    await rigg.page.waitForTimeout(600);

    // Efter ombyggnaden ska objektet ligga i ett ANNAT band än det startade i –
    // på sin auto-plats i nya banan (banbyte nollar det gamla läget), och
    // banorna ska inte ha vuxit ner runt det.
    const efter = await rigg.page.evaluate((id) => {
      const n = document.querySelector<HTMLElement>(`.react-flow__node-process[data-id="${id}"]`);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const cy = r.y + r.height / 2;
      const band = [...document.querySelectorAll<HTMLElement>(".ark-lane")]
        .map((l) => l.getBoundingClientRect())
        .sort((a, b) => a.top - b.top);
      return { bandIndex: band.findIndex((b) => cy >= b.top && cy < b.bottom) };
    }, mål!.id);
    expect(efter, "objektet försvann").not.toBeNull();

    const startBand = await rigg.page.evaluate(
      (y) =>
        [...document.querySelectorAll<HTMLElement>(".ark-lane")]
          .map((l) => l.getBoundingClientRect())
          .sort((a, b) => a.top - b.top)
          .findIndex((b) => y >= b.top && y < b.bottom),
      mål!.cy,
    );
    expect(efter!.bandIndex, "objektet bytte aldrig band").not.toBe(startBand);
    expect(rigg.fel).toEqual([]);
  });
});
