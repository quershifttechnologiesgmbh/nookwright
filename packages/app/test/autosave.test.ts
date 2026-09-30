/**
 * Arbeit geht nicht verloren (Nutzer-Review 24.09.2026): automatisches Speichern, Warnung beim Schließen,
 * Wiederaufnahme-Angebot, Rückfrage vor dem Ersetzen. Die Entscheidungen sind rein – hier geprüft.
 */
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_DELAY_MS, FOREIGN_SAVE_HINT, autosaveAction, autosaveLabel, floorRemovalText, foreignSave, hasContent, needsReplaceConfirm, resumeLabel,
  replaceConfirm, resumeOffer, scheduleAutosave, shouldGuardUnload,
} from '../src/ui/autosave.js';
import { floorLabel } from '../src/usecases.js';

function empty(): Project {
  return Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
}

describe('Automatisches Speichern und Verlustschutz', () => {
  it('leeres Projekt gilt als „kein Inhalt", ein gemalter Raum als Inhalt', () => {
    const p = empty();
    expect(hasContent(p.state)).toBe(false);
    expect(needsReplaceConfirm(p.state)).toBe(false);
    p.paintRoom(0, CellSet.rect(0, 0, 3, 3), 'bedroom');
    expect(hasContent(p.state)).toBe(true);
    expect(needsReplaceConfirm(p.state)).toBe(true);
  });

  it('Statuszeile nennt Zeitpunkt oder Grund, nie beides', () => {
    expect(autosaveLabel(undefined, undefined, true)).toBeUndefined();
    expect(autosaveLabel(Date.UTC(2026, 8, 24, 10, 5, 7), undefined, true)).toMatch(/^Automatisch gespeichert \d\d:\d\d:\d\d$/);
    expect(autosaveLabel(undefined, undefined, false)).toContain('nicht möglich');
    expect(autosaveLabel(123, 'Speicher voll', true)).toContain('Speicher voll');
    // Ohne Speicher zählt der Grund „nicht verfügbar", auch wenn ein alter Zeitpunkt vorliegt
    expect(autosaveLabel(123, undefined, false)).toContain('nicht möglich');
    // Fremder Tab hat Vorrang vor einem alten Fehler (Review 3: „Zwei Tabs")
    expect(autosaveLabel(123, 'voll', true, FOREIGN_SAVE_HINT)).toContain('anderer Tab');
  });

  it('Autosave-Entscheidung: vor der ersten Nutzeränderung wird NICHTS geschrieben (Regression)', () => {
    // Genau der Code, den App.tsx ausführt: unberührtes Startprojekt + vorhandener Speicherstand → kein Schreiben
    expect(autosaveAction(false, true, undefined, '2026-09-24T10:00:00.000Z')).toBe('skip');
    expect(autosaveAction(false, true, undefined, undefined)).toBe('skip');
    // Ohne Speicher wird nie geschrieben
    expect(autosaveAction(true, false, undefined, undefined)).toBe('skip');
    // Nach der ersten Änderung: schreiben (auch wenn schon etwas gespeichert ist, das wir geladen haben)
    expect(autosaveAction(true, true, '2026-09-24T10:00:00.000Z', '2026-09-24T10:00:00.000Z')).toBe('save');
    expect(autosaveAction(true, true, undefined, undefined)).toBe('save');
    // Fremder, neuerer Stand blockt
    expect(autosaveAction(true, true, '2026-09-24T10:00:00.000Z', '2026-09-24T10:00:05.000Z')).toBe('blocked');
  });

  it('Effekt-Ablauf: Konflikt wird SOFORT gemeldet, ohne Timer (Review 4, Regression)', () => {
    const calls: string[] = [];
    let timer: (() => void) | undefined;
    const setTimer = (fn: () => void, ms: number): number => {
      calls.push(`timer:${ms}`);
      timer = fn;
      return 1;
    };
    // Konflikt schon beim ersten Hinsehen → Meldung sofort, kein Timer, kein Schreiben
    const id = scheduleAutosave(
      { action: () => 'blocked', write: () => calls.push('write'), blocked: () => calls.push('blocked') },
      { setTimer },
    );
    expect(id).toBeUndefined();
    expect(calls).toEqual(['blocked']);
    expect(timer).toBeUndefined();
  });

  it('Effekt-Ablauf: skip → kein Timer, save → Timer, Konflikt in der Wartezeit → Meldung statt Schreiben', () => {
    const calls: string[] = [];
    let timer: (() => void) | undefined;
    const opts = { delayMs: 1200, setTimer: (fn: () => void, ms: number): number => { calls.push(`timer:${ms}`); timer = fn; return 7; } };

    // unberührt → gar nichts (die Regression aus §48.1)
    expect(scheduleAutosave({ action: () => 'skip', write: () => calls.push('write'), blocked: () => calls.push('blocked') }, opts)).toBeUndefined();
    expect(calls).toEqual([]);

    // speichern → Timer mit der Verzögerung, dann schreiben
    let action: 'save' | 'blocked' = 'save';
    const id = scheduleAutosave({ action: () => action, write: () => calls.push('write'), blocked: () => calls.push('blocked') }, opts);
    expect(id).toBe(7);
    expect(calls).toEqual(['timer:1200']);
    timer!();
    expect(calls).toEqual(['timer:1200', 'write']);

    // … aber ein anderer Tab schreibt in der Wartezeit → beim Feuern neu entscheiden und nur melden
    calls.length = 0;
    action = 'save';
    scheduleAutosave({ action: () => action, write: () => calls.push('write'), blocked: () => calls.push('blocked') }, opts);
    action = 'blocked';
    timer!();
    expect(calls).toEqual(['timer:1200', 'blocked']);
  });

  it('zweiter Tab: fremdes Speichern wird erkannt, eigener Stand nicht', () => {
    const t1 = '2026-09-24T10:00:00.000Z';
    const t2 = '2026-09-24T10:00:05.000Z';
    // Ein anderer Tab hat nach unserem Schreiben gespeichert → nicht überschreiben
    expect(foreignSave(t1, t2)).toBe(true);
    // Unser eigener Stand (gleich alt) oder ein älterer fremder: speichern ist in Ordnung
    expect(foreignSave(t1, t1)).toBe(false);
    expect(foreignSave(t2, t1)).toBe(false);
    // Dieser Tab hat noch nie geschrieben, im Speicher liegt aber etwas → fremd
    expect(foreignSave(undefined, t1)).toBe(true);
    expect(foreignSave('', t1)).toBe(true);
    // Kein gespeicherter Stand → nie ein Konflikt
    expect(foreignSave(t1, undefined)).toBe(false);
    expect(foreignSave(undefined, '')).toBe(false);
    expect(FOREIGN_SAVE_HINT).toContain('neu laden');
  });

  it('beim Schließen nur warnen, wenn Speichern nicht greift – und nur mit Inhalt', () => {
    expect(shouldGuardUnload(true, undefined, true)).toBe(false); // Autosave läuft: keine Abfrage
    expect(shouldGuardUnload(false, undefined, true)).toBe(true); // kein Speicher, aber Inhalt
    expect(shouldGuardUnload(true, 'voll', true)).toBe(true); // Autosave kaputt
    expect(shouldGuardUnload(false, undefined, false)).toBe(false); // nichts zu verlieren
    expect(shouldGuardUnload(true, 'voll', false)).toBe(false);
  });

  it('Wiederaufnahme nur direkt nach dem Laden anbieten, und nur mit gespeichertem Stand', () => {
    const s = { name: 'Bauernhaus', savedAt: '2026-09-24T10:05:00.000Z' };
    expect(resumeOffer(s, true)).toBe(true); // frisch geladen, noch nichts angefasst
    expect(resumeOffer(s, false)).toBe(false); // schon geändert: eigene Arbeit hat Vorrang
    expect(resumeOffer(undefined, true)).toBe(false);
    expect(resumeLabel(s)).toContain('Bauernhaus');
    expect(resumeLabel({ name: 'X', savedAt: '' })).toBe('Zuletzt im Browser gespeichert: „X“');
  });

  it('Entprellung ist lang genug für eine Malgeste, aber unter zwei Sekunden', () => {
    expect(AUTOSAVE_DELAY_MS).toBeGreaterThanOrEqual(500);
    expect(AUTOSAVE_DELAY_MS).toBeLessThan(2000);
  });
});

describe('Regression: Autosave darf gespeicherte Arbeit nicht überschreiben', () => {
  it('vor der ersten Nutzeränderung wird nicht gespeichert (leeres Startprojekt bleibt harmlos)', () => {
    // Der Merker `touched` steuert den Autosave; die Regel ist bewusst als reine Entscheidung formuliert.
    const darfSpeichern = (storeAvailable: boolean, touched: boolean): boolean => storeAvailable && touched;
    expect(darfSpeichern(true, false), 'frisch geladen, nichts geändert').toBe(false);
    expect(darfSpeichern(true, true), 'nach einer Änderung').toBe(true);
    expect(darfSpeichern(false, true), 'ohne Speicher').toBe(false);
    // Und das Wiederaufnahme-Angebot bleibt sichtbar, solange nichts geändert wurde
    const s = { name: 'Wohnhaus', savedAt: '2026-09-24T10:05:00.000Z' };
    expect(resumeOffer(s, true)).toBe(true);
    expect(resumeOffer(s, false)).toBe(false);
  });
});

describe('Rückfrage vor dem Ersetzen (W1: auch ein nicht fortgesetzter Stand im Browser zählt)', () => {
  const date = (iso: string) => (iso === '' ? '' : '24.09.26, 12:05');
  const stored = { name: 'Bauernhaus', savedAt: '2026-09-24T10:05:00.000Z' };

  it('leeres Projekt ohne gespeicherten Stand: keine Rückfrage', () => {
    expect(replaceConfirm(empty().state, undefined, date)).toBeUndefined();
  });

  it('Projekt mit Inhalt: bisherige Rückfrage (Rückgängig holt es zurück)', () => {
    const p = empty();
    p.paintRoom(0, CellSet.rect(0, 0, 3, 3), 'bedroom');
    const ask = replaceConfirm(p.state, stored, date)!;
    expect(ask.title).toBe('Aktuelles Projekt ersetzen?');
    expect(ask.body).toContain('Rückgängig');
  });

  it('leeres Projekt, aber „Fortsetzen“ offen (z. B. über die Website mit Beschreibung gekommen): fragen, Stand nennen', () => {
    const ask = replaceConfirm(empty().state, stored, date)!;
    expect(ask.title).toBe('Gespeichertes Projekt ersetzen?');
    expect(ask.body).toContain('„Bauernhaus“ (gespeichert 24.09.26, 12:05)');
    expect(ask.body).toContain('Fortsetzen');
    expect(replaceConfirm(empty().state, { name: 'Ohne Datum', savedAt: '' }, date)!.body).toContain('„Ohne Datum“. Das neue Projekt');
  });
});

describe('Rückfrage vor dem Entfernen einer Etage (Red-Team-Review)', () => {
  it('der Text nennt Räume, Möbel und Treppen der Etage', () => {
    const p = empty();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 8, 8), 'bedroom');
    p.placeStairs(0, [2, 2], 'east');
    p.addFloor();
    const text = floorRemovalText(p.state, 1, floorLabel);
    expect(text).toMatch(/^1\. OG wird samt 1 Raum, 0 Möbeln, 1 Treppe entfernt\./);
    expect(text).toContain('Rückgängig');
  });
});
