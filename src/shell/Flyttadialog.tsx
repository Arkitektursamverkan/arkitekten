/**
 * "Flytta till …" – var i katalogen EN process ligger.
 *
 * EGEN MODUL för att dialogen behövs på FLERA ställen: i katalogen (på kortet)
 * och i den öppna processens huvud. Att bara ha den i katalogen räckte inte –
 * man står oftast i processen man vill flytta, och att först leta upp den i en
 * katalog man redan lämnat är en omväg (beslut 2026-09-07).
 */

import { useState } from "react";
import type { FlowSummary, Placering } from "@/core/flow-store";
import {
  kategoriFör,
  kategoriTitlar,
  underkategoriFör,
  underkategoriTitlar,
  ärendetypFör,
} from "@/core/flow-tree";
import { KategoriVal } from "./KategoriVal";
import {
  DEMO_KATEGORI,
  YTOR,
  kanByttaYta,
  kanRedigera,
  ytaFör,
  ytgruppFör,
  type Yta,
} from "@/core/behorighet";
import { useAnvändare, useInloggningsläge } from "./Inloggning";

/**
 * Mapp med en pil in i – "lägg den här processen någon annanstans".
 *
 * Knappen bar tidigare ⋮, som betyder meny och inte flytt, och den var dessutom
 * osynlig tills pekaren råkade hamna på kortet. Då fanns funktionen bara för
 * den som redan visste om den – det gick inte att se hur en process flyttas
 * från en kategori till en annan (synpunkt 2026-09-07).
 */
export function FlyttaIkon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8V6a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.82 1.2a2 2 0 0 0 1.69.9H19a2 2 0 0 1 2 2v1" />
      <path d="M3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />
      <path d="M12 8v7" />
      <path d="m9 12 3 3 3-3" />
    </svg>
  );
}

export function Flyttadialog({
  flow,
  flöden,
  onAvbryt,
  onFlytta,
}: {
  flow: FlowSummary;
  flöden: FlowSummary[];
  onAvbryt: () => void;
  /** `till` = en annan yta än den processen ligger i (se core/behorighet.ts). */
  onFlytta: (placering: Placering, till?: Yta) => void | Promise<void>;
}) {
  const användare = useAnvändare();
  const nuYta = ytaFör(flow);
  /**
   * Ytorna man kan välja: den processen ligger i (om man får ändra där) och de
   * man får flytta den till. Den vanliga vägen är Mina processer → gemensam
   * katalog, när processen är klar att dela.
   */
  const ytval = YTOR.filter((y) =>
    y.id === nuYta ? kanRedigera(användare, flow) : kanByttaYta(användare, flow, y.id),
  );
  /**
   * I öppen drift finns bara en användare och inga egna kataloger – där är
   * Demo bara en kategori bland andra, och dialogen ser ut som förut.
   */
  const visaYtor = useInloggningsläge() !== "öppen" && ytval.length > 1;
  const [till, setTill] = useState<Yta>(ytval.some((y) => y.id === nuYta) ? nuYta : (ytval[0]?.id ?? nuYta));
  /** Kategorierna i den yta processen hamnar i – en lista över allas hade bara varit ett sätt att välja fel. */
  const iYtan = flöden.filter((f) =>
    till === "egen" ? ytgruppFör(användare, f) === "egen" : ytaFör(f) === till,
  );
  const [kategori, setKategori] = useState(
    visaYtor && nuYta === "demo" ? "" : (flow.category ?? ""),
  );
  const [underkategori, setUnderkategori] = useState(flow.subcategory ?? "");
  const [arbetar, setArbetar] = useState(false);

  /**
   * VAR PROCESSEN LIGGER NU – inte vad som står i dess fält.
   *
   * Ett flöde utan egen kategori ligger ändå någonstans: reglerna i flow-tree
   * lägger portalens processer under "portalen" och delar in dem efter
   * ärendetyp. Dialogen sa ändå "Ingen kategori", vilket läses som "den ligger
   * ingenstans" av alla utom den som skrivit reglerna – och man vågade inte
   * flytta, för man visste inte vad man flyttade ifrån.
   */
  const nuKategori = kategoriFör(flow)?.titel ?? null;
  const nuGren = underkategoriFör(flow) ?? ärendetypFör(flow.id).titel;
  /** Kategorin som gäller UTAN eget val – det tomma valet leder hit. */
  const härledd = flow.category?.trim() ? null : nuKategori;

  return (
    <div className="ark-flyttalager" onClick={onAvbryt}>
      <div
        className="ark-flyttadialog"
        role="dialog"
        aria-label={`Flytta ${flow.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="ark-flytta-rubrik">Flytta ”{flow.name}”</h2>
        <p className="ark-flytta-nu">
          Ligger nu i <strong>{nuKategori ?? "ingen samling"}</strong>
          {nuGren && (
            <>
              {" › "}
              <strong>{nuGren}</strong>
            </>
          )}
        </p>
        <p className="ark-hint">
          Var i katalogen processen ligger. Innehållet rörs inte, och flytten blir ingen ny
          version.
        </p>

        {visaYtor && (
          <fieldset className="ark-flytta-ytor">
            <legend className="ark-field-label">Yta</legend>
            {ytval.map((y) => (
              <label key={y.id} className={`ark-flytta-yta ${till === y.id ? "vald" : ""}`}>
                <input
                  type="radio"
                  name="ark-flytta-yta"
                  checked={till === y.id}
                  onChange={() => setTill(y.id)}
                />
                <span>
                  <strong>{y.titel}</strong>
                  {y.id === nuYta && " (nu)"}
                  <span className="ark-hint"> – {y.beskrivning}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {/* Demo ÄR en kategori – där väljs bara underkategorin. */}
        {!(visaYtor && till === "demo") && (
          <>
            <label className="ark-field-label" htmlFor="ark-flytta-kategori">
              Kategori i katalogen
            </label>
            <KategoriVal
              id="ark-flytta-kategori"
              värde={kategori}
              kategorier={
                visaYtor
                  ? kategoriTitlar(iYtan).filter((k) => k.toLowerCase() !== DEMO_KATEGORI.toLowerCase())
                  : kategoriTitlar(flöden)
              }
              onChange={setKategori}
              tomEtikett={härledd ? `Ingen egen – hamnar i ${härledd}` : "Ingen kategori"}
            />
          </>
        )}

        <label className="ark-field-label" htmlFor="ark-flytta-underkategori">
          Underkategori
        </label>
        <KategoriVal
          id="ark-flytta-underkategori"
          värde={underkategori}
          kategorier={
            visaYtor
              ? underkategoriTitlar(iYtan, till === "demo" ? DEMO_KATEGORI : kategori)
              : underkategoriTitlar(flöden, kategori)
          }
          onChange={setUnderkategori}
          tomEtikett={
            flow.subcategory?.trim()
              ? "Ingen – dela in automatiskt"
              : `Ingen egen – delas in som ${nuGren}`
          }
          nivå="underkategori"
        />

        <div className="ark-flytta-fot">
          <button
            className="ark-btn ark-btn--primary"
            disabled={arbetar}
            onClick={async () => {
              setArbetar(true);
              await onFlytta(
                { category: visaYtor && till === "demo" ? DEMO_KATEGORI : kategori, subcategory: underkategori },
                till === nuYta ? undefined : till,
              );
            }}
          >
            {arbetar
              ? "Flyttar …"
              : till === nuYta
                ? "Flytta"
                : `Flytta till ${YTOR.find((y) => y.id === till)?.titel.toLowerCase()}`}
          </button>
          <button className="ark-linkbtn" onClick={onAvbryt}>
            Avbryt
          </button>
        </div>
      </div>
    </div>
  );
}

