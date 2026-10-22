/**
 * draw.io-export (KRAV 7). Genererar mxGraphModel-XML deterministiskt ur
 * layouten så att filen öppnas direkt i draw.io utan manuell korrigering.
 */

import {
  BPMN_SHAPE,
  eventKind,
  type EdgeSide,
  type ProcessNode,
  type ProcessModel,
} from "@/core/model";
import { layoutModel, type LayoutResult } from "../layout/layout";
import { messageFlowAndel, messageFlowLandning, pickEdgeSides } from "../layout/edge-router";
import { LANE_FILLS, LANE_HEADER_FILL, LANE_STROKE, NODE_STYLES } from "../theme";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Äkta BPMN 2.0-former via draw.ios mxgraph.bpmn-stencils. */
function nodeStyle(node: ProcessNode): string {
  const s = NODE_STYLES[node.type];
  const base = `html=1;whiteSpace=wrap;fontFamily=Segoe UI;fontColor=${s.text};fillColor=${s.fill};strokeColor=${s.stroke};`;
  const bshape = BPMN_SHAPE[node.type];

  if (bshape === "event") {
    // Start = tunn ring (outline=standard), slut = tjock ring (outline=end).
    const outline = eventKind(node.type) === "end" ? "end" : "standard";
    return `shape=mxgraph.bpmn.shape;perimeter=ellipsePerimeter;outlineConnect=0;labelPosition=center;verticalLabelPosition=bottom;align=center;verticalAlign=top;outline=${outline};symbol=general;${base}`;
  }
  if (bshape === "gateway") {
    const symbol = node.gateway === "parallel" ? "parallelGw" : "exclusiveGw";
    return `shape=mxgraph.bpmn.shape;perimeter=rhombusPerimeter;outlineConnect=0;labelPosition=center;verticalLabelPosition=bottom;align=center;verticalAlign=top;background=gateway;outline=none;symbol=${symbol};${base}`;
  }
  if (bshape === "dataStore") {
    return `shape=cylinder3;boundedLbl=1;backgroundOutline=1;${base}`;
  }
  // Task – BPMN-rundad rektangel.
  return `rounded=1;arcSize=12;${base}`;
}

/** Relativ kopplingspunkt (0–1) på nodens ram för en given sida. */
const SIDE_POINT: Record<EdgeSide, { x: number; y: number }> = {
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
};

/**
 * Fasta kopplingspunkter för en kant. draw.io flyttar annars ändarna själv –
 * exitDx/exitDy (0) krävs för att punkten ska låsas, annars ignoreras exitX/Y.
 *
 * Sidorna kommer från SAMMA regel som canvasen och SVG:n (pickEdgeSides), så
 * pilen ansluter till samma nodkant i draw.io som på skärmen. Tidigare skrevs
 * bara MANUELLT valda sidor ut och draw.io valde själv för resten – filen
 * kunde då ansluta till andra kanter än diagrammet man tittade på.
 */
function edgeSideStyle(sa: EdgeSide, sb: EdgeSide): string {
  const p = SIDE_POINT[sa];
  const q = SIDE_POINT[sb];
  return (
    `exitX=${p.x};exitY=${p.y};exitDx=0;exitDy=0;` +
    `entryX=${q.x};entryY=${q.y};entryDx=0;entryDy=0;`
  );
}

/**
 * Manuell brytpunkt som draw.io-waypoint. draw.ios router drar linjen genom
 * punkten – samma tvingade väg som canvasen och SVG:n ritar.
 *
 * Tar bara `waypoint`, inte en hel `ProcessEdge`: sekvensflöden,
 * dataassociationer och meddelandeflöden bär alla en brytpunkt, och alla tre ska
 * översättas med samma räkning.
 */
function waypointXml(
  e: { waypoint?: { x: number; y: number } | null },
  srcDx: number,
  srcDy: number,
  titleH: number,
): string {
  if (!e.waypoint) return `<mxGeometry relative="1" as="geometry"/>`;
  const x = Math.round(e.waypoint.x + srcDx);
  const y = Math.round(e.waypoint.y + srcDy + titleH);
  return (
    `<mxGeometry relative="1" as="geometry">` +
    `<Array as="points"><mxPoint x="${x}" y="${y}"/></Array>` +
    `</mxGeometry>`
  );
}

export function toDrawioXml(model: ProcessModel, layout?: LayoutResult): string {
  const lo: LayoutResult = layout ?? layoutModel(model);
  const cells: string[] = [];
  const titleH = model.title ? 40 : 0;

  // BPMN-pool: vertikal ram runt lanes med titel på vänsterkanten. En ram per
  // sida i ett flersidigt utlägg – därför måste id:t bära sidnumret.
  for (const p of lo.pools) {
    cells.push(
      `<mxCell id="pool_${p.page}" value="${esc(p.title)}" style="swimlane;horizontal=0;startSize=${Math.round(
        p.labelW,
      )};html=1;fontStyle=1;fontFamily=Segoe UI;fillColor=none;strokeColor=${LANE_STROKE};swimlaneFillColor=none;verticalAlign=middle;fontColor=#3b465c;" vertex="1" parent="1">` +
        `<mxGeometry x="0" y="${p.y + titleH}" width="${Math.round(p.w)}" height="${Math.round(
          p.h,
        )}" as="geometry"/></mxCell>`,
    );
  }

  // Swimlanes. Samma bana förekommer en gång per sida: färgen följer banans
  // plats i ordningen (annars byter den färg mellan sidorna) och id:t bär
  // sidnumret (annars krockar cellerna i draw.io).
  const laneOrder = new Map<string, number>();
  for (const l of lo.lanes) if (!laneOrder.has(l.id)) laneOrder.set(l.id, laneOrder.size);
  lo.lanes.forEach((lane) => {
    const fill = LANE_FILLS[(laneOrder.get(lane.id) ?? 0) % LANE_FILLS.length];
    cells.push(
      `<mxCell id="lane_${lane.page}_${esc(lane.id)}" value="${esc(lane.title)}" style="swimlane;horizontal=1;startSize=${Math.round(lane.headerH)};html=1;fontStyle=1;fontFamily=Segoe UI;fillColor=${fill};swimlaneFillColor=${fill};strokeColor=${LANE_STROKE};verticalAlign=middle;align=left;spacingLeft=8;fontColor=#3b465c;swimlaneHead=1;swimlaneBody=1;fillColorHead=${LANE_HEADER_FILL};" vertex="1" parent="1">` +
        `<mxGeometry x="0" y="${lane.y + titleH}" width="${lane.w}" height="${lane.h}" as="geometry"/></mxCell>`,
    );
  });

  // Noder (absolut placerade ovanpå lanes; parent=1 håller geometrin enkel).
  const byId = new Map(lo.nodes.map((n) => [n.node.id, n]));
  for (const ln of lo.nodes) {
    cells.push(
      `<mxCell id="${esc(ln.node.id)}" value="${esc(ln.node.label)}" style="${nodeStyle(
        ln.node,
      )}" vertex="1" parent="1"><mxGeometry x="${Math.round(ln.x)}" y="${Math.round(
        ln.y + titleH,
      )}" width="${Math.round(ln.w)}" height="${Math.round(ln.h)}" as="geometry"/></mxCell>`,
    );
  }

  // Datalager är ARTEFAKTER: egna cylinderformer utanför sekvensflödet.
  const storeStyle = NODE_STYLES.datastore;
  for (const ds of lo.dataStores) {
    cells.push(
      `<mxCell id="${esc(ds.store.id)}" value="${esc(
        ds.store.label,
      )}" style="shape=cylinder3;boundedLbl=1;backgroundOutline=1;html=1;whiteSpace=wrap;fontFamily=Segoe UI;fontColor=${storeStyle.text};fillColor=${storeStyle.fill};strokeColor=${storeStyle.stroke};" vertex="1" parent="1"><mxGeometry x="${Math.round(
        ds.x,
      )}" y="${Math.round(ds.y + titleH)}" width="${Math.round(ds.w)}" height="${Math.round(
        ds.h,
      )}" as="geometry"/></mxCell>`,
    );
  }

  // Svart-låda-pooler: tom swimlane-ram med deltagarens namn på vänsterkanten.
  for (const b of lo.blackBoxes) {
    cells.push(
      `<mxCell id="bb_${b.page}_${esc(b.pool.id)}" value="${esc(
        b.pool.title,
      )}" style="shape=swimlane;horizontal=0;startSize=26;html=1;fontStyle=1;fontFamily=Segoe UI;fillColor=none;strokeColor=${LANE_STROKE};swimlaneFillColor=none;verticalAlign=middle;fontColor=#3b465c;" vertex="1" parent="1"><mxGeometry x="${Math.round(
        b.x,
      )}" y="${Math.round(b.y + titleH)}" width="${Math.round(b.w)}" height="${Math.round(
        b.h,
      )}" as="geometry"/></mxCell>`,
    );
  }

  // Sekvensflöden. `model.edges` innehåller numera bara dessa: heldragen linje
  // med fylld pilspets, aldrig över en poolgräns.
  for (const e of model.edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const [sa, sb] = pickEdgeSides(a, b, e);
    const edgeStyle =
      "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=#7b8494;fontColor=#374151;" +
      edgeSideStyle(sa, sb);
    cells.push(
      `<mxCell id="${esc(e.id)}" value="${esc(e.label ?? "")}" style="${edgeStyle}" edge="1" parent="1" source="${esc(
        e.source,
      )}" target="${esc(e.target)}">${waypointXml(e, a.dx, a.dy, titleH)}</mxCell>`,
    );
  }

  // Dataassociationer: streckade, öppen OFYLLD pilspets – aldrig ett flöde.
  const storeIds = new Set(lo.dataStores.map((ds) => ds.store.id));
  for (const a of model.dataAssociations) {
    if (!byId.has(a.nodeId) || !storeIds.has(a.dataStoreId)) continue;
    const [source, target] =
      a.direction === "write" ? [a.nodeId, a.dataStoreId] : [a.dataStoreId, a.nodeId];
    // Brytpunkten ligger alltid i AKTIVITETENS fria koordinater, oavsett
    // riktning – samma ram som canvasen sparar i och SVG:n läser.
    const n = byId.get(a.nodeId)!;
    cells.push(
      `<mxCell id="${esc(
        a.id,
      )}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;dashed=1;endArrow=open;endFill=0;strokeColor=#7b8494;" edge="1" parent="1" source="${esc(
        source,
      )}" target="${esc(target)}">${waypointXml(a, n.dx, n.dy, titleH)}</mxCell>`,
    );
  }

  // Meddelandeflöden: streckade med öppen pilspets och ring i avsändaränden –
  // BPMN:s notation för kommunikation mellan deltagare.
  const boxIds = new Set(lo.blackBoxes.map((b) => b.pool.id));
  for (const mf of model.messageFlows) {
    if (!byId.has(mf.nodeId) || !boxIds.has(mf.poolId)) continue;
    const mål = mf.poolId;
    const nMf = byId.get(mf.nodeId)!;
    const band = lo.blackBoxes.find((b) => b.pool.id === mf.poolId && b.page === nMf.page);
    // Landningspunkten på bandet – rakt under avsändaren, eller där användaren
    // dragit den. Samma delade regel som canvasen och SVG:n; draw.io får den som
    // en entryX-andel av bandets bredd så filen möter bandet på samma x.
    const entry = band
      ? `entryX=${messageFlowAndel(band, messageFlowLandning(mf, band, nMf.x + nMf.w / 2)).toFixed(4)};entryY=0;entryDx=0;entryDy=0;`
      : "";
    cells.push(
      `<mxCell id="${esc(mf.id)}" value="${esc(
        mf.label ?? "",
      )}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;dashed=1;endArrow=open;startArrow=oval;startFill=0;strokeColor=#7b8494;fontColor=#374151;${entry}" edge="1" parent="1" source="${esc(
        mf.nodeId,
      )}" target="${esc(mål)}">${waypointXml(mf, byId.get(mf.nodeId)!.dx, byId.get(mf.nodeId)!.dy, titleH)}</mxCell>`,
    );
  }

  // Titelruta.
  if (model.title) {
    cells.push(
      `<mxCell id="titlebox" value="${esc(model.title)}${
        model.subtitle ? `\n${esc(model.subtitle)}` : ""
      }" style="text;html=1;fontSize=16;fontStyle=1;align=left;verticalAlign=middle;fontColor=#1f2937;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="${lo.width}" height="${titleH}" as="geometry"/></mxCell>`,
    );
  }

  const diagramName = esc(model.title || "Systemprocess");
  return `<mxfile host="Arkitekten" type="device">
  <diagram name="${diagramName}" id="ark0">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.map((c) => "        " + c).join("\n")}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}
