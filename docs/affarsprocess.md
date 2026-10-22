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

Formernas geometri står i `former.ts`. Färger, typsnitt, aktörssymbol (person
eller arbetsplats), skugga och kopplingarnas hörnradie är en **symbolstil**
(`src/tools/affarsprocess/symbolstil.ts`). Produkten har en neutral
standardstil. En installation lägger egna stilar som JSON i `STILAR_DIR`, och
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
  "skugga": false,
  "aktör": "person"
}
```

Färger anges som `#rgb`/`#rrggbb` (eller `none`). En stil som inte går att
läsa visas som ett fel för administratören och används inte.
