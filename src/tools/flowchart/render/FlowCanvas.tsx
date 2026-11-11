/**
 * FlowCanvas – den interaktiva editorn (KRAV 10).
 * Konverterar den deterministiska layouten till React Flow-noder/kanter och
 * ger dra & släpp, etikettredigering och låst layout.
 */

import { portalbana } from "@/core/organisation";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EdgeSide, NodeType, ProcessModel, TextPlacement } from "@/core/model";
import type { ColorMode } from "../theme";
import { hänvisningsStubbe, layoutModel, PAGE_FORMATS, type LayoutResult, type PageFormatId } from "../layout/layout";
import { EDGE_STROKE } from "../theme";
import { GENOMSLÄPPLIG, PAN_BUTTONS, SELECTION_KEY } from "./canvas-gester";
import { PekarVal, type Pekarläge } from "./PekarVal";
import { applyAlignment, type SnapChange, type SnapNode } from "./snap";
import { LaneNodeView } from "./LaneNodeView";
import { PageFrameView } from "./PageFrameView";
import { PageRefView } from "./PageRefView";
import { PoolView } from "./PoolView";
import { EdgeEndpoints } from "./EdgeEndpoints";
import { FlowPalett } from "./FlowPalett";
import type { Box } from "./edge-geometry";
import { GuideView } from "./GuideView";
import { RoutedEdge, edgePaths, obstacleRects, type RoutedEdgeData } from "./RoutedEdge";
import { messageFlowLandning, pickEdgeSides, type Rect } from "../layout/edge-router";
import { ProcessNodeView } from "./ProcessNodeView";
import { DataStoreView } from "./DataStoreView";
import { BlackBoxView } from "./BlackBoxView";

const edgeTypes = { routed: RoutedEdge };

const nodeTypes: NodeTypes = {
  process: ProcessNodeView,
  lane: LaneNodeView,
  page: PageFrameView,
  pageref: PageRefView,
  pool: PoolView,
  guide: GuideView,
  datastore: DataStoreView,
  blackbox: BlackBoxView,
};

/** Id-prefix för artefaktkanter – håller dem åtskilda från sekvensflödenas id:n. */
const DA_PREFIX = "da_";
const MF_PREFIX = "mf_";

interface Props {
  model: ProcessModel;
  locked: boolean;
  /**
   * Ska ritverktygen (Koppla ihop, Start, Aktivitet …) visas?
   *
   * De ligger som en flytande rad ÖVER ritytan, och när ett formulär täcker
   * ytan – mallen, mellanlagret, granskningen – stod de kvar ovanpå det. Man
   * fyllde alltså i ett formulär med ritverktygen i handen. Verktygsraden hör
   * till det man gör med musen på ytan, och just då gör man något annat.
   */
  visaVerktyg?: boolean;
  /** Valt sidformat – styr vikning och A4-ram. */
  pageFormat: PageFormatId;
  /** Global storleksfaktor för alla objekt. */
  scale: number;
  colorMode: ColorMode;
  /** Nyckel som ändras när diagrammet ska genereras om (återställer positioner). */
  regenKey: number;
  onLabelChange: (id: string, label: string) => void;
  /** Rapporterar en manuellt flyttad nod så positionen kan sparas. */
  onPositionChange?: (id: string, position: { x: number; y: number }) => void;
  /** Rapporterar ett objekt som avsiktligt släppts i en annan simbanas band. */
  onLaneChange?: (id: string, laneId: string) => void;
  /**
   * Rapporterar ett objekt som släppts på en ANNAN del/bild i flersidigt läge.
   * `position` är släppunkten i fria koordinater (om den gick att bestämma).
   */
  onPageMove?: (id: string, page: number, position?: { x: number; y: number }) => void;
  /** Sätter textstorlek/-placering för ett markerat objekt. */
  onTextStyleChange?: (id: string, patch: { textSize?: number; textPlacement?: TextPlacement }) => void;
  /** Täthet 0.5–1 – avstånden mellan objekt. */
  spacing?: number;
  /** Global textstorlek 0.6–1 (bara texten, inte objekten). */
  textScale?: number;
  /**
   * Kant-callbacks bär kantens ETIKETT när en finns: två pilar kan dela nodpar
   * (Ja/Nej från ett beslut till samma steg), och etiketten är det som skiljer
   * dem åt i mellanlagrets nycklar.
   */
  /** Rapporterar en omdragen kantände (ny kopplingspunkt). */
  onEdgeSidesChange?: (source: string, target: string, sides: EdgeSidesPatch, label?: string) => void;
  /** Sätter (fri-koordinater) eller nollar (null) en kants manuella brytpunkt. */
  onEdgeWaypointChange?: (
    source: string,
    target: string,
    point: { x: number; y: number } | null,
    label?: string,
  ) => void;
  /** Flyttar en kants etikett längs vägen (andel 0–1) eller nollar den (null). */
  onEdgeLabelPosChange?: (source: string, target: string, andel: number | null, label?: string) => void;
  /**
   * Sätter en kants etikett-TEXT (dubbelklick på kopplingen). `nuvarande` behövs
   * för att hitta rätt gren/pil – etiketten är en del av kantens identitet.
   */
  onEdgeLabelTextChange?: (source: string, target: string, nuvarande: string | undefined, ny: string) => void;
  /** Varför en etikett inte går att sätta (tom gren, krock med syskongren). */
  etikettHinder?: (source: string, nuvarande: string | undefined, ny: string) => string | null;
  /** Återställer en kant till automatisk kopplingspunkt. */
  onEdgeSidesReset?: (source: string, target: string, label?: string) => void;
  /** Rapporterar en utdragen swimlane-höjd (null = auto). I flersidigt läge
   *  gäller höjden BARA delen som drogs (page); i fri form alla delar. */
  onLaneResize?: (laneId: string, height: number | null, page?: number) => void;
  /**
   * De markerade PROCESSOBJEKTENS id:n (ram eller Ctrl-klick) – verktygsradens
   * åtgärder för markeringen arbetar på dem. Rapporteras bara när listan
   * faktiskt ändrats (se `rapporteraMarkering`).
   */
  onSelectionChange?: (ids: string[]) => void;
  /** Tar bort en koppling ur diagrammet. */
  onEdgeRemove?: (source: string, target: string, label?: string) => void;
  /** Döljer en sidhänvisning som användaren klickat på. */
  onPageRefHide?: (source: string, target: string, sida: "in" | "ut") => void;
  /** Lägger till en koppling som dragits för hand. */
  onEdgeAdd?: (source: string, target: string) => void;
  /**
   * Lägger ett nytt objekt på ytan, ur verktygsradens palett. Positionen är i
   * FRIA layoutens koordinater (som nodpositioner) och banan den man klickade i.
   */
  onObjektPlacera?: (typ: NodeType, position: { x: number; y: number }, laneId: string) => void;
  /** Varför två objekt inte går att koppla ihop – visas i verktygsraden. */
  kopplingHinder?: (source: string, target: string) => string | null;
  /**
   * Nodpar som motsvarar en verklig koppling i den OFILTRERADE modellen.
   * I verksamhetsvyn kan en pil vara en genväg förbi dolda noder – den går
   * inte att ändra, och då säger panelen det i stället för att tiga.
   */
  editablePairs?: Set<string>;
}

export interface EdgeSidesPatch {
  sourceSide?: EdgeSide;
  targetSide?: EdgeSide;
  /**
   * VAR på sidan pilen fäster (andel 0–1). Måste finnas i typen: ändpunkts-
   * dragningen skickar den, och utan fältet hade nästa refaktorering tyst
   * strippat den. Meddelandeflödets landningspunkt på mottagarbandet är den.
   * `undefined` betyder "tillbaka till automatiskt".
   */
  sourcePos?: number;
  targetPos?: number;
}

/** React Flow-handtag heter s-right/t-left – plocka ut sidan ur namnet. */
function sideFromHandle(handle: string | null | undefined): EdgeSide | undefined {
  if (!handle) return undefined;
  const m = handle.match(/^(?:s|t)-(top|right|bottom|left)$/);
  return (m?.[1] as EdgeSide) ?? undefined;
}

/** Kopplingspunkter flödesschemat erbjuder: mitten av varje sida. Se EdgeEndpoints. */
const MITTEN = [0.5] as const;

/**
 * Kantetikettens utseende – EN regel, delad av alla kantsorter.
 *
 * Storleken följer layoutens FAKTISKA skala, precis som SVG-exporten (11 × skala).
 * Bara sekvensflödena satte den förut; streckade kopplingar ritades i fast 11 px,
 * så vid skala 0,6 stod Ja/Nej i 6,6 px bredvid en ny etikett i 11 px.
 */
function etikettStil(skala: number) {
  return {
    labelStyle: { fontSize: `${(11 * skala).toFixed(1)}px` },
    labelBgPadding: [6, 3] as [number, number],
    labelBgStyle: { fill: "#fff", stroke: "#d7dce4" },
  };
}

/**
 * Kantens identitet i mellanlagret, ur en React Flow-kant. Ändarna bär
 * canvas-prefix (ds_ för datalager, bb_N_ för mottagarband) som modellen inte
 * känner, och ETIKETTEN måste med – två pilar kan dela nodpar (invariant 3).
 */
function kantNyckel(edge: Edge): { source: string; target: string; label?: string } {
  const rensa = (id: string) => id.replace(/^ds_/, "").replace(/^bb_\d+_/, "");
  return {
    source: rensa(edge.source),
    target: rensa(edge.target),
    label: typeof edge.label === "string" ? edge.label : undefined,
  };
}

export function FlowCanvas({
  model,
  locked,
  visaVerktyg = true,
  pageFormat,
  scale,
  colorMode,
  regenKey,
  onLabelChange,
  onPositionChange,
  onLaneChange,
  onPageMove,
  onTextStyleChange,
  spacing = 1,
  textScale = 1,
  onEdgeSidesChange,
  onEdgeWaypointChange,
  onEdgeLabelPosChange,
  onEdgeLabelTextChange,
  etikettHinder,
  onEdgeSidesReset,
  onLaneResize,
  onSelectionChange,
  onEdgeRemove,
  onPageRefHide,
  onEdgeAdd,
  onObjektPlacera,
  kopplingHinder,
  editablePairs,
}: Props) {
  const fmt = PAGE_FORMATS[pageFormat];
  const layout = useMemo(
    () =>
      layoutModel(model, {
        pageWidth: fmt.width,
        pageHeight: fmt.width && fmt.aspect ? fmt.width * fmt.aspect : null,
        scale,
        shrinkToContent: fmt.aspect === null,
        spacing,
      }),
    [model, fmt.width, fmt.aspect, scale, spacing],
  );

  /**
   * VERKTYGET som är aktivt i verktygsraden. null = vanlig pekare.
   *
   * "koppla" ger samma gest som affärsprocesspalettens: klicka verktyget, klicka två
   * objekt. Att dra en koppling kräver att man träffar en 7 px kopplingspunkt
   * med musen och sedan släpper inom snäppradien – två precisionsmoment i samma
   * gest. Klick-klick har inga.
   */
  const [verktyg, setVerktyg] = useState<"koppla" | NodeType | null>(null);
  /** Objektet som valts som kopplingens START (modell-id, utan canvas-prefix). */
  const [kopplaFrån, setKopplaFrån] = useState<string | null>(null);
  /** Varför senaste kopplingsförsöket inte gick – visas i verktygsraden. */
  const [kopplaFel, setKopplaFel] = useState<string | null>(null);
  const avbrytVerktyg = useCallback(() => {
    setVerktyg(null);
    setKopplaFrån(null);
    setKopplaFel(null);
  }, []);
  /**
   * Försvinner verktygsraden (ett formulär tar över ytan) släpps verktyget.
   * Annars låg man kvar i "koppla" när panelen stängdes, utan någon rad som
   * visade det – nästa klick på ytan gjorde något man inte längre bett om.
   */
  useEffect(() => {
    if (!visaVerktyg || locked) avbrytVerktyg();
  }, [visaVerktyg, locked, avbrytVerktyg]);

  // Esc avbryter – samma tangent som avbryter affärsprocesspalettens placering.
  useEffect(() => {
    if (!verktyg) return;
    const tangent = (e: KeyboardEvent) => {
      if (e.key === "Escape") avbrytVerktyg();
    };
    window.addEventListener("keydown", tangent);
    return () => window.removeEventListener("keydown", tangent);
  }, [verktyg, avbrytVerktyg]);

  /** React Flow-instansen – behövs för att rama in innehållet igen. */
  const rf = useRef<ReactFlowInstance | null>(null);
  /**
   * Markeringen rapporteras upp med en STABIL handlare som bara anropar
   * föräldern när listan ändrats. React Flows SelectionListener kör sin effekt
   * varje gång handlaren byts, och en ny handlare per render gav en evig
   * slinga i affärsprocessverktyget ("Maximum update depth exceeded").
   */
  const selectionProp = useRef(onSelectionChange);
  selectionProp.current = onSelectionChange;
  const senastMarkerade = useRef<string[]>([]);
  const rapporteraMarkering = useCallback(({ nodes: valda }: { nodes: Node[] }) => {
    const ids = valda.filter((n) => n.type === "process").map((n) => n.id);
    const förra = senastMarkerade.current;
    if (ids.length === förra.length && ids.every((id, i) => id === förra[i])) return;
    senastMarkerade.current = ids;
    selectionProp.current?.(ids);
  }, []);

  /**
   * Vyn hittar tillbaka till banan man just dragit i.
   *
   * En banhöjd gäller banan, inte delen – en bana som finns på fem delar växer
   * på alla fem samtidigt. Ett drag på 480 px gjorde dokumentet 1 478 px högre,
   * och eftersom kameran står stilla gled det man tittade på ur bild.
   *
   * Vi ramar in BANAN, inte hela dokumentet: en inramning av allt zoomar ut
   * till oläslighet när diagrammet växt (och stannar ändå vid minZoom, så allt
   * ryms inte). `maxZoom` = nuvarande zoom gör att vyn panorerar i stället för
   * att hoppa i skala.
   *
   * Inramningen måste vänta tills layouten hunnit uppdateras. Kördes den direkt
   * i släpp-händelsen ramade den in det GAMLA utlägget, och då hamnade man ännu
   * mer fel än om ingenting hänt.
   */
  const [ramaIn, setRamaIn] = useState<string | null>(null);
  const passaInVyn = useCallback((laneNodeId: string) => setRamaIn(laneNodeId), []);

  useEffect(() => {
    if (!ramaIn) return;
    const t = setTimeout(() => {
      const inst = rf.current;
      if (inst?.getNode(ramaIn)) {
        inst.fitView({
          nodes: [{ id: ramaIn }],
          padding: 0.2,
          duration: 320,
          maxZoom: inst.getZoom(),
        });
      }
      setRamaIn(null);
    }, 80);
    return () => clearTimeout(t);
  }, [ramaIn, layout]);

  const buildNodes = useCallback((): Node[] => {
    // En pappersram per sida. I flersidigt läge är de tydligt åtskilda med
    // sidnummer – det är vad som gör att upprepade banrubriker läses som
    // "nästa sida" i stället för som hopblandade banor.
    const frameNodes: Node[] = layout.pageWidth
      ? layout.pages.map((sida) => ({
          id: `pageframe_${sida.number}`,
          type: "page",
          position: { x: sida.x, y: sida.y },
          data: { width: sida.w, height: sida.h, label: sida.label },
          draggable: false,
          selectable: false,
          connectable: false,
          zIndex: -1,
          style: { zIndex: -1, ...GENOMSLÄPPLIG },
        }))
      : [];
    const poolNodes: Node[] = layout.pools.map((p) => ({
      id: `pool_${p.page}`,
      type: "pool",
      position: { x: p.x, y: p.y },
      data: {
        width: p.w,
        height: p.h,
        labelW: p.labelW,
        title: p.title,
        fontSize: 11 * scale,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: 0,
      style: { zIndex: 0, ...GENOMSLÄPPLIG },
    }));
    // Samma bana finns en gång per sida: id:t måste bära sidnumret (React Flow
    // kräver unika id:n) och färgindexet banans plats i ORDNINGEN, annars byter
    // banan färg mellan sidorna.
    const laneOrder = new Map<string, number>();
    for (const l of layout.lanes) if (!laneOrder.has(l.id)) laneOrder.set(l.id, laneOrder.size);
    const laneNodes: Node[] = layout.lanes.map((lane) => ({
      id: `lane_${lane.page}_${lane.id}`,
      type: "lane",
      position: { x: lane.x, y: lane.y },
      data: {
        title: lane.title,
        index: laneOrder.get(lane.id) ?? 0,
        width: lane.w,
        height: lane.h,
        headerH: lane.headerH,
        fontSize: 12.5 * scale,
        laneId: lane.id,
        // I flersidigt läge ändrar draget BARA den här delen – en bana kan
        // behöva vara extra hög på en enda del. I fri form gäller alla delar.
        page: layout.pages.length > 1 ? lane.page : undefined,
        // Golvet är bara rubrikraden – användaren äger höjden till 100 %.
        // Layouten varnar (laneVarningar) i stället för att stoppa draget.
        minHeight: lane.headerH + 8,
        // En bana som fallit ihop till bara sin rubrik har inget att dra i:
        // handtaget skulle ligga ovanpå rubriken, och utgångshöjden (28 px)
        // gör att ett drag ger en höjd under minimikravet – det ser ut som att
        // banan inte går att ändra. Dra i den del där banan faktiskt syns.
        onResize: lane.h > lane.headerH + 1 ? onLaneResize : undefined,
        // Banden är egna React Flow-noder; id:t behövs för att kunna rama in
        // just det band man drog i.
        nodeId: `lane_${lane.page}_${lane.id}`,
        onResizeEnd: passaInVyn,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: 0,
      // Bandet släpper igenom musen; dragghandtaget tänder den igen i CSS.
      style: { zIndex: 0, ...GENOMSLÄPPLIG },
    }));
    const procNodes: Node[] = layout.nodes.map((ln) => ({
      id: ln.node.id,
      type: "process",
      position: { x: ln.x, y: ln.y },
      // `kopplaVald` markerar objektet man valt som kopplingens START. Klassen
      // sätts i VYN – React Flows `node.className` nådde aldrig DOM:en.
      data: { model: ln.node, onLabelChange, scale, colorMode, textScale, kopplaVald: kopplaFrån === ln.node.id },
      zIndex: 2,
      // Måtten anges explicit. React Flow döljer annars noden tills den hunnit
      // mäta den i DOM:en, och layouten vet dem redan.
      width: ln.w,
      height: ln.h,
      style: { width: ln.w, height: ln.h },
    }));
    // Artefakter: datalager ligger utanför SEKVENSFLÖDET, men det är en
    // modellfråga – de går att markera, redigera och flytta som allt annat.
    const storeNodes: Node[] = layout.dataStores.map((ds) => ({
      id: `ds_${ds.store.id}`,
      type: "datastore",
      position: { x: ds.x, y: ds.y },
      data: { onLabelChange, store: ds.store, scale, colorMode, textScale, kopplaVald: kopplaFrån === ds.store.id },
      draggable: !locked,
      selectable: !locked,
      // Går att dra kopplingar till och från: ett datalager är en giltig ände
      // på en dataassociation.
      connectable: !locked,
      zIndex: 2,
      width: ds.w,
      height: ds.h,
      style: { width: ds.w, height: ds.h },
    }));
    // Mottagarpooler (svarta lådor). Handtagen läggs ut lodrätt under den nod
    // som skickar meddelandet, så att pilen möter bandet rakt nedanför.
    // EN funktion räknar landningspunkten (bandOffset), och både bandets handtag,
    // kantens utpekade port och SVG-exporten läser den – annars kunde skärmens
    // handtag och den ritade pilen hamna på olika ställen. Det gjorde de: pilens
    // slut satt kvar på bandets CACHADE handtagsläge när avsändaren flyttades.
    const senderX = new Map(layout.nodes.map((ln) => [ln.node.id, ln.x + ln.w / 2]));
    const boxNodes: Node[] = layout.blackBoxes.map((bb) => ({
      id: `bb_${bb.page}_${bb.pool.id}`,
      type: "blackbox",
      position: { x: bb.x, y: bb.y },
      data: {
        width: bb.w,
        height: bb.h,
        labelW: bb.labelW,
        title: bb.pool.title,
        fontSize: 11 * scale,
        handles: model.messageFlows
          .filter((mf) => mf.poolId === bb.pool.id)
          .map((mf) => ({
            id: `t-${mf.id}`,
            offset: messageFlowLandning(mf, bb, senderX.get(mf.nodeId)) - bb.x,
          })),
      },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: 0,
      style: { zIndex: 0, ...GENOMSLÄPPLIG },
    }));
    // Sidhänvisningar: geometrin kommer ur layouten, så skärmen och exporten
    // ritar samma märke på samma plats.
    const refNodes: Node[] = layout.pageRefs.map((r, i) => ({
      id: `pref_${i}_${r.nodeId}`,
      type: "pageref",
      position: { x: r.x, y: r.y },
      data: {
        text: r.text,
        width: r.w,
        height: r.h,
        // Stubben i märkets egna koordinater, så vyn kan rita den oavsett om
        // märket sitter vid sidan av noden eller ovanför den.
        // Vägen kommer ur layouten (hänvisningsStubbe) – samma som exporten.
        stubbe: hänvisningsStubbe(r).map((p) => ({ x: p.x - r.x, y: p.y - r.y })),
        fontSize: 9.5 * scale,
        onHide: locked ? undefined : () => onPageRefHide?.(r.edgeSource, r.edgeTarget, r.sida),
      },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: 2,
      style: { zIndex: 2 },
    }));
    return [
      ...frameNodes,
      ...poolNodes,
      ...boxNodes,
      ...laneNodes,
      ...procNodes,
      ...storeNodes,
      ...refNodes,
    ];
    // `locked` MÅSTE vara med: datalagernoder och sidhänvisningar bär sina egna
    // draggable/selectable/onHide, som annars fryser i det gamla låsläget.
  }, [layout, fmt.aspect, scale, colorMode, onLabelChange, onLaneResize, model.messageFlows, locked, textScale, kopplaFrån]);

  const [nodes, setNodes] = useState<Node[]>(buildNodes);

  // Bygg om noder när modellen, sidformatet eller regenKey ändras.
  useEffect(() => {
    // Bär över React Flows MÄTNING av varje nod till den nya listan.
    //
    // Listan byggs om vid varje modelländring – alltså vid varje musrörelse
    // under ett bandrag. React Flow döljer en nod (visibility: hidden) tills
    // den mätts i DOM:en, och en ombyggnad nollställer mätningen. Under ett
    // snabbt drag hinner mätningen aldrig ikapp, och objekten blev osynliga
    // trots att de låg kvar på rätt plats i DOM:en. Ritytan såg helt tom ut.
    setNodes((förra) => {
      const mätt = new Map(förra.map((n) => [n.id, n.measured]));
      return buildNodes().map((n) => {
        const m = mätt.get(n.id);
        return m ? { ...n, measured: m } : n;
      });
    });
    // `kopplaFrån` MÅSTE vara med: markeringen av kopplingens startobjekt bor i
    // nodernas `data`, och utan den i listan byggdes noderna aldrig om – man såg
    // inte vad man valt. Ombyggnaden bär över mätningen, så den är billig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenKey, model, fmt.width, scale, colorMode, locked, textScale, spacing, kopplaFrån]);

  /** Hjälplinjer som visas medan ett objekt linjeras. */
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  /** Håller Shift nere? Läses i dragningen för att slå på linjering. */
  const alignKey = useRef(false);
  /**
   * Senast linjerade position per nod. React Flow rapporterar sin EGEN
   * position i onNodeDragStop – den är osnappad. Sparar vi inte vår justerade
   * position här skrivs linjeringen över vid släpp och objektet hoppar snett.
   */
  const snapped = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    const set = (e: KeyboardEvent | PointerEvent) => (alignKey.current = e.shiftKey);
    window.addEventListener("keydown", set);
    window.addEventListener("keyup", set);
    // Pekarhändelserna bär modifieraren under hela draget – se ApCanvas.
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
   * Läs tangenten direkt ur dragets egen händelse också. Global
   * tangentbevakning missar fallet att Shift trycktes ned innan canvasen fick
   * fokus – och det är precis då man greppar ett objekt.
   */
  const läsModifierare = useCallback((e: MouseEvent | TouchEvent) => {
    // Bara PÅ, aldrig av (se ApCanvas): en draghändelse utan modifierare
    // nollade annars flaggan mitt i ett drag där Shift hölls nere.
    if ("shiftKey" in e && e.shiftKey) alignKey.current = true;
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((nds) => {
        // Linjeringen ligger i snap.ts – ren funktion, egna tester.
        const snapNodes: SnapNode[] = nds.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          width: Number(n.style?.width ?? 0),
          height: Number(n.style?.height ?? 0),
        }));
        const res = applyAlignment(changes as SnapChange[], snapNodes, alignKey.current);
        for (const [id, pos] of res.snapped) snapped.current.set(id, pos);
        // Bara positionsomgångar rör hjälplinjerna – se ApCanvas: mått- och
        // markeringsändringar däremellan släckte linjen så fort den tänts.
        if (changes.some((c) => c.type === "position")) {
          setGuides(alignKey.current ? res.guides : {});
        }
        return applyNodeChanges(res.changes as NodeChange[], nds);
      }),
    [],
  );

  /**
   * Noderna plus eventuella hjälplinjer. Linjerna sträcker sig över hela
   * diagrammets bredd/höjd så att man ser vad man linjerar mot.
   */
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
  }, [nodes, guides, layout.height, layout.width]);

  /**
   * Vyn måste anpassas om när layouten byter form. Utan detta ritas diagrammet
   * visserligen om vid formatbyte, men kameran står kvar – och då ser det ut
   * som att ingenting hände, eller att flödet hamnat utanför bild.
   */
  useEffect(() => {
    if (!rf.current) return;
    // Kort fördröjning så att noderna hunnit få sina nya mått först.
    const t = setTimeout(() => rf.current?.fitView({ padding: 0.12, duration: 320 }), 60);
    return () => clearTimeout(t);
  }, [fmt.width, fmt.aspect, scale, regenKey]);

  /** Processobjektens rutor – underlag för de dragbara ändpunkterna. */
  /**
   * Rutorna som kantens ändpunktshandtag kan sitta på, nycklade med MODELLENS
   * id:n (det är dem `pickedEdge` bär, med canvas-prefixen rensade).
   *
   * Datalager och mottagarband MÅSTE med: `EdgeEndpoints` ger upp helt när den
   * inte hittar båda ändarnas ruta, så en streckad koppling hade inga dragbara
   * ändpunkter alls – man kunde inte flytta kopplingspunkten i det nedre lagret.
   * Samma pool finns som ett band per del; det FÖRSTA vinner, vilket räcker
   * eftersom banden ligger i samma x-rymd på varje del.
   */
  const boxes = useMemo<Box[]>(() => {
    const ut: Box[] = layout.nodes.map((ln) => ({ id: ln.node.id, x: ln.x, y: ln.y, w: ln.w, h: ln.h }));
    for (const ds of layout.dataStores) ut.push({ id: ds.store.id, x: ds.x, y: ds.y, w: ds.w, h: ds.h });
    for (const bb of layout.blackBoxes) {
      if (ut.some((b) => b.id === bb.pool.id)) continue;
      ut.push({ id: bb.pool.id, x: bb.x, y: bb.y, w: bb.w, h: bb.h });
    }
    return ut;
  }, [layout.nodes, layout.dataStores, layout.blackBoxes]);

  /**
   * Förskjutningen mellan det användaren SER och den FRIA layoutens
   * koordinater. I ett delat läge är varje del flyttad; sparas skärmpositionen
   * rakt av hamnar objektet någon helt annanstans när man byter format.
   */
  const offsets = useMemo(() => {
    const m = new Map<string, { dx: number; dy: number }>();
    for (const n of layout.nodes) m.set(n.node.id, { dx: n.dx, dy: n.dy });
    for (const ds of layout.dataStores) m.set(ds.store.id, { dx: ds.dx, dy: ds.dy });
    return m;
  }, [layout]);

  /** Vid släpp: spara positionerna och släck hjälplinjerna. */
  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node, dragged?: Node[]) => {
      setGuides({});
      // React Flow ger ALLA släpade noder som tredje argument. Sparades bara
      // den man höll i tappade en flermarkerings-dragning (Ctrl-klick) de
      // andras positioner – de hoppade tillbaka vid nästa ombyggnad.
      for (const n of dragged?.length ? dragged : [node]) {
        if (n.type !== "process" && n.type !== "datastore") continue;
        // Vår linjerade position vinner över React Flows egen.
        const pos = snapped.current.get(n.id) ?? n.position;
        snapped.current.delete(n.id);
        // Artefaktnoder har id-prefixet ds_ men steget heter som utan prefix.
        const id = n.id.replace(/^ds_/, "");

        const h = Number(n.height ?? n.measured?.height) || 0;
        const mittY = pos.y + h / 2;

        // Släpptes objektet på en ANNAN del/bild i flersidigt läge är avsikten
        // en flytt dit. Hänvisningar och kopplingar räknas om automatiskt –
        // de härleds ur deltillhörigheten. Släppunkten översätts till fria
        // koordinater via ett objekt i SAMMA bana på måldelen (varje del har
        // sin egen förskjutning); saknas ett sådant hamnar objektet på sin
        // autoplats i måldelen.
        const laid = layout.nodes.find((ln) => ln.node.id === id);
        const laidStore = layout.dataStores.find((ds) => ds.store.id === id);
        const egenSida = laid?.page ?? laidStore?.page;
        const målSida = layout.pages.find((p) => mittY >= p.y && mittY < p.y + p.h)?.number;
        if (
          onPageMove &&
          layout.pages.length > 1 &&
          egenSida !== undefined &&
          målSida !== undefined &&
          målSida - 1 !== egenSida
        ) {
          const mål = målSida - 1;
          const referens = layout.nodes.find(
            (ln) => ln.page === mål && ln.node.laneId === (laid?.node.laneId ?? laidStore?.store.laneId),
          );
          onPageMove(
            id,
            mål,
            referens ? { x: pos.x - referens.dx, y: pos.y - referens.dy } : undefined,
          );
          continue;
        }

        // Släpptes objektet med sin MITTPUNKT i en annan simbanas band är
        // avsikten ett banbyte. Att bara spara läget fungerar inte nedåt:
        // banan måste omsluta sina noder, så den VÄXER ner runt objektet och
        // bandgränsen flyttar sig – man kunde aldrig lämna banan söderut.
        // Vaktad mot misstag: mittpunkten (inte kanten) avgör, och
        // nodeDragThreshold stoppar mikrodrag när man siktar på ett handtag.
        const nuvarande = laid?.node.laneId ?? laidStore?.store.laneId;
        const målband = layout.lanes.find(
          (l) => (egenSida === undefined || l.page === egenSida) && mittY >= l.y && mittY < l.y + l.h,
        );
        if (onLaneChange && målband && nuvarande && målband.id !== nuvarande) {
          onLaneChange(id, målband.id);
          continue; // läget hör till förra banans ram – spara det inte
        }

        const o = offsets.get(id) ?? { dx: 0, dy: 0 };
        onPositionChange?.(id, { x: pos.x - o.dx, y: pos.y - o.dy });
      }
    },
    [onPositionChange, onLaneChange, onPageMove, offsets, layout.nodes, layout.dataStores, layout.lanes, layout.pages],
  );

  /**
   * Kantände omdragen till ett annat handtag → spara den valda sidan.
   * React Flow ger oss det nya handtaget; vi översätter till en sida och
   * lämnar den andra änden orörd.
   */
  /**
   * Vald kant – öppnar en liten inspektör där kopplingspunkterna kan väljas
   * explicit. Att dra i piländen fungerar också, men små träffytor gör den
   * gesten fumlig; knappar är alltid träffsäkra.
   */
  const [pickedEdge, setPickedEdge] = useState<{
    source: string;
    target: string;
    /** Kantens etikett – behövs för att skilja två pilar mellan samma nodpar. */
    label?: string;
  } | null>(null);

  /**
   * Kanten pekaren är ÖVER. Ändpunkterna visas för den också, inte bara för en
   * markerad kant.
   *
   * Varför: handtagen fanns bara medan kanten var markerad, och för att markera
   * den måste man först träffa en tunn linje med musen. Missade man fanns
   * ingenting att gripa – det kändes som att kopplingen inte gick att dra alls.
   * Nu räcker det att föra musen över pilen.
   *
   * Hovern nollas INTE när pekaren lämnar linjen: handtagen ligger utanför
   * linjens träffyta, så det skulle rycka undan dem i samma rörelse som man
   * sträcker sig efter dem. Den byts när man hovrar en annan kant, och släcks
   * när man klickar i ritytan.
   */
  const [hovradKant, setHovradKant] = useState<{
    source: string;
    target: string;
    label?: string;
  } | null>(null);

  /**
   * Kanten vars ETIKETT redigeras. Ligger här och inte i RoutedEdge: React Flow
   * lägger en egen osynlig interaktionsbana ovanpå varje kant, så ett
   * dubbelklick på kantens egen träffyta nådde aldrig fram. `onEdgeDoubleClick`
   * gör det.
   */
  const [redigerarKant, setRedigerarKant] = useState<{
    source: string;
    target: string;
    label?: string;
  } | null>(null);

  /** Markerat objekt – öppnar en liten inspektör för textstorlek/-placering. */
  const [pickedNode, setPickedNode] = useState<string | null>(null);

  /**
   * Ny koppling dragen för hand.
   *
   * Sorten avgörs vid kompileringen av vad ändarna är – ett datalager ger en
   * dataassociation, en mottagarpool ett meddelandeflöde, annars ett
   * sekvensflöde. Här räcker det att veta VILKA två objekt som kopplas.
   */
  const onConnectNew = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      // Artefaktnoder bär id-prefixet ds_ i canvasen men heter utan det i modellen.
      const rensa = (id: string) => id.replace(/^ds_/, "").replace(/^bb_\d+_/, "");
      onEdgeAdd?.(rensa(c.source), rensa(c.target));
    },
    [onEdgeAdd],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, conn: Connection) => {
      const sourceSide = sideFromHandle(conn.sourceHandle);
      const targetSide = sideFromHandle(conn.targetHandle);
      const label = typeof oldEdge.label === "string" ? oldEdge.label : undefined;
      // Streckade kanters ändar bär canvas-prefix (ds_/bb_) – utan rensning
      // sparades sidovalet under en nyckel som kompileringen aldrig slår upp.
      const rensa = (id: string) => id.replace(/^ds_/, "").replace(/^bb_\d+_/, "");
      onEdgeSidesChange?.(rensa(oldEdge.source), rensa(oldEdge.target), { sourceSide, targetSide }, label);
    },
    [onEdgeSidesChange],
  );

  // Hindren som routern går runt: alla nod- och artefaktrutor.
  useMemo(() => {
    const m = new Map<string, Rect>();
    for (const n of layout.nodes) m.set(n.node.id, { x: n.x, y: n.y, w: n.w, h: n.h });
    for (const d of layout.dataStores) m.set(d.store.id, { x: d.x, y: d.y, w: d.w, h: d.h });
    obstacleRects.current = m;
    // Nollställ de delade kantvägarna (Shift-linjeringens mål) – annars
    // spökar vägar från borttagna kanter kvar som linjeringsmål.
    edgePaths.current = new Map();
  }, [layout]);

  const seqEdges: Edge[] = useMemo(() => {
    const box = new Map(layout.nodes.map((n) => [n.node.id, n]));
    return model.edges
      // Korsar kanten en sidbrytning ersätts den av sidhänvisningar i var ände
      // (se layout.pageRefs). En linje dit skulle gå tvärs genom dokumentet.
      .filter((e) => {
        const a = box.get(e.source);
        const b = box.get(e.target);
        return !a || !b || a.page === b.page;
      })
      .map((e) => {
      const a = box.get(e.source);
      const b = box.get(e.target);
      // Sidoregeln (ISO 5807 + manuella val) delas med SVG-exporten – EN
      // implementation i edge-router.ts, så skärm och fil aldrig glider isär.
      let sourceHandle = "s-right";
      let targetHandle = "t-left";
      if (a && b) {
        const [sa, sb] = pickEdgeSides(a, b, e);
        sourceHandle = `s-${sa}`;
        targetHandle = `t-${sb}`;
      } else {
        if (e.sourceSide) sourceHandle = `s-${e.sourceSide}`;
        if (e.targetSide) targetHandle = `t-${e.targetSide}`;
      }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle,
        label: e.label,
        type: "routed",
        // Brytpunkten (fri-koordinater) plus källnodens förskjutning, så att
        // RoutedEdge kan översätta den till aktuell vy. Låst läge ger inget
        // dragbart handtag.
        data: {
          waypoint: e.waypoint ?? null,
          srcDx: offsets.get(e.source)?.dx ?? 0,
          srcDy: offsets.get(e.source)?.dy ?? 0,
          onWaypointChange: locked ? undefined : onEdgeWaypointChange,
          // Etikettens egen plats längs vägen (andel), och dess dragning.
          labelPos: e.labelPos,
          onLabelPosChange: locked ? undefined : onEdgeLabelPosChange,
          // Dubbelklick på kopplingen skriver etiketten.
          onLabelTextChange: locked ? undefined : onEdgeLabelTextChange,
          redigerar:
            redigerarKant?.source === e.source &&
            redigerarKant?.target === e.target &&
            redigerarKant?.label === e.label,
          onStängEtikett: () => setRedigerarKant(null),
          onÖppnaEtikett: locked
            ? undefined
            : () => setRedigerarKant({ source: e.source, target: e.target, label: e.label }),
          etikettHinder: etikettHinder
            ? (nuvarande: string | undefined, ny: string) => etikettHinder(e.source, nuvarande, ny)
            : undefined,
        } as RoutedEdgeData,
        // Etiketten följer layoutens FAKTISKA skala, inte den användaren valt. När
        // ett brett flöde krymps för att rymmas på sidan blir "Ja"/"Nej" annars
        // större än noderna de sitter mellan.
        ...etikettStil(layout.scale),
        // Alla poster i `edges` är sekvensflöden: heldragen linje, fylld pil.
        markerEnd: { type: "arrowclosed" as const, color: EDGE_STROKE },
        style: { stroke: EDGE_STROKE, strokeWidth: 1.6 },
        // Går att dra i änden för att byta kopplingspunkt (om inte låst).
        reconnectable: !locked,
        // Osynlig träffyta runt pilen – annars är den nästan omöjlig att
        // klicka på. Men den får inte vara så bred att den lägger sig över
        // banornas dragghandtag när en kant löper längs en banas kant; då går
        // banan inte att dra i på den sträckan.
        interactionWidth: 14,
        zIndex: 1,
      };
    });
  }, [model.edges, layout, locked, offsets, onEdgeWaypointChange, onEdgeLabelPosChange, onEdgeLabelTextChange, etikettHinder, redigerarKant]);

  /**
   * Artefaktkanter: dataassociationer och meddelandeflöden. BPMN ritar båda
   * streckade med ÖPPEN pilspets, tunnare än sekvensflödet, för att visuellt
   * skilja dem från det egentliga flödet.
   *
   * De är annoteringar, men de tar samma plats på pappret som sekvensflödet och
   * går därför att styra likadant: välja, ta bort, byta kopplingspunkt OCH dra
   * böjen. Att bara böjen saknades gjorde att en streckad pil som låg i vägen
   * inte gick att flytta undan.
   */
  const artifactEdges: Edge[] = useMemo(() => {
    // Streckade kopplingar (dataassociationer och meddelandeflöden) var helt
    // inerta: varken valbara, klickbara eller borttagbara. De går nu att välja
    // och ta bort precis som sekvensflödena.
    const passiv = {
      type: "routed",
      markerEnd: { type: "arrow" as const, color: EDGE_STROKE },
      style: { stroke: EDGE_STROKE, strokeWidth: 1, strokeDasharray: "5 4" },
      selectable: !locked,
      focusable: !locked,
      deletable: !locked,
      reconnectable: !locked,
      interactionWidth: locked ? 0 : 14,
      zIndex: 1,
    };

    /**
     * Brytpunktsdata för en streckad koppling.
     *
     * `nyckelKälla`/`nyckelMål` är de id:n som `edgeKey` nycklas på i
     * mellanlagret – MODELLENS id:n (inte canvasens prefixade `ds_…`/`bb_0_…`)
     * och i PILENS riktning, för det är så kompileringen läser dem tillbaka.
     * `dragKälla` är bara koordinatramen brytpunkten räknas relativt.
     */
    /**
     * Etikettredigering för en streckad koppling. Samma maskineri som
     * sekvensflödena – utan det gick etiketten inte att skriva på en streckad
     * pil alls, och "dubbelklicka en koppling" gällde bara hälften av dem.
     */
    const etikettData = (
      nyckelKälla: string,
      nyckelMål: string,
      etikett: string | undefined,
    ): Partial<RoutedEdgeData> => ({
      // Nycklarna kommer HÄRIFRÅN, inte från kantens ändar: RoutedEdge känner
      // bara canvas-id:n (ds_… , bb_N_…), och mellanlagret nycklas på modellens.
      // Etiketten sparades annars under en nyckel ingen läser tillbaka.
      onLabelTextChange: locked
        ? undefined
        : (_s: string, _t: string, nuvarande: string | undefined, ny: string) =>
            onEdgeLabelTextChange?.(nyckelKälla, nyckelMål, nuvarande, ny),
      etikettHinder: etikettHinder
        ? (nuvarande: string | undefined, ny: string) => etikettHinder(nyckelKälla, nuvarande, ny)
        : undefined,
      redigerar:
        redigerarKant?.source === nyckelKälla &&
        redigerarKant?.target === nyckelMål &&
        redigerarKant?.label === etikett,
      onStängEtikett: () => setRedigerarKant(null),
      onÖppnaEtikett: locked
        ? undefined
        : () => setRedigerarKant({ source: nyckelKälla, target: nyckelMål, label: etikett }),
    });

    const brytpunkt = (
      nyckelKälla: string,
      nyckelMål: string,
      dragKälla: string,
      waypoint: { x: number; y: number } | null | undefined,
      extra: Partial<RoutedEdgeData> = {},
    ): RoutedEdgeData =>
      ({
        waypoint: waypoint ?? null,
        // Förskjutningen för den nod handtaget räknas RELATIVT – samma
        // koordinatram som sekvensflödena sparar i (fria layouten).
        srcDx: offsets.get(dragKälla)?.dx ?? 0,
        srcDy: offsets.get(dragKälla)?.dy ?? 0,
        onWaypointChange: locked
          ? undefined
          : (_s: string, _t: string, point: { x: number; y: number } | null) =>
              onEdgeWaypointChange?.(nyckelKälla, nyckelMål, point),
        ...extra,
      }) as RoutedEdgeData;

    const storeIds = new Set(layout.dataStores.map((ds) => ds.store.id));
    const nodeIds = new Set(layout.nodes.map((n) => n.node.id));
    const nodBoxar = new Map(layout.nodes.map((n) => [n.node.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
    const lagerBoxar = new Map(layout.dataStores.map((d) => [d.store.id, { x: d.x, y: d.y, w: d.w, h: d.h }]));
    const boxIds = new Set(layout.blackBoxes.map((bb) => bb.pool.id));

    const sidaFörLager = new Map(layout.dataStores.map((ds) => [ds.store.id, ds.page]));
    const sidaFörNod = new Map(layout.nodes.map((n) => [n.node.id, n.page]));
    const das: Edge[] = model.dataAssociations
      .filter((a) => nodeIds.has(a.nodeId) && storeIds.has(a.dataStoreId))
      // Associationen är en annotering, inte flödet. Korsar den en sidbrytning
      // ritas den inte alls – artefakten säger mer där den står.
      .filter((a) => sidaFörNod.get(a.nodeId) === sidaFörLager.get(a.dataStoreId))
      .map((a) => {
        // Sidorna väljs av GEOMETRIN med samma delade regel som sekvens-
        // flödena (pickEdgeSides): ligger målet nedanför lämnar pilen
        // UNDERKANTEN – aldrig ut ur toppen och runt. Manuella val vinner.
        const skriv = a.direction === "write";
        const nodBox = nodBoxar.get(a.nodeId);
        const dsBox = lagerBoxar.get(a.dataStoreId);
        const källa = skriv ? nodBox : dsBox;
        const mål = skriv ? dsBox : nodBox;
        const [sa, sb] =
          källa && mål
            ? pickEdgeSides(källa, mål, { sourceSide: a.sourceSide, targetSide: a.targetSide })
            : [a.sourceSide ?? (skriv ? "bottom" : "top"), a.targetSide ?? (skriv ? "top" : "bottom")];
        return {
          ...passiv,
          id: `${DA_PREFIX}${a.id}`,
          source: skriv ? a.nodeId : `ds_${a.dataStoreId}`,
          target: skriv ? `ds_${a.dataStoreId}` : a.nodeId,
          sourceHandle: `s-${sa}`,
          targetHandle: `t-${sb}`,
          // NYCKELN FÖLJER PILENS RIKTNING – skrivning nod→lager, läsning
          // lager→nod. Det är den ordning `edgeStyleFor` letar med när
          // associationen kompileras (och samma som `onReconnect` sparar sidorna
          // under). En läsning nycklad nod→lager sparades under en nyckel ingen
          // läser tillbaka: böjen försvann i samma ögonblick som den sattes.
          //
          // KOORDINATRAMEN är däremot alltid AKTIVITETENS, oavsett riktning –
          // annars låg en läsning i lagrets ram och en skrivning i nodens, och
          // exporten hade ingen entydig regel att översätta med.
          label: a.label,
          ...etikettStil(layout.scale),
          data: brytpunkt(
            skriv ? a.nodeId : a.dataStoreId,
            skriv ? a.dataStoreId : a.nodeId,
            a.nodeId,
            a.waypoint,
            etikettData(
              skriv ? a.nodeId : a.dataStoreId,
              skriv ? a.dataStoreId : a.nodeId,
              a.label,
            ),
          ),
        };
      });

    /**
     * Punkten på mottagarbandets ovankant där pilen landar – samma räkning som
     * bandets egna handtag och SVG-exporten (`messageFlowLandning`). Bandet tas
     * på AVSÄNDARENS sida; det finns ett per del.
     */
    const bandPunkt = (mf: ProcessModel["messageFlows"][number]) => {
      const sida = sidaFörNod.get(mf.nodeId) ?? 0;
      const bb = layout.blackBoxes.find((b) => b.pool.id === mf.poolId && b.page === sida);
      const n = nodBoxar.get(mf.nodeId);
      if (!bb) return undefined;
      return {
        x: messageFlowLandning(mf, bb, n ? n.x + n.w / 2 : undefined),
        y: bb.y,
      };
    };

    const mfs: Edge[] = model.messageFlows
      .filter((mf) => nodeIds.has(mf.nodeId) && boxIds.has(mf.poolId))
      .map((mf) => ({
        ...passiv,
        id: `${MF_PREFIX}${mf.id}`,
        source: mf.nodeId,
        // STRIKT BPMN: målet är alltid en annan deltagare. Svartlådepoolen har
        // ett eget handtag per meddelandeflöde (se BlackBoxView).
        // Mottagarbandet finns på VARJE sida – ta det på avsändarens egen sida,
        // annars drar pilen tvärs genom hela dokumentet till sida 1:s band.
        target: `bb_${sidaFörNod.get(mf.nodeId) ?? 0}_${mf.poolId}`,
        sourceHandle: `s-${mf.sourceSide ?? "bottom"}`,
        // Rakt ner till mottagarbandet – annoteringen ska inte böja runt objekt.
        // Men `rak` är ett FÖRVAL: har man dragit i böjen äger man vägen, precis
        // som för sekvensflödena, och då gäller brytpunkten i stället.
        data: brytpunkt(mf.nodeId, mf.poolId, mf.nodeId, mf.waypoint, {
          ...etikettData(mf.nodeId, mf.poolId, mf.label),
          rak: !mf.waypoint,
          // Landningspunkten kommer ur LAYOUTEN, inte ur React Flows mätta
          // handtag. Mätningen cachas per nod: flyttade man avsändaren följde
          // pilens start med, men slutet stod kvar där noden hade legat.
          to: bandPunkt(mf),
        }),
        targetHandle: `t-${mf.id}`,
        label: mf.label,
        ...etikettStil(layout.scale),
      }));

    return [...das, ...mfs];
    // `locked` MÅSTE vara med: `passiv` bär selectable/deletable/reconnectable,
    // som annars fryser i det gamla låsläget tills något annat ändras. Samma sak
    // för `offsets` och `onEdgeWaypointChange`, som `brytpunkt` läser.
  }, [
    model.dataAssociations,
    model.messageFlows,
    layout,
    locked,
    offsets,
    onEdgeWaypointChange,
    onEdgeLabelTextChange,
    etikettHinder,
    redigerarKant,
  ]);

  /**
   * Markerade kanter. Kanterna är en helt styrd prop (räknas fram ur modellen),
   * så React Flow kan inte hålla markeringen själv – utan detta blev en kant
   * aldrig `selected`, och Delete-tangenten nådde aldrig onEdgesDelete.
   */
  const [valdaKanter, setValdaKanter] = useState<Set<string>>(new Set());
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setValdaKanter((förra) => {
      let next: Set<string> | null = null;
      for (const c of changes) {
        if (c.type !== "select") continue;
        next ??= new Set(förra);
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
      return next ?? förra;
    });
  }, []);

  /**
   * Placerar det valda palettobjektet där man klickade. Returnerar true när
   * klicket förbrukades. Positionen sparas i FRIA layoutens koordinater (som
   * nodpositioner), och banan är den man klickade i.
   */
  const placera = useCallback(
    (e: { clientX: number; clientY: number }): boolean => {
      if (!verktyg || verktyg === "koppla" || !onObjektPlacera) return false;
      const p = rf.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (!p) return false;
      const bana = layout.lanes.find((l) => p.y >= l.y && p.y <= l.y + l.h) ?? layout.lanes[0];
      const del = layout.pages.find(
        (sida) => p.y >= sida.y && p.y <= sida.y + sida.h && p.x >= sida.x && p.x <= sida.x + sida.w,
      );
      onObjektPlacera(
        verktyg,
        { x: p.x - (del?.x ?? 0), y: p.y - (del?.y ?? 0) },
        bana?.id ?? layout.lanes[0]?.id ?? portalbana(),
      );
      return true;
    },
    [verktyg, onObjektPlacera, layout],
  );

  /**
   * Markeringen släpps när kanten inte längre finns.
   *
   * `pickedEdge` är ett NODPAR och överlever en omkompilering. Drar man en ny
   * koppling kan den markerade kanten försvinna (undertryckt dubblett, ändrad
   * kedja) – och då stod inspektören kvar och påstod att pilen var "en genväg
   * förbi dolda objekt i verksamhetsvyn", mitt i systemvyn.
   */
  useEffect(() => {
    if (!pickedEdge) return;
    if (!findPickedEdge(model, pickedEdge)) setPickedEdge(null);
  }, [model, pickedEdge]);

  /** Kanten ändpunkterna gäller: den markerade, annars den hovrade. */
  const aktivKant = pickedEdge ?? hovradKant;

  const edges = useMemo(
    () =>
      [...seqEdges, ...artifactEdges].map((e) => (valdaKanter.has(e.id) ? { ...e, selected: true } : e)),
    [seqEdges, artifactEdges, valdaKanter],
  );

  /**
   * VAD MUSEN GÖR på tom yta: markera med en ram, eller flytta vyn med handen.
   *
   * Två gester om samma knapp – React Flow slår av markeringsramen så fort
   * `panOnDrag` är `true` – alltså ett läge man ser och kan byta i växeln
   * (PekarVal). Markera är förvalet i redigeringsläget: den som bara vill
   * titta gör det i läsläget, där handen alltid gäller.
   */
  const [pekarläge, setPekarläge] = useState<Pekarläge>("markera");

  /**
   * MARKERINGSRUTA: dra med vänster musknapp på tom yta för att rama in flera
   * objekt och sedan flytta dem tillsammans (beslut 2026-09-07).
   *
   * Gäller bara i REDIGERINGSLÄGE, bara med tom hand och bara i markeringsläget:
   * i låst läge (läsläge), med ett ritverktyg i handen och med handen vald
   * betyder vänsterdraget något annat – panorera respektive placera – och då
   * ska ingen ram ritas.
   *
   * Panoreringen finns alltid kvar på mitten- och högerknappen (PAN_BUTTONS)
   * och på mellanslag + vänsterdrag, oavsett vilket läge växeln står i.
   */
  const markeringsruta = !locked && !verktyg && pekarläge === "markera";

  return (
    <div
      className={`ark-canvas ${verktyg ? `ark-verktyg-${verktyg}` : ""} ${
        markeringsruta ? "ark-canvas--markera" : ""
      }`}
    >
      {/* VERKTYGSRADEN – samma gest som affärsprocesspaletten: välj verktyg, klicka på
          ytan. Ligger på ritytan, inte i sidopanelen, eftersom den hör till det
          man gör med musen just nu. */}
      {!locked && visaVerktyg && (
        <div className="ark-verktygsrad">
          {/* Först i raden: vad musen gör på tom yta. Allt annat i raden är
              något man RITAR med; det här är hur man pekar. */}
          <PekarVal läge={pekarläge} onVälj={setPekarläge} />
          <button
            className={`ark-verktygsknapp ${verktyg === "koppla" ? "active" : ""}`}
            onClick={() => (verktyg === "koppla" ? avbrytVerktyg() : setVerktyg("koppla"))}
            title="Klicka två objekt för att koppla ihop dem. Esc avbryter."
          >
            <span className="ark-verktygsikon">⇢</span>
            Koppla ihop
          </button>
          <FlowPalett
            vald={verktyg && verktyg !== "koppla" ? (verktyg as NodeType) : null}
            onVälj={(typ) => {
              setKopplaFrån(null);
              setVerktyg(typ);
            }}
            colorMode={colorMode}
          />
          {verktyg === "koppla" && (
            <span className={`ark-verktygshjälp ${kopplaFel ? "fel" : ""}`}>
              {kopplaFel ??
                (kopplaFrån
                  ? "Klicka objektet kopplingen ska gå TILL. Klick på samma igen ångrar."
                  : "Klicka objektet kopplingen ska gå FRÅN.")}
              {" · Esc avbryter"}
            </span>
          )}
        </div>
      )}
      <ReactFlow
        nodes={guideNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(inst) => (rf.current = inst)}
        onNodeDragStart={läsModifierare}
        onNodeDrag={läsModifierare}
        selectionKeyCode={SELECTION_KEY}
        multiSelectionKeyCode={SELECTION_KEY}
        selectionOnDrag={markeringsruta}
        // Panoreringen flyttar till mitten-/högerknappen medan markeringsrutan
        // har vänster. `true` här skulle stänga av markeringsrutan helt.
        panOnDrag={markeringsruta ? PAN_BUTTONS : true}
        // Delvis: ett objekt som ramen NUDDAR räknas med. Kravet att rama in
        // hela objektet gör att man missar det man tydligt siktat på.
        selectionMode={SelectionMode.Partial}
        /**
         * Delete/Backspace tar ALDRIG bort objekt – bara kopplingar.
         *
         * Markeringsrutan markerar även kanterna mellan de inramade objekten
         * (React Flows egen regel). Utan spärren hade en flermarkering plus
         * Delete tyst plockat bort alla de kopplingarna ur mellanlagret, medan
         * objekten kom tillbaka vid nästa omritning. Objekt tas bort i
         * inspektören, där man ser vad man tar bort.
         */
        onBeforeDelete={async ({ nodes: markerade }) => markerade.length === 0}
        onSelectionChange={rapporteraMarkering}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={(_e, edge) => {
          // Även streckade kopplingar går att välja nu. Deras ändar heter med
          // canvas-prefix (ds_/bb_) – modellen känner dem utan.
          setPickedEdge(kantNyckel(edge));
        }}
        // Ändpunkterna visas redan när pekaren är ÖVER pilen – man behöver inte
        // markera den först. Se `hovradKant`.
        onEdgeMouseEnter={(_e, edge) => setHovradKant(kantNyckel(edge))}
        // Dubbelklick på en koppling skriver dess etikett – samma gest som på
        // ett objekt. Även en omärkt koppling kan få en.
        onEdgeDoubleClick={(_e, edge) => !locked && setRedigerarKant(kantNyckel(edge))}
        onPaneClick={(e) => {
          if (placera(e)) return;
          setPickedEdge(null);
          setPickedNode(null);
          setHovradKant(null);
          setRedigerarKant(null);
        }}
        onNodeClick={(e, n) => {
          // Banor, poolramar och sidramar är NODER som täcker hela ytan – ett
          // klick på "tom yta" landar på dem, inte på ritytan. Utan detta
          // fyrades `onPaneClick` nästan aldrig och paletten verkade död.
          if (n.type === "lane" || n.type === "pool" || n.type === "page") {
            if (placera(e)) return;
            setPickedEdge(null);
            setPickedNode(null);
            setRedigerarKant(null);
            return;
          }
          if (n.type !== "process" && n.type !== "datastore") return;
          const id = n.id.replace(/^ds_/, "");
          // KOPPLINGSLÄGET: första klicket väljer start, andra skapar kopplingen.
          // Verktyget stannar kvar så flera kopplingar kan dras i följd; Esc
          // avbryter. Klick på samma objekt igen ångrar startvalet.
          if (verktyg === "koppla") {
            if (!kopplaFrån) return setKopplaFrån(id);
            if (kopplaFrån === id) return setKopplaFrån(null);
            // Säg VARFÖR när kopplingen inte går. Tidigare hände ingenting alls,
            // och man visste inte om man missat objektet eller om det var otillåtet.
            const hinder = kopplingHinder?.(kopplaFrån, id) ?? null;
            if (hinder) return setKopplaFel(hinder);
            setKopplaFel(null);
            onEdgeAdd?.(kopplaFrån, id);
            setKopplaFrån(null);
            return;
          }
          // Bara riktiga objekt har en textinspektör – band, ramar och märken inte.
          setPickedNode(id);
          setPickedEdge(null);
        }}
        onEdgesDelete={(borttagna) => {
          // Gäller ALLA sorters kopplingar – även streckade (dataassociationer
          // och meddelandeflöden), vars ändar bär canvas-prefix som modellen
          // inte känner. Tidigare hoppades de över och Delete gjorde ingenting.
          const rensa = (id: string) => id.replace(/^ds_/, "").replace(/^bb_\d+_/, "");
          for (const e of borttagna) {
            onEdgeRemove?.(
              rensa(e.source),
              rensa(e.target),
              typeof e.label === "string" ? e.label : undefined,
            );
          }
          setValdaKanter(new Set());
          setPickedEdge(null);
        }}
        onReconnect={onReconnect}
        onConnect={onConnectNew}
        edgesReconnectable={!locked}
        // Med ett verktyg aktivt ska ett klick VÄLJA objektet, inte flytta det.
        nodesDraggable={!locked && !verktyg}
        // Ett drag börjar först efter några pixlars rörelse. Utan tröskeln
        // flyttade ett darr på handen NODEN när man siktade på ett kopplings-
        // handtag – det var så objekt hamnade i fel bana av misstag.
        nodeDragThreshold={6}
        nodesConnectable={!locked}
        elementsSelectable={!locked}
        fitView
        reconnectRadius={20}
        /**
         * SNÄPPRADIEN för en ny koppling. Standard är 20 px, och
         * kopplingspunkterna är 7 px prickar – släppte man mitt på målobjektet
         * (det naturliga: "koppla till DEN HÄR rutan") nådde man ingen punkt och
         * kopplingen blev aldrig till. Den gick igenom i en riktning och inte i
         * den andra, beroende på hur långt objektets mitt råkade ligga från
         * närmaste prick. 60 px räcker för att mitten av ett normalstort objekt
         * alltid snäpper till sin närmaste sida.
         */
        connectionRadius={60}
        // Dubbelklick-zoomen SVALDE alla dubbelklick vid panelen (d3-zoom
        // stoppar eventet där), så Reacts onDoubleClick på banhandtag och
        // brytpunkter nåddes aldrig – "återställ med dubbelklick" var dött.
        // Zoomen styrs med scroll och kontrollerna; dubbelklicken behövs till
        // återställningarna.
        zoomOnDoubleClick={false}
        // Lågt golv: ett flersidigt utlägg är flera tusen pixlar högt, och vid
        // 0,2 gick det inte att rama in ens med "passa in" – man blev stående
        // mitt i dokumentet utan att se var man var. Läsbarheten sköts av
        // zoomen man själv väljer, inte av golvet.
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#eef1f5" />
        <Controls />
        <MiniMap pannable zoomable nodeColor={() => "#c7cede"} />
        {/* Ändpunkterna visas för den MARKERADE kanten, och annars för den man
            HOVRAR – så man aldrig behöver markera först för att kunna dra. */}
        {aktivKant && !locked && (
          <EdgeEndpoints
            key={`${aktivKant.source}->${aktivKant.target}#${aktivKant.label ?? ""}`}
            boxes={boxes}
            // Visa de valbara kopplingspunkterna – och de går att KLICKA.
            // Att dra den lilla ändpunkten till rätt sida krävde en precis gest:
            // på ett brett lågt objekt är träffytan för "vänster" bara några
            // pixlar bred, och missar man hamnar pilen på toppen i stället.
            visaPunkter
            // Bara sidans mitt: routern fäster alltid pilen där, så fler punkter
            // vore ett val utan verkan.
            punktval={MITTEN}
            source={aktivKant.source}
            target={aktivKant.target}
            // Etiketten MÅSTE med (invariant 3): den automatiska sidoregeln
            // behöver veta att kanten är en gren, annars sattes handtaget på en
            // annan sida än pilen ritades på och gick inte att greppa.
            label={aktivKant.label}
            sourceSide={findPickedEdge(model, aktivKant)?.sourceSide}
            targetSide={findPickedEdge(model, aktivKant)?.targetSide}
            // Meddelandeflödet landar på mottagarbandet där LAYOUTEN säger –
            // rakt under avsändaren, eller där man dragit punkten. Handtaget
            // ska sitta där pilen faktiskt slutar, inte mitt på ett band som är
            // brett som hela sidan.
            targetPunkt={vandPunktFörValdKant(model, layout, aktivKant)}
            onPick={(sides) =>
              onEdgeSidesChange?.(aktivKant.source, aktivKant.target, sides, aktivKant.label)
            }
            onClear={(ände) =>
              onEdgeSidesChange?.(
                aktivKant.source,
                aktivKant.target,
                ände === "source"
                  ? { sourceSide: undefined, sourcePos: undefined }
                  : { targetSide: undefined, targetPos: undefined },
                aktivKant.label,
              )
            }
          />
        )}
      </ReactFlow>

      {pickedNode && !locked && onTextStyleChange && (
        <NodeInspector
          node={model.nodes.find((n) => n.id === pickedNode) ?? null}
          store={model.dataStores.find((ds) => ds.id === pickedNode) ?? null}
          onChange={(patch) => onTextStyleChange(pickedNode, patch)}
          onClose={() => setPickedNode(null)}
        />
      )}

      {pickedEdge && !locked && (
        <EdgeInspector
          source={pickedEdge.source}
          target={pickedEdge.target}
          current={findPickedEdge(model, pickedEdge)}
          label={nodeLabel(model, pickedEdge.source) + " → " + nodeLabel(model, pickedEdge.target)}
          onPick={(sides) =>
            onEdgeSidesChange?.(pickedEdge.source, pickedEdge.target, sides, pickedEdge.label)
          }
          onReset={() => onEdgeSidesReset?.(pickedEdge.source, pickedEdge.target, pickedEdge.label)}
          onRemove={() => {
            onEdgeRemove?.(pickedEdge.source, pickedEdge.target, pickedEdge.label);
            setPickedEdge(null);
          }}
          editable={editablePairs ? editablePairs.has(`${pickedEdge.source}->${pickedEdge.target}`) : true}
          onClose={() => setPickedEdge(null)}
        />
      )}
    </div>
  );
}

/** Nodens etikett, för inspektörens rubrik. */
function nodeLabel(model: ProcessModel, id: string): string {
  return model.nodes.find((n) => n.id === id)?.label ?? id;
}

/**
 * Den valda kanten i modellen. Etiketten avgör när två pilar delar nodpar
 * (Ja/Nej från ett beslut till samma steg) – utan den träffades alltid den
 * första av dem, oavsett vilken man klickade på.
 */
function findPickedEdge(
  model: ProcessModel,
  picked: { source: string; target: string; label?: string },
): { sourceSide?: EdgeSide; targetSide?: EdgeSide } | undefined {
  const kandidater = model.edges.filter(
    (e) => e.source === picked.source && e.target === picked.target,
  );
  const kant = kandidater.find((e) => e.label === picked.label) ?? kandidater[0];
  if (kant) return kant;
  // Streckade kopplingar: dataassociationens riktning avgör vad som är källa.
  const da = model.dataAssociations.find((a) =>
    a.direction === "write"
      ? a.nodeId === picked.source && a.dataStoreId === picked.target
      : a.dataStoreId === picked.source && a.nodeId === picked.target,
  );
  if (da) return { sourceSide: da.sourceSide, targetSide: da.targetSide };
  const mf = model.messageFlows.find(
    (f) => f.nodeId === picked.source && f.poolId === picked.target,
  );
  if (mf) return { sourceSide: mf.sourceSide };
  return undefined;
}

/**
 * Punkten där ett MEDDELANDEFLÖDES pil landar på mottagarbandet, så att
 * ändpunktshandtaget sitter där pilen faktiskt slutar. `undefined` för allt
 * annat – då räknar `EdgeEndpoints` fram sidans punkt själv, som förut.
 *
 * Bandet är brett som hela sidan: utan den här punkten hamnade handtaget mitt på
 * bandet, långt ifrån pilen, och man trodde att kopplingspunkten inte gick att ta i.
 */
function vandPunktFörValdKant(
  model: ProcessModel,
  layout: LayoutResult,
  picked: { source: string; target: string },
): { x: number; y: number } | undefined {
  const mf = model.messageFlows.find(
    (f) => f.nodeId === picked.source && f.poolId === picked.target,
  );
  if (!mf) return undefined;
  const n = layout.nodes.find((x) => x.node.id === mf.nodeId);
  const bb = layout.blackBoxes.find((b) => b.pool.id === mf.poolId && b.page === (n?.page ?? 0));
  if (!bb) return undefined;
  return { x: messageFlowLandning(mf, bb, n ? n.x + n.w / 2 : undefined), y: bb.y };
}

const SIDES: { side: EdgeSide; label: string; icon: string }[] = [
  { side: "top", label: "Topp", icon: "↑" },
  { side: "right", label: "Höger", icon: "→" },
  { side: "bottom", label: "Botten", icon: "↓" },
  { side: "left", label: "Vänster", icon: "←" },
];

/** Textstorlekar att växla mellan (faktor på normalstorleken). */
const TEXT_SIZES: { värde: number | undefined; label: string }[] = [
  { värde: undefined, label: "A" },
  { värde: 0.85, label: "A−" },
  { värde: 0.7, label: "A−−" },
];

const PLACEMENTS: { värde: TextPlacement | undefined; label: string; icon: string }[] = [
  { värde: "top", label: "Uppe", icon: "↑" },
  { värde: "left", label: "Vänster", icon: "←" },
  { värde: undefined, label: "Centrerat", icon: "◎" },
  { värde: "right", label: "Höger", icon: "→" },
  { värde: "bottom", label: "Nere", icon: "↓" },
];

/** Liten panel för textstorlek och textplacering på ett markerat objekt. */
function NodeInspector({
  node,
  store,
  onChange,
  onClose,
}: {
  node: ProcessModel["nodes"][number] | null;
  store: ProcessModel["dataStores"][number] | null;
  onChange: (patch: { textSize?: number; textPlacement?: TextPlacement }) => void;
  onClose: () => void;
}) {
  if (!node && !store) return null;
  const label = node?.label ?? store?.label ?? "";
  const size = node?.textSize ?? store?.textSize;
  const placement = node?.textPlacement;
  return (
    <div className="ark-edge-inspector">
      <div className="ark-edge-head">
        <strong>Text</strong>
        <button className="ark-x" onClick={onClose} title="Stäng">
          ✕
        </button>
      </div>
      <p className="ark-edge-name">{label}</p>
      <div className="ark-edge-row">
        <span className="ark-edge-rowlabel">Storlek</span>
        {TEXT_SIZES.map((t) => (
          <button
            key={t.label}
            className={`ark-iconbtn ${size === t.värde ? "on" : ""}`}
            title={t.värde ? `${Math.round(t.värde * 100)} %` : "Normal"}
            onClick={() => onChange({ textSize: t.värde })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Placeringen gäller flödesobjekt – cylinderns text är alltid centrerad. */}
      {node && (
        <div className="ark-edge-row">
          <span className="ark-edge-rowlabel">Placering</span>
          {PLACEMENTS.map((p) => (
            <button
              key={p.label}
              className={`ark-iconbtn ${placement === p.värde ? "on" : ""}`}
              title={p.label}
              onClick={() => onChange({ textPlacement: p.värde })}
            >
              {p.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Liten panel för att välja kopplingspunkter på en vald kant. */
function EdgeInspector({
  current,
  label,
  onPick,
  onReset,
  onRemove,
  editable,
  onClose,
}: {
  source: string;
  target: string;
  current?: { sourceSide?: EdgeSide; targetSide?: EdgeSide };
  label: string;
  onPick: (sides: EdgeSidesPatch) => void;
  onReset: () => void;
  onRemove: () => void;
  editable: boolean;
  onClose: () => void;
}) {
  const rad = (
    rubrik: string,
    vald: EdgeSide | undefined,
    key: "sourceSide" | "targetSide",
  ) => (
    <div className="ark-edge-row">
      <span className="ark-edge-rowlabel">{rubrik}</span>
      {SIDES.map((s) => (
        <button
          key={s.side}
          className={`ark-iconbtn ${vald === s.side ? "on" : ""}`}
          title={s.label}
          onClick={() => onPick({ [key]: s.side } as EdgeSidesPatch)}
        >
          {s.icon}
        </button>
      ))}
    </div>
  );

  return (
    <div className="ark-edge-inspector">
      <div className="ark-edge-head">
        <strong>Kopplingspunkter</strong>
        <button className="ark-x" onClick={onClose} title="Stäng">
          ✕
        </button>
      </div>
      <p className="ark-edge-name">{label}</p>
      {!editable && (
        <p className="ark-edge-warn">
          Den här pilen är en GENVÄG förbi objekt som är dolda i den vy du står i –
          den motsvarar inget enskilt kopplat par i modellen. Byt perspektiv för att
          se och ändra de verkliga kopplingarna.
        </p>
      )}
      {rad("Från", current?.sourceSide, "sourceSide")}
      {rad("Till", current?.targetSide, "targetSide")}
      <div className="ark-edge-foot">
        <button className="ark-linkbtn" onClick={onReset} disabled={!editable}>
          Återställ till automatisk
        </button>
        <button className="ark-btn ark-btn--tiny danger" onClick={onRemove} disabled={!editable}>
          Ta bort koppling
        </button>
      </div>
    </div>
  );
}
