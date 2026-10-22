/**
 * Den avskalade presentationsstilen: zoner per utförande roll, rutor i
 * flödesordning, mellanobjekten borta – och samma märkning som exporten, så
 * att Ramars markeringar hittar sina mål.
 */

import { describe, expect, it } from "vitest";
import { compileAp } from "@/core/affarsprocess";
import { edgeKey, emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import { RAM_KANT_ATTR, RAM_NOD_ATTR, ramKantNyckel } from "@/core/ram";
import { setPresentationsKoppling, setPresentationsLäge } from "@/core/draft";
import { avskalaAp, närmasteSida, renderAvskaladSvg } from "./avskalad";
import { snäppMotMittlinjer } from "./AvskaladVy";

const L = "Uthyrning";
const steg = (id: string, type: DraftStep["type"], text: string, extra: Partial<DraftStep> = {}): DraftStep => ({
  id,
  type,
  text,
  laneId: L,
  sourceIndex: -1,
  ...extra,
});
const KK = { namn: "Kundkoordinator", huki: "U" as const };

/** Samma form som demoflödet: två regler, en återkoppling, en gren som tar slut. */
const DRAFT: ProcessDraft = {
  ...emptyDraft(),
  title: "Uthyrning",
  lanes: [makeLane(L, 0)],
  steps: [
    steg("publicera", "activity", "Publicerar lägenhet", {
      ap: { input: "Uthyrningsbar lägenhet", roller: [KK], applikationer: ["Fastighetssystemet"], output: "Lägenhet publicerad" },
    }),
    steg("anmal", "activity", "Anmäler intresse", { ap: { roller: [{ namn: "Sökande", huki: "U" }], output: "Intresse anmält" } }),
    steg("visa", "activity", "Visar lägenhet", { ap: { roller: [{ namn: "Förvaltare", huki: "U" }], output: null } }),
    steg("vill", "decision", "Vill sökande?", { gateway: "exclusive" }),
    steg("nasta", "activity", "Bearbetar nästa", { branchOf: { stepId: "vill", label: "Nej" }, ap: { output: null } }),
    steg("kredit", "activity", "Utför kreditupplysning", { ap: { roller: [KK], applikationer: ["Creditsafe"], output: null } }),
    steg("avtal", "activity", "Skickar avtal", { ap: { roller: [KK], output: "Lägenhet uthyrd" } }),
  ],
  removedEdges: [edgeKey("nasta", "kredit")],
  extraEdges: [{ source: "nasta", target: "visa" }],
};

const bild = () => avskalaAp(compileAp(DRAFT));

describe("avskalad presentationsstil", () => {
  it("zonerna är rollerna som UTFÖR stegen, i den ordning de dyker upp", () => {
    const b = bild();
    expect(b.zoner.map((z) => z.namn)).toEqual(["Kundkoordinator", "Sökande", "Förvaltare"]);
    const zonAv = (id: string) => b.zoner[b.rutor.find((r) => r.id === id)!.zon].namn;
    expect(zonAv("kredit")).toBe("Kundkoordinator");
    // Regeln och steget utan roll följer steget före sig.
    expect(zonAv("vill")).toBe("Förvaltare");
    expect(zonAv("nasta")).toBe("Förvaltare");
  });

  it("mellanobjekten faller bort – kopplingen går direkt från steg till steg; start och slut står kvar", () => {
    const b = bild();
    const ids = b.rutor.map((r) => r.id);
    expect(ids).not.toContain("vo_publicera");
    expect(ids).toContain("vo_in_publicera");
    expect(ids).toContain("end_avtal");
    const par = b.kanter.map((k) => `${k.source}>${k.target}${k.label ? `#${k.label}` : ""}`);
    expect(par).toContain("publicera>anmal");
    expect(par).toContain("vill>kredit#Ja");
    expect(par).toContain("vill>nasta#Nej");
    expect(par).toContain("nasta>visa");
  });

  it("numren följer huvudspåret först, grenarna sist; IT-stöden är undertext", () => {
    const b = bild();
    const nr = Object.fromEntries(b.rutor.filter((r) => r.nr).map((r) => [r.id, r.nr]));
    expect(nr).toEqual({ publicera: 1, anmal: 2, visa: 3, kredit: 4, avtal: 5, nasta: 6 });
    expect(b.rutor.find((r) => r.id === "kredit")!.undertext).toBe("Creditsafe");
  });

  it("ett steg i en annan zon står i samma kolumn som steget före – bilden blir inte en lång remsa", () => {
    const b = bild();
    const kol = (id: string) => b.rutor.find((r) => r.id === id)!.kolumn;
    expect(kol("anmal")).toBe(kol("publicera"));
    expect(kol("visa")).toBe(kol("anmal"));
    expect(b.bredd / b.höjd).toBeLessThan(3);
    // Inga två rutor på samma plats.
    for (const a of b.rutor)
      for (const c of b.rutor)
        if (a !== c) expect(a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h).toBe(false);
  });

  it("SVG:n bär samma märkning som exporten – Ramars markeringar hittar rutor och kopplingar", () => {
    const b = bild();
    const svg = renderAvskaladSvg(b);
    for (const r of b.rutor) expect(svg).toContain(`${RAM_NOD_ATTR}="${r.id}"`);
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    for (const k of b.kanter) expect(svg).toContain(`${RAM_KANT_ATTR}="${esc(ramKantNyckel(k.source, k.target, k.label))}"`);
  });
});

describe("raka linjer och handplacering", () => {
  it("REGRESSION: grenen stod UNDER huvudspåret, och de lodräta linjerna till nästa zon fick slingra sig runt den", () => {
    const b = bild();
    const r = (id: string) => b.rutor.find((x) => x.id === id)!;
    // nasta är en gren i samma zon som regeln och ligger på en egen linje ovanför.
    expect(r("nasta").linje).toBeLessThanOrEqual(r("visa").linje);
  });

  it("REGRESSION: regelns romb satt högt i raden och varje Ja fick en knyck – den står nu på radens mittlinje", () => {
    const b = bild();
    const kant = b.kanter.find((k) => k.source === "vill" && k.target === "kredit")!;
    const vill = b.rutor.find((x) => x.id === "vill")!;
    const visa = b.rutor.find((x) => x.id === "visa")!;
    expect(vill.y + vill.h / 2).toBe(visa.y + visa.h / 2);
    expect(kant.pts.length).toBeGreaterThan(1);
  });

  it("ett handplacerat läge vinner, och zonen följer med rutan", () => {
    const före = bild();
    const kredit = före.rutor.find((x) => x.id === "kredit")!;
    const efter = avskalaAp(compileAp(DRAFT), { kredit: { x: kredit.x + 400, y: kredit.y - 60 } });
    const flyttad = efter.rutor.find((x) => x.id === "kredit")!;
    expect(flyttad.x).toBe(kredit.x + 400);
    const zon = efter.zoner[flyttad.zon];
    expect(zon.y).toBeLessThanOrEqual(flyttad.y);
    expect(zon.x + zon.w).toBeGreaterThanOrEqual(flyttad.x + flyttad.w);
    expect(efter.ursprung.y).toBeLessThanOrEqual(zon.y);
  });

  it("draget snäpper mot andra rutors mittlinjer – men bara nära", () => {
    const andra = [{ x: 0, y: 100, w: 200, h: 80 }];
    expect(snäppMotMittlinjer({ x: 500, y: 108 }, { w: 200, h: 80 }, andra)).toEqual({ x: 500, y: 100 });
    expect(snäppMotMittlinjer({ x: 500, y: 140 }, { w: 200, h: 80 }, andra)).toEqual({ x: 500, y: 140 });
    expect(snäppMotMittlinjer({ x: 6, y: 400 }, { w: 200, h: 80 }, andra)).toEqual({ x: 0, y: 400 });
  });

  it("lägena bor i mellanlagret och sprider det (invariant 4)", () => {
    const d = { ...DRAFT, framtida: 1 } as ProcessDraft & { framtida: number };
    const flyttad = setPresentationsLäge(d, "kredit", { x: 10.4, y: 20.6 }) as typeof d;
    expect(flyttad.framtida).toBe(1);
    expect(flyttad.presentation?.lägen).toEqual({ kredit: { x: 10, y: 21 } });
    expect(setPresentationsLäge(flyttad, "kredit", null).presentation?.lägen).toEqual({});
  });
});

describe("var kopplingarna går in i rutorna", () => {
  it("ett draget handtag landar på närmaste sida, i ett av sidans lägen", () => {
    const ruta = { x: 100, y: 100, w: 200, h: 80 };
    expect(närmasteSida(ruta, { x: 150, y: 96 })).toEqual({ side: "top", pos: 0.25 });
    expect(närmasteSida(ruta, { x: 305, y: 140 })).toEqual({ side: "right", pos: 0.5 });
    expect(närmasteSida(ruta, { x: 260, y: 184 })).toEqual({ side: "bottom", pos: 0.75 });
    // En romb har bara sina hörn.
    expect(närmasteSida(ruta, { x: 150, y: 96 }, true)).toEqual({ side: "top", pos: 0.5 });
  });

  it("valet styr vägen – och Ja/Nej mellan samma par är olika kopplingar (invariant 3)", () => {
    const före = bild();
    const kant = före.kanter.find((k) => k.source === "publicera" && k.target === "anmal")!;
    const draft = setPresentationsKoppling(DRAFT, kant.nyckel, "target", { side: "left", pos: 0.5 });
    const efter = avskalaAp(compileAp(draft), {}, draft.presentation?.kopplingar);
    const ny = efter.kanter.find((k) => k.nyckel === kant.nyckel)!;
    const anmal = efter.rutor.find((r) => r.id === "anmal")!;
    const slut = ny.pts[ny.pts.length - 1];
    expect(slut).toEqual({ x: anmal.x, y: anmal.y + anmal.h / 2 });
    expect(new Set(efter.kanter.map((k) => k.nyckel)).size).toBe(efter.kanter.length);
  });

  it("återställning tar bort bara den änden; en tom post försvinner (invariant 4: sprider)", () => {
    let d = setPresentationsKoppling(DRAFT, "a->b", "source", { side: "top", pos: 0.25 });
    d = setPresentationsKoppling(d, "a->b", "target", { side: "left", pos: 0.5 });
    d = setPresentationsKoppling(d, "a->b", "source", null);
    expect(d.presentation?.kopplingar).toEqual({ "a->b": { targetSide: "left", targetPos: 0.5 } });
    d = setPresentationsKoppling(d, "a->b", "target", null);
    expect(d.presentation?.kopplingar).toEqual({});
    expect(d.steps).toBe(DRAFT.steps);
  });

  it("redigeringsläget ritar ett handtag i varje ände, märkt med nyckeln", () => {
    const b = bild();
    const svg = renderAvskaladSvg(b, { handtag: true });
    expect((svg.match(/class="avsk-handtag"/g) ?? []).length).toBe(b.kanter.length * 2);
    expect(renderAvskaladSvg(b)).not.toContain("avsk-handtag");
  });
});

describe("avskalaAp – forum i kedjan", () => {
  /**
   * REGRESSION: den avskalade bilden behöll bara aktiviteter och regler. Ett
   * forum i kedjan – metodens "i stället för en aktivitet" – föll bort helt,
   * och "Avhandla agendapunkter" och "Fatta beslut" saknades i presentationen
   * av mötesprocessen (2026-10-13). Ett forum som SATELLIT är däremot inget steg.
   */
  it("REGRESSION: ett [Forum]-steg står kvar som numrerat steg, ett satellitforum gör det inte", () => {
    const d: ProcessDraft = {
      ...emptyDraft(),
      title: "Möte",
      lanes: [makeLane(L, 0)],
      steps: [
        steg("starta", "activity", "Starta möte", { ap: { roller: [KK], forum: "Ledningsgruppen", output: null } }),
        steg("besluta", "activity", "Fatta beslut", { ap: { roller: [KK], iMötesform: true, output: null } }),
        steg("avsluta", "activity", "Avsluta möte", { ap: { roller: [KK], output: null } }),
      ],
    };
    const b = avskalaAp(compileAp(d));
    const ids = b.rutor.map((r) => r.id);
    expect(ids).toContain("besluta");
    expect(b.rutor.find((r) => r.id === "besluta")?.nr).toBe(2);
    expect(ids.some((id) => id.startsWith("forum_"))).toBe(false);
  });
});

describe("avskalaAp – mötesprocessens fel (2026-10-13)", () => {
  const AC = { namn: "Avdelningschef", huki: "U" as const };
  const EC = { namn: "Enhetschefer", huki: "U" as const };
  const GR = { namn: "Avdelningsledningsgruppen", huki: "U" as const };
  const MÖTE: ProcessDraft = {
    ...emptyDraft(),
    title: "Möte",
    lanes: [makeLane(L, 0)],
    steps: [
      steg("kalla", "activity", "Kalla enhetschefer", { ap: { roller: [AC], output: null } }),
      steg("accept", "decision", "Accepterar enhetschefen?", { gateway: "exclusive" }),
      steg("komplettera", "activity", "Komplettera agenda", {
        branchOf: { stepId: "accept", label: "Ja" },
        ap: { roller: [EC], output: null },
      }),
      steg("forbered", "activity", "Förbered möte", { ap: { roller: [GR], output: null } }),
      steg("besluta", "activity", "Fatta beslut", { ap: { roller: [GR], iMötesform: true, output: null } }),
    ],
  };
  const b = avskalaAp(compileAp(MÖTE));
  const kant = (nyckel: string) => b.kanter.find((k) => k.nyckel === nyckel)!;

  it("REGRESSION: regelns Ja och Nej går ut ur OLIKA sidor när båda målen står nedanför", () => {
    const ja = kant("accept->komplettera#Ja").pts[0];
    const nej = kant("accept->forbered#Nej").pts[0];
    expect(ja.x !== nej.x || ja.y !== nej.y).toBe(true);
  });

  it("REGRESSION: två kopplingar in i samma ruta möts inte i en punkt – den som står i linje behåller mitten", () => {
    const f = b.rutor.find((r) => r.id === "forbered")!;
    const jaPts = kant("komplettera->forbered").pts;
    const ja = jaPts[jaPts.length - 1];
    const nejPts = kant("accept->forbered#Nej").pts;
    const nej = nejPts[nejPts.length - 1];
    expect(ja.x).toBeCloseTo(f.x + f.w / 2);
    expect(nej.x).not.toBeCloseTo(ja.x);
  });

  it("REGRESSION: forumet ritas som pratbubbla och regelns fråga står ovanför romben", () => {
    const svg = renderAvskaladSvg(b);
    const forum = svg.slice(svg.indexOf('data-ark-nod="besluta"'));
    expect(forum.slice(0, 600)).toMatch(/ A[\d.]+,[\d.]+ 0 1,0 /);
    const r = b.rutor.find((x) => x.id === "accept")!;
    const frågaY = [...svg.matchAll(/<text[^>]*y="([\d.]+)"[^>]*>Accepterar/g)].map((m) => +m[1]);
    expect(frågaY.length).toBeGreaterThan(0);
    for (const y of frågaY) expect(y).toBeLessThan(r.y + r.h / 2);
  });
});
