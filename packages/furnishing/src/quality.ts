import type { PlacementPref } from '@mcda/catalog';
import { cellKey } from '@mcda/core';
import type { CellClass, CellInfo, RoomAnalysis } from './analyze.js';
import type { RoomGeometry } from './geometry.js';
import type { PlacedComponent } from './place.js';
import { ruleUseGroups, useCellsOf } from './rules.js';
import { accessGroups, walkwayMetrics, type WalkwayMetrics } from './walkways.js';

/**
 * Qualitätswert je Raum (research/02 §7.9, RimWorld-Muster): Q = 0,65 · Mittel(qᵢ) + 0,35 · min(qᵢ) mit
 * Teilqualitäten qᵢ ∈ [0, 1]. So gewinnt kein Ergebnis mit einem katastrophalen Einzelaspekt. Die Teile tragen
 * deutsche Bezeichnungen und Details für die UI („warum so?“).
 */

export interface QualityPart {
  readonly id: 'required' | 'signature' | 'program' | 'preferences' | 'space' | 'zones' | 'vertical' | 'aisle' | 'water' | 'calm' | 'arrangement' | 'walkways';
  readonly label: string;
  readonly value: number;
  readonly detail?: string;
}

export interface RoomQuality {
  /** 0–1. */
  readonly score: number;
  readonly parts: readonly QualityPart[];
  /** Was der Solver repariert oder abgewogen hat (Backtracking, Kompaktform …). */
  readonly notes: readonly string[];
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function roomQuality(parts: readonly QualityPart[], notes: readonly string[] = []): RoomQuality {
  const values = parts.map((p) => clamp01(p.value));
  const mean = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
  const min = values.length > 0 ? Math.min(...values) : 1;
  return { score: 0.65 * mean + 0.35 * min, parts: parts.map((p) => ({ ...p, value: clamp01(p.value) })), notes };
}

/** Grundzellen, an denen die Wunschlage gemessen wird (Boden; Wand/Decke: ihre Spalte). */
export function baseInfos(p: PlacedComponent, a: RoomAnalysis): CellInfo[] {
  const g = a.geometry;
  const mount = p.expanded.mount;
  // Wand: unterste BELEGTE Lage (Rahmen mit Luft darunter haben in Lage 0 keine Zelle, V3)
  const wallBottom = mount === 'wall' ? Math.min(...p.cells.map((c) => c.local[1])) : 0;
  const base = p.cells.filter((c) => c.pos[1] === g.baseY || mount === 'ceiling' || (mount === 'wall' && c.local[1] === wallBottom));
  return base.map((c) => a.info.get(cellKey(c.pos[0], c.pos[2]))).filter((i): i is CellInfo => i !== undefined);
}

/**
 * Q1b (research/52 §6 Hebel 1): Gewicht einer Zellklasse nach der Reihenfolge der Wunschzonen.
 * Die Reihenfolge im Katalog ist eine Priorität: die **erste** Zone ist der erklärte Wunsch und bekommt volle
 * Punktzahl, jede weitere ist nur Rückfall und halbiert sich (`1 / 2^Rang`). Für die häufigen Zwei-Zonen-Listen
 * ist das gleich `1/(Rang+1)`; ab drei Zonen fällt der Rückfall schneller. Rein, deterministisch, ohne
 * API-Erweiterung. **Ändert generierte Welten**, weil derselbe Wert in die Bewertung des Solvers eingeht
 * (`Solve.scorer`): `zones: ["corner","edge"]` zieht eine Ecke einer Wandkante vor, wenn eine Ecke frei ist;
 * `zones: ["edge","corner"]` umgekehrt.
 */
export function zoneWeight(cls: CellClass, zones: readonly CellClass[]): number {
  const rank = zones.indexOf(cls);
  return rank < 0 ? 0 : 1 / 2 ** rank;
}

/** Erfüllung der Platzierungspräferenz eines Objekts (0–1; ohne Präferenz 1). */
export function prefSatisfaction(p: PlacedComponent, a: RoomAnalysis, pref: PlacementPref, dDoorMax: number): number {
  const infos = baseInfos(p, a);
  if (infos.length === 0) return 1;
  const parts: number[] = [];
  if (pref.zones !== undefined) parts.push(infos.reduce((s, i) => s + zoneWeight(i.cls, pref.zones!), 0) / infos.length);
  const dDoor = infos.reduce((s, i) => s + (a.dDoor.get(cellKey(i.cell[0], i.cell[1])) ?? 0), 0) / infos.length;
  if (Number.isFinite(dDoor) && dDoorMax > 0) {
    if (pref.doorAffinity === 'far') parts.push(dDoor / dDoorMax);
    if (pref.doorAffinity === 'near') parts.push(1 - dDoor / dDoorMax);
  }
  if (pref.windowAffinity === 'near') parts.push(infos.some((i) => i.nearWindow) ? 1 : 0);
  return parts.length === 0 ? 1 : parts.reduce((s, v) => s + v, 0) / parts.length;
}

/** Qualitätsmaß „Vertikalität“ (V3): wie viel der lichten Höhe ein Raum nutzt. */
export interface Verticality {
  /** Lichte Höhe (Zahl der Höhenebenen). */
  readonly height: number;
  /** Höhenebenen mit mindestens einem Block oder einer Entity (Rahmen) einer Komponente. */
  readonly levels: number;
  /** levels / height (0–1). */
  readonly ratio: number;
  /** Blöcke oberhalb von Boden + 1 (y ≥ baseY + 2, also über Kopfhöhe). */
  readonly above: number;
  /** Alle Blöcke der Komponenten. */
  readonly blocks: number;
}

/** Vertikalität der platzierten Komponenten eines Raums (Anteil genutzter Höhenebenen, Blöcke über Kopfhöhe). */
export function verticality(placed: readonly PlacedComponent[], geom: Pick<RoomGeometry, 'baseY' | 'height'>): Verticality {
  const levels = new Set<number>();
  let above = 0;
  let blocks = 0;
  for (const p of placed) {
    for (const c of p.cells) {
      const l = c.pos[1] - geom.baseY;
      if (l < 0 || l >= geom.height) continue;
      levels.add(l);
      blocks++;
      if (l >= 2) above++;
    }
    for (const e of p.entities) {
      const l = e.pos[1] - geom.baseY;
      if (l >= 0 && l < geom.height) levels.add(l);
    }
  }
  return { height: geom.height, levels: levels.size, ratio: geom.height > 0 ? levels.size / geom.height : 1, above, blocks };
}

/*
 * Ruhe-Wert (research/20 §0.10): bewusst NICHT als Qualitätsteil umgesetzt. Gemessen wurde beides – „Teile ohne
 * Funktions-Tag" (im Esszimmer 75 %, in der Küche 83 %: normal) und der Anteil optionaler Platzierungen (in
 * geprüften Räumen 42–90 %). Beide würden gut eingerichtete Räume bestrafen, ohne die visuelle Unruhe zu treffen.
 * Der belegte Kern bleibt: Über-Detaillierung ist ein Fehler → als **Berichtswert** in `research/20 §0.10` und als
 * offener Punkt in `research/25 §5`, nicht als Score. Ein späterer, belastbarer Wert wäre die Zahl der
 * Anbauteile je Wandzelle (braucht Wandkontakt-Daten aus der Hülle, nicht aus dem Solver).
 */

/**
 * W8-B (27.09.2026, „Wege im Raum“): Kennzahlen des fertigen Raums – Nutzungsgruppen aller Möbel gegen das freie
 * Netz (Bodenzellen ohne Nicht-Begehbares in Laufhöhe, wie die Belegung des Solvers).
 */
export function roomWalkways(placed: readonly PlacedComponent[], a: RoomAnalysis): WalkwayMetrics {
  const g = a.geometry;
  const taken = new Set<string>();
  const groups: (readonly [number, number])[][] = [];
  for (const p of placed) {
    if (!p.expanded.walkable) for (const c of p.cells) if (c.pos[1] <= g.baseY + 1) taken.add(cellKey(c.pos[0], c.pos[2]));
    groups.push(...accessGroups(p, useCellsOf(p, g), ruleUseGroups(p, g.baseY), g.baseY));
  }
  return walkwayMetrics(a, taken, groups);
}

/**
 * W8-B: Teilwert „Wege im Raum“ aus den Kennzahlen, bewusst schwach gewichtet (0,6 … 1): der Qualitätswert mittelt alle
 * Teile gleich und nimmt das Minimum dazu – die Wege sollen ihn leiten, aber keinen sonst guten Raum abstürzen lassen.
 * Vier Teile zu gleichen Anteilen:
 *  - **Umweg:** Laufweg Tür → Nutzungsseite gegen die Luftlinie (Manhattan); ab doppelter Länge 0.
 *  - **Engstellen:** Stücke „einziger Durchgang“ im freien Netz; je Engstelle −0,25.
 *  - **2 breit:** Anteil der Nutzungsseiten an einer Fläche, auf der zwei aneinander vorbeikommen.
 *  - **Nutzungsseiten frei:** Anteil ohne Verstoß gegen `useAccess` (Sackgasse, einziger Durchgang).
 */
export function walkwayPart(m: WalkwayMetrics): QualityPart {
  const detour = clamp01(2 - m.detour);
  const narrow = clamp01(1 - 0.25 * m.bottlenecks);
  const access = m.groups === 0 ? 1 : 1 - m.violations / m.groups;
  const value = 0.6 + 0.4 * ((detour + narrow + m.wideShare + access) / 4);
  const pct = (v: number): string => `${Math.round(v * 100)} %`;
  const detail = [
    `Umweg Tür → Nutzungsseite ×${m.detour.toFixed(2).replace('.', ',')}`,
    m.bottlenecks === 1 ? '1 Engstelle' : `${m.bottlenecks} Engstellen`,
    `${pct(m.wideShare)} der Nutzungsseiten am 2 breiten Weg`,
    m.violations === 0 ? 'keine Nutzungsseite in Sackgasse oder Durchgang' : `${m.violations} von ${m.groups} Nutzungsseiten in Sackgasse oder Durchgang`,
  ].join(', ');
  return { id: 'walkways', label: 'Wege im Raum', value, detail };
}
