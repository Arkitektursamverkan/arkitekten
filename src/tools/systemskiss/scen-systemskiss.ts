/**
 * Systemskissen som SCEN – det flödestjänsten lämnar ut och
 * Arkitekturportalen visar på en server (docs/gransnitt.md).
 *
 * Scenen är byggd av ritarens egen markup (`skissInnehåll`), aldrig av en
 * egen ritregel: hela bilden ligger färdigritad i `bakgrund`, flyttad så att
 * den börjar i origo, och scenen har inga egna noder eller kanter. Mottagaren
 * panorerar och zoomar – mer behöver den inte kunna om en skiss.
 *
 * LAGREN följer med som färdiga bilder (`lager`): en per lager, filtrerad med
 * samma `filtreraSkiss` som ritytan. Mottagaren byter bild, den filtrerar
 * aldrig själv.
 */

import type { Scen, ScenLager } from "@/core/scen";
import { SKISS_TJÄNSTPREFIX, filtreraSkiss, type Systemskiss } from "@/core/systemskiss";
import { SKISS_TECKENSNITT, skissGeometri, skissInnehåll } from "./skiss-svg";

const nr = (n: number) => +n.toFixed(1);

function bild(skiss: Systemskiss): { bakgrund: string; bredd: number; höjd: number } {
  const g = skissGeometri(skiss);
  const { x, y, w, h } = g.gräns;
  return {
    bakgrund: `<g transform="translate(${nr(-x)},${nr(-y)})" font-family='${SKISS_TECKENSNITT}'>${skissInnehåll(skiss, g)}</g>`,
    bredd: nr(w),
    höjd: nr(h),
  };
}

export function byggSkissScen(skiss: Systemskiss): Scen {
  const lager: ScenLager[] = (skiss.lager ?? []).map((l) => ({
    id: l.id,
    namn: l.namn,
    ...bild(filtreraSkiss(skiss, new Set([l.id]))),
  }));
  return {
    format: "ark-scen",
    formatVersion: 1,
    familj: "systemskiss",
    flöde: { id: SKISS_TJÄNSTPREFIX + skiss.id, namn: skiss.namn, sparad: skiss.savedAt },
    vy: { pageFormat: "fri", scale: 1, spacing: 1, textScale: 1 },
    defs: "",
    ...bild(skiss),
    skala: 1,
    sidor: [],
    hänvisningar: [],
    noder: [],
    kanter: [],
    steg: {},
    ...(lager.length ? { lager } : {}),
    revision: null,
  };
}
