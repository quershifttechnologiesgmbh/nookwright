/**
 * F-JEV-iterativ (`plan/spikes/F_jev_iterativ.md`): Planer und Kritiker in einer Schleife – offline. Lokaler Planer,
 * Umsetzung über vorhandene Operationen (Rezept wiederholbar, ohne Teile gleich `building_generate`),
 * `project_structures` mit `mode: "append"`, reine Operation `design_iterate` (deterministisch), Schleife mit
 * Attrappe des Modells (Anfrage-Form über den echten Transport, Kritiker löst Änderung aus, Budget, Fehler →
 * lokaler Rückfall), Schalter aus = reine Operation. Kein Netz, kein Schlüssel.
 */
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { DESIGN_ITERATE, localDesign, memorySessions, partsStructures, realize, requirementsOf } from '../src/index.js';
import { NL_EXECUTE_OPS } from '../src/node/server.js';
import { DEFAULT_MODEL, ITERATE_DEFAULT, engineServer, executeDesignIterate, interpretOptionsFromEnv, iterateOptionsFromEnv, type InterpretOptions } from '../src/node/index.js';
import { engine } from './fixture.js';

type Q = { type: string; instructions: string; criteria?: unknown };
type Body = { model: string; state: Record<string, unknown>; questions: Record<string, Q> };

/** Attrappe des Modells: beantwortet jede Frage über `answer` (sonst „nicht angegeben“ bzw. nein/Mitte). */
function mockJev(answer: (key: string, q: Q, body: Body, call: number) => unknown, seen: Body[] = []): typeof fetch {
  return (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    seen.push(body);
    const answers: Record<string, unknown> = {};
    for (const [k, q] of Object.entries(body.questions)) {
      const a = answer(k, q, body, seen.length);
      answers[k] = a ?? (q.type === 'noul' ? { type: 'noul', noul: 0.05 }
        : q.type === 'score' ? { type: 'score', score: 2, confidence: 0.9, probabilities: { 2: 0.9 } }
          : { type: 'choice', choice: 'not_specified', confidence: 0.9, probabilities: { not_specified: 0.9 } });
    }
    return new Response(JSON.stringify({ model: 'typesafe/jev-1.13-test', answers, usage: { input_tokens: 100, output_tokens: 10, cost: 0.0001 } }), { status: 200 });
  }) as typeof fetch;
}
const choice = (c: string) => ({ type: 'choice', choice: c, confidence: 0.95, probabilities: { [c]: 0.95 } });
const noul = (p: number) => ({ type: 'noul', noul: p });
const opts = (f: typeof fetch, extra: Partial<InterpretOptions> = {}): InterpretOptions => ({
  apiKey: 'k', model: DEFAULT_MODEL, mode: 'decisions', fetch: f, retries: 0, iterate: { enabled: true, maxCalls: 8, timeoutMs: 60_000 }, ...extra,
});
type Data = {
  score: number; model: string; fallback?: string; calls: { model: number; local: number }; cost: number;
  request: { op: string; input: Record<string, unknown> }; plan: { parts: Record<string, unknown>; rooms: string[] };
  recipe: Array<{ op: string; input: Record<string, unknown> }>; summary: Record<string, unknown>;
  rounds: Array<{ phase: string; source: string; score?: number; changes: string[]; error?: string }>; world: { blocks: number; size: number[] };
};

const PROMPT = 'kleines Haus mit Windmühle und Gartenmauer';

describe('lokaler Planer', () => {
  it('zerlegt die Burg-Bitte: Hauptgebäude zuerst genannt, Turm als Nebenteil, weitere Nutzungen, Brücke', () => {
    const d = localDesign('Burg auf dem Hügel mit Taverne, Schmiede und Mauer, Brücke zum Wachturm', engine.vocabulary);
    expect(d.mainType).toBe('castle_compact');
    expect(d.parts).toMatchObject({ towers: 1, bridge: true, wall: 'fortress', windmill: false });
    expect(d.rooms).toEqual(['tavern', 'smithy']);
  });
  it('englisch, Anzahl, Stimmung, Verneinung', () => {
    const d = localDesign('a cozy farmhouse with two towers, a windmill and a silo, not ruined', engine.vocabulary);
    expect(d.mainType).toBe('farmhouse');
    expect(d.parts).toMatchObject({ towers: 2, windmill: true, silo: true });
    expect(d.mood).toEqual({ formality: -1 });
  });
});

describe('Umsetzung über vorhandene Operationen', () => {
  it('ohne Teile gleich building_generate (keine Parallelarchitektur); Rezept in frischem Speicher wiederholbar', () => {
    const base = { buildingTypeId: 'house', size: 'S', seed: 4 };
    const w = realize(engine, { base, parts: { towers: 0, windmill: false, silo: false, bridge: false, shift: 0 }, rooms: [], asked: [] });
    const direct = engine.execute({ op: 'building_generate', input: base });
    expect(direct.ok).toBe(true);
    const a = w.result.data as { blocks: number; size: number[] };
    const b = (direct as unknown as { data: { blocks: number; size: number[] } }).data;
    expect([a.blocks, a.size]).toEqual([b.blocks, b.size]);
    expect(w.recipe.map((r) => r.op)).toEqual(['project_create', 'project_generate']);
    const sessions = memorySessions();
    let last: unknown;
    for (const r of w.recipe) { const x = engine.execute(r, { sessions }); expect(x.ok).toBe(true); last = x; }
    expect((last as { data: { blocks: number } }).data.blocks).toBe(a.blocks);
  });

  it('project_structures append behält die Bauwerke des Bautyps und ergänzt', () => {
    const sessions = memorySessions();
    const c = engine.execute({ op: 'project_create', input: { buildingType: { buildingTypeId: 'castle_compact', size: 'S' } } }, { sessions });
    expect(c.ok).toBe(true);
    const walls = sessions.get('p1')!.structures?.walls?.length ?? 0;
    expect(walls).toBeGreaterThan(0);
    const r = engine.execute({ op: 'project_structures', input: { projectId: 'p1', mode: 'append', structures: { towers: [{ center: [60, 5] }] } } }, { sessions });
    expect(r.ok).toBe(true);
    expect(sessions.get('p1')!.structures?.walls?.length).toBe(walls);
    expect(sessions.get('p1')!.structures?.towers?.map((t) => t.id)).toEqual(['tower1']);
    // Standard bleibt „ersetzen“
    engine.execute({ op: 'project_structures', input: { projectId: 'p1', structures: { towers: [{ center: [60, 5] }] } } }, { sessions });
    expect(sessions.get('p1')!.structures?.walls).toBeUndefined();
  });

  it('Nebenteile liegen außerhalb von Haus und Mauer, Tür zum Haus', () => {
    const s = partsStructures({ towers: 2, windmill: true, silo: false, bridge: false, shift: 0, wall: 'garden' }, { minX: 0, minZ: 0, maxX: 10, maxZ: 8 }, 'south', undefined)!;
    expect(s['walls']).toHaveLength(1);
    const towers = s['towers'] as Array<{ center: [number, number]; door: string }>;
    expect(towers.map((t) => t.door)).toEqual(['west', 'east']);
    expect(towers[0]!.center[0]).toBeGreaterThan(10 + 6);
    expect(towers[1]!.center[0]).toBeLessThan(-6);
    expect((s['windmills'] as Array<{ center: [number, number] }>)[0]!.center[1]).toBeLessThan(-6);
  });
});

describe('design_iterate (rein, lokal)', () => {
  it('deterministisch, erfüllt die Anforderungen der Bitte, Protokoll je Runde', () => {
    const a = engine.execute({ op: DESIGN_ITERATE, input: { prompt: PROMPT, seed: 2 } });
    const b = engine.execute({ op: DESIGN_ITERATE, input: { prompt: PROMPT, seed: 2 } });
    expect(a.ok && b.ok).toBe(true);
    const d = (a as unknown as { data: Data }).data;
    expect(JSON.stringify(d)).toBe(JSON.stringify((b as unknown as { data: Data }).data));
    expect(d.model).toBe('local');
    expect(d.plan.parts).toMatchObject({ windmill: true, wall: 'garden' });
    expect(d.summary).toMatchObject({ bautypId: 'house', bauwerke: { mauern: 1, windmuehlen: 1 } });
    expect(d.rounds.map((r) => r.phase)).toEqual(['plan', 'plan', 'critic']);
    expect(d.score).toBeGreaterThan(0.9);
    expect(d.calls).toEqual({ model: 0, local: 3 });
    expect(d.recipe.map((r) => r.op)).toEqual(['project_create', 'project_structures', 'project_generate']);
    expect((a as { artifacts?: { export?: unknown } }).artifacts?.export).toBeDefined();
  });
});

describe('Schleife mit Modell (Attrappe)', () => {
  it('Schalter aus (Standard): reine Operation, kein Aufruf', async () => {
    expect(ITERATE_DEFAULT).toBe(false);
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'k' }).iterate).toBeUndefined();
    expect(iterateOptionsFromEnv({}).enabled).toBe(false);
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'k', ENGINE_NL_ITERATE: '1', ENGINE_NL_ITERATE_MAX_CALLS: '3' }).iterate)
      .toEqual({ enabled: true, maxCalls: 3, timeoutMs: 90_000 });
    const seen: Body[] = [];
    const off = await executeDesignIterate(engine, { prompt: PROMPT, seed: 2 }, opts(mockJev(() => undefined, seen), { iterate: { enabled: false, maxCalls: 8, timeoutMs: 1000 } }));
    expect(seen).toHaveLength(0);
    expect(off.ok).toBe(true);
    const pure = engine.execute({ op: DESIGN_ITERATE, input: { prompt: PROMPT, seed: 2 } });
    expect(JSON.stringify((off as { data?: unknown }).data)).toBe(JSON.stringify((pure as { data?: unknown }).data));
  });

  it('Planer findet, was die Schlüsselwörter nicht finden; Kritiker löst eine Änderung aus; Anfrage-Form', async () => {
    const seen: Body[] = [];
    // „Spähposten“ kennt der lokale Planer nicht – das Modell erkennt den Turm; der Kritiker verneint ihn in Runde 1
    const f = mockJev((k, _q, body) => {
      if (k === 'design.main') return choice('house');
      if (k === 'design.towers') return choice('1');
      if (k === 'crit.overall') return { type: 'score', score: 3, confidence: 0.9, probabilities: {} };
      if (k === 'req.tower') return noul(body.state['welt'] !== undefined && seen.filter((b) => 'welt' in b.state).length >= 2 ? 0.9 : 0.1);
      if (k.startsWith('req.')) return noul(0.95);
      if (k === 'crit.missing') return choice('nothing');
      return undefined;
    }, seen);
    const r = await executeDesignIterate(engine, { prompt: 'kleines Haus mit Spähposten', seed: 2 }, opts(f));
    expect(r.ok).toBe(true);
    const d = (r as unknown as { data: Data }).data;
    expect(d.model).toBe(DEFAULT_MODEL);
    expect(d.plan.parts).toMatchObject({ towers: 1 });
    expect(d.summary).toMatchObject({ bauwerke: { freistehendeTuerme: 1 } });
    const critic = d.rounds.filter((x) => x.phase === 'critic');
    expect(critic).toHaveLength(2);
    expect(critic[0]!.changes.join()).toMatch(/Nebenteile weiter weg/);
    expect(critic[1]!.score!).toBeGreaterThan(critic[0]!.score!);
    expect(d.calls).toEqual({ model: 4, local: 0 });
    expect(d.cost).toBeCloseTo(0.0004, 6);
    // Runde 1: Einmal-Fragen + Zerlegung; Runde 2 sieht Runde 1 im state; Kritiker sieht die Welt
    expect(Object.keys(seen[0]!.questions)).toEqual(expect.arrayContaining(['buildingTypeId', 'design.main', 'design.towers']));
    expect(seen[1]!.state['erkannt']).toMatchObject({ teile: { towers: 1 } });
    expect(seen[2]!.state['welt']).toMatchObject({ bauwerke: { freistehendeTuerme: 1 } });
    expect(seen.every((b) => b.model === DEFAULT_MODEL)).toBe(true);
  });

  it('Budget: nach maxCalls lokal weiter; Fehler → lokaler Rückfall mit Grund; ohne Rückfall Fehler', async () => {
    const seen: Body[] = [];
    const r = await executeDesignIterate(engine, { prompt: PROMPT, seed: 2 }, opts(mockJev(() => undefined, seen), { iterate: { enabled: true, maxCalls: 1, timeoutMs: 60_000 } }));
    const d = (r as unknown as { data: Data }).data;
    expect(seen).toHaveLength(1);
    expect(d.calls.model).toBe(1);
    expect(d.rounds.slice(1).every((x) => x.source === 'local')).toBe(true);

    const broken = (async () => new Response('{"error":{"message":"boom"}}', { status: 500 })) as unknown as typeof fetch;
    const e = await executeDesignIterate(engine, { prompt: PROMPT, seed: 2 }, opts(broken));
    expect(e.ok).toBe(true);
    const ed = (e as unknown as { data: Data }).data;
    expect(ed.model).toBe('local');
    expect(ed.fallback).toMatch(/500/);
    expect(ed.summary).toMatchObject({ bauwerke: { mauern: 1, windmuehlen: 1 } });
    const strict = await executeDesignIterate(engine, { prompt: PROMPT, seed: 2 }, opts(broken, { fallback: false }));
    expect(strict.ok).toBe(false);
  });

  it('Anforderungen nur aus dem, was die Bitte nennt', () => {
    const reqs = requirementsOf({
      base: { buildingTypeId: 'tavern', size: 'S', mood: { formality: -1 } }, asked: ['buildingTypeId', 'size', 'mood'],
      parts: { towers: 0, windmill: true, silo: false, bridge: false, shift: 0 }, rooms: ['smithy'],
    }, engine.vocabulary);
    expect(reqs.map((r) => r.id)).toEqual(['type', 'size', 'room.smithy', 'windmill', 'mood.formality']);
  });
});

describe('HTTP-Server', () => {
  it('Schalter an: /v1/interpret meldet iterate, /v1/execute design_iterate fragt das Modell und zählt zum NL-Kontingent', async () => {
    expect(NL_EXECUTE_OPS.has(DESIGN_ITERATE)).toBe(true);
    const seen: Body[] = [];
    const f = mockJev((k) => (k === 'buildingTypeId' ? choice('house') : undefined), seen);
    for (const on of [false, true]) {
      const server = engineServer(engine, {
        interpret: opts(f, { iterate: { enabled: on, maxCalls: 8, timeoutMs: 60_000 } }),
        rateLimit: { nl: { burst: 2, perMinute: 1 } },
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      try {
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
        const it = (await (await post('/v1/interpret', { prompt: PROMPT })).json()) as { iterate?: boolean };
        expect(it.iterate).toBe(on ? true : undefined);
        const before = seen.length;
        const r = await post('/v1/execute', { op: DESIGN_ITERATE, input: { prompt: PROMPT, seed: 2, maxRounds: 1 } });
        expect(r.status).toBe(200);
        const d = ((await r.json()) as { data: Data }).data;
        expect(d.model).toBe(on ? DEFAULT_MODEL : 'local');
        expect(seen.length - before).toBe(on ? 3 : 0);
        // NL-Kontingent (burst 2) ist nach interpret + design_iterate erschöpft
        expect((await post('/v1/execute', { op: DESIGN_ITERATE, input: { prompt: PROMPT } })).status).toBe(429);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    }
  });
});
