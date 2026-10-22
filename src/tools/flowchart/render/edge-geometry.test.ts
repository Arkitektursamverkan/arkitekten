import { describe, expect, it } from "vitest";
import {
  autoSides,
  hitBox,
  nearestSide,
  portPoint,
  sidePos,
  snäppPunkt,
  KOPPLINGSPUNKTER,
  type Box,
} from "./edge-geometry";
import { pickEdgeSides } from "../layout/edge-router";

const A: Box = { id: "a", x: 100, y: 100, w: 100, h: 60 };
const B: Box = { id: "b", x: 400, y: 100, w: 100, h: 60 };
const C: Box = { id: "c", x: 100, y: 400, w: 100, h: 60 };

describe("portPoint", () => {
  it("ger mittpunkten på varje sida", () => {
    expect(portPoint(A, "top")).toEqual({ x: 150, y: 100 });
    expect(portPoint(A, "bottom")).toEqual({ x: 150, y: 160 });
    expect(portPoint(A, "left")).toEqual({ x: 100, y: 130 });
    expect(portPoint(A, "right")).toEqual({ x: 200, y: 130 });
  });
});

describe("nearestSide", () => {
  it("väljer sidan man drar mot", () => {
    expect(nearestSide(A, { x: 150, y: 60 })).toBe("top");
    expect(nearestSide(A, { x: 150, y: 220 })).toBe("bottom");
    expect(nearestSide(A, { x: 40, y: 130 })).toBe("left");
    expect(nearestSide(A, { x: 260, y: 130 })).toBe("right");
  });

  it("fungerar även när pekaren är inuti rutan", () => {
    // Nära ovankanten inuti rutan → toppen.
    expect(nearestSide(A, { x: 150, y: 105 })).toBe("top");
    // Nära högerkanten inuti rutan → höger.
    expect(nearestSide(A, { x: 195, y: 130 })).toBe("right");
  });

  it("är stabil i hörnen (ger en av de två närmaste sidorna)", () => {
    expect(["top", "left"]).toContain(nearestSide(A, { x: 100, y: 100 }));
  });
});

describe("hitBox", () => {
  it("träffar rutan pekaren är inuti", () => {
    expect(hitBox([A, B, C], { x: 150, y: 130 })?.id).toBe("a");
    expect(hitBox([A, B, C], { x: 450, y: 130 })?.id).toBe("b");
  });

  it("tar närmaste ruta när man missar men är nära", () => {
    expect(hitBox([A, B, C], { x: 220, y: 130 })?.id).toBe("a");
  });

  it("ger null när pekaren är långt från allt", () => {
    expect(hitBox([A, B, C], { x: 1000, y: 1000 })).toBeNull();
  });

  it("respekterar radien", () => {
    const p = { x: 260, y: 130 }; // 60 px till höger om A
    expect(hitBox([A], p, 10)).toBeNull();
    expect(hitBox([A], p, 80)?.id).toBe("a");
  });
});

describe("autoSides – samma ISO 5807-regel som resten av appen", () => {
  it("samma rad → sida mot sida", () => {
    expect(autoSides(A, B)).toEqual({ source: "right", target: "left" });
    expect(autoSides(B, A)).toEqual({ source: "left", target: "right" });
  });

  it("annan rad → botten mot topp", () => {
    expect(autoSides(A, C)).toEqual({ source: "bottom", target: "top" });
    expect(autoSides(C, A)).toEqual({ source: "top", target: "bottom" });
  });

  /**
   * DRAGGHANDTAGET SITTER DÄR PILEN SITTER.
   *
   * `autoSides` bestämmer var ändpunktshandtaget ritas; `pickEdgeSides` bestämmer
   * var pilen ritas. Läser de olika regler hamnar handtaget på en sida där ingen
   * pil finns – man greppar där pilen syns och får inget grepp.
   */
  it("REGRESSION: en GREN lämnar botten, och handtaget följer med dit", () => {
    // Målet ligger snett FRAMÅT nedåt: en vanlig kant går då ut åt sidan, men en
    // gren (kanten bär "Ja"/"Nej") tvingas ut ur botten så att beslutets båda
    // grenar inte delar samma port. Etiketten är det enda som skiljer fallen –
    // och den saknades i anropet, så handtaget sa "höger" om en pil ut ur botten.
    const beslut = { id: "d", x: 100, y: 100, w: 80, h: 52 };
    const nedTillHöger = { id: "n", x: 230, y: 200, w: 120, h: 40 };

    expect(autoSides(beslut, nedTillHöger)).toEqual({ source: "right", target: "top" });
    expect(autoSides(beslut, nedTillHöger, "Nej")).toEqual({ source: "bottom", target: "top" });
    // Samma svar som routern ger för samma kant – det är hela poängen.
    expect(autoSides(beslut, nedTillHöger, "Nej")).toEqual(
      (([source, target]) => ({ source, target }))(
        pickEdgeSides(beslut, nedTillHöger, { label: "Nej" }),
      ),
    );
  });

  it("ett manuellt val vinner alltid över automatiken, även för en gren", () => {
    const beslut = { x: 100, y: 100, w: 80, h: 52 };
    const nedTillHöger = { x: 230, y: 200, w: 120, h: 40 };
    expect(
      pickEdgeSides(beslut, nedTillHöger, { label: "Nej", sourceSide: "right" })[0],
    ).toBe("right");
  });
});

describe("kopplingspunkter längs en sida", () => {
  const ruta = { id: "a", x: 100, y: 200, w: 200, h: 100 };

  /**
   * Kravet: "Jag vill ha fler kopplingspunkter." Fyra mittpunkter räckte inte –
   * t.ex. IT-stödets pil ska kunna fästa 70 % in på aktivitetens underkant, och två
   * pilar till samma sida ska kunna gå bredvid varandra.
   */
  it("portPoint tar en andel längs sidan, med mitten som förval", () => {
    expect(portPoint(ruta, "bottom")).toEqual({ x: 200, y: 300 });
    expect(portPoint(ruta, "bottom", 0.15)).toEqual({ x: 130, y: 300 });
    expect(portPoint(ruta, "bottom", 0.85)).toEqual({ x: 270, y: 300 });
    expect(portPoint(ruta, "left", 0.3)).toEqual({ x: 100, y: 230 });
    expect(portPoint(ruta, "right", 1)).toEqual({ x: 300, y: 300 });
  });

  it("andelen kläms till sidan", () => {
    expect(portPoint(ruta, "top", -3)).toEqual({ x: 100, y: 200 });
    expect(portPoint(ruta, "top", 9)).toEqual({ x: 300, y: 200 });
  });

  it("sidePos är motsatsen – var på sidan en punkt ligger", () => {
    expect(sidePos(ruta, "bottom", { x: 130, y: 300 })).toBeCloseTo(0.15);
    expect(sidePos(ruta, "left", { x: 100, y: 230 })).toBeCloseTo(0.3);
    // Utanför rutan kläms den in i intervallet.
    expect(sidePos(ruta, "bottom", { x: -50, y: 300 })).toBe(0);
    expect(sidePos(ruta, "bottom", { x: 900, y: 300 })).toBe(1);
  });

  it("snäppPunkt lägger en andel på närmaste kopplingspunkt", () => {
    for (const p of KOPPLINGSPUNKTER) expect(snäppPunkt(p)).toBe(p);
    expect(snäppPunkt(0.52)).toBe(0.5);
    expect(snäppPunkt(0.61)).toBe(0.7);
    expect(snäppPunkt(0.44)).toBe(0.5);
    expect(snäppPunkt(0)).toBe(0.15);
    expect(snäppPunkt(1)).toBe(0.85);
  });
});
