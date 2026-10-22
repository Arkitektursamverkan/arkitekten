/**
 * LÄNKEN TILL EN PROCESS: `#/process/<flödes-id>`.
 *
 * Appen hade ingen adress per process – vilken som visades fanns bara i sidans
 * minne, så en omladdning ledde till startsidan och det gick inte att skicka
 * en kollega till en viss process. Adressen följer nu den process som visas,
 * och en sådan adress öppnar processen i läsläge.
 *
 * - Länken pekar på PROCESSEN, aldrig på en version: den som följer den ser
 *   det senast sparade (beslut 2026-10-02).
 * - Efter `#`, inte i sökvägen: dev-servern och en statisk build svarar då med
 *   samma sida utan att någon behöver känna till adresserna.
 * - Id:t är flödets stabila id (invariant 2), så länken överlever namnbyten
 *   och flyttar i katalogen.
 */

const PREFIX = "#/process/";

/** Adressdelen för en process ("" = ingen process visas). */
export function processLänk(id: string | null): string {
  return id ? PREFIX + encodeURIComponent(id) : "";
}

/** Processens id ur adressens hash, eller null när adressen inte pekar ut någon. */
export function läsProcessLänk(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    return decodeURIComponent(hash.slice(PREFIX.length)) || null;
  } catch {
    return null; // trasig kodning – behandla som ingen länk
  }
}
