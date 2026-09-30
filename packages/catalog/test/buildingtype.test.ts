import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BuildingTypeCatalog, lintBuildingType, parseBuildingTypeDef, rangeOf, validateBuildingTypeDef, type BuildingTypeRefs } from '../src/index.js';

const DIR = fileURLToPath(new URL('../../../catalog/buildingtypes', import.meta.url));

const minimal = {
  id: 'box',
  name: 'Kiste',
  family: 'house',
  sizes: { S: { footprint: [[9, 7], [11, 9]], floors: 1 } },
  massing: { generator: 'rect' },
  program: [{ room: 'storage', required: true }],
};

const refs: BuildingTypeRefs = {
  roomTypes: new Set(['storage', 'kitchen']),
  themes: new Set(['medieval']),
  roofs: new Set(['gable', 'hip']),
  siteTemplates: new Set(['homestead']),
  terrainStyles: new Set(['meadow']),
  zoneKinds: new Set(['yard']),
  exteriorGroups: new Set(['shutters']),
};

describe('Bautypen im Repo (catalog/buildingtypes)', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json5'));

  it('es gibt die alten Vorlagen und die Welle-1-Typen', () => {
    for (const id of ['house', 'hall', 'twostory', 'timber', 'tavern', 'townhouse', 'farmhouse', 'longhouse', 'watchtower']) expect(files).toContain(`${id}.json5`);
  });

  for (const f of files) {
    it(`${f} ist gültig und die id passt zum Dateinamen`, () => {
      const r = parseBuildingTypeDef(readFileSync(join(DIR, f), 'utf8'), f);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(`${r.value.id}.json5`).toBe(f);
    });
  }

  it('lässt sich zu einem Katalog zusammenfügen; Entwürfe fehlen in `ready`', () => {
    const defs = files.map((f) => {
      const r = parseBuildingTypeDef(readFileSync(join(DIR, f), 'utf8'), f);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      return r.value;
    });
    const cat = BuildingTypeCatalog.of(defs);
    expect(cat.get('tavern').family).toBe('house');
    expect(cat.ready().map((d) => d.id)).not.toContain('townhouse_row');
    expect(() => BuildingTypeCatalog.of([defs[0]!, defs[0]!])).toThrow(/doppelt/);
  });
});

describe('Validierung', () => {
  it('akzeptiert einen minimalen Bautyp', () => {
    const r = validateBuildingTypeDef(minimal);
    expect(r.ok).toBe(true);
  });

  it('Bereiche: Zahl oder [min, max], min ≤ max', () => {
    expect(rangeOf(3)).toEqual([3, 3]);
    expect(rangeOf([2, 4])).toEqual([2, 4]);
    const r = validateBuildingTypeDef({ ...minimal, sizes: { S: { footprint: [[9, 7], [11, 9]], floors: [3, 2] } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('sizes.S.floors: min > max');
  });

  it('Generator braucht Größen und Programm; fester Grundriss nicht', () => {
    const r = validateBuildingTypeDef({ ...minimal, sizes: undefined, program: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/Größe[\s\S]*Raumprogramm/);
    const fixed = validateBuildingTypeDef({ id: 'f', name: 'F', family: 'house', massing: { generator: 'fixed', rooms: [{ rect: [0, 0, 6, 6], room: 'storage' }] } });
    expect(fixed.ok).toBe(true);
  });

  it('fester Grundriss: Etagen und Treppen müssen existieren', () => {
    const r = validateBuildingTypeDef({
      id: 'f', name: 'F', family: 'house',
      massing: { generator: 'fixed', rooms: [{ rect: [0, 0, 6, 6], room: 'storage', floor: 1 }], stairs: [{ floor: 0, origin: [2, 2], facing: 'east', type: 'straight' }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/Etage 1 gibt es nicht[\s\S]*keine Etage über 0/);
  });

  // W13-A (2026-09-28): Nebenbaukörper fester Grundrisse – Räume verweisen nur auf deklarierte Baukörper, Dachform im Lint
  it('fester Grundriss: Nebenbaukörper (`volumes`) müssen deklariert sein, ihre Dachform ist bekannt', () => {
    const fixed = (volumes: object | undefined, volume: string) => validateBuildingTypeDef({
      id: 'f', name: 'F', family: 'house',
      massing: { generator: 'fixed', rooms: [{ rect: [0, 0, 6, 6], room: 'storage' }, { rect: [7, 0, 12, 6], room: 'kitchen', volume }], ...(volumes !== undefined ? { volumes } : {}) },
    });
    const bad = fixed(undefined, 'shed');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' | ')).toContain("unbekannter Baukörper 'shed'");
    const good = fixed({ shed: { name: 'Schuppen', floorHeight: 3, roof: 'onion' } }, 'shed');
    if (!good.ok) throw new Error(good.errors.join(' | '));
    expect(lintBuildingType(good.value, refs).join(' | ')).toContain("massing.volumes.shed.roof: unbekannte Dachform 'onion'");
    expect(validateBuildingTypeDef({ id: 'f', name: 'F', family: 'house', massing: { generator: 'fixed', rooms: [{ rect: [0, 0, 6, 6], room: 'storage', volume: 'Groß' }] } }).ok).toBe(false);
  });

  it('Flügel: Verweise aus Größe und Programm müssen existieren', () => {
    const r = validateBuildingTypeDef({
      ...minimal,
      sizes: { S: { footprint: [[9, 7], [11, 9]], floors: 1, wings: ['barn'] } },
      program: [{ room: 'storage', wing: 'stable' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/unbekannter Flügel 'barn'[\s\S]*unbekannter Flügel 'stable'/);
  });

  it('unbekannte Felder und Generatoren werden abgelehnt', () => {
    expect(validateBuildingTypeDef({ ...minimal, colour: 'red' }).ok).toBe(false);
    expect(validateBuildingTypeDef({ ...minimal, massing: { generator: 'radial' } }).ok).toBe(false);
  });

  it('JSON5-Fehler mit Quelle', () => {
    const r = parseBuildingTypeDef('{ id: ', 'kaputt.json5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('kaputt.json5');
  });
});

describe('Katalog-Lint (Verweise)', () => {
  it('ohne Befund bei bekannten Namen', () => {
    const r = validateBuildingTypeDef({ ...minimal, themes: ['medieval'], shell: { roof: 'gable' }, site: { template: 'homestead', style: 'meadow', zones: [{ kind: 'yard', at: 'front', depth: 5 }] } });
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(lintBuildingType(r.value, refs)).toEqual([]);
  });

  it('meldet unbekannte Raumtypen, Themes, Dachformen, Vorlagen, Stile, Zonenarten, Außen-Gruppen', () => {
    const r = validateBuildingTypeDef({
      ...minimal,
      themes: ['gothic'],
      entrance: 'foyer',
      program: [{ room: ['storage', 'dojo'], required: true }],
      shell: { roof: 'onion' },
      exterior: { off: ['gargoyles'] },
      site: { template: 'castle', style: 'swamp', zones: [{ kind: 'moat', at: 'front', depth: 3 }] },
    });
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const errors = lintBuildingType(r.value, refs).join('\n');
    for (const bad of ['dojo', 'foyer', 'gothic', 'onion', 'castle', 'swamp', 'moat', 'gargoyles']) expect(errors).toContain(`'${bad}'`);
  });
});
