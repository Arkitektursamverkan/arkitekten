import { expect, it } from "vitest";
import { parseToModel } from "../parser/parse";
import { layoutModel } from "../layout/layout";
import { pickEdgeSides } from "../layout/edge-router";
import { renderSvg } from "./svg";
import { toDrawioXml } from "./drawio";

const LONG = `Titel\nA → B → C → D → E → F → G → H → I → J`;
/** Byter bana, alltså går kanten nedåt – oberoende av sidbredd. */
const TVÄRS = `Titel\nA startar → B i portalen → Power Automate flödet triggas → C avslutar`;

/** Path som lämnar närmast punkten (x,y) – heldragna sekvensflöden. */
function pathFrom(svg: string, x: number, y: number): [number, number][] | undefined {
  const alla: [number, number][][] = [];
  for (const m of svg.matchAll(/<path d="(M[^"]+)"[^>]*stroke-width="1\.6"/g)) {
    alla.push(
      m[1]
        .replace(/^M/, "")
        .split(/ L/)
        .map((p) => p.split(",").map(Number) as [number, number]),
    );
  }
  return alla.find((p) => Math.abs(p[0][0] - x) < 1 && Math.abs(p[0][1] - y) < 1);
}

/** Path som slutar närmast punkten (x,y) – för att mäta ankomstsidan. */
function pathTo(svg: string, x: number, y: number): [number, number][] | undefined {
  const alla: [number, number][][] = [];
  for (const m of svg.matchAll(/<path d="(M[^"]+)"[^>]*stroke-width="1\.6"/g)) {
    alla.push(
      m[1]
        .replace(/^M/, "")
        .split(/ L/)
        .map((p) => p.split(",").map(Number) as [number, number]),
    );
  }
  return alla.find((p) => {
    const sista = p[p.length - 1];
    return Math.abs(sista[0] - x) < 1 && Math.abs(sista[1] - y) < 1;
  });
}

function ärOrtogonal(pts: [number, number][]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i][0] !== pts[i + 1][0] && pts[i][1] !== pts[i + 1][1]) return false;
  }
  return true;
}

it("REGRESSION: en koppling OVANIFRÅN går in i ovansidan – aldrig i sidan", () => {
  // Fastslagen regel, bestämd flera gånger. Felbeteendet: ett försök att låta
  // snett liggande grenar (en rad ner, en kolumn åt sidan) gå in i SIDAN i
  // stället – då pekade pilar som kom uppifrån in i objektens vänsterkant.
  const M = parseToModel(TVÄRS);
  const lo = layoutModel(M, { pageWidth: 1000 });
  const svg = renderSvg(M, lo);
  const byId = new Map(lo.nodes.map((n) => [n.node.id, n]));

  const kant = M.edges.find((e) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) return false;
    const dy = b.y + b.h / 2 - (a.y + a.h / 2);
    const dx = b.x + b.w / 2 - (a.x + a.w / 2);
    // SNETT nedåt: både annan rad och annan kolumn – det svåra fallet.
    return Math.abs(dy) > a.h / 2 + b.h / 2 && Math.abs(dx) > a.w / 2 + b.w / 2;
  })!;
  const b = byId.get(kant.target)!;

  // Regeln gäller ANKOMSTEN: pilen ska sluta i målets ovansida. Var den
  // lämnar källan är en annan fråga (se nästa test).
  const pts = pathTo(svg, b.x + b.w / 2, b.y)!;
  expect(pts, "ingen path slutar i målets ovansida").toBeTruthy();
  expect(ärOrtogonal(pts)).toBe(true);
  // …och ingen path får sluta i målets vänster- eller högersida.
  expect(pathTo(svg, b.x, b.y + b.h / 2), "en pil går in i vänstersidan").toBeUndefined();
  expect(pathTo(svg, b.x + b.w, b.y + b.h / 2), "en pil går in i högersidan").toBeUndefined();
});

it("annan rad ⇒ topp↔botten, oavsett hur många kolumner åt sidan", () => {
  // Regeln får inte kompletteras med ett kolumnkrav: ligger målet en rad ner
  // gäller botten→topp även när det ligger långt åt sidan (en Nej-gren).
  const över = { x: 100, y: 0, w: 140, h: 56 };
  const under = { x: 110, y: 140, w: 140, h: 56 };
  expect(pickEdgeSides(över, under)).toEqual(["bottom", "top"]);
  expect(pickEdgeSides(under, över)).toEqual(["top", "bottom"]);

  const snettUnder = { x: 900, y: 140, w: 140, h: 56 };
  expect(pickEdgeSides(över, snettUnder)).toEqual(["bottom", "top"]);

  // Samma rad, sida vid sida: sida↔sida som förut.
  const höger = { x: 400, y: 0, w: 140, h: 56 };
  expect(pickEdgeSides(över, höger)).toEqual(["right", "left"]);
});

it("REGRESSION: startpilen lämnar SIDAN, inte bottnen, mot nästa kolumn", () => {
  // Felbeteendet: start-eventet ligger i aktörens bana och första aktiviteten
  // en bana ner och en kolumn åt höger. Pilen gick ut ur bottnen, vek av i
  // sidled precis i banskiljaren och föll ner i toppen – ett L som såg ut att
  // följa banans kant i stället för flödet. Målsidan är oförändrad (den
  // fastslagna regeln): den kommer uppifrån och går in i OVANSIDAN.
  const start = { x: 100, y: 0, w: 40, h: 40 };
  const första = { x: 240, y: 90, w: 140, h: 50 };
  expect(pickEdgeSides(start, första)).toEqual(["right", "top"]);

  // En GREN (kanten bär en etikett) lämnar fortfarande bottnen – annars delar
  // beslutets Ja och Nej samma port och ligger omlott en bit.
  expect(pickEdgeSides(start, första, { label: "Nej" })).toEqual(["bottom", "top"]);

  // Långt bort åt sidan: bottnen igen, annars går pilen rakt in i raden emellan.
  expect(pickEdgeSides(start, { ...första, x: 1400 })).toEqual(["bottom", "top"]);

  // Bakåt (målet till vänster): bottnen, av samma skäl.
  expect(pickEdgeSides({ x: 900, y: 0, w: 40, h: 40 }, första)).toEqual(["bottom", "top"]);
});

it("horisontellt dominant kant lämnar sidan och möter vänstersidan", () => {
  const M = parseToModel(LONG);
  const lo = layoutModel(M);
  const svg = renderSvg(M, lo);
  const byId = new Map(lo.nodes.map((n) => [n.node.id, n]));
  const e = M.edges[0];
  const a = byId.get(e.source)!;
  const b = byId.get(e.target)!;

  const pts = pathFrom(svg, a.x + a.w, a.y + a.h / 2)!; // lämnar höger
  expect(pts).toBeTruthy();
  const sista = pts[pts.length - 1];
  expect(sista[0]).toBeCloseTo(b.x, 0); // in i vänstersidan
  expect(sista[1]).toBeCloseTo(b.y + b.h / 2, 0);
});

it("manuellt valda sidor styr anslutningen före geometriregeln", () => {
  const M = parseToModel(LONG);
  const lo = layoutModel(M);
  const byId = new Map(lo.nodes.map((n) => [n.node.id, n]));
  const e = M.edges[0];
  const a = byId.get(e.source)!;
  const b = byId.get(e.target)!;

  const withSides = {
    ...M,
    edges: M.edges.map((x, i) =>
      i === 0 ? { ...x, sourceSide: "top" as const, targetSide: "bottom" as const } : x,
    ),
  };
  const svg = renderSvg(withSides, lo);
  const pts = pathFrom(svg, a.x + a.w / 2, a.y)!; // lämnar toppen
  expect(pts, "kanten lämnar inte toppen").toBeTruthy();
  const sista = pts[pts.length - 1];
  expect(sista[0]).toBeCloseTo(b.x + b.w / 2, 0); // möter botten
  expect(sista[1]).toBeCloseTo(b.y + b.h, 0);
});

it("draw.io-stilen får exit/entry för VARJE sekvenskant (samma sidoregel som skärmen)", () => {
  // Tidigare skrevs sidor bara ut när de valts manuellt – draw.io valde själv
  // för resten, och filen kunde ansluta till andra nodkanter än diagrammet på
  // skärmen. Nu låses varje kant till pickEdgeSides-resultatet.
  const M = parseToModel(LONG);
  const plain = toDrawioXml(M);
  const kanter = M.edges.filter((e) => M.nodes.some((n) => n.id === e.source));
  expect(plain.match(/exitX=/g)?.length).toBe(kanter.length);
  expect(plain.match(/entryX=/g)?.length).toBe(kanter.length);
  // Rak vänster→höger-kedja: kanterna lämnar höger (exitX=1) och möter vänster.
  expect(plain).toContain("exitX=1;exitY=0.5;exitDx=0;exitDy=0;");
  expect(plain).toContain("entryX=0;entryY=0.5;entryDx=0;entryDy=0;");

  const withSides = {
    ...M,
    edges: M.edges.map((x, i) =>
      i === 0 ? { ...x, sourceSide: "top" as const, targetSide: "bottom" as const } : x,
    ),
  };
  const xml = toDrawioXml(withSides);
  // Det manuella valet vinner för sin kant.
  expect(xml).toContain("exitX=0.5;exitY=0;exitDx=0;exitDy=0;");
  expect(xml).toContain("entryX=0.5;entryY=1;entryDx=0;entryDy=0;");
});

it("draw.io skriver ut en manuell brytpunkt som waypoint", () => {
  const M = parseToModel(LONG);
  const medWp = {
    ...M,
    edges: M.edges.map((x, i) => (i === 0 ? { ...x, waypoint: { x: 111, y: 222 } } : x)),
  };
  const xml = toDrawioXml(medWp);
  // titleH=40 adderas på y i fri layout (dx=dy=0).
  expect(xml).toContain(`<Array as="points"><mxPoint x="111" y="262"/></Array>`);
});

it("draw.io mappar vänster/höger till rätt kopplingspunkt", () => {
  const M = parseToModel(LONG);
  const withSides = {
    ...M,
    edges: M.edges.map((x, i) =>
      i === 0 ? { ...x, sourceSide: "left" as const, targetSide: "right" as const } : x,
    ),
  };
  const xml = toDrawioXml(withSides);
  expect(xml).toContain("exitX=0;exitY=0.5;exitDx=0;exitDy=0;");
  expect(xml).toContain("entryX=1;entryY=0.5;entryDx=0;entryDy=0;");
});
