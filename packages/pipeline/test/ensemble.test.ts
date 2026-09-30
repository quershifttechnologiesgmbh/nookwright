/**
 * F-Ensemble (Feature-Branch, `plan/spikes/F_ensemble_walkways.md`): Verbindungsgraph einer Base mit Schalter.
 * Schalter aus = bitgleich (derselbe Weg wie vorher); Schalter an: Brücke Palas/Bergfried → Wehrgang der Burg und
 * Brücke zwischen zwei Häusern gebaut, in der fertigen Welt zu Fuß begehbar (Obergeschoss → Wehrgang bzw. → Nachbarhaus),
 * 0 harte Verstöße, keine Kollision (der Merge wirft sonst), alle Räume erreichbar, deterministisch je Seed.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reachableRooms } from '@mcda/archetype';
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { ENSEMBLE_DEFAULT, generateBase, projectFromBuildingType, type BaseWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { twinHouses } from './ensemble-fixtures.js';
import { Walker, standKey } from './walk.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

const digest = (w: BaseWorld): string => {
  const h = createHash('sha1');
  for (const c of w.materialized.volume.cells()) h.update(`${c.pos.join(',')}=${c.state.name}${JSON.stringify(c.state.properties)};`);
  return h.digest('hex');
};

/** Innenzellen hinter den Brückentüren (Füße) – Start und Ziel der Begehung. */
function bridgeDoors(w: BaseWorld): Vec3[] {
  return (w.shell.annexes ?? []).filter((a) => a.id.startsWith('ens-')).flatMap((a) => a.doors.map((d): Vec3 => {
    const [dx, dz] = STEP[d.facing];
    return [d.at[0] - dx, d.y, d.at[1] - dz];
  }));
}

function hardViolations(w: BaseWorld): string[] {
  return w.materialized.violations.filter((v) => v.kind !== 'spawn').map((v) => `${v.kind}@${v.pos?.join(',')}: ${v.message}`);
}

describe('F-Ensemble: Schalter', () => {
  it('Standard ist aus (Feature-Branch)', () => {
    expect(ENSEMBLE_DEFAULT).toBeUndefined();
  });

  it('aus = bitgleich: ohne Feld, mit `false` und Standard liefern dieselbe Welt ohne Bericht', { timeout: HEAVY_TIMEOUT }, () => {
    const res = projectFromBuildingType(ctx.buildingTypes.get('farmhouse'), { size: 'M' }, 3, ctx);
    const opts = { ...res.build, ...res.surroundings };
    const a = generateBase(res.project, ctx, opts);
    const b = generateBase(res.project, ctx, { ...opts, ensemble: false });
    expect(digest(a)).toBe(digest(b));
    expect(a.surroundings.ensemble).toBeUndefined();
    expect(b.surroundings.ensemble).toBeUndefined();
  });
});

describe('F-Ensemble: Burg – Brücke vom Obergeschoss zum Wehrgang', () => {
  it('Seeds 1–3: gebaut, begehbar bis auf den Wehrgang, 0 harte Verstöße, alle Räume erreichbar, deterministisch', { timeout: HEAVY_TIMEOUT * 2 }, () => {
    let built = 0;
    for (const seed of [1, 2, 3]) {
      const where = `Burg M Seed ${seed}`;
      const res = projectFromBuildingType(ctx.buildingTypes.get('castle_compact'), { size: 'M' }, seed, ctx);
      const opts = { ...res.build, ...res.surroundings, ensemble: {} };
      const w = generateBase(res.project, ctx, opts);
      const e = w.surroundings.ensemble!;
      expect(hardViolations(w), where).toEqual([]);
      const reach = reachableRooms(w.shell);
      expect(res.project.state.rooms.filter((r) => !reach.has(r.id)).map((r) => r.id), where).toEqual([]);
      expect(w.materialized.light.darkCells, where).toEqual([]);
      for (const b of w.surroundings.structures?.bridges ?? []) expect(b.built, `${where}: ${b.reason}`).toBe(true);
      expect(e.bridges.length, where).toBe((w.surroundings.structures?.bridges ?? []).length);
      if (e.bridges.length > 0) {
        built++;
        const bridge = w.surroundings.structures!.bridges![0]!;
        const doors = bridgeDoors(w);
        expect(doors.length, where).toBeGreaterThan(0);
        const seen = new Walker(w.materialized.volume, ctx.platform(res.project.state.targetVersion.name)).reach(doors);
        expect(seen.has(standKey(bridge.landing!)), `${where}: Wehrgang zu Fuß erreicht`).toBe(true);
        // Umgesetzter Graph: Brücke schließt einen Rundgang (Hof → Treppe → Wehrgang → Brücke → Haus)
        expect(e.loops, where).toBeGreaterThanOrEqual(1);
      }
      // deterministisch: frisches Projekt (die Einrichtung schreibt ins Projekt – ein zweiter Aufruf auf demselben
      // Projekt wäre auch ohne Schalter ein anderer Ausgangszustand)
      const again = projectFromBuildingType(ctx.buildingTypes.get('castle_compact'), { size: 'M' }, seed, ctx);
      expect(digest(generateBase(again.project, ctx, { ...again.build, ...again.surroundings, ensemble: {} })), `${where}: deterministisch`).toBe(digest(w));
    }
    expect(built, 'mindestens eine Burg mit Brücke').toBeGreaterThanOrEqual(2);
  });
});

describe('F-Ensemble: Doppelhaus – Brücke zwischen den Obergeschossen', () => {
  it('gebaut (flach, eine Stütze), Tür in beiden Fassaden, zu Fuß von Haus zu Haus, Rundwege gelegt', { timeout: HEAVY_TIMEOUT }, () => {
    const t = twinHouses(ctx, 1);
    const w = generateBase(t.project, ctx, { ...t.opts, ensemble: {} });
    const e = w.surroundings.ensemble!;
    expect(hardViolations(w)).toEqual([]);
    expect(e.bridges.map((b) => [b.kind, b.length, b.rise])).toEqual([['bridge', 6, 0]]);
    const doors = bridgeDoors(w);
    expect(doors).toHaveLength(2);
    const seen = new Walker(w.materialized.volume, ctx.platform('1.21.11')).reach([doors[0]!]);
    expect(seen.has(standKey(doors[1]!)), 'Obergeschoss Ost zu Fuß über die Brücke').toBe(true);
    expect(e.dropped).toEqual([]);
    expect(e.paths.failed).toBe(0);
    expect(e.loops).toBeGreaterThanOrEqual(1);
  });

  it('Gasse zu breit (12) → keine Brücke, sonst gleiche Regeln', { timeout: HEAVY_TIMEOUT }, () => {
    const t = twinHouses(ctx, 1, 'medieval', 12);
    const w = generateBase(t.project, ctx, { ...t.opts, ensemble: {} });
    expect(w.surroundings.ensemble!.bridges).toEqual([]);
    expect(hardViolations(w)).toEqual([]);
  });
});
