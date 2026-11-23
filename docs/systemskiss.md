# Systemskiss

En systemskiss är en fri skiss över en systemmiljö: servrar, tjänster,
databaser, nät och hur de hänger ihop – till exempel en tilltänkt
utvecklingsmiljö. Den är **ingen process**: den har ingen text att tolka,
ingen plats i processkatalogen och publiceras inte i Arkitekturportalen.

## Hitta dit

Kortet **Systemskiss** på startsidan. Systemskissen står avsiktligt inte i
menyn till vänster – den hör inte till processerna.

## Rita

- **Lägg till** objekt ur raden överst: server, tjänst, databas, container,
  lagring, klient, användare, nätverk, brandvägg, extern tjänst och
  anteckning. Namn, text under namnet (en rad per uppgift) och sort ändras i
  panelen till höger.
- **Zon** är en ram runt det som hör ihop – en miljö, ett nät, en värd. Flytta
  den i rubriken eller kanten; det som står i den följer med. Zoner kan ligga
  i zoner.
- **Koppla**: markera ett objekt och dra den blå pilen till ett annat, eller
  tryck *Koppla* och klicka på först det ena och sedan det andra. En koppling
  kan få etikett (t.ex. `HTTPS 443`), pil åt ett håll, båda eller ingen, och
  streckad linje.
- Dra i hörnet på det markerade för att ändra storlek. Ctrl-klick markerar
  flera. Delete tar bort, Ctrl+Z ångrar, Ctrl+D duplicerar, Ctrl+S sparar.
- Hjulet zoomar; ett drag på tom yta (eller med mitten-/högerknappen) flyttar
  vyn.
- **Kopiera bild**, **PNG** och **SVG** ger samma bild som ritytan visar.

## Lager

Ett lager är en del av skissen som går att visa för sig – typiskt en
applikation. Lagren skapas i panelen till höger när inget är markerat; markera
sedan objekt och zoner och välj lager. Det som inte ligger i något lager är
*gemensamt* (t.ex. servern som allt står i, eller proxyn framför).

Raden **Lager** över ritytan filtrerar: ett klick på ett lager skalar bort
allt som inte har med det att göra, fler klick lägger till eller tar bort
lager, *Alla* visar hela skissen. Kvar blir lagret, de objekt i andra lager
som det är kopplat till (*Med integrationerna* – går att slå av) och det
gemensamma som hänger ihop med lagret: direkt, eller genom annat gemensamt,
som användaren bakom proxyn. Gemensamt utan koppling till lagret döljs.
Gemensamma zoner dras ihop kring det som visas. Filtret är den tittandes eget
och sparas inte.

**Exporten följer filtret**: kopiera bild, PNG och SVG ger det som visas.

## Versioner

Skissen versionshanteras som processerna. **Spara** ger ett utkast (0.1, 0.2,
1.1 …), **✓ Fastslå** en ny huvudversion (1.0, 2.0 …) – det som gäller – med
en frivillig kommentar. Märket i toppraden säger vilken version man ser
("Utkast 1.1 · fastslagen 1.0"). Beteckningen räknas fram ur historiken med
samma regel som för processerna (`src/core/status.ts`) och lagras aldrig.

Under **Versioner** i panelen (när inget är markerat) står hela historiken.
*Visa* öppnar en äldre version låst, med en rad överst som säger vilken
version det är; därifrån går man *Tillbaka till senaste* eller *Återställer*
versionen – den blir då nästa version när man sparar. En tidigare version
skrivs aldrig om: servern bygger historiken ur filen, aldrig ur begäran.

**Exporten** (kopiera bild, PNG, SVG) får en revisionsruta under bilden:
status, version, datum, vem som sparade – och klassningen när den ska med.
Filnamnet bär versionen. En äldre version som visas exporteras som sig själv.

En sparning som bara ändrar synligheten, publiceringen eller klassningen
ger ingen ny version. En skiss från före versionerna läses som version 0.1,
och dess innehåll blir v1 när den sparas nästa gång.

## Informationsklassning

När installationen har slagit på klassning (se `docs/klassning.md`) väljer den
som får ändra skissen nivå i toppraden (🛡). Nivån sparas med skissen och
är ingen ny version.

## Visa skissen i Arkitekturportalen

En administratör kan under *Visa i portalen, på servern* välja en server ur
portalen. Skissen visas då under fliken **Systemskiss** på den servern, med
lagren som val, för dem som får se servern i portalen – också när skissen är
dold i Arkitekten. Vägen dit är den vanliga: flödestjänsten lämnar ut
publicerade skisser i sin lista (familjen `systemskiss`, id med prefixet
`sk-`), Integrationsplattformen speglar dem och portalen hämtar därifrån
(`docs/gransnitt.md`). Flödestjänsten behöver därför kunna läsa `SKISSER_DIR`.
Portalen visar senaste **fastslagna** version, och den senaste så länge inget
är fastslaget – samma regel som för processerna. Listan bär versionens
`status` och `beteckning`.

## Vem ser och ändrar

| | Läsa | Ändra och ta bort |
|---|---|---|
| Synlig skiss | alla inloggade | den som skapade den + administratörer |
| **Dold** skiss | bara administratörer | bara administratörer |

En administratör kan kryssa i **Dold för andra än administratörer** – när
skissen skapas eller senare, i panelen när inget är markerat. En dold skiss
finns inte för andra: den står inte i listan och dess adress svarar som om
den inte fanns. Reglerna bor i `src/core/behorighet.ts` och verkställs av
servern.

## Lagring

En fil per skiss i `SKISSER_DIR` (förval `skisser/`; i avbilden
`/data/skisser`). Historiken (`versioner`) ligger i samma fil.
`scripts/sakerhetskopiera-innehall.sh` tar med katalogen.

En installation som monterar innehållets kataloger var för sig (i stället
för hela `/data`) behöver montera även den här.
