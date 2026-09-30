/**
 * F-Determinismus (plan/spikes/F_determinismus.md): Gleiche Eingabe und gleicher Seed ergeben eine bitgleiche Welt –
 * auch bei wiederholten Aufrufen im selben Prozess und auf demselben Projekt.
 *
 * Befund (W13-A): Mit der Scheune links vom Wohnhaus lieferte `generateBase` (farmhouse M, Seed 3) bei jedem Aufruf eine
 * andere Welt. Ursache: Die Materialisierung mischte Rollen-Materialien und Truhen-Inhalte je Platzierung über deren
 * **ID** (`p${seq}`). `generateBase` richtet auf dem übergebenen Projekt ein, jeder Aufruf vergibt also neue IDs (der
 * Zähler läuft weiter) – dieselbe Einrichtung bekam andere Blöcke (hier ein Stein des Kamins: cracked_stone_bricks ↔
 * blackstone). Seit dem Fix zählt der Seed der Platzierung (aus Raum-Seed und Solver-Schlüssel), nicht ihre ID.
 *
 * Fuzz: alle Bautypen, je Typ Theme, Größe und Seed reihum; je Fall zwei Aufrufe auf demselben Projekt und ein Aufruf auf
 * einem frischen Projekt. Die Prüfsumme umfasst Blöcke, Zustände, Block-Entities (Truhen-Inhalte, Loot-Seeds) und
 * Entities.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BuildingTypeDef } from '@mcda/catalog';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

const json = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
const digest = (w: BaseWorld): string => {
  const h = createHash('sha1');
  for (const c of w.materialized.volume.cells()) {
    h.update(`${c.pos.join(',')}=${c.state.name}${JSON.stringify(c.state.properties)}${c.blockEntity !== undefined ? json(c.blockEntity) : ''};`);
  }
  for (const e of w.materialized.volume.entities()) h.update(json([e.pos, e.nbt]));
  return h.digest('hex');
};

/** Zwei Aufrufe auf demselben Projekt, ein Aufruf auf einem frischen – alle drei Prüfsummen. */
function threeRuns(def: BuildingTypeDef, size: string, themeId: string, seed: number): [string, string, string] {
  const make = () => projectFromBuildingType(def, { size: size as never, themeId }, seed, ctx);
  const a = make();
  const opts = { ...a.build, ...a.surroundings };
  const first = digest(generateBase(a.project, ctx, opts));
  const again = digest(generateBase(a.project, ctx, opts));
  const b = make();
  const fresh = digest(generateBase(b.project, ctx, { ...b.build, ...b.surroundings }));
  return [first, again, fresh];
}

describe('F-Determinismus: wiederholte Aufrufe im selben Prozess', () => {
  it('Befund W13-A: Bauernhaus M Seed 3 mit der Scheune links – zweiter Aufruf auf demselben Projekt bitgleich', { timeout: HEAVY_TIMEOUT }, () => {
    const base = ctx.buildingTypes.get('farmhouse');
    const barn = base.parts!['barn']!;
    const annex = base.parts!['annex']!;
    // Variante aus W13-A Runde 2 (Zwischenstand 24e47307): Scheune links, Anbau mittig hinten
    const def: BuildingTypeDef = {
      ...base,
      parts: {
        ...base.parts,
        barn: { ...barn, anchor: { ...barn.anchor!, side: 'left' } },
        annex: { ...annex, anchor: { ...annex.anchor!, align: 'center' } },
      },
    };
    const [first, again, fresh] = threeRuns(def, 'M', base.themes![0]!, 3);
    expect(again).toBe(first);
    expect(fresh).toBe(first);
  });

  it('Befund W15: Wachturm M medieval Seed 2026 (1.21.11) – drei Aufrufe auf demselben Projekt bitgleich', { timeout: HEAVY_TIMEOUT }, () => {
    // Vor dem Fix unterschieden sich Treppenblöcke im Innern (z. B. 4,5,3: spruce_stairs gegen dark_oak_stairs), weil die
    // Materialmischung der Möbel an der Platzierungs-ID hing (`spikes/w15/diff.mts`, plan/spikes/F_determinismus.md)
    const res = projectFromBuildingType(ctx.buildingTypes.get('watchtower'), { size: 'M', themeId: 'medieval', targetVersion: { name: '1.21.11', dataVersion: 4671 } }, 2026, ctx);
    const opts = { ...res.build, ...res.surroundings };
    const runs = [0, 1, 2].map(() => digest(generateBase(res.project, ctx, opts)));
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
  });

  it('Fuzz: alle Bautypen (Theme, Größe, Seed reihum) – zweimal auf demselben Projekt und frisch bitgleich', { timeout: HEAVY_TIMEOUT }, () => {
    const bad: string[] = [];
    const ids = [...ctx.buildingTypes.ids()].sort();
    ids.forEach((id, i) => {
      const def = ctx.buildingTypes.get(id);
      const sizes = Object.keys(def.sizes ?? { M: true });
      const size = sizes[i % sizes.length]!;
      const themes = def.themes ?? ctx.themes.ids();
      const themeId = themes[i % themes.length]!;
      const seed = 1 + (i % 5);
      const [first, again, fresh] = threeRuns(def, size, themeId, seed);
      if (again !== first || fresh !== first) bad.push(`${id} ${themeId} ${size} Seed ${seed}: ${first.slice(0, 8)} / ${again.slice(0, 8)} / ${fresh.slice(0, 8)}`);
    });
    expect(bad).toEqual([]);
  });
});
