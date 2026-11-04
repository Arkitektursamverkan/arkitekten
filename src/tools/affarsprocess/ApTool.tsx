/**
 * Affärsprocess – ett EGET verktyg i Arkitekten, i nivå med
 * Flödesschema. Ritar processer som affärsprocesser: vågrät
 * kedja verksamhetsobjekt → aktivitet → verksamhetsobjekt, regler som
 * frågor, satelliter (roller med HUKI, IT-stöd, krav, tid) över/under
 * aktiviteterna. Inga simbanor.
 *
 * Samma pipeline-princip som flödesschemat men egen väg:
 *   beskrivning (rå eller AI) → ProcessDraft → compileAp → layoutAp → ApView/SVG
 *
 * Motorn delas med plattformen (parser, AI-brygga, historik, lagring);
 * verktyget är självständigt i UI:t och har ett EGET bibliotek
 * (id-prefix "ap-" i den delade lagringen).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileAp, idEfterLyft, lyftUtChecklistor, sättRutin, type ApNodeKind } from "@/core/affarsprocess";
import { apFigurer } from "./figurer";
import { Figurförteckning } from "@/shell/Figurforteckning";
import {
  etikettHinder,
  setAutoPosition,
  setEdgeLabel,
  setEdgeSides,
  setEdgeWaypoint,
  setEdgeWaypoint2,
  setPresentationsKoppling,
  setPresentationsLäge,
  setStepPosition,
  type ProcessDraft,
} from "@/core/draft";
import type { EdgeSide } from "@/core/model";
import {
  AP_FLOW_PREFIX,
  flowId as idUrNamn,
  getFlowStore,
  meddelaAktivtFlöde,
  type SavedFlow,
} from "@/core/flow-store";
import { nuvarandeBeteckning, nuvarandeStatus, senasteFastslagna } from "@/core/status";
import { revisionAvVersion } from "../flowchart/export/revision";
import type { NyProcessBegäran, VerktygsProps } from "@/shell/tools";
import { ärNyBegäran } from "@/shell/begaran";
import { FlowHeader } from "@/shell/FlowHeader";
import { FlyttaKnapp } from "@/shell/FlyttaKnapp";
import {
  göraOm,
  kanGöraOm,
  kanÅngra,
  lägg,
  läggBrytpunkt,
  skapaHistorik,
  ångra,
} from "@/core/history";
import { requestClaudeCodeDraft } from "../flowchart/ai/bridge";
import { useAiVäg, väntarText } from "../flowchart/ai/useAiVag";
import { VidareInstruktioner } from "../flowchart/VidareInstruktioner";
import { rätaUppKopplingar } from "./rata-upp";
import { copySvgAsPng } from "../flowchart/export/clipboard";
import { DraftPanel } from "../flowchart/DraftPanel";
import { FlowLibrary, type FlowLibraryHandle } from "../flowchart/FlowLibrary";
import { PAGE_FORMATS, wordPointSize, type PageFormatId } from "../flowchart/layout/layout";
import { textToDraft } from "../flowchart/parser/toDraft";
import {
  Rullgardin,
  RullgardinDel,
  VradGrupp,
  VradKnapp,
  Verktygsrad,
} from "@/shell/Verktygsrad";
import { ApCanvas } from "./ApCanvas";
import { ApInspector } from "./ApInspector";
import { RutinVy } from "./RutinVy";
import { begärRutin } from "./ai-rutin";
import { ApPalett } from "./ApPalett";
import { knytIhop, läggTillObjekt } from "./lagg-till";
import { granskaAp, sammanfattaKontroll } from "./kontroll";
import { layoutAp } from "./layout-affarsprocess";
import { renderApSvg } from "./svg-affarsprocess";
import { PRESENTATIONSKATEGORI } from "@/tools/ramar/avskalad";
import { AvskaladVy } from "@/tools/ramar/AvskaladVy";
import { apUnderlag } from "@/tools/ramar/ai-presentation";
import { PresentationsKnapp } from "@/tools/ramar/PresentationsKnapp";
import { PubliceraKnapp } from "./Publicera";
import { useBehörighet } from "@/shell/behorighet-hook";
import { ÖppnaVisualisering } from "@/tools/ramar/OppnaVisualisering";
import { laddaNerBmt, useBmtMall } from "./bmt-export";

const PAGE_ORDER: PageFormatId[] = ["word", "free", "wide", "a4l"];

// Ansökningarna är ANNONSERINGENS resultat – [Ut: …] på steget som skapar
// dem, inte [In: …] på steget som förbrukar dem. Med [In:] fick exemplet ett
// objekt som uppstod ur tomma intet, utan koppling från något som producerar
// det, och kedjan gick sönder mitt i. [In: …] är till
// för objekt som kommer UTIFRÅN processen.
const EXAMPLE = `Rekrytera medarbetare
Behov av rekrytering uppstår → Skapa kravprofil [Roll: Rekryterande chef U] [Krav: Kompetensbaserad rekrytering] → Annonsera tjänst [Roll: HR U] [IT: ReachMee] [Ut: Ansökningar] → Genomför urval [Roll: Rekryterande chef H, HR K] [Krav: Öka mångfald] (↓ Om kandidat godkänd → Lämna anställningserbjudande [Roll: Rekryterande chef U] [Tid: Inom 5 dagar]) → Avsluta rekrytering [IT: ReachMee]`;

/** Märker en draft som affärsprocess – valet följer med när flödet sparas och öppnas. */
function somAp(d: ProcessDraft): ProcessDraft {
  return { ...d, diagramType: "affarsprocess" };
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ApTool({
  öppnaFlöde = null,
  nyProcess = null,
  läge = "läser",
  flöden = [],
  onFlytta,
  onLäge,
  onNyProcessMottagen,
  onÖppnaFlöde,
  onÖppnaRamserie,
  ramserier = [],
}: Partial<VerktygsProps> = {}) {
  /** Läsläge: ritytan låst, ritverktygen borta. Se `Arbetsläge` i shell/tools.tsx. */
  const läser = läge === "läser";
  const [rawText, setRawText] = useState(EXAMPLE);
  const [aiText, setAiText] = useState("");
  const [tab, setTab] = useState<"raw" | "ai">("raw");
  const aiVäg = useAiVäg();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  /**
   * AI-beskrivningen SÅ SOM DEN SÅG UT när den kom (eller senast tolkades om).
   *
   * "Använd AI-beskrivningen" kör texten genom REGELMOTORN. Är texten oförändrad
   * sedan tolkningen finns det ingenting att tillämpa – regelmotorn kommer fram
   * till samma steg som redan står på skärmen – men den kan inte veta vilka
   * BANOR AI:n valde, för pilformatet bär ingen bana. Trycket såg alltså ut att
   * göra ingenting, och det lilla det gjorde var en försämring: flödet flyttades
   * till standardbanan. Knappen är därför bara aktiv när texten faktiskt ändrats.
   */
  const [aiTextTolkad, setAiTextTolkad] = useState("");
  /** Kvittens efter en tillämpning – annars läses ett tryck som verkningslöst. */
  const [aiKvittens, setAiKvittens] = useState<string | null>(null);
  /** Se FlowchartTool: bara en ÄNDRAD beskrivning har något att tillämpa. */
  const aiTextÄndrad = Boolean(aiText.trim()) && aiText.trim() !== aiTextTolkad.trim();
  const [bridgeAbort, setBridgeAbort] = useState<AbortController | null>(null);

  const [historik, setHistorik] = useState(() => skapaHistorik(somAp(textToDraft(EXAMPLE))));
  const draft = historik.nuvarande;
  const setDraft = useCallback((uppdatering: ProcessDraft | ((d: ProcessDraft) => ProcessDraft)) => {
    setHistorik((h) => {
      const nästa = typeof uppdatering === "function" ? uppdatering(h.nuvarande) : uppdatering;
      return lägg(h, somAp(nästa), performance.now());
    });
  }, []);
  const setDraftBrytpunkt = useCallback((nästa: ProcessDraft) => {
    setHistorik((h) => läggBrytpunkt(h, somAp(nästa), performance.now()));
  }, []);

  // Fri är standard: ett nytt flöde ska visas HELT, inte styckat i delar av
  // en sidbredd man ännu inte bett om. Word/A4 väljs när figuren ska ut i ett
  // dokument. Ett sparat flöde behåller alltid sitt egna val.
  const [pageFormat, setPageFormat] = useState<PageFormatId>("free");
  const [scale, setScale] = useState(1);
  const [spacing, setSpacing] = useState(1);
  const [textScale, setTextScale] = useState(1);
  const [showDraft, setShowDraft] = useState(false);

  const [flowName, setFlowName] = useState("Ny process");
  /** Id:t på processen som redigeras (null = inte sparad än). Se FlowchartTool. */
  /**
   * Kategorin i katalogen. Bor bredvid namnet och inte i draften: att flytta en
   * process mellan samlingar är inte en ny version av processen.
   */
  const [kategori, setKategori] = useState("");
  /** Underkategorin i katalogen – nivån under kategorin. Se flow-tree.ts. */
  const [underkategori, setUnderkategori] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  // Skalets meny markerar processen som redigeras – oavsett var den öppnades.
  useEffect(() => {
    meddelaAktivtFlöde(flowId);
  }, [flowId]);
  /**
   * Samma id som en ref: AI-svaret kommer minuter efter att tolkningen
   * begärdes, och då ska det vara DAGENS flöde som avgör om det sparas.
   */
  const flowIdRef = useRef<string | null>(null);
  flowIdRef.current = flowId;
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() =>
    JSON.stringify({ rawText: EXAMPLE, aiText: "", draft: somAp(textToDraft(EXAMPLE)) }),
  );
  const snapshot = useMemo(() => JSON.stringify({ rawText, aiText, draft }), [rawText, aiText, draft]);
  const dirty = savedSnapshot !== snapshot;

  /**
   * Det sparade flödet med hela historiken – statusen, numreringen och den
   * fastslagna versionens innehåll räknas alla fram ur den. Samma upplägg som
   * i FlowchartTool, med avsikt: svaret på "vilken version är det här?" ska se
   * likadant ut i hela appen.
   */
  const [sparatFlöde, setSparatFlöde] = useState<SavedFlow | null>(null);
  const fastslagen = useMemo(() => senasteFastslagna(sparatFlöde?.versions ?? []), [sparatFlöde]);
  const nuStatus = nuvarandeStatus(sparatFlöde?.versions ?? []);
  /** Se FlowchartTool: valet gäller BARA exporten, aldrig ritytan. */
  const [exportKälla, setExportKälla] = useState<"aktuell" | "fastslagen">("aktuell");
  const exporterarFastslagen = exportKälla === "fastslagen" && fastslagen !== null;

  const openFlow = useCallback(
    (flow: SavedFlow) => {
      setRawText(flow.rawText);
      setAiText(flow.aiText ?? "");
    setAiTextTolkad(flow.aiText ?? "");
      setDraftBrytpunkt(flow.draft);
      setFlowName(flow.name);
      setFlowId(flow.id);
      if (flow.view) {
        setPageFormat((flow.view.pageFormat as PageFormatId) ?? "free");
        setScale(flow.view.scale ?? 1);
        setSpacing(flow.view.spacing ?? 1);
        setTextScale(flow.view.textScale ?? 1);
      }
      setSparatFlöde(flow);
      setExportKälla("aktuell");
      setTab(flow.aiText ? "ai" : "raw");
      setAiError(null);
      setSavedSnapshot(
        JSON.stringify({ rawText: flow.rawText, aiText: flow.aiText ?? "", draft: somAp(flow.draft) }),
      );
    },
    [setDraftBrytpunkt],
  );

/**
 * Menyn i skalet kan be verktyget öppna ett sparat flöde. Laddningen sker HÄR
 * och går genom samma `openFlow` som biblioteket i panelen, så hela kedjan
 * (råtext, mellanlager, vyinställningar) återställs i ett svep.
 */
  const öppnad = useRef<number | null>(null);
  useEffect(() => {
    // Samma skäl som för en ny process: en omkörd effekt får inte läsa om
    // flödet från disk och kasta det som ligger osparat i editorn.
    if (!ärNyBegäran(öppnaFlöde, öppnad)) return;
    const begärt = öppnaFlöde!;
    void (async () => {
      try {
        const store = await getFlowStore();
        const flow = await store.load(begärt.id);
        // Den SENASTE begäran gäller – en långsam läsning av ett flöde man
        // redan lämnat får inte lägga sig över det man öppnade efteråt.
        if (öppnad.current === begärt.nonce) openFlow(flow);
      } catch {
        // Ett flöde som försvunnit ur lagringen ska inte krascha verktyget.
      }
    })();
  }, [öppnaFlöde, openFlow]);

  const newFlow = useCallback(() => {
    if (dirty && !confirm("Du har osparade ändringar. Börja på en ny process ändå?")) return;
    const tom = "Ny process\n";
    const tomDraft = somAp(textToDraft(tom));
    setRawText(tom);
    setAiText("");
    setAiTextTolkad("");
    setDraftBrytpunkt(tomDraft);
    setFlowName("Ny process");
    setKategori("");
    setFlowId(null); // finns inte i biblioteket än
    setSparatFlöde(null);
    setExportKälla("aktuell");
    setTab("raw");
    setAiError(null);
    setSavedSnapshot(JSON.stringify({ rawText: tom, aiText: "", draft: tomDraft }));
  }, [dirty, setDraftBrytpunkt]);

  /** Tolka beskrivningen med regelmotorn (ingen AI). */
  const generateFromRules = useCallback(() => {
    setDraftBrytpunkt(textToDraft(rawText));
  }, [rawText, setDraftBrytpunkt]);

  /** Tolka om AI-beskrivningen efter manuell redigering. */
  const generateFromAiText = useCallback(() => {
    const d = textToDraft(aiText);
    d.meta.aiText = aiText;
    d.meta.sourceText = rawText;
    d.meta.origin = "ai";
    setDraftBrytpunkt(d);
    setAiTextTolkad(aiText);
    setAiKvittens(`Diagrammet byggdes om ur beskrivningen · ${d.steps.length} steg`);
    setTimeout(() => setAiKvittens(null), 4000);
  }, [aiText, rawText, setDraftBrytpunkt]);

  /** Be AI:n tolka via bryggan – samma brevlåda som flödesschemat. */
  /**
   * `instruktion` = "Vidare instruktioner till AI" – se FlowchartTool.
   * Svarar sant när tolkningen kom tillbaka.
   */
  const runBridge = useCallback(async (text?: string, instruktion?: string): Promise<boolean> => {
    const ctrl = new AbortController();
    setBridgeAbort(ctrl);
    setAiBusy(true);
    setAiError(null);
    try {
      // Texten kan skickas med – en ny process tolkas i samma andetag som den
      // skapas, och då har `rawText` ännu inte hunnit bli tillstånd.
      // diagramType: affärsprocessen har egna husregler – utan den här
      // markeringen tolkade bryggan begäran som ett flödesschema och svaret
      // kom tillbaka utan satelliter och utan förädlingskedja.
      const d = await requestClaudeCodeDraft({
        rawText: text ?? rawText,
        diagramType: "affarsprocess",
        instruction: instruktion,
        signal: ctrl.signal,
      });
      setDraftBrytpunkt(d);
      setAiText(d.meta.aiText ?? "");
      setAiTextTolkad(d.meta.aiText ?? "");
      setTab("ai");
      // En tolkning är en ny version av processen – den sparas som en sådan,
      // utan att man måste komma ihåg att trycka Spara. Bara för en process
      // som redan finns i biblioteket: exempeltexten ska inte bli en post.
      if (flowIdRef.current) setSparaNyProcess(true);
      return true;
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setAiBusy(false);
      setBridgeAbort(null);
    }
  }, [rawText, setDraftBrytpunkt]);

  /**
   * Startar en process som beställts i vyn "Ny process". Samma resonemang som i
   * flödesschemat: vyn samlar in valen, verktyget äger mellanlagret. Skillnaden
   * är bara att draften märks som ap (`somAp`) redan från början.
   */
  const påbörjaNy = useCallback(
    (begäran: NyProcessBegäran) => {
      const rå = `${begäran.namn}\n${begäran.text}`.trimEnd() + "\n";
      const utgångsdraft = somAp(
        textToDraft(begäran.start === "regler" ? rå : `${begäran.namn}\n`),
      );
      setRawText(rå);
      setAiText("");
      setAiTextTolkad("");
      setDraftBrytpunkt(utgångsdraft);
      setFlowName(begäran.namn);
      setKategori(begäran.kategori);
      setUnderkategori(begäran.underkategori);
      setFlowId(null); // finns inte i biblioteket än
      setSparatFlöde(null);
      setExportKälla("aktuell");
      setTab("raw");
      setAiError(null);
      setSavedSnapshot(JSON.stringify({ rawText: rå, aiText: "", draft: utgångsdraft }));
      setVisaText(begäran.start === "regler" || begäran.start === "ai");
      if (begäran.start === "ai") void runBridge(rå);
      setSparaNyProcess(true);
    },
    [setDraftBrytpunkt, runBridge],
  );

  const påbörjad = useRef<number | null>(null);
  useEffect(() => {
    // En begäran verkställs EN gång (se `ärNyBegäran`): effekten körs om vid
    // ommontering och Fast Refresh, och då började verktyget om på processen
    // och sparade den tom.
    if (!ärNyBegäran(nyProcess, påbörjad)) return;
    påbörjaNy(nyProcess!);
    onNyProcessMottagen?.();
    // Bara på en NY begäran (nonce) – se FlowchartTool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nyProcess]);

  /** Brevlådan är en: medan presentationen väntar på svar kan ingen tolkning begäras. */
  const [presArbetar, setPresArbetar] = useState(false);

  const ångraNu = useCallback(() => setHistorik((h) => ångra(h)), []);
  const göraOmNu = useCallback(() => setHistorik((h) => göraOm(h)), []);

  // ---- Pipeline: draft → Ap-modell → layout. Ingen perspektivfiltrering –
  // affärsprocessen visar hela innehållet.
  const model = useMemo(() => compileAp(draft), [draft]);

  /**
   * UTSEENDET: affärsprocessverktygets rityta eller den avskalade presentationsbilden
   * (tools/ramar/avskalad.ts). En process i kategorin Presentation öppnas
   * avskalad – det är så den ska se ut när man visar den. Avskalad är en BILD:
   * i redigeringsläget visas alltid ritytan, annars finns inget att dra i.
   */
  const [utseende, setUtseende] = useState<"verktyg" | "avskalad">("verktyg");
  // Kategorin läses ur det SPARADE flödet: `openFlow` (katalogen, menyn) sätter
  // inte `kategori` – den hör till biblioteket i panelen.
  const flödesKategori = sparatFlöde?.category ?? kategori;
  useEffect(() => {
    setUtseende(flödesKategori === PRESENTATIONSKATEGORI ? "avskalad" : "verktyg");
  }, [flowId, flödesKategori]);
  // Avskalad i BÅDA lägena: i redigeringsläget går rutorna att dra där
  // (AvskaladVy). Innehållet ändras i affärsprocessutseendet.
  const visaAvskalad = utseende === "avskalad";
  /**
   * Figurförteckningen: symbolerna och ansvarsfärgerna som står i den öppna
   * processen. Läser den KOMPILERADE modellen, alltså samma objekt och samma
   * relationer som ritas – inte mellanlagret, där satelliterna ännu bara är
   * text i hakparenteser.
   */
  const figurer = useMemo(() => apFigurer(model), [model]);

  /**
   * Underlaget för "Förenkla och presentera": processen som den är RITAD nu,
   * inte bara texten den kom ur. Är processen inte sparad än får den id:t
   * sparningen skulle ge den.
   */
  const presentationsKälla = useCallback(
    () => ({
      flödeId: flowId ?? AP_FLOW_PREFIX + idUrNamn(flowName),
      namn: flowName,
      beskrivning: aiText.trim() || rawText,
      struktur: apUnderlag(model),
    }),
    [flowId, flowName, aiText, rawText, model],
  );
  const layout = useMemo(() => {
    const fmt = PAGE_FORMATS[pageFormat];
    // Användarens kantval följer med IN i layouten – den är den enda sanning
    // både canvasen och exporten läser (exporten har ingen draft att fråga).
    return layoutAp(model, { pageWidth: fmt.width, scale, spacing, edgeStyles: draft.edgeStyles });
    // draft.edgeStyles MÅSTE stå här (invariant 7): utan den räknades utlägget
    // inte om när man valde en kopplingspunkt, och valet syntes först vid nästa
    // ändring av något annat.
  }, [model, pageFormat, scale, spacing, draft.edgeStyles]);

  /* ---- Exportens källa. `layout` ovan tillhör RITYTAN – ApView renderar
     exportens SVG-sträng rakt av, så den får aldrig peka på något annat än det
     man redigerar. Exporten får därför sitt eget utlägg. ---- */
  const exportDraft = exporterarFastslagen ? fastslagen!.version.draft : draft;
  // Identitetsjämförelsen är medveten: i normalfallet ska exporten och ritytan
  // vara SAMMA bild, inte två som råkar bli lika.
  const exportModel = useMemo(
    () => (exportDraft === draft ? model : compileAp(exportDraft)),
    [exportDraft, draft, model],
  );
  const exportLayout = useMemo(() => {
    if (exportModel === model) return layout;
    const fmt = PAGE_FORMATS[pageFormat];
    return layoutAp(exportModel, {
      pageWidth: fmt.width,
      scale,
      spacing,
      edgeStyles: exportDraft.edgeStyles,
    });
  }, [exportModel, model, layout, pageFormat, scale, spacing, exportDraft.edgeStyles]);

  /**
   * Revisionsstämpeln. Huvudversionen är aldrig "ändrad sedan dess" – bilden ÄR
   * den versionen, hur mycket som än ligger ouppsparat i editorn.
   */
  const revision = useMemo(
    () =>
      exporterarFastslagen
        ? revisionAvVersion(sparatFlöde, fastslagen!.index, false)
        : revisionAvVersion(sparatFlöde, -1, dirty),
    [exporterarFastslagen, sparatFlöde, fastslagen, dirty],
  );

  const slug = (exportModel.title || "process").replace(/\s+/g, "_").toLowerCase();

  // BMT-exporten (bmt-export.ts): bara när installationen har en mall.
  const bmtMall = useBmtMall();
  const [bmtArbetar, setBmtArbetar] = useState(false);
  const [bmtFel, setBmtFel] = useState<string | null>(null);
  const exporteraBmt = useCallback(async () => {
    setBmtArbetar(true);
    setBmtFel(null);
    try {
      await laddaNerBmt(
        {
          draft: exportDraft,
          flödeId: sparatFlöde?.id ?? null,
          namn: flowName || exportModel.title || "Process",
          // Fastslagen version: dess sparning. Det jag ser: sparningen, om inget är ändrat sedan.
          sparad: exporterarFastslagen ? fastslagen!.version.savedAt : dirty ? undefined : sparatFlöde?.savedAt,
        },
        `${slug}.bmt`,
      );
    } catch (e) {
      setBmtFel(e instanceof Error ? e.message : String(e));
    } finally {
      setBmtArbetar(false);
    }
  }, [exportDraft, sparatFlöde, flowName, exportModel.title, exporterarFastslagen, fastslagen, dirty, slug]);

  // ---- Direktredigering på ytan (fas 5).
  const [valdNod, setValdNod] = useState<string | null>(null);
  /** Kravet vars rutin visas (null = rutinvyn stängd). */
  const [rutinNod, setRutinNod] = useState<string | null>(null);
  const rutinKrav = rutinNod ? model.nodes.find((n) => n.id === rutinNod && n.kind === "krav") : undefined;
  /**
   * Öppnar rutinen bakom ett krav. Bär kravet en inskriven checklista
   * ("Rutin X – ☐ a ☐ b") och ingen rutin, görs checklistan först om till
   * rutinen (`lyftUtChecklistor`) – i EN setDraft, så ångra tar tillbaka det.
   */
  const öppnaRutin = useCallback(
    (nodId: string) => {
      const nytt = idEfterLyft(draft, nodId);
      if (nytt && !model.nodes.find((n) => n.id === nodId)?.rutin) {
        setDraft((d) => ({ ...lyftUtChecklistor(d, nodId), meta: { ...d.meta, origin: "manual" } }));
        setRutinNod(nytt);
      } else setRutinNod(nodId);
    },
    [draft, model, setDraft],
  );

  // ---- Paletten: valt objekt placeras med nästa klick på ytan. Esc avbryter.
  const [palettVal, setPalettVal] = useState<ApNodeKind | null>(null);
  /**
   * Beskrivningspanelen. Stängd som standard – öppnar man en sparad process är
   * det bilden man kommit för. Se FlowchartTool, samma resonemang.
   */
  const [visaText, setVisaText] = useState(false);

  /**
   * Sidolistan (Beskrivning / AI-beskrivning) öppnas när man går in i
   * redigeringsläget – texten processen kommer ur hör till redigerandet, och
   * den ska inte behöva letas fram (beslut 2026-10-07). Stängs den med ✕
   * förblir den stängd tills man går in i redigeringsläget nästa gång.
   */
  useEffect(() => {
    if (!läser) setVisaText(true);
  }, [läser]);
  const [visaPalett, setVisaPalett] = useState(false);
  /** Handtag till biblioteket, så att sparknappen i rubrikraden kör dess sparning. */
  const bibliotek = useRef<FlowLibraryHandle>(null);

  /**
   * En ny process läggs in i biblioteket DIREKT (beslut 2026-09-04).
   *
   * Katalogens rubriker finns bara genom sparade processer, så en ny kategori
   * syntes inte förrän man hunnit spara – och det var inte alls uppenbart att
   * den skulle behöva sparas först. Nu skapas posten i samma andetag som
   * processen: rubriken står i menyn direkt, och ingenting kan gå förlorat för
   * att man glömde trycka Spara.
   *
   * Samma flagga sparar en AI-TOLKNING när svaret kommit (se `runBridge`).
   *
   * Sparningen sker i en effekt och inte i `påbörjaNy`: biblioteket läser namn,
   * kategori och draft ur sina PROPS, och de är uppdaterade först efter den
   * render som `påbörjaNy` utlöser.
   */
  const [sparaNyProcess, setSparaNyProcess] = useState(false);
  useEffect(() => {
    if (!sparaNyProcess) return;
    setSparaNyProcess(false);
    bibliotek.current?.spara();
  }, [sparaNyProcess]);
  useEffect(() => {
    if (!palettVal) return;
    const avbryt = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPalettVal(null);
    };
    window.addEventListener("keydown", avbryt);
    return () => window.removeEventListener("keydown", avbryt);
  }, [palettVal]);

  /** Klick på ytan i placeringsläge: fritt objekt på punkten (fria ramen). */
  const placera = useCallback(
    (flowPos: { x: number; y: number }) => {
      if (!palettVal) return;
      // Översätt till fria ramen med närmaste objekts förskjutning.
      let dx = 0;
      let närmast = Infinity;
      for (const n of layout.nodes) {
        const avstånd = (n.x + n.w / 2 - flowPos.x) ** 2 + (n.y + n.h / 2 - flowPos.y) ** 2;
        if (avstånd < närmast) {
          närmast = avstånd;
          dx = n.dx;
        }
      }
      const res = läggTillObjekt(draft, palettVal, { x: flowPos.x - dx, y: flowPos.y });
      if (res.draft !== draft) setDraft(res.draft);
      if (res.nodId) setValdNod(res.nodId);
      setPalettVal(null);
    },
    [palettVal, draft, layout, setDraft],
  );

  /** En pil dragen mellan två objekt – fria objekt knyts in och konverteras. */
  const onConnect = useCallback(
    (source: string, target: string) => {
      setDraft((d) => knytIhop(d, source, target));
      setValdNod(null);
    },
    [setDraft],
  );

  // ---- Affärsprocesskontrollen (fas 6): rådgivande granskning mot modelleringsreglerna.
  const anmärkningar = useMemo(() => granskaAp(model, draft), [model, draft]);
  const [showKontroll, setShowKontroll] = useState(false);
  const harVarningar = anmärkningar.some((a) => a.allvar === "varning");

  /** Släppt objekt: steg bär sin egen position, auto-objekt via autoPositions. */
  const onPositionChange = useCallback(
    (id: string, pos: { x: number; y: number }) => {
      setDraft((d) =>
        d.steps.some((s) => s.id === id) ? setStepPosition(d, id, pos) : setAutoPosition(d, id, pos),
      );
    },
    [setDraft],
  );

  /** Brytpunkt dragen/nollad på en relation. */
  const onWaypointChange = useCallback(
    (source: string, target: string, point: { x: number; y: number } | null, label?: string) => {
      setDraft((d) => setEdgeWaypoint(d, source, target, point, label));
    },
    [setDraft],
  );

  /** Sista sträckan in i målet flyttad/nollad på en relation. */
  const onWaypoint2Change = useCallback(
    (source: string, target: string, point: { x: number; y: number } | null, label?: string) => {
      setDraft((d) => setEdgeWaypoint2(d, source, target, point, label));
    },
    [setDraft],
  );

  /**
   * Kopplingens ETIKETT (dubbelklick). Samma regel som i flödesschemat: en
   * gren är hela grenen och dess nycklar migreras, regelns motsatta väg bor på
   * regeln, en handritad pil är ett fält och en kedjepil en presentationsval.
   */
  const onEdgeLabelTextChange = useCallback(
    (source: string, target: string, nuvarande: string | undefined, ny: string) => {
      setDraft((d) => setEdgeLabel(d, source, target, nuvarande, ny));
    },
    [setDraft],
  );
  const etikettHinderFör = useCallback(
    (source: string, nuvarande: string | undefined, ny: string) => etikettHinder(draft, source, nuvarande, ny),
    [draft],
  );

  /** Objekten användaren ramat in – verktygsradens åtgärder arbetar på dem. */
  const [markerade, setMarkerade] = useState<string[]>([]);

  /**
   * "Räta upp kopplingarna": linjerar de markerade objekten så att strecken
   * emellan dem blir raka. Räkningen bor i `rata-upp.ts`; här läggs bara
   * lägena i mellanlagret, som ett musdrag – EN setDraft, så ångra tar hela
   * uppträtningen i ett steg och inte objekt för objekt.
   */
  const rätaUpp = useCallback(() => {
    const flyttar = rätaUppKopplingar(layout, markerade);
    if (!flyttar.length) return;
    setDraft((d) =>
      flyttar.reduce(
        (acc, f) =>
          acc.steps.some((s) => s.id === f.id)
            ? setStepPosition(acc, f.id, f.position)
            : setAutoPosition(acc, f.id, f.position),
        d,
      ),
    );
  }, [layout, markerade, setDraft]);

  /**
   * Vald kopplingspunkt på ett objekt: vilken SIDA pilen fäster i. Sparas i
   * mellanlagret som allt annat manuellt, med kantens etikett i nyckeln så att
   * två pilar mellan samma par (H och K från olika roller) hålls isär.
   */
  const onEdgeSidesChange = useCallback(
    (
      source: string,
      target: string,
      sides: {
        sourceSide?: EdgeSide;
        targetSide?: EdgeSide;
        sourcePos?: number;
        targetPos?: number;
      },
      label?: string,
    ) => {
      setDraft((d) => setEdgeSides(d, source, target, sides, label));
    },
    [setDraft],
  );

  const [kopierad, setKopierad] = useState<number | null>(null);
  const [kopieringsFel, setKopieringsFel] = useState<string | null>(null);
  const kopieraFigur = useCallback(
    async (index: number) => {
      setKopieringsFel(null);
      try {
        const svg = renderApSvg(exportLayout, { textScale, page: index, revision });
        await copySvgAsPng(svg, exportLayout.pages[index].w, exportLayout.height);
        setKopierad(index);
        setTimeout(() => setKopierad(null), 2000);
      } catch (e) {
        setKopieringsFel(
          `Kunde inte kopiera: ${e instanceof Error ? e.message : String(e)}. Använd SVG-exporten i stället.`,
        );
      }
    },
    [exportLayout, textScale, revision],
  );

  /**
   * Arbetsytan – samma uppbyggnad som flödesschemat, för de två verktygen ska
   * kännas som samma app: rubrik, verktygsrad, yta. Det som skiljer är
   * objektpaletten, som affärsprocessen bygger på och som därför har en egen
   * knapp i raden i stället för att ligga inne i en rullgardin.
   */
  const behörighet = useBehörighet(flowId, flöden);
  return (
    <div className="ark-tool">
      <main className="ark-tool-main">
        <FlowHeader
          verktyg="Affärsprocess"
          namn={flowName}
          osparat={dirty}
          sparat={Boolean(flowId)}
          flödeId={flowId}
          version={nuvarandeBeteckning(sparatFlöde?.versions ?? [])}
          sparadTid={sparatFlöde?.savedAt}
          status={nuStatus}
          fastslagenVersion={fastslagen?.beteckning}
          yta={behörighet.yta}
          steg={draft.steps.length}
          åtgärder={
            <>
              {/* Se FlowchartTool: i läsläge visas Spara bara när det finns
                  osparat kvar från en redigering man lämnat. */}
              {(!läser || dirty) && (
                <button
                  className={`ark-btn ${läser ? "" : "ark-btn--primary"}`}
                  onClick={() => bibliotek.current?.spara()}
                  title={dirty ? "Spara ändringarna som en ny version" : "Allt är sparat"}
                >
                  {dirty ? "Spara •" : "Spara"}
                </button>
              )}
              {/* Flytta i katalogen – samma dialog som kortets knapp. */}
              {onFlytta && <FlyttaKnapp flowId={flowId} flöden={flöden} onFlytta={onFlytta} />}
              {/* Finns en visualisering av processen är den ett klick bort. */}
              <ÖppnaVisualisering flowId={flowId} serier={ramserier} onÖppna={onÖppnaRamserie} />
              {/* Publicera i EA-portalen – bara för en SPARAD process, som flytten. */}
              <PubliceraKnapp
                flöde={
                  flowId && sparatFlöde?.id === flowId && behörighet.fårPublicera ? sparatFlöde : null
                }
                osparat={dirty}
                fastslå={async () => (await bibliotek.current?.spara("fastslagen")) ?? null}
                onPublicerad={setSparatFlöde}
              />
              <Rullgardin titel="Versioner" align="right" bredd={400} behållBarn>
                <FlowLibrary
                  ref={bibliotek}
                  family="affarsprocess"
                  name={flowName}
                  onNameChange={setFlowName}
                  kategori={kategori}
                  onKategoriChange={setKategori}
                  underkategori={underkategori}
                  onUnderkategoriChange={setUnderkategori}
                  rawText={rawText}
                  aiText={aiText}
                  draft={draft}
                  view={{ perspective: "system", pageFormat, scale, spacing, textScale }}
                  dirty={dirty}
                  currentId={flowId}
                  onSaved={(sparad) => {
                    setSavedSnapshot(snapshot);
                    setFlowId(sparad.id);
                    setFlowName(sparad.name);
                    setKategori(sparad.category ?? "");
                    setUnderkategori(sparad.subcategory ?? "");
                    setSparatFlöde(sparad);
                  }}
                  onOpen={openFlow}
                  onNew={newFlow}
                />
              </Rullgardin>
              {läser ? (
                <button
                  className="ark-btn ark-btn--primary"
                  onClick={() => onLäge?.("redigerar")}
                  disabled={!behörighet.fårRedigera}
                  title={
                    behörighet.fårRedigera
                      ? "Lås upp ritytan och visa ritverktygen"
                      : behörighet.varför
                  }
                >
                  ✎ Redigera
                </button>
              ) : (
                <button
                  className="ark-btn"
                  onClick={() => onLäge?.("läser")}
                  title="Lämna redigeringen och läs processen. Ingenting kastas."
                >
                  ✓ Klar
                </button>
              )}
            </>
          }
        />

        <Verktygsrad
          höger={
            <>
              <Rullgardin
                titel="Granska"
                align="right"
                bredd={320}
                märke={anmärkningar.length > 0 ? anmärkningar.length : undefined}
                aktiv={harVarningar}
              >
                <RullgardinDel titel="Affärsprocesskontrollen">
                  <button
                    className={`ark-trace-badge ${harVarningar ? "warn" : "ok"}`}
                    onClick={() => setShowKontroll((s) => !s)}
                    title="Rådgivande granskning mot modelleringsreglerna – hindrar aldrig ritning eller export"
                  >
                    {harVarningar ? "!" : "✓"} {sammanfattaKontroll(anmärkningar)}
                  </button>
                  <p className="ark-hint">
                    Rådgivande. Kontrollen hindrar aldrig ritning eller export, och tiger om det du
                    uttryckligen valt.
                  </p>
                </RullgardinDel>

                {!läser && (
                <RullgardinDel titel="Mellanlager">
                  <button className="ark-draft-badge" onClick={() => setShowDraft((s) => !s)}>
                    ⚙ {draft.steps.length} steg
                    <span>
                      {draft.meta.origin === "ai"
                        ? "AI"
                        : draft.meta.origin === "manual"
                          ? "justerat"
                          : "regler"}
                    </span>
                  </button>
                </RullgardinDel>
                )}
              </Rullgardin>

              <Rullgardin titel="Export" align="right" bredd={330}>
                {/* Vad exporten ritar – FÖRE både "Till Word" och filerna, för
                    valet gäller båda. Se FlowchartTool. */}
                <RullgardinDel titel="Vad som exporteras">
                  <div className="ark-toggle">
                    <button
                      className={!exporterarFastslagen ? "active" : ""}
                      onClick={() => setExportKälla("aktuell")}
                      title="Exporterar processen som den ser ut på skärmen just nu."
                    >
                      Det jag ser
                    </button>
                    <button
                      className={exporterarFastslagen ? "active" : ""}
                      onClick={() => setExportKälla("fastslagen")}
                      disabled={!fastslagen}
                      title={
                        fastslagen
                          ? `Exporterar huvudversion ${fastslagen.beteckning} ur historiken – oavsett vad du håller på med i editorn.`
                          : "Ingen version är fastslagen än. Välj status Fastslagen när du sparar."
                      }
                    >
                      Fastslagen{fastslagen ? ` ${fastslagen.beteckning}` : ""}
                    </button>
                  </div>
                  {exporterarFastslagen ? (
                    <p className="ark-hint ark-hint--warn">
                      Exporterna ritar <strong>huvudversion {fastslagen!.beteckning}</strong>, inte
                      det du ser på skärmen.
                    </p>
                  ) : (
                    <p className="ark-hint">
                      {fastslagen
                        ? `Exporterna ritar det du ser. Fastslagen huvudversion just nu: ${fastslagen.beteckning}.`
                        : "Exporterna ritar det du ser. Inget är fastslaget än – figurerna märks som utkast."}
                    </p>
                  )}
                </RullgardinDel>

                <RullgardinDel titel="Till Word">
                  <div className="ark-export-grid">
                    {exportLayout.pages.map((sida, i) => (
                      <button
                        key={sida.index}
                        className="ark-btn"
                        onClick={() => kopieraFigur(i)}
                        title="Kopierar figuren som PNG – klistra in med Ctrl+V i Word"
                      >
                        {kopierad === i
                          ? "Kopierad ✓"
                          : exportLayout.pages.length === 1
                            ? "Kopiera figur"
                            : `Kopiera del ${i + 1}`}
                      </button>
                    ))}
                  </div>
                  {kopieringsFel && <p className="ark-hint ark-hint--warn">{kopieringsFel}</p>}
                </RullgardinDel>

                <RullgardinDel titel="Som fil">
                  <div className="ark-export-grid">
                    <button
                      className="ark-btn"
                      onClick={() =>
                        download(
                          `${slug}.svg`,
                          renderApSvg(exportLayout, { textScale, revision }),
                          "image/svg+xml",
                        )
                      }
                    >
                      SVG
                    </button>
                    <button
                      className="ark-btn"
                      onClick={() =>
                        download(
                          `${slug}.draft.json`,
                          JSON.stringify(draft, null, 2),
                          "application/json",
                        )
                      }
                    >
                      Mellanlager JSON
                    </button>
                    {bmtMall && (
                      <button
                        className="ark-btn"
                        onClick={() => void exporteraBmt()}
                        disabled={bmtArbetar}
                        title="Modellarkiv att läsa in i modelleringsverktyget (Import content). En ny export av samma process uppdaterar modellen där."
                      >
                        {bmtArbetar ? "Bygger …" : "BMT (.bmt)"}
                      </button>
                    )}
                  </div>
                  {bmtFel && <p className="ark-hint ark-hint--warn">{bmtFel}</p>}
                </RullgardinDel>
              </Rullgardin>
            </>
          }
        >
          {/* Ångra, objektpaletten och tolkningen hör till REDIGERANDET. */}
          {!läser && (
            <>
          <VradGrupp>
            <VradKnapp ikon onClick={ångraNu} disabled={!kanÅngra(historik)} title="Ångra">
              ↶
            </VradKnapp>
            <VradKnapp ikon onClick={göraOmNu} disabled={!kanGöraOm(historik)} title="Gör om">
              ↷
            </VradKnapp>
          </VradGrupp>

          <VradGrupp>
            <VradKnapp
              aktiv={visaPalett}
              onClick={() => setVisaPalett((v) => !v)}
              title="Objekt att placera på ytan"
            >
              ▧ Objekt
            </VradKnapp>
            <VradKnapp
              aktiv={visaText}
              onClick={() => setVisaText((v) => !v)}
              title="Texten processen kommer ur"
            >
              ✎ Beskrivning
            </VradKnapp>
            {aiVäg !== "av" && <VradKnapp
              ai
              onClick={() => void runBridge()}
              disabled={aiBusy || presArbetar}
              title={aiVäg === "api" ? "Låt AI:n tolka beskrivningen" : "Låt Claude Code tolka beskrivningen"}
            >
              {aiBusy ? väntarText(aiVäg) : "✦ Tolka med AI"}
            </VradKnapp>}
            {bridgeAbort && (
              <VradKnapp onClick={() => bridgeAbort.abort()} title="Avbryt väntan">
                Avbryt
              </VradKnapp>
            )}
          </VradGrupp>

          <VradGrupp>
            <VradKnapp
              onClick={rätaUpp}
              disabled={markerade.length < 2}
              title={
                markerade.length < 2
                  ? "Markera två eller flera objekt (dra en ram, eller Ctrl-klicka) för att räta upp kopplingarna emellan dem"
                  : `Linjerar de ${markerade.length} markerade objekten så att kopplingarna emellan dem blir raka`
              }
            >
              ⌗ Räta upp kopplingarna
            </VradKnapp>
          </VradGrupp>
            </>
          )}

          {/* Alltid framme i REDIGERINGSLÄGET; i läsläget tänds den när processen
              är AI-tolkad. Underlaget är det som är ritat, så uppdraget går
              att ge också för en process utan AI-beskrivning. Det rör inte
              den öppna processen – det skapar en ny bredvid. */}
          {(!läser || aiText.trim()) && (
            <VradGrupp>
              <PresentationsKnapp
                källa={presentationsKälla}
                upptagen={aiBusy}
                onArbetar={setPresArbetar}
                onÖppnaFlöde={onÖppnaFlöde}
                onÖppnaRamserie={onÖppnaRamserie}
              />
            </VradGrupp>
          )}

          {/* Teckenförklaringen hör till LÄSANDET och ligger därför utanför
              redigeringsguarden. HUKI-färgerna finns ingen annanstans att läsa:
              bokstaven skrivs aldrig ut i bilden. */}
          <VradGrupp>
            <Figurförteckning
              grupper={figurer}
              tomText="Inget ritat än – här listas symbolerna och ansvarsfärgerna som används i processen."
            />
          </VradGrupp>

          <VradGrupp>
            <Rullgardin titel="Vy" bredd={320} title="Utseende och sidformat">
              <RullgardinDel titel="Utseende">
                <div className="ark-toggle">
                  <button className={utseende === "verktyg" ? "active" : ""} onClick={() => setUtseende("verktyg")}>
                    Ritning
                  </button>
                  <button className={utseende === "avskalad" ? "active" : ""} onClick={() => setUtseende("avskalad")}>
                    Avskalad
                  </button>
                </div>
                <p className="ark-hint">
                  Avskalad är presentationsbilden – zoner, numrerade steg, mörk bakgrund – samma som Ramar visar.
                  I redigeringsläget drar du rutorna där; texter och steg ändrar du i Ritning.
                </p>
              </RullgardinDel>
              <RullgardinDel titel="Sidformat">
                <div className="ark-toggle">
                  {PAGE_ORDER.map((id) => (
                    <button
                      key={id}
                      className={pageFormat === id ? "active" : ""}
                      onClick={() => setPageFormat(id)}
                    >
                      {id === "word"
                        ? "Word"
                        : id === "wide"
                          ? "Bred"
                          : id === "free"
                            ? "Fri"
                            : "A4 ligg."}
                    </button>
                  ))}
                </div>
                <p className="ark-hint">
                  {layout.pages.length} {layout.pages.length === 1 ? "figur" : "figurer"}
                  {pageFormat === "word" && (
                    <>
                      , nodtexten blir <strong>{wordPointSize(layout.width).toFixed(1)} pt</strong>{" "}
                      i en stående rapport
                    </>
                  )}
                  . Vid delning följer en aktivitets satelliter alltid med till samma del.
                </p>
              </RullgardinDel>
            </Rullgardin>

            <Rullgardin titel="Storlek" bredd={300}>
              <RullgardinDel titel="Storlek på objekt">
                <div className="ark-size-row">
                  <input
                    type="range"
                    min={0.6}
                    max={1.4}
                    step={0.05}
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value))}
                    className="ark-range"
                  />
                </div>
                <div className="ark-size-meta">
                  <span>{Math.round(scale * 100)} %</span>
                  <button className="ark-linkbtn" onClick={() => setScale(1)}>
                    Återställ
                  </button>
                </div>
              </RullgardinDel>

              <RullgardinDel titel="Avstånd mellan objekt">
                <div className="ark-size-row">
                  <input
                    type="range"
                    min={0.5}
                    max={1}
                    step={0.05}
                    value={spacing}
                    onChange={(e) => setSpacing(Number(e.target.value))}
                    className="ark-range"
                    title="Tätare diagram ryms på färre delar"
                  />
                </div>
                <div className="ark-size-meta">
                  <span>{Math.round(spacing * 100)} %</span>
                  <button className="ark-linkbtn" onClick={() => setSpacing(1)}>
                    Återställ
                  </button>
                </div>
              </RullgardinDel>

              <RullgardinDel titel="Textstorlek">
                <div className="ark-size-row">
                  <input
                    type="range"
                    min={0.6}
                    max={1}
                    step={0.05}
                    value={textScale}
                    onChange={(e) => setTextScale(Number(e.target.value))}
                    className="ark-range"
                    title="Skalar all text – objekten behåller sin storlek"
                  />
                </div>
                <div className="ark-size-meta">
                  <span>{Math.round(textScale * 100)} %</span>
                  <button className="ark-linkbtn" onClick={() => setTextScale(1)}>
                    Återställ
                  </button>
                </div>
              </RullgardinDel>
            </Rullgardin>
          </VradGrupp>
        </Verktygsrad>

        <div className="ark-arbetsyta">
          {visaText && !läser && (
            <aside className="ark-textdock">
              <div className="ark-textdock-topp">
                <div className="ark-toggle">
                  <button className={tab === "raw" ? "active" : ""} onClick={() => setTab("raw")}>
                    Beskrivning
                  </button>
                  <button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>
                    AI-beskrivning
                  </button>
                </div>
                <button
                  className="ark-stang"
                  onClick={() => setVisaText(false)}
                  title="Stäng beskrivningen"
                  aria-label="Stäng beskrivningen"
                >
                  ✕
                </button>
              </div>

              {tab === "raw" ? (
                <>
                  <textarea
                    className="ark-textarea ark-textdock-text"
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder={"Titel\nsteg → steg → steg (↓ Om villkor → gren-steg)"}
                  />
                  <button className="ark-btn ark-btn--primary ark-btn--bred" onClick={generateFromRules}>
                    Läs in beskrivningen
                  </button>
                  {aiVäg !== "av" && (
                    <button
                      className="ark-btn ark-btn--ai ark-btn--bred"
                      disabled={aiBusy || presArbetar}
                      onClick={() => void runBridge()}
                    >
                      {aiBusy ? väntarText(aiVäg) : "✦ Tolka med AI"}
                    </button>
                  )}
                  {bridgeAbort && (
                    <button className="ark-linkbtn" onClick={() => bridgeAbort.abort()}>
                      Avbryt väntan
                    </button>
                  )}
                  {aiError && <p className="ark-hint ark-hint--warn">{aiError}</p>}
                  <details className="ark-details">
                    <summary>Satellitsyntaxen</summary>
                    <p className="ark-hint">
                      Satelliter anges med hakparenteser i steget: <code>[Roll: HR U]</code>{" "}
                      <code>[Intressent: Hyresgäst I]</code> <code>[IT: ReachMee]</code>{" "}
                      <code>[Krav: Öka mångfald]</code> <code>[Tid: Inom 5 dagar]</code>{" "}
                      <code>[In: Handling från Lantmäteriet]</code>{" "}
                      <code>[Ut: Urval genomfört]</code>. <code>[Forum]</code> utan kolon gör
                      steget till ett forum i kedjan – för det som alltid sker i mötesform. Bokstaven är HUKI: H = Huvudansvar, U =
                      Utför, K = Konsulteras, I = Informeras. Utan <code>[Ut: …]</code> föreslås ett
                      verksamhetsobjekt automatiskt ur aktivitetens namn – döp om eller ta bort i
                      mellanlagret. Använd <code>[In: …]</code> bara för objekt som kommer UTIFRÅN
                      processen; det som skapas inne i processen sätts som <code>[Ut: …]</code> på
                      steget som skapar det, så kedjan hänger ihop.
                    </p>
                  </details>
                </>
              ) : (
                <>
                  <textarea
                    className="ark-textarea ark-textdock-text"
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    placeholder="AI-beskrivningen hamnar här efter en tolkning."
                  />
                  <button
                    className="ark-btn ark-btn--bred"
                    onClick={generateFromAiText}
                    disabled={!aiTextÄndrad}
                    title={
                      aiTextÄndrad
                        ? "Bygger om diagrammet ur texten med regelmotorn"
                        : "Beskrivningen är oförändrad sedan tolkningen – det finns inget att tillämpa"
                    }
                  >
                    Använd AI-beskrivningen
                  </button>
                  {aiKvittens ? (
                    <p className="ark-hint ark-hint--kvitto">✓ {aiKvittens}</p>
                  ) : aiTextÄndrad ? (
                    <p className="ark-hint">
                      Texten tolkas om med <strong>regelmotorn</strong>. Den läser steg och grenar
                      ur pilarna, men pilformatet bär ingen bana – objekten hamnar därför i
                      standardbanan och du får sätta banorna själv.
                    </p>
                  ) : (
                    <p className="ark-hint">
                      Beskrivningen är oförändrad sedan tolkningen, så det finns inget att
                      tillämpa. Ändra texten här och tryck sedan på knappen för att bygga om
                      diagrammet ur den.
                    </p>
                  )}
                  {aiVäg !== "av" && <VidareInstruktioner
                    aiText={aiText}
                    diagramType="affarsprocess"
                    upptagen={aiBusy || presArbetar}
                    väntarText={väntarText(aiVäg)}
                    fel={aiError}
                    onSkicka={(instruktion) => runBridge(undefined, instruktion)}
                  />}
                </>
              )}
            </aside>
          )}

          {visaPalett && !läser && (
            <aside className="ark-ap-palett">
              <div className="ark-textdock-topp">
                <strong className="ark-palett-titel">Objekt</strong>
                <button
                  className="ark-stang"
                  onClick={() => setVisaPalett(false)}
                  title="Stäng objektpaletten"
                  aria-label="Stäng objektpaletten"
                >
                  ✕
                </button>
              </div>
              <ApPalett vald={palettVal} onVälj={setPalettVal} />
            </aside>
          )}

          {/* Ritytan: paneler och inspektörer ligger HÄR inne, så att de
              positioneras mot bilden och inte mot rubriken. */}
          <div className="ark-tool-stage">
            {visaAvskalad && (
              <AvskaladVy
                modell={model}
                lägen={draft.presentation?.lägen ?? {}}
                kopplingar={draft.presentation?.kopplingar ?? {}}
                redigerar={!läser}
                vald={valdNod}
                onFlytta={(id, läge) => setDraft((d) => setPresentationsLäge(d, id, läge))}
                onKoppling={(nyckel, ände, val) => setDraft((d) => setPresentationsKoppling(d, nyckel, ände, val))}
                onVälj={setValdNod}
                onÅterställ={() =>
                  setDraft((d) => ({ ...d, presentation: { ...d.presentation, lägen: {}, kopplingar: {} } }))
                }
                etikett={`${flowName || "Processen"} – avskalad presentationsbild`}
              />
            )}
            <ApCanvas
              layout={layout}
              låst={läser}
              textScale={textScale}
              edgeStyles={draft.edgeStyles}
              onPositionChange={onPositionChange}
              onWaypointChange={onWaypointChange}
              onWaypoint2Change={onWaypoint2Change}
              onEdgeLabelTextChange={onEdgeLabelTextChange}
              etikettHinder={etikettHinderFör}
              onSelect={setValdNod}
              onSelectionChange={setMarkerade}
              onRutin={setRutinNod}
              placerar={palettVal !== null}
              onPlace={placera}
              onConnect={onConnect}
              onEdgeSidesChange={onEdgeSidesChange}
            />
            {/* Rutinrutan står där inspektören står (högerkanten). Medan den är
                öppen viker inspektören undan; stängs den är inspektören kvar. */}
            {valdNod && !läser && !rutinKrav && (
              <ApInspector
                draft={draft}
                model={model}
                nodeId={valdNod}
                onChange={setDraft}
                onClose={() => setValdNod(null)}
                onRutin={öppnaRutin}
              />
            )}
            {rutinKrav && (
              <RutinVy
                // Nytt krav → ny vy: utkastet i skrivläget hör till ETT krav.
                key={rutinKrav.id}
                namn={rutinKrav.label}
                text={rutinKrav.rutin}
                aktivitet={model.nodes.find((n) => n.id === rutinKrav.anchorId)?.label}
                redigerbar={!läser}
                onSpara={(text) => setDraft((d) => sättRutin(d, rutinKrav.id, text))}
                onAiFil={(fil, signal) =>
                  begärRutin(
                    fil,
                    {
                      krav: rutinKrav.label,
                      aktivitet: model.nodes.find((n) => n.id === rutinKrav.anchorId)?.label,
                      källa: sparatFlöde ? { flödeId: sparatFlöde.id, namn: sparatFlöde.name } : undefined,
                    },
                    signal,
                  )
                }
                onClose={() => setRutinNod(null)}
              />
            )}
            {showDraft && (
              <DraftPanel draft={draft} onChange={setDraft} onClose={() => setShowDraft(false)} />
            )}
            {showKontroll && (
              <div className="ark-ap-kontroll">
                <div className="ark-ap-inspektor-huvud">
                  <strong>Affärsprocesskontrollen</strong>
                  <button
                    className="ark-btn ark-btn--icon"
                    onClick={() => setShowKontroll(false)}
                    title="Stäng"
                  >
                    ×
                  </button>
                </div>
                {anmärkningar.length === 0 ? (
                  <p className="ark-hint">
                    Inga anmärkningar – aktiviteterna har roller och beskrivningar, reglerna är
                    frågor med svar, och förädlingskedjan är obruten.
                  </p>
                ) : (
                  <>
                    <p className="ark-hint">
                      Rådgivande – diagrammet är ditt. Klicka på en rad för att markera objektet
                      och öppna dess panel.
                    </p>
                    <ul className="ark-ap-kontrollista">
                      {anmärkningar.map((a, i) => (
                        <li key={`${a.id}_${a.nodId}_${i}`}>
                          <button
                            className={`ark-ap-anmarkning ${a.allvar}`}
                            onClick={() => setValdNod(a.nodId)}
                          >
                            <span>{a.allvar === "varning" ? "!" : "→"}</span>
                            {a.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
