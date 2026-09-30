/**
 * Eine Marke (W1, A6): Produktname an einer Stelle, kein „Arbeitstitel“ in der Oberfläche, Pflicht-Disclaimer wörtlich
 * (HANDOFF §1) in Statusleiste und Export-Dialog.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER, EDITOR_TITLE, PRODUCT_NAME } from '../src/brand.js';

const APP = fileURLToPath(new URL('..', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|html)$/.test(f) ? [p] : [];
  });
const sources = [...files(join(APP, 'src')), join(APP, 'index.html')];

describe('Marke', () => {
  it('Pflicht-Disclaimer wörtlich; Name ohne „Alchemist“, „Minecraft“ nicht vorne', () => {
    expect(DISCLAIMER).toBe('NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.');
    expect(PRODUCT_NAME).not.toMatch(/alchemist/i);
    expect(PRODUCT_NAME).not.toMatch(/^minecraft/i);
  });

  it('Fenstertitel aus dem Produktnamen', () => {
    const html = readFileSync(join(APP, 'index.html'), 'utf8');
    expect(EDITOR_TITLE).toBe(`Editor – ${PRODUCT_NAME}`);
    expect(html).toContain(`<title>${EDITOR_TITLE}</title>`);
  });

  it('kein „Arbeitstitel“ mehr in Oberfläche und index.html', () => {
    expect(sources.filter((f) => readFileSync(f, 'utf8').includes('Arbeitstitel')).map((f) => f.slice(APP.length))).toEqual([]);
  });

  it('Disclaimer-Text nur in brand.ts; Statusleiste, Export-Dialog und Dev-Galerie lesen ihn von dort', () => {
    const literal = sources.filter((f) => readFileSync(f, 'utf8').includes('NOT APPROVED BY OR ASSOCIATED')).map((f) => f.slice(APP.length));
    expect(literal).toEqual([join('src', 'brand.ts')]);
    for (const f of ['src/App.tsx', 'src/ui/ExportDialog.tsx', 'src/dev/Gallery.tsx']) expect(readFileSync(join(APP, f), 'utf8'), f).toContain('{DISCLAIMER}');
  });
});
