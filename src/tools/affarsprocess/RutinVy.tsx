/**
 * Rutinvyn: visar – och i redigeringsläge skapar/ändrar – rutinen bakom ett
 * krav. Öppnas ur inspektören ("Skapa rutin"/"Visa rutin") och, i läsläge,
 * med ett klick på ett krav som bär rutin-ikonen.
 *
 * Texten skrivs som den klistras in: en rad per moment, indragna rader blir
 * underpunkter. Tolkningen bor i `core/rutin.ts`.
 *
 * LÄSNINGEN ÄR EN GUIDE, inte en lista: varje moment är ett kort med en symbol
 * för vad man ska göra, klickvägar ("A → B → C") ritas som brickor, korta
 * alternativ som val, och man bockar av momenten medan man går. Allt bildstöd
 * HÄRLEDS ur texten (`rutinSort`, `rutinStig`, `underpunktSort`) – rutinen är
 * fortfarande bara de rader man klistrade in.
 *
 * SKRIVNINGEN har tre vägar till samma text: BYGGA moment för moment i
 * guidens egen form, KLISTRA IN som rader, eller LADDA UPP en fil och låta AI
 * göra om den (`ai-rutin.ts`). Alla tre fyller utkastet; inget sparas förrän
 * man trycker på knappen.
 */

import { useRef, useState } from "react";
import { useAiVäg } from "@/tools/flowchart/ai/useAiVag";
import {
  rutinSort,
  rutinStig,
  skrivRutin,
  tolkaRutin,
  underpunktSort,
  ärUpplysning,
  type RutinMoment,
  type RutinSort,
} from "@/core/rutin";

export interface RutinVyProps {
  /** Kravets namn – rutinens rubrik. */
  namn: string;
  /** Rutinens text; saknas = ingen rutin ännu. */
  text?: string;
  /** Aktiviteten kravet hänger på, som underrubrik. */
  aktivitet?: string;
  /** false = läsläge: bara visning. */
  redigerbar: boolean;
  /** Sparar texten; tom text/undefined tar bort rutinen. */
  onSpara: (text: string | undefined) => void;
  onClose: () => void;
  /**
   * Gör en uppladdad fil till rutinens text (AI-vägen, `ai-rutin.ts`).
   * Saknas den finns ingen uppladdningsknapp. Resultatet hamnar i UTKASTET –
   * det blir en rutin först när man sparar.
   */
  onAiFil?: (fil: File, signal: AbortSignal) => Promise<string>;
}

const TOMT: RutinMoment = { text: "", under: [] };

export function RutinVy({ namn, text, aktivitet, redigerbar, onSpara, onClose, onAiFil }: RutinVyProps) {
  // Finns ingen rutin är "visa" en tom sida – börja i skrivläget direkt.
  const [skriver, setSkriver] = useState(redigerbar && !text);
  /**
   * Två sätt att skriva SAMMA rutin: bygga den moment för moment, eller
   * klistra in den som text. Byggaren håller momenten (en ny, tom rad måste
   * få finnas medan man skriver); texten är det som lagras. Bytet mellan dem
   * går genom `tolkaRutin`/`skrivRutin`, så ingenting kan skilja dem åt.
   */
  const [sätt, setSätt] = useState<"bygg" | "text">("bygg");
  const [bygge, setBygge] = useState<RutinMoment[]>(() => börjaBygge(text));
  const [utkast, setUtkast] = useState(text ?? "");
  /** Det som skulle sparas just nu, oavsett vilket sätt man står i. */
  const utkastText = () => (sätt === "bygg" ? skrivRutin(bygge) : utkast);
  const bytSätt = (nytt: "bygg" | "text") => {
    if (nytt === sätt) return;
    if (nytt === "text") setUtkast(skrivRutin(bygge));
    else setBygge(börjaBygge(utkast));
    setSätt(nytt);
  };
  /** Raden som ska få markören efter nästa rendering ("m3" eller "m3u1"). */
  const fokus = useRef<string | null>(null);
  const tillFokus = (el: HTMLTextAreaElement | null, nyckel: string) => {
    if (el && fokus.current === nyckel) {
      fokus.current = null;
      el.focus();
    }
  };
  const ändraMoment = (i: number, m: RutinMoment) => setBygge((b) => b.map((x, k) => (k === i ? m : x)));
  const nyttMoment = (efter: number) => {
    fokus.current = `m${efter + 1}`;
    setBygge((b) => [...b.slice(0, efter + 1), { ...TOMT }, ...b.slice(efter + 1)]);
  };
  const nyUnderpunkt = (i: number, efter: number) => {
    fokus.current = `m${i}u${efter + 1}`;
    setBygge((b) =>
      b.map((x, k) =>
        k === i ? { ...x, under: [...x.under.slice(0, efter + 1), "", ...x.under.slice(efter + 1)] } : x,
      ),
    );
  };
  const flytta = (i: number, steg: -1 | 1) =>
    setBygge((b) => {
      const mål = i + steg;
      if (mål < 0 || mål >= b.length) return b;
      const n = [...b];
      [n[i], n[mål]] = [n[mål], n[i]];
      return n;
    });
  const taBort = (i: number) => setBygge((b) => (b.length > 1 ? b.filter((_, k) => k !== i) : [{ ...TOMT }]));

  /** AI-vägen: väntar på svaret, eller har misslyckats med ett besked. */
  const [ai, setAi] = useState<{ väntar: boolean; fel?: string }>({ väntar: false });
  const aiVäg = useAiVäg();
  const avbryt = useRef<AbortController | null>(null);
  const filval = useRef<HTMLInputElement | null>(null);
  const laddaUpp = async (fil: File | undefined) => {
    if (!fil || !onAiFil) return;
    const ctrl = new AbortController();
    avbryt.current = ctrl;
    setAi({ väntar: true });
    try {
      const rutin = await onAiFil(fil, ctrl.signal);
      // Svaret ersätter utkastet och visas i byggaren – där ser man det i
      // rutinens egen form och kan rätta innan man sparar.
      setUtkast(rutin);
      setBygge(börjaBygge(rutin));
      setSätt("bygg");
      setAi({ väntar: false });
    } catch (e) {
      setAi({ väntar: false, fel: ctrl.signal.aborted ? undefined : e instanceof Error ? e.message : String(e) });
    }
  };

  const moment = tolkaRutin(text ?? "");
  /**
   * Avbockade moment. Hör till LÄSNINGEN, inte till rutinen: det är var man
   * själv är just nu, så det sparas inte i mellanlagret och ger ingen version.
   */
  const [klara, setKlara] = useState<Set<number>>(new Set());
  const växla = (i: number) =>
    setKlara((k) => {
      const n = new Set(k);
      if (!n.delete(i)) n.add(i);
      return n;
    });
  /** Första momentet som inte är avbockat – där man är. */
  const aktuellt = moment.findIndex((_, i) => !klara.has(i));

  return (
    <div className="ark-ap-rutin" role="dialog" aria-label={`Rutin: ${namn}`}>
      <div className="ark-ap-inspektor-huvud">
        <strong>Rutin · {namn}</strong>
        <button className="ark-btn ark-btn--icon" onClick={onClose} title="Stäng">
          ×
        </button>
      </div>
      {aktivitet && <p className="ark-hint">Gäller aktiviteten ”{aktivitet}”.</p>}

      {skriver ? (
        <>
          <div className="ark-rutin-verktyg">
            <div className="ark-rutin-flikar" role="tablist" aria-label="Sätt att skriva rutinen">
              <button role="tab" aria-selected={sätt === "bygg"} onClick={() => bytSätt("bygg")}>
                Bygg
              </button>
              <button role="tab" aria-selected={sätt === "text"} onClick={() => bytSätt("text")}>
                Klistra in text
              </button>
            </div>
            {onAiFil && (
              <>
                <input
                  ref={filval}
                  type="file"
                  hidden
                  aria-label="Fil att skapa rutinen ur"
                  accept=".docx,.doc,.odt,.pdf,.txt,.md,.rtf,.png,.jpg,.jpeg"
                  onChange={(e) => {
                    void laddaUpp(e.target.files?.[0]);
                    e.target.value = ""; // samma fil ska gå att välja igen
                  }}
                />
                {aiVäg !== "av" && <button
                  className="ark-btn ark-btn--ai"
                  disabled={ai.väntar}
                  title="Ladda upp ett dokument och låt AI göra om det till en rutin"
                  onClick={() => filval.current?.click()}
                >
                  ✦ Skapa ur fil
                </button>}
              </>
            )}
          </div>

          {ai.väntar && (
            <div className="ark-rutin-ai" role="status">
              {aiVäg === "api" ? (
                <span>AI:n läser filen och skriver rutinen. Låt den här rutan stå öppen så länge.</span>
              ) : (
                <span>
                  Filen är uppladdad och väntar på Claude Code. Be den <em>”besvara rutinbegäran”</em>, och låt
                  den här rutan stå öppen så länge.
                </span>
              )}
              <button className="ark-linkbtn" onClick={() => avbryt.current?.abort()}>
                Avbryt
              </button>
            </div>
          )}
          {ai.fel && <p className="ark-rutin-fel">{ai.fel}</p>}

          {sätt === "bygg" ? (
            <>
              <ol className="ark-ap-rutin-lista ark-rutin-bygge">
                {bygge.map((m, i) => (
                  <li key={i} className="ark-rutin-moment">
                    <span className="ark-rutin-bock" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="ark-rutin-kropp">
                      <div className="ark-rutin-rad">
                        <RutinIkon sort={rutinSort(m.text)} />
                        <textarea rows={1}
                          ref={(el) => tillFokus(el, `m${i}`)}
                          className="ark-rutin-falt"
                          aria-label={`Moment ${i + 1}`}
                          value={m.text}
                          placeholder="Vad ska göras? T.ex. Gå till Data -> Hämta data"
                          onChange={(e) => ändraMoment(i, { ...m, text: enRad(e.target.value) })}
                          onKeyDown={(e) => {
                            // Fältet växer med texten men rymmer EN rad i
                            // lagringen: Enter är "nästa moment", aldrig en radbrytning.
                            if (e.key === "Enter") {
                              e.preventDefault();
                              nyttMoment(i);
                            }
                          }}
                        />
                        <span className="ark-rutin-radknappar">
                          <button title="Flytta upp" aria-label={`Flytta upp moment ${i + 1}`} disabled={i === 0} onClick={() => flytta(i, -1)}>
                            ↑
                          </button>
                          <button
                            title="Flytta ner"
                            aria-label={`Flytta ner moment ${i + 1}`}
                            disabled={i === bygge.length - 1}
                            onClick={() => flytta(i, 1)}
                          >
                            ↓
                          </button>
                          <button title="Ta bort momentet" aria-label={`Ta bort moment ${i + 1}`} onClick={() => taBort(i)}>
                            ×
                          </button>
                        </span>
                      </div>
                      {m.under.map((u, j) => (
                        <div key={j} className="ark-rutin-rad under">
                          <textarea rows={1}
                            ref={(el) => tillFokus(el, `m${i}u${j}`)}
                            className="ark-rutin-falt"
                            aria-label={`Underpunkt ${j + 1} till moment ${i + 1}`}
                            value={u}
                            placeholder="Underpunkt – ett delmoment, ett val eller ”Om …”"
                            onChange={(e) =>
                              ändraMoment(i, { ...m, under: m.under.map((x, k) => (k === j ? enRad(e.target.value) : x)) })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                nyUnderpunkt(i, j);
                              }
                            }}
                          />
                          <span className="ark-rutin-radknappar">
                            <button
                              title="Ta bort underpunkten"
                              aria-label={`Ta bort underpunkt ${j + 1} till moment ${i + 1}`}
                              onClick={() => ändraMoment(i, { ...m, under: m.under.filter((_, k) => k !== j) })}
                            >
                              ×
                            </button>
                          </span>
                        </div>
                      ))}
                      <button className="ark-linkbtn" onClick={() => nyUnderpunkt(i, m.under.length - 1)}>
                        + underpunkt
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <button className="ark-btn ark-rutin-nytt" onClick={() => nyttMoment(bygge.length - 1)}>
                + Lägg till moment
              </button>
              <p className="ark-hint">
                Enter ger en ny rad. Skriv <code>-&gt;</code> mellan klicken för en klickväg. Flera korta
                underpunkter visas som val, och en som börjar med ”Om”, ”Obs” eller ”Tips” som en upplysning.
                Symbolen väljs av momentets första ord.
              </p>
            </>
          ) : (
            <>
              <textarea
                className="ark-textarea ark-ap-rutin-text"
                aria-label="Rutinens text"
                autoFocus
                value={utkast}
                placeholder={"Klistra in eller skriv rutinen – en rad per moment.\n  En indragen rad blir en underpunkt."}
                onChange={(e) => setUtkast(e.target.value)}
              />
              <p className="ark-hint">
                En rad per moment. Dra in en rad (eller börja den med ”-”) för att göra den till en
                underpunkt. Numreringen sätts automatiskt.
              </p>
            </>
          )}
          <div className="ark-ap-rutin-knappar">
            <button
              className="ark-btn ark-btn--primary"
              onClick={() => {
                const ny = utkastText();
                onSpara(ny.trim() ? ny : undefined);
                // En tömd rutin finns inte längre – då finns inget att visa.
                if (ny.trim()) setSkriver(false);
                else onClose();
              }}
            >
              {text ? "Spara rutinen" : "Skapa rutinen"}
            </button>
            <button
              className="ark-btn"
              onClick={() => {
                avbryt.current?.abort();
                if (!text) return onClose();
                setUtkast(text);
                setBygge(börjaBygge(text));
                setSkriver(false);
              }}
            >
              Avbryt
            </button>
          </div>
        </>
      ) : (
        <>
          {moment.length === 0 ? (
            <p className="ark-hint">Kravet har ingen rutin.</p>
          ) : (
            <>
              <div className="ark-rutin-framsteg">
                <div
                  className="ark-rutin-matare"
                  role="progressbar"
                  aria-label="Avklarade moment"
                  aria-valuemin={0}
                  aria-valuemax={moment.length}
                  aria-valuenow={klara.size}
                >
                  <span style={{ width: `${(klara.size / moment.length) * 100}%` }} />
                </div>
                <span className="ark-rutin-rakning">
                  {klara.size === moment.length ? "Klart!" : `${klara.size} av ${moment.length} klara`}
                </span>
                {klara.size > 0 && (
                  <button className="ark-linkbtn" onClick={() => setKlara(new Set())}>
                    Börja om
                  </button>
                )}
              </div>
              <ol className="ark-ap-rutin-lista">
                {moment.map((m, i) => {
                  const klar = klara.has(i);
                  const sort = rutinSort(m.text);
                  return (
                    <li
                      key={i}
                      className={`ark-rutin-moment ${klar ? "klar" : ""} ${i === aktuellt ? "aktuell" : ""}`}
                    >
                      <button
                        className="ark-rutin-bock"
                        aria-pressed={klar}
                        aria-label={`Moment ${i + 1}: ${klar ? "klart" : "inte klart"}`}
                        title={klar ? "Ångra – inte klart" : "Bocka av momentet"}
                        onClick={() => växla(i)}
                      >
                        {klar ? "✓" : i + 1}
                      </button>
                      <div className="ark-rutin-kropp">
                        <div className="ark-rutin-rad">
                          <RutinIkon sort={sort} />
                          <Stig text={m.text} />
                        </div>
                        {m.under.length > 0 && (
                          <ul className={underpunktSort(m.under) === "val" ? "val" : "steg"}>
                            {m.under.map((u, j) => (
                              // En upplysning är en mening att läsa, inte en
                              // klickväg – den står som text, med pilen kvar.
                              <li key={j} className={ärUpplysning(u) ? "upplysning" : undefined}>
                                {ärUpplysning(u) ? u : <Stig text={u} />}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          {redigerbar && (
            <div className="ark-ap-rutin-knappar">
              <button
                className="ark-btn"
                onClick={() => {
                  setUtkast(text ?? "");
                  setBygge(börjaBygge(text));
                  setSkriver(true);
                }}
              >
                Redigera
              </button>
              <button
                className="ark-linkbtn"
                onClick={() => {
                  onSpara(undefined);
                  onClose();
                }}
              >
                Ta bort rutinen
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** En inklistrad radbrytning i ett fält får inte bli ett extra moment i lagringen. */
const enRad = (text: string) => text.replace(/\s*\r?\n\s*/g, " ");

/** Byggarens utgångsläge: rutinens moment, eller en tom rad att börja skriva i. */
function börjaBygge(text: string | undefined): RutinMoment[] {
  const moment = tolkaRutin(text ?? "");
  return moment.length > 0 ? moment : [{ ...TOMT }];
}

/** En rad: löpande text, eller – med pilar i – en klickväg av brickor. */
function Stig({ text }: { text: string }) {
  const delar = rutinStig(text);
  if (delar.length < 2) return <span className="ark-rutin-text">{text}</span>;
  return (
    <span className="ark-rutin-stig" aria-label={delar.join(", sedan ")}>
      {delar.map((d, i) => (
        <span key={i} className="ark-rutin-bricka">
          {d}
        </span>
      ))}
    </span>
  );
}

const IKONER: Record<RutinSort, { titel: string; d: string }> = {
  navigera: { titel: "Gå till", d: "M2.5 8h10M8.5 4l4 4-4 4" },
  klicka: { titel: "Klicka", d: "M4 2.5l8.5 5.5-3.6.9 2 4-1.5.8-2-4.1L4 12.5z" },
  skriv: { titel: "Skriv in", d: "M3 13l.9-3.4 7-7 2.5 2.5-7 7zM9.6 3.9l2.5 2.5" },
  "logga-in": { titel: "Logga in", d: "M7.4 8.6a3 3 0 1 1-1.2-1.2L12.5 2M10.5 4l2 2" },
  öppna: { titel: "Öppna", d: "M2.5 3.5h11v9h-11zM2.5 6.5h11" },
  "ladda-ner": { titel: "Ladda ner", d: "M8 2.5v7.5M4.5 7L8 10.5 11.5 7M3 13.5h10" },
  steg: { titel: "Moment", d: "M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" },
};

function RutinIkon({ sort }: { sort: RutinSort }) {
  const { titel, d } = IKONER[sort];
  return (
    <span className={`ark-rutin-ikon ${sort}`} title={titel}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
