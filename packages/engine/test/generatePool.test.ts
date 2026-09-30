/**
 * Generierung im Worker-Pool (Betrieb): gleiches Ergebnis wie synchron (.litematic bis auf Zeitstempel), Cache, Zeitlimit → 504
 * mit Neustart, volle Warteschlange → 503 mit Retry-After, /healthz bleibt während einer Generierung schnell.
 * Offline, Port 0; Zeitlimit und Warteschlange mit einem künstlich langsamen Test-Worker.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { importFile } from '@mcda/export/node';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { hangTimeout, perfBudget } from '../../core/test/support/timing.js';
import { ClientAbortError, REPO_CATALOG, engineServer, generatePool, type AccessLogEntry, type GeneratePool, type ServerOptions } from '../src/node/index.js';
import { engine } from './fixture.js';

const SLOW_WORKER = new URL('./fixtures/slowWorker.mjs', import.meta.url);
const sha = (b: ArrayBuffer): string => createHash('sha256').update(new Uint8Array(b)).digest('hex');
/**
 * Zwei .litematic gleich bis auf die Zeitstempel: Die Datei trägt TimeCreated/TimeModified (jetzt), darum unterscheiden
 * sich die GZip-Bytes zweier Aufrufe auch ohne Pool (sogar in der Länge um ±1). Geprüft wird: NBT entpackt gleich lang,
 * höchstens 16 Bytes (zwei long) verschieden, Prüfsumme des dekodierten Volumens gleich.
 */
function expectSameSchematic(a: ArrayBuffer, b: ArrayBuffer): void {
  const [ra, rb] = [gunzipSync(new Uint8Array(a)), gunzipSync(new Uint8Array(b))];
  expect(ra.length).toBeGreaterThan(1000);
  expect(ra.length).toBe(rb.length);
  let diff = 0;
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) diff++;
  expect(diff).toBeLessThanOrEqual(16);
  const content = (x: ArrayBuffer): string => createHash('sha256').update(JSON.stringify(importFile('litematic', new Uint8Array(x)), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).digest('hex');
  expect(content(a)).toBe(content(b));
}

async function start(opts: ServerOptions): Promise<{ base: string; stop: () => Promise<void>; server: Server }> {
  const server = engineServer(engine, opts);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base, stop: () => new Promise<void>((r) => server.close(() => r())) };
}

const exec = (base: string, body: unknown, file = false): Promise<Response> =>
  fetch(`${base}/v1/execute${file ? '?file=1' : ''}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const TAVERN = { op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'M', seed: 7 } };
const PROJECT_STEPS = [
  { op: 'project_create', input: { name: 'Pool-Haus' } },
  { op: 'project_command', input: { projectId: 'p1', commands: [
    { command: 'paintRoom', floor: 0, rect: [0, 0, 8, 6], roomTypeId: 'kitchen' },
    { command: 'paintRoom', floor: 0, rect: [9, 0, 14, 6], roomTypeId: 'bedroom' },
  ] } },
];

describe('Worker-Pool mit echter Engine', () => {
  // Zeitlimit des Pools hier nur Hänger-Schutz (unter Fremdlast dauert eine Taverne M > 20 s); das Zeitlimit selbst prüft
  // der Block „Zeitlimit und Warteschlange“ mit 200 ms
  const pool = generatePool({ size: 2, timeoutMs: hangTimeout(90_000), workerData: { catalogDir: REPO_CATALOG } });
  let pooled: Awaited<ReturnType<typeof start>>;
  let direct: Awaited<ReturnType<typeof start>>;
  afterAll(async () => {
    await pooled.stop();
    await direct.stop();
    await pool.close();
  });

  it('building_generate: gleiche Datei (NBT-Größe, Prüfsumme des Inhalts) und gleiche Daten wie synchron; danach aus dem Cache', async () => {
    pooled = await start({ generate: pool, interpret: { apiKey: '', model: 'local' } });
    direct = await start({});
    const [a, b] = await Promise.all([exec(pooled.base, TAVERN, true), exec(direct.base, TAVERN, true)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.headers.get('content-disposition')).toBe(b.headers.get('content-disposition'));
    const [fa, fb] = [await a.arrayBuffer(), await b.arrayBuffer()];
    expectSameSchematic(fa, fb);

    const [ja, jb] = (await Promise.all([exec(pooled.base, TAVERN), exec(direct.base, TAVERN)]).then((r) => Promise.all(r.map((x) => x.json())))) as
      { ok: boolean; data: unknown; cached?: boolean }[];
    expect(ja!.data).toEqual(jb!.data);
    expect(ja!.cached).toBe(true); // Cache im Hauptthread (Datei-Aufruf davor)
    // Datei aus dem Cache: bytegleich (auch Zeitstempel), ohne neue Rechnung
    const again = await exec(pooled.base, TAVERN, true);
    expect(sha(await again.arrayBuffer())).toBe(sha(fa));
  });

  it('project_generate: Session serialisiert an den Worker → gleiche Datei wie synchron; unbekanntes Projekt 404', async () => {
    for (const step of PROJECT_STEPS) {
      expect((await exec(pooled.base, step)).status).toBe(200);
      expect((await exec(direct.base, step)).status).toBe(200);
    }
    const gen = { op: 'project_generate', input: { projectId: 'p1' } };
    const [a, b] = await Promise.all([exec(pooled.base, gen, true), exec(direct.base, gen, true)]);
    expect(a.status).toBe(200);
    const [fa, fb] = [await a.arrayBuffer(), await b.arrayBuffer()];
    expectSameSchematic(fa, fb);
    // Projekt unverändert, weiter bearbeitbar
    const got = (await (await exec(pooled.base, { op: 'project_get', input: { projectId: 'p1' } })).json()) as { ok: boolean };
    expect(got.ok).toBe(true);
    expect((await exec(pooled.base, { op: 'project_generate', input: { projectId: 'p9' } })).status).toBe(404);
    // ungültige Eingabe: gleiche 400 wie ohne Pool
    const bad = { op: 'building_generate', input: { buildingTypeId: 'nope' } };
    const [ba, bb] = await Promise.all([exec(pooled.base, bad), exec(direct.base, bad)]);
    expect(ba.status).toBe(400);
    expect(await ba.json()).toEqual(await bb.json());
  });

  it('build_guide (DR5 K2): im Pool gleiche Antwort wie synchron – mit Bautyp und mit Projekt-Session', async () => {
    for (const source of [TAVERN, { op: 'project_generate', input: { projectId: 'p1' } }]) {
      const req = { op: 'build_guide', input: { source, sheet: 'csv' } };
      const [a, b] = (await Promise.all([exec(pooled.base, req), exec(direct.base, req)]).then((r) => Promise.all(r.map((x) => x.json())))) as
        { ok: boolean; data: { text: string } }[];
      expect(a!.ok).toBe(true);
      expect(a!.data).toEqual(b!.data);
      expect(a!.data.text.startsWith('block,count')).toBe(true);
    }
  });

  it('NL-Generierung (/v1/prompt, lokaler Klassifikator) läuft über den Pool', async () => {
    const r = await fetch(`${pooled.base}/v1/prompt`, { method: 'POST', body: JSON.stringify({ prompt: 'eine kleine Taverne' }), headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; op: string; request: { op: string }; data: { blocks: number } };
    expect(j.request.op).toBe('building_generate');
    expect(j.data.blocks).toBeGreaterThan(1000);
  });

  it('/healthz antwortet während einer laufenden Generierung sofort (Hauptthread frei)', async () => {
    let done = false;
    const gen = exec(pooled.base, { op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'L', seed: 99 } }).then((r) => {
      done = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 50));
    const t = performance.now();
    const h = await fetch(`${pooled.base}/healthz`);
    const ms = performance.now() - t;
    expect(h.status).toBe(200);
    expect(((await h.json()) as { workers: { size: number } }).workers.size).toBe(2);
    expect(done).toBe(false);
    expect(ms).toBeLessThan(perfBudget(250)); // Wanduhr: Antwortzeit des Hauptthreads ist hier die Aussage
    expect((await gen).status).toBe(200);
  });
});

describe('Worker-Pool: Zeitlimit und Warteschlange (Test-Worker)', () => {
  const pools: GeneratePool[] = [];
  const servers: Awaited<ReturnType<typeof start>>[] = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.stop()));
    await Promise.all(pools.map((p) => p.close()));
  });
  const slow = async (ms: number, opts: { timeoutMs: number; size?: number; queue?: number }): Promise<{ base: string; pool: GeneratePool }> => {
    const pool = generatePool({ workerUrl: SLOW_WORKER, workerData: { ms }, size: opts.size ?? 1, timeoutMs: opts.timeoutMs, ...(opts.queue !== undefined ? { queue: opts.queue } : {}) });
    pools.push(pool);
    const s = await start({ generate: pool, generateCacheSize: 0 });
    servers.push(s);
    return { base: s.base, pool };
  };

  it('Zeitlimit greift → 504 mit Meldung, Worker neu gestartet, nächste Anfrage läuft', async () => {
    const events: string[] = [];
    const pool = generatePool({ workerUrl: SLOW_WORKER, workerData: { ms: 1_500 }, size: 1, timeoutMs: 200, onEvent: (e) => events.push(e.kind) });
    pools.push(pool);
    const s = await start({ generate: pool, generateCacheSize: 0 });
    servers.push(s);
    const t = performance.now();
    const r = await exec(s.base, TAVERN);
    expect(performance.now() - t).toBeLessThan(perfBudget(1_400));
    expect(r.status).toBe(504);
    expect(((await r.json()) as { errors: string[] }).errors[0]).toMatch(/Zeitlimit überschritten: 'building_generate' lief länger als 200 ms/);
    expect(events).toEqual(['timeout']);
    expect(pool.stats().restarts).toBe(1);
    // schnelle Test-Worker: gleicher Pool-Typ, Zeitlimit großzügig → 200
    const ok = await slow(20, { timeoutMs: 5_000 });
    expect((await exec(ok.base, TAVERN)).status).toBe(200);
    // Nach dem Neustart nimmt der erste Pool wieder an (Worker bereit, Antwort erneut 504 statt Hänger)
    expect((await exec(s.base, TAVERN)).status).toBe(504);
    expect(pool.stats().restarts).toBe(2);
  });

  it('Client bricht wartenden Auftrag ab → eigener Fehlertyp (499), kein 500 im Log (Review N3)', async () => {
    const pool = generatePool({ workerUrl: SLOW_WORKER, workerData: { ms: 500 }, size: 1, timeoutMs: 5_000 });
    pools.push(pool);
    const job = { request: { op: 'building_generate', input: TAVERN.input }, file: false } as Parameters<GeneratePool['run']>[0];
    const first = pool.run(job);
    const ctrl = new AbortController();
    const waiting = pool.run(job, ctrl.signal);
    ctrl.abort();
    await expect(waiting).rejects.toBeInstanceOf(ClientAbortError);
    await expect(waiting).rejects.toMatchObject({ status: 499 });
    await expect(pool.run(job, AbortSignal.abort())).rejects.toBeInstanceOf(ClientAbortError);
    await first;
    // HTTP: Zugriffslog vermerkt 499 statt 500
    const access: AccessLogEntry[] = [];
    const s = await start({ generate: pool, generateCacheSize: 0, accessLog: (e) => access.push(e) });
    servers.push(s);
    const busy = exec(s.base, TAVERN);
    await new Promise((r) => setTimeout(r, 50));
    const c2 = new AbortController();
    const gone = fetch(`${s.base}/v1/execute`, { method: 'POST', body: JSON.stringify(TAVERN), headers: { 'content-type': 'application/json' }, signal: c2.signal }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    c2.abort();
    await gone;
    await busy;
    await new Promise((r) => setTimeout(r, 50));
    expect(access.map((e) => e.status)).toContain(499);
    expect(access.map((e) => e.status)).not.toContain(500);
  });

  it('Warteschlange voll → 503 mit Retry-After; Health bleibt 200', async () => {
    // Ereignis statt fester Wartezeiten (unter Fremdlast zu kurz): erst ein Auftrag → Worker bereit; der erste Auftrag
    // läuft lang genug, dass der zweite sicher noch wartet, bis beide angekommen sind
    const { base, pool } = await slow(3_000, { timeoutMs: 10_000, size: 1, queue: 1 });
    expect((await exec(base, TAVERN)).status).toBe(200);
    const first = exec(base, TAVERN);
    const second = exec(base, TAVERN);
    await vi.waitFor(() => expect(pool.stats()).toMatchObject({ busy: 1, queued: 1 }), { timeout: 2_000, interval: 10 });
    const third = await exec(base, TAVERN);
    expect(third.status).toBe(503);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(((await third.json()) as { errors: string[] }).errors[0]).toMatch(/ausgelastet/);
    const t = performance.now();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect(performance.now() - t).toBeLessThan(perfBudget(250));
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    // Nicht gepoolte Operationen laufen weiter im Hauptthread
    expect((await exec(base, { op: 'catalog_list', input: { kind: 'themes' } })).status).not.toBe(503);
  });
});
