/**
 * Mallen för BMT-exporten genom bryggan: en administratör laddar upp den
 * under Inställningar, servern prövar filen med exportens läsare, och alla
 * inloggade får exporten när mallen finns. En mall ur miljön (ARK_BMT_MALL)
 * vinner och rörs aldrig av uppladdningen.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { packaZip } from "../src/core/zip";
import { BMT_MALLFIL } from "./bmt-mall";
import { skapaBrygga, type AiModuler } from "./brygga";
import { skapaServer } from "./arkitekten.mjs";
import { installningarUrMiljö } from "./installningar";

const MILJÖ = { ...process.env };
const NS = "urn:exempel:mt-export";
const SPRÅK = "11111111-2222-4333-8444-555555555555";
const LÖSEN = "ett långt lösenord";
let server: http.Server;
let bas: string;
let tmp: string;
let stilar: string;

function klient() {
  let kakan = "";
  return async (väg: string, init: RequestInit = {}) => {
    const res = await fetch(`${bas}${väg}`, {
      ...init,
      headers: { "content-type": "application/json", ...(kakan ? { cookie: kakan } : {}), ...(init.headers ?? {}) },
    });
    const satt = res.headers.get("set-cookie");
    if (satt) kakan = satt.split(";")[0];
    const data = Buffer.from(await res.arrayBuffer());
    let kropp: Record<string, any> = {};
    try {
      kropp = JSON.parse(data.toString("utf8"));
    } catch {
      /* binärt eller tomt svar */
    }
    return { status: res.status, kropp, data };
  };
}
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
/** Uppladdningen som appen skickar den: binärt, med appens eget ursprung. */
const laddaUpp = (data: Uint8Array, ursprung = bas) => ({
  method: "PUT",
  headers: { "content-type": "application/octet-stream", ...(ursprung ? { origin: ursprung } : {}) },
  body: data as BodyInit,
});
/** Borttagningen – samma väg, så också den bär appens ursprung. */
const taBort = () => ({ method: "DELETE", headers: { origin: bas } });

const admin = klient();
const anna = klient();
const utloggad = klient();

const mall = (filer: Record<string, string> = {}) =>
  packaZip({
    [`languages/${SPRÅK}.xml`]: `<mt-language xmlns="${NS}" uuid="${SPRÅK}"><title>Svenska</title></mt-language>`,
    "config.xml": "<repository-profile/>",
    "models/schema.xsd": `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${NS}"/>`,
    ...filer,
  });

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bmt-mall-"));
  fs.mkdirSync(path.join(tmp, "dist"));
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<!doctype html>");
  process.env.ARK_AUTH = "lokal";
  process.env.ARK_SESSION_SECRET = "s".repeat(40);
  for (const k of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ARK_BAS_URL", "SETUP_CODE", "ARK_UTVECKLARLAGE", "ARK_BETRODD_PROXY", "ARK_DIR", "ARK_BMT_MALL"])
    delete process.env[k];
  const inst = installningarUrMiljö(tmp, {});
  stilar = inst.stilarDir;
  server = skapaServer(inst, skapaBrygga({ ...inst, logg: { info: () => {}, warn: () => {} }, laddaAi: async () => ({}) as unknown as AiModuler }));
  await new Promise<void>((klar) => server.listen(0, klar));
  bas = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await admin("/__ark/auth/forsta", post({ användarnamn: "admin@example.org", namn: "Admin", lösenord: LÖSEN }));
  await admin("/__ark/konton", post({ användarnamn: "anna@example.org", namn: "anna", roll: "user", lösenord: LÖSEN }));
  expect((await anna("/__ark/auth/lokal", post({ användarnamn: "anna@example.org", lösenord: LÖSEN }))).status).toBe(200);
});

afterAll(async () => {
  await new Promise<void>((klar) => server.close(() => klar()));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env = { ...MILJÖ };
});

afterEach(() => {
  delete process.env.ARK_BMT_MALL;
  fs.rmSync(path.join(stilar, BMT_MALLFIL), { force: true });
});

describe("mallen för BMT-exporten under Inställningar", () => {
  it("utan mall är exporten av, och administratören ser att ingen finns", async () => {
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(false);
    expect((await anna("/__ark/bmt/mall")).status).toBe(404);
    expect((await admin("/__ark/bmt/mall/info")).kropp.mall).toEqual({ källa: null });
  });

  it("en uppladdad mall slår på exporten för alla, utan omstart", async () => {
    const data = await mall();
    const svar = await admin("/__ark/bmt/mall", laddaUpp(data));
    expect(svar.status).toBe(200);
    expect(svar.kropp.mall).toMatchObject({ källa: "uppladdad", storlek: data.length });
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(true);
    // Det exporten hämtar är filen som laddades upp, byte för byte.
    expect(Buffer.compare((await anna("/__ark/bmt/mall")).data, Buffer.from(data))).toBe(0);
  });

  it("borttagen mall stänger av exporten igen", async () => {
    await admin("/__ark/bmt/mall", laddaUpp(await mall()));
    const svar = await admin("/__ark/bmt/mall", taBort());
    expect(svar.kropp.mall).toEqual({ källa: null });
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(false);
  });

  it("bara en administratör laddar upp, tar bort och ser var mallen kommer ifrån", async () => {
    const data = await mall();
    expect((await anna("/__ark/bmt/mall", laddaUpp(data))).status).toBe(403);
    expect((await anna("/__ark/bmt/mall/info")).status).toBe(403);
    expect((await utloggad("/__ark/bmt/mall", laddaUpp(data))).status).toBe(401);
    await admin("/__ark/bmt/mall", laddaUpp(data));
    const nekad = await anna("/__ark/bmt/mall", taBort());
    expect(nekad.status).toBe(403);
    expect(nekad.kropp.error).toContain("administratörsbehörighet");
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(true);
  });

  it("en fil som exporten inte kan bygga på avvisas och sparas inte", async () => {
    const inteZip = await admin("/__ark/bmt/mall", laddaUpp(new TextEncoder().encode("hej, jag är ingen modellexport")));
    expect(inteZip.status).toBe(400);
    expect(inteZip.kropp.error).toContain("zip-arkiv");
    // Ett zip-arkiv, men ingen modellexport: modellschemat saknas.
    const fel = await admin("/__ark/bmt/mall", laddaUpp(await packaZip({ "a.txt": "hej" })));
    expect(fel.status).toBe(400);
    expect(fel.kropp.error).toContain("går inte att använda som mall");
    expect((await admin("/__ark/bmt/mall", laddaUpp(new Uint8Array()))).status).toBe(400);
    expect(fs.existsSync(path.join(stilar, BMT_MALLFIL))).toBe(false);
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(false);
  });

  it("en avvisad fil rör inte mallen som redan gäller", async () => {
    const data = await mall();
    await admin("/__ark/bmt/mall", laddaUpp(data));
    expect((await admin("/__ark/bmt/mall", laddaUpp(await packaZip({ "a.txt": "hej" })))).status).toBe(400);
    expect(Buffer.compare((await anna("/__ark/bmt/mall")).data, Buffer.from(data))).toBe(0);
  });

  it("uppladdningen kräver appens eget ursprung (CSRF)", async () => {
    const data = await mall();
    expect((await admin("/__ark/bmt/mall", laddaUpp(data, "https://annan.example.org"))).status).toBe(403);
    expect((await admin("/__ark/bmt/mall", laddaUpp(data, ""))).status).toBe(403);
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(false);
  });

  it("mallen ur miljön vinner, och den rörs aldrig härifrån", async () => {
    const egen = path.join(tmp, "egen.bmt");
    const egenData = await mall({ "egen.txt": "installationens" });
    fs.writeFileSync(egen, egenData);
    await admin("/__ark/bmt/mall", laddaUpp(await mall()));
    process.env.ARK_BMT_MALL = egen;
    const info = (await admin("/__ark/bmt/mall/info")).kropp.mall;
    expect(info).toMatchObject({ källa: "miljö", storlek: egenData.length });
    // Aldrig serverns sökväg i svaret.
    expect(JSON.stringify(info)).not.toContain(tmp);
    expect(Buffer.compare((await anna("/__ark/bmt/mall")).data, Buffer.from(egenData))).toBe(0);
    await admin("/__ark/bmt/mall", taBort());
    expect(fs.existsSync(egen)).toBe(true);
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(true);
  });

  it("pekar miljön på en fil som inte går att läsa gäller den uppladdade", async () => {
    process.env.ARK_BMT_MALL = path.join(tmp, "finns-inte.bmt");
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(false);
    await admin("/__ark/bmt/mall", laddaUpp(await mall()));
    expect((await admin("/__ark/bmt/mall/info")).kropp.mall.källa).toBe("uppladdad");
    expect((await anna("/__ark/status")).kropp.bmtMall).toBe(true);
  });
});
