/**
 * Är det här en begäran verktyget INTE redan har påbörjat?
 *
 * En begäran är en HÄNDELSE, inte ett tillstånd: den får verkställas en gång.
 * Verktygets effekt körs dock om utan att begäran är ny – när komponenten
 * monteras om, och i utvecklingsläge varje gång filen sparas (Fast Refresh kör
 * om alla effekter). Då började verktyget om på processen: tomt mellanlager,
 * och eftersom en ny process sparas direkt skrevs det TOMMA flödet som en ny
 * version ovanpå det användaren hunnit rita (en demoprocess, 2026-10-01).
 *
 * `senast` är verktygets egen anteckning (en ref) om vilken nonce det redan
 * tagit hand om. Den skyddar mot omkörda effekter; att skalet dessutom släpper
 * begäran (`onNyProcessMottagen`) skyddar mot en ommontering, där refen är ny.
 */
export function ärNyBegäran(
  begäran: { nonce: number } | null,
  senast: { current: number | null },
): boolean {
  if (!begäran || senast.current === begäran.nonce) return false;
  senast.current = begäran.nonce;
  return true;
}
