// Schriften der Website und ihre Lizenz (SIL OFL 1.1) für den Build. Ohne Lizenzdatei kein Build: die OFL verlangt,
// dass der Lizenztext mit den Copyright-Zeilen jede Weitergabe der Schriften begleitet (auch das Editor-Bundle, das
// Inter und JetBrains Mono aus derselben Quelle einbindet). Getestet in website/test/fonts.test.ts.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Quelle → Name in dist/fonts (variable Schriften: eine Datei je Familie).
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const FONT_FILES = [['Unbounded-800.woff2', 'Unbounded.woff2'], ['Inter-500.woff2', 'Inter.woff2'], ['JetBrainsMono-600.woff2', 'JetBrainsMono.woff2']];
export const LICENSE_FILE = 'OFL.txt';
/** Copyright-Zeilen, die in der Lizenzdatei stehen müssen (aus den offiziellen Projekt-Repos). */
export const REQUIRED_COPYRIGHTS = [
  'The Unbounded Project Authors (https://github.com/googlefonts/unbounded)',
  'The Inter Project Authors (https://github.com/rsms/inter)',
  'The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)',
];

/**
 * Lizenzdatei prüfen: vorhanden, OFL 1.1, alle Copyright-Zeilen. Wirft mit Klartext.
 * @param {string} srcDir
 */
export function checkFontLicense(srcDir) {
  const file = join(srcDir, LICENSE_FILE);
  if (!existsSync(file)) throw new Error(`Lizenz der Schriften fehlt: ${file} (SIL OFL 1.1 mit Copyright-Zeilen je Familie)`);
  const text = readFileSync(file, 'utf8');
  if (!text.includes('SIL OPEN FONT LICENSE Version 1.1')) throw new Error(`${file}: kein Text der SIL Open Font License 1.1`);
  const missing = REQUIRED_COPYRIGHTS.filter((c) => !text.includes(c));
  if (missing.length > 0) throw new Error(`${file}: Copyright-Zeile fehlt für ${missing.join('; ')}`);
  return file;
}

/**
 * Schriften nach `fontsOut` und die Lizenz nach `fontsOut` und allen `licenseOut`-Ordnern kopieren (z. B.
 * dist/editor/assets, wo Vite die Schriften des Editors ablegt). Wirft, wenn Schrift oder Lizenz fehlt.
 * @param {{ srcDir: string, fontsOut: string, licenseOut?: string[] }} o
 */
export function copyFonts({ srcDir, fontsOut, licenseOut = [] }) {
  const license = checkFontLicense(srcDir);
  mkdirSync(fontsOut, { recursive: true });
  for (const [from, to] of FONT_FILES) {
    if (!existsSync(join(srcDir, from))) throw new Error(`Schrift fehlt: ${join(srcDir, from)}`);
    copyFileSync(join(srcDir, from), join(fontsOut, to));
  }
  for (const dir of [fontsOut, ...licenseOut]) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(license, join(dir, LICENSE_FILE));
  }
}
