/** Renderar ett sparat flöde till PNG så att layouten kan granskas visuellt. */
import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { compileDraft } from "@/core/draft";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS, type PageFormatId } from "@/tools/flowchart/layout/layout";
import { renderSvg } from "@/tools/flowchart/export/svg";

const [fil, format = "free", ut = "ut.png", colorMode = "type"] = process.argv.slice(2);
const flow = JSON.parse(fs.readFileSync(fil, "utf8"));
const model = compileDraft(flow.draft ?? flow);
const vy = filterByPerspective(model, "system");
const fmt = PAGE_FORMATS[format as PageFormatId];
const lay = layoutModel(vy, { pageWidth: fmt.width, pageHeight: fmt.width && fmt.aspect ? fmt.width * fmt.aspect : null, scale: 1 });
const svg = renderSvg(vy, lay, colorMode as any);
const png = new Resvg(svg, { background: "white", fitTo: { mode: "width", value: 1400 } })
  .render().asPng();
fs.writeFileSync(ut, png);
console.log(`${format}: ${lay.width}x${lay.height} px, ${vy.nodes.length} noder → ${ut}`);
