/**
 * Zell-Attribute mit Capture (research/30 K7, Vorbild Blender „Spline Parameter" vor dem Umwandeln erfassen):
 *
 * `hRel`, `wall_h`, `storey` sind nur **auf der Hülle** bekannt. Deko-Zellen, die in Außenluft gesetzt werden
 * (Fachwerk-Balken vor der Wand, Gesims, Gaubenkanten, Außenprofil), haben keinen eigenen Raum und keine gerade
 * Wandlinie – ihr Kontext wäre geraten. Solche Zellen **erben** deshalb die Attribute der Trägerwand: Verläufe,
 * Muster-Jitter und Verwitterung laufen hinter der Deko weiter statt bei 0,5 zu beginnen (Blender: „capture"
 * vor der Ableitung).
 *
 * Das Register ist die einzige Stelle, an der Name → Typ → Domäne → Rückfallwert steht. Es ist **additiv**:
 * ohne `MaterializeOptions.captureAttributes` trägt keine Zelle `attrs`, und alle Ergebnisse bleiben bitgleich.
 */
import type { CellContext } from './context.js';

/** Namen der Zell-Attribute (die Domäne ist immer die Zelle). */
export type CellAttrName = 'wall_h' | 'hRel' | 'storey';

/**
 * Attribut-Register: Name → Typ/Domäne/Rückfallwert. `fallback` gilt, wenn eine Zelle das Attribut nicht trägt
 * (dann rechnet der Leser wie bisher mit dem Kontext der Zelle selbst).
 */
export const CELL_ATTRS = {
  /** Verlaufsparameter der Wand (0 = Fuß, 1 = oberste Wandreihe). */
  wall_h: { type: 'float', domain: 'cell', fallback: 0.5 },
  /** Wandreihe über der Bodenplatte (0 = erste Reihe). */
  hRel: { type: 'int', domain: 'cell', fallback: 0 },
  /** Etage (0-basiert). */
  storey: { type: 'int', domain: 'cell', fallback: 0 },
} as const;

/** Ein Attribut-Satz, wie ihn eine Zelle trägt. */
export interface CellAttributes {
  readonly wall_h: number;
  readonly hRel: number;
  readonly storey: number;
  /** `true` = von der Trägerwand übernommen (Capture), nicht aus dem eigenen Kontext. */
  readonly wallBehind: boolean;
  /** Rauschfeld der Trägerwand (Ebene + Koordinaten in der Ebene), damit Muster dort weiterlaufen. */
  readonly plane: number;
  readonly a: number;
  readonly b: number;
}

/** Eigene Attribute einer Zelle (aus ihrem Kontext). */
export function ownAttributes(c: CellContext): CellAttributes {
  return {
    wall_h: c.t.wall_h ?? CELL_ATTRS.wall_h.fallback,
    hRel: c.hRel,
    storey: c.storey,
    wallBehind: false,
    plane: c.plane,
    a: c.a,
    b: c.b,
  };
}

/** Capture: die Trägerwand (`source`) gibt die Werte, die Zelle merkt sich nur die Herkunft. */
export function capturedAttributes(source: CellContext): CellAttributes {
  const own = ownAttributes(source);
  return { ...own, wallBehind: true };
}

/** Trägt die Zelle gecapturte Attribute? */
export function hasCapture(c: CellContext): boolean {
  return c.attrs !== undefined && c.attrs.wallBehind;
}

/**
 * Ist die Zelle ein Kandidat für den Capture? Wandartige Zelle **ohne** eigenen Raum (Deko in Außenluft,
 * Gesims, Fachwerkbalken vor der Wand, Gaubenkante) – Zellen einer Wand mit Raum haben ihren eigenen, richtigen
 * Kontext. Bauwerke (`fort`, Türme/Mauern) bleiben außen vor: sie gehören nicht zur Hauswand.
 */
export function captureCandidate(c: CellContext): boolean {
  return c.surface === 'wall' && c.frame === undefined && c.kind !== 'fort';
}

/** Attribute für den Verlaufsparameter `wall_h` (gecaptured schlägt eigene). */
export function wallHeightParam(c: CellContext): number {
  return c.attrs?.wall_h ?? c.t.wall_h ?? CELL_ATTRS.wall_h.fallback;
}

/**
 * Trägerwand hinter einer Zelle in Außenluft (K7-Capture für Außen-Komponenten wie Fensterläden, Blumenkästen,
 * Laternen): gesucht wird in derselben Höhe bis zwei Schritte in x/z – die Wand, vor der die Deko hängt.
 */
export function wallBehindAt(
  walls: ReadonlyMap<string, CellContext>,
  pos: readonly [number, number, number],
  key: (p: readonly [number, number, number]) => string,
): CellContext | undefined {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
    const hit = walls.get(key([pos[0] + dx, pos[1], pos[2] + dz]));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Rauschfeld (Ebene + Koordinaten) einer Zelle: gecaptured schlägt eigene (K7). */
export function pickPlaneOf(c: CellContext): { readonly plane: number; readonly a: number; readonly b: number } {
  return c.attrs !== undefined ? { plane: c.attrs.plane, a: c.attrs.a, b: c.attrs.b } : { plane: c.plane, a: c.a, b: c.b };
}
