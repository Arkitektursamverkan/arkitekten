/**
 * Bryggan: appens enda väg till servern (`/__ark/*`) – inloggningen,
 * biblioteket (flöden och ramserier), AI-stödet och publiceringen.
 *
 * EN implementation, TVÅ värdar: den fristående servern
 * (`server/arkitekten.mts`, drift och avbild) och Vite-tillägget
 * (`scripts/ark-bridge.ts`, utveckling) monterar samma `skapaBrygga`. Ingen
 * regel får finnas i bara den ena (invariant 1:s anda).
 *
 * AI-STÖDET har tre lägen, och inget av dem lämnar ut en nyckel:
 *
 *   - "api": `ANTHROPIC_API_KEY` finns i miljön. Servern besvarar varje
 *     begäran med src/tools/flowchart/ai/besvara.ts och lägger svaret i
 *     brevlådan. Nyckeln lämnar aldrig servern.
 *   - "claude-code": UTVECKLARLÄGET (`ARK_UTVECKLARLAGE=1`). Begäran läggs i
 *     brevlådan och besvaras av Claude Code i en terminal på samma maskin:
 *
 *       1. Appen POST:ar sin beskrivning        → <låda>/request.json
 *       2. Claude Code läser den, tolkar, skriver → <låda>/response.json
 *       3. Appen pollar och plockar upp svaret   → mellanlagret fylls
 *
 *     <låda> är användarens egen brevlåda (`<arkDir>/anvandare/<hash>/`, se
 *     server/brevlada.ts) – bara i öppen drift är den `<arkDir>` självt.
 *     `npx tsx scripts/brevlada.mts` listar de väntande begärandena.
 *
 *     Den som svarar kopierar `id` ur request.json till `requestId` i
 *     response.json – korrelationen hindrar att ett sent svar på en avbruten
 *     begäran plockas upp av nästa. Med en nyckel OCH utvecklarläget kan
 *     kostnadsrutan välja den här vägen för en enskild begäran (`via`).
 *   - "av": varken nyckel eller utvecklarläge. AI-knapparna visas inte och
 *     `/request` svarar 503. Allt annat fungerar.
 *
 * `GET /__ark/status` säger vilket läge som gäller.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type * as AiKlient from "../src/tools/flowchart/ai/client";
import type * as AiBesvara from "../src/tools/flowchart/ai/besvara";
// Statusreglerna delas med appen. Modulen är avsiktligt beroendefri (ren TS,
// inget DOM) just för att både bryggan och webbläsaren ska kunna använda den.
import { sammanfattaStatus } from "../src/core/status";
import { skapadTid } from "../src/core/nyhet";
import { inloggningsfelKod } from "../src/core/inloggningsfel";
import {
  arkiveraEgenProcess,
  eaKonfigUrMiljö,
  listaApplikationer,
  listaProcesser,
  skapaProcess,
  synkaFlödesscheman,
  uppdateraEgenProcess,
} from "./ea-portal";
import {
  SESSION_KAKA,
  SESSION_SEKUNDER,
  authKonfigUrMiljö,
  förstaKontoKod,
  rättKod,
  avslutaInloggning,
  devAnvändare,
  kaka,
  läsSession,
  påbörjaInloggning,
  rensaOidcKaka,
  saknasFörEntra,
  skapaSession,
  utloggningsUrl,
  öppenAnvändare,
} from "./auth";
import { bytYta, prövaPublicering, prövaRamserie, prövaSparning } from "./atkomst";
import { läsStilar, valdStil, väljStil } from "./symbolstilar";
import { Inloggningsspärr, Kontofel, Kontolager, somAnvändare, spärrnycklar, utåt } from "./konton";
import { ALLMÄNT_FEL, Användarfel, Kroppsfel } from "./fel";
import { exempelpaket, importera } from "./innehallspaket.mjs";
import { organisation, organisationUrMiljö, sättOrganisation } from "../src/core/organisation";
import { skapaUtseende, type UtseendeKälla } from "./utseende";
import { läsBmtMall } from "./bmt-mall";
import {
  ärAdmin,
  kanLäsa,
  kanTaBort,
  kanTaBortRamserie,
  kanÄndraRamserie,
  type Användare,
  type Yta,
} from "../src/core/behorighet";

// Brevlådornas namn och platser bor i server/brevlada.ts (läses också av skripten).
import { ANVÄNDARLÅDOR, REQUEST, RESPONSE, UNDERLAG, brevlådekatalog } from "./brevlada";
/** Ett underlag som ingen begäran tagit hand om tas bort efter ett dygn. */
const UNDERLAG_LIVSLÄNGD_MS = 24 * 60 * 60 * 1000;
/** Högst så mycket underlag per brevlåda åt gången. */
const UNDERLAG_TAK = 100_000_000;

/** Nyckeln läses vid varje begäran – en omstart av tjänsten räcker för att byta den. */
const apiNyckel = () => process.env.ANTHROPIC_API_KEY?.trim() ?? "";

/** Vem som besvarar AI-begärandena – se filhuvudet. */
export type AiLäge = "api" | "claude-code" | "av";

export function aiLäge(utvecklarläge: boolean): AiLäge {
  if (apiNyckel()) return "api";
  return utvecklarläge ? "claude-code" : "av";
}

/** AI-modulerna. Laddas av värden: Vite genom sin modulgraf, servern med import(). */
export interface AiModuler {
  anthropicFråga: typeof AiKlient.anthropicFråga;
  DEFAULT_MODEL: string;
  besvara: typeof AiBesvara.besvara;
}

export interface Logg {
  info(rad: string): void;
  warn(rad: string): void;
}

export interface BryggOptioner {
  /** Där sökvägarna i en begäran räknas ifrån (underlagen). */
  root: string;
  flowsDir: string;
  ramarDir: string;
  /** Symbolstilarna (server/symbolstilar.ts). */
  stilarDir: string;
  /** Brevlådan och underlagen. */
  arkDir: string;
  /** De lokala kontona (läget "lokal"). */
  kontonFil: string;
  logg: Logg;
  laddaAi: () => Promise<AiModuler>;
  /** Claude Code-brevlådan (`ARK_UTVECKLARLAGE=1`). Av i drift. */
  utvecklarläge: boolean;
  /** Organisationens namn, logotyp och färg (server/utseende.ts). Utbytbar i tester. */
  utseende?: UtseendeKälla;
}

export type Hanterare = (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;

/** Bara enkla, filnamnssäkra id:n släpps igenom (skydd mot path traversal). */
const SAFE_ID = /^[a-z0-9-]{1,64}$/;

/**
 * Läser hela request-bodyn som byten, högst `max`.
 *
 * REGRESSION: läsningen fortsatte efter gränsen – allt lades på hög i minnet
 * och anslutningen stod öppen, så en enda stor POST (även till /auth/*, före
 * inloggningen) kunde äta upp serverns minne. Nu avvisas en för stor
 * `content-length` innan något läses, och en kropp som växer förbi gränsen
 * slutar läsas direkt; hanteraren svarar 413 och stänger anslutningen
 * (`svaraMedFel`).
 */
function läsKropp(req: IncomingMessage, max: number, meddelande: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const angiven = Number(req.headers["content-length"]);
    if (Number.isFinite(angiven) && angiven > max) {
      reject(new Kroppsfel(meddelande));
      return;
    }
    const delar: Buffer[] = [];
    let längd = 0;
    let klar = false;
    const sluta = (fel: Error) => {
      if (klar) return;
      klar = true;
      req.removeListener("data", påData);
      // Inget mer läses; resten av kroppen ligger kvar i nätet tills
      // anslutningen stängs efter svaret.
      req.pause();
      delar.length = 0;
      reject(fel);
    };
    const påData = (chunk: Buffer | string) => {
      const bit = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      längd += bit.length;
      if (längd > max) sluta(new Kroppsfel(meddelande));
      else delar.push(bit);
    };
    req.on("data", påData);
    req.on("end", () => {
      if (klar) return;
      klar = true;
      resolve(Buffer.concat(delar));
    });
    req.on("error", (e) => sluta(e));
    req.on("aborted", () => sluta(new Error("Begäran avbröts.")));
  });
}

/** Läser hela request-bodyn som text (beskrivningar är text, inte filer). */
async function readBody(req: IncomingMessage, max = 1_000_000): Promise<string> {
  return (await läsKropp(req, max, "För stor payload")).toString("utf8");
}

/** Som `readBody`, men för en FIL: byten som de är, med en högre gräns. */
function readBytes(req: IncomingMessage, max = 25_000_000): Promise<Buffer> {
  return läsKropp(req, max, `Filen är för stor (högst ${Math.round(max / 1_000_000)} MB).`);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * ARK_BETRODD_PROXY som ANTAL betrodda proxyer framför appen. "1", "true",
 * "ja" och "on" (de gamla på-värdena) är en proxy; tomt, "0" eller något
 * annat är av.
 */
export function betroddaProxyer(v: string | undefined): number {
  const t = v?.trim().toLowerCase() ?? "";
  if (/^(true|ja|on)$/.test(t)) return 1;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 && n <= 10 ? n : 0;
}

/**
 * Klientens adress. Bakom n betrodda proxyer (ARK_BETRODD_PROXY=n) är det
 * led nummer n RÄKNAT FRÅN HÖGER i X-Forwarded-For: varje proxy lägger till
 * adressen den fick begäran från sist, så de n sista leden är skrivna av
 * proxyer vi litar på. Det som står till vänster om dem kan klienten ha
 * skrivit själv. Annars socketens adress – som bakom en proxy är proxyns.
 *
 * REGRESSION: det FÖRSTA ledet togs, och det skriver klienten själv – en
 * gissare som bytte huvudet vid varje försök slapp inloggningsspärren.
 */
export function klientadress(req: IncomingMessage, proxyer: number | boolean): string {
  const n = typeof proxyer === "boolean" ? (proxyer ? 1 : 0) : proxyer;
  if (n > 0) {
    const xff = req.headers["x-forwarded-for"];
    const led = (Array.isArray(xff) ? xff.join(",") : (xff ?? ""))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const vald = led[led.length - n];
    if (vald) return vald;
  }
  return req.socket.remoteAddress ?? "";
}

/** Vägar som tar emot binärt (inte JSON) – de prövas bara på ursprunget. */
const BINÄRA_VÄGAR = new Set(["/underlag"]);

/** Värden (host:port) ur en adress, eller tomt. */
function värdUr(adress: string | undefined): string {
  try {
    return adress?.trim() ? new URL(adress.trim()).host : "";
  } catch {
    return "";
  }
}

/** Ett huvud som text (första värdet). */
function huvud(req: IncomingMessage, namn: string): string {
  const v = req.headers[namn];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
}

/**
 * CSRF-skyddet – EN plats, så att båda värdarna (servern och Vite) får det.
 * Gäller allt som ändrar något (POST/PUT/PATCH/DELETE under /__ark):
 *
 * - Bär begäran `Origin` ska den vara appens egen (värden i `Host`,
 *   proxyns `X-Forwarded-Host` bakom en betrodd proxy, eller ARK_BAS_URL).
 *   Saknas den gäller `Sec-Fetch-Site`: same-origin eller none.
 * - Kroppen ska vara `application/json` – ett formulär från en annan sida kan
 *   inte skicka det utan att webbläsaren först frågar (CORS). DELETE har
 *   ingen kropp och kan inte skickas av ett formulär. Uppladdningarna
 *   (BINÄRA_VÄGAR) tar binärt och kräver i stället ett ursprung som stämmer.
 *
 * Ger felet i klartext, eller null när begäran får passera.
 */
export function prövaUrsprung(req: IncomingMessage, url: string, egnaVärdar: string[]): string | null {
  const metod = (req.method ?? "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(metod)) return null;
  const origin = huvud(req, "origin");
  const plats = huvud(req, "sec-fetch-site").toLowerCase();
  const värdar = egnaVärdar.map((v) => v.trim().toLowerCase()).filter(Boolean);
  let ursprungStämmer = false;
  if (origin) {
    let värd = "";
    try {
      värd = new URL(origin).host.toLowerCase();
    } catch {
      /* "null" och skräp är inget ursprung */
    }
    if (!värd || !värdar.includes(värd)) return "Begäran kom från en annan webbplats.";
    ursprungStämmer = true;
  } else if (plats) {
    if (plats !== "same-origin" && plats !== "none") return "Begäran kom från en annan webbplats.";
    ursprungStämmer = plats === "same-origin";
  }
  if (BINÄRA_VÄGAR.has(url)) return ursprungStämmer ? null : "Uppladdningen saknar ett ursprung från appen.";
  if (metod === "DELETE") return null;
  if (!/^application\/json\b/i.test(huvud(req, "content-type")))
    return "Begäran måste skickas som JSON (content-type: application/json).";
  return null;
}

/** Nåddes appen över https? Proxyn framför säger det med `x-forwarded-proto`. */
export function viaHttps(req: IncomingMessage): boolean {
  const proto = req.headers["x-forwarded-proto"];
  return (Array.isArray(proto) ? proto[0] : proto)?.split(",")[0]?.trim().toLowerCase() === "https";
}

/**
 * Svaret på ett fel i en begäran. Bara ett `Användarfel` (server/fel.ts) når
 * användaren med sin text; en kropp som inte är JSON får ett eget besked.
 * Allt annat loggas här och blir ett allmänt besked utåt.
 *
 * REGRESSION: felets text gick rakt ut till webbläsaren – ett filsystemsfel
 * bar serverns sökvägar (`ENOENT: … /data/flows/…`).
 */
function svaraMedFel(req: IncomingMessage, res: ServerResponse, err: unknown, log: Logg) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof Kroppsfel) {
    // Resten av en för stor kropp ska inte läsas: anslutningen stängs efter svaret.
    res.setHeader("connection", "close");
    res.on("finish", () => req.destroy());
  }
  if (err instanceof Användarfel) {
    json(res, err.status, { ok: false, error: err.message });
    return;
  }
  if (err instanceof SyntaxError) {
    json(res, 400, { ok: false, error: "Begäran är inte giltig JSON." });
    return;
  }
  log.warn(`  [ark] FEL i ${req.method ?? "?"} ${(req.url ?? "").split("?")[0]}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  json(res, 500, { ok: false, error: ALLMÄNT_FEL });
}

/** Bryggans begärandehanterare, monterad under `/__ark` (`req.url` utan prefixet). */
export function skapaBrygga(o: BryggOptioner): Hanterare {
      // Organisationens namn (portalbanan) gäller också serverns egna tolkningar.
      sättOrganisation(organisationUrMiljö(process.env));
      const { root, flowsDir, ramarDir, logg: log, utvecklarläge } = o;
      const utseende = o.utseende ?? skapaUtseende(process.env, eaKonfigUrMiljö());
      const dir = o.arkDir;
      /** Kort namn i loggen: katalogens sista led. */
      const FLOWS = path.basename(flowsDir);
      const RAMAR = path.basename(ramarDir);

      /* -------------------------------------------------------------- */
      /* Inloggning (server/auth.ts, docs/inloggning.md)                  */
      /* -------------------------------------------------------------- */

      const auth = authKonfigUrMiljö();
      const saknas = auth.läge === "entra" ? saknasFörEntra(auth) : [];
      /**
       * Nyckeln som signerar sessionskakan. Saknas ARK_SESSION_SECRET slumpas
       * en vid start – det fungerar, men alla loggas ut när tjänsten startas om.
       */
      const hemlighet = process.env.ARK_SESSION_SECRET?.trim() || crypto.randomBytes(32).toString("hex");
      /**
       * Kakan får `Secure` när appen nås över https: ARK_BAS_URL säger det,
       * eller proxyn framför (Render och liknande) gör det med
       * `x-forwarded-proto`. REGRESSION: utan ARK_BAS_URL saknade kakan
       * `Secure` även när appen bara nåddes över https.
       */
      const basHttps = (auth.läge === "entra" || auth.läge === "lokal") && auth.basUrl.startsWith("https:");
      const säkerKaka = (req: IncomingMessage) =>
        basHttps || ((auth.läge === "entra" || auth.läge === "lokal") && viaHttps(req));
      /** ARK_BETRODD_PROXY: antal betrodda proxyer – klientens adress tas ur X-Forwarded-For (se `klientadress`). */
      const betroddProxy = betroddaProxyer(process.env.ARK_BETRODD_PROXY);
      const konton = new Kontolager(o.kontonFil);
      const spärr = new Inloggningsspärr();
      if (auth.läge === "entra") {
        log.info(
          saknas.length
            ? `  [ark] Inloggning: Entra ID är påslaget men ${saknas.join(", ")} saknas – ingen kan logga in.`
            : `  [ark] Inloggning: Entra ID (${auth.basUrl}).`,
        );
        if (!process.env.ARK_SESSION_SECRET?.trim())
          log.warn("  [ark] ARK_SESSION_SECRET saknas – sessionerna överlever inte en omstart.");
      } else if (auth.läge === "dev") {
        log.warn("  [ark] Inloggning: PROVLÄGE (ARK_AUTH=dev) – vem som helst väljer namn och roll.");
      }

      /** Den inloggade, eller null. I öppen drift är alla den lokala administratören. */
      const vem = (req: IncomingMessage): Användare | null => {
        if (auth.läge === "öppen") return öppenAnvändare();
        const u = läsSession(req.headers.cookie, hemlighet);
        // Ett lokalt konto läses om: ett borttaget konto är utloggat direkt,
        // och en ändrad roll gäller från nästa begäran – inte först vid nästa inloggning.
        if (u && auth.läge === "lokal") {
          const k = konton.hämta(u.id);
          return k ? somAnvändare(k) : null;
        }
        return u;
      };
      const loggaIn = (req: IncomingMessage, res: ServerResponse, u: Användare) =>
        res.setHeader("set-cookie", kaka(SESSION_KAKA, skapaSession(u, hemlighet), { maxÅlder: SESSION_SEKUNDER, säker: säkerKaka(req) }));

      const omdirigera = (res: ServerResponse, till: string, kakor: string[] = []) => {
        res.statusCode = 302;
        if (kakor.length) res.setHeader("set-cookie", kakor);
        res.setHeader("location", till);
        res.end();
      };

      /** Läser en fil i biblioteket, eller null om den inte finns. */
      const läsJson = (fil: string): Record<string, any> | null =>
        fs.existsSync(fil) ? JSON.parse(fs.readFileSync(fil, "utf8")) : null;

      /** Id:n (filnamn utan .json) i en katalog – de upptagna, för presentationens nya poster. */
      const idnI = (kat: string) =>
        fs.existsSync(kat) ? fs.readdirSync(kat).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];

      /**
       * BREVLÅDAN – en per användare.
       *
       * REGRESSION: alla delade en brevlåda. Vilken inloggad som helst kunde
       * hämta en annans svar med GET /response, avbryta en annans begäran,
       * och läsa en annans uppladdade underlag genom en begäran som pekade ut
       * det. Nu har varje användare en egen katalog (nycklad på en hash av
       * id:t – inget namn i filsystemet), och begäran, svaret och underlagen
       * hör till den som är inloggad.
       *
       * Det gäller ÄVEN UTVECKLARLÄGET när inloggning är på (entra/lokal/dev):
       * Claude Code hittar begäran i användarens låda (server/brevlada.ts,
       * `scripts/brevlada.mts`) och svarar i samma katalog. REGRESSION: i
       * utvecklarläget delade alla inloggade EN låda – den som installerat
       * med ARK_UTVECKLARLAGE=1 i drift fick tillbaka felet ovan. Bara ÖPPEN
       * drift, där alla är samma användare, har kvar EN brevlåda direkt i
       * `arkDir` (`.ark/request.json`).
       */
      interface Brevlåda {
        nyckel: string;
        katalog: string;
        request: string;
        response: string;
        underlag: string;
      }
      const delad = auth.läge === "öppen";
      const brevlåda = (u: Användare): Brevlåda => {
        const { nyckel, katalog } = brevlådekatalog(dir, delad ? null : u.id);
        return {
          nyckel,
          katalog,
          request: path.join(katalog, REQUEST),
          response: path.join(katalog, RESPONSE),
          underlag: path.join(katalog, UNDERLAG),
        };
      };
      const läsBegäran = (låda: Brevlåda): { id?: string; rawText?: string } | null => {
        try {
          return fs.existsSync(låda.request) ? JSON.parse(fs.readFileSync(låda.request, "utf8")) : null;
        } catch {
          return null;
        }
      };

      /** Underlagskatalogerna i alla brevlådor. */
      const allaUnderlag = (): string[] => {
        const ut = [path.join(dir, UNDERLAG)];
        const per = path.join(dir, ANVÄNDARLÅDOR);
        if (fs.existsSync(per))
          for (const n of fs.readdirSync(per)) ut.push(path.join(per, n, UNDERLAG));
        return ut.filter((k) => fs.existsSync(k));
      };
      /** Tar bort underlag äldre än ett dygn – i ALLA brevlådor. */
      const gallraUnderlag = (nu = Date.now()) => {
        for (const kat of allaUnderlag())
          for (const f of fs.readdirSync(kat)) {
            const fil = path.join(kat, f);
            try {
              if (nu - fs.statSync(fil).mtimeMs > UNDERLAG_LIVSLÄNGD_MS) fs.rmSync(fil, { force: true });
            } catch {
              /* borttagen under tiden */
            }
          }
      };
      /** Tar bort de underlag som en begäran pekar ut – svaret är skrivet, de behövs inte mer. */
      const rensaUnderlagFör = (låda: Brevlåda, begäran: { rawText?: unknown } | null) => {
        const text = typeof begäran?.rawText === "string" ? begäran.rawText : "";
        if (!text || !fs.existsSync(låda.underlag)) return;
        for (const f of fs.readdirSync(låda.underlag))
          if (text.includes(f)) fs.rmSync(path.join(låda.underlag, f), { force: true });
      };
      const underlagStorlek = (låda: Brevlåda) =>
        fs.existsSync(låda.underlag)
          ? fs.readdirSync(låda.underlag).reduce((sum, f) => {
              try {
                return sum + fs.statSync(path.join(låda.underlag, f)).size;
              } catch {
                return sum;
              }
            }, 0)
          : 0;

      /** Begäran som servern just nu besvarar med API:t – en i taget per brevlåda. */
      const pågående = new Map<string, { id: string; ctrl: AbortController }>();

      /**
       * Besvarar begäran med API:t och lägger svaret i brevlådan. Svaret skrivs
       * bara om begäran fortfarande är den som väntar och ingen annan (Claude
       * Code) hunnit svara – en avbruten eller ersatt begäran får inget svar.
       */
      const svaraMedApi = async (begäran: AiBesvara.ArkBegäran & { id: string }, låda: Brevlåda) => {
        pågående.get(låda.nyckel)?.ctrl.abort();
        const ctrl = new AbortController();
        pågående.set(låda.nyckel, { id: begäran.id, ctrl });
        const logg = (rad: string) => log.info(`  [ark-ai] ${begäran.id}: ${rad}`);
        const start = Date.now();
        let svar: Record<string, unknown>;
        try {
          const ai = await o.laddaAi();
          logg(`besvarar "${String(begäran.uppdrag)}" med ${process.env.ARK_AI_MODELL || ai.DEFAULT_MODEL}`);
          svar = await ai.besvara(begäran, {
            fråga: ai.anthropicFråga({
              apiKey: apiNyckel(),
              model: process.env.ARK_AI_MODELL,
              workspaceId: process.env.ANTHROPIC_WORKSPACE_ID,
            }),
            signal: ctrl.signal,
            läsUnderlag: async (sökväg: string) => {
              // Bara uppladdade underlag – sökvägen kommer ur begäran.
              // Bara den egna brevlådans: en begäran kan inte peka ut någon annans underlag.
              const fil = path.resolve(root, sökväg);
              if (!fil.startsWith(låda.underlag + path.sep)) throw new Användarfel("Underlaget ligger utanför brevlådan.");
              try {
                return new Uint8Array(fs.readFileSync(fil));
              } catch {
                // Felet bär sökvägen – den ska inte ut i svaret.
                throw new Användarfel("Underlaget finns inte längre – ladda upp filen igen.");
              }
            },
            upptagna: () => ({ serier: idnI(ramarDir), flöden: idnI(flowsDir) }),
            logg,
          });
        } catch (err) {
          if (ctrl.signal.aborted) {
            logg("avbruten");
            return;
          }
          svar = { fel: err instanceof Error ? err.message : String(err) };
        }
        if (pågående.get(låda.nyckel)?.id === begäran.id) pågående.delete(låda.nyckel);
        const väntande = läsBegäran(låda)?.id ?? null;
        if (väntande !== begäran.id || fs.existsSync(låda.response)) {
          logg("begäran väntar inte längre – svaret kastas");
          return;
        }
        fs.writeFileSync(låda.response, JSON.stringify({ ...svar, requestId: begäran.id }, null, 2), "utf8");
        rensaUnderlagFör(låda, begäran);
        const sek = Math.round((Date.now() - start) / 1000);
        if (svar.fel) log.warn(`  [ark-ai] ${begäran.id}: FEL efter ${sek} s – ${String(svar.fel)}`);
        else logg(`svar skrivet efter ${sek} s`);
      };

      /** Läser alla sparade flöden, nyast först. Trasiga filer hoppas över. */
      const listFlows = (u: Användare) => {
        if (!fs.existsSync(flowsDir)) return [];
        return fs
          .readdirSync(flowsDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => {
            try {
              const flow = JSON.parse(fs.readFileSync(path.join(flowsDir, f), "utf8"));
              return {
                id: flow.id,
                name: flow.name,
                savedAt: flow.savedAt,
                // När processen lades upp – samma funktion som webbläsarlagringen.
                skapad: skapadTid(flow),
                stepCount: Array.isArray(flow.draft?.steps) ? flow.draft.steps.length : 0,
                versionCount: Array.isArray(flow.versions) ? Math.max(1, flow.versions.length) : 1,
                // Kategorin i katalogen, satt av användaren. Saknas den gäller
                // reglerna i core/flow-tree.ts – därför skickas fältet vidare
                // orört, aldrig med ett påhittat standardvärde.
                category: typeof flow.category === "string" ? flow.category : undefined,
                subcategory:
                  typeof flow.subcategory === "string" ? flow.subcategory : undefined,
                // Ytan (gemensam/demo/egen) härleds ur ägaren – se core/behorighet.ts.
                ägare: flow.ägare && typeof flow.ägare.id === "string" ? flow.ägare : undefined,
                // Vem som skapade processen – visas för den som ser andras processer.
                skapadAv:
                  flow.skapadAv && typeof flow.skapadAv.id === "string" ? flow.skapadAv : undefined,
                // Banan där flödet börjar – menyn grupperar på den (flow-tree.ts).
                // Samma regel som flowActor() i core/flow-store.ts: startpunktens
                // bana, annars första stegets.
                actor: Array.isArray(flow.draft?.steps)
                  ? (flow.draft.steps.find((s: { type?: string }) => s.type === "start") ??
                      flow.draft.steps[0])?.laneId
                  : undefined,
                // Status och beteckning ur SAMMA funktion som webbläsarlagringen
                // använder (core/status.ts) – en rad i menyn och en rad i en
                // JSON-fil får aldrig svara olika på vilken version flödet står på.
                ...sammanfattaStatus(Array.isArray(flow.versions) ? flow.versions : []),
              };
            } catch {
              log.warn(`  [ark] Hoppar över trasig flödesfil: ${FLOWS}/${f}`);
              return null;
            }
          })
          .filter((f): f is NonNullable<typeof f> => f !== null && kanLäsa(u, f))
          .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      };

      return async (req, res, next) => {
        const url = (req.url ?? "").split("?")[0];

        try {
          // --- CSRF: allt som ändrar något måste komma från appen själv.
          const egnaVärdar = [
            huvud(req, "host"),
            ...(betroddProxy ? [huvud(req, "x-forwarded-host").split(",")[0]] : []),
            värdUr(process.env.ARK_BAS_URL),
          ];
          const csrf = prövaUrsprung(req, url, egnaVärdar);
          if (csrf) {
            json(res, 403, { ok: false, error: csrf });
            return;
          }

          // --- Inloggningen. De här vägarna är de enda som nås utan session.
          if (url === "/auth/me" && req.method === "GET") {
            json(res, 200, {
              ok: true,
              läge: auth.läge,
              användare: vem(req),
              // Lokala konton utan ett enda konto: första besöket skapar administratören.
              ...(auth.läge === "lokal" && !konton.finnsNågot()
                ? { förstaKonto: true, kodKrävs: förstaKontoKod().krävs }
                : {}),
              ...(saknas.length ? { fel: `Inloggningen är inte färdigkonfigurerad: ${saknas.join(", ")} saknas.` } : {}),
            });
            return;
          }
          if (url === "/auth/login" && req.method === "GET") {
            if (auth.läge !== "entra" || saknas.length) {
              omdirigera(res, "/");
              return;
            }
            const tillbaka = new URL(req.url ?? "", "http://x").searchParams.get("tillbaka") ?? "/";
            const start = påbörjaInloggning(auth, hemlighet, tillbaka);
            omdirigera(res, start.url, [start.kaka]);
            return;
          }
          if (url === "/auth/callback" && req.method === "GET") {
            if (auth.läge !== "entra") {
              omdirigera(res, "/");
              return;
            }
            try {
              const fråga = new URL(req.url ?? "", "http://x").searchParams;
              const { användare, tillbaka } = await avslutaInloggning(auth, hemlighet, req.headers.cookie, fråga);
              log.info(`  [ark] Inloggad: ${användare.namn} (${användare.roller.join(", ")})`);
              omdirigera(res, tillbaka, [
                kaka(SESSION_KAKA, skapaSession(användare, hemlighet), { maxÅlder: SESSION_SEKUNDER, säker: säkerKaka(req) }),
                rensaOidcKaka(säkerKaka(req)),
              ]);
            } catch (err) {
              const fel = err instanceof Error ? err.message : String(err);
              log.warn(`  [ark] Inloggningen misslyckades: ${fel}`);
              // Bara en KOD i adressen – texten stannar i loggen (inloggningsfelKod).
              omdirigera(res, `/?inloggningsfel=${encodeURIComponent(inloggningsfelKod(fel))}`, [rensaOidcKaka(säkerKaka(req))]);
            }
            return;
          }
          if (url === "/auth/dev" && req.method === "POST") {
            if (auth.läge !== "dev") {
              json(res, 404, { ok: false, error: "Provinloggningen är inte påslagen." });
              return;
            }
            const b = JSON.parse((await readBody(req)) || "{}");
            const användare = devAnvändare(String(b.namn ?? ""), String(b.roll ?? "user"));
            res.setHeader("set-cookie", kaka(SESSION_KAKA, skapaSession(användare, hemlighet), { maxÅlder: SESSION_SEKUNDER, säker: false }));
            json(res, 200, { ok: true, användare });
            return;
          }
          // --- Lokala konton (server/konton.ts).
          if (url.startsWith("/auth/") && auth.läge === "lokal" && req.method === "POST") {
            const b = JSON.parse((await readBody(req, 10_000)) || "{}");
            if (url === "/auth/forsta") {
              if (konton.finnsNågot()) {
                json(res, 409, { ok: false, error: "Det finns redan konton – logga in." });
                return;
              }
              const kod = förstaKontoKod();
              if (kod.krävs && !kod.kod) {
                json(res, 403, { ok: false, error: "SETUP_CODE är inte satt – det första kontot kan inte skapas utan den." });
                return;
              }
              if (kod.krävs && !rättKod(b.kod, kod.kod)) {
                log.warn("  [ark] Första kontot: fel engångskod.");
                json(res, 403, { ok: false, error: "Fel engångskod." });
                return;
              }
              const k = konton.skapa({
                användarnamn: String(b.användarnamn ?? ""),
                namn: String(b.namn ?? ""),
                roll: "admin",
                lösenord: String(b.lösenord ?? ""),
              });
              log.info(`  [ark] Första kontot skapat: ${k.användarnamn} (administratör)`);
              loggaIn(req, res, somAnvändare(k));
              json(res, 200, { ok: true, användare: somAnvändare(k) });
              return;
            }
            if (url === "/auth/lokal") {
              const namn = String(b.användarnamn ?? "").trim().toLowerCase();
              // REGRESSION: spärren låg på namnet ensamt och på socketens adress.
              // Bakom en proxy är den adressen proxyns – en gissare spärrade alla
              // – och vem som helst kunde låsa ute administratören med fem
              // felaktiga försök. Nu: namn + klientens adress (konton.ts).
              const nycklar = spärrnycklar(namn, klientadress(req, betroddProxy));
              const till = spärr.spärradTill(nycklar);
              if (till) {
                json(res, 429, { ok: false, error: `För många försök – vänta ${Math.ceil((till - Date.now()) / 60_000)} min.` });
                return;
              }
              try {
                const k = await konton.logga(namn, String(b.lösenord ?? ""));
                spärr.lyckat(nycklar);
                log.info(`  [ark] Inloggad: ${k.namn} (${k.roller.join(", ")})`);
                loggaIn(req, res, somAnvändare(k));
                json(res, 200, { ok: true, användare: somAnvändare(k) });
              } catch (e) {
                spärr.misslyckat(nycklar);
                throw e;
              }
              return;
            }
            if (url === "/auth/losenord") {
              const u = vem(req);
              if (!u) {
                json(res, 401, { ok: false, inloggning: true, error: "Du är inte inloggad." });
                return;
              }
              const k = konton.hämta(u.id)!;
              await konton.logga(k.användarnamn, String(b.nuvarande ?? ""));
              konton.ändra(k.id, { lösenord: String(b.nytt ?? "") });
              json(res, 200, { ok: true });
              return;
            }
          }

          // Utloggningen är en POST (och därmed CSRF-skyddad): en GET kunde
          // läggas i en bild på vilken sida som helst och logga ut den som
          // tittade. Svaret säger vart webbläsaren ska gå sedan.
          if (url === "/auth/logout") {
            if (req.method !== "POST") {
              res.setHeader("allow", "POST");
              json(res, 405, { ok: false, error: "Utloggningen är en POST." });
              return;
            }
            const rensa = kaka(SESSION_KAKA, "", { maxÅlder: 0, säker: säkerKaka(req) });
            res.setHeader("set-cookie", [rensa]);
            json(res, 200, { ok: true, tillbaka: auth.läge === "entra" && !saknas.length ? utloggningsUrl(auth) : "/" });
            return;
          }

          // --- Organisationens utseende: inloggningssidan visar det, så det nås utan session.
          if (url === "/utseende" && req.method === "GET") {
            json(res, 200, { ok: true, utseende: await utseende.utseende() });
            return;
          }
          if (url === "/utseende/logo" && req.method === "GET") {
            const logo = await utseende.logo();
            if (!logo) {
              json(res, 404, { ok: false, error: "Ingen logotyp." });
              return;
            }
            res.statusCode = 200;
            res.setHeader("content-type", logo.typ);
            // En SVG som öppnas direkt får inte köra skript på Arkitektens adress.
            res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
            res.setHeader("x-content-type-options", "nosniff");
            res.setHeader("cache-control", "public, max-age=300");
            res.end(logo.data);
            return;
          }

          // --- ALLT annat kräver en inloggad användare.
          const användare = vem(req);
          if (!användare) {
            json(res, 401, { ok: false, inloggning: true, error: "Du är inte inloggad – ladda om sidan och logga in." });
            return;
          }
          const baraAdmin = () => {
            if (ärAdmin(användare)) return false;
            json(res, 403, { ok: false, error: "Det kräver administratörsbehörighet." });
            return true;
          };

          // --- Appen ber om en tolkning.
          if (url === "/request" && req.method === "POST") {
            const läge = aiLäge(utvecklarläge);
            if (läge === "av") {
              json(res, 503, { ok: false, error: "AI-stödet är inte påslaget i den här installationen." });
              return;
            }
            const body = JSON.parse((await readBody(req)) || "{}");
            const låda = brevlåda(användare);
            fs.mkdirSync(låda.katalog, { recursive: true });
            // Gammalt svar rensas, annars plockar appen upp fel tolkning.
            fs.rmSync(låda.response, { force: true });
            // Korrelations-id: svaret hör till EXAKT den här begäran. Utan det
            // kunde ett sent svar på en avbruten (eller parallell) begäran
            // plockas upp av nästa – tolkningen och utvärderingen delar brevlåda.
            const id = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            const begäran = {
              id,
              // Vad som väntas tillbaka. "tolkning" = ett mellanlager, som
              // alltid; "presentation" = förenklad process + ramar (se
              // CLAUDE.md och src/tools/ramar/ai-presentation.ts).
              uppdrag: String(body.uppdrag ?? "tolkning"),
              // Processen uppdraget gäller, när det gäller en sparad.
              ...(body.källa && typeof body.källa === "object"
                ? {
                    källa: {
                      flödeId: String(body.källa.flödeId ?? ""),
                      namn: String(body.källa.namn ?? ""),
                    },
                  }
                : {}),
              rawText: String(body.rawText ?? ""),
              // Vilket verktyg som frågar. Husreglerna följer med i
              // `instruction`, men typen skrivs ut för sig så att den som
              // svarar ser med blotta ögat vilket diagram det gäller.
              diagramType: String(body.diagramType ?? "flowchart"),
              instruction: String(body.instruction ?? ""),
              // Användarens egna önskemål för sig – API-vägen har egen
              // systemprompt och behöver inte husreglerna i `instruction`.
              ...(typeof body.önskemål === "string" && body.önskemål.trim()
                ? { önskemål: body.önskemål }
                : {}),
              requestedAt: new Date().toISOString(),
            };
            fs.writeFileSync(låda.request, JSON.stringify(begäran, null, 2), "utf8");
            // `via: "claude-code"` = användaren valde Claude Code i kostnadsrutan –
            // bara i utvecklarläget; annars finns ingen som läser brevlådan.
            const medApi = läge === "api" && !(utvecklarläge && body.via === "claude-code");
            if (medApi) {
              log.info(`\n  [ark] Begäran ${id} (${begäran.uppdrag}) – besvaras med API:t.`);
              void svaraMedApi(begäran, låda);
            } else {
              // Ersätter en begäran som API:t höll på med (nyckeln kan ha tagits bort).
              pågående.get(låda.nyckel)?.ctrl.abort();
              log.info(
                `\n  [ark] Begäran ${id} (${begäran.uppdrag}) skriven till ${låda.request} – väntar på Claude Code.` +
                  `\n  [ark] Svaret i ${låda.response} bör innehålla "requestId": "${id}".\n`,
              );
            }
            json(res, 200, { ok: true, id, besvaras: medApi ? "api" : "claude-code" });
            return;
          }

          // --- Appen laddar upp ett UNDERLAG (en fil) till ett uppdrag.
          // Filen läggs i brevlådan som den är – Word, PDF, bild, text – och
          // begäran pekar ut den med sin sökväg. Den som svarar (Claude Code)
          // läser den med sina egna verktyg, så appen behöver ingen tolk per
          // filformat.
          if (url === "/underlag" && req.method === "POST") {
            if (aiLäge(utvecklarläge) === "av") {
              json(res, 503, { ok: false, error: "AI-stödet är inte påslaget i den här installationen." });
              return;
            }
            const namn = new URL(req.url ?? "", "http://x").searchParams.get("namn") ?? "underlag";
            // Bara filnamnet, och bara ofarliga tecken – namnet kommer utifrån.
            const säkert =
              path.basename(namn).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-80) || "underlag";
            const låda = brevlåda(användare);
            // Underlag som ingen begäran tog hand om (sidan stängdes) ligger inte kvar.
            gallraUnderlag();
            const ledigt = UNDERLAG_TAK - underlagStorlek(låda);
            if (ledigt <= 0)
              throw new Kroppsfel("Du har för mycket uppladdat underlag just nu – vänta på svaret, eller försök igen i morgon.");
            const data = await readBytes(req, Math.min(25_000_000, ledigt));
            const mapp = låda.underlag;
            fs.mkdirSync(mapp, { recursive: true });
            const fil = `${Date.now().toString(36)}-${säkert}`;
            fs.writeFileSync(path.join(mapp, fil), data);
            // Relativ till roten när brevlådan ligger i projektet (`.ark/underlag/…`
            // – den form Claude Code läser), annars absolut (en volym i drift).
            const full = path.join(mapp, fil);
            const relativ = path.relative(root, full);
            json(res, 200, { ok: true, sökväg: relativ.startsWith("..") ? full : relativ });
            return;
          }

          // --- Vem svarar? Knapparna visar olika besked beroende på vägen.
          if (url === "/status" && req.method === "GET") {
            // `claudeCode`: om kostnadsrutan får erbjuda Claude Code i stället.
            json(res, 200, {
              ok: true,
              besvaras: aiLäge(utvecklarläge),
              claudeCode: utvecklarläge,
              // Finns en mall för BMT-exporten? Utan den visas inte knappen.
              bmtMall: läsBmtMall() !== null,
            });
            return;
          }

          // --- Mallen för BMT-exporten (server/bmt-mall.ts). Webbläsaren bygger filen.
          if (url === "/bmt/mall" && req.method === "GET") {
            const mall = läsBmtMall();
            if (!mall) {
              json(res, 404, { ok: false, error: "Installationen har ingen mall för BMT-exporten (ARK_BMT_MALL)." });
              return;
            }
            res.statusCode = 200;
            res.setHeader("content-type", "application/zip");
            res.setHeader("cache-control", "no-store");
            res.end(mall);
            return;
          }

          // --- EA-portalen: publicering av processer (server/ea-portal.ts).
          // Nyckeln läses ur miljön (EA_API_KEY)
          // och lämnar aldrig servern. Flödesschemat självt skickas INTE hit –
          // det går genom flödestjänsten och integrationsplattformen.
          if (url.startsWith("/ea/")) {
            const ea = eaKonfigUrMiljö();
            if (url === "/ea/status" && req.method === "GET") {
              json(res, 200, {
                ok: true,
                konfigurerad: Boolean(ea),
                // Portalens webbadress – rutan länkar till processen där.
                webb: (process.env.EA_WEBB_URL?.trim() ?? "").replace(/\/+$/, ""),
              });
              return;
            }
            // Publiceringen på FLÖDET (core/publicering.ts) skrivs bara här,
            // aldrig med en vanlig sparning: admin + gemensam katalog
            // (prövaPublicering i server/atkomst.ts). Ingen ny version.
            const pubMatch = /^\/ea\/publicering\/([^/]+)$/.exec(url);
            if (pubMatch && (req.method === "PUT" || req.method === "DELETE")) {
              const id = decodeURIComponent(pubMatch[1]);
              const file = path.join(flowsDir, `${id}.json`);
              const befintlig = SAFE_ID.test(id) ? läsJson(file) : null;
              if (!befintlig || !kanLäsa(användare, befintlig)) {
                json(res, 404, { ok: false, error: "Flödet finns inte." });
                return;
              }
              const b = req.method === "PUT" ? JSON.parse((await readBody(req)) || "{}") : null;
              const prövad = prövaPublicering(användare, befintlig, b ? (b.publicering ?? {}) : null);
              if (!prövad.ok) {
                json(res, prövad.status, { ok: false, error: prövad.fel });
                return;
              }
              fs.writeFileSync(file, JSON.stringify(prövad.värde, null, 2), "utf8");
              log.info(
                `  [ark] ${b ? "Publicerade" : "Avpublicerade"} ${FLOWS}/${id}.json i EA-portalen (${användare.namn})`,
              );
              json(res, 200, { ok: true, flow: prövad.värde });
              return;
            }
            if (!ea) {
              json(res, 503, {
                ok: false,
                error: "EA-portalen är inte kopplad: EA_API_KEY saknas i miljön.",
              });
              return;
            }
            // Läsningen av portalens träd och applikationer görs med portalens
            // ADMINNYCKEL. Den behövs bara för att välja mål i publiceringsrutan,
            // och rutan är administratörens (kanPublicera i core/behorighet.ts) –
            // därför samma roll här. REGRESSION: vilken inloggad som helst kunde
            // läsa portalen med adminnyckeln.
            if ((url === "/ea/processer" || url === "/ea/applikationer") && req.method === "GET" && baraAdmin()) return;
            if (url === "/ea/processer" && req.method === "GET") {
              json(res, 200, { ok: true, processer: await listaProcesser(ea) });
              return;
            }
            // Målet för en Systemprocess. Bara läsning – applikationerna
            // förvaltas i portalen och skapas aldrig härifrån.
            if (url === "/ea/applikationer" && req.method === "GET") {
              json(res, 200, { ok: true, applikationer: await listaApplikationer(ea) });
              return;
            }
            // Skapar en ny process, eller uppdaterar en vi själva skapat.
            // En nod med extern källa rörs aldrig – portalens synk skriver över den.
            if (req.method === "POST" && baraAdmin()) return;
            if (url === "/ea/process" && req.method === "POST") {
              const b = JSON.parse((await readBody(req)) || "{}");
              const ägare = String(b.ägare ?? "").trim();
              const beskrivning = String(b.beskrivning ?? "").trim();
              if (!ägare || !beskrivning) {
                json(res, 400, { ok: false, error: "Processägare och beskrivning krävs." });
                return;
              }
              if (b.uppdatera) {
                await uppdateraEgenProcess(ea, String(b.uppdatera), { ägare, beskrivning });
                json(res, 200, { ok: true });
                return;
              }
              const process = await skapaProcess(ea, {
                förälderId: String(b.förälderId ?? ""),
                namn: String(b.namn ?? ""),
                prefix: typeof b.prefix === "string" ? b.prefix : undefined,
                ägare,
                beskrivning,
              });
              log.info(`  [ark] Skapade process i EA-portalen: ${process.namn} (${process.id})`);
              json(res, 200, { ok: true, process });
              return;
            }
            // Avpublicering av en process vi själva skapat. Servern kontrollerar
            // noden – en nod med extern källa arkiveras aldrig, vad begäran än säger.
            if (url === "/ea/arkivera" && req.method === "POST") {
              const b = JSON.parse((await readBody(req)) || "{}");
              await arkiveraEgenProcess(ea, String(b.id ?? ""));
              log.info(`  [ark] Arkiverade process i EA-portalen: ${String(b.id)}`);
              json(res, 200, { ok: true });
              return;
            }
            if (url === "/ea/synka" && req.method === "POST") {
              json(res, 200, { ok: true, ...(await synkaFlödesscheman(ea)) });
              return;
            }
          }

          // --- Appen pollar efter svaret.
          if (url === "/response" && req.method === "GET") {
            const låda = brevlåda(användare);
            if (!fs.existsSync(låda.response)) {
              res.statusCode = 204; // inget svar ännu
              res.end();
              return;
            }
            const raw = JSON.parse(fs.readFileSync(låda.response, "utf8"));
            // Ett svar märkt med ett ANNAT id än den väntande begäran är ett
            // kvarblivet svar på något gammalt – släng det och vänta vidare.
            // Svar utan requestId släpps igenom (bakåtkompatibelt).
            const väntande = läsBegäran(låda);
            if (raw?.requestId && väntande) {
              if (väntande?.id && väntande.id !== raw.requestId) {
                fs.rmSync(låda.response, { force: true });
                log.warn(
                  `  [ark] Kasserade kvarblivet svar (${raw.requestId}) – väntar på ${väntande.id}.`,
                );
                res.statusCode = 204;
                res.end();
                return;
              }
            }
            // Svaret är hämtat – underlagen till begäran behövs inte längre.
            rensaUnderlagFör(låda, väntande);
            json(res, 200, { ok: true, response: raw });
            return;
          }

          // --- Kontona (bara läget "lokal", bara administratörer).
          if (url === "/konton" || url.startsWith("/konton/")) {
            if (auth.läge !== "lokal") {
              json(res, 404, { ok: false, error: "Installationen använder inte lokala konton." });
              return;
            }
            if (baraAdmin()) return;
            const id = decodeURIComponent(url.slice("/konton/".length));
            if (url === "/konton" && req.method === "GET") {
              json(res, 200, { ok: true, konton: konton.alla().map(utåt) });
              return;
            }
            if (url === "/konton" && req.method === "POST") {
              const b = JSON.parse((await readBody(req, 10_000)) || "{}");
              const k = konton.skapa({
                användarnamn: String(b.användarnamn ?? ""),
                namn: String(b.namn ?? ""),
                roll: b.roll === "admin" ? "admin" : "user",
                lösenord: String(b.lösenord ?? ""),
              });
              log.info(`  [ark] Konto skapat: ${k.användarnamn} (${användare.namn})`);
              json(res, 200, { ok: true, konto: utåt(k) });
              return;
            }
            if (req.method === "PUT") {
              const b = JSON.parse((await readBody(req, 10_000)) || "{}");
              if (id === användare.id && b.roll === "user")
                throw new Kontofel("Du kan inte ta bort din egen administratörsroll.");
              const k = konton.ändra(id, {
                ...(typeof b.namn === "string" ? { namn: b.namn } : {}),
                ...(b.roll === "admin" || b.roll === "user" ? { roll: b.roll } : {}),
                ...(typeof b.lösenord === "string" && b.lösenord ? { lösenord: b.lösenord } : {}),
              });
              log.info(`  [ark] Konto ändrat: ${k.användarnamn} (${användare.namn})`);
              json(res, 200, { ok: true, konto: utåt(k) });
              return;
            }
            if (req.method === "DELETE") {
              if (id === användare.id) throw new Kontofel("Du kan inte ta bort ditt eget konto.");
              konton.taBort(id);
              log.info(`  [ark] Konto borttaget: ${id} (${användare.namn})`);
              json(res, 200, { ok: true });
              return;
            }
          }

          // --- Exempelpaketen (server/innehallspaket.mts) – administratören lägger in.
          if (url === "/innehallspaket" && req.method === "GET") {
            if (baraAdmin()) return;
            json(res, 200, {
              ok: true,
              paket: exempelpaket().map(({ katalog, info }) => ({
                id: path.basename(katalog),
                namn: info.namn,
                beskrivning: info.beskrivning,
              })),
            });
            return;
          }
          const paketMatch = /^\/innehallspaket\/([a-z0-9-]+)\/import$/.exec(url);
          if (paketMatch && req.method === "POST") {
            if (baraAdmin()) return;
            const paket = exempelpaket().find((p) => path.basename(p.katalog) === paketMatch[1]);
            if (!paket) {
              json(res, 404, { ok: false, error: "Paketet finns inte." });
              return;
            }
            // Skriver aldrig över – det som finns står kvar (invariant 11).
            const rapport = importera(o, paket.katalog);
            log.info(`  [ark] Innehållspaket ${paket.info.namn} inlagt: ${rapport.inlagda.length} nya (${användare.namn})`);
            json(res, 200, { ok: true, rapport });
            return;
          }

          // --- Organisationens namn (core/organisation.ts) – ur miljön.
          if (url === "/organisation" && req.method === "GET") {
            json(res, 200, { ok: true, organisation: organisation() });
            return;
          }

          // --- Symbolstilen: alla läser den valda, en administratör väljer.
          if (url === "/symbolstil" && req.method === "GET") {
            json(res, 200, { ok: true, stil: valdStil(o.stilarDir) });
            return;
          }
          if (url === "/symbolstilar" && req.method === "GET") {
            if (baraAdmin()) return;
            const { stilar, fel } = läsStilar(o.stilarDir);
            json(res, 200, {
              ok: true,
              vald: valdStil(o.stilarDir).id,
              stilar: stilar.map((s) => ({ id: s.id, namn: s.namn, beskrivning: s.beskrivning })),
              fel,
            });
            return;
          }
          if (url === "/symbolstil" && req.method === "PUT") {
            if (baraAdmin()) return;
            const b = JSON.parse((await readBody(req)) || "{}");
            const stil = väljStil(o.stilarDir, String(b.id ?? ""));
            log.info(`  [ark] Symbolstil vald: ${stil.namn} (${användare.namn})`);
            json(res, 200, { ok: true, stil });
            return;
          }

          // --- Flödesbiblioteket: lista.
          if (url === "/flows" && req.method === "GET") {
            json(res, 200, { ok: true, flows: listFlows(användare) });
            return;
          }

          // --- Byt yta: Mina processer → gemensam katalog (eller Demo). Som en
          // flytt i katalogen: ingen ny version, historiken står still.
          const ytMatch = /^\/flows\/([^/]+)\/yta$/.exec(url);
          if (ytMatch && req.method === "POST") {
            const id = decodeURIComponent(ytMatch[1]);
            const file = path.join(flowsDir, `${id}.json`);
            const befintlig = SAFE_ID.test(id) ? läsJson(file) : null;
            if (!befintlig || !kanLäsa(användare, befintlig)) {
              json(res, 404, { ok: false, error: "Flödet finns inte." });
              return;
            }
            const b = JSON.parse((await readBody(req)) || "{}");
            const prövad = bytYta(användare, befintlig, {
              till: String(b.till) as Yta,
              category: typeof b.category === "string" ? b.category : undefined,
              subcategory: typeof b.subcategory === "string" ? b.subcategory : undefined,
            });
            if (!prövad.ok) {
              json(res, prövad.status, { ok: false, error: prövad.fel });
              return;
            }
            fs.writeFileSync(file, JSON.stringify(prövad.värde, null, 2), "utf8");
            log.info(`  [ark] Flyttade ${FLOWS}/${id}.json till ${String(b.till)} (${användare.namn})`);
            json(res, 200, { ok: true, flow: prövad.värde });
            return;
          }

          // --- Flödesbiblioteket: hämta, spara, ta bort ett enskilt flöde.
          if (url.startsWith("/flows/")) {
            const id = decodeURIComponent(url.slice("/flows/".length));
            if (!SAFE_ID.test(id)) {
              json(res, 400, { ok: false, error: "Ogiltigt flödes-id." });
              return;
            }
            const file = path.join(flowsDir, `${id}.json`);
            const befintlig = läsJson(file);

            if (req.method === "GET") {
              if (!befintlig) {
                json(res, 404, { ok: false, error: "Flödet finns inte." });
                return;
              }
              // 403 och inte 404: sparningen behöver kunna skilja "ledigt id"
              // från "upptaget av någon annans process" (saveFlowVersion).
              if (!kanLäsa(användare, befintlig)) {
                json(res, 403, { ok: false, error: "Processen ligger i en annan användares katalog." });
                return;
              }
              json(res, 200, { ok: true, flow: befintlig });
              return;
            }

            if (req.method === "PUT") {
              // Prövas av server/atkomst.ts: behörighet, ägare och att ingen
              // annans version skrivs över.
              const prövad = prövaSparning(
                användare,
                auth.läge,
                befintlig,
                JSON.parse((await readBody(req)) || "{}"),
              );
              if (!prövad.ok) {
                json(res, prövad.status, { ok: false, error: prövad.fel });
                return;
              }
              fs.mkdirSync(flowsDir, { recursive: true });
              fs.writeFileSync(file, JSON.stringify(prövad.värde, null, 2), "utf8");
              log.info(`  [ark] Sparade flöde: ${FLOWS}/${id}.json (${användare.namn})`);
              json(res, 200, { ok: true, flow: prövad.värde });
              return;
            }

            if (req.method === "DELETE") {
              if (befintlig && !kanTaBort(användare, befintlig)) {
                json(res, 403, { ok: false, error: "Du har inte behörighet att ta bort processen." });
                return;
              }
              fs.rmSync(file, { force: true });
              // Loggas som sparningarna. En borttagning tar HELA historiken med
              // sig (invariant 11 skyddar bara det som finns kvar), och utan en
              // rad i loggen gick det inte att se i efterhand att den skett.
              log.info(`  [ark] Tog bort flöde: ${FLOWS}/${id}.json (${användare.namn})`);
              json(res, 200, { ok: true });
              return;
            }
          }

          // --- Ramserierna: lista. En egen katalog, inte bland flödena – en
          // ramserie är ingen process (se src/core/ram-store.ts).
          if (url === "/ramar" && req.method === "GET") {
            const ramar = fs.existsSync(ramarDir)
              ? fs
                  .readdirSync(ramarDir)
                  .filter((f) => f.endsWith(".json"))
                  .map((f) => {
                    try {
                      const s = JSON.parse(fs.readFileSync(path.join(ramarDir, f), "utf8"));
                      return {
                        id: s.id,
                        namn: s.namn,
                        flödeId: s.flödeId,
                        savedAt: s.savedAt,
                        antalRamar: Array.isArray(s.ramar) ? s.ramar.length : 0,
                        skapadAv: s.skapadAv,
                      };
                    } catch {
                      log.warn(`  [ark] Hoppar över trasig ramfil: ${RAMAR}/${f}`);
                      return null;
                    }
                  })
                  .filter(Boolean)
                  .sort((a, b) => String(b!.savedAt).localeCompare(String(a!.savedAt)))
              : [];
            json(res, 200, { ok: true, ramar });
            return;
          }

          if (url.startsWith("/ramar/")) {
            const id = decodeURIComponent(url.slice("/ramar/".length));
            if (!SAFE_ID.test(id)) {
              json(res, 400, { ok: false, error: "Ogiltigt id för visualiseringen." });
              return;
            }
            const file = path.join(ramarDir, `${id}.json`);
            if (req.method === "GET") {
              if (!fs.existsSync(file)) {
                json(res, 404, { ok: false, error: "Visualiseringen finns inte." });
                return;
              }
              json(res, 200, { ok: true, serie: JSON.parse(fs.readFileSync(file, "utf8")) });
              return;
            }
            if (req.method === "PUT") {
              // En ramserie kan bära en uppladdad bakgrundsbild (krympt i
              // appen, se src/tools/ramar/bild.ts) – därav den högre gränsen.
              // Alla inloggade läser och skapar; en befintlig serie ändras bara av
              // skaparen eller en administratör (core/behorighet.ts). Skaparen
              // stämplas vid skapandet (server/atkomst.ts).
              const befintligSerie = läsJson(file);
              if (befintligSerie && !kanÄndraRamserie(användare, befintligSerie)) {
                json(res, 403, { ok: false, error: "Bara den som skapade visualiseringen, eller en administratör, kan ändra den." });
                return;
              }
              const serie = prövaRamserie(
                användare,
                befintligSerie,
                JSON.parse((await readBody(req, 15_000_000)) || "{}"),
              );
              fs.mkdirSync(ramarDir, { recursive: true });
              fs.writeFileSync(file, JSON.stringify(serie, null, 2), "utf8");
              log.info(`  [ark] Sparade ramserie: ${RAMAR}/${id}.json`);
              json(res, 200, { ok: true });
              return;
            }
            if (req.method === "DELETE") {
              const serie = läsJson(file);
              if (serie && !kanTaBortRamserie(användare, serie)) {
                json(res, 403, { ok: false, error: "Bara den som skapade visualiseringen, eller en administratör, kan ta bort den." });
                return;
              }
              fs.rmSync(file, { force: true });
              log.info(`  [ark] Tog bort ramserie: ${RAMAR}/${id}.json`);
              json(res, 200, { ok: true });
              return;
            }
          }

          // --- Appen avbryter en väntande begäran. BÅDA filerna rensas: ett
          // svar som landar efter avbrottet får inte ligga kvar och plockas
          // upp av nästa begäran som om det vore dess.
          if (url === "/cancel" && req.method === "POST") {
            const låda = brevlåda(användare);
            pågående.get(låda.nyckel)?.ctrl.abort();
            pågående.delete(låda.nyckel);
            rensaUnderlagFör(låda, läsBegäran(låda));
            fs.rmSync(låda.request, { force: true });
            fs.rmSync(låda.response, { force: true });
            json(res, 200, { ok: true });
            return;
          }
        } catch (err) {
          svaraMedFel(req, res, err, log);
          return;
        }

        next();
      };
}
