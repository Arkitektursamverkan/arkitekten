/**
 * Serverns API-svar på brevlådans begäranden – med en låtsasmodell.
 *
 * Svaren ska ha EXAKT den form Claude Code skriver för hand (CLAUDE.md), för
 * appen tar emot dem med samma kod. Och presentationen ska få samma kontroll
 * som scripts/presentation.mts ger Claude Code – annars pekar ramarna på id:n
 * som inte finns i bilden.
 */

import { describe, expect, it } from "vitest";

import { byggPresentation } from "@/tools/ramar/ai-presentation";

import { besvara, läsZip, TEXT_TAK, underlagSomBlock, ZIP_TAK, type Fråga, type Meddelande } from "./besvara";
import { packaZip } from "@/core/zip";
import { AP_SYSTEM_PROMPT, flödesschemaPrompt } from "./prompt";
import { DRAFT_JSON_SCHEMA } from "./schema";

type Anrop = Parameters<Fråga>[0];

/** En modell som svarar ur en lista och sparar varje anrop – samtalet kopieras, det växer efteråt. */
function låtsasmodell(svar: unknown[]) {
  const anrop: Anrop[] = [];
  const fråga: Fråga = async (p) => {
    anrop.push({ ...p, meddelanden: [...p.meddelanden] });
    const s = svar[anrop.length - 1];
    const text = typeof s === "string" ? s : JSON.stringify(s);
    return { text, innehåll: [{ type: "text", text }] };
  };
  return { fråga, anrop };
}

const sista = (m: Meddelande[]) => {
  const c = m[m.length - 1].content;
  return typeof c === "string" ? c : JSON.stringify(c);
};

const TOLKNING = {
  aiText: "P\nA → B",
  title: "P",
  subtitle: null,
  lanes: [{ id: "l", title: "L" }],
  steps: [{ id: "a", type: "activity", text: "A", laneId: "l" }],
};

describe("besvara – tolkning och utvärdering", () => {
  it("en affärsprocesstolkning får metoden som systemprompt, schemat och användarens önskemål", async () => {
    const { fråga, anrop } = låtsasmodell([TOLKNING]);
    const svar = await besvara(
      { uppdrag: "tolkning", rawText: "A sen B", diagramType: "affarsprocess", önskemål: "Slå ihop stegen" },
      { fråga },
    );
    expect(svar).toEqual(TOLKNING);
    expect(anrop[0].system).toBe(AP_SYSTEM_PROMPT);
    expect(anrop[0].schema).toBe(DRAFT_JSON_SCHEMA);
    expect(sista(anrop[0].meddelanden)).toContain("A sen B");
    expect(sista(anrop[0].meddelanden)).toContain("Slå ihop stegen");
  });

  it("utan diagramtyp är det flödesschemats husstil", async () => {
    const { fråga, anrop } = låtsasmodell([TOLKNING]);
    await besvara({ rawText: "A sen B" }, { fråga });
    expect(anrop[0].system).toBe(flödesschemaPrompt());
  });

  it("en tolkning utan steg är ett fel, inte ett tomt diagram", async () => {
    const { fråga } = låtsasmodell([{ ...TOLKNING, steps: [] }]);
    await expect(besvara({ rawText: "x" }, { fråga })).rejects.toThrow(/inga steg/);
  });

  it("utvärderingen får sin instruktion som system och svarar med aiText", async () => {
    const { fråga, anrop } = låtsasmodell(["Allt ser bra ut."]);
    const svar = await besvara({ uppdrag: "utvärdering", rawText: "{}", instruction: "Granska" }, { fråga });
    expect(svar).toEqual({ aiText: "Allt ser bra ut." });
    expect(anrop[0].system).toBe("Granska");
    expect(anrop[0].schema).toBeUndefined();
  });
});

const FÖRENKLAD = {
  aiText: "Utlåning\nPublicerar utrustning → Visar utrustning → Skriver avtal",
  title: "Utlåning",
  subtitle: null,
  lanes: [{ id: "Utlåning", title: "Utlåning" }],
  steps: [
    { id: "publicera", type: "activity", text: "Publicerar utrustning [Roll: Lånehandläggare U]", laneId: "Utlåning" },
    { id: "visa", type: "activity", text: "Visar utrustning [Roll: Förvaltare U]", laneId: "Utlåning" },
    { id: "avtal", type: "activity", text: "Skriver avtal [Roll: Lånehandläggare U]", laneId: "Utlåning" },
  ],
};
const SCEN = { bakgrund: { typ: "stad" }, figurer: [{ id: "kontor", typ: "huvudkontor", namn: "Kundcenter", x: 1200, y: 545 }] };
const ram = (...id: string[]) => ({
  rubrik: `Steg ${id.join(", ")}`,
  markeringar: id.map((i) => ({ mål: { typ: "nod", id: i }, verktyg: "puls", färg: "#f59f00" })),
});
const PRESENTATIONSBEGÄRAN = {
  uppdrag: "presentation",
  rawText: JSON.stringify({ namn: "Utlåning", beskrivning: "Utlåning\nA → B" }),
  diagramType: "affarsprocess",
  källa: { flödeId: "ap-utlaning", namn: "Utlåning" },
};

describe("besvara – presentation", () => {
  it("modellen får bildens id:n ur kontrollen, och ramar som pekar fel skickas tillbaka för rättelse", async () => {
    const fel = { scen: SCEN, ramar: [ram("publicera", "finnsinte"), ram("visa"), ram("avtal")] };
    const rätt = { scen: SCEN, ramar: [ram("publicera"), ram("visa"), ram("avtal")] };
    const { fråga, anrop } = låtsasmodell([{ förenklad: FÖRENKLAD }, { presentation: fel }, { presentation: rätt }]);

    const svar = await besvara(PRESENTATIONSBEGÄRAN, { fråga });

    // Steg 2 bär kontrollskriptets utskrift – samma id:n som ramarna får peka på.
    expect(sista(anrop[1].meddelanden)).toContain("publicera");
    expect(sista(anrop[1].meddelanden)).toContain("publicera->visa");
    // Steg 3 är rättelsen, med kontrollens anmärkning.
    expect(sista(anrop[2].meddelanden)).toContain("finnsinte");
    // Svaret har Claude Codes form och går rent genom appens egen kontroll.
    expect(svar).toEqual({ förenklad: FÖRENKLAD, presentation: rätt });
    const källa = { ...PRESENTATIONSBEGÄRAN.källa, beskrivning: "Utlåning\nA → B" };
    expect(byggPresentation(svar, källa).anmärkningar).toEqual([]);
  });

  it("samtalet växer bara – modellens svar läggs tillbaka orört före nästa fråga", async () => {
    const rätt = { scen: SCEN, ramar: [ram("publicera"), ram("visa"), ram("avtal")] };
    const { fråga, anrop } = låtsasmodell([{ förenklad: FÖRENKLAD }, { presentation: rätt }]);
    await besvara(PRESENTATIONSBEGÄRAN, { fråga });
    expect(anrop).toHaveLength(2);
    expect(anrop[1].meddelanden.slice(0, 1)).toEqual(anrop[0].meddelanden);
    expect(anrop[1].meddelanden[1].role).toBe("assistant");
  });

  it("en process kontrollen inte kan bygga skickas tillbaka, och ger upp efter rättelserna", async () => {
    const { fråga, anrop } = låtsasmodell([{ förenklad: {} }, { förenklad: {} }, { förenklad: {} }]);
    await expect(besvara(PRESENTATIONSBEGÄRAN, { fråga })).rejects.toThrow(/förenklad/);
    expect(anrop).toHaveLength(3);
  });
});

/** Ett zip-arkiv utan komprimering, med en fil – nog för att prova läsaren. */
function zip(namn: string, innehåll: string): Uint8Array {
  const n = new TextEncoder().encode(namn);
  const d = new TextEncoder().encode(innehåll);
  const lokal = new Uint8Array(30 + n.length + d.length);
  const lv = new DataView(lokal.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint32(18, d.length, true);
  lv.setUint32(22, d.length, true);
  lv.setUint16(26, n.length, true);
  lokal.set(n, 30);
  lokal.set(d, 30 + n.length);
  const kat = new Uint8Array(46 + n.length);
  const kv = new DataView(kat.buffer);
  kv.setUint32(0, 0x02014b50, true);
  kv.setUint32(20, d.length, true);
  kv.setUint32(24, d.length, true);
  kv.setUint16(28, n.length, true);
  kv.setUint32(42, 0, true);
  kat.set(n, 46);
  const slut = new Uint8Array(22);
  const sv = new DataView(slut.buffer);
  sv.setUint32(0, 0x06054b50, true);
  sv.setUint16(8, 1, true);
  sv.setUint16(10, 1, true);
  sv.setUint32(12, kat.length, true);
  sv.setUint32(16, lokal.length, true);
  const alla = new Uint8Array(lokal.length + kat.length + slut.length);
  alla.set(lokal, 0);
  alla.set(kat, lokal.length);
  alla.set(slut, lokal.length + kat.length);
  return alla;
}

describe("besvara – rutin", () => {
  const DOCX = zip(
    "word/document.xml",
    "<w:document><w:body><w:p><w:r><w:t>Gå till Lösningar</w:t></w:r></w:p><w:p><w:r><w:t>Klicka &amp; välj</w:t></w:r></w:p></w:body></w:document>",
  );

  it("ett Word-dokument läses som text, ett stycke per rad", async () => {
    expect(await läsZip(DOCX, "word/document.xml")).toContain("Gå till Lösningar");
    const block = await underlagSomBlock("rutin.docx", DOCX);
    expect(block).toMatchObject({ type: "document", source: { type: "text", data: "Gå till Lösningar\nKlicka & välj" } });
  });

  it("PDF och bild skickas som de är", async () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(await underlagSomBlock("a.PDF", data)).toMatchObject({ type: "document", source: { media_type: "application/pdf", data: "AQID" } });
    expect(await underlagSomBlock("a.jpg", data)).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
  });

  it("ett format som inte går att läsa ger ett begripligt fel", async () => {
    await expect(underlagSomBlock("gammal.doc", new Uint8Array([0]))).rejects.toThrow(/\.doc kan inte läsas/);
  });

  it("underlaget bifogas i anropet och svaret har formen { rutin }", async () => {
    const { fråga, anrop } = låtsasmodell([{ rutin: "Gå till Lösningar\n  Obs: kräver behörighet" }]);
    const lästa: string[] = [];
    const svar = await besvara(
      {
        uppdrag: "rutin",
        rawText: JSON.stringify({ fil: ".ark/underlag/x-rutin.docx", filnamn: "rutin.docx", krav: "Rutin för loggutdrag" }),
      },
      { fråga, läsUnderlag: async (s) => (lästa.push(s), DOCX) },
    );
    expect(lästa).toEqual([".ark/underlag/x-rutin.docx"]);
    expect(svar).toEqual({ rutin: "Gå till Lösningar\n  Obs: kräver behörighet" });
    expect(JSON.stringify(anrop[0].meddelanden)).toContain("Rutin för loggutdrag");
    expect(JSON.stringify(anrop[0].meddelanden)).toContain("Gå till Lösningar");
  });
});

describe("besvara – taken för underlag", () => {
  const STORT = new Uint8Array(ZIP_TAK + 1024 * 1024).fill(0x61);

  it("REGRESSION: en zip-bomb packades upp hel i minnet – nu stoppas den på katalogens storlek", async () => {
    const bomb = await packaZip({ "word/document.xml": STORT }, new Date(), { komprimera: true });
    expect(bomb.length).toBeLessThan(200_000);
    await expect(läsZip(bomb, "word/document.xml")).rejects.toThrow(/för stort/);
  });

  it("REGRESSION: en katalog som ljuger om storleken stoppas medan strömmen läses", async () => {
    const bomb = await packaZip({ "word/document.xml": STORT }, new Date(), { komprimera: true });
    const v = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    for (let i = 0; i < bomb.length - 4; i++) if (v.getUint32(i, true) === 0x02014b50) v.setUint32(i + 24, 100, true);
    await expect(läsZip(bomb, "word/document.xml")).rejects.toThrow(/för stort/);
  });

  it("text över taket skickas inte till modellen", async () => {
    const lång = new TextEncoder().encode("a".repeat(TEXT_TAK + 1));
    await expect(underlagSomBlock("lång.txt", lång)).rejects.toThrow(/för långt/);
  });
});
