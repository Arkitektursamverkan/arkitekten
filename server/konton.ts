/**
 * LOKALA KONTON – inloggningsläget "lokal" (ARK_AUTH=lokal).
 *
 * För en installation utan Entra ID, som portalen och plattformen har:
 * användarnamn och lösenord, lagrade i EN fil i datavolymen (`ARK_KONTON`).
 * Det första besöket skapar administratören; därefter lägger en
 * administratör upp kontona under Inställningar.
 *
 * Lösenorden lagras som scrypt-hashar med eget salt, aldrig i klartext, och
 * lämnar aldrig den här modulen – `utåt` tar bort hashen innan ett konto
 * skickas någonstans. Jämförelsen är tidskonstant.
 *
 * Filen skrivs atomärt (tillfällig fil + rename), så ett avbrott mitt i en
 * skrivning lämnar den gamla filen hel.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Användare, Roll } from "../src/core/behorighet";

export interface Konto {
  /** Stabilt id – byts aldrig, ägarskap och "skapad av" följer det. */
  id: string;
  /** Inloggningsnamnet, gemener. Oftast en e-postadress. */
  användarnamn: string;
  namn: string;
  roller: Roll[];
  /** scrypt$<salt>$<hash>, base64url. */
  lösenord: string;
  skapad: string;
}

/** Ett konto som det visas utåt – utan lösenordshashen. */
export type KontoUtåt = Omit<Konto, "lösenord">;

export const MIN_LÄNGD = 10;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashaLösenord(lösenord: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(lösenord, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function stämmerLösenord(lösenord: string, lagrat: string): boolean {
  const [typ, salt, hash] = lagrat.split("$");
  if (typ !== "scrypt" || !salt || !hash) return false;
  const väntad = Buffer.from(hash, "base64url");
  const given = crypto.scryptSync(lösenord, Buffer.from(salt, "base64url"), väntad.length, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return crypto.timingSafeEqual(given, väntad);
}

/** Varför ett lösenord inte duger, eller null. */
export function prövaLösenord(lösenord: unknown): string | null {
  if (typeof lösenord !== "string" || lösenord.length < MIN_LÄNGD)
    return `Lösenordet måste vara minst ${MIN_LÄNGD} tecken.`;
  if (lösenord.length > 200) return "Lösenordet är för långt.";
  return null;
}

const ANVÄNDARNAMN = /^[\p{L}\p{N}._@+-]{2,120}$/u;

export const utåt = ({ lösenord: _, ...k }: Konto): KontoUtåt => k;
export const somAnvändare = (k: Konto): Användare => ({
  id: k.id,
  namn: k.namn,
  ...(k.användarnamn.includes("@") ? { epost: k.användarnamn } : {}),
  roller: k.roller,
});

export class Kontofel extends Error {
  constructor(
    meddelande: string,
    readonly status = 400,
  ) {
    super(meddelande);
  }
}

/** Kontona i en fil. Läses om vid varje anrop – filen är liten och kan ha ändrats av en annan process. */
export class Kontolager {
  constructor(private readonly fil: string) {}

  alla(): Konto[] {
    if (!fs.existsSync(this.fil)) return [];
    const data = JSON.parse(fs.readFileSync(this.fil, "utf8"));
    return Array.isArray(data?.konton) ? data.konton : [];
  }

  private spara(konton: Konto[]): void {
    fs.mkdirSync(path.dirname(this.fil), { recursive: true });
    const tmp = `${this.fil}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ konton }, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, this.fil);
  }

  finnsNågot(): boolean {
    return this.alla().length > 0;
  }

  hämta(id: string): Konto | undefined {
    return this.alla().find((k) => k.id === id);
  }

  /** Inloggningen. Samma svar för okänt namn och fel lösenord – inget avslöjar vilka konton som finns. */
  logga(användarnamn: string, lösenord: string): Konto {
    const k = this.alla().find((x) => x.användarnamn === användarnamn.trim().toLowerCase());
    // Räkna en hash också för ett okänt namn, så att svarstiden inte avslöjar det.
    const ok = k ? stämmerLösenord(lösenord, k.lösenord) : (stämmerLösenord(lösenord, hashaLösenord("x".repeat(MIN_LÄNGD))), false);
    if (!k || !ok) throw new Kontofel("Fel användarnamn eller lösenord.", 401);
    return k;
  }

  skapa(ny: { användarnamn: string; namn: string; roll: Roll; lösenord: string }): Konto {
    const användarnamn = ny.användarnamn.trim().toLowerCase();
    if (!ANVÄNDARNAMN.test(användarnamn)) throw new Kontofel("Ogiltigt användarnamn.");
    const fel = prövaLösenord(ny.lösenord);
    if (fel) throw new Kontofel(fel);
    const konton = this.alla();
    if (konton.some((k) => k.användarnamn === användarnamn)) throw new Kontofel("Användarnamnet finns redan.", 409);
    const konto: Konto = {
      id: `konto-${crypto.randomBytes(8).toString("hex")}`,
      användarnamn,
      namn: ny.namn.trim().slice(0, 120) || användarnamn,
      roller: ny.roll === "admin" ? ["admin", "user"] : ["user"],
      lösenord: hashaLösenord(ny.lösenord),
      skapad: new Date().toISOString(),
    };
    this.spara([...konton, konto]);
    return konto;
  }

  ändra(id: string, ändring: { namn?: string; roll?: Roll; lösenord?: string }): Konto {
    const konton = this.alla();
    const i = konton.findIndex((k) => k.id === id);
    if (i < 0) throw new Kontofel("Kontot finns inte.", 404);
    const k = { ...konton[i] };
    if (ändring.namn !== undefined) k.namn = ändring.namn.trim().slice(0, 120) || k.användarnamn;
    if (ändring.roll !== undefined) {
      const blirAdmin = ändring.roll === "admin";
      if (!blirAdmin && k.roller.includes("admin") && this.antalAdmin(konton) <= 1)
        throw new Kontofel("Det måste finnas minst en administratör.");
      k.roller = blirAdmin ? ["admin", "user"] : ["user"];
    }
    if (ändring.lösenord !== undefined) {
      const fel = prövaLösenord(ändring.lösenord);
      if (fel) throw new Kontofel(fel);
      k.lösenord = hashaLösenord(ändring.lösenord);
    }
    konton[i] = k;
    this.spara(konton);
    return k;
  }

  taBort(id: string): void {
    const konton = this.alla();
    const k = konton.find((x) => x.id === id);
    if (!k) throw new Kontofel("Kontot finns inte.", 404);
    if (k.roller.includes("admin") && this.antalAdmin(konton) <= 1)
      throw new Kontofel("Det måste finnas minst en administratör.");
    this.spara(konton.filter((x) => x.id !== id));
  }

  private antalAdmin(konton: Konto[]): number {
    return konton.filter((k) => k.roller.includes("admin")).length;
  }
}

/**
 * Spärr mot gissade lösenord: efter fem misslyckade försök på ett namn eller
 * från en adress väntar man en minut, sedan längre för varje nytt misslyckande.
 * I minnet – en omstart nollställer, vilket är godtagbart för en spärr.
 */
export class Inloggningsspärr {
  private försök = new Map<string, { antal: number; till: number }>();

  spärradTill(nycklar: string[], nu = Date.now()): number {
    return Math.max(0, ...nycklar.map((n) => this.försök.get(n)?.till ?? 0)) > nu
      ? Math.max(...nycklar.map((n) => this.försök.get(n)?.till ?? 0))
      : 0;
  }

  misslyckat(nycklar: string[], nu = Date.now()): void {
    for (const n of nycklar) {
      const f = this.försök.get(n) ?? { antal: 0, till: 0 };
      f.antal += 1;
      if (f.antal >= 5) f.till = nu + 60_000 * 2 ** Math.min(f.antal - 5, 6);
      this.försök.set(n, f);
    }
  }

  lyckat(nycklar: string[]): void {
    for (const n of nycklar) this.försök.delete(n);
  }
}
