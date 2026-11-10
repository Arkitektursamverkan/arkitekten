/**
 * Lägger en rams markeringar ovanpå exportens SVG.
 *
 * Processen ritas inte om: exportören har märkt varje objekt med id och ruta
 * och varje koppling med sin stabila nyckel (`RAM_*_ATTR` i core/ram.ts), och
 * här läses bilden in, markeringarna läggs som ett eget lager ovanpå och det
 * hela skrivs ut igen. Vägen en puls vandrar längs är alltså EXAKT den väg
 * exportören ritade – routern anropas aldrig härifrån (invariant 1).
 *
 * Animationerna är SMIL (`<animate>`, `<animateMotion>`), inte CSS. Varje puls
 * behöver sina egna värden – en lång koppling ska inte rusa för att hinna lika
 * fort som en kort – och SMIL bär dem på elementet, utan globala regler som
 * läcker ut i resten av sidan när SVG:n ligger inline.
 */

import {
  RAM_KANT_ATTR,
  RAM_NOD_ATTR,
  RAM_RUTA_ATTR,
  type Markering,
  type Ram,
  type RamMål,
} from "@/core/ram";

import {
  LUFT,
  glödFilterSpec,
  kantEffektSpec,
  nodEffektSpec,
  pilSpec,
  vägpunkter,
  type Spec,
} from "./effekt-spec";

export { pulsStreck, väglängd } from "./effekt-spec";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Det `läggPåRam` lämnar när indata inte gick att tolka. */
export const TOM_SVG = `<svg xmlns="${SVG_NS}" width="0" height="0"/>`;

/** Minsta utsnitt vid zoom – ett ensamt objekt ska inte fylla hela skärmen. */
const MIN_UTSNITT = { w: 420, h: 260 };
/** Luft runt det markerade i utsnittet. */
const UTSNITT_LUFT = 36;

export interface RamOptioner {
  /**
   * Redigeringsläge: breda, osynliga träffytor läggs på varje koppling, och
   * en ram som zoomar visar sitt utsnitt som en streckad ram i stället för att
   * beskäras.
   */
  redigerar?: boolean;
  /**
   * Prefix för id:n i `<defs>`. Två bilder på samma sida (redigering och
   * presentation) får inte dela id – en `url(#…)` löses mot dokumentets FÖRSTA
   * element med id:t, och ligger det i en dold bild syns ingen pilspets.
   */
  prefix?: string;
}

export interface Ruta {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RamResultat {
  svg: string;
  /** Utsnittet i bildens koordinater när ramen zoomar, annars null. */
  utsnitt: Ruta | null;
  /** Markeringar vars mål inte finns i bilden (borttaget ur processen). */
  saknas: RamMål[];
}

export function läggPåRam(svg: string, ram: Ram | null, opts: RamOptioner = {}): RamResultat {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const rot = doc.documentElement;
  if (rot.nodeName !== "svg" || doc.getElementsByTagName("parsererror").length) {
    // REGRESSION: indata som inte gick att tolka som SVG lämnades tillbaka
    // orörd – och lades i sidan med innerHTML. Det som inte är en bild blir
    // en tom bild, aldrig HTML.
    return { svg: TOM_SVG, utsnitt: null, saknas: [] };
  }
  const prefix = opts.prefix ?? "ark-ram";
  const el = (namn: string, attr: Record<string, string | number> = {}, ...barn: Element[]) => {
    const e = doc.createElementNS(SVG_NS, namn);
    for (const [k, v] of Object.entries(attr)) e.setAttribute(k, String(v));
    for (const b of barn) e.appendChild(b);
    return e;
  };

  const noder = new Map<string, Element>();
  for (const e of Array.from(rot.querySelectorAll(`[${RAM_NOD_ATTR}]`))) {
    noder.set(e.getAttribute(RAM_NOD_ATTR)!, e);
  }
  const kanter = new Map<string, Element[]>();
  for (const e of Array.from(rot.querySelectorAll(`[${RAM_KANT_ATTR}]`))) {
    const k = e.getAttribute(RAM_KANT_ATTR)!;
    kanter.set(k, [...(kanter.get(k) ?? []), e]);
  }
  // Lagret hamnar hos objektens förälder: där gäller samma koordinatram som i
  // rutorna och vägarna (flödesschemat förskjuter hela ritningen med en
  // translate för titeln, affärsprocessen gör det inte).
  const förstaMål: Element | undefined =
    noder.values().next().value ?? kanter.values().next().value?.[0];
  const scen = (förstaMål?.parentNode as Element | null) ?? rot;

  let defs: Element | null = rot.querySelector("defs");
  if (!defs) {
    defs = el("defs");
    rot.insertBefore(defs, rot.firstChild);
  }
  const defsEl = defs;
  defsEl.appendChild(bygg(doc, glödFilterSpec(`${prefix}-glod`)));
  const pilar = new Map<string, string>();
  const pil = (färg: string) => {
    let id = pilar.get(färg);
    if (!id) {
      id = `${prefix}-pil-${pilar.size}`;
      pilar.set(färg, id);
      defsEl.appendChild(bygg(doc, pilSpec(id, färg)));
    }
    return `url(#${id})`;
  };

  const saknas: RamMål[] = [];
  const träffade: { m: Markering; mål: Element[] }[] = [];
  for (const m of ram?.markeringar ?? []) {
    const mål =
      m.mål.typ === "nod"
        ? noder.has(m.mål.id)
          ? [noder.get(m.mål.id)!]
          : []
        : (kanter.get(m.mål.id) ?? []);
    if (mål.length === 0) saknas.push(m.mål);
    else träffade.push({ m, mål });
  }

  // Strålkastaren: en slöja över allt, och de markerade lyfts upp över den.
  if (ram?.strålkastare && träffade.length) {
    scen.appendChild(
      el("rect", {
        x: -1e5,
        y: -1e5,
        width: 2e5,
        height: 2e5,
        fill: "#ffffff",
        opacity: 0.72,
        "pointer-events": "none",
        class: "ark-ram-sloja",
      }),
    );
    for (const { mål } of träffade) for (const e of mål) scen.appendChild(e.cloneNode(true));
  }

  const lager = el("g", { class: "ark-ram-lager", "pointer-events": "none" });
  for (const { m, mål } of träffade) {
    for (const e of mål) {
      if (m.mål.typ === "nod") lager.appendChild(bygg(doc, nodEffektSpec(rutaUtanLuft(e), m.verktyg, m.färg)));
      else
        lager.appendChild(
          bygg(doc, kantEffektSpec(e.getAttribute("d") ?? "", m.verktyg, m.färg, pil(m.färg), `url(#${prefix}-glod)`)),
        );
    }
  }
  scen.appendChild(lager);

  // Utsnittet: det markerades ytterram i scenens koordinater, med luft runt och
  // aldrig mindre än MIN_UTSNITT.
  let utsnitt: Ruta | null = null;
  if (ram?.zooma && träffade.length) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const { m, mål } of träffade) {
      for (const e of mål) {
        if (m.mål.typ === "nod") {
          const [x, y, w, h] = ruta(e);
          xs.push(x, x + w);
          ys.push(y, y + h);
        } else {
          for (const [x, y] of vägpunkter(e.getAttribute("d") ?? "")) {
            xs.push(x);
            ys.push(y);
          }
        }
      }
    }
    const x0 = Math.min(...xs) - UTSNITT_LUFT;
    const y0 = Math.min(...ys) - UTSNITT_LUFT;
    const w0 = Math.max(...xs) + UTSNITT_LUFT - x0;
    const h0 = Math.max(...ys) + UTSNITT_LUFT - y0;
    const w = Math.max(w0, MIN_UTSNITT.w);
    const h = Math.max(h0, MIN_UTSNITT.h);
    const i = { x: x0 - (w - w0) / 2, y: y0 - (h - h0) / 2, w, h };
    if (opts.redigerar) {
      lager.appendChild(
        el("rect", {
          x: i.x,
          y: i.y,
          width: i.w,
          height: i.h,
          fill: "none",
          stroke: "#475467",
          "stroke-width": 1.5,
          "stroke-dasharray": "8 6",
          rx: 6,
          class: "ark-ram-utsnitt",
        }),
      );
    }
    // Till rotens koordinater: scenen kan ligga under translate-grupper
    // (flödesschemat förskjuter ritningen för titeln).
    const [dx, dy] = förskjutning(scen, rot);
    utsnitt = { x: i.x + dx, y: i.y + dy, w: i.w, h: i.h };
    if (!opts.redigerar) {
      rot.setAttribute("viewBox", [utsnitt.x, utsnitt.y, utsnitt.w, utsnitt.h].map((v) => v.toFixed(1)).join(" "));
      rot.setAttribute("width", utsnitt.w.toFixed(1));
      rot.setAttribute("height", utsnitt.h.toFixed(1));
    }
  }

  // Kopplingarna är 1–2 px tunna. Utan en bredare, osynlig träffyta fick man
  // sikta på pixeln för att markera en.
  if (opts.redigerar) {
    const träff = el("g", { class: "ark-ram-traffytor" });
    for (const [nyckel, vägar] of kanter) {
      for (const v of vägar) {
        träff.appendChild(
          el("path", {
            d: v.getAttribute("d") ?? "",
            fill: "none",
            stroke: "transparent",
            "stroke-width": 12,
            "pointer-events": "stroke",
            [RAM_KANT_ATTR]: nyckel,
          }),
        );
      }
    }
    scen.appendChild(träff);
  }

  return { svg: new XMLSerializer().serializeToString(rot), utsnitt, saknas };
}

/** Summan av `translate(x,y)` från `el` upp till (men inte med) `rot`. */
function förskjutning(el: Element, rot: Element): [number, number] {
  let dx = 0;
  let dy = 0;
  for (let e: Element | null = el; e && e !== rot; e = e.parentNode as Element | null) {
    const m = /translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/.exec(e.getAttribute?.("transform") ?? "");
    if (m) {
      dx += Number(m[1]);
      dy += Number(m[2] ?? 0);
    }
  }
  return [dx, dy];
}

function rutaUtanLuft(e: Element): [number, number, number, number] {
  const [x, y, w, h] = (e.getAttribute(RAM_RUTA_ATTR) ?? "0 0 0 0").split(/\s+/).map(Number);
  return [x, y, w, h];
}

/** Objektets ruta ur märkningen, med samma luft som markeringen får. */
function ruta(e: Element): [number, number, number, number] {
  const [x, y, w, h] = (e.getAttribute(RAM_RUTA_ATTR) ?? "0 0 0 0").split(/\s+/).map(Number);
  return [x - LUFT, y - LUFT, w + 2 * LUFT, h + 2 * LUFT];
}

/** Bygger DOM-element ur en beskrivning ur effekt-spec.ts. */
function bygg(doc: Document, spec: Spec): Element {
  const e = doc.createElementNS(SVG_NS, spec.namn);
  for (const [k, v] of Object.entries(spec.attr)) e.setAttribute(k, String(v));
  for (const b of spec.barn ?? []) e.appendChild(bygg(doc, b));
  return e;
}
