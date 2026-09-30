/**
 * Physik-Pass (Pipeline-Schritt 7): Stütze (Flag `needsSupport` der Plattform + Stützart je Block),
 * Schwerkraft (Flag `falls`) und die Stütz-/Luft-Masken der Komponenten.
 *
 * Stützarten laut Faktencheck 3/4/15 und Spike T3 (im Spiel geprüft, 1.21.11):
 *  - Laterne hängend: stabile Mitte (center) OBEN; stehend: stabile Mitte unten. Blätter tragen nicht.
 *  - Wandfackel: volle Fläche des Blocks dahinter; Bodenfackel: stabile Mitte unten.
 *  - Teppich: darunter nur „nicht Luft“ (auch Zaun/Mauer).
 *  - Kerze, Blumentopf: keine Stütze (Plattform-Flag fehlt bewusst).
 *  - Tür unten: volle Oberseite darunter; Tür oben: untere Hälfte derselben Tür.
 *  - Druckplatte: tragfähige Oberseite ODER stabile Mitte (Zaun, Mauer).
 *  - Wandschild/-banner: fester Block dahinter; Wand-Hängeschild bricht nicht (Wiki).
 *  - Leiter: volle Fläche des Blocks dahinter (gegen `facing`), wie im Spiel (`LadderBlock.canSurvive`).
 *  - Unbekannte Blöcke mit `needsSupport`: volle Oberseite darunter (konservativ, Meldung nennt das).
 *  - „fest“ (Schild, Banner, Kuchen) = Vanilla `isSolid` (vanilla.ts, T5-Regel), nicht die Physik-Klasse.
 *  - Blöcke, denen das Plattform-Flag fehlt, obwohl Vanilla sie ohne Stütze entfernt (M2, `IMPLICIT_SUPPORT`):
 *    Hängewurzeln/Hängemoos (volle Unterseite darüber), Laubstreu (tragfähige Oberseite), Gras/Farn/Busch (Erde),
 *    Pilze (Pilzboden oder undurchsichtiger Vollblock), Kuchen (fest darunter), Ranken (mindestens eine Fläche).
 *  - Zuckerrohr: Wasser neben dem Boden-Block; Doppelpflanzen: passende zweite Hälfte (M2).
 *  - Glocke (BellBlock#canSurvive): floor volle Oberseite darunter, ceiling stabile Mitte darüber (Block, Zaun,
 *    senkrechte Kette), Wand volle Fläche in Richtung `facing`. Hülle: `orient.attach` (O1).
 *  - Endstab/Blitzableiter: KEINE Stützregel – `RodBlock` hat kein `canSurvive`, ein freier Stab bleibt im Spiel
 *    stehen (O1). Dass eine Turmspitze auf dem First sitzt, prüft der Erzeuger (@mcda/structures), nicht die Physik.
 * Exporte müssen physikalisch gültig sein: `/place` non-strict korrigiert sofort (Faktencheck, Nachtrag T3).
 */
import { add, opposite, resolveRelDir, transformLocal, type Dir, type HorizontalDir } from '@mcda/core';
import { isAir, type BlockState } from '@mcda/voxel';
import { redstoneSupportRule } from './redstone.js';
import type { MaterializePlacement, Violation } from './types.js';
import { hasWaterFluid, isSolid, vineHasFaces } from './vanilla.js';
import { faceSupport, step, type CellInfo, type WorldView } from './world.js';

type Test = 'center' | 'full' | 'notAir' | 'solid' | 'rigidOrCenter' | 'doorLower' | 'none' | 'accept' | 'self';

interface SupportRule {
  readonly dir: Dir;
  readonly test: Test;
  readonly label: string;
  /** Nur bei `test: 'accept'`: welcher Nachbar trägt (z. B. Ackerland unter Feldfrüchten). */
  readonly accept?: (neighbor: CellInfo, view: WorldView) => boolean;
  /** Nur bei `test: 'self'`: Prüfung am Block selbst (z. B. Ranke hat noch eine Fläche). */
  readonly self?: (info: CellInfo) => boolean;
}

/** Vanilla entfernt diese Blöcke ohne Stütze, obwohl die Plattform-Daten kein `needsSupport` tragen (M2). */
const IMPLICIT_SUPPORT: ReadonlySet<string> = new Set([
  'hanging_roots', 'pale_hanging_moss', 'leaf_litter', 'short_grass', 'grass', 'fern', 'bush', 'tall_grass', 'large_fern',
  'red_mushroom', 'brown_mushroom', 'cake', 'candle_cake', 'vine',
]);
export const needsSupportImplicitly = (name: string): boolean => IMPLICIT_SUPPORT.has(name) || name.endsWith('_candle_cake');

/** DoublePlantBlock: beide Hälften müssen zusammenpassen (sonst entfernt das Spiel beide). */
const DOUBLE_PLANTS: ReadonlySet<string> = new Set(['tall_grass', 'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant', 'tall_seagrass', 'small_dripleaf']);

const CROPS = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'torchflower_crop', 'pitcher_crop', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem']);
const DIRTLIKE = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots', 'farmland', 'mycelium']);
const isDirtLike = (n: CellInfo, view: WorldView): boolean => DIRTLIKE.has(n.state.name) || view.hasTag(n.state, 'dirt');
/** Hängende oder Sonder-Pflanzen, die zwar im Tag stehen, aber nicht auf Erde wachsen. */
const NOT_GROUND = new Set(['spore_blossom', 'mangrove_propagule', 'chorus_flower', 'cherry_leaves', 'flowering_azalea_leaves']);
const isGroundPlant = (name: string, info: CellInfo, view: WorldView): boolean => !NOT_GROUND.has(name) && (
  view.hasTag(info.state, 'flowers') || view.hasTag(info.state, 'small_flowers') || view.hasTag(info.state, 'saplings')
  || ['short_grass', 'grass', 'fern', 'tall_grass', 'large_fern', 'sweet_berry_bush', 'dead_bush'].includes(name));

const NONE: SupportRule = { dir: 'down', test: 'none', label: 'keine Stütze nötig' };

/** Stützregel eines Blocks mit Flag `needsSupport`. */
export function supportRule(info: CellInfo, view?: WorldView): SupportRule {
  const { state: s, kind } = info;
  const p = s.properties;
  const n = s.name;
  const facing = p['facing'] as HorizontalDir | undefined;
  switch (kind) {
    case 'lantern':
      return p['hanging'] === 'true'
        ? { dir: 'up', test: 'center', label: 'hängende Laterne braucht stabile Mitte darüber' }
        : { dir: 'down', test: 'center', label: 'stehende Laterne braucht stabile Mitte darunter' };
    case 'wall_attached': {
      if (facing === undefined) break;
      const behind = opposite(facing);
      if (n.endsWith('wall_torch')) return { dir: behind, test: 'full', label: 'Wandfackel braucht volle Fläche dahinter' };
      if (n.endsWith('_wall_hanging_sign')) return NONE; // bricht laut Wiki nicht
      if (n.endsWith('_wall_sign') || n.endsWith('_wall_banner')) return { dir: behind, test: 'solid', label: 'Wandschild/-banner braucht festen Block dahinter' };
      return NONE;
    }
    case 'door':
      return p['half'] === 'upper'
        ? { dir: 'down', test: 'doorLower', label: 'obere Türhälfte braucht die untere Hälfte darunter' }
        : { dir: 'down', test: 'full', label: 'Tür braucht volle Oberseite darunter' };
    case 'rotation16':
      if (n.endsWith('_hanging_sign')) return { dir: 'up', test: 'center', label: 'Hängeschild braucht stabile Mitte darüber' };
      return { dir: 'down', test: 'solid', label: 'Schild/Banner braucht festen Block darunter' };
    case 'face_attached': {
      const face = p['face'];
      if (face === 'ceiling') return { dir: 'up', test: 'full', label: 'braucht volle Fläche darüber' };
      if (face === 'wall' && facing !== undefined) return { dir: opposite(facing), test: 'full', label: 'braucht volle Fläche dahinter' };
      return { dir: 'down', test: 'full', label: 'braucht volle Oberseite darunter' };
    }
    default:
      break;
  }
  // Leiter (Etagen, F1): volle Fläche des Trägers dahinter (Wand oder Pfosten), facing zeigt von ihm weg
  if (n === 'ladder' && facing !== undefined) return { dir: opposite(facing), test: 'full', label: 'Leiter braucht volle Fläche dahinter' };
  // Redstone-Staub, Verstärker, Komparator, Zuckerrohr (R1, redstone.ts)
  const rs = redstoneSupportRule(info);
  if (rs !== undefined) return rs;
  // Pflanzen (Wunsch Gelände-Agent, In-Game T5): Feldfrüchte auf Ackerland, Bodenpflanzen auf Erde; Blätter frei.
  if (n.endsWith('_leaves')) return NONE;
  if (DOUBLE_PLANTS.has(n) && p['half'] === 'upper') return NONE; // obere Hälfte: Partner-Prüfung in checkSupport
  if (CROPS.has(n)) return { dir: 'down', test: 'accept', label: 'Feldfrucht braucht Ackerland darunter', accept: (b) => b.state.name === 'farmland' };
  if (n === 'nether_wart') return { dir: 'down', test: 'accept', label: 'Netherwarze braucht Seelensand darunter', accept: (b) => b.state.name === 'soul_sand' };
  if (n.endsWith('_carpet')) return { dir: 'down', test: 'notAir', label: 'Teppich braucht einen Block darunter (nicht Luft)' };
  if (n.endsWith('torch')) return { dir: 'down', test: 'center', label: 'Fackel braucht stabile Mitte darunter' };
  if (n.endsWith('_pressure_plate')) return { dir: 'down', test: 'rigidOrCenter', label: 'Druckplatte braucht tragfähige Oberseite oder Pfosten darunter' };
  if (view !== undefined && isGroundPlant(n, info, view)) {
    return { dir: 'down', test: 'accept', label: 'Pflanze braucht Erde/Gras/Ackerland darunter', accept: isDirtLike };
  }
  if (n === 'spore_blossom') return { dir: 'up', test: 'center', label: 'Sporenblüte braucht stabile Mitte darüber' };
  if (n === 'cave_vines' || n === 'cave_vines_plant') {
    // CaveVines: hängt an einer vollen Unterseite oder an einer weiteren Ranke darüber (Wiki Glow_Berries)
    return {
      dir: 'up', test: 'accept', label: 'Höhlenranke braucht volle Unterseite oder Ranke darüber',
      accept: (b) => b.state.name === 'cave_vines' || b.state.name === 'cave_vines_plant' || faceSupport(b, 'down') === 'full',
    };
  }
  if (n === 'hanging_roots') return { dir: 'up', test: 'full', label: 'Hängewurzeln brauchen volle Unterseite darüber' };
  if (n === 'pale_hanging_moss') {
    return { dir: 'up', test: 'accept', label: 'Hängemoos braucht volle Unterseite oder Hängemoos darüber', accept: (b) => b.state.name === n || faceSupport(b, 'down') === 'full' };
  }
  if (n === 'leaf_litter') return { dir: 'down', test: 'full', label: 'Laubstreu braucht tragfähige Oberseite darunter' };
  if (n === 'red_mushroom' || n === 'brown_mushroom') {
    return {
      dir: 'down', test: 'accept', label: 'Pilz braucht Pilzboden (Myzel/Podsol/Nylium) oder einen undurchsichtigen Vollblock darunter (dann Licht < 13)',
      accept: (b, v) => v.hasTag(b.state, 'mushroom_grow_block') || ['mycelium', 'podzol', 'crimson_nylium', 'warped_nylium'].includes(b.state.name)
        || (b.phys.cls === 'full' && !b.state.name.endsWith('_leaves') && !b.state.name.includes('glass')),
    };
  }
  if (n === 'cake' || n === 'candle_cake' || n.endsWith('_candle_cake')) return { dir: 'down', test: 'solid', label: 'Kuchen braucht einen festen Block darunter (isSolid)' };
  if (n === 'vine') return { dir: 'down', test: 'self', label: 'Ranke braucht mindestens eine getragene Fläche', self: (i) => vineHasFaces(i.state) };
  if (n === 'bush') {
    return { dir: 'down', test: 'accept', label: 'Pflanze braucht Erde/Gras/Ackerland darunter', accept: isDirtLike };
  }
  if (n === 'bell') {
    const a = p['attachment'];
    if (a === 'ceiling') return { dir: 'up', test: 'center', label: 'Deckenglocke braucht stabile Mitte darüber' };
    if (a === 'floor') return { dir: 'down', test: 'full', label: 'Bodenglocke braucht volle Oberseite darunter' };
    // Wandglocke: facing zeigt zur tragenden Wand (BellBlock#canSurvive), double_wall ebenso
    if (facing !== undefined) return { dir: facing, test: 'full', label: 'Wandglocke braucht volle Fläche an der Wand (facing)' };
  }
  return { dir: 'down', test: 'full', label: 'Stützregel unbekannt – geprüft als volle Oberseite darunter' };
}

function passes(view: WorldView, self: BlockState, rule: SupportRule, neighbor: CellInfo): boolean {
  const face = faceSupport(neighbor, opposite(rule.dir));
  switch (rule.test) {
    case 'none': return true;
    case 'full': return face === 'full';
    case 'center':
    case 'rigidOrCenter': return face === 'full' || face === 'center';
    case 'notAir': return neighbor.phys.cls !== 'air';
    case 'solid': return isSolid(neighbor);
    case 'self': return rule.self !== undefined && rule.self(view.infoOf(self));
    case 'doorLower': return neighbor.state.name === self.name && neighbor.state.properties['half'] === 'lower';
    case 'accept': return rule.accept !== undefined && rule.accept(neighbor, view);
  }
}

/** Stütze + Schwerkraft für alle Blöcke des Volumens. */
export function checkSupport(view: WorldView): Violation[] {
  const out: Violation[] = [];
  for (const c of view.volume.cells()) {
    const s = c.state;
    if (isAir(s)) continue;
    if (view.hasFlag(s, 'needsSupport') || needsSupportImplicitly(s.name)) {
      const info = view.infoOf(s);
      const rule = supportRule(info, view);
      const q = step(c.pos, rule.dir);
      const n = view.info(q);
      if (!passes(view, s, rule, n)) {
        out.push({
          kind: 'support', severity: 'error', pos: c.pos, owner: c.owner, block: s.name,
          message: `${s.name} bei ${c.pos.join(',')}: ${rule.label}, dort ist ${n.state.name}`,
        });
      }
    }
    if (s.name === 'sugar_cane' && view.state(step(c.pos, 'down')).name !== 'sugar_cane') {
      // SugarCaneBlock#canSurvive: Wasser (oder Frosteis) waagerecht neben dem Boden-Block
      const ground = step(c.pos, 'down');
      const wet = (['north', 'east', 'south', 'west'] as const).some((d) => {
        const w = view.state(step(ground, d));
        return hasWaterFluid(w) || w.name === 'frosted_ice';
      });
      if (!wet) {
        out.push({
          kind: 'support', severity: 'error', pos: c.pos, owner: c.owner, block: s.name,
          message: `sugar_cane bei ${c.pos.join(',')}: kein Wasser neben dem Boden-Block ${ground.join(',')} – bricht beim ersten Tick`,
        });
      }
    }
    if (DOUBLE_PLANTS.has(s.name) && s.properties['half'] !== undefined) {
      const lower = s.properties['half'] === 'lower';
      const q = step(c.pos, lower ? 'up' : 'down');
      const n = view.state(q);
      if (n.name !== s.name || n.properties['half'] !== (lower ? 'upper' : 'lower')) {
        out.push({
          kind: 'support', severity: 'error', pos: c.pos, owner: c.owner, block: s.name,
          message: `${s.name} (${s.properties['half']}) bei ${c.pos.join(',')}: passende ${lower ? 'obere' : 'untere'} Hälfte fehlt bei ${q.join(',')}`,
        });
      }
    }
    if (view.hasFlag(s, 'falls') && s.name !== 'scaffolding' && s.name !== 'pointed_dripstone' && s.name !== 'sulfur_spike') {
      const q = step(c.pos, 'down');
      const n = view.info(q);
      const free = n.phys.cls === 'air' || view.hasFlag(n.state, 'liquid') || view.hasTag(n.state, 'replaceable');
      if (free) {
        out.push({
          kind: 'gravity', severity: 'error', pos: c.pos, owner: c.owner, block: s.name,
          message: `${s.name} bei ${c.pos.join(',')} fällt: darunter ist ${n.state.name}`,
        });
      }
    }
  }
  return out;
}

/** Stütz- und Luft-Masken der Komponenten (plan/01 §4.3), nach der Auflösung geprüft. */
export function checkMasks(view: WorldView, placements: readonly MaterializePlacement[]): Violation[] {
  const out: Violation[] = [];
  for (const pl of placements) {
    const { placed } = pl;
    const pose = placed.pose;
    for (const m of placed.expanded.masks.support ?? []) {
      const at = add(pose.pos, transformLocal(m.at, placed.expanded.size, pose.rot, pose.mirror));
      const dir = resolveRelDir(m.side, pose);
      const q = step(at, dir);
      const n = view.info(q);
      const face = faceSupport(n, opposite(dir));
      const ok = m.kind === 'full' ? face === 'full' : face === 'full' || face === 'center';
      if (!ok) {
        out.push({
          kind: 'support_mask', severity: 'error', pos: at, owner: pl.id, block: view.state(at).name,
          ...(pl.roomId !== undefined ? { roomId: pl.roomId } : {}),
          message: `${placed.expanded.defId} (${pl.id}): Stütze '${m.kind}' in Richtung ${dir} von ${at.join(',')} fehlt (dort ${n.state.name})`,
        });
      }
    }
    for (const a of placed.air) {
      const n = view.info(a);
      if (n.phys.cls !== 'air' && n.phys.cls !== 'thin') {
        out.push({
          kind: 'air_mask', severity: 'error', pos: a, owner: pl.id, block: n.state.name,
          ...(pl.roomId !== undefined ? { roomId: pl.roomId } : {}),
          message: `${placed.expanded.defId} (${pl.id}): Zelle ${a.join(',')} muss frei bleiben, dort ist ${n.state.name}`,
        });
      }
    }
  }
  return out;
}

