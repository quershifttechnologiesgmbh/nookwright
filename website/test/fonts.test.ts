/**
 * Schriften der Website (SIL OFL 1.1): Lizenzdatei mit den Copyright-Zeilen aller drei Familien liegt im Repo, der Build
 * kopiert sie nach dist/fonts und dist/editor/assets und bricht ohne sie ab (Review R1-04).
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FONT_FILES, LICENSE_FILE, REQUIRED_COPYRIGHTS, checkFontLicense, copyFonts } from '../scripts/fonts.mjs';

const src = fileURLToPath(new URL('../../tools/public-support/fonts/', import.meta.url));
const tmp: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'w1b-fonts-')); tmp.push(d); return d; };
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('Lizenz der Schriften', () => {
  it('OFL.txt im Repo: SIL OFL 1.1 mit Copyright-Zeile je Familie', () => {
    const text = readFileSync(checkFontLicense(src), 'utf8');
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
    for (const c of REQUIRED_COPYRIGHTS) expect(text).toContain(c);
  });
  it('Build kopiert Schriften und Lizenz nach dist/fonts und in die Editor-Assets', () => {
    const out = temp();
    copyFonts({ srcDir: src, fontsOut: join(out, 'fonts'), licenseOut: [join(out, 'editor/assets')] });
    for (const [, to] of FONT_FILES) expect(existsSync(join(out, 'fonts', to))).toBe(true);
    expect(readFileSync(join(out, 'fonts', LICENSE_FILE), 'utf8')).toBe(readFileSync(join(src, LICENSE_FILE), 'utf8'));
    expect(existsSync(join(out, 'editor/assets', LICENSE_FILE))).toBe(true);
  });
  it('ohne Lizenzdatei oder ohne Copyright-Zeile bricht der Build ab', () => {
    const noLicense = temp();
    for (const [from] of FONT_FILES) copyFileSync(join(src, from), join(noLicense, from));
    expect(() => copyFonts({ srcDir: noLicense, fontsOut: join(noLicense, 'out') })).toThrow(/Lizenz der Schriften fehlt/);
    const partial = temp();
    const text = readFileSync(join(src, LICENSE_FILE), 'utf8').replace(REQUIRED_COPYRIGHTS[1]!, '');
    writeFileSync(join(partial, LICENSE_FILE), text);
    expect(() => checkFontLicense(partial)).toThrow(/Copyright-Zeile fehlt/);
  });
});
