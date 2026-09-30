import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ThemeCatalog, parseThemeDef } from '@mcda/catalog';
import { ThemeResolver, mixSeed } from '@mcda/materialize';
import { loadFamilies, loadRegistry } from '@mcda/platform/node';
import { TERRAIN_ROLE_SHAPES } from '../src/index.js';
import { CATALOG_DIR, loadStyles } from './helpers.js';

const themes = ThemeCatalog.of(
  readdirSync(join(CATALOG_DIR, 'themes')).filter((f) => f.endsWith('.json5')).map((f) => {
    const r = parseThemeDef(readFileSync(join(CATALOG_DIR, 'themes', f), 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  }),
);

/** Pflanzen-Rollen der Form `block`: Blöcke ohne Ausrichtung (außer ground_cover: nur MIT facing), nie zweiteilig. */
const PLANT_BLOCK_ROLES = ['flower_wild', 'flower_warm', 'flower_cool', 'grass_tuft', 'pond_plant', 'leaves_bush', 'crop_wheat', 'crop_carrot', 'crop_potato', 'crop_beetroot'];

describe('Außen-Rollen: jedes Theme löst jede (Rolle, Form) des Geländes in jeder Zielversion auf', () => {
  for (const version of ['1.21.11', '26.3', '1.21.1']) {
    const registry = loadRegistry(version);
    const families = loadFamilies(version);
    for (const themeId of themes.ids()) {
      it(`${themeId} / ${version}`, () => {
        const resolver = new ThemeResolver(themes.get(themeId), families, registry);
        const problems: string[] = [];
        const blocks = new Map<string, Set<string>>();
        for (const [role, shapes] of Object.entries(TERRAIN_ROLE_SHAPES)) {
          for (const shape of shapes) {
            for (let seed = 1; seed <= 40; seed++) {
              try {
                const r = resolver.resolve(role, shape, mixSeed(seed, role));
                const def = registry.defaultState(r.block);
                if (def === undefined) problems.push(`${role}.${shape} → ${r.block} fehlt`);
                blocks.set(role, (blocks.get(role) ?? new Set()).add(r.block));
              } catch (e) {
                problems.push((e as Error).message);
              }
            }
          }
        }
        expect(problems).toEqual([]);
        // Verträge des Generators (roles.ts)
        const props = (b: string): Readonly<Record<string, readonly string[]>> => registry.listProperties(b) ?? {};
        // Decklagen (Blütenblätter, Laub, Streu) tragen die Richtung aus dem Gelände; Blöcke ohne
        // Richtungs-Property (Sand, Schnee, Moosteppich) sind ebenfalls erlaubt – `materialize` lässt den
        // Hinweis dort fallen (research/31 §6). Zwei teilige Blöcke bleiben verboten.
        for (const b of blocks.get('ground_cover')!) expect(Object.keys(props(b)), `ground_cover ${b}`).not.toContain('half');
        for (const role of PLANT_BLOCK_ROLES) {
          for (const b of blocks.get(role)!) {
            expect(Object.keys(props(b)), `${role} ${b}`).not.toContain('facing');
            expect(Object.keys(props(b)), `${role} ${b}`).not.toContain('half');
          }
        }
        for (const b of blocks.get('farmland')!) expect(b).toBe('farmland');
        for (const b of blocks.get('water')!) expect(b).toBe('water');
        for (const role of ['leaves_oak', 'leaves_birch', 'leaves_spruce', 'leaves_bush']) for (const b of blocks.get(role)!) expect(b).toMatch(/_leaves$/);
        for (const role of ['log_oak', 'log_birch', 'log_spruce']) for (const b of blocks.get(role)!) expect(Object.keys(props(b))).toContain('axis');
        // Untergrund: keine fallenden Blöcke (die unterste Lage hängt frei)
        for (const role of ['ground_dirt', 'ground_stone', 'foundation']) for (const b of blocks.get(role)!) expect(b, role).not.toMatch(/sand$|gravel|powder/);
      });
    }
  }

  it('Themes haben mehr Außen-Varianz: Wiese, Weg, Hof, Blumen jeweils als Mischung', () => {
    for (const id of themes.ids()) {
      const t = themes.get(id);
      for (const role of ['ground_grass', 'ground_path', 'ground_yard', 'flower_wild', 'leaves_bush', 'grass_tuft']) {
        expect(t.roles[role]?.mix?.length ?? 0, `${id}.${role}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('Geländestile (catalog/terrain)', () => {
  it('alle Stile sind gültig und decken Wiese, Gartenwiese, Hügel, Wald, Flachland und Gehöft ab', () => {
    const styles = loadStyles();
    // W4 (27.09.2026): Gartenwiese `cottage` (Trittstein-Wege, Standard des Hobbit-Erdhauses)
    expect([...styles.keys()].sort()).toEqual(['cottage', 'farmland', 'forest', 'hills', 'homestead', 'meadow']);
    for (const s of styles.values()) expect(Object.values(s.vegetation?.trees?.species ?? {}).some((w) => (w ?? 0) > 0)).toBe(true);
  });
});
