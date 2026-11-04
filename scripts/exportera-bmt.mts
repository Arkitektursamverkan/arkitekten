/**
 * Provexport till 2c8 (.bmt) av ett sparat affärsprocessflöde.
 *
 *   npx tsx scripts/exportera-bmt.mts <flöde.json> <ut.bmt> --sprak <uuid> [--beskrivningstyp <uuid>] [--lyft]
 *
 * Språkets och beskrivningstypens id:n är 2c8-repositoryts egna – de står i en
 * export ur det repositoryt (languages/, description-types/). `--lyft` gör
 * först om checklistor i kraven till rutiner (`lyftUtChecklistor`), som
 * knappen i inspektören gör. Flödesfilen läses bara; den skrivs aldrig.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compileAp, lyftUtChecklistor } from "../src/core/affarsprocess";
import { layoutAp } from "../src/tools/affarsprocess/layout-affarsprocess";
import { byggBmt } from "../src/tools/affarsprocess/bmt";

const arg = process.argv.slice(2);
const flagga = (n: string) => {
  const i = arg.indexOf(n);
  return i >= 0 ? arg[i + 1] : undefined;
};
const [inFil, utFil] = arg.filter((a, i) => !a.startsWith("--") && !arg[i - 1]?.startsWith("--sprak") && !arg[i - 1]?.startsWith("--beskrivningstyp"));
const språk = flagga("--sprak");
if (!inFil || !utFil || !språk) {
  console.error("Användning: exportera-bmt.mts <flöde.json> <ut.bmt> --sprak <uuid> [--beskrivningstyp <uuid>] [--lyft]");
  process.exit(1);
}
const flöde = JSON.parse(readFileSync(inFil, "utf8"));
const draft = arg.includes("--lyft") ? lyftUtChecklistor(flöde.draft) : flöde.draft;
const lo = layoutAp(compileAp(draft), { edgeStyles: draft.edgeStyles });
const bmt = byggBmt(
  lo,
  { flödeId: flöde.id, namn: flöde.name ?? draft.title, sparad: new Date(flöde.savedAt) },
  { språk, beskrivningstyp: flagga("--beskrivningstyp") },
);
writeFileSync(utFil, bmt);
console.log(`${utFil}: ${lo.nodes.length} objekt, ${lo.relations.length} kopplingar, ${bmt.length} byte`);
