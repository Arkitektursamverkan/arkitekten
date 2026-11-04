/**
 * Provexport till 2c8 (.bmt) av ett sparat affärsprocessflöde.
 *
 *   npx tsx scripts/exportera-bmt.mts <flöde.json> <ut.bmt> --mall <export.bmt> [--anvandare <uuid>] [--beskrivningstyp <uuid>] [--lyft]
 *
 * MALLEN är en vanlig export ur MÅL-repositoryt. Språket läses ur den, och
 * repositoryts profil, scheman, användare och beskrivningstyp följer med
 * ordagrant. `--anvandare` väljer vem som står som skapare (en användare i
 * mallens users/; förval: den första). `--beskrivningstyp` (förval: typen som
 * heter "Beskrivning" i mallen) är där texterna och rutinerna skrivs. `--lyft` gör
 * först om checklistor i kraven till rutiner (`lyftUtChecklistor`), som
 * knappen i inspektören gör. Flödesfilen läses bara; den skrivs aldrig.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { compileAp, lyftUtChecklistor } from "../src/core/affarsprocess";
import { layoutAp } from "../src/tools/affarsprocess/layout-affarsprocess";
import { byggBmt } from "../src/tools/affarsprocess/bmt";

const arg = process.argv.slice(2);
const flagga = (n: string) => {
  const i = arg.indexOf(n);
  return i >= 0 ? arg[i + 1] : undefined;
};
const MED_VÄRDE = ["--mall", "--anvandare", "--beskrivningstyp"];
const [inFil, utFil] = arg.filter((a, i) => !a.startsWith("--") && !MED_VÄRDE.includes(arg[i - 1]));
// Flera mallar går att ange; den första vinner, de följande fyller i det som
// saknas (t.ex. ett schema som en tom modell inte hade med).
const mallFiler = arg.flatMap((a, i) => (a === "--mall" && arg[i + 1] ? [arg[i + 1]] : []));
const mallFil = mallFiler[0];
if (!inFil || !utFil || !mallFil) {
  console.error("Användning: exportera-bmt.mts <flöde.json> <ut.bmt> --mall <export.bmt> [--anvandare <uuid>] [--beskrivningstyp <uuid>] [--lyft]");
  process.exit(1);
}

// Mallen packas upp med systemets python (zipfile) – skriptet körs bara här.
const mall: Record<string, Uint8Array> = {};
const extra = (fil: string, endast: (n: string) => boolean) => {
  const j = execFileSync("python3", ["-I", "-c",
    "import zipfile,json,base64,sys;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([[n,base64.b64encode(z.read(n)).decode()] for n in z.namelist()]))",
    fil], { maxBuffer: 1 << 30 }).toString();
  for (const [n, b] of JSON.parse(j) as [string, string][]) if (!(n in mall) && endast(n)) mall[n] = Buffer.from(b, "base64");
};
const json = execFileSync("python3", ["-I", "-c",
  "import zipfile,json,base64,sys;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([[n,base64.b64encode(z.read(n)).decode()] for n in z.namelist()]))",
  mallFil], { maxBuffer: 1 << 30 }).toString();
for (const [n, b] of JSON.parse(json) as [string, string][]) mall[n] = Buffer.from(b, "base64");
// Ur de följande mallarna bara scheman: språk, användare och profil hör till mål-repositoryt.
for (const f of mallFiler.slice(1)) extra(f, (n) => n.endsWith("/schema.xsd"));
const text = (n: string) => Buffer.from(mall[n]).toString("utf8");

const språkFil = Object.keys(mall).find((n) => /^languages\/[0-9a-f-]{36}\.xml$/.test(n));
if (!språkFil) throw new Error("Mallen har inget språk (languages/).");
const språk = språkFil.slice(10, -4);
const användareId = flagga("--anvandare") ?? Object.keys(mall).find((n) => /^users\/[0-9a-f-]{36}\.xml$/.test(n))?.slice(6, -4);
const typer = Object.keys(mall).filter((n) => /^description-types\/[0-9a-f-]{36}\.xml$/.test(n));
const beskrivningstyp =
  flagga("--beskrivningstyp") ?? typer.find((n) => />Beskrivning</.test(text(n)))?.slice(18, -4);
const typsnitt = Object.keys(mall)
  .filter((n) => n.startsWith("models/") && n.endsWith(".xml"))
  .map((n) => text(n).match(/<font-name>([^<]+)</)?.[1])
  .find(Boolean);

const flöde = JSON.parse(readFileSync(inFil, "utf8"));
const draft = arg.includes("--lyft") ? lyftUtChecklistor(flöde.draft) : flöde.draft;
const lo = layoutAp(compileAp(draft), { edgeStyles: draft.edgeStyles });
const bmt = await byggBmt(
  lo,
  { flödeId: flöde.id, namn: flöde.name ?? draft.title, sparad: new Date(flöde.savedAt) },
  {
    språk,
    beskrivningstyp,
    typsnitt,
    användare: användareId ? { id: användareId, förnamn: "Arkitekten" } : undefined,
    mall,
  },
);
writeFileSync(utFil, bmt);
console.log(
  `${utFil}: ${lo.nodes.length} rutor, ${lo.relations.length} kopplingar, ${bmt.length} byte` +
    ` (språk ${språk}, skapare ${användareId ?? "–"}, beskrivningstyp ${beskrivningstyp ?? "–"}, typsnitt ${typsnitt ?? "–"})`,
);
