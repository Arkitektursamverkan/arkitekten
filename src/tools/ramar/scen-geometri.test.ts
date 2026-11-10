/** Pulsernas vägar och bubblornas lägen i bildfliken. */

import { describe, expect, it } from "vitest";
import type { ScenFigur } from "@/core/ram-scen";
import { väglängd } from "./effekt-spec";
import { bubblaLäge, brytRader, pulsVäg, textrutaLäge, ärDragning, ärLjus } from "./scen-geometri";
import { figurRuta } from "./scen-figurer";

const fig = (id: string, x: number, y: number): ScenFigur => ({ id, typ: "hyresgast", namn: id, x, y });

describe("pulsVäg", () => {
  it("börjar och slutar UTANFÖR figurerna – inte mitt i dem", () => {
    const a = fig("a", 200, 500);
    const b = fig("b", 900, 500);
    const [, , w] = figurRuta(a);
    const { d } = pulsVäg(a, b);
    const [sx, , , , ex] = d.match(/-?\d+\.?\d*/g)!.map(Number);
    expect(sx).toBeGreaterThan(200 + w / 2);
    expect(ex).toBeLessThan(900 - w / 2);
  });

  it("buktar uppåt, och fram och tillbaka lägger sig inte ovanpå varandra", () => {
    const a = fig("a", 200, 500);
    const b = fig("b", 900, 500);
    const dit = pulsVäg(a, b);
    const tillbaka = pulsVäg(b, a);
    expect(dit.mitt.y).toBeLessThan(500);
    expect(tillbaka.mitt.y).toBeLessThan(dit.mitt.y);
  });

  it("längden mäts längs bågen, inte kordan – pulsen håller samma fart som i flödet", () => {
    const { d } = pulsVäg(fig("a", 200, 500), fig("b", 900, 500));
    const [sx, sy, , , ex, ey] = d.match(/-?\d+\.?\d*/g)!.map(Number);
    expect(väglängd(d)).toBeGreaterThan(Math.hypot(ex - sx, ey - sy) + 5);
  });
});

describe("pratbubblan", () => {
  it("bryter på ord", () => {
    expect(brytRader("Jag har ett läckande element i köket", 16)).toEqual(["Jag har ett", "läckande element", "i köket"]);
  });

  it("står ovanför figuren och vänder åt vänster vid bildens högerkant", () => {
    const vänster = bubblaLäge(fig("a", 300, 500), "Hej", 1600);
    expect(vänster.y + vänster.h).toBeLessThan(figurRuta(fig("a", 300, 500))[1]);
    const höger = bubblaLäge(fig("a", 1580, 500), "En ganska lång mening här", 1600);
    expect(höger.x + höger.w).toBeLessThanOrEqual(1600);
  });
});

describe("dra en figur", () => {
  it("REGRESSION: figurerna (Kund, Hem, Kontor) gick bara att flytta med verktyget Flytta – med förvalda 'Puls mellan' hände ingenting när man drog", () => {
    // Nedslaget blir en flytt så fort pekaren rört sig; står den still är det
    // ett klick och verktyget (puls, markering, bubbla …) gör sitt.
    expect(ärDragning({ x: 100, y: 100 }, { x: 101, y: 102 })).toBe(false);
    expect(ärDragning({ x: 100, y: 100 }, { x: 110, y: 100 })).toBe(true);
  });
});

describe("textrutan", () => {
  it("bryter texten efter rutans bredd, och blir högre med fler rader", () => {
    const smal = textrutaLäge({ bredd: 240, rubrik: "Dag 1", text: "Tre dagar senare är systemet tillbaka från en backup" });
    const bred = textrutaLäge({ bredd: 900, rubrik: "Dag 1", text: "Tre dagar senare är systemet tillbaka från en backup" });
    expect(smal.rader.length).toBeGreaterThan(bred.rader.length);
    expect(smal.h).toBeGreaterThan(bred.h);
    expect(bred.rubrik).toBe("Dag 1");
  });

  it("en tom ruta har ändå en höjd att klicka på", () => {
    expect(textrutaLäge({ bredd: 520, text: "" }).h).toBeGreaterThanOrEqual(48);
  });
});

describe("textrutans storlek och färger", () => {
  it("en liten ruta är lägre och rymmer fler tecken per rad än en normal med samma bredd", () => {
    const text = "Visning bokad med utbildningsansvarige på tisdag";
    const normal = textrutaLäge({ bredd: 300, rubrik: "Dag 3", text });
    const liten = textrutaLäge({ bredd: 300, rubrik: "Dag 3", text, skala: 0.75 });
    expect(liten.h).toBeLessThan(normal.h);
    expect(liten.rader.length).toBeLessThanOrEqual(normal.rader.length);
    expect(liten.m.text).toBeLessThan(normal.m.text);
  });

  it("ljus bakgrund känns igen – då blir rubrik och text mörka", () => {
    expect(ärLjus("#ffffff")).toBe(true);
    expect(ärLjus("#0f172a")).toBe(false);
    expect(ärLjus("#1f5c9e")).toBe(false);
    expect(ärLjus("inte en färg")).toBe(false);
  });
});
