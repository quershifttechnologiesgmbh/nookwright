/**
 * K3c (research/17 §7.3/§7.4): Raumtyp-Felder `aisle`, `reserve`, `styleTags` und die Mechanik-Prüfungen je
 * Komponente (`checkComponentMechanics`) – synthetisch positiv/negativ und als Lint über alle Katalog-Komponenten.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ComponentDefSchema, checkComponentMechanics, isFullBlock, jobSiteOf, parseComponentDef, roomTypeFitsHeight, roomTypeFitsStyles, validateRoomTypeDef, type ComponentDef } from '../src/index.js';

const CATALOG_DIR = fileURLToPath(new URL('../../../catalog/components', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });

const comp = (o: Record<string, unknown>): ComponentDef =>
  ComponentDefSchema.parse({ id: 't/x', kind: 'static', category: 'furniture', tags: ['x'], obtainability: 'survival', mount: 'floor', rotations: 'backToWall', ...o });

const baseRt = { id: 'rt', name: 'rt', minArea: 1, coverage: { target: 0.3 }, required: [{ tags: ['a'], count: [1, 1] }], optional: [{ tags: ['orb'], count: [0, 1] }] };

describe('Raumtyp-Schema: aisle, reserve, styleTags (Y1/Y2/Y9)', () => {
  it('gültige Felder werden gelesen', () => {
    const r = validateRoomTypeDef({ ...baseRt, aisle: { axis: 'auto', width: 2, minWidth: 1 }, reserve: { zone: 'center', size: [3, 3], reason: 'focal', allow: ['orb'] }, styleTags: { exclude: ['rustic'] } });
    expect(r.ok).toBe(true);
  });

  it('Fehler: minWidth > width, unbekannter allow-Tag, unbekannter Grund, falsche Größe', () => {
    const bad = [
      { aisle: { width: 1, minWidth: 2 } },
      { reserve: { zone: 'center', size: [3, 3], reason: 'focal', allow: ['nope'] } },
      { reserve: { zone: 'center', size: [3, 3], reason: 'party' } },
      { reserve: { zone: 'center', size: [0, 3], reason: 'stairwell' } },
      { aisle: { axis: 'y', width: 2 } },
      { styleTags: { require: [] } },
    ];
    for (const b of bad) expect(validateRoomTypeDef({ ...baseRt, ...b }).ok, JSON.stringify(b)).toBe(false);
  });

  it('roomTypeFitsStyles: require/exclude gegen die Theme-Kette; ohne Filter oder Stile immer', () => {
    const barracks = { styleTags: { exclude: ['rustic'] } };
    const mead = { styleTags: { require: ['nordic'] } };
    expect(roomTypeFitsStyles(barracks, ['rustic', 'medieval'])).toBe(false);
    expect(roomTypeFitsStyles(barracks, ['nordic', 'medieval'])).toBe(true);
    expect(roomTypeFitsStyles(mead, ['nordic', 'medieval'])).toBe(true);
    expect(roomTypeFitsStyles(mead, ['medieval'])).toBe(false);
    expect(roomTypeFitsStyles({}, ['rustic'])).toBe(true);
    expect(roomTypeFitsStyles(mead, undefined)).toBe(true);
  });

  it('minHeight (Wunsch K3b): Feld gültig, roomTypeFitsHeight', () => {
    expect(validateRoomTypeDef({ ...baseRt, minHeight: 5 }).ok).toBe(true);
    expect(validateRoomTypeDef({ ...baseRt, minHeight: 0 }).ok).toBe(false);
    expect(roomTypeFitsHeight({ minHeight: 5 }, 4)).toBe(false);
    expect(roomTypeFitsHeight({ minHeight: 5 }, 5)).toBe(true);
    expect(roomTypeFitsHeight({}, 2)).toBe(true);
  });
});

describe('Block-Wissen', () => {
  it('Vollblock konservativ, Arbeitsblöcke nach Faktencheck #7', () => {
    expect(isFullBlock({ block: 'minecraft:oak_planks' })).toBe(true);
    expect(isFullBlock({ block: 'minecraft:oak_slab' })).toBe(false);
    expect(isFullBlock({ role: 'furniture_wood', shape: 'stairs' })).toBe(false);
    expect(isFullBlock({ role: 'beam', shape: 'log' })).toBe(true);
    expect(jobSiteOf({ block: 'minecraft:lectern' })).toBe('lectern');
    expect(jobSiteOf({ block: 'minecraft:water_cauldron' })).toBe('water_cauldron');
    expect(jobSiteOf({ block: 'minecraft:crafting_table' })).toBeUndefined();
  });
});

describe('checkComponentMechanics – synthetisch', () => {
  const bed = { H: { block: 'minecraft:red_bed', orient: { part: 'head' } }, F: { block: 'minecraft:red_bed', orient: { part: 'foot' } } };

  it('bedObstructed: Vollblock über dem Bett ist ein Fehler, Stufe/Bett darüber nicht', () => {
    expect(checkComponentMechanics(comp({ layers: [['HF'], ['PP']], legend: { ...bed, P: { block: 'minecraft:oak_planks' } } }))).toEqual([
      expect.stringMatching(/bedObstructed/), expect.stringMatching(/bedObstructed/),
    ]);
    expect(checkComponentMechanics(comp({ layers: [['HF'], ['SS']], legend: { ...bed, S: { block: 'minecraft:oak_slab' } } }))).toEqual([]);
    expect(checkComponentMechanics(comp({ layers: [['HF'], ['HF']], legend: bed }))).toEqual([]); // Etagenbett
  });

  it('noteBlockAirAbove: Luft oder Kopf darüber, sonst Fehler', () => {
    const N = { block: 'minecraft:note_block' };
    expect(checkComponentMechanics(comp({ layers: [['N'], ['_']], legend: { N } }))).toEqual([]);
    expect(checkComponentMechanics(comp({ layers: [['N'], ['K']], legend: { N, K: { block: 'minecraft:zombie_head' } } }))).toEqual([]);
    expect(checkComponentMechanics(comp({ layers: [['N'], ['C']], legend: { N, C: { block: 'minecraft:white_carpet' } } }))).toEqual([expect.stringMatching(/noteBlockAirAbove/)]);
    expect(checkComponentMechanics(comp({ layers: [['N'], ['K']], legend: { N, K: { block: 'minecraft:zombie_wall_head' } } }))).toHaveLength(1);
  });

  describe('stallGeometry (Villager-Stand)', () => {
    const legend = { P: { role: 'beam', shape: 'log' }, s: { role: 'furniture_wood', shape: 'slab' }, J: { block: 'minecraft:lectern' }, T: { block: 'minecraft:torch' } };
    const stall = (layers: string[][], extra: Record<string, unknown> = {}) => comp({ tags: ['villager_stall'], functionTags: ['trade'], layers, legend, ...extra });

    it('research/17-Entwurf: Platz 2 Luft mit Stufen-Decke, Arbeitsblock vorn, Seiten zu → in Ordnung', () => {
      expect(checkComponentMechanics(stall([['P_P', 'PJP'], ['P_P', 'P_P'], ['PsP', 'PsP']]))).toEqual([]);
      // Fackel auf dem Platz (kollisionsfrei) und Decke per Dehnung (K3b-Form)
      expect(checkComponentMechanics(stall([['PTP', 'PJP'], ['P_P', 's_s']], { stretch: { layer: 1, max: 1, fill: 'ceiling', rows: ['PsP', '.s.'] } }))).toEqual([]);
    });

    it('Fehler: ohne Decke, seitlich offen, ohne Arbeitsblock, Arbeitsblock ohne Nachbar-Platz', () => {
      expect(checkComponentMechanics(stall([['P_P', 'PJP'], ['P_P', 'P_P']])).join('\n')).toMatch(/kein Villager-Platz|mehr als 1 Block frei/);
      expect(checkComponentMechanics(stall([['__P', 'PJP'], ['__P', 'P_P'], ['ssP', 'PsP']])).join('\n')).toMatch(/seitlich offen/);
      expect(checkComponentMechanics(stall([['P_P', 'PPP'], ['P_P', 'P_P'], ['PsP', 'PsP']])).join('\n')).toMatch(/kein Arbeitsblock/);
      expect(checkComponentMechanics(stall([['PPP', 'PJP'], ['PPP', 'P_P'], ['PsP', 'PsP']])).join('\n')).toMatch(/kein Villager-Platz/);
    });

    it('lichte Höhe 2 als Deckel: maxRoomHeight 2 ohne Stufen-Decke genügt', () => {
      expect(checkComponentMechanics(stall([['P_P', 'PJP'], ['P_P', 'P_P']], { maxRoomHeight: 2 }))).toEqual([]);
    });
  });

  describe('portalFrameValid + portalClearance', () => {
    const legend = { O: { block: 'minecraft:obsidian' }, S: { block: 'minecraft:stone_brick_slab' } };
    const frame = ['OOOO', 'O__O', 'O__O', 'O__O', 'OOOO'].map((r) => [r]).reverse(); // y0 unten
    const clear = { masks: { clearance: [{ side: 'front', depth: 2, hard: true }] } };

    it('Rahmen 4 × 5 mit Luft-Öffnung und harter Freifläche → in Ordnung', () => {
      expect(checkComponentMechanics(comp({ tags: ['nether_portal'], layers: frame, legend, ...clear }))).toEqual([]);
    });

    it('lit: Portalblöcke mit Achse entlang des Rahmens; falsche Achse und halb gefüllt sind Fehler', () => {
      const lit = (axis: string, rows = ['OOOO', 'ONNO', 'ONNO', 'ONNO', 'OOOO']) =>
        comp({ tags: ['nether_portal'], layers: rows.map((r) => [r]).reverse(), legend: { ...legend, N: { block: 'minecraft:nether_portal', orient: { axis } } }, ...clear });
      expect(checkComponentMechanics(lit('along'))).toEqual([]);
      expect(checkComponentMechanics(lit('across')).join('\n')).toMatch(/axis/);
      expect(checkComponentMechanics(lit('along', ['OOOO', 'ONNO', 'O__O', 'ONNO', 'OOOO'])).join('\n')).toMatch(/teils Portal/);
    });

    it('Fehler: Rahmen zu klein/offen, Freifläche fehlt', () => {
      const small = ['OOOO', 'O__O', 'O__O', 'OOOO'].map((r) => [r]).reverse(); // innen 2 × 2
      expect(checkComponentMechanics(comp({ tags: ['nether_portal'], layers: small, legend, ...clear })).join('\n')).toMatch(/nur mit vollständigem Obsidian-Rahmen/);
      const open = ['OOOO', 'O__O', 'O___', 'O__O', 'OOOO'].map((r) => [r]).reverse();
      expect(checkComponentMechanics(comp({ tags: ['nether_portal'], layers: open, legend, ...clear })).join('\n')).toMatch(/nur mit vollständigem Obsidian-Rahmen/);
      expect(checkComponentMechanics(comp({ tags: ['nether_portal'], layers: frame, legend })).join('\n')).toMatch(/portalClearance/);
    });

    it('Rahmen quer (entlang z) wird gefunden', () => {
      const layers = ['OOOO', 'O__O', 'O__O', 'O__O', 'OOOO'].reverse().map((r) => [...r].map((ch) => ch)); // Zeilen = z
      expect(checkComponentMechanics(comp({ tags: ['nether_portal'], layers, legend, ...clear }))).toEqual([]);
    });
  });

  describe('infiniteWater (functionTag water_source)', () => {
    const legend = { W: { block: 'minecraft:water' }, T: { role: 'beam', shape: 'trapdoor' }, K: { role: 'beam', shape: 'log' } };
    const tub = (rows: string[]) => comp({ functionTags: ['water_source'], rotations: 'all', layers: [rows], legend });

    it('2×2 und 1×3 im geschlossenen Rand → unendlich', () => {
      expect(checkComponentMechanics(tub(['KTTK', 'TWWT', 'TWWT', 'KTTK']))).toEqual([]);
      expect(checkComponentMechanics(tub(['KTTTK', 'TWWWT', 'KTTTK']))).toEqual([]);
    });

    it('Fehler: 1×2 ist nicht unendlich, offener Rand läuft aus; ohne Wasserblöcke keine Prüfung', () => {
      expect(checkComponentMechanics(tub(['KTTK', 'TWWT', 'KTTK'])).join('\n')).toMatch(/keine unendliche Quelle/);
      expect(checkComponentMechanics(tub(['KTTK', 'TWW.', 'TWWT', 'KTTK'])).join('\n')).toMatch(/läuft .* aus/);
      expect(checkComponentMechanics(comp({ functionTags: ['water_source'], layers: [['K']], legend: { K: { block: 'minecraft:water_cauldron' } } }))).toEqual([]);
    });
  });
});

describe('Katalog-Lint: jede Komponente besteht die Mechanik-Prüfungen', () => {
  for (const file of walk(CATALOG_DIR)) {
    const rel = relative(CATALOG_DIR, file).replaceAll('\\', '/');
    it(rel, () => {
      const r = parseComponentDef(readFileSync(file, 'utf8'), rel);
      if (!r.ok) return; // Schemafehler meldet catalog.test.ts
      expect(checkComponentMechanics(r.value)).toEqual([]);
    });
  }
});
