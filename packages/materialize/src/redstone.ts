/**
 * Redstone im Autotiling und in der Physik (plan/spikes/R1_funktional.md), nach dem Vanilla-Code 1.21:
 *  - Redstone-Staub: Verbindungen north/east/south/west = none|side|up (RedStoneWireBlock#getConnectionState,
 *    Startzustand „Kreuz“ wie beim Setzen durch den Spieler). `power` bleibt, wie der Autor es angibt –
 *    Funktionskomponenten werden im stromlosen Ruhezustand exportiert (Leistungs-Pass = Folgeaufgabe).
 *  - Leiter (isRedstoneConductor): voller Kollisionswürfel, aber nicht Glas/Blätter, Kolben, Beobachter,
 *    Redstone-Block (Blocks::never).
 *  - Stützen: Staub auf tragfähiger Oberseite oder auf einem Trichter; Verstärker/Komparator auf voller Oberseite.
 *  - Kolben-Konsistenz: ausgefahrener Kolben ⇔ passender Kolbenkopf davor.
 * Nachbarschafts-States werden NIE transformiert, sondern hier neu berechnet (plan/01 §5).
 */
import { opposite, type Dir, type HorizontalDir, type Vec3 } from '@mcda/core';
import { blockState, isAir } from '@mcda/voxel';
import type { Violation } from './types.js';
import { faceSupport, isTransparentFull, step, type CellInfo, type WorldView } from './world.js';

const H4: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];
type Side = 'none' | 'side' | 'up';

/** Vanilla `Blocks::never` für isRedstoneConductor (trotz vollem Würfel). */
const NEVER_CONDUCTOR = new Set(['piston', 'sticky_piston', 'observer', 'redstone_block', 'tinted_glass', 'barrier']);

/** Leitet ein Block Redstone-Signale weiter (fester, undurchsichtiger Vollblock)? */
export function isRedstoneConductor(info: CellInfo): boolean {
  const n = info.state.name;
  return info.phys.cls === 'full' && !isTransparentFull(n) && !NEVER_CONDUCTOR.has(n) && !n.endsWith('glass');
}

function isSignalSource(info: CellInfo, view: WorldView): boolean {
  return view.hasFlag(info.state, 'signalSource');
}

/** RedStoneWireBlock#shouldConnectTo(state, direction); `dir` = Richtung vom Staub zum Nachbarn. */
function shouldConnectTo(info: CellInfo, view: WorldView, dir: HorizontalDir | null): boolean {
  const n = info.state.name;
  if (n === 'redstone_wire') return true;
  if (n === 'repeater') {
    const f = info.state.properties['facing'] as HorizontalDir;
    return dir !== null && (f === dir || f === opposite(dir));
  }
  if (n === 'observer') return dir !== null && info.state.properties['facing'] === dir;
  return dir !== null && isSignalSource(info, view);
}

/** Kann Staub auf diesem Block liegen? (RedStoneWireBlock#canSurviveOn: tragfähige Oberseite oder Trichter) */
export function wireCanSurviveOn(info: CellInfo): boolean {
  return faceSupport(info, 'up') === 'full' || info.state.name === 'hopper';
}

/** RedStoneWireBlock#getConnectingSide */
function connectingSide(view: WorldView, pos: Vec3, dir: HorizontalDir, nonNormalCubeAbove: boolean): Side {
  const np = step(pos, dir);
  const n = view.info(np);
  if (nonNormalCubeAbove) {
    const carries = n.kind === 'trapdoor' || wireCanSurviveOn(n);
    if (carries && shouldConnectTo(view.info(step(np, 'up')), view, null)) {
      return faceSupport(n, opposite(dir)) === 'full' ? 'up' : 'side';
    }
  }
  const below = view.info(step(np, 'down'));
  return !shouldConnectTo(n, view, dir) && (isRedstoneConductor(n) || !shouldConnectTo(below, view, null)) ? 'none' : 'side';
}

/** Verbindungen eines Staubs wie beim Setzen im Spiel (getConnectionState ab Kreuz; Einzelstaub = Kreuz). */
export function wireConnections(view: WorldView, pos: Vec3): Record<HorizontalDir, Side> {
  const nonNormalCubeAbove = !isRedstoneConductor(view.info(step(pos, 'up')));
  const s = Object.fromEntries(H4.map((d) => [d, connectingSide(view, pos, d, nonNormalCubeAbove)])) as Record<HorizontalDir, Side>;
  const on = (d: HorizontalDir): boolean => s[d] !== 'none';
  const noNS = !on('north') && !on('south');
  const noEW = !on('east') && !on('west');
  // Fortsetzung zur Linie bzw. Kreuz (Vanilla: fehlende Seiten auf side)
  const out = { ...s };
  if (!on('west') && noNS) out.west = 'side';
  if (!on('east') && noNS) out.east = 'side';
  if (!on('north') && noEW) out.north = 'side';
  if (!on('south') && noEW) out.south = 'side';
  return out;
}

/** Autotiling: alle Redstone-Staub-Zellen bekommen ihre Verbindungen (power bleibt). */
export function resolveRedstoneWires(view: WorldView): void {
  const wires = [...view.volume.cells()].filter((c) => c.state.name === 'redstone_wire');
  // Verbindungen hängen nur von Blockarten der Nachbarn ab, nicht von deren Staub-Form → Reihenfolge egal
  const next = wires.map((c) => [c, wireConnections(view, c.pos)] as const);
  for (const [c, sides] of next) {
    const props = { ...c.state.properties, ...sides };
    if (H4.every((d) => c.state.properties[d] === sides[d])) continue;
    view.volume.replaceState(c.pos, blockState(c.state.name, props));
  }
}

/** Stützregeln für Redstone-Blöcke (Ergänzung zu physics.ts#supportRule); undefined = keine Redstone-Regel. */
export function redstoneSupportRule(info: CellInfo): {
  readonly dir: Dir; readonly test: 'accept'; readonly label: string; readonly accept: (n: CellInfo) => boolean;
} | undefined {
  const n = info.state.name;
  if (n === 'redstone_wire') {
    return { dir: 'down', test: 'accept', label: 'Redstone-Staub braucht tragfähige Oberseite oder Trichter darunter', accept: wireCanSurviveOn };
  }
  if (n === 'repeater' || n === 'comparator') {
    return { dir: 'down', test: 'accept', label: 'Verstärker/Komparator braucht volle Oberseite darunter', accept: (b) => faceSupport(b, 'up') === 'full' };
  }
  if (n === 'sugar_cane') {
    // Wasser neben dem Boden prüft (noch) niemand: das Spiel bricht Zuckerrohr ohne Wasser erst beim nächsten Tick
    return {
      dir: 'down', test: 'accept', label: 'Zuckerrohr braucht Zuckerrohr, Erde oder Sand darunter',
      accept: (b) => b.state.name === 'sugar_cane' || /(^|_)(dirt|sand|grass_block|podzol|mud|moss_block|mycelium)$/.test(b.state.name),
    };
  }
  return undefined;
}

/** Kolben ⇔ Kolbenkopf: ausgefahren braucht einen passenden Kopf davor, ein Kopf seinen Kolben dahinter. */
export function checkPistons(view: WorldView): Violation[] {
  const out: Violation[] = [];
  for (const c of view.volume.cells()) {
    const s = c.state;
    if (isAir(s)) continue;
    const facing = s.properties['facing'] as Dir | undefined;
    if (facing === undefined) continue;
    if ((s.name === 'piston' || s.name === 'sticky_piston') && s.properties['extended'] === 'true') {
      const h = view.state(step(c.pos, facing));
      const want = s.name === 'sticky_piston' ? 'sticky' : 'normal';
      if (h.name !== 'piston_head' || h.properties['facing'] !== facing || h.properties['type'] !== want) {
        out.push({
          kind: 'redstone', severity: 'error', pos: c.pos, owner: c.owner, block: s.name,
          message: `${s.name} bei ${c.pos.join(',')} ist ausgefahren, aber davor fehlt ein Kolbenkopf (type=${want}, facing=${facing})`,
        });
      }
    } else if (s.name === 'piston_head') {
      const b = view.state(step(c.pos, opposite(facing)));
      const want = s.properties['type'] === 'sticky' ? 'sticky_piston' : 'piston';
      if (b.name !== want || b.properties['facing'] !== facing || b.properties['extended'] !== 'true') {
        out.push({
          kind: 'redstone', severity: 'error', pos: c.pos, owner: c.owner, block: s.name,
          message: `Kolbenkopf bei ${c.pos.join(',')} ohne ausgefahrenen ${want} (facing=${facing}) dahinter`,
        });
      }
    }
  }
  return out;
}
