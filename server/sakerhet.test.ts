/**
 * Bryggans säkerhetslöften (granskningen 2026-11): kroppsgränsen, brevlådan
 * per användare, inloggningsspärren bakom en proxy, Secure-kakan,
 * ramseriernas skrivrätt, felbeskeden utåt och portalens läsning.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http, { type IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { klientadress, skapaBrygga, viaHttps, type AiModuler } from "./brygga";
import { skapaServer } from "./arkitekten.mjs";
import { installningarUrMiljö, kontrollera } from "./installningar";
import { Inloggningsspärr, spärrnycklar } from "./konton";
import { inloggningsfelKod, inloggningsfelText } from "../src/core/inloggningsfel";

const MILJÖ = { ...process.env };
let server: http.Server;
let bas: string;
let tmp: string;
let arkDir: string;

/** En webbläsare i miniatyr: minns sessionskakan mellan anropen. */
function klient(extra: Record<string, string> = {}) {
  let kaka = "";
  const anrop = async (väg: string, init: RequestInit = {}) => {
    const res = await fetch(`${bas}${väg}`, {
      ...init,
      headers: { "content-type": "application/json", ...extra, ...(kaka ? { cookie: kaka } : {}), ...(init.headers ?? {}) },
    });
    const satt = res.headers.get("set-cookie");
    if (satt) kaka = satt.split(";")[0];
    const text = await res.text();
    let kropp: Record<string, any> = {};
    try {
      kropp = JSON.parse(text);
    } catch {
      /* tomt svar */
    }
    return { status: res.status, kropp, text, kaka: satt ?? "" };
  };
  return anrop;
}
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

/** Låtsas-AI: svarar med begärans text och läser underlaget den pekar ut. */
const låtsasAi: AiModuler = {
  anthropicFråga: (() => async () => ({ text: "" })) as unknown as AiModuler["anthropicFråga"],
  DEFAULT_MODEL: "låtsas",
  besvara: (async (b: { rawText: string }, m: { läsUnderlag?: (s: string) => Promise<Uint8Array> }) => {
    if (b.rawText.startsWith("{")) {
      const fil = JSON.parse(b.rawText).fil as string;
      const data = await m.läsUnderlag!(fil);
      return { rutin: Buffer.from(data).toString("utf8") };
    }
    return { aiText: `svar på ${b.rawText}` };
  }) as unknown as AiModuler["besvara"],
};

const admin = klient();
const anna = klient();
const bo = klient();

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sakerhet-"));
  fs.mkdirSync(path.join(tmp, "dist"));
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<!doctype html>");
  // flows/ är en FIL – varje skrivning dit ger ett filsystemsfel med sökväg.
  fs.writeFileSync(path.join(tmp, "flows"), "inte en katalog");
  process.env.ARK_AUTH = "lokal";
  process.env.ARK_SESSION_SECRET = "x".repeat(40);
  process.env.ANTHROPIC_API_KEY = "låtsasnyckel";
  for (const k of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ARK_BAS_URL", "SETUP_CODE", "ARK_UTVECKLARLAGE", "ARK_BETRODD_PROXY"])
    delete process.env[k];
  const inst = installningarUrMiljö(tmp, {});
  arkDir = inst.arkDir;
  server = skapaServer(inst, skapaBrygga({ ...inst, logg: { info: () => {}, warn: () => {} }, laddaAi: async () => låtsasAi }));
  await new Promise<void>((klar) => server.listen(0, klar));
  bas = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  await admin("/__ark/auth/forsta", post({ användarnamn: "admin@example.org", namn: "Admin", lösenord: "ett långt lösenord" }));
  for (const [namn, k] of [["anna", anna], ["bo", bo]] as const) {
    await admin("/__ark/konton", post({ användarnamn: `${namn}@example.org`, namn, roll: "user", lösenord: "ett långt lösenord" }));
    expect((await k("/__ark/auth/lokal", post({ användarnamn: `${namn}@example.org`, lösenord: "ett långt lösenord" }))).status).toBe(200);
  }
});

afterAll(async () => {
  await new Promise<void>((klar) => server.close(() => klar()));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env = { ...MILJÖ };
});

/** En rå POST som skriver `bitar` à `storlek` byte – för kroppar fetch inte gör bra. */
function råPost(väg: string, huvuden: Record<string, string | number>, bitar: number, storlek: number) {
  return new Promise<{ status: number | null; skrivna: number }>((klar) => {
    const u = new URL(`${bas}${väg}`);
    let skrivna = 0;
    let status: number | null = null;
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: huvuden }, (res) => {
      status = res.statusCode ?? null;
      res.resume();
      res.on("end", () => klar({ status, skrivna }));
    });
    req.on("error", () => klar({ status, skrivna }));
    const bit = Buffer.alloc(storlek, 0x61);
    const skriv = () => {
      while (skrivna < bitar) {
        skrivna++;
        if (!req.write(bit)) {
          req.once("drain", skriv);
          return;
        }
      }
      req.end();
    };
    skriv();
  });
}

describe("kroppsgränsen", () => {
  it("REGRESSION: en för stor content-length till /auth/* (före inloggningen) avvisas med 413 innan något läses", async () => {
    const r = await råPost("/__ark/auth/lokal", { "content-type": "application/json", "content-length": 50_000_000 }, 1, 1000);
    expect(r.status).toBe(413);
  });

  it("REGRESSION: en kropp utan längd som växer förbi gränsen slutar läsas – servern lever vidare", async () => {
    const r = await råPost("/__ark/auth/lokal", { "content-type": "application/json", "transfer-encoding": "chunked" }, 2000, 64 * 1024);
    // Svaret är 413, eller att anslutningen stängdes mitt i – aldrig att allt lästes.
    if (r.status !== null) expect(r.status).toBe(413);
    expect(r.skrivna).toBeLessThan(2000);
    expect((await fetch(`${bas}/__ark/auth/me`)).status).toBe(200);
  });
});

describe("AI-brevlådan per användare", () => {
  const vänta = async (k: ReturnType<typeof klient>) => {
    for (let i = 0; i < 50; i++) {
      const r = await k("/__ark/response");
      if (r.status === 200) return r.kropp.response;
      await new Promise((v) => setTimeout(v, 20));
    }
    throw new Error("inget svar");
  };

  it("REGRESSION: en annan inloggad kunde hämta ens svar och avbryta ens begäran – nu har var och en sin brevlåda", async () => {
    const begäran = await anna("/__ark/request", post({ rawText: "annas hemliga process", uppdrag: "utvärdering" }));
    expect(begäran.status).toBe(200);
    // Bo ser inget svar och kan inte avbryta Annas begäran.
    expect((await bo("/__ark/cancel", post({}))).status).toBe(200);
    expect((await bo("/__ark/response")).status).toBe(204);
    const svar = await vänta(anna);
    expect(svar.aiText).toBe("svar på annas hemliga process");
    expect(svar.requestId).toBe(begäran.kropp.id);
    // Brevlådan ligger i en katalog per användare – inte i arkDir självt.
    expect(fs.existsSync(path.join(arkDir, "request.json"))).toBe(false);
  });

  it("REGRESSION: underlagen låg kvar för alltid och kunde läsas genom en annans begäran", async () => {
    const upp = await anna("/__ark/underlag?namn=rutin.txt", { method: "POST", body: "Annas rutin", headers: { "content-type": "application/octet-stream", origin: bas } });
    expect(upp.status).toBe(200);
    const sökväg = upp.kropp.sökväg as string;
    const fil = path.isAbsolute(sökväg) ? sökväg : path.join(tmp, sökväg);
    expect(fs.existsSync(fil)).toBe(true);
    expect(fil).toContain(`${path.sep}anvandare${path.sep}`);

    // Bo pekar ut Annas underlag – det ligger utanför hans brevlåda.
    await bo("/__ark/request", post({ rawText: JSON.stringify({ fil: sökväg }), uppdrag: "rutin" }));
    expect((await vänta(bo)).fel).toMatch(/utanför brevlådan/);

    // Annas egen begäran läser det, och när svaret är hämtat är det borta.
    await anna("/__ark/request", post({ rawText: JSON.stringify({ fil: sökväg }), uppdrag: "rutin" }));
    expect((await vänta(anna)).rutin).toBe("Annas rutin");
    expect(fs.existsSync(fil)).toBe(false);
  });

  it("underlag äldre än ett dygn gallras vid nästa uppladdning, i alla brevlådor", async () => {
    const upp = await anna("/__ark/underlag?namn=gammal.txt", { method: "POST", body: "gammalt", headers: { "content-type": "application/octet-stream", origin: bas } });
    const sökväg = upp.kropp.sökväg as string;
    const fil = path.isAbsolute(sökväg) ? sökväg : path.join(tmp, sökväg);
    const förr = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(fil, förr, förr);
    await bo("/__ark/underlag?namn=ny.txt", { method: "POST", body: "nytt", headers: { "content-type": "application/octet-stream", origin: bas } });
    expect(fs.existsSync(fil)).toBe(false);
  });

  it("utvecklarläget har EN brevlåda direkt i arkDir – den Claude Code läser", async () => {
    const dev = fs.mkdtempSync(path.join(os.tmpdir(), "sakerhet-dev-"));
    const inst = installningarUrMiljö(dev, {});
    const s = skapaServer(
      { ...inst, utvecklarläge: true },
      skapaBrygga({ ...inst, utvecklarläge: true, logg: { info: () => {}, warn: () => {} }, laddaAi: async () => låtsasAi }),
    );
    await new Promise<void>((klar) => s.listen(0, klar));
    try {
      const port = (s.address() as { port: number }).port;
      // En egen installation (egen kontofil): första kontot.
      let kaka = "";
      const r1 = await fetch(`http://127.0.0.1:${port}/__ark/auth/forsta`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ användarnamn: "dev@example.org", namn: "Dev", lösenord: "ett långt lösenord" }),
      });
      kaka = (r1.headers.get("set-cookie") ?? "").split(";")[0];
      const r = await fetch(`http://127.0.0.1:${port}/__ark/request`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: kaka },
        body: JSON.stringify({ rawText: "x", via: "claude-code" }),
      });
      expect(r.status).toBe(200);
      expect(fs.existsSync(path.join(inst.arkDir, "request.json"))).toBe(true);
    } finally {
      await new Promise<void>((klar) => s.close(() => klar()));
      fs.rmSync(dev, { recursive: true, force: true });
    }
  });
});

describe("inloggningsspärren", () => {
  it("REGRESSION: fem fel på administratörens namn låste ute administratören överallt – nu bara den adressen", () => {
    const spärr = new Inloggningsspärr();
    const gissare = spärrnycklar("admin@example.org", "203.0.113.9");
    for (let i = 0; i < 5; i++) spärr.misslyckat(gissare);
    expect(spärr.spärradTill(gissare)).toBeGreaterThan(0);
    expect(spärr.spärradTill(spärrnycklar("admin@example.org", "198.51.100.1"))).toBe(0);
  });

  it("namnet ensamt har ett lösare tak, mot den som byter adress", () => {
    const spärr = new Inloggningsspärr();
    for (let i = 0; i < 50; i++) spärr.misslyckat(spärrnycklar("anna", `10.0.0.${i}`));
    expect(spärr.spärradTill(spärrnycklar("anna", "10.0.1.1"))).toBeGreaterThan(0);
  });

  it("REGRESSION: bakom en proxy var alla samma adress – med ARK_BETRODD_PROXY är klienten ledet proxyn lade till", () => {
    // Proxyn lägger klientens adress SIST (sakerhet-3.test.ts: det första ledet kan klienten ha skrivit själv).
    const req = { headers: { "x-forwarded-for": "198.51.100.7, 203.0.113.9" }, socket: { remoteAddress: "10.0.0.1" } } as unknown as IncomingMessage;
    expect(klientadress(req, true)).toBe("203.0.113.9");
    expect(klientadress(req, false)).toBe("10.0.0.1");
  });

  it("inloggningen går genom bryggan med den asynkrona prövningen, också efter några fel", async () => {
    const k = klient();
    for (let i = 0; i < 3; i++)
      expect((await k("/__ark/auth/lokal", post({ användarnamn: "bo@example.org", lösenord: `fel ${i} fel fel` }))).status).toBe(401);
    expect((await k("/__ark/auth/lokal", post({ användarnamn: "bo@example.org", lösenord: "ett långt lösenord" }))).status).toBe(200);
  });
});

describe("sessionskakan", () => {
  it("REGRESSION: utan ARK_BAS_URL saknade kakan Secure även bakom en https-proxy", async () => {
    const k = klient({ "x-forwarded-proto": "https" });
    const r = await k("/__ark/auth/lokal", post({ användarnamn: "anna@example.org", lösenord: "ett långt lösenord" }));
    expect(r.status).toBe(200);
    expect(r.kaka).toMatch(/;\s*Secure/i);
    const utan = await klient()("/__ark/auth/lokal", post({ användarnamn: "anna@example.org", lösenord: "ett långt lösenord" }));
    expect(utan.kaka).not.toMatch(/Secure/i);
  });

  it("viaHttps läser proxyns huvud", () => {
    expect(viaHttps({ headers: { "x-forwarded-proto": "https" } } as unknown as IncomingMessage)).toBe(true);
    expect(viaHttps({ headers: { "x-forwarded-proto": "http" } } as unknown as IncomingMessage)).toBe(false);
    expect(viaHttps({ headers: {} } as unknown as IncomingMessage)).toBe(false);
  });

  it("REGRESSION: lokala konton i drift utan ARK_BAS_URL var bara en varning – nu startar appen inte", () => {
    const bas = { NODE_ENV: "production", ARK_AUTH: "lokal", ARK_SESSION_SECRET: "x".repeat(40), SETUP_CODE: "kod" };
    expect(kontrollera(bas).fel.join(" ")).toContain("ARK_BAS_URL");
    expect(kontrollera({ ...bas, ARK_BAS_URL: "https://arkitekten.example.org" }).fel).toEqual([]);
    // Utanför drift är det fortfarande en varning.
    expect(kontrollera({ ...bas, NODE_ENV: "development" }).fel).toEqual([]);
  });
});

describe("visualiseringarna", () => {
  const serie = (namn: string) => ({ id: "serie-annas", namn, flödeId: "x", ramar: [], savedAt: new Date().toISOString() });

  it("REGRESSION: vem som helst kunde spara över någon annans visualisering", async () => {
    expect((await anna("/__ark/ramar/serie-annas", { method: "PUT", body: JSON.stringify(serie("Annas")) })).status).toBe(200);
    const över = await bo("/__ark/ramar/serie-annas", { method: "PUT", body: JSON.stringify(serie("Bos")) });
    expect(över.status).toBe(403);
    expect((await bo("/__ark/ramar/serie-annas")).kropp.serie.namn).toBe("Annas");
    // Skaparen och administratören får ändra.
    expect((await anna("/__ark/ramar/serie-annas", { method: "PUT", body: JSON.stringify(serie("Annas 2")) })).status).toBe(200);
    expect((await admin("/__ark/ramar/serie-annas", { method: "PUT", body: JSON.stringify(serie("Admins")) })).status).toBe(200);
  });
});

describe("felbeskeden utåt", () => {
  it("REGRESSION: ett filsystemsfel gick ut till webbläsaren med serverns sökvägar", async () => {
    const r = await anna("/__ark/flows/min-process", {
      method: "PUT",
      body: JSON.stringify({ id: "min-process", name: "Min", draft: { steps: [] }, versions: [] }),
    });
    expect(r.status).toBe(500);
    expect(r.text).not.toContain(tmp);
    expect(r.text).not.toMatch(/EEXIST|ENOTDIR|ENOENT/);
  });

  it("ett avsiktligt besked (Kontofel) når fortfarande användaren", async () => {
    const r = await anna("/__ark/auth/lokal", post({ användarnamn: "anna@example.org", lösenord: "fel fel fel fel" }));
    expect(r.kropp.error).toBe("Fel användarnamn eller lösenord.");
  });

  it("REGRESSION: inloggningsfelet i adressen var fri text – nu en kod ur en känd uppsättning", () => {
    expect(inloggningsfelKod("Entra svarade: AADSTS700025: Client is public")).toBe("AADSTS700025");
    expect(inloggningsfelKod("Entra svarade: Ring supporten på 08-123")).toBe("entra");
    expect(inloggningsfelKod("Inloggningen tog för lång tid – försök igen.")).toBe("tid");
    expect(inloggningsfelText("Ring supporten på 08-123")).toMatch(/^Inloggningen misslyckades/);
    expect(inloggningsfelText("AADSTS700025")).toContain("AADSTS700025");
  });
});

describe("portalens läsning", () => {
  it("REGRESSION: vilken inloggad som helst läste portalen med adminnyckeln – nu bara den som får publicera", async () => {
    process.env.EA_API_KEY = "låtsas";
    process.env.EA_API_URL = "http://127.0.0.1:9/api/v1";
    try {
      expect((await anna("/__ark/ea/processer")).status).toBe(403);
      expect((await anna("/__ark/ea/applikationer")).status).toBe(403);
      expect((await anna("/__ark/ea/status")).status).toBe(200);
    } finally {
      delete process.env.EA_API_KEY;
      delete process.env.EA_API_URL;
    }
  });
});
