/**
 * Rauchtest „läuft im Browser“ (W1-F): Die App erzeugt und materialisiert Welten im Browser. Dort gibt es kein
 * `process`, kein `Buffer`, kein `global` und kein `setImmediate`. Der Q3-Probe-Rest `process.env['Q3_PROBE']` in
 * `@mcda/terrain` brach dort jede Welt mit Gelände ab („Materialisierung fehlgeschlagen: Interner Fehler: process is
 * not defined“, gefunden von W1-E im Bautyp-Assistenten). Vite ersetzt `process.env['…']` nicht.
 *
 * Hier läuft der Weg des Assistenten (`projectFromBuildingType` mit Gelände-Vorlage → `generateBase`) in Node, aber mit
 * entfernten Node-Globals. Der Lauf ist synchron, Vitest braucht die Globals in dieser Zeit also nicht; danach kommen
 * sie unverändert zurück. Ergänzt den statischen Wächter `packages/core/test/purity.test.ts` um einen Laufzeitnachweis
 * über die ganze Kette (Gelände, Bauwerke, Außengestaltung, Licht, Materialisierung).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
/** Globals, die Node hat und der Browser nicht. */
const NODE_ONLY = ['process', 'Buffer', 'global', 'setImmediate', 'clearImmediate'] as const;

/** Führt `run` synchron ohne die Node-Globals aus und stellt sie danach wieder her. */
function withoutNodeGlobals<T>(run: () => T): { value?: T; error?: string; hidden: string[] } {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor>();
  for (const name of NODE_ONLY) {
    const d = Object.getOwnPropertyDescriptor(g, name);
    if (d === undefined) continue;
    saved.set(name, d);
    delete g[name];
  }
  const hidden = [...saved.keys()].filter((name) => !(name in g));
  try {
    return { value: run(), hidden };
  } catch (e) {
    return { error: `${(e as Error).name}: ${(e as Error).message}`, hidden };
  } finally {
    for (const [name, d] of saved) Object.defineProperty(g, name, d);
  }
}

describe('Welt mit Gelände ohne Node-Globals (wie im Browser)', () => {
  for (const [id, version] of [['farmhouse', '1.21.11'], ['tavern', '26.3']] as const) {
    it(`${id} mit Gelände-Vorlage, Minecraft ${version}`, { timeout: HEAVY_TIMEOUT }, () => {
      const def = ctx.buildingTypes.get(id);
      expect(def.site, `${id} bringt eine Gelände-Vorlage mit`).toBeDefined();
      // Katalog- und Plattformdaten lädt die App vorab; hier ebenso (Dateizugriff ist Sache des Adapters)
      ctx.platform(version);
      const res = projectFromBuildingType(def, { size: 'S', surroundings: true, targetVersion: TARGET_VERSIONS[version] }, 2026, ctx);
      const run = withoutNodeGlobals((): BaseWorld => generateBase(res.project, ctx, { ...res.build, ...res.surroundings }));
      expect(run.hidden, 'die Node-Globals waren während des Laufs wirklich weg').toEqual([...NODE_ONLY]);
      expect(run.error).toBeUndefined();
      const world = run.value!;
      expect(world.surroundings.site, 'Gelände erzeugt').toBeDefined();
      expect(world.materialized.volume.cells().next().done).toBe(false);
      expect(typeof process.env).toBe('object');
    });
  }
});
