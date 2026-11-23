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

Reglerna bor i `src/core/klassning.ts`.
