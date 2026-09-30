/**
 * Materialisierung (Domain Design §4.2, plan/01 §6 Schritte 4–8 + 10):
 *   Hülle + platzierte Komponenten → Kontext (4a) → Flächen-Muster (4b) → Theme-Auflösung mit Verlauf,
 *   Mischung und Cluster-Rauschen (4c) → Verwitterung als Variantenwechsel (9a) → Story-Spuren (Q5/P15,
 *   `story.ts`, nur mit `storyState`) → Orientierung
 *   → Registry-Validierung → Merge nach Schichten (voxel) → Autotiling (inkl. Vanilla-Update-Regeln, vanilla.ts)
 *   → Physik (inkl. hängende Entities, hanging.ts) → Licht/Spawn → VoxelVolume.
 *
 * Auflösungsfehler (unbekannte Rolle/Form, unpassende Ausrichtung, ungültiger State) werden gesammelt
 * und als EIN `MaterializeError` geworfen. Merge-Verstöße wirft `@mcda/voxel` (MergeViolationError).
 * Physik- und Licht-Befunde sind Daten (`violations`), keine Ausnahmen.
 */
import type { ShellCell, ShellOrient } from '@mcda/blueprint';
import type { MaterialSpec } from '@mcda/catalog';
import { hashSeed, key3, type Vec3 } from '@mcda/core';
import type { NbtCompound } from '@mcda/export';
import { formatState, type Registry } from '@mcda/platform';
import { Layer, VoxelVolume, blockState, isAir, type BlockState, type Permit } from '@mcda/voxel';
import { checkPairs, pairChests, resolveConnections, resolveStairs } from './autotile.js';
import { blockEntityFor, blockEntityId, entityFor } from './contents.js';
import { KindIndex, type BlockKind } from './kinds.js';
import { computeLight, spawnReport } from './light.js';
import { NEEDS_FACING, REQUIRED_PROPS, orientProps, shellOrientProps, transformRawState, worldOrient, type Props } from './orient.js';
import { checkMasks, checkSupport } from './physics.js';
import { guardPinwheels } from './pinwheel-guard.js';
import { checkPistons, resolveRedstoneWires } from './redstone.js';
import { checkHangingEntities } from './hanging.js';
import { resolveVanillaUpdates } from './vanilla.js';
import { banIndexOf } from './banned.js';
import { pickPlaneOf, wallBehindAt, wallHeightParam } from './attributes.js';
import { shellContext, colKey, type CellContext } from './context.js';
import { effectiveShellRole } from './shell-shapes.js';
import { applySurfaces } from './surfaces.js';
import { ThemeResolver, mixSeed } from './theme-resolve.js';
import { weatherCell, weatheringSettings } from './weathering.js';
import { storyWeatherCell, STORY_PROFILES } from './story.js';
import { applyNarrativeWeathering, type NarrativeWeatheringStats } from './narrative-weathering.js';
import { applySurfaceTexture, type SurfaceTextureStats } from './surface-texture.js';
import { applySnowCover, planSnowCover, snowCoverSettings, type SnowCandidate } from './snow.js';
import { planRuin, protectedByComponents, ruinSettings, type RuinRemoval } from './ruin.js';
import { applyTurfRoof, planTurfRoof, turfBounds, turfRoofSettings, type TurfBlocks, type TurfCandidate } from './turf.js';
import { applyLining, type LiningSpec } from './lining.js';
import {
  MaterializeError, type LightReport, type MaterialResolution, type MaterializeInput, type MaterializePlacement,
  type MaterializeResult, type Violation,
} from './types.js';
import { WorldView } from './world.js';

interface Job {
  readonly pos: Vec3;
  readonly state: BlockState;
  readonly owner: string;
  readonly layer: Layer;
  /** Theme-Rolle der Zelle (für die gemessene Palette); Komponenten ohne Rolle: undefined. */
  readonly role?: string;
  readonly permit?: Permit;
  readonly blockEntity?: NbtCompound;
  /** true: Zelle stammt aus der Hülle (nur sie darf die Ruine erodieren). */
  readonly shell?: boolean;
}

interface EntityJob {
  readonly pos: Vec3;
  readonly blockPos: Vec3;
  readonly nbt: NbtCompound;
  readonly owner: string;
}

const ARCHITECTURE_KINDS: ReadonlySet<ShellCell['kind']> = new Set(['door', 'window']);

/** W16-B: höchste Wachstumsstufe der Feldfrüchte (Minecraft `age`). */
const RIPE_AGE: Readonly<Record<string, string>> = { wheat: '7', carrots: '7', potatoes: '7', beetroots: '3' };

/** Vollständiger, gültiger State: Registry-Prüfung, Pflicht-Ausrichtung, Defaults auffüllen. */
export function finalizeState(registry: Registry, name: string, kind: BlockKind, props: Props, where: string): BlockState {
  // Blätter zerfallen sonst (Faktencheck 17): immer persistent, außer ausdrücklich anders gesetzt.
  if (name.endsWith('_leaves') && props['persistent'] === undefined) props = { ...props, persistent: 'true' };
  // W16-B (28.09.2026, Review R7-2): Feldfrüchte reif, außer ausdrücklich anders gesetzt – vorher Stufe 0 (Keimlinge auf
  // brauner Erde); das goldene Weizenfeld ist ein Erkennungsmerkmal der Vorbilder (review-r5 farmhouse_1/_2)
  const ripe = RIPE_AGE[name.slice(name.indexOf(':') + 1)];
  if (ripe !== undefined && props['age'] === undefined) props = { ...props, age: ripe };
  const issues = registry.validateState(name, props);
  if (issues.length > 0) {
    throw new Error(`${where}: ${formatState({ name, properties: props })} ungültig in ${registry.version}: ${issues.map((i) => JSON.stringify(i)).join(', ')}`);
  }
  if (NEEDS_FACING.has(kind) && props['facing'] === undefined) {
    throw new Error(`${where}: ${name} (${kind}) braucht eine Ausrichtung (orient.front/back/attachTo bzw. facing)`);
  }
  for (const k of REQUIRED_PROPS[kind] ?? []) {
    if (props[k] === undefined) throw new Error(`${where}: ${name} (${kind}) braucht '${k}' (orient.${k === 'part' ? 'part' : 'half'})`);
  }
  const full = registry.resolveState(name, props);
  if (!registry.isValidState(full.name, full.properties, { complete: true })) throw new Error(`${where}: ${formatState(full)} unvollständig`);
  return blockState(full.name, full.properties);
}

function mergeProps(adapter: Props, raw: Props, where: string): Props {
  const out: Props = { ...adapter };
  for (const [k, v] of Object.entries(raw)) {
    if (out[k] !== undefined && out[k] !== v) throw new Error(`${where}: state.${k}=${v} widerspricht der Ausrichtung (${k}=${out[k]})`);
    out[k] = v;
  }
  return out;
}

function defaultLayer(p: MaterializePlacement): { layer: Layer; permit?: Permit } {
  if (p.layer !== undefined) return p.layer === Layer.Architecture ? { layer: p.layer, permit: 'carve' } : { layer: p.layer };
  switch (p.placed.expanded.mount) {
    case 'wall': return { layer: Layer.Attachment };
    case 'wall_inset':
    case 'floor_inset': return { layer: Layer.Architecture, permit: 'carve' };
    default: return { layer: Layer.Furniture };
  }
}

function boundsOf(points: readonly Vec3[]): { origin: Vec3; size: Vec3 } {
  if (points.length === 0) return { origin: [0, 0, 0], size: [1, 1, 1] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k]!, p[k]!);
    max[k] = Math.max(max[k]!, p[k]!);
  }
  return { origin: [min[0]!, min[1]!, min[2]!], size: [max[0]! - min[0]! + 1, max[1]! - min[1]! + 1, max[2]! - min[2]! + 1] };
}

export function materialize(input: MaterializeInput): MaterializeResult {
  const { shell, placements, theme, platform, seed } = input;
  const registry = platform.registry;
  const kinds = new KindIndex(registry);
  // W3-BL: gesperrte Blöcke „fehlen“ (banned.ts); ohne Sperren `undefined` und alles bitgleich
  const bans = banIndexOf(platform);
  const resolver = new ThemeResolver(theme, platform.families, registry, bans);
  /** Mit Sperren: Position → gesperrter Block, den der Bau ohne Sperren dort hätte (für den Ersatz-Bericht). */
  const avoidedAt = new Map<string, { pos: Vec3; from: string }>();
  const unreplaced = new Set<string>();
  /** Fester gesperrter Zustand → Ersatz (Legenden, feste Theme-Blöcke, Verwitterung); ohne Sperren unverändert. */
  const guard = (state: BlockState, pos: Vec3): BlockState => {
    if (bans === undefined || !bans.isBanned(state.name)) return state;
    const sub = bans.substituteState(state);
    if (sub === undefined) {
      unreplaced.add(state.name);
      return state;
    }
    avoidedAt.set(key3(pos), { pos, from: state.name });
    return sub;
  };
  const noteAvoided = (avoided: string | undefined, pos: Vec3): void => {
    if (avoided !== undefined) avoidedAt.set(key3(pos), { pos, from: avoided });
  };
  const problems: string[] = [];
  const jobs: Job[] = [];
  const entityJobs: EntityJob[] = [];
  const substitutions = new Map<string, MaterialResolution>();
  /** Soll-Treppenformen der Hülle (orient.stairShape), nach dem Autotiling verglichen. */
  const wantedShapes: { pos: Vec3; shape: string; owner: string }[] = [];

  const noteResolution = (r: MaterialResolution): void => {
    if (r.via !== 'direct' && r.via !== 'block') substitutions.set(`${r.role}.${r.shape}→${r.block}`, r);
  };

  // ---------------------------------------------------------------- 4a Kontext · 4b Muster · 4c Material · 9a Verwitterung: Hülle
  // (research/12 §7.1) Alles vor der Registry-Validierung; deterministisch per Projekt-Seed + Position.
  const capture = input.options?.captureAttributes === true;
  // K8: tragen die Hüllzellen stabile IDs, wird das Rauschen hausrelativ ausgewertet (Textur bleibt stehen)
  const stable = shell.cells.some((c) => c.id !== undefined);
  const ctxOpts = { ...(capture ? { capture: true } : {}), ...(stable ? { relative: true } : {}) };
  const contexts = shellContext(shell, input.roomTypes, ctxOpts);
  const weather = weatheringSettings(theme, input.options?.weathering);
  /**
   * Story-Spuren (Q5/P15): nur mit `storyState` – ohne das Feld wird `storyWeatherCell` nie aufgerufen und die
   * Verwitterung bleibt exakt der bisherige Aufruf (bitgleich). Rollen: nennt das Theme Verwitterungsrollen,
   * gelten sie; sonst darf der Zustand alle Rollen der Hülle berühren (der Wechsel selbst bleibt materialgebunden).
   */
  // feat/theme-moods: ein fertiges Profil (Stimmung `wear` × Zustand) hat Vorrang vor dem benannten Zustand
  const story = input.options?.storyProfile ?? input.options?.storyState;
  const storyRoles = new Set(Object.keys(theme.roles));
  const snow = snowCoverSettings(theme, input.options?.snowCover);
  const ruin = ruinSettings(theme, input.options?.ruin);
  // W13-B: Torfdach (Seed entscheidet je Projekt); ohne Theme-Feld `undefined` – bitgleich
  const turf = turfRoofSettings(theme, seed, input.options?.turfRoof);
  /** Aufgelöste Rolle je Hüllzelle (für Schneeauflage/Ruine); nur gefüllt, wenn ein Pass Rollen braucht. */
  const shellRoles: string[] = [];
  const useSurfaces = input.options?.surfaces !== false;
  /** W2 (I3): Läufer-Teppiche über Bodenzellen (Flächen-Muster `runner`), gesetzt mit der Innenhaut. */
  const carpets: LiningSpec[] = [];
  shell.cells.forEach((c, i) => {
    const ctx0 = contexts[i]!;
    // K7-Capture: die geerbten Attribute der Trägerwand schlagen den eigenen (geratenen) Kontext von Deko-Zellen
    const ctx = ctx0.attrs !== undefined ? { ...ctx0, t: { ...ctx0.t, wall_h: ctx0.attrs.wall_h } } : ctx0;
    const out = useSurfaces ? applySurfaces(theme, c, ctx, seed) : undefined;
    if (out?.carpet !== undefined) {
      const room = c.roomId ?? '-';
      carpets.push({ pos: [c.pos[0], c.pos[1] + 1, c.pos[2]], role: out.carpet.role, shape: out.carpet.shape, owner: `lining:${room}:carpet`, group: `${room}:carpet` });
    }
    // Neuere Hüllen-Rollen (Befestigung) fallen in Themes ohne sie auf eine Grundrolle zurück
    const role = effectiveShellRole((r) => resolver.hasRole(r), out?.role ?? c.role);
    if (snow !== undefined || ruin !== undefined || turf !== undefined) shellRoles[i] = role;
    const shape = out?.shape ?? c.shape;
    const where = `Hülle ${c.kind} ${role}.${shape} bei ${c.pos.join(',')}`;
    try {
      const detail = resolver.resolveDetailed(role, shape, {
        mixSeed: ctx.cellId !== undefined ? mixSeed(seed, role, ctx.cellId)
          : c.pickAt !== undefined ? mixSeed(seed, role, c.pickAt[0], c.pos[1], c.pickAt[1]) : mixSeed(seed, role, ...c.pos),
        at: { seed, ...pickPlaneOf(ctx), ...(ctx.cellId !== undefined ? { id: ctx.cellId } : {}) },
        t: ctx.t,
        ...(ctx.tStep !== undefined ? { tStep: ctx.tStep } : {}),
      });
      const r = detail.resolution;
      noteResolution(r);
      noteAvoided(detail.avoided, c.pos);
      const aged = weather !== undefined || story !== undefined
        ? story !== undefined
          ? storyWeatherCell(story, weather, storyRoles, ctx, seed, role, detail, resolver, platform)
          : weatherCell(weather!, ctx, seed, role, detail, resolver)
        : undefined;
      const name = aged?.block ?? r.block;
      const kind = kinds.of(name);
      // Achse aus dem Muster nur für Blöcke mit Achse (Stamm/Holz); gleiche Form (Dach, D12) behält die Ausrichtung der Hülle
      const hint: ShellOrient | undefined = out === undefined ? c.orient
        : out.axis !== undefined ? (kind === 'axis' ? { axis: out.axis } : undefined)
        : out.shape === c.shape ? c.orient : undefined;
      // Gelände-/Pflanzendecklagen (Blütenblätter, Laub, Schnee, Sand, Moos) tragen im Gelände eine reine
      // Deko-Richtung. Ein Block ohne Ausrichtung (kind `plain`) lässt sie fallen, statt zu scheitern – sonst
      // wäre die Rolle `ground_cover` auf Blütenblatt-Blöcke festgenagelt (research/31 §6).
      const orient = (c.kind === 'terrain' || c.kind === 'plant') && kind === 'plain' ? undefined : hint;
      const props = orient !== undefined ? shellOrientProps(kind, name, orient) : {};
      const state = guard(finalizeState(registry, name, kind, props, where), c.pos);
      const arch = ARCHITECTURE_KINDS.has(c.kind);
      if (c.orient?.stairShape !== undefined) wantedShapes.push({ pos: c.pos, shape: c.orient.stairShape, owner: `shell:${c.roomId ?? '-'}` });
      jobs.push({
        pos: c.pos, state, owner: `shell:${c.roomId ?? '-'}`, role, shell: true,
        layer: arch ? Layer.Architecture : c.kind === 'terrain' ? Layer.Terrain : c.kind === 'plant' ? Layer.Furniture : Layer.Structure,
        ...(arch ? { permit: 'carve' as const } : {}),
      });
    } catch (e) {
      problems.push(`${where}: ${(e as Error).message}`);
    }
  });

  // ---------------------------------------------------------------- 4 Theme + Orientierung: Komponenten
  /**
   * K7-Capture für Außen-Deko (research/30): Komponenten in Außenluft (Fensterläden, Blumenkästen, Laternen,
   * Schornsteine) kennen ihren Wandkontext nicht. Mit `captureAttributes` erben ihre Zellen das Rauschfeld und
   * `wall_h` der Wand einen Schritt daneben – Verläufe und Muster laufen hinter der Deko weiter.
   */
  const wallBehind = new Map<string, CellContext>();
  if (capture) {
    for (const c of contexts) if (c.surface === 'wall' && c.frame !== undefined) wallBehind.set(key3([c.x, c.y, c.z]), c);
  }
  const supportOf = (pos: readonly [number, number, number]): CellContext | undefined =>
    capture ? wallBehindAt(wallBehind, pos, key3) : undefined;
  for (const pl of placements) {
    const { placed } = pl;
    const pSeed = pl.seed ?? hashSeed(pl.id);
    const { layer, permit } = defaultLayer(pl);
    for (const cell of placed.cells) {
      const mat: MaterialSpec = cell.mat;
      const where = `${placed.expanded.defId}${placed.expanded.variantId !== undefined ? `#${placed.expanded.variantId}` : ''} (${pl.id}) Zelle ${cell.local.join(',')}`;
      try {
        if (mat.minVersion !== undefined && registry.dataVersion < mat.minVersion) {
          throw new Error(`Material erst ab DataVersion ${mat.minVersion}, Ziel ${registry.version} (${registry.dataVersion})`);
        }
        let name: string;
        if (mat.block !== undefined) {
          const migrated = registry.migrateBlockName(mat.block);
          if (migrated === undefined) throw new Error(`Block ${mat.block} existiert in ${registry.version} nicht`);
          name = migrated;
        } else {
          // Mischung je Platzierung (ein Möbel bleibt einheitlich); Rollen mit `perCell` (Mauerwerk) je Zelle.
          // Determinismus-Fix (plan/spikes/F_determinismus.md): Schlüssel ist der Seed der Platzierung, nicht ihre ID –
          // die ID zählt die Ereignisse des Projekts hoch (`p${seq}`), dieselbe Einrichtung bekäme beim erneuten
          // Generieren andere Blöcke (generateBase zweimal auf demselben Projekt war nicht bitgleich)
          const perCell = resolver.hasRole(mat.role!) && resolver.theme.roles[mat.role!]!.perCell === true;
          const mix = perCell ? mixSeed(seed, mat.role!, pSeed, ...cell.local) : mixSeed(seed, mat.role!, pSeed);
          const wall = supportOf(cell.pos);
          const d = wall === undefined
            ? resolver.resolveDetailed(mat.role!, mat.shape!, mix)
            : resolver.resolveDetailed(mat.role!, mat.shape!, {
              mixSeed: mix,
              at: { seed, ...pickPlaneOf(wall) },
              t: { wall_h: wallHeightParam(wall) },
            });
          const r = d.resolution;
          noteResolution(r);
          noteAvoided(d.avoided, cell.pos);
          name = r.block;
        }
        const kind = kinds.of(name);
        const adapter = orientProps(kind, name, worldOrient(mat.orient ?? {}, placed.pose));
        const raw = transformRawState(kind, mat.state ?? {}, placed.pose);
        const final = finalizeState(registry, name, kind, mergeProps(adapter, raw, where), where);
        const state = guard(final, cell.pos);
        // Inhalte (Truhen-Items) nur, wenn der Ersatz sie auch tragen kann
        const contents = state === final || blockEntityId(state.name) === blockEntityId(final.name) ? mat.contents : undefined;
        const be = blockEntityFor(state.name, contents, { registry, resolver, seed: pSeed, owner: pl.id, pos: cell.pos });
        jobs.push({ pos: cell.pos, state, owner: pl.id, layer, ...(mat.role !== undefined ? { role: mat.role } : {}), ...(permit !== undefined ? { permit } : {}), ...(be !== undefined ? { blockEntity: be } : {}) });
      } catch (e) {
        problems.push(`${where}: ${(e as Error).message}`);
      }
    }
    for (const ent of placed.entities) {
      try {
        const r = entityFor(ent.spec, ent.pos, ent.face, { registry, resolver, seed: pSeed, owner: pl.id, pos: ent.pos });
        entityJobs.push({ ...r, owner: pl.id });
      } catch (e) {
        problems.push(`${placed.expanded.defId} (${pl.id}) Entity ${ent.spec.type}: ${(e as Error).message}`);
      }
    }
  }
  if (problems.length > 0) throw new MaterializeError(problems);

  // ---------------------------------------------------------------- 4d Ruine planen (vor dem Volumen)
  // Erosion entfernt einen zusammenhängenden Cap von oben je Spalte (siehe ruin.ts). Geplant wird VOR dem Merge,
  // damit nur Hüll-Jobs wegfallen – Komponenten am selben Ort bleiben erhalten. Ohne Theme-Feld: nichts.
  const ruinRemoved = new Set<string>();
  /** Positionen im 3×3×3-Umfeld einer Entfernung: dort ändert die Vanilla-Regel die Treppenform gewollt. */
  const ruinAffected = new Set<string>();
  let ruinPlan: RuinRemoval[] = [];
  if (ruin !== undefined) {
    /**
     * Nur **raumgebundene** Komponenten schützen ihre Träger. Grund ist der Additiv-Vertrag der Außengestaltung
     * (X1, `exterior.test.ts`): Außen-Komponenten dürfen keinen Block außerhalb ihrer eigenen Zellen verändern.
     * Wären auch sie im Schutz-Set, verschöbe sich der Erosions-Cap und damit das Autotiling (z. B. eine
     * Scheiben-Verbindung) gegenüber dem Lauf ohne Außengestaltung. Raum-Komponenten (Möbel, hängende Lichter)
     * sind in beiden Läufen identisch, ihr Schutz ist also additiv; Außen-Komponenten sitzen an Fassade und
     * Dachhaut, die der Pass ohnehin schont (Dachtreppen und Öffnungen sind harte Stopps).
     */
    const protectedCells = protectedByComponents(placements.filter((pl) => pl.roomId !== undefined));
    ruinPlan = planRuin({ shell, contexts, roles: shellRoles, settings: ruin, seed, protected: protectedCells });
    for (const r of ruinPlan) {
      ruinRemoved.add(key3(r.pos));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        ruinAffected.add(key3([r.pos[0] + dx, r.pos[1] + dy, r.pos[2] + dz]));
      }
    }
  }
  const keptJobs = ruinRemoved.size === 0 ? jobs : jobs.filter((j) => j.shell !== true || !ruinRemoved.has(key3(j.pos)));

  // ---------------------------------------------------------------- 4e Schneeauflage planen (vor dem Volumen)
  // Nur die oberste belegte Zelle einer Spalte liegt unter freiem Himmel; Tür-/Fensterspalten und die
  // Luft-Masken der Komponenten bleiben frei. Ohne Theme-Feld ist `snow` undefined und nichts passiert.
  const snowCandidates: SnowCandidate[] = [];
  if (snow !== undefined) {
    const topOf = new Map<number, number>();
    for (const j of keptJobs) {
      const k = colKey(j.pos[0], j.pos[2]);
      const top = topOf.get(k);
      if (top === undefined || j.pos[1] > top) topOf.set(k, j.pos[1]);
    }
    const openings = new Set<number>();
    for (const c of shell.cells) if (c.kind === 'door' || c.kind === 'window') openings.add(colKey(c.pos[0], c.pos[2]));
    const keepFree = new Set<string>();
    for (const pl of placements) for (const a of pl.placed.air) keepFree.add(key3(a));
    snowCandidates.push(...planSnowCover({ shell, contexts, roles: shellRoles, settings: snow, seed, topOf, openings, keepFree }));
  }

  // ---------------------------------------------------------------- 4f Torfdach planen (W13-B, vor dem Volumen)
  const turfCandidates: TurfCandidate[] = [];
  if (turf !== undefined) {
    const topOf = new Map<number, number>();
    for (const j of keptJobs) {
      const k = colKey(j.pos[0], j.pos[2]);
      const top = topOf.get(k);
      if (top === undefined || j.pos[1] > top) topOf.set(k, j.pos[1]);
    }
    const peaks = new Set<string>();
    for (const pl of placements) if (pl.placed.expanded.mount === 'roof_peak') for (const c of pl.placed.cells) peaks.add(key3(c.pos));
    turfCandidates.push(...planTurfRoof({ shell, contexts, roles: shellRoles, settings: turf, topOf, peaks }));
  }

  // ---------------------------------------------------------------- 5 Merge (Schichten, Herkunft)
  const bounds = input.options?.bounds
    ?? boundsOf([...keptJobs.map((j) => j.pos), ...entityJobs.map((e) => e.blockPos), ...snowCandidates.map((c) => c.pos), ...turfBounds(turfCandidates)]);
  const volume = VoxelVolume.create(bounds.size, bounds.origin);
  const ordered = keptJobs.map((j, i) => [j, i] as const).sort((a, b) => a[0].layer - b[0].layer || a[1] - b[1]);
  /** Rolle je Position in Platzierungsreihenfolge: die letzte Zelle gewinnt – wie im Volumen. */
  const roleAt = new Map<string, string>();
  for (const [j] of ordered) {
    if (j.role !== undefined) roleAt.set(key3(j.pos), j.role);
    volume.place(j.pos, {
      state: j.state, owner: j.owner, layer: j.layer,
      ...(j.permit !== undefined ? { permit: j.permit } : {}),
      ...(j.blockEntity !== undefined ? { blockEntity: j.blockEntity } : {}),
    });
  }
  for (const e of entityJobs) volume.addEntity({ pos: e.pos, blockPos: e.blockPos, nbt: e.nbt, owner: e.owner, layer: Layer.Attachment });

  // ---------------------------------------------------------------- 5b Innenhaut + Läufer (W2, I1/I3/I4)
  // In freie Innenluft nach dem Merge – Möbel, Luft-Masken und Entities gewinnen; vor dem Autotiling, damit die
  // Deckenleisten Ecken bilden. Ohne Eingabe (keine Innenhaut, kein Läufer) passiert nichts.
  const liningSpecs = [...(input.lining ?? []), ...carpets];
  if (liningSpecs.length > 0) {
    const keepFree = new Set<string>();
    for (const pl of placements) for (const a of pl.placed.air) keepFree.add(key3(a));
    const res = applyLining({
      volume, resolver, seed, keepFree, noteResolution,
      kindOf: (name) => kinds.of(name),
      finalize: (name, kind, props, where) => finalizeState(registry, name, kind, props, where),
    }, liningSpecs);
    if (res.problems.length > 0) throw new MaterializeError(res.problems);
    for (const p of res.placed) roleAt.set(key3(p.pos), p.role);
  }

  // ---------------------------------------------------------------- 6 Nachbarn (Autotiling)
  const view = new WorldView(volume, platform, kinds);
  // W13-B: Torfdach setzen (nach dem Merge, vor Schnee, Vanilla-Updates und Physik)
  if (turf !== undefined && turfCandidates.length > 0) {
    const plants = ['short_grass', 'short_grass', 'short_grass', 'fern', 'dandelion', 'oxeye_daisy']
      .map((n) => registry.migrateBlockName(n)).filter((n): n is string => n !== undefined).map((n) => registry.resolveState(n));
    const blocks: TurfBlocks = { grass: registry.resolveState('grass_block'), moss: registry.resolveState(registry.migrateBlockName('moss_block') ?? 'grass_block'), plants };
    for (const t of applyTurfRoof(volume, turfCandidates, turf, blocks, seed)) roleAt.set(key3(t.pos), t.role);
  }
  // Schneeauflage setzen (nach dem Merge, vor Vanilla-Updates und Physik) – die Auflage liegt auf Luft.
  if (snow !== undefined && snowCandidates.length > 0) {
    for (const s of applySnowCover(volume, view, snowCandidates, snow)) roleAt.set(key3(s.pos), s.role);
  }
  // TX-B: Oberflächen-Textur (Blockmischung, Verläufe, Musterbruch) – vor der Verwitterung, nur Blocktausch
  let surfaceTexture: SurfaceTextureStats | undefined;
  if (input.options?.surfaceTexture !== undefined) {
    const tLevel = input.options.surfaceTexture;
    const tAge = input.options.storyProfile?.age ?? (input.options.storyState !== undefined ? STORY_PROFILES[input.options.storyState].age : 1);
    surfaceTexture = applySurfaceTexture({
      volume, shell, contexts, roleAt, families: platform.families, seed, level: tLevel,
      hasBlock: (n) => registry.hasBlock(n) && (bans === undefined || !bans.isBanned(n)),
      // nur die Eigenschaften übernehmen, die der Zielblock kennt (Stamm → Stamm behält `axis`, Stein verliert sie)
      resolveState: (n, props) => {
        const known = registry.resolveState(n).properties;
        return registry.resolveState(n, Object.fromEntries(Object.entries(props).filter(([k]) => Object.hasOwn(known, k))));
      },
      strength: (tLevel === 'rich' ? 1 : 0.4) * Math.min(1.3, Math.max(0.7, 0.7 + 0.3 * tAge)),
    });
  }
  // WS-Verwitterung: erzählende Cluster (nach dem Merge und nach Schnee; nur Blocktausch, keine Geometrie)
  let narrativeWeathering: NarrativeWeatheringStats | undefined;
  if (input.options?.narrativeWeathering !== undefined) {
    const wLevel = input.options.narrativeWeathering;
    const wAge = input.options.storyProfile?.age ?? (input.options.storyState !== undefined ? STORY_PROFILES[input.options.storyState].age : 1);
    narrativeWeathering = applyNarrativeWeathering({
      volume, shell, contexts, roleAt, families: platform.families, seed, level: wLevel,
      hasBlock: (n) => registry.hasBlock(n) && (bans === undefined || !bans.isBanned(n)),
      // TX-B: nach dem Oberflächen-Pass kann ein Ausgangsblock Eigenschaften tragen (z. B. `axis` bei Tiefenschiefer),
      // die der Zielblock nicht kennt; nur die Eigenschaften des Ziels übernehmen.
      resolveState: (n, props) => {
        const known = registry.resolveState(n).properties;
        return registry.resolveState(n, Object.fromEntries(Object.entries(props).filter(([k]) => Object.hasOwn(known, k))));
      },
      strength: (wLevel === 'rich' ? 1.15 : 0.65) * wAge,
      ...(input.options.narrativeWeatheringSolver !== undefined ? { solver: input.options.narrativeWeatheringSolver } : {}),
    });
  }
  // W3-BL: letzte Sperr-Kontrolle vor dem Autotiling (Innenhaut, Läufer, Schnee und alles, was oben durchrutschte)
  if (bans !== undefined) {
    for (const c of [...volume.cells()]) {
      if (isAir(c.state) || !bans.isBanned(c.state.name)) continue;
      const sub = guard(c.state, c.pos);
      if (sub === c.state) continue;
      volume.replaceState(c.pos, sub);
      if (c.blockEntity !== undefined && blockEntityId(sub.name) !== blockEntityId(c.state.name)) volume.setBlockEntity(c.pos, undefined);
    }
  }
  resolveStairs(view);
  resolveConnections(view);
  resolveRedstoneWires(view);
  // Vanilla-Parität (M2): Blätter-distance, Pilzflächen, Notenblock, Trampelpfad/Ackerland, snowy, Glocke …
  resolveVanillaUpdates(view);
  if (input.options?.pairChests !== false) pairChests(view);
  // W8-G (2026-09-27): Windrad-Wächter – nach Autotiling/Vanilla-Updates (Namen stehen fest), vor Physik, Licht und
  // Palette (die messen dann schon die behobene Welt). Ohne Befund keine Änderung.
  const pinwheel = input.options?.pinwheelGuard === false ? undefined : guardPinwheels(view);
  const violations: Violation[] = [...checkPairs(view), ...checkPistons(view)];
  for (const w of wantedShapes) {
    // Erodierte Hüllzellen sind Luft; Nachbartreppen bekommen gewollt die Vanilla-Form → keine Meldung.
    if (ruinAffected.has(key3(w.pos))) continue;
    const got = volume.stateAt(w.pos);
    if (got.properties['shape'] !== w.shape) {
      violations.push({
        kind: 'stair_shape', severity: 'warning', pos: w.pos, owner: w.owner, block: got.name,
        message: `Dachtreppe bei ${w.pos.join(',')}: Hülle wünscht shape=${w.shape}, die Vanilla-Regel ergibt ${got.properties['shape']} (Vanilla gilt)`,
      });
    }
  }

  // ---------------------------------------------------------------- 7 Physik
  violations.push(...checkSupport(view), ...checkMasks(view, placements), ...checkHangingEntities(view));

  // ---------------------------------------------------------------- 8 Licht & Spawn
  const field = computeLight(view);
  const spawn = spawnReport(view, field, shell);
  const byRoom = new Map<string, Vec3[]>();
  const atticOf = new Map<string, Vec3[]>();
  for (const d of spawn.darkCells) {
    const m = d.attic === true ? atticOf : byRoom;
    m.set(d.roomId, [...(m.get(d.roomId) ?? []), d.pos]);
  }
  for (const [roomId, cells] of byRoom) {
    violations.push({
      kind: 'spawn', severity: 'warning', roomId, cells,
      message: `Raum ${roomId}: ${cells.length} begehbare Zelle(n) ohne Blocklicht – Monster können spawnen`,
    });
  }
  // W4: Dachraum (kein Raum, aber im Gebäude) – dieselbe Pflicht
  for (const [roomId, cells] of atticOf) {
    violations.push({
      kind: 'spawn', severity: 'warning', roomId, cells,
      message: `Dachraum über ${roomId}: ${cells.length} begehbare Zelle(n) ohne Blocklicht – Monster können spawnen`,
    });
  }
  const light: LightReport = {
    levelAt: field.levelAt, emitters: field.emitters, darkCells: spawn.darkCells, walkableCells: spawn.walkableCells, gaps: spawn.gaps,
    ...(spawn.atticCells > 0 ? { atticCells: spawn.atticCells } : {}),
  };
  // Lichtplan (research/37): Lücke je Raum gegen den Zielwert prüfen – nur, wenn es überhaupt Quellen gibt
  const gapTarget = input.options?.lightGap;
  // W4: die Laternen des Dachraums zählen nicht (sie leuchten nicht in die Räume)
  if (gapTarget !== undefined && spawn.roomEmitters > 0) {
    for (const g of spawn.gaps) {
      if (g.maxDistance <= gapTarget) continue;
      violations.push({
        kind: 'light_gap', severity: 'warning', roomId: g.roomId, pos: g.cell, cells: [g.cell],
        message: `Raum ${g.roomId}: weiteste begehbare Stelle ${g.maxDistance} Blöcke von der nächsten Lichtquelle (Ziel ≤ ${gapTarget} – Blocklicht fällt je Block um 1)`,
      });
    }
  }

  // ---------------------------------------------------------------- 10 Endkontrolle (Registry der Zielversion)
  const invalid: string[] = [];
  // Gemessene Palette (research/13 #17/#19): NACH Merge und Autotiling, also der tatsächlich sichtbare Bestand
  const paletteCounts = new Map<string, { block: string; role?: string; count: number }>();
  for (const c of volume.cells()) {
    if (isAir(c.state)) continue;
    if (!registry.isValidState(c.state.name, c.state.properties, { complete: true })) invalid.push(`${formatState(c.state)} bei ${c.pos.join(',')}`);
    const role = roleAt.get(key3(c.pos));
    const key = `${role ?? ''}\u0000${c.state.name}`;
    const e = paletteCounts.get(key);
    if (e === undefined) paletteCounts.set(key, { block: c.state.name, ...(role !== undefined ? { role } : {}), count: 1 });
    else e.count++;
  }
  const palette = [...paletteCounts.values()].sort((a, b) => b.count - a.count || (a.role ?? '').localeCompare(b.role ?? '') || a.block.localeCompare(b.block));
  if (invalid.length > 0) throw new MaterializeError(invalid.map((s) => `nach Autotiling ungültig: ${s}`));

  // W3-BL: Ersatz-Bericht aus dem fertigen Volumen (was an der Stelle ohne Sperren gestanden hätte → was dort steht)
  let banned: MaterializeResult['banned'];
  if (bans !== undefined) {
    const tally = new Map<string, { from: string; to: string; count: number }>();
    for (const { pos, from } of avoidedAt.values()) {
      if (!volume.contains(pos)) continue;
      const to = volume.stateAt(pos).name;
      if (to === from || to === 'air') continue;
      const k = `${from}\u0000${to}`;
      const e = tally.get(k);
      if (e === undefined) tally.set(k, { from, to, count: 1 });
      else e.count++;
    }
    for (const c of volume.cells()) if (bans.isBanned(c.state.name)) unreplaced.add(c.state.name);
    const replaced = [...tally.values()].sort((a, b) => a.from.localeCompare(b.from) || b.count - a.count || a.to.localeCompare(b.to));
    banned = { replaced, unreplaced: [...unreplaced].sort() };
  }

  return {
    volume, violations, light, palette,
    version: registry.version, dataVersion: registry.dataVersion,
    substitutions: [...substitutions.values()],
    ...(banned !== undefined ? { banned } : {}),
    ...(pinwheel !== undefined && pinwheel.found > 0 ? { pinwheel } : {}),
    ...(narrativeWeathering !== undefined ? { narrativeWeathering } : {}),
    ...(surfaceTexture !== undefined ? { surfaceTexture } : {}),
  };
}
