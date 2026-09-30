/**
 * BT01 Burg, kompakt (research/19 §3, §7.4): Ensemble-Teile im Grundriss-Generator. Bergfried als eigener Baukörper
 * (Turm-Grammatik, eigene Geschosshöhe, Flachdach mit Wehrplatte), an eine hintere Ecke des Palas angebaut (Brandwand in
 * der Wandspalte des Palas), eigenes Programm je Teil; Ringmauer als aufgelöste Werte im Plan.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME } from '@mcda/blueprint';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet } from '@mcda/core';
import { nodeContext } from '@mcda/pipeline/node';
import { planBuilding, renderPlan, requiredMissing, type ArchetypeContext } from '../src/index.js';
import { contact } from '../src/frame.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };
const parsed = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/castle_compact.json5`, 'utf8'), 'castle_compact.json5');
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const def: BuildingTypeDef = parsed.value;

describe('Burg: Ensemble aus Palas und Bergfried (Plan-Ebene)', () => {
  for (const size of ['S', 'M', 'L'] as const) {
    it(`${size}: Bergfried eigener Baukörper, angebaut, höher, eigenes Programm; Ring aufgelöst`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const p = planBuilding(def, { size }, seed, arch);
        const where = `${size} Seed ${seed}\n${renderPlan(p)}`;
        expect(p.warnings, where).toEqual([]);
        expect(requiredMissing(def, p), where).toEqual([]);
        const keep = p.parts?.find((x) => x.id === 'keep');
        expect(keep, where).toBeDefined();
        expect(keep!.parapet).toBe('crenel');
        const vol = p.volumes.find((v) => v.id === keep!.volumeId)!;
        expect(vol.roof).toBe('flat');
        expect(Object.values(vol.floorHeights ?? {}).every((h) => h === 3)).toBe(true);
        const palas = p.rooms.filter((r) => r.volumeId === DEFAULT_VOLUME);
        const tower = p.rooms.filter((r) => r.volumeId === keep!.volumeId);
        // Turm-Grammatik: ein Raum je Geschoss, Wachstube unten, Waffenkammer darüber, Turmzimmer oben, Leitern
        expect(tower.map((r) => r.floor), where).toEqual(Array.from({ length: keep!.floors }, (_, i) => i));
        expect(tower[0]!.roomTypeId).toBe('barracks');
        expect(tower[1]!.roomTypeId).toBe('armory');
        expect(tower[tower.length - 1]!.roomTypeId).toBe('tower_room');
        expect(tower.every((r) => r.entry < 0 || def.program![r.entry]!.part === 'keep')).toBe(true);
        expect(palas.every((r) => r.entry < 0 || def.program![r.entry]!.part === undefined)).toBe(true);
        expect(p.stairs.filter((s) => s.volumeId === keep!.volumeId).every((s) => s.type === 'ladder')).toBe(true);
        const palasFloors = new Set(palas.filter((r) => r.floor >= 0).map((r) => r.floor)).size;
        expect(keep!.floors).toBeGreaterThanOrEqual(palasFloors + 3);
        // angebaut an eine hintere Ecke: Berührung über die ganze Turmtiefe, keine gemeinsamen Spalten
        const keepCols = tower.reduce((u, r) => u.union(r.cells), CellSet.empty());
        const palasCols = palas.reduce((u, r) => u.union(r.cells), CellSet.empty());
        expect(keepCols.intersects(palasCols)).toBe(false);
        expect(contact(keepCols, palasCols), where).toBeGreaterThanOrEqual(5);
        expect(Math.min(...[...keepCols].map((c) => c[1]))).toBeLessThanOrEqual(Math.min(...[...palasCols].map((c) => c[1])));
        // Palas: Thronsaal mit Treppe am Eingang, Küche, oben Speisesaal und Kammern
        expect(palas.some((r) => r.floor === 0 && r.roomTypeId === 'throne_room')).toBe(true);
        expect(palas.some((r) => r.floor === 1 && r.roomTypeId === 'dining_hall')).toBe(true);
        // Ringmauer: Werte aufgelöst, Silhouette als weicher Wert
        expect(p.ring?.offset).toBeGreaterThanOrEqual(4);
        expect(p.ring?.merlon).toEqual({ width: 2, gap: 1 });
        expect(p.quality.map((q) => q.id)).toEqual(['ratio', 'partOverMain', 'massCount', 'focusOverMain']);
      }
    });
  }

  it('Keller mit Kerker (L immer), Front gedreht bleibt gültig', () => {
    for (const front of ['south', 'east', 'north', 'west'] as const) {
      const p = planBuilding(def, { size: 'L', front }, 3, arch);
      expect(p.warnings, front).toEqual([]);
      expect(p.rooms.some((r) => r.floor === -1 && r.roomTypeId === 'dungeon')).toBe(true);
    }
  });
});
