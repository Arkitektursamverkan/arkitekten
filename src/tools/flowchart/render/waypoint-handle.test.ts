/**
 * Regeln för brytpunktens handtag.
 *
 * Varför ett eget test: handtaget bär sin EGEN pointer-capture. Avmonteras det
 * mitt i en dragning tappas capturen, `pointerup` går till objektet under, och
 * brytpunkten sparas aldrig. Vakterna måste därför gälla när handtaget ERBJUDS,
 * inte medan det används.
 */

import { describe, expect, it } from "vitest";
import { brytpunktDragbar, friHandtagsAndel } from "./RoutedEdge";

const bas = { harHandlare: true, drarNu: false, längd: 200, harBrytpunkt: false, iÄnde: false };

describe("brytpunktDragbar", () => {
  it("en normal koppling har ett handtag", () => {
    expect(brytpunktDragbar(bas)).toBe(true);
  });

  it("utan mottagare finns inget handtag – låst läge skickar ingen", () => {
    expect(brytpunktDragbar({ ...bas, harHandlare: false })).toBe(false);
    // …och inte ens en pågående dragning kan trolla fram ett.
    expect(brytpunktDragbar({ ...bas, harHandlare: false, drarNu: true })).toBe(false);
  });

  it("en mycket kort väg får inget handtag – det finns inget att böja", () => {
    expect(brytpunktDragbar({ ...bas, längd: 12 })).toBe(false);
  });

  it("men har kanten redan en brytpunkt går den alltid att ta i igen", () => {
    expect(brytpunktDragbar({ ...bas, längd: 12, harBrytpunkt: true })).toBe(true);
  });

  it("ett handtag inne i ett av objekten erbjuds inte – det stjäl objektets klick", () => {
    expect(brytpunktDragbar({ ...bas, iÄnde: true })).toBe(false);
  });

  it("REGRESSION: en egen brytpunkt går alltid att ta i igen, var den än hamnat", () => {
    // Drog man böjen in över ett av objekten försvann handtaget när gesten var
    // klar. Punkten gick då inte att flytta – och inte att nolla med dubbelklick
    // heller, eftersom det också sitter på handtaget.
    expect(brytpunktDragbar({ ...bas, harBrytpunkt: true, iÄnde: true })).toBe(true);
  });

  it("REGRESSION: en PÅGÅENDE dragning avbryts inte av vakterna", () => {
    // Förde man böjen in över en av ändarna avmonterades handtaget mitt i
    // gesten, pointer-capture följde med, och `pointerup` landade på objektet
    // under. Brytpunkten sparades aldrig. Syntes värst på de streckade
    // kopplingarna, där noden och datalagret står tätt ihop.
    expect(brytpunktDragbar({ ...bas, drarNu: true, iÄnde: true })).toBe(true);
    expect(brytpunktDragbar({ ...bas, drarNu: true, längd: 4 })).toBe(true);
    expect(brytpunktDragbar({ ...bas, drarNu: true, längd: 4, iÄnde: true })).toBe(true);
  });
});

/**
 * Handtaget GLIDER undan i stället för att försvinna.
 *
 * En streckad koppling mellan en aktivitet och ett datalager strax intill har
 * ofta sin mittpunkt inne i den ena rutan. Att då dölja handtaget gjorde böjen
 * omöjlig att flytta fast vägen var över hundra pixlar lång – 2 av 66 sparade
 * dataassociationer var i det läget, och varje ny koppling man ritade kunde bli
 * det.
 */
describe("friHandtagsAndel", () => {
  /** En rak väg från (0,0) till (100,0). */
  const väg = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it("är mitten fri sitter handtaget där", () => {
    expect(friHandtagsAndel(väg, () => true)).toBe(0.5);
  });

  it("respekterar en önskad andel (etiketten i vägen)", () => {
    expect(friHandtagsAndel(väg, () => true, 0.72)).toBe(0.72);
  });

  it("glider undan när mitten ligger inne i ett objekt", () => {
    // Rutan täcker x 40–60, alltså mitten av vägen.
    const fritt = (p: { x: number }) => p.x < 40 || p.x > 60;
    const andel = friHandtagsAndel(väg, fritt)!;
    expect(andel).not.toBeNull();
    expect(fritt({ x: andel * 100 })).toBe(true);
    // …och så nära mitten som möjligt: strax utanför rutan, inte vid änden.
    expect(Math.abs(andel - 0.5)).toBeLessThan(0.2);
  });

  it("ger null när HELA vägen ligger inne i objekten – då finns inget att böja", () => {
    expect(friHandtagsAndel(väg, () => false)).toBeNull();
  });

  it("går aldrig ända ut i ändpunkterna", () => {
    // Bara den yttersta kanten är fri – men 0 och 1 sitter på objekten själva.
    const andel = friHandtagsAndel(väg, (p) => p.x < 3);
    if (andel !== null) expect(andel).toBeGreaterThanOrEqual(0.02);
  });
});
