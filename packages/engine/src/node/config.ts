/**
 * Gemeinsame Konfiguration der Node-Adapter ohne Barrel (W8-V): Katalogpfad, Engine über dem Katalog, Zahlen aus der
 * Umgebung und das Tagesbudget des öffentlichen Modus. Liegt getrennt von `index.ts`, damit die Vercel-Function
 * (`vercel.ts`) nur das bündelt, was `/v1/interpret` braucht – nicht `node:sqlite`, MCP-SDK oder den Worker-Pool.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeContext } from '@mcda/pipeline/node';
import { createEngine, type Engine, type EngineOptions } from '../engine.js';
import type { InterpretMode } from './openrouter.js';

/** Katalog des Repos (`<root>/catalog`). Nach dem Bündeln falsch → dort {@link catalogDirFromEnv} bzw. explizit. */
export const REPO_CATALOG = fileURLToPath(new URL('../../../../catalog', import.meta.url));

/** Katalogverzeichnis: `ENGINE_CATALOG_DIR` (z. B. Kopie im Function-Paket), sonst `fallback` (Standard: Repo). */
export function catalogDirFromEnv(env: NodeJS.ProcessEnv = process.env, fallback: string = REPO_CATALOG): string {
  const v = env['ENGINE_CATALOG_DIR']?.trim();
  return v !== undefined && v !== '' ? v : fallback;
}

/** Engine über dem Katalog auf der Platte (Standard: Katalog des Repos). */
export const nodeEngine = (catalogDir: string = REPO_CATALOG, options: EngineOptions = {}): Engine =>
  createEngine(nodeContext(join(catalogDir)), options);

/** Zahl ≥ 0 aus der Umgebung; leer/fehlt → `fallback`, sonst Fehler mit Variablennamen. */
export function envNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name}='${v}' ist keine Zahl ≥ 0`);
  return n;
}

/**
 * Kostenbremse (Review R1-06): Tagesbudget anonymer Beschreibungen im öffentlichen Modus, wenn ein Modell gefragt
 * wird (JEV, Chat-Modell, Kev) und ENGINE_WEB_NL_DAILY fehlt. Bei ≈ 0,0005 $ je JEV-Aufruf (live gemessen, W7-L)
 * ≈ 0,15 $/Tag; erschöpft → 429 mit Klartext, der Editor arbeitet lokal weiter.
 */
export const DEFAULT_PUBLIC_NL_DAILY = 300;

export interface PublicBudget {
  /** Anonyme Beschreibungen je UTC-Tag; 0 = unbegrenzt. */
  readonly perDay: number;
  /** `env`: ENGINE_WEB_NL_DAILY gesetzt; `default`: Kostenbremse; `local`: lokaler Klassifikator, kostet nichts. */
  readonly source: 'env' | 'default' | 'local';
}

/**
 * Tagesbudget des öffentlichen Modus: gesetzter Wert gilt (auch 0 = bewusst unbegrenzt); sonst mit Modell
 * {@link DEFAULT_PUBLIC_NL_DAILY}, mit lokalem Klassifikator unbegrenzt (nur das NL-Rate-Limit je IP).
 */
export function publicDailyBudget(explicit: number | undefined, nlMode: InterpretMode | undefined): PublicBudget {
  if (explicit !== undefined) return { perDay: Math.floor(explicit), source: 'env' };
  return nlMode === 'local' ? { perDay: 0, source: 'local' } : { perDay: DEFAULT_PUBLIC_NL_DAILY, source: 'default' };
}

/** `ENGINE_WEB_NL_DAILY`: leer/fehlt → `undefined` (Standard je nach NL-Quelle), sonst ganze Zahl ≥ 0. */
export function dailyBudgetFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  return (env['ENGINE_WEB_NL_DAILY'] ?? '').trim() === '' ? undefined : Math.floor(envNumber(env, 'ENGINE_WEB_NL_DAILY', 0));
}
