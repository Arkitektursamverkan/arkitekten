/**
 * Interaktiv rityta för Affärsprocess (fas 5).
 *
 * Byggd på React Flow precis som flödesschemats canvas, med SAMMA delade
 * byggstenar: formerna renderas med former (exportens SVG-markup rakt av,
 * så skärm och fil aldrig glider isär), relationerna routas av RoutedEdge
 * (samma edge-router och brytpunktsdragning som allt annat).
 *
 * Direktredigering:
 *  - dra objekt – positionen sparas i FRIA layoutens koordinater (invariant 5:
 *    skärmläge − dx) och delen ändras aldrig av ett musdrag (R4),
 *  - dra brytpunktshandtaget på en relation för att styra banan,
 *  - klicka på ett objekt → inspektörspanelen (ApInspector) öppnas i ApTool.
 */

import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { edgeKey, type EdgeSides } from "@/core/draft";
import type { EdgeSide } from "@/core/model";
import { pickEdgeSides, type Rect } from "../flowchart/layout/edge-router";
import { GENOMSLÄPPLIG, PAN_BUTTONS, SELECTION_KEY } from "../flowchart/render/canvas-gester";
import { PekarVal, type Pekarläge } from "../flowchart/render/PekarVal";
import { edgePaths, obstacleRects, portRects, RoutedEdge, type RoutedEdgeData } from "../flowchart/render/RoutedEdge";
import { EdgeEndpoints } from "../flowchart/render/EdgeEndpoints";
import { GuideView } from "../flowchart/render/GuideView";
import {
  applyAlignment,
  SNAP_TOLERANCE,
  type Guides,
  type SnapChange,
  type SnapNode,
} from "../flowchart/render/snap";
import { PAGE_STROKE } from "../flowchart/theme";
import {
  apNodeSvg,
  apRelationEtikett,
  apRelationFärg,
  ikonPortRuta,
  relationHint,
  apHörnradie,
  AP_TYPE_LABEL,
} from "./former";
import type { ApRelation } from "@/core/affarsprocess";
import { apPortPunkt, type ApLayout } from "./layout-affarsprocess";
import { säkerSvg } from "@/render/saker-svg";

/* ---- Nodvyer ---- */

interface ApNodeData extends Record<string, unknown> {
  /** Färdig SVG-markup från den delade formmodulen. */
  inner: string;
  w: number;
  h: number;
  typ: string;
}

function ApNodeView({ data, isConnectable }: NodeProps) {
  const d = data as ApNodeData;
  return (
    <div className="ark-ap-nod" style={{ width: d.w, height: d.h }} title={d.typ}>
      <svg
        width={d.w}
        height={d.h}
        viewBox={`0 0 ${d.w} ${d.h}`}
        // overflow: SVG klipper vid sin ruta som standard – exporten ritar i
        // hela dokumentets SVG och klipper aldrig, så utan detta såg skärmen
        // annorlunda ut än filen (kapade etiketter).
        style={{ overflow: "visible" }}
        // Samma markup som SVG-exporten – medvetet, för render-paritet.
        dangerouslySetInnerHTML={{ __html: d.inner }}
      />
      {/* Samma par-upplägg som flödesschemat: målhandtag kan bara vara SLUT
          på en dragning, källhandtag bara START – annars låg de i vägen för
          varandra och kopplingspunkterna gick inte att dra alls.

          Handtagen sitter i RUTANS kant, även för ikontyperna vars symbol är
          liten. Flyttades de in till symbolen hamnade de mitt i rutan och tog
          emot musnedslaget när man ville DRA objektet – man ritade en pil i
          stället för att flytta. Att pilen ändå möter symbolen sköts av
          routerns portruta (portRects). */}
      {/* `isConnectable` MÅSTE skickas vidare till varje handtag.
          React Flows Handle har `isConnectable = true` som STANDARD, och
          nodens egen flagga (`nodesConnectable` / `node.connectable`) når den
          bara via den här propen. Utan den gick det att dra nya kopplingar på
          en LÅST rityta – i läsläge, där ingenting ska gå att ändra. */}
      <Handle id="t-top" type="target" position={Position.Top} className="ark-handle" isConnectable={isConnectable} isConnectableStart={false} />
      <Handle id="t-left" type="target" position={Position.Left} className="ark-handle" isConnectable={isConnectable} isConnectableStart={false} />
      <Handle id="t-right" type="target" position={Position.Right} className="ark-handle" isConnectable={isConnectable} isConnectableStart={false} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} className="ark-handle" isConnectable={isConnectable} isConnectableStart={false} />
      <Handle id="s-top" type="source" position={Position.Top} className="ark-handle" isConnectable={isConnectable} isConnectableEnd={false} />
      <Handle id="s-left" type="source" position={Position.Left} className="ark-handle" isConnectable={isConnectable} isConnectableEnd={false} />
      <Handle id="s-right" type="source" position={Position.Right} className="ark-handle" isConnectable={isConnectable} isConnectableEnd={false} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} className="ark-handle" isConnectable={isConnectable} isConnectableEnd={false} />
    </div>
  );
}

function ApFrameView({ data }: NodeProps) {
  const d = data as { w: number; h: number; label: string };
  return (
    <div
      className="ark-ap-ram"
      style={{ width: d.w, height: d.h, borderColor: PAGE_STROKE, color: PAGE_STROKE }}
    >
      <span>{d.label}</span>
    </div>
  );
}

function ApRefView({ data }: NodeProps) {
  const d = data as { text: string; riktning: "ut" | "in" };
  return (
    <div className="ark-ap-ref">
      {d.riktning === "ut" ? `→ ${d.text}` : `${d.text} →`}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  ap: ApNodeView,
  apframe: ApFrameView,
  apref: ApRefView,
  guide: GuideView,
};
const edgeTypes = { routed: RoutedEdge };

/* ---- Canvasen ---- */

export interface ApCanvasProps {
  layout: ApLayout;
  textScale: number;
  /** Manuella kantval ur draften (brytpunkter m.m.), nycklade med edgeKey. */
  edgeStyles?: Record<string, EdgeSides>;
  /** Släppt objekt – positionen är ÖVERSATT till fria ramen. */
  onPositionChange: (id: string, pos: { x: number; y: number }) => void;
  onWaypointChange: (
    source: string,
    target: string,
    point: { x: number; y: number } | null,
    label?: string,
  ) => void;
  /** Sista sträckan in i målet flyttad/nollad (kantens andra brytpunkt). */
  onWaypoint2Change?: (
    source: string,
    target: string,
    point: { x: number; y: number } | null,
    label?: string,
  ) => void;
  /**
   * Etikettens TEXT (dubbelklick på kopplingen). Nycklad på kanten i
   * MELLANLAGRET (`rel.kant`), inte på relationens ändar – samma regel som i
   * flödesschemat (`setEdgeLabel`).
   */
  onEdgeLabelTextChange?: (source: string, target: string, nuvarande: string | undefined, ny: string) => void;
  /** Varför en etikett inte går att sätta – visas medan man skriver. */
  etikettHinder?: (source: string, nuvarande: string | undefined, ny: string) => string | null;
  /** Valt objekt (null = avmarkerat) – ApTool visar inspektören. */
  onSelect: (id: string | null) => void;
  /**
   * Hela MARKERINGEN, i takt med att den ändras (ram, ctrl-klick, klick).
   *
   * `onSelect` bär det ENA objektet inspektören visar; den här bär mängden,
   * som verktygsradens åtgärder arbetar på ("räta upp kopplingarna"). React
   * Flow äger markeringen, så den måste rapporteras upp – utan detta visste
   * verktygsraden inte vad användaren pekat ut.
   */
  onSelectionChange?: (ids: string[]) => void;
  /**
   * Klick på ett krav som bär en RUTIN. Läsläget öppnar ingen inspektör, men
   * rutinen är till för att läsas – det är hela poängen med den – så just det
   * klicket släpps igenom. I redigeringsläget öppnas rutinen av samma klick
   * som markerar kravet.
   */
  onRutin?: (id: string) => void;
  /** Placeringsläge (palettval aktivt): klick på ytan placerar objektet. */
  placerar?: boolean;
  /**
   * Låst rityta = LÄSLÄGE. Objekt går inte att flytta, markera eller koppla
   * ihop, och inspektören öppnas inte. Samma kontrakt som flödesschemats
   * `locked`: att titta på en process ska inte kunna ändra den av misstag.
   */
  låst?: boolean;
  /** Klickpunkt i FLÖDESkoordinater när placeringsläget är aktivt. */
  onPlace?: (pos: { x: number; y: number }) => void;
  /** En pil dragen mellan två objekt – knyter ihop dem. */
  onConnect?: (source: string, target: string) => void;
  /**
   * Vald kopplingspunkt: vilken SIDA av objektet pilen ska fästa i. Saknas =
   * ändpunkterna går inte att dra (samma kontrakt som flödesschemat).
   */
  onEdgeSidesChange?: (
    source: string,
    target: string,
    sides: {
      sourceSide?: EdgeSide;
      targetSide?: EdgeSide;
      sourcePos?: number;
      targetPos?: number;
    },
    label?: string,
  ) => void;
  /**
   * Tar bort en kedjepil – bryter kedjan. Knappen visas uppe till vänster när
   * en kedjepil är vald; ingen tangent, av samma skäl som objekten tas bort i
   * inspektören: man ska se vad man tar bort. Får mellanlagrets kant (`rel.kant`).
   */
  onTaBortKant?: (kant: { source: string; target: string; label?: string }) => void;
  /** Byts när ritytan byter storlek (helskärm in/ut) – då anpassas vyn till bilden. */
  anpassaVy?: number;
}

/**
 * Mellanlagrets kant bakom en vald pil, eller undefined när pilen inte är en
 * kedjepil (satellitstreck, in-objekt). Etiketten matchas som nyckel
 * (invariant 3): Ja- och Nej-pilen mellan samma par är olika kanter.
 * REGRESSION: en omärkt pil klickades med etiketten "" och hittade ingen kant.
 */
export function kedjekantFör(
  relationer: readonly ApRelation[],
  vald: { source: string; target: string; label?: string },
): ApRelation["kant"] {
  // Klicket på en omärkt pil bär den UTSKRIVNA etiketten "" – relationen har
  // ingen alls. Tomt och saknat är samma nyckel.
  const nyckel = vald.label || undefined;
  return relationer.find(
    (r) =>
      r.kant &&
      r.source === vald.source &&
      r.target === vald.target &&
      ((r.kind === "huki" ? r.huki : r.label) || undefined) === nyckel,
  )?.kant;
}

export function ApCanvas({
  layout,
  textScale,
  edgeStyles,
  onPositionChange,
  onWaypointChange,
  onWaypoint2Change,
  onEdgeLabelTextChange,
  etikettHinder,
  onSelect,
  onSelectionChange,
  onRutin,
  placerar,
  låst = false,
  onPlace,
  onConnect,
  onEdgeSidesChange,
  onTaBortKant,
  anpassaVy,
}: ApCanvasProps) {
  /** React Flow-instansen – för skärm→flödeskoordinater vid placering. */
  const rf = useRef<ReactFlowInstance | null>(null);
  // Ny storlek på ritytan → hela processen i bild. Kort fördröjning så att
  // behållaren hunnit få sina nya mått (samma knep som flödesschemat).
  useEffect(() => {
    if (!anpassaVy) return;
    const t = setTimeout(() => rf.current?.fitView({ padding: 0.04, duration: 240 }), 120);
    return () => clearTimeout(t);
  }, [anpassaVy]);
  /**
   * Markeringen rapporteras upp med en STABIL handlare och bara när id:na
   * faktiskt ändrats. React Flows SelectionListener kör sin effekt varje gång
   * handlaren byts – en inline-funktion gav en ny handlare per render, effekten
   * rapporterade en ny (tom) lista, föräldern renderade om … i en evig slinga
   * ("Maximum update depth exceeded").
   */
  const selectionProp = useRef(onSelectionChange);
  selectionProp.current = onSelectionChange;
  const senastMarkerade = useRef<string[]>([]);
  const rapporteraMarkering = useCallback(({ nodes: valda }: { nodes: Node[] }) => {
    const ids = valda.filter((n) => n.type === "ap").map((n) => n.id);
    const förra = senastMarkerade.current;
    if (ids.length === förra.length && ids.every((id, i) => id === förra[i])) return;
    senastMarkerade.current = ids;
    selectionProp.current?.(ids);
  }, []);
  /**
   * VAD MUSEN GÖR på tom yta: markera med en ram, eller flytta vyn med handen.
   * Samma växel och samma förval som flödesschemat (PekarVal) – två gester kan
   * inte dela vänsterknapp, så valet måste synas.
   */
  const [pekarläge, setPekarläge] = useState<Pekarläge>("markera");
  /**
   * Relationen vars ETIKETT skrivs. Dubbelklicket fångas av ritytan
   * (`onEdgeDoubleClick`), inte av kanten: React Flow lägger en egen osynlig
   * träffyta ovanpå varje kant. Samma lösning som i flödesschemat.
   */
  const [redigerarRel, setRedigerarRel] = useState<string | null>(null);
  /** Vald koppling – då visas de dragbara ändpunkterna. */
  const [valdKant, setValdKant] = useState<{
    source: string;
    target: string;
    label?: string;
  } | null>(null);
  // Hindren som routern går runt: alla objektrutor.
  useMemo(() => {
    const m = new Map<string, Rect>();
    const portar = new Map<string, Rect>();
    for (const n of layout.nodes) {
      m.set(n.node.id, { x: n.x, y: n.y, w: n.w, h: n.h });
      // Ikontypernas pilar fäster i symbolen, inte i etikettrutans kant.
      const i = ikonPortRuta(n.node.kind, n.w, n.h);
      if (i) portar.set(n.node.id, { x: n.x + i.x, y: n.y + i.y, w: i.w, h: i.h });
    }
    obstacleRects.current = m;
    portRects.current = portar;
    // Nollställ de delade kantvägarna (Shift-linjeringens mål) – annars
    // spökar vägar från borttagna relationer kvar som linjeringsmål.
    edgePaths.current = new Map();
  }, [layout]);

  const buildNodes = useCallback((): Node[] => {
    const frames: Node[] =
      layout.pages.length > 1
        ? layout.pages.map((p) => ({
            id: `frame_${p.index}`,
            type: "apframe",
            position: { x: p.x, y: p.y },
            data: { w: p.w, h: p.h, label: `Del ${p.index + 1} av ${layout.pages.length}` },
            draggable: false,
            selectable: false,
            connectable: false,
            zIndex: 0,
            // Ramen är bakgrund: musen ska nå ritytan under den.
            style: GENOMSLÄPPLIG,
          }))
        : [];
    const refs: Node[] = layout.refs.map((r, i) => ({
      id: `ref_${i}`,
      type: "apref",
      position: { x: r.riktning === "ut" ? r.x : r.x - 90, y: r.y - 8 },
      data: { text: r.text, riktning: r.riktning },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: 1,
      style: GENOMSLÄPPLIG,
    }));
    const objekt: Node[] = layout.nodes.map((n) => ({
      id: n.node.id,
      type: "ap",
      position: { x: n.x, y: n.y },
      data: {
        inner: säkerSvg(apNodeSvg(n.node, 0, 0, n.w, n.h, textScale), { fragment: true }),
        w: n.w,
        h: n.h,
        // "i"-ikonen lovar en beskrivning – hovertexten ska visa den, annars
        // måste man öppna panelen för att se om det står något.
        typ: n.node.rutin
          ? `${AP_TYPE_LABEL[n.node.kind]} · klicka för att läsa rutinen`
          : n.node.beskrivning
            ? `${AP_TYPE_LABEL[n.node.kind]} · ${n.node.beskrivning}`
            : AP_TYPE_LABEL[n.node.kind],
      } satisfies ApNodeData,
      style: { width: n.w, height: n.h },
      // Tangenten tar ALDRIG bort ett objekt. Noderna ligger i canvasens egen
      // lista (onNodesChange applicerar allt React Flow skickar), så en
      // radering hade tömt skärmen utan att röra mellanlagret – objektet var
      // borta tills nästa omkompilering. Borttagning sker i inspektören.
      deletable: false,
      zIndex: 2,
    }));
    return [...frames, ...refs, ...objekt];
  }, [layout, textScale]);

  const [nodes, setNodes] = useState<Node[]>(buildNodes);

  // Bygg om noderna när utlägget ändras – och bär över React Flows mätning,
  // annars blinkar objekten osynliga under snabba omkompileringar (samma
  // fälla som flödesschemats canvas gick i).
  useEffect(() => {
    setNodes((förra) => {
      const mätt = new Map(förra.map((n) => [n.id, n.measured]));
      return buildNodes().map((n) => {
        const m = mätt.get(n.id);
        return m ? { ...n, measured: m } : n;
      });
    });
  }, [buildNodes]);

  /* ---- Shift-linjering av objekt (samma gest och modul som flödesschemat) ---- */

  /** Hjälplinjer som visas medan ett objekt linjeras. */
  const [guides, setGuides] = useState<Guides>({});
  /** Håller Shift nere? Läses i dragningen för att slå på linjering. */
  const alignKey = useRef(false);
  /**
   * Senast linjerade position per objekt. React Flow rapporterar sin EGEN,
   * osnappade position i onNodeDragStop – utan det här skrivs linjeringen över
   * vid släpp och objektet hoppar snett (samma fälla som flödesschemats canvas).
   */
  const snapped = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    const set = (e: KeyboardEvent | PointerEvent) => (alignKey.current = e.shiftKey);
    window.addEventListener("keydown", set);
    window.addEventListener("keyup", set);
    // Pekarens händelser bär också modifieraren, och under ett drag kommer de
    // hela tiden. Tangentbordslyssnaren ensam missar fallet att tangenten
    // trycktes ned medan fönstret inte hade tangentbordsfokus.
    window.addEventListener("pointermove", set);
    // Tappar fönstret fokus med tangenten nere fastnar den annars i "nere".
    const släpp = () => (alignKey.current = false);
    window.addEventListener("blur", släpp);
    return () => {
      window.removeEventListener("keydown", set);
      window.removeEventListener("keyup", set);
      window.removeEventListener("pointermove", set);
      window.removeEventListener("blur", släpp);
    };
  }, []);

  /**
   * Läs tangenten ur dragets EGEN händelse också – den globala bevakningen
   * missar att Shift trycktes ned innan ritytan fick fokus, och det är precis
   * då man greppar ett objekt.
   */
  const läsModifierare = useCallback((e: MouseEvent | TouchEvent) => {
    // Bara PÅ, aldrig av: React Flows draghändelse bär inte alltid med sig
    // modifieraren, och en som saknade den nollade flaggan mitt i ett drag där
    // Shift faktiskt hölls nere. Släppet sköts av keyup och blur.
    if ("shiftKey" in e && e.shiftKey) alignKey.current = true;
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((nds) => {
        // Linjeringen bor i snap.ts – samma regel som flödesschemat, bara ett
        // annat nodtypsnamn ("ap"): ramar och sidhänvisningar är inte mål.
        const snapNodes: SnapNode[] = nds.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          width: Number(n.style?.width ?? 0),
          height: Number(n.style?.height ?? 0),
        }));
        const res = applyAlignment(
          changes as SnapChange[],
          snapNodes,
          alignKey.current,
          SNAP_TOLERANCE,
          "ap",
        );
        for (const [id, pos] of res.snapped) snapped.current.set(id, pos);
        // Hjälplinjerna uppdateras BARA av omgångar som innehåller en
        // positionsändring. React Flow skickar mått- och markeringsändringar
        // mellan musrörelserna; de gav en tom linjering som direkt släckte den
        // hjälplinje draget nyss tänt, och linjen blinkade bort innan man hann
        // se den (den syntes ibland, aldrig pålitligt).
        if (changes.some((c) => c.type === "position")) {
          setGuides(alignKey.current ? res.guides : {});
        }
        return applyNodeChanges(res.changes as NodeChange[], nds);
      }),
    [],
  );

  /** Noderna plus hjälplinjerna, som sträcker sig över hela utlägget. */
  const guideNodes = useMemo<Node[]>(() => {
    const extra: Node[] = [];
    const common = { draggable: false, selectable: false, connectable: false, zIndex: 5 };
    const stil = { zIndex: 5, ...GENOMSLÄPPLIG };
    if (guides.x !== undefined) {
      extra.push({
        id: "guide-x",
        type: "guide",
        position: { x: guides.x, y: 0 },
        data: { axis: "v", length: layout.height },
        ...common,
        style: stil,
      });
    }
    if (guides.y !== undefined) {
      extra.push({
        id: "guide-y",
        type: "guide",
        position: { x: 0, y: guides.y },
        data: { axis: "h", length: layout.width },
        ...common,
        style: stil,
      });
    }
    return extra.length ? [...nodes, ...extra] : nodes;
  }, [nodes, guides, layout.width, layout.height]);

  /** Förskjutning skärm ↔ fria ramen per objekt (invariant 5). */
  const offsets = useMemo(() => {
    const m = new Map<string, { dx: number; dy: number }>();
    for (const n of layout.nodes) m.set(n.node.id, { dx: n.dx, dy: n.dy });
    return m;
  }, [layout]);

  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node, dragged?: Node[]) => {
      setGuides({});
      // ALLA släpade noder (flermarkering) – annars hoppar de andra tillbaka.
      for (const n of dragged?.length ? dragged : [node]) {
        if (n.type !== "ap") continue;
        // Vår linjerade position vinner över React Flows egen.
        const pos = snapped.current.get(n.id) ?? n.position;
        snapped.current.delete(n.id);
        const o = offsets.get(n.id) ?? { dx: 0, dy: 0 };
        onPositionChange(n.id, { x: pos.x - o.dx, y: pos.y - o.dy });
      }
    },
    [offsets, onPositionChange],
  );

  const stil = (k: string | undefined) =>
    edgeStyles?.[k ?? ""] as EdgeSides | undefined;

  /**
   * Rutorna ändpunkterna får dras runt. För ikontyperna är det SYMBOLENS ruta –
   * det är där pilarna fäster, så det är där punkterna ska sitta.
   */
  const kantRutor = useMemo(
    () =>
      layout.nodes.map((n) => {
        const i = ikonPortRuta(n.node.kind, n.w, n.h);
        return i
          ? { id: n.node.id, x: n.x + i.x, y: n.y + i.y, w: i.w, h: i.h }
          : { id: n.node.id, x: n.x, y: n.y, w: n.w, h: n.h };
      }),
    [layout],
  );

  /** Layoutens egna portpunkter för den valda kanten (raka satellitstreck). */
  const valdaPortar = valdKant
    ? layout.ports[
        layout.relations.find(
          (r) =>
            r.source === valdKant.source &&
            r.target === valdKant.target &&
            (r.kind === "huki" ? r.huki : r.label) === valdKant.label,
        )?.id ?? ""
      ]
    : undefined;

  /**
   * Mellanlagrets kant bakom den valda pilen – det är DEN som tas bort när
   * kedjan bryts. Pilen ut ur ett insprängt verksamhetsobjekt (vo_s3 → s4) bär
   * kanten s3 → s4; satelliter och in-objekt har ingen och kan inte brytas här.
   */
  const valdKedjekant = valdKant ? kedjekantFör(layout.relations, valdKant) : undefined;

  /** Den valda kantens egna sidval ur mellanlagret. */
  const valdSidor = valdKant
    ? (stil(edgeKey(valdKant.source, valdKant.target, valdKant.label)) ??
      stil(edgeKey(valdKant.source, valdKant.target)))
    : undefined;

  const edges: Edge[] = useMemo(() => {
    const box = new Map(layout.nodes.map((n) => [n.node.id, n]));
    return layout.relations
      .filter((rel) => {
        const a = box.get(rel.source);
        const b = box.get(rel.target);
        // Relationer över ett snitt ersätts av hänvisningsmärkena.
        return a && b && a.page === b.page;
      })
      .map((rel) => {
        const a = box.get(rel.source)!;
        const b = box.get(rel.target)!;
        const text = rel.kind === "huki" ? rel.huki : rel.label;
        // Användarens egna val vinner ÖVER layoutens förval (in-/ut-objektens
        // vågräta anslutning) – men bara fält för fält, så ett draget
        // brytpunktsläge inte tar med sig tomma sidval och slår ut förvalet.
        const eget = stil(edgeKey(rel.source, rel.target, text)) ?? stil(edgeKey(rel.source, rel.target));
        const auto = layout.sides[rel.id];
        const sides = eget || auto ? { ...auto, ...eget } : undefined;
        const [sa, sb] = pickEdgeSides(a, b, sides);
        // Satelliternas streck är HELDRAGNA som förädlingskedjan – bara tunnare,
        // med egen färg och öppen pilspets. Streckade linjer plus en bokstav i
        // vit ruta mitt på gjorde en 6 cm lång koppling till fyra saker.
        const annotering = rel.kind !== "flode";
        // Färgen bor i formmodulen – exporten läser samma regel. HUKI har en
        // färg per ansvarstyp (U blå, I gul …), inte en för hela sorten.
        const färg = apRelationFärg(rel);
        return {
          id: rel.id,
          source: rel.source,
          target: rel.target,
          sourceHandle: `s-${sa}`,
          targetHandle: `t-${sb}`,
          // VISAS: bokstaven skrivs inte ut när den är förvalet (U) – där
          // sätts ingen bokstav alls. Nyckeln som skiljer två pilar mellan
          // samma par åt (invariant 3) är en ANNAN sak och bor i `data`: den
          // måste vara kvar även när ingenting syns, annars tappar ett klick på
          // kanten sin identitet.
          label: apRelationEtikett(rel),
          type: "routed",
          data: {
            waypoint: sides?.waypoint ?? null,
            waypoint2: sides?.waypoint2 ?? null,
            srcDx: a.dx,
            srcDy: a.dy,
            // LÅST LÄGE GER INGET DRAGBART HANDTAG (som i flödesschemat). Utan
            // spärren gick brytpunkten att ta tag i och höja eller sänka mitt i
            // en ren visning – att titta på en process ska inte kunna ändra den
            // (beslut 2026-09-08).
            onWaypointChange: låst ? undefined : onWaypointChange,
            onWaypoint2Change: låst ? undefined : onWaypoint2Change,
            // "U" på en koppling betyder ingenting för den som inte kan
            // HUKI – hovertexten skriver ut bokstaven i klartext.
            titel: relationHint(rel, a.node, b.node),
            // Layoutens portpunkter (satellitstrecken går rakt ner).
            // LAYOUTENS punkt först, precis som i exporten (svg-affarsprocess, scen-affarsprocess):
            // det är den som bär klustrets stammar. Ordningen var omvänd här,
            // och en ärvd position (alltid "mitt på sidan")
            // sköt då satellitstrecken till aktivitetens mitt på SKÄRMEN medan
            // filen ritade dem vid stammen – två bilder av samma flöde
            // (invariant 1). Positionen används när layouten inte pekat ut
            // något, och sist routerns egen sidmittpunkt.
            from:
              layout.ports[rel.id]?.from ??
              (sides?.sourcePos !== undefined ? apPortPunkt(a, sa, sides.sourcePos) : undefined),
            to:
              layout.ports[rel.id]?.to ??
              (sides?.targetPos !== undefined ? apPortPunkt(b, sb, sides.targetPos) : undefined),
            // Bokstaven bredvid strecket, inte i en ruta mitt på det.
            etikettBredvid: true,
            // Kantnyckelns etikett (invariant 3) – inte det som skrivs ut.
            etikettNyckel: text,
            // Aktivitetens gemensamma linje: böjen och bokstaven på samma höjd
            // för alla satelliter under samma aktivitet.
            via: layout.ports[rel.id]?.via,
            // Mjuka knän. Skalas med utlägget, precis som exporten.
            hörnradie: apHörnradie() * layout.scale,
            // ETIKETTEN skrivs på kanten i mellanlagret, inte på relationens
            // ändar: pilen ut ur ett insprängt verksamhetsobjekt (vo_s3 → s4)
            // är kanten s3 → s4. Satelliter och in-objekt har ingen kant och
            // går därför inte att sätta etikett på.
            ...(rel.kant && !låst && onEdgeLabelTextChange
              ? {
                  onLabelTextChange: (_s: string, _t: string, _nu: string | undefined, ny: string) =>
                    onEdgeLabelTextChange(rel.kant!.source, rel.kant!.target, rel.kant!.label, ny),
                  etikettHinder: etikettHinder
                    ? (_nu: string | undefined, ny: string) => etikettHinder(rel.kant!.source, rel.kant!.label, ny)
                    : undefined,
                  redigerar: redigerarRel === rel.id,
                  onStängEtikett: () => setRedigerarRel(null),
                  onÖppnaEtikett: () => setRedigerarRel(rel.id),
                }
              : {}),
          } as RoutedEdgeData,
          labelStyle: {
            fontSize: `${(10.5 * layout.scale).toFixed(1)}px`,
            fontWeight: rel.kind === "huki" ? 700 : 400,
            color: rel.kind === "huki" ? färg : undefined,
          },
          // FYLLD pilspets även på satelliterna. Den öppna
          // (`arrow`) försvann på en tunn färgad linje.
          markerEnd: { type: "arrowclosed" as const, color: färg },
          style: annotering
            ? { stroke: färg, strokeWidth: 1.1 }
            : { stroke: färg, strokeWidth: 1.6 },
          interactionWidth: 14,
          zIndex: 1,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, edgeStyles, onWaypointChange, onWaypoint2Change, onEdgeLabelTextChange, etikettHinder, redigerarRel, låst]);

  /** Ritar ett vänsterdrag på tom yta en markeringsram just nu? */
  const markeringsruta = !låst && !placerar && pekarläge === "markera";

  return (
    <div
      className={`ark-canvas ${placerar ? "ark-canvas--placerar" : ""} ${
        markeringsruta ? "ark-canvas--markera" : ""
      }`}
    >
      {/* Växeln ligger uppe till vänster på ritytan – samma plats som i
          flödesschemat, där den är första posten i verktygsraden. */}
      {!låst && (
        <div className="ark-pekarval-flytande">
          <PekarVal läge={pekarläge} onVälj={setPekarläge} />
          {valdKedjekant && onTaBortKant && (
            <button
              className="ark-btn ark-ap-bryt"
              title="Tar bort pilen och bryter kedjan här. Ångra tar tillbaka den."
              onClick={() => {
                onTaBortKant(valdKedjekant);
                setValdKant(null);
              }}
            >
              ✂ Bryt kedjan här
            </button>
          )}
        </div>
      )}
      <ReactFlow
        nodes={guideNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(inst) => (rf.current = inst)}
        onNodesChange={onNodesChange}
        onNodeDragStart={läsModifierare}
        onNodeDrag={läsModifierare}
        onNodeDragStop={onNodeDragStop}
        /* Bara riktiga objekt räknas – hjälpnoderna (sidramar, hänvisnings-
           märken, linjeringsguider) är inte något användaren markerat. */
        onSelectionChange={rapporteraMarkering}
        onNodeClick={(e, n) => {
          if (låst) {
            if (layout.nodes.some((x) => x.node.id === n.id && x.node.rutin)) onRutin?.(n.id);
            return;
          }
          // I placeringsläge placerar även ett klick PÅ ett objekt – man
          // siktar ju ofta på aktiviteten satelliten ska hängas på.
          if (placerar && onPlace && rf.current) {
            onPlace(rf.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            return;
          }
          if (n.type === "ap") onSelect(n.id);
          // Ett krav som bär en rutin öppnar den med samma klick, också när
          // man redigerar – man ska inte behöva gå via inspektörens knapp
          // för att läsa det kravet pekar på (beslut 2026-10-02).
          if (layout.nodes.some((x) => x.node.id === n.id && x.node.rutin)) onRutin?.(n.id);
        }}
        onEdgeClick={(_e, edge) =>
          låst
            ? undefined
            : setValdKant({
                source: edge.source,
                target: edge.target,
                // Nyckelns etikett, inte den utskrivna: en HUKI-kant med "U"
                // visar ingen bokstav men heter fortfarande "U" i mellanlagret.
                label:
                  ((edge.data as { etikettNyckel?: string } | undefined)?.etikettNyckel) ??
                  (typeof edge.label === "string" ? edge.label : undefined),
              })
        }
        onEdgeDoubleClick={(_e, edge) => {
          if (låst || !onEdgeLabelTextChange) return;
          if (layout.relations.some((r) => r.id === edge.id && r.kant)) setRedigerarRel(edge.id);
        }}
        onPaneClick={(e) => {
          if (placerar && onPlace && rf.current) {
            onPlace(rf.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            return;
          }
          setValdKant(null);
          onSelect(null);
        }}
        onConnect={(conn) => {
          if (conn.source && conn.target && conn.source !== conn.target)
            onConnect?.(conn.source, conn.target);
        }}
        nodesConnectable={Boolean(onConnect) && !låst}
        nodesDraggable={!låst}
        elementsSelectable={!låst}
        /**
         * MARKERINGSRUTA: dra med vänster musknapp på tom yta för att rama in
         * flera objekt och flytta dem tillsammans (beslut 2026-09-07). Samma
         * gest och samma tangenter som flödesschemat – konstanterna delas.
         *
         * Inte i låst läge (då panorerar vänsterdraget som förut), inte i
         * placeringsläge (då gäller ytan det objekt man valt i paletten) och
         * inte när växeln står på handen.
         */
        selectionOnDrag={markeringsruta}
        panOnDrag={markeringsruta ? PAN_BUTTONS : true}
        selectionMode={SelectionMode.Partial}
        // Ctrl markerar flera, inte Shift: Shift är LINJERINGENS tangent här.
        selectionKeyCode={SELECTION_KEY}
        multiSelectionKeyCode={SELECTION_KEY}
        // Samma trösklar och zoomval som flödesschemat – dubbelklickszoomen
        // svalde dubbelklick (brytpunktsåterställning) och tröskeln stoppar
        // mikrodrag när man siktar på ett handtag.
        nodeDragThreshold={6}
        zoomOnDoubleClick={false}
        minZoom={0.05}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#eef1f5" />
        <Controls />
        <MiniMap pannable zoomable nodeColor={() => "#c7cede"} />
        {valdKant && !låst && onEdgeSidesChange && (
          <EdgeEndpoints
            visaPunkter
            boxes={kantRutor}
            source={valdKant.source}
            target={valdKant.target}
            // Invariant 3: etiketten avgör om kanten är en gren, och grenar
            // lämnar botten. Utan den hamnar handtaget på fel sida.
            label={valdKant.label}
            sourceSide={valdSidor?.sourceSide}
            targetSide={valdSidor?.targetSide}
            sourcePos={valdSidor?.sourcePos}
            targetPos={valdSidor?.targetPos}
            sourcePunkt={valdaPortar?.from}
            targetPunkt={valdaPortar?.to}
            onPick={(sides) =>
              onEdgeSidesChange(valdKant.source, valdKant.target, sides, valdKant.label)
            }
            onClear={(ände) =>
              onEdgeSidesChange(
                valdKant.source,
                valdKant.target,
                ände === "source"
                  ? { sourceSide: undefined, sourcePos: undefined }
                  : { targetSide: undefined, targetPos: undefined },
                valdKant.label,
              )
            }
          />
        )}
      </ReactFlow>
    </div>
  );
}
