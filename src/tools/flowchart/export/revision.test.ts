/**
 * Revisionsrutan i exporten.
 *
 * Kontraktet: rutan säger vad läsaren tittar PÅ – version, datum och vem som
 * justerade – och den ljuger aldrig. Saknas uppgifter ritas de inte, och har
 * bilden ändrats efter den sparade versionen syns det.
 */

import { describe, expect, it } from "vitest";
import { revisionAvVersion, revisionsMått, revisionsRuta } from "./revision";

const REV = {
  version: "v6",
  datum: "2026-07-28T09:19:10.653Z",
  ändradAv: "Testanvändare",
};

describe("revisionsRuta", () => {
  it("visar version, datum och vem som justerat", () => {
    const svg = revisionsRuta(0, 0, REV);
    expect(svg).toContain("Version 6 · 2026-07-28");
    expect(svg).toContain("Justerad av Testanvändare");
  });

  it("markerar att bilden ändrats efter den sparade versionen", () => {
    expect(revisionsRuta(0, 0, { ...REV, osparat: true })).toContain("ändrad sedan dess");
    expect(revisionsRuta(0, 0, REV)).not.toContain("ändrad sedan dess");
  });

  it("utelämnar rader som saknar uppgift", () => {
    const utanNamn = revisionsRuta(0, 0, { version: "v2", datum: REV.datum });
    expect(utanNamn).toContain("Version 2");
    expect(utanNamn).not.toContain("Justerad av");

    const bara = revisionsRuta(0, 0, { ändradAv: "HR" });
    expect(bara).toContain("Justerad av HR");
    expect(bara).not.toContain("Version");
  });

  it("ritar ingenting alls utan revision – ett osparat flöde stämplas inte", () => {
    expect(revisionsRuta(0, 0, undefined)).toBe("");
    expect(revisionsRuta(0, 0, {})).toBe("");
    expect(revisionsMått(undefined)).toEqual({ w: 0, h: 0 });
  });

  it("ett ogiltigt datum blir tomt, aldrig 'Invalid Date'", () => {
    const svg = revisionsRuta(0, 0, { version: "v1", datum: "inte ett datum" });
    expect(svg).toContain("Version 1");
    expect(svg).not.toContain("Invalid");
  });

  it("rutan är bred nog för sin längsta rad", () => {
    const smal = revisionsMått({ version: "v1" });
    const bred = revisionsMått({ version: "v1", ändradAv: "Ett mycket långt namn på en person" });
    expect(bred.w).toBeGreaterThan(smal.w);
    expect(bred.h).toBeGreaterThan(smal.h);
  });

  it("texten escapas – ett namn med & eller < får inte bryta filen", () => {
    expect(revisionsRuta(0, 0, { ändradAv: "Ek & Son <IT>" })).toContain(
      "Ek &amp; Son &lt;IT&gt;",
    );
  });
});

describe("statusen i rutan", () => {
  it("en fastslagen version säger det rakt ut, i stället för 'Version'", () => {
    const svg = revisionsRuta(0, 0, { ...REV, version: "2.0", status: "fastslagen" });
    expect(svg).toContain("Fastslagen 2.0 · 2026-07-28");
    expect(svg).not.toContain("Version 2.0");
  });

  it("ett utkast märks som utkast och pekar ut huvudversionen som gäller", () => {
    const svg = revisionsRuta(0, 0, {
      ...REV,
      version: "2.1",
      status: "utkast",
      senastFastslagen: { version: "2.0", datum: "2026-07-12T08:00:00.000Z" },
    });
    expect(svg).toContain("Utkast 2.1");
    expect(svg).toContain("Senast fastslagen: 2.0 (2026-07-12)");
  });

  it("utan status står det 'Version' som förut – rutan påstår inget den inte vet", () => {
    expect(revisionsRuta(0, 0, { ...REV, version: "1.1" })).toContain("Version 1.1");
  });
});

/* Hela flödet in, en färdig stämpel ut. Regeln låg tidigare kopierad i båda
   verktygen, och två diagram i samma rapport kunde påstå olika saker. */
describe("revisionAvVersion", () => {
  const FLÖDE = {
    savedAt: "2026-07-30T10:00:00.000Z",
    versions: [
      { status: "utkast", savedAt: "2026-07-01T08:00:00.000Z", savedBy: "Testanvändare" },
      { status: "fastslagen", savedAt: "2026-07-12T08:00:00.000Z", savedBy: "Testanvändare" },
      { status: "utkast", savedAt: "2026-07-30T10:00:00.000Z", savedBy: "Claude Code" },
    ],
  } as const;

  it("index -1 = senaste versionen, med sin beteckning och sin status", () => {
    expect(revisionAvVersion(FLÖDE, -1, false)).toMatchObject({
      version: "1.1",
      status: "utkast",
      ändradAv: "Claude Code",
      senastFastslagen: { version: "1.0", datum: "2026-07-12T08:00:00.000Z" },
    });
  });

  it("pekar man på huvudversionen upprepas den inte som 'senast fastslagen'", () => {
    const rev = revisionAvVersion(FLÖDE, 1, false);
    expect(rev).toMatchObject({ version: "1.0", status: "fastslagen" });
    expect(rev?.senastFastslagen).toBeUndefined();
  });

  it("REGRESSION: huvudversionen är aldrig 'ändrad sedan dess'", () => {
    // Exporterar man den fastslagna versionen ÄR bilden den versionen – hur
    // mycket som än ligger ouppsparat i editorn. Skickades `dirty` rakt in hit
    // stämplades en oförändrad huvudversion som ändrad.
    expect(revisionAvVersion(FLÖDE, 1, false)?.osparat).toBe(false);
  });

  it("ett index utanför historiken klamras till sista versionen i stället för att krascha", () => {
    expect(revisionAvVersion(FLÖDE, 99, false)?.version).toBe("1.1");
  });

  it("ett flöde utan historik ger bara ett datum – ingen påhittad status", () => {
    const rev = revisionAvVersion({ savedAt: "2026-07-30T10:00:00.000Z" }, -1, true);
    expect(rev).toEqual({ datum: "2026-07-30T10:00:00.000Z", osparat: true });
    expect(revisionsRuta(0, 0, rev)).not.toContain("Utkast");
  });

  it("inget flöde alls ger ingen stämpel", () => {
    expect(revisionAvVersion(null, -1, false)).toBeUndefined();
    expect(revisionAvVersion({}, -1, false)).toBeUndefined();
  });
});
