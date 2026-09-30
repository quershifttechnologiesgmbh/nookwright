import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nodeContext } from '../src/node-context.js';
import { furnishRooms, placedFor, shellFor, twoStoryHouse } from '../src/index.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/**
 * Befund A0 (Bautyp-Fuzz): Luftmasken (Front-Freiraum) und Entities (Rahmen) durften in Treppenloch bzw. über
 * Geländer zeigen, weil `furnishingGeometry` die gesperrten Spalten nicht an den Solver weitergab.
 */
describe('Einrichtung meidet Treppe, Deckenöffnung und Geländer auch mit Luft und Entities', () => {
  it('Zweistöcker, viele Seeds: keine Luftzelle und kein Rahmen in einer gesperrten Spalte', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const p = twoStoryHouse('1.21.11', 'medieval', seed);
      const shell = shellFor(p, { roof: 'gable' });
      furnishRooms(p, shell, ctx.catalog);
      for (const pl of p.state.placements) {
        const blocked = shell.rooms.get(pl.roomId)?.blocked;
        if (blocked === undefined || blocked.isEmpty) continue;
        const placed = placedFor(pl, ctx.catalog);
        for (const a of placed.air) expect(blocked.has(a[0], a[2]), `${pl.componentId} Luft ${a.join(',')} (Seed ${seed})`).toBe(false);
        for (const e of placed.entities) expect(blocked.has(Math.floor(e.pos[0]), Math.floor(e.pos[2])), `${pl.componentId} Entity (Seed ${seed})`).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
