import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { barnetsMiljö, flödestjänstPort, startaFlödestjänst } from "./flodestjanst-barn";

describe("flödestjänstPort", () => {
  it("är null när ARK_FLODESTJANST_PORT inte är satt", () => {
    expect(flödestjänstPort({})).toBeNull();
    expect(flödestjänstPort({ ARK_FLODESTJANST_PORT: "  " })).toBeNull();
  });

  it("läser porten", () => {
    expect(flödestjänstPort({ ARK_FLODESTJANST_PORT: "8200" })).toBe(8200);
  });

  it("stoppar för en port som inte går att använda", () => {
    expect(() => flödestjänstPort({ ARK_FLODESTJANST_PORT: "åtta" })).toThrow(/inte en port/);
    expect(() => flödestjänstPort({ ARK_FLODESTJANST_PORT: "70000" })).toThrow(/inte en port/);
  });

  it("stoppar när porten är appens egen", () => {
    expect(() => flödestjänstPort({ ARK_FLODESTJANST_PORT: "5173" })).toThrow(/samma port/);
    expect(() => flödestjänstPort({ ARK_FLODESTJANST_PORT: "10000", PORT: "10000" })).toThrow(/samma port/);
  });
});

describe("barnets miljö", () => {
  it("REGRESSION: barnet ärvde hela miljön med alla hemligheter – nu bara det flödestjänsten läser", () => {
    const miljö = barnetsMiljö(
      {
        PATH: "/usr/bin",
        FLOWS_DIR: "/data/flows",
        STILAR_DIR: "/data/stilar",
        ARK_PORTALBANA: "Portalen",
        ARK_FLODESTJANST_NYCKEL: "nyckeln",
        ANTHROPIC_API_KEY: "hemlig",
        BERGET_API_KEY: "hemlig",
        ENTRA_CLIENT_SECRET: "hemlig",
        EA_API_KEY: "hemlig",
        ARK_SESSION_SECRET: "hemlig",
        SETUP_CODE: "hemlig",
        PORT: "5173",
      },
      8200,
    );
    expect(miljö).toEqual({
      PATH: "/usr/bin",
      FLOWS_DIR: "/data/flows",
      STILAR_DIR: "/data/stilar",
      ARK_PORTALBANA: "Portalen",
      ARK_FLODESTJANST_NYCKEL: "nyckeln",
      PORT: "8200",
    });
  });
});

describe("startaFlödestjänst", () => {
  let barn: ChildProcess | null = null;
  afterEach(() => {
    barn?.kill("SIGTERM");
    barn = null;
  });

  it("startar flödestjänsten ur samma installation på den angivna porten", async () => {
    const root = path.resolve(__dirname, "..");
    const flows = fs.mkdtempSync(path.join(os.tmpdir(), "ark-barn-"));
    // En ledig port: låt systemet välja, släpp den och ge den till barnet.
    const net = await import("node:net");
    const port = await new Promise<number>((klar) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => klar(p));
      });
    });
    barn = startaFlödestjänst(root, port, { ...process.env, FLOWS_DIR: flows });
    let svar: Response | null = null;
    for (let i = 0; i < 100 && !svar; i++) {
      svar = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
      if (!svar) await new Promise((r) => setTimeout(r, 100));
    }
    expect(svar?.ok).toBe(true);
    fs.rmSync(flows, { recursive: true, force: true });
  }, 20_000);

  it("barnet får nyckeln: /api kräver X-Arkitekten-Nyckel, /health är öppen", async () => {
    const root = path.resolve(__dirname, "..");
    const flows = fs.mkdtempSync(path.join(os.tmpdir(), "ark-barn-"));
    const net = await import("node:net");
    const port = await new Promise<number>((klar) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => klar(p));
      });
    });
    barn = startaFlödestjänst(root, port, { ...process.env, FLOWS_DIR: flows, ARK_FLODESTJANST_NYCKEL: "barnets-nyckel" });
    let svar: Response | null = null;
    for (let i = 0; i < 100 && !svar; i++) {
      svar = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
      if (!svar) await new Promise((r) => setTimeout(r, 100));
    }
    expect(svar?.ok).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/api/flows`)).status).toBe(401);
    const med = await fetch(`http://127.0.0.1:${port}/api/flows`, { headers: { "X-Arkitekten-Nyckel": "barnets-nyckel" } });
    expect(med.status).toBe(200);
    fs.rmSync(flows, { recursive: true, force: true });
  }, 20_000);
});
