# Verktyget Affärsprocess

En affärsprocess ritas som en **förädlingskedja**: verksamhetsobjekt in →
aktivitet → verksamhetsobjekt ut → nästa aktivitet … Roller, IT-stöd, krav och
annat som hör till en aktivitet hänger som **satelliter** runt den. Hela
flödet ligger i en enda bana; vem som gör vad syns i satelliterna, inte i
banor.

Verktyget delar motor med Systemprocess (flödesschemat): samma mellanlager
(`ProcessDraft`), parser, AI-brygga, historik och lagring. Kompileringen
transformerar flödesschemats modell (`compileAp` = `transformToAp(compileDraft(draft))`,
`src/core/affarsprocess.ts`), så grenlogik, borttagna och extra kopplingar och
stabila id:n löses en gång, i flödesschemat.

## Symbolerna

| Symbol | Betydelse |
|---|---|
| Process | Delprocess – en process som körs på annat håll. Ritas som en pil. |
| Aktivitet | Något som utförs i processen. Benämns verb + substantiv ("Genomför urval"). |
| Verksamhetsobjekt | Förädlingsresultatet mellan två aktiviteter. Varianter: dokument, meddelande. |
| Regel (och/eller) | En fråga som delar flödet. Svaren skrivs på pilarna ut ur regeln. |
| Roll, Intressent | Den som utför respektive någon utanför processen som berörs. Pilen bär ansvaret (HUKI). |
| Applikation, Arkiv | IT-stödet aktiviteten samverkar med, och där något förvaras. |
| Krav, Tid | Vad aktiviteten måste uppfylla, och en ledtid eller tidsgräns. Ritas i bandet ovanför. |
| Forum | Mötet där aktiviteten sker. Kan stå i en aktivitets ställe när aktiviteten alltid är ett möte. |
| Plats | Var aktiviteten utförs. |
| Problem, Risk, Möjlighet | Förbättringsarbetets markeringar. |
| Text | Fri anteckning utan koppling till flödet. |

Meningarna står i `AP_TYPE_BETYDELSE` (`src/tools/affarsprocess/former.ts`) och
är samma som paletten och figurförteckningen visar.

**Ansvar (HUKI)** på pilen mellan en aktör och en aktivitet: **H** huvudansvar,
**U** utför, **K** konsulteras, **I** informeras. Bokstaven ritas inte –
varje ansvarstyp har sin färg, och bokstaven står i hovertexten.

## Satellitsyntaxen

I beskrivningen (och i AI:ns svar) skrivs satelliterna sist i stegets text:

```
Genomför urval [Roll: Rekryterande chef U] [IT: Rekryteringssystemet] [Krav: Öka mångfald] [Ut: Slutkandidat utsedd]
```

`[Roll: …]`, `[Intressent: …]`, `[IT: …]`, `[Arkiv: …]`, `[Krav: …]`,
`[Tid: …]`, `[In: …]`, `[Ut: …]`, `[Forum]` (aktiviteten är ett möte).
Tolkas av `src/tools/flowchart/parser/affarsprocess-syntax.ts`, som både
regelparsern och AI-mappningen använder.

## Utseendet – symbolstilar

Symbolernas mått och fästpunkter står i `former.ts`. Färger, typsnitt, skugga,
kopplingarnas hörnradie, pilspetsen och symbolernas form är en **symbolstil**
(`src/tools/affarsprocess/symbolstil.ts`). Produkten har en neutral
standardstil med egna symboler (`standardsymboler.ts`). En installation lägger egna stilar som JSON i `STILAR_DIR`, och
en administratör väljer under **Inställningar**. Valet gäller appen, exporterna
och portalens bilder.

En stil behöver bara ange det som skiljer från standardstilen:

```json
{
  "id": "var-stil",
  "namn": "Vår stil",
  "beskrivning": "Organisationens färger.",
  "teckensnitt": "Georgia, serif",
  "former": { "aktivitet": { "fill": "#eef6ff", "stroke": "#1d4ed8", "text": "#0b1f44" } },
  "huki": { "H": "#b91c1c", "U": "#2563eb", "K": "#0f766e", "I": "#ca8a04" },
  "hörnradie": 6,
  "skugga": false
}
```

Färger anges som `#rgb`/`#rrggbb` (eller `none`). En stil som inte går att
läsa visas som ett fel för administratören och används inte.

### Egna symboler

En stil kan också byta ut symbolerna själva – en sort i taget; de sorter som
inte nämns ritas med produktens. En symbol är en lista **ritdelar**:

```json
{
  "id": "var-stil",
  "namn": "Vår stil",
  "symboler": {
    "regel": [
      { "form": "polygon", "punkter": [[0, 0.5], 3, [13, 0.5], 16, [0, 0.5], 29, [-13, 0.5], 16], "linje": "linje", "bredd": 1.4 }
    ],
    "krav": [
      { "form": "rektangel", "x": 1, "y": 1, "b": [-2, 1], "h": [-2, 0, 1], "r": 6, "linje": "linje", "bredd": 1.6 }
    ]
  },
  "pilspets": ["M", 0, 0, "L", 10, 5, "L", 0, 10, "Z"],
  "forumKontur": "ruta"
}
```

- **Sorterna**: `process`, `aktivitet`, `vo` (samt `vo:dokument` och
  `vo:meddelande`), `regel`, `roll`, `intressent`, `applikation`, `arkiv`,
  `krav`, `tid`, `forum`, `plats`, `problem`, `risk`, `mojlighet`.
- **Formerna**: `rektangel` (`x`, `y`, `b`, `h`, ev. `r`), `cirkel` (`x`, `y`,
  `r`), `ellips` (`x`, `y`, `rx`, `ry`), `polygon` och `linjer` (`punkter`:
  x, y, x, y …), `linje` (`x1`, `y1`, `x2`, `y2`), `bana` (`d`: SVG-banans
  kommandon som strängar och talen som mått) och `tecken` (`x`, `y`, `tecken`,
  `storlek`, ev. `fet`).
- **Måtten** är tal, eller `[konstant, andel av bredden, andel av höjden]` –
  `[0, 0.5]` är mitt i sidled, `[-8, 1]` åtta från högerkanten och
  `[-1, 0, 1]` en från underkanten. `{ "min": [a, b] }` och `{ "max": [a, b] }`
  väljer det minsta respektive största av två mått.
- **Färgerna** (`fyll`, `linje`) är `"fyll"`, `"linje"`, `"text"` eller
  `"ljus"` – sortens färger i stilen – `"ingen"`, eller en hexfärg. Utan `fyll`
  fylls delen med sortens fyllning; utan `linje` får den ingen kontur.
  `bredd` är linjens bredd, `täckning` fyllningens (0–1) och `rund` ger
  rundade skarvar.
- **Ytan**: ikonsorterna ritas i en yta på ca 28 × 28 överst i rutan, kring
  mitten i sidled; namnet står under. `process`, `aktivitet`, `krav` och
  `forum` fyller hela sin ruta och växer med texten. Forumets nedersta 18 %
  är svansens plats, med spetsen vid 29 % av bredden.
- **`pilspets`** är en bana i en ruta 10 × 10 med udden i (10, 5).
  **`forumKontur`** säger om pilar ska möta forumets kropp som en `ruta`
  (förval) eller som en `ellips`.

Produktens egna symboler i `standardsymboler.ts` är skrivna i samma form och
duger som exempel. Allt prövas när stilen läses: bara tal, kända kommandon och
färger släpps igenom.
