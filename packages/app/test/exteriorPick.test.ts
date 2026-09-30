/**
 * Klick auf ein Außen-Teil (Herkunft `x1:…`): Auswahl, Info (Bauteil, Gruppe, Ort), Rahmen, Bereinigung – geprüft am
 * Beispielhaus mit der Außen-Deko der Voreinstellung und gegen die Herkünfte der Rollen-Vorschau.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { NO_SELECTION, exteriorPartInfo, exteriorPartText, selectionBox, selectionFromOwner, validSelection } from '../src/selection.js';
import * as uc from '../src/usecases.js';
import { buildPreviewVoxels } from '../src/viewer/voxels.js';
import { sampleSession } from './sample.js';

const catalog = loadBundledCatalog().catalog!;

describe('Außen-Teil per Klick', () => {
  const s = sampleSession(catalog);
  const state = s.project.state;
  const style = uc.shellStyle(s);
  const plan = uc.exteriorOf(s.project, catalog, style)!;

  it('Klick → Außen-Teil gewählt; Info nennt Bauteil, Gruppe und Ort; Rahmen um seine Zellen', () => {
    const shutter = plan.placements.find((p) => p.group === 'shutters')!;
    expect(shutter).toBeDefined();
    const sel = selectionFromOwner(shutter.id, state);
    expect(sel).toEqual({ exteriorId: shutter.id });
    expect(validSelection(sel, state, plan)).toBe(sel);
    const info = exteriorPartInfo(sel, plan, catalog)!;
    // W2 (26.09.2026): Regel F6 (W2-FW) – Läden sind Stücke des Fenstermoduls; die Info nennt das Modul, die Gruppe den Laden
    expect(info).toEqual({ id: shutter.id, componentId: shutter.componentId, name: 'Fenstermodul Stadthaus', group: 'shutters', groupLabel: 'Fensterläden', where: 'EG, am Fenster' });
    expect(exteriorPartText(info)).toBe('Außen-Teil: Fenstermodul Stadthaus · Gruppe Fensterläden · EG, am Fenster');
    const box = selectionBox(sel, state, [], plan)!;
    for (const c of shutter.cells) for (let k = 0; k < 3; k++) {
      expect(c[k]).toBeGreaterThanOrEqual(box.min[k]!);
      expect(c[k]).toBeLessThanOrEqual(box.max[k]!);
    }
    // Möbel und Räume ohne Außen-Info
    expect(exteriorPartInfo({ roomId: state.rooms[0]!.id }, plan, catalog)).toBeUndefined();
  });

  it('jede Außen-Herkunft der Vorschau hat eine Info (Name aus dem Katalog, Gruppe mit Anzeigename)', () => {
    const voxels = buildPreviewVoxels(uc.shellOf(s.project, style), uc.placedViews(state, catalog), uc.exteriorViews(plan, catalog));
    const owners = new Set(voxels.map((v) => v.owner).filter((o): o is string => o?.startsWith('x1:') === true));
    expect(owners.size).toBeGreaterThan(5);
    for (const o of owners) {
      const info = exteriorPartInfo(selectionFromOwner(o, state), plan, catalog);
      expect(info, o).toBeDefined();
      expect(info!.name, o).not.toMatch(/^exterior\//); // Komponentenname, nicht die ID
      expect(info!.groupLabel.length, o).toBeGreaterThan(0);
    }
  });

  it('Gruppe aus, Außen-Deko aus oder unbekanntes Teil → keine Auswahl mehr', () => {
    const p = plan.placements.find((x) => x.group === 'shutters')!;
    const sel = { exteriorId: p.id };
    const off = uc.setShellStyle(s, { exterior: { ...style.exterior, groups: { ...style.exterior.groups, shutters: false } } }, catalog);
    const offPlan = uc.exteriorOf(off.project, catalog, uc.shellStyle(off));
    expect(validSelection(sel, off.project.state, offPlan)).toBe(NO_SELECTION);
    expect(validSelection(sel, state, undefined)).toBe(NO_SELECTION);
    expect(validSelection({ exteriorId: 'x1:shutters:gibtsnicht@0,0,0' }, state, plan)).toBe(NO_SELECTION);
    expect(exteriorPartInfo(sel, undefined, catalog)).toBeUndefined();
  });
});
