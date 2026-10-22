/**
 * KONTRAKTET med integrationsplattformen: flödestjänsten svarar exakt som
 * kontraktsexemplet säger (kontrakt/flodestjanst-v1.json). Faller testet är
 * kontraktet ändrat – bygg om exemplet (`npx tsx scripts/bygg-kontraktsexempel.mts`),
 * pröva om ändringen bryter något (docs/gransnitt.md), och lägg den nya filen i
 * plattformens tester också.
 */

import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXEMPELKATALOG, importera } from "./innehallspaket.mjs";
import { kontraktsexempel } from "./kontrakt.mjs";
import { KONTRAKT } from "./flodestjanst.mjs";

it("flödestjänsten svarar som kontraktsexemplet", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kontrakt-"));
  const flowsDir = path.join(tmp, "flows");
  importera({ flowsDir, ramarDir: path.join(tmp, "r"), stilarDir: path.join(tmp, "s") }, path.join(EXEMPELKATALOG, "exempel"));
  const nu = await kontraktsexempel(flowsDir);
  fs.rmSync(tmp, { recursive: true, force: true });
  const fil = path.resolve(__dirname, "..", "kontrakt", `flodestjanst-v${KONTRAKT}.json`);
  expect(JSON.parse(JSON.stringify(nu))).toEqual(JSON.parse(fs.readFileSync(fil, "utf8")));
});
