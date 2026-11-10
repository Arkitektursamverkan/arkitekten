/**
 * Testdatat för webbläsartesterna: exempelpaketet, inlagt i en tillfällig
 * installation.
 *
 * Innehållet ligger aldrig i repot (beslut 2026-10-07), så en ren klon har
 * ingen flows/ – appen öppnar då startvyn med en tom katalog. Testerna
 * förutsatte tidigare installationens riktiga processer och föll därför i
 * varje klon och i CI. Nu läggs exempelpaketet in i en tom katalog, precis som
 * en ny installation gör, och varje rigg får en EGEN kopia av den (se
 * `startaAppen`). Testerna läser alltså samma neutrala exempel överallt, kan
 * inte påverka varandra och kommer aldrig åt en installations riktiga innehåll.
 *
 * Körs som Vitests globalSetup: mallen skapas en gång före testfilerna, och
 * dess plats (ARK_E2E_ROT) ärvs av arbetsprocesserna. Allt tas bort efteråt.
 *
 * Några tester gäller processer som bara en installation har (en presentation
 * med ramserie, en lång affärsprocess med räls under kedjan). Varken det
 * innehållet eller testerna, som nämner dess processer, ligger i repot
 * (invariant 12): installationen har dem i sin `.lokalt/e2e/` och kopierar in
 * dem i e2e/ för att köra dem. De hoppar över – utom när ARK_E2E_INNEHALL
 * pekar ut installationens innehåll (katalogen som har `flows/`). Dess flöden läggs då in i MALLEN, alltså i den tillfälliga
 * kopian; originalet läses bara.
 */

import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXEMPELKATALOG, importera } from "../server/innehallspaket.mts";

/** Katalogen med installationen som varje rigg utgår från. */
export const mallkatalog = (rot: string) => join(rot, "mall");

export default function setup(): () => void {
  const rot = mkdtempSync(join(tmpdir(), "ark-e2e-"));
  const mall = mallkatalog(rot);
  const inst = { flowsDir: join(mall, "flows"), ramarDir: join(mall, "ramar"), stilarDir: join(mall, "stilar") };
  const rapport = importera(inst, join(EXEMPELKATALOG, "exempel"));
  if (rapport.fel.length || !rapport.inlagda.length) {
    rmSync(rot, { recursive: true, force: true });
    throw new Error(`exempelpaketet gick inte att lägga in: ${rapport.fel.join("; ") || "inget inlagt"}`);
  }
  const innehåll = process.env.ARK_E2E_INNEHALL;
  if (innehåll) {
    const flows = join(innehåll, "flows");
    if (!existsSync(flows)) {
      rmSync(rot, { recursive: true, force: true });
      throw new Error(`ARK_E2E_INNEHALL saknar flows/: ${innehåll}`);
    }
    cpSync(flows, inst.flowsDir, { recursive: true, filter: (f) => !f.includes(".git") });
  }
  process.env.ARK_E2E_ROT = rot;
  return () => rmSync(rot, { recursive: true, force: true });
}
