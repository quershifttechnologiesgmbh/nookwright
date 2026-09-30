/**
 * Fuzz BT01 Burg, kompakt (research/19 §3, §7.8) über `projectFromBuildingType` + `generateBase`: S/M/L × 20 Seeds,
 * Theme × Version reihum (`MCDA_FUZZ=full`: volle Matrix × 3 Themes × 2 Versionen). Hart wie bei A0 (0 harte
 * Verstöße, alle Räume über Türen/Treppen erreichbar, Pflichträume, Haus spawnsicher, Plan schnell), dazu je Welt:
 *  - Ensemble: Bergfried als eigener Baukörper mit Flachdach, höher als der Palas; Zinnenkranz (Wehrplatte) auf dem Dach,
 *    jede Seite spiegelsymmetrisch;
 *  - Ringmauer: ein Tor in der Achse der Haustür, ≥ 4 Türme, Treppenaufgang; Zwinger/Graben laut Plan; Hof als Zone;
 *  - keine Kollision Burg/Mauer/Gelände/Außen-Deko (keine Hinweise „überschneiden … entfallen“, kein Turm verdrängt,
 *    kein Aufgang ohne Platz);
 *  - begehbar in der fertigen Welt (Walker): von der Haustür in jeden Raum ohne Leiter, auf den ganzen Wehrgang (über die
 *    Treppe), durchs Tor bis an den Grundstücksrand.
 *  - W4-B (27.09.2026, Review S6): der Walker klettert Leitern – damit auch jedes Bergfried-Obergeschoss, die ganze
 *    Wehrplatte (Leiter + Luke aus dem Turmzimmer) und die Plattform jedes Mauerturms (Wendeltreppe) erreichbar: jede
 *    Plattform mit Brüstung ist von der Haustür zu Fuß erreichbar; keine Truhe unter einer Leiter.
 * Weich (Bericht, `MCDA_FUZZ_REPORT`): Silhouette (`ratio`, `partOverMain`), Hinweise.
 */
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reachableRooms, renderPlan, requiredMissing } from '@mcda/archetype';
import { DEFAULT_VOLUME, TARGET_VERSIONS, type Shell } from '@mcda/blueprint';
import type { BuildingSizeClass } from '@mcda/catalog';
import type { Cell, HorizontalDir, Vec3 } from '@mcda/core';
import { HEAVY_TIMEOUT, expectCpuBelow, hangTimeout, timeCpu } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { SEEDS, UNDERGROUND, ctx, loadType } from './buildingtype-fuzz.js';
import { Walker, standKey } from './walk.js';

const FULL = process.env['MCDA_FUZZ'] === 'full';
const REPORT = process.env['MCDA_FUZZ_REPORT'];
const COMBOS = (['medieval', 'nordic', 'rustic'] as const).flatMap((t) => (['1.21.11', '26.3'] as const).map((v) => [t, v] as const));
const STEP: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const def = loadType('castle_compact');

/** Standplatz vor der Haustür (draußen) und ihre Richtung. */
function frontDoor(shell: Shell): { stand: Vec3; cell: Cell; out: HorizontalDir } {
  for (const r of shell.rooms.values()) {
    const d = r.doors.find((x) => x.isMain);
    if (d === undefined) continue;
    const [sx, sz] = STEP[d.toward];
    return { stand: [d.inside[0] + 2 * sx, r.baseY, d.inside[1] + 2 * sz], cell: [d.inside[0] + sx, d.inside[1] + sz], out: d.toward };
  }
  throw new Error('keine Haustür');
}

function run(size: BuildingSizeClass, seed: number, theme: string, version: keyof typeof TARGET_VERSIONS): Record<string, unknown> {
  const where = `castle_compact ${size} Seed ${seed} ${theme} ${version}`;
  // Plan schnell: CPU-Zeit (Test-Helfer, robust gegen Fremdlast); Messwerte im Bericht ebenfalls CPU-ms
  const { result: res, ms: planMs } = expectCpuBelow(() => projectFromBuildingType(def, { size, themeId: theme, targetVersion: TARGET_VERSIONS[version], ...(UNDERGROUND ? { underground: true } : {}) }, seed, ctx), 2000, where);
  const { result: world, ms: worldMs } = timeCpu(() => generateBase(res.project, ctx, { ...res.build, ...res.surroundings }));
  const { plan, project } = res;
  const info = `${where}\n${renderPlan(plan)}`;

  // wie A0: Plan geprüft und schnell (oben beim Messen), Pflichträume, 0 harte Verstöße, erreichbar, Haus spawnsicher
  expect(plan.warnings, info).toEqual([]);
  if (UNDERGROUND) expect(plan.hints.filter((h) => h.startsWith('Unterbau')), where).toEqual([]);
  expect(requiredMissing(def, plan), where).toEqual([]);
  expect(project.state.rooms.length, where).toBe(plan.rooms.length);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, `${where}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
  const reach = reachableRooms(world.shell);
  expect(project.state.rooms.filter((r) => !reach.has(r.id)).map((r) => `${r.id} ${r.roomTypeId}`), where).toEqual([]);
  // spawnsicher: keine dunkle Zelle, auf der ein Monster stehen kann. Dunkle, nicht spawnfähige Taschen (z. B. eine von
  // der Einrichtung zugestellte Zelle im Kerker) sind ein Einrichtungs-Befund und stehen nur im Bericht
  const dark = world.materialized.light.darkCells;
  expect(dark.filter((c) => c.spawnable !== false), `${where}: Spawnstellen im Haus`).toEqual([]);

  // Ensemble: Bergfried eigener Baukörper, Flachdach, höher als der Palas
  const keep = plan.parts?.find((p) => p.id === 'keep');
  expect(keep, where).toBeDefined();
  expect(plan.volumes.find((v) => v.id === keep!.volumeId)?.roof, where).toBe('flat');
  const palasFloors = new Set(plan.rooms.filter((r) => r.volumeId === DEFAULT_VOLUME && r.floor >= 0).map((r) => r.floor)).size;
  expect(keep!.floors, where).toBeGreaterThanOrEqual(palasFloors + 3);

  // Bauwerke: Ring mit einem Tor in der Achse der Haustür, Türme, Aufgang; Wehrplatte
  const fort = world.surroundings.structures!;
  const door = frontDoor(world.shell);
  const ring = fort.walls.find((w) => w.id === 'fort:ring')!;
  expect(ring.gates, where).toHaveLength(1);
  const g = ring.gates[0]!;
  expect(door.out === 'north' || door.out === 'south' ? g.center[0] : g.center[1], `${where}: Tor in der Achse`).toBe(door.out === 'north' || door.out === 'south' ? door.cell[0] : door.cell[1]);
  expect(ring.towers.length, where).toBeGreaterThanOrEqual(4 + (plan.ring!.gate.gatehouse ? 2 : 0));
  expect(ring.stairs.length, where).toBe(1);
  expect(fort.walls.length, where).toBe(plan.ring!.outer !== undefined ? 2 : 1);
  const parapet = world.surroundings.cells.filter((c) => c.role === 'parapet' && c.roomId === 'fort:keep-parapet');
  expect(parapet.length, `${where}: Wehrplatte`).toBeGreaterThan(20);
  // Zinnen je Seite spiegelsymmetrisch (kein Windrad-Muster)
  const top = Math.max(...parapet.map((c) => c.pos[1]));
  const merlons = new Set(parapet.filter((c) => c.pos[1] === top).map((c) => `${c.pos[0]},${c.pos[2]}`));
  const xs = parapet.map((c) => c.pos[0]);
  const zs = parapet.map((c) => c.pos[2]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) expect(merlons.has(`${x},${z}`), `${where}: Zinne ${x},${z}`).toBe(merlons.has(`${x0 + x1 - x},${z}`));
  for (let z = z0; z <= z1; z++) for (const x of [x0, x1]) expect(merlons.has(`${x},${z}`), `${where}: Zinne ${x},${z}`).toBe(merlons.has(`${x},${z0 + z1 - z}`));

  // keine Kollision Burg/Mauer/Gelände/Außen-Deko
  const clash = world.warnings.filter((w) => /überschneiden|entfallen|kein Turm|kein Platz|nicht möglich|Mauerzellen/.test(w));
  expect(clash, where).toEqual([]);
  const siteState = res.surroundings.site!;
  expect(siteState.zones.some((z) => z.kind === 'yard'), `${where}: Hof`).toBe(true);
  expect(siteState.zones.some((z) => z.kind === 'pond'), `${where}: Graben`).toBe(plan.ring!.moat !== undefined);

  // begehbar: Haustür → Räume (W4-B: mit Leitern, also auch die Bergfried-Obergeschosse), Wehrgang, Wehrplatte, Tor,
  // Grundstücksrand
  const walker = new Walker(world.materialized.volume, ctx.platform(project.state.targetVersion.name), { climb: true });
  expect(walker.canStand(door.stand), `${where}: vor der Haustür`).toBe(true);
  const seen = walker.reach([door.stand]);
  for (const [id, r] of world.shell.rooms) {
    if (r.interior.toArray().some(([x, z]) => seen.has(standKey([x, r.baseY, z])))) continue;
    // Der Walker steigt Treppen nur mit Kopffreiheit über der nächsten Stufe hinab (konservativ): Keller gelten als
    // erreichbar, wenn man von dort zur Haustür hinaufkommt
    const inside = r.interior.toArray().map(([x, z]): Vec3 => [x, r.baseY, z]).find((p) => walker.canStand(p));
    expect(inside !== undefined && walker.reach([inside]).has(standKey(door.stand)), `${where}: Raum ${id} nicht begehbar erreichbar`).toBe(true);
  }
  for (const w of fort.walls) expect(w.walkway.filter((p) => !seen.has(standKey(p))).length, `${where}: Wehrgang ${w.id}`).toBe(0);
  // W4-B: Wehrplatte (Belag innerhalb der Brüstung) und Turmplattformen der Mauertürme ganz erreichbar
  const deck = world.surroundings.cells.filter((c) => c.roomId === 'fort:keep-parapet' && c.role === 'walkway')
    .map((c): Vec3 => [c.pos[0], c.pos[1] + 1, c.pos[2]]).filter((p) => walker.canStand(p));
  expect(deck.length, `${where}: Wehrplatte begehbar`).toBeGreaterThan(20);
  expect(deck.filter((p) => !seen.has(standKey(p))).length, `${where}: Wehrplatte erreichbar (Leiter + Luke)`).toBe(0);
  for (const t of fort.towers.filter((x) => x.top === 'battlements')) {
    expect(t.topStands.filter((p) => !seen.has(standKey(p))).length, `${where}: Plattform ${t.id}`).toBe(0);
  }
  // Mechanik (Faktencheck #2): keine Truhe unter einer Leiter
  const vol = world.materialized.volume;
  const chestUnderLadder = world.shell.cells.filter((c) => c.shape === 'ladder').filter((c) => {
    const b: Vec3 = [c.pos[0], c.pos[1] - 1, c.pos[2]];
    return vol.contains(b) && /chest$/.test(vol.stateAt(b).name);
  });
  expect(chestUnderLadder.map((c) => c.pos.join(',')), `${where}: Truhe unter Leiter`).toEqual([]);
  const plot = world.surroundings.site!.grid.plot;
  const border = [...seen].map((k) => k.split(',').map(Number)).filter(([x, , z]) => x === plot.minX || x === plot.maxX || z === plot.minZ || z === plot.maxZ);
  expect(border.length, `${where}: durchs Tor bis an den Grundstücksrand`).toBeGreaterThan(0);

  const furnish = world.warnings.filter((w) => /^r\d+ \(/.test(w));
  return {
    type: def.id, size, seed, theme, version, planMs: Math.round(planMs), worldMs: Math.round(worldMs), attempt: plan.attempt, rooms: plan.rooms.length, ...(plan.underground !== undefined ? { underground: plan.underground } : {}),
    keepFloors: keep!.floors, towers: ring.towers.length, gatehouse: plan.ring!.gate.gatehouse, outer: plan.ring!.outer !== undefined, moat: plan.ring!.moat !== undefined,
    quality: plan.quality.map((q) => `${q.id}=${q.value}${q.ok ? '' : '!'}`), hints: plan.hints.length, furnish, darkPockets: dark.length,
    other: world.warnings.filter((w) => !furnish.includes(w)),
  };
}

describe(`Bautyp castle_compact: Fuzz ${FULL ? 'volle Matrix' : 'Theme × Version reihum'} (Ensemble, Ringmauer, Gelände)`, () => {
  for (const [si, size] of (['S', 'M', 'L'] as const).entries()) {
    it(`${size}: ${SEEDS} Seeds – 0 harte Verstöße, alles erreichbar (Wehrgang, Tor), keine Kollision, spawnsicher`, { timeout: FULL ? hangTimeout(3_600_000) : HEAVY_TIMEOUT }, () => {
      for (let seed = 1; seed <= Number(process.env['BT01_SEEDS'] ?? SEEDS); seed++) {
        for (const [theme, version] of FULL ? COMBOS : [COMBOS[(seed + si * 2) % COMBOS.length]!]) {
          const m = run(size, seed, theme, version);
          if (REPORT !== undefined) appendFileSync(REPORT, `${JSON.stringify(m)}\n`);
        }
      }
    });
  }
});
