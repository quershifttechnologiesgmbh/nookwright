/**
 * W8-E „Spielbare Vorschläge“ (plan/spikes/W8E_spielbar.md): Spielbarkeit eines Bautyp-Kandidaten und die Wahl
 * spielbarer Vorschläge (`playablePicks`), dazu der Korpus „0 fehlende Pflichtobjekte“.
 *
 * Korpus: alle Bautypen × Größen × Seeds (`hashSeed(base, 'vorschlag', n)`, wie `building_propose`). Standard: 2 Seeds je
 * Bautyp und Größe; `MCDA_W8E=full` (bzw. `MCDA_FUZZ=full`): 8 Seeds je Bautyp und Größe (208 Kandidaten, ~1 min) und
 * dazu der Raumtyp-Korpus von W8-A (45 Raumtypen × 6 Rechteckräume × 8 Seeds).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CellSet, hashSeed, type Cell, type HorizontalDir } from '@mcda/core';
import { furnishRoom, requiredWithoutPose, type RoomGeometry } from '@mcda/furnishing';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { distinctPicks, playabilityIssues, playabilityKinds, playabilityText, playablePicks } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const FULL = process.env['MCDA_W8E'] === 'full' || process.env['MCDA_FUZZ'] === 'full';
const seedOf = (base: number, n: number): number => hashSeed(base, 'vorschlag', n) % 2 ** 31;

describe('playablePicks (gemeinsame Regel App/Engine)', () => {
  it('alle spielbar: gleich distinctPicks', () => {
    for (const keys of [['a', 'b', 'c', 'd'], ['a', 'a', 'b', 'a', 'c'], ['a', 'a', 'a'], [undefined, undefined, 'a']]) {
      expect(playablePicks(keys, 3, () => true)).toEqual({ picks: distinctPicks(keys, 3), unplayable: [] });
    }
    expect(playablePicks(['a', 'a', 'b'], 3, () => true, false).picks).toEqual(distinctPicks(['a', 'a', 'b'], 3, false));
  });

  it('unspielbar wird wie ein Doppel übersprungen, die Reserve füllt auf', () => {
    const bad = new Set([1]);
    expect(playablePicks(['a', 'b', 'c', 'd'], 3, (i) => !bad.has(i))).toEqual({ picks: [0, 2, 3], unplayable: [] });
    // gleicher Grundriss wie ein unspielbarer Kandidat, aber spielbar (anderer Seed, andere Einrichtung): zählt
    expect(playablePicks(['a', 'b', 'b', 'c'], 3, (i) => i !== 1).picks).toEqual([0, 2, 3]);
  });

  it('Reserve erschöpft: erst spielbare Doppel, dann unspielbare – markiert, nie still', () => {
    expect(playablePicks(['a', 'a', 'b', 'c'], 3, (i) => i !== 2 && i !== 3)).toEqual({ picks: [0, 1, 2], unplayable: [2] });
    expect(playablePicks(['a', 'b', 'c'], 3, () => false)).toEqual({ picks: [0, 1, 2], unplayable: [0, 1, 2] });
    // noch nicht erschöpft (App während der Runde): nur die spielbaren
    expect(playablePicks(['a', 'b', 'c'], 3, (i) => i !== 1, false)).toEqual({ picks: [0, 2], unplayable: [] });
  });

  it('fragt teure Prüfung nur für gezeigte Kandidaten und je Index einmal', () => {
    const asked: number[] = [];
    playablePicks(['a', 'a', 'b', 'c', 'd', 'e'], 3, (i) => (asked.push(i), true));
    expect(asked).toEqual([0, 2, 3]);
    asked.length = 0;
    // Doppel erst beim Auffüllen, der unspielbare zweite wird übersprungen
    expect(playablePicks(['a', 'a', 'a', 'a'], 3, (i) => (asked.push(i), i !== 1)).picks).toEqual([0, 2, 3]);
    expect(asked).toEqual([0, 1, 2, 3]);
  });
});

describe('Ursachen (vorher systematisch unspielbar, Review F-Pareto §3)', () => {
  it('Burg S / Wachturm L: Turmzimmer mit 3 Eckregalen (Mindestzahl 1) ist spielbar, der Rest ein Hinweis', () => {
    for (const [type, size, seed] of [['castle_compact', 'S', seedOf(101, 0)], ['watchtower', 'L', seedOf(202, 1)]] as const) {
      expect(playabilityIssues(ctx.buildingTypes.get(type)!, { size }, seed, ctx), `${type} ${size} ${seed}`).toEqual([]);
    }
  }, HEAVY_TIMEOUT);

  it('Stadthaus M / Erdhaus S: Schlafzimmer ist nicht mehr nur Ring um das Treppenloch bzw. Durchgang', () => {
    for (const [type, size, seed] of [['townhouse', 'M', seedOf(101, 0)], ['townhouse', 'M', seedOf(202, 1)], ['hobbit', 'S', seedOf(101, 1)]] as const) {
      expect(playabilityIssues(ctx.buildingTypes.get(type)!, { size }, seed, ctx), `${type} ${size} ${seed}`).toEqual([]);
    }
  }, HEAVY_TIMEOUT);

  it('Scheune mit eigenem Nebeneingang (Bauernhaus L) gilt als erreichbar', () => {
    expect(playabilityIssues(ctx.buildingTypes.get('farmhouse')!, { size: 'L' }, seedOf(101, 0), ctx)).toEqual([]);
  }, HEAVY_TIMEOUT);

  it('deterministisch', () => {
    const def = ctx.buildingTypes.get('townhouse')!;
    expect(JSON.stringify(playabilityIssues(def, { size: 'M' }, 7, ctx))).toBe(JSON.stringify(playabilityIssues(def, { size: 'M' }, 7, ctx)));
  }, HEAVY_TIMEOUT);
});

describe('Hinweistext', () => {
  it('nennt Objekt und Raum auf Deutsch', () => {
    const t = playabilityText([{ issue: 'required_missing', roomId: 'r4', roomTypeId: 'bedroom', tags: ['canopy_bed'] }], ctx.catalog);
    expect(t).toMatch(/^Pflichtobjekt fehlt: .+ \(Schlafzimmer\)$/);
    expect(playabilityText([{ issue: 'no_entrance' }, { issue: 'no_stairs', roomId: '2' }])).toBe('kein Eingang · Etage ohne Treppe');
    expect(playabilityKinds([{ issue: 'required_missing' }, { issue: 'no_entrance' }, { issue: 'required_missing' }])).toEqual(['no_entrance', 'required_missing']);
    expect(playabilityText([])).toBe('');
  });
});

describe(`Korpus: 0 fehlende Pflichtobjekte (${FULL ? 'voll' : 'Stichprobe'})`, () => {
  it('alle Bautypen × Größen × Seeds spielbar', () => {
    const bad: string[] = [];
    for (const id of ctx.buildingTypes.ids()) {
      const def = ctx.buildingTypes.get(id)!;
      const sizes: Array<'S' | 'M' | 'L' | undefined> = def.sizes === undefined ? [undefined] : (Object.keys(def.sizes) as Array<'S' | 'M' | 'L'>);
      for (const size of sizes) {
        for (const base of FULL ? [101, 202] : [101]) for (let n = 0; n < (FULL ? 4 : 2); n++) {
          const seed = seedOf(base, n);
          const f = playabilityIssues(def, size !== undefined ? { size } : {}, seed, ctx);
          if (f.length > 0) bad.push(`${id} ${size ?? '-'} ${seed}: ${playabilityText(f, ctx.catalog)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, HEAVY_TIMEOUT);

  it.runIf(FULL)('Raumtyp-Korpus (W8-A): jedes fehlende Pflichtobjekt ist unter den harten Regeln unmöglich', () => {
    // Rest (W8E §3): 3 × 3 innen mit Fenstern mitten in allen drei freien Wänden bzw. unter der Mindestfläche – dort hat
    // das Pflichtobjekt schon im leeren Raum keine Pose (`requiredWithoutPose`) oder zwei Pflicht-Einträge schließen
    // sich aus (nur unter der Mindestfläche). Der Planer baut solche Räume nicht (`ArchetypeContext.furnishable`).
    const unexplained: string[] = [];
    for (const rtId of ctx.catalog.roomTypeIds()) {
      const rt = ctx.catalog.roomType(rtId);
      for (const [w, d, h] of SIZES) for (let seed = 1; seed <= 8; seed++) {
        const g = rectRoom(w, d, h);
        const r = furnishRoom(g, rt, ctx.catalog, { seed, dataVersion: 4671, styles: ['medieval'] });
        if ((r.quality.parts.find((p) => p.id === 'required')?.value ?? 1) >= 1) continue;
        const area = (w - 2) * (d - 2);
        if (requiredWithoutPose(g, rt, ctx.catalog, { dataVersion: 4671 }).length === 0 && area >= rt.minArea) unexplained.push(`${rtId} ${w}x${d} ${seed}`);
      }
    }
    expect(unexplained).toEqual([]);
  }, HEAVY_TIMEOUT);
});

// Raumtyp-Korpus wie spikes/w8/w8a/measure.mts: Rechteckraum, Tür Süd Mitte, Fenster im Hüllen-Abstand 4
const SIZES: ReadonlyArray<readonly [number, number, number]> = [[5, 5, 3], [6, 8, 3], [8, 8, 4], [10, 7, 3], [12, 10, 4], [16, 12, 4]];
function windowSlots(length: number, margin = 1, spacing = 4): number[] {
  const avail = length - 2 * margin;
  if (avail <= 0) return [];
  if (avail === 2) return [margin, margin + 1];
  for (let n = Math.floor((avail + spacing) / (1 + spacing)); n >= 1; n--) {
    const span = n + (n - 1) * spacing;
    if (span > avail || (avail - span) % 2 !== 0) continue;
    const start = margin + (avail - span) / 2;
    return Array.from({ length: n }, (_, i) => start + i * (1 + spacing));
  }
  return [];
}
function rectRoom(w: number, d: number, height: number): RoomGeometry {
  const iw = w - 2;
  const id = d - 2;
  const along = (s: HorizontalDir): number => (s === 'north' || s === 'south' ? iw : id);
  const cellOn = (s: HorizontalDir, i: number): Cell => (s === 'north' ? [i, 0] : s === 'south' ? [i, id - 1] : s === 'west' ? [0, i] : [iw - 1, i]);
  const windows = (['north', 'east', 'west'] as const).flatMap((s) => windowSlots(along(s)).map((i) => ({ inside: cellOn(s, i), toward: s })));
  return {
    roomId: `r${w}x${d}`, baseY: 1, height, interior: CellSet.rect(0, 0, iw - 1, id - 1),
    doors: [{ inside: cellOn('south', Math.floor(iw / 2)), toward: 'south', isMain: true }], windows,
  };
}
