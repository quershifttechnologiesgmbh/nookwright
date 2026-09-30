import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_THEME_ROLES, ThemeCatalog, gradientPalette, mixEntryKey, parseThemeDef, resolveTheme, timberDecor, validateThemeDef, type ThemeDef,
} from '../src/index.js';

const THEME_DIR = fileURLToPath(new URL('../../../catalog/themes', import.meta.url));

function loadThemeFiles(): ThemeDef[] {
  return readdirSync(THEME_DIR)
    .filter((f) => f.endsWith('.json5'))
    .map((f) => {
      const r = parseThemeDef(readFileSync(join(THEME_DIR, f), 'utf8'), f);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.warnings, f).toEqual([]);
      expect(`${r.value.id}.json5`).toBe(f);
      return r.value;
    });
}

const minimalRoles = Object.fromEntries(REQUIRED_THEME_ROLES.map((r) => [r, { family: 'oak' }]));

describe('Theme-Dateien im Repo', () => {
  it('acht Themes – gültig, id = Dateiname (vier alte + Welle D)', () => {
    expect(loadThemeFiles().map((t) => t.id).sort()).toEqual(['asian', 'desert', 'dwarven', 'elven', 'farmstead', 'gothic', 'harbor', 'medieval', 'nordic', 'nordic_falu', 'ruin', 'rustic', 'steampunk', 'terracotta_birch', 'timber', 'tropical', 'winter']);
  });

  it('Vererbung: rustic/nordic/timber erben von medieval, alle Pflicht-Rollen vorhanden', () => {
    const cat = ThemeCatalog.of(loadThemeFiles());
    expect(cat.ids()).toEqual(['asian', 'desert', 'dwarven', 'elven', 'farmstead', 'gothic', 'harbor', 'medieval', 'nordic', 'nordic_falu', 'ruin', 'rustic', 'steampunk', 'terracotta_birch', 'timber', 'tropical', 'winter']);
    for (const id of cat.ids()) {
      const t = cat.get(id);
      for (const role of REQUIRED_THEME_ROLES) expect(t.roles[role], `${id}.${role}`).toBeDefined();
    }
    const rustic = cat.get('rustic');
    expect(rustic.chain).toEqual(['medieval', 'rustic']);
    expect(rustic.roles['furniture_wood']).toEqual({ family: 'poplar' });
    // geerbt, nicht überschrieben
    expect(rustic.roles['window']).toEqual({ family: 'glass' });
    expect(rustic.roles['wall_secondary']).toEqual(cat.get('medieval').roles['wall_secondary']);
    // Items schlüsselweise überschrieben, Rest geerbt
    expect(rustic.items['food.baked']).toEqual(['minecraft:bread', 'minecraft:pumpkin_pie']);
    expect(rustic.items['book.any']).toEqual(cat.get('medieval').items['book.any']);
    expect(rustic.versionFallbacks['poplar']).toEqual(['oak']);
    expect(rustic.versionFallbacks['pale_oak']).toEqual(['birch']);
    // W12-D (2026-09-28): Rahmenholz ≠ Wandholz – Balken als Rindenstamm in dunkler Eiche vor der entrindeten Blockwand
    expect(cat.get('nordic').roles['beam']).toEqual({ family: 'dark_oak' });
  });

  it('Flächen und Verwitterung werden je Fläche vererbt (nordic: eigene Wandregeln, Rest von medieval)', () => {
    const cat = ThemeCatalog.of(loadThemeFiles());
    const medieval = cat.get('medieval');
    const nordic = cat.get('nordic');
    // W12-D (2026-09-28): Blockbau – Steinsockel, Schwellbalken, liegende Stämme (statt keiner Wandregel)
    expect(nordic.surfaces.wall).toEqual([
      { when: { exterior: true, storey: 0, hRel: 0 }, role: 'foundation' },
      { when: { exterior: true, storey: 0, hRel: 1 }, role: 'beam', shape: 'log', along: true, corner: 'wood' },
      { role: 'wall_primary', shape: 'log', along: true, corner: 'wood' },
    ]);
    // die Küste bleibt bei der Bohlenwand ohne Wandregeln (W12-D), Decke und Rähm erbt sie weiter von nordic
    expect(cat.get('harbor').surfaces.wall).toEqual([]);
    expect(cat.get('harbor').surfaces.ceiling).toEqual(nordic.surfaces.ceiling);
    expect(nordic.surfaces.floor).toEqual(medieval.surfaces.floor);
    // W2 (26.09.2026): Regel W6 – Holzhaus mit liegendem Rähm außen (eigene Deckenregel), medieval: Außenhaut bis unters Dach
    expect(nordic.surfaces.ceiling).toEqual([{ beams: { role: 'beam', period: 3 }, plate: { role: 'beam' } }]);
    // W13-E (2026-09-28): vor der Außenhaut der Holz-Rähm des Fachwerk-Obergeschosses (nur Bautypen mit `upperFrame`);
    // vorher `ceiling[0].when` = { exterior: true }
    expect(medieval.surfaces.ceiling?.[0]?.when).toEqual({ exterior: true, upperFrame: true, storey: [1, 16] });
    expect(medieval.surfaces.ceiling?.[1]?.when).toEqual({ exterior: true });
    // W13-B (2026-09-28): Verwitterung erbt nordic von medieval, dazu das eigene Torfdach (je Effekt vererbt)
    expect(nordic.decor.weathering).toEqual(medieval.decor.weathering);
    expect(nordic.decor.turfRoof?.roles).toEqual(['roof_main', 'roof_trim']);
    expect(medieval.decor.turfRoof).toBeUndefined();
    // Erben mit eigenem Dach schalten das Torfdach ab (bitgleich zu vorher)
    for (const id of ['winter', 'harbor', 'elven']) expect(cat.get(id).decor.turfRoof?.share, id).toBe(0);
    // W9-G3 (27.09.2026): rustic hat eigene Wandregeln (Steinsockel, Scheunenrot, Putzgiebel) vor den Regeln von medieval
    // W13-E (2026-09-28): die letzten 3 Regeln sind die von medieval ohne dessen Fachwerk-Obergeschoss (rustic hat ein eigenes)
    // FN-Dense (28.09.2026): die Kellerstein-Regeln (Kerker, Weinkeller, Lagerkeller) gelten nur in medieval und den Erben ohne
    // eigene Flächenregeln; die Steinbau-/Holzbau-Themes mit eigener Kopie der Regeln bleiben bitgleich zu vorher
    const noFnCellar = <T extends { role?: string | undefined; when?: { upperFrame?: boolean | undefined } | undefined }>(r: T): boolean => r.when?.upperFrame === undefined && r.role !== 'cellar_stone' && r.role !== 'cellar_vault';
    expect(cat.get('rustic').surfaces.wall?.slice(-3)).toEqual(medieval.surfaces.wall?.filter(noFnCellar));
    // W13-E: Sandstein und Tuff bleiben in allen Geschossen Stein – Wand- und Deckenregeln von medieval ohne `upperFrame`
    for (const id of ['desert', 'dwarven']) {
      expect(cat.get(id).surfaces.wall, id).toEqual(medieval.surfaces.wall?.filter(noFnCellar));
      expect(cat.get(id).surfaces.ceiling, id).toEqual(medieval.surfaces.ceiling?.filter(noFnCellar));
    }
  });

  it('medieval: Paletten aus research/12 und die neuen Rollen aus research/10 §10', () => {
    const t = ThemeCatalog.of(loadThemeFiles()).get('medieval');
    for (const role of ['hearth', 'counter_top', 'textile_neutral', 'plant', 'floor_stone', 'floor_earth', 'floor_border', 'wall_wainscot', 'foundation']) {
      expect(t.roles[role], role).toBeDefined();
    }
    expect(t.roles['textile_accent']).toEqual({ color: 'gray' });
    // W2 (26.09.2026): Regel W5 – ein Verlauf über die ganze Fassade statt je Geschoss
    expect(t.roles['wall_primary']!.gradient?.along).toBe('facade_h');
    expect(t.roles['roof_main']!.gradient?.along).toBe('roof_t');
    // Zellverband seit research/30 K1 (Blender-Voronoi): harte Kanten für den Steinverband
    expect(t.roles['wall_primary']!.noise).toEqual({ type: 'cells', cell: 3 });
    // weiches Clustern bleibt für Putz, Holz und Dach erhalten
    expect(t.roles['wall_secondary']!.noise?.type).toBe('cluster');
    // Tonreihenfolge der Burgmauer (P1) hell → dunkel über alle Stopps; W2 (26.09.2026): Regel W4 – drei Grundblöcke
    // W9-G5 (27.09.2026): vier Grundblöcke (W4 „je Außenwand-Ebene ≤ 4“) – Bruch-Tiefenschiefer dunkelt den Fuß (Review R5 G5)
    expect(gradientPalette(t.roles['wall_primary']!.gradient!).keys).toEqual(['f:andesite', 'f:cobblestone', 'f:stone_bricks', 'f:cobbled_deepslate']);
  });
});

describe('Theme-Format: Verlauf, Rauschen, Varianten, feste Blöcke (research/12 §7.8)', () => {
  const base = { id: 't', name: 'T', roles: minimalRoles };
  const withRole = (x: unknown) => validateThemeDef({ ...base, roles: { ...minimalRoles, x } });
  const g = (stops: unknown, extra: Record<string, unknown> = {}) => ({ gradient: { along: 'wall_h', stops, ...extra } });
  const two = [{ at: 0, mix: [{ family: 'stone_bricks', weight: 1 }] }, { at: 1, mix: [{ family: 'andesite', weight: 1 }] }];

  it('akzeptiert variant, block und gradient + noise', () => {
    const r = withRole({
      mix: [{ family: 'stone_bricks', weight: 6 }, { family: 'stone_bricks', variant: 'mossy', weight: 2 }, { block: 'minecraft:gravel', weight: 1 }],
      noise: { type: 'cluster', scale: 2, octaves: 2, dither: 0.1 },
    });
    expect(r.ok && r.warnings).toEqual([]);
    const gr = withRole({ ...g(two, { jitter: 0.2, interpolate: 'step' }), noise: { type: 'cluster' } });
    expect(gr.ok && gr.warnings).toEqual([]);
  });

  it('K2: interpolate "ease" und gradient.fade (Übergangsbreite in Reihen) sind gültig', () => {
    const ease = withRole({ ...g(two, { interpolate: 'ease', fade: 2 }), noise: { type: 'cluster' } });
    expect(ease.ok, JSON.stringify(!ease.ok && ease.errors)).toBe(true);
    expect(ease.ok && ease.warnings).toEqual([]);
    // Grenzen: fade 0–3, interpolate nur linear/step/ease
    expect(withRole(g(two, { fade: 4 })).ok).toBe(false);
    expect(withRole(g(two, { fade: -1 })).ok).toBe(false);
    expect(withRole(g(two, { interpolate: 'spline' })).ok).toBe(false);
  });

  it('K3: noise.channel und noise.shear sind gültig; wirkungslose Kombinationen werden gewarnt', () => {
    const mix2 = [{ family: 'stone_bricks', weight: 1 }, { family: 'andesite', weight: 1 }];
    const ok = withRole({ mix: mix2, noise: { type: 'cluster', channel: 'weather', shear: 3 } });
    expect(ok.ok, JSON.stringify(!ok.ok && ok.errors)).toBe(true);
    expect(ok.ok && ok.warnings).toEqual([]);
    expect(withRole({ mix: mix2, noise: { type: 'cells', shear: 3 } }).warnings.join()).toContain('wirken nur mit noise.type "cluster"');
    expect(withRole({ mix: mix2, noise: { type: 'white', channel: 'w' } }).warnings.join()).toContain('channel/shear wirken nicht');
    expect(withRole({ mix: mix2, noise: { type: 'cluster', shear: 9 } }).ok).toBe(false);
    expect(withRole({ mix: mix2, noise: { type: 'cluster', channel: 'Wetter' } }).ok).toBe(false);
  });

  it('Palette-Dominanz der Sichtflächen: kein tragendes Material und Einfarbigkeit werden gemeldet', () => {
    const mitWand = (wand: unknown) => validateThemeDef({ ...base, roles: { ...minimalRoles, wall_primary: wand } });
    const gleich = { mix: [{ family: 'stone_bricks', weight: 1 }, { family: 'andesite', weight: 1 }, { family: 'tuff', weight: 1 }] };
    const r1 = mitWand(gleich);
    expect(r1.ok && r1.warnings.join('\n')).toMatch(/wall_primary\.mix: kein tragendes Material \(größter Anteil 33 %/);
    // tragendes Material: keine Warnung
    const r2 = mitWand({ mix: [{ family: 'stone_bricks', weight: 7 }, { family: 'andesite', weight: 2 }, { block: 'minecraft:gravel', weight: 1 }] });
    expect(r2.ok && r2.warnings).toEqual([]);
    // Varianten derselben Familie zählen nicht als eigene Farbe (research/24 §3.1)
    const r3 = mitWand({ mix: [{ family: 'stone_bricks', weight: 1 }, { family: 'stone_bricks', variant: 'mossy', weight: 1 }] });
    expect(r3.ok && r3.warnings).toEqual([]);
    // Nebenflächen (Steinboden aus drei Sorten) sind bewusst gestreut und werden nicht gewarnt
    const r4 = validateThemeDef({ ...base, roles: { ...minimalRoles, floor_stone: gleich } });
    expect(r4.ok && r4.warnings).toEqual([]);
    // Verläufe variieren absichtlich und sind ausgenommen
    const r5 = mitWand(g([{ at: 0, mix: [{ family: 'stone_bricks', weight: 1 }, { family: 'andesite', weight: 1 }] }, { at: 1, mix: [{ family: 'tuff', weight: 1 }] }]));
    expect(r5.ok && r5.warnings).toEqual([]);
  });

  it('Rolle braucht genau eins von family/color/mix/gradient', () => {
    expect(withRole({ family: 'oak', ...g(two) }).ok).toBe(false);
    expect(withRole({ mix: [{ family: 'a', weight: 1 }, { family: 'b', weight: 1 }], ...g(two) }).ok).toBe(false);
  });

  it('Mischungs-Eintrag: genau eins von family/color/block; variant nur mit family; Block-ID mit Namespace', () => {
    expect(withRole({ mix: [{ family: 'a', block: 'minecraft:gravel', weight: 1 }, { family: 'b', weight: 1 }] }).ok).toBe(false);
    expect(withRole({ mix: [{ block: 'minecraft:gravel', variant: 'mossy', weight: 1 }, { family: 'b', weight: 1 }] }).ok).toBe(false);
    expect(withRole({ mix: [{ block: 'gravel', weight: 1 }, { family: 'b', weight: 1 }] }).ok).toBe(false);
  });

  it('Verlauf: Stopps bei 0 … 1, streng aufsteigend; Grenzen für jitter und noise', () => {
    const bad = (stops: unknown) => withRole(g(stops));
    expect(bad([{ at: 0.1, mix: [{ family: 'a', weight: 1 }] }, { at: 1, mix: [{ family: 'b', weight: 1 }] }]).ok).toBe(false);
    expect(bad([{ at: 0, mix: [{ family: 'a', weight: 1 }] }, { at: 0.9, mix: [{ family: 'b', weight: 1 }] }]).ok).toBe(false);
    const unsorted = bad([{ at: 0, mix: [{ family: 'a', weight: 1 }] }, { at: 0.6, mix: [{ family: 'b', weight: 1 }] }, { at: 0.4, mix: [{ family: 'c', weight: 1 }] }, { at: 1, mix: [{ family: 'a', weight: 1 }] }]);
    expect(!unsorted.ok && unsorted.errors.join()).toContain('streng aufsteigen');
    expect(bad([{ at: 0, mix: [{ family: 'a', weight: 1 }] }]).ok).toBe(false);
    expect(withRole(g(two, { jitter: 0.8 })).ok).toBe(false);
    expect(withRole({ ...g(two), noise: { type: 'pink' } }).ok).toBe(false);
    expect(withRole({ ...g(two), noise: { scale: 0.5 } }).ok).toBe(false);
    expect(withRole({ ...g(two), noise: { octaves: 4 } }).ok).toBe(false);
  });

  it('Warnungen: widersprüchliche Tonreihenfolge, doppelte Einträge, wirkungsloses noise/perCell', () => {
    const cyc = withRole(g([
      { at: 0, mix: [{ family: 'a', weight: 1 }, { family: 'b', weight: 1 }] },
      { at: 1, mix: [{ family: 'b', weight: 1 }, { family: 'a', weight: 1 }] },
    ]));
    expect(cyc.warnings.join()).toContain('widersprüchlich');
    expect(withRole({ mix: [{ family: 'a', weight: 1 }, { family: 'a', weight: 2 }] }).warnings.join()).toContain('f:a doppelt');
    expect(withRole({ family: 'oak', noise: { type: 'cluster' } }).warnings.join()).toContain('noise ohne mix/gradient');
    expect(withRole({ family: 'oak', perCell: true }).warnings.join()).toContain('perCell ohne mix/gradient');
    // K2: fade ohne Übergang (step) ist wirkungslos
    expect(withRole(g(two, { interpolate: 'step', fade: 2 })).warnings.join()).toContain('gradient.fade wirkt nicht');
  });

  it('gradientPalette: topologisch über alle Stopps, bei Gleichstand erstes Auftreten', () => {
    const p = gradientPalette({
      along: 'wall_h',
      stops: [
        { at: 0, mix: [{ family: 'b', weight: 1 }, { family: 'c', weight: 1 }, { family: 'e', weight: 1 }] },
        { at: 0.5, mix: [{ family: 'a', weight: 1 }, { family: 'b', weight: 1 }, { family: 'd', weight: 1 }] },
        { at: 1, mix: [{ family: 'd', weight: 1 }, { family: 'e', weight: 1 }] },
      ],
    });
    expect(p.consistent).toBe(true);
    expect(p.keys).toEqual(['f:a', 'f:b', 'f:c', 'f:d', 'f:e']);
    expect(mixEntryKey({ family: 'stone_bricks', variant: 'mossy', weight: 1 })).toBe('f:stone_bricks.mossy');
    expect(mixEntryKey({ block: 'minecraft:gravel', weight: 1 })).toBe('b:minecraft:gravel');
  });
});

describe('Theme-Format: Flächen-Muster und Verwitterung', () => {
  const base = { id: 't', name: 'T', roles: { ...minimalRoles, floor_border: { family: 'dark_oak' }, foundation: { family: 'cobblestone' } } };

  it('akzeptiert Boden-, Wand-, Wandfuß- und Deckenregeln mit allen Mustertypen', () => {
    const patterns = [
      { type: 'checker', size: 2, role: 'floor_border' },
      { type: 'diagonal', period: 4, width: 2, role: 'floor_border' },
      { type: 'herringbone', length: 2, role: 'floor_border', shape: 'log' },
      { type: 'basketweave', size: 3, role: 'floor_border', joint: { role: 'floor_primary' } },
      { type: 'joints', period: 5, role: 'floor_border' },
      { type: 'rings', period: 2, role: 'floor_border' },
      { type: 'runner', role: 'floor_border', edge: { role: 'foundation' } },
    ];
    const r = validateThemeDef({
      ...base,
      surfaces: {
        floor: patterns.map((pattern) => ({ when: { roomTypes: ['hall'] }, border: { role: 'floor_border', inner: { role: 'foundation' } }, pattern })),
        wall: [{ when: { exterior: false, hRel: 0 }, role: 'foundation' }, { when: { fromTop: [0, 1], minHeight: 4 }, role: 'beam' }],
        footing: [{ role: 'foundation' }],
        ceiling: [{ beams: { role: 'beam', period: 3, girderSpan: 8 }, plate: { role: 'beam', corner: 'wood' } }],
      },
      decor: { weathering: { age: 0.3, moss: 1.5, fade: 1.5, roles: ['wall_primary', 'foundation'] } },
    });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
    const cat = ThemeCatalog.of([r.ok ? r.value : (undefined as never)]);
    expect(cat.get('t').surfaces.floor).toHaveLength(7);
    expect(cat.get('t').decor.weathering?.age).toBe(0.3);
    expect(cat.get('t').decor.weathering?.fade).toBe(1.5);
  });

  it('Schemafehler: unbekannter Mustertyp, Tippfehler, Alter > 1, Randzone > 2', () => {
    expect(validateThemeDef({ ...base, surfaces: { floor: [{ pattern: { type: 'zigzag', role: 'floor_border' } }] } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, surfaces: { floor: [{ boarder: { role: 'floor_border' } }] } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, surfaces: { attic: [] } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, decor: { weathering: { age: 1.5, roles: ['foundation'] } } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, decor: { weathering: { age: 0.3, fade: 2.5, roles: ['foundation'] } } }).ok).toBe(false);
  });

  it('Schneeauflage (additiv): Schema, deutsche Meldungen, Rollenprüfung und Vererbung', () => {
    const snow = { roles: ['roof_main', 'ceiling'], layers: 4, chance: 0.5, minRoofT: 0.4 };
    const r = validateThemeDef({ ...base, decor: { weathering: { age: 0.2, roles: ['foundation'] }, snowCover: snow } });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
    const cat = ThemeCatalog.of([r.ok ? r.value : (undefined as never)]);
    expect(cat.get('t').decor.snowCover).toEqual(snow);
    // nur `roles` ist Pflicht; Standard: layers 1, chance 1, minRoofT 0
    expect(validateThemeDef({ ...base, decor: { snowCover: { roles: ['roof_main'] } } }).ok).toBe(true);
    // unbekannter Schlüssel, leere Rollen, Schichthöhe/Wahrscheinlichkeit/Dachgrenze außerhalb → Fehler
    const bad = (s: unknown) => validateThemeDef({ ...base, decor: { snowCover: s } });
    expect(bad({ roles: [] }).ok).toBe(false);
    expect(bad({ roles: ['roof_main'], layers: 0 }).ok).toBe(false);
    expect(bad({ roles: ['roof_main'], layers: 9 }).ok).toBe(false);
    expect(bad({ roles: ['roof_main'], layers: 1.5 }).ok).toBe(false);
    expect(bad({ roles: ['roof_main'], chance: 1.5 }).ok).toBe(false);
    expect(bad({ roles: ['roof_main'], minRoofT: -0.1 }).ok).toBe(false);
    expect(bad({ roles: ['roof_main'], chanze: 1 }).ok).toBe(false);
    // deutsche Meldung (nicht die englische Zod-Vorgabe)
    const err = bad({ roles: [], layers: 9 });
    expect(!err.ok && err.errors.join()).toMatch(/mindestens eine Rolle/);
    expect(!err.ok && err.errors.join()).toMatch(/höchstens 8/);
    // Verweis auf eine unbekannte Rolle → Fehler beim Auflösen
    const parsed = validateThemeDef(base);
    const root = parsed.ok ? parsed.value : (undefined as never);
    const unknown = resolveTheme(new Map([['t', { ...root, decor: { snowCover: { roles: ['roof_ridge'] } } }]]), 't');
    expect(!unknown.ok && unknown.errors.join()).toContain("decor.snowCover.roles[0] verweist auf unbekannte Rolle 'roof_ridge'");
  });

  it('Ruine (additiv): Schema, Rollenprüfung und Vererbung (research/50 C1)', () => {
    const ruin = { roles: ['wall_primary', 'roof_main', 'ceiling'], chance: 0.4, maxDrop: 3, minRoofT: 0.3 };
    const r = validateThemeDef({ ...base, decor: { ruin } });
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
    const cat = ThemeCatalog.of([r.ok ? r.value : (undefined as never)]);
    expect(cat.get('t').decor.ruin).toEqual(ruin);
    // nur `roles` ist Pflicht; chance/maxDrop/minRoofT haben Standardwerte
    expect(validateThemeDef({ ...base, decor: { ruin: { roles: ['wall_primary'] } } }).ok).toBe(true);
    // Vererbung: der Effekt wird schlüsselweise ersetzt (Kind überstimmt die Basis vollständig)
    const parsed = validateThemeDef({ ...base, decor: { ruin } });
    const root = parsed.ok ? parsed.value : (undefined as never);
    const child: ThemeDef = { id: 'c', name: 'C', base: 't', roles: {}, decor: { ruin: { roles: ['ceiling'], chance: 1 } } };
    const res = resolveTheme(new Map([['t', root], ['c', child]]), 'c');
    expect(res.ok && res.value.decor.ruin).toEqual({ roles: ['ceiling'], chance: 1 });
  });

  it('Ruine (additiv): Schemafehler mit deutschen Meldungen, unbekannte Rolle beim Auflösen', () => {
    const bad = (ruin: unknown) => validateThemeDef({ ...base, decor: { ruin } });
    expect(bad({ roles: [] }).ok).toBe(false);
    expect(bad({ roles: ['wall_primary'], chance: 1.5 }).ok).toBe(false);
    expect(bad({ roles: ['wall_primary'], maxDrop: 0 }).ok).toBe(false);
    expect(bad({ roles: ['wall_primary'], maxDrop: 9 }).ok).toBe(false);
    expect(bad({ roles: ['wall_primary'], maxDrop: 1.5 }).ok).toBe(false);
    expect(bad({ roles: ['wall_primary'], minRoofT: -0.1 }).ok).toBe(false);
    expect(bad({ roles: ['wall_primary'], depth: 2 }).ok).toBe(false);
    const err = bad({ roles: [], maxDrop: 9 });
    expect(!err.ok && err.errors.join()).toMatch(/mindestens eine Rolle/);
    expect(!err.ok && err.errors.join()).toMatch(/höchstens 8/);
    const parsed = validateThemeDef(base);
    const root = parsed.ok ? parsed.value : (undefined as never);
    const unknown = resolveTheme(new Map([['t', { ...root, decor: { ruin: { roles: ['roof_ridge'] } } }]]), 't');
    expect(!unknown.ok && unknown.errors.join()).toContain("decor.ruin.roles[0] verweist auf unbekannte Rolle 'roof_ridge'");
  });

  it('Verweise aus surfaces/decor auf unbekannte Rollen → Fehler beim Auflösen (auch über die Basis)', () => {
    const child: ThemeDef = { id: 'c', name: 'C', base: 't', roles: {}, surfaces: { floor: [{ border: { role: 'floor_trim' } }] } };
    const parsed = validateThemeDef(base);
    const root = parsed.ok ? parsed.value : (undefined as never);
    const r = resolveTheme(new Map([['t', root], ['c', child]]), 'c');
    expect(!r.ok && r.errors.join()).toContain("surfaces.floor[0].border.role verweist auf unbekannte Rolle 'floor_trim'");
    const ok = resolveTheme(new Map([['t', root], ['c', { ...child, surfaces: { floor: [{ border: { role: 'floor_border' } }] } }]]), 'c');
    expect(ok.ok).toBe(true);
    const deco = resolveTheme(new Map([['t', { ...root, decor: { weathering: { age: 0.2, roles: ['moss_wall'] } } }]]), 't');
    expect(!deco.ok && deco.errors.join()).toContain("decor.weathering.roles[0] verweist auf unbekannte Rolle 'moss_wall'");
  });

  it('F1 (additiv): Fachwerk an Wandregeln, Geschoss-Bedingungen, Schwelle `along`, Dachregeln für Grat/Kehle', () => {
    const surfaces = {
      wall: [
        { when: { exterior: true, storey: [1, 16] }, role: 'foundation', timber: { role: 'floor_border', motifs: ['cross', 'brace', 'k', 'rhombus', 'feet', 'rail', 'none'], bay: 3 } },
        { when: { storey: 0, topStorey: true }, role: 'foundation', timber: { sill: true } },
      ],
      footing: [{ when: { storey: [1, 4] }, role: 'beam', shape: 'log', along: true, corner: 'wood' }],
      roof: [{ when: { roofLine: ['hip', 'valley'] }, role: 'beam' }],
    };
    const r = validateThemeDef({ ...base, surfaces });
    expect(r.ok && r.warnings).toEqual([]);
    // unbekanntes Motiv, Feldbreite außerhalb, unbekannte Dachlinie
    expect(validateThemeDef({ ...base, surfaces: { wall: [{ role: 'beam', timber: { motifs: ['star'] } }] } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, surfaces: { wall: [{ role: 'beam', timber: { bay: 9 } }] } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, surfaces: { roof: [{ when: { roofLine: ['ridge'] }, role: 'beam' }] } }).ok).toBe(false);
    // wirkungslose Angaben → Warnungen
    const w = validateThemeDef({
      ...base,
      surfaces: { footing: [{ role: 'beam', timber: {}, corner: 'wood' }], roof: [{ role: 'beam', shape: 'slab' }] },
    });
    expect(w.ok && w.warnings.join('\n')).toMatch(/timber wirkt nur in surfaces.wall[\s\S]*corner ohne along[\s\S]*am Dach wirkungslos/);
    // Holzrolle des Fachwerks muss existieren (Standard beam)
    const parsed = validateThemeDef(base);
    const root = parsed.ok ? parsed.value : (undefined as never);
    const bad = resolveTheme(new Map([['t', { ...root, surfaces: { wall: [{ role: 'beam', timber: { role: 'timber_frame' } }] } }]]), 't');
    expect(!bad.ok && bad.errors.join()).toContain("surfaces.wall[0].timber.role verweist auf unbekannte Rolle 'timber_frame'");
  });

  it('F1 (additiv): Deko `decorate`/`decorRole` – Schema, Rollenprüfung und Theme-Vorgabe `timberDecor`', () => {
    const surfaces = { wall: [{ when: { exterior: true }, role: 'beam', timber: { decorate: true, decorRole: 'floor_border' } }] };
    expect(validateThemeDef({ ...base, surfaces }).ok).toBe(true);
    // falscher Typ wird abgelehnt
    expect(validateThemeDef({ ...base, surfaces: { wall: [{ role: 'beam', timber: { decorate: 'ja' } }] } }).ok).toBe(false);
    // Deko-Rolle muss im Theme aufgelöst werden können
    const parsed = validateThemeDef({ ...base, surfaces: { wall: [{ role: 'beam', timber: { decorate: true, decorRole: 'deko_holz' } }] } });
    const root = parsed.ok ? parsed.value : (undefined as never);
    const bad = resolveTheme(new Map([['t', { ...root, roles: { ...minimalRoles } }]]), 't');
    expect(!bad.ok && bad.errors.join()).toContain("surfaces.wall[0].timber.decorRole verweist auf unbekannte Rolle 'deko_holz'");
    // Vorgabe: das Fachwerk-Theme will Deko, die anderen nicht
    const cat = ThemeCatalog.of(loadThemeFiles());
    expect(timberDecor(cat.get('timber'))).toEqual({});
    for (const id of ['medieval', 'nordic', 'rustic']) expect(timberDecor(cat.get(id)), id).toBeUndefined();
  });
});

describe('Theme-Validierung', () => {
  const base = { id: 't', name: 'T', roles: minimalRoles };

  it('akzeptiert ein minimales Theme', () => {
    expect(validateThemeDef(base).ok).toBe(true);
  });

  it('Rolle braucht genau eins von family/color/mix', () => {
    for (const bad of [{}, { family: 'oak', color: 'red' }, { family: 'oak', mix: [{ family: 'a', weight: 1 }, { family: 'b', weight: 1 }] }]) {
      const r = validateThemeDef({ ...base, roles: { ...minimalRoles, x: bad } });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(validateThemeDef({ ...base, roles: { ...minimalRoles, x: { color: 'lime' } } }).ok).toBe(true);
  });

  it('unbekannte Farbe, Felder und Gewichte ≤ 0 werden abgelehnt', () => {
    expect(validateThemeDef({ ...base, roles: { ...minimalRoles, x: { color: 'rot' } } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, roles: { ...minimalRoles, x: { family: 'oak', typo: 1 } } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, roles: { ...minimalRoles, x: { mix: [{ family: 'a', weight: 0 }, { family: 'b', weight: 1 }] } } }).ok).toBe(false);
    expect(validateThemeDef({ ...base, roles: { ...minimalRoles, x: { family: 'oak', blocks: { lantern: 'soul_lantern' } } } }).ok).toBe(false);
  });

  it('Pflicht-Rollen, Basis und Zyklen werden beim Auflösen geprüft', () => {
    const child: ThemeDef = { id: 'child', name: 'C', base: 'root', roles: { door: { family: 'birch' } } };
    const root: ThemeDef = { id: 'root', name: 'R', roles: minimalRoles };
    const ok = resolveTheme(new Map([['root', root], ['child', child]]), 'child');
    expect(ok.ok && ok.value.roles['door']).toEqual({ family: 'birch' });
    const lonely = resolveTheme(new Map([['child', child]]), 'child');
    expect(!lonely.ok && lonely.errors.join()).toContain("unbekannte Basis 'root'");
    const partial = resolveTheme(new Map([['p', { id: 'p', name: 'P', roles: { door: { family: 'oak' } } }]]), 'p');
    expect(!partial.ok && partial.errors.join()).toContain('Pflicht-Rollen fehlen: floor_primary');
    const a: ThemeDef = { id: 'a', name: 'A', base: 'b', roles: minimalRoles };
    const b: ThemeDef = { id: 'b', name: 'B', base: 'a', roles: minimalRoles };
    const cyc = resolveTheme(new Map([['a', a], ['b', b]]), 'a');
    expect(!cyc.ok && cyc.errors.join()).toContain('Vererbungszyklus');
    expect(() => ThemeCatalog.of([a, b])).toThrow(/Vererbungszyklus/);
    expect(validateThemeDef({ ...base, base: 't' }).ok).toBe(false);
  });

  it('JSON5-Fehler werden mit Quelle gemeldet', () => {
    const r = parseThemeDef('{ id: ', 'kaputt.json5');
    expect(!r.ok && r.errors[0]).toContain('kaputt.json5: JSON5-Fehler');
  });
});
