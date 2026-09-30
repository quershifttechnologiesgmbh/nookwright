/**
 * Bauplan-Ausgabe (DR5 K2, DR1 Nr. 5): Anleitung Ebene für Ebene (Palette mit Zählung, optional Raster je Ebene) und
 * Materialliste mit Stapeln und Shulker-Kisten, als Markdown und CSV. Reine Funktion über das fertige Export-Volumen –
 * also genau das, was auch in der Schematic steht. App (Export-Dialog) und Engine (`build_guide`) nutzen dieselbe Stelle.
 */
import type { ExportVolume } from '@mcda/export';
import { blockItem, stackSize } from '@mcda/platform';
import { EXPORT_DISCLAIMER, OUTPUT_LICENSE_DRAFT } from './disclaimer.js';

/** Plätze einer Shulker-Kiste (so viele wie eine einfache Truhe). */
export const SHULKER_SLOTS = 27;
/** Raster je Ebene nur bis zu dieser Grundfläche (Breite und Tiefe), sonst wird die Anleitung unlesbar lang. */
export const GUIDE_GRID_MAX = 64;

export interface GuideMaterial {
  /** Gegenstand (Block-ID ohne Namensraum, wie in der Materialliste). */
  readonly item: string;
  readonly count: number;
  /** Stapelgröße (64, 16 oder 1). */
  readonly stack: number;
  readonly fullStacks: number;
  readonly remainder: number;
  /** Inventarplätze (volle Stapel plus angebrochener). */
  readonly slots: number;
  /** Shulker-Kisten nur für diesen Gegenstand. */
  readonly shulkerBoxes: number;
}

export interface GuideLayer {
  /** Höhe relativ zur Unterkante des Volumens (0 = unterste Ebene). */
  readonly y: number;
  /** Gegenstände dieser Ebene. */
  readonly count: number;
  /** Palette der Ebene, absteigend nach Menge. */
  readonly items: ReadonlyArray<{ readonly item: string; readonly count: number }>;
  /** Raster (Zeile = z von Norden nach Süden, Spalte = x von Westen nach Osten); nur mit `grids` und kleiner Grundfläche. */
  readonly rows?: readonly string[];
}

export interface BuildGuide {
  readonly name: string;
  /** Breite (x), Höhe (y), Tiefe (z). */
  readonly size: readonly [number, number, number];
  /** Summe aller Gegenstände. */
  readonly count: number;
  readonly materials: readonly GuideMaterial[];
  /** Inventarplätze insgesamt und Shulker-Kisten, wenn man gemischt packt. */
  readonly slots: number;
  readonly shulkerBoxes: number;
  /** Nur nicht-leere Ebenen, von unten nach oben. */
  readonly layers: readonly GuideLayer[];
  /** Zeichen der Raster (mit `grids`): Symbol → Gegenstand. `.` = leer, `~` = ohne Gegenstand (Wasser …), `#` = weitere. */
  readonly legend?: ReadonlyArray<{ readonly symbol: string; readonly item: string }>;
  /** Raster angefordert, aber Grundfläche größer als {@link GUIDE_GRID_MAX}. */
  readonly gridsOmitted?: true;
}

export interface BuildGuideOptions {
  /** Raster je Ebene erzeugen (Standard: nein). */
  readonly grids?: boolean;
}

const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const AIR = new Set(['air', 'cave_air', 'void_air']);
const plain = (name: string): string => (name.startsWith('minecraft:') ? name.slice(10) : name);
const byCount = <T extends { readonly item: string; readonly count: number }>(a: T, b: T): number => b.count - a.count || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0);

/** Menge → volle Stapel, Rest, Plätze, Shulker-Kisten. */
export function stacksOf(count: number, stack = 64): { readonly fullStacks: number; readonly remainder: number; readonly slots: number; readonly shulkerBoxes: number } {
  const fullStacks = Math.floor(count / stack);
  const remainder = count - fullStacks * stack;
  const slots = fullStacks + (remainder > 0 ? 1 : 0);
  return { fullStacks, remainder, slots, shulkerBoxes: Math.ceil(slots / SHULKER_SLOTS) };
}

/** Bauplan eines Export-Volumens (deterministisch: gleiche Blöcke → gleicher Plan, unabhängig von der Reihenfolge). */
export function buildGuide(volume: ExportVolume, opts: BuildGuideOptions = {}): BuildGuide {
  const [sx, sy, sz] = volume.size;
  const total = new Map<string, number>();
  const perLayer = new Map<number, Map<string, number>>();
  for (const b of volume.blocks) {
    const name = plain(b.name);
    if (AIR.has(name)) continue;
    const it = blockItem(name, b.properties ?? {});
    if (it === undefined) continue;
    total.set(it.item, (total.get(it.item) ?? 0) + it.count);
    const layer = perLayer.get(b.pos[1]) ?? new Map<string, number>();
    layer.set(it.item, (layer.get(it.item) ?? 0) + it.count);
    perLayer.set(b.pos[1], layer);
  }
  const materials = [...total.entries()].map(([item, count]) => ({ item, count })).sort(byCount).map(({ item, count }) => {
    const stack = stackSize(item);
    return { item, count, stack, ...stacksOf(count, stack) };
  });
  const slots = materials.reduce((n, m) => n + m.slots, 0);
  const wantGrids = opts.grids === true;
  const gridOk = wantGrids && sx <= GUIDE_GRID_MAX && sz <= GUIDE_GRID_MAX;
  const symbolOf = new Map(materials.slice(0, SYMBOLS.length).map((m, i) => [m.item, SYMBOLS[i]!]));
  const grids = gridOk ? layerGrids(volume, symbolOf) : undefined;
  const layers = [...perLayer.keys()].sort((a, b) => a - b).map((y) => {
    const items = [...perLayer.get(y)!.entries()].map(([item, count]) => ({ item, count })).sort(byCount);
    const rows = grids?.get(y);
    return { y, count: items.reduce((n, i) => n + i.count, 0), items, ...(rows !== undefined ? { rows } : {}) };
  });
  return {
    name: volume.name,
    size: [sx, sy, sz],
    count: materials.reduce((n, m) => n + m.count, 0),
    materials,
    slots,
    shulkerBoxes: Math.ceil(slots / SHULKER_SLOTS),
    layers,
    ...(gridOk ? {
      legend: [...symbolOf.entries()].map(([item, symbol]) => ({ symbol, item })),
    } : {}),
    ...(wantGrids && !gridOk ? { gridsOmitted: true as const } : {}),
  };
}

function layerGrids(volume: ExportVolume, symbolOf: ReadonlyMap<string, string>): Map<number, string[]> {
  const [sx, , sz] = volume.size;
  const cells = new Map<number, string[][]>();
  for (const b of volume.blocks) {
    const name = plain(b.name);
    if (AIR.has(name)) continue;
    // ohne Eigenschaften: obere Türhälften, Bettköpfe usw. zeigen denselben Gegenstand wie ihr Gegenstück
    const it = blockItem(name);
    const symbol = it === undefined ? '~' : symbolOf.get(it.item) ?? '#';
    let grid = cells.get(b.pos[1]);
    if (grid === undefined) {
      grid = Array.from({ length: sz }, () => new Array<string>(sx).fill('.'));
      cells.set(b.pos[1], grid);
    }
    grid[b.pos[2]]![b.pos[0]] = symbol;
  }
  return new Map([...cells.entries()].map(([y, g]) => [y, g.map((r) => r.join(''))]));
}

/** „7 × 64 + 9“, „1 × 64“, unter einem Stapel nur die Zahl. */
const stackText = (m: GuideMaterial): string =>
  (m.fullStacks === 0 ? String(m.remainder) : `${m.fullStacks} × ${m.stack}${m.remainder > 0 ? ` + ${m.remainder}` : ''}`);

const cell = (s: string): string => s.replace(/\|/g, '\\|');

/**
 * Bauplan als Markdown (Deutsch): Kopf mit Maßen und Bedarf, Materialliste, Ebenen mit Palette und ggf. Raster,
 * am Ende Pflicht-Hinweis und Nutzungshinweis (Entwurf).
 */
export function buildGuideMarkdown(g: BuildGuide): string {
  const [w, h, d] = g.size;
  const out: string[] = [
    `# Bauplan: ${g.name}`,
    '',
    `Maße: ${w} × ${h} × ${d} Blöcke (Breite × Höhe × Tiefe) · ${g.count} Gegenstände in ${g.layers.length} Ebenen`,
    `Bedarf: ${g.slots} Inventarplätze ≈ ${g.shulkerBoxes} Shulker-Kisten (je ${SHULKER_SLOTS} Plätze)`,
    '',
    '## Materialliste',
    '',
    '| Block | Anzahl | Stapel | Plätze | Shulker-Kisten |',
    '|---|---:|---:|---:|---:|',
    ...g.materials.map((m) => `| ${cell(m.item)} | ${m.count} | ${stackText(m)} | ${m.slots} | ${m.shulkerBoxes} |`),
    '',
    '## Ebenen (von unten nach oben)',
    '',
  ];
  if (g.legend !== undefined) {
    out.push('Raster: Zeile = Norden → Süden, Spalte = Westen → Osten. `.` leer, `~` ohne Gegenstand (z. B. Wasser), `#` weitere Blöcke.', '');
    out.push(`Zeichen: ${g.legend.map((l) => `\`${l.symbol}\` ${l.item}`).join(', ')}`, '');
  }
  if (g.gridsOmitted === true) out.push(`Raster ausgelassen: Grundfläche größer als ${GUIDE_GRID_MAX} × ${GUIDE_GRID_MAX}.`, '');
  g.layers.forEach((l, i) => {
    out.push(`### Ebene ${i + 1} (y = ${l.y}): ${l.count} Gegenstände`, '');
    out.push(l.items.map((it) => `${it.item} × ${it.count}`).join(', '), '');
    if (l.rows !== undefined) out.push('```', ...l.rows, '```', '');
  });
  out.push('---', '', `${OUTPUT_LICENSE_DRAFT}`, '', EXPORT_DISCLAIMER, '');
  return out.join('\n');
}

const csvField = (s: string | number): string => (typeof s === 'number' || !/[",\n]/.test(s) ? String(s) : `"${s.replace(/"/g, '""')}"`);

/** Materialliste als CSV (Komma, Kopfzeile, eine Zeile je Gegenstand, Summenzeile `TOTAL`). */
export function buildGuideCsv(g: BuildGuide): string {
  const rows: Array<ReadonlyArray<string | number>> = [
    ['block', 'count', 'stack_size', 'full_stacks', 'remainder', 'slots', 'shulker_boxes'],
    ...g.materials.map((m) => [m.item, m.count, m.stack, m.fullStacks, m.remainder, m.slots, m.shulkerBoxes]),
    ['TOTAL', g.count, '', '', '', g.slots, g.shulkerBoxes],
  ];
  return `${rows.map((r) => r.map(csvField).join(',')).join('\n')}\n`;
}
