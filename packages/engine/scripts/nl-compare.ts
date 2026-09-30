/**
 * Live-Vergleich der NL-Wege: JEV (Decisions-API), lokaler Klassifikator und ihre Kombination, optional ein Chat-Modell.
 * Sätze (`scripts/nl-cases/`): `regression` (23er-Satz aus E1), `train` (44 handgeschriebene Prompts, an denen optimiert
 * wird) und `holdout` (22 Prompts, nur mit `--holdout`; maßgebliche Zahl, beim Optimieren nicht ansehen – ausgegeben
 * werden für ihn nur Summen). W7-E: `descriptions` (50) und `descriptions-holdout` (25) aus `descriptions.ts`.
 *
 * Aufruf: npm run nl-compare -w @mcda/engine [-- --reps 3 --holdout --sets regression,train --chat openai/gpt-oss-20b
 *   --details --no-cache]
 * Kosten: ein JEV-Aufruf ≈ 0,0005 $ (live W7-L); 120 Prompts × 3 Wiederholungen ≈ 0,18 $. `--offline` bezahlt nichts,
 * `--max-calls N` deckelt die neuen Aufrufe. Rohantworten liegen je Anfrage und
 * Wiederholung in `out/nl-cache.json` (git-ignoriert): Schwellen und Kombinationen werden ohne neue Kosten ausgewertet,
 * erneut bezahlt wird nur, wenn sich die Fragen ändern.
 *
 * Kennzahlen je Satz und Weg: Feldtreffer (erwartete Blätter mit richtigem Wert), Falschsetzungen (erwartetes Feld mit
 * anderem Wert oder verbotener Wert aus `not` – schlimmer als weggelassen), Zusatzfelder (nicht erwartete Kernfelder),
 * Latenz (Median, p90), Kosten. Über die Wiederholungen: Mittelwert und Spanne.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import './env.js';
import { classifyLocal } from '../src/index.js';
import { combineLocal, decideIntent, type CombineMode, type DecisionAnswer } from '../src/intent/decisions.js';
import { DEFAULT_CHAT_MODEL, DEFAULT_MODEL, interpret, nodeEngine } from '../src/node/index.js';
import { DECISIONS_OP, decisionPlanOf, decisionProviderOf, decisionsRequest } from '../src/node/decisions.js';
import type { FetchLike } from '@mcda/classify';
import { FALLBACK_THEME_ID, settingBuildable } from '@mcda/pipeline';
import { DEFAULT_MIN_CONFIDENCE } from '../src/intent/decisions.js';
import { TYPE_CONFIDENCE_MIN } from '../src/intent/local.js';
import {
  ASK, DESCRIPTIONS, DESCRIPTIONS_HOLDOUT, DESCRIPTIONS_HOLDOUT_NL, DESCRIPTIONS_NL, DESCRIPTION_FIELDS, builtTheme, guessOf,
  scoreDescriptions, type DescriptionCase, type DescriptionField,
} from './nl-cases/descriptions.js';
import { HOLDOUT } from './nl-cases/holdout.js';
import { REGRESSION } from './nl-cases/regression.js';
import { TRAIN } from './nl-cases/train.js';
import type { NlCase } from './nl-cases/types.js';

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const reps = Number(opt('reps') ?? 3);
const chatModel = opt('chat');
const details = flag('details');
const setNames = (opt('sets') ?? 'regression,train').split(',').filter((s) => s !== 'holdout');
// W7-E: Testsatz „Beschreibung → Soll“ (nur eindeutige Erwartungen; Rückfragen und Mehrfach-Soll misst descriptions.test.ts)
const SETS: Record<string, readonly NlCase[]> = {
  regression: REGRESSION, train: TRAIN, holdout: HOLDOUT, descriptions: DESCRIPTIONS_NL, 'descriptions-holdout': DESCRIPTIONS_HOLDOUT_NL,
};
const chosen = [...setNames, ...(flag('holdout') ? ['holdout'] : [])];

const apiKey = process.env['ENGINE_NL_API_KEY'] || process.env['OPENROUTER_API_KEY'] || '';
if (apiKey === '') {
  console.error('ENGINE_NL_API_KEY/OPENROUTER_API_KEY fehlt (.env)');
  process.exit(1);
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const leaves = (o: Json, p = ''): Array<[string, unknown]> =>
  Object.entries(o).flatMap(([k, v]) => (isObj(v) ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v] as [string, unknown]]));
const at = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o);
/** Kernfelder für „Zusatz“: was ein Nutzer bemerkt (Feinheiten wie Traufkonsolen zählen nicht). */
const CORE = ['buildingTypeId', 'size', 'floors', 'front', 'themeId', 'shell.roof', 'shell.roofDetail.pitch', 'setting.kind', 'surroundings', 'exterior.enabled', 'exterior.density', 'format'];

interface Score { hit: number; want: number; wrong: number; extra: number; miss: string[]; bad: string[]; plus: string[]; field: Record<string, [number, number]> }
function score(input: unknown, c: NlCase): Score {
  const want = leaves(c.want as Json);
  const s: Score = { hit: 0, want: want.length, wrong: 0, extra: 0, miss: [], bad: [], plus: [], field: {} };
  for (const [p, v] of want) {
    const got = at(input, p);
    const f = (s.field[p] ??= [0, 0]);
    f[1]++;
    if (got === v) { s.hit++; f[0]++; } else if (got === undefined) s.miss.push(p);
    else { s.wrong++; s.bad.push(`${p}=${String(got)}`); }
  }
  for (const [p, v] of leaves((c.not ?? {}) as Json)) if (at(input, p) === v) { s.wrong++; s.bad.push(`${p}=${String(v)}!`); }
  const wanted = new Set(want.map(([p]) => p));
  // Bautyp ohne Erwartung ist Pflicht (Standard house) und zählt nicht als Zusatz
  s.plus = CORE.filter((p) => p !== 'buildingTypeId' && !wanted.has(p) && at(input, p) !== undefined).map((p) => `+${p}=${String(at(input, p))}`);
  s.extra = s.plus.length;
  return s;
}

// --- Rohantworten JEV (Cache je Anfrage und Wiederholung) ---
const engine = nodeEngine();
const plan = decisionPlanOf(engine);
const provider = decisionProviderOf({ apiKey, model: DEFAULT_MODEL, mode: 'decisions', fallback: false });
// Vor dem ersten bezahlten Aufruf sicherstellen, dass der Cache auch im frischen Checkout gespeichert werden kann.
mkdirSync(fileURLToPath(new URL('../out/', import.meta.url)), { recursive: true });
const cacheFile = fileURLToPath(new URL('../out/nl-cache.json', import.meta.url));
type Raw = { answers: Record<string, DecisionAnswer | undefined>; ms: number; cost: number; model: string } | { error: string; ms: number };
const cache: Record<string, Raw> = !flag('no-cache') && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, Raw> : {};
let spent = 0;
let calls = 0;
// W7-L: `--offline` bezahlt nichts (Cache-Fehlschlag zählt als Fehler), `--max-calls N` deckelt die neuen Aufrufe je Lauf
const offline = flag('offline');
const maxCalls = Number(opt('max-calls') ?? Infinity);
const failed = new Map<string, Raw>();
async function raw(prompt: string, rep: number): Promise<Raw> {
  const req = decisionsRequest(prompt, plan);
  const key = `${createHash('sha256').update(JSON.stringify(req)).digest('hex').slice(0, 24)}#${rep}`;
  const hit = cache[key] ?? failed.get(key);
  if (hit !== undefined) return hit;
  if (offline || calls >= maxCalls) {
    const r: Raw = { error: offline ? 'offline: nicht im Cache' : 'max-calls erreicht', ms: 0 };
    failed.set(key, r);
    return r;
  }
  calls++;
  const t = performance.now();
  try {
    const res = await provider.decide(req);
    const r: Raw = { answers: res.answers as Record<string, DecisionAnswer>, ms: performance.now() - t, cost: res.usage?.cost ?? 0, model: res.model };
    spent += r.cost;
    cache[key] = r;
    return r;
  } catch (err) {
    const r: Raw = { error: err instanceof Error ? err.message.slice(0, 120) : String(err), ms: performance.now() - t };
    failed.set(key, r); // nur in diesem Lauf: Fehler nicht erneut bezahlen, beim nächsten Lauf neu versuchen
    return r;
  }
}

// --- Wege: JEV mit Schwelle, lokal, Kombination (wie interpretDecisions: ungültig → lokal) ---
type Way = { name: string; threshold: number; combine: CombineMode | 'local' };
const WAYS: Way[] = [
  { name: 'lokal', threshold: 0, combine: 'local' },
  ...[0.3, 0.4, 0.5, 0.6, 0.7].map((t): Way => ({ name: `JEV ${t}`, threshold: t, combine: 'none' })),
  ...[0.5, 0.6, 0.7].map((t): Way => ({ name: `JEV ${t} + lokal füllt`, threshold: t, combine: 'fill' })),
  ...[0.5, 0.6].map((t): Way => ({ name: `JEV ${t} + lokal zuerst`, threshold: t, combine: 'local-first' })),
];
function run(way: Way, prompt: string, r: Raw): unknown {
  const li = classifyLocal(prompt, engine.vocabulary);
  const local = li.request.input as Json;
  if (way.combine === 'local' || 'error' in r) return local;
  const decided = combineLocal(decideIntent(plan, DECISIONS_OP, r.answers, way.threshold, local), local, li.confidence >= 1, way.combine);
  return engine.validate(decided.request).length > 0 ? local : decided.request.input;
}

type Agg = { hit: number[]; wrong: number[]; extra: number[]; want: number; field: Record<string, [number, number]> };
const pct = (a: number, b: number): string => `${Math.round((100 * a) / Math.max(1, b))} %`;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const span = (xs: number[]): string => (Math.min(...xs) === Math.max(...xs) ? `${xs[0]}` : `${Math.min(...xs)}–${Math.max(...xs)}`);
const quant = (xs: number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;

console.log(`JEV ${DEFAULT_MODEL}, ${plan.fields.length} Felder/${Object.keys(plan.questions).length} Fragen, ${reps} Wiederholungen, Sätze: ${chosen.join(', ')}`);
for (const setName of chosen) {
  const cases = SETS[setName];
  if (cases === undefined) throw new Error(`unbekannter Satz ${setName}`);
  const aggs = new Map<string, Agg>(WAYS.map((w) => [w.name, { hit: Array(reps).fill(0), wrong: Array(reps).fill(0), extra: Array(reps).fill(0), want: 0, field: {} }]));
  const ms: number[] = [];
  let cost = 0;
  let errors = 0;
  const rows: string[] = [];
  for (const c of cases) {
    const raws = await Promise.all(Array.from({ length: reps }, (_, rep) => raw(c.prompt, rep)));
    for (const [rep, r] of raws.entries()) {
      ms.push(r.ms);
      if ('error' in r) errors++; else cost += r.cost;
      for (const w of WAYS) {
        const s = score(run(w, c.prompt, r), c);
        const a = aggs.get(w.name)!;
        a.hit[rep]! += s.hit; a.wrong[rep]! += s.wrong; a.extra[rep]! += s.extra;
        if (rep === 0) a.want += s.want;
        for (const [p, [h, n]] of Object.entries(s.field)) { const f = (a.field[p.split('.')[0]!] ??= [0, 0]); f[0] += h; f[1] += n; }
      }
    }
    if (setName !== 'holdout' && details) {
      const cell = (name: string): string => {
        const w = WAYS.find((x) => x.name === name)!;
        return raws.map((r) => { const s = score(run(w, c.prompt, r), c); const out = [...s.bad, ...s.miss.map((m) => `-${m}`), ...(flag('extras') ? s.plus : [])]; return out.length === 0 ? '✓' : out.join(' '); }).join(' / ');
      };
      rows.push(`| ${c.prompt} | ${cell('JEV 0.5')} | ${cell('JEV 0.5 + lokal füllt')} | ${cell('lokal')} |`);
    }
  }
  const n = aggs.get('lokal')!.want;
  console.log(`\n### Satz ${setName} (${cases.length} Prompts, ${n} erwartete Felder)\n`);
  if (rows.length > 0) console.log(`| Prompt | JEV 0,5 | JEV + lokal füllt | lokal |\n|---|---|---|---|\n${rows.join('\n')}\n`);
  console.log('| Weg | Feldtreffer (Mittel, Spanne) | Falschsetzungen | Zusatz-Kernfelder |\n|---|---|---|---|');
  for (const w of WAYS) {
    const a = aggs.get(w.name)!;
    console.log(`| ${w.name} | ${mean(a.hit).toFixed(1)}/${n} (${pct(mean(a.hit), n)}; ${span(a.hit)}) | ${mean(a.wrong).toFixed(1)} (${pct(mean(a.wrong), n)}; ${span(a.wrong)}) | ${mean(a.extra).toFixed(1)} |`);
  }
  const fields = setName === 'holdout' ? [] : Object.keys(aggs.get('lokal')!.field).sort(); // Holdout: nur Summen
  const pick = ['JEV 0.5', 'JEV 0.5 + lokal füllt', 'lokal'];
  if (fields.length > 0) console.log(`\n| Feld | ${pick.join(' | ')} |\n|---|${pick.map(() => '---').join('|')}|`);
  for (const f of fields) console.log(`| ${f} | ${pick.map((p) => { const [h, t] = aggs.get(p)!.field[f]!; return `${h}/${t}`; }).join(' | ')} |`);
  console.log(`\nJEV-Latenz: Median ${Math.round(quant(ms, 0.5))} ms, p90 ${Math.round(quant(ms, 0.9))} ms, p95 ${Math.round(quant(ms, 0.95))} ms, max ${Math.round(Math.max(...ms))} ms; Kosten ${cost.toFixed(5)} $ (${(cost / Math.max(1, ms.length - errors)).toFixed(6)} $/Prompt); Fehler ${errors}`);
}

// --- W7-L: Engine-Weg wie /v1/interpret (Beschreibungssätze): interpret() mit den aufgezeichneten Antworten ---
// Gleiche Bewertung wie `test/descriptions.test.ts` (Bautyp samt Rückfrage unter TYPE_CONFIDENCE_MIN, gebautes Theme,
// Größe, Dach, Lage, Etagen, Zustand), je Kombinationsmodus. Kein neuer Modellaufruf: die Antworten kommen aus dem Cache.
const DESCRIPTION_SETS: Record<string, readonly DescriptionCase[]> = { descriptions: DESCRIPTIONS, 'descriptions-holdout': DESCRIPTIONS_HOLDOUT };
const replay = (r: Raw): FetchLike => async () => ('error' in r
  ? { ok: false, status: 503, text: async () => r.error }
  : { ok: true, status: 200, text: async () => JSON.stringify({ model: r.model, answers: r.answers }) });
type EngineWay = { name: string; mode: 'local' | 'decisions'; combine?: CombineMode; min?: number };
const ENGINE_WAYS: EngineWay[] = [
  { name: 'lokal', mode: 'local' },
  { name: 'JEV allein (none)', mode: 'decisions', combine: 'none' },
  { name: 'JEV + lokal füllt (fill)', mode: 'decisions', combine: 'fill' },
  { name: 'JEV + lokal zuerst (local-first)', mode: 'decisions', combine: 'local-first' },
  ...(opt('min') !== undefined ? [] : [{ name: 'fill, Schwelle 0,5', mode: 'decisions' as const, combine: 'fill' as const, min: 0.5 }]),
];
const minConf = opt('min') !== undefined ? Number(opt('min')) : undefined;
async function engineWay(w: EngineWay, prompt: string, r: Raw) {
  return interpret(prompt, engine, w.mode === 'local'
    ? { apiKey: '', model: 'local', mode: 'local' }
    : { apiKey: 'replay', model: DEFAULT_MODEL, mode: 'decisions', fetch: replay(r), retries: 0, combine: w.combine!, ...(w.min ?? minConf) !== undefined ? { minConfidence: (w.min ?? minConf)! } : {} });
}
for (const setName of chosen.filter((s) => s in DESCRIPTION_SETS)) {
  const cases = DESCRIPTION_SETS[setName]!;
  console.log(`\n### Engine-Weg ${setName} (${cases.length} Beschreibungen × ${reps}; wie descriptions.test.ts, Mittel über Wiederholungen)\n`);
  console.log(`| Weg | ${DESCRIPTION_FIELDS.join(' | ')} | alle Felder | Rückfragen (Bautyp < ${TYPE_CONFIDENCE_MIN}) | Theme weggelassen | Rückfall lokal |`);
  console.log(`|---|${DESCRIPTION_FIELDS.map(() => '---').join('|')}|---|---|---|---|`);
  const perCase = new Map<string, string[]>();
  for (const w of ENGINE_WAYS) {
    const hits = Object.fromEntries(DESCRIPTION_FIELDS.map((f) => [f, [0, 0]])) as Record<DescriptionField, [number, number]>;
    let all = 0; let asks = 0; let noTheme = 0; let fallback = 0;
    for (const c of cases) {
      const marks: string[] = [];
      for (let rep = 0; rep < reps; rep++) {
        const it = await engineWay(w, c.text, await raw(c.text, rep));
        const input = it.request.input as Record<string, unknown>;
        const g = guessOf(input, it.confidence?.['buildingTypeId'], TYPE_CONFIDENCE_MIN, builtTheme(input, engine.vocabulary, FALLBACK_THEME_ID));
        if (g.type === ASK) asks++;
        if (input['themeId'] === undefined) noTheme++;
        if (it.fallback !== undefined) fallback++;
        const s = scoreDescriptions([c], () => g);
        for (const f of DESCRIPTION_FIELDS) { hits[f][0] += s.hits[f][0]; hits[f][1] += s.hits[f][1]; }
        all += s.all;
        marks.push(s.rows[0]!.split(' | ')[2]!.replace(/ \|$/, ''));
      }
      if (details) (perCase.get(c.text) ?? perCase.set(c.text, []).get(c.text)!).push(`${w.name}: ${[...new Set(marks)].join(' / ')}`);
    }
    const n = cases.length * reps;
    const cell = (h: number, t: number): string => (t === 0 ? '–' : `${(h / reps).toFixed(1)}/${t / reps}`);
    console.log(`| ${w.name} | ${DESCRIPTION_FIELDS.map((f) => cell(...hits[f])).join(' | ')} | ${cell(all, n)} | ${pct(asks, n)} | ${pct(noTheme, n)} | ${fallback} |`);
  }
  if (details) for (const [text, lines] of perCase) console.log(`- ${text}: ${lines.filter((l) => l.includes('✗')).join('; ') || 'alle ✓'}`);
  // JEV roh (ohne lokale Ergänzung, Schwelle Standard): was setzt das Modell selbst?
  let mood = 0; let moodN = 0; let story = 0; let storyN = 0; let setting = 0; let settingN = 0; let noted = 0; let notedN = 0;
  for (const c of cases) {
    for (let rep = 0; rep < reps; rep++) {
      const r = await raw(c.text, rep);
      if ('error' in r) continue;
      const input = decideIntent(plan, DECISIONS_OP, r.answers, minConf ?? DEFAULT_MIN_CONFIDENCE, {}).request.input as Record<string, unknown>;
      if (c.kind === 'stimmung' && c.theme !== undefined) { moodN++; if (c.theme.includes(String(input['themeId']))) mood++; }
      if (c.story !== undefined) { storyN++; if (input['storyState'] === c.story) story++; }
      if (c.setting !== undefined) { settingN++; if ((input['setting'] as { kind?: string } | undefined)?.kind === c.setting) setting++; }
    }
    if (c.setting !== undefined && !settingBuildable(c.setting)) {
      // Ehrlichkeit: nicht baubare Lage erkannt (fill) → building_generate nennt sie in notes
      notedN++;
      const it = await engineWay(ENGINE_WAYS[2]!, c.text, await raw(c.text, 0));
      if (JSON.stringify(engine.execute(it.request), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)).includes('nicht baubar')) noted++;
    }
  }
  console.log(`\nJEV allein (Schwelle ${minConf ?? DEFAULT_MIN_CONFIDENCE}): Stimmung→Theme ${mood}/${moodN}, Zustand ${story}/${storyN}, Lage ${setting}/${settingN}; nicht baubare Lage in notes gemeldet (fill, Wdh. 1): ${noted}/${notedN}`);
}

if (chatModel !== undefined) {
  // Chat-Modell (nur auf Wunsch, eine Wiederholung): Treffer und Falschsetzungen je Satz
  const model = chatModel === 'default' ? DEFAULT_CHAT_MODEL : chatModel;
  for (const setName of chosen) {
    let hit = 0; let want = 0; let wrong = 0; let cost = 0; const ms: number[] = [];
    for (const c of SETS[setName]!) {
      const t = performance.now();
      try {
        const it = await interpret(c.prompt, engine, { apiKey, model, mode: 'tools', fallback: false });
        ms.push(performance.now() - t);
        const s = score(it.request.input, c);
        hit += s.hit; want += s.want; wrong += s.wrong;
        cost += isObj(it.usage) && typeof it.usage['cost'] === 'number' ? it.usage['cost'] : 0;
      } catch { want += leaves(c.want as Json).length; }
    }
    console.log(`\nChat ${model}, Satz ${setName}: ${hit}/${want} (${pct(hit, want)}), falsch ${wrong}, Median ${Math.round(quant(ms, 0.5))} ms, ${cost.toFixed(5)} $`);
  }
}

writeFileSync(cacheFile, JSON.stringify(cache));
console.log(`\nNeu bezahlt in diesem Lauf: ${calls} Aufrufe, ${spent.toFixed(5)} $; unbeantwortet (Fehler/offline/Deckel): ${failed.size}`);
