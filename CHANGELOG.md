# Ändringslogg

Ändringarna i Arkitekten (processritaren), nyast först. Versionerna följer
[semantisk versionering](https://semver.org/lang/sv/): en ny huvudversion
när något tas bort eller byter betydelse, en ny mindre version för nya
funktioner, en ny korrigering för rättelser.

## Ej släppt

- **Avståndet går att skriva in**: procentfältet mellan **→←** och **←→** tar ett tal (30–200, Enter verkställer, Esc ångrar), och knapparna går ±10 därifrån. Faktorn avrundas nu till hela procent i stället för tiondelar. **↺** återställer till 100 %.
- **Markeringen står kvar** när avståndet ändrats (och vid andra omritningar), i båda verktygen – man kan trycka flera gånger i rad utan att markera om.

## 0.11.0 – 2026-11-11

- **Avståndet mellan markerade objekt** går att ändra, i både Affärsprocess och Systemprocess. Markera objekten (dra en ram, eller Ctrl-klicka) och tryck **→←** för tätare eller **←→** för glesare i verktygsraden (30–200 %, procenttalet återställer till 100 %). Mellanrummen mellan de markerade kolumnerna ändras, också genom kolumner där inget är markerat; resten av diagrammet står still. Faktorn sparas med processen (`kolumnAvstånd` i mellanlagret) och gäller både ritytan och exporterna. Reglaget *Avstånd mellan objekt* under Vy gäller fortfarande hela diagrammet.

## 0.10.0 – 2026-11-10

- **Inloggningen och portalens adress kan komma ur portalen.** Med `ARK_AUTH=auto` och portalen kopplad (`EA_API_KEY`) hämtas tomma `ENTRA_*` (och `BOOTSTRAP_ADMIN_EMAILS`) ur portalens `GET /installation` vid start – starten väntar högst två minuter, svaret sparas i `ARK_DIR/installation.json` (0600) som reserv, annars egna konton med varning. Egna värden i miljön vinner; byte av Entra i portalen kräver omstart. Arkitekten anmäler sin adress (`PUT /installation/arkitekten`) i bakgrunden, och utan `EA_WEBB_URL` används portalens `portal_url`. Kräver en portal med `/installation` – en äldre portal ger bara en rad i loggen.

## 0.9.0 – 2026-11-10

- **Ärendetyperna i processmenyn kommer ur inställningen `ARK_ARENDETYPER`** (kommaseparerad, `Titel` eller `prefix=Titel`) i stället för en lista i koden. **Uppgradering:** en installation som vill behålla menyns indelning sätter `ARK_ARENDETYPER`; utan den visas alla processer i en gren.
- **Säkerhet: flödenas historik byggs bara på** – en sparning får lägga till versioner men inte ändra eller ta bort äldre (409/403), servern behåller hela historiken och sätter `savedBy`. Id:t i kroppen måste vara adressens.
- **Säkerhet: andras egna processer syns inte** – GET ger 404, och en sparning på ett upptaget id får 403 (`kod: "upptaget"`) så att appen tar nästa lediga. Ramseriernas läsbarhet följer processens.
- **Säkerhet: inloggningar kan återkallas.** Lokala konton får en tokenversion i sessionskakan; lösenordsbyte och "logga ut överallt" höjer den. Sessionen gäller 8 timmar (förut 10). Lösenordsbytet delar inloggningsspärren.
- **Säkerhet: Entra-gästkonton (B2B) avvisas**; `ENTRA_TILLAT_GASTER=1` släpper in dem. `ARK_ADMINS` kan ange Entra-`oid` (rekommenderas) eller e-post.
- `/health` svarar bara `{status:"ok"}` (versionen finns i `/__ark/status`). Bryggans och flödestjänstens svar har `Cache-Control: no-store` och `nosniff`. `/underlag` lämnar aldrig ut serverns sökvägar.
- Standardscenens figurer heter Hem, Kund och Kontor, och exempeltexterna nämner inga leverantörer (lagrade id:n är oförändrade).

## 0.8.0 – 2026-11-10

- **Säkerhet: processbilderna kan inte bära skript.** HUKI-bokstaven valideras, alla attribut i SVG-exporten escapas, en bild som inte går att tolka blir tom, och all SVG renas med DOMPurify innan den visas. Servern skickar Content-Security-Policy, `nosniff`, `Referrer-Policy` och HSTS över https; flödestjänstens SVG får en egen strikt policy.
- **Säkerhet: publiceringen i EA-portalen ägs av servern** – den skrivs bara via `PUT`/`DELETE /__ark/ea/publicering/:id` (admin, gemensam yta) och aldrig ur en vanlig sparning, och byte av yta tar bort den. Flödestjänsten lämnar bara ut publiceringen för gemensamma processer; en publicerad Demo-process försvinner ur portalen vid nästa synk.
- **Säkerhet: skydd mot förfalskade anrop** – ändrande anrop under `/__ark` kräver appens eget ursprung och JSON; `/auth/logout` tar bara `POST`. Efter Entra-inloggningen skickas man bara vidare inom appen.
- **Säkerhet: `ARK_BETRODD_PROXY` är antalet betrodda proxyer** (`1`/`true` som förut) och klientens adress tas från höger i `X-Forwarded-For`, så inloggningsspärren inte kan kringgås; spärren rensar gamla poster och har ett tak.
- **Säkerhet: brevlådan för AI-begäranden är per användare även i utvecklarläget** när inloggning är på (`npx tsx scripts/brevlada.mts` visar var begäranden väntar). Bara öppen drift har den delade `.ark/`.
- **Säkerhet: AI-stödet** – utvärderingens systemprompt byggs på servern, underlaget har ett tak (200 000 tecken, uppackade filer 10 MB) och varje användare får högst `ARK_AI_TAK_PER_TIMME` (30) begäranden i timmen.
- Flödestjänsten kraschar inte längre på en felaktig begäran. Dev-servern lyssnar bara på `127.0.0.1` (`ARK_DEV_HOST` för att dela). Organisationsspecifika processnamn är borta ur tester och kommentarer; neutralitetstestets namnlistor läses ur `.lokalt/`. CI har bara läsbehörighet och actions är låsta till commit-SHA. Nytt beroende: `dompurify`.

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
