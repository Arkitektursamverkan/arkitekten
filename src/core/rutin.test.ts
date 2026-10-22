import { describe, expect, it } from "vitest";
import { rutinSort, rutinStig, skrivRutin, tolkaRutin, underpunktSort, ärUpplysning } from "./rutin";

describe("tolkaRutin", () => {
  it("gör varje icke-tom rad till ett moment", () => {
    expect(tolkaRutin("Öppna webbläsaren som admin\n\nLogga in i Microsoft Purview\n   \n")).toEqual([
      { text: "Öppna webbläsaren som admin", under: [] },
      { text: "Logga in i Microsoft Purview", under: [] },
    ]);
  });

  it("lägger indragna rader och punktrader under momentet före", () => {
    const m = tolkaRutin("Ange Villkorsbyggare, t.ex.:\n  Nyckelord\n\tDatum\n- Ämne/rubrik\n• Deltagare\nKlicka på Kör fråga");
    expect(m).toEqual([
      { text: "Ange Villkorsbyggare, t.ex.:", under: ["Nyckelord", "Datum", "Ämne/rubrik", "Deltagare"] },
      { text: "Klicka på Kör fråga", under: [] },
    ]);
  });

  it("skalar bort en inklistrad numrering men rör inte siffror i texten", () => {
    expect(tolkaRutin("1. Öppna Excel\n2) Klicka Export → Items.1.001. → Ladda ner").map((x) => x.text)).toEqual([
      "Öppna Excel",
      "Klicka Export → Items.1.001. → Ladda ner",
    ]);
  });

  it("låter en indragen första rad bli ett moment i stället för att försvinna", () => {
    expect(tolkaRutin("   Öppna webbläsaren")).toEqual([{ text: "Öppna webbläsaren", under: [] }]);
  });
});

describe("bildstödet härleds ur texten", () => {
  it("delar en klickväg vid pilarna, och lämnar vanlig text hel", () => {
    expect(rutinStig("Gå till Lösningar → eDiscovery →Ärenden -> Content Search.")).toEqual([
      "Gå till Lösningar",
      "eDiscovery",
      "Ärenden",
      "Content Search.",
    ]);
    expect(rutinStig("Öppna excel")).toEqual(["Öppna excel"]);
  });

  it("väljer symbol efter vad momentet ber en göra", () => {
    expect(rutinSort("Logga in i Microsoft Purview med ditt adminkonto")).toBe("logga-in");
    expect(rutinSort("Öppna webbläsaren som admin")).toBe("öppna");
    expect(rutinSort("Ange Villkorsbyggare tex:")).toBe("skriv");
    expect(rutinSort("Klicka på kör fråga → Välj Sökresultat Statistik")).toBe("klicka");
    expect(rutinSort("Exempel")).toBe("steg");
  });

  it("låter det smala mönstret vinna över det breda", () => {
    // "Klicka på Exportera" är en nedladdning, inte vilket klick som helst …
    expect(rutinSort("För att ladda ner kopia på filer Klicka på Exportera")).toBe("ladda-ner");
    // … men en väg som råkar passera "Hämta data" är fortfarande en väg.
    expect(rutinSort("Gå till Data → Hämta data → Från fil")).toBe("navigera");
  });

  it("visar korta alternativ som val, och allt annat som en lista", () => {
    expect(underpunktSort(["Nyckelord", "Datum", "Ämne/rubrik", "Deltagare"])).toBe("val");
    expect(underpunktSort(["Klicka på Kör fråga", "Markera en rad i listan för att förhandsvisa innehållet"])).toBe("steg");
    expect(underpunktSort(["Data → Hämta data"])).toBe("steg");
  });

  it("känner igen en upplysning – ett villkor eller en förklaring", () => {
    expect(ärUpplysning("Om du vill söka i hela organisationen väljer du → Lägg till källor")).toBe(true);
    expect(ärUpplysning("Statistik - Visar en sammanställning av din fråga.")).toBe(true);
    expect(ärUpplysning("Klicka på exportera")).toBe(false);
  });
});

describe("skrivRutin", () => {
  it("är tolkningens motsats – en byggd rutin lagras som en inklistrad", () => {
    const text = "Ange villkor:\n  Nyckelord\n  Datum\nKlicka på Kör fråga";
    expect(skrivRutin(tolkaRutin(text))).toBe(text);
  });

  it("skriver inte tomma rader, och tappar inte underpunkter under ett tomt moment", () => {
    expect(
      skrivRutin([
        { text: "Öppna Excel", under: ["", "  Välj fil "] },
        { text: " ", under: ["Kvar"] },
        { text: "", under: [] },
      ]),
    ).toBe("Öppna Excel\n  Välj fil\nKvar");
  });
});
