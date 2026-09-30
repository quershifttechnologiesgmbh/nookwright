/** Gemeinsame Antwort der Generier-Operationen: Kennzahlen der Welt (JSON) + Export-Volumen (Artefakt). */
import type { Project } from '@mcda/blueprint';
import {
  DETAIL_FREE_MIN, MAX_CANTILEVER, materialList, toExport, volumeTooLarge, type CirculationReport, type EnsembleReport, type GeneratedWorld, type MaterialSurroundings,
  type QualityMeasures,
} from '@mcda/pipeline';
import type { Json, OperationResult } from '../operation.js';

export function worldResult(
  project: Project, world: GeneratedWorld & { readonly surroundings?: MaterialSurroundings & { readonly ensemble?: EnsembleReport } }, extra: { readonly [k: string]: Json },
  notes: readonly string[], warnings: readonly string[],
): OperationResult {
  // Gemeinsame Regel mit der App (C2): harte Export-Obergrenze, gemessen am zu schreibenden Volumen
  const tooLarge = volumeTooLarge(world.materialized.volume.size);
  if (tooLarge !== undefined) throw new Error(tooLarge);
  const volume = toExport(project, world);
  const st = project.state;
  return {
    data: {
      name: st.name,
      themeId: st.themeId,
      ...extra,
      size: [volume.size[0], volume.size[1], volume.size[2]],
      blocks: volume.blocks.length,
      floors: [...new Set(st.rooms.map((r) => r.floorIndex))].sort((a, b) => a - b),
      rooms: st.rooms.map((r) => ({ id: r.id, floor: r.floorIndex, roomTypeId: r.roomTypeId, area: r.cells.size })),
      notes: [...notes],
      warnings: [...world.warnings, ...warnings],
      ...(world.circulation !== undefined ? { circulation: circulationSummary(world.circulation) } : {}),
      // F-JEV-iterativ: Verbindungsgraph (nur mit Schalter `ensemble`; ohne ihn fehlt das Feld, Ausgabe bitgleich)
      ...(world.surroundings?.ensemble !== undefined ? { ensemble: ensembleSummary(world.surroundings.ensemble) } : {}),
      // W4-D: Dach-Einpassung (`Shell.roofFit`, nur mit automatischer Dachhöhe, geteiltem Dach oder – W4-F – Kniestock) – dieselbe Angabe,
      // die die App im Dach-Panel zeigt („Dach geteilt“, „Neigung gesenkt“)
      ...(world.shell.roofFit !== undefined ? {
        roofFit: world.shell.roofFit.map((f) => ({
          volumeId: f.volumeId, floor: f.floorIndex, requested: f.requested, pitch: f.pitch, area: f.area, split: f.split === true,
          // W4-F: Kniestock-Reihen (D5 präzisiert, `RoofDetail.kneeWall`), 0 = Traufe auf Deckenhöhe
          knee: f.knee ?? 0,
        })),
      } : {}),
      // W3-BL: Materialliste (Gegenstände je Block, Haus und Umgebung getrennt) und Ersatz gesperrter Blöcke
      materials: materialsSummary(world),
      ...(world.materialized.banned !== undefined ? {
        blockRules: {
          replaced: world.materialized.banned.replaced.map((r) => ({ from: r.from, to: r.to, count: r.count })),
          unreplaced: [...world.materialized.banned.unreplaced],
        },
      } : {}),
    },
    artifacts: { export: volume },
  };
}

/** Materialliste kompakt: Summen und Zeilen `[Gegenstand, Haus, Umgebung]` (absteigend nach Haus). */
export function materialsSummary(world: GeneratedWorld & { readonly surroundings?: MaterialSurroundings }): { readonly [k: string]: Json } {
  const list = materialList(world, world.surroundings);
  return {
    house: list.house,
    surroundings: list.surroundings,
    rows: list.rows.map((r) => [r.item, r.house, r.surroundings]),
  };
}

/**
 * Erschließungsbericht kompakt (research/21–23): Eingang, Flur-Anteil, Laufzeiten und Hinweise. Die Hinweise stehen
 * bewusst **nicht** in `warnings`: Sie setzen Türen zwischen den Räumen voraus und melden bei außen erschlossenen
 * Bauten Fehlalarme (so hält es auch der Anwendungsdienst, `generateWith`).
 */
export function circulationSummary(c: CirculationReport): { readonly [k: string]: Json } {
  const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d;
  const stationTimes = c.rooms.filter((r) => r.station && !r.unreachable).map((r) => r.seconds);
  return {
    entrance: c.entrance ?? null,
    corridorShare: round(c.corridorShare, 3),
    maxStationSeconds: stationTimes.length > 0 ? round(Math.max(...stationTimes)) : null,
    slow: [...c.slow],
    unreachable: [...c.unreachable],
    upperWithoutStairs: [...c.stepless.upperWithoutStairs],
    entryDoorCollisions: c.entry.colliding.length,
    hints: [...c.warnings, ...c.entry.warnings, ...c.stations.warnings],
  };
}

/** MX-Q: Qualitäts-Messung kompakt (Fassadenmaße, Detail-Obergrenze, Auflager; Überstände ohne Dach, höchstens 12). */
export function measuresSummary(m: QualityMeasures): { readonly [k: string]: Json } {
  const s = m.support;
  const walls = s.overhangs.filter((o) => !o.roof);
  return {
    facade: { ...m.facade },
    detail: {
      wallCells: m.detail.wallCells, freeShare: m.detail.freeShare, freeBySide: [...m.detail.freeBySide], detailBlocks: m.detail.detailBlocks,
      frameBlock: m.detail.frameBlock, sameAsFrameShare: m.detail.sameAsFrameShare, topDetails: [...m.detail.topDetails], freeMin: DETAIL_FREE_MIN,
    },
    support: {
      blocks: s.blocks, floating: s.floating, hanging: s.hanging, unsupported: s.unsupported, maxCantilever: s.maxCantilever, limit: MAX_CANTILEVER,
      roofOverhang: s.overhangs.filter((o) => o.roof).reduce((n, o) => Math.max(n, o.length), 0),
      overhangs: walls.slice(0, 12).map((o) => ({ source: o.source, length: o.length, size: o.size, bracketed: o.bracketed, at: [...o.at] })),
    },
    lints: [...m.lints],
  };
}

/** F-JEV-iterativ: Verbindungsgraph kompakt (gebaute Brücken, Rundwege, Zusatzwege, verworfene Brücken). */
export function ensembleSummary(e: EnsembleReport): { readonly [k: string]: Json } {
  return {
    places: e.places,
    loops: e.loops,
    bridges: e.bridges.map((b) => ({ id: b.id, kind: b.kind, length: b.length, rise: b.rise })),
    paths: { laid: e.paths.laid, added: e.paths.added, failed: e.paths.failed },
    dropped: e.dropped.slice(0, 8).map((x) => x.slice(0, 160)),
  };
}
