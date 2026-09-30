/**
 * Engine: ein Einstiegspunkt für alle Steuerwege (JSON-API, LLM-Tool-Call, eigenes Klassifizierungsmodell, App).
 *
 *   { "op": "building_generate", "input": { "buildingTypeId": "tavern", "size": "M", "themeId": "timber" } }
 *
 * `execute` prüft gegen dasselbe zod-Schema, aus dem auch das JSON Schema und die Tool-Definitionen entstehen –
 * es gibt keinen zweiten, handgeschriebenen Vertrag, der auseinanderlaufen könnte.
 */
import { z } from 'zod';
import type { EngineContext, OperationResult, OperationId, Runtime } from './operation.js';
import { OPERATIONS } from './registry.js';
import { memorySessions, type SessionStore } from './session.js';
import { vocabularyOf, type Vocabulary } from './vocabulary.js';

export interface EngineRequest {
  readonly op: OperationId;
  readonly input?: unknown;
}

export type ExecuteResult =
  | ({ readonly ok: true; readonly op: OperationId; readonly cached?: true } & OperationResult)
  | { readonly ok: false; readonly op?: string; readonly errors: readonly string[] };

/** Funktions-Tool im OpenAI-/OpenRouter-Format (`tools: [...]`). */
export interface ToolDefinition {
  readonly type: 'function';
  readonly function: { readonly name: OperationId; readonly description: string; readonly parameters: Record<string, unknown> };
}

export interface Engine {
  readonly vocabulary: Vocabulary;
  readonly operations: readonly OperationId[];
  /** JSON Schema einer Operations-Eingabe (Eingabe-Sicht: Felder mit Standard sind optional). */
  inputSchema(op: OperationId): Record<string, unknown>;
  /** JSON Schema der ganzen Anfrage `{ op, input }` (oneOf je Operation) – für `response_format: json_schema`. */
  requestSchema(only?: readonly OperationId[]): Record<string, unknown>;
  /** Tool-Definitionen für Function Calling (optional nur bestimmte Operationen). */
  tools(only?: readonly OperationId[]): ToolDefinition[];
  /** Operationen ohne Session-Zustand (ein Aufruf = ein Ergebnis) – Standard für einzelne NL-Prompts. */
  readonly stateless: readonly OperationId[];
  /**
   * Anfrage ausführen. `runtime.sessions` ersetzt für diesen Aufruf den Session-Speicher der Engine (z. B. je Mandant
   * im HTTP-Server); danach ruft die Engine bei zustandsbehafteten Operationen `sessions.commit()`.
   */
  execute(request: unknown, runtime?: Partial<Runtime>): ExecuteResult;
  /** Nur prüfen (Schema), nicht ausführen: leere Liste = gültig. */
  validate(request: unknown): string[];
  /**
   * Cache-Schlüssel einer gültigen, cachebaren Anfrage (Operation + kanonisches JSON der geprüften Eingabe), sonst
   * `undefined`. Für Caches außerhalb der Engine (Worker-Pool des HTTP-Servers); gleiche Regel wie der interne Cache.
   */
  cacheKey(request: unknown): string | undefined;
}

const toJson = (s: z.ZodType): Record<string, unknown> => {
  const { $schema: _, ...rest } = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
};

const issues = (e: z.ZodError): string[] => e.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(input)'}: ${i.message}`);

export interface EngineOptions {
  /**
   * Ergebnis-Cache (LRU, Anzahl Einträge; Standard 0 = aus). Sicher, weil jede Operation deterministisch ist:
   * gleiche geprüfte Eingabe → gleiches Ergebnis. Schlüssel = Operation + kanonisches JSON der Eingabe nach zod.
   */
  readonly cacheSize?: number;
  /** Speicher der Projekt-Sessions (Standard: im Speicher, 32 Projekte). */
  readonly sessions?: SessionStore;
}

/** JSON mit sortierten Schlüsseln (Cache-Schlüssel unabhängig von der Feldreihenfolge). */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) =>
  (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
    : x));

/** Kontext je Engine (MX-K: der gemessene Kritiker von `design_iterate` plant ohne Welt, `measuredCritic.ts`). */
const CONTEXTS = new WeakMap<Engine, EngineContext>();
export const engineContextOf = (engine: Engine): EngineContext | undefined => CONTEXTS.get(engine);

export function createEngine(ctx: EngineContext, options: EngineOptions = {}): Engine {
  const vocabulary = vocabularyOf(ctx);
  const cacheSize = options.cacheSize ?? 0;
  const cache = new Map<string, ExecuteResult & { ok: true }>();
  const rt = { sessions: options.sessions ?? memorySessions() };
  const ops = new Map(OPERATIONS.map((o) => [o.id, { op: o, schema: o.input(vocabulary) }]));
  const requestZod = (only?: readonly OperationId[]): z.ZodType => {
    const variants = [...ops.values()].filter(({ op }) => only === undefined || only.includes(op.id)).map(({ op, schema }) => z.object({ op: z.literal(op.id), input: schema }).strict().describe(op.summary));
    return variants.length === 1 ? variants[0]! : z.discriminatedUnion('op', variants as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]);
  };

  const engine: Engine = {
    vocabulary,
    operations: [...ops.keys()],
    inputSchema(op) {
      const e = ops.get(op);
      if (e === undefined) throw new Error(`Unbekannte Operation '${op}'`);
      return toJson(e.schema);
    },
    requestSchema: (only) => toJson(requestZod(only)),
    stateless: [...ops.values()].filter((e) => e.op.cacheable).map((e) => e.op.id),
    tools: (only) => [...ops.values()].filter(({ op }) => only === undefined || only.includes(op.id)).map(({ op, schema }) => ({
      type: 'function' as const,
      function: { name: op.id, description: op.summary, parameters: toJson(schema) },
    })),
    validate(request) {
      if (typeof request !== 'object' || request === null || typeof (request as EngineRequest).op !== 'string') return ['Anfrage muss { op, input } sein'];
      const { op, input } = request as EngineRequest;
      const e = ops.get(op);
      if (e === undefined) return [`Unbekannte Operation '${op}'`];
      const parsed = e.schema.safeParse(input ?? {});
      return parsed.success ? [] : issues(parsed.error);
    },
    cacheKey(request) {
      if (typeof request !== 'object' || request === null || typeof (request as EngineRequest).op !== 'string') return undefined;
      const { op, input } = request as EngineRequest;
      const e = ops.get(op);
      if (e === undefined || !e.op.cacheable) return undefined;
      const parsed = e.schema.safeParse(input ?? {});
      return parsed.success ? `${op}:${canonical(parsed.data)}` : undefined;
    },
    execute(request, runtime) {
      if (typeof request !== 'object' || request === null || typeof (request as EngineRequest).op !== 'string') {
        return { ok: false, errors: ['Anfrage muss { "op": "<operation>", "input": { … } } sein'] };
      }
      const { op, input } = request as EngineRequest;
      const e = ops.get(op);
      if (e === undefined) return { ok: false, op, errors: [`Unbekannte Operation '${op}' (vorhanden: ${[...ops.keys()].join(', ')})`] };
      const parsed = e.schema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, op, errors: issues(parsed.error) };
      const useCache = cacheSize > 0 && e.op.cacheable;
      const key = useCache ? `${op}:${canonical(parsed.data)}` : '';
      const hit = useCache ? cache.get(key) : undefined;
      if (hit !== undefined) {
        cache.delete(key);
        cache.set(key, hit);
        return { ...hit, cached: true as const };
      }
      const run = runtime?.sessions !== undefined ? { ...rt, sessions: runtime.sessions } : rt;
      let result: ExecuteResult;
      try {
        const r = { ok: true as const, op, ...e.op.run(parsed.data, ctx, vocabulary, run) };
        if (useCache) {
          cache.set(key, r);
          if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
        }
        result = r;
      } catch (err) {
        result = { ok: false, op, errors: [err instanceof Error ? err.message : String(err)] };
      }
      if (!e.op.cacheable && run.sessions.commit !== undefined) {
        try {
          run.sessions.commit();
        } catch (err) {
          return { ok: false, op, errors: [`Projekt nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`] };
        }
      }
      return result;
    },
  };
  CONTEXTS.set(engine, ctx);
  return engine;
}
