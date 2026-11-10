/**
 * Installationens inställningar – för administratören.
 *
 * Just nu en sak: SYMBOLSTILEN, hur affärsprocessernas symboler ser ut
 * (src/tools/affarsprocess/symbolstil.ts). Stilarna kommer ur installationens
 * innehållspaket; standardstilen finns alltid. Valet gäller alla användare och
 * portalens bilder, och sidan laddas om så att varje rityta ritas med den nya
 * stilen. Servern prövar behörigheten (server/brygga.ts) – knappen visas bara
 * för att en administratör ska hitta dit.
 */

import { useEffect, useState } from "react";
import type { Inloggningsläge } from "@/core/behorighet";
import { KontoAdmin } from "./LokalaKonton";

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
