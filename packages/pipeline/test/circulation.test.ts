/**
 * Erschließung und Laufwege (research/22 §0.3–0.4, research/23 §0.1–0.2, Synthese 25 Regeln 3/4/7):
 * Räume als Knoten, Türen als Kanten – geprüft werden Wegstrecke in Blöcken, Laufzeit in Sekunden,
 * Erschließungsanteil und die Warnungen für Räume ohne Weg.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell, type Shell } from '@mcda/blueprint';
import { CellSet, hashSeed, type Cell } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { nodeContext } from '../src/node-context.js';
import { circulation, completeBase, generateBase, projectFromBuildingType, shellFor, themeFor, withoutPilastersForTheme, SPEED } from '../src/index.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function project(): Project {
  return Project.create({ id: 'p', name: 'P', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
}

/** Flur als Mittelgang, links und rechts direkt angrenzende Räume; die Haustür liegt im Flur. */
function hallwayHouse(): Project {
  const p = project();
  p.paintRoom(0, CellSet.rect(9, 0, 11, 14), 'hallway');
  p.paintRoom(0, CellSet.rect(0, 0, 8, 14), 'kitchen');
  p.paintRoom(0, CellSet.rect(12, 0, 20, 14), 'storage');
  return p;
}

/**
 * Reihenhaus: drei Räume in einer Reihe, alle Wände gemeinsam (Küche | Schlafzimmer | Lager). Der Solver setzt
 * zwischen benachbarten Räumen Durchgangstüren, die Haustür liegt im Lager.
 */
function rowHouse(): Project {
  const p = project();
  p.paintRoom(0, CellSet.rect(0, 0, 6, 10), 'kitchen');
  p.paintRoom(0, CellSet.rect(7, 0, 13, 10), 'bedroom');
  p.paintRoom(0, CellSet.rect(14, 0, 20, 10), 'storage');
  return p;
}

/** Zweistöcker: unten Flur + Küche, oben zwei Räume, verbunden über eine Treppe. */
function twostoryHouse(): Project {
  const p = project();
  p.addFloor();
  p.paintRoom(0, CellSet.rect(0, 0, 8, 10), 'hallway');
  p.paintRoom(0, CellSet.rect(9, 0, 17, 10), 'kitchen');
  p.paintRoom(1, CellSet.rect(0, 0, 8, 10), 'bedroom');
  p.paintRoom(1, CellSet.rect(9, 0, 17, 10), 'study');
  p.placeStairs(0, [3, 5], 'east');
  return p;
}

const shellOf = (p: Project): Shell => deriveShell(p.state, { roof: 'gable' });

describe('Erschließung: Wegstrecke, Laufzeit, Anteil', () => {
  it('Flur-Haus: der Eingang liegt im Flur, Küche und Lager sind wenige Blöcke entfernt', () => {
    const p = hallwayHouse();
    const r = circulation(shellOf(p), p);
    expect(r.entrance).toBe('r1');
    expect(r.unreachable).toEqual([]);
    expect(r.warnings).toEqual([]);
    const byId = new Map(r.rooms.map((t) => [t.roomId, t]));
    expect(byId.get('r1')!.corridor).toBe(true);
    expect(byId.get('r2')!.station).toBe(true);
    expect(byId.get('r3')!.station).toBe(true);
    // beide Nachbarräume gleich weit (symmetrischer Flur)
    expect(byId.get('r2')!.distance).toBe(byId.get('r3')!.distance);
    expect(byId.get('r2')!.distance).toBeGreaterThan(0);
    expect(byId.get('r2')!.distance).toBeLessThan(12);
    // Laufzeit folgt der belegten Geschwindigkeit (Sprint-Sprung im 2 hohen Gang)
    expect(byId.get('r2')!.seconds).toBeCloseTo(byId.get('r2')!.distance / SPEED.sprintJumpHall, 1);
    // Fluranteil im belegten Normbereich (research/21 §0.6)
    expect(r.corridorShare).toBeGreaterThan(0.1);
    expect(r.corridorShare).toBeLessThanOrEqual(0.35);
  });

  it('Reihenhaus: alle Räume erreichbar, die Mitte liegt zwischen den Enden', () => {
    const p = rowHouse();
    const r = circulation(shellOf(p), p);
    expect(r.unreachable).toEqual([]);
    expect(r.warnings).toEqual([]);
    const byId = new Map(r.rooms.map((t) => [t.roomId, t]));
    for (const t of r.rooms) expect(t.distance, t.roomId).toBeLessThan(40);
    expect(r.slow).toEqual([]);
    // kein Flur-Raumtyp: keine Erschließungsfläche
    expect(r.corridorCells).toBe(0);
    expect(r.corridorShare).toBe(0);
    // der Eingangsraum liegt bei 0, die anderen beiden sind erreichbar
    expect(byId.get(r.entrance!)!.distance).toBe(0);
    expect([...byId.values()].filter((t) => t.distance > 0).length).toBe(2);
  });

  // W12-E (2026-09-28): Der freistehende Raum bekommt von der Hülle einen eigenen Nebeneingang und ist damit über den
  // Hof erreichbar (R6-5). „Ohne Tür“ heißt jetzt wirklich ohne Tür: die Türen des Raums werden aus der Hülle entfernt.
  it('Raum ohne Tür ist ohne Weg und wird gemeldet', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    p.paintRoom(0, CellSet.rect(20, 20, 28, 28), 'storage'); // allein stehend, keine gemeinsame Wand
    const shell = shellOf(p);
    const lone = p.state.rooms[0]!.id; // der Raum ohne Haustür
    expect(shell.rooms.get(lone)!.doors.some((d) => d.isMain)).toBe(false);
    const doorless: Shell = { ...shell, rooms: new Map([...shell.rooms].map(([id, r]) => [id, id === lone ? { ...r, doors: [] } : r])) };
    const r = circulation(doorless, p);
    expect(r.unreachable).toEqual([lone]);
    expect(r.warnings.join('\n')).toMatch(/Ohne Weg vom Eingang/);
    expect(r.rooms.find((t) => t.roomId === lone)!.unreachable).toBe(true);
  });

  it('W12-E: freistehender Baukörper mit eigener Außentür ist erreichbar (über den Hof), mit Weg ab dieser Tür', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    p.paintRoom(0, CellSet.rect(20, 20, 28, 28), 'storage');
    const shell = shellOf(p);
    const lone = p.state.rooms[0]!.id;
    // Voraussetzung: der Raum hat eine eigene Tür nach draußen, aber keinen Türweg zum Haupteingang
    expect(shell.rooms.get(lone)!.doors.length).toBeGreaterThan(0);
    expect(shell.warnings.join('\n')).toMatch(/eigener Nebeneingang/);
    const r = circulation(shell, p);
    expect(r.unreachable).toEqual([]);
    expect(r.warnings.join('\n')).not.toMatch(/Ohne Weg vom Eingang/);
    const t = r.rooms.find((x) => x.roomId === lone)!;
    expect(t.unreachable).toBe(false);
    expect(t.sideEntrance).toBe(true);
    expect(r.rooms.find((x) => x.roomId === r.entrance)!.sideEntrance).toBeUndefined();
    expect(circulation(shell, p)).toEqual(r);
  });

  it('deterministisch: gleiche Hülle, gleicher Bericht', () => {
    const p = hallwayHouse();
    const shell = shellOf(p);
    expect(circulation(shell, p)).toEqual(circulation(shell, p));
  });

  it('Flur-Rollen sind einstellbar; kurze Treppenfolgen werden gemeldet', () => {
    const p = hallwayHouse();
    const shell = shellOf(p);
    // ohne Flur-Rollen zählt der Mittelgang nicht als Erschließung
    const ohne = circulation(shell, p, { corridorTypes: [] });
    expect(ohne.corridorCells).toBe(0);
    expect(ohne.corridorShare).toBe(0);
    // gesperrte Zellen (Treppe) in einem Raum erzeugen den Hinweis aus research/21 §0.5
    const mitTreppe = { ...shell, rooms: new Map([...shell.rooms].map(([id, room]) => [id, id === 'r2' ? { ...room, blocked: CellSet.rect(1, 1, 2, 1) } : room])) };
    const r = circulation(mitTreppe, p);
    // Nutzersprache statt Entwicklerjargon; nur die Raum-ID bleibt als maschinenlesbare Liste stehen (die App
    // ersetzt sie durch den Anzeigenamen), die Entwickler-Quelle ist weg
    expect(r.warnings).toEqual(['Treppe zu kurz für eine Etage (1–2 gesperrte Zellen): r2']);
  });

  it('eine Leiter sperrt eine Zelle, ist aber keine zu kurze Treppe (Befund Burg-Bergfried)', () => {
    const p = project();
    p.addFloor();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 10), 'kitchen');
    p.paintRoom(1, CellSet.rect(0, 0, 8, 10), 'bedroom');
    p.placeStairs(0, [4, 1], 'north', 'ladder');
    const shell = shellOf(p);
    const unten = circulation(shell, p).rooms.find((t) => t.floorIndex === 0)!;
    expect(unten.blocked).toBe(1); // Vorbedingung: genau die Leiterzelle ist gesperrt
    expect(circulation(shell, p).warnings.filter((w) => w.startsWith('Treppe zu kurz'))).toEqual([]);
  });

  it('Flur-lastiges Haus: der Fluranteil steht als Zahl in Nutzersprache', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 20, 4), 'hallway'); // breiter Mittelgang
    p.paintRoom(0, CellSet.rect(0, 8, 6, 14), 'kitchen');
    const r = circulation(shellOf(p), p);
    expect(r.corridorShare).toBeGreaterThan(0.35);
    const w = r.warnings.find((x) => x.includes('Flure'));
    // die Zahl im Text ist genau der gemessene Anteil (gerundet) – kein eingefrorener Beispielwert
    expect(w).toBe(`${Math.round((r.corridorCells / r.totalCells) * 100)} % der Innenfläche sind Flure (über 35 %): das Haus ist vor allem Flur`);
    expect(r.warnings.join('\n')).not.toContain('Erschließung');
  });

  it('weite Stationen nennen die Laufzeit und die Räume in Nutzersprache', () => {
    const p = rowHouse();
    const r = circulation(shellOf(p), p, { slowSeconds: 0 });
    expect(r.slow.length).toBeGreaterThan(0);
    expect(r.warnings).toContain(`Weit vom Eingang (> 0 s Laufweg): ${r.slow.join(', ')}`);
  });
});

void ctx;

// Hinweis für den nächsten Leser: Ein „Haus“ aus vier Quadranten ohne gemeinsame Wand (wie das Pipeline-Beispiel
// `sampleHouse` mit einem Luftband zwischen den Räumen) hat Räume **ohne Weg** – die Warnung ist dort korrekt und
// deshalb hier nicht als Fehlerfall geführt.

import { entryAuditOf } from '../src/index.js';

describe('Eingang und Windfang (research/21 §2.4, Regel R-W1)', () => {
  /** Zwei Räume nebeneinander; die Breite des zweiten bestimmt den Abstand der beiden Außentüren. */
  function narrowEntry(gapCells: number): Project {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 9, 5), 'entrance_hall');
    void gapCells;
    return p;
  }

  it('Bericht nennt den Eingangsraum und die Zahl seiner Türen', () => {
    const p = hallwayHouse();
    const r = circulation(deriveShell(p.state, { roof: 'gable' }), p);
    expect(r.entry.entryRoom).toBe(r.entrance);
    expect(r.entry.entryDoors).toBeGreaterThan(0);
    expect(r.entry.colliding).toEqual([]); // eine Tür allein kann nicht kollidieren
  });

  it('stufenlose Erschließung: einstöckig sind alle Räume auf Eingangshöhe, keine Meldung', () => {
    const p = hallwayHouse();
    const r = circulation(deriveShell(p.state, { roof: 'gable' }), p);
    expect(r.stepless.levelChanges).toBe(0);
    expect(r.stepless.sameLevel).toBe(r.rooms.length);
    expect(r.stepless.upperWithoutStairs).toEqual([]);
    expect(r.rooms.every((t) => t.levelDiff === 0)).toBe(true);
    expect(r.warnings.join()).not.toContain('Treppenzugang');
  });

  it('zweistöckig: obere Räume haben einen Höhenunterschied, die Etage hat einen Treppenzugang', () => {
    const p = twostoryHouse();
    const r = circulation(deriveShell(p.state, { roof: 'gable' }), p);
    const oben = r.rooms.filter((t) => t.levelDiff !== 0);
    expect(oben.length).toBeGreaterThan(0);
    expect(oben.every((t) => t.levelDiff > 0)).toBe(true);
    expect(r.stepless.upperWithoutStairs).toEqual([]);
  });

  it('zweistöckig: die Treppe ist ein Weg – obere Räume sind erreichbar und weiter weg als der Treppenraum (Review 4)', () => {
    const p = twostoryHouse();
    const r = circulation(deriveShell(p.state, { roof: 'gable' }), p);
    // Vorher gab es nur Tür-Kanten: jeder Raum über dem Eingang galt als „ohne Weg“, auch mit Treppe
    expect(r.unreachable).toEqual([]);
    expect(r.warnings.join('\n')).not.toMatch(/Ohne Weg vom Eingang/);
    const treppenraum = r.rooms.find((t) => t.levelDiff === 0 && t.blocked > 0)!;
    const oben = r.rooms.filter((t) => t.levelDiff > 0);
    expect(oben.every((t) => t.distance > treppenraum.distance)).toBe(true);
  });

  it('ohne Treppe bleibt die obere Etage ohne Weg', () => {
    const p = project();
    p.addFloor();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 10), 'hallway');
    p.paintRoom(1, CellSet.rect(0, 0, 8, 10), 'bedroom');
    const r = circulation(deriveShell(p.state, { roof: 'gable' }), p);
    expect(r.unreachable).toEqual([p.state.rooms[1]!.id]);
    // Maschinenlesbares Präfix bleibt stabil (die App hängt daran ihre Übersetzung); die Etage nennt die App
    expect(r.warnings).toContain(`Etage ohne Treppenzugang (nur über einen Sprung erreichbar): ${p.state.rooms[1]!.id}`);
  });

  it('zwei gegenüberliegende Türen dicht beieinander werden als zu flacher Windfang gemeldet', () => {
    // Schmales Vorhäuschen: 1 Zelle tief, zwei Türen in den gegenüberliegenden Wänden
    const p = narrowEntry(1);
    const shell: Shell = {
      ...deriveShell(p.state, { roof: 'gable' }),
    };
    const room = [...shell.rooms.values()][0]!;
    const [x, z] = room.doors[0]?.inside ?? [1, 1];
    // Hülle künstlich um eine zweite, gegenüberliegende Tür im selben Raum ergänzen
    const patched: Shell = {
      ...shell,
      rooms: new Map([[room.roomId, { ...room, doors: [...room.doors, { inside: [x, z + 1], toward: 'south', isMain: false }] }]]),
    };
    const audit = entryAuditOf(patched);
    expect(audit.colliding.length).toBeGreaterThan(0);
    expect(audit.shallowest).toBe(1);
    // Nutzersprache statt „Türblätter in dieselbe Zelle“; Zahl und Singular/Plural müssen stimmen
    expect(audit.warnings).toEqual(['1 Türpaar im Eingangsraum: die Türen schlagen ineinander (Windfang fehlt oder ist zu flach – mindestens 2 Zellen tief bauen)']);
  });

  it('W8-B: die zwei Flügel einer Doppeltür sind kein Windfang-Paar (Taverne, Burg: vorher immer „schlagen ineinander“)', () => {
    const p = narrowEntry(2);
    const shell = deriveShell(p.state, { roof: 'gable' });
    const room = [...shell.rooms.values()][0]!;
    const main = room.doors.find((d) => d.isMain) ?? room.doors[0]!;
    const [x, z] = main.inside;
    const other: Cell = main.toward === 'north' || main.toward === 'south' ? [x + 1, z] : [x, z + 1];
    const doors = [{ ...main, partner: other }, { inside: other, toward: main.toward, isMain: main.isMain, partner: main.inside }, ...room.doors.filter((d) => d !== main)];
    const audit = entryAuditOf({ ...shell, rooms: new Map([[room.roomId, { ...room, doors }]]) });
    expect(audit.colliding).toEqual([]);
    expect(audit.warnings).toEqual([]);
    // ohne `partner` wären es zwei Türen nebeneinander – das bleibt eine Meldung
    const plain = doors.map(({ partner: _p, ...d }) => d);
    expect(entryAuditOf({ ...shell, rooms: new Map([[room.roomId, { ...room, doors: plain }]]) }).colliding.length).toBe(1);
  });

  it('mit Abstand ≥ 2 Zellen bleibt der Windfang gültig (keine Meldung)', () => {
    const p = narrowEntry(2);
    const shell = deriveShell(p.state, { roof: 'gable' });
    const room = [...shell.rooms.values()][0]!;
    const [x, z] = room.doors[0]?.inside ?? [1, 1];
    const patched: Shell = {
      ...shell,
      rooms: new Map([[room.roomId, { ...room, doors: [...room.doors, { inside: [x, z + 2], toward: 'south', isMain: false }] }]]),
    };
    const audit = entryAuditOf(patched);
    expect(audit.colliding).toEqual([]);
    expect(audit.shallowest).toBe(2);
    expect(audit.warnings).toEqual([]);
  });
});

describe('Eingang in der fertigen Base (Regel R-W1, gemessen)', () => {
  it('Eingangsraum: ≥ 2 Türen, Tiefe ≥ 2, keine Kollision, Achse führt weiter', { timeout: HEAVY_TIMEOUT }, () => {
    const base = completeBase('26.3', 'medieval');
    const world = generateBase(base.project, ctx, base.options);
    const r = circulation(world.shell, base.project);
    expect(r.entry.entryRoom).toBe(r.entrance);
    expect(r.entry.entryDoors).toBeGreaterThanOrEqual(2);
    expect(r.entry.shallowest).toBeGreaterThanOrEqual(2);
    expect(r.entry.colliding).toEqual([]);
    // Eingangsachse (research/21 §0.1): gerade in den Raum hinein und durch eine weitere Tür weitergeführt
    expect(r.entry.axis.depth).toBeGreaterThanOrEqual(3);
    expect(r.entry.axis.throughDoor).toBe(true);
  });
});

describe('Stationsplan (research/23 §Q2: Werkstattnähe zu den Truhen)', () => {
  /** Werkstatt neben dem Lager: kurze Wege. */
  function workshopHouse(): Project {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 10), 'smithy');
    p.paintRoom(0, CellSet.rect(9, 0, 17, 10), 'storage');
    return p;
  }

  it('Stationen nennen Wegzeit vom Eingang und zum nächsten Lager', () => {
    const p = workshopHouse();
    const r = circulation(shellOf(p), p);
    expect(r.stations.storageTypes).toContain('storage');
    expect(r.stations.limitSeconds).toBe(30);
    expect(r.stations.entries.length).toBeGreaterThan(0);
    const schmiede = r.stations.entries.find((e) => e.roomTypeId === 'smithy')!;
    expect(schmiede.seconds).toBeGreaterThanOrEqual(0);
    expect(schmiede.storageSeconds).toBeGreaterThanOrEqual(0);
    // absteigend nach Wegzeit zum Lager sortiert
    const werte = r.stations.entries.map((e) => e.storageSeconds ?? 0);
    expect(werte).toEqual([...werte].sort((a, b) => b - a));
  });

  it('mit strenger Schwelle wird eine weit entfernte Station gemeldet', () => {
    const p = workshopHouse();
    const r = circulation(shellOf(p), p, { stationSeconds: 0 });
    // Text und Zahl hängen an den Messwerten des Stationsplans, nicht an einem eingefrorenen Beispiel
    const weit = r.stations.entries.filter((e) => (e.storageSeconds ?? 0) > 0).map((e) => e.roomId);
    expect(weit.length).toBeGreaterThan(0);
    expect(r.stations.warnings).toEqual([`Weit von den Truhen (> 0 s Laufweg): ${weit.join(', ')}`]);
  });

  it('ohne Lagerraum im Projekt bleibt `storageSeconds` leer und es gibt keine Meldung', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 10), 'smithy');
    const r = circulation(shellOf(p), p);
    expect(r.stations.entries.every((e) => e.storageSeconds === undefined)).toBe(true);
    expect(r.stations.warnings).toEqual([]);
  });
});

/**
 * W12-E (Review R6-5): Das Bauernhaus L (W9-G3) stellt die Scheune als eigenen Baukörper neben das Haus, mit eigenem Tor.
 * Stall und Lager sind über den Hof erreichbar und dürfen nicht als „ohne Weg“ gemeldet werden. Ohne das Tor (Türen der
 * Scheune entfernt) sind sie wirklich unerreichbar und werden weiter gemeldet.
 */
describe('W12-E: Erreichbarkeit über jede Außentür (Bauernhaus mit Scheune)', () => {
  const farm = (): { project: Project; shell: Shell } => {
    const seed = hashSeed(101, 'vorschlag', 0) % 2 ** 31;
    const res = projectFromBuildingType(ctx.buildingTypes.get('farmhouse')!, { size: 'L', surroundings: false }, seed, ctx);
    const { exterior: _exterior, ...build } = withoutPilastersForTheme(res.build, ctx.themes, res.project.state.themeId);
    return { project: res.project, shell: shellFor(res.project, build, themeFor(res.project, ctx)) };
  };

  it('Scheune mit eigenem Tor: kein Raum ohne Weg, Stall und Lager über den Nebeneingang', () => {
    const { project, shell } = farm();
    const r = circulation(shell, project);
    expect(r.unreachable).toEqual([]);
    expect(r.warnings.join('\n')).not.toMatch(/Ohne Weg vom Eingang/);
    const side = r.rooms.filter((t) => t.sideEntrance === true);
    expect(side.map((t) => t.roomTypeId).sort()).toEqual(['stable', 'storage']);
    expect(side.every((t) => !t.unreachable)).toBe(true);
    expect(JSON.stringify(circulation(shell, project))).toBe(JSON.stringify(r));
  }, HEAVY_TIMEOUT);

  it('Scheune ohne Tor: Stall und Lager bleiben ohne Weg (echter Fall wird gemeldet)', () => {
    const { project, shell } = farm();
    const barn = new Set(circulation(shell, project).rooms.filter((t) => t.sideEntrance === true).map((t) => t.roomId));
    expect(barn.size).toBe(2);
    const closed: Shell = { ...shell, rooms: new Map([...shell.rooms].map(([id, info]) => [id, barn.has(id) ? { ...info, doors: info.doors.filter((d) => {
      // nur die Außentüren der Scheune weg (Türen zwischen Stall und Lager bleiben)
      const [dx, dz] = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[d.toward];
      const at = (c: Cell): string => `${c[0]},${c[1]}`;
      const ahead = [1, 2, 3, 4].map((k) => at([d.inside[0] + k * dx!, d.inside[1] + k * dz!]));
      return [...barn].some((o) => o !== id && [...shell.rooms.get(o)!.interior.toArray()].some((c) => ahead.includes(at(c))));
    }) } : info])) };
    const r = circulation(closed, project);
    expect([...r.unreachable].sort()).toEqual([...barn].sort());
    expect(r.warnings.join('\n')).toMatch(/Ohne Weg vom Eingang/);
  }, HEAVY_TIMEOUT);
});
