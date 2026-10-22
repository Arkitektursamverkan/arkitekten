/**
 * Text → ProcessModel.
 *
 * Sedan mellanlagret infördes är detta bara en sammansättning av två steg:
 *   text → ProcessDraft   (textToDraft – regelstyrd tolkning)
 *   draft → ProcessModel  (compileDraft – deterministisk kompilering)
 *
 * Samma kompilering används för AI-tolkade drafter, så diagrammet ritas
 * likadant oavsett var tolkningen kom ifrån. Behåll `parseToModel` som publik
 * ingång – editor, export och tester använder den.
 */

import { compileDraft } from "@/core/draft";
import type { ProcessModel } from "@/core/model";
import { textToDraft } from "./toDraft";

export { textToDraft } from "./toDraft";

/** Parsa fri text till en komplett ProcessModel. */
export function parseToModel(input: string): ProcessModel {
  return compileDraft(textToDraft(input));
}
