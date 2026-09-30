/**
 * W4-C (plan/spikes/W4C_tueren.md): Doppeltür in der kompletten Base (Hülle, Einrichtung, Außengestaltung, Gelände).
 *
 * - Schankraum mit gerader Front: zwei Türflügel, im Spiel eine Vanilla-Doppeltür (gleiches `facing`, linker Flügel
 *   `hinge=left`, rechter `hinge=right`, obere und untere Hälfte passend → 0 `door_half`), 0 harte Verstöße.
 * - Einrichtung hält die Innenzelle vor **beiden** Flügeln frei; das Gelände legt den Laufweg vor beide Flügel.
 * - Haustür im Mittelfeld (F3) in der goldenen Menge: alle Bautypen außer dem Hobbit (Eingangsraum liegt am Rand).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FACADE_QUALITY_RULES, Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet, cellKey, type HorizontalDir } from '@mcda/core';
import { Site, buildingFromShell, plotAround } from '@mcda/terrain';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, shellFor, type BaseOptions } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const CCW: Record<HorizontalDir, HorizontalDir> = { north: 'west', west: 'south', south: 'east', east: 'north' };
const STEP: Record<HorizontalDir, readonly [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

function tavern(): { project: Project; options: BaseOptions } {
  const p = Project.create({ id: 't', name: 'Taverne', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 4 } });
  p.paintRoom(0, CellSet.rect(0, 0, 15, 8), 'tavern');
  p.paintRoom(0, CellSet.rect(0, 9, 15, 14), 'kitchen');
  const build: BaseOptions = { roof: 'gable', facade: { plinthProfile: true, cornice: true, quoins: true, rules: FACADE_QUALITY_RULES }, exterior: { density: 1 } };
  const building = buildingFromShell(shellFor(p, build));
  const site = Site.create({ id: 's', projectId: 't', seed: 2026, styleId: 'homestead', plot: plotAround(building, 12) });
  site.applyTemplate('homestead', building, {});
  return { project: p, options: { ...build, site: site.state } };
}

describe('W4-C: Doppeltür in der Base', () => {
  it('Vanilla-Doppeltür, 0 harte Verstöße, beide Flügel frei, Laufweg vor beiden, deterministisch', { timeout: HEAVY_TIMEOUT }, () => {
    const { project, options } = tavern();
    const world = generateBase(project, ctx, options);
    expect(world.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
    const mains = [...world.shell.rooms.values()].flatMap((r) => r.doors.filter((d) => d.isMain));
    expect(mains).toHaveLength(2);
    // Blockzustände im Volumen: gleiches facing, Scharnier außen (Partner links → rechts), Hälften passend
    const vol = world.materialized.volume;
    const leaves = world.shell.cells.filter((c) => c.kind === 'door' && c.exterior === true);
    expect(leaves).toHaveLength(4);
    const states = leaves.map((c) => ({ pos: c.pos, s: vol.stateAt(c.pos) }));
    const facing = states[0]!.s.properties['facing'] as HorizontalDir;
    for (const { pos, s } of states) {
      expect(s.name).toMatch(/_door$/);
      expect(s.properties['facing']).toBe(facing);
      const partner = states.find((o) => o.pos[1] === pos[1] && Math.abs(o.pos[0] - pos[0]) + Math.abs(o.pos[2] - pos[2]) === 1)!;
      expect(partner.s.name).toBe(s.name);
      const left = partner.pos[0] - pos[0] === STEP[CCW[facing]][0] && partner.pos[2] - pos[2] === STEP[CCW[facing]][1];
      expect(s.properties['hinge'], `Scharnier bei ${pos.join(',')}`).toBe(left ? 'right' : 'left');
    }
    // Einrichtung: vor beiden Flügeln innen frei (Laufhöhe 2, höchstens Teppich)
    const room = [...world.shell.rooms.values()].find((r) => r.doors.some((d) => d.isMain))!;
    for (const d of mains) {
      for (const y of [room.baseY, room.baseY + 1]) {
        const p = [d.inside[0], y, d.inside[1]] as const;
        const b = vol.isEmpty(p) ? 'air' : vol.stateAt(p).name;
        expect(b, `vor dem Flügel ${p.join(',')}`).toMatch(/air$|carpet$/);
      }
    }
    // Gelände: vor beiden Flügeln Weg (2 und 3 Blöcke vor der Wand)
    const surface = new Map<string, string>();
    for (const c of world.surroundings.cells) {
      const k = cellKey(c.pos[0], c.pos[2]);
      const top = surface.get(k);
      if (top === undefined || Number(top.split('@')[1]) < c.pos[1]) surface.set(k, `${c.role}@${c.pos[1]}`);
    }
    for (const d of mains) {
      for (const s of [3, 4]) {
        const k = cellKey(d.inside[0] + STEP[d.toward][0] * s, d.inside[1] + STEP[d.toward][1] * s);
        expect(surface.get(k) ?? '', `Laufweg vor dem Flügel ${d.inside.join(',')} (${s})`).toMatch(/^path/);
      }
    }
    expect(generateBase(project, ctx, options).materialized.volume.stateAt(leaves[0]!.pos)).toEqual(states[0]!.s);
  });
});

describe('W4-C: Haustür im Mittelfeld der Front (Baustandard F3) in der goldenen Menge', () => {
  const TYPES = ['castle_compact', 'farmhouse', 'hall', 'house', 'longhouse', 'tavern', 'timber', 'townhouse', 'townhouse_row', 'twostory', 'watchtower'] as const;
  it('alle Bautypen außer Hobbit: Haustür im Mittelfeld (gerade Feldzahl: in einem der beiden mittleren Felder)', { timeout: HEAVY_TIMEOUT }, () => {
    const off: string[] = [];
    for (const type of TYPES) {
      const def = ctx.buildingTypes.get(type)!;
      for (const themeId of [def.themes?.[0] ?? 'medieval', 'medieval']) {
        const res = projectFromBuildingType(def, { size: 'M', themeId, targetVersion: TARGET_VERSIONS['1.21.11'] }, 2026, ctx);
        const shell = shellFor(res.project, res.build, ctx.themes.get(themeId));
        const d = [...shell.rooms.values()].flatMap((r) => r.doors.filter((x) => x.isMain))[0]!;
        const [wx, wz] = [d.inside[0] + STEP[d.toward][0], d.inside[1] + STEP[d.toward][1]];
        const ns = d.toward === 'north' || d.toward === 'south';
        const line = shell.facadeGrid!.find((g) => g.out === d.toward && g.plane === (ns ? wz : wx) && g.from <= (ns ? wx : wz) && g.to >= (ns ? wx : wz))!;
        const n = line.bays.length;
        const bi = line.bays.findIndex((b) => b.from <= (ns ? wx : wz) && b.to >= (ns ? wx : wz));
        if (!(bi === (n - 1) / 2 || (n % 2 === 0 && (bi === n / 2 || bi === n / 2 - 1)))) off.push(`${type}-${themeId}: Feld ${bi + 1}/${n}`);
      }
    }
    expect(off).toEqual([]);
  });
});

describe('W5 (27.09.2026, Review N8): die Taverne mit gerader Front bekommt die Doppeltür', () => {
  it('Schankraum: gerade Frontlinie, Doppeltür auf der Doppelachse des Mittelfelds, Fuge mittig, erreichbar', { timeout: HEAVY_TIMEOUT }, () => {
    const miss: string[] = [];
    for (const type of ['tavern'] as const) {
      const def = ctx.buildingTypes.get(type)!;
      expect('evenFront' in def.massing && def.massing.evenFront === true).toBe(true);
      for (const size of ['S', 'M', 'L'] as const) {
        for (const seed of [7919, 15838]) {
          const themeId = def.themes![0]!;
          const res = projectFromBuildingType(def, { size, themeId, targetVersion: TARGET_VERSIONS['1.21.11'] }, seed, ctx);
          const shell = shellFor(res.project, res.build, ctx.themes.get(themeId));
          const mains = [...shell.rooms.entries()].flatMap(([id, r]) => r.doors.filter((x) => x.isMain).map((d) => ({ id, d })));
          if (mains.length !== 2 || mains.some(({ d }) => d.partner === undefined)) {
            miss.push(`${type}-${size}-${seed}: ${mains.length} Haustür-Flügel`);
            continue;
          }
          expect(res.project.state.rooms.find((r) => r.id === mains[0]!.id)?.roomTypeId).toBe(def.entrance);
          const d = mains[0]!.d;
          const [wx, wz] = [d.inside[0] + STEP[d.toward][0], d.inside[1] + STEP[d.toward][1]];
          const ns = d.toward === 'north' || d.toward === 'south';
          const line = shell.facadeGrid!.find((g) => g.out === d.toward && g.plane === (ns ? wz : wx) && g.from <= (ns ? wx : wz) && g.to >= (ns ? wx : wz))!;
          expect((line.to - line.from + 1) % 2, `${type}-${size}-${seed}: Frontlänge`).toBe(0);
          // Flügelfuge auf der Linienmitte (spiegelsymmetrisch)
          const cols = mains.map(({ d: x }) => (ns ? x.inside[0] : x.inside[1])).sort((a, b) => a - b);
          expect(cols[0]! + cols[1]!, `${type}-${size}-${seed}: Fuge`).toBe(line.from + line.to);
          expect(shell.warnings.filter((w) => /nicht erreichbar/.test(w))).toEqual([]);
        }
      }
    }
    // Über viele Seeds 72/72 Tavernen mit Doppeltür (Bericht W5-C); hier höchstens 2 von 6 einfach
    // (Schankraum erreicht das Mittelfeld nicht – dann bleibt die einfache Haustür im Mittelfeld, W4-C)
    expect(miss.length, miss.join(', ')).toBeLessThanOrEqual(2);
  });
});
