import { circulation } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { accessHints } from '../src/ui/access.js';
import { qualitySummary } from '../src/ui/quality.js';
import * as uc from '../src/usecases.js';

const catalog = loadBundledCatalog().catalog!;

/**
 * Review 3: „Keller-Wertung 86 % · sehr gut“ ohne Tür/Treppe. Hier die Kette am echten Bau: Der Laufweg-Bericht
 * findet den Kellerraum ohne Zugang, und die Anzeige nennt das dann auch.
 */
describe('Keller ohne Zugang: Bericht und Wertung (Review 3)', () => {
  it('Kellerraum ohne Treppe steht in `unreachable` und die Wertung sagt „kein Zugang“', () => {
    const erdgeschoss = uc.paintRect(uc.createSession(3), catalog, { x1: 2, z1: 2, x2: 11, z2: 9 }, 'bedroom').session;
    const { session, floorIndex } = uc.addFloor(erdgeschoss, catalog, { below: true });
    const keller = uc.paintRect(session, catalog, { x1: 2, z1: 2, x2: 8, z2: 7 }, 'storage', floorIndex);
    expect(keller.roomId).toBeDefined();

    const report = circulation(uc.shellOf(keller.session.project), keller.session.project);
    expect(report.unreachable).toContain(keller.roomId);
    expect(report.warnings.join(' ')).toContain(keller.roomId!);

    const q = qualitySummary({ score: 0.86, parts: [{ id: 'required', label: 'Pflichtobjekte', value: 1 }], notes: [] }, { unreachable: report.unreachable.includes(keller.roomId!) });
    expect(q.grade).toContain('kein Zugang');
    expect(q.tone).toBe('weak');
    expect(q.alerts.join(' ')).toContain('Kein Zugang');
  });
});

/**
 * Review 4 (fremde Korrektur, hier abgesichert): Der Laufweg-Bericht meldete **jeden** Raum über dem Eingang als
 * „ohne Weg“ – auch mit Treppe. Diese Prüfung hält den Zustand am echten Bau fest, damit der Fehlalarm nicht
 * zurückkommt (er hätte über die Keller-Wertung jeden OG-Raum als „nicht erreichbar“ angezeigt).
 */
describe('Treppe verbindet die Etagen (Review 4, Fehlalarm)', () => {
  const zweistoeckig = (mitTreppe: boolean): uc.Session => {
    const unten = uc.paintRect(uc.createSession(3), catalog, { x1: 2, z1: 2, x2: 11, z2: 9 }, 'hallway').session;
    const { session, floorIndex } = uc.addFloor(unten, catalog);
    expect(floorIndex).toBe(1);
    const oben = uc.paintRect(session, catalog, { x1: 2, z1: 2, x2: 11, z2: 9 }, 'bedroom', floorIndex).session;
    if (!mitTreppe) return oben;
    return uc.placeStairs(oben, catalog, { floor: 0, origin: [4, 4], facing: 'east', type: 'straight' }).session;
  };

  it('mit Treppe keine „nicht erreichbar“-Meldung, ohne Treppe schon', () => {
    const mit = zweistoeckig(true);
    const reportMit = circulation(uc.shellOf(mit.project), mit.project);
    expect(reportMit.unreachable).toEqual([]);
    expect(reportMit.warnings.filter((w) => w.includes('Ohne Weg vom Eingang'))).toEqual([]);

    const ohne = zweistoeckig(false);
    const reportOhne = circulation(uc.shellOf(ohne.project), ohne.project);
    expect(reportOhne.unreachable.length).toBeGreaterThan(0);
    const hints = accessHints(ohne.project.state, uc.shellOf(ohne.project).rooms, uc.floorLabel, (id) => id);
    expect(hints.map((h) => h.text).join(' ')).toMatch(/keine Treppe herauf/);
  });
});
