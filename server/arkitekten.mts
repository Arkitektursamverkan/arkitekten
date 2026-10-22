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
import { aiLäge, skapaBrygga, type AiModuler, type Hanterare } from "./brygga";
import { installningarUrMiljö, kontrollera, type Installningar } from "./installningar";

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

/** Säkerhetshuvuden på allt servern svarar med. */
function huvuden(res: ServerResponse) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("x-frame-options", "SAMEORIGIN");
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
    huvuden(res);
    const väg = (req.url ?? "/").split("?")[0];
    if (väg === "/health") {
      json(res, 200, { status: "ok", version: inst.version, ai: aiLäge(inst.utvecklarläge) });
      return;
    }
    if (väg === "/__ark" || väg.startsWith("/__ark/")) {
      // Som Vites montering: hanteraren ser vägen utan prefixet.
      req.url = (req.url ?? "").slice("/__ark".length) || "/";
      void brygga(req, res, () => json(res, 404, { ok: false, error: "Okänd väg." }));
      return;
    }
    statiskt(inst.distDir, req, res);
}

/** Startas bara när filen körs direkt – inte när ett test importerar den. */
if (process.argv[1] && /arkitekten\.mts$/.test(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inst = installningarUrMiljö(root);
  const { fel, varningar } = kontrollera();
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
  const server = skapaServer(inst, brygga);
  server.listen(inst.port, () => {
    console.log(`[arkitekten] ${inst.version} lyssnar på :${inst.port} – AI: ${aiLäge(inst.utvecklarläge)}`);
  });
  const stäng = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stäng);
  process.on("SIGINT", stäng);
}
