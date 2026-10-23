/**
 * Den fristående serverns löften: den lämnar bara ut det byggda gränssnittet,
 * bryggan nås under /__ark med samma hanterare som i Vite, och AI-stödet är
 * av när installationen inte har slagit på det.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { skapaBrygga } from "./brygga";
import { skapaServer } from "./arkitekten.mjs";
import { installningarUrMiljö, kontrollera } from "./installningar";

let server: http.Server;
let bas: string;
let tmp: string;
const MILJÖ = { ...process.env };

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arkitekten-"));
  fs.mkdirSync(path.join(tmp, "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<!doctype html><title>Arkitekten</title>");
  fs.writeFileSync(path.join(tmp, "dist", "assets", "app-abc.js"), "console.log(1)");
  fs.writeFileSync(path.join(tmp, "hemlig.txt"), "utanför dist");
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ version: "9.8.7" }));
  // Öppen drift, ingen nyckel, inget utvecklarläge.
  for (const k of ["ANTHROPIC_API_KEY", "ARK_UTVECKLARLAGE", "ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ARK_AUTH", "ARK_VERSION"])
    delete process.env[k];
  const inst = installningarUrMiljö(tmp, {});
  const logg = { info: () => {}, warn: () => {} };
  const brygga = skapaBrygga({
    ...inst,
    logg,
    laddaAi: () => Promise.reject(new Error("ska inte laddas")),
  });
  server = skapaServer(inst, brygga);
  await new Promise<void>((klar) => server.listen(0, klar));
  bas = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((klar) => server.close(() => klar()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

afterEach(() => {
  process.env = { ...MILJÖ };
});

describe("gränssnittet", () => {
  it("appens egna vägar får index.html, som inte cachas", async () => {
    const res = await fetch(`${bas}/processer/nagot`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Arkitekten</title>");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("tillgångarna cachas för alltid – namnet bär innehållet", async () => {
    const res = await fetch(`${bas}/assets/app-abc.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("en fil som saknas ger 404, inte index.html", async () => {
    expect((await fetch(`${bas}/assets/finns-inte.js`)).status).toBe(404);
  });

  it("REGRESSION: inget utanför dist/ lämnas ut, hur sökvägen än skrivs", async () => {
    for (const väg of ["/../hemlig.txt", "/%2e%2e/hemlig.txt", "/assets/..%2f..%2fhemlig.txt"]) {
      const res = await fetch(`${bas}${väg}`);
      expect(await res.text()).not.toContain("utanför dist");
    }
  });
});

describe("hälsan och bryggan", () => {
  it("/health säger version och AI-läge, inga sökvägar eller nycklar", async () => {
    const res = await fetch(`${bas}/health`);
    const kropp = await res.json();
    expect(kropp).toEqual({ status: "ok", version: "9.8.7", ai: "av" });
  });

  it("bryggan nås under /__ark – okänd väg ger 404 i JSON", async () => {
    const res = await fetch(`${bas}/__ark/finns-inte`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("utan nyckel och utvecklarläge är AI-stödet av, och Claude Code erbjuds inte", async () => {
    const status = await (await fetch(`${bas}/__ark/status`)).json();
    expect(status).toMatchObject({ besvaras: "av", claudeCode: false });
    const res = await fetch(`${bas}/__ark/request`, { method: "POST", body: "{}" });
    expect(res.status).toBe(503);
    expect(fs.existsSync(path.join(tmp, ".ark", "request.json"))).toBe(false);
  });

  it("med nyckel svarar servern, och utan utvecklarläge går inget till brevlådan för Claude Code", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const status = await (await fetch(`${bas}/__ark/status`)).json();
    expect(status).toMatchObject({ besvaras: "api", claudeCode: false });
  });
});

describe("organisationens utseende", () => {
  it("nås utan session – inloggningssidan visar det – och saknas logotyp blir det 404", async () => {
    const res = await fetch(`${bas}/__ark/utseende`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect((await fetch(`${bas}/__ark/utseende/logo`)).status).toBe(404);
  });
});

describe("symbolstilen", () => {
  it("standardstilen gäller tills en administratör väljer en annan, och en trasig fil stoppar inget", async () => {
    expect((await (await fetch(`${bas}/__ark/symbolstil`)).json()).stil.id).toBe("neutral");
    const dir = path.join(tmp, "stilar");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "egen.json"), JSON.stringify({ id: "egen", namn: "Egen", aktör: "arbetsplats" }));
    fs.writeFileSync(path.join(dir, "trasig.json"), "{ inte json");
    const lista = await (await fetch(`${bas}/__ark/symbolstilar`)).json();
    expect(lista.stilar.map((s: { id: string }) => s.id)).toEqual(["neutral", "egen"]);
    expect(lista.fel.join(" ")).toContain("trasig.json");
    const val = await fetch(`${bas}/__ark/symbolstil`, { method: "PUT", body: JSON.stringify({ id: "egen" }) });
    expect(val.status).toBe(200);
    expect((await (await fetch(`${bas}/__ark/symbolstil`)).json()).stil.aktör).toBe("arbetsplats");
  });

  it("ett okänt id väljs aldrig", async () => {
    const res = await fetch(`${bas}/__ark/symbolstil`, { method: "PUT", body: JSON.stringify({ id: "finns-inte" }) });
    expect(res.status).toBe(400);
  });
});

describe("kontrollen vid start", () => {
  it("Entra utan sessionshemlighet eller adress startar inte", () => {
    const { fel } = kontrollera({ ENTRA_TENANT_ID: "t", ENTRA_CLIENT_ID: "c", ENTRA_CLIENT_SECRET: "s" });
    expect(fel.join(" ")).toContain("ARK_BAS_URL");
    expect(fel.join(" ")).toContain("ARK_SESSION_SECRET");
  });

  it("en kort sessionshemlighet räcker inte", () => {
    const { fel } = kontrollera({
      ENTRA_TENANT_ID: "t",
      ENTRA_CLIENT_ID: "c",
      ENTRA_CLIENT_SECRET: "s",
      ARK_BAS_URL: "https://arkitekten.example.org",
      ARK_SESSION_SECRET: "kort",
    });
    expect(fel).toEqual(["ARK_SESSION_SECRET är för kort – minst 32 tecken."]);
  });

  it("felen och varningarna nämner bara variabelns namn, aldrig dess värde", () => {
    const hemligt = "sk-hemlig-nyckel-som-inte-far-synas";
    const { fel, varningar } = kontrollera({ ENTRA_CLIENT_SECRET: hemligt, ARK_SESSION_SECRET: "x", EA_API_KEY: hemligt });
    expect([...fel, ...varningar].join(" ")).not.toContain(hemligt);
  });

  it("öppen drift varnar", () => {
    expect(kontrollera({}).varningar.join(" ")).toContain("ÖPPEN");
  });

  it("katalogerna kommer ur miljön, relativt roten", () => {
    const inst = installningarUrMiljö("/app", { FLOWS_DIR: "/data/flows", RAMAR_DIR: "/data/ramar", ARK_DIR: "/data/ark" });
    expect(inst).toMatchObject({ flowsDir: "/data/flows", ramarDir: "/data/ramar", arkDir: "/data/ark", distDir: "/app/dist", stilarDir: "/app/stilar" });
    expect(installningarUrMiljö("/app", {}).flowsDir).toBe("/app/flows");
  });
});
