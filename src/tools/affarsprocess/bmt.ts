/**
 * Export till BMT (.bmt) – modellarkivet som ett processmodelleringsverktyg
 * med samma metod läser in under "Import content". Produkten nämner inte
 * verktyget (se server/neutralitet.test.ts); allt som hör till det kommer ur
 * MALLEN, en vanlig export ur mål-repositoryt som installationen pekar ut
 * (`ARK_BMT_MALL`): XML-namnrymden, språket, användaren, beskrivningstypen,
 * repositoryts profil och schemana.
 *
 * Arkivet är ett zip med XML: en fil per modell (`models/<uuid>.xml`, rutorna
 * och kopplingarna) och en per objekt (`symbols/<uuid>.xml`, namnet och
 * beskrivningen). Formatet är inte publicerat; det här följer XSD-schemana
 * som ligger i varje export, och verktygets egna exporter.
 *
 * Metoden är densamma som verktygets, så översättningen är rak:
 * aktivitet → verksamhetsobjekt → aktivitet (FLOW), roller med RACI (HUKI),
 * IT-stöd och arkiv med INTERRELATES_WITH, krav och tid med ADRESSES. Det
 * som ritas är UTLÄGGET (`layoutAp`), och kopplingarnas vägar är samma som
 * skärmens och SVG:ns (`apRelationsVäg`).
 *
 * Id:n härleds ur flödets och objektens id:n (`uuidUrNamn`), så att en ny
 * export av samma process uppdaterar modellen i stället för att skapa en
 * kopia. Roller, intressenter, IT-stöd, arkiv och platser är GEMENSAMMA
 * objekt där: samma namn ger samma objekt i alla processer man exporterar.
 */

import { apRelationsVäg, type ApLaidOutNode, type ApLayout } from "./layout-affarsprocess";
import type { Point } from "../flowchart/layout/edge-router";
import type { ApNode, ApNodeKind, ApRelation } from "@/core/affarsprocess";
import { tolkaRutin } from "@/core/rutin";
import { uuidUrNamn } from "@/core/namn-id";
import { packaZip } from "@/core/zip";
import { ikonPortRuta } from "./former";

export interface BmtInställningar {
  /** XML-namnrymden (`targetNamespace` i mallens scheman). */
  namnrymd: string;
  /** Språkets id i mål-repositoryt (languages/<uuid>.xml). */
  språk: string;
  /** Språkets namn, t.ex. "Svenska". */
  språkNamn?: string;
  /** Beskrivningstypen texterna skrivs i ("Beskrivning"). Saknas = inga beskrivningar. */
  beskrivningstyp?: string;
  /**
   * Användaren som står som skapare av allt som exporteras. Verktyget sätter
   * alltid skapare på sina objekt, och användaren ska då finnas i users/.
   */
  användare?: { id: string; förnamn: string; efternamn?: string };
  /** Typsnittet på rutor och kopplingar. Saknas = verktygets eget val. */
  typsnitt?: string;
  /**
   * Filer ur en vanlig export från MÅL-repositoryt (sökväg → innehåll).
   * Repositoryts profil (config.xml), scheman, språk, användare och
   * beskrivningstyp följer med ordagrant – en fil utan dem gick inte att läsa in.
   */
  mall?: Record<string, string | Uint8Array>;
}

export interface BmtKälla {
  /** Flödets id i Arkitekten – roten för alla härledda id:n. */
  flödeId: string;
  /** Modellens namn. */
  namn: string;
  /** När flödet senast sparades – blir modellens "last-modified". */
  sparad: Date;
  /** Processens beskrivning, om den har någon. */
  beskrivning?: string;
}

/** Namnrymden för Arkitektens id:n (fast – byts den blir allt kopior). */
const RYMD = "31dd1458-96f5-4fa4-ab82-3efb81406f02";

const ROUTER = "se.conciliate.mt.router.def.router";

/** Objekttyp och variant per sort. */
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

/** Sorter som är gemensamma objekt – samma namn, samma objekt. */
const GEMENSAMMA = new Set<ApNodeKind>(["roll", "intressent", "applikation", "arkiv", "plats"]);

/** Verktygets standardstorlek på ikonsymbolerna (avläst ur dess exporter). */
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

/** Kopplingens typ. `vänd` = verktyget drar pilen åt andra hållet. */
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
      // Hos oss aktivitet → IT-stöd; i målverktyget IT-stödet → aktiviteten.
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

/** Skapare och senaste ändrare – samma användare för allt i exporten. */
function skapare(inst: BmtInställningar): string {
  return inst.användare
    ? `<created-by>${inst.användare.id}</created-by><last-modified-by>${inst.användare.id}</last-modified-by>`
    : "";
}

/** Typsnittet, som verktyget skriver det på rutor och kopplingar. */
function typsnitt(inst: BmtInställningar, färg = false): string {
  if (!inst.typsnitt) return "";
  return (
    `<font-name>${esc(inst.typsnitt)}</font-name><font-style>0</font-style><font-size>11</font-size>` +
    (färg ? `<font-color>000000</font-color>` : "")
  );
}

/** Rutan och etikettens ruta i målverktyget, ur utläggets objekt. */
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
    // Ikonen i verktygets storlek, centrerad där vår ikon står; namnet under.
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

type Ruta = { x: number; y: number; w: number; h: number };

/**
 * Flyttar vägens ÄNDPUNKT `p` till kanten av målets ruta `a`, längs vägens
 * första sträcka (mot `nästa`). Ikonerna är mindre där än hos oss, så
 * utläggets port ligger en bit utanför – utan justeringen började pilen i
 * luften. Sträckans riktning behålls, så en rak väg förblir rak.
 */
function tillKant(p: Point, nästa: Point, a: Ruta): Point {
  const vågrät = Math.abs(p.y - nästa.y) <= Math.abs(p.x - nästa.x);
  const inom = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  if (vågrät) return { x: nästa.x >= a.x + a.w / 2 ? a.x + a.w : a.x, y: inom(p.y, a.y, a.y + a.h) };
  return { x: inom(p.x, a.x, a.x + a.w), y: nästa.y >= a.y + a.h / 2 ? a.y + a.h : a.y };
}

/** HTML-texten som lagras i en beskrivning. */
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
  if (!html || !inst.beskrivningstyp) return "<descriptions></descriptions>";
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
): Record<string, string | Uint8Array> {
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
      `<mt-symbol xmlns="${inst.namnrymd}" uuid="${sid}" type="${typ}" variant="${variant}" last-modified="${tid}" ignore-changes="false">` +
      `<history>${historik(sid)}</history><created>${tid}</created>${skapare(inst)}` +
      språkdata(sp, node.label) +
      `<properties></properties><documents></documents>` +
      beskrivningar(inst, beskrivningHtml(node.beskrivning, node.rutin)) +
      `<extension-documents></extension-documents><plugin-data></plugin-data></mt-symbol>`;
  }

  // ---- Rutorna.
  const geo = new Map(lo.nodes.map((n) => [n.node.id, geometri(n)]));
  const utlagd = new Map(lo.nodes.map((n) => [n.node.id, n]));
  const rutor = lo.nodes
    .map(({ node }, i) => {
      const g = geo.get(node.id)!;
      const vid = rutaId(node.id);
      return (
        `<vertex uuid="${vid}" symbol="${symbolId(node)}"><history>${historik(vid)}</history>` +
        `<x>${r(g.x)}</x><y>${r(g.y)}</y><width>${r(g.w)}</width><height>${r(g.h)}</height>${typsnitt(inst)}` +
        `<is-owning-symbol>true</is-owning-symbol><z-order>${i}</z-order><show-label>true</show-label>` +
        `<lock-proportions>false</lock-proportions><center-label>false</center-label><size-ratio>1.0</size-ratio>` +
        `<holder>false</holder><frozen>false</frozen>` +
        `<label-bounds language="${sp}"><x>${r(g.etikett.x)}</x><y>${r(g.etikett.y)}</y>` +
        `<width>${r(g.etikett.w)}</width><height>${r(g.etikett.h)}</height></label-bounds>` +
        `<properties></properties></vertex>`
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
      // Samma väg som skärmen och SVG:n ritar (`apRelationsVäg`), i samma
      // riktning som målverktyget drar pilen.
      const la = utlagd.get(rel.source)!;
      const lb = utlagd.get(rel.target)!;
      const hinder = lo.nodes
        .filter((n) => n.node.id !== rel.source && n.node.id !== rel.target)
        .map((n) => ({ id: n.node.id, x: n.x, y: n.y, w: n.w, h: n.h }));
      let väg = apRelationsVäg(lo, rel, la, lb, hinder);
      if (t.vänd) väg = [...väg].reverse();
      if (väg.length >= 2) {
        väg[0] = tillKant(väg[0], väg[1], a);
        väg[väg.length - 1] = tillKant(väg[väg.length - 1], väg[väg.length - 2], b);
      }
      const punkter = väg
        .map((p) => `<control-point><x>${r(p.x)}</x><y>${r(p.y)}</y></control-point>`)
        .join("");
      const eid = id(`${källa.flödeId}/kant/${rel.id}`);
      // HUKI-bokstaven bärs av kopplingens typ – bara regelns svar är text.
      const etikett = rel.kind === "huki" ? "" : (rel.label ?? "");
      return (
        `<edge uuid="${eid}" type="${t.typ}" router-id="${ROUTER}" source-vertex="${rutaId(frånId)}" target-vertex="${rutaId(tillId)}">` +
        `<history>${historik(eid)}</history>${typsnitt(inst, true)}<label-along-line>false</label-along-line><hide-arrows>false</hide-arrows>` +
        `<language-data>${etikett ? `<title language="${sp}">${esc(etikett)}</title>` : `<title language="${sp}"></title>`}` +
        `<translated language="${sp}">true</translated></language-data>` +
        `<control-points>${punkter}</control-points></edge>`
      );
    })
    .join("");

  // ---- Modellen.
  const mid = id(`${källa.flödeId}/modell`);
  const modell =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<mt-model xmlns="${inst.namnrymd}" uuid="${mid}" type="PROCESS_MODEL" last-modified="${tid}" is-draft="false" ignore-changes="false">` +
    `<history>${historik(mid)}</history><created>${tid}</created>${skapare(inst)}` +
    språkdata(sp, källa.namn) +
    `<properties></properties><documents></documents>` +
    beskrivningar(inst, beskrivningHtml(källa.beskrivning, undefined)) +
    `<extension-documents></extension-documents><vertices>${rutor}</vertices><edges>${kanter}</edges>` +
    `<removal-history></removal-history><plugin-data></plugin-data></mt-model>`;

  const export_ = new Date(källa.sparad);
  const två = (n: number) => String(n).padStart(2, "0");
  const stämpel = `${export_.getFullYear()}-${två(export_.getMonth() + 1)}-${två(export_.getDate())} ${två(export_.getHours())}:${två(export_.getMinutes())}`;
  const mall = inst.mall ?? {};
  const urMall = (namn: string) => (namn in mall ? { [namn]: mall[namn] } : {});

  // Ordningen är verktygets egen: språk, modeller, beskrivningstyper, användare,
  // objekt, kringfiler, scheman. Det som ÄR repositoryts eget – språket,
  // användaren, beskrivningstypen, profilen och schemana – tas ordagrant ur
  // mallen (en export ur samma repository), aldrig ur koden.
  const ut: Record<string, string | Uint8Array> = {
    [`languages/${sp}.xml`]:
      mall[`languages/${sp}.xml`] ??
      `<?xml version="1.0" encoding="utf-8"?><mt-language xmlns="${inst.namnrymd}" uuid="${sp}">` +
        `<title>${esc(inst.språkNamn ?? "Svenska")}</title><default-language>true</default-language></mt-language>`,
    [`models/${mid}.xml`]: modell,
    ...(inst.beskrivningstyp ? urMall(`description-types/${inst.beskrivningstyp}.xml`) : {}),
    ...(inst.användare
      ? {
          [`users/${inst.användare.id}.xml`]:
            mall[`users/${inst.användare.id}.xml`] ??
            `<?xml version="1.0" encoding="utf-8"?><mt-user xmlns="${inst.namnrymd}" user-name="${inst.användare.id}">` +
              `<first-name>${esc(inst.användare.förnamn)}</first-name><last-name>${esc(inst.användare.efternamn ?? "")}</last-name></mt-user>`,
        }
      : {}),
    ...filer,
    "removal-history.xml": `<?xml version="1.0" encoding="utf-8"?><removal-history></removal-history>`,
    "breakdowns.xml": `<?xml version="1.0" encoding="utf-8"?><breakdowns></breakdowns>`,
    ...urMall("config.xml"),
    "version-info.txt": mall["version-info.txt"] ?? "compatibility-level: 5\r\nprogram-version: 2025.2.20",
    "data.xml": `<?xml version="1.0" encoding="utf-8"?><BMTExport ExportTime="${stämpel}" Version="3.5.0.0"></BMTExport>`,
  };
  for (const katalog of ["languages", "description-types", "models", "users", "symbols"])
    if (Object.keys(ut).some((k) => k.startsWith(`${katalog}/`))) Object.assign(ut, urMall(`${katalog}/schema.xsd`));
  return ut;
}

/** Hela .bmt-filen. */
export function byggBmt(lo: ApLayout, källa: BmtKälla, inst: BmtInställningar): Promise<Uint8Array> {
  // Verktyget komprimerar sina egna arkiv; vi gör likadant.
  return packaZip(byggBmtFiler(lo, källa, inst), källa.sparad, { komprimera: true });
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Läser exportens inställningar ur MALLEN (en export ur mål-repositoryt,
 * uppackad). Allt som hör till repositoryt hämtas här och ingen annanstans:
 * namnrymden ur modellschemats `targetNamespace`, språket ur languages/,
 * skaparen (den första användaren, eller `användareId`), beskrivningstypen
 * som heter "Beskrivning" och typsnittet mallens modeller använder.
 */
export function inställningarUrMall(
  mall: Record<string, Uint8Array>,
  val: { användareId?: string; beskrivningstyp?: string } = {},
): BmtInställningar {
  const avkod = new TextDecoder();
  const text = (n: string) => avkod.decode(mall[n]);
  const filer = Object.keys(mall);
  const schema = mall["models/schema.xsd"] ? text("models/schema.xsd") : "";
  const namnrymd = schema.match(/targetNamespace="([^"]+)"/)?.[1];
  if (!namnrymd) throw new Error("Mallen saknar modellschemat (models/schema.xsd) – är det en modellexport?");
  const språkFil = filer.find((n) => new RegExp(`^languages/${UUID}\\.xml$`).test(n));
  if (!språkFil) throw new Error("Mallen har inget språk (languages/).");
  const språk = språkFil.slice("languages/".length, -".xml".length);
  const användarFiler = filer.filter((n) => new RegExp(`^users/${UUID}\\.xml$`).test(n));
  const användareId = val.användareId ?? användarFiler[0]?.slice("users/".length, -".xml".length);
  const typFil = filer.find(
    (n) => new RegExp(`^description-types/${UUID}\\.xml$`).test(n) && /<title[^>]*>Beskrivning</.test(text(n)),
  );
  const beskrivningstyp = val.beskrivningstyp ?? typFil?.slice("description-types/".length, -".xml".length);
  const typsnitt = filer
    .filter((n) => n.startsWith("models/") && n.endsWith(".xml"))
    .map((n) => text(n).match(/<font-name>([^<]+)</)?.[1])
    .find(Boolean);
  const språkNamn = text(språkFil).match(/<title>([^<]+)</)?.[1];
  return {
    namnrymd,
    språk,
    språkNamn,
    beskrivningstyp,
    typsnitt,
    användare: användareId ? { id: användareId, förnamn: "Arkitekten" } : undefined,
    mall,
  };
}
