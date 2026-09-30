/**
 * W12-E (Review R6-5): Editor „Zugang“ und Exportdialog am echten Bauernhaus aus dem Assistenten. Die freistehende
 * Scheune (W9-G3) hat ein eigenes Tor und ist über den Hof erreichbar: kein Hinweis. Ohne Tor (Türen der Scheune aus
 * der Hülle entfernt) ist sie wirklich unerreichbar und wird weiter gemeldet. Gleiche Regel wie die Engine
 * (`circulation`, @mcda/pipeline).
 */
import { describe, expect, it } from 'vitest';
import type { RoomId, Shell } from '@mcda/blueprint';
import { circulation } from '@mcda/pipeline';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { accessHints, mergeAccessWarnings } from '../src/ui/access.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

/** Wie `App.tsx` (`access`): eigene Hinweise + Laufweg-Warnungen in Nutzersprache – Liste für Panel und Export. */
function accessOf(session: uc.Session, shell: Shell): string[] {
  const state = session.project.state;
  const name = (id: RoomId): string => `${state.rooms.find((r) => r.id === id)?.roomTypeId ?? '?'} ${id}`;
  const report = circulation(shell, session.project);
  return mergeAccessWarnings(accessHints(state, shell.rooms, uc.floorLabel, name), report.warnings, state, name, uc.floorLabel);
}

describe('W12-E: Bauernhaus mit Scheune – Zugang im Editor und im Export', () => {
  for (const size of ['M', 'L'] as const) {
    it(`Bauernhaus ${size}: Scheune mit eigenem Tor → kein Zugangs-Hinweis; ohne Tor → gemeldet`, () => {
      const p = { ...bt.defaultParams(types.get('farmhouse'), ctx.themes.ids(), 'rustic', NEW), size };
      const { session } = bt.typeSession(types.get('farmhouse'), p, 2026, ctx, NEW);
      const shell = uc.shellOf(session.project, uc.shellStyle(session));
      const st = session.project.state;
      const barn = (st.volumes ?? []).find((v) => v.id !== 'v0');
      expect(barn, 'Scheune als eigener Baukörper').toBeDefined();
      expect(accessOf(session, shell)).toEqual([]);

      // Gegenprobe: alle Türen der Scheune weg → Stall und Lager sind wirklich ohne Weg
      const barnRooms = new Set<string>(st.rooms.filter((r) => r.volumeId === barn!.id).map((r) => r.id));
      const closed: Shell = { ...shell, rooms: new Map([...shell.rooms].map(([id, r]) => [id, barnRooms.has(id) ? { ...r, doors: [] } : r])) };
      expect(circulation(closed, session.project).unreachable.length).toBeGreaterThan(0);
      expect(accessOf(session, closed).length).toBeGreaterThan(0);
    }, HEAVY_TIMEOUT);
  }
});
