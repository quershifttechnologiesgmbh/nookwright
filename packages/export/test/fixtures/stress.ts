/**
 * Stress-Fixtures für Paletten-/Packing-Grenzfälle (kein In-Game-Ziel, nur Formatprüfung):
 * - viele verschiedene echte Block-States (Sponge-VarInts ≥ 128 → mehrbytig; Litematica bits > 4
 *   → HashMap-Palette, Einträge über Long-Grenzen)
 * - Größen, die nicht durch 64/bits teilbar sind.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_LABEL, type ExportBlock, type ExportVolume } from '../../src/index.js';
import type { RegistrySnapshot } from './registry-check.js';

const here = dirname(fileURLToPath(import.meta.url));

export function loadRegistry(dataVersion: number): RegistrySnapshot {
  const label = VERSION_LABEL[dataVersion];
  if (!label) throw new Error(`Keine Registry für DataVersion ${dataVersion}`);
  return JSON.parse(readFileSync(join(here, '..', 'data', `registry-${label}.json`), 'utf8')) as RegistrySnapshot;
}

/** Deterministischer PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface StateSpec { readonly name: string; readonly properties?: Record<string, string> }

/** Default-States der ersten `count` Blöcke (ohne Luftvarianten/structure_void), alle Properties gesetzt. */
export function registryStates(reg: RegistrySnapshot, count: number): StateSpec[] {
  const out: StateSpec[] = [];
  for (const name of [...reg.block].sort()) {
    if (name.endsWith('air') || name === 'structure_void') continue; // Luft implizit; Void entfällt in .nbt
    const def = reg.blocks[name];
    const props = def ? def[1] : {};
    out.push(Object.keys(props).length > 0 ? { name: `minecraft:${name}`, properties: { ...props } } : { name: `minecraft:${name}` });
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Zufallsvolumen mit genau `paletteSize` verschiedenen Nicht-Luft-States (plus Luft-Lücken).
 * Jeder State kommt mindestens einmal vor.
 */
export function buildStressVolume(dataVersion: number, size: readonly [number, number, number], paletteSize: number, seed = 1): ExportVolume {
  const reg = loadRegistry(dataVersion);
  const states = registryStates(reg, paletteSize);
  if (states.length < paletteSize) throw new Error('Registry zu klein');
  const r = rng(seed);
  const blocks: ExportBlock[] = [];
  const volume = size[0] * size[1] * size[2];
  if (volume < paletteSize) throw new Error('Volumen zu klein für Palette');
  let i = 0;
  for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++, i++) {
    const forced = i < paletteSize ? states[i] : undefined; // jeder State mind. einmal
    if (!forced && r() < 0.15) continue; // Luft
    const s = forced ?? states[Math.floor(r() * states.length)]!;
    blocks.push({ pos: [x, y, z], ...s });
  }
  return { name: `stress_p${paletteSize}`, author: 'stress', dataVersion, size, blocks, entities: [] };
}
