/**
 * Live-Test der NL-Steuerung gegen das echte Modell (OpenRouter oder kompatibel). Standardmäßig übersprungen: läuft nur,
 * wenn ENGINE_NL_API_KEY in der Umgebung steht (lokal z. B. `set -a; . ./.env; set +a; npx vitest run
 * packages/engine/test/nl.live.test.ts`, in CI über .github/workflows/nl-live.yml). `.env` wird hier bewusst nicht
 * geladen, damit der normale Testlauf nie Kosten erzeugt. Modell: ENGINE_NL_MODEL (Standard `DEFAULT_MODEL` = JEV
 * `typesafe/jev-1.13` über die Decisions-API); zusätzlich prüft ein eigener Block JEV ausdrücklich (Form, Konfidenz, Kosten).
 *
 * Je Prompt: Modell-Anfrage (ohne lokalen Rückfall), lokaler Klassifikator zum Vergleich, Latenz, fertige .litematic.
 * Die Tabelle landet auf stdout (Vorlage für plan/spikes/E1_engine_api.md).
 */
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { exportFile } from '@mcda/export/node';
import { classifyLocal } from '../src/index.js';
import { DEFAULT_MODEL, NL_TOOL, engineMcpServer, engineServer, executeRoomTypeClassify, interpret, interpretOptionsFromEnv, nodeEngine } from '../src/node/index.js';

const live = (process.env['ENGINE_NL_API_KEY'] ?? '') !== '';
const T = 120_000;

/**
 * Prompt → erlaubte Bautypen (hart geprüft) und erwartete Felder (weich: kleine Modelle lassen bei temperature 0 noch
 * wechselnd einzelne Felder weg – live gesehen: Flachdach, Größe L, Theme). Felder zählen in eine Gesamtquote.
 */
const CASES: ReadonlyArray<readonly [string, readonly string[], Record<string, unknown>?]> = [
  ['kleine Hobbithöhle, Eingang nach Osten', ['hobbit'], { size: 'S' }],
  ['a cozy nordic longhouse with a steep roof and no garden', ['longhouse'], { themeId: 'nordic', surroundings: false }],
  ['Burg mit zwei Türmen und Mauer', ['castle_compact']],
  ['Stadthaus im Bauernhof-Stil', ['townhouse'], { themeId: 'farmstead' }],
  ['Wikinger-Langhaus', ['longhouse']],
  ['Wikingerhaus mit Flachdach', ['longhouse'], { shell: { roof: 'flat' } }],
  ['Große mittelalterliche Taverne mit drei Etagen', ['tavern'], { size: 'L', floors: 3 }],
  ['a small medieval watchtower facing north, schematic format', ['watchtower'], { size: 'S', front: 'north', format: 'schem' }],
  ['Fachwerkhaus, rustikal, ohne Deko', ['timber'], { exterior: { enabled: false } }],
  ['unterirdisches Haus mit zwei Stockwerken', ['house', 'twostory', 'hobbit']],
  ['Reihenhäuser im Stadtstil, seed 7', ['townhouse', 'townhouse_row'], { seed: 7 }],
  ['build me something spooky for halloween', []],
];

describe.skipIf(!live)('NL live (echtes Modell)', () => {
  const engine = nodeEngine();
  const opts = { ...interpretOptionsFromEnv(), fallback: false };
  const rows: string[] = [];
  let hits = 0;
  let wanted = 0;
  afterAll(() => {
    console.log(`\n| Prompt | LLM (${opts.model}) | lokal | Latenz | ok |\n|---|---|---|---|---|\n${rows.join('\n')}`);
    console.log(`Feldtreffer Modell: ${hits}/${wanted}`);
  });

  for (const [prompt, types, fields] of CASES) {
    it(prompt, async () => {
      const t = performance.now();
      const it1 = await interpret(prompt, engine, opts);
      const ms = Math.round(performance.now() - t);
      const input = it1.request.input as Record<string, unknown>;
      const local = classifyLocal(prompt, engine.vocabulary).request.input as Record<string, unknown>;
      const r = engine.execute(it1.request);
      const bytes = r.ok && r.artifacts?.export !== undefined ? exportFile('litematic', r.artifacts.export).length : 0;
      rows.push(`| ${prompt} | \`${JSON.stringify(input)}\` | \`${JSON.stringify(local)}\` | ${ms} ms | ${bytes > 0 ? '✓' : '✗'} |`);
      expect(engine.validate(it1.request)).toEqual([]);
      expect(r.ok, r.ok ? '' : r.errors.join('; ')).toBe(true);
      if (types.length > 0) expect(types).toContain(input['buildingTypeId']);
      for (const [k, v] of Object.entries(fields ?? {})) {
        wanted++;
        if (JSON.stringify(input[k]) === JSON.stringify(v) || (typeof v === 'object' && expect.objectContaining(v as object).asymmetricMatch(input[k]))) hits++;
      }
      if (it1.request.op === 'building_generate') expect(bytes).toBeGreaterThan(100);
    }, T);
  }

  it('Feldtreffer über alle Prompts ≥ 60 %', () => {
    expect(wanted).toBeGreaterThan(0);
    expect(hits / wanted, `${hits}/${wanted}`).toBeGreaterThanOrEqual(0.6);
  });

  it('unsinnige Eingabe: mit Rückfall immer ein gültiges Ergebnis', async () => {
    const r = await interpret('asdf qwertz 123', engine, { ...opts, fallback: true });
    expect(engine.validate(r.request)).toEqual([]);
    rows.push(`| asdf qwertz 123 | ${r.fallback !== undefined ? `Rückfall lokal: ${r.fallback.slice(0, 60)}` : `\`${JSON.stringify(r.request.input)}\``} | \`${JSON.stringify(classifyLocal('asdf qwertz 123', engine.vocabulary).request.input)}\` | – | ✓ |`);
  }, T);

  it('leerer Prompt: klarer Fehler ohne Modellaufruf', async () => {
    await expect(interpret('', engine, opts)).rejects.toThrow(/leer/);
  });

  it('HTTP-Server: POST /v1/prompt live', async () => {
    const server = engineServer(engine, { interpret: opts });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/prompt`, {
        method: 'POST', body: JSON.stringify({ prompt: 'kleine Taverne mit Flachdach' }), headers: { 'content-type': 'application/json' },
      });
      const j = (await res.json()) as { ok: boolean; model: string; request: { input: Record<string, unknown> }; fallback?: string };
      expect(res.status).toBe(200);
      expect(j).toMatchObject({ ok: true, request: { input: { buildingTypeId: 'tavern' } } });
      expect(j.model).not.toBe('local');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, T);

  it('MCP: nl_prompt live, Schematic wird geschrieben', async () => {
    const client = new Client({ name: 'live', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await engineMcpServer(engine, { outDir: mkdtempSync(join(tmpdir(), 'engine-live-')), interpret: opts }).connect(a);
    await client.connect(b);
    try {
      const r = await client.callTool({ name: NL_TOOL, arguments: { prompt: 'a small hobbit hole facing south' } });
      expect(r.isError).toBeFalsy();
      const data = JSON.parse((r as { content: { text: string }[] }).content[0]!.text) as { model: string; request: { input: Record<string, unknown> }; file: string };
      expect(data.model).not.toBe('local');
      expect(data.request.input).toMatchObject({ buildingTypeId: 'hobbit' });
      expect(data.file).toMatch(/\.litematic$/);
    } finally {
      await client.close();
    }
  }, T);
});

describe.skipIf(!live)('JEV live (Decisions-API)', () => {
  const engine = nodeEngine();
  const opts = { ...interpretOptionsFromEnv(), model: DEFAULT_MODEL, mode: 'decisions' as const, fallback: false };

  it('Live-Probe „kleine Hobbithöhle, Eingang nach Osten, ohne Garten“: Felder, Konfidenz, Latenz, Kosten, .litematic', async () => {
    const t = performance.now();
    const r = await interpret('kleine Hobbithöhle, Eingang nach Osten, ohne Garten', engine, opts);
    const ms = performance.now() - t;
    expect(r.model).toMatch(/^typesafe\/jev-1\.13/);
    expect(r.request.input).toMatchObject({ buildingTypeId: 'hobbit', size: 'S', front: 'east', surroundings: false });
    expect(r.confidence).toMatchObject({ buildingTypeId: expect.any(Number), front: expect.any(Number) });
    for (const c of Object.values(r.confidence ?? {})) expect(c).toBeGreaterThanOrEqual(0.5);
    expect(ms).toBeLessThan(5_000);
    expect((r.usage as { cost?: number }).cost).toBeLessThan(0.001);
    const x = engine.execute(r.request);
    expect(x.ok && x.artifacts?.export !== undefined ? exportFile('litematic', x.artifacts.export).length : 0).toBeGreaterThan(100);
    console.log(`JEV live: ${Math.round(ms)} ms, ${JSON.stringify(r.usage)}, ${JSON.stringify(r.confidence)}`);
  }, T);

  it('roomtype_classify live: „Raum voller Bücher“ → Bibliothek (über @mcda/classify), auch per HTTP', async () => {
    const t = performance.now();
    const r = await executeRoomTypeClassify(engine, { description: 'Raum voller Bücher' }, opts);
    const ms = performance.now() - t;
    expect(r.ok, r.ok ? '' : r.errors.join('; ')).toBe(true);
    const d = (r as unknown as { data: { roomTypeId: string; confidence: number; model: string; fallback?: string } }).data;
    expect(d.fallback).toBeUndefined();
    expect(d.model).toMatch(/^typesafe\/jev-1\.13/);
    expect(['library', 'study']).toContain(d.roomTypeId);
    expect(d.confidence).toBeGreaterThanOrEqual(0.5);
    console.log(`roomtype_classify live: ${Math.round(ms)} ms, ${JSON.stringify(d)}`);
    const server = engineServer(engine, { interpret: opts });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/execute`, {
        method: 'POST', body: JSON.stringify({ op: 'roomtype_classify', input: { description: 'Küche mit großem Herd und Vorräten' } }), headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, data: { roomTypeId: 'kitchen', model: expect.stringMatching(/^typesafe\//) } });
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  }, T);

  it('Chat-Aufruf mit JEV scheitert (400) → Rückfall; Decisions-Modus ist nötig', async () => {
    const r = await interpret('Burg', engine, { ...opts, mode: 'tools', fallback: true, retries: 0 });
    expect(r.model).toBe('local');
    expect(r.fallback).toMatch(/400|404/);
  }, T);
});
