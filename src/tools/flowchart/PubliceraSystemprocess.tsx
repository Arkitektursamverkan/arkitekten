/**
 * "Publicera i EA-portalen" för en SYSTEMPROCESS – knappen i flödesschemats
 * huvud och rutan bakom. Syskon till `tools/affarsprocess/Publicera.tsx`.
 *
 * En systemprocess beskriver hur ett system arbetar, så den hör hemma hos en
 * APPLIKATION i portalen, där den visas under fliken Systemprocesser. Rutan
 * svarar därför på:
 *   1. VILKEN applikation – en befintlig. Applikationerna förvaltas i portalen
 *      (ofta synkade från en registerkälla), så Arkitekten skapar inga.
 *   2. VILKEN version – samma val som för en affärsprocess (`VersionsVal`).
 *   3. VEM som äger flödet och VAD det gör – obligatoriskt.
 *
 * Sedan skrivs publiceringen på flödet (`sättPublicering` – ingen ny version,
 * invariant 11) och portalen ombeds hämta nu. Avpublicering tar bara bort
 * publiceringen; applikationen rörs aldrig.
 */

import { useEffect, useMemo, useState } from "react";
import {
  bridgeJson,
  getFlowStore,
  meddelaFlödenÄndrade,
  sättPublicering,
  taBortPublicering,
  type SavedFlow,
} from "@/core/flow-store";
import {
  saknasFörApplikation,
  sökApplikationer,
  type ApplikationsUtkast,
  type EaApplikation,
  type Publicering,
} from "@/core/publicering";
import {
  lästSignatur,
  PubliceraIkon,
  synka,
  useVersionsval,
  VersionsVal,
  type PubliceraKnappProps,
} from "@/tools/affarsprocess/Publicera";

export function PubliceraSystemprocessKnapp({ flöde, osparat, fastslå, onPublicerad }: PubliceraKnappProps) {
  const [öppen, setÖppen] = useState(false);
  if (!flöde) return null;
  const pub = flöde.publicering;
  return (
    <>
      <button
        className={`ark-btn ark-btn--ikon-text ${pub ? "ark-btn--publicerad" : ""}`}
        onClick={() => setÖppen(true)}
        title={
          pub
            ? `Publicerad i EA-portalen hos ”${pub.eaNodNamn}”. Klicka för att ändra.`
            : "Visa systemprocessen hos sin applikation i EA-portalen"
        }
      >
        <PubliceraIkon />
        {pub ? "Publicerad i EA" : "Publicera i EA-portalen"}
      </button>
      {öppen && (
        <SystemprocessDialog
          flöde={flöde}
          osparat={osparat}
          fastslå={fastslå}
          onAvbryt={() => setÖppen(false)}
          onPublicerad={onPublicerad}
        />
      )}
    </>
  );
}

type Steg = "fyller" | "arbetar" | "klar" | "avpublicera" | "avpublicerar" | "avpublicerad";

export function SystemprocessDialog({
  flöde,
  osparat,
  fastslå,
  onAvbryt,
  onPublicerad,
}: Omit<PubliceraKnappProps, "flöde"> & { flöde: SavedFlow; onAvbryt: () => void }) {
  const pub = flöde.publicering;
  const [appar, setAppar] = useState<EaApplikation[] | null>(null);
  const [webb, setWebb] = useState("");
  const [laddfel, setLaddfel] = useState<string | null>(null);
  const [sök, setSök] = useState("");
  const [utkast, setUtkast] = useState<ApplikationsUtkast>({
    nodId: pub?.eaNodId ?? null,
    ägare: pub?.ägare ?? "",
    beskrivning: pub?.beskrivning ?? "",
  });
  const [steg, setSteg] = useState<Steg>("fyller");
  const [fel, setFel] = useState<string | null>(null);
  const [visaFel, setVisaFel] = useState(false);
  const [resultat, setResultat] = useState<{ id: string; namn: string; synk: string } | null>(null);
  const version = useVersionsval(flöde, osparat);

  useEffect(() => {
    let levande = true;
    (async () => {
      try {
        const status = await bridgeJson("/__ark/ea/status");
        if (status.webb) setWebb(status.webb);
        if (!status.konfigurerad) throw new Error("EA-portalen är inte kopplad: EA_API_KEY saknas i serverns miljö.");
        const { applikationer } = await bridgeJson("/__ark/ea/applikationer");
        if (levande) setAppar(applikationer);
      } catch (e) {
        if (levande) setLaddfel(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      levande = false;
    };
  }, []);

  const rader = useMemo(() => sökApplikationer(appar ?? [], sök), [appar, sök]);
  const saknas = saknasFörApplikation(utkast);
  const vald = appar?.find((a) => a.id === utkast.nodId);
  const länk = (id: string) => `${webb}/systems?id=${encodeURIComponent(id)}&flik=systemprocesser`;

  const publicera = async () => {
    setVisaFel(true);
    if (saknas.length > 0 || !vald) return;
    setSteg("arbetar");
    setFel(null);
    try {
      // 1. Versionen – genom den vanliga sparningen, med dess bekräftelse.
      let aktuellt = flöde;
      if (version.skaFastslå) {
        const sparat = await fastslå();
        if (!sparat) {
          setSteg("fyller");
          return;
        }
        aktuellt = sparat;
      }

      // 2. Publiceringen på flödet – ingen ny version (invariant 11).
      const publicering: Publicering = {
        eaNodId: vald.id,
        eaNodNamn: vald.namn,
        ägare: utkast.ägare.trim(),
        beskrivning: utkast.beskrivning.trim(),
        publiceradAt: new Date().toISOString(),
        ...(lästSignatur() ? { publiceradAv: lästSignatur() } : {}),
      };
      const store = await getFlowStore();
      const efter = await sättPublicering(store, aktuellt.id, publicering);
      meddelaFlödenÄndrade();
      onPublicerad(efter);

      // 3. Portalen hämtar nu.
      const synk = await synka("Portalen har hämtat systemprocessen – den syns nu.");
      setResultat({ id: vald.id, namn: vald.namn, synk });
      setSteg("klar");
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
      setSteg("fyller");
    }
  };

  const avpublicera = async () => {
    if (!pub) return;
    setSteg("avpublicerar");
    setFel(null);
    try {
      const store = await getFlowStore();
      const efter = await taBortPublicering(store, flöde.id);
      meddelaFlödenÄndrade();
      onPublicerad(efter);
      const synk = await synka("Portalen har hämtat om – systemprocessen syns inte längre.");
      setResultat({ id: pub.eaNodId, namn: pub.eaNodNamn, synk });
      setSteg("avpublicerad");
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
      setSteg("avpublicera");
    }
  };

  const upptagen = steg === "arbetar" || steg === "avpublicerar";

  return (
    <div className="ark-flyttalager" onClick={upptagen ? undefined : onAvbryt}>
      <div
        className="ark-flyttadialog ark-publicera"
        role="dialog"
        aria-label={`Publicera ${flöde.name} i EA-portalen`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="ark-flytta-rubrik">Publicera i EA-portalen</h2>

        {(steg === "avpublicera" || steg === "avpublicerar") && pub ? (
          <>
            <p className="ark-flytta-nu">
              Avpublicera <strong>{flöde.name}</strong> från <strong>{pub.eaNodNamn}</strong>?
            </p>
            <p className="ark-hint">
              Systemprocessen försvinner ur applikationens flik i portalen. Flödet i Arkitekten och dess versioner
              rörs inte, och applikationen står kvar som den är.
            </p>
            {fel && <p className="ark-hint ark-hint--warn">{fel}</p>}
            <div className="ark-flytta-fot">
              <button
                className="ark-btn ark-btn--fara"
                disabled={steg === "avpublicerar"}
                onClick={() => void avpublicera()}
              >
                {steg === "avpublicerar" ? "Avpublicerar …" : "Avpublicera"}
              </button>
              <button className="ark-linkbtn" disabled={steg === "avpublicerar"} onClick={() => setSteg("fyller")}>
                Tillbaka
              </button>
            </div>
          </>
        ) : steg === "avpublicerad" && resultat ? (
          <>
            <p className="ark-flytta-nu">
              <strong>{flöde.name}</strong> är inte längre publicerad i EA-portalen.
            </p>
            <p className="ark-hint">{resultat.synk}</p>
            <div className="ark-flytta-fot">
              <button className="ark-btn ark-btn--primary" onClick={onAvbryt}>
                Stäng
              </button>
            </div>
          </>
        ) : steg === "klar" && resultat ? (
          <>
            <p className="ark-flytta-nu">
              <strong>{flöde.name}</strong> är publicerad hos <strong>{resultat.namn}</strong>.
            </p>
            <p className="ark-hint">{resultat.synk}</p>
            <div className="ark-flytta-fot">
              {webb && (
                <a className="ark-btn ark-btn--primary" href={länk(resultat.id)} target="_blank" rel="noreferrer">
                  Öppna i EA-portalen
                </a>
              )}
              <button className="ark-linkbtn" onClick={onAvbryt}>
                Stäng
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ark-hint">
              Systemprocessen visas under fliken Systemprocesser på vald applikation i portalen. Portalen visar
              alltid senaste <strong>fastslagna</strong> version.
            </p>

            {/* ---- 1. Vilken applikation ---- */}
            <div className="ark-section-title">Applikation</div>
            <input
              className="ark-input"
              placeholder="Sök applikation …"
              value={sök}
              onChange={(e) => setSök(e.target.value)}
              aria-label="Sök bland EA-portalens applikationer"
            />
            <div className="ark-ea-trad" role="listbox" aria-label="EA-portalens applikationer">
              {laddfel && <p className="ark-hint ark-hint--warn">{laddfel}</p>}
              {!laddfel && !appar && <p className="ark-hint">Hämtar portalens applikationer …</p>}
              {appar && rader.length === 0 && <p className="ark-hint">Ingen applikation matchar.</p>}
              {rader.map((a) => (
                <button
                  key={a.id}
                  role="option"
                  aria-selected={a.id === utkast.nodId}
                  className={`ark-ea-rad ${a.id === utkast.nodId ? "vald" : ""}`}
                  onClick={() => setUtkast((u) => ({ ...u, nodId: a.id }))}
                  title={a.status ?? undefined}
                >
                  {a.namn}
                  {a.status?.toLowerCase() === "avvecklat" && <span className="ark-ea-markor">avvecklad</span>}
                  {pub?.eaNodId === a.id && <span className="ark-ea-markor">publicerad här</span>}
                </button>
              ))}
            </div>
            {vald && (
              <p className="ark-flytta-nu">
                Vald: <strong>{vald.namn}</strong>
              </p>
            )}

            {/* ---- 2. Vilken version ---- */}
            <div className="ark-section-title">Version</div>
            <VersionsVal {...version} />

            {/* ---- 3. Uppgifter ---- */}
            <div className="ark-section-title">Uppgifter</div>
            <label className="ark-field-label" htmlFor="ark-sys-agare">
              Ägare *
            </label>
            <input
              id="ark-sys-agare"
              className="ark-input"
              value={utkast.ägare}
              placeholder="Systemförvaltare, roll eller namn"
              onChange={(e) => setUtkast((u) => ({ ...u, ägare: e.target.value }))}
            />
            <label className="ark-field-label" htmlFor="ark-sys-beskrivning">
              Beskrivning *
            </label>
            <textarea
              id="ark-sys-beskrivning"
              className="ark-input ark-publicera-text"
              value={utkast.beskrivning}
              placeholder="Vad systemprocessen gör och när den körs"
              onChange={(e) => setUtkast((u) => ({ ...u, beskrivning: e.target.value }))}
            />

            {visaFel && saknas.length > 0 && (
              <ul className="ark-hint ark-hint--warn ark-publicera-saknas">
                {saknas.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
            {fel && <p className="ark-hint ark-hint--warn">{fel}</p>}

            <div className="ark-flytta-fot">
              <button
                className="ark-btn ark-btn--primary"
                disabled={steg === "arbetar" || !appar}
                onClick={() => void publicera()}
              >
                {steg === "arbetar" ? "Publicerar …" : pub ? "Publicera igen" : "Publicera"}
              </button>
              <button className="ark-linkbtn" onClick={onAvbryt} disabled={steg === "arbetar"}>
                Avbryt
              </button>
              {pub && (
                <button
                  className="ark-linkbtn danger ark-publicera-av"
                  onClick={() => setSteg("avpublicera")}
                  disabled={steg === "arbetar"}
                  title="Ta bort systemprocessen ur EA-portalen"
                >
                  Avpublicera …
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
