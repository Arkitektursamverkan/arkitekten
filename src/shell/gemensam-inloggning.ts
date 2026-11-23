/**
 * Gemensam inloggning (portalens Administration → Organisation, eller
 * ARK_GEMENSAM_INLOGGNING): en utloggad besökare skickas direkt vidare till
 * Microsoft. Finns redan en Microsoft-session i webbläsaren – från portalen
 * eller en annan app i installationen – kommer hen tillbaka inloggad utan
 * att klicka.
 *
 * Två spärrar mot en loop: efter en utloggning i fliken sker ingen
 * automatisk inloggning, och ett automatiskt försök görs högst en gång per
 * minut – misslyckas det visas inloggningsrutan som vanligt.
 */
const UTLOGGAD = "ark.utloggad";
const SENAST = "ark.autoinloggning";
const PAUS_MS = 60_000;

function läs(n: string): string | null {
  try {
    return sessionStorage.getItem(n);
  } catch {
    return null;
  }
}
function skriv(n: string, v: string | null): void {
  try {
    if (v === null) sessionStorage.removeItem(n);
    else sessionStorage.setItem(n, v);
  } catch {
    /* ingen lagring – då blir det knappen */
  }
}

export function fårLoggaInSjälv(nu: number = Date.now()): boolean {
  return !läs(UTLOGGAD) && nu - (Number(läs(SENAST)) || 0) > PAUS_MS;
}
export function markeraAutoinloggning(nu: number = Date.now()): void {
  skriv(SENAST, String(nu));
}
export function markeraUtloggad(): void {
  skriv(UTLOGGAD, "1");
}
export function glömUtloggad(): void {
  skriv(UTLOGGAD, null);
}
