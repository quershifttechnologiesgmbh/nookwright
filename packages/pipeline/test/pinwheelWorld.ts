/**
 * Windrad-Prüfung auf Blockebene der fertigen Welt (Review F, Auflage A1): Draufsicht = oberster Block je Säule über
 * den Muster-Zonen (Platz, Hof, Garten, Feld) plus 1 Zelle Rand. Marke = Blockname; dazu Gruppen ähnlicher Blöcke
 * (Steine, Böden, Pflanzen), damit Mischungen gleicher Optik nicht durchrutschen. Geprüft werden exakte chirale
 * C4-Fenster bis 13 × 13 und jede zusammenhängende Figur allein (`findPinwheelFigures`).
 */
import { findPinwheelFigures, findPinwheels, hashSeed } from '@mcda/core';
import { WorldView, scanPinwheels, type PlatformView } from '@mcda/materialize';
import type { BaseWorld, World } from '../src/index.js';

const GROUPS: readonly RegExp[] = [
  /stone|cobble|andesite|diorite|granite|tuff|deepslate|brick|gravel|basalt|blackstone|calcite|sandstone|terracotta|concrete|quartz|prismarine/,
  /dirt|grass_block|podzol|mycelium|mud|farmland|sand$|clay|moss_block|path/,
  /flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily|rose|peony|lilac|bush|leaves|grass$|fern|wheat|carrots|potatoes|beetroots/,
];

export function worldPinwheels(world: BaseWorld, zoneKinds: ReadonlyMap<string, string>, all = false): string[] {
  const site = world.surroundings.site;
  if (site === undefined) return [];
  const g = site.grid;
  const inZone = new Set<string>();
  site.plan.zone.forEach((z, i) => {
    if (!all && (z === null || !['plaza', 'yard', 'garden', 'field'].includes(zoneKinds.get(z) ?? ''))) return;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) inZone.add(`${g.x(i) + dx},${g.z(i) + dz}`);
  });
  if (inZone.size === 0) return [];
  const top = new Map<string, { y: number; name: string }>();
  const vol = world.materialized.volume;
  for (const owner of vol.owners()) {
    for (const c of vol.cellsOf(owner)) {
      const k = `${c.pos[0]},${c.pos[2]}`;
      if (!inZone.has(k) || /air$/.test(c.state.name)) continue;
      const t = top.get(k);
      if (t === undefined || c.pos[1] > t.y) top.set(k, { y: c.pos[1], name: c.state.name });
    }
  }
  const code = new Map<string, number>();
  const names = new Map<number, string>();
  const label = (x: number, z: number): number | undefined => {
    const t = top.get(`${x},${z}`);
    if (t === undefined) return undefined;
    const h = hashSeed(t.name) & 0x7fffffff;
    names.set(h, t.name);
    return h;
  };
  for (const k of top.keys()) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    code.set(k, label(x, z)!);
  }
  const xs = [...top.keys()].map((k) => Number(k.split(',')[0]));
  const zs = [...top.keys()].map((k) => Number(k.split(',')[1]));
  const box = { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) };
  const at = (x: number, z: number): number | undefined => code.get(`${x},${z}`);
  const labels = [...names.keys()];
  const groups = GROUPS.map((re) => labels.filter((l) => re.test(names.get(l)!))).filter((gr) => gr.length > 1);
  return [
    ...findPinwheels(at, box).map((h) => `Fenster ${h.size} bei ${h.x},${h.z}`),
    ...findPinwheelFigures(at, box, groups).map((h) => `Figur ${h.size} bei ${h.x},${h.z}`),
  ];
}

/**
 * W8-G: ganze fertige Welt mit dem Wächter-Detektor (`scanPinwheels`, @mcda/materialize) – Draufsicht, jede Schicht,
 * jede senkrechte Ebene; je Block, Sichtklasse und „Figur vor Boden“. Liefert je Figur eine Kurzbeschreibung.
 */
export function worldFigures(world: World, platform: PlatformView): string[] {
  return scanPinwheels(new WorldView(world.materialized.volume, platform)).map((f) =>
    `${f.plane}${f.plane === 'top' ? '' : `=${f.at}`} ${f.grouping}:${f.cls} ${f.size}×${f.size} (${f.via}, Drehung ${f.rotDiff}, Spiegel ${f.mirrorDiff}) bei ${f.cells[0]!.join(',')}`);
}
