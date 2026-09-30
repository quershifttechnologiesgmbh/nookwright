/** Test-Hilfen für Licht: kleines Volumen als VoxelSource und selbst geschriebene Lichtregeln. */
import type { LightRules } from '../src/lighting.js';
import type { VoxelSource } from '../src/structure.js';

export type Block = readonly [number, number, number, string, Record<string, string>?];

/** Kleines Volumen als VoxelSource (Welt = lokal, Ursprung wählbar). */
export function voxels(size: readonly [number, number, number], blocks: readonly Block[], origin: readonly [number, number, number] = [0, 0, 0]): VoxelSource {
  return {
    origin, size,
    *cells() {
      for (const [x, y, z, name, properties] of blocks) yield { pos: [x + origin[0], y + origin[1], z + origin[2]] as const, state: { name, properties: properties ?? {} } };
    },
  };
}

/** Selbst geschriebene Testregeln (unabhängig von den Plattform-Daten). */
export const TEST_RULES: LightRules = {
  emission: (s) => (s.name === 'lantern' ? 15 : s.name === 'torch' ? 14 : s.name === 'candle' ? 3 * Number(s.properties['candles'] ?? '1') : 0),
  opaque: (s) => s.name === 'stone' || s.name === 'planks',
  blocksFace: (s, f) => s.name === 'slab' && f === 'down',
  attenuation: (s) => (s.name === 'leaves' ? 1 : 0),
  occludesAo: (s) => s.name === 'stone' || s.name === 'planks' || s.name === 'leaves',
};

