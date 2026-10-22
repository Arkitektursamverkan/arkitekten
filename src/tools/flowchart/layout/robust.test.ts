/**
 * Layoutmotorn får aldrig kunna hänga eller kasta på ett dåligt värde.
 *
 * Banhöjden och nodpositionerna kommer från musdrag och från sparade filer.
 * Ett skenande eller trasigt värde där tog ned hela sidan: höjden styr
 * radantalet, radantalet styr hur många varv nodplaceringen gör, och ett NaN
 * gick rakt igenom till `new Array(radantal)` som kastar RangeError.
 */

import { describe, expect, it } from "vitest";
import { compileDraft, setLaneHeight, setStepPosition } from "@/core/draft";
import { textToDraft } from "../parser/toDraft";
import { layoutModel, MAX_LANE_HEIGHT } from "./layout";
import { PAGE_FORMATS } from "./layout";

const TEXT = `Testflöde
A startar → B i portalen → C i portalen → Power Automate flödet triggas → Mejl skickas till handläggaren → D avslutar`;

const draft = textToDraft(TEXT);
const laneId = compileDraft(draft).swimlanes[0].id;
const stegId = compileDraft(draft).nodes[1].id;

describe("banhöjd som inte går att lita på", () => {
  for (const [namn, höjd] of [
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["negativ", -500],
    ["noll", 0],
    ["skenande (90 000 px)", 90_000],
  ] as const) {
    it(`${namn} varken kastar eller hänger`, () => {
      const modell = compileDraft(setLaneHeight(draft, laneId, höjd));
      for (const bredd of [null, 1000, 777]) {
        const lo = layoutModel(modell, { pageWidth: bredd });
        expect(lo.nodes).toHaveLength(modell.nodes.length);
        for (const l of lo.lanes) {
          expect(Number.isFinite(l.h), `banhöjden blev ${l.h}`).toBe(true);
          expect(l.h).toBeLessThanOrEqual(MAX_LANE_HEIGHT + 200);
        }
        expect(Number.isFinite(lo.height)).toBe(true);
        expect(Number.isFinite(lo.width)).toBe(true);
      }
    });
  }

  it("radantalet begränsas av antalet noder, inte av höjden", () => {
    // Utan taket prövade varje nod VARJE rad – 1 190 rader vid 90 000 px höjd,
    // om och om igen för varje musrörelse under dragningen.
    const start = performance.now();
    const modell = compileDraft(setLaneHeight(draft, laneId, MAX_LANE_HEIGHT));
    for (let i = 0; i < 50; i++) layoutModel(modell, { pageWidth: 777 });
    expect(performance.now() - start, "layouten är för långsam under ett drag").toBeLessThan(2000);
  });
});

describe("nodposition som inte går att lita på", () => {
  for (const [namn, pos] of [
    ["NaN", { x: NaN, y: NaN }],
    ["Infinity", { x: Infinity, y: 10 }],
    ["halvt NaN", { x: 100, y: NaN }],
  ] as const) {
    it(`${namn} faller tillbaka på auto-placering`, () => {
      const modell = compileDraft(setStepPosition(draft, stegId, pos));
      for (const bredd of [null, 1000, 777]) {
        const lo = layoutModel(modell, { pageWidth: bredd });
        const n = lo.nodes.find((x) => x.node.id === stegId)!;
        expect(Number.isFinite(n.x), `x blev ${n.x}`).toBe(true);
        expect(Number.isFinite(n.y), `y blev ${n.y}`).toBe(true);
        // Noden ska ligga i sin egen bana, som om ingen position vore satt.
        const band = lo.lanes.filter((l) => l.id === n.node.laneId);
        expect(band.some((l) => n.y >= l.y && n.y + n.h <= l.y + l.h)).toBe(true);
      }
    });
  }
});

describe("REGRESSION: en position ur en annan koordinatrymd får inte spränga bilden", () => {
  // En tidigare bugg sparade skärmpositionen medan flödet var delat på sidor.
  // Del 5 börjar runt y=4000, så noden fick y≈4000 sparat. I den fria vyn
  // användes värdet rakt av: banan omsluter alltid sina noder, så banan blev
  // 3 947 px och diagrammet 19 gånger för högt. Kameran stod kvar, och det såg
  // ut som att ALLA objekt försvunnit – fast de bara hamnat utanför bild.
  const ren = layoutModel(compileDraft(draft), { pageWidth: null });
  // Måste vara ett riktigt STEG. Automatgenererade noder (t.ex. slutnoden
  // "auto1") finns inte i draft.steps, så setStepPosition gör ingenting för dem.
  const stegIds = new Set(draft.steps.map((x) => x.id));
  const offer = ren.nodes.find((n) => stegIds.has(n.node.id))!.node.id;

  for (const y of [4000, 20000, 250000]) {
    it(`y=${y} ignoreras och diagrammet behåller sin storlek`, () => {
      const modell = compileDraft(setStepPosition(draft, offer, { x: 300, y }));
      for (const bredd of [null, PAGE_FORMATS.word.width]) {
        const lo = layoutModel(modell, { pageWidth: bredd });
        const jämför = layoutModel(compileDraft(draft), { pageWidth: bredd });
        expect(lo.height, `diagrammet svällde vid bredd ${bredd}`).toBeCloseTo(jämför.height, 0);
        const n = lo.nodes.find((x) => x.node.id === offer)!;
        const band = lo.lanes.filter((l) => l.id === n.node.laneId);
        expect(
          band.some((l) => n.y >= l.y - 1 && n.y + n.h <= l.y + l.h + 1),
          "noden hamnade utanför sin bana",
        ).toBe(true);
      }
    });
  }

  it("en RIMLIG förflyttning respekteras fortfarande", () => {
    // Skyddet får inte äta upp vanliga justeringar.
    const n0 = ren.nodes.find((x) => x.node.id === offer)!;
    const modell = compileDraft(setStepPosition(draft, offer, { x: n0.x + 120, y: n0.y + 60 }));
    const n = layoutModel(modell, { pageWidth: null }).nodes.find((x) => x.node.id === offer)!;
    expect(n.x).toBeCloseTo(n0.x + 120, 0);
    expect(n.y).toBeCloseTo(n0.y + 60, 0);
  });

  it("ingen bana kan bli högre än taket, oavsett nodpositioner", () => {
    let smutsat = draft;
    for (const n of ren.nodes) smutsat = setStepPosition(smutsat, n.node.id, { x: 400, y: 60000 });
    for (const bredd of [null, PAGE_FORMATS.word.width]) {
      const lo = layoutModel(compileDraft(smutsat), { pageWidth: bredd });
      for (const l of lo.lanes) expect(l.h).toBeLessThanOrEqual(MAX_LANE_HEIGHT + 100);
      expect(lo.nodes).toHaveLength(ren.nodes.length);
    }
  });
});

describe("REGRESSION: en bana ska gå att minska", () => {
  // Minimihöjden `minLaneH` var ett hårt golv även för en MANUELL höjd. Drog
  // man ihop banan stannade den på 138 px oavsett hur hårt man drog, för
  // marginalen inuti räknades alltid i full storlek. Det såg ut som att banan
  // inte gick att minska alls.
  const bana = compileDraft(draft).swimlanes[1].id;
  const auto = layoutModel(compileDraft(draft), { pageWidth: null }).lanes.find((l) => l.id === bana)!;

  it("följer nedåt förbi den automatiska minimihöjden", () => {
    const liten = layoutModel(compileDraft(setLaneHeight(draft, bana, 90)), { pageWidth: null })
      .lanes.find((l) => l.id === bana)!;
    expect(liten.h).toBeLessThan(auto.h);
    expect(liten.h, "banan krympte inte förbi det gamla golvet 138 px").toBeLessThan(138);
  });

  it("höjden gäller EXAKT – ryms inte innehållet kommer ett råd, inget veto", () => {
    // Användaren äger banhöjden till 100 %. En för liten höjd låter noderna
    // sticka ut (medvetet) och layouten rapporterar rekommenderad minsta höjd.
    for (const h of [120, 100, 80, 40]) {
      const lo = layoutModel(compileDraft(setLaneHeight(draft, bana, h)), { pageWidth: null });
      const band = lo.lanes.find((l) => l.id === bana)!;
      expect(Math.round(band.h), `höjden ${h} respekterades inte`).toBe(h);
      const botten = Math.max(...lo.nodes.filter((x) => x.node.laneId === bana).map((n) => n.y + n.h));
      if (botten > band.y + band.h + 1) {
        expect(
          lo.laneVarningar?.some((v) => v.laneId === bana),
          `höjd ${h}: innehållet sticker ut utan rekommendation`,
        ).toBe(true);
      }
    }
  });

  it("förstora och dra tillbaka landar på samma höjd som från början", () => {
    // Radantalet styrs av höjden, så en förstoring sprider noderna på fler
    // rader. Om det påverkade golvet gick banan inte att få tillbaka.
    const stor = layoutModel(compileDraft(setLaneHeight(draft, bana, 800)), { pageWidth: null })
      .lanes.find((l) => l.id === bana)!;
    expect(stor.h).toBeCloseTo(800, 0);
    const tillbaka = layoutModel(compileDraft(setLaneHeight(draft, bana, auto.h)), { pageWidth: null })
      .lanes.find((l) => l.id === bana)!;
    expect(tillbaka.h).toBeCloseTo(auto.h, 0);
  });
});

describe("REGRESSION: datalager stannar i sitt band", () => {
  // En skenande sparad position (bild 4) ritade cylindern långt utanför sin
  // del, tvärs över sidramarna, och sträckte SharePoint-bandet på delar som
  // såg tomma ut. Rimlighetsvakten gäller nu även datalager, och positionen
  // klampas alltid in i bandets höjdintervall.
  const text = `Test
Fel uppkommer → Power Automate flödet triggas → Loggpost skapas → Mejl skickas till handläggaren`;

  it("en skenande position förkastas – lagret ritas på sin autoplats", () => {
    const d = textToDraft(text);
    const lager = d.steps.find((s) => s.type === "datastore")!;
    const trasig = {
      ...d,
      steps: d.steps.map((s) =>
        s.id === lager.id ? { ...s, position: { x: 4000, y: 3000 } } : s,
      ),
    };
    const lo = layoutModel(compileDraft(trasig), { pageWidth: null });
    const ds = lo.dataStores[0]!;
    const band = lo.lanes.find((l) => l.id === ds.store.laneId)!;
    expect(ds.y).toBeGreaterThanOrEqual(band.y);
    expect(ds.y + ds.h).toBeLessThanOrEqual(band.y + band.h + 1);
    expect(lo.height, "diagrammet blåstes upp av den trasiga positionen").toBeLessThan(1500);
  });

  it("även en 'rimlig' men felplacerad position klampas in i bandet", () => {
    const d = textToDraft(text);
    const lager = d.steps.find((s) => s.type === "datastore")!;
    const lo0 = layoutModel(compileDraft(d), { pageWidth: null });
    const ds0 = lo0.dataStores[0]!;
    // 300 px under autoplatsen: inom driftgränsen men utanför bandet.
    const flyttad = {
      ...d,
      steps: d.steps.map((s) =>
        s.id === lager.id ? { ...s, position: { x: ds0.x, y: ds0.y + 300 } } : s,
      ),
    };
    const lo = layoutModel(compileDraft(flyttad), { pageWidth: null });
    const ds = lo.dataStores[0]!;
    const band = lo.lanes.find((l) => l.id === ds.store.laneId)!;
    expect(ds.y + ds.h, "lagret lämnade sitt band").toBeLessThanOrEqual(band.y + band.h + 1);
  });
});
