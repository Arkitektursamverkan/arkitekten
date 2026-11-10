/**
 * Bryggans säkerhetslöften, omgång 3 (granskningen 2026-11-10):
 * säkerhetshuvudena, publiceringen som servern äger, CSRF-skyddet, öppen
 * omdirigering, X-Forwarded-For bakom n proxyer, inloggningsspärrens tak,
 * brevlådan per användare i utvecklarläget och AI-nyckelns uppdrag.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http, { type IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { betroddaProxyer, Hastighetsgräns, klientadress, skapaBrygga, type AiModuler } from "./brygga";
import { Inloggningsspärr, spärrnycklar } from "./konton";
import { säkerTillbaka } from "./auth";
import { arkBridge } from "../scripts/ark-bridge";
import { skapaServer } from "./arkitekten.mjs";
import { installningarUrMiljö } from "./installningar";
import { skapaHanterare } from "./flodestjanst.mjs";

const MILJÖ = { ...process.env };
let server: http.Server;
let bas: string;
let tmp: string;

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sakerhet3-"));
  fs.mkdirSync(path.join(tmp, "dist"));
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<!doctype html>");
  process.env.ARK_AUTH = "lokal";
  process.env.ARK_SESSION_SECRET = "x".repeat(40);
  process.env.ANTHROPIC_API_KEY = "låtsasnyckel";
  for (const k of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ARK_BAS_URL", "SETUP_CODE", "ARK_UTVECKLARLAGE", "ARK_BETRODD_PROXY"])
    delete process.env[k];
  const inst = installningarUrMiljö(tmp, {});
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

describe("säkerhetshuvudena", () => {
  it("REGRESSION: sidan saknade innehållspolicy – nu inga inline-skript och bara egen inramning", async () => {
    const r = await fetch(`${bas}/`);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toMatch(/frame-ancestors 'self'/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBeTruthy();
    expect(r.headers.get("strict-transport-security")).toBeNull();
  });

  it("HSTS bara när begäran kom över https", async () => {
    const r = await fetch(`${bas}/health`, { headers: { "x-forwarded-proto": "https" } });
    expect(r.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
  });
});

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
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) });
const PUBLICERING = { eaNodId: "nod-1", eaNodNamn: "1.1 Prov", ägare: "Ägaren", beskrivning: "Vad den gör.", publiceradAt: "2026-11-02T00:00:00.000Z" };
const läsFil = (id: string) => JSON.parse(fs.readFileSync(path.join(tmp, "flows", `${id}.json`), "utf8"));

describe("publiceringen ägs av servern", () => {
  beforeAll(async () => {
    // En process i den gemensamma katalogen (skapas i adminens egen och flyttas),
    // och en i Demo.
    expect((await admin("/__ark/flows/gemensam-1", put(flödet("gemensam-1")))).status).toBe(200);
    expect((await admin("/__ark/flows/gemensam-1/yta", post({ till: "gemensam" }))).status).toBe(200);
    expect((await anna("/__ark/flows/demo-1", put(flödet("demo-1", { category: "Demo" })))).status).toBe(200);
  });

  it("REGRESSION: en vanlig sparning i Demo bar publiceringen – nu tas den aldrig ur begäran", async () => {
    const fil = läsFil("demo-1");
    const r = await anna("/__ark/flows/demo-1", put({ ...fil, publicering: PUBLICERING }));
    expect(r.status).toBe(200);
    expect(läsFil("demo-1").publicering).toBeUndefined();
    // Inte heller när filen skapas.
    await anna("/__ark/flows/demo-2", put(flödet("demo-2", { category: "Demo", publicering: PUBLICERING })));
    expect(läsFil("demo-2").publicering).toBeUndefined();
  });

  it("publiceringsvägen kräver administratör och den gemensamma katalogen", async () => {
    expect((await anna("/__ark/ea/publicering/gemensam-1", put({ publicering: PUBLICERING }))).status).toBe(403);
    expect((await admin("/__ark/ea/publicering/demo-1", put({ publicering: PUBLICERING }))).status).toBe(403);
    expect((await admin("/__ark/ea/publicering/gemensam-1", put({ publicering: { eaNodId: "x" } }))).status).toBe(400);
    const före = läsFil("gemensam-1");
    const r = await admin("/__ark/ea/publicering/gemensam-1", put({ publicering: { ...PUBLICERING, okänt: "<x>" } }));
    expect(r.status).toBe(200);
    const efter = läsFil("gemensam-1");
    expect(efter.publicering).toMatchObject({ eaNodId: "nod-1", ägare: "Ägaren" });
    expect(efter.publicering.okänt).toBeUndefined();
    // Invariant 11: ingen ny version, savedAt står still.
    expect(efter.versions).toEqual(före.versions);
    expect(efter.savedAt).toBe(före.savedAt);
  });

  it("en vanlig sparning behåller filens publicering, vad begäran än säger", async () => {
    const fil = läsFil("gemensam-1");
    const { publicering: _p, ...utan } = fil;
    await admin("/__ark/flows/gemensam-1", put(utan));
    expect(läsFil("gemensam-1").publicering?.eaNodId).toBe("nod-1");
    await admin("/__ark/flows/gemensam-1", put({ ...fil, publicering: { ...PUBLICERING, eaNodId: "annan" } }));
    expect(läsFil("gemensam-1").publicering?.eaNodId).toBe("nod-1");
  });

  it("REGRESSION: flödestjänsten lämnade ut en publicering i Demo – nu bara den gemensamma katalogens", async () => {
    // En Demo-fil med publicering (skriven före rättningen).
    fs.writeFileSync(path.join(tmp, "flows", "demo-gammal.json"), JSON.stringify(flödet("demo-gammal", { category: "Demo", publicering: PUBLICERING })));
    const tjänst = http.createServer(skapaHanterare(path.join(tmp, "flows"), path.join(tmp, "stilar"), ""));
    await new Promise<void>((klar) => tjänst.listen(0, klar));
    try {
      const port = (tjänst.address() as { port: number }).port;
      const lista = (await (await fetch(`http://127.0.0.1:${port}/api/flows`)).json()).flows as Array<{ id: string; publicering?: unknown }>;
      expect(lista.find((f) => f.id === "demo-gammal")?.publicering).toBeUndefined();
      expect(lista.find((f) => f.id === "gemensam-1")?.publicering).toBeTruthy();
    } finally {
      await new Promise<void>((klar) => tjänst.close(() => klar()));
    }
  });

  it("byte av yta tar bort publiceringen", async () => {
    expect((await admin("/__ark/flows/gemensam-1/yta", post({ till: "demo" }))).status).toBe(200);
    expect(läsFil("gemensam-1").publicering).toBeUndefined();
    // Avpubliceringen tar bara bort fältet.
    await admin("/__ark/flows/gemensam-1/yta", post({ till: "gemensam" }));
    await admin("/__ark/ea/publicering/gemensam-1", put({ publicering: PUBLICERING }));
    expect((await admin("/__ark/ea/publicering/gemensam-1", { method: "DELETE" })).status).toBe(200);
    expect(läsFil("gemensam-1").publicering).toBeUndefined();
  });
});

describe("flödestjänstens SVG", () => {
  it("REGRESSION: bilden serverades utan policy – en SVG öppnad i en flik kunde köra skript", async () => {
    const tjänst = http.createServer(skapaHanterare(path.join(tmp, "flows"), path.join(tmp, "stilar"), ""));
    await new Promise<void>((klar) => tjänst.listen(0, klar));
    try {
      const port = (tjänst.address() as { port: number }).port;
      const exempel = path.resolve(__dirname, "../innehallspaket/exempel/flows/exempel-bestall-behorighet.json");
      fs.copyFileSync(exempel, path.join(tmp, "flows", "exempel-bestall-behorighet.json"));
      const r = await fetch(`http://127.0.0.1:${port}/api/flows/exempel-bestall-behorighet/svg?version=aktuell`);
      expect(r.headers.get("content-type")).toMatch(/image\/svg\+xml/);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    } finally {
      await new Promise<void>((klar) => tjänst.close(() => klar()));
    }
  });
});

describe("flödestjänstens felhantering", () => {
  it("REGRESSION: en sökväg som inte gick att tolka kastade utanför felhanteringen – nu 400 och tjänsten lever", async () => {
    const tjänst = http.createServer(skapaHanterare(path.join(tmp, "flows"), path.join(tmp, "stilar"), ""));
    await new Promise<void>((klar) => tjänst.listen(0, klar));
    try {
      const port = (tjänst.address() as { port: number }).port;
      const status = await new Promise<number | undefined>((klar) => {
        const req = http.request({ host: "127.0.0.1", port, path: "//[trasig", method: "GET" }, (res) => {
          res.resume();
          klar(res.statusCode);
        });
        req.on("error", () => klar(undefined));
        req.end();
      });
      expect(status).toBe(400);
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    } finally {
      await new Promise<void>((klar) => tjänst.close(() => klar()));
    }
  });
});

describe("klientens adress bakom proxyer", () => {
  const req = (xff: string) =>
    ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: "10.0.0.9" } }) as unknown as IncomingMessage;

  it("REGRESSION: första ledet i X-Forwarded-For togs – det skriver klienten själv", () => {
    // Klienten skrev "1.2.3.4" själv; proxyn lade till den verkliga adressen sist.
    expect(klientadress(req("1.2.3.4, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(klientadress(req("1.2.3.4, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
    expect(klientadress(req("1.2.3.4, 203.0.113.9"), 0)).toBe("10.0.0.9");
    // För få led: socketens adress.
    expect(klientadress(req("203.0.113.9"), 2)).toBe("10.0.0.9");
  });

  it("ARK_BETRODD_PROXY är ett antal; de gamla på-värdena betyder en", () => {
    for (const v of ["1", "true", "ja", "on", "TRUE"]) expect(betroddaProxyer(v)).toBe(1);
    expect(betroddaProxyer("2")).toBe(2);
    for (const v of [undefined, "", "0", "nej", "-1", "1.5"]) expect(betroddaProxyer(v)).toBe(0);
  });
});

describe("inloggningsspärrens minne", () => {
  it("REGRESSION: spärren växte utan gräns – nu ett tak, äldst ut", () => {
    const spärr = new Inloggningsspärr(100);
    for (let i = 0; i < 1000; i++) spärr.misslyckat(spärrnycklar(`namn${i}`, `10.0.${i >> 8}.${i & 255}`));
    expect(spärr.storlek).toBeLessThanOrEqual(100);
  });

  it("utgångna poster utan spärr glöms, en pågående spärr står kvar", () => {
    const spärr = new Inloggningsspärr();
    const t0 = Date.now();
    const gissare = spärrnycklar("anna", "203.0.113.9");
    for (let i = 0; i < 5; i++) spärr.misslyckat(gissare, t0);
    spärr.misslyckat(spärrnycklar("bo", "198.51.100.1"), t0);
    expect(spärr.spärradTill(gissare, t0 + 1000)).toBeGreaterThan(0);
    // Två timmar senare: båda har gått ut och glöms vid nästa fel.
    spärr.misslyckat(spärrnycklar("cecilia", "192.0.2.1"), t0 + 2 * 60 * 60_000);
    expect(spärr.storlek).toBe(2);
  });
});

describe("tillbaka efter inloggningen", () => {
  it("REGRESSION: vägar som webbläsaren läser som en annan värd släpptes igenom", () => {
    for (const ond of ["/\\evil.com", "/\t/evil.com", "//evil.com", "https://evil.com", "/\\/evil.com", "\\\\evil.com", "javascript:alert(1)", ""])
      expect(säkerTillbaka(ond)).toBe("/");
    expect(säkerTillbaka("/#/process/x")).toBe("/#/process/x");
    expect(säkerTillbaka("/ramar?serie=a#b")).toBe("/ramar?serie=a#b");
  });
});

describe("CSRF-skyddet", () => {
  it("REGRESSION: ett formulär från en annan webbplats kunde ändra – nu krävs JSON och rätt ursprung", async () => {
    // Ett formulär: text/plain eller urlencoded, med den andra sidans Origin.
    const form = await admin("/__ark/konton", {
      method: "POST",
      body: "användarnamn=ond@example.org",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
    });
    expect(form.status).toBe(403);
    // Rätt typ men fel ursprung.
    expect((await admin("/__ark/konton", { ...post({}), headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await admin("/__ark/konton", { ...post({}), headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await admin("/__ark/konton", { ...post({}), headers: { origin: "null" } })).status).toBe(403);
    // Rätt ursprung men inte JSON.
    expect((await admin("/__ark/cancel", { method: "POST", body: "", headers: { "content-type": "text/plain", origin: bas } })).status).toBe(403);
    // Appens eget anrop går igenom.
    expect((await admin("/__ark/cancel", { ...post({}), headers: { origin: bas, "sec-fetch-site": "same-origin" } })).status).toBe(200);
    // En DELETE från en annan webbplats stoppas också.
    expect((await admin("/__ark/flows/finns-inte", { method: "DELETE", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("uppladdningen tar binärt men kräver appens ursprung", async () => {
    const upp = (h: Record<string, string>) =>
      anna("/__ark/underlag?namn=a.txt", { method: "POST", body: "x", headers: { "content-type": "application/octet-stream", ...h } });
    expect((await upp({})).status).toBe(403);
    expect((await upp({ origin: "https://evil.example" })).status).toBe(403);
    expect((await upp({ "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await upp({ origin: bas })).status).toBe(200);
  });

  it("REGRESSION: utloggningen var en GET – nu bara POST", async () => {
    const k = klient();
    await k("/__ark/auth/lokal", post({ användarnamn: "bo@example.org", lösenord: "ett långt lösenord" }));
    const get = await fetch(`${bas}/__ark/auth/logout`, { redirect: "manual" });
    expect(get.status).toBe(405);
    const ut = await k("/__ark/auth/logout", post({}));
    expect(ut.status).toBe(200);
    expect(ut.kropp.tillbaka).toBe("/");
    expect(ut.kaka).toMatch(/Max-Age=0/i);
  });
});

describe("dev-servern", () => {
  it("REGRESSION: en felaktig inställning loggades bara – nu startar dev-servern inte", async () => {
    const före = process.env.ARK_AUTH;
    process.env.ARK_AUTH = "ogiltig";
    try {
      const tillägg = arkBridge();
      const loggare = { info: () => {}, warn: () => {}, error: () => {} };
      const låtsas = { config: { root: tmp, logger: loggare }, middlewares: { use: () => {} } };
      // configureServer är asynkron (portalens uppgifter hämtas först) – Vite väntar på den.
      await expect((tillägg.configureServer as (s: unknown) => Promise<void>)(låtsas)).rejects.toThrow(/startar inte/);
    } finally {
      if (före === undefined) delete process.env.ARK_AUTH;
      else process.env.ARK_AUTH = före;
    }
  });

  it("lyssnar bara på den egna maskinen om inget annat sägs", async () => {
    const konfig = (await import("../vite.config")).default as { server?: { host?: unknown } };
    expect(konfig.server?.host).toBe(process.env.ARK_DEV_HOST?.trim() || "127.0.0.1");
  });
});

describe("AI-nyckeln", () => {
  it("REGRESSION: en inloggad kunde skicka hur många betalda anrop som helst – nu en gräns per användare och timme", async () => {
    const gräns = new Hastighetsgräns(3, 60 * 60_000);
    const t0 = 1_000_000;
    expect([1, 2, 3, 4].map((i) => gräns.tillåt("anna", t0 + i))).toEqual([true, true, true, false]);
    expect(gräns.tillåt("bo", t0)).toBe(true);
    expect(gräns.väntaMs("anna", t0 + 10)).toBeGreaterThan(0);
    expect(gräns.tillåt("anna", t0 + 60 * 60_000 + 2)).toBe(true);
  });

  it("bryggan svarar 429 när användarens tak är nått", async () => {
    const k = klient();
    await k("/__ark/auth/lokal", post({ användarnamn: "bo@example.org", lösenord: "ett långt lösenord" }));
    const svar: number[] = [];
    for (let i = 0; i < 31; i++) svar.push((await k("/__ark/request", post({ rawText: `x${i}`, uppdrag: "utvärdering" }))).status);
    expect(svar.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(svar[30]).toBe(429);
  });
});
