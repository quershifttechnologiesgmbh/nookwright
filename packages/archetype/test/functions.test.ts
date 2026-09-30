/**
 * Funktionsgrad (W2-1) auf Plan-Ebene: `off` = bitgleicher Plan; `some`/`rich` = Funktionsräume aus der Katalogtabelle des
 * Bautyps, deterministisch, erreichbar (Türen, Treppen), mit wachsender Zahl je Größe und Stufe; Katalogtabellen sind gültig.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBuildingTypeDef, type BuildingSizeClass, type BuildingTypeDef, type FunctionLevel } from '@mcda/catalog';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import {
  FUNCTION_BUDGET, checkPlan, planBuilding, renderPlan, supportsFunctions, withFunctions, type ArchetypeContext,
} from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };
const TYPES: BuildingTypeDef[] = readdirSync(join(ROOT, 'buildingtypes')).filter((f) => f.endsWith('.json5')).map((f) => {
  const r = parseBuildingTypeDef(readFileSync(join(ROOT, 'buildingtypes', f), 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
});
const SUPPORTED = TYPES.filter(supportsFunctions);
const SEEDS = [11, 12, 13];
const LEVELS: Exclude<FunctionLevel, 'off'>[] = ['some', 'rich'];

/** Raumtypen aus den Funktionstabellen des Bautyps. */
const fnRooms = (def: BuildingTypeDef): Set<string> => new Set((def.functions ?? []).flatMap((e) => (typeof e.room === 'string' ? [e.room] : e.room)));
/** Anzahl der verwirklichten Funktions-Programmeinträge (hängen am Ende des Programms). */
const realizedFn = (def: BuildingTypeDef, plan: ReturnType<typeof planBuilding>): number => {
  const base = def.program?.length ?? 0;
  return new Set(plan.rooms.filter((r) => r.entry >= base).map((r) => r.entry)).size;
};

describe('Funktionsgrad: off ist bitgleich', () => {
  it('ohne Option und mit off ist der Plan derselbe (alle Bautypen)', () => {
    for (const def of TYPES) {
      for (const seed of SEEDS) {
        const plain = JSON.stringify(planBuilding(def, {}, seed, arch));
        expect(JSON.stringify(planBuilding(def, { functionLevel: 'off' }, seed, arch)), `${def.id} ${seed}`).toBe(plain);
        expect(planBuilding(def, {}, seed, arch).params.functionLevel, def.id).toBeUndefined();
      }
    }
  });

  it('withFunctions(off) ändert die Definition nicht', () => {
    for (const def of SUPPORTED) {
      const r = withFunctions(def, 'off', 'M', undefined, 5, 0);
      expect(r.def).toBe(def);
      expect(r.chosen).toEqual([]);
    }
  });

  it('Bautypen ohne Tabelle (und feste Grundrisse) planen mit Stufe wie ohne, nur der Hinweis kommt dazu', () => {
    for (const def of TYPES.filter((d) => !supportsFunctions(d))) {
      const plain = planBuilding(def, {}, 3, arch);
      const rich = planBuilding(def, { functionLevel: 'rich' }, 3, arch);
      expect(rich.rooms, def.id).toEqual(plain.rooms);
      expect(rich.hints.some((h) => h.startsWith('Funktionsgrad')), def.id).toBe(true);
    }
  });
});

describe('Funktionsgrad: Katalog', () => {
  it('mindestens sieben Bautypen haben eine Funktionstabelle mit bekannten Raumtypen', () => {
    expect(SUPPORTED.length).toBeGreaterThanOrEqual(7);
    const known = new Set(ctx.catalog.roomTypeIds());
    for (const def of SUPPORTED) for (const r of fnRooms(def)) expect(known.has(r), `${def.id}: ${r}`).toBe(true);
  });

  it('ungültige Tabellen werden abgelehnt (unbekannter Flügel oder Teil, Anteil > 1)', () => {
    const base = TYPES.find((d) => d.id === 'longhouse')!;
    const parse = (functions: unknown) => parseBuildingTypeDef(JSON.stringify({ ...base, functions }), 'x.json');
    expect(parse([{ room: 'storage_hall', wing: 'nope' }]).ok).toBe(false);
    expect(parse([{ room: 'storage_hall', part: 'nope' }]).ok).toBe(false);
    expect(parse([{ room: 'storage_hall', floor: 'ground', share: 5 }]).ok).toBe(false);
    expect(parse([{ room: 'storage_hall' }]).ok).toBe(true);
  });
});

describe('Funktionsgrad: Auswahl', () => {
  it('Größe und Stufe skalieren die Zahl gewählter Räume innerhalb des Budgets', () => {
    for (const def of SUPPORTED) {
      for (const size of Object.keys(def.sizes ?? {}) as BuildingSizeClass[]) {
        for (const seed of SEEDS) {
          for (const level of LEVELS) {
            const n = withFunctions(def, level, size, undefined, seed, 0).chosen.length;
            const [, hi] = FUNCTION_BUDGET[level][size];
            expect(n, `${def.id} ${size} ${level}`).toBeLessThanOrEqual(hi);
          }
        }
      }
    }
    for (const level of LEVELS) {
      expect(FUNCTION_BUDGET[level].L[1]).toBeGreaterThanOrEqual(FUNCTION_BUDGET[level].M[1]);
      expect(FUNCTION_BUDGET[level].M[1]).toBeGreaterThanOrEqual(FUNCTION_BUDGET[level].S[1]);
    }
    expect(FUNCTION_BUDGET.rich.M[1]).toBeGreaterThan(FUNCTION_BUDGET.some.M[1]);
    expect(FUNCTION_BUDGET.rich.L[0]).toBeGreaterThan(FUNCTION_BUDGET.some.L[0]);
  });

  it('rich wählt insgesamt mehr als some', () => {
    let some = 0;
    let rich = 0;
    for (const def of SUPPORTED) {
      for (let seed = 1; seed <= 10; seed++) {
        some += withFunctions(def, 'some', 'M', undefined, seed, 0).chosen.length;
        rich += withFunctions(def, 'rich', 'M', undefined, seed, 0).chosen.length;
      }
    }
    expect(rich).toBeGreaterThan(some);
  });

  it('gleicher Seed = gleiche Auswahl; anderer Seed streut', () => {
    for (const def of SUPPORTED) {
      const a = withFunctions(def, 'rich', 'M', undefined, 4, 0).chosen.map((e) => e.room);
      expect(withFunctions(def, 'rich', 'M', undefined, 4, 0).chosen.map((e) => e.room), def.id).toEqual(a);
    }
    const seen = new Set<string>();
    const tavern = TYPES.find((d) => d.id === 'tavern')!;
    for (let s = 1; s <= 30; s++) seen.add(JSON.stringify(withFunctions(tavern, 'some', 'M', undefined, s, 0).chosen.map((e) => e.room)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('Funktionsgrad: Pläne für alle unterstützten Bautypen × 3 Seeds × some/rich', () => {
  for (const def of SUPPORTED) {
    it(`${def.id}: Funktionsräume im Plan, deterministisch, erreichbar`, { timeout: HEAVY_TIMEOUT }, () => {
      let placedSome = 0;
      let placedRich = 0;
      for (const seed of SEEDS) {
        for (const level of LEVELS) {
          const where = `${def.id} Seed ${seed} ${level}`;
          const plan = planBuilding(def, { functionLevel: level }, seed, arch);
          expect(JSON.stringify(planBuilding(def, { functionLevel: level }, seed, arch)), where).toBe(JSON.stringify(plan));
          expect(plan.params.functionLevel, where).toBe(level);
          expect(plan.hints.some((h) => h.startsWith('Funktionsgrad')), where).toBe(true);
          // geprüft wie jeder Plan: übernehmbar, Hülle ohne Warnung, alles erreichbar (Türen und Treppen)
          expect(checkPlan(plan, () => 0).problems, `${where}\n${renderPlan(plan)}`).toEqual([]);
          const n = realizedFn(def, plan);
          const roomTypes = new Set(plan.rooms.map((r) => r.roomTypeId));
          if (n > 0) expect([...fnRooms(def)].some((r) => roomTypes.has(r)), where).toBe(true);
          if (level === 'some') placedSome += n; else placedRich += n;
        }
      }
      // über die Seeds kommen tatsächlich Funktionsräume in den Plan, und rich hat insgesamt nicht weniger
      expect(placedSome, def.id).toBeGreaterThan(0);
      expect(placedRich, def.id).toBeGreaterThanOrEqual(placedSome);
    });
  }
});
