/** Erreichbarkeit (Red-Team-Review): Etagen ohne Treppe und Räume ohne Tür/Treppe werden gemeldet. */
import { circulation } from '@mcda/pipeline';
import { Project, TARGET_VERSIONS, type RoomId, type RoomShellInfo } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { NO_PATH_TEXT, accessHints, entranceFloor, mergeAccessWarnings, reachableFloors } from '../src/ui/access.js';
import { floorLabel, shellOf } from '../src/usecases.js';

function project(): Project {
  return Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
}

/** Rauminfo mit `doors` Türen und `stairs` Treppenzugängen (nur die Felder, die die Prüfung liest). */
function info(roomId: RoomId, floorIndex: number, doors: number, stairs = 0): RoomShellInfo {
  return {
    roomId,
    floorIndex,
    baseY: 0,
    height: 3,
    interior: CellSet.rect(1, 1, 2, 2),
    doors: Array.from({ length: doors }, () => ({ inside: [1, 1] as const, toward: 'north' as const, isMain: false })),
    windows: [],
    stairs: Array.from({ length: stairs }, () => ({ linkId: 'l1' })) as unknown as RoomShellInfo['stairs'],
  } as RoomShellInfo;
}

const name = (id: RoomId): string => `Raum ${id}`;

describe('Erreichbarkeit', () => {
  it('EG ist der Eingang; ohne EG-Räume die Etage, die dem EG am nächsten liegt', () => {
    const p = project();
    expect(entranceFloor(p.state)).toBeUndefined();
    p.addFloor({ below: true });
    p.paintRoom(-1, CellSet.rect(0, 0, 5, 5), 'wine_cellar');
    expect(entranceFloor(p.state)).toBe(-1);
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'kitchen');
    expect(entranceFloor(p.state)).toBe(0);
  });

  it('OG und Keller ohne Treppe sind nicht erreichbar – beide werden gemeldet', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 8, 8), 'bedroom');
    p.addFloor({ below: true });
    p.paintRoom(-1, CellSet.rect(0, 0, 8, 8), 'wine_cellar');
    expect([...reachableFloors(p.state)]).toEqual([0]);
    const rooms = new Map(p.state.rooms.map((r) => [r.id, info(r.id, r.floorIndex, 1)]));
    const hints = accessHints(p.state, rooms, floorLabel, name);
    expect(hints.map((h) => [h.kind, h.floorIndex])).toEqual([
      ['floor', 1],
      ['floor', -1],
    ]);
    expect(hints[0]!.text).toBe('1. OG ist nicht erreichbar: keine Treppe herauf – mit Werkzeug T auf EG eine Treppe setzen');
    expect(hints[1]!.text).toBe('1. UG ist nicht erreichbar: keine Treppe hinauf nach EG – mit Werkzeug T auf 1. UG eine Treppe setzen');
  });

  it('eine Treppe verbindet die Etagen; danach bleibt nur der Raum ohne Tür', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 8, 8), 'bedroom');
    p.placeStairs(0, [2, 2], 'east');
    expect([...reachableFloors(p.state)].sort()).toEqual([0, 1]);
    const [eg, og] = p.state.rooms;
    const rooms = new Map<RoomId, RoomShellInfo>([
      [eg!.id, info(eg!.id, 0, 1, 1)],
      [og!.id, info(og!.id, 1, 0, 0)],
    ]);
    const hints = accessHints(p.state, rooms, floorLabel, name);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ kind: 'room', floorIndex: 1, roomId: og!.id });
    expect(hints[0]!.text).toBe(`Raum ${og!.id} (1. OG) hat weder Tür noch Treppe`);
  });

  it('ein Raum mit Treppenzugang, aber ohne Tür gilt als erreichbar', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    const r = p.state.rooms[0]!;
    expect(accessHints(p.state, new Map([[r.id, info(r.id, 0, 0, 1)]]), floorLabel, name)).toEqual([]);
  });

  it('leeres Projekt: keine Hinweise', () => {
    expect(accessHints(project().state, new Map(), floorLabel, name)).toEqual([]);
  });
});

describe('Laufweg-Warnungen zusammenführen (mergeAccessWarnings)', () => {
  function haus(): Project {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    p.paintRoom(0, CellSet.rect(9, 0, 16, 8), 'storage');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 8, 8), 'bedroom');
    return p;
  }
  const label = (id: RoomId): string => `Name-${id}`;

  it('schon gemeldete Räume fallen heraus; bleibt keiner, entfällt die Warnung', () => {
    const p = haus();
    const [, lager, schlaf] = p.state.rooms;
    const rooms = new Map(p.state.rooms.map((r) => [r.id, info(r.id, r.floorIndex, 1)]));
    const hints = accessHints(p.state, rooms, floorLabel, label); // 1. OG ohne Treppe
    expect(hints.map((h) => h.kind)).toEqual(['floor']);
    const out = mergeAccessWarnings(hints, [
      `Ohne Weg vom Eingang: ${schlaf!.id}`,
      `Etage ohne Treppenzugang (nur über einen Sprung erreichbar): ${schlaf!.id}`,
      `Ohne Weg vom Eingang: ${lager!.id}, ${schlaf!.id}`,
    ], p.state, label, floorLabel);
    expect(out).toEqual([
      hints[0]!.text,
      NO_PATH_TEXT(`Name-${lager!.id} (EG)`),
    ]);
  });

  it('interne IDs werden zu Anzeigenamen, Entwickler-Quellen verschwinden', () => {
    const p = haus();
    const [kueche, lager] = p.state.rooms;
    // Anzeigenamen ohne die interne ID, damit die Prüfung wirklich zeigt, dass keine ID mehr durchkommt
    const namen = new Map<RoomId, string>([
      [kueche!.id, 'Küche · 1'],
      [lager!.id, 'Lager · 2'],
    ]);
    const name = (id: RoomId): string => namen.get(id) ?? id;
    const out = mergeAccessWarnings([], [
      // die neuen Texte des Laufweg-Berichts (Review 4, §49.4.1): Jargon raus, IDs bleiben maschinenlesbar
      `Treppe zu kurz für eine Etage (1–2 gesperrte Zellen): ${kueche!.id}`,
      `Weit vom Eingang (> 20 s Laufweg): ${lager!.id}`,
      '41 % der Innenfläche sind Flure (über 35 %): das Haus ist vor allem Flur',
    ], p.state, name, floorLabel);
    expect(out).toEqual([
      'Treppe in „Küche · 1 (EG)“ ist zu kurz für eine Etage – eine Treppe mehr setzen',
      'Weit vom Eingang (> 20 s Laufweg): Lager · 2 (EG)',
      '41 % der Innenfläche sind Flure (über 35 %): das Haus ist vor allem Flur',
    ]);
    expect(out.join('\n')).not.toMatch(/\br\d\b/); // keine interne Raum-ID in der Nutzersprache
  });

  it('Gruppen mit „+“ bleiben erhalten, doppelte Meldungen erscheinen einmal', () => {
    const p = haus();
    const [kueche, lager] = p.state.rooms;
    const w = `Etage ohne Treppenzugang (nur über einen Sprung erreichbar): ${kueche!.id}+${lager!.id}`;
    expect(mergeAccessWarnings([], [w, w], p.state, label, floorLabel)).toEqual([
      `EG ist ohne Treppenzugang – nur über einen Sprung erreichbar: Name-${kueche!.id} + Name-${lager!.id}`,
    ]);
  });

  it('Etage ohne Treppenzugang: die App nennt die Etage („1. OG“), nicht den rohen Index', () => {
    const p = haus();
    const schlaf = p.state.rooms[2]!; // Schlafzimmer auf Etage 1
    const out = mergeAccessWarnings([], [`Etage ohne Treppenzugang (nur über einen Sprung erreichbar): ${schlaf.id}`], p.state, label, floorLabel);
    expect(out).toEqual([`1. OG ist ohne Treppenzugang – nur über einen Sprung erreichbar: Name-${schlaf.id}`]);
  });

  it('Etage ohne Treppenzugang: gemischte Höhenlagen nennen je Raum die eigene Etage', () => {
    const p = haus();
    const [kueche, , schlaf] = p.state.rooms;
    // Die Pipeline gruppiert je Höhenlage; liegt (etwa über Baukörper) mehr als eine Etage in einer Gruppe, bleibt
    // die Aussage trotzdem richtig – dann steht die Etage an jedem Raum statt einmal voran.
    const w = `Etage ohne Treppenzugang (nur über einen Sprung erreichbar): ${kueche!.id}+${schlaf!.id}`;
    expect(mergeAccessWarnings([], [w], p.state, label, floorLabel)).toEqual([
      `Etage ohne Treppenzugang (nur über einen Sprung erreichbar): Name-${kueche!.id} (EG) + Name-${schlaf!.id} (1. OG)`,
    ]);
  });
});

/**
 * Vertrag zwischen `@mcda/pipeline` `circulation` und dieser Übersetzung: Die Präfixe sind Text – hier wird der
 * echte Bericht durch `mergeAccessWarnings` geschickt, damit ein umformulierter Pipeline-Text nicht still
 * unübersetzt (mit internen IDs) beim Bauherrn landet.
 */
describe('Laufweg-Bericht aus der Pipeline → Nutzersprache (Kette)', () => {
  it('ein OG ohne Treppe kommt als Etagenname + Raumname an, ohne interne ID', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 8, 8), 'bedroom'); // ohne Treppe: nur über einen Sprung erreichbar
    const oben = p.state.rooms[1]!;
    const report = circulation(shellOf(p), p);
    expect(report.warnings.some((w) => w.startsWith('Etage ohne Treppenzugang'))).toBe(true);
    // Anzeigename ohne die interne ID, damit die Prüfung wirklich zeigt, dass keine ID mehr durchkommt
    const name = (id: RoomId): string => `Raum ${p.state.rooms.findIndex((r) => r.id === id) + 1}`;
    const out = mergeAccessWarnings([], report.warnings, p.state, name, floorLabel);
    expect(out).toContain(`1. OG ist ohne Treppenzugang – nur über einen Sprung erreichbar: ${name(oben.id)}`);
    expect(out.join('\n')).not.toMatch(/\br\d\b/);
  });
});
