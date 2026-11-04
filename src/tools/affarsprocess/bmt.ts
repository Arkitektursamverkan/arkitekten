/**
 * Export till 2c8 Modeling Tool (.bmt) – filen 2c8 läser in med
 * "File → Import → Import content".
 *
 * En .bmt är ett zip-arkiv med XML i namnrymden
 * `http://www.2c8.com/ns/mt-export`: en fil per modell (`models/<uuid>.xml`,
 * rutorna och kopplingarna) och en per objekt (`symbols/<uuid>.xml`, namnet
 * och beskrivningen). Formatet är inte publicerat; det här följer 2c8:s egna
 * XSD-scheman, som ligger i varje export, och exporter ur 2c8 2025.2.
 *
 * 2c8 bygger på samma metod som verktyget, så översättningen är rak:
 * aktivitet → verksamhetsobjekt → aktivitet (FLOW), roller med RACI (HUKI),
 * IT-stöd och arkiv med INTERRELATES_WITH, krav och tid med ADRESSES. Det
 * som ritas är UTLÄGGET (`layoutAp`) – samma lägen som skärmen och SVG:n.
 *
 * Id:n härleds ur flödets och objektens id:n (`uuidUrNamn`), så att en ny
 * export av samma process uppdaterar modellen i 2c8 i stället för att skapa
 * en kopia. Roller, intressenter, IT-stöd, arkiv och platser är GEMENSAMMA
 * objekt i 2c8: samma namn ger samma objekt i alla processer man exporterar.
 *
 * Det som är unikt för ett 2c8-repository – språkets och beskrivnings-
 * typens id:n – kommer ur inställningar (`BmtInställningar`), aldrig ur koden.
 */

import type { ApLaidOutNode, ApLayout } from "./layout-affarsprocess";
import type { ApNode, ApNodeKind, ApRelation } from "@/core/affarsprocess";
import { tolkaRutin } from "@/core/rutin";
import { uuidUrNamn } from "@/core/namn-id";
import { packaZip } from "@/core/zip";
import { ikonPortRuta } from "./former";

export interface BmtInställningar {
  /** Språkets id i 2c8-repositoryt (languages/<uuid>.xml). */
  språk: string;
  /** Språkets namn, t.ex. "Svenska". */
  språkNamn?: string;
  /** Beskrivningstypen texterna skrivs i ("Beskrivning"). Saknas = inga beskrivningar. */
  beskrivningstyp?: string;
}

export interface BmtKälla {
  /** Flödets id i Arkitekten – roten för alla härledda id:n. */
  flödeId: string;
  /** Modellens namn i 2c8. */
  namn: string;
  /** När flödet senast sparades – blir 2c8:s "last-modified". */
  sparad: Date;
  /** Processens beskrivning, om den har någon. */
  beskrivning?: string;
}

/** Namnrymden för Arkitektens id:n i 2c8 (fast – byts den blir allt kopior). */
const RYMD = "6f1e0c52-6c1f-5d0e-9a51-2c8a7c1e7e57";

const NS = "http://www.2c8.com/ns/mt-export";
const ROUTER = "se.conciliate.mt.router.def.router";

/** Objekttyp och variant i 2c8 per sort. */
function symbolTyp(n: ApNode): { typ: string; variant: string } {
  const lika = (t: string) => ({ typ: t, variant: t });
  switch (n.kind) {
    case "aktivitet":
      return lika("ACTIVITY");
    case "process":
      return lika("PROCESS");
    case "vo":
      return n.voVariant === "dokument"
        ? lika("CORE_DOCUMENT")
        : n.voVariant === "meddelande"
          ? lika("MESSAGE")
          : lika("BUSINESS_OBJECT");
    case "regel":
      return { typ: "DECISION", variant: "OR" };
    case "roll":
      return lika("ROLE");
    case "intressent":
      return lika("INTERESTED_PARTY");
    case "applikation":
      return lika("APPLICATION");
    case "arkiv":
      return lika("ARCHIVE");
    case "krav":
      return lika("REQUIREMENT");
    case "tid":
      return lika("TIME");
    case "forum":
      return lika("FORUM");
    case "plats":
      return lika("LOCATION");
    case "problem":
      return lika("PROBLEM");
    case "risk":
      return lika("RISK");
    case "mojlighet":
      return lika("POSSIBILITY");
    case "textobjekt":
      return lika("TEXT");
  }
}

/** Sorter som är gemensamma objekt i 2c8 – samma namn, samma objekt. */
const GEMENSAMMA = new Set<ApNodeKind>(["roll", "intressent", "applikation", "arkiv", "plats"]);

/** 2c8:s standardstorlek på ikonsymbolerna (avläst ur HFAB:s repo). */
const IKONSTORLEK: Partial<Record<ApNodeKind, { w: number; h: number }>> = {
  vo: { w: 18, h: 18 },
  roll: { w: 30, h: 18 },
  applikation: { w: 20, h: 25 },
  arkiv: { w: 24, h: 27 },
  regel: { w: 30, h: 30 },
  tid: { w: 25, h: 25 },
  plats: { w: 18, h: 25 },
  problem: { w: 30, h: 35 },
  risk: { w: 30, h: 30 },
  mojlighet: { w: 10, h: 38 },
};

/** Kopplingens typ i 2c8. `vänd` = 2c8 drar pilen åt andra hållet. */
function kantTyp(r: ApRelation): { typ: string; vänd?: boolean } | null {
  switch (r.kind) {
    case "flode":
      return { typ: "FLOW" };
    case "huki":
      return {
        typ:
          r.huki === "H"
            ? "RACI_ACCOUNTABLE"
            : r.huki === "K"
              ? "RACI_CONSULTANT"
              : r.huki === "I"
                ? "RACI_INFORMED"
                : "RACI_RESPONSIBLE",
      };
    case "samverkar":
      // Hos oss aktivitet → IT-stöd; i 2c8 IT-stödet → aktiviteten.
      return { typ: "INTERRELATES_WITH", vänd: true };
    case "adresserar":
      return { typ: "ADRESSES" };
    case "styr":
      return { typ: "CONTROLS" };
    case "stodjer":
      return { typ: "SUPPORTS" };
    case "bestar":
      return { typ: "CONSISTS_OF" };
  }
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const r = Math.round;

/** Rutan i 2c8 och etikettens ruta, ur utläggets objekt. */
function geometri(lo: ApLaidOutNode): {
  x: number;
  y: number;
  w: number;
  h: number;
  etikett: { x: number; y: number; w: number; h: number };
} {
  const std = IKONSTORLEK[lo.node.kind];
  const ikon = ikonPortRuta(lo.node.kind, lo.w, lo.h);
  if (std && ikon) {
    // Ikonen i 2c8:s storlek, centrerad där vår ikon står; namnet under.
    const cx = lo.x + ikon.x + ikon.w / 2;
    const cy = lo.y + ikon.y + ikon.h / 2;
    const x = cx - std.w / 2;
    const y = cy - std.h / 2;
    const under = y + std.h + 2;
    return {
      x,
      y,
      w: std.w,
      h: std.h,
      etikett: { x: lo.x, y: under, w: lo.w, h: Math.max(lo.y + lo.h - under, 16) },
    };
  }
  return { x: lo.x, y: lo.y, w: lo.w, h: lo.h, etikett: { x: lo.x, y: lo.y, w: lo.w, h: lo.h } };
}

/** Var linjen mellan två rutors mittpunkter lämnar rutan `a`. */
function kantPunkt(a: { x: number; y: number; w: number; h: number }, mot: { x: number; y: number }) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = mot.x - cx;
  const dy = mot.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** HTML-texten 2c8 lagrar i en beskrivning. */
function beskrivningHtml(text: string | undefined, rutin: string | undefined): string | null {
  const delar: string[] = [];
  if (text?.trim()) delar.push(...text.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`));
  if (rutin?.trim()) {
    const moment = tolkaRutin(rutin);
    delar.push(
      "<ol>" +
        moment
          .map(
            (m) =>
              `<li>${esc(m.text)}${m.under.length ? `<ul>${m.under.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}</li>`,
          )
          .join("") +
        "</ol>",
    );
  }
  return delar.length ? `<html><body>${delar.join("")}</body></html>` : null;
}

function språkdata(språk: string, titel: string): string {
  return (
    `<language-data><title language="${språk}">${esc(titel)}</title>` +
    `<translated language="${språk}">true</translated></language-data>`
  );
}

function beskrivningar(inst: BmtInställningar, html: string | null): string {
  if (!html || !inst.beskrivningstyp) return "<descriptions/>";
  return (
    `<descriptions><description type="${inst.beskrivningstyp}">` +
    `<text language="${inst.språk}">${esc(html)}</text>` +
    `<translated language="${inst.språk}">true</translated></description></descriptions>`
  );
}

/**
 * Bygger arkivets filer (sökväg → innehåll). Ren funktion: samma utlägg och
 * samma källa ger tecken för tecken samma filer.
 */
export function byggBmtFiler(
  lo: ApLayout,
  källa: BmtKälla,
  inst: BmtInställningar,
): Record<string, string> {
  const id = (namn: string) => uuidUrNamn(RYMD, namn);
  const tid = String(källa.sparad.getTime());
  const historik = (namn: string) => id(`${namn}@${tid}`);
  const sp = inst.språk;
  const filer: Record<string, string> = {};

  const symbolId = (n: ApNode) =>
    GEMENSAMMA.has(n.kind)
      ? id(`symbol/${n.kind}/${n.label.trim().toLowerCase()}`)
      : id(`${källa.flödeId}/symbol/${n.id}`);
  const rutaId = (nodId: string) => id(`${källa.flödeId}/ruta/${nodId}`);

  // ---- Objekten (en fil per symbol; ett gemensamt objekt skrivs en gång).
  for (const { node } of lo.nodes) {
    const sid = symbolId(node);
    const fil = `symbols/${sid}.xml`;
    if (filer[fil]) continue;
    const { typ, variant } = symbolTyp(node);
    filer[fil] =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<mt-symbol xmlns="${NS}" uuid="${sid}" type="${typ}" variant="${variant}" last-modified="${tid}" ignore-changes="false">` +
      `<history>${historik(sid)}</history><created>${tid}</created>` +
      språkdata(sp, node.label) +
      `<properties/><documents/>` +
      beskrivningar(inst, beskrivningHtml(node.beskrivning, node.rutin)) +
      `<extension-documents/><plugin-data/></mt-symbol>`;
  }

  // ---- Rutorna.
  const geo = new Map(lo.nodes.map((n) => [n.node.id, geometri(n)]));
  const rutor = lo.nodes
    .map(({ node }, i) => {
      const g = geo.get(node.id)!;
      const vid = rutaId(node.id);
      return (
        `<vertex uuid="${vid}" symbol="${symbolId(node)}"><history>${historik(vid)}</history>` +
        `<x>${r(g.x)}</x><y>${r(g.y)}</y><width>${r(g.w)}</width><height>${r(g.h)}</height>` +
        `<is-owning-symbol>true</is-owning-symbol><z-order>${i}</z-order><show-label>true</show-label>` +
        `<lock-proportions>false</lock-proportions><center-label>false</center-label><size-ratio>1.0</size-ratio>` +
        `<holder>false</holder><frozen>false</frozen>` +
        `<label-bounds language="${sp}"><x>${r(g.etikett.x)}</x><y>${r(g.etikett.y)}</y>` +
        `<width>${r(g.etikett.w)}</width><height>${r(g.etikett.h)}</height></label-bounds>` +
        `<properties/></vertex>`
      );
    })
    .join("");

  // ---- Kopplingarna.
  const kanter = lo.relations
    .map((rel) => {
      const t = kantTyp(rel);
      const [frånId, tillId] = t?.vänd ? [rel.target, rel.source] : [rel.source, rel.target];
      const a = geo.get(frånId);
      const b = geo.get(tillId);
      if (!t || !a || !b) return "";
      const p1 = kantPunkt(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const p2 = kantPunkt(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
      const eid = id(`${källa.flödeId}/kant/${rel.id}`);
      // HUKI-bokstaven bärs av kopplingens typ – bara regelns svar är text.
      const etikett = rel.kind === "huki" ? "" : (rel.label ?? "");
      return (
        `<edge uuid="${eid}" type="${t.typ}" router-id="${ROUTER}" source-vertex="${rutaId(frånId)}" target-vertex="${rutaId(tillId)}">` +
        `<history>${historik(eid)}</history><label-along-line>false</label-along-line><hide-arrows>false</hide-arrows>` +
        `<language-data>${etikett ? `<title language="${sp}">${esc(etikett)}</title>` : `<title language="${sp}"/>`}` +
        `<translated language="${sp}">true</translated></language-data>` +
        `<control-points><control-point><x>${r(p1.x)}</x><y>${r(p1.y)}</y></control-point>` +
        `<control-point><x>${r(p2.x)}</x><y>${r(p2.y)}</y></control-point></control-points></edge>`
      );
    })
    .join("");

  // ---- Modellen.
  const mid = id(`${källa.flödeId}/modell`);
  const modell =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<mt-model xmlns="${NS}" uuid="${mid}" type="PROCESS_MODEL" last-modified="${tid}" is-draft="false" ignore-changes="false">` +
    `<history>${historik(mid)}</history><created>${tid}</created>` +
    språkdata(sp, källa.namn) +
    `<properties/><documents/>` +
    beskrivningar(inst, beskrivningHtml(källa.beskrivning, undefined)) +
    `<extension-documents/><vertices>${rutor}</vertices><edges>${kanter}</edges>` +
    `<removal-history/><plugin-data/></mt-model>`;

  // Ordningen följer 2c8:s egen export: språk först, modellen, objekten.
  const export_ = new Date(källa.sparad);
  const stämpel = `${export_.getFullYear()}-${String(export_.getMonth() + 1).padStart(2, "0")}-${String(export_.getDate()).padStart(2, "0")} ${String(export_.getHours()).padStart(2, "0")}:${String(export_.getMinutes()).padStart(2, "0")}`;
  return {
    [`languages/${sp}.xml`]:
      `<?xml version="1.0" encoding="utf-8"?><mt-language xmlns="${NS}" uuid="${sp}">` +
      `<title>${esc(inst.språkNamn ?? "Svenska")}</title><default-language>true</default-language></mt-language>`,
    "version-info.txt": "compatibility-level: 5\nprogram-version: 2025.2.20\n",
    "removal-history.xml": `<?xml version="1.0" encoding="utf-8"?><removal-history></removal-history>`,
    "breakdowns.xml": `<?xml version="1.0" encoding="utf-8"?><breakdowns></breakdowns>`,
    "data.xml": `<?xml version="1.0" encoding="utf-8"?><BMTExport ExportTime="${stämpel}" Version="3.5.0.0"></BMTExport>`,
    [`models/${mid}.xml`]: modell,
    ...filer,
  };
}

/** Hela .bmt-filen. */
export function byggBmt(lo: ApLayout, källa: BmtKälla, inst: BmtInställningar): Uint8Array {
  return packaZip(byggBmtFiler(lo, källa, inst), källa.sparad);
}
