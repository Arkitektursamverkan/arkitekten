/**
 * Ångra/gör om. Testerna beskriver de fällor som gör en historik oanvändbar:
 * att ett musdrag blir hundra ångra-steg, att gör om lever kvar efter en ny
 * ändring, och att historiken växer utan gräns.
 */

import { describe, expect, it } from "vitest";
import {
  göraOm,
  HISTORY_LIMIT,
  HISTORY_MERGE_MS,
  kanGöraOm,
  kanÅngra,
  lägg,
  läggBrytpunkt,
  skapaHistorik,
  ångra,
} from "./history";

describe("historik", () => {
  it("börjar utan något att ångra", () => {
    const h = skapaHistorik("a");
    expect(kanÅngra(h)).toBe(false);
    expect(kanGöraOm(h)).toBe(false);
    expect(h.nuvarande).toBe("a");
  });

  it("ångra tar tillbaka föregående tillstånd", () => {
    let h = skapaHistorik("a");
    h = lägg(h, "b", 1000);
    h = lägg(h, "c", 5000);
    expect(h.nuvarande).toBe("c");
    h = ångra(h);
    expect(h.nuvarande).toBe("b");
    h = ångra(h);
    expect(h.nuvarande).toBe("a");
    expect(kanÅngra(h)).toBe(false);
  });

  it("gör om går framåt igen", () => {
    let h = skapaHistorik("a");
    h = lägg(h, "b", 1000);
    h = ångra(h);
    expect(kanGöraOm(h)).toBe(true);
    h = göraOm(h);
    expect(h.nuvarande).toBe("b");
    expect(kanGöraOm(h)).toBe(false);
  });

  it("en ny ändring efter ångra kastar gör om-kön", () => {
    // Annars kan man "göra om" till en framtid som inte längre hänger ihop.
    let h = skapaHistorik("a");
    h = lägg(h, "b", 1000);
    h = ångra(h);
    h = lägg(h, "c", 5000);
    expect(kanGöraOm(h)).toBe(false);
    expect(h.nuvarande).toBe("c");
  });

  it("REGRESSION: täta ändringar blir ETT ångra-steg", () => {
    // Ett musdrag ger hundratals tillstånd. Utan sammanslagning krävdes lika
    // många tryck på ångra för att ta tillbaka en enda flytt.
    let h = skapaHistorik("start");
    h = lägg(h, "drag-0", 1000);
    for (let i = 1; i < 100; i++) h = lägg(h, `drag-${i}`, 1000 + i * 10);
    expect(h.nuvarande).toBe("drag-99");
    h = ångra(h);
    expect(h.nuvarande, "draget blev fler än ett ångra-steg").toBe("start");
  });

  it("en paus bryter sammanslagningen", () => {
    let h = skapaHistorik("a");
    h = lägg(h, "b", 1000);
    h = lägg(h, "c", 1000 + HISTORY_MERGE_MS + 1);
    h = ångra(h);
    expect(h.nuvarande).toBe("b");
  });

  it("en brytpunkt slås aldrig ihop", () => {
    // Att öppna ett flöde eller tolka om texten ska alltid gå att ångra.
    let h = skapaHistorik("a");
    h = lägg(h, "b", 1000);
    h = läggBrytpunkt(h, "c", 1010);
    h = ångra(h);
    expect(h.nuvarande).toBe("b");
  });

  it("samma tillstånd två gånger ger inget nytt steg", () => {
    const a = { v: 1 };
    let h = skapaHistorik(a);
    h = lägg(h, a, 1000);
    expect(kanÅngra(h)).toBe(false);
  });

  it("historiken växer inte utan gräns", () => {
    let h = skapaHistorik(0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = lägg(h, i, i * 1000);
    expect(h.bakåt.length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });
});
