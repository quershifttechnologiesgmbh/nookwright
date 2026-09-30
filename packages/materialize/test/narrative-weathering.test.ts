/**
 * WS-Verwitterung: erzählende Verwitterung (Schalter `narrativeWeathering`).
 *
 * Vertrag: Ohne die Option bleibt jedes Ergebnis bitgleich; mit ihr werden nur Blöcke getauscht (Geometrie, Rollen und
 * Belegung bleiben), deterministisch aus dem Seed, und `some` verändert weniger als `rich`. Das Kachelmodell (WFC)
 * lässt Cluster nie an neutrale Zellen grenzen – es muss einen Übergang geben.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type RoofStyle, type Shell } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { CAUSE_KINDS, RULE_BELOW_CELLS, TONE_MODEL, ToneIndex, WEATHERING_MODEL, materialize, solveRaster, solveTone, type Cause, type MaterializeOptions, type MaterializeResult } from '../src/index.js';
import { platformView, themes } from './fixtures.js';

const VERSION = '26.3';
const L_ROOM = CellSet.rect(0, 0, 9, 4).union(CellSet.rect(0, 5, 4, 9));

function house(roof: RoofStyle): { shell: Shell; roomTypes: Record<string, string> } {
  const p = Project.create({ id: 'w', name: 'W', seed: 5, themeId: 'medieval', targetVersion: PROJECT_VERSIONS[VERSION], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, L_ROOM, 'bedroom');
  const shell = deriveShell(p.state, { roof, overhang: 1 });
  return { shell, roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

function run(roof: RoofStyle, themeId: string, options?: MaterializeOptions, seed = 2026): MaterializeResult {
  const h = house(roof);
  return materialize({
    shell: h.shell, placements: [], theme: themes.get(themeId), platform: platformView(VERSION), seed, roomTypes: h.roomTypes,
    ...(options !== undefined ? { options } : {}),
  });
}

const blocks = (r: MaterializeResult): Map<string, string> => new Map([...r.volume.cells()].map((c) => [c.pos.join(','), `${c.state.name}${JSON.stringify(c.state.properties)}`]));
const diff = (a: MaterializeResult, b: MaterializeResult): number => {
  const ma = blocks(a);
  let n = 0;
  for (const [k, v] of blocks(b)) if (ma.get(k) !== v) n++;
  return n;
};

describe('Kachelmodell der Verwitterung', () => {
  it('Cluster grenzt nie an neutral (Übergang nötig), alle vier Richtungen gleich', () => {
    const [N, T, C] = [0, 1, 2];
    for (const dir of WEATHERING_MODEL.compat) {
      expect(dir[C]).not.toContain(N);
      expect(dir[N]).not.toContain(C);
      expect(dir[C]).toContain(T);
      expect(dir[N]).toContain(T);
    }
    // Spiegel-Symmetrie der Regeln: A darf neben B genau dann, wenn B neben A darf
    for (const dir of WEATHERING_MODEL.compat) for (let a = 0; a < 3; a++) for (const b of dir[a]!) expect(dir[b]).toContain(a);
  });
});

describe('erzählende Verwitterung', () => {
  it('ohne Option: kein Ergebnisfeld, bitgleich zu einem zweiten Lauf', () => {
    const a = run('gable', 'medieval');
    const b = run('gable', 'medieval');
    expect(a.narrativeWeathering).toBeUndefined();
    expect(diff(a, b)).toBe(0);
  });

  it('mit Option: tauscht Blöcke, Belegung und Größe bleiben, keine harte Meldung', () => {
    const base = run('gable', 'medieval');
    const w = run('gable', 'medieval', { narrativeWeathering: 'rich' });
    expect(w.narrativeWeathering).toBeDefined();
    expect(w.narrativeWeathering!.rastersFailed).toBe(0);
    expect(w.narrativeWeathering!.changed).toBeGreaterThan(0);
    expect(w.volume.size).toEqual(base.volume.size);
    expect(w.volume.origin).toEqual(base.volume.origin);
    const air = (r: MaterializeResult) => [...r.volume.cells()].map((c) => c.pos.join(',')).sort();
    expect(air(w)).toEqual(air(base));
    expect(w.violations.filter((v) => v.severity === 'error')).toEqual(base.violations.filter((v) => v.severity === 'error'));
    expect(diff(base, w)).toBeGreaterThan(0);
  });

  it('deterministisch aus dem Seed; anderer Seed = anderes Bild', () => {
    const a = run('gable', 'medieval', { narrativeWeathering: 'rich' }, 7);
    const b = run('gable', 'medieval', { narrativeWeathering: 'rich' }, 7);
    const c = run('gable', 'medieval', { narrativeWeathering: 'rich' }, 8);
    expect(diff(a, b)).toBe(0);
    expect(diff(a, c)).toBeGreaterThan(0);
  });

  it('wenig ändert nicht mehr als stark; Erzählstärke folgt dem Story-Profil (verlassen > gepflegt)', () => {
    const some = run('gable', 'medieval', { narrativeWeathering: 'some' }).narrativeWeathering!;
    const rich = run('gable', 'medieval', { narrativeWeathering: 'rich' }).narrativeWeathering!;
    expect(some.changed).toBeLessThanOrEqual(rich.changed);
    const aged = run('gable', 'medieval', { narrativeWeathering: 'some', storyState: 'verlassen' }).narrativeWeathering!;
    expect(aged.strength).toBeGreaterThanOrEqual(some.strength);
  });

  it('Kennzahlen sind in sich stimmig', () => {
    const s = run('hip', 'nordic', { narrativeWeathering: 'rich' }).narrativeWeathering!;
    expect(s.changedCluster).toBe(Object.values(s.byType).reduce((a, b) => a + b, 0));
    expect(s.changedCluster + s.changedTransition).toBe(s.changed);
    expect(s.plinthChanged + s.roofChanged).toBeLessThanOrEqual(s.changed);
  });
});

describe('Verwitterung v2: Ursache und Material', () => {
  it('jeder geänderte Block hat genau eine Ursache (Summe byCause = changed = Summe byMaterial)', () => {
    for (const theme of ['medieval', 'nordic']) {
      for (const roof of ['gable', 'hip'] as const) {
        const s = run(roof, theme, { narrativeWeathering: 'rich' }).narrativeWeathering!;
        const byCause = CAUSE_KINDS.reduce((a, c) => a + s.byCause[c].blocks, 0);
        expect(byCause).toBe(s.changed);
        expect(Object.values(s.byMaterial).reduce((a, b) => a + b, 0)).toBe(s.changed);
        // jede Ursache mit Blöcken hat mindestens einen Keim (Cluster)
        for (const c of CAUSE_KINDS) if (s.byCause[c].blocks > 0) expect(s.byCause[c].clusters).toBeGreaterThan(0);
      }
    }
  });

  it('Putz bekommt nie Moos oder Bruchstein', () => {
    for (const theme of ['medieval', 'nordic']) {
      const s = run('gable', theme, { narrativeWeathering: 'rich' }).narrativeWeathering!;
      expect(s.byMaterial.plaster === 0 || s.byType.moss >= 0).toBe(true);
    }
    const base = run('gable', 'medieval');
    const w = run('gable', 'medieval', { narrativeWeathering: 'rich' });
    const before = blocks(base);
    for (const [k, v] of blocks(w)) {
      const old = before.get(k);
      if (old === undefined || old === v) continue;
      if (/^(minecraft:)?(polished_)?diorite|smooth_stone|mushroom_stem|white_concrete/.test(old)) expect(v).not.toMatch(/mossy|cobblestone/);
    }
  });

  it('dunkle Schwester ist nie heller als die Basis und bleibt in der Farbrichtung', () => {
    const view = platformView(VERSION);
    const tones = new ToneIndex(view.families, (n) => view.registry.hasBlock(n));
    let checked = 0;
    for (const [id, f] of Object.entries(view.families.families)) {
      if (!['stone', 'wood', 'terracotta'].includes(f.kind)) continue;
      for (const shape of ['block', 'planks', 'stairs', 'slab']) {
        const d = tones.darker(id, shape);
        if (d === undefined) continue;
        const dl = tones.lookup(d);
        expect(dl).toBeDefined();
        const a = tones.lumOf(id)!;
        const b = tones.lumOf(dl!.family)!;
        expect(b).toBeLessThan(a);
        expect(b).toBeGreaterThanOrEqual(a * 0.45);
        expect(f.kind).toBe(view.families.families[dl!.family]!.kind);
        checked++;
      }
      const l = tones.lighter(id, 'block');
      const lf = l !== undefined ? tones.lookup(l) : undefined;
      if (lf !== undefined) expect(tones.lumOf(lf.family)!).toBeGreaterThan(tones.lumOf(id)!);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('kleine Raster (< 60 Zellen) nutzen den Regelverlauf, große den WFC; Cluster grenzt nie an neutral', () => {
    const mk = (w: number, h: number): { active: Uint8Array; causes: Cause[] } => ({
      active: new Uint8Array(w * h).fill(1),
      causes: [{ cell: 1 * w + 2, kind: 'rain', grow: [2 * w + 2, 3 * w + 2, 1 * w + 3] }],
    });
    const small = mk(6, 8);
    expect(6 * 8).toBeLessThan(RULE_BELOW_CELLS);
    const rs = solveRaster(6, 8, small.active, small.causes, 7, 1, 'auto');
    expect(rs.rule).toBe(true);
    const big = mk(12, 10);
    const rb = solveRaster(12, 10, big.active, big.causes, 7, 1, 'auto');
    expect(rb.rule).toBe(false);
    expect(rb.ok).toBe(true);
    for (const [r, w, h] of [[rs, 6, 8], [rb, 12, 10]] as const) {
      expect(r.cls[1 * w + 2]).toBe(2);
      for (let i = 0; i < w * h; i++) {
        if (r.cls[i] !== 2) continue;
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          if (j < 0 || j >= w * h || (Math.abs(j - i) === 1 && Math.floor(j / w) !== Math.floor(i / w))) continue;
          expect(r.cls[j]).not.toBe(0);
        }
      }
    }
  });

  it('`some` ändert weniger als `rich`, aus bleibt bitgleich', () => {
    const base = run('hip', 'medieval');
    const some = run('hip', 'medieval', { narrativeWeathering: 'some' });
    const rich = run('hip', 'medieval', { narrativeWeathering: 'rich' });
    expect(diff(base, some)).toBeLessThan(diff(base, rich));
    expect(diff(base, run('hip', 'medieval', {}))).toBe(0);
  });
});

describe('Verwitterung v2: Tonzonen (LV „Texture like a pro“)', () => {
  it('Tonmodell: senkrecht nur Verlauf (|Δ| ≤ 1), waagerecht frei', () => {
    const [h1, h2, v1, v2] = TONE_MODEL.compat;
    for (const dir of [v1!, v2!]) { expect(dir[2]).not.toContain(0); expect(dir[0]).not.toContain(2); }
    for (const dir of [h1!, h2!]) expect(dir[2]).toContain(0);
  });

  it('Solver schwächt Zonen nur ab, hebt nie an; Stufe 2 bleibt mindestens 1; senkrecht Verlauf; deterministisch', () => {
    const w = 14, h = 9;
    const active = new Uint8Array(w * h).fill(1);
    active[3 * w + 5] = 0;
    const target = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) { target[x] = 2; target[w + x] = 1; target[(h - 1) * w + x] = 2; } // Sockel unten, Traufe oben
    for (let y = 2; y < 6; y++) target[y * w + 7] = y === 5 ? 2 : 1; // Tropfkette
    const a = solveTone(w, h, active, target, 11, 0.8);
    const b = solveTone(w, h, active, target, 11, 0.8);
    expect(a.ok).toBe(true);
    expect([...a.tone]).toEqual([...b.tone]);
    let kept = 0;
    for (let i = 0; i < w * h; i++) {
      if (active[i] === 0) { expect(a.tone[i]).toBe(0); continue; }
      expect(a.tone[i]!).toBeLessThanOrEqual(target[i]!);
      if (target[i] === 2) expect(a.tone[i]!).toBeGreaterThanOrEqual(1);
      if (target[i]! > 0 && a.tone[i] === target[i]) kept++;
      const up = i + w;
      if (up < w * h && active[up] === 1) expect(Math.abs(a.tone[i]! - a.tone[up]!)).toBeLessThanOrEqual(1);
    }
    expect(kept).toBeGreaterThan(0);
    const none = solveTone(w, h, active, new Uint8Array(w * h), 3, 0.8);
    expect(none.tone.every((t) => t === 0)).toBe(true);
  });

  it('Zonen greifen: Sockel und Deckung oben dunkeln; keine Fremdtexturen (Tuff, Basalt, Schwarzstein, Tiefenschiefer)', () => {
    for (const theme of ['medieval', 'nordic']) {
      const base = run('gable', theme);
      const w = run('gable', theme, { narrativeWeathering: 'rich' });
      const s = w.narrativeWeathering!;
      expect(s.toneRasters).toBeGreaterThan(0);
      expect(s.toneFailed).toBe(0);
      expect(s.byCause.plinth.blocks).toBeGreaterThan(0);
      const before = blocks(base);
      for (const [k, v] of blocks(w)) {
        const old = before.get(k);
        if (old === undefined || old === v) continue;
        expect(v).not.toMatch(/tuff|basalt|blackstone|minecraft:deepslate\{/);
      }
    }
  });
});
