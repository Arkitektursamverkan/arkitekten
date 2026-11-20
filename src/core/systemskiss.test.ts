import { describe, expect, it } from "vitest";
import { kanDöljaSkiss, kanLäsaSkiss, kanTaBortSkiss, kanÄndraSkiss, type Användare } from "./behorighet";
import {
  dupliceraISkiss,
  filtreraSkiss,
  flyttaISkiss,
  läggTillKoppling,
  läggTillLager,
  läggTillObjekt,
  läggTillZon,
  läsSkiss,
  medföljande,
  nySkiss,
  skissId,
  skissNyckel,
  sättLager,
  taBortLager,
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

describe("lager", () => {
  function medLager() {
    let s = nySkiss("Miljö");
    const app = läggTillLager(s, "Appen");
    const annan = läggTillLager(app.skiss, "Annan");
    s = annan.skiss;
    const web = läggTillObjekt(s, "tjanst", 0, 0, app.id);
    const db = läggTillObjekt(web.skiss, "databas", 300, 0, app.id);
    const hub = läggTillObjekt(db.skiss, "tjanst", 600, 0, annan.id);
    const fjärran = läggTillObjekt(hub.skiss, "tjanst", 900, 0, annan.id);
    const anv = läggTillObjekt(fjärran.skiss, "anvandare", -300, 0);
    const zon = läggTillZon(anv.skiss, 0, 0, annan.id);
    s = zon.skiss;
    for (const [a, b] of [[web.id, db.id], [web.id, hub.id], [hub.id, fjärran.id], [anv.id, hub.id]]) s = läggTillKoppling(s, a, b).skiss;
    return { s, app: app.id, annan: annan.id, web: web.id, db: db.id, hub: hub.id, fjärran: fjärran.id, anv: anv.id, zon: zon.id };
  }
  const idn = (v: { id: string }[]) => v.map((x) => x.id).sort();

  it("utan filter är skissen orörd", () => {
    const { s } = medLager();
    expect(filtreraSkiss(s, null)).toBe(s);
  });

  it("ett lager visar sitt eget, det gemensamma och det lagret är kopplat till – men inte grannens egna kopplingar", () => {
    const m = medLager();
    const f = filtreraSkiss(m.s, new Set([m.app]));
    expect(idn(f.objekt)).toEqual([m.web, m.db, m.hub, m.anv].sort());
    // web→db och web→hub hör till lagret. hub→fjärran och användare→hub gör det inte.
    expect(f.kopplingar.map((k) => `${k.från}>${k.till}`).sort()).toEqual([`${m.web}>${m.db}`, `${m.web}>${m.hub}`].sort());
    // Det andra lagrets zon följer inte med grannen in.
    expect(f.zoner).toEqual([]);
  });

  it("utan grannar visas bara lagret och det gemensamma", () => {
    const m = medLager();
    const f = filtreraSkiss(m.s, new Set([m.app]), false);
    expect(idn(f.objekt)).toEqual([m.web, m.db, m.anv].sort());
    expect(f.kopplingar).toHaveLength(1);
  });

  it("lägena rörs inte av filtret", () => {
    const m = medLager();
    const f = filtreraSkiss(m.s, new Set([m.app]));
    expect(f.objekt.find((o) => o.id === m.db)).toBe(m.s.objekt.find((o) => o.id === m.db));
  });

  it("ett borttaget lager lämnar sitt innehåll kvar, utanför alla lager", () => {
    const m = medLager();
    const utan = taBortLager(m.s, m.annan);
    expect(utan.lager!.map((l) => l.id)).toEqual([m.app]);
    expect(utan.objekt.find((o) => o.id === m.hub)).not.toHaveProperty("lager");
    expect(utan.zoner[0]).not.toHaveProperty("lager");
    expect(utan.objekt).toHaveLength(m.s.objekt.length);
  });

  it("flyttar objekt mellan lager och ut ur dem", () => {
    const m = medLager();
    expect(sättLager(m.s, [m.web], m.annan).objekt.find((o) => o.id === m.web)!.lager).toBe(m.annan);
    expect(sättLager(m.s, [m.web], undefined).objekt.find((o) => o.id === m.web)).not.toHaveProperty("lager");
  });

  it("läsSkiss behåller lagren och stryker en tillhörighet till ett lager som inte finns", () => {
    const m = medLager();
    expect(läsSkiss(JSON.parse(JSON.stringify(m.s)))).toEqual(m.s);
    const trasig = { ...m.s, objekt: m.s.objekt.map((o) => (o.id === m.web ? { ...o, lager: "finns-inte" } : o)) };
    expect(läsSkiss(trasig)!.objekt.find((o) => o.id === m.web)).not.toHaveProperty("lager");
  });
});

describe("gemensamma zoner i en filtrerad bild", () => {
  it("dras ihop kring det som är kvar – men växer aldrig, och rörs inte utan filter", () => {
    let s = nySkiss("Miljö");
    const lager = läggTillLager(s, "App");
    const annat = läggTillLager(lager.skiss, "Annat");
    const server = läggTillZon(annat.skiss, 1000, 1000);
    s = ändraStorlek(server.skiss, server.id, 2000, 2000);
    s = ändraZon(s, server.id, { x: 0, y: 0 });
    const a = läggTillObjekt(s, "tjanst", 300, 300, lager.id);
    const b = läggTillObjekt(a.skiss, "tjanst", 1700, 1700, annat.id);
    s = b.skiss;
    const f = filtreraSkiss(s, new Set([lager.id]));
    const zon = f.zoner[0];
    const obj = f.objekt[0];
    expect(zon.b).toBeLessThan(400);
    expect(zon.x).toBeLessThanOrEqual(obj.x - 30);
    expect(zon.y).toBeLessThanOrEqual(obj.y - 50);
    expect(zon.x + zon.b).toBeGreaterThanOrEqual(obj.x + obj.b + 30);
    expect(zon.x).toBeGreaterThanOrEqual(0);
    // Hela skissen är orörd.
    expect(s.zoner[0].b).toBe(2000);
  });
});
