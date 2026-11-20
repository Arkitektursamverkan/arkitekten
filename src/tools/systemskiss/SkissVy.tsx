/**
 * Systemskiss – skissa en systemmiljö: servrar, tjänster, nät och hur de
 * hänger ihop.
 *
 * En EGEN vy i skalet, nådd från startsidan – inte ett verktyg i
 * verktygsregistret, eftersom en skiss inte är en process: den har ingen
 * text att tolka, ingen plats i katalogen och ingen publicering
 * (core/systemskiss.ts).
 *
 * Vem som får vad avgörs av core/behorighet.ts – samma funktioner som bryggan
 * prövar med. En skiss kan DÖLJAS för andra än administratörer; bara en
 * administratör ser kryssrutan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kanDöljaSkiss, kanTaBortSkiss, kanÄndraSkiss } from "@/core/behorighet";
import { getSkissStore, type SkissStore } from "@/core/skiss-store";
import {
  SKISS_SORTER,
  ZON_FÄRGER,
  dupliceraISkiss,
  läggTillObjekt,
  läggTillZon,
  nySkiss,
  skissNyckel,
  sortNamn,
  taBortUrSkiss,
  ändraKoppling,
  ändraObjekt,
  ändraZon,
  type Pil,
  type SkissSammanfattning,
  type SkissSort,
  type Systemskiss,
} from "@/core/systemskiss";
import { useAnvändare } from "@/shell/Inloggning";
import { copySvgAsPng, svgToPngBlob } from "@/tools/flowchart/export/clipboard";
import { flowId } from "@/core/flow-store";
import { SkissCanvas, type SkissCanvasHandtag } from "./SkissCanvas";
import { ZON_STIL, skissSvg, sortIkonSvg } from "./skiss-svg";

/** Hur många steg ångra minns. */
const ÅNGRA_TAK = 100;

function laddaNer(blob: Blob, filnamn: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filnamn;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function SkissVy() {
  const användare = useAnvändare();
  const [store, setStore] = useState<SkissStore | null>(null);
  const [lista, setLista] = useState<SkissSammanfattning[]>([]);
  const [skiss, setSkiss] = useState<Systemskiss | null>(null);
  /** Skissen som den senast sparades – det som gör "osparat" avläsbart. */
  const [sparadSom, setSparadSom] = useState("");
  const [markerade, setMarkerade] = useState<string[]>([]);
  const [kopplar, setKopplar] = useState(false);
  const [fel, setFel] = useState<string | null>(null);
  const [kvitto, setKvitto] = useState<string | null>(null);
  const [sparar, setSparar] = useState(false);
  const canvas = useRef<SkissCanvasHandtag>(null);
  const namnfält = useRef<HTMLInputElement>(null);

  /* ---- Ångra: tidigare och senare tillstånd. `nyckel` håller ihop ett drag
     eller en följd tangenttryck i samma fält till ETT steg. ---- */
  const bakåt = useRef<Systemskiss[]>([]);
  const framåt = useRef<Systemskiss[]>([]);
  const senasteNyckel = useRef<string | null>(null);

  /** Det som visas NU – så att en ändring aldrig räknas på ett gammalt tillstånd. */
  const nuRef = useRef<Systemskiss | null>(null);
  nuRef.current = skiss;
  const sätt = (s: Systemskiss) => {
    nuRef.current = s;
    setSkiss(s);
  };

  const ändra = useCallback((nästa: Systemskiss, nyckel?: string) => {
    const nu = nuRef.current;
    if (!nu || nu === nästa) return;
    if (!nyckel || nyckel !== senasteNyckel.current) {
      bakåt.current = [...bakåt.current, nu].slice(-ÅNGRA_TAK);
      framåt.current = [];
    }
    senasteNyckel.current = nyckel ?? null;
    sätt(nästa);
    setKvitto(null);
  }, []);

  const ångra = useCallback(() => {
    const nu = nuRef.current;
    const förra = bakåt.current[bakåt.current.length - 1];
    if (!nu || !förra) return;
    bakåt.current = bakåt.current.slice(0, -1);
    framåt.current = [...framåt.current, nu];
    senasteNyckel.current = null;
    sätt(förra);
    setMarkerade([]);
  }, []);

  const görOm = useCallback(() => {
    const nu = nuRef.current;
    const nästa = framåt.current[framåt.current.length - 1];
    if (!nu || !nästa) return;
    framåt.current = framåt.current.slice(0, -1);
    bakåt.current = [...bakåt.current, nu];
    senasteNyckel.current = null;
    sätt(nästa);
    setMarkerade([]);
  }, []);

  const läsLista = useCallback(async (s: SkissStore) => {
    try {
      setLista(await s.list());
    } catch {
      setLista([]);
    }
  }, []);

  useEffect(() => {
    void getSkissStore().then((s) => {
      setStore(s);
      void läsLista(s);
    });
  }, [läsLista]);

  const visa = useCallback((s: Systemskiss | null) => {
    bakåt.current = [];
    framåt.current = [];
    senasteNyckel.current = null;
    setSkiss(s);
    setSparadSom(s ? skissNyckel(s) : "");
    setMarkerade([]);
    setKopplar(false);
    setKvitto(null);
  }, []);

  const öppna = async (id: string) => {
    if (!store) return;
    try {
      visa(await store.load(id));
      setFel(null);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
      void läsLista(store);
    }
  };

  /** En ny skiss sparas direkt – då finns den i listan och har sin skapare. */
  const skapa = async (namn: string, dold: boolean) => {
    if (!store) return;
    try {
      visa(await store.save(nySkiss(namn, dold)));
      setFel(null);
      void läsLista(store);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  };

  const osparad = Boolean(skiss) && skissNyckel(skiss!) !== sparadSom;
  const fårÄndra = Boolean(skiss) && kanÄndraSkiss(användare, skiss!);
  const fårDölja = kanDöljaSkiss(användare);

  const spara = useCallback(async () => {
    if (!store || !skiss || sparar) return;
    if (!skiss.namn.trim()) {
      setFel("Skissen behöver ett namn.");
      return;
    }
    setSparar(true);
    try {
      const sparad = await store.save(skiss);
      setSkiss(sparad);
      setSparadSom(skissNyckel(sparad));
      setFel(null);
      setKvitto("Sparad");
      void läsLista(store);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    } finally {
      setSparar(false);
    }
  }, [store, skiss, sparar, läsLista]);

  const tillListan = () => {
    if (osparad && !window.confirm("Skissen har ändringar som inte är sparade. Lämna den ändå?")) return;
    visa(null);
    if (store) void läsLista(store);
  };

  const taBortSkissen = async () => {
    if (!store || !skiss) return;
    if (!window.confirm(`Ta bort skissen "${skiss.namn}"? Det går inte att ångra.`)) return;
    try {
      await store.remove(skiss.id);
      visa(null);
      void läsLista(store);
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  };

  /* ---- Ritverktygen ---- */

  const läggTill = (sort: SkissSort | "zon") => {
    if (!skiss) return;
    const m = canvas.current?.mitt() ?? { x: 300, y: 200 };
    // Flera nya i rad hamnar inte exakt på varandra.
    const n = (skiss.objekt.length + skiss.zoner.length) % 6;
    const { skiss: nästa, id } =
      sort === "zon" ? läggTillZon(skiss, m.x + n * 20, m.y + n * 20) : läggTillObjekt(skiss, sort, m.x + n * 20, m.y + n * 20);
    ändra(nästa);
    setMarkerade([id]);
    setKopplar(false);
    // Namnet är det första man vill skriva.
    setTimeout(() => namnfält.current?.select(), 0);
  };

  const taBortMarkerade = useCallback(() => {
    if (!skiss || markerade.length === 0) return;
    ändra(taBortUrSkiss(skiss, markerade));
    setMarkerade([]);
  }, [skiss, markerade, ändra]);

  const duplicera = () => {
    if (!skiss) return;
    const { skiss: nästa, nya } = dupliceraISkiss(skiss, new Set(markerade));
    if (nya.length === 0) return;
    ändra(nästa);
    setMarkerade(nya);
  };

  /* ---- Export ---- */

  const filnamn = skiss ? flowId(skiss.namn) : "skiss";
  const exportera = async (form: "svg" | "png" | "urklipp") => {
    if (!skiss) return;
    try {
      const { svg, bredd, höjd } = skissSvg(skiss);
      if (form === "svg") laddaNer(new Blob([svg], { type: "image/svg+xml" }), `${filnamn}.svg`);
      else if (form === "png") laddaNer(await svgToPngBlob(svg, bredd, höjd), `${filnamn}.png`);
      else {
        await copySvgAsPng(svg, bredd, höjd);
        setKvitto("Bilden ligger i urklipp");
      }
      setFel(null);
    } catch (e) {
      setFel(`Exporten gick inte: ${e instanceof Error ? e.message : e}`);
    }
  };

  /* ---- Tangenter: spara, ångra, duplicera, ta bort. Lyssnaren sitter på FÖNSTRET –
     fokus hamnar lätt utanför vyn (en knapp som just blev grå), och då ska
     Ctrl+S ändå spara skissen och inte webbsidan. Vyn ligger kvar monterad
     när man är någon annanstans i appen, så den svarar bara när den SYNS. ---- */
  const rot = useRef<HTMLDivElement>(null);
  const tangent = useRef<(e: KeyboardEvent) => void>(() => {});
  tangent.current = (e) => {
    if (!skiss || !rot.current) return;
    if (getComputedStyle(rot.current).visibility === "hidden") return;
    const iFält = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement | null)?.tagName ?? "");
    if (!(e.ctrlKey || e.metaKey)) {
      if (iFält || !fårÄndra) return;
      if ((e.key === "Delete" || e.key === "Backspace") && markerade.length) {
        e.preventDefault();
        taBortMarkerade();
      } else if (e.key === "Escape") {
        if (kopplar) setKopplar(false);
        else if (markerade.length) setMarkerade([]);
      }
      return;
    }
    const tecken = e.key.toLowerCase();
    if (tecken === "s") {
      e.preventDefault();
      if (fårÄndra) void spara();
      return;
    }
    // I ett textfält är Ctrl+Z fältets egen ångra.
    if (iFält || !fårÄndra) return;
    if (tecken === "z" && !e.shiftKey) {
      e.preventDefault();
      ångra();
    } else if (tecken === "y" || (tecken === "z" && e.shiftKey)) {
      e.preventDefault();
      görOm();
    } else if (tecken === "d") {
      e.preventDefault();
      duplicera();
    }
  };
  useEffect(() => {
    const lyssna = (e: KeyboardEvent) => tangent.current(e);
    window.addEventListener("keydown", lyssna);
    return () => window.removeEventListener("keydown", lyssna);
  }, []);

  const valt = useMemo(() => {
    if (!skiss || markerade.length !== 1) return null;
    const id = markerade[0];
    const objekt = skiss.objekt.find((o) => o.id === id);
    if (objekt) return { typ: "objekt" as const, objekt };
    const zon = skiss.zoner.find((z) => z.id === id);
    if (zon) return { typ: "zon" as const, zon };
    const koppling = skiss.kopplingar.find((k) => k.id === id);
    return koppling ? { typ: "koppling" as const, koppling } : null;
  }, [skiss, markerade]);

  if (!skiss) {
    return (
      <SkissStart
        lista={lista}
        lagring={store?.kind}
        fel={fel}
        fårDölja={fårDölja}
        onÖppna={(id) => void öppna(id)}
        onSkapa={(namn, dold) => void skapa(namn, dold)}
      />
    );
  }

  const namnPå = (id: string) => skiss.objekt.find((o) => o.id === id)?.namn || "(utan namn)";

  return (
    <div className="ark-ramar ark-skiss" ref={rot}>
      <div className="ark-ramar-topp">
        <button className="ark-btn" onClick={tillListan} title="Tillbaka till alla skisser">
          ← Skisser
        </button>
        <input
          className="ark-input ark-ramar-namn"
          value={skiss.namn}
          disabled={!fårÄndra}
          onChange={(e) => ändra({ ...skiss, namn: e.target.value }, "skissnamn")}
          aria-label="Skissens namn"
        />
        {skiss.dold && (
          <span className="ark-skiss-dold" title="Bara administratörer ser den här skissen">
            🔒 Dold
          </span>
        )}
        <div className="ark-ramar-hoger">
          {osparad && fårÄndra && <span className="ark-ramar-osparad">Osparade ändringar</span>}
          {!osparad && kvitto && <span className="ark-hint--kvitto ark-skiss-kvitto">{kvitto}</span>}
          {osparad && kvitto && <span className="ark-skiss-kvitto">{kvitto}</span>}
          {fårÄndra && (
            <>
            <button className="ark-btn ark-btn--icon" onClick={ångra} disabled={bakåt.current.length === 0} title="Ångra (Ctrl+Z)" aria-label="Ångra">
              ↶
            </button>
            <button className="ark-btn ark-btn--icon" onClick={görOm} disabled={framåt.current.length === 0} title="Gör om (Ctrl+Y)" aria-label="Gör om">
              ↷
            </button>
            </>
          )}
          <button className="ark-btn" onClick={() => void exportera("urklipp")} title="Kopiera som bild – klistra in i ett dokument">
            ⧉ Kopiera bild
          </button>
          <button className="ark-btn" onClick={() => void exportera("png")}>
            PNG
          </button>
          <button className="ark-btn" onClick={() => void exportera("svg")}>
            SVG
          </button>
          {kanTaBortSkiss(användare, skiss) && (
            <button className="ark-btn" onClick={() => void taBortSkissen()} title="Ta bort skissen">
              🗑
            </button>
          )}
          {fårÄndra && (
            <button className="ark-btn ark-btn--primary" onClick={() => void spara()} disabled={!osparad || sparar} title="Spara (Ctrl+S)">
              {sparar ? "Sparar …" : "Spara"}
            </button>
          )}
        </div>
      </div>
      {fel && <div className="ark-error ark-skiss-fel">{fel}</div>}

      {fårÄndra && (
        <div className="ark-ramar-lada ark-skiss-lada" role="toolbar" aria-label="Lägg till">
          {SKISS_SORTER.map((s) => (
            <button key={s.id} className="ark-ramar-verktyg ark-skiss-sort" onClick={() => läggTill(s.id)} title={`Lägg till: ${s.namn}`}>
              <span aria-hidden dangerouslySetInnerHTML={{ __html: sortIkonSvg(s.id) }} />
              {s.namn}
            </button>
          ))}
          <span className="ark-ramar-skiljare" />
          <button className="ark-ramar-verktyg" onClick={() => läggTill("zon")} title="En ram runt det som hör ihop: en miljö, ett nät, en värd">
            ▭ Zon
          </button>
          <button
            className={`ark-ramar-verktyg ${kopplar ? "vald" : ""}`}
            onClick={() => setKopplar((k) => !k)}
            aria-pressed={kopplar}
            title="Koppla ihop två objekt: klicka på det första, sedan på det andra"
          >
            ↗ Koppla
          </button>
        </div>
      )}

      <div className="ark-ramar-kropp">
        <SkissCanvas
          ref={canvas}
          skiss={skiss}
          låst={!fårÄndra}
          markerade={markerade}
          onMarkera={setMarkerade}
          onÄndra={ändra}
          kopplar={kopplar}
          onKopplat={() => setKopplar(false)}
        />

        <aside className="ark-skiss-panel">
          {!fårÄndra && (
            <p className="ark-hint">
              Du tittar på skissen. Bara {skiss.skapadAv?.namn ?? "den som skapade den"} eller en administratör kan ändra den.
            </p>
          )}

          {fårÄndra && valt?.typ === "objekt" && (
            <>
              <div className="ark-section-title">{sortNamn(valt.objekt.sort)}</div>
              <label className="ark-skiss-falt">
                Namn
                <input
                  ref={namnfält}
                  className="ark-input"
                  value={valt.objekt.namn}
                  onChange={(e) => ändra(ändraObjekt(skiss, valt.objekt.id, { namn: e.target.value }), `namn-${valt.objekt.id}`)}
                />
              </label>
              <label className="ark-skiss-falt">
                Text under namnet
                <textarea
                  className="ark-textarea"
                  rows={4}
                  value={valt.objekt.text ?? ""}
                  placeholder={"T.ex. operativsystem, storlek, adress.\nEn rad per uppgift."}
                  onChange={(e) => ändra(ändraObjekt(skiss, valt.objekt.id, { text: e.target.value }), `text-${valt.objekt.id}`)}
                />
              </label>
              <label className="ark-skiss-falt">
                Sort
                <select
                  className="ark-input"
                  value={valt.objekt.sort}
                  onChange={(e) => ändra(ändraObjekt(skiss, valt.objekt.id, { sort: e.target.value as SkissSort }))}
                >
                  {SKISS_SORTER.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.namn}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {fårÄndra && valt?.typ === "zon" && (
            <>
              <div className="ark-section-title">Zon</div>
              <label className="ark-skiss-falt">
                Namn
                <input
                  ref={namnfält}
                  className="ark-input"
                  value={valt.zon.namn}
                  onChange={(e) => ändra(ändraZon(skiss, valt.zon.id, { namn: e.target.value }), `namn-${valt.zon.id}`)}
                />
              </label>
              <div className="ark-skiss-falt">
                Färg
                <div className="ark-skiss-farger" role="group" aria-label="Zonens färg">
                  {ZON_FÄRGER.map((f) => (
                    <button
                      key={f}
                      className={`ark-ramar-farg ${valt.zon.färg === f ? "vald" : ""}`}
                      style={{ background: ZON_STIL[f].kant }}
                      onClick={() => ändra(ändraZon(skiss, valt.zon.id, { färg: f }))}
                      title={ZON_STIL[f].namn}
                      aria-label={ZON_STIL[f].namn}
                      aria-pressed={valt.zon.färg === f}
                    />
                  ))}
                </div>
              </div>
              <p className="ark-hint">Flytta zonen i rubriken eller kanten – det som står i den följer med.</p>
            </>
          )}

          {fårÄndra && valt?.typ === "koppling" && (
            <>
              <div className="ark-section-title">Koppling</div>
              <p className="ark-skiss-vag">
                {namnPå(valt.koppling.från)} → {namnPå(valt.koppling.till)}
              </p>
              <label className="ark-skiss-falt">
                Etikett
                <input
                  className="ark-input"
                  value={valt.koppling.etikett ?? ""}
                  placeholder="T.ex. HTTPS 443"
                  onChange={(e) =>
                    ändra(ändraKoppling(skiss, valt.koppling.id, { etikett: e.target.value }), `etikett-${valt.koppling.id}`)
                  }
                />
              </label>
              <div className="ark-skiss-falt">
                Pil
                <div className="ark-toggle" role="group" aria-label="Pil">
                  {(
                    [
                      ["till", "→"],
                      ["båda", "↔"],
                      ["ingen", "—"],
                    ] as [Pil, string][]
                  ).map(([pil, tecken]) => (
                    <button
                      key={pil}
                      className={valt.koppling.pil === pil ? "active" : ""}
                      onClick={() => ändra(ändraKoppling(skiss, valt.koppling.id, { pil }))}
                      aria-label={pil === "till" ? "Pil åt ett håll" : pil === "båda" ? "Pil åt båda håll" : "Ingen pil"}
                    >
                      {tecken}
                    </button>
                  ))}
                </div>
              </div>
              <label className="ark-ramar-val">
                <input
                  type="checkbox"
                  checked={valt.koppling.linje === "streckad"}
                  onChange={(e) => ändra(ändraKoppling(skiss, valt.koppling.id, { linje: e.target.checked ? "streckad" : "hel" }))}
                />
                Streckad linje
              </label>
              <button
                className="ark-btn"
                onClick={() => ändra(ändraKoppling(skiss, valt.koppling.id, { från: valt.koppling.till, till: valt.koppling.från }))}
              >
                ⇄ Vänd riktningen
              </button>
            </>
          )}

          {fårÄndra && markerade.length > 0 && (
            <div className="ark-skiss-knappar">
              {valt?.typ !== "koppling" && (
                <button className="ark-btn" onClick={duplicera} title="Kopiera det markerade (Ctrl+D)">
                  ⧉ Duplicera
                </button>
              )}
              <button className="ark-btn" onClick={taBortMarkerade} title="Ta bort det markerade (Delete)">
                🗑 Ta bort{markerade.length > 1 ? ` (${markerade.length})` : ""}
              </button>
            </div>
          )}

          {fårÄndra && markerade.length === 0 && (
            <>
              <div className="ark-section-title">Skissen</div>
              <label className="ark-skiss-falt">
                Beskrivning
                <textarea
                  className="ark-textarea"
                  rows={4}
                  value={skiss.beskrivning ?? ""}
                  placeholder="Vad visar skissen?"
                  onChange={(e) => ändra({ ...skiss, beskrivning: e.target.value }, "beskrivning")}
                />
              </label>
              {fårDölja && (
                <>
                  <label className="ark-ramar-val">
                    <input type="checkbox" checked={Boolean(skiss.dold)} onChange={(e) => ändra({ ...skiss, dold: e.target.checked })} />
                    Dold för andra än administratörer
                  </label>
                  <p className="ark-hint">
                    {skiss.dold
                      ? "Bara administratörer ser skissen. Gäller när du har sparat."
                      : "Alla inloggade kan se skissen. Bara du och administratörer kan ändra den."}
                  </p>
                </>
              )}
              <p className="ark-hint">
                Lägg till objekt ur raden ovan och dra dem på plats. Markera ett objekt och dra i den blå pilen för att koppla det till
                ett annat. <kbd>Ctrl</kbd>-klick markerar flera, hjulet zoomar, och ett drag på tom yta flyttar vyn.
              </p>
            </>
          )}

          {skiss.skapadAv && (
            <p className="ark-hint ark-skiss-fot">
              Skapad av {skiss.skapadAv.namn} · sparad {new Date(skiss.savedAt).toLocaleString("sv-SE")}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Första sidan: befintliga skisser och en ny                          */
/* ------------------------------------------------------------------ */

function SkissStart(props: {
  lista: SkissSammanfattning[];
  lagring?: SkissStore["kind"];
  fel: string | null;
  fårDölja: boolean;
  onÖppna: (id: string) => void;
  onSkapa: (namn: string, dold: boolean) => void;
}) {
  const [namn, setNamn] = useState("");
  const [dold, setDold] = useState(false);
  const skapa = () => {
    if (!namn.trim()) return;
    props.onSkapa(namn.trim(), dold);
    setNamn("");
    setDold(false);
  };
  return (
    <div className="ark-katalog">
      <div className="ark-katalog-topp">
        <div>
          <h1 className="ark-katalog-rubrik">Systemskiss</h1>
          <p className="ark-katalog-underrubrik">
            Skissa en systemmiljö – servrar, tjänster, databaser och nät – och hur delarna hänger ihop.
          </p>
        </div>
      </div>
      {props.fel && <div className="ark-error">{props.fel}</div>}

      <section className="ark-ramar-ny">
        <h2 className="ark-ramar-h2">Ny systemskiss</h2>
        <div className="ark-skiss-nyrad">
          <input
            className="ark-input"
            value={namn}
            placeholder="Skissens namn, t.ex. Utvecklingsmiljö"
            onChange={(e) => setNamn(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && skapa()}
            aria-label="Skissens namn"
          />
          {props.fårDölja && (
            <label className="ark-ramar-val" title="Bara administratörer ser skissen. Går att ändra senare.">
              <input type="checkbox" checked={dold} onChange={(e) => setDold(e.target.checked)} />
              Dold för andra än administratörer
            </label>
          )}
          <button className="ark-btn ark-btn--primary" disabled={!namn.trim()} onClick={skapa}>
            Skapa
          </button>
        </div>
      </section>

      <h2 className="ark-ramar-h2">Sparade systemskisser</h2>
      {props.lista.length === 0 ? (
        <p className="ark-katalog-hjalp">Inga systemskisser ännu.</p>
      ) : (
        <div className="ark-kortrutnat">
          {props.lista.map((s) => (
            <button key={s.id} className="ark-kort" onClick={() => props.onÖppna(s.id)}>
              <span className="ark-kort-titel">
                {s.dold && (
                  <span title="Dold för andra än administratörer" aria-label="Dold">
                    🔒{" "}
                  </span>
                )}
                {s.namn}
              </span>
              <span className="ark-kort-meta">
                {s.antalObjekt} objekt{s.skapadAv ? ` · ${s.skapadAv.namn}` : ""}
                {s.dold ? " · dold" : ""}
              </span>
              <span className="ark-kort-tid">{new Date(s.savedAt).toLocaleString("sv-SE")}</span>
            </button>
          ))}
        </div>
      )}
      {props.lagring === "local" && (
        <p className="ark-hint">Bryggan svarar inte – skisserna sparas i webbläsaren tills servern kör.</p>
      )}
    </div>
  );
}
