/**
 * Mallen: ett formulär som blir ett flöde.
 *
 * Första versionen var en tabell med rullgardiner och ingen vägledning – man
 * såg fälten men inte vad man skulle göra. Den här är uppdelad i tre numrerade
 * steg med var sin rubrik och en mening som säger varför steget finns, och det
 * går att fylla i ett färdigt exempel för att se formen.
 *
 * Simbanorna hör till FLÖDET, inte till appen. De är olika varje gång, så de
 * skrivs här – de vanligaste finns som förslag att klicka in.
 *
 * All logik ligger i core/template.ts. Den här filen är bara formuläret.
 */

import { useMemo, useState } from "react";
import {
  allaRader,
  banförslag,
  döpOmBana,
  granskaMall,
  MALL_TYPER,
  nyGren,
  nyRad,
  taBortBana,
  tomMall,
  type Mall,
  type MallRad,
} from "@/core/template";
import type { NodeType } from "@/core/model";

interface Props {
  onClose: () => void;
  /** Kör mallen – bygger flödet och stänger panelen. */
  onApply: (mall: Mall) => void;
  /**
   * Processens namn, om den redan har ett. Den som kommer från "Ny process"
   * har just skrivit in det – då ställs frågan "Vad heter flödet?" inte alls,
   * och de övriga stegen numreras om från 1.
   */
  namn?: string;
  /**
   * Mallen att FORTSÄTTA på – flödet som det ser ut nu (`draftTillMall`).
   * Saknas = en tom mall.
   */
  mall?: Mall;
}

/**
 * Skapas en gång och lagras (radens id blir stegets). Inte en räknare: mallen
 * går att fortsätta på i en senare session, och då hade en räknare som börjar
 * om på 1 delat ut id:n som redan står i flödet.
 */
const nyttId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Ett litet färdigt flöde, för att visa formen. */
function exempelMall(): Mall {
  const banor = ["Kund", "Kundtjänst", "Ärendesystem"];
  return {
    titel: "Reklamation",
    underrubrik: "Från anmälan till beslut",
    banor,
    rader: [
      { ...nyRad(nyttId(), "start", banor[0]), text: "Kund hör av sig om en vara" },
      { ...nyRad(nyttId(), "activity", banor[1]), text: "Ärende registreras" },
      {
        ...nyRad(nyttId(), "decision", banor[1]),
        text: "Inom garantitiden?",
        grenar: [
          {
            id: nyttId(),
            etikett: "Ja",
            rader: [{ ...nyRad(nyttId(), "system", banor[2]), text: "Ersättning beslutas" }],
          },
          {
            id: nyttId(),
            etikett: "Nej",
            rader: [{ ...nyRad(nyttId(), "activity", banor[1]), text: "Kunden får avslag" }],
          },
        ],
      },
      {
        ...nyRad(nyttId(), "notification", banor[2]),
        text: "Besked skickas",
        mottagare: "kunden",
      },
      { ...nyRad(nyttId(), "end", banor[1]), text: "Ärendet avslutas" },
    ],
  };
}

export function TemplatePanel({ onClose, onApply, namn = "", mall: början }: Props) {
  const givetNamn = namn.trim();
  const [mall, setMall] = useState<Mall>(() => ({ ...(början ?? tomMall()), titel: givetNamn || (början?.titel ?? "") }));
  /** Stegens nummer: utan namnfrågan börjar "Vilka är med?" på 1. */
  const nr = (n: number) => (givetNamn ? n - 1 : n);
  const problem = useMemo(() => granskaMall(mall), [mall]);
  const problemFör = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of problem) {
      if (!p.radId) continue;
      m.set(p.radId, [...(m.get(p.radId) ?? []), p.text]);
    }
    return m;
  }, [problem]);

  /** Ersätter en rad var den än ligger – på toppnivå eller i en gren. */
  const ändraRad = (id: string, ändring: Partial<MallRad>) => {
    const gå = (rader: MallRad[]): MallRad[] =>
      rader.map((r) =>
        r.id === id
          ? följdval(r, ändring)
          : r.grenar
            ? { ...r, grenar: r.grenar.map((g) => ({ ...g, rader: gå(g.rader) })) }
            : r,
      );
    setMall((m) => ({ ...m, rader: gå(m.rader) }));
  };

  /**
   * Håller följdvalen i takt när typen byts: ett beslut får sina två grenar
   * direkt, och en rad som slutar vara beslut tappar dem.
   */
  const följdval = (r: MallRad, ändring: Partial<MallRad>): MallRad => {
    const nästa = { ...r, ...ändring };
    if (ändring.typ === "decision" && !nästa.grenar?.length) {
      nästa.grenar = [nyGren(nyttId(), "Ja"), nyGren(nyttId(), "Nej")];
    }
    if (ändring.typ && ändring.typ !== "decision") delete nästa.grenar;
    if (ändring.typ && ändring.typ !== "notification") delete nästa.mottagare;
    return nästa;
  };

  const taBortRad = (id: string) => {
    const gå = (rader: MallRad[]): MallRad[] =>
      rader
        .filter((r) => r.id !== id)
        .map((r) => (r.grenar ? { ...r, grenar: r.grenar.map((g) => ({ ...g, rader: gå(g.rader) })) } : r));
    setMall((m) => ({ ...m, rader: gå(m.rader) }));
  };

  const läggTill = (typ: NodeType) =>
    setMall((m) => ({
      ...m,
      rader: [...m.rader, följdval(nyRad(nyttId(), typ, m.banor[0] ?? ""), { typ })],
    }));

  const läggTillIGren = (radId: string, grenId: string) =>
    setMall((m) => ({
      ...m,
      rader: m.rader.map((r) =>
        r.id !== radId
          ? r
          : {
              ...r,
              grenar: r.grenar?.map((g) =>
                g.id !== grenId ? g : { ...g, rader: [...g.rader, nyRad(nyttId(), "activity", m.banor[0] ?? "")] },
              ),
            },
      ),
    }));

  const radFält = (r: MallRad, indrag = false) => {
    const fel = problemFör.get(r.id);
    const typInfo = MALL_TYPER.find((t) => t.typ === r.typ);
    return (
      <div key={r.id} className={`ark-mall-rad${indrag ? " gren" : ""}`}>
        <input
          className="ark-draft-text"
          placeholder="Vad händer här?"
          value={r.text}
          onChange={(e) => ändraRad(r.id, { text: e.target.value })}
        />
        <select value={r.bana} onChange={(e) => ändraRad(r.id, { bana: e.target.value })}>
          {!mall.banor.includes(r.bana) && <option value={r.bana}>– välj simbana –</option>}
          {mall.banor.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select
          value={r.typ}
          onChange={(e) => ändraRad(r.id, { typ: e.target.value as NodeType })}
          title={typInfo?.hjälp}
        >
          {MALL_TYPER.map((t) => (
            <option key={t.typ} value={t.typ} title={t.hjälp}>
              {t.namn}
            </option>
          ))}
        </select>
        {r.typ === "notification" && (
          <input
            className="ark-draft-text"
            placeholder="Till vem? T.ex. handläggaren"
            value={r.mottagare ?? ""}
            onChange={(e) => ändraRad(r.id, { mottagare: e.target.value })}
          />
        )}
        <button className="ark-iconbtn" title="Ta bort raden" onClick={() => taBortRad(r.id)}>
          ✕
        </button>
        {fel && <div className="ark-mall-fel">{fel.join(" ")}</div>}
        {typInfo && <div className="ark-mall-hjalp">{typInfo.hjälp}</div>}
      </div>
    );
  };

  const oanvändaFörslag = banförslag().filter((b) => !mall.banor.includes(b));

  return (
    <div className="ark-draft ark-mall">
      <div className="ark-draft-head">
        <strong>Mall</strong>
        <span className="ark-draft-origin">du väljer – inget gissas</span>
        <span className={`ark-pill ${problem.length ? "warn" : "ok"}`}>
          {problem.length ? `${problem.length} kvar att fylla i` : `${allaRader(mall).length} steg – klar`}
        </span>
        <button className="ark-x" onClick={onClose} title="Stäng">
          ✕
        </button>
      </div>

      <p className="ark-draft-hint">
        Beskrivningsrutan låter regelmotorn gissa vilken simbana och vilken typ varje steg får.
        Här väljer du själv, och det du väljer är det som ritas.{" "}
        <button className="ark-linkbtn" onClick={() => setMall({ ...exempelMall(), ...(givetNamn ? { titel: givetNamn, underrubrik: "" } : {}) })}>
          Visa ett ifyllt exempel
        </button>
      </p>

      <div className="ark-draft-rows">
        {!givetNamn && (
          <div className="ark-mall-steg">
            <div className="ark-mall-rubrik">
              <span className="ark-mall-nr">1</span> Vad heter flödet?
            </div>
            <input
              className="ark-draft-text"
              placeholder="T.ex. Reklamation"
              value={mall.titel}
              onChange={(e) => setMall((m) => ({ ...m, titel: e.target.value }))}
            />
            <input
              className="ark-draft-text"
              placeholder="Underrubrik, valfritt – t.ex. Från anmälan till beslut"
              value={mall.underrubrik}
              onChange={(e) => setMall((m) => ({ ...m, underrubrik: e.target.value }))}
            />
          </div>
        )}

        <div className="ark-mall-steg">
          <div className="ark-mall-rubrik">
            <span className="ark-mall-nr">{nr(2)}</span> Vilka är med?
          </div>
          <p className="ark-mall-forklaring">
            En rad per deltagare eller system – de blir simbanorna, uppifrån och ned. De är olika
            för varje flöde, så skriv dina egna.
          </p>
          {mall.banor.map((b, i) => (
            <div key={i} className="ark-mall-bana">
              <span className="ark-mall-nr liten">{i + 1}</span>
              <input
                className="ark-draft-text"
                placeholder="T.ex. Kundtjänst"
                value={b}
                onChange={(e) => setMall((m) => döpOmBana(m, b, e.target.value))}
              />
              <button
                className="ark-iconbtn"
                title={mall.banor.length > 1 ? "Ta bort simbanan" : "Minst en simbana måste finnas"}
                disabled={mall.banor.length < 2}
                onClick={() => setMall((m) => taBortBana(m, b))}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="ark-mall-knappar">
            <button
              className="ark-btn"
              onClick={() => setMall((m) => ({ ...m, banor: [...m.banor, ""] }))}
            >
              + Simbana
            </button>
          </div>
          {oanvändaFörslag.length > 0 && (
            <div className="ark-mall-forslag">
              <span>Vanliga:</span>
              {oanvändaFörslag.map((b) => (
                <button
                  key={b}
                  className="ark-chip"
                  onClick={() => setMall((m) => ({ ...m, banor: [...m.banor, b] }))}
                >
                  + {b}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ark-mall-steg">
          <div className="ark-mall-rubrik">
            <span className="ark-mall-nr">{nr(3)}</span> Vad händer, i tur och ordning?
          </div>
          <p className="ark-mall-forklaring">
            Ett steg per rad, i den ordning de sker. Välj vem som gör det och vilken sorts steg det
            är. Ett <strong>Beslut</strong> får två grenar att fylla i.
          </p>
          <div className="ark-mall-kolumner">
            <span>Vad händer</span>
            <span>Vem/vad</span>
            <span>Sorts steg</span>
          </div>

          {mall.rader.map((r) => (
            <div key={r.id}>
              {radFält(r)}
              {r.grenar?.map((g) => (
                <div key={g.id} className="ark-mall-gren">
                  <div className="ark-mall-gren-huvud">
                    <span>Om</span>
                    <input
                      className="ark-draft-text"
                      placeholder="Ja"
                      value={g.etikett}
                      onChange={(e) =>
                        setMall((m) => ({
                          ...m,
                          rader: m.rader.map((x) =>
                            x.id !== r.id
                              ? x
                              : {
                                  ...x,
                                  grenar: x.grenar?.map((y) =>
                                    y.id === g.id ? { ...y, etikett: e.target.value } : y,
                                  ),
                                },
                          ),
                        }))
                      }
                    />
                    <span>händer:</span>
                  </div>
                  {g.rader.map((gr) => radFält(gr, true))}
                  <button className="ark-linkbtn" onClick={() => läggTillIGren(r.id, g.id)}>
                    + steg i grenen
                  </button>
                </div>
              ))}
            </div>
          ))}

          <div className="ark-mall-knappar">
            <button className="ark-btn" onClick={() => läggTill("activity")}>
              + Steg
            </button>
            <button className="ark-btn" onClick={() => läggTill("decision")}>
              + Beslut
            </button>
            <button className="ark-btn" onClick={() => läggTill("datastore")}>
              + Datalager
            </button>
            <button className="ark-btn" onClick={() => läggTill("notification")}>
              + Notifiering
            </button>
            <button className="ark-btn" onClick={() => läggTill("end")}>
              + Slut
            </button>
          </div>
        </div>

        {problem.filter((p) => !p.radId).length > 0 && (
          <div className="ark-mall-steg">
            <div className="ark-mall-rubrik">Kvar att fylla i</div>
            <ul className="ark-mall-lista">
              {problem
                .filter((p) => !p.radId)
                .map((p) => (
                  <li key={p.text}>{p.text}</li>
                ))}
            </ul>
          </div>
        )}
      </div>

      <div className="ark-mall-fot">
        <button
          className="ark-btn ark-btn--primary"
          disabled={problem.length > 0}
          onClick={() => onApply(mall)}
          title={problem.length ? "Fyll i det som saknas först" : "Bygg flödet ur mallen"}
        >
          Skapa flödet
        </button>
        <button className="ark-linkbtn" onClick={onClose}>
          Avbryt
        </button>
      </div>
    </div>
  );
}
