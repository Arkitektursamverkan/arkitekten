# Arkitekten – regler för den som ändrar i koden

Kort om appen: text → mellanlager (`ProcessDraft`) → deterministisk kompilering
(`compileDraft`) → modell → layout → canvas/export. AI:n fyller bara
mellanlagret; den ritar aldrig. Detaljer i README.md.

## Riktning: modul i Arkitekturportalen

Arkitekten är en valbar modul i Arkitekturportalen (Arkitektursamverkan,
EUPL-1.2), som Integrationsplattformen: egen avbild, profilen `arkitekten` i
driftrepot, modulen `arkitekten` i portalen. Processbilderna når portalen
bara genom plattformen (`docs/gransnitt.md`). För ALL kod gäller:

- **Ny kod är generell.** Inget organisationsspecifikt (namn, banor, adresser,
  personer) i koden – sådant kommer ur inställningar eller innehållspaket. Rör
  du kod som redan har det, lyft ut det hellre än att lägga till mer.
- **Namnen**: verktyget heter **Affärsprocess** (internt `affarsprocess`,
  identifierare `Ap*`/`ap*`), flödesschemat **Systemprocess**. Lagringens
  nycklar är `affarsprocess` (`family`, `diagramType`) och id-prefixet `ap-`;
  koden känner bara de nycklarna.
- **Inloggningen väljs av den som installerar** (separat eller gemensam
  Entra ID-app, lokala konton) – bygg aldrig in ett antagande om en viss
  organisations.

## Invarianter – bryts någon av dessa kommer gamla buggar tillbaka

1. **En regel, en plats.** Allt som både canvasen och exporterna behöver bor i
   `layout/edge-router.ts` och importeras därifrån: `pickEdgeSides`
   (anslutningssidor), `routeEdge` (vägen), `midOfPath` (etikettankare).
   Kopiera ALDRIG en sådan regel in i `FlowCanvas`/`svg.ts`/`drawio.ts` –
   duplicering var orsaken till att skärm och fil gled isär.
   Samma sak gäller ritytans MUSGESTER (`render/canvas-gester.ts`): båda
   ritytorna läser markeringstangenten och panoreringsknapparna därifrån, så
   att samma mus gör samma sak i flödesschemat och i affärsprocessverktyget.

2. **Stabila id:n.** Allt som nycklas på ett id (positioner, namn, banbyten,
   borttagna pilar) kräver att id:t inte kan förskjutas av en redigering.
   Auto-slut heter `end_<föregångarens id>` – härlett, aldrig räknat.
   Inför ALDRIG räknarbaserade id:n för något som användaren kan ändra.

3. **Kantnycklar bär etiketten.** Två pilar kan dela nodpar (Ja/Nej från ett
   beslut till samma steg). `edgeKey(source, target, label)` skiljer dem åt;
   par-nyckeln utan etikett läses som reserv (bakåtkompatibelt). Skicka därför
   alltid med kantens `label` genom hela kedjan UI → draft-helper.

4. **Mellanlagret ägs av spridning.** Draft-helpers returnerar
   `{ ...draft, ändratFält }`. Bygg ALDRIG om en draft fält för fält – då
   tappas okända/nya fält (`edgeStyles`, `autoLabels`, `autoPositions`,
   `autoLanes`, `extraEdges`, `removedEdges`) och sparade flöden korrumperas.

5. **Koordinatramar.** Manuella positioner och brytpunkter sparas i FRIA
   layoutens koordinater. Vid läsning/skrivning i ett delat läge översätts de
   med objektets `dx`/`dy` ur layouten. Spara aldrig skärmkoordinater rakt av.

6. **Pekar-dragningar har vakter.** Ett dragghandtag agerar bara på sin EGEN
   dragning: flagga sätts i `pointerdown` (endast vänsterknapp, `e.button===0`),
   kontrolleras i `pointermove` (`drar.current` + `e.buttons & 1`), nollas i
   `pointerup`. En pekare som sveper förbi med knappen nere får inte trigga.

7. **`locked` i beroendelistorna.** Varje `useMemo`/`useCallback`/`useEffect` i
   render-lagret som läser `locked` (eller annan interaktivitetsflagga) måste
   ha den i sin dependency-array – annars fryser låsläget i gamla värden.

8. **Varje fixad bugg får ett test** märkt `REGRESSION:` som beskriver
   felbeteendet i klartext. Kör `npx tsc -b && npx vitest run` före varje
   commit; committa per avslutad omgång.

9. **Status och versionsbeteckning härleds, lagras aldrig.** Trappan är
   `utkast → fastslagen` och bor i `core/status.ts`. En version bär BARA
   `status`; beteckningen (0.1, 1.0, 1.1, 2.0 …) räknas fram ur historikens
   statusar – fastslagen ger nästa hela tal, utkast räknar minor. Saknad eller
   okänd status läses som utkast, så gamla filer behöver ingen migrering.
   Skriv ALDRIG en beteckning till fil och räkna den aldrig med en egen slinga:
   `versionsBeteckningar`/`sammanfattaStatus` är enda källan, och bryggan
   (`server/brygga.ts`) importerar samma funktion som appen. Frågan "blir
   det här en ny version?" ställs till `skaparNyVersion` i flow-store – både av
   sparningen och av panelens förhandsbesked. Exportens stämpel byggs av
   `revisionAvVersion`, som båda verktygen delar.

10. **Sidbrytningen styrs av regelverket** i `docs/sidbrytningsregler.md`
   (R1–R7), verkställt av `layout/page-rules.ts` och `page-rules.test.ts`.
   Ändra aldrig sidindelningen utan att regelgranskningen är grön – och ändras
   en regel ska dokumentet, granskaren och planeraren ändras I SAMMA commit.
   Rapport: `npx tsx scripts/granska-sidor.mts`.

11. **En befintlig version av ett flöde skrivs ALDRIG över.** Ändrar du
   INNEHÅLLET i ett `flows/*.json` – oavsett om det sker i appen, ur ett skript
   eller med en filredigering – LÄGGS en ny version till i historiken.
   (En vanlig SPARNING rör inte heller placeringen: `saveFlowVersion` behåller
   filens `category`/`subcategory` när fälten är `undefined`, och sparraden
   skickar dem bara när användaren rört väljaren eller flödet är nytt. Annars
   skrev verktygets gamla tillstånd tillbaka en flytt som katalogen just gjort.)
   (UNDANTAG: PLACERINGEN. `category`/`subcategory` säger var processen ligger
   i katalogen, inte vad den innehåller. En flytt eller ett namnbyte på en gren
   skriver bara de fälten – historiken, `savedAt` och beteckningen står still,
   annars hade "senast ändrade" fyllts av processer ingen rört. `sättPlacering`
   och `döpOmGren` i flow-store är den enda vägen; de SPRIDER posten som all
   annan draft-hantering. SAMMA UNDANTAG gäller PUBLICERINGEN i EA-portalen
   (`publicering`, `core/publicering.ts`): var processen visas och vem som äger
   den, skriven bara av `sättPublicering`. Därför sprider också
   `saveFlowVersion` den befintliga posten – byggd fält för fält tappade den
   publiceringen vid nästa sparning.) Det som funnits
   tidigare ska finnas kvar, oförändrat, för all framtid. Du får aldrig
   redigera, slå ihop eller ta bort en tidigare version, och aldrig ersätta
   filen med ett nyskrivet innehåll. Är du osäker på om en åtgärd rör
   historiken: kontrollera först, och fråga produktägaren hellre än att gissa.
   (Ett skript som skriver flöden ska lägga till en version och hoppa över
   oförändrat innehåll. Se även invariant 9: beteckningen räknas fram ur
   historiken, så en bevarad historik är också det som gör versionsnumren
   riktiga.)

12. **Innehållet ligger ALDRIG i git eller på GitHub.** `flows/`, `ramar/`,
   `Input/` och `Rita flödesschema/Input/` är verksamhetens processer och
   underlag och får inte spridas utanför (beslut 2026-10-07) – de står i
   `.gitignore`, och historiken på GitHub är rensad från dem. Committa aldrig
   en innehållsfil, inte heller som testdata: ett test som läser de riktiga
   flödena hoppar över när mappen saknas (`skipIf`), som de befintliga.
   Innehållet versioneras LOKALT (eget git-repo utan fjärr) av
   `scripts/sakerhetskopiera-innehall.sh`, som installationen kör varje natt
   (se dess driftrepo). Det ersätter git som säkerhetskopia – invariant 11
   gäller fortfarande, i filerna själva.

13. **Behörigheten bor i `core/behorighet.ts` och verkställs av bryggan.**
   Ytan (gemensam katalog / Demo / Mina processer) HÄRLEDS: `ägare` på flödet
   → egen, annars kategorin `Demo` → demo, annars gemensam – så filer från
   före inloggningen behöver ingen migrering. `ägare` skrivs BARA av bryggan
   (`server/atkomst.ts`): vid skapandet och via `/__ark/flows/:id/yta`
   (`flyttaTillYta`). En vanlig PUT tar alltid ägaren ur filen, aldrig ur
   begäran. `skapadAv` skrivs likaså bara av bryggan, men BARA vid
   skapandet – ägaren byts vid en flytt, skaparen står still. Flöden från före
   fältet har ingen skapare, och ingen hittas på. Bytet av yta är en PLACERING (invariant 11:s undantag) – ingen ny
   version. Appen gömmer knappar med SAMMA funktioner som servern prövar med;
   skriv aldrig en egen kopia av en regel i en komponent. Lägena är `entra`,
   `lokal` (installationens konton, `server/konton.ts` – lösenord bara som
   scrypt-hash, aldrig ut ur modulen) och `öppen` (utveckling: alla är admin).
   Ett lokalt konto läses om vid varje begäran, så ett borttaget konto är
   utloggat direkt. Uppsättning: `docs/inloggning.md`.

## Verktyget Affärsprocess (src/tools/affarsprocess/)

Ett EGET VERKTYG i verktygsskalet (`shell/tools.tsx`), i nivå med
Systemprocess (flödesschemat) – uttryckligen INTE ett val inuti
flödesschemat (beslut av produktägaren). Motorn delas dock: samma mellanlager,
parser, AI-brygga, historik och lagring. Plan och symbolkatalog:
`docs/affarsprocess.md`.

- **Eget bibliotek i delad lagring**: affärsprocesser sparas med id-prefixet
  `ap-` (`AP_FLOW_PREFIX` i flow-store, `family="affarsprocess"` på
  FlowLibrary). Vartdera verktyget listar bara sin familj.
- **Kompileringen transformerar `compileDraft`-utdatan** (`core/affarsprocess.ts`:
  `compileAp` = `transformToAp(compileDraft(draft))`). Grenlogik, borttagna/
  extra kopplingar och stabila id:n löses ALDRIG om i affärsprocesslagret.
- **Stabila id:n**: auto-VO = `vo_<nodId>`, input-VO = `vo_in_<stegId>`,
  satelliter = `<kind>_<stegId>_<slug>`. Omdöpningar bor i `autoLabels`
  precis som auto-sluten. Aldrig räknare.
- **Formerna bor i EN modul** (`tools/affarsprocess/former.ts`) som både
  ApCanvas och `tools/affarsprocess/svg-affarsprocess.ts` använder – canvasen
  renderar exportens SVG-sträng rakt av. Relationer routas med samma
  `edge-router` som allt annat.
- **Utseendet kommer ur en SYMBOLSTIL** (`tools/affarsprocess/symbolstil.ts`):
  färger, teckensnitt, aktörssymbol, skugga och hörnradie. Produkten har en
  neutral standardstil (`NEUTRAL_STIL`); en installation lägger sina egna
  stilpaket i `STILAR_DIR` (`server/symbolstilar.ts`), en administratör väljer
  under Inställningar (`shell/Installningar.tsx`), inloggningsgrinden sätter
  stilen före första ritningen och flödestjänsten sätter den per scen.
  GEOMETRIN bor i `former.ts`; FÄRGER bara via `symbolstil()`/`formstil()`/
  `hukiFärg()`/`relationsFärg()` – hårdkoda aldrig en färg i en komponent.
- **Satellitsyntaxen** `[Roll: X U] [IT: Y] [Krav: Z] [In: …] [Ut: …]`
  tolkas av `flowchart/parser/affarsprocess-syntax.ts` och används av BÅDE
  regelparsern (`toDraft.ts`) och AI-mappningen (`ai/schema.ts`) –
  annoteringarna lyfts ut FÖRE klassificeringen och får aldrig påverka typ-
  eller banval. Blocket hamnar i stegets fält `ap`. Vanliga parenteser är
  grensyntax och kan inte användas för In/Ut. En parentes UTAN beslutshuvud
  (`↓ Om …`) och utan separator inuti är dock ett FÖRTYDLIGANDE och följer med
  i stegets etikett – aldrig egna steg (`ärFörtydligande` i `toDraft.ts`).
- **Forum står i en AKTIVITETS ställe** (metoden: kan användas i stället för
  en aktivitet när aktiviteten alltid ska genomföras i mötesform). `[Forum]`
  UTAN kolon sätter `ap.iMötesform` och steget ritas som pratbubbla i kedjan,
  med roller, objekt och beskrivning som en aktivitet. `[Forum: X]` finns kvar
  som satellit – AI-instruktionen använder den inte, och panelen erbjuder den
  bara för att kunna ta bort den. Bubblan (ellips med svans ned åt vänster)
  har en AKTIVITETS mått, svansen inräknad – en ballong runt texten blev
  alldeles för stor; pilar möter ellipsens kontur (`apKontur`) och klustrets
  stammar hänger till höger om svansen (`apStamMitt`).
- **Layouten** (`tools/affarsprocess/layout-affarsprocess.ts`): vågrät kedja,
  grenar en rad ner, krav/tid i ett band över kedjan. Roller och IT-stöd bildar
  ett KLUSTER direkt under sitt ankare, i ankarets EGEN rad: aktörerna i en
  lodrät stapel till vänster, IT-stödet i en till höger, och två stammar i
  springan emellan som strecken böjer mot (`klusterStam`/`klusterSida`).
  Kolumnbredden räknas på klustret, inte på satelliterna sida vid sida – det
  var den gamla vågräta raden som sköt isär kedjan till tre gånger bredden. Ett
  gemensamt band under HELA kedjan hörde till samma gamla utlägg: med två
  kedjerader hamnade rad 0:s roller nedanför rad 1. R8: en satellit följer
  ALLTID sitt ankare till samma del vid sidbrytning. Staplarna står BREDVID
  sina stammar, aldrig på dem (`stammarFör`/`xVidStam`): aktörens ikon slutar
  en bit till vänster om aktörsstammen, IT-stödets börjar en bit till höger om
  sin, och namnet under en aktör slutar före stammen. Varje streck blir då ETT
  vågrätt + ETT lodrätt. En centrerad stapel lade stammen genom översta ikonen
  och fick nästa aktörs streck att slingra runt den (beslut 2026-10-13). Forum
  och plats hänger i den svarta samverkanslinjen och står därför på IT-sidan.
  Flera ansvarstyper får var sin stam UTÅT VÄNSTER, så avståndet till
  IT-stammen står still. Kolumnen mäts åt vardera hållet för sig (`kolMitt`) –
  klustret är osymmetriskt.
- **Kopplingarna är RAKA när de är menade som raka.** Två motstående portar som
  ligger inom `RAK_TOLERANS` (3 px, `layout/edge-router.ts`) dras till samma
  linje innan vägen räknas. Utan det svarade routern på en enda pixels skillnad
  med ett litet hack strax före målet – segmenten mätte [97, 1, 14], och "typ
  varannan koppling är krokig på något ställe" (2026-09-08). Bruset kommer ur
  att symbolens mitt sitter olika långt ner i rutan för olika sorter
  (aktivitet h/2, verksamhetsobjekt ikonens mitt) och att koordinater skalas
  med en bråkdel innan de avrundas. Tröskeln är AVLÄST, inte vald: över
  samtliga flöden ligger avvikelsen antingen under 2,1 px eller över 10 px, och
  gränsen lades i gapet. Bara motstående sidor rörs – ett L ska förbli ett L –
  och en dragen brytpunkt äger vägen helt. Regeln bor i edge-routern, alltså
  gäller den BÅDA verktygen. SAMMA TOLERANS SNÄPPER BRYTPUNKTEN
  (`snäppBrytpunkt`): en punkt en pixel från målportens linje gav svansen ett
  hack och två extra böjar. En punkt som ligger längre bort rörs aldrig – då
  är avvikelsen ett val.
- **Riktig förskjutning rätas av ANVÄNDAREN, inte i tysthet.** Står två objekt
  tiotals pixlar isär går kopplingen inte att räta i ritningen, bara i
  utlägget: objekten måste flytta på sig. Verktygsradens "⌗ Räta upp
  kopplingarna" gör det på MARKERINGEN – `rätaUppKopplingar`
  (`tools/affarsprocess/rata-upp.ts`) räknar, ApTool lägger lägena i
  mellanlagret i EN setDraft så ångra tar hela uppträtningen i ett steg.
  Riktningen läses ur objektens lägen (ligger de längre isär i sidled än i
  höjdled är strecket menat som vågrätt), linjerna bildas med union-find per
  axel, och målvärdet är MEDIANEN så att färst objekt flyttar. Två objekt får
  aldrig hamna på samma linje i båda led – då offras den snedaste kopplingen.
  Kopplingar UT ur markeringen rörs aldrig. Markeringen ägs av React Flow och
  rapporteras upp med `onSelectionChange`.
- **En manuell väg dras i SINA STRÄCKOR, inte bara i brytpunkten.** Med en
  egen brytpunkt tar man tag i linjen där man ser den (`dragbaraSträckor` i
  edge-router): rälsen upp/ner, en lodrät sträcka i sidled, och SISTA
  sträckan in mot målet – den låg förut fast framför målets port, genom
  målets satelliter, och sätter nu kantens andra brytpunkt (`waypoint2`,
  `sistaSträckan`). Ett handtag på en punkt räckte inte: brytpunkten kunde
  ligga tusentals pixlar bort från sträckan man ville flytta (2026-09-30).
  Kopplat i affärsprocessverktyget; flödesschemat får det genom att skicka
  `onWaypoint2Change`.
- **Kopplingarna svänger mjukt.** Radien kommer ur symbolstilen
  (`apHörnradie()` i `former.ts`, skalas med utlägget; 0 = räta vinklar) och
  verkställs av `pointsToPath(pts, radie)` i edge-router – EN plats, så skärm,
  SVG-export och scenen till EA-portalen ritar samma väg. Flödesschemat
  skickar ingen radie och behåller sina räta vinklar.
  Klustrets två stammar (aktörer respektive IT-stöd) hänger i AKTIVITETENS
  MITT – en halv springa åt vardera hållet, springan följer aktivitetens bredd
  – aldrig i satelliternas ytterkanter. Det är regeln som gör att varje
  aktivitet i varje process ser likadan ut. Räknades stammen ur satelliterna
  hamnade den vid rutans ena kant så fort klustret bara hade aktörer, och
  vilken kant berodde på var rollerna råkade stå. SORTEN avgör vilken stam en
  satellit hänger i – aldrig var den råkar ligga – och LÄGET bara vilken väg
  strecket tar dit; står symbolen grensle över stammen går strecket rakt upp
  utan knä. Satelliternas anslutningspunkter och vägknän ägs av klustret.
- **Ansvarslinjerna har en färg per HUKI-bokstav** (`hukiFärg()`, ur
  symbolstilen). Färgen bär betydelsen, så bokstaven skrivs ALDRIG ut
  (`apRelationEtikett`); den står i hovertexten. Alla pilspetsar är FYLLDA –
  sorterna skiljs med färg, inte med spetsens form, och en öppen spets på en
  tunn färgad linje syntes knappt. Aktörssidan får en stam per ansvarstyp,
  ordnade VÄNSTERUT FÖRST (efter var gruppens aktörer står) och därefter
  uppifrån och ner, så att den understa satellitens stam ligger närmast
  aktivitetens mitt; annars korsar strecken varandra. Scenen PEKAR UT sin
  markör (`ScenKant.markör`) – mottagaren får aldrig gissa id:t ur
  relationstypen.
- **Etiketter kapas aldrig.** Aktiviteten krymper ALDRIG sin text för ett
  långt ord – rutan blir bredare (`apRadbredd`). Samma sak när etiketten inte
  ryms på radtaket (`AP_MAX_RADER`): raden BREDDAS tills texten får plats,
  aldrig kapas. `wrap` klipper tyst, och en lång regelfråga tappade annars
  sista ordet och frågetecknet ur bilden. Etiketten ska vara en rad i
  medianfallet, ALDRIG mer än tre, och brutna rader löper 23–31 tecken; en
  grundbredd på 13–14 tecken gav sex smala rader i en hög ruta med orden
  sönderbrutna mitt i. Grundbredden (18 tecken för ikontyper, 22 för former
  med texten inuti) är vald genom att mäta korsningarna i SAMTLIGA flöden –
  bredare rader gör rutorna så breda att de börjar krocka i de täta
  modellerna (en gick från 0 till 7 korsningar vid 26 tecken). HUKI-bokstaven
  "U" skrivs inte ut (`apRelationEtikett`); den är förvalet.
- **Etiketten skrivs på kanten i MELLANLAGRET** (dubbelklick, `setEdgeLabel`
  – samma regel som flödesschemat). Pilen man klickar på är inte alltid den
  kanten: ut ur ett insprängt objekt (`vo_s3 → s4`) är den `s3 → s4`. Därför
  bär varje kedjerelation `kant` ur `compileAp`; satelliter och in-objekt har
  ingen och går inte att märka. Regelns MOTSATTA väg (Nej när bara Ja har
  steg) har inga steg som kan bära namnet – det bor på beslutet
  (`motsattEtikett`), och nycklarna migreras som för en gren (invariant 3).
- **Affärsprocesskontrollen** (`tools/affarsprocess/kontroll.ts`) är
  RÅDGIVANDE – den hindrar aldrig ritning eller export, och den tiger om det
  användaren uttryckligen valt (t.ex. bortvalt ut-objekt). Lägg nya regler där
  + test, aldrig som hårda spärrar.
- **Ett krav kan bära en RUTIN** (`draft.apRutiner`, nycklad på kravets
  nod-id): arbetsbeskrivningen bakom "Rutin för …", en rad per moment, indragen
  rad = underpunkt (`core/rutin.ts` tolkar, `tools/affarsprocess/RutinVy.tsx`
  visar). Skapas ur inspektören när man klickat på kravet; kravet får då
  rutin-ikonen, och ett klick på det öppnar rutinen ÄVEN I LÄSLÄGE (`onRutin`
  i ApCanvas) – det är det enda klick läsläget släpper igenom. Nyckeln är ett
  id, så den flyttas med vid namnbyte (`renameSatellit`) och när ett fritt krav
  knyts in (`flyttaPosition` i lagg-till). Skriv bara via `sättRutin`.
  En CHECKLISTA i kravet – `[Krav: Rutin X – ☐ moment ☐ moment]`, så skriver
  man och AI:n en rutin i löptexten – lyfts till rutinen av
  `lyftUtChecklistor` (`core/affarsprocess.ts`; delningen är `delaChecklista`
  i `core/rutin.ts`): kravet får namnet före rutorna, rutinen ett moment per
  ruta. Båda tolkarna (`textToDraft`, `ai/schema.ts`) kör lyftet; ett sparat
  flöde lyfts per krav när man trycker "Skapa rutin ur checklistan" i
  inspektören. En befintlig rutin skrivs aldrig över. Inne i hakparenteser
  skyddar regelparsern streck, pilar och parenteser (`SKYDD_HAK`), så en
  satellit blir aldrig steg eller gren.
- **Kedjan redigeras i inspektören, inte med tangenter** (`lagg-till.ts`):
  `taBortObjekt` tar bort kedjesteg (även tolkade) och fria objekt – ett steg
  tar med sig satelliter, verksamhetsobjekt och handritade pilar till sig, och
  kedjan SLUTS runt luckan. Att BRYTA kedjan är en egen handling:
  `taBortKedjepil` på mellanlagrets kant (`rel.kant`, hittad med
  `kedjekantFör` i ApCanvas – tom etikett och saknad är samma nyckel), via
  knappen "Bryt kedjan här" när en kedjepil är vald. `läggTillAktivitetEfter`
  lägger ett riktigt kedjesteg efter steget (efter en regels grenar). Delete/
  Backspace tar ALDRIG bort något: man ska se vad man tar bort (se testet
  "Delete på ett markerat objekt").
- **Helskärmen** (`render/helskarm.ts`, `useHelskärm`) är EN plats för båda
  verktygen: ritytans behållare får `ark-helskarm` (styles.css gömmer allt utom
  ritytan, avskalade vyn och Avsluta), ritytan LÅSES och vyn anpassas
  (`anpassaVy`/`regenKey`). Webbläsarens helskärm begärs men krävs inte. Bara
  den egna helskärmen lämnas – ramarnas presentation rörs aldrig.
- **Flödesschemat har samma regel**: `draft.fria` bär de steg som placerats ur
  verktygsraden. De ritas men kedjas inte in och får inget auto-slut; `knytIn`
  (anropas av `addManualEdge`) släpper dem loss OCH undertrycker den automatiska
  kedjepilen in, så bara den koppling man ritade blir kvar.
- **Palettens objekt är FRIA** (`draft.apFria`, id `fri_<n>` lagrat vid
  skapandet): ingen koppling förrän användaren drar en pil – då konverterar
  `knytIhop` (`tools/affarsprocess/lagg-till.ts`) objektet till sin riktiga
  form (satellit i ap-blocket, ut/in-VO, kedjesteg). Kedja ALDRIG in ett
  placerat objekt automatiskt – det ritar om flödet och ser ut som att objekt
  försvinner (produktägarens uttryckliga krav).

## BMT-export (.bmt)

Knappen **BMT (.bmt)** under Export → Som fil i affärsprocessverktyget
(`tools/affarsprocess/bmt-export.ts`, byggaren `tools/affarsprocess/bmt.ts`):
ett modellarkiv (zip med XML) som ett modelleringsverktyg med samma metod
läser in. Produkten NÄMNER INTE det verktyget (`server/neutralitet.test.ts`).

- **Allt repositoryspecifikt kommer ur MALLEN** – en vanlig modellexport ur
  mål-repositoryt som installationen pekar ut med `ARK_BMT_MALL`
  (`server/bmt-mall.ts`, läses vid varje begäran). XML-namnrymden, språket,
  skaparen, beskrivningstypen, profilen (`config.xml`) och schemana tas
  ordagrant ur den (`inställningarUrMall`). Utan mall visas ingen knapp
  (`bmtMall` i `/__ark/status`). En fil utan profil, scheman och skapare gick
  inte att läsa in (provat 2026-11-04).
- **Webbläsaren bygger filen**: `/__ark/bmt/mall` → `läsZip` →
  `byggBmt` → nedladdning. Zip och UUID v5 är egen kod (`core/zip.ts`,
  `core/namn-id.ts`) – inga beroenden.
- **Stabila id:n** (invariant 2): allt härleds ur flödets och objektens id:n,
  så en ny export uppdaterar modellen i stället för att kopiera. Roller,
  intressenter, IT-stöd, arkiv och platser är gemensamma objekt per NAMN.
  Byt aldrig `RYMD` i bmt.ts – då blir varje export en kopia.
- **Vägarna är skärmens**: `apRelationsVäg` (layout-affarsprocess.ts) är EN
  plats för SVG-exporten och BMT-exporten. Ändpunkterna flyttas bara till
  målets mindre ikonrutor (`tillKant`).
- Metoden översätts rakt: FLOW, HUKI → RACI_*, IT-stöd/arkiv →
  INTERRELATES_WITH (pilen vänd), krav/tid → ADRESSES. Kravets rutin blir en
  numrerad lista i beskrivningen, och checklistor lyfts först
  (`lyftUtChecklistor`). Skript utan appen: `scripts/exportera-bmt.mts`.

## Publicering i EA-portalen

Knappen **Publicera i EA-portalen** i affärsprocessens huvud
(`tools/affarsprocess/Publicera.tsx`). Rutan väljer en befintlig process i
portalens träd ELLER skapar en ny under en vald förälder, kräver processägare
och beskrivning, och kan fastslå det man ser genom den vanliga sparningen
(`spara("fastslagen")` på FlowLibrary-handtaget). Publiceringen skrivs på
flödet med `sättPublicering`.

- **Bilden går som förut**: flödestjänsten → integrationsplattformens
  arkitekten-connector (`endast_publicerade`) → portalens `arkflows`. Portalen
  visar alltid senaste FASTSLAGNA version och kopplar flödet till noden på
  `eaNodId` (numret i namnet är reserv för gamla speglingar).
- **Portalen anropas bara från servern** (`server/ea-portal.ts` via
  `/__ark/ea/*` i bryggan) med `EA_API_KEY` (+ `EA_API_URL`, `EA_WEBB_URL`) ur
  serverns miljö – se `.env.example`. Nyckeln ger admin i portalen och når
  aldrig webbläsaren.
- **En nod med extern källa rörs aldrig** – portalens synk skriver över den
  (kontrollen är `källa !== "NONE"`). Bara en nod publiceringen själv skapat
  (`egenNod`) får ny ägare/beskrivning, och då med SAMMANSLAGNA attribut
  (portalens PATCH ersätter hela `attributes`).
- **Avpublicering** (samma ruta) tar bort fältet med `taBortPublicering` –
  ingen ny version – och låter portalen hämta om; plattformen gallrar då
  flödesschemat. En `egenNod` kan arkiveras samtidigt (förval på, går att ta
  tillbaka i portalen). Servern (`arkiveraEgenProcess`) kontrollerar själv att
  noden har källa NONE och `källa: "Arkitekten"` – en nod med extern källa
  arkiveras aldrig.
- **Systemprocess publiceras hos en APPLIKATION** (`tools/flowchart/
  PubliceraSystemprocess.tsx`), där portalen visar den under fliken
  Systemprocesser. Samma post (`Publicering`, `eaNodId` = applikationens nod)
  och samma `sättPublicering`/`taBortPublicering`; versionsvalet delas
  (`useVersionsval`/`VersionsVal` i `tools/affarsprocess/Publicera.tsx`). En
  applikation per systemprocess, och BARA befintliga – applikationerna
  förvaltas i portalen och skapas eller ändras aldrig härifrån
  (`/__ark/ea/applikationer` läser). Avpublicering rör aldrig applikationen.
  Portalen skiljer de två målen på flödets `familj`.
- **Systemprocessens scen** (`tools/flowchart/export/scen-flodesschema.ts`)
  är byggd av SAMMA delar som SVG-exporten: `bakgrundSvg`, `ruttaSekvensflöden`,
  `kantEtikettSvg`, `artefakterSvg` och `nodSvg` i `export/svg.ts`. Scenen bär
  banor och artefakter färdigritade (`bakgrund`, `artefakter`, `etikettSvg` –
  tillagda fält, ingen ny `formatVersion`). `scen-flodesschema.test.ts` kräver
  att varje bit står tecken för tecken i exportörens SVG; lägg aldrig en
  ritregel direkt i scenbyggaren.

## AI-bryggan (.ark/)

**Bryggan är EN hanterare med två värdar** (`server/brygga.ts`): den
fristående servern (`server/arkitekten.mts`, `npm start`, avbilden) och
Vite-tillägget (`scripts/ark-bridge.ts`, `npm run dev`). Lägg aldrig en regel
i bara den ena. Inställningarna läses BARA ur miljön
(`server/installningar.ts`, `.env.example`) – inga standardvärden som pekar
på en organisation, och inga nycklar i loggar, svar eller webbläsaren.
Organisationens namn som inte är utseende kommer ur `core/organisation.ts`:
portalbanan i en systemprocess är `portalbana()` (`ARK_PORTALBANA`, förval
"Portalen") och katalogens samling för systemprocesser utan kategori
`organisation().systemprocesskategori` (`ARK_SYSTEMPROCESS_KATEGORI`, förval
"Systemprocesser"). Skriv aldrig in ett sådant namn i koden.

AI-stödet har tre lägen: **api** (nyckel i miljön), **claude-code**
(`ARK_UTVECKLARLAGE=1`, brevlådan nedan) och **av** (inget av dem – knapparna
visas inte och `/request` svarar 503).

**Med API-nyckel svarar servern själv.** Står `ANTHROPIC_API_KEY` (och vid
behov `ANTHROPIC_WORKSPACE_ID`, `ARK_AI_MODELL`) i miljön besvarar servern
varje begäran med `src/tools/flowchart/ai/besvara.ts` och
skriver svaret i `response.json` i exakt den form som beskrivs nedan. Nyckeln
lämnar aldrig servern; webbläsaren har ingen. `GET /__ark/status` säger vilken
väg som gäller, och knapparnas texter följer den (`useAiVäg`). Ett misslyckat
anrop blir `{ fel }` och visas i appen. Presentationen får SAMMA kontroll som
`scripts/presentation.mts` (`beskrivFörenklad`/`byggPresentation`) och skickas
tillbaka för rättelse så länge den har anmärkningar. Utan nyckel, i
utvecklarläget, gäller allt nedan: Claude Code svarar för hand.
Ett betalt anrop går ALDRIG iväg ogodkänt: `skickaOchVänta` frågar
`godkännKostnad` (`ai/kostnad.ts`, beloppen per uppdrag) innan begäran
skickas, och `KostnadsDialog` i skalet visar rutan. Lägg aldrig till en
AI-väg förbi bryggan – då slinker den förbi frågan.
Rutan kan också skicka begäran till Claude Code i stället (`via:
"claude-code"` i begäran – servern anropar då inte API:t och begäran väntar i
brevlådan som utan nyckel). Bara i utvecklarläget – annars erbjuder rutan
den inte, och servern bortser från `via`.

När du (Claude Code) besvarar en tolkningsbegäran: läs `.ark/request.json`,
skriv `.ark/response.json` och **kopiera `id` ur begäran till fältet
`requestId` i svaret**. Det är korrelationen som hindrar att ett sent svar på
en avbruten begäran plockas upp av fel begäran. Svarsformat: antingen fullt
strukturerat enligt `ai/schema.ts` (`aiText`, `title`, `subtitle`, `lanes`,
`steps`) eller bara `{ "aiText": "..." }` i pilformat. Svenska. Verifiera
gärna svaret genom pipelinen (`toDraft` → `compileDraft` → `validateModel`)
innan du skriver filen.

Begäran bär `diagramType`: `"flowchart"` eller `"affarsprocess"`. Är den
`"affarsprocess"` gäller affärsprocessmetoden (`AP_METODEN` i `ai/prompt.ts`)
och INTE flödesschemats regler nedan – hela regeluppsättningen följer med i
`instruction` (den är `AP_SYSTEM_PROMPT` ur `ai/prompt.ts`): vågrät
förädlingskedja, aktiviteter som verb + substantiv, regler som frågor,
satelliter i hakparenteser (`[Roll: … U]`, `[IT: …]`, `[Krav: …]`, `[Ut: …]`)
BÅDE i `aiText` och i stegens `text`, och EN lane för hela flödet. Svara aldrig
på en affärsprocessbegäran med simbanetänk.

### Uppdraget "presentation" – förenklad process + ramar

(Ramar heter **Visualisering** i gränssnittet sedan 2026-10-14 – en
visualisering är en ramserie, och den består av ramar. Koden, `core/ram*.ts`,
`/__ark/ramar` och mappen `ramar/` behåller sina namn, så inget sparat
behövde flyttas. En process som har en visualisering får knappen "Öppna i
Visualisering" i sitt huvud, `tools/ramar/OppnaVisualisering.tsx`.)

Begäran bär också `uppdrag`. `"tolkning"` är det vanliga (ovan). Är den
`"presentation"` kommer den ur knappen **✦ Förenkla och presentera**, som tänds
i verktygsraden när processen är AI-tolkad (`tools/ramar/PresentationsKnapp.tsx`,
samma knapp i båda verktygen). Då väntas TVÅ saker i samma svar:

```json
{ "requestId": "<id>", "förenklad": { … }, "presentation": { "namn", "scen", "ramar" } }
```

- `förenklad` är en vanlig affärsprocesstolkning (helst strukturerad, med
  EGNA talande steg-id:n – de blir ramarnas mål). Slingor och grenar som tar
  slut uttrycks med `kopplingar: { taBort, läggTill }`; appen verkställer dem
  med draftens egna helpers (`removeEdge`/`addManualEdge`).
- `presentation` är ramar och scen i LAGRINGENS form (`core/ram.ts`,
  `core/ram-scen.ts`), utan id:n – de skapas av appen. Hela formen, figurtyperna
  och scenens mått står i begärans `instruction` (`presentationsInstruktion`).
- `rawText` är ett JSON-underlag: beskrivningen och det som faktiskt är RITAT.
  `källa` säger vilket flöde det gäller.

**Arbeta i ett utkast, aldrig rakt i `response.json`** – appen plockar upp
svaret i samma stund som filen finns:

1. Skriv `förenklad` till `.ark/utkast.json`, kör `npx tsx scripts/presentation.mts`.
   Den listar den avskalade bildens objekt-id:n och kopplingsnycklar – ENDAST
   de går att markera (mellanliggande verksamhetsobjekt ritas inte).
2. Lägg till `presentation`, kör igen tills anmärkningarna är borta. `--png
   <fil>` ritar bilden; titta på den.
3. `npx tsx scripts/presentation.mts --skicka` lägger svaret i brevlådan med
   rätt `requestId`.

Skriptet och appen kör SAMMA kod (`byggPresentation` i
`tools/ramar/ai-presentation.ts`), så det skriptet godkänner är det som
sparas. Appen sparar – skriv aldrig själv i `flows/` eller `ramar/` för det här
uppdraget. Processen blir `ap-<källans id>-presentation` i kategorin
Presentation. VARJE KÖRNING GER EN NY PROCESS OCH EN NY RAMSERIE (`…-2`, `…-3`):
den öppna processen rörs aldrig, och en tidigare presentation kan vara ändrad
för hand och ska stå kvar som den är (beslut 2026-10-01). Appen väntar
i 60 minuter och sidan måste stå öppen: laddas den om går svaret förlorat och
knappen får tryckas igen.

### Uppdraget "rutin" – en uppladdad fil blir en rutin

`uppdrag: "rutin"` kommer ur knappen **✦ Skapa ur fil** i rutinvyn
(`tools/affarsprocess/RutinVy.tsx`, `tools/affarsprocess/ai-rutin.ts`).
`rawText` är JSON med `fil` (sökvägen till det uppladdade underlaget,
`.ark/underlag/…` – LÄS filen; den kan vara Word, PDF, text eller en bild),
`krav` och `aktivitet`. Svara med `{ "requestId": "<id>", "rutin": "<text>" }`:
en rad per moment, indragen rad (två blanksteg) = underpunkt, ` → ` mellan
klicken i en klickväg, momentet börjar med verbet. Hela formen står i
begärans `instruction` (`RUTIN_INSTRUKTION`). Texten hamnar i rutinvyns
UTKAST – användaren sparar själv. Skriv aldrig i `flows/` för det här
uppdraget.

### Tolkningar av FLÖDESSCHEMAN

Måste vara konsekventa mellan diagrammen – följ `SYSTEM_PROMPT` i
`ai/prompt.ts`, det är samma regler:
- En bana är en aktör eller ett system som UTFÖR något – aldrig en kanal.
  Skapa ingen "Kommunikationsmedel"/"Mejl"-bana.
- **Flödet går vidare i SAMMA bana som standard.** Byt bana bara när underlaget
  ger ett skäl: ny aktör, eller ett annat system som utför steget.
- Ett `datastore` bär ALDRIG banan vidare – det ligger utanför sekvensflödet.
  Steget efter en loggpost hör till banan FÖRE loggposten.
- Ett slut-event utför ingenting: det ligger i samma bana som vägarna in i det.
  Aldrig i loggningens eller systemets bana. Samma sak för beslut.
- Notifieringar ligger i AVSÄNDARENS bana med `recipient` satt
  (Användare/Handläggare/…) → ritas som meddelandeflöde till en svart låda.
  Tar steget EMOT ett meddelande: `messageDirection: "receive"`.
- De kanoniska banorna står i `kanoniskaBanor()` i `ai/prompt.ts` (portalbanan
  är `portalbana()`). Jämför gärna med `flows/*.json` innan du väljer nya.

**Installationens husstil.** En installation kan ha en egen husstil, egna
skript och egna tester i `.lokalt/` (gitignorerad, monterad av installationens
driftrepo). Finns `.lokalt/HUSSTIL.md` – följ den när du besvarar
tolkningsbegäran för flödesscheman.

## Kommandon

- `npm run dev` – dev-server (bryggan via Vite-tillägget)
- `npm start` – fristående server (kräver `npm run build`)
- `npx vitest run` – hela testsviten; `npm run test:browser` – e2e i browser
- `npm run build` – typecheck + produktionsbygge
