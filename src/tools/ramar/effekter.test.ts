// @vitest-environment jsdom
/**
 * Ramens lager ovanpå exportens SVG – för båda familjerna, ur riktiga flöden.
 *
 * Det viktiga: exportörerna märker VARJE objekt och VARJE koppling, pulsen
 * går längs exakt den väg exportören ritade, och en markering vars mål
 * försvunnit redovisas i stället för att hamna på något annat.
 */

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { SavedFlow } from "@/core/flow-store";
import { compileDraft } from "@/core/draft";
import { compileAp } from "@/core/affarsprocess";
import {
  RAM_KANT_ATTR,
  RAM_NOD_ATTR,
  nyRam,
  ramKantNyckel,
  type Markering,
  type Ram,
} from "@/core/ram";
import { läggPåRam, pulsStreck, väglängd } from "./effekter";
import { processSvg } from "./process-svg";

const läs = (fil: string) => JSON.parse(fs.readFileSync(`flows/${fil}`, "utf8")) as SavedFlow;
const filer = fs.existsSync("flows") ? fs.readdirSync("flows").filter((f) => f.endsWith(".json")) : [];
const fd = filer.find((f) => !f.startsWith("ap-"));
const ap = filer.find((f) => f.startsWith("ap-") && f !== "ap-0-1-symbolforklaring.json");

function parse(svg: string) {
  return new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
}

function ramMed(...m: Markering[]): Ram {
  return { ...nyRam("R"), markeringar: m };
}

// Innehållet (flows/) ligger inte i git – i en ren klon hoppas testerna över.
describe.skipIf(!fd)("flödesschemat", () => {
  if (!fd) return;
  const flöde = läs(fd);
  const svg = processSvg(flöde);

  it("märker varje objekt och varje synlig sekvenskoppling med stabil nyckel", () => {
    const rot = parse(svg);
    const noder = new Set(Array.from(rot.querySelectorAll(`[${RAM_NOD_ATTR}]`)).map((e) => e.getAttribute(RAM_NOD_ATTR)));
    const modell = compileDraft(flöde.draft);
    for (const n of modell.nodes) expect(noder).toContain(n.id);
    const kanter = new Set(Array.from(rot.querySelectorAll(`[${RAM_KANT_ATTR}]`)).map((e) => e.getAttribute(RAM_KANT_ATTR)));
    expect(kanter.size).toBeGreaterThan(0);
    for (const k of kanter) {
      expect(modell.edges.some((e) => ramKantNyckel(e.source, e.target, e.label) === k)).toBe(true);
    }
  });

  it("pulsen går längs exportörens egen väg och markeringen hamnar i samma koordinatram", () => {
    const rot = parse(svg);
    const väg = rot.querySelector(`[${RAM_KANT_ATTR}]`)!;
    const nyckel = väg.getAttribute(RAM_KANT_ATTR)!;
    const nod = rot.querySelector(`[${RAM_NOD_ATTR}]`)!;
    const ut = parse(
      läggPåRam(
        svg,
        ramMed(
          { mål: { typ: "kant", id: nyckel }, verktyg: "puls", färg: "#e8590c" },
          { mål: { typ: "nod", id: nod.getAttribute(RAM_NOD_ATTR)! }, verktyg: "farg", färg: "#1f5c9e" },
        ),
      ).svg,
    );
    const lager = ut.querySelector(".ark-ram-lager")!;
    // Samma förälder som objekten – flödesschemat förskjuter ritningen med en
    // translate för titeln, och lagret måste ligga under samma förskjutning.
    expect(lager.parentNode).toBe(ut.querySelector(`[${RAM_NOD_ATTR}]`)!.parentNode);
    const rörelse = lager.querySelector("animateMotion")!;
    expect(rörelse.getAttribute("path")).toBe(väg.getAttribute("d"));
    expect(lager.querySelector(".ark-ram-farg rect")).not.toBeNull();
  });
});

describe.skipIf(!ap)("affärsprocess", () => {
  if (!ap) return;
  const flöde = läs(ap);
  const svg = processSvg(flöde);

  it("märker objekten och relationerna", () => {
    const rot = parse(svg);
    const modell = compileAp(flöde.draft);
    const noder = new Set(Array.from(rot.querySelectorAll(`[${RAM_NOD_ATTR}]`)).map((e) => e.getAttribute(RAM_NOD_ATTR)));
    expect(noder.size).toBeGreaterThan(0);
    for (const id of noder) expect(modell.nodes.some((n) => n.id === id)).toBe(true);
    const kanter = Array.from(rot.querySelectorAll(`[${RAM_KANT_ATTR}]`));
    expect(kanter.length).toBeGreaterThan(0);
  });

  it("strålkastaren lägger en slöja och lyfter det markerade över den", () => {
    const rot = parse(svg);
    const id = rot.querySelector(`[${RAM_NOD_ATTR}]`)!.getAttribute(RAM_NOD_ATTR)!;
    const ram = { ...ramMed({ mål: { typ: "nod", id }, verktyg: "blink", färg: "#c2255c" }), strålkastare: true };
    const ut = parse(läggPåRam(svg, ram).svg);
    const barn = Array.from(ut.querySelector(".ark-ram-sloja")!.parentNode!.childNodes) as Element[];
    const slöja = barn.findIndex((e) => e.getAttribute?.("class") === "ark-ram-sloja");
    const lyft = barn.findIndex((e, i) => i > slöja && e.getAttribute?.(RAM_NOD_ATTR) === id);
    expect(lyft).toBeGreaterThan(slöja);
  });
});

describe("läggPåRam", () => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(5,5)">` +
    `<path ${RAM_KANT_ATTR}="a-&gt;b" d="M0,0 L30,0 L30,40"/>` +
    `<g ${RAM_NOD_ATTR}="a" data-ark-ruta="0 0 10 10"><rect/></g></g></svg>`;

  it("redovisar markeringar vars mål inte längre finns", () => {
    const r = läggPåRam(svg, ramMed({ mål: { typ: "nod", id: "borta" }, verktyg: "farg", färg: "#000" }));
    expect(r.saknas).toEqual([{ typ: "nod", id: "borta" }]);
  });

  it("utan ram och utan redigering är bilden densamma, plus ett tomt lager", () => {
    const ut = parse(läggPåRam(svg, null).svg);
    expect(ut.querySelector(".ark-ram-lager")!.childNodes).toHaveLength(0);
    expect(ut.querySelector(".ark-ram-traffytor")).toBeNull();
  });

  it("redigeringen ger varje koppling en bred träffyta med samma nyckel", () => {
    const ut = parse(läggPåRam(svg, null, { redigerar: true }).svg);
    const träff = ut.querySelector(`.ark-ram-traffytor [${RAM_KANT_ATTR}]`)!;
    expect(träff.getAttribute(RAM_KANT_ATTR)).toBe("a->b");
    expect(Number(träff.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(10);
  });

  it("id:n i defs bär prefixet – två bilder på samma sida krockar inte", () => {
    const ut = läggPåRam(svg, ramMed({ mål: { typ: "kant", id: "a->b" }, verktyg: "farg", färg: "#123456" }), {
      prefix: "p1",
    }).svg;
    expect(ut).toContain('id="p1-pil-0"');
    expect(ut).toContain("url(#p1-pil-0)");
  });
});

describe("pulsens mått", () => {
  it("väglängden räknar räta sträckor och bågarnas ändpunkter", () => {
    expect(väglängd("M0,0 L30,0 L30,40")).toBe(70);
    expect(väglängd("M0,0 L10,0 A5,5 0 0,1 15,5 L15,20")).toBeCloseTo(10 + Math.hypot(5, 5) + 15);
  });

  it("strecket leds av punkten: täten ligger vid början när varvet börjar och vid slutet när det slutar", () => {
    const L = 200;
    const p = pulsStreck(L);
    // Täten = streck − offset.
    expect(p.streck - p.från).toBe(0);
    expect(p.streck - p.till).toBe(L);
    // En lång koppling tar längre tid än en kort – farten är densamma.
    expect(pulsStreck(1000).tid).toBeGreaterThan(pulsStreck(300).tid);
  });
});

describe("zoom", () => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 600" width="2000" height="600"><g transform="translate(16,16)"><g transform="translate(0,46)">` +
    `<g ${RAM_NOD_ATTR}="a" data-ark-ruta="1000 100 120 60"><rect/></g>` +
    `<g ${RAM_NOD_ATTR}="b" data-ark-ruta="1400 300 120 60"><rect/></g></g></g></svg>`;
  const ram = {
    ...ramMed(
      { mål: { typ: "nod", id: "a" }, verktyg: "farg", färg: "#000" },
      { mål: { typ: "nod", id: "b" }, verktyg: "farg", färg: "#000" },
    ),
    zooma: true,
  };

  it("presentationen beskärs till det markerade, i rotens koordinater (translate räknas in)", () => {
    const r = läggPåRam(svg, ram);
    const vb = parse(r.svg).getAttribute("viewBox")!.split(" ").map(Number);
    // Ytterram 995..1525 × 95..365 i scenen, +16/+62 till roten, 36 luft.
    expect(vb[0]).toBeCloseTo(995 + 16 - 36, 0);
    expect(vb[1]).toBeCloseTo(95 + 62 - 36, 0);
    expect(vb[2]).toBeCloseTo(530 + 72, 0);
  });

  it("redigeringen beskär inte – den visar utsnittet som en streckad ram", () => {
    const r = läggPåRam(svg, ram, { redigerar: true });
    const rot = parse(r.svg);
    expect(rot.getAttribute("viewBox")).toBe("0 0 2000 600");
    expect(rot.querySelector(".ark-ram-utsnitt")).not.toBeNull();
    expect(r.utsnitt).not.toBeNull();
  });

  it("ett ensamt objekt fyller aldrig hela skärmen – utsnittet har en minsta storlek", () => {
    const r = läggPåRam(svg, { ...ramMed({ mål: { typ: "nod", id: "a" }, verktyg: "farg", färg: "#000" }), zooma: true });
    expect(r.utsnitt!.w).toBeGreaterThanOrEqual(420);
    expect(r.utsnitt!.h).toBeGreaterThanOrEqual(260);
  });
});
