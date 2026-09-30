/**
 * Q5/P15 in der App: Der Zustand erzählt dieselbe Geometrie anders. `packages/app/test/storyState.test.ts` prüft
 * Bedienung, Undo und Projektdatei; hier steht der zweite Teil des Auftrags: die Blockvorschau baut die Welt mit
 * demselben Zellen, aber anderen Blöcken neu (der Zustand wirkt in der Materialisierung, `@mcda/materialize`),
 * und ohne Zustand ist die Welt bitgleich.
 */
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { worldOf } from '../src/exporting.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;

/** Zellen-Signatur: Position und Blockname je Zelle, sortiert – Geometrie und Blöcke in einem Vergleich. */
function signature(world: { materialized: { volume: { cells(): Iterable<{ pos: readonly number[]; state: { name: string } }> } } }): string {
  return [...world.materialized.volume.cells()].map((c) => `${c.pos.join(',')}=${c.state.name}`).sort().join(';');
}

describe('Q5/P15: Welt-Neuaufbau je Nutzungszustand', () => {
  it('derselbe Grundriss, andere Blöcke – je Zustand eine andere Welt', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const before = sampleSession(catalog);
    const base = signature(worldOf(before.project, ctx));
    const verlassen = signature(worldOf(uc.setStoryState(before, catalog, 'verlassen').project, ctx));
    const verfallen = signature(worldOf(uc.setStoryState(before, catalog, 'verfallen').project, ctx));
    expect(verlassen).not.toBe(base);
    expect(verfallen).not.toBe(base);
    expect(verfallen).not.toBe(verlassen);
    // Die Spuren tauschen nur Blöcke der Hüllzellen: gleiche Zellen, gleiche Anzahl (story.ts ändert nie die Belegung)
    expect(verlassen.split(';').length).toBe(base.split(';').length);
    expect(verfallen.split(';').length).toBe(base.split(';').length);
  });

  it('„ohne“ wählt ab und ist bitgleich: dieselbe Welt wie ohne Zustand', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const before = sampleSession(catalog);
    const cleared = uc.setStoryState(uc.setStoryState(before, catalog, 'belagert'), catalog, undefined);
    expect(cleared.project.state.storyState).toBeUndefined();
    expect(signature(worldOf(cleared.project, ctx))).toBe(signature(worldOf(before.project, ctx)));
  });
});
