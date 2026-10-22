/**
 * Verktygsregister för Arkitekten-plattformen.
 * Nya verktyg (förmågekartor, integrationsöversikter, ...) läggs till här –
 * skalet behöver inte ändras. Flödesschema är första verktyget.
 */

import type { ReactNode } from "react";
import type { Yta } from "@/core/behorighet";
import type { RamserieSammanfattning } from "@/core/ram";
import { flowFamily, type FlowFamily, type FlowSummary, type Placering } from "@/core/flow-store";
import { ApTool } from "@/tools/affarsprocess/ApTool";
import { FlowchartTool } from "@/tools/flowchart/FlowchartTool";

/**
 * Begäran om att öppna ett sparat flöde ur menyn. `nonce` gör att SAMMA flöde
 * kan öppnas igen – utan den hade en ny begäran med samma id sett oförändrad
 * ut för React, och effekten aldrig körts om.
 */
export interface ÖppnaFlöde {
  id: string;
  nonce: number;
}

/** Vad en ny process utgår ifrån. Se `NyProcess`. */
export type NyProcessStart = "regler" | "mall" | "ai" | "tom";

/**
 * Begäran om att BÖRJA en ny process, från vyn "Ny process".
 *
 * Vyn tolkar ingenting själv – den samlar bara in valen. Verktyget äger
 * mellanlagret, och regeln att bara det får fylla det gäller lika mycket för
 * en ny process som för en inläst text (se CLAUDE.md: AI:n ritar aldrig, och
 * ingen annan än verktyget kompilerar).
 *
 * `nonce` av samma skäl som ovan: två nya processer i följd kan ha identiska
 * fält, och då hade effekten aldrig körts om.
 */
export interface NyProcessBegäran {
  namn: string;
  /**
   * Kategorin i katalogen – trädets översta nivå. Tom sträng = ingen egen, då
   * gäller reglerna i flow-tree.ts (ett flödesschema hamnar under
   * portalen, en affärsprocess under sitt verktyg).
   */
  kategori: string;
  /**
   * Underkategorin – nivån under kategorin. Tom sträng = de härledda nivåerna
   * (ärendetyp → målgrupp) gäller, precis som för portalens flöden.
   */
  underkategori: string;
  /** Beskrivningen som ska tolkas. Tom för "mall" och "tom". */
  text: string;
  start: NyProcessStart;
  nonce: number;
}

/**
 * Läget en öppen process visas i.
 *
 * "läser"     – man tittar på processen. Ritytan är låst, ritverktygen är
 *               borta, och menyn visar STRUKTUREN så att nästa process är ett
 *               klick bort.
 * "redigerar" – man ändrar. Då gäller den öppna processen och ingenting annat:
 *               verktygsraden fylls på och menyns träd fälls undan.
 *
 * Att öppna något är alltså inte samma sak som att börja ändra i det. Utan den
 * skillnaden låg ritverktygen framme jämt – också när man bara ville läsa – och
 * strukturen tog plats mitt i ett ritarbete.
 */
export type Arbetsläge = "läser" | "redigerar";

/** Allt skalet skickar in i ett verktyg. */
export interface VerktygsProps {
  öppnaFlöde: ÖppnaFlöde | null;
  nyProcess: NyProcessBegäran | null;
  /**
   * Verktyget har TAGIT EMOT begäran om en ny process. Skalet släpper den då,
   * så att den aldrig kan spelas upp en gång till – se `ärNyBegäran` i shell/begaran.ts.
   */
  onNyProcessMottagen: () => void;
  läge: Arbetsläge;
  onLäge: (läge: Arbetsläge) => void;
  /**
   * Biblioteket som det ser ut nu – verktyget behöver det för att kunna
   * erbjuda de kategorier och grenar som FINNS när man flyttar processen.
   */
  flöden: FlowSummary[];
  /**
   * Flytta den öppna processen i katalogen. Skalet äger lagringen och läser om
   * listan efteråt, precis som för sparningarna.
   *
   * Varför verktyget alls kan flytta: man står i processen man vill flytta.
   * Att först lämna den, leta upp den i katalogen och flytta den där är en
   * omväg – och den som inte hittade knappen på kortet hittade ingen väg alls
   * (beslut 2026-09-07).
   */
  onFlytta: (id: string, placering: Placering, till?: Yta) => Promise<void> | void;
  /**
   * Öppna ett ANNAT sparat flöde, respektive en ramserie i Ramar. Verktyget
   * som just låtit AI:n göra en förenklad process och en presentation
   * (tools/ramar/PresentationsKnapp.tsx) ska kunna visa resultatet – men det
   * är skalet som äger navigeringen.
   */
  onÖppnaFlöde: (id: string) => void;
  onÖppnaRamserie: (id: string) => void;
  /**
   * Visualiseringarna (ramserierna) som finns. Verktyget visar "Öppna i
   * Visualisering" när någon av dem bygger på den öppna processen.
   */
  ramserier: RamserieSammanfattning[];
}

export interface ArkTool {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Verktygets familj i den delade lagringen. Saknas = inget eget bibliotek. */
  family?: FlowFamily;
  /** null = ännu inte byggt (visas som "kommer snart"). */
  render: ((props: VerktygsProps) => ReactNode) | null;
}

export const TOOLS: ArkTool[] = [
  {
    id: "flowchart",
    name: "Systemprocess",
    icon: "⇄",
    description: "Text → deterministiskt systemprocessdiagram med banor.",
    family: "flode",
    render: (props) => <FlowchartTool {...props} />,
  },
  {
    id: "affarsprocess",
    name: "Affärsprocess",
    icon: "➤",
    description: "Förädlingskedja med roller, objekt och IT-stöd som satelliter.",
    family: "affarsprocess",
    render: (props) => <ApTool {...props} />,
  },
  {
    id: "capability-map",
    name: "Förmågekarta",
    icon: "▦",
    description: "Verksamhetsförmågor i nivåer. (Kommer)",
    render: null,
  },
  {
    id: "integration-map",
    name: "Integrationsöversikt",
    icon: "⌗",
    description: "System och integrationer i landskapet. (Kommer)",
    render: null,
  },
];

/**
 * Verktyget som äger ett flödes-id. Familjen läses ur `flowFamily` – prefixet
 * bor i flow-store och får inte upprepas här (invariant 1: en regel, en plats).
 */
export function verktygFörFlöde(id: string): ArkTool | undefined {
  const family: FlowFamily = flowFamily(id);
  return TOOLS.find((t) => t.family === family);
}
