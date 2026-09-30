/**
 * Ruine/Erosion (additiv, research/50 C1): deterministischer Pass, der einen zusammenhängenden Cap von oben je
 * Hüllspalte entfernt, damit der Bau als Ruine lesbar wird.
 *
 * Vertrag (contract-first): **Ohne `decor.ruin` im Theme ändert sich nichts** – Größe, Ursprung und Prüfsumme
 * eines Kontrollthemes sind bitgleich zum Stand vor dem Pass (unten fest verdrahtet). Die Option allein schaltet
 * den Pass NICHT an; es braucht das Theme-Feld. Wichtig: `ruin` ist KEIN Parity-Theme
 * (`surface-parity.test.ts` prüft nur medieval/nordic/rustic) – die gewollte Änderung dort bewegt keine Summe.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type RoofStyle, type Shell, type ShellCell } from '@mcda/blueprint';
import { CellSet, key3 } from '@mcda/core';
import { isAir } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import {
  materialize, planRuin, ruinSettings, shellContext, type MaterializeOptions, type MaterializePlacement, type MaterializeResult,
} from '../src/index.js';
import { furnished, platformView, roomShell, themes } from './fixtures.js';

const VERSION = '26.3';
/** L-förmiger Raum: 10 × 5 oben, 5 × 5 darunter (dieselbe Vorlage wie snow.test.ts/variance.test.ts). */
const L_ROOM = CellSet.rect(0, 0, 9, 4).union(CellSet.rect(0, 5, 4, 9));

interface House {
  readonly shell: Shell;
  readonly roomTypes: Record<string, string>;
}

function house(roof: RoofStyle, projectSeed = 5): House {
  const p = Project.create({ id: 's', name: 'S', seed: projectSeed, themeId: 'medieval', targetVersion: PROJECT_VERSIONS[VERSION], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, L_ROOM, 'bedroom');
  const shell = deriveShell(p.state, { roof, overhang: 1 });
  return { shell, roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

function run(h: House, themeId: string, options?: MaterializeOptions, seed = 2026, placements: readonly MaterializePlacement[] = []): MaterializeResult {
  return materialize({
    shell: h.shell, placements, theme: themes.get(themeId), platform: platformView(VERSION), seed, roomTypes: h.roomTypes,
    ...(options !== undefined ? { options } : {}),
  });
}

/** FNV-1a über alle Blöcke (Position, Name, Properties) – identisch zu surface-parity.test.ts. */
function checksum(r: MaterializeResult): string {
  let h = 0x811c9dc5;
  for (const line of (function* () { for (const c of r.volume.cells()) yield `${c.pos.join(',')}=${c.state.name}${JSON.stringify(c.state.properties)}`; })()) {
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 10;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const cellCount = (r: MaterializeResult): number => [...r.volume.cells()].length;
const errorViolations = (r: MaterializeResult) => r.violations.filter((v) => v.severity === 'error');

/** Hüllzellen, die im Volumen fehlen (Luft oder außerhalb des durch die Erosion geschrumpften Volumens). */
function missingShellCells(r: MaterializeResult, shell: Shell): ShellCell[] {
  return shell.cells.filter((c) => !r.volume.contains(c.pos) || isAir(r.volume.stateAt(c.pos)));
}

/** Vor dem Pass gemessen (Stand „vor der Änderung“): Größe, Ursprung und Prüfsumme des Kontrollthemes. */
// W2 (26.09.2026): Regeln W4/W5/W6/D1 – medieval neu (Materialbudget, Fassadenverlauf, Deckungsrezept); vorher 'fbe9bf83'
// W4 (27.09.2026): W4-E Dachraum-Licht (Laterne auf dem Dachboden des Walmdachs) + W4-G Dielen je Brett (M6),
// Holzwand-Fuß als Reihe (M4) – medieval neu; vorher '74285061' (W4-E allein 'efa6dee0', W4-G allein '3ea4e5a9')
// W9-G5 (2026-09-27): medieval neu – Wandverlauf mit Bruch-Tiefenschiefer am Fuß, Dach in drei Ringtönen mit Flecken (Review R5 G5); vorher '9c1a5b98'
const CONTROL = { size: [12, 8, 12], origin: [-1, 0, -1], medieval: '656d3667' } as const;

describe('Ruine: ruin-Theme bekommt Erosion, andere Themes bleiben bitgleich', () => {
  it('(a) ruin (Walmdach): Zellen entfernt und 0 harte Meldungen', () => {
    const h = house('hip');
    const off = run(h, 'ruin', { ruin: false });
    const on = run(h, 'ruin');
    const removed = cellCount(off) - cellCount(on);
    const share = removed / cellCount(off);
    // eslint-disable-next-line no-console
    console.log(`[ruin] hip: ${removed} von ${cellCount(off)} Zellen entfernt (${(share * 100).toFixed(2)} %), Volumen ${on.volume.size.join('×')}`);
    expect(removed).toBeGreaterThan(0);
    // sichtbar, aber nicht zerstörerisch: deutlich unter einem Fünftel der Hüllzellen
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.2);
    expect(errorViolations(on)).toEqual([]);
    // die fehlenden Hüllzellen sind wirklich erodiert (Luft) – keine stillen Merge-Verluste
    for (const c of missingShellCells(on, h.shell)) expect(isAir(on.volume.stateAt(c.pos)), `${c.pos.join(',')}`).toBe(true);
  });

  it('(b) Kontrolltheme ohne Feld (medieval): Volumen bitgleich, Option allein wirkungslos', () => {
    const h = house('hip');
    const r = run(h, 'medieval');
    expect(r.volume.size).toEqual(CONTROL.size);
    expect(r.volume.origin).toEqual(CONTROL.origin);
    expect(checksum(r)).toBe(CONTROL.medieval);
    // Option setzt den Pass NICHT in Gang – es braucht das Theme-Feld.
    const forced = run(h, 'medieval', { ruin: { roles: ['wall_primary', 'roof_main'], chance: 1, maxDrop: 3 } });
    expect(checksum(forced)).toBe(CONTROL.medieval);
    expect(ruinSettings(themes.get('medieval'))).toBeUndefined();
    expect(ruinSettings(themes.get('ruin'), false)).toBeUndefined();
    expect(ruinSettings(themes.get('ruin'))?.roles.has('wall_primary')).toBe(true);
  });

  it('(c) deterministisch: zwei Läufe sind bitgleich', () => {
    const h = house('gable');
    const a = run(h, 'ruin');
    const b = run(h, 'ruin');
    expect(checksum(a)).toBe(checksum(b));
    expect(missingShellCells(a, h.shell).map((c) => c.pos.join(','))).toEqual(missingShellCells(b, h.shell).map((c) => c.pos.join(',')));
  });

  it('(d) keine Tür-, Fenster- oder Bodenzelle entfernt', () => {
    const h = house('hip');
    const on = run(h, 'ruin');
    const never = h.shell.cells.filter((c) => c.kind === 'door' || c.kind === 'window' || c.kind === 'floor');
    expect(never.length).toBeGreaterThan(0);
    for (const c of never) expect(isAir(on.volume.stateAt(c.pos)), `${c.kind} ${c.pos.join(',')} entfernt`).toBe(false);
    expect(missingShellCells(on, h.shell).filter((c) => c.kind === 'door' || c.kind === 'window' || c.kind === 'floor')).toEqual([]);
  });

  it('(e) mehrere Seeds und Dachformen (flat/gable/hip/mansard): 0 harte Meldungen', () => {
    for (const roof of ['flat', 'gable', 'hip', 'mansard'] as const) {
      for (const seed of [1, 7, 2026, 987654]) {
        const h = house(roof, seed);
        const on = run(h, 'ruin', undefined, seed);
        const off = run(h, 'ruin', { ruin: false }, seed);
        const removed = cellCount(off) - cellCount(on);
        // eslint-disable-next-line no-console
        console.log(`[ruin] ${roof} seed ${seed}: ${removed} entfernt (${((removed / cellCount(off)) * 100).toFixed(2)} %)`);
        expect(errorViolations(on), `${roof}/${seed}`).toEqual([]);
        expect(removed, `${roof}/${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it('(e2) eingerichteter Raum: Erosion umgeht Träger von Komponenten (0 harte Meldungen)', () => {
    const h: House = { shell: roomShell(), roomTypes: { r1: 'bedroom' } };
    const on = run(h, 'ruin', undefined, 2026, furnished());
    const off = run(h, 'ruin', { ruin: false }, 2026, furnished());
    // eslint-disable-next-line no-console
    console.log(`[ruin] eingerichtet: ${cellCount(off) - cellCount(on)} entfernt`);
    expect(cellCount(off) - cellCount(on)).toBeGreaterThan(0);
    expect(errorViolations(on)).toEqual([]);
  });
});

describe('Ruine: Entfernungsregel (rein)', () => {
  /** Synthetische Hülle: drei Wandspalten, Tür/Fenster/Boden als Sperrzellen; Kontext kommt aus `shellContext`. */
  function synthetic(): Shell {
    const cells: ShellCell[] = [];
    const wall = (x: number, y: number, kind: ShellCell['kind'] = 'wall', role = 'wall_primary'): void => {
      cells.push({ pos: [x, y, 0], kind, role, shape: kind === 'window' ? 'pane' : 'block', exterior: true });
    };
    cells.push({ pos: [0, 0, 0], kind: 'floor', role: 'floor_primary', shape: 'block', roomId: 'r' });
    for (let y = 1; y <= 4; y++) wall(0, y);
    for (let y = 1; y <= 5; y++) wall(1, y);
    cells.push({ pos: [2, 1, 0], kind: 'door', role: 'door', shape: 'door', exterior: true, orient: { facing: 'south', half: 'lower' } });
    cells.push({ pos: [2, 2, 0], kind: 'door', role: 'door', shape: 'door', exterior: true, orient: { facing: 'south', half: 'upper' } });
    wall(2, 3, 'window', 'window');
    wall(2, 4);
    return { cells, rooms: new Map(), warnings: [] };
  }

  const ALL_ROLES = new Set(['wall_primary', 'window', 'door', 'floor_primary']);

  it('Cap von oben, Sperrzellen stoppen, nie Tür/Fenster/Boden', () => {
    const shell = synthetic();
    // Spalte 0: y=3 gesperrt (Komponententräger) → nur y=4 fällt. Spalte 2: Fenster y=3 stoppt nach y=4.
    const removed = planRuin({
      shell, contexts: shellContext(shell), roles: shell.cells.map((c) => c.role), seed: 42,
      protected: new Set([key3([0, 3, 0])]),
      settings: { roles: ALL_ROLES, chance: 1, maxDrop: 4, minRoofT: 0 },
    });
    const at = (x: number, y: number): boolean => removed.some((r) => r.pos[0] === x && r.pos[1] === y && r.pos[2] === 0);
    // Spalte 0: Cap endet an der Sperrzelle y=3 → genau y=4
    expect(at(0, 4)).toBe(true);
    for (const y of [1, 2, 3]) expect(at(0, y), `0/${y}`).toBe(false);
    // Spalte 2: y=4 fällt, das Fenster y=3 nicht
    expect(at(2, 4)).toBe(true);
    for (const y of [1, 2, 3]) expect(at(2, y), `2/${y}`).toBe(false);
    // Spalte 1: zusammenhängender Cap von y=5 abwärts, keine Lücke darunter
    const ys = removed.filter((r) => r.pos[0] === 1).map((r) => r.pos[1]).sort((a, b) => b - a);
    expect(ys.length).toBeGreaterThan(0);
    expect(ys[0]).toBe(5);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBe(ys[i - 1]! - 1);
    // Tür/Fenster/Boden sind nie dabei
    for (const r of removed) expect(['door', 'window', 'floor']).not.toContain(r.kind);
  });

  it('chance 0 = nichts, maxDrop 1 = höchstens eine Zelle je Spalte', () => {
    const shell = synthetic();
    const contexts = shellContext(shell);
    const roles = shell.cells.map((c) => c.role);
    const base = { roles: new Set(['wall_primary']), chance: 1, maxDrop: 1, minRoofT: 0 };
    expect(planRuin({ shell, contexts, roles, seed: 1, protected: new Set(), settings: { ...base, chance: 0 } })).toEqual([]);
    const removed = planRuin({ shell, contexts, roles, seed: 1, protected: new Set(), settings: base });
    const perColumn = new Map<number, number>();
    for (const r of removed) {
      expect(r.kind).toBe('wall');
      perColumn.set(r.pos[0], (perColumn.get(r.pos[0]) ?? 0) + 1);
    }
    for (const n of perColumn.values()) expect(n).toBeLessThanOrEqual(1);
  });
});
