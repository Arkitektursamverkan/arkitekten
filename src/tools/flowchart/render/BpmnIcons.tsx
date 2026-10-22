/**
 * Små BPMN task-typ-ikoner (User / Service / Send) som crisp inline-SVG.
 * Ritas uppe i vänstra hörnet av en task, i nodens strokefärg.
 */

import type { BpmnTaskIcon } from "@/core/model";

export function BpmnTaskGlyph({ icon, size, color }: { icon: BpmnTaskIcon; size: number; color: string }) {
  if (icon === "none") return null;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: color,
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (icon) {
    case "user":
      return (
        <svg {...common} aria-label="User Task">
          <circle cx="8" cy="5" r="2.6" />
          <path d="M3 13.5c0-2.6 2.2-4 5-4s5 1.4 5 4" />
        </svg>
      );
    case "service":
      return (
        <svg {...common} aria-label="Service Task">
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
        </svg>
      );
    case "send":
      return (
        <svg {...common} aria-label="Send Task">
          <rect x="2" y="4" width="12" height="8" rx="1" />
          <path d="M2.5 4.5 8 8.5l5.5-4" />
        </svg>
      );
    case "receive":
      // Receive Task: samma kuvert men med öppen flik – tar emot, skickar inte.
      return (
        <svg {...common} aria-label="Receive Task">
          <rect x="2" y="4" width="12" height="8" rx="1" />
          <path d="M2.5 11.5 8 7.5l5.5 4" />
        </svg>
      );
    default:
      return null;
  }
}
