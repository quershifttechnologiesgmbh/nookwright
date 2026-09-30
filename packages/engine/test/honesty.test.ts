/**
 * W7-E „Ehrlichkeit im Engine-Weg“ (offene Punkte aus plan/spikes/W1G_treue.md §8):
 * - `building_generate`/`project_create` melden eine Lage, die die Domäne nicht baut (`settingBuildable`), in `notes`
 *   statt still ebenerdig zu bauen;
 * - ohne Theme baut die Engine bei Bautypen ohne eigenes Theme `medieval` (wie ein neues Projekt der App), nicht das
 *   erste Theme des Katalogs (`desert`);
 * - `building_propose` liefert verschiedene Grundrisse (`planLayoutKey`/`distinctPicks`, wie der App-Assistent).
 */
import { describe, expect, it } from 'vitest';
import { planBuilding } from '@mcda/archetype';
import { hashSeed } from '@mcda/core';
import { BUILDABLE_SETTINGS, FALLBACK_THEME_ID, archetypeContext, planLayoutKey, settingNote } from '@mcda/pipeline';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { interpret } from '../src/node/index.js';
import { SETTING_KINDS } from '../src/vocabulary.js';
import { ctx, engine } from './fixture.js';

type Data = Record<string, unknown> & { notes?: string[]; themeId?: string };
const run = (op: string, input: Record<string, unknown>): Data => {
  const r = engine.execute({ op, input });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.data as Data;
};
const unbuildable = (notes: readonly string[] | undefined): string[] => (notes ?? []).filter((n) => n.includes('noch nicht baubar'));

describe('nicht baubare Lagen werden gemeldet', () => {
  it('Hinweistext je Lage: genau die nicht baubaren', () => {
    for (const kind of SETTING_KINDS) {
      const note = settingNote(kind);
      if (BUILDABLE_SETTINGS.has(kind)) expect(note, kind).toBeUndefined();
      else expect(note, kind).toMatch(new RegExp(`\\(${kind}\\) ist noch nicht baubar – ebenerdig gebaut`));
    }
    expect(settingNote(undefined)).toBeUndefined();
  });

  it('building_generate: Stelzen → Hinweis, im Hügel und ohne Lage → keiner', () => {
    const stilts = run('building_generate', { buildingTypeId: 'house', setting: { kind: 'stilts' }, surroundings: false });
    expect(unbuildable(stilts.notes)).toEqual(['Lage „auf Stelzen“ (stilts) ist noch nicht baubar – ebenerdig gebaut']);
    const buried = run('building_generate', { buildingTypeId: 'house', setting: { kind: 'buried' }, surroundings: false });
    expect(unbuildable(buried.notes)).toEqual([]);
    const plain = run('building_generate', { buildingTypeId: 'house', surroundings: false });
    expect(unbuildable(plain.notes)).toEqual([]);
  }, HEAVY_TIMEOUT);

  it('project_create mit Bautyp: Hinweise im Ergebnis (am Hang)', () => {
    const d = run('project_create', { buildingType: { buildingTypeId: 'watchtower', size: 'S', setting: { kind: 'cliff' } }, surroundings: false });
    expect(unbuildable(d.notes)).toEqual(['Lage „am Hang“ (cliff) ist noch nicht baubar – ebenerdig gebaut']);
    const empty = run('project_create', {});
    expect(empty.notes).toBeUndefined();
  });

  it('Engine-Weg: Beschreibung → interpret (lokal) → building_generate nennt die Lage', async () => {
    const it = await interpret('Pfahlbau am See', engine, { apiKey: '', model: 'local', mode: 'local' });
    expect(it.request.input).toMatchObject({ setting: { kind: 'stilts' } });
    const r = engine.execute({ op: it.request.op, input: { ...(it.request.input as object), surroundings: false } });
    expect(r.ok && unbuildable((r.data as Data).notes).length).toBe(1);
  }, HEAVY_TIMEOUT);
});

describe('Theme ohne Angabe', () => {
  it(`Bautypen ohne eigenes Theme bauen ${FALLBACK_THEME_ID}, andere ihr erstes Theme`, () => {
    for (const id of ['house', 'hall', 'twostory']) {
      expect(ctx.buildingTypes.get(id).themes ?? [], id).toEqual([]);
      expect(run('project_create', { buildingType: { buildingTypeId: id }, surroundings: false }).themeId, id).toBe(FALLBACK_THEME_ID);
    }
    expect(run('project_create', { buildingType: { buildingTypeId: 'longhouse' }, surroundings: false }).themeId).toBe('nordic');
    expect(run('project_create', { buildingType: { buildingTypeId: 'longhouse' }, themeId: 'winter', surroundings: false }).themeId).toBe('winter');
    expect(run('project_create', {}).themeId).toBe(FALLBACK_THEME_ID);
    expect(run('building_generate', { buildingTypeId: 'house', surroundings: false }).themeId).toBe(FALLBACK_THEME_ID);
  }, HEAVY_TIMEOUT);
});

describe('building_propose ohne doppelte Grundrisse', () => {
  const arch = archetypeContext(ctx.catalog, ctx.themes);
  const layout = (typeId: string, size: string, seed: number): string =>
    planLayoutKey(planBuilding(ctx.buildingTypes.get(typeId), { size: size as 'S', reroll: 0 }, seed, arch));

  it('Langhaus S und Wachturm S: weniger Runden mit Doppeln als vorher; ohne Doppel dieselben Vorschläge', () => {
    for (const [typeId, size] of [['longhouse', 'S'], ['watchtower', 'S']] as const) {
      let before = 0;
      let after = 0;
      for (let base = 1; base <= 12; base++) {
        const old = [0, 1, 2].map((n) => hashSeed(base, 'vorschlag', n) % 2 ** 31);
        const oldKeys = old.map((s) => layout(typeId, size, s));
        const oldDup = new Set(oldKeys).size < 3;
        if (oldDup) before++;
        const d = run('building_propose', { buildingTypeId: typeId, size, seed: base, count: 3 }) as { proposals: { seed: number }[]; distinct: number };
        expect(d.proposals).toHaveLength(3);
        const keys = d.proposals.map((p) => layout(typeId, size, p.seed));
        expect(d.distinct).toBe(new Set(keys).size);
        if (d.distinct < 3) after++;
        if (!oldDup) expect(d.proposals.map((p) => p.seed), `${typeId} ${base}`).toEqual(old);
      }
      expect(before, typeId).toBeGreaterThan(0);
      expect(after, typeId).toBeLessThan(before);
    }
  }, HEAVY_TIMEOUT);
});
