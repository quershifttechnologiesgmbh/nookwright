/**
 * Q1a-Abnahme (Auftrag §Q1a Punkt 3): „≥ 25 wählbare Komponenten je Raumtyp".
 *
 * Definition „wählbar" – alles, was Solver oder Licht-Pass für diesen Raumtyp als Kandidat ziehen können:
 *  1. **direkt**: Komponenten auf ein Tag aus `required`/`optional` (die eigentliche Auswahl des Raumtyps),
 *  2. **Socket**: Komponenten, die ein Socket einer Pool-Komponente aufnimmt (Kerzen auf dem Bord, Kissen auf der
 *     Bank …) – Kandidatenpool-Obergrenze, die Montage-Regel prüft der Solver,
 *  3. **Licht**: die Wunsch-Lichtarten des Raumtyps (`lighting.prefer`).
 *
 * Gezählt wird je Zielversion (1.21.11 und 26.3), damit keine Komponente mit `versions`-Grenze mitzählt, die es dort
 * nicht gibt. Das ist ein **Katalogziel**, keine Vorgabe „25 Möbel in jeden Raum" (research/63): der Test prüft die
 * Breite des Angebots, nicht die Möbelzahl im Raum.
 *
 * Gemessen (25.09.2026, beide Zielversionen gleich): schmalster Raumtyp ist `throne_room` mit 36 (29 direkt,
 * 5 Socket, 2 Licht); der schmalste **direkte** Pool ist `dungeon` mit 24.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { expandComponent } from '@mcda/furnishing';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;
const MIN_WAEHLBAR = 25;
/** Gemessener schmalster direkter Pool (dungeon 24) mit einer Reserve, die kleine Katalogänderungen trägt. */
const MIN_DIREKT = 20;

interface Choices {
  readonly total: number;
  readonly direct: number;
  readonly socket: number;
  readonly light: number;
}

function choices(roomTypeId: string, version: keyof typeof TARGET_VERSIONS): Choices {
  const dv = TARGET_VERSIONS[version].dataVersion;
  const rt = ctx.catalog.roomType(roomTypeId);
  const tags = new Set([...rt.required, ...rt.optional].flatMap((e) => [...e.tags]));
  const direct = new Set(ctx.catalog.byTags([...tags], dv).map((d) => d.id));
  const socket = new Set<string>();
  for (const id of direct) {
    const def = ctx.catalog.get(id);
    for (const v of def.variants?.map((x) => x.id) ?? [undefined]) {
      for (const s of expandComponent(def, v).sockets) for (const c of ctx.catalog.byTags(s.accepts, dv)) socket.add(c.id);
    }
  }
  const light = new Set((rt.lighting?.prefer ?? []).flatMap((t) => ctx.catalog.byTags([t], dv).map((d) => d.id)));
  return { total: new Set([...direct, ...socket, ...light]).size, direct: direct.size, socket: socket.size, light: light.size };
}

const zeile = (id: string, version: string, c: Choices): string => `${id}/${version}: ${c.total} (direkt ${c.direct}, Socket ${c.socket}, Licht ${c.light})`;

describe('Q1a: Wahlmöglichkeiten je Raumtyp', () => {
  it(`jeder Raumtyp hat in beiden Zielversionen mindestens ${MIN_WAEHLBAR} wählbare Komponenten`, () => {
    const ids = ctx.catalog.roomTypeIds();
    expect(ids.length).toBeGreaterThanOrEqual(40);
    const schwach = ids
      .flatMap((id) => VERSIONS.map((v) => ({ id, v, c: choices(id, v) })))
      .filter((x) => x.c.total < MIN_WAEHLBAR)
      .map((x) => zeile(x.id, x.v, x.c));
    expect(schwach, `zu schmale Raumtypen (Grenze ${MIN_WAEHLBAR}):\n${schwach.join('\n')}`).toEqual([]);
  });

  it(`auch der direkte Tag-Pool (ohne Sockets/Licht) bleibt überall bei mindestens ${MIN_DIREKT}`, () => {
    const flach = ctx.catalog
      .roomTypeIds()
      .flatMap((id) => VERSIONS.map((v) => ({ id, v, c: choices(id, v) })))
      .filter((x) => x.c.direct < MIN_DIREKT)
      .map((x) => zeile(x.id, x.v, x.c));
    expect(flach, `zu schmaler direkter Pool (Grenze ${MIN_DIREKT}):\n${flach.join('\n')}`).toEqual([]);
  });
});
