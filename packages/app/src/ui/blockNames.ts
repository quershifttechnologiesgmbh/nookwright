/**
 * Deutsche Blocknamen für den Tab „Material“ (W4-D, offener Punkt W3-BL §10.1). Eigene, kurze Zuordnung – bewusst
 * NICHT aus der Sprachdatei des Spiels (`de_de.json` ist ein Asset von Mojang und liegt ohnehin nicht im Client-JAR;
 * Spiel-Assets werden nicht eingecheckt, siehe `local/mc-assets/…/NICHT-VERTEILEN.txt`). Die Namen setzen sich aus
 * Wörtern zusammen: Holzart + Form („Fichtenholztreppe“), Eigenschaft + Material + Form („Bemooste
 * Bruchsteintreppe“), Farbe + Gegenstand („Hellblaue Glasscheibe“). Unbekannte IDs → `undefined` (die Oberfläche
 * zeigt dann die ID). Rein und testbar; die Minecraft-ID bleibt im Tooltip.
 */

type Gender = 'm' | 'f' | 'n' | 'p';
interface Noun {
  readonly name: string;
  readonly g: Gender;
  /** Wortstamm für Formen (Treppe/Stufe/Mauer), Standard `name`. */
  readonly stem?: string;
}
const n = (name: string, g: Gender, stem?: string): Noun => (stem === undefined ? { name, g } : { name, g, stem });

/** Holzarten (Wortstamm vor „holz…“/„stamm“/„laub“). */
const WOODS: Readonly<Record<string, string>> = {
  oak: 'Eichen', spruce: 'Fichten', birch: 'Birken', jungle: 'Tropen', acacia: 'Akazien', dark_oak: 'Schwarzeichen',
  mangrove: 'Mangroven', cherry: 'Kirsch', pale_oak: 'Blasseichen', crimson: 'Karmesin', warped: 'Wirr',
};
/** Formen aus Holz: Endung der ID → Name (mit Holzart-Stamm davor). */
const WOOD_FORMS: ReadonlyArray<readonly [string, string]> = [
  ['hanging_sign', 'holzhängeschild'], ['pressure_plate', 'holzdruckplatte'], ['fence_gate', 'holzzauntor'], ['trapdoor', 'holzfalltür'],
  ['planks', 'holzbretter'], ['stairs', 'holztreppe'], ['slab', 'holzstufe'], ['fence', 'holzzaun'], ['door', 'holztür'],
  ['button', 'holzknopf'], ['sign', 'holzschild'], ['log', 'stamm'], ['wood', 'holz'], ['leaves', 'laub'], ['sapling', 'setzling'],
];

/** Farben (Adjektiv-Stamm; Orange, Magenta und Rosa bleiben ungebeugt). */
const COLORS: Readonly<Record<string, string>> = {
  white: 'Weiß', light_gray: 'Hellgrau', gray: 'Grau', black: 'Schwarz', brown: 'Braun', red: 'Rot', orange: 'Orange', yellow: 'Gelb',
  lime: 'Hellgrün', green: 'Grün', cyan: 'Türkis', light_blue: 'Hellblau', blue: 'Blau', purple: 'Violett', magenta: 'Magenta', pink: 'Rosa',
};
const UNINFLECTED: ReadonlySet<string> = new Set(['Orange', 'Magenta', 'Rosa']);

/** Eigenschaften vor dem Material (Adjektiv-Stamm). */
const MODIFIERS: Readonly<Record<string, string>> = {
  mossy: 'Bemoost', cracked: 'Rissig', chiseled: 'Gemeißelt', polished: 'Poliert', smooth: 'Glatt', cut: 'Geschnitten', dark: 'Dunkel',
  weathered: 'Verwittert', exposed: 'Angelaufen', oxidized: 'Oxidiert', waxed: 'Gewachst', stripped: 'Entrindet', coarse: 'Grob',
  chipped: 'Angeschlagen', damaged: 'Beschädigt', carved: 'Geschnitzt', flowering: 'Blühend', tinted: 'Getönt', dead: 'Tot',
  stained: '', // „stained_glass“: die Farbe genügt („Blaues Glas“)
};

/** Formen aus Stein, Ziegel, Kupfer … (alle feminin). */
const FORMS: Readonly<Record<string, string>> = { stairs: 'treppe', slab: 'stufe', wall: 'mauer' };

/** Grundwörter (ID ohne Eigenschaften und Farbe). */
const NOUNS: Readonly<Record<string, Noun>> = {
  // Gestein und Mauerwerk
  stone: n('Stein', 'm'), cobblestone: n('Bruchstein', 'm'), stone_bricks: n('Steinziegel', 'p'), bricks: n('Ziegelsteine', 'p', 'Ziegel'),
  andesite: n('Andesit', 'm'), diorite: n('Diorit', 'm'), granite: n('Granit', 'm'), calcite: n('Kalzit', 'm'), tuff: n('Tuffstein', 'm'),
  tuff_bricks: n('Tuffsteinziegel', 'p'), basalt: n('Basalt', 'm'), blackstone: n('Schwarzstein', 'm'),
  blackstone_bricks: n('Schwarzsteinziegel', 'p'), sandstone: n('Sandstein', 'm'), deepslate: n('Tiefenschiefer', 'm'),
  cobbled_deepslate: n('Bruchtiefenschiefer', 'm'), deepslate_bricks: n('Tiefenschieferziegel', 'p'), deepslate_tiles: n('Tiefenschieferfliesen', 'p'),
  mud_bricks: n('Lehmziegel', 'p'), prismarine: n('Prismarin', 'm'), prismarine_bricks: n('Prismarinziegel', 'p'),
  quartz: n('Quarzblock', 'm', 'Quarz'), quartz_block: n('Quarzblock', 'm', 'Quarz'), quartz_pillar: n('Quarzsäule', 'f'),
  bamboo_mosaic: n('Bambusmosaik', 'n'), bamboo_block: n('Bambusblock', 'm'), end_stone_bricks: n('Endsteinziegel', 'p'),
  nether_bricks: n('Netherziegel', 'p'), purpur_block: n('Purpurblock', 'm', 'Purpur'),
  copper: n('Kupferblock', 'm', 'Kupfer'), copper_lantern: n('Kupferlaterne', 'f'), copper_chain: n('Kupferkette', 'f'),
  copper_bars: n('Kupfergitter', 'n'), copper_trapdoor: n('Kupferfalltür', 'f'), copper_door: n('Kupfertür', 'f'), copper_torch: n('Kupferfackel', 'f'),
  // Boden und Gelände
  dirt: n('Erde', 'f'), grass_block: n('Grasblock', 'm'), rooted_dirt: n('Wurzelerde', 'f'), podzol: n('Podsol', 'm'), mud: n('Schlamm', 'm'),
  packed_mud: n('Gestampfter Lehm', 'm'), moss_block: n('Moosblock', 'm'), moss_carpet: n('Moosteppich', 'm'), gravel: n('Kies', 'm'),
  sand: n('Sand', 'm'), clay: n('Ton', 'm'), farmland: n('Ackerboden', 'm'), dirt_path: n('Trampelpfad', 'm'), snow: n('Schnee', 'm'),
  snow_block: n('Schneeblock', 'm'), packed_ice: n('Packeis', 'n'), ice: n('Eis', 'n'), water: n('Wasser', 'n'),
  // Pflanzen
  short_grass: n('Gras', 'n'), tall_grass: n('Hohes Gras', 'n'), fern: n('Farn', 'm'), bush: n('Busch', 'm'), poppy: n('Mohn', 'm'),
  dandelion: n('Löwenzahn', 'm'), cornflower: n('Kornblume', 'f'), azure_bluet: n('Porzellansternchen', 'n'), oxeye_daisy: n('Margerite', 'f'),
  lily_of_the_valley: n('Maiglöckchen', 'n'), allium: n('Zierlauch', 'm'), tulip: n('Tulpe', 'f'), orchid: n('Orchidee', 'f'),
  torchflower: n('Fackellilie', 'f'), wildflowers: n('Wildblumen', 'p'), pink_petals: n('Rosa Blütenblätter', 'p'),
  leaf_litter: n('Laubstreu', 'f'), azalea_leaves: n('Azaleenlaub', 'n'), mushroom_stem: n('Pilzstiel', 'm'), sugar_cane: n('Zuckerrohr', 'n'),
  cactus: n('Kaktus', 'm'), wheat: n('Weizen', 'm'), carrots: n('Karotten', 'p'), potatoes: n('Kartoffeln', 'p'), beetroots: n('Rote Bete', 'f'),
  melon: n('Melone', 'f'), pumpkin: n('Kürbis', 'm'), jack_o_lantern: n('Kürbislaterne', 'f'), hanging_roots: n('Hängende Wurzeln', 'p'),
  pale_hanging_moss: n('Blasses hängendes Moos', 'n'), spore_blossom: n('Sporenblüte', 'f'), shroomlight: n('Pilzlicht', 'n'),
  hay_block: n('Strohballen', 'm'), cobweb: n('Spinnennetz', 'n'),
  // Glas, Licht, Metall
  glass: n('Glas', 'n'), glass_pane: n('Glasscheibe', 'f'), lantern: n('Laterne', 'f'), soul_lantern: n('Seelenlaterne', 'f'),
  torch: n('Fackel', 'f'), campfire: n('Lagerfeuer', 'n'), candle: n('Kerze', 'f'), glowstone: n('Leuchtstein', 'm'),
  iron_bars: n('Eisengitter', 'n'), iron_chain: n('Eisenkette', 'f'), chain: n('Kette', 'f'), bell: n('Glocke', 'f'),
  gold_block: n('Goldblock', 'm'), iron_block: n('Eisenblock', 'm'), coal_block: n('Kohleblock', 'm'), raw_gold_block: n('Rohgoldblock', 'm'),
  raw_iron_block: n('Roheisenblock', 'm'), honey_block: n('Honigblock', 'm'),
  // Einrichtung und Arbeitsblöcke
  chest: n('Truhe', 'f'), ender_chest: n('Endertruhe', 'f'), barrel: n('Fass', 'n'), bookshelf: n('Bücherregal', 'n'),
  crafting_table: n('Werkbank', 'f'), crafter: n('Werkler', 'm'), furnace: n('Ofen', 'm'), smoker: n('Räucherofen', 'm'),
  blast_furnace: n('Schmelzofen', 'm'), anvil: n('Amboss', 'm'), grindstone: n('Schleifstein', 'm'), smithing_table: n('Schmiedetisch', 'm'),
  lectern: n('Lesepult', 'n'), loom: n('Webstuhl', 'm'), cauldron: n('Kessel', 'm'), composter: n('Komposter', 'm'),
  beehive: n('Bienenstock', 'm'), brewing_stand: n('Braustand', 'm'), jukebox: n('Plattenspieler', 'm'), note_block: n('Notenblock', 'm'),
  flower_pot: n('Blumentopf', 'm'), decorated_pot: n('Verzierter Krug', 'm'), ladder: n('Leiter', 'f'), cake: n('Kuchen', 'm'),
  zombie_head: n('Zombiekopf', 'm'), creeper_head: n('Creeperkopf', 'm'), skeleton_skull: n('Skelettschädel', 'm'),
  // Farbige Gegenstände (mit Farbe davor)
  wool: n('Wolle', 'f'), carpet: n('Teppich', 'm'), terracotta: n('Keramik', 'f'), glazed_terracotta: n('glasierte Keramik', 'f'),
  concrete: n('Beton', 'm'), concrete_powder: n('Trockenbeton', 'm'), bed: n('Bett', 'n'),
  banner: n('Banner', 'n'), shulker_box: n('Shulker-Kiste', 'f'),
};

/** Adjektiv ohne Artikel (stark, Nominativ): „Weiß“ → Weiße (f/Plural), Weißer (m), Weißes (n); „Dunkel“ → Dunkle. */
function inflect(stem: string, g: Gender): string {
  if (UNINFLECTED.has(stem)) return stem;
  const base = stem.endsWith('el') ? `${stem.slice(0, -2)}l` : stem;
  return base + (g === 'm' ? 'er' : g === 'n' ? 'es' : 'e');
}

const lower = (w: string): string => w.charAt(0).toLowerCase() + w.slice(1);
/** Adjektive vor das Wort: das erste groß, weitere klein („Rissige polierte …“). */
function withAdjectives(stems: readonly string[], g: Gender, word: string): string {
  const adj = stems.filter((s) => s !== '').map((s, i) => (i === 0 ? inflect(s, g) : lower(inflect(s, g))));
  return adj.length === 0 ? word : `${adj.join(' ')} ${word}`;
}

const nounOf = (key: string): Noun | undefined => NOUNS[key] ?? NOUNS[`${key}s`];

function woodName(id: string): string | undefined {
  const stripped = id.startsWith('stripped_');
  const rest = stripped ? id.slice('stripped_'.length) : id;
  for (const [suffix, word] of WOOD_FORMS) {
    if (!rest.endsWith(`_${suffix}`)) continue;
    const wood = WOODS[rest.slice(0, -suffix.length - 1)];
    if (wood === undefined) continue;
    const name = `${wood}${word}`;
    if (!stripped) return name;
    return `${inflect('Entrindet', suffix === 'wood' ? 'n' : 'm')} ${name}`;
  }
  return undefined;
}

/**
 * Deutscher Name einer Block- bzw. Gegenstands-ID (mit oder ohne `minecraft:`), `undefined` = unbekannt.
 * Beispiele: `stone_bricks` → Steinziegel, `mossy_cobblestone_stairs` → Bemooste Bruchsteintreppe,
 * `stripped_spruce_log` → Entrindeter Fichtenstamm, `light_blue_stained_glass_pane` → Hellblaue Glasscheibe.
 */
export function germanBlockName(raw: string): string | undefined {
  const id = raw.replace(/^minecraft:/, '');
  const wood = woodName(id);
  if (wood !== undefined) return wood;
  let tokens = id.split('_');
  // Form am Ende (Treppe/Stufe/Mauer), nur wenn davor ein Material steht
  const formKey = tokens.length > 1 ? tokens.at(-1)! : '';
  const form = FORMS[formKey];
  if (form !== undefined) tokens = tokens.slice(0, -1);
  const adjectives: string[] = [];
  for (;;) {
    const key = tokens.join('_');
    const noun = nounOf(key);
    if (noun !== undefined && tokens.length > 0) {
      if (form !== undefined) return withAdjectives(adjectives, 'f', `${noun.stem ?? noun.name}${form}`);
      return withAdjectives(adjectives, noun.g, noun.name);
    }
    if (tokens.length < 2) return undefined;
    const two = `${tokens[0]}_${tokens[1]}`;
    if (COLORS[two] !== undefined) {
      adjectives.push(COLORS[two]!);
      tokens = tokens.slice(2);
      continue;
    }
    const one = COLORS[tokens[0]!] ?? MODIFIERS[tokens[0]!];
    if (one === undefined) return undefined;
    adjectives.push(one);
    tokens = tokens.slice(1);
  }
}

/** Anzeige einer Block-ID: deutscher Name, sonst die ID mit Leerzeichen (`some_new_block` → „some new block“). */
export const blockName = (id: string): string => germanBlockName(id) ?? id.replace(/^minecraft:/, '').replace(/_/g, ' ');
