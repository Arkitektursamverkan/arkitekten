/**
 * "Ny" – märket på en process som just lagts upp.
 *
 * HÄRLETT, ALDRIG LAGRAT (samma hållning som beteckningen, invariant 9):
 * en process skapades när dess FÖRSTA version sparades, och den tidpunkten
 * står redan i historiken. Ett eget fält hade kunnat glida ifrån historiken,
 * och hade krävt en migrering av varje befintlig fil.
 *
 * Modulen är avsiktligt beroendefri (ren TS, inget DOM) – bryggans filläsning
 * (server/brygga.ts) och webbläsarlagringen använder samma funktion, så
 * att en process inte är ny i den ena listan och gammal i den andra.
 */

/** Så länge efter att processen lagts upp står märket kvar. */
export const NY_TIMMAR = 48;

/**
 * När processen lades upp: första versionens tidpunkt. Filer från före
 * versionshistoriken har ingen – då är flödets egen `savedAt` det enda som
 * finns, och det var också den enda sparningen.
 */
export function skapadTid(flöde: {
  savedAt?: unknown;
  versions?: unknown;
}): string | undefined {
  const första = Array.isArray(flöde.versions) ? flöde.versions[0]?.savedAt : undefined;
  const tid = typeof första === "string" ? första : flöde.savedAt;
  return typeof tid === "string" ? tid : undefined;
}

/**
 * Är processen ny? En tidpunkt som saknas eller inte går att tolka är INTE ny:
 * märket ska betyda något, och en trasig fil ska inte lysa för evigt. Samma
 * sak för en tidpunkt i framtiden (en klocka som går fel).
 */
export function ärNy(skapad: string | undefined, nu: number = Date.now()): boolean {
  if (!skapad) return false;
  const ålder = nu - Date.parse(skapad);
  return ålder >= 0 && ålder < NY_TIMMAR * 60 * 60 * 1000;
}
