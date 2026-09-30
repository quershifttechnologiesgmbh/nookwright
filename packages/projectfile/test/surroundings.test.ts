/** Umgebung der Projektdatei: Bauwerke ↔ Eingabe des Anwendungsdienstes (Umkehrung für Engine-Sessions). */
import { describe, expect, it } from 'vitest';
import { EMPTY_SURROUNDINGS, attachedTowersOf, readSurroundings, structureItemsOf, structuresInput, type SurroundingsState } from '../src/index.js';

describe('structureItemsOf', () => {
  it('erhält die ID einer abgeleiteten Wehrplatte beim Dateiroundtrip', () => {
    const back = structureItemsOf({ parapets: [{ id: 'main-parapet', volumeId: 'v0', cells: [[7, 1]], y: 27, crown: 'lookout', deck: true }] });
    expect(back.structures[0]).toMatchObject({ id: 'main-parapet', kind: 'parapet', volumeId: 'v0' });
    const read = readSurroundings({ ...EMPTY_SURROUNDINGS, ...back });
    expect(read.warnings).toEqual([]);
    expect(read.state?.structures).toEqual(back.structures);
  });
  it('Umkehrung von structuresInput/attachedTowersOf: IDs bleiben, Zähler danach', () => {
    const sur: SurroundingsState = {
      ...EMPTY_SURROUNDINGS,
      structures: [
        { kind: 'wall', id: 'w1', plan: { points: [[0, 0], [8, 0]], closed: false } },
        { kind: 'tower', id: 't4', spec: { center: [3, 3] } },
        { kind: 'annex', id: 'a2', spec: { center: [1, 1], side: 'north' } },
      ],
      seq: 5,
    };
    const back = structureItemsOf(structuresInput(sur), attachedTowersOf(sur));
    expect(back.structures).toEqual(sur.structures);
    expect(back.seq).toBe(5);
  });

  it('fehlende oder doppelte IDs werden neu vergeben; readSurroundings liest das Ergebnis', () => {
    const r = structureItemsOf({ towers: [{ center: [0, 0] }, { center: [5, 5], id: 'x' }, { center: [9, 9], id: 'x' }] });
    expect(r.structures.map((i) => i.id)).toEqual(['t1', 'x', 't2']);
    const read = readSurroundings({ terrain: false, margin: 12, structures: r.structures, seq: r.seq });
    expect(read.warnings).toEqual([]);
    expect(read.state?.structures).toHaveLength(3);
  });
});

describe('Wehrplatten (BT01): Bindung, Altbestand und Grenzen', () => {
  const sur = (structures: SurroundingsState['structures']): SurroundingsState => ({ ...EMPTY_SURROUNDINGS, structures, seq: structures.length + 1 });

  it('liest eine Bindung ohne Zellen und einen Altbestand mit Zellen', () => {
    const read = readSurroundings({
      terrain: false, margin: 12, seq: 3,
      structures: [
        { kind: 'parapet', id: 'p1', volumeId: 'v1', merlon: { width: 3 } },
        { kind: 'parapet', id: 'p2', volumeId: 'v0', cells: [[1, 1], [2, 1]], y: 20 },
        // Ganz alte Form (`spec`): wird auf die flache Bindung normalisiert
        { kind: 'parapet', id: 'p3', spec: { cells: [[0, 0]], y: 9, merlon: { gap: 2 } } },
      ],
    });
    expect(read.warnings).toEqual([]);
    expect(read.state?.structures[0]).toEqual({ kind: 'parapet', id: 'p1', volumeId: 'v1', merlon: { width: 3 } });
    const alt = read.state!.structures[1]!;
    expect(alt).toMatchObject({ kind: 'parapet', id: 'p2', volumeId: 'v0', y: 20 });
    expect(alt.kind === 'parapet' ? alt.cells?.length : undefined).toBe(2);
    // Altbestand ohne `volumeId` bleibt **ungebunden** (Review e5108a5, Befund 2): kein erfundener Baukörper v0
    expect(read.state?.structures[2]).toEqual({ kind: 'parapet', id: 'p3', cells: [[0, 0]], y: 9, merlon: { gap: 2 } });
    expect(readSurroundings({ structures: [{ kind: 'parapet', id: 'p4' }] }).state?.structures[0]).toEqual({ kind: 'parapet', id: 'p4' });
    // Altbestand in `spec` ohne Zellen bleibt unbrauchbar (wie vorher), der Rest wird gemeldet
    const kaputt = readSurroundings({ structures: [{ kind: 'parapet', id: 'p5', spec: { cells: [], y: 70 } }] });
    expect(kaputt.state?.structures).toEqual([]);
    expect(kaputt.warnings).toEqual(['1 Bauwerk unlesbar – ausgelassen']);
  });

  it('Altbestand ohne Bindung wird als feste Kopie gebaut, nicht auf den Hauptbaukörper umgebogen', () => {
    const alt = sur([{ kind: 'parapet', id: 'p9', cells: [[0, 0], [1, 0]], y: 28 }]);
    // Der Resolver darf hier gar nicht greifen (kein volumeId) – die gespeicherten Zellen/Höhe gewinnen
    const aufgeloest = structuresInput(alt, (item) => (item.volumeId === undefined ? { id: item.id, volumeId: 'v0', cells: [[9, 9]], y: 24 } : undefined));
    expect(aufgeloest?.parapets?.[0]).toMatchObject({ cells: [[0, 0], [1, 0]], y: 28 });
  });

  it('löst die Bindung über den Resolver auf und nimmt sonst den Altbestand', () => {
    const state = sur([{ kind: 'parapet', id: 'p1', volumeId: 'v1', cells: [[0, 0]], y: 9 }]);
    const aufgeloest = structuresInput(state, (item) => (item.volumeId === undefined ? undefined : { id: item.id, volumeId: item.volumeId, cells: [[4, 4], [5, 4]], y: 12 }));
    expect(aufgeloest?.parapets?.[0]).toMatchObject({ cells: [[4, 4], [5, 4]], y: 12 });
    // Ohne Resolver bleibt der Altbestand sichtbar (keine stillen Verluste)
    expect(structuresInput(state)?.parapets?.[0]).toMatchObject({ cells: [[0, 0]], y: 9 });
    // Bindung ganz ohne Zellen und ohne Resolver: nichts zu bauen
    expect(structuresInput(sur([{ kind: 'parapet', id: 'p2', volumeId: 'v1' }]))).toBeUndefined();
  });
});
