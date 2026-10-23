/**
 * Organisationens utseende som skalet visar: namn, logotyp och profilfärg.
 * Servern sätter ihop det ur miljön och portalen (`server/utseende.ts`); appen
 * läser det från `/__ark/utseende`, också före inloggningen.
 */
export interface Utseende {
  namn?: string;
  kortnamn?: string;
  /** #RRGGBB */
  färg?: string;
  /** Ändras när logotypen kan ha ändrats – går i bildens adress. Saknas = ingen logotyp. */
  logoVersion?: string;
}
