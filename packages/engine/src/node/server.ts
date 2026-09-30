/**
 * Interne HTTP-API der Engine (nur node:http, keine Abhängigkeit).
 *
 *   GET  /v1/operations             → Operationen mit Eingabe-Schema
 *   GET  /v1/schema                 → JSON Schema der Anfrage { op, input }
 *   GET  /v1/tools                  → Tool-Definitionen (OpenAI/OpenRouter-Format)
 *   POST /v1/execute   { op, input } → Ergebnis (JSON); mit `?file=1` die Schematic-Datei als Download
 *                      (`roomtype_classify`: mit konfiguriertem JEV über das Modell, sonst/bei Fehler lokal;
 *                      `design_iterate`: nur mit Schalter ENGINE_NL_ITERATE über JEV als Planer und Kritiker)
 *   POST /v1/prompt    { prompt }    → NL → { op, input } (JEV/Chat-Modell über OpenRouter, sonst lokal) → Ergebnis
 *   POST /v1/interpret { prompt }    → NL → { op, input } ohne Ausführung (Web-App: „Beschreibe dein Gebäude“)
 *   Beide antworten mit `model` und bei JEV mit `confidence` (Feldpfad → 0–1).
 *
 *   GET  /healthz                   → { ok, store } ohne Anmeldung (Betrieb, Container-Healthcheck); im öffentlichen
 *                                     Web-Modus ohne Schlüssel nur { ok, auth: 'public' }
 *
 * CORS: nur für die Ursprünge in `corsOrigins` (Standard: Vite-Dev-Server der App auf Port 5173). Der API-Schlüssel des
 * Modells bleibt im Server; der Browser bekommt nur die gewählte Anfrage.
 *
 * Betrieb (D): Mit `apiKeys` verlangt jeder /v1-Endpunkt `Authorization: Bearer <key>` (401 sonst); Projekte gehören
 * dem Schlüssel-Namen (Mandant; fremde Projekte → 404). Ohne Schlüssel lokaler Modus: nur Anfragen von localhost,
 * Mandant `local`, Host muss localhost/127.0.0.1/[::1] sein (DNS-Rebinding). POST nur mit `Content-Type:
 * application/json` (415 sonst) und nur von erlaubten Ursprüngen (`corsOrigins`, fremder `Origin` → 403; CSRF).
 * Fehlgeschlagene Anmeldungen zählen je IP gegen das Rechen-Limit. Rate-Limit je Mandant bzw. IP (Token-Bucket, NL-Endpunkte eigene, strengere Regel) → 429 mit
 * `Retry-After`. Projekte liegen im `ProjectStore` (Standard im Speicher, dauerhaft: SQLite). Zugriffslog als JSON
 * ohne Schlüssel und ohne Prompts.
 *
 * Generierung (optional `generate`): `POOLED_OPS` laufen im Worker-Pool (`generatePool.ts`), der Hauptthread bleibt
 * frei (Health, schnelle Befehle). Zeitlimit je Aufruf → 504, volle Warteschlange → 503 mit `Retry-After`.
 *
 * Web-App (W1, optional `site`): GET/HEAD außerhalb von `/v1/` und `/healthz` liefern die gebaute Website
 * (`site.ts`); der eigene Ursprung (Host, Schema) darf dann POSTen. Im lokalen Modus gilt die Loopback-Grenze auch
 * für die Website, mit Schlüsseln ist die Website öffentlich. Öffentlicher Web-Modus (`publicInterpret`): kein
 * lokaler Modus, Website öffentlich, nur `POST /v1/interpret` ohne Anmeldung (Mandant `web`) und nur mit `Origin` =
 * eigener Ursprung bzw. `publicOrigins` (sonst 403); NL-Rate-Limit je IP, optional Tagesbudget (`publicDailyBudget`).
 * Alle übrigen `/v1`-Routen verlangen weiter einen Schlüssel.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Engine, EngineRequest } from '../engine.js';
import { UNKNOWN_PROJECT, type SessionStore } from '../session.js';
import { PROJECT_CONFLICT, memoryProjectStore, persistentSessions, serializeSession, type ProjectStore } from '../store.js';
import { authenticate, type ApiKeyEntry } from './auth.js';
import { ClientAbortError, GenerateError, type GeneratePool, type GenerateJob } from './generatePool.js';
import { encodeResult, type WireOutcome } from './wire.js';
import type { PromptLogEntry } from './log.js';
import { interpret, type InterpretOptions } from './openrouter.js';
import { ROOMTYPE_CLASSIFY, executeRoomTypeClassify, usesDecisionModel } from './roomtype.js';
import { DESIGN_ITERATE, executeDesignIterate, iteratesWithModel } from './design.js';
import { memoryDailyBudget, tokenBuckets, type RateRule } from './rateLimit.js';
import {
  JSON_TYPE, MESSAGES, PUBLIC_MAX_BODY, WEB_TENANT, admitAnonymous, handleInterpret, originOf, sameOrigin, type CoreReply,
} from './interpretCore.js';
import { siteHandler, type SiteOptions } from './site.js';

export interface ServerOptions {
  /** Ohne: `/v1/prompt` antwortet 503. */
  readonly interpret?: InterpretOptions;
  /** Jede NL-Anfrage mit gewählter Engine-Anfrage und Ergebnis (Trainingsdaten für ein eigenes Modell). */
  readonly log?: (entry: PromptLogEntry) => void;
  /** Größte Anfrage in Bytes (Standard 64 KiB). */
  readonly maxBody?: number;
  /** Erlaubte Browser-Ursprünge (CORS); Standard `DEFAULT_CORS_ORIGINS`, leer = keine. */
  readonly corsOrigins?: readonly string[];
  /** Client-Schlüssel (gehasht); leer/fehlt = lokaler Modus (nur localhost, ohne Anmeldung). */
  readonly apiKeys?: readonly ApiKeyEntry[];
  /** Projektspeicher (Standard: im Speicher). */
  readonly projects?: ProjectStore;
  /** Höchstzahl Projekte je Mandant (Standard 100). */
  readonly maxProjects?: number;
  /** Rate-Limits je Mandant bzw. IP; fehlt = aus. `nl` gilt für /v1/prompt, /v1/interpret und {@link NL_EXECUTE_OPS}, `compute` für alle Anfragen außer den NL-Pfaden. */
  readonly rateLimit?: { readonly compute?: RateRule | undefined; readonly nl?: RateRule | undefined };
  /** Client-IP aus `X-Forwarded-For` (nur hinter einem vertrauenswürdigen Reverse-Proxy). */
  readonly trustProxy?: boolean;
  /** Eine Zeile je Anfrage (Standard: keine). Enthält nie Schlüssel oder Prompts. */
  readonly accessLog?: (entry: AccessLogEntry) => void;
  /** Uhr für Zeitstempel im Speicher und den Tag des öffentlichen Budgets (Standard `Date.now`). */
  readonly now?: () => number;
  /** Statische Website (gebautes Verzeichnis) unter demselben Ursprung; der eigene Ursprung darf dann POSTen. */
  readonly site?: SiteOptions;
  /**
   * Öffentlicher Web-Modus: kein lokaler Modus (auch ohne Schlüssel), `POST /v1/interpret` ohne Anmeldung nur mit
   * `Origin` = eigener Ursprung (mit `site`) oder aus `publicOrigins`; NL-Rate-Limit je IP. Übrige `/v1` → Schlüssel.
   */
  readonly publicInterpret?: boolean;
  /** Weitere erlaubte Ursprünge für den öffentlichen Zugang (auch CORS), z. B. `https://www.example.org`. */
  readonly publicOrigins?: readonly string[];
  /** Höchstzahl anonymer `/v1/interpret`-Aufrufe je UTC-Tag (alle IPs zusammen); fehlt/0 = unbegrenzt. */
  readonly publicDailyBudget?: number;
  /**
   * Worker-Pool für die Generier-Operationen (`POOLED_OPS`, auch nach NL-Auswahl); fehlt = synchron im Hauptthread
   * (Tests, Skripte). Mit Pool: Zeitlimit → 504, volle Warteschlange → 503 mit `Retry-After`.
   */
  readonly generate?: GeneratePool;
  /** Ergebnis-Cache der gepoolten, cachebaren Operationen (Einträge, LRU; Standard 64, 0 = aus). */
  readonly generateCacheSize?: number;
}

/**
 * Operationen, die im Worker-Pool laufen: die Generierung (0,2–3 s). `project_generate` bekommt die Session
 * serialisiert mit (liest sie nur); alle anderen Projekt-Befehle sind schnell und bleiben im Hauptthread.
 */
/** Über /v1/execute erreichbare Operationen, die ein Sprachmodell fragen: zählen zusätzlich zum `nl`-Kontingent. */
export const NL_EXECUTE_OPS: ReadonlySet<string> = new Set(['roomtype_classify', 'design_iterate']);
export const POOLED_OPS: ReadonlySet<string> = new Set(['building_generate', 'rooms_generate', 'building_propose', 'project_generate', 'design_iterate', 'build_guide']);

export interface AccessLogEntry {
  readonly ts: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly ms: number;
  /** Schlüssel-Name bzw. `local`; fehlt bei 401. */
  readonly tenant?: string;
  readonly ip: string;
  readonly op?: string;
}

/** Fehler mit HTTP-Status (Body-Limit, kaputtes JSON). */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const LOCAL_TENANT = 'local';
const isLoopback = (ip: string): boolean => ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.');
/** Host-Kopfzeile im lokalen Modus (Schutz vor DNS-Rebinding: evil.example → 127.0.0.1 hat einen fremden Host). */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
/** Abgelehnt, bevor der Body gelesen wurde: Verbindung schließen (sonst hängt der ungelesene Body im Keep-Alive). */
const NO_BODY_READ = { connection: 'close' };

/** Vite-Dev-Server und -Vorschau der App. */
export const DEFAULT_CORS_ORIGINS: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];

/** Pfade der API (alles andere ist mit `site` die Website). */
const isApiPath = (p: string): boolean => p === '/v1' || p.startsWith('/v1/') || p === '/healthz';

/**
 * Eigener Ursprung der Anfrage: Schema (TLS bzw. hinter `trustProxy` der letzte Eintrag von `X-Forwarded-Proto`, den
 * der eigene Proxy setzt) und `Host`. Nur für den Vergleich mit `Origin` (Browser setzen beides selbst).
 */
function ownOrigin(req: IncomingMessage, trustProxy: boolean): string | undefined {
  const fwd = trustProxy ? String(req.headers['x-forwarded-proto'] ?? '').split(',').at(-1)?.trim().toLowerCase() : undefined;
  const tls = (req.socket as { encrypted?: boolean }).encrypted === true;
  return originOf(req.headers.host ?? '', fwd === 'https' || fwd === 'http' ? fwd : tls ? 'https' : 'http');
}

/** `Origin` gleich dem eigenen Ursprung (normalisiert: Groß-/Kleinschreibung, Standard-Port). */
const isOwnOrigin = (origin: string, req: IncomingMessage, trustProxy: boolean): boolean => sameOrigin(origin, ownOrigin(req, trustProxy));

/** CORS-Kopfzeilen für einen erlaubten Ursprung (sonst keine – der Browser blockt dann). */
function cors(req: IncomingMessage, res: ServerResponse, origins: readonly string[]): void {
  const origin = req.headers.origin;
  if (origin === undefined || !origins.includes(origin)) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-expose-headers', 'retry-after, x-engine-ms');
  res.setHeader('access-control-max-age', '600');
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
};

/** Antwort des gemeinsamen Interpret-Kerns schreiben. */
const sendCore = (res: ServerResponse, r: CoreReply, extra: Record<string, string> = {}): void => send(res, r.status, r.body, { ...r.headers, ...extra });

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) throw new HttpError(413, MESSAGES.tooLarge(max));
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new HttpError(413, MESSAGES.tooLarge(max));
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, MESSAGES.badJson);
  }
}

/** JSON-Antwort ohne Artefakte, plus Laufzeit. */
const view = ({ result: r, ms }: WireOutcome): unknown =>
  r.ok ? { ok: true, op: r.op, data: r.data, ms: Math.round(ms), ...(r.cached === true ? { cached: true } : {}) } : { ok: false, ...(r.op !== undefined ? { op: r.op } : {}), errors: r.errors };

function reply(res: ServerResponse, o: WireOutcome, asFile: boolean, extra: Record<string, unknown> = {}): void {
  const r = o.result;
  if (asFile && r.ok && o.file !== undefined) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${o.file.name}"`, 'x-engine-ms': String(Math.round(o.ms)) });
    res.end(o.file.bytes);
    return;
  }
  const unknown = !r.ok && r.errors.some((e) => e.startsWith(UNKNOWN_PROJECT));
  const conflict = !r.ok && r.errors.some((e) => e.includes(PROJECT_CONFLICT));
  send(res, r.ok ? 200 : unknown ? 404 : conflict ? 409 : 400, { ...(view(o) as object), ...extra });
}

export function engineServer(engine: Engine, opts: ServerOptions = {}): Server {
  const max = opts.maxBody ?? 64 * 1024;
  const publicMode = opts.publicInterpret === true;
  const publicOrigins = publicMode ? (opts.publicOrigins ?? []) : [];
  const origins = [...(opts.corsOrigins ?? DEFAULT_CORS_ORIGINS), ...publicOrigins];
  const keys = opts.apiKeys ?? [];
  const local = keys.length === 0 && !publicMode;
  const trustProxy = opts.trustProxy === true;
  const serveSite = opts.site !== undefined ? siteHandler(opts.site) : undefined;
  /** Eigener Ursprung zählt als erlaubt, wenn der Server die Seite selbst ausliefert. */
  const ownAllowed = (origin: string, req: IncomingMessage): boolean => serveSite !== undefined && isOwnOrigin(origin, req, trustProxy);
  const budget = memoryDailyBudget(opts.publicDailyBudget ?? 0);
  const projects = opts.projects ?? memoryProjectStore();
  const now = opts.now ?? Date.now;
  const tenants = new Map<string, SessionStore>();
  const sessionsOf = (tenant: string): SessionStore => {
    let s = tenants.get(tenant);
    if (s === undefined) {
      s = persistentSessions(projects, tenant, { maxProjects: opts.maxProjects ?? 100, now });
      tenants.set(tenant, s);
    }
    return s;
  };
  const pool = opts.generate;
  const cacheSize = opts.generateCacheSize ?? 64;
  /** `withFile`: Eintrag stammt aus einem Aufruf mit `?file=1` (Datei kodiert, sofern die Operation eine liefert). */
  const cache = new Map<string, { readonly o: WireOutcome; readonly withFile: boolean }>();
  /**
   * Anfrage ausführen: Generier-Operationen im Pool (mit Cache im Hauptthread), alles andere und ungültige Anfragen
   * synchron (gleiche Fehlermeldungen wie bisher). Die Datei wird dort kodiert, wo gerechnet wurde.
   */
  const run = async (request: unknown, sessions: SessionStore, asFile: boolean, signal: AbortSignal): Promise<WireOutcome> => {
    const sync = (): WireOutcome => {
      const t = performance.now();
      const r = engine.execute(request, { sessions });
      return encodeResult(r, asFile, performance.now() - t);
    };
    const op = (request as { op?: unknown } | null)?.op;
    if (op === ROOMTYPE_CLASSIFY && usesDecisionModel(opts.interpret)) {
      const t = performance.now();
      const r = await executeRoomTypeClassify(engine, (request as EngineRequest).input, { ...opts.interpret, signal });
      return encodeResult(r, asFile, performance.now() - t);
    }
    // F-JEV-iterativ: mit Schalter ENGINE_NL_ITERATE und Modell fragt die Schleife JEV (im Hauptthread, siehe
    // plan/spikes/F_jev_iterativ.md, offene Punkte); ohne Schalter die reine Operation (im Pool)
    if (op === DESIGN_ITERATE && iteratesWithModel(opts.interpret)) {
      const t = performance.now();
      const r = await executeDesignIterate(engine, (request as EngineRequest).input, { ...opts.interpret, signal });
      return encodeResult(r, asFile, performance.now() - t);
    }
    if (pool === undefined || typeof op !== 'string' || !POOLED_OPS.has(op) || engine.validate(request).length > 0) return sync();
    const req = request as EngineRequest;
    let session: GenerateJob['session'];
    // build_guide (DR5 K2) mit Quelle project_generate braucht die Session genauso
    const source = op === 'build_guide' ? (req.input as { source: EngineRequest }).source : req;
    if (source.op === 'project_generate') {
      const id = (source.input as { projectId: string }).projectId;
      const s = sessions.get(id);
      if (s === undefined) return sync(); // unbekanntes/fremdes Projekt → 404 wie bisher
      session = { id, data: serializeSession(s) };
      sessions.commit?.(); // nur Zugriffszeit (die Operation ändert das Projekt nicht)
    }
    const key = cacheSize > 0 ? engine.cacheKey(req) : undefined;
    const hit = key !== undefined ? cache.get(key) : undefined;
    if (key !== undefined && hit !== undefined && (!asFile || hit.withFile)) {
      cache.delete(key);
      cache.set(key, hit);
      return { ...hit.o, result: { ...hit.o.result, cached: true } as WireOutcome['result'] };
    }
    const o = await pool.run({ request: { op: req.op, input: req.input }, ...(session !== undefined ? { session } : {}), file: asFile }, signal);
    if (key !== undefined && o.result.ok) {
      cache.delete(key);
      cache.set(key, { o, withFile: asFile });
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
    }
    return o;
  };
  const limits = {
    compute: opts.rateLimit?.compute !== undefined ? tokenBuckets(opts.rateLimit.compute) : undefined,
    nl: opts.rateLimit?.nl !== undefined ? tokenBuckets(opts.rateLimit.nl) : undefined,
  };
  const server = createServer((req, res) => {
    void (async () => {
      const t0 = performance.now();
      const url = new URL(req.url ?? '/', 'http://localhost');
      const asFile = url.searchParams.get('file') === '1';
      // Öffentlich: letzter Eintrag (hängt der eigene Proxy an); der erste kommt vom Client und wäre fälschbar
      const hops = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',') : undefined;
      const forwarded = hops !== undefined ? (publicMode ? hops.at(-1) : hops[0])?.trim() : undefined;
      const ip = forwarded !== undefined && forwarded !== '' ? forwarded : (req.socket.remoteAddress ?? '?');
      const log: { tenant?: string; op?: string } = {};
      let logged = false;
      const writeLog = (): void => {
        if (logged || opts.accessLog === undefined) return;
        logged = true;
        opts.accessLog({
          ts: new Date().toISOString(), method: req.method ?? '?', path: url.pathname, status: res.statusCode,
          ms: Math.round(performance.now() - t0), ip, ...log,
        });
      };
      res.on('finish', writeLog);
      cors(req, res, origins);
      // Client weg, bevor die Antwort fertig ist → wartender Generier-Auftrag fällt aus der Warteschlange
      const gone = new AbortController();
      res.on('close', () => { if (!res.writableFinished) gone.abort(); });
      try {
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/healthz') {
          // Öffentlich (Review R1-19): ohne gültigen Schlüssel nur Lebenszeichen und Modus, keine Speicher-/Worker-/Cache-Interna
          if (publicMode && authenticate(req.headers.authorization, keys) === undefined) {
            if (req.headers.authorization !== undefined) limits.compute?.take(`authfail:${ip}`);
            return send(res, 200, { ok: true, auth: 'public' });
          }
          return send(res, 200, {
            ok: true, store: projects.kind, auth: local ? 'local' : publicMode ? 'public' : 'keys',
            ...(pool !== undefined ? { workers: pool.stats() } : {}), ...(serveSite !== undefined ? { site: { compressCache: serveSite.stats() } } : {}),
          });
        }
        if (local && !isLoopback(req.socket.remoteAddress ?? '')) {
          return send(res, 403, { ok: false, errors: ['Lokaler Modus ohne API-Schlüssel: nur Anfragen von localhost'] });
        }
        if (local && !LOCAL_HOST.test(req.headers.host ?? '')) {
          return send(res, 403, { ok: false, errors: ['Lokaler Modus ohne API-Schlüssel: Host muss localhost, 127.0.0.1 oder [::1] sein'] }, NO_BODY_READ);
        }
        // Website: ohne Anmeldung und Rate-Limit (im lokalen Modus gelten die beiden Prüfungen oben)
        if (serveSite !== undefined && (req.method === 'GET' || req.method === 'HEAD') && !isApiPath(url.pathname)) {
          return await serveSite(req, res);
        }
        if (req.method === 'POST') {
          const origin = req.headers.origin;
          if (origin !== undefined && !origins.includes(origin) && !ownAllowed(origin, req)) {
            return send(res, 403, { ok: false, errors: [MESSAGES.foreignOrigin(origin)] }, NO_BODY_READ);
          }
          if (!JSON_TYPE.test(req.headers['content-type'] ?? '')) {
            return send(res, 415, { ok: false, errors: [MESSAGES.jsonOnly] }, NO_BODY_READ);
          }
        }
        // Öffentlicher Web-Modus: nur die Beschreibung ohne Schlüssel, nur aus der eigenen (bzw. erlaubten) Seite
        const anonymous = publicMode && req.method === 'POST' && url.pathname === '/v1/interpret' && req.headers.authorization === undefined;
        if (anonymous) {
          const denied = admitAnonymous(req.headers.origin, (o) => publicOrigins.includes(o) || ownAllowed(o, req));
          if (denied !== undefined) return sendCore(res, denied, NO_BODY_READ);
        }
        const tenant = anonymous ? WEB_TENANT : local ? LOCAL_TENANT : authenticate(req.headers.authorization, keys);
        if (tenant === undefined) {
          // Fehlversuche je IP begrenzen (Regel wie Rechnen, eigenes Kontingent)
          const denied = limits.compute?.take(`authfail:${ip}`);
          if (denied !== undefined && !denied.ok) {
            return send(res, 429, { ok: false, errors: [`Zu viele Fehlversuche – in ${denied.retryAfterS} s erneut versuchen`] },
              { 'retry-after': String(denied.retryAfterS) });
          }
          return send(res, 401, { ok: false, errors: [MESSAGES.noKey] },
            { 'www-authenticate': 'Bearer realm="engine"' });
        }
        log.tenant = tenant;
        const nlRoute = url.pathname === '/v1/prompt' || url.pathname === '/v1/interpret';
        const limiter = nlRoute ? limits.nl : limits.compute;
        const taken = limiter?.take(anonymous ? `web-ip:${ip}` : local ? `ip:${ip}` : `key:${tenant}`);
        if (taken !== undefined && !taken.ok) {
          return send(res, 429, { ok: false, errors: [MESSAGES.rateLimited(taken.retryAfterS)] },
            { 'retry-after': String(taken.retryAfterS) });
        }
        const sessions = sessionsOf(tenant);
        if (req.method === 'GET' && url.pathname === '/v1/operations') {
          return send(res, 200, engine.operations.map((op) => ({ op, input: engine.inputSchema(op) })));
        }
        if (req.method === 'GET' && url.pathname === '/v1/schema') return send(res, 200, engine.requestSchema());
        if (req.method === 'GET' && url.pathname === '/v1/tools') return send(res, 200, engine.tools());
        if (req.method === 'POST' && url.pathname === '/v1/execute') {
          const body = await readJson(req, max);
          const op = (body as { op?: unknown }).op;
          if (typeof op === 'string') log.op = op.slice(0, 64);
          // Operationen, die ein Sprachmodell fragen (kostet Geld), zählen zusätzlich zum NL-Kontingent
          if (typeof op === 'string' && NL_EXECUTE_OPS.has(op)) {
            const nlTaken = limits.nl?.take(local ? `ip:${ip}` : `key:${tenant}`);
            if (nlTaken !== undefined && !nlTaken.ok) {
              return send(res, 429, { ok: false, errors: [`Rate-Limit (Sprachmodell) erreicht – in ${nlTaken.retryAfterS} s erneut versuchen`] },
                { 'retry-after': String(nlTaken.retryAfterS) });
            }
          }
          return reply(res, await run(body, sessions, asFile, gone.signal), asFile);
        }
        if (req.method === 'POST' && url.pathname === '/v1/interpret') {
          // Gemeinsamer Kern mit der Vercel-Function (interpretCore.ts): Prompt, Tagesbudget, Klassifikation, Antwortform
          if (opts.interpret === undefined) return sendCore(res, await handleInterpret({ body: {}, anonymous }, { engine, interpret: undefined }));
          const body = await readJson(req, anonymous ? Math.min(max, PUBLIC_MAX_BODY) : max);
          return sendCore(res, await handleInterpret({ body, anonymous }, { engine, interpret: opts.interpret, budget, log: opts.log, now, iterate: iteratesWithModel(opts.interpret) }));
        }
        if (req.method === 'POST' && url.pathname === '/v1/prompt') {
          if (opts.interpret === undefined) return send(res, 503, { ok: false, errors: ['NL-Steuerung nicht konfiguriert'] });
          const body = (await readJson(req, max)) as { prompt?: unknown };
          if (typeof body.prompt !== 'string' || body.prompt.trim() === '') return send(res, 400, { ok: false, errors: ['prompt fehlt'] });
          const t0 = performance.now();
          let it;
          try {
            it = await interpret(body.prompt, engine, opts.interpret);
          } catch (err) {
            // Nur ohne lokalen Rückfall (ENGINE_NL_FALLBACK=0): Modell nicht nutzbar → 502 mit Klartext
            return send(res, 502, { ok: false, errors: [err instanceof Error ? err.message : String(err)] });
          }
          const t1 = performance.now();
          log.op = it.request.op;
          // Nur zustandslose Operationen über NL (auch wenn der Adapter mehr anbietet): kein Löschen/Ändern per Prompt
          if (!engine.stateless.includes(it.request.op)) {
            return send(res, 400, { ok: false, request: it.request, model: it.model, errors: [`Operation '${it.request.op}' ist über /v1/prompt nicht erlaubt (nur zustandslose)`] });
          }
          const o = await run(it.request, sessions, asFile, gone.signal);
          const r = o.result;
          opts.log?.({
            ts: new Date().toISOString(), prompt: body.prompt, model: it.model, request: it.request, ok: r.ok,
            ...(it.fallback !== undefined ? { fallback: it.fallback } : {}),
            ...(r.ok ? {} : { errors: r.errors }),
          });
          return reply(res, o, asFile, {
            request: it.request, model: it.model, interpretMs: Math.round(t1 - t0), ...(it.fallback !== undefined ? { fallback: it.fallback } : {}),
            ...(it.confidence !== undefined ? { confidence: it.confidence } : {}),
          });
        }
        return send(res, 404, { ok: false, errors: [`${req.method} ${url.pathname} unbekannt`] });
      } catch (err) {
        if (err instanceof ClientAbortError) {
          // Client ist weg: keine Antwort mehr möglich, nur im Zugriffslog vermerken
          res.statusCode = err.status;
          writeLog();
          if (!res.destroyed) res.end();
          return;
        }
        if (err instanceof GenerateError) {
          return send(res, err.status, { ok: false, errors: [err.message] }, err.retryAfterS !== undefined ? { 'retry-after': String(err.retryAfterS) } : {});
        }
        if (err instanceof HttpError) {
          if (err.status === 413) res.setHeader('connection', 'close');
          return send(res, err.status, { ok: false, errors: [err.message] });
        }
        return send(res, 500, { ok: false, errors: [err instanceof Error ? err.message : String(err)] });
      }
    })();
  });
  // Empfang einer Anfrage (Kopf + Body) höchstens 30 s; langsame Clients halten keine Verbindungen offen.
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
