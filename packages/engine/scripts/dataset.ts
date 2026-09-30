/**
 * Trainingsdatensatz für ein eigenes Klassifizierungsmodell (Feintuning prompt → { op, input }) als JSONL im
 * Chat-Format (OpenAI/OpenRouter-kompatibel): System-Prompt mit Vokabular, Nutzer-Prompt, Antwort = Anfrage-JSON.
 * Quellen: synthetisch (Vokabular + Satzbausteine) und – falls vorhanden – echte, gültige Paare aus dem Prompt-Log
 * (nur Modell-Antworten, keine lokalen Rückfälle).
 * Aufruf: npm run dataset -w @mcda/engine [anzahl=2000] [seed=1]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syntheticDataset } from '../src/index.js';
import { nodeEngine, promptLogTarget, systemPrompt, type PromptLogEntry } from '../src/node/index.js';

const n = Number(process.argv[2] ?? 2000);
const seed = Number(process.argv[3] ?? 1);
const out = fileURLToPath(new URL('../out/', import.meta.url));
const logFile = promptLogTarget(process.env['ENGINE_NL_LOG'], `${out}prompts.jsonl`); // W8-D: off = kein Log
const engine = nodeEngine();
const system = systemPrompt(engine);

const synthetic = syntheticDataset(engine.vocabulary, n, seed).map((r) => ({ prompt: r.prompt, request: r.request, source: 'synthetic' }));
const logged = logFile !== undefined && existsSync(logFile)
  ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as PromptLogEntry)
    .filter((e) => e.ok && e.fallback === undefined && engine.validate(e.request).length === 0)
    .map((e) => ({ prompt: e.prompt, request: e.request, source: `log:${e.model}` }))
  : [];

mkdirSync(out, { recursive: true });
const lines = [...logged, ...synthetic].map((r) => JSON.stringify({
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: r.prompt },
    { role: 'assistant', content: JSON.stringify(r.request) },
  ],
  source: r.source,
}));
writeFileSync(`${out}dataset.jsonl`, `${lines.join('\n')}\n`);
console.log(`${lines.length} Beispiele (${logged.length} aus dem Log, ${synthetic.length} synthetisch) → ${out}dataset.jsonl`);
