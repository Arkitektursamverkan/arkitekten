/**
 * Export till BMT (.bmt) av ett sparat affärsprocessflöde, utan appen.
 *
 *   npx tsx scripts/exportera-bmt.mts <flöde.json> <ut.bmt> --mall <export.bmt> [--mall <fler.bmt>] [--anvandare <uuid>] [--lyft]
 *
 * MALLEN är en vanlig export ur MÅL-repositoryt – samma fil som installationen
 * pekar ut med ARK_BMT_MALL (se src/tools/affarsprocess/bmt.ts). Ytterligare
 * mallar bidrar bara med scheman som den första saknar (en tom modell har
 * t.ex. inget objektschema). `--lyft` gör först om checklistor i kraven till
 * rutiner, som exportknappen gör. Flödesfilen läses bara; den skrivs aldrig.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { compileAp, lyftUtChecklistor } from "../src/core/affarsprocess";
import { layoutAp } from "../src/tools/affarsprocess/layout-affarsprocess";
import { byggBmt, inställningarUrMall } from "../src/tools/affarsprocess/bmt";
import { läsZip } from "../src/core/zip";

const arg = process.argv.slice(2);
const MED_VÄRDE = ["--mall", "--anvandare"];
const [inFil, utFil] = arg.filter((a, i) => !a.startsWith("--") && !MED_VÄRDE.includes(arg[i - 1]));
const mallar = arg.flatMap((a, i) => (a === "--mall" && arg[i + 1] ? [arg[i + 1]] : []));
const användareId = arg.includes("--anvandare") ? arg[arg.indexOf("--anvandare") + 1] : undefined;
if (!inFil || !utFil || mallar.length === 0) {
  console.error("Användning: exportera-bmt.mts <flöde.json> <ut.bmt> --mall <export.bmt> [--mall <fler.bmt>] [--anvandare <uuid>] [--lyft]");
  process.exit(1);
}

const mall = await läsZip(readFileSync(mallar[0]));
for (const f of mallar.slice(1))
  for (const [n, data] of Object.entries(await läsZip(readFileSync(f))))
    if (n.endsWith("/schema.xsd") && !(n in mall)) mall[n] = data;

const flöde = JSON.parse(readFileSync(inFil, "utf8"));
const draft = arg.includes("--lyft") ? lyftUtChecklistor(flöde.draft) : flöde.draft;
const lo = layoutAp(compileAp(draft), { edgeStyles: draft.edgeStyles });
const inst = inställningarUrMall(mall, { användareId });
const bmt = await byggBmt(lo, { flödeId: flöde.id, namn: flöde.name ?? draft.title, sparad: new Date(flöde.savedAt) }, inst);
writeFileSync(utFil, bmt);
console.log(
  `${utFil}: ${lo.nodes.length} rutor, ${lo.relations.length} kopplingar, ${bmt.length} byte` +
    ` (språk ${inst.språk}, skapare ${inst.användare?.id ?? "–"}, beskrivningstyp ${inst.beskrivningstyp ?? "–"}, typsnitt ${inst.typsnitt ?? "–"})`,
);
