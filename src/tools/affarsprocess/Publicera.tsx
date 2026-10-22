/**
 * "Publicera i EA-portalen" – knappen i affärsprocessens huvud och rutan bakom.
 *
 * Rutan svarar på tre frågor, i den ordning man ställer dem:
 *   1. VAR i portalens processkarta – en befintlig process (oftast den som
 *      redan finns i den synkade processkartan), eller en ny under en vald
 *      förälder när processen inte finns där.
 *   2. VILKEN version – portalen visar alltid senaste fastslagna. Är det man
 *      ser inte fastslaget kan rutan fastslå det i samma steg, genom SAMMA
 *      sparning som Spara-knappen (med samma bekräftelse).
 *   3. VEM som äger processen och VAD den gör – obligatoriskt.
 *
 * Sedan: noden skapas (om ny), publiceringen skrivs på flödet
 * (`sättPublicering` – ingen ny version) och portalen ombeds hämta nu i
 * stället för att vänta på plattformens schema. Själva bilden går som förut
 * genom flödestjänsten och integrationsplattformen.
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
  delaNamn,
  saknasFörPublicering,
  type EaProcess,
  type Publicering,
  type PubliceringsUtkast,
} from "@/core/publicering";
import { nuvarandeStatus, senasteFastslagna } from "@/core/status";
import { SIGNATUR_NYCKEL } from "@/tools/flowchart/FlowLibrary";
import { byggTräd, förvaldProcess, nästaPrefix, vägTill } from "./ea-trad";

export interface PubliceraKnappProps {
  /** Det sparade flödet, eller null innan processen sparats. */
  flöde: SavedFlow | null;
  /** Finns osparade ändringar i editorn? */
  osparat: boolean;
  /** Sparar det man ser som FASTSLAGEN version. null = avbröts eller misslyckades. */
  fastslå: () => Promise<SavedFlow | null>;
  /** Flödet efter publiceringen – verktyget håller sitt eget exemplar. */
  onPublicerad: (flöde: SavedFlow) => void;
}

export function PubliceraKnapp({ flöde, osparat, fastslå, onPublicerad }: PubliceraKnappProps) {
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
            ? `Publicerad i EA-portalen under ”${pub.eaNodNamn}”. Klicka för att ändra.`
            : "Visa processen i EA-portalens processkarta"
        }
      >
        <PubliceraIkon />
        {pub ? "Publicerad i EA" : "Publicera i EA-portalen"}
      </button>
      {öppen && (
        <Publiceringsdialog
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

export function PubliceraIkon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

type Steg = "fyller" | "arbetar" | "klar" | "avpublicera" | "avpublicerar" | "avpublicerad";

/**
 * Portalen hämtar NU i stället för vid plattformens schema. Misslyckas det är
 * ändringen ändå gjord på flödet – schemat tar den inom två timmar.
 */
export async function synka(lyckades: string): Promise<string> {
  try {
    const r = await bridgeJson("/__ark/ea/synka", { method: "POST" });
    return r.failed?.length > 0
      ? "Portalens hämtning misslyckades – ändringen kommer med vid nästa schemalagda hämtning (inom två timmar)."
      : lyckades;
  } catch (e) {
    return `Portalen kunde inte hämta direkt (${e instanceof Error ? e.message : String(e)}). Ändringen kommer med vid nästa schemalagda hämtning, inom två timmar.`;
  }
}

/**
 * Versionen. Portalen visar senaste FASTSLAGNA; är det man ser något annat får
 * man välja att fastslå det nu. Delas av båda publiceringsrutorna.
 */
export function useVersionsval(flöde: SavedFlow, osparat: boolean) {
  const fastslagen = senasteFastslagna(flöde.versions);
  const sesÄrFastslaget = !osparat && nuvarandeStatus(flöde.versions) === "fastslagen";
  const [fastslåNu, setFastslåNu] = useState(!sesÄrFastslaget);
  const måsteFastslå = !fastslagen;
  return {
    fastslagen,
    sesÄrFastslaget,
    måsteFastslå,
    fastslåNu,
    setFastslåNu,
    /** Ska publiceringen gå via den vanliga sparningen som fastslagen först? */
    skaFastslå: fastslåNu || måsteFastslå,
  };
}

export function VersionsVal({
  fastslagen,
  sesÄrFastslaget,
  måsteFastslå,
  fastslåNu,
  setFastslåNu,
}: ReturnType<typeof useVersionsval>) {
  if (sesÄrFastslaget)
    return (
      <p className="ark-flytta-nu">
        Version <strong>{fastslagen?.beteckning}</strong> (fastslagen) publiceras.
      </p>
    );
  if (måsteFastslå)
    return (
      <p className="ark-hint ark-hint--warn">
        Inget är fastslaget än. Det du ser fastslås och publiceras – du får bekräfta.
      </p>
    );
  return (
    <div className="ark-publicera-val">
      <label>
        <input type="radio" checked={fastslåNu} onChange={() => setFastslåNu(true)} /> Fastslå det jag ser och
        publicera det
      </label>
      <label>
        <input type="radio" checked={!fastslåNu} onChange={() => setFastslåNu(false)} /> Publicera fastslagen
        version {fastslagen!.beteckning}
      </label>
    </div>
  );
}

export function Publiceringsdialog({
  flöde,
  osparat,
  fastslå,
  onAvbryt,
  onPublicerad,
}: Omit<PubliceraKnappProps, "onPublicerad"> & {
  flöde: SavedFlow;
  onAvbryt: () => void;
  onPublicerad: (flöde: SavedFlow) => void;
}) {
  const pub = flöde.publicering;
  const [processer, setProcesser] = useState<EaProcess[] | null>(null);
  const [webb, setWebb] = useState("");
  const [laddfel, setLaddfel] = useState<string | null>(null);
  const [sök, setSök] = useState("");
  const [utkast, setUtkast] = useState<PubliceringsUtkast>({
    läge: "befintlig",
    nodId: pub?.eaNodId ?? null,
    nyttNamn: delaNamn(flöde.name).namn,
    nyttPrefix: "",
    ägare: pub?.ägare ?? "",
    beskrivning: pub?.beskrivning ?? "",
  });
  const [steg, setSteg] = useState<Steg>("fyller");
  const [fel, setFel] = useState<string | null>(null);
  const [visaFel, setVisaFel] = useState(false);
  const [resultat, setResultat] = useState<{ nod: EaProcess | { id: string; namn: string }; synk: string } | null>(null);

  const version = useVersionsval(flöde, osparat);

  useEffect(() => {
    let levande = true;
    (async () => {
      try {
        const status = await bridgeJson("/__ark/ea/status");
        if (status.webb) setWebb(status.webb);
        if (!status.konfigurerad) throw new Error("EA-portalen är inte kopplad: EA_API_KEY saknas i serverns miljö.");
        const { processer } = await bridgeJson("/__ark/ea/processer");
        if (!levande) return;
        setProcesser(processer);
        // Förval: den publicerade noden, annars samma nummer som namnet.
        setUtkast((u) => (u.nodId ? u : { ...u, nodId: förvaldProcess(processer, flöde.name, pub)?.id ?? null }));
      } catch (e) {
        if (levande) setLaddfel(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      levande = false;
    };
  }, [flöde.name, pub]);

  const rader = useMemo(() => byggTräd(processer ?? [], sök), [processer, sök]);
  const saknas = saknasFörPublicering(utkast);
  const vald = processer?.find((p) => p.id === utkast.nodId);

  const väljNod = (id: string) =>
    setUtkast((u) => ({
      ...u,
      nodId: id,
      // Byter man förälder följer förslaget på nummer med.
      nyttPrefix: u.läge === "ny" ? nästaPrefix(processer ?? [], id) : u.nyttPrefix,
    }));

  const byttLäge = (läge: PubliceringsUtkast["läge"]) =>
    setUtkast((u) => ({
      ...u,
      läge,
      nyttPrefix: läge === "ny" ? nästaPrefix(processer ?? [], u.nodId) : u.nyttPrefix,
    }));

  const publicera = async () => {
    setVisaFel(true);
    if (saknas.length > 0 || !processer) return;
    setSteg("arbetar");
    setFel(null);
    try {
      // 1. Versionen. Fastslås det man ser går det genom den vanliga sparningen
      //    – avbryter man bekräftelsen där avbryts publiceringen också.
      let aktuellt = flöde;
      if (version.skaFastslå) {
        const sparat = await fastslå();
        if (!sparat) {
          setSteg("fyller");
          return;
        }
        aktuellt = sparat;
      }

      // 2. Noden. En ny skapas; en som VI skapat tidigare får ny ägare och
      //    beskrivning. En synkad nod rörs aldrig – portalens synk skriver över den.
      let nod: { id: string; namn: string; prefix?: string; egen: boolean };
      if (utkast.läge === "ny") {
        const { process } = await bridgeJson("/__ark/ea/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            förälderId: utkast.nodId,
            namn: utkast.nyttNamn,
            prefix: utkast.nyttPrefix.trim() || undefined,
            ägare: utkast.ägare,
            beskrivning: utkast.beskrivning,
          }),
        });
        nod = { id: process.id, namn: process.namn, prefix: process.prefix, egen: true };
      } else {
        const p = vald!;
        const egen = Boolean(pub?.egenNod && pub.eaNodId === p.id);
        if (egen) {
          await bridgeJson("/__ark/ea/process", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ uppdatera: p.id, ägare: utkast.ägare, beskrivning: utkast.beskrivning }),
          });
        }
        nod = { id: p.id, namn: p.namn, prefix: p.prefix, egen };
      }

      // 3. Publiceringen på flödet – ingen ny version (invariant 11).
      const publicering: Publicering = {
        eaNodId: nod.id,
        eaNodNamn: nod.namn,
        ...(nod.prefix ? { eaPrefix: nod.prefix } : {}),
        ...(nod.egen ? { egenNod: true } : {}),
        ägare: utkast.ägare.trim(),
        beskrivning: utkast.beskrivning.trim(),
        publiceradAt: new Date().toISOString(),
        ...(lästSignatur() ? { publiceradAv: lästSignatur() } : {}),
      };
      const store = await getFlowStore();
      const efter = await sättPublicering(store, aktuellt.id, publicering);
      meddelaFlödenÄndrade();
      onPublicerad(efter);

      // 4. Portalen hämtar nu.
      const synk = await synka("Portalen har hämtat processen – den syns nu.");
      setResultat({ nod: { id: nod.id, namn: nod.namn }, synk });
      setSteg("klar");
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
      setSteg("fyller");
    }
  };

  /**
   * Avpublicering: publiceringen tas bort ur flödet (ingen ny version), och
   * plattformen gallrar flödesschemat ur portalen vid hämtningen. En process
   * som publiceringen själv SKAPADE kan arkiveras samtidigt – annars står den
   * kvar i trädet utan flödesschema. En synkad nod rörs aldrig.
   */
  const [arkivera, setArkivera] = useState(Boolean(pub?.egenNod));
  const avpublicera = async () => {
    if (!pub) return;
    setSteg("avpublicerar");
    setFel(null);
    try {
      const store = await getFlowStore();
      const efter = await taBortPublicering(store, flöde.id);
      meddelaFlödenÄndrade();
      onPublicerad(efter);
      let arkiveringsfel = "";
      if (pub.egenNod && arkivera) {
        try {
          await bridgeJson("/__ark/ea/arkivera", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: pub.eaNodId }),
          });
        } catch (e) {
          arkiveringsfel = ` Processen kunde inte arkiveras: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      const synk = await synka("Portalen har hämtat om – processbilden syns inte längre.");
      setResultat({ nod: { id: pub.eaNodId, namn: pub.eaNodNamn }, synk: synk + arkiveringsfel });
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
              Avpublicera <strong>{flöde.name}</strong> från{" "}
              <strong>{vägTill(processer ?? [], pub.eaNodId) || pub.eaNodNamn.replace(/\s+/g, " ")}</strong>?
            </p>
            <p className="ark-hint">
              Processbilden försvinner ur portalen. Processen i Arkitekten och dess versioner rörs inte, och du
              kan publicera den igen när som helst.
            </p>
            {pub.egenNod ? (
              <label className="ark-publicera-val">
                <span>
                  <input type="checkbox" checked={arkivera} onChange={(e) => setArkivera(e.target.checked)} />{" "}
                  Arkivera även processen i portalens träd
                </span>
                <span className="ark-hint">
                  Den skapades när flödet publicerades. Arkiveringen går att ta tillbaka i portalen.
                </span>
              </label>
            ) : (
              <p className="ark-hint">Processen i portalens träd kommer från den synkade processkartan och står kvar.</p>
            )}
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
              <strong>{flöde.name}</strong> är publicerad under{" "}
              <strong>{vägTill(processer ?? [], resultat.nod.id) || resultat.nod.namn}</strong>.
            </p>
            <p className="ark-hint">{resultat.synk}</p>
            <div className="ark-flytta-fot">
              <a
                className="ark-btn ark-btn--primary"
                href={`${webb}/processes?id=${encodeURIComponent(resultat.nod.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                Öppna i EA-portalen
              </a>
              <button className="ark-linkbtn" onClick={onAvbryt}>
                Stäng
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ark-hint">
              Processen visas under fliken Flödesschema på vald process i portalens processkarta.
              Portalen visar alltid senaste <strong>fastslagna</strong> version.
            </p>

            {/* ---- 1. Var ---- */}
            <div className="ark-section-title">Var i strukturen</div>
            <div className="ark-toggle">
              <button className={utkast.läge === "befintlig" ? "active" : ""} onClick={() => byttLäge("befintlig")}>
                Befintlig process
              </button>
              <button className={utkast.läge === "ny" ? "active" : ""} onClick={() => byttLäge("ny")}>
                Ny process under …
              </button>
            </div>
            <p className="ark-hint">
              {utkast.läge === "befintlig"
                ? "Välj processen i portalen som flödet visar – oftast samma nummer som i processkartan."
                : "Välj föräldern. Processen skapas i portalen, eftersom den inte finns i processkartan."}
            </p>
            <input
              className="ark-input"
              placeholder="Sök på namn eller nummer …"
              value={sök}
              onChange={(e) => setSök(e.target.value)}
              aria-label="Sök i EA-portalens processer"
            />
            <div className="ark-ea-trad" role="listbox" aria-label="EA-portalens processer">
              {laddfel && <p className="ark-hint ark-hint--warn">{laddfel}</p>}
              {!laddfel && !processer && <p className="ark-hint">Hämtar portalens processkarta …</p>}
              {processer && rader.length === 0 && <p className="ark-hint">Ingen process matchar.</p>}
              {rader.map(({ process: p, djup }) => (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={p.id === utkast.nodId}
                  className={`ark-ea-rad ${p.id === utkast.nodId ? "vald" : ""} ${p.struktur ? "struktur" : ""}`}
                  style={{ paddingLeft: 8 + djup * 14 }}
                  onClick={() => väljNod(p.id)}
                  title={p.källa !== "NONE" ? "Från den synkade processkartan" : "Skapad i portalen"}
                >
                  {p.namn.replace(/\s+/g, " ")}
                  {pub?.eaNodId === p.id && <span className="ark-ea-markor">publicerad här</span>}
                </button>
              ))}
            </div>
            {vald && (
              <p className="ark-flytta-nu">
                {utkast.läge === "ny" ? "Under: " : "Vald: "}
                <strong>{vägTill(processer ?? [], vald.id)}</strong>
              </p>
            )}
            {utkast.läge === "befintlig" &&
              vald?.prefix &&
              delaNamn(flöde.name).prefix &&
              delaNamn(flöde.name).prefix !== vald.prefix && (
                <p className="ark-hint ark-hint--warn">
                  Flödet heter {delaNamn(flöde.name).prefix} men processen har nummer {vald.prefix}.
                </p>
              )}

            {utkast.läge === "ny" && (
              <div className="ark-publicera-ny">
                <div>
                  <label className="ark-field-label" htmlFor="ark-pub-prefix">
                    Nummer
                  </label>
                  <input
                    id="ark-pub-prefix"
                    className="ark-input"
                    value={utkast.nyttPrefix}
                    placeholder="4.4.5"
                    onChange={(e) => setUtkast((u) => ({ ...u, nyttPrefix: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="ark-field-label" htmlFor="ark-pub-namn">
                    Namn på processen
                  </label>
                  <input
                    id="ark-pub-namn"
                    className="ark-input"
                    value={utkast.nyttNamn}
                    onChange={(e) => setUtkast((u) => ({ ...u, nyttNamn: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {/* ---- 2. Vilken version ---- */}
            <div className="ark-section-title">Version</div>
            <VersionsVal {...version} />

            {/* ---- 3. Metadata ---- */}
            <div className="ark-section-title">Uppgifter</div>
            <label className="ark-field-label" htmlFor="ark-pub-agare">
              Processägare *
            </label>
            <input
              id="ark-pub-agare"
              className="ark-input"
              value={utkast.ägare}
              placeholder="Roll eller namn"
              onChange={(e) => setUtkast((u) => ({ ...u, ägare: e.target.value }))}
            />
            <label className="ark-field-label" htmlFor="ark-pub-beskrivning">
              Beskrivning *
            </label>
            <textarea
              id="ark-pub-beskrivning"
              className="ark-input ark-publicera-text"
              value={utkast.beskrivning}
              placeholder="Vad processen gör och varför"
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
                disabled={steg === "arbetar" || !processer}
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
                  title="Ta bort processbilden ur EA-portalen"
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

export function lästSignatur(): string {
  try {
    return localStorage.getItem(SIGNATUR_NYCKEL)?.trim() ?? "";
  } catch {
    return "";
  }
}
