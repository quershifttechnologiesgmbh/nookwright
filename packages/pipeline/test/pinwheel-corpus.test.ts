/**
 * W8-G (2026-09-27): keine Windrad-/Hakenkreuz-Figuren in der fertigen Welt (Projektregel HANDOFF §1). Der Wächter
 * der Materialisierung (`guardPinwheels`) behebt Funde; hier wird die fertige Welt unabhängig davon noch einmal ganz
 * abgesucht (`scanPinwheels`: Draufsicht, jede Schicht, jede senkrechte Ebene; je Block, Sichtklasse, Figur vor Boden).
 *
 * Standard: alle 12 Bautypen × alle 17 Themes, Seed reihum 1–10 (192 Welten) + Regressionen.
 * `MCDA_PINWHEEL=corpus`: volle Matrix mit 10 Seeds (1 440 Welten), `MCDA_PINWHEEL=full`: 20 Seeds (2 880 Welten).
 * W8-I (2026-09-27): Der Korpus verlangt zusätzlich `pinwheelRemoved = []` – Möbel-Figuren sind an der Quelle (Katalog,
 * spiegelsymmetrische Sockets) behoben, die Rückfall-Stufe belegt nur noch der alte chirale Tavernentisch.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { Catalog, parseComponentDef, type BuildingTypeDef, type ComponentDef, type SocketDef } from '@mcda/catalog';
import { HEAVY_TIMEOUT, hangTimeout } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld, type PipelineContext } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { worldFigures } from './pinwheelWorld.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const MODE = process.env['MCDA_PINWHEEL'];
const SEEDS = MODE === 'full' ? 20 : 10;
const MATRIX = MODE === 'full' || MODE === 'corpus';


// W9 (2026-09-27): W9-G3 (Scheune ab M, Hof) und W9-G1 (Querflügel) haben farmhouse/desert/19 verändert – das
// Dornbusch-Windrad bei (26, −12) entsteht dort nicht mehr. Neuer Fall derselben Quelle (Suche farmhouse/desert Seeds
// 1–40 ohne Wächter, `spikes/w9int/pw_search.mts`): Seed 5 (Dornbusch/Busch/Gras 5 × 5 bei x 44–48, z 9–13).
// W12-C (2026-09-28): Sichtkeil vor der Haustür (homestead) und die Bauernhof-Details verschieben die Streuung – in
// farmhouse/desert 1–60 entsteht ohne Wächter kein Pflanzen-Windrad mehr. Neuer Fall derselben Quelle (Suche farmhouse
// desert/rustic/farmstead 1–60): rustic Seed 48, Windrad aus Gras 4 × 4 bei x 44–47, z 28–31; der Wächter nimmt ein
// Grasbüschel weg.
// W13-A (2026-09-28): der Anbau am Wohnhaus (Komposition der Baumasse) verschiebt Hof und Streuung – mit ihm entsteht in
// farmhouse rustic/desert/farmstead/medieval 1–60 ohne Wächter keine Pflanzen-Figur mehr (auch watchtower/hobbit/tavern
// rustic/desert/farmstead 1–30 nicht; `spikes/w9int/pw_search.mts`). Der Fall bleibt derselbe: das Bauernhaus **ohne**
// Anbau (Stand W12-C, `sizes.*.parts` ohne `annex`; der Programm-Eintrag des Anbaus steht zuletzt, die Zufallsströme
// der übrigen sind gleich) baut bitgleich die Welt rustic/48 von vorher.
function build(type: string, themeId: string, seed: number, c: PipelineContext = ctx, def = ctx.buildingTypes.get(type)): { world: BaseWorld; version: string } {
  const res = projectFromBuildingType(def, { themeId, front: 'south' }, seed, ctx);
  return { world: generateBase(res.project, c, { ...res.build, ...res.surroundings }), version: res.project.state.targetVersion.name };
}

/**
 * Bauernhaus ohne Anbau (Stand W12-C): Ensemble-Teile aller Größen ohne `annex`. W16-B (2026-09-28): dazu ohne die
 * W16-B-Katalogfelder (Feld vor der Scheune, Silo ab M vorn, dunkles Scheunendach, Fenster-Pflicht der Küche) – mit
 * ihnen verschiebt sich die Streuung und das Gras-Windrad entsteht nicht; ohne sie ist die Welt bitgleich wie vorher
 * (reife Feldfrüchte ändern nur den Blockzustand der Früchte, nicht die Streuung).
 */
function farmhouseW12C(): BuildingTypeDef {
  const def = ctx.buildingTypes.get('farmhouse');
  const sizes = Object.fromEntries(Object.entries(def.sizes ?? {}).map(([k, v]) => [k, v === undefined ? v : { ...v, parts: (v.parts ?? []).filter((p) => p !== 'annex') }]));
  const parts = Object.fromEntries(Object.entries(def.parts ?? {}).map(([k, p]) => {
    if (p.exterior?.roof === undefined) return [k, p];
    const { roof: _roof, ...exterior } = p.exterior;
    return [k, { ...p, exterior }];
  }));
  const { zones: _zones, ...site } = def.site ?? {};
  const { lightRooms: _light, ...facade } = def.shell?.facade ?? {};
  const structures = def.structures?.silo === undefined ? def.structures : { ...def.structures, silo: { part: def.structures.silo.part, sizes: ['L' as const] } };
  return { ...def, sizes, parts, ...(def.site !== undefined ? { site } : {}), ...(def.shell !== undefined ? { shell: { ...def.shell, facade } } : {}), ...(structures !== undefined ? { structures } : {}) };
}

describe('W8-G Windrad-Wächter: Regression farmhouse/rustic/48 (Gras-Windrad der Vegetationsstreuung)', () => {
  it('ohne Wächter steht das Windrad bei (44…47, 28…31), mit Wächter ist es behoben und die Welt frei', { timeout: HEAVY_TIMEOUT }, () => {
    const raw = build('farmhouse', 'rustic', 48, { ...ctx, pinwheelGuard: false }, farmhouseW12C());
    const before = worldFigures(raw.world, ctx.platform(raw.version));
    expect(before.some((f) => f.startsWith('top block:short_grass 4×4'))).toBe(true);
    const { world, version } = build('farmhouse', 'rustic', 48, ctx, farmhouseW12C());
    const report = world.materialized.pinwheel!;
    expect(report.unfixed).toEqual([]);
    expect(report.fixes.filter((f) => f.from === 'short_grass').length).toBeGreaterThan(0);
    for (const f of report.fixes) {
      expect(f.to).toBe('air');
      expect(f.pos[0]).toBeGreaterThanOrEqual(44);
      expect(f.pos[0]).toBeLessThanOrEqual(47);
      expect(f.pos[2]).toBeGreaterThanOrEqual(28);
      expect(f.pos[2]).toBeLessThanOrEqual(31);
    }
    expect(worldFigures(world, ctx.platform(version))).toEqual([]);
  });
});

/**
 * W8-I (2026-09-27): Die Hocker-Sockets des Tavernentischs sind jetzt spiegelsymmetrisch (Katalog-Prüfung
 * `catalog/test/mirror-symmetry.test.ts`). Damit die Rückfall-Stufe des Wächters (eine Platzierung entfernen) weiter
 * belegt ist, baut dieser Kontext den **alten** chiralen Tisch nach: gleiche Ladereihenfolge wie `nodeContext`, nur
 * die Sockets s (1, 2) und w (−1, 1) wie vor W8-I.
 */
function chiralTavernContext(): typeof ctx {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
    });
  const OLD: Readonly<Record<string, readonly [number, number, number]>> = { s: [1, 0, 2], w: [-1, 0, 1] };
  const chiral = (sockets: readonly SocketDef[] | undefined): SocketDef[] | undefined =>
    sockets?.map((s) => (s.type === 'adjacent' && OLD[s.id] !== undefined ? { ...s, at: [...OLD[s.id]!] as [number, number, number] } : s));
  // FN (2026-09-29): ohne die neue Festtafel `table/fn_hall_table` (Tag `fn_hall_table`, Taverne) – sie verdrängt in der
  // Taverne den Tavernentisch, sonst greift die Rückfall-Stufe dieses Falls nicht mehr
  const defs = walk(join(ROOT, 'components')).filter((f) => !/fn_hall_table\.json5$/.test(f)).map((f) => {
    const r = parseComponentDef(readFileSync(f, 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const d = r.value;
    if (d.id !== 'table/tavern_table') return d;
    return { ...d, sockets: chiral(d.sockets), variants: d.variants?.map((v) => ({ ...v, sockets: chiral(v.sockets) })) } as ComponentDef;
  });
  const roomTypes = ctx.catalog.roomTypeIds().map((id) => ctx.catalog.roomType(id));
  return { ...ctx, catalog: Catalog.of(defs, roomTypes) };
}

describe('W8-I: Tavernentisch mit spiegelsymmetrischen Hockern (tavern L/rustic/6, vorher Windrad)', () => {
  it('ohne Rückfall: nichts entfernt, Welt frei, Tische mit Pflicht-Hockern n/s', { timeout: HEAVY_TIMEOUT }, () => {
    const res = projectFromBuildingType(ctx.buildingTypes.get('tavern'), { themeId: 'rustic', size: 'L', targetVersion: TARGET_VERSIONS['1.21.11'] }, 6, ctx);
    const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
    expect(world.pinwheelRemoved ?? []).toEqual([]);
    expect(world.materialized.pinwheel?.unfixed ?? []).toEqual([]);
    expect(worldFigures(world, ctx.platform(res.project.state.targetVersion.name))).toEqual([]);
    const tables = res.project.state.placements.filter((p) => p.componentId === 'table/tavern_table' && p.variantId === 'group');
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      const sockets = res.project.state.placements.filter((p) => p.parentId === t.id).map((p) => p.socketId);
      expect(sockets).toEqual(expect.arrayContaining(['n', 's']));
    }
  });
});

// FN-Integration (2026-09-29): Die dichten Innenräume der FN-Welle (Wohn-/Prunkräume, Ecknischen, Teppiche, Tische) haben die
// Einrichtung der Taverne verschoben; mit dem alten chiralen Tisch bildet tavern L/rustic/6 keine Möbel-Figur mehr
// (`pinwheelRemoved` bleibt leer). Gleicher Fall, anderer Seed: Suche tavern L/rustic Seeds 1–40 mit dem alten Tisch –
// Seed 15 und 19 lösen die Rückfall-Stufe genau einmal aus; genommen wird 15 (der Wächter entfernt einen optionalen Hocker).
describe('W8-G Windrad-Wächter: Möbel-Figur tavern L/rustic/15 mit dem alten, chiralen Tavernentisch (Rückfall-Stufe)', () => {
  it('ein optionaler Hocker entfällt aus der Einrichtung, Tisch und Pflicht-Hocker bleiben, Welt frei', { timeout: HEAVY_TIMEOUT }, () => {
    const old = chiralTavernContext();
    const res = projectFromBuildingType(ctx.buildingTypes.get('tavern'), { themeId: 'rustic', size: 'L', targetVersion: TARGET_VERSIONS['1.21.11'] }, 15, old);
    const world = generateBase(res.project, old, { ...res.build, ...res.surroundings });
    expect(world.pinwheelRemoved).toHaveLength(1);
    const gone = world.pinwheelRemoved![0]!;
    expect(res.project.state.placements.some((p) => p.id === gone)).toBe(false);
    expect(world.materialized.pinwheel?.unfixed ?? []).toEqual([]);
    expect(worldFigures(world, ctx.platform(res.project.state.targetVersion.name))).toEqual([]);
    // der Tisch hat noch seine Pflicht-Hocker (Sockets n und s)
    const tables = res.project.state.placements.filter((p) => p.componentId === 'table/tavern_table' && p.variantId === 'group');
    for (const t of tables) {
      const sockets = res.project.state.placements.filter((p) => p.parentId === t.id).map((p) => p.socketId);
      expect(sockets).toEqual(expect.arrayContaining(['n', 's']));
    }
  });
});

/**
 * W8-I: Welten, in denen die Rückfall-Stufe bekannt und begründet greift – Figuren aus **eigenständigen** Platzierungen
 * (keine Socket-Gruppe einer Komponente, im Katalog also nicht vermeidbar). Nur in der vollen Matrix erreichbar.
 *  - timber/desert/6: senkrechte Ebene x = 10, Klasse Holz, 8 Zellen über zwei Räume: Wandverkleidung (Pfosten,
 *    Krone, Sockel-/Paneel-Falltüren), Stufe + Knopf und die Treppe der Sitzgruppe `table/tea_table` (p66, entfernt).
 */
const KNOWN_FALLBACK: ReadonlySet<string> = new Set(['timber/desert/6']);

describe(`W8-G Windrad-Wächter: Korpus ${MATRIX ? `12 Bautypen × 17 Themes × ${SEEDS} Seeds` : '12 Bautypen × 17 Themes, Seed reihum'}`, () => {
  const types = [...ctx.buildingTypes.ids()];
  const themes = ctx.themes.ids();
  it('Bestand: 12 Bautypen, 17 Themes', () => {
    expect(types).toHaveLength(12);
    expect(themes).toHaveLength(17);
  });
  for (const [ti, type] of types.entries()) {
    it(`${type}: fertige Welt ohne Windrad-Figur`, { timeout: MATRIX ? hangTimeout(3_600_000) : HEAVY_TIMEOUT }, () => {
      const problems: string[] = [];
      for (const [hi, themeId] of themes.entries()) {
        const seeds = MATRIX ? Array.from({ length: SEEDS }, (_, i) => i + 1) : [1 + ((ti + hi) % 10)];
        for (const seed of seeds) {
          const { world, version } = build(type, themeId, seed);
          // W8-I: auch die Rückfall-Stufe (Platzierung entfernen) darf im Korpus nicht mehr greifen – Ziel 0
          const left = [
            ...(world.materialized.pinwheel?.unfixed ?? []).map((f) => `unbehoben ${f.plane} ${f.grouping}:${f.cls}`),
            ...(KNOWN_FALLBACK.has(`${type}/${themeId}/${seed}`) ? [] : (world.pinwheelRemoved ?? []).map((id) => `Rückfall entfernte ${id}`)),
            ...worldFigures(world, ctx.platform(version)),
          ];
          problems.push(...left.map((l) => `${type}/${themeId}/${seed}: ${l}`));
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
