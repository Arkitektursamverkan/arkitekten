/**
 * Tolkningen av AI-svaret måste tåla verkligheten: fences, inledande prat,
 * saknade fält, fel typer. Ett trasigt svar får aldrig ta ned appen – men det
 * får inte heller tyst bli en tom utvärdering som ser ut som ett rent flöde.
 */

import { describe, expect, it } from "vitest";
import { parseToModel } from "../parser/parse";
import { tolkaUtvärdering, underlag } from "./review";

const SVAR = {
  sammanfattning: "Flödet håller ihop men saknar felväg.",
  synpunkter: [
    { allvar: "notering", rubrik: "Blandade namn", motivering: "Vissa steg är verb, andra substantiv.", stegIds: ["s2"] },
    { allvar: "fel", rubrik: "Beslut saknar Nej-väg", motivering: "s3 har bara ett utfall.", stegIds: ["s3"] },
    { allvar: "förslag", rubrik: "Slå ihop s4 och s5", motivering: "De sker alltid tillsammans.", stegIds: ["s4", "s5"] },
  ],
};

describe("tolkaUtvärdering", () => {
  it("läser ett rent JSON-svar", () => {
    const u = tolkaUtvärdering(JSON.stringify(SVAR));
    expect(u.synpunkter).toHaveLength(3);
    expect(u.sammanfattning).toContain("felväg");
  });

  it("fel först, sedan förslag, sist noteringar", () => {
    // Det är den ordning man vill läsa dem i, oavsett hur modellen svarade.
    const u = tolkaUtvärdering(JSON.stringify(SVAR));
    expect(u.synpunkter.map((s) => s.allvar)).toEqual(["fel", "förslag", "notering"]);
  });

  it("klarar ```json-fence", () => {
    const u = tolkaUtvärdering("Här är min granskning:\n```json\n" + JSON.stringify(SVAR) + "\n```");
    expect(u.synpunkter).toHaveLength(3);
  });

  it("klarar prat före och efter objektet", () => {
    const u = tolkaUtvärdering("Visst! " + JSON.stringify(SVAR) + " Hoppas det hjälper.");
    expect(u.synpunkter).toHaveLength(3);
  });

  it("okänt allvar blir förslag i stället för att kastas bort", () => {
    const u = tolkaUtvärdering('{"synpunkter":[{"allvar":"kritiskt","rubrik":"X","motivering":"Y"}]}');
    expect(u.synpunkter[0].allvar).toBe("förslag");
  });

  it("en synpunkt utan rubrik slängs – den säger ingenting", () => {
    const u = tolkaUtvärdering('{"synpunkter":[{"allvar":"fel","motivering":"Y"},{"rubrik":"Z"}]}');
    expect(u.synpunkter.map((s) => s.rubrik)).toEqual(["Z"]);
  });

  it("stegIds som inte är strängar filtreras bort", () => {
    const u = tolkaUtvärdering('{"synpunkter":[{"rubrik":"X","stegIds":["s1",3,null,"s2"]}]}');
    expect(u.synpunkter[0].stegIds).toEqual(["s1", "s2"]);
  });

  it("tom lista är ett giltigt svar – inte ett fel", () => {
    const u = tolkaUtvärdering('{"sammanfattning":"Inget att anmärka.","synpunkter":[]}');
    expect(u.synpunkter).toEqual([]);
    expect(u.sammanfattning).toBe("Inget att anmärka.");
  });

  for (const [namn, svar] of [
    ["tom sträng", ""],
    ["bara text", "Jag kunde tyvärr inte granska flödet."],
    ["trasig JSON", "{ synpunkter: [ }"],
  ] as const) {
    it(`${namn} ger ett begripligt fel, inte en tyst tom utvärdering`, () => {
      expect(() => tolkaUtvärdering(svar)).toThrow();
    });
  }
});

describe("underlag", () => {
  const model = parseToModel(`Test
A startar → B i portalen → Power Automate flödet triggas → Mejl skickas till handläggaren`);

  it("innehåller det som behövs för att bedöma processen", () => {
    const u = underlag(model);
    expect(u.titel).toBe("Test");
    expect(u.steg.length).toBe(model.nodes.length);
    expect(u.kopplingar.length).toBe(model.edges.length);
    expect(u.banor.length).toBeGreaterThan(0);
  });

  it("innehåller INTE utseende", () => {
    // En utvärdering ska handla om processen, inte om layouten.
    const json = JSON.stringify(underlag(model));
    expect(json).not.toContain("position");
    expect(json).not.toContain("height");
  });
});
