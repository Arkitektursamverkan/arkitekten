/**
 * Verktygsradens byggstenar – delade av Flödesschema och Affärsprocess.
 *
 * Redigeringsalternativen låg i en 320 px bred spalt mellan menyn och ritytan:
 * sexton sektioner på rad, alla lika framträdande, alla synliga hela tiden.
 * Beskrivningen, sidformatet, tre reglage, exporten, versionerna och
 * spårbarheten stod bredvid varandra utan att någon av dem hade med den andra
 * att göra. Spalten var alltså i vägen för det enda som borde ha haft plats –
 * diagrammet – och samtidigt svår att hitta i, eftersom ingenting var dolt.
 *
 * Nu gäller tre regler:
 *  1. Det man gör OFTA ligger i en rad ovanför ritytan, alltid nåbart.
 *  2. Det man gör IBLAND ligger bakom en namngiven rullgardin i samma rad.
 *  3. Det som hör till ett MARKERAT objekt ritas vid objektet (canvasens egna
 *     inspektörer), inte i en spalt långt bort.
 *
 * Rullgardinen stängs vid klick utanför och med Esc – samma gest som allt
 * annat som lägger sig ovanpå i appen.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Raden själv. `höger` hamnar längst till höger med luft emellan. */
export function Verktygsrad({ children, höger }: { children: ReactNode; höger?: ReactNode }) {
  return (
    <div className="ark-vrad">
      {children}
      {höger && <div className="ark-vrad-hoger">{höger}</div>}
    </div>
  );
}

/** En grupp knappar. Grupperna skiljs åt med en tunn lodrät linje. */
export function VradGrupp({ children }: { children: ReactNode }) {
  return <div className="ark-vrad-grupp">{children}</div>;
}

export interface VradKnappProps {
  children: ReactNode;
  onClick?: () => void;
  aktiv?: boolean;
  disabled?: boolean;
  title?: string;
  /** Bär knappen bara en ikon? Då blir den kvadratisk. */
  ikon?: boolean;
  /**
   * Markerar en AI-åtgärd. Den vägen är appens enda icke-deterministiska, och
   * att den syns i raden är en del av löftet: AI:n fyller mellanlagret, den
   * ritar aldrig.
   */
  ai?: boolean;
}

export function VradKnapp({ children, onClick, aktiv, disabled, title, ikon, ai }: VradKnappProps) {
  return (
    <button
      type="button"
      className={`ark-vrad-knapp ${aktiv ? "aktiv" : ""} ${ikon ? "ikon" : ""} ${ai ? "ai" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={aktiv}
    >
      {children}
    </button>
  );
}

export interface RullgardinProps {
  /** Knappens text i raden. */
  titel: string;
  children: ReactNode;
  /** Panelens bredd i px. Standard räcker för ett par reglage och en hjälptext. */
  bredd?: number;
  /**
   * Hörnet panelen växer ifrån. Rullgardiner nära högerkanten måste öppna åt
   * vänster, annars hamnar panelen utanför fönstret.
   */
  align?: "left" | "right";
  /** Liten notis på knappen – t.ex. antal avvikelser. */
  märke?: ReactNode;
  /** Markerar knappen som "något är valt här" utan att panelen är öppen. */
  aktiv?: boolean;
  title?: string;
  /**
   * Håll innehållet MONTERAT även när panelen är stängd (bara dolt).
   *
   * Behövs när något utanför rullgardinen talar med panelens innehåll genom en
   * ref: "Spara"-knappen i huvudraden anropar `bibliotek.current?.spara()`, och
   * så länge panelen monterades först vid öppning var den refen null. Knappen
   * gjorde alltså ingenting alls, tyst, tills man råkat öppna Versioner en
   * gång – och flödet stod kvar som "Inte sparat än".
   */
  behållBarn?: boolean;
}

export function Rullgardin({
  titel,
  children,
  bredd = 280,
  align = "left",
  märke,
  aktiv,
  title,
  behållBarn = false,
}: RullgardinProps) {
  const [öppen, setÖppen] = useState(false);
  const rot = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!öppen) return;
    /**
     * Stängning på klick utanför. `pointerdown` och inte `click`: ett klick på
     * ritytan bakom panelen ska både stänga rullgardinen och nå canvasen, och
     * en `click`-lyssnare hann först stänga och sedan svälja händelsen.
     */
    const utanför = (e: PointerEvent) => {
      if (!rot.current?.contains(e.target as globalThis.Node)) setÖppen(false);
    };
    const tangent = (e: KeyboardEvent) => {
      if (e.key === "Escape") setÖppen(false);
    };
    window.addEventListener("pointerdown", utanför);
    window.addEventListener("keydown", tangent);
    return () => {
      window.removeEventListener("pointerdown", utanför);
      window.removeEventListener("keydown", tangent);
    };
  }, [öppen]);

  return (
    <div className="ark-rullgardin" ref={rot}>
      <button
        type="button"
        className={`ark-vrad-knapp ${öppen ? "oppen" : ""} ${aktiv ? "aktiv" : ""}`}
        onClick={() => setÖppen((o) => !o)}
        aria-expanded={öppen}
        aria-controls={id}
        title={title}
      >
        {titel}
        {märke !== undefined && <span className="ark-vrad-marke">{märke}</span>}
        <span className="ark-vrad-pil" aria-hidden>
          ▾
        </span>
      </button>
      {(öppen || behållBarn) && (
        <div
          id={id}
          className={`ark-rullgardin-panel ${align === "right" ? "hoger" : ""}`}
          style={{ width: bredd, display: öppen ? undefined : "none" }}
          aria-hidden={!öppen}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** En rubrikförsedd avdelning inuti en rullgardin. */
export function RullgardinDel({ titel, children }: { titel?: string; children: ReactNode }) {
  return (
    <div className="ark-rullgardin-del">
      {titel && <div className="ark-section-title">{titel}</div>}
      {children}
    </div>
  );
}
