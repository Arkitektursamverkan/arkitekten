/**
 * Bryggans säkerhetslöften, omgång 3 (granskningen 2026-11-10):
 * säkerhetshuvudena, publiceringen som servern äger, CSRF-skyddet, öppen
 * omdirigering, X-Forwarded-For bakom n proxyer, inloggningsspärrens tak,
 * brevlådan per användare i utvecklarläget och AI-nyckelns uppdrag.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { skapaBrygga, type AiModuler } from "./brygga";
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
