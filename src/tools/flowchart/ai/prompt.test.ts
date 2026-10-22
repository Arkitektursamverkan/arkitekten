/**
 * Prompten per diagramtyp.
 *
 * Bakgrund: verktyget Affärsprocess skickade flödesschemats systemprompt.
 * Metodens regler låg där som ett frivilligt PS ("… (frivilliga)"), så
 * tolkningarna kom tillbaka som simbaneflöden utan satelliter, utan
 * förädlingskedja och med aktiviteter som inte var verb + substantiv.
 */

import { describe, expect, it } from "vitest";

import { AP_SYSTEM_PROMPT, flödesschemaPrompt, bridgeInstruction, systemPrompt } from "./prompt";

describe("systemPrompt", () => {
  it("REGRESSION: affärsprocessen får metodens prompt, inte flödesschemats", () => {
    expect(systemPrompt("affarsprocess")).toBe(AP_SYSTEM_PROMPT);
    expect(systemPrompt("affarsprocess")).not.toBe(flödesschemaPrompt());
    // Standard (och utelämnad typ) är fortfarande flödesschemat.
    expect(systemPrompt()).toBe(flödesschemaPrompt());
    expect(systemPrompt("flowchart")).toBe(flödesschemaPrompt());
  });

  /**
   * REGRESSION: prompten listade [Forum: Ledningsgruppen] bland satelliterna,
   * så AI:n hängde samma möte som en bubbla bredvid varje mötessteg. Metoden
   * använder forumet I STÄLLET FÖR en aktivitet (beslut 2026-10-13).
   */
  it("REGRESSION: forumet står i en aktivitets ställe – aldrig som satellit", () => {
    expect(AP_SYSTEM_PROMPT).toContain("I STÄLLET FÖR EN AKTIVITET");
    expect(AP_SYSTEM_PROMPT).toContain("[Forum]");
    expect(AP_SYSTEM_PROMPT).not.toContain("[Forum: Ledningsgruppen]");
  });

  it("REGRESSION: affärsprocessprompten kräver metodens regler – de är inte frivilliga", () => {
    // Satelliterna: efterfrågade, inte ett PS.
    expect(AP_SYSTEM_PROMPT).toContain("[Roll:");
    expect(AP_SYSTEM_PROMPT).toContain("HUKI");
    expect(AP_SYSTEM_PROMPT).not.toContain("frivilliga");
    // Förädlingskedjan och namngivningen ur metoden.
    expect(AP_SYSTEM_PROMPT).toContain("VERB + SUBSTANTIV");
    expect(AP_SYSTEM_PROMPT).toContain("FÖRÄDLINGSKEDJAN");
    // Ut-objektet sätts på steget som SKAPAR det (iakttagelsen var att
    // [In: …] gav objekt ur tomma intet och bröt kedjan).
    expect(AP_SYSTEM_PROMPT).toMatch(/\[Ut: .*SKAPAR|SKAPAR objektet/s);
    // Inga simbanor i affärsprocessen.
    expect(AP_SYSTEM_PROMPT).toContain("METODENS REGLER");
    expect(AP_SYSTEM_PROMPT).toContain("INGA SIMBANOR");
    expect(AP_SYSTEM_PROMPT).not.toContain("SWIMLANES");
  });

  it("REGRESSION: `note` är BESKRIVNINGEN i affärsprocessen, tolkningsnot i flödesschemat", () => {
    // Metoden: "En aktivitet ska alltid innehålla en beskrivning." I ap blir
    // `note` i-ikonens text (ApInspector: "Beskrivning (ger i-ikonen)"), så
    // flödesschemats regel – note BARA vid tolkning – gav affärsprocesser där
    // varje aktivitet saknade beskrivning och kontrollen anmärkte på allihop.
    expect(flödesschemaPrompt()).toContain("`note` skrivs BARA när steget är en tolkning");
    expect(AP_SYSTEM_PROMPT).not.toContain("`note` skrivs BARA när steget är en tolkning");
    expect(AP_SYSTEM_PROMPT).toContain("aktivitetens BESKRIVNING");
    expect(AP_SYSTEM_PROMPT).toContain('"i"-ikonen');
  });

  it("regeln är metodens och/eller-regel", () => {
    // "Om flera efterföljande aktiviteter kan utföras används 'Och'. Om det är
    // endast en bland flera möjliga så används 'Eller'."
    expect(AP_SYSTEM_PROMPT).toContain("OCH-regel");
    expect(AP_SYSTEM_PROMPT).toContain("ELLER-regel");
  });

  it("affärsprocessprompten kräver annoteringarna även i AI-beskrivningen", () => {
    // aiText tolkas om av regelmotorn när användaren redigerar den – utan
    // hakparenteser där tappas satelliterna vid första omtolkningen.
    const aiTextAvsnitt = AP_SYSTEM_PROMPT.slice(AP_SYSTEM_PROMPT.indexOf("AI-BESKRIVNINGEN"));
    expect(aiTextAvsnitt.slice(0, 800)).toContain("hakparenteser");
  });

  it("gemensamma regler står kvar i BÅDA prompterna", () => {
    for (const prompt of [flödesschemaPrompt(), AP_SYSTEM_PROMPT]) {
      expect(prompt).toContain("ETT steg per meningsbärande aktivitet");
      expect(prompt).toContain("Hitta ALDRIG på steg");
      expect(prompt).toContain("s1, s2, s3");
      expect(prompt).toContain("GRENAR");
      expect(prompt).toContain("Skriv all text på svenska");
      // Metoden är verktygets egen – inga externa produktnamn eller källor.
      expect(prompt).not.toMatch(new RegExp(["2", "c", "8|handbok"].join(""), "i"));
    }
  });
});

describe("bridgeInstruction", () => {
  it("REGRESSION: bryggan får affärsprocessens regler – .ark/request.json är allt som syns", () => {
    const instr = bridgeInstruction("affarsprocess");
    expect(instr).toContain('verktyget "Affärsprocess"');
    expect(instr).toContain(AP_SYSTEM_PROMPT);
  });

  it("flödesschemat lägger ingen instruktion på – det är standardvägen", () => {
    expect(bridgeInstruction("flowchart")).toBe("");
    expect(bridgeInstruction()).toBe("");
  });
});
