/**
 * Installationen som portalen känner den: anmälan av adressen, Entra ur
 * portalen när ARK_AUTH=auto och miljön saknar uppgifterna, cachefilen som
 * reserv och portalens webbadress i `/__ark/ea/status`.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { authKonfigUrMiljö } from "./auth";
import { barnetsMiljö } from "./flodestjanst-barn";
import {
  anmälIBakgrunden,
  cacheFil,
  förberedInstallation,
  läsCache,
  skapaPortalWebb,
  sparaCache,
  tolkaSvar,
  type Installationssvar,
} from "./installation";
import { kontrollera } from "./installningar";

const rot = fs.mkdtempSync(path.join(os.tmpdir(), "installation-"));
afterAll(() => fs.rmSync(rot, { recursive: true, force: true }));
let n = 0;
const nyKatalog = () => path.join(rot, `ark-${++n}`);

const ENTRA = {
  tenant_id: "tenant-1",
  client_id: "klient-1",
  api_scope: "api://klient-1/access_as_user",
  bootstrap_admin_emails: ["admin@example.org"],
  client_secret: "portalens-hemlighet",
};
const SVAR = { portal_url: "https://portal.example.org", arkitekten_url: null, entra: ENTRA };

interface Anrop {
  url: string;
  metod: string;
  kropp: unknown;
  nyckel: string | null;
}

/**
 * En falsk portal. `svar` är en funktion av försöksnumret: ett objekt blir
 * 200, ett tal blir den statusen, null betyder att portalen inte svarar alls.
 */
function portal(svar: (försök: number, metod: string) => object | number | null) {
  const anrop: Anrop[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const metod = init.method ?? "GET";
    const h = new Headers(init.headers);
    anrop.push({ url, metod, kropp: init.body ? JSON.parse(String(init.body)) : undefined, nyckel: h.get("x-api-key") });
    const s = svar(anrop.length, metod);
    if (s === null) throw new TypeError("fetch failed");
    if (typeof s === "number") return new Response("{}", { status: s });
    return new Response(JSON.stringify(s), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, anrop };
}

const tyst = () => {
  const rader: string[] = [];
  return { rader, logg: { info: (r: string) => rader.push(r), warn: (r: string) => rader.push(`VARNING ${r}`) } };
};

/** Klocka och sömn utan väntan: sömnen flyttar klockan. */
function klocka() {
  let t = 0;
  return { nu: () => t, sov: async (ms: number) => void (t += ms) };
}

const BAS = { EA_API_KEY: "ea-nyckel", EA_API_URL: "http://api:8000/api/v1", ARK_AUTH: "auto" };

describe("Entra ur portalen vid start", () => {
  it("miljön vinner: med egna Entra-uppgifter frågas portalen inte om dem", async () => {
    const { f, anrop } = portal(() => SVAR);
    const env: NodeJS.ProcessEnv = { ...BAS, ENTRA_TENANT_ID: "egen-t", ENTRA_CLIENT_ID: "egen-c", ENTRA_CLIENT_SECRET: "egen-s" };
    const r = await förberedInstallation({ env, arkDir: nyKatalog(), logg: tyst().logg, fetch: f, ...klocka() });
    expect(r.källa).toBe("miljön");
    expect(anrop.filter((a) => a.metod === "GET")).toHaveLength(0);
    expect(env.ENTRA_TENANT_ID).toBe("egen-t");
    expect(env.ENTRA_CLIENT_SECRET).toBe("egen-s");
  });

  it("miljön vinner fält för fält: bara det tomma fylls ur portalen", async () => {
    const { f } = portal(() => SVAR);
    const env: NodeJS.ProcessEnv = { ...BAS, ENTRA_TENANT_ID: "egen-t", ARK_ADMINS: "egen@example.org" };
    await förberedInstallation({ env, arkDir: nyKatalog(), logg: tyst().logg, fetch: f, ...klocka() });
    expect(env.ENTRA_TENANT_ID).toBe("egen-t");
    expect(env.ENTRA_CLIENT_ID).toBe("klient-1");
    expect(env.BOOTSTRAP_ADMIN_EMAILS).toBeUndefined();
  });

  it("utan ARK_AUTH=auto rörs inloggningen aldrig (befintliga installationer beter sig som förut)", async () => {
    const { f, anrop } = portal(() => SVAR);
    const env: NodeJS.ProcessEnv = { ...BAS, ARK_AUTH: "lokal" };
    await förberedInstallation({ env, arkDir: nyKatalog(), logg: tyst().logg, fetch: f, ...klocka() });
    expect(anrop.filter((a) => a.metod === "GET")).toHaveLength(0);
    expect(env.ENTRA_CLIENT_ID).toBeUndefined();
  });

  it("auto + Entra i portalen → entra-läge, med portalens administratörer", async () => {
    const { f, anrop } = portal(() => SVAR);
    const env: NodeJS.ProcessEnv = { ...BAS, ARK_BAS_URL: "https://ark.example.org" };
    const { rader, logg } = tyst();
    const arkDir = nyKatalog();
    const r = await förberedInstallation({ env, arkDir, logg, fetch: f, ...klocka() });
    expect(r).toEqual({ källa: "portalen", portalUrl: "https://portal.example.org" });
    const get = anrop.find((a) => a.metod === "GET")!;
    expect(get.url).toBe("http://api:8000/api/v1/installation");
    expect(get.nyckel).toBe("ea-nyckel");
    const auth = authKonfigUrMiljö(env);
    expect(auth.läge).toBe("entra");
    if (auth.läge === "entra") {
      expect(auth.tenantId).toBe("tenant-1");
      expect(auth.clientSecret).toBe("portalens-hemlighet");
      expect(auth.adminKonton).toEqual(["admin@example.org"]);
    }
    // Hemligheten står aldrig i loggen.
    expect(rader.join("\n")).not.toContain("portalens-hemlighet");
    // Svaret sparas med läge 0600.
    expect(fs.statSync(cacheFil(arkDir)).mode & 0o777).toBe(0o600);
    expect(läsCache(arkDir)?.entra?.client_secret).toBe("portalens-hemlighet");
  });

  it("flödestjänstens barnprocess får inte hemligheten som hämtats ur portalen", async () => {
    const { f } = portal(() => SVAR);
    const env: NodeJS.ProcessEnv = { ...BAS, PATH: "/usr/bin" };
    await förberedInstallation({ env, arkDir: nyKatalog(), logg: tyst().logg, fetch: f, ...klocka() });
    expect(env.ENTRA_CLIENT_SECRET).toBe("portalens-hemlighet");
    const barn = barnetsMiljö(env, 8200);
    expect(JSON.stringify(barn)).not.toContain("portalens-hemlighet");
    expect(barn.EA_API_KEY).toBeUndefined();
  });

  it("väntar med omförsök på en portal som startar senare", async () => {
    const { f, anrop } = portal((_i, metod) => (metod === "GET" && anrop.filter((a) => a.metod === "GET").length < 4 ? null : SVAR));
    const env: NodeJS.ProcessEnv = { ...BAS };
    const r = await förberedInstallation({ env, arkDir: nyKatalog(), logg: tyst().logg, fetch: f, ...klocka() });
    expect(r.källa).toBe("portalen");
    expect(anrop.filter((a) => a.metod === "GET")).toHaveLength(4);
    expect(authKonfigUrMiljö(env).läge).toBe("entra");
  });

  it("portalen nere men ett sparat svar finns → entra ur filen", async () => {
    const arkDir = nyKatalog();
    sparaCache(arkDir, tolkaSvar(SVAR));
    const { f, anrop } = portal(() => null);
    const env: NodeJS.ProcessEnv = { ...BAS };
    const { rader, logg } = tyst();
    const k = klocka();
    const r = await förberedInstallation({ env, arkDir, logg, fetch: f, ...k });
    expect(r.källa).toBe("filen");
    expect(authKonfigUrMiljö(env).läge).toBe("entra");
    // Väntade hela tiden (två minuter) innan filen användes.
    expect(k.nu()).toBe(2 * 60 * 1000);
    expect(anrop.filter((a) => a.metod === "GET").length).toBeGreaterThan(10);
    expect(rader.join("\n")).toContain("senast sparade");
  });

  it("portalen nere och ingen fil → egna konton, med varning", async () => {
    const { f } = portal(() => null);
    const env: NodeJS.ProcessEnv = { ...BAS };
    const { rader, logg } = tyst();
    const r = await förberedInstallation({ env, arkDir: nyKatalog(), logg, fetch: f, ...klocka() });
    expect(r.källa).toBe("ingen");
    expect(authKonfigUrMiljö(env).läge).toBe("lokal");
    expect(rader.some((x) => x.startsWith("VARNING") && x.includes("egna konton"))).toBe(true);
  });

  it("fel nyckel eller en äldre portal utan vägen väntar inte i två minuter", async () => {
    for (const status of [401, 404]) {
      const { f, anrop } = portal(() => status);
      const k = klocka();
      const env: NodeJS.ProcessEnv = { ...BAS };
      await förberedInstallation({ env, arkDir: nyKatalog(), logg: tyst().logg, fetch: f, ...k });
      expect(k.nu()).toBe(0);
      expect(anrop.filter((a) => a.metod === "GET")).toHaveLength(1);
      expect(authKonfigUrMiljö(env).läge).toBe("lokal");
    }
  });

  it("entra=null i portalens svar → egna konton, också när en äldre fil hade Entra", async () => {
    const arkDir = nyKatalog();
    sparaCache(arkDir, tolkaSvar(SVAR));
    const { f } = portal(() => ({ portal_url: null, arkitekten_url: null, entra: null }));
    const env: NodeJS.ProcessEnv = { ...BAS };
    await förberedInstallation({ env, arkDir, logg: tyst().logg, fetch: f, ...klocka() });
    expect(authKonfigUrMiljö(env).läge).toBe("lokal");
    expect(env.ENTRA_TENANT_ID).toBeUndefined();
    // Det nya svaret ersätter filen – nästa start utan portal blir också egna konton.
    expect(läsCache(arkDir)?.entra).toBeNull();
  });

  it("Entra i portalen utan klienthemlighet → egna konton, inte en trasig Entra-inloggning", async () => {
    const { client_secret: _, ...utan } = ENTRA;
    const { f } = portal(() => ({ ...SVAR, entra: utan }));
    const env: NodeJS.ProcessEnv = { ...BAS };
    const { rader, logg } = tyst();
    await förberedInstallation({ env, arkDir: nyKatalog(), logg, fetch: f, ...klocka() });
    expect(authKonfigUrMiljö(env).läge).toBe("lokal");
    expect(rader.join("\n")).toContain("ENTRA_CLIENT_SECRET");
  });

  it("utan portalkoppling (EA_API_KEY) görs inget alls", async () => {
    const { f, anrop } = portal(() => SVAR);
    const env: NodeJS.ProcessEnv = { ARK_AUTH: "auto", ARK_BAS_URL: "https://ark.example.org" };
    expect(await förberedInstallation({ env, arkDir: nyKatalog(), logg: tyst().logg, fetch: f })).toEqual({
      källa: "ingen",
      portalUrl: null,
    });
    expect(anrop).toHaveLength(0);
  });
});

describe("anmälan av adressen", () => {
  it("skickar basadressen med PUT till /installation/arkitekten", async () => {
    const { f, anrop } = portal(() => SVAR);
    const ok = await anmälIBakgrunden({
      env: { ...BAS, ARK_BAS_URL: "https://ark.example.org/" },
      arkDir: nyKatalog(),
      logg: tyst().logg,
      fetch: f,
    });
    expect(ok).toBe(true);
    expect(anrop).toEqual([
      { url: "http://api:8000/api/v1/installation/arkitekten", metod: "PUT", kropp: { url: "https://ark.example.org" }, nyckel: "ea-nyckel" },
    ]);
  });

  it("tar Renders adress när ARK_BAS_URL saknas", async () => {
    const { f, anrop } = portal(() => SVAR);
    await anmälIBakgrunden({
      env: { ...BAS, RENDER_EXTERNAL_URL: "https://ark.onrender.com" },
      arkDir: nyKatalog(),
      logg: tyst().logg,
      fetch: f,
    });
    expect(anrop[0].kropp).toEqual({ url: "https://ark.onrender.com" });
  });

  it("hoppar över en tom basadress", async () => {
    const { f, anrop } = portal(() => SVAR);
    expect(await anmälIBakgrunden({ env: { ...BAS, ARK_BAS_URL: " " }, arkDir: nyKatalog(), logg: tyst().logg, fetch: f })).toBe(false);
    expect(anrop).toHaveLength(0);
  });

  it("försöker igen när portalen inte svarar, med växande väntan", async () => {
    const { f, anrop } = portal((i) => (i < 3 ? null : SVAR));
    const väntan: number[] = [];
    const ok = await anmälIBakgrunden({
      env: { ...BAS, ARK_BAS_URL: "https://ark.example.org" },
      arkDir: nyKatalog(),
      logg: tyst().logg,
      fetch: f,
      schemalägg: (fn, ms) => {
        väntan.push(ms);
        fn();
      },
    });
    expect(ok).toBe(true);
    expect(anrop).toHaveLength(3);
    expect(väntan[1]).toBeGreaterThan(väntan[0]);
  });

  it("ger upp direkt mot en äldre portal som saknar vägen", async () => {
    const { f, anrop } = portal(() => 404);
    const ok = await anmälIBakgrunden({
      env: { ...BAS, ARK_BAS_URL: "https://ark.example.org" },
      arkDir: nyKatalog(),
      logg: tyst().logg,
      fetch: f,
      schemalägg: () => {
        throw new Error("ska inte försöka igen");
      },
    });
    expect(ok).toBe(false);
    expect(anrop).toHaveLength(1);
  });
});

describe("portalens webbadress", () => {
  const k = (f: typeof fetch) => ({ url: "http://api:8000/api/v1", nyckel: "ea-nyckel", fetch: f });

  it("EA_WEBB_URL vinner, och portalen frågas inte", async () => {
    const { f, anrop } = portal(() => SVAR);
    const w = skapaPortalWebb({ EA_WEBB_URL: "https://egen.example.org/" }, k(f), nyKatalog());
    expect(await w.webb()).toBe("https://egen.example.org");
    expect(anrop).toHaveLength(0);
  });

  it("REGRESSION: en läsning vid klockans nolla räknades som aldrig gjord och portalen frågades vid varje begäran – portal_url läses om högst var femte minut", async () => {
    let t = 0;
    const { f, anrop } = portal(() => SVAR);
    const w = skapaPortalWebb({}, k(f), nyKatalog(), () => t);
    expect(await w.webb()).toBe("https://portal.example.org");
    t += 60_000;
    expect(await w.webb()).toBe("https://portal.example.org");
    expect(anrop).toHaveLength(1);
    t += 5 * 60_000;
    await w.webb();
    expect(anrop).toHaveLength(2);
  });

  it("portalen nere: det sparade svarets portal_url, annars tomt – aldrig ett fel", async () => {
    const { f } = portal(() => null);
    const arkDir = nyKatalog();
    expect(await skapaPortalWebb({}, k(f), arkDir).webb()).toBe("");
    sparaCache(arkDir, tolkaSvar(SVAR));
    expect(await skapaPortalWebb({}, k(f), arkDir).webb()).toBe("https://portal.example.org");
  });

  it("utan portalkoppling är adressen EA_WEBB_URL eller tom", async () => {
    expect(await skapaPortalWebb({}, null, nyKatalog()).webb()).toBe("");
  });

  it("varningen om EA_WEBB_URL tiger när portalen uppgett sin adress", () => {
    const env = { EA_API_KEY: "x" };
    expect(kontrollera(env).varningar.join(" ")).toContain("EA_WEBB_URL");
    expect(kontrollera(env, { portalUrl: "https://portal.example.org" }).varningar.join(" ")).not.toContain("EA_WEBB_URL");
  });
});

describe("portalens svar tolkas försiktigt", () => {
  it("släpper adresser som inte är http(s) och Entra utan tenant eller klient", () => {
    const s: Installationssvar = tolkaSvar({
      portal_url: "javascript:alert(1)",
      arkitekten_url: "https://ark.example.org/",
      entra: { tenant_id: "", client_id: "c" },
    });
    expect(s).toEqual({ portal_url: null, arkitekten_url: "https://ark.example.org", entra: null });
    expect(tolkaSvar(null)).toEqual({ portal_url: null, arkitekten_url: null, entra: null });
  });
});
