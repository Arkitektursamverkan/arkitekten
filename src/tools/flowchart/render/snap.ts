/**
 * Linjering ("snapping") av objekt mot närmaste granne.
 *
 * Ligger i en egen, ren modul i stället för inuti FlowCanvas så att den går
 * att testa utan att rendera React Flow. Det var precis den luckan som gjorde
 * att en riktig bugg slank igenom: linjeringen kördes bara på ändringar märkta
 * `dragging: true`, medan den SISTA ändringen vid släpp har `dragging: false`.
 * Objektet hoppade därför tillbaka till musens råa läge i sista stund, trots
 * att hjälplinjen visade rätt.
 */

/** Minimal nodform – bara det linjeringen behöver veta. */
export interface SnapNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

/** Positionsändring från React Flow, i den form vi bryr oss om. */
export interface SnapChange {
  type: string;
  id: string;
  position?: { x: number; y: number };
  dragging?: boolean;
}

export interface Guides {
  x?: number;
  y?: number;
}

/** Avstånd i px där ett objekt "fastnar" i linje med ett annat. */
export const SNAP_TOLERANCE = 12;

/**
 * Linjerar en nod med närmaste granne.
 *
 * Jämför mittpunkter och fäster i den närmaste inom toleransen – i x-led och
 * y-led var för sig, så att man kan linjera lodrätt utan att tappa sitt
 * vågräta läge. Returnerar även vilka hjälplinjer som ska ritas.
 */
export function snapToNeighbours(
  id: string,
  pos: { x: number; y: number },
  all: SnapNode[],
  tolerance = SNAP_TOLERANCE,
  /**
   * Nodtypen som räknas som linjeringsmål. Flödesschemat linjerar mot sina
   * processobjekt, affärsprocessvyn mot sina ("affarsprocess") – ramar,
   * sidhänvisningar och hjälplinjer ska aldrig vara mål. Regeln själv bor kvar
   * HÄR, i en modul, så de två vyerna inte kan börja linjera olika.
   */
  typ = "process",
): { position: { x: number; y: number }; guides: Guides } {
  const self = all.find((n) => n.id === id);
  const w = self?.width ?? 0;
  const h = self?.height ?? 0;
  const cx = pos.x + w / 2;
  const cy = pos.y + h / 2;

  let bestX: { v: number; d: number } | null = null;
  let bestY: { v: number; d: number } | null = null;
  for (const n of all) {
    if (n.id === id || n.type !== typ) continue;
    const ncx = n.position.x + n.width / 2;
    const ncy = n.position.y + n.height / 2;
    const dx = Math.abs(ncx - cx);
    const dy = Math.abs(ncy - cy);
    if (dx <= tolerance && (!bestX || dx < bestX.d)) bestX = { v: ncx, d: dx };
    if (dy <= tolerance && (!bestY || dy < bestY.d)) bestY = { v: ncy, d: dy };
  }

  return {
    position: {
      x: bestX ? bestX.v - w / 2 : pos.x,
      y: bestY ? bestY.v - h / 2 : pos.y,
    },
    guides: { x: bestX?.v, y: bestY?.v },
  };
}

export interface AlignResult<T> {
  /** Ändringarna med linjerade positioner. */
  changes: T[];
  /** Hjälplinjer att visa just nu (tomt vid släpp). */
  guides: Guides;
  /** Slutgiltiga positioner per nod – används vid släpp. */
  snapped: Map<string, { x: number; y: number }>;
}

/**
 * Applicerar linjering på en omgång positionsändringar.
 *
 * `active` = linjeringstangenten hålls nere. Ändringar som inte är
 * positionsändringar passerar orörda. Notera att `dragging` INTE avgör om
 * linjering ska ske – bara om hjälplinjerna ska synas.
 */
export function applyAlignment<T extends SnapChange>(
  changes: T[],
  nodes: SnapNode[],
  active: boolean,
  tolerance = SNAP_TOLERANCE,
  /** Nodtyp som räknas som linjeringsmål – se snapToNeighbours. */
  typ = "process",
): AlignResult<T> {
  const snapped = new Map<string, { x: number; y: number }>();
  let guides: Guides = {};

  const out = changes.map((c) => {
    if (!active || c.type !== "position" || !c.position) return c;
    const res = snapToNeighbours(c.id, c.position, nodes, tolerance, typ);
    snapped.set(c.id, res.position);
    // Hjälplinjer bara medan draget pågår – vid släpp ska de släckas.
    if (c.dragging) guides = res.guides;
    return { ...c, position: res.position };
  });

  return { changes: out, guides, snapped };
}

/**
 * Linjering av en BRYTPUNKT mot andra kopplingars raka segment.
 *
 * En brytpunkt tvingar kanten vågrätt/lodrätt genom punkten – så för att två
 * kopplingars linjer ska ligga i exakt samma höjd måste brytpunktens y träffa
 * det andra segmentets y på pixeln. Det är nästan omöjligt på fri hand;
 * med Shift fäster punkten mot närmaste segment inom toleransen (samma
 * tolerans och samma röda hjälplinjer som objektlinjeringen).
 *
 * `paths` är de ANDRA kopplingarnas punktlistor (den dragna kantens egen väg
 * ska inte vara med – den följer ju punkten som dras).
 */
export function snapWaypointToEdges(
  p: { x: number; y: number },
  paths: Iterable<{ x: number; y: number }[]>,
  tolerance = SNAP_TOLERANCE,
): { position: { x: number; y: number }; guides: Guides } {
  let bestX: { v: number; d: number } | null = null;
  let bestY: { v: number; d: number } | null = null;
  for (const pts of paths) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.y === b.y) {
        // Vågrätt segment: linjera brytpunktens y mot segmentets höjd.
        const d = Math.abs(a.y - p.y);
        if (d <= tolerance && (!bestY || d < bestY.d)) bestY = { v: a.y, d };
      }
      if (a.x === b.x) {
        const d = Math.abs(a.x - p.x);
        if (d <= tolerance && (!bestX || d < bestX.d)) bestX = { v: a.x, d };
      }
    }
  }
  return {
    position: { x: bestX?.v ?? p.x, y: bestY?.v ?? p.y },
    guides: { x: bestX?.v, y: bestY?.v },
  };
}
