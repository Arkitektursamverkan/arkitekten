/**
 * SERVERNS SVAR på brevlådans begäranden – när en API-nyckel finns.
 *
 * Ark-bryggan (server/brygga.ts) lägger varje begäran i `.ark/request.json`.
 * Utan nyckel besvaras den av Claude Code i terminalen; MED nyckel anropar
 * dev-servern själv modellen genom den här modulen och skriver svaret i
 * `.ark/response.json`, i exakt den form Claude Code skulle ha skrivit det.
 * Appen ser ingen skillnad – samma polling, samma `svarTillDraft`,
 * `byggPresentation` och `rutinUrSvar` tar emot svaret.
 *
 * Uppdragen följer CLAUDE.md:
 *  - "tolkning"     → ett strukturerat mellanlager (DRAFT_JSON_SCHEMA)
 *  - "utvärdering"  → { aiText } med modellens text
 *  - "presentation" → { förenklad, presentation }. Samma arbetsgång som för
 *    Claude Code: först processen, sedan bildens id:n ur SAMMA kod som
 *    kontrollskriptet (`byggFörenklad`/`beskrivFörenklad`), sedan ramarna, och
 *    så länge `byggPresentation` har anmärkningar en rättelse till.
 *  - "rutin"        → { rutin }. Underlaget bifogas i anropet (PDF och bild som
 *    de är, Word/ODF som text) – modellen kan inte läsa filer från disken.
 *
 * Modulen är ren: modellen nås genom en injicerad `Fråga`, filerna genom
 * `läsUnderlag`. Därför går hela flödet att testa utan nätverk.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { RUTIN_INSTRUKTION } from "@/tools/affarsprocess/ai-rutin";
import {
  beskrivFörenklad,
  byggFörenklad,
  byggPresentation,
  presentationsInstruktion,
} from "@/tools/ramar/ai-presentation";

import { systemPrompt, userPrompt, type PromptDiagramType } from "./prompt";
import { DRAFT_JSON_SCHEMA, type AiDraftResponse } from "./schema";

export type Meddelande = Anthropic.Beta.BetaMessageParam;

/** Ett anrop till modellen. `innehåll` läggs tillbaka orört i samtalet. */
export type Fråga = (p: {
  system: string;
  meddelanden: Meddelande[];
  /** JSON-schema för svaret (strukturerad utdata). */
  schema?: Record<string, unknown>;
  signal?: AbortSignal;
}) => Promise<{ text: string; innehåll: Anthropic.Beta.BetaContentBlockParam[] }>;

/** Begäran som ark-bryggan skrev den i `.ark/request.json`. */
export interface ArkBegäran {
  id?: string;
  uppdrag?: string;
  rawText: string;
  diagramType?: string;
  instruction?: string;
  /** Användarens egna önskemål – utan diagramtypens husregler. */
  önskemål?: string;
  källa?: { flödeId: string; namn: string };
}

export interface Miljö {
  fråga: Fråga;
  signal?: AbortSignal;
  /** Läser ett uppladdat underlag (sökväg relativt projektroten). */
  läsUnderlag?: (sökväg: string) => Promise<Uint8Array>;
  /** Id:n som redan är tagna – samma som kontrollskriptet läser ur projektet. */
  upptagna?: () => { serier: string[]; flöden: string[] };
  logg?: (rad: string) => void;
}

/** Besvarar en begäran. Kastar Error med ett svenskt meddelande när det inte går. */
export async function besvara(b: ArkBegäran, m: Miljö): Promise<Record<string, unknown>> {
  switch (b.uppdrag) {
    case "presentation":
      return besvaraPresentation(b, m);
    case "rutin":
      return besvaraRutin(b, m);
    case "utvärdering": {
      const { text } = await m.fråga({
        system: b.instruction ?? "",
        meddelanden: [{ role: "user", content: b.rawText }],
        signal: m.signal,
      });
      if (!text.trim()) throw new Error("AI:n svarade utan innehåll. Försök igen.");
      return { aiText: text };
    }
    default:
      return { ...(await besvaraTolkning(b, m.fråga, m.signal)) };
  }
}

/* ------------------------------------------------------------------ */
/* Tolkning                                                            */
/* ------------------------------------------------------------------ */

export async function besvaraTolkning(
  b: Pick<ArkBegäran, "rawText" | "diagramType" | "önskemål">,
  fråga: Fråga,
  signal?: AbortSignal,
): Promise<AiDraftResponse> {
  if (!b.rawText.trim()) throw new Error("Beskrivningen är tom – det finns inget att tolka.");
  const typ: PromptDiagramType = b.diagramType === "affarsprocess" ? "affarsprocess" : "flowchart";
  const önskemål = b.önskemål?.trim();
  const { text } = await fråga({
    system: systemPrompt(typ),
    meddelanden: [
      {
        role: "user",
        content: userPrompt(b.rawText) + (önskemål ? `\n\nÖnskemål från användaren: ${önskemål}` : ""),
      },
    ],
    schema: DRAFT_JSON_SCHEMA,
    signal,
  });
  const svar = jsonUr(text) as AiDraftResponse;
  if (!Array.isArray(svar.steps) || svar.steps.length === 0) {
    throw new Error("AI:n hittade inga steg i beskrivningen.");
  }
  return svar;
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

const API_ARBETSGÅNG = `── Svar via API ───────────────────────────────────────────────────────────────
Du har inga verktyg. Arbetsgången ovan sköts åt dig: servern kör samma kontroll
som scripts/presentation.mts och visar dig dess utskrift. Svara i VARJE steg med
ETT JSON-objekt och ingenting annat – ingen förklaring, inget requestId.`;

/** Hur många gånger en kontroll får skickas tillbaka för rättelse. */
const RÄTTELSER = 2;

async function besvaraPresentation(b: ArkBegäran, m: Miljö): Promise<Record<string, unknown>> {
  let beskrivning = "";
  try {
    beskrivning = String((JSON.parse(b.rawText) as { beskrivning?: unknown }).beskrivning ?? "");
  } catch {
    beskrivning = b.rawText;
  }
  const källa = {
    flödeId: b.källa?.flödeId ?? "",
    namn: b.källa?.namn || "Processen",
    beskrivning,
  };
  const system = `${presentationsInstruktion()}\n\n${API_ARBETSGÅNG}`;
  const samtal: Meddelande[] = [
    {
      role: "user",
      content: `Underlaget (rawText):\n${b.rawText}\n\nSteg 1: svara med { "förenklad": { … } }.`,
    },
  ];
  const fråga = async () => {
    const svar = await m.fråga({ system, meddelanden: samtal, signal: m.signal });
    samtal.push({ role: "assistant", content: svar.innehåll });
    return jsonUr(svar.text) as Record<string, unknown>;
  };
  const rätta = (text: string) => samtal.push({ role: "user", content: text });

  // 1. Processen – tills kontrollen kan bygga den.
  let förenklad: unknown;
  let process: ReturnType<typeof byggFörenklad> | undefined;
  for (let försök = 0; !process; försök++) {
    let fel: string;
    try {
      const svar = await fråga();
      förenklad = svar["förenklad"] ?? svar["forenklad"] ?? svar;
      process = byggFörenklad({ förenklad }, källa);
      break;
    } catch (e) {
      if (m.signal?.aborted || försök >= RÄTTELSER) throw e;
      fel = e instanceof Error ? e.message : String(e);
    }
    m.logg?.(`presentation: kontrollen avvisade processen – ${fel}`);
    rätta(`Kontrollen avvisade svaret: ${fel}\nSvara igen med { "förenklad": { … } }.`);
  }
  m.logg?.(`presentation: förenklad process klar (${process.draft.steps.length} steg)`);

  // 2. Ramarna – mot bildens id:n, och rättade tills anmärkningarna är borta.
  rätta(
    `Kontrollskriptet:\n${beskrivFörenklad(process)}\n\n` +
      `Steg 2: svara med { "presentation": { … } }. Markeringarna får bara peka på id:n och nycklar ur listan ovan.`,
  );
  const { serier, flöden } = m.upptagna?.() ?? { serier: [], flöden: [] };
  let bäst: { presentation: unknown; anmärkningar: string[] } | undefined;
  for (let försök = 0; ; försök++) {
    let återkoppling: string;
    try {
      const svar = await fråga();
      const presentation = svar.presentation ?? svar;
      const { anmärkningar } = byggPresentation({ förenklad, presentation }, källa, serier, flöden);
      if (!bäst || anmärkningar.length < bäst.anmärkningar.length) bäst = { presentation, anmärkningar };
      if (!anmärkningar.length) break;
      återkoppling = `Kontrollskriptet har ${anmärkningar.length} anmärkning(ar):\n${anmärkningar.map((a) => `  - ${a}`).join("\n")}`;
    } catch (e) {
      if (m.signal?.aborted || (försök >= RÄTTELSER && !bäst)) throw e;
      återkoppling = `Kontrollen avvisade svaret: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (försök >= RÄTTELSER) break;
    m.logg?.(`presentation: rättelse ${försök + 1} – ${återkoppling.split("\n")[0]}`);
    rätta(`${återkoppling}\nSvara med en rättad { "presentation": { … } } – hela objektet.`);
  }
  m.logg?.(`presentation: klar, ${bäst!.anmärkningar.length} anmärkning(ar) kvar`);
  return { förenklad, presentation: bäst!.presentation };
}

/* ------------------------------------------------------------------ */
/* Rutin                                                               */
/* ------------------------------------------------------------------ */

const RUTIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rutin"],
  properties: { rutin: { type: "string" } },
};

const BILDER: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const TEXTFILER = new Set(["txt", "md", "csv", "tsv", "html", "htm", "xml", "json", "rtf"]);

async function besvaraRutin(b: ArkBegäran, m: Miljö): Promise<Record<string, unknown>> {
  const underlag = JSON.parse(b.rawText) as { fil?: string; filnamn?: string; krav?: string; aktivitet?: string };
  if (!underlag.fil) throw new Error("Begäran pekar inte ut någon fil.");
  if (!m.läsUnderlag) throw new Error("Servern kan inte läsa underlaget.");
  const data = await m.läsUnderlag(underlag.fil);
  const namn = underlag.filnamn || underlag.fil;
  const bilaga = await underlagSomBlock(namn, data);

  const { text } = await m.fråga({
    system:
      `${RUTIN_INSTRUKTION}\n\nUnderlaget är BIFOGAT i meddelandet – filen behöver inte läsas från disk. ` +
      `Svara med { "rutin": "<texten>" } och ingenting annat.`,
    meddelanden: [
      {
        role: "user",
        content: [
          bilaga,
          {
            type: "text",
            text:
              `Underlaget ovan är filen "${namn}".\n` +
              `Kravet rutinen hör till: ${underlag.krav ?? "–"}\n` +
              `Aktiviteten kravet hänger på: ${underlag.aktivitet ?? "–"}`,
          },
        ],
      },
    ],
    schema: RUTIN_SCHEMA,
    signal: m.signal,
  });
  const svar = jsonUr(text) as { rutin?: unknown };
  if (typeof svar.rutin !== "string" || !svar.rutin.trim()) throw new Error("Svaret innehöll ingen rutin.");
  return { rutin: svar.rutin };
}

/** Filen som ett innehållsblock modellen kan läsa – PDF och bild som de är, dokument som text. */
export async function underlagSomBlock(
  namn: string,
  data: Uint8Array,
): Promise<Anthropic.Beta.BetaContentBlockParam> {
  const ändelse = namn.toLowerCase().split(".").pop() ?? "";
  if (ändelse === "pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64(data) } };
  }
  if (BILDER[ändelse]) {
    return { type: "image", source: { type: "base64", media_type: BILDER[ändelse], data: base64(data) } };
  }
  let text: string | null = null;
  if (ändelse === "docx") text = xmlTillText(await läsZip(data, "word/document.xml"), "w:p");
  else if (ändelse === "odt") text = xmlTillText(await läsZip(data, "content.xml"), "text:(?:p|h)");
  else if (TEXTFILER.has(ändelse)) text = new TextDecoder().decode(data);
  if (text === null) {
    throw new Error(`Filformatet .${ändelse} kan inte läsas – spara underlaget som PDF, Word (.docx) eller text.`);
  }
  if (!text.trim()) throw new Error(`Hittade ingen text i "${namn}".`);
  return { type: "document", source: { type: "text", media_type: "text/plain", data: text }, title: namn };
}

/* ------------------------------------------------------------------ */
/* Hjälpare                                                            */
/* ------------------------------------------------------------------ */

/** Plockar JSON-objektet ur modellens text – även om det kom inramat i ```json. */
export function jsonUr(text: string): unknown {
  const t = text.trim();
  if (!t) throw new Error("AI:n svarade utan innehåll. Försök igen.");
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const slut = t.lastIndexOf("}");
    if (start >= 0 && slut > start) {
      try {
        return JSON.parse(t.slice(start, slut + 1));
      } catch {
        /* faller igenom */
      }
    }
    throw new Error("Kunde inte tolka AI:ns svar som JSON.");
  }
}

function base64(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Styckena i ett Word-/ODF-dokument, ett per rad. */
function xmlTillText(xml: string, stycke: string): string {
  return xml
    .replace(/<w:tab\/>|<text:tab\/>/g, "\t")
    .replace(/<w:br\/>|<text:line-break\/>/g, "\n")
    .replace(new RegExp(`</${stycke}>`, "g"), "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Läser EN fil ur ett zip-arkiv (docx och odt är zip). Liten och beroendefri:
 * centralkatalogen pekar ut posten, och `deflate-raw` packas upp med
 * plattformens DecompressionStream.
 */
export async function läsZip(zip: Uint8Array, sökt: string): Promise<string> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Filen är inte ett giltigt dokument (zip-katalogen saknas).");
  const antal = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  for (let n = 0; n < antal; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metod = v.getUint16(p + 10, true);
    const packad = v.getUint32(p + 20, true);
    const namnLängd = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true);
    const kommentar = v.getUint16(p + 32, true);
    const lokal = v.getUint32(p + 42, true);
    const namn = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + namnLängd));
    if (namn === sökt) {
      const start = lokal + 30 + v.getUint16(lokal + 26, true) + v.getUint16(lokal + 28, true);
      const rå = zip.subarray(start, start + packad);
      if (metod === 0) return new TextDecoder().decode(rå);
      if (metod !== 8) throw new Error(`Okänd komprimering (${metod}) i dokumentet.`);
      const ström = new Blob([rå.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(ström).text();
    }
    p += 46 + namnLängd + extra + kommentar;
  }
  throw new Error(`Dokumentet saknar ${sökt}.`);
}
