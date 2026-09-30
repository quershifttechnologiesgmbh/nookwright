/**
 * W3-BL über die Engine-API: Block-Regeln (`project_style`, `building_generate`, `rooms_generate`), Materialliste in
 * jeder Generier-Antwort, Preset im Vokabular (`catalog_describe`) und die gemeinsame Passt-Prüfung der Befehle
 * `movePlacement`/`swapPlacement` (Aufliegendes folgt, abgelehnt mit Grund).
 */
import { describe, expect, it } from 'vitest';
import type { ExportVolume } from '@mcda/export';
import { EASY_FARM_BLOCKS } from '@mcda/pipeline';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import type { ExecuteResult } from '../src/index.js';
import { engine } from './fixture.js';

const ok = (r: ExecuteResult): Record<string, unknown> => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data as Record<string, unknown>;
};
const bannedIn = (r: ExecuteResult, list: readonly string[]): string[] => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  const v = r.artifacts!['export'] as ExportVolume;
  const set = new Set(list);
  return [...new Set(v.blocks.map((b) => b.name.replace(/^minecraft:/, '')).filter((n) => set.has(n)))].sort();
};

describe('Block-Regeln über die API', () => {
  it('catalog_describe nennt das Preset mit Begründung je Gruppe', () => {
    const d = ok(engine.execute({ op: 'catalog_describe', input: {} }));
    const groups = (d['blockPresets'] as { easy_farm: { id: string; why: string; blocks: string[] }[] }).easy_farm;
    expect(groups.flatMap((g) => g.blocks).sort()).toEqual([...EASY_FARM_BLOCKS].sort());
    for (const g of groups) expect(g.why.length).toBeGreaterThan(10);
  });

  // W13-F (2026-09-28): Prismarin trägt jetzt das Elfendach, die Küste hat keins mehr – vorher Hafen-Taverne (harbor)
  it('building_generate mit preset easy_farm: Elfen-Taverne ohne Prismarin, Ersatz und Materialliste in der Antwort', () => {
    const input = { buildingTypeId: 'tavern', size: 'S', themeId: 'elven', seed: 5, surroundings: true };
    const plain = engine.execute({ op: 'building_generate', input });
    expect(bannedIn(plain, EASY_FARM_BLOCKS).length).toBeGreaterThan(0);
    const r = engine.execute({ op: 'building_generate', input: { ...input, blockRules: { preset: 'easy_farm' } } });
    expect(bannedIn(r, EASY_FARM_BLOCKS)).toEqual([]);
    const d = ok(r);
    const rules = d['blockRules'] as { replaced: { from: string; to: string; count: number }[]; unreplaced: string[] };
    expect(rules.unreplaced).toEqual([]);
    expect(rules.replaced.some((x) => x.from.includes('prismarine'))).toBe(true);
    const m = d['materials'] as { house: number; surroundings: number; rows: [string, number, number][] };
    expect(m.house).toBeGreaterThan(500);
    expect(m.surroundings).toBeGreaterThan(0);
    expect(m.rows.some(([item]) => item.includes('prismarine'))).toBe(false);
    // ohne Regeln: keine blockRules-Angabe (bitgleich zur Antwort vorher, nur `materials` ist neu)
    expect(ok(plain)['blockRules']).toBeUndefined();
  }, HEAVY_TIMEOUT);

  it('allowed nimmt Preset-Blöcke einzeln heraus, replace setzt einen festen Ersatz', () => {
    const r = engine.execute({ op: 'rooms_generate', input: {
      // W13-F (2026-09-28): elven statt harbor (Prismarin nur noch im Elfendach)
      rooms: [{ floor: 0, roomTypeId: 'kitchen', rect: [0, 0, 8, 6] }], themeId: 'elven', seed: 2,
      blockRules: { preset: 'easy_farm', allowed: ['dark_prismarine'], banned: ['prismarine_bricks'], replace: { prismarine_bricks: 'stone_bricks' } },
    } });
    expect(bannedIn(r, ['prismarine_bricks', 'prismarine_brick_stairs', 'purpur_block'])).toEqual([]);
    const rules = ok(r)['blockRules'] as { replaced: { from: string; to: string }[] };
    expect(rules.replaced.filter((x) => x.from === 'prismarine_bricks').every((x) => x.to === 'stone_bricks')).toBe(true);
  }, HEAVY_TIMEOUT);

  it('project_style setzt die Regeln der Session; project_generate und project_save (App-Datei) tragen sie', () => {
    // W13-F (2026-09-28): elven statt harbor (Prismarin nur noch im Elfendach)
    const created = ok(engine.execute({ op: 'project_create', input: { seed: 4, themeId: 'elven', buildingType: { buildingTypeId: 'tavern', size: 'S' }, surroundings: false } }));
    const projectId = created['projectId'] as string;
    const styled = ok(engine.execute({ op: 'project_style', input: { projectId, blockRules: { preset: 'easy_farm' } } }));
    expect((styled['style'] as { blockRules: { preset: string } }).blockRules.preset).toBe('easy_farm');
    expect(bannedIn(engine.execute({ op: 'project_generate', input: { projectId } }), EASY_FARM_BLOCKS)).toEqual([]);
    const file = ok(engine.execute({ op: 'project_save', input: { projectId, format: 'app' } }));
    expect((file['blockRules'] as { banned: string[] }).banned).toEqual([...EASY_FARM_BLOCKS].sort());
    // {} hebt die Regeln auf
    const cleared = ok(engine.execute({ op: 'project_style', input: { projectId, blockRules: {} } }));
    expect((cleared['style'] as { blockRules?: unknown }).blockRules).toBeUndefined();
  }, HEAVY_TIMEOUT);
});

describe('Möbel bearbeiten über die API (gemeinsame Regel mit der App)', () => {
  const created = ok(engine.execute({ op: 'project_create', input: { name: 'M', seed: 3, themeId: 'medieval' } }));
  const projectId = created['projectId'] as string;
  ok(engine.execute({ op: 'project_command', input: { projectId, commands: [
    // W7 (27.09.2026): 14×10 statt 10×8 – seit den Tischgruppen mit Hockern auf beiden Seiten (W7-F) steht im kleinen
    // Schankraum jedes Möbel mit Kindern rundum eingebaut; die Aussage „Kinder folgen“ bleibt dieselbe
    { command: 'paintRoom', floor: 0, rect: [0, 0, 14, 10], roomTypeId: 'tavern' },
  ] } }));
  ok(engine.execute({ op: 'project_furnish', input: { projectId } }));
  type P = { id: string; roomId: string; pos: [number, number, number]; rot: 0 | 1 | 2 | 3; mirror: 'none' | 'x' | 'z'; parentId?: string };
  const placements = (): P[] => (ok(engine.execute({ op: 'project_get', input: { projectId, placements: true } }))['placements'] as P[]);
  const move = (p: P, pos: [number, number, number], rot = p.rot) =>
    engine.execute({ op: 'project_command', input: { projectId, commands: [{ command: 'movePlacement', placementId: p.id, pos, rot, mirror: p.mirror }] } });

  it('aus dem Raum bzw. in ein anderes Möbel: abgelehnt mit Grund, nichts ändert sich', () => {
    const before = placements();
    const p = before[0]!;
    const r = move(p, [p.pos[0] + 60, p.pos[1], p.pos[2]]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/ragt aus dem Raum/);
    expect(placements()).toEqual(before);
  });

  it('Aufliegendes folgt: ein Möbel mit Kindern nimmt sie beim Verschieben mit', () => {
    const all = placements();
    // W3 (27.09.2026): alle Möbel mit Kindern probieren – seit der Signatur-Anordnung (W3-IN) steht das erste oft
    // rundum eingebaut (Theke an der Wand zwischen anderen Möbeln); die Aussage „Kinder folgen“ bleibt dieselbe
    const parents = all.filter((p) => all.some((c) => c.parentId === p.id));
    expect(parents.length, 'eine Taverne hat Tische mit Kerzen o. Ä.').toBeGreaterThan(0);
    for (const parent of parents) {
      const kids = all.filter((c) => c.parentId === parent.id);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const r = move(parent, [parent.pos[0] + dx, parent.pos[1], parent.pos[2] + dz]);
        if (!r.ok) continue;
        const after = placements();
        for (const k of kids) expect(after.find((q) => q.id === k.id)!.pos).toEqual([k.pos[0] + dx, k.pos[1], k.pos[2] + dz]);
        return;
      }
    }
    expect.fail('kein Möbel mit Kindern hat ein freies Feld daneben');
  });
});
