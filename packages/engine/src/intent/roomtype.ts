/**
 * Raumbeschreibung → Raumtyp-ID (Operation `roomtype_classify`). Die Optionen kommen automatisch aus dem Raumtyp-Katalog
 * (Vokabular) – wie die Bautypen bei `building_generate`: neue Katalogdatei = neue Option ohne Code-Änderung.
 *
 * - {@link roomTypeTask}: Aufgabe für ein Entscheidungsmodell (eine `choice`-Frage über alle Raumtypen, über
 *   `@mcda/classify` gestellt; der HTTP-Aufruf liegt in `src/node/roomtype.ts`).
 * - {@link classifyRoomTypeLocal}: lokaler Rückfall ohne Netz – Katalognamen und -IDs automatisch, dazu Schlüsselwörter.
 * Rein und deterministisch.
 */
import type { LabelOption } from '@mcda/classify';
import type { Vocabulary } from '../vocabulary.js';
import { normalize } from './local.js';

export const ROOM_TYPE_INSTRUCTIONS =
  'Welcher Raumtyp passt am besten zu dieser Beschreibung eines Raums in einer Minecraft-Basis?';

/** Schlüsselwörter je Raumtyp-ID (normalisiert: klein, Umlaute gefaltet). Wirken nur, wenn der Raumtyp im Katalog ist. */
const ROOM_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  alchemy: ['alchemie', 'alchemist', 'traenke', 'trank', 'braustand', 'potion', 'potions', 'alchemy'],
  armory: ['waffen', 'ruestung', 'ruestungen', 'schwerter', 'armory', 'armoury', 'weapons', 'armor'],
  apiary: ['imker', 'imkerei', 'bienen', 'bienenstock', 'bienenstoecke', 'honig', 'waben', 'bees', 'honey', 'beekeeping'],
  attic: ['dachboden', 'speicher unterm dach', 'attic', 'loft'],
  bakery: ['baecker', 'brot', 'backofen', 'bakery', 'bread'],
  barn_farm: ['zucht', 'tierzucht', 'zuchtstall', 'kuehe', 'schweine', 'schafe', 'gehege', 'breeding', 'cattle', 'livestock'],
  barracks: ['kaserne', 'soldaten', 'feldbetten', 'barracks', 'soldiers'],
  bathhouse: ['bad', 'baden', 'badewanne', 'therme', 'bath', 'bathhouse'],
  bedroom: ['schlafzimmer', 'schlafen', 'bett', 'betten', 'bedroom', 'bed', 'sleep'],
  brewhouse: ['brauerei', 'bier', 'braukessel', 'brewery', 'beer', 'brewhouse'],
  butchery: ['metzger', 'fleischer', 'fleisch', 'schlachter', 'butcher', 'meat'],
  carpentry: ['schreiner', 'tischler', 'holzwerkstatt', 'hobelbank', 'carpenter', 'carpentry', 'woodwork'],
  chicken_house: ['huhn', 'huehner', 'huehnerstall', 'eier', 'chicken', 'chickens', 'eggs', 'coop'],
  chapel: ['kirche', 'altar', 'gebet', 'beten', 'andacht', 'chapel', 'church', 'shrine'],
  dining_hall: ['speisen', 'essen', 'esstisch', 'tafel', 'bankett', 'dining', 'feast'],
  dungeon: ['kerker', 'verlies', 'gefaengnis', 'zelle', 'zellen', 'gitter', 'gitterzelle', 'gitterzellen', 'folter', 'dungeon', 'prison', 'jail', 'cells'],
  enchanting_tower: ['verzauberung', 'verzaubern', 'zaubertisch', 'magie', 'enchanting', 'enchantment', 'magic'],
  entrance_hall: ['eingang', 'foyer', 'vorhalle', 'empfang', 'entrance', 'lobby'],
  farm_room: ['felder', 'ernte', 'weizen', 'anbau', 'farm', 'crops'],
  gallery: ['flur', 'korridor', 'gang', 'gemaelde', 'bilder', 'corridor', 'hallway', 'gallery', 'paintings'],
  game_room: ['spiele', 'spielen', 'billard', 'schach', 'games', 'game room'],
  greenhouse: ['pflanzen', 'blumen', 'gewaechse', 'glashaus', 'greenhouse', 'plants', 'flowers'],
  guest_room: ['gaeste', 'gast', 'besucher', 'guest', 'guests'],
  infirmary: ['kranke', 'kranken', 'heiler', 'lazarett', 'arzt', 'infirmary', 'hospital', 'healer'],
  kitchen: ['kochen', 'koch', 'herd', 'kochstelle', 'kitchen', 'cook', 'cooking', 'stove'],
  library: ['buecher', 'buch', 'buecherregal', 'buecherregale', 'lesen', 'lesesaal', 'schriftrollen', 'library', 'books', 'bookshelves', 'reading'],
  map_room: ['karten', 'landkarte', 'landkarten', 'kartentisch', 'maps', 'map room', 'cartography'],
  mead_hall: ['met', 'gelage', 'wikingerhalle', 'mead', 'mead hall'],
  music_room: ['musik', 'instrumente', 'klavier', 'notenblock', 'music', 'instruments', 'piano'],
  nursery: ['kinder', 'kind', 'baby', 'wiege', 'spielzeug', 'nursery', 'children', 'kids', 'toys'],
  observatory: ['sterne', 'teleskop', 'fernrohr', 'himmel', 'astronomie', 'observatory', 'telescope', 'stars'],
  portal_room: ['portal', 'nether', 'netherportal', 'end portal'],
  pottery: ['toepfer', 'ton', 'keramik', 'vasen', 'toepferscheibe', 'pottery', 'ceramics', 'clay'],
  smithy: ['schmied', 'amboss', 'esse', 'hufschmied', 'smith', 'smithy', 'forge', 'anvil', 'blacksmith'],
  solar: ['wohnzimmer', 'kamin', 'sofa', 'sessel', 'gemuetlich', 'living room', 'lounge', 'solar'],
  stable: ['pferd', 'pferde', 'stallung', 'heu', 'tiere', 'horse', 'horses', 'stable', 'stables'],
  storage: ['lagerraum', 'vorrat', 'vorraete', 'kisten', 'truhen', 'faesser', 'storage', 'chests', 'storeroom'],
  study: ['schreibtisch', 'buero', 'kontor', 'schreibstube', 'arbeiten', 'office', 'desk', 'study'],
  tavern: ['wirtshaus', 'kneipe', 'schenke', 'theke', 'tresen', 'gasthaus', 'tavern', 'inn', 'pub', 'bar'],
  throne_room: ['thron', 'koenig', 'koenigin', 'audienz', 'throne', 'king', 'queen'],
  tower_room: ['turmstube', 'turm', 'tower room', 'turret'],
  trading_hall: ['handel', 'haendler', 'dorfbewohner', 'markt', 'trading', 'villagers', 'market', 'shop'],
  treasury: ['schatz', 'schaetze', 'gold', 'diamanten', 'tresor', 'treasure', 'treasury', 'vault'],
  trophy_room: ['trophaeen', 'trophaee', 'jagdtrophaeen', 'koepfe', 'trophy', 'trophies'],
  washroom: ['toilette', 'waschen', 'waschbecken', 'klo', 'bathroom', 'toilet', 'washroom'],
  weaving_room: ['weben', 'webstuhl', 'naehen', 'wolle', 'stoffe', 'schneider', 'weaving', 'loom', 'sewing', 'tailor'],
  wine_cellar: ['wein', 'weinfaesser', 'keller', 'wine', 'cellar'],
  production_hall: ['produktionshalle', 'autocrafter', 'crafter', 'produktionslinie', 'production hall', 'production line'],
  brew_works: ['braustrasse', 'braustaender', 'traenkestrasse', 'brewing street', 'brew works', 'brewing line'],
  bakery_line: ['backstube', 'backlinie', 'baeckerlinie', 'baking line', 'bakery line'],
  arcane_study: ['verzauberungsstudio', 'zauberstudio', 'enchanting study', 'arcane study'],
  artisan_workshop: ['handwerkerwerkstatt', 'handwerkerecke', 'artisan', 'artisan workshop'],
  crop_hall: ['anbauhalle', 'pflanzenfarm', 'zuckerrohr', 'kuerbis', 'melonen', 'farmhalle', 'crop farm', 'crop hall', 'sugar cane', 'pumpkin', 'melon'],
  mushroom_cellar: ['pilzkeller', 'pilze', 'pilzfarm', 'champignon', 'mushroom', 'mushrooms', 'mushroom cellar'],
  herb_garden: ['kraeutergarten', 'kraeuter', 'kuechengarten', 'heilkraeuter', 'herb garden', 'herbs'],
  fn_villager_hall: ['haendlerhalle', 'haendlerbuden', 'villagerhalle', 'handelsbuden', 'villager hall', 'trading stalls'],
  fn_villager_quarters: ['schlafhalle', 'villagerschlafhalle', 'villager quarters', 'villager beds'],
  fn_cure_room: ['heilraum', 'zombiedorfbewohner', 'zombie heilen', 'zombie villager', 'curing', 'cure room'],
  fn_spawner_chamber: ['spawnerraum', 'spawner', 'monsterkaefig', 'monster spawner', 'spawner room'],
  workshop_redstone: ['redstone', 'kolben', 'mechanik', 'schaltung', 'maschinen', 'contraption', 'pistons', 'machines'],
};

/** Optionen für das Entscheidungsmodell: ID mit Katalognamen (und Beschreibung, falls vorhanden). */
export function roomTypeOptions(vocab: Vocabulary): LabelOption[] {
  return vocab.roomTypes.map((r) => ({ id: r.id, description: `${r.name}${r.description !== undefined ? ` – ${r.description}` : ''}` }));
}

/** Aufgabe für `classify` aus `@mcda/classify` (eine `choice`-Frage; über 255 Raumtypen automatisch aufgeteilt). */
export function roomTypeTask(vocab: Vocabulary): { readonly instructions: string; readonly options: readonly LabelOption[] } {
  return { instructions: ROOM_TYPE_INSTRUCTIONS, options: roomTypeOptions(vocab) };
}

export interface RoomTypeGuess {
  /** Erkannter Raumtyp; `null`, wenn lokal nichts passt. */
  readonly roomTypeId: string | null;
  /** 0–1. Lokal: 1 = eindeutiger Treffer, 0,5 = Gleichstand mehrerer Raumtypen, 0 = kein Treffer. */
  readonly confidence: number;
  /** Kandidaten absteigend (lokal: Treffer-Gewicht normiert; Modell: Wahrscheinlichkeit). */
  readonly ranked: ReadonlyArray<{ readonly roomTypeId: string; readonly probability: number }>;
  /** Lokal: erkannte Wörter (für Log und Fehlersuche). */
  readonly matched: readonly string[];
}

/** Ganzes Wort/ganze Wortfolge, ab 5 Zeichen auch als Wortanfang (Komposita: „Bücherregale“, „Schmiedeesse“). */
const has = (text: string, phrase: string): boolean => text.includes(` ${phrase} `) || (phrase.length >= 5 && text.includes(` ${phrase}`));

/**
 * Lokaler Rückfall: Punkte je Raumtyp = Länge der passenden Begriffe (Katalog-ID, Katalogname und dessen Teile,
 * Schlüsselwörter). Höchste Punktzahl gewinnt; bei Gleichstand der erste in Katalog-Reihenfolge mit Konfidenz 0,5.
 */
export function classifyRoomTypeLocal(description: string, vocab: Vocabulary): RoomTypeGuess {
  const text = normalize(description);
  const scores: Array<{ id: string; score: number; words: string[] }> = [];
  for (const r of vocab.roomTypes) {
    const name = normalize(r.name).trim();
    const phrases = new Set([
      normalize(r.id).trim(), name, ...name.split(' ').filter((w) => w.length >= 4), ...(ROOM_SYNONYMS[r.id] ?? []),
    ].filter((w) => w.length >= 3));
    const words = [...phrases].filter((p) => has(text, p));
    if (words.length > 0) scores.push({ id: r.id, score: words.reduce((s, w) => s + w.length, 0), words });
  }
  if (scores.length === 0) return { roomTypeId: null, confidence: 0, ranked: [], matched: [] };
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]!;
  const total = scores.reduce((s, x) => s + x.score, 0);
  const tie = scores.length > 1 && scores[1]!.score === top.score;
  return {
    roomTypeId: top.id,
    confidence: tie ? 0.5 : 1,
    ranked: scores.slice(0, 5).map((s) => ({ roomTypeId: s.id, probability: Math.round((s.score / total) * 1000) / 1000 })),
    matched: top.words,
  };
}
