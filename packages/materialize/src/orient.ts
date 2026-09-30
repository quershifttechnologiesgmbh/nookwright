/**
 * Orientierungs-Adapter (plan/01 §4.2): semantische Ausrichtung → rohe Properties je Blockart.
 *
 * Katalog: `Orient` ist RELATIV zur Komponente (kanonische Front = Süden) und wird mit der Pose der
 * Platzierung in Weltrichtungen übersetzt. Hülle: `ShellOrient` ist ABSOLUT und hat bereits die
 * Minecraft-Bedeutung (Vertrag blueprint/shell/types.ts) – er wird nur auf Properties abgebildet.
 *
 * Jede nicht passende Angabe ist ein Fehler (`OrientError`), nie ein stilles Ignorieren.
 */
import type { Orient } from '@mcda/catalog';
import type { ShellOrient } from '@mcda/blueprint';
import { isHorizontal, opposite, resolveRelDir, rotateDir, transformDir, type Dir, type HorizontalDir, type Pose } from '@mcda/core';
import type { BlockKind } from './kinds.js';

export type Props = Record<string, string>;

export class OrientError extends Error {
  override readonly name = 'OrientError';
}

/** Semantische Ausrichtung in Weltrichtungen (nach Anwendung der Pose). */
export interface WorldOrient {
  readonly front?: Dir;
  readonly back?: Dir;
  readonly attachTo?: Dir;
  readonly axis?: 'x' | 'y' | 'z';
  readonly upsideDown?: boolean;
  readonly hanging?: boolean;
  readonly open?: boolean;
  readonly part?: 'head' | 'foot';
  readonly half?: 'upper' | 'lower';
}

type OrientKey = keyof WorldOrient;

/** Katalog-Orient (relativ) + Pose → Weltrichtungen. */
export function worldOrient(o: Orient, pose: Pick<Pose, 'rot' | 'mirror'>): WorldOrient {
  if (o.attachTo === 'parent') throw new OrientError('orient.attachTo "parent" wird noch nicht unterstützt (Eltern-Komponente unbekannt) – relative Seite angeben');
  let axis: WorldOrient['axis'];
  if (o.axis !== undefined) {
    const local = o.axis === 'along' ? 'x' : o.axis === 'across' ? 'z' : o.axis;
    axis = local === 'y' || pose.rot % 2 === 0 ? local : local === 'x' ? 'z' : 'x';
  }
  return {
    ...(o.front !== undefined ? { front: resolveRelDir(o.front, pose) } : {}),
    ...(o.back !== undefined ? { back: resolveRelDir(o.back, pose) } : {}),
    ...(o.attachTo !== undefined ? { attachTo: resolveRelDir(o.attachTo, pose) } : {}),
    ...(axis !== undefined ? { axis } : {}),
    ...(o.upsideDown !== undefined ? { upsideDown: o.upsideDown } : {}),
    ...(o.hanging !== undefined ? { hanging: o.hanging } : {}),
    ...(o.open !== undefined ? { open: o.open } : {}),
    ...(o.part !== undefined ? { part: o.part } : {}),
    ...(o.half !== undefined ? { half: o.half } : {}),
  };
}

const bool = (b: boolean): string => (b ? 'true' : 'false');

/** Welche Richtung ergibt `facing`? `same` = facing zeigt dorthin, `opposite` = facing zeigt weg. */
type FacingRule = readonly (readonly ['front' | 'back' | 'attachTo', 'same' | 'opposite'])[];

class Adapter {
  private readonly used = new Set<OrientKey>();

  constructor(
    private readonly o: WorldOrient,
    private readonly block: string,
    private readonly kind: BlockKind,
  ) {}

  get<K extends OrientKey>(k: K): WorldOrient[K] {
    if (this.o[k] !== undefined) this.used.add(k);
    return this.o[k];
  }

  fail(msg: string): never {
    throw new OrientError(`${this.block} (${this.kind}): ${msg}`);
  }

  /** Richtung aus mehreren Angaben; widersprüchliche Angaben sind ein Fehler. */
  facing(rules: FacingRule): Dir | undefined {
    let result: Dir | undefined;
    let from = '';
    for (const [key, rel] of rules) {
      const d = this.get(key);
      if (d === undefined) continue;
      const f = rel === 'same' ? d : opposite(d);
      if (result !== undefined && result !== f) this.fail(`orient.${from} und orient.${key} widersprechen sich (${result} ≠ ${f})`);
      result = f;
      from = key;
    }
    return result;
  }

  horizontal(rules: FacingRule): HorizontalDir | undefined {
    const d = this.facing(rules);
    if (d !== undefined && !isHorizontal(d)) this.fail(`braucht eine horizontale Richtung, nicht '${d}'`);
    return d as HorizontalDir | undefined;
  }

  /** Nicht verbrauchte Angaben → Fehler. */
  finish(props: Props): Props {
    const unused = (Object.keys(this.o) as OrientKey[]).filter((k) => this.o[k] !== undefined && !this.used.has(k));
    if (unused.length > 0) this.fail(`orient.${unused.join(', orient.')} passt nicht zu dieser Blockart`);
    return props;
  }
}

const FRONT_FIRST: FacingRule = [['front', 'same'], ['back', 'opposite']];
const BACK_FIRST: FacingRule = [['back', 'same'], ['front', 'opposite']];
const ATTACHED: FacingRule = [['attachTo', 'opposite'], ['front', 'same'], ['back', 'opposite']];

/**
 * Semantische Ausrichtung (Weltrichtungen) → Properties. Tabelle siehe plan/spikes/M1_materialize.md.
 */
export function orientProps(kind: BlockKind, block: string, o: WorldOrient): Props {
  const a = new Adapter(o, block, kind);
  const p: Props = {};
  const set = (k: string, v: string | undefined): void => {
    if (v !== undefined) p[k] = v;
  };
  switch (kind) {
    case 'stairs': // facing = hohe Rückseite
      set('facing', a.horizontal(BACK_FIRST));
      set('half', a.get('upsideDown') === undefined ? undefined : a.get('upsideDown') ? 'top' : 'bottom');
      break;
    case 'slab':
      set('type', a.get('upsideDown') === undefined ? undefined : a.get('upsideDown') ? 'top' : 'bottom');
      break;
    case 'trapdoor': // facing = weg vom Scharnier; offen liegt sie an der Seite opposite(facing)
      set('facing', a.horizontal([['front', 'same'], ['back', 'opposite'], ['attachTo', 'opposite']]));
      set('half', a.get('upsideDown') === undefined ? undefined : a.get('upsideDown') ? 'top' : 'bottom');
      set('open', a.get('open') === undefined ? undefined : bool(a.get('open')!));
      break;
    case 'fence_gate':
      set('facing', a.horizontal(FRONT_FIRST));
      set('open', a.get('open') === undefined ? undefined : bool(a.get('open')!));
      break;
    case 'door': // facing = Blickrichtung des Platzierenden; das Türblatt sitzt an opposite(facing)
      set('facing', a.horizontal(FRONT_FIRST));
      set('half', a.get('half'));
      set('open', a.get('open') === undefined ? undefined : bool(a.get('open')!));
      break;
    case 'bed': // facing = Fuß → Kopf; der Kopf liegt „hinten“
      set('facing', a.horizontal(BACK_FIRST));
      set('part', a.get('part'));
      break;
    case 'wall_attached': // facing = weg von der Wand
      set('facing', a.horizontal(ATTACHED));
      break;
    case 'chest':
    case 'horizontal':
      set('facing', a.horizontal(FRONT_FIRST));
      break;
    case 'directional': // Fass: Öffnung = front, auch up/down
      set('facing', a.facing(FRONT_FIRST));
      set('open', a.get('open') === undefined ? undefined : bool(a.get('open')!));
      break;
    case 'anvil': { // Vanilla: facing = CW(Blickrichtung) = Längsachse; Arbeitsseite (front) senkrecht dazu
      const work = a.horizontal(FRONT_FIRST);
      set('facing', work === undefined ? undefined : rotateDir(work, -1));
      break;
    }
    case 'face_attached': { // Schleifstein, Knopf, Hebel
      const at = a.get('attachTo');
      if (at === undefined || at === 'down' || at === 'up') {
        set('face', at === 'up' ? 'ceiling' : 'floor');
        // Boden/Decke: facing = Blickrichtung des Platzierenden = von der Front zum Block
        set('facing', a.horizontal([['front', 'opposite'], ['back', 'same']]));
      } else {
        set('face', 'wall');
        set('facing', a.horizontal([['attachTo', 'opposite'], ['front', 'same'], ['back', 'opposite']]));
      }
      break;
    }
    case 'lantern':
      set('hanging', a.get('hanging') === undefined ? undefined : bool(a.get('hanging')!));
      break;
    case 'axis':
      set('axis', a.get('axis'));
      break;
    case 'rotation16': { // stehendes Schild/Banner/Kopf: 0 = Süden, im Uhrzeigersinn +4
      const f = a.horizontal(FRONT_FIRST);
      if (f !== undefined) p['rotation'] = String(rotationOf(f));
      break;
    }
    case 'hopper': { // facing = Auslauf: attachTo/front = Block, in den er einspeist (down oder waagerecht)
      const out = a.facing([['attachTo', 'same'], ['front', 'same'], ['back', 'opposite']]);
      if (out === 'up') a.fail('ein Trichter kann nicht nach oben ausgeben (facing up gibt es nicht)');
      set('facing', out);
      break;
    }
    case 'diode': // Verstärker/Komparator: Signal läuft nach front; Vanilla-facing zeigt zur Eingangsseite
      set('facing', a.horizontal(BACK_FIRST));
      break;
    case 'crafter': { // orientation = <front>_<top>; front = Ausgabeseite (Vanilla FrontAndTop)
      const front = a.get('front');
      const back = a.get('back');
      if (front === undefined) { // Deko-Crafter ohne Ausrichtung (z. B. Vorratsregal): Vanilla-Standard, bitgleich zum Bestand
        if (back !== undefined) a.fail('orient.back ohne orient.front');
        break;
      }
      if (isHorizontal(front)) {
        if (back !== undefined && back !== opposite(front)) a.fail(`orient.back (${back}) widerspricht der Front (${front})`);
        p['orientation'] = `${front}_up`;
      } else {
        if (back === undefined || !isHorizontal(back)) a.fail('mit senkrechter Front braucht der Crafter orient.back als waagerechte Oberseite');
        p['orientation'] = `${front}_${back}`;
      }
      break;
    }
    case 'candle':
    case 'fence':
    case 'pane':
    case 'wall':
    case 'redstone_wire': // Verbindungen rechnet das Autotiling (redstone.ts), keine Ausrichtung
    case 'plain':
      break;
  }
  return a.finish(p);
}

/**
 * Hülle (absolut, Minecraft-Bedeutung) → Properties. Senkrecht/hängend/Befestigung (O1): `vertical` → facing up|down
 * (6-Wege-Blöcke, Trichter nur down), `hanging` → Laterne, `attach` → Glocke `attachment` bzw. Hebel/Knopf `face`
 * (Tabelle: plan/spikes/O1_orient_vertikal.md).
 */
export function shellOrientProps(kind: BlockKind, block: string, o: ShellOrient): Props {
  const p: Props = {};
  const used = new Set<keyof ShellOrient>();
  const fail = (msg: string): never => {
    throw new OrientError(`${block} (${kind}, Hülle): ${msg}`);
  };
  const take = <K extends keyof ShellOrient>(k: K): ShellOrient[K] => {
    if (o[k] !== undefined) used.add(k);
    return o[k];
  };
  const vertical = (): string | undefined => {
    const h = take('half');
    if (h === undefined) return undefined;
    if (h !== 'bottom' && h !== 'top') fail(`half '${h}' passt nicht (erwartet bottom|top)`);
    return h;
  };
  /** 6-Wege-facing (O1): waagerecht über `facing`, senkrecht über `vertical`; beides zugleich ist ein Widerspruch. */
  const sixWay = (): string | undefined => {
    if (o.facing !== undefined && o.vertical !== undefined) fail(`orient.facing (${o.facing}) und orient.vertical (${o.vertical}) schließen sich aus`);
    return take('facing') ?? take('vertical');
  };
  switch (kind) {
    case 'stairs':
      if (o.facing !== undefined) p['facing'] = take('facing')!;
      if (o.half !== undefined) p['half'] = vertical()!;
      // Soll-Form der Dachtreppe; das Autotiling rechnet sie nach der Vanilla-Regel nach (Abweichung → Warnung)
      if (o.stairShape !== undefined) p['shape'] = take('stairShape')!;
      break;
    case 'slab':
      if (o.half !== undefined) p['type'] = vertical()!;
      break;
    case 'trapdoor':
      if (o.facing !== undefined) p['facing'] = take('facing')!;
      if (o.half !== undefined) p['half'] = vertical()!;
      // Deko des Außenprofils (F1): offen liegt die Falltür flach an der Wand (research/16 W4)
      if (o.open !== undefined) p['open'] = bool(take('open')!);
      break;
    case 'door': {
      if (o.facing !== undefined) p['facing'] = take('facing')!;
      const h = take('half');
      if (h !== undefined) {
        if (h !== 'lower' && h !== 'upper') fail(`half '${h}' passt nicht (erwartet lower|upper)`);
        p['half'] = h;
      }
      if (o.hinge !== undefined) p['hinge'] = take('hinge')!;
      break;
    }
    case 'axis':
      if (o.axis !== undefined) p['axis'] = take('axis')!;
      break;
    case 'horizontal':
      if (o.facing !== undefined) p['facing'] = take('facing')!;
      // Glocke (einziger Block mit `attachment`); bei anderen Blöcken bleibt attach unverbraucht → Fehler unten
      if (block === 'bell' && o.attach !== undefined) p['attachment'] = take('attach') === 'wall' ? 'single_wall' : o.attach;
      break;
    case 'chest':
    case 'wall_attached':
    case 'fence_gate':
    case 'anvil':
      if (o.facing !== undefined) p['facing'] = take('facing')!;
      break;
    case 'directional': { // Endstab, Blitzableiter, Fass, Spender …
      const f = sixWay();
      if (f !== undefined) p['facing'] = f;
      break;
    }
    case 'crafter': // Hülle: nur waagerechte Front (Oberseite oben)
      if (o.facing !== undefined) p['orientation'] = `${take('facing')!}_up`;
      break;
    case 'hopper': {
      const f = sixWay();
      if (f === 'up') fail('ein Trichter kann nicht nach oben ausgeben (facing up gibt es nicht)');
      if (f !== undefined) p['facing'] = f;
      break;
    }
    case 'face_attached': { // Hebel, Knopf, Schleifstein: attach → face
      const at = take('attach');
      if (at === 'double_wall') fail('attach double_wall gibt es nur für die Glocke (erwartet floor|ceiling|wall)');
      if (at !== undefined) p['face'] = at;
      if (o.facing !== undefined) p['facing'] = take('facing')!;
      break;
    }
    case 'lantern':
      if (o.hanging !== undefined) p['hanging'] = bool(take('hanging')!);
      break;
    default:
      break;
  }
  const unused = (Object.keys(o) as (keyof ShellOrient)[]).filter((k) => o[k] !== undefined && !used.has(k));
  if (unused.length > 0) fail(`orient.${unused.join(', orient.')} passt nicht zu dieser Blockart`);
  return p;
}

const HORIZONTAL_ROT: readonly HorizontalDir[] = ['south', 'west', 'north', 'east'];

/**
 * Rohe Properties (`state`, Notausgang) sind in kanonischer Lage geschrieben und drehen/spiegeln mit
 * der Pose (plan/01 §5): facing, axis, rotation, hinge, Truhen-type, Treppen-shape.
 */
export function transformRawState(kind: BlockKind, raw: Readonly<Record<string, string>>, pose: Pick<Pose, 'rot' | 'mirror'>): Props {
  const out: Props = { ...raw };
  const mirrored = pose.mirror !== 'none';
  const swapLR = (v: string): string => (v.includes('left') ? v.replace('left', 'right') : v.includes('right') ? v.replace('right', 'left') : v);
  const f = raw['facing'];
  if (f !== undefined && ['north', 'east', 'south', 'west'].includes(f)) out['facing'] = transformDir(f as Dir, pose);
  const ax = raw['axis'];
  if (ax !== undefined && pose.rot % 2 === 1 && (ax === 'x' || ax === 'z')) out['axis'] = ax === 'x' ? 'z' : 'x';
  const r = raw['rotation'];
  if (r !== undefined && kind === 'rotation16' && /^\d+$/.test(r)) {
    let v = Number(r);
    if (pose.mirror === 'x') v = (16 - v) % 16;
    if (pose.mirror === 'z') v = (24 - v) % 16;
    out['rotation'] = String((v + 4 * pose.rot) % 16);
  }
  if (mirrored && raw['hinge'] !== undefined) out['hinge'] = swapLR(raw['hinge']);
  if (mirrored && kind === 'chest' && raw['type'] !== undefined) out['type'] = swapLR(raw['type']);
  if (mirrored && kind === 'stairs' && raw['shape'] !== undefined) out['shape'] = swapLR(raw['shape']);
  return out;
}

/** Blockarten, deren Ausrichtung fachlich zählt: ohne Richtung (orient oder state) → Fehler. */
export const NEEDS_FACING: ReadonlySet<BlockKind> = new Set<BlockKind>([
  'stairs', 'bed', 'door', 'trapdoor', 'wall_attached', 'chest', 'anvil', 'face_attached', 'horizontal', 'directional', 'fence_gate',
  'hopper', 'diode',
]);

/** Weitere Pflicht-Properties je Blockart (ohne sie ist der Block mehrdeutig). */
export const REQUIRED_PROPS: Readonly<Partial<Record<BlockKind, readonly string[]>>> = {
  bed: ['part'],
  door: ['half'],
};

/** Rotation 0–15 (Schild, Banner, Kopf) einer horizontalen Blickrichtung: Süden 0, Westen 4, Norden 8, Osten 12. */
export function rotationOf(front: HorizontalDir): number {
  return HORIZONTAL_ROT.indexOf(front) * 4;
}
