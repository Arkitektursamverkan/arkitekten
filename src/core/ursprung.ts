/**
 * URSPRUNGET – när en process inte är ritad här utan läses in från ett annat
 * system av en integration.
 *
 * En installation kan låta en integration hålla processer i katalogen i takt
 * med ett modelleringsverktyg eller ett annat källsystem. Den som ser en sådan
 * process – här eller i EA-portalen – behöver veta att bilden är framställd
 * automatiskt och var den ändras på riktigt. Ursprunget säger det.
 *
 * Liksom placeringen och publiceringen är det en uppgift OM processen, inte en
 * del av dess innehåll: det sitter på flödet, inte på versionen, och ändras
 * utan att historiken rörs (invariant 11). Det skrivs BARA av integrationen,
 * direkt i flödesfilen – aldrig av en sparning ur appen (`prövaSparning` i
 * server/atkomst.ts tar det ur filen, som ägaren och skaparen).
 *
 * Ursprunget följer med ut genom flödestjänsten, så att portalen kan visa det
 * vid processbilden. Vilka system som finns vet bara installationen: namnet
 * är data, och produkten känner inget källsystem vid namn.
 */

export interface Ursprung {
  /** Källsystemets namn, som det ska visas. */
  system: string;
  /** true = bilden är framställd automatiskt ur källsystemet, inte ritad för hand. */
  automatisk?: boolean;
  /**
   * Flödet i integrationsplattformen som hämtar underlaget, om integrationen
   * går genom plattformen. Portalen frågar plattformen om det flödet är
   * påslaget – alltså om processen fortfarande hålls i takt med källan.
   */
  flode?: string;
}

/** Ett ursprung ur okänd data. Bara de kända fälten följer med; fel ger `null`. */
export function läsUrsprung(v: unknown): Ursprung | null {
  if (!v || typeof v !== "object") return null;
  const u = v as Record<string, unknown>;
  const system = typeof u.system === "string" ? u.system.trim().slice(0, 100) : "";
  if (!system) return null;
  const flode = typeof u.flode === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(u.flode.trim()) ? u.flode.trim() : "";
  return {
    system,
    ...(u.automatisk === true ? { automatisk: true } : {}),
    ...(flode ? { flode } : {}),
  };
}

/** En mening om ursprunget, för den som öppnar processen här. */
export function ursprungstext(u: Ursprung): string {
  return u.automatisk
    ? `Läses in automatiskt från ${u.system}. Ändringar görs där – det som ändras här skrivs över vid nästa inläsning.`
    : `Kommer från ${u.system}.`;
}
