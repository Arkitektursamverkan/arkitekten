/**
 * Figurförteckningen för flödesschemat: vilka BPMN-former och vilka sorters
 * pilar som FAKTISKT står i den öppna processen.
 *
 * Formerna ritas av `form-ikon.ts` och färgerna kommer ur `theme` – samma
 * moduler som ritytan och SVG-exporten läser. Förteckningen kan alltså inte
 * visa en annan symbol eller en annan färg än den som står i bilden, och den
 * följer med i färglägesbytet: i strikt BPMN är faktarutans former lika
 * färglösa som diagrammets.
 */

import type { ProcessModel, NodeType } from "@/core/model";
import { linjeIkon, LINJE_MÅTT, type FigurGrupp } from "@/core/figurer";
import { banIkonSvg, formIkonSvg, svartLådaIkonSvg, FORM_IKON_MÅTT } from "./form-ikon";
import { EDGE_STROKE, TYPE_BETYDELSE, TYPE_LABEL, TYPE_ORDNING, type ColorMode } from "./theme";

/**
 * Grupperna i faktarutan. Tomma grupper faller bort: en rubrik utan rader
 * säger ingenting om just den här bilden.
 */
export function flödesFigurer(model: ProcessModel, colorMode: ColorMode): FigurGrupp[] {
  const antal = new Map<NodeType, number>();
  for (const n of model.nodes) antal.set(n.type, (antal.get(n.type) ?? 0) + 1);
  // Datalagret är en ARTEFAKT utanför sekvensflödet och bor i en egen lista –
  // men det är samma cylinder i bilden, så det räknas in på samma rad.
  if (model.dataStores.length > 0) {
    antal.set("datastore", (antal.get("datastore") ?? 0) + model.dataStores.length);
  }

  const grupper: FigurGrupp[] = [];

  if (antal.size > 0) {
    grupper.push({
      titel: "Objekt",
      figurer: TYPE_ORDNING.filter((t) => antal.has(t)).map((typ) => ({
        nyckel: typ,
        namn: TYPE_LABEL[typ],
        betydelse: TYPE_BETYDELSE[typ],
        antal: antal.get(typ) ?? 0,
        svg: formIkonSvg(typ, colorMode),
        ...FORM_IKON_MÅTT,
      })),
      hint:
        colorMode === "bpmn"
          ? "Strikt BPMN är färglöst: formen och ikonen bär typen, färgen betyder ingenting."
          : undefined,
    });
  }

  const sekvens = model.edges.filter((e) => e.kind !== "message").length;
  const kopplingar: FigurGrupp["figurer"] = [];
  if (sekvens > 0) {
    kopplingar.push({
      nyckel: "sequence",
      namn: "Sekvensflöde",
      betydelse: "Ordningen stegen utförs i. Svaret på ett beslut står på pilen.",
      antal: sekvens,
      svg: linjeIkon({ färg: EDGE_STROKE }),
      ...LINJE_MÅTT,
    });
  }
  if (model.messageFlows.length > 0) {
    kopplingar.push({
      nyckel: "message",
      namn: "Meddelandeflöde",
      betydelse: "Ett utskick till en annan deltagare – mejl, Teams-meddelande, notis.",
      antal: model.messageFlows.length,
      svg: linjeIkon({ färg: EDGE_STROKE, streckad: "6 4", öppenSpets: true }),
      ...LINJE_MÅTT,
    });
  }
  if (model.dataAssociations.length > 0) {
    kopplingar.push({
      nyckel: "data",
      namn: "Dataassociation",
      betydelse: "Aktiviteten läser eller skriver i ett datalager. Bär aldrig flödet vidare.",
      antal: model.dataAssociations.length,
      svg: linjeIkon({ färg: EDGE_STROKE, streckad: "5 4", öppenSpets: true }),
      ...LINJE_MÅTT,
    });
  }
  if (kopplingar.length > 0) grupper.push({ titel: "Kopplingar", figurer: kopplingar });

  const svartaLådor = model.pools.filter((p) => p.blackBox);
  const bilden: FigurGrupp["figurer"] = [];
  if (model.swimlanes.length > 0) {
    bilden.push({
      nyckel: "bana",
      namn: "Bana",
      betydelse: "Aktören eller systemet som UTFÖR stegen i bandet.",
      antal: model.swimlanes.length,
      svg: banIkonSvg(),
      ...FORM_IKON_MÅTT,
    });
  }
  if (svartaLådor.length > 0) {
    bilden.push({
      nyckel: "svartlada",
      namn: "Svart låda",
      betydelse: "En mottagare vars inre processen inte beskriver – dit går bara meddelandeflöden.",
      antal: svartaLådor.length,
      svg: svartLådaIkonSvg(),
      ...FORM_IKON_MÅTT,
    });
  }
  if (bilden.length > 0) grupper.push({ titel: "Bilden", figurer: bilden });

  return grupper;
}
