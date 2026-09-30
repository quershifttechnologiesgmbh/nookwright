/**
 * @mcda/structures – Bounded Context „Bauwerke/Befestigung“ (research/14, research/18 §5/Z2): gezeichneter
 * Mauerzug → Wehrmauer mit Wehrgang, Zinnen, Türmen, Toren, Treppen oder Gartenmauer mit Pfeilern;
 * freistehende Türme (Dachformen, Aussichts- und Glockenstube, Plattform), Windmühlen und angedockte Türme am Haus
 * (C4: Eck- und Treppenturm auf dem Anbau-Grundriss der Hülle, Wendel zu jeder Etagen-Tür). Rein und
 * deterministisch (Zufall nur aus dem Seed). Ausgabe: `ShellCell[]` mit `kind: 'fort'` und den Rollen des
 * Hüllen-Vertrags (wall_primary, foundation, beam, roof_main, door, parapet, walkway, tower_floor, arrow_slit,
 * wall_quoin, wall_cornice, sail, bell sowie light_outdoor, fence_outdoor, leaves_bush des Geländes);
 * materialisiert über `buildWorld(project, ctx, shell, result.cells)` bzw. `generateBase` im Anwendungsdienst.
 */
import { buildAnnexTower } from './annex.js';
import { buildBridge, walkwayIndex } from './bridge.js';
import { Site } from './canvas.js';
import { buildParapet } from './ring.js';
import { buildTower, towerFromSpec } from './tower.js';
import type { BridgeInfo, HeightField, StructureOptions, StructuresInput, StructuresResult, TowerInfo, TowerSpec, WallInfo, WallPlan, WindmillSpec } from './types.js';
import { buildWall } from './wall.js';
import { buildSiloOn } from './silo.js';
import { buildWindmillOn } from './windmill.js';

export * from './types.js';
export { floatingCells, reachableStands, standKey, CellIndex } from './analysis.js';
export { Polyline, footprintOffsets, inFootprint, roofRing } from './geometry.js';
export { towerFloors } from './tower.js';
export { SILO_DEFAULTS } from './silo.js';
export { annexContacts, annexFootprint, annexWallTop } from './annex.js';
export { roofLevel, roofProfile, towerRoof, type RoofBlock, type RoofProfile, type RoofSpec } from './roof.js';
export { ringAround, type Rect, type RingLayout, type RingSpec } from './ring.js';
export { BRIDGE_HEADROOM, BRIDGE_MAX_FREE_SPAN, BRIDGE_MAX_LENGTH, bridgeProfile, supportSlots } from './bridge.js';
export { CRENEL_WEIGHTS, crenelViolations, crenelWeights, isMerlon, palindromePairs, solveCrenels, type CrenelProblem, type CrenelTile, type CrenelWeights } from './crenel.js';

/** Ebenes Gelände: oberster Geländeblock bei `groundY` (Standard −1 → Sockel bei y = 0 wie die Hausplatte). */
export const flatGround = (groundY = -1): HeightField => ({ groundY: () => groundY });

/**
 * Baut alle Bauwerke eines Plans auf EINER Arbeitsfläche: zuerst freistehende Türme und Windmühlen, dann
 * Mauern (die vorhandenen Bauwerken ausweichen). Gleiche Eingabe + Seed → identische Zellen.
 * W4-B („Bergfried führt“, research/41, W3-CA §6): gibt es Wehrplatten mit Zinnenkranz, bleiben die Dächer der
 * Mauertürme samt Spitze unter der höchsten Zinne (`TowerPlan.maxTop`) – ohne Wehrplatte bitgleich.
 */
export function buildStructures(input: StructuresInput, opts: StructureOptions = {}): StructuresResult {
  const site = new Site(opts.ground ?? flatGround(), opts.seed ?? 0, opts.idPrefix ?? 'fort', opts.tiled);
  const towers: TowerInfo[] = [];
  const walls: WallInfo[] = [];
  (input.annexTowers ?? []).forEach((spec, i) => towers.push(buildAnnexTower(site, spec, i)));
  (input.parapets ?? []).forEach((spec, i) => buildParapet(site, spec, i));
  (input.towers ?? []).forEach((spec, i) => towers.push(buildTower(site, towerFromSpec(site, spec, i))));
  (input.windmills ?? []).forEach((spec, i) => towers.push(buildWindmillOn(site, spec, i)));
  (input.silos ?? []).forEach((spec, i) => buildSiloOn(site, spec, i));
  const crowns = (input.parapets ?? []).filter((p) => p.crown !== 'lookout' && p.cells.length > 0).map((p) => p.y + 2);
  const wallOpts = crowns.length > 0 ? { maxTop: Math.max(...crowns) - 1 } : {};
  (input.walls ?? []).forEach((plan, i) => {
    const r = buildWall(site, plan, i, wallOpts);
    walls.push(r.wall);
    towers.push(...r.towers);
  });
  // F-Ensemble: Brücken zuletzt (Wehrgang muss stehen); ohne Brücken fehlt das Feld (bitgleich)
  const bridges: BridgeInfo[] | undefined = input.bridges === undefined ? undefined : (() => {
    const walks = walkwayIndex(walls);
    return input.bridges.map((spec, i) => buildBridge(site, spec, i, walks));
  })();
  return {
    cells: site.canvas.cells(), towers, walls, footprint: site.footprint(), warnings: site.warnings, ...(bridges !== undefined ? { bridges } : {}),
    ...(site.tiled !== undefined ? { tiled: site.tiledLog } : {}),
  };
}

/** Kurzform: ein Mauerzug. */
export const buildWallStructure = (plan: WallPlan, opts?: StructureOptions): StructuresResult => buildStructures({ walls: [plan] }, opts);

/** Kurzform: ein freistehender Turm. */
export const buildTowerStructure = (spec: TowerSpec, opts?: StructureOptions): StructuresResult => buildStructures({ towers: [spec] }, opts);

/** Kurzform: eine Turmwindmühle (research/18 T6). */
export const buildWindmill = (spec: WindmillSpec, opts?: StructureOptions): StructuresResult => buildStructures({ windmills: [spec] }, opts);
