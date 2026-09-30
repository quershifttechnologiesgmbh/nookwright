import type { ComponentDef, GradientAxis, MaterialSpec, ResolvedTheme, ThemeGradient, ThemeRoleSpec } from '@mcda/catalog';
import type { Mirror, Quarter } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { SHELL_ROLE_SHAPES, ThemeResolver, effectiveShellRole, gradientWeightsAt, materialize, mixSeed, type MaterializePlacement } from '../src/index.js';
import { THEME_IDS, VERSIONS, catalog, place, platformView, themes } from './fixtures.js';

/** Alle Materialien einer Komponente (Basis + Varianten, legend + cells). */
function materials(def: ComponentDef): MaterialSpec[] {
  const parts = [def, ...(def.variants ?? [])];
  return parts.flatMap((p) => [...Object.values(p.legend ?? {}), ...(p.cells ?? []).map((c) => c.mat)]);
}

/** (Rolle, Form) aus Katalog-Komponenten + Hülle. */
const ROLE_SHAPES: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const m = new Map<string, Set<string>>();
  const add = (role: string, shape: string): void => {
    m.set(role, (m.get(role) ?? new Set()).add(shape));
  };
  for (const def of catalog.all()) for (const mat of materials(def)) if (mat.role !== undefined && mat.shape !== undefined) add(mat.role, mat.shape);
  for (const [role, shapes] of Object.entries(SHELL_ROLE_SHAPES)) for (const s of shapes) add(role, s);
  return m;
})();

/**
 * Rollen, die nur die Hülle benutzt (keine Komponente): sie lösen wie in der Materialisierung über den Rollen-Rückfall
 * auf (`effectiveShellRole`) – z. B. `wall_gable` (W2 D4) in Themes ohne Giebel-Rezept als `wall_primary`.
 */
const SHELL_ONLY: ReadonlySet<string> = (() => {
  const used = new Set<string>();
  for (const def of catalog.all()) for (const mat of materials(def)) if (mat.role !== undefined) used.add(mat.role);
  return new Set(Object.keys(SHELL_ROLE_SHAPES).filter((r) => !used.has(r)));
})();

describe('Theme-Auflösung: jede (Rolle, Form) aus Katalog + Hülle in jedem Theme und jeder Zielversion', () => {
  it('der Katalog benutzt die erwarteten Rollen', () => {
    // Mindestmenge statt exakter Liste: Der Katalog wächst; ob JEDE benutzte Kombination auflöst, prüfen die Tests unten.
    expect([...ROLE_SHAPES.keys()]).toEqual(expect.arrayContaining([
      'beam', 'ceiling', 'door', 'floor_primary', 'furniture_wood', 'light_hanging', 'metal', 'roof_main', 'textile_primary', 'wall_primary', 'window',
    ]));
    expect([...ROLE_SHAPES.get('furniture_wood')!]).toEqual(expect.arrayContaining(['fence', 'pressure_plate', 'slab', 'stairs']));
  });

  for (const version of VERSIONS) {
    for (const themeId of THEME_IDS) {
      it(`${themeId} / ${version}`, () => {
        const { registry, families } = platformView(version);
        const resolver = new ThemeResolver(themes.get(themeId), families, registry);
        const problems: string[] = [];
        for (const [role, shapes] of ROLE_SHAPES) {
          for (const shape of shapes) {
            for (const seed of [1, 2, 3, 4, 5]) { // Mischungen: mehrere Wahlen
              try {
                const own = SHELL_ONLY.has(role) ? effectiveShellRole((x) => resolver.hasRole(x), role) : role;
                const r = resolver.resolve(own, shape, mixSeed(seed, role));
                const def = registry.defaultState(r.block);
                if (def === undefined || !registry.isValidState(def.name, def.properties, { complete: true })) problems.push(`${role}.${shape} → ${r.block} ungültig`);
              } catch (e) {
                problems.push((e as Error).message);
              }
            }
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }
});

describe('Jede Katalog-Komponente materialisiert in jedem Theme, jeder Version, jeder Drehung', () => {
  const poses: readonly (readonly [Quarter, Mirror])[] = [[0, 'none'], [1, 'none'], [2, 'none'], [3, 'none'], [1, 'x'], [2, 'z']];
  for (const version of VERSIONS) {
    it(`${version}: alle Komponenten × Varianten × Themes × Posen ergeben gültige, vollständige States`, { timeout: HEAVY_TIMEOUT }, () => {
      const reg = platformView(version).registry;
      let count = 0;
      for (const themeId of THEME_IDS) {
        for (const def of catalog.all()) {
          for (const variant of def.variants?.map((v) => v.id) ?? [undefined]) {
            for (const [rot, mirror] of poses) {
              const pl: MaterializePlacement = place(`${def.id}`, def.id, [0, 0, 0], rot, variant, mirror);
              const r = materialize({ shell: { cells: [], rooms: new Map(), warnings: [] }, placements: [pl], theme: themes.get(themeId), platform: platformView(version), seed: 3 });
              for (const c of r.volume.cells()) {
                expect(reg.isValidState(c.state.name, c.state.properties, { complete: true }), `${def.id} ${c.state.name}`).toBe(true);
              }
              count++;
            }
          }
        }
      }
      expect(count).toBeGreaterThan(300);
    });
  }
});

describe('Fallbacks und Mischungen', () => {
  it('Versions-Fallback: Pappel-Möbel (26.3) → Eiche in 1.21.11, sichtbar in substitutions', () => {
    const chair = [place('c', 'seat/chair', [0, 0, 0])];
    const empty = { cells: [], rooms: new Map(), warnings: [] };
    const new_ = materialize({ shell: empty, placements: chair, theme: themes.get('rustic'), platform: platformView('26.3'), seed: 1 });
    expect(new_.volume.stateAt([0, 0, 0]).name).toBe('poplar_stairs');
    expect(new_.substitutions).toEqual([]);
    const old = materialize({ shell: empty, placements: chair, theme: themes.get('rustic'), platform: platformView('1.21.11'), seed: 1 });
    expect(old.volume.stateAt([0, 0, 0]).name).toBe('oak_stairs');
    expect(old.substitutions).toEqual([{ role: 'furniture_wood', shape: 'stairs', block: 'oak_stairs', family: 'oak', via: 'version_fallback' }]);
  });

  it('Putz-Verlauf: Einträge ohne Form fallen heraus; hat keiner die Form → Ersatzfamilie der Rolle (Quarz)', () => {
    const { registry, families } = platformView('26.3');
    const r = new ThemeResolver(themes.get('medieval'), families, registry);
    // unten (t = 0): Kalzit/Terrakotta haben keine Treppen → Ersatzfamilie
    expect(r.resolve('wall_secondary', 'stairs', { mixSeed: 1, t: { wall_h: 0 } })).toMatchObject({ block: 'quartz_stairs', family: 'quartz', via: 'role_fallback' });
    // oben (t = 1): W2 (26.09.2026, Regel W4) – der sprenkelnde Diorit ist aus dem Putz entfernt; auch dort Ersatzfamilie
    expect(r.resolve('wall_secondary', 'stairs', { mixSeed: 1, t: { wall_h: 1 } })).toMatchObject({ block: 'quartz_stairs', family: 'quartz', via: 'role_fallback' });
    // Form block: feste Blöcke (Pilzstiel) und Familien gemischt
    const blocks = new Set([...Array(200).keys()].map((i) => r.resolve('wall_secondary', 'block', { mixSeed: i, t: { wall_h: 1 } }).block));
    expect([...blocks].sort()).toEqual(['calcite', 'mushroom_stem', 'white_terracotta']);
    expect(r.resolve('wall_secondary', 'block', { mixSeed: 3, t: { wall_h: 0.3 } }).via).toMatch(/^(direct|block)$/);
  });

  it('Variante: bemoost/rissig als Form der Familie (block) bzw. Familie mossy_* (Treppe), sonst Grundform', () => {
    const { registry, families } = platformView('26.3');
    const t = themes.get('medieval');
    const custom: ResolvedTheme = {
      ...t,
      roles: {
        ...t.roles,
        x_moss: { mix: [{ family: 'stone_bricks', variant: 'mossy', weight: 1 }, { family: 'cobblestone', variant: 'mossy', weight: 1 }] },
        x_crack: { mix: [{ family: 'stone_bricks', variant: 'cracked', weight: 1 }, { family: 'deepslate_tiles', variant: 'cracked', weight: 1 }] },
      },
    };
    const r = new ThemeResolver(custom, families, registry);
    const all = (role: string, shape: string) => new Set([...Array(60).keys()].map((i) => r.resolve(role, shape, i).block));
    expect([...all('x_moss', 'block')].sort()).toEqual(['mossy_cobblestone', 'mossy_stone_bricks']);
    expect([...all('x_moss', 'stairs')].sort()).toEqual(['mossy_cobblestone_stairs', 'mossy_stone_brick_stairs']);
    expect([...all('x_crack', 'block')].sort()).toEqual(['cracked_deepslate_tiles', 'cracked_stone_bricks']);
    expect([...all('x_crack', 'stairs')].sort()).toEqual(['deepslate_tile_stairs', 'stone_brick_stairs']); // keine rissigen Treppen
    expect(r.variantOf('stone_bricks', 'block', 'mossy')).toBe('mossy_stone_bricks');
    expect(r.variantOf('cobblestone', 'wall', 'mossy')).toBe('mossy_cobblestone_wall');
    expect(r.variantOf('tuff', 'block', 'mossy')).toBeUndefined();
  });

  it('Verlauf ohne Ort (Komponenten): t = 0,5, weiße Wahl je mixSeed – ein Möbel bleibt einheitlich', () => {
    const { registry, families } = platformView('26.3');
    const r = new ThemeResolver(themes.get('medieval'), families, registry);
    expect(r.resolve('wall_primary', 'block', 42).block).toBe(r.resolve('wall_primary', 'block', { mixSeed: 42 }).block);
    expect(r.resolve('wall_primary', 'block', 42).block).toBe(r.resolve('wall_primary', 'block', { mixSeed: 42, t: { wall_h: 0.5 } }).block);
  });

  it('Textilfarbe: Wollfamilie zuerst, dann Farbfamilie; Wolltreppe erst ab 26.3', () => {
    const t = themes.get('medieval');
    const newR = new ThemeResolver(t, platformView('26.3').families, platformView('26.3').registry);
    const oldR = new ThemeResolver(t, platformView('1.21.11').families, platformView('1.21.11').registry);
    expect(newR.resolve('textile_primary', 'bed').block).toBe('red_bed');
    expect(newR.resolve('textile_primary', 'carpet').block).toBe('red_carpet');
    expect(newR.resolve('textile_primary', 'candle').block).toBe('red_candle');
    expect(newR.resolve('textile_primary', 'stairs').block).toBe('red_wool_stairs');
    expect(() => oldR.resolve('textile_primary', 'stairs')).toThrow(/nicht auflösbar \(versucht: red_wool\.stairs, color:red\.stairs\)/);
  });

  it('feste Blöcke im Theme werden je Version migriert (chain ↔ iron_chain)', () => {
    const custom: ResolvedTheme = { ...themes.get('medieval'), roles: { ...themes.get('medieval').roles, metal: { family: 'iron', blocks: { chain: 'minecraft:chain' } } } };
    for (const [v, expected] of [['26.3', 'iron_chain'], ['1.21.11', 'iron_chain'], ['1.21.1', 'chain']] as const) {
      const { registry, families } = platformView(v);
      expect(new ThemeResolver(custom, families, registry).resolve('metal', 'chain')).toMatchObject({ block: expected, via: 'block' });
    }
  });

  it('weiße Mischung (Herd 55:20:15:10) ist deterministisch und ungefähr gewichtet; Treppen ohne rissige Form', () => {
    const { registry, families } = platformView('26.3');
    const r = new ThemeResolver(themes.get('medieval'), families, registry);
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      const b = r.resolve('hearth', 'block', mixSeed(42, 'hearth', i, 0, 0)).block;
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const share = (b: string) => (counts.get(b) ?? 0) / 2000;
    expect(share('stone_bricks')).toBeGreaterThan(0.5);
    expect(share('stone_bricks')).toBeLessThan(0.6);
    expect(share('cracked_stone_bricks')).toBeGreaterThan(0.16);
    expect(share('cracked_stone_bricks')).toBeLessThan(0.24);
    expect(share('blackstone')).toBeGreaterThan(0.06);
    expect(r.resolve('hearth', 'block', 99).block).toBe(r.resolve('hearth', 'block', 99).block);
    const stairs = new Set([...Array(100).keys()].map((i) => r.resolve('hearth', 'stairs', i).block));
    expect([...stairs].sort()).toEqual(['blackstone_stairs', 'cobblestone_stairs', 'stone_brick_stairs']);
  });

  it('unbekannte Rolle → klare Meldung', () => {
    const { registry, families } = platformView('26.3');
    expect(() => new ThemeResolver(themes.get('nordic'), families, registry).resolve('lava_moat', 'block')).toThrow("Theme 'nordic' kennt die Rolle 'lava_moat' nicht");
  });
});

describe('K2: Übergangsbreite (`gradient.fade`) und weiche Kurve (`interpolate: "ease"`)', () => {
  const grad = (extra: Record<string, unknown>): ThemeGradient => ({
    along: 'wall_h',
    stops: [
      { at: 0, mix: [{ family: 'blackstone', weight: 1 }] },
      { at: 1, mix: [{ family: 'quartz', weight: 1 }] },
    ],
    ...extra,
  } as ThemeGradient);
  const KEYS = ['f:blackstone', 'f:quartz'];

  it('ohne fade/ease bitgleich zu linear; ein fade, das den Abstand füllt, ebenfalls', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(gradientWeightsAt(grad({}), KEYS, t)).toEqual(gradientWeightsAt(grad({ interpolate: 'linear' }), KEYS, t));
      expect(gradientWeightsAt(grad({ fade: 3 }), KEYS, t, 1)).toEqual(gradientWeightsAt(grad({}), KEYS, t));
    }
  });

  it('fade 1 Reihe bei Wandhöhe 3 (Schrittweite 0,5): nur die mittlere Reihe mischt', () => {
    const g = grad({ fade: 1 });
    expect(gradientWeightsAt(g, KEYS, 0, 0.5)).toEqual([1, 0]);
    expect(gradientWeightsAt(g, KEYS, 0.5, 0.5)).toEqual([0.5, 0.5]);
    expect(gradientWeightsAt(g, KEYS, 1, 0.5)).toEqual([0, 1]);
    // Ohne Schrittweite (Komponenten ohne Ort) wäre dieselbe Angabe eine ganze t-Einheit breit → linear
    expect(gradientWeightsAt(g, KEYS, 0.25)).toEqual([0.75, 0.25]);
  });

  it('ease ist der Smoothstep: gleiche Endpunkte, steilere Mitte, flachere Ränder', () => {
    const e = grad({ interpolate: 'ease' });
    expect(gradientWeightsAt(e, KEYS, 0)).toEqual([1, 0]);
    expect(gradientWeightsAt(e, KEYS, 1)).toEqual([0, 1]);
    expect(gradientWeightsAt(e, KEYS, 0.5)).toEqual([0.5, 0.5]);
    expect(gradientWeightsAt(e, KEYS, 0.25)[0]).toBeCloseTo(0.84375, 10);
    // an den Rändern flacher als linear: bei t = 0,1 bleibt der Startwert fast stehen
    expect(gradientWeightsAt(e, KEYS, 0.1)[0]!).toBeGreaterThan(gradientWeightsAt(grad({}), KEYS, 0.1)[0]!);
    expect(gradientWeightsAt(e, KEYS, 0.9)[0]!).toBeLessThan(gradientWeightsAt(grad({}), KEYS, 0.9)[0]!);
  });

  it('der Resolver rechnet `tStep` der Achse ein: engere Zone verschiebt die Anteile', () => {
    // jitter 0: sonst überlagert die Zufallsverschiebung die gemessene Wirkung der Zone
    const theme: ResolvedTheme = { ...themes.get('medieval'), roles: { ...themes.get('medieval').roles, wall_primary: { gradient: grad({ fade: 1, jitter: 0 }), noise: { type: 'cluster', scale: 2.5, octaves: 2, dither: 0 } } } };
    const { registry, families } = platformView('26.3');
    const r = new ThemeResolver(theme, families, registry);
    const share = (tStep?: Readonly<Partial<Record<GradientAxis, number>>>): number => {
      let schwarz = 0;
      let n = 0;
      for (let a = 0; a < 100; a++) {
        for (let b = 0; b < 20; b++) {
          const pick = { mixSeed: 1, at: { seed: 7, plane: 1, a, b }, t: { wall_h: 0.4 }, ...(tStep !== undefined ? { tStep } : {}) };
          if (r.resolve('wall_primary', 'block', pick).block === 'blackstone') schwarz++;
          n++;
        }
      }
      return schwarz / n;
    };
    // t = 0,4: linear 60 % Schwarzstein; mit 1-Reihen-Zone (Schrittweite 0,5 → Band [0,25 … 0,75]) 70 %
    const ohne = share();
    const mit = share({ wall_h: 0.5 });
    expect(ohne).toBeGreaterThan(0.55);
    expect(ohne).toBeLessThan(0.65);
    expect(mit).toBeGreaterThan(0.65);
    expect(mit).toBeLessThan(0.75);
    expect(mit).toBeGreaterThan(ohne + 0.04);
  });
});

describe('K3: benannter Rauschkanal (`noise.channel`)', () => {
  const mix = (channel?: string): ThemeRoleSpec => ({
    mix: [{ family: 'blackstone', weight: 1 }, { family: 'quartz', weight: 1 }],
    noise: { type: 'cluster', scale: 3, octaves: 2, dither: 0, ...(channel !== undefined ? { channel } : {}) },
  });
  const theme = (a?: string, b?: string): ResolvedTheme => ({
    ...themes.get('medieval'),
    roles: { ...themes.get('medieval').roles, wall_primary: mix(a), floor_primary: mix(b) },
  });
  const pattern = (t: ResolvedTheme, role: string): string[] => {
    const { registry, families } = platformView('26.3');
    const r = new ThemeResolver(t, families, registry);
    const out: string[] = [];
    for (let a = 0; a < 30; a++) {
      for (let b = 0; b < 12; b++) out.push(r.resolve(role, 'block', { mixSeed: 3, at: { seed: 11, plane: 2, a, b } }).block);
    }
    return out;
  };
  const gleich = (x: readonly string[], y: readonly string[]): number => x.filter((v, i) => v === y[i]).length / x.length;

  it('gleicher Kanal = dasselbe Feld (zwei Rollen decken sich), ohne Kanal bleibt jede Rolle eigen', () => {
    const geteilt = theme('weather', 'weather');
    expect(pattern(geteilt, 'wall_primary')).toEqual(pattern(geteilt, 'floor_primary'));
    const eigen = theme();
    expect(gleich(pattern(eigen, 'wall_primary'), pattern(eigen, 'floor_primary'))).toBeLessThan(0.75);
  });

  it('verschiedene Kanäle sind unabhängig (Muster deckt sich nicht)', () => {
    const t = theme('a', 'b');
    const ueberdeckung = gleich(pattern(t, 'wall_primary'), pattern(t, 'floor_primary'));
    expect(ueberdeckung).toBeGreaterThan(0.35);
    expect(ueberdeckung).toBeLessThan(0.65);
  });

  it('ein Kanal verschiebt das Feld wirklich (kein wirkungsloses Zusatzfeld)', () => {
    // Die Bitgleichheit OHNE Kanal sichert `surface-parity.test.ts` (78 Summen, kein Theme setzt einen Kanal).
    expect(pattern(theme('a', 'a'), 'wall_primary')).not.toEqual(pattern(theme(), 'wall_primary'));
  });
});
