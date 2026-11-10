/**
 * FLÖDESTJÄNSTEN – Arkitektens läsbara yta utåt.
 *
 * Finns för att integrationsplattformen ska kunna hämta flöden och färdiga
 * SCENER (se `core/scen.ts`), så att EA-portalen kan rita processernas
 * flödesscheman utan att äga en enda layoutregel. Arkitekten räknar, portalen
 * ritar.
 *
 * TJÄNSTEN KAN INTE SKRIVA. Det finns ingen PUT, ingen DELETE och ingen väg
 * till filsystemet som ändrar något – `flows/` öppnas bara för läsning. Det är
 * ett medvetet val och inte en tillfällighet: invariant 11 säger att en
 * flödesversion aldrig får skrivas över, och det enklaste sättet att garantera
 * det i en nätverkstjänst är att aldrig ge den förmågan. Behöver något skrivas
 * i framtiden ska det gå genom appen eller ett skript, inte genom den här.
 * `flodestjanst.test.ts` bevisar löftet i stället för att lita på det.
 *
 * Flödena har en FAMILJ i listan: "affarsprocess" (verktyget Affärsprocess)
 * eller "flodesschema" (Systemprocess). Plattformen filtrerar på den och
 * portalen avgör var bilden visas – på processkartan eller hos en applikation.
 *
 * ÅTKOMSTEN. Med `ARK_FLODESTJANST_NYCKEL` satt kräver varje `/api/*`-anrop
 * huvudet `X-Arkitekten-Nyckel` med samma värde (jämfört tidskonstant), annars
 * 401; `/health` är alltid öppen. Utan nyckeln svarar tjänsten som förut, men
 * varnar vid start. Processer i en användares EGEN katalog (ytan "egen",
 * Mina processer – core/behorighet.ts) lämnas ALDRIG ut: de saknas i listan
 * och ger 404 på sitt id.
 *
 *   FLOWS_DIR=flows PORT=8200 npx tsx server/flodestjanst.mts
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SavedFlow } from "@/core/flow-store";
import { sammanfattaStatus } from "@/core/status";
import { byggApScen, byggUtlägg, type ScenOptioner } from "@/tools/affarsprocess/scen-affarsprocess";
import { renderApSvg } from "@/tools/affarsprocess/svg-affarsprocess";
import { byggFlödesScen, byggFlödesUtlägg } from "@/tools/flowchart/export/scen-flodesschema";
import { renderSvgSized } from "@/tools/flowchart/export/svg";
import { sättSymbolstil } from "@/tools/affarsprocess/symbolstil";
import { valdStil } from "./symbolstilar";
import { organisationUrMiljö, sättOrganisation } from "@/core/organisation";
import { ytaFör } from "@/core/behorighet";
import { Användarfel } from "./fel";

const FLOWS_DIR = process.env.FLOWS_DIR ?? "flows";
/**
 * Kontraktets huvudversion (docs/gransnitt.md). Höjs bara när något tas bort
 * eller byter betydelse; nya fält höjer den inte. Plattformen avvisar en
 * högre version än den känner.
 */
export const KONTRAKT = 1;
const PORT = Number(process.env.PORT ?? 8200);
/** Samma katalog som appen – portalens bilder får installationens symbolstil. */
const STILAR_DIR = process.env.STILAR_DIR ?? "stilar";
/** Huvudet som bär nyckeln (kontraktet med Integrationsplattformen). */
export const NYCKELHUVUD = "x-arkitekten-nyckel";
/** Samma skydd mot path traversal som bryggan (server/brygga.ts). */
const SAFE_ID = /^[a-z0-9-]{1,64}$/;

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  // Plattformen avgör på content-type att den pratar med en riktig tjänst –
  // en HTML-sida som 200:ar tolkas som "ingen tjänst".
  res.setHeader("content-type", "application/json; charset=utf-8");
  // Flödena är verksamhetens – ingen mellanlagring och ingen typgissning.
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function fel(res: ServerResponse, status: number, error: string) {
  json(res, status, { ok: false, error });
}

/**
 * Får flödet lämnas ut? Inte om det ligger i en användares egen katalog –
 * samma härledning av ytan som appen och bryggan (core/behorighet.ts).
 *
 * REGRESSION: tjänsten lämnade ut ALLA flöden, också andras "Mina
 * processer", med hela innehållet.
 */
function utlämnbart(flow: { ägare?: unknown; category?: unknown }): boolean {
  const ägare = flow.ägare as { id?: unknown } | undefined;
  return (
    ytaFör({
      ägare: ägare && typeof ägare.id === "string" ? { id: ägare.id, namn: "" } : undefined,
      category: typeof flow.category === "string" ? flow.category : undefined,
    }) !== "egen"
  );
}

function läsFlöde(flowsDir: string, id: string): SavedFlow | null {
  const fil = path.join(flowsDir, `${id}.json`);
  if (!fs.existsSync(fil)) return null;
  const flöde = JSON.parse(fs.readFileSync(fil, "utf8")) as SavedFlow;
  return utlämnbart(flöde as { ägare?: unknown; category?: unknown }) ? flöde : null;
}

/** Stämmer nyckeln i huvudet? Tidskonstant jämförelse (på hashar, så längden inte läcker). */
function rättNyckel(given: string | string[] | undefined, nyckel: string): boolean {
  const g = Array.isArray(given) ? given[0] : given;
  if (typeof g !== "string" || !g) return false;
  const h = (v: string) => crypto.createHash("sha256").update(v, "utf8").digest();
  return crypto.timingSafeEqual(h(g), h(nyckel));
}

/**
 * Processnumret ur flödets namn ("1.2.3 Beställ behörighet" → "1.2.3").
 *
 * Prefixet kopplar en scen till en processnod i portalen när processen inte är
 * publicerad med ett nod-id – samma numrering som processkartan bär. Det härleds här och
 * inte hos mottagaren: namnet är Arkitektens, och en mottagare som gissar
 * mönstret gissar fel den dagen namnsättningen ändras.
 */
function prefixAvNamn(namn: unknown): string | undefined {
  const m = /^(\d+(?:\.\d+)*)\s/.exec(String(namn ?? ""));
  return m ? m[1] : undefined;
}

/** Sammanfattningarna i listan – samma form och samma källa som bryggan. */
function listaFlöden(flowsDir: string) {
  if (!fs.existsSync(flowsDir)) return [];
  const ut = [];
  for (const f of fs.readdirSync(flowsDir).filter((f) => f.endsWith(".json"))) {
    try {
      const flow = JSON.parse(fs.readFileSync(path.join(flowsDir, f), "utf8"));
      if (!utlämnbart(flow)) continue;
      const steps = Array.isArray(flow.draft?.steps) ? flow.draft.steps : [];
      ut.push({
        id: flow.id,
        name: flow.name,
        savedAt: flow.savedAt,
        // Affärsprocesser hör till processkartan, systemprocesser till en
        // applikation. Plattformen och portalen skiljer dem åt på familjen.
        familj:
          flow.draft?.diagramType === "affarsprocess" || String(flow.id).startsWith("ap-")
            ? "affarsprocess"
            : "flodesschema",
        // Numret ur namnet; saknas det där gäller noden processen publicerats på.
        ...((prefixAvNamn(flow.name) ?? flow.publicering?.eaPrefix)
          ? { prefix: prefixAvNamn(flow.name) ?? flow.publicering?.eaPrefix }
          : {}),
        // Var i EA-portalen processen är publicerad (core/publicering.ts).
        // Plattformen speglar bara publicerade flöden, och portalen kopplar
        // flödet till noden på `eaNodId` – inte på numret, som en ny process
        // utan processnummer inte har. BARA den gemensamma katalogen
        // publiceras (kanPublicera): en publicering på en Demo-process följer
        // aldrig med ut, så plattformens `endast_publicerade` aldrig hämtar den.
        // REGRESSION: en publicering i Demo – där alla får spara – gick ut.
        ...(flow.publicering?.eaNodId && ytaFör(flow) === "gemensam"
          ? {
              publicering: {
                eaNodId: flow.publicering.eaNodId,
                ägare: flow.publicering.ägare,
                beskrivning: flow.publicering.beskrivning,
                publiceradAt: flow.publicering.publiceradAt,
              },
            }
          : {}),
        stepCount: steps.length,
        versionCount: Array.isArray(flow.versions) ? Math.max(1, flow.versions.length) : 1,
        // Kategorin i katalogen (användarens egen). Saknas = reglerna i
        // core/flow-tree.ts gäller; tjänsten hittar aldrig på ett värde.
        ...(typeof flow.category === "string" && flow.category.trim()
          ? { category: flow.category }
          : {}),
        actor: (steps.find((s: { type?: string }) => s.type === "start") ?? steps[0])?.laneId,
        // Status och beteckning ur SAMMA funktion som appen (invariant 9) –
        // aldrig en egen uträkning.
        ...sammanfattaStatus(Array.isArray(flow.versions) ? flow.versions : []),
      });
    } catch {
      console.warn(`[flödestjänst] Hoppar över trasig flödesfil: ${f}`);
    }
  }
  return ut;
}

/** `?version=` – "fastslagen" (förval), "aktuell" eller ett index. */
function versionsval(sp: URLSearchParams): ScenOptioner["version"] {
  const v = sp.get("version");
  if (!v) return undefined;
  if (v === "aktuell" || v === "fastslagen") return v;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Användarfel(`Ogiltig version: ${v}`);
  return n;
}

/**
 * Begärandehanteraren, skild från uppstarten så att tester kan starta tjänsten
 * på egen port mot en egen katalog.
 */
export function skapaHanterare(
  flowsDir: string = FLOWS_DIR,
  stilarDir: string = STILAR_DIR,
  nyckel: string = process.env.ARK_FLODESTJANST_NYCKEL?.trim() ?? "",
) {
  // Slutets reservbana är portalbanan – samma namn som i appen.
  sättOrganisation(organisationUrMiljö(process.env));
  const hantera = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let väg = "?";
    try {
      // Tolkningen inne i try och mot en FAST bas: ett trasigt Host-huvud eller
      // en konstig sökväg kastade förut UTANFÖR felhanteringen.
      const url = new URL(req.url ?? "/", "http://localhost");
      väg = url.pathname.replace(/\/+$/, "") || "/";
      const metod = req.method ?? "GET";

      if (metod !== "GET") {
        res.setHeader("allow", "GET");
        return fel(res, 405, "Tjänsten är läsbar. Endast GET.");
      }

      if (väg === "/health") {
        return json(res, 200, { ok: true, kontrakt: KONTRAKT, antal: listaFlöden(flowsDir).length });
      }

      // Allt under /api kräver nyckeln när installationen har en.
      if (nyckel && (väg === "/api" || väg.startsWith("/api/")) && !rättNyckel(req.headers[NYCKELHUVUD], nyckel)) {
        return fel(res, 401, "Nyckel saknas eller är fel (X-Arkitekten-Nyckel).");
      }

      if (väg === "/api/flows") {
        return json(res, 200, { ok: true, kontrakt: KONTRAKT, flows: listaFlöden(flowsDir) });
      }

      const m = /^\/api\/flows\/([^/]+)(?:\/(scen|svg))?$/.exec(väg);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const vad = m[2];
        if (!SAFE_ID.test(id)) return fel(res, 400, "Ogiltigt flödes-id.");
        const flöde = läsFlöde(flowsDir, id);
        if (!flöde) return fel(res, 404, "Flödet finns inte.");

        if (!vad) return json(res, 200, { ok: true, flow: flöde });

        // En scen per familj: Affärsprocess och Systemprocess
        // (flödesschemat) har var sin scenbyggare, men samma kontrakt.
        const ärAp = flöde.draft?.diagramType === "affarsprocess" || id.startsWith("ap-");
        const version = versionsval(url.searchParams);
        // Varje scen ritas med den stil som är vald JUST NU – ett byte i appen
        // syns i portalen vid nästa hämtning, utan omstart.
        sättSymbolstil(valdStil(stilarDir));
        if (vad === "scen") {
          const scen = ärAp ? byggApScen(flöde, { version }) : byggFlödesScen(flöde, { version });
          return json(res, 200, { ok: true, scen });
        }
        res.statusCode = 200;
        res.setHeader("content-type", "image/svg+xml; charset=utf-8");
        // En SVG som öppnas direkt i en flik är ett dokument som kan bära skript.
        // Bilden ska bara visas: inga skript, inga hämtningar, bara egna stilar.
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
        if (ärAp) {
          const { lo, textScale } = byggUtlägg(flöde, { version });
          res.end(renderApSvg(lo, { textScale }));
        } else {
          const { lo, modell, textScale } = byggFlödesUtlägg(flöde, { version });
          res.end(renderSvgSized(modell, lo, "type", textScale).svg);
        }
        return;
      }

      return fel(res, 404, "Okänd väg.");
    } catch (e) {
      // Bara ett Användarfel når klienten med sin text; resten (t.ex. ett
      // filsystemsfel med en sökväg) loggas här. REGRESSION: felets text,
      // med sökvägar, gick rakt ut.
      if (e instanceof Användarfel) return fel(res, e.status, e.message);
      console.warn(`[flödestjänst] FEL i ${väg}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      return fel(res, 400, "Flödet kunde inte läsas eller ritas.");
    }
  };
  /**
   * Det som ändå tar sig ut ur hanteraren blir ett 500-svar, aldrig ett
   * ohanterat löfte. REGRESSION: en begäran som kastade utanför try lämnade
   * ett avvisat löfte efter sig och anslutningen hängde.
   */
  return (req: IncomingMessage, res: ServerResponse): Promise<void> =>
    hantera(req, res).catch((e) => {
      console.warn(`[flödestjänst] OHANTERAT FEL: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      if (res.headersSent) res.destroy();
      else fel(res, 500, "Internt fel.");
    });
}

/**
 * Ett avvisat löfte som ingen fångat loggas – processen lever vidare.
 * Node avslutar annars hela tjänsten, och med den alla andras hämtningar.
 */
export function loggaOhanteradeLöften(namn: string): void {
  process.on("unhandledRejection", (skäl) => {
    console.error(`[${namn}] OHANTERAT AVVISAT LÖFTE: ${skäl instanceof Error ? (skäl.stack ?? skäl.message) : String(skäl)}`);
  });
}

/** Startas bara när filen körs direkt – inte när ett test importerar den. */
if (process.argv[1] && /flodestjanst\.mts$/.test(process.argv[1])) {
  loggaOhanteradeLöften("flödestjänst");
  const server = http.createServer(skapaHanterare());
  // Ruttningen är SYNKRON och kan ta över tio sekunder för en stor process
  // (över hundra objekt). Under tiden står Nodes event-loop stilla, och med
  // förvalet 5 s hann keep-alive-timern på de VÄNTANDE anslutningarna gå ut i
  // samma ögonblick som loopen släpptes – Integrationsplattformen fick en
  // tom `httpx.ReadError` mitt i en hämtning och hela synken lades ner.
  // Tiden ska vara längre än den längsta ruttningen, inte längre än klienten
  // orkar vänta (dess timeout är 60 s).
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 130_000;
  if (!process.env.ARK_FLODESTJANST_NYCKEL?.trim())
    console.warn(
      "[flödestjänst] VARNING: ARK_FLODESTJANST_NYCKEL är inte satt – /api svarar vem som helst som når porten.",
    );
  server.listen(PORT, () => {
    console.log(`[flödestjänst] läser ${path.resolve(FLOWS_DIR)} – lyssnar på :${PORT}`);
  });
}
