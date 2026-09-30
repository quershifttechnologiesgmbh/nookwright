/**
 * Szene der Vorschau „Texturen“ als reine Daten: materialisiertes Volumen → Lesesicht `VoxelSource` für den
 * Blockrenderer, gefiltert nach der Ansicht (Komplett / Dach ab / Wände ab) wie in den anderen Modi.
 * Der Schnitt (Höhe) geht als `maxY` direkt an den Renderer; „Dach ab“ ist im beleuchteten Modus ein Schnitt
 * unter der Decke (siehe `textureScene`), damit das Licht innen stimmt.
 *
 * Die Lesesicht ist je Welt und Ansicht zwischengespeichert: Ein reiner Schnitt-Wechsel liefert dieselbe `source`,
 * der Renderer baut dann nur die Geometrie neu (`setCutaway`), kein Lichtfeld.
 */
import { key3, type Vec3 } from '@mcda/core';
import type { World } from '@mcda/pipeline';
import type { VoxelSource } from '@mcda/viewer';
import { isAir } from '@mcda/voxel';
import { exteriorLayers } from '../viewer/blocks.js';
import { SHELL_LAYER, layerVisible, type ViewMode } from '../viewer/voxels.js';

/** Ausgeblendete Zellen der Hülle und Außen-Deko je Welt und Ansicht. */
const hiddenCache = new WeakMap<World, Map<ViewMode, ReadonlySet<string>>>();
const sourceCache = new WeakMap<World, Map<string, VoxelSource>>();

function hiddenCells(world: World, view: ViewMode): ReadonlySet<string> {
  let byView = hiddenCache.get(world);
  if (byView === undefined) hiddenCache.set(world, (byView = new Map()));
  let hidden = byView.get(view);
  if (hidden === undefined) {
    const set = new Set<string>();
    for (const c of world.shell.cells) if (!layerVisible(SHELL_LAYER[c.kind], view)) set.add(key3(c.pos));
    // Außen-Deko wie Dach bzw. Wände (Schornstein, Läden …)
    for (const [k, layer] of exteriorLayers(world)) if (!layerVisible(layer, view)) set.add(k);
    byView.set(view, (hidden = set));
  }
  return hidden;
}

/**
 * Lesesicht für den Renderer: ohne ausgeblendete Hüllenblöcke („Wände ab“) und – Etagen-Ansicht „nur aktive“ –
 * ohne alles unter `minY`. Je Welt, Ansicht und `minY` zwischengespeichert (gleiche Quelle → kein Neubau).
 */
export function textureVolume(world: World, view: ViewMode, minY?: number): VoxelSource {
  const volume = world.materialized.volume;
  if (view === 'full' && minY === undefined) return volume;
  let byView = sourceCache.get(world);
  if (byView === undefined) sourceCache.set(world, (byView = new Map()));
  const key = `${view}|${minY ?? ''}`;
  let source = byView.get(key);
  if (source === undefined) {
    const hidden = hiddenCells(world, view);
    const low = minY ?? -Infinity;
    source = {
      origin: volume.origin,
      size: volume.size,
      *cells() {
        for (const c of volume.cells()) if (c.pos[1] >= low && !hidden.has(key3(c.pos))) yield c;
      },
      entities: () => volume.entities().filter((e) => e.blockPos[1] >= low),
    };
    byView.set(key, source);
  }
  return source;
}

/** Höchste Ebene unter der Decke (Decke = kleinstes y der Hüllenzellen „ceiling“); `undefined` ohne Decke. */
export function belowCeiling(world: World): number | undefined {
  let min = Infinity;
  for (const c of world.shell.cells) if (c.kind === 'ceiling' && c.pos[1] < min) min = c.pos[1];
  return Number.isFinite(min) ? min - 1 : undefined;
}

/** Unsichtbare Blöcke fängt die Auswahl per Klick nicht (man klickt „durch“ sie hindurch). */
const INVISIBLE = new Set(['light', 'barrier', 'structure_void']);

/**
 * Herkunft (`owner`) des sichtbaren Blocks an einer Weltposition oder `undefined` (Luft, unsichtbar, ausgeblendet,
 * über dem Schnitt, außerhalb). Grundlage für „Klick in 3D wählt die Platzierung“.
 */
export function ownerAt(world: World, view: ViewMode, maxY: number | undefined, pos: Vec3, minY?: number): string | undefined {
  const volume = world.materialized.volume;
  if ((maxY !== undefined && pos[1] > maxY) || (minY !== undefined && pos[1] < minY) || !volume.contains(pos)) return undefined;
  const c = volume.cell(pos);
  if (c === undefined || isAir(c.state) || INVISIBLE.has(c.state.name)) return undefined;
  if (view !== 'full' && hiddenCells(world, view).has(key3(pos))) return undefined;
  return c.owner;
}

export interface TextureScene {
  readonly source: VoxelSource;
  /** Schnitt (Welt-y, inklusive); `undefined` = alles */
  readonly maxY: number | undefined;
  /** Hinweis, wenn das Licht dieser Ansicht vom Spiel abweicht */
  readonly note?: string;
}

/**
 * Ansicht → Eingabe des beleuchteten Renderers. Er rechnet das Lichtfeld aus der ganzen Quelle, der Schnitt
 * blendet nur Geometrie aus. Deshalb:
 * - Komplett: Volumen, Schnitt vom Regler.
 * - Dach ab: Volumen, Schnitt höchstens unter der Decke (`ceilingY` = Decke der aktiven Etage) – Decke und Dach
 *   zählen weiter fürs Licht (innen dunkel wie im Spiel), sind aber nicht zu sehen.
 * - `minY` (Etagen-Ansicht „nur aktive“): Blöcke darunter fehlen in der Quelle.
 * - Wände ab: Hüllenblöcke entfernt (wie in den anderen Modi). Ohne Wände fällt Himmelslicht von der Seite ein.
 */
export function textureScene(world: World, view: ViewMode, cutY: number | undefined, opts: { readonly minY?: number | undefined; readonly ceilingY?: number | undefined } = {}): TextureScene {
  const { minY } = opts;
  if (view === 'full') return { source: textureVolume(world, view, minY), maxY: cutY };
  if (view === 'noRoof') {
    // Mehrere Etagen: unter der Decke der aktiven Etage schneiden (sonst die niedrigste Decke im Projekt)
    const ceiling = opts.ceilingY !== undefined ? opts.ceilingY - 1 : belowCeiling(world);
    return { source: textureVolume(world, 'full', minY), maxY: ceiling === undefined ? cutY : Math.min(cutY ?? ceiling, ceiling) };
  }
  return { source: textureVolume(world, view, minY), maxY: cutY, note: 'Wände ab: Licht ohne Wände gerechnet (Himmelslicht von der Seite)' };
}
