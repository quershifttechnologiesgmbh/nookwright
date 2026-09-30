/** Teilen per URL (DR5 K4): Rundreise bitgleich, nur erlaubte Parameter, Versionen und Fehler. */
import { describe, expect, it } from 'vitest';
import {
  SHARE_MAX_LENGTH, SHARE_PARAM_KEYS, decodeShareFragment, encodeShareFragment, fromBase64Url, hasShareFragment, shareParamsOf, toBase64Url,
  type SharedBuild,
} from '@mcda/projectfile';

const full: SharedBuild = {
  buildingTypeId: 'tavern', seed: 2026, rerollCount: 3, targetVersion: '1.21.11',
  params: {
    size: 'M', front: 'east', floors: 2, themeId: 'terracotta_birch', paletteId: 'steinburg_grau', exterior: true, site: false,
    shell: { roof: 'gable', windows: { style: 'tall' } }, setting: { kind: 'buried', front: 'south', cover: 2 },
    paletteOverrides: { groups: { wall: 'stone' } }, blockRules: { preset: 'easy_farm', banned: ['minecraft:diamond_block'] },
    ensemble: true, storyState: 'verlassen', underground: false, functionLevel: 'some', silhouette: 'varied', landform: 'natural', facadeRhythm: 'on',
  },
};

describe('Teilen per URL', () => {
  it('base64url: Rundreise für alle Längen und Umlaute', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'Größe ✓ 𝄞']) {
      const bytes = [...new TextEncoder().encode(s)];
      const enc = toBase64Url(bytes);
      expect(enc).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(enc)).toEqual(bytes);
    }
    expect(fromBase64Url('a')).toBeUndefined();
    expect(fromBase64Url('ab+c')).toBeUndefined();
  });

  it('Rundreise bitgleich: encode → decode → encode, alle Parameter', () => {
    const hash = encodeShareFragment(full);
    expect(hash.startsWith('#b=1.')).toBe(true);
    const back = decodeShareFragment(`https://example.org/app/?embed=1${hash}`);
    expect(back).toEqual({ ok: true, build: { ...full, params: shareParamsOf(full.params) }, warnings: [] });
    if (back.ok) expect(encodeShareFragment(back.build)).toBe(hash);
    // jeder erlaubte Parameter kommt an
    if (back.ok) expect(Object.keys(back.build.params).sort()).toEqual(Object.keys(SHARE_PARAM_KEYS).sort());
  });

  it('kanonisch: Reihenfolge der Schlüssel ändert das Fragment nicht; Standardwerte fallen weg', () => {
    const shuffled = { ...full, params: Object.fromEntries(Object.entries(full.params).reverse()) };
    expect(encodeShareFragment(shuffled)).toBe(encodeShareFragment(full));
    const min = encodeShareFragment({ buildingTypeId: 'house', seed: 1, rerollCount: 0, params: {} });
    expect(min.length).toBeLessThan(40);
    expect(decodeShareFragment(min)).toEqual({ ok: true, build: { buildingTypeId: 'house', seed: 1, rerollCount: 0, params: {} }, warnings: [] });
  });

  it('keine Nutzerdaten: fremde Felder (Name, Prompt, Schlüssel) verwirft der Kodierer', () => {
    const hash = encodeShareFragment({ ...full, params: { ...full.params, name: 'Mein Haus', prompt: 'geheim', apiKey: 'test-key-123' } as never });
    expect(hash).toBe(encodeShareFragment(full));
    const text = new TextDecoder().decode(new Uint8Array(fromBase64Url(hash.slice(5))!));
    expect(text).not.toMatch(/Mein Haus|geheim|test-key/);
  });

  it('Fehler und Warnungen: fehlend, beschädigt, neuere Version, zu lang, unbekannte Parameter', () => {
    expect(hasShareFragment('https://x.org/#b=1.abc')).toBe(true);
    expect(hasShareFragment('https://x.org/#view=3d')).toBe(false);
    expect(decodeShareFragment('#view=3d').ok).toBe(false);
    expect(decodeShareFragment('#b=1.@@@').ok).toBe(false);
    expect(decodeShareFragment('#b=x.abc').ok).toBe(false);
    const newer = decodeShareFragment('#b=2.abc');
    expect(newer.ok ? '' : newer.error).toMatch(/neueren Version/);
    expect(decodeShareFragment(`#b=1.${'A'.repeat(SHARE_MAX_LENGTH)}`).ok).toBe(false);
    const enc = (o: unknown): string => `#b=1.${toBase64Url([...new TextEncoder().encode(JSON.stringify(o))])}`;
    expect(decodeShareFragment(enc({ t: 'house', s: -1 })).ok).toBe(false);
    expect(decodeShareFragment(enc({ t: '../x y', s: 1 })).ok).toBe(false);
    const extra = decodeShareFragment(enc({ t: 'house', s: 5, p: { f: 'north', q: 1 }, name: 'x' }));
    expect(extra).toEqual({ ok: true, build: { buildingTypeId: 'house', seed: 5, rerollCount: 0, params: { front: 'north' } }, warnings: ['Unbekannter Parameter „q“ ignoriert', 'Unbekanntes Feld „name“ ignoriert'] });
  });
});
