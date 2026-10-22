/**
 * Musgesterna på ritytan – EN plats, båda ritytorna (flödesschemat och affärsprocessen).
 *
 * Varför här och inte i varsin canvas: gesterna hänger ihop. Markeringsrutan
 * fungerar bara om panoreringen SLÄPPER vänsterknappen (React Flow slår av
 * `selectionOnDrag` så fort `panOnDrag === true`), och markeringstangenten är
 * flyttad från Shift eftersom Shift är linjeringens gest. Delas inte de valen
 * glider ritytorna isär och samma mus gör olika saker i de två verktygen.
 */

/**
 * Tangenten som markerar flera objekt (håll och klicka), och som ritar en
 * markeringsruta även i lägen där vänsterdraget gör något annat.
 *
 * React Flow använder Shift som standard, vilket kapar LINJERINGSGESTEN helt –
 * man ritar en markeringsram i stället för att flytta objektet. Därför Ctrl.
 */
export const SELECTION_KEY = "Control";

/**
 * Musknapparna som PANORERAR när vänsterdraget ritar markeringsruta:
 * 1 = mitten (scrollhjulet), 2 = höger. Vänster (0) är medvetet inte med –
 * det är den knappen markeringsrutan behöver. Mellanslag + vänsterdrag
 * panorerar också (React Flows `panActivationKeyCode`, standard "Space").
 *
 * Konstant på modulnivå, inte en literal i JSX: en ny array vid varje render
 * får React Flow att räkna om panoreringen i onödan.
 */
export const PAN_BUTTONS: number[] = [1, 2];

/**
 * Stilen som gör en BAKGRUNDSNOD genomsläpplig för musen – banband, poolramar,
 * sidramar, svarta lådor, hjälplinjer och affärsprocessens ramar och hänvisningsmärken.
 *
 * React Flow sätter `pointer-events: all` INLINE på varje nod så snart
 * canvasen har en `onNodeClick` (vår har det), så en CSS-regel biter inte –
 * bara nodens egen `style`, som läggs sist. Utan det här landar varje
 * musnedslag inne i diagrammet på ett band i stället för på ritytan, och
 * markeringsramen – som bara startar på själva ritytan – går bara att börja
 * utanför banorna. Det som ändå ska gå att gripa tänder pointer-events igen i
 * sin egen CSS (`.ark-lane-resize`).
 */
export const GENOMSLÄPPLIG = { pointerEvents: "none" } as const;
