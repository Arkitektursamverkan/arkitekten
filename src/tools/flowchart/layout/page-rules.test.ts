/**
 * Sidbrytningens regelverk (docs/sidbrytningsregler.md), verkställt.
 *
 * Granskaren körs på exempelflödet OCH de sparade flödena, i flera
 * sidformat. Bryts en regel av en framtida layoutändring blir bygget rött –
 * det är det som gör regelverket utvärderingsbart och inte bara ord.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileDraft, type ProcessDraft } from "@/core/draft";
import { filterByPerspective } from "../perspective";
import { textToDraft } from "../parser/toDraft";
import { layoutModel, PAGE_FORMATS, type PageFormatId } from "./layout";
import { granskaSidor, rapportSomText } from "./page-rules";

const EXEMPEL = `Felanmälan ny
Fel uppkommer → Medarbetare → Startar Portalen → Väljer ny felanmälan från startsidan → Fyller i formulär för felanmälan → Väljer skicka in formuläret för felanmälan → Handläggare utses automatiskt utifrån det system som valts → Kommer till en sida med tack för ditt ärende → Får via mejl bekräftelse på att felanmälan har inkommit

Felanmälan inkommer i SP-listan "Incident" → Power Automate flödet "INC nytt ärende" triggas (↓ Om klassificering = Hög prioritet → Teamschatt skapas med alla handläggare på IT → Chattmeddelande genereras för det specifika ärendet) → Mejlbekräftelse skickas till användaren → Mejl skickas till handläggaren → Loggpost skapas`;

/** Alla flöden som granskas: exemplet + de sparade. */
function allaFlöden(): { namn: string; draft: ProcessDraft }[] {
  const ut: { namn: string; draft: ProcessDraft }[] = [
    { namn: "Exempelflödet", draft: textToDraft(EXEMPEL) },
  ];
  const dir = path.join(process.cwd(), "flows");
  if (fs.existsSync(dir)) {
    for (const fil of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const flow = JSON.parse(fs.readFileSync(path.join(dir, fil), "utf8"));
        // Bara FLÖDESSCHEMAN granskas. Affärsprocesserna delar mapp men har en
        // egen layoutmotor med egna regler (layout-affarsprocess.ts, R8) – att
        // köra dem genom flödesschemats sidplanerare mäter något som aldrig
        // ritas. Bakåtpilar (verkliga återkopplingar i verksamheten) anmärker R4
        // med rätta på i ett flödesschema, men de säger inget om
        // affärsprocessvyn.
        if (fil.startsWith("ap-") || flow?.draft?.diagramType === "affarsprocess") continue;
        if (flow?.draft?.steps) ut.push({ namn: flow.name ?? fil, draft: flow.draft });
      } catch {
        // trasig fil granskas inte här – flow-store varnar redan
      }
    }
  }
  return ut;
}

const FORMAT: PageFormatId[] = ["word", "wide", "a4l"];

describe("sidbrytningsreglerna håller (R1–R6)", () => {
  for (const { namn, draft } of allaFlöden()) {
    for (const fmtId of FORMAT) {
      const fmt = PAGE_FORMATS[fmtId];
      if (!fmt.width) continue;
      it(`${namn} · ${fmtId}`, () => {
        const model = filterByPerspective(compileDraft(draft), "system");
        const lo = layoutModel(model, { pageWidth: fmt.width, scale: 1 });
        const utfall = granskaSidor(model, lo);
        const brutna = utfall.filter((r) => !r.ok);
        expect(brutna, `\n${rapportSomText(utfall)}`).toEqual([]);
      });
    }
  }
});

describe("R7: determinism", () => {
  it("samma modell och format ger exakt samma delning", () => {
    const model = filterByPerspective(compileDraft(textToDraft(EXEMPEL)), "system");
    const fmt = PAGE_FORMATS.word;
    const a = layoutModel(model, { pageWidth: fmt.width, scale: 1 });
    const b = layoutModel(model, { pageWidth: fmt.width, scale: 1 });
    expect(b.pages.length).toBe(a.pages.length);
    expect(b.nodes.map((n) => [n.node.id, n.page, Math.round(n.x), Math.round(n.y)])).toEqual(
      a.nodes.map((n) => [n.node.id, n.page, Math.round(n.x), Math.round(n.y)]),
    );
  });
});

describe("R6: dömer motorn, inte användarens geometri", () => {
  it("REGRESSION: ett objekt draget utanför sin bana friar banans tomluft", () => {
    // Användaren drog två Power Automate-objekt en bit UPPÅT så att de hamnade
    // ovanför sitt baneband. Bandet stod kvar tomt och R6 dömde "86 px tom
    // luft under innehållet" – men luften var användarens val, inte motorns.
    // Regeln ska fria banor vars innehåll användaren själv har flyttat.
    const draft = textToDraft(EXEMPEL);
    const model0 = filterByPerspective(compileDraft(draft), "system");
    const fmt = PAGE_FORMATS.word;
    const lo0 = layoutModel(model0, { pageWidth: fmt.width, scale: 1 });
    const nod = lo0.nodes.find((n) => n.node.laneId === "Power Automate")!;
    expect(nod).toBeDefined();
    const flyttad: ProcessDraft = {
      ...draft,
      steps: draft.steps.map((s) =>
        s.id === nod.node.id
          ? { ...s, position: { x: nod.x - nod.dx, y: nod.y - nod.dy - 90 } }
          : s,
      ),
    };
    const model1 = filterByPerspective(compileDraft(flyttad), "system");
    const lo1 = layoutModel(model1, { pageWidth: fmt.width, scale: 1 });
    const utfall = granskaSidor(model1, lo1);
    const r6 = utfall.find((r) => r.id === "R6")!;
    expect(r6.ok, `\n${rapportSomText([r6])}`).toBe(true);
  });
});

describe("R3/R4: pinnade objekt är användarens val", () => {
  it("REGRESSION: ett objekt pinnat till en tidigare del friar bakåtpil och grenseparation", () => {
    // Användaren drog s5 i Beställning-ny till del 1 (pagePin) – då pekade s4→s5
    // bakåt och gatewayn skildes från sin gren. Det är ett medvetet delbyte,
    // inte motorns fel, och regelverket ska fria det.
    const draft = textToDraft(EXEMPEL);
    const model0 = filterByPerspective(compileDraft(draft), "system");
    const fmt = PAGE_FORMATS.word;
    const lo0 = layoutModel(model0, { pageWidth: fmt.width, scale: 1 });
    expect(lo0.pages.length).toBeGreaterThan(1);
    // Pinna ett steg vars FÖREGÅNGARE också ligger på del 2 – då pekar
    // föregångarens koppling bakåt till del 1 efter pinningen.
    const delAv = new Map(lo0.nodes.map((n) => [n.node.id, n.page]));
    const kant = model0.edges.find((e) => delAv.get(e.source) === 1 && delAv.get(e.target) === 1)!;
    expect(kant, "ingen koppling helt inom del 2").toBeDefined();
    const pinnad: ProcessDraft = { ...draft, pagePins: { [kant.target]: 0 } };
    const model1 = filterByPerspective(compileDraft(pinnad), "system");
    const lo1 = layoutModel(model1, { pageWidth: fmt.width, scale: 1 });
    const utfall = granskaSidor(model1, lo1);
    const r3 = utfall.find((r) => r.id === "R3")!;
    const r4 = utfall.find((r) => r.id === "R4")!;
    expect(r3.ok, `\n${rapportSomText([r3])}`).toBe(true);
    expect(r4.ok, `\n${rapportSomText([r4])}`).toBe(true);
  });
});

describe("R1: ingen tom del", () => {
  /**
   * REGRESSION: användaren pinnade slut-eventet på sista delen till delen före
   * ("flyttade upp det"), och delen det lämnade blev kvar – en tom ruta med
   * bara bantitlar och etiketten "Del 3 av 3". Delarna planeras ur kolumn-
   * geometrin, före pinnarna, så ingen räknade om antalet efteråt.
   */
  it("REGRESSION: pinnas en dels enda objekt bort försvinner delen", () => {
    const draft = textToDraft(EXEMPEL);
    const model0 = filterByPerspective(compileDraft(draft), "system");
    const fmt = PAGE_FORMATS.word;
    const lo0 = layoutModel(model0, { pageWidth: fmt.width, scale: 1 });
    const sista = lo0.pages.length - 1;
    expect(sista).toBeGreaterThan(0);
    const påSista = lo0.nodes.filter((n) => n.page === sista);
    const lagerPåSista = lo0.dataStores.filter((ds) => ds.page === sista);
    expect(påSista.length, "sista delen är redan tom").toBeGreaterThan(0);

    // Pinna ALLT som ligger på sista delen till delen före.
    const pinnad: ProcessDraft = {
      ...draft,
      pagePins: Object.fromEntries(påSista.map((n) => [n.node.id, sista - 1])),
    };
    const model1 = filterByPerspective(compileDraft(pinnad), "system");
    const lo1 = layoutModel(model1, { pageWidth: fmt.width, scale: 1 });

    // Datalager följer sitt ankare, så de följer med av sig själva.
    void lagerPåSista;
    expect(lo1.pages.length, "den tomma delen blev kvar").toBe(lo0.pages.length - 1);
    // Numreringen stämmer med antalet: ingen "Del 3 av 3" utan del 3.
    expect(lo1.pages.map((p) => p.number)).toEqual(lo1.pages.map((_, i) => i + 1));
    expect(new Set(lo1.pages.map((p) => p.total))).toEqual(new Set([lo1.pages.length]));
    // Och varje kvarvarande del har innehåll.
    for (const p of lo1.pages) {
      const harInnehåll =
        lo1.nodes.some((n) => n.page === p.number - 1) ||
        lo1.dataStores.some((ds) => ds.page === p.number - 1);
      expect(harInnehåll, `del ${p.number} är tom`).toBe(true);
    }
  });
});

describe("R4: manuella positioner ändrar aldrig deltillhörighet", () => {
  it("REGRESSION: ett långt draget objekt stannar på sin del", () => {
    // Tidigare styrde mittpunkten: ett objekt draget åt höger teleporterade
    // till nästa del, slet grenen från sin gateway och gav bakåthänvisningar
    // ("till del 2" från del 3) – flödet gick inte att följa (bild 3).
    const draft = textToDraft(EXEMPEL);
    const model0 = filterByPerspective(compileDraft(draft), "system");
    const fmt = PAGE_FORMATS.word;
    const lo0 = layoutModel(model0, { pageWidth: fmt.width, scale: 1 });
    expect(lo0.pages.length).toBeGreaterThan(1);
    const nod = lo0.nodes.find((n) => n.page === 0 && n.node.sourceIndex >= 0)!;

    // Dra objektet långt åt höger i den fria rymden (som ett vilset musdrag).
    const flyttad: ProcessDraft = {
      ...draft,
      steps: draft.steps.map((s) =>
        s.id === nod.node.id ? { ...s, position: { x: nod.x - nod.dx + 900, y: nod.y - nod.dy } } : s,
      ),
    };
    const model1 = filterByPerspective(compileDraft(flyttad), "system");
    const lo1 = layoutModel(model1, { pageWidth: fmt.width, scale: 1 });
    const efter = lo1.nodes.find((n) => n.node.id === nod.node.id)!;
    expect(efter.page, "objektet bytte del av ett musdrag").toBe(nod.page);
    // Och det ritas fortfarande inom sin dels innehållsyta.
    expect(efter.x + efter.w).toBeLessThanOrEqual(fmt.width!);
  });
});

/**
 * REGRESSION: en tom process gjorde hela regelgranskningen röd.
 *
 * Sedan nya processer läggs in i biblioteket direkt när de skapas finns det
 * sparade flöden UTAN objekt – man har namngett processen men inte ritat
 * något än. R1 läste den enda (tomma) delen som "en del för mycket", och
 * sviten föll på ett flöde som inte hade något fel alls (2026-09-04:
 * flödet "Test3").
 */
it("en process utan objekt har ingen sidindelning att bedöma", () => {
  const draft = textToDraft("Test3\n");
  const model = filterByPerspective(compileDraft(draft), "system");
  const lo = layoutModel(model, { pageWidth: PAGE_FORMATS.word.width!, scale: 1 });
  expect(lo.nodes).toHaveLength(0);
  expect(granskaSidor(model, lo)).toEqual([]);
});
