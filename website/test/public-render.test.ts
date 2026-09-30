/**
 * Öffentlicher Renderer (website/js: voxels.js, textures.js, stage.js) im Browser, W10-C: Feldfrüchte und andere
 * Kreuzpflanzen stehen im Foto-Look in Augenhöhe nicht mehr als schwarze Silhouetten da (Tag und Abend, von beiden
 * Seiten), und eine Szene ohne Pflanzen rendert bitgleich wie vorher (Pixel-Hash, SwiftShader).
 *
 * Braucht playwright-core mit Chromium (PLAYWRIGHT_CORE=…, sonst local/tools/node_modules/playwright-core); fehlt es,
 * wird der Test übersprungen. Prüfstand: website/test/render/harness.html.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../packages/core/test/support/slack.js';
// statischer Server über die Repo-Wurzel (reines ESM-Skript des Social-Kits)
import { serve } from '../../tools/public-support/scripts/serve.mjs';

const require = createRequire(import.meta.url);
const local = fileURLToPath(new URL('../../local/tools/node_modules/playwright-core', import.meta.url));
function playwright(): { chromium: { launch(o: object): Promise<Browser> } } | null {
  for (const p of [process.env.PLAYWRIGHT_CORE, existsSync(local) ? local : undefined, 'playwright-core']) {
    if (!p) continue;
    try { return require(p); } catch { /* nächster Kandidat */ }
  }
  return null;
}
interface Page { goto(u: string): Promise<unknown>; waitForFunction(f: string, a: null, o: object): Promise<unknown>; evaluate<T>(f: string): Promise<T> }
interface Browser { newPage(o: object): Promise<Page>; close(): Promise<void> }

/**
 * SHA-1 der Pixel der Haus-Szene (ohne Pflanzen), SwiftShader, 480 × 320. Ändert sich dieser Wert, hat sich das
 * Rendern von Nicht-Pflanzen geändert – absichtlich? Dann neu belegen und im Bericht nennen.
 * Verlauf: cdcf786f → Feldpflanzen-Fix (W10-C) unverändert 62106d75…/0474e9ca…; R6-1 (Tonwertkurve wie Golden,
 * Licht, Laternenmodell) bewusst neu belegt (4841c9d5…/896d2ef6…); W10-D (Kachelhelligkeit = Palettenfarbe, Gras wie
 * Golden, Himmelslicht nur auf das Umgebungslicht, Himmel ohne Tonwertkurve, Boden mit Grastextur, Geländerand ohne
 * Erdseiten) bewusst neu belegt. W13-D (Wolken, Sonne wärmer, mehr Himmelslicht, Farbabstimmung mit Lichter-Kurve) bewusst
 * neu belegt (vorher 30d814c4…/dce45155…). W16-A (Blockwolken, Himmel blauer, Wiese gelblicher mit Helligkeit je Block,
 * härtere Schatten, schwächere Vignette, ohne Baumreihe, Steinfase und hellere Fugen) bewusst neu belegt
 * (vorher 0e07773f…/9ad28c10…). Der Studio-Look bleibt bitgleich (spikes/w10d/studio.mjs).
 */
const HOUSE_DAY = 'd3425213d754840bd7a46c202bf289a1c0cf58e7';
const HOUSE_DUSK = 'cd2742fce28b5f29a450a08a8d8ebb820300f15e';
/**
 * Mindest-Luminanz der Pflanzenpixel (sRGB, 0..1) und höchster Anteil fast schwarzer Pixel (< 0,1). Vor W10-C:
 * von Norden 0,04 / 0,02 (94 – 97 % schwarz), Abend von Süden 0,14; danach Tag 0,49 / 0,57, Abend 0,27 / 0,33
 * (mit R6-1-Licht Tag 0,58 / 0,66, Abend 0,50 / 0,56).
 */
const MIN_LUM = { 0: 0.35, 1: 0.2 } as const;
const MAX_DARK = 0.12;

const pw = playwright();
describe.skipIf(pw === null)('öffentlicher Renderer: Kreuzpflanzen und Bitgleichheit', () => {
  let browser: Browser, page: Page, server: { close(): void };
  beforeAll(async () => {
    const port = 5100 + Math.floor(Math.random() * 400);
    server = await serve(port);
    browser = await pw!.chromium.launch({
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    });
    page = await browser.newPage({ viewport: { width: 480, height: 320 }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${port}/website/test/render/harness.html`);
    await page.waitForFunction('window.__ready === true', null, { timeout: HEAVY_TIMEOUT });
  }, HEAVY_TIMEOUT);
  afterAll(async () => { await browser?.close(); server?.close(); });

  it('Haus ohne Pflanzen: gleiche Pixel wie belegt, und zweimal gerendert gleich', { timeout: HEAVY_TIMEOUT }, async () => {
    const day = await page.evaluate<string>(`shotHash({ scene: 'house', dusk: 0, side: 1 })`);
    const dusk = await page.evaluate<string>(`shotHash({ scene: 'house', dusk: 1, side: 1 })`);
    expect(await page.evaluate<string>(`shotHash({ scene: 'house', dusk: 0, side: 1 })`)).toBe(day);
    expect({ day, dusk }).toEqual({ day: HOUSE_DAY, dusk: HOUSE_DUSK });
  });

  it('Qualität (W13-D): auto stuft bei langsamen Bildern herunter (high → medium → low), nie hinauf; high bleibt fest', { timeout: HEAVY_TIMEOUT }, async () => {
    const r = await page.evaluate<{ seen: string[]; fixed: string; samples: number; bloom: boolean; shadow: number }>(`(async () => {
      const S = await import('/website/js/stage.js');
      const st = S.createStage(document.createElement('canvas'), { look: 'photo', quality: 'auto', shadowSize: 2048 });
      const seen = [st.quality];
      for (let i = 0; i < 300; i++) { st.frame(60); if (seen[seen.length - 1] !== st.quality) seen.push(st.quality); }
      for (let i = 0; i < 300; i++) st.frame(5);
      seen.push(st.quality);
      const hi = S.createStage(document.createElement('canvas'), { look: 'photo' });
      for (let i = 0; i < 300; i++) hi.frame(60);
      const out = { seen, fixed: hi.quality, samples: st.composer.renderTarget1.samples, bloom: st.bloom.enabled, shadow: st.sun.shadow.mapSize.x };
      st.renderer.dispose(); hi.renderer.dispose();
      return out;
    })()`);
    expect(r).toEqual({ seen: ['high', 'medium', 'low', 'low'], fixed: 'high', samples: 0, bloom: false, shadow: 512 });
  });

  for (const [mood, dusk] of [['Tag', 0], ['Abend', 1]] as const) {
    for (const [from, side] of [['Süden', 1], ['Norden', -1]] as const) {
      it(`Feld (${mood}, von ${from}): Pflanzen hell, keine schwarzen Silhouetten`, { timeout: HEAVY_TIMEOUT }, async () => {
        const r = await page.evaluate<{ n: number; mean: number; dark: number }>(`plantLuminance({ scene: 'crops', dusk: ${dusk}, side: ${side} })`);
        expect(r.n).toBeGreaterThan(2000);
        expect(r.mean).toBeGreaterThan(MIN_LUM[dusk]);
        expect(r.dark).toBeLessThan(MAX_DARK);
      });
    }
  }
});
