/**
 * Bildflikens modell: scenen hör till serien, händelserna till ramen, och en
 * borttagen figur lämnar inga spöken efter sig i ramarna.
 */

import { describe, expect, it } from "vitest";
import { duplicera, läggTillRam, nyRam, nySerie, ändraRam, type Ramserie } from "./ram";
import {
  läggTillFigur,
  nyFigur,
  ramScen,
  serieScen,
  standardScen,
  suddaFigur,
  sättBubbla,
  synsFrånRam,
  taBortFigur,
  växlaDold,
  växlaFigurMarkering,
  växlaPuls,
  ändraRamScen,
  läggTillTextruta,
  nyTextruta,
  taBortTextruta,
  ändraTextruta,
  TOM_RAMSCEN,
  nyPulspunkt,
  läggTillPulspunkt,
  ändraPulspunkt,
  taBortPulspunkt,
  döljIRam,
  iAllaRamar,
  läggTillFigurIRam,
  fortsättBild,
  flyttaObjekt,
  figurerIRam,
  scenensPlats,
  ändraScen,
} from "./ram-scen";

function serieMedTreRamar(): Ramserie {
  let s = nySerie("S", "f");
  s = läggTillRam(s, nyRam("2"));
  return läggTillRam(s, nyRam("3"));
}

describe("scenen", () => {
  it("en serie sparad före bildfliken får standardscenen – med FASTA id:n (invariant 2)", () => {
    const s = nySerie("S", "f");
    expect(s.scen).toBeUndefined();
    const ids = serieScen(s).figurer.map((f) => f.id);
    expect(ids).toEqual(["bostad", "hyresgast", "huvudkontor"]);
    expect(serieScen(s)).toEqual(standardScen());
  });

  it("ändringar i scenen sprider – ramarna och okända fält står kvar (invariant 4)", () => {
    const s = { ...nySerie("S", "f"), framtida: true } as Ramserie & { framtida: boolean };
    const f = nyFigur("hantverkare", "Hantverkare", 10, 20);
    const s2 = ändraScen(s, (sc) => läggTillFigur(sc, f)) as typeof s;
    expect(s2.framtida).toBe(true);
    expect(s2.ramar).toBe(s.ramar);
    expect(serieScen(s2).figurer[serieScen(s2).figurer.length - 1].id).toBe(f.id);
  });

  it("en borttagen figur tas bort ur ALLA ramar – markering, pulser, bubblor, dolda", () => {
    let s = serieMedTreRamar();
    for (const r of s.ramar) {
      s = ändraRam(s, r.id, (x) =>
        ändraRamScen(x, (rs) =>
          växlaDold(
            sättBubbla(växlaPuls(växlaFigurMarkering(rs, { figur: "hyresgast", verktyg: "farg", färg: "#000" }), "hyresgast", "huvudkontor", "#f00"), "hyresgast", "Hej"),
            "hyresgast",
          ),
        ),
      );
    }
    const utan = taBortFigur(s, "hyresgast");
    expect(serieScen(utan).figurer.map((f) => f.id)).not.toContain("hyresgast");
    for (const r of utan.ramar) {
      expect(ramScen(r)).toEqual({ markeringar: [], pulser: [], bubblor: [], dolda: [], textrutor: [], pulspunkter: [], figurLägen: {} });
    }
  });
});

describe("det som händer i ramen", () => {
  it("en puls växlar och kan inte gå från en figur till sig själv", () => {
    let rs = ramScen(nyRam("R"));
    rs = växlaPuls(rs, "a", "b", "#f00");
    expect(rs.pulser).toHaveLength(1);
    expect(växlaPuls(rs, "a", "a", "#f00")).toBe(rs);
    // Åt andra hållet är en ANNAN puls.
    expect(växlaPuls(rs, "b", "a", "#f00").pulser).toHaveLength(2);
    expect(växlaPuls(rs, "a", "b", "#f00").pulser).toHaveLength(0);
  });

  it("tom bubbeltext tar bort bubblan; suddet tar markering och bubbla men inte pulsen", () => {
    let rs = sättBubbla(ramScen(nyRam("R")), "a", "Hej");
    expect(sättBubbla(rs, "a", "  ").bubblor).toHaveLength(0);
    rs = växlaPuls(växlaFigurMarkering(rs, { figur: "a", verktyg: "blink", färg: "#000" }), "a", "b", "#f00");
    const sudd = suddaFigur(rs, "a");
    expect(sudd.markeringar).toHaveLength(0);
    expect(sudd.bubblor).toHaveLength(0);
    expect(sudd.pulser).toHaveLength(1);
  });

  it("tona in: dold i ramarna före, synlig från och med den valda", () => {
    let s = serieMedTreRamar();
    // Dold i sista ramen från början – ska bli synlig.
    s = ändraRam(s, s.ramar[2].id, (r) => ändraRamScen(r, (rs) => växlaDold(rs, "x")));
    const t = synsFrånRam(s, "x", 1);
    expect(t.ramar.map((r) => ramScen(r).dolda.includes("x"))).toEqual([true, false, false]);
  });

  it("en kopierad ram tar med bilden, men ändras den påverkas inte originalet", () => {
    const r = ändraRamScen(nyRam("R"), (rs) => sättBubbla(rs, "a", "Hej"));
    const k = duplicera(r);
    const k2 = ändraRamScen(k, (rs) => sättBubbla(rs, "a", "Då"));
    expect(ramScen(r).bubblor[0].text).toBe("Hej");
    expect(ramScen(k2).bubblor[0].text).toBe("Då");
  });
});

describe("textrutor (bildtexter)", () => {
  it("en ram sparad före textrutorna läses med en tom lista – ingen migrering", () => {
    const gammal = { id: "r", rubrik: "R", markeringar: [], scen: { markeringar: [], pulser: [], bubblor: [], dolda: [] } };
    expect(ramScen(gammal as never).textrutor).toEqual([]);
    expect(TOM_RAMSCEN.textrutor).toEqual([]);
  });

  it("läggs till, ändras och tas bort – och hör till RAMEN, inte scenen", () => {
    let s = serieMedTreRamar();
    const t = nyTextruta(100.4, 200.6);
    expect(t).toMatchObject({ x: 100, y: 201, text: "" });
    const [r1, r2] = s.ramar;
    s = ändraRam(s, r1.id, (r) => ändraRamScen(r, (rs) => läggTillTextruta(rs, t)));
    s = ändraRam(s, r1.id, (r) => ändraRamScen(r, (rs) => ändraTextruta(rs, t.id, (x) => ({ ...x, rubrik: "Dag 1", text: "Hej" }))));
    expect(ramScen(s.ramar[0]).textrutor).toEqual([{ ...t, rubrik: "Dag 1", text: "Hej" }]);
    expect(ramScen(s.ramar.find((r) => r.id === r2.id)!).textrutor).toEqual([]);
    s = ändraRam(s, r1.id, (r) => ändraRamScen(r, (rs) => taBortTextruta(rs, t.id)));
    expect(ramScen(s.ramar[0]).textrutor).toEqual([]);
  });
});

describe("pulspunkter", () => {
  it("läggs till med vald färg, flyttas och tas bort – i ramen, inte i scenen", () => {
    let rs = ramScen(nyRam("R"));
    expect(rs.pulspunkter).toEqual([]);
    const pt = nyPulspunkt(330.4, 540.6, "#e8590c");
    expect(pt).toMatchObject({ x: 330, y: 541, färg: "#e8590c" });
    rs = läggTillPulspunkt(rs, pt);
    rs = ändraPulspunkt(rs, pt.id, (p) => ({ ...p, x: 340, storlek: 0.6 }));
    expect(rs.pulspunkter).toEqual([{ ...pt, x: 340, storlek: 0.6 }]);
    expect(taBortPulspunkt(rs, pt.id).pulspunkter).toEqual([]);
  });
});

describe("ta bort från den här ramen eller från alla", () => {
  it("döljIRam döljer bara i ramen, och är idempotent", () => {
    const rs = döljIRam(döljIRam(ramScen(nyRam("R")), "hyresgast"), "hyresgast");
    expect(rs.dolda).toEqual(["hyresgast"]);
  });

  it("iAllaRamar tar bort en kopierad textruta ur varje ram den finns i", () => {
    let s = serieMedTreRamar();
    const t = nyTextruta(10, 10);
    s = { ...s, ramar: s.ramar.map((r) => ändraRamScen(r, (rs) => läggTillTextruta(rs, t))) };
    s = iAllaRamar(s, (rs) => taBortTextruta(rs, t.id));
    for (const r of s.ramar) expect(ramScen(r).textrutor).toEqual([]);
  });
});

describe("en figur hör till ramen den läggs till i", () => {
  it("REGRESSION: en figur som lades till i ram 2 syntes i alla ramar – nu är den dold i de andra", () => {
    let s = serieMedTreRamar();
    const [r1, r2, r3] = s.ramar;
    const f = nyFigur("hantverkare", "Hantverkare", 100, 100);
    s = läggTillFigurIRam(s, f, r2.id);
    expect(serieScen(s).figurer.map((x) => x.id)).toContain(f.id);
    const dold = (id: string) => ramScen(s.ramar.find((r) => r.id === id)!).dolda.includes(f.id);
    expect([dold(r1.id), dold(r2.id), dold(r3.id)]).toEqual([true, false, true]);
  });

  it("en ny tom ram fortsätter bilden från ramen före – men utan det som hände i den", () => {
    const före = ändraRamScen(nyRam("1"), (rs) =>
      läggTillTextruta(döljIRam(rs, "hyresgast"), nyTextruta(1, 1)),
    );
    const ny = fortsättBild(nyRam("2"), före);
    expect(ramScen(ny).dolda).toEqual(["hyresgast"]);
    expect(ramScen(ny).textrutor).toEqual([]);
    // Utan något dolt blir den ny ram som förut.
    expect(fortsättBild(nyRam("3"), nyRam("x")).scen).toBeUndefined();
  });
});

describe("flytta i den här ramen eller i alla", () => {
  const plats = (s: Ramserie, ramIndex: number, id: string) => {
    const f = figurerIRam(serieScen(s), ramScen(s.ramar[ramIndex])).find((x) => x.id === id)!;
    return { x: f.x, y: f.y };
  };

  it("REGRESSION: standard flyttar figuren BARA i ramen man står i – förut flyttade den i alla", () => {
    let s = serieMedTreRamar();
    const start = plats(s, 0, "hyresgast");
    s = flyttaObjekt(s, s.ramar[1].id, { typ: "figur", id: "hyresgast" }, 100, -20, false);
    expect(plats(s, 1, "hyresgast")).toEqual({ x: start.x + 100, y: start.y - 20 });
    expect(plats(s, 0, "hyresgast")).toEqual(start);
    expect(plats(s, 2, "hyresgast")).toEqual(start);
    // Tillbaka till scenens plats i ramen.
    const r1 = scenensPlats(ramScen(s.ramar[1]), "hyresgast");
    expect(r1.figurLägen).toEqual({});
  });

  it("'alla ramar' flyttar lika mycket överallt – en rörelse mellan ramarna följer med", () => {
    let s = serieMedTreRamar();
    const start = plats(s, 0, "hyresgast");
    s = flyttaObjekt(s, s.ramar[2].id, { typ: "figur", id: "hyresgast" }, 300, 0, false); // går i ram 3
    s = flyttaObjekt(s, s.ramar[0].id, { typ: "figur", id: "hyresgast" }, 0, 50, true); // alla ner 50
    expect(plats(s, 0, "hyresgast")).toEqual({ x: start.x, y: start.y + 50 });
    expect(plats(s, 1, "hyresgast")).toEqual({ x: start.x, y: start.y + 50 });
    expect(plats(s, 2, "hyresgast")).toEqual({ x: start.x + 300, y: start.y + 50 });
  });

  it("en textruta kopierad till flera ramar flyttas i den här ramen – eller i alla", () => {
    let s = serieMedTreRamar();
    const t = nyTextruta(10, 10);
    s = { ...s, ramar: s.ramar.map((r) => ändraRamScen(r, (rs) => läggTillTextruta(rs, t))) };
    s = flyttaObjekt(s, s.ramar[0].id, { typ: "text", id: t.id }, 5, 5, false);
    expect(s.ramar.map((r) => ramScen(r).textrutor[0].x)).toEqual([15, 10, 10]);
    s = flyttaObjekt(s, s.ramar[0].id, { typ: "text", id: t.id }, 10, 0, true);
    expect(s.ramar.map((r) => ramScen(r).textrutor[0].x)).toEqual([25, 20, 20]);
  });

  it("en borttagen figur lämnar inga egna platser efter sig", () => {
    let s = serieMedTreRamar();
    s = flyttaObjekt(s, s.ramar[0].id, { typ: "figur", id: "hyresgast" }, 10, 10, false);
    s = taBortFigur(s, "hyresgast");
    expect(ramScen(s.ramar[0]).figurLägen).toEqual({});
  });
});
