/**
 * F „Bereich neu einrichten“ (plan/spikes/F_zone_refurnish.md, WFC 3.2 „Modifying in Blocks“): Use Case der App.
 * Eine Funktionszone oder ein im Grundriss gezogenes Rechteck eines Raums wird neu eingerichtet; alles außerhalb bleibt
 * eingefroren, Möbel im schmalen Überlappungsrand dürfen mit umgestellt werden. Regel und Prüfung liegen in
 * @mcda/pipeline (`refurnishBlock`, dieselbe Funktion wie die Engine-Operation `project_refurnish_block`).
 *
 * Schalter `BLOCK_REFURNISH` (derzeit an): Ist er aus, zeigt die App den Befehl nicht (Abschnitt im Raum-Panel, Knopf am
 * Möbel, Rechteck im Grundriss, Strg+K). Die Ausgaben sind so oder so bitgleich, weil der Befehl nur auf ausdrücklichen
 * Aufruf etwas tut. Je Sitzung: Adresse mit `?bereich=0` (aus) bzw. `?bereich=1` (an).
 */
import type { PlacementId, RoomId } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { CellSet, type Cell } from '@mcda/core';
import { BLOCK_MARGIN, furnishingGeometry, planBlockRefurnish, placedFor, roomZones, type BlockRefurnishReport } from '@mcda/pipeline';
import { act, roomDensity, selectionCatalog, settingsOf, shellOf, shellThemeOf, styleChain, type Session } from './usecases.js';

/** Schalter des Feature-Branches (eingeschaltet; `?bereich=0` schaltet ihn für eine Sitzung ab). */
export const BLOCK_REFURNISH = true;

/** Ist der Befehl sichtbar? Schalter oder Adresse `?bereich=1` (bzw. `?bereich=0` schaltet ihn ab). */
export function blockRefurnishEnabled(search?: string): boolean {
  let q = search;
  if (q === undefined) {
    try {
      q = typeof location === 'undefined' ? '' : location.search;
    } catch {
      q = '';
    }
  }
  const v = new URLSearchParams(q).get('bereich');
  return v === null ? BLOCK_REFURNISH : v !== '0';
}

export { BLOCK_MARGIN };

/** Bereich neu einrichten: ein Undo-Schritt; scheitert jeder Versuch, bleibt die Sitzung unverändert (Grund im Bericht). */
export function refurnishBlock(
  s: Session, catalog: Catalog, roomId: RoomId, cells: CellSet, opts: { readonly margin?: number } = {},
): { readonly session: Session; readonly report: BlockRefurnishReport } {
  let report: BlockRefurnishReport | undefined;
  const session = act(s, catalog, (p) => {
    const settings = settingsOf(s);
    const shell = shellOf(p, settings, shellThemeOf(catalog, p.state.themeId));
    const styles = styleChain(catalog, p.state.themeId);
    const density = roomDensity(s, roomId);
    const plan = planBlockRefurnish(p, shell, catalog, { roomId, cells, ...(opts.margin !== undefined ? { margin: opts.margin } : {}) }, {
      choice: selectionCatalog(catalog, settings),
      ...(styles !== undefined ? { styles } : {}),
      ...(density !== 1 ? { density } : {}),
      ...(s.minAisle === true ? { minAisle: true } : {}),
    });
    report = plan.report;
    if (plan.report.ok) p.refurnishBlock(roomId, plan.report.block, plan.removed, plan.drafts);
  });
  return { session, report: report! };
}

/**
 * Teil von `cells`, der im Rauminneren liegt (ohne Wände, Treppen und Deckenöffnungen) – nur dort kann ein Bereich neu
 * eingerichtet werden. Leer = Rechteck nur auf Wand oder Treppe (freundliche Meldung statt Fehler).
 */
export function blockCellsIn(s: Session, catalog: Catalog | undefined, roomId: RoomId, cells: CellSet): CellSet {
  const info = shellOf(s.project, settingsOf(s), shellThemeOf(catalog, s.project.state.themeId)).rooms.get(roomId);
  if (info === undefined) return CellSet.empty();
  const g = furnishingGeometry(info);
  const inside = g.blocked === undefined ? g.interior : g.interior.difference(g.blocked);
  return cells.intersection(inside);
}

/** Funktionszonen eines Raums (Zellen je Zone, stabile Reihenfolge) – Knöpfe „Zone 1 … n“. */
export function roomZonesOf(s: Session, catalog: Catalog | undefined, roomId: RoomId): CellSet[] {
  const shell = shellOf(s.project, settingsOf(s), shellThemeOf(catalog, s.project.state.themeId));
  return roomZones(shell, roomId).map((z) => z.cells);
}

/** Zone, in der ein Möbel steht (Auswahl in 3D oder im Grundriss) – sonst die Zone mit den meisten seiner Zellen. */
export function zoneOfPlacement(s: Session, catalog: Catalog, placementId: PlacementId): { readonly roomId: RoomId; readonly cells: CellSet } | undefined {
  const p = s.project.state.placements.find((x) => x.id === placementId);
  if (p === undefined || catalog.find(p.componentId) === undefined) return undefined;
  const cols: Cell[] = placedFor(p, catalog).cells.map((c) => [c.pos[0], c.pos[2]]);
  const zones = roomZonesOf(s, catalog, p.roomId);
  let best: CellSet | undefined;
  let hits = 0;
  for (const z of zones) {
    const n = cols.filter(([x, zz]) => z.has(x, zz)).length;
    if (n > hits) [best, hits] = [z, n];
  }
  return best === undefined ? undefined : { roomId: p.roomId, cells: best };
}

/** Statuszeile (deutsch) zum Ergebnis. */
export function blockRefurnishText(r: BlockRefurnishReport): string {
  if (!r.ok) return r.reason ?? 'Bereich neu einrichten: nichts geändert';
  // kein Event, also auch kein Undo-Schritt
  if (!r.changed) return 'Bereich neu einrichten: nichts geändert – keine Möbel im Bereich, und dort passt nichts Neues'
  const tries = r.attempts > 1 ? ` (Versuch ${r.attempts})` : '';
  return `Bereich neu eingerichtet${tries}: ${r.removed.length} Möbel ersetzt durch ${r.added}, ${r.frozen} unverändert · ${r.block.size} Felder, Rand ${r.region.size - r.block.size} · Rückgängig mit Strg+Z`;
}
