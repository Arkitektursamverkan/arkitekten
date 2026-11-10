import { describe, expect, it } from "vitest";
import { parseToModel } from "../parser/parse";
import { filterByPerspective } from "../perspective";
import { toDrawioXml } from "./drawio";
import { toMermaid } from "./mermaid";
import { renderSvg, renderSvgSized } from "./svg";
import { layoutModel } from "../layout/layout";
import { messageFlowAndel, messageFlowLandning } from "../layout/edge-router";
import { compileDraft, setEdgeLabel, setEdgeSides, setEdgeWaypoint } from "@/core/draft";
import { textToDraft } from "../parser/toDraft";

const model = parseToModel(`Driftfråga ny
Fel uppkommer → Startar Portalen → Fyller i formulär → Skicka driftfråga → Får bekräftelse via mejl
Driftfråga inkommer i SP-listan "Inkorgen" → Power Automate flödet triggas → Loggpost skapas`);

describe("exportörer", () => {
  it("Mermaid innehåller flowchart och noder", () => {
    const m = toMermaid(model);
    expect(m).toMatch(/^flowchart LR/);
    expect(m).toMatch(/subgraph/);
    expect(m.split("\n").length).toBeGreaterThan(5);
  });

  it("draw.io XML är välformat och har mxGraphModel", () => {
    const x = toDrawioXml(model);
    expect(x).toMatch(/<mxfile/);
    expect(x).toMatch(/<mxGraphModel/);
    expect(x).toMatch(/vertex="1"/);
    expect(x).toMatch(/edge="1"/);
    expect(x).toMatch(/swimlane;/);
    // Grovt välformat: lika många < som stängande i mxCell-blocket.
    expect(x.includes("</root>")).toBe(true);
    expect(x.includes("</mxfile>")).toBe(true);
  });

  it("SVG har rot-element och dimensioner", () => {
    const s = renderSvg(model);
    expect(s).toMatch(/^<svg[^>]*width="\d+"/);
    expect(s).toMatch(/<\/svg>$/);
  });

  it("SVG ritar datalager som cylinder-artefakt med streckad association", () => {
    expect(model.dataStores.length).toBeGreaterThan(0);
    const s = renderSvg(model);
    // Cylinderns kropp: två elliptiska bågar (a-kommandon) i samma path.
    expect(s).toMatch(/<path d="M[\d.-]+,[\d.-]+ a[\d.]+,8 0 0 1 /);
    // Dataassociationen: streckad, liten öppen pilspets, ingen fylld pil.
    expect(s).toContain('stroke-dasharray="5 4"');
    expect(s).toContain("url(#arwData)");
    expect(s).toContain('<marker id="arwData"');
  });

  it("draw.io ger datalager cylinderstil och associationer öppen streckad pil", () => {
    const x = toDrawioXml(model);
    expect(x).toContain("shape=cylinder3;boundedLbl=1;backgroundOutline=1");
    expect(x).toContain("dashed=1;endArrow=open;endFill=0");
    // Datalagret får en egen vertex och förekommer aldrig som sekvensflöde.
    const dsId = model.dataStores[0].id;
    expect(x).toContain(`<mxCell id="${dsId}"`);
    expect(model.edges.some((e) => e.source === dsId || e.target === dsId)).toBe(false);
  });

  it("Mermaid deklarerar datalager som [( )] och kopplar det streckat", () => {
    const m = toMermaid(model);
    const dsId = model.dataStores[0].id;
    expect(m).toContain(`${dsId}[("`);
    expect(m).toContain("-.->");
  });

  it("verksamhetsvyn döljer tekniska noder", () => {
    const biz = filterByPerspective(model, "business");
    expect(biz.nodes.every((n) => n.perspectives.includes("business"))).toBe(true);
    expect(biz.nodes.some((n) => n.type === "datastore")).toBe(false);
  });
});

describe("färglägen i SVG", () => {
  const model = parseToModel(`Test
Fel uppkommer → Fyller i formulär → Power Automate flödet triggas → Loggpost skapas → Klart`);

  it("typläge färglägger och ritar en teckenförklaring", () => {
    const svg = renderSvg(model, undefined, "type");
    expect(svg).toContain("TECKENFÖRKLARING");
    // Systemnodens blå fyll finns i type-läget.
    expect(svg).toContain("#eef2ff");
  });

  it("strikt BPMN-läge är neutralt och saknar teckenförklaring", () => {
    const svg = renderSvg(model, undefined, "bpmn");
    expect(svg).not.toContain("TECKENFÖRKLARING");
    // Ingen av typfärgerna får förekomma.
    for (const färg of ["#eef2ff", "#fff6e5", "#f3ecff", "#e7f5ee", "#fdecec"]) {
      expect(svg, `färg ${färg} ska inte finnas i BPMN-läge`).not.toContain(färg);
    }
  });
});

describe("alla kopplingar ritas ortogonalt", () => {
  const model = parseToModel(`Test
Fyller i formulär → Driftfråga inkommer i SP-listan Inkorgen → Power Automate flödet triggas → Mejl skickas till handläggaren`);

  it("dataassociationer har räta vinklar, inte en rak diagonal", () => {
    const svg = renderSvg(model);
    // Plocka de streckade artefaktlinjerna (stroke-dasharray, tunn).
    const streckade = svg.match(/<path d="M[^"]*"[^>]*stroke-dasharray="5 4"[^>]*\/>/g) ?? [];
    expect(streckade.length).toBeGreaterThan(0);
    for (const path of streckade) {
      const antalL = (path.match(/L/g) ?? []).length;
      // En ortogonal väg har flera segment; en rak diagonal bara ett L.
      expect(antalL, `rak diagonal: ${path.slice(0, 60)}`).toBeGreaterThan(1);
    }
  });
});

describe("REGRESSION: pilspetsarna pekar rakt", () => {
  // Markörerna saknade viewBox. Då tolkas refX/refY i en annan skala än
  // markörens innehåll, så spetsen hamnade vid sidan av linjen i stället för
  // på den – de streckade pilarna såg ut att peka snett in i sitt mål.
  const svg = renderSvg(parseToModel(`Test
Fyller i formulär → Driftfråga inkommer i SP-listan Inkorgen → Power Automate flödet triggas → Mejl skickas till handläggaren`));

  const markörer = [...svg.matchAll(/<marker\b[^>]*>/g)].map((m) => m[0]);

  it("varje markör har en viewBox", () => {
    expect(markörer.length, "inga markörer i exporten").toBeGreaterThan(0);
    for (const m of markörer) {
      const id = /id="(\w+)"/.exec(m)?.[1];
      expect(m, `markören ${id} saknar viewBox`).toContain("viewBox=");
    }
  });

  it("referenspunkten ligger i markörens lodräta mitt", () => {
    // En refY som inte är mitt i viewBoxen lutar spetsen mot linjen.
    for (const m of markörer) {
      const id = /id="(\w+)"/.exec(m)?.[1];
      const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(m);
      const refY = Number(/refY="([\d.]+)"/.exec(m)?.[1]);
      expect(vb, `markören ${id} har oväntad viewBox`).not.toBeNull();
      expect(refY, `markören ${id} har refY utanför mitten`).toBeCloseTo(Number(vb![2]) / 2, 1);
    }
  });
});

describe("REGRESSION: datalagertexten är läsbar i exporten", () => {
  // Exporten ritade datalagren med bas 10,5 px medan canvasen använder 12 –
  // i Word (som skalar figuren till spaltbredden) hamnade lagertexten under
  // läsbarhetsgolvet, och centreringen lät topp-ellipsen stryka genom första
  // raden. Nu gäller nodernas textstorlek och texten ligger under ellipsen.
  it("samma textstorlek som noderna och första raden under topp-ellipsen", () => {
    const lo = layoutModel(model, { pageWidth: null, scale: 0.65 });
    const svg = renderSvg(model, lo, "type", 0.9);
    const ds = lo.dataStores[0];
    expect(ds).toBeDefined();

    // Datalagrets textrader: de <text> som ligger inom cylinderns ruta.
    const rader = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"/g)]
      .map((m) => ({ x: +m[1], y: +m[2], size: +m[3] }))
      .filter(
        (t) => t.x >= ds.x && t.x <= ds.x + ds.w && t.y >= ds.y && t.y <= ds.y + ds.h + 2,
      );
    expect(rader.length).toBeGreaterThan(0);
    // Lockbågen dippar ner till y + 2·ry (ry proportionell mot höjden).
    const ry = (8 / 46) * ds.h;
    for (const rad of rader) {
      // Nodtextens storlek, med högst en liten passningskrympning (≥ 90 %).
      expect(rad.size, "lagertexten mycket mindre än nodtexten").toBeGreaterThanOrEqual(
        12 * 0.65 * 0.9 * 0.9,
      );
      // Textens ÖVERKANT (baslinje − teckenhöjd) ska ligga under lockbågen –
      // linjen får aldrig stryka genom texten.
      expect(rad.y - rad.size).toBeGreaterThanOrEqual(ds.y + 2 * ry - 0.5);
    }
  });
});

describe("revisionsrutan i exporten", () => {
  /**
   * Kravet: "vid export, precis som faktarutan med förklaring, också en liten
   * ruta med vem som justerat, datum och version". En figur i ett dokument
   * läses av någon annan långt senare – utan stämpeln går det inte att avgöra
   * om bilden är den aktuella.
   */
  const model = parseToModel(`Test
Fel uppkommer → Registrerar ärende → Klart`);

  it("stämplar figuren med version, datum och namn", () => {
    const svg = renderSvg(model, undefined, "type", 1, {
      version: "v3",
      datum: "2026-07-28T09:19:10.653Z",
      ändradAv: "Testanvändare",
    });
    expect(svg).toContain("Version 3 · 2026-07-28");
    expect(svg).toContain("Justerad av Testanvändare");
    // …och teckenförklaringen finns kvar bredvid.
    expect(svg).toContain("TECKENFÖRKLARING");
  });

  it("ett flöde utan revision ser ut precis som förut", () => {
    expect(renderSvg(model, undefined, "type", 1)).toBe(
      renderSvg(model, undefined, "type", 1, undefined),
    );
    expect(renderSvg(model)).not.toContain("Justerad av");
  });

  it("rutan får plats – figuren växer på höjden när den behövs", () => {
    const utan = renderSvgSized(model, undefined, "bpmn", 1);
    const med = renderSvgSized(model, undefined, "bpmn", 1, {
      version: "v1",
      ändradAv: "HR",
    });
    expect(med.height).toBeGreaterThan(utan.height);
  });
});

/**
 * Brytpunkter på STRECKADE kopplingar.
 *
 * Dataassociationer och meddelandeflöden tar samma plats på pappret som
 * sekvensflödet, men böjen gick inte att flytta: mellanlagret bar en brytpunkt,
 * kompileringen läste den aldrig, och canvasen skickade aldrig något handtag.
 * En streckad pil som låg i vägen kunde alltså inte flyttas undan.
 */
describe("REGRESSION: streckade kopplingar bär sin brytpunkt hela vägen", () => {
  const TEXT = `Kommentar
Handläggaren öppnar Portalen → Anger kommentar → Post sparas i SP-listan "Kommentar" → Mejl skickas till användaren`;

  /** Nyckeln som mellanlagret sparar under: nodpar utan etikett. */
  const nyckel = (a: string, b: string) => `${a}->${b}`;

  it("dataassociationen får sin brytpunkt ur mellanlagret", () => {
    const bas = textToDraft(TEXT);
    const da = compileDraft(bas).dataAssociations[0];
    expect(da).toBeTruthy();
    expect(da.waypoint).toBeUndefined();

    const med = setEdgeWaypoint(bas, da.nodeId, da.dataStoreId, { x: 410, y: 88 });
    const efter = compileDraft(med).dataAssociations.find(
      (a) => a.nodeId === da.nodeId && a.dataStoreId === da.dataStoreId,
    )!;
    expect(efter.waypoint).toEqual({ x: 410, y: 88 });
    // Nyckeln är nodpar utan etikett – samma som ärBorttagen/edgeStyleFor läser.
    expect(Object.keys(med.edgeStyles ?? {})).toContain(nyckel(da.nodeId, da.dataStoreId));
  });

  it("meddelandeflödet får sin brytpunkt, och den slår ut den raka vägen", () => {
    const bas = textToDraft(TEXT);
    const mf = compileDraft(bas).messageFlows[0];
    expect(mf).toBeTruthy();
    const med = setEdgeWaypoint(bas, mf.nodeId, mf.poolId, { x: 300, y: 260 });
    const efter = compileDraft(med).messageFlows.find((x) => x.nodeId === mf.nodeId)!;
    expect(efter.waypoint).toEqual({ x: 300, y: 260 });
  });

  it("SVG-exporten drar den streckade linjen genom brytpunkten", () => {
    const bas = textToDraft(TEXT);
    const da = compileDraft(bas).dataAssociations[0];
    const utan = renderSvg(compileDraft(bas), layoutModel(compileDraft(bas)));
    const medDraft = setEdgeWaypoint(bas, da.nodeId, da.dataStoreId, { x: 420, y: 300 });
    const medModel = compileDraft(medDraft);
    const med = renderSvg(medModel, layoutModel(medModel));
    // Vägen MÅSTE ändras – gjorde den inte det läste exporten aldrig punkten.
    expect(med).not.toBe(utan);
    const streckade = [...med.matchAll(/<path d="([^"]+)" fill="none"[^>]*stroke-dasharray="5 4"/g)];
    expect(streckade.length).toBeGreaterThan(0);
    // …och den ska passera x=420 i någon punkt (fri-layouten har dx=dy=0).
    expect(streckade.some(([, d]) => d.includes("420"))).toBe(true);
  });

  it("draw.io-exporten skriver brytpunkten som en mxPoint på den streckade kanten", () => {
    const bas = textToDraft(TEXT);
    const da = compileDraft(bas).dataAssociations[0];
    const medDraft = setEdgeWaypoint(bas, da.nodeId, da.dataStoreId, { x: 420, y: 300 });
    const xml = toDrawioXml(compileDraft(medDraft));
    const cell = xml.split("<mxCell").find((c) => c.includes("dashed=1") && c.includes("endFill=0"))!;
    expect(cell).toContain('<Array as="points">');
    expect(cell).toContain('x="420"');
  });

  it("REGRESSION: en LÄSNING nycklas lager→nod, inte nod→lager", () => {
    // Nyckeln följer PILENS riktning: en skrivning går nod→lager, en läsning
    // lager→nod. Canvasen nycklade båda som nod→lager, så en läsnings brytpunkt
    // sparades under en nyckel kompileringen aldrig slår upp – böjen försvann i
    // samma ögonblick som man släppte den, och handtaget visades aldrig som satt.
    const LÄS = `Kommentar
Handläggaren öppnar Portalen → Anger kommentar → Post sparas i SP-listan "Kommentar" → Läser posten → Mejl skickas till användaren`;
    const bas = textToDraft(LÄS);
    const läs = compileDraft(bas).dataAssociations.find((a) => a.direction === "read")!;
    expect(läs).toBeTruthy();

    // Rätt håll (pilens): brytpunkten kommer tillbaka.
    const rätt = setEdgeWaypoint(bas, läs.dataStoreId, läs.nodeId, { x: 111, y: 222 });
    expect(
      compileDraft(rätt).dataAssociations.find((a) => a.id === läs.id)!.waypoint,
    ).toEqual({ x: 111, y: 222 });

    // Fel håll: den läses aldrig tillbaka – exakt det felet.
    const fel = setEdgeWaypoint(bas, läs.nodeId, läs.dataStoreId, { x: 111, y: 222 });
    expect(
      compileDraft(fel).dataAssociations.find((a) => a.id === läs.id)!.waypoint,
    ).toBeUndefined();
  });

  it("en SKRIVNING nycklas nod→lager", () => {
    const bas = textToDraft(TEXT);
    const skriv = compileDraft(bas).dataAssociations.find((a) => a.direction === "write")!;
    const med = setEdgeWaypoint(bas, skriv.nodeId, skriv.dataStoreId, { x: 7, y: 8 });
    expect(
      compileDraft(med).dataAssociations.find((a) => a.id === skriv.id)!.waypoint,
    ).toEqual({ x: 7, y: 8 });
  });

  it("utan brytpunkt ser exporten ut precis som förut", () => {
    const m = compileDraft(textToDraft(TEXT));
    expect(m.dataAssociations.every((a) => a.waypoint === undefined)).toBe(true);
    expect(toDrawioXml(m)).toContain('<mxGeometry relative="1" as="geometry"/>');
  });
});

/**
 * Meddelandeflödets landningspunkt på mottagarbandet.
 *
 * Bandet är brett som hela sidan, så det finns ingen naturlig mittpunkt att
 * sikta på: förvalet är RAKT NEDANFÖR AVSÄNDAREN. Räkningen låg tidigare på tre
 * ställen (bandets handtag i canvasen, kantens port, SVG-exporten) och de kunde
 * ge olika svar – pilens slut satt kvar på bandets cachade handtagsläge när
 * avsändaren flyttades, medan starten följde med.
 */
describe("messageFlowLandning", () => {
  const band = { x: 0, w: 800, labelW: 14 };

  it("förvalet är rakt under avsändaren", () => {
    expect(messageFlowLandning({}, band, 321)).toBe(321);
  });

  it("saknas avsändaren används bandets mitt", () => {
    expect(messageFlowLandning({}, band, undefined)).toBe(400);
  });

  it("ett manuellt val (targetPos) vinner över avsändarens läge", () => {
    expect(messageFlowLandning({ targetPos: 0.3 }, band, 321)).toBeCloseTo(240);
    expect(messageFlowLandning({ targetPos: 0 }, band, 321)).toBe(band.labelW + 12);
    expect(messageFlowLandning({ targetPos: 1 }, band, 321)).toBe(band.w - 12);
  });

  it("landar aldrig i etikettfliken eller utanför bandet", () => {
    // Avsändaren står längst till vänster, bakom bandets namnflik.
    expect(messageFlowLandning({}, band, 3)).toBe(band.labelW + 12);
    expect(messageFlowLandning({}, band, 5000)).toBe(band.w - 12);
  });

  it("messageFlowAndel är motsatsen", () => {
    expect(messageFlowAndel(band, 240)).toBeCloseTo(0.3);
    expect(messageFlowAndel(band, -50)).toBe(0);
    expect(messageFlowAndel(band, 9999)).toBe(1);
  });
});

describe("REGRESSION: exporten landar där skärmen landar", () => {
  const TEXT_MF = `Kommentar
Handläggaren öppnar Portalen → Anger kommentar → Mejl skickas till användaren`;

  it("SVG:n flyttar landningspunkten när targetPos är satt", () => {
    const bas = textToDraft(TEXT_MF);
    const mf = compileDraft(bas).messageFlows[0];
    expect(mf).toBeTruthy();
    const utan = renderSvg(compileDraft(bas), layoutModel(compileDraft(bas)));
    // Nyckeln följer pilens riktning: nod → pool.
    const medDraft = setEdgeSides(bas, mf.nodeId, mf.poolId, { targetPos: 0.15 });
    const medModel = compileDraft(medDraft);
    expect(medModel.messageFlows[0].targetPos).toBe(0.15);
    const med = renderSvg(medModel, layoutModel(medModel));
    // Vägen MÅSTE ändras – gjorde den inte det läste exporten aldrig fältet.
    expect(med).not.toBe(utan);
  });

  it("draw.io skriver landningspunkten som entryX på meddelandeflödet", () => {
    const bas = textToDraft(TEXT_MF);
    const mf = compileDraft(bas).messageFlows[0];
    const xml = toDrawioXml(compileDraft(setEdgeSides(bas, mf.nodeId, mf.poolId, { targetPos: 0.15 })));
    const cell = xml.split("<mxCell").find((c) => c.includes("startArrow=oval"))!;
    expect(cell).toMatch(/entryX=0\.\d+;entryY=0;/);
  });
});

describe("REGRESSION: kantetiketter ritas likadant oavsett kantsort", () => {
  it("streckad och heldragen etikett får samma teckenstorlek i SVG:n", () => {
    // Bara sekvensflödena skalade etiketten efter layouten; streckade ritades i
    // fast storlek. Vid skala 0,6 stod "Ja" i 6,6 px bredvid en ny etikett i 11.
    const TEXT_E = `Kommentar
Handläggaren öppnar Portalen → Anger kommentar → Post sparas i SP-listan "Kommentar" → Status klar? (↓ Ja → Väljer Skicka)`;
    const bas = textToDraft(TEXT_E);
    const m0 = compileDraft(bas);
    const gren = m0.edges.find((e) => e.label);
    const da = m0.dataAssociations[0];
    expect(gren, "flödet måste ha en märkt gren").toBeTruthy();
    expect(da, "flödet måste ha en dataassociation").toBeTruthy();

    const med = setEdgeLabel(bas, da!.nodeId, da!.dataStoreId, undefined, "Loggas");
    const modell = compileDraft(med);
    const svg = renderSvg(modell, layoutModel(modell));

    const storlek = (text: string) => {
      const m = svg.match(new RegExp(`font-size="([\\d.]+)"[^>]*>${text}<`));
      return m?.[1];
    };
    expect(storlek("Loggas"), "den streckade etiketten ska ritas").toBeTruthy();
    expect(storlek("Loggas")).toBe(storlek(gren!.label!));
  });
});
