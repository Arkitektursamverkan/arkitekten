/**
 * Listar AI-begärandena som väntar på svar – i alla brevlådor.
 *
 * I utvecklarläget med inloggning har varje användare en egen brevlåda
 * (`<ARK_DIR>/anvandare/<hash>/`, server/brevlada.ts). Den som svarar för hand
 * (Claude Code) läser `request.json` i katalogen som listas och skriver
 * `response.json` BREDVID den, med `requestId` = begärans `id`.
 *
 *   npx tsx scripts/brevlada.mts            # ARK_DIR, annars .ark
 *   npx tsx scripts/brevlada.mts <katalog>
 */

import path from "node:path";
import { väntandeBegäranden } from "../server/brevlada";

const arkDir = path.resolve(process.argv[2] ?? process.env.ARK_DIR?.trim() ?? ".ark");
const väntande = väntandeBegäranden(arkDir);
if (!väntande.length) {
  console.log(`Inga väntande begäranden i ${arkDir}.`);
} else {
  for (const b of väntande) {
    const ålder = Math.round((Date.now() - b.tid) / 1000);
    console.log(`${b.id} · ${b.uppdrag} · ${ålder} s sedan`);
    console.log(`  begäran: ${path.relative(process.cwd(), b.request)}`);
    console.log(`  svaret:  ${path.relative(process.cwd(), b.response)}`);
  }
}
