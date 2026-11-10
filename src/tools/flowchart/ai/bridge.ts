/**
 * Klientsidan av ark-bryggan (se server/brygga.ts).
 *
 * Lägger en begäran i brevlådan och väntar tills svaret dyker upp. Vem som
 * svarar avgörs på SERVERN: har dev-servern en API-nyckel gör den anropet
 * själv (besvara.ts), annars svarar Claude Code i utvecklarsessionen. Appen
 * har ingen nyckel och behöver ingen – resultatet landar i samma mellanlager
 * vilken väg det än kom.
 */

import { textToDraft } from "../parser/toDraft";
import { bridgeInstruction, type PromptDiagramType } from "./prompt";
import { toDraft, type AiDraftResponse } from "./schema";
import type { ProcessDraft } from "@/core/draft";
import { AVBÖJT, godkännKostnad } from "./kostnad";

const POLL_MS = 1500;
/** Hur länge appen väntar innan den ger upp (tolkning tar normalt < 1 min). */
const TIMEOUT_MS = 15 * 60 * 1000;

export interface BridgeOptions {
  rawText: string;
  /** Extra önskemål till Claude Code, t.ex. "slå ihop stegen i portalen". */
  instruction?: string;
  /**
   * Vilket verktyg som frågar. Bryggan har ingen systemprompt – `.ark/request.json`
   * är allt Claude Code ser – så husreglerna för diagramtypen skickas med som
   * instruktion. Utan det tolkades affärsprocessbegäranden som flödesscheman.
   */
  diagramType?: PromptDiagramType;
  signal?: AbortSignal;
}

/**
 * Är bryggan tillgänglig? Statuskoden räcker inte som svar: en dev-server
 * UTAN plugin:et faller tillbaka på SPA-routingen och svarar 200 med
 * index.html på vilken okänd sökväg som helst. Bryggan känns därför igen på
 * att den svarar 204 (tom brevlåda) eller 200 med JSON.
 */
function isBridgeResponse(res: Response): boolean {
  if (res.status === 204) return true;
  return res.ok && (res.headers.get("content-type") ?? "").includes("application/json");
}

/**
 * Vem som besvarar brevlådan: servern med API:t, Claude Code i terminalen
 * (utvecklarläget), eller ingen – AI-stödet är inte påslaget och knapparna
 * visas inte.
 */
export type AiVäg = "api" | "claude-code" | "av";

/** Om kostnadsrutan får erbjuda Claude Code – bara i serverns utvecklarläge. */
let claudeCodeTillåten = false;
export const claudeCodeErbjuds = () => claudeCodeTillåten;

export async function aiVäg(): Promise<AiVäg | null> {
  try {
    const res = await fetch("/__ark/status", { method: "GET" });
    if (!isBridgeResponse(res)) return null;
    const svar = (await res.json()) as { besvaras?: unknown; claudeCode?: unknown };
    claudeCodeTillåten = svar.claudeCode === true;
    return svar.besvaras === "api" || svar.besvaras === "av" ? svar.besvaras : "claude-code";
  } catch {
    return null;
  }
}

/**
 * Vägen för begäran som väntar JUST NU – den kan skilja sig från serverns
 * förval när användaren valt Claude Code i kostnadsrutan. Knapparnas texter
 * följer den (`useAiVäg`), så att det inte står "AI:n arbetar" medan
 * begäran ligger och väntar på Claude Code.
 */
export const AKTIV_VÄG_ÄNDRAD = "ark-ai-vag-andrad";
let aktivVäg: AiVäg | null = null;
export function aktivAiVäg(): AiVäg | null {
  return aktivVäg;
}
function sättAktivVäg(v: AiVäg | null) {
  aktivVäg = v;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AKTIV_VÄG_ÄNDRAD));
}

export async function bridgeAvailable(): Promise<boolean> {
  try {
    return isBridgeResponse(await fetch("/__ark/response", { method: "GET" }));
  } catch {
    return false;
  }
}

const NO_BRIDGE =
  "Servern svarar inte på /__ark. Kör appen med 'npm start' (eller 'npm run dev' under utveckling).";

/**
 * Diagramtypens husregler först, användarens egna önskemål sist – önskemålet
 * är det som ska väga tyngst när de krockar.
 */
function instruktion(opts: BridgeOptions): string {
  return [bridgeInstruction(opts.diagramType), opts.instruction ?? ""]
    .filter((d) => d.trim())
    .join("\n\n");
}

/**
 * Brevlådan: lägger en begäran och pollar tills svaret finns. EN slinga för
 * alla uppdrag – tolkningen, utvärderingen och presentationen skiljer sig bara
 * i vad de skickar och vad de gör med svaret.
 */
async function skickaOchVänta(
  begäran: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  // Svarar servern med API-nyckeln kostar anropet pengar – fråga först. Rutan
  // kan också skicka begäran till Claude Code i stället (`via`).
  let via: AiVäg = "claude-code";
  if ((await aiVäg()) === "api") {
    const val = await godkännKostnad(begäran.uppdrag as string | undefined);
    if (!val) throw new Error(AVBÖJT);
    via = val;
  }
  sättAktivVäg(via);
  try {
    return await postaOchPolla({ ...begäran, via }, signal, timeoutMs);
  } finally {
    sättAktivVäg(null);
  }
}

async function postaOchPolla(
  begäran: Record<string, unknown>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const post = await fetch("/__ark/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(begäran),
  });
  if (!post.ok || !(post.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error(NO_BRIDGE);
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) {
      await fetch("/__ark/cancel", { method: "POST", headers: { "content-type": "application/json" } }).catch(() => {});
      throw new Error("Avbruten.");
    }

    const res = await fetch("/__ark/response", { method: "GET" });
    if (!isBridgeResponse(res)) throw new Error(NO_BRIDGE);
    if (res.status === 200) {
      const svar = ((await res.json()) as { response: unknown }).response;
      // Servern svarar med `{ fel }` när API-anropet gick fel.
      const fel = (svar as { fel?: unknown } | null)?.fel;
      if (typeof fel === "string" && fel) throw new Error(fel);
      return svar;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  throw new Error(`Inget svar från AI:n inom ${Math.round(timeoutMs / 60000)} minuter.`);
}

/**
 * Skickar beskrivningen till Claude Code och pollar tills svaret finns.
 * Svaret får vara antingen en full strukturerad tolkning eller bara en
 * städad beskrivning i pilformat – i det senare fallet tolkas den med
 * regelmotorn, så att bryggan är enkel att svara på.
 */
export async function requestClaudeCodeDraft(opts: BridgeOptions): Promise<ProcessDraft> {
  const svar = await skickaOchVänta(
    {
      rawText: opts.rawText,
      instruction: instruktion(opts),
      // Önskemålet för sig: serverns API-väg har egen systemprompt.
      ...(opts.instruction?.trim() ? { önskemål: opts.instruction } : {}),
      diagramType: opts.diagramType ?? "flowchart",
    },
    opts.signal,
  );
  return svarTillDraft(svar as AiDraftResponse | { aiText: string }, opts.rawText);
}

/**
 * Samma brygga, men svaret lämnas orört.
 *
 * Tolkningen vill ha ett mellanlager; utvärderingen vill ha modellens text.
 * Att tvinga båda genom samma normalisering vore fel – därför den här.
 */
export async function requestClaudeCodeRaw(opts: {
  payload: string;
  instruction: string;
  signal?: AbortSignal;
}): Promise<string> {
  const svar = (await skickaOchVänta(
    { uppdrag: "utvärdering", rawText: opts.payload, instruction: opts.instruction },
    opts.signal,
  )) as { aiText?: string } | string;
  if (typeof svar === "string") return svar;
  return svar.aiText ?? JSON.stringify(svar);
}

/**
 * Ett namngivet UPPDRAG – något annat än en tolkning. Begäran märks med
 * `uppdrag` så att den som svarar ser vad som väntas tillbaka, och svaret
 * lämnas som det kom: uppdragets egen modul vet vilken form det ska ha.
 *
 * `källa` säger vilken process uppdraget gäller. Väntetiden är uppdragets:
 * en presentation tar längre tid att göra än en tolkning.
 */
export async function requestClaudeCodeUppdrag(opts: {
  uppdrag: string;
  payload: string;
  instruction: string;
  källa?: { flödeId: string; namn: string };
  /** Diagramtypen SVARET ska ha – inte nödvändigtvis den som frågar. */
  diagramType?: PromptDiagramType;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<unknown> {
  return skickaOchVänta(
    {
      uppdrag: opts.uppdrag,
      rawText: opts.payload,
      instruction: opts.instruction,
      diagramType: opts.diagramType ?? "flowchart",
      källa: opts.källa,
    },
    opts.signal,
    opts.timeoutMs,
  );
}

/** Tar emot båda svarsformaten och returnerar alltid ett komplett mellanlager. */
export function svarTillDraft(
  res: AiDraftResponse | { aiText: string },
  rawText: string,
): ProcessDraft {
  if ("steps" in res && Array.isArray(res.steps) && res.steps.length > 0) {
    return toDraft(res, rawText);
  }
  // Bara text: låt regelmotorn strukturera den städade beskrivningen.
  const draft = textToDraft(res.aiText);
  draft.meta.sourceText = rawText;
  draft.meta.aiText = res.aiText;
  draft.meta.origin = "ai";
  return draft;
}
