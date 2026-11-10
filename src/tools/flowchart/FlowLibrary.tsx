/**
 * Flödesbiblioteket i panelen: spara nuvarande arbete, öppna ett tidigare,
 * bläddra i versionshistoriken och återgå till en äldre version.
 *
 * Komponenten äger ingen processdata – den får allt via props och rapporterar
 * tillbaka. Det håller FlowchartTool som enda ägare av tillståndet, så att
 * "öppna flöde" och "återgå till version" alltid återställer HELA kedjan
 * (råtext, AI-beskrivning, mellanlager, vyinställningar) i ett enda svep.
 */

import { kanTaBort } from "@/core/behorighet";
import { useAnvändare, useInloggningsläge } from "@/shell/Inloggning";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  familyPrefix,
  flowFamily,
  getFlowStore,
  meddelaFlödenÄndrade,
  saveFlowVersion,
  skaparNyVersion,
  type FlowStore,
  type FlowSummary,
  type FlowVersion,
  type FlowView,
  type SavedFlow,
} from "@/core/flow-store";
import type { ProcessDraft } from "@/core/draft";
import { kategoriTitlar, underkategoriTitlar } from "@/core/flow-tree";
import { KategoriVal } from "@/shell/KategoriVal";
import {
  STATUSAR,
  nuvarandeBeteckning,
  nuvarandeStatus,
  statusDef,
  versionsBeteckningar,
  type FlowStatus,
} from "@/core/status";

/** Signaturen minns mellan sessioner – man skriver sitt namn en gång. */
export const SIGNATUR_NYCKEL = "ark.signatur";

export interface FlowLibraryProps {
  name: string;
  onNameChange: (name: string) => void;
  /**
   * Kategorin i katalogen. Egen prop och inte en del av draften: kategorin är
   * en uppgift om FLÖDET, precis som namnet, och att flytta en process mellan
   * samlingar är därför inte en ny version av processen (invariant 11).
   */
  kategori: string;
  onKategoriChange: (kategori: string) => void;
  /** Underkategorin – nivån under kategorin. Samma resonemang som kategorin. */
  underkategori: string;
  onUnderkategoriChange: (underkategori: string) => void;
  rawText: string;
  aiText: string;
  draft: ProcessDraft;
  view: FlowView;
  /** true när något ändrats sedan senaste sparning. */
  dirty: boolean;
  /**
   * Id:t på flödet som redigeras just nu (null = osparat, nytt). Ägs av
   * verktyget, för flödet kan öppnas både härifrån och ur skalets meny – och
   * markeringen "det HÄR redigerar du" måste stämma oavsett vilken väg man tog.
   */
  currentId: string | null;
  onSaved: (flow: SavedFlow) => void;
  onOpen: (flow: SavedFlow) => void;
  onNew: () => void;
  /**
   * Verktygsfamilj: lagringen delas men varje verktyg ser bara sina egna
   * flöden. "affarsprocess" = Affärsprocess; saknas = flödesschemat.
   */
  family?: "flode" | "affarsprocess";
}

/**
 * Handtag för sparknappen i arbetsraden.
 *
 * Sparningen bor här – den känner status, beteckningar, namnkrockar och
 * bekräftelserna – men KNAPPEN hör hemma i rubrikraden, där man ser att något
 * är osparat. Ett handtag i stället för en flyttad funktion: allt som gör
 * sparningen svår (förvalen, förhandsbeskedet) skulle annars behöva flyttas
 * med, och då hade panelen och knappen kunnat säga olika saker.
 */
export interface FlowLibraryHandle {
  /**
   * Sparar. `status` tvingar statusen på sparningen (publiceringsrutan
   * fastslår så) – samma bekräftelse som annars. Löftet ger det sparade
   * flödet, eller null om inget sparades (avbrutet, namnkrock, fel).
   */
  spara: (status?: FlowStatus) => Promise<SavedFlow | null>;
  /** true medan en sparning pågår. */
  upptagen: boolean;
}

export const FlowLibrary = forwardRef<FlowLibraryHandle, FlowLibraryProps>(function FlowLibrary(
  {
    name,
    onNameChange,
    kategori,
    onKategoriChange,
    underkategori,
    onUnderkategoriChange,
    rawText,
    aiText,
    draft,
    view,
    dirty,
    currentId,
    onSaved,
    onOpen,
    onNew,
    family = "flode",
  },
  ref,
) {
  const [store, setStore] = useState<FlowStore | null>(null);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  /**
   * Vem som justerar. Appen har ingen inloggning, så namnet skrivs en gång och
   * minns i webbläsaren – det följer med varje version och hamnar i exportens
   * revisionsruta.
   */
  const [egenSignatur, setSignatur] = useState(() => localStorage.getItem(SIGNATUR_NYCKEL) ?? "");
  /** Med inloggning VET vi vem som sparar – då är det kontots namn, inte ett fritt fält. */
  const användare = useAnvändare();
  const inloggad = useInloggningsläge() !== "öppen";
  const signatur = inloggad ? användare.namn : egenSignatur;
  /** Flödet vars historik visas – laddas när man sparar eller öppnar. */
  const [openedFlow, setOpenedFlow] = useState<SavedFlow | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  /**
   * Användarens EGNA statusval, eller null när hon inte rört väljaren för det
   * här flödet. Förvalet räknas då fram (se `status` nedan).
   *
   * Två tillstånd och inte ett: förvalet beror på om något är ändrat, och ett
   * uttryckligt val måste kunna stå kvar även när man skriver vidare. Slog man
   * ihop dem försvann antingen valet vid nästa tangenttryck, eller så låg en
   * fastslagning kvar och gjorde nästa sparning till en huvudversion också.
   */
  const [statusVal, setStatusVal] = useState<FlowStatus | null>(null);

  const refresh = useCallback(
    async (s: FlowStore) => {
      try {
        // Varje verktyg ser bara sin egen familj – annars blandas affärsprocesser
        // in i flödesschemats lista och tvärtom.
        const alla = await s.list();
        setFlows(alla.filter((f) => flowFamily(f.id) === family));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [family],
  );

  useEffect(() => {
    let alive = true;
    getFlowStore().then((s) => {
      if (!alive) return;
      setStore(s);
      void refresh(s);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  /**
   * Versionslistan ska visa det flöde som FAKTISKT redigeras, även när det
   * öppnades ur skalets meny (då gick öppningen aldrig genom den här
   * komponenten). Verktyget äger id:t; posten läses hit när det byts.
   */
  /**
   * Har användaren RÖRT placeringsväljarna för det här flödet?
   *
   * Sparningen skickar bara med kategori och underkategori när svaret är ja.
   * Annars behåller filen sin placering – KATALOGEN äger den (invariant 11),
   * och verktyget läser den bara när flödet öppnas. Flyttade man processen i
   * katalogen medan den låg öppen skrev nästa sparning tillbaka det gamla
   * värdet, och flytten "återuppstod på sin gamla plats" (2026-09-07).
   */
  const placeringRörd = useRef(false);

  // Byter man flöde släpps ett eget statusval – annars hade en fastslagning man
  // gjorde i ett flöde följt med in i nästa. Samma sak för placeringsvalet:
  // det gäller flödet man gjorde det i.
  useEffect(() => {
    setStatusVal(null);
    placeringRörd.current = false;
  }, [currentId]);

  useEffect(() => {
    if (!store) return;
    if (!currentId) {
      setOpenedFlow(null);
      return;
    }
    if (openedFlow?.id === currentId) return;
    let alive = true;
    store
      .load(currentId)
      .then((f) => alive && setOpenedFlow(f))
      .catch(() => alive && setOpenedFlow(null));
    return () => {
      alive = false;
    };
  }, [store, currentId, openedFlow?.id]);

  /**
   * Flödet som FAKTISKT redigeras – posten bara när den hör till verktygets id.
   *
   * `openedFlow` släpps först i en effekt när verktyget börjat på en ny process,
   * men en ny process sparas direkt i en effekt i samma commit – och den
   * sparningen läste då FÖREGÅENDE flödet. Den nya processen frågade "Byta
   * namn på …?" och blev en ny version av den gamla i stället för en egen
   * (2026-10-20, "Möte i ledningsgruppen 2").
   */
  const aktuellt = openedFlow?.id === currentId ? openedFlow : null;

  /* ---- Status och numrering. Beteckningarna räknas ALLTID fram ur historikens
     statusar (core/status.ts) – både för versionslistan och för förhandsbeskedet
     i sparraden, så att "sparningen blir 2.0" inte kan säga något annat än vad
     sparningen faktiskt gör. ---- */
  const historik = aktuellt?.versions ?? [];
  const beteckningar = versionsBeteckningar(historik);
  const nuStatus = nuvarandeStatus(historik);
  const nuBeteckning = nuvarandeBeteckning(historik);
  /**
   * Har innehållet (eller kommentaren) ändrats? Samma fråga som ovan men med
   * statusen neutraliserad, så att förvalet nedan kan bero på den utan att bli
   * cirkulärt.
   *
   * `dirty` duger inte: efter en återgång till en äldre version är ingenting
   * "osparat", men innehållet skiljer sig från historikens sista post.
   */
  const innehålletÄndrat =
    !aktuellt ||
    skaparNyVersion(aktuellt.versions, { rawText, aiText, draft, label, status: nuStatus });
  /**
   * Statusen sparningen får.
   *
   * Förvalet är utkast så snart det finns något att spara – har man ritat om
   * flödet är det INTE längre den fastslagna versionen, och en fastslagning ska
   * alltid vara ett aktivt beslut. Men i ett ORÖRT flöde är förvalet flödets
   * egen status: annars degraderade ett tryck på Spara ett fastslaget flöde till
   * ett utkast utan att någonting hade ändrats.
   */
  const status: FlowStatus = statusVal ?? (innehålletÄndrat ? "utkast" : nuStatus);
  /**
   * Skapar sparningen en ny version? Frågan ställs till LAGRINGEN, inte till
   * `dirty`: efter en återgång till en äldre version är ingenting "osparat",
   * men innehållet skiljer sig ändå från historikens sista post – och då hade
   * ett eget villkor här lovat "inget nytt att spara" strax innan lagringen
   * skrev en version.
   */
  const skaparVersion =
    !aktuellt || skaparNyVersion(aktuellt.versions, { rawText, aiText, draft, label, status });
  const nästaBeteckning = skaparVersion
    ? versionsBeteckningar([...historik, { status }]).slice(-1)[0]
    : nuBeteckning;
  /** Panelens val – sparningen nedan kan tvinga en annan status. */
  const valdStatus = status;
  const valdNästaBeteckning = nästaBeteckning;

  const save = async (tvingadStatus?: FlowStatus): Promise<SavedFlow | null> => {
    if (!store || !name.trim()) return null;
    const status = tvingadStatus ?? valdStatus;
    const nästaBeteckning = tvingadStatus
      ? versionsBeteckningar([...historik, { status }]).slice(-1)[0]
      : valdNästaBeteckning;
    /**
     * Sparar man ett ÖPPNAT flöde uppdateras just det flödet – id:t följer med
     * även när namnet ändrats. Annars klonades flödet till ett nytt med samma
     * namn, och biblioteket fylldes av par som inte gick att skilja åt.
     * Namnbytet bekräftas, för alternativet (en kopia) måste vara ett aktivt val.
     */
    let id = aktuellt?.id;
    if (aktuellt && name.trim() !== aktuellt.name) {
      const byt = confirm(
        `Byta namn på "${aktuellt.name}" till "${name.trim()}"?\n\n` +
          "OK = döp om flödet (historiken följer med).\n" +
          "Avbryt = spara som ett NYTT flöde.",
      );
      if (!byt) id = undefined;
    }
    // Ett nytt flöde får inte heta samma sak som ett befintligt – två poster
    // med identiska namn går inte att skilja åt i listan.
    if (!id && flows.some((f) => f.name.trim() === name.trim())) {
      setError(`Det finns redan ett flöde som heter "${name.trim()}". Välj ett annat namn.`);
      return null;
    }
    /**
     * Att fastslå bekräftas. Det är inte en vanlig sparning: huvudversionen är
     * det som andra exporterar och hänvisar till, och den går inte att ta
     * tillbaka – historiken skrivs aldrig om, bara på.
     */
    if (
      status === "fastslagen" &&
      !confirm(
        `Fastslå "${name.trim()}" som version ${nästaBeteckning}?\n\n` +
          "Det blir den huvudversion som gäller, och den som exporteras när du\n" +
          "väljer \"Fastslagen version\". Historiken kan inte skrivas om –\n" +
          "vill du ändra något efteråt blir det en ny version.",
      )
    )
      return null;
    setBusy(true);
    try {
      const saved = await saveFlowVersion(store, {
        id,
        name,
        // `undefined` = rörde den inte, behåll filens placering. En NY process
        // har ingen fil att bevara – där kommer placeringen ur formuläret och
        // måste skrivas.
        ...(placeringRörd.current || !aktuellt
          ? { category: kategori, subcategory: underkategori }
          : {}),
        rawText,
        aiText,
        draft,
        view,
        label,
        savedBy: signatur,
        status,
        idPrefix: familyPrefix(family),
      });
      setOpenedFlow(saved);
      setLabel("");
      // Valet släpps: en fastslagning gäller den version man just skapade, inte
      // allt man gör härefter. Härefter styr förvalet igen.
      setStatusVal(null);
      await refresh(store);
      meddelaFlödenÄndrade();
      onSaved(saved);
      setError(null);
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  /**
   * En sparning som begärdes INNAN lagringen hunnit svara.
   *
   * `save` avbryter tyst utan store, och store hämtas asynkront när
   * komponenten monteras. Ett tryck på Spara under den första sekunden – eller
   * en ny process som ska läggas in direkt när den skapas – försvann därför
   * spårlöst. Begäran läggs på minnet i stället och körs när lagringen finns.
   */
  const [väntandeSparning, setVäntandeSparning] = useState(false);
  /** Alltid den FÄRSKA sparningen (den läser namn, kategori och draft ur props). */
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!väntandeSparning || !store) return;
    setVäntandeSparning(false);
    void saveRef.current();
  }, [väntandeSparning, store]);

  /**
   * Sparknappen i arbetsraden kör EXAKT den här sparningen – inte en egen
   * kopia. Namnkrock, bekräftelse vid namnbyte och bekräftelse vid fastslagning
   * gäller därför oavsett var man tryckte.
   */
  useImperativeHandle(ref, () => ({
    spara: async (status?: FlowStatus) => {
      if (store) return save(status);
      setVäntandeSparning(true);
      return null;
    },
    upptagen: busy,
  }));

  /* Att ÖPPNA ett flöde sker i skalets meny – se AppShell. Panelen hade en egen
     lista också, och två navigeringar för samma sak gjorde panelen så lång att
     verktygen hamnade utanför skärmen. `onOpen` används fortfarande av
     "Återgå" nedan, som lägger en gammal version i editorn. */

  /**
   * Återgå: versionens innehåll läggs i editorn, men historiken rörs inte.
   * Sparar man därefter blir det en NY version – man kan alltså aldrig
   * förlora arbete genom att titta bakåt.
   */
  const restore = (flow: SavedFlow, v: FlowVersion) => {
    if (dirty && !confirm("Du har osparade ändringar. Återgå ändå?")) return;
    onOpen({ ...flow, rawText: v.rawText, aiText: v.aiText, draft: v.draft });
  };

  const remove = async (id: string, flowName: string) => {
    if (!store || !confirm(`Ta bort "${flowName}" med hela historiken? Det går inte att ångra.`))
      return;
    await store.remove(id);
    meddelaFlödenÄndrade();
    if (openedFlow?.id === id) setOpenedFlow(null);
    await refresh(store);
  };

  const versions = openedFlow
    ? openedFlow.versions.map((v, i) => ({ v, beteckning: beteckningar[i] })).reverse()
    : [];

  return (
    <div className="ark-section">
      <div className="ark-section-title">
        Flöden
        {store && (
          <span className="ark-store-kind" title={storeHint(store.kind)}>
            {store.kind === "disk" ? "sparas i projektet" : "sparas i webbläsaren"}
          </span>
        )}
      </div>

      <div className="ark-save-row">
        <input
          className="ark-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Namn på flödet"
          spellCheck={false}
        />
        <button
          className="ark-btn ark-btn--primary"
          onClick={() => void save()}
          disabled={busy || !name.trim()}
          title={dirty ? "Osparade ändringar" : "Allt är sparat"}
        >
          {dirty ? "Spara •" : "Spara"}
        </button>
      </div>
      <div className="ark-kategorirad">
        <label className="ark-field-label" htmlFor="ark-spara-kategori">
          Kategori i katalogen
        </label>
        <KategoriVal
          id="ark-spara-kategori"
          värde={kategori}
          kategorier={kategoriTitlar(flows)}
          onChange={(v) => {
            placeringRörd.current = true;
            onKategoriChange(v);
          }}
          tomEtikett="Ingen kategori"
        />
        <label className="ark-field-label" htmlFor="ark-spara-underkategori">
          Underkategori
        </label>
        <KategoriVal
          id="ark-spara-underkategori"
          värde={underkategori}
          // Bara grenarna i den kategori flödet faktiskt hamnar i.
          kategorier={underkategoriTitlar(flows, kategori)}
          onChange={(v) => {
            placeringRörd.current = true;
            onUnderkategoriChange(v);
          }}
          tomEtikett="Ingen – dela in automatiskt"
          nivå="underkategori"
        />
      </div>

      <div className="ark-save-meta">
        <input
          className="ark-input ark-label-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Kommentar på versionen (valfritt)"
          spellCheck={false}
        />
        <input
          className="ark-input ark-signatur-input"
          value={signatur}
          readOnly={inloggad}
          onChange={(e) => {
            setSignatur(e.target.value);
            localStorage.setItem(SIGNATUR_NYCKEL, e.target.value);
          }}
          placeholder="Ditt namn"
          title={
            inloggad
              ? "Du är inloggad – namnet följer med versionen och visas i exportens revisionsruta"
              : "Följer med versionen och visas i exportens revisionsruta"
          }
          spellCheck={false}
        />
      </div>

      <div className="ark-status-val">
        <div className="ark-status-rad">
          <span className="ark-status-etikett">Status på sparningen</span>
          {openedFlow && (
            <span className={`ark-status-pill ${nuStatus}`} title="Vad flödet står på just nu">
              nu: {nuBeteckning} · {statusDef(nuStatus).etikett}
            </span>
          )}
        </div>
        <div className="ark-toggle">
          {STATUSAR.map((s) => (
            <button
              key={s.id}
              className={status === s.id ? "active" : ""}
              onClick={() => setStatusVal(s.id)}
              title={s.beskrivning}
            >
              {s.etikett}
            </button>
          ))}
        </div>
        <p className="ark-hint">
          {skaparVersion ? (
            <>
              Sparningen blir <strong>{nästaBeteckning}</strong>
              {status === "fastslagen"
                ? " – en ny huvudversion. Den kan exporteras för sig, oavsett vad du gör sedan."
                : ". Utkast gäller inte; exporten märker dem som arbetsmaterial."}
            </>
          ) : (
            <>
              Inget nytt att spara – flödet står redan på <strong>{nuBeteckning}</strong>.
            </>
          )}
        </p>
      </div>

      {error && <p className="ark-error">{error}</p>}

      {openedFlow && versions.length > 0 && (
        <div className="ark-versions">
          <button className="ark-versions-toggle" onClick={() => setShowVersions((s) => !s)}>
            {showVersions ? "▾" : "▸"} Versioner av "{openedFlow.name}" ({versions.length})
          </button>
          {showVersions && (
            <ul className="ark-version-list">
              {versions.map(({ v, beteckning }, i) => (
                <li key={v.id} className={i === 0 ? "latest" : ""}>
                  <div className="ark-version-info">
                    {/* Beteckningen, inte v-id:t: den bär statusen. Huvud-
                        versionerna (x.0) markeras så att de går att hitta i en
                        lång lista av utkast. */}
                    <span
                      className={`ark-version-id ${statusDef(v.status).huvudversion ? "huvud" : ""}`}
                      title={`${statusDef(v.status).etikett} (${v.id})`}
                    >
                      {beteckning}
                    </span>
                    <span className={`ark-status-pill ${statusDef(v.status).id}`}>
                      {statusDef(v.status).etikett}
                    </span>
                    <span className="ark-version-when">
                      {formatDate(v.savedAt)}
                      {i === 0 && " · senaste"}
                    </span>
                    {v.label && <span className="ark-version-label">{v.label}</span>}
                    <span className="ark-version-meta">{v.draft.steps.length} steg</span>
                  </div>
                  <button
                    className="ark-btn ark-btn--tiny"
                    onClick={() => restore(openedFlow, v)}
                    disabled={busy}
                    title="Lägg tillbaka den här versionen i editorn"
                  >
                    Återgå
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* INGEN flödeslista här. Navigeringen bor i skalets meny (ärendetyp →
          målgrupp → flöde). Listan låg här också, och då fanns samma flöden på
          två ställen – panelen blev så lång att man fick skrolla förbi den för
          att nå verktygen. Panelen sköter bara DET ÖPPNA flödet. */}
      <div className="ark-flow-actions">
        <button
          className="ark-btn"
          onClick={() => {
            onNew();
            setOpenedFlow(null);
          }}
          disabled={busy}
        >
          + Nytt flöde
        </button>
        {openedFlow && kanTaBort(användare, flows.find((f) => f.id === openedFlow.id) ?? openedFlow) && (
          <button
            className="ark-linkbtn danger"
            onClick={() => remove(openedFlow.id, openedFlow.name)}
            disabled={busy}
            title="Tar bort flödet med hela historiken"
          >
            Ta bort "{openedFlow.name}"
          </button>
        )}
      </div>
    </div>
  );
});

function storeHint(kind: FlowStore["kind"]): string {
  return kind === "disk"
    ? "Flödena sparas som JSON-filer i projektmappen flows/ – de överlever webbläsarrensning."
    : "Dev-servern svarar inte, så flödena sparas i webbläsarens localStorage.";
}

/** Kort, läsbar tidsstämpel: "idag 14:32" eller "2026-07-18 14:32". */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "okänt";
  const tid = d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? `idag ${tid}`
    : `${d.toLocaleDateString("sv-SE")} ${tid}`;
}
