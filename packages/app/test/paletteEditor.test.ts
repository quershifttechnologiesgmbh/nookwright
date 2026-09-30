/**
 * W13-G Blockpalette in der App: Hilfen des Editors (Gruppe/Tausch setzen, Sperre), Use Case mit Undo und Speichern,
 * Engine liest die App-Datei mit derselben Palette (`project_load` → `project_get`/`palette_suggest`).
 */
import { describe, expect, it } from 'vitest';
import { createEngine, type ExecuteResult } from '@mcda/engine';
import { REPO_CATALOG } from '@mcda/engine/node';
import { nodeContext } from '@mcda/pipeline/node';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as uc from '../src/usecases.js';
import { groupsWith, lockedToggle, swapsWith } from '../src/ui/paletteOverrides.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const engine = createEngine(nodeContext(REPO_CATALOG));
const ok = (r: ExecuteResult): Record<string, unknown> => {
  if (!r.ok) throw new Error(r.errors.join(' | '));
  return r.data as Record<string, unknown>;
};

describe('Paletten-Editor: Hilfen', () => {
  it('Gruppe setzen und zurücksetzen; leer → undefined (bitgleich)', () => {
    const a = groupsWith(undefined, 'roof', 'bricks');
    expect(a).toEqual({ groups: { roof: 'bricks' } });
    expect(groupsWith(a, 'roof', undefined)).toBeUndefined();
  });
  it('Tausch: einer je Quelle, entfernen, Gruppen bleiben', () => {
    const a = swapsWith(groupsWith(undefined, 'wall', 'calcite'), 'oak', 'spruce');
    expect(swapsWith(a, 'oak', 'birch')?.swaps).toEqual([{ from: 'oak', to: 'birch' }]);
    expect(swapsWith(a, 'oak', undefined)).toEqual({ groups: { wall: 'calcite' } });
  });
  it('Sperre umschalten', () => {
    expect(lockedToggle(lockedToggle([], 'roof'), 'wall')).toEqual(['roof', 'wall']);
    expect(lockedToggle(['roof', 'wall'], 'roof')).toEqual(['wall']);
  });
});

describe('App: Blockpalette im Projekt', () => {
  it('ein Undo-Schritt, gespeichert, Engine liest dieselben Überschreibungen', () => {
    let s = uc.createSession(7, 'Palettenhaus');
    s = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 8, z2: 6 }, 'bedroom', 0).session;
    const before = s.past.length;
    const next = uc.setPaletteOverrides(s, catalog, { groups: { roof: 'bricks' }, swaps: [{ from: 'oak', to: 'spruce' }] });
    expect(next.past.length).toBe(before + 1);
    expect(uc.undo(next).project.state.paletteOverrides).toBeUndefined();
    const text = serializeProject(next, { savedAt: new Date(0) });
    const loaded = parseProjectFile(text, { catalog, themes: load.themeCatalog! });
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.session.project.state.paletteOverrides).toEqual(next.project.state.paletteOverrides);
    const { projectId } = ok(engine.execute({ op: 'project_load', input: { file: JSON.parse(text) } })) as { projectId: string };
    const view = ok(engine.execute({ op: 'project_get', input: { projectId } }));
    expect(view['paletteOverrides']).toEqual({ groups: { roof: 'bricks' }, swaps: [{ from: 'oak', to: 'spruce' }] });
  });
});
