/**
 * Natural Language → Schematic auf der Kommandozeile.
 * Aufruf: npm run prompt -w @mcda/engine -- "kleine nordische Taverne mit zwei Etagen"
 * Modell: ENGINE_NL_MODEL (Standard JEV `typesafe/jev-1.13` über die Decisions-API), ohne Schlüssel lokal.
 * Schreibt nach packages/engine/out/ und zeigt die gewählte Anfrage, Modell und Zeiten.
 */
import './env.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportFile } from '@mcda/export/node';
import { FORMAT_EXT, type ExportFormat } from '@mcda/export';
import { interpret, interpretOptionsFromEnv, jsonlLog, nodeEngine, promptLogTarget } from '../src/node/index.js';

const prompt = process.argv.slice(2).join(' ').trim();
if (prompt === '') {
  console.error('Aufruf: npm run prompt -w @mcda/engine -- "<Bitte in natürlicher Sprache>"');
  process.exit(1);
}
const engine = nodeEngine();
const t0 = performance.now();
const it = await interpret(prompt, engine, interpretOptionsFromEnv());
const t1 = performance.now();
if (it.fallback !== undefined) console.log(`Modell nicht nutzbar, lokal klassifiziert: ${it.fallback}`);
console.log(`Modell ${it.model} (${Math.round(t1 - t0)} ms):\n${JSON.stringify(it.request, null, 2)}`);
if (it.confidence !== undefined) console.log(`Konfidenz je Feld: ${JSON.stringify(it.confidence)}`);
const r = engine.execute(it.request);
const t2 = performance.now();
// W8-D: ENGINE_NL_LOG=off schreibt nichts (wie der Server), leer = Standarddatei
const logFile = promptLogTarget(process.env['ENGINE_NL_LOG'], fileURLToPath(new URL('../out/prompts.jsonl', import.meta.url)));
if (logFile !== undefined) jsonlLog(logFile)({
  ts: new Date().toISOString(), prompt, model: it.model, request: it.request, ok: r.ok, ...(r.ok ? {} : { errors: r.errors }),
  ...(it.fallback !== undefined ? { fallback: it.fallback } : {}),
});
if (!r.ok) {
  console.error(`Engine lehnt ab:\n  ${r.errors.join('\n  ')}`);
  process.exit(2);
}
console.log(`Engine (${Math.round(t2 - t1)} ms): ${JSON.stringify(r.data)}`);
const vol = r.artifacts?.export;
if (vol !== undefined) {
  const fmt = (r.data as { format?: ExportFormat }).format ?? 'litematic';
  const dir = fileURLToPath(new URL('../out/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = `${dir}${vol.name.replace(/[^\w-]+/g, '_')}${FORMAT_EXT[fmt]}`;
  writeFileSync(file, exportFile(fmt, vol));
  console.log(`→ ${file}`);
}
