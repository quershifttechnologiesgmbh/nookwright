/**
 * W2-ED U4 – Messung „nur der gewählte Teil wird neu gebaut“: Taverne (Seed 2851810222 wie W2UX §2), drei Möbel eines
 * Raums gesperrt; je Aktion Anteil unveränderter Räume und Möbel (`changeScope`). Die Zahlen stehen im Bericht
 * plan/spikes/W2ED_editor.md (Ausgabe mit `--reporter=verbose` bzw. W2ED_SCOPE=1).
 */
import { describe, expect, it } from 'vitest';
import type { ProjectState } from '@mcda/blueprint';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { resizeByEdge } from '../src/editor/grid.js';
import { changeScope, scopeText } from '../src/ui/changeScope.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles };
const def = load.buildingTypes.get('tavern');
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

const rows: string[] = [];
const measure = (label: string, before: ProjectState, after: ProjectState) => {
  const sc = changeScope(before, after);
  const rooms = sc.unchanged.length + sc.rebuilt.length + sc.added.length;
  rows.push(`| ${label} | ${sc.unchanged.length}/${rooms} | ${sc.placementsKept}/${sc.placements} | ${scopeText(sc, (id) => id)} |`);
  return sc;
};

describe('Umfang der Nachbearbeitung (Taverne)', () => {
  const base = bt.typeSession(def, bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), 2851810222, ctx, NEW).session;
  const st = base.project.state;
  // Raum mit mindestens drei Möbeln auf dem EG, drei davon sperren
  const room = st.rooms.find((r) => r.floorIndex === 0 && st.placements.filter((p) => p.roomId === r.id && p.parentId === undefined).length >= 3)!;
  let locked = base;
  const lockedIds = st.placements.filter((p) => p.roomId === room.id && p.parentId === undefined).slice(0, 3).map((p) => p.id);
  for (const id of lockedIds) locked = uc.toggleLock(locked, catalog, id);
  const s0 = locked;
  const keptLocks = (s: typeof s0) => lockedIds.filter((id) => s.project.state.placements.find((p) => p.id === id)?.locked === true).length;

  it('Variante ▶ und ◀: nur dieser Raum, Sperren 3/3; ◀ ▶ zurück zur selben Variante = gleiche Einrichtung', () => {
    const v1 = uc.setRoomVariant(s0, catalog, room.id, 1);
    const sc = measure('Variante ▶ (Raum)', s0.project.state, v1.project.state);
    expect(sc.rebuilt).toEqual([room.id]);
    expect(keptLocks(v1)).toBe(3);
    const back = uc.setRoomVariant(v1, catalog, room.id, 0);
    measure('Variante ◀ (Raum)', v1.project.state, back.project.state);
    const again = uc.setRoomVariant(back, catalog, room.id, 1);
    const sc2 = measure('◀ ▶ wieder Variante 2', v1.project.state, again.project.state);
    expect(sc2.rebuilt).toEqual([]); // deterministisch: dieselbe Variante = dieselben Möbel
  });

  it('Kante ziehen: Raum behält ID und Sperren; nur er und berührte Nachbarn werden neu eingerichtet', () => {
    const b = room.cells.bounds()!;
    // Kante nach außen, wo kein Nachbar liegt (sonst die erste passende)
    const edges = (['north', 'south', 'west', 'east'] as const).map((edge) => {
      const to = edge === 'east' ? b.maxX + 1 : edge === 'west' ? b.minX - 1 : edge === 'south' ? b.maxZ + 1 : b.minZ - 1;
      return { edge, ...resizeByEdge(room.cells, edge, to) };
    });
    const free = edges.find((e) => e.add.every(([x, z]) => !st.rooms.some((r) => r.floorIndex === 0 && r.cells.has(x, z)))) ?? edges[0]!;
    const grown = uc.resizeRoom(s0, catalog, room.id, free.add, free.remove);
    const r2 = grown.project.state.rooms.find((r) => r.id === room.id)!;
    expect(r2.cells.size).toBeGreaterThan(room.cells.size);
    expect(keptLocks(grown)).toBe(3);
    const sc = measure(`Kante ${free.edge} +1 (frei)`, s0.project.state, grown.project.state);
    // W7-G: der Raum behält, was noch passt – „geändert“ oder (wenig blieb) „neu eingerichtet“
    expect([...sc.rebuilt, ...sc.edited]).toContain(room.id);
    // Kein Raum verschwindet; wie viele Nachbarn (auch darüber: Fenster/Dachhöhe) neu eingerichtet werden, hängt an der
    // Hülle (seit W2-FB Dachhöhen-Budget mehr) – gemessen und im Bericht, hier nicht festgeschrieben (U7 „Nachbarn stabil“)
    expect(sc.removed).toEqual([]);
    expect(sc.unchanged.length).toBeGreaterThan(0);
    // in den Nachbarn hinein
    const into = edges.find((e) => e.add.some(([x, z]) => st.rooms.some((r) => r.id !== room.id && r.floorIndex === 0 && r.cells.has(x, z))));
    if (into !== undefined) {
      const pushed = uc.resizeRoom(s0, catalog, room.id, into.add, into.remove);
      expect(pushed.project.state.rooms.some((r) => r.id === room.id)).toBe(true);
      expect(keptLocks(pushed)).toBe(3);
      measure(`Kante ${into.edge} +1 (in Nachbarn)`, s0.project.state, pushed.project.state);
    }
    // verkleinern (Gegenkante eine Reihe nach innen)
    const inner = resizeByEdge(room.cells, free.edge === 'east' ? 'west' : free.edge === 'west' ? 'east' : free.edge === 'north' ? 'south' : 'north', free.edge === 'east' ? b.minX + 1 : free.edge === 'west' ? b.maxX - 1 : free.edge === 'north' ? b.maxZ - 1 : b.minZ + 1);
    const shrunk = uc.resizeRoom(s0, catalog, room.id, inner.add, inner.remove);
    expect(shrunk.project.state.rooms.some((r) => r.id === room.id)).toBe(true);
    measure('Gegenkante −1', s0.project.state, shrunk.project.state);
  });

  it('Raum fixieren + Grundriss neu würfeln: fixierter Raum bleibt (ohne Sperren); Vergleich Übermalen früher', () => {
    let s = s0;
    for (const id of lockedIds) s = uc.toggleLock(s, catalog, id); // Sperren wieder lösen
    const other = st.rooms.find((r) => r.id !== room.id && r.floorIndex === 0)!;
    const fixed = uc.fixRoom(s, catalog, other.id, true);
    expect(bt.typeScope(fixed).pinned).toEqual([other.id]);
    const rerolled = bt.rerollType(fixed, def, ctx);
    expect(rerolled.project.state.rooms.some((r) => r.id === other.id)).toBe(true);
    measure('Grundriss neu würfeln, 1 Raum fixiert', fixed.project.state, rerolled.project.state);
    // früherer Weg „größer übermalen“: neuer Raum, Sperren weg
    const b = room.cells.bounds()!;
    const painted = uc.paintRect(s0, catalog, { x1: b.minX, z1: b.minZ, x2: b.maxX + 1, z2: b.maxZ }, room.roomTypeId, 0).session;
    expect(painted.project.state.rooms.some((r) => r.id === room.id)).toBe(false);
    expect(keptLocks(painted)).toBe(0);
    measure('früher: größer übermalen', s0.project.state, painted.project.state);
    if (process.env['W2ED_SCOPE'] === '1') process.stderr.write('\n' + ['| Aktion | Räume unverändert | Möbel unverändert | Statuszeile |', '|---|---|---|---|', ...rows].join('\n'));
  });
});
