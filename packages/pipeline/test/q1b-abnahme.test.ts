/**
 * Q1b-Abnahme (Auftrag §Q1b, Ergänzung research/63): Küche, Bibliothek, Schmiede und Lager – je **klein** (9×8)
 * und **groß** (16×12) mit zwei festen Seeds. Geprüft wird der Weg, den der Nutzer wirklich geht (Pipeline):
 * das Projekt wird generiert und die Zusagen werden an der erzeugten Welt gemessen:
 *
 *  1. **keine Warnungen** (das schließt „Pflichtstation nicht platzierbar", „dunkle Zelle", „Tür blockiert" ein),
 *  2. **jede Pflicht-Familie des Raumtyps ist vertreten** (Pflichtstationen verschwinden nicht für Vielfalt),
 *  3. **jede begehbare Zelle hat Licht** (0 dunkle Zellen, 0 unter Ziel – Spawn-Schutz und Stimmung),
 *  4. **die freie Bodenfläche hängt zusammen und die Türzelle ist frei** – die harten Solver-Zusagen
 *     (`assertHardGuarantees` in `packages/furnishing/test/fixtures.ts`) werden hier nicht wiederholt, sondern
 *     über die Pipeline-Sicht geprüft: kein erzeugter Raum meldet einen Zugangs- oder Kollisionshinweis.
 *
 * Die Kennzahl I2 (Unterschied zweier Seeds) steht in `i2-variation.test.ts`.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { evalCount } from '@mcda/catalog';
import { generate } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const TYPEN = ['kitchen', 'library', 'smithy', 'storage'] as const;
const GROESSEN: readonly (readonly [number, number])[] = [[9, 8], [16, 12]];
const SEEDS = [1, 2] as const;

function raum(type: string, w: number, d: number, seed: number) {
  const p = Project.create({ id: 'q1b', name: 'Q1b', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  const world = generate(p, ctx);
  const room = p.state.rooms[0]!;
  return { project: p, world, room, info: world.shell.rooms.get(room.id)! };
}

describe('Q1b-Abnahme: Küche, Bibliothek, Schmiede, Lager (klein/groß × zwei Seeds)', () => {
  it('generiert ohne Warnungen, mit allen Pflicht-Familien und ohne dunkle Zellen', () => {
    const bericht: string[] = [];
    const fehler: string[] = [];
    for (const type of TYPEN) {
      for (const [w, d] of GROESSEN) {
        for (const seed of SEEDS) {
          const where = `${type} ${w}×${d} seed ${seed}`;
          const { project, world } = raum(type, w, d, seed);
          const rt = ctx.catalog.roomType(type);
          const tags = new Set(project.state.placements.flatMap((p) => ctx.catalog.get(p.componentId).tags));
          const fehlend = rt.required
            .filter((e) => evalCount(e.count, world.shell.rooms.get(project.state.rooms[0]!.id)!.interior.size)[0] > 0)
            .filter((e) => !e.tags.some((t) => tags.has(t)))
            .map((e) => e.tags.join('|'));
          const dunkel = world.materialized.light.darkCells.length;
          bericht.push(`${where}: ${project.state.placements.length} Möbel · Warnungen ${world.warnings.length} · dunkle Zellen ${dunkel}${fehlend.length > 0 ? ` · Pflicht fehlt: ${fehlend.join(', ')}` : ''}`);
          if (world.warnings.length > 0) fehler.push(`${where}: ${world.warnings.join(' | ')}`);
          if (fehlend.length > 0) fehler.push(`${where}: Pflicht-Familie fehlt (${fehlend.join(', ')})`);
          if (dunkel > 0) fehler.push(`${where}: ${dunkel} dunkle Zelle(n)`);
        }
      }
    }
    expect(fehler, `Q1b-Abnahme:\n${bericht.join('\n')}\n\nBefunde:\n${fehler.join('\n')}`).toEqual([]);
  });

  it('behält die Zugangszusage: der Raum meldet keinen Zugangs- oder Kollisionshinweis', () => {
    for (const type of TYPEN) {
      for (const [w, d] of GROESSEN) {
        for (const seed of SEEDS) {
          const { world } = raum(type, w, d, seed);
          const hart = world.materialized.violations.filter((v) => v.kind !== 'spawn');
          expect(hart, `${type} ${w}×${d} seed ${seed}: ${JSON.stringify(hart.slice(0, 2))}`).toEqual([]);
        }
      }
    }
  });
});
