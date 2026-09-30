/**
 * Farmbarkeit und Ersatz gesperrter Blöcke (W3-BL, Beta-Wunsch „Blöcke sperren und ersetzen“, Konzept W2UX §4.3).
 * Nur dieser Kontext kennt Minecraft-Namen (ACL): die kuratierte Liste des Presets „Nur leicht farmbar“ und die
 * Ersatz-Kandidaten für Blöcke **ohne** Materialfamilie (Lichtblöcke, Köpfe, Glocke …). Für Blöcke mit Familie sucht
 * `familySubstitutes` das nächste Familienmitglied derselben Art (Stein, Holz, Kupfer …) mit derselben Form, nach
 * Texturfarbe sortiert. Rein; ob ein Kandidat passt (Physik, Licht, Zielversion), entscheidet die Materialisierung.
 *
 * Quellen der Liste (Minecraft-Wiki, abgerufen 27.09.2026) stehen im Bericht `plan/spikes/W3BL_bloecke.md`.
 */
import type { FamilyData } from './types.js';

/** Gruppe des Presets: ein Grund, die Blöcke, eine Quelle. */
export interface HardToFarmGroup {
  readonly id: string;
  /** Kurzbegründung in Nutzersprache. */
  readonly why: string;
  readonly blocks: readonly string[];
}

/**
 * Preset „Nur leicht farmbar“ (Nutzerentscheidung 26.09.2026: je Projekt + Preset, einzeln anpassbar): Blöcke, die man
 * im Überleben nur mit großem Aufwand, nur in anderen Dimensionen nach dem Endkampf, nur aus seltenen Strukturen oder
 * gar nicht nachwachsend bekommt. Bewusst kurz – alles, was eine einfache Farm (Bäume, Stein-Generator, Eisengolem,
 * Kürbis, Bienen, Netherstein) liefert, bleibt erlaubt.
 */
export const HARD_TO_FARM: readonly HardToFarmGroup[] = [
  {
    id: 'prismarine',
    why: 'Nur aus Ozeanmonumenten/-ruinen bzw. von Wächtern (Prismarinscherben, -kristalle)',
    blocks: [
      'prismarine', 'prismarine_stairs', 'prismarine_slab', 'prismarine_wall', 'prismarine_bricks', 'prismarine_brick_stairs',
      'prismarine_brick_slab', 'dark_prismarine', 'dark_prismarine_stairs', 'dark_prismarine_slab', 'sea_lantern',
    ],
  },
  { id: 'sponge', why: 'Nur von Großen Wächtern im Ozeanmonument, nicht erneuerbar', blocks: ['sponge', 'wet_sponge'] },
  { id: 'purpur', why: 'Chorusfrüchte gibt es nur im End (nach dem Enderdrachen)', blocks: ['purpur_block', 'purpur_pillar', 'purpur_stairs', 'purpur_slab'] },
  {
    id: 'end',
    why: 'Endstein und Endstab nur aus dem End',
    blocks: ['end_stone', 'end_stone_bricks', 'end_stone_brick_stairs', 'end_stone_brick_slab', 'end_stone_brick_wall', 'end_rod', 'chorus_plant', 'chorus_flower'],
  },
  { id: 'netherite', why: 'Antiker Schutt ist nicht erneuerbar', blocks: ['netherite_block', 'ancient_debris', 'lodestone'] },
  { id: 'precious', why: 'Erz-Blöcke: Diamant nicht erneuerbar, Gold/Smaragd nur mit großer Farm oder Handel', blocks: ['gold_block', 'raw_gold_block', 'diamond_block', 'emerald_block'] },
  { id: 'boss', why: 'Nether-Stern (Wither) bzw. Herz des Meeres (Schatz)', blocks: ['beacon', 'conduit'] },
  {
    id: 'heads',
    why: 'Köpfe nur durch geladene Creeper, Wither-Skelette oder den Enderdrachen',
    blocks: [
      'skeleton_skull', 'skeleton_wall_skull', 'wither_skeleton_skull', 'wither_skeleton_wall_skull', 'zombie_head', 'zombie_wall_head',
      'creeper_head', 'creeper_wall_head', 'piglin_head', 'piglin_wall_head', 'dragon_head', 'dragon_wall_head',
    ],
  },
  { id: 'bell', why: 'Glocken nur in Dörfern oder beim Handel', blocks: ['bell'] },
  { id: 'gilded_blackstone', why: 'Nur in Bastionsruinen, nicht erneuerbar', blocks: ['gilded_blackstone'] },
  { id: 'budding_amethyst', why: 'Im Überleben gar nicht erhältlich (zerfällt beim Abbau)', blocks: ['budding_amethyst'] },
  { id: 'froglight', why: 'Froschlicht braucht drei Froscharten und Magmawürfel', blocks: ['ochre_froglight', 'verdant_froglight', 'pearlescent_froglight'] },
];

/** Alle Blöcke des Presets (sortiert, ohne Doppel). */
export const HARD_TO_FARM_BLOCKS: readonly string[] = [...new Set(HARD_TO_FARM.flatMap((g) => g.blocks))].sort();

/** Grund, warum ein Block im Preset steht (`undefined`: steht nicht darin). */
export function hardToFarmReason(block: string): string | undefined {
  return HARD_TO_FARM.find((g) => g.blocks.includes(block))?.why;
}

/**
 * Ersatz-Kandidaten für Blöcke ohne (passende) Materialfamilie, beste zuerst. Leuchtende Blöcke bekommen leuchtende
 * Kandidaten (Licht-Garantie: 0 dunkle Zellen); die Materialisierung nimmt den ersten, der in der Zielversion existiert,
 * nicht gesperrt ist, dieselbe Physik-Klasse hat und mindestens so hell leuchtet.
 */
export const BLOCK_SUBSTITUTES: Readonly<Record<string, readonly string[]>> = {
  sea_lantern: ['glowstone', 'shroomlight', 'jack_o_lantern', 'ochre_froglight'],
  ochre_froglight: ['glowstone', 'shroomlight', 'jack_o_lantern'],
  verdant_froglight: ['glowstone', 'shroomlight', 'jack_o_lantern'],
  pearlescent_froglight: ['glowstone', 'shroomlight', 'jack_o_lantern'],
  glowstone: ['shroomlight', 'jack_o_lantern', 'sea_lantern', 'ochre_froglight'],
  shroomlight: ['glowstone', 'jack_o_lantern', 'sea_lantern'],
  beacon: ['glowstone', 'shroomlight', 'jack_o_lantern', 'sea_lantern'],
  end_rod: ['lantern', 'soul_lantern'],
  conduit: ['lantern', 'soul_lantern'],
  bell: ['lantern', 'soul_lantern'],
  lantern: ['soul_lantern'],
  sponge: ['hay_block', 'yellow_terracotta'],
  wet_sponge: ['hay_block', 'yellow_terracotta'],
  gold_block: ['honeycomb_block', 'yellow_terracotta'],
  raw_gold_block: ['raw_copper_block', 'honeycomb_block'],
  diamond_block: ['light_blue_concrete', 'light_blue_terracotta'],
  emerald_block: ['lime_concrete', 'green_concrete'],
  netherite_block: ['polished_blackstone', 'coal_block'],
  ancient_debris: ['polished_blackstone', 'coal_block'],
  lodestone: ['chiseled_stone_bricks', 'chiseled_polished_blackstone'],
  gilded_blackstone: ['blackstone', 'polished_blackstone'],
  budding_amethyst: ['amethyst_block'],
  chorus_plant: ['oak_fence'],
  chorus_flower: ['flowering_azalea'],
  skeleton_skull: ['decorated_pot', 'flower_pot'],
  wither_skeleton_skull: ['decorated_pot', 'flower_pot'],
  zombie_head: ['decorated_pot', 'flower_pot'],
  creeper_head: ['decorated_pot', 'flower_pot'],
  piglin_head: ['decorated_pot', 'flower_pot'],
  dragon_head: ['decorated_pot', 'flower_pot'],
  skeleton_wall_skull: ['decorated_pot'],
  wither_skeleton_wall_skull: ['decorated_pot'],
  zombie_wall_head: ['decorated_pot'],
  creeper_wall_head: ['decorated_pot'],
  piglin_wall_head: ['decorated_pot'],
  dragon_wall_head: ['decorated_pot'],
};

/** Familie und Form eines Blocks in den Familien-Daten (auch als Alternative einer Form); `undefined` ohne Familie. */
export function familyOfBlock(data: FamilyData, block: string): { readonly family: string; readonly shape: string } | undefined {
  for (const [id, f] of Object.entries(data.families)) {
    for (const [shape, b] of Object.entries(f.shapes)) if (b === block) return { family: id, shape };
  }
  for (const [id, f] of Object.entries(data.families)) {
    for (const [shape, list] of Object.entries(f.alternates ?? {})) if (list.includes(block)) return { family: id, shape };
  }
  return undefined;
}

function rgb(hex: string | undefined): readonly [number, number, number] | undefined {
  if (hex === undefined || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * „Nächstes Familienmitglied“: Blöcke derselben Form aus anderen Familien derselben Art (Stein → Stein, Holz → Holz),
 * nach Texturfarbe am nächsten zuerst (Gleichstand: Familien-ID). Danach Familien anderer Art mit der Form, ebenfalls
 * nach Farbe. Die Familie des Blocks selbst ist ausgenommen (alle ihre Formen gelten als gleich schwer zu bekommen).
 */
export function familySubstitutes(data: FamilyData, block: string): string[] {
  const own = familyOfBlock(data, block);
  if (own === undefined) return [];
  const f = data.families[own.family]!;
  const base = rgb(f.color);
  const dist = (hex: string | undefined): number => {
    const c = rgb(hex);
    if (base === undefined || c === undefined) return Number.MAX_SAFE_INTEGER;
    return (c[0] - base[0]) ** 2 + (c[1] - base[1]) ** 2 + (c[2] - base[2]) ** 2;
  };
  const candidates = Object.values(data.families)
    .filter((g) => g.id !== own.family && g.shapes[own.shape] !== undefined)
    .map((g) => ({ block: g.shapes[own.shape]!, same: g.kind === f.kind, d: dist(g.color), id: g.id }))
    .sort((a, b) => Number(b.same) - Number(a.same) || a.d - b.d || a.id.localeCompare(b.id));
  return [...new Set(candidates.map((c) => c.block))].filter((b) => b !== block);
}
