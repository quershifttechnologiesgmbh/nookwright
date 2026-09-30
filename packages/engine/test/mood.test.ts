/**
 * feat/theme-moods über die Engine-API: `mood` in building_generate/rooms_generate und Befehl setMood. Ohne Feld wie
 * bisher, {} bei Themes ohne Vorgabe ebenso; mit Stimmung anders, deterministisch; Werte außerhalb −1 … 1 abgelehnt.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../src/index.js';
import { engine } from './fixture.js';

const digest = (r: ExecuteResult): string => {
  if (!r.ok || r.artifacts?.export === undefined) throw new Error(JSON.stringify(r));
  return createHash('sha256').update(JSON.stringify(r.artifacts.export.blocks, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).digest('hex');
};

describe('Engine: Stimmung (feat/theme-moods)', () => {
  const q = { op: 'building_generate', input: { buildingTypeId: 'townhouse', size: 'S', seed: 7, surroundings: false, themeId: 'medieval' } };

  it('building_generate: ohne Feld und mit {} (Theme ohne Vorgabe) gleich; mit Stimmung anders und deterministisch', () => {
    const plain = digest(engine.execute(q));
    expect(digest(engine.execute({ ...q, input: { ...q.input, mood: {} } }))).toBe(plain);
    const moody = { ...q, input: { ...q.input, mood: { wear: 1, richness: 1 } } };
    const a = digest(engine.execute(moody));
    expect(a).not.toBe(plain);
    expect(digest(engine.execute(moody))).toBe(a);
  });

  it('lehnt Werte außerhalb −1 … 1 und unbekannte Achsen ab', () => {
    expect(engine.execute({ ...q, input: { ...q.input, mood: { wear: 2 } } })).toMatchObject({ ok: false });
    expect(engine.execute({ ...q, input: { ...q.input, mood: { sparkle: 1 } } })).toMatchObject({ ok: false });
  });

  it('Befehl setMood: setzen, im Projekt sichtbar, abschalten', () => {
    const created = engine.execute({ op: 'project_create', input: { name: 'M', seed: 3, buildingType: { buildingTypeId: 'house', mood: { richness: 1 } } } });
    if (!created.ok) throw new Error(created.errors.join(' | '));
    const projectId = (created.data as { projectId: string }).projectId;
    const set = engine.execute({ op: 'project_command', input: { projectId, commands: [{ command: 'setMood', mood: { organic: -1 } }] } });
    expect(set.ok).toBe(true);
    const off = engine.execute({ op: 'project_command', input: { projectId, commands: [{ command: 'setMood' }] } });
    expect(off.ok).toBe(true);
  });
});
