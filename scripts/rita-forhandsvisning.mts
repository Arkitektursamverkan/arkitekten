/**
 * Renderar sparade flöden till PNG med FLÖDETS EGNA vyval – så att bilden man
 * granskar är den användaren får, inte en variant med andra inställningar.
 *
 *   npx tsx scripts/rita-forhandsvisning.mts <utmapp> <flödes-id> [flödes-id ...]
 */
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { compileDraft } from "@/core/draft";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS, type PageFormatId } from "@/tools/flowchart/layout/layout";
import { renderSvgSized } from "@/tools/flowchart/export/svg";

const [ut, ...ids] = process.argv.slice(2);
fs.mkdirSync(ut, { recursive: true });
for (const id of ids) {
  const flow = JSON.parse(fs.readFileSync(path.join("flows", `${id}.json`), "utf8"));
  const v = flow.view ?? {};
  const fmt = PAGE_FORMATS[(v.pageFormat as PageFormatId) ?? "free"];
  const modell = filterByPerspective(compileDraft(flow.draft), v.perspective ?? "system");
  const lay = layoutModel(modell, {
    pageWidth: fmt.width,
    pageHeight: fmt.width && fmt.aspect ? fmt.width * fmt.aspect : null,
    scale: v.scale ?? 1,
    shrinkToContent: fmt.aspect === null,
    spacing: v.spacing ?? 1,
  });
  const { svg } = renderSvgSized(modell, lay, v.colorMode ?? "type", v.textScale ?? 1, null);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1500 } }).render().asPng();
  fs.writeFileSync(path.join(ut, `${id}.png`), png);
  console.log(`${id}: ${lay.pages.length} del(ar), ${Math.round(lay.width)}x${Math.round(lay.height)}`);
}
