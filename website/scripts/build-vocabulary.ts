/**
 * Vokabular des KI-Architekten (`ki/vocabulary.json`): Namen statt IDs für die Plan-Karte.
 *  - Bautypen, Themes, Paletten aus dem Katalog (über `nodeContext`, wie build-gallery.ts)
 *  - Feldnamen und Optionstexte aus dem Eingabeschema von `building_generate` – dieselben Beschreibungen, aus denen die
 *    Engine das Entscheidungsmodell JEV fragt (`optionText`, z. B. `shell.roof`: `hip` → „Walmdach“). Ein neuer
 *    Enum-Wert oder ein neues Feld erscheint so ohne Änderung an der Website.
 * Deterministisch (sortiert, ohne Zeitstempel).
 *
 * Aufruf (Repo-Wurzel): npx tsx website/scripts/build-vocabulary.ts [ausgabeordner]   (Standard: website/dist)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, optionText, type EngineContext } from '../../packages/engine/src/index.js';
// Schwelle für den Bautyp wie Engine und Editor (`@mcda/engine/intent`): darunter „Kein Bautyp erkannt“ (Review R1-02)
import { TYPE_CONFIDENCE_MIN } from '../../packages/engine/src/intent/browser.js';
import { BUILDABLE_SETTINGS } from '../../packages/pipeline/src/index.js';
import { nodeContext } from '../../packages/pipeline/src/node-context.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const ctx = nodeContext(join(here, '../../catalog'));
const engine = createEngine(ctx as EngineContext);
const out = resolve(process.argv[2] ?? join(here, '../dist'));

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Etagen je Größe: Zahl oder [min, max] wie im Katalog. */
const floorsOf = (f: unknown): [number, number] | undefined => {
  if (typeof f === 'number') return [f, f];
  if (Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === 'number')) return [f[0] as number, f[1] as number];
  return undefined;
};

const buildingTypes = Object.fromEntries(ctx.buildingTypes.ids().sort().map((id) => {
  const d = ctx.buildingTypes.get(id);
  const sizes = Object.fromEntries(Object.entries(d.sizes ?? {}).flatMap(([s, v]) => {
    const f = floorsOf((v as { floors?: unknown }).floors);
    return f === undefined ? [] : [[s, f]];
  }));
  return [id, {
    name: d.name,
    ...(d.label !== undefined && d.label !== d.name ? { label: d.label } : {}),
    ...(Object.keys(sizes).length > 0 ? { sizes } : {}),
    ...(d.status === 'draft' ? { draft: true } : {}),
  }];
}));
const themes = Object.fromEntries(ctx.themes.ids().sort().map((id) => [id, ctx.themes.get(id).name]));
const palettes = Object.fromEntries(engine.vocabulary.palettes.map((p) => [p.id, p.name]));

/**
 * Felder von `building_generate` (Pfad → Thema und Optionstexte). Thema = Beschreibung bis zum ersten Doppelpunkt,
 * ohne Verweise; Optionen für Enums und für Zahlen/Booleans, deren Beschreibung „wert = Text“ nennt.
 */
const fields: Record<string, { topic: string; options?: Record<string, string> }> = {};
const topicOf = (description: string, parent: string): string => {
  // ohne Verweise („(siehe …)“), Optionen in Klammern („(0 = aus)“) und interne Kürzel („(K8)“, „(Q5/P15)“)
  let t = description.split(':')[0]!.replace(/\s*\((?:siehe[^)]*|[^)]*=[^)]*|[A-Z]\d+(?:\/[A-Z]\d+)*)\)/g, '').replace(/;.*$/, '').trim();
  if ((t.match(/\(/g) ?? []).length > (t.match(/\)/g) ?? []).length) t = t.slice(0, t.lastIndexOf('(')).trim();
  // „false = keine Fenster“ ist eine Option, kein Thema: dann das Thema des übergeordneten Objekts
  return t.includes('=') || t === '' ? parent : t;
};
const walk = (node: Json, path: string, parent: string): void => {
  const description = typeof node['description'] === 'string' ? node['description'] : '';
  const props = node['properties'];
  if (isObj(props)) {
    const topic = path === '' ? '' : topicOf(description.split(',')[0]!, parent);
    if (path !== '') fields[path] = { topic };
    for (const [k, v] of Object.entries(props)) if (isObj(v)) walk(v, path === '' ? k : `${path}.${k}`, topic);
    return;
  }
  const topic = topicOf(description, parent);
  const values: unknown[] = Array.isArray(node['enum']) ? node['enum']
    : node['type'] === 'boolean' ? [true, false]
      : node['type'] === 'integer' || node['type'] === 'number' ? [0, 1, 2]
        : [];
  const options = Object.fromEntries(values.flatMap((v) => {
    const text = optionText(description, String(v));
    return text === undefined ? [] : [[String(v), text]];
  }));
  fields[path] = { topic, ...(Object.keys(options).length > 0 ? { options } : {}) };
};
walk(engine.inputSchema('building_generate'), '', '');

const vocabulary = { buildingTypes, themes, palettes, fields, typeConfidenceMin: TYPE_CONFIDENCE_MIN,
  // Lagen, die der Generator heute wirklich baut; andere zeigt die Plan-Karte als „wird noch nicht gebaut“ (R2-02)
  buildableSettings: [...BUILDABLE_SETTINGS].sort(),
};
mkdirSync(join(out, 'ki'), { recursive: true });
writeFileSync(join(out, 'ki/vocabulary.json'), `${JSON.stringify(vocabulary, null, 1)}\n`);
console.log(`→ ${join(out, 'ki/vocabulary.json')}: ${Object.keys(buildingTypes).length} Bautypen, ${Object.keys(themes).length} Themes, ${Object.keys(fields).length} Felder`);
