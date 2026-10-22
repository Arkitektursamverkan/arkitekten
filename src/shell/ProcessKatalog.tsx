/**
 * Processkatalogen – vägen till allt som redan finns.
 *
 * Tidigare bodde hela flödesträdet i menyn: kategori → ärendetyp → målgrupp →
 * flöde, trettio rader i en 300 px smal spalt. Grupperingen var rätt, men
 * platsen var fel. En rad rymde inte mer än ett avhugget namn, så frågorna man
 * faktiskt ställer – "vilka av de här är fastslagna?", "vilken ändrades sist?",
 * "hur stor är den?" – gick inte att besvara utan att öppna varje flöde.
 *
 * Katalogen får därför hela huvudytan. Samma indelning som förut (den kommer
 * ur `core/flow-tree.ts` och delas med översiktsbilderna), men med plats för
 * det som skiljer processerna åt: målgrupp, status, version, storlek, ålder.
 *
 * TVÅ LÄGEN, för de två sätten att leta:
 *  - Grupperat: man vet ungefär VAD man söker (ärendetyp, målgrupp).
 *  - Senast ändrade: man vet att man höll på med det nyligen.
 *
 * Komponenten äger ingen flödesdata – den får listan och rapporterar klick.
 */

import { useMemo, useState } from "react";
import { flowFamily, type FlowFamily, type FlowSummary, type Placering } from "@/core/flow-store";
import {
  byggKategoriträd,
  filtreraKategorier,
  kategoriAvTitel,
  underkategoriId,
  type ÄrendeGren,
  ärendetypFör,
  kortnamn,
} from "@/core/flow-tree";
import { Flyttadialog, FlyttaIkon } from "./Flyttadialog";
import { kategoriTitel, verktygsNamn } from "./katalog";
import { statusDef } from "@/core/status";
import {
  delaIYtor,
  kanByttaYta,
  kanRedigera,
  vemsProcess,
  ägarnamn,
  ytgruppFör,
  ytgruppTitel,
  type Yta,
  type Ytgrupp,
} from "@/core/behorighet";
import { useAnvändare, useInloggningsläge } from "./Inloggning";

export interface ProcessKatalogProps {
  flöden: FlowSummary[];
  /** Flödet som redigeras just nu – markeras så man ser var man är. */
  aktivtFlöde: string | null;
  onÖppna: (id: string) => void;
  onNy: () => void;
  /** true medan biblioteket läses – tomma listan betyder då inte "inga flöden". */
  laddar?: boolean;
  /**
   * Flyttar EN process i katalogen. Katalogen äger strukturen: det är här man
   * ser den, och därför här man ska kunna ändra den.
   */
  onFlytta?: (id: string, placering: Placering, till?: Yta) => Promise<void> | void;
  /**
   * Byter namn på en gren – ändringen skrivs på ALLA processer i den. En gren
   * finns bara som ett fält på sina flöden, så namnbytet ÄR den skrivningen.
   */
  onDöpOmGren?: (ids: string[], ändring: Placering) => Promise<void> | void;
}

type Läge = "grupperat" | "senaste";
type StatusFilter = "alla" | "fastslagen" | "utkast";

export function ProcessKatalog({
  flöden,
  aktivtFlöde,
  onÖppna,
  onNy,
  laddar = false,
  onFlytta,
  onDöpOmGren,
}: ProcessKatalogProps) {
  const [fråga, setFråga] = useState("");
  const [läge, setLäge] = useState<Läge>("grupperat");
  const [familj, setFamilj] = useState<FlowFamily | "alla">("alla");
  const [status, setStatus] = useState<StatusFilter>("alla");
  /** Grenen vars namn skrivs om just nu (nyckel ur trädet) och texten så långt. */
  const [döper, setDöper] = useState<{ nyckel: string; text: string } | null>(null);
  /** Processen som ska flyttas – null när dialogen är stängd. */
  const [flyttar, setFlyttar] = useState<FlowSummary | null>(null);
  /**
   * VAR I STRUKTUREN man står: null = översta nivån (samlingarna).
   *
   * Katalogen visade hela biblioteket utrullat, alla kategorier och alla
   * grenar på en gång. Med sjuttio processer blev vägen ner i strukturen en
   * lång skrollning – man letade efter en rubrik i stället
   * för att gå dit. Nu visas EN nivå i taget och brödsmulan bär vägen tillbaka.
   */
  const [stig, setStig] = useState<{ yta: Ytgrupp | null; kat: string | null; gren: string | null }>({
    yta: null,
    kat: null,
    gren: null,
  });
  const användare = useAnvändare();
  const inloggning = useInloggningsläge();
  /** Strukturen ändras bara när skalet gett oss vägarna att göra det. */
  const kanÄndra = Boolean(onFlytta && onDöpOmGren);

  /** Allt som klarar verktygs- och statusfiltret. Sökningen sker längre ner. */
  const urval = useMemo(
    () =>
      flöden.filter((f) => {
        if (familj !== "alla" && flowFamily(f.id) !== familj) return false;
        if (status === "fastslagen" && f.status !== "fastslagen") return false;
        if (status === "utkast" && f.status === "fastslagen") return false;
        return true;
      }),
    [flöden, familj, status],
  );

  /**
   * YTAN är katalogens översta nivå: gemensam katalog, Demo, Mina processer
   * (core/behorighet.ts). Den avgör vem som ser och ändrar en process, så den
   * står först – och med sin status, så att man ser vad som gäller.
   */
  const ytor = useMemo(
    () =>
      delaIYtor(urval, användare)
        .map((d) => ({ ...d, träd: filtreraKategorier(byggKategoriträd(d.flöden), fråga) }))
        .filter((d) => d.träd.length > 0),
    [urval, fråga, användare],
  );

  /** Platt lista, nyast först – för läget "Senast ändrade". */
  const senaste = useMemo(() => {
    const q = fråga.trim().toLowerCase();
    return urval
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  }, [urval, fråga]);

  /**
   * SÖKNING PLATTAR UT. Söker man vet man inte var något ligger – då är
   * strukturen i vägen, och träffarna ska stå i en enda lista med sitt
   * sammanhang på kortet. Samma lista som "Senast ändrade".
   */
  const plattLista = läge === "senaste" || Boolean(fråga.trim());

  /** Kategorin man står i, och grenen i den. Försvinner de faller vi till roten. */
  const valdYta = stig.yta ? (ytor.find((d) => d.id === stig.yta) ?? null) : null;
  const valdKategori =
    valdYta && stig.kat
      ? (valdYta.träd.find((k) => (k.kategori?.id ?? "utan") === stig.kat) ?? null)
      : null;
  const valdGren =
    valdKategori && stig.gren
      ? (valdKategori.ärendetyper.find((g) => g.id === stig.gren) ?? null)
      : null;

  const antalTräffar =
    plattLista ? senaste.length : ytor.reduce((n, d) => n + d.träd.reduce((m, k) => m + k.antal, 0), 0);
  /** Är något filter satt? Styr om tomma katalogen erbjuder att nollställa. */
  const filtrerat = Boolean(fråga.trim()) || familj !== "alla" || status !== "alla";

  const nollställ = () => {
    setFråga("");
    setFamilj("alla");
    setStatus("alla");
    setStig({ yta: null, kat: null, gren: null });
  };
  /** Får jag flytta processen – inom sin yta eller till en annan? */
  const kanFlyttas = (f: FlowSummary) =>
    kanÄndra && (kanRedigera(användare, f) || (["gemensam", "demo", "egen"] as Yta[]).some((y) => kanByttaYta(användare, f, y)));
  /** En gren döps om på ALLA processer i den – då måste man få ändra dem alla. */
  const kanDöpaOmAlla = (grenar: ÄrendeGren[]) =>
    kanÄndra &&
    grenar.every((g) => g.målgrupper.every((m) => m.flöden.every((f) => kanRedigera(användare, f.flow))));
  const harEgna = ytor.some((d) => d.id === "egen");

  return (
    <div className="ark-katalog">
      <header className="ark-katalog-topp">
        <div>
          <h1 className="ark-katalog-rubrik">Processkatalog</h1>
          <p className="ark-katalog-underrubrik">
            {laddar
              ? "Läser biblioteket …"
              : `${flöden.length} ${flöden.length === 1 ? "process" : "processer"} i biblioteket` +
                (filtrerat ? ` · ${antalTräffar} visas` : "")}
          </p>
          {/* Strukturen ändras HÄR, men knapparna är små och sitter på kortet
              respektive rubriken. Utan den här raden hittade man dem inte. */}
          {kanÄndra && (
            <p className="ark-katalog-hjalp">
              Flytta en process med mappknappen på kortet – också från Mina processer till
              den gemensamma katalogen · byt namn på en samling med ✎ vid rubriken.
              Innehållet rörs inte och det blir ingen ny version.
            </p>
          )}
        </div>
        <button className="ark-btn ark-btn--primary" onClick={onNy}>
          ✚ Ny process
        </button>
      </header>

      <div className="ark-katalog-filter">
        <input
          className="ark-input ark-katalog-sok"
          value={fråga}
          onChange={(e) => setFråga(e.target.value)}
          placeholder="Sök process …"
          spellCheck={false}
          aria-label="Sök process"
        />
        <div className="ark-segment" role="group" aria-label="Verktyg">
          <button className={familj === "alla" ? "active" : ""} onClick={() => setFamilj("alla")}>
            Alla verktyg
          </button>
          <button className={familj === "flode" ? "active" : ""} onClick={() => setFamilj("flode")}>
            Systemprocess
          </button>
          <button className={familj === "affarsprocess" ? "active" : ""} onClick={() => setFamilj("affarsprocess")}>
            Affärsprocess
          </button>
        </div>
        <div className="ark-segment" role="group" aria-label="Status">
          <button className={status === "alla" ? "active" : ""} onClick={() => setStatus("alla")}>
            Alla
          </button>
          <button
            className={status === "fastslagen" ? "active" : ""}
            onClick={() => setStatus("fastslagen")}
            title="Bara de versioner som gäller"
          >
            Fastslagna
          </button>
          <button
            className={status === "utkast" ? "active" : ""}
            onClick={() => setStatus("utkast")}
            title="Arbetsmaterial som inte är fastslaget"
          >
            Utkast
          </button>
        </div>
        <div className="ark-segment" role="group" aria-label="Ordning">
          <button
            className={läge === "grupperat" ? "active" : ""}
            onClick={() => setLäge("grupperat")}
          >
            Grupperat
          </button>
          <button className={läge === "senaste" ? "active" : ""} onClick={() => setLäge("senaste")}>
            Senast ändrade
          </button>
        </div>
      </div>

      {!plattLista && (
        <nav className="ark-smulor" aria-label="Var i strukturen">
          <button
            className="ark-smula"
            onClick={() => setStig({ yta: null, kat: null, gren: null })}
            disabled={!valdKategori}
          >
            Alla samlingar
          </button>
          {valdKategori && (
            <>
              <span className="ark-smulpil" aria-hidden>
                ›
              </span>
              <span className="ark-smula ark-smula--yta">{valdYta?.titel}</span>
              <span className="ark-smulpil" aria-hidden>
                ›
              </span>
              <button
                className="ark-smula"
                onClick={() => setStig({ yta: stig.yta, kat: stig.kat, gren: null })}
                disabled={!valdGren}
              >
                {kategoriTitel(valdKategori)}
              </button>
            </>
          )}
          {valdGren && (
            <>
              <span className="ark-smulpil" aria-hidden>
                ›
              </span>
              <span className="ark-smula ark-smula--har">{valdGren.titel}</span>
            </>
          )}
        </nav>
      )}

      <div className="ark-katalog-kropp">
        {antalTräffar === 0 ? (
          <div className="ark-katalog-tomt">
            {laddar ? (
              <p>Läser biblioteket …</p>
            ) : filtrerat ? (
              <>
                <p>Ingen process matchar det du sökt.</p>
                <button className="ark-linkbtn" onClick={nollställ}>
                  Nollställ filtren
                </button>
              </>
            ) : (
              <>
                <p>Biblioteket är tomt än så länge.</p>
                <button className="ark-btn ark-btn--primary" onClick={onNy}>
                  ✚ Skapa den första processen
                </button>
              </>
            )}
          </div>
        ) : plattLista ? (
          <div className="ark-kortrutnat">
            {senaste.map((flow) => (
              <ProcessKort
                key={flow.id}
                flow={flow}
                aktiv={flow.id === aktivtFlöde}
                onÖppna={onÖppna}
                onFlytta={kanFlyttas(flow) ? () => setFlyttar(flow) : undefined}
                yta={ytgruppFör(användare, flow)}
                visaSammanhang
              />
            ))}
          </div>
        ) : !valdKategori ? (
          /* NIVÅ 1: ytorna, och samlingarna i var och en. */
          <>
            {ytor.map((del) => (
              <section key={del.id} className={`ark-katalog-yta ark-katalog-yta--${del.id}`}>
                <header className="ark-katalog-yta-topp">
                  <h2 className="ark-katalog-yta-rubrik">{del.titel}</h2>
                  <span className="ark-katalog-yta-status">
                    {del.fastslagna > 0 && (
                      <span className="ark-status-pill fastslagen">{del.fastslagna} fastslagna</span>
                    )}
                    {del.utkast > 0 && <span className="ark-status-pill utkast">{del.utkast} utkast</span>}
                  </span>
                  <p className="ark-katalog-yta-text">{del.beskrivning}</p>
                  {del.id === "andras" && (
                    <p className="ark-katalog-yta-agare">Ägare: {ägarnamn(del.flöden).join(", ")}</p>
                  )}
                </header>
                <div className="ark-nivalista">
                  {del.träd.map((kat) => {
                    const nyckel = kat.kategori?.id ?? "utan";
                    return (
                      <Nivårad
                        key={nyckel}
                        titel={kategoriTitel(kat)}
                        nyckel={`${del.id}:${nyckel}`}
                        antal={kat.antal}
                        under={sammanfattaGrenar(kat.ärendetyper)}
                        onÖppna={() => setStig({ yta: del.id, kat: nyckel, gren: null })}
                        kanDöpaOm={kanDöpaOmAlla(kat.ärendetyper)}
                        döper={döper}
                        setDöper={setDöper}
                        hjälp={
                          kat.kategori
                            ? "Byter namn på kategorin för alla processer i den."
                            : // Samlingen finns bara som "de som saknar kategori" och
                              // namnges efter verktyget. Ett namn ÄR det som gör den
                              // till en riktig kategori – därför går den att döpa om.
                              "Samlingen heter efter verktyget idag. Ger du den ett namn blir den en egen kategori."
                        }
                        onDöpOm={(nyttNamn) => {
                          if (!bekräfta(nyttNamn, kat.antal)) return;
                          void onDöpOmGren?.(idIGren(kat.ärendetyper), { category: nyttNamn });
                          setStig({ yta: del.id, kat: kategoriAvTitel(nyttNamn).id, gren: null });
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
            {/* Mina processer finns alltid när man är inloggad – också tom, så
                att man vet var det man skapar hamnar. */}
            {inloggning !== "öppen" && !harEgna && !filtrerat && (
              <section className="ark-katalog-yta ark-katalog-yta--egen">
                <header className="ark-katalog-yta-topp">
                  <h2 className="ark-katalog-yta-rubrik">{ytgruppTitel("egen")}</h2>
                  <p className="ark-katalog-yta-text">
                    Du har inga egna processer än. Allt du skapar hamnar här och syns bara för dig,
                    tills du flyttar det till den gemensamma katalogen.
                  </p>
                </header>
              </section>
            )}
          </>
        ) : !valdGren ? (
          /* NIVÅ 2: grenarna i samlingen. */
          <div className="ark-nivalista">
            {valdKategori.ärendetyper.map((gren) => (
              <Nivårad
                key={gren.id}
                titel={gren.titel}
                nyckel={`${stig.yta}:${stig.kat}/${gren.id}`}
                antal={gren.antal}
                under={gren.målgrupper
                  .map((m) => m.titel)
                  .filter(Boolean)
                  .join(" · ")}
                onÖppna={() => setStig({ yta: stig.yta, kat: stig.kat, gren: gren.id })}
                kanDöpaOm={kanDöpaOmAlla([gren])}
                döper={döper}
                setDöper={setDöper}
                hjälp={
                  gren.egen
                    ? "Byter namn på underkategorin för alla processer i den."
                    : "Grenen delas in automatiskt idag. Ger du den ett namn blir den din egen underkategori."
                }
                onDöpOm={(nyttNamn) => {
                  if (!bekräfta(nyttNamn, gren.antal)) return;
                  void onDöpOmGren?.(idIGren([gren]), { subcategory: nyttNamn });
                  setStig({ yta: stig.yta, kat: stig.kat, gren: underkategoriId(nyttNamn) });
                }}
              />
            ))}
          </div>
        ) : (
          /* NIVÅ 3: processerna i grenen. */
          valdGren.målgrupper.map((grupp) => (
            <div key={grupp.id} className="ark-katalog-malgrupp">
              {/* En egen underkategori har ingen målgruppsnivå, och då hör
                  ingen rubrik hit. */}
              {grupp.titel && <h4 className="ark-katalog-malgrupptxt">{grupp.titel}</h4>}
              <div className="ark-kortrutnat">
                {grupp.flöden.map(({ flow, kortnamn: kort }) => (
                  <ProcessKort
                    key={flow.id}
                    flow={flow}
                    kort={kort}
                    aktiv={flow.id === aktivtFlöde}
                    onÖppna={onÖppna}
                    onFlytta={kanFlyttas(flow) ? () => setFlyttar(flow) : undefined}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {flyttar && (
        <Flyttadialog
          flow={flyttar}
          flöden={flöden}
          onAvbryt={() => setFlyttar(null)}
          onFlytta={async (placering, till) => {
            await onFlytta?.(flyttar.id, placering, till);
            setFlyttar(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Ett namnbyte på en STOR gren skrivs på många processer.
 *
 * Ingen version läggs till och inget innehåll ändras, så det går att ta
 * tillbaka genom att döpa om igen – men sextiofem filer som skrivs om av ett
 * enda tangenttryck ska man ha sagt ja till. Små grenar frågar inte: där är
 * följden lika liten som gesten.
 */
const FRÅGA_FRÅN = 10;

function bekräfta(nyttNamn: string, antal: number): boolean {
  if (antal < FRÅGA_FRÅN) return true;
  return confirm(
    `Döpa om grenen till ”${nyttNamn}”?\n\n` +
      `Namnet skrivs på ${antal} processer. Innehållet rörs inte och ingen ny ` +
      `version skapas – du kan döpa om igen om det blev fel.`,
  );
}

/** Alla flödes-id i en uppsättning grenar – de som ett namnbyte skrivs på. */
function idIGren(grenar: ÄrendeGren[]): string[] {
  return grenar.flatMap((g) => g.målgrupper.flatMap((m) => m.flöden.map((f) => f.flow.id)));
}

/** Underrubriken på en samling: vad den innehåller, i klartext. */
function sammanfattaGrenar(grenar: ÄrendeGren[]): string {
  const namn = grenar.map((g) => g.titel);
  if (namn.length <= 3) return namn.join(" · ");
  return `${namn.slice(0, 3).join(" · ")} +${namn.length - 3}`;
}

/**
 * En rad i strukturen: en samling eller en gren, med antal och vad den bär.
 *
 * Raden är en KNAPP som går nedåt, och namnet i den går att skriva om. Två
 * gester på samma rad, men de rör olika saker: klicket flyttar dig, pennan
 * flyttar inte något alls.
 */
function Nivårad({
  titel,
  nyckel,
  antal,
  under,
  onÖppna,
  kanDöpaOm,
  döper,
  setDöper,
  hjälp,
  onDöpOm,
}: {
  titel: string;
  nyckel: string;
  antal: number;
  under: string;
  onÖppna: () => void;
  kanDöpaOm: boolean;
  döper: { nyckel: string; text: string } | null;
  setDöper: (v: { nyckel: string; text: string } | null) => void;
  hjälp: string;
  onDöpOm: (nyttNamn: string) => void;
}) {
  const skriver = döper?.nyckel === nyckel;

  if (skriver) {
    const spara = () => {
      const nytt = döper.text.trim();
      setDöper(null);
      if (nytt && nytt !== titel) onDöpOm(nytt);
    };
    return (
      <div className="ark-nivarad skriver">
        <input
          className="ark-input"
          value={döper.text}
          autoFocus
          aria-label={`Nytt namn på ${titel}`}
          onChange={(e) => setDöper({ nyckel, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") spara();
            if (e.key === "Escape") setDöper(null);
          }}
          onBlur={spara}
        />
        <span className="ark-nivarad-hjalp">{hjälp}</span>
      </div>
    );
  }

  return (
    <div className="ark-nivarad">
      <button className="ark-nivarad-knapp" onClick={onÖppna}>
        <span className="ark-nivarad-titel">{titel}</span>
        {under && <span className="ark-nivarad-under">{under}</span>}
        <span className="ark-nivarad-antal">{antal}</span>
        <span className="ark-nivarad-pil" aria-hidden>
          ›
        </span>
      </button>
      {/* EGEN knapp bredvid raden, inte inuti: en knapp i en knapp är ogiltig
          HTML, och klicket hade dessutom gått ner en nivå på vägen. */}
      {kanDöpaOm && (
        <button
          className="ark-grennamn-knapp"
          onClick={() => setDöper({ nyckel, text: titel })}
          title={hjälp}
          aria-label={`Byt namn på ${titel}`}
        >
          ✎
        </button>
      )}
    </div>
  );
}

interface KortProps {
  flow: FlowSummary;
  /** Namnet minus det som redan står som rubrik ovanför. Saknas = hela namnet. */
  kort?: string;
  aktiv: boolean;
  onÖppna: (id: string) => void;
  /**
   * I den platta listan finns inga rubriker ovanför kortet, så ärendetypen
   * måste stå på kortet självt – annars säger "Kommentera ärendet" ingenting
   * om VILKET ärende det gäller.
   */
  visaSammanhang?: boolean;
  /** Öppnar flyttdialogen. Saknas = katalogen får inte ändra strukturen. */
  onFlytta?: () => void;
  /** Ytan, när kortet står utan rubriker ovanför (den platta listan). */
  yta?: Ytgrupp;
}

function ProcessKort({ flow, kort, aktiv, onÖppna, visaSammanhang, onFlytta, yta }: KortProps) {
  const familj = flowFamily(flow.id);
  const def = flow.status ? statusDef(flow.status) : null;
  const titel = visaSammanhang ? flow.name : (kort ?? kortnamn(flow.name, ärendetypFör(flow.id).titel));
  const användare = useAnvändare();
  // Under "Andra användares processer" är det vems processen är som skiljer korten åt.
  const vem = vemsProcess(flow);
  const visaVem = vem && ytgruppFör(användare, flow) === "andras";
  return (
    <div className="ark-kort-hallare">
    <button
      className={`ark-kort ${aktiv ? "aktiv" : ""}`}
      onClick={() => onÖppna(flow.id)}
      title={
        `${flow.name}\n${flow.stepCount} steg · ${flow.versionCount} ` +
        `version${flow.versionCount === 1 ? "" : "er"} · ${verktygsNamn(familj)}` +
        (vem ? `\nÄgare: ${vem}` : "")
      }
    >
      <span className="ark-kort-titel">{titel}</span>
      <span className="ark-kort-meta">
        {flow.actor && <span>{flow.actor}</span>}
        <span>{flow.stepCount} steg</span>
        {familj === "affarsprocess" && <span className="ark-kort-verktyg">Affärsprocess</span>}
        {yta && <span className={`ark-kort-yta ark-kort-yta--${yta}`}>{ytgruppTitel(yta)}</span>}
      </span>
      {visaVem && <span className="ark-kort-vem">{vem}</span>}
      <span className="ark-kort-fot">
        {def && (
          <span className={`ark-status-pill ${def.id}`}>
            {def.etikett} {flow.beteckning}
          </span>
        )}
        <span className="ark-kort-tid">{formateraTid(flow.savedAt)}</span>
      </span>
      {aktiv && <span className="ark-kort-aktiv">redigeras nu</span>}
    </button>
      {/* EGEN knapp bredvid kortet, inte inuti: en knapp i en knapp är ogiltig
          HTML, och klicket hade dessutom öppnat processen på vägen. */}
      {onFlytta && (
        <button
          className="ark-kort-flytt"
          onClick={onFlytta}
          title={`Flytta ”${flow.name}” till en annan samling eller underkategori`}
          aria-label={`Flytta ${flow.name}`}
        >
          <FlyttaIkon />
          Flytta
        </button>
      )}
    </div>
  );
}

/** Kort, läsbar tidsstämpel: "idag", "i går" eller datum. */
function formateraTid(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const nu = new Date();
  if (d.toDateString() === nu.toDateString()) return "idag";
  const igår = new Date(nu);
  igår.setDate(nu.getDate() - 1);
  if (d.toDateString() === igår.toDateString()) return "i går";
  return d.toLocaleDateString("sv-SE");
}
