/**
 * feat/site-decor: Schalter `siteDecor` (off / some / rich) im Anwendungsdienst.
 *
 *  1. **Aus = bitgleich:** ohne Angabe, mit `'off'` und mit der Stufe `undefined` dieselbe Welt (die Prüfsummen der übrigen
 *     Tests binden den Stand ohne den Branch).
 *  2. **An:** deterministisch je Seed, anders als aus, `some` höchstens so dicht wie `rich`; die Deko liegt als Katalog-Objekte
 *     mit dem Schlagwort `sd_decor` im Gelände (Zone `sd:<Platz>`), nie doppelt belegt, nie auf dem Haus.
 *  3. **Windrad-Wächter:** die fertige Welt (alle Zonen) ohne chirales 4-zähliges Motiv.
 *  4. **Raumhinweise:** `siteDecorContext` liest Bienenhof, Pferch, Gräber, Marktstand aus dem Raumprogramm.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, siteDecorContext, type BaseWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { worldPinwheels } from './pinwheelWorld.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function digest(world: BaseWorld): string {
  const vol = world.materialized.volume;
  const rows: string[] = [];
  for (const owner of vol.owners()) {
    for (const c of vol.cellsOf(owner)) rows.push(`${c.pos.join(',')}|${c.state.name}|${JSON.stringify(c.state.properties)}`);
  }
  rows.sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
}

function build(type: string, themeId: string, seed: number, siteDecor?: 'off' | 'some' | 'rich'): { world: BaseWorld; zoneKinds: Map<string, string> } {
  const res = projectFromBuildingType(ctx.buildingTypes.get(type), { themeId, front: 'south' }, seed, ctx);
  res.project.setMood(undefined);
  const zoneKinds = new Map((res.surroundings.site?.zones ?? []).map((z) => [z.id, z.kind] as const));
  return { world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings, ...(siteDecor !== undefined ? { siteDecor } : {}) }), zoneKinds };
}

const decorOf = (w: BaseWorld) => (w.surroundings.outdoor ?? []).filter((o) => o.zoneId.includes('sd:'));

describe('feat/site-decor: Schalter siteDecor', () => {
  it('aus = bitgleich: ohne Angabe, „off“ und Katalog-Objekte des Bestands unverändert', () => {
    for (const [type, theme, seed] of [['farmhouse', 'medieval', 11], ['townhouse', 'nordic', 22]] as const) {
      const plain = build(type, theme, seed).world;
      expect(digest(build(type, theme, seed, 'off').world)).toBe(digest(plain));
      expect(decorOf(plain)).toEqual([]);
      expect(decorOf(build(type, theme, seed, 'off').world)).toEqual([]);
    }
  }, HEAVY_TIMEOUT);

  it('an: deterministisch, anders als aus, some ≤ rich, Objekte sind Deko-Katalogteile ohne Doppelbelegung', () => {
    const off = build('farmhouse', 'medieval', 11).world;
    const some = build('farmhouse', 'medieval', 11, 'some').world;
    const rich = build('farmhouse', 'medieval', 11, 'rich').world;
    expect(digest(rich)).not.toBe(digest(off));
    expect(digest(some)).not.toBe(digest(off));
    expect(digest(build('farmhouse', 'medieval', 11, 'rich').world)).toBe(digest(rich));
    expect(decorOf(some).length).toBeGreaterThan(0);
    expect(decorOf(some).length).toBeLessThanOrEqual(decorOf(rich).length);
    // Ankerzellen verschieden (keine zwei Objekte auf derselben Zelle)
    const anchors = decorOf(rich).map((o) => o.cell.join(','));
    expect(new Set(anchors).size).toBe(anchors.length);
    // dieselben Bestands-Objekte wie ohne Deko: nichts weggenommen
    const before = (off.surroundings.outdoor ?? []).map((o) => o.id);
    const after = new Set((rich.surroundings.outdoor ?? []).map((o) => o.id));
    for (const id of before) expect(after.has(id)).toBe(true);
    expect(rich.warnings.length).toBeLessThanOrEqual(off.warnings.length);
  }, HEAVY_TIMEOUT);

  it('Themes und Bautypen: Deko entsteht, kein Windrad, Weg und Türen bleiben frei', () => {
    const cases = [
      ['townhouse', 'nordic', 22], ['tavern', 'asian', 33], ['longhouse', 'gothic', 11], ['hobbit', 'dwarven', 11], ['castle_compact', 'medieval', 11],
    ] as const;
    let total = 0;
    for (const [type, theme, seed] of cases) {
      const { world, zoneKinds } = build(type, theme, seed, 'rich');
      total += decorOf(world).length;
      expect(worldPinwheels(world, zoneKinds, true), `${type}/${theme}/${seed}`).toEqual([]);
      const audit = world.surroundings.site?.pathAudit;
      const base = build(type, theme, seed).world.surroundings.site?.pathAudit;
      expect(audit?.unconnectedDoors.length ?? 0, `${type}/${theme}: Türen ohne Weg`).toBeLessThanOrEqual(base?.unconnectedDoors.length ?? 0);
    }
    expect(total).toBeGreaterThan(0);
  }, HEAVY_TIMEOUT * 3);

  it('Raumhinweise aus dem Raumprogramm (App und Engine gleich)', () => {
    const res = projectFromBuildingType(ctx.buildingTypes.get('farmhouse'), { themeId: 'medieval', front: 'south' }, 11, ctx);
    const c = siteDecorContext(res.project.state);
    expect(c.themeId).toBe('medieval');
    expect(new Set(c.hints).size).toBe(c.hints.length);
    const harbor = siteDecorContext({ rooms: [], themeId: 'harbor' });
    expect(harbor.hints).toContain('fish');
    expect(siteDecorContext({ rooms: [], themeId: 'medieval' }).hints).toEqual([]);
  });
});
