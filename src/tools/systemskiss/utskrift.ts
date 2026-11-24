/**
 * Utskrift av en systemskiss på A4 eller A3.
 *
 * Bilden är exporten (`skissSvg`) – samma ritning, samma revisionsruta – som
 * skalas för att rymmas på bladet. Ett blad per lager gör en stor skiss
 * läsbar: varje lager blir en egen, mindre bild (samma filter som raden
 * Lager, `filtreraSkiss`). Utskriften är ett HTML-dokument som webbläsaren
 * skriver ut, eller sparar som PDF.
 *
 * Läsbarheten mäts på rutornas brödtext: under 6 pt är den svår att läsa på
 * papper, under 4,5 pt går den inte att läsa. Bilden förstoras aldrig mer än
 * att brödtexten blir 12 pt – en liten bild ska inte bli en affisch.
 *
 * Förvalet är ETT blad, hur liten texten än blir (produktägarens krav
 * 2026-11-23: "allt på en A3 eller A4, det får bli smått").
 *
 * DELNING (bara om man slår på den): blir texten mindre än 5 pt kan bilden delas på flera blad, i rader
 * och kolumner, så att texten blir minst 7 pt. Mellan 5 och 6 pt får bilden
 * stå kvar på ETT blad – ett lager man valt ska helst bli en sida, inte två. Bladen överlappar 10 mm, så att
 * de går att lägga ihop. Varje del är samma bild med ett annat fönster
 * (viewBox) – inget ritas om.
 *
 * LÄSBARHET PÅ PAPPER (produktägaren 2026-11-24: revisionsrutan och de gula
 * rutorna gick inte att läsa på A3): revisionsrutan – klassning, version,
 * vem som justerat – ritas inte i bilden, där den krymper med skissen, utan
 * står i bladets rubrik i fast storlek. Anteckningarnas text förstoras så att
 * den fyller rutan (`fyllAnteckningar`, högst dubbelt).
 *
 * REMSOR: en bild som är mycket bredare än bladet (t.ex. simbanor) delas i två
 * eller tre remsor som står UNDER VARANDRA på samma blad – fortfarande ett
 * blad, men texten blir större. Remsorna överlappar lite, så att en ruta som
 * hamnar i skarven syns hel i den ena. Remsor används bara när de ger minst
 * en fjärdedel större text, och bara när texten annars blir mindre än 6 pt.
 */
import { revisionsRader, type Revision } from "@/tools/flowchart/export/revision";
import { esc } from "@/tools/flowchart/render/text-util";
import { filtreraSkiss, type Systemskiss } from "@/core/systemskiss";
import { SKISS_BRÖDTEXT, skissSvg } from "./skiss-svg";

export type Papper = "A4" | "A3";
export type Riktning = "auto" | "stående" | "liggande";
export type Innehåll = "visas" | "lager";

export interface Utskriftsval {
  papper: Papper;
  riktning: Riktning;
  /** Det som visas (ett blad), eller ett blad per lager. */
  innehåll: Innehåll;
  /** Med ett blad per lager: hela skissen först. */
  medHela: boolean;
  /** Dela en bild på flera blad när texten annars blir för liten. */
  dela: boolean;
}

export const UTSKRIFT_FÖRVAL: Utskriftsval = { papper: "A3", riktning: "auto", innehåll: "visas", medHela: false, dela: false };

/** Pappret i millimeter, stående. */
const PAPPER: Record<Papper, { b: number; h: number }> = { A4: { b: 210, h: 297 }, A3: { b: 297, h: 420 } };
/** Marginal runt bladet och rubrikraden överst, i millimeter. */
export const MARGINAL = 10;
export const RUBRIK = 13;
const MM_PER_PT = 25.4 / 72;
/** Gränserna för brödtexten, i punkter. */
export const LÄSBAR_PT = 6;
export const OLÄSBAR_PT = 4.5;
const STÖRST_PT = 12;
/** Textstorleken en delad bild får, och bladens överlapp i millimeter. */
export const DELAD_PT = 7;
/** Under detta delas bilden (om man valt delning). */
export const DELA_UNDER_PT = 5;
export const ÖVERLAPP = 10;
/** Högst så många blad för EN bild – mer är en affisch, inte en utskrift. */
const MAX_DELAR = 12;

export interface Blad {
  rubrik: string;
  /** Revisionsrutans rader (klassning först) – står under rubriken i fast storlek. */
  revision?: string[];
  svg: string;
  /** Bildens mått i skissens enheter. */
  bredd: number;
  höjd: number;
  liggande: boolean;
  /** Bildens mått på pappret, i millimeter. */
  bMm: number;
  hMm: number;
  /** Rutornas brödtext på pappret, i punkter. */
  textPt: number;
  /** Bilden i remsor under varandra på bladet: varje remsas fönster i skissens enheter. */
  remsor?: { x: number; y: number; b: number; h: number }[];
  /** En del av en delad bild: fönstret i skissens enheter och dess plats. */
  del?: { x: number; y: number; b: number; h: number; rad: number; kolumn: number; rader: number; kolumner: number };
}

/** Ytan bilden får på ett blad, i millimeter. */
export function bildyta(papper: Papper, liggande: boolean): { b: number; h: number } {
  const p = PAPPER[papper];
  const [b, h] = liggande ? [p.h, p.b] : [p.b, p.h];
  return { b: b - 2 * MARGINAL, h: h - 2 * MARGINAL - RUBRIK };
}

/** Millimeter per enhet när bilden ska rymmas – högst så att brödtexten blir 12 pt. */
function skala(bredd: number, höjd: number, papper: Papper, liggande: boolean): number {
  const y = bildyta(papper, liggande);
  return Math.min(y.b / bredd, y.h / höjd, (STÖRST_PT * MM_PER_PT) / SKISS_BRÖDTEXT);
}

/** Luften mellan remsorna på bladet (mm), och remsornas överlapp som andel av bildens bredd. */
export const REMSLUFT = 6;
const REMSÖVERLAPP = 0.03;
const MAX_REMSOR = 3;
/** Remsor bara om texten blir minst så här mycket större. */
const REMSVINST = 1.25;

/** Millimeter per enhet med bilden i `k` remsor under varandra. */
function remsskala(bredd: number, höjd: number, k: number, papper: Papper, liggande: boolean): number {
  if (k === 1) return skala(bredd, höjd, papper, liggande);
  const y = bildyta(papper, liggande);
  const remsa = bredd / k + bredd * REMSÖVERLAPP;
  return Math.min(y.b / remsa, (y.h - (k - 1) * REMSLUFT) / (k * höjd), (STÖRST_PT * MM_PER_PT) / SKISS_BRÖDTEXT);
}

/** Ett blad: riktningen (och antalet remsor) som ger störst bild om man inte valt själv. */
export function placera(rubrik: string, svg: string, bredd: number, höjd: number, papper: Papper, riktning: Riktning): Blad {
  const riktningar = riktning === "auto" ? [false, true] : [riktning === "liggande"];
  const hel = riktningar.map((liggande) => ({ liggande, k: 1, s: skala(bredd, höjd, papper, liggande) })).reduce((a, b) => (b.s > a.s ? b : a));
  let bäst = hel;
  // Bara när texten annars blir liten – en bild som redan går att läsa får stå hel.
  if ((SKISS_BRÖDTEXT * hel.s) / MM_PER_PT < LÄSBAR_PT)
  for (const liggande of riktningar)
    for (let k = 2; k <= MAX_REMSOR; k++) {
      const s = remsskala(bredd, höjd, k, papper, liggande);
      if (s >= hel.s * REMSVINST && s > bäst.s) bäst = { liggande, k, s };
    }
  const { liggande, k, s } = bäst;
  const blad: Blad = { rubrik, svg, bredd, höjd, liggande, bMm: bredd * s, hMm: höjd * s, textPt: (SKISS_BRÖDTEXT * s) / MM_PER_PT };
  if (k === 1) return blad;
  const vb = /viewBox="([-\d.]+) ([-\d.]+) /.exec(svg);
  const x0 = vb ? Number(vb[1]) : 0;
  const y0 = vb ? Number(vb[2]) : 0;
  const b = bredd / k + bredd * REMSÖVERLAPP;
  const remsor = Array.from({ length: k }, (_, i) => ({ x: x0 + (i * (bredd - b)) / (k - 1), y: y0, b, h: höjd }));
  return { ...blad, bMm: b * s, hMm: höjd * s * k + (k - 1) * REMSLUFT, remsor };
}

/** Hur bilden delas för att texten ska bli `DELAD_PT`: rader och kolumner i en riktning. */
function delning(bredd: number, höjd: number, papper: Papper, liggande: boolean) {
  const y = bildyta(papper, liggande);
  const s = (DELAD_PT * MM_PER_PT) / SKISS_BRÖDTEXT;
  // Varje blad utom det första visar ÖVERLAPP mm som redan stått på föregående.
  const antal = (mått: number, yta: number) => Math.max(1, Math.ceil((mått * s - ÖVERLAPP) / (yta - ÖVERLAPP)));
  const kolumner = antal(bredd, y.b);
  const rader = antal(höjd, y.h);
  return { kolumner, rader, delar: kolumner * rader };
}

/**
 * En bild som blad: ett, eller – när texten blir för liten och man vill dela –
 * flera, i den riktning som ger färst blad. Skalan blir den största som låter
 * delarna rymmas, högst 12 pt.
 */
export function delaUpp(rubrik: string, svg: string, bredd: number, höjd: number, papper: Papper, riktning: Riktning, dela: boolean): Blad[] {
  const hel = placera(rubrik, svg, bredd, höjd, papper, riktning);
  if (!dela || hel.textPt >= DELA_UNDER_PT) return [hel];
  const val = (riktning === "auto" ? [true, false] : [riktning === "liggande"]).map((liggande) => ({ liggande, ...delning(bredd, höjd, papper, liggande) }));
  const bäst = val.reduce((a, b) => (b.delar < a.delar ? b : a));
  if (bäst.delar <= 1 || bäst.delar > MAX_DELAR) return [hel];
  const { liggande, kolumner, rader } = bäst;
  const yta = bildyta(papper, liggande);
  // Skalan som får rutnätet att täcka bilden, med överlappen inräknad.
  const s = Math.min(
    (kolumner * yta.b - (kolumner - 1) * ÖVERLAPP) / bredd,
    (rader * yta.h - (rader - 1) * ÖVERLAPP) / höjd,
    (STÖRST_PT * MM_PER_PT) / SKISS_BRÖDTEXT,
  );
  const vb = /viewBox="([-\d.]+) ([-\d.]+) /.exec(svg);
  const x0 = vb ? Number(vb[1]) : 0;
  const y0 = vb ? Number(vb[2]) : 0;
  const fb = yta.b / s;
  const fh = yta.h / s;
  const steg = (yt: number) => (yt - ÖVERLAPP) / s;
  const blad: Blad[] = [];
  for (let r = 0; r < rader; r++)
    for (let k = 0; k < kolumner; k++) {
      const x = x0 + k * steg(yta.b);
      const y = y0 + r * steg(yta.h);
      const b = Math.min(fb, x0 + bredd - x);
      const h = Math.min(fh, y0 + höjd - y);
      blad.push({
        rubrik, svg, bredd, höjd, liggande,
        bMm: b * s, hMm: h * s,
        textPt: (SKISS_BRÖDTEXT * s) / MM_PER_PT,
        del: { x, y, b, h, rad: r + 1, kolumn: k + 1, rader, kolumner },
      });
    }
  return blad;
}

/**
 * Bladen för en utskrift. `skiss` är versionen man tittar på, OFILTRERAD;
 * `filter` och `grannar` är lagerradens val (det som visas).
 */
export function utskriftsblad(
  skiss: Systemskiss,
  val: Utskriftsval,
  filter: ReadonlySet<string> | null,
  grannar: boolean,
  revision?: Revision,
): Blad[] {
  const blad = (rubrik: string, s: Systemskiss): Blad[] => {
    if (s.objekt.length === 0 && s.zoner.length === 0) return [];
    const { svg, bredd, höjd } = skissSvg(s, undefined, { fyllAnteckningar: true });
    const rader = revision ? revisionsRader(revision) : [];
    return delaUpp(rubrik, svg, bredd, höjd, val.papper, val.riktning, val.dela).map((b) => (rader.length ? { ...b, revision: rader } : b));
  };
  const lager = skiss.lager ?? [];
  if (val.innehåll === "visas" || lager.length === 0) {
    const namn = filter ? lager.filter((l) => filter.has(l.id)).map((l) => l.namn).join(", ") : "";
    return blad(namn ? `${skiss.namn} – ${namn}` : skiss.namn, filtreraSkiss(skiss, filter, grannar));
  }
  return [
    ...(val.medHela ? blad(skiss.namn, skiss) : []),
    ...lager.flatMap((l) => blad(`${skiss.namn} – ${l.namn}`, filtreraSkiss(skiss, new Set([l.id]), grannar))),
  ];
}

/** Läsbarheten i ord, för dialogen. */
export function läsbarhet(pt: number): "bra" | "liten" | "oläsbar" {
  return pt >= LÄSBAR_PT ? "bra" : pt >= OLÄSBAR_PT ? "liten" : "oläsbar";
}

const mm = (v: number) => `${v.toFixed(1)}mm`;

/**
 * Bildens egna mått byts mot millimeter – viewBox behålls, så den skalas. En
 * del av en delad bild får sitt eget fönster.
 */
function iMillimeter(svg: string, b: Blad): string {
  let ut = svg.replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${mm(b.bMm)}" height="${mm(b.hMm)}"`);
  if (b.del) {
    const { x, y, b: w, h } = b.del;
    ut = ut.replace(/viewBox="[^"]*"/, `viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}"`);
  }
  return ut;
}

/** Bladets bild: hela, en del av en delad bild, eller remsorna under varandra. */
function bildHtml(b: Blad): string {
  if (!b.remsor) return iMillimeter(b.svg, b);
  const s = b.bMm / b.remsor[0].b;
  return (
    `<div class="remsor">` +
    b.remsor
      .map((r, i) =>
        b.svg
          .replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${mm(r.b * s)}" height="${mm(r.h * s)}"`)
          .replace(/viewBox="[^"]*"/, `viewBox="${r.x.toFixed(1)} ${r.y.toFixed(1)} ${r.b.toFixed(1)} ${r.h.toFixed(1)}"`)
          .replace(/^<svg/, `<svg class="remsa" data-remsa="${i + 1} av ${b.remsor!.length}"`),
      )
      .join(`<div class="skarv"></div>`) +
    `</div>`
  );
}

/** Var delen hör hemma: "del 2 av 6, rad 1 kolumn 2". */
export function delText(b: Blad): string {
  if (!b.del) return "";
  const { rad, kolumn, rader, kolumner } = b.del;
  const nr = (rad - 1) * kolumner + kolumn;
  return `del ${nr} av ${rader * kolumner}` + (rader > 1 && kolumner > 1 ? `, rad ${rad} kolumn ${kolumn}` : rader > 1 ? `, rad ${rad}` : `, kolumn ${kolumn}`);
}

/**
 * Utskriftsdokumentet. Varje blad har sin egen sidmall (stående/liggande) –
 * webbläsare utan namngivna sidmallar använder den första.
 */
export function utskriftsdokument(titel: string, blad: Blad[], papper: Papper): string {
  const sida = (liggande: boolean) => {
    const p = PAPPER[papper];
    return liggande ? `${p.h}mm ${p.b}mm` : `${p.b}mm ${p.h}mm`;
  };
  const första = blad[0]?.liggande ?? false;
  const css =
    `@page { size: ${sida(första)}; margin: ${MARGINAL}mm; }` +
    `@page stående { size: ${sida(false)}; margin: ${MARGINAL}mm; }` +
    `@page liggande { size: ${sida(true)}; margin: ${MARGINAL}mm; }` +
    `html, body { margin: 0; padding: 0; background: #fff; }` +
    `* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }` +
    `.blad { break-after: page; page-break-after: always; overflow: hidden; font-family: "Segoe UI", system-ui, Arial, sans-serif; color: #101828; }` +
    `.blad:last-child { break-after: auto; page-break-after: auto; }` +
    `.stående { page: stående; } .liggande { page: liggande; }` +
    `.rubrik { height: ${RUBRIK}mm; font-size: 9pt; }` +
    `.rad { display: flex; justify-content: space-between; gap: 6mm; }` +
    `.rubrik b { font-weight: 600; } .rubrik span { color: #475467; white-space: nowrap; }` +
    `.rev { margin-top: 1mm; color: #344054; } .rev .klass { font-weight: 600; color: #101828; }` +
    `.bild { display: flex; justify-content: center; align-items: center; height: calc(100% - ${RUBRIK}mm); }` +
    `.delad .bild { justify-content: flex-start; align-items: flex-start; }` +
    `.bild svg { display: block; }` +
    `.remsor { display: flex; flex-direction: column; align-items: center; }` +
    `.skarv { height: ${REMSLUFT}mm; width: 100%; background: linear-gradient(#d0d5dd, #d0d5dd) center / 100% 0.3mm no-repeat; }`;
  const kropp = blad
    .map((b, i) => {
      const y = bildyta(papper, b.liggande);
      return (
        `<section class="blad ${b.liggande ? "liggande" : "stående"}${b.del ? " delad" : ""}" style="width:${mm(y.b)};height:${mm(y.h + RUBRIK)}">` +
        `<div class="rubrik"><div class="rad"><b>${esc(b.rubrik)}${b.del ? ` · ${delText(b)}` : ""}</b><span>Blad ${i + 1} av ${blad.length} · ${papper} ${b.liggande ? "liggande" : "stående"}</span></div>` +
        (b.revision?.length ? `<div class="rev">${b.revision.map((r) => (r.startsWith("Klassning:") ? `<span class="klass">${esc(r)}</span>` : esc(r))).join(" · ")}</div>` : "") +
        `</div>` +
        `<div class="bild">${bildHtml(b)}</div>` +
        `</section>`
      );
    })
    .join("");
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${css}</style></head><body>${kropp}</body></html>`;
}

/**
 * Skriver ut dokumentet genom en dold ram – ingen ny flik som kan stoppas av
 * popup-skyddet. Ramen tas bort när utskriftsdialogen har stängts.
 */
export function skrivUt(dokument: string): void {
  const ram = document.createElement("iframe");
  ram.setAttribute("aria-hidden", "true");
  ram.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  ram.onload = () => {
    const f = ram.contentWindow;
    if (!f) return;
    const städa = () => setTimeout(() => ram.remove(), 1000);
    f.addEventListener("afterprint", städa, { once: true });
    f.focus();
    f.print();
    // Webbläsare som inte skickar afterprint: städa efter en minut.
    setTimeout(() => ram.isConnected && ram.remove(), 60_000);
  };
  ram.srcdoc = dokument;
  document.body.appendChild(ram);
}
