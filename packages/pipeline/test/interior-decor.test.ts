/**
 * Innen-Deko-Pass (`interiorDecor`, feat/int-decor): Ohne Stufe bleibt alles wie zuvor (kein Eingriff, keine Deko-Platzierung);
 * mit Stufe kommen Dekostücke dazu – deterministisch, im Budget, ohne neue Warnungen, idempotent.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet, hashSeed } from '@mcda/core';
import { DECOR_RECIPES, decorBudget, decorRooms, generate } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const TYPES = ['bedroom', 'solar', 'tavern', 'library', 'entrance_hall', 'artisan_workshop'] as const;

function make(type: string, seed: number, level?: 'some' | 'rich', theme = 'medieval'): Project {
  const p = Project.create({ id: 'r', name: type, seed, themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 4 } });
  if (level !== undefined) p.setInteriorDecor(level);
  p.paintRoom(0, CellSet.rect(0, 0, 11, 8), type);
  p.paintRoom(0, CellSet.rect(0, 9, 11, 12), 'hallway');
  return p;
}

const digest = (p: Project): string => {
  const w = generate(p, ctx, { roof: 'gable' });
  const h = createHash('sha1');
  for (const c of w.materialized.volume.cells()) h.update(`${c.pos.join(',')}=${c.state.name}${JSON.stringify(c.state.properties)};`);
  return `${w.warnings.length}:${h.digest('hex')}`;
};

const isDecorPlacement = (p: Project, roomSeed: number): number => p.state.placements.filter((q) => {
  for (let i = 0; i < 16; i++) for (let j = 0; j < 20; j++) if (q.seed === hashSeed(roomSeed, 'decor', `deco${i}.${j}`)) return true;
  return false;
}).length;

describe('Innen-Deko', () => {
  it('ohne Stufe: kein Eingriff (Feld leer, Pass tut nichts)', () => {
    const p = make('bedroom', 1);
    expect(p.state.interiorDecor).toBeUndefined();
    digest(p);
    expect(p.state.placements.every((q) => q.seed !== undefined)).toBe(true);
    expect(decorRooms(p, undefined as never, ctx).rooms).toEqual([]);
  });

  it('jeder Raumtyp aus dem Test hat ein Rezept; Budget wächst mit Fläche und Stufe', () => {
    for (const t of TYPES) expect(DECOR_RECIPES[t], t).toBeDefined();
    expect(decorBudget('rich', 60)).toBeGreaterThan(decorBudget('some', 60));
    expect(decorBudget('rich', 200)).toBeLessThanOrEqual(16);
    expect(decorBudget('some', 4)).toBeGreaterThanOrEqual(1);
  });

  for (const type of TYPES) {
    it(`${type}: rich ergänzt Deko im Budget, deterministisch, ohne neue Warnungen`, () => {
      const seed = 3;
      const off = make(type, seed);
      const offDigest = digest(off);
      const a = make(type, seed, 'rich');
      const da = digest(a);
      const b = make(type, seed, 'rich');
      expect(digest(b)).toBe(da);
      const room = a.state.rooms.find((r) => r.roomTypeId === type)!;
      const added = isDecorPlacement(a, a.roomSeed(room.id));
      expect(added).toBeLessThanOrEqual(decorBudget('rich', 12 * 9));
      // ohne Stufe entstehen nie Deko-Platzierungen
      expect(isDecorPlacement(off, off.roomSeed(off.state.rooms.find((r) => r.roomTypeId === type)!.id))).toBe(0);
      // keine neuen Warnungen gegenüber dem Lauf ohne Deko
      expect(Number(da.split(':')[0])).toBeLessThanOrEqual(Number(offDigest.split(':')[0]));
    }, 60_000);
  }

  it('mindestens ein Raumtyp bekommt in rich sichtbar Deko (Blöcke ändern sich)', () => {
    let changed = 0;
    for (const t of TYPES) if (digest(make(t, 2)) !== digest(make(t, 2, 'rich'))) changed++;
    expect(changed).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('Erzeugen zweimal auf demselben Projekt ändert die Deko nicht (idempotent)', () => {
    const p = make('solar', 1, 'rich');
    const first = digest(p);
    const n = p.state.placements.length;
    expect(digest(p)).toBe(first);
    expect(p.state.placements.length).toBe(n);
  }, 60_000);

  it('andere Themes: nordic und gothic laufen ohne Fehler', () => {
    for (const theme of ['nordic', 'gothic']) expect(() => digest(make('library', 1, 'rich', theme))).not.toThrow();
  }, 60_000);
});
