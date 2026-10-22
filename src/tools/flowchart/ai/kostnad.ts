/**
 * KOSTNADEN för ett AI-anrop – användaren godkänner innan något skickas.
 *
 * Gäller bara när servern svarar med API-nyckeln (då kostar varje anrop
 * pengar). Frågan ställs på EN plats, i bryggan (`skickaOchVänta`), så att
 * ingen knapp kan glömma den – och svaras av `KostnadsDialog`, som skalet
 * monterar en gång.
 *
 * Rutan har också ett tredje val: skicka till Claude Code i utvecklarsessionen
 * i stället (ingen kostnad per anrop). Bara utvecklaren har åtkomst till den vägen –
 * det står i rutan.
 *
 * Beloppen är uppskattningar för ett ENKELT flöde (2026-10-07):
 * tolkning ca 1 kr, förenkla och presentera ca 3 kr. Rutin och utvärdering
 * ligger i tolkningens storleksordning.
 */

export interface Kostnad {
  /** Vad som görs, som det står i rutan. */
  vad: string;
  /** Ungefärlig kostnad för ett enkelt flöde. */
  belopp: string;
}

const KOSTNADER: Record<string, Kostnad> = {
  tolkning: { vad: "Att tolka ett enkelt flöde med AI", belopp: "ca 1 kr" },
  presentation: { vad: "Att förenkla och presentera ett enkelt flöde", belopp: "ca 3 kr" },
  rutin: { vad: "Att skapa en rutin ur ett kort dokument", belopp: "ca 1 kr" },
  utvärdering: { vad: "Att låta AI granska ett enkelt flöde", belopp: "ca 1 kr" },
};

export function kostnadFör(uppdrag: string | undefined): Kostnad {
  return KOSTNADER[uppdrag ?? "tolkning"] ?? KOSTNADER.tolkning;
}

/** Felet när användaren avböjer – inget anrop har gjorts. */
export const AVBÖJT = "Avbrutet – inget AI-anrop gjordes.";

/** Svaret: vilken väg anropet ska ta – eller null när användaren avböjer. */
export type KostnadsSvar = "api" | "claude-code" | null;

type Fråga = (k: Kostnad) => Promise<KostnadsSvar>;
let fråga: Fråga | null = null;

/** Dialogen anmäler sig här när den monteras; returnerar avanmälan. */
export function registreraKostnadsfråga(f: Fråga): () => void {
  fråga = f;
  return () => {
    if (fråga === f) fråga = null;
  };
}

/**
 * Frågar användaren. Utan monterad dialog (t.ex. i ett test utan skal) ställs
 * frågan med webbläsarens egen bekräftelse – ett betalt anrop går aldrig iväg
 * ogodkänt.
 */
export async function godkännKostnad(uppdrag: string | undefined): Promise<KostnadsSvar> {
  const k = kostnadFör(uppdrag);
  if (fråga) return fråga(k);
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return window.confirm(`Den här funktionen är förknippad med en kostnad.\n${k.vad} kostar ${k.belopp}.`)
      ? "api"
      : null;
  }
  return null;
}
