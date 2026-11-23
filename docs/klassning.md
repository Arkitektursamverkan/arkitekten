# Informationsklassning

Varje process (affärsprocess och systemprocess) och varje systemskiss kan få
en **klassningsnivå**. Klassningen är AV i en ny installation.

## Slå på

En administratör öppnar **Inställningar** (längst ner till vänster) och
kryssar i *Använd informationsklassning*. Där väljs också:

- **Klassningsmodell.** Produkten har en neutral standardmodell –
  konsekvensnivåerna 0–3 för konfidentialitet som i SKR:s klassningsverktyg
  KLASSA. Organisationer formulerar nivåerna olika; den som vill ha sina egna
  väljer *Egen modell …* och skriver in nivåerna, en per rad. En **indragen**
  rad (blanksteg, tab eller `\` först) är en undernivå till raden ovanför.
  Standardmodellen står ifylld som utgångspunkt.
- **Visa klassningen i exporterade bilder** – en rad *Klassning: …* först i
  bildens revisionsruta (kopiera bild, PNG, SVG, och skissens bild i portalen).
- **Visa klassningen på varje process och systemskiss** – märket 🛡 för dem
  som läser. Den som får ändra ser alltid väljaren.

Inställningen ligger i filen `klassning.json` i `STILAR_DIR` (där också
symbolstilens val står) och läses om när den ändras – ingen omstart.

## Sätta nivån

- **Process:** väljaren 🛡 i rubriken, bredvid statusen, för en sparad
  process. Den som får ändra processen väljer; nivån sparas direkt och är
  ingen ny version.
- **Systemskiss:** väljaren 🛡 i toppraden; nivån följer med nästa sparning
  och är ingen ny version.

Servern prövar att nivån finns i modellen och stämplar när och av vem den
sattes. Byts modellen står den gamla nivån kvar med sitt namn tills någon
väljer en ny. Med klassningen avslagen rörs ingen sparad nivå.

Man kan bara välja en nivå man själv har behörighet att se (se nedan) – annars
stängde man ute sig själv. Administratören väljer fritt.

## Vem får se vad – skyddsklasser

En nivå kan kräva en **skyddsklass**. Administratören lägger upp dem under
*Inställningar → Informationsklassning → Vem får se vad*: ett namn
("Känsliga personuppgifter"), nivåerna som kräver klassen och vilka som har
den. En nivå hör till högst en klass; en nivå utan klass kräver inget extra.

- **I Arkitekten** har man klassen om ens e-postadress, Entra-kontots
  objekt-id eller objekt-id för en Entra-grupp man är med i står i klassens
  lista. Grupperna kommer ur inloggningens gruppanspråk (app-registreringen:
  Token configuration → groups claim, t.ex. "Security groups") och gäller från nästa inloggning. En process eller systemskiss med en nivå
  som kräver en klass man inte har **finns inte** för en: den syns inte i
  katalogen, går inte att öppna (404), ändra, flytta eller ta bort, och dess
  ramserier syns inte heller. Ytan och rollen avgör resten, som förut.
  Administratören ser allt. Listan räknas om vid varje begäran – en ändring
  gäller direkt.
- **I EA-portalen** (0.31.0) är samma klass en behörighet som delas ut i en
  roll under *Behörigheter*, på allt, en objekttyp eller ett enskilt objekt.
  Flödestjänsten skickar nivån och kravet med varje process och skiss
  (`klassning` i listan, se `docs/gransnitt.md`) – oavsett om nivån skrivs ut
  i bilden. Vilka som har klassen i Arkitekten lämnas aldrig ut.
- **En nivå som inte finns i modellen** (modellen har ändrats) ser bara
  administratören – hellre dold än öppen – tills någon väljer en ny nivå.
- **Avstängd klassning** begränsar ingenting.

Listan över vilka som har en klass ser bara administratören; var och en får
veta sina egna klasser (`mina` i `GET /__ark/klassning`).

Reglerna bor i `src/core/klassning.ts` (vilka klasser som finns) och
`src/core/behorighet.ts` (`fårSeKlassning`, `medKlarering`).
