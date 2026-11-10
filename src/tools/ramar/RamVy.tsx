/**
 * Ramar – berätta en befintlig process i bilder.
 *
 * En ramserie pekar på ett sparat flöde (flödesschema eller affärsprocess) och bär en
 * följd av ramar. I varje ram väljer man ett verktyg ur lådan – färgkant,
 * blink eller puls – och klickar på de objekt och kopplingar som ska sticka
 * ut. Presentationsläget visar ramarna i helskärm, en i taget.
 *
 * Processen RITAS INTE här. Bilden är exportörens egen SVG (`processSvg`) och
 * ramen läggs ovanpå den (`läggPåRam`) – ändras processen följer ramarna med,
 * eftersom de pekar ut sina mål med stabila nycklar och inte med lägen.
 */

import { kanTaBortRamserie, kanÄndraRamserie } from "@/core/behorighet";
import { useAnvändare } from "@/shell/Inloggning";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FLOWS_CHANGED,
  flowFamily,
  getFlowStore,
  type FlowSummary,
  type SavedFlow,
} from "@/core/flow-store";
import {
  RAM_FÄRGER,
  RAM_KANT_ATTR,
  RAM_NOD_ATTR,
  RAM_VERKTYG,
  duplicera,
  flyttaRam,
  läggTillRam,
  nyRam,
  nySerie,
  taBortMarkering,
  taBortRam,
  växlaMarkering,
  ändraRam,
  type RamStil,
  type Ram,
  type RamMål,
  type RamVerktyg,
  type Ramserie,
  type RamserieSammanfattning,
} from "@/core/ram";
import { RAMAR_CHANGED, getRamStore, meddelaRamarÄndrade, type RamStore } from "@/core/ram-store";
import { fortsättBild, ramScen, serieScen } from "@/core/ram-scen";
import { processSvg, tillgängligaStilar } from "./process-svg";
import { FärgVal } from "./FargVal";
import { läggPåRam } from "./effekter";
import { ScenBild } from "./ScenBild";
import { ScenRedigerare } from "./ScenRedigerare";
import {
  SKÄRMVYER,
  VISNINGS_KANAL,
  nästaSkärm,
  öppnaSkärm,
  type SkärmVy,
  type VisningsMeddelande,
} from "./visning";
import { säkerSvg } from "@/render/saker-svg";

type Verktyg = RamVerktyg | "sudd";
/** Presentationens vy: bara flödet, bara bilden, eller båda sida vid sida. */
type PresVy = "flöde" | "bild" | "båda";

/** Målet ett klick i bilden träffade – objekt eller koppling. */
export function målUrKlick(target: EventTarget | null): RamMål | null {
  const el = (target as Element | null)?.closest?.(`[${RAM_NOD_ATTR}],[${RAM_KANT_ATTR}]`);
  if (!el) return null;
  const nod = el.getAttribute(RAM_NOD_ATTR);
  if (nod !== null) return { typ: "nod", id: nod };
  return { typ: "kant", id: el.getAttribute(RAM_KANT_ATTR)! };
}

export function RamVy({
  flöden,
  öppnaSerie = null,
}: {
  flöden: FlowSummary[];
  /** Serien ett verktyg bett om att få öppnad (AI-presentationen). */
  öppnaSerie?: { id: string; nonce: number } | null;
}) {
  /** Alla läser ramarna; bara skaparen (eller en administratör) ändrar och tar bort en serie. */
  const användare = useAnvändare();
  const [store, setStore] = useState<RamStore | null>(null);
  const [serier, setSerier] = useState<RamserieSammanfattning[]>([]);
  const [serie, setSerie] = useState<Ramserie | null>(null);
  /** Serien som den senast sparades – det som gör "osparat" avläsbart. */
  const [sparadSom, setSparadSom] = useState("");
  const [flöde, setFlöde] = useState<SavedFlow | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [aktivId, setAktivId] = useState<string | null>(null);
  const [verktyg, setVerktyg] = useState<Verktyg>("puls");
  const [färg, setFärg] = useState(RAM_FÄRGER[0]);
  const [anpassa, setAnpassa] = useState(true);
  const [presenterar, setPresenterar] = useState(false);
  /** Flödesfliken eller bildfliken. Gäller alla ramar – man arbetar i en i taget. */
  const [flik, setFlik] = useState<"flöde" | "bild">("flöde");

  const läsLista = useCallback(async (s: RamStore) => {
    try {
      setSerier(await s.list());
    } catch {
      setSerier([]);
    }
  }, []);

  useEffect(() => {
    void getRamStore().then((s) => {
      setStore(s);
      void läsLista(s);
    });
  }, [läsLista]);

  // En serie kan ha sparats utanför Ramar – listan läses då om.
  useEffect(() => {
    if (!store) return;
    const läsOm = () => void läsLista(store);
    window.addEventListener(RAMAR_CHANGED, läsOm);
    return () => window.removeEventListener(RAMAR_CHANGED, läsOm);
  }, [store, läsLista]);

  /* ---- Processen serien berättar om. Läses om när ett flöde sparats, så
     ramen alltid ligger på det som faktiskt står i biblioteket. ---- */
  const flödeId = serie?.flödeId ?? null;
  const läsFlöde = useCallback(async () => {
    if (!flödeId) {
      setFlöde(null);
      return;
    }
    try {
      const fs = await getFlowStore();
      setFlöde(await fs.load(flödeId));
      setFel(null);
    } catch (e) {
      setFlöde(null);
      setFel(`Processen "${flödeId}" gick inte att läsa: ${e instanceof Error ? e.message : e}`);
    }
  }, [flödeId]);
  useEffect(() => {
    void läsFlöde();
    window.addEventListener(FLOWS_CHANGED, läsFlöde);
    return () => window.removeEventListener(FLOWS_CHANGED, läsFlöde);
  }, [läsFlöde]);

  const basSvg = useMemo(() => {
    if (!flöde) return "";
    try {
      return processSvg(flöde, serie?.stil);
    } catch (e) {
      console.error(e);
      return "";
    }
  }, [flöde, serie?.stil]);

  const ram: Ram | null = serie?.ramar.find((r) => r.id === aktivId) ?? serie?.ramar[0] ?? null;
  const osparad = serie !== null && JSON.stringify(serie) !== sparadSom;

  const bild = useMemo(
    () => {
      if (!basSvg) return null;
      const r = läggPåRam(basSvg, ram, { redigerar: true, prefix: "ark-ram-e" });
      return { ...r, svg: säkerSvg(r.svg) };
    },
    [basSvg, ram],
  );

  /* ---- Visningsfönstret: följer serien och den valda ramen (visning.ts). ---- */
  const index = ram && serie ? serie.ramar.findIndex((r) => r.id === ram.id) : -1;
  const kanal = useRef<BroadcastChannel | null>(null);
  const nuläge = useRef<VisningsMeddelande | null>(null);
  // Flödets grundbild följer med – skärmarna lägger ramens markeringar på den själva.
  nuläge.current = serie && index >= 0 ? { typ: "läge", serie, index, flödeSvg: basSvg || undefined } : null;
  /** Anslutna skärmar och vad de visar – de hälsar när de startar och när vyn byts. */
  const [skärmar, setSkärmar] = useState<Record<string, SkärmVy>>({});
  const [kontroll, setKontroll] = useState(false);
  const serieRef = useRef(serie);
  serieRef.current = serie;
  /** Ett steg fram eller bak – från visningsfönstrets piltangenter. */
  const bläddra = useCallback((steg: 1 | -1) => {
    const s = serieRef.current;
    if (!s) return;
    setAktivId((id) => {
      const i = Math.max(0, s.ramar.findIndex((r) => r.id === id));
      return s.ramar[Math.min(s.ramar.length - 1, Math.max(0, i + steg))]?.id ?? id;
    });
  }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const k = new BroadcastChannel(VISNINGS_KANAL);
    kanal.current = k;
    k.onmessage = (e: MessageEvent<VisningsMeddelande>) => {
      const m = e.data;
      if (m.typ === "hej") {
        if (nuläge.current) k.postMessage(nuläge.current);
        const { skärm, vy } = m;
        if (skärm && vy) setSkärmar((s) => ({ ...s, [skärm]: vy }));
      }
      if (m.typ === "hejdå")
        setSkärmar((s) => {
          const { [m.skärm]: _, ...kvar } = s;
          return kvar;
        });
      if (m.typ === "byt") bläddra(m.steg);
    };
    // Vilka skärmar är redan öppna? De svarar med sitt nummer och sin vy.
    k.postMessage({ typ: "hej" } satisfies VisningsMeddelande);
    return () => k.close();
  }, [bläddra]);
  useEffect(() => {
    if (nuläge.current) kanal.current?.postMessage(nuläge.current);
  }, [serie, index, basSvg]);
  /** Kontrollen: visa det här på skärmen. */
  const sättSkärmVy = useCallback((skärm: string, vy: SkärmVy) => {
    kanal.current?.postMessage({ typ: "vy", skärm, vy } satisfies VisningsMeddelande);
    setSkärmar((s) => ({ ...s, [skärm]: vy }));
  }, []);

  /* ---- Serier ---- */
  const öppna = useCallback(
    async (id: string) => {
      if (!store) return;
      if (osparad && !confirm("Visualiseringen har osparade ändringar. Lämna den ändå?")) return;
      try {
        const s = await store.load(id);
        setSerie(s);
        setSparadSom(JSON.stringify(s));
        setAktivId(s.ramar[0]?.id ?? null);
        setFel(null);
      } catch (e) {
        setFel(e instanceof Error ? e.message : String(e));
      }
    },
    [store, osparad],
  );

  useEffect(() => {
    if (öppnaSerie && store) void öppna(öppnaSerie.id);
    // Bara på en NY begäran (nonce) – och när lagringen väl finns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [öppnaSerie, store]);

  const skapa = useCallback(
    (namn: string, flödeId: string) => {
      if (osparad && !confirm("Visualiseringen har osparade ändringar. Lämna den ändå?")) return;
      // Skaparen står på serien direkt – bryggan stämplar samma sak vid
      // första sparningen, men knapparna ska veta det redan nu.
      const s = {
        ...nySerie(namn, flödeId, serier.map((x) => x.id)),
        skapadAv: { id: användare.id, namn: användare.namn },
      };
      setSerie(s);
      setSparadSom(""); // ny = osparad tills den sparats
      setAktivId(s.ramar[0].id);
    },
    [osparad, serier, användare],
  );

  const spara = useCallback(async () => {
    if (!store || !serie) return;
    const s = { ...serie, savedAt: new Date().toISOString() };
    try {
      await store.save(s);
      setSerie(s);
      setSparadSom(JSON.stringify(s));
      // Verktygens "Öppna i Visualisering" ska se en ny serie direkt.
      meddelaRamarÄndrade();
    } catch (e) {
      setFel(`Kunde inte spara: ${e instanceof Error ? e.message : e}`);
    }
  }, [store, serie, läsLista]);

  const taBort = useCallback(async () => {
    if (!store || !serie) return;
    if (!confirm(`Ta bort visualiseringen "${serie.namn}"? Det går inte att ångra.`)) return;
    await store.remove(serie.id);
    setSerie(null);
    setSparadSom("");
    meddelaRamarÄndrade();
  }, [store, serie, läsLista]);

  const stäng = useCallback(() => {
    if (osparad && !confirm("Visualiseringen har osparade ändringar. Lämna den ändå?")) return;
    setSerie(null);
    setSparadSom("");
  }, [osparad]);

  /* ---- Ramar ---- */
  const ändra = useCallback(
    (f: (r: Ram) => Ram) => {
      if (!ram) return;
      setSerie((s) => (s ? ändraRam(s, ram.id, f) : s));
    },
    [ram],
  );

  const klickIBild = useCallback(
    (e: React.MouseEvent) => {
      const mål = målUrKlick(e.target);
      if (!mål || !ram) return;
      if (verktyg === "sudd") ändra((r) => taBortMarkering(r, mål));
      else ändra((r) => växlaMarkering(r, { mål, verktyg, färg }));
    },
    [ram, verktyg, färg, ändra],
  );

  const nyRamEfter = (kopia: boolean) => {
    if (!serie) return;
    // En ny tom ram fortsätter BILDEN från den valda (vilka figurer som syns);
    // en kopia tar med allt.
    const n = kopia && ram ? duplicera(ram) : fortsättBild(nyRam(`Ram ${serie.ramar.length + 1}`), ram);
    setSerie(läggTillRam(serie, n, ram?.id));
    setAktivId(n.id);
  };

  const flödesNamn = useMemo(() => new Map(flöden.map((f) => [f.id, f.name] as const)), [flöden]);

  /* ------------------------------------------------------------------ */

  if (!serie) {
    return (
      <RamStart
        serier={serier}
        flöden={flöden}
        flödesNamn={flödesNamn}
        lagring={store?.kind}
        fel={fel}
        onÖppna={öppna}
        onSkapa={skapa}
      />
    );
  }

  return (
    <div className="ark-ramar">
      <header className="ark-ramar-topp">
        <button className="ark-btn" onClick={stäng} title="Tillbaka till alla visualiseringar">
          ← Alla
        </button>
        <input
          className="ark-input ark-ramar-namn"
          value={serie.namn}
          onChange={(e) => setSerie({ ...serie, namn: e.target.value })}
          aria-label="Seriens namn"
        />
        <span className="ark-ramar-process" title={serie.flödeId}>
          {flowFamily(serie.flödeId) === "affarsprocess" ? "Affärsprocess" : "Systemprocess"} ·{" "}
          {flödesNamn.get(serie.flödeId) ?? serie.flödeId}
        </span>
        {tillgängligaStilar(serie.flödeId).length > 1 && (
          <select
            className="ark-input ark-ramar-stil"
            value={serie.stil ?? "verktyg"}
            onChange={(e) => setSerie({ ...serie, stil: e.target.value as RamStil })}
            aria-label="Processens utseende"
            title="Hur processen ritas i ramarna och presentationen. Ramarnas markeringar följer med objekten."
          >
            <option value="verktyg">Utseende: verktygets</option>
            <option value="avskalad">Utseende: avskalad</option>
          </select>
        )}
        <span className="ark-ramar-hoger">
          {osparad && <span className="ark-ramar-osparad">Osparade ändringar</span>}
          <button
            className="ark-btn ark-btn--primary"
            onClick={spara}
            disabled={!osparad || !kanÄndraRamserie(användare, serie)}
            title={
              kanÄndraRamserie(användare, serie)
                ? undefined
                : "Bara den som skapade visualiseringen, eller en administratör, kan spara ändringar i den."
            }
          >
            Spara
          </button>
          <button className="ark-btn" onClick={() => setPresenterar(true)} disabled={!basSvg}>
            ▶ Presentera
          </button>
          <button
            className="ark-btn"
            onClick={() => setKontroll(true)}
            title="Styr visningen: bläddra, se talarstödet och välj vad varje skärm visar – flöde, bild eller båda"
          >
            🎛 Kontroll
          </button>
          {kanTaBortRamserie(användare, serie) && (
          <button className="ark-btn" onClick={taBort} title="Ta bort visualiseringen">
            🗑
          </button>
          )}
        </span>
      </header>

      <div className="ark-ramar-kropp">
        <aside className="ark-ramar-lista">
          <ol>
            {serie.ramar.map((r, i) => (
              <li key={r.id}>
                <button
                  className={`ark-ramar-rad ${r.id === ram?.id ? "vald" : ""}`}
                  onClick={() => setAktivId(r.id)}
                >
                  <span className="ark-ramar-nr">{i + 1}</span>
                  <span className="ark-ramar-rubrik">{r.rubrik || "Utan rubrik"}</span>
                  <span className="ark-ramar-antal" title="Markeringar">
                    {r.markeringar.length}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="ark-ramar-listknappar">
            <button className="ark-btn" onClick={() => nyRamEfter(false)} title="Ny tom ram efter den valda">
              ✚ Ny
            </button>
            <button className="ark-btn" onClick={() => nyRamEfter(true)} title="Kopiera den valda ramen">
              ⧉ Kopiera
            </button>
            <button
              className="ark-btn"
              onClick={() => ram && setSerie(flyttaRam(serie, ram.id, -1))}
              disabled={index <= 0}
              title="Flytta upp"
            >
              ↑
            </button>
            <button
              className="ark-btn"
              onClick={() => ram && setSerie(flyttaRam(serie, ram.id, 1))}
              disabled={index < 0 || index >= serie.ramar.length - 1}
              title="Flytta ner"
            >
              ↓
            </button>
            <button
              className="ark-btn"
              onClick={() => {
                if (!ram) return;
                const kvar = taBortRam(serie, ram.id);
                setSerie(kvar);
                setAktivId(kvar.ramar[Math.max(0, index - 1)]?.id ?? null);
              }}
              disabled={serie.ramar.length <= 1}
              title="Ta bort ramen"
            >
              🗑
            </button>
          </div>
        </aside>

        <main className="ark-ramar-yta">
          <div className="ark-ramar-flikar" role="tablist">
            <button role="tab" aria-selected={flik === "flöde"} className={flik === "flöde" ? "vald" : ""} onClick={() => setFlik("flöde")}>
              ⇄ Flöde
            </button>
            <button role="tab" aria-selected={flik === "bild"} className={flik === "bild" ? "vald" : ""} onClick={() => setFlik("bild")}>
              ▦ Bild
            </button>
          </div>
          {flik === "bild" && ram ? (
            <>
              <ScenRedigerare
                serie={serie}
                ram={ram}
                ramIndex={index}
                onSerie={(f) => setSerie((s) => (s ? f(s) : s))}
                färg={färg}
                onFärg={setFärg}
                fel={setFel}
              />
            </>
          ) : (
          <>
          <div className="ark-ramar-lada" role="toolbar" aria-label="Verktygslåda">
            {RAM_VERKTYG.map((v) => (
              <button
                key={v.id}
                className={`ark-ramar-verktyg ${verktyg === v.id ? "vald" : ""}`}
                onClick={() => setVerktyg(v.id)}
                title={v.hjälp}
                aria-pressed={verktyg === v.id}
              >
                <span aria-hidden>{v.ikon}</span> {v.namn}
              </button>
            ))}
            <button
              className={`ark-ramar-verktyg ${verktyg === "sudd" ? "vald" : ""}`}
              onClick={() => setVerktyg("sudd")}
              title="Klicka på en markering för att ta bort den"
              aria-pressed={verktyg === "sudd"}
            >
              <span aria-hidden>⌫</span> Sudda
            </button>
            <span className="ark-ramar-skiljare" />
            <FärgVal färg={färg} setFärg={setFärg} />
            <span className="ark-ramar-skiljare" />
            <label className="ark-ramar-val" title="Tona ner allt som inte är markerat">
              <input
                type="checkbox"
                checked={!!ram?.strålkastare}
                onChange={(e) => ändra((r) => ({ ...r, strålkastare: e.target.checked }))}
              />
              Strålkastare
            </label>
            <label className="ark-ramar-val" title="Presentationen zoomar in på det markerade">
              <input
                type="checkbox"
                checked={!!ram?.zooma}
                onChange={(e) => ändra((r) => ({ ...r, zooma: e.target.checked }))}
              />
              Zooma in
            </label>
            <button
              className="ark-btn"
              onClick={() => ändra((r) => ({ ...r, markeringar: [] }))}
              disabled={!ram?.markeringar.length}
            >
              Rensa ramen
            </button>
            <span className="ark-ramar-hoger">
              <div className="ark-toggle">
                <button className={anpassa ? "active" : ""} onClick={() => setAnpassa(true)}>
                  Anpassa
                </button>
                <button className={!anpassa ? "active" : ""} onClick={() => setAnpassa(false)}>
                  100 %
                </button>
              </div>
            </span>
          </div>

          {fel && <div className="ark-error">{fel}</div>}
          {bild && bild.saknas.length > 0 && (
            <div className="ark-ramar-varning">
              {bild.saknas.length} markering{bild.saknas.length > 1 ? "ar" : ""} pekar på något som
              inte längre finns i processen.{" "}
              <button
                className="ark-linkbtn"
                onClick={() =>
                  ändra((r) => bild.saknas.reduce((acc, m) => taBortMarkering(acc, m), r))
                }
              >
                Ta bort dem
              </button>
            </div>
          )}

          <div
            className={`ark-ramar-bild redigerar ${anpassa ? "anpassa" : ""}`}
            onClick={klickIBild}
            // Bilden är exportörens egen SVG plus ramens lager, sanerad
            // (render/saker-svg.ts) – mellanlagret kommer ur sparade filer.
            dangerouslySetInnerHTML={{ __html: bild?.svg ?? "" }}
          />
          </>
          )}

          {ram && (
            <div className="ark-ramar-text">
              <input
                className="ark-input"
                value={ram.rubrik}
                placeholder="Rubrik"
                onChange={(e) => ändra((r) => ({ ...r, rubrik: e.target.value }))}
                aria-label="Ramens rubrik"
              />
              <textarea
                className="ark-textarea"
                value={ram.text ?? ""}
                placeholder="Vad ska man se i den här ramen? Visas under bilden när du presenterar."
                onChange={(e) => ändra((r) => ({ ...r, text: e.target.value }))}
                aria-label="Ramens text"
              />
            </div>
          )}
        </main>
      </div>

      {presenterar && basSvg && (
        <Presentation
          serie={serie}
          basSvg={basSvg}
          index={Math.max(0, index)}
          startVy={flik === "bild" ? "bild" : "båda"}
          onIndex={(i) => setAktivId(serie.ramar[i]?.id ?? null)}
          onStäng={() => setPresenterar(false)}
        />
      )}
      {kontroll && (
        <Kontroll
          serie={serie}
          index={Math.max(0, index)}
          skärmar={skärmar}
          onIndex={(i) => setAktivId(serie.ramar[i]?.id ?? null)}
          onVy={sättSkärmVy}
          onStäng={() => setKontroll(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kontrollen                                                          */
/* ------------------------------------------------------------------ */

/**
 * KONTROLLEN – det man har framför sig när man visar: bläddra, se vad som
 * ska sägas (ramens rubrik och text) och vad som kommer, och bestäm vad varje
 * skärm visar – flödet, bilden eller båda, halva skärmen var.
 *
 * Skärmarna är egna fönster (visning.ts). Öppna ett per skärm och dra dit, eller
 * ett enda med Båda. Fjärrkontrollen i en mobil blir samma panel, med
 * meddelandena via servern i stället för BroadcastChannel.
 */
export function Kontroll(props: {
  serie: Ramserie;
  index: number;
  skärmar: Record<string, SkärmVy>;
  onIndex: (i: number) => void;
  onVy: (skärm: string, vy: SkärmVy) => void;
  onStäng: () => void;
}) {
  const { serie, index: i, skärmar, onIndex, onStäng } = props;
  const sista = serie.ramar.length - 1;
  const ram = serie.ramar[i];
  const nästa = serie.ramar[i + 1];
  const iRef = useRef(i);
  iRef.current = i;

  useEffect(() => {
    const tangent = (e: KeyboardEvent) => {
      const mål = e.target as HTMLElement | null;
      if (mål && /^(INPUT|TEXTAREA|SELECT)$/.test(mål.tagName)) return;
      const nu = iRef.current;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) onIndex(Math.min(sista, nu + 1));
      else if (["ArrowLeft", "PageUp"].includes(e.key)) onIndex(Math.max(0, nu - 1));
      else if (e.key === "Escape") onStäng();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", tangent);
    return () => window.removeEventListener("keydown", tangent);
  }, [sista, onIndex, onStäng]);

  const nummer = Object.keys(skärmar).sort((a, b) => Number(a) - Number(b));

  return (
    <div className="ark-kontroll" onClick={(e) => e.target === e.currentTarget && onStäng()}>
      <div className="ark-kontroll-panel" role="dialog" aria-label="Kontroll">
        <div className="ark-kontroll-huvud">
          <h2>🎛 Kontroll · {serie.namn}</h2>
          <button className="ark-btn" onClick={onStäng} title="Stäng (Esc)">
            ✕
          </button>
        </div>

        <div className="ark-kontroll-blad">
          <button className="ark-btn" onClick={() => onIndex(Math.max(0, i - 1))} disabled={i === 0} aria-label="Föregående ram">
            ←
          </button>
          <span className="ark-kontroll-nr">
            {i + 1} / {serie.ramar.length}
          </span>
          <button className="ark-btn ark-btn--primary" onClick={() => onIndex(Math.min(sista, i + 1))} disabled={i >= sista} aria-label="Nästa ram">
            →
          </button>
        </div>

        <div className="ark-kontroll-nu" aria-live="polite">
          <strong>{ram?.rubrik}</strong>
          {ram?.text ? <p>{ram.text}</p> : <p className="ark-kontroll-nasta">Ingen text i den här ramen.</p>}
        </div>
        <div className="ark-kontroll-nasta">{nästa ? `Nästa: ${nästa.rubrik}` : "Sista ramen."}</div>

        <div>
          <div className="ark-section-title">Skärmar</div>
          <div className="ark-kontroll-skarmar">
            {nummer.length === 0 && (
              <p className="ark-hint">
                Inga skärmar öppna. Öppna ett fönster per skärm och dra dit det – eller ett enda med Båda.
              </p>
            )}
            {nummer.map((n) => (
              <div key={n} className="ark-kontroll-skarm">
                <span>Skärm {n}</span>
                <div className="ark-toggle" role="group" aria-label={`Skärm ${n} visar`}>
                  {SKÄRMVYER.map((v) => (
                    <button key={v.id} className={skärmar[n] === v.id ? "active" : ""} onClick={() => props.onVy(n, v.id)}>
                      {v.namn}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="ark-kontroll-oppna">
          <span className="ark-hint">Öppna skärm:</span>
          {SKÄRMVYER.map((v) => (
            <button key={v.id} className="ark-btn" onClick={() => öppnaSkärm(nästaSkärm(nummer), v.id)}>
              ⧉ {v.id === "båda" ? "Flöde + bild" : v.namn}
            </button>
          ))}
        </div>
        <p className="ark-hint">
          Pilarna bläddrar, även i skärmfönstren. Dubbelklicka i ett skärmfönster för helskärm; F, B och D byter vy där.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Startsidan: befintliga serier och en ny                             */
/* ------------------------------------------------------------------ */

function RamStart(props: {
  serier: RamserieSammanfattning[];
  flöden: FlowSummary[];
  flödesNamn: Map<string, string>;
  lagring?: RamStore["kind"];
  fel: string | null;
  onÖppna: (id: string) => void;
  onSkapa: (namn: string, flödeId: string) => void;
}) {
  const [namn, setNamn] = useState("");
  const [flödeId, setFlödeId] = useState("");
  const sorterade = useMemo(
    () => [...props.flöden].sort((a, b) => a.name.localeCompare(b.name, "sv")),
    [props.flöden],
  );
  const fd = sorterade.filter((f) => flowFamily(f.id) !== "affarsprocess");
  const ap = sorterade.filter((f) => flowFamily(f.id) === "affarsprocess");

  return (
    <div className="ark-katalog">
      <div className="ark-katalog-topp">
        <div>
          <h1 className="ark-katalog-rubrik">Visualisering</h1>
          <p className="ark-katalog-underrubrik">
            Berätta en befintlig process i bilder: lyft fram delar av den, låt kopplingarna pulsera.
          </p>
        </div>
      </div>
      {props.fel && <div className="ark-error">{props.fel}</div>}

      <section className="ark-ramar-ny">
        <h2 className="ark-ramar-h2">Ny visualisering</h2>
        <div className="ark-ramar-nyrad">
          <select
            className="ark-input"
            value={flödeId}
            onChange={(e) => {
              setFlödeId(e.target.value);
              if (!namn) setNamn(props.flödesNamn.get(e.target.value) ?? "");
            }}
            aria-label="Process"
          >
            <option value="">Välj process …</option>
            {fd.length > 0 && (
              <optgroup label="Systemprocesser">
                {fd.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
            {ap.length > 0 && (
              <optgroup label="Affärsprocesser">
                {ap.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <input
            className="ark-input"
            value={namn}
            placeholder="Seriens namn"
            onChange={(e) => setNamn(e.target.value)}
            aria-label="Seriens namn"
          />
          <button
            className="ark-btn ark-btn--primary"
            disabled={!flödeId || !namn.trim()}
            onClick={() => props.onSkapa(namn.trim(), flödeId)}
          >
            Skapa
          </button>
        </div>
      </section>

      <h2 className="ark-ramar-h2">Sparade visualiseringar</h2>
      {props.serier.length === 0 ? (
        <p className="ark-katalog-hjalp">Inga visualiseringar ännu.</p>
      ) : (
        <div className="ark-kortrutnat">
          {props.serier.map((s) => (
            <button key={s.id} className="ark-kort" onClick={() => props.onÖppna(s.id)}>
              <span className="ark-kort-titel">{s.namn}</span>
              <span className="ark-kort-meta">
                {props.flödesNamn.get(s.flödeId) ?? s.flödeId} · {s.antalRamar} ram
                {s.antalRamar === 1 ? "" : "ar"}
              </span>
              <span className="ark-kort-tid">{new Date(s.savedAt).toLocaleString("sv-SE")}</span>
            </button>
          ))}
        </div>
      )}
      {props.lagring === "local" && (
        <p className="ark-hint">
          Bryggan svarar inte – visualiseringarna sparas i webbläsaren tills dev-servern kör.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Presentationen                                                      */
/* ------------------------------------------------------------------ */

function Presentation(props: {
  serie: Ramserie;
  basSvg: string;
  index: number;
  startVy: PresVy;
  onIndex: (index: number) => void;
  onStäng: () => void;
}) {
  const { serie, basSvg, index: i, onIndex, onStäng } = props;
  const [vy, setVy] = useState<PresVy>(props.startVy);
  const yta = useRef<HTMLDivElement>(null);
  const ram = serie.ramar[i] ?? null;
  const bild = useMemo(() => säkerSvg(läggPåRam(basSvg, ram, { prefix: "ark-ram-p" }).svg), [basSvg, ram]);
  const sista = serie.ramar.length - 1;
  const iRef = useRef(i);
  iRef.current = i;

  useEffect(() => {
    // Helskärm om webbläsaren tillåter – annars fyller överlägget fönstret.
    void yta.current?.requestFullscreen?.().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const tangent = (e: KeyboardEvent) => {
      const nu = iRef.current;
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) onIndex(Math.min(sista, nu + 1));
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) onIndex(Math.max(0, nu - 1));
      else if (e.key === "Home") onIndex(0);
      else if (e.key === "End") onIndex(sista);
      else if (e.key === "f") setVy("flöde");
      else if (e.key === "b") setVy("bild");
      else if (e.key === "d") setVy("båda");
      else if (e.key === "Escape") onStäng();
      else return;
      e.preventDefault();
    };
    // Lämnar man helskärmen med webbläsarens egen Esc ska presentationen också stängas.
    const skärm = () => {
      if (!document.fullscreenElement) onStäng();
    };
    window.addEventListener("keydown", tangent);
    document.addEventListener("fullscreenchange", skärm);
    return () => {
      window.removeEventListener("keydown", tangent);
      document.removeEventListener("fullscreenchange", skärm);
    };
  }, [sista, onIndex, onStäng]);

  return (
    <div className="ark-ramar-presentation" ref={yta}>
      <div className={`ark-ramar-pytor vy-${vy}`}>
        {vy !== "bild" && <div className="ark-ramar-pbild" dangerouslySetInnerHTML={{ __html: bild }} />}
        {vy !== "flöde" && ram && (
          <div className="ark-ramar-pbild ark-ramar-pscen">
            <ScenBild scen={serieScen(serie)} rs={ramScen(ram)} läge="visa" prefix="ark-scen-p" />
          </div>
        )}
      </div>
      <div className="ark-ramar-pfot">
        <button className="ark-btn" onClick={() => onIndex(Math.max(0, i - 1))} disabled={i === 0}>
          ←
        </button>
        <div className="ark-ramar-ptext">
          <strong>{ram?.rubrik}</strong>
          {ram?.text && <span>{ram.text}</span>}
        </div>
        <div className="ark-toggle ark-ramar-pvy" title="Tangenterna F, B och D">
          {(["flöde", "bild", "båda"] as PresVy[]).map((v) => (
            <button key={v} className={vy === v ? "active" : ""} onClick={() => setVy(v)}>
              {v === "flöde" ? "Flöde" : v === "bild" ? "Bild" : "Båda"}
            </button>
          ))}
        </div>
        <span className="ark-ramar-pnr">
          {i + 1} / {serie.ramar.length}
        </span>
        <button className="ark-btn" onClick={() => onIndex(Math.min(sista, i + 1))} disabled={i >= sista}>
          →
        </button>
        <button className="ark-btn" onClick={onStäng} title="Avsluta (Esc)">
          ✕
        </button>
      </div>
    </div>
  );
}
