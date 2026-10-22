/**
 * Svart-låda-pool: en DELTAGARE vars inre inte modelleras (t.ex. "Användare"
 * som tar emot ett mejl). BPMN ritar den som ett tomt band – bara ram och
 * deltagarnamn – just för att markera att vi inte påstår något om hur
 * mottagaren arbetar internt.
 *
 * Utgår från `PoolView` så att processens pool och mottagarpoolerna får
 * identisk visuell vikt.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { LANE_STROKE, LANE_TITLE } from "../theme";

export interface BlackBoxHandle {
  /** Handtagets id – ett per meddelandeflöde som landar här. */
  id: string;
  /** Avstånd i px från bandets vänsterkant, så pilen möter bandet rakt under avsändaren. */
  offset: number;
}

export interface BlackBoxNodeData extends Record<string, unknown> {
  width: number;
  height: number;
  labelW: number;
  title: string;
  fontSize: number;
  /**
   * Meddelandeflöden landar på en POOL, men React Flow kan bara koppla till
   * noder och handtag. Vi lägger därför ut ett eget handtag per meddelandeflöde
   * på bandets ovankant – annars skulle alla pilar tvingas mötas i en enda
   * punkt i mitten.
   */
  handles: BlackBoxHandle[];
}

export function BlackBoxView({ data, isConnectable }: NodeProps) {
  const d = data as BlackBoxNodeData;
  return (
    <div
      className="ark-blackbox"
      style={{ width: d.width, height: d.height, border: `1.5px solid ${LANE_STROKE}` }}
    >
      <div
        className="ark-blackbox-label"
        style={{
          width: d.labelW,
          background: "#e4e8ee",
          borderRight: `1px solid ${LANE_STROKE}`,
          color: LANE_TITLE,
          fontSize: d.fontSize,
        }}
      >
        <span>{d.title}</span>
      </div>
      {d.handles.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type="target"
          position={Position.Top}
          className="ark-handle ark-handle--hidden"
          // Se ProcessNodeView: utan den här propen är handtaget alltid
          // kopplingsbart, oavsett om ritytan är låst.
          isConnectable={isConnectable}
          style={{ left: h.offset }}
        />
      ))}
    </div>
  );
}
