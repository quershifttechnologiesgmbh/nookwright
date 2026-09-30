/**
 * Blockart-Klassifikation (Grundlage für Orientierungs-Adapter, Autotiling, Stütze und Licht).
 * Abgeleitet aus Blockname + Property-Tabelle der Registry – nicht aus einer Handliste pro Block,
 * damit neue Holzarten/Farben (Pappel, 26.3-Wolltreppen …) ohne Pflege funktionieren.
 */
import type { Registry } from '@mcda/platform';

export type BlockKind =
  | 'stairs' //         facing, half, shape
  | 'slab' //           type bottom|top|double
  | 'fence' //          north/east/south/west bool (Autotiling)
  | 'fence_gate' //     facing, open, in_wall
  | 'pane' //           Glasscheibe, Eisen-/Kupfergitter (Autotiling)
  | 'wall' //           Mauer: up + none/low/tall (Autotiling)
  | 'trapdoor' //       facing, half, open
  | 'door' //           facing, half upper|lower, hinge, open
  | 'bed' //            part, facing (Fuß → Kopf)
  | 'wall_attached' //  Wandschild, Wandfackel, Wandbanner, Wand-Hängeschild, Wandkopf: facing = weg von der Wand
  | 'lantern' //        hanging
  | 'axis' //           Stamm, Säule, Kette: axis x|y|z
  | 'chest' //          facing, type single|left|right
  | 'anvil' //          facing = Längsachse (Vanilla: CW der Blickrichtung)
  | 'face_attached' //  face floor|wall|ceiling + facing (Schleifstein, Knopf, Hebel)
  | 'candle' //         candles 1–4, lit
  | 'rotation16' //     rotation 0–15 (stehendes Schild/Banner, Kopf)
  | 'directional' //    facing mit up/down (Fass, Spender …)
  | 'horizontal' //     facing nur horizontal (Ofen, Räucherofen, Hochofen, Lesepult …)
  | 'hopper' //         facing = Auslauf: down oder horizontal, nie up (Trichter)
  | 'diode' //          Verstärker/Komparator: facing = EINGANGSseite, Signal läuft nach opposite(facing)
  | 'crafter' //        orientation = <front>_<top>: front = Ausgabeseite (waagerecht: <dir>_up; senkrecht: down|up_<waagerechte Oberseite>)
  | 'redstone_wire' //  Redstone-Staub: north/east/south/west none|side|up (Autotiling, redstone.ts), power
  | 'plain'; //         keine Ausrichtung

const ANVILS = new Set(['anvil', 'chipped_anvil', 'damaged_anvil']);

type Props = Readonly<Record<string, readonly string[]>>;

const has = (p: Props, k: string): boolean => Object.hasOwn(p, k);
const values = (p: Props, k: string): readonly string[] => (has(p, k) ? p[k]! : []);

export function classifyBlock(name: string, props: Props): BlockKind {
  if (name.endsWith('_stairs') && has(props, 'facing') && has(props, 'half') && has(props, 'shape')) return 'stairs';
  if (name.endsWith('_slab') && values(props, 'type').includes('double')) return 'slab';
  if (name.endsWith('_fence_gate') && has(props, 'in_wall')) return 'fence_gate';
  if (name.endsWith('_fence') && values(props, 'north').includes('true')) return 'fence';
  if (has(props, 'up') && values(props, 'north').includes('low')) return 'wall';
  if (values(props, 'north').includes('true') && (name.endsWith('_pane') || name.endsWith('_bars'))) return 'pane';
  if (name.endsWith('_trapdoor') && has(props, 'half')) return 'trapdoor';
  if (name.endsWith('_door') && has(props, 'hinge')) return 'door';
  if (name.endsWith('_bed') && has(props, 'part')) return 'bed';
  if (/(^|_)wall_(sign|torch|banner|hanging_sign|head|skull)$/.test(name) && has(props, 'facing')) return 'wall_attached';
  if (has(props, 'hanging') && name.endsWith('lantern')) return 'lantern';
  if (ANVILS.has(name)) return 'anvil';
  if (has(props, 'face') && has(props, 'facing')) return 'face_attached';
  if (has(props, 'candles')) return 'candle';
  if (values(props, 'type').includes('left') && has(props, 'facing')) return 'chest';
  if (has(props, 'rotation') && values(props, 'rotation').length === 16) return 'rotation16';
  if (has(props, 'axis') && values(props, 'axis').includes('y')) return 'axis';
  // Redstone (plan/spikes/R1_funktional.md): vor der allgemeinen facing-Regel, sonst landen sie bei 'horizontal'
  if (has(props, 'power') && values(props, 'north').includes('side')) return 'redstone_wire';
  // Crafter (1.21): `orientation` statt `facing`, sonst bliebe er 'plain' und drehte nicht mit der Pose
  if (has(props, 'orientation') && has(props, 'crafting')) return 'crafter';
  if (values(props, 'facing').includes('down') && !values(props, 'facing').includes('up')) return 'hopper';
  if (has(props, 'facing') && (has(props, 'delay') || has(props, 'mode'))) return 'diode';
  if (has(props, 'facing')) return values(props, 'facing').includes('up') ? 'directional' : 'horizontal';
  return 'plain';
}

/** Klassifikation mit Cache pro Registry (Name → Art). */
export class KindIndex {
  private readonly cache = new Map<string, BlockKind>();

  constructor(private readonly registry: Registry) {}

  of(name: string): BlockKind {
    let k = this.cache.get(name);
    if (k === undefined) {
      k = classifyBlock(name, this.registry.listProperties(name) ?? {});
      this.cache.set(name, k);
    }
    return k;
  }
}

/** Holzzäune verbinden sich untereinander, der Netherziegelzaun nur mit sich (Faktencheck 14). */
export function fenceFamily(name: string): 'wood' | 'nether' {
  return name === 'nether_brick_fence' ? 'nether' : 'wood';
}
