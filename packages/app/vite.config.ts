/// <reference types="node" />
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { compactJson5, isCatalogTextId } from './src/adapters/catalogText.js';

// Die Domänenpakete (@mcda/*) liegen als TypeScript-Quellen im Monorepo und werden von Vite direkt übersetzt.
// Der Katalog (../../catalog) wird per import.meta.glob gebündelt; server.fs.allow umfasst standardmäßig die Workspace-Wurzel.

const CATALOG_DIR = fileURLToPath(new URL('../../catalog/', import.meta.url));
const ASSET_ROOT = fileURLToPath(new URL('../../local/mc-assets/', import.meta.url));

/** Einzige Dateien je Version, die ausgeliefert werden (kein Verzeichnis-Listing, keine Unterpfade). */
const ASSET_FILES: Readonly<Record<string, string>> = {
  'atlas.png': 'image/png',
  'atlas.json': 'application/json',
  'blockstates.json': 'application/json',
  'models.json': 'application/json',
  'block-flags.json': 'application/json',
};

/** Versionen mit vollständiger Ausgabe von packages/viewer/scripts/extract-assets.ts. */
function assetVersions(): string[] {
  if (!existsSync(ASSET_ROOT)) return [];
  return readdirSync(ASSET_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[0-9][0-9a-z.\-]*$/i.test(d.name) && Object.keys(ASSET_FILES).every((f) => existsSync(join(ASSET_ROOT, d.name, f))))
    .map((d) => d.name)
    .sort();
}

/**
 * NUR `vite dev` (apply: 'serve'): Mojang-Assets aus `local/mc-assets/<version>/` (git-ignoriert, lokal mit dem
 * eigenen JAR erzeugt) unter `/mc-assets/…` für die Vorschau „Texturen“ – wie die Viewer-Demo. Der Build enthält
 * weder dieses Plugin noch eine dieser Dateien (research/08 §5: nie ausliefern). Kein `publicDir`-Eintrag.
 */
function localMinecraftAssets(): Plugin {
  return {
    name: 'mcda-local-minecraft-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/mc-assets', (req, res) => {
        res.setHeader('cache-control', 'no-store');
        const path = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (path === 'index.json') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ versions: assetVersions() }));
          return;
        }
        const m = /^([0-9][0-9a-z.\-]*)\/([a-z\-.]+)$/i.exec(path);
        const type = m !== null && Object.hasOwn(ASSET_FILES, m[2]!) ? ASSET_FILES[m[2]!] : undefined;
        const file = m === null ? undefined : join(ASSET_ROOT, m[1]!, m[2]!);
        if (type === undefined || file === undefined || !existsSync(file)) {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end('Nicht gefunden – lokale Assets erzeugen: npx tsx packages/viewer/scripts/extract-assets.ts');
          return;
        }
        res.setHeader('content-type', type);
        createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * NUR `vite build`: Katalogtexte (`catalog/**∕*.json5?raw`, gebündelt in `src/adapters/browserContext.ts`) als kompaktes
 * JSON statt mit Kommentaren und Einrückung (`compactJson5`: gleicher Wert, sonst Originaltext). Der Dev-Server und
 * Vitest lesen die Dateien unverändert.
 */
function compactCatalog(): Plugin {
  return {
    name: 'mcda-compact-catalog',
    apply: 'build',
    enforce: 'pre',
    async load(id) {
      if (!isCatalogTextId(id, CATALOG_DIR)) return null;
      const file = id.slice(0, id.indexOf('?'));
      return `export default ${JSON.stringify(compactJson5(await readFile(file, 'utf8')))};`;
    },
  };
}

/** Modul liegt in einem der Pakete unter node_modules (Pfadtrenner beider Systeme). */
const inPackages = (names: readonly string[]): RegExp => new RegExp(`[\\\\/]node_modules[\\\\/](?:${names.join('|')})[\\\\/]`);

/**
 * Engine-Server (`npm run serve -w @mcda/engine`, Standard Port 8787) unter `/engine/…` – „Beschreibe dein Gebäude“
 * ruft `/engine/v1/interpret`. Ziel über `ENGINE_URL`; ohne laufenden Server fällt die App auf den lokalen
 * Klassifikator zurück. Der Modell-Schlüssel bleibt im Engine-Server (nie im Browser, nie in `VITE_*`).
 */
const ENGINE_PROXY = {
  '/engine': {
    target: process.env['ENGINE_URL'] ?? 'http://127.0.0.1:8787',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/engine/, ''),
  },
};

export default defineConfig({
  plugins: [react(), localMinecraftAssets(), compactCatalog()],
  // Kein `define` für Node-Globals: Die Domänenpakete lesen kein `process` (Wächter packages/core/test/purity.test.ts,
  // Laufzeitnachweis packages/pipeline/test/no-node-globals.test.ts). Die frühere Absicherung von `Q3_PROBE` ist weg.
  server: {
    port: 5173,
    strictPort: true,
    // Vites /@fs/-Zugriff reicht bis zur Workspace-Wurzel; local/ (JAR, Assets) nur über die Middleware oben.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/local/mc-*/**'] },
    proxy: ENGINE_PROXY,
  },
  preview: { proxy: ENGINE_PROXY },
  // Der JAR-Worker (src/adapters/jarWorker.ts) ist ein ES-Modul-Worker. W14: Die Rechen-Worker (Spielbarkeit, Blöcke)
  // bündeln den Katalog selbst – ebenfalls als kompaktes JSON.
  worker: { format: 'es', plugins: () => [compactCatalog()] },
  build: {
    // W7-H: Start-Chunks nach Änderungshäufigkeit getrennt (plan/spikes/W7H_leistung.md). Alle Start-Chunks lädt index.html per
    // `modulepreload` parallel, der Start bleibt synchron. Bibliotheken ändern sich selten und bleiben über Deploys im
    // Cache (`editor/assets/` ein Jahr `immutable`); der Katalog ändert sich unabhängig vom Code. `$initial`: nur, was
    // der Start ohnehin braucht (deepslate u. a. bleiben im Lazy-Chunk „Texturen“).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'catalog', test: (id: string) => isCatalogTextId(id, CATALOG_DIR), priority: 40 },
            { name: 'react', test: inPackages(['react', 'react-dom', 'scheduler']), priority: 30, tags: ['$initial'] },
            { name: 'three', test: inPackages(['three']), priority: 20, tags: ['$initial'] },
            { name: 'vendor', test: inPackages(['[^\\\\/]+']), priority: 10, tags: ['$initial'] },
          ],
        },
      },
    },
    // größter Start-Chunk ist der App-Code (~1,1 MB roh); three allein ~700 kB
    chunkSizeWarningLimit: 1500,
  },
});
