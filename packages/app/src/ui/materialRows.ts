/**
 * Ansichtsmodell des Tabs „Material“ (W3-BL, Konzept W2UX §4.3 B1–B4, Mockup `mock_material`): Materialliste mit
 * Mengen und Stapeln (Haus bzw. Haus + Gelände), gesperrte Blöcke mit ihrem Ersatz im fertigen Bau, Preset-Zustand.
 * Rein und testbar – Liste und Ersatz kommen aus `@mcda/pipeline` (`materialList`) bzw. der Materialisierung
 * (`materialized.banned`), die Regeln aus der Sitzung.
 */
import type { MaterialList, MaterialSurroundings, World, BlockRules } from '@mcda/pipeline';
import { EASY_FARM_BLOCKS, easyFarmReason, materialList, stacksText } from '@mcda/pipeline';
import { blockItem } from '@mcda/platform';
import { blockName } from './blockNames.js';

/** Gegenstand eines Blocks (Wandform → Gegenstand), damit Sperren und Freigeben dieselbe ID treffen wie die Liste. */
const itemOf = (block: string): string => blockItem(block)?.item ?? block;

export type MaterialScope = 'house' | 'all';

export interface MaterialRowView {
  readonly item: string;
  readonly count: number;
  /** „65 St. + 52“ bzw. die Zahl unter einem Stapel. */
  readonly stacks: string;
}

export interface BannedRowView {
  readonly block: string;
  /** Ersatz im fertigen Bau (häufigster zuerst); leer = kommt im Bau nicht vor. */
  readonly to: readonly string[];
  /** Ersetzte Zellen. */
  readonly count: number;
  /** Feste Ersetzung des Nutzers (sonst automatisch). */
  readonly fixed?: string | undefined;
  /** Warum gesperrt: Grund des Presets oder „eigene Sperre“. */
  readonly why: string;
  /** Kein passender Ersatz gefunden – der Block bleibt im Bau. */
  readonly left: boolean;
}

export interface MaterialView {
  readonly total: number;
  readonly rows: readonly MaterialRowView[];
  /** Zeilen insgesamt (vor Suche und Kürzen). */
  readonly rowCount: number;
  /** Gesperrte Blöcke, die dieser Bau benutzt hätte, und eigene Sperren. */
  readonly banned: readonly BannedRowView[];
  /** Gesperrte Preset-Blöcke, die in diesem Bau ohnehin nicht vorkommen. */
  readonly presetUnused: number;
  readonly presetOn: boolean;
}

type MaterialWorld = Pick<World, 'materialized'> & { readonly surroundings?: MaterialSurroundings };

/**
 * W14: was der Tab „Material“ aus der Welt braucht, als reine Daten (der Blöcke-Worker liefert es mit, dann muss der
 * Haupt-Thread für den Tab nicht materialisieren). Aus einer Welt: `materialDataOf`.
 */
export interface MaterialData {
  readonly list: MaterialList;
  readonly banned?: MaterialWorld['materialized']['banned'];
  readonly palette: MaterialWorld['materialized']['palette'];
  readonly substitutions: MaterialWorld['materialized']['substitutions'];
  /** Welt mit Umgebung (Schalter „+ Gelände“). */
  readonly hasSurroundings: boolean;
}

const materialCache = new WeakMap<object, MaterialData>();

/** Welt → Daten des Tabs „Material“ (je Welt einmal); Daten bleiben Daten. */
export function materialDataOf(world: MaterialWorld | MaterialData): MaterialData {
  if ('list' in world) return world;
  let d = materialCache.get(world);
  if (d === undefined) {
    const m = world.materialized;
    d = {
      list: materialList(world, world.surroundings),
      ...(m.banned !== undefined ? { banned: m.banned } : {}),
      palette: m.palette,
      substitutions: m.substitutions,
      hasSurroundings: world.surroundings !== undefined,
    };
    materialCache.set(world, d);
  }
  return d;
}

/** Ansichtsmodell aus Welt (bzw. ihren Material-Daten) und Regeln. `limit` kürzt die Materialliste (Suche filtert vorher nach Teiltext). */
export function materialView(
  world: MaterialWorld | MaterialData | undefined,
  rules: BlockRules | undefined,
  scope: MaterialScope,
  query = '',
  limit = 8,
): MaterialView {
  const data = world === undefined ? undefined : materialDataOf(world);
  const list = data?.list;
  const q = query.trim().toLowerCase().replace(/\s+/g, '_');
  const all = (list?.rows ?? [])
    .map((r) => ({ item: r.item, count: scope === 'house' ? r.house : r.house + r.surroundings, stack: r.stack }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item));
  // Suche über ID und deutschen Namen („treppe“ findet `oak_stairs`)
  const qName = query.trim().toLowerCase();
  const found = q === '' ? all : all.filter((r) => r.item.includes(q) || blockName(r.item).toLowerCase().includes(qName));
  const rows = found.slice(0, limit).map((r) => ({ item: r.item, count: r.count, stacks: stacksText(r.count, r.stack) }));
  const total = list === undefined ? 0 : scope === 'house' ? list.house : list.house + list.surroundings;

  const replaced = data?.banned?.replaced ?? [];
  const left = new Set((data?.banned?.unreplaced ?? []).map((b) => bannedIdOf(b, rules)));
  const byFrom = new Map<string, { to: Map<string, number>; count: number }>();
  for (const r of replaced) {
    const from = bannedIdOf(r.from, rules);
    const e = byFrom.get(from) ?? { to: new Map<string, number>(), count: 0 };
    const to = itemOf(r.to);
    e.to.set(to, (e.to.get(to) ?? 0) + r.count);
    e.count += r.count;
    byFrom.set(from, e);
  }
  const bannedList = rules?.banned ?? [];
  const own = bannedList.filter((b) => !EASY_FARM_BLOCKS.includes(b));
  const shown = [...new Set([...byFrom.keys(), ...left, ...own])].filter((b) => bannedList.includes(b) || byFrom.has(b));
  const banned = shown
    .map((block) => {
      const e = byFrom.get(block);
      const to = e === undefined ? [] : [...e.to.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
      return {
        block, to, count: e?.count ?? 0, fixed: rules?.replace?.[block], why: easyFarmReason(block) ?? 'eigene Sperre', left: left.has(block),
      };
    })
    .sort((a, b) => b.count - a.count || a.block.localeCompare(b.block));
  const presetUnused = bannedList.filter((b) => EASY_FARM_BLOCKS.includes(b) && !shown.includes(b)).length;
  return { total, rows, rowCount: found.length, banned, presetUnused, presetOn: rules?.preset === 'easy_farm' };
}

/** Gesperrte ID, zu der ein Block im Bau gehört: er selbst, sonst sein Gegenstand (`wall_torch` → `torch`). */
function bannedIdOf(block: string, rules: BlockRules | undefined): string {
  return rules?.banned.includes(block) === true ? block : itemOf(block);
}

/** Materialliste als Text zum Kopieren (Tabulator-getrennt: Gegenstand, Anzahl, Stapel). */
export function materialText(world: MaterialWorld | MaterialData | undefined, scope: MaterialScope): string {
  const v = materialView(world, undefined, scope, '', Number.MAX_SAFE_INTEGER);
  return ['Block\tAnzahl\tStapel', ...v.rows.map((r) => `${r.item}\t${r.count}\t${r.stacks}`)].join('\n');
}

/**
 * Anzeige einer Block-ID: deutscher Name (W4-D, eigene Zuordnung `blockNames.ts`), unbekannte IDs mit Leerzeichen
 * (`stone_bricks` → „Steinziegel“, `new_block` → „new block“); die Minecraft-ID bleibt im Tooltip.
 */
export const blockLabel = (id: string): string => blockName(id);
