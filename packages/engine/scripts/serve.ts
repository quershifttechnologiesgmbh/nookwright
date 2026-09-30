/**
 * Startet die Engine-API. Aufruf: npm run serve -w @mcda/engine [port]
 * NL-Steuerung (`POST /v1/prompt`, `/v1/interpret`): mit ENGINE_NL_API_KEY/OPENROUTER_API_KEY über JEV (Standard) bzw.
 * ENGINE_NL_MODEL, sonst lokaler Klassifikator.
 *
 * Betrieb (alle Variablen in .env.example): ENGINE_API_KEYS / ENGINE_API_KEYS_FILE (Hashes aus `npm run keygen`),
 * ohne Schlüssel lokaler Modus (nur 127.0.0.1). ENGINE_HOST, ENGINE_STORE_FILE (SQLite), ENGINE_PROJECT_TTL_DAYS,
 * ENGINE_MAX_PROJECTS, ENGINE_RATE_COMPUTE, ENGINE_RATE_NL, ENGINE_MAX_BODY, ENGINE_TRUST_PROXY, ENGINE_NL_LOG (off = aus).
 * Generierung im Worker-Pool: ENGINE_GENERATE_WORKERS (Standard min(2, CPUs − 1); 0 = synchron im Hauptthread),
 * ENGINE_GENERATE_TIMEOUT_MS (Standard 20000 → 504), ENGINE_GENERATE_QUEUE (wartende Aufträge, Standard 4 je Worker → 503).
 * SIGTERM/SIGINT: keine neuen Verbindungen, laufende Anfragen fertig (höchstens ENGINE_SHUTDOWN_MS), Speicher schließen.
 * Start, Umgebung und Herunterfahren teilt sich das Skript mit `web.ts` (`src/node/launch.ts`).
 */
import './env.js';
import { fileURLToPath } from 'node:url';
import { launchServer } from '../src/node/launch.js';

launchServer({
  title: 'Engine-API gestartet',
  defaultPort: 8787,
  promptLog: fileURLToPath(new URL('../out/prompts.jsonl', import.meta.url)),
});
