/**
 * W13-E (28.09.2026, plan/spikes/W13E_obergeschoss_fassade.md): Wandkleid der Obergeschosse. Der Bautyp setzt
 * `FacadeStyle.upperFrame`, die Hülle trägt den Leseport `Shell.upperFrame`, die Wandregeln des Themes fragen ihn mit
 * `when.upperFrame` ab. Ohne den Schalter bleibt alles gleich; mit ihm wechselt medieval über dem Steingeschoss zu
 * Fachwerk mit Kalkputz, und im Giebel entsteht kein Einzelkreuz aus Ständer und Riegel.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type ShellOptions } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { materialize, matchesWhen, shellContext, type MaterializeResult } from '../src/index.js';
import { platformView, themes } from './fixtures.js';

const STYLE: ShellOptions = {
  roof: 'gable', overhang: 1,
  roofDetail: { pitch: 'steep', trim: true, verge: 'closed', gableWindows: true },
  facade: { plinthProfile: true, cornice: true, quoins: true, brackets: 3 },
};

/** Zweigeschossiges Haus 17 × 12 (wie die Vorlage „Fachwerkhaus“), Treppe im Lager. */
function house(upperFrame: boolean) {
  const p = Project.create({ id: 'u', name: 'U', seed: 2026, themeId: 'medieval', targetVersion: PROJECT_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.addFloor();
  for (const [f, x1, z1, x2, z2, t] of [
    [0, 0, 0, 9, 6, 'solar'], [0, 10, 0, 16, 6, 'kitchen'], [0, 0, 7, 16, 11, 'storage'],
    [1, 0, 0, 8, 6, 'bedroom'], [1, 9, 0, 16, 6, 'study'], [1, 0, 7, 16, 11, 'guest_room'],
  ] as const) p.paintRoom(f, CellSet.rect(x1, z1, x2, z2), t);
  p.placeStairs(0, [3, 10], 'east');
  const shell = deriveShell(p.state, { ...STYLE, facade: { ...STYLE.facade, ...(upperFrame ? { upperFrame: true } : {}) } });
  return { shell, roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

/** FNV-1a über alle Blöcke (wie snow.test.ts). */
function checksum(r: MaterializeResult): string {
  let h = 0x811c9dc5;
  for (const c of r.volume.cells()) {
    const line = `${c.pos.join(',')}=${c.state.name}${JSON.stringify(c.state.properties)}
`;
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

const build = (h: ReturnType<typeof house>, themeId = 'medieval'): MaterializeResult =>
  materialize({ shell: h.shell, placements: [], theme: themes.get(themeId), platform: platformView('1.21.11'), seed: 2026, roomTypes: h.roomTypes });

/** Blocknamen der Außenwandzellen je Geschoss (0 = Erdgeschoss, 1 = Obergeschoss). */
function wallBlocks(h: ReturnType<typeof house>, r: MaterializeResult): [Set<string>, Set<string>] {
  const ctx = shellContext(h.shell, h.roomTypes);
  const out: [Set<string>, Set<string>] = [new Set(), new Set()];
  h.shell.cells.forEach((c, i) => {
    const x = ctx[i]!;
    if (c.kind !== 'wall' || !x.exterior || x.hRel < 0 || x.hRel >= x.H) return;
    out[Math.min(1, x.storey) as 0 | 1].add(String(r.volume.stateAt(c.pos).name).replace(/^minecraft:/, ''));
  });
  return out;
}

describe('W13-E Wandkleid der Obergeschosse', () => {
  it('Leseport: nur mit dem Schalter trägt die Hülle upperFrame, der Kontext meldet ihn, when.upperFrame passt', () => {
    const on = house(true);
    const off = house(false);
    expect(on.shell.upperFrame).toBe(true);
    expect(off.shell.upperFrame).toBeUndefined();
    const cOn = shellContext(on.shell)[0]!;
    const cOff = shellContext(off.shell)[0]!;
    expect(cOn.upperFrame).toBe(true);
    expect('upperFrame' in cOff).toBe(false);
    expect(matchesWhen({ upperFrame: true }, cOn)).toBe(true);
    expect(matchesWhen({ upperFrame: true }, cOff)).toBe(false);
    expect(matchesWhen({ upperFrame: false }, cOff)).toBe(true);
    expect(matchesWhen({ upperFrame: false }, cOn)).toBe(false);
  });

  it('medieval: Steingeschoss unten, Fachwerk mit Kalkputz oben; ohne Schalter oben Stein wie unten', () => {
    const on = house(true);
    const [gOn, uOn] = wallBlocks(on, build(on));
    expect([...gOn].some((n) => n.includes('stone') || n === 'andesite' || n.includes('cobble'))).toBe(true);
    expect(gOn.has('calcite')).toBe(false);
    expect(uOn.has('calcite')).toBe(true);
    expect([...uOn].some((n) => n.endsWith('_log'))).toBe(true);
    expect([...uOn].some((n) => n.includes('stone_bricks') || n === 'andesite')).toBe(false);
    const off = house(false);
    const [, uOff] = wallBlocks(off, build(off));
    expect(uOff.has('calcite')).toBe(false);
    expect([...uOff].some((n) => n.includes('stone_bricks') || n === 'andesite')).toBe(true);
  });

  it('Themes ohne Wandkleid-Regel (Sandstein, Tuff, Nordisch) bleiben mit dem Schalter bitgleich', () => {
    for (const id of ['desert', 'dwarven', 'nordic']) {
      const a = build(house(true), id);
      const b = build(house(false), id);
      expect(checksum(a), id).toBe(checksum(b));
    }
  });

  // Dunkle Zellen prüft die Pipeline mit Einrichtung (spikes/w13e measure: 0 dunkle Raumzellen); hier ohne Möbel und Licht
  it('harte Regeln: 0 Fehler, alle Scheiben verbunden', () => {
    const h = house(true);
    const r = build(h);
    expect(r.violations.filter((v) => v.severity === 'error')).toEqual([]);
    for (const c of h.shell.cells) {
      if (c.kind !== 'window') continue;
      const s = r.volume.stateAt(c.pos);
      if (!String(s.name).endsWith('glass_pane')) continue;
      expect(['north', 'east', 'south', 'west'].some((d) => s.properties[d] === 'true'), c.pos.join(',')).toBe(true);
    }
  });
});
