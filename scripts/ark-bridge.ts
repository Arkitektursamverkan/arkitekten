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
import { förberedInstallation } from "../server/installation";

export function arkBridge(): Plugin {
  return {
    name: "ark-bridge",
    apply: "serve",
    async configureServer(server: ViteDevServer) {
      const inst = installningarUrMiljö(server.config.root);
      const logger = server.config.logger;
      // Som den fristående servern: portalens uppgifter före kontrollen och bryggan.
      const portalen = await förberedInstallation({
        arkDir: inst.arkDir,
        logg: { info: (r) => logger.info(`  ${r}`), warn: (r) => logger.warn(`  ${r}`) },
      });
      const { fel, varningar } = kontrollera(process.env, portalen);
      for (const rad of varningar) logger.warn(`  [ark] ${rad}`);
      // Som den fristående servern: en felaktig inställning stoppar starten.
      // REGRESSION: felen loggades bara, och dev-servern gick igång med t.ex.
      // öppen drift eller en trasig inloggning.
      if (fel.length) {
        for (const rad of fel) logger.error(`  [ark] FEL: ${rad}`);
        throw new Error(`Arkitekten startar inte: ${fel.join(" ")} Rätta miljön (.env) och starta om.`);
      }

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
      server.middlewares.use("/__ark", (req, res, next) => {
        brygga(req, res, next).catch((e) => {
          logger.error(`  [ark] OHANTERAT FEL: ${e instanceof Error ? e.message : String(e)}`);
          if (res.headersSent) res.destroy();
          else {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "Internt fel." }));
          }
        });
      });
    },
  };
}
