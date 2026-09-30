import type { Shell } from '@mcda/blueprint';
import { CellSet, cellKey, key3, type Cell, type HorizontalDir } from '@mcda/core';
import type { Plot } from './model.js';

/** Außentür: Türspalte und Richtung nach draußen. */
export interface BuildingDoor {
  readonly cell: Cell;
  readonly outward: HorizontalDir;
  /** Additiv (W12-C): Haustür (`ShellDoor.isMain`) – fehlt bei Nebentüren und bei älteren Aufrufern. */
  readonly main?: true;
}

/**
 * Sicht des Geländes auf das Gebäude (Leseport, aus der Hülle abgeleitet): der Generator kennt das
 * Projekt-Aggregat nicht, nur Grundfläche, Grundhöhe, Außentüren und belegte Positionen.
 */
export interface BuildingInfo {
  /** Y der Bodenplatte = Geländegrundhöhe am Haus (oberste Geländezelle neben dem Haus). */
  readonly y0: number;
  /** Spalten mit Bodenplatte (Fundament darunter). */
  readonly footprint: CellSet;
  /** Spalten außerhalb der Grundfläche mit Hüllzellen darüber (Dachüberstand): kein Himmel, keine Bäume. */
  readonly covered: CellSet;
  readonly doors: readonly BuildingDoor[];
  /** Positionen (key3) aller Hüllzellen – der Generator setzt dort nichts. */
  readonly occupied: ReadonlySet<string>;
  /**
   * Spalten mit Außenprofil (`kind: 'facade'`: Sockel, Vorlagen, Konsolen; FA): keine Pflanzen, Büsche, Bäume –
   * Wege dürfen sie queren (außer über den Sockel, siehe `plinth`). Fehlt bei älteren Aufrufern (= leer).
   */
  readonly profile?: CellSet;
  /** Spalten, in denen das Profil auf Bodenplattenhöhe y0 steht (Sockeltreppe): Gelände dort und davor auf y0 − 1. */
  readonly plinth?: CellSet;
  /**
   * Positionen (key3) der Tür- und Fensterzellen (additiv, T2): Ausstattung an der Wand (Holzstapel, Spalier,
   * Beete, Kübel) hält daneben und davor Abstand – dort sitzen Fensterläden und Blumenkästen der Außengestaltung.
   */
  readonly openings?: ReadonlySet<string>;
  /** Additiv (BT16): eingegrabene Baukörper (Lage `buried`) – der Generator „überdeckt“ sie (mound.ts). */
  readonly buried?: readonly BuriedMound[];
  /**
   * Additiv (feat/underground): Spalten außerhalb der Grundfläche über einem Unterbau (x, z) → kleinste Oberkante des
   * Geländes (Decke + 1): das Gelände sinkt dort nie auf oder unter die Decke (Hanglage). Fehlt = wie bisher.
   */
  readonly minTop?: ReadonlyMap<string, number>;
}

/** Auftrag „Überdecken“ eines eingegrabenen Baukörpers (aus `Shell.settings`). */
export interface BuriedMound {
  /** Einzige freie Seite (Vorplatz). */
  readonly front: HorizontalDir;
  /** Erdlagen über der obersten Hüllzelle. */
  readonly cover: number;
  /** W9-G4: Flanken – so weit reicht der Hügel neben dem Grundriss vor die Frontebene (0 = bündig). */
  readonly wing: number;
  /** Spalten des Baukörpers (cellKey) → oberste Hüllzelle. */
  readonly tops: ReadonlyMap<string, number>;
}

export const NO_BUILDING: BuildingInfo = {
  y0: 0, footprint: CellSet.empty(), covered: CellSet.empty(), doors: [], occupied: new Set(), profile: CellSet.empty(), plinth: CellSet.empty(),
};

/**
 * Bauwerke auf dem Grundstück (Kontext Bauwerke, z. B. aus `buildStructures(…)`), als Sperrfläche für den
 * Generator: dort keine Außenbereiche, Wege oder Pflanzen; Bäume halten Abstand.
 */
export interface SiteStructures {
  /** Belegte oder freizuhaltende Bodenspalten (`StructuresResult.footprint`). */
  readonly footprint: CellSet;
  /** Spalten, über die Wege die Bauwerke queren dürfen (Tordurchgänge, Vorplätze, Vortreppen); keine Pflanzen. */
  readonly passages?: CellSet;
  /**
   * Additiv (F-Ensemble, `plan/spikes/F_ensemble_walkways.md`): Zusatzwege des Verbindungsgraphen einer Base – nach
   * Zonen- und Hauptweg gelegt, mit denselben Kosten (`paths.ts`). Fehlt = bitgleich.
   */
  readonly links?: readonly SiteLink[];
  /**
   * Additiv (F-Ensemble): höchstens so viele Rundwege (`loop`) legen – die Liste ist nach Vorrang geordnet; ein Rundweg
   * zählt nur, wenn er lohnt (siehe `SiteLink.loop`). Fehlt = alle.
   */
  readonly maxLoops?: number;
}

/** Ende eines Zusatzwegs: Spalten (Türvorplatz, Treppenfuß, Tor) oder die Weg-Ziele einer Zone. */
export type SiteLinkEnd = { readonly cells: readonly Cell[] } | { readonly zoneId: string };

/** Zusatzweg zwischen zwei Orten (F-Ensemble). */
export interface SiteLink {
  readonly from: SiteLinkEnd;
  readonly to: SiteLinkEnd;
  /**
   * Rundweg: vorhandene Wege kosten wie Wiese (keine Bündelung), damit ein zweiter, direkter Weg entsteht. Er wird nur
   * gelegt, wenn er lohnt: der Weg über das vorhandene Netz ist mindestens {@link LOOP_MIN_GAIN}-mal so lang (oder es
   * gibt keinen) und der neue Weg bringt mindestens {@link LOOP_MIN_NEW} neue Wegzellen. Sonst (Anschluss) bündelt der
   * Weg wie jeder Zonenweg.
   */
  readonly loop?: boolean;
  /** Wegrang: 1 Pfad (Standard), 2 Nebenweg. */
  readonly rank?: 1 | 2;
}

/** Rundweg lohnt ab diesem Verhältnis Netzweg : neuer Weg. */
export const LOOP_MIN_GAIN = 1.6;
/** Rundweg lohnt ab so vielen neuen Wegzellen. */
export const LOOP_MIN_NEW = 4;

/**
 * Ergebnis eines Zusatzwegs: Route (Spalten) und Zahl der neu zu Weg gewordenen Spalten; `skipped` = Rundweg lohnt
 * nicht bzw. Höchstzahl erreicht (nichts gelegt); `undefined` = kein Weg möglich.
 */
export interface SiteLinkResult {
  readonly cells: readonly Cell[];
  readonly added: number;
  readonly skipped?: true;
}

export const NO_STRUCTURES: SiteStructures = { footprint: CellSet.empty() };

/**
 * Gebäude aus der Hülle: Bodenplatte der UNTERSTEN Etage → Grundfläche (Fundament), Außentüren (untere Hälfte)
 * → Ausgänge. Alle übrigen Hüllzellen außerhalb der Grundfläche – Dachüberstand, auskragende obere Etagen
 * (Balkon) – sind „überdeckt“: kein Fundament darunter, aber planiert, kein Himmel, keine Bäume.
 * Zellen anderer Kontexte (Gelände, Vegetation, Bauwerke) zählen nicht zum Gebäude. Außenprofil-Zellen
 * (`kind: 'facade'`) sind zusätzlich `profile` (Pflanzen gesperrt) bzw. auf y0 `plinth` (Sockel, Gelände tiefer).
 */
export function buildingFromShell(shell: Shell): BuildingInfo {
  const floors = shell.cells.filter((c) => c.kind === 'floor');
  if (floors.length === 0) return NO_BUILDING;
  const y0 = Math.min(...floors.map((c) => c.pos[1]));
  const footprint = CellSet.of(floors.filter((c) => c.pos[1] === y0).map((c) => [c.pos[0], c.pos[2]] as const));
  const own = shell.cells.filter((c) => c.kind !== 'terrain' && c.kind !== 'plant' && c.kind !== 'fort');
  const covered = CellSet.of(own.filter((c) => !footprint.has(c.pos[0], c.pos[2])).map((c) => [c.pos[0], c.pos[2]] as const));
  // W12-C: Haustür markieren (Wandzelle = Innenzelle + Schritt Richtung Tür)
  const OFF: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const mains = new Set<string>();
  for (const r of shell.rooms.values()) for (const d of r.doors) if (d.isMain) mains.add(cellKey(d.inside[0] + OFF[d.toward][0], d.inside[1] + OFF[d.toward][1]));
  const doors: BuildingDoor[] = shell.cells
    .filter((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower' && c.orient.facing !== undefined)
    .map((c) => ({ cell: [c.pos[0], c.pos[2]] as const, outward: c.orient!.facing!, ...(mains.has(cellKey(c.pos[0], c.pos[2])) ? { main: true as const } : {}) }))
    .sort((a, b) => a.cell[0] - b.cell[0] || a.cell[1] - b.cell[1]);
  const facade = own.filter((c) => c.kind === 'facade' && !footprint.has(c.pos[0], c.pos[2]));
  const profile = CellSet.of(facade.map((c) => [c.pos[0], c.pos[2]] as const));
  const plinth = CellSet.of(facade.filter((c) => c.pos[1] === y0).map((c) => [c.pos[0], c.pos[2]] as const));
  const openings = new Set(own.filter((c) => c.kind === 'door' || c.kind === 'window').map((c) => key3(c.pos)));
  // Lage buried (BT16): oberste Hüllzelle je Spalte des Baukörpers
  const buried = (shell.settings ?? []).filter((s) => s.kind === 'buried').map((s): BuriedMound => {
    const tops = new Map<string, number>();
    for (const [x, z] of s.footprint) tops.set(cellKey(x, z), -Infinity);
    for (const c of own) {
      const k = cellKey(c.pos[0], c.pos[2]);
      const t = tops.get(k);
      if (t !== undefined && c.pos[1] > t) tops.set(k, c.pos[1]);
    }
    return { front: s.front ?? 'south', cover: s.cover ?? 2, wing: s.wing ?? 0, tops };
  });
  return {
    y0, footprint, covered, doors, occupied: new Set(own.map((c) => key3(c.pos))), profile, plinth, openings, ...(buried.length > 0 ? { buried } : {}),
  };
}

/** Grundstück um das Gebäude mit `margin` Blöcken Rand (ohne Gebäude: margin um den Ursprung). */
export function plotAround(building: BuildingInfo, margin: number): Plot {
  const b = building.footprint.union(building.covered).bounds() ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  return { minX: b.minX - margin, minZ: b.minZ - margin, maxX: b.maxX + margin, maxZ: b.maxZ + margin };
}
