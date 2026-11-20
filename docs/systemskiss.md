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
`/data/skisser`). Skisserna har ingen versionshistorik – en sparning ersätter
den förra. `scripts/sakerhetskopiera-innehall.sh` tar med katalogen.

En installation som monterar innehållets kataloger var för sig (i stället
för hela `/data`) behöver montera även den här.
