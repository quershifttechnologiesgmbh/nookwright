/**
 * F „Bereich neu einrichten“ (plan/spikes/F_zone_refurnish.md, WFC 3.2 „Modifying in Blocks“):
 *  - eingefrorener Teil bytegleich (gleiche IDs, Lagen, Reihenfolge), neue Möbel nur im Gebiet;
 *  - deterministisch (gleiche Historie → gleiches Ergebnis), wiederholter Aufruf würfelt neu;
 *  - Pflichtobjekte bleiben erfüllt, freie Fläche zusammenhängend, jede Tür erreichbar, 0 harte Verstöße;
 *  - gesperrte/manuelle Möbel im Bereich bleiben; Undo stellt den Stand exakt wieder her.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type Placement, type RoomId, type Shell } from '@mcda/blueprint';
import { Catalog } from '@mcda/catalog';
import { CellSet, cellKey, type Cell } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { buildWorld, furnishingGeometry, generate, placedFor, planBlockRefurnish, refurnishBlock, roomZones, shellFor, styleChainOf, themeFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse, twoStoryHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function furnished(kind: 'one' | 'two', seed: number): { project: Project; shell: Shell } {
  const project = kind === 'one' ? sampleHouse('1.21.11', 'medieval', seed) : twoStoryHouse('1.21.11', 'medieval', seed);
  generate(project, ctx);
  return { project, shell: shellFor(project, {}, themeFor(project, ctx)) };
}

/** Linke (bzw. obere) Hälfte des Rauminneren als Rechteck-Bereich. */
function halfOf(shell: Shell, roomId: RoomId): CellSet {
  const b = shell.rooms.get(roomId)!.interior.bounds()!;
  const wide = b.maxX - b.minX >= b.maxZ - b.minZ;
  return wide ? CellSet.rect(b.minX, b.minZ, Math.floor((b.minX + b.maxX) / 2), b.maxZ) : CellSet.rect(b.minX, b.minZ, b.maxX, Math.floor((b.minZ + b.maxZ) / 2));
}

const colsOf = (p: Placement): Cell[] => placedFor(p, ctx.catalog).cells.map((c) => [c.pos[0], c.pos[2]] as Cell);

function freeConnected(project: Project, shell: Shell, roomId: RoomId): boolean {
  const g = furnishingGeometry(shell.rooms.get(roomId)!);
  const taken = new Set<string>();
  for (const p of project.state.placements.filter((x) => x.roomId === roomId)) {
    const placed = placedFor(p, ctx.catalog);
    if (placed.expanded.walkable) continue;
    for (const c of placed.cells) if (c.pos[1] <= g.baseY + 1) taken.add(cellKey(c.pos[0], c.pos[2]));
  }
  const free = g.interior.toArray().filter(([x, z]) => !taken.has(cellKey(x, z)));
  const set = CellSet.of(free);
  return set.isConnected() && g.doors.every((d) => set.has(d.inside[0], d.inside[1]));
}

const opts = (project: Project) => ({ styles: styleChainOf(project, ctx) });

describe('F Bereich neu einrichten', () => {
  it('eingefrorener Teil bytegleich, neue Möbel nur im Gebiet, Pflicht und Wege erfüllt, 0 harte Verstöße', { timeout: HEAVY_TIMEOUT }, () => {
    let changed = 0;
    for (const [kind, seed] of [['one', 2026], ['one', 7], ['two', 2026], ['two', 11]] as const) {
      const { project, shell } = furnished(kind, seed);
      for (const room of project.state.rooms) {
        const before = project.state.placements;
        const beforeRoom = before.filter((p) => p.roomId === room.id);
        const wasConnected = freeConnected(project, shell, room.id);
        const report = refurnishBlock(project, shell, ctx.catalog, { roomId: room.id, cells: halfOf(shell, room.id) }, opts(project));
        const after = project.state.placements;
        const removed = new Set(report.removed);
        // alle anderen Räume und alle eingefrorenen Möbel: dasselbe Objekt, dieselbe Reihenfolge
        const kept = before.filter((p) => !removed.has(p.id));
        expect(JSON.stringify(after.slice(0, kept.length))).toBe(JSON.stringify(kept));
        if (!report.ok) {
          expect(after).toBe(before);
          continue;
        }
        if (report.removed.length > 0 || report.added > 0) changed++;
        const added = after.slice(kept.length);
        expect(added).toHaveLength(report.added);
        for (const p of added) for (const [x, z] of colsOf(p)) expect(report.region.has(x, z), `${room.id} ${p.componentId} @${x},${z}`).toBe(true);
        // eingefroren heißt auch: nichts Entferntes lag außerhalb des Gebiets
        for (const p of beforeRoom.filter((x) => removed.has(x.id))) for (const [x, z] of colsOf(p)) expect(report.region.has(x, z)).toBe(true);
        // Pflichtobjekte des Raumtyps
        const rt = ctx.catalog.roomType(room.roomTypeId);
        const tagsNow = after.filter((p) => p.roomId === room.id).flatMap((p) => ctx.catalog.get(p.componentId).tags);
        const tagsBefore = beforeRoom.flatMap((p) => ctx.catalog.get(p.componentId).tags);
        for (const req of rt.required) if (req.tags.some((t) => tagsBefore.includes(t))) expect(req.tags.some((t) => tagsNow.includes(t)), `${room.roomTypeId}: ${req.tags}`).toBe(true);
        if (wasConnected) expect(freeConnected(project, shell, room.id), `${kind}/${seed} ${room.id}`).toBe(true);
      }
      const world = buildWorld(project, ctx, shell);
      const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
      expect(hard, JSON.stringify(hard.slice(0, 3))).toEqual([]);
    }
    expect(changed).toBeGreaterThan(8);
  });

  it('deterministisch; ein zweiter Aufruf würfelt neu; Undo stellt den Stand exakt her', { timeout: HEAVY_TIMEOUT }, () => {
    const run = () => {
      const { project, shell } = furnished('one', 2026);
      const room = project.state.rooms.find((r) => r.roomTypeId === 'smithy')!;
      const before = JSON.stringify(project.state);
      const r1 = refurnishBlock(project, shell, ctx.catalog, { roomId: room.id, cells: halfOf(shell, room.id) }, opts(project));
      const s1 = JSON.stringify(project.state.placements);
      const r2 = refurnishBlock(project, shell, ctx.catalog, { roomId: room.id, cells: halfOf(shell, room.id) }, opts(project));
      return { project, before, r1, r2, s1, h: JSON.stringify(project.history) };
    };
    const a = run();
    const b = run();
    expect(a.h).toBe(b.h);
    expect(a.r1.ok && a.r2.ok).toBe(true);
    // zweiter Wurf: anderer Unter-Seed (Zähler der Bereichs-Einrichtungen)
    expect(JSON.stringify(a.project.state.placements)).not.toBe(a.s1);
    const undone = a.project.undo(2);
    expect(JSON.stringify(undone.state)).toBe(a.before);
  });

  it('Funktionszonen: großer Raum hat mehrere; Zone neu einrichten lässt die anderen Zonen stehen', { timeout: HEAVY_TIMEOUT }, () => {
    const project = Project.create({ id: 'z', name: 'Zonen', seed: 5, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    project.paintRoom(0, CellSet.rect(0, 0, 17, 9), 'tavern');
    generate(project, ctx);
    const shell = shellFor(project, {}, themeFor(project, ctx));
    const room = project.state.rooms[0]!;
    const zones = roomZones(shell, room.id);
    expect(zones.length).toBeGreaterThanOrEqual(2);
    const before = project.state.placements;
    const report = refurnishBlock(project, shell, ctx.catalog, { roomId: room.id, cells: zones[0]!.cells, margin: 2 }, opts(project));
    expect(report.ok).toBe(true);
    const removed = new Set(report.removed);
    for (const p of before) {
      if (removed.has(p.id)) continue;
      expect(project.state.placements.find((x) => x.id === p.id)).toEqual(p);
    }
  });

  it('gesperrte und von Hand gesetzte Möbel im Bereich bleiben', { timeout: HEAVY_TIMEOUT }, () => {
    const { project, shell } = furnished('one', 2026);
    const room = project.state.rooms.find((r) => r.roomTypeId === 'bedroom')!;
    const block = shell.rooms.get(room.id)!.interior;
    const tops = project.state.placements.filter((p) => p.roomId === room.id && p.parentId === undefined);
    project.lockPlacement(tops[0]!.id);
    const locked = project.placement(tops[0]!.id);
    const report = refurnishBlock(project, shell, ctx.catalog, { roomId: room.id, cells: block }, opts(project));
    expect(report.ok).toBe(true);
    expect(report.removed).not.toContain(locked.id);
    expect(project.placement(locked.id)).toEqual(locked);
    // die Domäne lehnt das Entfernen gesperrter Möbel ab
    expect(() => project.refurnishBlock(room.id, block, [locked.id], [])).toThrow(/gesperrt/);
  });

  it('Plan ändert das Projekt nicht; Bereich außerhalb des Raums ist ein Fehler', () => {
    const { project, shell } = furnished('one', 7);
    const room = project.state.rooms[0]!;
    const h = project.history.length;
    const plan = planBlockRefurnish(project, shell, ctx.catalog, { roomId: room.id, cells: halfOf(shell, room.id) }, opts(project));
    expect(plan.report.ok).toBe(true);
    expect(project.history.length).toBe(h);
    // Nutzereingabe statt Fehler: außerhalb bzw. nur auf der Wand → ok: false mit Grund, nichts geändert
    const far = planBlockRefurnish(project, shell, ctx.catalog, { roomId: room.id, cells: CellSet.rect(200, 200, 201, 201) });
    expect(far.report).toMatchObject({ ok: false, changed: false });
    expect(far.report.reason).toMatch(/nicht im Rauminneren/);
    const b = room.cells.bounds()!;
    const wall = refurnishBlock(project, shell, ctx.catalog, { roomId: room.id, cells: CellSet.rect(b.minX, b.minZ, b.maxX, b.minZ) });
    expect(wall.ok).toBe(false);
    expect(project.history.length).toBe(h);
  });
});

describe('F Bereich neu einrichten: Scheitern', () => {
  it('passt ein Pflichtobjekt nicht mehr (Himmelbett nicht wählbar), wird nur der Bereich wiederholt; danach unverändert', { timeout: HEAVY_TIMEOUT }, () => {
    const { project, shell } = furnished('one', 2026);
    const room = project.state.rooms.find((r) => r.roomTypeId === 'bedroom')!;
    // Auswahl-Sicht ohne Himmelbett (Pflicht-Signatur): der Solver kann es im Bereich nicht wieder setzen
    const choice = Catalog.of(ctx.catalog.all().filter((d) => !d.tags.includes('canopy_bed')), ctx.catalog.roomTypeIds().map((id) => ctx.catalog.roomType(id)));
    const before = JSON.stringify(project.state);
    const h = project.history.length;
    const report = refurnishBlock(project, shell, ctx.catalog, { roomId: room.id, cells: shell.rooms.get(room.id)!.interior, attempts: 3 }, { ...opts(project), choice });
    expect(report.ok).toBe(false);
    expect(report.attempts).toBe(3);
    expect(report.warnings).toHaveLength(3);
    expect(report.warnings[0]).toMatch(/^Versuch 1: Pflichtobjekt canopy_bed fehlt/);
    expect(report.reason).toMatch(/nichts geändert/);
    expect(project.history.length).toBe(h);
    expect(JSON.stringify(project.state)).toBe(before);
  });
});

describe('W8-H Bereich neu einrichten: nie schlechter', () => {
  /** Programm-Möbel: passen zu einem Pflicht- oder Wunsch-Eintrag des Raumtyps (auch aufgesetzte Deko). */
  const programCount = (roomTypeId: string, ids: readonly string[]): number => {
    const rt = ctx.catalog.roomType(roomTypeId);
    const entries = [...rt.required, ...rt.optional];
    return ids.filter((c) => entries.some((e) => ctx.catalog.get(c).tags.some((t) => e.tags.includes(t)))).length;
  };

  it('Wohnstube (Tutorial-Grundriss): kein Versuch mit weniger Möbeln wird übernommen; sonst unverändert mit Hinweis', { timeout: HEAVY_TIMEOUT }, () => {
    let accepted = 0, retried = 0, refused = 0;
    for (const seed of [1, 3, 4, 7]) {
      const project = Project.create({ id: 's', name: 's', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
      project.paintRoom(0, CellSet.rect(14, 11, 22, 18), 'solar');
      project.paintRoom(0, CellSet.rect(23, 11, 28, 18), 'kitchen');
      generate(project, ctx);
      const shell = shellFor(project, {}, themeFor(project, ctx));
      const room = project.state.rooms.find((r) => r.roomTypeId === 'solar')!;
      const byId = new Map(project.state.placements.map((p) => [p.id, p]));
      // Kandidaten wie im Tutorial (3 × 4, 4 × 3) und kleine Rechtecke über den ganzen Raum
      const rects: Array<[number, number, number, number]> = [[19, 12, 21, 15], [15, 12, 18, 14], [15, 15, 18, 17], [19, 15, 21, 17], [16, 12, 20, 14]];
      for (let x = 15; x <= 20; x += 2) for (let z = 12; z <= 16; z += 2) rects.push([x, z, x + 1, z + 1]);
      for (const [x1, z1, x2, z2] of rects) {
        const plan = planBlockRefurnish(project, shell, ctx.catalog, { roomId: room.id, cells: CellSet.rect(x1, z1, x2, z2) }, opts(project));
        const r = plan.report;
        if (!r.ok) {
          expect(plan.drafts).toHaveLength(0);
          if (/zu klein|weniger Möbel/.test(r.reason ?? '')) {
            refused++;
            expect(r.reason).toMatch(/^(Bereich zu klein für neue Möbel|Neu einrichten brächte weniger Möbel).*nichts geändert/);
          }
          continue;
        }
        accepted++;
        if (r.attempts > 1) retried++;
        const removedIds = plan.removed.map((id) => byId.get(id)!.componentId);
        if (plan.removed.length > 0) expect(plan.drafts.length, `s${seed} ${x1},${z1}`).toBeGreaterThan(0);
        expect(programCount('solar', plan.drafts.map((d) => d.componentId)), `s${seed} ${x1},${z1}`).toBeGreaterThanOrEqual(programCount('solar', removedIds));
      }
    }
    // die Regel greift wirklich: Wiederholungen retten Bereiche, und manche bleiben mit Hinweis unverändert
    expect(accepted).toBeGreaterThan(0);
    expect(retried).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  it('sind alle Versuche schlechter, bleibt das Projekt unverändert (Hinweis mit bestem Ergebnis)', { timeout: HEAVY_TIMEOUT }, () => {
    const { project, shell } = furnished('one', 2026);
    const room = project.state.rooms.find((r) => r.roomTypeId === 'kitchen')!;
    // Auswahl-Sicht nur mit den Pflicht-Möbeln: der Wunsch-Teil des Bereichs kommt nicht wieder
    const rt = ctx.catalog.roomType('kitchen');
    const choice = Catalog.of(ctx.catalog.all().filter((d) => rt.required.some((e) => d.tags.some((t) => e.tags.includes(t)))), ctx.catalog.roomTypeIds().map((id) => ctx.catalog.roomType(id)));
    const before = JSON.stringify(project.state);
    const h = project.history.length;
    const report = refurnishBlock(project, shell, ctx.catalog, { roomId: room.id, cells: halfOf(shell, room.id), attempts: 2 }, { ...opts(project), choice });
    expect(report.ok).toBe(false);
    expect(report.changed).toBe(false);
    expect(report.reason).toMatch(/^Neu einrichten brächte weniger Möbel \(bestenfalls \d+ statt \d+ in 2 Versuchen\) – nichts geändert$/);
    expect(report.warnings).toEqual([expect.stringMatching(/^Versuch 1: nur \d+ statt \d+ Möbel$/), expect.stringMatching(/^Versuch 2: nur/)]);
    expect(project.history.length).toBe(h);
    expect(JSON.stringify(project.state)).toBe(before);
  });
});
