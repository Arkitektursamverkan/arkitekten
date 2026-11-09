/**
 * Felet från ett misslyckat inloggningsförsök, som det går i adressen
 * (`/?inloggningsfel=<kod>`) och som inloggningssidan visar det.
 *
 * REGRESSION: hela feltexten gick i adressen och sidan visade vad som helst
 * som stod där – också text som en främling skrivit in i en länk ("Ring
 * supporten på …"), eller Entras `error_description` ur en förfalskad
 * återkomst. Nu går bara en KOD ur en känd uppsättning; texten bor här och
 * felets detaljer stannar i serverns logg. En AADSTS-kod från Entra släpps
 * igenom som den är – den är det administratören behöver för att felsöka.
 *
 * Beroendefri (ren TS): bryggan kodar, inloggningssidan läser.
 */

const TEXTER = {
  tid: "Inloggningen tog för lång tid – försök igen.",
  webblasare: "Inloggningen hör inte till den här webbläsaren – försök igen.",
  entra: "Entra ID avbröt inloggningen.",
  token: "Inloggningen kunde inte slutföras (token).",
  konto: "Kontot kunde inte läsas ur inloggningen.",
  misslyckades: "Inloggningen misslyckades. Försök igen, eller kontakta administratören.",
} as const;

export type Inloggningsfelkod = keyof typeof TEXTER;

const AADSTS = /\bAADSTS\d{4,8}\b/;

/** Koden för ett fel som kastats under inloggningen (server/auth.ts). */
export function inloggningsfelKod(meddelande: string): string {
  const aadsts = AADSTS.exec(meddelande)?.[0];
  if (aadsts) return aadsts;
  if (/för lång tid/.test(meddelande)) return "tid";
  if (/webbläsaren/.test(meddelande)) return "webblasare";
  if (/^Entra svarade|ingen kod/.test(meddelande)) return "entra";
  if (/token/i.test(meddelande)) return meddelande.startsWith("Id-token") ? "konto" : "token";
  return "misslyckades";
}

/** Texten för en kod ur adressen. Allt okänt blir det allmänna beskedet – aldrig texten själv. */
export function inloggningsfelText(kod: string): string {
  const k = kod.trim();
  if (/^AADSTS\d{4,8}$/.test(k)) return `Entra ID nekade inloggningen (${k}).`;
  return Object.prototype.hasOwnProperty.call(TEXTER, k) ? TEXTER[k as Inloggningsfelkod] : TEXTER.misslyckades;
}
