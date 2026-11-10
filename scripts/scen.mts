/**
 * Bygger en SCEN ur en affärsprocess och kontrollerar den mot exportören.
 *
 * Scenen är ett färdigruttat utlägg som EA-portalen kan rita utan att äga en
 * rad av Arkitektens layoutregler – kontraktet står i `core/scen.ts` och
 * byggandet i `tools/affarsprocess/scen-affarsprocess.ts`. Det här skriptet är bara skalet: det
 * läser en fil, anropar modulen och skriver ut resultatet.
 *
 * `--jamfor` är sanningsprovet: varje bana scenen påstår ska finnas
 * tecken-för-tecken i `renderApSvg`:s utdata ur SAMMA utlägg. Går de isär har
 * scenen och exporten olika uppfattning om var en pil går.
 *
 * Ingenting skrivs till `flows/` – skriptet läser bara (invariant 11).
 *
 *   npx tsx scripts/scen.mts ap-<flödes-id> --jamfor
 *   npx tsx scripts/scen.mts ap-<flödes-id> scen.json
 *   npx tsx scripts/scen.mts --alla --jamfor
 */

import fs from "node:fs";
import path from "node:path";
import type { SavedFlow } from "@/core/flow-store";
import { byggApScen, byggUtlägg } from "@/tools/affarsprocess/scen-affarsprocess";
import { renderApSvg } from "@/tools/affarsprocess/svg-affarsprocess";

const FLÖDEN = "flows";

const args = process.argv.slice(2);
const ALLA = args.includes("--alla");
const JÄMFÖR = args.includes("--jamfor");
const positionella = args.filter((a) => !a.startsWith("--"));

const idn = ALLA
  ? fs
      .readdirSync(FLÖDEN)
      .filter((f) => f.startsWith("ap-") && f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort()
  : positionella.slice(0, 1);

if (!idn.length) {
  console.error(
    "Ange ett flödesid eller --alla.\n  npx tsx scripts/scen.mts <id> [ut.json] [--jamfor]",
  );
  process.exit(1);
}

let felTotalt = 0;

for (const id of idn) {
  const sökväg = path.join(FLÖDEN, `${id}.json`);
  if (!fs.existsSync(sökväg)) {
    console.error(`Hittar inte ${sökväg}`);
    process.exit(1);
  }
  const flöde = JSON.parse(fs.readFileSync(sökväg, "utf8")) as SavedFlow;
  const scen = byggApScen(flöde);

  const storlek = Buffer.byteLength(JSON.stringify(scen), "utf8");
  let rad =
    `${id}  (version ${scen.flöde.beteckning ?? "?"}, ${scen.flöde.status ?? "?"})\n` +
    `  ${scen.noder.length} objekt, ${scen.kanter.length} kopplingar, ` +
    `${scen.sidor.length} del(ar), ${Math.round(scen.bredd)}×${Math.round(scen.höjd)} px, ` +
    `${(storlek / 1024).toFixed(1)} kB scen`;

  if (JÄMFÖR) {
    // Samma utlägg som scenen kom ur – annars jämförs två saker som råkar bli
    // lika i stället för en sak med sig själv.
    const { lo, textScale } = byggUtlägg(flöde);
    const svg = renderApSvg(lo, { textScale });
    const iSvg = new Set(Array.from(svg.matchAll(/ d="([^"]+)"/g), (m) => m[1]));
    const fel = scen.kanter.filter((k) => !iSvg.has(k.d));
    felTotalt += fel.length;
    rad += fel.length
      ? `\n  ✗ ${fel.length} avvikelser mot exportören:`
      : "\n  ✓ alla banor matchar exportörens SVG";
    for (const f of fel.slice(0, 5)) rad += `\n      ${f.id} (${f.källa} → ${f.mål})`;
  }
  console.log(rad);

  const ut = positionella[1];
  if (ut && !ALLA) {
    fs.writeFileSync(ut, JSON.stringify(scen, null, 2), "utf8");
    console.log(`  → ${ut}`);
  }
}

if (JÄMFÖR) {
  console.log(felTotalt ? `\n${felTotalt} avvikelser TOTALT` : "\nAlla scener matchar exportören.");
  if (felTotalt) process.exit(1);
}
