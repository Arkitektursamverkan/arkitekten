/**
 * Systemprompt för AI-tolkningen – EN per diagramtyp, byggd av samma delar.
 *
 * Varför prompten är så explicit: AI:n är ENDAST en tolk från ostrukturerad
 * text till mellanlagret. Den får aldrig hitta på steg och aldrig slå ihop
 * aktiviteter – för då bryts spårbarheten "antal aktiviteter i text = antal
 * i diagram", som hela verktyget vilar på. Vokabulären (nodtyper, swimlanes)
 * hålls medvetet identisk med regelmotorns, så att en AI-draft och en
 * regel-draft ger samma sorts diagram.
 *
 * Varför TVÅ prompter: Affärsprocess är ett eget verktyg med en egen metod
 * (vågrät förädlingskedja, roller som satelliter, inga simbanor). Med
 * flödesschemats prompt fick affärsprocesstolkningarna simbanetänk och noll
 * satelliter – metodens regler låg som ett frivilligt PS sist. Delarna som är GEMENSAMMA (stegregler,
 * nodtyper, grenar) står bara på ETT ställe här nere och sätts ihop av
 * `systemPrompt`; det som skiljer diagramtyperna åt står i var sin del.
 */

import { LANE } from "../parser/rules";

/** Vilken diagramtyp tolkningen gäller. Speglar `ProcessDraft.diagramType`. */
export type PromptDiagramType = "flowchart" | "affarsprocess";

/**
 * Kanoniska lanes, hämtade från regelmotorn så att de aldrig glider isär.
 * OBS: Kommunikationsmedel (LANE.COMMS) erbjuds INTE till AI:n – en kanal är
 * ingen aktör. Notifieringar ligger i AVSÄNDARENS bana med `recipient` satt,
 * precis som migreringen normaliserar till (se core/migrate.ts KANALBANOR).
 */
const kanoniskaBanor = () =>
  [LANE.USER, LANE.PORTAL, LANE.SHAREPOINT, LANE.POWER_AUTOMATE, LANE.INTEGRATIONS].join(", ");

/* ------------------------------------------------------------------ */
/* Gemensamma delar                                                    */
/* ------------------------------------------------------------------ */

const UPPGIFT = `Du får en rå, ostrukturerad beskrivning av en verksamhetsprocess (anteckningar, punktlistor, löpande text). Din uppgift är att tolka den och leverera TVÅ representationer av exakt samma innehåll:

1. \`aiText\` – en städad, förbättrad och förtydligad version av beskrivningen, skriven i verktygets pilformat:
   - Första raden är processens titel.
   - Därefter flödet som "steg → steg → steg".
   - Grenar skrivs i parentes: "(↓ Om villkor → steg → steg)".
   Detta är "AI-beskrivningen" som användaren ska kunna läsa, förstå och redigera. Den ska vara tydligare än underlaget, men får inte innehålla något som inte finns i underlaget.

2. \`steps\` – samma innehåll som en strukturerad steglista.`;

/**
 * Stegreglerna. `note` betyder OLIKA saker i de två diagramtyperna – i
 * flödesschemat är det en tolkningsnot, i affärsprocessen är det aktivitetens
 * beskrivning ("i"-ikonen, se ApInspector) som metoden kräver av varje aktivitet.
 * Därför skickas den regeln in i stället för att stå här.
 */
const stegregler = (noteRegel: string) => `REGLER FÖR STEGLISTAN
- ETT steg per meningsbärande aktivitet. Slå ALDRIG ihop två aktiviteter till ett steg.
- Hitta ALDRIG på steg som saknar täckning i underlaget. Om något är underförstått men nödvändigt för att flödet ska hänga ihop, lägg till steget och förklara varför i \`note\`.
- Använd stabila id:n i flödesordning: s1, s2, s3 …
- \`sourceText\` ska innehålla den ursprungliga textfrasen steget kommer ur (för spårbarhet).
${noteRegel}`;

const NOTE_FLOWCHART = `- \`note\` skrivs BARA när steget är en tolkning eller ett tillägg. Annars null.`;

/**
 * Metoden: "En aktivitet ska alltid innehålla en beskrivning." I affärsprocessen
 * blir `note` just den beskrivningen – utan den saknar varje aktivitet sin
 * i-ikon och kontrollen anmärker på hela flödet.
 */
const NOTE_AP = `- \`note\` är aktivitetens BESKRIVNING – den som ger "i"-ikonen i diagrammet. Metoden kräver en beskrivning på varje aktivitet, delprocess, roll, applikation, krav, forum och tid, så skriv en kort mening om VAD steget innebär (och varför, när steget är en tolkning eller ett tillägg). Verksamhetsobjekt behöver ingen – de beskrivs bara vid behov.`;

const NODTYPER = `NODTYPER
- \`start\`: processens startpunkt ("Fel uppkommer", "Behov uppstår").
- \`activity\`: en person utför något.
- \`decision\`: ett beslut. Texten ska vara formulerad som en fråga och sluta med "?". Sätt \`gateway\` till "exclusive" när en väg väljs (XOR) och "parallel" när grenarna sker samtidigt (AND).
- \`system\`: Power Automate-flöden, portalen som system och liknande plattformslogik.
- \`integration\`: API, Azure Function, integrationer mot andra system.
- \`notification\`: mejl, Teams-meddelande, chatt, notis. Notifieringar är ALLTID egna steg – bygg aldrig in dem i en aktivitet. En notifiering ligger i AVSÄNDARENS bana (oftast Power Automate) – skapa ALDRIG en egen bana för kanalen (ingen "Kommunikationsmedel", "Mejl" e.d.; en kanal är ingen aktör). Sätt \`recipient\` till mottagaren (t.ex. Användare, Handläggare, Kommunikatörer) – det ritas som ett meddelandeflöde till den deltagaren. Sätt \`messageDirection\` till "receive" när steget TAR EMOT ett meddelande (t.ex. "Får via mejl bekräftelse"), annars "send".
- \`datastore\`: datalagring, t.ex. SharePoint-listor, Incident/Service Request, loggposter.
- \`end\`: processens slutpunkt (kvittens, "Tack för ditt ärende"). Ett slut-event UTFÖR ingenting – det avslutar de vägar som leder in i det, och ska ligga i SAMMA bana som de. Lägg det ALDRIG i loggningens eller systemets bana bara för att texten nämner en loggpost sist: ett datalager ligger utanför flödet och har ingen pil till slutet.`;

const GRENAR = `GRENAR
- Ett steg som ligger inuti en beslutsgren sätter \`branchOfStepId\` till beslutets id och \`branchLabel\` till grenens etikett ("Ja", "Nej", eller en beskrivande etikett).
- Steg som kommer EFTER grenen hör till huvudflödet och ska INTE ha \`branchOfStepId\` – de återförenar grenarna automatiskt.
- Har ett beslut bara en uttalad gren räcker det att beskriva den; den motsatta vägen faller igenom automatiskt.`;

const AVSLUT = `Svara enbart med JSON enligt det angivna schemat. Skriv all text på svenska.`;

/* ------------------------------------------------------------------ */
/* Flödesschemat                                                       */
/* ------------------------------------------------------------------ */

const FLOWCHART_INTRO = `Du är tolkningslagret i Arkitekten, och den här tolkningen ska bli en SYSTEMPROCESS: ett BPMN-liknande flödesschema med banor.`;

/** En funktion: portalbanan är installationens och läses när prompten byggs. */
const swimlanes = () => `SWIMLANES
- Använd de kanoniska namnen när de passar: ${kanoniskaBanor()}.
- En bana är en AKTÖR eller ett SYSTEM som utför något – aldrig en kanal.
  Mottagare av meddelanden modelleras via \`recipient\`, inte som banor.
- Du får skapa egna lanes när processen kräver det (t.ex. en extern part eller
  ett annat verksamhetssystem som UTFÖR steg – "Handläggare" är en giltig bana
  när handläggaren agerar). Använd samma sträng som både \`id\` och \`title\`.
- Lista lanes i den ordning de ska visas. Var KONSEKVENT med tidigare diagram:
  samma slags steg ska hamna i samma slags bana varje gång.
- STANDARD: flödet går VIDARE I SAMMA BANA. Byt bana bara när det finns ett skäl
  i underlaget – en ny aktör tar över, eller ett annat system utför steget. Är
  handläggaren inne i portalen ligger allt hon gör där tills något annat händer.
- Ett \`datastore\` bär ALDRIG banan vidare. Det är en artefakt utanför
  sekvensflödet: nästa steg efter en loggpost i SharePoint ligger i samma bana
  som steget FÖRE loggposten, inte i SharePoint.
- Samma sak gäller beslut och slut-event: de ligger där flödet är när de nås.`;

const AP_ANNOTERINGAR_FRIVILLIGA = `AFFÄRSPROCESSANNOTERINGAR (frivilliga)
- Diagrammet kan även visas som en AFFÄRSPROCESS: ett vågrätt processflöde
  där roller, IT-stöd och krav hänger som satelliter på aktiviteterna.
- NÄMNER underlaget vem som utför ett steg, vilket IT-stöd som används, ett krav
  eller en tidsram: lägg annoteringen SIST i stegets \`text\` med hakparenteser:
  \`[Roll: Rekryterande chef U]\` \`[Intressent: Hyresgäst I]\` \`[IT: ReachMee]\`
  \`[Arkiv: Personakt]\` \`[Krav: Öka mångfald]\` \`[Tid: Inom 5 dagar]\`
  \`[In: Ansökningar]\` \`[Ut: Urval genomfört]\`.
- Bokstaven efter roll/intressent är HUKI: H = Huvudansvar, U = Utför,
  K = Konsulteras, I = Informeras. Utelämna bokstaven om underlaget inte säger.
- HITTA ALDRIG PÅ satelliter som underlaget inte nämner. Annoteringarna lyfts
  ut ur etiketten automatiskt och påverkar inte systemprocessen.
- Aktiviteter benämns verb + substantiv ("Genomför urval"); beslutsfrågor
  formuleras som frågor – det gäller båda diagramtyperna.`;

/** Systemprompten för en systemprocess (flödesschemat). */
export const flödesschemaPrompt = (): string => [
  FLOWCHART_INTRO,
  UPPGIFT,
  stegregler(NOTE_FLOWCHART),
  NODTYPER,
  swimlanes(),
  GRENAR,
  AP_ANNOTERINGAR_FRIVILLIGA,
  AVSLUT,
].join("\n\n");

/* ------------------------------------------------------------------ */
/* Affärsprocess                                                      */
/* ------------------------------------------------------------------ */

const AP_INTRO = `Du är tolkningslagret i Arkitekten, och den här tolkningen ska bli en AFFÄRSPROCESS enligt affärsprocessmetoden – INTE en systemprocess (BPMN-flödesschema med simbanor).

Stilen är EN vågrät förädlingskedja:

  [VO] →Flöde→ (Aktivitet) →Flöde→ [VO] →Flöde→ (Aktivitet) → 〈Regel?〉 …

där verksamhetsobjekt (VO) och aktiviteter VÄXLAR, och där roller, IT-stöd,
krav och tider hänger som SATELLITER på aktiviteterna.`;

const AP_AITEXT = `AI-BESKRIVNINGEN (\`aiText\`)
- Skriv den i pilformat precis som ovan, MED satellitannoteringarna kvar i
  hakparenteser efter varje steg. Beskrivningen tolkas om av regelmotorn när
  användaren redigerar den – utelämnar du hakparenteserna där försvinner alla
  roller, IT-stöd och objekt vid första omtolkningen.
- Exempel på en rad: \`Genomför urval [Roll: Rekryterande chef H, HR K] [IT: ReachMee] [Ut: Urval genomfört]\`.`;

const AP_METODEN = `METODENS REGLER – följ dem alltid
- AKTIVITETER benämns VERB + SUBSTANTIV: "Samla material", "Skapa presentation",
  "Håll föredraget". Aldrig ett ensamt substantiv ("Instudering") och aldrig ett
  ensamt verb ("Utred") – utan objekt går det inte att beskriva förädlingen.
- REGLER (\`decision\`) används när en aktivitet följs av TVÅ ELLER FLERA
  aktiviteter. Kan flera av dem utföras är regeln en OCH-regel
  (\`gateway: "parallel"\`); är det bara en av flera möjliga är den en
  ELLER-regel (\`gateway: "exclusive"\`, vanligast). Regeln formuleras som en
  FRÅGA som slutar med "?", och svaren ("Ja"/"Nej" eller beskrivande) skrivs på
  relationerna – alltså i \`branchLabel\`.
- FÖRÄDLINGSKEDJAN: varje aktivitet lämnar ifrån sig ett resultat. Sätt
  \`[Ut: <objektet>]\` på den aktivitet som SKAPAR objektet – aldrig
  \`[In: …]\` på den som förbrukar det, för då uppstår objektet ur tomma intet
  och kedjan går sönder. \`[In: …]\` används BARA för objekt som kommer UTIFRÅN
  processen (och normalt bara på det allra första steget).
- Utelämna \`[Ut: …]\` när resultatet följer självklart av namnet: verktyget
  föreslår då objektet självt ("Genomför urval" → "Urval genomfört"). Skriv ut
  det när underlaget ger objektet ett eget, riktigare namn.
- START och SLUT är verksamhetsobjekt, inte händelser: namnge dem som TILLSTÅND
  eller SAKER ("Behov av föredrag", "Föredrag hållet"), inte som aktiviteter.
- Varje aktivitet bör ha en ROLL som utför den: \`[Roll: Rekryterande chef U]\`.
  Bokstaven är HUKI: H = Huvudansvar, U = Utför, K = Konsulteras,
  I = Informeras. Säger underlaget inte vem, utelämna bokstaven – men skriv ut
  rollen så snart den går att läsa ur texten (även när den bara är underförstådd
  som "den som håller föredraget").
- \`[Intressent: Hyresgäst I]\` för dem som berörs men inte utför.
- FORUM används I STÄLLET FÖR EN AKTIVITET när steget alltid genomförs i
  MÖTESFORM (metoden: "Visar ett forum, vars arbetssätt är möten, bereda,
  genomföra eller kommunicera"). Markera steget med \`[Forum]\` – UTAN kolon –
  så ritas det som en pratbubbla i förädlingskedjan i stället för en
  aktivitetsruta. Det är fortfarande ett steg (\`type: "activity"\`): det
  namnges verb + substantiv, lämnar ett resultat, har sina roller och kräver
  en beskrivning. Mötets eller gruppens NAMN ("Avdelningsledningsgruppen")
  skrivs i \`note\`, inte som en egen symbol.
  Exempel: \`Fatta beslut [Forum] [Roll: Avdelningschef, Enhetschefer]\`.
  Använd det för de steg som ÄR mötet – det som avhandlas och beslutas där –
  inte för förberedelser före eller arbete efter. Skriv ALDRIG
  \`[Forum: …]\` som satellit vid sidan av en aktivitet: då står samma möte
  som en extra bubbla bredvid varje steg, och metoden har ingen sådan
  användning.`;

const AP_SATELLITER = `SATELLITER – skrivs SIST i stegets \`text\`, i hakparenteser
  \`[Roll: HR U]\` \`[Intressent: Hyresgäst I]\` \`[IT: ReachMee]\`
  \`[Arkiv: Personakt]\` \`[Krav: Öka mångfald]\` \`[Tid: Inom 5 dagar]\`
  \`[Plats: Kontoret]\` \`[In: Ansökningar]\`
  \`[Ut: Urval genomfört]\`.
- Flera värden separeras med komma: \`[Roll: Chef H, HR K]\`.
- HITTA ALDRIG PÅ satelliter som saknar täckning i underlaget. En roll som
  underlaget uttryckligen pekar ut är inte påhittad; ett IT-system som ingen
  nämnt är det.
- Vanliga parenteser går INTE att använda för satelliter – de är grensyntax.
- Beskriver underlaget en RUTIN eller CHECKLISTA – momenten man går igenom för
  att utföra en aktivitet – skrivs den i kravet, ett moment per kryssruta:
  \`[Krav: Rutin för uppdatering av brandväggar – ☐ Ladda ner firmware ☐ Ta backup av konfigurationen]\`.
  Kravet får namnet före rutorna och blir en rutin i diagrammet, där varje
  ruta är ett moment att bocka av. Börja momentet med verbet. Ta bara med
  moment som underlaget nämner; säger det att rutinen skrivs senare räcker
  kravet utan rutor.`;

const AP_INGA_BANOR = `INGA SIMBANOR
- Affärsprocessens flöde har inga banor. Ange EN lane med processens huvudaktör och
  lägg ALLA steg i den. Aktörerna uttrycks som \`[Roll: …]\`-satelliter, aldrig
  som banor – att sprida stegen över flera lanes ger ingen effekt i det här
  diagrammet och gör bara \`sourceText\`-spårningen svårare att läsa.
- \`recipient\` på en \`notification\` ritas som ett meddelandeobjekt (kuvert)
  ut ur aktiviteten – sätt det som vanligt.
- \`datastore\` blir en applikation/ett arkiv som aktiviteten "Samverkar med",
  utanför kedjan. Ett datalager bär alltså aldrig flödet vidare.`;

export const AP_SYSTEM_PROMPT = [
  AP_INTRO,
  UPPGIFT,
  AP_AITEXT,
  stegregler(NOTE_AP),
  AP_METODEN,
  AP_SATELLITER,
  NODTYPER,
  AP_INGA_BANOR,
  GRENAR,
  AVSLUT,
].join("\n\n");

/** Systemprompten för en diagramtyp. Flödesschemat är standard. */
export function systemPrompt(diagramType: PromptDiagramType = "flowchart"): string {
  return diagramType === "affarsprocess" ? AP_SYSTEM_PROMPT : flödesschemaPrompt();
}

/**
 * Instruktionen som följer med genom ark-bryggan.
 *
 * Bryggan har ingen systemprompt – det är Claude Code som tolkar, och
 * `.ark/request.json` är allt hen ser. Utan det här fältet fanns ingenting
 * som avslöjade att begäran gällde en affärsprocess, och svaren kom tillbaka i
 * flödesschemats form (inga satelliter, ingen förädlingskedja).
 */
export function bridgeInstruction(diagramType: PromptDiagramType = "flowchart"): string {
  if (diagramType !== "affarsprocess") return "";
  return `Den här begäran gäller verktyget "Affärsprocess" – inte systemprocessen. Följ affärsprocessmetoden enligt systemprompten nedan (den är samma regler som appens egen AI-väg använder), och lägg satellitannoteringarna i hakparenteser både i \`aiText\` och i stegens \`text\`.

${AP_SYSTEM_PROMPT}`;
}

/** Bygger användarmeddelandet kring råtexten. */
export function userPrompt(rawText: string): string {
  return `Tolka följande processbeskrivning:

<beskrivning>
${rawText.trim()}
</beskrivning>`;
}
