/**
 * Startet die Web-App: gebaute Website (Startseite, Galerie, KI-Architekt, Editor unter `editor/`) und Engine-API
 * (`/v1/*`, `/healthz`) in EINEM Prozess auf EINEM Ursprung – der Browser erreicht JEV ohne CORS und ohne Vite-Proxy,
 * der Modell-Schlüssel bleibt im Server.
 *
 *   npm run web:build        # Wurzel: Website und Editor nach website/dist bauen
 *   npm run web [port]       # Wurzel; Port: argv[2] → ENGINE_PORT → 8080
 *
 * Zugriffsmodi (Einzelheiten `src/node/server.ts`, Variablen in .env.example):
 * - lokal (Standard: keine API-Schlüssel, ENGINE_WEB_PUBLIC nicht gesetzt): alles nur von 127.0.0.1, ohne Anmeldung.
 * - Schlüssel (ENGINE_API_KEYS/_FILE): Website und /healthz öffentlich, /v1 mit `Authorization: Bearer`.
 * - öffentlich (ENGINE_WEB_PUBLIC=1): Website öffentlich, nur POST /v1/interpret ohne Anmeldung und nur von der eigenen
 *   Seite (bzw. ENGINE_PUBLIC_ORIGINS), NL-Rate-Limit je IP, Tagesbudget ENGINE_WEB_NL_DAILY (mit Modell ohne Angabe
 *   300/Tag als Kostenbremse, `publicDailyBudget`); bindet dann auch ohne Schlüssel an 0.0.0.0. /healthz zeigt dort
 *   ohne Schlüssel nur `{ ok, auth: 'public' }`.
 * Website-Verzeichnis: ENGINE_WEB_DIR (Standard <repo>/website/dist). Prompt-Log (ENGINE_NL_LOG) hier standardmäßig
 * AUS – Beschreibungen von Besuchern sind personenbezogen; nur mit ausdrücklich gesetztem Pfad an.
 */
import './env.js';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dailyBudgetFromEnv } from '../src/node/config.js';
import { launchServer, logEvent } from '../src/node/launch.js';

const env = process.env;
const dir = resolve(env['ENGINE_WEB_DIR'] || fileURLToPath(new URL('../../../website/dist', import.meta.url)));
if (!existsSync(join(dir, 'index.html'))) {
  logEvent('error', 'Website nicht gebaut – erst `npm run web:build` ausführen (oder ENGINE_WEB_DIR auf ein gebautes Verzeichnis setzen)', { missing: join(dir, 'index.html') });
  process.exit(1);
}

const publicOrigins = (env['ENGINE_PUBLIC_ORIGINS'] ?? '').split(',').map((o) => o.trim()).filter((o) => o !== '');
for (const o of publicOrigins) {
  let origin: string | undefined;
  try {
    origin = new URL(o).origin;
  } catch {
    origin = undefined;
  }
  if (origin !== o) {
    logEvent('error', `ENGINE_PUBLIC_ORIGINS: '${o.slice(0, 100)}' ist kein Ursprung (Schema://Host[:Port], ohne Pfad und ohne / am Ende)`);
    process.exit(1);
  }
}

launchServer({
  title: 'Web-App gestartet',
  defaultPort: 8080,
  promptLog: 'off',
  web: {
    site: { dir },
    publicInterpret: env['ENGINE_WEB_PUBLIC'] === '1',
    publicOrigins,
    // fehlt → Standard je nach NL-Quelle (launch.ts: Kostenbremse mit Modell, unbegrenzt lokal)
    dailyBudget: dailyBudgetFromEnv(env),
  },
});
