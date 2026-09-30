// Galerie der Website neu erzeugen – ein Befehl, immer dieselben Schritte (z. B. nach Änderungen an Hülle oder Export):
//  1. Bauten mit der echten Pipeline: Szenen + Exportdateien (.litematic/.schem/.nbt) → website/gallery/  (build-gallery.ts)
//  2. Vorschaubilder → website/gallery/thumbs/                                                            (thumbs.mjs)
//  3. Prüfung: jede .litematic/.schem trägt den Pflicht-Hinweis (gallery-disclaimer.test.ts), Blockzahl und
//     Fingerabdruck je Bau = aktueller Generator (gallery-current.test.ts)
// Aufruf (Repo-Wurzel): PLAYWRIGHT_CORE=<pfad zu playwright-core> node website/scripts/gallery.mjs [--no-thumbs]
// Deterministisch: gleicher Stand → gleiche Bauten; danach `npm run web:build` und website/gallery committen.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCode, localBin } from './bin.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const step = (title, cmd, args) => {
  console.log(`\n▶ ${title}`);
  const r = spawnSync(cmd, args, { cwd: repo, stdio: 'inherit', env: process.env });
  if (r.status !== 0) { console.error(`✗ ${title} fehlgeschlagen`); process.exit(exitCode(r)); }
};

step('Bauten und Exportdateien', process.execPath, [localBin(repo, 'tsx'), join(repo, 'website/scripts/build-gallery.ts')]);
if (!process.argv.includes('--no-thumbs')) step('Vorschaubilder', process.execPath, [join(repo, 'website/scripts/thumbs.mjs')]);
step('Prüfung: Disclaimer in .litematic/.schem, Galerie = aktueller Generator', process.execPath, [localBin(repo, 'vitest'), 'run', 'website/test/gallery-disclaimer.test.ts', 'website/test/gallery-current.test.ts']);
console.log('\n✓ Galerie neu erzeugt und geprüft');
