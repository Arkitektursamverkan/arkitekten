/**
 * Sidhänvisning: märket som ersätter en kant som korsar en sidbrytning.
 *
 * Geometrin kommer ur layoutmotorn (`LaidOutPageRef`), precis som för allt
 * annat – så editorn och SVG-exporten ritar samma märke på samma plats.
 * Stubben är en väg i märkets egna koordinater (`hänvisningsStubbe` i
 * layouten): rak när märket sitter vid sidan av eller ovanför noden, med ett
 * knä när det sitter snett nedanför – då går den rakt ner ur formens kontur
 * och vågrätt in i märket.
 */

import { type NodeProps } from "@xyflow/react";
import { EDGE_STROKE, PAGE_STROKE } from "../theme";

export interface PageRefData extends Record<string, unknown> {
  text: string;
  width: number;
  height: number;
  /** Stubbens väg i märkets egna koordinater (`hänvisningsStubbe`). */
  stubbe: { x: number; y: number }[];
  fontSize: number;
  /** Klick döljer märket. Bara pillret tar emot klick – inte stubben. */
  onHide?: () => void;
}

export function PageRefView({ data }: NodeProps) {
  const d = data as PageRefData;

  return (
    <div style={{ position: "relative", pointerEvents: "none" }}>
      <svg
        width={1}
        height={1}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
        aria-hidden="true"
      >
        <polyline
          points={d.stubbe.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={EDGE_STROKE}
          strokeWidth={1.6}
        />
      </svg>
      <div
        title={d.onHide ? "Klicka för att dölja den här hänvisningen" : undefined}
        onClick={d.onHide}
        style={{
          width: d.width,
          height: d.height,
          borderRadius: d.height / 2,
          border: `1.2px solid ${PAGE_STROKE}`,
          background: "#fff",
          color: "#8a7a53",
          fontSize: d.fontSize,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "nowrap",
          // Bara pillret är klickbart; stubben och omslaget lämnar musen ifred
          // så att de inte lägger sig över banornas dragghandtag.
          pointerEvents: d.onHide ? "auto" : "none",
          cursor: d.onHide ? "pointer" : "default",
        }}
      >
        {d.text}
      </div>
    </div>
  );
}
