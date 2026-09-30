/**
 * Betrieb des HTTP-Servers (D): API-Schlüssel, Mandantentrennung, Rate-Limit, Body-Limit, Health, dauerhafter
 * Projektspeicher (SQLite) über Neustarts, TTL-Aufräumen. Offline, Port 0.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PROJECT_CONFLICT, memoryProjectStore, persistentSessions, type ProjectStore } from '../src/index.js';
import {
  apiKeyLine, authenticate, engineServer, generateApiKey, jsonlLog, parseApiKeys, rateRuleOf, sqliteProjectStore, tokenBuckets,
  type AccessLogEntry, type ServerOptions,
} from '../src/node/index.js';
import { engine } from './fixture.js';

const KEY_A = generateApiKey();
const KEY_B = generateApiKey();
const apiKeys = parseApiKeys(`${apiKeyLine('alice', KEY_A)}\n# Kommentar\n${apiKeyLine('bob', KEY_B)}`);
const dir = mkdtempSync(join(tmpdir(), 'engine-ops-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function start(opts: ServerOptions): Promise<{ server: Server; base: string; stop: () => Promise<void> }> {
  const server = engineServer(engine, opts);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base, stop: () => new Promise<void>((r) => server.close(() => r())) };
}

const post = (base: string, body: unknown, key?: string, path = '/v1/execute'): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(key !== undefined ? { authorization: `Bearer ${key}` } : {}) },
  });

type Json = { ok: boolean; data?: Record<string, unknown>; errors?: string[] };
const PAINT = { command: 'paintRoom', floor: 0, rect: [0, 0, 8, 6], roomTypeId: 'kitchen' };

describe('API-Schlüssel', () => {
  it('Hash-Einträge, Bearer, falscher Schlüssel', () => {
    expect(authenticate(`Bearer ${KEY_A}`, apiKeys)).toBe('alice');
    expect(authenticate(`bearer ${KEY_B}`, apiKeys)).toBe('bob');
    expect(authenticate(`Bearer ${KEY_A}x`, apiKeys)).toBeUndefined();
    expect(authenticate(undefined, apiKeys)).toBeUndefined();
    expect(authenticate(KEY_A, apiKeys)).toBeUndefined();
    expect(apiKeyLine('alice', KEY_A)).not.toContain(KEY_A);
    expect(() => parseApiKeys('alice:klartext')).toThrow(/ungültig/);
    expect(() => apiKeyLine('a b', KEY_A)).toThrow(/ungültig/);
  });
});

describe('HTTP-Server mit Schlüsseln', () => {
  const access: AccessLogEntry[] = [];
  const prompts: string[] = [];
  const logFile = join(dir, 'prompts.jsonl');
  const nlLog = jsonlLog(logFile);
  let s: Awaited<ReturnType<typeof start>>;
  afterAll(() => s.stop());

  it('Health ohne Anmeldung, /v1 ohne bzw. mit falschem Schlüssel 401', async () => {
    s = await start({
      apiKeys, accessLog: (e) => access.push(e), log: (e) => { prompts.push(e.prompt); nlLog(e); },
      interpret: { apiKey: 'provider-secret', model: 'local' },
    });
    const h = await fetch(`${s.base}/healthz`);
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ ok: true, store: 'memory', auth: 'keys' });
    const none = await fetch(`${s.base}/v1/operations`);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toMatch(/Bearer/);
    expect(((await none.json()) as Json).errors?.[0]).toMatch(/API-Schlüssel fehlt oder ist ungültig/);
    expect((await post(s.base, { op: 'project_list', input: {} }, `${KEY_A}x`)).status).toBe(401);
    expect((await fetch(`${s.base}/v1/tools`, { headers: { authorization: `Basic ${KEY_A}` } })).status).toBe(401);
  });

  it('richtiger Schlüssel: Zugriff; Mandantentrennung (fremdes Projekt → 404)', async () => {
    expect((await fetch(`${s.base}/v1/operations`, { headers: { authorization: `Bearer ${KEY_A}` } })).status).toBe(200);
    const created = (await (await post(s.base, { op: 'project_create', input: { name: 'Alices Haus' } }, KEY_A)).json()) as Json;
    expect(created.ok).toBe(true);
    const id = created.data!['projectId'] as string;
    expect((await post(s.base, { op: 'project_get', input: { projectId: id } }, KEY_A)).status).toBe(200);
    for (const op of ['project_get', 'project_undo', 'project_save', 'project_generate']) {
      const r = await post(s.base, { op, input: { projectId: id } }, KEY_B);
      expect(r.status, op).toBe(404);
    }
    const cmd = await post(s.base, { op: 'project_command', input: { projectId: id, commands: [PAINT] } }, KEY_B);
    expect(cmd.status).toBe(404);
    expect(((await (await post(s.base, { op: 'project_list', input: {} }, KEY_B)).json()) as { data: unknown[] }).data).toEqual([]);
    // Bob löscht nicht Alices Projekt
    expect(((await (await post(s.base, { op: 'project_delete', input: { projectId: id } }, KEY_B)).json()) as Json).data).toEqual({ deleted: false });
    const list = (await (await post(s.base, { op: 'project_list', input: {} }, KEY_A)).json()) as { data: { projectId: string; name: string }[] };
    expect(list.data).toEqual([expect.objectContaining({ projectId: id, name: 'Alices Haus' })]);
  });

  it('Body-Limit 413, kaputtes JSON 400', async () => {
    const big = JSON.stringify({ op: 'project_list', input: {}, pad: 'x'.repeat(70 * 1024) });
    const r = await post(s.base, big, KEY_A);
    expect(r.status).toBe(413);
    expect(((await r.json()) as Json).errors?.[0]).toMatch(/zu groß/);
    expect((await post(s.base, '{kaputt', KEY_A)).status).toBe(400);
  });

  it('Logs ohne Schlüssel; Zugriffslog ohne Prompt', async () => {
    const r = await post(s.base, { prompt: 'kleines Haus mit Garten' }, KEY_A, '/v1/interpret');
    expect(r.status).toBe(200);
    expect(prompts).toContain('kleines Haus mit Garten');
    const all = `${JSON.stringify(access)}\n${readFileSync(logFile, 'utf8')}`;
    for (const secret of [KEY_A, KEY_B, 'provider-secret']) expect(all).not.toContain(secret);
    expect(JSON.stringify(access)).not.toContain('Garten');
    expect(access.find((e) => e.status === 401)).not.toHaveProperty('tenant');
    expect(access).toContainEqual(expect.objectContaining({ path: '/v1/execute', tenant: 'alice', op: 'project_create', status: 200 }));
  });
});

describe('Rate-Limit', () => {
  it('Token-Bucket: Kontingent, dann Wartezeit; Regeln aus Env', () => {
    let t = 0;
    const b = tokenBuckets({ perMinute: 60, burst: 2 }, () => t);
    expect(b.take('a').ok).toBe(true);
    expect(b.take('a').ok).toBe(true);
    expect(b.take('a')).toEqual({ ok: false, retryAfterS: 1 });
    expect(b.take('b').ok).toBe(true);
    t = 1000;
    expect(b.take('a').ok).toBe(true);
    expect(rateRuleOf('10/3', undefined)).toEqual({ perMinute: 10, burst: 3 });
    expect(rateRuleOf('0', { perMinute: 5 })).toBeUndefined();
    expect(rateRuleOf(undefined, { perMinute: 5 })).toEqual({ perMinute: 5 });
    expect(() => rateRuleOf('viel', undefined)).toThrow(/ungültig/);
  });

  it('HTTP: 429 mit Retry-After je Schlüssel; NL strenger als Rechnen', async () => {
    const s = await start({ apiKeys, rateLimit: { compute: { perMinute: 60, burst: 3 }, nl: { perMinute: 1, burst: 1 } }, interpret: { apiKey: 'k', model: 'local' } });
    try {
      const auth = { headers: { authorization: `Bearer ${KEY_A}` } };
      for (let n = 0; n < 3; n++) expect((await fetch(`${s.base}/v1/tools`, auth)).status).toBe(200);
      const limited = await fetch(`${s.base}/v1/tools`, auth);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      // anderer Schlüssel hat eigenes Kontingent
      expect((await fetch(`${s.base}/v1/tools`, { headers: { authorization: `Bearer ${KEY_B}` } })).status).toBe(200);
      // NL: eine Anfrage, dann rund eine Minute Pause
      expect((await post(s.base, { prompt: 'Haus' }, KEY_B, '/v1/interpret')).status).toBe(200);
      const nl = await post(s.base, { prompt: 'Haus' }, KEY_B, '/v1/interpret');
      expect(nl.status).toBe(429);
      expect(Number(nl.headers.get('retry-after'))).toBeGreaterThan(30);
      // Health zählt nicht
      expect((await fetch(`${s.base}/healthz`)).status).toBe(200);
    } finally {
      await s.stop();
    }
  });
});

describe('roomtype_classify zählt zum NL-Kontingent', () => {
  it('über /v1/execute: zweiter Aufruf 429, Rechnen bleibt frei', async () => {
    const s = await start({ apiKeys, rateLimit: { compute: { perMinute: 60, burst: 10 }, nl: { perMinute: 1, burst: 1 } } });
    try {
      const classify = { op: 'roomtype_classify', input: { description: 'Raum voller Bücher' } };
      expect((await post(s.base, classify, KEY_A)).status).toBe(200);
      const limited = await post(s.base, classify, KEY_A);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(30);
      expect((await post(s.base, { op: 'project_create', input: {} }, KEY_A)).status).toBe(200);
    } finally {
      await s.stop();
    }
  });
});

describe('Lokaler Modus (ohne Schlüssel)', () => {
  it('ohne Authorization nutzbar (App-Proxy), Mandant local, Rate-Limit je IP', async () => {
    const s = await start({ rateLimit: { compute: { perMinute: 60, burst: 2 } } });
    try {
      expect(await (await fetch(`${s.base}/healthz`)).json()).toMatchObject({ auth: 'local' });
      expect((await post(s.base, { op: 'project_create', input: {} })).status).toBe(200);
      expect((await post(s.base, { op: 'project_list', input: {} })).status).toBe(200);
      const r = await post(s.base, { op: 'project_list', input: {} });
      expect(r.status).toBe(429);
      expect(r.headers.get('retry-after')).toBe('1');
    } finally {
      await s.stop();
    }
  });
});

describe('Dauerhafter Projektspeicher', () => {
  const file = join(dir, 'projects.sqlite');

  it('Projekt inkl. Undo/Redo überlebt Server-Neustart (SQLite neu geöffnet)', async () => {
    let store = sqliteProjectStore(file);
    let s = await start({ apiKeys, projects: store });
    const id = ((await (await post(s.base, { op: 'project_create', input: { name: 'Bleibt' } }, KEY_A)).json()) as Json).data!['projectId'] as string;
    const paint = await post(s.base, { op: 'project_command', input: { projectId: id, commands: [PAINT, { ...PAINT, rect: [9, 0, 14, 6], roomTypeId: 'bedroom' }] } }, KEY_A);
    expect(paint.status).toBe(200);
    const undo = (await (await post(s.base, { op: 'project_undo', input: { projectId: id } }, KEY_A)).json()) as Json;
    expect((undo.data!['rooms'] as unknown[]).length).toBe(1);
    const before = (await (await post(s.base, { op: 'project_get', input: { projectId: id, placements: true } }, KEY_A)).json()) as Json;
    await s.stop();
    store.close?.();

    store = sqliteProjectStore(file);
    s = await start({ apiKeys, projects: store });
    try {
      const after = (await (await post(s.base, { op: 'project_get', input: { projectId: id, placements: true } }, KEY_A)).json()) as Json;
      expect(after.data).toEqual(before.data); // ohne Laufzeit `ms` (schwankt 0/1 ms)
      // Redo-Stapel ist mitgespeichert
      const redo = (await (await post(s.base, { op: 'project_redo', input: { projectId: id } }, KEY_A)).json()) as Json;
      expect(redo.ok).toBe(true);
      expect((redo.data!['rooms'] as unknown[]).length).toBe(2);
      // fremder Schlüssel sieht es auch nach dem Neustart nicht; neue IDs werden nicht wiederverwendet
      expect((await post(s.base, { op: 'project_get', input: { projectId: id } }, KEY_B)).status).toBe(404);
      const next = ((await (await post(s.base, { op: 'project_create', input: {} }, KEY_A)).json()) as Json).data!['projectId'];
      expect(next).not.toBe(id);
    } finally {
      await s.stop();
      store.close?.();
    }
  });

  it('TTL: Aufräumen nach letztem Zugriff', () => {
    for (const store of [memoryProjectStore(), sqliteProjectStore(':memory:')] as ProjectStore[]) {
      let t = 1_000;
      const a = persistentSessions(store, 't', { now: () => t });
      const r1 = engine.execute({ op: 'project_create', input: { name: 'alt' } }, { sessions: a });
      t = 5_000;
      const r2 = engine.execute({ op: 'project_create', input: { name: 'neu' } }, { sessions: a });
      expect(r1.ok && r2.ok).toBe(true);
      expect(store.ids('t')).toEqual(['p1', 'p2']);
      t = 9_000;
      engine.execute({ op: 'project_get', input: { projectId: 'p1' } }, { sessions: a }); // Zugriff hält p1 am Leben
      expect(store.sweep(6_000)).toBe(1);
      expect(store.ids('t')).toEqual(['p1']);
      expect(engine.execute({ op: 'project_get', input: { projectId: 'p2' } }, { sessions: a })).toMatchObject({ ok: false });
      store.close?.();
    }
  });

  it('Höchstzahl Projekte je Mandant; zweiter Prozess sieht Änderungen (Revision)', () => {
    const store = memoryProjectStore();
    const a = persistentSessions(store, 't', { maxProjects: 1 });
    expect(engine.execute({ op: 'project_create', input: {} }, { sessions: a }).ok).toBe(true);
    expect(engine.execute({ op: 'project_create', input: {} }, { sessions: a })).toMatchObject({ ok: false, errors: [expect.stringMatching(/Höchstens 1 Projekte/)] });
    const b = persistentSessions(store, 't');
    engine.execute({ op: 'project_get', input: { projectId: 'p1' } }, { sessions: a }); // a hat p1 im Cache
    expect(engine.execute({ op: 'project_command', input: { projectId: 'p1', commands: [PAINT] } }, { sessions: b }).ok).toBe(true);
    const seen = engine.execute({ op: 'project_get', input: { projectId: 'p1' } }, { sessions: a });
    expect(seen.ok && (seen.data as { rooms: unknown[] }).rooms.length).toBe(1);
  });
});

/** Rohe Anfrage mit frei gesetztem Host/Origin (fetch erlaubt keinen eigenen Host). */
function raw(base: string, path: string, opts: { method?: string; host?: string; origin?: string; type?: string; body?: string; key?: string }): Promise<{ status: number; body: string }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: u.hostname, port: u.port, path, method: opts.method ?? 'POST',
      headers: {
        ...(opts.host !== undefined ? { host: opts.host } : {}), ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
        ...(opts.type !== undefined ? { 'content-type': opts.type } : {}), ...(opts.key !== undefined ? { authorization: `Bearer ${opts.key}` } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(opts.body ?? JSON.stringify({ op: 'project_create', input: {} }));
  });
}

describe('Browser-Schutz: CSRF und DNS-Rebinding (Review M1)', () => {
  it('lokaler Modus: fremder Host 403, POST ohne JSON 415, fremder Origin 403; localhost/Vite-Proxy ok', async () => {
    const s = await start({});
    const port = new URL(s.base).port;
    try {
      // Repro des Reviews: text/plain + fremder Origin + fremder Host → vorher 200
      expect((await raw(s.base, '/v1/execute', { type: 'text/plain', origin: 'http://evil.example', host: 'evil.example' })).status).toBe(403);
      expect((await raw(s.base, '/v1/operations', { method: 'GET', host: 'evil.example' })).status).toBe(403);
      expect((await raw(s.base, '/v1/execute', { type: 'text/plain' })).status).toBe(415);
      expect((await raw(s.base, '/v1/execute', {})).status).toBe(415);
      expect((await raw(s.base, '/v1/execute', { type: 'application/json', origin: 'http://evil.example' })).status).toBe(403);
      for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'localhost']) {
        expect((await raw(s.base, '/v1/execute', { type: 'application/json', host })).status, host).toBe(200);
      }
      // Vite-Proxy (changeOrigin): Host = Ziel, Origin = App, JSON
      expect((await raw(s.base, '/v1/execute', { type: 'application/json; charset=utf-8', host: `127.0.0.1:${port}`, origin: 'http://localhost:5173' })).status).toBe(200);
      expect((await raw(s.base, '/healthz', { method: 'GET', host: 'evil.example' })).status).toBe(200);
    } finally {
      await s.stop();
    }
  });

  it('Schlüssel-Modus: POST nur mit JSON (415), fremder Origin darf nicht schreiben', async () => {
    const s = await start({ apiKeys });
    try {
      expect((await raw(s.base, '/v1/execute', { type: 'text/plain', key: KEY_A, host: 'api.example' })).status).toBe(415);
      expect((await raw(s.base, '/v1/execute', { type: 'application/json', key: KEY_A, host: 'api.example' })).status).toBe(200);
      expect((await raw(s.base, '/v1/execute', { type: 'application/json', key: KEY_A, origin: 'http://evil.example' })).status).toBe(403);
    } finally {
      await s.stop();
    }
  });

  it('fehlgeschlagene Anmeldungen je IP begrenzt (Review N3)', async () => {
    const s = await start({ apiKeys, rateLimit: { compute: { perMinute: 60, burst: 2 } } });
    try {
      const bad = { headers: { authorization: 'Bearer falsch' } };
      expect((await fetch(`${s.base}/v1/tools`, bad)).status).toBe(401);
      expect((await fetch(`${s.base}/v1/tools`, bad)).status).toBe(401);
      expect((await fetch(`${s.base}/v1/tools`, bad)).status).toBe(429);
      // gültiger Schlüssel hat eigenes Kontingent
      expect((await fetch(`${s.base}/v1/tools`, { headers: { authorization: `Bearer ${KEY_A}` } })).status).toBe(200);
    } finally {
      await s.stop();
    }
  });
});

describe('Speichern: Fehler und gleichzeitige Änderungen (Review N1, N2)', () => {
  it('N1: scheitert store.put, wird der Befehl nicht später doch gespeichert (kein doppeltes Anwenden beim Retry)', () => {
    const store = memoryProjectStore();
    let fail = false;
    const flaky: ProjectStore = { ...store, put: (...a: Parameters<ProjectStore['put']>) => { if (fail) throw new Error('Platte voll'); return store.put(...a); } };
    const sessions = persistentSessions(flaky, 't');
    expect(engine.execute({ op: 'project_create', input: {} }, { sessions }).ok).toBe(true);
    fail = true;
    expect(engine.execute({ op: 'project_command', input: { projectId: 'p1', commands: [PAINT] } }, { sessions }))
      .toMatchObject({ ok: false, errors: [expect.stringMatching(/Projekt nicht gespeichert: Platte voll/)] });
    fail = false;
    // der gescheiterte Befehl darf nicht mit dem nächsten Befehl doch noch gespeichert werden
    const other = { ...PAINT, rect: [9, 0, 14, 6], roomTypeId: 'bedroom' };
    expect(engine.execute({ op: 'project_command', input: { projectId: 'p1', commands: [other] } }, { sessions }).ok).toBe(true);
    const got = engine.execute({ op: 'project_get', input: { projectId: 'p1' } }, { sessions });
    expect(got.ok && (got.data as { rooms: { roomTypeId: string }[] }).rooms.map((r) => r.roomTypeId)).toEqual(['bedroom']);
    // auch ein neu angelegtes, nie gespeichertes Projekt bleibt nicht im Cache hängen
    fail = true;
    expect(engine.execute({ op: 'project_create', input: {} }, { sessions }).ok).toBe(false);
    fail = false;
    expect(sessions.ids()).toEqual(['p1']);
    expect(sessions.get('p2')).toBeUndefined();
  });

  it('N2: zwei Prozesse (zwei SQLite-Instanzen, eine Datei) – kein Lost Update, Konflikt → 409', async () => {
    const f = join(dir, 'conflict.sqlite');
    const [sa, sb] = [sqliteProjectStore(f), sqliteProjectStore(f)];
    try {
      const a = persistentSessions(sa, 't');
      const b = persistentSessions(sb, 't');
      expect(engine.execute({ op: 'project_create', input: {} }, { sessions: a }).ok).toBe(true);
      const stale = b.get('p1')!; // B hat Revision 1 geladen
      expect(engine.execute({ op: 'project_command', input: { projectId: 'p1', commands: [PAINT] } }, { sessions: a }).ok).toBe(true);
      stale.project.rename('B war langsamer');
      expect(() => b.commit!()).toThrow(PROJECT_CONFLICT);
      // B lädt danach neu und sieht A's Raum
      const seen = engine.execute({ op: 'project_get', input: { projectId: 'p1' } }, { sessions: b });
      expect(seen.ok && (seen.data as { rooms: unknown[]; name: string }).rooms.length).toBe(1);
      expect(sb.put('t', 'p1', '{}', 0, 1)).toBeUndefined();
    } finally {
      sa.close?.();
      sb.close?.();
    }
    // HTTP: Konflikt beim Speichern → 409 mit klarer Meldung
    const store = memoryProjectStore();
    let conflict = false;
    const racy: ProjectStore = { ...store, put: (...a: Parameters<ProjectStore['put']>) => (conflict ? undefined : store.put(...a)) };
    const s = await start({ projects: racy });
    try {
      expect((await post(s.base, { op: 'project_create', input: {} })).status).toBe(200);
      conflict = true;
      const r = await post(s.base, { op: 'project_command', input: { projectId: 'p1', commands: [PAINT] } });
      expect(r.status).toBe(409);
      expect(((await r.json()) as Json).errors?.[0]).toContain(PROJECT_CONFLICT);
    } finally {
      await s.stop();
    }
  });
});
