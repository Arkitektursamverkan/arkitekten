import { describe, expect, it } from "vitest";
import { läggTillKoppling, läggTillObjekt, läggTillSkissversion, läggTillZon, nySkiss, ändraKoppling, ändraObjekt, type Systemskiss } from "@/core/systemskiss";
import { TEXT_MAX, rutansSkala, skissGeometri, skissInnehåll, skissRevision, skissSvg, träffISkiss } from "./skiss-svg";

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

describe("exportens revisionsruta", () => {
  it("bilden säger vilken version den är, och klassningen när den ska med", () => {
    let s = läggTillObjekt(nySkiss("Miljön"), "server", 0, 0).skiss;
    s = läggTillSkissversion(null, s, { nu: "2026-03-04T00:00:00.000Z" });
    s = läggTillSkissversion(s, s, { status: "fastslagen", nu: "2026-03-05T00:00:00.000Z" });
    const utan = skissSvg(s);
    const med = skissSvg(s, skissRevision(s, -1, false, "Nivå 1 – Måttlig skada"));
    expect(utan.svg).not.toContain("Fastslagen");
    expect(med.svg).toContain("Fastslagen 1.0 · 2026-03-05");
    expect(med.svg).toContain("Klassning: Nivå 1 – Måttlig skada");
    expect(med.höjd).toBeGreaterThan(utan.höjd);
    // En äldre version stämplas som sig själv.
    expect(skissSvg(s, skissRevision(s, 0, false)).svg).toContain("Utkast 0.1");
  });
});

describe("rutornas text i en utskrift (fyllRutor)", () => {
  const anteckning = (id: string, x: number, y: number, text: string, b = 420, h = 230) => ({ id, sort: "anteckning" as const, namn: "Rubrik", text, x, y, b, h });

  it("förstoras så att texten fyller rutan – utan att rutan växer eller något kapas", () => {
    const o = anteckning("a", 0, 0, "Kort text.");
    const f = rutansSkala(o);
    expect(f).toBeGreaterThan(1);
    expect(f).toBeLessThanOrEqual(TEXT_MAX);
    const g = skissGeometri({ ...nySkiss("x"), objekt: [o] }, { fyllRutor: true });
    const l = g.objekt.get("a")!;
    expect(l.skala).toBe(f);
    expect(l.ruta.h).toBe(230);
    expect(l.textRader.join(" ")).toBe("Kort text.");
    // Utan valet – skärmen – är allt som förut.
    expect(skissGeometri({ ...nySkiss("x"), objekt: [o] }).objekt.get("a")!.skala).toBe(1);
  });

  it("en full ruta förstoras inte", () => {
    expect(rutansSkala(anteckning("a", 0, 0, "ord ".repeat(300)))).toBe(1);
  });

  it("flödets rutor får EN förstoring för hela skissen – den minsta", () => {
    const ruta = (id: string, x: number, namn: string, text: string) => ({ id, sort: "server" as const, namn, text, x, y: 0, b: 240, h: 150 });
    const s: Systemskiss = { ...nySkiss("x"), objekt: [ruta("kort", 0, "A", "x"), ruta("lång", 300, "En längre rubrik här", "Och en text som tar några rader i rutan")] };
    const g = skissGeometri(s, { fyllRutor: true });
    expect(g.objekt.get("kort")!.skala).toBeGreaterThan(1);
    expect(g.objekt.get("kort")!.skala).toBe(g.objekt.get("lång")!.skala);
    expect(g.objekt.get("kort")!.skala).toBe(rutansSkala(s.objekt[1]));
    expect(g.objekt.get("lång")!.ruta.h).toBe(150);
  });

  it("anteckningar i samma zon får samma storlek – den minsta", () => {
    let s: Systemskiss = { ...nySkiss("x"), objekt: [anteckning("kort", 20, 40, "Kort."), anteckning("lång", 460, 40, "ord ".repeat(80))] };
    s = läggTillZon(s, 0, 0).skiss;
    s = { ...s, zoner: s.zoner.map((z) => ({ ...z, x: 0, y: 0, b: 1000, h: 400 })) };
    const g = skissGeometri(s, { fyllRutor: true });
    expect(g.objekt.get("kort")!.skala).toBe(g.objekt.get("lång")!.skala);
    expect(g.objekt.get("kort")!.skala).toBe(rutansSkala(s.objekt[1]));
  });

  it("den förstorade texten ritas i större storlek", () => {
    const s = { ...nySkiss("x"), objekt: [anteckning("a", 0, 0, "Kort text.")] };
    const f = rutansSkala(s.objekt[0]);
    expect(skissSvg(s, undefined, { fyllRutor: true }).svg).toContain(`font-size="${+(11.5 * f).toFixed(1)}"`);
  });
});
