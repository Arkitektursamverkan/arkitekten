/** Renderar ett flöde direkt ur råtext – för att granska parserns resultat. */
import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";
import { compileDraft } from "@/core/draft";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS, type PageFormatId } from "@/tools/flowchart/layout/layout";
import { renderSvg } from "@/tools/flowchart/export/svg";

const [fil, format = "wide", ut = "ut.png", colorMode = "type"] = process.argv.slice(2);
const text = fs.readFileSync(fil, "utf8");
const model = compileDraft(textToDraft(text));
const vy = filterByPerspective(model, "system");
const fmt = PAGE_FORMATS[format as PageFormatId];
const lay = layoutModel(vy, { pageWidth: fmt.width, scale: 1, shrinkToContent: fmt.aspect === null });
fs.writeFileSync(ut, new Resvg(renderSvg(vy, lay, colorMode as any), { background: "white", fitTo: { mode: "width", value: 1400 } }).render().asPng());
const gw = model.nodes.find(n => n.type === "decision");
console.log(`${format}: ${lay.width}x${lay.height} | gateway "${gw?.label}" i lane: ${gw?.laneId}`);
