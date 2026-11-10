# Inloggning, roller och ytor

Den som installerar väljer inloggningen: **Entra ID** (OpenID Connect,
auktoriseringskod + PKCE) med en egen app-registrering eller samma som
portalen, eller **lokala konton** med användarnamn och lösenord. Inloggningen sitter i bryggan (`server/brygga.ts` →
`server/auth.ts`), och det är bryggan som prövar varje läsning och skrivning
(`server/atkomst.ts`). Appen döljer bara de knappar man inte har rätt till.
Reglerna finns på ett enda ställe, `src/core/behorighet.ts`.

## Lägena

| Läge | När | Vem är man |
|---|---|---|
| `entra` | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` och `ENTRA_CLIENT_SECRET` är satta (eller `ARK_AUTH=entra`) | Kontot i Entra. Rollen kommer ur approller eller grupper. |
| `entra` eller `lokal` | `ARK_AUTH=auto` – Entra när alla tre uppgifterna är satta, annars egna konton (aldrig öppen drift) | Som raderna ovan och nedan. |
| `lokal` | `ARK_AUTH=lokal` | Ett konto i installationens kontofil (`ARK_KONTON`). Det första besöket skapar administratören. |
| `öppen` | Inget av ovan | Alla är samma lokala administratör. **Bara för utveckling** – servern varnar vid start. |
| `dev` | `ARK_AUTH=dev` | Man skriver namn och väljer roll själv. **Bara för prov** – slå aldrig på det i en riktig installation. |

I avbilden (`NODE_ENV=production`) startar appen inte i öppen drift eller
provläget – sätt `ARK_AUTH=auto`, `entra` eller `lokal`. Är öppen drift
verkligen meningen (t.ex. bakom ett eget skyddat nät): `ARK_TILLAT_OPPEN=1`.
Ett okänt värde på `ARK_AUTH` är ett fel. Med lokala konton kräver det första
kontot engångskoden `SETUP_CODE` (samma som portalens och plattformens).

Står `ARK_AUTH=entra` men en uppgift saknas vägras inloggningen. Appen faller
alltså inte tyst tillbaka till öppen drift. Både `entra` och `lokal` kräver
`ARK_SESSION_SECRET` (minst 32 tecken) – annars startar servern inte.

Rollerna är två: **administratör** och **användare**.

## Ytor

| Yta | Vad | Läsa | Ändra / fastslå | Ta bort |
|---|---|---|---|---|
| **Gemensam katalog** | Allt utan ägare. Alla befintliga flöden hamnar här. | alla | admin | admin |
| **Demo** | Kategorin `Demo`. Offentlig. | alla | alla | admin |
| **Mina processer** | Flöden med `ägare`. Varje användare har sin egen, med egna kategorier. | ägaren + admin | ägaren + admin | ägaren + admin |
| **Visualisering** | Ramserierna. Alla läser och skapar nya. | alla | skaparen + admin | skaparen + admin |

- Med inloggning börjar en **ny process** i *Mina processer*, eller i *Demo* om
  man väljer det i "Ny process".
- **Flytta → Gemensam katalog** (i katalogen eller i processens huvud) är
  ägarens väg att dela en färdig process. Precis som en vanlig flytt blir det
  ingen ny version, och historiken står still. Tillbaka ur den gemensamma
  katalogen flyttar bara en admin.
- Bara admin **publicerar i EA-portalen**, och bara från den gemensamma
  katalogen.
- En admin ser också *Andra användares processer*. Utan det kan ingen ta hand
  om processer som tillhör någon som har slutat.
- Sparar två personer samma process samtidigt får den som sparar sist svaret
  409 ("ladda om") och skriver alltså inte över den andras version
  (invariant 11).

## Lokala konton

För en installation utan Entra ID, som portalens och plattformens egna konton:

```sh
ARK_AUTH=lokal
ARK_BAS_URL=https://arkitekten.example.org   # https – lösenorden går över nätet (krävs i drift)
ARK_SESSION_SECRET=<openssl rand -hex 32>
ARK_KONTON=/data/konton.json                 # i avbilden redan satt
```

- **Första besöket** visar "Skapa administratören". Det kontot lägger sedan upp
  fler under **Inställningar → Konton**: användarnamn (oftast e-post), namn,
  roll och ett första lösenord. Där sätts också nya lösenord, roller byts och
  konton tas bort. Den som är inloggad byter sitt eget lösenord under
  **Byt lösenord** i kontoraden.
- Lösenorden lagras som saltade scrypt-hashar, aldrig i klartext, och kräver
  minst 10 tecken. Efter fem felaktiga försök på samma namn från samma
  adress spärras den kombinationen en stund, sedan längre för varje nytt fel;
  namnet ensamt spärras först efter 50 fel (mot den som byter adress). En
  gissare kan alltså inte låsa ute någon annan – inte heller administratören.
  Prövningen (scrypt) körs utan att låsa servern.
- **Bakom en proxy** (Render, en omvänd proxy) är socketens adress proxyns,
  och alla hade delat samma spärr. Sätt då `ARK_BETRODD_PROXY` till ANTALET
  proxyer framför appen (oftast `1`; de gamla värdena `true`/`ja` betyder 1).
  Klientens adress tas ur `X-Forwarded-For`, led nummer n räknat från höger –
  varje proxy lägger till adressen den fick begäran från, så de n sista leden
  är proxyernas, och det som står till vänster kan klienten ha skrivit själv.
  Står t.ex. en lastbalanserare framför en omvänd proxy: `2`. Sätt den BARA
  när appen inte kan nås förbi proxyerna.
- Spärren minns högst 10 000 namn/adresser (den äldsta glöms först), och en
  post utan spärr glöms efter en timme utan nya fel.
- **Sessionskakan** får `Secure` när `ARK_BAS_URL` är https, eller när proxyn
  säger att begäran kom över https (`X-Forwarded-Proto: https`). I drift
  (`NODE_ENV=production`) startar lokala konton inte utan `ARK_BAS_URL`.
- Ett borttaget konto är utloggat direkt, och en ändrad roll gäller från nästa
  begäran. Ett konto kan inte ta bort sig självt eller sin egen
  administratörsroll, och den sista administratören går inte att ta bort.
- Processerna ett borttaget konto äger finns kvar under *Andra användares
  processer* för administratörerna.

## Sätta upp appen i Entra ID

Två vägar:

- **Egen app-registrering** för Arkitekten – stegen nedan.
- **Samma app som portalen.** Lägg till Arkitektens redirect-URI
  (`https://<arkitekten>/__ark/auth/callback`) på portalens app-registrering,
  använd samma `ENTRA_TENANT_ID`/`ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET`, och
  ange portalens approller som ger administratör i `ENTRA_ADMIN_ROLLER`. Den
  som redan är inloggad i portalen loggas då in utan ny fråga. Varje produkt
  har ändå sin egen session.

1. **App registrations → New registration**
   - Namn: `Arkitekten`
   - Supported account types: *Single tenant*
   - Redirect URI, plattform **Web**: `https://arkitekten.example.org/__ark/auth/callback`
2. **Certificates & secrets → New client secret.** Kopiera *värdet*, inte id:t.
3. **App roles → Create app role**, två stycken, *Allowed member types: Users/Groups*:
   - Display name `Administratör`, Value **`Arkitekten.Admin`**
   - Display name `Användare`, Value **`Arkitekten.User`**
4. **Token configuration**: lägg till de valfria claims `email` och
   `preferred_username` i ID-token (namnet följer med `profile`).
5. **Enterprise applications → Arkitekten → Properties → Assignment required = Yes**,
   och tilldela sedan användare eller grupper rollerna under *Users and groups*.
   Utan *Assignment required* kan alla i tenanten logga in, och de blir då
   vanliga användare.
6. Lägg in uppgifterna i installationens miljö (`.env`, se `.env.example`):

   ```sh
   ENTRA_TENANT_ID=<Directory (tenant) ID>
   ENTRA_CLIENT_ID=<Application (client) ID>
   ENTRA_CLIENT_SECRET=<hemlighetens värde>
   ARK_BAS_URL=https://arkitekten.example.org
   # Signerar sessionskakan – utan den loggas alla ut vid omstart.
   ARK_SESSION_SECRET=<openssl rand -hex 32>
   # Reserv tills rollerna är tilldelade: e-post eller objekt-id som alltid är admin.
   # Utan ARK_ADMINS används BOOTSTRAP_ADMIN_EMAILS (samma lista som portalen).
   ARK_ADMINS=admin@example.org
   # Valfritt: andra rollvärden som ger admin (förval Arkitekten.Admin,Admin).
   # ENTRA_ADMIN_ROLLER=Arkitekten.Admin
   # Valfritt: grupper (objekt-id) vars medlemmar är admin. Kräver att
   # app-registreringen skickar gruppanspråk (Token configuration → groups claim).
   # ENTRA_ADMIN_GRUPPER=<grupp-id>,<grupp-id>
   ```

7. Starta om Arkitekten. Loggen säger
   `Inloggning: Entra ID (https://arkitekten.example.org).`

**Viktigt:** när inloggningen är påslagen kräver varje `/__ark/*`-anrop
inloggning, och appen måste då nås på `ARK_BAS_URL`, eftersom kakan och
redirect-URI:n hör till den adressen. En direkt adress till servern visar
inloggningsrutan men kan inte slutföra inloggningen.

## Det som inte omfattas

- **Flödestjänsten** (`:8200`, `server/flodestjanst.mts`) har ingen inloggning –
  den är integrationsplattformens. Den lämnar aldrig ut processer i någons
  egen katalog, och med `ARK_FLODESTJANST_NYCKEL` kräver den en delad nyckel
  (`docs/gransnitt.md`). Tjänsten bör ändå inte nås utanför maskinen.
- **Skripten** i `scripts/` skriver direkt på disk och går förbi bryggan. De
  skapar processer i den gemensamma katalogen, som förut.
- En visualisering över en process i någons egen katalog visar ett fel för
  andra: alla läser visualiseringarna, men processen är det inte.
