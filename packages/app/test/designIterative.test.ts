/**
 * F-JEV-iterativ in der App: „Planen & verbessern“ nur mit Schalter des Servers (`iterate` in `/v1/interpret`),
 * `design_iterate` über `/v1/execute`, Verlauf und Nebenteile in Worten. Ohne Netz: `fetch` ist eine Attrappe.
 */
import { describe, expect, it } from 'vitest';
import { vocabularyOf } from '@mcda/engine/intent';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import { describeBuilding, designExtras, designHistory, designIterative } from '../src/nlPrompt.js';

const load = loadBundledCatalog();
const ctx = { catalog: load.catalog!, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types: load.buildingTypes };
const vocabulary = vocabularyOf({ ...ctx, buildingTypes: load.buildingTypes } as unknown as Parameters<typeof vocabularyOf>[0]);

type Call = { url: string; body: unknown };
const server = (status: number, body: unknown, calls: Call[] = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

const ROUNDS = [
  { n: 1, phase: 'plan', source: 'model', changes: ['Hauptgebäude castle_compact'], ms: 900 },
  { n: 2, phase: 'plan', source: 'model', changes: ['Nutzungen: tavern, smithy'] },
  { n: 3, phase: 'critic', source: 'model', changes: ['Nebenteile weiter weg (+4, tower)'], score: 0.81 },
  { n: 4, phase: 'critic', source: 'local', changes: ['fertig'], score: 0.9 },
];

describe('Planen & verbessern', () => {
  it('Schalter des Servers: iterate nur, wenn der Server es meldet', async () => {
    const req = { op: 'building_generate', input: { buildingTypeId: 'tavern' } };
    const on = await describeBuilding('Taverne', { baseUrl: '/engine', vocabulary, fetch: server(200, { ok: true, request: req, model: 'typesafe/jev-1.13', iterate: true }) });
    const off = await describeBuilding('Taverne', { baseUrl: '/engine', vocabulary, fetch: server(200, { ok: true, request: req, model: 'typesafe/jev-1.13' }) });
    expect(on.iterate).toBe(true);
    expect(off.iterate).toBeUndefined();
  });

  it('design_iterate über /v1/execute: Vorschlag, Verlauf, Nebenteile', async () => {
    const calls: Call[] = [];
    const out = await designIterative('Burg mit Taverne, Schmiede und Wachturm', {
      baseUrl: '/engine', vocabulary,
      fetch: server(200, {
        ok: true, op: 'design_iterate',
        data: {
          model: 'typesafe/jev-1.13', score: 0.9, request: { op: 'building_generate', input: { buildingTypeId: 'castle_compact', ensemble: true } },
          plan: { parts: { towers: 1, wall: 'fortress', windmill: false, silo: false, bridge: true }, rooms: ['tavern', 'smithy'] }, rounds: ROUNDS,
        },
      }, calls),
    });
    expect(calls[0]).toEqual({ url: '/engine/v1/execute', body: { op: 'design_iterate', input: { prompt: 'Burg mit Taverne, Schmiede und Wachturm' } } });
    expect(out.interpretation).toMatchObject({ source: 'server', model: 'typesafe/jev-1.13', request: { input: { buildingTypeId: 'castle_compact' } } });
    expect(out.score).toBe(0.9);
    expect(out.extras).toEqual(['Wehrmauer', '1 Turm', 'Brücke', 'Taverne', 'Schmiede']);
    expect(designHistory(out.rounds)).toEqual([
      'Runde 1 · Planen (JEV) · Hauptgebäude castle_compact',
      'Runde 2 · Planen (JEV) · Nutzungen: tavern, smithy',
      'Runde 3 · Prüfen (JEV) · Punktzahl 0,81 · Nebenteile weiter weg (+4, tower)',
      'Runde 4 · Prüfen (lokal) · Punktzahl 0,90 · fertig',
    ]);
  });

  it('Fehler des Servers → Fehler mit Hinweis (kein stiller Rückfall)', async () => {
    await expect(designIterative('Burg', { baseUrl: '/engine', vocabulary, fetch: server(429, { ok: false, errors: ['Rate-Limit'] }) })).rejects.toThrow(/ausgelastet.*429/);
    expect(designExtras({}, vocabulary)).toEqual([]);
  });
});
