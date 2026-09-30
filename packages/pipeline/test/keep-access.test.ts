/**
 * W4-B „Bergfried und Zugang“ (plan/spikes/W4B_bergfried.md) über den Anwendungsdienst (`projectFromBuildingType` +
 * `generateBase`, Weg der Galerie):
 *  - Turmschaft ohne Band je Geschoss: am Bergfried bzw. Wachturm liegt in der Außenwand kein Holz (Bodenplatten in
 *    Wandstein, Kranz aus Stein), kein Gesims je Etage;
 *  - Zugang: Leiter an der Wand des obersten Raums bis in die Dachplatte, darüber die Falltür im Belag (gleiches
 *    `facing`, kletterbar), die Wehrplatte bzw. der Ausguck ist zu Fuß mit Leitern von der Haustür erreichbar;
 *  - Mechanik: jede Leiter hat eine volle Fläche dahinter, keine Truhe unter einer Leiter, 0 harte Verstöße;
 *  - Bergfried führt: kein Mauerturm (samt Spitze) reicht an die Zinnen des Bergfrieds;
 *  - Eingang aus derselben Familie wie die Fenster (Stein).
 */
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS, type Shell } from '@mcda/blueprint';
import type { Cell, HorizontalDir, Vec3 } from '@mcda/core';
import { WorldView } from '@mcda/materialize';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld, type BuildingTypeResult } from '../src/index.js';
import { ctx, loadType } from './buildingtype-fuzz.js';
import { corniceCells, frameKeys } from './frames.js';
import { Walker, standKey } from './walk.js';

const V = TARGET_VERSIONS['1.21.11'];
const STEP: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const WOOD = /(oak|spruce|birch|jungle|acacia|mangrove|cherry|bamboo|crimson|warped)_(planks|log|wood|stairs|slab)$|^stripped_/;

function build(type: string, size: 'S' | 'M' | 'L', seed: number, themeId: string): { res: BuildingTypeResult; w: BaseWorld } {
  const res = projectFromBuildingType(loadType(type), { size, themeId, targetVersion: V }, seed, ctx);
  return { res, w: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
}

function frontDoor(shell: Shell): Vec3 {
  for (const r of shell.rooms.values()) {
    const d = r.doors.find((x) => x.isMain);
    if (d !== undefined) return [d.inside[0] + 2 * STEP[d.toward][0], r.baseY, d.inside[1] + 2 * STEP[d.toward][1]];
  }
  throw new Error('keine Haustür');
}

/** Spalten des Turm-Baukörpers (Bergfried bzw. Wachturm). */
function towerCols(res: BuildingTypeResult): Set<string> {
  const keep = res.plan.parts?.find((p) => p.id === 'keep');
  const v = keep?.volumeId ?? 'v0';
  return new Set(res.project.state.rooms.filter((r) => (r.volumeId ?? 'v0') === v).flatMap((r) => r.cells.toArray().map(([x, z]) => `${x},${z}`)));
}

const CASES = [
  ['castle_compact', 'M', 2026, 'medieval', 'fort:keep-parapet'],
  ['castle_compact', 'S', 3850358107, 'medieval', 'fort:keep-parapet'],
  ['castle_compact', 'L', 560943719, 'nordic', 'fort:keep-parapet'],
  ['watchtower', 'M', 2026, 'medieval', 'fort:main-parapet'],
  ['watchtower', 'S', 7, 'rustic', 'fort:main-parapet'],
] as const;

describe('W4-B: Zugang zu Wehrplatte und Ausguck, Mechanik', () => {
  for (const [type, size, seed, theme, owner] of CASES) {
    it(`${type} ${size} Seed ${seed} ${theme}: Leiter + Falltür, Plattform zu Fuß erreichbar, Mechanik`, { timeout: HEAVY_TIMEOUT }, () => {
      const { res, w } = build(type, size, seed, theme);
      expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
      const cols = towerCols(res);
      const crown = w.surroundings.cells.filter((c) => c.roomId === owner);
      const hatch = crown.filter((c) => c.shape === 'trapdoor');
      expect(hatch).toHaveLength(1);
      const t = hatch[0]!;
      // direkt unter der Falltür die oberste Leiter, gleiche Blickrichtung (geöffnet kletterbar), in der Dachplatte
      const ladders = w.shell.cells.filter((c) => c.shape === 'ladder' && c.pos[0] === t.pos[0] && c.pos[2] === t.pos[2]);
      const top = ladders.find((c) => c.pos[1] === t.pos[1] - 1);
      expect(top?.orient?.facing).toBe(t.orient?.facing);
      expect(t.orient?.half).toBe('top');
      expect(cols.has(`${t.pos[0]},${t.pos[2]}`)).toBe(true);
      // Leiter-Säule lückenlos bis zum Boden des obersten Raums, jede mit voller Fläche dahinter
      const view = new WorldView(w.materialized.volume, ctx.platform(V.name));
      const ys = ladders.map((c) => c.pos[1]).sort((a, b) => a - b);
      expect(ys).toEqual(Array.from({ length: ys.length }, (_, k) => ys[0]! + k));
      for (const c of ladders) {
        const [bx, bz] = STEP[c.orient!.facing!];
        expect(view.face([c.pos[0] - bx, c.pos[1], c.pos[2] - bz], c.orient!.facing!), `Leiter ${c.pos.join(',')}`).toBe('full');
      }
      // keine Truhe unter einer Leiter (Faktencheck #2; auch nicht unter der Falltür)
      const vol = w.materialized.volume;
      for (const c of [...w.shell.cells.filter((x) => x.shape === 'ladder'), t]) {
        const below: Vec3 = [c.pos[0], c.pos[1] - 1, c.pos[2]];
        expect(vol.contains(below) && /chest$/.test(vol.stateAt(below).name), `Truhe unter ${c.pos.join(',')}`).toBe(false);
      }
      // zu Fuß mit Leitern: von der Haustür auf die Plattform (Belag bzw. Ausguck-Boden) und in jeden Turmraum
      const walker = new Walker(vol, ctx.platform(V.name), { climb: true });
      const seen = walker.reach([frontDoor(w.shell)]);
      const deck = crown.filter((c) => c.role === 'walkway').map((c): Vec3 => [c.pos[0], c.pos[1] + 1, c.pos[2]]).filter((p) => walker.canStand(p));
      expect(deck.length).toBeGreaterThan(8);
      expect(deck.filter((p) => !seen.has(standKey(p))).map((p) => p.join(','))).toEqual([]);
      const own = res.project.state.rooms.filter((r) => r.cells.toArray().some(([x, z]) => cols.has(`${x},${z}`)) && r.floorIndex >= 0);
      for (const r of own) {
        const info = w.shell.rooms.get(r.id)!;
        expect(info.interior.toArray().some(([x, z]) => seen.has(standKey([x, info.baseY, z]))), `Raum ${r.id} (${r.roomTypeId})`).toBe(true);
      }
    });
  }
});

describe('W4-B: Turmschaft ohne Holzband, Bergfried führt, Eingang in Stein', () => {
  for (const [type, size, seed, theme] of CASES.filter(([, , , th]) => th === 'medieval')) {
    it(`${type} ${size} Seed ${seed}: kein Holz in der Außenwand des Turms, kein Gesims je Etage, Kranz aus Stein`, { timeout: HEAVY_TIMEOUT }, () => {
      const { res, w } = build(type, size, seed, theme);
      const cols = towerCols(res);
      // Außenluft wie im Außenmodell der Hülle: über der obersten Hüllzelle der Spalte (sonst Raum, Dachraum oder Wand)
      const colTop = new Map<string, number>();
      for (const c of w.shell.cells) if (c.kind !== 'fort' && c.kind !== 'terrain' && c.kind !== 'plant') colTop.set(`${c.pos[0]},${c.pos[2]}`, Math.max(colTop.get(`${c.pos[0]},${c.pos[2]}`) ?? -Infinity, c.pos[1]));
      const shaftTop = Math.max(...[...cols].map((k) => colTop.get(k) ?? -Infinity));
      const vol = w.materialized.volume;
      const wood: string[] = [];
      for (const k of cols) {
        const [x, z] = k.split(',').map(Number) as [number, number];
        for (const [dx, dz] of Object.values(STEP)) {
          if (cols.has(`${x + dx},${z + dz}`)) continue;
          for (let y = 1; y <= shaftTop; y++) {
            const front: Vec3 = [x + dx, y, z + dz];
            if ((colTop.get(`${front[0]},${front[2]}`) ?? -Infinity) >= y || (vol.contains(front) && !vol.isEmpty(front))) continue; // nicht von außen sichtbar
            const p: Vec3 = [x, y, z];
            if (vol.contains(p) && WOOD.test(vol.stateAt(p).name)) wood.push(`${p.join(',')} ${vol.stateAt(p).name}`);
          }
        }
      }
      expect(wood).toEqual([]);
      const towerRooms = new Set(res.project.state.rooms.filter((r) => r.cells.toArray().some(([x, z]) => cols.has(`${x},${z}`))).map((r) => r.id));
      // W5 (27.09.2026): Fensterrahmen in `wall_cornice` (Review W4-R N2) zählen nicht als Gesims
      expect(corniceCells(w.shell).filter((c) => towerRooms.has(c.roomId ?? ''))).toEqual([]);
      // W5 (27.09.2026, Review W4-R N2): auch vor der Wand kein Holz am Turmschaft – Rahmen (Bank, Sturz) aus Stein,
      // Laternen-Arm aus Mauer; ausgenommen Türblätter, Laternen und Spalten fremder Räume (Palas, innen)
      const frames = frameKeys(w.shell);
      const otherRooms = new Set(res.project.state.rooms.filter((r) => !towerRooms.has(r.id)).flatMap((r) => r.cells.toArray().map(([x, z]) => `${x},${z}`)));
      const skin: string[] = [];
      let framed = 0;
      for (const k of cols) {
        const [x, z] = k.split(',').map(Number) as [number, number];
        for (const [dx, dz] of Object.values(STEP)) {
          if (cols.has(`${x + dx},${z + dz}`) || otherRooms.has(`${x + dx},${z + dz}`)) continue;
          for (let y = 1; y <= shaftTop; y++) {
            const front: Vec3 = [x + dx, y, z + dz];
            if (!vol.contains(front) || vol.isEmpty(front)) continue;
            const n = vol.stateAt(front).name;
            if (frames.has(`${front[0]},${front[1]},${front[2]}`)) framed++;
            if (WOOD.test(n) || /_fence$/.test(n)) skin.push(`${front.join(',')} ${n}`);
          }
        }
      }
      expect(skin).toEqual([]);
      expect(framed).toBeGreaterThan(8);
      // Flachdach-Rand des Turms (Zellen ohne Raum, direkt neben den Turmspalten auf Deckenhöhe): Stein statt Holz
      const rim = w.shell.cells.filter((c) => c.kind === 'roof' && c.pos[1] === shaftTop && Object.values(STEP).some(([dx, dz]) => cols.has(`${c.pos[0] + dx},${c.pos[2] + dz}`)));
      expect(rim.length).toBeGreaterThan(0);
      expect(rim.filter((c) => c.role !== 'wall_cornice')).toEqual([]);
      expect(res.build.exterior?.entranceModule).toBe('stone');
      expect((w.exterior ?? []).filter((p) => p.componentId.startsWith('exterior/entrance_module_')).map((p) => p.componentId))
        .toEqual(expect.arrayContaining(['exterior/entrance_module_stone']));
      expect((w.exterior ?? []).filter((p) => p.componentId.startsWith('exterior/entrance_module_') && p.componentId !== 'exterior/entrance_module_stone')).toEqual([]);
      if (type === 'castle_compact') {
        const zinnen = Math.max(...w.surroundings.cells.filter((c) => c.roomId === 'fort:keep-parapet').map((c) => c.pos[1]));
        const ring = w.surroundings.cells.filter((c) => /^fort:ring\.t\d+$/.test(c.roomId ?? ''));
        expect(Math.max(...ring.map((c) => c.pos[1]))).toBeLessThan(zinnen);
      }
    });
  }
});
