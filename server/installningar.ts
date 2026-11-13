/**
 * Arkitektens inställningar – BARA ur miljön.
 *
 * Allt en installation väljer står i miljövariabler (i drift: driftrepots
 * `.env`). Koden känner inte till någon fil på servern och har inga
 * standardvärden som pekar på en viss organisation. Nycklar läses här och av
 * de moduler som använder dem, men skrivs aldrig ut – inte heller i loggen.
 *
 * `kontrollera` körs vid start: ett FEL stoppar den fristående servern med en
 * rad per problem, en VARNING loggas. Vite-dev-servern loggar båda.
 */

import { bmtMallFil, läsBmtMall } from "./bmt-mall";
import fs from "node:fs";
import path from "node:path";
import { AUTH_LÄGEN, authKonfigUrMiljö, basUrlUrMiljö, förstaKontoKod, iProduktion, saknasFörEntra } from "./auth";

export interface Installningar {
  /** Där relativa sökvägar räknas ifrån – projektroten. */
  root: string;
  /** Appens port (webben och `/__ark`). */
  port: number;
  flowsDir: string;
  ramarDir: string;
  /** Symbolstilarna (server/symbolstilar.ts). */
  stilarDir: string;
  /** AI-brevlådan och uppladdade underlag. */
  arkDir: string;
  /** De lokala kontona (inloggningsläget "lokal", server/konton.ts). */
  kontonFil: string;
  /** Det byggda gränssnittet (`npm run build`). */
  distDir: string;
  /** Claude Code-brevlådan – en utvecklarväg, av i drift. */
  utvecklarläge: boolean;
  version: string;
}

const på = (v: string | undefined) => /^(1|true|ja|on)$/i.test(v?.trim() ?? "");

/** Versionen: byggets tagg (`ARK_VERSION`, sätts av avbilden) eller package.json. */
export function version(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const tagg = env.ARK_VERSION?.trim().replace(/^v/, "");
  if (tagg) return tagg;
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

export function installningarUrMiljö(root: string, env: NodeJS.ProcessEnv = process.env): Installningar {
  const katalog = (v: string | undefined, standard: string) => path.resolve(root, v?.trim() || standard);
  return {
    root,
    port: Number(env.PORT?.trim() || 5173),
    flowsDir: katalog(env.FLOWS_DIR, "flows"),
    ramarDir: katalog(env.RAMAR_DIR, "ramar"),
    stilarDir: katalog(env.STILAR_DIR, "stilar"),
    arkDir: katalog(env.ARK_DIR, ".ark"),
    kontonFil: katalog(env.ARK_KONTON, "konton.json"),
    distDir: katalog(env.ARK_DIST_DIR, "dist"),
    utvecklarläge: på(env.ARK_UTVECKLARLAGE),
    version: version(root, env),
  };
}

export interface Kontroll {
  fel: string[];
  varningar: string[];
}

/** Det som saknas eller är farligt i miljön. Inga värden skrivs ut, bara namnen. */
export function kontrollera(
  env: NodeJS.ProcessEnv = process.env,
  /** Det portalen sagt om installationen (server/installation.ts) – `portal_url` ersätter EA_WEBB_URL. */
  portalen: { portalUrl?: string | null } = {},
): Kontroll {
  const fel: string[] = [];
  const varningar: string[] = [];
  const auth = authKonfigUrMiljö(env);
  const begärt = env.ARK_AUTH?.trim().toLowerCase() ?? "";
  // Ett felstavat värde får inte tyst bli öppen drift.
  if (begärt && !(AUTH_LÄGEN as readonly string[]).includes(begärt))
    fel.push(`ARK_AUTH=${begärt} är inget giltigt värde (${AUTH_LÄGEN.join(", ")}).`);
  const tillåtÖppen = på(env.ARK_TILLAT_OPPEN);

  if (auth.läge === "entra" || auth.läge === "lokal") {
    if (auth.läge === "entra") {
      const saknas = saknasFörEntra(auth);
      if (saknas.length) fel.push(`Inloggningen (Entra ID) saknar ${saknas.join(", ")}.`);
    } else if (!basUrlUrMiljö(env) && iProduktion(env)) {
      // REGRESSION: utan ARK_BAS_URL var det bara en varning, och kakan
      // kunde sakna Secure. I drift ska adressen stå där.
      fel.push("ARK_BAS_URL saknas – lokala konton i drift kräver appens https-adress (t.ex. https://arkitekten.example.org).");
    } else if (!auth.basUrl.startsWith("https:")) {
      varningar.push("Lokala konton utan https (ARK_BAS_URL) – lösenorden går okrypterade över nätet.");
    }
    if (!env.ARK_SESSION_SECRET?.trim()) fel.push("ARK_SESSION_SECRET saknas – den signerar sessionerna.");
    else if (env.ARK_SESSION_SECRET.trim().length < 32)
      fel.push("ARK_SESSION_SECRET är för kort – minst 32 tecken.");
    if (auth.läge === "lokal" && iProduktion(env) && !förstaKontoKod(env).kod)
      varningar.push("SETUP_CODE saknas – finns inga konton än kan det första inte skapas.");
  } else {
    const text =
      auth.läge === "dev"
        ? "Inloggning: PROVLÄGE (ARK_AUTH=dev) – vem som helst väljer namn och roll."
        : "Inloggning: ÖPPEN drift – alla som når appen är administratörer. Bara för utveckling.";
    // I drift startar appen inte så – utom när det är uttryckligen tillåtet
    // (t.ex. bakom ett eget skyddat nät): ARK_TILLAT_OPPEN=1.
    if (iProduktion(env) && !tillåtÖppen)
      fel.push(`${text} Sätt ARK_AUTH=auto (eller entra/lokal), eller ARK_TILLAT_OPPEN=1 om det verkligen är meningen.`);
    else varningar.push(text);
  }

  if (!env.ANTHROPIC_API_KEY?.trim() && !env.BERGET_API_KEY?.trim() && !på(env.ARK_UTVECKLARLAGE))
    varningar.push("AI-stödet är av (ingen ANTHROPIC_API_KEY eller BERGET_API_KEY).");
  if (bmtMallFil(env) && !läsBmtMall(env))
    varningar.push("ARK_BMT_MALL pekar inte på en läsbar modellexport (.bmt) – BMT-exporten är av.");
  if (env.ARK_FLODESTJANST_PORT?.trim() && !env.ARK_FLODESTJANST_NYCKEL?.trim())
    varningar.push("ARK_FLODESTJANST_NYCKEL saknas – flödestjänsten svarar vem som helst som når den.");
  // Portalen säger själv sin adress (portal_url) – då behövs inte EA_WEBB_URL.
  if (env.EA_API_KEY?.trim() && !env.EA_WEBB_URL?.trim() && !portalen.portalUrl)
    varningar.push(
      "EA_WEBB_URL saknas och portalen har inte uppgett sin adress än – publiceringsrutan länkar till portalen först när den gjort det.",
    );
  return { fel, varningar };
}
