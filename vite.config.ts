/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { arkBridge } from "./scripts/ark-bridge";

/** Värdnamnet ur en adress, för Vites allowedHosts. */
function värdnamn(url: string | undefined): string[] {
  try {
    return url ? [new URL(url).hostname] : [];
  } catch {
    return [];
  }
}

export default defineConfig({
  // arkBridge = bryggan (/__ark) i dev-servern (se scripts/ark-bridge.ts).
  plugins: [react(), arkBridge()],
  // Dev-servern är för utveckling – i drift kör den fristående servern
  // (`npm start`). Den lyssnar på nätverket så att den kan provas från en
  // annan maskin; Vite svarar 403 på värdnamn den inte känner igen, så
  // installationens eget namn (ARK_BAS_URL) släpps igenom.
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: värdnamn(process.env.ARK_BAS_URL),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // server/ ligger utanför src men är produktionskod – flödestjänsten är
    // Arkitektens enda yta utåt, och dess löfte om att inte kunna skriva
    // bevakas av ett test som måste ingå i sviten för att betyda något.
    // .lokalt/: installationens egna tester (monterade av driftrepot, aldrig i git).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "server/**/*.test.ts", ".lokalt/**/*.test.ts"],
  },
});
