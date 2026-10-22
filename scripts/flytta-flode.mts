/**
 * Flyttar ett flöde i katalogen från terminalen.
 *
 *   npx tsx scripts/flytta-flode.mts <id> "<kategori>" ["<underkategori>"]
 *
 * Går genom `sättPlacering` i flow-store – SAMMA väg som katalogen använder –
 * så att invariant 11 gäller också härifrån: bara `category`/`subcategory`
 * skrivs, historiken och `savedAt` står still, och posten SPRIDS så att okända
 * fält överlever. Att redigera JSON-filen för hand hade gjort samma sak i det
 * enkla fallet och tyst fel sak i alla andra.
 */
import fs from "node:fs";
import path from "node:path";
import { sättPlacering, type FlowStore, type SavedFlow } from "@/core/flow-store";

const MAPP = "flows";

const diskStore: FlowStore = {
  kind: "disk",
  list: async () =>
    fs
      .readdirSync(MAPP)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(MAPP, f), "utf8")) as SavedFlow)
      .map((f) => ({
        id: f.id,
        name: f.name,
        savedAt: f.savedAt,
        stepCount: f.draft?.steps?.length ?? 0,
        versionCount: f.versions?.length ?? 0,
      })),
  load: async (id) => JSON.parse(fs.readFileSync(path.join(MAPP, `${id}.json`), "utf8")) as SavedFlow,
  save: async (flow) =>
    fs.writeFileSync(path.join(MAPP, `${flow.id}.json`), JSON.stringify(flow, null, 2) + "\n"),
  remove: async (id) => fs.unlinkSync(path.join(MAPP, `${id}.json`)),
};

const [id, kategori, underkategori] = process.argv.slice(2);
if (!id) {
  console.error('Ange id: npx tsx scripts/flytta-flode.mts <id> "<kategori>" ["<underkategori>"]');
  process.exit(1);
}

const efter = await sättPlacering(diskStore, id, {
  category: kategori ?? "",
  subcategory: underkategori ?? "",
});
console.log(
  `${efter.name}: ${efter.category ?? "(ingen kategori)"} › ${efter.subcategory ?? "(ingen underkategori)"}`,
);
console.log(`savedAt orört: ${efter.savedAt} · ${efter.versions?.length ?? 0} versioner kvar`);
