/** View-Model der Arbeitsfläche: Darstellung (Texturen als Standard), Anordnung, Licht, Etagen, Adresszeile, Klick. */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import type { TextureState, TextureSourceInfo } from '../src/textures/assets.js';
import {
  DEFAULT_LIGHTING, DEFAULT_VIEW, NIGHT_TICKS, DAY_TICKS, adjacentFloor, effectivePreview, floorItems, isNight, nextLayout, nextPreview, previewOptions,
  toggleDayNight, validFloor, viewSettingsFromQuery,
} from '../src/ui/viewModel.js';
import * as uc from '../src/usecases.js';
import { CLICK_MAX_MS, CLICK_SLOP_PX, isClick } from '../src/viewer/viewport.js';

const catalog = loadBundledCatalog().catalog!;
const source: TextureSourceInfo = { origin: 'dev', version: '1.21.11', label: 'local' };
const tex = {
  probing: { kind: 'probing' } as TextureState,
  none: { kind: 'none' } as TextureState,
  available: { kind: 'available', source } as TextureState,
  loading: { kind: 'loading', message: '…' } as TextureState,
};

describe('Darstellung', () => {
  it('Standard: Texturen + Licht, sobald eine Quelle da ist, sonst Blöcke; ohne Pipeline nur Rollen', () => {
    expect(effectivePreview(undefined, tex.available, true)).toBe('textures');
    expect(effectivePreview(undefined, tex.loading, true)).toBe('textures');
    expect(effectivePreview(undefined, tex.none, true)).toBe('blocks');
    expect(effectivePreview(undefined, tex.probing, true)).toBe('blocks');
    expect(effectivePreview(undefined, tex.available, false)).toBe('roles');
    expect(effectivePreview('textures', tex.available, false)).toBe('roles');
  });

  it('Wahl des Nutzers gilt, solange sie möglich ist', () => {
    expect(effectivePreview('roles', tex.available, true)).toBe('roles');
    expect(effectivePreview('blocks', tex.available, true)).toBe('blocks');
    expect(effectivePreview('textures', tex.none, true)).toBe('blocks'); // Quelle weg → Blöcke
    expect(effectivePreview('textures', tex.probing, true)).toBe('textures'); // Suche läuft noch
  });

  it('Knöpfe und Taste V überspringen gesperrte Darstellungen', () => {
    const off = previewOptions(true, { enabled: false, hint: 'kein JAR' });
    expect(off.map((o) => o.disabled)).toEqual([false, false, true]);
    expect(off[2]!.hint).toBe('kein JAR');
    expect(nextPreview('blocks', off)).toBe('roles');
    const on = previewOptions(true, { enabled: true, hint: 'JAR' });
    expect(nextPreview('roles', on)).toBe('blocks');
    expect(nextPreview('blocks', on)).toBe('textures');
    expect(nextPreview('textures', on)).toBe('roles');
    const noPipeline = previewOptions(false, { enabled: true, hint: '' });
    expect(noPipeline.filter((o) => !o.disabled).map((o) => o.id)).toEqual(['roles']);
    expect(nextPreview('roles', noPipeline)).toBe('roles');
  });

  it('Grundriss-Anordnung reihum (Taste G)', () => {
    expect(nextLayout('split')).toBe('overlay');
    expect(nextLayout('overlay')).toBe('3d');
    expect(nextLayout('3d')).toBe('split');
  });
});

describe('Licht und Adresszeile', () => {
  it('Tag/Nacht (Taste N) schaltet das Licht ein', () => {
    expect(isNight(NIGHT_TICKS)).toBe(true);
    expect(isNight(DAY_TICKS)).toBe(false);
    expect(isNight(12600)).toBe(false); // Dämmerung zählt als Tag
    expect(toggleDayNight(DEFAULT_LIGHTING).dayTime).toBe(NIGHT_TICKS);
    expect(toggleDayNight({ ...DEFAULT_LIGHTING, dayTime: 20000, enabled: false })).toMatchObject({ dayTime: DAY_TICKS, enabled: true });
  });

  it('Startwerte aus der Adresszeile, ungültige Werte werden ignoriert', () => {
    expect(viewSettingsFromQuery('')).toEqual(DEFAULT_VIEW);
    const v = viewSettingsFromQuery('?view=full&preview=blocks&layout=3d&cut=3&grid=0&time=18000&lit=0&spawn=1&brightness=80&smooth=0&flicker=1');
    expect(v).toEqual({
      view: 'full', preview: 'blocks', layout: '3d', cut: 3, grid: false, floors: 'upTo',
      lighting: { enabled: false, dayTime: 18000, spawnHighlight: true, brightness: 0.8, smooth: false, flicker: true },
    });
    expect(viewSettingsFromQuery('?floors=only').floors).toBe('only');
    expect(viewSettingsFromQuery('?floors=oben').floors).toBe(DEFAULT_VIEW.floors);
    const bad = viewSettingsFromQuery('?view=oben&preview=x&time=99999&brightness=-1&cut=abc&grid=vielleicht');
    expect(bad).toEqual(DEFAULT_VIEW);
  });
});

describe('Etagen-Leiste', () => {
  it('heute genau eine Etage (EG), Nachbarn fehlen, ungültige Wahl fällt auf die vorhandene zurück', () => {
    let s = uc.createSession(3);
    s = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 6, z2: 5 }, 'bedroom').session;
    const items = floorItems(s.project.state, 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ index: 0, label: 'EG', rooms: 1, active: true });
    expect(items[0]!.detail).toContain('1 Raum');
    expect(adjacentFloor(s.project.state, 0, 1)).toBeUndefined();
    expect(adjacentFloor(s.project.state, 0, -1)).toBeUndefined();
    expect(validFloor(s.project.state, 5)).toBe(0);
  });

  it('Beschriftung und Reihenfolge für mehrere Etagen (Vorbereitung, synthetischer Zustand)', () => {
    const state = { ...uc.createSession(1).project.state, floors: [{ index: 0, y0: 0, height: 3 }, { index: 1, y0: 5, height: 3 }, { index: -1, y0: -5, height: 3 }] };
    expect(floorItems(state, 1).map((f) => [f.label, f.active])).toEqual([['1. OG', true], ['EG', false], ['1. UG', false]]);
    expect(adjacentFloor(state, 0, 1)).toBe(1);
    expect(adjacentFloor(state, 0, -1)).toBe(-1);
    expect(adjacentFloor(state, 1, 1)).toBeUndefined();
  });
});

describe('Klick oder Ziehen (3D)', () => {
  it('kurz und ruhig = Klick, sonst Kamera', () => {
    const d = { x: 100, y: 100, t: 0 };
    expect(isClick(d, { x: 102, y: 103, t: 120 })).toBe(true);
    expect(isClick(d, { x: 100 + CLICK_SLOP_PX + 1, y: 100, t: 50 })).toBe(false);
    expect(isClick(d, { x: 100, y: 100, t: CLICK_MAX_MS + 1 })).toBe(false);
  });
});
