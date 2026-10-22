/**
 * Bygger en SCEN ur en affärsprocess – se `core/scen.ts` för kontraktet.
 *
 * Modulen finns för att EA-portalen ska kunna rita processernas flödesscheman
 * utan att äga en enda layoutregel. Den använder EXAKT samma funktioner som
 * `svg-affarsprocess.ts`: `layoutAp` för utlägget, `pickEdgeSides`/`routeEdge` för vägarna
 * och `apNodeSvg`/`apMarkerDefs` för formerna. Ingen regel skrivs av här – gör
 * någon det kommer skärm, fil och portal att glida isär, vilket är precis vad
 * invariant 1 finns för att förhindra.
 *
 * `scen-affarsprocess.test.ts` låser fast likheten: varje bana scenen påstår ska finnas
 * tecken-för-tecken i exportörens SVG.
 */

import { compileAp } from "@/core/affarsprocess";
import {
  type SavedFlow,
  type FlowVersion,
  type FlowView,
} from "@/core/flow-store";
import { senasteFastslagna, sammanfattaStatus } from "@/core/status";
import type { Scen, ScenKant, ScenNod } from "@/core/scen";
import { apFigurer } from "./figurer";
import { layoutAp, apPortPunkt, type ApLayout } from "./layout-affarsprocess";
import {
  apNodeSvg,
  apMarkerDefs,
  apMarkerId,
  apRelationEtikett,
  apRelationFärg,
  apHörnradie,
  formstil,
} from "./former";
import { PAGE_FORMATS } from "@/tools/flowchart/layout/layout";
import { revisionAvVersion } from "@/tools/flowchart/export/revision";
import {
  pickEdgeSides,
  routeEdge,
  pointsToPath,
  labelBesideMid,
} from "@/tools/flowchart/layout/edge-router";

export interface ScenOptioner {
  /**
   * Vilken version scenen ska visa.
   *  - "fastslagen" (förval): huvudversionen, samma val som exporten gör. Det
   *    är den bild som gäller i ett styrdokument, inte det som råkar ligga i
   *    editorn. Saknas fastslagen version används den aktuella.
   *  - "aktuell": flödets nuvarande innehåll.
   *  - ett tal: index i `versions[]`.
   */
  version?: "fastslagen" | "aktuell" | number;
  /** Global textfaktor. Förval: flödets egen. */
  textScale?: number;
}

/**
 * Vald version + dess index i historiken (−1 = flödets aktuella innehåll).
 * Delas med flödesschemats scen (`scen-flodesschema.ts`).
 */
export function väljVersion(
  flöde: SavedFlow,
  val: ScenOptioner["version"],
): { draft: FlowVersion["draft"]; index: number } {
  const versioner = flöde.versions ?? [];
  if (typeof val === "number") {
    const v = versioner[val];
    if (!v) throw new Error(`Version ${val} finns inte (${versioner.length} i historiken)`);
    return { draft: v.draft, index: val };
  }
  if (val === "aktuell") return { draft: flöde.draft, index: -1 };
  const fast = senasteFastslagna(versioner);
  return fast ? { draft: fast.version.draft, index: fast.index } : { draft: flöde.draft, index: -1 };
}

/**
 * Ruttar relationerna precis som `renderApSvg` gör: samma hinder, samma
 * portpunkter ur layouten, samma översättning av manuella brytpunkter till
 * utläggets koordinatram (invariant 5).
 */
function ruttaKanter(lo: ApLayout): ScenKant[] {
  const platsAv = new Map(lo.nodes.map((n) => [n.node.id, n]));
  const allaBoxar = new Map(lo.nodes.map((n) => [n.node.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
  const ut: ScenKant[] = [];

  for (const rel of lo.relations) {
    const a = platsAv.get(rel.source);
    const b = platsAv.get(rel.target);
    if (!a || !b) continue;
    // Relationer över ett snitt ritas inte – hänvisningsmärkena tar över.
    if (a.page !== b.page) continue;

    const [sa, sb] = pickEdgeSides(a, b, lo.sides[rel.id]);
    const obstacles = [];
    for (const [id, r] of allaBoxar) {
      if (id !== rel.source && id !== rel.target) obstacles.push(r);
    }
    const utpekad = lo.ports[rel.id];
    const val = lo.sides[rel.id];
    const wp = val?.waypoint;
    const pts = routeEdge({
      from: utpekad?.from ?? apPortPunkt(a, sa, val?.sourcePos),
      fromSide: sa,
      to: utpekad?.to ?? apPortPunkt(b, sb, val?.targetPos),
      toSide: sb,
      obstacles,
      via: wp ? { x: wp.x + a.dx, y: wp.y + a.dy } : utpekad?.via,
      via2: wp && val?.waypoint2 ? { x: val.waypoint2.x + a.dx, y: val.waypoint2.y + a.dy } : null,
    });

    // Annotering eller förädlingskedja – samma skillnad som exportören gör.
    // BÅDA är heldragna; tjocklek, färg och pilspets skiljer dem åt.
    const annotering = rel.kind !== "flode";
    const text = apRelationEtikett(rel);
    const ankare = text
      ? utpekad?.via && !wp
        ? { x: utpekad.via.x + 6, y: utpekad.via.y }
        : (({ x, y }) => ({ x, y }))(labelBesideMid(pts))
      : undefined;

    ut.push({
      id: rel.id,
      källa: rel.source,
      mål: rel.target,
      typ: rel.kind,
      // Samma rundade hörn som skärmen och SVG-exporten – scenen ritas rakt av
      // av mottagaren (EA-portalen), så skillnaden hade synts där.
      d: pointsToPath(pts, apHörnradie() * lo.scale),
      färg: apRelationFärg(rel),
      tjocklek: annotering ? 1.1 : 1.6,
      // ALLA spetsar är fyllda (se apMarkerId): en öppen spets på en tunn
      // färgad linje syntes knappt i portalen.
      pilspets: "fylld",
      markör: apMarkerId(rel),
      ...(text ? { etikett: text } : {}),
      ...(ankare ? { ankare } : {}),
    });
  }
  return ut;
}

/**
 * Utlägget scenen byggs ur – med flödets EGNA vyval, samma som appen och
 * exporten använder.
 *
 * Exponerad för att kontrollen (`scen-affarsprocess.test.ts`, `scripts/scen.mts --jamfor`)
 * ska kunna rendera exportörens SVG ur PRECIS samma utlägg som scenen kommer
 * ur. Byggde kontrollen ett eget utlägg jämförde den två saker som råkar bli
 * lika i stället för en sak med sig själv – och då bevisar den ingenting.
 */
export function byggUtlägg(flöde: SavedFlow, opts?: ScenOptioner) {
  const v: Partial<FlowView> = flöde.view ?? {};
  const { draft, index } = väljVersion(flöde, opts?.version);
  const textScale = opts?.textScale ?? v.textScale ?? 1;
  const modell = compileAp(draft);
  const fmt = PAGE_FORMATS[(v.pageFormat as keyof typeof PAGE_FORMATS) ?? "free"];
  const lo = layoutAp(modell, {
    pageWidth: fmt.width,
    scale: v.scale ?? 1,
    spacing: v.spacing ?? 1,
    edgeStyles: draft.edgeStyles,
  });
  return { lo, modell, index, textScale, vy: v, draft };
}

export function byggApScen(flöde: SavedFlow, opts?: ScenOptioner): Scen {
  const { lo, modell, index, textScale, vy: v } = byggUtlägg(flöde, opts);

  const noder: ScenNod[] = lo.nodes.map((n) => ({
    id: n.node.id,
    typ: n.node.kind,
    etikett: n.node.label,
    // Lokala koordinater – mottagaren placerar med translate(x,y), precis som
    // ApCanvas gör med samma anrop.
    svg: apNodeSvg(n.node, 0, 0, n.w, n.h, textScale),
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    sida: n.page,
    stil: formstil(n.node.kind),
    ...(n.node.beskrivning ? { beskrivning: n.node.beskrivning } : {}),
    ...(n.node.nedbruten ? { nedbruten: true } : {}),
  }));

  const steg: Scen["steg"] = {};
  for (const n of modell.nodes) {
    steg[n.id] = {
      text: n.label,
      typ: n.kind,
      ...(n.beskrivning ? { not: n.beskrivning } : {}),
      ...(n.sourceText ? { källtext: n.sourceText } : {}),
    };
  }

  return {
    format: "ark-scen",
    formatVersion: 1,
    familj: "affarsprocess",
    flöde: {
      id: flöde.id,
      namn: flöde.name,
      sparad: flöde.savedAt,
      /**
       * Statusen gäller den VERSION scenen ritar, inte flödets nuläge.
       *
       * Scenen visar förvalt den fastslagna versionen – den som gäller i ett
       * styrdokument. Rapporterade vi flödets nuvarande status blev bilden
       * märkt "utkast 2.1" fast den ritade 2.0, så fort någon sparat ett utkast
       * ovanpå. Mottagaren har ingen möjlighet att upptäcka det: den ser bara
       * det vi skickar. Historiken KAPAS därför vid den valda versionen, och
       * beteckningen räknas fram ur den (invariant 9 – aldrig lagrad).
       */
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
    defs: apMarkerDefs(),
    bredd: lo.width,
    höjd: lo.height,
    skala: lo.scale,
    sidor: lo.pages,
    hänvisningar: lo.refs.map((r) => ({
      riktning: r.riktning,
      sida: r.page,
      x: r.x,
      y: r.y,
      text: r.text,
    })),
    noder,
    kanter: ruttaKanter(lo),
    steg,
    /**
     * Teckenförklaringen för den VERSION scenen ritar – samma funktion som
     * appens egen faktaruta läser, så portalen aldrig kan förklara en symbol
     * som Arkitekten ritar annorlunda. Bilden och förklaringen kommer ur
     * samma modell; räknades den ur flödets nuläge kunde en fastslagen bild
     * få en förklaring till ett utkast.
     */
    figurer: apFigurer(modell),
    // Bilden ÄR den valda versionen – aldrig "ändrad sedan dess".
    revision: revisionAvVersion(flöde, index, false),
  };
}
