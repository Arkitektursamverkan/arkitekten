/**
 * Anthropic-klienten – körs på SERVERN, aldrig i webbläsaren.
 *
 * Nyckeln ligger i serverns miljö (`ANTHROPIC_API_KEY`). Bryggan
 * (server/brygga.ts) svarar då själv på brevlådans begäranden med hjälp
 * av `besvara.ts`, och knapparna i appen märker ingen skillnad: de lägger sin
 * begäran och pollar som förut. Nyckeln når alltså aldrig webbläsaren – förut
 * låg den i klartext i localStorage.
 *
 * `generateAiDraft` finns kvar för kommandoradsverktyget scripts/ai-draft.mjs.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { ProcessDraft } from "@/core/draft";

import { besvaraTolkning, type Fråga } from "./besvara";
import type { PromptDiagramType } from "./prompt";
import { toDraft } from "./schema";

/** Standardmodell. Kan bytas utan kodändring med `ARK_AI_MODELL` i tjänstens miljö. */
export const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Vägrar modellen (säkerhetsklassningen kan slå fel på en harmlös text) körs
 * samma anrop om på reservmodellen, inuti samma anrop.
 */
const RESERVMODELL = "claude-opus-4-8";

/**
 * En `Fråga` mot Anthropic. Strömmande, så att en lång presentation inte slår
 * i HTTP-tidsgränsen; `finalMessage` samlar ihop svaret.
 */
export function anthropicFråga(opts: { apiKey: string; model?: string; workspaceId?: string }): Fråga {
  if (!opts.apiKey.trim()) throw new Error("API-nyckel saknas.");
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // En nyckel som inte är knuten till en arbetsyta måste säga vilken den
    // gäller, annars svarar API:t 400 (`ANTHROPIC_WORKSPACE_ID` i tjänstens miljö).
    ...(opts.workspaceId?.trim() ? { defaultHeaders: { "anthropic-workspace-id": opts.workspaceId.trim() } } : {}),
  });
  const model = opts.model?.trim() || DEFAULT_MODEL;

  return async ({ system, meddelanden, schema, signal }) => {
    let svar: Anthropic.Beta.BetaMessage;
    try {
      svar = await client.beta.messages
        .stream(
          {
            model,
            max_tokens: 64000,
            betas: ["server-side-fallback-2026-06-01"],
            fallbacks: [{ model: RESERVMODELL }],
            thinking: { type: "adaptive" },
            // Opus 5.5 står på "medium" som förval – tolkningarna är kvalitetsarbete.
            output_config: {
              effort: "high",
              ...(schema ? { format: { type: "json_schema" as const, schema } } : {}),
            },
            system,
            messages: meddelanden,
          },
          signal ? { signal } : undefined,
        )
        .finalMessage();
    } catch (err) {
      throw new Error(describeError(err));
    }

    if (svar.stop_reason === "refusal") {
      throw new Error("AI:n avböjde att svara på underlaget.");
    }
    if (svar.stop_reason === "max_tokens") {
      throw new Error("AI:ns svar blev för långt och klipptes av. Försök med ett kortare underlag.");
    }
    const text = svar.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { text, innehåll: svar.content as Anthropic.Beta.BetaContentBlockParam[] };
  };
}

export interface GenerateAiDraftOptions {
  apiKey: string;
  rawText: string;
  model?: string;
  signal?: AbortSignal;
  /** Vilket verktyg tolkningen gäller – affärsprocessen har en egen metod. */
  diagramType?: PromptDiagramType;
}

/** Tolkar en rå processbeskrivning till en ProcessDraft (kommandoradsvägen). */
export async function generateAiDraft(opts: GenerateAiDraftOptions): Promise<ProcessDraft> {
  const svar = await besvaraTolkning(
    { rawText: opts.rawText, diagramType: opts.diagramType ?? "flowchart" },
    anthropicFråga({ apiKey: opts.apiKey, model: opts.model, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID }),
    opts.signal,
  );
  return toDraft(svar, opts.rawText);
}

/**
 * Översätter SDK:ns typade felklasser till svenska meddelanden.
 * Vi sträng-matchar aldrig felmeddelanden – bara instanceof på feltyperna.
 */
function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIUserAbortError) {
    return "Avbruten.";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "Ogiltig API-nyckel – kontrollera ANTHROPIC_API_KEY i serverns miljö.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "API-nyckeln saknar behörighet till den valda modellen.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "Modellen hittades inte – kontrollera modellnamnet.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "För många anrop – försök igen om en stund.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Kunde inte nå Anthropic. Kontrollera nätverksanslutningen.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Fel från Anthropic (${err.status ?? "okänd status"}): ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return "Okänt fel vid anrop till AI:n.";
}
