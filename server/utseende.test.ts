/**
 * Organisationens utseende: miljön vinner fält för fält, portalen fyller i
 * resten, och en portal som inte svarar hindrar aldrig något.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logoUrFil, skapaUtseende } from "./utseende";
import type { EaKonfig } from "./ea-portal";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "utseende-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** En falsk portal som räknar anropen; `svar` null = portalen är nere. */
function portal(svar: Record<string, unknown> | null, logo: Buffer | null = PNG) {
  const anrop: string[] = [];
  const f = (async (url: string) => {
    const väg = url.replace("http://ea/api/v1", "");
    anrop.push(väg);
    if (svar === null) throw new Error("nere");
    if (väg === "/org-settings/public") return new Response(JSON.stringify(svar), { status: 200 });
    if (väg === "/org-settings/logo" && logo)
      return new Response(new Uint8Array(logo), { status: 200, headers: { "content-type": "image/png" } });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const k: EaKonfig = { url: "http://ea/api/v1", nyckel: "hemlig", fetch: f };
  return { k, anrop };
}

describe("organisationens utseende", () => {
  it("utan miljö och portal finns inget – skalet visar Arkitektens eget", async () => {
    const u = skapaUtseende({}, null);
    expect(await u.utseende()).toEqual({});
    expect(await u.logo()).toBeNull();
  });

  it("portalens namn, färg och logotyp används när miljön inte anger dem", async () => {
    const { k } = portal({ org_name: "Provkommunen", org_short_name: "PK", brand_color: "#123abc", logo_version: "17" });
    const u = skapaUtseende({}, k);
    expect(await u.utseende()).toEqual({ namn: "Provkommunen", kortnamn: "PK", färg: "#123abc", logoVersion: "p17" });
    expect((await u.logo())?.typ).toBe("image/png");
  });

  it("miljön vinner fält för fält", async () => {
    const fil = path.join(tmp, "logo.png");
    fs.writeFileSync(fil, PNG);
    const { k } = portal({ org_name: "Portalens namn", brand_color: "#000000", logo_version: "1" });
    const u = skapaUtseende({ ARK_ORG_NAMN: "Eget namn", ARK_ORG_LOGO: fil }, k);
    const v = await u.utseende();
    expect(v.namn).toBe("Eget namn");
    expect(v.färg).toBe("#000000");
    expect(v.logoVersion).toMatch(/^m/);
    expect((await u.logo())?.data.equals(PNG)).toBe(true);
  });

  it("med allt i miljön frågas portalen aldrig", async () => {
    const fil = path.join(tmp, "logo2.png");
    fs.writeFileSync(fil, PNG);
    const { k, anrop } = portal({ org_name: "x" });
    const u = skapaUtseende({ ARK_ORG_NAMN: "A", ARK_ORG_FARG: "#111111", ARK_ORG_LOGO: fil }, k);
    await u.utseende();
    await u.logo();
    expect(anrop).toEqual([]);
  });

  it("portalens svar sparas en stund i stället för att läsas vid varje besök", async () => {
    let tid = 0;
    const { k, anrop } = portal({ org_name: "Provkommunen" });
    const u = skapaUtseende({}, k, () => tid);
    await u.utseende();
    await u.utseende();
    expect(anrop).toEqual(["/org-settings/public"]);
    tid = 10 * 60 * 1000;
    await u.utseende();
    expect(anrop).toEqual(["/org-settings/public", "/org-settings/public"]);
  });

  it("en portal som inte svarar ger inget utseende – och inget fel", async () => {
    const { k } = portal(null);
    const u = skapaUtseende({ ARK_ORG_NAMN: "Eget" }, k);
    expect(await u.utseende()).toEqual({ namn: "Eget" });
    expect(await u.logo()).toBeNull();
  });

  it("en färg som inte är #RRGGBB och en fil som inte är en bild används inte", async () => {
    const txt = path.join(tmp, "logo.txt");
    fs.writeFileSync(txt, "inte en bild");
    expect(logoUrFil(txt)).toBeNull();
    expect(logoUrFil(path.join(tmp, "finns-inte.png"))).toBeNull();
    const u = skapaUtseende({ ARK_ORG_FARG: "red; background: url(x)" }, null);
    expect(await u.utseende()).toEqual({});
  });
});
