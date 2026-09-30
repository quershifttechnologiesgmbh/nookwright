/**
 * W8-G (2026-09-27) Windrad-Wächter der fertigen Welt (Projektregel HANDOFF §1: keine hakenkreuzähnlichen Formen).
 *
 * Nach Autotiling und Vanilla-Updates, vor Physik, Licht und Palette sucht `guardPinwheels` chirale 4-zählige Figuren
 * (Windrad, Hakenkreuz, „Plus mit Haken“) mit dem Masken-Detektor aus `@mcda/core` (`scanLabelGrid`) in
 *  - jeder waagerechten Schicht (Blöcke mit sichtbarer Ober- oder Unterseite),
 *  - der Draufsicht (oberster Block je Säule; Figuren über mehrere Höhen, z. B. Pflanzen am Hang),
 *  - jeder senkrechten Ebene in x und z (Blöcke mit sichtbarer Seite: Fassaden, Fenstergitter, Banner, Mauern),
 * und das je Block (Name), je grober Sichtklasse (graue Steine, Pflanzen, Holz …) und in der Draufsicht zusätzlich als
 * „Figur vor Boden“ (alles außer natürlichem Boden und Wasser – zwei Materialien, die zusammen ein Motiv bilden).
 *
 * Treffer werden an der Quelle der Zufallsmischung behoben, deterministisch und ohne Zufallszahl: Pflanzen der
 * Streuung und Beete, Laub am Kronenrand und Teppiche werden entfernt (beide Hälften bei Doppelpflanzen), Vollblöcke einer Material-Mischung (Pflaster,
 * Boden, Mauerwerk) nehmen den häufigsten Nachbarblock derselben Mischung an. Pro Figur eine Zelle je Runde (Arm-Ende
 * zuerst), danach neu prüfen, bis nichts mehr gefunden wird – die Toleranz des Detektors (1 Störblock) verlangt meist
 * zwei Änderungen. Was so nicht zu beheben ist (Möbel, Lichtquellen, Blöcke mit Block-Entity), bleibt als `unfixed`
 * im Bericht; die Pipeline-Tests verlangen dort 0.
 */
import { scanLabelGrid, type Vec3 } from '@mcda/core';
import { AIR, isAir, type BlockState } from '@mcda/voxel';
import { emission } from './light.js';
import { isConnectionException, isTransparentFull, type WorldView } from './world.js';

export type PinwheelPlane = 'top' | 'y' | 'x' | 'z';
export type PinwheelGrouping = 'block' | 'class' | 'figure';

export interface PinwheelFigure {
  readonly plane: PinwheelPlane;
  /** Koordinate der Ebene (y, x bzw. z; Draufsicht: 0). */
  readonly at: number;
  readonly grouping: PinwheelGrouping;
  /** Blockname, Sichtklasse bzw. `figure`. */
  readonly cls: string;
  readonly size: number;
  readonly via: 'window' | 'component';
  readonly rotDiff: number;
  readonly mirrorDiff: number;
  readonly cells: readonly Vec3[];
}

export interface PinwheelFix {
  readonly pos: Vec3;
  readonly from: string;
  readonly to: string;
  readonly figure: string;
}

export interface PinwheelReport {
  /** Verschiedene Figuren der ersten Prüfung. */
  readonly found: number;
  readonly fixes: readonly PinwheelFix[];
  /** Figuren, die nach allen Runden noch stehen (sollte leer sein). */
  readonly unfixed: readonly PinwheelFigure[];
  readonly rounds: number;
}

// ------------------------------------------------------------------------------------------------ Sichtklassen

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
const WOOD_RE = new RegExp(`^(stripped_)?(${WOODS.join('|')})(_(planks|log|wood|stem|hyphae|fence|fence_gate|door|trapdoor|pressure_plate|button|block|mosaic))?$`);
const PLANT_RE = /(^|_)(flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|torchflower|wither_rose|peony|lilac|rose_bush|sunflower|fern|short_grass|tall_grass|grass|dead_bush|bush|sapling|wheat|carrots|potatoes|beetroots|stem|pink_petals|wildflowers|leaf_litter|mushroom|sugar_cane|cactus|seagrass|kelp|lily_pad|moss_carpet|vine|vines|roots|glow_lichen|pitcher_plant|pitcher_crop|dripleaf|azalea|eyeblossom|hanging_moss|propagule|torchflower_crop)$/;
const GROUND = new Set([
  'grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium', 'mud', 'moss_block', 'pale_moss_block', 'farmland', 'dirt_path',
  'sand', 'red_sand', 'snow_block', 'snow', 'powder_snow', 'clay', 'suspicious_sand', 'suspicious_gravel',
]);
const GREY_RE = /^(stone|cobblestone|mossy_cobblestone|andesite|polished_andesite|gravel|tuff|polished_tuff|tuff_bricks?|chiseled_tuff(_bricks)?|stone_bricks?|mossy_stone_bricks?|cracked_stone_bricks|chiseled_stone_bricks|smooth_stone|cobbled_deepslate|deepslate|polished_deepslate|deepslate_bricks?|deepslate_tiles?|cracked_deepslate_(bricks|tiles)|chiseled_deepslate|infested_.*)$/;

/** Grobe Sichtklasse eines Blocknamens (ähnlich aussehende Blöcke bilden zusammen eine Figur). */
export function visualClass(name: string): string {
  const n = name.replace(/^minecraft:/, '');
  if (n.startsWith('potted_')) return 'pot';
  if (n.endsWith('_leaves')) return 'leaves';
  if (PLANT_RE.test(n)) return 'plant';
  if (n === 'water' || n === 'bubble_column' || n.endsWith('ice')) return 'water';
  if (GROUND.has(n)) return 'ground';
  const base = n.replace(/_(stairs|slab|wall)$/, '');
  if (GREY_RE.test(base) || GREY_RE.test(`${base}s`)) return 'grey_stone';
  if (WOOD_RE.test(base)) return 'wood';
  if (base.includes('sandstone')) return 'sandstone';
  if (base.includes('glass')) return 'glass';
  if (/^(bricks?|mud_bricks?|packed_mud)$/.test(base)) return 'brick';
  return base;
}

interface Traits {
  readonly name: string;
  readonly air: boolean;
  readonly opaque: boolean;
  readonly block: number;
  readonly cls: number;
  /** 0 = Figur, -1 = Boden/Wasser/Luft */
  readonly figure: number;
}

function paletteTraits(view: WorldView, blockIds: Map<string, number>, classIds: Map<string, number>): Traits[] {
  const out: Traits[] = [];
  const id = (m: Map<string, number>, k: string): number => {
    let v = m.get(k);
    if (v === undefined) {
      v = m.size;
      m.set(k, v);
    }
    return v;
  };
  for (const s of view.volume.palette.states()) {
    const air = isAir(s);
    const cls = visualClass(s.name);
    out.push({
      name: s.name, air,
      opaque: !air && view.physicsOf(s).cls === 'full' && !isTransparentFull(s.name),
      block: air ? -1 : id(blockIds, s.name),
      cls: air ? -1 : id(classIds, cls),
      figure: air || cls === 'ground' || cls === 'water' ? -1 : 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ Suche

/** Alle chiralen 4-zähligen Figuren der fertigen Welt (rein lesend). */
export function scanPinwheels(
  view: WorldView,
  only: { readonly planes?: readonly PinwheelPlane[]; readonly groupings?: readonly PinwheelGrouping[] } = {},
): PinwheelFigure[] {
  const planes = new Set(only.planes ?? ['top', 'y', 'x', 'z']);
  const wanted = new Set(only.groupings ?? ['block', 'class', 'figure']);
  const vol = view.volume;
  const [W, H, L] = vol.size;
  const [ox, oy, oz] = vol.origin;
  const ids = vol.paletteIndices();
  const blockIds = new Map<string, number>();
  const classIds = new Map<string, number>();
  const traits = paletteTraits(view, blockIds, classIds);
  const blockNames = [...blockIds.keys()];
  const classNames = [...classIds.keys()];
  const classOfBlock: number[] = [];
  const classFigure: number[] = [];
  for (const t of traits) {
    if (t.block >= 0) classOfBlock[t.block] = t.cls;
    if (t.cls >= 0) classFigure[t.cls] = t.figure;
  }
  const WL = W * L;
  const n3 = WL * H;
  // Marken je Voxel einmal (schnelle Ebenen); Luft: -1
  const vb = new Int32Array(n3);
  const vc = new Int32Array(n3);
  const vf = new Int32Array(n3);
  const op = new Uint8Array(n3);
  for (let i = 0; i < n3; i++) {
    const t = traits[ids[i]!]!;
    vb[i] = t.block;
    vc[i] = t.cls;
    vf[i] = t.figure;
    op[i] = t.opaque ? 1 : 0;
  }
  const out: PinwheelFigure[] = [];
  const size = Math.max(WL, W * H, L * H);
  const gb = new Int32Array(size);
  const gc = new Int32Array(size);
  const gf = new Int32Array(size);
  const src = new Int32Array(size); // Rasterzelle → Voxelindex (-1 = nicht sichtbar)
  const put = (g: number, i: number): number => {
    src[g] = i;
    if (i < 0 || vb[i]! < 0) {
      gb[g] = gc[g] = gf[g] = -1;
      return 0;
    }
    gb[g] = vb[i]!;
    gc[g] = vc[i]!;
    gf[g] = vf[i]!;
    return 1;
  };
  const posOf = (i: number): Vec3 => {
    const y = Math.floor(i / WL);
    const r = i - y * WL;
    const z = Math.floor(r / W);
    return [r - z * W + ox, y + oy, z + oz];
  };
  const scanPlane = (plane: PinwheelPlane, coord: number, w: number, d: number, visible: number, groupings: readonly PinwheelGrouping[]): void => {
    if (visible < 8) return;
    const n = w * d;
    const grids: Record<PinwheelGrouping, [Int32Array, (l: number) => string]> = {
      block: [gb.subarray(0, n), (l) => blockNames[l]!],
      class: [gc.subarray(0, n), (l) => classNames[l]!],
      figure: [gf.subarray(0, n), () => 'figure'],
    };
    // Gleiche Masken nur einmal prüfen: eine Klasse aus genau einem Block ist dessen Maske, „Figur“ aus genau einer
    // Klasse ist deren Maske (Zählung genügt: Klasse ⊇ Block, Figur ⊇ Klasse).
    const blockCount = new Map<number, number>();
    const classCount = new Map<number, number>();
    for (let g = 0; g < n; g++) {
      if (gb[g]! >= 0) blockCount.set(gb[g]!, (blockCount.get(gb[g]!) ?? 0) + 1);
      if (gc[g]! >= 0) classCount.set(gc[g]!, (classCount.get(gc[g]!) ?? 0) + 1);
    }
    const blockSizes = new Map<number, Set<number>>(); // Klasse → Anzahlen ihrer Blöcke
    for (const [b, c] of blockCount) {
      const k = classOfBlock[b]!;
      if (!blockSizes.has(k)) blockSizes.set(k, new Set());
      blockSizes.get(k)!.add(c);
    }
    const classSizes = new Set<number>();
    for (const [k, c] of classCount) if (classFigure[k] === 0) classSizes.add(c);
    const only: Record<PinwheelGrouping, ((label: number, count: number) => boolean) | undefined> = {
      block: undefined,
      class: (label, count) => !(blockSizes.get(label)?.has(count) ?? false),
      figure: (_label, count) => !classSizes.has(count),
    };
    for (const grouping of groupings) {
      if (!wanted.has(grouping)) continue;
      const [grid, name] = grids[grouping];
      for (const h of scanLabelGrid(grid, w, d, {}, only[grouping])) {
        out.push({
          plane, at: coord, grouping, cls: name(h.label), size: h.size, via: h.via, rotDiff: h.rotDiff, mirrorDiff: h.mirrorDiff,
          cells: h.cells.map(([u, v]) => posOf(src[v * w + u]!)),
        });
      }
    }
  };
  const ALL: readonly PinwheelGrouping[] = ['block', 'class', 'figure'];
  // „Figur vor Boden“ (zwei Materialien bilden zusammen ein Motiv, z. B. Pflaster + Beet) nur in der Draufsicht: dort
  // steht sie vor natürlichem Boden. In Schichten und Fassaden wäre sie eine Möbel- oder Wandgruppe aus verschiedenen
  // Blöcken (Tisch mit Hocker und Fass) – das ist keine Figur einer Klasse (Sichtbarkeitsschwelle, Plan W8G).
  const SIDE: readonly PinwheelGrouping[] = ['block', 'class'];
  // Draufsicht: oberster Block je Säule
  if (planes.has('top')) {
    let visible = 0;
    for (let z = 0; z < L; z++) {
      for (let x = 0; x < W; x++) {
        let i = -1;
        for (let y = H - 1; y >= 0; y--) {
          const j = x + z * W + y * WL;
          if (vb[j]! >= 0) {
            i = j;
            break;
          }
        }
        visible += put(z * W + x, i);
      }
    }
    scanPlane('top', 0, W, L, visible, ALL);
  }
  // waagerechte Schichten: sichtbar von oben oder unten (außerhalb: oben Himmel, unten verdeckt)
  for (let y = 0; y < H && planes.has('y'); y++) {
    let visible = 0;
    for (let z = 0; z < L; z++) {
      for (let x = 0; x < W; x++) {
        const i = x + z * W + y * WL;
        const seen = y + 1 >= H || op[i + WL] === 0 || (y > 0 && op[i - WL] === 0);
        visible += put(z * W + x, seen ? i : -1);
      }
    }
    scanPlane('y', y + oy, W, L, visible, SIDE);
  }
  // senkrechte Ebenen: sichtbar von der Seite (außerhalb des Volumens: verdeckt, Anschluss an die Welt)
  for (let x = 0; x < W && planes.has('x'); x++) {
    let visible = 0;
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < L; z++) {
        const i = x + z * W + y * WL;
        const seen = (x + 1 < W && op[i + 1] === 0) || (x > 0 && op[i - 1] === 0);
        visible += put(y * L + z, seen ? i : -1);
      }
    }
    scanPlane('x', x + ox, L, H, visible, SIDE);
  }
  for (let z = 0; z < L && planes.has('z'); z++) {
    let visible = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = x + z * W + y * WL;
        const seen = (z + 1 < L && op[i + W] === 0) || (z > 0 && op[i - W] === 0);
        visible += put(y * W + x, seen ? i : -1);
      }
    }
    scanPlane('z', z + oz, W, H, visible, SIDE);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ Beheben

const key = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;
const figureKey = (f: PinwheelFigure): string => [...f.cells].map(key).sort().join(';');

/** In-Ebene-Nachbarn (8) einer Zelle der Figur. */
function planeNeighbours(f: PinwheelFigure, p: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      if (a === 0 && b === 0) continue;
      out.push(f.plane === 'x' ? [p[0], p[1] + b, p[2] + a] : f.plane === 'z' ? [p[0] + a, p[1] + b, p[2]] : [p[0] + a, p[1], p[2] + b]);
    }
  }
  return out;
}

/** Bewuchs und Auflagen: dürfen zum Beheben einfach fehlen (Streuung, Beete, Laubrand, Teppich). */
const plantLike = (s: BlockState): boolean => ['plant', 'leaves'].includes(visualClass(s.name)) || s.name.endsWith('_carpet');

/** Ersatz einer Zelle, der die Figur bricht, oder `undefined` (nicht automatisch behebbar). */
function replacement(view: WorldView, f: PinwheelFigure, p: Vec3, inFigure: (s: BlockState) => boolean): BlockState | undefined {
  const vol = view.volume;
  const cell = vol.cell(p);
  if (cell === undefined || cell.blockEntity !== undefined) return undefined;
  const s = cell.state;
  if (emission(s) > 0) return undefined;
  if (plantLike(s)) return AIR;
  const info = view.infoOf(s);
  if (info.phys.cls !== 'full' || isTransparentFull(s.name) || isConnectionException(s.name) || (info.kind !== 'plain' && info.kind !== 'axis')) return undefined;
  const above: Vec3 = [p[0], p[1] + 1, p[2]];
  const carries = vol.contains(above) && !isAir(vol.stateAt(above)) && !traitsOpaque(view, vol.stateAt(above));
  const below: Vec3 = [p[0], p[1] - 1, p[2]];
  const floor = !vol.contains(below) || traitsOpaque(view, vol.stateAt(below));
  const own = visualClass(s.name);
  const tally = new Map<string, { state: BlockState; count: number; same: boolean }>();
  for (const q of planeNeighbours(f, p)) {
    if (!vol.contains(q)) continue;
    const c = vol.cell(q);
    if (c === undefined || c.blockEntity !== undefined) continue;
    const t = c.state;
    if (isAir(t) || inFigure(t) || t.name === s.name || emission(t) > 0) continue;
    const ti = view.infoOf(t);
    if (ti.phys.cls !== 'full' || isTransparentFull(t.name) || isConnectionException(t.name) || (ti.kind !== 'plain' && ti.kind !== 'axis')) continue;
    if (ti.phys.flags.includes('falls') && !floor) continue;
    const same = visualClass(t.name) === own;
    if (carries && !same) continue; // trägt eine Pflanze/Laterne: nur gleichartiger Ersatz (Boden bleibt Boden)
    const k = t.name;
    const e = tally.get(k);
    if (e === undefined) tally.set(k, { state: t, count: 1, same });
    else e.count++;
  }
  const best = [...tally.values()].sort((a, b) => Number(b.same) - Number(a.same) || b.count - a.count || a.state.name.localeCompare(b.state.name))[0];
  return best?.state;
}

function traitsOpaque(view: WorldView, s: BlockState): boolean {
  return !isAir(s) && view.physicsOf(s).cls === 'full' && !isTransparentFull(s.name);
}

/** Gehört ein Zustand zur Maske der Figur (gleicher Block / gleiche Klasse / Figur vor Boden)? */
function memberOf(f: PinwheelFigure): (s: BlockState) => boolean {
  if (f.grouping === 'block') return (s) => s.name === f.cls;
  if (f.grouping === 'class') return (s) => !isAir(s) && visualClass(s.name) === f.cls;
  return (s) => !isAir(s) && !['ground', 'water'].includes(visualClass(s.name));
}

/** Eine Zelle der Figur ändern: Arm-Enden (wenigste Nachbarn in der Figur) zuerst, dann feste Reihenfolge. */
function fixFigure(view: WorldView, f: PinwheelFigure): PinwheelFix | undefined {
  const vol = view.volume;
  const cells = new Set(f.cells.map(key));
  const order = [...f.cells].map((p) => ({ p, deg: planeNeighbours(f, p).filter((q) => cells.has(key(q))).length }))
    .sort((a, b) => a.deg - b.deg || a.p[1] - b.p[1] || a.p[2] - b.p[2] || a.p[0] - b.p[0]);
  const member = memberOf(f);
  for (const { p } of order) {
    const from = vol.stateAt(p);
    const to = replacement(view, f, p, member);
    if (to === undefined) continue;
    const label = `${f.plane}${f.plane === 'top' ? '' : `=${f.at}`} ${f.grouping}:${f.cls} ${f.size}×${f.size}`;
    if (isAir(to)) {
      vol.clear(p);
      // Doppelpflanze: die andere Hälfte gehört dazu
      const half = from.properties['half'];
      if (half === 'upper' || half === 'lower') {
        const q: Vec3 = [p[0], p[1] + (half === 'lower' ? 1 : -1), p[2]];
        if (vol.contains(q) && vol.stateAt(q).name === from.name) vol.clear(q);
      }
    } else {
      vol.replaceState(p, to);
    }
    return { pos: p, from: from.name, to: to.name, figure: label };
  }
  return f.plane === 'top' ? fixTopHole(view, f) : undefined;
}

/**
 * W9-Integration (2026-09-27): Draufsicht-Figur, deren Zellen selbst nicht zu ändern sind – typisch natürlicher Boden
 * (Gras/Moos des Erdhaus-Hügels, W9-G4), der zwischen dicht gestreuten Pflanzen als Windrad frei bleibt. Die Quelle ist
 * die Streuung: eine Pflanze in einem Loch des Hüllrechtecks entfällt (der Boden darunter wird sichtbar, die Figur ist
 * nicht mehr 4-zählig). Feste Reihenfolge, kein Zufall.
 */
function fixTopHole(view: WorldView, f: PinwheelFigure): PinwheelFix | undefined {
  const vol = view.volume;
  const cols = new Set(f.cells.map((p) => `${p[0]},${p[2]}`));
  const xs = f.cells.map((p) => p[0]);
  const zs = f.cells.map((p) => p[2]);
  const top = vol.origin[1] + vol.size[1] - 1;
  for (let z = Math.min(...zs); z <= Math.max(...zs); z++) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
      if (cols.has(`${x},${z}`)) continue;
      let p: Vec3 | undefined;
      for (let y = top; y >= vol.origin[1]; y--) {
        const q: Vec3 = [x, y, z];
        if (vol.contains(q) && !isAir(vol.stateAt(q))) {
          p = q;
          break;
        }
      }
      if (p === undefined) continue;
      const cell = vol.cell(p);
      if (cell === undefined || cell.blockEntity !== undefined || emission(cell.state) > 0 || !plantLike(cell.state)) continue;
      const from = cell.state;
      vol.clear(p);
      const half = from.properties['half'];
      if (half === 'upper' || half === 'lower') {
        const q: Vec3 = [p[0], p[1] + (half === 'lower' ? 1 : -1), p[2]];
        if (vol.contains(q) && vol.stateAt(q).name === from.name) vol.clear(q);
      }
      return { pos: p, from: from.name, to: AIR.name, figure: `top ${f.grouping}:${f.cls} ${f.size}×${f.size}` };
    }
  }
  return undefined;
}

/**
 * Suchen und beheben, bis die Welt frei von Windrad-Figuren ist (höchstens `maxRounds` Runden). Deterministisch: feste
 * Scan-Reihenfolge, feste Zellwahl, kein Zufall.
 */
export function guardPinwheels(view: WorldView, maxRounds = 12): PinwheelReport {
  const fixes: PinwheelFix[] = [];
  let figures = scanPinwheels(view);
  const found = new Set(figures.map(figureKey)).size;
  let rounds = 0;
  let unfixed: PinwheelFigure[] = [];
  while (figures.length > 0 && rounds < maxRounds) {
    rounds++;
    const touched = new Set<string>();
    unfixed = [];
    let changed = 0;
    for (const f of figures) {
      if (f.cells.some((p) => touched.has(key(p)))) continue;
      const fix = fixFigure(view, f);
      if (fix === undefined) {
        unfixed.push(f);
        continue;
      }
      fixes.push(fix);
      touched.add(key(fix.pos));
      changed++;
    }
    if (changed === 0) break;
    figures = scanPinwheels(view);
    unfixed = figures;
  }
  return { found, fixes, unfixed: dedupe(unfixed), rounds };
}

function dedupe(figs: readonly PinwheelFigure[]): PinwheelFigure[] {
  const seen = new Set<string>();
  return figs.filter((f) => {
    const k = figureKey(f);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
