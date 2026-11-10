/**
 * INSTALLATIONEN SOM PORTALEN KÄNNER DEN – Arkitekten anmäler sin adress och
 * hämtar det portalen vet om installationen (`GET /installation`,
 * `PUT /installation/arkitekten` i portalens API).
 *
 * Gäller bara när portalen är kopplad (`EA_API_KEY`, `EA_API_URL`). Tre saker:
 *   1. ANMÄLAN: appens publika adress (`basUrlUrMiljö`) skickas till portalen
 *      vid start, i bakgrunden med omförsök. Tom adress = ingen anmälan.
 *   2. ENTRA: med `ARK_AUTH=auto` och någon av ENTRA_TENANT_ID/CLIENT_ID/
 *      CLIENT_SECRET tom i miljön hämtas portalens Entra-uppgifter FÖRE
 *      inloggningens konfiguration läses (`authKonfigUrMiljö`). Starten väntar
 *      upp till `VÄNTA_VID_START_MS` med omförsök. Senaste svaret sparas i
 *      `<ARK_DIR>/installation.json` (läge 0600) och används när portalen inte
 *      svarar; utan fil blir det egna konton med en varning i loggen. Ett svar
 *      med `entra: null` betyder egna konton.
 *   3. WEBBADRESSEN: `EA_WEBB_URL`, annars portalens `portal_url`, som sparas
 *      en stund (`TTL_MS`) som utseendet (server/utseende.ts).
 *
 * MILJÖN VINNER ALLTID: portalens värden fyller bara det som är tomt. Uppgifterna
 * läses vid start – byts Entra i portalen måste Arkitekten startas om.
 * Hemligheten skrivs aldrig i loggen, och flödestjänstens barnprocess får den
 * inte (server/flodestjanst-barn.ts tar bara det den läser).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { basUrlUrMiljö } from "./auth";
import { eaKonfigUrMiljö, type EaKonfig } from "./ea-portal";

export interface PortalensEntra {
  tenant_id: string;
  client_id: string;
  client_secret?: string;
  bootstrap_admin_emails: string[];
}

export interface Installationssvar {
  portal_url: string | null;
  arkitekten_url: string | null;
  entra: PortalensEntra | null;
}

export interface Logg {
  info(rad: string): void;
  warn(rad: string): void;
}

export const CACHEFIL = "installation.json";
/** Så länge starten väntar på portalen när Entra-uppgifterna ska hämtas därifrån. */
export const VÄNTA_VID_START_MS = 2 * 60 * 1000;
/** Mellan försöken medan starten väntar. */
const FÖRSÖK_VID_START_MS = 5 * 1000;
/** Ett enskilt anrop får ta så här lång tid. */
const ANROP_MS = 10 * 1000;
/** Webbadressen sparas så här länge (som utseendet). */
const TTL_MS = 5 * 60 * 1000;
/** Anmälans omförsök: första väntan, fördubblas upp till taket. */
const ANMÄLAN_FÖRSTA_MS = 5 * 1000;
const ANMÄLAN_TAK_MS = 5 * 60 * 1000;

const sträng = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const adress = (v: unknown): string | null => {
  const s = sträng(v).replace(/\/+$/, "");
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
};

/** Portalens svar i en form vi litar på – allt okänt eller felaktigt faller bort. */
export function tolkaSvar(rå: unknown): Installationssvar {
  const o = (rå && typeof rå === "object" ? rå : {}) as Record<string, unknown>;
  const e = o.entra && typeof o.entra === "object" ? (o.entra as Record<string, unknown>) : null;
  const tenant = sträng(e?.tenant_id);
  const klient = sträng(e?.client_id);
  const entra: PortalensEntra | null =
    e && tenant && klient
      ? {
          tenant_id: tenant,
          client_id: klient,
          ...(sträng(e.client_secret) ? { client_secret: sträng(e.client_secret) } : {}),
          bootstrap_admin_emails: Array.isArray(e.bootstrap_admin_emails)
            ? e.bootstrap_admin_emails.map(sträng).filter(Boolean)
            : [],
        }
      : null;
  return { portal_url: adress(o.portal_url), arkitekten_url: adress(o.arkitekten_url), entra };
}

/** Ett fel som inte blir bättre av ett nytt försök (fel nyckel, äldre portal utan vägen). */
class BeståendeFel extends Error {}

async function anrop(k: EaKonfig, väg: string, init: RequestInit = {}): Promise<Installationssvar> {
  const f = k.fetch ?? fetch;
  const res = await f(`${k.url}${väg}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": k.nyckel },
    // Adressen är installatörens, men en omdirigering följs ändå aldrig – då
    // hade nyckeln kunnat skickas vidare till någon annan.
    redirect: "error",
    signal: AbortSignal.timeout(ANROP_MS),
  });
  if (!res.ok) {
    const meddelande = `portalen svarade ${res.status} på ${väg}`;
    // 4xx utom 408/429: fel nyckel eller en portal som saknar vägen.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
      throw new BeståendeFel(meddelande);
    throw new Error(meddelande);
  }
  return tolkaSvar(await res.json());
}

export const hämtaInstallation = (k: EaKonfig) => anrop(k, "/installation");

export const anmälAdress = (k: EaKonfig, url: string) =>
  anrop(k, "/installation/arkitekten", { method: "PUT", body: JSON.stringify({ url }) });

/* ------------------------------------------------------------------ */
/* Cachefilen                                                           */
/* ------------------------------------------------------------------ */

export const cacheFil = (arkDir: string) => path.join(arkDir, CACHEFIL);

/** Senaste sparade svar, eller null. */
export function läsCache(arkDir: string): Installationssvar | null {
  try {
    return tolkaSvar(JSON.parse(fs.readFileSync(cacheFil(arkDir), "utf8")));
  } catch {
    return null;
  }
}

/** Sparar svaret med läge 0600 – det kan bära klienthemligheten. */
export function sparaCache(arkDir: string, svar: Installationssvar): void {
  fs.mkdirSync(arkDir, { recursive: true });
  const fil = cacheFil(arkDir);
  const tmp = `${fil}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(svar, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, fil);
}

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

const ENTRA_NAMN = ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET"] as const;

/** Ska Entra-uppgifterna hämtas ur portalen? Bara med auto och när något saknas. */
export function behöverPortalensEntra(env: NodeJS.ProcessEnv): boolean {
  return env.ARK_AUTH?.trim().toLowerCase() === "auto" && ENTRA_NAMN.some((n) => !env[n]?.trim());
}

/**
 * Fyller de Entra-fält som är TOMMA i miljön ur portalens svar. Returnerar
 * namnen som fylldes (aldrig värdena). En portal utan klienthemlighet ger inget
 * Entra-läge – auto blir då egna konton.
 */
export function fyllEntra(env: NodeJS.ProcessEnv, entra: PortalensEntra | null): string[] {
  if (!entra) return [];
  const värden: Record<(typeof ENTRA_NAMN)[number], string | undefined> = {
    ENTRA_TENANT_ID: entra.tenant_id,
    ENTRA_CLIENT_ID: entra.client_id,
    ENTRA_CLIENT_SECRET: entra.client_secret,
  };
  const fyllda: string[] = [];
  for (const n of ENTRA_NAMN) {
    const v = värden[n];
    if (!env[n]?.trim() && v) {
      env[n] = v;
      fyllda.push(n);
    }
  }
  if (!env.ARK_ADMINS?.trim() && !env.BOOTSTRAP_ADMIN_EMAILS?.trim() && entra.bootstrap_admin_emails.length) {
    env.BOOTSTRAP_ADMIN_EMAILS = entra.bootstrap_admin_emails.join(",");
    fyllda.push("BOOTSTRAP_ADMIN_EMAILS");
  }
  return fyllda;
}

export interface StartOptioner {
  env?: NodeJS.ProcessEnv;
  arkDir: string;
  logg: Logg;
  /** Utbytbar i tester. */
  fetch?: typeof fetch;
  väntaMs?: number;
  försökMs?: number;
  sov?: (ms: number) => Promise<void>;
  nu?: () => number;
  /** Anmälans omförsök i bakgrunden (utbytbar i tester). */
  schemalägg?: (fn: () => void, ms: number) => void;
}

const sovNormalt = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const schemaläggNormalt = (fn: () => void, ms: number) => {
  // Håller inte processen vid liv (tester, ett skript som avslutas).
  setTimeout(fn, ms).unref?.();
};

const felText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Anmäler basadressen i bakgrunden: försöker tills det lyckas, med växande
 * väntan (taket 5 min). Ett bestående fel (fel nyckel, äldre portal) stoppar
 * försöken. Returnerar ett löfte som löses när försöken är slut (för tester).
 */
export function anmälIBakgrunden(o: StartOptioner): Promise<boolean> {
  const env = o.env ?? process.env;
  const ea = eaKonfigUrMiljö(env);
  const url = basUrlUrMiljö(env);
  if (!ea || !url) return Promise.resolve(false);
  const k: EaKonfig = { ...ea, fetch: o.fetch };
  const schemalägg = o.schemalägg ?? schemaläggNormalt;
  return new Promise((klar) => {
    const försök = (väntan: number) => {
      anmälAdress(k, url).then(
        (svar) => {
          o.logg.info(`[arkitekten] Adressen är anmäld i portalen.`);
          if (env.ARK_AUTH?.trim().toLowerCase() === "auto") {
            try {
              sparaCache(o.arkDir, svar);
            } catch {
              /* filen är en reserv – anmälan lyckades ändå */
            }
          }
          klar(true);
        },
        (e) => {
          if (e instanceof BeståendeFel) {
            o.logg.info(`[arkitekten] Adressen anmäls inte i portalen (${felText(e)}).`);
            klar(false);
            return;
          }
          schemalägg(() => försök(Math.min(väntan * 2, ANMÄLAN_TAK_MS)), väntan);
        },
      );
    };
    försök(ANMÄLAN_FÖRSTA_MS);
  });
}

export interface Startresultat {
  /** Varifrån Entra-uppgifterna kom, om de hämtades. */
  källa: "miljön" | "portalen" | "filen" | "ingen";
  /** Portalens webbadress, om den är känd. */
  portalUrl: string | null;
}

/**
 * Körs av båda värdarna (server/arkitekten.mts, scripts/ark-bridge.ts) FÖRE
 * `kontrollera` och `skapaBrygga`. Startar anmälan i bakgrunden och – när
 * Entra ska komma ur portalen – väntar på portalens svar och fyller miljön.
 */
export async function förberedInstallation(o: StartOptioner): Promise<Startresultat> {
  const env = o.env ?? process.env;
  const ea = eaKonfigUrMiljö(env);
  if (!ea) return { källa: "ingen", portalUrl: null };
  void anmälIBakgrunden(o);
  if (!behöverPortalensEntra(env)) return { källa: "miljön", portalUrl: läsCache(o.arkDir)?.portal_url ?? null };

  const k: EaKonfig = { ...ea, fetch: o.fetch };
  const nu = o.nu ?? Date.now;
  const sov = o.sov ?? sovNormalt;
  const slut = nu() + (o.väntaMs ?? VÄNTA_VID_START_MS);
  const mellan = o.försökMs ?? FÖRSÖK_VID_START_MS;
  let svar: Installationssvar | null = null;
  let senasteFel = "";
  let väntatLogg = false;
  for (;;) {
    try {
      svar = await hämtaInstallation(k);
      break;
    } catch (e) {
      senasteFel = felText(e);
      if (e instanceof BeståendeFel) break;
      const kvar = slut - nu();
      if (kvar <= 0) break;
      if (!väntatLogg) {
        o.logg.info(`[arkitekten] Väntar på portalen för inloggningens uppgifter (högst ${Math.round((slut - nu()) / 1000)} s) …`);
        väntatLogg = true;
      }
      await sov(Math.min(mellan, kvar));
    }
  }

  let källa: Startresultat["källa"] = "portalen";
  if (svar) {
    try {
      sparaCache(o.arkDir, svar);
    } catch (e) {
      o.logg.warn(`[arkitekten] Portalens svar kunde inte sparas i ARK_DIR (${felText(e)}).`);
    }
  } else {
    svar = läsCache(o.arkDir);
    if (!svar) {
      o.logg.warn(
        `[arkitekten] Portalen svarade inte (${senasteFel}) och inget sparat svar finns – inloggningen blir egna konton. Starta om när portalen svarar för att använda Entra ID.`,
      );
      return { källa: "ingen", portalUrl: null };
    }
    källa = "filen";
    o.logg.warn(`[arkitekten] Portalen svarade inte (${senasteFel}) – använder det senast sparade svaret.`);
  }

  if (!svar.entra) {
    o.logg.info("[arkitekten] Portalen har inget Entra ID – inloggningen är egna konton.");
  } else {
    const fyllda = fyllEntra(env, svar.entra);
    if (!svar.entra.client_secret && !env.ENTRA_CLIENT_SECRET?.trim())
      o.logg.warn("[arkitekten] Portalen har Entra ID men ingen ENTRA_CLIENT_SECRET – inloggningen är egna konton.");
    else if (fyllda.length) o.logg.info(`[arkitekten] Ur portalen: ${fyllda.join(", ")}.`);
  }
  return { källa, portalUrl: svar.portal_url };
}

/* ------------------------------------------------------------------ */
/* Portalens webbadress (`/__ark/ea/status`)                            */
/* ------------------------------------------------------------------ */

export interface PortalWebb {
  /** EA_WEBB_URL, annars portalens portal_url – tom sträng när ingen är känd. */
  webb(): Promise<string>;
}

/**
 * Webbadressen. Miljön vinner; annars portalens `portal_url`, läst högst var
 * femte minut. Svarar portalen inte gäller den senast kända (också ur
 * cachefilen) – adressen hindrar aldrig något.
 */
export function skapaPortalWebb(
  env: NodeJS.ProcessEnv,
  portal: EaKonfig | null,
  arkDir: string,
  nu: () => number = Date.now,
): PortalWebb {
  const egen = (env.EA_WEBB_URL?.trim() ?? "").replace(/\/+$/, "");
  let senast: string | null = null;
  let läst: number | null = null;
  let pågår: Promise<string | null> | null = null;
  const reserv = () => senast ?? läsCache(arkDir)?.portal_url ?? null;
  return {
    async webb() {
      if (egen || !portal) return egen;
      if (läst !== null && nu() - läst < TTL_MS) return reserv() ?? "";
      pågår ??= hämtaInstallation(portal)
        .then((s) => {
          senast = s.portal_url ?? senast;
          return reserv();
        })
        .catch(() => reserv())
        .finally(() => {
          läst = nu();
          pågår = null;
        });
      return (await pågår) ?? "";
    },
  };
}
