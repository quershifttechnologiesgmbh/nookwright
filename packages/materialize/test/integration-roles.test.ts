/**
 * I2 – Lücken zwischen den Kontexten: Hüllen-Rollen aus Etagen (Leiter, Treppe, Geländer) und Befestigung
 * (Brüstung, Wehrgang, Turmboden, Scharte), Rollen-Rückfall, Kontext je Etage, Kontext für Bauwerke (`fort`)
 * und Gelände (`terrain`/`plant`).
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type Shell, type ShellCell } from '@mcda/blueprint';
import type { ResolvedTheme } from '@mcda/catalog';
import { CellSet, type Vec3 } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { SHELL_ROLE_FALLBACKS, SHELL_ROLE_SHAPES, effectiveShellRole, materialize, shellContext } from '../src/index.js';
import { THEME_IDS, VERSIONS, platformView, themes } from './fixtures.js';

const shellOf = (cells: ShellCell[]): Shell => ({ cells, rooms: new Map(), warnings: [] });

describe('Hüllen-Vertrag: neue Rollen und Formen (Etagen F1, Befestigung B1)', () => {
  it('SHELL_ROLE_SHAPES enthält Treppe, Podest, Geländer, Leiter und die Befestigungsrollen', () => {
    expect(SHELL_ROLE_SHAPES['beam']).toEqual(expect.arrayContaining(['log', 'stairs', 'planks', 'fence']));
    expect(SHELL_ROLE_SHAPES['ladder']).toEqual(['ladder']);
    expect(SHELL_ROLE_SHAPES['wall_primary']).toContain('stairs');
    expect(SHELL_ROLE_SHAPES['foundation']).toEqual(expect.arrayContaining(['block', 'stairs']));
    for (const r of ['parapet', 'walkway', 'tower_floor', 'arrow_slit']) expect(SHELL_ROLE_SHAPES[r], r).toBeDefined();
    // jeder Rückfall zeigt auf eine Rolle des Vertrags mit denselben Formen
    for (const [role, alt] of Object.entries(SHELL_ROLE_FALLBACKS)) {
      for (const s of SHELL_ROLE_SHAPES[role]!) expect(SHELL_ROLE_SHAPES[alt], `${role} → ${alt}`).toContain(s);
    }
  });

  for (const version of VERSIONS) {
    it(`${version}: Leiter (facing weg von der Wand), Geländer, Stufen und Scharte in allen Themes`, () => {
      for (const themeId of THEME_IDS) {
        const cells: ShellCell[] = [
          { pos: [0, 0, 0], kind: 'floor', role: 'floor_primary', shape: 'block' },
          { pos: [1, 0, 0], kind: 'floor', role: 'floor_primary', shape: 'block' },
          { pos: [2, 0, 0], kind: 'floor', role: 'floor_primary', shape: 'block' },
          { pos: [3, 0, 0], kind: 'floor', role: 'floor_primary', shape: 'block' },
          { pos: [0, 1, 0], kind: 'wall', role: 'wall_primary', shape: 'block' },
          { pos: [0, 2, 0], kind: 'wall', role: 'wall_primary', shape: 'block' },
          { pos: [1, 1, 0], kind: 'stairs', role: 'ladder', shape: 'ladder', orient: { facing: 'east' } },
          { pos: [1, 2, 0], kind: 'stairs', role: 'ladder', shape: 'ladder', orient: { facing: 'east' } },
          { pos: [2, 1, 0], kind: 'stairs', role: 'beam', shape: 'stairs', orient: { facing: 'east', half: 'bottom' } },
          { pos: [3, 1, 0], kind: 'railing', role: 'beam', shape: 'fence' },
          { pos: [0, 3, 0], kind: 'fort', role: 'arrow_slit', shape: 'pane' },
          { pos: [0, 4, 0], kind: 'fort', role: 'parapet', shape: 'block' },
          { pos: [1, 3, 0], kind: 'fort', role: 'walkway', shape: 'stairs', orient: { facing: 'west', half: 'bottom' } },
          { pos: [2, 3, 0], kind: 'fort', role: 'tower_floor', shape: 'block' },
        ];
        const r = materialize({ shell: shellOf(cells), placements: [], theme: themes.get(themeId), platform: platformView(version), seed: 1 });
        const at = (p: Vec3) => r.volume.stateAt(p);
        expect(at([1, 1, 0]), themeId).toMatchObject({ name: 'ladder', properties: { facing: 'east' } });
        expect(at([2, 1, 0]).name, themeId).toMatch(/_stairs$/);
        expect(at([3, 1, 0]).name, themeId).toMatch(/_fence$/);
        expect(at([0, 3, 0]).name, themeId).toMatch(/_bars$|_pane$/);
        expect(at([1, 3, 0]).name, themeId).toMatch(/_stairs$/);
        expect(r.violations.filter((v) => v.kind === 'support' && v.block === 'ladder'), themeId).toEqual([]);
      }
    });
  }

  it('Leiter ohne Träger dahinter ist ein Stütz-Verstoß (auch wenn darunter Boden ist)', () => {
    const cells: ShellCell[] = [
      { pos: [0, 0, 0], kind: 'floor', role: 'floor_primary', shape: 'block' },
      { pos: [0, 1, 0], kind: 'stairs', role: 'ladder', shape: 'ladder', orient: { facing: 'east' } },
    ];
    const r = materialize({ shell: shellOf(cells), placements: [], theme: themes.get('medieval'), platform: platformView('26.3'), seed: 1 });
    expect(r.violations.filter((v) => v.kind === 'support').map((v) => v.message)).toEqual([expect.stringMatching(/Leiter braucht volle Fläche dahinter/)]);
  });

  it('Rollen-Rückfall: ein Theme ohne Befestigungsrollen nimmt wall_primary bzw. window', () => {
    const base = themes.get('medieval');
    const roles = Object.fromEntries(Object.entries(base.roles).filter(([k]) => !(k in SHELL_ROLE_FALLBACKS)));
    const old: ResolvedTheme = { ...base, id: 'old', roles };
    const has = (r: string): boolean => Object.hasOwn(roles, r);
    expect(effectiveShellRole(has, 'parapet')).toBe('wall_primary');
    expect(effectiveShellRole(has, 'arrow_slit')).toBe('window');
    expect(effectiveShellRole(has, 'wall_primary')).toBe('wall_primary');
    expect(effectiveShellRole(has, 'lava_moat')).toBe('lava_moat'); // unbekannt bleibt unbekannt (klare Meldung)
    const cells: ShellCell[] = [
      { pos: [0, 0, 0], kind: 'fort', role: 'parapet', shape: 'block' },
      { pos: [0, 1, 0], kind: 'fort', role: 'arrow_slit', shape: 'pane' },
    ];
    const r = materialize({ shell: shellOf(cells), placements: [], theme: old, platform: platformView('26.3'), seed: 1, options: { weathering: false } });
    expect(r.volume.stateAt([0, 1, 0]).name).toBe('glass_pane');
    expect(r.volume.stateAt([0, 0, 0]).name).not.toBe('air');
  });
});

describe('Kontext je Etage (F1: Spalten nicht über Etagen mischen)', () => {
  // Erdgeschoss: Küche links, Schlafzimmer rechts; Obergeschoss: Bibliothek über beiden (andere Raumtypen, andere Türen)
  const p = Project.create({ id: 'f', name: 'F', seed: 5, themeId: 'medieval', targetVersion: PROJECT_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 6, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(7, 0, 13, 6), 'bedroom');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 13, 6), 'library');
  p.placeStairs(0, [2, 3], 'east');
  const shell = deriveShell(p.state, { roof: 'hip' });
  const roomTypes = Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId]));
  const ctx = shellContext(shell, roomTypes);
  const upperY = shell.rooms.get(p.state.rooms.find((r) => r.floorIndex === 1)!.id)!.baseY - 1;

  it('Bodenzellen jeder Etage gehören zum Raum DIESER Etage', () => {
    shell.cells.forEach((c, i) => {
      if (c.kind !== 'floor') return;
      const x = ctx[i]!;
      if (x.wallDist === 0) return;
      if (c.pos[1] === 0) expect(['kitchen', 'bedroom'], `${c.pos}`).toContain(x.roomType);
      if (c.pos[1] === upperY) expect(x.roomType, `${c.pos}`).toBe('library');
    });
  });

  it('eine Tür im Erdgeschoss macht oben keine Türschwelle', () => {
    const doorCols = new Set(shell.cells.filter((c) => c.kind === 'door' && c.pos[1] === 1).map((c) => `${c.pos[0]},${c.pos[2]}`));
    expect(doorCols.size).toBeGreaterThan(0);
    const upperDoorCols = new Set(shell.cells.filter((c) => c.kind === 'door' && c.pos[1] > upperY).map((c) => `${c.pos[0]},${c.pos[2]}`));
    let checked = 0;
    shell.cells.forEach((c, i) => {
      if (c.kind !== 'floor' || c.pos[1] !== upperY) return;
      const k = `${c.pos[0]},${c.pos[2]}`;
      if (!doorCols.has(k) || upperDoorCols.has(k)) return;
      expect(ctx[i]!.door, k).toBe(false);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });
});

describe('Kontext für Bauwerke (fort) und Gelände (terrain/plant)', () => {
  /** Mauer entlang x (z 0..2, x 0..9): Sockel y 0–1, Körper bis y 5, Brüstung außen (z 0) bis y 7; Turmdach daneben. */
  function fort(): ShellCell[] {
    const cells: ShellCell[] = [];
    for (let x = 0; x <= 9; x++) {
      for (let z = 0; z <= 2; z++) {
        const top = z === 0 ? 7 : 5;
        for (let y = 0; y <= top; y++) {
          const role = y <= 1 ? 'foundation' : y === 5 && z > 0 ? 'walkway' : y > 5 ? 'parapet' : 'wall_primary';
          cells.push({ pos: [x, y, z], kind: 'fort', role, shape: 'block', roomId: 'fort:w0', exterior: true });
        }
      }
    }
    for (let r = 0; r < 3; r++) for (let x = 20 + r; x <= 26 - r; x++) cells.push({ pos: [x, 10 + r, 0], kind: 'fort', role: 'roof_main', shape: 'block', roomId: 'fort:t0', exterior: true });
    return cells;
  }
  const cells = fort();
  const ctx = shellContext(shellOf(cells));
  const at = (x: number, y: number, z: number) => ctx[cells.findIndex((c) => c.pos[0] === x && c.pos[1] === y && c.pos[2] === z)]!;

  it('wall_h läuft vom Fuß bis zur Krone der Spalte (nicht ab dem globalen minY mit H = 3)', () => {
    expect(at(4, 0, 0).t.wall_h).toBe(0);
    expect(at(4, 7, 0).t.wall_h).toBe(1);
    expect(at(4, 5, 1).t.wall_h).toBe(1);
    expect(at(4, 3, 0).t.wall_h).toBeCloseTo(3 / 7, 10);
    expect(at(4, 0, 0).hRel).toBe(0); // Geländekontakt → Verwitterung „nass“
  });

  it('Rausch-Ebene entlang des Mauerlaufs (a = x, b = y), gleiche Ebene für die ganze Außenseite', () => {
    const face = cells.map((c, i) => [c, ctx[i]!] as const).filter(([c]) => c.pos[2] === 0 && c.pos[0] >= 2 && c.pos[0] <= 7 && c.role !== 'roof_main');
    expect(new Set(face.map(([, x]) => x.plane)).size).toBe(1);
    for (const [c, x] of face) {
      expect(x.surface).toBe('wall');
      expect([x.a, x.b]).toEqual([c.pos[0], c.pos[1]]);
    }
  });

  it('Turmdach: roof_t von der Traufe (0) bis zur Spitze (1) je Bauwerk', () => {
    expect(at(20, 10, 0)).toMatchObject({ surface: 'roof', t: { roof_t: 0 } });
    expect(at(23, 12, 0).t.roof_t).toBe(1);
  });

  it('Gelände: eine Ebene (x, z) für alle Höhen → Flecken laufen über Stufen weiter', () => {
    const ground: ShellCell[] = [
      { pos: [0, 3, 0], kind: 'terrain', role: 'ground_grass', shape: 'block' },
      { pos: [1, 4, 0], kind: 'terrain', role: 'ground_grass', shape: 'block' },
      { pos: [1, 5, 0], kind: 'plant', role: 'flower_wild', shape: 'block' },
    ];
    const g = shellContext(shellOf(ground));
    expect(new Set(g.map((c) => c.plane)).size).toBe(1);
    expect(g.map((c) => [c.surface, c.a, c.b])).toEqual([['ground', 0, 0], ['ground', 1, 0], ['ground', 1, 0]]);
  });

  it('Gelände und Bauwerke verschieben die Gebäude-Höhen nicht (Dach-/Gebäudeverlauf wie ohne sie)', () => {
    const p = Project.create({ id: 'h', name: 'H', seed: 5, themeId: 'medieval', targetVersion: PROJECT_VERSIONS['26.3'] });
    p.paintRoom(0, CellSet.rect(0, 0, 6, 5), 'bedroom');
    const house = deriveShell(p.state, { roof: 'hip' });
    const alone = shellContext(house);
    const extra: ShellCell[] = [
      { pos: [-3, -9, -3], kind: 'terrain', role: 'ground_stone', shape: 'block' },
      { pos: [-5, 30, -5], kind: 'fort', role: 'wall_primary', shape: 'block' },
    ];
    const merged = shellContext({ ...house, cells: [...extra, ...house.cells] }).slice(extra.length);
    expect(merged.map((c) => c.t)).toEqual(alone.map((c) => c.t));
  });

  it('Materialisierung: Mauer + Gelände in allen Themes gültig, Wehrgang/Brüstung aus eigenen Rollen', () => {
    for (const themeId of THEME_IDS) {
      const all: ShellCell[] = [...cells.filter((c) => c.role !== 'roof_main'), { pos: [4, -1, 5], kind: 'terrain', role: 'ground_grass', shape: 'block' }];
      const r = materialize({ shell: shellOf(all), placements: [], theme: themes.get(themeId), platform: platformView('26.3'), seed: 3 });
      expect(r.violations.filter((v) => v.kind !== 'spawn'), themeId).toEqual([]);
      const names = (role: string) => new Set(all.filter((c) => c.role === role).map((c) => r.volume.stateAt(c.pos).name));
      expect(names('walkway').size, themeId).toBeGreaterThan(0);
      expect(names('parapet').size, themeId).toBeGreaterThan(0);
    }
  });
});
