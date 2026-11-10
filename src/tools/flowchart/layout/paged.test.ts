import { describe, expect, it } from "vitest";
import { parseToModel } from "../parser/parse";
import fs from "node:fs";
import { BASE_DIMS, hänvisningsStubbe, layoutModel } from "./layout";
import { compileDraft, removeEdge, setLaneHeight, setPageRefHidden, setStepPosition } from "@/core/draft";
import { textToDraft } from "../parser/toDraft";

const LONG = `Testflöde
A → B → C → D → E → F → G → H → I → J → K → L`;

/** Fyra banor och ett flöde som är många gånger bredare än en A4. */
const BRETT = `Testflöde
A startar → B i portalen → C i portalen → D i portalen → Driftfråga inkommer i SP-listan Inkorgen → Power Automate flödet triggas → Mejl skickas till handläggaren → E i portalen → Loggpost skapas → F i portalen → G avslutar`;

describe("sidformat: flera SIDOR i full skala", () => {
  const model = parseToModel(LONG);

  it("fri layout ger EN rad och EN sida", () => {
    const lo = layoutModel(model);
    // Jämför vertikala mittpunkter (event-cirklar är högre än tasks men centreras lika).
    const centers = new Set(lo.nodes.map((n) => Math.round(n.y + n.h / 2)));
    expect(centers.size).toBe(1);
    expect(lo.pageWidth).toBeNull();
    expect(lo.pages).toHaveLength(1);
  });

  it("ryms flödet på sidan blir det ändå bara EN sida", () => {
    const lo = layoutModel(parseToModel(`Test\nA → B`), { pageWidth: 1000 });
    expect(lo.pages).toHaveLength(1);
    expect(lo.pages[0].total).toBe(1);
  });

  it("för brett flöde delas på flera sidor – utan att krympas", () => {
    const lo = layoutModel(model, { pageWidth: 1000 });
    expect(lo.pages.length).toBeGreaterThan(1);
    // Full skala: sidindelning ersätter krympning, den kompletterar den inte.
    expect(lo.scale).toBe(1);
    expect(lo.width).toBe(1000);
    for (const n of lo.nodes) expect(n.x + n.w).toBeLessThanOrEqual(1000);
  });

  it("varje sida numreras löpande och känner till totalen", () => {
    const lo = layoutModel(model, { pageWidth: 1000 });
    expect(lo.pages.map((p) => p.number)).toEqual(lo.pages.map((_, i) => i + 1));
    expect(new Set(lo.pages.map((p) => p.total))).toEqual(new Set([lo.pages.length]));
  });

  it("sidorna överlappar inte varandra", () => {
    const lo = layoutModel(model, { pageWidth: 1000 });
    for (let i = 1; i < lo.pages.length; i++) {
      const föregående = lo.pages[i - 1];
      expect(lo.pages[i].y).toBeGreaterThan(föregående.y + föregående.h);
    }
  });

  it("REGRESSION: ALLA banor finns på ALLA sidor, i samma ordning", () => {
    // Den gamla vikningen hoppade över banor som saknade innehåll i ett band.
    // Då flyttade sig de andra banorna mellan banden, och det gick inte att
    // följa en bana genom diagrammet – det såg ut som hopblandade banor.
    const m = parseToModel(BRETT);
    const lo = layoutModel(m, { pageWidth: 1000 });
    expect(lo.pages.length).toBeGreaterThan(1);

    const perSida = new Map<number, string[]>();
    for (const l of lo.lanes) perSida.set(l.page, [...(perSida.get(l.page) ?? []), l.id]);
    expect(perSida.size).toBe(lo.pages.length);
    const första = perSida.get(0)!;
    for (const [sida, banor] of perSida) {
      expect(banor, `sida ${sida} har en annan banuppsättning`).toEqual(första);
    }
  });

  it("R6: en banas höjd på en del följer innehållet på DEN delen", () => {
    // Tidigare gällde den GLOBALA höjden på alla delar – en bana med två rader
    // någonstans blev två rader hög överallt, och delar med en rad var mest
    // tom luft (docs/sidbrytningsregler.md R6 ersätter den regeln).
    const m = parseToModel(BRETT);
    const lo = layoutModel(m, { pageWidth: 1000 });
    for (const l of lo.lanes) {
      const egna = lo.nodes.filter((n) => n.node.laneId === l.id && n.page === l.page);
      if (!egna.length) continue;
      const botten = Math.max(...egna.map((n) => n.y + n.h));
      // Banan omsluter sitt innehåll …
      expect(botten, `${l.id} del ${l.page}: nod utanför banan`).toBeLessThanOrEqual(l.y + l.h + 0.5);
      // … utan våningar av tom luft under det.
      expect(l.y + l.h - botten, `${l.id} del ${l.page}: tom luft under innehållet`).toBeLessThanOrEqual(60);
    }
  });

  it("en bana UTAN innehåll på en del faller ihop till bara sin rubrik", () => {
    // Ritas tomma banor i full höjd blir varje figur mest luft, och en figur
    // som ska klistras in i en Word-rapport kostar då en halv sida i tomrum.
    const m = parseToModel(BRETT);
    const lo = layoutModel(m, { pageWidth: 1000 });
    const tomma = lo.lanes.filter(
      (l) =>
        !lo.nodes.some((n) => n.node.laneId === l.id && n.page === l.page) &&
        !lo.dataStores.some((ds) => ds.store.laneId === l.id && ds.page === l.page),
    );
    expect(tomma.length, "testflödet ger inga tomma banband att pröva").toBeGreaterThan(0);
    for (const l of tomma) expect(Math.round(l.h)).toBe(Math.round(l.headerH));
  });

  it("ingen nod tappas bort, och varje nod ligger i sin bana på SIN sida", () => {
    const m = parseToModel(BRETT);
    for (const bredd of [null, 1600, 1000]) {
      const lo = layoutModel(m, { pageWidth: bredd });
      expect(lo.nodes.length, `noder tappade vid bredd ${bredd}`).toBe(m.nodes.length);
      for (const n of lo.nodes) {
        const mitt = n.y + n.h / 2;
        // Banden för samma bana finns på flera sidor – noden ska ligga i ETT av dem.
        const träff = lo.lanes.filter(
          (l) => l.id === n.node.laneId && mitt >= l.y && mitt <= l.y + l.h,
        );
        expect(träff, `${n.node.id} ligger utanför sin bana vid bredd ${bredd}`).toHaveLength(1);
      }
    }
  });

  it("poolramen ritas en gång per sida", () => {
    const lo = layoutModel(parseToModel(BRETT), { pageWidth: 1000 });
    expect(lo.pools).toHaveLength(lo.pages.length);
    expect(new Set(lo.pools.map((p) => p.page)).size).toBe(lo.pages.length);
  });

  it("flödet går framåt över sidbrytningen, aldrig bakåt", () => {
    // Sidan efter ska innehålla SENARE steg än sidan före.
    const m = parseToModel(BRETT);
    const lo = layoutModel(m, { pageWidth: 1000 });
    const sidaFör = new Map<string, number>();
    for (const n of lo.nodes) {
      const band = lo.lanes.find((l) => l.id === n.node.laneId && n.y + n.h / 2 >= l.y && n.y + n.h / 2 <= l.y + l.h)!;
      sidaFör.set(n.node.id, band.page);
    }
    for (const e of m.edges) {
      const a = sidaFör.get(e.source);
      const b = sidaFör.get(e.target);
      if (a === undefined || b === undefined) continue;
      expect(b, `${e.source}→${e.target} hoppar bakåt till en tidigare sida`).toBeGreaterThanOrEqual(a);
    }
  });
});

describe("REGRESSION: redigering fungerar i ALLA format", () => {
  // Sidindelningen räknade en gång ut sina EGNA positioner. Då blev den fria
  // vyn och delarna två skilda koordinatrymder: en nod som drogs i ett delat
  // läge hoppade tillbaka direkt (layouten kastade positionen), men positionen
  // SPARADES – i delens koordinater. Bytte man sedan till fri bredd användes
  // den, och noden flög tusentals pixlar bort. Nu är delarna ett snitt i den
  // fria layouten, så allt ligger i samma rymd.
  const BREDD = [null, 1600, 1000, 777];
  const draft = textToDraft(`Testflöde
A startar → B i portalen → C i portalen → D i portalen → Driftfråga inkommer i SP-listan Inkorgen → Power Automate flödet triggas → Mejl skickas till handläggaren → E i portalen → Loggpost skapas → F i portalen → G avslutar`);

  it("en nod går att flytta i varje format", () => {
    for (const bredd of BREDD) {
      const opts = { pageWidth: bredd };
      const före = layoutModel(compileDraft(draft), opts);
      const mål = före.nodes[3];
      const efter = layoutModel(
        compileDraft(setStepPosition(draft, mål.node.id, { x: mål.x - mål.dx + 150, y: mål.y - mål.dy + 90 })),
        opts,
      );
      const n = efter.nodes.find((x) => x.node.id === mål.node.id)!;
      const flyttad = Math.abs(n.x - mål.x) > 1 || Math.abs(n.y - mål.y) > 1;
      expect(flyttad, `noden går inte att flytta vid bredd ${bredd}`).toBe(true);
    }
  });

  it("en bana går att ändra höjd i varje format", () => {
    for (const bredd of BREDD) {
      const opts = { pageWidth: bredd };
      const före = layoutModel(compileDraft(draft), opts);
      const bana = före.lanes.find((l) => l.h > l.headerH + 1)!;
      const efter = layoutModel(compileDraft(setLaneHeight(draft, bana.id, bana.h + 120)), opts);
      const l = efter.lanes.find((x) => x.id === bana.id && x.h > x.headerH + 1)!;
      expect(l.h, `banan går inte att förstora vid bredd ${bredd}`).toBeGreaterThan(bana.h + 1);
    }
  });

  it("dx/dy tar tillbaka en delposition till fria koordinater", () => {
    // Det är exakt den räkningen editorn gör innan den sparar ett drag.
    const modell = compileDraft(draft);
    const fri = layoutModel(modell, { pageWidth: null });
    const delad = layoutModel(modell, { pageWidth: 777 });
    expect(delad.pages.length).toBeGreaterThan(1);
    for (const n of delad.nodes) {
      const f = fri.nodes.find((x) => x.node.id === n.node.id)!;
      expect(n.x - n.dx, `${n.node.id} x`).toBeCloseTo(f.x, 3);
      expect(n.y - n.dy, `${n.node.id} y`).toBeCloseTo(f.y, 3);
    }
  });

  it("en position sparad i ett delat läge förstör inte den fria vyn", () => {
    const modell = compileDraft(draft);
    const delad = layoutModel(modell, { pageWidth: 777 });
    const mål = delad.nodes.find((n) => n.page > 0)!;
    // Användaren drar noden 60 px i ett delat läge; editorn sparar fria koordinater.
    const sparad = setStepPosition(draft, mål.node.id, {
      x: mål.x - mål.dx + 60,
      y: mål.y - mål.dy,
    });
    const fri = layoutModel(compileDraft(sparad), { pageWidth: null });
    const n = fri.nodes.find((x) => x.node.id === mål.node.id)!;
    const bana = fri.lanes.find((l) => l.id === n.node.laneId)!;
    // Noden ska fortfarande ligga i sin bana – inte tusentals pixlar ned.
    expect(n.y).toBeGreaterThanOrEqual(bana.y);
    expect(n.y + n.h).toBeLessThanOrEqual(bana.y + bana.h + 1);
  });
});

describe("datalager-artefakter i layouten", () => {
  const MED_LAGER = `Test
Fyller i formulär → Driftfråga inkommer i SP-listan Inkorgen → Power Automate flödet triggas → Loggpost skapas`;

  it("två datalager hamnar aldrig ovanpå varandra", () => {
    // Bådas aktiviteter kan ligga längst till vänster i var sin bana – då fick
    // lagren samma x och bara det sist ritade syntes.
    const lo = layoutModel(parseToModel(MED_LAGER), { pageWidth: 1600 });
    expect(lo.dataStores.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < lo.dataStores.length; i++) {
      for (let j = i + 1; j < lo.dataStores.length; j++) {
        const a = lo.dataStores[i];
        const b = lo.dataStores[j];
        const krock =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(krock, `${a.store.label} krockar med ${b.store.label}`).toBe(false);
      }
    }
  });

  it("lagren ligger inom sin lane och inom sidbredden", () => {
    const lo = layoutModel(parseToModel(MED_LAGER), { pageWidth: 1600 });
    for (const ds of lo.dataStores) {
      const lane = lo.lanes.find((l) => l.id === ds.store.laneId)!;
      expect(lane, `lane saknas för ${ds.store.label}`).toBeDefined();
      expect(ds.y).toBeGreaterThanOrEqual(lane.y);
      expect(ds.y + ds.h).toBeLessThanOrEqual(lane.y + lane.h + 1);
      expect(ds.x + ds.w).toBeLessThanOrEqual(lo.width + 1);
    }
  });
});

describe("global kolumnordning", () => {
  const KEDJA = `Test
A startar → B i portalen → Power Automate flödet triggas → Mejl skickas till handläggaren → D avslutar`;

  it("x ökar i flödesordning, även när flödet byter bana", () => {
    // Vikningen packade tidigare varje bana för sig från vänsterkanten, så
    // flödet hoppade bakåt varje gång det bytte bana.
    const model = parseToModel(KEDJA);
    for (const bredd of [null, 1600, 1000]) {
      const lo = layoutModel(model, { pageWidth: bredd });
      const rad = new Map(lo.nodes.map((n) => [n.node.id, n]));
      for (const e of model.edges) {
        const a = rad.get(e.source);
        const b = rad.get(e.target);
        if (!a || !b) continue;
        // Inom samma band ska målet ligga till höger; byter man band går det ned.
        if (Math.abs(a.y - b.y) < 40) {
          expect(b.x, `${e.source}→${e.target} går bakåt vid bredd ${bredd}`).toBeGreaterThan(a.x);
        }
      }
    }
  });

  it("datalagret placeras där det ligger i kronologin", () => {
    const model = parseToModel(`Test
A startar → Power Automate flödet triggas → Mejl skickas till handläggaren → Loggpost skapas`);
    const lo = layoutModel(model, { pageWidth: null });
    const logg = lo.dataStores.find((d) => /logg/i.test(d.store.label))!;
    const mejl = lo.nodes.find((n) => /mejl skickas/i.test(n.node.label))!;
    // Loggposten skrivs sist – den ska inte ritas i början av diagrammet.
    expect(logg.x).toBeGreaterThan(mejl.x - 200);
  });
});

describe("REGRESSION: en bana med bara datalager reserverar ingen nodrad", () => {
  // SharePoint innehåller inga aktiviteter, bara artefakter. Banan reserverade
  // ändå plats för en aktivitetsrad (54 px) den aldrig använde. Den blev därför
  // både högre än de andra i auto-läge OCH omöjlig att dra ihop lika långt –
  // golvet låg 56 px över de övrigas.
  const utkast = textToDraft(`Test
Fyller i formulär → Driftfråga inkommer i SP-listan Inkorgen → Power Automate flödet triggas → Loggpost skapas`);
  const modell = compileDraft(utkast);
  const lo = layoutModel(modell, { pageWidth: null });

  const utanNoder = lo.lanes.filter(
    (l) => !lo.nodes.some((n) => n.node.laneId === l.id) && lo.dataStores.some((d) => d.store.laneId === l.id),
  );
  const medNoder = lo.lanes.filter((l) => lo.nodes.some((n) => n.node.laneId === l.id));

  it("testflödet innehåller en sådan bana", () => {
    expect(utanNoder.length, "hittade ingen bana med bara datalager").toBeGreaterThan(0);
    expect(medNoder.length).toBeGreaterThan(0);
  });

  it("höjden räcker till artefakten men rymmer ingen oanvänd nodrad", () => {
    const d = BASE_DIMS;
    const behov = d.laneHeaderH + d.dataH + d.rowGap + 2 * d.lanePadY;
    for (const l of utanNoder) {
      expect(l.h, `${l.id} är högre än sitt innehåll kräver`).toBeLessThanOrEqual(behov + 1);
      // Och den ska fortfarande rymma cylindern.
      for (const ds of lo.dataStores.filter((x) => x.store.laneId === l.id)) {
        expect(ds.y).toBeGreaterThanOrEqual(l.y);
        expect(ds.y + ds.h).toBeLessThanOrEqual(l.y + l.h + 1);
      }
    }
  });

  it("går att dra ihop lika långt som en bana med aktiviteter", () => {
    const golv = (id: string) =>
      layoutModel(compileDraft(setLaneHeight(utkast, id, 40)), { pageWidth: null })
        .lanes.find((l) => l.id === id)!.h;
    const artefaktGolv = Math.min(...utanNoder.map((l) => golv(l.id)));
    const nodGolv = Math.min(...medNoder.map((l) => golv(l.id)));
    // Skillnaden får bara vara det artefakten faktiskt tar: en cylinder minus
    // en nodrad. Tidigare skilde det en hel oanvänd nodrad därutöver.
    expect(artefaktGolv - nodGolv, "artefaktbanan har ett mycket högre golv").toBeLessThanOrEqual(
      BASE_DIMS.dataH + BASE_DIMS.rowGap - BASE_DIMS.nodeH + 20,
    );
  });
});

describe("REGRESSION: sidhänvisningarna sitter rätt och säger vad de betyder", () => {
  // Ett ingående märke som inte fick plats till vänster vändes åt höger. Då
  // hamnade det mitt på nodens UTGÅENDE kant, och delen såg ut att komma in
  // bakifrån. Båda "del 3"-märkena i Driftfrågas del 4 låg dessutom i gapet
  // mellan två sammankopplade noder och såg ut att höra till kopplingen.
  const m = parseToModel(BRETT);
  const lo = layoutModel(m, { pageWidth: 777 });
  const nod = new Map(lo.nodes.map((n) => [n.node.id, n]));

  it("testflödet ger korsande kanter att pröva", () => {
    expect(lo.pages.length).toBeGreaterThan(1);
    expect(lo.pageRefs.length).toBeGreaterThan(0);
  });

  it("texten säger riktningen i ord", () => {
    for (const r of lo.pageRefs) {
      expect(r.text, `oläslig text: ${r.text}`).toMatch(/^(från|till) del \d+$/);
    }
  });

  it("ingående märken sitter aldrig till höger, utgående aldrig till vänster", () => {
    for (const r of lo.pageRefs) {
      const n = nod.get(r.nodeId)!;
      const vidSidan = Math.abs(r.y + r.h / 2 - (n.y + n.h / 2)) < 1;
      if (!vidSidan) continue; // ligger ovanför noden – då gäller inte sidan
      if (r.text.startsWith("från")) {
        expect(r.x, `ingående "${r.text}" hamnade till höger om ${r.nodeId}`).toBeLessThan(n.x);
      } else {
        expect(r.x, `utgående "${r.text}" hamnade till vänster om ${r.nodeId}`).toBeGreaterThan(n.x);
      }
    }
  });

  it("märket ligger ovanför noden när flödet redan upptar den sidan", () => {
    // Annars hamnar det mitt på kopplingen mellan två sammankopplade noder.
    for (const r of lo.pageRefs) {
      const n = nod.get(r.nodeId)!;
      const ingående = r.text.startsWith("från");
      const granne = lo.nodes.some(
        (x) =>
          x.page === n.page &&
          x.node.id !== n.node.id &&
          (ingående ? x.x < n.x : x.x > n.x) &&
          m.edges.some(
            (e) =>
              (e.source === x.node.id && e.target === n.node.id) ||
              (e.target === x.node.id && e.source === n.node.id),
          ),
      );
      if (!granne) continue;
      const vidSidan = Math.abs(r.y + r.h / 2 - (n.y + n.h / 2)) < 1;
      expect(vidSidan, `"${r.text}" ligger i flödets väg vid ${r.nodeId}`).toBe(false);
    }
  });

  it("alla märken ryms på sidan", () => {
    for (const r of lo.pageRefs) {
      expect(r.x, `"${r.text}" sticker ut till vänster`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, `"${r.text}" sticker ut till höger`).toBeLessThanOrEqual(lo.width + 0.5);
    }
  });

  it("marginalen för märkena kostar inga extra delar", () => {
    // Reservationen får inte tränga ihop flödet så att figurerna blir fler.
    expect(lo.pages.length).toBeLessThanOrEqual(4);
  });
});

describe("REGRESSION: en sidhänvisning går att dölja", () => {
  // En gateway med två grenar som båda landar på nästa del ger två märken som
  // båda säger "från del N". De är inte dubbletter – de hör till olika noder –
  // men i en färdig figur vill man ibland bara behålla det ena.
  const utkast = textToDraft(BRETT);
  const bas = layoutModel(compileDraft(utkast), { pageWidth: 777 });
  const märke = bas.pageRefs[0];

  it("testflödet ger ett märke att dölja", () => {
    expect(märke, "inga sidhänvisningar att pröva").toBeDefined();
  });

  it("det dolda märket försvinner, de andra är kvar", () => {
    const efter = layoutModel(
      compileDraft(setPageRefHidden(utkast, märke.edgeSource, märke.edgeTarget, märke.sida, true)),
      { pageWidth: 777 },
    );
    expect(efter.pageRefs).toHaveLength(bas.pageRefs.length - 1);
    expect(
      efter.pageRefs.some(
        (r) => r.edgeSource === märke.edgeSource && r.edgeTarget === märke.edgeTarget && r.sida === märke.sida,
      ),
      "märket ritas fortfarande",
    ).toBe(false);
  });

  it("motsatt ände påverkas inte", () => {
    // "från del 3" och "till del 4" hör till samma kant men är två val.
    const efter = layoutModel(
      compileDraft(setPageRefHidden(utkast, märke.edgeSource, märke.edgeTarget, märke.sida, true)),
      { pageWidth: 777 },
    );
    const motsatt = märke.sida === "in" ? "ut" : "in";
    expect(
      efter.pageRefs.some(
        (r) => r.edgeSource === märke.edgeSource && r.edgeTarget === märke.edgeTarget && r.sida === motsatt,
      ),
      "andra änden försvann också",
    ).toBe(true);
  });

  it("går att ta tillbaka", () => {
    const av = setPageRefHidden(utkast, märke.edgeSource, märke.edgeTarget, märke.sida, true);
    const på = setPageRefHidden(av, märke.edgeSource, märke.edgeTarget, märke.sida, false);
    expect(layoutModel(compileDraft(på), { pageWidth: 777 }).pageRefs).toHaveLength(bas.pageRefs.length);
  });
});

describe("REGRESSION: även datalager får sidhänvisningar", () => {
  // "Loggpost skapas" skrivs av en aktivitet på del 3 men ritas på del 5 –
  // artefakten placeras där den hör hemma i KRONOLOGIN, inte bredvid sin
  // skrivare. Associationen ritades inte alls när den korsade ett snitt, så
  // lagret stod kvar utan någon synlig koppling.
  const LÅNGT = `Test
A startar → B i portalen → C i portalen → Power Automate flödet triggas → D i portalen → E i portalen → F i portalen → Mejl skickas till handläggaren → Loggpost skapas → G avslutar`;
  const m = parseToModel(LÅNGT);
  const lo = layoutModel(m, { pageWidth: 777 });
  const del = new Map<string, number>([
    ...lo.nodes.map((n) => [n.node.id, n.page] as const),
    ...lo.dataStores.map((d) => [d.store.id, d.page] as const),
  ]);

  /** Alla riktade kopplingar, kanter som associationer. */
  const kopplingar = [
    ...m.edges.map((e) => ({ source: e.source, target: e.target })),
    ...m.dataAssociations.map((a) => ({
      source: a.direction === "write" ? a.nodeId : a.dataStoreId,
      target: a.direction === "write" ? a.dataStoreId : a.nodeId,
    })),
  ];

  it("flödet delas och har minst en association", () => {
    expect(lo.pages.length).toBeGreaterThan(1);
    expect(m.dataAssociations.length).toBeGreaterThan(0);
  });

  it("VARJE koppling som korsar ett snitt har märken i båda ändar", () => {
    for (const k of kopplingar) {
      const a = del.get(k.source);
      const b = del.get(k.target);
      if (a === undefined || b === undefined || a === b) continue;
      const mina = lo.pageRefs.filter((r) => r.edgeSource === k.source && r.edgeTarget === k.target);
      expect(
        mina.map((r) => r.sida).sort(),
        `${k.source} -> ${k.target} korsar ett snitt utan hänvisning`,
      ).toEqual(["in", "ut"]);
    }
  });

  it("ett datalager är aldrig helt utan koppling", () => {
    for (const ds of lo.dataStores) {
      const egna = kopplingar.filter((k) => k.source === ds.store.id || k.target === ds.store.id);
      if (!egna.length) continue; // modellen har ingen koppling alls – inte layoutens fel
      const synligLinje = egna.some(
        (k) => del.get(k.source) === del.get(k.target) && del.get(k.source) === ds.page,
      );
      const hänvisning = lo.pageRefs.some((r) => r.nodeId === ds.store.id);
      expect(
        synligLinje || hänvisning,
        `"${ds.store.label}" saknar både linje och hänvisning`,
      ).toBe(true);
    }
  });
});

describe("REGRESSION: en avklippt nod stannar där den var", () => {
  // En nods kolumn är längsta vägen från en startpunkt. Utan inkommande kant
  // blir den rank 0 – alltså flödets FÖRSTA kolumn. Tog man bort kopplingen
  // till slutnoden teleporterade den från del 5 till del 1, och satt man och
  // tittade på sista delen såg det ut som att den försvunnit.
  const utkast = textToDraft(BRETT);
  const modell = compileDraft(utkast);
  const slut = modell.nodes[modell.nodes.length - 1];
  const kant = modell.edges.find((e) => e.target === slut.id)!;

  const plats = (u: typeof utkast) => {
    const lo = layoutModel(compileDraft(u), { pageWidth: 777 });
    const n = lo.nodes.find((x) => x.node.id === slut.id);
    return n ? { del: n.page, x: Math.round(n.x) } : null;
  };

  it("testflödet delas och slutnoden har en inkommande kant", () => {
    expect(kant, "hittade ingen kant in till sista noden").toBeDefined();
    expect(layoutModel(modell, { pageWidth: 777 }).pages.length).toBeGreaterThan(1);
  });

  it("noden finns kvar i modellen när kopplingen tas bort", () => {
    const efter = compileDraft(removeEdge(utkast, kant.source, kant.target));
    expect(efter.nodes.some((n) => n.id === slut.id)).toBe(true);
  });

  it("och den ligger kvar på samma del och samma plats", () => {
    const före = plats(utkast);
    const efter = plats(removeEdge(utkast, kant.source, kant.target));
    expect(efter, "noden ritas inte längre").not.toBeNull();
    expect(efter!.del, "noden hoppade till en annan del").toBe(före!.del);
    expect(efter!.x, "noden hoppade i sidled").toBe(före!.x);
  });

  it("flödets början ligger fortfarande först", () => {
    // Fixen får inte flytta de noder som SKA sakna inkommande kant.
    const lo = layoutModel(modell, { pageWidth: null });
    const utanInkommande = lo.nodes.filter(
      (n) => !modell.edges.some((e) => e.target === n.node.id),
    );
    expect(utanInkommande.length, "flödet saknar början").toBeGreaterThan(0);
    const vänstrast = Math.min(...lo.nodes.map((n) => n.x));
    expect(
      utanInkommande.some((n) => n.x === vänstrast),
      "början hamnade inte längst till vänster",
    ).toBe(true);
  });
});

describe("täthet och sidpinnar", () => {
  const m = parseToModel(BRETT);

  it("lägre täthet ger ett smalare diagram (och kan spara delar)", () => {
    const normal = layoutModel(m);
    const tät = layoutModel(m, { spacing: 0.5 });
    expect(tät.width).toBeLessThan(normal.width);
    // Objektens egna mått rörs inte – bara avstånden.
    const n1 = normal.nodes[0];
    const n2 = tät.nodes.find((x) => x.node.id === n1.node.id)!;
    expect(n2.w).toBe(n1.w);
  });

  it("REGRESSION: en sidpinne flyttar objektet till vald del och kopplingen ritas om", () => {
    const lo = layoutModel(m, { pageWidth: 1000 });
    expect(lo.pages.length).toBeGreaterThan(1);
    // Ta en kant som korsar snittet mellan del 1 och del 2.
    const sida = new Map(lo.nodes.map((n) => [n.node.id, n.page]));
    const kant = m.edges.find((e) => sida.get(e.source) === 0 && sida.get(e.target) === 1)!;
    expect(kant).toBeDefined();

    // Pinna målet till del 1 – som att dra objektet dit i canvasen.
    const pinnad = {
      ...m,
      nodes: m.nodes.map((n) => (n.id === kant.target ? { ...n, pagePin: 0 } : n)),
    };
    const lo2 = layoutModel(pinnad, { pageWidth: 1000 });
    const sida2 = new Map(lo2.nodes.map((n) => [n.node.id, n.page]));
    expect(sida2.get(kant.target), "objektet flyttade inte").toBe(0);
    // Hänvisningen för just den kanten är borta – båda ändar på samma del.
    expect(
      lo2.pageRefs.some((r) => r.edgeSource === kant.source && r.edgeTarget === kant.target),
      "hänvisningen borde ha försvunnit",
    ).toBe(false);
    // Och objektet ritas inom sidbredden.
    const nod = lo2.nodes.find((n) => n.node.id === kant.target)!;
    expect(nod.x + nod.w).toBeLessThanOrEqual(1000);
  });
});

describe("skicka→motta-par linjeras lodrätt", () => {
  it("REGRESSION: mottagningen delar kolumn med sitt utskick – pilen blir rak", () => {
    // Mottagningen fick annars kolumnen EFTER utskicket och hamnade snett –
    // pilen blev en trappa (åt höger, sedan lodrätt) i stället för ett rakt
    // lodrätt streck mellan banorna.
    const draft = textToDraft("Test\nStart här → Mejl skickas till handläggaren → Klart nu");
    const medMottagning = {
      ...draft,
      steps: draft.steps.flatMap((s) =>
        s.type === "notification"
          ? [
              { ...s, recipient: undefined, messageDirection: "send" as const },
              {
                id: "mot1",
                type: "notification" as const,
                text: "Handläggaren får mejlet",
                laneId: "Handläggare",
                sourceIndex: -1,
                messageDirection: "receive" as const,
              },
            ]
          : [s],
      ),
    };
    const model = compileDraft(medMottagning);
    const lo = layoutModel(model);
    const sänd = lo.nodes.find((n) => n.node.messageDirection === "send")!;
    const motta = lo.nodes.find((n) => n.node.messageDirection === "receive")!;
    // Samma kolumn → samma mittpunkt i x-led → pilen pekar rakt ner/upp.
    expect(Math.round(sänd.x + sänd.w / 2)).toBe(Math.round(motta.x + motta.w / 2));
    // Och inga tomma kolumner lämnas kvar av justeringen.
    const model2 = compileDraft(draft);
    const lo2 = layoutModel(model2);
    expect(lo.width).toBeLessThanOrEqual(lo2.width + 1);
  });
});

describe("REGRESSION: hänvisningsmärket sitter på utgångssidan", () => {
  it("Nej-märket hamnar till HÖGER om gatewayen, inte i vänstermarginalen", () => {
    // När Ja-pilen upptog högersidan flyttades märket 'ovanför noden' – för en
    // gateway vid delens vänsterkant gled 'Nej · till del N' ut i marginalen
    // till VÄNSTER, fast Nej-vägen fortsätter åt höger till nästa del.
    const m = parseToModel(`Test
A startar → B i portalen → C i portalen → D i portalen → E i portalen → Om hög prioritet → Teamschatt skapas → Chattmeddelande genereras → F i portalen → G i portalen → H avslutar`);
    // Hitta en bredd där ett beslut har sin Ja-gren på samma del men en
    // korsande märkt utgång.
    for (const bredd of [900, 1000, 1100, 777]) {
      const lo = layoutModel(m, { pageWidth: bredd });
      for (const ref of lo.pageRefs) {
        if (ref.sida !== "ut") continue;
        const nod = lo.nodes.find((n) => n.node.id === ref.edgeSource);
        if (!nod || nod.page !== ref.page) continue;
        // Ett UT-märke ska aldrig ligga till vänster om sin nod.
        expect(
          ref.x + ref.w,
          `"${ref.text}" (bredd ${bredd}) ligger till vänster om sin nod`,
        ).toBeGreaterThan(nod.x);
      }
    }
  });
});

describe("banhöjd per del i flersidigt läge", () => {
  const m = parseToModel(BRETT);

  it("REGRESSION: en per-del-höjd ändrar BARA sin del", () => {
    // Att dra i en banas nederkant i Word-läget ändrade höjden på ALLA delar.
    // Ibland rätt – men inte när banan behöver vara extra hög på en enda del.
    const lo0 = layoutModel(m, { pageWidth: 1000 });
    expect(lo0.pages.length).toBeGreaterThan(1);
    const bana = lo0.lanes.find((l) => l.page === 0 && lo0.nodes.some((n) => n.node.laneId === l.id && n.page === 0))!;

    const med = {
      ...m,
      swimlanes: m.swimlanes.map((l) =>
        l.id === bana.id ? { ...l, pageHeights: { 0: 320 } } : l,
      ),
    };
    const lo = layoutModel(med, { pageWidth: 1000 });
    const del0 = lo.lanes.find((l) => l.id === bana.id && l.page === 0)!;
    const del1 = lo.lanes.find((l) => l.id === bana.id && l.page === 1)!;
    const del1Före = lo0.lanes.find((l) => l.id === bana.id && l.page === 1)!;
    expect(Math.round(del0.h), "delens höjd respekterades inte").toBe(320);
    expect(Math.round(del1.h), "andra delar ska inte påverkas").toBe(Math.round(del1Före.h));
  });

  it("för liten per-del-höjd ger en rekommendation för just den delen", () => {
    const lo0 = layoutModel(m, { pageWidth: 1000 });
    const bana = lo0.lanes.find((l) => l.page === 0 && lo0.nodes.some((n) => n.node.laneId === l.id && n.page === 0))!;
    const med = {
      ...m,
      swimlanes: m.swimlanes.map((l) => (l.id === bana.id ? { ...l, pageHeights: { 0: 40 } } : l)),
    };
    const lo = layoutModel(med, { pageWidth: 1000 });
    const varning = lo.laneVarningar?.find((v) => v.laneId === bana.id && v.del === 0);
    expect(varning, "ingen rekommendation för den för låga delen").toBeDefined();
    expect(varning!.rekommenderad).toBeGreaterThan(40);
  });
});

describe("datalager vid en dels högerkant", () => {
  /**
   * Ett flöde där FYRA listskrivningar hänger på ett och samma steg långt ut
   * till höger – formen finns i ett godkännandeflöde, där ett
   * klick sätter status, en flagga, skapar en post i en annan lista och loggar.
   */
  const draft = textToDraft(
    [
      "Fyra skrivningar",
      "A startar → B i portalen → C i portalen → D i portalen → E i portalen → F i portalen → G i portalen",
    ].join("\n"),
  );
  const med = {
    ...draft,
    steps: [
      ...draft.steps.slice(0, 6),
      ...["Alfa", "Beta", "Gamma", "Delta"].map((namn, i) => ({
        id: `lag${i}`,
        type: "datastore" as const,
        text: `Posten sparas i SP-listan "${namn}"`,
        laneId: "SharePoint",
        sourceIndex: 100 + i,
      })),
      ...draft.steps.slice(6),
    ],
  };
  const model = compileDraft(med);

  it("REGRESSION: lagren staplas inte ovanpå varandra vid delens kant", () => {
    // Vart och ett klampades in i delens innehållsyta FÖR SIG. Låg ankaret sist
    // på delen hamnade alla fyra på exakt samma x – fyra cylindrar i en, med
    // fyra sidhänvisningar bredvid, och bara den sist ritade syntes.
    const lo = layoutModel(model, { pageWidth: 700 });
    expect(lo.pages.length).toBeGreaterThan(1);
    const perDelOchBana = new Map<string, Array<{ x: number; w: number }>>();
    for (const ds of lo.dataStores) {
      const k = `${ds.page}|${ds.store.laneId}`;
      perDelOchBana.set(k, [...(perDelOchBana.get(k) ?? []), { x: ds.x, w: ds.w }]);
    }
    for (const [k, rad] of perDelOchBana) {
      const sorterad = [...rad].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorterad.length; i++) {
        expect(
          sorterad[i].x,
          `lagren i ${k} överlappar varandra`,
        ).toBeGreaterThanOrEqual(sorterad[i - 1].x + sorterad[i - 1].w);
      }
    }
  });

  it("ryms raden på delen hålls den innanför högerkanten", () => {
    // 700 px räcker inte till fyra cylindrar i full skala – då får raden sticka
    // ut hellre än att staplas (se testet ovan). Med plats ska den däremot
    // ligga innanför pappret.
    const lo = layoutModel(model, { pageWidth: 1000 });
    expect(lo.pages.length).toBeGreaterThan(1);
    for (const ds of lo.dataStores) expect(ds.x + ds.w).toBeLessThanOrEqual(1000);
  });
});

/**
 * REGRESSION: en sidhänvisning under ett BESLUT eller ett SLUT ritades med ett
 * löst streck bredvid symbolen. Stubben började i rutans underkant vid 25/75 %
 * av bredden – under en romb eller en cirkel är det tom luft – och gick på
 * snedden till märket; skärmen ritade bara dess vågräta del. Det såg ut som en
 * koppling som inte mynnade ut i någonting, i de flesta flersidiga processer.
 */
// Innehållet (flows/) ligger inte i git – i en ren klon hoppas testerna över.
// Alla flöden med ett märke snett under en symbol prövas, så att testet inte
// hänger på en viss installations flödesnamn.
const MED_SNEDA_MÄRKEN = (() => {
  if (!fs.existsSync("flows")) return [];
  return fs
    .readdirSync("flows")
    .filter((f) => f.endsWith(".json") && !f.startsWith("ap-"))
    .map((f) => JSON.parse(fs.readFileSync(`flows/${f}`, "utf8")))
    .filter((flow) => flow.draft?.steps && flow.draft.diagramType !== "affarsprocess")
    .map((flow) => {
      const lo = layoutModel(compileDraft(flow.draft), { pageWidth: 777, scale: 0.65, shrinkToContent: true });
      const under = lo.pageRefs.filter((r) => Math.abs(r.fromX - r.toX) > 0.5 && r.toY > r.fromY);
      return { id: flow.id as string, lo, under };
    })
    .filter((x) => x.under.length > 0);
})();
describe.skipIf(MED_SNEDA_MÄRKEN.length === 0)("REGRESSION: hänvisningens stubbe sitter fast i formen", () => {
  it("stubben börjar på formens kontur, inte i rutans hörn", () => {
    for (const { id, lo, under } of MED_SNEDA_MÄRKEN) {
      for (const r of under) {
        // Bara rombens kontur mäts här; märken under andra objekt hoppas över.
        const n = lo.nodes.find((x) => x.node.id === r.nodeId);
        if (n?.node.type !== "decision") continue;
        // Rombens undre kant: lika långt upp från spetsen som i sidled från mitten.
        const frånMitt = Math.abs(r.fromX - (n.x + n.w / 2)) / n.w;
        expect(r.fromY, id).toBeCloseTo(n.y + n.h * (1 - frånMitt), 5);
        expect(r.fromY, id).toBeLessThan(n.y + n.h);
      }
    }
  });

  it("vägen är vinkelrät: rakt ner, sedan vågrätt in i märket", () => {
    for (const { under } of MED_SNEDA_MÄRKEN) {
      for (const r of under) {
        const väg = hänvisningsStubbe(r);
        expect(väg).toHaveLength(3);
        expect(väg[1]).toEqual({ x: r.fromX, y: r.toY });
      }
    }
  });

  it("ett märke som knuffats uppåt får ett trappsteg, ingen sned", () => {
    const väg = hänvisningsStubbe({ fromX: 100, fromY: 50, toX: 96, toY: 35 });
    expect(väg).toEqual([
      { x: 100, y: 50 },
      { x: 98, y: 50 },
      { x: 98, y: 35 },
      { x: 96, y: 35 },
    ]);
  });

  it("ett märke rakt åt sidan har kvar sin raka stubbe", () => {
    const raka = MED_SNEDA_MÄRKEN.flatMap(({ lo }) => lo.pageRefs.filter((r) => r.fromY === r.toY));
    for (const rak of raka) expect(hänvisningsStubbe(rak)).toHaveLength(2);
  });
});
