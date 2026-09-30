import { endpointOf } from './systemone.js';

/**
 * Voreinstellungen je Anbieter. Alle sprechen das System-One-Format; es wechseln nur URL, Pfad, Modell und Key-Variable.
 * Modell-IDs sind festgepinnt (Live-Prüfung 2026-09-25): Schwellen und Messungen der Engine gelten für Jev 1.13; ein
 * `latest`-Alias (`jev-latest`, `~typesafe/jev-latest`; NICHT `typesafe/jev-latest` → 400) würde still wechseln.
 * Überschreibbar per CLASSIFIER_MODEL bzw. ENGINE_NL_MODEL (Regel in `env.ts`).
 */
export const PRESETS = {
  /** Jev über OpenRouter (Standard); Decisions-API `https://openrouter.ai/api/alpha/decisions` (einzige Stelle im Code). */
  'jev-openrouter': { baseUrl: 'https://openrouter.ai/api/alpha', path: '/decisions', model: 'typesafe/jev-1.13', apiKeyEnv: 'OPENROUTER_API_KEY', needsKey: true },
  /** Jev direkt bei TypeSafe (bare Modell-ID). */
  typesafe: { baseUrl: 'https://api.typesafe.ai', path: '/v1/systemone', model: 'jev-1.13', apiKeyEnv: 'TYPESAFE_API_KEY', needsKey: true },
  /** Kev lokal (`python -m kev.serve --port 8009`) oder selbst gehostet; Key nur, wenn KEV_API_KEY gesetzt ist. */
  kev: { baseUrl: 'http://127.0.0.1:8009', path: '/v1/systemone', model: 'kev-latest', apiKeyEnv: 'KEV_API_KEY', needsKey: false },
} as const satisfies Record<string, { baseUrl: string; path: string; model: string; apiKeyEnv: string; needsKey: boolean }>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];
export const DEFAULT_PROVIDER: PresetName = 'jev-openrouter';
/** Endpunkt des Standard-Anbieters (OpenRouter Decisions-API). */
export const DEFAULT_DECISIONS_URL = endpointOf(PRESETS[DEFAULT_PROVIDER]);
/** Standard-Modell des Standard-Anbieters. */
export const DEFAULT_DECISIONS_MODEL: string = PRESETS[DEFAULT_PROVIDER].model;

export const isPresetName = (s: string): s is PresetName => Object.hasOwn(PRESETS, s);

/** System-One-Modell (kein Chat): `typesafe/jev-1.13`, `~typesafe/jev-latest`, `jev-1.13`, `kev-latest`. */
export const isSystemOneModel = (model: string): boolean => /^~?typesafe\//.test(model) || /(^|\/)~?[jk]ev-/.test(model);
