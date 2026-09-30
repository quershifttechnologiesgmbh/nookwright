/**
 * W7-L: Engine-Weg mit JEV ohne Netz. Die Antworten sind live aufgezeichnet (`test/fixtures/jev-descriptions.json`,
 * 75 Beschreibungen × 3 Wiederholungen, Fragen-Stand W8-D (Fantasy-Kit ohne Materialwort; die spätere Umbenennung Hobbit → „Erdhaus“ im Bautyp-Optionstext ist noch nicht neu aufgenommen, siehe plan/spikes/W8D_editor_fixes.md), neu aufnehmen mit `scripts/nl-fixture.ts`) und laufen über
 * `interpret()` wie bei `/v1/interpret`: Schwelle, Kombination mit dem lokalen Klassifikator, Schema-Prüfung,
 * Bautyp-Sicherheit. Bewertung wie `descriptions.test.ts`. Ziel: JEV + lokal ist in keinem Feld schlechter als lokal.
 * Messung und Tabellen: `plan/spikes/W7L_jev_live.md`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@mcda/classify';
import { FALLBACK_THEME_ID } from '@mcda/pipeline';
import type { CombineMode, DecisionAnswer } from '../src/intent/decisions.js';
import { TYPE_CONFIDENCE_MIN } from '../src/intent/local.js';
import { DEFAULT_MODEL, interpret } from '../src/node/index.js';
import {
  DESCRIPTIONS, DESCRIPTIONS_HOLDOUT, DESCRIPTION_FIELDS, builtTheme, guessOf, scoreDescriptions,
  type DescriptionCase, type DescriptionField,
} from '../scripts/nl-cases/descriptions.js';
import { engine } from './fixture.js';

type Answers = Record<string, DecisionAnswer>;
const RECORDED = JSON.parse(readFileSync(new URL('./fixtures/jev-descriptions.json', import.meta.url), 'utf8')) as Record<string, Answers[]>;
const REPS = 3;
const replay = (answers: Answers): FetchLike => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ model: DEFAULT_MODEL, answers }) });

async function measure(cases: readonly DescriptionCase[], way: CombineMode | 'local') {
  const hits = Object.fromEntries(DESCRIPTION_FIELDS.map((f) => [f, [0, 0]])) as Record<DescriptionField, [number, number]>;
  let all = 0;
  let fallback = 0;
  const inputs = new Map<string, Array<Record<string, unknown>>>();
  for (const c of cases) {
    for (let rep = 0; rep < REPS; rep++) {
      const it = await interpret(c.text, engine, way === 'local'
        ? { apiKey: '', model: 'local', mode: 'local' }
        : { apiKey: 'replay', model: DEFAULT_MODEL, mode: 'decisions', fetch: replay(RECORDED[c.text]![rep]!), retries: 0, combine: way });
      expect(engine.validate(it.request), c.text).toEqual([]);
      if (it.fallback !== undefined) fallback++;
      const input = it.request.input as Record<string, unknown>;
      (inputs.get(c.text) ?? inputs.set(c.text, []).get(c.text)!).push(input);
      const g = guessOf(input, it.confidence?.['buildingTypeId'], TYPE_CONFIDENCE_MIN, builtTheme(input, engine.vocabulary, FALLBACK_THEME_ID));
      const s = scoreDescriptions([c], () => g);
      for (const f of DESCRIPTION_FIELDS) { hits[f][0] += s.hits[f][0]; hits[f][1] += s.hits[f][1]; }
      all += s.all;
    }
  }
  return { hits, all, fallback, inputs };
}

describe('JEV-Wiedergabe (W7-L): Engine-Weg mit aufgezeichneten Antworten', () => {
  it('Fixture deckt beide Beschreibungssätze mit 3 Wiederholungen ab', () => {
    for (const c of [...DESCRIPTIONS, ...DESCRIPTIONS_HOLDOUT]) expect(RECORDED[c.text], c.text).toHaveLength(REPS);
  });

  it.each([
    ['Hauptsatz', DESCRIPTIONS],
    ['Kontrollsatz', DESCRIPTIONS_HOLDOUT],
  ] as const)('%s: JEV + lokal (Standard local-first und fill) in keinem Feld schlechter als lokal', async (_name, cases) => {
    const local = await measure(cases, 'local');
    for (const way of ['local-first', 'fill'] as const) {
      const jev = await measure(cases, way);
      expect(jev.fallback, way).toBe(0);
      for (const f of DESCRIPTION_FIELDS) expect(jev.hits[f][0], `${way} ${f}`).toBeGreaterThanOrEqual(local.hits[f][0]);
      expect(jev.all, way).toBeGreaterThanOrEqual(local.all);
    }
  });

  it('Entwurf nie gewählt („Reihenhäuser“ → Stadthaus), Stimmung wirkt („düstere Burg“ → ruin)', async () => {
    const cases = DESCRIPTIONS.filter((c) => /^(Reihenhäuser für|düstere Burg)/.test(c.text));
    expect(cases).toHaveLength(2);
    const { inputs } = await measure(cases, 'local-first');
    for (const input of inputs.get('Reihenhäuser für eine Stadtstraße, mittelgroß')!) expect(input['buildingTypeId']).not.toBe('townhouse_row');
    for (const input of inputs.get('düstere Burg auf einem Felsen')!) expect(input['themeId']).toBe('ruin');
  });
});
