/**
 * W7-G (U7, „Nachbarn behalten Möbel“): Kante ziehen richtet Räume mit geänderter Geometrie nicht mehr komplett neu ein –
 * was mit allen harten Regeln noch passt, bleibt an seiner Stelle (`keepHintsOf` + Solver-Option `keep`).
 * Messung an der Taverne (Seed 2851810222 wie W2UX/W2-ED, drei Möbel gesperrt): Anteil unveränderter Möbel in den
 * betroffenen Räumen mit Vorgabe (App) gegen ohne (bisheriges Verhalten, gleiche Eingaben über `furnishRoomsDetailed`).
 * App = Engine: `furnishRoomsDetailed` mit `keep: true` (Weg von `project_furnish`) liefert dieselben Möbel wie die App.
 * Zahlen im Bericht plan/spikes/W7G_editor.md (Ausgabe mit W7G_KEEP=1).
 */
import { describe, expect, it } from 'vitest';
import { Project, type Placement, type ProjectState, type RoomId } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { furnishRoomsDetailed, moodOption, type PipelineContext } from '@mcda/pipeline';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { resizeByEdge, type RoomEdge } from '../src/editor/grid.js';
import { changeScope } from '../src/ui/changeScope.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles };
const def = load.buildingTypes.get('tavern');
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

const key = (p: Placement): string => JSON.stringify([p.componentId, p.variantId ?? '', p.pose.pos, p.pose.rot, p.pose.mirror]);
/** Möbel des Raums nachher, die es vorher genauso gab (Multimenge). */
function keptIn(before: ProjectState, after: ProjectState, id: RoomId): { kept: number; before: number; after: number } {
  const left = before.placements.filter((p) => p.roomId === id).map(key);
  const now = after.placements.filter((p) => p.roomId === id).map(key);
  let kept = 0;
  for (const k of now) {
    const i = left.indexOf(k);
    if (i >= 0) {
      left.splice(i, 1);
      kept++;
    }
  }
  return { kept, before: before.placements.filter((p) => p.roomId === id).length, after: now.length };
}

/** Räume, deren Geometrie (Zellen, Türen, Fenster, Höhe, Treppen) sich durch die Aktion geändert hat. */
function movedRooms(a: uc.Session, b: uc.Session): RoomId[] {
  const theme = uc.shellThemeOf(catalog, a.project.state.themeId);
  const sa = uc.shellOf(a.project, uc.shellStyle(a), theme);
  const sb = uc.shellOf(b.project, uc.shellStyle(b), theme);
  return b.project.state.rooms
    .filter((r) => {
      const ga = sa.rooms.get(r.id);
      const gb = sb.rooms.get(r.id);
      return ga !== undefined && gb !== undefined && uc.geometryKey(ga) !== uc.geometryKey(gb);
    })
    .map((r) => r.id);
}

const rows: string[] = [];

describe('U7: Nachbarn behalten Möbel (Taverne)', () => {
  const base = bt.typeSession(def, bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), 2851810222, ctx, NEW).session;
  const st = base.project.state;
  const room = st.rooms.find((r) => r.floorIndex === 0 && st.placements.filter((p) => p.roomId === r.id && p.parentId === undefined).length >= 3)!;
  let s0 = base;
  for (const p of st.placements.filter((x) => x.roomId === room.id && x.parentId === undefined).slice(0, 3)) s0 = uc.toggleLock(s0, catalog, p.id);
  const b = room.cells.bounds()!;
  const edgeTo = (edge: RoomEdge, grow: boolean): number => {
    if (edge === 'east') return grow ? b.maxX + 1 : b.maxX - 1;
    if (edge === 'west') return grow ? b.minX - 1 : b.minX + 1;
    if (edge === 'south') return grow ? b.maxZ + 1 : b.maxZ - 1;
    return grow ? b.minZ - 1 : b.minZ + 1;
  };
  const cases = (['north', 'south', 'west', 'east'] as const).flatMap((edge) => [true, false].map((grow) => ({ edge, grow, ...resizeByEdge(room.cells, edge, edgeTo(edge, grow)) })))
    .filter((c) => c.add.length + c.remove.length > 0);

  it.each(cases.map((c) => [`${c.edge} ${c.grow ? '+1' : '−1'}`, c] as const))('Kante %s: betroffene Räume behalten, was passt; App = Engine-Weg', (label, c) => {
    let after: uc.Session;
    try {
      after = uc.resizeRoom(s0, catalog, room.id, c.add, c.remove);
    } catch {
      return; // Kante nicht ziehbar (Baukörper, Treppe) – kein Messpunkt
    }
    const moved = movedRooms(s0, after);
    expect(moved).toContain(room.id);
    // App = Engine-Weg (furnishRoomsDetailed mit keep, wie project_furnish { keep: true })
    const p = Project.fromHistory(s0.project.history);
    p.resizeRoom(room.id, CellSet.of(c.add), CellSet.of(c.remove));
    const styles = uc.styleChain(catalog, p.state.themeId);
    const shell = uc.shellOf(p, uc.shellStyle(s0), uc.shellThemeOf(catalog, p.state.themeId));
    const fresh = Project.fromHistory(p.history);
    // wie project_furnish: Stil-Kette und Stimmung des Projekts (`moodOption`, feat/theme-moods)
    const mood = moodOption(p, ctx as unknown as PipelineContext);
    furnishRoomsDetailed(p, shell, catalog, { roomIds: moved, ...(styles !== undefined ? { styles } : {}), ...mood, keep: true });
    furnishRoomsDetailed(fresh, shell, catalog, { roomIds: moved, ...(styles !== undefined ? { styles } : {}), ...mood });
    const sameAsApp = (id: RoomId): boolean =>
      JSON.stringify(p.state.placements.filter((x) => x.roomId === id).map(key)) === JSON.stringify(after.project.state.placements.filter((x) => x.roomId === id).map(key));
    expect(moved.filter((id) => !sameAsApp(id))).toEqual([]);

    const neighbours = moved.filter((id) => id !== room.id);
    const sum = (state: ProjectState, ids: readonly RoomId[]) => ids.map((id) => keptIn(s0.project.state, state, id)).reduce((t, x) => ({ kept: t.kept + x.kept, before: t.before + x.before, after: t.after + x.after }), { kept: 0, before: 0, after: 0 });
    const withKeep = sum(after.project.state, neighbours);
    const without = sum(fresh.state, neighbours);
    const own = keptIn(s0.project.state, after.project.state, room.id);
    const ownFresh = keptIn(s0.project.state, fresh.state, room.id);
    const sc = changeScope(s0.project.state, after.project.state);
    const rooms = s0.project.state.rooms.length;
    rows.push(`| ${label} | ${moved.length}/${rooms} | ${sc.unchanged.length}/${rooms} | ${without.kept}/${without.before} | ${withKeep.kept}/${withKeep.before} | ${ownFresh.kept}/${own.before} | ${own.kept}/${own.before} |`);
    // Mit Vorgabe bleibt nie weniger als ohne; Möbelzahl der Nachbarn fällt nicht unter die frische Einrichtung − 1 je Raum
    expect(withKeep.kept).toBeGreaterThanOrEqual(without.kept);
    expect(withKeep.after).toBeGreaterThanOrEqual(without.after - neighbours.length);
    if (withKeep.before > 0) expect(withKeep.kept / withKeep.before).toBeGreaterThan(0.6);
  });

  it('ohne Vorgabe bitgleich: furnishRoomsDetailed ohne keep = frische Einrichtung wie bisher (Raum neu gewürfelt)', () => {
    const p = Project.fromHistory(s0.project.history);
    const q = Project.fromHistory(s0.project.history);
    const shell = uc.shellOf(p, uc.shellStyle(s0), uc.shellThemeOf(catalog, p.state.themeId));
    furnishRoomsDetailed(p, shell, catalog, { roomIds: [room.id] });
    furnishRoomsDetailed(q, shell, catalog, { roomIds: [room.id], keep: false });
    expect(q.state.placements.map(key)).toEqual(p.state.placements.map(key));
    // unveränderte Geometrie mit Vorgabe: alles bleibt, wie es ist
    const r = Project.fromHistory(s0.project.history);
    furnishRoomsDetailed(r, shell, catalog, { roomIds: [room.id], keep: true, ...(uc.styleChain(catalog, r.state.themeId) !== undefined ? { styles: uc.styleChain(catalog, r.state.themeId)! } : {}) });
    const k = keptIn(s0.project.state, r.state, room.id);
    expect(k.kept).toBe(k.before);
    if (process.env['W7G_KEEP'] === '1') {
      process.stderr.write('\n' + ['| Kante | Räume mit geänderter Geometrie | Räume unverändert | Nachbar-Möbel erhalten ohne | mit Vorgabe | Raum selbst ohne | mit |', '|---|---|---|---|---|---|---|', ...rows].join('\n'));
    }
  });
});
