/**
 * Hakparentessyntaxen för affärsprocessens satelliter i beskrivningstexten:
 *
 *   Genomför urval [Roll: Rekryteringsansvarig U] [IT: Fastighetssystemet]
 *     [Krav: Öka mångfald] [In: Ansökningar] [Ut: Beslut om slutkandidat]
 *
 * Allt i hakparenteser lyfts UT ur stegtexten och läggs i stegets ap-block –
 * flödesschemat påverkas inte alls av annoteringarna. Vanliga parenteser går
 * inte att använda: de är redan grensyntax i beskrivningsformatet.
 *
 * `[Forum]` UTAN kolon gör steget till ett forum i kedjan (metoden: i
 * stället för en aktivitet, när den alltid genomförs i mötesform). Med kolon,
 * `[Forum: Ledningsgruppen]`, är forumet en satellit som förut.
 *
 * HUKI-bokstaven (H/U/K/I) skrivs sist i roll-/intressentnamnet: "HR U".
 * Flera värden separeras med komma eller semikolon: [Roll: Chef H, HR K].
 */

import type { ApStegInfo, Huki } from "@/core/draft";

const MÖNSTER =
  /\[\s*(roll|intressent|it|app|applikation|arkiv|krav|tid|forum|plats|problem|risk|möjlighet|mojlighet|in|ut)\s*:\s*([^\]]+)\]/gi;
/** `[Forum]` utan värde – steget självt är ett forum. */
const MÖTESFORM = /\[\s*forum\s*\]/gi;

/** "Rekryterande chef H" → { namn, huki }. Bokstaven är valfri. */
function tolkaRoll(v: string): { namn: string; huki?: Huki } {
  const m = v.match(/^(.*?)\s+([HUKI])$/);
  if (m) return { namn: m[1].trim(), huki: m[2] as Huki };
  return { namn: v.trim() };
}

function värden(v: string): string[] {
  return v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extraherar satellitannoteringarna ur en stegtext. Returnerar den RENSADE texten
 * (utan hakparenteser) och ap-blocket, eller `ap: undefined` när texten inte
 * innehåller några annoteringar.
 */
export function extraheraAp(text: string): { ren: string; ap?: ApStegInfo } {
  const ap: ApStegInfo = {};
  let träff = false;
  const ren = text
    .replace(MÖNSTER, (_hela, nyckel: string, värde: string) => {
      träff = true;
      const k = nyckel.toLowerCase();
      if (k === "roll") (ap.roller ??= []).push(...värden(värde).map(tolkaRoll));
      else if (k === "intressent") (ap.intressenter ??= []).push(...värden(värde).map(tolkaRoll));
      else if (k === "it" || k === "app" || k === "applikation")
        (ap.applikationer ??= []).push(...värden(värde));
      else if (k === "arkiv") (ap.arkiv ??= []).push(...värden(värde));
      else if (k === "krav") (ap.krav ??= []).push(...värden(värde));
      else if (k === "tid") ap.tid = värde.trim();
      else if (k === "forum") ap.forum = värde.trim();
      else if (k === "plats") ap.plats = värde.trim();
      else if (k === "problem") (ap.problem ??= []).push(...värden(värde));
      else if (k === "risk") (ap.risker ??= []).push(...värden(värde));
      else if (k === "möjlighet" || k === "mojlighet") (ap.mojligheter ??= []).push(...värden(värde));
      else if (k === "in") ap.input = värde.trim();
      else if (k === "ut") ap.output = värde.trim();
      return " ";
    })
    .replace(MÖTESFORM, () => {
      träff = true;
      ap.iMötesform = true;
      return " ";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return { ren, ap: träff ? ap : undefined };
}
