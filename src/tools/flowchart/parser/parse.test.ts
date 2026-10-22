import { describe, expect, it } from "vitest";
import { parseToModel, textToDraft } from "./parse";
import { validateModel } from "./validate";

const FELANMALAN = `Felanmälan ny
Fel uppkommer → Medarbetare → Startar Portalen → Väljer ny felanmälan från startsidan → Fyller i formulär för felanmälan → Väljer skicka in formuläret för felanmälan →→ Handläggare utses automatiskt utifrån det system som valts → Kommer till en sida med tack för ditt ärende → Får via mejl bekräftelse på att felanmälan har inkommit

Felanmälan inkommer i SP-listan "Incident" → Power Automate flödet "INC → nytt ärende → informera anv → skriva till logg" triggas (↓ Om klassificering = Hög prioritet → Teamschatt skapas med alla handläggare på IT → Chattmeddelande genereras för det specifika ärendet) → Mejlbekräftelse på felanmälan skickas till användaren → Mejl skickas till handläggaren → Loggpost skapas`;

const BESTALLNING = `Beställning ny
Behov av produkt, tjänst eller någon form av hjälp - Startar Portalen - Väljer ny beställning från startsidan - Fyller i formulär för beställning - Om kommunikationsinsats väljs så tillhandahålls andra frågor - därefter skickas en notis till samtliga handläggare på kommunikationsavdelningen i form av mejl och chat meddelande i Team - Om en beställningsvara har valts - Handläggare utses utifrån beställningsvara - annars ingen handläggare - Kommer till en sida med tack för ditt ärende`;

describe("parseToModel – felanmälan", () => {
  const model = parseToModel(FELANMALAN);

  it("sätter titel", () => {
    expect(model.title).toBe("Felanmälan ny");
  });

  it("skapar noder", () => {
    expect(model.nodes.length).toBeGreaterThan(8);
  });

  it("skapar minst en beslutsnod (KRAV 3)", () => {
    expect(model.nodes.some((n) => n.type === "decision")).toBe(true);
  });

  it("skapar datalager som artefakter (Regel 4)", () => {
    // Datalager är inte längre noder i sekvensflödet utan BPMN-artefakter.
    expect(model.dataStores.length).toBeGreaterThan(0);
    expect(model.nodes.some((n) => n.type === "datastore")).toBe(false);
  });

  it("skapar notifieringsnoder (Regel 3)", () => {
    expect(model.nodes.filter((n) => n.type === "notification").length).toBeGreaterThanOrEqual(2);
  });

  it("aktörsord skriver INTE över en aktivitets egen bana", () => {
    // "Medarbetare" satte tidigare aktörskontext som gällde allt efter sig, så
    // portalaktiviteterna hamnade i Användare trots att portalregeln pekat ut
    // Portalen. Hela flödets första hälft låg i fel bana.
    const portalSteg = model.nodes.filter((n) => /portalen|startsidan|formulär/i.test(n.label));
    expect(portalSteg.length).toBeGreaterThan(0);
    for (const n of portalSteg) {
      expect(n.laneId, `"${n.label}" hamnade i ${n.laneId}`).toBe("Portalen");
    }
  });

  it("automatiska steg utförs av automatiseringen, inte av aktören", () => {
    const auto = model.nodes.find((n) => /automatiskt/i.test(n.label))!;
    expect(auto.laneId).toBe("Power Automate");
  });

  it("en MOTTAGNING hör till mottagaren, inte till avsändaren", () => {
    // "Får via mejl bekräftelse" är ingen sändning – användaren tar emot den.
    // Tidigare hamnade den hos portalen som råkade stå före i texten.
    const mottagning = model.nodes.find((n) => /får via mejl/i.test(n.label))!;
    expect(mottagning.laneId).toBe("Användare");
    expect(mottagning.messageDirection).toBe("receive");
  });

  it("en mottagning ger inget utgående meddelandeflöde", () => {
    const mottagning = model.nodes.find((n) => /får via mejl/i.test(n.label))!;
    expect(model.messageFlows.some((f) => f.nodeId === mottagning.id)).toBe(false);
  });

  it("ett utskick hör till avsändaren", () => {
    const utskick = model.nodes.find((n) => /mejl skickas till handläggaren/i.test(n.label))!;
    expect(utskick.laneId).toBe("Power Automate");
    expect(utskick.messageDirection).toBe("send");
  });

  it("grupperar i flera swimlanes (KRAV 2)", () => {
    expect(model.swimlanes.length).toBeGreaterThanOrEqual(3);
  });

  it("tappar inga fragment (Regel 2)", () => {
    const report = validateModel(model);
    if (!report.ok) console.log("Obehandlade:", report.unaccounted);
    expect(report.unaccounted).toEqual([]);
  });

  it("har Ja/Nej-kanter på beslutsgrenar", () => {
    const labels = model.edges.map((e) => e.label).filter(Boolean);
    expect(labels).toContain("Ja");
  });
});

describe("parseToModel – beställning (inline-beslut + annars)", () => {
  const model = parseToModel(BESTALLNING);

  it("skapar beslutsnoder för 'Om ... väljs'", () => {
    const decisions = model.nodes.filter((n) => n.type === "decision");
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions.map((d) => d.label).join(" | ")).toMatch(/vald\?/i);
  });

  it("tappar inga fragment (Regel 2)", () => {
    const report = validateModel(model);
    if (!report.ok) console.log("Obehandlade:", report.unaccounted);
    expect(report.unaccounted).toEqual([]);
  });
});

describe("REGRESSION: substantiv gör inte en aktivitet till ett beslut", () => {
  // Bart "prioritet" i beslutsregexen gjorde varje steg som NÄMNDE ordet till
  // en gateway – "sätter prioritet på ärendet" fick grenar den aldrig haft.
  const model = parseToModel(`Test
Ärende registreras → Handläggaren sätter prioritet på ärendet → Ärendet stängs`);

  it("steget förblir en aktivitet", () => {
    const nod = model.nodes.find((n) => n.label.includes("prioritet"));
    expect(nod).toBeDefined();
    expect(nod!.type).not.toBe("decision");
  });

  it("riktiga beslut känns fortfarande igen", () => {
    const m = parseToModel(`Test
Start → Om klassificering = Hög prioritet → Klart`);
    expect(m.nodes.some((n) => n.type === "decision")).toBe(true);
  });
});

describe("REGRESSION: citattecken skyddar namn med bindestreck", () => {
  // Separatorn i beskrivningarna är " - ", och Power Automate-flödet heter
  // "Kommentarer - SRQ, INC och UTV". Utan skydd klipptes namnet mitt itu och
  // blev två steg – flödet fick ett objekt som hette "SRQ, INC och UTV triggas".
  const model = parseToModel(`Test
Anger kommentar → Power Automate flödet "Kommentarer - SRQ, INC och UTV" triggas → Loggning`);

  it("flödesnamnet blir ETT steg, med strecket kvar", () => {
    const nod = model.nodes.find((n) => n.label.includes("Kommentarer"));
    expect(nod).toBeDefined();
    // Etiketten kortas av shortLabel (egen regel), men strecket i namnet är
    // kvar och namnet har inte blivit två steg.
    expect(nod!.label).toContain("Kommentarer - SRQ");
    expect(model.nodes.some((n) => n.label.startsWith("SRQ"))).toBe(false);
    expect(nod!.sourceText).toContain('"Kommentarer - SRQ, INC och UTV"');
  });

  it("bindestreck UTANFÖR citat delar fortfarande", () => {
    const m = parseToModel(`Test
Öppnar portalen - väljer ärende - skriver kommentar`);
    expect(m.nodes.filter((n) => n.type !== "end").length).toBe(3);
  });
});

/**
 * Banan följer FLÖDET, inte textordningen.
 *
 * Standard är att flödet går vidare i samma bana; bytet kräver ett skäl. Ett
 * datalager är inget skäl – det ligger utanför sekvensflödet, och läste
 * banöverföringen av det hamnade allt efter en loggning i SharePoint.
 */
describe("REGRESSION: banan bärs vidare i sekvensflödet, aldrig av ett datalager", () => {
  const TEXT = `Chatt med användaren
Chatt ska startas → Handläggaren öppnar Portalen → Väljer befintlig felanmälan → Loggpost sparas i SP-listan "Kommentar" → Klart`;

  it("ett steg utan egen banregel fortsätter i föregående stegs bana", () => {
    const d = textToDraft(TEXT);
    const väljer = d.steps.find((s) => s.text.startsWith("Väljer befintlig"))!;
    // Låg i Användare förut: förvalet var LANE.USER i stället för kedjans bana.
    expect(väljer.laneId).toBe("Portalen");
  });

  it("steget EFTER en loggpost hör till banan före loggposten, inte till SharePoint", () => {
    const d = textToDraft(TEXT);
    const logg = d.steps.find((s) => s.type === "datastore")!;
    const klart = d.steps.find((s) => s.text === "Klart")!;
    expect(logg.laneId).toBe("SharePoint");
    expect(klart.laneId).toBe("Portalen");
  });

  it("auto-slutet ligger i samma bana som noden det hänger på", () => {
    const m = parseToModel(TEXT);
    const slut = m.nodes.find((n) => n.type === "end")!;
    const in_ = m.edges.filter((e) => e.target === slut.id);
    expect(in_.length).toBeGreaterThan(0);
    for (const e of in_) {
      expect(m.nodes.find((n) => n.id === e.source)!.laneId).toBe(slut.laneId);
    }
  });

  it("ett beslut efter en loggpost hamnar inte i SharePoint", () => {
    const d = textToDraft(`Test
Handläggaren öppnar Portalen → Loggpost sparas i SP-listan "Kommentar" → Ska ärendet stängas? (↓ Ja → Stänger ärendet)`);
    for (const s of d.steps.filter((x) => x.type === "decision")) {
      expect(s.laneId).not.toBe("SharePoint");
    }
  });

  it("REGRESSION: en parentes utan grensyntax blir text, inte egna steg", () => {
    // "Behov av information (åhörare) och/eller att informera (förehållare)"
    // blev fyra steg, varav tre nonsens ("Åhörare", "Förehållare"). En
    // parentes utan beslutshuvud och utan separator är ett förtydligande.
    const d = textToDraft(`Test
Behov av information (åhörare) och/eller att informera (förehållare) - Instudering`);
    expect(d.steps).toHaveLength(2);
    expect(d.steps[0].text).toContain("(åhörare)");
    expect(d.steps.map((x) => x.text)).not.toContain("Åhörare");
    expect(d.steps[1].text).toBe("Instudering");
  });

  it("REGRESSION: grensyntaxen är oförändrad", () => {
    // Parentesen med beslutshuvud ska fortfarande bli beslut + Ja-gren.
    const d = textToDraft("Test\nA (↓ Om ja → B) → C");
    expect(d.steps.map((x) => x.type)).toEqual(["activity", "decision", "activity", "activity"]);
    expect(d.steps[2].branchOf).toEqual({ stepId: d.steps[1].id, label: "Ja" });
  });

  it("REGRESSION: en parentes MED separator delas som förr", () => {
    // Delsekvensen är kvar för den som skriver flera steg i en parentes.
    const d = textToDraft("Test\nA (B → C) → D");
    expect(d.steps.map((x) => x.text)).toEqual(["A", "B", "C", "D"]);
  });

  it("ett aktörsord gäller nästa steg – inte allt efter det", () => {
    // "Handläggaren" ska inte dra tillbaka senare portalsteg till sin egen bana.
    const d = textToDraft(`Test
Ärendet öppnas → Handläggaren → Öppnar Portalen → Fortsätter arbetet → Klart`);
    const efter = d.steps.filter((s) =>
      ["Fortsätter arbetet", "Klart"].includes(s.text),
    );
    expect(efter.map((s) => s.laneId)).toEqual(["Portalen", "Portalen"]);
  });
});
