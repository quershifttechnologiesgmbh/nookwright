/**
 * Test-Werkzeug: Validierung eines Volumens gegen einen Registry-Auszug (misode/mcmeta summary,
 * Dateien in test/data/ aus Spike T1): Block-IDs, VOLLSTÄNDIGE und gültige Properties,
 * Block-Entity-/Entity-/Item-IDs, Data-Component-Schlüssel, Gemälde-Varianten, Banner-Muster.
 *
 * Bewusst NICHT Teil der Paket-API: Registry-Wissen gehört in den ACL `@mcda/platform`.
 * Offen: auf die Registry aus `@mcda/platform` umstellen, sobald sie steht.
 */
import { normalizeName, type ExportVolume, type NbtTag } from '../../src/index.js';

export interface RegistrySnapshot {
  /** name (ohne Namespace) → [erlaubte Werte je Property, Defaults] */
  blocks: Record<string, [Record<string, string[]>, Record<string, string>]>;
  block: string[];
  block_entity_type: string[];
  entity_type: string[];
  item: string[];
  painting_variant: string[];
  banner_pattern: string[];
  data_component_type: string[];
}

const strip = (id: string) => normalizeName(id).replace(/^minecraft:/, '');

export function validateAgainstRegistry(v: ExportVolume, reg: RegistrySnapshot): string[] {
  const errs: string[] = [];
  const blockSet = new Set(reg.block);
  const beSet = new Set(reg.block_entity_type);
  const entSet = new Set(reg.entity_type);
  const itemSet = new Set(reg.item);
  const paintSet = new Set(reg.painting_variant);
  const bannerSet = new Set(reg.banner_pattern);
  const compSet = new Set(reg.data_component_type);

  const checkNbt = (t: NbtTag, where: string): void => {
    if (t.type === 'list') { t.value.forEach((x, i) => checkNbt(x, `${where}[${i}]`)); return; }
    if (t.type !== 'compound') return;
    const c = t.value;
    const id = c['id'];
    const isItem = id?.type === 'string' && (c['count'] !== undefined || c['Count'] !== undefined);
    if (isItem && !itemSet.has(strip(id.value))) errs.push(`${where}: unbekanntes Item ${id.value}`);
    const comps = c['components'];
    if (isItem && comps?.type === 'compound') {
      for (const k of Object.keys(comps.value)) if (!compSet.has(strip(k))) errs.push(`${where}: unbekannte Component ${k}`);
    }
    const pattern = c['pattern'];
    if (pattern?.type === 'string' && c['color'] !== undefined && !bannerSet.has(strip(pattern.value))) {
      errs.push(`${where}: unbekanntes Banner-Muster ${pattern.value}`);
    }
    for (const [k, val] of Object.entries(c)) checkNbt(val, `${where}.${k}`);
  };

  for (const b of v.blocks) {
    const where = `${b.name}@${b.pos.join(',')}`;
    const name = strip(b.name);
    if (!blockSet.has(name)) { errs.push(`${where}: Block existiert nicht`); continue; }
    const def = reg.blocks[name];
    const props = b.properties ?? {};
    if (!def) {
      if (Object.keys(props).length > 0) errs.push(`${where}: Block hat keine Properties`);
    } else {
      const [allowed] = def;
      for (const [k, val] of Object.entries(props)) {
        const vals = allowed[k];
        if (!vals) errs.push(`${where}: unbekannte Property ${k}`);
        else if (!vals.includes(val)) errs.push(`${where}: ${k}=${val} nicht erlaubt (${vals.join('/')})`);
      }
      for (const k of Object.keys(allowed)) if (!(k in props)) errs.push(`${where}: Property ${k} fehlt (Default der Ladeversion greift!)`);
    }
    if (b.blockEntity) {
      const be = b.blockEntity;
      const id = be.value['id'];
      if (id?.type !== 'string' || !beSet.has(strip(id.value))) errs.push(`${where}: Block-Entity-Typ unbekannt`);
      checkNbt(be, `${where}.be`);
    }
  }
  for (const [i, e] of v.entities.entries()) {
    const c = e.nbt;
    const id = c.value['id'];
    const where = `entity#${i}`;
    if (id?.type !== 'string' || !entSet.has(strip(id.value))) { errs.push(`${where}: Entity-Typ unbekannt`); continue; }
    const variant = c.value['variant'];
    if (strip(id.value) === 'painting' && (variant?.type !== 'string' || !paintSet.has(strip(variant.value)))) {
      errs.push(`${where}: Gemälde-Variante unbekannt`);
    }
    for (const [k, val] of Object.entries(c.value)) if (k !== 'id') checkNbt(val, `${where}.${k}`);
  }
  return errs;
}
