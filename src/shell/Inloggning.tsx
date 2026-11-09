/**
 * Inloggningsgrinden – vem som sitter vid appen, och inloggningsrutan när
 * ingen gör det.
 *
 * Det är bryggan som säger nej (server/auth.ts, server/atkomst.ts); grinden
 * finns för att man ska mötas av en inloggning i stället för en tom katalog,
 * och för att resten av appen ska kunna fråga `useAnvändare()` vilka knappar
 * som ska visas. Reglerna själva bor i core/behorighet.ts.
 *
 * Svarar inte bryggan alls (statisk build, localStorage) finns ingen server att
 * logga in mot – då gäller öppen drift, som före inloggningen.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { läsSymbolstil, sättSymbolstil } from "@/tools/affarsprocess/symbolstil";
import { sättOrganisation } from "@/core/organisation";
import { OrgMärke, useUtseende } from "./OrgMarke";
import { InstallningarKnapp } from "./Installningar";
import { BytLösenordKnapp, LokalInloggning } from "./LokalaKonton";
import {
  LOKAL_ANVÄNDARE,
  rollEtikett,
  type Användare,
  type Inloggningsläge,
} from "@/core/behorighet";

interface Inloggad {
  användare: Användare;
  läge: Inloggningsläge;
}

const Kontext = createContext<Inloggad>({ användare: LOKAL_ANVÄNDARE, läge: "öppen" });

/** Den inloggade. Utan grind (t.ex. i ett test) är det den lokala administratören. */
export function useAnvändare(): Användare {
  return useContext(Kontext).användare;
}

export function useInloggningsläge(): Inloggningsläge {
  return useContext(Kontext).läge;
}

/** Låter ett test (eller en förhandsvisning) sätta användaren utan bryggan. */
export function AnvändarKontext({ användare, läge = "entra", children }: Inloggad & { children: ReactNode }) {
  return <Kontext.Provider value={{ användare, läge }}>{children}</Kontext.Provider>;
}

type Tillstånd =
  | { typ: "laddar" }
  | { typ: "inloggad"; värde: Inloggad }
  | { typ: "utloggad"; läge: Inloggningsläge; fel?: string; förstaKonto?: boolean; kodKrävs?: boolean };

/**
 * Installationens symbolstil (server/symbolstilar.ts). Prövas här också – en
 * stil som inte går att läsa ger standardstilen, aldrig en trasig rityta.
 */
async function laddaSymbolstil(): Promise<void> {
  try {
    const res = await fetch("/__ark/symbolstil");
    const b = await res.json();
    sättSymbolstil(b?.ok && b.stil ? läsSymbolstil(b.stil) : null);
  } catch {
    sättSymbolstil(null);
  }
}

/** Organisationens namn (core/organisation.ts). Svarar servern inte gäller standardvärdena. */
async function laddaOrganisation(): Promise<void> {
  try {
    const b = await (await fetch("/__ark/organisation")).json();
    sättOrganisation(b?.ok ? b.organisation : null);
  } catch {
    sättOrganisation(null);
  }
}

export function Inloggningsgrind({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Tillstånd>({ typ: "laddar" });

  /**
   * Ett fel från förra inloggningsförsöket kommer tillbaka i adressen. Det
   * läses EN gång, vid första renderingen – inte i effekten.
   *
   * REGRESSION: effekten läste felet och städade bort det ur adressen. I
   * StrictMode körs effekten två gånger, och andra varvet hittade ingenting –
   * inloggningsrutan kom tillbaka utan förklaring och det såg ut som en loop
   * (2026-10-14, AADSTS700025).
   */
  const [tidigareFel] = useState(
    () => new URLSearchParams(location.search).get("inloggningsfel") ?? undefined,
  );

  useEffect(() => {
    let levande = true;
    const params = new URLSearchParams(location.search);
    if (params.has("inloggningsfel")) {
      params.delete("inloggningsfel");
      const q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
    }
    (async () => {
      try {
        const res = await fetch("/__ark/auth/me");
        if (!(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error();
        const b = await res.json();
        if (!levande) return;
        const läge = (b.läge ?? "öppen") as Inloggningsläge;
        // Symbolstilen sätts INNAN appen ritas – annars ritas varje rityta
        // först i standardstilen och byter sedan.
        if (b.användare) await Promise.all([laddaSymbolstil(), laddaOrganisation()]);
        if (!levande) return;
        setT(
          b.användare
            ? { typ: "inloggad", värde: { användare: b.användare, läge } }
            : { typ: "utloggad", läge, fel: tidigareFel ?? b.fel, förstaKonto: b.förstaKonto === true, kodKrävs: b.kodKrävs === true },
        );
      } catch {
        if (levande) setT({ typ: "inloggad", värde: { användare: LOKAL_ANVÄNDARE, läge: "öppen" } });
      }
    })();
    return () => {
      levande = false;
    };
  }, [tidigareFel]);

  if (t.typ === "laddar") return <div className="ark-inloggning"><p className="ark-hint">Läser inloggningen …</p></div>;
  if (t.typ === "utloggad") return <Inloggningsruta läge={t.läge} fel={t.fel} förstaKonto={t.förstaKonto} kodKrävs={t.kodKrävs} />;
  return <Kontext.Provider value={t.värde}>{children}</Kontext.Provider>;
}

function Inloggningsruta({
  läge,
  fel,
  förstaKonto = false,
  kodKrävs = false,
}: {
  läge: Inloggningsläge;
  fel?: string;
  förstaKonto?: boolean;
  kodKrävs?: boolean;
}) {
  const [namn, setNamn] = useState("");
  const [roll, setRoll] = useState("user");
  const utseende = useUtseende();
  // Tillbaka till samma process efter inloggningen – hash:en når aldrig servern
  // av sig själv, så hela adressen skickas med.
  const tillbaka = encodeURIComponent(location.pathname + location.search + location.hash);

  return (
    <div className="ark-inloggning">
      <div className="ark-inloggning-ruta">
        <OrgMärke utseende={utseende} className="ark-inloggning-mark" />
        <h1>Arkitekten</h1>
        <p className="ark-hint">{utseende.namn ? `Processritaren · ${utseende.namn}` : "Processritaren"}</p>
        {fel && <p className="ark-inloggning-fel">{fel}</p>}
        {läge === "lokal" ? (
          <LokalInloggning förstaKonto={förstaKonto} kodKrävs={kodKrävs} />
        ) : läge === "dev" ? (
          <form
            className="ark-inloggning-dev"
            onSubmit={async (e) => {
              e.preventDefault();
              await fetch("/__ark/auth/dev", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ namn, roll }),
              });
              location.reload();
            }}
          >
            <p className="ark-hint">Provinloggning (ARK_AUTH=dev) – välj namn och roll.</p>
            <input
              className="ark-input"
              value={namn}
              onChange={(e) => setNamn(e.target.value)}
              placeholder="Namn"
              aria-label="Namn"
              autoFocus
            />
            <select className="ark-input" value={roll} onChange={(e) => setRoll(e.target.value)} aria-label="Roll">
              <option value="user">Användare</option>
              <option value="admin">Administratör</option>
            </select>
            <button className="ark-btn ark-btn--primary" type="submit" disabled={!namn.trim()}>
              Logga in
            </button>
          </form>
        ) : (
          <a className="ark-btn ark-btn--primary" href={`/__ark/auth/login?tillbaka=${tillbaka}`}>
            Logga in med Microsoft
          </a>
        )}
      </div>
    </div>
  );
}

/** Raden längst ner i menyn: vem man är, vilken roll, och vägen ut. */
export function Kontorad() {
  const { användare, läge } = useContext(Kontext);
  const admin = användare.roller.includes("admin");
  // I öppen drift finns ingen inloggning att visa – bara inställningarna.
  if (läge === "öppen") return admin ? <div className="ark-konto"><InstallningarKnapp läge={läge} egetId={användare.id} /></div> : null;
  return (
    <div className="ark-konto" title={användare.epost ?? användare.namn}>
      <span className="ark-konto-namn">{användare.namn}</span>
      <span className={`ark-konto-roll ${användare.roller.includes("admin") ? "admin" : ""}`}>
        {rollEtikett(användare)}
      </span>
      {admin && <InstallningarKnapp läge={läge} egetId={användare.id} />}
      {läge === "lokal" && <BytLösenordKnapp />}
      <a className="ark-linkbtn ark-konto-ut" href="/__ark/auth/logout">
        Logga ut
      </a>
    </div>
  );
}
