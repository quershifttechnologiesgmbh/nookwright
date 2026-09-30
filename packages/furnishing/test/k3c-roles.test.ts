/**
 * K3c (research/17 Y5/Y12): neue Item-Rollen im Theme (`trophy.any`, `bakery.any`, `pottery.any`, `textile.any`,
 * `treasure.any`) und die Formen `furniture_wood.shelf`/`trapdoor`, `textile_*.wool` lösen in jedem Theme und jeder
 * Zielversion auf – ohne Änderung an der Materialisierung (Rollen-Schnappschuss wie materialize/theme-resolution).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ThemeCatalog, parseThemeDef } from '@mcda/catalog';
import { Rng } from '@mcda/core';
import { ThemeResolver } from '@mcda/materialize';
import { TARGET_VERSIONS } from '@mcda/platform';
import { loadFamilies, loadRegistry } from '@mcda/platform/node';

const DIR = fileURLToPath(new URL('../../../catalog/themes', import.meta.url));
const themes = ThemeCatalog.of(
  readdirSync(DIR).filter((f) => f.endsWith('.json5')).map((f) => {
    const r = parseThemeDef(readFileSync(join(DIR, f), 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  }),
);

const ITEM_ROLES = ['trophy.any', 'bakery.any', 'pottery.any', 'textile.any', 'treasure.any'];
const SHAPES: readonly (readonly [string, string])[] = [
  ['furniture_wood', 'shelf'], ['furniture_wood', 'trapdoor'], ['textile_primary', 'wool'], ['textile_accent', 'wool'], ['textile_neutral', 'wool'],
];

describe('Item-Rollen (Y5) und Rollen-Formen (Y12) in jedem Theme und jeder Zielversion', () => {
  for (const version of TARGET_VERSIONS) {
    it(version, () => {
      const registry = loadRegistry(version);
      const families = loadFamilies(version);
      for (const id of themes.ids()) {
        const resolver = new ThemeResolver(themes.get(id), families, registry);
        for (const role of ITEM_ROLES) {
          // jedes gelistete Item existiert in der Version (sonst würde die Auswahl je Seed schwanken)
          expect(themes.get(id).items[role]?.every((i) => registry.hasItem(i.replace('minecraft:', ''))), `${id} ${role}`).toBe(true);
          expect(resolver.resolveItem(role, new Rng(1))).toMatch(/^[a-z_]+$/);
        }
        for (const [role, shape] of SHAPES) {
          const block = resolver.resolve(role, shape, 1).block;
          expect(block, `${id} ${role}.${shape}`).toMatch(shape === 'wool' ? /_wool$/ : new RegExp(`_${shape}$`));
          expect(registry.defaultState(block), `${id} ${role}.${shape} → ${block}`).toBeDefined();
        }
      }
    });
  }
});
