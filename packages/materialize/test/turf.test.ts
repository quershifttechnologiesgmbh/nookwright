/**
 * W13-B Torfdach (`decor.turfRoof`, `src/turf.ts`, plan/spikes/W13B_nordisch_dach.md):
 *  - nordic (Seed wählt Torf) legt Gras-/Moossoden auf die Dachhaut, hebt die Ortgangtreppen an, ersetzt die halbe
 *    Firstplatte; die Traufreihe bleibt Brett;
 *  - physikalisch gültig: Soden sind Vollblöcke mit Luft oder Bewuchs darüber (Gras wird nicht zu Erde), Bewuchs steht
 *    auf Gras, keine harte Meldung, vollständige Zustände;
 *  - innen unverändert hell (Blocklicht und dunkle Zellen wie ohne Torf);
 *  - ohne Theme-Feld, mit `share: 0` (winter/harbor/elven) oder `turfRoof: false` bitgleich; Seed-Anteil und Vorgabe.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type RoofStyle, type Shell } from '@mcda/blueprint';
import { CellSet, hash01, hashSeed } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { materialize, turfRoofSettings, type MaterializeOptions, type MaterializeResult } from '../src/index.js';
import { platformView, themes } from './fixtures.js';

const VERSION = '26.3';
const L_ROOM = CellSet.rect(0, 0, 9, 4).union(CellSet.rect(0, 5, 4, 9));

interface House {
  readonly shell: Shell;
  readonly roomTypes: Record<string, string>;
}

/** Wie snow.test.ts; `width` ungerade → einreihiger First mit Platte, gerade → zwei Firstreihen. */
function house(roof: RoofStyle, room = L_ROOM, trim = false): House {
  const p = Project.create({ id: 't', name: 'T', seed: 5, themeId: 'nordic', targetVersion: PROJECT_VERSIONS[VERSION], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, room, 'bedroom');
  const shell = deriveShell(p.state, { roof, overhang: 1, ...(trim ? { roofDetail: { trim: true } } : {}) });
  return { shell, roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

function run(h: House, themeId: string, options?: MaterializeOptions, seed = 2026): MaterializeResult {
  return materialize({
    shell: h.shell, placements: [], theme: themes.get(themeId), platform: platformView(VERSION), seed, roomTypes: h.roomTypes,
    ...(options !== undefined ? { options } : {}),
  });
}

const key = (p: readonly number[]): string => p.join(',');
const SOD = new Set(['grass_block', 'moss_block']);
const sods = (r: MaterializeResult) => [...r.volume.cells()].filter((c) => SOD.has(c.state.name));
const errors = (r: MaterializeResult) => r.violations.filter((v) => v.severity === 'error');
const at = (r: MaterializeResult, p: readonly [number, number, number]): string =>
  r.volume.contains(p) && !r.volume.isEmpty(p) ? r.volume.stateAt(p).name : 'air';

describe('Torfdach (W13-B): nordic legt Soden auf das Dach', () => {
  it('Satteldach, gerade und ungerade Breite: Soden, angehobener Ortgang, gültige Physik', () => {
    // 10 × 6 (gerade Tiefe → zwei Firstreihen) und 10 × 7 (ungerade → einreihiger First mit Platte)
    for (const room of [CellSet.rect(0, 0, 9, 5), CellSet.rect(0, 0, 9, 6)]) {
      const h = house('gable', room, true);
      const r = run(h, 'nordic', { turfRoof: true });
      const s = sods(r);
      expect(s.length).toBeGreaterThan(20);
      expect(errors(r)).toEqual([]);
      // Gras und Moos, Moos in Flecken (beide vorhanden)
      expect(new Set(s.map((c) => c.state.name))).toEqual(SOD);
      // Luft oder Bewuchs darüber (sonst würde das Gras im Spiel zu Erde); Bewuchs steht auf Gras
      for (const c of s) {
        const up = at(r, [c.pos[0], c.pos[1] + 1, c.pos[2]]);
        expect(up === 'air' || /^(short_grass|fern|dandelion|oxeye_daisy)$/.test(up), `${key(c.pos)} ${up}`).toBe(true);
        if (up !== 'air') expect(c.state.name, key(c.pos)).toBe('grass_block');
      }
      // Soden liegen auf dem Dach (Hüllzelle darunter oder selbst Firstzelle), nie frei in der Luft
      const shellPos = new Set(h.shell.cells.filter((c) => c.kind === 'roof').map((c) => key(c.pos)));
      for (const c of s) expect(shellPos.has(key([c.pos[0], c.pos[1] - 1, c.pos[2]])) || shellPos.has(key(c.pos)), key(c.pos)).toBe(true);
      // Traufreihe bleibt frei: über der untersten Dachreihe kein Soden
      const roof = h.shell.cells.filter((c) => c.kind === 'roof');
      const y0 = Math.min(...roof.map((c) => c.pos[1]));
      const sodAt = new Set(s.map((c) => key(c.pos)));
      for (const c of roof.filter((c) => c.pos[1] === y0)) expect(sodAt.has(key([c.pos[0], y0 + 1, c.pos[2]])), key(c.pos)).toBe(false);
      // Ortgang angehoben: über Ortgangtreppen steht eine gleiche Treppe (Windbrett hält den Torf), an beiden Giebeln
      const boards = [...r.volume.cells()].filter((c) => c.owner === 'decor:turf' && c.state.name.endsWith('_stairs'));
      expect(boards.length).toBeGreaterThan(0);
      for (const b of boards) expect(at(r, [b.pos[0], b.pos[1] - 1, b.pos[2]]), key(b.pos)).toBe(b.state.name);
      const xs = boards.map((b) => b.pos[0]);
      const zs = boards.map((b) => b.pos[2]);
      const ends = new Set(xs).size < new Set(zs).size ? xs : zs;
      expect(new Set(ends).size, 'beide Giebel').toBe(2);
      // keine Platte bleibt als Rinne zwischen den Soden
      for (const c of r.volume.cells()) {
        if (!c.state.name.endsWith('_slab') || c.state.properties['type'] !== 'bottom') continue;
        const [x, y, z] = c.pos;
        const flanked = (SOD.has(at(r, [x + 1, y, z])) && SOD.has(at(r, [x - 1, y, z]))) || (SOD.has(at(r, [x, y, z + 1])) && SOD.has(at(r, [x, y, z - 1])));
        expect(flanked, `Rinne bei ${key(c.pos)}`).toBe(false);
      }
    }
  });

  it('innen bleibt es hell: Blocklicht und dunkle Zellen wie ohne Torf', () => {
    const h = house('hip');
    const on = run(h, 'nordic', { turfRoof: true });
    const off = run(h, 'nordic', { turfRoof: false });
    expect(sods(on).length).toBeGreaterThan(0);
    expect(on.light.darkCells.length).toBe(off.light.darkCells.length);
    expect(on.light.walkableCells).toBe(off.light.walkableCells);
    for (const e of off.light.emitters) expect(on.light.levelAt(e.pos)).toBe(off.light.levelAt(e.pos));
  });

  it('bitgleich ohne Torf: medieval, winter/harbor/elven (share 0) und `turfRoof: false`', () => {
    const h = house('gable');
    for (const id of ['medieval', 'winter', 'harbor', 'elven']) expect(turfRoofSettings(themes.get(id), 2026), id).toBeUndefined();
    expect(turfRoofSettings(themes.get('medieval'), 2026, true)).toBeUndefined();
    // die Option allein schaltet den Pass nicht an
    expect(sods(run(h, 'medieval', { turfRoof: true }))).toHaveLength(0);
    const off = run(h, 'nordic', { turfRoof: false });
    expect(sods(off)).toHaveLength(0);
    expect([...off.volume.cells()].some((c) => c.owner === 'decor:turf')).toBe(false);
  });

  it('Seed wählt Torf oder Holz (Anteil 0,75), Vorgabe `true` erzwingt Torf; deterministisch', () => {
    const nordic = themes.get('nordic');
    expect(nordic.decor.turfRoof?.share).toBe(0.75);
    let turf = 0;
    for (let s = 0; s < 400; s++) if (turfRoofSettings(nordic, s) !== undefined) turf++;
    expect(turf / 400).toBeGreaterThan(0.65);
    expect(turf / 400).toBeLessThan(0.85);
    const wood = [...Array(100).keys()].find((s) => turfRoofSettings(nordic, s) === undefined)!;
    expect(hash01(hashSeed(wood, 'turf-roof'), 0, 0)).toBeGreaterThanOrEqual(0.75);
    expect(turfRoofSettings(nordic, wood, true)).toBeDefined();
    const h = house('gable');
    expect(sods(run(h, 'nordic', undefined, wood))).toHaveLength(0);
    expect(sods(run(h, 'nordic', { turfRoof: true }, wood)).length).toBeGreaterThan(0);
    const a = sods(run(h, 'nordic', { turfRoof: true })).map((c) => `${key(c.pos)}${c.state.name}`);
    const b = sods(run(h, 'nordic', { turfRoof: true })).map((c) => `${key(c.pos)}${c.state.name}`);
    expect(a).toEqual(b);
  });
});
