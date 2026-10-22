/**
 * Uppdraget "rutin": en uppladdad fil blir rutinen bakom ett krav.
 *
 * Samma brevlåda som "Tolka med AI" (ark-bryggan), men underlaget är en FIL
 * och inte en text. Filen laddas upp som den är (`/__ark/underlag`) och
 * begäran pekar ut den med sin sökväg – den som svarar läser den med sina egna
 * verktyg, så appen behöver ingen tolk per filformat (Word, PDF, skärmbild).
 *
 * Svaret är rutinens TEXT, i exakt den form man själv skriver den: en rad per
 * moment, indragen rad = underpunkt. AI:n fyller alltså samma lagring som
 * byggaren och inklistringen – den ritar ingenting. Texten hamnar i utkastet,
 * och blir en rutin först när användaren sparar.
 */

import { requestClaudeCodeUppdrag } from "@/tools/flowchart/ai/bridge";
import { skrivRutin, tolkaRutin, type RutinMoment } from "@/core/rutin";

/** En rutin kan vara ett långt dokument – ge den som svarar gott om tid. */
const TIMEOUT_MS = 60 * 60 * 1000;

export const RUTIN_INSTRUKTION = `Uppdraget är "rutin": gör om det uppladdade underlaget till en RUTIN – arbetsbeskrivningen bakom ett krav i affärsprocessverktyget.

\`rawText\` är JSON: \`fil\` är sökvägen till underlaget (relativt projektroten), \`krav\` är kravet rutinen hör till och \`aktivitet\` aktiviteten kravet hänger på. LÄS FILEN – den kan vara Word, PDF, text eller en skärmbild.

Svara med { "requestId": "<id ur begäran>", "rutin": "<texten>" }.

Texten är rader, en rad per MOMENT i den ordning de utförs:
- En INDRAGEN rad (två blanksteg) är en underpunkt till momentet före: ett delmoment, ett alternativ eller en förklaring.
- En klickväg skrivs på EN rad med " → " mellan klicken: "Gå till Lösningar → eDiscovery → Ärenden". Den ritas som en kedja av brickor.
- Korta alternativ att välja mellan (Nyckelord, Datum …) skrivs som var sin underpunkt; de ritas som val.
- En underpunkt som förklarar i stället för att be en göra något börjar med "Om", "Obs" eller "Tips" – den ritas som en upplysning.
- Börja momentet med VERBET: Gå till, Klicka, Välj, Markera, Ange, Skriv, Skapa, Öppna, Logga in, Ladda ner, Exportera. Verbet väljer symbolen framför momentet.
- Ingen numrering och inga punkttecken – vyn numrerar själv. Bara två nivåer: moment och underpunkt.
- Ett moment är EN handling. Dela en mening som rymmer flera, men slå inte sönder en klickväg.
- Hitta ALDRIG på moment som saknar täckning i underlaget, och behåll knapparnas och menyernas namn exakt som de står. Rätta uppenbara stavfel. Svenska.`;

export interface RutinBegäran {
  /** Kravets namn – rutinens rubrik. */
  krav: string;
  /** Aktiviteten kravet hänger på. */
  aktivitet?: string;
  /** Processen, när den är sparad. */
  källa?: { flödeId: string; namn: string };
}

/**
 * Plockar rutinens text ur svaret. Texten är formen vi ber om, men en lista av
 * moment tas också emot – det är samma innehåll, och ett svar ska inte falla
 * på formen. Resultatet går alltid genom `tolkaRutin`/`skrivRutin`, så att det
 * som landar i utkastet är städat på samma sätt som det man skriver själv.
 */
export function rutinUrSvar(svar: unknown): string {
  const rutin = (svar as { rutin?: unknown } | null)?.rutin;
  let moment: RutinMoment[] = [];
  if (typeof rutin === "string") moment = tolkaRutin(rutin);
  else if (Array.isArray(rutin))
    moment = rutin
      .map((m) =>
        typeof m === "string"
          ? { text: m, under: [] }
          : {
              text: String((m as { text?: unknown })?.text ?? ""),
              under: Array.isArray((m as { under?: unknown })?.under)
                ? ((m as { under: unknown[] }).under.map(String) as string[])
                : [],
            },
      )
      .filter((m) => m.text.trim());
  const text = skrivRutin(moment);
  if (!text) throw new Error("Svaret innehöll ingen rutin.");
  return text;
}

/** Laddar upp filen, lägger begäran i brevlådan och väntar på rutinens text. */
export async function begärRutin(
  fil: File,
  begäran: RutinBegäran,
  signal?: AbortSignal,
): Promise<string> {
  const upp = await fetch(`/__ark/underlag?namn=${encodeURIComponent(fil.name)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: fil,
  });
  const kvitto = (upp.headers.get("content-type") ?? "").includes("application/json")
    ? ((await upp.json()) as { ok?: boolean; sökväg?: string; error?: string })
    : null;
  if (!upp.ok || !kvitto?.sökväg) {
    throw new Error(kvitto?.error ?? "Filen gick inte att ladda upp – bryggan mot Claude Code svarar inte.");
  }

  const svar = await requestClaudeCodeUppdrag({
    uppdrag: "rutin",
    payload: JSON.stringify(
      { fil: kvitto.sökväg, filnamn: fil.name, krav: begäran.krav, aktivitet: begäran.aktivitet },
      null,
      2,
    ),
    instruction: RUTIN_INSTRUKTION,
    diagramType: "affarsprocess",
    källa: begäran.källa,
    signal,
    timeoutMs: TIMEOUT_MS,
  });
  return rutinUrSvar(svar);
}
