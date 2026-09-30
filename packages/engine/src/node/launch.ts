/**
 * Gemeinsamer Start der HTTP-Server: `scripts/serve.ts` (Engine-API) und `scripts/web.ts` (Web-App: Website und API
 * auf einem Ursprung). Liest die Umgebung (alle Variablen in .env.example), baut Engine, Projektspeicher mit
 * TTL-Aufräumen, Worker-Pool und Zugriffslog, startet den Server und fährt bei SIGTERM/SIGINT sauber herunter (keine
 * neuen Verbindungen, laufende Anfragen höchstens ENGINE_SHUTDOWN_MS, dann Pool und Speicher schließen).
 * Ohne `web` ist das Verhalten das bisherige von `serve.ts`. Die `.env` laden die Skripte selbst (`scripts/env.ts`).
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_CORS_ORIGINS, DEFAULT_GENERATE_TIMEOUT_MS, REPO_CATALOG, apiKeysFromEnv, catalogDirFromEnv, defaultPoolSize, engineServer, generatePool,
  interpretOptionsFromEnv, jsonlLog, nodeEngine, promptLogTarget, projectStoreFromEnv, rateRuleOf,
} from './index.js';
import { envNumber, publicDailyBudget, type PublicBudget } from './config.js';
import type { SiteOptions } from './site.js';

/** Web-App (`scripts/web.ts`): Website und öffentlicher Modus. */
export interface WebLaunch {
  readonly site: SiteOptions;
  /** ENGINE_WEB_PUBLIC=1: Website öffentlich, nur POST /v1/interpret anonym (siehe `ServerOptions.publicInterpret`). */
  readonly publicInterpret: boolean;
  /** ENGINE_PUBLIC_ORIGINS: weitere erlaubte Ursprünge für den anonymen Zugang. */
  readonly publicOrigins: readonly string[];
  /** ENGINE_WEB_NL_DAILY: anonyme Beschreibungen je UTC-Tag (0 = ausdrücklich unbegrenzt); fehlt → {@link publicDailyBudget}. */
  readonly dailyBudget?: number | undefined;
}

// Kostenbremse und Zahlen aus der Umgebung liegen barrel-frei in `config.ts` (auch für die Vercel-Function)
export { DEFAULT_PUBLIC_NL_DAILY, envNumber, publicDailyBudget, type PublicBudget } from './config.js';

export interface LaunchOptions {
  /** Meldung beim Start, z. B. „Engine-API gestartet“. */
  readonly title: string;
  /** Port ohne argv[2] und ENGINE_PORT. */
  readonly defaultPort: number;
  /** Prompt-Log ohne ENGINE_NL_LOG: Datei oder `off`. */
  readonly promptLog: string;
  readonly web?: WebLaunch;
  readonly env?: NodeJS.ProcessEnv;
  readonly argv?: readonly string[];
}

/** Strukturiertes Log (eine JSON-Zeile); nie Schlüssel oder Prompts übergeben. */
export const logEvent = (level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
const log = logEvent;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1']);

/** Tagesbudget für die Startmeldung. */
const budgetText = (b: PublicBudget): string =>
  b.source === 'local'
    ? 'unbegrenzt (lokaler Klassifikator, kein Modellaufruf)'
    : b.perDay === 0
      ? 'unbegrenzt (ENGINE_WEB_NL_DAILY=0)'
      : `${b.perDay} je UTC-Tag${b.source === 'default' ? ' (Standard-Kostenbremse; ENGINE_WEB_NL_DAILY setzen)' : ''}`;

/** Server nach Umgebung starten; beendet den Prozess bei unsicherer Konfiguration (Exit 1) und nach dem Herunterfahren. */
export function launchServer(opts: LaunchOptions): Server {
  const env = opts.env ?? process.env;
  const argv = opts.argv ?? process.argv;
  const web = opts.web;
  const num = (name: string, fallback: number): number => envNumber(env, name, fallback);

  const keys = apiKeysFromEnv(env);
  const publicMode = web?.publicInterpret === true;
  const local = keys.length === 0 && !publicMode;
  const host = env['ENGINE_HOST'] ?? (local ? '127.0.0.1' : '0.0.0.0');
  if (local && !LOOPBACK_HOSTS.has(host)) {
    log('error', web === undefined
      ? 'ENGINE_HOST ist nicht localhost, aber keine API-Schlüssel konfiguriert – Abbruch (ENGINE_API_KEYS/ENGINE_API_KEYS_FILE setzen)'
      : 'ENGINE_HOST ist nicht localhost, aber weder API-Schlüssel noch öffentlicher Modus – Abbruch (ENGINE_WEB_PUBLIC=1 oder ENGINE_API_KEYS/ENGINE_API_KEYS_FILE setzen)', { host });
    process.exit(1);
  }
  const port = Number(argv[2] ?? env['ENGINE_PORT'] ?? opts.defaultPort);
  const catalogDir = catalogDirFromEnv(env, REPO_CATALOG);
  const engine = nodeEngine(catalogDir, { cacheSize: num('ENGINE_CACHE_SIZE', 64) });
  const nlLog = promptLogTarget(env['ENGINE_NL_LOG'], opts.promptLog) ?? 'off';
  const nl = interpretOptionsFromEnv(env);
  const cors = env['ENGINE_CORS_ORIGINS']?.split(',').map((o) => o.trim()).filter((o) => o !== '') ?? DEFAULT_CORS_ORIGINS;
  const projects = projectStoreFromEnv(env);
  const ttlMs = num('ENGINE_PROJECT_TTL_DAYS', 30) * 86_400_000;
  const rateLimit = { compute: rateRuleOf(env['ENGINE_RATE_COMPUTE'], { perMinute: 120 }), nl: rateRuleOf(env['ENGINE_RATE_NL'], { perMinute: 20, burst: 5 }) };
  const budget = publicMode ? publicDailyBudget(web?.dailyBudget, nl.mode) : undefined;

  const workers = num('ENGINE_GENERATE_WORKERS', defaultPoolSize());
  const generateTimeoutMs = num('ENGINE_GENERATE_TIMEOUT_MS', DEFAULT_GENERATE_TIMEOUT_MS);
  const pool = workers > 0
    ? generatePool({
      size: workers, timeoutMs: generateTimeoutMs, queue: num('ENGINE_GENERATE_QUEUE', 4 * workers), workerData: { catalogDir },
      onEvent: (e) => log(e.kind === 'timeout' ? 'warn' : 'error', e.kind === 'timeout' ? 'Generierung abgebrochen (Zeitlimit), Worker neu gestartet' : 'Generier-Worker abgestürzt, neu gestartet', e),
    })
    : undefined;

  const sweep = (): void => {
    if (ttlMs <= 0) return;
    const n = projects.sweep(Date.now() - ttlMs);
    if (n > 0) log('info', 'alte Projekte gelöscht', { count: n, ttlDays: ttlMs / 86_400_000 });
  };
  sweep();
  const sweeper = setInterval(sweep, 3_600_000);
  sweeper.unref();

  const server = engineServer(engine, {
    interpret: nl,
    ...(nlLog !== 'off' ? { log: jsonlLog(nlLog) } : {}),
    corsOrigins: cors,
    apiKeys: keys,
    projects,
    maxProjects: num('ENGINE_MAX_PROJECTS', 100),
    maxBody: num('ENGINE_MAX_BODY', 256 * 1024),
    rateLimit,
    trustProxy: env['ENGINE_TRUST_PROXY'] === '1',
    accessLog: (e) => console.log(JSON.stringify({ level: 'info', msg: 'request', ...e })),
    ...(pool !== undefined ? { generate: pool, generateCacheSize: num('ENGINE_CACHE_SIZE', 64) } : {}),
    ...(web !== undefined
      ? { site: web.site, publicInterpret: publicMode, publicOrigins: web.publicOrigins, ...(budget !== undefined ? { publicDailyBudget: budget.perDay } : {}) }
      : {}),
  });

  const common = {
    store: projects.kind, ttlDays: ttlMs / 86_400_000,
    generate: pool !== undefined ? { workers, timeoutMs: generateTimeoutMs } : 'synchron (ENGINE_GENERATE_WORKERS=0)',
    rateLimit: { compute: rateLimit.compute ?? 'aus', nl: rateLimit.nl ?? 'aus' },
    promptLog: nlLog === 'off' ? 'aus' : nlLog, cors: cors.join(', ') || 'aus',
  };
  server.listen(port, host, () => {
    // Tatsächlicher Port (bei Port 0 vom System vergeben; sonst gleich dem angefragten)
    const bound = (server.address() as AddressInfo | null)?.port ?? port;
    if (web === undefined) {
      log('info', opts.title, {
        url: `http://${host}:${bound}`, operations: engine.operations.length,
        auth: local ? 'LOKALER ENTWICKLERMODUS: keine API-Schlüssel, nur 127.0.0.1, ohne Anmeldung' : `${keys.length} API-Schlüssel`,
        ...common,
        nl: `${nl.model} (${nl.mode ?? 'tools'}${nl.fallback === false ? '' : ', Rückfall lokal'})`,
      });
      return;
    }
    const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
    const rest = keys.length > 0 ? `übrige /v1 mit API-Schlüssel (${keys.length})` : 'übrige /v1 gesperrt (keine API-Schlüssel)';
    log('info', opts.title, {
      url: `http://${shown}:${bound}/`,
      mode: local
        ? 'lokal: nur dieser Rechner (Loopback), ohne Anmeldung'
        : publicMode
          ? `öffentlich: Website und POST /v1/interpret ohne Anmeldung (nur eigener Ursprung${web.publicOrigins.length > 0 ? ` und ${web.publicOrigins.join(', ')}` : ''}), ${rest}`
          : `Schlüssel: Website öffentlich, /v1 nur mit API-Schlüssel (${keys.length})`,
      nl: nl.mode === 'local'
        ? 'lokaler Klassifikator (kein Modell-Schlüssel)'
        : `${nl.mode === 'decisions' ? 'Entscheidungsmodell' : 'Chat-Modell'} ${nl.model}${nl.provider !== undefined ? ` über ${nl.provider}` : ''}${nl.fallback === false ? '' : ', Rückfall lokal'}`,
      site: web.site.dir,
      ...(budget !== undefined ? { publicBudget: budgetText(budget) } : {}),
      operations: engine.operations.length, bind: `${host}:${bound}`,
      ...common,
    });
    if (budget?.source === 'env' && budget.perDay === 0 && nl.mode !== 'local') {
      log('warn', 'Öffentlicher Modus mit Modell ohne Tagesbudget (ENGINE_WEB_NL_DAILY=0): Kosten nur durch das Rate-Limit je IP begrenzt');
    }
  });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log('info', 'Herunterfahren', { signal });
    const force = setTimeout(() => {
      log('warn', 'Zeitlimit beim Herunterfahren – offene Verbindungen werden getrennt');
      server.closeAllConnections();
    }, num('ENGINE_SHUTDOWN_MS', 10_000));
    force.unref();
    server.close(() => {
      clearInterval(sweeper);
      void (pool?.close() ?? Promise.resolve()).finally(() => {
        projects.close?.();
        log('info', 'beendet');
        process.exit(0);
      });
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}
