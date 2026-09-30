/**
 * Grundriss-Generator v1 (research/19 §7.3) auf Plan-Ebene: Katalog-Lint aller Bautypen, Fuzz S/M/L × 20 Seeds je
 * Bautyp (Plan geprüft: übernehmbar, Hülle ohne Warnung, alle Räume erreichbar, Pflichträume, Mindestflächen),
 * Determinismus, Drehung/Verschiebung, Flure, Mehr-Baukörper-Pläne (Scheune, Häuserzeile).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME, type RoofStyle } from '@mcda/blueprint';
import { BUILDING_SIZES, lintBuildingType, parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet } from '@mcda/core';
import { EXTERIOR_GROUPS } from '@mcda/exterior';
import { nodeContext } from '@mcda/pipeline/node';
import { SITE_TEMPLATES, ZONE_KINDS } from '@mcda/terrain';
import { HEAVY_TIMEOUT, expectCpuBelow } from '../../core/test/support/timing.js';
import { defaultSize, planBuilding, renderPlan, requiredMissing, windowlessRooms, type ArchetypeContext, type BuildingPlan } from '../src/index.js';
import { contact } from '../src/frame.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };

/** Alle Dachformen der Hülle; die Typprüfung meldet eine fehlende. */
const ROOFS = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'] as const satisfies readonly RoofStyle[];
const allRoofs: Exclude<RoofStyle, (typeof ROOFS)[number]> extends never ? true : never = true;

const TYPES: BuildingTypeDef[] = readdirSync(join(ROOT, 'buildingtypes')).filter((f) => f.endsWith('.json5')).map((f) => {
  const r = parseBuildingTypeDef(readFileSync(join(ROOT, 'buildingtypes', f), 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
});
const byId = (id: string): BuildingTypeDef => TYPES.find((t) => t.id === id)!;
const generated = TYPES.filter((t) => t.massing.generator !== 'fixed');
const sizesOf = (t: BuildingTypeDef) => BUILDING_SIZES.filter((s) => t.sizes?.[s] !== undefined);

/** Vergleichbare Form eines Plans (Zellen sortiert). */
const shape = (p: BuildingPlan): string =>
  JSON.stringify({
    floors: p.floors, volumes: p.volumes, stairs: p.stairs,
    rooms: p.rooms.map((r) => [r.volumeId, r.floor, r.roomTypeId, r.cells.toArray().map((c) => c.join(',')).sort().join(';')]),
  });

describe('Katalog-Lint: Bautypen verweisen nur auf Vorhandenes', () => {
  it('Raumtypen, Themes, Dachformen, Gelände-Vorlagen/-Stile, Zonenarten, Außen-Gruppen', () => {
    expect(allRoofs).toBe(true);
    const refs = {
      roomTypes: new Set(ctx.catalog.roomTypeIds()),
      themes: new Set(ctx.themes.ids()),
      roofs: new Set<string>(ROOFS),
      siteTemplates: new Set<string>(SITE_TEMPLATES),
      terrainStyles: new Set(ctx.terrainStyles?.keys() ?? []),
      zoneKinds: new Set<string>(ZONE_KINDS),
      exteriorGroups: new Set<string>(EXTERIOR_GROUPS),
    };
    expect(TYPES.flatMap((t) => lintBuildingType(t, refs))).toEqual([]);
  });
});

describe('Grundriss-Generator: Fuzz S/M/L × 20 Seeds je Bautyp (Plan-Ebene)', () => {
  for (const def of generated) {
    it(`${def.id}: Plan geprüft, Pflichträume vorhanden, Treppen je Etage, < 1 s`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const size of sizesOf(def)) {
        for (let seed = 1; seed <= 20; seed++) {
          const where = `${def.id} ${size} Seed ${seed}`;
          // CPU-Zeit statt Wanduhr, bei Überschreitung nachgemessen (Helfer: robust gegen Fremdlast)
          const { result: plan } = expectCpuBelow(() => planBuilding(def, { size }, seed, arch), 1000, where);
          expect(plan.warnings, `${where}\n${renderPlan(plan)}`).toEqual([]);
          expect(requiredMissing(def, plan), where).toEqual([]);
          // jede Etage jedes Baukörpers ist über genau eine Treppe mit der nächsten verbunden
          for (const v of plan.volumes) {
            const floors = [...new Set(plan.rooms.filter((r) => r.volumeId === v.id).map((r) => r.floor))].sort((a, b) => a - b);
            const links = plan.stairs.filter((s) => s.volumeId === v.id).map((s) => s.floor).sort((a, b) => a - b);
            expect(links, `${where} ${v.id}`).toEqual(floors.slice(0, -1));
          }
          // Räume einer Etage überschneiden sich nicht
          for (const f of plan.floors) {
            const rooms = plan.rooms.filter((r) => r.floor === f.index);
            expect(rooms.reduce((n, r) => n + r.cells.size, 0), `${where} Etage ${f.index}`).toBe(rooms.reduce((u, r) => u.union(r.cells), CellSet.empty()).size);
          }
        }
      }
    });
  }
});

describe('Grundriss-Generator: Eigenschaften', () => {
  it('deterministisch: gleicher Seed → gleicher Plan, anderer Seed → anderer Plan', () => {
    const def = byId('tavern');
    const a = planBuilding(def, { size: 'M' }, 7, arch);
    expect(shape(planBuilding(def, { size: 'M' }, 7, arch))).toBe(shape(a));
    expect(shape(planBuilding(def, { size: 'M' }, 8, arch))).not.toBe(shape(a));
  });

  it('Front und Lage: gedreht und verschoben bleibt der Plan gültig', () => {
    const def = byId('tavern');
    const south = planBuilding(def, { size: 'M' }, 3, arch);
    for (const front of ['north', 'east', 'west'] as const) {
      const p = planBuilding(def, { size: 'M', front, at: [5, 7] }, 3, arch);
      expect(p.warnings, front).toEqual([]);
      expect(p.params.front).toBe(front);
      const cells = p.rooms.flatMap((r) => r.cells.toArray());
      expect(Math.min(...cells.map((c) => c[0]))).toBe(5);
      expect(Math.min(...cells.map((c) => c[1]))).toBe(7);
      expect(p.rooms.map((r) => r.roomTypeId).sort()).toEqual(south.rooms.map((r) => r.roomTypeId).sort());
    }
    expect(south.params.front).toBe('south');
  });

  it('Flur (Tiefe ≥ 11): jedes Gästezimmer grenzt an den Flur, die Treppe liegt im Flur', () => {
    const def = byId('tavern');
    let corridors = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const p = planBuilding(def, { size: 'L' }, seed, arch);
      for (const f of p.floors.filter((x) => x.index > 0)) {
        const hall = p.rooms.find((r) => r.floor === f.index && r.roomTypeId === 'gallery');
        if (hall === undefined) continue;
        corridors++;
        for (const g of p.rooms.filter((r) => r.floor === f.index && r.roomTypeId === 'guest_room')) expect(contact(g.cells, hall.cells), `Seed ${seed} Etage ${f.index}`).toBeGreaterThanOrEqual(3);
        for (const s of p.stairs.filter((x) => x.floor === f.index)) expect(hall.cells.has(s.origin[0], s.origin[1])).toBe(true);
      }
    }
    expect(corridors).toBeGreaterThan(10);
  });

  it('Taverne: Schankraum mit Treppe am Eingang, Küche daneben, Gästezimmer oben, Keller mit Fasslager', () => {
    const def = byId('tavern');
    const p = planBuilding(def, { size: 'L' }, 1, arch);
    const tavern = p.rooms.find((r) => r.floor === 0 && r.roomTypeId === 'tavern')!;
    const kitchen = p.rooms.find((r) => r.floor === 0 && r.roomTypeId === 'kitchen')!;
    expect(contact(tavern.cells, kitchen.cells)).toBeGreaterThanOrEqual(3);
    expect(p.stairs.some((s) => s.floor === 0 && tavern.cells.has(s.origin[0], s.origin[1]))).toBe(true);
    expect(p.rooms.some((r) => r.floor === -1 && r.roomTypeId === 'wine_cellar')).toBe(true);
    expect(p.rooms.filter((r) => r.floor >= 1 && r.roomTypeId === 'guest_room').length).toBeGreaterThanOrEqual(4);
    expect(p.corridorTypes).toEqual(['hallway', 'corridor', 'tavern', 'gallery']);
  });

  it('Turm: ein Raum je Etage, Leitern im Wechsel, Turmzimmer oben', () => {
    const p = planBuilding(byId('watchtower'), { size: 'L' }, 2, arch);
    expect(p.floors.map((f) => p.rooms.filter((r) => r.floor === f.index).length)).toEqual([1, 1, 1, 1, 1]);
    expect(p.stairs.every((s) => s.type === 'ladder')).toBe(true);
    expect(new Set(p.stairs.map((s) => s.facing)).size).toBe(2);
    expect(p.rooms.find((r) => r.floor === 4)!.roomTypeId).toBe('tower_room');
  });

  it('Halle: Räume nur quer zur Längsachse (Langhaus), Methalle am größten', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const p = planBuilding(byId('longhouse'), { size: 'L' }, seed, arch);
      const d = Math.max(...p.rooms.map((r) => r.cells.bounds()!.maxZ)) - Math.min(...p.rooms.map((r) => r.cells.bounds()!.minZ)) + 1;
      for (const r of p.rooms) expect(r.cells.bounds()!.maxZ - r.cells.bounds()!.minZ + 1, `Seed ${seed}`).toBe(d);
      const hall = p.rooms.find((r) => r.roomTypeId === 'mead_hall')!;
      expect(p.rooms.every((r) => r.cells.size <= hall.cells.size)).toBe(true);
    }
  });

  // W9-G3 (27.09.2026): die Scheune ist ein Ensemble-Teil (eigene Geschosshöhe 5, ungeteiltes Mansard-Satteldach) und
  // steht schon in M (Review R5 G3: M-Bauernhaus ohne Scheune)
  for (const size of ['M', 'L'] as const) {
    it(`Bauernhaus ${size}: Scheune als eigener Baukörper (Abstand, eigenes Dach, hohe Tenne), Stall darin`, () => {
      const p = planBuilding(byId('farmhouse'), { size }, 4, arch);
      // W13-A (2026-09-28): dazu der eingeschossige Anbau hinten (v2, eigenes Satteldach, niedriger); vorher nur v0 und v1.
      // Runde 2: hinten links statt mittig (mittig wanderte die Haustür oft zur Scheune)
      expect(p.volumes.map((v) => v.id)).toEqual([DEFAULT_VOLUME, 'v1', 'v2']);
      expect(p.volumes[1]!.roof).toBe('gambrel');
      expect(p.volumes[1]!.floorHeights).toEqual({ 0: 5 });
      const barn = p.rooms.filter((r) => r.volumeId === 'v1');
      const house = p.rooms.filter((r) => r.volumeId === DEFAULT_VOLUME);
      expect(barn.some((r) => r.roomTypeId === 'stable')).toBe(true);
      const gap = Math.min(...barn.map((r) => r.cells.bounds()!.minX)) - Math.max(...house.map((r) => r.cells.bounds()!.maxX)) - 1;
      expect(gap).toBe(4);
      expect(p.wings).toEqual([]);
      expect(p.parts).toEqual([{ id: 'barn', volumeId: 'v1', floors: 1 }, { id: 'annex', volumeId: 'v2', floors: 1 }]);
      // der niedrigere Anbau schließt hinten außen an die Wand des Wohnhauses an (keine gemeinsame Spalte, kein Abstand)
      const annex = p.rooms.filter((r) => r.volumeId === 'v2');
      expect(annex.length).toBeGreaterThan(0);
      expect(Math.min(...house.map((r) => r.cells.bounds()!.minZ)) - Math.max(...annex.map((r) => r.cells.bounds()!.maxZ))).toBe(1);
      // hinten links, bündig mit der linken Giebelseite (L)
      expect(Math.min(...annex.map((r) => r.cells.bounds()!.minX))).toBe(Math.min(...house.map((r) => r.cells.bounds()!.minX)));
      expect(p.volumes[2]!.roof).toBe('gable');
    });
  }

  it('Häuserzeile (Entwurf): 3–4 Baukörper nebeneinander, je eigene Treppe, verschieden breit/hoch', () => {
    const def = byId('townhouse_row');
    for (let seed = 1; seed <= 5; seed++) {
      const p = planBuilding(def, {}, seed, arch);
      expect(p.volumes.length).toBeGreaterThanOrEqual(3);
      for (const v of p.volumes) expect(p.stairs.some((s) => s.volumeId === v.id), `${seed} ${v.id}`).toBe(true);
      const columns = new Map<string, string>();
      for (const r of p.rooms) for (const [x, z] of r.cells) expect(columns.get(`${x},${z}`) ?? r.volumeId, `Spalte ${x},${z}`).toBe(r.volumeId), columns.set(`${x},${z}`, r.volumeId);
    }
  });

  it('fester Grundriss: genau die Räume und Treppen der Definition', () => {
    const p = planBuilding(byId('twostory'), {}, 2026, arch);
    expect(p.rooms.map((r) => [r.floor, r.roomTypeId, r.cells.size])).toEqual([
      // W9-G1 (2026-09-27): Obergeschoss kragt vorn 1 Block aus (Baumasse-Akzente, massing.features) – Alchimie 55 → 66
      [0, 'tavern', 96], [0, 'kitchen', 56], [0, 'storage', 95], [1, 'bedroom', 72], [1, 'library', 80], [1, 'alchemy', 66],
      // W12-A (2026-09-28): Diele mit der Haustür im eingeschossigen Vorbau an einer Ecke (`cross.room`)
      // W13-A Runde 2 (2026-09-28): Tischlerei im eingeschossigen Werkstatt-Anbau (eigener Baukörper v1)
      [0, 'carpentry', 63],
      [0, 'hallway', 27],
    ]);
    expect(p.stairs).toEqual([{ volumeId: DEFAULT_VOLUME, floor: 0, origin: [3, 10], facing: 'east', type: 'straight' }]);
    expect(p.warnings).toEqual([]);
    expect(renderPlan(p)).toContain('A=tavern');
  });

  it('Silhouette als weicher Wert (Hinweis, keine Warnung)', () => {
    const p = planBuilding(byId('longhouse'), { size: 'S' }, 1, arch);
    expect(p.quality.map((q) => q.id)).toEqual(['ratio', 'heightToWidth']);
    for (const q of p.quality.filter((x) => !x.ok)) expect(p.hints.join('\n')).toContain(`Silhouette: ${q.id}`);
    expect(p.warnings).toEqual([]);
  });
});

describe('W5 (27.09.2026, Review N8): gerade Front (`massing.evenFront`)', () => {
  const width = (plan: BuildingPlan): number => {
    const xs = plan.rooms.filter((r) => r.volumeId === DEFAULT_VOLUME && r.floor === 0).flatMap((r) => r.cells.toArray().map(([x]) => x));
    return Math.max(...xs) - Math.min(...xs) + 1;
  };
  it('Taverne: gerade Frontlänge in allen Größen, ohne das Feld ungerade wie bisher, kaum Räume ohne Fenster', { timeout: HEAVY_TIMEOUT }, () => {
    const def = ctx.buildingTypes.get('tavern')!;
    expect('evenFront' in def.massing && def.massing.evenFront === true).toBe(true);
    const { evenFront: _e, ...rest } = def.massing as typeof def.massing & { evenFront?: boolean };
    const odd = { ...def, massing: rest } as BuildingTypeDef;
    let dark = 0;
    for (const size of ['S', 'M', 'L'] as const) {
      for (const seed of [1, 2, 3]) {
        const plan = planBuilding(def, { size, themeId: 'timber' }, seed, arch);
        // Grundriss-Zellen umfassen die Außenwände (gemeinsames Raster der Hülle)
        expect(width(plan) % 2, `${size}/${seed}`).toBe(0);
        expect(width(planBuilding(odd, { size, themeId: 'timber' }, seed, arch)) % 2, `${size}/${seed} ohne Feld`).toBe(1);
        dark += Math.max(windowlessRooms(plan, 3), windowlessRooms(plan, 4));
      }
    }
    // Gästezimmer schmaler als ein Feld bleiben ohne Achse (F2) – der Planer wählt unter seinen Versuchen den mit den
    // wenigsten; über viele Seeds etwa wie vor der geraden Front (Bericht W5-C: 35/654 → 37/570)
    expect(dark).toBeLessThanOrEqual(9);
  });
});

describe('W8-D: Etagen ohne Größe wählen die Größe', () => {
  it('Wachturm 3/4/5 Etagen → S/M/L; ohne Etagen und bei unpassender Zahl bleibt M; ausdrückliche Größe gewinnt', () => {
    const tower = byId('watchtower');
    expect(defaultSize(tower)).toBe('M');
    expect(defaultSize(tower, 9)).toBe('M');
    for (const [floors, size] of [[3, 'S'], [4, 'M'], [5, 'L']] as const) {
      expect(defaultSize(tower, floors)).toBe(size);
      const p = planBuilding(tower, { floors }, 3, arch);
      expect(p.params.size, `${floors}`).toBe(size);
      expect(p.params.floors, `${floors}`).toBe(floors);
    }
    expect(planBuilding(tower, { size: 'M', floors: 3 }, 3, arch).params.floors).toBe(4);
  });

  it('bitgleich, wenn M die Etagenzahl hat (kein Größenwechsel)', () => {
    for (const t of ['tavern', 'townhouse', 'watchtower'].map(byId)) {
      expect(defaultSize(t), t.id).toBe('M');
      const m = planBuilding(t, { size: 'M' }, 5, arch);
      expect(shape(planBuilding(t, { floors: m.params.floors }, 5, arch)), t.id).toBe(shape(planBuilding(t, { size: 'M', floors: m.params.floors }, 5, arch)));
    }
  });
});

/**
 * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): `massing.centerHub` – die Diele liegt als Querband mittig über
 * die ganze Tiefe, links und rechts je genau ein Frontraum über die ganze Seitenbreite (spiegelgleiche Front); ohne das
 * Feld liegt die Diele wie bisher per Seed (oft am Ende).
 */
describe('W12-B: Diele mittig (`massing.centerHub`)', () => {
  it('Erdhaus S/M/L × 6 Seeds: Diele mittig, Frontraum je Seite gleich breit, Pflichträume da; ohne Feld wie bisher', { timeout: HEAVY_TIMEOUT }, () => {
    const def = byId('hobbit');
    expect('centerHub' in def.massing && def.massing.centerHub === true).toBe(true);
    const { centerHub: _c, ...rest } = def.massing as typeof def.massing & { centerHub?: boolean };
    const plain = { ...def, massing: rest } as BuildingTypeDef;
    let offCenterBefore = 0;
    for (const size of ['S', 'M', 'L'] as const) {
      for (const seed of [2026, 1, 2, 3, 7, 11]) {
        const plan = planBuilding(def, { size, themeId: 'rustic' }, seed, arch);
        const all = plan.rooms.flatMap((r) => r.cells.toArray());
        const x0 = Math.min(...all.map(([x]) => x));
        const x1 = Math.max(...all.map(([x]) => x));
        const z1 = Math.max(...all.map(([, z]) => z));
        const hall = plan.rooms.find((r) => r.roomTypeId === 'entrance_hall')!.cells.bounds()!;
        const tag = `${size}/${seed}\n${renderPlan(plan)}`;
        expect(hall.minX - x0, tag).toBe(x1 - hall.maxX);
        expect([hall.minZ, hall.maxZ], tag).toEqual([Math.min(...all.map(([, z]) => z)), z1]);
        // an der Front (größtes z) je Seite genau ein Raum über die ganze Seitenbreite
        const frontRooms = plan.rooms.filter((r) => r.roomTypeId !== 'entrance_hall' && r.cells.toArray().some(([, z]) => z === z1));
        expect(frontRooms.length, tag).toBe(2);
        const widths = frontRooms.map((r) => r.cells.bounds()!).map((b) => b.maxX - b.minX + 1);
        expect(widths[0], tag).toBe(widths[1]);
        expect(requiredMissing(def, plan), tag).toEqual([]);
        expect(plan.warnings, tag).toEqual([]);
        const before = plain.massing.generator === 'rect' ? planBuilding(plain, { size, themeId: 'rustic' }, seed, arch) : plan;
        const bh = before.rooms.find((r) => r.roomTypeId === 'entrance_hall')!.cells.bounds()!;
        const bx = before.rooms.flatMap((r) => r.cells.toArray()).map(([x]) => x);
        const bz = before.rooms.flatMap((r) => r.cells.toArray()).map(([, z]) => z);
        // W13-C (2026-09-28): schmale Front (Tiefe > Breite) – ohne Feld liegt die Diele als Querband quer über die ganze
        // Breite und erreicht die Front nicht; „wie bisher“ heißt daher: nicht als mittiges Band von hinten bis zur Front
        // (vorher nur „außermittig“)
        if (bh.minX - Math.min(...bx) !== Math.max(...bx) - bh.maxX || bh.minZ !== Math.min(...bz) || bh.maxZ !== Math.max(...bz)) offCenterBefore++;
      }
    }
    expect(offCenterBefore).toBeGreaterThan(6);
  });
});
