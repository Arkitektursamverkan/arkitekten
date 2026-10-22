import { describe, expect, it } from "vitest";
import { bytYta, prövaRamserie, prövaSparning } from "./atkomst";
import type { Användare } from "../src/core/behorighet";

const admin: Användare = { id: "a", namn: "Admin", roller: ["admin", "user"] };
const testa: Användare = { id: "test", namn: "Test Testsson", roller: ["user"] };
const prova: Användare = { id: "prov", namn: "Prov Provsson", roller: ["user"] };
const v = (id: string, savedAt = "t" + id) => ({ id, savedAt });

describe("sparning", () => {
  it("en ny process hamnar i den sparandes egen katalog", () => {
    const r = prövaSparning(testa, "entra", null, { category: "X", versions: [v("v1")] });
    expect(r.ok && r.värde.ägare).toEqual({ id: "test", namn: "Test Testsson" });
  });
  it("en ny version får den inloggades namn när signaturen saknas – äldre rörs inte", () => {
    const befintlig = { ägare: { id: "test", namn: "Test Testsson" }, versions: [v("v1")] };
    const r = prövaSparning(testa, "entra", befintlig, { versions: [v("v1"), v("v2")] });
    expect(r.ok && r.värde.versions).toEqual([v("v1"), { ...v("v2"), savedBy: "Test Testsson" }]);
  });
  it("REGRESSION: ägaren kan inte ändras med en vanlig sparning – en klient som tappade fältet flyttade inte processen", () => {
    const befintlig = { ägare: { id: "test", namn: "Test Testsson" }, versions: [v("v1")] };
    const r = prövaSparning(testa, "entra", befintlig, { versions: [v("v1")] });
    expect(r.ok && r.värde.ägare).toEqual({ id: "test", namn: "Test Testsson" });
    const kapning = prövaSparning(prova, "entra", null, { ägare: { id: "test", namn: "Test Testsson" } });
    expect(kapning.ok && kapning.värde.ägare).toEqual({ id: "prov", namn: "Prov Provsson" });
  });
  it("en ny process minns vem som skapade den – i öppen drift finns ingen att minnas", () => {
    const r = prövaSparning(testa, "entra", null, { category: "X", versions: [v("v1")] });
    expect(r.ok && r.värde.skapadAv).toEqual({ id: "test", namn: "Test Testsson" });
    const öppen = prövaSparning(admin, "öppen", null, { category: "X", versions: [v("v1")] });
    expect(öppen.ok && öppen.värde.skapadAv).toBeUndefined();
  });
  it("REGRESSION: skaparen står still – varken en sparning eller ett byte av yta skriver över den", () => {
    const befintlig = {
      ägare: { id: "test", namn: "Test Testsson" },
      skapadAv: { id: "test", namn: "Test Testsson" },
      versions: [v("v1")],
    };
    const kapning = prövaSparning(testa, "entra", befintlig, {
      versions: [v("v1"), v("v2")],
      skapadAv: { id: "prov", namn: "Prov Provsson" },
    });
    expect(kapning.ok && kapning.värde.skapadAv).toEqual({ id: "test", namn: "Test Testsson" });
    const tappad = prövaSparning(testa, "entra", befintlig, { versions: [v("v1"), v("v2")] });
    expect(tappad.ok && tappad.värde.skapadAv).toEqual({ id: "test", namn: "Test Testsson" });
    const flyttad = bytYta(testa, befintlig, { till: "gemensam", category: "Affärsprocesser" });
    expect(flyttad.ok && flyttad.värde.ägare).toBeUndefined();
    expect(flyttad.ok && flyttad.värde.skapadAv).toEqual({ id: "test", namn: "Test Testsson" });
  });
  it("ett flöde från före fältet får ingen påhittad skapare", () => {
    const befintlig = { ägare: { id: "test", namn: "Test Testsson" }, versions: [v("v1")] };
    const r = prövaSparning(testa, "entra", befintlig, { versions: [v("v1"), v("v2")] });
    expect(r.ok && "skapadAv" in r.värde).toBe(false);
  });
  it("en användare kan inte ändra i den gemensamma katalogen, admin kan", () => {
    const befintlig = { category: "Affärsprocesser", versions: [v("v1")] };
    expect(prövaSparning(testa, "entra", befintlig, { ...befintlig, versions: [v("v1"), v("v2")] })).toMatchObject({ ok: false, status: 403 });
    expect(prövaSparning(admin, "entra", befintlig, { ...befintlig, versions: [v("v1"), v("v2")] }).ok).toBe(true);
  });
  it("att byta kategori till Demo är ett byte av yta och prövas som ett", () => {
    const befintlig = { category: "Affärsprocesser", versions: [v("v1")] };
    const r = prövaSparning(admin, "entra", befintlig, { ...befintlig, category: "Demo" });
    expect(r.ok).toBe(true);
    const demo = { category: "Demo", versions: [v("v1")] };
    expect(prövaSparning(testa, "entra", demo, { ...demo, category: "Affärsprocesser" })).toMatchObject({ ok: false, status: 403 });
  });
  it("REGRESSION: två som sparar samtidigt – den som kommer sist skriver inte över den andras version (invariant 11)", () => {
    const befintlig = { category: "Demo", versions: [v("v1"), v("v2", "prov")] };
    const r = prövaSparning(testa, "entra", befintlig, { category: "Demo", versions: [v("v1"), v("v2", "test")] });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
  it("i öppen drift fungerar allt som före inloggningen", () => {
    const r = prövaSparning(admin, "öppen", null, { category: "X" });
    expect(r.ok && r.värde.ägare).toBeUndefined();
  });
});

describe("byte av yta", () => {
  const testssons = { ägare: { id: "test", namn: "Test Testsson" }, category: "Utkast", subcategory: "A", versions: [v("v1")], savedAt: "s" };
  it("ägaren flyttar till den gemensamma katalogen – historik och savedAt står still", () => {
    const r = bytYta(testa, testssons, { till: "gemensam", category: "Affärsprocesser" });
    expect(r.ok && r.värde).toMatchObject({ category: "Affärsprocesser", subcategory: "A", versions: [v("v1")], savedAt: "s" });
    expect(r.ok && "ägare" in r.värde).toBe(false);
  });
  it("till Demo sätts kategorin", () => {
    const r = bytYta(testa, testssons, { till: "demo" });
    expect(r.ok && r.värde.category).toBe("Demo");
  });
  it("någon annan får inte flytta processen", () => {
    expect(bytYta(prova, testssons, { till: "gemensam" })).toMatchObject({ ok: false, status: 403 });
  });
  it("admin kan ta en process ur den gemensamma katalogen till sin egen", () => {
    const r = bytYta(admin, { category: "Demo" }, { till: "egen" });
    expect(r.ok && r.värde).toMatchObject({ ägare: { id: "a" }, category: undefined });
  });
});

describe("ramserier", () => {
  it("skaparen stämplas vid skapandet och följer sedan med, vad klienten än skickar", () => {
    const ny = prövaRamserie<{ id: string; skapadAv?: { id: string; namn: string } }>(testa, null, {
      id: "r",
      skapadAv: { id: "prov", namn: "Prov Provsson" },
    });
    expect(ny.skapadAv).toEqual({ id: "test", namn: "Test Testsson" });
    const ändrad = prövaRamserie<{ id: string; skapadAv?: { id: string; namn: string } }>(prova, ny, { id: "r" });
    expect(ändrad.skapadAv).toEqual({ id: "test", namn: "Test Testsson" });
  });
});
