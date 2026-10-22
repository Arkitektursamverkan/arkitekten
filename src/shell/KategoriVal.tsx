/**
 * Kategoriväljaren – var i katalogen processen ska ligga.
 *
 * Kategorin är katalogens och menyns översta nivå. Den var förut en regel i
 * koden ("allt som är ett flödesschema hör till portalen"), vilket dög så
 * länge biblioteket bara innehöll portalens processer. En affärsprocess som ska
 * ligga under "Systemförvaltning" går inte att uttrycka som ett mönster i ett
 * id, så kategorin är numera något man väljer.
 *
 * BEFINTLIGA FÖRST, ny som ett aktivt val. En fritextruta ensam hade tyst
 * skapat en andra gren vid minsta stavfel – "Systemförvaltning" och
 * "systemförvaltning" är två rubriker men samma avsikt för den som skrev dem.
 * Listan gör det normala fallet till ett klick och det ovanliga till ett
 * medvetet steg.
 *
 * Komponenten äger bara växeln mellan lista och fritext; värdet ägs av den som
 * använder den.
 */

import { useState } from "react";

/** Sentinelvärdet i listan. Kan inte krocka med en riktig titel – "/" slugas bort. */
const NY = "__ny__";

export interface KategoriValProps {
  /** Vald kategori. Tom sträng = ingen egen (reglerna i flow-tree.ts gäller). */
  värde: string;
  /** Kategorierna som redan finns i biblioteket. */
  kategorier: string[];
  onChange: (kategori: string) => void;
  /** Texten på "ingen kategori"-valet – olika verktyg beskriver det olika. */
  tomEtikett?: string;
  /**
   * Vad nivån heter i klartext ("kategorin", "underkategorin"). Används i
   * valet "Ny …" och som etikett på fritextrutan – två väljare på samma sida
   * måste gå att skilja åt, både för användaren och för skärmläsaren.
   */
  nivå?: string;
  id?: string;
}

export function KategoriVal({
  värde,
  kategorier,
  onChange,
  tomEtikett = "Ingen kategori",
  nivå = "kategori",
  id,
}: KategoriValProps) {
  /**
   * Skriver användaren in en ny kategori just nu? Eget tillstånd, för värdet
   * kan vara tomt både när man valt "ingen" och när man börjat skriva ett nytt
   * namn men inte hunnit få i en bokstav.
   */
  const [skriverNy, setSkriverNy] = useState(false);

  // Ett värde som inte finns i listan (en ny kategori man just skrivit) måste
  // ändå kunna visas som valt – annars hoppar väljaren tillbaka till tomt.
  const val = [...kategorier];
  if (värde && !val.includes(värde)) val.push(värde);

  return (
    <div className="ark-kategorival">
      <select
        id={id}
        className="ark-input"
        value={skriverNy ? NY : värde}
        onChange={(e) => {
          if (e.target.value === NY) {
            setSkriverNy(true);
            onChange("");
          } else {
            setSkriverNy(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{tomEtikett}</option>
        {val.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
        <option value={NY}>Ny {nivå} …</option>
      </select>

      {skriverNy && (
        <input
          className="ark-input"
          value={värde}
          onChange={(e) => onChange(e.target.value)}
          placeholder="t.ex. Systemförvaltning"
          aria-label={`Namn på den nya ${nivå}n`}
          spellCheck={false}
          autoFocus
        />
      )}
    </div>
  );
}
