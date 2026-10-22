/**
 * SPÄRREN: produkten är generell (CLAUDE.md, "Riktning").
 *
 * Koden delas med andra organisationer. Inget organisationsnamn, inget
 * personnamn och ingen anspelning på en extern processprodukt får smyga in
 * igen – inte i kod, tester, skript, dokumentation eller konfiguration. Det
 * som gäller en viss organisation hör hemma i dess driftrepo, dess
 * innehållspaket eller i `.lokalt/`.
 *
 * Testet läser filerna på disk, så det fångar också det som ännu inte
 * committats.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROT = path.resolve(__dirname, "..");
const KATALOGER = ["src", "server", "scripts", "e2e", "docs", ".github", "innehallspaket", "kontrakt"];
const FILER = ["README.md", "CLAUDE.md", "index.html", "package.json", "Dockerfile", ".env.example", ".gitignore", ".dockerignore", "vite.config.ts"];
/** Den här filen måste kunna nämna det den spärrar. */
const UNDANTAG = new Set(["server/neutralitet.test.ts"]);

const SPÄRRAR: Array<[string, RegExp]> = [
  ["organisationsnamn", /hfab|halmstad/i],
  ["extern processprodukt", /2c8|(?<![#0-9a-f])c8(?![0-9a-f])/i],
  ["personnamn", /\b(David|Victor|Bylund|Bjärlestam|Anna Lena)\b/],
];

function filer(): string[] {
  const ut: string[] = [];
  const gå = (rel: string) => {
    const full = path.join(ROT, rel);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) {
      for (const f of fs.readdirSync(full)) if (f !== "node_modules") gå(path.join(rel, f));
    } else if (/\.(ts|tsx|mts|mjs|js|css|html|md|json|ya?ml|sh)$/.test(rel) || FILER.includes(rel)) {
      ut.push(rel);
    }
  };
  for (const k of KATALOGER) gå(k);
  for (const f of FILER) if (fs.existsSync(path.join(ROT, f))) ut.push(f);
  return ut.filter((f) => !UNDANTAG.has(f.split(path.sep).join("/")));
}

describe("spärren mot organisationsspecifikt innehåll", () => {
  it("ingen fil nämner en organisation, en person eller en extern processprodukt", () => {
    const brott: string[] = [];
    for (const fil of filer()) {
      const rader = fs.readFileSync(path.join(ROT, fil), "utf8").split("\n");
      rader.forEach((rad, i) => {
        for (const [vad, mönster] of SPÄRRAR) {
          if (mönster.test(rad)) brott.push(`${fil}:${i + 1} (${vad}): ${rad.trim().slice(0, 100)}`);
        }
      });
    }
    expect(brott).toEqual([]);
  });
});
