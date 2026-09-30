// Vorkomprimierte Text-Dateien für die Auslieferung (W7-H): neben jede komprimierbare Datei in dist/ legt der Build
// `<datei>.br` (Brotli 11) und `<datei>.gz` (gzip 9). Der Web-Server (packages/engine/src/node/site.ts) liefert sie
// bevorzugt aus – ohne Rechenzeit je Anfrage und kleiner als seine Laufzeit-Stufe (Brotli 7). Wer dist/ auf ein
// statisches Hosting legt, kann dieselben Dateien dort nutzen (z. B. nginx `brotli_static`/`gzip_static`).
// Getestet in website/test/precompress.test.ts.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as Z, gzip } from 'node:zlib';

/** Endungen, die vorkomprimiert werden – gleiche Liste wie `COMPRESSIBLE` in site.ts (Test prüft die Gleichheit). */
export const PRECOMPRESS_EXT = ['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt'];
/** Kleinere Dateien liefert der Server roh (wie `MIN_COMPRESS` in site.ts). */
export const PRECOMPRESS_MIN = 1024;
/** Endung der vorkomprimierten Datei je Kodierung (wie in site.ts). */
export const SIDECAR = { br: '.br', gzip: '.gz' };

/**
 * Schalter `WEB_PRECOMPRESS` (W8-V): `0`/`off`/`false` → keine Sidecars (Vercel komprimiert selbst und nutzt sie
 * nicht); fehlt oder sonst → an (Docker/`npm run web` unverändert).
 * @param {Record<string, string | undefined>} env
 */
export const precompressEnabled = (env) => !['0', 'off', 'false', 'no'].includes((env.WEB_PRECOMPRESS ?? '').trim().toLowerCase());

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Alle Dateien unter `dir` (rekursiv, ohne Symlinks zu folgen). */
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

/**
 * Legt `.br` und `.gz` neben jede komprimierbare Datei ab {@link PRECOMPRESS_MIN} Bytes in `dir` – nur, wenn sie
 * kleiner werden. Parallel über den libuv-Pool (zlib asynchron).
 * @param {string} dir
 * @returns {Promise<{ files: number, raw: number, br: number, gzip: number, skipped: number }>}
 */
export async function precompressDir(dir) {
  const stats = { files: 0, raw: 0, br: 0, gzip: 0, skipped: 0 };
  const jobs = [];
  for (const file of walk(dir)) {
    if (!PRECOMPRESS_EXT.includes(extname(file).toLowerCase())) continue;
    const size = statSync(file).size;
    if (size < PRECOMPRESS_MIN) continue;
    jobs.push((async () => {
      const raw = readFileSync(file);
      const [br, gz] = await Promise.all([
        brotliAsync(raw, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT, [Z.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
        gzipAsync(raw, { level: 9 }),
      ]);
      let wrote = false;
      if (br.length < raw.length) {
        writeFileSync(file + SIDECAR.br, br);
        stats.br += br.length;
        wrote = true;
      }
      if (gz.length < raw.length) {
        writeFileSync(file + SIDECAR.gzip, gz);
        stats.gzip += gz.length;
        wrote = true;
      }
      if (wrote) {
        stats.files += 1;
        stats.raw += raw.length;
      } else {
        stats.skipped += 1;
      }
    })());
  }
  await Promise.all(jobs);
  return stats;
}
