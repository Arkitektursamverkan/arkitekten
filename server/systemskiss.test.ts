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
