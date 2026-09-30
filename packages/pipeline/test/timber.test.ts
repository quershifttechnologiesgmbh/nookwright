/**
 * F1 Fachwerk über die ganze Pipeline: Theme `timber` am Beispielhaus, am Zweistöcker und am Gehöft (`homesteadBase`,
 * mit Gelände) mit allen 9 Dachformen – Einrichtung, Licht-Pass, Materialisierung in beiden Zielversionen:
 * 0 harte Verstöße (Physik, Masken, Treppenformen), Fachwerk sichtbar (Ständer, Streben, Gefach).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RoofStyle } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generate, generateBase, homesteadBase, sampleHouse, twoStoryHouse, type GeneratedWorld, type SampleVersion } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const ROOFS: readonly RoofStyle[] = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const VERSIONS: readonly SampleVersion[] = ['1.21.11', '26.3'];

const hard = (w: GeneratedWorld): string[] => w.materialized.violations.filter((v) => v.kind !== 'spawn').map((v) => `${v.kind}: ${v.message}`);

function count(w: GeneratedWorld, name: string): number {
  let n = 0;
  for (const c of w.materialized.volume.cells()) if (c.state.name === name) n++;
  return n;
}

describe('Theme timber über die Pipeline (alle 9 Dachformen)', () => {
  for (const version of VERSIONS) {
    it(`${version}: Beispielhaus, Zweistöcker, Gehöft – 0 harte Verstöße, Fachwerk sichtbar`, () => {
      for (const roof of ROOFS) {
        const worlds: Array<readonly [string, GeneratedWorld]> = [
          ['Beispielhaus', generate(sampleHouse(version, 'timber'), ctx, { roof })],
          ['Zweistöcker', generate(twoStoryHouse(version, 'timber'), ctx, { roof })],
        ];
        const base = homesteadBase(version, 'timber');
        worlds.push(['Gehöft', generateBase(base.project, ctx, { ...base.options, roof })]);
        for (const [name, w] of worlds) {
          const where = `${version} ${roof} ${name}`;
          expect(hard(w), where).toEqual([]);
          expect(count(w, 'dark_oak_log'), where).toBeGreaterThan(20); // Ständer, Schwelle, Rähm
          expect(count(w, 'calcite') + count(w, 'white_terracotta') + count(w, 'mushroom_stem'), where).toBeGreaterThan(20); // Gefach
          if (roof !== 'flat') expect(count(w, 'dark_oak_wood'), where).toBeGreaterThan(0); // Streben/Eckholz
        }
      }
    }, HEAVY_TIMEOUT);
  }
});
