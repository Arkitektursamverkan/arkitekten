/**
 * Renderar affärsprocesser till PNG för ögongranskning.
 *
 * `rita-forhandsvisning.mts` ritar FLÖDESSCHEMAN; det här är motsvarigheten
 * för verktyget Affärsprocess, med samma layout och samma SVG-export som skärmen och
 * filen använder. Att mäta korsningar (`granska-ap-linjer.mts`) säger vilka
 * bilder som är röriga men inte hur de ser ut – det här säger det.
 *
 *   npx tsx scripts/rita-affarsprocess.mts <utmapp> [id-fragment ...]
 */
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { compileAp } from "@/core/affarsprocess";
import { layoutAp } from "@/tools/affarsprocess/layout-affarsprocess";
import { renderApSvg } from "@/tools/affarsprocess/svg-affarsprocess";

const [ut, ...filter] = process.argv.slice(2);
fs.mkdirSync(ut, { recursive: true });
const filer = fs.readdirSync("flows").filter((f) => f.startsWith("ap-") && f.endsWith(".json"))
  .filter((f) => !filter.length || filter.some((x) => f.includes(x)));
for (const fil of filer.sort()) {
  const flöde = JSON.parse(fs.readFileSync(path.join("flows", fil), "utf8"));
  const draft = flöde.versions?.[flöde.versions.length - 1]?.draft ?? flöde.draft;
  const lo = layoutAp(compileAp(draft), { edgeStyles: draft.edgeStyles });
  const svg = renderApSvg(lo, { textScale: flöde.view?.textScale ?? 1 });
  const png = new Resvg(svg, { background: "white", fitTo: { mode: "width", value: Math.min(2600, Math.max(1400, lo.width)) } }).render().asPng();
  const namn = fil.replace(/\.json$/, "");
  fs.writeFileSync(path.join(ut, `${namn}.png`), png);
  console.log(`${namn}: ${Math.round(lo.width)}x${Math.round(lo.height)}`);
}
