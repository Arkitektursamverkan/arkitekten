/**
 * Bryggans säkerhetslöften, omgång 4 (granskningen 2026-11-10, de låga
 * fynden): historiken som bara byggs på, id:t i adressen, andras processer
 * som inte syns, ramserier som följer sin process, underlagets referens,
 * lösenordsbytets spärr, sessionsversionen, den tysta /health och att
 * bryggans svar inte sparas.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { skapaBrygga, type AiModuler } from "./brygga";
import { skapaServer } from "./arkitekten.mjs";
import { installningarUrMiljö } from "./installningar";
import { SESSION_KAKA, SESSION_SEKUNDER, användareUrIdToken, authKonfigUrMiljö, kaka, skapaSession, ärGäst, type EntraKonfig } from "./auth";
import { Kontolager } from "./konton";

const MILJÖ = { ...process.env };
const HEMLIGHET = "y".repeat(40);
let server: http.Server;
let bas: string;
let tmp: string;

/** En webbläsare i miniatyr: minns sessionskakan mellan anropen. */
function klient(start = "") {
  let kakan = start;
  const anrop = async (väg: string, init: RequestInit = {}) => {
    const res = await fetch(`${bas}${väg}`, {
      ...init,
      headers: { "content-type": "application/json", ...(kakan ? { cookie: kakan } : {}), ...(init.headers ?? {}) },
    });
    const satt = res.headers.get("set-cookie");
    if (satt) kakan = satt.split(";")[0];
    const text = await res.text();
    let kropp: Record<string, any> = {};
    try {
      kropp = JSON.parse(text);
    } catch {
      /* tomt svar */
    }
    return { status: res.status, kropp, huvuden: res.headers };
  };
  return anrop;
}
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) });
const LÖSEN = "ett långt lösenord";

const låtsasAi: AiModuler = {
  anthropicFråga: (() => async () => ({ text: "" })) as unknown as AiModuler["anthropicFråga"],
  DEFAULT_MODEL: "låtsas",
  besvara: (async () => ({ aiText: "svar" })) as unknown as AiModuler["besvara"],
};

const admin = klient();
const anna = klient();
const bo = klient();

/** Ett minimalt flöde med en version. */
function flödet(id: string, extra: Record<string, unknown> = {}) {
  const t = "2026-11-01T00:00:00.000Z";
  return {
    id,
    name: id,
    savedAt: t,
    rawText: "A → B",
    draft: { steps: [] },
    versions: [{ id: "v1", savedAt: t, status: "utkast", rawText: "A → B", draft: { steps: [] } }],
    ...extra,
  };
}
const läsFil = (id: string) => JSON.parse(fs.readFileSync(path.join(tmp, "flows", `${id}.json`), "utf8"));

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sakerhet4-"));
  fs.mkdirSync(path.join(tmp, "dist"));
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<!doctype html>");
  process.env.ARK_AUTH = "lokal";
  process.env.ARK_SESSION_SECRET = HEMLIGHET;
  process.env.ANTHROPIC_API_KEY = "låtsasnyckel";
  for (const k of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ARK_BAS_URL", "SETUP_CODE", "ARK_UTVECKLARLAGE", "ARK_BETRODD_PROXY", "ARK_DIR"])
    delete process.env[k];
  const inst = installningarUrMiljö(tmp, {});
  server = skapaServer(inst, skapaBrygga({ ...inst, logg: { info: () => {}, warn: () => {} }, laddaAi: async () => låtsasAi }));
  await new Promise<void>((klar) => server.listen(0, klar));
  bas = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await admin("/__ark/auth/forsta", post({ användarnamn: "admin@example.org", namn: "Admin", lösenord: LÖSEN }));
  for (const [namn, k] of [["anna", anna], ["bo", bo]] as const) {
    await admin("/__ark/konton", post({ användarnamn: `${namn}@example.org`, namn, roll: "user", lösenord: LÖSEN }));
    expect((await k("/__ark/auth/lokal", post({ användarnamn: `${namn}@example.org`, lösenord: LÖSEN }))).status).toBe(200);
  }
  // Annas egen process, och en i Demo.
  expect((await anna("/__ark/flows/annas", put(flödet("annas")))).status).toBe(200);
  expect((await anna("/__ark/flows/demo-1", put(flödet("demo-1", { category: "Demo" })))).status).toBe(200);
});

afterAll(async () => {
  await new Promise<void>((klar) => server.close(() => klar()));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env = { ...MILJÖ };
});

describe("flödenas integritet", () => {
  it("REGRESSION: en äldre version i Demo kunde skrivas om så länge den sista stod kvar – nu 403 och filen orörd", async () => {
    const fil = läsFil("demo-1");
    const v2 = { id: "v2", savedAt: "2026-11-02T00:00:00.000Z", status: "utkast", rawText: "B", draft: { steps: [] } };
    expect((await bo("/__ark/flows/demo-1", put({ ...fil, versions: [...fil.versions, v2] }))).status).toBe(200);
    const nu = läsFil("demo-1");
    const omskriven = [{ ...nu.versions[0], rawText: "FÖRFALSKAD" }, nu.versions[1]];
    expect((await bo("/__ark/flows/demo-1", put({ ...nu, versions: omskriven }))).status).toBe(403);
    expect((await bo("/__ark/flows/demo-1", put({ ...nu, versions: "ingen lista" }))).status).toBe(400);
    expect(läsFil("demo-1").versions).toEqual(nu.versions);
  });

  it("REGRESSION: en ny versions signatur kom ur begäran – nu den inloggades", async () => {
    const fil = läsFil("demo-1");
    const ny = { id: "v3", savedAt: "2026-11-03T00:00:00.000Z", status: "utkast", rawText: "C", draft: { steps: [] }, savedBy: "Admin" };
    expect((await bo("/__ark/flows/demo-1", put({ ...fil, versions: [...fil.versions, ny] }))).status).toBe(200);
    expect(läsFil("demo-1").versions.at(-1).savedBy).toBe("bo");
  });

  it("REGRESSION: id:t i kroppen kunde skilja sig från adressens – nu 400", async () => {
    expect((await bo("/__ark/flows/bos", put(flödet("annat-id")))).status).toBe(400);
    expect(fs.existsSync(path.join(tmp, "flows", "bos.json"))).toBe(false);
  });

  it("REGRESSION: en GET av någon annans egna process svarade 403 – nu 404, som en process som inte finns", async () => {
    const r = await bo("/__ark/flows/annas");
    expect(r.status).toBe(404);
    expect(r.kropp.error).toBe((await bo("/__ark/flows/finns-inte")).kropp.error);
    // Ägaren och administratören ser den.
    expect((await anna("/__ark/flows/annas")).status).toBe(200);
    expect((await admin("/__ark/flows/annas")).status).toBe(200);
  });

  it("en sparning på ett upptaget id får veta det (appen tar då nästa lediga) – filen rörs inte", async () => {
    const r = await bo("/__ark/flows/annas", put(flödet("annas")));
    expect(r.status).toBe(403);
    expect(r.kropp.kod).toBe("upptaget");
    expect(läsFil("annas").ägare.namn).toBe("anna");
  });
});

describe("ramserierna följer sin process", () => {
  const serie = (id: string, flödeId: string) => ({ id, namn: id, flödeId, savedAt: "2026-11-01T00:00:00.000Z", ramar: [] });

  beforeAll(async () => {
    expect((await anna("/__ark/ramar/annas-serie", put(serie("annas-serie", "annas")))).status).toBe(200);
    expect((await anna("/__ark/ramar/demo-serie", put(serie("demo-serie", "demo-1")))).status).toBe(200);
  });

  it("REGRESSION: alla inloggade listade och läste serier över processer de inte fick öppna", async () => {
    const lista = (await bo("/__ark/ramar")).kropp.ramar.map((r: { id: string }) => r.id);
    expect(lista).toContain("demo-serie");
    expect(lista).not.toContain("annas-serie");
    expect((await bo("/__ark/ramar/annas-serie")).status).toBe(404);
    expect((await bo("/__ark/ramar/demo-serie")).status).toBe(200);
    // Ägaren och administratören ser den.
    expect((await anna("/__ark/ramar/annas-serie")).status).toBe(200);
    expect((await admin("/__ark/ramar")).kropp.ramar.map((r: { id: string }) => r.id)).toContain("annas-serie");
  });

  it("en serie kan inte hängas på, ändras eller tas bort över en process man inte ser", async () => {
    expect((await bo("/__ark/ramar/bos-serie", put(serie("bos-serie", "annas")))).status).toBe(404);
    expect((await bo("/__ark/ramar/annas-serie", put(serie("annas-serie", "demo-1")))).status).toBe(404);
    expect((await bo("/__ark/ramar/annas-serie", { method: "DELETE" })).status).toBe(404);
    expect(fs.existsSync(path.join(tmp, "ramar", "annas-serie.json"))).toBe(true);
  });

  it("REGRESSION: seriens id kunde skilja sig från adressens – nu 400", async () => {
    expect((await bo("/__ark/ramar/bos-serie", put(serie("annat", "demo-1")))).status).toBe(400);
  });
});

describe("underlaget", () => {
  it("REGRESSION: svaret bar serverns absoluta sökväg – nu en referens relativ till brevlådan", async () => {
    const upp = await anna("/__ark/underlag?namn=a.txt", { method: "POST", body: "x", headers: { "content-type": "application/octet-stream", origin: bas } });
    expect(upp.status).toBe(200);
    const ref = upp.kropp.sökväg as string;
    expect(path.isAbsolute(ref)).toBe(false);
    expect(ref).toMatch(/^underlag\/[^/]+a\.txt$/);
    expect(ref).not.toContain(tmp);
  });
});

describe("lösenordsbytet", () => {
  it("REGRESSION: fel nuvarande lösenord kunde gissas utan gräns – nu samma spärr som inloggningen", async () => {
    await admin("/__ark/konton", post({ användarnamn: "dan@example.org", namn: "Dan", roll: "user", lösenord: LÖSEN }));
    const dan = klient();
    await dan("/__ark/auth/lokal", post({ användarnamn: "dan@example.org", lösenord: LÖSEN }));
    for (let i = 0; i < 5; i++)
      expect((await dan("/__ark/auth/losenord", post({ nuvarande: `gissning ${i}`, nytt: "ett annat långt lösenord" }))).status).toBe(401);
    expect((await dan("/__ark/auth/losenord", post({ nuvarande: LÖSEN, nytt: "ett annat långt lösenord" }))).status).toBe(429);
    // Spärren är densamma som inloggningens: namnet + adressen.
    expect((await klient()("/__ark/auth/lokal", post({ användarnamn: "dan@example.org", lösenord: LÖSEN }))).status).toBe(429);
  });
});

describe("sessionsversionen", () => {
  it("REGRESSION: en kaka gällde tills den gick ut, också efter ett lösenordsbyte – nu loggas andra sessioner ut", async () => {
    await admin("/__ark/konton", post({ användarnamn: "eva@example.org", namn: "Eva", roll: "user", lösenord: LÖSEN }));
    const här = klient();
    const där = klient();
    await här("/__ark/auth/lokal", post({ användarnamn: "eva@example.org", lösenord: LÖSEN }));
    await där("/__ark/auth/lokal", post({ användarnamn: "eva@example.org", lösenord: LÖSEN }));
    expect((await här("/__ark/auth/losenord", post({ nuvarande: LÖSEN, nytt: "evas nya lösenord" }))).status).toBe(200);
    expect((await här("/__ark/auth/me")).kropp.användare?.namn).toBe("Eva");
    expect((await där("/__ark/auth/me")).kropp.användare).toBeNull();
    expect((await där("/__ark/flows")).status).toBe(401);
  });

  it("administratörens lösenordsbyte loggar ut kontots sessioner", async () => {
    const eva = klient();
    await eva("/__ark/auth/lokal", post({ användarnamn: "eva@example.org", lösenord: "evas nya lösenord" }));
    const id = (await admin("/__ark/konton")).kropp.konton.find((k: { användarnamn: string }) => k.användarnamn === "eva@example.org").id;
    expect((await admin(`/__ark/konton/${id}`, put({ lösenord: "ett tredje långt lösenord" }))).status).toBe(200);
    expect((await eva("/__ark/auth/me")).kropp.användare).toBeNull();
    // Administratören själv är kvar.
    expect((await admin("/__ark/auth/me")).kropp.användare?.namn).toBe("Admin");
  });

  it("logga ut överallt: alla kontots kakor slutar gälla", async () => {
    const ett = klient();
    const två = klient();
    await ett("/__ark/auth/lokal", post({ användarnamn: "eva@example.org", lösenord: "ett tredje långt lösenord" }));
    await två("/__ark/auth/lokal", post({ användarnamn: "eva@example.org", lösenord: "ett tredje långt lösenord" }));
    expect((await ett("/__ark/auth/logout", post({ överallt: true }))).status).toBe(200);
    expect((await två("/__ark/auth/me")).kropp.användare).toBeNull();
    // En vanlig utloggning rör inte de andra.
    const tre = klient();
    const fyra = klient();
    await tre("/__ark/auth/lokal", post({ användarnamn: "eva@example.org", lösenord: "ett tredje långt lösenord" }));
    await fyra("/__ark/auth/lokal", post({ användarnamn: "eva@example.org", lösenord: "ett tredje långt lösenord" }));
    await tre("/__ark/auth/logout", post({}));
    expect((await fyra("/__ark/auth/me")).kropp.användare?.namn).toBe("Eva");
  });

  it("en kaka från före fältet (utan sessionsversion) gäller så länge kontot står på version 0", async () => {
    const k = new Kontolager(path.join(tmp, "konton.json")).alla().find((x) => x.användarnamn === "bo@example.org")!;
    expect(k.tokenVersion ?? 0).toBe(0);
    const gammal = klient(`${SESSION_KAKA}=${encodeURIComponent(skapaSession({ id: k.id, namn: k.namn, roller: k.roller }, HEMLIGHET))}`);
    expect((await gammal("/__ark/auth/me")).kropp.användare?.namn).toBe("bo");
    // Och kontofilen lämnar aldrig ut sessionsversionen.
    expect(JSON.stringify((await admin("/__ark/konton")).kropp)).not.toContain("tokenVersion");
  });
});

describe("hälsan och bryggans huvuden", () => {
  it("REGRESSION: /health visade version och AI-läge utan inloggning – nu bara status", async () => {
    expect(await (await fetch(`${bas}/health`)).json()).toEqual({ status: "ok" });
    // Den inloggade ser dem i /__ark/status.
    const status = (await anna("/__ark/status")).kropp;
    expect(status.version).toBeTruthy();
    expect(status.besvaras).toBe("api");
    expect((await klient()("/__ark/status")).status).toBe(401);
  });

  it("REGRESSION: bryggans svar med användardata kunde sparas av webbläsaren – nu no-store och nosniff", async () => {
    for (const väg of ["/__ark/flows", "/__ark/flows/annas", "/__ark/ramar", "/__ark/auth/me", "/__ark/status"]) {
      const r = await anna(väg);
      expect(r.huvuden.get("cache-control")).toBe("no-store");
      expect(r.huvuden.get("x-content-type-options")).toBe("nosniff");
    }
  });
});

describe("Entra", () => {
  const k: EntraKonfig = {
    läge: "entra",
    tenantId: "tenant-1",
    clientId: "klient",
    clientSecret: "hemlig",
    basUrl: "https://ark.example.org",
    adminRoller: [],
    adminGrupper: [],
    adminKonton: ["00000000-0000-0000-0000-00000000000a"],
  };
  const nu = 1_800_000_000_000;
  const claims = (extra: Record<string, unknown> = {}) => ({
    iss: "https://login.microsoftonline.com/tenant-1/v2.0",
    aud: "klient",
    exp: nu / 1000 + 600,
    nonce: "n",
    tid: "tenant-1",
    oid: "00000000-0000-0000-0000-00000000000a",
    name: "Admin",
    preferred_username: "admin@example.org",
    ...extra,
  });

  it("ARK_ADMINS matchar objekt-id (oid) – det rekommenderade – och e-post som förut", () => {
    expect(användareUrIdToken(k, claims(), "n", nu).roller).toContain("admin");
    const medEpost = { ...k, adminKonton: ["admin@example.org"] };
    expect(användareUrIdToken(medEpost, claims({ oid: "annat" }), "n", nu).roller).toContain("admin");
    expect(användareUrIdToken(k, claims({ oid: "annat" }), "n", nu).roller).toEqual(["user"]);
  });

  it("REGRESSION: en B2B-gäst loggades in som vilken användare som helst – nu avvisas den", () => {
    const gäster = [
      { idp: "https://sts.windows.net/annan-tenant/" },
      { idp: "live.com" },
      { acct: 1 },
      { tid: "annan-tenant" },
      { preferred_username: "gast_example.com#EXT#@tenant.onmicrosoft.com" },
    ];
    for (const g of gäster) {
      expect(ärGäst(k, claims(g))).toBe(true);
      expect(() => användareUrIdToken(k, claims(g), "n", nu)).toThrow(/Gästkonton/);
    }
    // En medlem: idp saknas eller är tenantens egen.
    expect(ärGäst(k, claims())).toBe(false);
    expect(ärGäst(k, claims({ idp: "https://sts.windows.net/tenant-1/", acct: 0 }))).toBe(false);
    // Med ENTRA_TILLAT_GASTER=1 släpps de in.
    const tillåt = { ...k, tillåtGäster: true };
    expect(användareUrIdToken(tillåt, claims({ idp: "live.com" }), "n", nu).id).toBeTruthy();
    const env = { ENTRA_TENANT_ID: "t", ENTRA_CLIENT_ID: "c", ENTRA_CLIENT_SECRET: "s" };
    expect((authKonfigUrMiljö(env) as EntraKonfig).tillåtGäster).toBe(false);
    expect((authKonfigUrMiljö({ ...env, ENTRA_TILLAT_GASTER: "1" }) as EntraKonfig).tillåtGäster).toBe(true);
  });

  it("REGRESSION: sessionen gällde i tio timmar – nu åtta", () => {
    expect(SESSION_SEKUNDER).toBe(8 * 60 * 60);
    expect(kaka(SESSION_KAKA, "x", { maxÅlder: SESSION_SEKUNDER, säker: true })).toContain(`Max-Age=${8 * 60 * 60}`);
  });
});
