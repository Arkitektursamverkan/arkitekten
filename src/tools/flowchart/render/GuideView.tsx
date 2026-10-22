/**
 * Hjälplinje som visas medan ett objekt linjeras mot närmaste granne.
 *
 * Ritas som en egen React Flow-nod i stället för en overlay, så att den följer
 * med i pannning och zoom utan egen koordinatmatematik.
 */

export interface GuideData {
  /** "v" = lodrät linje, "h" = vågrät. */
  axis: "v" | "h";
  length: number;
}

export function GuideView({ data }: { data: GuideData }) {
  const lodrät = data.axis === "v";
  return (
    <div
      className="ark-guide"
      style={{
        width: lodrät ? 1 : data.length,
        height: lodrät ? data.length : 1,
      }}
    />
  );
}
