/**
 * Bygger kontraktsexemplet `kontrakt/flodestjanst-v<N>.json` ur exempelpaketet:
 * precis det flödestjänsten svarar på /api/flows och /api/flows/{id}/scen.
 *
 * Filen är kontraktet i exempelform. `server/kontrakt.test.ts` kräver att
 * tjänsten svarar exakt så, och plattformen har en kopia som dess tester
 * läser – ändras svaret ändras filen, och skillnaden syns i båda repona.
 *
 *   npx tsx scripts/bygg-kontraktsexempel.mts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importera, EXEMPELKATALOG } from "../server/innehallspaket.mjs";
import { kontraktsexempel } from "../server/kontrakt.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kontrakt-"));
const flowsDir = path.join(tmp, "flows");
importera({ flowsDir, ramarDir: path.join(tmp, "ramar"), stilarDir: path.join(tmp, "stilar") }, path.join(EXEMPELKATALOG, "exempel"));
const exempel = await kontraktsexempel(flowsDir);
const ut = path.resolve(`kontrakt/flodestjanst-v${exempel.kontrakt}.json`);
fs.writeFileSync(ut, JSON.stringify(exempel, null, 2) + "\n");
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Skrivet ${ut}`);
