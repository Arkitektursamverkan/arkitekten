/**
 * BMT-exporten i appen: knappen visas bara när installationen har en mall
 * (ARK_BMT_MALL), och filen den laddar ner är ett arkiv med processen som
 * modell, i mallens namnrymd, med mallens profil och användare.
 *
 * Mallen här är påhittad – en riktig hör till en installation och ligger
 * aldrig i repot (invariant 12).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AFFARSPROCESS_EXEMPEL, findChromium, startaAppen } from "./harness";
import { läsZip, packaZip } from "../src/core/zip";

const chromium = findChromium();
const NS = "urn:exempel:mt-export";
const SPRÅK = "11111111-2222-4333-8444-555555555555";
const ANV = "99999999-8888-4777-8666-555555555555";

describe.skipIf(!chromium)("BMT-exporten", () => {
  let rigg: Awaited<ReturnType<typeof startaAppen>>;
  const tidigare = process.env.ARK_BMT_MALL;

  beforeAll(async () => {
    const mapp = mkdtempSync(join(tmpdir(), "ark-bmt-"));
    const fil = join(mapp, "mall.bmt");
    writeFileSync(
      fil,
      await packaZip(
        {
          [`languages/${SPRÅK}.xml`]: `<mt-language xmlns="${NS}" uuid="${SPRÅK}"><title>Svenska</title></mt-language>`,
          [`users/${ANV}.xml`]: `<mt-user xmlns="${NS}" user-name="${ANV}"><first-name>Prov</first-name></mt-user>`,
          "config.xml": "<repository-profile/>",
          "models/schema.xsd": `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${NS}"/>`,
        },
        new Date(),
        { komprimera: true },
      ),
    );
    process.env.ARK_BMT_MALL = fil;
    rigg = await startaAppen({ ny: { verktyg: "Affärsprocess", text: AFFARSPROCESS_EXEMPEL } });
  }, 90_000);

  afterAll(async () => {
    await rigg?.stäng();
    if (tidigare === undefined) delete process.env.ARK_BMT_MALL;
    else process.env.ARK_BMT_MALL = tidigare;
  });

  it("laddar ner processen som modell i mallens namnrymd", async () => {
    const { page } = rigg;
    await page.locator("button.ark-vrad-knapp", { hasText: /^Export/ }).click();
    const knapp = page.locator("button", { hasText: "BMT (.bmt)" });
    await knapp.waitFor({ timeout: 10_000 });
    const [nedladdning] = await Promise.all([page.waitForEvent("download"), knapp.click()]);
    const sökväg = await nedladdning.path();
    expect(nedladdning.suggestedFilename()).toMatch(/\.bmt$/);

    const arkiv = await läsZip(new Uint8Array(readFileSync(sökväg!)));
    expect(Object.keys(arkiv)).toEqual(expect.arrayContaining(["config.xml", `users/${ANV}.xml`]));
    const modell = Object.entries(arkiv).find(([k]) => /^models\/[0-9a-f-]{36}\.xml$/.test(k));
    const xml = new TextDecoder().decode(modell![1]);
    expect(xml).toContain(`xmlns="${NS}"`);
    expect(xml).toContain('type="RACI_');
    // Namnen står i objekten (symbols/), inte i modellen.
    const objekt = Object.entries(arkiv)
      .filter(([k]) => k.startsWith("symbols/"))
      .map(([, v]) => new TextDecoder().decode(v));
    expect(objekt.some((o) => o.includes(">Genomför urval<"))).toBe(true);
    expect(rigg.fel).toEqual([]);
  }, 60_000);
});
