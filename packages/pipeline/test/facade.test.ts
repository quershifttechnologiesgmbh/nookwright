/**
 * Integration Außenprofil (research/18 §3, D2; research/16 Tricks #1, #4, #8): Hülle mit `facade` → Materialisierung.
 * Prüft Physik-Report, Treppenformen nach dem Autotiling, Licht und die Gelände-Kopplung (nur lesend).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell, type FacadeStyle, type RoofStyle, type Shell } from '@mcda/blueprint';
import { CellSet, key3 } from '@mcda/core';
import { buildingFromShell } from '@mcda/terrain';
import { buildWorld, type World } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse, twoStoryHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const ALL: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };
type Version = keyof typeof TARGET_VERSIONS;

/** L-Grundriss: Flur-Flügel (Nord-Süd) + Schankraum-Flügel nach Osten. */
function lHouse(version: Version, themeId: string): Project {
  const p = Project.create({ id: 'l', name: 'L-Haus', seed: 7, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 14), 'hallway');
  p.paintRoom(0, CellSet.rect(9, 8, 20, 14), 'tavern');
  return p;
}

const HOUSES: Record<string, (v: Version, t: string) => Project> = { sampleHouse, twoStoryHouse, lHouse };
const hard = (w: World): string[] => w.materialized.violations.filter((v) => v.kind !== 'spawn').map((v) => `${v.kind}@${v.pos?.join(',') ?? '-'}`).sort();

function check(project: Project, roof: RoofStyle): { shell: Shell; world: World } {
  const plain = buildWorld(project, ctx, deriveShell(project.state, { roof }));
  const shell = deriveShell(project.state, { roof, facade: ALL });
  const world = buildWorld(project, ctx, shell);
  const facade = shell.cells.filter((c) => c.kind === 'facade');
  expect(facade.length).toBeGreaterThan(0);
  // Physik: keine neuen Verstöße (Stütze, Schwerkraft, Treppenform), keiner an einer Profilzelle
  expect(hard(world)).toEqual(hard(plain));
  const at = new Set(facade.map((c) => key3(c.pos)));
  const own = world.materialized.violations.filter((v) => v.pos !== undefined && at.has(key3(v.pos)));
  expect(own, JSON.stringify(own.slice(0, 3))).toEqual([]);
  // Blöcke nach dem Autotiling: Ausrichtung wie bestellt, Eckstücke als Außenecke
  const vol = world.materialized.volume;
  for (const c of facade) {
    const s = vol.stateAt(c.pos);
    if (c.shape === 'stairs') {
      expect(s.name, `${c.role} ${c.pos}`).toMatch(/_stairs$/);
      expect(s.properties['facing']).toBe(c.orient!.facing);
      expect(s.properties['half']).toBe(c.orient!.half);
      if (c.orient!.stairShape !== undefined) expect(s.properties['shape'], `Ecke ${c.pos}`).toBe(c.orient!.stairShape);
    } else {
      expect(s.properties['axis'], `${c.role} ${c.pos} (${s.name})`).toBe('y');
    }
  }
  for (const c of shell.cells.filter((x) => x.role === 'wall_quoin')) expect(vol.stateAt(c.pos).properties['axis'], `Eckquader ${c.pos}`).toBeUndefined();
  // Licht: Außenprofil verdeckt nichts, das Innenlicht bleibt gleich
  expect(world.materialized.light.darkCells).toEqual(plain.materialized.light.darkCells);
  return { shell, world };
}

describe('Pipeline: Außenprofil (Anker + Fassade)', () => {
  for (const [name, make] of Object.entries(HOUSES)) {
    for (const roof of ['hip', 'gable'] as const) {
      it(`${name} · ${roof}: materialisiert ohne neue Physik-Verstöße, Ecken als Außenecke, Licht unverändert`, () => {
        check(make('1.21.11', 'medieval'), roof);
      });
    }
  }

  it('alle Themes und beide Zielversionen lösen die Profil-Rollen auf', () => {
    for (const version of ['1.21.11', '26.3'] as const) {
      for (const theme of ctx.themes.ids()) {
        const project = twoStoryHouse(version, theme);
        const shell = deriveShell(project.state, { roof: 'hip', facade: ALL });
        expect(() => buildWorld(project, ctx, shell), `${version} · ${theme}`).not.toThrow();
      }
    }
  });

  it('Gelände-Kopplung: Profilzellen gelten als belegt, ihre Spalten als überdeckt', () => {
    const project = sampleHouse('1.21.11', 'medieval');
    const shell = deriveShell(project.state, { roof: 'hip', facade: ALL });
    const b = buildingFromShell(shell);
    for (const c of shell.cells.filter((x) => x.kind === 'facade')) {
      expect(b.occupied.has(key3(c.pos))).toBe(true);
      expect(b.covered.has(c.pos[0], c.pos[2])).toBe(true);
    }
    // Die Haustür bleibt Ausgang (Sockelprofil lässt sie frei)
    expect(b.doors).toEqual(buildingFromShell(deriveShell(project.state, { roof: 'hip' })).doors);
  });
});
