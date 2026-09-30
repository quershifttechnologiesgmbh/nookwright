/**
 * Wächter „Domäne rein“ (plan/03 §2 Abhängigkeitsregel, ADR 7; HANDOFF §3): Die Quellen der reinen Domänenpakete
 * enthalten kein I/O, keinen Prozess-/Umgebungszugriff, keinen Zufall außer aus Seeds, keine Uhr und kein DOM.
 *
 * Anlass (W1-F, 26.09.2026): Aus dem Q3-WIP (`1e50a9a`, `2b56f7f`) waren Diagnose-Globals und acht
 * `process.env['Q3_PROBE']`-Zweige in `packages/terrain/src` geblieben, obwohl der Bericht ihre Entfernung verlangte.
 * Dieser Test schlägt bei jeder Wiederholung an.
 *
 * Geprüft wird nur **Code**: Kommentare fallen vorher weg, Zeichenketten werden zu Platzhaltern (ihr Inhalt zählt nur
 * als Modulpfad eines Imports). „kein `Math.random`“ in einem Doc-Kommentar schlägt also nicht an.
 *
 * Umfang:
 *  - {@link PURE}: alle Regeln. Die Liste folgt plan/03 §2/§5 (`core`, `catalog`, `blueprint`, `furnishing`,
 *    `materialize`), HANDOFF §3 (Domänenkontexte `platform`, `voxel`, `terrain`, `structures`, `exterior`, `archetype`)
 *    und CLAUDE.md (`projectfile` „rein“); `evaluation` (A/B-Messung, plan/spikes/MX_messung.md).
 *  - {@link BOUNDED}: Anwendungs- und Exportdienste. Dort gilt nur: I/O und Prozesszugriff ausschließlich im erklärten
 *    Node-Adapter (Unterpfad `./node` in `package.json`), nirgends `Math.random` (die Pipeline muss deterministisch
 *    bleiben). Zeit ist erlaubt (`export` schreibt Zeitstempel in die Dateien).
 *  - Nicht geprüft: `engine`, `app`, `viewer`, `classify` – dort sind Adapter (HTTP, DOM, Env) der Zweck.
 *
 * Ausnahmen stehen einzeln mit Begründung in {@link EXCEPTIONS}; Adapter-Dateien dürfen von keiner anderen Datei des
 * Pakets importiert werden (sonst zöge `index.ts` das I/O in den reinen Kern).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative as relativeNative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
/** Relativer Pfad immer mit `/`: Ausnahmeliste und Befunde sind so auch unter Windows gleich. */
const relative = (from: string, to: string): string => relativeNative(from, to).split(sep).join('/');

/** Reine Domänenpakete: alle Regeln. */
const PURE = ['core', 'catalog', 'blueprint', 'furnishing', 'materialize', 'platform', 'voxel', 'terrain', 'structures', 'exterior', 'archetype', 'projectfile', 'evaluation'] as const;
/** Anwendungs-/Exportdienste mit erklärtem Node-Adapter: nur I/O-Grenze und Seeds. */
const BOUNDED = ['pipeline', 'export'] as const;

type RuleId = 'io' | 'process' | 'random' | 'time' | 'dom';

interface Rule {
  readonly id: RuleId;
  readonly why: string;
  readonly re: RegExp;
}

/** Muster im Code (ohne Kommentare, Zeichenketten als `"§n"`). Imports prüft {@link importViolations}. */
const RULES: readonly Rule[] = [
  { id: 'io', why: 'Dateisystem/Modulpfad (nur im Adapter)', re: /\bimport\s*\.\s*meta\b/g },
  { id: 'io', why: 'CommonJS-require (nur im Adapter)', re: /(?<![\w$.])require\s*\(/g },
  {
    id: 'process',
    why: 'Prozess/Umgebung (process.env, argv …): die Domäne bekommt alles als Argument',
    re: /(?<![\w$.])process\s*(?:\?\.|\.|\[)|\bglobalThis\s*(?:\?\.|\.)\s*process\b/g,
  },
  { id: 'random', why: 'Zufall nur aus Seeds (Rng, hashSeed)', re: /(?<![\w$.])Math\s*(?:\?\.|\.)\s*random\b|(?<![\w$.])crypto\s*(?:\?\.|\.)\s*(?:getRandomValues|randomUUID)\b/g },
  {
    id: 'time',
    why: 'keine Uhr in der Domäne',
    re: /(?<![\w$.])Date\s*(?:\?\.|\.)\s*now\b|\bnew\s+Date\s*\(\s*\)|(?<![\w$.])performance\s*(?:\?\.|\.)\s*now\b|(?<![\w$.])(?:setTimeout|setInterval|setImmediate)\s*\(/g,
  },
  {
    id: 'dom',
    why: 'kein DOM, kein Netz, kein Browser-Speicher',
    re: /(?<![\w$.])(?:window|document|navigator|localStorage|sessionStorage|indexedDB)\s*(?:\?\.|\.|\[)|(?<![\w$.])fetch\s*\(|\b(?:XMLHttpRequest|WebSocket|EventSource)\b/g,
  },
];

/** Node-Builtins (mit und ohne `node:`); dazu die Adapter-Unterpfade anderer Pakete (`@mcda/<paket>/node`). */
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
const isIoModule = (spec: string): boolean => spec.startsWith('node:') || BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0]!) || /^@mcda\/[\w-]+\/node$/.test(spec);

/**
 * Ausnahmen (Pfad relativ zu `packages/`, Präfix mit `/` am Ende gilt für einen Ordner). Die `./node`-Adapter aus
 * `package.json` kommen automatisch dazu (Regeln `io` und `process`).
 */
const EXCEPTIONS: Readonly<Record<string, { readonly rules: readonly RuleId[]; readonly why: string }>> = {
  'platform/src/build/': {
    rules: ['io'],
    why: 'Build-Werkzeug (scripts/generate.ts, Tests): dekodiert den Block-Atlas mit node:zlib; nie aus index.ts erreichbar',
  },
  'projectfile/src/file.ts': {
    rules: ['time'],
    why: 'toProjectFile(c, savedAt = new Date()): Zeitstempel der gespeicherten Datei als überschreibbarer Standardwert',
  },
};

// ------------------------------------------------------------------ Quelltext ohne Kommentare

interface Stripped {
  /** Code ohne Kommentare; Zeichenketten als `"§<n>"`; Zeilenumbrüche bleiben erhalten (Zeilennummern). */
  readonly code: string;
  /** Inhalt der Zeichenketten in Reihenfolge (Index = n im Platzhalter). */
  readonly strings: readonly string[];
}

/** Wörter, nach denen `/` einen Regex beginnt (sonst Division). */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/** Kleiner Lexer für TS-Quelltext: Kommentare, Zeichenketten, Template-Literale (mit `${…}`) und Regex-Literale. */
function stripSource(src: string): Stripped {
  const strings: string[] = [];
  let code = '';
  let i = 0;
  let last = ''; // letztes bedeutsames Token: entscheidet, ob `/` einen Regex beginnt
  let depth = 0; // Tiefe geschweifter Klammern
  const open: number[] = []; // offene `${`: Tiefe beim Öffnen
  const newlines = (s: string): string => s.replace(/[^\n]/g, '');
  const placeholder = (value: string, raw: string): void => {
    strings.push(value);
    code += `"§${strings.length - 1}"${newlines(raw)}`;
    last = '"';
  };
  const templatePart = (start: number): void => {
    let value = '';
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\') {
        value += src.slice(i, i + 2);
        i += 2;
      } else if (c === '`') {
        i++;
        placeholder(value, src.slice(start, i));
        return;
      } else if (c === '$' && src[i + 1] === '{') {
        i += 2;
        placeholder(value, src.slice(start, i));
        code += ' ';
        open.push(depth++);
        last = '{';
        return;
      } else {
        value += c;
        i++;
      }
    }
    throw new Error('Template-Literal nicht geschlossen');
  };
  while (i < src.length) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Blockkommentar nicht geschlossen');
      code += newlines(src.slice(i, end + 2));
      i = end + 2;
    } else if (c === '"' || c === "'") {
      const start = i++;
      let value = '';
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\n') throw new Error(`Zeichenkette nicht geschlossen (Zeile ${src.slice(0, i).split('\n').length})`);
        if (src[i] === '\\') value += src[i++];
        value += src[i++];
      }
      i++;
      placeholder(value, src.slice(start, i));
    } else if (c === '`') {
      templatePart(i++);
    } else if (c === '}' && open.length > 0 && open[open.length - 1] === depth - 1) {
      open.pop();
      depth--;
      templatePart(i++);
    } else if (c === '/' && (last === '' || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || REGEX_AFTER_WORD.has(last))) {
      const start = i++;
      let inClass = false;
      while (i < src.length && (inClass || src[i] !== '/')) {
        if (src[i] === '\n') throw new Error(`Regex nicht geschlossen (Zeile ${src.slice(0, i).split('\n').length})`);
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i++;
      }
      i++;
      while (i < src.length && /[a-z]/.test(src[i]!)) i++;
      code += `/r/${newlines(src.slice(start, i))}`;
      last = 'r';
    } else if (/[\w$]/.test(c)) {
      const start = i;
      while (i < src.length && /[\w$]/.test(src[i]!)) i++;
      last = src.slice(start, i);
      code += last;
    } else if ((c === '!' && d !== '=') || ((c === '+' || c === '-') && d === c)) {
      // Nachgestelltes `x!` (Non-Null) bzw. `x++`/`x--` beendet einen Operanden: danach ist `/` eine Division
      const len = c === '!' ? 1 : 2;
      if (!endsOperand(last)) last = c;
      code += src.slice(i, i + len);
      i += len;
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (!/\s/.test(c)) last = c;
      code += c;
      i++;
    }
  }
  return { code, strings };
}

/** Endet das letzte Token einen Operanden (Bezeichner, Zahl, `)`, `]`, Zeichenkette, Regex)? */
function endsOperand(last: string): boolean {
  return last === ')' || last === ']' || last === '"' || last === 'r' || (/^[\w$]+$/.test(last) && !REGEX_AFTER_WORD.has(last));
}

// ------------------------------------------------------------------ Prüfung

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: RuleId;
  readonly text: string;
}

const lineOf = (code: string, index: number): number => code.slice(0, index).split('\n').length;

/** Imports (statisch, `export … from`, dynamisch, `require`) mit Modulpfad. */
function importsOf(s: Stripped): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = [];
  const re = /\b(?:from|import)\s*"§(\d+)"|\bimport\s*\(\s*"§(\d+)"|(?<![\w$.])require\s*\(\s*"§(\d+)"/g;
  for (const m of s.code.matchAll(re)) out.push({ spec: s.strings[Number(m[1] ?? m[2] ?? m[3])]!, line: lineOf(s.code, m.index) });
  return out;
}

function importViolations(file: string, s: Stripped, src: string): Finding[] {
  const lines = src.split('\n');
  return importsOf(s)
    .filter((imp) => isIoModule(imp.spec))
    .map((imp) => ({ file, line: imp.line, rule: 'io' as const, text: `${lines[imp.line - 1]!.trim()}  ← Node-Builtin bzw. Node-Adapter (${imp.spec})` }));
}

function ruleViolations(file: string, s: Stripped, src: string, rules: readonly RuleId[]): Finding[] {
  const lines = src.split('\n');
  const out: Finding[] = [];
  for (const r of RULES) {
    if (!rules.includes(r.id)) continue;
    for (const m of s.code.matchAll(r.re)) {
      const line = lineOf(s.code, m.index);
      out.push({ file, line, rule: r.id, text: `${lines[line - 1]!.trim()}  ← ${r.why}` });
    }
  }
  return out;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return tsFiles(p);
      return f.endsWith('.ts') ? [p] : [];
    });
}

/** Adapter-Dateien aus `package.json` (`exports["./node"]`), relativ zu `packages/`. */
function nodeAdapters(pkg: string): string[] {
  const json = JSON.parse(readFileSync(join(PACKAGES, pkg, 'package.json'), 'utf8')) as { exports?: Record<string, string> };
  const node = json.exports?.['./node'];
  return node === undefined ? [] : [relative(PACKAGES, resolve(PACKAGES, pkg, node))];
}

function exceptionFor(rel: string, adapters: readonly string[]): readonly RuleId[] {
  if (adapters.includes(rel)) return ['io', 'process'];
  const hit = Object.entries(EXCEPTIONS).find(([k]) => (k.endsWith('/') ? rel.startsWith(k) : rel === k));
  return hit === undefined ? [] : hit[1].rules;
}

/** Prüft ein Paket; `rules` = geltende Regeln. Liefert Befunde als lesbare Zeilen. */
function audit(pkg: string, rules: readonly RuleId[]): string[] {
  const adapters = nodeAdapters(pkg);
  const findings: Finding[] = [];
  const ioExempt = (rel: string): boolean => exceptionFor(rel, adapters).includes('io');
  for (const abs of tsFiles(join(PACKAGES, pkg, 'src'))) {
    const rel = relative(PACKAGES, abs);
    const src = readFileSync(abs, 'utf8');
    let s: Stripped;
    try {
      s = stripSource(src);
    } catch (e) {
      throw new Error(`${rel}: ${(e as Error).message}`);
    }
    // Selbstkontrolle des Lexers: gleiche Zeilenzahl, sonst stimmen Zeilennummern und Befunde nicht
    expect(s.code.split('\n').length, `${rel}: Zeilen nach dem Entfernen der Kommentare`).toBe(src.split('\n').length);
    const allowed = exceptionFor(rel, adapters);
    const active = rules.filter((r) => !allowed.includes(r));
    if (active.includes('io')) findings.push(...importViolations(rel, s, src));
    findings.push(...ruleViolations(rel, s, src, active));
    // Adapter bleiben Randdateien: kein Import aus dem reinen Teil des Pakets
    if (!ioExempt(rel)) {
      for (const imp of importsOf(s)) {
        if (!imp.spec.startsWith('.')) continue;
        const target = relative(PACKAGES, resolve(dirname(abs), imp.spec.replace(/\.js$/, '.ts')));
        if (ioExempt(target)) findings.push({ file: rel, line: imp.line, rule: 'io', text: `importiert die Adapter-Datei ${target}` });
      }
    }
  }
  return findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.text}`);
}

const ALL_RULES: readonly RuleId[] = ['io', 'process', 'random', 'time', 'dom'];
const BOUNDED_RULES: readonly RuleId[] = ['io', 'process', 'random'];

describe('Domäne rein (Wächter gegen I/O, Env, Zufall, Uhr und DOM in Domänenpaketen)', () => {
  it.each(PURE)('reines Paket %s: keine verbotenen Muster im Code', (pkg) => {
    expect(audit(pkg, ALL_RULES)).toEqual([]);
  });

  it.each(BOUNDED)('Dienst %s: I/O und Prozesszugriff nur im Node-Adapter, kein Math.random', (pkg) => {
    expect(nodeAdapters(pkg).length, `${pkg} erklärt einen ./node-Adapter`).toBe(1);
    expect(audit(pkg, BOUNDED_RULES)).toEqual([]);
  });

  it('Ausnahmen und Adapter zeigen auf vorhandene Dateien (keine veralteten Einträge)', () => {
    for (const k of [...Object.keys(EXCEPTIONS), ...[...PURE, ...BOUNDED].flatMap(nodeAdapters)]) {
      expect(statSync(join(PACKAGES, k), { throwIfNoEntry: false }), k).toBeDefined();
    }
    for (const pkg of [...PURE, ...BOUNDED]) expect(tsFiles(join(PACKAGES, pkg, 'src')).length, pkg).toBeGreaterThan(0);
  });
});

describe('Wächter selbst: Kommentare und Zeichenketten schlagen nicht an, Code schon', () => {
  const findings = (src: string, rules: readonly RuleId[] = ALL_RULES): string[] => {
    const s = stripSource(src);
    return [...importViolations('x.ts', s, src), ...ruleViolations('x.ts', s, src, rules)].map((f) => `${f.line}:${f.rule}`);
  };

  it('Kommentare und Texte mit „Math.random“, „process.env“, „node:fs“ sind erlaubt', () => {
    const src = [
      '/** Deterministisch: kein Math.random, kein process.env, kein Date.now(). */',
      "// import { readFileSync } from 'node:fs';",
      "const hint = 'nie Math.random() oder process.env nutzen'; /* window.document */",
      'const url = "https://example.org/fetch(x)"; // new Date()',
      'const re = /\\/\\/ process.env/g;',
      'const t = `Text mit Math.random und ${hint.length} // kein Kommentar`;',
      'const ratio = a / b / c; // Division, kein Regex',
    ].join('\n');
    expect(findings(src)).toEqual([]);
  });

  it('echter Code schlägt an: Env, Zufall, Uhr, DOM, Builtin- und Adapter-Import, auch in `${…}`', () => {
    const src = [
      "import { readFileSync } from 'node:fs';",
      "import { join } from 'path';",
      "export { loadRegistry } from '@mcda/platform/node';",
      "if (process.env['Q3_PROBE'] !== undefined) probe = null;",
      'const r = Math.random();',
      'const t = `${Date.now()}`;',
      'const now = new Date();',
      'document.title = "x";',
      "const z = await import('node:zlib');",
    ].join('\n');
    expect(findings(src)).toEqual(['1:io', '2:io', '3:io', '9:io', '4:process', '5:random', '6:time', '7:time', '8:dom']);
  });

  it('Lexer erhält Zeilen und liest verschachtelte Template-Literale', () => {
    const s = stripSource('const a = `x${`y${"z"}`}w`;\n/* a\nb */ const b = 1;');
    expect(s.code.split('\n')).toHaveLength(3);
    expect(s.strings).toEqual(['x', 'y', 'z', '', 'w']);
    expect(s.code).not.toContain('/*');
  });
});
