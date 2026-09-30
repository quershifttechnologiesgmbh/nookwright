/**
 * Vercel Build Output API v3 (W8-V): Routen/Header und Function-Konfiguration aus denselben Konstanten wie der
 * Node-Server (`site.ts`: `SITE_HEADERS`, `siteCacheControl`, `SITE_TYPES`), damit beide Auslieferungen gleich antworten.
 * Genutzt von `deploy/vercel/build.mjs`, geprüft von `website/test/vercel-output.test.ts`.
 */
import { SITE_HEADERS, SITE_TYPES, siteCacheControl } from './site.js';

/** Neueste Node-Version der Vercel-Functions (Stand 09/2026: 24.x Standard, dazu 22.x/20.x; 26 noch nicht angeboten). */
export const VERCEL_NODE_RUNTIME = 'nodejs24.x';
/** Zeitgrenze der Function in s (Client bricht nach 20 s ab; Modell-Zeitlimit 8 s + 1 Wiederholung). */
export const VERCEL_MAX_DURATION = 25;
/** Function-Pfade (ohne `.func`) → dieselbe Function. */
export const VERCEL_FUNCTIONS: readonly string[] = ['v1/interpret', 'healthz'];

export interface VercelRoute {
  readonly src?: string;
  readonly dest?: string;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly continue?: boolean;
  readonly handle?: 'filesystem';
}

export interface VercelOutputConfig {
  readonly version: 3;
  readonly routes: readonly VercelRoute[];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
/** Pfade der Functions (keine Website-Header wie `cache-control: public`). */
const API_PATHS = '(?!v1(?:/|$)|healthz$)';

/**
 * Routen: Verzeichnis ohne `/` → 301 auf `…/` (relative Pfade des Editors), Sicherheits-Header auf jeder Antwort,
 * Cache-Regeln wie `siteCacheControl`, Galerie-Exporte als `application/octet-stream`, danach Dateisystem (statisch +
 * Functions), sonst `404.html` mit Status 404. `directories`: Verzeichnisse der Website mit `index.html` (ohne Wurzel).
 */
export function vercelOutputConfig(directories: readonly string[]): VercelOutputConfig {
  const html = siteCacheControl('index.html');
  const routes: VercelRoute[] = [
    ...[...directories].sort().map((d): VercelRoute => ({
      src: `^/${escapeRe(d)}$`, status: 301, headers: { ...SITE_HEADERS, location: `/${d.split('/').map(encodeURIComponent).join('/')}/`, 'cache-control': html },
    })),
    { src: '^/.*$', headers: { ...SITE_HEADERS }, continue: true },
    { src: `^/${API_PATHS}.*$`, headers: { 'cache-control': siteCacheControl('css/site.css') }, continue: true },
    { src: `^/${API_PATHS}(?:.*/)?(?:[^/]*\\.html)?$`, headers: { 'cache-control': html }, continue: true },
    { src: '^/editor/assets/.+$', headers: { 'cache-control': siteCacheControl('editor/assets/x.js') }, continue: true },
    { src: '^/.+\\.(?:litematic|schem|nbt)$', headers: { 'content-type': SITE_TYPES['.litematic']! }, continue: true },
    { handle: 'filesystem' },
    { src: '^/.*$', status: 404, dest: '/404.html', headers: { 'cache-control': 'no-store' } },
  ];
  return { version: 3, routes };
}

/** `.vc-config.json` der Function (Node-Launcher, ESM-Bündel `index.mjs`). */
export function vercelFunctionConfig(): Record<string, unknown> {
  return {
    runtime: VERCEL_NODE_RUNTIME, handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false,
    supportsResponseStreaming: false, maxDuration: VERCEL_MAX_DURATION,
  };
}

/**
 * Mojang-Wächter (HANDOFF §1): Dateien, die nach Client-JAR/Texturen aussehen, dürfen nie ausgeliefert werden.
 * `atlas*`, `blockstates*`, `models.json`, `block-flags*`, `*.jar`, alles unter `assets/minecraft/` und PNGs im Editor.
 */
export function mojangViolations(files: readonly string[]): string[] {
  return files.filter((f) => {
    const p = f.replaceAll('\\', '/');
    const name = p.split('/').at(-1)!.toLowerCase();
    return name.startsWith('atlas') || name.startsWith('blockstates') || name === 'models.json' || name.startsWith('block-flags')
      || name.endsWith('.jar') || /(^|\/)assets\/minecraft\//i.test(p) || (p.startsWith('editor/') && name.endsWith('.png'));
  });
}

/** Vorkomprimierte Sidecars: Vercel komprimiert selbst und nutzt sie nicht → nie ausliefern. */
export const isSidecar = (file: string): boolean => /\.(br|gz)$/i.test(file);
/** Punktdateien/-verzeichnisse (`.env`, `.git`) → nie ausliefern. */
export const isDotPath = (file: string): boolean => file.replaceAll('\\', '/').split('/').some((s) => s.startsWith('.'));
