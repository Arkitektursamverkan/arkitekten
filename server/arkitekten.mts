/**
 * ARKITEKTEN – den fristående servern (drift och avbild).
 *
 * Serverar det byggda gränssnittet (`dist/`, `npm run build`), bryggan under
 * `/__ark` (server/brygga.ts – samma hanterare som Vite-dev-servern monterar)
 * och `/health`. Flödestjänsten (server/flodestjanst.mts) är en egen process
 * ur samma avbild: dess ruttning är synkron och tung, och skulle annars frysa
 * gränssnittet medan plattformen hämtar scener.
 *
 * Allt väljs i miljön (server/installningar.ts). Saknas något som krävs
 * startar servern inte, och säger varför.
 *
 *   npm run build && npm start
 */

import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aiLäge, skapaBrygga, viaHttps, type AiModuler, type Hanterare } from "./brygga";
import { installningarUrMiljö, kontrollera, type Installningar } from "./installningar";
import { flödestjänstPort, startaFlödestjänst } from "./flodestjanst-barn";
import { förberedInstallation } from "./installation";

const TYPER: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * Innehållspolicyn för gränssnittet. Skript BARA ur appens egna filer – inga
 * inline-skript, ingen eval – så att en bit markup som ändå tagit sig in i
 * sidan (SVG ur ett sparat flöde) inte kan köra något. Stilar får vara inline:
 * React och de exporterade SVG-bilderna sätter `style`-attribut. Bilder får
 * vara data:/blob: (scenens bakgrund, PNG-exporten), och sidan får bara
 * ramas in av sig själv (ramarnas visningsfönster).
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * Säkerhetshuvuden på allt servern svarar med. HSTS bara när begäran kom över
 * https (proxyn säger det med x-forwarded-proto, eller ARK_BAS_URL är https) –
 * över vanlig http betyder huvudet ingenting, och en lokal provkörning ska
 * inte låsa webbläsaren vid https.
 */
export function huvuden(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("content-security-policy", CSP);
  if (viaHttps(req) || /^https:/i.test(process.env.ARK_BAS_URL?.trim() ?? "")) {
    res.setHeader("strict-transport-security", "max-age=31536000");
  }
}

/**
 * En fil ur `dist/`, eller index.html för appens egna vägar (en sökväg utan
 * filändelse). Sökvägen prövas mot katalogen – inget utanför den lämnas ut.
 */
function statiskt(distDir: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    json(res, 405, { ok: false, error: "Endast GET." });
    return;
  }
  const väg = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let fil = path.resolve(distDir, `.${väg}`);
  if (fil !== distDir && !fil.startsWith(distDir + path.sep)) {
    json(res, 404, { ok: false, error: "Finns inte." });
    return;
  }
  if (!fs.existsSync(fil) || fs.statSync(fil).isDirectory()) {
    if (path.extname(väg)) {
      json(res, 404, { ok: false, error: "Finns inte." });
      return;
    }
    fil = path.join(distDir, "index.html");
  }
  res.statusCode = 200;
  res.setHeader("content-type", TYPER[path.extname(fil)] ?? "application/octet-stream");
  // Vite namnger tillgångarna efter innehållet – de kan sparas för alltid.
  // index.html pekar ut dem och måste alltid hämtas på nytt.
  res.setHeader(
    "cache-control",
    fil.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  );
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(fil).pipe(res);
}

export function skapaServer(inst: Installningar, brygga: Hanterare): http.Server {
  return http.createServer((req, res) => {
    try {
      hantera(inst, brygga, req, res);
    } catch {
      json(res, 400, { ok: false, error: "Ogiltig begäran." });
    }
  });
}

function hantera(inst: Installningar, brygga: Hanterare, req: IncomingMessage, res: ServerResponse) {
    huvuden(req, res);
    const väg = (req.url ?? "/").split("?")[0];
    // Hälsan är öppen och säger bara att servern lever. REGRESSION: den
    // visade version och AI-läge för vem som helst – versionen finns för
    // inloggade i /__ark/status.
    if (väg === "/health") {
      json(res, 200, { status: "ok" });
      return;
    }
    if (väg === "/__ark" || väg.startsWith("/__ark/")) {
      // Som Vites montering: hanteraren ser vägen utan prefixet.
      req.url = (req.url ?? "").slice("/__ark".length) || "/";
      brygga(req, res, () => json(res, 404, { ok: false, error: "Okänd väg." })).catch(() => {
        if (res.headersSent) res.destroy();
        else json(res, 500, { ok: false, error: "Internt fel." });
      });
      return;
    }
    statiskt(inst.distDir, req, res);
}

/** Startas bara när filen körs direkt – inte när ett test importerar den. */
if (process.argv[1] && /arkitekten\.mts$/.test(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inst = installningarUrMiljö(root);
  // FÖRE kontrollen och bryggan: anmäl adressen till portalen och – med
  // ARK_AUTH=auto utan egna Entra-uppgifter – hämta dem därifrån (väntar
  // högst två minuter). Se server/installation.ts.
  const portalen = await förberedInstallation({
    arkDir: inst.arkDir,
    logg: { info: (r) => console.log(r), warn: (r) => console.warn(r) },
  });
  const { fel, varningar } = kontrollera(process.env, portalen);
  for (const rad of varningar) console.warn(`[arkitekten] ${rad}`);
  if (fel.length) {
    for (const rad of fel) console.error(`[arkitekten] FEL: ${rad}`);
    console.error("[arkitekten] Startar inte. Rätta miljön (.env) och starta om.");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(inst.distDir, "index.html"))) {
    console.error(`[arkitekten] FEL: gränssnittet är inte byggt (${inst.distDir}). Kör npm run build.`);
    process.exit(1);
  }

  const brygga = skapaBrygga({
    ...inst,
    logg: { info: (r) => console.log(r.trim()), warn: (r) => console.warn(r.trim()) },
    laddaAi: async () => {
      const klient = await import("../src/tools/flowchart/ai/client");
      const besvara = await import("../src/tools/flowchart/ai/besvara");
      return {
        anthropicFråga: klient.anthropicFråga,
        DEFAULT_MODEL: klient.DEFAULT_MODEL,
        besvara: besvara.besvara,
      } satisfies AiModuler;
    },
  });
  // Där flödestjänsten inte kan vara en egen tjänst med samma disk (Render):
  // en egen process här, se server/flodestjanst-barn.ts.
  let flödesPort: number | null;
  try {
    flödesPort = flödestjänstPort();
  } catch (e) {
    console.error(`[arkitekten] FEL: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  let stänger = false;
  const barn = flödesPort === null ? null : startaFlödestjänst(root, flödesPort);
  barn?.on("exit", (kod, signal) => {
    if (stänger) return;
    console.error(`[arkitekten] FEL: flödestjänsten avslutades (${signal ?? kod}) – Arkitekten avslutas också.`);
    process.exit(1);
  });

  // Ett avvisat löfte som ingen fångat loggas; servern kraschar inte för det.
  process.on("unhandledRejection", (skäl) => {
    console.error(
      `[arkitekten] OHANTERAT AVVISAT LÖFTE: ${skäl instanceof Error ? (skäl.stack ?? skäl.message) : String(skäl)}`,
    );
  });
  const server = skapaServer(inst, brygga);
  server.listen(inst.port, () => {
    console.log(`[arkitekten] ${inst.version} lyssnar på :${inst.port} – AI: ${aiLäge(inst.utvecklarläge)}`);
  });
  const stäng = () => {
    stänger = true;
    barn?.kill("SIGTERM");
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", stäng);
  process.on("SIGINT", stäng);
}
