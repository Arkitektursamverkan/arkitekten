import { describe, expect, it } from "vitest";
import { läsKlassningsinställning } from "./klassning";
import {
  delaIYtor,
  fårSeKlassning,
  kanLäsaSkiss,
  medKlarering,
  minaSkyddsklasser,
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
  it("kategorin Demo är ingen egen yta längre – en vanlig kategori i den gemensamma katalogen", () => {
    expect(ytaFör(demo)).toBe("gemensam");
    expect(ytaFör({ category: " demo " })).toBe("gemensam");
  });
  it("en ägare vinner över kategorin", () => {
    expect(ytaFör({ ...demo, ägare: { id: "x", namn: "X" } })).toBe("egen");
  });
});

describe("rollerna", () => {
  it("alla inloggade läser det gemensamma, men bara ägaren (och admin) en egen process", () => {
    expect(kanLäsa(bo, gemensam)).toBe(true);
    expect(kanLäsa(bo, demo)).toBe(true);
    expect(kanLäsa(anna, annas)).toBe(true);
    expect(kanLäsa(bo, annas)).toBe(false);
    expect(kanLäsa(admin, annas)).toBe(true);
    expect(kanLäsa(null, gemensam)).toBe(false);
  });
  it("den gemensamma katalogen ändras bara av administratörer – också kategorin Demo", () => {
    expect(kanRedigera(anna, gemensam)).toBe(false);
    expect(kanRedigera(admin, gemensam)).toBe(true);
    expect(kanRedigera(anna, demo)).toBe(false);
    expect(kanRedigera(admin, demo)).toBe(true);
    expect(kanRedigera(bo, annas)).toBe(false);
  });
  it("ta bort: ägaren sin egen, administratören det gemensamma", () => {
    expect(kanTaBort(anna, demo)).toBe(false);
    expect(kanTaBort(anna, annas)).toBe(true);
    expect(kanTaBort(bo, annas)).toBe(false);
    expect(kanTaBort(admin, gemensam)).toBe(true);
  });
  it("ägaren flyttar sin process till den gemensamma katalogen – men inte tillbaka", () => {
    expect(kanByttaYta(anna, annas, "gemensam")).toBe(true);
    expect(kanByttaYta(bo, annas, "gemensam")).toBe(false);
    expect(kanByttaYta(anna, gemensam, "egen")).toBe(false);
    expect(kanByttaYta(admin, gemensam, "egen")).toBe(true);
    expect(kanByttaYta(anna, annas, "egen")).toBe(false); // redan där
  });
  it("bara admin publicerar i EA-portalen – från vilken yta som helst (publiceringen flyttar till gemensam)", () => {
    expect(kanPublicera(admin, gemensam)).toBe(true);
    expect(kanPublicera(admin, annas)).toBe(true);
    expect(kanPublicera(admin, demo)).toBe(true);
    expect(kanPublicera(anna, gemensam)).toBe(false);
    expect(kanPublicera(anna, annas)).toBe(false);
    expect(kanPublicera(anna, demo)).toBe(false);
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
    expect(ägareVidSkapande(anna, "entra")).toEqual({ id: "anna", namn: "Anna" });
    expect(ägareVidSkapande(admin, "entra")).toEqual({ id: "a", namn: "Admin" });
  });
  it("kategorin Demo ger ingen genväg förbi den egna katalogen", () => {
    expect(kanSkapa(anna, demo)).toBe(false);
    expect(kanSkapa(anna, { ...demo, ägare: { id: "anna", namn: "Anna" } })).toBe(true);
  });
  it("i öppen drift som förut: i den gemensamma katalogen", () => {
    expect(ägareVidSkapande(admin, "öppen")).toBeUndefined();
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
  it("ger gemensam och mina i fast ordning, med status per yta – Demo räknas till det gemensamma", () => {
    const ytor = delaIYtor(flöden, anna);
    expect(ytor.map((y) => y.id)).toEqual(["gemensam", "egen"]);
    expect(ytor[0]).toMatchObject({ titel: "Gemensam katalog", fastslagna: 1, utkast: 2 });
  });
  it("för admin är någon annans egna process 'andras', inte 'mina'", () => {
    expect(ytgruppFör(admin, annas)).toBe("andras");
    expect(delaIYtor(flöden, admin).map((y) => y.id)).toEqual(["gemensam", "andras"]);
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

describe("klassningen skär av", () => {
  const inst = läsKlassningsinställning({
    på: true,
    skyddsklasser: [{ namn: "Känsliga", nivåer: ["niva-3"], behöriga: ["bo@example.org", "anna"] }],
  });
  const annaK = medKlarering({ ...anna, id: "ANNA" }, inst);
  const cecilia = medKlarering({ id: "c", namn: "Cecilia", roller: ["user"] }, inst);
  const boK = medKlarering({ ...bo, epost: "Bo@Example.org" }, inst);
  const gemensam = { category: "Ekonomi", klassning: { nivå: "niva-3" } };

  it("klareringen: nivåerna utan krav, och de vars klass man har (id eller e-post)", () => {
    expect(cecilia.klarering).toEqual(["niva-0", "niva-1", "niva-2"]);
    expect(annaK.klarering).toEqual(["niva-0", "niva-1", "niva-2", "niva-3"]);
    expect(boK.klarering).toContain("niva-3");
    expect(medKlarering(admin, inst).klarering).toBeUndefined();
    expect(medKlarering(cecilia, { ...inst, på: false }).klarering).toBeUndefined();
    expect(minaSkyddsklasser(boK, inst)).toEqual(["kansliga"]);
    expect(minaSkyddsklasser(cecilia, inst)).toEqual([]);
  });

  it("utan klassen: varken läsa, ändra, flytta, ta bort eller publicera", () => {
    expect(kanLäsa(cecilia, gemensam)).toBe(false);
    expect(kanLäsa(boK, gemensam)).toBe(true);
    expect(kanLäsa(admin, gemensam)).toBe(true);
    const cecilias = { ägare: { id: "c", namn: "Cecilia" }, klassning: { nivå: "niva-3" } };
    const bos = { ägare: { id: boK.id, namn: "Bo" }, klassning: { nivå: "niva-3" } };
    expect(kanRedigera(cecilia, cecilias)).toBe(false);
    expect(kanRedigera(boK, bos)).toBe(true);
    const egen = { ägare: { id: "c", namn: "Cecilia" }, klassning: { nivå: "niva-3" } };
    expect(kanLäsa(cecilia, egen)).toBe(false);
    expect(kanTaBort(cecilia, egen)).toBe(false);
    expect(kanByttaYta(cecilia, egen, "gemensam")).toBe(false);
    expect(kanPublicera(medKlarering(admin, inst), gemensam)).toBe(true);
    expect(kanLäsaSkiss(cecilia, { klassning: { nivå: "niva-3" } })).toBe(false);
    expect(kanLäsaSkiss(cecilia, { klassning: { nivå: "niva-2" } })).toBe(true);
  });

  it("oklassat är öppet; en nivå utanför modellen är stängd", () => {
    expect(fårSeKlassning(cecilia, undefined)).toBe(true);
    expect(fårSeKlassning(cecilia, null)).toBe(true);
    expect(fårSeKlassning(cecilia, { nivå: "borta" })).toBe(false);
    expect(fårSeKlassning(cecilia, { nivå: 3 })).toBe(false);
    expect(fårSeKlassning(null, undefined)).toBe(false);
    // Utan klarering (klassning av, eller ännu inte hämtad): ingen begränsning.
    expect(fårSeKlassning(anna, { nivå: "niva-3" })).toBe(true);
  });
});

describe("skyddsklass via Entra-grupp", () => {
  const GRUPP = "11111111-2222-3333-4444-555555555555";
  const inst = läsKlassningsinställning({
    på: true,
    skyddsklasser: [{ namn: "Känsliga", nivåer: ["niva-3"], behöriga: [GRUPP.toUpperCase()] }],
  });
  it("den som är med i gruppen har klassen; den som inte är det har den inte", () => {
    const med = medKlarering({ id: "x", namn: "X", roller: ["user"], grupper: [GRUPP] }, inst);
    const utan = medKlarering({ id: "y", namn: "Y", roller: ["user"], grupper: ["99999999-2222-3333-4444-555555555555"] }, inst);
    expect(kanLäsa(med, { klassning: { nivå: "niva-3" } })).toBe(true);
    expect(kanLäsa(utan, { klassning: { nivå: "niva-3" } })).toBe(false);
    expect(minaSkyddsklasser(med, inst)).toEqual(["kansliga"]);
  });
});
