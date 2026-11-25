/**
 * Kategoriregistret i gränssnittet (core/kategoriregister.ts): skapa en
 * kategori, föreslå en, och administratörens flagga för förslag som väntar.
 *
 * Registret hämtas EN gång av skalet och delas genom kontexten – katalogen,
 * flyttdialogen och "Ny process" ska visa samma kategorier. Utan brygga
 * (webbläsarlagringen, eller ett test utan leverantören) är registret tomt
 * och knapparna syns inte: där finns ingen att föreslå för.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ärAdmin, type Yta } from "@/core/behorighet";
import { bridgeJson, getFlowStore } from "@/core/flow-store";
import {
  KATEGORI_MAX,
  TOMT_REGISTER,
  kanSkapaKategori,
  läsKategoriregister,
  registreradeTitlar,
  type Kategoriregister,
} from "@/core/kategoriregister";
import { useAnvändare, useInloggningsläge } from "./Inloggning";

interface RegisterKontext {
  register: Kategoriregister;
  /** Finns en brygga att spara i? Annars visas inga knappar. */
  tillgängligt: boolean;
  /** Skickar en ändring till bryggan och tar emot det nya registret. Kastar med bryggans felmeddelande. */
  begär: (väg: string, kropp: unknown) => Promise<void>;
}

const Kontext = createContext<RegisterKontext>({
  register: TOMT_REGISTER,
  tillgängligt: false,
  begär: async () => {},
});

export function KategoriregisterLeverantör({ children }: { children: ReactNode }) {
  const [register, setRegister] = useState<Kategoriregister>(TOMT_REGISTER);
  const [tillgängligt, setTillgängligt] = useState(false);

  useEffect(() => {
    let avbruten = false;
    void (async () => {
      try {
        if ((await getFlowStore()).kind !== "disk") return;
        const svar = await bridgeJson("/__ark/kategorier");
        if (avbruten) return;
        setRegister(läsKategoriregister(svar.register));
        setTillgängligt(true);
      } catch {
        /* En äldre brygga, eller ingen alls: registret är tomt och knapparna dolda. */
      }
    })();
    return () => {
      avbruten = true;
    };
  }, []);

  const begär = useCallback(async (väg: string, kropp: unknown) => {
    const svar = await bridgeJson(`/__ark/kategorier${väg}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(kropp),
    });
    setRegister(läsKategoriregister(svar.register));
  }, []);

  const värde = useMemo(() => ({ register, tillgängligt, begär }), [register, tillgängligt, begär]);
  return <Kontext.Provider value={värde}>{children}</Kontext.Provider>;
}

export function useKategoriregister(): RegisterKontext {
  return useContext(Kontext);
}

/** De registrerade kategorierna i en yta, så som den inloggade ser dem. */
export function useRegistreradeKategorier(yta: Yta): string[] {
  const { register } = useKategoriregister();
  const användare = useAnvändare();
  return useMemo(() => registreradeTitlar(register, användare, yta), [register, användare, yta]);
}

const felText = (e: unknown) => (e instanceof Error ? e.message : "Det gick inte att spara.");

/* ------------------------------------------------------------------ */
/* Ny kategori / föreslå kategori                                      */
/* ------------------------------------------------------------------ */

/**
 * Knappen i Processkatalogen. EN ruta för tre fall: administratören skapar i
 * den gemensamma katalogen, var och en skapar i Mina processer, och den som
 * inte är administratör föreslår en kategori i den gemensamma.
 */
export function NyKategoriKnapp() {
  const { tillgängligt } = useKategoriregister();
  const inloggad = useInloggningsläge() !== "öppen";
  const [öppen, setÖppen] = useState(false);
  if (!tillgängligt) return null;
  return (
    <>
      <button className="ark-btn" onClick={() => setÖppen(true)} title="Skapa en kategori i katalogen, eller föreslå en">
        ＋ Ny kategori
      </button>
      {öppen && <NyKategoriDialog visaEgen={inloggad} onStäng={() => setÖppen(false)} />}
    </>
  );
}

function NyKategoriDialog({ visaEgen, onStäng }: { visaEgen: boolean; onStäng: () => void }) {
  const användare = useAnvändare();
  const { begär } = useKategoriregister();
  const fårGemensam = kanSkapaKategori(användare, "gemensam");
  const [yta, setYta] = useState<Yta>(visaEgen && !fårGemensam ? "egen" : "gemensam");
  const [namn, setNamn] = useState("");
  const [motivering, setMotivering] = useState("");
  const [arbetar, setArbetar] = useState(false);
  const [fel, setFel] = useState("");
  const [klart, setKlart] = useState("");
  const föreslår = yta === "gemensam" && !fårGemensam;

  const spara = async () => {
    setArbetar(true);
    setFel("");
    try {
      if (föreslår) {
        await begär("/forslag", { namn, motivering });
        setKlart(`Förslaget ”${namn.trim()}” är skickat. En administratör godkänner eller avslår det.`);
      } else {
        await begär("", { namn, yta });
        onStäng();
      }
    } catch (e) {
      setFel(felText(e));
    } finally {
      setArbetar(false);
    }
  };

  return (
    <div className="ark-flyttalager" onClick={onStäng}>
      <div className="ark-flyttadialog" role="dialog" aria-label="Ny kategori" onClick={(e) => e.stopPropagation()}>
        <h2 className="ark-flytta-rubrik">Ny kategori</h2>
        {klart ? (
          <>
            <p className="ark-flytta-nu">{klart}</p>
            <div className="ark-flytta-fot">
              <button className="ark-btn ark-btn--primary" onClick={onStäng}>
                Klar
              </button>
            </div>
          </>
        ) : (
          <>
            {visaEgen && (
              <fieldset className="ark-flytta-ytor">
                <legend className="ark-field-label">Var?</legend>
                <label className={`ark-flytta-yta ${yta === "gemensam" ? "vald" : ""}`}>
                  <input type="radio" name="ark-kategori-yta" checked={yta === "gemensam"} onChange={() => setYta("gemensam")} />
                  <span>
                    <strong>Gemensam katalog</strong>
                    <span className="ark-hint">
                      {fårGemensam
                        ? " – kategorin syns för alla."
                        : " – du föreslår kategorin, och en administratör godkänner den."}
                    </span>
                  </span>
                </label>
                <label className={`ark-flytta-yta ${yta === "egen" ? "vald" : ""}`}>
                  <input type="radio" name="ark-kategori-yta" checked={yta === "egen"} onChange={() => setYta("egen")} />
                  <span>
                    <strong>Mina processer</strong>
                    <span className="ark-hint"> – bara du ser den.</span>
                  </span>
                </label>
              </fieldset>
            )}

            <label className="ark-field-label" htmlFor="ark-kategori-namn">
              Kategorins namn
            </label>
            <input
              id="ark-kategori-namn"
              className="ark-input"
              value={namn}
              maxLength={KATEGORI_MAX.namn}
              onChange={(e) => setNamn(e.target.value)}
              placeholder="t.ex. Systemförvaltning"
              spellCheck={false}
              autoFocus
            />

            {föreslår && (
              <>
                <label className="ark-field-label" htmlFor="ark-kategori-motivering">
                  Varför behövs den? (valfritt)
                </label>
                <textarea
                  id="ark-kategori-motivering"
                  className="ark-input"
                  rows={3}
                  value={motivering}
                  maxLength={KATEGORI_MAX.motivering}
                  onChange={(e) => setMotivering(e.target.value)}
                />
              </>
            )}

            {fel && <p className="ark-hint ark-hint--warn">{fel}</p>}

            <div className="ark-flytta-fot">
              <button className="ark-btn ark-btn--primary" disabled={arbetar || !namn.trim()} onClick={() => void spara()}>
                {föreslår ? "Skicka förslaget" : "Skapa kategorin"}
              </button>
              <button className="ark-linkbtn" onClick={onStäng}>
                Avbryt
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tomma kategorier och egna förslag – raderna i katalogen             */
/* ------------------------------------------------------------------ */

/**
 * De registrerade kategorier i en yta som ännu inte har någon process – annars
 * syntes en nyskapad kategori ingenstans. `upptagna` är kategorierna som redan
 * visas genom sina processer.
 */
export function TommaKategorier({ yta, upptagna }: { yta: Yta; upptagna: string[] }) {
  const användare = useAnvändare();
  const { begär } = useKategoriregister();
  const registrerade = useRegistreradeKategorier(yta);
  const [fel, setFel] = useState("");
  const tomma = registrerade.filter((k) => !upptagna.some((u) => u.trim().toLowerCase() === k.toLowerCase()));
  if (tomma.length === 0) return null;
  const fårTaBort = kanSkapaKategori(användare, yta);
  return (
    <div className="ark-tomma-kategorier">
      {tomma.map((namn) => (
        <div key={namn} className="ark-tom-kategori">
          <span className="ark-tom-kategori-namn">{namn}</span>
          <span className="ark-hint">Tom – flytta en process hit, eller välj kategorin när du skapar en ny.</span>
          {fårTaBort && (
            <button
              className="ark-linkbtn"
              title="Ta bort den tomma kategorin"
              onClick={() => {
                setFel("");
                begär("/ta-bort", { namn, yta }).catch((e) => setFel(felText(e)));
              }}
            >
              Ta bort
            </button>
          )}
        </div>
      ))}
      {fel && <p className="ark-hint ark-hint--warn">{fel}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Förslagen                                                           */
/* ------------------------------------------------------------------ */

/**
 * Flaggan. Administratören ser hur många förslag som väntar och beslutar om
 * dem; den som föreslagit ser sina egna och kan dra tillbaka dem. Syns bara
 * när det finns något att visa.
 */
export function Förslagsflagga() {
  const användare = useAnvändare();
  const { register, begär, tillgängligt } = useKategoriregister();
  const [öppen, setÖppen] = useState(false);
  const [fel, setFel] = useState("");
  const admin = ärAdmin(användare);
  const förslag = register.förslag;
  useEffect(() => {
    if (förslag.length === 0) setÖppen(false);
  }, [förslag.length]);
  if (!tillgängligt || förslag.length === 0) return null;

  const besluta = (id: string, godkänn: boolean) => {
    setFel("");
    begär(`/forslag/${id}`, { godkänn }).catch((e) => setFel(felText(e)));
  };

  return (
    <>
      <button
        className={`ark-forslagsflagga ${admin ? "admin" : ""}`}
        onClick={() => setÖppen(true)}
        title={admin ? "Förslag på nya kategorier väntar på ditt beslut" : "Dina förslag på nya kategorier"}
        aria-label={admin ? `${förslag.length} kategoriförslag väntar` : `${förslag.length} egna kategoriförslag`}
      >
        <span aria-hidden>⚑</span> {förslag.length}
      </button>
      {öppen && (
        <div className="ark-flyttalager" onClick={() => setÖppen(false)}>
          <div className="ark-flyttadialog" role="dialog" aria-label="Kategoriförslag" onClick={(e) => e.stopPropagation()}>
            <h2 className="ark-flytta-rubrik">{admin ? "Förslag på nya kategorier" : "Dina förslag på nya kategorier"}</h2>
            <p className="ark-hint">
              {admin
                ? "Godkänner du skapas kategorin i den gemensamma katalogen. Avslår du tas förslaget bort."
                : "En administratör godkänner eller avslår. Du kan dra tillbaka ett förslag."}
            </p>
            <ul className="ark-forslagslista">
              {förslag.map((f) => (
                <li key={f.id} className="ark-forslag">
                  <div>
                    <strong>{f.namn}</strong>
                    <div className="ark-hint">
                      {f.föreslagenAv.namn} · {new Date(f.föreslagenAt).toLocaleDateString("sv-SE")}
                    </div>
                    {f.motivering && <div className="ark-forslag-motivering">{f.motivering}</div>}
                  </div>
                  <div className="ark-forslag-knappar">
                    {admin && (
                      <button className="ark-btn ark-btn--primary" onClick={() => besluta(f.id, true)}>
                        Godkänn
                      </button>
                    )}
                    <button className="ark-btn" onClick={() => besluta(f.id, false)}>
                      {admin ? "Avslå" : "Dra tillbaka"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {fel && <p className="ark-hint ark-hint--warn">{fel}</p>}
            <div className="ark-flytta-fot">
              <button className="ark-linkbtn" onClick={() => setÖppen(false)}>
                Stäng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
