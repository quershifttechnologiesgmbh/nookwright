/**
 * I2 – Katalog-Feinschliff: explizite Signaturen (S2), Funktionszonen für Taverne und Bibliothek (S2),
 * ASCII-Glyphen der K2-Komponenten.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { furnishRoom, glyphFor, renderAscii, signatureEntries } from '@mcda/furnishing';
import { completeBase, furnishingGeometry, placedFor, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
/** Raumtypen vor der Funktions-Welle (K1/K2); neue Funktions-Raumtypen pflegt der Funktions-Agent. */
const EXISTING = ['alchemy', 'bedroom', 'kitchen', 'library', 'smithy', 'storage', 'tavern'];

describe('Raumtypen: Signatur explizit, Zonen für große Räume', () => {
  it('jeder bestehende Raumtyp markiert GENAU die bisherige Konventions-Signatur (erster Pflicht-Eintrag)', () => {
    for (const id of EXISTING) {
      const rt = ctx.catalog.roomType(id);
      const all = [...rt.required, ...rt.optional];
      expect(all.filter((e) => e.signature === true), id).toHaveLength(1);
      expect(rt.required[0]!.signature, id).toBe(true);
      expect([...signatureEntries(rt)], id).toEqual([0]);
    }
  });

  it('Taverne und Bibliothek haben benannte Zonen; jede genannte Zone existiert', () => {
    expect(ctx.catalog.roomType('tavern').zones).toEqual([{ id: 'bar', doorAffinity: 'far' }]);
    expect(ctx.catalog.roomType('library').zones).toEqual([{ id: 'study', doorAffinity: 'far' }]);
    for (const id of ['tavern', 'library']) {
      const rt = ctx.catalog.roomType(id);
      const zoned = [...rt.required, ...rt.optional].filter((e) => e.zone !== undefined);
      expect(zoned.length, id).toBeGreaterThanOrEqual(2);
      for (const e of zoned) expect(rt.zones!.map((z) => z.id), id).toContain(e.zone);
    }
  });

  it('Taverne der Beispiel-Base (12 × 9 innen): 2+ Zonen, Theke im Schankbereich fern der Haustür', () => {
    const base = completeBase('26.3', 'medieval');
    const shell = shellFor(base.project, base.options);
    const room = base.project.state.rooms.find((r) => r.roomTypeId === 'tavern')!;
    const geom = furnishingGeometry(shell.rooms.get(room.id)!);
    let far = 0;
    const seeds = [1, 2, 3, 4, 5, 6];
    for (const seed of seeds) {
      const r = furnishRoom(geom, ctx.catalog.roomType('tavern'), ctx.catalog, { seed, dataVersion: 4671 });
      expect(r.warnings, `seed ${seed}`).toEqual([]);
      expect(r.zones.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      const farZone = r.zones.reduce((m, z, i) => (z.dDoor > r.zones[m]!.dDoor ? i : m), 0);
      const bar = r.placements.findIndex((p) => ctx.catalog.get(p.componentId).tags.includes('bar_counter'));
      const cells = r.placed[bar]!.cells.filter((c) => c.pos[1] === geom.baseY);
      if (cells.filter((c) => r.zones[farZone]!.cells.has(c.pos[0], c.pos[2])).length * 2 >= cells.length) far++;
    }
    expect(far).toBeGreaterThanOrEqual(seeds.length - 1);
  });
});

describe('ASCII-Glyphen (K2-Wunsch)', () => {
  it('Tags aus dem K2-Wunsch bekommen ihre Glyphe', () => {
    const want: ReadonlyArray<readonly [string, string]> = [
      ['seat', 'h'], ['cabinet', 'w'], ['wall_weapons', '|'], ['music', 'M'], ['religious', '+'], ['clock', 'Ø'],
      ['mushrooms', 'p'], ['planter', 'p'], ['decor_ceiling', ','], ['outdoor', 'O'], ['workshop_prop', 'g'],
    ];
    for (const [tag, g] of want) expect(glyphFor([tag]), tag).toBe(g);
    expect(glyphFor(['unbekannt'])).toBe('?');
  });

  it('jede Nicht-Funktions-Komponente außer Tischdeko hat eine Glyphe (kein „?“ im Grundriss)', () => {
    const missing = ctx.catalog.all()
      .filter((d) => !d.id.startsWith('functional/') && !d.tags.includes('tabletop_small') && !d.tags.includes('alchemy_small') && !d.tags.includes('kitchen_utensil'))
      .filter((d) => glyphFor(d.tags) === '?')
      .map((d) => `${d.id} [${d.tags.join(',')}]`);
    expect(missing).toEqual([]);
  });

  it('Draufsicht der Taverne enthält keine „?“', () => {
    const base = completeBase('26.3', 'medieval');
    const shell = shellFor(base.project, base.options);
    const room = base.project.state.rooms.find((r) => r.roomTypeId === 'tavern')!;
    const geom = furnishingGeometry(shell.rooms.get(room.id)!);
    const r = furnishRoom(geom, ctx.catalog.roomType('tavern'), ctx.catalog, { seed: 3, dataVersion: 4671 });
    base.project.applyFurnishing(room.id, r.placements);
    const placed = base.project.state.placements.filter((p) => p.roomId === room.id).map((p) => placedFor(p, ctx.catalog));
    expect(renderAscii(geom, placed, (id) => ctx.catalog.get(id).tags)).not.toContain('?');
  });
});
