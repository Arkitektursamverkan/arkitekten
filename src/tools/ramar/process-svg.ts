/**
 * Ett sparat flöde som SVG – bilden ramarna läggs ovanpå.
 *
 * Ingenting ritas här: båda familjerna går genom SIN VANLIGA exportör
 * (`renderSvg` resp. `renderApSvg`), med flödets egna vyval, och ramen får
 * exakt den bild verktyget självt exporterar (invariant 1). Det enda som skiljer
 * är sidformatet: en ram visar HELA processen i ett stycke. En Word-figur
 * delad i sidor med hänvisningar mellan delarna hade klippt av just de
 * kopplingar som ska pulsera.
 */

import { compileDraft } from "@/core/draft";
import { flowFamily, type SavedFlow } from "@/core/flow-store";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel } from "@/tools/flowchart/layout/layout";
import { renderSvg } from "@/tools/flowchart/export/svg";
import type { ColorMode } from "@/tools/flowchart/theme";
import { byggUtlägg } from "@/tools/affarsprocess/scen-affarsprocess";
import { renderApSvg } from "@/tools/affarsprocess/svg-affarsprocess";
import type { RamStil } from "@/core/ram";
import { avskalaAp, renderAvskaladSvg } from "./avskalad";

/** Vilka stilar ett flöde kan ritas i. Den avskalade finns bara för affärsprocesser. */
export function tillgängligaStilar(flödeId: string): RamStil[] {
  return flowFamily(flödeId) === "affarsprocess" ? ["verktyg", "avskalad"] : ["verktyg"];
}

export function processSvg(flöde: SavedFlow, stil: RamStil = "verktyg"): string {
  if (flowFamily(flöde.id) === "affarsprocess") {
    // Den AKTUELLA versionen – samma som man ser när man öppnar processen.
    const friVy = { ...flöde, view: { ...(flöde.view ?? defaultVy), pageFormat: "free" } };
    const { lo, textScale, modell, draft } = byggUtlägg(friVy, { version: "aktuell" });
    if (stil === "avskalad") {
      return renderAvskaladSvg(avskalaAp(modell, draft.presentation?.lägen, draft.presentation?.kopplingar));
    }
    return renderApSvg(lo, { textScale });
  }
  const v = flöde.view ?? defaultVy;
  const vy = ritadModell(flöde);
  const lo = layoutModel(vy, {
    pageWidth: null,
    pageHeight: null,
    scale: v.scale ?? 1,
    shrinkToContent: true,
    spacing: v.spacing ?? 1,
  });
  return renderSvg(vy, lo, (v.colorMode as ColorMode) ?? "type", v.textScale ?? 1);
}

/**
 * Flödesschemats modell SÅ SOM DEN RITAS: filtrerad genom flödets perspektiv
 * (förvalt affärsperspektivet, som döljer bland annat besluten). Ramarnas
 * markeringar kan bara gälla det som står i bilden.
 */
export function ritadModell(flöde: SavedFlow) {
  return filterByPerspective(compileDraft(flöde.draft), (flöde.view ?? defaultVy).perspective);
}

const defaultVy: NonNullable<SavedFlow["view"]> = {
  perspective: "business",
  pageFormat: "free",
  scale: 1,
};
