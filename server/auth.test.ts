import { describe, expect, it } from "vitest";
import {
  authKonfigUrMiljö,
  avslutaInloggning,
  användareUrIdToken,
  devAnvändare,
  läsSession,
  påbörjaInloggning,
  rollerFör,
  skapaSession,
  säkerTillbaka,
  verifiera,
  signera,
  SESSION_KAKA,
  type EntraKonfig,
} from "./auth";

const k: EntraKonfig = {
  läge: "entra",
  tenantId: "t1",
  clientId: "c1",
  clientSecret: "s",
  basUrl: "https://arkitekten.example.org",
  adminRoller: ["arkitekten.admin"],
  adminGrupper: ["9f1c0000-0000-0000-0000-000000000001"],
  adminKonton: ["admin@example.org"],
};
const HEMLIG = "hemlig";
const nu = Date.UTC(2026, 9, 14, 12);
const jwt = (c: object) => `x.${Buffer.from(JSON.stringify(c)).toString("base64url")}.y`;
const giltig = (extra: object = {}) => ({
  iss: "https://login.microsoftonline.com/t1/v2.0",
  aud: "c1",
  exp: nu / 1000 + 3600,
  nonce: "n",
  oid: "oid-1",
  name: "Test Testsson",
  preferred_username: "test@example.org",
  ...extra,
});

describe("konfigurationen", () => {
  it("utan Entra-uppgifter är driften öppen, som före inloggningen", () => {
    expect(authKonfigUrMiljö({}).läge).toBe("öppen");
  });
  it("med alla tre uppgifterna slås Entra på", () => {
    const c = authKonfigUrMiljö({ ENTRA_TENANT_ID: "t", ENTRA_CLIENT_ID: "c", ENTRA_CLIENT_SECRET: "s" });
    expect(c.läge).toBe("entra");
  });
  it("ARK_AUTH=auto: Entra med alla uppgifterna, annars egna konton – aldrig öppen", () => {
    const entra = authKonfigUrMiljö({ ARK_AUTH: "auto", ENTRA_TENANT_ID: "t", ENTRA_CLIENT_ID: "c", ENTRA_CLIENT_SECRET: "s" });
    expect(entra.läge).toBe("entra");
    expect(authKonfigUrMiljö({ ARK_AUTH: "auto", ENTRA_TENANT_ID: "t", ENTRA_CLIENT_ID: "c" }).läge).toBe("lokal");
    expect(authKonfigUrMiljö({ ARK_AUTH: "auto", ARK_BAS_URL: "https://ark.example.org/" })).toEqual({ läge: "lokal", basUrl: "https://ark.example.org" });
  });
  it("administratörerna kan komma från BOOTSTRAP_ADMIN_EMAILS, som i portalen", () => {
    const c = authKonfigUrMiljö({ ENTRA_TENANT_ID: "t", ENTRA_CLIENT_ID: "c", ENTRA_CLIENT_SECRET: "s", BOOTSTRAP_ADMIN_EMAILS: "Anna@example.org" });
    expect(c.läge === "entra" && c.adminKonton).toEqual(["anna@example.org"]);
  });
  it("REGRESSION: ARK_AUTH=entra med en saknad uppgift får inte falla tillbaka till öppen drift", () => {
    expect(authKonfigUrMiljö({ ARK_AUTH: "entra", ENTRA_TENANT_ID: "t" }).läge).toBe("entra");
  });
});

describe("sessionen", () => {
  it("en signerad kaka läses tillbaka, en ändrad avvisas", () => {
    const s = signera({ a: 1 }, HEMLIG);
    expect(verifiera(s, HEMLIG)).toEqual({ a: 1 });
    expect(verifiera(s.replace(/^./, "A"), HEMLIG)).toBeNull();
    expect(verifiera(s, "annan")).toBeNull();
  });
  it("en utgången session gäller inte", () => {
    const u = devAnvändare("Test Testsson", "user");
    const kaka = `${SESSION_KAKA}=${encodeURIComponent(skapaSession(u, HEMLIG, nu))}`;
    expect(läsSession(kaka, HEMLIG, nu)?.namn).toBe("Test Testsson");
    expect(läsSession(kaka, HEMLIG, nu + 11 * 3600_000)).toBeNull();
  });
  it("tillbaka-adressen är alltid en lokal väg (ingen öppen omdirigering)", () => {
    expect(säkerTillbaka("/#/process/x")).toBe("/#/process/x");
    expect(säkerTillbaka("//ond.se")).toBe("/");
    expect(säkerTillbaka("https://ond.se")).toBe("/");
  });
});

describe("id-token", () => {
  it("ger användaren med oid som id", () => {
    const u = användareUrIdToken(k, giltig(), "n", nu);
    expect(u).toMatchObject({ id: "oid-1", namn: "Test Testsson", epost: "test@example.org", roller: ["user"] });
  });
  it("avvisar fel tenant, fel app, fel nonce och utgången token", () => {
    expect(() => användareUrIdToken(k, giltig({ iss: "https://login.microsoftonline.com/annan/v2.0" }), "n", nu)).toThrow(/utfärdare/);
    expect(() => användareUrIdToken(k, giltig({ aud: "annan" }), "n", nu)).toThrow(/annan app/);
    expect(() => användareUrIdToken(k, giltig(), "fel", nu)).toThrow(/inloggningen/);
    expect(() => användareUrIdToken(k, giltig({ exp: nu / 1000 - 3600 }), "n", nu)).toThrow(/gått ut/);
  });
  it("approllen eller ARK_ADMINS ger admin", () => {
    expect(rollerFör(k, ["Arkitekten.Admin"], ["x"])).toContain("admin");
    expect(rollerFör(k, [], ["oid", "Admin@example.org"])).toContain("admin");
    expect(rollerFör(k, ["Arkitekten.User"], ["x"])).toEqual(["user"]);
    // En grupp i Entra kan också ge admin (ENTRA_ADMIN_GRUPPER).
    expect(rollerFör(k, [], ["x"], ["9F1C0000-0000-0000-0000-000000000001"])).toContain("admin");
    expect(rollerFör(k, [], ["x"], ["en-annan-grupp"])).toEqual(["user"]);
  });
});

describe("hela kodflödet", () => {
  it("state och nonce från starten krävs för att avsluta", async () => {
    const start = påbörjaInloggning(k, HEMLIG, "/#/p", nu);
    const url = new URL(start.url);
    expect(url.searchParams.get("redirect_uri")).toBe("https://arkitekten.example.org/__ark/auth/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const kaka = start.kaka.split(";")[0];
    const state = url.searchParams.get("state")!;
    const nonce = url.searchParams.get("nonce")!;
    const hämta = (async (_: unknown, init: RequestInit) => {
      expect(String(init.body)).toContain("code_verifier=");
      return new Response(JSON.stringify({ id_token: jwt(giltig({ nonce })) }), { status: 200 });
    }) as unknown as typeof fetch;

    const ok = await avslutaInloggning(k, HEMLIG, kaka, new URLSearchParams({ state, code: "k" }), hämta, nu);
    expect(ok).toMatchObject({ tillbaka: "/#/p", användare: { id: "oid-1" } });

    await expect(
      avslutaInloggning(k, HEMLIG, kaka, new URLSearchParams({ state: "fel", code: "k" }), hämta, nu),
    ).rejects.toThrow(/webbläsaren/);
    await expect(
      avslutaInloggning(k, HEMLIG, undefined, new URLSearchParams({ state, code: "k" }), hämta, nu),
    ).rejects.toThrow(/för lång tid/);
  });
});
