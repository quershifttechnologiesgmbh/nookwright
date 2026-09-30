/**
 * Fuzz je Bautyp (research/19 §7.8) über `projectFromBuildingType` + `generateBase`: Größen S/M/L × 20 Seeds ×
 * 3 Themes × 2 Zielversionen. Hart: 0 harte Physik-Verstöße, alle Räume erreichbar (Türen, Treppen), alle Pflichträume
 * vorhanden, Licht-Pass ohne Spawnstellen im Haus, Plan schnell (< 2 s unter Last). Weich (ADR 11, nur Bericht): Silhouette-Werte,
 * Hinweise der Einrichtung.
 *
 * Standard: jede Kombination Größe × Seed einmal, Theme × Version reihum (60 Welten je Bautyp). `MCDA_FUZZ=full`: die
 * volle Matrix (360 Welten je Bautyp). `MCDA_FUZZ_REPORT=<Datei>`: Messwerte als JSON-Zeilen anhängen.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reachableRooms, renderPlan, requiredMissing } from '@mcda/archetype';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { BUILDING_SIZES, parseBuildingTypeDef, type BuildingSizeClass, type BuildingTypeDef } from '@mcda/catalog';
import { HEAVY_TIMEOUT, expectCpuBelow, hangTimeout, timeCpu } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld, type BuildingTypeResult } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
export const ctx = nodeContext(ROOT);

const FULL = process.env['MCDA_FUZZ'] === 'full';
/** Feature Unterbau (feat/underground): `MCDA_UNDERGROUND=1` fährt den Fuzz mit eingeschaltetem Schalter. */
export const UNDERGROUND = process.env['MCDA_UNDERGROUND'] === '1';
const REPORT = process.env['MCDA_FUZZ_REPORT'];
const THEMES = ['medieval', 'nordic', 'rustic'] as const;
const VERSIONS = ['1.21.11', '26.3'] as const;
const COMBOS = THEMES.flatMap((t) => VERSIONS.map((v) => [t, v] as const));
export const SEEDS = 20;

export function loadType(id: string): BuildingTypeDef {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${id}.json5`, 'utf8'), `${id}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}

/** Zusätzliche Prüfung je Welt (additiv, z. B. Lage `buried`: Hügel dicht, Front frei). */
export type FuzzCheck = (world: BaseWorld, res: BuildingTypeResult, where: string) => void;

/** Eine Welt prüfen; Rückgabe: Messwerte für den Bericht. */
function run(def: BuildingTypeDef, size: BuildingSizeClass | undefined, seed: number, theme: string, version: keyof typeof TARGET_VERSIONS, check?: FuzzCheck): Record<string, unknown> {
  const where = `${def.id} ${size ?? '-'} Seed ${seed} ${theme} ${version}`;
  // Plan schnell: CPU-Zeit (Test-Helfer, robust gegen Fremdlast); Messwerte im Bericht ebenfalls CPU-ms
  const { result: res, ms: planMs } = expectCpuBelow(() => projectFromBuildingType(def, { ...(size !== undefined ? { size } : {}), themeId: theme, targetVersion: TARGET_VERSIONS[version], ...(UNDERGROUND ? { underground: true } : {}) }, seed, ctx), 2000, where);
  const { result: world, ms: worldMs } = timeCpu(() => generateBase(res.project, ctx, { ...res.build, ...res.surroundings }));
  const plan = res.plan;
  // Ziel < 1 s (Plan-Test in archetype, einzeln ≤ 0,25 s); Grenze hier 2 s, Prüfung oben beim Messen
  expect(plan.warnings, `${where}\n${renderPlan(plan)}`).toEqual([]);
  expect(requiredMissing(def, plan), where).toEqual([]);
  expect(res.project.state.rooms.length, where).toBe(plan.rooms.length);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, `${where}: ${JSON.stringify(hard.slice(0, 3))}\n${renderPlan(plan)}`).toEqual([]);
  const reach = reachableRooms(world.shell);
  expect(res.project.state.rooms.filter((r) => !reach.has(r.id)).map((r) => `${r.id} ${r.roomTypeId}`), where).toEqual([]);
  expect(world.materialized.light.darkCells.length, `${where}: Spawnstellen im Haus`).toBe(0);
  expect((world.lighting?.rooms ?? []).filter((r) => r.darkCells > 0).map((r) => r.roomId), where).toEqual([]);
  // W8-G (2026-09-27): der Windrad-Wächter hat alles behoben, was er fand (HANDOFF §1)
  expect((world.materialized.pinwheel?.unfixed ?? []).map((f) => `${f.plane} ${f.grouping}:${f.cls} ${f.cells[0]!.join(',')}`), `${where}: Windrad-Figur`).toEqual([]);
  if (UNDERGROUND) expect(plan.hints.filter((h) => h.startsWith('Unterbau')), where).toEqual([]);
  check?.(world, res, where);
  const furnish = world.warnings.filter((w) => /^r\d+ \(/.test(w));
  return {
    type: def.id, size: size ?? '-', seed, theme, version, planMs: Math.round(planMs), worldMs: Math.round(worldMs), attempt: plan.attempt,
    rooms: plan.rooms.length, ...(plan.underground !== undefined ? { underground: plan.underground } : {}), quality: plan.quality.map((q) => `${q.id}=${q.value}${q.ok ? '' : '!'}`), hints: plan.hints.length, furnish,
    other: world.warnings.filter((w) => !furnish.includes(w)),
  };
}

/** Fuzz-Tests eines Bautyps (feste Grundrisse: nur Seeds). */
export function fuzzType(id: string, check?: FuzzCheck): void {
  const def = loadType(id);
  const sizes: (BuildingSizeClass | undefined)[] = def.massing.generator === 'fixed' ? [undefined] : BUILDING_SIZES.filter((s) => def.sizes?.[s] !== undefined);
  describe(`Bautyp ${id}: Fuzz ${FULL ? 'volle Matrix' : 'Theme × Version reihum'} (projectFromBuildingType + generateBase)`, () => {
    for (const [si, size] of sizes.entries()) {
      it(`${size ?? 'fest'}: ${SEEDS} Seeds – 0 harte Verstöße, alles erreichbar, Pflichträume, Haus spawnsicher`, { timeout: FULL ? hangTimeout(1_800_000) : HEAVY_TIMEOUT }, () => {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const combos = FULL ? COMBOS : [COMBOS[(seed + si * 2) % COMBOS.length]!];
          for (const [theme, version] of combos) {
            const m = run(def, size, seed, theme, version, check);
            if (REPORT !== undefined) appendFileSync(REPORT, `${JSON.stringify(m)}\n`);
          }
        }
      });
    }
  });
}
