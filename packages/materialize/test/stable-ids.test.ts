/**
 * K8 in der Materialisierung (research/30): Mit stabilen Zell-`id`s hängen Muster/Verläufe an der Zelle und
 * werden **hausrelativ** ausgewertet – ein verschobenes Haus liefert an denselben (relativen) Zellen dieselben
 * Blöcke. Ohne IDs (Default) bleibt alles bitgleich.
 */
import { Project, TARGET_VERSIONS, assignCellIds, deriveShell, type Shell } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { ThemeResolver, materialize } from '../src/index.js';
import { platformView, themes } from './fixtures.js';

/** Haus mit zwei Räumen, um `dx`/`dz` verschoben (vollständig abgeleitet, IDs inklusive). */
function house(dx = 0, dz = 0, ids = true): Shell {
  const p = Project.create({ id: 's', name: 'S', seed: 4, themeId: 'timber', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0 + dx, 0 + dz, 8 + dx, 6 + dz), 'kitchen');
  p.paintRoom(0, CellSet.rect(9 + dx, 0 + dz, 14 + dx, 6 + dz), 'bedroom');
  const shell = deriveShell(p.state, { roof: 'gable' });
  return ids ? assignCellIds(shell) : shell;
}

const bau = (shell: Shell): Map<string, string> => {
  const r = materialize({ shell, placements: [], theme: themes.get('timber')!, platform: platformView('1.21.11'), seed: 4 });
  return new Map([...r.volume.cells()].map((c) => [c.pos.join(','), `${c.state.name}${JSON.stringify(c.state.properties)}`]));
};

/** Gleiche Blöcke an denselben relativen Zellen? → Anzahl übereinstimmender Zellen und Gesamtzahl. */
const vergleich = (a: Map<string, string>, b: Map<string, string>, dx: number, dz: number): [number, number] => {
  let gleich = 0;
  let geprueft = 0;
  for (const [pos, state] of a) {
    const [x, y, z] = pos.split(',').map(Number) as [number, number, number];
    const dort = b.get([x + dx, y, z + dz].join(','));
    if (dort === undefined) continue;
    geprueft++;
    if (dort === state) gleich++;
  }
  return [gleich, geprueft];
};

describe('K8: stabile IDs in der Materialisierung', () => {
  it('ohne IDs bleibt der Bau bitgleich (zwei unabhängige Läufe)', () => {
    const shell = house(0, 0, false);
    expect(shell.cells.every((c) => c.id === undefined)).toBe(true);
    expect([...bau(house(0, 0, false)).entries()].sort()).toEqual([...bau(shell).entries()].sort());
  });

  it('verschobenes Haus mit stabilen IDs liefert an jeder gemeinsamen Zelle denselben Block', () => {
    const [gleich, geprueft] = vergleich(bau(house(0, 0)), bau(house(3, 0)), 3, 0);
    expect(geprueft).toBeGreaterThan(400);
    // Gemessen: 512 von 516 Zellen identisch (die übrigen sind Randfälle der Autotiling-/Türzellen)
    expect(gleich / geprueft).toBeGreaterThan(0.98);
  });

  it('auch beim Verschieben in z – bis auf die Zellen, deren Hüllenform sich ändert', () => {
    // Gemessen (blueprint/test/stable-ids): +5 in z legt die Haustür auf eine andere Wand → 6 Zellen entfallen.
    const [gleich, geprueft] = vergleich(bau(house(0, 0)), bau(house(0, 5)), 0, 5);
    expect(geprueft).toBeGreaterThan(500);
    // Gemessen: 498 von 516 (die 6 Zellen der verschobenen Haustür plus deren Nachbarzellen)
    expect(gleich / geprueft).toBeGreaterThan(0.95);
  });

  it('K8-Reparatur (W2, P0-B S1): mit IDs dieselben Flecken wie ohne – das Rauschfeld hängt an der Fläche, nicht an der Zelle', () => {
    // Vorher säte K8 das Rauschfeld je Zell-ID: Nachbarn teilten keine Flecken mehr (P0-B: Boden innen 48 → 80 %
    // Materialwechsel, Dach 42 → 62 %). Jetzt ist die Ebene die Saat, hausrelativ ausgewertet.
    const sprenkel = (shell: Shell, theme: string, kinds: ReadonlySet<string>): number => {
      const r = materialize({ shell, placements: [], theme: themes.get(theme)!, platform: platformView('1.21.11'), seed: 4 });
      const kind = new Map(shell.cells.map((c) => [c.pos.join(','), c.kind] as const));
      const name = new Map([...r.volume.cells()].filter((c) => kinds.has(kind.get(c.pos.join(',')) ?? '')).map((c) => [c.pos.join(','), c.state.name] as const));
      let paare = 0;
      let wechsel = 0;
      for (const [k, a] of name) {
        const [x, y, z] = k.split(',').map(Number) as [number, number, number];
        for (const n of [`${x + 1},${y},${z}`, `${x},${y},${z + 1}`]) {
          const b = name.get(n);
          if (b === undefined) continue;
          paare++;
          if (a !== b) wechsel++;
        }
      }
      return wechsel / paare;
    };
    // Gemessen an diesem Haus (Bericht W2FC §1): Saat je Zelle 72 / 70 / 62 % (Boden / Dach / Wand medieval),
    // Saat je Ebene 56 / 40 / 42 %, ohne IDs 53 / 33 / 28 %. Die Grenzen liegen zwischen „je Ebene“ und „je Zelle“.
    const grenzen = [['floor', 0.62], ['roof', 0.5], ['wall', 0.5]] as const;
    for (const [kind, max] of grenzen) {
      const mit = sprenkel(house(0, 0, true), 'medieval', new Set([kind]));
      expect(mit, `${kind}: ${mit.toFixed(3)}`).toBeLessThan(max);
    }
  });

  it('K8-Reparatur: die Zell-ID sät das Rauschfeld nicht – gleiche Ebene und Koordinaten ergeben denselben Block', () => {
    const p = platformView('1.21.11');
    const resolver = new ThemeResolver(themes.get('medieval')!, p.families, p.registry);
    for (const role of ['floor_primary', 'ceiling', 'wall_primary']) {
      for (let a = 0; a < 24; a++) {
        const at = { seed: 4, plane: 77, a, b: 3 };
        const pick = { mixSeed: 1, at, t: { wall_h: 0.3 } };
        const ohne = resolver.resolve(role, 'block', pick).block;
        const mit = resolver.resolve(role, 'block', { ...pick, at: { ...at, id: 1000 + a } }).block;
        expect(mit, `${role} bei a=${a}`).toBe(ohne);
      }
    }
  });

  it('Gegenprobe: ohne IDs wandert die Textur beim Verschieben', () => {
    const [gleich, geprueft] = vergleich(bau(house(0, 0, false)), bau(house(3, 0, false)), 3, 0);
    // Gemessen: nur 337 von 516 Zellen behalten ohne IDs ihren Block (mit IDs: 512) – die Textur wandert
    // W2 (26.09.2026): Regeln W4/D1 – ruhigere Wände und Dächer aus weniger Blockarten (Dach in ganzen Ringen),
    // deshalb gleicht ein verschobenes Muster öfter zufällig; die Grenze liegt weiter klar unter „mit IDs“ (> 0,98).
    expect(geprueft).toBeGreaterThan(400);
    // W4 (27.09.2026, Review M4/M6): Holzwände in ganzen Reihen und Dielen je Brett – gemessen 0,93; Grenze 0,95
    expect(gleich / geprueft).toBeLessThan(0.95);
    expect(gleich / geprueft).toBeGreaterThan(0.5);
  });
});
