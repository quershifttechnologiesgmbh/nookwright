/**
 * Referenzstatistik für beliebige Bauvolumen (DR1 §7 Nr. 3, DR0 Nr. 15): nur vermessen, nichts übernehmen.
 *
 * Eingabe ist strukturell ein `ExportVolume` (`@mcda/export` liest .nbt/.schem/.litematic), damit eigene Bauten und
 * Community-Schematics gleich gemessen werden. Schritte:
 *  1. Gelände abziehen: je Säule die von unten zusammenhängenden Bodenblöcke (Gras, Erde, Stein …); Bodenhöhe =
 *     Median dieser Säulenhöhen. Pflanzen/Laub zählen nie zum Bau.
 *  2. Bau = größte zusammenhängende Komponente (Flächen- und Kantennachbarn) der übrigen Blöcke; Zäune, Mauern, Fackeln u. ä. hängen sich nur an
 *     (verbinden nichts), damit Hofzäune und Bäume den Bau nicht aufblähen. Blöcke unter der Bodenhöhe fallen weg.
 *  3. Kennzahlen: Maße, Blockvielfalt (Namen, Materialfamilien, Entropie), Anteil Nicht-Vollblöcke, Dachneigung aus
 *     der Oberflächen-Höhenkarte (Stufen halb), Fensteranteil = Glasflächen / Außenwandflächen.
 * Heuristisch und für eigene wie fremde Bauten gleich; Abweichungen sind Hinweise, keine Urteile.
 */

export type Vec3i = readonly [number, number, number];

export interface StatsBlock {
  readonly pos: Vec3i;
  readonly name: string;
  readonly properties?: Readonly<Record<string, string>>;
}

export interface StatsVolume {
  readonly size: Vec3i;
  readonly blocks: readonly StatsBlock[];
}

export interface BuildStatsOptions {
  /** `largest` (Standard): nur der Hauptbau; `all`: alle Nicht-Gelände-Blöcke. */
  readonly component?: 'largest' | 'all';
  /** Gelände nicht abziehen (für Schematics, die nur den Bau enthalten, ändert das nichts). */
  readonly keepTerrain?: boolean;
}

export interface BuildStats {
  readonly width: number;
  readonly depth: number;
  /** Höhe über Boden (bzw. über dem tiefsten Bau-Block, wenn kein Gelände erkannt wurde). */
  readonly height: number;
  /** Bodenhöhe im Volumen (-1: kein Gelände erkannt). */
  readonly groundY: number;
  readonly footprint: number;
  readonly blocks: number;
  readonly distinctBlocks: number;
  /** Materialfamilien: Form- und Oberflächenvarianten zusammengefasst (oak_planks/oak_stairs/stripped_oak_log → oak, mossy_/cracked_/polished_ … → Grundmaterial). */
  readonly materialFamilies: number;
  /** Blocksorten bzw. Materialfamilien der Außenhaut (Blöcke mit Fläche zur Außenluft, ohne Innenausstattung). */
  readonly exteriorDistinctBlocks: number;
  readonly exteriorFamilies: number;
  /** Shannon-Entropie der Blocknamen in Bit. */
  readonly entropyBits: number;
  /** Anteil des häufigsten Blocks. */
  readonly topShare: number;
  readonly nonFullShare: number;
  /** Median-Steigung der geneigten Dachsäulen (Höhe je Block, Stufen = 0,5); null ohne geneigte Säulen. */
  readonly roofPitch: number | null;
  readonly roofPitchDeg: number | null;
  /** Mittlere Steigung der geneigten Säulen (feiner als der Median, der bei Treppendächern fast immer 1 ist). */
  readonly roofPitchMean: number | null;
  /** Anteil flacher Säulen der Oberfläche (Flachdach, Plattformen). */
  readonly flatShare: number;
  readonly wallFaces: number;
  readonly glassFaces: number;
  readonly windowShare: number | null;
  readonly topBlocks: ReadonlyArray<readonly [name: string, share: number]>;
}

const AIR = /^(air|cave_air|void_air|structure_void|light|barrier|jigsaw)$/;
const GROUND = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|dirt_path|farmland|mud|sand|red_sand|gravel|clay|stone|andesite|diorite|granite|tuff|deepslate|bedrock|water|lava|snow_block|powder_snow|ice|packed_ice|moss_block|suspicious_sand|suspicious_gravel|[a-z_]*_ore)$/;
const PLANT = /(_leaves|_sapling|^short_grass|^tall_grass|^grass$|^fern|^large_fern|^dead_bush|^dandelion|^poppy|^blue_orchid|^allium|^azure_bluet|_tulip$|^oxeye_daisy|^cornflower|^lily_of_the_valley|^sunflower|^lilac|^rose_bush|^peony|^torchflower|^pitcher_plant|^pink_petals|^wildflowers|^leaf_litter|^bush$|^firefly_bush|^short_dry_grass|^tall_dry_grass|^sweet_berry_bush|^vine$|^glow_lichen|^lily_pad|^seagrass|^tall_seagrass|^kelp|^sugar_cane|^bamboo$|^cactus|^wheat$|^carrots$|^potatoes$|^beetroots$|^melon_stem|^pumpkin_stem|^attached_|_mushroom$|^moss_carpet|^snow$|^hanging_roots|^spore_blossom|^azalea$|^flowering_azalea$|^cave_vines|_vines$|^big_dripleaf|^small_dripleaf)/;
/** Blöcke, die sich anhängen, aber keine Verbindung stiften (Hofzäune, Laternen, Schilder …). */
const ATTACH = /(_fence$|_fence_gate$|_wall$|torch$|lantern$|_sign$|_banner$|^chain$|_chain$|^lightning_rod|_lightning_rod$|^end_rod$|candle$|^flower_pot$|^potted_|^bell$|^lever$|_button$|^ladder$|rail$|^scaffolding$|^campfire$|^soul_campfire$|_head$|_skull$|^decorated_pot$)/;
const NON_FULL = /(_stairs$|_slab$|_fence$|_fence_gate$|_wall$|_pane$|^glass_pane$|^iron_bars$|_bars$|_door$|_trapdoor$|_button$|_pressure_plate$|torch$|lantern$|_sign$|_banner$|_carpet$|^flower_pot$|^potted_|chain$|^ladder$|rail$|candle$|_rod$|^lever$|_head$|_skull$|campfire$|^bell$|anvil$|^cauldron$|^hopper$|^lectern$|^grindstone$|^brewing_stand$|_bed$|^cake$|^scaffolding$|^decorated_pot$|^composter$|^stonecutter$|^enchanting_table$|^daylight_detector$|_plate$|^snow$)/;
const GLASS = /glass/;
/** Deko auf dem Dach, die die Höhenkarte nicht bestimmt. */
const TOP_DECOR = /(torch$|lantern$|_sign$|_banner$|chain$|_rod$|candle$|^flower_pot$|^potted_|_head$|_skull$|^bell$|campfire$|_carpet$|_button$|^lever$|_pressure_plate$)/;

const SHAPE_SUFFIX = /(_stairs|_slab|_wall|_fence_gate|_fence|_door|_trapdoor|_button|_pressure_plate|_pane|_wall_sign|_wall_hanging_sign|_hanging_sign|_sign|_carpet)$/;

export const blockBaseName = (name: string): string => name.replace(/^minecraft:/, '').replace(/\[.*$/, '');

/** Materialfamilie eines Blocknamens (Form, Holz-Zuschnitt und Oberflächen-/Alterungsvarianten zusammengefasst). */
export function materialFamily(name: string): string {
  let n = blockBaseName(name).replace(/^(waxed_|stripped_|mossy_|cracked_|chiseled_|polished_|smooth_|cut_|exposed_|weathered_|oxidized_)+/, '').replace(SHAPE_SUFFIX, '');
  n = n.replace(/_(planks|log|wood|stem|hyphae)$/, '').replace(/_bricks$/, '_brick').replace(/_tiles$/, '_tile');
  if (n === 'glass' || n.endsWith('_stained_glass') || n === 'tinted_glass') return n.replace(/_stained_glass$/, '_glass');
  return n;
}

export const isNonFullBlock = (name: string): boolean => NON_FULL.test(blockBaseName(name));
export const isGlassBlock = (name: string): boolean => GLASS.test(blockBaseName(name));

/** Kennzahlen eines Bauvolumens. Leeres Volumen → Nullwerte. */
export function measureBuild(volume: StatsVolume, opts: BuildStatsOptions = {}): BuildStats {
  const [X, Y, Z] = volume.size;
  const idx = (x: number, y: number, z: number): number => (y * Z + z) * X + x;
  const inside = (x: number, y: number, z: number): boolean => x >= 0 && y >= 0 && z >= 0 && x < X && y < Y && z < Z;
  const names: string[] = [];
  const nameId = new Map<string, number>();
  /** 0 = Luft, sonst Namens-Id + 1. */
  const grid = new Int32Array(X * Y * Z);
  const slabBottom = new Uint8Array(X * Y * Z);
  for (const b of volume.blocks) {
    const [x, y, z] = b.pos;
    if (!inside(x, y, z)) continue;
    const n = blockBaseName(b.name);
    if (AIR.test(n)) continue;
    let id = nameId.get(n);
    if (id === undefined) { id = names.length; names.push(n); nameId.set(n, id); }
    grid[idx(x, y, z)] = id + 1;
    if (n.endsWith('_slab') && (b.properties?.['type'] ?? 'bottom') === 'bottom') slabBottom[idx(x, y, z)] = 1;
  }
  const nameAt = (i: number): string | undefined => (grid[i]! === 0 ? undefined : names[grid[i]! - 1]);

  // 1. Gelände: von unten zusammenhängende Bodenblöcke je Säule
  const colGround = new Int32Array(X * Z).fill(-1);
  const terrain = new Uint8Array(X * Y * Z);
  if (opts.keepTerrain !== true) {
    for (let x = 0; x < X; x++) for (let z = 0; z < Z; z++) {
      let y = 0;
      while (y < Y) {
        const n = nameAt(idx(x, y, z));
        if (n === undefined || !GROUND.test(n)) break;
        terrain[idx(x, y, z)] = 1;
        y++;
      }
      colGround[z * X + x] = y - 1;
    }
  }
  const grounded = [...colGround].filter((g) => g >= 0).sort((a, b) => a - b);
  // Bodenhöhe nur, wenn ein nennenswerter Teil der Säulen Gelände trägt (sonst ist es ein Sockel des Baus)
  const groundY = grounded.length >= 0.25 * X * Z && grounded.length > 0 ? grounded[Math.floor(grounded.length / 2)]! : -1;

  // 2. Bau-Kandidaten und Komponente
  const cand = new Uint8Array(X * Y * Z); // 1 = verbindend, 2 = nur anhängend
  for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
    const i = idx(x, y, z);
    const n = nameAt(i);
    if (n === undefined || terrain[i] === 1 || PLANT.test(n)) continue;
    if (groundY >= 0 && y < groundY) continue;
    cand[i] = ATTACH.test(n) ? 2 : 1;
  }
  const mask = new Uint8Array(X * Y * Z);
  const N6: ReadonlyArray<Vec3i> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  /** Flächen- und Kantennachbarn: Treppendächer stufen über Kanten. */
  const N18: Vec3i[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const k = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (k === 1 || k === 2) N18.push([dx, dy, dz]);
  }
  if (opts.component === 'all') {
    for (let i = 0; i < cand.length; i++) if (cand[i]! > 0) mask[i] = 1;
  } else {
    const comp = new Int32Array(X * Y * Z).fill(-1);
    let best = -1;
    let bestSize = 0;
    let label = 0;
    const stack: number[] = [];
    for (let s = 0; s < cand.length; s++) {
      if (cand[s] !== 1 || comp[s] !== -1) continue;
      let size = 0;
      comp[s] = label;
      stack.push(s);
      while (stack.length > 0) {
        const i = stack.pop()!;
        size++;
        const x = i % X;
        const z = Math.floor(i / X) % Z;
        const y = Math.floor(i / (X * Z));
        for (const [dx, dy, dz] of N18) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (!inside(nx, ny, nz)) continue;
          const j = idx(nx, ny, nz);
          if (cand[j] === 1 && comp[j] === -1) { comp[j] = label; stack.push(j); }
        }
      }
      if (size > bestSize) { bestSize = size; best = label; }
      label++;
    }
    for (let i = 0; i < cand.length; i++) if (cand[i] === 1 && comp[i] === best) mask[i] = 1;
    // Anhängsel: Ketten von Anhängern (Zaun auf Zaun) bis zu 2 Schritte, damit Geländer und hängende Laternen zählen
    for (let step = 0; step < 2; step++) {
      const add: number[] = [];
      for (let i = 0; i < cand.length; i++) {
        if (cand[i] !== 2 || mask[i] === 1) continue;
        const x = i % X, z = Math.floor(i / X) % Z, y = Math.floor(i / (X * Z));
        for (const [dx, dy, dz] of N6) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (inside(nx, ny, nz) && mask[idx(nx, ny, nz)] === 1 && (step === 0 || dy !== 0 || cand[idx(nx, ny, nz)] === 1)) { add.push(i); break; }
        }
      }
      for (const i of add) mask[i] = 1;
    }
  }

  // 3. Kennzahlen
  let minX = X, minY = Y, minZ = Z, maxX = -1, maxY = -1, maxZ = -1;
  const counts = new Map<string, number>();
  let total = 0;
  let nonFull = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const x = i % X, z = Math.floor(i / X) % Z, y = Math.floor(i / (X * Z));
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    const n = nameAt(i)!;
    counts.set(n, (counts.get(n) ?? 0) + 1);
    total++;
    if (NON_FULL.test(n)) nonFull++;
  }
  if (total === 0) {
    return {
      width: 0, depth: 0, height: 0, groundY, footprint: 0, blocks: 0, distinctBlocks: 0, materialFamilies: 0, exteriorDistinctBlocks: 0, exteriorFamilies: 0, entropyBits: 0, topShare: 0,
      nonFullShare: 0, roofPitch: null, roofPitchDeg: null, roofPitchMean: null, flatShare: 0, wallFaces: 0, glassFaces: 0, windowShare: null, topBlocks: [],
    };
  }
  const families = new Set([...counts.keys()].map(materialFamily));
  let entropy = 0;
  for (const c of counts.values()) { const p = c / total; entropy -= p * Math.log2(p); }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

  // Höhenkarte der Oberfläche (Stufen unten = halbe Höhe) und Dachneigung
  const W = maxX - minX + 1;
  const D = maxZ - minZ + 1;
  const H = new Float64Array(W * D).fill(Number.NaN);
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    for (let y = maxY; y >= minY; y--) {
      const i = idx(x, y, z);
      if (mask[i] !== 1 || TOP_DECOR.test(nameAt(i)!)) continue;
      H[(z - minZ) * W + (x - minX)] = y + (slabBottom[i] === 1 ? 0.5 : 1);
      break;
    }
  }
  const slopes: number[] = [];
  let columns = 0;
  let flat = 0;
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    const h = H[z * W + x]!;
    if (Number.isNaN(h)) continue;
    columns++;
    let s = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
      const hn = H[nz * W + nx]!;
      if (Number.isNaN(hn)) continue;
      const d = h - hn;
      if (d > 0 && d <= 3 && d > s) s = d;
    }
    // Säule ohne tiefer liegenden Nachbarn: flach, wenn auch kein höherer Nachbar in Reichweite liegt
    if (s === 0) {
      let up = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
        const hn = H[nz * W + nx]!;
        if (!Number.isNaN(hn) && hn - h > 0 && hn - h <= 3) up = true;
      }
      if (!up) flat++;
    } else slopes.push(s);
  }
  slopes.sort((a, b) => a - b);
  const pitch = slopes.length > 0 ? slopes[Math.floor(slopes.length / 2)]! : null;

  // Außenluft per Flutfüllung über den Quader mit Rand 1; jeder Nicht-Luft-Block außer Pflanzen sperrt (auch Boden)
  const PX = W + 2, PY = maxY - minY + 3, PZ = D + 2;
  const pidx = (x: number, y: number, z: number): number => (y * PZ + z) * PX + x;
  const outside = new Uint8Array(PX * PY * PZ);
  const solidAt = (px: number, py: number, pz: number): boolean => {
    const x = px - 1 + minX, y = py - 1 + minY, z = pz - 1 + minZ;
    if (!inside(x, y, z)) return false;
    const i = idx(x, y, z);
    return mask[i] === 1 || (grid[i] !== 0 && !PLANT.test(nameAt(i)!));
  };
  const queue: number[] = [];
  for (let py = 0; py < PY; py++) for (let pz = 0; pz < PZ; pz++) for (let px = 0; px < PX; px++) {
    if (px !== 0 && py !== 0 && pz !== 0 && px !== PX - 1 && py !== PY - 1 && pz !== PZ - 1) continue;
    if (solidAt(px, py, pz)) continue;
    const q = pidx(px, py, pz);
    outside[q] = 1;
    queue.push(q);
  }
  while (queue.length > 0) {
    const p = queue.pop()!;
    const px = p % PX, pz = Math.floor(p / PX) % PZ, py = Math.floor(p / (PX * PZ));
    for (const [dx, dy, dz] of N6) {
      const nx = px + dx, ny = py + dy, nz = pz + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= PX || ny >= PY || nz >= PZ) continue;
      const q = pidx(nx, ny, nz);
      if (outside[q] === 1 || solidAt(nx, ny, nz)) continue;
      outside[q] = 1;
      queue.push(q);
    }
  }
  const exterior = new Set<string>();
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const x = i % X, z = Math.floor(i / X) % Z, y = Math.floor(i / (X * Z));
    for (const [dx, dy, dz] of N6) {
      if (outside[pidx(x + dx - minX + 1, y + dy - minY + 1, z + dz - minZ + 1)] === 1) { exterior.add(nameAt(i)!); break; }
    }
  }
  let wallFaces = 0;
  let glassFaces = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const n = nameAt(i)!;
    if (ATTACH.test(n) && !GLASS.test(n)) continue;
    const x = i % X, z = Math.floor(i / X) % Z, y = Math.floor(i / (X * Z));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      const px = nx - minX + 1, py = y - minY + 1, pz = nz - minZ + 1;
      if (outside[pidx(px, py, pz)] !== 1) continue;
      // verdeckt durch Gelände oder anderes Nicht-Bau-Material (Boden, Nachbarbau)
      if (inside(nx, y, nz) && grid[idx(nx, y, nz)] !== 0 && !PLANT.test(nameAt(idx(nx, y, nz))!)) continue;
      // Stufe/Sims: unter der Außenzelle liegt Bau-Material (Dachtreppe, Vorsprung) → keine Wandfläche
      if (inside(nx, y - 1, nz) && mask[idx(nx, y - 1, nz)] === 1) continue;
      wallFaces++;
      if (GLASS.test(n)) glassFaces++;
    }
  }

  const base = groundY >= 0 ? Math.max(minY, groundY + 1) : minY;
  return {
    width: W,
    depth: D,
    height: maxY - base + 1,
    groundY,
    footprint: columns,
    blocks: total,
    distinctBlocks: counts.size,
    materialFamilies: families.size,
    exteriorDistinctBlocks: exterior.size,
    exteriorFamilies: new Set([...exterior].map(materialFamily)).size,
    entropyBits: entropy,
    topShare: sorted[0]![1] / total,
    nonFullShare: nonFull / total,
    roofPitch: pitch,
    roofPitchDeg: pitch === null ? null : (Math.atan(pitch) * 180) / Math.PI,
    roofPitchMean: slopes.length > 0 ? slopes.reduce((a, b) => a + b, 0) / slopes.length : null,
    flatShare: columns > 0 ? flat / columns : 0,
    wallFaces,
    glassFaces,
    windowShare: wallFaces > 0 ? glassFaces / wallFaces : null,
    topBlocks: sorted.slice(0, 5).map(([k, c]) => [k, c / total] as const),
  };
}

export const BUILD_STAT_KEYS = [
  'width', 'depth', 'height', 'footprint', 'blocks', 'distinctBlocks', 'materialFamilies', 'exteriorDistinctBlocks', 'exteriorFamilies', 'entropyBits', 'topShare', 'nonFullShare',
  'roofPitch', 'roofPitchDeg', 'roofPitchMean', 'flatShare', 'windowShare',
] as const satisfies ReadonlyArray<keyof BuildStats>;
export type BuildStatKey = (typeof BUILD_STAT_KEYS)[number];

export interface StatSummary {
  readonly key: BuildStatKey;
  readonly n: number;
  readonly median: number | null;
  readonly p25: number | null;
  readonly p75: number | null;
}

/** Median und Quartile je Kennzahl über mehrere Bauten (null-Werte fallen weg). */
export function summarizeBuildStats(stats: readonly BuildStats[]): StatSummary[] {
  return BUILD_STAT_KEYS.map((key) => {
    const vs = stats.map((s) => s[key]).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    const q = (p: number): number | null => {
      if (vs.length === 0) return null;
      const h = (vs.length - 1) * p;
      const lo = Math.floor(h);
      return vs[lo]! + (vs[Math.ceil(h)]! - vs[lo]!) * (h - lo);
    };
    return { key, n: vs.length, median: q(0.5), p25: q(0.25), p75: q(0.75) };
  });
}
