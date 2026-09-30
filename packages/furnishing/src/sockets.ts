import type { ComponentDef, SocketDef } from '@mcda/catalog';
import { HORIZONTAL, add, cellKey, isHorizontal, key3, opposite, pose, resolveRelDir, transformLocal, type Dir, type HorizontalDir, type Quarter, type Vec3 } from '@mcda/core';
import type { RoomAnalysis } from './analyze.js';
import type { ExpandedComponent } from './expand.js';
import { placeComponent, type PlacedComponent, type PlacedSocket } from './place.js';
import { hardValid, type Occupancy } from './rules.js';

/**
 * Andockpunkte (research/02 §7.7). Unterstützte Arten:
 *  - `adjacent`: Boden-Kind neben dem Elternteil (Nachttisch, Hocker); Blickrichtung über `facing`.
 *  - `surface`: auf einer Abstellfläche (Kerze, Krug).
 *  - `face`: Wand-Kind an einer Fläche; `side` = Richtung (relativ zum Elternteil) vom Andockpunkt zur Trägerfläche.
 *    Träger ist ein Block (des Elternteils oder eines anderen Möbels) oder eine feste Raumwand. Rücken zur Fläche.
 *  - `hang`: Decken-Kind hängt unter `at` (oberste Zelle). Darüber liegt ein Block oder die Decke; liegt `at` über
 *    der lichten Höhe, rutscht das Kind unter die Decke. Über Möbeln darf es tiefer als die Kopffreiheit hängen.
 *  - `above` / `below` (V3, vertikal stapeln): Boden- oder Abstell-Kind in der Ausrichtung des Elternteils; seine
 *    lokale Box beginnt bei `at` (above: unterste Lage auf `at`, z. B. Truhe auf Truhe, Aufsatzregal auf Kommode;
 *    below: oberste Lage auf `at`). Jede Zelle der untersten Lage ruht auf einem Block oder dem Boden.
 * `inside`, `overlay` und `count` wertet der Solver noch nicht aus.
 */

export function mountFits(def: ComponentDef, s: SocketDef): boolean {
  switch (s.type) {
    case 'surface':
      return def.mount === 'surface' || def.mount === 'floor';
    case 'adjacent':
      return def.mount === 'floor';
    case 'face':
      return def.mount === 'wall';
    case 'hang':
      return def.mount === 'ceiling';
    case 'above':
    case 'below':
      return def.mount === 'floor' || def.mount === 'surface';
    default:
      return false;
  }
}

/** Drehung, bei der die Front (kanonisch Süden) in Weltrichtung `d` zeigt. */
export const rotationForFront = (d: HorizontalDir): Quarter => ((HORIZONTAL.indexOf(d) + 2) % 4) as Quarter;

/** Weltrichtung vom Andockpunkt zum Elternteil (aus `side`, sonst aus der Lage zur Box-Mitte). */
function towardParent(s: PlacedSocket, parent: PlacedComponent): HorizontalDir | undefined {
  if (s.def.type !== 'face' && s.side !== undefined && isHorizontal(s.side)) return opposite(s.side) as HorizontalDir;
  if (s.def.type === 'face' && s.side !== undefined && isHorizontal(s.side)) return s.side;
  if (s.pos === undefined) return undefined;
  const cx = parent.pose.pos[0] + (parent.size[0] - 1) / 2;
  const cz = parent.pose.pos[2] + (parent.size[2] - 1) / 2;
  const dx = cx - s.pos[0];
  const dz = cz - s.pos[2];
  if (dx === 0 && dz === 0) return undefined;
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
}

/** Drehung des Kindes nach `facing` (Standard `same`; `face`-Sockets: Rücken zur Trägerfläche). */
export function childRotation(s: PlacedSocket, parent: PlacedComponent): Quarter {
  const facing = s.def.facing ?? (s.def.type === 'face' ? 'awayFromParent' : 'same');
  switch (facing) {
    case 'same':
      return parent.pose.rot;
    case 'toParent':
    case 'awayFromParent': {
      const d = towardParent(s, parent);
      if (d === undefined) return parent.pose.rot;
      return rotationForFront(facing === 'toParent' ? d : (opposite(d) as HorizontalDir));
    }
    default: {
      const d = resolveRelDir(facing, parent.pose);
      return isHorizontal(d) ? rotationForFront(d) : parent.pose.rot;
    }
  }
}

/** Pose des Kindes an einem Andockpunkt (undefined: Socket ohne `at`). */
export function socketPlacement(s: PlacedSocket, parent: PlacedComponent, exp: ExpandedComponent, a: RoomAnalysis): PlacedComponent | undefined {
  if (s.pos === undefined) return undefined;
  const g = a.geometry;
  let at: Vec3 = s.pos;
  if (s.def.type === 'hang') {
    const top = Math.min(s.pos[1], g.baseY + g.height - 1);
    at = [s.pos[0], top - (exp.size[1] - 1), s.pos[2]];
  }
  if (s.def.type === 'above' || s.def.type === 'below') return stackPlacement(s, parent, exp);
  return placeComponent(exp, pose(at, childRotation(s, parent)));
}

/**
 * Stapel-Kind (`above`/`below`): die lokale Kind-Box beginnt im Elternsystem bei `at` (below: endet oben dort)
 * und wird mit dem Elternteil gedreht – die Weltlage ist die Bild-Box, ihre kleinste Ecke die Pose.
 * Blickrichtung: `same` (Standard); eine andere nur bei 1×1-Kindern, deren Box sich beim Drehen nicht ändert.
 */
function stackPlacement(s: PlacedSocket, parent: PlacedComponent, exp: ExpandedComponent): PlacedComponent {
  const at = s.def.at!;
  const [sx, sy, sz] = exp.size;
  const origin: Vec3 = s.def.type === 'above' ? at : [at[0], at[1] - (sy - 1), at[2]];
  const { rot, mirror } = parent.pose;
  const tf = (p: Vec3): Vec3 => add(parent.pose.pos, transformLocal(p, parent.expanded.size, rot, mirror));
  const a = tf(origin);
  const b = tf([origin[0] + sx - 1, origin[1], origin[2] + sz - 1]);
  const min: Vec3 = [Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2])];
  const own = sx === 1 && sz === 1 ? childRotation(s, parent) : rot;
  return placeComponent(exp, pose(min, own, own === rot ? mirror : 'none'));
}

/** Harte Regeln für ein Kind an einem Socket (inkl. Träger bei `face`/`hang`). */
export function socketValid(p: PlacedComponent, def: ComponentDef, s: PlacedSocket, a: RoomAnalysis, occ: Occupancy): boolean {
  const g = a.geometry;
  if (s.def.type === 'face') {
    const back: Dir = resolveRelDir('back', p.pose);
    if (!isHorizontal(back)) return false;
    // jede Zelle der hinteren Reihe braucht einen Träger: Block dahinter oder feste Raumwand
    for (const c of p.cells.filter((x) => x.local[2] === 0)) {
      const behind: Vec3 = [c.pos[0] + STEP3[back][0], c.pos[1], c.pos[2] + STEP3[back][2]];
      const wallOK = a.info.get(cellKey(c.pos[0], c.pos[2]))?.solidWalls.includes(back) === true;
      if (!wallOK && !occ.solid.has(key3(behind))) return false;
    }
  }
  if (s.def.type === 'hang') {
    const top = Math.max(...p.cells.map((c) => c.pos[1]));
    const ceiling = top === g.baseY + g.height - 1;
    for (const c of p.cells.filter((x) => x.pos[1] === top)) {
      if (!ceiling && !occ.solid.has(key3([c.pos[0], top + 1, c.pos[2]]))) return false;
    }
  }
  if (s.def.type === 'above' || s.def.type === 'below') {
    // Stapel: jede Zelle der untersten Lage ruht auf einem Block (Elternteil) oder auf dem Boden
    const bottom = Math.min(...p.cells.map((c) => c.pos[1]));
    for (const c of p.cells) {
      if (c.pos[1] !== bottom || bottom === g.baseY) continue;
      if (!occ.solid.has(key3([c.pos[0], c.pos[1] - 1, c.pos[2]]))) return false;
    }
  }
  return hardValid(p, def, a, occ, { skipBackToWall: true, lowOverFurniture: s.def.type === 'hang' });
}

const STEP3: Readonly<Record<HorizontalDir, Vec3>> = { north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0] };

/**
 * Paare (`pairWith`, symmetrische Nachttische): werden gemeinsam gewürfelt und mit derselben Komponente
 * gefüllt. Liefert Gruppen von Sockets in Katalog-Reihenfolge.
 */
export function socketGroups(sockets: readonly PlacedSocket[]): PlacedSocket[][] {
  const groups: PlacedSocket[][] = [];
  const done = new Set<string>();
  for (const s of sockets) {
    if (done.has(s.def.id)) continue;
    const partner = sockets.find((o) => o !== s && !done.has(o.def.id) && (s.def.pairWith === o.def.id || o.def.pairWith === s.def.id));
    const group = partner === undefined ? [s] : [s, partner];
    for (const g of group) done.add(g.def.id);
    groups.push(group);
  }
  return groups;
}

/**
 * Konsistenzgruppe: Sockets eines Elternteils mit gleichem Schlüssel bekommen dieselbe Komponente
 * (`same_component`: auch dieselbe Variante; `same_motifs`: Variante frei). Standard: `adjacent` und Paare
 * `same_component` (Stühle um einen Tisch), alles andere `free`.
 */
export function consistencyKey(s: SocketDef, paired: boolean): { key: string; sameVariant: boolean } | undefined {
  const mode = s.consistency ?? (s.type === 'adjacent' || paired ? 'same_component' : 'free');
  if (mode === 'free') return undefined;
  return { key: `${s.type}|${[...s.accepts].sort().join(',')}`, sameVariant: mode === 'same_component' };
}
