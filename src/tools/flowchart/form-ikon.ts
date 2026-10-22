/**
 * Den lilla BPMN-formen som ikon – EN PLATS, som färdig SVG.
 *
 * Objektpaletten och figurförteckningen visar samma symboler, och ritade de
 * varsin uppsättning skulle paletten förr eller senare visa en annan form än
 * faktarutan påstår att bilden innehåller. Färgerna kommer ur `theme`, så
 * ikonen kan heller inte visa en annan färg än ytan – inklusive strikt
 * BPMN-läget, där allt är färglöst.
 *
 * SVG-STRÄNG och inte en React-komponent: samma symbol ska kunna följa med i
 * scenen ut till EA-portalen (`core/figurer.ts`), och en komponent går inte
 * att serialisera. Affärsprocessens palett ritar redan sina former på precis det sättet.
 */

import type { NodeType } from "@/core/model";
import { LANE_HEADER_FILL, LANE_STROKE, nodeStyle, type ColorMode } from "./theme";

/** Grundmåttet en formikon ritas i. */
export const FORM_IKON_MÅTT = { w: 22, h: 18 } as const;

export function formIkonSvg(typ: NodeType, colorMode: ColorMode): string {
  const s = nodeStyle(typ, colorMode);
  const gem = (sw = 1.6) => `fill="${s.fill}" stroke="${s.stroke}" stroke-width="${sw}"`;
  switch (typ) {
    case "start":
      return `<circle cx="11" cy="9" r="7" ${gem()}/>`;
    case "end":
      return `<circle cx="11" cy="9" r="7" ${gem(3)}/>`;
    case "decision":
      return `<polygon points="11,1 21,9 11,17 1,9" ${gem()}/>`;
    case "datastore":
      return (
        `<g ${gem()}>` +
        `<path d="M2,4 a9,3 0 0 1 18,0 v10 a9,3 0 0 1 -18,0 Z"/>` +
        `<path d="M2,4 a9,3 0 0 0 18,0" fill="none"/>` +
        `</g>`
      );
    default:
      return `<rect x="1" y="3" width="20" height="12" rx="${typ === "activity" ? 4 : 1.5}" ${gem()}/>`;
  }
}

/** Banan: bandet med sitt namn i kanten. */
export function banIkonSvg(): string {
  return (
    `<rect x="1" y="3" width="20" height="12" fill="#fafbfc" stroke="${LANE_STROKE}" stroke-width="1.2"/>` +
    `<rect x="1" y="3" width="5" height="12" fill="${LANE_HEADER_FILL}" stroke="${LANE_STROKE}" stroke-width="1.2"/>`
  );
}

/**
 * Den svarta lådan: en deltagare vars inre vi inte modellerar (mottagaren av
 * ett mejl). Ritas som en TOM ram – det är just poängen med den.
 */
export function svartLådaIkonSvg(): string {
  return (
    `<rect x="1" y="3" width="20" height="12" rx="1.5" fill="#ffffff" stroke="#6b7280" stroke-width="1.6"/>` +
    `<line x1="5.5" y1="3" x2="5.5" y2="15" stroke="#6b7280" stroke-width="1.2"/>`
  );
}
