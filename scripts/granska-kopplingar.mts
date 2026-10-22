/**
 * Granskar att ingen KOPPLING ritas utanför bilden, i alla sparade
 * flödesscheman, med flödets EGNA vyinställningar (format, skala, avstånd).
 *
 *   npx tsx scripts/granska-kopplingar.mts [--alla] [flödes-id …]
 *
 * Mäter i den färdiga SVG:n – alltså det som faktiskt ritas, oavsett vilken
 * del av exporten som drog linjen (sekvensflöde, dataassociation,
 * meddelandeflöde, sidhänvisningens stubbe). En punkt är "utanför" när den
 * inte ligger i någon dels ram. Sidhänvisningarnas stubbar kontrolleras
 * dessutom för sig: de ska vara vinkelräta, aldrig sneda.
 */
import fs from "node:fs";
import path from "node:path";
import { compileDraft } from "@/core/draft";
import { filterByPerspective } from "@/tools/flowchart/perspective";
import { hänvisningsStubbe, layoutModel, PAGE_FORMATS, type PageFormatId } from "@/tools/flowchart/layout/layout";
import { renderSvg } from "@/tools/flowchart/export/svg";

const TOLERANS = 1;
const arg = process.argv.slice(2);
const alla = arg.includes("--alla");
const valda = arg.filter((a) => !a.startsWith("--"));

export function granska(fil: string) {
  const flow = JSON.parse(fs.readFileSync(fil, "utf8"));
  const v = flow.view ?? { perspective: "system", pageFormat: "word", scale: 0.6, colorMode: "type" };
  const fmt = PAGE_FORMATS[v.pageFormat as PageFormatId];
  const vy = filterByPerspective(compileDraft(flow.draft), v.perspective);
  const lo = layoutModel(vy, {
    pageWidth: fmt.width,
    pageHeight: fmt.width && fmt.aspect ? fmt.width * fmt.aspect : null,
    scale: v.scale,
    shrinkToContent: fmt.aspect === null,
    spacing: v.spacing ?? 1,
  });
  const svg = renderSvg(vy, lo, v.colorMode);
  const i = svg.indexOf('<g transform="translate(0,');
  const flöde = svg.slice(i, svg.lastIndexOf("</g></g>"));
  const inne = (x: number, y: number) =>
    lo.pages.some(
      (p) => x >= p.x - TOLERANS && x <= p.x + p.w + TOLERANS && y >= p.y - TOLERANS && y <= p.y + p.h + TOLERANS,
    );
  const fynd: string[] = [];
  for (const m of flöde.matchAll(/<(path|line|polyline)\b([^>]*)>/g)) {
    const attr = m[2];
    // Bara LINJER: en fylld form (nod, pilspets) är inte en koppling.
    if (!/fill="none"/.test(attr) && m[1] === "path") continue;
    const tal = m[1] === "line"
      ? ["x1", "y1", "x2", "y2"].map((k) => Number(/\b/.source && new RegExp(`${k}="([-\\d.]+)"`).exec(attr)?.[1]))
      : [...(/(?:\bd|points)="([^"]*)"/.exec(attr)?.[1] ?? "").matchAll(/-?\d+(?:\.\d+)?/g)].map((t) => Number(t[0]));
    const ute: string[] = [];
    for (let k = 0; k + 1 < tal.length; k += 2) if (!inne(tal[k], tal[k + 1])) ute.push(`${Math.round(tal[k])},${Math.round(tal[k + 1])}`);
    if (ute.length) fynd.push(`${/data-[\w-]+="[^"]*"/.exec(attr)?.[0] ?? (/dasharray/.test(attr) ? "streckad" : "linje")} → ${ute.join(" ")}`);
  }
  // En sidhänvisning är kopplingens ände på den här delen: stubben ska börja
  // PÅ nodens kontur och gå vinkelrätt in i märket. Ett snett eller löst streck
  // läses som en koppling som inte mynnar ut i något.
  for (const r of lo.pageRefs) {
    const väg = hänvisningsStubbe(r);
    const sned = väg.some((p, k) => k > 0 && Math.abs(p.x - väg[k - 1].x) > 0.5 && Math.abs(p.y - väg[k - 1].y) > 0.5);
    if (sned) fynd.push(`hänvisning "${r.text}" vid ${r.nodeId} har sned stubbe`);
    if (väg.some((p) => !inne(p.x, p.y)) || !inne(r.x, r.y) || !inne(r.x + r.w, r.y + r.h))
      fynd.push(`hänvisning "${r.text}" vid ${r.nodeId} ligger utanför delen`);
  }
  return { namn: flow.name as string, delar: lo.pages.length, fynd };
}

const dir = path.join(process.cwd(), "flows");
let fel = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  if (f.startsWith("ap-")) continue;
  if (valda.length && !valda.includes(f.replace(/\.json$/, ""))) continue;
  const flow = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (flow?.draft?.diagramType === "affarsprocess") continue;
  const r = granska(path.join(dir, f));
  if (r.fynd.length) fel++;
  if (r.fynd.length || alla) {
    console.log(`${r.fynd.length ? "✗" : "✓"} ${f.replace(/\.json$/, "")} – ${r.namn} (${r.delar} del/ar)`);
    for (const x of r.fynd) console.log(`    ${x}`);
  }
}
console.log(`\n${fel} flöde(n) med kopplingar utanför bilden.`);
