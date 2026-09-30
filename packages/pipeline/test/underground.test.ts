/**
 * Feature Unterbau (feat/underground, plan/spikes/F_underground.md) über den Anwendungsdienst: `projectFromBuildingType`
 * + `generateBase` für alle Bautypen.
 *  - Schalter aus (`underground: false`): Welt bitgleich zur Welt ohne Option.
 *  - Schalter an: 0 harte Verstöße (Physik, Kollision), alle Räume erreichbar, 0 Spawnstellen, Treppen in den Unterbau
 *    mit freier Kopfhöhe (das Gelände-Fundament füllt keine Öffnung), kein Dach unter der Erde, Grundstück und Zonen
 *    unverändert (der Unterbau verschiebt nichts an der Oberfläche), deterministisch.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reachableRooms } from '@mcda/archetype';
import { stairLayout, volumeFloors } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld, type BuildingTypeParams } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const TYPES = ctx.buildingTypes.ids();

function build(type: string, seed: number, params: BuildingTypeParams = {}) {
  const res = projectFromBuildingType(ctx.buildingTypes.get(type), params, seed, ctx);
  return { res, world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
}

/** Prüfsumme der Endwelt (alle Blöcke mit Zustand). */
function digest(world: BaseWorld): string {
  const vol = world.materialized.volume;
  const lines: string[] = [];
  for (const owner of vol.owners()) {
    for (const c of vol.cellsOf(owner)) lines.push(`${c.pos.join(',')}=${c.state.name}${JSON.stringify(c.state.properties)}`);
  }
  return createHash('sha256').update(lines.sort().join('\n')).digest('hex');
}

describe('Unterbau über den Anwendungsdienst', () => {
  it('Schalter aus: Welt bitgleich zur Welt ohne Option (alle Bautypen)', { timeout: HEAVY_TIMEOUT }, () => {
    for (const type of TYPES) {
      expect(digest(build(type, 5, { underground: false }).world), type).toBe(digest(build(type, 5).world));
    }
  });

  for (const type of TYPES) {
    it(`${type}: Schalter an – 0 harte Verstöße, erreichbar, spawnsicher, Treppen frei, Oberfläche unverändert`, { timeout: HEAVY_TIMEOUT }, () => {
      const seed = 2;
      const off = build(type, seed);
      const { res, world } = build(type, seed, { underground: true });
      const where = `${type} Seed ${seed}`;
      expect(res.plan.underground, `${where}: ${res.plan.hints.join(' | ')}`).toBeDefined();
      expect(world.materialized.violations.filter((v) => v.kind !== 'spawn'), where).toEqual([]);
      const reach = reachableRooms(world.shell);
      expect(res.project.state.rooms.filter((r) => !reach.has(r.id)).map((r) => `${r.id} ${r.roomTypeId} ${r.floorIndex}`), where).toEqual([]);
      expect(world.materialized.light.darkCells, where).toEqual([]);
      expect(world.shell.cells.filter((c) => c.kind === 'roof' && c.pos[1] < 0), where).toEqual([]);
      // Außen-Deko wie ohne Unterbau: dieselben Anker (Türen, Fenster …) – der Unterbau neben dem Haus ist Erdreich
      const kinds = (w: typeof world) => (w.shell.anchors ?? []).map((x) => `${x.kind}@${x.pos.join(',')}`).sort();
      expect(kinds(world), where).toEqual(kinds(off.world));
      // Eingang (Modul, Portal, Vortreppe) wie ohne Unterbau; der Rest der Außen-Deko darf sich mit der neuen Kellertreppe
      // im Erdgeschoss verschieben (Einrichtung → Feuerstelle → Schornstein)
      const entrance = (w: typeof world) => (w.exterior ?? []).filter((p) => /entrance|portal|stoop|canopy/.test(`${p.group} ${p.componentId}`)).map((p) => p.id).sort();
      expect(entrance(world), `${where}: Eingang`).toEqual(entrance(off.world));
      // Gewölbe statt Wohnkeller: Etage −2 aus Stein (Mauerwerk/Decke `foundation`, Boden `floor_stone`), keine Holzpfosten
      const vault = new Set(res.project.state.rooms.filter((r) => r.floorIndex === -2).map((r) => r.id));
      const deepCells = world.shell.cells.filter((c) => c.roomId !== undefined && vault.has(c.roomId) && ['wall', 'pillar', 'floor', 'ceiling'].includes(c.kind));
      expect(deepCells.length, where).toBeGreaterThan(0);
      expect(deepCells.filter((c) => !(c.kind === 'floor' ? c.role === 'floor_stone' : c.role === 'foundation')).map((c) => `${c.kind}/${c.role}`).slice(0, 3), where).toEqual([]);
      // Treppen unter der Erde: über jeder Stufe 2 Luft, die Öffnung in der Platte frei
      const floors = new Map(volumeFloors(res.project.state, 'v0').map((f) => [f.index, f] as const));
      const vol = world.materialized.volume;
      const solid = (p: [number, number, number]): boolean => vol.contains(p) && !/(^|:)(cave_)?air$/.test(vol.stateAt(p).name);
      for (const link of res.project.state.links.filter((l) => l.floorIndex < 0)) {
        const lo = floors.get(link.floorIndex)!;
        const rise = floors.get(link.floorIndex + 1)!.y0 - lo.y0;
        const layout = stairLayout(link, rise);
        for (const b of layout.blocks.filter((x) => x.part === 'tread' || x.part === 'ladder')) {
          if (link.type === 'ladder') continue;
          for (const dy of [1, 2]) {
            const p: [number, number, number] = [b.cell[0], lo.y0 + b.dy + dy, b.cell[1]];
            expect(solid(p), `${where}: Treppe ${link.id} Kopfhöhe bei ${p.join(',')} (${vol.contains(p) ? vol.stateAt(p).name : '-'})`).toBe(false);
          }
        }
        for (const h of layout.holes) {
          const p: [number, number, number] = [h[0], lo.y0 + rise, h[1]];
          expect(solid(p), `${where}: Öffnung ${p.join(',')}`).toBe(false);
        }
      }
      // Oberfläche: Grundstück und Zonen wie ohne Unterbau
      expect(res.surroundings.site?.plot, where).toEqual(off.res.surroundings.site?.plot);
      expect(JSON.stringify(res.surroundings.site?.zones ?? null), where).toBe(JSON.stringify(off.res.surroundings.site?.zones ?? null));
    });
  }

  it('Hang (Wachturm L, Stil hills, Seeds 6 und 15): über jeder Unterbau-Spalte außerhalb des Hauses liegt Gelände (Review A1)', { timeout: HEAVY_TIMEOUT }, () => {
    for (const seed of [6, 15]) {
      const { res, world } = build('watchtower', seed, { size: 'L', underground: true });
      expect(res.plan.underground, `Seed ${seed}`).toBeDefined();
      const house = new Set(res.project.state.rooms.filter((r) => r.floorIndex >= 0).flatMap((r) => r.cells.toArray().map(([x, z]) => `${x},${z}`)));
      const deep = new Set(res.project.state.rooms.filter((r) => r.floorIndex < 0).map((r) => r.id));
      const top = new Map<string, number>();
      for (const c of world.shell.cells) {
        if (c.roomId === undefined || !deep.has(c.roomId)) continue;
        const k = `${c.pos[0]},${c.pos[2]}`;
        if (!house.has(k)) top.set(k, Math.max(top.get(k) ?? -Infinity, c.pos[1]));
      }
      const terrain = new Set(world.surroundings.cells.filter((c) => c.kind === 'terrain').map((c) => c.pos.join(',')));
      const open = [...top].filter(([k, y]) => { const [x, z] = k.split(','); return !terrain.has(`${x},${y + 1},${z}`); });
      expect(open.map(([k, y]) => `${k}@${y}`), `Seed ${seed}: Decke frei`).toEqual([]);
    }
  });

  it('deterministisch (zwei Bautypen, gleicher Seed → gleiche Welt)', { timeout: HEAVY_TIMEOUT }, () => {
    for (const type of ['tavern', 'watchtower']) {
      expect(digest(build(type, 3, { underground: true }).world), type).toBe(digest(build(type, 3, { underground: true }).world));
    }
  });
});
