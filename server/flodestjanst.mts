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
 *   FLOWS_DIR=flows PORT=8200 npx tsx server/flodestjanst.mts
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
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
/** Samma skydd mot path traversal som bryggan (server/brygga.ts). */
const SAFE_ID = /^[a-z0-9-]{1,64}$/;

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  // Plattformen avgör på content-type att den pratar med en riktig tjänst –
  // en HTML-sida som 200:ar tolkas som "ingen tjänst".
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function fel(res: ServerResponse, status: number, error: string) {
  json(res, status, { ok: false, error });
}

function läsFlöde(flowsDir: string, id: string): SavedFlow | null {
  const fil = path.join(flowsDir, `${id}.json`);
  if (!fs.existsSync(fil)) return null;
  return JSON.parse(fs.readFileSync(fil, "utf8")) as SavedFlow;
}

/**
 * Processnumret ur flödets namn ("2.2.7 Uthyrning av nyproduktion" → "2.2.7").
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
        // utan processnummer inte har.
        ...(flow.publicering?.eaNodId
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
  if (!Number.isInteger(n) || n < 0) throw new Error(`Ogiltig version: ${v}`);
  return n;
}

/**
 * Begärandehanteraren, skild från uppstarten så att tester kan starta tjänsten
 * på egen port mot en egen katalog.
 */
export function skapaHanterare(flowsDir: string = FLOWS_DIR, stilarDir: string = STILAR_DIR) {
  // Slutets reservbana är portalbanan – samma namn som i appen.
  sättOrganisation(organisationUrMiljö(process.env));
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const väg = url.pathname.replace(/\/+$/, "") || "/";
    const metod = req.method ?? "GET";

    try {
      if (metod !== "GET") {
        res.setHeader("allow", "GET");
        return fel(res, 405, "Tjänsten är läsbar. Endast GET.");
      }

      if (väg === "/health") {
        return json(res, 200, { ok: true, kontrakt: KONTRAKT, antal: listaFlöden(flowsDir).length });
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
      return fel(res, 400, e instanceof Error ? e.message : String(e));
    }
  };
}

/** Startas bara när filen körs direkt – inte när ett test importerar den. */
if (process.argv[1] && /flodestjanst\.mts$/.test(process.argv[1])) {
  const server = http.createServer(skapaHanterare());
  // Ruttningen är SYNKRON och kan ta över tio sekunder för en stor process
  // (4.4.3 har 131 objekt). Under tiden står Nodes event-loop stilla, och med
  // förvalet 5 s hann keep-alive-timern på de VÄNTANDE anslutningarna gå ut i
  // samma ögonblick som loopen släpptes – Integrationsplattformen fick en
  // tom `httpx.ReadError` mitt i en hämtning och hela synken lades ner.
  // Tiden ska vara längre än den längsta ruttningen, inte längre än klienten
  // orkar vänta (dess timeout är 60 s).
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 130_000;
  server.listen(PORT, () => {
    console.log(`[flödestjänst] läser ${path.resolve(FLOWS_DIR)} – lyssnar på :${PORT}`);
  });
}
