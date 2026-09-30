/**
 * Welle D · D3 (research/24 §7.0, research/50 Punkt 3, research/32 §5): die neuen Komponenten der acht neuen
 * Themes – 12 der 17 Strukturen aus der Übersicht. Der Test sichert in der KATALOG-Schicht, was die schweren
 * Vertragsschleifen sonst erst nach dem Materialisieren melden:
 *  - jede Komponente ist da, id = Pfad, Montage/Kategorie/Tags wie geplant,
 *  - jede benutzte Theme-Rolle existiert in JEDEM aufgelösten Theme (unbekannte Rolle = Auflösungsfehler),
 *  - die Form passt in den Standard-Testraum der Vertragsschleifen (Grundriss ≤ 7 × 7, Höhe ≤ 5),
 *  - die Dateien sind reine Daten (fest, versionsunabhängig, kein Zufall).
 *
 * Bewusst NICHT hier: Blöcke, Physik und Posen. Das prüfen mit echten Plattformdaten
 * `packages/materialize/test/theme-resolution.test.ts` (alle Rollen/Formen), `packages/pipeline/test/catalog-components.test.ts`
 * (Innenraum) und `packages/pipeline/test/exterior-catalog.test.ts` (Dach/Fassade) sowie
 * `packages/platform/test/catalog-contract.test.ts` (feste Block-IDs).
 *
 * Die fünf übrigen Strukturen (Kuppel, Windturm, Kran, Halle, Scheune) sind bewusst NICHT umgesetzt: sie sind
 * Gebäude bzw. Baukörper (Hülle/Raum-Ebene E7, plan/01 §2/§8) und keine Einzelkomponente – eine „Halle“ als
 * Möbelstück wäre eine Attrappe.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ThemeCatalog, parseComponentDef, parseThemeDef, type ComponentDef, type ThemeDef } from '../src/index.js';

const CATALOG_DIR = fileURLToPath(new URL('../../../catalog/components', import.meta.url));
const THEME_DIR = fileURLToPath(new URL('../../../catalog/themes', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });
}

function themeFiles(): ThemeDef[] {
  return readdirSync(THEME_DIR)
    .filter((f) => f.endsWith('.json5'))
    .map((f) => {
      const r = parseThemeDef(readFileSync(join(THEME_DIR, f), 'utf8'), f);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      return r.value;
    });
}

/** Alle Komponenten des Repos (Pfad relativ zu `catalog/components`). */
const files = walk(CATALOG_DIR).map((f) => {
  const rel = relative(CATALOG_DIR, f).replaceAll('\\', '/');
  const r = parseComponentDef(readFileSync(f, 'utf8'), rel);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return { rel, def: r.value, text: readFileSync(f, 'utf8') };
});
const byId = new Map(files.map((f) => [f.def.id, f]));

/**
 * Die 12 Komponenten aus research/24 §7.0 mit der Mindest-Tag-Menge (weitere Tags erlaubt) und der Montage,
 * die den Vertragstest der jeweiligen Ebene adressiert (floor/ceiling → catalog-components, roof → exterior-catalog).
 */
const WELLE_D: Readonly<Record<string, { mount: string; category: string; tags: readonly string[] }>> = {
  'arch/mauerbruch': { mount: 'floor', category: 'architecture', tags: ['mauerbruch', 'wall_breach', 'wall_decor'] },
  'arch/deckenloch': { mount: 'ceiling', category: 'architecture', tags: ['deckenloch', 'ceiling_breach', 'decor_ceiling'] },
  'decor/schutt': { mount: 'floor', category: 'decor', tags: ['schutt', 'rubble', 'debris'] },
  'exterior/schneelast_dach': { mount: 'roof', category: 'architecture', tags: ['exterior', 'exterior_roof', 'snow_load'] },
  'exterior/blattdach': { mount: 'roof', category: 'architecture', tags: ['exterior', 'exterior_roof', 'leaf_roof', 'roof_thatch'] },
  'arch/bogen': { mount: 'floor', category: 'architecture', tags: ['bogen', 'arch', 'gateway'] },
  'arch/bogenpavillon': { mount: 'floor', category: 'architecture', tags: ['bogenpavillon', 'pavilion', 'arch_pavilion'] },
  'outdoor/silo': { mount: 'floor', category: 'architecture', tags: ['silo', 'grain_store'] },
  'work/schmelze': { mount: 'floor', category: 'work', tags: ['schmelze', 'smelter', 'fire_feature'] },
  'outdoor/baumhaus': { mount: 'floor', category: 'architecture', tags: ['baumhaus', 'treehouse', 'platform'] },
  'outdoor/pfahlbau': { mount: 'floor', category: 'architecture', tags: ['pfahlbau', 'stilt_house', 'pile_dwelling'] },
  'outdoor/kai': { mount: 'floor', category: 'architecture', tags: ['kai', 'quay', 'mooring'] },
};

/** Alle Rollen einer Komponente (Basis + Varianten). */
function rolesOf(def: ComponentDef): string[] {
  const parts = [def, ...(def.variants ?? [])];
  return [...new Set(parts.flatMap((p) => Object.values(p.legend ?? {}).flatMap((m) => (m.role !== undefined ? [m.role] : []))))].sort();
}

/** Maße einer Schicht-Folge (Breite x, Tiefe z, Höhe y). */
function sizeOf(layers: readonly (readonly string[])[]): readonly [number, number, number] {
  return [layers[0]?.[0]?.length ?? 0, layers[0]?.length ?? 0, layers.length];
}

describe('Welle D · D3: neue Komponenten (research/24 §7.0)', () => {
  it('die zwölf Komponenten sind da: Pfad-id, Montage, Kategorie, Tags', () => {
    expect(Object.keys(WELLE_D)).toHaveLength(12);
    for (const [id, want] of Object.entries(WELLE_D)) {
      const file = byId.get(id);
      expect(file, `${id} fehlt im Katalog`).toBeDefined();
      expect(file!.rel).toBe(`${id}.json5`);
      expect(file!.def.mount, id).toBe(want.mount);
      expect(file!.def.category, id).toBe(want.category);
      for (const tag of want.tags) expect(file!.def.tags, `${id} Tag ${tag}`).toContain(tag);
    }
  });

  it('jede benutzte Theme-Rolle existiert in jedem aufgelösten Theme (keine unbekannte Rolle)', () => {
    const themes = ThemeCatalog.of(themeFiles());
    for (const id of Object.keys(WELLE_D)) {
      const def = byId.get(id)!.def;
      for (const role of rolesOf(def)) {
        for (const themeId of themes.ids()) {
          expect(themes.get(themeId).roles[role], `${id}: Theme '${themeId}' kennt die Rolle '${role}' nicht`).toBeDefined();
        }
      }
    }
  });

  it('jede Form passt in den Testraum der Vertragsschleifen (Grundriss ≤ 7 × 7, Höhe ≤ 5)', () => {
    for (const id of Object.keys(WELLE_D)) {
      const def = byId.get(id)!.def;
      const variants = def.variants ?? [];
      expect(variants.length > 0 || def.layers !== undefined, id).toBe(true);
      for (const part of variants.length > 0 ? variants : [def]) {
        const layers = part.layers ?? def.layers;
        if (layers === undefined) continue;
        const [w, d, h] = sizeOf(layers);
        const stretch = part.stretch ?? def.stretch;
        const height = h + (stretch?.max ?? 0);
        const label = `${id}${'id' in part ? `#${(part as { id: string }).id}` : ''}`;
        expect(w, `${label}: Breite ${w} > 7`).toBeLessThanOrEqual(7);
        expect(d, `${label}: Tiefe ${d} > 7`).toBeLessThanOrEqual(7);
        expect(height, `${label}: Höhe ${height} > 5 (keine gültige Pose im Standard-Testraum)`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('die Dateien sind reine Daten: statisch, versionsunabhängig, ohne Zufallsquelle', () => {
    for (const id of Object.keys(WELLE_D)) {
      const file = byId.get(id)!;
      expect(file.def.kind, id).toBe('static');
      expect(file.def.minVersion, `${id}: minVersion schaltet die Komponente in einer Zielversion ab`).toBeUndefined();
      expect(file.def.maxVersion, `${id}: maxVersion schaltet die Komponente in einer Zielversion ab`).toBeUndefined();
      expect(file.def.tags.length, id).toBeGreaterThan(0);
      // Deterministische Daten: keine Zufalls-/Generatorfelder im JSON5-Text
      expect(file.text, `${id}: Zufallsquelle im Katalog`).not.toMatch(/\b(Math\.random|Date\.now|rng|random|chance|pick|motifs|params)\b/);
    }
  });
});
