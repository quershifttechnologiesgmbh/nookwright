/**
 * Gebündelter Qualitätsbericht (research/58 §4, P17): F1–F4 für alle 12 Bautypen **plus** Lichtbefund (dunkle
 * Zellen) und Warnungen je Bautyp sowie die Palettenkennzahl P1 des Themes – mit Version, Theme, Seed und
 * Regelzustand im Kopf. **Kein Gesamtscore:** die Kennzahlen bleiben einzeln lesbar, und was dieser Lauf nicht
 * messen kann, steht ausdrücklich darunter (I1/I2 nur in Tests, L1–L3 im eigenen Werkzeug
 * `spikes/q3_landschaft.ts`, Spielabnahmen nur im Spiel).
 *
 * Aufruf: `npm run quality` (schreibt eine Tabelle) bzw. `npm run quality -- --json <datei>` (Rohwerte als JSON).
 * `--plain` misst dieselben Welten OHNE die Pflichtregeln (`FacadeStyle.rules`) – so entsteht der Vorher/Nachher-
 * Vergleich in einem Lauf, auch nachdem die Regeln zum Standard geworden sind.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_VERSIONS, type FacadeStyle } from '@mcda/blueprint';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { facadeQuality, facadeTargetMisses, type FacadeQuality } from '../src/quality-f.js';
import { P1Percent, P1Text } from '../src/quality-p1.js';
import { generateBase, planBuildOptions, projectFromBuildingType, withoutPilastersForTheme } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(here, '../../../catalog');
const ctx = nodeContext(ROOT);

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const plain = args.includes('--plain');
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? 7);
const theme = args.find((a) => ctx.themes.ids().includes(a)) ?? 'medieval';

function loadType(id: string): BuildingTypeDef {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${id}.json5`, 'utf8'), `${id}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}

const ids = readdirSync(`${ROOT}/buildingtypes`).filter((f) => f.endsWith('.json5')).map((f) => f.replace('.json5', '')).sort();

interface Row extends FacadeQuality {
  readonly type: string;
  readonly rules: boolean;
  /** Begehbare Zellen ohne Licht in der fertigen Welt (Spawn-Schutz, research/58 §4). */
  readonly darkCells: number;
  /** Warnungen der Welt (Gelände, Zugang, Struktur) – Zahl, damit Auffälligkeiten nicht untergehen. */
  readonly warnings: number;
}

const rows: Row[] = [];
for (const id of ids) {
  const def = loadType(id);
  const res = projectFromBuildingType(def, { themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'] }, seed, ctx);
  const build = withoutPilastersForTheme(planBuildOptions(res.plan), ctx.themes, theme);
  const withRules = build.facade;
  const withoutRules: FacadeStyle | undefined = withRules === undefined ? undefined : ((): FacadeStyle => {
    const { rules: _, ...rest } = withRules;
    return rest;
  })();
  const chosen = plain ? withoutRules : withRules;
  const opts = { ...build, ...(chosen !== undefined ? { facade: chosen } : {}) };
  const world = generateBase(res.project, ctx, opts);
  const q = facadeQuality(world.shell, world.materialized.volume);
  rows.push({
    type: id,
    rules: chosen?.rules !== undefined,
    ...q,
    darkCells: world.materialized.light.darkCells.length,
    warnings: world.warnings.length,
  });
}

const pct = (v: number): string => `${(v * 100).toFixed(1)} %`.padStart(6);
console.log(`Qualitätsbericht (research/58 §4, P17) · Minecraft 1.21.11 · Theme ${theme} · Seed ${seed} · ${plain ? 'OHNE' : 'MIT'} Pflichtregeln`);
console.log(`Palette P1 (Wand ↔ Dach ↔ Kante): ${P1Percent(ctx.themes.get(theme)) === undefined ? 'keine Verlaufsrolle im Theme' : `${P1Percent(ctx.themes.get(theme))!.toFixed(1)} % des Mindestabstands`} – ${P1Text(ctx.themes.get(theme))}`);
console.log('Nicht in diesem Lauf: I1/I2 (Raumtests), L1–L3 (spikes/q3_landschaft.ts), Spielabnahmen (Ernten, Öfen, Farmen).\n');
console.log('Bautyp            F1      F2     F3    F4   Zellen  Achsen  Blöcke  dunkel  Warn.  Zielbänder');
for (const r of rows) {
  const miss = facadeTargetMisses(r, r.type);
  console.log(
    `${r.type.padEnd(17)} ${pct(r.f1)} ${pct(r.f2)} ${r.f3.toFixed(1).padStart(5)} ${String(r.f4).padStart(4)} ${String(r.facadeCells).padStart(7)} ${String(r.windowAxes).padStart(7)} ${String(r.distinctBlocks).padStart(7)} ${String(r.darkCells).padStart(7)} ${String(r.warnings).padStart(6)}  ${miss.length === 0 ? 'ok' : miss.join('; ')}`,
  );
}
const bad = rows.filter((r) => facadeTargetMisses(r, r.type).length > 0).length;
const dunkel = rows.reduce((n, r) => n + r.darkCells, 0);
console.log(`\n${rows.length - bad}/${rows.length} Bautypen im Fassadenzielband · ${dunkel} dunkle Zelle(n) über alle Bautypen.`);
if (jsonFile !== undefined) {
  writeFileSync(jsonFile, `${JSON.stringify({ theme, seed, plain, rows }, null, 2)}\n`);
  console.log(`Rohwerte: ${jsonFile}`);
}
