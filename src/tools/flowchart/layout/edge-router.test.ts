import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  andelAvPath,
  labelAnchor,
  midOfPath,
  nollställVägcache,
  pointsToPath,
  routeEdge,
  dragbaraSträckor,
  sistaSträckan,
  type Point,
  type Rect,
} from "./edge-router";

/** Skär segmentet p→q rektangelns inre? (för att verifiera att vägen undviker hinder) */
function segmentInsideRect(p: Point, q: Point, r: Rect): boolean {
  // Bara axelräta segment. Kolla om segmentet passerar genom rektangelns inre.
  const x1 = Math.min(p.x, q.x);
  const x2 = Math.max(p.x, q.x);
  const y1 = Math.min(p.y, q.y);
  const y2 = Math.max(p.y, q.y);
  // Marginal 1px inåt så att en väg som tangerar kanten inte räknas som kollision.
  return x2 > r.x + 1 && x1 < r.x + r.w - 1 && y2 > r.y + 1 && y1 < r.y + r.h - 1;
}

function korsar(pts: Point[], obstacles: Rect[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const r of obstacles) {
      if (segmentInsideRect(pts[i], pts[i + 1], r)) return true;
    }
  }
  return false;
}

function ärOrtogonal(pts: Point[]): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  return true;
}

describe("routeEdge", () => {
  it("ger en ortogonal väg utan hinder", () => {
    const pts = routeEdge({
      from: { x: 0, y: 0 },
      fromSide: "right",
      to: { x: 200, y: 0 },
      toSide: "left",
      obstacles: [],
    });
    expect(ärOrtogonal(pts)).toBe(true);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 0 });
  });

  it("går RUNT ett hinder rakt i vägen", () => {
    // Ett objekt mitt emellan start och mål på samma linje.
    const hinder: Rect = { x: 80, y: -30, w: 60, h: 60 };
    const pts = routeEdge({
      from: { x: 0, y: 0 },
      fromSide: "right",
      to: { x: 220, y: 0 },
      toSide: "left",
      obstacles: [hinder],
    });
    expect(ärOrtogonal(pts)).toBe(true);
    expect(korsar(pts, [hinder])).toBe(false);
    // Vägen måste ha svängt (fler än två punkter) för att ta sig runt.
    expect(pts.length).toBeGreaterThan(2);
  });

  it("undviker flera hinder", () => {
    const hinder: Rect[] = [
      { x: 80, y: -40, w: 50, h: 50 },
      { x: 80, y: 20, w: 50, h: 50 },
      { x: 180, y: -20, w: 50, h: 50 },
    ];
    const pts = routeEdge({
      from: { x: 0, y: 0 },
      fromSide: "right",
      to: { x: 320, y: 0 },
      toSide: "left",
      obstacles: hinder,
    });
    expect(ärOrtogonal(pts)).toBe(true);
    expect(korsar(pts, hinder)).toBe(false);
  });

  it("börjar och slutar på de angivna portarna", () => {
    const pts = routeEdge({
      from: { x: 10, y: 10 },
      fromSide: "bottom",
      to: { x: 100, y: 200 },
      toSide: "top",
      obstacles: [{ x: 40, y: 80, w: 40, h: 40 }],
    });
    expect(pts[0]).toEqual({ x: 10, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 200 });
    // Första segmentet lämnar nedåt (bottom-porten).
    expect(pts[1].x).toBe(10);
    expect(pts[1].y).toBeGreaterThan(10);
  });

  it("är deterministisk", () => {
    const req = {
      from: { x: 0, y: 0 },
      fromSide: "right" as const,
      to: { x: 200, y: 60 },
      toSide: "left" as const,
      obstacles: [{ x: 90, y: 20, w: 40, h: 40 }],
    };
    expect(routeEdge(req)).toEqual(routeEdge(req));
  });
});

describe("pointsToPath", () => {
  it("gör en SVG-path av punkter", () => {
    expect(pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }])).toBe(
      "M0.0,0.0 L10.0,0.0 L10.0,20.0",
    );
  });

  /**
   * Rundade hörn (affärsprocessens rityta). Vad som låses här:
   *  - utan radie är strängen ORÖRD – flödesschemat behåller sina räta vinklar,
   *  - ändpunkterna flyttas aldrig: pilspetsen måste möta rutan på samma ställe,
   *  - radien kapas mot segmenten, så ett kort ben ger en mindre båge i stället
   *    för en båge som äter upp nästa hörn,
   *  - en rak fortsättning får ingen båge alls.
   */
  describe("rundade hörn", () => {
    const bana = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];

    it("radie 0 ger exakt samma väg som förut", () => {
      expect(pointsToPath(bana, 0)).toBe(pointsToPath(bana));
    });

    it("hörnet blir en båge, och ändpunkterna står stilla", () => {
      const d = pointsToPath(bana, 8);
      expect(d.startsWith("M0.0,0.0")).toBe(true);
      expect(d.endsWith("L100.0,100.0")).toBe(true);
      expect(d).toContain("A8.0,8.0");
      // Bågen börjar en radie FÖRE hörnet och slutar en radie EFTER det.
      expect(d).toContain("L92.0,0.0");
      expect(d).toContain("100.0,8.0");
      // Själva hörnpunkten ritas inte längre.
      expect(d).not.toContain("L100.0,0.0");
    });

    it("kapas mot det kortaste benet – aldrig längre än halva", () => {
      const trångt = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 100 },
      ];
      const d = pointsToPath(trångt, 20);
      expect(d).toContain("A5.0,5.0");
    });

    it("tre punkter på rak linje ger ingen båge", () => {
      const rakt = [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ];
      expect(pointsToPath(rakt, 8)).not.toContain("A");
    });

    it("svänger åt rätt håll – båda hållen ger olika sweep", () => {
      const höger = pointsToPath(
        [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
        8,
      );
      const vänster = pointsToPath(
        [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -100 }],
        8,
      );
      expect(höger).toContain("0,1");
      expect(vänster).toContain("0,0");
    });
  });
});

describe("kollisionsundvikande i verkliga flöden", () => {
  it("inga sekvensflöden korsar en nod i felanmälan eller beställning", async () => {
    const fs = await import("node:fs");
    const { compileDraft } = await import("@/core/draft");
    const { layoutModel } = await import("@/tools/flowchart/layout/layout");
    const port = (n: any, s: string) => {
      const { x, y, w, h } = n;
      return s === "top" ? { x: x + w / 2, y }
        : s === "bottom" ? { x: x + w / 2, y: y + h }
        : s === "left" ? { x, y: y + h / 2 }
        : { x: x + w, y: y + h / 2 };
    };
    for (const f of ["felanmalan-ny", "bestallning-ny"]) {
      const path = `flows/${f}.json`;
      if (!fs.existsSync(path)) continue;
      const m = compileDraft(JSON.parse(fs.readFileSync(path, "utf8")).draft);
      const lo = layoutModel(m);
      const byId = new Map(lo.nodes.map((n: any) => [n.node.id, n]));
      const H = lo.nodes.map((n: any) => ({ id: n.node.id, r: { x: n.x, y: n.y, w: n.w, h: n.h } }));
      let korsar = 0;
      for (const e of m.edges) {
        const a = byId.get(e.source); const b = byId.get(e.target);
        if (!a || !b) continue;
        // En manuell brytpunkt ÄGER vägen (den får korsa – användarens val).
        if (e.waypoint) continue;
        // Har användaren dragit objekt så att de ÖVERLAPPAR varandra (eller
        // kantens ändnoder) kan routern inte undvika dem – pilen måste nå sin
        // nod genom klungan. Sådana hinder undantas ur mätningen; motorns egna
        // utlägg överlappar aldrig, så regeln förblir skarp där den ska vara.
        // Marginalen (routerns CLEARANCE ≈ 10 px) räknas in: två objekt som
        // användaren lagt några pixlar isär lämnar ingen korridor att routa i.
        const M = 12;
        const överlappar = (p: any, q: any) =>
          p.x < q.x + q.w + M && p.x + p.w + M > q.x && p.y < q.y + q.h + M && p.y + p.h + M > q.y;
        const oundvikliga = new Set(
          H.filter(
            (h: any) =>
              överlappar(h.r, a) ||
              överlappar(h.r, b) ||
              H.some((andra: any) => andra.id !== h.id && överlappar(h.r, andra.r)),
          ).map((h: any) => h.id),
        );
        const dx = b.x + b.w / 2 - (a.x + a.w / 2);
        const dy = b.y + b.h / 2 - (a.y + a.h / 2);
        const diff = Math.abs(dy) > a.h / 2 + b.h / 2;
        let sa = diff ? (dy >= 0 ? "bottom" : "top") : (dx >= 0 ? "right" : "left");
        let sb = diff ? (dy >= 0 ? "top" : "bottom") : (dx >= 0 ? "left" : "right");
        if (e.sourceSide) sa = e.sourceSide; if (e.targetSide) sb = e.targetSide;
        const hinder = H.filter((h: any) => h.id !== e.source && h.id !== e.target).map((h: any) => h.r);
        const mätbara = H.filter(
          (h: any) => h.id !== e.source && h.id !== e.target && !oundvikliga.has(h.id),
        ).map((h: any) => h.r);
        const pts = routeEdge({ from: port(a, sa), fromSide: sa as any, to: port(b, sb), toSide: sb as any, obstacles: hinder });
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          for (const r of mätbara) {
            const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y);
            if (x2 > r.x + 2 && x1 < r.x + r.w - 2 && y2 > r.y + 2 && y1 < r.y + r.h - 2) korsar++;
          }
        }
      }
      expect(korsar, `${f} har ${korsar} korsande kanter`).toBe(0);
    }
  });

  describe("manuell brytpunkt (via)", () => {
    /** Ligger någon punkt i polylinjen på (nära) den givna punkten? */
    const passerar = (pts: Point[], p: Point) =>
      pts.some((q) => Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5);

    it("går rakt genom brytpunkten med räta vinklar", () => {
      const via = { x: 120, y: 90 };
      const pts = routeEdge({
        from: { x: 0, y: 0 },
        fromSide: "right",
        to: { x: 240, y: 0 },
        toSide: "left",
        obstacles: [],
        via,
      });
      expect(ärOrtogonal(pts)).toBe(true);
      expect(passerar(pts, via), "vägen passerar brytpunkten").toBe(true);
    });

    it("ignorerar automatisk väjning – tar den sida användaren pekat ut", () => {
      // Ett hinder rakt i vägen. UTAN via väjer routern (åt något håll); MED en via
      // på hindrets HÖGERsida ska vägen gå där, även om det korsar hindret – för
      // användaren äger vägen. Vi verifierar att brytpunkten styr, inte routern.
      const hinder: Rect[] = [{ x: 100, y: -30, w: 60, h: 60 }];
      const viaHöger = { x: 200, y: 80 };
      const pts = routeEdge({
        from: { x: 0, y: 0 },
        fromSide: "right",
        to: { x: 300, y: 0 },
        toSide: "left",
        obstacles: hinder,
        via: viaHöger,
      });
      expect(ärOrtogonal(pts)).toBe(true);
      expect(passerar(pts, viaHöger)).toBe(true);
      // Vägen ska nå längst ned till via.y (80), vilket den auto-routade inte gör.
      expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThanOrEqual(80);
    });

    it("REGRESSION: stubben skjuter inte förbi en NÄRLIGGANDE brytpunkt", () => {
      // Stubben (14 px) finns för att pilen ska lämna objektet rakt ut. Ligger
      // brytpunkten närmare än så gick vägen först UT till stubben och sedan
      // TILLBAKA upp till punkten – en spik på några pixlar som läses som ett
      // ritfel. Syntes när man bytte kopplingssida på målet och en gammal
      // brytpunkt låg strax under källan.
      const pts = routeEdge({
        from: { x: 100, y: 100 },
        fromSide: "bottom",
        to: { x: 300, y: 200 },
        toSide: "top",
        obstacles: [],
        via: { x: 160, y: 109 }, // bara 9 px nedanför porten
      });
      expect(ärOrtogonal(pts)).toBe(true);
      // Ingen punkt får ligga NEDANFÖR brytpunkten på vägen dit – det vore spiken.
      const påVägDit = pts.slice(0, pts.findIndex((q) => q.y === 109) + 1);
      expect(Math.max(...påVägDit.map((q) => q.y))).toBe(109);
      // …och avgången är fortfarande lodrät, som portens axel kräver.
      expect(pts[0].x).toBe(pts[1].x);
    });

    it("en brytpunkt BAKOM porten behåller hela stubben – avgången måste vara axiell", () => {
      // Utan riktningskontroll kapades stubben till noll när punkten låg i höjd
      // med porten, och vägen lämnade objektet i SIDLED i stället för rakt ut.
      const pts = routeEdge({
        from: { x: 100, y: 100 },
        fromSide: "bottom",
        to: { x: 300, y: 200 },
        toSide: "top",
        obstacles: [],
        via: { x: 160, y: 100 }, // exakt i portens höjd
      });
      expect(pts[0].x).toBe(pts[1].x); // lodrät avgång
      expect(pts[1].y).toBeGreaterThan(pts[0].y);
    });
  });
});

describe("REGRESSION: pilspetsen möter alltid porten längs portens axel", () => {
  // Sidoregeln har varit rätt länge – men ANKOMSTEN kunde ändå bli fel: när
  // A*:s stubbförsök misslyckades siktade reserven direkt på porten, sista
  // segmentet kom in i sidled, och pilspetsen (orient=auto) pekade åt höger
  // in i en topp-port. Rättad tre gånger på symptomnivå; nu är riktningen en
  // INVARIANT i routern och låst här, över alla riktiga flöden och format.
  // Innehållet (flows/) ligger inte i git – i en ren klon hoppas testet över.
  it.skipIf(!existsSync("flows"))("gäller varje kant i exempel- och sparade flöden, i alla format", async () => {
    const fs = await import("node:fs");
    const { compileDraft } = await import("@/core/draft");
    const { filterByPerspective } = await import("@/tools/flowchart/perspective");
    const { layoutModel, PAGE_FORMATS } = await import("@/tools/flowchart/layout/layout");
    const { pickEdgeSides } = await import("./edge-router");
    const port = (n: any, s: string) =>
      s === "top" ? { x: n.x + n.w / 2, y: n.y }
      : s === "bottom" ? { x: n.x + n.w / 2, y: n.y + n.h }
      : s === "left" ? { x: n.x, y: n.y + n.h / 2 }
      : { x: n.x + n.w, y: n.y + n.h / 2 };

    const flöden: any[] = [];
    for (const f of ["felanmalan-ny", "bestallning-ny", "felanmalan-forandring"]) {
      const p = `flows/${f}.json`;
      if (fs.existsSync(p)) flöden.push(JSON.parse(fs.readFileSync(p, "utf8")).draft);
    }
    /** Både AVGÅNG och ANKOMST ska följa portens axel, åt rätt håll. */
    const kontrolleraVäg = (pts: any[], sa: string, sb: string, namn: string) => {
      const först = pts[0], andra = pts[1];
      const utLodrät = Math.abs(andra.x - först.x) < 0.01;
      if (sa === "top") {
        expect(utLodrät, `${namn}: avgången ska vara lodrät`).toBe(true);
        expect(andra.y, `${namn}: pilen ska lämna UPPÅT ur toppen`).toBeLessThan(först.y);
      } else if (sa === "bottom") {
        expect(utLodrät, `${namn}: avgången ska vara lodrät`).toBe(true);
        expect(andra.y, `${namn}: pilen ska lämna NEDÅT ur underkanten`).toBeGreaterThan(först.y);
      } else if (sa === "left") {
        expect(!utLodrät, `${namn}: avgången ska vara vågrät`).toBe(true);
        expect(andra.x, `${namn}: pilen ska lämna åt VÄNSTER`).toBeLessThan(först.x);
      } else {
        expect(!utLodrät, `${namn}: avgången ska vara vågrät`).toBe(true);
        expect(andra.x, `${namn}: pilen ska lämna åt HÖGER`).toBeGreaterThan(först.x);
      }
      const sist = pts[pts.length - 1], näst = pts[pts.length - 2];
      const inLodrät = Math.abs(sist.x - näst.x) < 0.01;
      if (sb === "top") {
        expect(inLodrät, `${namn}: sista segmentet ska vara lodrätt`).toBe(true);
        expect(näst.y, `${namn}: pilen ska komma UPPIFRÅN`).toBeLessThan(sist.y);
      } else if (sb === "bottom") {
        expect(inLodrät, `${namn}: sista segmentet ska vara lodrätt`).toBe(true);
        expect(näst.y, `${namn}: pilen ska komma NEDIFRÅN`).toBeGreaterThan(sist.y);
      } else if (sb === "left") {
        expect(!inLodrät, `${namn}: sista segmentet ska vara vågrätt`).toBe(true);
        expect(näst.x, `${namn}: pilen ska komma från VÄNSTER`).toBeLessThan(sist.x);
      } else {
        expect(!inLodrät, `${namn}: sista segmentet ska vara vågrätt`).toBe(true);
        expect(näst.x, `${namn}: pilen ska komma från HÖGER`).toBeGreaterThan(sist.x);
      }
    };

    let kontrollerade = 0;
    for (const draft of flöden) {
      const model = filterByPerspective(compileDraft(draft), "system");
      for (const bredd of [null, PAGE_FORMATS.word.width, 1600, 1000]) {
        const lo = layoutModel(model, { pageWidth: bredd });
        const byId = new Map(lo.nodes.map((n: any) => [n.node.id, n]));
        const lager = new Map(lo.dataStores.map((d: any) => [d.store.id, d]));
        const H = lo.nodes.map((n: any) => ({ id: n.node.id, r: { x: n.x, y: n.y, w: n.w, h: n.h } }));
        for (const e of model.edges) {
          const a: any = byId.get(e.source), b: any = byId.get(e.target);
          if (!a || !b || a.page !== b.page) continue;
          const [sa, sb] = pickEdgeSides(a, b, e);
          const hinder = H.filter((h: any) => h.id !== e.source && h.id !== e.target).map((h: any) => h.r);
          const via = e.waypoint ? { x: e.waypoint.x + a.dx, y: e.waypoint.y + a.dy } : null;
          const pts = routeEdge({ from: port(a, sa), fromSide: sa as any, to: port(b, sb), toSide: sb as any, obstacles: hinder, via });
          kontrolleraVäg(pts, sa, sb, `${e.source}->${e.target} bredd ${bredd}`);
          kontrollerade++;
        }
        // Streckade dataassociationer följer SAMMA invariant – "Loggpost
        // skrivs" fick sin pil ut ur TOPPEN fast läsaren stod nedanför.
        for (const da of model.dataAssociations) {
          const nod: any = byId.get(da.nodeId), ds: any = lager.get(da.dataStoreId);
          if (!nod || !ds || nod.page !== ds.page) continue;
          const källa = da.direction === "write" ? nod : ds;
          const mål = da.direction === "write" ? ds : nod;
          const [sa, sb] = pickEdgeSides(källa, mål, { sourceSide: da.sourceSide, targetSide: da.targetSide });
          const hinder = H.filter((h: any) => h.id !== da.nodeId && h.id !== da.dataStoreId).map((h: any) => h.r);
          const pts = routeEdge({ from: port(källa, sa), fromSide: sa as any, to: port(mål, sb), toSide: sb as any, obstacles: hinder });
          kontrolleraVäg(pts, sa, sb, `DA ${da.nodeId}~${da.dataStoreId} (${da.direction}) bredd ${bredd}`);
          kontrollerade++;
        }
      }
    }
    expect(kontrollerade).toBeGreaterThan(50);
  });
});

describe("REGRESSION: decimalkoordinater knäcker inte A*", () => {
  it("en port med decimaler routar RUNT hindret, inte genom det", () => {
    // Manuellt dragna objekt ger decimalkoordinater (y=538.767…). Rutnätets
    // linjer avrundas, porten gjorde det inte – A* hittade inga grannar och
    // gav upp TYST. Nödvägen tog över och plöjde genom objekt eller loopade
    // vänster. Exakt reprot ur Beställning - ny.
    const hinder: Rect = { x: 1894, y: 538.767356453926, w: 132, h: 54 };
    const pts = routeEdge({
      from: { x: 881.317515711115, y: 536.9816601827143 },
      fromSide: "bottom",
      to: { x: 2368, y: 538.767356453926 },
      toSide: "top",
      obstacles: [hinder],
    });
    expect(ärOrtogonal(pts)).toBe(true);
    expect(korsar(pts, [hinder]), "vägen plöjde genom hindret").toBe(false);
  });

  it("FRAMÅTREGELN: omvägen tas på HÖGER sida när målet ligger till höger", () => {
    // Ett hinder rakt i vägen mellan två objekt på samma rad: routern ska
    // passera på högersidan (i läsriktningen), inte backa vänster runt.
    const hinder: Rect = { x: 200, y: -40, w: 60, h: 80 };
    const pts = routeEdge({
      from: { x: 100, y: 0 },
      fromSide: "right",
      to: { x: 400, y: 0 },
      toSide: "left",
      obstacles: [hinder],
    });
    expect(korsar(pts, [hinder])).toBe(false);
    // Ingen punkt får ligga till vänster om startporten – det vore en backning.
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(100);
  });
});

describe("REGRESSION: en pixels skillnad ger inget hack", () => {
  /**
   * Två motstående portar som ligger nästan – men inte exakt – på samma linje
   * fick routern att svara med ett litet hack strax före målet: segmenten mätte
   * [97, 1, 14]. "Typ varannan koppling är krokig på något ställe"
   * (2026-09-08, 4.4.6). Bruset kommer ur att symbolens mitt sitter olika långt
   * ner i rutan för olika sorter och att koordinater skalas med en bråkdel
   * innan de avrundas.
   */
  const raka = (pts: Point[], axel: "x" | "y") =>
    pts.every((p) => Math.abs(p[axel] - pts[0][axel]) < 0.001);

  it("vågrätt: en pixels höjdskillnad rätas till ett rakt streck", () => {
    const pts = routeEdge({
      from: { x: 0, y: 276.5 },
      fromSide: "right",
      to: { x: 200, y: 278 },
      toSide: "left",
      obstacles: [],
    });
    expect(pts.length, `fick ${pts.length} punkter: ${JSON.stringify(pts)}`).toBe(2);
    expect(raka(pts, "y"), "strecket är inte vågrätt").toBe(true);
  });

  it("lodrätt: samma sak mellan botten och topp", () => {
    const pts = routeEdge({
      from: { x: 118.5, y: 0 },
      fromSide: "bottom",
      to: { x: 120, y: 200 },
      toSide: "top",
      obstacles: [],
    });
    expect(pts.length).toBe(2);
    expect(raka(pts, "x"), "strecket är inte lodrätt").toBe(true);
  });

  /**
   * REGRESSION: samma pixel, fast i BRYTPUNKTEN. En sparad punkt på y=416
   * mot en port på y=415 gav svansen ett hack: vägen gick fram till målets
   * höjd, en pixel fel, och routern la till två böjar för att komma in.
   * "Information diarieförd → Avslutar ärende" i 4.4.3 ritades med fyra böjar
   * där två räcker ("linjerna går fortfarande i svängar", 2026-09-09).
   */
  it("REGRESSION: en brytpunkt en pixel från portens linje snäpper dit", () => {
    const pts = routeEdge({
      from: { x: 0, y: 128 },
      fromSide: "right",
      to: { x: 400, y: 0 },
      toSide: "left",
      obstacles: [],
      via: { x: 60, y: 1 },
    });
    // Ut, upp, in – två böjar, inte fyra.
    expect(pts.length, `fick ${JSON.stringify(pts)}`).toBe(4);
    expect(pts[pts.length - 1].y).toBe(0);
    expect(pts[pts.length - 2].y).toBe(0);
  });

  it("en brytpunkt som ligger en bit ifrån rörs inte – den är ett val", () => {
    const pts = routeEdge({
      from: { x: 0, y: 128 },
      fromSide: "right",
      to: { x: 400, y: 0 },
      toSide: "left",
      obstacles: [],
      via: { x: 60, y: 40 },
    });
    expect(pts.some((p) => Math.abs(p.y - 40) < 0.001)).toBe(true);
  });

  it("en RIKTIG förskjutning rätas INTE – ett L ska förbli ett L", () => {
    const pts = routeEdge({
      from: { x: 0, y: 0 },
      fromSide: "right",
      to: { x: 200, y: 60 },
      toSide: "left",
      obstacles: [],
    });
    expect(pts.length).toBeGreaterThan(2);
    expect(pts[0].y).toBe(0);
    expect(pts[pts.length - 1].y).toBe(60);
  });

  it("en DRAGEN brytpunkt äger vägen – portarna rörs inte", () => {
    const pts = routeEdge({
      from: { x: 0, y: 0 },
      fromSide: "right",
      to: { x: 200, y: 2 },
      toSide: "left",
      obstacles: [],
      via: { x: 100, y: 90 },
    });
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 2 });
  });

  it("MOTSATTA sidor krävs: höger→topp är ett L och rörs inte", () => {
    const pts = routeEdge({
      from: { x: 0, y: 0 },
      fromSide: "right",
      to: { x: 200, y: 2 },
      toSide: "top",
      obstacles: [],
    });
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 2 });
  });
});

describe("etikettens ankare", () => {
  /** En svängd gren: kort stump ut, lång nedgång, lång insträckning i mål. */
  const SVÄNGD: Point[] = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 200 },
    { x: 240, y: 200 },
  ];

  it("REGRESSION: etiketten hamnar på ett RAKT VÅGRÄTT segment, inte i böjen", () => {
    // Felbeteendet: mitten av vägens LÄNGD låg mitt på den lodräta nedgången,
    // alltså tätt inpå gatewayen och på ett annat sorts segment än den raka
    // Ja-grenens etikett. Två grenar från samma beslut såg då ut att vara
    // placerade efter olika regler.
    expect(midOfPath(SVÄNGD)).toEqual({ x: 40, y: 180 }); // gamla läget: i böjen
    expect(labelAnchor(SVÄNGD)).toEqual({ x: 140, y: 200 }); // mitt på det vågräta
  });

  it("en rak väg får sin etikett mitt på – som förut", () => {
    const rak: Point[] = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ];
    expect(labelAnchor(rak)).toEqual({ x: 150, y: 0 });
  });

  it("användarens egen andel går före regeln", () => {
    // Vägens längd är 40 + 200 + 200 = 440. Andel 0.5 ⇒ 220 in ⇒ i böjen.
    expect(labelAnchor(SVÄNGD, 0.5)).toEqual(midOfPath(SVÄNGD));
    expect(labelAnchor(SVÄNGD, 0)).toEqual({ x: 0, y: 0 });
  });

  it("en dragen etikett sparas som andelen NÄRMAST vägen", () => {
    // Punkten ligger bredvid vägen; andelen är projektionen på närmaste segment.
    const andel = andelAvPath(SVÄNGD, { x: 140, y: 214 });
    expect(andel).toBeCloseTo((40 + 200 + 100) / 440, 3);
    // …och andelen tar tillbaka samma punkt PÅ vägen.
    const p = labelAnchor(SVÄNGD, andel);
    expect(p.x).toBeCloseTo(140, 3);
    expect(p.y).toBeCloseTo(200, 3);
  });
});

describe("pil in i ovansidan mellan två tätt staplade rader", () => {
  it("REGRESSION: går ut, över och NER i porten – ingen krok runt mottagaren", () => {
    // Verklig geometri ur "Utvecklingsförslag – mer information krävs": ett
    // beslut vars Nej-gren ligger en rad ner, med Ja-grenens ruta rakt ovanför
    // mottagaren. Felbeteendet: stubbarna hamnade på olika höjd (14 ut ur
    // botten, men bara ~7 fanns framför toppen), A* kom inte rakt emellan och
    // tog vägen RUNT mottagaren – tvärs genom dess ruta och in i toppen
    // bakvägen. Det såg ut som att pilen kom från fel håll.
    const jaRuta: Rect = { x: 566, y: 107, w: 79, h: 32 };
    const pts = routeEdge({
      from: { x: 478, y: 147 }, // beslutets botten
      fromSide: "bottom",
      to: { x: 606, y: 153 }, // mottagarens topp, 6 px under
      toSide: "top",
      obstacles: [jaRuta],
    });
    expect(ärOrtogonal(pts)).toBe(true);
    expect(pts.length).toBe(4); // ut, över, ner – inget mer
    // Ingen punkt får hamna till höger om mottagarens port: det vore kroken.
    expect(Math.max(...pts.map((p) => p.x))).toBe(606);
    // Vägen dyker aldrig under porten och kommer tillbaka (spiken).
    expect(Math.max(...pts.map((p) => p.y))).toBe(153);
    // Sista stycket är lodrätt = pilspetsen pekar ner i ovansidan.
    expect(pts[pts.length - 2].x).toBe(606);
  });

  it("vanliga avstånd behåller den fasta stubben", () => {
    // Regeln får bara slå till när portarna står tätt: med gott om plats ska
    // vägen se ut som förut (14 px rakt ut innan den svänger).
    const pts = routeEdge({
      from: { x: 100, y: 100 },
      fromSide: "bottom",
      to: { x: 300, y: 400 },
      toSide: "top",
      obstacles: [],
    });
    expect(pts[1]).toEqual({ x: 100, y: 114 }); // 14 rakt ner ur botten
    // Sista stycket är lodrätt in i toppen (stubben smälter ihop med det).
    expect(pts[pts.length - 2].x).toBe(300);
    expect(pts[pts.length - 1]).toEqual({ x: 300, y: 400 });
  });
});

/**
 * SNABBRUTTNINGEN (2026-09-10). Ruttningen räknades om från grunden vid varje
 * omrendering av kantlagret, alltså vid varje musruck under en panorering:
 * 4.4.3 (107 objekt) låste huvudtråden i tiotals sekunder. Tre saker ändrades
 * – rutnätets spärrade punkter markeras per hinder i stället för att prövas
 * per punkt, den öppna mängden i A* är en minhög i stället för en linjärsökt
 * array, och färdiga vägar sparas i en cache.
 *
 * INGET av det får ändra en enda väg. Hela flödesbiblioteket ruttades om och
 * jämfördes väg för väg (9 295 vägar, 0 avvikelser) innan bytet gjordes;
 * testerna här låser de tre ställen där en framtida ändring lättast går fel.
 */
describe("snabbruttningen", () => {
  const portar = {
    from: { x: 0, y: 0 },
    fromSide: "right" as const,
    to: { x: 300, y: 0 },
    toSide: "left" as const,
  };

  it("REGRESSION: cachen svarar aldrig för en ANNAN hinderuppsättning", () => {
    // Samma portar, olika hinder. Nyckeln bär hindren – gjorde den inte det
    // skulle den andra kopplingen få den förstas väg, alltså en pil som går
    // rakt genom ett objekt fast routern räknat rätt.
    nollställVägcache();
    const utan = routeEdge({ ...portar, obstacles: [] });
    const med = routeEdge({ ...portar, obstacles: [{ x: 120, y: -40, w: 60, h: 80 }] });
    expect(korsar(med, [{ x: 120, y: -40, w: 60, h: 80 }])).toBe(false);
    expect(JSON.stringify(med)).not.toBe(JSON.stringify(utan));
    // …och den första vägen finns kvar oförändrad.
    expect(routeEdge({ ...portar, obstacles: [] })).toEqual(utan);
  });

  it("REGRESSION: en hinderruta som FLYTTAS ger en ny väg, inte den cachade", () => {
    // Rutorna kan bära samma antal och nästan samma tal efter ett musdrag.
    // Träffen verifieras därför ruta för ruta, inte bara på hashen.
    nollställVägcache();
    // Båda rutorna ligger i vägen, men olika långt ner: omvägen måste därför
    // gå på olika höjd. Samma antal hinder, nästan samma tal – precis det
    // fall en cache som bara jämför antal skulle svara fel på.
    const mitten: Rect[] = [{ x: 120, y: -40, w: 60, h: 80 }];
    const flyttad: Rect[] = [{ x: 120, y: -70, w: 60, h: 80 }];
    const a = routeEdge({ ...portar, obstacles: mitten });
    const b = routeEdge({ ...portar, obstacles: flyttad });
    expect(korsar(a, mitten)).toBe(false);
    expect(korsar(b, flyttad)).toBe(false);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("REGRESSION: den som får en väg kan ändra i den utan att nästa påverkas", () => {
    // Cachen lämnar ut en KOPIA. Gjorde den inte det räckte det att en enda
    // anropare skrev i punktlistan för att alla andra skulle rita fel.
    nollställVägcache();
    const hinder: Rect[] = [{ x: 120, y: -40, w: 60, h: 80 }];
    const första = routeEdge({ ...portar, obstacles: hinder });
    const original = JSON.parse(JSON.stringify(första)) as Point[];
    första[0].x = 9999;
    första.push({ x: 1, y: 1 });
    expect(routeEdge({ ...portar, obstacles: hinder })).toEqual(original);
  });

  it("REGRESSION: turordningen vid LIKA billiga vägar är oförändrad", () => {
    // Verklig geometri ur 4.4.2 (14 objekt): en kort koppling mellan två
    // aktiviteter på olika rader. Två vägar kostar exakt lika mycket – böjen
    // direkt efter stubben (x=525) eller sent, precis före målet (x=552).
    //
    // Den öppna mängden i A* söktes förut igenom linjärt och tömdes med
    // `splice`, som bevarar ordningen: valet var "ÄLDST av de billigaste".
    // Högen som ersatte sökningen måste välja likadant, och gör det via
    // `seq`. Vänds den tie-breaken byter 709 av bibliotekets 9 295 vägar
    // utseende – utan att någon rört ett enda flöde. Just den här kopplingen
    // är en av dem, och därför står den här.
    nollställVägcache();
    const hinder: Rect[] = [
      { x: 76.8, y: 28.2, w: 36, h: 36 },
      { x: 199.2, y: 107.4, w: 79.2, h: 32.4 },
      { x: 321.6, y: 107.4, w: 79.2, h: 32.4 },
      { x: 566.4, y: 107.4, w: 79.2, h: 32.4 },
      { x: 688.8, y: 107.4, w: 79.2, h: 32.4 },
      { x: 811.2, y: 100.2, w: 67.2, h: 46.8 },
      { x: 933.6, y: 107.4, w: 79.2, h: 32.4 },
      { x: 933.6, y: 153, w: 79.2, h: 32.4 },
    ];
    expect(
      routeEdge({
        from: { x: 511.2, y: 123.6 },
        fromSide: "right",
        to: { x: 566.4, y: 169.2 },
        toSide: "left",
        obstacles: hinder,
      }),
    ).toEqual([
      { x: 511, y: 124 },
      { x: 525, y: 124 }, // böjen ligger vid stubben …
      { x: 525, y: 169 },
      { x: 566, y: 169 },
    ]); // … inte vid x=552, som den lika billiga vägen hade gett.
  });

  it("REGRESSION: en rutnätspunkt PÅ hindrets kant är farbar, en INUTI är spärrad", () => {
    // Spärren markeras numera per hinder över ett indexintervall i stället för
    // att prövas punkt för punkt. Gränserna är STRIKTA – en punkt exakt på
    // kanten hör inte till det inre. Ett intervall som tog med kanten skulle
    // stänga korridorer som routern behöver, och vägen falla ner på reservvägen.
    nollställVägcache();
    const hinder: Rect[] = [{ x: 100, y: -50, w: 100, h: 100 }];
    const pts = routeEdge({
      from: { x: 0, y: 0 },
      fromSide: "right",
      to: { x: 300, y: 0 },
      toSide: "left",
      obstacles: hinder,
    });
    expect(ärOrtogonal(pts)).toBe(true);
    expect(korsar(pts, hinder)).toBe(false);
  });

  it("REGRESSION: ett utlägg i 4.4.3:s storlek ruttas på bråkdelen av en sekund", () => {
    // Vakthund. 100 objekt gav förut 6,8 miljoner rektangeltest PER koppling
    // och drygt 50 ms per väg; hela utlägget tog ~5 s. Taket här är valt med
    // stor marginal – det är storleksordningen som ska larma, inte millisekunder.
    nollställVägcache();
    const hinder: Rect[] = [];
    for (let i = 0; i < 100; i++) {
      hinder.push({ x: (i % 10) * 220, y: Math.floor(i / 10) * 160, w: 120, h: 60 });
    }
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      // Varje koppling har sin egen geometri – cachen kan inte svara.
      routeEdge({
        from: { x: -40, y: i * 3 },
        fromSide: "right",
        to: { x: 2200, y: 900 - i * 3 },
        toSide: "left",
        obstacles: hinder,
      });
    }
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe("andra brytpunkten – sista sträckan in i målet", () => {
  // Källan till HÖGER, målet långt till vänster: en räls under kedjan, som
  // 2.2.1:s "Byter annonstyp" (Bearbetar nästa sökande → Publicerar lägenhet).
  const req = {
    from: { x: 1000, y: 100 },
    fromSide: "right" as const,
    to: { x: 100, y: 100 },
    toSide: "left" as const,
    obstacles: [] as Rect[],
    via: { x: 1040, y: 400 },
  };

  it("REGRESSION: med en brytpunkt låg sista sträckan fast framför målets port – genom målets satelliter – och gick inte att flytta", () => {
    nollställVägcache();
    const en = routeEdge(req);
    // Sista lodräta sträckan ligger på stubbens x, strax framför porten.
    const lodEn = en.filter((p, i) => i > 0 && en[i - 1].x === p.x && en[i - 1].y !== p.y).pop()!;
    expect(lodEn.x).toBeGreaterThan(80);

    const s = sistaSträckan(req.fromSide, req.to, req.toSide)!;
    expect(s.axel).toBe("x");
    const via2 = s.via2({ x: 40, y: 250 });
    expect(via2).toEqual({ x: 40, y: 100 }); // i höjd med målets port
    const två = routeEdge({ ...req, via2 });
    expect(två).toEqual([
      { x: 1000, y: 100 },
      { x: 1040, y: 100 },
      { x: 1040, y: 400 },
      { x: 40, y: 400 },
      { x: 40, y: 100 },
      { x: 100, y: 100 },
    ]);
  });

  it("gäller bara ihop med en första brytpunkt, och bara när portarna har samma axel", () => {
    nollställVägcache();
    const { via: _, ...utan } = req;
    expect(routeEdge({ ...utan, via2: { x: 40, y: 100 } })).toEqual(routeEdge(utan));
    expect(sistaSträckan("bottom", req.to, "left")).toBeNull();
    expect(sistaSträckan("bottom", { x: 50, y: 60 }, "top")!.via2({ x: 999, y: 20 })).toEqual({ x: 50, y: 20 });
  });

  it("cachen skiljer på vägar med och utan andra punkten", () => {
    nollställVägcache();
    const en = routeEdge(req);
    const två = routeEdge({ ...req, via2: { x: 40, y: 100 } });
    expect(två).not.toEqual(en);
  });
});

describe("dragbara sträckor på en manuell väg", () => {
  const req = {
    from: { x: 1000, y: 100 },
    fromSide: "right" as const,
    to: { x: 100, y: 100 },
    toSide: "left" as const,
    obstacles: [] as Rect[],
    via: { x: 1040, y: 400 },
  };

  it("REGRESSION: bara brytpunktens handtag – långt ut till höger – gick att dra; linjerna till vänster gick inte att ta i", () => {
    nollställVägcache();
    const pts = routeEdge(req);
    const grepp = dragbaraSträckor(pts, req);
    expect(grepp.map((g) => g.grepp).sort()).toEqual(["via.x", "via.y", "via2.x"]);
    // Rälsen (via.y) är den vågräta sträckan på brytpunktens höjd.
    const räls = grepp.find((g) => g.grepp === "via.y")!;
    expect(pts[räls.i].y).toBe(400);
    expect(pts[räls.i + 1].y).toBe(400);
    // Sista sträckan är lodrät, framför målets port.
    const sista = grepp.find((g) => g.grepp === "via2.x")!;
    expect(pts[sista.i].x).toBe(pts[sista.i + 1].x);
    expect(sista.i + 1).toBe(pts.length - 2);
  });

  it("med andra punkten satt är sista sträckan fortfarande dragbar", () => {
    nollställVägcache();
    const pts = routeEdge({ ...req, via2: { x: 40, y: 100 } });
    const sista = dragbaraSträckor(pts, req).find((g) => g.grepp === "via2.x")!;
    expect(pts[sista.i].x).toBe(40);
  });

  it("utan egen brytpunkt finns inget att dra", () => {
    nollställVägcache();
    const { via: _, ...utan } = req;
    expect(dragbaraSträckor(routeEdge(utan), utan)).toEqual([]);
  });
});
