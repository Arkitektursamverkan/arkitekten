# Ändringslogg

Ändringarna i Arkitekten (processritaren), nyast först. Versionerna följer
[semantisk versionering](https://semver.org/lang/sv/): en ny huvudversion
när något tas bort eller byter betydelse, en ny mindre version för nya
funktioner, en ny korrigering för rättelser.

## Ej släppt

- (inget än)

## 0.3.4 – 2026-11-05

- Affärsprocess: ett steg i kedjan – även ett som AI:n eller regelparsern tolkat fram – tas bort med "Ta bort ur kedjan" i inspektören; kedjan sluts runt luckan. "+ Lägg till aktivitet efter" lägger en ny aktivitet direkt efter steget (efter en regels grenar). En vald kedjepil ger knappen "Bryt kedjan här" uppe till vänster. Ångra tar tillbaka allt.
- Helskärm i både Affärsprocess och Systemprocess: knappen "⛶ Helskärm" visar bara bilden över hela skärmen, utan meny, verktygsrad eller paneler, och låst för ändringar. Esc eller "Avsluta helskärm" går tillbaka.

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
