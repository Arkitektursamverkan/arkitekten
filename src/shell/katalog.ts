/**
 * Delade benämningar för de två ytorna som visar biblioteket: menyns
 * processträd och processkatalogen.
 *
 * Båda ritar samma träd ur `core/flow-tree.ts`, och båda måste kunna sätta en
 * rubrik på en gren som saknar kategori. Skrev de var sin egen hade de förr
 * eller senare kallat samma sak olika saker – och en användare som ser
 * "Utan kategori" i menyn och "Affärsprocess" i katalogen tror att det är två olika
 * samlingar.
 */

import { flowFamily, type FlowFamily } from "@/core/flow-store";
import type { KategoriGren } from "@/core/flow-tree";
import { TOOLS } from "./tools";

/** Verktygets namn för en familj – katalogen spänner över båda biblioteken. */
export function verktygsNamn(family: FlowFamily): string {
  return TOOLS.find((t) => t.family === family)?.name ?? family;
}

/**
 * Grenens rubrik. Saknar den kategori namnges den efter VERKTYGET som äger
 * flödena – "Utan kategori" säger ingenting om vad man tittar på, medan
 * "Affärsprocess" gör det. (Affärsprocesserna hör inte till någon av
 * portalens kategorier; se flow-tree.ts.)
 */
export function kategoriTitel(kat: KategoriGren): string {
  if (kat.kategori) return kat.kategori.titel;
  const första = kat.ärendetyper[0]?.målgrupper[0]?.flöden[0]?.flow;
  return första ? verktygsNamn(flowFamily(första.id)) : "Övriga";
}
