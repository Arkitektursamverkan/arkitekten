/**
 * Utskriften av en systemskiss: bladens riktning och skala, läsbarheten och
 * ett blad per lager.
 */
import { describe, expect, it } from "vitest";
import { läggTillObjekt, nySkiss, type Systemskiss } from "@/core/systemskiss";
import { bildyta, DELA_UNDER_PT, REMSLUFT, delaUpp, delText, läsbarhet, placera, utskriftsblad, utskriftsdokument, UTSKRIFT_FÖRVAL, ÖVERLAPP } from "./utskrift";
import { SKISS_BRÖDTEXT } from "./skiss-svg";

const MM_PER_PT = 25.4 / 72;

/** En skiss med ett objekt i vardera lagret a och b, långt isär. */
function tvåLager(): Systemskiss {
  let s: Systemskiss = { ...nySkiss("Miljö"), lager: [{ id: "a", namn: "Alfa" }, { id: "b", namn: "Beta" }, { id: "tom", namn: "Tomt" }] };
  s = läggTillObjekt(s, "server", 0, 0, "a").skiss;
  s = läggTillObjekt(s, "databas", 3000, 0, "b").skiss;
  return s;
}

describe("placera", () => {
  it("en bred bild blir liggande och en hög stående när riktningen är fri", () => {
    expect(placera("x", "<svg/>", 2000, 800, "A4", "auto").liggande).toBe(true);
    expect(placera("x", "<svg/>", 800, 2000, "A4", "auto").liggande).toBe(false);
  });

  it("bilden fyller bladets yta och brödtexten räknas om till punkter", () => {
    const b = placera("x", "<svg/>", 2000, 800, "A3", "liggande");
    const yta = bildyta("A3", true);
    expect(b.bMm).toBeCloseTo(yta.b, 5);
    expect(b.hMm).toBeLessThanOrEqual(yta.h);
    expect(b.textPt).toBeCloseTo((SKISS_BRÖDTEXT * (yta.b / 2000)) / MM_PER_PT, 5);
  });

  it("A3 ger drygt √2 gånger så stor text som A4 – marginalerna är lika breda", () => {
    const a4 = placera("x", "<svg/>", 3000, 2000, "A4", "liggande").textPt;
    const a3 = placera("x", "<svg/>", 3000, 2000, "A3", "liggande").textPt;
    expect(a3 / a4).toBeGreaterThan(Math.SQRT2);
    expect(a3 / a4).toBeLessThan(1.5);
  });

  it("en liten bild förstoras högst till 12 pt brödtext – ingen affisch", () => {
    expect(placera("x", "<svg/>", 200, 100, "A3", "auto").textPt).toBeCloseTo(12, 5);
  });

  it("läsbarheten har tre steg", () => {
    expect(läsbarhet(7)).toBe("bra");
    expect(läsbarhet(5)).toBe("liten");
    expect(läsbarhet(3)).toBe("oläsbar");
  });
});

describe("utskriftsblad", () => {
  it("ett blad per lager – tomma lager hoppas över – och hela skissen först om man vill", () => {
    const s = tvåLager();
    const perLager = utskriftsblad(s, { ...UTSKRIFT_FÖRVAL, innehåll: "lager" }, null, true);
    expect(perLager.map((b) => b.rubrik)).toEqual(["Miljö – Alfa", "Miljö – Beta"]);
    const medHela = utskriftsblad(s, { ...UTSKRIFT_FÖRVAL, innehåll: "lager", medHela: true, dela: false }, null, true);
    expect(medHela.map((b) => b.rubrik)).toEqual(["Miljö", "Miljö – Alfa", "Miljö – Beta"]);
    // Ett lager är en mindre bild än hela skissen – därför större text.
    expect(medHela[1].textPt).toBeGreaterThan(medHela[0].textPt);
  });

  it("det som visas är ett blad med de valda lagren i rubriken", () => {
    const blad = utskriftsblad(tvåLager(), UTSKRIFT_FÖRVAL, new Set(["b"]), true);
    expect(blad).toHaveLength(1);
    expect(blad[0].rubrik).toBe("Miljö – Beta");
    expect(blad[0].svg).not.toContain(">Server<");
  });

  it("en tom skiss ger inga blad", () => {
    expect(utskriftsblad(nySkiss("Tom"), UTSKRIFT_FÖRVAL, null, true)).toEqual([]);
  });
});

describe("utskriftsdokument", () => {
  it("har pappret som sidmall, bilden i millimeter och bladnummer", () => {
    const s = tvåLager();
    const blad = utskriftsblad(s, { ...UTSKRIFT_FÖRVAL, papper: "A4", innehåll: "lager" }, null, true);
    const html = utskriftsdokument("Miljö <test>", blad, "A4");
    expect(html).toContain("@page stående { size: 210mm 297mm");
    expect(html).toContain("@page liggande { size: 297mm 210mm");
    expect(html).toContain("<title>Miljö &lt;test&gt;</title>");
    expect(html).toContain("Blad 2 av 2");
    expect(html).toMatch(/<svg[^>]* width="[\d.]+mm" height="[\d.]+mm"/);
    // viewBox står kvar – bilden skalas, den beskärs inte.
    expect(html).toContain("viewBox=");
  });
});

describe("delning på flera blad", () => {
  it("en bild som blir för liten delas så att texten blir minst 7 pt, med överlapp", () => {
    // 6000 × 900 enheter på A3: hel ger långt under 6 pt.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="900" viewBox="-30 -30 6000 900"></svg>`;
    expect(placera("x", svg, 6000, 900, "A3", "auto").textPt).toBeLessThan(6);
    const blad = delaUpp("x", svg, 6000, 900, "A3", "auto", true);
    expect(blad.length).toBeGreaterThan(1);
    for (const b of blad) expect(b.textPt).toBeGreaterThanOrEqual(7 - 1e-9);
    // Delarna täcker hela bilden och överlappar ÖVERLAPP mm.
    const första = blad[0].del!;
    const andra = blad[1].del!;
    expect(första.x).toBe(-30);
    const s = blad[0].bMm / första.b;
    expect((första.x + första.b - andra.x) * s).toBeCloseTo(ÖVERLAPP, 5);
    const sista = blad[blad.length - 1].del!;
    expect(sista.x + sista.b).toBeCloseTo(-30 + 6000, 5);
    expect(delText(blad[0])).toBe(`del 1 av ${blad.length}, kolumn 1`);
  });

  it("utan delning, eller när texten redan räcker, blir det ett blad", () => {
    const svg = `<svg width="6000" height="900" viewBox="0 0 6000 900"></svg>`;
    expect(delaUpp("x", svg, 6000, 900, "A3", "auto", false)).toHaveLength(1);
    expect(delaUpp("x", svg, 1000, 700, "A3", "auto", true)).toHaveLength(1);
  });

  it("delarnas fönster står i dokumentet", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="900" viewBox="0 0 6000 900"></svg>`;
    const html = utskriftsdokument("x", delaUpp("x", svg, 6000, 900, "A4", "auto", true), "A4");
    expect(html).toContain('viewBox="0.0 0.0 ');
    expect(html).toContain("del 2 av");
  });
});

it("REGRESSION: ett valt lager med 5–6 pt text delades på två blad – det ska bli ett, centrerat", () => {
  // Lagret "Servrar att få upp" var 1640 × 310 enheter: 5,5 pt på A4 liggande gav del 1 och 2.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1640" height="310" viewBox="0 0 1640 310"></svg>`;
  // Sedan 2026-11-24 står en så bred bild i remsor på bladet – fortfarande ETT blad.
  const hel = placera("x", svg, 1640, 310, "A4", "auto");
  expect(hel.textPt).toBeGreaterThan(DELA_UNDER_PT);
  const blad = delaUpp("x", svg, 1640, 310, "A4", "auto", true);
  expect(blad).toHaveLength(1);
  expect(blad[0].del).toBeUndefined();
  // Bilden står mitt på bladet, i båda leden.
  expect(utskriftsdokument("x", blad, "A4")).toMatch(/\.bild \{[^}]*justify-content: center; align-items: center;/);
});

it("förvalet är ETT blad, hur liten texten än blir", () => {
  let s: Systemskiss = nySkiss("Stor");
  s = läggTillObjekt(s, "server", 0, 0).skiss;
  s = läggTillObjekt(s, "server", 12000, 4000).skiss;
  const blad = utskriftsblad(s, UTSKRIFT_FÖRVAL, null, true);
  expect(blad).toHaveLength(1);
  expect(läsbarhet(blad[0].textPt)).toBe("oläsbar");
});

describe("läsbarhet på papper (2026-11-24)", () => {
  it("revisionsrutan står i bladets rubrik i fast storlek, inte i bilden", () => {
    let s: Systemskiss = nySkiss("Miljö");
    s = läggTillObjekt(s, "server", 0, 0).skiss;
    const rev = { klassning: "Nivå 2 - Affärshemlig", version: "0.5", status: "utkast" as const, ändradAv: "Anna" };
    const blad = utskriftsblad(s, UTSKRIFT_FÖRVAL, null, true, rev);
    expect(blad[0].revision?.[0]).toBe("Klassning: Nivå 2 - Affärshemlig");
    expect(blad[0].svg).not.toContain("Affärshemlig");
    const dok = utskriftsdokument("x", blad, "A3");
    expect(dok).toMatch(/<div class="rev"><span class="klass">Klassning: Nivå 2 - Affärshemlig<\/span> · [^<]*0\.5[^<]* · Justerad av Anna<\/div>/);
  });

  it("en mycket bred bild med liten text står i remsor under varandra på ETT blad", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="1600" viewBox="10 20 8000 1600"></svg>`;
    const b = placera("x", svg, 8000, 1600, "A3", "auto");
    const utan = Math.max(...[true, false].map((l) => Math.min(bildyta("A3", l).b / 8000, bildyta("A3", l).h / 1600)));
    expect(b.remsor?.length).toBeGreaterThanOrEqual(2);
    expect(b.textPt).toBeGreaterThan(((SKISS_BRÖDTEXT * utan) / MM_PER_PT) * 1.25);
    // Remsorna täcker hela bredden och överlappar.
    const r = b.remsor!;
    expect(r[0].x).toBeCloseTo(10, 5);
    expect(r[r.length - 1].x + r[r.length - 1].b).toBeCloseTo(8010, 5);
    expect(r[1].x).toBeLessThan(r[0].x + r[0].b);
    // Allt ryms på bladet.
    const yta = bildyta("A3", b.liggande);
    expect(b.hMm).toBeLessThanOrEqual(yta.h + 1e-6);
    expect(b.bMm).toBeLessThanOrEqual(yta.b + 1e-6);
    const dok = utskriftsdokument("x", [b], "A3");
    expect(dok.match(/class="remsa"/g)).toHaveLength(r.length);
    expect(dok).toContain(`height: ${REMSLUFT}mm`);
  });

  it("en bild som redan går att läsa delas inte i remsor", () => {
    const b = placera("x", "<svg/>", 1640, 310, "A3", "auto");
    expect(b.textPt).toBeGreaterThanOrEqual(6);
    expect(b.remsor).toBeUndefined();
  });
});
