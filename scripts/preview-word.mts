/**
 * Renderar ett sparat flöde som Word-figurer – en PNG per del, rastrerad i den
 * bredd figuren faktiskt får i en stående rapport (160 mm vid 300 dpi).
 *
 * Det är enda sättet att se om nodtexten går att läsa: på skärmen ser allt bra
 * ut, det är nedskalningen till spaltbredden som avgör.
 *
 *   npx tsx scripts/preview-word.mts flows/bestallning-ny.json /tmp/ut
 */
import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { compileDraft } from "@/core/draft";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { extractPage, layoutModel, PAGE_FORMATS, wordPointSize } from "@/tools/flowchart/layout/layout";
import { renderSvgSized } from "@/tools/flowchart/export/svg";

const [fil, ut] = process.argv.slice(2);
const vy = filterByPerspective(compileDraft(JSON.parse(fs.readFileSync(fil, "utf8")).draft), "system");
const lay = layoutModel(vy, { pageWidth: PAGE_FORMATS.word.width, scale: 1, shrinkToContent: true });
console.log(`${lay.pages.length} figurer, bredd ${lay.width}, nodtext ${wordPointSize(lay.width).toFixed(1)} pt i Word`);
for (let i = 0; i < lay.pages.length; i++) {
  const del = lay.pages.length > 1 ? extractPage(lay, i) : lay;
  const { svg, width, height } = renderSvgSized(vy, del, "type");
  // 160 mm bred figur i 300 dpi = 1890 px – så ser den ut i den utskrivna rapporten.
  const png = new Resvg(svg, { background: "white", fitTo: { mode: "width", value: 1890 } }).render().asPng();
  fs.writeFileSync(`${ut}-del${i + 1}.png`, png);
  console.log(`  del ${i + 1}: ${Math.round(width)}x${Math.round(height)} logiskt`);
}
