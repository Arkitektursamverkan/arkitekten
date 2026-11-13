/**
 * Berget AI-klienten – körs på SERVERN, aldrig i webbläsaren.
 *
 * Berget AI (berget.ai) kör öppna modeller i Sverige bakom ett API i
 * OpenAI-formatet (`POST /v1/chat/completions`). Här blir det en `Fråga`, så
 * att `besvara.ts` inte märker vilken leverantör som svarar: samtalet kommer
 * in i Anthropics form (som resten av koden bygger det) och översätts här.
 *
 * Nyckeln ligger i serverns miljö (`BERGET_API_KEY`) och väljs i
 * server/brygga.ts (`aiLeverantör`). Inget SDK – bara `fetch`, så att
 * leverantören inte drar in ett beroende till.
 *
 * Skillnader mot Anthropic-vägen:
 *  - PDF kan inte bifogas. Word, ODF och text går (de blir text ändå), bilder
 *    går med en modell som ser bilder.
 *  - Ingen reservmodell: avböjer eller saknas modellen blir det ett fel.
 */

import type { Fråga, Meddelande } from "./besvara";

/** Standardmodell hos Berget AI. Byts utan kodändring med `ARK_AI_MODELL`. */
export const BERGET_MODELL = "moonshotai/Kimi-K3.1-Pro";

/** Bergets API. Kan pekas om med `BERGET_API_URL` (t.ex. en egen instans). */
export const BERGET_API_URL = "https://api.berget.ai/v1";

type Del = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
interface ChatMeddelande {
  role: "system" | "user" | "assistant";
  content: string | Del[];
}

/** Ett innehållsblock i Anthropics form → en del i OpenAI-formatet. */
function delUr(block: unknown): Del | null {
  const b = block as {
    type?: string;
    text?: string;
    title?: string;
    source?: { type?: string; media_type?: string; data?: string };
  };
  if (b.type === "text") return { type: "text", text: b.text ?? "" };
  if (b.type === "image" && b.source?.type === "base64") {
    return { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
  }
  if (b.type === "document" && b.source?.type === "text") {
    return { type: "text", text: `${b.title ? `Dokumentet "${b.title}":\n` : ""}${b.source.data ?? ""}` };
  }
  if (b.type === "document") {
    throw new Error(
      "PDF kan inte läsas med Berget AI – spara underlaget som Word (.docx) eller text och försök igen.",
    );
  }
  // Tankeblock och annat som bara Anthropic förstår följer inte med.
  return null;
}

/** Samtalet i Anthropics form → `messages` i OpenAI-formatet. */
export function tillChat(system: string, meddelanden: Meddelande[]): ChatMeddelande[] {
  const ut: ChatMeddelande[] = [{ role: "system", content: system }];
  for (const m of meddelanden) {
    if (typeof m.content === "string") {
      ut.push({ role: m.role, content: m.content });
      continue;
    }
    const delar = (m.content ?? []).map(delUr).filter((d): d is Del => d !== null);
    // Bara text: skicka den som en sträng – det förstår alla modeller.
    const baraText = delar.every((d) => d.type === "text");
    ut.push({
      role: m.role,
      content: baraText ? delar.map((d) => (d as { text: string }).text).join("\n\n") : delar,
    });
  }
  return ut;
}

/** Resonerande modeller kan lägga sitt tänkande först i svaret – det hör inte dit. */
function utanTankar(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
}

function felFrån(status: number, meddelande: string): string {
  if (status === 401) return "Ogiltig API-nyckel – kontrollera BERGET_API_KEY i serverns miljö.";
  if (status === 403) return "API-nyckeln saknar behörighet till den valda modellen.";
  if (status === 404) return "Modellen hittades inte – kontrollera modellnamnet (ARK_AI_MODELL).";
  if (status === 429) return "För många anrop – försök igen om en stund.";
  return `Fel från Berget AI (${status}): ${meddelande || "okänt fel"}`;
}

/** Felmeddelandet ur ett felsvar – `{ error: { message } }` eller `{ error: "…" }`. */
function felText(kropp: string): string {
  try {
    const j = JSON.parse(kropp) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
    if (typeof m === "string") return m;
  } catch {
    /* inte JSON */
  }
  return kropp.slice(0, 300);
}

/**
 * En `Fråga` mot Berget AI. Strömmande, så att ett långt svar inte slår i
 * HTTP-tidsgränsen; bitarna samlas ihop till en text.
 */
export function bergetFråga(opts: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Byts i testerna. */
  fetch?: typeof fetch;
}): Fråga {
  if (!opts.apiKey.trim()) throw new Error("API-nyckel saknas.");
  const hämta = opts.fetch ?? fetch;
  const model = opts.model?.trim() || BERGET_MODELL;
  const adress = `${(opts.baseUrl?.trim() || BERGET_API_URL).replace(/\/+$/, "")}/chat/completions`;

  return async ({ system, meddelanden, schema, signal }) => {
    const kropp = {
      model,
      stream: true,
      messages: tillChat(system, meddelanden),
      ...(schema
        ? { response_format: { type: "json_schema", json_schema: { name: "svar", strict: true, schema } } }
        : {}),
    };

    let svar: Response;
    try {
      svar = await hämta(adress, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey.trim()}` },
        body: JSON.stringify(kropp),
        signal,
      });
    } catch {
      throw new Error(signal?.aborted ? "Avbruten." : "Kunde inte nå Berget AI. Kontrollera nätverksanslutningen.");
    }
    if (!svar.ok) throw new Error(felFrån(svar.status, felText(await svar.text().catch(() => ""))));
    if (!svar.body) throw new Error("Berget AI svarade utan innehåll.");

    let text = "";
    let slut: string | null = null;
    const ta = (rad: string) => {
      if (!rad.startsWith("data:")) return;
      const data = rad.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let bit: {
        error?: { message?: string } | string;
        choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
      };
      try {
        bit = JSON.parse(data);
      } catch {
        return;
      }
      if (bit.error) {
        const m = typeof bit.error === "string" ? bit.error : bit.error.message;
        throw new Error(`Fel från Berget AI: ${m || "okänt fel"}`);
      }
      const val = bit.choices?.[0];
      if (typeof val?.delta?.content === "string") text += val.delta.content;
      if (val?.finish_reason) slut = val.finish_reason;
    };

    const läsare = svar.body.getReader();
    const avkoda = new TextDecoder();
    let rest = "";
    try {
      for (;;) {
        const { done, value } = await läsare.read();
        if (done) break;
        rest += avkoda.decode(value, { stream: true });
        const rader = rest.split("\n");
        rest = rader.pop() ?? "";
        for (const rad of rader) ta(rad.trimEnd());
      }
      ta(rest.trimEnd());
    } catch (err) {
      if (signal?.aborted) throw new Error("Avbruten.");
      throw err instanceof Error ? err : new Error("Anslutningen till Berget AI bröts.");
    }

    if (slut === "length") {
      throw new Error("AI:ns svar blev för långt och klipptes av. Försök med ett kortare underlag.");
    }
    if (slut === "content_filter") throw new Error("AI:n avböjde att svara på underlaget.");
    text = utanTankar(text);
    return { text, innehåll: [{ type: "text", text }] };
  };
}
