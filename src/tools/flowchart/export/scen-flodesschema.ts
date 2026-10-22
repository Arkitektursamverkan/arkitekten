/**
 * Bygger en SCEN ur en Systemprocess (flödesschemat) – se `core/scen.ts` för
 * kontraktet. Syskon till `tools/affarsprocess/scen-affarsprocess.ts`.
 *
 * Varje bit kommer ur SAMMA funktion som SVG-exporten använder (`svg.ts`):
 * `bakgrundSvg` för banorna, `ruttaSekvensflöden` och `kantEtikettSvg` för
 * kanterna, `artefakterSvg` för datalager och meddelandeflöden och `nodSvg` för
 * objekten. Ingen regel skrivs av här (invariant 1) – portalen ritar alltså
 * samma bild som filen, och `scen-flodesschema.test.ts` låser fast det.
 *
 * Utlägget görs med flödets EGNA vyval (perspektiv, format, skala, täthet),
 * precis som exporten i appen, men alltid i typfärgsläge: portalen visar
 * teckenförklaringen, och i strikt BPMN är formerna färglösa.
 */

import { compileDraft } from "@/core/draft";
import type { FlowView, SavedFlow } from "@/core/flow-store";
import type { Perspective } from "@/core/model";
import type { Scen, ScenKant, ScenNod } from "@/core/scen";
import { sammanfattaStatus } from "@/core/status";
import { väljVersion, type ScenOptioner } from "@/tools/affarsprocess/scen-affarsprocess";
import { flödesFigurer } from "../figurer";
import { layoutModel, PAGE_FORMATS, type LayoutResult } from "../layout/layout";
import { pointsToPath } from "../layout/edge-router";
import { filterByPerspective } from "../perspective";
import { EDGE_STROKE, nodeStyle } from "../theme";
import { revisionAvVersion } from "./revision";
import {
  artefakterSvg,
  bakgrundSvg,
  flödesMarkörer,
  kantEtikettSvg,
  nodSvg,
  ruttaSekvensflöden,
} from "./svg";

/**
 * Modell och utlägg scenen byggs ur. Exponerad så att kontrollen kan rendera
 * exportörens SVG ur PRECIS samma utlägg (samma skäl som `byggUtlägg` i ap).
 */
export function byggFlödesUtlägg(flöde: SavedFlow, opts?: ScenOptioner) {
  const v: Partial<FlowView> = flöde.view ?? {};
  const { draft, index } = väljVersion(flöde, opts?.version);
  const textScale = opts?.textScale ?? v.textScale ?? 1;
  const modell = filterByPerspective(compileDraft(draft), (v.perspective as Perspective) ?? "system");
  const fmt = PAGE_FORMATS[(v.pageFormat as keyof typeof PAGE_FORMATS) ?? "free"] ?? PAGE_FORMATS.free;
  const lo: LayoutResult = layoutModel(modell, {
    pageWidth: fmt.width,
    pageHeight: fmt.width && fmt.aspect ? fmt.width * fmt.aspect : null,
    scale: v.scale ?? 1,
    shrinkToContent: fmt.aspect === null,
    spacing: v.spacing ?? 1,
  });
  return { lo, modell, index, textScale, vy: v };
}

export function byggFlödesScen(flöde: SavedFlow, opts?: ScenOptioner): Scen {
  const { lo, modell, index, textScale, vy: v } = byggFlödesUtlägg(flöde, opts);

  const noder: ScenNod[] = lo.nodes.map((ln) => ({
    id: ln.node.id,
    typ: ln.node.type,
    etikett: ln.node.label,
    // Lokala koordinater – mottagaren placerar med translate(x,y).
    svg: nodSvg({ ...ln, x: 0, y: 0 }, lo.scale, textScale, "type"),
    x: ln.x,
    y: ln.y,
    w: ln.w,
    h: ln.h,
    sida: ln.page,
    stil: nodeStyle(ln.node.type, "type"),
  }));

  const kanter: ScenKant[] = ruttaSekvensflöden(modell, lo).map(({ edge: e, pts }) => ({
    id: `${e.source}->${e.target}${e.label ? `:${e.label}` : ""}`,
    källa: e.source,
    mål: e.target,
    typ: "sekvens",
    d: pointsToPath(pts),
    färg: EDGE_STROKE,
    tjocklek: 1.6,
    pilspets: "fylld",
    markör: "arw",
    ...(e.label ? { etikett: e.label, etikettSvg: kantEtikettSvg(e.label, pts, e.labelPos, lo.scale) } : {}),
  }));

  const steg: Scen["steg"] = {};
  for (const n of modell.nodes) {
    steg[n.id] = { text: n.label, typ: n.type, ...(n.sourceText ? { källtext: n.sourceText } : {}) };
  }

  return {
    format: "ark-scen",
    formatVersion: 1,
    familj: "flodesschema",
    flöde: {
      id: flöde.id,
      namn: flöde.name,
      sparad: flöde.savedAt,
      // Statusen gäller den VERSION scenen ritar – se byggApScen.
      ...sammanfattaStatus(
        index >= 0 ? (flöde.versions ?? []).slice(0, index + 1) : (flöde.versions ?? []),
      ),
    },
    vy: {
      pageFormat: (v.pageFormat as string) ?? "free",
      scale: v.scale ?? 1,
      spacing: v.spacing ?? 1,
      textScale,
    },
    defs: flödesMarkörer(),
    bredd: lo.width,
    höjd: lo.height,
    skala: lo.scale,
    sidor: lo.pages.map((s, i) => ({ index: i, x: s.x, y: s.y, w: s.w, h: s.h })),
    // Sidhänvisningarna är färdigritade i `artefakter`, som i exporten.
    hänvisningar: [],
    bakgrund: bakgrundSvg(lo).join("\n"),
    artefakter: artefakterSvg(modell, lo, textScale).join("\n"),
    noder,
    kanter,
    steg,
    figurer: flödesFigurer(modell, "type"),
    revision: revisionAvVersion(flöde, index, false),
  };
}
