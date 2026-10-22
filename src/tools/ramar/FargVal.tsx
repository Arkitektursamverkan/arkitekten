/**
 * Färgvalet i Ramars verktygslådor – samma rad i flödesfliken och bildfliken:
 * husets färger och en egen färg.
 */

import { RAM_FÄRGER } from "@/core/ram";

export function FärgVal({ färg, setFärg }: { färg: string; setFärg: (f: string) => void }) {
  return (
    <span className="ark-ramar-fargrad" role="group" aria-label="Färg">
      {RAM_FÄRGER.map((c) => (
        <button
          key={c}
          className={`ark-ramar-farg ${färg === c ? "vald" : ""}`}
          style={{ background: c }}
          onClick={() => setFärg(c)}
          title={c}
          aria-label={`Färg ${c}`}
        />
      ))}
      <input
        type="color"
        className="ark-ramar-egenfarg"
        value={färg}
        onChange={(e) => setFärg(e.target.value)}
        title="Egen färg"
        aria-label="Egen färg"
      />
    </span>
  );
}
