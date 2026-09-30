/**
 * Fragen für ein Entscheidungsmodell (System One / Decisions-API, z. B. JEV `typesafe/jev-1.13`) – automatisch aus dem
 * JSON Schema einer Operation und dem Vokabular abgeleitet, kein zweiter Vertrag:
 *
 * - Enum → `choice`; criteria = Katalog-Label (Name – Beschreibung) bzw. der Optionstext aus `.describe()`
 *   (`id = Text`), plus Option {@link NOT_SPECIFIED}.
 * - Geordnete Skala (Größe S/M/L, Dachneigung) → `score` plus `noul`-Tor „nennt die Bitte das überhaupt?“.
 * - Boolean → `noul` auf den Wert, der vom Standard abweicht (Standard true bzw. „false = …“ → false, sonst true).
 * - Kleiner Zahlenbereich (≤ {@link MAX_RANGE} Werte, z. B. Etagen 1–8) → `choice` über die Zahlen.
 * - Verschachtelte Objekte rekursiv; Freitext, Listen und große Zahlenbereiche (Seed) sind nicht fragbar → der lokale
 *   Klassifikator liefert sie (z. B. „seed 7“).
 *
 * Neues Enum-Feld, neuer Enum-Wert oder neuer Katalog-Eintrag im Schema = neue Frage bzw. Option ohne Code-Änderung
 * (`test/decisions.test.ts`). Rein und deterministisch; der HTTP-Aufruf liegt in `src/node/decisions.ts` (über `@mcda/classify`).
 */
import { MAX_CHOICES, splitChoices } from '@mcda/classify';
import type { EngineRequest } from '../engine.js';
import { ROOF_PITCHES } from '../style.js';
import { MOOD_THEMES } from './local.js';
import { SIZE_CLASSES, type Label, type Vocabulary } from '../vocabulary.js';

/** Option „die Bitte sagt dazu nichts“ in jeder `choice`-Frage. */
export const NOT_SPECIFIED = 'not_specified';
/** Größter Zahlenbereich, der als `choice` gefragt wird (Etagen 1–8, Takte 0–8); größere (Seed) sind nicht fragbar. */
export const MAX_RANGE = 12;
/** Höchstzahl Optionen je `choice`-Frage bei JEV (aus `@mcda/classify`, Live-Befund „Must have at most 255 choices“). */
export { MAX_CHOICES };
/**
 * Standard-Schwelle für Konfidenz bzw. P(ja), siehe `plan/spikes/E1_engine_api.md` „J2 Treffsicherheit“: mit dem
 * lokalen Ergänzen (`fill`) bei 0,6 keine Falschsetzung im Trainingsteil, bei 0,5 setzte JEV unsichere Bautypen
 * (0,5–0,6) falsch; fehlende Felder füllt der lokale Klassifikator.
 */
export const DEFAULT_MIN_CONFIDENCE = 0.6;

/**
 * Vorspann jeder Frage. Live gemessen (23 Prompts, je 2 Läufe): mit Vorspann 54/57 Feldtreffer, ohne 52/57 –
 * ohne ihn verwechselt JEV u. a. „drei Etagen“ und „ohne Deko“.
 */
const CONTEXT = 'Die Bitte beschreibt ein Minecraft-Gebäude. ';

/** Geordnete Skalen (score statt choice): Werte in aufsteigender Reihenfolge. */
const ORDERED_SCALES: ReadonlyArray<readonly string[]> = [SIZE_CLASSES, ROOF_PITCHES];

export type DecisionQuestion =
  | { readonly type: 'choice'; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
  | { readonly type: 'noul'; readonly instructions: string; readonly criteria: { readonly true: string; readonly false: string } }
  | { readonly type: 'score'; readonly instructions: string; readonly criteria: readonly string[] };

export type DecisionAnswer =
  | { readonly type: 'choice'; readonly choice: string; readonly confidence?: number; readonly probabilities?: Readonly<Record<string, number>> }
  | { readonly type: 'noul'; readonly noul: number }
  | { readonly type: 'score'; readonly score: number; readonly confidence?: number; readonly probabilities?: Readonly<Record<string, number>> };

/** Wie aus Antworten ein Feld wird. `keys`: eine Frage, bei mehr als {@link MAX_CHOICES} Optionen mehrere Teile. */
export type FieldPlan =
  | { readonly kind: 'choice'; readonly path: string; readonly keys: readonly string[]; readonly values: Readonly<Record<string, unknown>> }
  | { readonly kind: 'score'; readonly path: string; readonly key: string; readonly gate: string; readonly levels: readonly unknown[] }
  | { readonly kind: 'noul'; readonly path: string; readonly key: string; readonly value: boolean };

export interface DecisionPlan {
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
  readonly fields: readonly FieldPlan[];
  /** Nicht fragbare Felder mit Grund (Freitext, Liste, großer Zahlenbereich). */
  readonly skipped: ReadonlyArray<{ readonly path: string; readonly reason: string }>;
  /** Pflichtfelder je Objekt-Pfad ('' = oberste Ebene): fehlt eins, fällt das Objekt weg (bzw. der lokale Wert gilt). */
  readonly required: Readonly<Record<string, readonly string[]>>;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Optionstext aus der Feldbeschreibung: „…: flat = Flachdach, hip = Walmdach; …“ → `flat` → „Flachdach“. Kommas und
 * Semikolons in Klammern gehören zum Text („schem = Schematic (WorldEdit, .schem)“), eine schließende Klammer, die im
 * Text nicht geöffnet wurde, beendet ihn („Traufkonsolen alle n Blöcke (0 = aus)“ → „aus“). W7-L: ein Satzende (Punkt nach
 * einem Wort ab 3 Buchstaben, dann Großbuchstabe) beendet ihn auch – sonst hing ein Satzanhang der Feldbeschreibung an
 * der letzten Option („underwater = unter Wasser. Gebaut werden heute nur …“); „z. B. Xy“ bleibt ganz.
 */
export function optionText(description: string, id: string): string | undefined {
  const m = new RegExp(`(?:^|[\\s,;:(])${esc(id)}\\s*=\\s*`).exec(description);
  if (m === null) return undefined;
  let depth = 0;
  let end = description.length;
  for (let i = m.index + m[0].length; i < description.length; i++) {
    const c = description[i]!;
    if (c === '(') depth++;
    else if (c === ')' && depth-- === 0) { end = i; break; } else if ((c === ',' || c === ';') && depth === 0) { end = i; break; }
    else if (c === '.' && depth === 0 && /\p{L}{3}$/u.test(description.slice(0, i)) && /^\s+\p{Lu}/u.test(description.slice(i + 1))) { end = i; break; }
  }
  const text = description.slice(m.index + m[0].length, end).trim();
  return text === '' ? undefined : text;
}

/** Thema der Frage: Beschreibung bis zum ersten Doppelpunkt, ohne Verweise („(siehe …)“). */
const topicOf = (description: string): string => description.split(':')[0]!.replace(/\s*\(siehe[^)]*\)/, '').trim();

type CatalogKind = 'buildingTypes' | 'themes' | 'palettes' | 'roomTypes' | 'terrainStyles';

/** Höchstzahl Stimmungswörter je Theme-Option (aus {@link MOOD_THEMES}). */
const MOOD_WORDS = 3;
const unfold = (w: string): string => w.replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü');
/** Stimmungswörter eines Themes für die Theme-Option, Umlaute zurück („duester“ → „düster“). */
export function moodWords(themeId: string): readonly string[] {
  const out: string[] = [];
  for (const w of MOOD_THEMES[themeId] ?? []) {
    // Schreibvarianten nur einmal („orientalisch“/„oriental“, „cozy“/„cosy“)
    const stem = (x: string): string => x.replace(/z/g, 's').slice(0, 4);
    if (out.length < MOOD_WORDS && !out.some((o) => stem(o) === stem(w))) out.push(w);
  }
  return out.map(unfold);
}

/**
 * Katalog-Labels, deren IDs genau die Enum-Werte sind (Bautypen, Themes, Paletten, Raumtypen, Geländestile).
 * W7-L: Entwürfe (`draft`) werden nicht angeboten – live wählte JEV „Reihenhäuser“ sicher als Entwurf `townhouse_row`,
 * den der lokale Klassifikator ebenfalls nie setzt. Theme-Optionen nennen die Stimmungswörter aus {@link MOOD_THEMES}
 * (JEV allein traf Stimmung → Theme vorher 3/18 im Kontrollsatz).
 */
function catalogLabels(values: readonly string[], vocab: Vocabulary): { kind: CatalogKind; labels: ReadonlyMap<string, string>; drafts: ReadonlySet<string> } | undefined {
  for (const kind of ['buildingTypes', 'themes', 'palettes', 'roomTypes', 'terrainStyles'] as const) {
    const list: readonly Label[] = vocab[kind];
    if (list.length === 0 || list.length !== values.length || !list.every((l, i) => l.id === values[i])) continue;
    return {
      kind,
      labels: new Map(list.map((l) => {
        const mood = kind === 'themes' ? moodWords(l.id) : [];
        return [l.id, `${l.name}${l.description !== undefined ? ` – ${l.description}` : ''}${mood.length > 0 ? ` (Stimmung: ${mood.join(', ')})` : ''}`];
      })),
      drafts: new Set(list.filter((l) => 'draft' in l && l.draft === true).map((l) => l.id)),
    };
  }
  return undefined;
}

/** Wortstamm zum Vergleich: klein, Umlaute gefaltet, nur Buchstaben. */
const fold = (s: string): string => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z]+/g, ' ');

/**
 * Bautyp-Wörter, die einen Theme-Namen enthalten („Fachwerkhaus“ ↔ Theme Fachwerk, „Bauernhaus“ ↔ Bauernhof,
 * „Nordic-Langhaus“ ↔ nordic): aus dem Katalog abgeleitet (gemeinsamer Wortanfang ab {@link STEM} Zeichen von Theme-ID
 * oder -Name in Bautyp-ID oder -Name). JEV nahm solche Wörter live als Theme („Fachwerkhaus, rustikal“ → timber).
 */
const STEM = 6;
export function typeThemeOverlaps(vocab: Vocabulary): ReadonlyArray<{ readonly type: Label; readonly theme: Label }> {
  const out: Array<{ type: Label; theme: Label }> = [];
  for (const type of vocab.buildingTypes) {
    const words = fold(`${type.id} ${type.name}`).split(' ').filter((w) => w.length >= STEM);
    for (const theme of vocab.themes) {
      const stems = [theme.id, theme.name].map((x) => fold(x).trim()).filter((x) => x.length >= STEM).map((x) => x.slice(0, STEM));
      if (stems.some((st) => words.some((w) => w.startsWith(st)))) out.push({ type, theme });
    }
  }
  return out;
}

/** Zusatz der Theme-Frage: Theme = Stil-/Materialangabe; Bautyp-Wörter aus {@link typeThemeOverlaps} nennen kein Theme. */
function themeHint(vocab: Vocabulary): string {
  const pairs = typeThemeOverlaps(vocab).filter(({ type }) => !('draft' in type && type.draft === true));
  const names = pairs.map(({ type, theme }) => `„${type.name.replace(/\s*\(.*\)$/, '')}“ = Bautyp ${type.id}, nicht Theme ${theme.id}`);
  return ` Gemeint ist Stil, Material oder Umgebung (ein Adjektiv, „im …-Stil“ oder ein Theme-Name).${names.length > 0 ? ` Das Bautyp-Wort allein ist noch kein Theme (${names.join('; ')}); ein eigenes Stilwort daneben zählt.` : ''}`;
}

/** Enum-Werte eines Schema-Knotens (`enum` oder `anyOf`/`oneOf` aus `const`), sonst undefined. */
function enumValues(node: Json): readonly (string | number)[] | undefined {
  if (Array.isArray(node['enum'])) return node['enum'] as (string | number)[];
  const alts = (node['anyOf'] ?? node['oneOf']) as unknown;
  if (Array.isArray(alts) && alts.length > 0 && alts.every((a) => isObj(a) && a['const'] !== undefined)) return alts.map((a) => (a as Json)['const'] as string | number);
  return undefined;
}

/**
 * Fragen und Abbildung aus dem JSON Schema einer Operation (z. B. `engine.inputSchema('building_generate')`).
 * `maxChoices` nur für Tests kleiner als {@link MAX_CHOICES}.
 */
export function decisionPlan(schema: Json, vocab: Vocabulary, maxChoices: number = MAX_CHOICES): DecisionPlan {
  const questions: Record<string, DecisionQuestion> = {};
  const fields: FieldPlan[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const required: Record<string, readonly string[]> = {};
  const typeKeys: string[] = [];

  const choice = (path: string, description: string, entries: ReadonlyArray<readonly [string, unknown, string]>, hint = ''): void => {
    // Optionstexte stehen in den criteria; die volle Beschreibung nur, wenn sie mehr sagt als das Thema (Etagen …)
    const topic = topicOf(description);
    const detail = entries.some(([id, , text]) => text !== id) ? '' : topic === description ? '' : ` (${description})`;
    const instructions = `${CONTEXT}${topic}${detail}:${hint} Welche Option verlangt die Bitte ausdrücklich oder eindeutig? Sagt sie dazu nichts: ${NOT_SPECIFIED}.`;
    const chunks = splitChoices(entries, maxChoices, 1);
    const parts = chunks.length;
    const keys: string[] = [];
    for (const [p, chunk] of chunks.entries()) {
      const key = parts === 1 ? path : `${path}#${p + 1}`;
      questions[key] = {
        type: 'choice',
        instructions,
        criteria: {
          ...Object.fromEntries(chunk.map(([id, , text]) => [id, text])),
          [NOT_SPECIFIED]: parts === 1 ? 'Die Bitte sagt dazu nichts (nicht angegeben).' : 'Die Bitte sagt dazu nichts oder meint keine dieser Optionen.',
        },
      };
      keys.push(key);
    }
    fields.push({ kind: 'choice', path, keys, values: Object.fromEntries(entries.map(([id, value]) => [id, value])) });
  };

  const walk = (node: Json, path: string): void => {
    const description = typeof node['description'] === 'string' ? node['description'] : path;
    const values = enumValues(node);
    if (values !== undefined) {
      const ids = values.map(String);
      const scale = ORDERED_SCALES.find((s) => s.length === ids.length && s.every((x, i) => x === ids[i]));
      if (scale !== undefined) {
        const gate = `${path}#given`;
        questions[path] = {
          type: 'score',
          instructions: `${CONTEXT}Wo liegt die Bitte auf der Skala „${topicOf(description)}“?`,
          criteria: ids.map((id) => `${id}: ${optionText(description, id) ?? id}`),
        };
        questions[gate] = {
          type: 'noul',
          instructions: `${CONTEXT}Nennt die Bitte ausdrücklich eine Angabe zu „${topicOf(description)}“?`,
          criteria: { true: 'Die Bitte nennt dazu etwas.', false: 'Die Bitte sagt dazu nichts.' },
        };
        fields.push({ kind: 'score', path, key: path, gate, levels: values });
        return;
      }
      const catalog = catalogLabels(ids, vocab);
      choice(path, description, values.filter((v) => catalog?.drafts.has(String(v)) !== true).map((v) => {
        const id = String(v);
        const text = catalog?.labels.get(id) ?? optionText(description, id);
        return [id, v, text !== undefined ? `${id}: ${text}` : id] as const;
      }), catalog?.kind === 'themes' ? themeHint(vocab) : '');
      if (catalog?.kind === 'buildingTypes') typeKeys.push(...(fields[fields.length - 1] as { keys: readonly string[] }).keys);
      return;
    }
    const type = node['type'];
    if (type === 'boolean') {
      const falsy = /^false\s*=\s*(.+)$/.exec(description.split(';')[0]!.trim());
      const value = node['default'] === true || falsy !== null ? false : true;
      const what = falsy?.[1] ?? (value ? description.split(';')[0]!.trim() : `das Gegenteil von „${description}“ (also aus bzw. ohne)`);
      questions[path] = {
        type: 'noul',
        instructions: `${CONTEXT}Verlangt die Bitte ausdrücklich: ${what}?`,
        criteria: { true: `Die Bitte verlangt: ${what}.`, false: 'Die Bitte sagt dazu nichts oder will das Gegenteil.' },
      };
      fields.push({ kind: 'noul', path, key: path, value });
      return;
    }
    if (type === 'integer' || type === 'number') {
      const lo = node['minimum'];
      const hi = node['maximum'];
      if (typeof lo === 'number' && typeof hi === 'number' && hi - lo + 1 <= MAX_RANGE) {
        const nums = Array.from({ length: Math.floor(hi - lo) + 1 }, (_, i) => lo + i);
        choice(path, description, nums.map((n) => {
          const text = optionText(description, String(n));
          return [String(n), n, text !== undefined ? `${n}: ${text}` : String(n)] as const;
        }));
      } else skipped.push({ path, reason: typeof lo === 'number' && typeof hi === 'number' ? `Zahlenbereich zu groß (${hi - lo + 1} Werte)` : 'Zahl ohne Grenzen' });
      return;
    }
    if (type === 'object' && isObj(node['properties'])) {
      if (Array.isArray(node['required'])) required[path] = node['required'] as string[];
      for (const [k, child] of Object.entries(node['properties'])) if (isObj(child)) walk(child, path === '' ? k : `${path}.${k}`);
      return;
    }
    skipped.push({ path, reason: type === 'string' ? 'Freitext' : type === 'array' ? 'Liste' : `nicht fragbar (${JSON.stringify(type ?? node['anyOf'] ?? '?')})` });
  };
  walk(schema, '');
  // Bautyp-Frage: die übrigen Hauptangaben werden getrennt gefragt (live: „in den Berg gehauen“, „unterirdisch“ → hobbit)
  const others = separateTopics(fields, questions, typeKeys);
  if (others.length > 0) {
    for (const key of typeKeys) {
      const q = questions[key]!;
      questions[key] = { ...q, instructions: q.instructions.replace(/: Welche Option/, `: Nur die Gebäudeart; ${others.join(', ')} werden getrennt gefragt. Welche Option`) } as DecisionQuestion;
    }
  }
  return { questions, fields, skipped, required };
}

/**
 * Themen der Hauptangaben neben dem Bautyp: jedes Feld der obersten Ebene und je verschachteltem Objekt die erste
 * `choice`/`score`-Frage (Lage, Dachform, Deko-Menge) – nur `choice`/`score`, Thema bis zum ersten Komma.
 */
function separateTopics(fields: readonly FieldPlan[], questions: Readonly<Record<string, DecisionQuestion>>, exclude: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fields) {
    if (f.kind === 'noul' || f.path.split('.').length > 2) continue;
    const parent = f.path.includes('.') ? f.path.slice(0, f.path.lastIndexOf('.')) : f.path;
    if (seen.has(parent)) continue;
    const key = f.kind === 'score' ? f.key : f.keys[0]!;
    if (exclude.includes(key)) continue;
    seen.add(parent);
    const q = questions[key]!;
    const topic = /(?:Skala „([^“]+)“|Gebäude\. ([^:]+):)/.exec(q.instructions);
    const t = (topic?.[1] ?? topic?.[2] ?? f.path).split(/[,;(]/)[0]!.trim();
    if (t !== '') out.push(t);
  }
  return out;
}

const getPath = (obj: Json, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), obj);
function setPath(obj: Json, path: string, value: unknown): void {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (isObj(o[k]) ? o[k] : (o[k] = {})) as Json;
  o[keys[keys.length - 1]!] = value;
}
function deletePath(obj: Json, path: string): void {
  const keys = path.split('.');
  const parent = keys.length === 1 ? obj : getPath(obj, keys.slice(0, -1).join('.'));
  if (isObj(parent)) delete parent[keys[keys.length - 1]!];
}

export interface DecidedIntent {
  readonly request: EngineRequest;
  /** Konfidenz je übernommenem Feld (Pfad → 0–1). */
  readonly confidence: Readonly<Record<string, number>>;
  /** Felder aus dem lokalen Klassifikator (nicht fragbar oder Pflichtfeld ohne sichere Antwort). */
  readonly fromLocal: readonly string[];
}

/**
 * Antworten → Eingabe der Operation. Ein Feld gilt nur, wenn die Konfidenz (bei `noul`: P(ja); bei `score`: Tor und
 * Konfidenz) mindestens `minConfidence` ist und nicht {@link NOT_SPECIFIED} gewählt wurde. Objekte ohne ihre
 * Pflichtfelder fallen weg. Nicht fragbare Felder und fehlende Pflichtfelder der obersten Ebene kommen aus `local`
 * (lokaler Klassifikator). Das Ergebnis prüft der Aufrufer mit derselben zod-Validierung wie beim Chat-Modell.
 */
export function decideIntent(
  plan: DecisionPlan, op: EngineRequest['op'], answers: Readonly<Record<string, DecisionAnswer | undefined>>, minConfidence: number, local: Json,
): DecidedIntent {
  const input: Json = {};
  const confidence: Record<string, number> = {};
  const take = (path: string, value: unknown, conf: number): void => {
    if (conf < minConfidence) return;
    setPath(input, path, value);
    confidence[path] = Math.round(conf * 1000) / 1000;
  };
  for (const f of plan.fields) {
    if (f.kind === 'noul') {
      const a = answers[f.key];
      if (a?.type === 'noul' && Number.isFinite(a.noul)) take(f.path, f.value, a.noul);
    } else if (f.kind === 'score') {
      const a = answers[f.key];
      const g = answers[f.gate];
      if (a?.type !== 'score' || g?.type !== 'noul' || !Number.isFinite(a.score)) continue;
      const i = Math.min(f.levels.length - 1, Math.max(0, Math.round(a.score)));
      take(f.path, f.levels[i], Math.min(g.noul, a.confidence ?? a.probabilities?.[String(i)] ?? 0));
    } else {
      // Teilfragen (mehr als MAX_CHOICES Optionen): die sicherste Option, die nicht „nicht angegeben“ ist
      let best: { id: string; conf: number } | undefined;
      for (const key of f.keys) {
        const a = answers[key];
        if (a?.type !== 'choice' || a.choice === NOT_SPECIFIED || !(a.choice in f.values)) continue;
        const conf = a.confidence ?? a.probabilities?.[a.choice] ?? 0;
        if (best === undefined || conf > best.conf) best = { id: a.choice, conf };
      }
      if (best !== undefined) take(f.path, f.values[best.id], best.conf);
    }
  }
  // Objekte ohne Pflichtfelder weg (z. B. setting.front ohne setting.kind), tiefste zuerst
  for (const [path, req] of Object.entries(plan.required).sort(([a], [b]) => b.length - a.length)) {
    if (path === '') continue;
    const o = getPath(input, path);
    if (isObj(o) && req.some((k) => o[k] === undefined)) {
      deletePath(input, path);
      for (const k of Object.keys(confidence)) if (k.startsWith(`${path}.`)) delete confidence[k];
    }
  }
  const fromLocal: string[] = [];
  const fill = (path: string): void => {
    const v = getPath(local, path);
    if (v === undefined || getPath(input, path) !== undefined) return;
    setPath(input, path, v);
    fromLocal.push(path);
  };
  for (const s of plan.skipped) fill(s.path);
  for (const k of plan.required[''] ?? []) fill(k);
  return { request: { op, input }, confidence, fromLocal };
}

/** Wie JEV und lokaler Klassifikator zusammenwirken (`ENGINE_NL_COMBINE`). */
export type CombineMode = 'none' | 'fill' | 'local-first';
export const COMBINE_MODES: readonly CombineMode[] = ['none', 'fill', 'local-first'];
/**
 * Standard (W7-L, Live-Messung `plan/spikes/W7L_jev_live.md`): lokale Treffer schlagen JEV, JEV ergänzt den Rest. Auf
 * allen vier Sätzen gleich gut oder besser als `fill`, damit in keinem Feld schlechter als der lokale Klassifikator allein.
 */
export const DEFAULT_COMBINE: CombineMode = 'local-first';

const leavesOf = (o: Json, prefix = ''): Array<[string, unknown]> =>
  Object.entries(o).flatMap(([k, v]) => (isObj(v) ? leavesOf(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v] as [string, unknown]]));

/**
 * JEV-Ergebnis mit dem lokalen Klassifikator verbinden. `fill`: Felder, die der lokale Klassifikator ausdrücklich
 * erkannt hat und JEV weggelassen hat, kommen dazu. `local-first`: zusätzlich schlägt ein lokaler Treffer ein
 * abweichendes JEV-Feld. Der Bautyp zählt nur, wenn der lokale Klassifikator ihn erkannt hat (`localTypeMatched`),
 * nicht den Standard „house“. Rein; Felder aus `local` stehen in `fromLocal`.
 */
export function combineLocal(decided: DecidedIntent, local: Json, localTypeMatched: boolean, mode: CombineMode): DecidedIntent {
  if (mode === 'none') return decided;
  const input = structuredClone(decided.request.input) as Json;
  const confidence = { ...decided.confidence };
  const fromLocal = [...decided.fromLocal];
  for (const [path, value] of leavesOf(local)) {
    if (path === 'buildingTypeId' && !localTypeMatched) continue;
    const current = getPath(input, path);
    if (current === value) continue;
    if (current !== undefined && (mode !== 'local-first' || fromLocal.includes(path))) continue;
    setPath(input, path, value);
    delete confidence[path];
    if (!fromLocal.includes(path)) fromLocal.push(path);
  }
  return { request: { op: decided.request.op, input }, confidence, fromLocal };
}
