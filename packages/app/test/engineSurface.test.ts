/**
 * ADR 12 – Jede Funktion der App ist über die Engine-API erreichbar oder als UI-Hilfe eingeordnet
 * (`APP_SURFACE` in @mcda/engine). Schlägt dieser Test fehl, hat die App eine neue Funktion (oder ein neues Modul)
 * ohne Gegenstück in der API: Operation/Befehl ergänzen und in `packages/engine/src/surface/app.ts` eintragen.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_MODULES_WITHOUT_USECASES, APP_SURFACE, APP_UI_FOLDERS, OPERATIONS, PROJECT_COMMANDS, SITE_COMMANDS } from '@mcda/engine';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const entries = readdirSync(SRC);
const modules = entries.filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => f.replace(/\.(ts|tsx)$/, ''));
const folders = entries.filter((f) => statSync(join(SRC, f)).isDirectory());

describe('App ↔ Engine-API', () => {
  it('jedes App-Modul und jeder Ordner ist eingeordnet', () => {
    const known = [...Object.keys(APP_SURFACE), ...Object.keys(APP_MODULES_WITHOUT_USECASES)];
    expect(modules.filter((m) => !known.includes(m)), 'neues App-Modul – in APP_SURFACE oder APP_MODULES_WITHOUT_USECASES eintragen').toEqual([]);
    expect(folders.filter((f) => APP_UI_FOLDERS[f] === undefined), 'neuer App-Ordner – in APP_UI_FOLDERS eintragen').toEqual([]);
  });

  for (const [mod, surface] of Object.entries(APP_SURFACE)) {
    it(`${mod}: jede exportierte Funktion ist zugeordnet`, async () => {
      const m = (await import(`../src/${mod}.ts`)) as Record<string, unknown>;
      const fns = Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
      expect(fns.filter((f) => surface[f] === undefined), `neue Funktion in ${mod} ohne API-Zuordnung`).toEqual([]);
      expect(Object.keys(surface).filter((f) => !fns.includes(f)), `in APP_SURFACE.${mod}, aber nicht mehr exportiert`).toEqual([]);
    });
  }

  it('Zuordnungen zeigen auf echte Operationen und Befehle', () => {
    const ops = OPERATIONS.map((o) => o.id);
    for (const [mod, surface] of Object.entries(APP_SURFACE)) {
      for (const [fn, e] of Object.entries(surface)) {
        if (!('op' in e)) continue;
        expect(ops, `${mod}.${fn}`).toContain(e.op);
        if (e.command !== undefined) {
          const table = (e.op === 'site_command' ? SITE_COMMANDS : PROJECT_COMMANDS) as Record<string, object>;
          expect(table[e.command], `${mod}.${fn} → ${e.op}.${e.command}`).toBeDefined();
          expect('excluded' in table[e.command]!, `${mod}.${fn}: Befehl ${e.command} ist ausgeschlossen`).toBe(false);
        }
      }
    }
  });
});
