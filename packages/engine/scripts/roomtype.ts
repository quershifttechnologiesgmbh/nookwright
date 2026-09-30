/**
 * Raumbeschreibung → Raumtyp auf der Kommandozeile (Operation `roomtype_classify`).
 * Aufruf: npm run roomtype -w @mcda/engine -- "gemütlicher Raum voller Bücher"   (auch: npm run roomtype -w @mcda/classify -- …)
 * Mit Schlüssel in .env (Regel siehe .env.example: ENGINE_NL_API_KEY → CLASSIFIER_API_KEY → Key des Anbieters) fragt
 * JEV über @mcda/classify, Anbieter per CLASSIFIER_PROVIDER; ohne Schlüssel lokal (Katalognamen + Schlüsselwörter).
 */
import './env.js';
import { executeRoomTypeClassify, interpretOptionsFromEnv, nodeEngine } from '../src/node/index.js';

const description = process.argv.slice(2).join(' ').trim();
if (description === '') {
  console.error('Aufruf: npm run roomtype -w @mcda/engine -- "<Raumbeschreibung>"');
  process.exit(2);
}
const t = performance.now();
const r = await executeRoomTypeClassify(nodeEngine(), { description }, interpretOptionsFromEnv());
if (!r.ok) {
  console.error(r.errors.join('\n'));
  process.exit(1);
}
const d = r.data as { roomTypeId: string | null; name: string | null; confidence: number; model: string; fallback?: string; ranked: Array<{ roomTypeId: string; probability: number }> };
if (d.fallback !== undefined) console.log(`Modell nicht nutzbar, lokal klassifiziert: ${d.fallback}`);
console.log(`${d.model} (${Math.round(performance.now() - t)} ms): ${d.roomTypeId ?? '–'} (${d.name ?? 'kein Treffer'})  Konfidenz ${d.confidence.toFixed(2)}`);
for (const x of d.ranked) console.log(`  ${x.roomTypeId.padEnd(20)} ${x.probability.toFixed(3)}`);
