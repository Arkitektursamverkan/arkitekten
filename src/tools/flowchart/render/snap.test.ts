import { describe, expect, it } from "vitest";
import { applyAlignment, snapToNeighbours, snapWaypointToEdges, type SnapChange, type SnapNode } from "./snap";

/** Tre objekt: A och C är i lodrät linje (x-mitt 100), B ligger snett. */
const NODES: SnapNode[] = [
  { id: "a", type: "process", position: { x: 60, y: 0 }, width: 80, height: 40 },
  { id: "b", type: "process", position: { x: 300, y: 200 }, width: 80, height: 40 },
  { id: "c", type: "process", position: { x: 60, y: 400 }, width: 80, height: 40 },
  { id: "lane_x", type: "lane", position: { x: 0, y: 0 }, width: 900, height: 500 },
];

describe("snapToNeighbours", () => {
  it("fäster i x-led när mittpunkten är nära en granne", () => {
    // b dras till x=295 → mitt 335. Ingen granne nära → orörd.
    expect(snapToNeighbours("b", { x: 295, y: 200 }, NODES).position.x).toBe(295);
    // b dras till mitt 104 (x=64) → grannarnas mitt är 100, inom toleransen.
    expect(snapToNeighbours("b", { x: 64, y: 200 }, NODES).position.x).toBe(60);
  });

  it("linjerar x och y oberoende av varandra", () => {
    // Nära a i y-led (mitt 20) men långt bort i x-led.
    const res = snapToNeighbours("b", { x: 500, y: 5 }, NODES);
    expect(res.position.x).toBe(500); // orörd
    expect(res.position.y).toBe(0); // fäster mot a:s mitt (20) → y = 20 - 40/2
    expect(res.guides).toEqual({ x: undefined, y: 20 });
  });

  it("väljer närmaste granne när flera är inom toleransen", () => {
    const nära: SnapNode[] = [
      { id: "x", type: "process", position: { x: 0, y: 0 }, width: 10, height: 10 },
      { id: "y", type: "process", position: { x: 8, y: 0 }, width: 10, height: 10 },
      { id: "z", type: "process", position: { x: 100, y: 0 }, width: 10, height: 10 },
    ];
    // z dras så att mitten hamnar på 10; x har mitt 5, y har mitt 13 → y närmast.
    expect(snapToNeighbours("z", { x: 5, y: 0 }, nära).position.x).toBe(8);
  });

  it("linjerar inte mot lanes eller andra hjälpobjekt", () => {
    const res = snapToNeighbours("b", { x: 445, y: 200 }, NODES);
    // Lanens mitt (450) ligger inom toleransen men ska ignoreras.
    expect(res.position.x).toBe(445);
  });

  it("linjerar inte mot sig själv", () => {
    expect(snapToNeighbours("a", { x: 60, y: 0 }, NODES).position).toEqual({ x: 60, y: 0 });
  });

  /**
   * REGRESSION: Shift-linjeringen fanns bara i flödesschemat – i affärsprocessvyn hände
   * ingenting när man höll inne Shift och drog ett objekt. Regeln var låst till
   * nodtypen "process"; affärsprocessobjekten heter "affarsprocess". Typen är nu ett argument, så
   * BÅDA vyerna delar samma regel i stället för att den kopieras.
   */
  it("linjerar mot den nodtyp som anges – affärsprocessvyns objekt heter affarsprocess", () => {
    const apNoder: SnapNode[] = [
      { id: "a", type: "affarsprocess", position: { x: 60, y: 0 }, width: 80, height: 40 },
      { id: "b", type: "affarsprocess", position: { x: 300, y: 200 }, width: 80, height: 40 },
      { id: "frame_0", type: "apframe", position: { x: 0, y: 0 }, width: 900, height: 500 },
    ];
    // Med förvalet "process" är inget av objekten ett mål – inget händer.
    expect(snapToNeighbours("b", { x: 64, y: 200 }, apNoder).position.x).toBe(64);
    // Med "affarsprocess" fäster b i linje med a (mitt 100).
    expect(snapToNeighbours("b", { x: 64, y: 200 }, apNoder, undefined, "affarsprocess").position.x).toBe(60);
    // Sidramen är inte ett linjeringsmål (mitt 450), lika lite som en lane.
    expect(snapToNeighbours("b", { x: 445, y: 200 }, apNoder, undefined, "affarsprocess").position.x).toBe(445);
  });
});

describe("applyAlignment", () => {
  const drag = (dragging: boolean): SnapChange[] => [
    { type: "position", id: "b", position: { x: 64, y: 200 }, dragging },
  ];

  it("linjerar medan draget pågår och visar hjälplinjer", () => {
    const res = applyAlignment(drag(true), NODES, true);
    expect(res.changes[0].position).toEqual({ x: 60, y: 200 });
    expect(res.guides.x).toBe(100);
  });

  it("REGRESSION: linjerar även den sista ändringen vid släpp", () => {
    // Buggen: villkoret krävde dragging=true, så släppet applicerade musens
    // råa läge och objektet hoppade snett trots att linjen visats.
    const res = applyAlignment(drag(false), NODES, true);
    expect(res.changes[0].position).toEqual({ x: 60, y: 200 });
    expect(res.snapped.get("b")).toEqual({ x: 60, y: 200 });
  });

  it("släcker hjälplinjerna vid släpp", () => {
    expect(applyAlignment(drag(false), NODES, true).guides).toEqual({});
  });

  it("rör ingenting när linjeringstangenten inte hålls nere", () => {
    const res = applyAlignment(drag(true), NODES, false);
    expect(res.changes[0].position).toEqual({ x: 64, y: 200 });
    expect(res.snapped.size).toBe(0);
  });

  it("lämnar andra typer av ändringar orörda", () => {
    const changes: SnapChange[] = [{ type: "select", id: "b" }];
    expect(applyAlignment(changes, NODES, true).changes[0]).toBe(changes[0]);
  });
});

describe("snapWaypointToEdges – Shift-linjering av brytpunkter", () => {
  // Två andra kanters vägar: en med vågrätt segment på y=100 (x 0→200),
  // en med lodrätt segment på x=300 (y 0→50).
  const VÄGAR = [
    [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ],
    [
      { x: 300, y: 0 },
      { x: 300, y: 50 },
    ],
  ];

  it("fäster brytpunktens y mot ett vågrätt segment inom toleransen", () => {
    const res = snapWaypointToEdges({ x: 40, y: 106 }, VÄGAR);
    expect(res.position).toEqual({ x: 40, y: 100 });
    expect(res.guides).toEqual({ x: undefined, y: 100 });
  });

  it("fäster brytpunktens x mot ett lodrätt segment", () => {
    const res = snapWaypointToEdges({ x: 295, y: 400 }, VÄGAR);
    expect(res.position.x).toBe(300);
    expect(res.guides.x).toBe(300);
  });

  it("rör ingenting utanför toleransen", () => {
    const res = snapWaypointToEdges({ x: 40, y: 130 }, VÄGAR);
    expect(res.position).toEqual({ x: 40, y: 130 });
    expect(res.guides).toEqual({ x: undefined, y: undefined });
  });

  it("närmaste segmentet vinner", () => {
    const vägar = [
      ...VÄGAR,
      [
        { x: 0, y: 110 },
        { x: 200, y: 110 },
      ],
    ];
    expect(snapWaypointToEdges({ x: 40, y: 107 }, vägar).position.y).toBe(110);
    expect(snapWaypointToEdges({ x: 40, y: 104 }, vägar).position.y).toBe(100);
  });

  it("sneda segment ignoreras (bara raka linjer går att linjera mot)", () => {
    const res = snapWaypointToEdges({ x: 40, y: 100 }, [
      [
        { x: 0, y: 95 },
        { x: 200, y: 105 },
      ],
    ]);
    expect(res.guides).toEqual({ x: undefined, y: undefined });
  });
});
