/**
 * feat/theme-moods in der App: Stimmung setzen/abschalten (Undo-fähig, im Projekt gespeichert), Räume werden neu
 * eingerichtet, und App und Anwendungsdienst richten mit derselben Stimmung gleich ein (Regel `effectiveMood` aus
 * @mcda/pipeline, Solver-Option `mood`).
 */
import { describe, expect, it } from 'vitest';
import { createEngine, type ExecuteResult } from '@mcda/engine';
import { REPO_CATALOG } from '@mcda/engine/node';
import { nodeContext } from '@mcda/pipeline/node';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const engine = createEngine(nodeContext(REPO_CATALOG));
const ok = (r: ExecuteResult): Record<string, unknown> => {
  if (!r.ok) throw new Error(r.errors.join(' | '));
  return r.data as Record<string, unknown>;
};

function bau(): uc.Session {
  let s = uc.createSession(7, 'Stimmungshaus');
  s = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 8, z2: 6 }, 'bedroom', 0).session;
  s = uc.paintRect(s, catalog, { x1: 9, z1: 0, x2: 16, z2: 6 }, 'kitchen', 0).session;
  return s;
}

describe('App: Stimmung (feat/theme-moods)', () => {
  it('an/aus: im Projekt, Räume neu eingerichtet, aus = wieder die alte Einrichtung', () => {
    const a = bau();
    const b = uc.setMood(a, catalog, { richness: 1, organic: -1 });
    expect(b.project.state.mood).toEqual({ richness: 1, organic: -1 });
    expect(JSON.stringify(b.project.state.placements)).not.toBe(JSON.stringify(a.project.state.placements));
    const c = uc.setMood(b, catalog, undefined);
    expect(c.project.state.mood).toBeUndefined();
    expect(JSON.stringify(c.project.state.placements.map((p) => [p.componentId, p.variantId, p.pose])))
      .toBe(JSON.stringify(a.project.state.placements.map((p) => [p.componentId, p.variantId, p.pose])));
    // neutral ohne Theme-Vorgabe (medieval): kein Neueinrichten, bitgleich
    const d = uc.setMood(a, catalog, {});
    expect(d.project.state.mood).toEqual({});
    expect(JSON.stringify(d.project.state.placements)).toBe(JSON.stringify(a.project.state.placements));
  });

  it('Projektdatei-Runde: die Stimmung bleibt erhalten', () => {
    const s = uc.setMood(bau(), catalog, { wear: 0.5, formality: -1 });
    const wieder = parseProjectFile(serializeProject(s, { savedAt: new Date(0) }), { catalog });
    if (!wieder.ok) throw new Error(wieder.error);
    expect(wieder.session.project.state.mood).toEqual({ wear: 0.5, formality: -1 });
  });

  it('App und Engine (setMood + project_furnish) richten mit Stimmung gleich ein', () => {
    const s = sampleSession(catalog);
    const mood = { richness: -1, formality: 1, organic: -1 };
    const app = uc.setMood(s, catalog, mood);
    const loaded = ok(engine.execute({ op: 'project_load', input: { file: JSON.parse(serializeProject(s, { savedAt: new Date(0) })) } }));
    const projectId = loaded['projectId'] as string;
    ok(engine.execute({ op: 'project_command', input: { projectId, commands: [{ command: 'setMood', mood }] } }));
    ok(engine.execute({ op: 'project_furnish', input: { projectId } }));
    const eng = ok(engine.execute({ op: 'project_get', input: { projectId, placements: true } }))['placements'] as { roomId: string; componentId: string; pos: number[]; rot: number; mirror: string }[];
    const set = (xs: ReadonlyArray<{ roomId: string; componentId: string; pos: readonly number[]; rot: number; mirror: string }>) =>
      xs.map((p) => JSON.stringify([p.roomId, p.componentId, p.pos, p.rot, p.mirror])).sort();
    const appSet = set(app.project.state.placements.map((p) => ({ roomId: p.roomId, componentId: p.componentId, pos: p.pose.pos, rot: p.pose.rot, mirror: p.pose.mirror })));
    expect(set(eng)).toEqual(appSet);
    expect(appSet).not.toEqual(set(s.project.state.placements.map((p) => ({ roomId: p.roomId, componentId: p.componentId, pos: p.pose.pos, rot: p.pose.rot, mirror: p.pose.mirror }))));
  });

  it('W8-H Statuszeile: ohne Wirkung (medieval, kein Regler) sagt sie das statt „geändert“', () => {
    // medieval: Theme ohne Stimmung. Neue Projekte starten mit `mood: {}` (feat/theme-moods-on) – daher erst ausschalten
    const a = uc.setMood(bau(), catalog, undefined);
    expect(uc.moodChangeLabel(catalog, a.project.state, {})).toBe('Stimmung an (keine Wirkung bei diesem Theme ohne Regler)');
    const on = uc.setMood(a, catalog, {});
    expect(uc.moodChangeLabel(catalog, on.project.state, undefined)).toBe('Stimmung aus (hatte bei diesem Theme keine Wirkung)');
    expect(uc.moodChangeLabel(catalog, on.project.state, { richness: 0 })).toBe('Stimmung geändert (neutral – keine Wirkung)');
    expect(uc.moodChangeLabel(catalog, on.project.state, { richness: 1 })).toBe('Stimmung geändert');
    const rich = uc.setMood(on, catalog, { richness: 1 });
    expect(uc.moodChangeLabel(catalog, rich.project.state, undefined)).toBe('Stimmung aus');
    // Theme mit eigener Stimmung (rustic): „an“ wirkt sofort
    const r = uc.setMood(uc.createSession(7, 'Rustikal', 'rustic'), catalog, undefined);
    expect(uc.moodChangeLabel(catalog, r.project.state, {})).toBe('Stimmung an');
  });
});
