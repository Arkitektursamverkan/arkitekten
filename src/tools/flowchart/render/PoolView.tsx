/**
 * BPMN-pool: en ram runt alla lanes med en tunn vänsteretikett (vertikal text)
 * som namnger deltagaren/processen. Bakgrundsnod – rör sig med pan/zoom.
 */

import { type NodeProps } from "@xyflow/react";
import { LANE_STROKE, LANE_TITLE } from "../theme";

export interface PoolNodeData extends Record<string, unknown> {
  width: number;
  height: number;
  labelW: number;
  title: string;
  fontSize: number;
}

export function PoolView({ data }: NodeProps) {
  const d = data as PoolNodeData;
  return (
    <div
      className="ark-pool"
      style={{ width: d.width, height: d.height, border: `1.5px solid ${LANE_STROKE}` }}
    >
      <div
        className="ark-pool-label"
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
    </div>
  );
}
