/**
 * Live-Prüfung der NL-Steuerung gegen das echte Modell (für CI mit Secret oder lokal): feste Prompts → Modell →
 * Engine-Prüfung. Scheitert, wenn das Modell nicht erreichbar ist (kein lokaler Rückfall) oder der Bautyp nicht stimmt.
 * Aufruf: ENGINE_NL_API_KEY=… npm run live-check -w @mcda/engine
 */
import './env.js';
import { interpret, interpretOptionsFromEnv, nodeEngine } from '../src/node/index.js';

const CASES: ReadonlyArray<readonly [string, string]> = [
  ['Eine kleine Hobbithöhle, Eingang nach Osten', 'hobbit'],
  ['Bau mir eine große mittelalterliche Burg', 'castle_compact'],
  ['a cozy tavern with two floors', 'tavern'],
  ['Wikinger-Langhaus aus Holz', 'longhouse'],
];
const engine = nodeEngine();
const opts = { ...interpretOptionsFromEnv(), fallback: false };
if (opts.mode === 'local') {
  console.error('Kein ENGINE_NL_API_KEY/OPENROUTER_API_KEY gesetzt – Live-Prüfung braucht ein Modell.');
  process.exit(1);
}
let failed = 0;
for (const [prompt, type] of CASES) {
  const t = performance.now();
  try {
    const it = await interpret(prompt, engine, opts);
    const errors = engine.validate(it.request);
    const got = (it.request.input as { buildingTypeId?: string } | undefined)?.buildingTypeId;
    const ok = errors.length === 0 && got === type;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${prompt} → ${JSON.stringify(it.request)} (${Math.round(performance.now() - t)} ms)${errors.length > 0 ? ` ${errors.join('; ')}` : ''}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${prompt}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`${CASES.length - failed}/${CASES.length} korrekt (Modell ${opts.model}, Modus ${opts.mode})`);
process.exit(failed > 0 ? 1 : 0);
