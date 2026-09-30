/**
 * Stil-Kennzahlen (LV-1…LV-23, KM1…KM9): Ampel-Regel, Bericht (Mittel, JSON, Markdown) und eine kleine Messung an einem
 * erzeugten Haus. Klein und deterministisch; die große Messreihe liegt in `spikes/stilmetrik/measure.ts`.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  facadeQuality, generateBase, judgeMetric, measureEnsemble, measureStyle, projectFromBuildingType, reportOf, reportToJson, reportToMarkdown,
  STYLE_METRIC_DEFS, STYLE_UNMEASURABLE, type BaseWorld, type StyleInput, type StyleMeasurement,
} from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function measured(type: string, theme: string, seed: number): { input: StyleInput; world: BaseWorld } {
  const res = projectFromBuildingType(ctx.buildingTypes.get(type), { size: 'M', themeId: theme }, seed, ctx);
  const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
  const roomTypes: Record<string, string> = {};
  for (const r of res.project.state.rooms) if (r.roomTypeId !== undefined) roomTypes[r.id] = r.roomTypeId;
  const input: StyleInput = {
    id: `${type}/${theme}/${seed}`, buildingType: type, themeId: theme, seed, shell: world.shell, volume: world.materialized.volume, roomTypes,
    placements: res.project.state.placements.map((p) => ({ id: p.id, componentId: p.componentId, roomId: p.roomId, pose: { pos: p.pose.pos } })),
    light: { darkCells: world.materialized.light.darkCells, walkableCells: world.materialized.light.walkableCells },
  };
  return { input, world };
}

describe('Ampel-Regel', () => {
  const t = { min: 0.25, slack: 0.1, text: '>= 0,25', origin: 'plan' } as const;
  it('grün im Zielbereich, gelb innerhalb der Toleranz, sonst rot, ohne Wert na', () => {
    expect(judgeMetric(0.25, t)).toBe('green');
    expect(judgeMetric(0.4, t)).toBe('green');
    expect(judgeMetric(0.2, t)).toBe('yellow');
    expect(judgeMetric(0.1, t)).toBe('red');
    expect(judgeMetric(null, t)).toBe('na');
  });
  it('zweiseitiger Bereich', () => {
    const b = { min: 0.45, max: 0.6, slack: 0.1, text: '0,45 bis 0,60', origin: 'plan' } as const;
    expect(judgeMetric(0.5, b)).toBe('green');
    expect(judgeMetric(0.65, b)).toBe('yellow');
    expect(judgeMetric(0.8, b)).toBe('red');
  });
});

describe('Kennzahl-Tabelle', () => {
  it('jede Regel LV-1…LV-23 kommt vor, alle Kennzahlen haben Ziel, Notiz und eindeutige Kennung', () => {
    const ids = STYLE_METRIC_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const rules = new Set(STYLE_METRIC_DEFS.map((d) => d.rule));
    for (let i = 1; i <= 23; i++) expect(rules.has(`LV-${i}`)).toBe(true);
    for (const d of STYLE_METRIC_DEFS) { expect(d.note.length).toBeGreaterThan(0); expect(d.target.min !== undefined || d.target.max !== undefined).toBe(true); }
    expect(STYLE_UNMEASURABLE.map((u) => u.rule)).toEqual(['KM2', 'KM7', 'KM8', 'KM9']);
  });
});

describe('Bericht', () => {
  const fake = (id: string, v: number, w: number): StyleMeasurement => ({ id, label: id, buildings: 1, summaries: [], measures: { 'LV-1a': { value: v, weight: w } } });
  it('gewichtetes Mittel, Ampel, Zähler', () => {
    const r = reportOf([fake('a', 0.1, 1), fake('b', 0.5, 3)], 'T');
    const m = r.metrics.find((x) => x.id === 'LV-1a')!;
    expect(m.value).toBeCloseTo(0.4, 6);
    expect(m.light).toBe('green');
    expect(r.counts.green + r.counts.yellow + r.counts.red + r.counts.na).toBe(STYLE_METRIC_DEFS.length);
    expect(r.metrics.find((x) => x.id === 'LV-2')!.light).toBe('na');
  });
  it('JSON ist stabil, Markdown enthält Ampelwörter und Zahlen mit Komma', () => {
    const r = reportOf([fake('a', 0.1, 1)], 'T');
    expect(reportToJson(r)).toBe(reportToJson(reportOf([fake('a', 0.1, 1)], 'T')));
    expect(JSON.parse(reportToJson(r)).title).toBe('T');
    const md = reportToMarkdown(r);
    expect(md).toContain('| rot | LV-1a |');
    expect(md).toContain('0,1');
    expect(md).toContain('Nicht messbar: KM2');
  });
  it('Ensemble braucht mindestens vier Bauten für LV-13b/c', () => {
    const e = measureEnsemble('dorf', [fake('a', 0.1, 1)]);
    expect(e.measures['LV-13b']?.value ?? null).toBeNull();
  });
});

describe('Messung an einem erzeugten Haus', () => {
  const { input, world } = measured('house', 'medieval', 1);
  const a = measureStyle(input);

  it('ist deterministisch und verändert das Volumen nicht', () => {
    const before = JSON.stringify(world.materialized.volume.stateAt([0, 0, 0]));
    const b = measureStyle(input);
    expect(JSON.stringify(b.measures)).toBe(JSON.stringify(a.measures));
    expect(JSON.stringify(world.materialized.volume.stateAt([0, 0, 0]))).toBe(before);
  });

  it('erkennt einen Baukörper und liefert Werte im gültigen Bereich', () => {
    expect(a.buildings).toBe(1);
    for (const key of ['LV-1a', 'LV-1b', 'LV-6a', 'LV-11', 'LV-22b', 'KM1']) {
      const v = a.measures[key]?.value;
      expect(v, key).not.toBeNull();
      expect(v as number).toBeGreaterThanOrEqual(0);
    }
    for (const key of ['LV-1a', 'LV-1b', 'LV-6a', 'LV-11', 'KM1']) expect(a.measures[key]!.value as number).toBeLessThanOrEqual(1);
  });

  it('LV-11 stimmt mit dem Nicht-Vollblock-Anteil F2 der Fassaden-Kennzahlen überein', () => {
    const f2 = facadeQuality(world.shell, world.materialized.volume, world.exterior).f2;
    expect(Math.abs((a.measures['LV-11']!.value as number) - f2)).toBeLessThan(0.15);
  });
});
