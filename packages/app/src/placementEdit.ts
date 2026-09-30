/**
 * Möbel bearbeiten (W2-ED U5, Konzept W2UX §4.2 N4): verschieben (Pfeiltasten, 1 Feld), drehen (um die Mitte),
 * tauschen gegen passende Alternativen und Variante wechseln. Aufgesetzte Teile (Kerzen auf dem Tisch) folgen ihrem
 * Möbel. Jede Aktion ist EIN Undo-Schritt und nur gültig, wenn alle Zellen im Raum-Inneren liegen und kein anderes
 * Möbel berühren – sonst ein Fehler mit Grund (die Statuszeile nennt ihn, nichts ändert sich).
 *
 * Die Regeln selbst (Gruppe, Passt-Prüfung, neue Lagen) liegen seit W3-BL in `@mcda/pipeline` (`placementRules.ts`),
 * damit die Engine-Befehle `movePlacement`/`swapPlacement` dieselbe Prüfung nutzen; hier nur die Sitzungs-Anbindung.
 */
import { DomainError, type Placement, type PlacementId } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { Pose } from '@mcda/core';
import { blockRulesCatalog, nudgePoses, placementProblem as problemOf, rotatePoses, type PlacementChange } from '@mcda/pipeline';
import { act, shellOf, shellStyle, type Session } from './usecases.js';

/**
 * Passt die Gruppe mit neuen Lagen (`poses`) bzw. einer getauschten Komponente (`swap`) in den Raum? Alle Zellen im
 * Raum-Inneren (x/z), keine Zelle eines anderen Möbels. `undefined` = passt, sonst der Grund.
 */
export function placementProblem(s: Session, catalog: Catalog, id: PlacementId, change: PlacementChange): string | undefined {
  return problemOf(s.project.state, shellOf(s.project, shellStyle(s)), catalog, id, change);
}

function commitPoses(s: Session, catalog: Catalog, id: PlacementId, poses: ReadonlyMap<PlacementId, Pose>): Session {
  const why = placementProblem(s, catalog, id, { poses });
  if (why !== undefined) throw new DomainError('placement.blocked', why);
  return act(s, catalog, (p) => {
    for (const [pid, pose] of poses) p.movePlacement(pid, pose);
  });
}

/**
 * Vorschau beim Ziehen mit der Maus (W7-G, Grundriss und 3D): passt die Gruppe um (dx, dz) Felder verschoben?
 * `undefined` = passt, sonst der Grund – dieselbe Prüfung wie `nudgePlacement` (und der Engine-Befehl `movePlacement`).
 */
export function nudgeProblem(s: Session, catalog: Catalog, id: PlacementId, dx: number, dz: number): string | undefined {
  if (!s.project.state.placements.some((p) => p.id === id)) return `Unbekanntes Möbel ${id}`;
  return placementProblem(s, catalog, id, { poses: nudgePoses(s.project.state, id, dx, dz) });
}

/** Verschieben um (dx, dz) Felder – Möbel und aufgesetzte Teile gemeinsam (Pfeiltasten, Ziehen im Grundriss und in 3D). */
export function nudgePlacement(s: Session, catalog: Catalog, id: PlacementId, dx: number, dz: number): Session {
  return commitPoses(s, catalog, id, nudgePoses(s.project.state, id, dx, dz));
}

/**
 * Um 90° im Uhrzeigersinn drehen (von oben): um die Mitte des Möbels; aufgesetzte Teile drehen mit und kreisen um
 * dieselbe Mitte. Ungerade Kantenlängen können die Mitte um eine halbe Zelle verschieben (gerundet).
 */
export function rotatePlacement(s: Session, catalog: Catalog, id: PlacementId): Session {
  if (!s.project.state.placements.some((p) => p.id === id)) throw new DomainError('placement.unknown', `Unbekanntes Möbel ${id}`);
  return commitPoses(s, catalog, id, rotatePoses(s.project.state, catalog, id));
}

export interface SwapOption {
  readonly componentId: string;
  readonly variantId?: string | undefined;
  readonly name: string;
}

/**
 * Bis zu `limit` Alternativen für ein Möbel: Komponenten mit gemeinsamem Tag, gleicher Montage und Kategorie, in der
 * Zielversion verfügbar und an derselben Stelle passend (geprüft wie beim Tauschen). Deterministisch (Katalog-Reihenfolge).
 */
export function swapOptions(s: Session, catalog: Catalog, id: PlacementId, limit = 3): SwapOption[] {
  const p = s.project.state.placements.find((x) => x.id === id);
  const def = p === undefined ? undefined : catalog.find(p.componentId);
  if (p === undefined || def === undefined) return [];
  const out: SwapOption[] = [];
  // W3-BL: Alternativen aus der Auswahl-Sicht der Block-Regeln (keine Varianten mit gesperrten Blöcken)
  for (const c of blockRulesCatalog(catalog, s.blockRules).byTags(def.tags, s.project.state.targetVersion.dataVersion)) {
    if (out.length >= limit) break;
    if (c.id === def.id || c.mount !== def.mount || c.category !== def.category) continue;
    // Komponenten nur mit Varianten: die erste (deterministisch); weitere über Variante ◀ ▶
    const variantId = c.variants?.[0]?.id;
    if (placementProblem(s, catalog, id, { swap: { componentId: c.id, variantId } }) !== undefined) continue;
    out.push({ componentId: c.id, ...(variantId !== undefined ? { variantId } : {}), name: c.name ?? c.id });
  }
  return out;
}

/** Tauschen gegen eine Alternative (bzw. andere Variante); ein Undo-Schritt, nur wenn sie passt. */
export function swapPlacement(s: Session, catalog: Catalog, id: PlacementId, componentId: string, variantId?: string): Session {
  const why = placementProblem(s, catalog, id, { swap: { componentId, variantId } });
  if (why !== undefined) throw new DomainError('placement.blocked', why);
  return act(s, catalog, (p) => p.swapPlacement(id, componentId, variantId !== undefined ? { variantId } : {}));
}

/** Nächste (+1) bzw. vorige (−1) Variante der Komponente; `undefined`, wenn sie keine Varianten hat. */
export function nextVariant(catalog: Catalog, placement: Placement, step: 1 | -1): string | undefined {
  const variants = catalog.find(placement.componentId)?.variants ?? [];
  if (variants.length < 2) return undefined;
  const i = Math.max(0, variants.findIndex((v) => v.id === placement.variantId));
  return variants[(i + step + variants.length) % variants.length]!.id;
}
