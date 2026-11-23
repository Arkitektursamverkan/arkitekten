/**
 * Flödestjänsten lämnar ut de systemskisser som publicerats på en server i
 * portalen – och bara dem.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { skapaHanterare } from "./flodestjanst.mjs";

let tjänst: http.Server;
let bas: string;
let tmp: string;

const skiss = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  namn: `Skiss ${id}`,
  savedAt: "2026-11-20T10:00:00.000Z",
  lager: [{ id: "l-a", namn: "Appen" }],
  objekt: [
    { id: "o-1", sort: "tjanst", namn: "Webb <b>", lager: "l-a", x: 100, y: 100, b: 170, h: 64 },
    { id: "o-2", sort: "databas", namn: "Databas", x: 400, y: 100, b: 170, h: 64 },
  ],
  zoner: [],
  kopplingar: [{ id: "k-1", från: "o-1", till: "o-2", pil: "till", linje: "hel" }],
  ...extra,
});
const PUB = { eaNodId: "11111111-2222-3333-4444-555555555555", publiceradAt: "2026-11-20T10:00:00.000Z" };
const hämta = async (väg: string) => {
  const res = await fetch(bas + väg);
  return { status: res.status, typ: res.headers.get("content-type") ?? "", text: await res.text() };
};

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tjanst-skisser-"));
  for (const d of ["flows", "skisser", "stilar"]) fs.mkdirSync(path.join(tmp, d));
  const skriv = (s: { id: string }) => fs.writeFileSync(path.join(tmp, "skisser", `${s.id}.json`), JSON.stringify(s));
  skriv(skiss("publicerad", { publicering: PUB, beskrivning: "Vår miljö" }));
  skriv(skiss("dold-publicerad", { publicering: PUB, dold: true }));
  skriv(skiss("opublicerad"));
  fs.writeFileSync(path.join(tmp, "skisser", "trasig.json"), "{");
  tjänst = http.createServer(skapaHanterare(path.join(tmp, "flows"), path.join(tmp, "stilar"), "", path.join(tmp, "skisser")));
  await new Promise<void>((klar) => tjänst.listen(0, klar));
  bas = `http://127.0.0.1:${(tjänst.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((klar) => tjänst.close(() => klar()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("systemskisser i flödestjänsten", () => {
  it("listan bär bara de publicerade, med familjen systemskiss och servern de hör till", async () => {
    const { flows } = JSON.parse((await hämta("/api/flows")).text);
    expect(flows.map((f: { id: string }) => f.id).sort()).toEqual(["sk-dold-publicerad", "sk-publicerad"]);
    const p = flows.find((f: { id: string }) => f.id === "sk-publicerad");
    expect(p).toMatchObject({ familj: "systemskiss", name: "Skiss publicerad", publicering: { eaNodId: PUB.eaNodId, beskrivning: "Vår miljö" } });
  });

  it("scenen är ritarens bild, flyttad till origo, med en färdig bild per lager", async () => {
    const { scen } = JSON.parse((await hämta("/api/flows/sk-publicerad/scen?version=fastslagen")).text);
    expect(scen).toMatchObject({ format: "ark-scen", familj: "systemskiss", noder: [], kanter: [] });
    expect(scen.bakgrund).toContain('data-skiss-objekt="o-1"');
    expect(scen.bakgrund).toContain("&lt;b&gt;");
    expect(scen.bakgrund).not.toContain("<b>");
    expect(scen.bredd).toBeGreaterThan(400);
    expect(scen.lager).toHaveLength(1);
    expect(scen.lager[0]).toMatchObject({ id: "l-a", namn: "Appen" });
    // Lagret bär sitt objekt och grannen det är kopplat till.
    expect(scen.lager[0].bakgrund).toContain('data-skiss-objekt="o-2"');
  });

  it("en opublicerad skiss finns inte – varken som scen eller bild", async () => {
    expect((await hämta("/api/flows/sk-opublicerad/scen")).status).toBe(404);
    expect((await hämta("/api/flows/sk-opublicerad/svg")).status).toBe(404);
    expect((await hämta("/api/flows/sk-finns-inte")).status).toBe(404);
  });

  it("bilden lämnas som SVG utan rätt att köra något", async () => {
    const svar = await hämta("/api/flows/sk-publicerad/svg");
    expect(svar.status).toBe(200);
    expect(svar.typ).toContain("image/svg+xml");
    expect(svar.text.startsWith("<svg")).toBe(true);
  });
});

describe("version och klassning i det portalen får", () => {
  it("skissen lämnas ut i senaste fastslagna version, med version och klassning i scenens revision", async () => {
    const innehåll = (namn: string, n: number) => ({ namn, objekt: skiss("x").objekt.slice(0, n), zoner: [], kopplingar: [] });
    fs.writeFileSync(
      path.join(tmp, "skisser", "versionerad.json"),
      JSON.stringify(
        skiss("versionerad", {
          publicering: PUB,
          klassning: { nivå: "niva-2", namn: "Nivå 2", satt: "2026-11-20T10:00:00.000Z" },
          versioner: [
            { id: "v1", savedAt: "2026-11-20T10:00:00.000Z", status: "fastslagen", innehåll: innehåll("Fastslagen bild", 1) },
            { id: "v2", savedAt: "2026-11-21T10:00:00.000Z", status: "utkast", innehåll: innehåll("Utkastet", 2) },
          ],
        }),
      ),
    );
    const { flows } = JSON.parse((await hämta("/api/flows")).text);
    expect(flows.find((f: { id: string }) => f.id === "sk-versionerad")).toMatchObject({ status: "fastslagen", beteckning: "1.0", stepCount: 1 });
    // Klassningen är av: ingen rad.
    let scen = JSON.parse((await hämta("/api/flows/sk-versionerad/scen")).text).scen;
    expect(scen.revision).toMatchObject({ version: "1.0", status: "fastslagen" });
    expect(scen.revision.klassning).toBeUndefined();
    fs.writeFileSync(path.join(tmp, "stilar", "klassning.json"), JSON.stringify({ på: true }));
    scen = JSON.parse((await hämta("/api/flows/sk-versionerad/scen")).text).scen;
    expect(scen.revision.klassning).toBe("Nivå 2 – Betydande skada");
    // Visas den inte i exporten, så inte heller här.
    fs.writeFileSync(path.join(tmp, "stilar", "klassning.json"), JSON.stringify({ på: true, visaIExport: false }));
    scen = JSON.parse((await hämta("/api/flows/sk-versionerad/scen")).text).scen;
    expect(scen.revision.klassning).toBeUndefined();
    fs.rmSync(path.join(tmp, "stilar", "klassning.json"));
  });
});
