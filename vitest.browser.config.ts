/**
 * Egen config för webbläsartesterna, så att `npm test` förblir snabbt och
 * körbart var som helst. De här startar en Vite-server och en Chromium och tar
 * tiotals sekunder – de ska köras när man vill veta att SKÄRMEN stämmer, inte
 * vid varje sparning.
 *
 *   npm run test:browser
 */

import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.browser.test.ts"],
    // Testerna delar en webbläsare och en app-instans, och de bygger vidare på
    // varandras tillstånd (banan förstoras, sedan minskas). Kör dem i ordning.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
