/**
 * AppShell – plattformsskalet: en smal meny och en huvudyta.
 *
 * NAVIGERINGSMODELLEN, och varför den ser ut så här:
 *
 * Menyn var tidigare hela navigeringen. Under varje verktyg låg dess flöden i
 * ett träd (kategori → ärendetyp → målgrupp → flöde), trettio rader i en 300 px
 * mörk spalt. Indelningen var rätt men platsen fel: en rad rymde ett avhugget
 * namn och ingenting annat, och den som öppnade appen möttes av ett inläst
 * exempel mitt i en panel med sexton inställningar – utan att någonstans ha
 * blivit tillfrågad vad hon ville göra.
 *
 * Nu ställs den frågan först, och den har två svar:
 *   1. Skapa en ny process  → vyn `NyProcess`
 *   2. Titta på befintliga  → `ProcessKatalog`, som fått hela huvudytan
 *
 * Menyn bär de två vägarna och STRUKTUREN – inget annat. Den hade en lista
 * över verktygen längst ner också, men den listade i praktiken samma namn som
 * trädets översta nivå ("Flödesschema" / "Affärsprocess" mot
 * "Systemprocesser" / "Affärsprocess") och läste därför som en andra,
 * konkurrerande meny i samma spalt. Verktyget väljer man när man skapar något
 * nytt, och ett sparat flöde bär sitt verktyg i id:t.
 *
 * INGENTING AVMONTERAS när man växlar mellan arbetsytan och katalogen. Båda
 * ligger kvar och döljs med `visibility`, av två skäl:
 *
 *  - Ett verktyg som plockades ner hade tagit med sig osparade ändringar i
 *    fallet, och "titta snabbt i katalogen" är just den handling som aldrig får
 *    kosta arbete.
 *  - En katalog som plockades ner glömde sökning, filter och var man skrollat.
 *    Man kom tillbaka till toppen av en onämnd lista och fick leta upp sin
 *    plats igen, varje gång. Det var det som gjorde växlingen osmidig.
 *
 * `visibility` och inte `display`: en ruta med `display: none` mäter noll
 * pixlar, och då tappar både React Flow sin zoom och katalogen sin skrollning.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIVE_FLOW_CHANGED,
  FLOWS_CHANGED,
  döpOmGren,
  flyttaTillYta,
  getFlowStore,
  meddelaFlödenÄndrade,
  sättPlacering,
  type Placering,
  type FlowSummary,
} from "@/core/flow-store";
import {
  TOOLS,
  verktygFörFlöde,
  type Arbetsläge,
  type NyProcessBegäran,
  type ÖppnaFlöde,
} from "./tools";
import { Processträd } from "./Processtrad";
import { Startvy } from "./Startvy";
import { NyProcess } from "./NyProcess";
import { KostnadsDialog } from "./KostnadsDialog";
import { ProcessKatalog } from "./ProcessKatalog";
import { kategoriTitlar, underkategoriTitlar } from "@/core/flow-tree";
import { läsSenaste, minnsFlöde, type SenastPost } from "./senaste";
import { läsProcessLänk, processLänk } from "./lank";
import { RamVy } from "@/tools/ramar/RamVy";
import { RAMAR_CHANGED, getRamStore } from "@/core/ram-store";
import type { RamserieSammanfattning } from "@/core/ram";
import type { Yta } from "@/core/behorighet";
import { Kontorad, useAnvändare } from "./Inloggning";
import { OrgMärke, useUtseende } from "./OrgMarke";

/** Menyns bredd minns mellan sessioner – den som drar ut den vill ha den kvar. */
const BREDD_NYCKEL = "ark.menybredd";
const MIN_BREDD = 200;
const MAX_BREDD = 400;
const STANDARD_BREDD = 248;

/** Vilken av huvudytans vyer som visas. `verktyg` = arbetsytan, utan överlägg. */
type Vy = "start" | "ny" | "katalog" | "ramar" | "verktyg";

export function AppShell() {
  const användare = useAnvändare();
  const [vy, setVy] = useState<Vy>("start");
  /** Verktyget arbetsytan visar. Bara ETT åt gången, men alla besökta lever kvar. */
  const [activeId, setActiveId] = useState(TOOLS[0].id);
  /**
   * Verktyg som någonsin öppnats. Bara de monteras – annars hade båda
   * verktygens ritytor byggts upp direkt vid start, för en användare som
   * kanske bara tänkte titta i katalogen.
   */
  const [monterade, setMonterade] = useState<string[]>([]);
  /** Flödet menyn bett verktyget öppna (per verktyg, så valet inte läcker). */
  const [öppna, setÖppna] = useState<Record<string, ÖppnaFlöde>>({});
  /** Begäran om en ny process (per verktyg, av samma skäl). */
  const [nya, setNya] = useState<Record<string, NyProcessBegäran>>({});
  const [flöden, setFlöden] = useState<FlowSummary[]>([]);
  const [laddar, setLaddar] = useState(true);
  const [senaste, setSenaste] = useState<SenastPost[]>(() => läsSenaste());
  /**
   * Flödet som det aktiva verktyget faktiskt redigerar. Verktyget säger till
   * (ACTIVE_FLOW_CHANGED) oavsett om flödet öppnades i katalogen eller i
   * verktyget självt – markeringen ska visa var man ÄR, inte vad man senast
   * klickade på.
   */
  const [aktivtFlöde, setAktivtFlöde] = useState<string | null>(null);
  /**
   * Läser man eller redigerar man? Att ÖPPNA något är inte att börja ändra i
   * det: man går oftast in i en process för att titta, och då ska varken
   * ritverktygen ligga framme eller strukturen vara undanfälld.
   */
  const [läge, setLäge] = useState<Arbetsläge>("läser");
  /**
   * Ramarna monteras först när man går dit, och ligger sedan kvar – en serie
   * man arbetar på ska inte tappas för att man tittade i katalogen.
   */
  const [ramarMonterade, setRamarMonterade] = useState(false);
  /** Ramserien ett verktyg bett Ramar öppna. `nonce` som för flödena. */
  const [ramserie, setRamserie] = useState<ÖppnaFlöde | null>(null);
  const öppnaRamserie = useCallback((id: string) => {
    setRamserie((r) => ({ id, nonce: (r?.nonce ?? 0) + 1 }));
    setVy("ramar");
  }, []);
  useEffect(() => {
    if (vy === "ramar") setRamarMonterade(true);
  }, [vy]);
  /**
   * Visualiseringarnas lista – verktygen behöver den för knappen "Öppna i
   * Visualisering". Läses om när en serie sparas eller tas bort.
   */
  const [ramserier, setRamserier] = useState<RamserieSammanfattning[]>([]);
  useEffect(() => {
    const läs = async () => {
      try {
        setRamserier(await (await getRamStore()).list());
      } catch {
        setRamserier([]);
      }
    };
    void läs();
    window.addEventListener(RAMAR_CHANGED, läs);
    return () => window.removeEventListener(RAMAR_CHANGED, läs);
  }, []);
  const utseende = useUtseende();
  const [bredd, setBredd] = useState(() => {
    const sparad = Number(localStorage.getItem(BREDD_NYCKEL));
    return Number.isFinite(sparad) && sparad >= MIN_BREDD
      ? Math.min(sparad, MAX_BREDD)
      : STANDARD_BREDD;
  });
  /** Egen dragning av bredden – samma vakter som canvasens handtag. */
  const drar = useRef(false);

  const läsFlöden = useCallback(async () => {
    try {
      const store = await getFlowStore();
      setFlöden(await store.list());
    } catch {
      // Biblioteket kan saknas (statisk build utan brygga) – katalogen visar
      // då tomt, precis som förut.
      setFlöden([]);
    } finally {
      setLaddar(false);
    }
  }, []);

  useEffect(() => {
    void läsFlöden();
    // Verktygen säger till när något sparats eller raderats.
    window.addEventListener(FLOWS_CHANGED, läsFlöden);
    return () => window.removeEventListener(FLOWS_CHANGED, läsFlöden);
  }, [läsFlöden]);

  useEffect(() => {
    const lyssna = (e: Event) => setAktivtFlöde((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(ACTIVE_FLOW_CHANGED, lyssna);
    return () => window.removeEventListener(ACTIVE_FLOW_CHANGED, lyssna);
  }, []);

  useEffect(() => {
    localStorage.setItem(BREDD_NYCKEL, String(bredd));
  }, [bredd]);

  const onDragDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // bara vänsterknappen
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drar.current = true;
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drar.current) return; // bara vår EGEN dragning
    if (!(e.buttons & 1)) return; // bara medan knappen hålls
    setBredd(Math.min(MAX_BREDD, Math.max(MIN_BREDD, e.clientX)));
  };
  const onDragUp = (e: React.PointerEvent) => {
    drar.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  /** Namn per id – "senast öppnade" ska visa aktuellt namn, inte det vid besöket. */
  const namnFörId = useMemo(
    () => new Map(flöden.map((f) => [f.id, f.name] as const)),
    [flöden],
  );

  /**
   * Processen skalet just bett ett verktyg öppna. Verktyget säger till först
   * när den är inläst (ACTIVE_FLOW_CHANGED); under tiden är det DEN adressen
   * ska peka på, inte den process som låg där förut.
   */
  const väntadProcess = useRef<string | null>(null);

  const montera = useCallback((toolId: string, nyttLäge: Arbetsläge) => {
    setMonterade((m) => (m.includes(toolId) ? m : [...m, toolId]));
    setActiveId(toolId);
    setLäge(nyttLäge);
    setVy("verktyg");
  }, []);

  /**
   * Öppnar ett sparat flöde i det verktyg som äger det. Vilket verktyg det är
   * avgörs av id:t (familjeprefixet), inte av vad som råkar vara aktivt – ett
   * affärsprocess öppnad ur katalogen ska landa i Affärsprocess även om man stod i
   * flödesschemat.
   */
  const öppnaFlöde = useCallback(
    (id: string) => {
      const verktyg = verktygFörFlöde(id);
      if (!verktyg?.render) return;
      väntadProcess.current = id;
      setÖppna((o) => ({ ...o, [verktyg.id]: { id, nonce: (o[verktyg.id]?.nonce ?? 0) + 1 } }));
      setSenaste(minnsFlöde(id, namnFörId.get(id) ?? id));
      // Att öppna är att LÄSA. Vill man ändra säger man till.
      montera(verktyg.id, "läser");
    },
    [montera, namnFörId],
  );

  /* ---------------------------------------------------------------- */
  /* Adressen följer processen (se lank.ts)                            */
  /* ---------------------------------------------------------------- */

  /** Processen som visas på arbetsytan – det adressen ska peka på. */
  const visad = vy === "verktyg" ? (väntadProcess.current ?? aktivtFlöde) : null;
  if (väntadProcess.current && väntadProcess.current === aktivtFlöde) väntadProcess.current = null;

  /** Har länken man kom in på hunnit läsas? Före det är adressen KÄLLAN. */
  const startlänkLäst = useRef(false);

  /**
   * Tillstånd → adress. Ett byte av process läggs i historiken, så att
   * bakåtknappen går till det man tittade på nyss.
   */
  useEffect(() => {
    // En länk som väntar på att öppnas får inte skrivas över av startsidan.
    if (!startlänkLäst.current) return;
    if (visad === läsProcessLänk(location.hash)) return;
    history.pushState(null, "", processLänk(visad) || location.pathname + location.search);
  }, [visad]);

  /** Adress → tillstånd: länken man kom in på, och bakåt/framåt i webbläsaren. */
  const följAdressen = useCallback(() => {
    const id = läsProcessLänk(location.hash);
    if (!id) {
      // Bakåt till en adress utan process = tillbaka till där man var innan.
      // Mitt i en redigering lämnar vi arbetsytan ifred.
      if (lägeRef.current !== "redigerar") setVy((v) => (v === "verktyg" ? "start" : v));
      else history.replaceState(null, "", processLänk(visadRef.current) || location.pathname + location.search);
      return;
    }
    if (id === visadRef.current) return;
    // Att följa en länk laddar processen från lagringen. Det får inte ske
    // ovanpå en pågående redigering, och en okänd eller borttagen process går
    // inte att öppna – då står man kvar, och adressen rättas till det som visas.
    if (lägeRef.current === "redigerar" || !flödenRef.current.some((f) => f.id === id)) {
      history.replaceState(null, "", processLänk(visadRef.current) || location.pathname + location.search);
      return;
    }
    öppnaFlöde(id);
  }, [öppnaFlöde]);

  const visadRef = useRef(visad);
  visadRef.current = visad;
  const lägeRef = useRef(läge);
  lägeRef.current = läge;
  const flödenRef = useRef(flöden);
  flödenRef.current = flöden;

  useEffect(() => {
    window.addEventListener("popstate", följAdressen);
    window.addEventListener("hashchange", följAdressen);
    return () => {
      window.removeEventListener("popstate", följAdressen);
      window.removeEventListener("hashchange", följAdressen);
    };
  }, [följAdressen]);

  /** Länken man kom in på öppnas när biblioteket är läst – en gång. */
  useEffect(() => {
    if (laddar || startlänkLäst.current) return;
    startlänkLäst.current = true;
    följAdressen();
  }, [laddar, följAdressen]);

  /**
   * KATALOGEN ÄGER STRUKTUREN. Den ser den, alltså ska den kunna ändra den –
   * men den rör aldrig lagringen själv: skalet äger listan och vet när den ska
   * läsas om, precis som för sparningarna.
   */
  const flyttaFlöde = useCallback(
    async (id: string, placering: Placering, till?: Yta) => {
      const store = await getFlowStore();
      // Till en annan yta (Mina processer → gemensam katalog) går bytet genom
      // bryggan, som ensam får skriva ägaren. Inom ytan är det en vanlig flytt.
      if (till) await flyttaTillYta(store, id, till, placering, { id: användare.id, namn: användare.namn });
      else await sättPlacering(store, id, placering);
      meddelaFlödenÄndrade();
    },
    [användare],
  );

  const döpOmGrenen = useCallback(async (ids: string[], ändring: Placering) => {
    const store = await getFlowStore();
    await döpOmGren(store, ids, ändring);
    meddelaFlödenÄndrade();
  }, []);

  const nyNonce = useRef(0);
  const skapaProcess = useCallback(
    (toolId: string, begäran: Omit<NyProcessBegäran, "nonce">) => {
      nyNonce.current += 1;
      const nonce = nyNonce.current;
      setNya((n) => ({ ...n, [toolId]: { ...begäran, nonce } }));
      // En ny process finns bara för att den ska ritas – där är redigering
      // hela poängen, och att först behöva trycka "Redigera" vore ett steg
      // utan innehåll.
      montera(toolId, "redigerar");
    },
    [montera],
  );

  /**
   * Verktyget har tagit emot begäran – den släpps. Nonce-räkningen lever kvar
   * i en ref, så att nästa begäran ändå får ett nytt nummer.
   */
  const släppNyProcess = useCallback((toolId: string) => {
    setNya((n) => {
      if (!n[toolId]) return n;
      const { [toolId]: _, ...kvar } = n;
      return kvar;
    });
  }, []);

  const aktivtNamn = aktivtFlöde ? (namnFörId.get(aktivtFlöde) ?? null) : null;
  const harArbete = monterade.length > 0;
  /**
   * Strukturen står till vänster HELA TIDEN – utom under en redigering.
   *
   * Den låg först bara i läsläge, och då fick man öppna en process för att över
   * huvud taget få se vad biblioteket innehöll. Nivåerna är infällda från
   * början, så menyn visar samlingarna (Systemprocesser, Affärsprocess) och man fäller ut
   * vidare nedåt själv – strukturen syns utan att den tar plats.
   *
   * Undantaget är redigeringen: där är en lista över alla andra processer bara
   * något att råka klicka bort sitt arbete med.
   */
  const visaTrädet = !(vy === "verktyg" && läge === "redigerar");

  return (
    <div className="ark-shell" style={{ ["--ark-menybredd" as string]: `${bredd}px` }}>
      <KostnadsDialog />
      <nav className="ark-sidebar">
        <button className="ark-brand" onClick={() => setVy("start")} title="Till startsidan">
          <OrgMärke utseende={utseende} />
          <span className="ark-brand-text">
            <span className="ark-brand-name">Arkitekten</span>
            <span className="ark-brand-sub" title={utseende.namn}>
              {utseende.kortnamn ?? utseende.namn ?? "Processritaren"}
            </span>
          </span>
        </button>

        <button className="ark-btn ark-btn--primary ark-meny-ny" onClick={() => setVy("ny")}>
          ✚ Ny process
        </button>

        <div className="ark-meny-nav">
          <button
            className={`ark-navval ${vy === "katalog" ? "active" : ""}`}
            onClick={() => setVy("katalog")}
          >
            <span className="ark-navval-ikon" aria-hidden>
              ▤
            </span>
            Processkatalog
            {flöden.length > 0 && <span className="ark-navval-antal">{flöden.length}</span>}
          </button>
          <button
            className={`ark-navval ${vy === "ramar" ? "active" : ""}`}
            onClick={() => setVy("ramar")}
            title="Berätta en befintlig process i bilder"
          >
            <span className="ark-navval-ikon" aria-hidden>
              ▣
            </span>
            Visualisering
          </button>
          {/* Vägen TILLBAKA till arbetet. Utan den kan katalogen bli en
              återvändsgränd: verktyget lever kvar under överlägget, men det
              syns inte, och man tror att man tappat det man ritade. */}
          {harArbete && (
            <button
              className={`ark-navval ${vy === "verktyg" ? "active" : ""}`}
              onClick={() => setVy("verktyg")}
              title={aktivtNamn ?? "Arbetsytan"}
            >
              <span className="ark-navval-ikon" aria-hidden>
                ✎
              </span>
              <span className="ark-navval-namn">{aktivtNamn ?? "Arbetsytan"}</span>
            </button>
          )}
        </div>

        {visaTrädet && (
          <Processträd flöden={flöden} aktivtFlöde={aktivtFlöde} onÖppna={öppnaFlöde} />
        )}

        <Kontorad />
        <div className="ark-sidebar-foot">Deterministisk kärna · AI:n fyller bara mellanlagret</div>
      </nav>

      {/* Dra i kanten för att bredda menyn – långa flödesnamn behöver plats. */}
      <div
        className="ark-sidebar-drag"
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
        onDoubleClick={() => setBredd(STANDARD_BREDD)}
        title="Dra för att ändra menyns bredd · dubbelklick återställer"
      />

      <section className="ark-content">
        {/* Arbetsytan ligger underst och lever hela sessionen.
            DÖLJS HELT när en vy ligger över: annars stack verktygsraden,
            rubriken och ritytans egen palett upp genom överlägget (de har egna
            z-index) och man satt med ritverktyg i handen mitt i katalogen. */}
        <div
          className={`ark-verktygsyta ${vy === "verktyg" ? "" : "dold"}`}
          aria-hidden={vy !== "verktyg"}
        >
          {monterade.map((id) => {
            const t = TOOLS.find((x) => x.id === id);
            if (!t?.render) return null;
            return (
              <div
                key={id}
                className="ark-verktygslager"
                style={{ visibility: id === activeId ? "visible" : "hidden" }}
                aria-hidden={id !== activeId}
              >
                {t.render({
                  öppnaFlöde: öppna[id] ?? null,
                  nyProcess: nya[id] ?? null,
                  onNyProcessMottagen: () => släppNyProcess(id),
                  läge,
                  onLäge: setLäge,
                  flöden,
                  onFlytta: flyttaFlöde,
                  onÖppnaFlöde: öppnaFlöde,
                  onÖppnaRamserie: öppnaRamserie,
                  ramserier,
                })}
              </div>
            );
          })}
          {!harArbete && (
            <div className="ark-empty">
              Ingen process är öppen. Välj en i katalogen eller skapa en ny.
            </div>
          )}
        </div>

        {vy === "start" && (
          <div className="ark-vy-overlay">
            <Startvy
              antal={flöden.length}
              senaste={senaste.map((p) => ({ ...p, namn: namnFörId.get(p.id) ?? p.namn }))}
              onNy={() => setVy("ny")}
              onKatalog={() => setVy("katalog")}
              onÖppna={öppnaFlöde}
            />
          </div>
        )}

        {vy === "ny" && (
          <div className="ark-vy-overlay">
            <NyProcess
              taget={flöden.map((f) => f.name)}
              kategorier={kategoriTitlar(flöden)}
              underkategorier={(kat) => underkategoriTitlar(flöden, kat)}
              onSkapa={skapaProcess}
              onAvbryt={() => setVy(harArbete ? "verktyg" : "start")}
            />
          </div>
        )}

        {/* Katalogen monteras EN gång och döljs när den inte visas – det är
            det som gör att man kommer tillbaka till samma sökning, samma
            filter och samma ställe i listan. */}
        <div
          className={`ark-vy-overlay ${vy === "katalog" ? "" : "dold"}`}
          aria-hidden={vy !== "katalog"}
        >
          <ProcessKatalog
            flöden={flöden}
            laddar={laddar}
            onFlytta={flyttaFlöde}
            onDöpOmGren={döpOmGrenen}
            aktivtFlöde={aktivtFlöde}
            onÖppna={öppnaFlöde}
            onNy={() => setVy("ny")}
          />
        </div>

        {ramarMonterade && (
          <div
            className={`ark-vy-overlay ${vy === "ramar" ? "" : "dold"}`}
            aria-hidden={vy !== "ramar"}
          >
            <RamVy flöden={flöden} öppnaSerie={ramserie} />
          </div>
        )}
      </section>
    </div>
  );
}
