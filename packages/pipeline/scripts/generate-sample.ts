/**
 * Erzeugt die Beispielhäuser und die komplette Beispiel-Base für alle Zielversionen und Themes und schreibt
 * .nbt/.schem/.litematic nach packages/pipeline/out/:
 *  - beispielhaus-<theme>-<version>: eine Etage (Küche, Schlafzimmer, Lager, Schmiede)
 *  - beispielhaus-2etagen-<theme>-<version>: zweistöckig mit Treppe (Obergeschoss: Schlafzimmer, Alchemie,
 *    Bibliothek; Schmiede mit Pultdach an der Wand des Obergeschosses)
 *  - beispiel-base-<theme>-<version>: komplette Base (`generateBase`): 2 Etagen mit Treppe, 6 Raumtypen,
 *    Satteldach, Gelände mit Feld, Garten und Bäumen, Mauerring mit 4 Türmen und Tor
 * Aufruf: npm run sample -w @mcda/pipeline [theme]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_VERSIONS, renderShellPlan, type Project } from '@mcda/blueprint';
import { exportFile } from '@mcda/export/node';
import { renderAscii } from '@mcda/furnishing';
import {
  completeBase, furnishingGeometry, generate, generateBase, placedFor, sampleHouse, toExport, twoStoryHouse,
  type BaseWorld, type World,
} from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const ctx = nodeContext(join(here, '../../../catalog'));
const outDir = join(here, '../out');
mkdirSync(outDir, { recursive: true });

const themeArg = process.argv[2];
const versions = Object.keys(TARGET_VERSIONS) as (keyof typeof TARGET_VERSIONS)[];
const themes = themeArg !== undefined ? [themeArg] : ctx.themes.ids();

function write(file: string, p: Project, world: World): number {
  const ev = toExport(p, world);
  for (const fmt of ['nbt', 'schem', 'litematic'] as const) writeFileSync(join(outDir, `${file}.${fmt}`), exportFile(fmt, ev));
  return ev.blocks.length;
}

function describeRooms(p: Project, world: World): void {
  for (const f of [...new Set(p.state.rooms.map((r) => r.floorIndex))].sort((a, b) => a - b)) {
    console.log(`\nEtage ${f} (Hülle)\n${renderShellPlan(world.shell, f)}`);
  }
  for (const room of p.state.rooms) {
    const info = furnishingGeometry(world.shell.rooms.get(room.id)!);
    const placed = p.state.placements.filter((x) => x.roomId === room.id).map((x) => placedFor(x, ctx.catalog));
    console.log(`\n${room.id} (Etage ${room.floorIndex}) – ${ctx.catalog.roomType(room.roomTypeId).name}\n${renderAscii(info, placed, (id) => ctx.catalog.get(id).tags)}`);
  }
}

/**
 * Draufsicht der Base (1 Zeichen je Spalte, oben = Norden): # Haus, O Turm, W Mauer, : Tordurchgang,
 * T Baum, b Busch, w Feldfrucht, ~ Wasser, + Zaun, g Beet, = Weg, o Blume, . Wiese.
 */
function basePlan(world: BaseWorld): string {
  const site = world.surroundings.site;
  if (site === undefined) return '';
  const g = site.grid;
  const top = new Map<string, string>();
  const rank = '.o=gw~+bTW:O#';
  const mark = (x: number, z: number, ch: string): void => {
    const k = `${x},${z}`;
    const prev = top.get(k);
    if (prev === undefined || rank.indexOf(ch) > rank.indexOf(prev)) top.set(k, ch);
  };
  // Die Welt-Hülle enthält auch die Zusatz-Zellen; das Haus sind nur die eigenen Hüllzellen
  for (const c of world.shell.cells) if (c.kind !== 'terrain' && c.kind !== 'plant' && c.kind !== 'fort') mark(c.pos[0], c.pos[2], '#');
  const gates = new Set((world.surroundings.structures?.walls ?? []).flatMap((w) => w.gates.flatMap((gt) => gt.passage.map((p) => `${p[0]},${p[2]}`))));
  for (const c of world.surroundings.structures?.cells ?? []) {
    const k = `${c.pos[0]},${c.pos[2]}`;
    mark(c.pos[0], c.pos[2], gates.has(k) ? ':' : c.roomId?.includes('.t') === true ? 'O' : 'W');
  }
  for (const c of world.surroundings.cells) {
    if (c.kind !== 'plant') continue;
    const ch = c.role.startsWith('log') || (c.role.startsWith('leaves') && c.role !== 'leaves_bush') ? 'T' : c.role === 'leaves_bush' ? 'b'
      : c.role.startsWith('crop') ? 'w' : c.role === 'fence_outdoor' ? '+' : c.role.startsWith('flower') ? 'o' : '.';
    mark(c.pos[0], c.pos[2], ch);
  }
  const surf: Record<string, string> = { water: '~', garden_soil: 'g', farmland: 'g', ground_path: '=', ground_yard: '=' };
  const rows: string[] = [];
  for (let z = g.minZ; z < g.minZ + g.d; z++) {
    let row = '';
    for (let x = g.minX; x < g.minX + g.w; x++) row += top.get(`${x},${z}`) ?? surf[site.surface[g.idx(x, z)]!] ?? '.';
    rows.push(row);
  }
  return rows.join('\n');
}

const houses: ReadonlyArray<{ readonly file: string; readonly build: (v: keyof typeof TARGET_VERSIONS, theme: string) => Project }> = [
  { file: 'beispielhaus', build: (v, theme) => sampleHouse(v, theme) },
  { file: 'beispielhaus-2etagen', build: (v, theme) => twoStoryHouse(v, theme) },
];

for (const house of houses) {
  for (const version of versions) {
    for (const theme of themes) {
      const p = house.build(version, theme);
      const t0 = performance.now();
      const world = generate(p, ctx, { roof: 'hip' });
      const ms = (performance.now() - t0).toFixed(0);
      const blocks = write(`${house.file}-${theme}-${version}`, p, world);
      const v = world.materialized.violations;
      const spawn = v.filter((x) => x.kind === 'spawn').length;
      const lit = world.lighting?.rooms.reduce((n, r) => n + r.added, 0) ?? 0;
      const floors = new Set(p.state.rooms.map((r) => r.floorIndex)).size;
      console.log(`${house.file} ${version} · ${theme}: ${floors} Etage(n), ${blocks} Blöcke, ${p.state.placements.length} Möbel (Licht-Pass +${lit}), ${ms} ms, Verstöße ${v.length - spawn}, Spawn-Warnungen ${spawn}${world.warnings.length > 0 ? `, Hinweise: ${world.warnings.join(' | ')}` : ''}`);
      if (version === versions[0] && theme === themes[0]) describeRooms(p, world);
    }
  }
}

// Komplette Base: Haus + Gelände + Mauerring in einer Welt (Laufzeit = generateBase, ohne Dateiausgabe)
for (const version of versions) {
  for (const theme of themes) {
    const base = completeBase(version, theme);
    const t0 = performance.now();
    const world = generateBase(base.project, ctx, base.options);
    const ms = (performance.now() - t0).toFixed(0);
    const blocks = write(`beispiel-base-${theme}-${version}`, base.project, world);
    const v = world.materialized.violations;
    const spawn = v.filter((x) => x.kind === 'spawn').length;
    const s = world.surroundings;
    console.log(`beispiel-base ${version} · ${theme}: ${blocks} Blöcke (Gelände/Bauwerke ${s.cells.length} Zellen), ${base.project.state.placements.length} Möbel, ${s.structures?.towers.length ?? 0} Türme, ${s.site?.trees.length ?? 0} Bäume, ${ms} ms, Verstöße ${v.length - spawn}, Spawn-Warnungen ${spawn}${world.warnings.length > 0 ? `, Hinweise: ${world.warnings.join(' | ')}` : ''}`);
    if (version === versions[0] && theme === themes[0]) {
      console.log(`\nBeispiel-Base (Draufsicht)\n${basePlan(world)}`);
      describeRooms(base.project, world);
    }
  }
}
