import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { flödestjänstPort, startaFlödestjänst } from "./flodestjanst-barn";

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
});
