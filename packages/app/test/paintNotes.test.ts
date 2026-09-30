import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { paintNotes } from '../src/ui/paintNotes.js';
import * as uc from '../src/usecases.js';

const catalog = loadBundledCatalog().catalog!;

/**
 * Review 3 (kleinere Punkte): „1×1-Raum stillschweigend verworfen“ und „Übermalen schluckt einen Raum ohne
 * Hinweis“. Beides sind reine Hinweise auf zwei Projektzuständen – hier ohne React geprüft.
 */
describe('Hinweise nach dem Malen eines Raums (Review 3)', () => {
  it('zu kleiner Raum: keine Möbel eingerichtet, aber ein Klartext-Hinweis', () => {
    const s0 = uc.createSession(1);
    const r = uc.paintRect(s0, catalog, { x1: 4, z1: 4, x2: 4, z2: 4 }, 'bedroom');
    expect(r.roomId).toBeDefined();
    expect(r.session.project.state.placements).toHaveLength(0);
    const notes = paintNotes(s0.project.state, r.session.project.state, r.roomId, catalog);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('zu klein');
    expect(notes[0]).toContain('Schlafzimmer');
    expect(notes[0]).toContain('keine Möbel');
  });

  it('passender Raum: keine Hinweise', () => {
    const s0 = uc.createSession(1);
    const r = uc.paintRect(s0, catalog, { x1: 2, z1: 2, x2: 9, z2: 8 }, 'bedroom');
    expect(r.session.project.state.placements.length).toBeGreaterThan(0);
    expect(paintNotes(s0.project.state, r.session.project.state, r.roomId, catalog)).toEqual([]);
  });

  it('übermalter Raum wird benannt, samt Rückgängig-Hinweis', () => {
    const a = uc.paintRect(uc.createSession(1), catalog, { x1: 2, z1: 2, x2: 9, z2: 8 }, 'bedroom');
    const before = a.session.project.state;
    const b = uc.paintRect(a.session, catalog, { x1: 6, z1: 2, x2: 12, z2: 8 }, 'kitchen');
    const text = paintNotes(before, b.session.project.state, b.roomId, catalog).join(' · ');
    expect(text).toContain('übermalt');
    expect(text).toContain('Schlafzimmer');
    expect(text).toContain('Rückgängig');
  });

  it('ohne neue Raum-ID (leeres Rechteck) keine Hinweise', () => {
    const s0 = uc.createSession(1);
    expect(paintNotes(s0.project.state, s0.project.state, undefined, catalog)).toEqual([]);
  });
});
