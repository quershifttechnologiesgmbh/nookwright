import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Catalog, parseRoomTypeDef, validateComponentDef, validateRoomTypeDef } from '../src/index.js';

const ROOMTYPES = fileURLToPath(new URL('../../../catalog/roomtypes', import.meta.url));

const torch = {
  id: 'light/test_torch',
  kind: 'static',
  category: 'light',
  tags: ['light', 'light_wall'],
  obtainability: 'survival',
  mount: 'wall',
  rotations: 'backToWall',
  cells: [{ at: [0, 0, 0], mat: { block: 'minecraft:wall_torch', orient: { attachTo: 'back' } } }],
};

const room = {
  id: 'cellar',
  name: 'Keller',
  minArea: 4,
  coverage: { target: 0.3 },
  required: [{ tags: ['light_wall'], count: [1, 1] }],
  optional: [],
};

describe('Katalog-Schema: walkable und wallHeight (additiv)', () => {
  it('akzeptiert walkable und wallHeight an Wand-Komponenten', () => {
    const r = validateComponentDef({ ...torch, walkable: true, wallHeight: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.walkable).toBe(true);
      expect(r.value.wallHeight).toBe(2);
      expect(r.warnings).toEqual([]);
    }
  });

  it('ohne die Felder bleibt alles wie bisher (optional)', () => {
    const r = validateComponentDef(torch);
    expect(r.ok && r.value.walkable === undefined && r.value.wallHeight === undefined).toBe(true);
  });

  it('wallHeight an einer Nicht-Wand-Komponente → Hinweis; ungültige Werte → Fehler', () => {
    const floor = validateComponentDef({ ...torch, mount: 'floor', wallHeight: 1 });
    expect(floor.ok && floor.warnings.join()).toContain('wallHeight');
    expect(validateComponentDef({ ...torch, wallHeight: -1 }).ok).toBe(false);
    expect(validateComponentDef({ ...torch, walkable: 'ja' }).ok).toBe(false);
  });
});

describe('Raumtyp-Schema: lighting (Stimmungs-Ziel des Licht-Passes)', () => {
  it('lighting ist optional und wird geprüft', () => {
    expect(validateRoomTypeDef(room).ok).toBe(true);
    const r = validateRoomTypeDef({ ...room, lighting: { minLevel: 7, prefer: ['candles', 'light_ceiling'] } });
    expect(r.ok && r.value.lighting).toEqual({ minLevel: 7, prefer: ['candles', 'light_ceiling'] });
    expect(validateRoomTypeDef({ ...room, lighting: { minLevel: 0 } }).ok).toBe(false);
    expect(validateRoomTypeDef({ ...room, lighting: { minLevel: 16 } }).ok).toBe(false);
    expect(validateRoomTypeDef({ ...room, lighting: { prefer: [] } }).ok).toBe(false);
    expect(validateRoomTypeDef({ ...room, lighting: { level: 7 } }).ok).toBe(false);
  });

  it('Katalog-Lint meldet Wunsch-Lichtquellen ohne Komponente', () => {
    const t = validateComponentDef(torch);
    const rt = validateRoomTypeDef({ ...room, lighting: { prefer: ['light_wall', 'candles'] } });
    if (!t.ok || !rt.ok) throw new Error('Fixture ungültig');
    expect(Catalog.of([t.value], [rt.value]).missingTags('cellar')).toEqual(['candles']);
  });

  // W3 (27.09.2026): Licht-Budget (Baustandard I7) – Schlafzimmer ≥ 6 mit dem Licht am Bett zuerst (Kerze/Laterne auf dem
  // Nachttisch), Schmiede ≥ 7 (die Esse ist das Hauptlicht, dazu Wandlaternen); vorher 7 mit Kerzen bzw. 9
  it('die MVP-Raumtypen haben ein Stimmungs-Ziel (Schlafzimmer ≥ 6 mit Licht am Bett, Schmiede ≥ 7) und ein Licht-Budget', () => {
    const rts = new Map(
      readdirSync(ROOMTYPES).map((f) => {
        const r = parseRoomTypeDef(readFileSync(join(ROOMTYPES, f), 'utf8'), f);
        if (!r.ok) throw new Error(r.errors.join('\n'));
        return [r.value.id, r.value] as const;
      }),
    );
    expect(rts.get('bedroom')?.lighting).toMatchObject({ minLevel: 6, prefer: expect.arrayContaining(['light_small']) });
    expect(rts.get('bedroom')?.lighting?.prefer?.[0]).toBe('light_small');
    expect(rts.get('bedroom')?.lighting?.anchors).toContain('nightstand');
    expect(rts.get('smithy')?.lighting?.minLevel).toBe(7);
    for (const id of ['kitchen', 'tavern', 'bedroom', 'smithy', 'library', 'storage', 'solar', 'alchemy', 'dining_hall']) {
      expect(rts.get(id)?.lighting?.budget?.cellsPer, id).toBeGreaterThan(0);
    }
    for (const rt of rts.values()) expect(rt.lighting?.minLevel, rt.id).toBeGreaterThanOrEqual(1);
  });
});
