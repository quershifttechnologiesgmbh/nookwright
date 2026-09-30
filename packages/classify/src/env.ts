/**
 * Konfiguration aus der Umgebung – EINE Regel für alle Nutzer von @mcda/classify (Engine, Skripte):
 *
 * 1. Anbieter: CLASSIFIER_PROVIDER = jev-openrouter (Standard) | typesafe | kev
 * 2. Je Wert zuerst die Variable des Aufrufers (`overrides`, bei der Engine ENGINE_NL_*), dann CLASSIFIER_*, dann
 *    die Voreinstellung des Anbieters:
 *    - Key:      ENGINE_NL_API_KEY → CLASSIFIER_API_KEY → Key-Variable des Anbieters
 *                (OPENROUTER_API_KEY | TYPESAFE_API_KEY | KEV_API_KEY; Kev braucht keinen)
 *    - Modell:   ENGINE_NL_MODEL → CLASSIFIER_MODEL → Preset (typesafe/jev-1.13 | jev-1.13 | kev-latest)
 *    - Endpunkt: ENGINE_NL_DECISIONS_URL (volle URL) → CLASSIFIER_BASE_URL + CLASSIFIER_PATH → Preset
 *    - Zeitlimit/Wiederholungen: ENGINE_NL_TIMEOUT_MS/_RETRIES → CLASSIFIER_TIMEOUT_MS/_RETRIES → 10 000 ms / 1
 */
import { PRESETS, DEFAULT_PROVIDER, PRESET_NAMES, isPresetName, type PresetName } from './presets.js';
import { createSystemOneProvider, type SystemOneConfig } from './systemone.js';
import type { FetchLike } from './transport.js';
import type { DecisionProvider } from './types.js';

export { PRESETS, type PresetName } from './presets.js';

type Env = Readonly<Record<string, string | undefined>>;

/** Werte, die ein Aufrufer aus eigenen Variablen vorgibt (Vorrang vor CLASSIFIER_*). Leere Strings zählen als nicht gesetzt. */
export interface EnvOverrides {
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  /** Volle Endpunkt-URL. */
  readonly url?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retries?: number | undefined;
  readonly keyHint?: string | undefined;
}

export interface ResolvedEnv {
  readonly provider: PresetName;
  readonly config: SystemOneConfig;
  /** Kein Key gefunden, obwohl der Anbieter einen braucht. */
  readonly missingKey: boolean;
  /** Geprüfte Key-Variablen in Reihenfolge (für Fehlermeldungen). */
  readonly keyVars: readonly string[];
}

const nonEmpty = (v: string | undefined): string | undefined => (v !== undefined && v.trim() !== '' ? v : undefined);
const posNum = (v: string | undefined): number | undefined => {
  const n = Number(nonEmpty(v));
  return Number.isFinite(n) && n >= 0 && nonEmpty(v) !== undefined ? n : undefined;
};

/** Anbieter aus CLASSIFIER_PROVIDER (unbekannt → Fehler). */
export function providerNameFromEnv(env: Env = process.env): PresetName {
  const name = nonEmpty(env['CLASSIFIER_PROVIDER']) ?? DEFAULT_PROVIDER;
  if (!isPresetName(name)) throw new Error(`Unbekannter CLASSIFIER_PROVIDER "${name}" (erlaubt: ${PRESET_NAMES.join(', ')})`);
  return name;
}

/** Wendet die Regel an, ohne bei fehlendem Key zu werfen (die Engine fällt dann auf den lokalen Klassifikator zurück). */
export function resolveEnv(env: Env = process.env, overrides: EnvOverrides = {}, fetch?: FetchLike): ResolvedEnv {
  const provider = providerNameFromEnv(env);
  const preset = PRESETS[provider];
  const keyVars = ['CLASSIFIER_API_KEY', preset.apiKeyEnv];
  const apiKey = nonEmpty(overrides.apiKey) ?? nonEmpty(env['CLASSIFIER_API_KEY']) ?? nonEmpty(env[preset.apiKeyEnv]) ?? '';
  const url = nonEmpty(overrides.url);
  const timeoutMs = overrides.timeoutMs ?? posNum(env['CLASSIFIER_TIMEOUT_MS']);
  const retries = overrides.retries ?? posNum(env['CLASSIFIER_RETRIES']);
  const config: SystemOneConfig = {
    name: provider,
    baseUrl: url ?? nonEmpty(env['CLASSIFIER_BASE_URL']) ?? preset.baseUrl,
    path: url !== undefined ? '' : nonEmpty(env['CLASSIFIER_PATH']) ?? preset.path,
    model: nonEmpty(overrides.model) ?? nonEmpty(env['CLASSIFIER_MODEL']) ?? preset.model,
    keyHint: overrides.keyHint ?? keyVars.join(' bzw. '),
    ...(apiKey !== '' ? { apiKey } : {}),
    ...(timeoutMs !== undefined && timeoutMs > 0 ? { timeoutMs } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(provider === 'jev-openrouter' ? { headers: { 'X-Title': 'base-interior-generator' } } : {}),
    ...(fetch !== undefined ? { fetch } : {}),
  };
  return { provider, config, missingKey: apiKey === '' && preset.needsKey, keyVars };
}

/** Wie {@link resolveEnv}, aber ohne nötigen Key → Fehler mit den geprüften Variablen. */
export function configFromEnv(env: Env = process.env, fetch?: FetchLike, overrides: EnvOverrides = {}): SystemOneConfig {
  const r = resolveEnv(env, overrides, fetch);
  if (r.missingKey) throw new Error(`Kein API-Key: ${[...r.keyVars].reverse().join(' oder ')} setzen`);
  return r.config;
}

export function providerFromEnv(env: Env = process.env, fetch?: FetchLike, overrides: EnvOverrides = {}): DecisionProvider {
  return createSystemOneProvider(configFromEnv(env, fetch, overrides));
}
