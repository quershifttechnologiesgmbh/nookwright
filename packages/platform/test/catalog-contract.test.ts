/**
 * Vertragstest Katalog ↔ Plattform: Was der Katalog (catalog/components/**.json5) an Blöcken und
 * Rollen/Formen benutzt, muss in beiden Zielversionen auflösbar sein.
 *
 * Bewusst ohne Abhängigkeit zu @mcda/catalog (die Plattform kennt den Katalog nicht, Domain Design §2.2):
 * Die Dateien werden per Textsuche gelesen (`block: "…"`, `role: "…", shape: "…"`). Versions-gebundene
 * Komponenten (`minVersion`) gibt es im Katalog noch nicht; sobald es sie gibt, gehört dieser Test mit dem
 * echten Katalog-Parser nach `materialize` (Roadmap-M1-Test: Rolle × Form × Theme × Version).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS, resolveMaterial, type PropertyMap } from '../src/index.js';
import { loadFamilies, loadRegistry } from '../src/node.js';

const CATALOG_DIR = fileURLToPath(new URL('../../../catalog/components', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });
}

const files = walk(CATALOG_DIR).map((f) => ({ rel: relative(CATALOG_DIR, f).replaceAll('\\', '/'), text: readFileSync(f, 'utf8') }));

/** Feste Block-IDs → Dateien, in denen sie vorkommen. */
const fixedBlocks = new Map<string, string[]>();
/** Rolle → Formen, die der Katalog benutzt. */
const usedShapes = new Map<string, Set<string>>();
for (const { rel, text } of files) {
  for (const m of text.matchAll(/\bblock\s*:\s*["']([^"']+)["']/g)) {
    const id = m[1] as string;
    fixedBlocks.set(id, [...(fixedBlocks.get(id) ?? []), rel]);
  }
  const pairs = [
    ...[...text.matchAll(/\brole\s*:\s*["']([a-z0-9_]+)["']\s*,\s*shape\s*:\s*["']([a-z0-9_]+)["']/g)].map((m) => [m[1], m[2]]),
    ...[...text.matchAll(/\bshape\s*:\s*["']([a-z0-9_]+)["']\s*,\s*role\s*:\s*["']([a-z0-9_]+)["']/g)].map((m) => [m[2], m[1]]),
  ];
  for (const [role, shape] of pairs) {
    if (role === undefined || shape === undefined) continue;
    usedShapes.set(role, (usedShapes.get(role) ?? new Set()).add(shape));
  }
}

/**
 * Stellvertreter für Themes: je Rolle repräsentative Familien, die in beiden Zielversionen jede benutzte
 * Form DIREKT (ohne Fallback) haben müssen. Die Formen stammen aus dem Katalog; die hier genannten sind
 * der Stand bei Übernahme und werden immer geprüft.
 */
const ROLE_FAMILIES: Readonly<Record<string, { families: readonly string[]; shapes: readonly string[] }>> = {
  furniture_wood: { families: ['oak', 'spruce', 'dark_oak', 'pale_oak', 'crimson', 'bamboo'], shapes: ['stairs', 'slab', 'fence', 'pressure_plate'] },
  textile_primary: { families: ['red_wool', 'white_wool', 'color:red'], shapes: ['bed'] },
  light_hanging: { families: ['iron', 'copper', 'waxed_oxidized_copper'], shapes: ['lantern'] },
  metal: { families: ['iron', 'copper'], shapes: ['chain'] },
};

/** States, die die Orientierungen des Katalogs brauchen (orient → Properties), je Form. */
const ORIENT_STATES: Readonly<Record<string, PropertyMap>> = {
  stairs: { facing: 'east', half: 'bottom' }, // Stuhl: Lehne hinten
  slab: { type: 'top' }, // Tischplatte: upsideDown
  bed: { part: 'head', facing: 'east' },
  lantern: { hanging: 'true' },
  chain: { axis: 'y' },
};

describe('Katalog-Dateien (Textsuche)', () => {
  it('findet Katalog-Dateien, feste Blöcke und Rollen/Formen', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(fixedBlocks.size).toBeGreaterThan(0);
    expect(usedShapes.size).toBeGreaterThan(0);
  });
});

describe.each(TARGET_VERSIONS)('Katalog ↔ Plattform %s', (version) => {
  const reg = loadRegistry(version);
  const fam = loadFamilies(version);

  it('(a) alle festen Block-IDs des Katalogs existieren', () => {
    const missing = [...fixedBlocks].filter(([id]) => !id.startsWith('minecraft:') || !reg.hasBlock(id)).map(([id, where]) => `${id} (${where.join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('(b) Rollen/Formen lösen über repräsentative Familien zu gültigen Blöcken auf', () => {
    const problems: string[] = [];
    const roles = new Set([...Object.keys(ROLE_FAMILIES), ...usedShapes.keys()]);
    for (const role of roles) {
      const known = ROLE_FAMILIES[role];
      const shapes = new Set([...(known?.shapes ?? []), ...(usedShapes.get(role) ?? [])]);
      for (const shape of shapes) {
        if (known === undefined) {
          // Neue Rolle ohne Stellvertreter: mindestens eine Familie muss die Form auflösen können
          const any = Object.keys(fam.families).some((f) => {
            const r = resolveMaterial(fam, f, shape);
            return r !== undefined && reg.hasBlock(r.block);
          });
          if (!any) problems.push(`${role}+${shape}: Form existiert in keiner Familie`);
          continue;
        }
        for (const family of known.families) {
          const r = resolveMaterial(fam, family, shape);
          if (r === undefined) problems.push(`${role}+${shape} über ${family}: nicht auflösbar`);
          else if (r.viaFallback) problems.push(`${role}+${shape} über ${family}: nur per Fallback (${r.block})`);
          else if (!reg.isValidState(r.block, ORIENT_STATES[shape] ?? {})) {
            problems.push(`${role}+${shape} über ${family}: ${r.block} ungültig mit ${JSON.stringify(ORIENT_STATES[shape] ?? {})}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('(b) Kette heißt seit 1.21.9 iron_chain, Laterne ist die Eisen-Laterne', () => {
    expect(resolveMaterial(fam, 'iron', 'chain')).toEqual({ block: 'iron_chain', family: 'iron', shape: 'chain', viaFallback: false });
    expect(resolveMaterial(fam, 'iron', 'lantern')?.block).toBe('lantern');
    expect(resolveMaterial(fam, 'copper', 'chain')?.block).toBe('copper_chain');
    expect(resolveMaterial(fam, 'oak', 'stairs')?.block).toBe('oak_stairs');
    expect(resolveMaterial(fam, 'color:red', 'bed')?.block).toBe('red_bed');
  });
});

describe('Kette vor 1.21.9 (Vergleichsversion 1.21.1)', () => {
  it('iron + chain → chain; feste ID wird je Version migriert', () => {
    expect(resolveMaterial(loadFamilies('1.21.1'), 'iron', 'chain')?.block).toBe('chain');
    expect(loadRegistry('1.21.1').migrateBlockName('minecraft:iron_chain')).toBe('chain');
    expect(loadRegistry('26.3').migrateBlockName('minecraft:chain')).toBe('iron_chain');
  });
});
