/**
 * Vorkomprimieren im Build (W7-H): `.br` (Brotli 11) und `.gz` (gzip 9) neben jede Text-Datei ab 1 KiB, die dadurch
 * kleiner wird. Gleiche Endungen wie die Laufzeit-Komprimierung des Servers (site.ts), der die Dateien bevorzugt.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPRESSIBLE, PRECOMPRESSED_EXT } from '../../packages/engine/src/node/site.js';
import { PRECOMPRESS_EXT, PRECOMPRESS_MIN, SIDECAR, precompressDir } from '../scripts/precompress.mjs';

const tmp: string[] = [];
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'w7h-precompress-')); tmp.push(d); return d; };
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }); });

const text = (n: number): string => Array.from({ length: n }, (_, i) => `export const v${i} = { id: ${i}, name: "block_${(i * 7919) % 1000}" };`).join('\n');

describe('precompressDir', () => {
  it('gleiche Endungen und Sidecar-Namen wie der Server', () => {
    expect([...PRECOMPRESS_EXT].sort()).toEqual([...COMPRESSIBLE].sort());
    expect(SIDECAR).toEqual(PRECOMPRESSED_EXT);
    expect(PRECOMPRESS_MIN).toBe(1024);
  });

  it('Text ab 1 KiB → .br und .gz, entpackt gleich; Kleines, Binäres und Unkomprimierbares bleibt ohne', async () => {
    const dir = temp();
    const files: Record<string, string | Buffer> = {
      'editor/assets/index-X.js': text(3000),
      'editor/index.html': `<!doctype html>${'<p>Absatz</p>'.repeat(200)}`,
      'css/site.css': '.a{color:red}\n'.repeat(200),
      'ki/vocabulary.json': JSON.stringify({ names: Array.from({ length: 300 }, (_, i) => `name_${i}`) }),
      'media/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="1" height="1"/>'.repeat(100)}</svg>`,
      'klein.js': 'export const a = 1;',
      'media/bild.png': Buffer.alloc(8192, 0x41),
      'fonts/schrift.woff2': Buffer.alloc(8192, 0x41),
      'zufall.txt': randomBytes(4096),
    };
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(dir, p, '..'), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    const stats = await precompressDir(dir);
    const compressed = ['editor/assets/index-X.js', 'editor/index.html', 'css/site.css', 'ki/vocabulary.json', 'media/logo.svg'];
    for (const p of compressed) {
      const original = readFileSync(join(dir, p));
      const br = readFileSync(join(dir, p + '.br'));
      const gz = readFileSync(join(dir, p + '.gz'));
      expect(brotliDecompressSync(br).equals(original), p).toBe(true);
      expect(gunzipSync(gz).equals(original), p).toBe(true);
      expect(br.length, p).toBeLessThan(original.length);
      expect(br.length, p).toBeLessThanOrEqual(gz.length);
    }
    for (const p of ['klein.js', 'media/bild.png', 'fonts/schrift.woff2', 'zufall.txt']) {
      expect(existsSync(join(dir, p + '.br')), p).toBe(false);
      expect(existsSync(join(dir, p + '.gz')), p).toBe(false);
    }
    expect(stats).toMatchObject({ files: compressed.length, skipped: 1 });
    expect(stats.raw).toBe(compressed.reduce((s, p) => s + readFileSync(join(dir, p)).length, 0));

    // zweiter Lauf: keine .br.br/.gz.gz, gleiche Dateien
    const before = readdirSync(dir, { recursive: true }).sort();
    await precompressDir(dir);
    expect(readdirSync(dir, { recursive: true }).sort()).toEqual(before);
  });
});
