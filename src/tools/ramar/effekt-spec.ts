/**
 * Markeringarnas UTSEENDE – en plats för båda flikarna.
 *
 * Flödesfliken lägger sina effekter i exportens SVG-sträng (DOM, effekter.ts),
 * bildfliken ritar sin scen med React (ScenBild.tsx). Båda byggs ur samma
 * beskrivning här, så en puls mellan kunden och kontoret ser exakt
 * ut som en puls längs en koppling i flödet – samma fart, samma glöd, samma
 * ringar (invariant 1: en regel, en plats).
 *
 * En `Spec` är ett SVG-element i klartext: namn, attribut (med SVG:s egna
 * namn, `stroke-width` och inte `strokeWidth`) och barn.
 */

import type { RamVerktyg } from "@/core/ram";

export interface Spec {
  namn: string;
  attr: Record<string, string | number>;
  barn?: Spec[];
}

const s = (namn: string, attr: Spec["attr"] = {}, ...barn: Spec[]): Spec => ({ namn, attr, barn });

/** Luft mellan objektets ruta och markeringen runt den. */
export const LUFT = 5;
/** Pulsens fart längs kopplingen, px/s. */
const PULS_FART = 240;

/** Vägens ändpunkter ur `d` (M/L/A/Q – det exportörerna och scenen skriver). */
export function vägpunkter(d: string): [number, number][] {
  const punkter: [number, number][] = [];
  for (const seg of d.match(/[MLAQ][^MLAQ]*/gi) ?? []) {
    const tal = seg.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
    if (tal.length >= 2) punkter.push([tal[tal.length - 2], tal[tal.length - 1]]);
  }
  return punkter;
}

/**
 * Vägens längd ur `d`. Räta sträckor mäts rakt, bågarna (A) som korda –
 * exportörernas hörnbågar är några pixlar – och scenens Q-kurvor samplas,
 * för där är bågen hela vägen och kordan hade gett pulsen fel fart.
 */
export function väglängd(d: string): number {
  let l = 0;
  let cur: [number, number] | null = null;
  for (const seg of d.match(/[MLAQ][^MLAQ]*/gi) ?? []) {
    const tal = seg.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
    if (tal.length < 2) continue;
    const slut: [number, number] = [tal[tal.length - 2], tal[tal.length - 1]];
    const typ = seg[0].toUpperCase();
    if (cur && typ === "Q" && tal.length >= 4) {
      const [cx, cy] = tal;
      let föreg = cur;
      for (let i = 1; i <= 24; i++) {
        const t = i / 24;
        const u = 1 - t;
        const p: [number, number] = [
          u * u * cur[0] + 2 * u * t * cx + t * t * slut[0],
          u * u * cur[1] + 2 * u * t * cy + t * t * slut[1],
        ];
        l += Math.hypot(p[0] - föreg[0], p[1] - föreg[1]);
        föreg = p;
      }
    } else if (cur && typ !== "M") {
      l += Math.hypot(slut[0] - cur[0], slut[1] - cur[1]);
    }
    cur = slut;
  }
  return l;
}

/**
 * Pulsens streck: `off` från D till D − längd, så att strecket LEDS av punkten
 * som vandrar – ledet ligger på längd·p vid andelen p av varvet.
 */
export function pulsStreck(längd: number): { streck: number; från: number; till: number; tid: number } {
  const streck = Math.max(8, Math.min(46, längd * 0.45));
  return { streck, från: streck, till: streck - längd, tid: Math.max(0.9, längd / PULS_FART) };
}

export function glödFilterSpec(id: string): Spec {
  return s(
    "filter",
    { id, x: "-50%", y: "-50%", width: "200%", height: "200%" },
    s("feGaussianBlur", { stdDeviation: 3, result: "b" }),
    s("feMerge", {}, s("feMergeNode", { in: "b" }), s("feMergeNode", { in: "SourceGraphic" })),
  );
}

export function pilSpec(id: string, färg: string): Spec {
  return s(
    "marker",
    {
      id,
      viewBox: "0 0 10 10",
      markerWidth: 11,
      markerHeight: 11,
      refX: 9,
      refY: 5,
      orient: "auto",
      markerUnits: "userSpaceOnUse",
    },
    s("path", { d: "M1,2 L9,5 L1,8 Z", fill: färg }),
  );
}

/** Markering kring en ruta (x, y, b, h) – objekt i flödet, figur i bilden. */
export function nodEffektSpec(
  [rx, ry, rw, rh]: [number, number, number, number],
  verktyg: RamVerktyg,
  färg: string,
): Spec {
  const x = rx - LUFT;
  const y = ry - LUFT;
  const w = rw + 2 * LUFT;
  const h = rh + 2 * LUFT;
  const kant = { x, y, width: w, height: h, rx: 7, fill: "none", stroke: färg };
  const barn: Spec[] = [];
  if (verktyg === "farg") {
    barn.push(s("rect", { ...kant, "stroke-width": 3 }));
  } else if (verktyg === "blink") {
    barn.push(
      s(
        "rect",
        { ...kant, fill: färg, "fill-opacity": 0.16, "stroke-width": 3 },
        s("animate", { attributeName: "opacity", values: "1;0.12;1", dur: "1.1s", repeatCount: "indefinite" }),
      ),
    );
  } else {
    // Puls: en fast kant och två ringar som vidgas och tonar bort, förskjutna
    // ett halvt varv så att det aldrig står stilla.
    barn.push(s("rect", { ...kant, "stroke-width": 2.2 }));
    const G = 16;
    for (const begin of ["0s", "0.8s"]) {
      const a = (attributeName: string, from: number, to: number) =>
        s("animate", { attributeName, from, to, dur: "1.6s", begin, repeatCount: "indefinite" });
      barn.push(
        s(
          "rect",
          { ...kant, "stroke-width": 3, opacity: 0 },
          a("x", x, x - G),
          a("y", y, y - G),
          a("width", w, w + 2 * G),
          a("height", h, h + 2 * G),
          a("opacity", 0.9, 0),
        ),
      );
    }
  }
  return s("g", { class: `ark-ram-${verktyg}` }, ...barn);
}

/** Markering längs en väg `d` – koppling i flödet, puls mellan figurer i bilden. */
export function kantEffektSpec(d: string, verktyg: RamVerktyg, färg: string, pil: string, glöd: string): Spec {
  const linje = { d, fill: "none", stroke: färg, "stroke-linecap": "round", "stroke-linejoin": "round" };
  const barn: Spec[] = [];
  if (verktyg === "farg") {
    barn.push(s("path", { ...linje, "stroke-width": 3.4, "marker-end": pil }));
  } else if (verktyg === "blink") {
    barn.push(
      s(
        "path",
        { ...linje, "stroke-width": 3.6, "marker-end": pil },
        s("animate", { attributeName: "opacity", values: "1;0.1;1", dur: "1.1s", repeatCount: "indefinite" }),
      ),
    );
  } else {
    // Puls: en svag bädd i färgen, och ovanpå den ett glödande streck som
    // vandrar från källan till målet med en punkt i täten.
    const längd = väglängd(d);
    const p = pulsStreck(längd);
    const dur = `${p.tid.toFixed(2)}s`;
    const tona = { attributeName: "opacity", values: "0;1;1;0", keyTimes: "0;0.08;0.85;1", dur, repeatCount: "indefinite" };
    const streck = (extra: Spec["attr"]) =>
      s(
        "path",
        {
          ...linje,
          "stroke-dasharray": `${p.streck.toFixed(1)} ${(längd + p.streck).toFixed(1)}`,
          "stroke-dashoffset": p.från.toFixed(1),
          ...extra,
        },
        s("animate", {
          attributeName: "stroke-dashoffset",
          from: p.från.toFixed(1),
          to: p.till.toFixed(1),
          dur,
          repeatCount: "indefinite",
        }),
        s("animate", tona),
      );
    barn.push(s("path", { ...linje, "stroke-width": 3, opacity: 0.35, "marker-end": pil }));
    barn.push(streck({ "stroke-width": 7, filter: glöd }));
    barn.push(streck({ stroke: "#ffffff", "stroke-width": 2, opacity: 0.9 }));
    barn.push(
      s(
        "circle",
        { r: 4.5, fill: färg, stroke: "#ffffff", "stroke-width": 1.5, filter: glöd },
        s("animateMotion", { path: d, dur, repeatCount: "indefinite" }),
        s("animate", tona),
      ),
    );
  }
  return s("g", { class: `ark-ram-${verktyg}` }, ...barn);
}
