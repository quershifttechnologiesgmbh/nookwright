/**
 * P15/Q5 – Story-Zustand (research/55 §2/§3, Bericht64): **dasselbe Haus, derselbe Seed, nur der Zustand
 * unterscheidet sich** → messbar andere Materialanteile, aber **identische Geometrie** und **erfüllte
 * Erreichbarkeit** (keine blockierten Türen, Licht-Pass ohne dunkle Zellen, Pflichtstationen erreichbar).
 *
 * Der Test hält die drei Zusagen des additiven Vertrags fest:
 *  1. **Bitgleichheit ohne das Feld** – feste Prüfsummen über zwei Beispielhäuser. Sie stammen aus einem Lauf
 *     **vor** dieser Änderung (auf `origin/main`); keine Zeile des Story-Passes wird ohne `storyState` betreten.
 *  2. **Zahlen je Zustand** – Moos/Flechten, Risse, entrindetes Holz, vergraute Farbflächen, dunkle Zellen,
 *     Warnungen, Verstöße. `bewohnt` ist der Referenzzustand (Faktor 1).
 *  3. **Determinismus** – zweimal derselbe Zustand ergibt dieselbe Welt.
 */
import { fileURLToPath } from 'node:url';
import { Project, TARGET_VERSIONS, type StoryState } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { facesRoom, shellContext } from '@mcda/materialize';
import { describe, expect, it } from 'vitest';
import { generate, type World } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/** Beispielhaus wie in `stable-ids.test.ts`: zwei Räume, mittelalterliches Theme (hat `decor.weathering`). */
function house(state?: StoryState): Project {
  const p = Project.create({ id: 'q5', name: 'Q5', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  if (state !== undefined) p.setStoryState(state);
  return p;
}

type Cell = { readonly pos: readonly number[]; readonly state: { readonly name: string } };

/** FNV-1a über sortierte `pos|block`-Zeilen (gleiche Form wie das Prüfsummen-Netz der anderen Pässe). */
function checksum(world: World): string {
  const rows = [...world.materialized.volume.cells()].map((c) => `${c.pos.join(',')}|${c.state.name}`).sort();
  let h = 0x811c9dc5;
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) {
      h ^= r.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  }
  return `${rows.length}:${h.toString(16).padStart(8, '0')}`;
}

/** Materialanteile und Befunde eines Laufs – die Zahlen, die der Bericht je Zustand nennt. */
interface Numbers {
  /** Nicht-Luft-Blöcke im Volumen. */
  readonly blocks: number;
  /** `*mossy*` (Flechten/Bemoosung am Stein). */
  readonly mossy: number;
  /** `*cracked*` (Risse im Stein/Dach). */
  readonly cracked: number;
  /** `stripped_*` (entrindetes/vergrautes Holz). */
  readonly stripped: number;
  /** Graue Farbflächen (`gray_*`/`light_gray_*` in Wolle, Terrakotta, Beton, Glas). */
  readonly grey: number;
  /** Begehbare Innenzellen ohne Blocklicht (Spawn-Report). */
  readonly darkCells: number;
  /** Warnungen des Licht-Passes. */
  readonly lightWarnings: number;
  /** Harte Verstöße der Materialisierung (Schwere `error`). */
  readonly errors: number;
}

const count = (cells: Iterable<Cell>, re: RegExp): number => [...cells].filter((c) => re.test(c.state.name)).length;

function numbers(world: World, warnings: readonly string[]): Numbers {
  const m = world.materialized;
  return {
    blocks: [...m.volume.cells()].length,
    mossy: count(m.volume.cells(), /mossy/),
    cracked: count(m.volume.cells(), /cracked/),
    stripped: count(m.volume.cells(), /^stripped_/),
    grey: count(m.volume.cells(), /^(gray|light_gray)_(wool|terracotta|concrete|stained_glass)/),
    darkCells: m.light.darkCells.length,
    lightWarnings: warnings.filter((w) => w.includes('ohne Licht')).length,
    errors: m.violations.filter((v) => v.severity === 'error').length,
  };
}

/** Geometrie = Menge der belegten Positionen; sie darf sich zwischen Zuständen NIE ändern. */
const geometry = (world: World): readonly string[] => [...world.materialized.volume.cells()].map((c) => c.pos.join(',')).sort();

const STATES: readonly StoryState[] = ['neu', 'bewohnt', 'verlassen', 'verfallen', 'belagert'];
/** Gemessene Zahlen je Zustand (Referenzhaus, Seed 2026, mittelalterliches Theme, 1.21.11). */
const EXPECTED: Readonly<Record<StoryState, Numbers>> = {
  // Q5: gemessen am 25.09.2026 (Referenzhaus, Seed 2026, mittelalterliches Theme, 1.21.11). Geometrie und
  // Erreichbarkeit sind in allen fünf Zuständen identisch (544 Blöcke, 0 dunkle Zellen, 0 Lichtwarnungen,
  // 0 Fehler); die Zustände unterscheiden sich nur in den Materialspuren.
  // W2 (26.09.2026): Regel I1/I3/I6 – 592 statt 544 Blöcke (Innenhaut, Teppich-Läufer, Deko-Budget); die Spuren der
  // Hülle (Moos, Risse, entrindet) sind unverändert – die Innenhaut verwittert nicht.
  // W2 (26.09.2026): K8-Reparatur (P0-B S1) – das Rauschfeld hängt wieder an der Fläche statt an der Zell-ID; dazu
  // Regeln W4/W5/W6 im Theme medieval (drei Grundblöcke, Fassadenverlauf, Balken statt Fundament, ohne Moos auf
  // Wänden mit Raum dahinter). Geometrie und Befunde unverändert, die Reihenfolge der Zustände bleibt.
  // W3 (27.09.2026): Signatur-Anordnung und Licht-Budget – 592 → 594 Blöcke, Spuren unverändert
  // W4 (27.09.2026): W4-E Dachraum-Licht (+1 Laterne auf dem Dachboden, 594 → 595) und `interiorFaces` im Zustand
  // (W2-FC §8): Wände mit Raum dahinter verwittern auch im Zustand nicht mehr – weniger Moos/Risse. W4-G (Review M6):
  // Dielen nur aus Brettern (keine entrindeten Hölzer im Boden). Reihenfolge der Zustände bleibt.
  // W7 (27.09.2026): 595 → 599 Blöcke (Küchentisch als Insel, Laterne am Himmelbett), Spuren unverändert.
  // Vorher (W3): neu 0/0/10, bewohnt 20/6/24, verlassen 59/8/85, verfallen 76/15/97, belagert 16/9/59 (Moos/Risse/entrindet).
  neu: { blocks: 598, mossy: 0, cracked: 0, stripped: 9, grey: 0, darkCells: 0, lightWarnings: 0, errors: 0 },
  bewohnt: { blocks: 598, mossy: 9, cracked: 4, stripped: 23, grey: 0, darkCells: 0, lightWarnings: 0, errors: 0 },
  verlassen: { blocks: 598, mossy: 26, cracked: 5, stripped: 85, grey: 3, darkCells: 0, lightWarnings: 0, errors: 0 },
  verfallen: { blocks: 598, mossy: 29, cracked: 12, stripped: 97, grey: 3, darkCells: 0, lightWarnings: 0, errors: 0 },
  belagert: { blocks: 598, mossy: 6, cracked: 5, stripped: 59, grey: 3, darkCells: 0, lightWarnings: 0, errors: 0 },
  // FN-Integration (2026-09-29): 599 → 598 Blöcke in allen Zuständen (Möbel-Neuordnung durch die FN-Raumtypen), Spuren
  // (Moos/Risse/entrindet/grau) und dunkle Zellen (0) unverändert.
};

describe('Q5/P15 Story-Zustand: gleiches Haus, andere Spuren', () => {
  it('ohne `storyState` bitgleich: feste Prüfsummen der Beispielhäuser', () => {
    // Werte stammen von einem Lauf VOR dieser Änderung (`origin/main`, gleiche Fixtures) und dürfen sich nicht bewegen.
    // Q5: bewusst neu gesetzt (25.09.2026) – der alte Wert stammte von vor K8 (stabile Zell-IDs), P07 und Q3.
    // Auf sauberem `origin/main` (03ea47a) liefert dieselbe Fixture exakt diesen Wert, die Zusage „ohne
    // `storyState` bitgleich" ist damit belegt und nicht abgesenkt.
    // W2 (26.09.2026): Regel I1/I3/I6 – Innenhaut (Paneele, Leisten, Ständer), Läufer als Teppich, Deko-Budget und
    // Hauptweg ändern die Welt bewusst (544 → 592 Blöcke). Alter Wert: 544:29aed06b.
    // W2 (26.09.2026): K8-Reparatur (P0-B S1) – Rauschfeld je Fläche statt je Zell-ID (vorher '544:29aed06b', dann
    // '544:5f72b0cb'); W2 (26.09.2026): Regeln W4/W5/W6/D1 – Theme medieval neu.
    // Integration W2 (26.09.2026): Innenhaut (592 Blöcke) + K8-Reparatur/Themes (Spuren wie W2-FC) zusammen gemessen.
    // W3 (27.09.2026): Signatur-Anordnung und Licht-Budget (I7) – Arbeitszeile am Herd, niedrige Möbel unter dem Fenster,
    // Leuchten im Budget an Ankern (592 → 594 Blöcke, Spuren unverändert). Alter Wert: 592:4674e1d2.
    // W4 (27.09.2026): W4-E Dachraum-Licht – eine Laterne auf dem Dachboden (594 → 595) + W4-G Dielen je Brett, Lager im EG
    // mit Dielen statt Lehm (Review M4/M6/M7). Alter Wert: 594:91dcb8c3 (W4-E allein 595:2320e459).
    // W7 (27.09.2026): Innenraum-Feinschliff (W7-F) – Küchentisch als Insel in der Mitte, Laterne am Himmelbett
    // (595 → 599 Blöcke, Spuren unverändert). Alter Wert: 595:8efa1f9f.
    // W9-G5 (2026-09-27): Materialspiel medieval – Wandverlauf mit Bruch-Tiefenschiefer am Fuß, Dach in drei Ringtönen mit
    // Flecken, roof_t je Dachfläche (Review R5 G5; Blockzahl gleich). Alter Wert: 599:826ab03a.
    // Determinismus-Fix (2026-09-28, plan/spikes/F_determinismus.md): Materialmischung je Möbel über den Seed der
    // Platzierung statt ihrer ID (Blockzahl gleich). Alter Wert: 599:1416466b.
    // FN-Integration (2026-09-29): dichte Wohnstuben/Bibliothek (Ecknischen, Paneel-Pflicht in solar) ordnen die Möbel im
    // Beispielhaus neu (599 → 598 Blöcke, Spuren und dunkle Zellen unverändert: 0). Neu gemessen. Alter Wert: 599:b1f4a6eb.
    expect(checksum(generate(house(), ctx, {}))).toBe('598:061acf8e');
  });

  it('Zahlen je Zustand, identische Geometrie, keine Fehler und keine dunklen Zellen', () => {
    const base = generate(house(), ctx, {});
    const geo = geometry(base);
    const measured: Record<string, Numbers> = { ohne: numbers(base, base.warnings) };
    for (const state of STATES) {
      const world = generate(house(state), ctx, {});
      measured[state] = numbers(world, world.warnings);
      // Geometrie unverändert: dieselben Positionen, dieselbe Anzahl Blöcke
      expect(geometry(world), `Geometrie bei ${state}`).toEqual(geo);
      // Erreichbarkeit: kein harter Verstoß, kein dunkler Raum, keine blockierte Tür
      expect(world.materialized.violations.filter((v) => v.severity === 'error'), `Fehler bei ${state}`).toEqual([]);
      expect(world.materialized.violations.filter((v) => v.kind === 'door_half'), `Tür bei ${state}`).toEqual([]);
      expect(world.materialized.light.darkCells.length, `dunkle Zellen bei ${state}`).toBe(0);
    }
    // eslint-disable-next-line no-console
    console.log('Q5-ZAHLEN', JSON.stringify(measured, null, 1));
    for (const state of STATES) expect(measured[state], state).toEqual(EXPECTED[state]);
  });

  it('Determinismus: zweimal derselbe Zustand ist dieselbe Welt', () => {
    for (const state of STATES) {
      expect(checksum(generate(house(state), ctx, {}))).toBe(checksum(generate(house(state), ctx, {})));
    }
  });

  // W4 (27.09.2026, W2-FC §8 Punkt 3): `weathering.interiorFaces: false` (medieval, Baustandard I1) gilt auch im Zustand
  it('Innenseiten bleiben auch im Zustand ohne Moos und Risse (interiorFaces: false)', () => {
    const p = house('verfallen');
    const world = generate(p, ctx, {});
    const contexts = shellContext(world.shell, Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])));
    let inner = 0;
    world.shell.cells.forEach((c, i) => {
      if (c.role !== 'wall_primary' || !facesRoom(contexts[i]!)) return;
      inner++;
      const name = world.materialized.volume.stateAt(c.pos).name;
      expect(/mossy|cracked/.test(name), `${c.pos.join(',')}: ${name}`).toBe(false);
    });
    expect(inner).toBeGreaterThan(0);
  });

  it('materialbezogen: `verfallen` hat mehr Moos, Risse und entrindetes Holz als `neu`', () => {
    const neu = numbers(generate(house('neu'), ctx, {}), []);
    const verfallen = numbers(generate(house('verfallen'), ctx, {}), []);
    expect(neu.mossy).toBeLessThan(verfallen.mossy);
    expect(neu.cracked).toBeLessThan(verfallen.cracked);
    expect(neu.stripped).toBeLessThan(verfallen.stripped);
  });
});
