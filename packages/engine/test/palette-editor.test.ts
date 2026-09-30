/**
 * W13-G „Blockpalette vor dem Generieren anpassen“: Domäne (Normalform, Event), Katalog (Gruppen, Formvertrag,
 * Anwendung auf das Theme), Pipeline (Ansicht, Harmonie, Würfeln, Versionsprüfung) und Engine-API (palette_suggest,
 * building_generate.paletteOverrides, Befehl setPaletteOverrides).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { PALETTE_GROUPS, normalizePaletteOverrides, paletteOverridesKey } from '@mcda/core';
import {
  FAMILY_SHAPES, PALETTE_FAMILY_LABELS, PALETTE_GROUP_DEFS, applyPaletteOverrides, dominantFamily, familyFitsRole, swapProblem,
} from '@mcda/catalog';
import { ThemeResolver } from '@mcda/materialize';
import { paletteEditorView, paletteOverrideProblems, rollPaletteOverrides, themeWith } from '@mcda/pipeline';
import { ctx, engine } from './fixture.js';

describe('Domäne: Normalform und Event', () => {
  it('Normalform: feste Reihenfolge, ungültige Einträge weg, leer → undefined', () => {
    expect(normalizePaletteOverrides({})).toBeUndefined();
    expect(normalizePaletteOverrides({ groups: { roof: 'bricks', wall: 'Bad ID' }, swaps: [{ from: 'oak', to: 'oak' }] }))
      .toEqual({ groups: { roof: 'bricks' } });
    expect(paletteOverridesKey({ groups: { roof: 'bricks', wall: 'oak' } })).toBe(paletteOverridesKey({ groups: { wall: 'oak', roof: 'bricks' } }));
  });

  it('setPaletteOverrides: ein Event, gleiche Werte kein Event, undefined entfernt das Feld (feldgleich)', () => {
    const p = Project.create({ id: 'p', name: 'p', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    const before = p.state;
    expect(p.setPaletteOverrides({ groups: { roof: 'bricks' } })).toHaveLength(1);
    expect(p.setPaletteOverrides({ groups: { roof: 'bricks' } })).toHaveLength(0);
    expect(p.state.paletteOverrides).toEqual({ groups: { roof: 'bricks' } });
    p.setPaletteOverrides(undefined);
    expect('paletteOverrides' in p.state).toBe(false);
    expect(Object.keys(p.state).sort()).toEqual(Object.keys(before).sort());
  });
});

describe('Katalog: Gruppen und Formvertrag', () => {
  it('jede handverlesene Familie gibt es in 1.21.11, passt zur Leitrolle und hat einen deutschen Namen', () => {
    for (const g of PALETTE_GROUPS) {
      const def = PALETTE_GROUP_DEFS[g];
      for (const f of def.families) {
        if (!f.startsWith('color:')) expect(Object.hasOwn(FAMILY_SHAPES, f), `${g}.${f}`).toBe(true);
        expect(familyFitsRole(f, def.roles[0]!), `${g}.${f}`).toBe(true);
        expect(PALETTE_FAMILY_LABELS[f], `${g}.${f}`).toBeDefined();
      }
    }
  });

  it('Formvertrag: Farbe nie in Rollen mit Formvertrag, Glas nie als Balken', () => {
    expect(familyFitsRole('color:red', 'roof_main')).toBe(false);
    expect(familyFitsRole('glass', 'beam')).toBe(false);
    expect(familyFitsRole('spruce', 'door')).toBe(true);
    expect(familyFitsRole('stone_bricks', 'door')).toBe(false);
  });

  it('Tausch nur innerhalb einer Art', () => {
    expect(swapProblem('oak', 'spruce')).toBeUndefined();
    expect(swapProblem('oak', 'stone_bricks')).toMatch(/nur Holz gegen Holz/);
    expect(swapProblem('color:red', 'color:blue')).toBeUndefined();
  });

  it('ohne Überschreibung dasselbe Objekt (bitgleich); mit Überschreibung zwischengespeichert', () => {
    const t = ctx.themes.get('medieval');
    expect(applyPaletteOverrides(t, undefined)).toBe(t);
    expect(applyPaletteOverrides(t, {})).toBe(t);
    const a = applyPaletteOverrides(t, { groups: { roof: 'bricks' } });
    expect(applyPaletteOverrides(t, { groups: { roof: 'bricks' } })).toBe(a);
    expect(themeWith(ctx, 'medieval', undefined)).toBe(t);
  });

  it('Gruppe setzen: Leitrolle trägt die Familie, Bauweise bleibt, alte Familien werden Ersatz', () => {
    const t = ctx.themes.get('medieval');
    const o = applyPaletteOverrides(t, { groups: { wall: 'bricks', roof: 'bricks', frame: 'spruce' } });
    expect(dominantFamily(o.roles['wall_primary'])).toBe('bricks');
    expect(o.roles['wall_primary']!.noise).toEqual(t.roles['wall_primary']!.noise);
    expect(o.roles['wall_primary']!.fallback).toContain('stone_bricks');
    expect(dominantFamily(o.roles['beam'])).toBe('spruce');
    expect(dominantFamily(o.roles['roof_main'])).toBe('bricks');
    // andere Rollen unverändert
    expect(o.roles['floor_primary']).toBe(t.roles['floor_primary']);
  });

  it('Tausch: Verlauf und Gewichte bleiben, nur die Familie wechselt; gesetzte Gruppen bleiben unberührt', () => {
    const t = ctx.themes.get('medieval');
    const o = applyPaletteOverrides(t, { groups: { floor: 'birch' }, swaps: [{ from: 'stone_bricks', to: 'deepslate_bricks' }, { from: 'spruce', to: 'oak' }] });
    const stops = o.roles['wall_primary']!.gradient!.stops;
    expect(stops).toHaveLength(t.roles['wall_primary']!.gradient!.stops.length);
    expect(stops.flatMap((s) => s.mix.map((e) => e.family))).toContain('deepslate_bricks');
    expect(stops.flatMap((s) => s.mix.map((e) => e.family))).not.toContain('stone_bricks');
    expect(stops.map((s) => s.mix.map((e) => e.weight))).toEqual(t.roles['wall_primary']!.gradient!.stops.map((s) => s.mix.map((e) => e.weight)));
    expect(dominantFamily(o.roles['floor_primary'])).toBe('birch'); // Gruppe gesetzt → Tausch spruce → oak greift dort nicht
  });

  it('Materialisierung: Dachtreppen aus der gewählten Familie', () => {
    const theme = themeWith(ctx, 'medieval', undefined, { groups: { roof: 'bricks' } });
    const platform = ctx.platform('1.21.11');
    const r = new ThemeResolver(theme, platform.families, platform.registry);
    for (let seed = 0; seed < 20; seed++) expect(r.resolve('roof_main', 'stairs', { mixSeed: seed, t: { roof_t: 0.5 } }).block).toBe('brick_stairs');
  });
});

describe('Pipeline: Ansicht, Harmonie, Würfeln, Version', () => {
  it('Ansicht: Gruppen mit Theme-Familie, Optionen hell → dunkel, nur Familien der Zielversion', () => {
    const v = paletteEditorView(ctx, 'medieval', undefined, undefined, ctx.platform('1.21.1').families);
    expect(v.groups.map((g) => g.group)).toEqual(PALETTE_GROUPS.filter((g) => v.groups.some((x) => x.group === g)));
    const wall = v.groups.find((g) => g.group === 'wall')!;
    expect(wall.theme?.family).toBe('stone_bricks');
    expect(wall.effective?.family).toBe('stone_bricks');
    const frame = v.groups.find((g) => g.group === 'frame')!;
    expect(frame.options.map((o) => o.family)).not.toContain('pale_oak'); // gibt es in 1.21.1 nicht
    expect(paletteEditorView(ctx, 'medieval', undefined, undefined, ctx.platform('1.21.11').families).groups.find((g) => g.group === 'frame')!.options.map((o) => o.family)).toContain('pale_oak');
    const lum = frame.options.map((o) => ((o.color >> 16) & 0xff) * 0.2126 + ((o.color >> 8) & 0xff) * 0.7152 + (o.color & 0xff) * 0.0722);
    expect([...lum].sort((a, b) => b - a)).toEqual(lum);
  });

  it('Harmonie: Dach heller als die Wand passt nicht', () => {
    const v = paletteEditorView(ctx, 'medieval', undefined, { groups: { wall: 'stone_bricks' } }, ctx.platform('1.21.11').families);
    const roof = v.groups.find((g) => g.group === 'roof')!;
    expect(roof.options.find((o) => o.family === 'deepslate_tiles')!.fits).toBe(true);
    expect(roof.options.find((o) => o.family === 'smooth_sandstone')!.fits).toBe(false);
  });

  it('Würfeln: deterministisch, gesperrte Gruppen bleiben, Ergebnis gültig', () => {
    const start = { groups: { roof: 'bricks' } };
    const a = rollPaletteOverrides(ctx, 'medieval', undefined, start, ctx.platform('1.21.11').families, 5, ['roof']);
    const b = rollPaletteOverrides(ctx, 'medieval', undefined, start, ctx.platform('1.21.11').families, 5, ['roof']);
    const c = rollPaletteOverrides(ctx, 'medieval', undefined, start, ctx.platform('1.21.11').families, 6, ['roof']);
    expect(a).toEqual(b);
    expect(a?.groups?.roof).toBe('bricks');
    expect(paletteOverridesKey(a)).not.toBe(paletteOverridesKey(c));
    expect(paletteOverrideProblems(a, ctx.platform('1.21.11').families)).toEqual([]);
  });

  it('Prüfung: fremde Familie, falsche Art, fehlende Version', () => {
    const v1211 = ctx.platform('1.21.1').families;
    expect(paletteOverrideProblems({ groups: { roof: 'glass' } }, v1211)[0]).toMatch(/gehört nicht zur Auswahl/);
    expect(paletteOverrideProblems({ groups: { frame: 'pale_oak' } }, v1211)[0]).toMatch(/gibt es in Version 1\.21\.1 nicht/);
    expect(paletteOverrideProblems({ swaps: [{ from: 'oak', to: 'bricks' }] }, v1211)[0]).toMatch(/nur Holz gegen Holz/);
  });
});

describe('Engine-API', () => {
  const digest = (input: Record<string, unknown>): string => {
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', themeId: 'medieval', seed: 7, surroundings: false, ...input } });
    if (!r.ok || r.artifacts?.export === undefined) throw new Error(JSON.stringify(r));
    return createHash('sha256').update(JSON.stringify(r.artifacts.export.blocks, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).digest('hex');
  };

  it('building_generate: ohne bzw. mit leerer Überschreibung bitgleich, mit Überschreibung anders und reproduzierbar', () => {
    const plain = digest({});
    expect(digest({ paletteOverrides: {} })).toBe(plain);
    const brick = digest({ paletteOverrides: { roof: 'bricks', frame: 'spruce' } });
    expect(brick).not.toBe(plain);
    expect(digest({ paletteOverrides: { roof: 'bricks', frame: 'spruce' } })).toBe(brick);
  });

  it('building_generate lehnt ungültige Familie der Zielversion ab', () => {
    const r = engine.execute({ op: 'building_generate', input: {
      buildingTypeId: 'house', themeId: 'medieval', seed: 7, surroundings: false, targetVersion: '1.21.1', paletteOverrides: { frame: 'pale_oak' },
    } });
    expect(r.ok).toBe(false);
  });

  it('palette_suggest: Gruppen, Farben, Würfeln mit Sperre', () => {
    const r = engine.execute({ op: 'palette_suggest', input: { themeId: 'medieval', roll: true, seed: 3, lock: ['roof'], paletteOverrides: { roof: 'bricks' }, swapFrom: 'oak' } });
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const d = r.data as { paletteOverrides: Record<string, unknown>; groups: Array<{ group: string; options: Array<{ family: string; color: string; fits: boolean }> }>; swapTargets: Array<{ family: string }> };
    expect(d.paletteOverrides['roof']).toBe('bricks');
    expect(d.groups.find((g) => g.group === 'wall')!.options[0]!.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(d.swapTargets.map((s) => s.family)).toContain('spruce');
    expect(d.swapTargets.map((s) => s.family)).not.toContain('stone_bricks');
  });

  it('Befehl setPaletteOverrides: setzt, prüft Version, löscht', () => {
    const created = engine.execute({ op: 'project_create', input: { name: 'Palette', seed: 3, themeId: 'medieval' } });
    if (!created.ok) throw new Error(created.errors.join('\n'));
    const id = (created.data as { project?: { projectId: string }; projectId?: string }).project?.projectId ?? (created.data as { projectId: string }).projectId;
    const cmd = (c: Record<string, unknown>) => engine.execute({ op: 'project_command', input: { projectId: id, commands: [{ command: 'setPaletteOverrides', ...c }] } });
    expect(cmd({ paletteOverrides: { wall: 'bricks', swaps: [{ from: 'oak', to: 'spruce' }] } }).ok).toBe(true);
    expect(cmd({ paletteOverrides: { wall: 'glass' } }).ok).toBe(false);
    expect(cmd({ paletteOverrides: { swaps: [{ from: 'oak', to: 'stone_bricks' }] } }).ok).toBe(false);
    expect(cmd({}).ok).toBe(true);
  });
});
