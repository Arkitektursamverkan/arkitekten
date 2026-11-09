/**
 * Inloggningen – Entra ID (OpenID Connect, auktoriseringskod + PKCE).
 *
 * Bryggan (server/brygga.ts) är Arkitektens enda väg till innehållet, och
 * det är därför DÄR inloggningen sitter: webbläsaren får en sessionskaka, och
 * varje `/__ark/*`-anrop prövas mot reglerna i src/core/behorighet.ts. Appen
 * gömmer knappar efter samma regler, men det är servern som säger nej.
 *
 * Inga beroenden. Sessionen är en HMAC-signerad kaka (ingen sessionstabell som
 * töms när tjänsten startas om), och id-token hämtas direkt från Entras
 * token-slutpunkt över TLS med klienthemligheten – då räcker det enligt OIDC
 * Core 3.1.3.7 att pröva utfärdare, mottagare, giltighetstid och nonce; någon
 * signaturkontroll mot nyckelservern behövs inte för en token man själv hämtat.
 *
 * Konfigurationen läses ur miljön (server/installningar.ts). Se docs/inloggning.md för uppsättningen i Entra.
 */

import crypto from "node:crypto";
import {
  LOKAL_ANVÄNDARE,
  type Användare,
  type Inloggningsläge,
  type Roll,
} from "../src/core/behorighet";

export interface EntraKonfig {
  läge: "entra";
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Appens publika adress, t.ex. https://arkitekten.example.org – redirect-URI:n byggs av den. */
  basUrl: string;
  /** Approllernas värden i Entra som ger admin. */
  adminRoller: string[];
  /** Entra-grupper (objekt-id) vars medlemmar är admin – kräver gruppanspråk i app-registreringen. */
  adminGrupper: string[];
  /** Reserv: e-post eller oid som alltid är admin (första uppsättningen, innan rollerna tilldelats). */
  adminKonton: string[];
}

export type AuthKonfig =
  | EntraKonfig
  | { läge: "lokal"; basUrl: string }
  | { läge: "dev"; basUrl?: string }
  | { läge: "öppen" };

export const SESSION_KAKA = "ark_session";
const OIDC_KAKA = "ark_oidc";
/** En arbetsdag. Entra loggar in tyst igen så länge kontots egen session lever. */
export const SESSION_SEKUNDER = 10 * 60 * 60;

const lista = (s: string | undefined) =>
  (s ?? "")
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

/**
 * Läget ur miljön. Entra kräver alla tre uppgifterna – saknas någon faller vi
 * INTE tyst tillbaka till öppen drift när ARK_AUTH=entra är satt, för då hade
 * en felskriven nyckel öppnat allt för alla. Då vägras inloggning i stället.
 */
export function authKonfigUrMiljö(env: NodeJS.ProcessEnv = process.env): AuthKonfig {
  const tenantId = env.ENTRA_TENANT_ID?.trim() ?? "";
  const clientId = env.ENTRA_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.ENTRA_CLIENT_SECRET?.trim() ?? "";
  const begärt = env.ARK_AUTH?.trim().toLowerCase();
  if (begärt === "dev") return { läge: "dev", basUrl: env.ARK_BAS_URL?.trim() };
  // auto: Entra när alla uppgifterna finns, annars egna konton – aldrig öppen
  // drift. För installationer där Entra är valfritt (Render-blueprinten).
  const allaEntra = Boolean(tenantId && clientId && clientSecret);
  if (begärt === "auto" && !allaEntra) return { läge: "lokal", basUrl: (env.ARK_BAS_URL?.trim() ?? "").replace(/\/+$/, "") };
  if (begärt === "lokal") return { läge: "lokal", basUrl: (env.ARK_BAS_URL?.trim() ?? "").replace(/\/+$/, "") };
  if (begärt === "entra" || allaEntra) {
    return {
      läge: "entra",
      tenantId,
      clientId,
      clientSecret,
      // Ingen standard: adressen är installationens egen (redirect-URI:n byggs av den).
      basUrl: (env.ARK_BAS_URL?.trim() ?? "").replace(/\/+$/, ""),
      adminRoller: lista(env.ENTRA_ADMIN_ROLLER || "Arkitekten.Admin,Admin"),
      adminGrupper: lista(env.ENTRA_ADMIN_GRUPPER),
      // Samma lista som portalen och plattformen duger, när ARK_ADMINS inte är satt.
      adminKonton: lista(env.ARK_ADMINS || env.BOOTSTRAP_ADMIN_EMAILS),
    };
  }
  return { läge: "öppen" };
}

/** Saknade uppgifter för Entra – tom lista = komplett. */
export function saknasFörEntra(k: EntraKonfig): string[] {
  const ut: string[] = [];
  if (!k.tenantId) ut.push("ENTRA_TENANT_ID");
  if (!k.clientId) ut.push("ENTRA_CLIENT_ID");
  if (!k.clientSecret) ut.push("ENTRA_CLIENT_SECRET");
  if (!k.basUrl) ut.push("ARK_BAS_URL");
  return ut;
}

export function redirectUri(k: { basUrl: string }): string {
  return `${k.basUrl}/__ark/auth/callback`;
}

/* ------------------------------------------------------------------ */
/* Signerade kakor                                                      */
/* ------------------------------------------------------------------ */

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signera(data: unknown, hemlighet: string): string {
  const kropp = b64(JSON.stringify(data));
  const mac = crypto.createHmac("sha256", hemlighet).update(kropp).digest("base64url");
  return `${kropp}.${mac}`;
}

/** Innehållet om signaturen stämmer, annars null. Jämförelsen är tidskonstant. */
export function verifiera<T>(värde: string | undefined, hemlighet: string): T | null {
  if (!värde) return null;
  const [kropp, mac] = värde.split(".");
  if (!kropp || !mac) return null;
  const väntad = crypto.createHmac("sha256", hemlighet).update(kropp).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== väntad.length || !crypto.timingSafeEqual(given, väntad)) return null;
  try {
    return JSON.parse(Buffer.from(kropp, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function läsKakor(header: string | undefined): Record<string, string> {
  const ut: Record<string, string> = {};
  for (const del of (header ?? "").split(";")) {
    const i = del.indexOf("=");
    if (i > 0) ut[del.slice(0, i).trim()] = decodeURIComponent(del.slice(i + 1).trim());
  }
  return ut;
}

export function kaka(
  namn: string,
  värde: string,
  { maxÅlder, säker }: { maxÅlder: number; säker: boolean },
): string {
  return [
    `${namn}=${encodeURIComponent(värde)}`,
    "Path=/",
    "HttpOnly",
    // Lax: kakan måste följa med när Entra skickar tillbaka webbläsaren.
    "SameSite=Lax",
    `Max-Age=${maxÅlder}`,
    ...(säker ? ["Secure"] : []),
  ].join("; ");
}

interface Session {
  användare: Användare;
  /** Utgång, sekunder sedan epoken. */
  exp: number;
}

export function skapaSession(u: Användare, hemlighet: string, nu = Date.now()): string {
  return signera({ användare: u, exp: Math.floor(nu / 1000) + SESSION_SEKUNDER } satisfies Session, hemlighet);
}

export function läsSession(kakhuvud: string | undefined, hemlighet: string, nu = Date.now()): Användare | null {
  const s = verifiera<Session>(läsKakor(kakhuvud)[SESSION_KAKA], hemlighet);
  if (!s || typeof s.exp !== "number" || s.exp * 1000 < nu) return null;
  return s.användare ?? null;
}

/* ------------------------------------------------------------------ */
/* OIDC                                                                 */
/* ------------------------------------------------------------------ */

interface OidcFärd {
  state: string;
  nonce: string;
  verifier: string;
  /** Vart man ska tillbaka efter inloggningen (bara en lokal väg). */
  tillbaka: string;
  exp: number;
}

const slump = () => crypto.randomBytes(24).toString("base64url");

/** Bara en väg inom appen – aldrig en annan värd (öppen omdirigering). */
export function säkerTillbaka(t: string | null | undefined): string {
  return t && t.startsWith("/") && !t.startsWith("//") ? t : "/";
}

/** Påbörjar inloggningen: adressen till Entra och kakan som minns färden. */
export function påbörjaInloggning(
  k: EntraKonfig,
  hemlighet: string,
  tillbaka: string,
  nu = Date.now(),
): { url: string; kaka: string } {
  const färd: OidcFärd = {
    state: slump(),
    nonce: slump(),
    verifier: slump() + slump(),
    tillbaka: säkerTillbaka(tillbaka),
    exp: Math.floor(nu / 1000) + 10 * 60,
  };
  const challenge = crypto.createHash("sha256").update(färd.verifier).digest("base64url");
  const q = new URLSearchParams({
    client_id: k.clientId,
    response_type: "code",
    redirect_uri: redirectUri(k),
    response_mode: "query",
    scope: "openid profile email",
    state: färd.state,
    nonce: färd.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return {
    url: `https://login.microsoftonline.com/${encodeURIComponent(k.tenantId)}/oauth2/v2.0/authorize?${q}`,
    kaka: kaka(OIDC_KAKA, signera(färd, hemlighet), {
      maxÅlder: 600,
      säker: k.basUrl.startsWith("https:"),
    }),
  };
}

/** Kakan som tar bort färden när den är använd. */
export function rensaOidcKaka(säker: boolean): string {
  return kaka(OIDC_KAKA, "", { maxÅlder: 0, säker });
}

export interface IdClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
  nonce?: string;
  tid?: string;
  oid?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  roles?: string[];
  /** Gruppernas objekt-id – bara om app-registreringen skickar gruppanspråk. */
  groups?: string[];
}

/** Läser nyttolasten ur en JWT utan att pröva signaturen (se modulkommentaren). */
export function jwtNyttolast(jwt: string): IdClaims {
  const del = jwt.split(".")[1];
  if (!del) throw new Error("Ogiltig id-token.");
  return JSON.parse(Buffer.from(del, "base64url").toString("utf8"));
}

/**
 * Prövar id-token och gör den till en användare. Kastar med ett begripligt
 * meddelande – det är det som visas om inloggningen misslyckas.
 */
export function användareUrIdToken(
  k: EntraKonfig,
  c: IdClaims,
  nonce: string,
  nu = Date.now(),
): Användare {
  const sek = Math.floor(nu / 1000);
  const marginal = 300;
  if (c.iss !== `https://login.microsoftonline.com/${k.tenantId}/v2.0`)
    throw new Error("Id-token kommer från fel utfärdare (fel tenant?).");
  if (c.aud !== k.clientId) throw new Error("Id-token är utfärdad till en annan app.");
  if (typeof c.exp !== "number" || c.exp + marginal < sek) throw new Error("Id-token har gått ut.");
  if (typeof c.nbf === "number" && c.nbf - marginal > sek) throw new Error("Id-token gäller inte än.");
  if (!c.nonce || c.nonce !== nonce) throw new Error("Id-token hör inte till den här inloggningen.");
  if (!c.oid) throw new Error("Id-token saknar konto-id (oid).");
  const epost = (c.preferred_username || c.email || "").trim();
  return {
    id: c.oid,
    namn: c.name?.trim() || epost || "Okänd",
    epost: epost || undefined,
    roller: rollerFör(k, c.roles ?? [], [c.oid, epost], c.groups ?? []),
  };
}

/**
 * Entras approller och grupper → Arkitektens roller. Alla inloggade är minst
 * "user". Vilka roller och grupper som ger admin är installationens val
 * (ENTRA_ADMIN_ROLLER, ENTRA_ADMIN_GRUPPER) – med en gemensam app för portal
 * och Arkitekten är det portalens egna approller som anges här.
 */
export function rollerFör(
  k: Pick<EntraKonfig, "adminRoller" | "adminKonton"> & Partial<Pick<EntraKonfig, "adminGrupper">>,
  entraRoller: string[],
  konto: string[],
  grupper: string[] = [],
): Roll[] {
  const roller = entraRoller.map((r) => r.toLowerCase());
  const admin =
    roller.some((r) => k.adminRoller.includes(r)) ||
    grupper.some((g) => (k.adminGrupper ?? []).includes(g.toLowerCase())) ||
    konto.some((x) => x && k.adminKonton.includes(x.toLowerCase()));
  return admin ? ["admin", "user"] : ["user"];
}

/**
 * Avslutar inloggningen: prövar state mot kakan, växlar koden mot en id-token
 * och ger användaren och vart hen ska tillbaka. `hämta` injiceras för test.
 */
export async function avslutaInloggning(
  k: EntraKonfig,
  hemlighet: string,
  kakhuvud: string | undefined,
  fråga: URLSearchParams,
  hämta: typeof fetch = fetch,
  nu = Date.now(),
): Promise<{ användare: Användare; tillbaka: string }> {
  const fel = fråga.get("error");
  if (fel) throw new Error(`Entra svarade: ${fråga.get("error_description") || fel}`);
  const färd = verifiera<OidcFärd>(läsKakor(kakhuvud)[OIDC_KAKA], hemlighet);
  if (!färd || färd.exp * 1000 < nu) throw new Error("Inloggningen tog för lång tid – försök igen.");
  if (fråga.get("state") !== färd.state) throw new Error("Inloggningen hör inte till den här webbläsaren.");
  const kod = fråga.get("code");
  if (!kod) throw new Error("Entra skickade ingen kod.");

  const svar = await hämta(
    `https://login.microsoftonline.com/${encodeURIComponent(k.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: k.clientId,
        client_secret: k.clientSecret,
        grant_type: "authorization_code",
        code: kod,
        redirect_uri: redirectUri(k),
        code_verifier: färd.verifier,
        scope: "openid profile email",
      }),
    },
  );
  const kropp = (await svar.json().catch(() => ({}))) as { id_token?: string; error_description?: string };
  if (!svar.ok || !kropp.id_token)
    throw new Error(`Kunde inte hämta token: ${kropp.error_description ?? svar.status}`);
  return {
    användare: användareUrIdToken(k, jwtNyttolast(kropp.id_token), färd.nonce, nu),
    tillbaka: färd.tillbaka,
  };
}

/** Entras utloggning – avslutar också kontots session hos Microsoft. */
export function utloggningsUrl(k: EntraKonfig): string {
  const q = new URLSearchParams({ post_logout_redirect_uri: `${k.basUrl}/` });
  return `https://login.microsoftonline.com/${encodeURIComponent(k.tenantId)}/oauth2/v2.0/logout?${q}`;
}

/** Provinloggningens användare. Id:t härleds ur namnet så att samma namn äger samma processer. */
export function devAnvändare(namn: string, roll: string): Användare {
  const n = namn.trim() || "Testanvändare";
  const id = "dev-" + n.toLowerCase().replace(/[^a-z0-9åäö]+/g, "-").replace(/^-|-$/g, "");
  return { id, namn: n, roller: roll === "admin" ? ["admin", "user"] : ["user"] };
}

/** Användaren i öppen drift – samma som före inloggningen fanns. */
export function öppenAnvändare(): Användare {
  return LOKAL_ANVÄNDARE;
}

export type { Inloggningsläge };
