import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PALETTE_ROLES, PaletteCatalog, applyPalette, resolvePalettedTheme, PaletteRoleSchema, paletteMixEntry, palettesForTheme, parsePaletteDef, validatePaletteDef,
  type PaletteDef,
} from '../src/palette.js';
import { ThemeCatalog, parseThemeDef, resolveTheme, type ThemeDef } from '../src/theme.js';

const CATALOG = fileURLToPath(new URL('../../../catalog', import.meta.url));
const PALETTE_DIR = `${CATALOG}/palettes`;
const THEME_DIR = `${CATALOG}/themes`;

function loadPalettes(): PaletteDef[] {
  return readdirSync(PALETTE_DIR)
    .filter((f) => f.endsWith('.json5'))
    .sort()
    .map((f) => {
      const r = parsePaletteDef(readFileSync(`${PALETTE_DIR}/${f}`, 'utf8'), f);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      return r.value;
    });
}

function loadThemes(): ThemeDef[] {
  return readdirSync(THEME_DIR)
    .filter((f) => f.endsWith('.json5'))
    .sort()
    .map((f) => {
      const r = parseThemeDef(readFileSync(`${THEME_DIR}/${f}`, 'utf8'), f);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      return r.value;
    });
}

const PALETTES = loadPalettes();
const THEMES = loadThemes();
const DEFS = new Map(THEMES.map((t) => [t.id, t]));
const THEME_CATALOG = ThemeCatalog.of(THEMES);

/** Minimales Theme für die Einheitstests (Pflicht-Rollen, eine Rolle mit Verlauf). */
function miniTheme(): ThemeDef {
  return {
    id: 'mini',
    name: 'Mini',
    roles: {
      wall_primary: { mix: [{ family: 'stone_bricks', weight: 70 }, { family: 'cobblestone', weight: 30 }], noise: { type: 'cluster' } },
      floor_primary: { family: 'oak' },
      beam: { family: 'oak' },
      door: { family: 'oak' },
      window: { family: 'glass' },
      ceiling: { family: 'oak' },
      roof_main: {
        gradient: {
          along: 'roof_t',
          stops: [
            { at: 0, mix: [{ family: 'deepslate_tiles', weight: 60 }, { family: 'cobbled_deepslate', weight: 40 }] },
            { at: 1, mix: [{ family: 'deepslate_tiles', weight: 100 }] },
          ],
        },
      },
      furniture_wood: { family: 'oak' },
      textile_primary: { color: 'red' },
      light_hanging: { family: 'iron', shapes: { lantern: 'lantern' } },
      metal: { family: 'iron' },
    },
    paletteRoleMap: {
      wall_primary: ['wall_primary'],
      roof: ['roof_main'],
      accent: ['textile_primary'],
      light: ['light_hanging'],
    },
  };
}

const miniPalette: PaletteDef = {
  id: 'test_palette',
  name: 'Testpalette',
  mood: 'gemuetlich',
  biomes: ['plains'],
  styles: ['medieval'],
  values: ['minecraft:calcite', 'minecraft:stone', 'minecraft:blackstone'],
  roles: {
    wall_primary: { blocks: [{ family: 'calcite', weight: 60 }, { family: 'stone', weight: 40 }] },
    roof: { blocks: [{ family: 'stone', weight: 100 }] },
    accent: { blocks: [{ family: 'color:red', shape: 'wool', weight: 100 }] },
    light: { blocks: [{ family: 'iron', shape: 'lantern', weight: 100 }] },
    glass: { blocks: [{ block: 'minecraft:glass_pane', weight: 100 }] },
    trim: { blocks: [{ family: 'polished_andesite', weight: 100 }] },
  },
};

describe('PaletteDef: Schema und Validierung', () => {
  it('weist unbekannte Rollen, fehlende Rollen, Doppel-Belegung und fehlende Felder ab', () => {
    const base = { id: 'p', name: 'P', mood: 'gemuetlich', biomes: ['plains'], styles: ['medieval'], values: ['minecraft:stone', 'minecraft:deepslate'], roles: { wall_primary: { blocks: [{ family: 'stone', weight: 100 }] } } };
    const missing = validatePaletteDef(base);
    expect(missing.ok ? '' : missing.errors.join(' ')).toContain('Paletten-Rolle fehlt');
    const full = { ...base, roles: Object.fromEntries(PALETTE_ROLES.map((r) => [r, { blocks: [{ family: 'stone', weight: 100 }] }])) };
    expect(validatePaletteDef(full).ok).toBe(true);
    expect(validatePaletteDef({ ...full, roles: { ...full.roles, wand: { blocks: [{ family: 'stone', weight: 100 }] } } }).ok).toBe(false);
    expect(validatePaletteDef({ ...full, mood: 'lustig' }).ok).toBe(false);
    expect(validatePaletteDef({ ...full, roles: { ...full.roles, wall_primary: { blocks: [{ family: 'stone', block: 'minecraft:stone', weight: 100 }] } } }).ok).toBe(false);
    expect(validatePaletteDef({ ...full, roles: { ...full.roles, wall_primary: { blocks: [{ variant: 'mossy', weight: 100 }] } } }).ok).toBe(false);
  });

  it('warnt außerhalb des Dominanzbandes und bei Gewichtssummen ungleich 100', () => {
    const roles = Object.fromEntries(PALETTE_ROLES.map((r) => [r, { blocks: [{ family: 'stone', weight: 100 }] }]));
    const r = validatePaletteDef({
      id: 'p', name: 'P', mood: 'duester', biomes: ['cave'], styles: ['ruin'],
      values: ['minecraft:stone', 'minecraft:deepslate'],
      roles: { ...roles, floor: { blocks: [{ family: 'stone', weight: 40 }, { family: 'andesite', weight: 40 }, { family: 'deepslate', weight: 40 }] } },
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toContain('kein tragendes Material');
    expect(r.warnings.join(' ')).toContain('Gewichtssumme 120');
    // Nebenrollen dürfen gleichmäßig gemischt sein (kein Dominanz-Hinweis)
    const quiet = validatePaletteDef({ ...{ id: 'p', name: 'P', mood: 'duester', biomes: ['cave'], styles: ['ruin'], values: ['minecraft:stone', 'minecraft:deepslate'] }, roles: { ...roles, foliage: { blocks: [{ family: 'stone', weight: 50 }, { family: 'deepslate', weight: 50 }] } } });
    expect(quiet.warnings.join(' ')).not.toContain('kein tragendes Material');
  });

  it('übersetzt Familien-Einträge mit Form/Variante und feste Blöcke', () => {
    expect(paletteMixEntry({ family: 'stone_bricks', variant: 'mossy', weight: 15 })).toEqual({ family: 'stone_bricks', variant: 'mossy', weight: 15 });
    expect(paletteMixEntry({ family: 'color:red', variant: 'stained_glass', weight: 40 })).toEqual({ family: 'color:red', variant: 'stained_glass', weight: 40 });
    // Formen der Palette (`log`, `pane`) sind Katalog-Aussage und werden nicht als Theme-Variante durchgereicht.
    expect(paletteMixEntry({ family: 'dark_oak', shape: 'log', weight: 30 })).toEqual({ family: 'dark_oak', weight: 30 });
    expect(paletteMixEntry({ family: 'oak', weight: 70 })).toEqual({ family: 'oak', weight: 70 });
    expect(paletteMixEntry({ block: 'minecraft:lantern', weight: 100 })).toEqual({ block: 'minecraft:lantern', weight: 100 });
  });
});

describe('applyPalette', () => {
  it('ersetzt Mischungen, lässt Geometrie (surfaces/decor) und unbeteiligte Rollen unberührt', () => {
    const theme = miniTheme();
    const out = applyPalette(theme, miniPalette);
    expect(out.roles.wall_primary).toEqual({
      mix: [{ family: 'calcite', weight: 60 }, { family: 'stone', weight: 40 }],
      noise: { type: 'cluster' },
    });
    // Verlauf bleibt Verlauf (Achse, Stopps), nur die Mischung wechselt
    expect(out.roles.roof_main?.gradient?.along).toBe('roof_t');
    expect(out.roles.roof_main?.gradient?.stops).toHaveLength(2);
    expect(out.roles.roof_main?.gradient?.stops[0]?.mix).toEqual([{ family: 'stone', weight: 100 }]);
    // Rollen ohne Paletten-Zuordnung bleiben wörtlich gleich
    expect(out.roles.beam).toBe(theme.roles.beam);
    expect(out.roles.metal).toBe(theme.roles.metal);
    // Styles/Flächen/Deko bleiben unberührt
    expect(out.surfaces).toBe(theme.surfaces);
    expect(out.paletteRoleMap).toBe(theme.paletteRoleMap);
  });

  it('ist rein: das Eingabe-Theme wird nicht verändert', () => {
    const theme = miniTheme();
    const before = JSON.stringify(theme);
    applyPalette(theme, miniPalette);
    expect(JSON.stringify(theme)).toBe(before);
  });

  it('liefert ohne paletteRoleMap das Theme unverändert zurück', () => {
    const { paletteRoleMap: _map, ...ohne } = miniTheme();
    const theme: ThemeDef = ohne;
    expect(applyPalette(theme, miniPalette)).toBe(theme);
  });

  it('setzt auch einen einzelnen Block als Mischung (Rollenform bleibt `mix`, gültiges Theme)', () => {
    const theme = miniTheme();
    const out = applyPalette(theme, { ...miniPalette, roles: { ...miniPalette.roles, accent: { blocks: [{ family: 'color:gold', shape: 'wool', weight: 100 }] } } });
    expect(out.roles.textile_primary).toEqual({ mix: [{ family: 'color:gold', weight: 100 }] });
    // Das Ergebnis ist ein gültiges Theme mit unveränderter Bauweise der Rolle (noise bleibt)
    const rolle = applyPalette(theme, { ...miniPalette, roles: { ...miniPalette.roles, wall_primary: { blocks: [{ block: 'minecraft:deepslate_tiles', weight: 100 }] } } });
    expect(rolle.roles.wall_primary).toEqual({ mix: [{ block: 'minecraft:deepslate_tiles', weight: 100 }], noise: { type: 'cluster' } });
    expect(resolveTheme(new Map([[theme.id, out]]), theme.id).ok).toBe(true);
  });
});

describe('Katalog: 31 Paletten', () => {
  it('jede Datei ist gültig und die IDs sind eindeutig', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(31);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    expect(() => PaletteCatalog.of(PALETTES)).not.toThrow();
  });

  it('nennt für jede Palette alle elf Rollen mit Gewichten um 100', () => {
    for (const p of PALETTES) {
      expect(Object.keys(p.roles).sort()).toEqual([...PALETTE_ROLES].sort());
      for (const role of PALETTE_ROLES) {
        const total = p.roles[role]!.blocks.reduce((s, b) => s + b.weight, 0);
        expect(total, `${p.id}.${role}`).toBeGreaterThan(0);
        // Die Rollen tragen relative Gewichte; die Summe ist 100 oder (nach Formvertrag-Ersatz) ein Rest.
        expect(total, `${p.id}.${role}`).toBeLessThanOrEqual(100.01);
      }
    }
  });

  it('hat keine Schema-Fehler; Dominanz-Hinweise nur außerhalb des Bandes', () => {
    const r = validatePaletteDef(PALETTES[0]);
    expect(r.ok).toBe(true);
    const dominant = PALETTES.filter((p) => validatePaletteDef(p).warnings.some((w) => w.includes('kein tragendes Material')));
    expect(dominant.map((p) => p.id)).toEqual([]);
  });

  it('bietet je Theme die passenden Paletten an (styles-Feld)', () => {
    const catalog = PaletteCatalog.of(PALETTES);
    expect(palettesForTheme(catalog, 'medieval').length).toBeGreaterThan(3);
    expect(palettesForTheme(catalog, 'medieval').some((p) => p.id === 'steinburg_grau')).toBe(true);
    expect(palettesForTheme(catalog, 'medieval').every((p) => p.styles.includes('medieval'))).toBe(true);
  });
});

describe('Akzeptanz: 12 Themes × alle Paletten ergeben gültige Themes', () => {
  it('jedes Theme hat ein paletteRoleMap und jede Kombination ist ein auflösbares Theme', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(12);
    for (const theme of THEMES) {
      const resolved = THEME_CATALOG.get(theme.id);
      const map = resolved.paletteRoleMap;
      expect(Object.keys(map).length, `${theme.id} ohne paletteRoleMap`).toBeGreaterThan(0);
      // Jede Theme-Rolle hängt an höchstens einer Paletten-Rolle, und jedes Ziel existiert im aufgelösten Theme.
      const owner = new Map<string, string>();
      for (const [prole, targets] of Object.entries(map)) {
        for (const target of targets ?? []) {
          expect(Object.hasOwn(resolved.roles, target), `${theme.id}.${prole} → unbekannte Rolle '${target}'`).toBe(true);
          expect(owner.has(target), `${theme.id}: '${target}' doppelt (${owner.get(target)} und ${prole})`).toBe(false);
          owner.set(target, prole);
        }
      }
    }
    for (const theme of THEMES) {
      for (const palette of PALETTES) {
        const before = THEME_CATALOG.get(theme.id);
        const after = THEME_CATALOG.resolveWith(theme.id, palette);
        // Die Palette hat wirklich gefärbt (mindestens eine zugeordnete Rolle trägt andere Materialien).
        const claimed = Object.keys(before.paletteRoleMap) as (typeof PALETTE_ROLES)[number][];
        const changed = claimed.some((role) => (before.paletteRoleMap[role] ?? []).some((target) => after.roles[target] !== before.roles[target]));
        expect(changed, `${theme.id} × ${palette.id}: keine Rolle geändert`).toBe(true);
        // Ohne Palette bleibt das Theme referenzgleich (Prüfsummen: keine stille Änderung).
        expect(THEME_CATALOG.resolveWith(theme.id)).toBe(before);
      }
    }
  });

  // W4 (27.09.2026, W2-FC §8 Punkt 4): Farbwelten färben auch das Giebelfeld (Baustandard D4)
  it('jedes Theme mit eigenem Giebelfeld (`wall_gable`) lässt es von der Palette färben', () => {
    const withGable = THEMES.map((t) => THEME_CATALOG.get(t.id)).filter((t) => Object.hasOwn(t.roles, 'wall_gable'));
    // W12-C (28.09.2026): farmstead hat wie rustic (W9-G3) kein eigenes Giebelfeld mehr (Lehmputz über die Wandregeln)
    expect(withGable.length).toBeGreaterThanOrEqual(7);
    for (const theme of withGable) {
      const slot = Object.entries(theme.paletteRoleMap).find(([, targets]) => (targets ?? []).includes('wall_gable'))?.[0];
      expect(slot, `${theme.id}: wall_gable ohne Paletten-Rolle`).toBeDefined();
      // Holz-Giebel (Bretter/Stämme) folgen dem Holz, Putz- und Stein-Giebel der Zweitwand – nie der Wand selbst (D4)
      expect(['wood_frame', 'wall_secondary']).toContain(slot);
      let recolored = 0;
      for (const palette of PALETTES) {
        const after = THEME_CATALOG.resolveWith(theme.id, palette);
        if (JSON.stringify(after.roles['wall_gable']) !== JSON.stringify(theme.roles['wall_gable'])) recolored++;
      }
      expect(recolored, `${theme.id}: keine Palette färbt das Giebelfeld`).toBeGreaterThan(PALETTES.length / 2);
    }
  });
});


describe('explizite Palettenverläufe (Q4 / research63)', () => {
  const stops = [
    { at: 0, blocks: [{ family: 'blackstone', weight: 100 }] },
    { at: 1, blocks: [{ family: 'cobbled_deepslate', weight: 100 }] },
  ];
  const palette = { ...miniPalette, roles: { ...miniPalette.roles,
    roof: { ...miniPalette.roles.roof!, gradientStops: stops },
  } };

  it('akzeptiert explizite Stopps und lehnt unvollständige oder unsortierte Verläufe ab', () => {
    expect(PaletteRoleSchema.safeParse(palette.roles.roof).success).toBe(true);
    for (const gradientStops of [[], [stops[0]], [...stops].reverse(),
      [stops[0], stops[0], stops[1]], [{ ...stops[0], at: 0.2 }, stops[1]],
      [stops[0], { ...stops[1], blocks: [] }]]) {
      expect(PaletteRoleSchema.safeParse({ ...palette.roles.roof, gradientStops }).success).toBe(false);
    }
  });

  it('erhält verschiedene Mischungen in beiden Pfaden, Achse und Ausgangsdaten', () => {
    const theme = miniTheme();
    const before = JSON.stringify({ theme, palette });
    const direct = applyPalette(theme, palette);
    const resolved = resolvePalettedTheme(new Map([[theme.id, theme]]), theme.id, palette);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.errors.join(' '));
    const expected = stops.map(({ at, blocks }) => ({ at, mix: blocks }));
    for (const out of [direct, resolved.value]) {
      expect(out.roles.roof_main?.gradient?.stops).toEqual(expected);
      expect(out.roles.roof_main?.gradient?.along).toBe('roof_t');
    }
    expect(JSON.stringify({ theme, palette })).toBe(before);
  });

  it('erhält bei einem unbaubaren Stopp die gesamte ursprüngliche Rolle', () => {
    const theme = miniTheme();
    const bad = { ...palette, roles: { ...palette.roles, roof: {
      ...palette.roles.roof, gradientStops: [stops[0]!, { at: 1, blocks: [{ block: 'minecraft:calcite', weight: 100 }] }],
    } } };
    const result = resolvePalettedTheme(new Map([[theme.id, theme]]), theme.id, bad);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.value.roles.roof_main).toEqual(theme.roles.roof_main);
  });

  it('nutzt gültige explizite Stopps auch bei einer unpassenden normalen Mischung', () => {
    const theme = miniTheme();
    const custom = { ...palette, roles: { ...palette.roles, roof: {
      ...palette.roles.roof, blocks: [{ block: 'minecraft:calcite', weight: 100 }],
    } } };
    const result = resolvePalettedTheme(new Map([[theme.id, theme]]), theme.id, custom);
    if (!result.ok) throw new Error(result.errors.join(' '));
    expect(result.value.roles.roof_main?.gradient?.stops).toEqual(stops.map(s => ({ at: s.at, mix: s.blocks })));
  });

  it('wendet Stopps nur auf Theme-Rollen mit Verlauf an; alte Paletten bleiben unverändert', () => {
    const theme = miniTheme();
    const mixed = { ...palette, roles: { ...palette.roles,
      wall_primary: { ...miniPalette.roles.wall_primary!, gradientStops: stops },
    } };
    expect(applyPalette(theme, mixed).roles.wall_primary).toEqual(applyPalette(theme, miniPalette).roles.wall_primary);
    const legacy = applyPalette(theme, miniPalette).roles.roof_main!.gradient!;
    expect(legacy.stops.map(s => s.mix)).toEqual([
      [{ family: 'stone', weight: 100 }], [{ family: 'stone', weight: 100 }],
    ]);
  });
});

describe('W7 (27.09.2026): Ersatzfamilien des Themes in umgefärbten Rollen', () => {
  const byId = (id: string) => PALETTES.find((p) => p.id === id)!;

  it('medieval + Farbwelt: hearth/hearth_alt behalten Stein/Ziegel des Themes als Ersatz (Feuerschale fragt Mauer ab)', () => {
    const r = resolvePalettedTheme(DEFS, 'medieval', byId('steinburg_grau'));
    if (!r.ok) throw new Error(r.errors.join(' '));
    const base = resolveTheme(DEFS, 'medieval');
    if (!base.ok) throw new Error(base.errors.join(' '));
    // Farbe kommt weiter aus der Palette, nur der letzte Weg (vor dem Plattform-Rückfall) nennt die Theme-Familien
    expect(r.value.roles.hearth?.mix).not.toEqual(base.value.roles.hearth?.mix);
    expect(r.value.roles.hearth?.fallback).toEqual(['stone_bricks', 'cobblestone', 'blackstone']);
    expect(r.value.roles.hearth_alt?.fallback).toEqual(['bricks']);
  });

  it('eigene Ersatzfamilien der Rolle bleiben vorn; ohne Palette unverändert', () => {
    const r = resolvePalettedTheme(DEFS, 'rustic', byId('piratenbucht_holz'));
    if (!r.ok) throw new Error(r.errors.join(' '));
    expect(r.value.roles.leaves_oak?.fallback).toEqual(['oak']);
    const plain = resolvePalettedTheme(DEFS, 'rustic', undefined);
    const base = resolveTheme(DEFS, 'rustic');
    expect(plain).toEqual(base);
    const med = resolvePalettedTheme(DEFS, 'medieval', byId('steinburg_grau'));
    const baseMed = resolveTheme(DEFS, 'medieval');
    if (!med.ok || !baseMed.ok) throw new Error('medieval');
    const own = baseMed.value.roles.counter_top!.fallback!;
    expect(med.value.roles.counter_top?.fallback?.slice(0, own.length)).toEqual(own);
  });
});

describe('W8-C (27.09.2026): Geländevertrag beim Umfärben', () => {
  const byId = (id: string) => PALETTES.find((p) => p.id === id)!;
  const roleOf = (themeId: string, paletteId: string, role: string) => {
    const r = resolvePalettedTheme(DEFS, themeId, byId(paletteId));
    if (!r.ok) throw new Error(r.errors.join(' '));
    return r.value.roles[role];
  };
  const blocks = (spec: ReturnType<typeof roleOf>) => (spec?.mix ?? []).map((e) => e.block ?? e.family);

  it('Teppich nie als Untergrund: medieval + koenigsschloss_gold färbt ground_stone nur mit Quarz', () => {
    expect(blocks(roleOf('medieval', 'koenigsschloss_gold', 'ground_stone'))).toEqual(['quartz']);
    expect(blocks(roleOf('dwarven', 'festhalle_rot', 'ground_dirt'))).toEqual(['dark_oak']);
  });

  it('Kies nicht im frei hängenden Untergrund, aber auf Wegen (darunter liegt Erde)', () => {
    expect(blocks(roleOf('medieval', 'ruine_bemoost', 'ground_stone'))).toEqual(['stone_bricks', 'minecraft:coarse_dirt']);
    expect(blocks(roleOf('medieval', 'ruine_bemoost', 'ground_path'))).toContain('minecraft:gravel');
  });

  it('Blumen des Themes brauchen Erde: desert + koenigsschloss_gold behält die Wiese des Themes', () => {
    const base = resolveTheme(DEFS, 'desert');
    if (!base.ok) throw new Error('desert');
    expect(roleOf('desert', 'koenigsschloss_gold', 'ground_grass')).toEqual(base.value.roles.ground_grass);
    // Erde-artige Einträge der Palette bleiben (Grobe Erde)
    expect(blocks(roleOf('desert', 'bauernhof_erdig', 'ground_grass'))).toEqual(['minecraft:coarse_dirt']);
  });

  it('keine Ranke frei in Busch, Blume oder Laub', () => {
    for (const role of ['leaves_bush', 'grass_tuft', 'ground_cover', 'flower_wild']) {
      expect(blocks(roleOf('medieval', 'ruine_bemoost', role)), role).not.toContain('minecraft:vine');
    }
  });

  it('Paletten, deren Einträge den Vertrag erfüllen, färben das Gelände unverändert', () => {
    // steinburg_grau: Boden aus Fichte/Schwarzeiche, Bewuchs Moos/Eichenlaub – alles tragfähig, nichts braucht Erde
    const raw = PALETTES.find((p) => p.id === 'steinburg_grau')!.roles.floor!.blocks.map(paletteMixEntry);
    for (const role of ['ground_grass', 'ground_stone', 'ground_path', 'farmland']) {
      expect(roleOf('medieval', 'steinburg_grau', role)?.mix, role).toEqual(raw);
    }
  });
});
