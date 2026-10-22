/**
 * Flödestjänstens löften.
 *
 * Tjänsten är Arkitektens enda yta utåt, och den bär ett löfte som är värt mer
 * än en kommentar: den KAN INTE SKRIVA. Invariant 11 säger att en flödesversion
 * aldrig får skrivas över, och en nätverkstjänst som saknar förmågan kan inte
 * bryta mot den ens av misstag. Testerna nedan bevisar det i stället för att
 * lita på det – ett skrivande verb som smyger in i en framtida router ska göra
 * bygget rött.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { textToDraft } from "@/tools/flowchart/parser/toDraft";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { skapaHanterare } from "./flodestjanst.mjs";

let server: http.Server;
let bas: string;

/** Innehållet i flows/ före testerna – jämförs efteråt. */
function ögonblicksbild(): Record<string, string> {
  const ut: Record<string, string> = {};
  if (!fs.existsSync("flows")) return ut;
  for (const f of fs.readdirSync("flows")) {
    ut[f] = fs.readFileSync(path.join("flows", f), "utf8");
  }
  return ut;
}

/** Innehållet (flows/) ligger inte i git – i en ren klon hoppas testerna över. */
const HAR_FLÖDEN = fs.existsSync("flows");

const FÖRE = ögonblicksbild();

beforeAll(async () => {
  server = http.createServer(skapaHanterare("flows"));
  await new Promise<void>((klar) => server.listen(0, klar));
  const adr = server.address();
  if (!adr || typeof adr === "string") throw new Error("ingen port");
  bas = `http://127.0.0.1:${adr.port}`;
});

afterAll(async () => {
  await new Promise<void>((klar) => server.close(() => klar()));
});

describe("flödestjänsten", () => {
  it.skipIf(!HAR_FLÖDEN)("listar flödena med härledd status", async () => {
    const r = await fetch(`${bas}/api/flows`);
    expect(r.headers.get("content-type")).toContain("application/json");
    const d = await r.json();
    expect(d.ok).toBe(true);
    expect(d.flows.length).toBeGreaterThan(0);
    // Beteckningen HÄRLEDS (invariant 9) – den ska följa med, inte saknas.
    for (const f of d.flows) expect(f).toHaveProperty("beteckning");
    // Familjen skiljer processer från portalflöden.
    expect(new Set(d.flows.map((f: { familj: string }) => f.familj))).toContain("affarsprocess");
  });

  it.skipIf(!HAR_FLÖDEN)("bygger en scen för en affärsprocess", async () => {
    const d = await (await fetch(`${bas}/api/flows/ap-2-1-0-kohantering/scen`)).json();
    expect(d.ok).toBe(true);
    expect(d.scen.format).toBe("ark-scen");
    expect(d.scen.noder.length).toBeGreaterThan(0);
    expect(d.scen.defs).toContain("ap-arrow-flode");
  });

  /**
   * REGRESSION: löftet om läsbarhet. Varje skrivande verb ska avvisas, oavsett
   * väg – annars kan tjänsten en dag ändra en flödesfil, och då är invariant 11
   * bruten av något som ingen tittade på.
   */
  it.each(["PUT", "DELETE", "PATCH"])("avvisar %s", async (metod) => {
    const r = await fetch(`${bas}/api/flows/ap-2-1-0-kohantering`, { method: metod });
    expect(r.status).toBe(405);
  });

  it("släpper inte ut ur flows/ (path traversal)", async () => {
    const r = await fetch(`${bas}/api/flows/${encodeURIComponent("../../package")}`);
    expect(r.status).toBe(400);
  });

  it("svarar 404 på okänt flöde och okänd väg", async () => {
    expect((await fetch(`${bas}/api/flows/finns-inte`)).status).toBe(404);
    expect((await fetch(`${bas}/nagot`)).status).toBe(404);
  });

  /**
   * Prefixet ("2.2.7") är det som kopplar en scen till en processnod i
   * EA-portalen. Härleds det fel finns kopplingen inte, och en process visar
   * inget flödesschema utan att något går sönder synligt.
   */
  it.skipIf(!HAR_FLÖDEN)("härleder processprefixet ur namnet", async () => {
    const d = await (await fetch(`${bas}/api/flows`)).json();
    const ap = d.flows.filter((f: { familj: string }) => f.familj === "affarsprocess");
    expect(ap.length).toBeGreaterThan(0);
    const uthyrning = ap.find((f: { id: string }) => f.id.includes("uthyrning-av-nyproduktion"));
    expect(uthyrning?.prefix).toBe("2.2.7");
    // Portalflödena har ingen processnumrering och ska inte få ett påhittat prefix.
    const portal = d.flows.find((f: { familj: string }) => f.familj === "flodesschema");
    expect(portal?.prefix).toBeUndefined();
  });

  it("lämnar flows/ orört efter alla anrop", () => {
    expect(ögonblicksbild()).toEqual(FÖRE);
  });
});

/**
 * Publiceringen följer med i listan: plattformen speglar bara publicerade
 * flöden, och portalen kopplar flödet till noden på `eaNodId`. Körs mot en
 * egen katalog – innehållet i flows/ är inte testdata (invariant 12).
 */
describe("flödestjänsten och publiceringen", () => {
  let tjänst: http.Server;
  let adress: string;
  let katalog: string;

  beforeAll(async () => {
    katalog = fs.mkdtempSync(path.join(os.tmpdir(), "ark-pub-"));
    const flöde = (id: string, name: string, extra: object = {}) =>
      fs.writeFileSync(
        path.join(katalog, `${id}.json`),
        JSON.stringify({
          id,
          name,
          savedAt: "2026-10-08T00:00:00.000Z",
          rawText: "",
          draft: { diagramType: "affarsprocess", steps: [] },
          versions: [{ id: "v1", savedAt: "2026-10-08T00:00:00.000Z", status: "fastslagen", rawText: "", draft: {} }],
          ...extra,
        }),
      );
    flöde("ap-publicerad", "Ny process utan nummer", {
      publicering: {
        eaNodId: "nod-1",
        eaNodNamn: "4.4.5 Ny process",
        eaPrefix: "4.4.5",
        egenNod: true,
        ägare: "IT-chef",
        beskrivning: "Syftet.",
        publiceradAt: "2026-10-08T10:00:00.000Z",
      },
    });
    flöde("ap-opublicerad", "4.4.3 Incident");
    // En Systemprocess publicerad på en APPLIKATION i portalen.
    const draft = textToDraft("Ny beställning\nAnvändare → Fyller i formulär → System sparar beställningen");
    flöde("bestallning-ny", "Ny beställning", {
      draft,
      versions: [{ id: "v1", savedAt: "2026-10-08T00:00:00.000Z", status: "fastslagen", rawText: "", draft }],
      publicering: {
        eaNodId: "app-1",
        eaNodNamn: "Kundportalen",
        ägare: "Systemförvaltare",
        beskrivning: "Hur en beställning tar sig genom portalen.",
        publiceradAt: "2026-10-08T10:00:00.000Z",
      },
    });
    tjänst = http.createServer(skapaHanterare(katalog));
    await new Promise<void>((klar) => tjänst.listen(0, klar));
    const adr = tjänst.address();
    if (!adr || typeof adr === "string") throw new Error("ingen port");
    adress = `http://127.0.0.1:${adr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((klar) => tjänst.close(() => klar()));
    fs.rmSync(katalog, { recursive: true, force: true });
  });

  it("skickar med nod-id, ägare och beskrivning – och numret ur noden när namnet saknar det", async () => {
    const d = await (await fetch(`${adress}/api/flows`)).json();
    const pub = d.flows.find((f: { id: string }) => f.id === "ap-publicerad");
    expect(pub.publicering).toEqual({
      eaNodId: "nod-1",
      ägare: "IT-chef",
      beskrivning: "Syftet.",
      publiceradAt: "2026-10-08T10:00:00.000Z",
    });
    expect(pub.prefix).toBe("4.4.5");
    const opub = d.flows.find((f: { id: string }) => f.id === "ap-opublicerad");
    expect(opub.publicering).toBeUndefined();
    expect(opub.prefix).toBe("4.4.3");
  });

  it("ritar en scen också för en Systemprocess, och publiceringen följer med", async () => {
    const d = await (await fetch(`${adress}/api/flows`)).json();
    const sys = d.flows.find((f: { id: string }) => f.id === "bestallning-ny");
    expect(sys.familj).toBe("flodesschema");
    expect(sys.publicering.eaNodId).toBe("app-1");
    expect(sys.prefix).toBeUndefined();

    const r = await (await fetch(`${adress}/api/flows/bestallning-ny/scen`)).json();
    expect(r.ok).toBe(true);
    expect(r.scen.familj).toBe("flodesschema");
    expect(r.scen.noder.length).toBeGreaterThan(0);
    expect(r.scen.bakgrund).toContain("<rect");

    const svg = await fetch(`${adress}/api/flows/bestallning-ny/svg`);
    expect(svg.status).toBe(200);
    expect(await svg.text()).toMatch(/^<svg/);
  });
});
