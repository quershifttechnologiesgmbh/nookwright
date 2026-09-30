/**
 * API-Schlüssel der Clients (D1; nicht der Schlüssel des Modell-Anbieters). Gespeichert wird nur `name:sha256:<hex>`;
 * der Vergleich läuft über alle Einträge mit `timingSafeEqual`. Der Name ist der Mandant: Projekte gehören ihm
 * (Rotation: neuer Schlüssel mit gleichem Namen behält die Projekte).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface ApiKeyEntry {
  readonly name: string;
  readonly hash: Buffer;
}

export const KEY_PREFIX = 'eng_';
const NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** Neuer Schlüssel: 32 Zufallsbytes, base64url, mit Präfix. */
export const generateApiKey = (): string => `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;

const sha256 = (key: string): Buffer => createHash('sha256').update(key, 'utf8').digest();

/** Eintrag für die Schlüsselliste bzw. -datei. */
export function apiKeyLine(name: string, key: string): string {
  if (!NAME.test(name)) throw new Error(`Schlüsselname '${name}' ungültig (erlaubt: A–Z a–z 0–9 _ . -, bis 64 Zeichen)`);
  return `${name}:sha256:${sha256(key).toString('hex')}`;
}

/** Einträge `name:sha256:<hex>` getrennt durch Komma oder Zeilenumbruch; `#` leitet Kommentare ein. */
export function parseApiKeys(text: string): ApiKeyEntry[] {
  return text.split(/[\n,]/).map((l) => l.replace(/#.*$/, '').trim()).filter((l) => l !== '').map((l) => {
    const m = /^([^:]+):sha256:([0-9a-f]{64})$/i.exec(l);
    if (m === null || !NAME.test(m[1]!)) throw new Error(`API-Schlüssel-Eintrag ungültig (erwartet name:sha256:<64 hex>): '${l.slice(0, 24)}…'`);
    return { name: m[1]!, hash: Buffer.from(m[2]!, 'hex') };
  });
}

/** Aus `ENGINE_API_KEYS` (Liste) und `ENGINE_API_KEYS_FILE` (Datei, eine Zeile je Schlüssel). */
export function apiKeysFromEnv(env: NodeJS.ProcessEnv = process.env): ApiKeyEntry[] {
  const file = env['ENGINE_API_KEYS_FILE'];
  return [...parseApiKeys(env['ENGINE_API_KEYS'] ?? ''), ...(file !== undefined && file !== '' ? parseApiKeys(readFileSync(file, 'utf8')) : [])];
}

/** Mandant zum Header `Authorization: Bearer <key>`, sonst `undefined`. */
export function authenticate(header: string | undefined, keys: readonly ApiKeyEntry[]): string | undefined {
  const m = header === undefined ? null : /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (m === null) return undefined;
  const h = sha256(m[1]!);
  let found: string | undefined;
  for (const k of keys) if (timingSafeEqual(h, k.hash) && found === undefined) found = k.name;
  return found;
}
