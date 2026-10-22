/**
 * AI-utvärdering av ett flöde.
 *
 * Rådgivande, aldrig verkställande: den svarar med synpunkter som pekar ut
 * vilket steg de gäller, och användaren ändrar själv. Det är ett medvetet val – ett
 * flödesschema är en beskrivning av verkligheten, och en modell som skriver om
 * den på egen hand gör beskrivningen osann utan att någon märker det.
 *
 * Går genom samma brygga som tolkningen (server/brygga.ts), så ingen
 * API-nyckel behövs när appen körs via `npm run dev`.
 */

import type { ProcessModel } from "@/core/model";
import { requestClaudeCodeRaw } from "./bridge";

/** Hur allvarlig en synpunkt är – styr sortering och färg, inget annat. */
export type Allvar = "fel" | "förslag" | "notering";

export interface Synpunkt {
  allvar: Allvar;
  /** Kort rubrik, t.ex. "Två steg kan slås ihop". */
  rubrik: string;
  /** Vad som talar för det, i klartext. */
  motivering: string;
  /** Steg-id synpunkten gäller. Tom lista = gäller flödet som helhet. */
  stegIds: string[];
}

export interface Utvärdering {
  synpunkter: Synpunkt[];
  /** Modellens sammanfattande intryck, ett par meningar. */
  sammanfattning: string;
}

/**
 * Underlaget som skickas för utvärdering.
 *
 * Bara det som behövs för att bedöma flödet – inte positioner, banhöjder eller
 * annat utseende. En utvärdering ska handla om processen, inte om layouten.
 */
export function underlag(model: ProcessModel) {
  return {
    titel: model.title,
    underrubrik: model.subtitle,
    banor: model.swimlanes.map((l) => l.title),
    steg: model.nodes.map((n) => ({
      id: n.id,
      text: n.label,
      typ: n.type,
      bana: n.laneId,
    })),
    kopplingar: model.edges.map((e) => ({
      från: e.source,
      till: e.target,
      etikett: e.label,
    })),
    datalager: model.dataStores.map((d) => ({ id: d.id, text: d.label, bana: d.laneId })),
    meddelanden: model.messageFlows.map((f) => ({ från: f.nodeId, till: f.poolId })),
  };
}

export const REVIEW_PROMPT = `Du granskar ett processflöde åt en enterprise-arkitekt.

Svara på SVENSKA med ett JSON-objekt, inget annat:
{"sammanfattning": "...", "synpunkter": [
  {"allvar": "fel|förslag|notering", "rubrik": "...", "motivering": "...", "stegIds": ["s3"]}
]}

Leta efter, i den här ordningen:
1. FEL – steg utan väg vidare, beslut utan båda utfallen, kopplingar som går
   bakåt utan att vara en uttalad återgång, steg i en bana som inte kan utföra dem.
2. FÖRSLAG – steg som kan slås ihop för att de alltid sker tillsammans, saknade
   felvägar (vad händer om det INTE går bra?), moment som borde vara automatiska.
3. NOTERING – otydliga eller inkonsekventa namn, blandade abstraktionsnivåer.

Regler för svaret:
- Peka alltid ut stegIds när synpunkten gäller bestämda steg.
- Motivera i sak. "Kan förbättras" är inte en motivering.
- Hittar du inget att anmärka: svara med tom lista. Hitta inte på synpunkter.
- Föreslå inte att ändra banindelningen om du inte kan säga varför den är fel.`;

/** Tolkar modellens svar. Kastar med ett begripligt fel om formen inte stämmer. */
export function tolkaUtvärdering(rå: string): Utvärdering {
  const json = plockaJson(rå);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Svaret var inte giltig JSON.");
  }
  if (typeof data !== "object" || data === null) throw new Error("Svaret var inte ett objekt.");
  const o = data as Record<string, unknown>;
  const lista = Array.isArray(o.synpunkter) ? o.synpunkter : [];
  const synpunkter: Synpunkt[] = [];
  for (const s of lista) {
    if (typeof s !== "object" || s === null) continue;
    const p = s as Record<string, unknown>;
    const rubrik = typeof p.rubrik === "string" ? p.rubrik.trim() : "";
    if (!rubrik) continue; // en synpunkt utan rubrik säger ingenting
    synpunkter.push({
      allvar: p.allvar === "fel" || p.allvar === "notering" ? p.allvar : "förslag",
      rubrik,
      motivering: typeof p.motivering === "string" ? p.motivering.trim() : "",
      stegIds: Array.isArray(p.stegIds) ? p.stegIds.filter((x): x is string => typeof x === "string") : [],
    });
  }
  return {
    sammanfattning: typeof o.sammanfattning === "string" ? o.sammanfattning.trim() : "",
    synpunkter: sortera(synpunkter),
  };
}

/** Fel först, sedan förslag, sist noteringar. */
function sortera(s: Synpunkt[]): Synpunkt[] {
  const rang: Record<Allvar, number> = { fel: 0, förslag: 1, notering: 2 };
  return [...s].sort((a, b) => rang[a.allvar] - rang[b.allvar]);
}

/**
 * Plockar ut JSON-objektet ur svaret.
 *
 * Modeller lägger gärna svaret i en ```json-fence eller skriver en mening före.
 * Att kräva rent JSON gör funktionen skör utan att göra den säkrare.
 */
function plockaJson(rå: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(rå);
  const text = (fence ? fence[1] : rå).trim();
  const start = text.indexOf("{");
  const slut = text.lastIndexOf("}");
  if (start === -1 || slut <= start) throw new Error("Hittade inget JSON-objekt i svaret.");
  return text.slice(start, slut + 1);
}

/** Ber Claude Code utvärdera flödet. Rådgivande – ingenting ändras. */
export async function begärUtvärdering(
  model: ProcessModel,
  signal?: AbortSignal,
): Promise<Utvärdering> {
  const svar = await requestClaudeCodeRaw({
    payload: JSON.stringify(underlag(model), null, 2),
    instruction: REVIEW_PROMPT,
    signal,
  });
  return tolkaUtvärdering(svar);
}
