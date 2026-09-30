/**
 * Neuen API-Schlüssel für einen Client erzeugen: npm run keygen -w @mcda/engine -- <name> [--file <keys-datei>]
 * Gibt den Schlüssel EINMAL aus (nur jetzt sichtbar) und den Eintrag `name:sha256:<hex>`; mit `--file` wird nur der
 * Eintrag an die Datei angehängt (ENGINE_API_KEYS_FILE). Der Schlüssel selbst wird nirgends gespeichert.
 */
import { appendFileSync, chmodSync, existsSync } from 'node:fs';
import { apiKeyLine, generateApiKey } from '../src/node/auth.js';

const args = process.argv.slice(2);
const fileAt = args.indexOf('--file');
const file = fileAt >= 0 ? args[fileAt + 1] : undefined;
const name = args.filter((a, i) => !a.startsWith('--') && (fileAt < 0 || i !== fileAt + 1))[0];
if (name === undefined || (fileAt >= 0 && file === undefined)) {
  console.error('Aufruf: npm run keygen -w @mcda/engine -- <name> [--file <keys-datei>]');
  process.exit(2);
}
const key = generateApiKey();
const line = apiKeyLine(name, key);
if (file !== undefined) {
  const fresh = !existsSync(file);
  appendFileSync(file, `${line}\n`);
  if (fresh) chmodSync(file, 0o600);
  console.error(`Eintrag für '${name}' an ${file} angehängt.`);
} else {
  console.error(`Eintrag für ENGINE_API_KEYS bzw. ENGINE_API_KEYS_FILE:\n${line}`);
}
console.error('API-Schlüssel (nur jetzt sichtbar, sicher weitergeben):');
console.log(key);
