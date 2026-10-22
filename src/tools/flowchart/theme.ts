/**
 * Visuellt tema – en ny, ren och konsekvent stil (inte en kopia av draw.io).
 * Delas av React-editorn och SVG-exporten så att skärm och export ser lika ut.
 */

import type { NodeType } from "@/core/model";

export interface NodeStyle {
  fill: string;
  stroke: string;
  text: string;
}

/**
 * Färgläge per diagram:
 *  - "type"  : typkodade färger som läshjälp (kräver teckenförklaring).
 *  - "bpmn"  : strikt/färglöst. Form + ikon bär typen; färg har ingen normativ
 *              betydelse i BPMN 2.0, så allt ritas neutralt.
 */
export type ColorMode = "type" | "bpmn";

/** Neutral stil för strikt BPMN – samma för alla typer. */
const NEUTRAL: NodeStyle = { fill: "#ffffff", stroke: "#374151", text: "#111827" };

/** Dämpad, professionell palett med tydlig typkodning. */
export const NODE_STYLES: Record<NodeType, NodeStyle> = {
  start: { fill: "#e7f5ee", stroke: "#2e9e6b", text: "#14532d" },
  end: { fill: "#fdecec", stroke: "#d8635f", text: "#7f1d1d" },
  activity: { fill: "#ffffff", stroke: "#5b6b8c", text: "#1f2937" },
  decision: { fill: "#fff6e5", stroke: "#d99a2b", text: "#7c4a03" },
  system: { fill: "#eef2ff", stroke: "#5b6bd6", text: "#312e81" },
  integration: { fill: "#eefbfb", stroke: "#2fa9a4", text: "#134e4a" },
  notification: { fill: "#f3ecff", stroke: "#8b5cf6", text: "#4c1d95" },
  datastore: { fill: "#f4f6f8", stroke: "#6b7280", text: "#111827" },
};

/** Swimlane-bandfärger, alternerande neutralt för läsbarhet. */
export const LANE_FILLS = ["#fafbfc", "#f2f4f7"];
export const LANE_HEADER_FILL = "#eaedf2";
export const LANE_STROKE = "#d7dce4";
export const LANE_TITLE = "#3b465c";

/** Sidram i flersidigt utlägg – dämpat papper-guld, skiljs från lane-linjerna. */
export const PAGE_STROKE = "#c3b79a";

export const EDGE_STROKE = "#7b8494";
export const EDGE_LABEL_BG = "#ffffff";
export const CANVAS_BG = "#ffffff";

/** Stil för en nodtyp i valt färgläge. */
export function nodeStyle(type: NodeType, mode: ColorMode = "type"): NodeStyle {
  return mode === "bpmn" ? NEUTRAL : NODE_STYLES[type];
}

/**
 * Nodtyperna i den ordning man normalt bygger ett flöde – EN PLATS.
 *
 * Objektpaletten radar upp formerna i den här ordningen och figurförteckningen
 * listar dem likadant, så den som lärt sig var beslutet ligger i paletten
 * hittar det på samma plats i faktarutan.
 */
export const TYPE_ORDNING: NodeType[] = [
  "start",
  "activity",
  "decision",
  "system",
  "integration",
  "notification",
  "datastore",
  "end",
];

/**
 * Vad en nodtyp BETYDER – en mening per symbol, EN PLATS.
 *
 * Läses av objektpaletten (verktygstipset) och av figurförteckningen
 * (faktarutan som säger vad bilden består av). Texten stod förut bara i
 * paletten, och en läsare som aldrig öppnar paletten fick alltså aldrig veta
 * vad en romb var. Två skrivningar av samma mening hade i sin tur glidit isär.
 */
export const TYPE_BETYDELSE: Record<NodeType, string> = {
  start: "Startpunkt – det som sätter igång processen.",
  activity: "Aktivitet – något en person utför.",
  decision: "Beslut – en fråga som delar flödet. Svaren skrivs på pilarna ut ur beslutet.",
  system: "System – Power Automate-flöden, portalen som system, plattformslogik.",
  integration: "Integration – API, Azure Function, koppling mot ett annat system.",
  notification: "Notifiering – mejl, Teams-meddelande, notis. Ligger i AVSÄNDARENS bana.",
  datastore: "Datalager – SharePoint-lista, loggpost. En artefakt utanför sekvensflödet.",
  end: "Slutpunkt – kvittensen eller det som avslutar processen.",
};

export const TYPE_LABEL: Record<NodeType, string> = {
  start: "Start",
  end: "Slut",
  activity: "Aktivitet",
  decision: "Beslut",
  system: "System",
  integration: "Integration",
  notification: "Notifiering",
  datastore: "Datalager",
};

/**
 * Krymper beslutstext så den ryms i romben. Romben är liten (112×78) och
 * texten svämmade ur den så fort frågan var längre än några ord. Faktorn delas
 * av canvasen och SVG-exporten så skärm och fil krymper lika mycket.
 */
export function decisionTextScale(label: string): number {
  const len = label.length;
  if (len <= 24) return 1;
  return Math.max(0.6, Math.sqrt(24 / len));
}
