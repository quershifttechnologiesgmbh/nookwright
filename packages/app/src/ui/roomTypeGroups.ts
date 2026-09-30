/**
 * Raumtyp-Gruppen für die Auswahl (Palette „Neuer Raum“, Raumtyp im Raum-Panel). Rein, testbar.
 *
 * App-lokale Zuordnung ohne Schema-Eingriff: Die Gruppe hängt an der ID. Unbekannte IDs landen in „Nordisch“,
 * wenn der Raumtyp den Stil `nordic` verlangt (`styleTags.require`), sonst in „Weitere“ – neue Katalog-Einträge
 * erscheinen also sofort, nur noch nicht einsortiert.
 */
import { roomTypeFitsHeight, roomTypeFitsStyles, type Catalog, type RoomStyleFilter } from '@mcda/catalog';

export interface RoomTypeGroupDef {
  readonly id: string;
  readonly label: string;
  /** Raumtyp-IDs dieser Gruppe (auch geplante; fehlende werden einfach nicht angezeigt). */
  readonly ids: readonly string[];
}

export const ROOM_TYPE_GROUPS: readonly RoomTypeGroupDef[] = [
  { id: 'living', label: 'Wohnen', ids: ['bedroom', 'guest_room', 'nursery', 'solar', 'study', 'washroom', 'bathhouse', 'infirmary', 'attic', 'tower_room'] },
  { id: 'hall', label: 'Repräsentation', ids: ['entrance_hall', 'gallery', 'hallway', 'corridor', 'throne_room', 'dining_hall', 'tavern', 'chapel', 'trophy_room', 'music_room', 'game_room'] },
  { id: 'lore', label: 'Wissen & Magie', ids: ['library', 'alchemy', 'enchanting_room', 'enchanting_tower', 'observatory', 'map_room', 'portal_room'] },
  { id: 'craft', label: 'Handwerk', ids: ['smithy', 'workshop', 'carpentry', 'pottery', 'weaving_room'] },
  { id: 'supply', label: 'Küche & Vorrat', ids: ['kitchen', 'bakery', 'butchery', 'brewhouse', 'pantry', 'storage', 'storage_hall', 'wine_cellar'] },
  { id: 'defense', label: 'Wehr & Schatz', ids: ['barracks', 'guard_room', 'armory', 'treasury', 'vault', 'dungeon', 'fn_spawner_chamber'] },
  { id: 'function', label: 'Hof & Redstone', ids: ['farm_room', 'greenhouse', 'stable', 'barn_farm', 'chicken_house', 'apiary', 'workshop_redstone', 'trading_hall', 'smelting_hall', 'production_hall', 'brew_works', 'bakery_line', 'arcane_study', 'artisan_workshop', 'crop_hall', 'mushroom_cellar', 'herb_garden', 'secret_study', 'vault_room', 'fn_villager_hall', 'fn_villager_quarters', 'fn_cure_room'] },
  { id: 'nordic', label: 'Nordisch', ids: ['mead_hall', 'longhouse', 'sauna'] },
];

export const OTHER_GROUP = { id: 'other', label: 'Weitere' } as const;

/** Was Gruppierung und Passt-Hinweis über einen Raumtyp wissen müssen (Ausschnitt aus `RoomTypeDef`). */
export interface RoomTypeInfo {
  readonly id: string;
  readonly name: string;
  readonly styleTags?: RoomStyleFilter | undefined;
  /** Mindest-Lichthöhe (darunter nur die Kompaktform der Signatur). */
  readonly minHeight?: number | undefined;
}

export interface RoomTypeGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly RoomTypeInfo[];
}

/** Raumtypen des Katalogs mit Name, Stil-Filter und Mindesthöhe (Reihenfolge des Katalogs). */
export function roomTypeInfos(catalog: Pick<Catalog, 'roomTypeIds' | 'roomType'>): RoomTypeInfo[] {
  return catalog.roomTypeIds().map((id) => {
    const t = catalog.roomType(id);
    return { id, name: t.name, ...(t.styleTags !== undefined ? { styleTags: t.styleTags } : {}), ...(t.minHeight !== undefined ? { minHeight: t.minHeight } : {}) };
  });
}

/** Wogegen ein Raumtyp geprüft wird: Stil-Kette des Themes (spezifisch zuerst) und Wandhöhe der aktiven Etage. */
export interface RoomTypeFitContext {
  readonly styles?: readonly string[] | undefined;
  readonly themeName?: string | undefined;
  readonly height?: number | undefined;
  readonly floorName?: string | undefined;
}

/**
 * Warum ein Raumtyp hier nicht gut passt (`roomTypeFitsStyles`, `roomTypeFitsHeight` aus @mcda/catalog), als kurze
 * Sätze für den dezenten Hinweis der Palette; leer = passt. Malen geht trotzdem (der Solver vermerkt es in der Qualität).
 */
export function roomTypeMisfits(t: RoomTypeInfo, ctx: RoomTypeFitContext): string[] {
  const out: string[] = [];
  if (!roomTypeFitsStyles(t, ctx.styles)) {
    const f = t.styleTags;
    const why = f?.require !== undefined && !f.require.some((x) => ctx.styles!.includes(x)) ? `gedacht für ${f.require.join('/')}` : `nicht für ${f?.exclude?.join('/') ?? '?'}`;
    out.push(`passt nicht zum Theme${ctx.themeName !== undefined ? ` „${ctx.themeName}“` : ''} (${why})`);
  }
  if (ctx.height !== undefined && !roomTypeFitsHeight(t, ctx.height)) {
    out.push(`braucht Wandhöhe ${t.minHeight}, ${ctx.floorName ?? 'die Etage'} hat ${ctx.height}: Hauptmöbel nur in Kompaktform`);
  }
  return out;
}

const GROUP_BY_ID: ReadonlyMap<string, RoomTypeGroupDef> = new Map(ROOM_TYPE_GROUPS.flatMap((g) => g.ids.map((id) => [id, g] as const)));

/** Gruppe eines Raumtyps (ID der Gruppe); unbekannt → `nordic` bei Stil-Pflicht `nordic`, sonst `other`. */
export function roomTypeGroupOf(t: Pick<RoomTypeInfo, 'id' | 'styleTags'>): string {
  const g = GROUP_BY_ID.get(t.id);
  if (g !== undefined) return g.id;
  return t.styleTags?.require?.includes('nordic') === true ? 'nordic' : OTHER_GROUP.id;
}

/** Suchtext normalisieren: klein, ohne Akzente/Umlaut-Punkte, ß → ss, Unterstrich → Leerzeichen. */
export function normalizeSearch(s: string): string {
  return s
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Raumtypen → Gruppen in fester Reihenfolge („Weitere“ zuletzt), darin alphabetisch nach Name; leere Gruppen
 * fallen weg. `query` filtert: jedes Wort muss in Name, ID oder Gruppenname vorkommen („kü“ findet Küche,
 * „wehr“ die ganze Gruppe Wehr & Schatz).
 */
export function groupRoomTypes(types: readonly RoomTypeInfo[], query = ''): RoomTypeGroup[] {
  const words = normalizeSearch(query).split(' ').filter((w) => w !== '');
  const defs = [...ROOM_TYPE_GROUPS, { ...OTHER_GROUP, ids: [] }];
  const byGroup = new Map<string, RoomTypeInfo[]>(defs.map((g) => [g.id, []]));
  for (const t of types) {
    const gid = roomTypeGroupOf(t);
    const label = defs.find((g) => g.id === gid)?.label ?? '';
    const hay = normalizeSearch(`${t.name} ${t.id} ${label}`);
    if (words.every((w) => hay.includes(w))) byGroup.get(gid)!.push(t);
  }
  return defs
    .map((g) => ({ id: g.id, label: g.label, items: byGroup.get(g.id)!.sort((a, b) => a.name.localeCompare(b.name, 'de')) }))
    .filter((g) => g.items.length > 0);
}

/**
 * W8-F: Wie gut ein Raumtyp zur Suche passt – kleiner ist besser, `undefined` = kein Treffer der Palette. Name vor ID,
 * genau vor Anfang vor Wortanfang vor Teilwort; nur über den Gruppennamen („Küche & Vorrat“) zuletzt.
 */
function matchRank(t: RoomTypeInfo, groupLabel: string, q: string): number | undefined {
  const name = normalizeSearch(t.name);
  const id = normalizeSearch(t.id);
  if (name === q) return 0;
  if (id === q) return 1;
  if (name.startsWith(q)) return 2;
  if (id.startsWith(q)) return 3;
  if (name.split(' ').some((w) => w.startsWith(q))) return 4;
  if (name.includes(q)) return 5;
  if (id.includes(q)) return 6;
  const words = q.split(' ');
  const own = normalizeSearch(`${t.name} ${t.id}`);
  if (words.every((w) => own.includes(w))) return 7;
  return words.every((w) => `${own} ${normalizeSearch(groupLabel)}`.includes(w)) ? 8 : undefined;
}

/**
 * W8-F: Der Raumtyp, den Enter in der Palette wählt: bester Treffer nach `matchRank` (genauer Name, dann Anfang, dann
 * Teilwort, zuletzt nur Gruppe), bei Gleichstand alphabetisch nach Name. Vorher nahm Enter den ersten Eintrag der
 * ersten Gruppe – „Küche“ wählte „Bäckerei“, weil die Gruppe „Küche & Vorrat“ passt. Leere Suche → `undefined`.
 */
export function bestRoomTypeMatch(groups: readonly RoomTypeGroup[], query: string): RoomTypeInfo | undefined {
  const q = normalizeSearch(query);
  if (q === '') return undefined;
  let best: { t: RoomTypeInfo; rank: number } | undefined;
  for (const g of groups) {
    for (const t of g.items) {
      const rank = matchRank(t, g.label, q);
      if (rank === undefined) continue;
      if (best === undefined || rank < best.rank || (rank === best.rank && t.name.localeCompare(best.t.name, 'de') < 0)) best = { t, rank };
    }
  }
  return best?.t;
}
