/** Projekt-Sessions: Aggregat-Befehle (Project, Site), Stil, Bauwerke, Einrichtung, Undo, Generierung. */
import { describe, expect, it } from 'vitest';
import { Project } from '@mcda/blueprint';
import { Site } from '@mcda/terrain';
import { PROJECT_COMMANDS } from '../src/aggregates/project.js';
import { SITE_COMMANDS } from '../src/aggregates/site.js';
import { createEngine, type ExecuteResult } from '../src/index.js';
import { ctx } from './fixture.js';

type View = {
  projectId: string; floors: { index: number }[]; stairs: { id: string }[]; site: { zones: { id: string; kind: string; edge: string | null }[] } | null;
  rooms: { id: string; floor: number; roomTypeId: string; placements: number }[]; placements?: { id: string; locked: boolean }[];
  style: { roof?: string }; structures: { walls: number; towers: number };
};
const ok = (r: ExecuteResult): Record<string, unknown> => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data as Record<string, unknown>;
};
const view = (r: ExecuteResult): View => {
  const d = ok(r);
  return ('project' in d ? d['project'] : d) as View;
};

describe('Befehlstabellen = Befehlsmethoden der Aggregate', () => {
  const methods = (proto: object): string[] => Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
  it('jeder Tabellen-Schlüssel ist eine Methode des Aggregats', () => {
    expect(Object.keys(PROJECT_COMMANDS).filter((k) => !methods(Project.prototype).includes(k))).toEqual([]);
    expect(Object.keys(SITE_COMMANDS).filter((k) => !methods(Site.prototype).includes(k))).toEqual([]);
  });
  it('Ausschlüsse sind begründet', () => {
    for (const [k, v] of [...Object.entries(PROJECT_COMMANDS), ...Object.entries(SITE_COMMANDS)]) {
      if ('excluded' in v) expect(v.excluded.length, k).toBeGreaterThan(20);
    }
  });
});

describe('Projekt schrittweise bauen', () => {
  const e = createEngine(ctx);
  const created = view(e.execute({ op: 'project_create', input: { name: 'Test', seed: 3, themeId: 'medieval' } }));
  const id = created.projectId;
  const cmd = (commands: unknown[]) => e.execute({ op: 'project_command', input: { projectId: id, commands } });

  it('Räume, Etage, Treppe', () => {
    const v = view(cmd([
      { command: 'paintRoom', floor: 0, rect: [0, 0, 8, 6], roomTypeId: 'kitchen' },
      { command: 'paintRoom', floor: 0, rect: [9, 0, 14, 6], roomTypeId: 'bedroom' },
      { command: 'paintRoom', floor: 0, rect: [0, 7, 14, 11], roomTypeId: 'storage' },
      { command: 'addFloor', height: 3 },
      { command: 'paintRoom', floor: 1, rect: [0, 0, 14, 11], roomTypeId: 'library' },
      { command: 'placeStairs', floor: 0, at: [3, 10], facing: 'east' },
    ]));
    expect(v.floors.map((f) => f.index)).toEqual([0, 1]);
    expect(v.rooms.map((r) => r.roomTypeId)).toEqual(['kitchen', 'bedroom', 'storage', 'library']);
    expect(v.stairs).toHaveLength(1);
  });

  it('atomar: ein fehlerhafter Befehl setzt alle Befehle des Aufrufs zurück', () => {
    const before = view(e.execute({ op: 'project_get', input: { projectId: id } }));
    const r = cmd([{ command: 'rename', name: 'Neu' }, { command: 'removeFloor', floor: 5 }]);
    expect(r).toMatchObject({ ok: false, errors: [expect.stringContaining('Befehl 2 (removeFloor)')] });
    const after = view(e.execute({ op: 'project_get', input: { projectId: id } }));
    expect(after).toEqual(before);
  });

  it('Raumtyp ändern, Stil, Einrichten, Möbel sperren', () => {
    const kitchen = view(e.execute({ op: 'project_get', input: { projectId: id } })).rooms[0]!.id;
    cmd([{ command: 'assignRoomType', roomId: kitchen, roomTypeId: 'smithy' }]);
    ok(e.execute({ op: 'project_style', input: { projectId: id, shell: { roof: 'hip' }, exterior: { density: 1 } } }));
    const furnished = view(e.execute({ op: 'project_furnish', input: { projectId: id } }));
    expect(furnished.rooms.every((r) => r.placements > 0)).toBe(true);
    expect(furnished.style.roof).toBe('hip');
    const withP = view(e.execute({ op: 'project_get', input: { projectId: id, placements: true } }));
    const pid = withP.placements![0]!.id;
    const locked = view(cmd([{ command: 'lockPlacement', placementId: pid }]));
    expect(locked.rooms.length).toBe(4);
    const again = view(e.execute({ op: 'project_get', input: { projectId: id, placements: true } }));
    expect(again.placements!.find((p) => p.id === pid)?.locked).toBe(true);
  });

  it('Gelände: anlegen mit Vorlage, Zone malen, Zaun', () => {
    const v = view(e.execute({ op: 'site_create', input: { projectId: id, terrainStyleId: 'meadow', template: 'homestead' } }));
    expect(v.site!.zones.length).toBeGreaterThan(0);
    const w = view(e.execute({ op: 'site_command', input: { projectId: id, commands: [
      { command: 'paintZone', kind: 'pond', rect: [-10, -10, -6, -6] },
      { command: 'setLighting', lighting: 'spawnproof' },
    ] } }));
    const pond = w.site!.zones.find((z) => z.kind === 'pond')!;
    expect(pond).toBeDefined();
    const garden = w.site!.zones.find((z) => z.kind === 'garden' || z.kind === 'field')!;
    const x = view(e.execute({ op: 'site_command', input: { projectId: id, commands: [{ command: 'setZoneEdge', zoneId: garden.id, edge: 'hedge' }] } }));
    expect(x.site!.zones.find((z) => z.id === garden.id)?.edge).toBe('hedge');
  });

  it('Bauwerke setzen und alles generieren; Generieren ändert das Projekt nicht', () => {
    ok(e.execute({ op: 'project_structures', input: { projectId: id, structures: {
      // Zinnen-Rhythmus 4 wie im Bautyp-Katalog erlaubt (Burg-Dateien der App müssen die Engine passieren)
      walls: [{ points: [[-20, -20], [34, -20], [34, 30], [-20, 30]], closed: true, towerSpacing: 0, merlon: { width: 4, gap: 4 }, gates: [{ at: [7, 30] }] }],
      towers: [{ center: [40, 0], top: 'lookout' }],
    } } }));
    const before = ok(e.execute({ op: 'project_get', input: { projectId: id } }));
    const g = e.execute({ op: 'project_generate', input: { projectId: id, format: 'schem' } });
    expect(g.ok, JSON.stringify(g.ok ? '' : g.errors)).toBe(true);
    if (g.ok) {
      expect((g.data as { blocks: number }).blocks).toBeGreaterThan(5000);
      expect(g.artifacts?.export).toBeDefined();
    }
    expect(ok(e.execute({ op: 'project_get', input: { projectId: id } }))).toEqual(before);
  });

  it('Undo, Liste, Löschen', () => {
    const n = view(e.execute({ op: 'project_get', input: { projectId: id } })).rooms.length;
    cmd([{ command: 'paintRoom', floor: 0, rect: [15, 0, 20, 6], roomTypeId: 'study' }]);
    expect(view(e.execute({ op: 'project_undo', input: { projectId: id } })).rooms.length).toBe(n);
    expect(ok(e.execute({ op: 'project_list', input: {} }))).toMatchObject([{ projectId: id }]);
    expect(ok(e.execute({ op: 'project_delete', input: { projectId: id } }))).toEqual({ deleted: true });
    expect(e.execute({ op: 'project_get', input: { projectId: id } })).toMatchObject({ ok: false, errors: [expect.stringContaining('Unbekanntes Projekt')] });
  });
});

describe('Projekt aus Bautyp', () => {
  it('übernimmt Grundriss, Stil, Gelände; Neu würfeln und Bautyp wechseln per Befehl', () => {
    const e = createEngine(ctx);
    const v = view(e.execute({ op: 'project_create', input: { seed: 4, buildingType: { buildingTypeId: 'townhouse', size: 'S' } } }));
    expect(v.rooms.length).toBeGreaterThan(2);
    const r1 = view(e.execute({ op: 'project_command', input: { projectId: v.projectId, commands: [{ command: 'rerollBuildingType' }] } }));
    expect(r1.rooms.length).toBeGreaterThan(0);
    const r2 = view(e.execute({ op: 'project_command', input: { projectId: v.projectId, commands: [
      { command: 'applyBuildingType', buildingTypeId: 'house' },
    ] } }));
    expect(r2.rooms.length).toBeGreaterThan(0);
    expect(e.execute({ op: 'project_generate', input: { projectId: v.projectId } }).ok).toBe(true);
  });
});

describe('rooms_generate mit Bauwerken', () => {
  it('Gartenmauer und angedockter Treppenturm', () => {
    const e = createEngine(ctx);
    const r = e.execute({ op: 'rooms_generate', input: {
      rooms: [{ floor: 0, roomTypeId: 'kitchen', rect: [0, 0, 8, 6] }, { floor: 0, roomTypeId: 'bedroom', rect: [9, 0, 14, 6] }],
      structures: { walls: [{ points: [[-6, -6], [20, -6], [20, 12], [-6, 12]], closed: true, profile: 'garden', gates: [{ at: [4, 12], width: 1 }] }] },
    } });
    expect(r.ok, JSON.stringify(r.ok ? '' : r.errors)).toBe(true);
  });
});

describe('Speichern und Laden', () => {
  it('Round-Trip über JSON: gleicher Stand, gleiche Welt', () => {
    const e = createEngine(ctx);
    const v = view(e.execute({ op: 'project_create', input: { seed: 9, buildingType: { buildingTypeId: 'farmhouse', size: 'S' } } }));
    ok(e.execute({ op: 'site_command', input: { projectId: v.projectId, commands: [{ command: 'setLighting', lighting: 'spawnproof' }] } }));
    const file = JSON.parse(JSON.stringify(ok(e.execute({ op: 'project_save', input: { projectId: v.projectId } }))));
    const loaded = view(e.execute({ op: 'project_load', input: { file } }));
    const a = ok(e.execute({ op: 'project_get', input: { projectId: v.projectId } }));
    const b = ok(e.execute({ op: 'project_get', input: { projectId: loaded.projectId } }));
    expect({ ...b, projectId: '' }).toEqual({ ...a, projectId: '' });
    const ga = e.execute({ op: 'project_generate', input: { projectId: v.projectId } });
    const gb = e.execute({ op: 'project_generate', input: { projectId: loaded.projectId } });
    expect(ga.ok && gb.ok && ga.artifacts!.export!.blocks.length === gb.artifacts!.export!.blocks.length).toBe(true);
  });
});

describe('Undo/Redo', () => {
  it('Redo stellt wieder her; neuer Befehl leert den Redo-Stapel', () => {
    const e = createEngine(ctx);
    const id = view(e.execute({ op: 'project_create', input: {} })).projectId;
    const paint = (x: number) => e.execute({ op: 'project_command', input: { projectId: id, commands: [{ command: 'paintRoom', floor: 0, rect: [x, 0, x + 4, 4], roomTypeId: 'study' }] } });
    paint(0);
    paint(5);
    expect(view(e.execute({ op: 'project_undo', input: { projectId: id, steps: 2 } })).rooms).toHaveLength(0);
    expect(view(e.execute({ op: 'project_redo', input: { projectId: id } })).rooms).toHaveLength(1);
    paint(20);
    expect(e.execute({ op: 'project_redo', input: { projectId: id } })).toMatchObject({ ok: false, errors: [expect.stringContaining('Nur 0')] });
  });
});

describe('W4-D: Dach-Einpassung und Traufkonsolen über die API', () => {
  const e = createEngine(ctx);
  const id = view(e.execute({ op: 'project_create', input: { name: 'Halle', seed: 5, themeId: 'medieval' } })).projectId;
  ok(e.execute({ op: 'project_command', input: { projectId: id, commands: [{ command: 'paintRoom', floor: 0, rect: [0, 0, 21, 15], roomTypeId: 'storage' }] } }));
  type Fit = { volumeId: string; floor: number; requested: string; pitch: string; area: number; split: boolean; knee: number };
  const fitOf = (shell: Record<string, unknown>): Fit[] | undefined => {
    ok(e.execute({ op: 'project_style', input: { projectId: id, shell } }));
    return ok(e.execute({ op: 'project_generate', input: { projectId: id } }))['roofFit'] as Fit[] | undefined;
  };

  it('roofFit im Ergebnis: geteiltes Dach (Standard), gesenkte Neigung mit heightBudget, nichts ohne beides', () => {
    const split = fitOf({ roof: 'gable', roofDetail: { pitch: 'normal', trim: true } });
    expect(split?.some((f) => f.split && f.pitch === 'normal')).toBe(true);
    const budget = fitOf({ roof: 'gable', roofDetail: { pitch: 'steep', trim: true, split: false, heightBudget: true } });
    expect(budget?.some((f) => !f.split && f.requested === 'steep' && f.pitch !== 'steep')).toBe(true);
    // W4-F (27.09.2026): ohne Teilung meldet das steile Dach den Kniestock (D5); ohne Kniestock und Teilung nichts
    expect(fitOf({ roof: 'gable', roofDetail: { pitch: 'steep', trim: true, split: false } })?.some((f) => f.knee > 0 && f.pitch === 'steep')).toBe(true);
    expect(fitOf({ roof: 'gable', roofDetail: { pitch: 'steep', trim: true, split: false, kneeWall: false } })).toBeUndefined();
  });

  it('Außen-Deko: eaveBraces als Gruppe (off) und ausdrücklich an trotz Traufenlaternen aus', () => {
    ok(e.execute({ op: 'project_style', input: { projectId: id, exterior: { density: 1, off: ['eaveBraces'] } } }));
    ok(e.execute({ op: 'project_style', input: { projectId: id, exterior: { off: ['eaveLanterns'], eaveBraces: true } } }));
    const got = view(e.execute({ op: 'project_get', input: { projectId: id } }));
    expect(got.projectId).toBe(id);
  });
});

describe('F Bereich neu einrichten (project_refurnish_block)', () => {
  it('Zone bzw. Rechteck neu, Rest unverändert, Undo in einem Schritt', () => {
    const e = createEngine(ctx);
    const id = view(e.execute({ op: 'project_create', input: { name: 'Bereich', seed: 4, themeId: 'medieval' } })).projectId;
    ok(e.execute({ op: 'project_command', input: { projectId: id, commands: [{ command: 'paintRoom', floor: 0, rect: [0, 0, 17, 9], roomTypeId: 'tavern' }] } }));
    ok(e.execute({ op: 'project_furnish', input: { projectId: id } }));
    type P = { id: string; pos: number[] };
    const before = (view(e.execute({ op: 'project_get', input: { projectId: id, placements: true } })).placements ?? []) as unknown as P[];
    const roomId = view(e.execute({ op: 'project_get', input: { projectId: id } })).rooms[0]!.id;
    const r = ok(e.execute({ op: 'project_refurnish_block', input: { projectId: id, roomId, zone: 0 } }));
    expect(r['ok']).toBe(true);
    expect((r['zones'] as unknown[]).length).toBeGreaterThanOrEqual(2);
    const after = (view(e.execute({ op: 'project_get', input: { projectId: id, placements: true } })).placements ?? []) as unknown as P[];
    const kept = before.filter((p) => after.some((q) => q.id === p.id));
    expect(kept.length).toBe(before.length - (r['removed'] as number));
    for (const p of kept) expect(after.find((q) => q.id === p.id)).toEqual(p);
    const rect = ok(e.execute({ op: 'project_refurnish_block', input: { projectId: id, roomId, rect: [10, 1, 14, 5], margin: 2 } }));
    expect(rect['ok']).toBe(true);
    ok(e.execute({ op: 'project_undo', input: { projectId: id, steps: 2 } }));
    const undone = (view(e.execute({ op: 'project_get', input: { projectId: id, placements: true } })).placements ?? []) as unknown as P[];
    expect(undone).toEqual(before);
    // genau eines von zone/rect
    expect(e.execute({ op: 'project_refurnish_block', input: { projectId: id, roomId } }).ok).toBe(false);
  });
});
