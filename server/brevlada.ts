/**
 * AI-BREVLÅDORNA på disk – var de ligger och vilka begäranden som väntar.
 *
 * Bryggan (server/brygga.ts) lägger varje begäran i den inloggades EGEN låda:
 * `<ARK_DIR>/anvandare/<hash av användar-id>/request.json`, svaret bredvid
 * (`response.json`) och underlagen i `underlag/`. Bara i ÖPPEN drift – där
 * alla är samma användare – finns en enda låda direkt i `<ARK_DIR>`.
 *
 * Det gäller också utvecklarläget (ARK_UTVECKLARLAGE=1, Claude Code svarar
 * för hand). Den som svarar hittar begäran med `väntandeBegäranden` – eller
 * `npx tsx scripts/brevlada.mts`, som listar dem – och skriver svaret i SAMMA
 * katalog som begäran låg i. Ren modul utan bryggans beroenden, så att skript
 * kan läsa den.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const REQUEST = "request.json";
export const RESPONSE = "response.json";
export const UNDERLAG = "underlag";
export const ANVÄNDARLÅDOR = "anvandare";

/** Katalogen för en användares brevlåda; `null` = den delade (öppen drift). */
export function brevlådekatalog(arkDir: string, användarId: string | null): { nyckel: string; katalog: string } {
  if (användarId === null) return { nyckel: "", katalog: arkDir };
  const nyckel = crypto.createHash("sha256").update(användarId).digest("hex").slice(0, 32);
  return { nyckel, katalog: path.join(arkDir, ANVÄNDARLÅDOR, nyckel) };
}

export interface VäntandeBegäran {
  /** Brevlådans katalog – svaret skrivs här som `response.json`. */
  katalog: string;
  request: string;
  response: string;
  id: string;
  uppdrag: string;
  /** När begäran lades (filens tid), ms. */
  tid: number;
}

/** Alla begäranden som väntar på svar, i alla brevlådor – nyast först. */
export function väntandeBegäranden(arkDir: string): VäntandeBegäran[] {
  const lådor = [arkDir];
  const per = path.join(arkDir, ANVÄNDARLÅDOR);
  if (fs.existsSync(per)) for (const n of fs.readdirSync(per)) lådor.push(path.join(per, n));
  const ut: VäntandeBegäran[] = [];
  for (const katalog of lådor) {
    const request = path.join(katalog, REQUEST);
    const response = path.join(katalog, RESPONSE);
    if (!fs.existsSync(request) || fs.existsSync(response)) continue;
    try {
      const b = JSON.parse(fs.readFileSync(request, "utf8"));
      ut.push({
        katalog,
        request,
        response,
        id: String(b.id ?? ""),
        uppdrag: String(b.uppdrag ?? "tolkning"),
        tid: fs.statSync(request).mtimeMs,
      });
    } catch {
      /* en halvskriven begäran hoppas över */
    }
  }
  return ut.sort((a, b) => b.tid - a.tid);
}
