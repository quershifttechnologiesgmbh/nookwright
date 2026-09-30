/**
 * Arbeitsfläche aller Bauwerke eines Aufrufs: Blöcke und reservierte Luft mit Priorität (Tor > Turm > Mauer
 * > Detail, research/14 P6). Eine Position hält genau einen Eintrag; ein Eintrag mit höherer Priorität wird
 * nie überschrieben, bei gleicher Priorität gewinnt der spätere. So ist das Ergebnis unabhängig davon,
 * ob z. B. der Durchgang eines Tores vor oder nach dem Mauerkörper eingetragen wird.
 */
import type { ShellCell, ShellOrient } from '@mcda/blueprint';
import type { Cell, HorizontalDir, Vec3 } from '@mcda/core';
import { colKey } from './geometry.js';
import type { HeightField, TiledCrenelEntry, TiledDetail } from './types.js';

export const PRIO = {
  /** Anlauf-Treppen am Mauerfuß (weichen allem). */
  batter: 10,
  wall: 50,
  /** Treppen auf dem Wehrgang und Aufgänge. */
  stairs: 55,
  tower: 60,
  /** Wendeltreppe (über den Turmböden). */
  spiral: 61,
  /** Fenster, Kragsteine, Brüstung. */
  feature: 70,
  /** reservierte Luft: Durchgänge, Kopffreiheit, Türvorplätze. */
  reserve: 90,
  /** Türen und Bogensteine in reservierten Durchgängen. */
  door: 95,
} as const;

export interface Block {
  readonly role: string;
  readonly shape: string;
  readonly orient?: ShellOrient;
}

interface Entry {
  readonly block: Block | undefined;
  readonly owner: string;
  readonly prio: number;
}

const key = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;

export class Canvas {
  private readonly map = new Map<string, Entry & { readonly pos: Vec3 }>();

  /** Block setzen; `false`, wenn ein Eintrag höherer Priorität dort liegt. */
  put(pos: Vec3, block: Block, owner: string, prio: number): boolean {
    const e = this.map.get(key(pos));
    if (e !== undefined && e.prio > prio) return false;
    this.map.set(key(pos), { pos, block, owner, prio });
    return true;
  }

  /** Luft reservieren (Durchgang, Kopffreiheit). */
  reserve(pos: Vec3, owner: string, prio: number = PRIO.reserve): void {
    const e = this.map.get(key(pos));
    if (e !== undefined && e.prio > prio) return;
    this.map.set(key(pos), { pos, block: undefined, owner, prio });
  }

  at(pos: Vec3): Block | undefined {
    return this.map.get(key(pos))?.block;
  }

  isReserved(pos: Vec3): boolean {
    const e = this.map.get(key(pos));
    return e !== undefined && e.block === undefined;
  }

  /** Alle Blöcke als Hüllzellen, sortiert nach (y, z, x) – stabile Ausgabe. */
  cells(): ShellCell[] {
    const out: ShellCell[] = [];
    for (const e of this.map.values()) {
      if (e.block === undefined) continue;
      out.push({
        pos: e.pos, kind: 'fort', role: e.block.role, shape: e.block.shape,
        ...(e.block.orient !== undefined ? { orient: e.block.orient } : {}),
        roomId: e.owner, exterior: true,
      });
    }
    return out.sort((a, b) => a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0]);
  }
}

/** Gemeinsamer Zustand eines Aufrufs: Arbeitsfläche, Gelände, belegte Spalten am Boden, Hinweise. */
export class Site {
  readonly canvas = new Canvas();
  /** Spalten, die am Boden belegt oder freizuhalten sind (Grundrisse, Türvorplätze, Treppenläufe). */
  private readonly blocked = new Set<number>();
  private readonly soft = new Set<number>();
  readonly warnings: string[] = [];
  /** feat/tiled-wfc: Bericht der Zinnenkränze (nur mit `tiled`). */
  readonly tiledLog: TiledCrenelEntry[] = [];

  constructor(readonly ground: HeightField, readonly seed: number, readonly prefix: string, readonly tiled?: TiledDetail) {}

  groundY(x: number, z: number): number {
    return this.ground.groundY(x, z);
  }

  block(x: number, z: number): void {
    this.blocked.add(colKey(x, z));
  }

  isBlocked(x: number, z: number): boolean {
    return this.blocked.has(colKey(x, z));
  }

  /** Spalte mit weichem Detail (Anlauf): zählt zur Grundfläche, blockiert aber keine späteren Bauwerke. */
  mark(x: number, z: number): void {
    this.soft.add(colKey(x, z));
  }

  /** Belegte Spalten (hart und weich), sortiert (z, x). */
  footprint(): Cell[] {
    return [...new Set([...this.blocked, ...this.soft])]
      .map((k): Cell => [Math.floor(k / 0x10000) - 0x8000, (k % 0x10000) - 0x8000])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
}

// ---------------------------------------------------------------- Bausteine (Rollen des Hüllen-Vertrags)

/**
 * Rollen laut Hüllen-Vertrag (materialize `SHELL_ROLE_SHAPES`): Mauerkörper `wall_primary`, Sockel `foundation`,
 * Sockelgeschoss der Mauertürme `fort_base` (W7-B),
 * Brüstung/Zinnen `parapet`, Wehrgang-Belag und Turmplattform `walkway`, Turmböden `tower_floor`, Scharten
 * `arrow_slit`. Themes ohne die Befestigungsrollen fallen in der Materialisierung auf `wall_primary`/`window` zurück.
 */
export const B = {
  wall: { role: 'wall_primary', shape: 'block' },
  base: { role: 'foundation', shape: 'block' },
  // W7-B (plan/spikes/W7B_burg.md): Sockelgeschoss der Mauertürme bis zum Wehrgang – Themes ohne die Rolle bauen es aus
  // `wall_primary` (Rückfall, zellgleich), Holzburgen (nordic, rustic) aus Bruchstein
  fortBase: { role: 'fort_base', shape: 'block' },
  roof: { role: 'roof_main', shape: 'block' },
  post: { role: 'beam', shape: 'log', orient: { axis: 'y' } },
  parapet: { role: 'parapet', shape: 'block' },
  walkway: { role: 'walkway', shape: 'block' },
  floor: { role: 'tower_floor', shape: 'block' },
  slit: { role: 'arrow_slit', shape: 'pane' },
  // Türme und Gartenmauer (research/18 §5, Z2): Dachstufe (Glockenfuß, Einschnürung), Geländer/Turmspitze,
  // stehende Laterne (Außenlicht des Geländes), Segeltuch der Windmühle, Pfeiler, Pfeilerkappe, Heckenfüllung
  roofSlab: { role: 'roof_main', shape: 'slab', orient: { half: 'bottom' } },
  fence: { role: 'beam', shape: 'fence' },
  lantern: { role: 'light_outdoor', shape: 'lantern' },
  sail: { role: 'sail', shape: 'block' },
  pillar: { role: 'wall_quoin', shape: 'block' },
  cap: { role: 'wall_cornice', shape: 'slab', orient: { half: 'bottom' } },
  hedge: { role: 'leaves_bush', shape: 'block' },
  // Senkrecht und hängend (O1): Blitzableiter/Endstab mit der Spitze nach oben, senkrechte Kette, hängende Laterne
  rod: { role: 'finial', shape: 'lightning_rod', orient: { vertical: 'up' } },
  endRod: { role: 'finial', shape: 'end_rod', orient: { vertical: 'up' } },
  chain: { role: 'light_hanging', shape: 'chain', orient: { axis: 'y' } },
  hangingLantern: { role: 'light_hanging', shape: 'lantern', orient: { hanging: true } },
} as const satisfies Record<string, Block>;

/**
 * Trägt die Unterseite von `b` eine hängende Laterne, Kette oder Deckenglocke (stabile Mitte, O1)? Vollblock,
 * Stamm, Bohlen, untere Treppe/Stufe, Zaun, Kette; NICHT umgedrehte Treppe (Mitte halb frei) und obere Stufe.
 */
export const carriesBelow = (b: Block | undefined): boolean => b !== undefined && (
  b.shape === 'stairs' || b.shape === 'slab' ? b.orient?.half !== 'top' : ['block', 'planks', 'log', 'fence', 'chain'].includes(b.shape));

/** Treppe; `facing` = Richtung der hohen Rückseite (man steigt dorthin auf), `top` = umgedreht (Bogen, Kragstein). */
export const stair = (role: string, facing: HorizontalDir, half: 'bottom' | 'top' = 'bottom'): Block =>
  ({ role, shape: 'stairs', orient: { facing, half } });

/** Liegender oder stehender Stamm (Rute, Achse, Nabe). */
export const log = (axis: 'x' | 'y' | 'z'): Block => ({ role: 'beam', shape: 'log', orient: { axis } });

/**
 * Glocke; `facing` dreht den Rahmen. Ohne `attach` Bodenbefestigung (Standard-State, braucht volle Oberseite
 * darunter), `ceiling` hängend (braucht stabile Mitte darüber: Balken, Kette, Zaun).
 */
export const bell = (facing: HorizontalDir, attach?: 'ceiling'): Block =>
  ({ role: 'bell', shape: 'bell', orient: { facing, ...(attach !== undefined ? { attach } : {}) } });

/**
 * Falltür (W4-B, Luke der Wehrplatte): `facing` = weg vom Scharnier, geöffnet liegt das Blatt an `opposite(facing)` –
 * gleich dem `facing` der Leiter darunter ist sie dann kletterbar. Rolle `beam` (Holz des Themes), geschlossen.
 */
export const trapdoor = (facing: HorizontalDir, half: 'bottom' | 'top'): Block => ({ role: 'beam', shape: 'trapdoor', orient: { facing, half } });

/** Zauntor (Gartenmauer), `facing` = Blickrichtung beim Durchgehen. */
export const fenceGate = (facing: HorizontalDir): Block => ({ role: 'fence_outdoor', shape: 'fence_gate', orient: { facing } });
