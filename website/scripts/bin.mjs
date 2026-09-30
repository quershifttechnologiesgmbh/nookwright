// Lokale CLI eines Pakets aus node_modules direkt mit dem laufenden Node starten – statt `npx`: unter Windows ist
// `npx` eine .cmd-Datei, die spawnSync ohne Shell nicht findet (ENOENT). So läuft der Build auf allen Systemen gleich.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `[process.execPath, <Pfad zum bin-Skript>]` für `pkg` (bin-Eintrag `name`, sonst der einzige/erste). */
export function localBin(repo, pkg, name = pkg) {
  const dir = join(repo, 'node_modules', pkg);
  const { bin } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const rel = typeof bin === 'string' ? bin : bin?.[name] ?? Object.values(bin ?? {})[0];
  if (!rel) throw new Error(`${pkg}: kein bin-Eintrag in package.json`);
  return join(dir, rel);
}

/** Wie `spawnSync(cmd, args)`, aber meldet einen Startfehler (z. B. ENOENT) statt still mit Status null zu enden. */
export function exitCode(r) {
  if (r.error) console.error(r.error.message);
  return r.status ?? 1;
}

