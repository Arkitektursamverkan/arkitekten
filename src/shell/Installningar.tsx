/**
 * Installationens inställningar – för administratören.
 *
 * INFORMATIONSKLASSNINGEN (core/klassning.ts): om den används, vilken modell
 * som gäller och var nivån visas. Och SYMBOLSTILEN, hur affärsprocessernas symboler ser ut
 * (src/tools/affarsprocess/symbolstil.ts). Stilarna kommer ur installationens
 * innehållspaket; standardstilen finns alltid. Valet gäller alla användare och
 * portalens bilder, och sidan laddas om så att varje rityta ritas med den nya
 * stilen. Servern prövar behörigheten (server/brygga.ts) – knappen visas bara
 * för att en administratör ska hitta dit.
 */

import { useEffect, useState } from "react";
import type { Inloggningsläge } from "@/core/behorighet";
import { KontoAdmin } from "./LokalaKonton";
import {
  EGEN_MODELL,
  INBYGGDA_MODELLER,
  STANDARDINSTÄLLNING,
  läsKlassningsinställning,
  modellTillText,
  textTillNivåer,
  type Klassningsinställning,
  type Klassningsnivå,
  type Skyddsklass,
} from "@/core/klassning";

interface StilRad {
  id: string;
  namn: string;
  beskrivning?: string;
}

interface Props {
  läge: Inloggningsläge;
  /** Den inloggades id – det egna kontot kan inte tas bort eller förlora sin roll. */
  egetId: string;
}

export function InstallningarKnapp(p: Props) {
  const [öppen, setÖppen] = useState(false);
  return (
    <>
      <button className="ark-linkbtn ark-konto-installningar" onClick={() => setÖppen(true)}>
        Inställningar
      </button>
      {öppen && <InstallningarDialog {...p} onStäng={() => setÖppen(false)} />}
    </>
  );
}

export function InstallningarDialog({ läge, egetId, onStäng }: Props & { onStäng: () => void }) {
  const [stilar, setStilar] = useState<StilRad[] | null>(null);
  const [vald, setVald] = useState<string>("");
  const [fel, setFel] = useState<string[]>([]);
  const [sparar, setSparar] = useState(false);
  const [klassning, setKlassning] = useState<Klassningsinställning | null>(null);
  /** Den egna modellen som text – en nivå per rad, indragen rad = undernivå. */
  const [egenText, setEgenText] = useState("");
  const [egetNamn, setEgetNamn] = useState("");

  useEffect(() => {
    void fetch("/__ark/klassning")
      .then((r) => r.json())
      .then((b) => {
        const inst = läsKlassningsinställning(b?.ok ? b.klassning : null);
        setKlassning(inst);
        setEgenText(modellTillText(inst.modell));
        setEgetNamn(inst.modell.id === EGEN_MODELL ? inst.modell.namn : "");
      })
      .catch(() => setKlassning(STANDARDINSTÄLLNING));
  }, []);

  useEffect(() => {
    let levande = true;
    void (async () => {
      try {
        const res = await fetch("/__ark/symbolstilar");
        const b = await res.json();
        if (!levande) return;
        if (!b.ok) throw new Error(b.error ?? "Stilarna gick inte att läsa.");
        setStilar(b.stilar);
        setVald(b.vald);
        setFel(b.fel ?? []);
      } catch (e) {
        if (levande) setFel([e instanceof Error ? e.message : String(e)]);
      }
    })();
    return () => {
      levande = false;
    };
  }, []);

  async function spara() {
    setSparar(true);
    try {
      if (klassning) {
        const modell =
          klassning.modell.id === EGEN_MODELL
            ? { id: EGEN_MODELL, namn: egetNamn.trim() || "Egen modell", nivåer: textTillNivåer(egenText) }
            : klassning.modell;
        if (klassning.på && !modell.nivåer.length) throw new Error("Den egna modellen behöver minst en nivå.");
        const svar = await fetch("/__ark/klassning", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...klassning, modell }),
        });
        const kb = await svar.json();
        if (!kb.ok) throw new Error(kb.error ?? "Klassningen gick inte att spara.");
      }
      const res = await fetch("/__ark/symbolstil", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: vald }),
      });
      const b = await res.json();
      if (!b.ok) throw new Error(b.error ?? "Valet gick inte att spara.");
      location.reload();
    } catch (e) {
      setFel([e instanceof Error ? e.message : String(e)]);
      setSparar(false);
    }
  }

  return (
    <div className="ark-flyttalager" onClick={onStäng}>
      <div className="ark-flyttadialog" role="dialog" aria-label="Inställningar" onClick={(e) => e.stopPropagation()}>
        <h2 className="ark-flytta-rubrik">Inställningar</h2>
        {klassning && (
          <KlassningsInställningar
            inst={klassning}
            onÄndra={setKlassning}
            egenText={egenText}
            onEgenText={setEgenText}
            egetNamn={egetNamn}
            onEgetNamn={setEgetNamn}
          />
        )}
        <h3 className="ark-installning-rubrik">Symbolstil för affärsprocesser</h3>
        <p className="ark-hint">
          Hur symbolerna ser ut i verktyget, i exporterna och i portalens bilder. Gäller alla användare.
        </p>
        {!stilar && !fel.length && <p className="ark-hint">Läser stilarna …</p>}
        {stilar?.map((s) => (
          <label key={s.id} className="ark-installning-val">
            <input type="radio" name="symbolstil" value={s.id} checked={vald === s.id} onChange={() => setVald(s.id)} />
            <span>
              <strong>{s.namn}</strong>
              {s.beskrivning && <span className="ark-hint"> – {s.beskrivning}</span>}
            </span>
          </label>
        ))}
        <Exempelinnehall />
        {läge === "lokal" && <KontoAdmin egetId={egetId} />}
        {fel.map((f) => (
          <p key={f} className="ark-error">
            {f}
          </p>
        ))}
        <div className="ark-flytta-fot">
          <button className="ark-btn ark-btn--primary" disabled={!stilar || sparar} onClick={() => void spara()}>
            Spara
          </button>
          <button className="ark-linkbtn" onClick={onStäng}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}

/** Informationsklassningen: på/av, modell och var nivån visas. */
function KlassningsInställningar(p: {
  inst: Klassningsinställning;
  onÄndra: (i: Klassningsinställning) => void;
  egenText: string;
  onEgenText: (t: string) => void;
  egetNamn: string;
  onEgetNamn: (t: string) => void;
}) {
  const { inst, onÄndra } = p;
  const egen = inst.modell.id === EGEN_MODELL;
  return (
    <div>
      <h3 className="ark-installning-rubrik">Informationsklassning</h3>
      <p className="ark-hint">
        Varje process och systemskiss kan få en klassningsnivå. Den som får ändra processen eller skissen väljer nivån.
      </p>
      <label className="ark-installning-val">
        <input type="checkbox" checked={inst.på} onChange={(e) => onÄndra({ ...inst, på: e.target.checked })} />
        <span>
          <strong>Använd informationsklassning</strong>
        </span>
      </label>
      {inst.på && (
        <>
          <label className="ark-skiss-falt">
            Klassningsmodell
            <select
              className="ark-input"
              value={inst.modell.id}
              onChange={(e) => {
                const inbyggd = INBYGGDA_MODELLER.find((m) => m.id === e.target.value);
                onÄndra({
                  ...inst,
                  modell: inbyggd ?? { id: EGEN_MODELL, namn: p.egetNamn || "Egen modell", nivåer: textTillNivåer(p.egenText) },
                });
              }}
            >
              {INBYGGDA_MODELLER.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.namn}
                </option>
              ))}
              <option value={EGEN_MODELL}>Egen modell …</option>
            </select>
          </label>
          {egen ? (
            <>
              <label className="ark-skiss-falt">
                Modellens namn
                <input className="ark-input" value={p.egetNamn} placeholder="T.ex. Vår klassningsmodell" onChange={(e) => p.onEgetNamn(e.target.value)} />
              </label>
              <label className="ark-skiss-falt">
                Nivåerna – en per rad, indragen rad = undernivå
                <textarea className="ark-textarea" rows={8} value={p.egenText} onChange={(e) => p.onEgenText(e.target.value)} />
              </label>
            </>
          ) : (
            <ul className="ark-hint">
              {inst.modell.nivåer.map((n) => (
                <li key={n.id}>{n.namn}</li>
              ))}
            </ul>
          )}
          <label className="ark-installning-val">
            <input type="checkbox" checked={inst.visaIExport} onChange={(e) => onÄndra({ ...inst, visaIExport: e.target.checked })} />
            <span>Visa klassningen i exporterade bilder</span>
          </label>
          <label className="ark-installning-val">
            <input type="checkbox" checked={inst.visaIVyn} onChange={(e) => onÄndra({ ...inst, visaIVyn: e.target.checked })} />
            <span>Visa klassningen på varje process och systemskiss</span>
          </label>
          <Skyddsklasser
            inst={inst}
            nivåer={egen ? textTillNivåer(p.egenText) : inst.modell.nivåer}
            onÄndra={(skyddsklasser) => onÄndra({ ...inst, skyddsklasser })}
          />
        </>
      )}
    </div>
  );
}

/**
 * Skyddsklasserna: vilka nivåer som kräver en klass, och vem som har den här
 * i Arkitekten. I EA-portalen delas samma klass ut som en behörighet i en roll.
 */
function Skyddsklasser(p: {
  inst: Klassningsinställning;
  nivåer: Klassningsnivå[];
  onÄndra: (k: Skyddsklass[]) => void;
}) {
  const klasser = p.inst.skyddsklasser;
  const ändra = (i: number, k: Partial<Skyddsklass>) => p.onÄndra(klasser.map((x, j) => (j === i ? { ...x, ...k } : x)));
  return (
    <div className="ark-skyddsklasser">
      <h4 className="ark-installning-underrubrik">Vem får se vad – skyddsklasser</h4>
      <p className="ark-hint">
        En nivå kan kräva en skyddsklass. Då ser bara de som har klassen (och administratörer) processer och skisser
        med den nivån – här i Arkitekten och i EA-portalen. Nivåer utan skyddsklass ser alla som ser processen. I
        EA-portalen delas klassen ut under Behörigheter, i en roll.
      </p>
      {klasser.map((k, i) => (
        <fieldset key={i} className="ark-skyddsklass">
          <label className="ark-skiss-falt">
            Skyddsklassens namn
            <input className="ark-input" value={k.namn} placeholder="T.ex. Känsliga personuppgifter" onChange={(e) => ändra(i, { namn: e.target.value })} />
          </label>
          <div className="ark-skiss-falt">
            Nivåerna som kräver den
            {p.nivåer.map((n) => {
              const annan = klasser.find((x, j) => j !== i && x.nivåer.includes(n.id));
              return (
                <label key={n.id} className="ark-installning-val ark-skyddsklass-niva">
                  <input
                    type="checkbox"
                    checked={k.nivåer.includes(n.id)}
                    disabled={Boolean(annan)}
                    onChange={(e) =>
                      ändra(i, { nivåer: e.target.checked ? [...k.nivåer, n.id] : k.nivåer.filter((x) => x !== n.id) })
                    }
                  />
                  <span>
                    {n.djup ? "– " : ""}
                    {n.namn}
                    {annan && <span className="ark-hint"> (kräver {annan.namn || "en annan klass"})</span>}
                  </span>
                </label>
              );
            })}
          </div>
          <label className="ark-skiss-falt">
            Vilka har klassen i Arkitekten – e-postadress eller Entra-kontots objekt-id, en per rad
            <textarea
              className="ark-textarea"
              rows={4}
              value={k.behöriga.join("\n")}
              onChange={(e) => ändra(i, { behöriga: e.target.value.split("\n") })}
            />
          </label>
          <button className="ark-linkbtn" onClick={() => p.onÄndra(klasser.filter((_, j) => j !== i))}>
            Ta bort skyddsklassen
          </button>
        </fieldset>
      ))}
      <button className="ark-linkbtn" onClick={() => p.onÄndra([...klasser, { id: "", namn: "", nivåer: [], behöriga: [] }])}>
        + Ny skyddsklass
      </button>
    </div>
  );
}

/** Exempelpaketen som följer med produkten – att lägga in i en ny installation. */
function Exempelinnehall() {
  const [paket, setPaket] = useState<Array<{ id: string; namn: string; beskrivning?: string }>>([]);
  const [besked, setBesked] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/__ark/innehallspaket")
      .then((r) => r.json())
      .then((b) => b.ok && setPaket(b.paket))
      .catch(() => {});
  }, []);
  if (!paket.length) return null;

  async function läggIn(id: string) {
    setBesked(null);
    try {
      const b = await (await fetch(`/__ark/innehallspaket/${id}/import`, { method: "POST", headers: { "content-type": "application/json" } })).json();
      if (!b.ok) throw new Error(b.error);
      const r = b.rapport;
      setBesked(
        `${r.inlagda.length} nya processer och visualiseringar lagda.` +
          (r.befintliga.length ? ` ${r.befintliga.length} fanns redan och rördes inte.` : "") +
          (r.fel.length ? ` ${r.fel.length} gick inte att läsa.` : ""),
      );
    } catch (e) {
      setBesked(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <h3 className="ark-installning-rubrik">Exempelinnehåll</h3>
      <p className="ark-hint">Neutrala exempel att utgå från. Det som redan finns skrivs aldrig över.</p>
      {paket.map((p) => (
        <div key={p.id} className="ark-installning-val">
          <span>
            <strong>{p.namn}</strong>
            {p.beskrivning && <span className="ark-hint"> – {p.beskrivning}</span>}
          </span>
          <button className="ark-linkbtn" onClick={() => void läggIn(p.id)}>
            Lägg in
          </button>
        </div>
      ))}
      {besked && <p className="ark-hint">{besked}</p>}
    </div>
  );
}
