/**
 * JSON Schema + mappning för AI-lagrets svar.
 *
 * Varför ett explicit schema: modellen ska INTE hitta på en egen struktur.
 * Genom structured outputs (`output_config.format`) tvingas svaret in i exakt
 * den form mellanlagret (ProcessDraft) behöver, så att kompileringen
 * draft → modell → diagram förblir deterministisk. AI:n tolkar text; den
 * ritar aldrig.
 *
 * VAL KRING VALFRIA FÄLT: strict/structured outputs kräver att *alla*
 * egenskaper listas i `required` och att `additionalProperties: false` är satt.
 * Därför löser vi "valfritt" genom att ta med fältet i `required` men tillåta
 * `null` som värde (["string","null"] respektive anyOf med {"type":"null"}).
 * Alternativet – att utelämna fälten ur `required` – accepteras inte lika
 * konsekvent av strict-läget, så nullable-varianten är den robusta.
 */

import {
  laneDefaultPerspectives,
  type DraftStep,
  type ProcessDraft,
} from "@/core/draft";
import type { GatewayKind, NodeType, Swimlane } from "@/core/model";
import { extraheraAp } from "../parser/affarsprocess-syntax";
import { lyftUtChecklistor } from "@/core/affarsprocess";

/** Alla nodtyper AI:n får välja mellan (speglar NodeType i model.ts). */
const NODE_TYPES: NodeType[] = [
  "start",
  "activity",
  "decision",
  "system",
  "integration",
  "notification",
  "datastore",
  "end",
];

/** Gateway-typer (speglar GatewayKind i model.ts). */
const GATEWAY_KINDS: GatewayKind[] = ["exclusive", "parallel"];

/** Hjälpare: ett fält som antingen är en sträng eller null. */
const nullableString = (description: string) => ({
  type: ["string", "null"],
  description,
});

/** Schemat som skickas till modellen via `output_config.format`. */
export const DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["aiText", "title", "subtitle", "lanes", "steps"],
  properties: {
    aiText: {
      type: "string",
      description:
        "Den städade, förbättrade beskrivningen i pilformat: titel på första raden, sedan 'steg → steg → steg', grenar i parentes.",
    },
    title: { type: "string", description: "Processens titel." },
    subtitle: nullableString("Kort undertext, eller null om den saknas."),
    lanes: {
      type: "array",
      description: "Swimlanes i den ordning de ska visas uppifrån och ned.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "string", description: "Stabilt id, samma som titeln." },
          title: { type: "string", description: "Visningsnamn på lanen." },
        },
      },
    },
    steps: {
      type: "array",
      description: "Stegen i flödesordning, ett steg per meningsbärande aktivitet.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "type",
          "text",
          "laneId",
          "gateway",
          "branchOfStepId",
          "branchLabel",
          "sourceText",
          "note",
          "recipient",
          "messageDirection",
        ],
        properties: {
          id: { type: "string", description: "Stabilt id: s1, s2, s3 …" },
          type: { type: "string", enum: NODE_TYPES, description: "Nodtyp." },
          text: { type: "string", description: "Etiketten som visas i noden." },
          laneId: { type: "string", description: "Id på lanen steget hör till." },
          gateway: {
            anyOf: [
              { type: "string", enum: GATEWAY_KINDS },
              { type: "null" },
            ],
            description: "Endast för decision: exclusive (XOR) eller parallel (AND). Annars null.",
          },
          branchOfStepId: nullableString(
            "Id på beslutssteget som steget ligger under, eller null för huvudflödet.",
          ),
          branchLabel: nullableString("Grenens etikett, t.ex. 'Ja' eller 'Nej'. Annars null."),
          sourceText: nullableString("Ursprunglig textfras ur underlaget, för spårbarhet."),
          note: nullableString(
            "Endast när steget är en tolkning eller ett tillägg – annars null.",
          ),
          recipient: nullableString(
            "Endast för notification: MOTTAGAREN av meddelandet (t.ex. Användare, Handläggare, Kommunikatörer, IT). Ger ett meddelandeflöde ut till den deltagaren. Annars null.",
          ),
          messageDirection: {
            anyOf: [{ type: "string", enum: ["send", "receive"] }, { type: "null" }],
            description:
              "Endast för notification: 'send' när steget SKICKAR meddelandet (vanligast), 'receive' när steget TAR EMOT det. Annars null.",
          },
        },
      },
    },
  },
};

/* ------------------------------------------------------------------ */
/* TS-typer som speglar schemat.                                       */
/* ------------------------------------------------------------------ */

export interface AiDraftLane {
  id: string;
  title: string;
}

export interface AiDraftStep {
  id: string;
  type: NodeType;
  text: string;
  laneId: string;
  gateway?: GatewayKind | null;
  branchOfStepId?: string | null;
  branchLabel?: string | null;
  sourceText?: string | null;
  note?: string | null;
  /** Endast notification: mottagande deltagare → meddelandeflöde ut ur poolen. */
  recipient?: string | null;
  /** Endast notification: skickar (send) eller tar emot (receive). */
  messageDirection?: "send" | "receive" | null;
}

export interface AiDraftResponse {
  aiText: string;
  title: string;
  subtitle?: string | null;
  lanes: AiDraftLane[];
  steps: AiDraftStep[];
}

/** Tomma strängar från modellen ska behandlas som "saknas". */
function orUndefined(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * Mappar AI:ns svar till mellanlagret.
 *
 * Ingen tolkning sker här – bara omformning. Det är avsiktligt: allt som är
 * "smart" ligger i prompten, allt som är strukturellt ligger i compileDraft.
 */
export function toDraft(res: AiDraftResponse, rawText: string): ProcessDraft {
  const lanes: Swimlane[] = res.lanes.map((l, i) => ({
    id: l.id,
    title: l.title || l.id,
    order: i,
    perspectives: laneDefaultPerspectives(l.id),
  }));

  const steps: DraftStep[] = res.steps.map((s, i) => {
    const branchStepId = orUndefined(s.branchOfStepId);
    const branchLabel = orUndefined(s.branchLabel);
    const källfras = orUndefined(s.sourceText);
    // Satellitannoteringar ([Roll: …], [IT: …] osv) i stegtexten lyfts ut till
    // ap-blocket – SAMMA syntax och SAMMA kod som regelparsern använder, så
    // AI-tolkade och regeltolkade flöden beter sig identiskt.
    const { ren, ap } = extraheraAp(s.text);
    return {
      id: s.id,
      type: s.type,
      text: ren,
      ap,
      laneId: s.laneId,
      // Gateway är bara meningsfull för beslut; compileDraft defaultar till exclusive.
      gateway: s.type === "decision" ? (s.gateway ?? undefined) : undefined,
      branchOf:
        branchStepId && branchLabel ? { stepId: branchStepId, label: branchLabel } : undefined,
      // Ett steg UTAN källfras är ett TILLÄGG (underförstått men nödvändigt,
      // förklarat i `note`). Tillägg bär sourceIndex −1, precis som manuellt
      // tillagda steg – annars räknar spårbarheten dem som textfragment som
      // aldrig kan bevisas mot texten, och valideringen slår falskt larm.
      sourceIndex: källfras ? i : -1,
      sourceText: källfras,
      note: orUndefined(s.note),
      recipient: s.type === "notification" ? orUndefined(s.recipient) : undefined,
      messageDirection: s.type === "notification" ? (s.messageDirection ?? undefined) : undefined,
    };
  });

  // En checklista i ett krav ("[Krav: Rutin X – ☐ a ☐ b]") blir kravets
  // rutin – samma lyft som regelparsern gör.
  return lyftUtChecklistor({
    title: res.title,
    subtitle: orUndefined(res.subtitle),
    lanes,
    steps,
    meta: {
      sourceText: rawText,
      aiText: res.aiText,
      origin: "ai",
      // Bara steg som faktiskt kommer ur texten är spårbarhetsfragment.
      sourceFragments: res.steps
        .map((s) => orUndefined(s.sourceText))
        .filter((t): t is string => Boolean(t)),
      warnings: [],
    },
  });
}
