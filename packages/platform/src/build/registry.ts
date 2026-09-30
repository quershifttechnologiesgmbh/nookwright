/** Build: Rohdaten (misode/mcmeta) → RegistryData. Rein funktional. */
import type { BlockDef, RegistryData } from '../types.js';

/** Format von mcmeta `blocks/data.json`: Block → [Properties→Werte, Default-State] */
export type McmetaBlocks = Record<string, [Record<string, string[]>, Record<string, string>]>;
/** Format von mcmeta `data/tag/block/data.json` */
export type McmetaTags = Record<string, { values: (string | { id: string; required?: boolean })[] }>;

const strip = (s: string): string => (s.startsWith('minecraft:') ? s.slice('minecraft:'.length) : s);

export function convertBlocks(raw: McmetaBlocks): Record<string, BlockDef> {
  const out: Record<string, BlockDef> = {};
  for (const name of Object.keys(raw).sort()) {
    const entry = raw[name];
    if (!entry) continue;
    const [props, def] = entry;
    // Konsistenzprüfung: Default muss jede Property mit gültigem Wert setzen
    for (const [k, vals] of Object.entries(props)) {
      const d = def[k];
      if (d === undefined || !vals.includes(d)) {
        throw new Error(`mcmeta: Default von ${name}.${k} ungültig (${String(d)})`);
      }
    }
    out[name] = { properties: props, default: def };
  }
  return out;
}

/** Tags kompakt speichern: Namespace entfernen, Verweise als `#tag` belassen (Auflösung: resolveTag). */
export function compactTags(raw: McmetaTags): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const tag of Object.keys(raw).sort()) {
    out[tag] = (raw[tag]?.values ?? []).map((v) => {
      const id = typeof v === 'string' ? v : v.id;
      return id.startsWith('#') ? `#${strip(id.slice(1))}` : strip(id);
    });
  }
  return out;
}

export function buildRegistry(input: {
  version: string;
  dataVersion: number;
  blocks: McmetaBlocks;
  items: string[];
  lootTables: string[];
  blockTags: McmetaTags;
}): RegistryData {
  return {
    version: input.version,
    dataVersion: input.dataVersion,
    source: `misode/mcmeta tags ${input.version}-summary, ${input.version}-registries`,
    blocks: convertBlocks(input.blocks),
    items: [...input.items].map(strip).sort(),
    lootTables: [...input.lootTables].map(strip).sort(),
    blockTags: compactTags(input.blockTags),
  };
}
