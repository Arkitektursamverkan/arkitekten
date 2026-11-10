# Arkitekten – processritaren

Stöd för dig som Enterprise-arkitekt. En lokal webbapp där du matar in en
beskrivning och får ut ett professionellt diagram som du redigerar direkt i
appen – ingen resa till draw.io krävs.

**Verktygen: Systemprocess** (flödesschema med banor) och **Affärsprocess**
(förädlingskedja med satelliter). Fler verktyg (förmågekartor, integrationsöversikter)
pluggas in i samma skal utan att kärnan behöver ändras.

Arkitekten är en valbar modul i **Arkitekturportalen** (EUPL-1.2). Installera
den med portalens driftrepo,
[arkitekturportalen-drift](https://github.com/Arkitektursamverkan/arkitekturportalen-drift):
installationsguiden erbjuder Arkitekten när Integrationsplattformen ingår.
Gränssnitten mot portalen och plattformen står i [docs/gransnitt.md](docs/gransnitt.md).

## Bärande designprincip

> AI ritar inte diagram. En regelmotor (eller senare AI, som valfritt lager)
> skapar en **strukturerad processmodell**. Diagrammet genereras sedan
> **deterministiskt** från modellen.

Det ger 100 % spårbarhet mellan din text och diagrammet – inga tappade
aktiviteter, inga hopslagna steg, ingen felplacering i swimlanes.

## Pipeline

```
Beskrivning  →  Tolkning      →  ProcessDraft  →  ProcessModel   →  Layout  →  Editor / Export
(rå text el.    (regelmotor       MELLANLAGER      (mellanmodell)              (React Flow +
 AI-tolkad)      eller AI)        – redigerbart                                 draw.io/Mermaid/SVG)
```

**Mellanlagret** (`core/draft.ts`) är nyckeln: en platt, numrerad steglista där
tolkningen kan granskas och justeras innan något ritas. Grenar uttrycks med
`branchOf` i stället för kanter, så listan går att redigera utan att man behöver
tänka på pilar. `compileDraft` är den enda vägen draft → modell – regelmotorn och
AI:n producerar samma struktur, så diagrammet ritas likadant oavsett källa.

## Kom igång

```bash
npm install
npm run dev      # utveckling: Vite med bryggan (/__ark) på :5173
npm test         # hela testsviten
npm run build    # typkontroll (app och server) + produktionsbygge
npm start        # den fristående servern: dist/ + /__ark + /health
npm run flodestjanst   # flödestjänsten (scener till plattformen) på :8200
```

## Drift

Allt väljs i miljön – se [`.env.example`](.env.example). Servern startar inte
om något som krävs saknas, och säger vad. Avbilden (`Dockerfile`) kör samma
server; flödestjänsten startas ur samma avbild som en egen container:

```bash
docker build -t arkitekten .
docker run -p 5173:5173 -v ark-data:/data --env-file .env arkitekten
docker run -p 8200:8200 -e PORT=8200 -v ark-data:/data arkitekten \
  node_modules/.bin/tsx server/flodestjanst.mts
```

Innehållet (processer, visualiseringar, AI-brevlådan) ligger i volymen
`/data`. Inga nycklar finns i avbilden; varje installation skapar sina egna.

Inloggningen väljs i miljön – Entra ID eller lokala konton
([docs/inloggning.md](docs/inloggning.md)). Innehåll flyttas och exempel läggs
in med innehållspaket ([docs/innehallspaket.md](docs/innehallspaket.md)).

## Så matar du in

- **Första raden** = diagrammets titel.
- Steg separeras med `→` eller ` - ` (mellanslag-streck-mellanslag; bindestreck
  i ord som `e-post` eller `SP-lista` påverkas inte).
- Beslut skrivs som `Om <villkor>` / `Om <X> väljs` → blir romb (`<X> vald?`).
- Villkorsgrenar i parentes: `( ↓ Om villkor → gren-steg → gren-steg )` grenar ut
  och återförenas med nästa steg.

## Kartläggning mot kravspecen

| Krav | Var det bor |
|------|-------------|
| 1 – Extrahera aktiviteter/beslut/system/notiser/datalager | `parser/rules.ts`, `parser/parse.ts` |
| 2 – Swimlane-klassning | `parser/rules.ts` (`LANE`, `RULES`) |
| 3 – Beslutspunkter (Om/annars/ja/nej) | `parser/rules.ts` (`decisionLabel`), `parse.ts` |
| 4 – Verksamhet vs Teknik | `perspective.ts` |
| 5 – Diagramregler (egen box, inget tappas, notiser/datalager separata) | `parse.ts` + `validate.ts` |
| 6 – Layoutmotor (horisontellt, auto-höjd) | `layout/layout.ts` |
| 7 – draw.io XML | `export/drawio.ts` |
| 8 – Mermaid | `export/mermaid.ts` |
| 9 – SVG | `export/svg.ts` |
| 10 – Visuell editor (dra & släpp, etiketter, lås) | `render/FlowCanvas.tsx` |
| Spårbarhet (Regel 2) | `validate.ts` + `TracePanel.tsx` |
| Mellanlager (granska/justera tolkningen) | `core/draft.ts` + `DraftPanel.tsx` |
| AI-tolkning | `ai/{schema,prompt,client,bridge,besvara}.ts`, `server/brygga.ts` |
| Spara, öppna, versionera flöden | `core/flow-store.ts` + `FlowLibrary.tsx` |
| Kopplingspunkter och linjering | `render/{FlowCanvas,snap}.ts(x)` |

## AI-tolkning

AI ritar aldrig – den fyller bara mellanlagret, precis som regelmotorn. AI-stödet
är valbart och har tre lägen (`GET /__ark/status`, se `server/brygga.ts`):

1. **API-nyckel** (`ANTHROPIC_API_KEY`): servern besvarar begäran. Nyckeln
   lämnar aldrig servern, och varje anrop godkänns först i kostnadsrutan.
2. **Utvecklarläget** (`ARK_UTVECKLARLAGE=1`): begäran läggs i den inloggades
   brevlåda (`.ark/anvandare/<hash>/request.json`; i öppen drift
   `.ark/request.json`) och en Claude Code-session på samma maskin svarar med
   `response.json` i samma katalog. `npx tsx scripts/brevlada.mts` listar de
   väntande. Av som standard.
3. **Av**: inget av ovan. AI-knapparna visas inte; allt annat fungerar.

## Flödesbibliotek och versioner

Sparade flöden hamnar som JSON i `flows/` (via bryggan) med localStorage som tyst
reserv. Ett flöde innehåller råtext, AI-beskrivning, mellanlager och
vyinställningar – **aldrig diagrammet**, det kompileras alltid fram på nytt, så ett
sparat flöde kan inte hamna ur synk med sin modell.

Varje sparning blir en **version** i samma fil. Att återgå till en äldre version är
icke-destruktivt: historiken skrivs bara på, aldrig om. Tak 50 versioner per flöde.

## BPMN 2.0-korrekthet

Modellen skiljer på tre saker som lätt blandas ihop – och som var formellt fel
i tidigare version:

| Begrepp | I modellen | Regel |
|---|---|---|
| Sekvensflöde | `edges` | Heldragen. Får **aldrig** korsa en poolgräns. |
| Meddelandeflöde | `messageFlows` | Streckad, öppen pil. Går **bara** mellan olika deltagare (pooler). |
| Datalager | `dataStores` + `dataAssociations` | En **artefakt**, aldrig ett flödesobjekt. Kopplas med streckad dataassociation. |

Meddelandeflöden ligger i en egen lista, skild från `edges`, just för att göra
felet omöjligt: ett meddelande kan inte råka bli en pil i sekvensflödet, och ett
sekvensflöde kan inte korsa en poolgräns. Mottagare blir **svart-låda-pooler**
(deltagare vars inre inte modelleras) under processens pool.

`checkBpmn()` i `validate.ts` kontrollerar detta vid varje generering.

## Editorkontroller

- **Positioner** som du drar objekt till sparas med flödet.
- **Kopplingspunkter** väljs per kant – dra i pilens ände eller klicka på pilen och
  välj sida i inspektören. Exporten (SVG och draw.io) respekterar valen, så
  exporten matchar skärmen.
- **Linjering**: håll `Shift` medan du drar för att fästa mot närmaste objekt, med
  hjälplinjer som visar vad du linjerar mot.
- **Flera objekt i taget**: växeln uppe till vänster på ritytan säger vad musen
  gör på tom yta – **Markera** (streckad ruta, kryss som pekare) drar en ram som
  markerar allt den nuddar, **Flytta vyn** (hand) panorerar. Hela markeringen
  flyttas sedan med ett enda drag, och `Ctrl`-klick lägger till eller tar bort
  ett objekt ur den. Växeln finns bara i redigeringsläget; i låst läge gäller
  handen alltid. Panorering går dessutom alltid med mitten- eller högerknappen
  och med `mellanslag` + vänsterdrag, oavsett läge. Samma växel och samma
  gester i flödesschemat och i verktyget Affärsprocess – `render/PekarVal.tsx` och
  `render/canvas-gester.ts`.

- **Figurförteckning**: knappen **▣ Figurer** i verktygsraden fäller ner en
  faktaruta med de symboler som FAKTISKT står i den öppna processen – form,
  namn, betydelse och antal – plus pilsorterna. I verktyget Affärsprocess står
  HUKI-bokstäverna där med sin FÄRG, vilket är enda stället de går att slå upp:
  bokstaven skrivs aldrig ut i bilden, den bärs av linjens
  färg. Rutan finns i båda verktygen och i BÅDA lägena – också när man bara
  läser, för det är då man behöver den. Den ritas medvetet inte in i exporten;
  den bilden jämförs sida vid sida med processägarens egen utskrift. Formerna,
  färgerna och betydelserna läses ur `former.ts` (färgerna ur symbolstilen) respektive `theme.ts`, samma
  moduler som ritytan och exporten – rutan kan alltså inte påstå något annat än
  det bilden visar (`shell/Figurforteckning.tsx`, `tools/*/figurer.ts`).

  Förteckningen FÖLJER MED UT: affärsprocessens scen bär den som `figurer` (`core/scen.ts`,
  kontraktet i `core/figurer.ts`), så EA-portalen kan fälla ner samma
  teckenförklaring över de processer den visar. Symbolerna skickas färdigritade
  och självständiga – inga `defs` refereras – och mottagaren ritar dem rakt av,
  precis som noderna. Fältet är frivilligt: scener speglade innan det fanns
  saknar det, och `formatVersion` höjs bara när något tas bort eller byter
  betydelse.

## Katalogen: var processerna ligger

`category`/`subcategory` säger var en process ligger i katalogen – inte vad den
innehåller. En flytt rör därför aldrig historiken, `savedAt` eller
versionsbeteckningen (invariant 11).

- **Flytta en process**: öppna Processkatalogen, gå in i samlingen, och klicka
  mappknappen uppe till höger på processens kort. Dialogen "Flytta …" väljer
  kategori och underkategori ur de befintliga – eller skapar en ny gren som ett
  uttryckligt val, så ett stavfel inte tyst blir en andra gren.
- **Flytta en hel gren**: döp om den med ✎ vid rubriken. Alla processer i grenen
  följer med, och samma namn som en befintlig gren slår ihop dem.

## Struktur

```
src/
  core/
    model.ts                    mellanmodellen (kontraktet allt delar)
    draft.ts                    MELLANLAGRET + compileDraft (draft -> modell)
    flow-store.ts               spara/öppna/versionera flöden
  shell/                        plattformsskal + verktygsregister
  tools/flowchart/
    parser/  {rules,toDraft,parse,validate}.ts
    ai/      {schema,prompt,client,bridge}.ts
    layout/  layout.ts
    perspective.ts
    render/  FlowCanvas, ProcessNodeView, LaneNodeView, snap.ts, GuideView
    export/  {drawio,mermaid,svg}.ts
    theme.ts
    FlowchartTool.tsx, DraftPanel.tsx, FlowLibrary.tsx, TracePanel.tsx
scripts/
  ark-bridge.ts                 vite-plugin: monterar bryggan i dev-servern
server/
  arkitekten.mts                fristående server: dist/ + /__ark + /health
  brygga.ts                     /__ark: inloggning, bibliotek, AI, publicering
  installningar.ts              miljön läses och prövas här
  flodestjanst.mts              scener till integrationsplattformen (:8200)
  ai-draft.mjs                  CLI för AI-tolkning utan appen
flows/                          sparade flöden med versionshistorik
```

## Tester

94 tester (`npm test`). Tyngdpunkten ligger på det som är lätt att få subtilt fel:
kompileringen draft → modell, grenlogiken, flyttning i mellanlagret, spara/öppna
med versioner, linjeringen och kantdragningen i exporten. Komponenttester körs med
happy-dom.

## Tester

```
npm test           # 225 enhets- och komponenttester, snabbt, körs var som helst
npm run test:browser   # 7 webbläsartester mot en riktig Chromium
```

Webbläsartesterna finns för att layouten kan vara helt korrekt samtidigt som
skärmen är tom. Det har hänt två gånger: kameran följde inte med när ett
diagram växte, och React Flow gömde varje objekt (`visibility: hidden`) när
nodlistan byggdes om under ett drag. Enhetstesterna kunde inte se skillnad på
"layouten är rätt" och "det syns".

De laddar inte ned någon webbläsare. De använder en Chromium som redan finns
(Playwright-cachen eller en systeminstallation) och **hoppas över med ett
tydligt meddelande** om det inte finns någon. Peka ut en egen med
`ARK_CHROME=/sökväg/till/chrome`, eller hämta en med
`npx playwright install chromium`.
