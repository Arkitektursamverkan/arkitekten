import { describe, expect, it } from "vitest";
import { kanDöljaSkiss, kanLäsaSkiss, kanTaBortSkiss, kanÄndraSkiss, type Användare } from "./behorighet";
import {
  dupliceraISkiss,
  flyttaISkiss,
  läggTillKoppling,
  läggTillObjekt,
  läggTillZon,
  läsSkiss,
  medföljande,
  nySkiss,
  skissId,
  skissNyckel,
  taBortUrSkiss,
  ändraStorlek,
  ändraZon,
} from "./systemskiss";

const admin: Användare = { id: "a", namn: "Admin", roller: ["admin"] };
const anna: Användare = { id: "anna", namn: "Anna", roller: ["user"] };
const bo: Användare = { id: "bo", namn: "Bo", roller: ["user"] };

function tvåObjekt() {
  let { skiss, id: a } = läggTillObjekt(nySkiss("Miljö"), "server", 100, 100);
  const andra = läggTillObjekt(skiss, "databas", 400, 100);
  return { skiss: andra.skiss, a, b: andra.id };
}

describe("systemskissens hjälpare", () => {
  it("ger varje ny skiss ett eget id, också när namnet är detsamma", () => {
    const a = skissId("Utvecklingsmiljö");
    const b = skissId("Utvecklingsmiljö");
    expect(a).toMatch(/^utvecklingsmiljo-[a-z0-9]{6}$/);
    expect(a).not.toBe(b);
    expect(skissId("!!!")).toMatch(/^skiss-[a-z0-9]{6}$/);
  });

  it("id:n är slumpade, inte räknade – ett borttaget objekt förskjuter ingenting (invariant 2)", () => {
    const { skiss, a, b } = tvåObjekt();
    const kvar = taBortUrSkiss(skiss, [a]);
    expect(kvar.objekt.map((o) => o.id)).toEqual([b]);
    expect(läggTillObjekt(kvar, "server", 0, 0).id).not.toBe(a);
  });

  it("kopplar två objekt en gång per riktning, och aldrig ett objekt till sig självt", () => {
    const { skiss, a, b } = tvåObjekt();
    const första = läggTillKoppling(skiss, a, b);
    expect(första.skiss.kopplingar).toHaveLength(1);
    const igen = läggTillKoppling(första.skiss, a, b);
    expect(igen.skiss).toBe(första.skiss);
    expect(igen.id).toBe(första.id);
    expect(läggTillKoppling(första.skiss, b, a).skiss.kopplingar).toHaveLength(2);
    expect(läggTillKoppling(skiss, a, a).id).toBeNull();
    expect(läggTillKoppling(skiss, a, "finns-inte").id).toBeNull();
  });

  it("ett borttaget objekt tar sina kopplingar med sig", () => {
    const { skiss, a, b } = tvåObjekt();
    const kopplad = läggTillKoppling(skiss, a, b).skiss;
    expect(taBortUrSkiss(kopplad, [b]).kopplingar).toEqual([]);
  });

  it("en zon tar med sig det som står i den – objekt och mindre zoner – men inget utanför", () => {
    let { skiss, a, b } = tvåObjekt();
    const stor = läggTillZon(skiss, 100, 100); // 420 × 260 kring (100, 100)
    skiss = stor.skiss;
    const liten = läggTillZon(skiss, 100, 100);
    skiss = ändraStorlek(liten.skiss, liten.id, 200, 100);
    skiss = ändraZon(skiss, liten.id, { x: 20, y: 60 });
    const med = medföljande(skiss, [stor.id]);
    expect(med.has(a)).toBe(true);
    expect(med.has(liten.id)).toBe(true);
    expect(med.has(b)).toBe(false); // står vid x = 400, utanför zonen
    const flyttad = flyttaISkiss(skiss, med, 53, 0);
    expect(flyttad.objekt.find((o) => o.id === a)!.x).toBe(skiss.objekt.find((o) => o.id === a)!.x + 50);
    expect(flyttad.objekt.find((o) => o.id === b)!.x).toBe(skiss.objekt.find((o) => o.id === b)!.x);
  });

  it("duplicerar objekt med nya id:n och tar med kopplingarna mellan dem", () => {
    const { skiss, a, b } = tvåObjekt();
    const kopplad = läggTillKoppling(skiss, a, b).skiss;
    const { skiss: ut, nya } = dupliceraISkiss(kopplad, new Set([a, b]));
    expect(ut.objekt).toHaveLength(4);
    expect(ut.kopplingar).toHaveLength(2);
    expect(nya).toHaveLength(2);
    expect(new Set(ut.objekt.map((o) => o.id)).size).toBe(4);
    expect(nya).toContain(ut.kopplingar[1].från);
  });

  it("osparat avgörs av innehållet – inte av tidsstämpeln eller skaparen", () => {
    const s = nySkiss("A");
    expect(skissNyckel({ ...s, savedAt: "2030-01-01T00:00:00.000Z", skapadAv: { id: "x", namn: "X" } })).toBe(skissNyckel(s));
    expect(skissNyckel({ ...s, dold: true })).not.toBe(skissNyckel(s));
  });
});

describe("läsSkiss – det som kommer utifrån byggs om fält för fält", () => {
  it("läser tillbaka en skiss oförändrad", () => {
    const { skiss, a, b } = tvåObjekt();
    const full = { ...läggTillKoppling(läggTillZon(skiss, 0, 0).skiss, a, b).skiss, dold: true, beskrivning: "Test" };
    expect(läsSkiss(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });

  it("avvisar det som inte är en skiss", () => {
    expect(läsSkiss(null)).toBeNull();
    expect(läsSkiss({ id: "../etc", namn: "x" })).toBeNull();
    expect(läsSkiss({ id: "ok", namn: "   " })).toBeNull();
  });

  it("släpper aldrig igenom markup där ritaren väntar sig ett tal, en sort eller en färg", () => {
    const elak = '"><script>alert(1)</script>';
    const s = läsSkiss({
      id: "s",
      namn: "S",
      okänt: elak,
      objekt: [
        { id: "o1", sort: elak, namn: "A", x: elak, y: NaN, b: 1e12, h: -5 },
        { id: elak, sort: "server", namn: "B" },
        { id: "o1", sort: "server", namn: "dubblett" },
        "skräp",
      ],
      zoner: [{ id: "z1", namn: "Z", färg: elak, x: 1.4, y: 2, b: 300, h: 200 }],
      kopplingar: [
        { id: "k1", från: "o1", till: "o1" },
        { id: "k2", från: "o1", till: "finns-inte" },
      ],
    })!;
    expect(JSON.stringify(s)).not.toContain("script");
    expect(s.objekt).toHaveLength(1);
    expect(s.objekt[0]).toMatchObject({ sort: "server", x: 0, y: 0, b: 600, h: 44 });
    expect(s.zoner[0]).toMatchObject({ färg: "gra", x: 1 });
    expect(s.kopplingar).toEqual([]);
    expect(s).not.toHaveProperty("okänt");
  });

  it("dold är bara sant när det står true", () => {
    expect(läsSkiss({ id: "s", namn: "S", dold: "ja" })!.dold).toBeUndefined();
    expect(läsSkiss({ id: "s", namn: "S", dold: true })!.dold).toBe(true);
  });
});

describe("behörigheten för systemskisser", () => {
  const annas = { skapadAv: { id: "anna", namn: "Anna" } };
  it("alla inloggade läser en synlig skiss; skaparen och administratören ändrar den", () => {
    expect(kanLäsaSkiss(bo, annas)).toBe(true);
    expect(kanLäsaSkiss(null, annas)).toBe(false);
    expect(kanÄndraSkiss(anna, annas)).toBe(true);
    expect(kanÄndraSkiss(bo, annas)).toBe(false);
    expect(kanÄndraSkiss(admin, annas)).toBe(true);
    expect(kanTaBortSkiss(bo, annas)).toBe(false);
  });

  it("en dold skiss ser bara administratörer – inte ens den som skapade den", () => {
    const dold = { ...annas, dold: true };
    expect(kanLäsaSkiss(admin, dold)).toBe(true);
    expect(kanLäsaSkiss(anna, dold)).toBe(false);
    expect(kanÄndraSkiss(anna, dold)).toBe(false);
    expect(kanTaBortSkiss(anna, dold)).toBe(false);
  });

  it("bara en administratör kan dölja", () => {
    expect(kanDöljaSkiss(admin)).toBe(true);
    expect(kanDöljaSkiss(anna)).toBe(false);
  });
});
