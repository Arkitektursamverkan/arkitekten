/**
 * Pappersram som bakgrundsnod – en per sida. Visar exakt var sidans kant går
 * och vilket sidnummer det är, så ett flersidigt utlägg läses som ett dokument
 * i stället för som ett enda högt diagram med upprepade banrubriker.
 *
 * Ligger bakom lanes och noder, rör sig med pan/zoom, går inte att markera.
 */

import { type NodeProps } from "@xyflow/react";
import { PAGE_STROKE } from "../theme";

export interface PageFrameData extends Record<string, unknown> {
  width: number;
  height: number;
  /** Färdig etikett, t.ex. "Del 2 av 5". Tom när utlägget bara har en del. */
  label: string;
}

export function PageFrameView({ data }: NodeProps) {
  const d = data as PageFrameData;
  return (
    <div style={{ position: "relative", pointerEvents: "none" }}>
      <div
        style={{
          width: d.width,
          height: d.height,
          border: `1px solid ${PAGE_STROKE}`,
          background: "#ffffff",
          boxShadow: "0 1px 6px rgba(60,50,20,0.06)",
        }}
      />
      {/* Etiketten ritas bara när det finns något att räkna – en ensam figur
          behöver ingen "Del 1 av 1". */}
      {d.label && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: d.height + 4,
            fontSize: 11,
            color: PAGE_STROKE,
            whiteSpace: "nowrap",
          }}
        >
          {d.label}
        </div>
      )}
    </div>
  );
}
