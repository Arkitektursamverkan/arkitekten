/**
 * SKÄRMARNA – ramserien visad i egna fönster, ett per skärm.
 *
 * Huvudfönstret äger serien och vilken ram som visas; skärmfönstren är rena
 * mottagare. De pratar över en BroadcastChannel (samma ursprung, ingen server
 * inblandad). Hela serien – och flödets grundbild – skickas med varje gång, så
 * skärmarna visar också det som ännu inte är sparat: precis det man ser.
 *
 * Varje skärm har ett nummer och en VY: Flöde, Bild eller Båda (halva skärmen
 * var). Kontrollen i huvudfönstret byter vy per skärm och bläddrar; så går det
 * att köra två TV-apparater – flödet på den ena, bilden på den andra – eller
 * en skärm med båda sida vid sida.
 *
 * En skärm kan även bläddra själv: piltangenterna där skickar `byt` tillbaka.
 */

import type { Ramserie } from "@/core/ram";

export const VISNINGS_KANAL = "ark-ramar-visning";
export const VISNINGS_PARAM = "ramvisning";

export type SkärmVy = "flöde" | "bild" | "båda";
export const SKÄRMVYER: { id: SkärmVy; namn: string }[] = [
  { id: "flöde", namn: "Flöde" },
  { id: "bild", namn: "Bild" },
  { id: "båda", namn: "Båda" },
];

export type VisningsMeddelande =
  /** Huvudfönstret → skärmarna: serien, ramen och flödets grundbild. */
  | { typ: "läge"; serie: Ramserie; index: number; flödeSvg?: string }
  /** En skärm hälsar (vid start och när dess vy ändrats) – och ber om läget. */
  | { typ: "hej"; skärm?: string; vy?: SkärmVy }
  /** En skärm stängs. */
  | { typ: "hejdå"; skärm: string }
  /** En skärm bläddrar. */
  | { typ: "byt"; steg: 1 | -1 }
  /** Kontrollen → en skärm: visa det här. */
  | { typ: "vy"; skärm: string; vy: SkärmVy };

export function öppnaSkärm(skärm: string, vy: SkärmVy): void {
  const q = new URLSearchParams({ [VISNINGS_PARAM]: "1", skarm: skärm, vy });
  window.open(`${location.pathname}?${q}`, `ark-ramvisning-${skärm}`, "popup,width=1280,height=760");
}

/** Den gamla knappen: bilden i ett eget fönster. */
export function öppnaVisningsfönster(): void {
  öppnaSkärm("1", "bild");
}

export function ärVisningsfönster(): boolean {
  return new URLSearchParams(location.search).has(VISNINGS_PARAM);
}

/** Skärmens nummer och startvy ur adressen. */
export function skärmParametrar(sök = location.search): { skärm: string; vy: SkärmVy } {
  const q = new URLSearchParams(sök);
  const vy = q.get("vy");
  return {
    skärm: q.get("skarm") || "1",
    vy: vy === "flöde" || vy === "båda" ? vy : "bild",
  };
}

/** Nästa lediga skärmnummer. */
export function nästaSkärm(upptagna: Iterable<string>): string {
  const tagna = new Set(upptagna);
  let n = 1;
  while (tagna.has(String(n))) n++;
  return String(n);
}
