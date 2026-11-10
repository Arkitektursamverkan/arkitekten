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
 *
 * VAD som spärras är självt organisationsspecifikt – en lista med namn
 * avslöjar just det den ska skydda. Listan ligger därför UTANFÖR git, i
 * `.lokalt/neutralitet.json` (gitignorerad, som allt i `.lokalt/`):
 *
 *   { "spärrar": [ { "vad": "organisationsnamn", "mönster": "acme", "flaggor": "i" } ] }
 *
 * Saknas filen (en ren klon) hoppar de kontrollerna över; de generiska
 * nedan körs alltid.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROT = path.resolve(__dirname, "..");
const KATALOGER = ["src", "server", "scripts", "e2e", "docs", ".github", "innehallspaket", "kontrakt"];
const FILER = ["README.md", "CLAUDE.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "index.html", "package.json", "Dockerfile", ".env.example", ".gitignore", ".dockerignore", "vite.config.ts"];
/** Den här filen måste kunna nämna det den spärrar. */
const UNDANTAG = new Set(["server/neutralitet.test.ts"]);

const LOKAL_LISTA = path.join(ROT, ".lokalt", "neutralitet.json");

/** Installationens egna spärrar ur `.lokalt/neutralitet.json`, eller null. */
function lokalaSpärrar(): Array<[string, RegExp]> | null {
  if (!fs.existsSync(LOKAL_LISTA)) return null;
  const data = JSON.parse(fs.readFileSync(LOKAL_LISTA, "utf8")) as {
    spärrar?: Array<{ vad?: string; mönster: string; flaggor?: string }>;
  };
  return (data.spärrar ?? []).map((s) => [s.vad ?? "spärrat namn", new RegExp(s.mönster, s.flaggor ?? "")]);
}

/**
 * Generiska spärrar som inte avslöjar något: hemligheter och personliga
 * adresser hör aldrig hemma i produkten, vilken organisation det än gäller.
 */
const GENERISKA: Array<[string, RegExp]> = [
  ["privat nyckel", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AI-nyckel", /sk-ant-[A-Za-z0-9_-]{20,}/],
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

function brottMot(spärrar: Array<[string, RegExp]>): string[] {
  const brott: string[] = [];
  for (const fil of filer()) {
    const rader = fs.readFileSync(path.join(ROT, fil), "utf8").split("\n");
    rader.forEach((rad, i) => {
      for (const [vad, mönster] of spärrar) {
        if (mönster.test(rad)) brott.push(`${fil}:${i + 1} (${vad}): ${rad.trim().slice(0, 100)}`);
      }
    });
  }
  return brott;
}

const LOKALA = lokalaSpärrar();

describe("spärren mot organisationsspecifikt innehåll", () => {
  it.skipIf(!LOKALA)("ingen fil nämner installationens organisation, personer eller namn (.lokalt/neutralitet.json)", () => {
    expect(brottMot(LOKALA ?? [])).toEqual([]);
  });

  it("ingen fil bär en hemlighet", () => {
    expect(brottMot(GENERISKA)).toEqual([]);
  });
});
