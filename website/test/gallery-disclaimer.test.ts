/**
 * Galerie der Website (website/gallery, erzeugt von website/scripts/build-gallery.ts): Jede angebotene `.litematic`- und
 * `.schem`-Datei trägt den Pflicht-Hinweis aus HANDOFF §1 in der Datei (Review R1-03). `.nbt` bleibt bewusst ohne:
 * das Vanilla-Strukturformat hat kein Textfeld, ein Zusatz-Tag ist für 1.21.11/26.3 nicht belegt
 * (plan/spikes/W1H_export_disclaimer.md).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EXPORT_DISCLAIMER } from '../../packages/pipeline/src/disclaimer.js';

const dir = fileURLToPath(new URL('../gallery/', import.meta.url));
const files = readdirSync(join(dir, 'files'));
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Array<{ id: string; files: Record<string, number> }>;
const needle = Buffer.from(EXPORT_DISCLAIMER, 'utf8');

describe('Galerie-Exporte', () => {
  it('jeder Bau im Index hat alle drei Dateien mit der angegebenen Größe', () => {
    expect(index.length).toBeGreaterThan(0);
    for (const it of index) {
      for (const fmt of ['litematic', 'schem', 'nbt']) {
        const f = join(dir, 'files', `${it.id}.${fmt}`);
        expect(existsSync(f), f).toBe(true);
        expect(readFileSync(f).length, f).toBe(it.files[fmt]);
      }
    }
  });
  for (const f of files.filter((n) => /\.(litematic|schem)$/.test(n))) {
    it(`${f}: Disclaimer in der Datei`, () => {
      const nbt = gunzipSync(readFileSync(join(dir, 'files', f)));
      expect(nbt.includes(needle)).toBe(true);
    });
  }
  it('.nbt: gültige GZip-Datei, bewusst ohne Disclaimer-Feld', () => {
    const nbts = files.filter((n) => n.endsWith('.nbt'));
    expect(nbts.length).toBe(index.length);
    for (const f of nbts) expect(gunzipSync(readFileSync(join(dir, 'files', f))).includes(needle)).toBe(false);
  });
});
