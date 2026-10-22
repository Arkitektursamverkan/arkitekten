/**
 * Innehållspaketen: exemplet går att lägga in i en tom installation, en
 * import skriver aldrig över det som finns (invariant 11), och en export tar
 * med det som är installationens innehåll – inte dess val.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileDraft } from "@/core/draft";
import { EXEMPELKATALOG, exempelpaket, exportera, importera } from "./innehallspaket.mjs";

let tmp: string;
let inst: { flowsDir: string; ramarDir: string; stilarDir: string };
const skriv = (fil: string, data: unknown) => {
  fs.mkdirSync(path.dirname(fil), { recursive: true });
  fs.writeFileSync(fil, JSON.stringify(data, null, 2));
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paket-"));
  inst = { flowsDir: path.join(tmp, "flows"), ramarDir: path.join(tmp, "ramar"), stilarDir: path.join(tmp, "stilar") };
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("exempelpaketet", () => {
  it("finns, går att lägga in i en tom installation, och varje process går att kompilera", () => {
    expect(exempelpaket().map((p) => p.info.namn)).toContain("Exempel");
    const r = importera(inst, path.join(EXEMPELKATALOG, "exempel"));
    expect(r.fel).toEqual([]);
    expect(r.inlagda.length).toBeGreaterThanOrEqual(2);
    for (const f of fs.readdirSync(inst.flowsDir)) {
      const flöde = JSON.parse(fs.readFileSync(path.join(inst.flowsDir, f), "utf8"));
      expect(compileDraft(flöde.draft).nodes.length, f).toBeGreaterThan(3);
    }
  });

  it("en andra import ändrar ingenting", () => {
    importera(inst, path.join(EXEMPELKATALOG, "exempel"));
    const r = importera(inst, path.join(EXEMPELKATALOG, "exempel"));
    expect(r.inlagda).toEqual([]);
    expect(r.oförändrade.length).toBeGreaterThanOrEqual(2);
  });
});

describe("importen", () => {
  const paket = () => path.join(tmp, "paket");
  beforeEach(() => skriv(path.join(paket(), "pack.json"), { format: "arkitekten.innehallspaket", version: 1, namn: "p" }));

  it("REGRESSION-skydd (invariant 11): ett befintligt flöde med annat innehåll skrivs aldrig över", () => {
    skriv(path.join(inst.flowsDir, "a.json"), { id: "a", name: "Vår version", draft: {} });
    skriv(path.join(paket(), "flows", "a.json"), { id: "a", name: "Paketets version", draft: {} });
    const r = importera(inst, paket());
    expect(r.befintliga).toEqual(["flows/a.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(inst.flowsDir, "a.json"), "utf8")).name).toBe("Vår version");
  });

  it("en trasig fil, ett id som inte stämmer och en stil med markup rapporteras och läggs inte in", () => {
    fs.mkdirSync(path.join(paket(), "flows"), { recursive: true });
    fs.writeFileSync(path.join(paket(), "flows", "trasig.json"), "{ inte json");
    skriv(path.join(paket(), "flows", "fel-id.json"), { id: "annat", name: "x", draft: {} });
    skriv(path.join(paket(), "stilar", "ond.json"), { id: "ond", namn: "Ond", teckensnitt: 'x" onload="y' });
    const r = importera(inst, paket());
    expect(r.fel).toHaveLength(3);
    expect(r.inlagda).toEqual([]);
    expect(fs.existsSync(inst.flowsDir)).toBe(false);
  });

  it("torrkörningen skriver ingenting", () => {
    skriv(path.join(paket(), "flows", "b.json"), { id: "b", name: "B", draft: {} });
    expect(importera(inst, paket(), { torrkörning: true }).inlagda).toEqual(["flows/b.json"]);
    expect(fs.existsSync(path.join(inst.flowsDir, "b.json"))).toBe(false);
  });

  it("ett paket i ett okänt format eller en nyare version avvisas", () => {
    skriv(path.join(paket(), "pack.json"), { format: "något-annat", version: 1, namn: "p" });
    expect(() => importera(inst, paket())).toThrow(/format/);
    skriv(path.join(paket(), "pack.json"), { format: "arkitekten.innehallspaket", version: 99, namn: "p" });
    expect(() => importera(inst, paket())).toThrow(/version/);
  });
});

describe("exporten", () => {
  it("tar med processer, visualiseringar och stilar – men inte stilvalet, och utan egna processer på begäran", () => {
    skriv(path.join(inst.flowsDir, "gemensam.json"), { id: "gemensam", name: "G", draft: {} });
    skriv(path.join(inst.flowsDir, "egen.json"), { id: "egen", name: "E", draft: {}, ägare: { id: "u", namn: "U" } });
    skriv(path.join(inst.ramarDir, "r.json"), { id: "r", namn: "R" });
    skriv(path.join(inst.stilarDir, "s.json"), { id: "s", namn: "S" });
    skriv(path.join(inst.stilarDir, "vald.json"), { id: "s" });
    const ut = path.join(tmp, "ut");
    const info = exportera(inst, ut, { namn: "test", utanEgna: true });
    expect(info.antal).toEqual({ flows: 1, ramar: 1, stilar: 1 });
    expect(fs.existsSync(path.join(ut, "stilar", "vald.json"))).toBe(false);
    expect(fs.existsSync(path.join(ut, "flows", "egen.json"))).toBe(false);
    // Rundresan: exporten går att importera i en tom installation.
    const tom = { flowsDir: path.join(tmp, "t", "flows"), ramarDir: path.join(tmp, "t", "ramar"), stilarDir: path.join(tmp, "t", "stilar") };
    expect(importera(tom, ut).inlagda).toHaveLength(3);
  });
});
