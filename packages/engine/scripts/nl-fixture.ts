/**
 * W7-L: aufgezeichnete JEV-Antworten der Beschreibungssätze (3 Wiederholungen) als Test-Fixture ohne Netz
 * (`test/fixtures/jev-descriptions.json`, genutzt von `test/jevReplay.test.ts`). Quelle ist der Cache von
 * `nl-compare` (`out/nl-cache.json`, erst `npm run nl-compare -w @mcda/engine -- --sets descriptions,descriptions-holdout`).
 * Gespeichert werden nur Antworten, die ab Schwelle 0,5 zählen können (ohne Wahrscheinlichkeiten); weggelassene
 * Antworten wirken in `decideIntent` wie unsichere. Ändern sich die Fragen, neu aufnehmen.
 * Aufruf: npx tsx scripts/nl-fixture.ts [Zieldatei]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { nodeEngine } from '../src/node/index.js';
import { decisionPlanOf, decisionsRequest } from '../src/node/decisions.js';
import { NOT_SPECIFIED } from '../src/intent/decisions.js';
import { DESCRIPTIONS, DESCRIPTIONS_HOLDOUT } from './nl-cases/descriptions.js';
const cache = JSON.parse(readFileSync('out/nl-cache.json', 'utf8'));
const plan = decisionPlanOf(nodeEngine());
const MIN = 0.5;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const out: Record<string, unknown> = {};
for (const c of [...DESCRIPTIONS, ...DESCRIPTIONS_HOLDOUT]) {
  const key = createHash('sha256').update(JSON.stringify(decisionsRequest(c.text, plan))).digest('hex').slice(0, 24);
  out[c.text] = [0, 1, 2].map((rep) => {
    const a = cache[`${key}#${rep}`].answers as Record<string, any>;
    const keep: Record<string, unknown> = {};
    for (const f of plan.fields) {
      if (f.kind === 'noul') { if (a[f.key]?.noul >= MIN) keep[f.key] = { type: 'noul', noul: r3(a[f.key].noul) }; }
      else if (f.kind === 'score') {
        const s = a[f.key]; const g = a[f.gate];
        if (s && g && g.noul >= MIN && (s.confidence ?? 0) >= MIN) { keep[f.key] = { type: 'score', score: r3(s.score), confidence: r3(s.confidence) }; keep[f.gate] = { type: 'noul', noul: r3(g.noul) }; }
      } else for (const k of f.keys) { const x = a[k]; if (x && x.choice !== NOT_SPECIFIED && (x.confidence ?? 0) >= MIN) keep[k] = { type: 'choice', choice: x.choice, confidence: r3(x.confidence) }; }
    }
    // eine Antwort bleibt immer (Bautyp, auch not_specified): ganz ohne Antworten wirft der Parser (lokaler Rückfall)
    const bt = a['buildingTypeId'];
    if (Object.keys(keep).length === 0 && bt) keep['buildingTypeId'] = { type: 'choice', choice: bt.choice, confidence: r3(bt.confidence) };
    return keep;
  });
}
writeFileSync(process.argv[2] ?? 'test/fixtures/jev-descriptions.json', JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"'));
