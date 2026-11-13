/**
 * Tester för affärsprocessens layoutmotor (layout-affarsprocess.ts).
 *
 * Kontrakt som låses:
 *  - kedjan läser vänster→höger i rankordning, grenar en rad ner,
 *  - satelliter ligger över (krav/tid) respektive under (roll/IT m.fl.)
 *    sitt ankare och FÖLJER MED ankaret till samma del (R8),
 *  - inga överlapp mellan placerade objekt,
 *  - sidbrytning sker bara när bredden kräver det (R1) och är
 *    deterministisk (R7).
 */

import { describe, expect, it } from "vitest";
import { compileAp } from "@/core/affarsprocess";
import { emptyDraft, makeLane, type DraftStep, type ProcessDraft } from "@/core/draft";
import type { NodeType } from "@/core/model";
import { ikonPortRuta } from "./former";
import { layoutAp, type ApLayout } from "./layout-affarsprocess";

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 0, ...extra };
}

function draftMed(steps: DraftStep[], extra?: Partial<ProcessDraft>): ProcessDraft {
  return { ...emptyDraft(), title: "Test", lanes: [makeLane("Användare", 0)], steps, ...extra };
}

function plats(lo: ApLayout, id: string) {
  const p = lo.nodes.find((n) => n.node.id === id);
  expect(p, `${id} saknas i utlägget`).toBeDefined();
  return p!;
}

const KEDJA = draftMed([
  steg("s0", "start", "Behov uppstår"),
  steg("a1", "activity", "Registrera ansökan", {
    ap: { roller: [{ namn: "Handläggare", huki: "U" }], krav: ["GDPR"] },
  }),
  steg("a2", "activity", "Genomför urval", {
    ap: { applikationer: ["Ärendesystemet"] },
  }),
]);

describe("layoutAp – kedjan", () => {
  it("läser vänster→höger i flödesordning", () => {
    const lo = layoutAp(compileAp(KEDJA));
    const s0 = plats(lo, "s0");
    const a1 = plats(lo, "a1");
    const vo = plats(lo, "vo_a1");
    const a2 = plats(lo, "a2");
    expect(s0.x).toBeLessThan(a1.x);
    expect(a1.x).toBeLessThan(vo.x);
    expect(vo.x).toBeLessThan(a2.x);
  });

  it("grenar ur en regel får en egen rad, sammanslagningen går tillbaka upp", () => {
    const lo = layoutAp(
      compileAp(
        draftMed([
          steg("a1", "activity", "Granska ärende"),
          steg("d1", "decision", "Godkänt?"),
          steg("a2", "activity", "Meddela beslut", { branchOf: { stepId: "d1", label: "Ja" } }),
          steg("a3", "activity", "Begär komplettering", {
            branchOf: { stepId: "d1", label: "Nej" },
          }),
          steg("a4", "activity", "Avsluta ärende"),
        ]),
      ),
    );
    const ja = plats(lo, "a2");
    const nej = plats(lo, "a3");
    const efter = plats(lo, "a4");
    expect(nej.y).toBeGreaterThan(ja.y); // andra grenen en rad ner
    expect(efter.y).toBeLessThan(nej.y); // sammanslagningen tillbaka på övre raden
  });

  it("inga objekt överlappar", () => {
    const lo = layoutAp(compileAp(KEDJA));
    for (const a of lo.nodes) {
      for (const b of lo.nodes) {
        if (a === b) continue;
        const isär =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(isär, `${a.node.id} överlappar ${b.node.id}`).toBe(true);
      }
    }
  });
});

describe("layoutAp – anslutningssidor för in-/ut-objekt", () => {
  /**
   * REGRESSION: ett [In: …]-objekt hamnar en rad under kedjan (det delar
   * kolumn med föregående aktivitets ut-objekt). Routerns generella regel
   * "olika rad ⇒ lodrät anslutning" lät då pilen gå ur objektets ÖVERKANT in
   * i aktivitetens UNDERKANT – på skärmen såg det ut som en utgång FRÅN
   * aktiviteten som tog slut i objektet, tvärtemot vad relationen betyder
   * ("Genomför urval har en koppling till Ansökningar, som sen tar
   * slut"). Ett in-objekt ska komma in från VÄNSTER som allt annat i kedjan.
   */
  const MED_INPUT = draftMed([
    steg("a1", "activity", "Annonsera tjänst"),
    steg("a2", "activity", "Genomför urval", { ap: { input: "Ansökningar" } }),
  ]);

  it("REGRESSION: in-objektet kopplas in från vänster, inte underifrån", () => {
    const model = compileAp(MED_INPUT);
    const lo = layoutAp(model);
    const inVo = plats(lo, "vo_in_a2");
    const a2 = plats(lo, "a2");
    // Objektet ligger på en egen rad, till vänster om sin aktivitet.
    expect(inVo.y).toBeGreaterThan(a2.y);
    expect(inVo.x).toBeLessThan(a2.x);

    const rel = model.relations.find((r) => r.source === "vo_in_a2" && r.target === "a2")!;
    expect(lo.sides[rel.id]).toEqual({ sourceSide: "right", targetSide: "left" });
  });

  it("kedjans egna kopplingar på samma rad får inget förval alls", () => {
    const model = compileAp(MED_INPUT);
    const lo = layoutAp(model);
    const kedjan = model.relations.find((r) => r.source === "a1" && r.target === "vo_a1")!;
    expect(lo.sides[kedjan.id]).toBeUndefined();
  });

  it("en gren ur en regel rörs ALDRIG – där är vägen nedåt hela poängen", () => {
    const model = compileAp(
      draftMed([
        steg("d1", "decision", "Godkänt?"),
        steg("a2", "activity", "Meddela beslut", { branchOf: { stepId: "d1", label: "Ja" } }),
        steg("a3", "activity", "Begär komplettering", {
          branchOf: { stepId: "d1", label: "Nej" },
        }),
      ]),
    );
    const lo = layoutAp(model);
    for (const r of model.relations) {
      const a = model.nodes.find((n) => n.id === r.source)!;
      const b = model.nodes.find((n) => n.id === r.target)!;
      // Regel → aktivitet har inget verksamhetsobjekt i någon ände.
      if (a.kind !== "vo" && b.kind !== "vo") {
        expect(lo.sides[r.id], `${r.source}→${r.target} fick ett förval`).toBeUndefined();
      }
    }
  });
});

describe("layoutAp – raka streck", () => {
  const MED_SATELLITER = draftMed([
    steg("a1", "activity", "Genomför urval", {
      ap: {
        roller: [
          { namn: "Rekryterande chef", huki: "H" },
          { namn: "HR", huki: "K" },
        ],
        krav: ["Öka mångfald"],
        output: null,
      },
    }),
  ]);

  /**
   * REGRESSION: aktivitetens underkant har EN portpunkt i mitten. Två roller
   * bredvid varandra fick var sin Z-böj, och routern la böjarna på olika höjd –
   * "den högra ser ut att ha böjen ovanför den andra".
   *
   * Satelliterna UNDER en aktivitet står numera i staplar,
   * och då kan strecken inte gå rakt upp var för sig – de skulle ligga ovanpå
   * varandra och dras tvärs igenom namnen ovanför. Kontraktet är i stället:
   * varje streck är RÄTVINKLIGT – vågrätt ut ur symbolens sida, böj vid
   * stammen, lodrätt upp. Kraven ovanför aktiviteten går fortfarande rakt.
   *
   * Står symbolen GRENSLE över stammen finns ingen böj alls: strecket går rakt
   * upp ur ikonens överkant. Det är fortfarande rätvinkligt – och en böj hade
   * krävt ett vågrätt hopp ut ur ikonen och tillbaka in under den.
   */
  it("REGRESSION: satellitstrecket är rätvinkligt – vågrätt ut, lodrätt upp", () => {
    const model = compileAp(MED_SATELLITER);
    const lo = layoutAp(model);
    const rel = model.relations.filter((r) => r.kind === "huki" || r.kind === "adresserar");
    expect(rel.length).toBe(3);
    const lika = (a: number, b: number) => Math.abs(a - b) < 0.01;
    for (const r of rel) {
      const p = lo.ports[r.id];
      expect(p?.from, `${r.source} → ${r.target} saknar portpunkter`).toBeDefined();
      const lodrätt = lika(p!.from!.x, p!.to!.x);
      // Utan böj MÅSTE strecket vara lodrätt – annars ritar routern en fri väg
      // där kontraktet lovar ett L.
      if (!p?.via) {
        expect(lodrätt, `${r.source} → ${r.target}: ingen böj men inte heller lodrätt`).toBe(true);
        continue;
      }
      const rätvinkligtL =
        (lika(p.via.x, p!.to!.x) && lika(p.via.y, p!.from!.y)) ||
        (lika(p.via.x, p!.from!.x) && lika(p.via.y, p!.to!.y));
      expect(
        lodrätt || rätvinkligtL,
        `${r.source} → ${r.target}: strecket är varken lodrätt eller ett rätvinkligt L`,
      ).toBe(true);
    }
  });

  /**
   * REGRESSION: bokstaven satt mitt på VAR LINJE, och eftersom en hatt och en
   * cylinder är olika höga hamnade bokstäverna – och böjarna – på olika höjd.
   * "De ska linjera och vara symmetriska vid böjar". Alla satelliter
   * under samma aktivitet delar nu EN linje: där böjer strecken och där står
   * bokstaven.
   */
  it("REGRESSION: satelliterna under en aktivitet delar böj- och etiketthöjd", () => {
    const model = compileAp(
      draftMed([
        steg("a1", "activity", "Annonsera tjänst", {
          ap: { roller: [{ namn: "HR", huki: "U" }], applikationer: ["Rekryteringssystem"], output: null },
        }),
      ]),
    );
    const lo = layoutAp(model);
    const sat = model.relations
      .filter((r) => r.kind === "huki" || r.kind === "samverkar")
      .map((r) => lo.ports[r.id]?.via);
    expect(sat).toHaveLength(2);
    expect(sat[0], "ingen gemensam linje").toBeDefined();
    // Samma höjd – rollen och IT-stödet är olika höga objekt.
    expect(sat[0]!.y).toBe(sat[1]!.y);
    // …och linjen ligger MELLAN aktiviteten och satelliterna.
    const a1 = plats(lo, "a1");
    const hatt = lo.nodes.find((n) => n.node.kind === "roll")!;
    expect(sat[0]!.y).toBeGreaterThan(a1.y + a1.h);
    expect(sat[0]!.y).toBeLessThan(hatt.y + hatt.h);
  });

  /**
   * REGRESSION: rollens streck försvann bakom IT-stödets.
   *
   * De två stammarna hölls isär av ett fast litet gap (satGapX/4 ≈ 3 px). Med
   * EN roll och ETT IT-stöd under samma aktivitet räckte det inte: linjerna låg
   * i praktiken på varandra, och det som syntes var en krok där den blå kom in
   * under den svarta (beslut 2026-09-07: "Kopplingarna är inte rundade och
   * snygga"). Springan följer nu aktivitetens bredd.
   */
  it("REGRESSION: rollens stam och IT-stödets ligger synligt isär", () => {
    const model = compileAp(
      draftMed([
        steg("a1", "activity", "Skapar akut ärende i ärendehanteringssystem", {
          ap: { roller: [{ namn: "Kund-medarbetare", huki: "U" }], applikationer: ["Portalen"] },
        }),
      ]),
    );
    const lo = layoutAp(model);
    const stam = (typ: "huki" | "samverkar") =>
      lo.ports[model.relations.find((r) => r.kind === typ)!.id]!.to!.x;
    const a1 = plats(lo, "a1");
    const isär = Math.abs(stam("huki") - stam("samverkar"));
    expect(isär, `stammarna ligger ${isär.toFixed(1)} px isär`).toBeGreaterThan(a1.w * 0.1);
    // …och båda ligger kvar inom aktiviteten, inte utanför dess kanter.
    for (const typ of ["huki", "samverkar"] as const) {
      expect(stam(typ)).toBeGreaterThanOrEqual(a1.x);
      expect(stam(typ)).toBeLessThanOrEqual(a1.x + a1.w);
    }
  });

  it("två roller med SAMMA ansvar delar stam och står i en stapel", () => {
    const model = compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", {
          ap: {
            roller: [
              { namn: "Rekryterande chef", huki: "U" },
              { namn: "HR", huki: "U" },
            ],
            output: null,
          },
        }),
      ]),
    );
    const lo = layoutAp(model);
    const huki = model.relations.filter((r) => r.kind === "huki").map((r) => lo.ports[r.id]);
    expect(huki).toHaveLength(2);
    // Båda möter aktivitetens underkant i SAMMA punkt – det är stammen.
    expect(huki[0]!.to!.y).toBe(huki[1]!.to!.y);
    expect(huki[0]!.to!.x).toBe(huki[1]!.to!.x);
    // Rollerna är staplade, inte radade sida vid sida: samma x, olika höjd.
    expect(huki[0]!.from!.x).toBe(huki[1]!.from!.x);
    expect(huki[0]!.from!.y).not.toBe(huki[1]!.from!.y);
  });

  /**
   * REGRESSION: stammen räknades ur SATELLITERNA – "strax till höger om den
   * bredaste aktören" – och kläms in i aktiviteten. Med bara aktörer under
   * aktiviteten hamnade den därför vid rutans ena kant, och VILKEN kant
   * berodde på var rollerna råkade stå: i 2.3.1.14 gick uppgången i högerkanten
   * under en aktivitet och i vänsterkanten under nästa (beslut 2026-09-08:
   * "kopplingarna är fortfarande inte så snygga … fixa till dem så de blir
   * konsekventa"). Stammen fäster i MITTEN – knappt en tiondels
   * aktivitetsbredd åt sidan – oavsett var rollen står.
   */
  it("REGRESSION: stammen sitter mitt under aktiviteten, var rollerna än står", () => {
    const bara = draftMed([
      steg("a1", "activity", "Genomför urval", {
        ap: { roller: [{ namn: "HR", huki: "U" }], output: null },
      }),
    ]);
    const stamAv = (draft: ProcessDraft) => {
      const model = compileAp(draft);
      const lo = layoutAp(model);
      const rel = model.relations.find((r) => r.kind === "huki")!;
      const a1 = plats(lo, "a1");
      // Andel av aktivitetsbredden, räknat från mitten: skalfritt mått.
      return (lo.ports[rel.id]!.to!.x - (a1.x + a1.w / 2)) / a1.w;
    };
    const mittUnder = stamAv(bara);
    expect(Math.abs(mittUnder), `stammen ligger ${mittUnder.toFixed(2)} av bredden från mitten`)
      .toBeLessThan(0.12);

    // …och samma andel när rollen står långt åt sidan (handplacerat läge).
    const lo0 = layoutAp(compileAp(bara));
    const roll0 = lo0.nodes.find((n) => n.node.kind === "roll")!;
    const åtSidan: ProcessDraft = {
      ...bara,
      autoPositions: { [roll0.node.id]: { x: roll0.x - roll0.dx + 260, y: roll0.y } },
    };
    expect(stamAv(åtSidan)).toBeCloseTo(mittUnder, 5);
  });

  /**
   * REGRESSION: en DRAGEN kopplingspunkt gick inte att ändra.
   *
   * Klustrets stammar ska vinna över sparade anslutningspunkter "mitt på
   * sidan" (förvalet), men inte över ett handgrepp: den som drar
   * ändpunkten till en annan plats på sidan ska styra. Skillnaden är just att
   * en dragen position avviker från mitten (beslut 2026-09-07: "Jag måste kunna
   * markera en koppling och ändra den, likaså dra om den").
   */
  it("REGRESSION: en dragen kopplingspunkt slår ut klustrets stam", () => {
    const model = compileAp(MED_SATELLITER);
    const rel = model.relations.find((r) => r.kind === "huki")!;
    const nyckel = `${rel.source}->${rel.target}#${rel.huki}`;

    // Ärvd mittpunkt (som importen skriver): klustret gäller.
    const ärvd = layoutAp(model, {
      edgeStyles: { [nyckel]: { targetSide: "bottom", targetPos: 0.5 } },
    });
    expect(ärvd.ports[rel.id]?.to, "klustrets stam ska gälla").toBeDefined();

    // Dragen punkt: användarens val gäller, layouten pekar inte ut något.
    const dragen = layoutAp(model, {
      edgeStyles: { [nyckel]: { targetSide: "bottom", targetPos: 0.2 } },
    });
    expect(dragen.ports[rel.id]?.to, "den dragna punkten ska gälla").toBeUndefined();
  });

  /**
   * REGRESSION: två ansvarstyper på samma stam dolde varandra.
   *
   * Varje ansvarstyp har sin färg (U blå, I gul, H orange, K oliv). Låg
   * de på samma lodräta linje ritades den ena ovanpå den andra, och den som
   * hamnade under såg ut som ett kort streck som inte ledde någonstans
   * (2026-09-07, Kund-medarbetare under "Hanterar ärendet via gängse rutiner").
   * Aktörssidan får därför en stam per ansvarstyp.
   */
  it("REGRESSION: två roller med OLIKA ansvar får var sin stam", () => {
    const model = compileAp(MED_SATELLITER); // H och K
    const lo = layoutAp(model);
    const huki = model.relations.filter((r) => r.kind === "huki").map((r) => lo.ports[r.id]);
    expect(huki).toHaveLength(2);
    expect(huki[0]!.to!.x).not.toBe(huki[1]!.to!.x);
    // …men de ligger kvar i samma knippe, inte utspridda över aktiviteten.
    const a1 = plats(lo, "a1");
    expect(Math.abs(huki[0]!.to!.x - huki[1]!.to!.x)).toBeLessThan(a1.w / 2);
  });

  /**
   * REGRESSION: en KARTA ("2 Huvudprocess Leverans", "4.4 Drift") är bara rutor
   * utan pilar. Bredden räknades bara på kedjans kolumner, och en karta har
   * inga – utlägget blev 0 px brett, scenen fick `bredd: 0` och EA-portalen
   * ritade en tom yta där kartan skulle stå.
   */
  it("REGRESSION: en karta utan pilar får en bredd", () => {
    const lo = layoutAp({
      title: "Huvudprocess",
      meta: { sourceText: "", sourceFragments: [], warnings: [] },
      nodes: ["Försäljning", "Driftfråga", "Leverans", "Fakturering"].map((label, i) => ({
        id: `p${i}`,
        kind: "aktivitet" as const,
        label,
        sourceIndex: i,
      })),
      relations: [],
    });
    expect(lo.nodes).toHaveLength(4);
    expect(lo.width).toBeGreaterThan(0);
    expect(lo.pages[0].w).toBeGreaterThan(0);
  });

  /**
   * REGRESSION: verksamhetsobjektets ruta är symbol + namn under, alltså tyngre
   * nedåt. Centrerades rutan i raden hamnade symbolen ovanför kedjans linje och
   * varje pil vidare fick en Z-böj – "varje koppling är krokig".
   */
  it("REGRESSION: symbolerna ligger på samma linje som aktiviteternas mitt", () => {
    const lo = layoutAp(
      compileAp(
        draftMed([
          steg("a1", "activity", "Hämtar filer"),
          steg("a2", "activity", "Sparar filer"),
        ]),
      ),
    );
    const a1 = plats(lo, "a1");
    const vo = lo.nodes.find((n) => n.node.kind === "vo")!;
    const ikon = ikonPortRuta(vo.node.kind, vo.w, vo.h)!;
    const symbolMitt = vo.y + ikon.y + ikon.h / 2;
    expect(Math.abs(symbolMitt - (a1.y + a1.h / 2))).toBeLessThan(0.01);
  });
});

describe("layoutAp – användarens kopplingspunkter", () => {
  /**
   * Kravet: "Jag vill kunna ha olika kopplingspunkter på själva objektet."
   * Valet sparas i mellanlagret (edgeStyles) och måste vägas in HÄR – exporten
   * har ingen draft att fråga, den läser bara layouten. Annars ritade filen
   * pilen på ett ställe och skärmen på ett annat.
   */
  const MED_ROLL = draftMed([
    steg("a1", "activity", "Genomför urval", {
      ap: { roller: [{ namn: "HR", huki: "U" }], output: null },
    }),
  ]);

  it("ett valt sidval vinner över layoutens automatiska punkt", () => {
    const model = compileAp(MED_ROLL);
    const rel = model.relations.find((r) => r.kind === "huki")!;
    const nyckel = `${rel.source}->${rel.target}#U`;

    const utan = layoutAp(model);
    expect(utan.ports[rel.id]?.to, "layouten pekar normalt ut båda ändar").toBeDefined();

    const med = layoutAp(model, { edgeStyles: { [nyckel]: { targetSide: "left" } } });
    expect(med.sides[rel.id]?.targetSide).toBe("left");
    // Den valda änden lämnas åt routern; den andra behåller sin raka punkt.
    expect(med.ports[rel.id]?.to).toBeUndefined();
    expect(med.ports[rel.id]?.from).toBeDefined();
  });

  it("brytpunkten följer med till layouten, så exporten ser den", () => {
    const model = compileAp(MED_ROLL);
    const rel = model.relations.find((r) => r.kind === "huki")!;
    const lo = layoutAp(model, {
      edgeStyles: { [`${rel.source}->${rel.target}#U`]: { waypoint: { x: 40, y: 60 } } },
    });
    expect(lo.sides[rel.id]?.waypoint).toEqual({ x: 40, y: 60 });
  });

  it("REGRESSION: med VARJE objekt på eget läge hängde en tom remsa till höger – bredden räknades på motorns kolumner, inte på innehållet (demoflödet i Ramar: 1 820 px för 1 460)", () => {
    const utan = layoutAp(compileAp(KEDJA));
    // Lägg allt tätt ihop i vänsterkanten.
    const autoPositions = Object.fromEntries(utan.nodes.map((n, i) => [n.node.id, { x: 10 + i * 5, y: n.y }]));
    const lo = layoutAp(compileAp({ ...KEDJA, autoPositions }));
    const innehåll = Math.max(...lo.nodes.map((n) => n.x + n.w));
    expect(lo.width).toBeLessThan(utan.width);
    expect(lo.width - innehåll).toBeLessThan(60);
  });

  it("REGRESSION: en brytpunkt under/till höger om alla objekt klipptes bort – bilden var bara så stor som objekten, och en återkopplingsräls under kedjan gick rakt ut ur exportens nederkant", () => {
    const model = compileAp(KEDJA);
    const rel = model.relations.find((r) => r.kind === "flode")!;
    const utan = layoutAp(model);
    const långtBort = { x: utan.width + 300, y: utan.height + 400 };
    const lo = layoutAp(model, {
      edgeStyles: { [`${rel.source}->${rel.target}`]: { waypoint: långtBort } },
    });
    expect(lo.height).toBeGreaterThan(långtBort.y);
    expect(lo.width).toBeGreaterThan(långtBort.x);
    expect(lo.pages[0].h).toBe(lo.height);
  });

  it("par-nyckeln utan etikett fungerar som reserv (bakåtkompatibelt)", () => {
    const model = compileAp(MED_ROLL);
    const rel = model.relations.find((r) => r.kind === "huki")!;
    const lo = layoutAp(model, {
      edgeStyles: { [`${rel.source}->${rel.target}`]: { targetSide: "right" } },
    });
    expect(lo.sides[rel.id]?.targetSide).toBe("right");
  });
});

describe("layoutAp – forum mitt i kedjan", () => {
  /**
   * REGRESSION: ett fritt FORUM mitt i kedjan (aktiviteten är alltid ett
   * möte) med verksamhetsobjekt på var sida. Forumet är en satellitsort, så
   * båda dess pilar typades som
   * satellitpilar – kedjan bröts itu och halvorna la sig på var sin rad. Ett
   * fritt objekt av den sorten är en KEDJENOD när det sitter mellan objekt.
   */
  it("REGRESSION: ett forum mitt i kedjan bryter inte kedjan", () => {
    const draft = draftMed(
      [steg("a1", "activity", "Processaktivitet", { ap: { output: null } })],
      {
        apFria: [
          { id: "f_in", kind: "vo", namn: "Input till aktivitet" },
          { id: "f_ut", kind: "vo", namn: "Output från aktivitet" },
          { id: "f_forum", kind: "forum", namn: "Forum" },
          { id: "f_slut", kind: "vo", namn: "Slutobjekt" },
        ],
        extraEdges: [
          { source: "f_in", target: "a1" },
          { source: "a1", target: "f_ut" },
          { source: "f_ut", target: "f_forum" },
          { source: "f_forum", target: "f_slut" },
        ],
      },
    );
    const model = compileAp(draft);
    // Alla fyra pilarna är förädlingskedja – ingen satellitrelation.
    expect(model.relations.every((r) => r.kind === "flode")).toBe(true);
    const lo = layoutAp(model);
    // …och därmed EN rad: varje objekt överlappar aktivitetens höjdled.
    // (Mittpunkterna skiljer sig – ikontyperna centreras på sin SYMBOL, inte
    // på hela rutan – men ingen hamnar på en egen rad.)
    const a1 = plats(lo, "a1");
    for (const n of lo.nodes) {
      expect(
        n.y < a1.y + a1.h && n.y + n.h > a1.y,
        `${n.node.id} hamnade på en egen rad (y=${n.y.toFixed(0)})`,
      ).toBe(true);
    }
    // Kedjan läser vänster→höger i rätt ordning.
    const iOrdning = ["f_in", "a1", "f_ut", "f_forum", "f_slut"].map((id) => plats(lo, id).x);
    expect([...iOrdning].sort((a, b) => a - b)).toEqual(iOrdning);
  });

  it("ett IT-stöd på en aktivitet är fortfarande en satellit", () => {
    const draft = draftMed([steg("a1", "activity", "Läser in filen", { ap: { output: null } })], {
      apFria: [{ id: "f_it", kind: "applikation", namn: "PM" }],
      extraEdges: [{ source: "a1", target: "f_it" }],
    });
    const model = compileAp(draft);
    expect(model.relations[0].kind).toBe("samverkar");
    // …och ritas i bandet UNDER aktiviteten, inte i kedjeraden.
    const lo = layoutAp(model);
    expect(plats(lo, "f_it").y).toBeGreaterThan(plats(lo, "a1").y + plats(lo, "a1").h);
  });

  /**
   * REGRESSION: en intressent kopplad till ett FRITT objekt (forumet ovan) har
   * inget anchorId – den kommer inte ur något stegs ap-block. Utan ett härlett
   * ankare räknades den som kedjenod, fick rank 0 och hamnade FÖRST i kedjan,
   * före processens ingång.
   */
  it("REGRESSION: en satellit på ett fritt objekt hamnar under det, inte i kedjan", () => {
    const draft = draftMed([steg("a1", "activity", "Processaktivitet", { ap: { output: null } })], {
      apFria: [
        { id: "f_forum", kind: "forum", namn: "Forum" },
        { id: "f_int", kind: "intressent", namn: "Intressent" },
      ],
      extraEdges: [
        { source: "a1", target: "f_forum" },
        { source: "f_int", target: "f_forum" },
      ],
    });
    const lo = layoutAp(compileAp(draft));
    const forum = plats(lo, "f_forum");
    const int = plats(lo, "f_int");
    expect(int.y).toBeGreaterThan(forum.y + forum.h);
    // Centrerad under sitt objekt, inte längst till vänster i kedjan.
    expect(Math.abs(int.x + int.w / 2 - (forum.x + forum.w / 2))).toBeLessThan(2);
  });
});

describe("layoutAp – okopplade objekt", () => {
  /**
   * REGRESSION: objekt utan kopplingar (fristående noteringar, och allt i en
   * karta utan pilar) hamnade i kedjans FÖRSTA kolumn och knuffades ner en rad
   * var av krockregeln. Kedjan blev då flera rader hög, och satellitbandet –
   * som börjar under kedjans sista rad – sköts långt bort från sina
   * aktiviteter: tre noteringar räckte för att lyfta rollerna ur bilden.
   */
  it("REGRESSION: lösa objekt tänjer inte ut kedjan – de får ett eget band underst", () => {
    const draft = draftMed(
      [
        steg("a1", "activity", "Förhandlar", {
          ap: { roller: [{ namn: "Affärsutvecklare", huki: "U" }], output: null },
        }),
        steg("a2", "activity", "Skriver avtal", { ap: { output: null } }),
      ],
      {
        apFria: [
          { id: "f1", kind: "problem", namn: "Attestreglementet" },
          { id: "f2", kind: "problem", namn: "Oenighet" },
          { id: "f3", kind: "problem", namn: "Tingsrätten" },
        ],
      },
    );
    const lo = layoutAp(compileAp(draft));
    const a1 = plats(lo, "a1");
    const a2 = plats(lo, "a2");
    const roll = lo.nodes.find((n) => n.node.kind === "roll")!;
    const lösa = ["f1", "f2", "f3"].map((id) => plats(lo, id));

    // Kedjan är EN rad: aktiviteterna ligger i samma höjd.
    expect(a1.y).toBe(a2.y);
    // Rollen ligger tätt under sin aktivitet – inte under de lösa objekten.
    expect(roll.y).toBeGreaterThan(a1.y + a1.h);
    expect(roll.y - (a1.y + a1.h)).toBeLessThan(40);
    // De lösa ligger underst, på rad, och kolliderar inte med rollen.
    expect(lösa.every((l) => l.y >= roll.y + roll.h)).toBe(true);
    expect(lösa[0].y).toBe(lösa[1].y);
    expect(lösa[0].x).toBeLessThan(lösa[1].x);
  });

  it("ett fritt objekt som användaren själv placerat ligger kvar där", () => {
    const draft = draftMed([steg("a1", "activity", "Förhandlar", { ap: { output: null } })], {
      apFria: [{ id: "f1", kind: "problem", namn: "Attestreglementet" }],
      autoPositions: { f1: { x: 400, y: 300 } },
    });
    const lo = layoutAp(compileAp(draft));
    expect(plats(lo, "f1").x).toBe(400);
    expect(plats(lo, "f1").y).toBe(300);
  });
});

describe("layoutAp – satelliter", () => {
  it("krav ligger över ankaret, centrerat; rollen under, till vänster om stammen", () => {
    const lo = layoutAp(compileAp(KEDJA));
    const a1 = plats(lo, "a1");
    const krav = lo.nodes.find((n) => n.node.kind === "krav")!;
    const roll = lo.nodes.find((n) => n.node.kind === "roll")!;
    expect(krav.y + krav.h).toBeLessThanOrEqual(a1.y);
    expect(roll.y).toBeGreaterThanOrEqual(a1.y + a1.h);
    // Kravet: centrerat kring ankaret (ensam satellit på sin hylla).
    expect(Math.abs(krav.x + krav.w / 2 - (a1.x + a1.w / 2))).toBeLessThan(1);
    // Rollen: till vänster om aktivitetens mitt, men nära den.
    const rollMitt = roll.x + roll.w / 2;
    expect(rollMitt).toBeLessThan(a1.x + a1.w / 2);
    expect(rollMitt).toBeGreaterThan(a1.x + a1.w / 2 - a1.w / 2 - roll.w);
  });

  /**
   * REGRESSION: aktörsstapeln stod CENTRERAD under aktiviteten, alltså mitt på
   * klustrets stam. Den översta aktörens streck gick rakt upp genom ikonen,
   * och nästa aktörs fick slingra sig runt den första för att nå stammen
   * (beslut 2026-10-13: "jag gillar inte alls hur de skapas"). Forumet hängde
   * dessutom på aktörssidan med sitt svarta streck och gick runt rollerna.
   *
   * Nu står aktörerna till VÄNSTER
   * om sin stam med ikonerna under varandra, IT-stöd och forum till HÖGER om
   * sin, och varje streck är ETT vågrätt + ETT lodrätt – inga omvägar.
   */
  it("REGRESSION: aktörerna står bredvid stammen, inte på den – inga streck slingrar runt", () => {
    const model = compileAp(
      draftMed([
        steg("a1", "activity", "Håll möte", {
          ap: {
            roller: [
              { namn: "Avdelningschef", huki: "U" },
              { namn: "Enhetschefer", huki: "U" },
            ],
            applikationer: ["Teams"],
            forum: "Ledningsgruppen",
            output: null,
          },
        }),
      ]),
    );
    const lo = layoutAp(model);
    const a1 = plats(lo, "a1");
    const mitt = a1.x + a1.w / 2;
    for (const rel of model.relations.filter((r) => r.kind === "huki" || r.kind === "samverkar")) {
      const satId = rel.kind === "huki" ? rel.source : rel.target;
      const sat = plats(lo, satId);
      const p = lo.ports[rel.id]!;
      const satPunkt = rel.kind === "huki" ? p.from! : p.to!;
      const stamPunkt = rel.kind === "huki" ? p.to! : p.from!;
      const ikon = ikonPortRuta(sat.node.kind, sat.w, sat.h) ?? { x: 0, y: 0, w: sat.w, h: sat.h };
      const ikonV = sat.x + ikon.x;
      const ikonH = ikonV + ikon.w;
      // Ett vågrätt streck ut ur ikonens sida, böj vid stammen, rakt upp.
      expect(p.via, `${satId}: ingen böj`).toBeDefined();
      expect(p.via!.x).toBe(stamPunkt.x);
      expect(p.via!.y).toBe(satPunkt.y);
      expect(stamPunkt.y).toBe(a1.y + a1.h);
      if (rel.kind === "huki") {
        expect(ikonH, `${satId} står på stammen`).toBeLessThan(stamPunkt.x);
        expect(satPunkt.x).toBeCloseTo(ikonH);
        expect(stamPunkt.x).toBeLessThan(mitt);
      } else {
        expect(ikonV, `${satId} står på stammen`).toBeGreaterThan(stamPunkt.x);
        expect(satPunkt.x).toBeCloseTo(ikonV);
        expect(stamPunkt.x).toBeGreaterThan(mitt);
      }
      // Namnet under en aktör slutar före stammen – den lägre aktörens stam
      // går upp förbi det.
      if (rel.kind === "huki") expect(sat.x + sat.w).toBeLessThan(stamPunkt.x);
    }
    // Aktörerna står i en stapel, ikonerna under varandra.
    const roller = lo.nodes.filter((n) => n.node.kind === "roll");
    expect(roller[0].x + roller[0].w / 2).toBeCloseTo(roller[1].x + roller[1].w / 2);
  });

  it("REGRESSION: flera ansvarstyper – stammarna läggs utåt vänster och håller avstånd till IT-stödets", () => {
    const model = compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval av kandidater", {
          ap: {
            roller: [
              { namn: "Rekryterande chef", huki: "H" },
              { namn: "HR", huki: "U" },
              { namn: "Facklig representant", huki: "K" },
            ],
            applikationer: ["Rekryteringssystem"],
            output: null,
          },
        }),
      ]),
    );
    const lo = layoutAp(model);
    const stam = (r: (typeof model.relations)[number]) => lo.ports[r.id]!.to!.x;
    const huki = model.relations.filter((r) => r.kind === "huki");
    const it = lo.ports[model.relations.find((r) => r.kind === "samverkar")!.id]!.from!.x;
    const xs = huki.map(stam);
    // Tre skilda stammar, översta gruppen längst ut – och ingen trängs mot IT.
    expect(new Set(xs).size).toBe(3);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(it - xs[2]).toBeGreaterThan(xs[2] - xs[1]);
  });

  it("R8: satelliten följer sitt ankare till samma del vid sidbrytning", () => {
    // Många aktiviteter så att en smal sida tvingar fram snitt.
    const steps: DraftStep[] = [];
    for (let i = 1; i <= 8; i++) {
      steps.push(
        steg(`a${i}`, "activity", `Utför moment ${i}`, {
          ap: { roller: [{ namn: `Roll ${i}` }], output: null },
        }),
      );
    }
    const lo = layoutAp(compileAp(draftMed(steps)), { pageWidth: 700 });
    expect(lo.pages.length).toBeGreaterThan(1);
    for (const sat of lo.nodes.filter((n) => n.node.anchorId)) {
      const ankare = plats(lo, sat.node.anchorId!);
      expect(sat.page, `${sat.node.id} tappade sin del`).toBe(ankare.page);
      // Och satelliten ligger horisontellt vid sitt ankare, inte kvar på del 1.
      expect(Math.abs(sat.x + sat.w / 2 - (ankare.x + ankare.w / 2))).toBeLessThan(
        ankare.w / 2 + sat.w,
      );
    }
  });
});

describe("layoutAp – ikontypernas mått", () => {
  it("REGRESSION: tid-noden växer med etiketten så texten inte klipps", () => {
    // "Inom 5 dagar" (12 tecken ≈ 78 px) i en 62 px bred nod: canvasens
    // nod-SVG klippte texten till "nom 5 daga". Noden ska vara minst så bred
    // som etikettens längsta rad enligt formmodulens metrik.
    const lo = layoutAp(
      compileAp(
        draftMed([
          steg("a1", "activity", "Lämna anställningserbjudande", {
            ap: { tid: "Inom 5 dagar", roller: [{ namn: "Rekryterande chef" }] },
          }),
        ]),
      ),
    );
    const tid = lo.nodes.find((n) => n.node.kind === "tid")!;
    expect(tid.w).toBeGreaterThanOrEqual("Inom 5 dagar".length * 6.5);
    // Aktörens namn ("Rekryterande chef") ryms på EN rad sedan radbredden
    // lagts om – men rutan ska rymma både symbolen
    // och raden, och vara minst så bred som namnet.
    const roll = lo.nodes.find((n) => n.node.kind === "roll")!;
    expect(roll.h).toBeGreaterThanOrEqual(32 + 13.5);
    expect(roll.w).toBeGreaterThanOrEqual("Rekryterande chef".length * 6);
    // Och inget av det får överlappa något annat.
    for (const a of lo.nodes) {
      for (const b of lo.nodes) {
        if (a === b) continue;
        const isär =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(isär, `${a.node.id} överlappar ${b.node.id}`).toBe(true);
      }
    }
  });
});

describe("layoutAp – manuella positioner (fas 5)", () => {
  it("en manuell position vinner över autoplaceringen", () => {
    const utan = layoutAp(compileAp(KEDJA));
    const a1Auto = plats(utan, "a1");
    const flyttad = draftMed(
      KEDJA.steps.map((s) =>
        s.id === "a1" ? { ...s, position: { x: a1Auto.x + 40, y: a1Auto.y + 25 } } : s,
      ),
    );
    const lo = layoutAp(compileAp(flyttad));
    const a1 = plats(lo, "a1");
    expect(a1.x).toBeCloseTo(a1Auto.x + 40);
    expect(a1.y).toBeCloseTo(a1Auto.y + 25);
  });

  it("positioner sparas i FRIA ramen och översätts med dx i delat läge (R4: delen ändras aldrig)", () => {
    const lo0 = layoutAp(compileAp(KEDJA), { pageWidth: 400 });
    const nod = lo0.nodes.find((n) => n.page > 0 && !n.node.anchorId)!;
    expect(nod).toBeDefined();
    // Spara som canvasen gör: skärmläge − dx = fria ramen.
    const fri = { x: nod.x - nod.dx + 30, y: nod.y + 10 };
    const flyttad: ProcessDraft = {
      ...KEDJA,
      steps: KEDJA.steps.map((s) => (s.id === nod.node.id ? { ...s, position: fri } : s)),
      autoPositions: KEDJA.steps.some((s) => s.id === nod.node.id)
        ? undefined
        : { [nod.node.id]: fri },
    };
    const lo1 = layoutAp(compileAp(flyttad), { pageWidth: 400 });
    const efter = plats(lo1, nod.node.id);
    expect(efter.page, "delen ändrades av ett musdrag").toBe(nod.page);
    expect(efter.x).toBeCloseTo(nod.x + 30);
    expect(efter.y).toBeCloseTo(nod.y + 10);
  });

  it("satelliter följer sitt DRAGNA ankare", () => {
    const utan = layoutAp(compileAp(KEDJA));
    const a1Auto = plats(utan, "a1");
    const flyttad = draftMed(
      KEDJA.steps.map((s) =>
        s.id === "a1" ? { ...s, position: { x: a1Auto.x + 120, y: a1Auto.y } } : s,
      ),
    );
    const lo = layoutAp(compileAp(flyttad));
    const a1 = plats(lo, "a1");
    const roll = lo.nodes.find((n) => n.node.kind === "roll" && n.node.anchorId === "a1")!;
    // Samma läge relativt ankaret som utan flytt.
    const rollAuto = utan.nodes.find((n) => n.node.kind === "roll" && n.node.anchorId === "a1")!;
    expect(roll.x - a1.x).toBeCloseTo(rollAuto.x - a1Auto.x);
  });

  it("en satellit med egen manuell position behåller den", () => {
    const lo0 = layoutAp(compileAp(KEDJA));
    const roll0 = lo0.nodes.find((n) => n.node.kind === "roll")!;
    const fri = { x: roll0.x - roll0.dx - 55, y: roll0.y + 15 };
    const flyttad: ProcessDraft = { ...KEDJA, autoPositions: { [roll0.node.id]: fri } };
    const lo1 = layoutAp(compileAp(flyttad));
    const roll1 = lo1.nodes.find((n) => n.node.id === roll0.node.id)!;
    expect(roll1.x).toBeCloseTo(roll0.x - 55);
    expect(roll1.y).toBeCloseTo(roll0.y + 15);
  });
});

describe("layoutAp – sidor", () => {
  it("R1: fri bredd ger EN del, smal sida ger flera", () => {
    const fri = layoutAp(compileAp(KEDJA));
    expect(fri.pages.length).toBe(1);
    const smal = layoutAp(compileAp(KEDJA), { pageWidth: 400 });
    expect(smal.pages.length).toBeGreaterThan(1);
  });

  it("relation som korsar ett snitt får hänvisningsmärken åt båda håll", () => {
    const smal = layoutAp(compileAp(KEDJA), { pageWidth: 400 });
    expect(smal.refs.length).toBeGreaterThan(0);
    const ut = smal.refs.find((r) => r.riktning === "ut");
    const inn = smal.refs.find((r) => r.riktning === "in");
    expect(ut?.text).toMatch(/^till del \d+$/);
    expect(inn?.text).toMatch(/^från del \d+$/);
  });

  it("R7: determinism – samma modell och format ger exakt samma utlägg", () => {
    const m = compileAp(KEDJA);
    const a = layoutAp(m, { pageWidth: 400 });
    const b = layoutAp(m, { pageWidth: 400 });
    expect(b.nodes.map((n) => [n.node.id, n.page, n.x, n.y])).toEqual(
      a.nodes.map((n) => [n.node.id, n.page, n.x, n.y]),
    );
  });

  it("objekt ryms inom sin dels ram", () => {
    const smal = layoutAp(compileAp(KEDJA), { pageWidth: 400 });
    for (const n of smal.nodes) {
      const sida = smal.pages[n.page];
      expect(n.x).toBeGreaterThanOrEqual(sida.x);
      expect(n.x + n.w).toBeLessThanOrEqual(sida.x + sida.w);
    }
  });
});

describe("layoutAp – forum i kedjan", () => {
  /**
   * REGRESSION: pratbubblan är en ellips med svans, men pilarna räknades mot
   * rutan. Rollens pil slutade i svansens höjd bredvid bubblan, och stammen
   * gick upp rakt i svansen.
   */
  it("REGRESSION: rollens pil möter bubblans kontur, till höger om svansen", () => {
    const model = compileAp(
      draftMed([
        steg("a1", "activity", "Fatta beslut", {
          ap: { roller: [{ namn: "Avdelningschef", huki: "U" }], iMötesform: true, output: null },
        }),
      ]),
    );
    const lo = layoutAp(model);
    const f = plats(lo, "a1");
    expect(f.node.kind).toBe("forum");
    const p = lo.ports[model.relations.find((r) => r.kind === "huki")!.id]!;
    // Svansen går ut ur undersidan vid 29–51 % av bredden.
    expect(p.to!.x).toBeGreaterThan(f.x + f.w * 0.51);
    // Pilen slutar på konturen – ovanför rutans underkant (svansens spets).
    expect(p.to!.y).toBeLessThanOrEqual(f.y + f.h * (1 - 0.18));
    expect(p.to!.y).toBeGreaterThan(f.y + f.h * 0.5);
  });
});
