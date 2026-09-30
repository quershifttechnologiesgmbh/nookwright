/**
 * W7-E: Trefferquote der Erkennung auf dem Testsatz „Beschreibung → Soll“ (`scripts/nl-cases/descriptions.ts`,
 * 50 Beschreibungen + 25 im Kontrollsatz). Gemessen am Engine-Weg ohne Modell (`interpret` im Modus `local` =
 * lokaler Klassifikator samt Bautyp-Sicherheit, wie `/v1/interpret` sie ausliefert); das Theme ist das, das die Engine
 * baut. Die Untergrenzen halten die erreichte Qualität fest (Stand und Ausgangswerte: plan/spikes/W7E_ki.md §1).
 * Tabelle je Beschreibung in eine Datei: `DESCRIPTIONS_REPORT=/pfad/tabelle.md npx vitest run packages/engine/test/descriptions.test.ts`.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_THEME_ID } from '@mcda/pipeline';
import { TYPE_CONFIDENCE_MIN } from '../src/intent/local.js';
import { interpret } from '../src/node/index.js';
import {
  ASK, DESCRIPTIONS, DESCRIPTIONS_HOLDOUT, DESCRIPTION_FIELDS, builtTheme, guessOf, scoreDescriptions, scoreSummary,
  type DescriptionCase, type DescriptionField, type DescriptionGuess,
} from '../scripts/nl-cases/descriptions.js';
import { ctx, engine } from './fixture.js';

const v = engine.vocabulary;
const themeIds = ctx.themes.ids();
const report = process.env['DESCRIPTIONS_REPORT'];
if (report !== undefined && report !== '') writeFileSync(report, '');

async function measure(name: string, cases: readonly DescriptionCase[]) {
  const guesses = new Map<string, DescriptionGuess>();
  for (const c of cases) {
    const it = await interpret(c.text, engine, { apiKey: '', model: 'local', mode: 'local' });
    expect(engine.validate(it.request), c.text).toEqual([]);
    const input = it.request.input as Record<string, unknown>;
    guesses.set(c.text, guessOf(input, it.confidence?.['buildingTypeId'], TYPE_CONFIDENCE_MIN, builtTheme(input, v, FALLBACK_THEME_ID)));
  }
  const s = scoreDescriptions(cases, (c) => guesses.get(c.text)!);
  if (report !== undefined && report !== '') appendFileSync(report, `## ${name}\n\n${s.rows.join('\n')}\n\n${scoreSummary(s, cases.length)}\n\n`);
  return s;
}

function expectAtLeast(s: Awaited<ReturnType<typeof measure>>, min: Record<DescriptionField, number>, all: number): void {
  for (const f of DESCRIPTION_FIELDS) expect(s.hits[f][0], `${f}: ${s.hits[f][0]}/${s.hits[f][1]}`).toBeGreaterThanOrEqual(min[f]);
  expect(s.all).toBeGreaterThanOrEqual(all);
}

describe('Testsatz Beschreibung → Soll (W7-E)', () => {
  it('50 + 25 Beschreibungen, jede Gruppe vertreten, Soll nur mit Werten des Vokabulars', () => {
    expect(DESCRIPTIONS).toHaveLength(50);
    expect(DESCRIPTIONS_HOLDOUT).toHaveLength(25);
    expect(new Set([...DESCRIPTIONS, ...DESCRIPTIONS_HOLDOUT].map((c) => c.text)).size).toBe(75);
    for (const k of ['konkret', 'vage', 'stimmung', 'unsinn'] as const) expect(DESCRIPTIONS.some((c) => c.kind === k)).toBe(true);
    const types = new Set([...v.buildingTypes.filter((b) => !b.draft).map((b) => b.id), ASK]);
    for (const c of [...DESCRIPTIONS, ...DESCRIPTIONS_HOLDOUT]) {
      for (const t of c.type) expect(types.has(t), `${c.text}: ${t}`).toBe(true);
      for (const t of c.theme ?? []) expect(themeIds.includes(t), `${c.text}: ${t}`).toBe(true);
    }
  });

  // Vorher (w1/eine-app, 27.09.): type 44/50 · theme 19/27 · size 5/5 · roof 8/8 · setting 3/7 · floors 2/3 · story 0/2 · alle 33/50
  it('Hauptsatz: Trefferquote je Feld über dem festgeschriebenen Stand; jede Anfrage schema-gültig', async () => {
    const s = await measure('Hauptsatz', DESCRIPTIONS);
    expectAtLeast(s, { type: 50, theme: 27, size: 5, roof: 8, setting: 7, floors: 3, story: 2 }, 50);
  });

  // Vorher: type 23/25 · theme 7/14 · size 3/3 · roof 3/3 · setting 0/2 · floors 2/2 · story 0/2 · alle 14/25
  it('Kontrollsatz (nicht daran optimiert): Untergrenze', async () => {
    const s = await measure('Kontrollsatz', DESCRIPTIONS_HOLDOUT);
    expectAtLeast(s, { type: 24, theme: 12, size: 3, roof: 3, setting: 2, floors: 2, story: 2 }, 22);
  });
});
