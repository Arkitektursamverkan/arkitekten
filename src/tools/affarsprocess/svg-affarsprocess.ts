/**
 * SVG-export för verktyget Affärsprocess. Renderar layoutAp-utlägget till en
 * fristående SVG med SAMMA formmodul som canvasen (former.ts) och SAMMA
 * router som allt annat (edge-router.ts) – skärm och fil kan inte glida isär.
 *
 * Relationsstilar (färgerna ur symbolstilen):
 *  - Flöde: heldragen, fylld pil – förädlingskedjan.
 *  - HUKI / Adresserar / Samverkar: heldragen men TUNNARE, egen färg och öppen
 *    pilspets. HUKI-bokstaven står BREDVID strecket, inte i en ruta mitt på.
 */

import type { ApRelationKind } from "@/core/affarsprocess";
import { apRelationsVäg, type ApLayout } from "./layout-affarsprocess";
import { labelBesideMid, pointsToPath, type Rect } from "../flowchart/layout/edge-router";
import {
  apNodeSvg,
  apMarkerDefs,
  apMarkerId,
  apRelationEtikett,
  apRelationFärg,
  apHörnradie,
} from "./former";
import { esc } from "../flowchart/render/text-util";
import { ramKantAttribut, ramNodAttribut } from "@/core/ram";
import { revisionsMått, revisionsRuta, type Revision } from "../flowchart/export/revision";
import { PAGE_STROKE } from "../flowchart/theme";

const FONT = "Segoe UI, Arial, sans-serif";

/**
 * Annoteringsrelation (satellit) eller förädlingskedja?
 *
 * Båda är HELDRAGNA. Satelliternas streck var förut
 * streckade, och tillsammans med bokstaven i en vit ruta mitt på och en
 * kopplingspunkt bredvid blev en 60 px lång linje fyra saker i stället för en.
 * Skillnaden görs i stället med tjocklek, färg och pilspets.
 */
function ärAnnotering(kind: ApRelationKind): boolean {
  return kind !== "flode";
}

export interface ApSvgOptions {
  /** Global textfaktor (reglaget). */
  textScale?: number;
  /** Rendera endast en viss del (0-baserad). Utelämnad = hela utlägget. */
  page?: number;
  /** Vem/när/vilken version – ritas som en liten ruta nere till höger. */
  revision?: Revision;
}

export function renderApSvg(lo: ApLayout, opts?: ApSvgOptions): string {
  const textScale = opts?.textScale ?? 1;
  const valdaSidor = opts?.page !== undefined ? [lo.pages[opts.page]] : lo.pages;
  const synligaNoder =
    opts?.page !== undefined ? lo.nodes.filter((n) => n.page === opts.page) : lo.nodes;

  const platsAv = new Map(lo.nodes.map((n) => [n.node.id, n]));
  const synligaIds = new Set(synligaNoder.map((n) => n.node.id));

  const delar: string[] = [];

  // ---- Sidramar (bara i flersidigt läge).
  if (lo.pages.length > 1) {
    for (const p of valdaSidor) {
      delar.push(
        `<rect x="${p.x + 1}" y="${p.y + 1}" width="${p.w - 2}" height="${p.h - 2}" fill="none" stroke="${PAGE_STROKE}" stroke-width="1.5" stroke-dasharray="none" rx="4"/>`,
        `<text x="${p.x + p.w - 8}" y="${p.y + p.h - 8}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${PAGE_STROKE}">Del ${p.index + 1} av ${lo.pages.length}</text>`,
      );
    }
  }

  // ---- Relationer (routas med hinder = alla synliga objekt utom ändarna).
  const allaBoxar = new Map<string, Rect>(
    synligaNoder.map((n) => [n.node.id, { x: n.x, y: n.y, w: n.w, h: n.h }]),
  );
  for (const rel of lo.relations) {
    const a = platsAv.get(rel.source);
    const b = platsAv.get(rel.target);
    if (!a || !b) continue;
    // Relationer över ett snitt ritas inte – hänvisningsmärkena tar över.
    if (a.page !== b.page) continue;
    if (!synligaIds.has(rel.source) || !synligaIds.has(rel.target)) continue;

    const obstacles: Rect[] = [];
    for (const [id, r] of allaBoxar) {
      if (id !== rel.source && id !== rel.target) obstacles.push(r);
    }
    const pts = apRelationsVäg(lo, rel, a, b, obstacles);
    const annotering = ärAnnotering(rel.kind);
    // Färg och pilspets kommer ur formmodulen – samma regler som canvasen och
    // scenen läser. HUKI har en färg per ansvarstyp, och alla spetsar är fyllda.
    const färg = apRelationFärg(rel);
    const marker = esc(`url(#${apMarkerId(rel)})`);
    delar.push(
      `<path d="${pointsToPath(pts, apHörnradie() * lo.scale)}" fill="none" stroke="${esc(färg)}" stroke-width="${annotering ? 1.1 : 1.6}" marker-end="${marker}" ${ramKantAttribut(esc, rel.source, rel.target, rel.label)}/>`,
    );

    // Etikett (regelsvar) eller HUKI-bokstav – BREDVID strecket, inte på det.
    const text = apRelationEtikett(rel);
    if (text) {
      // Vid böjen när layouten pekat ut en (gemensam linje per aktivitet),
      // annars mitt på vägen – samma regel som canvasen.
      const utpekad = lo.ports[rel.id];
      const p =
        utpekad?.via && !lo.sides[rel.id]?.waypoint
          ? { x: utpekad.via.x + 6, y: utpekad.via.y, sida: "höger" as const }
          : labelBesideMid(pts);
      const anchor = p.sida === "höger" ? "start" : "middle";
      const baseline = p.sida === "höger" ? "middle" : "auto";
      delar.push(
        `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="${baseline}" font-family="${FONT}" font-size="10.5" font-weight="${rel.kind === "huki" ? 700 : 400}" fill="${rel.kind === "huki" ? färg : "#374151"}">${esc(text)}</text>`,
      );
    }
  }

  // ---- Sidhänvisningar där kedjan korsar ett snitt.
  for (const ref of lo.refs) {
    if (opts?.page !== undefined && ref.page !== opts.page) continue;
    const anchor = ref.riktning === "ut" ? "start" : "end";
    delar.push(
      `<text x="${ref.x.toFixed(1)}" y="${(ref.y + 4).toFixed(1)}" text-anchor="${anchor}" font-family="${FONT}" font-size="10.5" font-style="italic" fill="#6b7280">${ref.riktning === "ut" ? "→ " : ""}${esc(ref.text)}${ref.riktning === "in" ? " →" : ""}</text>`,
    );
  }

  // ---- Objekten (över relationerna, som i flödesschemat).
  for (const n of synligaNoder) {
    // Märkt med id och ruta för ramarna (core/ram.ts), som flödesschemat.
    delar.push(
      `<g ${ramNodAttribut(esc, n.node.id, n.x, n.y, n.w, n.h)}>${apNodeSvg(n.node, n.x, n.y, n.w, n.h, textScale)}</g>`,
    );
  }

  const minX = opts?.page !== undefined ? valdaSidor[0].x : 0;
  const bredd = opts?.page !== undefined ? valdaSidor[0].w : lo.width;
  // Revisionsrutan nere till höger, med samma marginal som utlägget. Den kostar
  // höjd bara när den finns – ett osparat flöde har ingen revision.
  const rev = revisionsMått(opts?.revision);
  const höjd = lo.height + (rev.h ? rev.h + 8 : 0);
  if (rev.h) {
    delar.push(revisionsRuta(minX + bredd - rev.w - 16, lo.height, opts?.revision));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} 0 ${bredd} ${höjd}" width="${bredd}" height="${höjd}" font-family="${FONT}">
<defs>
${apMarkerDefs()}
</defs>
<rect x="${minX}" y="0" width="${bredd}" height="${höjd}" fill="#ffffff"/>
${delar.join("\n")}
</svg>`;
}
