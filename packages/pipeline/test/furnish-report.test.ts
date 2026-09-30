import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { furnishRoomsDetailed, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

describe('Einrichtung mit Dichte und Qualitätsbericht (für die UI)', () => {
  it('liefert je Raum eine Qualität 0–1', () => {
    const p = sampleHouse('1.21.11', 'medieval');
    const rep = furnishRoomsDetailed(p, shellFor(p), ctx.catalog);
    expect(rep.quality.size).toBe(p.state.rooms.length);
    for (const q of rep.quality.values()) {
      expect(q.score).toBeGreaterThanOrEqual(0);
      expect(q.score).toBeLessThanOrEqual(1);
    }
  });

  it('der Dichte-Regler beeinflusst die Anzahl optionaler Möbel', () => {
    const count = (density: number) => {
      const p = sampleHouse('1.21.11', 'medieval');
      furnishRoomsDetailed(p, shellFor(p), ctx.catalog, { density });
      return p.state.placements.length;
    };
    expect(count(0.2)).toBeLessThan(count(1.8));
  });
});
