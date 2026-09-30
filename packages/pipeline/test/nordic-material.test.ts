/**
 * W12-D „Nordische Themes“ (plan/spikes/W12D_nordisch.md, Review R6-6 „Wand = Dach = Rahmen, einfarbiges Holz“) über
 * den Anwendungsdienst (Weg der Galerie), dieselben Kennzahlen wie W9-G5 (`spikes/w9/g5/variety.mts`):
 *  - Blockbau: Steinsockel, Schwellbalken, liegende entrindete Stämme; Rahmen-/Eckholz ≠ Wandholz, Fensterrahmen dunkel;
 *  - Fassade: Anteil der häufigsten Blockfamilie ≤ 60 %, ≥ 3 Familien (≥ 3 %) im unteren und mittleren Höhenband;
 *  - Dach: ≥ 2 Varianten, zweite ≥ 15 %, je Dachreihe ein Material (D1 < 10 %);
 *  - Wert-Kontrast Wand ↔ Dach (P1) ≥ medieval; winter erbt die Wand, die Küste bleibt bei der Bohlenwand;
 *  - gekreuzte Windbretter an beiden Firstenden, spiegelgleich (W13-B: auch auf einreihigem First);
 *  - W13-B Torfdach (Seed 2026: Torf, Seed 7: Holz); harte Regeln 0; deterministisch.
 */
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { P1 } from '../src/quality-p1.js';
import { ctx, loadType } from './buildingtype-fuzz.js';

const V = TARGET_VERSIONS['1.21.11'];
const build = (type: string, themeId: string, seed = 2026, size: 'S' | 'M' | 'L' = 'M') => {
  const res = projectFromBuildingType(loadType(type), { size, themeId, targetVersion: V }, seed, ctx);
  return generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
};
type World = ReturnType<typeof build>;
const nameAt = (w: World, p: readonly [number, number, number]): string =>
  w.materialized.volume.isEmpty(p) ? 'air' : w.materialized.volume.stateAt(p).name.replace(/^minecraft:/, '');
const family = (n: string): string => n.replace(/_(stairs|slab|wall)$/, '').replace(/_planks$/, '').replace(/(brick|tile)s$/, '$1');
const count = <T>(xs: readonly T[]): Map<T, number> => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>());
const SKIP = /(air|glass|pane|door|bars|lantern|chain|torch|ladder|trapdoor|fence|carpet|vine|leaves|banner|button|sign)/;
const WALL_KINDS = new Set(['wall', 'pillar', 'lintel']);

/** Außenwandzellen des Hauses in drei Höhenbändern (Wandfuß → oberste Wandzelle), Familien je Band. */
function facadeBands(w: World): string[][] {
  const cells = w.shell.cells.filter((c) => c.kind !== 'fort' && WALL_KINDS.has(c.kind) && c.exterior === true);
  const y0 = Math.min(...cells.map((c) => c.pos[1]));
  const y1 = Math.max(...cells.map((c) => c.pos[1]));
  const bands: string[][] = [[], [], []];
  for (const c of cells) {
    const n = nameAt(w, c.pos);
    if (SKIP.test(n)) continue;
    bands[Math.min(2, Math.floor(((c.pos[1] - y0) / (y1 - y0 + 1)) * 3))]!.push(family(n));
  }
  return bands;
}

function roofRows(w: World): { fams: [string, number][]; total: number; rowMix: number } {
  // W13-B: Firstplatten, die das Torfdach zu Soden macht, zählen nicht zur Deckung
  const roof = w.shell.cells.filter((c) => c.kind === 'roof' && c.role === 'roof_main').map((c) => ({ y: c.pos[1], f: family(nameAt(w, c.pos)) }))
    .filter((r) => r.f !== 'grass_block' && r.f !== 'moss_block');
  const fams = [...count(roof.map((r) => r.f))].sort((a, b) => b[1] - a[1]);
  const rows = new Map<number, string[]>();
  for (const r of roof) rows.set(r.y, [...(rows.get(r.y) ?? []), r.f]);
  let off = 0;
  for (const fs of rows.values()) off += fs.length - Math.max(...count(fs).values());
  return { fams, total: roof.length, rowMix: off / roof.length };
}

describe('W12-D: nordischer Blockbau – Kennzahlen wie W9-G5', () => {
  for (const type of ['house', 'longhouse', 'hall', 'twostory'] as const) {
    it(`${type}/nordic: Fassade ≤ 60 % eine Familie, ≥ 3 Familien unten und in der Mitte, Dach zweitonig nach D1`, { timeout: HEAVY_TIMEOUT }, () => {
      const w = build(type, 'nordic');
      expect(w.materialized.violations.filter((v) => v.severity === 'error')).toEqual([]);
      const bands = facadeBands(w);
      for (const [i, band] of bands.slice(0, 2).entries()) {
        const kinds = [...count(band)].filter(([, v]) => v / band.length >= 0.03);
        expect(kinds.length, `Band ${i}: ${kinds.map(([k]) => k).join(' ')}`).toBeGreaterThanOrEqual(3);
      }
      const all = bands.flat();
      expect(Math.max(...count(all).values()) / all.length).toBeLessThanOrEqual(0.6);
      // Stein unten (Sockelreihe), Rindenstamm als Schwelle/Rahmen, entrindete Stämme als Wand
      expect(bands[0]).toContain('cobblestone');
      expect(all).toContain('dark_oak_log');
      expect(all).toContain('stripped_spruce_log');
      const { fams, total, rowMix } = roofRows(w);
      expect(fams.map(([f]) => f).sort()).toEqual(['dark_oak', 'deepslate_tile']);
      expect(fams[1]![1] / total).toBeGreaterThanOrEqual(0.15);
      expect(rowMix).toBeLessThan(0.1);
    });
  }

  it('Eckholz hebt sich vom Wandholz ab (Rahmen ≠ Wand)', { timeout: HEAVY_TIMEOUT }, () => {
    const w = build('house', 'nordic');
    const names = (role: string): Set<string> => new Set(w.shell.cells.filter((c) => c.role === role).map((c) => family(nameAt(w, c.pos))).filter((n) => !SKIP.test(n)));
    const wall = names('wall_primary');
    expect(wall.has('stripped_spruce_log')).toBe(true);
    for (const f of names('pillar')) expect(wall.has(f), `Eckholz ${f}`).toBe(false);
  });

  // W13-F (2026-09-28): winter hat jetzt eine eigene Bretterwand (Fichte, weiße Rahmen, Schneedach) statt der Blockwand
  // von nordic, die Küste ein Steinziegel-Erdgeschoss unter Blasseichen-Brettern (plan/spikes/W13F_stil_paletten.md).
  // Vorher: winter = nordic-Wand, harbor-Verlauf ['dark_oak', 'spruce', 'spruce'].
  it('P1 (Wert-Kontrast Wand ↔ Dach) ≥ medieval; winter und Küste mit eigener Bretterwand (W13-F)', () => {
    const p1 = (id: string): number => P1(ctx.themes.get(id)!)!.value;
    expect(p1('nordic')).toBeGreaterThanOrEqual(p1('medieval'));
    expect(p1('winter')).toBeGreaterThanOrEqual(p1('medieval'));
    expect(p1('harbor')).toBeGreaterThanOrEqual(p1('medieval'));
    expect(ctx.themes.get('winter')!.roles['wall_primary']!.gradient!.stops.map((s) => s.mix[0]!.family)).toEqual(['spruce', 'spruce']);
    expect(ctx.themes.get('harbor')!.roles['wall_primary']!.gradient!.stops.map((s) => s.mix[0]!.family)).toEqual(['stone_bricks', 'pale_oak', 'pale_oak']);
  });

  it('gekreuzte Windbretter: an beiden Firstenden je zwei Treppen, Rücken nach außen, spiegelgleich', { timeout: HEAVY_TIMEOUT }, () => {
    // W13-B (2026-09-28): auch der einreihige First (ungerade Breite) trägt die Windbretter – links und rechts der
    // Firstplatte. Geprüft: eingeschossig mit zwei Firstreihen (house S), zweigeschossig mit einreihigem First
    // (house M; W12-A: Obergeschoss kragt aus, Breite ungerade) und eingeschossig mit einreihigem First (longhouse M).
    // Zweigeschossig mit zwei Firstreihen gibt es im Katalog (Seed 2026) nicht – den Fall prüft
    // `exterior/test/ridge-cross.test.ts` am Rechteckhaus (gerade/ungerade × 1/2 Geschosse).
    for (const [type, size] of [['house', 'S'], ['house', 'M'], ['longhouse', 'M']] as const) {
      const w = build(type, 'nordic', 2026, size);
      const where = `${type} ${size}`;
      const cross = (w.exterior ?? []).filter((p) => p.componentId === 'exterior/ridge_cross');
      expect(cross.length, where).toBeGreaterThanOrEqual(4);
      expect(cross.length % 4, where).toBe(0);
      // W13-A (2026-09-28): Häuser aus mehreren Baukörpern haben mehrere Firste auf verschiedenen Höhen (Werkstatt,
      // Eckturm) – geprüft wird je First (Firsthöhe und Richtung), jeder für sich spiegelgleich. Vorher: eine Höhe je Haus.
      const all = cross.flatMap((p) => p.cells);
      const allStates = all.map((p) => w.materialized.volume.stateAt(p));
      expect(new Set(allStates.map((s) => s.name.replace(/^minecraft:/, ''))), where).toEqual(new Set(['spruce_stairs']));
      const ridges = new Map<string, Array<readonly [number, number, number]>>();
      for (const p of cross) {
        const st = p.cells.map((c) => String(w.materialized.volume.stateAt(c).properties['facing']));
        const ew = st.some((f) => f === 'east' || f === 'west');
        const k = `${p.cells[0]![1]}|${ew ? 'x' : 'z'}`;
        ridges.set(k, [...(ridges.get(k) ?? []), ...p.cells]);
      }
      for (const [k, cells] of ridges) {
        const at = `${where} First ${k}`;
        const states = cells.map((p) => w.materialized.volume.stateAt(p));
        expect(cells.length % 4, at).toBe(0);
        // spiegelgleich: gleich viele Treppen mit Rücken in jede Seitenrichtung
        const facing = count(states.map((s) => String(s.properties['facing'])));
        const axis = facing.has('east') || facing.has('west') ? ['east', 'west'] : ['north', 'south'];
        expect(facing.get(axis[0]!), at).toBe(facing.get(axis[1]!));
        // keine schwebenden Blöcke: unter jedem Brett ein Block
        for (const p of cells) expect(nameAt(w, [p[0], p[1] - 1, p[2]]), `${at} ${p.join(',')}`).not.toBe('air');
        // Rücken nach außen: das Brett mit dem kleineren Seitenwert zeigt zur kleineren Seite
        const lat = axis[0] === 'east' ? 0 : 2;
        const [lo, hi] = [Math.min(...cells.map((p) => p[lat]!)), Math.max(...cells.map((p) => p[lat]!))];
        cells.forEach((p, i) => {
          const f = String(states[i]!.properties['facing']);
          if (p[lat] === lo) expect(f, at).toBe(lat === 0 ? 'west' : 'north');
          if (p[lat] === hi) expect(f, at).toBe(lat === 0 ? 'east' : 'south');
        });
      }
    }
    // andere Themes: keine gekreuzten Bretter (bitgleich)
    const m = build('house', 'medieval', 2026, 'S');
    expect((m.exterior ?? []).some((p) => p.componentId === 'exterior/ridge_cross')).toBe(false);
  });

  it('Torfdach (W13-B): Soden auf dem Dach, Windbretter darüber, harte Regeln 0', { timeout: HEAVY_TIMEOUT }, () => {
    const w = build('house', 'nordic');
    const v = w.materialized.volume;
    // Soden: Gras/Moos der Torf-Auflage (Owner `decor:turf`) und Firstplatten, die zu Soden wurden (Hüllzelle)
    const roofAt = new Set(w.shell.cells.filter((c) => c.kind === 'roof').map((c) => c.pos.join(',')));
    const sods = [...v.cells()].filter((c) => (c.state.name === 'grass_block' || c.state.name === 'moss_block')
      && (c.owner === 'decor:turf' || roofAt.has(c.pos.join(','))));
    expect(sods.length).toBeGreaterThan(50);
    expect(w.materialized.violations.filter((x) => x.severity === 'error')).toEqual([]);
    // Soden über dem Dach (Luft oder Bewuchs darüber)
    for (const c of sods) {
      const up = nameAt(w, [c.pos[0], c.pos[1] + 1, c.pos[2]]);
      expect(up === 'air' || /^(short_grass|fern|dandelion|oxeye_daisy|snow)$/.test(up), `${c.pos.join(',')} ${up}`).toBe(true);
    }
    // die Spitzen der gekreuzten Windbretter stehen über dem Torf: über jedem Brett eine gleiche Treppe, darüber Luft
    for (const p of (w.exterior ?? []).filter((x) => x.componentId === 'exterior/ridge_cross').flatMap((x) => x.cells)) {
      expect(nameAt(w, [p[0], p[1] + 1, p[2]]), p.join(',')).toBe('spruce_stairs');
      expect(nameAt(w, [p[0], p[1] + 2, p[2]]), p.join(',')).toBe('air');
    }
    // Holzdach-Seed (Anteil 0,75): kein Torf, die Windbretter bleiben
    const wood = build('house', 'nordic', 7);
    expect([...wood.materialized.volume.cells()].some((c) => c.state.name === 'grass_block' && c.owner === 'decor:turf')).toBe(false);
  });

  it('deterministisch: zweimal derselbe Bau, dieselben Blöcke', { timeout: HEAVY_TIMEOUT }, () => {
    const digest = (w: World): string => {
      let h = 0;
      for (const c of w.materialized.volume.cells()) {
        const s = `${c.pos.join(',')}|${c.state.name}|${JSON.stringify(c.state.properties)}`;
        for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
      }
      return (h >>> 0).toString(16);
    };
    expect(digest(build('longhouse', 'nordic'))).toBe(digest(build('longhouse', 'nordic')));
  });
});
