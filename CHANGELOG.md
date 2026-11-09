# Ändringslogg

Ändringarna i Arkitekten (processritaren), nyast först. Versionerna följer
[semantisk versionering](https://semver.org/lang/sv/): en ny huvudversion
när något tas bort eller byter betydelse, en ny mindre version för nya
funktioner, en ny korrigering för rättelser.

## Ej släppt

- (inget än)

## 0.7.0 – 2026-11-09

- Utan `ARK_BAS_URL` används `RENDER_EXTERNAL_URL` (adressen Render ger tjänsten), så en ny Render-installation startar innan den egna adressen är ifylld.
- **Säkerhet: flödestjänsten lämnar aldrig ut processer i någons egen katalog** (Mina processer) – de saknas i listan och ger 404 på sitt id.
- **Säkerhet: flödestjänsten kan kräva en nyckel.** Med `ARK_FLODESTJANST_NYCKEL` satt kräver varje `/api/*`-anrop huvudet `X-Arkitekten-Nyckel` med samma värde (401 annars); `/health` är öppen. Utan variabeln är allt som förut, med en varning vid start. **Uppgradering:** sätt samma värde hos Arkitekten och Integrationsplattformen.
- **Säkerhet: flödestjänsten som barnprocess ärver inte längre hela miljön** – bara katalogerna, organisationens namn och nyckeln, inga API-nycklar eller sessionshemligheter.
- **Säkerhet: AI-brevlådan är per användare.** En inloggad kunde förut hämta en annans AI-svar och avbryta en annans begäran. Uppladdade underlag tas bort när svaret är hämtat, gallras efter ett dygn och får vara högst 100 MB per användare. Utvecklarläget (`ARK_UTVECKLARLAGE`) har kvar EN brevlåda i `.ark/`.
- **Säkerhet: en för stor begäran avvisas med 413** utan att läsas in i minnet, också före inloggningen.
- **Säkerhet: inloggningsspärren låser namn + adress** i stället för namnet ensamt, så en gissare inte kan låsa ute administratören; namnet ensamt spärras först efter 50 fel. Nytt: `ARK_BETRODD_PROXY=1` tar klientens adress ur `X-Forwarded-For` bakom en proxy. Lösenordsprövningen låser inte längre servern.
- **Säkerhet: sessionskakan får `Secure`** också när proxyn säger https (`X-Forwarded-Proto`). Lokala konton i drift startar inte utan `ARK_BAS_URL`. **Uppgradering:** sätt `ARK_BAS_URL` (t.ex. på Render, där den är `sync: false`).
- **Säkerhet: en visualisering ändras bara av den som skapade den** (eller en administratör); alla läser och skapar nya som förut.
- **Säkerhet: serverns felbesked går inte ut med sökvägar** – bara avsiktliga besked når användaren, resten loggas. Inloggningssidan visar bara kända felkoder ur adressen, inte fri text.
- **Säkerhet: portalens processträd och applikationer** (`/__ark/ea/processer`, `/__ark/ea/applikationer`) läses bara av administratörer – samma roll som får publicera.

## 0.6.0 – 2026-11-09

- **Säkerhet: i drift startar Arkitekten inte öppen.** Utan inloggning (eller med ett felstavat `ARK_AUTH`) blev alla som nådde appen administratörer. Nu vägrar avbilden (`NODE_ENV=production`) att starta i öppet läge och provläge, utom med `ARK_TILLAT_OPPEN=1`, och ett okänt `ARK_AUTH` är ett fel. **Uppgradering:** en installation som medvetet kör öppen måste sätta `ARK_TILLAT_OPPEN=1` – eller hellre `ARK_AUTH=auto`.
- **Säkerhet: det första lokala kontot kräver engångskoden `SETUP_CODE`** i drift (samma som portalens och plattformens), så den som först hittar en ny installation kan inte ta den.
- Organisationsspecifika processnamn i kommentarer och README ersatta med påhittade.

## 0.5.0 – 2026-11-09

- `ARK_AUTH=auto`: Entra när `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` och `ENTRA_CLIENT_SECRET` är satta, annars egna konton – aldrig öppen drift. För installationer där Entra är valfritt (Render).
- Utan `ARK_ADMINS` läses administratörerna ur `BOOTSTRAP_ADMIN_EMAILS`, så att portalen, plattformen och Arkitekten kan dela en lista – och en app-registrering.

## 0.4.0 – 2026-11-09

- **Går att köra på Render och liknande plattformar.** Med `ARK_FLODESTJANST_PORT` startar Arkitekten flödestjänsten själv, som en egen process i samma container – för plattformar där två tjänster inte kan dela en disk. Dör flödestjänsten avslutas Arkitekten också, så att plattformen startar om båda. Utan variabeln är allt som förut.
- `EA_API_URL` kan vara en intern `host:port` och blir då `http://host:port/api/v1`.
- Avbilden startar som root och går över till `node` (`docker/start.sh`), efter att ha gett `node` en datadisk som monterats som root. Med `user:` i compose körs den som förut. Kör kommandon i containern med `docker compose exec -u node arkitekten …`, så att nya filer ägs av `node`.


## 0.3.4 – 2026-11-05

- Affärsprocess: ett steg i kedjan – även ett som AI:n eller regelparsern tolkat fram – tas bort med "Ta bort ur kedjan" i inspektören; kedjan sluts runt luckan. "+ Lägg till aktivitet efter" lägger en ny aktivitet direkt efter steget (efter en regels grenar). En vald kedjepil ger knappen "Bryt kedjan här" uppe till vänster. Ångra tar tillbaka allt.
- Helskärm i både Affärsprocess och Systemprocess: knappen "⛶ Helskärm" visar bara bilden över hela skärmen, utan meny, verktygsrad eller paneler, och låst för ändringar. Esc eller "Avsluta helskärm" går tillbaka.
- Testet för presentationsknappen väntar in att arbetet kvitterats – det föll ibland på CI.

## 0.3.3 – 2026-11-05

- Affärsprocess: export till BMT (.bmt) under Export → Som fil. Knappen visas när `ARK_BMT_MALL` pekar på en mall – en export av en enda modell ur det modellverktyg som ska ta emot filen. Namnrymd, språk och andra installationsberoende id:n hämtas ur mallen (`GET /__ark/bmt/mall`, `bmtMall` i `/__ark/status`).
- Affärsprocess: en checklista i ett krav (`[Krav: Rutin X – ☐ a ☐ b]`) blir kravet "Rutin X" och en rutin med ett moment per ruta, i både regelparsern och AI-tolkningen. Ett sparat flöde gör om sina checklistor med "Skapa rutin ur checklistan" i inspektören.
- Testet för AI-tolkningen avmonterar sin komponent, så att kanvasens fördröjda vyanpassning inte kan fälla körningen efter att testmiljön rivits.

## 0.3.2 – 2026-11-02

- Systemprocess: banan man drar ut sista objektet ur står kvar under redigeringen, så att bytet syns och objektet går att dra tillbaka. Tomma banor visas inte i färdiga bilder.
- `@anthropic-ai/sdk` 1.x (API-versionen 2026-10-21) och elkjs 0.12.1.

## 0.3.1 – 2026-10-26

- Webbläsartesterna (`npm run test:browser`) går igen i en ren klon: de kör mot exempelpaketet i en egen tillfällig installation per rigg och följer dagens gränssnitt. Tester som gäller en installations egna processer hoppar över, utom när `ARK_E2E_INNEHALL` pekar ut installationens innehåll (det läggs då in i den tillfälliga kopian). e2e/ typkontrolleras (`tsconfig.e2e.json`) före körningen.
- Ramarnas test jämför med flödesschemat så som det ritas (perspektivet döljer besluten) – det föll när `flows/` innehöll exempelpaketet.
- Beroendena uppdaterade: @anthropic-ai/sdk 0.137, happy-dom 21.0.4 och tsx 4.23.15.

## 0.3.0 – 2026-10-23

- Organisationens namn, logotyp och profilfärg i skalet och på inloggningssidan: ur `ARK_ORG_NAMN`, `ARK_ORG_KORTNAMN`, `ARK_ORG_LOGO` och `ARK_ORG_FARG`, annars ur portalens organisationsinställningar när portalen är kopplad (`/__ark/utseende`).
- Beroendena uppdaterade: React 19 (react, react-dom och typerna tillsammans), @xyflow/react 12.12, @anthropic-ai/sdk 0.135, happy-dom 21, @testing-library/react 16.3.3, elkjs 0.12 och playwright-core 1.64; verktygskedjan Vite 8, @vitejs/plugin-react 6, Vitest 5 och TypeScript 7; avbilden och CI kör Node 24 (LTS) i stället för 22, och GitHub Actions-stegen har nya huvudversioner (checkout 7, setup-node 7, setup-buildx 4, login 4, metadata 6, build-push 7).

## 0.2.0 – 2026-10-22

- Första versionen i Arkitektursamverkan: verktygen Affärsprocess och Systemprocess, fristående server och avbild, valbar inloggning (Entra ID eller lokala konton), symbolstilar, innehållspaket och versionerade gränssnitt mot plattformen och portalen.
