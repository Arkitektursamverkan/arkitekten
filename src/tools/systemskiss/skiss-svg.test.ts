import { describe, expect, it } from "vitest";
import { läggTillKoppling, läggTillObjekt, läggTillZon, nySkiss, ändraKoppling, ändraObjekt } from "@/core/systemskiss";
import { skissGeometri, skissInnehåll, skissSvg, träffISkiss } from "./skiss-svg";

function exempel() {
  let { skiss, id: a } = läggTillObjekt(nySkiss("Miljö"), "server", 100, 100);
  const andra = läggTillObjekt(skiss, "databas", 500, 100);
  const k = läggTillKoppling(andra.skiss, a, andra.id);
  return { skiss: k.skiss, a, b: andra.id, k: k.id! };
}

describe("systemskissens ritare", () => {
  it("ritar objekt, koppling och pilspets – och exporten bär samma innehåll som ritytan", () => {
    const { skiss, a, k } = exempel();
    const inre = skissInnehåll(skiss);
    expect(inre).toContain(`data-skiss-objekt="${a}"`);
    expect(inre).toContain(`data-skiss-koppling="${k}"`);
    expect(inre).toContain("<polygon");
    const { svg, bredd, höjd } = skissSvg(skiss);
    expect(svg).toContain(inre);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(bredd).toBeGreaterThan(400);
    expect(höjd).toBeGreaterThan(60);
  });

  it("två objekt på samma rad kopplas med en rak linje", () => {
    const { skiss } = exempel();
    const p = skissGeometri(skiss).kopplingar[0].punkter;
    expect(new Set(p.map((q) => q.y)).size).toBe(1);
    expect(p[0].x).toBeLessThan(p[p.length - 1].x);
  });

  it("flera kopplingar på samma sida fördelas längs sidan i stället för att ligga på varandra", () => {
    let { skiss, a } = exempel();
    const över = läggTillObjekt(skiss, "klient", 500, -100);
    const under = läggTillObjekt(över.skiss, "klient", 500, 300);
    skiss = läggTillKoppling(läggTillKoppling(under.skiss, a, över.id).skiss, a, under.id).skiss;
    const starter = skissGeometri(skiss).kopplingar.map((k) => `${k.punkter[0].x},${k.punkter[0].y}`);
    expect(new Set(starter).size).toBe(starter.length);
  });

  it("escapar allt som kommer ur skissen", () => {
    let { skiss, a, k } = exempel();
    const elak = '<script>alert("x")</script>';
    skiss = ändraObjekt(skiss, a, { namn: elak, text: elak });
    skiss = ändraKoppling(skiss, k, { etikett: elak });
    skiss = { ...läggTillZon(skiss, 0, 0).skiss, namn: elak };
    skiss = { ...skiss, zoner: skiss.zoner.map((z) => ({ ...z, namn: elak })) };
    const { svg } = skissSvg(skiss);
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("rutan växer nedåt när texten kräver det, och kopplingen möter den ritade rutan", () => {
    let { skiss, a } = exempel();
    skiss = ändraObjekt(skiss, a, { text: "rad 1\nrad 2\nrad 3\nrad 4\nrad 5\nrad 6" });
    const l = skissGeometri(skiss).objekt.get(a)!;
    expect(l.ruta.h).toBeGreaterThan(l.objekt.h);
    expect(l.textRader).toHaveLength(6);
  });

  it("en zon träffas i rubriken och kanten men inte i ytan – den är ritytan", () => {
    const { skiss: s0 } = exempel();
    const { skiss, id } = läggTillZon(s0, 1000, 1000); // 420 × 260 kring (1000, 1000)
    const g = skissGeometri(skiss);
    expect(träffISkiss(skiss, g, { x: 1000, y: 880 })).toEqual({ typ: "zon", id });
    expect(träffISkiss(skiss, g, { x: 791, y: 1000 })).toEqual({ typ: "zon", id });
    expect(träffISkiss(skiss, g, { x: 1000, y: 1000 })).toBeNull();
  });

  it("ett objekt träffas före kopplingen och zonen under det", () => {
    const { skiss, a, k } = exempel();
    const g = skissGeometri(skiss);
    const o = g.objekt.get(a)!.ruta;
    expect(träffISkiss(skiss, g, { x: o.x + 5, y: o.y + 5 })).toEqual({ typ: "objekt", id: a });
    const p = g.kopplingar[0].punkter;
    expect(träffISkiss(skiss, g, { x: (p[0].x + p[p.length - 1].x) / 2, y: p[0].y + 3 })).toEqual({ typ: "koppling", id: k });
  });

  it("en tom skiss går att rita", () => {
    const { svg, bredd } = skissSvg(nySkiss("Tom"));
    expect(svg).toContain("</svg>");
    expect(bredd).toBeGreaterThan(0);
  });
});
