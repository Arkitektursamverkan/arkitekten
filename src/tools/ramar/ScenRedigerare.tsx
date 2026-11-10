/**
 * Bildflikens redigering: verktygslådan, figurpaletten, bakgrunden och en
 * inspektör för det som är valt.
 *
 * Två sorters ändringar, och de hör till olika ställen:
 *  - SCENEN (serien): figurer läggs till, flyttas, döps om, tas bort.
 *    Bakgrunden byts. Det gäller alla ramar.
 *  - RAMEN: markeringar, pulser, bubblor, vilka figurer som syns. Det gäller
 *    bara den valda ramen.
 */

import { useEffect, useRef, useState } from "react";
import { RAM_VERKTYG, ändraRam, type Ram, type Ramserie } from "@/core/ram";
import {
  SCEN_BREDD,
  scenHöjd,
  nyFigur,
  serieScen,
  ramScen,
  suddaFigur,
  sättBubbla,
  synsFrånRam,
  taBortFigur,
  taBortPuls,
  växlaDold,
  växlaFigurMarkering,
  växlaPuls,
  ändraFigur,
  ändraPuls,
  ändraRamScen,
  ändraScen,
  läggTillTextruta,
  nyTextruta,
  taBortTextruta,
  ändraTextruta,
  type ScenTextruta,
  type ScenPulspunkt,
  figurerIRam,
  flyttaObjekt,
  scenensPlats,
  läggTillFigurIRam,
  döljIRam,
  iAllaRamar,
  nyPulspunkt,
  läggTillPulspunkt,
  ändraPulspunkt,
  taBortPulspunkt,
  TEXTRUTA_BAKGRUNDER,
  TEXTRUTA_MIN_BREDD,
  TEXTRUTA_TEXTFÄRGER,
  type FigurTyp,
  type RamScen,
  type Scen,
} from "@/core/ram-scen";
import { FIGURER, FIGURGRUPPER } from "./scen-figurer";
import { ScenBild } from "./ScenBild";
import { läsBild } from "./bild";
import { ärDragning, ärLjus } from "./scen-geometri";
import { FärgVal } from "./FargVal";

export type ScenVerktyg =
  | "flytta"
  | "farg"
  | "blink"
  | "puls"
  | "koppla"
  | "bubbla"
  | "textruta"
  | "pulspunkt"
  | "dolj"
  | "sudd"
  | "tabort";

/**
 * Figurerna som ska TÄNDAS för verktyget – de det går att använda på.
 *
 * Verktyg som bara verkar på en figur gav ingen ledning: man klickade på en
 * ledig plats i bilden och ingenting hände (2026-10-13, först om
 * Pratbubbla, sedan "gör samma för de andra verktygen"). Textruta och
 * Pulspunkt sätts var som helst, Flytta och Ta bort gäller allt – de tänder
 * ingenting.
 */
export function tändaFigurer(verktyg: ScenVerktyg, scen: Scen, rs: RamScen): Set<string> {
  const alla = scen.figurer.map((f) => f.id);
  const synliga = alla.filter((id) => !rs.dolda.includes(id));
  switch (verktyg) {
    case "farg":
    case "blink":
    case "puls":
    case "koppla":
    case "bubbla":
      return new Set(synliga);
    // Visa/dölj verkar på de dolda också – de syns svagt medan verktyget är valt.
    case "dolj":
      return new Set(alla);
    // Suddet tar bort markering och bubbla: bara figurer som HAR något att sudda.
    case "sudd":
      return new Set(
        synliga.filter(
          (id) => rs.markeringar.some((m) => m.figur === id) || rs.bubblor.some((b) => b.figur === id),
        ),
      );
    default:
      return new Set();
  }
}

const VERKTYG: { id: ScenVerktyg; namn: string; ikon: string; hjälp: string }[] = [
  { id: "flytta", namn: "Flytta", ikon: "✥", hjälp: "Välj och dra figurer – i den här ramen eller i alla (valet i raden; Shift vänder det). Figurerna går att dra med alla verktyg." },
  ...RAM_VERKTYG.map((v) => ({ ...v, hjälp: `${v.hjälp} – på en figur` })),
  { id: "koppla", namn: "Puls mellan", ikon: "↝", hjälp: "Klicka på figuren pulsen går FRÅN, sedan den den går TILL" },
  { id: "bubbla", namn: "Pratbubbla", ikon: "💬", hjälp: "Klicka på en av de tända figurerna och skriv vad den säger" },
  {
    id: "textruta",
    namn: "Textruta",
    ikon: "▭",
    hjälp: "Klicka på bilden där rutan ska stå – en rubrik och en text, som en bildtext. Hör till den här ramen.",
  },
  {
    id: "pulspunkt",
    namn: "Pulspunkt",
    ikon: "◉",
    hjälp: "Klicka där en liten pulserande cirkel ska sitta – också ovanpå en figur, t.ex. i ett fönster. Får vald färg. Hör till den här ramen.",
  },
  { id: "dolj", namn: "Visa/dölj", ikon: "◐", hjälp: "Figuren syns inte i den här ramen – den tonas in och ut" },
  { id: "sudd", namn: "Sudda", ikon: "⌫", hjälp: "Tar bort markering och bubbla från en figur, eller en puls" },
  {
    id: "tabort",
    namn: "Ta bort",
    ikon: "🗑",
    hjälp:
      "Klicka på en figur, textruta eller punkt för att ta bort den ur DEN HÄR ramen. Delete gör detsamma med det valda; Shift+Delete tar bort det ur alla ramar.",
  },
];

export function ScenRedigerare(props: {
  serie: Ramserie;
  ram: Ram;
  ramIndex: number;
  onSerie: (f: (s: Ramserie) => Ramserie) => void;
  färg: string;
  /** Byter den valda färgen (delas med flödesfliken). */
  onFärg?: (f: string) => void;
  fel: (text: string) => void;
}) {
  const { serie, ram, onSerie, färg } = props;
  /**
   * FÄRGEN gäller det man gör härnäst – OCH det som är valt just nu: en figurs
   * färgkant/blink/puls, en puls mellan figurer, en pulspunkt. Förut stod
   * färgraden längst ner och styrde bara nya markeringar; en blinkning som
   * redan fanns gick inte att byta färg på utan att göra om den
   * ("Jag vill kunna ange färg för Blinka, puls – alla objekt under Bild").
   */
  const väljFärg = (f: string) => {
    props.onFärg?.(f);
    if (valdPuls) ändraRs((x) => ändraPuls(x, valdPuls, (p) => ({ ...p, färg: f })));
    else if (valdPunkt) ändraRs((x) => ändraPulspunkt(x, valdPunkt, (p) => ({ ...p, färg: f })));
    else if (vald)
      ändraRs((x) => ({
        ...x,
        markeringar: x.markeringar.map((m) => (m.figur === vald ? { ...m, färg: f } : m)),
      }));
  };
  const scen = serieScen(serie);
  const rs = ramScen(ram);
  const [verktyg, setVerktyg] = useState<ScenVerktyg>("koppla");
  const [vald, setVald] = useState<string | null>(null);
  const [valdPuls, setValdPuls] = useState<string | null>(null);
  const [kopplaFrån, setKopplaFrån] = useState<string | null>(null);
  const [valdText, setValdText] = useState<string | null>(null);
  const [valdPunkt, setValdPunkt] = useState<string | null>(null);
  /** Flytta i alla ramar (annars bara den här). Shift under draget vänder valet. */
  const [flyttaAlla, setFlyttaAlla] = useState(false);
  const textFält = useRef<HTMLTextAreaElement>(null);
  const [palett, setPalett] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const filVal = useRef<HTMLInputElement>(null);
  const bubblaFält = useRef<HTMLInputElement>(null);
  /**
   * Pågående nedslag på en figur: greppets förskjutning från mitten och var
   * nedslaget skedde (invariant 6). Figurerna går att DRA med vilket verktyg
   * som helst – ett nedslag blir en flytt först när pekaren rört sig
   * (`ärDragning`), annars är det ett klick och verktyget gör sitt.
   */
  const drar = useRef<{
    typ: "figur" | "text" | "punkt";
    id: string;
    dx: number;
    dy: number;
    sx: number;
    sy: number;
    flyttad: boolean;
  } | null>(null);

  const ändraRs = (f: (x: RamScen) => RamScen) =>
    onSerie((s) => ändraRam(s, ram.id, (r) => ändraRamScen(r, f)));

  const tillScen = (e: { clientX: number; clientY: number }) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  /** Ny pulspunkt där man klickade – på tom yta eller ovanpå en figur. */
  const sättPulspunkt = (e: { clientX: number; clientY: number }) => {
    const p = tillScen(e);
    const pt = nyPulspunkt(p.x, p.y, färg);
    ändraRs((x) => läggTillPulspunkt(x, pt));
    setValdPunkt(pt.id);
    setVald(null);
    setValdText(null);
    setValdPuls(null);
  };

  const figurDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return; // bara vänsterknappen
    e.stopPropagation();
    // Med Pulspunkt sätts punkten ovanpå figuren – figuren flyttas inte.
    if (verktyg === "pulspunkt") {
      sättPulspunkt(e);
      return;
    }
    // Figuren där den står i DEN HÄR ramen – den kan ha en egen plats här.
    const f = figurerIRam(scen, rs).find((x) => x.id === id)!;
    const p = tillScen(e);
    drar.current = { typ: "figur", id, dx: p.x - f.x, dy: p.y - f.y, sx: e.clientX, sy: e.clientY, flyttad: false };
    setValdText(null);
    setValdPunkt(null);
    svg.current?.setPointerCapture(e.pointerId);
    if (verktyg === "flytta") setVald(id);
  };

  /** Ett nedslag som INTE blev en dragning: verktyget gör sitt på figuren. */
  const figurKlick = (id: string) => {
    setValdPuls(null);
    switch (verktyg) {
      case "flytta":
        setVald(id);
        return;
      case "farg":
      case "blink":
      case "puls":
        ändraRs((x) => växlaFigurMarkering(x, { figur: id, verktyg, färg }));
        return;
      case "koppla":
        if (!kopplaFrån) setKopplaFrån(id);
        else if (kopplaFrån === id) setKopplaFrån(null);
        else {
          ändraRs((x) => växlaPuls(x, kopplaFrån, id, färg));
          setKopplaFrån(null);
        }
        return;
      case "bubbla":
        setVald(id);
        setTimeout(() => bubblaFält.current?.focus(), 0);
        return;
      case "dolj":
        ändraRs((x) => växlaDold(x, id));
        return;
      case "sudd":
        ändraRs((x) => suddaFigur(x, id));
        return;
      case "tabort":
        taBort(id);
        return;
    }
  };

  /**
   * Tar bort en figur ur SCENEN – alla ramar. Förut gick det bara att nå
   * genom att välja Flytta, klicka på figuren och hitta knappen i raden ovanför;
   * med det förvalda verktyget fanns ingen väg alls ("Jag kan inte ta bort
   * objekt i Bild", 2026-09-30). Nu: verktyget Ta bort, Delete på den
   * valda, och knappen i den valda figurens rad.
   */
  //
  // TVÅ NIVÅER (beslut 2026-09-30): standard är bara den HÄR ramen – en figur
  // döljs då här (den finns kvar i scenen och i de andra ramarna, och syns
  // svagt i redigeringen så att den går att ta tillbaka). "Från alla ramar"
  // är ett uttryckligt val: figuren lämnar scenen, och en textruta eller
  // pulspunkt tas bort ur varje ram den kopierats till.
  function taBort(id: string, allaRamar = false) {
    const f = scen.figurer.find((x) => x.id === id);
    if (!f) return;
    if (allaRamar) {
      if (!confirm(`Ta bort "${f.namn || "figuren"}" ur alla ramar? Den försvinner ur scenen.`)) return;
      onSerie((s) => taBortFigur(s, id));
    } else ändraRs((x) => döljIRam(x, id));
    setVald(null);
  }
  function taBortText(id: string, allaRamar = false) {
    if (allaRamar) onSerie((s) => iAllaRamar(s, (x) => taBortTextruta(x, id)));
    else ändraRs((x) => taBortTextruta(x, id));
    setValdText(null);
  }
  function taBortPunkt(id: string, allaRamar = false) {
    if (allaRamar) onSerie((s) => iAllaRamar(s, (x) => taBortPulspunkt(x, id)));
    else ändraRs((x) => taBortPulspunkt(x, id));
    setValdPunkt(null);
  }

  /** En textruta: ett nedslag väljer den, ett drag flyttar den (samma vakter). */
  const textrutaDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (verktyg === "tabort") {
      taBortText(id);
      return;
    }
    const t = rs.textrutor.find((x) => x.id === id);
    if (!t) return;
    const p = tillScen(e);
    drar.current = { typ: "text", id, dx: p.x - t.x, dy: p.y - t.y, sx: e.clientX, sy: e.clientY, flyttad: false };
    svg.current?.setPointerCapture(e.pointerId);
    setValdText(id);
    setValdPunkt(null);
    setVald(null);
    setValdPuls(null);
  };

  /** En pulspunkt: ett nedslag väljer den, ett drag flyttar den. */
  const pulspunktDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (verktyg === "tabort") {
      taBortPunkt(id);
      return;
    }
    const pt = rs.pulspunkter.find((x) => x.id === id);
    if (!pt) return;
    const p = tillScen(e);
    drar.current = { typ: "punkt", id, dx: p.x - pt.x, dy: p.y - pt.y, sx: e.clientX, sy: e.clientY, flyttad: false };
    svg.current?.setPointerCapture(e.pointerId);
    setValdPunkt(id);
    setValdText(null);
    setVald(null);
    setValdPuls(null);
  };

  // Delete/Backspace tar bort det valda – aldrig medan man skriver.
  useEffect(() => {
    if (!vald && !valdText && !valdPunkt) return;
    const tangent = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const mål = e.target as HTMLElement | null;
      if (mål && (mål.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(mål.tagName))) return;
      e.preventDefault();
      // Shift = ur alla ramar; annars bara den här.
      if (valdPunkt) taBortPunkt(valdPunkt, e.shiftKey);
      else if (valdText) taBortText(valdText, e.shiftKey);
      else if (vald) taBort(vald, e.shiftKey);
    };
    window.addEventListener("keydown", tangent);
    return () => window.removeEventListener("keydown", tangent);
  });

  const onMove = (e: React.PointerEvent) => {
    const d = drar.current;
    if (!d) return; // bara vår EGEN dragning
    if (!(e.buttons & 1)) return; // bara medan knappen hålls
    if (!d.flyttad) {
      if (!ärDragning({ x: d.sx, y: d.sy }, { x: e.clientX, y: e.clientY })) return;
      d.flyttad = true;
      // En figur man drar är den man arbetar med – välj den, så att dess rad
      // (namn, storlek, Ta bort ur scenen) visas oavsett verktyg.
      if (d.typ === "figur") setVald(d.id);
    }
    const p = tillScen(e);
    const H = scenHöjd(scen);
    const x = Math.round(Math.min(SCEN_BREDD, Math.max(0, p.x - d.dx)));
    const y = Math.round(Math.min(H, Math.max(0, p.y - d.dy)));
    // Förflyttningen sedan förra rycket – den läggs på här eller i alla ramar.
    const nu =
      d.typ === "text"
        ? rs.textrutor.find((t) => t.id === d.id)
        : d.typ === "punkt"
          ? rs.pulspunkter.find((pt) => pt.id === d.id)
          : figurerIRam(scen, rs).find((f) => f.id === d.id);
    if (!nu || (nu.x === x && nu.y === y)) return;
    // Shift under draget vänder valet för just den här flytten.
    const alla = flyttaAlla !== e.shiftKey;
    onSerie((s) => flyttaObjekt(s, ram.id, { typ: d.typ, id: d.id }, x - nu.x, y - nu.y, alla));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drar.current;
    drar.current = null;
    svg.current?.releasePointerCapture?.(e.pointerId);
    if (d?.typ === "figur" && !d.flyttad && e.type === "pointerup") figurKlick(d.id);
  };

  const läggTill = (typ: FigurTyp) => {
    const n = scen.figurer.length;
    const f = nyFigur(typ, FIGURER[typ].namn, SCEN_BREDD / 2 + ((n * 37) % 200) - 100, scenHöjd(scen) / 2);
    // Bara i DEN HÄR ramen – dold i de andra.
    onSerie((s) => läggTillFigurIRam(s, f, ram.id));
    setVerktyg("flytta");
    setVald(f.id);
    setPalett(false);
  };

  const bytBakgrund = async (val: string) => {
    if (val === "bild") {
      filVal.current?.click();
      return;
    }
    onSerie((s) => ändraScen(s, (sc) => ({ ...sc, bakgrund: { typ: val as "stad" | "tom" } })));
  };

  const figur = vald ? scen.figurer.find((f) => f.id === vald) : undefined;
  const figurMarkering = vald ? rs.markeringar.find((m) => m.figur === vald) : undefined;
  const antalDolda = rs.dolda.filter((d) => scen.figurer.some((f) => f.id === d)).length;
  const textruta = valdText ? rs.textrutor.find((t) => t.id === valdText) : undefined;
  const pulspunkt = valdPunkt ? rs.pulspunkter.find((p) => p.id === valdPunkt) : undefined;
  const ändraPunkt = (f: (p: ScenPulspunkt) => ScenPulspunkt) =>
    valdPunkt && ändraRs((x) => ändraPulspunkt(x, valdPunkt, f));
  const ändraText = (f: (t: ScenTextruta) => ScenTextruta) =>
    valdText && ändraRs((x) => ändraTextruta(x, valdText, f));
  const puls = valdPuls ? rs.pulser.find((p) => p.id === valdPuls) : undefined;
  const namnAv = (id: string) => scen.figurer.find((f) => f.id === id)?.namn || "figur";

  return (
    <>
      <div className="ark-ramar-lada ark-ramar-lada--scen" role="toolbar" aria-label="Bildens verktyg">
        {VERKTYG.map((v) => (
          <button
            key={v.id}
            className={`ark-ramar-verktyg ${verktyg === v.id ? "vald" : ""}`}
            onClick={() => {
              setVerktyg(v.id);
              setKopplaFrån(null);
              if (v.id !== "flytta" && v.id !== "bubbla") setVald(null);
              if (v.id !== "textruta") setValdText(null);
              if (v.id !== "pulspunkt") setValdPunkt(null);
            }}
            title={v.hjälp}
            aria-pressed={verktyg === v.id}
          >
            <span aria-hidden>{v.ikon}</span> {v.namn}
          </button>
        ))}
        <span className="ark-ramar-skiljare" />
        <div
          className="ark-toggle ark-ramar-flyttaval"
          role="group"
          aria-label="Flytta i"
          title="Var en flytt gäller. Håll Shift under draget för att göra tvärtom en gång."
        >
          <span className="ark-ramar-flyttaval-etikett">Flytta i:</span>
          <button className={!flyttaAlla ? "active" : ""} onClick={() => setFlyttaAlla(false)}>
            Den här ramen
          </button>
          <button className={flyttaAlla ? "active" : ""} onClick={() => setFlyttaAlla(true)}>
            Alla ramar
          </button>
        </div>
        <span className="ark-ramar-skiljare" />
        <span title="Färgen för det du gör härnäst – och för det som är valt">
          <FärgVal färg={färg} setFärg={väljFärg} />
        </span>
        <span className="ark-ramar-skiljare" />
        <div className="ark-ramar-palett-hallare">
          <button className="ark-btn" onClick={() => setPalett((x) => !x)} aria-expanded={palett}>
            ✚ Figur/ikon
          </button>
          {palett && (
            <div className="ark-ramar-palett" role="menu">
              {FIGURGRUPPER.map((g) => (
                <div key={g}>
                  <div className="ark-ramar-palett-grupp">{g}</div>
                  <div className="ark-ramar-palett-rutor">
                    {(Object.keys(FIGURER) as FigurTyp[])
                      .filter((t) => FIGURER[t].grupp === g)
                      .map((t) => {
                        const d = FIGURER[t];
                        const m = Math.max(d.w, d.h) + 12;
                        return (
                          <button key={t} className="ark-ramar-palett-ruta" onClick={() => läggTill(t)} title={d.namn}>
                            <svg viewBox={`${-m / 2} ${-m / 2} ${m} ${m}`} width={40} height={40} aria-hidden>
                              {d.rita()}
                            </svg>
                            <span>{d.namn}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <select
          className="ark-input ark-ramar-bakgrund"
          value={scen.bakgrund.typ}
          onChange={(e) => void bytBakgrund(e.target.value)}
          aria-label="Bakgrund"
          title="Bakgrunden gäller hela serien"
        >
          <option value="stad">Bakgrund: stad</option>
          <option value="tom">Bakgrund: tom yta</option>
          <option value="bild">{scen.bakgrund.typ === "bild" ? "Bakgrund: egen bild" : "Ladda upp egen bild …"}</option>
        </select>
        {scen.bakgrund.typ === "bild" && (
          <button className="ark-btn" onClick={() => filVal.current?.click()}>
            Byt bild …
          </button>
        )}
        <input
          ref={filVal}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const fil = e.target.files?.[0];
            e.target.value = "";
            if (!fil) return;
            try {
              const b = await läsBild(fil);
              onSerie((s) => ändraScen(s, (sc) => ({ ...sc, bakgrund: { typ: "bild", ...b } })));
            } catch (err) {
              props.fel(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>

      <div className="ark-ramar-inspektor">
        {pulspunkt ? (
          <>
            <strong>Pulspunkt</strong>
            <select
              className="ark-input ark-ramar-storlek"
              value={String(pulspunkt.storlek ?? 1)}
              onChange={(e) => ändraPunkt((p) => ({ ...p, storlek: Number(e.target.value) }))}
              aria-label="Pulspunktens storlek"
            >
              <option value="0.6">Liten</option>
              <option value="1">Normal</option>
              <option value="1.6">Stor</option>
            </select>
            <button className="ark-btn" onClick={() => ändraPunkt((p) => ({ ...p, färg }))}>
              <span className="ark-ramar-prick" style={{ background: färg }} /> Använd vald färg
            </button>
            <TaBortKnappar onHär={() => taBortPunkt(pulspunkt.id)} onAlla={() => taBortPunkt(pulspunkt.id, true)} />
          </>
        ) : textruta ? (
          <>
            <strong>Textruta</strong>
            <input
              className="ark-input ark-ramar-kort"
              value={textruta.rubrik ?? ""}
              placeholder="Rubrik, t.ex. SÅ HÄR ÄR DET · Dag 1"
              onChange={(e) => ändraText((t) => ({ ...t, rubrik: e.target.value }))}
              aria-label="Textrutans rubrik"
            />
            <textarea
              ref={textFält}
              className="ark-input ark-ramar-textrutetext"
              value={textruta.text}
              placeholder="Vad ska stå i rutan?"
              rows={2}
              onChange={(e) => ändraText((t) => ({ ...t, text: e.target.value }))}
              aria-label="Textrutans text"
            />
            <label className="ark-ramar-val" title="Rutans bredd">
              Bredd
              <input
                type="range"
                min={TEXTRUTA_MIN_BREDD}
                max={1000}
                step={10}
                value={textruta.bredd}
                onChange={(e) => ändraText((t) => ({ ...t, bredd: Number(e.target.value) }))}
              />
            </label>
            <select
              className="ark-input ark-ramar-storlek"
              value={String(textruta.skala ?? 1)}
              onChange={(e) => ändraText((t) => ({ ...t, skala: Number(e.target.value) }))}
              aria-label="Textrutans storlek"
              title="Storlek på text och luft"
            >
              <option value="0.75">Liten</option>
              <option value="1">Normal</option>
              <option value="1.3">Stor</option>
            </select>
            <TextrutaFärg
              etikett="Bakgrund"
              färger={TEXTRUTA_BAKGRUNDER}
              värde={textruta.bakgrund ?? TEXTRUTA_BAKGRUNDER[0]}
              onVälj={(f) => ändraText((t) => ({ ...t, bakgrund: f }))}
            />
            <TextrutaFärg
              etikett="Text"
              färger={TEXTRUTA_TEXTFÄRGER}
              // Utan eget val är texten mörk på ljus bakgrund, annars vit – visa det som valt.
              värde={textruta.textfärg ?? (textruta.bakgrund && ärLjus(textruta.bakgrund) ? "#1f2937" : TEXTRUTA_TEXTFÄRGER[0])}
              onVälj={(f) => ändraText((t) => ({ ...t, textfärg: f }))}
            />
            <TaBortKnappar onHär={() => taBortText(textruta.id)} onAlla={() => taBortText(textruta.id, true)} />
          </>
        ) : puls ? (
          <>
            <strong>
              Puls: {namnAv(puls.från)} → {namnAv(puls.till)}
            </strong>
            <input
              className="ark-input"
              value={puls.text ?? ""}
              placeholder="Etikett, t.ex. Driftfråga"
              onChange={(e) => ändraRs((x) => ändraPuls(x, puls.id, (p) => ({ ...p, text: e.target.value })))}
              aria-label="Pulsens etikett"
            />
            <button className="ark-btn" onClick={() => ändraRs((x) => ändraPuls(x, puls.id, (p) => ({ ...p, färg })))}>
              <span className="ark-ramar-prick" style={{ background: färg }} /> Använd vald färg
            </button>
            <button
              className="ark-btn"
              onClick={() => ändraRs((x) => ändraPuls(x, puls.id, (p) => ({ ...p, från: p.till, till: p.från })))}
            >
              ⇄ Vänd
            </button>
            <button
              className="ark-btn"
              onClick={() => {
                ändraRs((x) => taBortPuls(x, puls.id));
                setValdPuls(null);
              }}
            >
              Ta bort pulsen
            </button>
          </>
        ) : figur ? (
          <>
            {figurMarkering && (
              <span className="ark-ramar-figurmarkering" title="Klicka på en färg för att byta – Sudda tar bort markeringen">
                <span className="ark-ramar-prick" style={{ background: figurMarkering.färg }} />
                {RAM_VERKTYG.find((v) => v.id === figurMarkering.verktyg)?.namn}
              </span>
            )}
            <input
              className="ark-input ark-ramar-kort"
              value={figur.namn}
              placeholder="Namn"
              onChange={(e) => onSerie((s) => ändraScen(s, (sc) => ändraFigur(sc, figur.id, (f) => ({ ...f, namn: e.target.value }))))}
              aria-label="Figurens namn"
              title="Namnet gäller alla ramar"
            />
            <label className="ark-ramar-val" title="Storleken gäller alla ramar">
              Storlek
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.1}
                value={figur.skala ?? 1}
                onChange={(e) =>
                  onSerie((s) => ändraScen(s, (sc) => ändraFigur(sc, figur.id, (f) => ({ ...f, skala: Number(e.target.value) }))))
                }
              />
            </label>
            <input
              ref={bubblaFält}
              className="ark-input"
              value={rs.bubblor.find((b) => b.figur === figur.id)?.text ?? ""}
              placeholder={`Vad säger ${figur.namn || "figuren"} i den här ramen?`}
              onChange={(e) => ändraRs((x) => sättBubbla(x, figur.id, e.target.value))}
              aria-label="Pratbubbla"
            />
            <button
              className="ark-btn"
              onClick={() => onSerie((s) => synsFrånRam(s, figur.id, props.ramIndex))}
              title="Dold i alla ramar före den här, synlig från och med den"
            >
              Tona in från ram {props.ramIndex + 1}
            </button>
            {rs.figurLägen?.[figur.id] && (
              <button
                className="ark-btn"
                onClick={() => ändraRs((x) => scenensPlats(x, figur.id))}
                title="Figuren står på en egen plats i den här ramen – tillbaka till samma plats som i övriga ramar"
              >
                Samma plats som i övriga ramar
              </button>
            )}
            <TaBortKnappar
              onHär={() => taBort(figur.id)}
              onAlla={() => taBort(figur.id, true)}
              härTitel="Figuren döljs i den här ramen och finns kvar i de andra – Visa/dölj tar tillbaka den"
              allaTitel="Figuren tas bort ur scenen och försvinner ur alla ramar"
            />
          </>
        ) : (
          <span className="ark-hint ark-ramar-tips">
            {verktyg === "koppla"
              ? kopplaFrån
                ? `Pulsen går från ${namnAv(kopplaFrån)} – klicka på figuren den går till.`
                : "Klicka på figuren pulsen går FRÅN, sedan den den går TILL. Klicka på en puls för att ge den en etikett."
              : VERKTYG.find((v) => v.id === verktyg)?.hjälp}
            {antalDolda > 0 && verktyg !== "dolj" && (
              <>
                {" · "}
                <button className="ark-linkbtn" onClick={() => setVerktyg("dolj")}>
                  {antalDolda === 1 ? "1 figur är dold" : `${antalDolda} figurer är dolda`} i den här ramen – visa och ta
                  tillbaka
                </button>
              </>
            )}
          </span>
        )}
      </div>

      <div className="ark-ramar-bild anpassa ark-ramar-bild--scen">
        <ScenBild
          ref={svg}
          scen={scen}
          rs={rs}
          läge="redigera"
          prefix="ark-scen-e"
          vald={vald}
          kopplaFrån={kopplaFrån}
          tända={tändaFigurer(verktyg, scen, rs)}
          valdPuls={valdPuls}
          onFigurDown={figurDown}
          onPulsKlick={(id) => {
            if (verktyg === "sudd") ändraRs((x) => taBortPuls(x, id));
            else {
              setValdPuls(id);
              setVald(null);
            }
          }}
          onBakgrundKlick={(e) => {
            setVald(null);
            setValdPuls(null);
            setKopplaFrån(null);
            if (verktyg === "pulspunkt") {
              sättPulspunkt(e);
              return;
            }
            setValdPunkt(null);
            if (verktyg === "textruta") {
              // Ny textruta där man klickade – och skriv direkt.
              const p = tillScen(e);
              const t = nyTextruta(p.x, p.y);
              ändraRs((x) => läggTillTextruta(x, t));
              setValdText(t.id);
              setTimeout(() => textFält.current?.focus(), 0);
            } else setValdText(null);
          }}
          valdText={valdText}
          visaDolda={verktyg === "dolj"}
          valdPunkt={valdPunkt}
          onPulspunktDown={pulspunktDown}
          onTextrutaDown={textrutaDown}
          className={`verktyg-${verktyg}`}
          // Dragningen fångas på SVG:n (setPointerCapture), så flytten läses
          // där även när pekaren glider utanför figuren.
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
    </>
  );
}

/** Ett färgval: några färdiga färger och en fri väljare. */
function TextrutaFärg(props: { etikett: string; färger: string[]; värde: string; onVälj: (f: string) => void }) {
  return (
    <span className="ark-ramar-fargval" role="group" aria-label={`${props.etikett}sfärg`}>
      <span className="ark-ramar-fargval-etikett">{props.etikett}</span>
      {props.färger.map((f) => (
        <button
          key={f}
          className={`ark-ramar-prick-knapp ${props.värde.toLowerCase() === f ? "vald" : ""}`}
          style={{ background: f }}
          onClick={() => props.onVälj(f)}
          title={f}
          aria-label={`${props.etikett} ${f}`}
        />
      ))}
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(props.värde) ? props.värde : "#000000"}
        onChange={(e) => props.onVälj(e.target.value)}
        aria-label={`${props.etikett}: egen färg`}
        title="Egen färg"
      />
    </span>
  );
}

/** "Ta bort": standard den här ramen, uttryckligt val för alla ramar. */
function TaBortKnappar(props: { onHär: () => void; onAlla: () => void; härTitel?: string; allaTitel?: string }) {
  return (
    <span className="ark-ramar-tabort">
      <button className="ark-btn" onClick={props.onHär} title={props.härTitel ?? "Tas bort ur den här ramen (Delete)"}>
        Ta bort från den här ramen
      </button>
      <button
        className="ark-linkbtn"
        onClick={props.onAlla}
        title={props.allaTitel ?? "Tas bort ur alla ramar där den finns (Shift+Delete)"}
      >
        … från alla ramar
      </button>
    </span>
  );
}
