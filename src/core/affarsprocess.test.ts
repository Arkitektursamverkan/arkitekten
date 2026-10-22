/**
 * Tester för Affärsprocess-kompileringen (affarsprocess.ts).
 *
 * Kontrakt som låses här:
 *  - kedjan blir VO → aktivitet → VO → … med auto-föreslagna output-objekt,
 *  - beslut blir regler med svaren på relationerna,
 *  - satelliter (roll/intressent/krav/IT-stöd) hängs på sin aktivitet med
 *    rätt relationstyp och HUKI,
 *  - alla auto-objekt har STABILA id:n (härledda, aldrig räknare) så att
 *    omdöpningar via autoLabels aldrig kan förskjutas till fel objekt.
 */

import { describe, expect, it } from "vitest";
import {
  compileAp,
  föreslåOutput,
  renameSatellit,
  satellitId,
  sättUtobjekt,
  voId,
  voInId,
  type ApModel,
} from "./affarsprocess";
import {
  emptyDraft,
  makeLane,
  setTextSize,
  textSizeFor,
  type DraftStep,
  type ProcessDraft,
} from "./draft";
import type { NodeType } from "./model";

function steg(id: string, type: NodeType, text: string, extra?: Partial<DraftStep>): DraftStep {
  return { id, type, text, laneId: "Användare", sourceIndex: 0, ...extra };
}

function draftMed(steps: DraftStep[], extra?: Partial<ProcessDraft>): ProcessDraft {
  return {
    ...emptyDraft(),
    title: "Test",
    lanes: [makeLane("Användare", 0)],
    steps,
    ...extra,
  };
}

function nod(m: ApModel, id: string) {
  return m.nodes.find((n) => n.id === id);
}

function relMellan(m: ApModel, source: string, target: string) {
  return m.relations.find((r) => r.source === source && r.target === target);
}

describe("föreslåOutput", () => {
  it("bildar particip av regelbundna -a-verb med rätt genus", () => {
    expect(föreslåOutput("Registrera ansökan")).toBe("Ansökan registrerad");
    expect(föreslåOutput("Skapa beställning")).toBe("Beställning skapad");
    expect(föreslåOutput("Fatta beslut")).toBe("Beslut fattat");
  });

  it("bildar particip av stamformer (genomför, bedöm)", () => {
    expect(föreslåOutput("Genomför urval")).toBe("Urval genomfört");
    expect(föreslåOutput("Bedöm ärende")).toBe("Ärende bedömt");
  });

  it("kan partikelverb", () => {
    expect(föreslåOutput("Ta emot ansökan")).toBe("Ansökan mottagen");
  });

  it("ger inget förslag när aktivitetsnamnet saknar objekt", () => {
    expect(föreslåOutput("Utred")).toBeNull();
  });

  // Ett föredragsflöde: infinitiver, artikel, preposition och plural gav
  // förslag på trasig svenska mitt i kedjan.
  it("REGRESSION: infinitiv böjs som imperativ (Hålla → hållet)", () => {
    expect(föreslåOutput("Hålla föredraget")).toBe("Föredraget hållet");
    expect(föreslåOutput("Håll föredraget")).toBe("Föredraget hållet");
    expect(föreslåOutput("Sätta samman föreläsning")).toBe("Föreläsning sammansatt");
  });

  it("REGRESSION: neutrum känns igen på bestämd form och materialord", () => {
    expect(föreslåOutput("Samla material")).toBe("Material samlat");
    expect(föreslåOutput("Justera dokumentet")).toBe("Dokumentet justerat");
    // -het/-itet är utrum trots -et.
    expect(föreslåOutput("Höj kvaliteten")).toBe("Kvaliteten höjd");
  });

  it("REGRESSION: plural får plural particip", () => {
    expect(föreslåOutput("Ta emot applåder")).toBe("Applåder mottagna");
    expect(föreslåOutput("Gör justeringar")).toBe("Justeringar gjorda");
    // "en order" ser ut som plural men är det inte.
    expect(föreslåOutput("Ta emot order")).toBe("Order mottagen");
  });

  it("REGRESSION: artikel och bindande preposition hör till verbet, inte objektet", () => {
    expect(föreslåOutput("Skapa en presentation")).toBe("Presentation skapad");
    expect(föreslåOutput("Öva på föredraget")).toBe("Föredraget övat");
    // Genitivled: huvudordet "tid" bär genus.
    expect(föreslåOutput("Justera utifrån föreläsningens tid")).toBe(
      "Föreläsningens tid justerad",
    );
  });

  it("REGRESSION: ett namn som inte inleds med verb ger inget förslag alls", () => {
    // "Sista justeringar" gav "Justeringar sistad". Hellre inget objekt –
    // affärsprocesskontrollen påpekar den brutna kedjan och namnet är det som ska bytas.
    expect(föreslåOutput("Sista justeringar")).toBeNull();
    expect(föreslåOutput("Nya rutiner")).toBeNull();
  });
});

describe("compileAp – kedjan", () => {
  it("spränger in ett auto-VO mellan två aktiviteter", () => {
    const m = compileAp(
      draftMed([
        steg("s0", "start", "Behov uppstår"),
        steg("a1", "activity", "Genomför urval"),
        steg("a2", "activity", "Fatta beslut"),
      ]),
    );
    const vo = nod(m, voId("a1"));
    expect(vo).toBeDefined();
    expect(vo!.kind).toBe("vo");
    expect(vo!.label).toBe("Urval genomfört");
    expect(vo!.auto).toBe(true);
    // Kedjan: a1 → VO → a2, ingen direktkant a1 → a2.
    expect(relMellan(m, "a1", voId("a1"))?.kind).toBe("flode");
    expect(relMellan(m, voId("a1"), "a2")?.kind).toBe("flode");
    expect(relMellan(m, "a1", "a2")).toBeUndefined();
  });

  it("start och slut blir verksamhetsobjekt", () => {
    const m = compileAp(
      draftMed([steg("s0", "start", "Behov uppstår"), steg("a1", "activity", "Genomför urval")]),
    );
    expect(nod(m, "s0")?.kind).toBe("vo");
    // Auto-slutet (end_a1 från normalizeFlowEvents) är också ett VO.
    expect(nod(m, "end_a1")?.kind).toBe("vo");
    // Inget VO sprängs in före ett slut-objekt – slutet ÄR kedjans output.
    expect(relMellan(m, "a1", "end_a1")?.kind).toBe("flode");
  });

  it("explicit output vinner över förslaget och null väljer bort objektet", () => {
    const explicit = compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", { ap: { output: "Slutkandidat utsedd" } }),
        steg("a2", "activity", "Fatta beslut"),
      ]),
    );
    expect(nod(explicit, voId("a1"))?.label).toBe("Slutkandidat utsedd");
    expect(nod(explicit, voId("a1"))?.auto).toBeUndefined();

    const utan = compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", { ap: { output: null } }),
        steg("a2", "activity", "Fatta beslut"),
      ]),
    );
    expect(nod(utan, voId("a1"))).toBeUndefined();
    expect(relMellan(utan, "a1", "a2")?.kind).toBe("flode");
  });

  it("auto-VO kan döpas om via autoLabels på sitt stabila id", () => {
    const m = compileAp(
      draftMed(
        [steg("a1", "activity", "Genomför urval"), steg("a2", "activity", "Fatta beslut")],
        { autoLabels: { [voId("a1")]: "Kandidatlista" } },
      ),
    );
    expect(nod(m, voId("a1"))?.label).toBe("Kandidatlista");
  });

  /**
   * REGRESSION: ett `[Ut: …]` på SISTA steget ritades aldrig. Förädlingsobjekt
   * sprängs in MELLAN två aktiviteter, och efter sista steget finns bara ett
   * automatiskt slut-event – objektet försvann tyst ("tackmejl saknas").
   * I affärsprocessen finns inga slut-event; kedjan slutar i ett objekt, och
   * det automatiska slutet ÄR det objektet.
   */
  it("REGRESSION: ut-objektet på sista steget blir kedjans slutobjekt", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Registrerar ärende"),
        steg("a2", "activity", "Skickar bekräftelse", { ap: { output: "Tackmejl" } }),
      ]),
    );
    expect(nod(m, "end_a2")?.label).toBe("Tackmejl");
    expect(nod(m, "end_a2")?.kind).toBe("vo");
    expect(relMellan(m, "a2", "end_a2")?.kind).toBe("flode");
    // Ingen kvarglömd "Klart" vid sidan om.
    expect(m.nodes.filter((n) => n.label === "Klart")).toEqual([]);
  });

  it("ett eget namn på slutet vinner över ut-objektet", () => {
    const m = compileAp(
      draftMed(
        [
          steg("a1", "activity", "Registrerar ärende"),
          steg("a2", "activity", "Skickar bekräftelse", { ap: { output: "Tackmejl" } }),
        ],
        { autoLabels: { end_a2: "Ärendet avslutat" } },
      ),
    );
    expect(nod(m, "end_a2")?.label).toBe("Ärendet avslutat");
  });

  it("utan ut-objekt heter slutet fortfarande Klart", () => {
    const m = compileAp(draftMed([steg("a1", "activity", "Registrerar ärende")]));
    expect(nod(m, "end_a1")?.label).toBe("Klart");
  });

  it("explicit input ger ett VO före steget", () => {
    const m = compileAp(
      draftMed([steg("a1", "activity", "Genomför urval", { ap: { input: "Ansökningar" } })]),
    );
    const vo = nod(m, voInId("a1"));
    expect(vo?.kind).toBe("vo");
    expect(vo?.label).toBe("Ansökningar");
    expect(relMellan(m, voInId("a1"), "a1")?.kind).toBe("flode");
  });
});

describe("compileAp – regler", () => {
  it("beslut blir regel med svaren på relationerna", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Granska ärende"),
        steg("d1", "decision", "Godkänt?"),
        steg("a2", "activity", "Meddela beslut", { branchOf: { stepId: "d1", label: "Ja" } }),
        steg("a3", "activity", "Begär komplettering", { branchOf: { stepId: "d1", label: "Nej" } }),
      ]),
    );
    expect(nod(m, "d1")?.kind).toBe("regel");
    expect(relMellan(m, "d1", "a2")?.label).toBe("Ja");
    expect(relMellan(m, "d1", "a3")?.label).toBe("Nej");
    // Inget VO mellan regel och grenarna – objektet hör till AKTIVITETER.
    expect(nod(m, voId("d1"))).toBeUndefined();
  });
});

describe("compileAp – satelliter", () => {
  it("roller får HUKI-relation in mot aktiviteten", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", {
          ap: { roller: [{ namn: "Rekryteringsansvarig", huki: "U" }] },
        }),
      ]),
    );
    const roll = m.nodes.find((n) => n.kind === "roll");
    expect(roll).toBeDefined();
    expect(roll!.label).toBe("Rekryteringsansvarig");
    expect(roll!.anchorId).toBe("a1");
    // Stabilt, härlett id – ingen räknare.
    expect(roll!.id).toBe("roll_a1_rekryteringsansvarig");
    const r = relMellan(m, roll!.id, "a1");
    expect(r?.kind).toBe("huki");
    expect(r?.huki).toBe("U");
  });

  it("krav adresserar aktiviteten och IT-stöd samverkar", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", {
          ap: { krav: ["Öka mångfald"], applikationer: ["Fastighetssystemet"] },
        }),
      ]),
    );
    const krav = m.nodes.find((n) => n.kind === "krav");
    expect(relMellan(m, krav!.id, "a1")?.kind).toBe("adresserar");
    const app = m.nodes.find((n) => n.kind === "applikation");
    // Samverkar går FRÅN aktiviteten till IT-stödet.
    expect(relMellan(m, "a1", app!.id)?.kind).toBe("samverkar");
  });

  it("intressent utan angiven bokstav blir Informeras", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Fatta beslut", { ap: { intressenter: [{ namn: "Hyresgäst" }] } }),
      ]),
    );
    const rel = m.relations.find((r) => r.kind === "huki");
    expect(rel?.huki).toBe("I");
  });
});

describe("compileAp – datalager och meddelanden", () => {
  it("datalager blir applikation med Samverkar med från skrivaren", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Registrera ärende"),
        steg("ds1", "datastore", "SP-listan Incident"),
        steg("a2", "activity", "Handlägg ärende"),
      ]),
    );
    const app = nod(m, "ds1");
    expect(app?.kind).toBe("applikation");
    expect(app?.anchorId).toBe("a1"); // hänger på skrivaren
    expect(relMellan(m, "a1", "ds1")?.kind).toBe("samverkar");
    expect(relMellan(m, "a2", "ds1")?.kind).toBe("samverkar"); // läsaren
  });

  it("meddelande till extern mottagare blir kuvert-VO ur aktiviteten", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Registrera ärende"),
        steg("n1", "notification", "Mejl skickas", { recipient: "Kunden" }),
      ]),
    );
    const kuvert = m.nodes.find((n) => n.voVariant === "meddelande");
    expect(kuvert).toBeDefined();
    expect(kuvert!.label).toBe("Till Kunden");
    expect(kuvert!.anchorId).toBe("n1");
    expect(relMellan(m, "n1", kuvert!.id)?.kind).toBe("flode");
  });
});

describe("redigeringshjälpare (fas 5)", () => {
  const bas = draftMed([
    steg("a1", "activity", "Genomför urval", {
      ap: { roller: [{ namn: "HR", huki: "U" }] },
    }),
    steg("a2", "activity", "Fatta beslut"),
  ]);

  it("sättUtobjekt(null) väljer bort objektet och rensar gammal omdöpning", () => {
    const medRest = { ...bas, autoLabels: { [voId("a1")]: "Gammalt namn" } };
    const utan = sättUtobjekt(medRest, "a1", null);
    expect(nod(compileAp(utan), voId("a1"))).toBeUndefined();
    expect(utan.autoLabels?.[voId("a1")]).toBeUndefined();
    // Tillbaka till auto-förslaget.
    const åter = sättUtobjekt(utan, "a1", undefined);
    expect(nod(compileAp(åter), voId("a1"))?.label).toBe("Urval genomfört");
  });

  it("renameSatellit byter namn och flyttar med sparad position till nya id:t", () => {
    const gammaltId = satellitId("roll", "a1", "HR");
    const medPos = { ...bas, autoPositions: { [gammaltId]: { x: 10, y: 20 } } };
    const bytt = renameSatellit(medPos, "a1", "roll", "HR", "HR-partner");
    const m = compileAp(bytt);
    const roll = m.nodes.find((n) => n.kind === "roll")!;
    expect(roll.label).toBe("HR-partner");
    const nyttId = satellitId("roll", "a1", "HR-partner");
    expect(roll.id).toBe(nyttId);
    expect(bytt.autoPositions?.[nyttId]).toEqual({ x: 10, y: 20 });
    expect(bytt.autoPositions?.[gammaltId]).toBeUndefined();
    // HUKI-bokstaven följer med.
    expect(m.relations.find((r) => r.kind === "huki")?.huki).toBe("U");
  });

  it("manuella positioner når ap-modellen (steg via steget, auto via autoPositions)", () => {
    const medPos: ProcessDraft = {
      ...bas,
      steps: bas.steps.map((s) => (s.id === "a1" ? { ...s, position: { x: 1, y: 2 } } : s)),
      autoPositions: { [voId("a1")]: { x: 3, y: 4 } },
    };
    const m = compileAp(medPos);
    expect(nod(m, "a1")?.position).toEqual({ x: 1, y: 2 });
    expect(nod(m, voId("a1"))?.position).toEqual({ x: 3, y: 4 });
  });
});

describe("textstorlek per objekt", () => {
  /**
   * Kravet: "jag vill kunna ändra storleken på texten på respektive objekt".
   * Reglaget i panelen skalar HELA diagrammet; det här gäller ett objekt.
   * Steg bär sin egen storlek, allt annat (satelliter, insprängda objekt,
   * auto-slut, fria objekt) nycklas på sitt härledda id – samma mekanism som
   * namn och lägen.
   */
  const BAS = draftMed([
    steg("a1", "activity", "Genomför urval", {
      ap: { roller: [{ namn: "HR", huki: "U" }], input: "Ansökningar" },
    }),
    steg("a2", "activity", "Fatta beslut"),
  ]);

  it("ett steg bär sin egen storlek", () => {
    const d = setTextSize(BAS, "a1", 1.4);
    expect(d.steps[0].textSize).toBe(1.4);
    expect(nod(compileAp(d), "a1")?.textSize).toBe(1.4);
  });

  it("satelliter, insprängda objekt och auto-slut nycklas på sitt id", () => {
    let d = BAS;
    for (const id of [satellitId("roll", "a1", "HR"), voId("a1"), voInId("a1"), "end_a2"]) {
      d = setTextSize(d, id, 0.8);
    }
    const m = compileAp(d);
    expect(nod(m, satellitId("roll", "a1", "HR"))?.textSize).toBe(0.8);
    expect(nod(m, voId("a1"))?.textSize).toBe(0.8);
    expect(nod(m, voInId("a1"))?.textSize).toBe(0.8);
    expect(nod(m, "end_a2")?.textSize).toBe(0.8);
    // Grannen är orörd.
    expect(nod(m, "a1")?.textSize).toBeUndefined();
  });

  it("ett fritt objekt bär sin egen storlek", () => {
    const d = setTextSize(
      { ...BAS, apFria: [{ id: "fri_1", kind: "roll", namn: "Extern part" }] },
      "fri_1",
      1.3,
    );
    expect(nod(compileAp(d), "fri_1")?.textSize).toBe(1.3);
  });

  it("kläms till 0,5–2 och nollställs till normalläget", () => {
    expect(textSizeFor(setTextSize(BAS, "vo_a1", 9), "vo_a1")).toBe(2);
    expect(textSizeFor(setTextSize(BAS, "vo_a1", 0.1), "vo_a1")).toBe(0.5);
    const nollad = setTextSize(setTextSize(BAS, "vo_a1", 1.5), "vo_a1", null);
    expect(textSizeFor(nollad, "vo_a1")).toBe(1);
    expect(nollad.autoTextSizes?.["vo_a1"]).toBeUndefined();
  });
});

describe("compileAp – spårbarhet", () => {
  it("kedjenoder behåller sourceIndex, auto-objekt har −1", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Genomför urval", { sourceIndex: 3, sourceText: "urvalet görs" }),
        steg("a2", "activity", "Fatta beslut", { sourceIndex: 4 }),
      ]),
    );
    expect(nod(m, "a1")?.sourceIndex).toBe(3);
    expect(nod(m, "a1")?.sourceText).toBe("urvalet görs");
    expect(nod(m, voId("a1"))?.sourceIndex).toBe(-1);
  });
});

describe("compileAp – relationens kant i mellanlagret", () => {
  /**
   * REGRESSION: i affärsprocessverktyget gick det inte att skriva en etikett på en
   * koppling alls – varken en ny eller en ändring av "Nej". Pilen man
   * dubbelklickar på är inte alltid kanten i mellanlagret: mellan två
   * aktiviteter sprängs ett objekt in, och pilen ut ur det (vo_a1 → a2) är
   * kanten a1 → a2. Relationen pekar därför ut sin kant (2026-10-13).
   */
  it("REGRESSION: pilen ut ur ett insprängt objekt bär kanten mellan aktiviteterna", () => {
    const m = compileAp(
      draftMed([
        steg("a1", "activity", "Skapa agenda"),
        steg("a2", "activity", "Kalla enhetschefer"),
        steg("r", "decision", "Accepterar chefen?", { gateway: "exclusive" }),
        steg("a3", "activity", "Komplettera agenda", { branchOf: { stepId: "r", label: "Ja" } }),
        steg("a4", "activity", "Förbered möte"),
      ]),
    );
    const rel = (s: string, t: string) => m.relations.find((r) => r.source === s && r.target === t);
    expect(rel("vo_a1", "a2")?.kant).toEqual({ source: "a1", target: "a2" });
    // Benet IN i objektet hör till samma kant när aktiviteten bara har en väg ut.
    expect(rel("a1", "vo_a1")?.kant).toEqual({ source: "a1", target: "a2" });
    // Regelns grenar bär sin etikett, den motsatta vägen också.
    expect(rel("r", "a3")?.kant).toEqual({ source: "r", target: "a3", label: "Ja" });
    expect(rel("r", "a4")?.kant).toEqual({ source: "r", target: "a4", label: "Nej" });
  });

  it("satelliter har ingen kant – de går inte att sätta etikett på", () => {
    const m = compileAp(
      draftMed([steg("a1", "activity", "Skapa agenda", { ap: { roller: [{ namn: "Chef", huki: "U" }] } })]),
    );
    expect(m.relations.filter((r) => r.kind === "huki").every((r) => !r.kant)).toBe(true);
  });
});
