/**
 * Vite-tillägget: monterar bryggan (`server/brygga.ts`) i dev-servern.
 *
 * Samma hanterare som den fristående servern (`server/arkitekten.mts`) – här
 * finns ingen egen regel, bara värden: Vites loggare och Vites modulgraf för
 * AI-modulerna (de använder @-alias och delas med appen).
 */

import type { Plugin, ViteDevServer } from "vite";
import { skapaBrygga, type AiModuler } from "../server/brygga";
import { installningarUrMiljö, kontrollera } from "../server/installningar";

export function arkBridge(): Plugin {
  return {
    name: "ark-bridge",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      const inst = installningarUrMiljö(server.config.root);
      const logger = server.config.logger;
      const { fel, varningar } = kontrollera();
      for (const rad of [...fel, ...varningar]) logger.warn(`  [ark] ${rad}`);

      const brygga = skapaBrygga({
        ...inst,
        logg: { info: (r) => logger.info(r), warn: (r) => logger.warn(r) },
        laddaAi: async () => {
          const klient = await server.ssrLoadModule("/src/tools/flowchart/ai/client.ts");
          const besvara = await server.ssrLoadModule("/src/tools/flowchart/ai/besvara.ts");
          return {
            anthropicFråga: klient.anthropicFråga,
            DEFAULT_MODEL: klient.DEFAULT_MODEL,
            besvara: besvara.besvara,
          } as AiModuler;
        },
      });
      server.middlewares.use("/__ark", (req, res, next) => void brygga(req, res, next));
    },
  };
}
