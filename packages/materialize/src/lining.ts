/**
 * Innenhaut setzen (W2, Baustandard I1/I3/I4): Paneele, Leisten, Ständer, Türrahmen (geplant von
 * `@mcda/furnishing` `planLining`) und Teppich-Läufer (Flächen-Muster `runner`) als eigene Schicht in die
 * Innenluft – NACH dem Merge, VOR Autotiling, Vanilla-Updates, Physik und Licht. So formen die Deckenleisten
 * ihre Innen- und Außenecken nach der Vanilla-Regel, und Licht-Pass und Spawn-Report sehen die fertige Welt.
 *
 * Gesetzt wird nur, wo im Volumen noch Luft ist und nichts anderes Anspruch hat: Luft-Masken der Komponenten,
 * Zellen hängender Entities (Rahmen, ganze Gemäldefläche) und der 3×3-Ring um einen Zaubertisch (Faktencheck #1:
 * Teppich und Falltür blockieren die Regale) bleiben frei. Die Funktionsteile gewinnen immer.
 * Rein und deterministisch: Material je Gruppe (Raum + Bauteil) aus dem Projekt-Seed – ein Holz je Raum und Bauteil.
 * Ohne Eingabe (`MaterializeInput.lining` leer/fehlt) passiert nichts (bitgleich).
 */
import type { ShellOrient } from '@mcda/blueprint';
import { key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import { Layer, isAir, type BlockState, type VoxelVolume } from '@mcda/voxel';
import type { BlockKind } from './kinds.js';
import { paintingCells, PAINTING_SIZES } from './hanging.js';
import { shellOrientProps } from './orient.js';
import { mixSeed, type ThemeResolver } from './theme-resolve.js';
import type { MaterialResolution } from './types.js';

/** Eine Zelle der Innenhaut (oder des Läufers) in Weltkoordinaten. */
export interface LiningSpec {
  readonly pos: Vec3;
  readonly role: string;
  readonly shape: string;
  readonly orient?: ShellOrient;
  /** Herkunft im Volumen, z. B. `lining:r3:panel`. */
  readonly owner: string;
  /** Mischgruppe: gleiche Gruppe + Rolle → gleicher Block (z. B. `r3:panel`). */
  readonly group: string;
}

export interface LiningContext {
  readonly volume: VoxelVolume;
  readonly resolver: ThemeResolver;
  readonly kindOf: (name: string) => BlockKind;
  readonly finalize: (name: string, kind: BlockKind, props: Record<string, string>, where: string) => BlockState;
  readonly seed: number;
  /** Luft-Masken der Komponenten (`key3`). */
  readonly keepFree: ReadonlySet<string>;
  readonly noteResolution: (r: MaterialResolution) => void;
}

export interface LiningResult {
  /** Gesetzte Zellen mit ihrer Rolle (für die gemessene Palette). */
  readonly placed: readonly { readonly pos: Vec3; readonly role: string }[];
  readonly problems: readonly string[];
}

const PAINTING_FACING: readonly HorizontalDir[] = ['south', 'west', 'north', 'east'];

function tagValue(nbt: { readonly value: unknown }, key: string): unknown {
  return (nbt.value as Record<string, { value: unknown } | undefined>)[key]?.value;
}

/** Zellen, die hängende Entities belegen (Rahmen: ihre Zelle; Gemälde: die ganze Bildfläche). */
function entityCells(volume: VoxelVolume): Set<string> {
  const out = new Set<string>();
  for (const e of volume.entities()) {
    out.add(key3(e.blockPos));
    const id = String(tagValue(e.nbt, 'id') ?? '').replace(/^minecraft:/, '');
    if (id !== 'painting') continue;
    const f = PAINTING_FACING[Number(tagValue(e.nbt, 'facing'))];
    const variant = String(tagValue(e.nbt, 'variant') ?? '').replace(/^minecraft:/, '');
    const size = Object.hasOwn(PAINTING_SIZES, variant) ? PAINTING_SIZES[variant] : undefined;
    if (f === undefined || size === undefined) continue;
    for (const c of paintingCells(e.blockPos, f, size[0], size[1])) out.add(key3(c));
  }
  return out;
}

/** Zaubertisch-Ring: 3×3 auf Tisch- und Regalhöhe (Zwischenblöcke der Bücherregale). */
function enchantingRing(volume: VoxelVolume): Set<string> {
  const out = new Set<string>();
  for (const c of volume.cells()) {
    if (c.state.name !== 'enchanting_table') continue;
    const [x, y, z] = c.pos;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [0, 1]) out.add(key3([x + dx, y + dy, z + dz]));
  }
  return out;
}

export function applyLining(ctx: LiningContext, specs: readonly LiningSpec[]): LiningResult {
  const { volume, resolver } = ctx;
  if (specs.length === 0) return { placed: [], problems: [] };
  const busy = entityCells(volume);
  for (const k of enchantingRing(volume)) busy.add(k);
  const placed: { pos: Vec3; role: string }[] = [];
  const problems: string[] = [];
  const cache = new Map<string, BlockState>();
  for (const s of specs) {
    if (!volume.contains(s.pos) || !isAir(volume.stateAt(s.pos))) continue;
    const k = key3(s.pos);
    if (ctx.keepFree.has(k) || busy.has(k)) continue;
    const where = `Innenhaut ${s.owner} ${s.role}.${s.shape} bei ${s.pos.join(',')}`;
    const ck = `${s.group}|${s.role}|${s.shape}|${JSON.stringify(s.orient ?? {})}`;
    try {
      let state = cache.get(ck);
      if (state === undefined) {
        const r = resolver.resolve(s.role, s.shape, mixSeed(ctx.seed, s.role, s.group));
        ctx.noteResolution(r);
        const kind = ctx.kindOf(r.block);
        const props = s.orient !== undefined ? shellOrientProps(kind, r.block, s.orient) : {};
        state = ctx.finalize(r.block, kind, props, where);
        cache.set(ck, state);
      }
      volume.place(s.pos, { state, owner: s.owner, layer: Layer.Attachment });
      placed.push({ pos: s.pos, role: s.role });
    } catch (e) {
      problems.push(`${where}: ${(e as Error).message}`);
    }
  }
  return { placed, problems };
}
