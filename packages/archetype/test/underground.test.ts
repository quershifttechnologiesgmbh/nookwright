/**
 * Feature Unterbau (feat/underground, plan/spikes/F_underground.md) auf Plan-Ebene: Schalter aus = bitgleicher Plan;
 * Schalter an = Unterbau-Etage mit Räumen, Gängen und Kern-Treppe, geprüft wie jeder Plan (übernehmbar, Hülle ohne
 * Warnung, alles erreichbar), deterministisch, Haus darüber unverändert, Gänge mindestens 2 breit, Graph mit Schleifen.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME, Project, TARGET_VERSIONS, deriveShell } from '@mcda/blueprint';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet } from '@mcda/core';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import {
  DEFAULT_LOOP_DOORS, UNDERGROUND_CORRIDOR, UNDERGROUND_DEFAULTS, checkPlan, undergroundDefault, planBuilding, planDraft, planShellOptions, reachableRooms, renderPlan, type ArchetypeContext, type BuildingPlan,
} from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };
const TYPES: BuildingTypeDef[] = readdirSync(join(ROOT, 'buildingtypes')).filter((f) => f.endsWith('.json5')).map((f) => {
  const r = parseBuildingTypeDef(readFileSync(join(ROOT, 'buildingtypes', f), 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
});
const SEEDS = [1, 2, 3];

const shellOf = (plan: BuildingPlan) => {
  const p = Project.create({
    id: 'probe', name: plan.name, seed: plan.seed, themeId: 'probe', targetVersion: TARGET_VERSIONS['1.21.11'],
    floor: { y0: 0, height: plan.floors.find((f) => f.index === 0)!.height },
  });
  p.applyBuildingType(planDraft(plan, { buildingTypeId: plan.typeId, params: {}, seed: plan.seed, rerollCount: 0 }));
  return { project: p, shell: deriveShell(p.state, planShellOptions(plan.shell, plan.corridorTypes)) };
};

describe('Unterbau: Schalter aus', () => {
  it('ohne Schalter bzw. mit `underground: false` ist der Plan bitgleich', () => {
    for (const def of TYPES) {
      const plain = planBuilding(def, {}, 7, arch);
      expect(JSON.stringify(planBuilding(def, { underground: false }, 7, arch)), def.id).toBe(JSON.stringify(plain));
      expect(plain.underground, def.id).toBeUndefined();
      expect(plain.loopDoors, def.id).toBeUndefined();
    }
  });
});

describe('Unterbau: Schalter an – alle Bautypen × 3 Seeds', () => {
  for (const def of TYPES) {
    it(`${def.id}: Etage −2 mit Räumen und Gängen, geprüft, deterministisch, Haus unverändert`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const seed of SEEDS) {
        const where = `${def.id} Seed ${seed}`;
        const off = planBuilding(def, {}, seed, arch);
        const on = planBuilding(def, { underground: true }, seed, arch);
        expect(on.hints.filter((h) => h.startsWith('Unterbau')), `${where}\n${renderPlan(on)}`).toEqual([]);
        const u = on.underground!;
        expect(u, where).toBeDefined();
        expect(on.params.underground, where).toBe(true);
        // Etagen lückenlos bis −2, Haus (Etage ≥ 0) gleich
        expect(on.floors.map((f) => f.index), where).toEqual([-2, ...(off.floors[0]!.index === -1 ? [] : [-1]), ...off.floors.map((f) => f.index)]);
        const key = (r: BuildingPlan['rooms'][number]) => `${r.volumeId}|${r.floor}|${r.roomTypeId}|${r.cells.toArray().join(';')}`;
        expect(on.rooms.filter((r) => r.floor >= 0).map(key), where).toEqual(off.rooms.filter((r) => r.floor >= 0).map(key));
        expect(on.stairs.slice(0, off.stairs.length), where).toEqual(off.stairs);
        // Unterbau: ≥ 2 Räume (Treppenraum + Programm), Gänge mit Flur-Rolle, Kern-Treppe von −2 herauf
        const deep = on.rooms.filter((r) => r.floor === -2);
        expect(deep.filter((r) => r.roomTypeId !== UNDERGROUND_CORRIDOR).length, where).toBe(u.rooms);
        expect(u.rooms, where).toBeGreaterThanOrEqual(2);
        expect(deep.every((r) => r.volumeId === DEFAULT_VOLUME), where).toBe(true);
        expect(on.corridorTypes, where).toContain(UNDERGROUND_CORRIDOR);
        expect(on.stairs.some((s) => s.floor === -2), where).toBe(true);
        expect(u.edges, where).toBeGreaterThanOrEqual(u.rooms - 1);
        expect(u.loops, where).toBe(u.edges - (u.rooms - 1));
        // wie jeder Plan geprüft: übernehmbar, Hülle ohne Warnung, alle Räume erreichbar, Flächen zusammenhängend
        expect(checkPlan(on, () => 0).problems, `${where}\n${renderPlan(on)}`).toEqual([]);
        const { project, shell } = shellOf(on);
        const reach = reachableRooms(shell);
        expect(project.state.rooms.filter((r) => !reach.has(r.id)).map((r) => `${r.id} ${r.roomTypeId} ${r.floorIndex}`), where).toEqual([]);
        // Gänge: die 2×2-Blöcke der begehbaren Fläche hängen zusammen und reichen an jede Tür (lichte Breite ≥ 2)
        for (const r of project.state.rooms.filter((x) => x.floorIndex === -2 && x.roomTypeId === UNDERGROUND_CORRIDOR)) {
          const info = shell.rooms.get(r.id)!;
          const walk = info.blocked === undefined ? info.interior : info.interior.difference(info.blocked);
          const wide: [number, number][] = [];
          for (const [x, z] of walk) {
            if (walk.has(x + 1, z) && walk.has(x, z + 1) && walk.has(x + 1, z + 1)) wide.push([x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]);
          }
          const w2 = CellSet.of(wide);
          expect(w2.isConnected(), `${where}: Gang ${r.id} ohne durchgehende Breite 2`).toBe(true);
          for (const d of info.doors) {
            const near = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => w2.has(d.inside[0] + dx, d.inside[1] + dz)));
            expect(near, `${where}: Tür von Gang ${r.id} bei ${d.inside.join(',')} nicht am 2-breiten Weg`).toBe(true);
          }
        }
        // keine Dachzellen unter der Erde
        expect(shell.cells.filter((c) => c.kind === 'roof' && c.pos[1] < 0).length, where).toBe(0);
        // deterministisch
        expect(JSON.stringify(planBuilding(def, { underground: true }, seed, arch)), where).toBe(JSON.stringify(on));
      }
    });
  }
});

describe('Unterbau: Standard je Bautyp', () => {
  it('auf feat/underground ist der Standard für jeden Bautyp aus (Tabelle vorbereitet für Burg, Wachturm, Taverne)', () => {
    expect(Object.keys(UNDERGROUND_DEFAULTS).sort()).toEqual(['castle_compact', 'tavern', 'watchtower']);
    for (const def of TYPES) expect(undergroundDefault(def.id), def.id).toBe(false);
  });
});

describe('Unterbau: Feineinstellung', () => {
  const house = TYPES.find((t) => t.id === 'house')!;
  it('`rooms` begrenzt das Programm, `loops: 1` legt jede Nicht-Baum-Kante an', () => {
    const one = planBuilding(house, { underground: { rooms: 1 } }, 3, arch);
    expect(one.underground!.rooms).toBe(2);
    const all = planBuilding(house, { underground: { loops: 1 } }, 3, arch);
    const some = planBuilding(house, { underground: { loops: 0 } }, 3, arch);
    expect(all.underground!.edges).toBeGreaterThanOrEqual(some.underground!.edges);
    expect(all.params.underground).toEqual({ loops: 1 });
  });
  it('Zusatztüren im Haus: eigener Schalter, nicht am Unterbau (Review A3)', () => {
    expect(planBuilding(house, { underground: true }, 3, arch).loopDoors).toBeUndefined();
    expect(planBuilding(house, { loopDoors: DEFAULT_LOOP_DOORS }, 3, arch).loopDoors).toBe(0.15);
    expect(planBuilding(house, { loopDoors: 0.5 }, 3, arch).loopDoors).toBe(0.5);
    expect(JSON.stringify(planBuilding(house, { loopDoors: 0 }, 3, arch))).toBe(JSON.stringify(planBuilding(house, {}, 3, arch)));
  });
});
