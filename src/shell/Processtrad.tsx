/**
 * Processträdet i menyn – strukturen medan man LÄSER en process.
 *
 * Katalogen är rätt yta för att leta upp något man inte vet var det finns: den
 * har plats för status, version, storlek och ålder. Men den är fel yta för det
 * man gör oftast, som är att gå vidare till nästa process i samma ärendetyp.
 * Då vill man se strukturen samtidigt som diagrammet, och byta med ett klick –
 * inte lämna processen, leta upp sin plats i en lista och gå tillbaka in.
 *
 * Trädet visas därför BARA i läsläge. Så fort man börjar redigera försvinner
 * det: då är det den öppna processen som gäller, och en lista över alla andra
 * är bara något att råka klicka på.
 *
 * Indelningen kommer ur `core/flow-tree.ts` och är exakt densamma som
 * katalogens – en process ska ligga på samma ställe var man än tittar.
 *
 * ALLT ÄR INFÄLLT UTOM DEN GREN MAN STÅR I. Med trettio processer i sex
 * ärendetyper blev ett utfällt träd en lista att skrolla i, och den öppna
 * processen kunde ligga utanför bild – menyn svarade alltså inte längre på
 * "var är jag?". Nu står grenen man läser öppen och resten hopfällda, så att
 * strukturen syns i sin helhet och sammanhanget syns på en gång.
 *
 * Ett eget klick väger alltid tyngre: fäller man ut en annan gren stannar den
 * ute, och fäller man ihop sin egen stannar den inne. Först när man öppnar en
 * process i en gren som man inte rört tar automatiken vid igen.
 */

import { useMemo, useState } from "react";
import type { FlowSummary } from "@/core/flow-store";
import { byggKategoriträd, filtreraKategorier } from "@/core/flow-tree";
import { statusEtikett } from "@/core/status";
import { NY_TIMMAR, ärNy } from "@/core/nyhet";
import { kategoriTitel } from "./katalog";
import { delaIYtor, vemsProcess, ägarnamn } from "@/core/behorighet";
import { useAnvändare } from "./Inloggning";

export interface ProcessträdProps {
  flöden: FlowSummary[];
  /** Processen som visas nu – markeras, så man ser var i strukturen man är. */
  aktivtFlöde: string | null;
  onÖppna: (id: string) => void;
  /** Klockan märket "ny" mäts mot. Förval: nu. Finns för testernas skull. */
  nu?: number;
}

const NY_TITEL = `Upplagd de senaste ${NY_TIMMAR} timmarna`;

export function Processträd({ flöden, aktivtFlöde, onÖppna, nu }: ProcessträdProps) {
  const [filter, setFilter] = useState("");
  /**
   * Grenar man SJÄLV fällt ut eller in, nyckel "kategori[/ärendetyp]".
   * Saknas nyckeln gäller automatiken nedan – därför `boolean` per gren och
   * inte en lista över de stängda: skillnaden mellan "stängd av mig" och
   * "inte öppnad än" är just det som avgör om ett eget val ska överleva att
   * man byter process.
   */
  const [manuellt, setManuellt] = useState<Record<string, boolean>>({});

  const användare = useAnvändare();
  /**
   * YTAN ÖVERST: gemensam katalog, Demo, Mina processer. Var en process ligger
   * avgör vem som ser och ändrar den, så den frågan ska besvaras innan man
   * letar i kategorierna. Inom varje yta är trädet detsamma som förut.
   */
  const ytor = useMemo(
    () =>
      delaIYtor(flöden, användare)
        .map((d) => ({ ...d, träd: filtreraKategorier(byggKategoriträd(d.flöden), filter) }))
        .filter((d) => d.träd.length > 0),
    [flöden, filter, användare],
  );
  /** Trädets kategorier, med ytan i nyckeln – samma kategori kan finnas i flera ytor. */
  const träd = useMemo(
    () => ytor.flatMap((d) => d.träd.map((kat) => ({ yta: d.id, kat }))),
    [ytor],
  );

  /**
   * Nycklarna på vägen ner till den öppna processen – kategorin och
   * ärendetypen den ligger i. De står utfällda utan att man bett om det.
   */
  const vägen = useMemo(() => {
    const nycklar = new Set<string>();
    if (!aktivtFlöde) return nycklar;
    for (const { yta, kat } of träd) {
      const katNyckel = `${yta}:${kat.kategori?.id ?? "utan"}`;
      for (const gren of kat.ärendetyper) {
        const träff = gren.målgrupper.some((m) => m.flöden.some((f) => f.flow.id === aktivtFlöde));
        if (träff) {
          nycklar.add(katNyckel);
          nycklar.add(`${katNyckel}/${gren.id}`);
        }
      }
    }
    return nycklar;
  }, [träd, aktivtFlöde]);

  /** Filtrerar man vill man se träffarna direkt, inte fälla ut dem själv. */
  const ärÖppen = (nyckel: string) =>
    filter.trim() ? true : (manuellt[nyckel] ?? vägen.has(nyckel));
  const växla = (nyckel: string, öppen: boolean) =>
    setManuellt((m) => ({ ...m, [nyckel]: !öppen }));

  if (flöden.length === 0) return null;

  return (
    <div className="ark-meny-avdelning ark-tradet">
      <div className="ark-meny-rubrik">Processer</div>
      <input
        className="ark-meny-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Sök process …"
        spellCheck={false}
        aria-label="Sök process i menyn"
      />

      {ytor.map((del) => (
        <div key={del.id} className={`ark-meny-yta ark-meny-yta--${del.id}`}>
          <div className="ark-meny-yta-titel" title={del.beskrivning}>
            {del.titel}
            <span className="ark-meny-yta-status">
              {del.fastslagna > 0 && <span className="ark-meny-yta-fast">{del.fastslagna} fastslagna</span>}
              {del.utkast > 0 && <span className="ark-meny-yta-utkast">{del.utkast} utkast</span>}
            </span>
          </div>
          {/* Vems processerna är syns utan att man fäller ut något. */}
          {del.id === "andras" && (
            <div className="ark-meny-yta-agare">{ägarnamn(del.flöden).join(", ")}</div>
          )}
      {del.träd.map((kat) => {
        const katNyckel = `${del.id}:${kat.kategori?.id ?? "utan"}`;
        const katÖppen = ärÖppen(katNyckel);
        return (
          <div key={katNyckel} className="ark-meny-kategori">
            <button
              className="ark-meny-kategori-titel"
              onClick={() => växla(katNyckel, katÖppen)}
              title={`${kat.antal} processer`}
            >
              <span className="ark-meny-pil">{katÖppen ? "▾" : "▸"}</span>
              {kategoriTitel(kat)}
              <span className="ark-meny-antal">{kat.antal}</span>
            </button>
            {katÖppen &&
              kat.ärendetyper.map((gren) => {
                const nyckel = `${katNyckel}/${gren.id}`;
                const öppen = ärÖppen(nyckel);
                return (
                  <div key={nyckel} className="ark-meny-gren">
                    <button
                      className="ark-meny-arende"
                      onClick={() => växla(nyckel, öppen)}
                      title={`${gren.antal} processer`}
                    >
                      <span className="ark-meny-pil">{öppen ? "▾" : "▸"}</span>
                      {gren.titel}
                      <span className="ark-meny-antal">{gren.antal}</span>
                    </button>
                    {öppen &&
                      gren.målgrupper.map((grupp) => (
                        <div key={grupp.id} className="ark-meny-malgrupp">
                          {/* Egna underkategorier har ingen målgruppsnivå – då
                              ska rubrikraden inte finnas alls, inte stå tom. */}
                          {grupp.titel && (
                            <div className="ark-meny-malgrupp-titel">{grupp.titel}</div>
                          )}
                          {grupp.flöden.map(({ flow, kortnamn }) => (
                            <button
                              key={flow.id}
                              className={`ark-flow-menyval ${
                                aktivtFlöde === flow.id ? "active" : ""
                              }`}
                              title={
                                `${flow.name} · ${flow.stepCount} steg · ` +
                                `${flow.versionCount} versioner` +
                                statusText(flow) +
                                (vemsProcess(flow) ? ` · Ägare: ${vemsProcess(flow)}` : "")
                              }
                              onClick={() => onÖppna(flow.id)}
                            >
                              <span className="ark-meny-namn">{kortnamn}</span>
                              {del.id === "andras" && flow.ägare?.namn && (
                                <span className="ark-meny-agare">{flow.ägare.namn}</span>
                              )}
                              {/* "ny" är samma etikett som beteckningen och
                                  står bara på processens egen rad –
                                  grenrubrikerna märks inte (beslut 2026-10-02). */}
                              {ärNy(flow.skapad, nu) && (
                                <span className="ark-meny-nymarke" title={NY_TITEL}>
                                  ny
                                </span>
                              )}
                              {/* Bara de FASTSLAGNA märks. Utkast är normalläget
                                  i biblioteket, och en prick på nästan varje rad
                                  hade slutat betyda något – det som ska sticka ut
                                  är att något faktiskt gäller. */}
                              {flow.status === "fastslagen" && (
                                <span className="ark-meny-fastslagen" title="Fastslagen">
                                  {flow.beteckning}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      ))}
                  </div>
                );
              })}
          </div>
        );
      })}
        </div>
      ))}

      {träd.length === 0 && <p className="ark-meny-tomt">Ingen process matchar sökningen.</p>}
    </div>
  );
}

/**
 * Statusdelen av radens hovertext. Utkast nämns också – i en titel kostar det
 * ingenting, och frågan "gäller det här?" ska gå att få svar på utan att öppna
 * processen.
 */
function statusText(flow: FlowSummary): string {
  if (!flow.beteckning) return "";
  const status = statusEtikett(flow.status);
  const fast =
    flow.status !== "fastslagen" && flow.fastslagenBeteckning
      ? ` · senast fastslagen ${flow.fastslagenBeteckning}`
      : "";
  return ` · ${status} ${flow.beteckning}${fast}`;
}
