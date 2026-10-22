/**
 * SVG-export (KRAV 9). Renderar den deterministiska layouten till en fristående
 * SVG-sträng – lämplig att klistra in i Word-dokumentation.
 */

import {
  BPMN_SHAPE,
  taskIcon,
  eventKind,
  type EdgeSide,
  type ProcessEdge,
  type ProcessModel,
  type NodeType,
} from "@/core/model";
import {
  hänvisningsStubbe,
  layoutModel,
  type LayoutResult,
  type LaidOutBlackBox,
  type LaidOutDataStore,
  type LaidOutPageRef,
  type LaidOutNode,
} from "../layout/layout";
import {
  labelAnchor,
  messageFlowLandning,
  pickEdgeSides,
  routeEdge,
  pointsToPath,
  type Rect,
  type Side,
} from "../layout/edge-router";
import {
  CANVAS_BG,
  decisionTextScale,
  EDGE_LABEL_BG,
  EDGE_STROKE,
  LANE_FILLS,
  LANE_HEADER_FILL,
  LANE_STROKE,
  LANE_TITLE,
  nodeStyle,
  PAGE_STROKE,
  TYPE_LABEL,
  type ColorMode,
} from "../theme";

// Texthjälparna delas med affärsprocessens former – se render/text-util.ts.
import { esc, wrap } from "../render/text-util";
import { ramKantAttribut, ramNodAttribut } from "@/core/ram";
import { revisionsMått, revisionsRuta, type Revision } from "./revision";

/**
 * Cylinderformen för ett datalager. Bruten ut ur `shapeSvg` eftersom datalager
 * numera ritas som ARTEFAKTER (egen lista i modellen) och inte som noder – båda
 * vägarna måste ge exakt samma form, annars ser samma sak olika ut beroende på
 * var i modellen den råkar bo.
 */
function cylinderSvg(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
): string {
  const ry = cylinderRy(h);
  return `<path d="M${x},${y + ry} a${w / 2},${ry} 0 0 1 ${w},0 v${h - 2 * ry} a${w / 2},${ry} 0 0 1 ${-w},0 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>
<path d="M${x},${y + ry} a${w / 2},${ry} 0 0 0 ${w},0" fill="none" stroke="${stroke}" stroke-width="1.2"/>`;
}

/**
 * Lockets ellipsradie – PROPORTIONELL mot höjden (8 px vid basmåttet 46).
 * Var tidigare fast 8 px: vid nedskalad export åt locket upp en allt större
 * del av cylindern och lockbågen (som dippar ner till y + 2·ry) strök genom
 * lagertexten hur den än centrerades.
 */
function cylinderRy(h: number): number {
  return (8 / 46) * h;
}

/** Formens SVG-element (utan text) enligt BPMN 2.0. */
let _mode: ColorMode = "type";

export function shapeSvg(ln: LaidOutNode, scale: number): string {
  const s = nodeStyle(ln.node.type, _mode);
  const { x, y, w, h } = ln;
  const bshape = BPMN_SHAPE[ln.node.type];
  const common = `fill="${s.fill}" stroke="${s.stroke}"`;

  if (bshape === "event") {
    // Cirkel med tunn (start) / tjock (slut) ring.
    const ring = (eventKind(ln.node.type) === "end" ? 4.5 : 2.5) * scale;
    const r = Math.min(w, h) / 2;
    return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${r}" ${common} stroke-width="${ring}"/>`;
  }
  if (bshape === "gateway") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" ${common} stroke-width="1.6"/>`;
  }
  if (bshape === "dataStore") {
    return cylinderSvg(x, y, w, h, s.fill, s.stroke);
  }
  // Task – rundad rektangel (BPMN task).
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10 * scale}" ry="${10 * scale}" ${common} stroke-width="1.6"/>`;
}

/** BPMN-symbol/ikon ovanpå formen: gateway ✕/✚ eller task-typ-ikon. */
function symbolSvg(ln: LaidOutNode, scale: number): string {
  const s = nodeStyle(ln.node.type, _mode);
  const bshape = BPMN_SHAPE[ln.node.type];
  if (bshape === "gateway") {
    const sym = ln.node.gateway === "parallel" ? "+" : "✕";
    const cx = ln.x + ln.w / 2;
    const cy = ln.y + ln.h * 0.32;
    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${(
      13 * scale
    ).toFixed(1)}" font-weight="700" fill="${s.stroke}">${sym}</text>`;
  }
  if (bshape === "task") {
    const icon = taskIcon(ln.node);
    if (icon === "none") return "";
    return taskIconSvg(icon, ln.x + 7 * scale, ln.y + 7 * scale, 11 * scale, s.stroke);
  }
  return "";
}

/** Liten vektor-ikon för task-typ (User / Service / Send). */
function taskIconSvg(icon: string, x: number, y: number, size: number, color: string): string {
  const u = size / 16; // enhetsskala mot 16-rutnätet
  const g = (inner: string) =>
    `<g transform="translate(${x},${y}) scale(${u})" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
  switch (icon) {
    case "user":
      return g(`<circle cx="8" cy="5" r="2.6"/><path d="M3 13.5c0-2.6 2.2-4 5-4s5 1.4 5 4"/>`);
    case "service":
      return g(
        `<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/>`,
      );
    case "receive":
      // Receive Task: kuvert med öppen flik.
      return (
        `<g stroke="${color}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round" ` +
        `transform="translate(${x} ${y}) scale(${size / 16})">` +
        `<rect x="2" y="4" width="12" height="8" rx="1"/><path d="M2.5 11.5 8 7.5l5.5 4"/></g>`
      );
    case "send":
      return g(`<rect x="2" y="4" width="12" height="8" rx="1"/><path d="M2.5 4.5 8 8.5l5.5-4"/>`);
    default:
      return "";
  }
}

function textSvg(ln: LaidOutNode, scale: number, textScale = 1): string {
  const s = nodeStyle(ln.node.type, _mode);
  const bshape = BPMN_SHAPE[ln.node.type];
  // Textens faktor: global textstorlek × objektets egen (samma som canvasen).
  // En lång beslutsfråga krymps dessutom så den ryms i romben (delad regel).
  let t = textScale * (ln.node.textSize ?? 1);
  if (bshape === "gateway") t *= decisionTextScale(ln.node.label);
  // Event-cirklar och romber är smala – bryt tätare så texten ryms. Mindre
  // text ger plats för fler tecken per rad.
  const basMax = bshape === "event" ? 10 : bshape === "gateway" ? 13 : 18;
  const lines = wrap(ln.node.label, Math.round(basMax / Math.max(0.4, t)));
  const lineH = 15 * scale * t;
  const pad = 8 * scale;
  // Ikonen bor i övre vänstra hörnet på tasks – texten centreras i ytan UNDER
  // ikonraden så en lång etikett aldrig hamnar bakom kuvertet (samma som
  // canvasens padding-top).
  const ikonZon = bshape === "task" && taskIcon(ln.node) !== "none" ? 14 * scale : 0;

  // Placering (canvasens flexlägen översatta till SVG-koordinater).
  const p = ln.node.textPlacement;
  let anchor = "middle";
  let x = ln.x + ln.w / 2;
  if (p === "left") {
    anchor = "start";
    x = ln.x + pad;
  } else if (p === "right") {
    anchor = "end";
    x = ln.x + ln.w - pad;
  }
  let startY =
    ln.y + ikonZon + (ln.h - ikonZon) / 2 - ((lines.length - 1) * lineH) / 2 + 4 * scale;
  if (p === "top") startY = ln.y + ikonZon + pad + 10 * scale * t;
  else if (p === "bottom") startY = ln.y + ln.h - pad - (lines.length - 1) * lineH - 2 * scale;

  return lines
    .map(
      (l, i) =>
        `<text x="${x.toFixed(1)}" y="${(startY + i * lineH).toFixed(1)}" text-anchor="${anchor}" font-family="Segoe UI, Arial, sans-serif" font-size="${(
          12 * scale * t
        ).toFixed(1)}" fill="${s.text}">${esc(l)}</text>`,
    )
    .join("\n");
}

/** Kant-ändpunkt på den sida av noden som vetter mot flödesriktningen. */
function port(n: LaidOutNode, side: EdgeSide) {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  switch (side) {
    case "top":
      return { x: cx, y: n.y };
    case "bottom":
      return { x: cx, y: n.y + n.h };
    case "left":
      return { x: n.x, y: cy };
    case "right":
      return { x: n.x + n.w, y: cy };
  }
}

/**
 * Vilka sidor kanten lämnar/möter noderna på. Regeln (ISO 5807 + manuella val)
 * bor i edge-router.ts och delas med canvasen – ändra den DÄR, inte här.
 */
function edgeSides(a: LaidOutNode, b: LaidOutNode, edge?: ProcessEdge): [EdgeSide, EdgeSide] {
  return pickEdgeSides(a, b, edge);
}

/**
 * Ortogonal, KOLLISIONSUNDVIKANDE väg mellan två noder. Alla objekt utom de två
 * ändarna är hinder som routern går runt.
 */
function edgeRoute(
  a: LaidOutNode,
  b: LaidOutNode,
  obstacles: Rect[],
  edge?: ProcessEdge,
): { x: number; y: number }[] {
  const [sa, sb] = edgeSides(a, b, edge);
  // Manuell brytpunkt ligger i fri-layoutens koordinater. Källnodens förskjutning
  // (dx/dy) översätter den till det här utläggets rymd, så export matchar skärmen.
  const via = edge?.waypoint
    ? { x: edge.waypoint.x + a.dx, y: edge.waypoint.y + a.dy }
    : null;
  return routeEdge({
    from: port(a, sa),
    fromSide: sa as Side,
    to: port(b, sb),
    toSide: sb as Side,
    obstacles,
    via,
  });
}

// labelAnchor delas med canvasen – se layout/edge-router.ts.

// BORTTAGET: orthPath(). De streckade kopplingarna routas nu av routeEdge –
// samma kollisionsundvikande router som sekvensflödena och canvasen – i stället
// för en fast Z-form som gick rakt genom mellanliggande objekt.

/** En rektangel som en linje kan klippas mot (nod eller artefakt). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}


/** Datalager-artefakter: cylindrar utanför sekvensflödet. */
function dataStoresSvg(stores: LaidOutDataStore[], scale: number, textScale = 1): string[] {
  const s = nodeStyle("datastore", _mode);
  return stores.flatMap((ds) => {
    const t = textScale * (ds.store.textSize ?? 1);
    // SAMMA textstorlek som noderna (12 × skala × faktor) – canvasen ritar
    // datalagren så. Exporten låg på 10,5 och blev oläslig i Word: hela
    // Word-figurens bredd är dimensionerad för att 12-punktstexten ska landa
    // på minst ~7 pt, och en mindre bas hamnar under läsbarhetsgolvet.
    const lines = wrap(ds.store.label, Math.round(16 / Math.max(0.4, t)));
    const cx = ds.x + ds.w / 2;
    // Texten bor i bandet UNDER lockbågen, som dippar ner till y + 2·ry.
    // Ryms inte raderna där krymps texten tills de gör det – lockets linje
    // får ALDRIG stryka genom texten.
    const ry = cylinderRy(ds.h);
    const bandTopp = ds.y + 2 * ry + 1;
    const bandHöjd = ds.y + ds.h - 2 - bandTopp;
    const fitFaktor = Math.min(1, bandHöjd / (lines.length * 15 * scale * t));
    const fontSize = 12 * scale * t * fitFaktor;
    const lineH = 15 * scale * t * fitFaktor;
    const startY =
      bandTopp + bandHöjd / 2 - ((lines.length - 1) * lineH) / 2 + fontSize * 0.35;
    return [
      `<g ${ramNodAttribut(esc, ds.store.id, ds.x, ds.y, ds.w, ds.h)}>`,
      cylinderSvg(ds.x, ds.y, ds.w, ds.h, s.fill, s.stroke),
      ...lines.map(
        (l, i) =>
          `<text x="${cx}" y="${(startY + i * lineH).toFixed(1)}" text-anchor="middle" font-size="${fontSize.toFixed(1)}" fill="${s.text}">${esc(l)}</text>`,
      ),
      `</g>`,
    ];
  });
}

/**
 * Dataassociationer: streckad linje UTAN fylld pilspets mellan aktivitet och
 * datalager. Riktningen visar om aktiviteten skriver till eller läser från
 * lagret – den får aldrig se ut som ett sekvensflöde.
 */
function dataAssociationsSvg(
  model: ProcessModel,
  nodeById: Map<string, LaidOutNode>,
  storeById: Map<string, LaidOutDataStore>,
  allaHinder: { id: string; r: Rect }[],
  skala = 1,
): string[] {
  const out: string[] = [];
  const port = (b: Box, sida: EdgeSide) => {
    switch (sida) {
      case "top": return { x: b.x + b.w / 2, y: b.y };
      case "bottom": return { x: b.x + b.w / 2, y: b.y + b.h };
      case "left": return { x: b.x, y: b.y + b.h / 2 };
      case "right": return { x: b.x + b.w, y: b.y + b.h / 2 };
    }
  };
  for (const a of model.dataAssociations) {
    const n = nodeById.get(a.nodeId);
    const ds = storeById.get(a.dataStoreId);
    if (!n || !ds) continue;
    // Associationen är en annotering, inte flödet. Korsar den en sidbrytning
    // ritas den inte alls – ett streckat streck tvärs genom dokumentet säger
    // mindre än artefakten själv gör där den står.
    if (n.page !== ds.page) continue;
    // Sidorna väljs av GEOMETRIN med samma delade regel som sekvensflödena
    // (pickEdgeSides): ligger målet nedanför går pilen ut ur UNDERKANTEN, inte
    // ut ur toppen och runt. Hårdkodade riktningar ("skrivning nedåt, läsning
    // uppåt") stämde bara när lagret råkade ligga under sin läsare. Manuella
    // val vinner som alltid.
    const skriv = a.direction === "write";
    const källa = skriv ? n : ds;
    const mål = skriv ? ds : n;
    const [frånSida, tillSida] = pickEdgeSides(källa, mål, {
      sourceSide: a.sourceSide,
      targetSide: a.targetSide,
    });
    const hinder = allaHinder.filter((h) => h.id !== a.nodeId && h.id !== a.dataStoreId).map((h) => h.r);
    // Manuell brytpunkt ligger i fri-layoutens koordinater, alltid i
    // AKTIVITETENS ram (samma regel som canvasen sparar med – oavsett om
    // associationen är en skrivning eller en läsning).
    const via = a.waypoint ? { x: a.waypoint.x + n.dx, y: a.waypoint.y + n.dy } : null;
    const pts = routeEdge({
      from: port(källa, frånSida),
      fromSide: frånSida,
      to: port(mål, tillSida),
      toSide: tillSida,
      obstacles: hinder,
      via,
    });
    out.push(
      `<path d="${pointsToPath(pts)}" fill="none" stroke="${EDGE_STROKE}" stroke-width="1.2" stroke-dasharray="5 4" marker-end="url(#arwData)"/>`,
    );
    // Etiketten ritas med SAMMA ruta och ankare som sekvensflödenas – en
    // streckad koppling kan bära en etikett man skrivit för hand, och den måste
    // finnas i filen också.
    if (a.label) {
      const m = labelAnchor(pts, undefined);
      const w = (8 + a.label.length * 6.5) * skala;
      const h = 16 * skala;
      out.push(
        `<rect x="${(m.x - w / 2).toFixed(1)}" y="${(m.y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(3 * skala).toFixed(1)}" fill="${EDGE_LABEL_BG}" stroke="${LANE_STROKE}"/>` +
          `<text x="${m.x.toFixed(1)}" y="${(m.y + 3.5 * skala).toFixed(1)}" text-anchor="middle" font-size="${(11 * skala).toFixed(1)}" fill="#374151">${esc(a.label)}</text>`,
      );
    }
  }
  return out;
}

/** Svart-låda-pooler: tom ram med deltagarens namn som vertikal vänsteretikett. */
function blackBoxesSvg(boxes: LaidOutBlackBox[], scale: number): string[] {
  const out: string[] = [];
  for (const b of boxes) {
    out.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${LANE_STROKE}" stroke-width="1.5"/>`,
    );
    out.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.labelW}" height="${b.h}" fill="#e4e8ee" stroke="${LANE_STROKE}"/>`,
    );
    // Deltagarnamnet skrivs VÅGRÄTT. En svart låda är ett lågt band – roterad
    // text får inte plats på höjden utan svämmar ut och kolliderar med
    // grannbandets etikett.
    out.push(
      `<text x="${b.x + b.labelW + 12}" y="${b.y + b.h / 2}" font-size="${(11 * scale).toFixed(
        1,
      )}" font-weight="700" fill="${LANE_TITLE}" dominant-baseline="middle" letter-spacing="0.3">${esc(
        b.pool.title.toUpperCase(),
      )}</text>`,
    );
  }
  return out;
}

/**
 * Meddelandeflöden: streckad linje med ÖPPEN pilspets från aktivitetens
 * underkant ned till mottagarpoolens överkant. Korsar poolgränsen – vilket är
 * precis det ett sekvensflöde aldrig får göra.
 */
function messageFlowsSvg(
  model: ProcessModel,
  nodeById: Map<string, LaidOutNode>,
  boxes: LaidOutBlackBox[],
  scale: number,
): string[] {
  const out: string[] = [];
  for (const mf of model.messageFlows) {
    const n = nodeById.get(mf.nodeId);
    if (!n) continue;
    // STRIKT BPMN: målet är alltid en annan deltagare (svart-låda-pool).
    // Mottagarbandet finns på VARJE sida – ta det på avsändarens egen sida,
    // annars drar pilen tvärs genom hela dokumentet till sida 1:s band.
    const b = boxes.find((x) => x.pool.id === mf.poolId && x.page === n.page);
    if (!b) continue;
    // Meddelandeflödet går RAKT NER (eller rakt ut från vald sida och sedan
    // ner) till mottagarbandet – ingen väjning. Det är en streckad annotering
    // som ritas UNDER objekten, så en rak väg skymmer ingenting; väjningen
    // gav i stället omotiverade böjar åt sidan.
    const frånSida: EdgeSide = mf.sourceSide ?? "bottom";
    const frånPort =
      frånSida === "bottom" ? { x: n.x + n.w / 2, y: n.y + n.h }
      : frånSida === "top" ? { x: n.x + n.w / 2, y: n.y }
      : frånSida === "left" ? { x: n.x, y: n.y + n.h / 2 }
      : { x: n.x + n.w, y: n.y + n.h / 2 };
    // Har man dragit i böjen äger man vägen – den raka vägen ner är ett förval,
    // inte ett förbud. Brytpunkten ligger i avsändarnodens fria koordinater.
    const via = mf.waypoint ? { x: mf.waypoint.x + n.dx, y: mf.waypoint.y + n.dy } : null;
    // Landningspunkten ur SAMMA regel som canvasen: rakt under avsändaren, eller
    // där användaren dragit den (`targetPos`). Här stod `frånPort.x` rakt av, så
    // en flyttad landningspunkt syntes bara på skärmen och inte i filen.
    const till = { x: messageFlowLandning(mf, b, n.x + n.w / 2), y: b.y };
    const pts = routeEdge({
      from: frånPort,
      fromSide: frånSida,
      to: till,
      toSide: "top",
      obstacles: [],
      via,
    });
    out.push(
      `<path d="${pointsToPath(pts)}" fill="none" stroke="${EDGE_STROKE}" stroke-width="1.4" stroke-dasharray="6 4" marker-end="url(#arwOpen)"/>`,
    );
    if (mf.label) {
      const x = n.x + n.w / 2;
      out.push(
        `<text x="${x + 6 * scale}" y="${(n.y + n.h + b.y) / 2}" font-size="${(11 * scale).toFixed(1)}" fill="#374151">${esc(mf.label)}</text>`,
      );
    }
  }
  return out;
}

/** Ritar sidhänvisningarna som layouten redan har räknat ut. */
function pageRefsSvg(refs: LaidOutPageRef[], scale: number): string[] {
  return refs.map((r) => {
    return (
      `<path d="${hänvisningsStubbe(r)
        .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ")}" stroke="${EDGE_STROKE}" stroke-width="1.6" fill="none"/>` +
      `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" rx="${(r.h / 2).toFixed(1)}" fill="${EDGE_LABEL_BG}" stroke="${PAGE_STROKE}" stroke-width="1.2"/>` +
      `<text x="${(r.x + r.w / 2).toFixed(1)}" y="${(r.y + r.h / 2 + 3.5 * scale).toFixed(1)}" text-anchor="middle" font-size="${(9.5 * scale).toFixed(1)}" fill="#8a7a53">${esc(r.text)}</text>`
    );
  });
}

/**
 * Pilspetsarna – innehållet i `<defs>`. Delas med scenen till EA-portalen
 * (`scen-flodesschema.ts`), som refererar samma id:n.
 *
 * viewBox är INTE valfri. Utan den tolkas refX/refY i en annan skala än
 * markörens innehåll, så spetsen hamnar vid sidan av linjen i stället för
 * på den – vilket ser ut som att pilen pekar snett. Med viewBox mappas
 * innehållet korrekt in i markerWidth × markerHeight.
 *
 * markerUnits="userSpaceOnUse" gör storleken oberoende av linjetjockleken,
 * så de tre pilarna blir lika stora trots olika stroke-width.
 */
export function flödesMarkörer(): string {
  return (
    `<marker id="arw" viewBox="0 0 10 10" markerWidth="9" markerHeight="9" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">` +
    `<path d="M1,2.4 L9,5 L1,7.6 Z" fill="${EDGE_STROKE}"/></marker>` +
    // Meddelandeflöde: öppen spets, BPMN-konvention.
    `<marker id="arwOpen" viewBox="0 0 10 10" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">` +
    `<path d="M1.5,1.5 L9,5 L1.5,8.5" fill="none" stroke="${EDGE_STROKE}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>` +
    // Dataassociation: svagare koppling, alltså en mindre och tunnare spets.
    `<marker id="arwData" viewBox="0 0 10 10" markerWidth="7.5" markerHeight="7.5" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">` +
    `<path d="M2,2 L9,5 L2,8" fill="none" stroke="${EDGE_STROKE}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></marker>`
  );
}

/**
 * Det som ligger BAKOM flödet: sidramar, pool, banor och mottagarpooler.
 * Exporten och scenen ritar samma bakgrund ur samma funktion.
 */
export function bakgrundSvg(lo: LayoutResult): string[] {
  const parts: string[] = [];
  // Sidramar först, längst bak: ett papper per sida med tydligt mellanrum, så
  // att flersidiga utlägg läses som ett dokument och inte som ett enda högt
  // diagram med upprepade banrubriker.
  for (const sida of lo.pages) {
    // Ramen hör till ÖVERSIKTEN av flera delar. En ensam del som ska klistras
    // in i Word ska inte ha någon kantlinje runt sig – bara sin etikett.
    if (lo.pages.length > 1) {
      parts.push(
        `<rect x="${sida.x}" y="${sida.y}" width="${sida.w}" height="${sida.h}" fill="#ffffff" stroke="${PAGE_STROKE}" stroke-width="1.5"/>`,
      );
    }
    if (sida.label) {
      parts.push(
        `<text x="${sida.x + sida.w}" y="${sida.y + sida.h + 14}" text-anchor="end" font-size="11" fill="${PAGE_STROKE}">${esc(sida.label)}</text>`,
      );
    }
  }

  // BPMN-pool: ram runt alla lanes + tunn vänsteretikett (vertikal text). En
  // ram per sida.
  for (const p of lo.pools) {
    parts.push(
      `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="none" stroke="${LANE_STROKE}" stroke-width="1.5"/>`,
    );
    parts.push(
      `<rect x="${p.x}" y="${p.y}" width="${p.labelW}" height="${p.h}" fill="#e4e8ee" stroke="${LANE_STROKE}"/>`,
    );
    const lcx = p.x + p.labelW / 2;
    const lcy = p.y + p.h / 2;
    parts.push(
      `<text x="${lcx}" y="${lcy}" transform="rotate(-90 ${lcx} ${lcy})" text-anchor="middle" font-size="${(
        11 * lo.scale
      ).toFixed(1)}" font-weight="700" fill="${LANE_TITLE}" dominant-baseline="middle" letter-spacing="0.3">${esc(
        p.title.toUpperCase(),
      )}</text>`,
    );
  }

  // Swimlane-band – rubriken som topprad så hela bredden kan användas.
  // Färgen följer banans plats i ORDNINGEN, inte dess plats i listan: annars
  // byter samma bana färg mellan sidorna i ett flersidigt utlägg.
  const laneOrder = new Map<string, number>();
  for (const l of lo.lanes) if (!laneOrder.has(l.id)) laneOrder.set(l.id, laneOrder.size);
  lo.lanes.forEach((lane) => {
    const i = laneOrder.get(lane.id) ?? 0;
    parts.push(
      `<rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="${lane.h}" fill="${LANE_FILLS[i % LANE_FILLS.length]}" stroke="${LANE_STROKE}"/>`,
    );
    parts.push(
      `<rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="${lane.headerH}" fill="${LANE_HEADER_FILL}" stroke="${LANE_STROKE}"/>`,
    );
    parts.push(
      `<text x="${lane.x + 12}" y="${lane.y + lane.headerH / 2}" font-size="${(12.5 * lo.scale).toFixed(
        1,
      )}" font-weight="600" fill="${LANE_TITLE}" dominant-baseline="middle">${esc(lane.title)}</text>`,
    );
  });

  // Svart-låda-pooler (mottagare) – tomma ramar under processens pool.
  parts.push(...blackBoxesSvg(lo.blackBoxes, lo.scale));

  return parts;
}

/** Alla objekt är potentiella hinder; per kant undantas dess två ändar. */
function hinderAv(lo: LayoutResult): { id: string; r: Rect }[] {
  return [
    ...lo.nodes.map((n) => ({ id: n.node.id, r: { x: n.x, y: n.y, w: n.w, h: n.h } })),
    ...lo.dataStores.map((d) => ({ id: d.store.id, r: { x: d.x, y: d.y, w: d.w, h: d.h } })),
  ];
}

/** Ett sekvensflöde med sin färdiga väg. */
export interface RuttatFlöde {
  edge: ProcessEdge;
  pts: { x: number; y: number }[];
}

/**
 * Sekvensflödena, ruttade runt alla andra objekt. Kanter som korsar en
 * sidbrytning utelämnas – där ritas en sidhänvisning i stället (märkena kommer
 * ur layouten, se pageRefsSvg).
 */
export function ruttaSekvensflöden(model: ProcessModel, lo: LayoutResult): RuttatFlöde[] {
  const byId = new Map(lo.nodes.map((n) => [n.node.id, n]));
  const allaHinder = hinderAv(lo);
  const ut: RuttatFlöde[] = [];
  for (const e of model.edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    if (a.page !== b.page) continue;
    const hinder = allaHinder.filter((h) => h.id !== e.source && h.id !== e.target).map((h) => h.r);
    ut.push({ edge: e, pts: edgeRoute(a, b, hinder, e) });
  }
  return ut;
}

/**
 * En kants etikett (Ja/Nej m.fl.) – ruta och text på kantens ankare.
 *
 * Samma ankare som canvasen: längsta raka (helst vågräta) segmentet, eller
 * användarens egen andel. EN regel, en plats (labelAnchor). Etiketten måste
 * följa skalan. Gör den inte det växer "Ja"/"Nej" sig större än noderna så
 * fort diagrammet krymps för att rymmas på sidan.
 */
export function kantEtikettSvg(
  label: string,
  pts: { x: number; y: number }[],
  labelPos: number | undefined,
  s: number,
): string {
  const m = labelAnchor(pts, labelPos);
  const w = (8 + label.length * 6.5) * s;
  const h = 16 * s;
  return (
    `<rect x="${(m.x - w / 2).toFixed(1)}" y="${(m.y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(3 * s).toFixed(1)}" fill="${EDGE_LABEL_BG}" stroke="${LANE_STROKE}"/>` +
    `<text x="${m.x.toFixed(1)}" y="${(m.y + 3.5 * s).toFixed(1)}" text-anchor="middle" font-size="${(11 * s).toFixed(1)}" fill="#374151">${esc(label)}</text>`
  );
}

/**
 * Artefakterna mellan kanterna och noderna: streckade dataassociationer,
 * sidhänvisningar, datalager och meddelandeflöden ut till mottagarpoolerna.
 */
export function artefakterSvg(model: ProcessModel, lo: LayoutResult, textScale = 1): string[] {
  const byId = new Map(lo.nodes.map((n) => [n.node.id, n]));
  const storeById = new Map(lo.dataStores.map((ds) => [ds.store.id, ds]));
  return [
    ...dataAssociationsSvg(model, byId, storeById, hinderAv(lo), lo.scale),
    ...pageRefsSvg(lo.pageRefs, lo.scale),
    ...dataStoresSvg(lo.dataStores, lo.scale, textScale),
    ...messageFlowsSvg(model, byId, lo.blackBoxes, lo.scale),
  ];
}

/**
 * Ett objekt färdigritat: form, symbol och text, i nodens EGNA koordinater
 * (`ln.x/ln.y`). Scenen anropar med x = y = 0 och får ett lokalt fragment.
 */
export function nodSvg(ln: LaidOutNode, scale: number, textScale = 1, colorMode: ColorMode = "type"): string {
  _mode = colorMode;
  return [shapeSvg(ln, scale), symbolSvg(ln, scale), textSvg(ln, scale, textScale)].join("\n");
}


/** SVG:n plus sina mått – rastreringen till PNG behöver bredd och höjd. */
export interface SizedSvg {
  svg: string;
  width: number;
  height: number;
}

export function renderSvg(
  model: ProcessModel,
  layout?: LayoutResult,
  colorMode: ColorMode = "type",
  textScale = 1,
  revision?: Revision,
): string {
  return renderSvgSized(model, layout, colorMode, textScale, revision).svg;
}

export function renderSvgSized(
  model: ProcessModel,
  layout?: LayoutResult,
  colorMode: ColorMode = "type",
  /** Global textstorlek (bara texten, inte objekten) – samma som canvasen. */
  textScale = 1,
  /** Vem/när/vilken version – ritas som en liten ruta nere till höger. */
  revision?: Revision,
): SizedSvg {
  _mode = colorMode;
  const lo = layout ?? layoutModel(model);
  const titleH = model.title ? 46 : 0;
  const pad = 16;
  // Teckenförklaringen ritas UNDER diagrammet – reservera höjd för den.
  const legendH = colorMode === "type" ? legendHeight(model, lo.width, pad) : 0;
  // Revisionsrutan delar remsa med teckenförklaringen (den ena till vänster,
  // den andra till höger) och kostar bara höjd när remsan är för låg för den.
  const rev = revisionsMått(revision);
  const remsa = Math.max(legendH, rev.h ? rev.h + LEGEND_TOP_GAP : 0);
  const W = lo.width + pad * 2;
  const H = lo.height + titleH + pad * 2 + remsa;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="${CANVAS_BG}"/>`);
  parts.push(`<defs>${flödesMarkörer()}</defs>`);

  parts.push(`<g transform="translate(${pad},${pad})">`);

  // Titel.
  if (model.title) {
    parts.push(
      `<text x="0" y="20" font-size="18" font-weight="700" fill="#1f2937">${esc(model.title)}</text>`,
    );
    if (model.subtitle)
      parts.push(`<text x="0" y="38" font-size="12" fill="#6b7280">${esc(model.subtitle)}</text>`);
  }

  parts.push(`<g transform="translate(0,${titleH})">`);

  parts.push(...bakgrundSvg(lo));

  // Kanter. `model.edges` innehåller ENBART sekvensflöden: heldragen linje med
  // fylld pilspets. Meddelandeflöden och dataassociationer bor i egna listor.
  // Etiketterna samlas separat och ritas EFTER noderna – annars göms en Ja/Nej
  // som hamnar nära en nod bakom noden (noderna ritas sist, överst).
  const edgeLabels: string[] = [];
  for (const { edge: e, pts } of ruttaSekvensflöden(model, lo)) {
    // Märkt med kopplingens STABILA nyckel – ramarna (core/ram.ts) hittar den
    // så, utan att rita om vägen själva.
    parts.push(
      `<path d="${pointsToPath(pts)}" fill="none" stroke="${EDGE_STROKE}" stroke-width="1.6" marker-end="url(#arw)" ${ramKantAttribut(esc, e.source, e.target, e.label)}/>`,
    );
    if (e.label) edgeLabels.push(kantEtikettSvg(e.label, pts, e.labelPos, lo.scale));
  }

  parts.push(...artefakterSvg(model, lo, textScale));

  // Noder.
  // Varje objekt i en egen grupp märkt med id och ruta – ramarna lägger sina
  // markeringar kring rutan (core/ram.ts).
  for (const ln of lo.nodes) {
    parts.push(`<g ${ramNodAttribut(esc, ln.node.id, ln.x, ln.y, ln.w, ln.h)}>`);
    parts.push(nodSvg(ln, lo.scale, textScale, colorMode));
    parts.push(`</g>`);
  }

  // Kant-etiketter (Ja/Nej m.fl.) överst så de aldrig göms bakom en nod.
  parts.push(...edgeLabels);

  parts.push(`</g></g>`); // stäng flödes- och rotgruppen

  // Teckenförklaring – bara i typfärgsläge, annars är färgerna neutrala.
  if (colorMode === "type") parts.push(legendSvg(model, lo, titleH, pad));
  if (rev.h) {
    parts.push(
      revisionsRuta(W - pad - rev.w, titleH + pad + lo.height + LEGEND_TOP_GAP - 9, revision),
    );
  }

  parts.push(`</svg>`);
  return { svg: parts.join("\n"), width: W, height: H };
}

const LEGEND_SWATCH_W = 14;
const LEGEND_SWATCH_H = 10;
const LEGEND_ITEM_GAP = 14;
const LEGEND_ROW_H = 15;
const LEGEND_TOP_GAP = 16;
/** Plats för rubriken "TECKENFÖRKLARING" först på raden. */
const LEGEND_TITLE_W = 106;

/** Nodtyper som förekommer, i visningsordning. */
function legendRows(model: ProcessModel): NodeType[] {
  const typer = new Set<string>(model.nodes.map((n) => n.type));
  if (model.dataStores.length) typer.add("datastore");
  const ordning: NodeType[] = [
    "start",
    "activity",
    "decision",
    "system",
    "integration",
    "notification",
    "datastore",
    "end",
  ];
  return ordning.filter((t) => typer.has(t));
}

/** Bredd på en teckenförklaringspost: färgruta + text + luft. */
function legendItemWidth(t: NodeType): number {
  return LEGEND_SWATCH_W + 6 + TYPE_LABEL[t].length * 5.6 + LEGEND_ITEM_GAP;
}

/**
 * Ritar en teckenförklaring för de nodtyper som faktiskt förekommer.
 *
 * Posterna ligger på en RAD (och bryts till nästa när bredden tar slut) i
 * stället för staplade under varandra. En lodrät lista på åtta rader tog en
 * fjärdedel av en liten Word-figur; på rader kostar den en tunn remsa.
 */
function legendSvg(model: ProcessModel, lo: LayoutResult, titleH: number, pad: number): string {
  const rader = legendRows(model);
  const x0 = pad;
  const y0 = titleH + pad + lo.height + LEGEND_TOP_GAP;
  const out: string[] = [];

  // Rubriken inleder raden. Utan den vet inte läsaren av rapporten vad
  // färgrutorna betyder – en lös rad med rutor säger ingenting.
  let x = x0;
  let y = y0;
  if (rader.length) {
    out.push(
      `<text x="${x0}" y="${y0}" font-size="9" font-weight="700" fill="${LANE_TITLE}" letter-spacing="0.3">TECKENFÖRKLARING</text>`,
    );
    x += LEGEND_TITLE_W;
  }
  for (const t of rader) {
    const w = legendItemWidth(t);
    if (x > x0 && x + w > x0 + lo.width) {
      x = x0;
      y += LEGEND_ROW_H;
    }
    const st = nodeStyle(t, "type");
    out.push(
      `<rect x="${x.toFixed(1)}" y="${(y - LEGEND_SWATCH_H + 1).toFixed(1)}" width="${LEGEND_SWATCH_W}" height="${LEGEND_SWATCH_H}" rx="2" fill="${st.fill}" stroke="${st.stroke}"/>`,
    );
    out.push(
      `<text x="${(x + LEGEND_SWATCH_W + 6).toFixed(1)}" y="${y.toFixed(1)}" font-size="10" fill="#374151">${esc(TYPE_LABEL[t])}</text>`,
    );
    x += w;
  }
  return out.join("\n");
}

/** Höjden teckenförklaringen tar, givet hur många rader posterna bryts på. */
function legendHeight(model: ProcessModel, width: number, pad: number): number {
  const rader = legendRows(model);
  if (!rader.length) return 0;
  let x = pad + LEGEND_TITLE_W;
  let rad = 1;
  for (const t of rader) {
    const w = legendItemWidth(t);
    if (x > pad && x + w > pad + width) {
      x = pad;
      rad++;
    }
    x += w;
  }
  return LEGEND_TOP_GAP + rad * LEGEND_ROW_H;
}
