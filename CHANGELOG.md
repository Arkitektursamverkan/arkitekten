# Ändringslogg

Ändringarna i Arkitekten (processritaren), nyast först. Versionerna följer
[semantisk versionering](https://semver.org/lang/sv/): en ny huvudversion
när något tas bort eller byter betydelse, en ny mindre version för nya
funktioner, en ny korrigering för rättelser.

## Ej släppt

- Webbläsartesterna (`npm run test:browser`) går igen i en ren klon: de kör mot exempelpaketet i en egen tillfällig installation per rigg och följer dagens gränssnitt. Tester som gäller en installations egna processer hoppar över, utom när `ARK_E2E_INNEHALL` pekar ut installationens innehåll (det läggs då in i den tillfälliga kopian). e2e/ typkontrolleras (`tsconfig.e2e.json`) före körningen.
- Ramarnas test jämför med flödesschemat så som det ritas (perspektivet döljer besluten) – det föll när `flows/` innehöll exempelpaketet.

## 0.3.0 – 2026-10-23

- Organisationens namn, logotyp och profilfärg i skalet och på inloggningssidan: ur `ARK_ORG_NAMN`, `ARK_ORG_KORTNAMN`, `ARK_ORG_LOGO` och `ARK_ORG_FARG`, annars ur portalens organisationsinställningar när portalen är kopplad (`/__ark/utseende`).
- Beroendena uppdaterade: React 19 (react, react-dom och typerna tillsammans), @xyflow/react 12.12, @anthropic-ai/sdk 0.135, happy-dom 21, @testing-library/react 16.3.3, elkjs 0.12 och playwright-core 1.64; verktygskedjan Vite 8, @vitejs/plugin-react 6, Vitest 5 och TypeScript 7; avbilden och CI kör Node 24 (LTS) i stället för 22, och GitHub Actions-stegen har nya huvudversioner (checkout 7, setup-node 7, setup-buildx 4, login 4, metadata 6, build-push 7).

## 0.2.0 – 2026-10-22

- Första versionen i Arkitektursamverkan: verktygen Affärsprocess och Systemprocess, fristående server och avbild, valbar inloggning (Entra ID eller lokala konton), symbolstilar, innehållspaket och versionerade gränssnitt mot plattformen och portalen.
