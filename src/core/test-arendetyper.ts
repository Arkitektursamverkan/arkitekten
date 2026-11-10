/**
 * PÅHITTADE ärendetyper för testerna.
 *
 * Standardlistan i `flow-tree.ts` är en viss installations portal. Testerna
 * ska inte bära den organisationens processnamn, så de sätter den här
 * neutrala uppsättningen i stället – med samma form som standardlistan: ett
 * prefix som måste skiljas från ett sammansatt ("driftfraga-och-…"), en
 * sammansatt titel ("Reklamation och skador") och reservgrenen sist.
 *
 *   beforeEach(användTestärendetyper);
 *   afterEach(återställÄrendetyper);
 */

import { sättÄrendetyper, type Ärendetyp } from "./flow-tree";

export const TEST_ÄRENDETYPER: Ärendetyp[] = [
  {
    id: "driftfraga",
    titel: "Driftfråga",
    test: (id) => id.startsWith("driftfraga") && !id.startsWith("driftfraga-och-"),
  },
  { id: "inkopsorder", titel: "Inköpsorder", test: (id) => id.startsWith("inkopsorder") },
  {
    id: "verksamhetsforslag",
    titel: "Verksamhetsförslag",
    test: (id) => id.startsWith("verksamhetsforslag"),
  },
  { id: "reklamation", titel: "Reklamation och skador", test: (id) => id.startsWith("reklamation") },
  { id: "gemensamt", titel: "Gemensamt", test: () => true },
];

export function användTestärendetyper(): void {
  sättÄrendetyper(TEST_ÄRENDETYPER);
}

export function återställÄrendetyper(): void {
  sättÄrendetyper(null);
}
