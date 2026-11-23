/**
 * Systemskisserna genom bryggan: alla läser och skapar, skaparen eller en
 * administratör ändrar – och en DOLD skiss finns bara för administratörer.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { skapaBrygga, type AiModuler } from "./brygga";
import { skapaServer } from "./arkitekten.mjs";
import { installningarUrMiljö } from "./installningar";

const MILJÖ = { ...process.env };
let server: http.Server;
let bas: string;
let tmp: string;

function klient() {
  let kakan = "";
  return async (väg: string, init: RequestInit = {}) => {
    const res = await fetch(`${bas}${väg}`, {
      ...init,
      headers: { "content-type": "application/json", ...(kakan ? { cookie: kakan } : {}), ...(init.headers ?? {}) },
    });
    const satt = res.headers.get("set-cookie");
    if (satt) kakan = satt.split(";")[0];
    let kropp: Record<string, any> = {};
    try {
      kropp = JSON.parse(await res.text());
    } catch {
      /* tomt svar */
    }
    return { status: res.status, kropp };
  };
}
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) });
const LÖSEN = "ett långt lösenord";
const låtsasAi = {} as unknown as AiModuler;

const admin = klient();
const anna = klient();
const bo = klient();
const utloggad = klient();

const skiss = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  namn: id,
  savedAt: "2020-01-01T00:00:00.000Z",
  objekt: [{ id: "o-1", sort: "server", namn: "Server", x: 0, y: 0, b: 170, h: 64 }],
  zoner: [],
  kopplingar: [],
  ...extra,
});
const fil = (id: string) => JSON.parse(fs.readFileSync(path.join(tmp, "skisser", `${id}.json`), "utf8"));

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skisser-"));
  fs.mkdirSync(path.join(tmp, "dist"));
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<!doctype html>");
  process.env.ARK_AUTH = "lokal";
  process.env.ARK_SESSION_SECRET = "s".repeat(40);
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
});

afterAll(async () => {
  await new Promise<void>((klar) => server.close(() => klar()));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env = { ...MILJÖ };
});

describe("systemskisser i bryggan", () => {
  it("kräver inloggning", async () => {
    expect((await utloggad("/__ark/skisser")).status).toBe(401);
    expect((await utloggad("/__ark/skisser/x", put(skiss("x")))).status).toBe(401);
  });

  it("alla inloggade skapar och läser; skaparen och tiden stämplas av servern", async () => {
    const svar = await anna("/__ark/skisser/annas", put(skiss("annas", { skapadAv: { id: "admin", namn: "Förfalskad" } })));
    expect(svar.status).toBe(200);
    expect(svar.kropp.skiss.skapadAv.namn).toBe("anna");
    expect(fil("annas").skapadAv.namn).toBe("anna");
    expect(fil("annas").savedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect((await bo("/__ark/skisser/annas")).kropp.skiss.objekt).toHaveLength(1);
    expect((await bo("/__ark/skisser")).kropp.skisser.map((s: any) => s.id)).toEqual(["annas"]);
  });

  it("bara skaparen eller en administratör ändrar och tar bort", async () => {
    expect((await bo("/__ark/skisser/annas", put(skiss("annas", { namn: "Bos nu" })))).status).toBe(403);
    expect((await bo("/__ark/skisser/annas", { method: "DELETE" })).status).toBe(403);
    expect(fil("annas").namn).toBe("annas");
    expect((await anna("/__ark/skisser/annas", put(skiss("annas", { namn: "Ny titel" })))).status).toBe(200);
    expect((await admin("/__ark/skisser/annas", put(skiss("annas", { namn: "Adminens titel" })))).status).toBe(200);
    // Skaparen står kvar när någon annan sparar.
    expect(fil("annas").skapadAv.namn).toBe("anna");
  });

  it("en användare kan inte dölja en skiss – flaggan tas bara från en administratör", async () => {
    expect((await anna("/__ark/skisser/annas", put(skiss("annas", { dold: true })))).status).toBe(200);
    expect(fil("annas").dold).toBeUndefined();
    expect((await anna("/__ark/skisser/annas-nya", put(skiss("annas-nya", { dold: true })))).kropp.skiss.dold).toBeUndefined();
  });

  it("en dold skiss finns bara för administratörer: inte i listan, 404 på allt", async () => {
    expect((await admin("/__ark/skisser/hemlig", put(skiss("hemlig", { dold: true })))).status).toBe(200);
    expect(fil("hemlig").dold).toBe(true);
    expect((await admin("/__ark/skisser")).kropp.skisser.map((s: any) => s.id)).toContain("hemlig");
    expect((await anna("/__ark/skisser")).kropp.skisser.map((s: any) => s.id)).not.toContain("hemlig");
    expect((await anna("/__ark/skisser/hemlig")).status).toBe(404);
    expect((await anna("/__ark/skisser/hemlig", put(skiss("hemlig")))).status).toBe(404);
    expect((await anna("/__ark/skisser/hemlig", { method: "DELETE" })).status).toBe(404);
    expect(fil("hemlig").skapadAv.namn).toBe("Admin");
  });

  it("administratören döljer en annans skiss – då ser inte ens skaparen den – och visar den igen", async () => {
    expect((await admin("/__ark/skisser/annas", put(skiss("annas", { dold: true })))).status).toBe(200);
    expect((await anna("/__ark/skisser/annas")).status).toBe(404);
    expect((await admin("/__ark/skisser/annas", put(skiss("annas")))).status).toBe(200);
    expect((await anna("/__ark/skisser/annas")).status).toBe(200);
  });

  it("det som skrivs till fil är byggt fält för fält – okänt och farligt faller bort", async () => {
    const elak = skiss("elak", { extra: "<script>", objekt: [{ id: "o-1", sort: "<svg>", namn: "A", x: "<script>", y: 0, b: 170, h: 64 }] });
    expect((await anna("/__ark/skisser/elak", put(elak))).status).toBe(200);
    expect(JSON.stringify(fil("elak"))).not.toContain("<s");
    expect(fil("elak").objekt[0]).toMatchObject({ sort: "server", x: 0 });
  });

  it("id:t i kroppen ska vara adressens, och id:t ska vara filnamnssäkert", async () => {
    expect((await anna("/__ark/skisser/ett", put(skiss("annat")))).status).toBe(400);
    expect((await anna("/__ark/skisser/..%2Fx", put(skiss("x")))).status).toBe(400);
    expect((await anna("/__ark/skisser/utan-namn", put({ id: "utan-namn" }))).status).toBe(400);
  });

  it("skaparen tar bort sin skiss", async () => {
    expect((await anna("/__ark/skisser/annas-nya", { method: "DELETE" })).status).toBe(200);
    expect(fs.existsSync(path.join(tmp, "skisser", "annas-nya.json"))).toBe(false);
  });
});

describe("publicering på en server i portalen", () => {
  const pub = { eaNodId: "11111111-2222-3333-4444-555555555555", servernamn: "Servern", publiceradAt: "2001-01-01T00:00:00.000Z" };

  it("bara en administratör publicerar – en användares begäran ändrar ingenting", async () => {
    expect((await anna("/__ark/skisser/annas", put(skiss("annas", { publicering: pub })))).status).toBe(200);
    expect(fil("annas").publicering).toBeUndefined();
    expect((await admin("/__ark/skisser/annas", put(skiss("annas", { publicering: pub })))).status).toBe(200);
    expect(fil("annas").publicering.eaNodId).toBe(pub.eaNodId);
    // Tidpunkten är serverns, och står still när samma server sparas igen.
    const t = fil("annas").publicering.publiceradAt;
    expect(t).not.toBe(pub.publiceradAt);
    expect((await admin("/__ark/skisser/annas", put(skiss("annas", { publicering: pub })))).status).toBe(200);
    expect(fil("annas").publicering.publiceradAt).toBe(t);
    // Skaparen sparar om utan fältet: publiceringen står kvar.
    expect((await anna("/__ark/skisser/annas", put(skiss("annas")))).status).toBe(200);
    expect(fil("annas").publicering.eaNodId).toBe(pub.eaNodId);
    // Administratören tar bort den.
    expect((await admin("/__ark/skisser/annas", put(skiss("annas")))).status).toBe(200);
    expect(fil("annas").publicering).toBeUndefined();
  });
});

describe("versionerna", () => {
  it("varje ändring blir en version, historiken byggs ur FILEN och en äldre version skrivs aldrig om", async () => {
    expect((await anna("/__ark/skisser/vers", put(skiss("vers")))).status).toBe(200);
    expect(fil("vers").versioner).toHaveLength(1);
    expect(fil("vers").versioner[0]).toMatchObject({ id: "v1", status: "utkast", savedBy: "anna" });
    // Samma innehåll igen: ingen ny version.
    expect((await anna("/__ark/skisser/vers", put(skiss("vers")))).status).toBe(200);
    expect(fil("vers").versioner).toHaveLength(1);
    // REGRESSION-skydd: en begäran som bär en egen, förfalskad historik ändrar ingenting i den.
    const förfalskad = [{ id: "v1", savedAt: "2001-01-01T00:00:00.000Z", status: "fastslagen", innehåll: { namn: "Fejk", objekt: [], zoner: [], kopplingar: [] } }];
    expect((await anna("/__ark/skisser/vers", put(skiss("vers", { namn: "Andra", versioner: förfalskad })))).status).toBe(200);
    const v = fil("vers").versioner;
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ status: "utkast", innehåll: { namn: "vers" } });
    expect(v[1].innehåll.namn).toBe("Andra");
  });

  it("fastslå utan ändring ger en ny huvudversion med kommentar; listan bär beteckningen", async () => {
    expect((await anna("/__ark/skisser/vers", put({ ...skiss("vers", { namn: "Andra" }), sparval: { status: "fastslagen", label: "Granskad" } }))).status).toBe(200);
    const v = fil("vers").versioner;
    expect(v).toHaveLength(3);
    expect(v[2]).toMatchObject({ status: "fastslagen", label: "Granskad" });
    const rad = (await anna("/__ark/skisser")).kropp.skisser.find((s: any) => s.id === "vers");
    expect(rad).toMatchObject({ status: "fastslagen", beteckning: "1.0" });
  });

  it("en skiss från före versionerna behåller sitt innehåll som v1 när den sparas", async () => {
    fs.writeFileSync(path.join(tmp, "skisser", "gammal.json"), JSON.stringify({ ...skiss("gammal"), skapadAv: { id: "x", namn: "anna" } }));
    const före = (await admin("/__ark/skisser/gammal")).kropp.skiss;
    expect(före.versioner).toBeUndefined();
    expect((await admin("/__ark/skisser/gammal", put(skiss("gammal", { namn: "Ny" })))).status).toBe(200);
    const v = fil("gammal").versioner;
    expect(v.map((x: any) => x.innehåll.namn)).toEqual(["gammal", "Ny"]);
    expect(v[0].savedAt).toBe("2020-01-01T00:00:00.000Z");
    expect(v[0].savedBy).toBeUndefined();
  });
});

describe("informationsklassning", () => {
  const stilar = () => path.join(tmp, "stilar");
  const eget = {
    på: true,
    modell: { id: "egen", namn: "Vår modell", nivåer: [{ namn: "Öppen", djup: 0 }, { namn: "Skyddad", djup: 0 }, { namn: "Skyddad A", djup: 1 }] },
    visaIExport: true,
    visaIVyn: false,
  };

  it("är av som förval; bara en administratör ändrar inställningen", async () => {
    expect((await anna("/__ark/klassning")).kropp.klassning.på).toBe(false);
    expect((await anna("/__ark/klassning", put(eget))).status).toBe(403);
    const svar = await admin("/__ark/klassning", put(eget));
    expect(svar.status).toBe(200);
    expect(svar.kropp.klassning.modell.nivåer.map((n: any) => [n.id, n.djup])).toEqual([["oppen", 0], ["skyddad", 0], ["skyddad-a", 1]]);
    expect((await anna("/__ark/klassning")).kropp.klassning).toMatchObject({ på: true, visaIVyn: false });
    // Filen är ingen symbolstil.
    expect((await admin("/__ark/symbolstilar")).kropp.fel).toEqual([]);
    expect(fs.existsSync(path.join(stilar(), "klassning.json"))).toBe(true);
  });

  it("skissens nivå prövas mot modellen och stämplas av servern – ingen ny version", async () => {
    const före = fil("vers").versioner.length;
    expect((await anna("/__ark/skisser/vers", put(skiss("vers", { namn: "Andra", klassning: { nivå: "finns-inte", namn: "X" } })))).status).toBe(400);
    const svar = await anna("/__ark/skisser/vers", put(skiss("vers", { namn: "Andra", klassning: { nivå: "skyddad-a", namn: "fel namn", sattAv: "Någon annan" } })));
    expect(svar.status).toBe(200);
    expect(fil("vers").klassning).toMatchObject({ nivå: "skyddad-a", namn: "Skyddad A", sattAv: "anna" });
    expect(fil("vers").versioner.length).toBe(före);
    expect((await anna("/__ark/skisser")).kropp.skisser.find((s: any) => s.id === "vers").klassning.nivå).toBe("skyddad-a");
  });

  it("en process klassas via sin egen väg; en vanlig sparning kan varken sätta eller tappa nivån", async () => {
    const flöde = {
      id: "ap-klassad",
      name: "Klassad",
      savedAt: "2020-01-01T00:00:00.000Z",
      rawText: "a",
      draft: { title: "Klassad", lanes: [], steps: [] },
      versions: [{ id: "v1", savedAt: "2020-01-01T00:00:00.000Z", rawText: "a", draft: { title: "Klassad", lanes: [], steps: [] } }],
    };
    expect((await admin("/__ark/flows/ap-klassad", put(flöde))).status).toBe(200);
    // Anna får inte ändra processen (den ligger inte i hennes katalog): 403 eller 404.
    expect((await anna("/__ark/flows/ap-klassad/klassning", put({ klassning: { nivå: "oppen" } }))).status).toBeGreaterThanOrEqual(403);
    const svar = await admin("/__ark/flows/ap-klassad/klassning", put({ klassning: { nivå: "skyddad" } }));
    expect(svar.status).toBe(200);
    expect(svar.kropp.flow.klassning).toMatchObject({ nivå: "skyddad", namn: "Skyddad", sattAv: "Admin" });
    const lagrad = () => JSON.parse(fs.readFileSync(path.join(tmp, "flows", "ap-klassad.json"), "utf8"));
    expect(lagrad().versions).toHaveLength(1);
    // En vanlig sparning utan fältet – eller med ett annat – rör inte klassningen.
    expect((await admin("/__ark/flows/ap-klassad", put({ ...lagrad(), klassning: { nivå: "oppen", namn: "Öppen" } }))).status).toBe(200);
    expect(lagrad().klassning.nivå).toBe("skyddad");
    const { klassning: _k, ...utan } = lagrad();
    expect((await admin("/__ark/flows/ap-klassad", put(utan))).status).toBe(200);
    expect(lagrad().klassning.nivå).toBe("skyddad");
    expect((await admin("/__ark/flows/ap-klassad/klassning", { method: "DELETE" })).status).toBe(200);
    expect(lagrad().klassning).toBeUndefined();
  });

  it("avstängd klassning: det som står i filen står kvar, och processvägen svarar 409", async () => {
    expect((await admin("/__ark/klassning", put({ ...eget, på: false }))).status).toBe(200);
    expect((await anna("/__ark/skisser/vers", put(skiss("vers", { namn: "Andra" })))).status).toBe(200);
    expect(fil("vers").klassning.nivå).toBe("skyddad-a");
    expect((await admin("/__ark/flows/ap-klassad/klassning", put({ klassning: { nivå: "skyddad" } }))).status).toBe(409);
  });
});

describe("skyddsklasser – klassningen styr vem som ser vad", () => {
  const modell = {
    id: "egen",
    namn: "Vår modell",
    nivåer: [{ namn: "Öppen", djup: 0 }, { namn: "Skyddad", djup: 0 }, { namn: "Skyddad A", djup: 1 }],
  };
  const inst = {
    på: true,
    modell,
    visaIExport: false,
    visaIVyn: true,
    skyddsklasser: [{ namn: "Känsliga", nivåer: ["skyddad", "skyddad-a"], behöriga: [" Bo@Example.org "] }],
  };
  const flödesfil = (id: string) => path.join(tmp, "flows", `${id}.json`);

  beforeAll(async () => {
    expect((await admin("/__ark/klassning", put(inst))).status).toBe(200);
  });

  it("listan över behöriga ser bara administratören; var och en ser sina egna klasser", async () => {
    const adm = (await admin("/__ark/klassning")).kropp;
    expect(adm.klassning.skyddsklasser).toEqual([
      { id: "kansliga", namn: "Känsliga", nivåer: ["skyddad", "skyddad-a"], behöriga: ["bo@example.org"] },
    ]);
    const a = (await anna("/__ark/klassning")).kropp;
    expect(a.klassning.skyddsklasser[0].behöriga).toEqual([]);
    expect(a.mina).toEqual([]);
    expect((await bo("/__ark/klassning")).kropp.mina).toEqual(["kansliga"]);
    // Klareringen följer med användaren – appen gömmer det bryggan vägrar.
    expect((await anna("/__ark/auth/me")).kropp.användare.klarering).toEqual(["oppen"]);
    expect((await bo("/__ark/auth/me")).kropp.användare.klarering).toEqual(["oppen", "skyddad", "skyddad-a"]);
    expect((await admin("/__ark/auth/me")).kropp.användare.klarering).toBeUndefined();
  });

  it("en klassad skiss finns inte för den som saknar klassen – inte ens för den som skapade den", async () => {
    // "vers" skapades av Anna och klassades "Skyddad A" ovan.
    expect(fil("vers").klassning.nivå).toBe("skyddad-a");
    expect((await anna("/__ark/skisser")).kropp.skisser.map((s: any) => s.id)).not.toContain("vers");
    expect((await anna("/__ark/skisser/vers")).status).toBe(404);
    expect((await anna("/__ark/skisser/vers", put(skiss("vers", { namn: "Över" })))).status).toBe(404);
    expect((await anna("/__ark/skisser/vers", { method: "DELETE" })).status).toBe(404);
    expect((await bo("/__ark/skisser")).kropp.skisser.map((s: any) => s.id)).toContain("vers");
    expect((await bo("/__ark/skisser/vers")).status).toBe(200);
    expect((await admin("/__ark/skisser/vers")).status).toBe(200);
  });

  it("man väljer bara en nivå man själv får se", async () => {
    expect((await anna("/__ark/skisser/annas", put(skiss("annas")))).status).toBe(200);
    const nej = await anna("/__ark/skisser/annas", put(skiss("annas", { klassning: { nivå: "skyddad" } })));
    expect(nej.status).toBe(403);
    expect(fil("annas").klassning).toBeUndefined();
    expect((await anna("/__ark/skisser/annas", put(skiss("annas", { klassning: { nivå: "oppen" } })))).status).toBe(200);
    expect(fil("annas").klassning.nivå).toBe("oppen");
  });

  it("en klassad process: borta ur listan, 404 att hämta – för den utan klassen", async () => {
    expect((await admin("/__ark/klassning", put(inst))).status).toBe(200);
    // Till den gemensamma katalogen, som alla läser – utom det klassningen skär av.
    expect((await admin("/__ark/flows/ap-klassad/yta", post({ till: "gemensam" }))).status).toBe(200);
    expect((await admin("/__ark/flows/ap-klassad/klassning", put({ klassning: { nivå: "oppen" } }))).status).toBe(200);
    expect((await anna("/__ark/flows/ap-klassad")).status).toBe(200);
    expect((await admin("/__ark/flows/ap-klassad/klassning", put({ klassning: { nivå: "skyddad" } }))).status).toBe(200);
    const ids = async (k: typeof anna) => (await k("/__ark/flows")).kropp.flows.map((f: any) => f.id);
    expect(await ids(anna)).not.toContain("ap-klassad");
    expect((await anna("/__ark/flows/ap-klassad")).status).toBe(404);
    expect(await ids(bo)).toContain("ap-klassad");
    expect((await bo("/__ark/flows/ap-klassad")).status).toBe(200);
    // Katalogen bär nivån.
    expect((await bo("/__ark/flows")).kropp.flows.find((f: any) => f.id === "ap-klassad").klassning.nivå).toBe("skyddad");
  });

  it("en nivå som inte finns i modellen ser bara administratören", async () => {
    const f = JSON.parse(fs.readFileSync(flödesfil("ap-klassad"), "utf8"));
    fs.writeFileSync(flödesfil("ap-klassad"), JSON.stringify({ ...f, klassning: { ...f.klassning, nivå: "borttagen" } }));
    expect((await bo("/__ark/flows/ap-klassad")).status).toBe(404);
    expect((await admin("/__ark/flows/ap-klassad")).status).toBe(200);
  });

  it("en ändrad skyddsklass gäller från nästa begäran", async () => {
    expect((await anna("/__ark/skisser/vers")).status).toBe(404);
    const medAnna = { ...inst, skyddsklasser: [{ ...inst.skyddsklasser[0], behöriga: ["anna@example.org"] }] };
    expect((await admin("/__ark/klassning", put(medAnna))).status).toBe(200);
    expect((await anna("/__ark/skisser/vers")).status).toBe(200);
    expect((await bo("/__ark/skisser/vers")).status).toBe(404);
    // Avstängd klassning begränsar ingenting.
    expect((await admin("/__ark/klassning", put({ ...inst, på: false }))).status).toBe(200);
    expect((await bo("/__ark/skisser/vers")).status).toBe(200);
  });
});
