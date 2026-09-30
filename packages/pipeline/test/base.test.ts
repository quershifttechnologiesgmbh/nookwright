/**
 * I2 – Integrationstest „komplette Base“: 2 Etagen mit Treppe, 6 Raumtypen, Satteldach, Gelände mit Feld, Garten
 * und Bäumen, Mauerring mit 4 Türmen und Tor – alles in EINER Welt (`generateBase`), 1.21.11 und 26.3, alle Themes.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type Shell, type StairType } from '@mcda/blueprint';
import { CellSet, key3, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import { exportFile, importFile } from '@mcda/export/node';
import { SHELL_ROLE_SHAPES } from '@mcda/materialize';
import { isAir } from '@mcda/voxel';
import {
  buildWorld, completeBase, furnishRooms, generate, generateBase, shellFor, surroundings, toExport, type BaseWorld,
} from '../src/index.js';
import { HEAVY_TIMEOUT, perfBudget, timeCpu } from '../../core/test/support/timing.js';
import { nodeContext } from '../src/node-context.js';
import { Walker, standKey } from './walk.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const STEP: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Räume, die vom Haupteingang über Türen (je Etage) und Treppen (gleiche linkId) erreichbar sind (Hüllen-Graph). */
function reachableRooms(shell: Shell): Set<string> {
  const groups = new Map<string, string[]>();
  let main: string | undefined;
  for (const [id, r] of shell.rooms) {
    for (const d of r.doors) {
      const k = `${r.floorIndex}:${d.inside[0] + STEP[d.toward][0]},${d.inside[1] + STEP[d.toward][1]}`;
      groups.set(k, [...(groups.get(k) ?? []), id]);
      if (d.isMain) main = id;
    }
    for (const s of r.stairs ?? []) groups.set(s.linkId, [...(groups.get(s.linkId) ?? []), id]);
  }
  const seen = new Set<string>(main !== undefined ? [main] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups.values()) if (g.some((r) => seen.has(r))) for (const r of g) if (!seen.has(r)) (seen.add(r), (grew = true));
  }
  return seen;
}

/** Standplatz vor der Haustür (draußen, auf dem Gelände). */
function frontDoor(shell: Shell): Vec3 {
  for (const r of shell.rooms.values()) {
    const d = r.doors.find((x) => x.isMain);
    if (d === undefined) continue;
    const [sx, sz] = STEP[d.toward];
    return [d.inside[0] + 2 * sx, r.baseY, d.inside[1] + 2 * sz];
  }
  throw new Error('keine Haustür');
}

const timings: number[] = [];

describe('Komplette Base (generateBase): Haus + Gelände + Mauerring in einer Welt', () => {
  for (const version of ['1.21.11', '26.3'] as const) {
    for (const theme of ctx.themes.ids()) {
      it(`${version} · ${theme}: 0 harte Verstöße, mob-sicher, alles erreichbar, Export-Round-Trip`, { timeout: HEAVY_TIMEOUT }, () => {
        const base = completeBase(version, theme);
        const { project } = base;
        const { result: world, ms } = timeCpu((): BaseWorld => generateBase(project, ctx, base.options));
        timings.push(ms);
        const m = world.materialized;
        const v = m.volume;
        const { site, structures } = world.surroundings;

        // Umfang: 2 Etagen mit Treppe, 6 Raumtypen, Satteldach, Feld + Garten + Bäume, 4 Türme + Tor
        expect(world.warnings, world.warnings.join('\n')).toEqual([]);
        expect(new Set(project.state.rooms.map((r) => r.floorIndex))).toEqual(new Set([0, 1]));
        expect(new Set(project.state.rooms.map((r) => r.roomTypeId)).size).toBe(6);
        expect(project.state.links).toHaveLength(1);
        expect(world.shell.cells.some((c) => c.kind === 'stairs')).toBe(true);
        expect(base.options.roof).toBe('gable');
        expect(world.shell.cells.filter((c) => c.kind === 'roof' && c.shape === 'stairs').length).toBeGreaterThan(50);
        expect(world.shell.cells.filter((c) => c.kind === 'wall' && c.pos[1] > 8).length, 'Giebelwände').toBeGreaterThan(5);
        expect(site?.fields).toHaveLength(1);
        expect(site!.fields[0]!.crops.length).toBeGreaterThan(40);
        expect(site!.cells.some((c) => c.role === 'garden_soil')).toBe(true);
        // W3 (27.09.2026): Baumgruppen am Rand statt Streuung (Baustandard G1, Vorbilder: 2–4 Bäume je Grundstück)
        expect(site!.trees.length).toBeGreaterThanOrEqual(3);
        expect(structures?.towers).toHaveLength(4);
        expect(structures?.walls[0]?.gates).toHaveLength(1);

        // 0 harte Verstöße, 0 Spawn-Zellen innen (Licht-Pass wirkt auch in der Gesamtwelt)
        const hard = m.violations.filter((x) => x.kind !== 'spawn');
        expect(hard, JSON.stringify(hard.slice(0, 5), null, 1)).toEqual([]);
        expect(m.light.darkCells).toEqual([]);
        expect(m.violations.filter((x) => x.kind === 'spawn')).toEqual([]);

        // Pflichtobjekte je Raum (auch oben)
        for (const room of project.state.rooms) {
          const rt = ctx.catalog.roomType(room.roomTypeId);
          const tags = project.state.placements.filter((p) => p.roomId === room.id).flatMap((p) => ctx.catalog.get(p.componentId).tags);
          for (const req of rt.required) expect(req.tags.some((t) => tags.includes(t)), `${room.id} ${room.roomTypeId}: ${req.tags}`).toBe(true);
        }

        // Erreichbarkeit laut Hülle (Türen + Treppe) …
        expect([...reachableRooms(world.shell)].sort()).toEqual(project.state.rooms.map((r) => r.id).sort());
        // … und begehbar in der fertigen Welt: vom Platz vor der Haustür in jeden Raum, auf den Wehrgang, auf
        // jede Turmplattform und durchs Tor hinaus bis an den Grundstücksrand
        const walker = new Walker(v, ctx.platform(project.state.targetVersion.name));
        const start = frontDoor(world.shell);
        expect(walker.canStand(start), `Start ${start}`).toBe(true);
        const seen = walker.reach([start]);
        for (const [id, r] of world.shell.rooms) {
          const hit = r.interior.toArray().some(([x, z]) => seen.has(standKey([x, r.baseY, z])));
          expect(hit, `Raum ${id} nicht begehbar erreichbar`).toBe(true);
        }
        const walkway = structures!.walls[0]!.walkway;
        expect(walkway.length).toBeGreaterThan(150);
        expect(walkway.filter((p) => !seen.has(standKey(p))), 'Wehrgang').toEqual([]);
        for (const t of structures!.towers) expect(t.topStands.filter((p) => !seen.has(standKey(p))), t.id).toEqual([]);
        const plot = site!.grid.plot;
        const border = [...seen].map((k) => k.split(',').map(Number) as [number, number, number])
          .filter(([x, , z]) => x === plot.minX || x === plot.maxX || z === plot.minZ || z === plot.maxZ);
        expect(border.length, 'Grundstücksrand (draußen, durchs Tor)').toBeGreaterThan(0);

        // Gelände unter dem Haus lückenlos, Bauwerke auf dem Gelände (nichts schwebt über Luft)
        for (const c of world.shell.cells.filter((x) => x.kind === 'floor' && x.pos[1] === 0)) {
          expect(isAir(v.stateAt([c.pos[0], -1, c.pos[2]])), `Fundament ${c.pos}`).toBe(false);
        }
        const g = world.surroundings.ground;
        for (const c of structures!.cells) {
          if (c.pos[1] !== g.groundY(c.pos[0], c.pos[2]) + 1) continue;
          expect(isAir(v.stateAt([c.pos[0], c.pos[1] - 1, c.pos[2]])), `unter Bauwerk ${c.pos}`).toBe(false);
        }
        // keine Doppelbelegung der Zusatz-Zellen
        const extra = new Set(world.surroundings.cells.map((c) => key3(c.pos)));
        expect(extra.size).toBe(world.surroundings.cells.length);

        // Export-Round-Trip in allen drei Formaten
        const ev = toExport(project, world);
        expect(ev.blocks.length).toBeGreaterThan(20000);
        for (const fmt of ['nbt', 'schem', 'litematic'] as const) {
          const back = importFile(fmt, exportFile(fmt, ev));
          expect(back.blocks.length, fmt).toBe(ev.blocks.length);
          expect(back.entities.length, fmt).toBe(ev.entities.length);
        }
      });
    }
  }

  it('Laufzeit: komplette Base in Node (Ziel < 2 s; unter Volllast großzügig geprüft)', () => {
    expect(timings.length).toBeGreaterThan(0);
    const sorted = [...timings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    console.log(`generateBase (CPU): Median ${median.toFixed(0)} ms, min ${sorted[0]!.toFixed(0)} ms, max ${sorted[sorted.length - 1]!.toFixed(0)} ms (${timings.length} Läufe)`);
    // allein gemessen ≈ 0,6–1,0 s warm (Sample-Skript); CPU-Zeit des Test-Threads, Fremdlast zählt nicht
    expect(sorted[0]!).toBeLessThan(perfBudget(3000));
    expect(median).toBeLessThan(perfBudget(8000));
  });
});

describe('Hüllen-Vertrag (SHELL_ROLE_SHAPES) deckt Bauplan und Bauwerke ab', () => {
  it('jede (Rolle, Form) aus deriveShell (alle Treppenarten, Satteldach) und buildStructures steht im Vertrag', () => {
    const seen = new Map<string, Set<string>>();
    const add = (cells: readonly { role: string; shape: string; kind: string }[]): void => {
      for (const c of cells) if (c.kind !== 'terrain' && c.kind !== 'plant') seen.set(c.role, (seen.get(c.role) ?? new Set()).add(c.shape));
    };
    const stairs: ReadonlyArray<readonly [StairType, Cell, HorizontalDir]> = [['straight', [3, 5], 'east'], ['l', [3, 6], 'east'], ['u', [3, 5], 'east'], ['spiral', [4, 5], 'north'], ['ladder', [5, 5], 'north']];
    for (const [type, origin, facing] of stairs) {
      const p = Project.create({ id: 'h', name: 'H', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'] });
      p.paintRoom(0, CellSet.rect(0, 0, 12, 10), 'storage');
      p.addFloor();
      p.paintRoom(1, CellSet.rect(0, 0, 12, 10), 'library');
      p.placeStairs(0, origin, facing, type, type === 'l' || type === 'u' || type === 'spiral' ? { turn: 'right' } : {});
      for (const roof of ['hip', 'gable', 'flat'] as const) add(shellFor(p, { roof }).cells);
    }
    const base = completeBase('26.3', 'medieval');
    add(surroundings(shellFor(base.project, base.options), { structures: base.structures }, { seed: 1 }).cells);
    add(surroundings({ cells: [], rooms: new Map(), warnings: [] }, { structures: { towers: [{ center: [0, 0], shape: 'square', top: 'battlements' }, { center: [20, 0], shape: 'round', top: 'roof' }] } }, { seed: 2 }).cells);
    const missing = [...seen].flatMap(([role, shapes]) => [...shapes].filter((s) => !(SHELL_ROLE_SHAPES[role] ?? []).includes(s)).map((s) => `${role}.${s}`));
    expect(missing).toEqual([]);
    for (const r of ['ladder', 'parapet', 'walkway', 'tower_floor', 'arrow_slit']) expect(seen.has(r), r).toBe(true);
  });
});

describe('Test-Hilfe Walker (Begehbarkeit im Voxel-Volumen)', () => {
  it('Haus ohne Gelände: vor der Tür kein Stand; drinnen über die Treppe nach oben, aber nicht hinaus', () => {
    const base = completeBase('26.3', 'medieval');
    const { project } = base;
    const shell = shellFor(project, { lighting: false });
    const world = buildWorld(project, ctx, shell);
    const walker = new Walker(world.materialized.volume, ctx.platform('26.3'));
    const outside = frontDoor(shell);
    const seen = walker.reach([[outside[0], outside[1] - 1, outside[2]]]); // ohne Gelände: Stand fehlt draußen
    expect(seen.size).toBe(0);
    const room = [...shell.rooms.values()].find((r) => r.floorIndex === 0)!;
    // W2 (26.09.2026): in der ersten Innenzelle (Innenecke) steht jetzt ein Eckständer der Innenhaut – Start auf der
    // ersten Zelle, auf der man stehen kann
    const [x, z] = room.interior.toArray().find(([cx, cz]) => walker.canStand([cx, room.baseY, cz]))!;
    const inside = walker.reach([[x, room.baseY, z]]);
    expect(inside.size).toBeGreaterThan(20);
    const upper = [...shell.rooms.values()].find((r) => r.floorIndex === 1)!;
    expect([...inside].some((k) => Number(k.split(',')[1]) === upper.baseY), 'Obergeschoss über die Treppe').toBe(true);
    // ohne Gelände draußen kein Boden: alle Standplätze liegen im Haus (x 0–22, z 0–15)
    for (const k of inside) {
      const [px, , pz] = k.split(',').map(Number) as [number, number, number];
      expect(px >= 0 && px <= 22 && pz >= 0 && pz <= 15, k).toBe(true);
    }
  });
});

describe('Anwendungsdienst: Gelände und Bauwerke als Zusatz-Zellen', () => {
  it('generate(…, { extraCells }) = Haus mit Licht-Pass + Zusatz-Zellen in einem Schritt', { timeout: HEAVY_TIMEOUT }, () => {
    const base = completeBase('26.3', 'rustic');
    const shell = shellFor(base.project, base.options);
    const around = surroundings(shell, { structures: base.structures }, { seed: 1 });
    const world = generate(base.project, ctx, { ...base.options, extraCells: around.cells });
    expect(world.lighting?.rooms.length).toBe(6);
    for (const c of around.cells.slice(0, 200)) expect(world.materialized.volume.cell(c.pos)?.owner, `${c.pos}`).toBe(`shell:${c.roomId ?? '-'}`);
    expect(world.materialized.violations.filter((x) => x.kind !== 'spawn')).toEqual([]);
  });

  it('ohne Gelände stehen Bauwerke eben unter der Bodenplatte (wie flatGround()), ohne Überschneidung mit dem Haus', { timeout: HEAVY_TIMEOUT }, () => {
    const base = completeBase('1.21.11', 'medieval');
    const shell = shellFor(base.project, base.options);
    const around = surroundings(shell, { structures: base.structures }, { seed: base.project.state.seed });
    expect(around.site).toBeUndefined();
    expect(around.ground.groundY(-50, -50)).toBe(-1);
    expect(Math.min(...around.cells.map((c) => c.pos[1]))).toBe(0);
    const house = new Set(shell.cells.map((c) => key3(c.pos)));
    expect(around.cells.filter((c) => house.has(key3(c.pos)))).toEqual([]);
    furnishRooms(base.project, shell, ctx.catalog);
    const world = buildWorld(base.project, ctx, shell, around.cells);
    expect(world.materialized.violations.filter((x) => x.kind !== 'spawn')).toEqual([]);
  });

  it('Gelände + Bauwerke sind deterministisch; Bauwerke folgen dem Gelände, Pflanzen meiden die Mauer', { timeout: HEAVY_TIMEOUT }, () => {
    const base = completeBase('26.3', 'nordic');
    const shell = shellFor(base.project, base.options);
    const opts = { seed: base.project.state.seed, terrainStyles: ctx.terrainStyles! };
    const a = surroundings(shell, base.options, opts);
    const b = surroundings(shell, base.options, opts);
    expect(JSON.stringify(a.cells)).toBe(JSON.stringify(b.cells));
    const fort = a.structures!;
    const cols = new Set(fort.footprint.map(([x, z]) => `${x},${z}`));
    expect(a.cells.filter((c) => c.kind === 'plant' && cols.has(`${c.pos[0]},${c.pos[2]}`))).toEqual([]);
    // Fuß jeder Mauerspalte direkt über dem Gelände (Höhenfeld = oberste Geländezelle)
    const foot = new Map<string, number>();
    for (const c of fort.cells) foot.set(`${c.pos[0]},${c.pos[2]}`, Math.min(foot.get(`${c.pos[0]},${c.pos[2]}`) ?? Infinity, c.pos[1]));
    let checked = 0;
    for (const [k, y] of foot) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      const i = a.site!.grid.at(x, z);
      if (i < 0) continue;
      expect(y, k).toBeGreaterThan(a.site!.top[i]!);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
    // Wege queren die Mauer nur durch das Tor
    const gate = fort.walls[0]!.gates[0]!;
    const through = new Set([...gate.passage.map((p) => `${p[0]},${p[2]}`), ...gate.approach.map(([x, z]) => `${x},${z}`)]);
    const crossing = [...a.site!.paths].filter(([x, z]) => cols.has(`${x},${z}`));
    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.filter(([x, z]) => !through.has(`${x},${z}`))).toEqual([]);
  });
});
