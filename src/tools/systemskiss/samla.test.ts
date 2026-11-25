/**
 * Samlad vy: flera lager framme läggs intill varandra, i lagrens ordning,
 * utan att det som hör ihop rubbas.
 */
import { describe, expect, it } from "vitest";
import { läggTillKoppling, läggTillObjekt, läggTillZon, nySkiss, ändraZon, type Systemskiss } from "@/core/systemskiss";
import { kanSamlas, samlaSkiss, visadSkiss } from "./samla";
import { skissGeometri } from "./skiss-svg";

const LAGER = [{ id: "a", namn: "Alfa" }, { id: "b", namn: "Beta" }, { id: "c", namn: "Gamma" }];
const tom = (): Systemskiss => ({ ...nySkiss("Miljö"), lager: LAGER });
const obj = (s: Systemskiss, id: string) => s.objekt.find((o) => o.id === id)!;

describe("kanSamlas", () => {
  it("kräver minst två lager framme", () => {
    expect(kanSamlas(null)).toBe(false);
    expect(kanSamlas(new Set(["a"]))).toBe(false);
    expect(kanSamlas(new Set(["a", "b"]))).toBe(true);
  });
});

describe("samlaSkiss", () => {
  it("lägger två lager som står långt isär intill varandra, i lagrens ordning", () => {
    let s = tom();
    // Beta står först i skissen, Alfa långt ned till höger – Alfa är första lagret.
    const b = läggTillObjekt(s, "server", 0, 0, "b");
    const a = läggTillObjekt(b.skiss, "server", 4000, 3000, "a");
    s = a.skiss;
    const före = skissGeometri(s).gräns;
    const samlad = samlaSkiss(s);
    const efter = skissGeometri(samlad).gräns;
    expect(efter.w).toBeLessThan(före.w / 4);
    expect(efter.h).toBeLessThan(före.h / 4);
    // Alfa står före Beta i läsordning: på en rad ovanför, eller till vänster på samma rad.
    const [pa, pb] = [obj(samlad, a.id), obj(samlad, b.id)];
    expect(pa.y < pb.y || (pa.y === pb.y && pa.x < pb.x)).toBe(true);
    // Skissen själv är orörd.
    expect(obj(s, a.id).x).toBeGreaterThan(3000);
  });

  it("det som är ihopkopplat står kvar i förhållande till varandra", () => {
    let s = tom();
    const a1 = läggTillObjekt(s, "server", 0, 0, "a");
    const b1 = läggTillObjekt(a1.skiss, "databas", 300, 0, "b");
    const c1 = läggTillObjekt(b1.skiss, "server", 5000, 5000, "c");
    s = läggTillKoppling(c1.skiss, a1.id, b1.id).skiss;
    const samlad = samlaSkiss(s);
    expect(obj(samlad, b1.id).x - obj(samlad, a1.id).x).toBe(300);
    expect(obj(samlad, b1.id).y).toBe(obj(samlad, a1.id).y);
    expect(obj(samlad, c1.id).x).toBeLessThan(1500);
  });

  it("ett stort tomt band inom ett block dras ihop, och det som stod i linje står kvar i linje", () => {
    let s = tom();
    const a1 = läggTillObjekt(s, "server", 0, 0, "a");
    const a2 = läggTillObjekt(a1.skiss, "server", 2000, 0, "a");
    const a3 = läggTillObjekt(a2.skiss, "server", 2000, 200, "a");
    const samlad = samlaSkiss(a3.skiss);
    const avstånd = obj(samlad, a2.id).x - (obj(samlad, a1.id).x + obj(samlad, a1.id).b);
    expect(avstånd).toBe(100);
    expect(obj(samlad, a3.id).x).toBe(obj(samlad, a2.id).x);
    expect(obj(samlad, a3.id).y - obj(samlad, a2.id).y).toBe(200);
  });

  it("zonen följer med sitt innehåll och krymper med bandet", () => {
    let s = tom();
    const z = läggTillZon(s, 0, 0, "a");
    s = ändraZon(z.skiss, z.id, { x: 0, y: 0, b: 2400, h: 300 });
    const o1 = läggTillObjekt(s, "server", 200, 150, "a");
    const o2 = läggTillObjekt(o1.skiss, "server", 2200, 150, "a");
    const samlad = samlaSkiss(o2.skiss);
    const zon = samlad.zoner[0];
    expect(zon.b).toBeLessThan(2400);
    for (const id of [o1.id, o2.id]) {
      const o = obj(samlad, id);
      expect(o.x).toBeGreaterThanOrEqual(zon.x);
      expect(o.x + o.b).toBeLessThanOrEqual(zon.x + zon.b);
    }
  });

  it("många block bryts på flera rader i stället för en lång rad", () => {
    let s: Systemskiss = { ...nySkiss("Miljö"), lager: Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, namn: `L${i}` })) };
    for (let i = 0; i < 9; i++) s = läggTillObjekt(s, "server", i * 3000, i * 3000, `l${i}`).skiss;
    const g = skissGeometri(samlaSkiss(s)).gräns;
    expect(g.w / g.h).toBeGreaterThan(1);
    expect(g.w / g.h).toBeLessThan(6);
  });
});

describe("visadSkiss", () => {
  it("samlar bara när minst två lager är framme och samla är på", () => {
    let s = tom();
    const a = läggTillObjekt(s, "server", 0, 0, "a");
    const b = läggTillObjekt(a.skiss, "server", 4000, 3000, "b");
    s = b.skiss;
    const x = obj(s, b.id).x;
    expect(obj(visadSkiss(s, new Set(["a", "b"]), true, false), b.id).x).toBe(x);
    expect(obj(visadSkiss(s, new Set(["b"]), true, true), b.id).x).toBe(x);
    expect(obj(visadSkiss(s, null, true, true), b.id).x).toBe(x);
    expect(obj(visadSkiss(s, new Set(["a", "b"]), true, true), b.id).x).toBeLessThan(1000);
  });
});
