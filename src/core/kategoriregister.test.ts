/**
 * Kategoriregistret: vem som skapar, föreslår och beslutar.
 */
import { describe, expect, it } from "vitest";
import type { Användare } from "./behorighet";
import {
  TOMT_REGISTER,
  beslutaFörslag,
  föreslåKategori,
  läsKategoriregister,
  registreradeTitlar,
  registretFör,
  skapaKategori,
  taBortKategori,
  type Kategoriregister,
} from "./kategoriregister";

const admin: Användare = { id: "a", namn: "Admin", roller: ["admin", "user"] };
const anna: Användare = { id: "anna", namn: "Anna", roller: ["user"] };
const bo: Användare = { id: "bo", namn: "Bo", roller: ["user"] };
const NU = "2026-11-25T12:00:00.000Z";
const ok = <T,>(u: { ok: true; värde: T } | { ok: false; status: number; fel: string }): T => {
  if (!u.ok) throw new Error(u.fel);
  return u.värde;
};

describe("skapa kategori", () => {
  it("administratören skapar i den gemensamma katalogen – andra får nej och hänvisas till förslag", () => {
    const reg = ok(skapaKategori(TOMT_REGISTER, admin, { namn: "  Ekonomi  ", yta: "gemensam" }, [], NU));
    expect(reg.kategorier).toEqual([{ namn: "Ekonomi", skapadAv: { id: "a", namn: "Admin" }, skapadAt: NU }]);
    expect(skapaKategori(TOMT_REGISTER, anna, { namn: "Ekonomi", yta: "gemensam" }, [], NU)).toMatchObject({ ok: false, status: 403 });
  });

  it("var och en skapar i sin egen katalog, och bara ägaren ser den", () => {
    const reg = ok(skapaKategori(TOMT_REGISTER, anna, { namn: "Utkast", yta: "egen" }, [], NU));
    expect(reg.kategorier[0].ägare).toEqual({ id: "anna", namn: "Anna" });
    expect(registreradeTitlar(reg, anna, "egen")).toEqual(["Utkast"]);
    expect(registreradeTitlar(reg, bo, "egen")).toEqual([]);
    expect(registreradeTitlar(reg, anna, "gemensam")).toEqual([]);
    expect(registretFör(reg, bo).kategorier).toEqual([]);
    // Samma namn i någon annans katalog krockar inte.
    expect(skapaKategori(reg, bo, { namn: "Utkast", yta: "egen" }, [], NU).ok).toBe(true);
  });

  it("en kategori som redan finns skapas inte en gång till – inte heller med annat skiftläge", () => {
    const reg = ok(skapaKategori(TOMT_REGISTER, admin, { namn: "Ekonomi", yta: "gemensam" }, [], NU));
    expect(skapaKategori(reg, admin, { namn: "ekonomi", yta: "gemensam" }, [], NU)).toMatchObject({ ok: false, status: 409 });
    // Den finns redan genom sina processer.
    expect(skapaKategori(TOMT_REGISTER, admin, { namn: "Drift", yta: "gemensam" }, ["drift"], NU)).toMatchObject({ ok: false, status: 409 });
    expect(skapaKategori(TOMT_REGISTER, admin, { namn: "   ", yta: "gemensam" }, [], NU)).toMatchObject({ ok: false, status: 400 });
    expect(skapaKategori(TOMT_REGISTER, admin, { namn: "X", yta: "demo" }, [], NU)).toMatchObject({ ok: false, status: 400 });
  });

  it("tas bort av den som fick skapa den", () => {
    let reg = ok(skapaKategori(TOMT_REGISTER, admin, { namn: "Ekonomi", yta: "gemensam" }, [], NU));
    reg = ok(skapaKategori(reg, anna, { namn: "Utkast", yta: "egen" }, [], NU));
    expect(taBortKategori(reg, anna, { namn: "Ekonomi", yta: "gemensam" })).toMatchObject({ ok: false, status: 403 });
    expect(taBortKategori(reg, bo, { namn: "Utkast", yta: "egen" })).toMatchObject({ ok: false, status: 404 });
    expect(ok(taBortKategori(reg, anna, { namn: "utkast", yta: "egen" })).kategorier.map((k) => k.namn)).toEqual(["Ekonomi"]);
    expect(ok(taBortKategori(reg, admin, { namn: "Ekonomi", yta: "gemensam" })).kategorier.map((k) => k.namn)).toEqual(["Utkast"]);
  });
});

describe("föreslå kategori", () => {
  const föreslaget = (): Kategoriregister =>
    ok(föreslåKategori(TOMT_REGISTER, anna, { namn: "Hållbarhet", motivering: " Vi saknar den. " }, [], NU, "f1"));

  it("alla kan föreslå; administratörerna ser förslaget, och den som föreslog – ingen annan", () => {
    const reg = föreslaget();
    expect(reg.förslag).toEqual([
      { id: "f1", namn: "Hållbarhet", motivering: "Vi saknar den.", föreslagenAv: { id: "anna", namn: "Anna" }, föreslagenAt: NU },
    ]);
    expect(reg.kategorier).toEqual([]);
    expect(registretFör(reg, admin).förslag).toHaveLength(1);
    expect(registretFör(reg, anna).förslag).toHaveLength(1);
    expect(registretFör(reg, bo).förslag).toHaveLength(0);
  });

  it("det som redan finns eller redan är föreslaget föreslås inte igen", () => {
    expect(föreslåKategori(föreslaget(), bo, { namn: "hållbarhet" }, [], NU, "f2")).toMatchObject({ ok: false, status: 409 });
    expect(föreslåKategori(TOMT_REGISTER, bo, { namn: "Drift" }, ["Drift"], NU, "f2")).toMatchObject({ ok: false, status: 409 });
  });

  it("godkänt förslag blir en kategori i den gemensamma katalogen; avslaget försvinner", () => {
    const godkänt = ok(beslutaFörslag(föreslaget(), admin, "f1", true, [], NU));
    expect(godkänt.förslag).toEqual([]);
    expect(registreradeTitlar(godkänt, bo, "gemensam")).toEqual(["Hållbarhet"]);
    const avslaget = ok(beslutaFörslag(föreslaget(), admin, "f1", false, [], NU));
    expect(avslaget).toEqual({ kategorier: [], förslag: [] });
    // Fanns kategorin redan (någon hann före) blir det ingen dubblett.
    expect(ok(beslutaFörslag(föreslaget(), admin, "f1", true, ["Hållbarhet"], NU)).kategorier).toEqual([]);
  });

  it("bara administratören beslutar – men den som föreslog kan dra tillbaka sitt eget", () => {
    expect(beslutaFörslag(föreslaget(), anna, "f1", true, [], NU)).toMatchObject({ ok: false, status: 403 });
    expect(beslutaFörslag(föreslaget(), bo, "f1", false, [], NU)).toMatchObject({ ok: false, status: 403 });
    expect(ok(beslutaFörslag(föreslaget(), anna, "f1", false, [], NU)).förslag).toEqual([]);
    expect(beslutaFörslag(föreslaget(), admin, "finns-inte", true, [], NU)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("läsningen utifrån", () => {
  it("allt okänt eller trasigt faller bort, och text kapas", () => {
    const reg = läsKategoriregister({
      kategorier: [
        { namn: "Ekonomi", skapadAt: NU, okänt: "<x>" },
        { namn: "ekonomi", skapadAt: NU },
        { namn: "", skapadAt: NU },
        { namn: "Egen\u0000kategori", ägare: { id: "anna", namn: "Anna" }, skapadAt: "inte en tid" },
        "skräp",
      ],
      förslag: [
        { id: "f1", namn: "A".repeat(200), föreslagenAv: { id: "anna", namn: "Anna" }, föreslagenAt: NU },
        { id: "<script>", namn: "X", föreslagenAv: { id: "anna", namn: "Anna" }, föreslagenAt: NU },
        { id: "f3", namn: "Utan avsändare", föreslagenAt: NU },
      ],
    });
    expect(reg.kategorier.map((k) => k.namn)).toEqual(["Ekonomi", "Egen kategori"]);
    expect(reg.kategorier[0]).not.toHaveProperty("okänt");
    expect(reg.förslag).toHaveLength(1);
    expect(reg.förslag[0].namn).toHaveLength(80);
    expect(läsKategoriregister(null)).toEqual({ kategorier: [], förslag: [] });
    expect(läsKategoriregister("skräp")).toEqual({ kategorier: [], förslag: [] });
  });
});
