import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Catalog, availableIn, parseComponentDef, validateComponentDef, type ComponentDef } from '../src/index.js';

const CATALOG_DIR = fileURLToPath(new URL('../../../catalog/components', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });
}

const minimal = {
  id: 'test/box',
  kind: 'static',
  category: 'furniture',
  tags: ['box'],
  obtainability: 'survival',
  mount: 'floor',
  rotations: 'all',
  layers: [['A']],
  legend: { A: { block: 'minecraft:barrel' } },
};

describe('Katalog-Dateien im Repo', () => {
  const files = walk(CATALOG_DIR);

  it('es gibt Katalog-Dateien', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = relative(CATALOG_DIR, file).replaceAll('\\', '/');
    it(`${rel} ist gültig und die id passt zum Pfad`, () => {
      const r = parseComponentDef(readFileSync(file, 'utf8'), rel);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.warnings).toEqual([]);
      expect(`${r.value.id}.json5`).toBe(rel);
    });
  }

  it('lässt sich zu einem Katalog zusammenfügen und nach Tags durchsuchen', () => {
    const defs = files.map((f) => {
      const r = parseComponentDef(readFileSync(f, 'utf8'), f);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      return r.value;
    });
    const cat = Catalog.of(defs);
    expect(cat.byTags(['nightstand']).map((d) => d.id)).toEqual(['storage/nightstand_barrel']);
    expect(cat.get('seat/chair').mount).toBe('floor');
  });
});

describe('Validierung', () => {
  it('akzeptiert eine minimale Komponente', () => {
    expect(validateComponentDef(minimal).ok).toBe(true);
  });

  it('Material braucht block ODER role+shape', () => {
    const bad = { ...minimal, legend: { A: { role: 'furniture_wood' } } };
    const r = validateComponentDef(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('role');
  });

  it('meldet unbekannte Zeichen in layers', () => {
    const r = validateComponentDef({ ...minimal, layers: [['AB']] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain("'B'");
  });

  it('meldet ungleich breite Zeilen', () => {
    const r = validateComponentDef({ ...minimal, layers: [['AA', 'A']] });
    expect(r.ok).toBe(false);
  });

  it('reservierte Zeichen dürfen nicht in legend stehen', () => {
    const r = validateComponentDef({ ...minimal, layers: [['A_']], legend: { A: { block: 'minecraft:barrel' }, _: { block: 'minecraft:stone' } } });
    expect(r.ok).toBe(false);
  });

  it('prüft pairWith und doppelte Socket-IDs', () => {
    const r = validateComponentDef({
      ...minimal,
      sockets: [
        { id: 's', type: 'adjacent', accepts: ['x'], pairWith: 'fehlt' },
        { id: 's', type: 'adjacent', accepts: ['x'] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('Varianten ohne Basis-Inhalt müssen selbst Inhalt haben', () => {
    const { layers: _l, legend: _g, ...noContent } = minimal;
    const r = validateComponentDef({ ...noContent, variants: [{ id: 'a' }] });
    expect(r.ok).toBe(false);
  });

  it('unbekannte Felder werden abgelehnt (Tippfehler-Schutz)', () => {
    expect(validateComponentDef({ ...minimal, rotation: 'all' }).ok).toBe(false);
  });

  it('JSON5-Syntaxfehler werden sauber gemeldet', () => {
    const r = parseComponentDef('{ id: ', 'kaputt.json5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('kaputt.json5');
  });
});

describe('Versions-Gating', () => {
  it('availableIn respektiert min/max', () => {
    const d: Pick<ComponentDef, 'minVersion' | 'maxVersion'> = { minVersion: 5023 };
    expect(availableIn(d, 4671)).toBe(false);
    expect(availableIn(d, 5023)).toBe(true);
  });
});
