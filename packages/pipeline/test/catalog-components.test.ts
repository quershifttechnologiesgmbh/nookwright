/**
 * K1 (Katalog Medieval): JEDE Katalog-Komponente – alle Varianten, alle Themes – materialisiert in 1.21.11
 * und 26.3 fehlerfrei in einer echten Hülle: gültige Pose (harte Regeln des Solvers), keine Auflösungs-
 * fehler, keine Physik-/Masken-Verstöße, Rahmen hängen an einer festen Wand.
 * Surface-Komponenten stehen auf einem Eltern-Möbel mit passendem Socket.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import type { ComponentDef } from '@mcda/catalog';
import { CellSet, type Dir, type Vec3 } from '@mcda/core';
import { EXTERIOR_MOUNTS } from '@mcda/exterior';
import { RoomPlanner, expandComponent, type PlacedComponent } from '@mcda/furnishing';
import { WorldView, materialize, type MaterializePlacement } from '@mcda/materialize';
import { nodeContext } from '../src/node-context.js';
import { lavaProblems } from './lava-rule.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;

/**
 * Testraum (synthetische Hülle nach dem Vertrag blueprint/shell/types.ts): Innenraum 10×8, lichte Höhe 5
 * (Kronleuchter, Hängepflanzen), Wände ohne Fenster (lange feste Wandstücke für 4–5 breite Möbel),
 * Eckpfeiler aus Balken, eine Tür im Süden. deriveShell setzt an Außenwänden alle 3 Zellen ein Fenster –
 * dort passen breite Möbel nicht; das prüft catalog-fuzz.test.ts.
 */
const roomId = 'r1';
interface TestRoom {
  readonly shell: Shell;
  readonly geom: RoomShellInfo;
}
function buildRoom(W: number, D: number, H = 5): TestRoom {
  const cells: ShellCell[] = [];
  // Außenmaß x 0..W, z 0..D; Innen y 1..5, Decke y 6
  const doorX = 5;
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
  const info: RoomShellInfo = {
    roomId, floorIndex: 0, baseY: 1, height: H, interior: CellSet.rect(1, 1, W - 1, D - 1),
    doors: [{ inside: [doorX, D - 1], toward: 'south', isMain: true }], windows: [],
  };
  return { shell: { cells, rooms: new Map([[roomId, info]]), warnings: [] }, geom: info };
}
/**
 * Standardraum 10×8 (lichte Höhe 5); große Farm-Anlagen der FN-Welle (Größen S/M/L: Stallboxen 17 breit, Wollfarm 10 × 8, Spülfeld 9 × 9)
 * passen dort nicht mit ihren Masken hinein und bekommen den großen Raum 22×18 mit lichter Höhe 7 (breite Sortier-Bänke `fn_wide`, 14–20 breit: Halle 26×9) (Kolben-Melonenfarm: 6 hoch; sie sind für Hallen gedacht, nicht für Kammern).
 */
const ROOMS: readonly TestRoom[] = [buildRoom(11, 9), buildRoom(23, 19, 7), buildRoom(26, 9)];

const variantsOf = (def: ComponentDef): (string | undefined)[] => def.variants?.map((v) => v.id) ?? [undefined];

interface Setup {
  readonly room: TestRoom;
  readonly placed: PlacedComponent;
  readonly parent?: PlacedComponent;
}

/** Erste gültige Pose im Testraum (Surface: auf einem Eltern-Möbel, dessen Socket die Komponente nimmt); kleinster Raum zuerst. */
function setupFor(def: ComponentDef, variantId: string | undefined): Setup | undefined {
  for (const room of ROOMS) {
    const found = setupIn(room, def, variantId);
    if (found !== undefined) return found;
  }
  return undefined;
}

function setupIn(room: TestRoom, def: ComponentDef, variantId: string | undefined): Setup | undefined {
  const geom = room.geom;
  if (def.mount !== 'surface') {
    const placed = new RoomPlanner(geom).poses(def, variantId)[0];
    return placed === undefined ? undefined : { room, placed };
  }
  for (const pdef of ctx.catalog.all()) {
    if (pdef.mount === 'surface') continue;
    for (const pv of variantsOf(pdef)) {
      const exp = expandComponent(pdef, pv);
      if (!exp.sockets.some((s) => s.type === 'surface' && def.tags.some((t) => s.accepts.includes(t)))) continue;
      const parent = new RoomPlanner(geom).poses(pdef, pv)[0];
      if (parent === undefined) continue;
      const sp = new RoomPlanner(geom, [parent]).socketPoses(def, variantId, [{ key: 'parent', placed: parent }])[0];
      if (sp !== undefined) return { room, placed: sp.placed, parent };
    }
  }
  return undefined;
}

const FACING: Readonly<Record<number, Dir>> = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const STEP: Readonly<Record<Dir, Vec3>> = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };

// Außen-Montagen (X1: facade/eave/roof/roof_peak) setzt nur der Außen-Solver – geprüft in exterior-catalog.test.ts
const cases = ctx.catalog.all().filter((def) => !EXTERIOR_MOUNTS.has(def.mount)).flatMap((def) => variantsOf(def).map((variantId) => ({ def, variantId })));

describe('K1: jede Komponente materialisiert fehlerfrei (alle Varianten, alle Themes, 1.21.11 + 26.3)', () => {
  it('der Katalog ist gewachsen (Signatur-Möbel und Deko sind da)', () => {
    for (const id of ['bed/canopy', 'bed/canopy_double', 'bed/canopy_head', 'work/kitchen_hearth', 'work/kitchen_hearth_low', 'work/forge', 'work/forge_low', 'storage/chest_wall', 'storage/chest_wall_low', 'storage/barrel_wall']) {
      expect(ctx.catalog.find(id), id).toBeDefined();
    }
    expect(ctx.catalog.size).toBeGreaterThanOrEqual(60);
  });

  const setups = new Map<string, Setup | undefined>();
  for (const { def, variantId } of cases) {
    const label = `${def.id}${variantId !== undefined ? `#${variantId}` : ''}`;
    it(label, () => {
      if (!setups.has(label)) setups.set(label, setupFor(def, variantId));
      const setup = setups.get(label);
      expect(setup, `${label}: keine gültige Pose im Testraum`).toBeDefined();
      const shell = setup!.room.shell;
      const placements: MaterializePlacement[] = [
        ...(setup!.parent !== undefined ? [{ id: 'parent', placed: setup!.parent, roomId }] : []),
        { id: 'c', placed: setup!.placed, roomId },
      ];
      for (const version of VERSIONS) {
        const platform = ctx.platform(version);
        if (def.minVersion !== undefined && platform.registry.dataVersion < def.minVersion) continue;
        for (const themeId of ctx.themes.ids()) {
          const where = `${label} · ${themeId} · ${version}`;
          const r = materialize({ shell, placements, theme: ctx.themes.get(themeId), platform, seed: 11 });
          const hard = r.violations.filter((v) => v.kind !== 'spawn');
          expect(hard, `${where}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
          // alle Zellen der Komponente sind gesetzt, alle Entities exportiert
          expect(r.volume.cellsOf('c').length, where).toBe(setup!.placed.cells.length);
          const frames = r.volume.entitiesOf('c');
          expect(frames.length, where).toBe(setup!.placed.entities.length);
          const view = new WorldView(r.volume, platform);
          for (const f of frames) {
            const facing = FACING[(f.nbt.value['Facing'] as { value: number }).value]!;
            const s = STEP[facing];
            const behind: Vec3 = [f.blockPos[0] - s[0], f.blockPos[1] - s[1], f.blockPos[2] - s[2]];
            // Rahmen hängt an einem vollen Block (Raumwand), nicht an einer Truhe; seine Zelle ist frei
            expect(view.info(behind).phys.cls, `${where}: Rahmen bei ${f.blockPos.join(',')} ohne Wand`).toBe('full');
            expect(view.state(behind).name).not.toMatch(/chest|barrel/);
            expect(['air', 'thin'], `${where}: Rahmen-Zelle belegt`).toContain(view.info(f.blockPos).phys.cls);
          }
          // Deko-Blätter zerfallen nicht (Faktencheck #17)
          for (const c of r.volume.cellsOf('c')) {
            if (c.state.name.endsWith('_leaves')) expect(c.state.properties['persistent'], where).toBe('true');
            expect(lavaProblems(r.volume, c.pos as Vec3, c.state.name), `${where}: Lava nur versiegelt (research/10 §11 #5)`).toEqual([]);
          }
        }
      }
    });
  }
});
