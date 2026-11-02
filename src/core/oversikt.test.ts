/**
 * ÖVERSIKTSBILDERNA ska stämma med biblioteket.
 *
 * En karta som ritats en gång är sann den dagen. Tillkommer ett flöde syns det
 * i menyn men inte i kartan, och ingen märker att kartan börjat ljuga. Testet
 * räknar: varje ärendetyp ska ha en översikt, och den ska ha lika många boxar
 * som ärendetypen har processer.
 *
 * Texterna jämförs INTE. Den handskrivna utvecklingsförslagskartan säger
 * "Nytt utvecklingsförslag" där den härledda skulle säga "Nytt" – båda är
 * riktiga, och en formuleringsspärr hade bara gjort testet till en boja.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ÄRENDETYPER, ärendetypFör } from "./flow-tree";
import { flowFamily } from "./flow-store";
import type { ProcessDraft } from "./draft";

const KATALOG = path.resolve(__dirname, "../../flows");

interface Fil {
  id: string;
  name: string;
  draft: ProcessDraft;
}

/** Testerna läser en viss installations flöden, som inte ligger i git. Utan dem, som i en ren klon eller med bara exempelpaketet, hoppas de över. */
const HAR_FLÖDEN = fs.existsSync(path.join(KATALOG, "avvikelse-byt-avdelning.json"));

function alla(): Fil[] {
  if (!HAR_FLÖDEN) return [];
  return fs
    .readdirSync(KATALOG)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(KATALOG, f), "utf8")) as Fil)
    .filter((f) => flowFamily(f.id) === "flode");
}

const FILER = alla();
const ÖVERSIKTER = FILER.filter((f) => f.id.includes("oversikt"));
const FLÖDEN = FILER.filter((f) => !f.id.includes("oversikt"));

/** Samma regel som generatorn: delade flöden räknas i BÅDA ärendetyperna. */
function processerFör(typId: string): Fil[] {
  const typ = ÄRENDETYPER.find((t) => t.id === typId)!;
  return FLÖDEN.filter(
    (f) =>
      ärendetypFör(f.id).id === typId ||
      f.name.toLowerCase().startsWith(`${typ.titel.toLowerCase()} och `) ||
      f.name.toLowerCase().includes(` och ${typ.titel.toLowerCase()} `),
  );
}

describe.skipIf(!HAR_FLÖDEN)("översikter per ärendetyp", () => {
  const ärendetyper = ÄRENDETYPER.filter((t) => t.id !== "gemensamt");

  for (const typ of ärendetyper) {
    const processer = processerFör(typ.id);
    if (processer.length === 0) continue;

    describe(typ.titel, () => {
      const karta = ÖVERSIKTER.find((f) => ärendetypFör(f.id).id === typ.id);

      it("har en översiktsbild", () => {
        expect(karta, `${typ.titel} saknar en översikt`).toBeDefined();
      });

      it("kartan visar alla ärendetypens processer", () => {
        if (!karta) return;
        // Boxarna är stegen minus slut-eventet, som notationen kräver men
        // kartan inte har något innehåll i.
        const boxar = karta.draft.steps.filter((s) => s.type !== "end");
        expect(boxar.length).toBe(processer.length);
      });

      it("varje box bär sitt villkor som not", () => {
        if (!karta) return;
        const utan = karta.draft.steps
          .filter((s) => s.type !== "end" && !s.note)
          .map((s) => s.text);
        expect(utan).toEqual([]);
      });

      it("kartan har inga pilar – den visar vad som finns, inte i vilken ordning", () => {
        if (!karta) return;
        expect(karta.draft.extraEdges ?? []).toEqual([]);
        expect((karta.draft.removedEdges ?? []).length).toBe(karta.draft.steps.length - 1);
      });
    });
  }
});
