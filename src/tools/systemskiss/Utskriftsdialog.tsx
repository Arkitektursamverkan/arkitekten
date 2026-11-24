/**
 * Dialogen Skriv ut för en systemskiss: papper, riktning och om det blir ett
 * blad eller ett per lager. Listan visar varje blad och hur stor brödtexten
 * blir på pappret, så att man ser före utskriften om den går att läsa.
 * Valen minns i webbläsaren (bara bekvämlighet – inget sparas i skissen).
 */
import { useMemo, useState } from "react";
import type { Systemskiss } from "@/core/systemskiss";
import type { Revision } from "@/tools/flowchart/export/revision";
import {
  delText,
  läsbarhet,
  skrivUt,
  UTSKRIFT_FÖRVAL,
  utskriftsblad,
  utskriftsdokument,
  type Innehåll,
  type Papper,
  type Riktning,
  type Utskriftsval,
} from "./utskrift";

const NYCKEL = "ark.skiss.utskrift";

function läsVal(): Utskriftsval {
  try {
    const v = JSON.parse(localStorage.getItem(NYCKEL) ?? "null");
    return v && typeof v === "object" ? { ...UTSKRIFT_FÖRVAL, ...v } : UTSKRIFT_FÖRVAL;
  } catch {
    return UTSKRIFT_FÖRVAL;
  }
}

function sparaVal(v: Utskriftsval): void {
  try {
    localStorage.setItem(NYCKEL, JSON.stringify(v));
  } catch {
    /* privat läge – valet glöms */
  }
}

/** CSS-klassen per läsbarhet – utan å, ä, ö. */
const KLASS = { bra: "bra", liten: "liten", oläsbar: "olasbar" } as const;

const pt = (v: number) => v.toLocaleString("sv-SE", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function Utskriftsdialog(props: {
  /** Versionen man tittar på, ofiltrerad. */
  skiss: Systemskiss;
  filter: ReadonlySet<string> | null;
  grannar: boolean;
  revision?: Revision;
  onStäng: () => void;
}) {
  const { skiss, filter, grannar, revision, onStäng } = props;
  const [val, setVal] = useState<Utskriftsval>(läsVal);
  const ändra = (ny: Partial<Utskriftsval>) => {
    const v = { ...val, ...ny };
    setVal(v);
    sparaVal(v);
  };
  const harLager = (skiss.lager ?? []).length > 0;
  const blad = useMemo(
    () => utskriftsblad(skiss, harLager ? val : { ...val, innehåll: "visas" }, filter, grannar, revision),
    [skiss, val, harLager, filter, grannar, revision],
  );
  const sämsta = blad.length ? Math.min(...blad.map((b) => b.textPt)) : 0;

  const radio = <T extends string>(namn: string, värde: T, nu: T, etikett: string, på: (v: T) => void) => (
    <label className="ark-utskrift-val">
      <input type="radio" name={namn} checked={nu === värde} onChange={() => på(värde)} /> {etikett}
    </label>
  );

  return (
    <div className="ark-flyttalager" onClick={onStäng}>
      <div className="ark-flyttadialog ark-utskrift" role="dialog" aria-label="Skriv ut" onClick={(e) => e.stopPropagation()}>
        <h2 className="ark-flytta-rubrik">Skriv ut ”{skiss.namn}”</h2>
        <p className="ark-hint">Skriv ut på papper eller spara som PDF i webbläsarens utskriftsdialog.</p>

        <fieldset className="ark-utskrift-grupp">
          <legend className="ark-field-label">Papper</legend>
          {(["A4", "A3"] as Papper[]).map((p) => radio("ark-papper", p, val.papper, p, (v) => ändra({ papper: v })))}
        </fieldset>
        <fieldset className="ark-utskrift-grupp">
          <legend className="ark-field-label">Riktning</legend>
          {radio<Riktning>("ark-riktning", "auto", val.riktning, "Den som ger störst bild", (v) => ändra({ riktning: v }))}
          {radio<Riktning>("ark-riktning", "stående", val.riktning, "Stående", (v) => ändra({ riktning: v }))}
          {radio<Riktning>("ark-riktning", "liggande", val.riktning, "Liggande", (v) => ändra({ riktning: v }))}
        </fieldset>
        {harLager && (
          <fieldset className="ark-utskrift-grupp">
            <legend className="ark-field-label">Innehåll</legend>
            {radio<Innehåll>("ark-innehall", "visas", val.innehåll, filter ? "Det som visas nu (valda lager)" : "Hela skissen på ett blad", (v) => ändra({ innehåll: v }))}
            {radio<Innehåll>("ark-innehall", "lager", val.innehåll, "Ett blad per lager", (v) => ändra({ innehåll: v }))}
            {val.innehåll === "lager" && (
              <label className="ark-utskrift-val ark-utskrift-indrag">
                <input type="checkbox" checked={val.medHela} onChange={(e) => ändra({ medHela: e.target.checked })} /> Hela skissen först
              </label>
            )}
          </fieldset>
        )}

        <label className="ark-utskrift-val">
          <input type="checkbox" checked={val.dela} onChange={(e) => ändra({ dela: e.target.checked })} /> Dela en bild på flera blad när
          texten blir mindre än 5 pt (bladen överlappar 1 cm)
        </label>

        <div className="ark-field-label">
          {blad.length} blad · rutornas text på pappret
        </div>
        <ol className="ark-utskrift-blad">
          {blad.map((b, i) => (
            <li key={i} className={`ark-utskrift-${KLASS[läsbarhet(b.textPt)]}`}>
              <span className="ark-utskrift-namn">
                {b.rubrik}
                {b.del ? ` · ${delText(b)}` : ""}
              </span>
              <span className="ark-utskrift-pt">
                {b.liggande ? "liggande" : "stående"} · {pt(b.textPt)} pt
              </span>
            </li>
          ))}
        </ol>
        {blad.length > 0 && läsbarhet(sämsta) !== "bra" && (
          <p className="ark-hint ark-utskrift-varning" role="status">
            Texten blir {läsbarhet(sämsta) === "oläsbar" ? "mycket liten" : "liten"} på pappret
            {val.papper === "A4" ? " – A3 ger större text" : ""}
            {harLager && val.innehåll === "visas" ? ". Ett blad per lager ger större text" : ""}.
          </p>
        )}

        <div className="ark-flytta-fot">
          <button
            className="ark-btn ark-btn--primary"
            disabled={blad.length === 0}
            onClick={() => {
              skrivUt(utskriftsdokument(skiss.namn, blad, val.papper));
              onStäng();
            }}
          >
            🖨 Skriv ut …
          </button>
          <button className="ark-linkbtn" onClick={onStäng}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}
