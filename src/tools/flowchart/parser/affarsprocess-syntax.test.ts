/**
 * Tester för affärsprocessens hakparentessyntax i beskrivningstexten.
 *
 * Kontrakt: annoteringarna lyfts ut FÖRE klassificeringen (typ- och banval
 * påverkas aldrig), stegtexten rensas, sourceText behåller originalet och
 * ap-blocket fylls korrekt – inklusive HUKI-bokstäver och kommaseparerade
 * listor.
 */

import { describe, expect, it } from "vitest";
import { extraheraAp } from "./affarsprocess-syntax";
import { textToDraft } from "./toDraft";

describe("extraheraAp", () => {
  it("lyfter ut alla annoteringssorter och rensar texten", () => {
    const { ren, ap } = extraheraAp(
      "Genomför urval [Roll: Rekryterande chef H, HR K] [IT: Rekryteringssystem] [Krav: Öka mångfald] [Tid: Inom 5 dagar] [In: Ansökningar] [Ut: Slutkandidat utsedd]",
    );
    expect(ren).toBe("Genomför urval");
    expect(ap?.roller).toEqual([
      { namn: "Rekryterande chef", huki: "H" },
      { namn: "HR", huki: "K" },
    ]);
    expect(ap?.applikationer).toEqual(["Rekryteringssystem"]);
    expect(ap?.krav).toEqual(["Öka mångfald"]);
    expect(ap?.tid).toBe("Inom 5 dagar");
    expect(ap?.input).toBe("Ansökningar");
    expect(ap?.output).toBe("Slutkandidat utsedd");
  });

  it("roll utan HUKI-bokstav får ingen bokstav (default sätts vid kompilering)", () => {
    const { ap } = extraheraAp("Fatta beslut [Roll: Chef]");
    expect(ap?.roller).toEqual([{ namn: "Chef" }]);
  });

  it("text utan annoteringar lämnas orörd, utan ap-block", () => {
    const { ren, ap } = extraheraAp("Registrera ärende");
    expect(ren).toBe("Registrera ärende");
    expect(ap).toBeUndefined();
  });
});

describe("textToDraft med satellitannoteringar", () => {
  it("annoteringarna hamnar i stegets ap-block och stegtexten är ren", () => {
    const draft = textToDraft(
      "Rekrytering\nBehov uppstår → Genomför urval [Roll: HR U] [IT: Rekryteringssystem] → Fatta beslut",
    );
    const steg = draft.steps.find((s) => s.text.includes("urval"))!;
    expect(steg.text).not.toContain("[");
    expect(steg.ap?.roller).toEqual([{ namn: "HR", huki: "U" }]);
    expect(steg.ap?.applikationer).toEqual(["Rekryteringssystem"]);
    // Spårbarheten visar ORIGINALET med annoteringarna.
    expect(steg.sourceText).toContain("[Roll: HR U]");
  });

  it("annoteringar ändrar aldrig typ- eller banklassningen", () => {
    const utan = textToDraft("Test\nStart → Mejl skickas till användaren → Klart");
    const med = textToDraft(
      "Test\nStart → Mejl skickas till användaren [Roll: Systemet] → Klart",
    );
    const stegUtan = utan.steps.find((s) => s.type === "notification")!;
    const stegMed = med.steps.find((s) => s.type === "notification")!;
    expect(stegMed.type).toBe(stegUtan.type);
    expect(stegMed.laneId).toBe(stegUtan.laneId);
    expect(stegMed.recipient).toBe(stegUtan.recipient);
  });
});

describe("[Forum] – steget är ett forum i kedjan", () => {
  /**
   * REGRESSION: forum fanns bara som SATELLIT ([Forum: X]), och AI:n hängde
   * "Ledningsgruppen" som en extra bubbla bredvid fyra steg i rad.
   * Metoden säger något annat: ett forum "kan användas istället för en
   * aktivitet om det är viktigt att aktiviteten alltid ska genomföras i
   * mötesform" (beslut 2026-10-13).
   */
  it("REGRESSION: [Forum] utan kolon gör steget till ett forum, med kolon är det en satellit", () => {
    const steg = extraheraAp("Fatta beslut [Forum] [Roll: Avdelningschef U]");
    expect(steg.ren).toBe("Fatta beslut");
    expect(steg.ap?.iMötesform).toBe(true);
    expect(steg.ap?.forum).toBeUndefined();
    expect(steg.ap?.roller).toEqual([{ namn: "Avdelningschef", huki: "U" }]);

    const satellit = extraheraAp("Fatta beslut [Forum: Ledningsgruppen]");
    expect(satellit.ap?.forum).toBe("Ledningsgruppen");
    expect(satellit.ap?.iMötesform).toBeUndefined();
  });

  it("regelmotorn läser [Forum] ur beskrivningen", () => {
    const d = textToDraft("Möte\nAgenda klar → Fatta beslut [Forum] → Beslut fattat");
    const steg = d.steps.find((s) => s.text === "Fatta beslut")!;
    expect(steg.ap?.iMötesform).toBe(true);
  });
});
