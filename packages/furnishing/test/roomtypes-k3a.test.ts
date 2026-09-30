/**
 * K3a – Raumtypen Wohnen & Repräsentation (research/17 §4.1–4.13, §4.26–4.28; Bericht plan/spikes/K3a_raumtypen_wohnen.md):
 * 16 Raumtypen und ihre neuen Komponenten. Geprüft werden
 *  - Katalog: alles geladen, jede neue Komponente über einen K3a-Raumtyp erreichbar, die bewusst NICHT vergebenen
 *    Tags (research/17 §7.2) fehlen, die zehn Bestands-Raumtypen ziehen keine K3a-Komponente;
 *  - Solver: je Raumtyp 3 Größen × lichte Höhe 3/4/5 × 3 Seeds → 0 Warnungen, harte Garantien (0 Kollisionen,
 *    0 Taschen, Tür frei, Kopffreiheit), Signatur platziert, Qualität über der Schwelle, deterministisch;
 *  - Mechanik der neuen Teile: Stühle der Kapelle blicken zum Altar, Eckregale in Ecken, Pfeiler bis zur Decke,
 *    Lagerfeuer nie auf dem Laufweg, Wasser eingefasst und unendlich, Notenblöcke mit Luft darüber;
 *  - Materialisierung jeder Komponente × Variante (passende Höhen, gedehnt) in 1.21.11 + 26.3 × Themes;
 *  - End-to-End über @mcda/pipeline (Einrichtung → Licht-Pass → Materialisierung): 0 Warnungen, 0 Physik-Verstöße,
 *    0 Spawn-Zellen, Truhe/Bett frei, Rahmen an vollen Blöcken.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type RoomShellInfo, type Shell, type ShellCell } from '@mcda/blueprint';
import type { ComponentDef } from '@mcda/catalog';
import { CellSet, key3, resolveRelDir, type Dir, type HorizontalDir, type Vec3 } from '@mcda/core';
import { WorldView, materialize, type MaterializePlacement } from '@mcda/materialize';
import { generate, placedFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import {
  RoomPlanner, expandComponent, fitsRoomHeight, furnishRoom, renderAscii, verticality,
  type FurnishResult, type PlacedComponent, type RoomGeometry,
} from '../src/index.js';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { DV, assertHardGuarantees, catalog, lShellRoom, shellRoom } from './fixtures.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/** Die 16 Raumtypen dieser Welle mit ihren Signatur-Tags (research/17 §7.1). */
const K3A_ROOMS: Readonly<Record<string, readonly string[]>> = {
  entrance_hall: ['runner_rug', 'fn_runner'], // FN: Prunk-Läufer ersetzt den Bestandsläufer als Signatur
  gallery: ['pilaster'],
  solar: ['fireplace'],
  trophy_room: ['trophy_pedestal'],
  chapel: ['chapel_altar'],
  guest_room: ['bed_single'],
  nursery: ['crib'],
  study: ['study_desk', 'desk'],
  washroom: ['washstand'],
  bathhouse: ['bath_pool'],
  infirmary: ['sickbed'],
  attic: ['junk_pile'],
  tower_room: ['corner_shelf'],
  music_room: ['keyboard_instrument'],
  game_room: ['game_table'],
  observatory: ['telescope'],
};
const TYPES = Object.keys(K3A_ROOMS);

/** Neue Komponenten (research/17 §7.2 + research/11 map_desk + Übergangsformen stone_pool, chapel_altar). */
const K3A_COMPONENTS: readonly string[] = [
  'decor/coat_stand', 'decor/room_directory', 'arch/wall_pilaster', 'arch/pilaster_bay', 'arch/fireplace_wall', 'table/study_desk',
  'bed/crib', 'decor/patchwork_rug', 'decor/toy_blocks', 'bed/sickbed_screen', 'storage/corner_shelf', 'decor/crystal_orb', 'storage/junk_pile',
  'decor/cobweb_corner', 'bath/washstand', 'bath/latrine_seat', 'decor/towel_rack', 'bath/wooden_tub', 'bath/stone_pool',
  'decor/head_pedestal', 'storage/display_shelf', 'sacred/pulpit', 'sacred/chapel_altar', 'music/harpsichord', 'music/pipe_organ',
  'music/jukebox_cabinet', 'decor/chess_floor', 'decor/dart_board', 'astro/telescope', 'astro/star_cluster', 'astro/armillary',
  'work/map_desk',
];

/** Raumtypen vor den Wellen K3a–K3d: sie dürfen keine K3a-Komponente ziehen (Ausnahmen: `EXISTING_PULLS_ALLOWED`). */
const EXISTING_ROOMS = ['alchemy', 'bedroom', 'farm_room', 'kitchen', 'library', 'smithy', 'stable', 'storage', 'tavern', 'workshop_redstone'];

/**
 * W7 (27.09.2026): bewusste Ausnahmen von der Tag-Politik – K3a-Komponenten, die ein Bestands-Raumtyp ziehen darf.
 * Die Politik schützte beim Einführen von K3a die alten Räume vor unbemerkten Änderungen; eine Ausnahme ist erlaubt, wenn
 * sie gewollt ist (Vorbilder) und mechanisch sicher bleibt – dafür laufen die Mechanik-Prüfungen unten auch für diese
 * Raumtypen (`FIRE_ROOMS`: Lagerfeuer nie auf dem Laufweg; End-to-End mit Licht-Pass: 0 Physik-Verstöße, 0 Spawn-Zellen).
 *  - Taverne: Kamin (`arch/fireplace_wall`) in der Gaststube (Vorbilder: Schankraum mit Kamin, plan/spikes/W7F_innen.md)
 */
const EXISTING_PULLS_ALLOWED: Readonly<Record<string, readonly string[]>> = { tavern: ['arch/fireplace_wall'] };
/** Raumtypen, deren Kamin (Lagerfeuer) in der Mechanik-Prüfung „nie auf dem Laufweg“ steht. */
const FIRE_ROOMS = ['solar', 'tavern'] as const;

/** Bewusst NICHT vergebene Tags (research/17 §7.2) je Komponente. */
const FORBIDDEN_TAGS: Readonly<Record<string, readonly string[]>> = {
  'decor/patchwork_rug': ['rug'],
  'bath/washstand': ['sink'],
  'table/study_desk': ['desk'],
  'storage/corner_shelf': ['bookshelf_wall'],
  'bed/sickbed_screen': ['bed_single', 'bed'],
  'bed/crib': ['bed_single', 'bed'],
  'decor/head_pedestal': ['trophy', 'pedestal'],
  'storage/junk_pile': ['goods'],
  'decor/cobweb_corner': ['decor_ceiling'],
  'astro/star_cluster': ['light_ceiling', 'decor_ceiling'],
  'work/map_desk': ['lectern'],
};

const variantsOf = (d: ComponentDef): (string | undefined)[] => d.variants?.map((v) => v.id) ?? [undefined];
const tagsOfPlacement = (r: FurnishResult): Set<string> => new Set(r.placements.flatMap((p) => catalog.get(p.componentId).tags));
const ascii = (g: RoomGeometry, r: FurnishResult): string => renderAscii(g, r.placed, (id) => catalog.get(id).tags);

describe('K3a-Katalog: Komponenten, Raumtypen, Tag-Politik', () => {
  it('alle 32 neuen Komponenten und 16 Raumtypen sind geladen und validiert', () => {
    expect(new Set(K3A_COMPONENTS).size).toBe(K3A_COMPONENTS.length);
    for (const id of K3A_COMPONENTS) expect(catalog.find(id), id).toBeDefined();
    for (const id of TYPES) {
      expect(catalog.roomTypeIds(), id).toContain(id);
      expect(catalog.missingTags(id, DV), id).toEqual([]);
    }
  });

  it('jede neue Komponente ist über einen K3a-Raumtyp (Eintrag, Licht-Wunsch) oder einen Socket erreichbar', () => {
    const reachable = new Set<string>();
    for (const id of TYPES) {
      const rt = catalog.roomType(id);
      for (const e of [...rt.required, ...rt.optional]) e.tags.forEach((t) => reachable.add(t));
      rt.lighting?.prefer?.forEach((t) => reachable.add(t));
    }
    for (const def of catalog.all()) for (const v of variantsOf(def)) expandComponent(def, v).sockets.forEach((s) => s.accepts.forEach((t) => reachable.add(t)));
    expect(K3A_COMPONENTS.filter((id) => !catalog.get(id).tags.some((t) => reachable.has(t)))).toEqual([]);
  });

  it('bewusst nicht vergebene Tags fehlen; kein Bestands-Raumtyp und kein Bestands-Socket zieht eine K3a-Komponente', () => {
    for (const [id, tags] of Object.entries(FORBIDDEN_TAGS)) for (const t of tags) expect(catalog.get(id).tags, `${id}: ${t}`).not.toContain(t);
    const mine = new Set(K3A_COMPONENTS);
    const pulledByExisting = new Map<string, ComponentDef>();
    for (const rtId of EXISTING_ROOMS) {
      if (!catalog.roomTypeIds().includes(rtId)) continue;
      const rt = catalog.roomType(rtId);
      for (const e of [...rt.required, ...rt.optional, ...(rt.lighting?.prefer ?? []).map((t) => ({ tags: [t] }))]) {
        const defs = catalog.byTags(e.tags, DV);
        const allowed = EXISTING_PULLS_ALLOWED[rtId] ?? [];
        expect(defs.filter((d) => mine.has(d.id) && !allowed.includes(d.id)).map((d) => d.id), `${rtId}: ${e.tags.join('|')}`).toEqual([]);
        for (const d of defs) pulledByExisting.set(d.id, d);
      }
    }
    // … auch nicht über die Sockets ihrer Möbel (Tischdeko, Nachttisch, Stapel, Hocker, Hängelampe)
    for (const def of pulledByExisting.values()) {
      for (const v of variantsOf(def)) {
        for (const s of expandComponent(def, v).sockets) {
          const pulled = catalog.byTags(s.accepts, DV).filter((d) => mine.has(d.id)).map((d) => d.id);
          expect(pulled, `${def.id}#${v} Socket ${s.id}`).toEqual([]);
        }
      }
    }
  });

  it('jede Signatur-Familie hat eine Form für lichte Höhe 2 (Kompaktform) und eine für Höhe ≥ 3', () => {
    for (const [id, sig] of Object.entries(K3A_ROOMS)) {
      const forms = catalog.byTags(sig, DV).flatMap((d) => variantsOf(d).map((v) => ({ d, v, h: expandComponent(d, v).size[1] })));
      expect(forms.some((f) => f.h <= 2 && fitsRoomHeight(f.d, f.v, 2)), `${id}: keine Form bis 2 hoch`).toBe(true);
      expect(forms.some((f) => fitsRoomHeight(f.d, f.v, 4)), `${id}: keine Form für Höhe 4`).toBe(true);
    }
  });
});

/** Mindest-Qualität je Raum (0,65 · Mittel + 0,35 · Minimum der Teilwerte). */
const Q_MIN = 0.5;
const SIZES = [[8, 7], [10, 8], [12, 9]] as const;

describe('K3a-Solver: 16 Raumtypen × 3 Größen × lichte Höhe 3/4/5 × 3 Seeds', () => {
  for (const type of TYPES) {
    it(`${type}: 0 Warnungen, harte Garantien, Signatur, Qualität > ${Q_MIN}, Vertikalität`, { timeout: HEAVY_TIMEOUT }, () => {
      const rt = catalog.roomType(type);
      let q = 0, n = 0, levels = 0;
      for (const [w, d] of SIZES) {
        for (const H of [3, 4, 5]) {
          for (let seed = 0; seed < 3; seed++) {
            const g = shellRoom(w, d, { height: H, inner: seed === 1 ? ['north'] : [], windowSpacing: 4 });
            if (g.interior.size < rt.minArea) continue;
            const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
            const where = `${type} ${w}×${d} H${H} seed ${seed}\n${ascii(g, r)}`;
            expect(r.warnings, where).toEqual([]);
            assertHardGuarantees(g, r, where);
            const tags = tagsOfPlacement(r);
            expect(K3A_ROOMS[type]!.some((t) => tags.has(t)), `${where}\nSignatur fehlt`).toBe(true);
            expect(r.quality.score, `${where}\n${JSON.stringify(r.quality.parts)}`).toBeGreaterThan(Q_MIN);
            expect(r.quality.parts.find((p) => p.id === 'required')!.value, where).toBe(1);
            q += r.quality.score;
            levels += verticality(r.placed, g).ratio;
            n++;
          }
        }
      }
      expect(n).toBeGreaterThan(0);
      expect(q / n, `${type}: mittlere Qualität`).toBeGreaterThan(0.75);
      expect(levels / n, `${type}: genutzte Höhenebenen`).toBeGreaterThan(0.95);
    });
  }

  it('lichte Höhe 2, L-Raum und Innenwände mit Seitentür: weiterhin 0 Warnungen und harte Garantien', { timeout: HEAVY_TIMEOUT }, () => {
    const rooms: RoomGeometry[] = [
      shellRoom(9, 8, { height: 2 }), shellRoom(7, 6, { height: 3 }), lShellRoom(3), lShellRoom(4),
      shellRoom(10, 8, { inner: ['north', 'east'], doorSide: 'west', doorAt: 1 }),
    ];
    for (const type of TYPES) {
      for (const g of rooms) {
        if (g.interior.size < catalog.roomType(type).minArea) continue;
        for (let seed = 0; seed < 3; seed++) {
          const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          const where = `${type} ${g.roomId} H${g.height} seed ${seed}\n${ascii(g, r)}`;
          expect(r.warnings, where).toEqual([]);
          assertHardGuarantees(g, r, where);
        }
      }
    }
  });

  it('deterministisch: gleicher Seed → gleiche Platzierungen und Qualität', () => {
    for (const type of TYPES) {
      const g = shellRoom(12, 9, { height: 4 });
      const a = furnishRoom(g, catalog.roomType(type), catalog, { seed: 5, dataVersion: DV });
      const b = furnishRoom(g, catalog.roomType(type), catalog, { seed: 5, dataVersion: DV });
      expect(a.placements, type).toEqual(b.placements);
      expect(a.quality, type).toEqual(b.quality);
    }
  });
});

/** Welt-Richtung → Schritt (x, z). */
const STEP2: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const center = (p: PlacedComponent): [number, number] => [p.pose.pos[0] + (p.size[0] - 1) / 2, p.pose.pos[2] + (p.size[2] - 1) / 2];

describe('K3a-Mechanik der neuen Teile (Solver-Ebene)', () => {
  it('Kapelle: Stühle kommen als Kinder des Altars, blicken zum Altar, lassen die Reihe davor und den Mittelgang frei', () => {
    let chairs = 0, rooms = 0;
    for (const [w, d] of [[10, 9], [12, 10], [11, 11]] as const) {
      for (let seed = 0; seed < 4; seed++) {
        const g = shellRoom(w, d, { height: 4, windowSpacing: 4 });
        const r = furnishRoom(g, catalog.roomType('chapel'), catalog, { seed, dataVersion: DV });
        rooms++;
        const altarIdx = r.placements.findIndex((p) => p.componentId === 'sacred/chapel_altar');
        expect(altarIdx).toBeGreaterThanOrEqual(0);
        const altar = r.placed[altarIdx]!;
        const toFront = resolveRelDir('front', altar.pose) as HorizontalDir;
        const [ax, az] = center(altar);
        r.placements.forEach((p, i) => {
          if (p.parentKey !== r.placements[altarIdx]!.key) return;
          chairs++;
          const chair = r.placed[i]!;
          const facing = resolveRelDir('front', chair.pose) as HorizontalDir;
          // Blickrichtung = zurück zum Altar (entgegen seiner Front)
          expect(STEP2[facing][0] + STEP2[toFront][0], `${seed}`).toBe(0);
          expect(STEP2[facing][1] + STEP2[toFront][1], `${seed}`).toBe(0);
          // Abstand zum Altar entlang seiner Front: 2 oder 4 (die Reihe direkt davor bleibt frei)
          const [cx, cz] = center(chair);
          const along = (cx - ax) * STEP2[toFront][0] + (cz - az) * STEP2[toFront][1];
          expect([2, 4]).toContain(along);
          // Mittelgang auf der Altarachse
          const across = Math.abs((cx - ax) * STEP2[toFront][1] + (cz - az) * STEP2[toFront][0]);
          expect(across, 'Mittelgang').toBeGreaterThanOrEqual(1);
        });
      }
    }
    expect(chairs / rooms, 'Stühle je Kapelle').toBeGreaterThanOrEqual(4);
  });

  it('Turmzimmer: L-Eckregale stehen meist in einer Ecke (beide Arme an einer Wand)', () => {
    let corner = 0, total = 0;
    for (const [w, d] of [[7, 7], [9, 8], [9, 9]] as const) {
      for (let seed = 0; seed < 6; seed++) {
        const g = shellRoom(w, d, { height: 4, windowSpacing: 4 });
        const r = furnishRoom(g, catalog.roomType('tower_room'), catalog, { seed, dataVersion: DV });
        r.placed.forEach((p, i) => {
          const v = r.placements[i]!.variantId ?? '';
          if (p.expanded.defId !== 'storage/corner_shelf' || !v.startsWith('corner')) return;
          total++;
          // Arm-Zelle (vorn, unterste Lage): hat eine Wand zur Seite
          const arm = p.cells.find((c) => c.local[2] === 1 && c.local[1] === 0)!;
          const inRoom = (x: number, z: number) => g.interior.has(x, z);
          const side = [STEP2.east, STEP2.west].concat([STEP2.north, STEP2.south]).filter(([dx, dz]) => !inRoom(arm.pos[0] + dx, arm.pos[2] + dz));
          if (side.length > 0) corner++;
        });
      }
    }
    expect(total).toBeGreaterThan(10);
    expect(corner / total, `${corner}/${total} in Ecken`).toBeGreaterThan(0.8);
  });

  it('Galerie: Wandpfeiler im Takt, Pfosten von Pfeilern und Buchten reichen bis unter die Decke (V3 stretch)', () => {
    for (const H of [3, 4, 6, 8]) {
      const g = shellRoom(14, 6, { height: H, windowSpacing: 4 });
      const r = furnishRoom(g, catalog.roomType('gallery'), catalog, { seed: 1, dataVersion: DV });
      const pillars = r.placed.filter((p) => p.expanded.defId === 'arch/wall_pilaster' || p.expanded.defId === 'arch/pilaster_bay');
      expect(pillars.filter((p) => p.expanded.defId === 'arch/wall_pilaster').length, `H${H}`).toBeGreaterThanOrEqual(2);
      for (const b of pillars) expect(Math.max(...b.cells.map((c) => c.pos[1])) - g.baseY + 1, `H${H} ${b.expanded.defId}#${b.expanded.variantId}`).toBe(H);
    }
  });

  it('K3d-Teile kommen zum Einsatz: Hochbett in Kinder-/Gästezimmer (ab H4), Sofa und Paneele in der Wohnstube', { timeout: HEAVY_TIMEOUT }, () => {
    const count = (type: string, H: number, ids: readonly string[]): number => {
      let n = 0;
      for (const [w, d] of [[10, 8], [12, 9], [12, 10]] as const) {
        for (let seed = 0; seed < 8; seed++) {
          const g = shellRoom(w, d, { height: H, inner: seed % 2 === 0 ? ['north'] : [], windowSpacing: 4 });
          const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          assertHardGuarantees(g, r, `${type} H${H} seed ${seed}`);
          n += r.placements.filter((p) => ids.includes(p.componentId)).length;
        }
      }
      return n;
    };
    for (const type of ['nursery', 'guest_room']) {
      expect(count(type, 3, ['bed/loft']), `${type} H3: Hochbett erst ab H4`).toBe(0);
      expect(count(type, 5, ['bed/loft']), `${type} H5`).toBeGreaterThan(0);
    }
    expect(count('solar', 4, ['seat/sofa'])).toBeGreaterThan(0);
    expect(count('solar', 4, ['decor/wall_panels'])).toBeGreaterThan(0);
  });

  it('Lagerfeuer (Kamin) nie auf dem Laufweg: Block darüber oder rundum eingefasst (Wohnstube, W7: Taverne)', { timeout: HEAVY_TIMEOUT }, () => {
    let fires = 0;
    for (const type of FIRE_ROOMS) {
      for (const H of [2, 3, 4, 6]) {
        for (let seed = 0; seed < 6; seed++) {
          const [w, d] = type === 'tavern' ? [12, 9] : [10, 8];
          const g = shellRoom(w, d, { height: H, inner: seed % 2 === 0 ? ['north'] : [], windowSpacing: 4 });
          const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          const blocks = new Set(r.placed.flatMap((p) => p.cells.map((c) => key3(c.pos))));
          for (const p of r.placed) {
            for (const c of p.cells.filter((x) => x.mat.block === 'minecraft:campfire')) {
              const covered = blocks.has(key3([c.pos[0], c.pos[1] + 1, c.pos[2]]));
              const enclosed = Object.values(STEP2).every(([dx, dz]) => !g.interior.has(c.pos[0] + dx, c.pos[2] + dz) || blocks.has(key3([c.pos[0] + dx, c.pos[1], c.pos[2] + dz])));
              expect(covered || enclosed, `${type} H${H} seed ${seed} ${p.expanded.variantId} ${c.pos.join(',')}`).toBe(true);
              fires++;
            }
          }
        }
      }
    }
    expect(fires, 'Lagerfeuer geprüft').toBeGreaterThan(40);
  });

  it('Badebecken und Zuber: Wasser rundum eingefasst, eine Zelle mit zwei Quell-Nachbarn (unendliche Quelle)', () => {
    for (const id of ['bath/wooden_tub', 'bath/stone_pool']) {
      const def = catalog.get(id);
      for (const v of variantsOf(def)) {
        const e = expandComponent(def, v);
        const water = e.cells.filter((c) => c.mat.block === 'minecraft:water');
        const at = new Set(e.cells.map((c) => key3(c.at)));
        const isWater = new Set(water.map((c) => key3(c.at)));
        expect(water.length, `${id}#${v}`).toBeGreaterThanOrEqual(3);
        for (const c of water) {
          expect(c.at[1], `${id}#${v}: Wasser auf dem Boden`).toBe(0);
          for (const [dx, dz] of Object.values(STEP2)) expect(at.has(key3([c.at[0] + dx, 0, c.at[2] + dz])), `${id}#${v}: offen bei ${c.at.join(',')}`).toBe(true);
        }
        const infinite = water.some((c) => Object.values(STEP2).filter(([dx, dz]) => isWater.has(key3([c.at[0] + dx, 0, c.at[2] + dz]))).length >= 2);
        expect(infinite, `${id}#${v}`).toBe(true);
      }
    }
  });

  it('Notenblöcke (Orgel, Musikschrank): Luft darüber in jeder Form (Wiki: sonst stumm)', () => {
    for (const id of ['music/pipe_organ', 'music/jukebox_cabinet']) {
      const def = catalog.get(id);
      for (const v of variantsOf(def)) {
        const e = expandComponent(def, v);
        const air = new Set(e.air.map(key3));
        for (const c of e.cells.filter((x) => x.mat.block === 'minecraft:note_block')) {
          expect(air.has(key3([c.at[0], c.at[1] + 1, c.at[2]])), `${id}#${v} ${c.at.join(',')}`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------- Materialisierung je Komponente

const VERSIONS = ['1.21.11', '26.3'] as const;
const FACING: Readonly<Record<number, Dir>> = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const STEP: Readonly<Record<Dir, Vec3>> = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const up = (p: Vec3): Vec3 => [p[0], p[1] + 1, p[2]];

/** Synthetische Hülle (wie vertical-pipeline.test.ts): Innenraum 10×8, lichte Höhe H, feste Wände, Tür Süd. */
function shellOf(H: number): { shell: Shell; geom: RoomShellInfo } {
  const roomId = 'r1';
  const cells: ShellCell[] = [];
  const W = 11, D = 9, doorX = 5;
  for (let x = 0; x <= W; x++) {
    for (let z = 0; z <= D; z++) {
      cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId });
      cells.push({ pos: [x, H + 1, z], kind: 'ceiling', role: 'ceiling', shape: 'block', roomId, exterior: true });
      const edgeX = x === 0 || x === W, edgeZ = z === 0 || z === D;
      if (!edgeX && !edgeZ) continue;
      for (let y = 1; y <= H; y++) {
        const pos: Vec3 = [x, y, z];
        if (edgeX && edgeZ) cells.push({ pos, kind: 'pillar', role: 'beam', shape: 'log', orient: { axis: 'y' }, roomId, exterior: true });
        else if (z === D && x === doorX && y <= 2) cells.push({ pos, kind: 'door', role: 'door', shape: 'door', orient: { facing: 'south', half: y === 1 ? 'lower' : 'upper', hinge: 'left' }, roomId, exterior: true });
        else cells.push({ pos, kind: 'wall', role: 'wall_primary', shape: 'block', roomId, exterior: true });
      }
    }
  }
  const geom: RoomShellInfo = {
    roomId, floorIndex: 0, baseY: 1, height: H, interior: CellSet.rect(1, 1, W - 1, D - 1),
    doors: [{ inside: [doorX, D - 1], toward: 'south', isMain: true }], windows: [],
  };
  return { shell: { cells, rooms: new Map([[roomId, geom]]), warnings: [] }, geom };
}

/** Fertige Welt: Truhe ohne vollen Block darüber, Bett ohne erstickenden Block, Rahmen an vollen Blöcken in freier Zelle. */
function assertWorld(view: WorldView, where: string): void {
  for (const c of view.volume.cells()) {
    if (c.state.name === 'chest') expect(view.info(up(c.pos)).phys.cls, `${where}: Block über Truhe bei ${c.pos.join(',')}`).not.toBe('full');
    if (c.state.name.endsWith('_bed')) expect(view.info(up(c.pos)).phys.cls, `${where}: Block über Bett bei ${c.pos.join(',')}`).not.toBe('full');
    if (c.state.name === 'note_block') expect(view.info(up(c.pos)).phys.cls, `${where}: Notenblock ohne Luft darüber bei ${c.pos.join(',')}`).toBe('air');
  }
  for (const f of view.volume.entities()) {
    const s = STEP[FACING[(f.nbt.value['Facing'] as { value: number }).value]!];
    const behind: Vec3 = [f.blockPos[0] - s[0], f.blockPos[1] - s[1], f.blockPos[2] - s[2]];
    expect(view.info(behind).phys.cls, `${where}: Rahmen bei ${f.blockPos.join(',')} ohne festen Block`).toBe('full');
    expect(['air', 'thin'], `${where}: Rahmen-Zelle belegt`).toContain(view.info(f.blockPos).phys.cls);
  }
}

describe('K3a-Komponenten materialisieren in 1.21.11 + 26.3 (jede Variante, passende lichte Höhe, gedehnt)', () => {
  const HEIGHTS = [2, 3, 4, 5, 6, 8];
  for (const id of K3A_COMPONENTS) {
    it(id, { timeout: HEAVY_TIMEOUT }, () => {
      const def = catalog.get(id);
      let tested = 0;
      for (const base of variantsOf(def)) {
        const heights = HEIGHTS.filter((H) => {
          const size = expandComponent(def, new RoomPlanner(shellOf(H).geom).adapt(def, base)).size[1];
          return fitsRoomHeight(def, base, H) && size <= H && (def.mount !== 'ceiling' || H - size >= 2);
        });
        expect(heights.length, `${id}#${base}: keine passende Höhe`).toBeGreaterThan(0);
        heights.forEach((H, i) => {
          const { shell, geom } = shellOf(H);
          const planner = new RoomPlanner(geom);
          const variantId = planner.adapt(def, base);
          const placed = planner.poses(def, variantId)[0];
          expect(placed, `${id}#${base} H${H}: keine gültige Pose`).toBeDefined();
          const placements: MaterializePlacement[] = [{ id: 'c0', placed: placed!, roomId: 'r1' }];
          for (const version of VERSIONS) {
            for (const themeId of i === 0 ? ctx.themes.ids() : ['medieval']) {
              const w = `${id}#${base ?? ''} H${H} (${placed!.expanded.variantId ?? '-'}) · ${themeId} · ${version}`;
              const r = materialize({ shell, placements, theme: ctx.themes.get(themeId), platform: ctx.platform(version), seed: 11 });
              const hard = r.violations.filter((v) => v.kind !== 'spawn');
              expect(hard, `${w}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
              expect(r.volume.cellsOf('c0').length, w).toBe(placed!.cells.length);
              expect(r.volume.entitiesOf('c0').length, w).toBe(placed!.entities.length);
              assertWorld(new WorldView(r.volume, ctx.platform(version)), w);
            }
          }
          tested++;
        });
      }
      expect(tested).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------- End-to-End (Pipeline mit Licht-Pass)

function e2e(type: string, w: number, d: number, H: number, seed: number, version: keyof typeof TARGET_VERSIONS, themeId: string): { above: number; ratio: number } {
  const p = Project.create({ id: 'k3a', name: 'K3a', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: H } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  const world = generate(p, ctx);
  const room = p.state.rooms[0]!;
  const info = world.shell.rooms.get(room.id)!;
  const placed = p.state.placements.filter((x) => x.roomId === room.id).map((x) => placedFor(x, ctx.catalog));
  const where = `${type} ${w}×${d} H${H} seed ${seed} ${version} ${themeId}\n${renderAscii(info, placed, (id) => ctx.catalog.get(id).tags)}`;
  expect(world.warnings, where).toEqual([]);
  // 0 Physik-Verstöße UND 0 Spawn-Zellen (Verstoß-Art `spawn` = begehbare Zelle mit Blocklicht 0)
  expect(world.materialized.violations, `${where}\n${JSON.stringify(world.materialized.violations.slice(0, 3))}`).toEqual([]);
  expect(world.materialized.light.darkCells, where).toEqual([]);
  const tags = new Set(placed.map((x) => x.expanded.defId).flatMap((id) => ctx.catalog.get(id).tags));
  expect(K3A_ROOMS[type]!.some((t) => tags.has(t)), `${where}\nSignatur fehlt`).toBe(true);
  assertWorld(new WorldView(world.materialized.volume, ctx.platform(version)), where);
  // Stimmungslicht: die Räume sind nicht nur spawnsicher, sondern erreichen im Mittel ihr Ziel (Bericht `lighting`)
  const v = verticality(placed, info);
  return { above: v.above, ratio: v.ratio };
}

describe('K3a End-to-End: Einrichtung → Licht-Pass → Materialisierung', () => {
  for (const type of TYPES) {
    it(`${type}: 9×8 + 12×9 × lichte Höhe 3/4/5 × 2 Seeds (1.21.11), 26.3 × alle Themes`, { timeout: HEAVY_TIMEOUT }, () => {
      const rt = ctx.catalog.roomType(type);
      let n = 0;
      for (const [w, d] of [[9, 8], [12, 9]] as const) {
        if ((w - 2) * (d - 2) < rt.minArea) continue;
        for (const H of [3, 4, 5]) for (const seed of [0, 1]) {
          e2e(type, w, d, H, seed, '1.21.11', 'medieval');
          n++;
        }
      }
      for (const themeId of ctx.themes.ids()) e2e(type, 12, 9, 4, 3, '26.3', themeId);
      expect(n).toBeGreaterThan(0);
    });
  }
});
