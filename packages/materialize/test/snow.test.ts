/**
 * Schneeauflage (additiv, research/24 §7.4): deterministischer Pass, der auf die oberste Zelle einer
 * Hüllspalte (Dach, Flachdach, Mauerkrone) Schnee legt.
 *
 * Vertrag (contract-first): **Ohne `decor.snowCover` im Theme ändert sich nichts** – Prüfsumme, Größe und
 * Ursprung des Volumens sind bitgleich zum Stand vor dem Pass (unten fest verdrahtet). Deshalb bleiben
 * `medieval` (kein Feld) und `nordic` (Basis von `winter`, kein Feld) unberührt, auch wenn die Option
 * `snowCover` gesetzt wird.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type RoofStyle, type Shell } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { materialize, snowCoverSettings, type MaterializeOptions, type MaterializeResult } from '../src/index.js';
import { platformView, themes } from './fixtures.js';

const VERSION = '26.3';
/** L-förmiger Raum: 10 × 5 oben, 5 × 5 darunter (dieselbe Vorlage wie variance.test.ts). */
const L_ROOM = CellSet.rect(0, 0, 9, 4).union(CellSet.rect(0, 5, 4, 9));

interface House {
  readonly shell: Shell;
  readonly roomTypes: Record<string, string>;
}

function house(roof: RoofStyle): House {
  const p = Project.create({ id: 's', name: 'S', seed: 5, themeId: 'medieval', targetVersion: PROJECT_VERSIONS[VERSION], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, L_ROOM, 'bedroom');
  const shell = deriveShell(p.state, { roof, overhang: 1 });
  return { shell, roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

function run(h: House, themeId: string, options?: MaterializeOptions): MaterializeResult {
  return materialize({
    shell: h.shell, placements: [], theme: themes.get(themeId), platform: platformView(VERSION), seed: 2026, roomTypes: h.roomTypes,
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

const snowCells = (r: MaterializeResult) => [...r.volume.cells()].filter((c) => c.state.name === 'snow' || c.state.name === 'snow_block');
const errorViolations = (r: MaterializeResult) => r.violations.filter((v) => v.severity === 'error');

/** Spalten (x,z) von Tür- und Fensterzellen. */
function openingColumns(h: House): Set<string> {
  return new Set(h.shell.cells.filter((c) => c.kind === 'door' || c.kind === 'window').map((c) => `${c.pos[0]},${c.pos[2]}`));
}

/** Vor dem Pass gemessen (Stand „vor der Änderung“): Größe, Ursprung und Prüfsumme des Kontrollthemes. */
// W2 (26.09.2026): Regeln W4/W5/W6/D1 – medieval und nordic neu (Materialbudget, Fassadenverlauf, Deckungsrezept); vorher 'fbe9bf83' / '9287ad1c'
// W4 (27.09.2026): W4-E Dachraum-Licht (Laterne auf dem Dachboden des Walmdachs) + W4-G Dielen je Brett (M6),
// Holzwand-Fuß als Reihe (M4), nordisches Dach (D9) – medieval und nordic neu; vorher '74285061' / 'd5e23b4b'
// (W4-E allein 'efa6dee0' / '6ae819b2', W4-G allein '3ea4e5a9' / '1fd9c718')
// W9-G5 (2026-09-27): medieval neu – Wandverlauf mit Bruch-Tiefenschiefer am Fuß, Dach in drei Ringtönen mit Flecken (Review R5 G5); vorher '9c1a5b98'
// W12-D (2026-09-28): Grund – nordic wird Blockbau (Steinsockel, Schwelle, liegende Stämme, Giebelbretter in drei Tönen,
// Schieferdach mit geteertem Traufdrittel, Bruchstein-Schlot; Review R6-6); vorher '8151dceb'
const CONTROL = { size: [12, 8, 12], origin: [-1, 0, -1], medieval: '656d3667', nordic: '9466deb1' } as const;

describe('Schneeauflage: winter bekommt Schnee, andere Themes bleiben bitgleich', () => {
  it('winter (Walmdach): Schneezellen > 0 und keine harte Meldung', () => {
    const r = run(house('hip'), 'winter');
    const snow = snowCells(r);
    expect(snow.length).toBeGreaterThan(0);
    expect(errorViolations(r)).toEqual([]);
    // Das Volumen wurde um die Auflage nach oben erweitert (Ursprung bleibt).
    expect(r.volume.size[1]).toBe(CONTROL.size[1] + 1);
    expect(r.volume.origin).toEqual(CONTROL.origin);
    // Aufs Dach: jede Auflage sitzt genau eine Zelle über einer Hüllzelle, nichts schwebt sonst wo.
    const shellPos = new Set(house('hip').shell.cells.map((c) => `${c.pos[0]},${c.pos[1]},${c.pos[2]}`));
    for (const c of snow) expect(shellPos.has(`${c.pos[0]},${c.pos[1] - 1},${c.pos[2]}`), `${c.pos.join(',')}`).toBe(true);
    // Die gemessene Palette führt den Schnee (nach Merge/Autotiling).
    expect(r.palette.some((p) => p.block === 'snow_block' || p.block === 'snow')).toBe(true);
  });

  it('steiles Satteldach: ebenfalls Schnee ohne harte Meldung', () => {
    const r = run(house('gable'), 'winter');
    expect(snowCells(r).length).toBeGreaterThan(0);
    expect(errorViolations(r)).toEqual([]);
  });

  it('Flachdach: dünne minecraft:snow-Schicht mit `layers`; Treppendach: voller snow_block', () => {
    const flat = run(house('flat'), 'winter');
    const layers = [...flat.volume.cells()].filter((c) => c.state.name === 'snow');
    expect(layers.length).toBeGreaterThan(0);
    expect(new Set(layers.map((c) => c.state.properties['layers']))).toEqual(new Set(['1']));
    expect(errorViolations(flat)).toEqual([]);
    // Untere Treppenstufen tragen keine Schicht (SnowLayerBlock#canSurvive) → dort Vollblock, keine Schicht.
    const hip = run(house('hip'), 'winter');
    const hipCells = [...hip.volume.cells()];
    expect(hipCells.filter((c) => c.state.name === 'snow_block').length).toBeGreaterThan(0);
    expect(hipCells.filter((c) => c.state.name === 'snow')).toHaveLength(0);
  });

  it('Kontrolltheme ohne Feld (medieval, nordic): 0 Schnee, Volumen bitgleich zum Stand vor dem Pass', () => {
    const h = house('hip');
    for (const themeId of ['medieval', 'nordic'] as const) {
      // W13-B (2026-09-28): nordic legt ein Torfdach an (eigener Pass, `turf.ts`); hier geht es nur um den Schnee –
      // ohne Torf bleibt die Kontrollsumme der Stand vor dem Schnee-Pass (bitgleich)
      const r = run(h, themeId, themeId === 'nordic' ? { turfRoof: false } : undefined);
      expect(snowCells(r), themeId).toHaveLength(0);
      expect(r.volume.size).toEqual(CONTROL.size);
      expect(r.volume.origin).toEqual(CONTROL.origin);
      expect(checksum(r), themeId).toBe(CONTROL[themeId]);
    }
    // Die Option allein schaltet den Pass NICHT an – es braucht das Theme-Feld.
    const forced = run(h, 'medieval', { snowCover: { roles: ['roof_main'], chance: 1 } });
    expect(snowCells(forced)).toHaveLength(0);
    expect(checksum(forced)).toBe(CONTROL.medieval);
    expect(snowCoverSettings(themes.get('medieval'))).toBeUndefined();
    expect(snowCoverSettings(themes.get('winter'), false)).toBeUndefined();
    expect(snowCoverSettings(themes.get('winter'))?.roles.has('roof_main')).toBe(true);
  });

  it('deterministisch: zwei Läufe sind bitgleich', () => {
    const a = run(house('hip'), 'winter');
    const b = run(house('hip'), 'winter');
    expect(checksum(a)).toBe(checksum(b));
    expect(snowCells(a).map((c) => `${c.pos.join(',')}${c.state.name}`)).toEqual(snowCells(b).map((c) => `${c.pos.join(',')}${c.state.name}`));
  });

  it('kein Schnee über oder neben Tür/Fenster', () => {
    const h = house('hip');
    const openings = openingColumns(h);
    const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
    for (const c of snowCells(run(h, 'winter'))) {
      for (const [dx, dz] of near) {
        expect(openings.has(`${c.pos[0] + dx},${c.pos[2] + dz}`), `${c.pos.join(',')} neben Öffnung`).toBe(false);
      }
    }
  });

  it('chance: 1 = jede geeignete Zelle, kleinerer Wert lässt Zellen aus (deterministisch)', () => {
    const all = run(house('hip'), 'winter', { snowCover: { chance: 1 } });
    const half = run(house('hip'), 'winter', { snowCover: { chance: 0.5 } });
    const half2 = run(house('hip'), 'winter', { snowCover: { chance: 0.5 } });
    expect(snowCells(all).length).toBeGreaterThan(snowCells(half).length);
    expect(snowCells(half).length).toBeGreaterThan(0);
    expect(checksum(half)).toBe(checksum(half2));
  });
});
