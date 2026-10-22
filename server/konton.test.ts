/**
 * Lokala konton (ARK_AUTH=lokal): första besöket skapar administratören,
 * lösenorden lagras aldrig i klartext, gissningar spärras, och en
 * administratör sköter kontona – men kan inte låsa ute sig själv.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { skapaBrygga } from "./brygga";
import { skapaServer } from "./arkitekten.mjs";
import { installningarUrMiljö } from "./installningar";
import { Kontolager, hashaLösenord, stämmerLösenord } from "./konton";

let server: http.Server;
let bas: string;
let tmp: string;
const MILJÖ = { ...process.env };

/** En webbläsare i miniatyr: minns sessionskakan mellan anropen. */
function klient() {
  let kaka = "";
  return async (väg: string, init: RequestInit = {}) => {
    const res = await fetch(`${bas}${väg}`, {
      ...init,
      headers: { "content-type": "application/json", ...(kaka ? { cookie: kaka } : {}), ...(init.headers ?? {}) },
    });
    const satt = res.headers.get("set-cookie");
    if (satt) kaka = satt.split(";")[0];
    return { status: res.status, kropp: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
}
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "konton-"));
  fs.mkdirSync(path.join(tmp, "dist"));
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<!doctype html>");
  process.env.ARK_AUTH = "lokal";
  process.env.ARK_SESSION_SECRET = "x".repeat(40);
  for (const k of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ARK_BAS_URL"]) delete process.env[k];
  const inst = installningarUrMiljö(tmp, {});
  server = skapaServer(inst, skapaBrygga({ ...inst, logg: { info: () => {}, warn: () => {} }, laddaAi: () => Promise.reject(new Error()) }));
  await new Promise<void>((klar) => server.listen(0, klar));
  bas = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((klar) => server.close(() => klar()));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env = { ...MILJÖ };
});

describe("lösenorden", () => {
  it("lagras som saltad hash och prövas mot den", () => {
    const h = hashaLösenord("ett långt lösenord");
    expect(h).not.toContain("ett långt");
    expect(h).not.toBe(hashaLösenord("ett långt lösenord"));
    expect(stämmerLösenord("ett långt lösenord", h)).toBe(true);
    expect(stämmerLösenord("fel lösenord!!", h)).toBe(false);
  });
});

describe("inloggningen", () => {
  const admin = klient();
  const anna = klient();

  it("utan konton erbjuds första kontot, och det blir administratör", async () => {
    const me = await admin("/__ark/auth/me");
    expect(me.kropp).toMatchObject({ läge: "lokal", användare: null, förstaKonto: true });
    const kort = await admin("/__ark/auth/forsta", post({ användarnamn: "admin@example.org", namn: "Admin", lösenord: "kort" }));
    expect(kort.status).toBe(400);
    const ok = await admin("/__ark/auth/forsta", post({ användarnamn: "Admin@Example.org", namn: "Admin", lösenord: "ett långt lösenord" }));
    expect(ok.kropp.användare.roller).toContain("admin");
    expect((await admin("/__ark/auth/me")).kropp.användare.namn).toBe("Admin");
  });

  it("REGRESSION-skydd: första kontot går bara att skapa en gång", async () => {
    const igen = await klient()("/__ark/auth/forsta", post({ användarnamn: "x@example.org", namn: "X", lösenord: "ett långt lösenord" }));
    expect(igen.status).toBe(409);
  });

  it("filen bär aldrig lösenordet i klartext, och kontolistan aldrig hashen", async () => {
    const fil = fs.readFileSync(path.join(tmp, "konton.json"), "utf8");
    expect(fil).not.toContain("ett långt lösenord");
    const lista = await admin("/__ark/konton");
    expect(JSON.stringify(lista.kropp)).not.toContain("scrypt");
  });

  it("administratören lägger upp ett konto som sedan kan logga in", async () => {
    const skapat = await admin("/__ark/konton", post({ användarnamn: "anna@example.org", namn: "Anna", roll: "user", lösenord: "annas lösenord" }));
    expect(skapat.status).toBe(200);
    const fel = await anna("/__ark/auth/lokal", post({ användarnamn: "anna@example.org", lösenord: "fel lösenord" }));
    expect(fel.status).toBe(401);
    const ok = await anna("/__ark/auth/lokal", post({ användarnamn: "anna@example.org", lösenord: "annas lösenord" }));
    expect(ok.kropp.användare.roller).toEqual(["user"]);
    // En vanlig användare når inte kontona.
    expect((await anna("/__ark/konton")).status).toBe(403);
  });

  it("ett borttaget konto är utloggat direkt, och en ändrad roll gäller direkt", async () => {
    const id = (await admin("/__ark/konton")).kropp.konton.find((k: { användarnamn: string }) => k.användarnamn === "anna@example.org").id;
    await admin(`/__ark/konton/${id}`, { method: "PUT", body: JSON.stringify({ roll: "admin" }) });
    expect((await anna("/__ark/auth/me")).kropp.användare.roller).toContain("admin");
    await admin(`/__ark/konton/${id}`, { method: "DELETE" });
    expect((await anna("/__ark/auth/me")).kropp.användare).toBeNull();
  });

  it("administratören kan inte ta bort sig själv eller sin egen roll", async () => {
    const egen = (await admin("/__ark/auth/me")).kropp.användare.id;
    expect((await admin(`/__ark/konton/${egen}`, { method: "DELETE" })).status).toBe(400);
    expect((await admin(`/__ark/konton/${egen}`, { method: "PUT", body: JSON.stringify({ roll: "user" }) })).status).toBe(400);
  });

  it("gissningar spärras efter fem försök", async () => {
    const gissare = klient();
    for (let i = 0; i < 5; i++)
      expect((await gissare("/__ark/auth/lokal", post({ användarnamn: "admin@example.org", lösenord: `gissning ${i}xx` }))).status).toBe(401);
    const spärrad = await gissare("/__ark/auth/lokal", post({ användarnamn: "admin@example.org", lösenord: "ett långt lösenord" }));
    expect(spärrad.status).toBe(429);
  });

  it("den inloggade byter sitt lösenord, men bara med det nuvarande", async () => {
    expect((await admin("/__ark/auth/losenord", post({ nuvarande: "fel fel fel", nytt: "ett nytt långt lösenord" }))).status).toBe(401);
    expect((await admin("/__ark/auth/losenord", post({ nuvarande: "ett långt lösenord", nytt: "ett nytt långt lösenord" }))).status).toBe(200);
    const lager = new Kontolager(path.join(tmp, "konton.json"));
    const k = lager.alla().find((x) => x.användarnamn === "admin@example.org")!;
    expect(stämmerLösenord("ett nytt långt lösenord", k.lösenord)).toBe(true);
  });
});
