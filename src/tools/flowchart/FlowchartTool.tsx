/**
 * Flödesschema – Arkitektens första verktyg.
 *
 * Pipeline:
 *   beskrivning (rå eller AI-tolkad) → mellanlager (ProcessDraft)
 *     → deterministisk kompilering → modell → layout → editor/export
 *
 * Mellanlagret är avsiktligt det enda stället där tolkningen kan justeras.
 * AI:n får aldrig rita – den fyller bara mellanlagret, precis som regelmotorn.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearPositions,
  allLanes,
  compileDraft,
  removeEdge,
  resetEdgeSides,
  addManualEdge,
  kopplingHinder,
  setLaneHeight,
  setPageRefHidden,
  showAllPageRefs,
  hiddenPageRefCount,
  setEdgeSides,
  setEdgeLabelPos,
  setEdgeLabel,
  etikettHinder,
  setEdgeWaypoint,
  setStepPosition,
  setAutoLabel,
  setAutoPosition,
  setAutoLane,
  setPagePin,
  setTextStyle,
  updateStep,
  läggTillFritt,
  setKolumnAvstånd,
  type ProcessDraft,
} from "@/core/draft";
import { AvstandsKnappar } from "@/shell/AvstandsKnappar";
import { avståndFör, avståndsMål } from "./layout/avstand";
import {
  flowId as idUrNamn,
  getFlowStore,
  meddelaAktivtFlöde,
  type SavedFlow,
} from "@/core/flow-store";
import { nuvarandeBeteckning, nuvarandeStatus, senasteFastslagna } from "@/core/status";
import { revisionAvVersion } from "./export/revision";
import type { NyProcessBegäran, VerktygsProps } from "@/shell/tools";
import { ärNyBegäran } from "@/shell/begaran";
import { FlowHeader } from "@/shell/FlowHeader";
import { FlyttaKnapp } from "@/shell/FlyttaKnapp";
import type { EdgeSide, NodeType, Perspective, ProcessModel, TextPlacement } from "@/core/model";
import { TYPE_LABEL, type ColorMode } from "./theme";
import { FlowLibrary, type FlowLibraryHandle } from "./FlowLibrary";
import { requestClaudeCodeDraft } from "./ai/bridge";
import { useAiVäg, väntarText } from "./ai/useAiVag";
import { VidareInstruktioner } from "./VidareInstruktioner";
import { textToDraft } from "./parser/toDraft";
import { TemplatePanel } from "./TemplatePanel";
import { ReviewPanel } from "./ReviewPanel";
import { begärUtvärdering, underlag, type Utvärdering } from "./ai/review";
import { PresentationsKnapp } from "@/tools/ramar/PresentationsKnapp";
import { draftTillMall, fortsättMedMall, mallSomText, type Mall } from "@/core/template";
import {
  göraOm,
  kanGöraOm,
  kanÅngra,
  lägg,
  läggBrytpunkt,
  skapaHistorik,
  ångra,
} from "@/core/history";
import { validateModel } from "./parser/validate";
import { filterByPerspective } from "./perspective";
import { flödesFigurer } from "./figurer";
import { Figurförteckning } from "@/shell/Figurforteckning";
import { toDrawioXml } from "./export/drawio";
import { toMermaid } from "./export/mermaid";
import { renderSvg, renderSvgSized } from "./export/svg";
import { copySvgAsPng } from "./export/clipboard";
import { computeRanks, extractPage, layoutModel, PAGE_FORMATS, wordPointSize, type PageFormatId } from "./layout/layout";
import { FlowCanvas } from "./render/FlowCanvas";
import {
  Rullgardin,
  RullgardinDel,
  VradGrupp,
  VradKnapp,
  Verktygsrad,
} from "@/shell/Verktygsrad";
import { DraftPanel } from "./DraftPanel";
import { TracePanel } from "./TracePanel";
import { useBehörighet } from "@/shell/behorighet-hook";
import { ÖppnaVisualisering } from "@/tools/ramar/OppnaVisualisering";
import { PubliceraSystemprocessKnapp } from "./PubliceraSystemprocess";
import { useHelskärm } from "@/render/helskarm";

const PAGE_ORDER: PageFormatId[] = ["word", "free", "wide", "a4p", "a4l"];

const EXAMPLE = `Driftfråga ny
Fel uppkommer → Medarbetare → Startar portalen → Väljer ny driftfråga från startsidan → Fyller i formulär för driftfråga → Väljer skicka in formuläret för driftfråga → Handläggare utses automatiskt utifrån det system som valts → Kommer till en sida med tack för ditt ärende → Får via mejl bekräftelse på att driftfråga har inkommit

Driftfråga inkommer i SP-listan "Inkorgen" → Power Automate flödet "DRF nytt ärende" triggas (↓ Om klassificering = Hög prioritet → Teamschatt skapas med alla handläggare på IT → Chattmeddelande genereras för det specifika ärendet) → Mejlbekräftelse skickas till användaren → Mejl skickas till handläggaren → Loggpost skapas`;

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function FlowchartTool({
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
  /**
   * Läsläge: ritytan är låst, ritverktygen är borta och menyn visar
   * strukturen. Att öppna en process är inte att börja ändra i den – se
   * `Arbetsläge` i shell/tools.tsx.
   */
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
  /** Satt medan appen väntar på Claude Code – låter användaren avbryta. */
  const [bridgeAbort, setBridgeAbort] = useState<AbortController | null>(null);

  /**
   * Draften med ångra-historik.
   *
   * `setDraft` beter sig som en vanlig setState men lägger samtidigt ett steg i
   * historiken. `setDraftBrytpunkt` används för hela hopp – öppna flöde, tolka
   * om, återställa – som alltid ska gå att ångra i ett stycke.
   */
  const [historik, setHistorik] = useState(() => skapaHistorik(textToDraft(EXAMPLE)));
  const draft = historik.nuvarande;
  const setDraft = useCallback((uppdatering: ProcessDraft | ((d: ProcessDraft) => ProcessDraft)) => {
    setHistorik((h) => {
      const nästa = typeof uppdatering === "function" ? uppdatering(h.nuvarande) : uppdatering;
      return lägg(h, nästa, performance.now());
    });
  }, []);
  const setDraftBrytpunkt = useCallback((nästa: ProcessDraft) => {
    setHistorik((h) => läggBrytpunkt(h, nästa, performance.now()));
  }, []);
  const [perspective, setPerspective] = useState<Perspective>("system");
  // Word-figur som standard: diagrammen är till för att klistras in i
  // rapporter, och det är figurbredden – inte pappret – som avgör om texten
  // går att läsa när Word skalat ned bilden till spaltbredden.
  // Fri är standard – se ApTool: ett nytt flöde visas helt, sidformatet väljs
  // när figuren ska in i ett dokument. Sparade flöden behåller sitt val.
  const [pageFormat, setPageFormat] = useState<PageFormatId>("free");
  const [scale, setScale] = useState(1);
  /** Täthet: avstånden mellan objekt (1 = normal, lägre = tätare). */
  const [spacing, setSpacing] = useState(1);
  /** Global textstorlek (bara texten, inte objekten). */
  const [textScale, setTextScale] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>("type");
  const [locked, setLocked] = useState(false);
  /** Visningsläget: bara bilden, hela skärmen, inget går att ändra. */
  const helskärm = useHelskärm();
  const [regenKey, setRegenKey] = useState(0);
  /** Banor man dragit objekt ut ur i den här redigeringen – de ritas även tomma. */
  const [behållnaBanor, setBehållnaBanor] = useState<ReadonlySet<string>>(new Set());
  const filteredRef = useRef<ProcessModel | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [showDraft, setShowDraft] = useState(false);
  const [showMall, setShowMall] = useState(false);
  /**
   * Beskrivningspanelen. STÄNGD som standard: öppnar man ett sparat flöde är
   * det diagrammet man kommit för, och texten bakom det är sällan det man vill
   * ändra först. Den fälls ut av sig själv när en NY process ska tolkas ur
   * text – då är den tvärtom det enda som gäller.
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
  const [utvärdering, setUtvärdering] = useState<Utvärdering | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewFel, setReviewFel] = useState<string | null>(null);

  /**
   * Namnet i sparfältet innan något öppnats. NEUTRALT med flit: hette det som
   * ett verkligt flöde ("Driftfråga ny") såg exemplet ut att VARA det sparade
   * flödet med samma namn, och en sparning hade skrivit en version på det.
   */
  const [flowName, setFlowName] = useState("Exempel – driftfråga");
  /**
   * Id:t på flödet som redigeras (null = exempel eller nytt, inte sparat än).
   * Verktyget äger det, för flödet kan öppnas både ur panelens bibliotek och
   * ur skalets meny – och rubriken över ritytan, markeringen i menyn och
   * sparningens mål måste peka på SAMMA flöde oavsett vilken väg man tog.
   */
  /**
   * Kategorin i katalogen. Bor bredvid namnet och inte i draften: att flytta en
   * process mellan samlingar är inte en ny version av processen.
   */
  const [kategori, setKategori] = useState("");
  /** Underkategorin i katalogen – nivån under kategorin. Se flow-tree.ts. */
  const [underkategori, setUnderkategori] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  // Skalets meny markerar det flöde som redigeras – oavsett var det öppnades.
  useEffect(() => {
    meddelaAktivtFlöde(flowId);
    setBehållnaBanor(new Set());
  }, [flowId]);
  /**
   * Samma id som en ref: AI-svaret kommer minuter efter att tolkningen
   * begärdes, och då ska det vara DAGENS flöde som avgör om det sparas.
   */
  const flowIdRef = useRef<string | null>(null);
  flowIdRef.current = flowId;
  /**
   * Osparade ändringar spåras genom att jämföra med en BASLINJE – tillståndet
   * vid senaste spara/öppna/nytt/tolka – i stället för en flagga som måste
   * sättas på varje ändringsställe.
   *
   * Baslinjen finns ALLTID. Tidigare var den null tills första sparningen, och
   * `dirty` var då alltid falskt – redigeringar i ett nytt eller nyss tolkat
   * flöde kunde skrivas över utan varning när man öppnade något annat.
   */
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() =>
    JSON.stringify({ rawText: EXAMPLE, aiText: "", draft: textToDraft(EXAMPLE) }),
  );
  const snapshot = useMemo(
    () => JSON.stringify({ rawText, aiText, draft }),
    [rawText, aiText, draft],
  );
  const dirty = savedSnapshot !== snapshot;

  /**
   * Det sparade flödet med hela sin historik. HELA posten och inte bara
   * "senaste versionen": statusen, numreringen och den fastslagna versionens
   * innehåll räknas alla fram ur historiken, och tre lösa fält hade behövt
   * hållas i takt med varandra vid varje sparning.
   */
  const [sparatFlöde, setSparatFlöde] = useState<SavedFlow | null>(null);
  /** Senaste fastslagna versionen – huvudversionen som går att exportera för sig. */
  const fastslagen = useMemo(
    () => senasteFastslagna(sparatFlöde?.versions ?? []),
    [sparatFlöde],
  );
  const nuStatus = nuvarandeStatus(sparatFlöde?.versions ?? []);

  /**
   * Vad exporten ska rita: det man ser, eller den fastslagna huvudversionen.
   *
   * Valet finns för att båda behövs. Under arbetet vill man kunna klistra in
   * det man just ritat; till ett styrdokument ska det som GÄLLER ut, även om
   * editorn står i ett halvfärdigt utkast. Valet styr BARA exporten – canvasen
   * visar alltid det man redigerar, annars vore det oklart vad man ändrar i.
   */
  const [exportKälla, setExportKälla] = useState<"aktuell" | "fastslagen">("aktuell");
  // Faller tillbaka till "aktuell" så snart det inte finns någon fastslagen
  // version att exportera – annars hade knapparna tigande ritat något annat.
  const exporterarFastslagen = exportKälla === "fastslagen" && fastslagen !== null;

  /** Öppna ett sparat flöde: hela kedjan återställs i ett svep. */
  const openFlow = useCallback((flow: SavedFlow) => {
    setRawText(flow.rawText);
    setAiText(flow.aiText ?? "");
    setAiTextTolkad(flow.aiText ?? "");
    setDraftBrytpunkt(flow.draft);
    setFlowName(flow.name);
    setKategori(flow.category ?? "");
    setUnderkategori(flow.subcategory ?? "");
    setFlowId(flow.id);
    if (flow.view) {
      setPerspective(flow.view.perspective);
      setPageFormat(flow.view.pageFormat as PageFormatId);
      setScale(flow.view.scale);
      if (flow.view.colorMode) setColorMode(flow.view.colorMode as ColorMode);
      setSpacing(flow.view.spacing ?? 1);
      setTextScale(flow.view.textScale ?? 1);
    }
    setSparatFlöde(flow);
    // Ett nyöppnat flöde exporterar det man ser. Att öppna något är inte ett
    // beslut om vad som ska ut i ett dokument.
    setExportKälla("aktuell");
    setTab(flow.aiText ? "ai" : "raw");
    setAiError(null);
    setRegenKey((k) => k + 1);
    setSavedSnapshot(JSON.stringify({ rawText: flow.rawText, aiText: flow.aiText ?? "", draft: flow.draft }));
  }, [setDraftBrytpunkt]);

  /** Börja om från ett tomt flöde. */
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
    if (dirty && !confirm("Du har osparade ändringar. Börja på ett nytt flöde ändå?")) return;
    const tom = "Nytt flöde\n";
    const tomDraft = textToDraft(tom);
    setRawText(tom);
    setAiText("");
    setAiTextTolkad("");
    setDraftBrytpunkt(tomDraft);
    setFlowName("Nytt flöde");
    setKategori("");
    setFlowId(null); // finns inte i biblioteket än – nästa sparning skapar posten
    setSparatFlöde(null);
    setExportKälla("aktuell");
    setTab("raw");
    setAiError(null);
    setRegenKey((k) => k + 1);
    // Baslinjen = det tomma flödet, så att redigeringar däri räknas som osparade.
    setSavedSnapshot(JSON.stringify({ rawText: tom, aiText: "", draft: tomDraft }));
  }, [dirty]);

  /** Tolka den råa beskrivningen med regelmotorn (ingen AI). */
  const generateFromRules = useCallback(() => {
    setDraftBrytpunkt(textToDraft(rawText));
    setRegenKey((k) => k + 1);
  }, [rawText, setDraftBrytpunkt]);

  /** Tolka om AI-beskrivningen efter att den redigerats för hand. */
  const generateFromAiText = useCallback(() => {
    const d = textToDraft(aiText);
    d.meta.aiText = aiText;
    d.meta.sourceText = rawText;
    d.meta.origin = "ai";
    setDraftBrytpunkt(d);
    setAiTextTolkad(aiText);
    setAiKvittens(`Diagrammet byggdes om ur beskrivningen · ${d.steps.length} steg`);
    setTimeout(() => setAiKvittens(null), 4000);
    setRegenKey((k) => k + 1);
  }, [aiText, rawText, setDraftBrytpunkt]);

  /**
   * Be AI:n tolka. Beskrivningen läggs i brevlådan på servern, som svarar med
   * sin API-nyckel – eller, utan nyckel, väntar på Claude Code.
   */
  /**
   * `instruktion` = "Vidare instruktioner till AI": samma underlag tolkas om,
   * med den nuvarande AI-beskrivningen och justeringarna som önskemål.
   * Svarar sant när tolkningen kom tillbaka.
   */
  const runBridge = useCallback(async (text?: string, instruktion?: string): Promise<boolean> => {
    const ctrl = new AbortController();
    setBridgeAbort(ctrl);
    setAiBusy(true);
    setAiError(null);
    try {
      // Texten kan skickas med: en ny process tolkas i samma andetag som den
      // skapas, och då har `rawText` ännu inte hunnit bli tillstånd.
      const d = await requestClaudeCodeDraft({ rawText: text ?? rawText, instruction: instruktion, signal: ctrl.signal });
      setDraftBrytpunkt(d);
      setAiText(d.meta.aiText ?? "");
      setAiTextTolkad(d.meta.aiText ?? "");
      setTab("ai");
      setRegenKey((k) => k + 1);
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
  }, [rawText]);

  /**
   * Startar en process som beställts i vyn "Ny process".
   *
   * Vyn samlar bara in valen; TOLKNINGEN sker här, för mellanlagret ägs av
   * verktyget och ingen annan får fylla det. Vägarna skiljer sig bara i vad
   * som händer efter att den tomma draften lagts på plats: regler tolkar
   * texten direkt, AI:n får den skickad till sig, mallen öppnar sitt formulär
   * och den tomma ytan gör ingenting mer.
   */
  const påbörjaNy = useCallback(
    (begäran: NyProcessBegäran) => {
      // Namnet är textens FÖRSTA RAD – det är så parsern läser titeln, och det
      // gör att "tolka om" senare ger samma diagram som den första tolkningen.
      const rå = `${begäran.namn}\n${begäran.text}`.trimEnd() + "\n";
      const utgångsdraft = textToDraft(begäran.start === "regler" ? rå : `${begäran.namn}\n`);
      setRawText(rå);
      setAiText("");
      setAiTextTolkad("");
      setDraftBrytpunkt(utgångsdraft);
      setFlowName(begäran.namn);
      setKategori(begäran.kategori);
      setUnderkategori(begäran.underkategori);
      setFlowId(null); // finns inte i biblioteket än – första sparningen skapar posten
      setSparatFlöde(null);
      setExportKälla("aktuell");
      setTab("raw");
      setAiError(null);
      setRegenKey((k) => k + 1);
      setSavedSnapshot(JSON.stringify({ rawText: rå, aiText: "", draft: utgångsdraft }));
      // Texten är utgångspunkten i två av fyra fall – då ska panelen stå öppen
      // så man ser vad diagrammet kom ifrån och kan tolka om.
      setVisaText(begäran.start === "regler" || begäran.start === "ai");
      if (begäran.start === "mall") setShowMall(true);
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
    // Bara på en NY begäran (nonce), aldrig när callbacken råkar bytas ut –
    // annars hade en omrendering börjat om på processen och kastat arbetet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nyProcess]);

  const onLabelChange = useCallback((id: string, label: string) => {
    // Auto-noder (slut-event som notationen lade till) är inga steg i
    // mellanlagret. De döps om via ett åsidosättande på nod-id i stället, så att
    // ett auto-slut alltid går att redigera.
    setDraft((d) =>
      d.steps.some((s) => s.id === id)
        ? updateStep(d, id, { text: label })
        : setAutoLabel(d, id, label),
    );
  }, []);

  /** Manuellt flyttat objekt – positionen sparas med flödet. */
  const onPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    // Auto-noder (slut-event som notationen lade till) är inga steg – deras läge
    // sparas som ett åsidosättande på nod-id i stället, så att de går att flytta.
    setDraft((d) =>
      d.steps.some((s) => s.id === id)
        ? setStepPosition(d, id, position)
        : setAutoPosition(d, id, position),
    );
  }, []);

  /**
   * Objekt släppt i en ANNAN simbanas band → byt bana på riktigt. Det gamla
   * läget nollas – det låg i förra banans koordinatram och skulle annars dra
   * upp den nya banan runt sig.
   */
  const onLaneChange = useCallback((id: string, laneId: string) => {
    const m = filteredRef.current;
    const förra = m?.nodes.find((n) => n.id === id)?.laneId ?? m?.dataStores.find((ds) => ds.id === id)?.laneId;
    if (förra) setBehållnaBanor((b) => new Set(b).add(förra));
    // allLanes: en bana som bara fanns genom sina steg står kvar i modellen när den töms.
    setDraft((d) => {
      const med = { ...d, lanes: allLanes(d) };
      return d.steps.some((s) => s.id === id)
        ? updateStep(med, id, { laneId, position: null })
        : setAutoLane(med, id, laneId);
    });
  }, []);

  /**
   * Objekt släppt på en ANNAN del/bild i flersidigt läge → pinna det dit.
   * Hänvisningarna försvinner/uppstår och kopplingarna ritas om automatiskt,
   * eftersom allt härleds ur deltillhörigheten. Släppunkten (i måldelens fria
   * koordinater) sparas så objektet stannar där det släpptes.
   */
  const onPageMove = useCallback((id: string, page: number, position?: { x: number; y: number }) => {
    setDraft((d) => {
      let next = setPagePin(d, id, page);
      if (position) {
        next = next.steps.some((s) => s.id === id)
          ? setStepPosition(next, id, position)
          : setAutoPosition(next, id, position);
      }
      return next;
    });
  }, []);

  /** Textstorlek/-placering för ett markerat objekt. */
  const onTextStyleChange = useCallback(
    (id: string, patch: { textSize?: number; textPlacement?: TextPlacement }) => {
      setDraft((d) => setTextStyle(d, id, patch));
    },
    [],
  );

  /** Omdragen kantände – den valda kopplingspunkten sparas med flödet. */
  const onEdgeSidesChange = useCallback(
    (
      source: string,
      target: string,
      sides: { sourceSide?: EdgeSide; targetSide?: EdgeSide },
      label?: string,
    ) => {
      setDraft((d) => setEdgeSides(d, source, target, sides, label));
    },
    [],
  );

  /** Dragen brytpunkt på en koppling (fri-koordinater) sparas med flödet. */
  const onEdgeWaypointChange = useCallback(
    (source: string, target: string, point: { x: number; y: number } | null, label?: string) => {
      setDraft((d) => setEdgeWaypoint(d, source, target, point, label));
    },
    [],
  );

  /** Etikettens läge längs kopplingen (andel 0–1, null = automatiskt). */
  const onEdgeLabelPosChange = useCallback(
    (source: string, target: string, andel: number | null, label?: string) => {
      setDraft((d) => setEdgeLabelPos(d, source, target, andel, label));
    },
    [],
  );
  /**
   * Etikettens TEXT (dubbelklick på kopplingen). Regeln bor i mellanlagret: en
   * gren är hela grenen och dess nycklar migreras, en handritad pil är ett fält.
   */
  const onEdgeLabelTextChange = useCallback(
    (source: string, target: string, nuvarande: string | undefined, ny: string) => {
      setDraft((d) => setEdgeLabel(d, source, target, nuvarande, ny));
    },
    [],
  );
  /** Varför en etikett inte går att sätta – visas medan man skriver. */
  const etikettHinderFör = useCallback(
    (source: string, nuvarande: string | undefined, ny: string) =>
      etikettHinder(draft, source, nuvarande, ny),
    [draft],
  );

  /** Utdragen swimlane-höjd sparas med flödet (null = auto). */
  const onLaneResize = useCallback((laneId: string, height: number | null, page?: number) => {
    setDraft((d) => setLaneHeight(d, laneId, height, page));
  }, []);

  /** Döljer en sidhänvisning som användaren klickat bort. */
  const onPageRefHide = useCallback(
    (source: string, target: string, sida: "in" | "ut") => {
      setDraft((d) => setPageRefHidden(d, source, target, sida, true));
    },
    [],
  );

  /** Tillbaka till automatisk kopplingspunkt för en kant. */
  const onEdgeSidesReset = useCallback((source: string, target: string, label?: string) => {
    setDraft((d) => resetEdgeSides(d, source, target, label));
  }, []);

  /** Tar bort en koppling ur diagrammet. Etiketten skiljer parallella pilar åt. */
  const onEdgeRemove = useCallback((source: string, target: string, label?: string) => {
    setDraft((d) => removeEdge(d, source, target, label));
  }, []);

  /** Släpper alla manuella positioner och låter auto-layouten ta över igen. */
  const resetLayout = useCallback(() => {
    setDraft((d) => clearPositions(d));
    setRegenKey((k) => k + 1);
  }, []);

  const model = useMemo(() => compileDraft(draft), [draft]);
  const filtered = useMemo(() => filterByPerspective(model, perspective), [model, perspective]);
  filteredRef.current = filtered;
  /** Det som ritas på ytan. Bara här står tömda banor kvar – bilder och export läser `filtered`. */
  const ritad = useMemo(
    () => (behållnaBanor.size ? filterByPerspective(model, perspective, behållnaBanor) : filtered),
    [model, perspective, behållnaBanor, filtered],
  );
  /**
   * Figurförteckningen läser den FILTRERADE modellen – den bild som faktiskt
   * ritas. I verksamhetsvyn är systemstegen dolda, och då ska faktarutan inte
   * heller påstå att bilden innehåller en systemruta. Färgläget följer med av
   * samma skäl: i strikt BPMN är formerna färglösa också i rutan.
   */
  const figurer = useMemo(() => flödesFigurer(filtered, colorMode), [filtered, colorMode]);

  /**
   * Objekten användaren markerat på ytan, och avståndet mellan dem. Kolumnerna
   * räknas på det som RITAS (`ritad`), samma modell som layouten på ytan.
   */
  const [markerade, setMarkerade] = useState<string[]>([]);
  const avståndMål = useMemo(() => avståndsMål(computeRanks(ritad), markerade), [ritad, markerade]);
  const ändraAvstånd = useCallback(
    (faktor: number) => {
      if (avståndMål) setDraft((d) => setKolumnAvstånd(d, avståndMål, faktor));
    },
    [avståndMål, setDraft],
  );
  /**
   * Kanterna i vyn kan vara genvägar förbi dolda noder och motsvarar då inget
   * verkligt nodpar i modellen. Bara verkliga par går att ändra.
   */
  /**
   * Kopplingar som går att ta bort och justera. Numera ALLA sorter – även de
   * streckade, som tidigare var helt inerta.
   */
  const editablePairs = useMemo(
    () =>
      new Set([
        ...model.edges.map((e) => `${e.source}->${e.target}`),
        ...model.dataAssociations.map((a) =>
          a.direction === "write" ? `${a.nodeId}->${a.dataStoreId}` : `${a.dataStoreId}->${a.nodeId}`,
        ),
        ...model.messageFlows.map((f) => `${f.nodeId}->${f.poolId}`),
      ]),
    [model.edges, model.dataAssociations, model.messageFlows],
  );

  const ångraNu = useCallback(() => setHistorik(ångra), []);
  const göraOmNu = useCallback(() => setHistorik(göraOm), []);

  // Ctrl+Z / Ctrl+Shift+Z (och Cmd på Mac). Fångas inte när markören står i ett
  // textfält – där ska webbläsarens egen ångra gälla.
  useEffect(() => {
    const tangent = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const m = e.target as HTMLElement | null;
      if (m && (m.tagName === "TEXTAREA" || m.tagName === "INPUT" || m.isContentEditable)) return;
      e.preventDefault();
      setHistorik(e.shiftKey ? göraOm : ångra);
    };
    window.addEventListener("keydown", tangent);
    return () => window.removeEventListener("keydown", tangent);
  }, []);

  /**
   * Tillbaka till det som senast sparades eller öppnades. `savedSnapshot` är
   * redan den exakta ögonblicksbilden – den används för att avgöra om något
   * är osparat, och duger lika bra för att återställa.
   */
  const återställTillSparat = useCallback(() => {
    if (!savedSnapshot) return;
    const s = JSON.parse(savedSnapshot) as { rawText: string; aiText: string; draft: ProcessDraft };
    setRawText(s.rawText);
    setAiText(s.aiText);
    setDraftBrytpunkt(s.draft);
    setRegenKey((k) => k + 1);
  }, [savedSnapshot, setDraftBrytpunkt]);

  /** Tillbaka till tolkningen av texten – regler eller AI, som flödet kom in. */
  const återställTillInläst = useCallback(() => {
    if (draft.meta.origin === "ai" && aiText.trim()) generateFromAiText();
    else generateFromRules();
  }, [draft.meta.origin, aiText, generateFromAiText, generateFromRules]);

  /**
   * Mallen körd: flödet byggs ur den, och beskrivningsrutan fylls med samma
   * flöde i pilformat. Texten är inte källan – mallen är det – men den gör
   * flödet läsbart och redigerbart på samma sätt som allt annat.
   */
  const användMall = useCallback(
    (mall: Mall) => {
      setRawText(mallSomText(mall));
      setAiText("");
      setTab("raw");
      // Fortsätter man på ett flöde behålls det som gjorts på ritytan.
      setDraftBrytpunkt(fortsättMedMall(draft, mall));
      setFlowName(mall.titel.trim() || "Nytt flöde");
      setRegenKey((k) => k + 1);
      setShowMall(false);
    },
    [draft, setDraftBrytpunkt],
  );

  /**
   * Underlaget för "Förenkla och presentera" – HELA modellen, inte den
   * perspektivfiltrerade: presentationen ska berätta processen, inte vyn.
   */
  const [presArbetar, setPresArbetar] = useState(false);
  const presentationsKälla = useCallback(
    () => ({
      flödeId: flowId ?? idUrNamn(flowName),
      namn: flowName,
      beskrivning: aiText.trim() || rawText,
      struktur: underlag(model),
    }),
    [flowId, flowName, aiText, rawText, model],
  );

  /**
   * Utvärdera flödet med AI. Går att göra när som helst, och ändrar ingenting –
   * resultatet är en läslista.
   */
  const körUtvärdering = useCallback(async () => {
    setReviewBusy(true);
    setReviewFel(null);
    try {
      setUtvärdering(await begärUtvärdering(filtered));
    } catch (err) {
      setReviewFel(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewBusy(false);
    }
  }, [filtered]);

  /**
   * Nytt objekt placerat ur verktygsradens palett.
   *
   * Objektet läggs FRITT: det ritas men kedjas inte in, så flödet ritas inte om
   * och ingenting ser ut att försvinna. Det knyts in först när man drar en
   * koppling till eller från det. Samma princip som affärsprocesspalettens placering,
   * och av samma skäl.
   */
  const onObjektPlacera = useCallback(
    (typ: NodeType, position: { x: number; y: number }, laneId: string) => {
      setDraft((d) =>
        läggTillFritt(d, {
          type: typ,
          text: TYPE_LABEL[typ],
          laneId,
          position,
          /**
           * SYNS I BÅDA VYERNA. Utan detta ärver objektet banans standard, och
           * banor som SharePoint och Power Automate räknas som tekniska – ett
           * objekt man just placerat försvann då i verksamhetsvyn, tillsammans
           * med kopplingen till det. Banans standard är en gissning för TOLKAD
           * text; ett objekt man lagt dit för hand är ett uttryckligt val.
           */
          perspectives: ["business", "system"],
        }).draft,
      );
    },
    [],
  );

  /** Ny koppling dragen för hand i canvasen. */
  const onEdgeAdd = useCallback((source: string, target: string) => {
    setDraft((d) => addManualEdge(d, source, target));
  }, []);
  const report = useMemo(() => validateModel(model), [model]);

  /* ------------------------------------------------------------------ */
  /* Exportens källa                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Mellanlagret som exporten utgår från. Identitetsjämförelsen mot `draft` är
   * medveten: i normalfallet ("det jag ser") ska modellen INTE kompileras en
   * andra gång – exporten och canvasen måste vara samma bild, inte två bilder
   * som råkar bli lika.
   */
  const exportDraft = exporterarFastslagen ? fastslagen!.version.draft : draft;
  const exportModel = useMemo(
    () => (exportDraft === draft ? model : compileDraft(exportDraft)),
    [exportDraft, draft, model],
  );
  const exportFiltered = useMemo(
    () => (exportModel === model ? filtered : filterByPerspective(exportModel, perspective)),
    [exportModel, model, filtered, perspective],
  );

  // Samma layout som canvas använder – så export matchar skärmen exakt.
  // (Vid "fastslagen version" matchar den i stället huvudversionens innehåll,
  //  men med samma sidformat och skala, för det är figurens format i dokumentet.)
  const exportLayout = useMemo(
    () => {
      const fmt = PAGE_FORMATS[pageFormat];
      return layoutModel(exportFiltered, {
        pageWidth: fmt.width,
        pageHeight: fmt.width && fmt.aspect ? fmt.width * fmt.aspect : null,
        scale,
        shrinkToContent: fmt.aspect === null,
        spacing,
      });
    },
    [exportFiltered, pageFormat, scale, spacing],
  );

  /**
   * Revisionsstämpeln. Exporterar man huvudversionen är bilden EXAKT den
   * versionen – då är den aldrig "ändrad sedan dess", hur mycket som än ligger
   * ouppsparat i editorn. Exporterar man det man ser gäller `dirty`.
   */
  const revision = useMemo(
    () =>
      exporterarFastslagen
        ? revisionAvVersion(sparatFlöde, fastslagen!.index, false)
        : revisionAvVersion(sparatFlöde, -1, dirty),
    [exporterarFastslagen, sparatFlöde, fastslagen, dirty],
  );

  const slug = (exportModel.title || "flodesschema").replace(/\s+/g, "_").toLowerCase();

  /**
   * Handtag till biblioteket, så att sparknappen i rubrikraden kör exakt samma
   * sparning som panelen (namnkrock, bekräftelser och statusval inräknade).
   */
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

  /** Antal saker granskningen har att säga – märket på rullgardinen. */
  const avvikelser = report.unaccounted.length + report.bpmn.length;

  /**
   * Har AI-beskrivningen ändrats sedan den tolkades? Bara då finns det något
   * att tillämpa – se `aiTextTolkad`.
   */
  const aiTextÄndrad = Boolean(aiText.trim()) && aiText.trim() !== aiTextTolkad.trim();

  /** Vilken figur som just kopierats – för kvittensen på knappen. */
  const [kopierad, setKopierad] = useState<number | null>(null);
  const [kopieringsFel, setKopieringsFel] = useState<string | null>(null);

  /** Kopierar EN figur som PNG till urklipp. */
  const kopieraFigur = useCallback(
    async (index: number) => {
      setKopieringsFel(null);
      try {
        const del = exportLayout.pages.length > 1 ? extractPage(exportLayout, index) : exportLayout;
        const { svg, width, height } = renderSvgSized(
          exportFiltered,
          del,
          colorMode,
          textScale,
          revision,
        );
        await copySvgAsPng(svg, width, height);
        setKopierad(index);
        setTimeout(() => setKopierad(null), 2000);
      } catch (e) {
        // Urklippet kräver en säker kontext och användarens tillåtelse; nekas
        // det ska användaren få veta varför i stället för att knappen tiger.
        setKopieringsFel(
          `Kunde inte kopiera: ${e instanceof Error ? e.message : String(e)}. Använd SVG-exporten i stället.`,
        );
      }
    },
    [exportLayout, exportFiltered, colorMode, textScale, revision],
  );

  /**
   * Arbetsytan.
   *
   * Ordningen uppifrån: VAD man arbetar med (rubriken), VAD man kan göra
   * (verktygsraden), och sedan ytan. Allt som förr låg i den 320 px breda
   * spalten finns kvar – men bakom namngivna rullgardiner, så att raden bär
   * frågan och panelen svaret. Ritytan får resten.
   */
  const behörighet = useBehörighet(flowId, flöden);
  return (
    <div className="ark-tool">
      <main className="ark-tool-main">
        <FlowHeader
          verktyg="Systemprocess"
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
              {/* Sparknappen visas i läsläge BARA när det finns något osparat –
                  lämnar man redigeringen med ändringar kvar får den inte
                  försvinna med verktygsraden. */}
              {(!läser || dirty) && (
                <button
                  className={`ark-btn ${läser ? "" : "ark-btn--primary"}`}
                  onClick={() => bibliotek.current?.spara()}
                  title={dirty ? "Spara ändringarna som en ny version" : "Allt är sparat"}
                >
                  {dirty ? "Spara •" : "Spara"}
                </button>
              )}
              {/* Flytta i katalogen – samma dialog som kortets knapp. Den som
                  står i processen ska kunna flytta den härifrån. */}
              {onFlytta && <FlyttaKnapp flowId={flowId} flöden={flöden} onFlytta={onFlytta} />}
              {/* Finns en visualisering av processen är den ett klick bort. */}
              <ÖppnaVisualisering flowId={flowId} serier={ramserier} onÖppna={onÖppnaRamserie} />
              {/* Publicera hos en applikation i EA-portalen – bara för ett SPARAT flöde. */}
              <PubliceraSystemprocessKnapp
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
                  name={flowName}
                  onNameChange={setFlowName}
                  kategori={kategori}
                  onKategoriChange={setKategori}
                  underkategori={underkategori}
                  onUnderkategoriChange={setUnderkategori}
                  rawText={rawText}
                  aiText={aiText}
                  draft={draft}
                  view={{ perspective, pageFormat, scale, colorMode, spacing, textScale }}
                  dirty={dirty}
                  currentId={flowId}
                  onSaved={(sparad) => {
                    setSavedSnapshot(snapshot);
                    // Sparningen kan ha skapat posten (nytt flöde) eller döpt om den.
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
                bredd={330}
                märke={avvikelser > 0 ? avvikelser : undefined}
                title="Utvärdering, spårbarhet och mellanlager"
              >
                {!läser && (
                <RullgardinDel titel="Utvärdering">
                  <button
                    className="ark-btn ark-btn--ai ark-btn--bred"
                    onClick={körUtvärdering}
                    disabled={reviewBusy || aiBusy || presArbetar}
                  >
                    {reviewBusy ? "Utvärderar …" : "✦ Utvärdera flödet med AI"}
                  </button>
                  {reviewFel && <p className="ark-hint ark-hint--warn">{reviewFel}</p>}
                  <p className="ark-hint">
                    Ger synpunkter – steg som kan slås ihop, saknade felvägar, otydliga namn – och{" "}
                    <strong>ändrar ingenting</strong>. Du bestämmer.
                  </p>
                </RullgardinDel>
                )}

                <RullgardinDel titel="Spårbarhet">
                  <button
                    className={`ark-trace-badge ${report.ok && report.bpmn.length === 0 ? "ok" : "warn"}`}
                    onClick={() => setShowTrace((s) => !s)}
                  >
                    {report.ok ? "✓" : "!"} {report.nodeCount} noder · {report.fragmentCount}{" "}
                    fragment
                    {report.unaccounted.length > 0 && ` · ${report.unaccounted.length} ohanterade`}
                    {` · BPMN: ${report.bpmn.length === 0 ? "OK" : `${report.bpmn.length} avvikelser`}`}
                  </button>
                </RullgardinDel>

                {!läser && (
                <RullgardinDel titel="Mellanlager">
                  <button
                    className={`ark-draft-badge ${draft.meta.origin === "ai" ? "ai" : ""}`}
                    onClick={() => setShowDraft((s) => !s)}
                  >
                    ⚙ {draft.steps.length} steg
                    <span>
                      {draft.meta.origin === "ai"
                        ? "AI"
                        : draft.meta.origin === "manual"
                          ? "justerat"
                          : "regler"}
                    </span>
                  </button>
                  <p className="ark-hint">
                    Det deterministiska mellanlagret mellan text och diagram. Här går varje steg att
                    rätta för hand.
                  </p>
                </RullgardinDel>
                )}
              </Rullgardin>

              <Rullgardin titel="Export" align="right" bredd={340} title="Kopiera till Word, eller spara som fil">
                {/* Källan står FÖRST: valet gäller allt nedanför, och låg det
                    under knapparna kunde man kopiera en figur utan att ha sett
                    att valet fanns. */}
                <RullgardinDel titel="Vad som exporteras">
                  <div className="ark-toggle">
                    <button
                      className={!exporterarFastslagen ? "active" : ""}
                      onClick={() => setExportKälla("aktuell")}
                      title="Exporterar diagrammet som det ser ut på skärmen just nu."
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
                      det du ser på skärmen. Revisionsrutan i figuren säger samma sak.
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
                        key={sida.number}
                        className="ark-btn"
                        onClick={() => kopieraFigur(i)}
                        title="Kopierar figuren som PNG – klistra in med Ctrl+V i Word"
                      >
                        {kopierad === i
                          ? "Kopierad ✓"
                          : exportLayout.pages.length === 1
                            ? "Kopiera figur"
                            : `Kopiera del ${sida.number}`}
                      </button>
                    ))}
                  </div>
                  {kopieringsFel && <p className="ark-hint ark-hint--warn">{kopieringsFel}</p>}
                  <p className="ark-hint">
                    Klistras in med <kbd>Ctrl</kbd>+<kbd>V</kbd>. Bilden rastreras i 3× så att den
                    håller även i utskrift.
                    {exportLayout.pages.length > 1 &&
                      " Delarna hänvisar till varandra, så de går att läsa i följd."}
                  </p>
                </RullgardinDel>

                <RullgardinDel titel="Som fil">
                  <div className="ark-export-grid">
                    <button
                      className="ark-btn"
                      onClick={() =>
                        download(
                          `${slug}.drawio`,
                          toDrawioXml(exportFiltered, exportLayout),
                          "application/xml",
                        )
                      }
                    >
                      draw.io XML
                    </button>
                    <button
                      className="ark-btn"
                      onClick={() => download(`${slug}.mmd`, toMermaid(exportFiltered), "text/plain")}
                    >
                      Mermaid
                    </button>
                    <button
                      className="ark-btn"
                      onClick={() =>
                        download(
                          `${slug}.svg`,
                          renderSvg(exportFiltered, exportLayout, colorMode, textScale, revision),
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
                          JSON.stringify(exportDraft, null, 2),
                          "application/json",
                        )
                      }
                    >
                      Mellanlager JSON
                    </button>
                  </div>
                </RullgardinDel>
              </Rullgardin>
            </>
          }
        >
          {/* Ångra, tolkning och beskrivning hör till REDIGERANDET. I läsläge
              blir de bara knappar som inte hör hemma där man bara tittar. */}
          {!läser && (
            <>
          <VradGrupp>
            <VradKnapp ikon onClick={ångraNu} disabled={!kanÅngra(historik)} title="Ångra (Ctrl+Z)">
              ↶
            </VradKnapp>
            <VradKnapp
              ikon
              onClick={göraOmNu}
              disabled={!kanGöraOm(historik)}
              title="Gör om (Ctrl+Skift+Z)"
            >
              ↷
            </VradKnapp>
            <Rullgardin titel="Återställ" bredd={300}>
              <p className="ark-hint">
                Ångra gäller diagrammet – flyttade objekt, banhöjder, kopplingar. Ett helt musdrag
                är ett steg. De här två går längre tillbaka.
              </p>
              <div className="ark-export-grid">
                <button
                  className="ark-btn"
                  disabled={!savedSnapshot || !dirty}
                  onClick={() => {
                    if (confirm("Kasta ändringarna sedan senaste sparning?")) återställTillSparat();
                  }}
                >
                  Till senast sparade
                </button>
                <button
                  className="ark-btn"
                  onClick={() => {
                    if (
                      confirm("Tolka om texten? Alla manuella ändringar i diagrammet försvinner.")
                    )
                      återställTillInläst();
                  }}
                >
                  Till inläst tolkning
                </button>
              </div>
              <p className="ark-hint">
                <strong>Till senast sparade</strong> kastar allt sedan du sparade;{" "}
                <strong>Till inläst tolkning</strong> går hela vägen tillbaka till{" "}
                {draft.meta.origin === "ai" ? "AI-tolkningen" : "regeltolkningen"} av texten.
              </p>
            </Rullgardin>
          </VradGrupp>

          <VradGrupp>
            <VradKnapp
              aktiv={visaText}
              onClick={() => setVisaText((v) => !v)}
              title="Texten diagrammet kommer ur"
            >
              ✎ Beskrivning
            </VradKnapp>
            <VradKnapp onClick={() => setShowMall(true)} title="Fyll i en mall i stället för fritext">
              ▦ Mall
            </VradKnapp>
            {aiVäg !== "av" && <VradKnapp
              ai
              onClick={() => void runBridge()}
              disabled={aiBusy || reviewBusy || presArbetar}
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
            <AvstandsKnappar
              värde={avståndMål && !locked ? avståndFör(avståndMål, draft.kolumnAvstånd) : null}
              onÄndra={ändraAvstånd}
            />
          </VradGrupp>
            </>
          )}

          {/* Alltid framme i REDIGERINGSLÄGET; i läsläget tänds den när processen
              är AI-tolkad. Uppdraget rör inte den öppna processen – det
              skapar en ny bredvid. */}
          {(!läser || aiText.trim()) && (
            <VradGrupp>
              <PresentationsKnapp
                källa={presentationsKälla}
                upptagen={aiBusy || reviewBusy}
                onArbetar={setPresArbetar}
                onÖppnaFlöde={onÖppnaFlöde}
                onÖppnaRamserie={onÖppnaRamserie}
              />
            </VradGrupp>
          )}

          {/* Teckenförklaringen hör till LÄSANDET och ligger därför utanför
              redigeringsguarden – det är när man bara läser en process man
              behöver veta vad en romb eller en streckad pil betyder. */}
          <VradGrupp>
            <Figurförteckning
              grupper={figurer}
              tomText="Inget ritat än – här listas formerna och pilarna som används i processen."
            />
          </VradGrupp>

          <VradGrupp>
            <VradKnapp
              onClick={helskärm.öppna}
              title="Visa processen i helskärm – bara bilden, inget går att ändra. Esc avslutar."
            >
              ⛶ Helskärm
            </VradKnapp>
            <Rullgardin titel="Vy" bredd={320} title="Perspektiv, sidformat och färgläge">
              <RullgardinDel titel="Perspektiv">
                <div className="ark-toggle">
                  <button
                    className={perspective === "business" ? "active" : ""}
                    onClick={() => setPerspective("business")}
                  >
                    Verksamhet
                  </button>
                  <button
                    className={perspective === "system" ? "active" : ""}
                    onClick={() => setPerspective("system")}
                  >
                    System
                  </button>
                </div>
                <p className="ark-hint">
                  Verksamhetsvyn döljer systemsteg och integrationer och visar processen som den
                  ser ut för den som utför den.
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
                            : id === "a4p"
                              ? "A4 stå."
                              : "A4 ligg."}
                    </button>
                  ))}
                </div>
                {hiddenPageRefCount(draft) > 0 && (
                  <p className="ark-hint">
                    {hiddenPageRefCount(draft)} dold
                    {hiddenPageRefCount(draft) === 1 ? "" : "a"} sidhänvisning
                    {hiddenPageRefCount(draft) === 1 ? "" : "ar"}.{" "}
                    <button className="ark-linkbtn" onClick={() => setDraft(showAllPageRefs)}>
                      Visa alla igen
                    </button>
                  </p>
                )}
                <p className="ark-hint">
                  {pageFormat === "word" ? (
                    <>
                      Anpassat för inklistring i Word: {exportLayout.pages.length}{" "}
                      {exportLayout.pages.length === 1 ? "figur" : "figurer"}, nodtexten blir{" "}
                      <strong>{wordPointSize(exportLayout.width).toFixed(1)} pt</strong> i en
                      stående rapport. Skalreglaget påverkar inte det – Word skalar ändå bilden till
                      spaltbredden.
                    </>
                  ) : (
                    <>
                      Fri lägger hela flödet på en rad i rätt ordning. Övriga format delar ett för
                      brett flöde på flera delar i full skala, med alla banor på varje del.
                    </>
                  )}
                </p>
              </RullgardinDel>

              <RullgardinDel titel="Färg">
                <div className="ark-toggle">
                  <button
                    className={colorMode === "type" ? "active" : ""}
                    onClick={() => setColorMode("type")}
                  >
                    Typfärger
                  </button>
                  <button
                    className={colorMode === "bpmn" ? "active" : ""}
                    onClick={() => setColorMode("bpmn")}
                  >
                    Strikt BPMN
                  </button>
                </div>
                <p className="ark-hint">
                  Typfärger färglägger objekt efter typ (med teckenförklaring). Strikt BPMN är
                  färglöst – form och ikon bär typen, som specen föreskriver.
                </p>
              </RullgardinDel>
            </Rullgardin>

            <Rullgardin titel="Storlek" bredd={300} title="Objektens storlek, avstånd och textstorlek">
              <RullgardinDel titel="Storlek på objekt">
                <div className="ark-size-row">
                  <button
                    className="ark-btn ark-btn--icon"
                    onClick={() => setScale((s) => Math.max(0.6, +(s - 0.1).toFixed(2)))}
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={0.6}
                    max={1.4}
                    step={0.05}
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value))}
                    className="ark-range"
                  />
                  <button
                    className="ark-btn ark-btn--icon"
                    onClick={() => setScale((s) => Math.min(1.4, +(s + 0.1).toFixed(2)))}
                  >
                    +
                  </button>
                </div>
                <div className="ark-size-meta">
                  <span>
                    {Math.round(scale * 100)} %
                    {exportLayout.pages.length > 1 && (
                      <em title="Flödet är bredare än sidan och delas på flera sidor">
                        {" "}
                        · {exportLayout.pages.length} sidor
                      </em>
                    )}
                  </span>
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
                    title="Skalar all text – objekten behåller sin storlek. Markera ett objekt i diagrammet för att ändra bara dess text."
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

            {!läser && (
            <Rullgardin
              titel="Layout"
              bredd={320}
              aktiv={locked || (exportLayout.laneVarningar ?? []).length > 0}
            >
              <label className="ark-check">
                <input
                  type="checkbox"
                  checked={locked}
                  onChange={(e) => setLocked(e.target.checked)}
                />
                Lås layout
              </label>
              <button className="ark-btn ark-btn--bred" onClick={resetLayout}>
                Återställ positioner
              </button>
              {/* Banhöjden är användarens till 100 % – det här är bara ett RÅD. */}
              {(exportLayout.laneVarningar ?? []).map((v) => (
                <p key={v.laneId} className="ark-hint ark-hint--warn">
                  Banan <strong>{v.laneId}</strong>
                  {v.del !== undefined ? ` (del ${v.del + 1})` : ""} är {Math.round(v.höjd)} px –
                  innehållet behöver ca {v.rekommenderad} px.{" "}
                  <button
                    className="ark-linkbtn"
                    onClick={() => setDraft((d) => setLaneHeight(d, v.laneId, null, v.del))}
                  >
                    Återställ höjden
                  </button>
                </p>
              ))}
              <p className="ark-hint">
                Dra objekt fritt. Håll <kbd>Shift</kbd> medan du drar för att linjera med närmaste
                objekt – en röd hjälplinje visar vad du linjerar mot. (Markera flera med{" "}
                <kbd>Ctrl</kbd>.) <strong>Klicka på en pil</strong> för att välja kopplingspunkter –
                eller dra direkt i pilens ände.
              </p>
            </Rullgardin>
            )}
          </VradGrupp>
        </Verktygsrad>

        <div className="ark-arbetsyta">
          {/* Beskrivningen: textens plats i kedjan är FÖRE diagrammet, så
              panelen ligger till vänster om ytan – men bara när den behövs. */}
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
                    spellCheck={false}
                    placeholder="Titel på första raden, sedan steg separerade med → eller -"
                  />
                  <button className="ark-btn ark-btn--primary ark-btn--bred" onClick={generateFromRules}>
                    Tolka med regler
                  </button>
                  {aiVäg !== "av" && (
                    <button
                      className="ark-btn ark-btn--ai ark-btn--bred"
                      onClick={() => void runBridge()}
                      disabled={aiBusy || reviewBusy || presArbetar}
                    >
                      {aiBusy ? väntarText(aiVäg) : "✦ Tolka med AI"}
                    </button>
                  )}
                  {bridgeAbort && (
                    <button className="ark-linkbtn" onClick={() => bridgeAbort.abort()}>
                      Avbryt
                    </button>
                  )}
                  {aiError && <p className="ark-error">{aiError}</p>}
                  {aiVäg !== "av" && (
                    <p className="ark-hint">
                      {aiVäg === "api"
                        ? "AI-tolkningen görs av servern med installationens API-nyckel."
                        : "AI-tolkningen görs av Claude Code i utvecklarsessionen – servern har ingen API-nyckel."}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="ark-btn ark-btn--ai ark-btn--bred"
                    onClick={() => void runBridge()}
                    disabled={aiBusy || reviewBusy || presArbetar}
                  >
                    {aiBusy ? väntarText(aiVäg) : "✦ Tolka med AI"}
                  </button>
                  {aiError && <p className="ark-error">{aiError}</p>}
                  <label className="ark-field-label">AI-beskrivning</label>
                  <textarea
                    className="ark-textarea ark-textdock-text"
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    spellCheck={false}
                    placeholder="AI:ns tolkade och förtydligade version av din beskrivning visas här."
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
                    diagramType="flowchart"
                    upptagen={aiBusy || presArbetar}
                    väntarText={väntarText(aiVäg)}
                    onSkicka={(instruktion) => runBridge(undefined, instruktion)}
                  />}
                </>
              )}
            </aside>
          )}

          {/* Ritytan: allt som ligger ovanpå den (paneler, inspektörer) hör hemma
              HÄR inne, så att de positioneras mot bilden och inte mot rubriken. */}
          <div className={`ark-tool-stage ${helskärm.aktiv ? "ark-helskarm" : ""}`} ref={helskärm.ref}>
            {helskärm.aktiv && (
              <button className="ark-btn ark-helskarm-avsluta" onClick={helskärm.stäng} title="Avsluta helskärm (Esc)">
                ✕ Avsluta helskärm
              </button>
            )}
            <FlowCanvas
              onSelectionChange={setMarkerade}
              model={locked || läser || helskärm.aktiv ? filtered : ritad}
              locked={locked || läser || helskärm.aktiv}
              pageFormat={pageFormat}
              scale={scale}
              colorMode={colorMode}
              // Helskärm in/ut byter ritytans storlek – vyn anpassas på nytt.
              regenKey={regenKey + helskärm.byte}
              onLabelChange={onLabelChange}
              onPositionChange={onPositionChange}
              onLaneChange={onLaneChange}
              onPageMove={onPageMove}
              onTextStyleChange={onTextStyleChange}
              spacing={spacing}
              textScale={textScale}
              onEdgeSidesChange={onEdgeSidesChange}
              onEdgeWaypointChange={onEdgeWaypointChange}
              onEdgeLabelPosChange={onEdgeLabelPosChange}
              onEdgeLabelTextChange={onEdgeLabelTextChange}
              etikettHinder={etikettHinderFör}
              onEdgeSidesReset={onEdgeSidesReset}
              onLaneResize={onLaneResize}
              onEdgeRemove={onEdgeRemove}
              onPageRefHide={onPageRefHide}
              onEdgeAdd={onEdgeAdd}
              onObjektPlacera={onObjektPlacera}
              kopplingHinder={(s2, t) => kopplingHinder(draft, s2, t)}
              editablePairs={editablePairs}
              // Ett formulär över ritytan tar hela uppmärksamheten: mallen,
              // mellanlagret, granskningen och spårbarheten. Då hör inte
              // ritverktygen hemma ovanpå det.
              visaVerktyg={!(showMall || showDraft || showTrace || Boolean(utvärdering))}
            />
            {showMall && <TemplatePanel
                namn={flowName}
                mall={draft.steps.length ? draftTillMall(draft) : undefined}
                onClose={() => setShowMall(false)} onApply={användMall} />}
            {utvärdering && (
              <ReviewPanel
                utvärdering={utvärdering}
                model={filtered}
                busy={reviewBusy}
                onKörIgen={körUtvärdering}
                onClose={() => setUtvärdering(null)}
              />
            )}
            {showDraft && (
              <DraftPanel draft={draft} onChange={setDraft} onClose={() => setShowDraft(false)} />
            )}
            {showTrace && <TracePanel report={report} onClose={() => setShowTrace(false)} />}
          </div>
        </div>
      </main>
    </div>
  );
}
