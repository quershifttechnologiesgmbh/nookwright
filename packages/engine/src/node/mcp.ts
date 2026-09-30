/**
 * MCP-Server der Engine (Model Context Protocol): Jedes Modell mit MCP-Unterstützung (Claude, eigene Agenten,
 * später ein eigenes Modell) bedient den Generator direkt.
 *
 * - **Tools** = alle Engine-Operationen, Eingabe-Schema 1:1 aus der Engine (dieselbe zod-Quelle wie JSON-API).
 * - **Ressourcen** = jeder Katalog-Eintrag (`catalog://<art>/<id>`, automatisch aus dem Katalog) und jedes offene
 *   Projekt (`project://<id>`).
 * - Exporte (Schematics) werden als Datei in `outDir` geschrieben; die Antwort nennt den Pfad.
 *
 * - Optional (`interpret`): Tool `nl_prompt` – Natural Language → Anfrage (Modell oder lokaler Klassifikator) → Ergebnis,
 *   wie `POST /v1/prompt` des HTTP-Servers. Für MCP-Clients, die selbst kein Sprachmodell mitbringen.
 *   Mit denselben Optionen fragt `roomtype_classify` das Entscheidungsmodell (JEV), sonst lokal; `design_iterate` nur
 *   mit Schalter `ENGINE_NL_ITERATE` (F-JEV-iterativ), sonst lokal.
 *
 * Neue Operationen, Katalog-Arten oder Katalog-Dateien erscheinen hier ohne Code-Änderung.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, ListResourceTemplatesRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { FORMAT_EXT, type ExportFormat } from '@mcda/export';
import { exportFile } from '@mcda/export/node';
import { CATALOG_KIND_IDS, CATALOG_KINDS } from '../catalogs.js';
import type { Engine, ExecuteResult } from '../engine.js';
import type { OperationId } from '../operation.js';
import { interpret, type InterpretOptions } from './openrouter.js';
import { ROOMTYPE_CLASSIFY, executeRoomTypeClassify } from './roomtype.js';
import { DESIGN_ITERATE, executeDesignIterate } from './design.js';

/** Name des optionalen NL-Tools (keine Engine-Operation, sondern Adapter davor). */
export const NL_TOOL = 'nl_prompt';

export interface McpOptions {
  /** Ordner für erzeugte Schematics (Standard: kein Schreiben, nur Kennzahlen). */
  readonly outDir?: string;
  readonly name?: string;
  readonly version?: string;
  /** NL-Steuerung: mit Optionen erscheint das Tool `nl_prompt`. */
  readonly interpret?: InterpretOptions;
}

const json = (v: unknown): string => JSON.stringify(v, null, 2);

function writeExport(r: ExecuteResult, outDir: string | undefined): string | undefined {
  if (!r.ok || outDir === undefined || r.artifacts?.export === undefined) return undefined;
  const vol = r.artifacts.export;
  const fmt = (r.data as { format?: ExportFormat }).format ?? 'litematic';
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${vol.name.replace(/[^\w-]+/g, '_')}${FORMAT_EXT[fmt]}`);
  writeFileSync(file, exportFile(fmt, vol));
  return file;
}

export function engineMcpServer(engine: Engine, opts: McpOptions = {}): Server {
  const server = new Server(
    { name: opts.name ?? 'base-generator-engine', version: opts.version ?? '0.1.0' },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        'Generator für eingerichtete Minecraft-Gebäude. Schnell: building_generate (Bautyp) oder rooms_generate (Räume). '
        + 'Schrittweise: project_create → project_command/site_command/project_style/project_structures → project_generate. '
        + 'Vokabular: catalog_describe, Details: catalog_get oder Ressourcen catalog://<art>/<id>.',
    },
  );

  const nlTool = opts.interpret === undefined ? [] : [{
    name: NL_TOOL,
    description: 'Bitte in natürlicher Sprache (Deutsch/Englisch) → passende Engine-Anfrage (Entscheidungsmodell JEV bzw. Sprachmodell, sonst lokaler Klassifikator) → Ergebnis. '
      + 'Antwort nennt die gewählte Anfrage, das Modell, bei JEV die Konfidenz je Feld und ggf. den Grund für den lokalen Rückfall.',
    inputSchema: {
      type: 'object' as const,
      properties: { prompt: { type: 'string', minLength: 1, description: 'z. B. „kleines Erdhaus im Hügel, Eingang nach Osten“' } },
      required: ['prompt'],
      additionalProperties: false,
    },
  }];

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...engine.tools().map((t) => ({
        name: t.function.name,
        description: t.function.description,
        inputSchema: { type: 'object' as const, ...t.function.parameters },
      })),
      ...nlTool,
    ],
  }));

  const answer = (r: ExecuteResult, ms: number, extra: Record<string, unknown> = {}) => {
    if (!r.ok) return { isError: true, content: [{ type: 'text' as const, text: `Fehler:\n${r.errors.join('\n')}${Object.keys(extra).length > 0 ? `\n${json(extra)}` : ''}` }] };
    const file = writeExport(r, opts.outDir);
    // Textausgaben (build_guide: Markdown/CSV) als eigener, unmaskierter Inhalt statt als JSON-String
    const { text: doc, ...data } = r.data as { text?: unknown };
    const text = json({ ...extra, ...data, ms, ...(r.cached === true ? { cached: true } : {}), ...(file !== undefined ? { file } : {}) });
    return { content: [{ type: 'text' as const, text }, ...(typeof doc === 'string' ? [{ type: 'text' as const, text: doc }] : [])] };
  };

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === NL_TOOL && opts.interpret !== undefined) {
      const prompt = (req.params.arguments as { prompt?: unknown } | undefined)?.prompt;
      if (typeof prompt !== 'string' || prompt.trim() === '') return { isError: true, content: [{ type: 'text' as const, text: 'Fehler:\nprompt fehlt' }] };
      const t0 = performance.now();
      let it;
      try {
        it = await interpret(prompt, engine, opts.interpret);
      } catch (err) {
        return { isError: true, content: [{ type: 'text' as const, text: `Fehler:\n${err instanceof Error ? err.message : String(err)}` }] };
      }
      const t1 = performance.now();
      // Nur zustandslose Operationen per Prompt (auch wenn der Adapter mehr anbietet)
      if (!engine.stateless.includes(it.request.op)) {
        return { isError: true, content: [{ type: 'text' as const, text: `Fehler:\nOperation '${it.request.op}' ist über ${NL_TOOL} nicht erlaubt (nur zustandslose)` }] };
      }
      const r = engine.execute(it.request);
      return answer(r, Math.round(performance.now() - t1), {
        request: it.request, model: it.model, interpretMs: Math.round(t1 - t0), ...(it.fallback !== undefined ? { fallback: it.fallback } : {}),
        ...(it.confidence !== undefined ? { confidence: it.confidence } : {}),
      });
    }
    const t = performance.now();
    const r = req.params.name === ROOMTYPE_CLASSIFY
      ? await executeRoomTypeClassify(engine, req.params.arguments ?? {}, opts.interpret)
      : req.params.name === DESIGN_ITERATE
        ? await executeDesignIterate(engine, req.params.arguments ?? {}, opts.interpret)
        : engine.execute({ op: req.params.name as OperationId, input: req.params.arguments ?? {} });
    return answer(r, Math.round(performance.now() - t));
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => {
    const catalog = CATALOG_KIND_IDS.flatMap((kind) => {
      const r = engine.execute({ op: 'catalog_list', input: { kind } });
      const items = (r.ok ? r.data : []) as { id: string; name: string }[];
      return items.map((e) => ({ uri: `catalog://${kind}/${e.id}`, name: `${kind}/${e.id}`, title: e.name, mimeType: 'application/json' }));
    });
    const projects = engine.execute({ op: 'project_list', input: {} });
    const open = ((projects.ok ? projects.data : []) as { projectId: string; name: string }[])
      .map((p) => ({ uri: `project://${p.projectId}`, name: `project/${p.projectId}`, title: p.name, mimeType: 'application/json' }));
    return { resources: [...open, ...catalog] };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates: [
      ...CATALOG_KIND_IDS.map((kind) => ({
        uriTemplate: `catalog://${kind}/{id}`, name: `catalog-${kind}`, description: CATALOG_KINDS[kind].summary, mimeType: 'application/json',
      })),
      { uriTemplate: 'project://{projectId}', name: 'project', description: 'Offenes Projekt (Etagen, Räume, Treppen, Gelände, Stil)', mimeType: 'application/json' },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (req) => {
    const uri = req.params.uri;
    const m = /^(catalog|project):\/\/(?:([a-z]+)\/)?([^/]+)$/.exec(uri);
    const r = m === null ? undefined
      : m[1] === 'project' ? engine.execute({ op: 'project_get', input: { projectId: m[3] } })
        : engine.execute({ op: 'catalog_get', input: { kind: m[2], id: m[3] } });
    if (r === undefined || !r.ok) throw new Error(`Ressource ${uri} unbekannt${r !== undefined && !r.ok ? `: ${r.errors.join('; ')}` : ''}`);
    return { contents: [{ uri, mimeType: 'application/json', text: json(r.data) }] };
  });

  return server;
}
