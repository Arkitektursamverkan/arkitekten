# Gränssnitten mot plattformen och portalen

Arkitekten talar med två andra produkter. Gränssnitten korsar repon som andra
organisationer kör i egna versioner, så de är versionerade och beskrivna här.

```
Arkitekten ──(1) flödestjänsten──▶ Integrationsplattformen ──▶ portalens /arkflows
     └─────(2) publiceringen (nyckel)──────────────────────▶ portalens /nodes, /arkflows/sync
```

Processbilderna går ALLTID genom plattformen (beslut B1). Modulen Arkitekten i
portalen går inte att slå på utan plattformen.

## 1. Flödestjänsten (Arkitekten → plattformen)

`server/flodestjanst.mts`, en egen process ur Arkitektens avbild (`:8200`). Den
kan bara läsa – ingen väg ändrar ett flöde.

**Nyckeln.** Med `ARK_FLODESTJANST_NYCKEL` satt (samma värde hos Arkitekten och
plattformen) kräver varje `/api/*`-anrop huvudet `X-Arkitekten-Nyckel` med det
värdet; annars `401` med `{ ok: false, error }`. `/health` är alltid öppen.
Utan variabeln svarar tjänsten som förut och varnar vid start. Startar
Arkitekten tjänsten själv (`ARK_FLODESTJANST_PORT`) får barnet nyckeln – och
bara det ur miljön som tjänsten läser (`BARNETS_MILJÖ` i
`server/flodestjanst-barn.ts`), inga andra hemligheter.

**Egna processer lämnas aldrig ut.** Ett flöde i en användares egen katalog
(ytan `egen`, Mina processer – `ytaFör` i `src/core/behorighet.ts`) saknas i
listan och ger `404` på sitt id. Fel som inte är avsiktliga besked ger ett
allmänt `error` – detaljerna står i tjänstens logg.

| Väg | Svar |
|---|---|
| `GET /health` | `{ ok, kontrakt, antal }` |
| `GET /api/flows` | `{ ok, kontrakt, flows: [...] }` – en sammanfattning per flöde |
| `GET /api/flows/{id}` | `{ ok, flow }` – hela flödet |
| `GET /api/flows/{id}/scen?version=fastslagen\|aktuell\|<index>` | `{ ok, scen }` – färdigruttad bild, se `src/core/scen.ts` |
| `GET /api/flows/{id}/svg?version=…` | SVG |

Sammanfattningen i listan: `id`, `name`, `familj` (`affarsprocess` eller
`flodesschema`), `prefix` (processnumret ur namnet, om det finns),
`publicering` (`eaNodId`, `ägare`, `beskrivning`, `publiceradAt` – var i
portalen flödet är publicerat), `stepCount`, `versionCount`, `category`,
`actor`, `status`, `beteckning`, `fastslagenBeteckning`, `savedAt`.

**Versionen.** `kontrakt` är huvudversionen av listan och svaren; scenen har
dessutom sin egen `formatVersion` (`src/core/scen.ts`). En version höjs bara när
något tas bort eller byter betydelse – nya fält höjer den inte, och en
mottagare ska ignorera fält den inte känner. Plattformen avvisar en högre
huvudversion än den känner, med ett tydligt fel, i stället för att visa fel
bild.

**Exemplet.** `kontrakt/flodestjanst-v1.json` är kontraktet i exempelform:
tjänstens svar för exempelpaketet. `server/kontrakt.test.ts` kräver att
tjänsten svarar exakt så, och plattformens tester läser en kopia av samma fil.
Ändras svaret: bygg om exemplet (`npx tsx scripts/bygg-kontraktsexempel.mts`),
pröva om ändringen bryter något, och lägg den nya filen i plattformens tester.

Historik: familjen `affarsprocess` hade ett annat namn före Arkitekten 0.2.
Plattformen och portalen läser fortfarande det gamla namnet.

## 2. Publiceringen (Arkitekten → portalen)

`server/ea-portal.ts`, anropad av bryggan (`/__ark/ea/*`) när en administratör
publicerar. Nyckeln (`EA_API_KEY`, portalens tjänstenyckel) och adressen
(`EA_API_URL`) står i Arkitektens miljö och når aldrig webbläsaren.

| Anrop i portalen | Till vad |
|---|---|
| `GET /nodes?node_type=Process&archived=false` | processträdet i publiceringsrutan |
| `GET /nodes?node_type=Application&archived=false` | applikationerna – målet för en systemprocess |
| `POST /nodes` | en ny process (källa `NONE`, `attributes.källa = "Arkitekten"`) |
| `GET`/`PATCH /nodes/{id}` | ägare och beskrivning på en process Arkitekten själv skapat |
| `PATCH /nodes/{id}` (`archived`) | arkivering vid avpublicering – bara en egen nod |
| `POST /arkflows/sync` | be portalen hämta bilderna nu (genom plattformen) |

Anropen följer portalens API och dess version (`/api/v1`). En nod med extern
källa (`external_source` annat än `NONE`) rörs aldrig – portalens synk äger den.
Bilden själv skickas aldrig den här vägen.
