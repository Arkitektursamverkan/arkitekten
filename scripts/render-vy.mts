/** ENGÅNGSSKRIPT: renderar ett flöde med dess EGNA vyinställningar. */
import fs from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { compileDraft } from "@/core/draft";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { layoutModel, PAGE_FORMATS, type PageFormatId } from "@/tools/flowchart/layout/layout";
import { renderSvg } from "@/tools/flowchart/export/svg";
const [fil, ut] = process.argv.slice(2);
const flow = JSON.parse(fs.readFileSync(fil, "utf8"));
const v = flow.view;
const fmt = PAGE_FORMATS[v.pageFormat as PageFormatId];
const vy = filterByPerspective(compileDraft(flow.draft), v.perspective);
const lay = layoutModel(vy, { pageWidth: fmt.width, pageHeight: fmt.width && fmt.aspect ? fmt.width * fmt.aspect : null, scale: v.scale, shrinkToContent: fmt.aspect === null, spacing: v.spacing ?? 1 });
fs.writeFileSync(ut, new Resvg(renderSvg(vy, lay, v.colorMode), { background: "white", fitTo: { mode: "width", value: 1400 } }).render().asPng());
console.log(`${lay.pages.length} del(ar), ${Math.round(lay.width)}x${Math.round(lay.height)} → ${ut}`);
