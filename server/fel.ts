/**
 * Fel som FÅR visas för användaren.
 *
 * Bryggan och flödestjänsten skickar bara ut texten i ett `Användarfel` (och
 * dess underklasser, t.ex. `Kontofel`). Alla andra fel – ett filsystemsfel med
 * en sökväg, ett programfel – loggas på servern och blir ett allmänt besked
 * utåt. Den som kastar ett fel med en text som är menad för användaren väljer
 * alltså det uttryckligen.
 */

export class Användarfel extends Error {
  constructor(
    meddelande: string,
    readonly status = 400,
  ) {
    super(meddelande);
  }
}

/** En begäran vars kropp är större än gränsen. Läsningen avbryts och anslutningen stängs. */
export class Kroppsfel extends Användarfel {
  constructor(meddelande = "Begäran är för stor.") {
    super(meddelande, 413);
  }
}

/** Beskedet utåt för ett fel som inte är ett `Användarfel`. */
export const ALLMÄNT_FEL = "Något gick fel på servern. Försök igen, eller kontakta administratören.";
