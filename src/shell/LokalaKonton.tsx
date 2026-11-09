/**
 * Lokala konton i gränssnittet (inloggningsläget "lokal", server/konton.ts):
 * inloggningen, det första kontot, bytet av eget lösenord och
 * administratörens kontolista. Servern prövar allt – här finns bara formulären.
 */

import { useEffect, useState, type FormEvent } from "react";

async function skicka(väg: string, metod: string, kropp?: unknown): Promise<Record<string, any>> {
  const res = await fetch(väg, {
    method: metod,
    headers: { "content-type": "application/json" },
    ...(kropp === undefined ? {} : { body: JSON.stringify(kropp) }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || !b.ok) throw new Error(b.error ?? `Servern svarade ${res.status}.`);
  return b;
}

const MIN_LÄNGD = 10;

/** Inloggningen – eller, när installationen saknar konton, det första kontot. */
export function LokalInloggning({ förstaKonto, kodKrävs = false }: { förstaKonto: boolean; kodKrävs?: boolean }) {
  const [kod, setKod] = useState("");
  const [användarnamn, setAnvändarnamn] = useState("");
  const [namn, setNamn] = useState("");
  const [lösenord, setLösenord] = useState("");
  const [igen, setIgen] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [arbetar, setArbetar] = useState(false);

  async function skickaIn(e: FormEvent) {
    e.preventDefault();
    if (förstaKonto && lösenord !== igen) return setFel("Lösenorden är inte lika.");
    setArbetar(true);
    setFel(null);
    try {
      await skicka(
        förstaKonto ? "/__ark/auth/forsta" : "/__ark/auth/lokal",
        "POST",
        förstaKonto ? { användarnamn, namn, lösenord, kod } : { användarnamn, namn, lösenord },
      );
      location.reload();
    } catch (err) {
      setFel(err instanceof Error ? err.message : String(err));
      setArbetar(false);
    }
  }

  return (
    <form className="ark-inloggning-dev" onSubmit={(e) => void skickaIn(e)}>
      {förstaKonto && (
        <p className="ark-hint">
          Installationen har inga konton ännu. Det konto du skapar nu blir administratör och kan sedan lägga upp
          fler under Inställningar.
        </p>
      )}
      {fel && <p className="ark-inloggning-fel">{fel}</p>}
      {förstaKonto && kodKrävs && (
        <input
          className="ark-input"
          value={kod}
          onChange={(e) => setKod(e.target.value)}
          placeholder="Engångskod (SETUP_CODE från installationen)"
          aria-label="Engångskod"
          autoComplete="off"
        />
      )}
      <input
        className="ark-input"
        value={användarnamn}
        onChange={(e) => setAnvändarnamn(e.target.value)}
        placeholder="Användarnamn (e-post)"
        aria-label="Användarnamn"
        autoComplete="username"
        autoFocus
      />
      {förstaKonto && (
        <input className="ark-input" value={namn} onChange={(e) => setNamn(e.target.value)} placeholder="Namn" aria-label="Namn" />
      )}
      <input
        className="ark-input"
        type="password"
        value={lösenord}
        onChange={(e) => setLösenord(e.target.value)}
        placeholder={förstaKonto ? `Lösenord (minst ${MIN_LÄNGD} tecken)` : "Lösenord"}
        aria-label="Lösenord"
        autoComplete={förstaKonto ? "new-password" : "current-password"}
      />
      {förstaKonto && (
        <input
          className="ark-input"
          type="password"
          value={igen}
          onChange={(e) => setIgen(e.target.value)}
          placeholder="Lösenordet igen"
          aria-label="Lösenordet igen"
          autoComplete="new-password"
        />
      )}
      <button className="ark-btn ark-btn--primary" type="submit" disabled={arbetar || !användarnamn.trim() || !lösenord || (förstaKonto && kodKrävs && !kod.trim())}>
        {förstaKonto ? "Skapa administratören" : "Logga in"}
      </button>
    </form>
  );
}

/** Bytet av det egna lösenordet – knappen i kontoraden och dess ruta. */
export function BytLösenordKnapp() {
  const [öppen, setÖppen] = useState(false);
  const [nuvarande, setNuvarande] = useState("");
  const [nytt, setNytt] = useState("");
  const [besked, setBesked] = useState<{ ok: boolean; text: string } | null>(null);

  async function spara(e: FormEvent) {
    e.preventDefault();
    try {
      await skicka("/__ark/auth/losenord", "POST", { nuvarande, nytt });
      setBesked({ ok: true, text: "Lösenordet är bytt." });
      setNuvarande("");
      setNytt("");
    } catch (err) {
      setBesked({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <>
      <button className="ark-linkbtn" onClick={() => setÖppen(true)}>
        Byt lösenord
      </button>
      {öppen && (
        <div className="ark-flyttalager" onClick={() => setÖppen(false)}>
          <form
            className="ark-flyttadialog"
            role="dialog"
            aria-label="Byt lösenord"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void spara(e)}
          >
            <h2 className="ark-flytta-rubrik">Byt lösenord</h2>
            <input className="ark-input" type="password" aria-label="Nuvarande lösenord" placeholder="Nuvarande lösenord"
              autoComplete="current-password" value={nuvarande} onChange={(e) => setNuvarande(e.target.value)} />
            <input className="ark-input" type="password" aria-label="Nytt lösenord" placeholder={`Nytt lösenord (minst ${MIN_LÄNGD} tecken)`}
              autoComplete="new-password" value={nytt} onChange={(e) => setNytt(e.target.value)} />
            {besked && <p className={besked.ok ? "ark-hint" : "ark-error"}>{besked.text}</p>}
            <div className="ark-flytta-fot">
              <button className="ark-btn ark-btn--primary" type="submit" disabled={!nuvarande || !nytt}>
                Byt
              </button>
              <button className="ark-linkbtn" type="button" onClick={() => setÖppen(false)}>
                Stäng
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

interface KontoRad {
  id: string;
  användarnamn: string;
  namn: string;
  roller: string[];
}

/** Administratörens kontolista – i Inställningar när installationen har lokala konton. */
export function KontoAdmin({ egetId }: { egetId: string }) {
  const [konton, setKonton] = useState<KontoRad[] | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [nytt, setNytt] = useState({ användarnamn: "", namn: "", lösenord: "", roll: "user" });

  const ladda = () =>
    skicka("/__ark/konton", "GET")
      .then((b) => setKonton(b.konton))
      .catch((e) => setFel(e.message));
  useEffect(() => {
    void ladda();
  }, []);

  async function gör(f: () => Promise<unknown>) {
    setFel(null);
    try {
      await f();
      await ladda();
    } catch (e) {
      setFel(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="ark-konton">
      <h3 className="ark-installning-rubrik">Konton</h3>
      {fel && <p className="ark-error">{fel}</p>}
      {!konton && !fel && <p className="ark-hint">Läser kontona …</p>}
      {konton && (
        <table className="ark-konton-tabell">
          <tbody>
            {konton.map((k) => {
              const admin = k.roller.includes("admin");
              return (
                <tr key={k.id}>
                  <td>
                    <strong>{k.namn}</strong>
                    <div className="ark-hint">{k.användarnamn}</div>
                  </td>
                  <td>
                    <select
                      className="ark-input"
                      aria-label={`Roll för ${k.namn}`}
                      value={admin ? "admin" : "user"}
                      disabled={k.id === egetId}
                      onChange={(e) => void gör(() => skicka(`/__ark/konton/${k.id}`, "PUT", { roll: e.target.value }))}
                    >
                      <option value="user">Användare</option>
                      <option value="admin">Administratör</option>
                    </select>
                  </td>
                  <td>
                    <button
                      className="ark-linkbtn"
                      onClick={() => {
                        const lösenord = prompt(`Nytt lösenord för ${k.namn} (minst ${MIN_LÄNGD} tecken):`);
                        if (lösenord) void gör(() => skicka(`/__ark/konton/${k.id}`, "PUT", { lösenord }));
                      }}
                    >
                      Nytt lösenord
                    </button>
                    {k.id !== egetId && (
                      <button
                        className="ark-linkbtn"
                        onClick={() => {
                          if (confirm(`Ta bort kontot ${k.användarnamn}? Processerna det äger finns kvar.`))
                            void gör(() => skicka(`/__ark/konton/${k.id}`, "DELETE"));
                        }}
                      >
                        Ta bort
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <form
        className="ark-konton-nytt"
        onSubmit={(e) => {
          e.preventDefault();
          void gör(async () => {
            await skicka("/__ark/konton", "POST", nytt);
            setNytt({ användarnamn: "", namn: "", lösenord: "", roll: "user" });
          });
        }}
      >
        <input className="ark-input" aria-label="Användarnamn för nytt konto" placeholder="Användarnamn (e-post)"
          value={nytt.användarnamn} onChange={(e) => setNytt({ ...nytt, användarnamn: e.target.value })} />
        <input className="ark-input" aria-label="Namn för nytt konto" placeholder="Namn"
          value={nytt.namn} onChange={(e) => setNytt({ ...nytt, namn: e.target.value })} />
        <input className="ark-input" type="password" aria-label="Lösenord för nytt konto" placeholder={`Lösenord (minst ${MIN_LÄNGD} tecken)`}
          autoComplete="new-password" value={nytt.lösenord} onChange={(e) => setNytt({ ...nytt, lösenord: e.target.value })} />
        <select className="ark-input" aria-label="Roll för nytt konto" value={nytt.roll} onChange={(e) => setNytt({ ...nytt, roll: e.target.value })}>
          <option value="user">Användare</option>
          <option value="admin">Administratör</option>
        </select>
        <button className="ark-btn" type="submit" disabled={!nytt.användarnamn.trim() || !nytt.lösenord}>
          Lägg till konto
        </button>
      </form>
    </div>
  );
}
