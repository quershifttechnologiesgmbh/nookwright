/**
 * W12-A (28.09.2026, Review R6-3): Hausfront – Diele im Vorsprung (`cross.room`) und zweigeschossige Variante fester
 * Vorlagen (`massing.storeys`). Einheit (`applyFeatures`) und Plan-Ebene: die Haustür liegt in der Front des Vorsprungs
 * (Probe-Hülle des Planers) und schlägt nicht in die Innentür, S bleibt eingeschossig, L hat ein Obergeschoss, deterministisch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME, Project, TARGET_VERSIONS, deriveShell } from '@mcda/blueprint';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet, Rng } from '@mcda/core';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { planBuilding, planDraft, planShellOptions, type ArchetypeContext, type BuildingPlan, type PlanRoom } from '../src/index.js';
import { applyFeatures } from '../src/features.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };
const load = (id: string): BuildingTypeDef => {
  const r = parseBuildingTypeDef(readFileSync(join(ROOT, 'buildingtypes', `${id}.json5`), 'utf8'), `${id}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};
const room = (floor: number, x0: number, z0: number, x1: number, z1: number, type = 'storage'): PlanRoom => ({
  volumeId: DEFAULT_VOLUME, floor, cells: CellSet.rect(x0, z0, x1, z1), roomTypeId: type, entry: -1, required: true,
});

/** Haupttür der Hülle des Plans (wie die Probe des Planers): Raumtyp und Richtung hinaus. */
function mainDoor(plan: BuildingPlan): { type: string; toward: string } | undefined {
  const p = Project.create({ id: 'p', name: 'p', seed: plan.seed, themeId: 'probe', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: plan.floors[0]!.height } });
  p.applyBuildingType(planDraft(plan, { buildingTypeId: plan.typeId, params: {}, seed: plan.seed, rerollCount: 0 }));
  const shell = deriveShell(p.state, planShellOptions(plan.shell, plan.corridorTypes));
  const types = new Map(p.state.rooms.map((r) => [r.id, r.roomTypeId] as const));
  for (const [id, r] of shell.rooms) for (const d of r.doors) if (d.isMain) return { type: types.get(id)!, toward: d.toward };
  return undefined;
}

describe('W12-A Diele im Vorsprung (Einheit)', () => {
  it('eigener Raum im Erdgeschoss des Vorsprungs, das Obergeschoss wächst wie bisher', () => {
    const rooms = [room(0, 0, 0, 14, 8, 'solar'), room(1, 0, 0, 14, 8, 'bedroom')];
    const r = applyFeatures({ cross: { width: 7, depth: 3, align: 'start', room: 'hallway' } }, rooms, { x0: 0, z0: 0, x1: 14, z1: 8 }, DEFAULT_VOLUME, 1, new Rng(1));
    expect(r.cross).toEqual({ x0: 0, z0: 9, x1: 6, z1: 11 });
    expect(r.rooms).toHaveLength(3);
    expect(r.rooms[0]!.cells.size).toBe(15 * 9);
    expect(r.rooms[2]!.roomTypeId).toBe('hallway');
    expect(r.rooms[2]!.floor).toBe(0);
    expect(r.rooms[2]!.cells.size).toBe(7 * 3);
    expect(r.rooms[1]!.cells.has(6, 11)).toBe(true);
  });

  it('ohne `room` bitgleich wie vorher (der Raum dahinter wächst)', () => {
    const rooms = [room(0, 0, 0, 14, 8, 'solar')];
    const r = applyFeatures({ cross: { width: 7, depth: 3, align: 'start' } }, rooms, { x0: 0, z0: 0, x1: 14, z1: 8 }, DEFAULT_VOLUME, 0, new Rng(1));
    expect(r.rooms).toHaveLength(1);
    expect(r.rooms[0]!.cells.has(6, 11)).toBe(true);
  });
});

describe('W12-A Wohnhäuser: Haustür im Vorsprung, Beispielhaus ein- oder zweigeschossig', () => {
  const SEEDS = [2026, 7, 42];
  it('house/twostory: Diele mit der Haustür nach vorn (Probe-Hülle), Plan ohne Befund', { timeout: HEAVY_TIMEOUT }, () => {
    for (const id of ['house', 'twostory']) {
      const def = load(id);
      for (const seed of SEEDS) {
        const plan = planBuilding(def, {}, seed, arch);
        expect(plan.warnings, `${id} ${seed}`).toEqual([]);
        expect(plan.rooms.some((r) => r.roomTypeId === 'hallway' && r.floor === 0), `${id} ${seed}`).toBe(true);
        expect(mainDoor(plan), `${id} ${seed}`).toEqual({ type: 'hallway', toward: 'south' });
      }
    }
  });

  it('Beispielhaus: S eingeschossig, L zweigeschossig mit Treppe, M per Seed; deterministisch', { timeout: HEAVY_TIMEOUT }, () => {
    const def = load('house');
    const s = planBuilding(def, { size: 'S' }, 2026, arch);
    const l = planBuilding(def, { size: 'L' }, 2026, arch);
    // W13-A Runde 2 (2026-09-28): der Eckturm (v2) hat eine Etage mehr als der Hauptbau – die Projekt-Etagen reichen bis
    // zu seinem obersten Raum. Geprüft werden die Etagen des Hauptbaus v0 (vorher `floors` 1 bzw. 2, eine Treppe)
    const mainFloors = (p: BuildingPlan): number => new Set(p.rooms.filter((r) => r.volumeId === 'v0').map((r) => r.floor)).size;
    expect(mainFloors(s)).toBe(1);
    expect(mainFloors(l)).toBe(2);
    expect(s.floors).toHaveLength(2);
    expect(l.floors).toHaveLength(3);
    expect(l.stairs.filter((st) => st.volumeId === 'v0')).toHaveLength(1);
    // Turm: je Etage eine Leiter bis unter die oberste Turmstube
    expect(l.stairs.filter((st) => st.volumeId === 'v2').map((st) => [st.floor, st.type])).toEqual([[0, 'ladder'], [1, 'ladder']]);
    expect(l.warnings).toEqual([]);
    // W13-A (2026-09-28): die Schmiede ist ein eingeschossiger Nebenbaukörper (Werkstatt, eigenes Dach) – oben nur
    // Schlafkammer und Studierzimmer über dem Hauptbau; vorher auch das Gästezimmer über der Schmiede
    expect(new Set(l.rooms.filter((r) => r.floor === 1 && r.volumeId === 'v0').map((r) => r.roomTypeId))).toEqual(new Set(['bedroom', 'study']));
    expect(l.volumes.map((v) => v.id)).toEqual(['v0', 'v1', 'v2']);
    expect(l.rooms.filter((r) => r.volumeId === 'v1').map((r) => [r.roomTypeId, r.floor])).toEqual([['smithy', 0]]);
    expect(l.rooms.filter((r) => r.volumeId === 'v2').map((r) => [r.roomTypeId, r.floor])).toEqual([['library', 0], ['tower_room', 1], ['tower_room', 2]]);
    // Obergeschoss kragt hinten 1 Block aus; an den Giebelseiten nicht: links verlängert der Eck-Quergiebel sie, rechts
    // steht die Werkstatt davor (vorher kragte eine der beiden Giebelseiten aus)
    const up = l.rooms.filter((r) => r.floor === 1 && r.volumeId === 'v0').map((r) => r.cells.bounds()!);
    expect(Math.min(...up.map((b) => b.minZ))).toBe(-1);
    expect(Math.max(...up.map((b) => b.maxX))).toBeLessThan(14);
    const floors = SEEDS.concat([1, 2, 3, 4, 5]).map((seed) => mainFloors(planBuilding(def, {}, seed, arch)));
    expect(new Set(floors)).toEqual(new Set([1, 2]));
    expect(JSON.stringify(planBuilding(def, { size: 'L' }, 2026, arch))).toBe(JSON.stringify(l));
  });
});
