/**
 * Organisationens märke i skalet och på inloggningssidan: logotypen om den
 * finns, annars Arkitektens "A" i profilfärgen. Utseendet läses en gång per
 * sidladdning (`/__ark/utseende`, core/utseende.ts) och svarar servern inte
 * visas Arkitektens eget.
 */
import { useEffect, useState } from "react";
import type { Utseende } from "@/core/utseende";

let laddning: Promise<Utseende> | null = null;

function laddaUtseende(): Promise<Utseende> {
  laddning ??= fetch("/__ark/utseende")
    .then((r) => r.json())
    .then((b) => (b?.ok && b.utseende ? (b.utseende as Utseende) : {}))
    .catch((): Utseende => ({}))
    .then((u: Utseende) => {
      // Profilfärgen gäller märket; resten av appen behåller sina färger.
      if (u.färg) document.documentElement.style.setProperty("--ark-org-farg", u.färg);
      return u;
    });
  return laddning;
}

export function useUtseende(): Utseende {
  const [u, setU] = useState<Utseende>({});
  useEffect(() => {
    let aktiv = true;
    laddaUtseende().then((v) => aktiv && setU(v));
    return () => {
      aktiv = false;
    };
  }, []);
  return u;
}

export function OrgMärke({ utseende, className = "" }: { utseende: Utseende; className?: string }) {
  if (utseende.logoVersion) {
    return (
      <span className={`ark-brand-mark ark-brand-mark--logo ${className}`}>
        <img src={`/__ark/utseende/logo?v=${encodeURIComponent(utseende.logoVersion)}`} alt={utseende.namn ?? ""} />
      </span>
    );
  }
  return <span className={`ark-brand-mark ${className}`}>A</span>;
}
