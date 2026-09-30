/**
 * Q5/P15 in der App: Der Nutzungszustand (`ProjectState.storyState`) lässt sich setzen und abwählen, liegt in der
 * Historie (Undo-fähig) und ändert die Einrichtung **nicht** – die Spuren tauschen nur Blöcke der Hüllzellen.
 * „ohne" (undefined) ist bitgleich zum Stand ohne Zustand.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as uc from '../src/usecases.js';

const catalog = loadBundledCatalog().catalog!;

function bau(): uc.Session {
  let s = uc.createSession(7, 'Zustandshaus');
  s = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 8, z2: 6 }, 'kitchen', 0).session;
  return s;
}

describe('App: Nutzungszustand (Q5/P15)', () => {
  it('setzt den Zustand im Projekt und lässt ihn wieder abwählen', () => {
    const a = bau();
    const b = uc.setStoryState(a, catalog, 'verlassen');
    expect(b.project.state.storyState).toBe('verlassen');
    expect(uc.storyStateLabel(b.project.state.storyState)).toBe('verlassen');
    expect(uc.storyStateLabel(undefined)).toBe('ohne');

    const c = uc.setStoryState(b, catalog, undefined);
    expect(c.project.state.storyState).toBeUndefined();
    // Die Einrichtung bleibt unverändert: der Zustand tauscht nur Blöcke der Hülle.
    expect(JSON.stringify(c.project.state.placements)).toBe(JSON.stringify(a.project.state.placements));
  });

  it('„ohne" ist bitgleich zum Stand ohne Zustand', () => {
    const a = bau();
    const b = uc.setStoryState(a, catalog, undefined);
    expect(b.project.state.storyState).toBeUndefined();
    expect(JSON.stringify(b.project.state.placements)).toBe(JSON.stringify(a.project.state.placements));
    expect(JSON.stringify(b.project.state.rooms)).toBe(JSON.stringify(a.project.state.rooms));
  });

  it('alle fünf Zustände sind wählbar und werden gespeichert (Projektdatei-Runde)', () => {
    for (const id of ['neu', 'bewohnt', 'verlassen', 'verfallen', 'belagert'] as const) {
      const s = uc.setStoryState(bau(), catalog, id);
      expect(s.project.state.storyState, id).toBe(id);
      const text = serializeProject(s, { savedAt: new Date(0) });
      const wieder = parseProjectFile(text, { catalog });
      if (!wieder.ok) throw new Error(wieder.error);
      expect(wieder.session.project.state.storyState, id).toBe(id);
    }
  });
});
