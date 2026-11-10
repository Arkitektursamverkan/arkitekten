/**
 * "Ny process" – det ena av startvyns två svar.
 *
 * Att skapa något nytt var förut en biverkning: appen öppnade med ett exempel
 * inläst, och "+ Nytt flöde" låg som en liten knapp mitt i en panel med
 * sexton andra sektioner. Man började alltså alltid i någon annans process.
 *
 * Här ställs de tre frågor som faktiskt behöver besvaras innan ritandet –
 * vilket verktyg, vad processen heter, och vad man utgår ifrån – och inget
 * annat. Allt övrigt (utseende, sidformat, export) hör till diagrammet och
 * kommer när det finns ett.
 *
 * Vyn skapar ingenting själv. Den lämnar över en begäran till verktyget, som
 * äger mellanlagret och är det enda som får tolka text.
 */

import { useState } from "react";
import { familyPrefix } from "@/core/flow-store";
import { kategoriFör } from "@/core/flow-tree";
import { KategoriVal } from "./KategoriVal";
import { DEMO_KATEGORI } from "@/core/behorighet";
import { PRESENTATIONSKATEGORI } from "@/tools/ramar/avskalad";
import { useInloggningsläge } from "./Inloggning";
import { TOOLS, type NyProcessBegäran, type NyProcessStart } from "./tools";

export interface NyProcessProps {
  onSkapa: (toolId: string, begäran: Omit<NyProcessBegäran, "nonce">) => void;
  onAvbryt: () => void;
  /** Namn som redan finns – ett nytt får inte krocka med dem. */
  taget: string[];
  /** Kategorierna som finns i biblioteket, att välja bland. */
  kategorier: string[];
  /**
   * Underkategorierna som finns i en viss kategori. Frågan ställs med
   * kategorin som argument: grenarna i "DEMO" har ingenting att göra med
   * grenarna i "portalen", och en lista med allas grenar hade bara varit
   * ett sätt att välja fel.
   */
  underkategorier: (kategori: string) => string[];
}

/**
 * Kategorin ett verktyg hamnar i utan eget val – hämtad ur SAMMA regler som
 * trädet använder, aldrig en egen kopia av "flödesscheman hör till portalen".
 * Ett flödesschema föreslås alltså portalen, en affärsprocess ingenting.
 */
function standardkategori(family: string | undefined): string {
  if (!family) return "";
  const prov = familyPrefix(family as "flode" | "affarsprocess") + "ny";
  return kategoriFör({ id: prov })?.titel ?? "";
}

const START: Array<{ id: NyProcessStart; titel: string; text: string }> = [
  {
    id: "regler",
    titel: "Beskriv i text",
    text: "Skriv stegen med pilar. Regelmotorn tolkar dem deterministiskt – samma text ger alltid samma diagram.",
  },
  {
    id: "mall",
    titel: "Fyll i en mall",
    text: "Svara på frågor om ärendetyp, roller och steg. Bra när processen liknar de som redan finns.",
  },
  {
    id: "ai",
    titel: "Låt AI tolka ett underlag",
    text: "Klistra in en ostrukturerad beskrivning – AI:n fyller mellanlagret. Du kan justera allt efteråt.",
  },
  {
    id: "tom",
    titel: "Börja från tomt",
    text: "En ren yta. Placera objekt ur verktygsraden och dra kopplingarna själv.",
  },
];

export function NyProcess({
  onSkapa,
  onAvbryt,
  taget,
  kategorier,
  underkategorier,
}: NyProcessProps) {
  /** Bara verktyg som faktiskt är byggda går att välja. */
  const valbara = TOOLS.filter((t) => t.render && t.family);
  const [toolId, setToolId] = useState(valbara[0]?.id ?? "");
  const [namn, setNamn] = useState("");
  /**
   * Kategorin. Förvalet följer verktyget tills man rört väljaren – därför
   * `null` som "orört" och inte bara en tom sträng: ett medvetet val av INGEN
   * kategori måste överleva ett byte av verktyg, medan ett orört förval ska
   * uppdateras när man byter.
   */
  const [kategoriVal, setKategoriVal] = useState<string | null>(null);
  /** Underkategorin – nivån under kategorin. Tom = de härledda nivåerna gäller. */
  const [underkategori, setUnderkategori] = useState("");
  const valtVerktyg = valbara.find((t) => t.id === toolId);
  const kategori = kategoriVal ?? standardkategori(valtVerktyg?.family);
  const [start, setStart] = useState<NyProcessStart>("regler");
  const [text, setText] = useState("");

  /**
   * VAR den hamnar. Med inloggning börjar allt i Mina processer (eller i Demo)
   * och delas med en uttrycklig flytt – reglerna i core/behorighet.ts, som
   * bryggan verkställer när processen sparas första gången.
   */
  const inloggad = useInloggningsläge() !== "öppen";
  const iDemo = kategori.trim().toLowerCase() === DEMO_KATEGORI.toLowerCase();
  /**
   * Presentation erbjuds aldrig: den kategorin fylls av "✦ Förenkla och
   * presentera", och en process där öppnas i det AVSKALADE utseendet. Valdes
   * den här såg en nyss skapad affärsprocess ut som en förenklad bild utan
   * roller och objekt (beslut 2026-10-20).
   */
  const valbaraKategorier = kategorier.filter(
    (k) =>
      k.toLowerCase() !== PRESENTATIONSKATEGORI.toLowerCase() &&
      !(inloggad && k.toLowerCase() === DEMO_KATEGORI.toLowerCase()),
  );
  const namnKrockar = taget.some((n) => n.trim().toLowerCase() === namn.trim().toLowerCase());
  /** Textvägarna behöver något att tolka; mall och tom yta gör det inte. */
  const behöverText = start === "regler" || start === "ai";
  const klar = Boolean(namn.trim()) && !namnKrockar && (!behöverText || Boolean(text.trim()));

  const skapa = () => {
    if (!klar) return;
    onSkapa(toolId, {
      namn: namn.trim(),
      kategori: kategori.trim(),
      underkategori: underkategori.trim(),
      text,
      start,
    });
  };

  return (
    <div className="ark-ny">
      <div className="ark-ny-inner">
        <button className="ark-tillbaka" onClick={onAvbryt}>
          ← Tillbaka
        </button>
        <h1 className="ark-ny-rubrik">Ny process</h1>

        <section className="ark-ny-steg">
          <h2 className="ark-ny-stegtitel">
            <span className="ark-ny-nummer">1</span> Vad ska du rita?
          </h2>
          <div className="ark-ny-verktyg">
            {valbara.map((t) => (
              <button
                key={t.id}
                className={`ark-valkort ${t.id === toolId ? "vald" : ""}`}
                onClick={() => setToolId(t.id)}
                aria-pressed={t.id === toolId}
              >
                <span className="ark-valkort-ikon" aria-hidden>
                  {t.icon}
                </span>
                <span className="ark-valkort-titel">{t.name}</span>
                <span className="ark-valkort-text">{t.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ark-ny-steg">
          <h2 className="ark-ny-stegtitel">
            <span className="ark-ny-nummer">2</span> Vad heter processen?
          </h2>
          <input
            className="ark-input ark-ny-namn"
            value={namn}
            onChange={(e) => setNamn(e.target.value)}
            placeholder="t.ex. Driftfråga – ny (användare)"
            spellCheck={false}
            aria-label="Namn på processen"
          />
          {namnKrockar ? (
            <p className="ark-hint ark-hint--warn">
              Det finns redan en process med det namnet. Två poster med samma namn går inte att
              skilja åt i katalogen.
            </p>
          ) : (
            <p className="ark-hint">
              Ärendetypen först, sedan vad processen gör, och rollen inom parentes – som de
              befintliga. Namnet styr vilken ärendetyp processen hamnar under.
            </p>
          )}

          {inloggad && (
            <fieldset className="ark-flytta-ytor ark-ny-yta">
              <legend className="ark-field-label">Var hamnar den?</legend>
              <label className={`ark-flytta-yta ${!iDemo ? "vald" : ""}`}>
                <input type="radio" name="ark-ny-yta" checked={!iDemo} onChange={() => setKategoriVal(null)} />
                <span>
                  <strong>Mina processer</strong>
                  <span className="ark-hint">
                    {" "}
                    – bara du ser den. Flytta den till den gemensamma katalogen när den är klar.
                  </span>
                </span>
              </label>
              <label className={`ark-flytta-yta ${iDemo ? "vald" : ""}`}>
                <input
                  type="radio"
                  name="ark-ny-yta"
                  checked={iDemo}
                  onChange={() => setKategoriVal(DEMO_KATEGORI)}
                />
                <span>
                  <strong>Demo</strong>
                  <span className="ark-hint"> – offentlig, alla inloggade kan läsa och ändra.</span>
                </span>
              </label>
            </fieldset>
          )}

          {!iDemo && (
            <>
          <label className="ark-field-label ark-ny-kategoriEtikett" htmlFor="ark-ny-kategori">
            Kategori i katalogen
          </label>
          <KategoriVal
            id="ark-ny-kategori"
            värde={kategori}
            kategorier={valbaraKategorier}
            onChange={setKategoriVal}
            tomEtikett={`Ingen – lägg under ${valtVerktyg?.name ?? "verktyget"}`}
          />
          <p className="ark-hint">
            Katalogens och menyns översta nivå. Välj en befintlig samling eller skapa en ny –
            <strong> {valtVerktyg?.name ?? "verktyget"}</strong> avgör hur processen RITAS, kategorin
            var den HÖR HEMMA. En affärsprocess kan alltså ligga under Systemförvaltning.
          </p>
            </>
          )}

          <label className="ark-field-label ark-ny-kategoriEtikett" htmlFor="ark-ny-underkategori">
            Underkategori
          </label>
          <KategoriVal
            id="ark-ny-underkategori"
            värde={underkategori}
            kategorier={underkategorier(kategori)}
            onChange={setUnderkategori}
            tomEtikett="Ingen – dela in automatiskt"
            nivå="underkategori"
          />
          <p className="ark-hint">
            Nivån under kategorin, och den bestämmer du också själv. Väljer du ingen delas
            processerna in automatiskt efter ärendetyp och målgrupp, som portalens flöden.
          </p>
        </section>

        <section className="ark-ny-steg">
          <h2 className="ark-ny-stegtitel">
            <span className="ark-ny-nummer">3</span> Hur vill du börja?
          </h2>
          <div className="ark-ny-start">
            {START.map((s) => (
              <button
                key={s.id}
                className={`ark-valkort ${s.id === start ? "vald" : ""}`}
                onClick={() => setStart(s.id)}
                aria-pressed={s.id === start}
              >
                <span className="ark-valkort-titel">{s.titel}</span>
                <span className="ark-valkort-text">{s.text}</span>
              </button>
            ))}
          </div>

          {behöverText && (
            <>
              <textarea
                className="ark-textarea ark-ny-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                placeholder={
                  start === "regler"
                    ? "Medarbetare → Startar portalen → Fyller i formuläret → Skickar in\n\nEn rad per spår. Grenar skrivs inom parentes: (↓ Om avslag → Meddelande skickas)"
                    : "Klistra in underlaget som det är – anteckningar, ett mejl, en rutin. AI:n strukturerar det åt dig."
                }
              />
              <p className="ark-hint">
                {start === "regler"
                  ? "Tolkningen är deterministisk: samma text ger alltid samma diagram, och du kan tolka om när du vill."
                  : "AI:n fyller bara mellanlagret – den ritar aldrig. Kräver att appen körs via dev-servern."}
              </p>
            </>
          )}
        </section>

        <div className="ark-ny-fot">
          <button className="ark-btn ark-btn--primary ark-btn--stor" onClick={skapa} disabled={!klar}>
            Skapa process
          </button>
          <button className="ark-linkbtn" onClick={onAvbryt}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}
