import { describe, expect, it } from "vitest";
import {
  delaIYtor,
  kanByttaYta,
  kanLäsa,
  kanPublicera,
  kanRedigera,
  kanSkapa,
  kanTaBort,
  kanTaBortRamserie,
  vemsProcess,
  ytaFör,
  ytgruppFör,
  ägareVidSkapande,
  type Användare,
} from "./behorighet";

const admin: Användare = { id: "a", namn: "Admin", roller: ["admin", "user"] };
const anna: Användare = { id: "anna", namn: "Anna", roller: ["user"] };
const bo: Användare = { id: "bo", namn: "Bo", roller: ["user"] };

const gemensam = { category: "Gemensamma flöden" };
const demo = { category: "Demo" };
const annas = { ägare: { id: "anna", namn: "Anna" }, category: "Mitt" };

describe("ytan härleds ur flödet", () => {
  it("utan ägare och kategori är det den gemensamma katalogen – gamla filer behöver ingen migrering", () => {
    expect(ytaFör({})).toBe("gemensam");
    expect(ytaFör(gemensam)).toBe("gemensam");
  });
  it("kategorin Demo är den offentliga ytan, oavsett skiftläge", () => {
    expect(ytaFör(demo)).toBe("demo");
    expect(ytaFör({ category: " demo " })).toBe("demo");
  });
  it("en ägare vinner över kategorin", () => {
    expect(ytaFör({ ...demo, ägare: { id: "x", namn: "X" } })).toBe("egen");
  });
});

describe("rollerna", () => {
  it("alla inloggade läser gemensamt och demo, men bara ägaren (och admin) en egen process", () => {
    expect(kanLäsa(bo, gemensam)).toBe(true);
    expect(kanLäsa(bo, demo)).toBe(true);
    expect(kanLäsa(anna, annas)).toBe(true);
    expect(kanLäsa(bo, annas)).toBe(false);
    expect(kanLäsa(admin, annas)).toBe(true);
    expect(kanLäsa(null, gemensam)).toBe(false);
  });
  it("den gemensamma katalogen ändras bara av administratörer; demo av alla", () => {
    expect(kanRedigera(anna, gemensam)).toBe(false);
    expect(kanRedigera(admin, gemensam)).toBe(true);
    expect(kanRedigera(anna, demo)).toBe(true);
    expect(kanRedigera(bo, annas)).toBe(false);
  });
  it("demo är offentlig men töms inte av vem som helst", () => {
    expect(kanTaBort(anna, demo)).toBe(false);
    expect(kanTaBort(anna, annas)).toBe(true);
    expect(kanTaBort(bo, annas)).toBe(false);
    expect(kanTaBort(admin, gemensam)).toBe(true);
  });
  it("ägaren flyttar sin process till den gemensamma katalogen – men inte tillbaka", () => {
    expect(kanByttaYta(anna, annas, "gemensam")).toBe(true);
    expect(kanByttaYta(anna, annas, "demo")).toBe(true);
    expect(kanByttaYta(bo, annas, "gemensam")).toBe(false);
    expect(kanByttaYta(anna, gemensam, "egen")).toBe(false);
    expect(kanByttaYta(admin, gemensam, "egen")).toBe(true);
    expect(kanByttaYta(anna, annas, "egen")).toBe(false); // redan där
  });
  it("bara den gemensamma katalogen publiceras i EA-portalen, och bara av admin", () => {
    expect(kanPublicera(admin, gemensam)).toBe(true);
    expect(kanPublicera(admin, annas)).toBe(false);
    expect(kanPublicera(anna, gemensam)).toBe(false);
  });
  it("en ramserie tas bort av sin skapare eller av admin – en gammal utan skapare bara av admin", () => {
    expect(kanTaBortRamserie(anna, { skapadAv: { id: "anna", namn: "Anna" } })).toBe(true);
    expect(kanTaBortRamserie(bo, { skapadAv: { id: "anna", namn: "Anna" } })).toBe(false);
    expect(kanTaBortRamserie(bo, {})).toBe(false);
    expect(kanTaBortRamserie(admin, {})).toBe(true);
  });
});

describe("nya processer", () => {
  it("börjar i ens egen katalog när man är inloggad", () => {
    expect(ägareVidSkapande(anna, "entra", { category: "X" })).toEqual({ id: "anna", namn: "Anna" });
    expect(ägareVidSkapande(admin, "entra", {})).toEqual({ id: "a", namn: "Admin" });
  });
  it("i Demo om man valt den kategorin", () => {
    expect(ägareVidSkapande(anna, "entra", demo)).toBeUndefined();
    expect(kanSkapa(anna, demo)).toBe(true);
  });
  it("i öppen drift som förut: i den gemensamma katalogen", () => {
    expect(ägareVidSkapande(admin, "öppen", { category: "X" })).toBeUndefined();
  });
  it("bara admin skapar direkt i den gemensamma katalogen", () => {
    expect(kanSkapa(anna, gemensam)).toBe(false);
    expect(kanSkapa(admin, gemensam)).toBe(true);
  });
});

describe("indelningen i ytor", () => {
  const flöden = [
    { id: "1", ...gemensam, status: "fastslagen" },
    { id: "2", ...gemensam },
    { id: "3", ...demo },
    { id: "4", ...annas },
  ];
  it("ger gemensam, demo och mina i fast ordning, med status per yta", () => {
    const ytor = delaIYtor(flöden, anna);
    expect(ytor.map((y) => y.id)).toEqual(["gemensam", "demo", "egen"]);
    expect(ytor[0]).toMatchObject({ titel: "Gemensam katalog", fastslagna: 1, utkast: 1 });
  });
  it("för admin är någon annans egna process 'andras', inte 'mina'", () => {
    expect(ytgruppFör(admin, annas)).toBe("andras");
    expect(delaIYtor(flöden, admin).map((y) => y.id)).toEqual(["gemensam", "demo", "andras"]);
  });
});

describe("vems processen är", () => {
  it("ägaren, och skaparen bara när det är någon annan", () => {
    expect(vemsProcess(gemensam)).toBeUndefined();
    expect(vemsProcess(annas)).toBe("Anna");
    expect(vemsProcess({ ...annas, skapadAv: { id: "anna", namn: "Anna" } })).toBe("Anna");
    expect(vemsProcess({ ...annas, skapadAv: { id: "bo", namn: "Bo" } })).toBe("Anna · skapad av Bo");
  });
});
