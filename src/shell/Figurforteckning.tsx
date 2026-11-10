/**
 * Figurförteckningen – faktarutan som säger vad symbolerna i bilden BETYDER.
 *
 * Ett processdiagram är fullt av former och färger som bär mening: en romb är
 * en fråga, en persikafärgad ruta en aktivitet, en gul linje att någon bara
 * INFORMERAS. Den som ritat vet det; den som läser gör det inte. Förteckningen
 * är därför FÄLLBAR och ligger i verktygsraden i BÅDA lägena – också när man
 * bara läser, för det är då man behöver den.
 *
 * Bara det som FAKTISKT står i den öppna processen listas. En fast katalog
 * över fjorton symboler säger ingenting om just den här bilden, och den som
 * letar efter den gula linjen hittar den snabbare i en lista på fem rader.
 *
 * Rutan är ett LÄSHJÄLPMEDEL PÅ SKÄRMEN. Den ritas medvetet INTE in i
 * exporten: den bilden jämförs sida vid sida med processägarens egen utskrift,
 * och ett extra hörn med teckenförklaring hade gjort den jämförelsen omöjlig.
 *
 * EN REGEL, EN PLATS: rutan hittar aldrig på en form eller en färg själv.
 * Symbolerna kommer FÄRDIGRITADE ur samma moduler som ritytan och exporten
 * ritar ur (`former.ts`, `theme.ts`), så förteckningen kan inte visa en
 * annan symbol än den som står i bilden. Kontraktet bor i `core/figurer.ts`,
 * för samma lista följer med i SCENEN ut till EA-portalen – där ritas den av
 * portalens egen faktaruta ur precis de här fragmenten.
 */

import type { Figur, FigurGrupp } from "@/core/figurer";
import { Rullgardin, RullgardinDel } from "./Verktygsrad";
import { säkerSvg } from "@/render/saker-svg";

/**
 * Symbolen, ritad rakt av ur sitt fragment.
 *
 * `dangerouslySetInnerHTML` av samma skäl som affärsprocessens palett och ApView har det:
 * markupen kommer ur våra egna formmoduler, aldrig utifrån, och att bygga om
 * den till React-element hade varit en andra uppsättning ritregler.
 */
function FigurIkon({ figur }: { figur: Figur }) {
  return (
    <svg
      width={30}
      height={22}
      viewBox={`0 0 ${figur.w} ${figur.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: säkerSvg(figur.svg, { fragment: true }) }}
    />
  );
}

export interface FigurförteckningProps {
  grupper: FigurGrupp[];
  /** Texten när processen ännu är tom. */
  tomText?: string;
}

/**
 * Knappen i verktygsraden och faktarutan den fäller ner.
 *
 * Märket på knappen är antalet SORTER, inte antalet objekt: det svarar på
 * "hur mycket har jag att lära mig för att läsa den här bilden?".
 */
export function Figurförteckning({ grupper, tomText }: FigurförteckningProps) {
  const sorter = grupper.reduce((n, g) => n + g.figurer.length, 0);

  return (
    <Rullgardin
      titel="▣ Figurer"
      bredd={360}
      märke={sorter > 0 ? sorter : undefined}
      title="Vad symbolerna och färgerna i bilden betyder"
    >
      {sorter === 0 ? (
        <p className="ark-hint">{tomText ?? "Inget ritat än – här listas symbolerna som används."}</p>
      ) : (
        grupper.map((grupp) => (
          <RullgardinDel key={grupp.titel} titel={grupp.titel}>
            <ul className="ark-figurlista">
              {grupp.figurer.map((figur) => (
                <li key={figur.nyckel} className="ark-figur">
                  <span className="ark-figur-ikon">
                    <FigurIkon figur={figur} />
                  </span>
                  <span className="ark-figur-text">
                    <span className="ark-figur-namn">
                      {figur.namn}
                      <span className="ark-figur-antal" title={`${figur.antal} i processen`}>
                        {figur.antal}
                      </span>
                    </span>
                    <span className="ark-figur-betydelse">{figur.betydelse}</span>
                  </span>
                </li>
              ))}
            </ul>
            {grupp.hint && <p className="ark-hint">{grupp.hint}</p>}
          </RullgardinDel>
        ))
      )}
    </Rullgardin>
  );
}
