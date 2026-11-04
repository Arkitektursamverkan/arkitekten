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
 *       1. Appen POST:ar sin beskrivning        → <arkDir>/request.json
 *       2. Claude Code läser den, tolkar, skriver → <arkDir>/response.json
 *       3. Appen pollar och plockar upp svaret   → mellanlagret fylls
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
import { bytYta, prövaRamserie, prövaSparning } from "./atkomst";
import { läsStilar, valdStil, väljStil } from "./symbolstilar";
import { Inloggningsspärr, Kontofel, Kontolager, somAnvändare, utåt } from "./konton";
import { exempelpaket, importera } from "./innehallspaket.mjs";
import { organisation, organisationUrMiljö, sättOrganisation } from "../src/core/organisation";
import { skapaUtseende, type UtseendeKälla } from "./utseende";
import { läsBmtMall } from "./bmt-mall";
import {
  ärAdmin,
  kanLäsa,
  kanTaBort,
  kanTaBortRamserie,
  type Användare,
  type Yta,
} from "../src/core/behorighet";

const REQUEST = "request.json";
const RESPONSE = "response.json";
/** Uppladdade underlag till ett uppdrag (t.ex. dokumentet en rutin ska byggas ur). */
const UNDERLAG = "underlag";

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

/** Läser hela request-bodyn som text. */
function readBody(req: IncomingMessage, max = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      // Enkel spärr mot orimliga payloads (beskrivningar är text, inte filer).
      if (data.length > max) reject(new Error("För stor payload"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Som `readBody`, men för en FIL: byten som de är, med en högre gräns. */
function readBytes(req: IncomingMessage, max = 25_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const delar: Buffer[] = [];
    let längd = 0;
    req.on("data", (chunk: Buffer) => {
      längd += chunk.length;
      if (längd > max) reject(new Error("Filen är för stor (högst 25 MB)."));
      else delar.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(delar)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** Bryggans begärandehanterare, monterad under `/__ark` (`req.url` utan prefixet). */
export function skapaBrygga(o: BryggOptioner): Hanterare {
      // Organisationens namn (portalbanan) gäller också serverns egna tolkningar.
      sättOrganisation(organisationUrMiljö(process.env));
      const { root, flowsDir, ramarDir, logg: log, utvecklarläge } = o;
      const utseende = o.utseende ?? skapaUtseende(process.env, eaKonfigUrMiljö());
      const dir = o.arkDir;
      const requestPath = path.join(dir, REQUEST);
      const responsePath = path.join(dir, RESPONSE);
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
      const säkerKaka =
        (auth.läge === "entra" || auth.läge === "lokal") && auth.basUrl.startsWith("https:");
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
      const loggaIn = (res: ServerResponse, u: Användare) =>
        res.setHeader("set-cookie", kaka(SESSION_KAKA, skapaSession(u, hemlighet), { maxÅlder: SESSION_SEKUNDER, säker: säkerKaka }));

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

      /** Begäran som servern just nu besvarar med API:t – en i taget, som brevlådan. */
      let pågående: { id: string; ctrl: AbortController } | null = null;

      /**
       * Besvarar begäran med API:t och lägger svaret i brevlådan. Svaret skrivs
       * bara om begäran fortfarande är den som väntar och ingen annan (Claude
       * Code) hunnit svara – en avbruten eller ersatt begäran får inget svar.
       */
      const svaraMedApi = async (begäran: AiBesvara.ArkBegäran & { id: string }) => {
        pågående?.ctrl.abort();
        const ctrl = new AbortController();
        pågående = { id: begäran.id, ctrl };
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
              const fil = path.resolve(root, sökväg);
              if (!fil.startsWith(path.join(dir, UNDERLAG) + path.sep)) throw new Error("Underlaget ligger utanför brevlådan.");
              return new Uint8Array(fs.readFileSync(fil));
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
        if (pågående?.id === begäran.id) pågående = null;
        const väntande = fs.existsSync(requestPath)
          ? JSON.parse(fs.readFileSync(requestPath, "utf8"))?.id
          : null;
        if (väntande !== begäran.id || fs.existsSync(responsePath)) {
          logg("begäran väntar inte längre – svaret kastas");
          return;
        }
        fs.writeFileSync(responsePath, JSON.stringify({ ...svar, requestId: begäran.id }, null, 2), "utf8");
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
          // --- Inloggningen. De här vägarna är de enda som nås utan session.
          if (url === "/auth/me" && req.method === "GET") {
            json(res, 200, {
              ok: true,
              läge: auth.läge,
              användare: vem(req),
              // Lokala konton utan ett enda konto: första besöket skapar administratören.
              ...(auth.läge === "lokal" && !konton.finnsNågot() ? { förstaKonto: true } : {}),
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
                kaka(SESSION_KAKA, skapaSession(användare, hemlighet), { maxÅlder: SESSION_SEKUNDER, säker: säkerKaka }),
                rensaOidcKaka(säkerKaka),
              ]);
            } catch (err) {
              const fel = err instanceof Error ? err.message : String(err);
              log.warn(`  [ark] Inloggningen misslyckades: ${fel}`);
              omdirigera(res, `/?inloggningsfel=${encodeURIComponent(fel)}`, [rensaOidcKaka(säkerKaka)]);
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
              const k = konton.skapa({
                användarnamn: String(b.användarnamn ?? ""),
                namn: String(b.namn ?? ""),
                roll: "admin",
                lösenord: String(b.lösenord ?? ""),
              });
              log.info(`  [ark] Första kontot skapat: ${k.användarnamn} (administratör)`);
              loggaIn(res, somAnvändare(k));
              json(res, 200, { ok: true, användare: somAnvändare(k) });
              return;
            }
            if (url === "/auth/lokal") {
              const namn = String(b.användarnamn ?? "").trim().toLowerCase();
              const nycklar = [`namn:${namn}`, `adress:${req.socket.remoteAddress ?? ""}`];
              const till = spärr.spärradTill(nycklar);
              if (till) {
                json(res, 429, { ok: false, error: `För många försök – vänta ${Math.ceil((till - Date.now()) / 60_000)} min.` });
                return;
              }
              try {
                const k = konton.logga(namn, String(b.lösenord ?? ""));
                spärr.lyckat(nycklar);
                log.info(`  [ark] Inloggad: ${k.namn} (${k.roller.join(", ")})`);
                loggaIn(res, somAnvändare(k));
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
              konton.logga(k.användarnamn, String(b.nuvarande ?? ""));
              konton.ändra(k.id, { lösenord: String(b.nytt ?? "") });
              json(res, 200, { ok: true });
              return;
            }
          }

          if (url === "/auth/logout") {
            const rensa = kaka(SESSION_KAKA, "", { maxÅlder: 0, säker: säkerKaka });
            omdirigera(res, auth.läge === "entra" && !saknas.length ? utloggningsUrl(auth) : "/", [rensa]);
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
            fs.mkdirSync(dir, { recursive: true });
            // Gammalt svar rensas, annars plockar appen upp fel tolkning.
            fs.rmSync(responsePath, { force: true });
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
            fs.writeFileSync(requestPath, JSON.stringify(begäran, null, 2), "utf8");
            // `via: "claude-code"` = användaren valde Claude Code i kostnadsrutan –
            // bara i utvecklarläget; annars finns ingen som läser brevlådan.
            const medApi = läge === "api" && !(utvecklarläge && body.via === "claude-code");
            if (medApi) {
              log.info(`\n  [ark] Begäran ${id} (${begäran.uppdrag}) – besvaras med API:t.`);
              void svaraMedApi(begäran);
            } else {
              // Ersätter en begäran som API:t höll på med (nyckeln kan ha tagits bort).
              pågående?.ctrl.abort();
              log.info(
                `\n  [ark] Begäran ${id} (${begäran.uppdrag}) skriven till ${requestPath} – väntar på Claude Code.` +
                  `\n  [ark] Svaret i ${responsePath} bör innehålla "requestId": "${id}".\n`,
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
            const data = await readBytes(req);
            const mapp = path.join(dir, UNDERLAG);
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
            if (!ea) {
              json(res, 503, {
                ok: false,
                error: "EA-portalen är inte kopplad: EA_API_KEY saknas i miljön.",
              });
              return;
            }
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
            if (!fs.existsSync(responsePath)) {
              res.statusCode = 204; // inget svar ännu
              res.end();
              return;
            }
            const raw = JSON.parse(fs.readFileSync(responsePath, "utf8"));
            // Ett svar märkt med ett ANNAT id än den väntande begäran är ett
            // kvarblivet svar på något gammalt – släng det och vänta vidare.
            // Svar utan requestId släpps igenom (bakåtkompatibelt).
            if (raw?.requestId && fs.existsSync(requestPath)) {
              const väntande = JSON.parse(fs.readFileSync(requestPath, "utf8"));
              if (väntande?.id && väntande.id !== raw.requestId) {
                fs.rmSync(responsePath, { force: true });
                log.warn(
                  `  [ark] Kasserade kvarblivet svar (${raw.requestId}) – väntar på ${väntande.id}.`,
                );
                res.statusCode = 204;
                res.end();
                return;
              }
            }
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
              // Ramarna är offentliga: alla inloggade får spara, och skaparen
              // stämplas vid skapandet (server/atkomst.ts).
              const serie = prövaRamserie(
                användare,
                läsJson(file),
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
            pågående?.ctrl.abort();
            pågående = null;
            fs.rmSync(requestPath, { force: true });
            fs.rmSync(responsePath, { force: true });
            json(res, 200, { ok: true });
            return;
          }
        } catch (err) {
          json(res, err instanceof Kontofel ? err.status : 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        next();
      };
}
