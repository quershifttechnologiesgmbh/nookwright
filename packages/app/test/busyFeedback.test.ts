/**
 * W11-B (Usability): Rückmeldung beim Übernehmen eines Bautyps und Fuß des Assistenten.
 * R6: Nach „Übernehmen“ blieb die Oberfläche bis 30 s ohne Anzeige stehen, weil das Einrichten synchron rechnet,
 * bevor der Browser „Wird gebaut …“ zeichnen kann. Bei 1280 × 720 lagen die Vorschläge unter dem Falz.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { afterPaint } from '../src/ui/afterPaint.js';
import { proposalFootLabel } from '../src/ui/proposalGroups.js';

describe('afterPaint: erst zeichnen, dann rechnen', () => {
  it('Arbeit läuft erst im Timer nach dem nächsten Bild, nicht sofort', () => {
    const log: string[] = [];
    const frames: Array<() => void> = [];
    const timers: Array<() => void> = [];
    afterPaint(() => log.push('work'), { requestAnimationFrame: (cb) => frames.push(cb), setTimeout: (cb) => timers.push(cb) });
    expect(log).toEqual([]);
    expect(timers).toHaveLength(0);
    frames.shift()!(); // vor dem Zeichnen: noch nicht rechnen
    expect(log).toEqual([]);
    timers.shift()!(); // nach dem Zeichnen
    expect(log).toEqual(['work']);
  });

  it('ohne requestAnimationFrame (Hintergrund, Tests) nur über den Timer', () => {
    const timers: Array<() => void> = [];
    let done = false;
    afterPaint(() => (done = true), { setTimeout: (cb) => timers.push(cb) });
    expect(done).toBe(false);
    timers.shift()!();
    expect(done).toBe(true);
  });

  it('der Assistent übernimmt über afterPaint, zeigt „Wird gebaut …“ und sperrt den zweiten Klick', () => {
    const code = readFileSync(new URL('../src/ui/BuildingTypeWizard.tsx', import.meta.url), 'utf8');
    expect(code).toMatch(/afterPaint\(\(\) => \{\s*try \{\s*p\.onAccept\(/);
    expect(code).toMatch(/\{accepting \? 'Wird gebaut …' : 'Übernehmen'\}/);
    expect(code).toMatch(/if \(accepting \|\|/);
    expect(code).toMatch(/aria-busy=\{accepting\}/);
  });
});

describe('Fuß des Assistenten nennt den gewählten Vorschlag', () => {
  it('Nummer, Maße, Etagen, Keller, Räume', () => {
    expect(proposalFootLabel(1, { width: 24, depth: 20, floors: 3, cellar: true, rooms: 15 })).toBe('Vorschlag 2: 24 × 20 · 3 Etagen + Keller · 15 Räume');
    expect(proposalFootLabel(0, { width: 9, depth: 7, floors: 1, cellar: false, rooms: 1 })).toBe('Vorschlag 1: 9 × 7 · 1 Etage · 1 Raum');
    expect(proposalFootLabel(-1, { width: 9, depth: 7, floors: 2, cellar: false, rooms: 4 })).toBe('Gewählter Vorschlag: 9 × 7 · 2 Etagen · 4 Räume');
  });
});
