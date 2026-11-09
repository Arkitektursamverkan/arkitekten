/**
 * FLÖDESTJÄNSTEN SOM BARNPROCESS – för plattformar där två tjänster inte kan
 * dela en disk (Render och liknande).
 *
 * Med docker compose är flödestjänsten en egen container som läser samma
 * volym som Arkitekten. Där en disk bara kan höra till en tjänst startar
 * Arkitekten i stället flödestjänsten själv, i samma container, när
 * `ARK_FLODESTJANST_PORT` är satt. Den är fortfarande en EGEN process – dess
 * ruttning är synkron och tung och skulle annars frysa gränssnittet (se
 * server/arkitekten.mts) – och den kan fortfarande inte skriva.
 *
 * Dör barnet avslutas Arkitekten också, så att plattformen startar om båda i
 * stället för att låta en halv tjänst gå vidare utan processbilder.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * Porten ur `ARK_FLODESTJANST_PORT`, eller null när den inte är satt.
 * Kastar för en port som inte går att använda – hellre stopp vid start än en
 * flödestjänst som aldrig svarar.
 */
export function flödestjänstPort(env: NodeJS.ProcessEnv = process.env): number | null {
  const rå = env.ARK_FLODESTJANST_PORT?.trim();
  if (!rå) return null;
  const port = Number(rå);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`ARK_FLODESTJANST_PORT är inte en port: "${rå}".`);
  }
  const appensPort = Number(env.PORT?.trim() || 5173);
  if (port === appensPort) {
    throw new Error(`ARK_FLODESTJANST_PORT (${port}) är samma port som appen (PORT).`);
  }
  return port;
}

/**
 * Det enda barnet får ur Arkitektens miljö. Flödestjänsten läser sina
 * kataloger, organisationens namn (`core/organisation.ts`) och sin nyckel –
 * inget annat.
 *
 * REGRESSION: barnet ärvde HELA miljön, med ANTHROPIC_API_KEY,
 * ENTRA_CLIENT_SECRET, EA_API_KEY och ARK_SESSION_SECRET, i en process som
 * svarar på nätet utan inloggning. Lägg bara till en variabel här när
 * flödestjänsten faktiskt läser den.
 */
export const BARNETS_MILJÖ = [
  // Processen och tsx
  "PATH",
  "HOME",
  "NODE_ENV",
  "NODE_OPTIONS",
  "TMPDIR",
  "TZ",
  "LANG",
  "LC_ALL",
  // Flödestjänsten (server/flodestjanst.mts)
  "FLOWS_DIR",
  "RAMAR_DIR",
  "STILAR_DIR",
  "ARK_FLODESTJANST_NYCKEL",
  // Organisationens namn i scenerna (core/organisation.ts)
  "ARK_PORTALBANA",
  "ARK_SYSTEMPROCESS_KATEGORI",
] as const;

export function barnetsMiljö(env: NodeJS.ProcessEnv, port: number): NodeJS.ProcessEnv {
  const ut: NodeJS.ProcessEnv = {};
  for (const namn of BARNETS_MILJÖ) if (env[namn] !== undefined) ut[namn] = env[namn];
  ut.PORT = String(port);
  return ut;
}

/** Startar flödestjänsten ur samma installation, på egen port och med bara den miljö den behöver. */
export function startaFlödestjänst(root: string, port: number, env: NodeJS.ProcessEnv = process.env): ChildProcess {
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  return spawn(tsx, [path.join(root, "server", "flodestjanst.mts")], {
    cwd: root,
    env: barnetsMiljö(env, port),
    stdio: "inherit",
  });
}
