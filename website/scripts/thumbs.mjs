// Vorschaubilder der Galerie: öffnet jede Detailseite, wartet, bis der Bau steht, und speichert gallery/thumbs/<id>.jpg.
// Braucht playwright-core (PLAYWRIGHT_CORE=…, optional CHROMIUM_PATH=…). Aufruf (Repo-Wurzel): node website/scripts/thumbs.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../../tools/public-support/scripts/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const site = fileURLToPath(new URL('..', import.meta.url));
const out = join(site, 'gallery/thumbs');
mkdirSync(out, { recursive: true });
const items = JSON.parse(readFileSync(join(site, 'gallery/index.json'), 'utf8'));
const only = process.argv[2];
/** Größe des Vorschaubilds (W16-A: 16 : 9) */
const THUMB = [960, 540];

const port = 4700 + Math.floor(Math.random() * 200);
const server = await serve(port);
// CHROMIUM_PATH: eigenes Chromium, falls der Browser-Cache nicht zur playwright-core-Version passt
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: THUMB[0] + 40, height: THUMB[1] + 40 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.addStyleTag({ content: '' }).catch(() => {});
for (const it of items) {
  if (only && it.id !== only) continue;
  await page.goto(`http://localhost:${port}/website/index.html?thumb#bau-${it.id}`);
  await page.waitForFunction(() => document.getElementById('detailLoading')?.hidden === true, null, { timeout: 600000 });
  // W16-A: Vorschaubild im Querformat 16 : 9 wie die Community-Screenshots (vorher 4 : 3 aus der Detailansicht); die
  // Kamera passt sich beim nächsten Bild an das neue Format an
  await page.addStyleTag({ content: `#detailViewer .controls, #detailViewer .play-hint { display: none !important; } #detailViewer { position: fixed !important; left: 0 !important; top: 0 !important; z-index: 99; border-radius: 0 !important; border: 0 !important; width: ${THUMB[0]}px !important; height: ${THUMB[1]}px !important; aspect-ratio: auto !important; max-width: none !important; }` });
  await page.waitForTimeout(4000); // Einpendeln der Kamera
  await page.locator('#detailViewer').screenshot({ path: join(out, `${it.id}.jpg`), type: 'jpeg', quality: 82, timeout: 300000 });
  console.log(it.id);
}
await browser.close();
server.close();
