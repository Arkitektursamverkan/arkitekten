/**
 * Swimlane-band som bakgrundsnod i React Flow. Rubriken ligger som en topprad
 * så att hela bredden kan användas till flödet. Rör sig med pan/zoom men går
 * inte att markera eller koppla.
 *
 * Banan växer normalt automatiskt när den innehåller Ja/Nej-grenar (laneRow i
 * layouten). Nederkanten är dessutom ett dragghandtag för att sätta en egen
 * höjd manuellt; dubbelklick återställer till automatiken.
 */

import { useRef } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { MAX_LANE_HEIGHT } from "../layout/layout";
import { LANE_FILLS, LANE_HEADER_FILL, LANE_STROKE, LANE_TITLE } from "../theme";

/**
 * Övre gräns för en manuellt dragen banhöjd. SAMMA konstant som layouten
 * klampar mot – två olika tal här gav en bana som gick att dra högre än
 * motorn ritar (eller tvärtom). En bana högre än så är alltid ett misstag,
 * och höjden styr hur många rader layouten placerar ut – ett skenande värde
 * blir därför inte bara fult utan hänger sidan.
 */
const MAX_LANE_H = MAX_LANE_HEIGHT;

export interface LaneNodeData extends Record<string, unknown> {
  title: string;
  index: number;
  width: number;
  height: number;
  headerH: number;
  fontSize: number;
  laneId: string;
  minHeight: number;
  /** Rapporterar en utdragen höjd (px), eller null för att återgå till auto. */
  onResize?: (laneId: string, height: number | null, page?: number) => void;
  /** Delindex i flersidigt läge – höjden gäller då bara den delen. */
  page?: number;
  /** React Flow-id för just det här bandet – vyn ramar in det efter ett drag. */
  nodeId: string;
  /** Anropas när dragningen släpps – vyn ska hitta tillbaka till bandet. */
  onResizeEnd?: (nodeId: string) => void;
}

export function LaneNodeView({ data }: NodeProps) {
  const d = data as LaneNodeData;
  const { screenToFlowPosition } = useReactFlow();
  const startY = useRef(0);
  /**
   * Banans höjd när dragningen BÖRJADE.
   *
   * Utan den mättes deltat mot den AKTUELLA höjden, som redan hade uppdaterats
   * av föregående pointermove – varje händelse lade alltså på deltat en gång
   * till. En dragning på 600 px gav en bana på 90 000 px och över tusen rader
   * att placera om vid varje musrörelse, vilket hängde sidan.
   */
  const startH = useRef(0);
  /**
   * Sant bara mellan handtagets EGET pointerdown och pointerup.
   *
   * Utan flaggan räckte det att muspekaren SVEPTE över handtaget med knappen
   * nere – t.ex. när man drar en ny koppling nedåt – för att onPointerMove skulle
   * agera. Den läste då startvärden från en tidigare dragning och satte en
   * skenande höjd; alla banor pekaren passerade expanderade jättemycket.
   */
  const drar = useRef(false);

  const dra = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drar.current = true;
    startY.current = screenToFlowPosition({ x: 0, y: e.clientY }).y;
    startH.current = d.height;
  };
  const flytta = (e: React.PointerEvent) => {
    if (!drar.current) return; // bara vår egen dragning, inte en pekare som sveper förbi
    if (!(e.buttons & 1)) return; // bara medan vänsterknappen hålls
    const y = screenToFlowPosition({ x: 0, y: e.clientY }).y;
    // screenToFlowPosition kan ge NaN innan vyn är helt initierad. Ett NaN här
    // fortplantade sig till radantalet och fick `new Array(NaN)` att kasta.
    if (!Number.isFinite(y) || !Number.isFinite(startY.current)) return;
    const höjd = Math.min(MAX_LANE_H, Math.max(d.minHeight, startH.current + (y - startY.current)));
    d.onResize?.(d.laneId, höjd, d.page);
  };
  const släpp = () => {
    drar.current = false;
    d.onResizeEnd?.(d.nodeId);
  };
  const dubbelklick = () => {
    d.onResize?.(d.laneId, null, d.page); // tillbaka till auto
    d.onResizeEnd?.(d.nodeId);
  };

  return (
    <div
      className="ark-lane"
      style={{
        width: d.width,
        height: d.height,
        background: LANE_FILLS[d.index % LANE_FILLS.length],
        border: `1px solid ${LANE_STROKE}`,
      }}
    >
      <div
        className="ark-lane-header"
        style={{
          height: d.headerH,
          background: LANE_HEADER_FILL,
          borderBottom: `1px solid ${LANE_STROKE}`,
          color: LANE_TITLE,
          fontSize: d.fontSize,
        }}
      >
        <span>{d.title}</span>
      </div>

      {/*
        Dragghandtag längst ned. Bara handtaget har pointer-events; resten av
        banan förblir passiv så att man kan dra objekt ovanpå den.
      */}
      {d.onResize && (
        <div
          className="ark-lane-resize"
          title="Dra för att ändra höjd · dubbelklick återställer"
          onPointerDown={dra}
          onPointerMove={flytta}
          onPointerUp={släpp}
          onPointerCancel={släpp}
          onDoubleClick={dubbelklick}
        />
      )}
    </div>
  );
}
