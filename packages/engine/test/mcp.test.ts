/** MCP-Server: echter MCP-Client über In-Memory-Transport – Tools, Aufrufe, Ressourcen je Katalog-Eintrag. */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngine } from '../src/index.js';
import { NL_TOOL, engineMcpServer } from '../src/node/index.js';
import { ctx } from './fixture.js';

const engine = createEngine(ctx);
const outDir = mkdtempSync(join(tmpdir(), 'engine-mcp-'));
const client = new Client({ name: 'test', version: '0' });
const text = (r: unknown): string => ((r as { content: { text: string }[] }).content[0]!.text);

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await engineMcpServer(engine, { outDir }).connect(a);
  await client.connect(b);
});
afterAll(() => client.close());

describe('MCP', () => {
  it('Tools = alle Operationen, mit Schema', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...engine.operations].sort());
    expect(tools.every((t) => t.inputSchema.type === 'object' && (t.description ?? '').length > 10)).toBe(true);
  });

  it('building_generate schreibt die Schematic und nennt den Pfad', async () => {
    const r = await client.callTool({ name: 'building_generate', arguments: { buildingTypeId: 'house', surroundings: false, format: 'nbt' } });
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(text(r)) as { file: string; blocks: number };
    expect(data.blocks).toBeGreaterThan(100);
    expect(data.file.endsWith('.nbt')).toBe(true);
    expect(existsSync(data.file)).toBe(true);
  });

  it('build_guide: Kennzahlen als JSON, Bauplan als eigener Text (Markdown unmaskiert)', async () => {
    const r = await client.callTool({ name: 'build_guide', arguments: { source: { op: 'building_generate', input: { buildingTypeId: 'house', surroundings: false } } } });
    expect(r.isError).toBeFalsy();
    const content = (r as { content: { text: string }[] }).content;
    expect(content).toHaveLength(2);
    const head = JSON.parse(content[0]!.text) as { sheet: string; count: number; text?: string };
    expect(head).toMatchObject({ sheet: 'markdown' });
    expect(head.text).toBeUndefined();
    expect(content[1]!.text).toMatch(/^# Bauplan: /);
  });

  it('Fehler kommen als isError mit Klartext', async () => {
    const r = await client.callTool({ name: 'building_generate', arguments: { buildingTypeId: 'nope' } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('buildingTypeId');
  });

  it('Projekt schrittweise über MCP, danach als Ressource lesbar', async () => {
    const c = JSON.parse(text(await client.callTool({ name: 'project_create', arguments: { name: 'MCP' } }))) as { projectId: string };
    await client.callTool({ name: 'project_command', arguments: { projectId: c.projectId, commands: [
      { command: 'paintRoom', floor: 0, rect: [0, 0, 6, 6], roomTypeId: 'kitchen' },
    ] } });
    const res = await client.readResource({ uri: `project://${c.projectId}` });
    expect(JSON.parse((res.contents[0] as { text: string }).text)).toMatchObject({ name: 'MCP', rooms: [{ roomTypeId: 'kitchen' }] });
  });

  it('jeder Katalog-Eintrag ist eine Ressource und lesbar', async () => {
    const { resources } = await client.listResources();
    const catalog = resources.filter((r) => r.uri.startsWith('catalog://'));
    const expected = ctx.catalog.all().length + ctx.catalog.roomTypeIds().length + ctx.themes.ids().length
      + (ctx.palettes?.size ?? 0) + (ctx.terrainStyles?.size ?? 0) + ctx.buildingTypes.ids().length;
    expect(catalog.length).toBe(expected);
    const palette = await client.readResource({ uri: 'catalog://palette/steinburg_grau' });
    expect(JSON.parse((palette.contents[0] as { text: string }).text)).toMatchObject({ id: 'steinburg_grau' });
    const kitchen = await client.readResource({ uri: 'catalog://roomtype/kitchen' });
    expect(JSON.parse((kitchen.contents[0] as { text: string }).text)).toMatchObject({ id: 'kitchen' });
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.length).toBe(7);
  });
});

describe('MCP mit NL-Tool (interpret gesetzt)', () => {
  const nlClient = new Client({ name: 'test-nl', version: '0' });
  const reply = { model: 'mock/model', choices: [{ message: { tool_calls: [{ function: { name: 'building_generate', arguments: JSON.stringify({ buildingTypeId: 'house', surroundings: false, format: 'schem' }) } }] } }] };
  beforeAll(async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const fetchMock = (async () => new Response(JSON.stringify(reply), { status: 200 })) as unknown as typeof fetch;
    await engineMcpServer(engine, { outDir, interpret: { apiKey: 'k', model: 'm', fetch: fetchMock } }).connect(a);
    await nlClient.connect(b);
  });
  afterAll(() => nlClient.close());

  it('nl_prompt: Prompt → Anfrage (Modell) → Schematic; leerer Prompt ist ein Fehler', async () => {
    const { tools } = await nlClient.listTools();
    expect(tools.map((t) => t.name)).toContain(NL_TOOL);
    const r = await nlClient.callTool({ name: NL_TOOL, arguments: { prompt: 'kleines Haus ohne Garten als schematic' } });
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(text(r)) as { model: string; request: { op: string }; file: string };
    expect(data).toMatchObject({ model: 'mock/model', request: { op: 'building_generate' } });
    expect(existsSync(data.file)).toBe(true);
    const empty = await nlClient.callTool({ name: NL_TOOL, arguments: { prompt: ' ' } });
    expect(empty.isError).toBe(true);
  });
});

describe('MCP nl_prompt: nur zustandslose Operationen (Review M2)', () => {
  it('auch mit so konfiguriertem Adapter kein project_create über nl_prompt', async () => {
    const c = new Client({ name: 'test-nl-m2', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const reply = { model: 'mock/model', choices: [{ message: { tool_calls: [{ function: { name: 'project_create', arguments: '{}' } }] } }] };
    const fetchMock = (async () => new Response(JSON.stringify(reply), { status: 200 })) as unknown as typeof fetch;
    await engineMcpServer(engine, { outDir, interpret: { apiKey: 'k', model: 'm', operations: ['project_create'], fetch: fetchMock } }).connect(a);
    await c.connect(b);
    try {
      const r = await c.callTool({ name: NL_TOOL, arguments: { prompt: 'neues Projekt' } });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/project_create.*nicht erlaubt/);
    } finally {
      await c.close();
    }
  });
});
