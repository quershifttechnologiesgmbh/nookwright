/** `build_guide` (DR5 K2): Bauplan zu einem Generier-Aufruf – gleiche Blöcke wie die Schematic, drei Ausgabeformen. */
import { describe, expect, it } from 'vitest';
import { OUTPUT_LICENSE_DRAFT, buildGuide } from '@mcda/pipeline';
import { engine } from './fixture.js';

const house = { buildingTypeId: 'house', surroundings: false, seed: 7 };
type Rows = Array<[string, number, number]>;

describe('build_guide', () => {
  const gen = engine.execute({ op: 'building_generate', input: house });
  if (!gen.ok) throw new Error(gen.errors.join('; '));

  it('JSON: dieselben Mengen wie die Materialliste von building_generate und wie buildGuide über die Schematic', () => {
    const r = engine.execute({ op: 'build_guide', input: { source: { op: 'building_generate', input: house }, sheet: 'json' } });
    expect(r.ok, r.ok ? '' : r.errors.join('; ')).toBe(true);
    if (!r.ok) return;
    const data = r.data as { guide: { materials: Array<{ item: string; count: number }> }; count: number; license: string; layers: number };
    const expected = buildGuide(gen.artifacts!.export!);
    expect(data.guide).toEqual(JSON.parse(JSON.stringify(expected)));
    const rows = (gen.data as { materials: { rows: Rows } }).materials.rows;
    expect(Object.fromEntries(data.guide.materials.map((m) => [m.item, m.count]))).toEqual(Object.fromEntries(rows.map(([i, h, s]) => [i, h + s])));
    expect(data.layers).toBeGreaterThan(3);
    expect(data.license).toBe(OUTPUT_LICENSE_DRAFT);
    expect(r.artifacts?.export).toBeUndefined();
  });

  it('Markdown mit Raster und CSV', () => {
    const md = engine.execute({ op: 'build_guide', input: { source: { op: 'building_generate', input: house }, grids: true } });
    const text = md.ok ? (md.data as { text: string }).text : '';
    expect(text).toContain('## Materialliste');
    expect(text).toContain('### Ebene 1 (y = 0)');
    expect(text).toContain('```');
    const csv = engine.execute({ op: 'build_guide', input: { source: { op: 'building_generate', input: house }, sheet: 'csv' } });
    const lines = csv.ok ? (csv.data as { text: string }).text.trim().split('\n') : [];
    expect(lines[0]).toBe('block,count,stack_size,full_stacks,remainder,slots,shulker_boxes');
    expect(lines.at(-1)).toMatch(/^TOTAL,\d+,,,,\d+,\d+$/);
  });

  it('Projekt über project_generate; Fehler der Quelle kommen durch', () => {
    const c = engine.execute({ op: 'project_create', input: { name: 'Plan', buildingType: { buildingTypeId: 'house' }, surroundings: false } });
    expect(c.ok).toBe(true);
    const projectId = c.ok ? (c.data as { projectId: string }).projectId : '';
    const r = engine.execute({ op: 'build_guide', input: { source: { op: 'project_generate', input: { projectId } }, sheet: 'csv' } });
    expect(r.ok, r.ok ? '' : r.errors.join('; ')).toBe(true);
    const bad = engine.execute({ op: 'build_guide', input: { source: { op: 'project_generate', input: { projectId: 'fehlt' } } } });
    expect(bad.ok).toBe(false);
    const wrong = engine.execute({ op: 'build_guide', input: { source: { op: 'catalog_list', input: {} } } });
    expect(wrong.ok).toBe(false);
  });
});
