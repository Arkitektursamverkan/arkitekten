# Flödestjänsten

Kontraktet och dess version: [docs/gransnitt.md](../docs/gransnitt.md).

Arkitektens läsbara yta utåt. Finns för att EA-portalen ska kunna visa
processernas flödesscheman **utan att äga en enda layoutregel**: Arkitekten
räknar ut hela utlägget och skickar en färdigruttad *scen*, portalen ritar bara
det som kommer.

```
npm run flodestjanst                       # flows/ på :8200
FLOWS_DIR=/data/flows PORT=8200 npm run flodestjanst
```

## Varför en scen och inte rådata

Portalen skulle kunna få draften och rita själv – men då finns layoutreglerna på
två ställen, och det är exakt den duplicering som en gång fick skärm och fil att
glida isär i Arkitekten (invariant 1 i `CLAUDE.md`). Scenen vänder på det:

- **noderna kommer färdigritade** som SVG-fragment i lokala koordinater. Att
  bara skicka texten räcker inte – radbrytning, teckenstorlek, radhöjd och
  vertikal centrering räknas fram av `former.ts` med regler som är för många
  för att skickas som data.
- **kanterna kommer färdigruttade** som `d`-attribut, med kollisionsundvikande
  vägar runt alla andra objekt.
- **status och beteckning kommer härledda** (`core/status.ts`, invariant 9).
  Räkna aldrig om dem i mottagaren.

Interaktivitet påverkas inte: fragmenten är vanliga DOM-noder som går att klicka
på, och markering ritar mottagaren själv ur nodens `x/y/w/h`.

Kontraktet står i [`src/core/scen.ts`](../src/core/scen.ts).

## Tjänsten kan inte skriva

Ingen `PUT`, ingen `DELETE`, ingen väg som ändrar en fil. Invariant 11 säger att
en flödesversion aldrig får skrivas över, och det säkraste sättet att garantera
det i en nätverkstjänst är att aldrig ge den förmågan. `flodestjanst.test.ts`
bevisar löftet – både att skrivande verb avvisas och att `flows/` är oförändrat
efter att hela testsviten kört mot tjänsten.

## Vägar

| Metod | Väg | Svar |
|---|---|---|
| GET | `/health` | `{ ok, antal, flowsDir }` |
| GET | `/api/flows` | `{ ok, flows: [{ id, name, savedAt, familj, prefix?, publicering?, stepCount, versionCount, actor, status, beteckning, fastslagenBeteckning }] }` |
| GET | `/api/flows/:id` | `{ ok, flow }` – hela `SavedFlow` med historik |
| GET | `/api/flows/:id/scen?version=` | `{ ok, scen }` |
| GET | `/api/flows/:id/svg?version=` | `image/svg+xml` |

`familj` är `"affarsprocess"` för en Affärsprocess (id med prefixet `ap-`) och
`"flodesschema"` för en Systemprocess.

`publicering` = `{ eaNodId, ägare, beskrivning, publiceradAt }` när processen
är publicerad i EA-portalen (`core/publicering.ts`): en Affärsprocess på en
process i processkartan, en Systemprocess på en
applikation.
Plattformen speglar bara sådana flöden (`endast_publicerade`), och portalen
kopplar dem till noden på `eaNodId`. `prefix` tas ur namnet, annars ur noden
processen publicerats på.

Scen och SVG finns för båda familjerna: `tools/affarsprocess/scen-affarsprocess.ts` för
Affärsprocess och `tools/flowchart/export/scen-flodesschema.ts` för
Systemprocess. Flödesschemats scen bär dessutom `bakgrund` (banor, pool,
mottagarpooler), `artefakter` (datalager, meddelandeflöden, sidhänvisningar)
och `etikettSvg` per kant – färdigritade, som noderna.

`?version=` är `fastslagen` (förval), `aktuell`, eller ett index i historiken.
Förvalet är medvetet: huvudversionen är den bild som gäller i ett styrdokument,
inte det som råkar ligga i editorn.

Id:t måste matcha `^[a-z0-9-]{1,64}$`. Fel svarar `{ ok: false, error }`.


## Mätt på verkliga processer (namnen utbytta)

| Modell | Objekt | Kanter | Scen | Tid |
|---|---|---|---|---|
| Stor process | 104 | 98 | 112 kB | ~1,9 s |
| Mellanstor process | 27 | 25 | 27 kB | <0,2 s |
| Liten process | 7 | 6 | 10 kB | <0,1 s |

Tiden går åt till den kollisionsundvikande routningen och växer med antalet
objekt. För 200 processer betyder det några minuter per full hämtning – planera
schemat därefter, och hämta hellre ändrade modeller än alla varje gång.
