/**
 * Use Cases „Umgebung“: Gelände (Aggregat `Site` aus @mcda/terrain) und Bauwerke (Mauerzüge mit Türmen und Toren,
 * freistehende Türme, Windmühlen aus @mcda/structures) um das Haus. Rein und testbar wie usecases.ts.
 *
 * Zustand: `Session.surroundings` – ein unveränderlicher Wert: das Gelände als Event-Historie des Aggregats (auch
 * Vegetationsdichte, Beleuchtung, Glätten), die Bauwerke als Liste mit stabilen IDs (w1, t2, m3 …) und eine
 * App-Einstellung (Rand), die die Domäne nicht kennt. Jede Aktion ist EIN Undo-Schritt der Sitzung (`withUndoStep`), gemeinsam mit den Raum-Aktionen:
 * Strg+Z nimmt Mauer, Zone oder Raum in der Reihenfolge zurück, in der sie entstanden.
 *
 * Gelände-Befehle laufen über das Aggregat: Historie abspielen (`Site.fromHistory`), Befehl aufrufen (prüft die
 * Invarianten: Grundstück, Zonen, Terraforming), neue Historie speichern. Bauwerke sind reine Pläne (`WallPlan`,
 * `TowerSpec`, `WindmillSpec`); ihre Invarianten (Punkte, Geschosse, Maße) prüft diese Datei, gebaut wird erst in
 * surroundingsWorld.ts über den Anwendungsdienst (`surroundings` aus @mcda/pipeline).
 */
import { DomainError, type ProjectState, type Shell, type ShellAnnexOpening } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { ENSEMBLE_DEFAULT } from '@mcda/pipeline';
import { CellSet, HORIZONTAL, opposite, type Cell, type HorizontalDir } from '@mcda/core';
import {
  Polyline, annexContacts, annexFootprint, type AnnexKind, type GateSpec, type RoofShape, type TowerFinial, type TowerShape, type TowerSpec, type TowerStyle, type TowerTop,
  type WallPlan, type WindmillSpec,
} from '@mcda/structures';
import {
  ENCLOSABLE_KINDS, PLOT_LIMITS, SCULPT_LIMIT, Site, VEGETATION_LIMIT, buildingFromShell, plotAround, plotSize,
  type BuildingInfo, type Landform, type Plot, type SiteDecorLevel, type SiteEvent, type SiteLighting, type SiteState, type SiteTemplateId, type TerrainStyleDef,
  type VegetationDensity, type Zone, type ZoneEdge, type ZoneId, type ZoneKind,
} from '@mcda/terrain';
import {
  EMPTY_SURROUNDINGS, MARGIN_RANGE, SAIL_RANGE, TOWER_LEVELS, TOWER_SPACING_RANGE, checkCell, cleanPoints, ensembleActive, hasSurroundings, readSurroundings,
  rememberSiteState, siteOf, siteStateOf, type AnnexSpec, type WeatheringLevel, type SurfaceTextureLevel, type StructureItem, type StructureKind, type SurroundingsState,
} from '@mcda/projectfile';
import { plural } from './ui/plural.js';
import { GRID, ensembleCatalog, shellOf, shellStyle, withShellStep, withUndoStep, type Rect, type Session } from './usecases.js';

// ---------------------------------------------------------------------------------------------- Zustand

// Zustand und Lesen der Umgebung: gemeinsam mit der Engine-API (@mcda/projectfile, C1)
export {
  EMPTY_SURROUNDINGS, MARGIN_RANGE, SAIL_RANGE, TOWER_LEVELS, TOWER_SPACING_RANGE, cleanPoints, hasSurroundings, readSurroundings, siteOf, siteStateOf,
  type AnnexSpec, type StructureItem, type StructureKind, type SurroundingsState, type WeatheringLevel, type SurfaceTextureLevel,
};


/** Vegetationsdichte wie der Geländestil (Faktor 1 je Ebene; Domäne: `Site.setVegetation`). */
export const STYLE_VEGETATION: VegetationDensity = { trees: 1, bushes: 1, ground: 1 };
/** Wählbare Stufen der Vegetationsdichte (Anzeige in Prozent, höchstens `VEGETATION_LIMIT`). */
export const VEGETATION_STEPS: readonly number[] = [0, 0.5, 1, 1.5, 2].filter((v) => v <= VEGETATION_LIMIT);
export const DEFAULT_TERRAIN_STYLE = 'meadow';

/** Wirksame Vegetationsdichte des Geländes (fehlt = wie der Stil). */
export const vegetationOf = (site: SiteState | undefined): VegetationDensity => site?.vegetation ?? STYLE_VEGETATION;


// ---------------------------------------------------------------------------------------------- Auswahllisten

export const ZONE_OPTIONS: ReadonlyArray<{ readonly id: ZoneKind; readonly label: string; readonly hint: string; readonly color: number }> = [
  { id: 'field', label: 'Feld', hint: 'Acker mit Wasserrinnen, Feldfrüchten, Zaun und Tor zum Weg', color: 0xc8963c },
  { id: 'garden', label: 'Garten', hint: 'Beete mit Blumen, Büschen und Gartenwegen', color: 0xd26fa8 },
  { id: 'yard', label: 'Hof', hint: 'Gepflasterter Hof, ab 20 Zellen mit Laternenpfosten', color: 0xa3a8ae },
  { id: 'pond', label: 'Teich', hint: 'Teich (Mitte 2 tief) mit Teichgrund und Uferpflanzen', color: 0x4a90d9 },
  { id: 'meadow', label: 'Wiese', hint: 'Freie Wiese: keine Bäume, mehr Blumen', color: 0x86c96f },
  { id: 'orchard', label: 'Obstgarten', hint: 'Obstbäume in Reihen auf Wiese', color: 0x9bc44a },
  { id: 'paddock', label: 'Koppel', hint: 'Eingezäunte Weide mit Tor zum Weg', color: 0xc9b27a },
  { id: 'plaza', label: 'Platz', hint: 'Platz/Anger: gepflasterte Mitte, Treffpunkt der Wege', color: 0xb9a58c },
  { id: 'path', label: 'Weg', hint: 'Pinsel: Weg malen – folgt dem Gelände und wird ans Wegenetz angeschlossen', color: 0xf0dca0 },
];

/** Zonenarten, die mit dem runden Pinsel statt mit dem Rechteck gemalt werden. */
export const BRUSH_ZONES: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['path']);

export const zoneLabel = (k: ZoneKind): string => ZONE_OPTIONS.find((z) => z.id === k)?.label ?? k;

/** Zonenrand (nur Feld, Garten, Obstgarten, Koppel – `ENCLOSABLE_KINDS`). */
export const EDGE_OPTIONS: ReadonlyArray<{ readonly id: ZoneEdge; readonly label: string; readonly hint: string }> = [
  { id: 'fence', label: 'Zaun', hint: 'Zaun mit Pfosten im Takt, Tor zum Weg' },
  { id: 'hedge', label: 'Hecke', hint: 'Hecke mit Durchgang zum Weg' },
  { id: 'none', label: 'Offen', hint: 'Kein Rand' },
];
export const hasEdge = (k: ZoneKind): boolean => ENCLOSABLE_KINDS.includes(k);

/** Außenbeleuchtung des Grundstücks; `undefined` = wie der Geländestil. */
export const LIGHTING_OPTIONS: ReadonlyArray<{ readonly id: SiteLighting; readonly label: string; readonly hint: string }> = [
  { id: 'none', label: 'Keine', hint: 'Nur die Laternen der Zonen (Feld-, Hofpfosten)' },
  { id: 'paths', label: 'Wege', hint: 'Laternenpfähle an Kreuzungen und im Takt entlang der Wege' },
  { id: 'spawnproof', label: 'Spawnsicher', hint: 'Wie „Wege“, dazu Pfähle und Leuchtbüsche nachsetzen, bis keine Geländezelle mehr dunkel ist (kein Monster-Spawn)' },
];

export const lightingLabel = (l: SiteLighting): string => LIGHTING_OPTIONS.find((o) => o.id === l)?.label ?? l;

/** Beleuchtung des Geländestils (`lighting.mode`, fehlt = keine). */
export const styleLighting = (style: TerrainStyleDef | undefined): SiteLighting => style?.lighting?.mode ?? 'none';

/** Wirksame Außenbeleuchtung: Wahl des Grundstücks, sonst die des Geländestils (wie die Domäne). */
export const siteLighting = (site: SiteState, style: TerrainStyleDef | undefined): SiteLighting => site.lighting ?? styleLighting(style);

/**
 * Kurzbericht der Außenbeleuchtung (`SiteResult.features.lighting`): „6 Laternenpfähle · 8 Leuchtbüsche · spawnsicher“.
 * Dunkle Stellen zählt die Domäne nur im Modus „spawnsicher“.
 */
export function lightingSummary(r: { readonly lamps: number; readonly leafLights: number; readonly dark: number }, mode: SiteLighting): string {
  const parts = [`${r.lamps} ${r.lamps === 1 ? 'Laternenpfahl' : 'Laternenpfähle'}`];
  if (r.leafLights > 0) parts.push(`${r.leafLights} ${r.leafLights === 1 ? 'Leuchtbusch' : 'Leuchtbüsche'}`);
  if (mode === 'spawnproof') parts.push(r.dark === 0 ? 'spawnsicher' : `${r.dark} dunkel`);
  return parts.join(' · ');
}

/** Grundstücks-Vorlagen der Domäne (`Site.applyTemplate`). */
export const SITE_TEMPLATE_OPTIONS: ReadonlyArray<{ readonly id: SiteTemplateId; readonly label: string; readonly hint: string }> = [
  { id: 'homestead', label: 'Gehöft', hint: 'Hof vor der Tür, Garten an der Küchenseite, Feld hinter dem Haus, Koppel, Obstgarten, Wegelaternen – ersetzt alle Zonen' },
];

export type SculptTool = 'raise' | 'lower' | 'flatten' | 'smooth' | 'reset';

export const SCULPT_OPTIONS: ReadonlyArray<{ readonly id: SculptTool; readonly label: string; readonly hint: string }> = [
  { id: 'raise', label: 'Anheben', hint: 'Rechteck um die Stärke anheben (weiche Böschung bis ≤ 1 Block Stufe)' },
  { id: 'lower', label: 'Absenken', hint: 'Rechteck um die Stärke absenken (Senke, Graben)' },
  { id: 'flatten', label: 'Ebnen', hint: 'Rechteck auf eine feste Höhe relativ zur Bodenplatte des Hauses legen' },
  { id: 'smooth', label: 'Glätten', hint: 'Pinsel: Höhe = Mittelwert der Umgebung (Radius 2) – Kanten und Stufen werden weich' },
  { id: 'reset', label: 'Natürlich', hint: 'Terraforming im Rechteck verwerfen (natürliches Gelände)' },
];
/** Terraforming-Pinsel mit rundem Pinsel statt Rechteck. */
export const BRUSH_SCULPTS: ReadonlySet<SculptTool> = new Set<SculptTool>(['smooth']);
/** Radius des runden Pinsels (`brushCells`: Breite = 2 × Radius + 1) und Startwerte für Weg und Glätten. */
export const BRUSH_RANGE = { min: 0, max: 6, path: 1, smooth: 2 } as const;
export const SCULPT_AMOUNT_RANGE = { min: 1, max: 8 } as const;
export const SCULPT_LEVEL_RANGE = { min: -SCULPT_LIMIT, max: SCULPT_LIMIT } as const;

export const TOWER_SHAPES: ReadonlyArray<{ readonly id: TowerShape; readonly label: string }> = [
  { id: 'round', label: 'Rund' },
  { id: 'square', label: 'Eckig' },
];

export const TOWER_TOPS: ReadonlyArray<{ readonly id: TowerTop; readonly label: string; readonly hint: string }> = [
  { id: 'roof', label: 'Dach', hint: 'Dach über einem Dachgeschoss' },
  { id: 'battlements', label: 'Zinnen', hint: 'Zinnenkranz auf Kragsteinen' },
  { id: 'lookout', label: 'Aussicht', hint: 'Auskragende Aussichtsstube mit Zaun-Brüstung unter einem Dach' },
  { id: 'belfry', label: 'Glocke', hint: 'Glockenstube mit Schallöffnungen und Glocke, Dach darüber' },
  { id: 'platform', label: 'Plattform', hint: 'Offene Plattform mit Zaun-Geländer und Laternen' },
];

export const ROOF_SHAPES: ReadonlyArray<{ readonly id: RoofShape; readonly label: string; readonly hint: string; readonly shapes: readonly TowerShape[] }> = [
  { id: 'cone', label: 'Kegel', hint: 'Kegeldach (rund)', shapes: ['round'] },
  { id: 'tent', label: 'Zelt', hint: 'Zeltdach (eckig)', shapes: ['square'] },
  { id: 'helm', label: 'Rhombenhelm', hint: 'Rhombenhelm mit vier Giebeln (eckig)', shapes: ['square'] },
  { id: 'spire', label: 'Spitzhelm', hint: 'Steiler Spitzhelm (eckig mit Eckfialen)', shapes: ['round', 'square'] },
  { id: 'bell', label: 'Haube', hint: 'Welsche Haube: Fuß, Bauch, Einschnürung, Spitze', shapes: ['round', 'square'] },
];

export const FINIALS: ReadonlyArray<{ readonly id: TowerFinial | 'auto'; readonly label: string }> = [
  { id: 'auto', label: 'Zufall' },
  { id: 'none', label: 'Keine' },
  { id: 'pole', label: 'Stange' },
  { id: 'lantern', label: 'Laterne' },
  { id: 'spike', label: 'Zaun' },
  { id: 'rod', label: 'Blitzableiter' },
  { id: 'end_rod', label: 'Endstab' },
];

export const FACING_OPTIONS: ReadonlyArray<{ readonly id: HorizontalDir; readonly label: string }> = [
  { id: 'north', label: 'Nord' },
  { id: 'east', label: 'Ost' },
  { id: 'south', label: 'Süd' },
  { id: 'west', label: 'West' },
];

export const WALL_PROFILES: ReadonlyArray<{ readonly id: 'fortress' | 'garden'; readonly label: string; readonly hint: string }> = [
  { id: 'fortress', label: 'Festung', hint: 'Wehrmauer mit Wehrgang, Zinnen, Türmen und Aufgang' },
  { id: 'garden', label: 'Garten', hint: 'Niedrige Gartenmauer mit Pfeilern, Tore als Zauntor oder Öffnung' },
];

export const GATE_WIDTHS: ReadonlyArray<{ readonly id: number; readonly label: string; readonly hint: string }> = [
  { id: 1, label: 'Tür', hint: 'Einzeltür (Gartenmauer: Zauntor)' },
  { id: 2, label: 'Doppeltür', hint: 'Doppeltür (Gartenmauer: Zauntor)' },
  { id: 3, label: 'Bogen', hint: 'Torbogen, 3 breit (Gartenmauer: Öffnung)' },
  { id: 5, label: 'Großer Bogen', hint: 'Torbogen, 5 breit' },
];

/** Werkzeug-Einstellungen für neue Bauwerke (Werkzeugleiste). */
export interface TowerChoice {
  readonly shape: TowerShape;
  readonly top: TowerTop;
  readonly roofShape: RoofShape;
  readonly flare: boolean;
  readonly finial: TowerFinial | 'auto';
  readonly levels: number;
  /** Glockenstube: Glocke steht (`floor`) oder hängt im Glockenstuhl (`hanging`). */
  readonly bell: 'floor' | 'hanging';
  /** Hängende Laternen unter der Traufe (Dach, Aussichts-, Glockenstube). */
  readonly hangingLanterns: boolean;
}
export interface WallChoice {
  readonly profile: 'fortress' | 'garden';
  /** Türme an Ecken und Enden (Wehrmauer). */
  readonly towers: boolean;
}
export interface WindmillChoice {
  readonly facing: HorizontalDir;
  readonly levels: number;
}
export interface GateChoice {
  readonly width: number;
  readonly gatehouse: boolean;
}

export const DEFAULT_TOWER: TowerChoice = { shape: 'round', top: 'roof', roofShape: 'cone', flare: false, finial: 'auto', levels: 3, bell: 'floor', hangingLanterns: false };

/** Art eines angedockten Turms (research/18 T1/T3). */
export const ANNEX_KINDS: ReadonlyArray<{ readonly id: AnnexKind; readonly label: string; readonly hint: string }> = [
  { id: 'stair', label: 'Treppenturm', hint: 'Wendelstein (T3): Wendeltreppe verbindet alle Etagen, je Etage eine Tür ins Haus, Dach über der Traufe – das Haus braucht innen keine Treppe' },
  { id: 'corner', label: 'Eckturm', hint: 'Eckturm (T1): an der Hausecke, ragt über sie hinaus; oberstes Geschoss ganz über dem Haus (Aussichtsstube), Tür je Etage' },
];
/** Werkzeug-Einstellung für angedockte Türme: Art und Turmgestalt (wie beim freistehenden Turm; Geschosse = Mindesthöhe). */
export interface AnnexChoice {
  readonly kind: AnnexKind;
  readonly tower: TowerChoice;
}
/**
 * Vorgaben je Art (research/18): Treppenturm eckig 7 mit Zeltdach; Eckturm rund 9 mit Aussichtsstube, Kegel mit
 * Glockenfuß und Traufenlaternen. Ein Geschoss Mindesthöhe – Türen und Kontakt zum Haus heben den Turm ohnehin.
 */
export const ANNEX_TOWER_DEFAULTS: Readonly<Record<AnnexKind, TowerChoice>> = {
  stair: { shape: 'square', top: 'roof', roofShape: 'tent', flare: false, finial: 'auto', levels: 1, bell: 'floor', hangingLanterns: false },
  corner: { shape: 'round', top: 'lookout', roofShape: 'cone', flare: true, finial: 'auto', levels: 1, bell: 'floor', hangingLanterns: true },
};
export const DEFAULT_ANNEX: AnnexChoice = { kind: 'stair', tower: ANNEX_TOWER_DEFAULTS.stair };
export const DEFAULT_WALL: WallChoice = { profile: 'fortress', towers: true };
export const DEFAULT_WINDMILL: WindmillChoice = { facing: 'south', levels: 3 };
export const DEFAULT_GATE: GateChoice = { width: 3, gatehouse: false };

/** Passende Dachform zur Grundform (Kegel ↔ rund, Zelt/Helm ↔ eckig; Spitzhelm und Haube passen zu beiden). */
export function fitRoofShape(shape: TowerShape, roof: RoofShape): RoofShape {
  const ok = ROOF_SHAPES.find((r) => r.id === roof)?.shapes.includes(shape) ?? false;
  return ok ? roof : shape === 'round' ? 'cone' : 'tent';
}

/** Abschluss mit Dach (Dachform wirkt). */
export const topHasRoof = (top: TowerTop): boolean => top === 'roof' || top === 'lookout' || top === 'belfry';

/** Turmgestalt (ohne Lage) aus der Werkzeug-Einstellung – auch für die Türme eines Mauerzugs. */
export function towerStyleOf(c: TowerChoice): TowerStyle {
  return {
    shape: c.shape,
    top: c.top,
    roofShape: fitRoofShape(c.shape, c.roofShape),
    flare: c.flare,
    ...(c.finial !== 'auto' ? { finial: c.finial } : {}),
    ...(c.bell === 'hanging' ? { bell: 'hanging' as const } : {}),
    ...(c.hangingLanterns ? { hangingLanterns: true } : {}),
  };
}

/** Turm-Spezifikation aus der Werkzeug-Einstellung. */
export function towerSpecOf(center: Cell, c: TowerChoice): TowerSpec {
  return { center: [center[0], center[1]], ...towerStyleOf(c), levels: c.levels };
}

/** Werkzeug-Einstellung eines vorhandenen Turms (Standardwerte wie die Domäne: rund → Dach, eckig → Zinnen). */
export function towerChoiceOf(spec: TowerStyle & { readonly levels?: number | undefined }): TowerChoice {
  const shape = spec.shape ?? 'round';
  const top = spec.top ?? (shape === 'round' ? 'roof' : 'battlements');
  return {
    shape,
    top,
    roofShape: fitRoofShape(shape, spec.roofShape ?? (shape === 'round' ? 'cone' : 'tent')),
    flare: spec.flare ?? top === 'lookout',
    finial: spec.finial ?? 'auto',
    levels: spec.levels ?? 3,
    bell: spec.bell ?? 'floor',
    hangingLanterns: spec.hangingLanterns ?? false,
  };
}

// ---------------------------------------------------------------------------------------------- Abfragen


export function zoneAt(site: SiteState | undefined, cell: Cell): Zone | undefined {
  return site?.zones.find((z) => z.cells.has(cell[0], cell[1]));
}

/** Außenmaß eines Turms (wie die Domäne es aufrundet: rund ≥ 9, eckig ≥ 7, ungerade). */
export function towerSize(spec: Pick<TowerSpec, 'shape' | 'size'> & { readonly radius?: number }): number {
  // W12-C: Hochsilo (Radius statt Außenmaß, Standard 3 = Ø 7)
  if ('radius' in spec || 'height' in spec) return 2 * (spec.radius ?? 3) + 1;
  const min = (spec.shape ?? 'round') === 'round' ? 9 : 7;
  const s = spec.size ?? min;
  return Math.max(min, s % 2 === 0 ? s + 1 : s);
}

/** Abstand einer Zelle zu einem Bauwerk (0 = darauf); für Klick-Auswahl. */
export function structureDistance(item: StructureItem, cell: Cell): number {
  if (item.kind === 'wall') {
    const line = new Polyline(item.plan.points, item.plan.closed === true);
    if (line.segments.length === 0) return Infinity;
    const half = (item.plan.thickness ?? (item.plan.profile === 'garden' ? 1 : 3)) / 2;
    return Math.max(0, line.nearest(cell[0], cell[1]).dist - half);
  }
  // Wehrplatte: nicht anklickbar (sie hängt am Baukörper und steht im Panel)
  if (item.kind === 'parapet') return Infinity;
  const r = (towerSize(item.spec) - 1) / 2;
  const d = Math.max(Math.abs(cell[0] - item.spec.center[0]), Math.abs(cell[1] - item.spec.center[1]));
  return Math.max(0, d - r);
}

/** Bauwerk unter (oder höchstens `tolerance` neben) einer Zelle; das nächste gewinnt. */
export function structureAt(sur: SurroundingsState | undefined, cell: Cell, tolerance = 1): StructureItem | undefined {
  let best: StructureItem | undefined;
  let bestD = Infinity;
  for (const item of sur?.structures ?? []) {
    const d = structureDistance(item, cell);
    if (d <= tolerance && d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

export function structureById(sur: SurroundingsState | undefined, id: string): StructureItem | undefined {
  return sur?.structures.find((i) => i.id === id);
}

/** Herkunft einer Bauwerkszelle (Rollen `fort:w1`, `fort:w1.t0`; Blöcke `shell:fort:w1…`) → Bauwerks-ID (`w1`). */
export function structureIdFromOwner(owner: string | undefined): string | undefined {
  const o = owner?.startsWith('shell:') === true ? owner.slice('shell:'.length) : owner;
  if (o === undefined || !o.startsWith('fort:')) return undefined;
  return o.slice('fort:'.length).split('.')[0];
}

/** Kurzbeschreibung für Listen: „Mauer w1 · Festung · 4 Punkte, Ring“. */
export function structureLabel(item: StructureItem): string {
  switch (item.kind) {
    case 'wall': {
      const p = item.plan;
      const profile = p.profile === 'garden' ? 'Gartenmauer' : 'Wehrmauer';
      const gates = p.gates?.length ?? 0;
      return `${profile} ${item.id} · ${p.points.length} Punkte${p.closed === true ? ', Ring' : ''}${gates > 0 ? ` · ${gates} ${gates === 1 ? 'Tor' : 'Tore'}` : ''}`;
    }
    case 'tower': {
      const top = TOWER_TOPS.find((t) => t.id === (item.spec.top ?? 'roof'))?.label ?? item.spec.top;
      return `Turm ${item.id} · ${item.spec.shape === 'square' ? 'eckig' : 'rund'} · ${top}`;
    }
    case 'windmill':
      return `Windmühle ${item.id} · Flügel ${FACING_OPTIONS.find((f) => f.id === (item.spec.facing ?? 'south'))?.label ?? ''}`;
    case 'annex': {
      const doors = item.spec.openings?.length ?? 0;
      const top = TOWER_TOPS.find((t) => t.id === item.spec.top)?.label ?? item.spec.top;
      return `${annexLabel(item.spec.kind)} ${item.id} · ${item.spec.shape === 'square' ? 'eckig' : 'rund'} · ${top} · ${plural(doors, 'Tür', 'Türen')} ins Haus`;
    }
    case 'silo':
      return `Silo ${item.id} · Ø ${2 * (item.spec.radius ?? 3) + 1} · ${item.spec.height ?? 16} hoch`;
    case 'parapet': {
      const m = item.merlon ?? {};
      return `Wehrplatte ${item.id} · Baukörper ${item.volumeId} · Zinnen ${m.width ?? 2}/${m.gap ?? 1}`;
    }
  }
}

export const annexLabel = (k: AnnexKind | undefined): string => ANNEX_KINDS.find((o) => o.id === (k ?? 'stair'))?.label ?? 'Anbau-Turm';

/**
 * Zustand einer Wehrplatte fürs Panel (Review e5108a5, Befund 3): eine **gebundene** Platte, deren Baukörper es im
 * Projekt nicht mehr gibt (alle Räume radiert), baut nichts mehr – das muss dastehen, statt still zu verschwinden.
 * Eine ungebundene Platte (Altbestand mit festen Zellen) wird dagegen gebaut.
 */
export function parapetNotice(item: StructureItem, volumeIds: ReadonlySet<string>): string | undefined {
  if (item.kind !== 'parapet') return undefined;
  if (item.volumeId === undefined) return item.cells !== undefined && item.y !== undefined ? 'Altbestand: feste Zellen aus der Datei' : 'ohne Baukörper und ohne Zellen – wird nicht gebaut';
  return volumeIds.has(item.volumeId) ? undefined : `ohne Baukörper ${item.volumeId} – wird nicht gebaut (Räume gelöscht?)`;
}

// ---------------------------------------------------------------------------------------------- Angedockte Türme (C4)

const STEP4: ReadonlyArray<readonly [number, number, HorizontalDir]> = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];

/**
 * Lage eines angedockten Turms aus einem Klick an einer Außenwand (Plan „Umgebung“): nächste Außenwandzelle W des Hauses
 * (bis 3 Zellen daneben) mit Blick nach außen d; Treppenturm mittig vor W, Eckturm an der näheren Hausecke – er ragt 2
 * Zellen über sie hinaus. Öffnungen: je Etage (ab EG) eine Tür an der Kontaktzelle (`annexContacts`), die dort eine
 * gerade Außenwand mit Raum dahinter trifft – bevorzugt dieselbe Zelle auf allen Etagen, nahe der Turmachse.
 * `shell`: Hülle ohne diesen Turm. `prefer`: Blickrichtung nach außen, wenn W feststeht (Gestalt ändern).
 */
export function annexAt(state: ProjectState, shell: Shell, cell: Cell, choice: AnnexChoice, prefer?: HorizontalDir): AnnexSpec {
  const house = (x: number, z: number): boolean => state.rooms.some((r) => r.cells.has(x, z));
  const size = towerSize({ shape: choice.tower.shape });
  const r = (size - 1) / 2;
  // Außenwand: Zelle eines Raums (irgendeine Etage ab EG), deren Nachbar in Richtung d außerhalb aller Räume liegt
  let best: { w: Cell; d: readonly [number, number, HorizontalDir]; score: number } | undefined;
  for (const room of state.rooms) {
    if (room.floorIndex < 0) continue;
    for (const [x, z] of room.cells) {
      for (const d of STEP4) {
        if (house(x + d[0], z + d[1]) || (prefer !== undefined && d[2] !== prefer)) continue;
        const score = Math.abs(cell[0] - x - d[0]) + Math.abs(cell[1] - z - d[1]) + (x === cell[0] && z === cell[1] ? 0 : 0.5);
        if (score <= 3 && (best === undefined || score < best.score - 1e-9)) best = { w: [x, z], d, score };
      }
    }
  }
  if (best === undefined) throw new DomainError('annex.wall', 'Angedockter Turm: an (oder bis 3 Blöcke neben) eine Außenwand des Hauses klicken');
  const [dx, dz, dir] = best.d;
  const [ax, az] = [-dz, dx];
  const wallAt = (k: number): boolean => house(best.w[0] + ax * k, best.w[1] + az * k) && !house(best.w[0] + ax * k + dx, best.w[1] + az * k + dz);
  let shift = 0;
  if (choice.kind === 'corner') {
    let plus = 0;
    while (wallAt(plus + 1)) plus++;
    let minus = 0;
    while (wallAt(-(minus + 1))) minus++;
    shift = plus <= minus ? plus + 2 - r : -(minus + 2 - r);
  }
  const center: Cell = [best.w[0] + dx * (r + 1) + ax * shift, best.w[1] + dz * (r + 1) + az * shift];
  const side = opposite(dir) as HorizontalDir;
  const base = { kind: choice.kind, center, side, shape: choice.tower.shape };
  if (annexFootprint(base).some(([x, z]) => house(x, z))) {
    throw new DomainError('annex.overlap', `${annexLabel(choice.kind)}: überschneidet das Haus – weiter weg von Ecken und Vorsprüngen klicken`);
  }
  // Öffnungen: gerade Wand (Wandzelle oder Tür in der untersten Reihe) mit Raum dahinter, je Etage ab EG
  const at = new Map(shell.cells.map((c) => [`${c.pos[0]},${c.pos[1]},${c.pos[2]}`, c] as const));
  const levels = [...shell.rooms.values()].filter((g) => g.floorIndex >= 0);
  const floors = [...new Set(levels.map((g) => g.floorIndex))].sort((a, b) => a - b);
  const ok = (w: Cell, f: number): boolean => {
    const g = levels.find((l) => l.floorIndex === f && l.interior.has(w[0] - dx, w[1] - dz));
    const c = g === undefined ? undefined : at.get(`${w[0]},${g.baseY},${w[1]}`);
    return c !== undefined && (c.kind === 'wall' || c.kind === 'door');
  };
  const contacts = annexContacts(base).map((c) => c.at)
    .map((w) => ({ w, floors: floors.filter((f) => ok(w, f)), off: Math.abs((w[0] - center[0]) * ax + (w[1] - center[1]) * az) }))
    .filter((c) => c.floors.length > 0)
    .sort((a, b) => b.floors.length - a.floors.length || a.off - b.off || a.w[0] - b.w[0] || a.w[1] - b.w[1]);
  const openings: ShellAnnexOpening[] = [];
  for (const f of floors) {
    const hit = contacts.find((c) => c.floors.includes(f));
    if (hit !== undefined) openings.push({ floorIndex: f, at: [hit.w[0], hit.w[1]] });
  }
  if (openings.length === 0) throw new DomainError('annex.door', `${annexLabel(choice.kind)}: hier trifft der Turm keine gerade Außenwand mit Raum dahinter – kein Zugang möglich`);
  return { ...base, ...towerStyleOf(choice.tower), levels: choice.tower.levels, openings };
}

/** Angedockten Turm an der Außenwand bei `cell` setzen (EIN Undo-Schritt; Räume mit neuer Tür werden neu eingerichtet). */
export function addAnnexTower(s: Session, catalog: Catalog | undefined, cell: Cell, choice: AnnexChoice = DEFAULT_ANNEX): { session: Session; id: string } {
  checkLevels(choice.tower.levels, annexLabel(choice.kind));
  const c = checkCell(cell, annexLabel(choice.kind));
  const spec = annexAt(s.project.state, shellOf(s.project, shellStyle(s)), c, choice);
  const sur = current(s);
  const id = `${ID_PREFIX.annex}${sur.seq}`;
  const next: SurroundingsState = { ...sur, structures: [...sur.structures, { kind: 'annex', id, spec }], seq: sur.seq + 1 };
  return { session: withShellStep(s, catalog, { surroundings: next }), id };
}

/** Art und Gestalt eines angedockten Turms ändern: neu an derselben Hauswand ausgerichtet (Größe und Ecke folgen). */
export function setAnnexChoice(s: Session, catalog: Catalog | undefined, id: string, choice: AnnexChoice): Session {
  checkLevels(choice.tower.levels, annexLabel(choice.kind));
  const sur = current(s);
  const item = structureById(sur, id);
  if (item?.kind !== 'annex') throw new DomainError('structure.kind', `${id} ist kein angedockter Turm`);
  const without: SurroundingsState = { ...sur, structures: sur.structures.filter((i) => i.id !== id) };
  const plain = shellOf(s.project, shellStyle({ ...s, surroundings: without }));
  const wall = item.spec.openings?.[0]?.at ?? item.spec.center;
  const spec = annexAt(s.project.state, plain, wall, choice, opposite(item.spec.side) as HorizontalDir);
  if (JSON.stringify(spec) === JSON.stringify(item.spec)) return s;
  return withShellStep(s, catalog, { surroundings: { ...sur, structures: sur.structures.map((i) => (i.id === id ? { ...item, spec } : i)) } });
}

/** Werkzeug-Einstellung eines vorhandenen angedockten Turms. */
export function annexChoiceOf(spec: AnnexSpec): AnnexChoice {
  return { kind: spec.kind ?? 'stair', tower: { ...towerChoiceOf(spec), levels: spec.levels ?? 1 } };
}

/** Grundstück um das Haus (ohne Räume: um das Raster des Editors). */
export function plotFor(building: BuildingInfo, margin: number): Plot {
  if (building.footprint.isEmpty) return { minX: -margin, minZ: -margin, maxX: GRID.width - 1 + margin, maxZ: GRID.depth - 1 + margin };
  return plotAround(building, margin);
}

/** Liegt das Haus (Grundfläche + Überstände) ganz im Grundstück? */
export function houseInPlot(shell: Shell, plot: Plot): boolean {
  const b = buildingFromShell(shell);
  const box = b.footprint.union(b.covered).bounds();
  return box === undefined || (box.minX >= plot.minX && box.minZ >= plot.minZ && box.maxX <= plot.maxX && box.maxZ <= plot.maxZ);
}

// ---------------------------------------------------------------------------------------------- Befehle: Gelände

const current = (s: Session): SurroundingsState => s.surroundings ?? EMPTY_SURROUNDINGS;

function commit(s: Session, next: SurroundingsState): Session {
  if (next === s.surroundings) return s;
  // F-Ensemble: mit Verbindungsgraph kann jede Änderung der Umgebung die Brückentüren verschieben – dann wie ein
  // Hüllen-Schritt (betroffene Räume neu einrichten); ohne Graph unverändert
  if (ensembleActive(next) || ensembleActive(s.surroundings)) return withShellStep(s, ensembleCatalog(), { surroundings: next });
  return withUndoStep(s, { surroundings: next });
}

/**
 * F-Ensemble: Verbindungsgraph der Base an/aus (Holzbrücken aus Obergeschossen zum Wehrgang bzw. Nachbargebäude,
 * Anschluss- und Rundwege). Gespeichert in der Umgebung (Projektdatei `surroundings.ensemble`); die Engine setzt ihn mit
 * `project_style { ensemble }`. Die Hülle ändert sich (Brückentüren): betroffene Räume werden neu eingerichtet.
 */
export function setEnsemble(s: Session, on: boolean, catalog?: Catalog): Session {
  const sur = current(s);
  if (sur.ensemble === on) return s;
  return withShellStep(s, catalog ?? ensembleCatalog(), { surroundings: { ...sur, ensemble: on } });
}

/** Auswahl „Geländeform“ (Reihenfolge = Anzeige): Beschriftung und Erklärung für Panel und Assistent. */
export const LANDFORM_OPTIONS: ReadonlyArray<{ readonly id: Landform; readonly label: string; readonly hint: string }> = [
  { id: 'flat', label: 'Eben', hint: 'Flaches Grundstück wie bisher' },
  { id: 'natural', label: 'Hügelig', hint: 'Sanfter Hang hinter dem Haus mit Stützmauer, kleiner Teich, Findlinge, Moos am Sockel, dichtere Bepflanzung' },
  { id: 'dramatic', label: 'Bergig', hint: 'Hoher Hang mit zwei Terrassen und Stützmauern hinter dem Haus, mehr Findlinge, Moos und Bäume' },
];

/**
 * feat/gelaende: Geländeform der Umgebung ('flat' = wie bisher). Gespeichert in der Umgebung (Projektdatei
 * `surroundings.landform`); die Engine setzt sie mit `project_style { landform }` (auch building_generate/rooms_generate).
 * Wirkt nur mit Gelände; die Hülle bleibt gleich, nur die Umgebung wird neu gebaut.
 */
export function setLandform(s: Session, form: Landform): Session {
  const sur = current(s);
  if ((sur.landform ?? 'flat') === form) return s;
  const { landform: _old, ...rest } = sur;
  return commit(s, form === 'flat' ? rest : { ...rest, landform: form });
}

/** Geländeform der Umgebung (fehlt = 'flat'). Für die Auswahl. */
export function landformOf(s: Pick<Session, 'surroundings'>): Landform {
  return s.surroundings?.landform ?? 'flat';
}

/** Wirkt der Verbindungsgraph (Schalter bzw. Standard)? Für das Kontrollkästchen. */
export function ensembleOn(s: Pick<Session, 'surroundings'>): boolean {
  const e = s.surroundings?.ensemble;
  return e ?? ENSEMBLE_DEFAULT !== undefined;
}

/** Stufen der Grundstücks-Deko (feat/site-decor) für die Auswahl im Panel Umgebung. */
export const SITE_DECOR_OPTIONS: ReadonlyArray<{ readonly id: SiteDecorLevel; readonly label: string; readonly hint: string }> = [
  { id: 'off', label: 'aus', hint: 'Keine zusätzliche Deko auf dem Grundstück' },
  { id: 'some', label: 'wenig', hint: 'Einige Akzente: Holzplatz, Beete, Bank, Bannermasten am Eingang' },
  { id: 'rich', label: 'dicht', hint: 'Dicht besetzt: dazu Torbogen, Lampen, Feuerstelle, Brunnen, Wagen, Wegweiser, je nach Theme Standbilder' },
];

/** Stufe der Grundstücks-Deko der Sitzung (fehlt = aus). */
export const siteDecorOf = (s: Pick<Session, 'surroundings'>): SiteDecorLevel => s.surroundings?.siteDecor ?? 'off';

/**
 * Grundstücks-Deko (feat/site-decor) aus/wenig/dicht: Holzplatz, Beete, Bank, Bannermasten, Torbogen, Standbilder je Theme,
 * dazu Pferch, Bienenhof, Gräber und Marktstand nach den Räumen. Gespeichert in der Umgebung (Projektdatei
 * `surroundings.siteDecor`, `off` = Feld fehlt); die Engine setzt sie mit `project_style { siteDecor }` bzw. an den Aufrufen
 * `building_generate`/`rooms_generate`. Braucht das Gelände.
 */
export function setSiteDecor(s: Session, level: SiteDecorLevel): Session {
  const sur = current(s);
  if ((sur.siteDecor ?? 'off') === level) return s;
  const { siteDecor: _old, ...rest } = sur;
  return commit(s, level === 'off' ? rest : { ...rest, siteDecor: level });
}

/** Stufen der erzählenden Verwitterung (WS-Verwitterung) für die Auswahl im Panel Umgebung. */
export const WEATHERING_OPTIONS: ReadonlyArray<{ readonly id: 'off' | WeatheringLevel; readonly label: string; readonly hint: string }> = [
  { id: 'off', label: 'aus', hint: 'Keine erzählende Verwitterung (Sockel, Fassade und Dach wie bisher)' },
  { id: 'some', label: 'wenig', hint: 'Moos und Steinschutt im Sockel, Schatten unter Dachkanten, dunklere Dachecken und Kehlen' },
  { id: 'rich', label: 'stark', hint: 'Wie „wenig“, aber größere Flecken: Moos am Boden und am Baumkontakt, Regenspuren, Ausblühungen' },
];

/** Stufe der erzählenden Verwitterung der Sitzung (fehlt = aus). */
export const weatheringOf = (s: Pick<Session, 'surroundings'>): 'off' | WeatheringLevel => s.surroundings?.weathering ?? 'off';

/**
 * Erzählende Verwitterung (WS-Verwitterung) aus/wenig/stark: Moos, Schutt, Schatten und Regenspuren an den Stellen, die
 * die Geometrie hergibt (Sockel, Dachkanten, Kehlen), mit weichem Übergang in die Grundfarbe. Gespeichert in der
 * Umgebung (Projektdatei `surroundings.weathering`, `off` = Feld fehlt); die Engine setzt sie mit `project_style { weathering }`
 * bzw. an den Aufrufen `building_generate`/`rooms_generate`. Wirkt auch ohne Gelände; tauscht nur Blöcke.
 */
export function setWeathering(s: Session, level: 'off' | WeatheringLevel): Session {
  const sur = current(s);
  if ((sur.weathering ?? 'off') === level) return s;
  const { weathering: _old, ...rest } = sur;
  return commit(s, level === 'off' ? rest : { ...rest, weathering: level });
}

/** Stufen der Oberflächen-Textur (TX-B) für die Auswahl im Panel Umgebung. */
export const SURFACE_TEXTURE_OPTIONS: ReadonlyArray<{ readonly id: 'off' | SurfaceTextureLevel; readonly label: string; readonly hint: string }> = [
  { id: 'off', label: 'aus', hint: 'Wände, Sockel und Dach wie bisher (Blockwahl des Themes)' },
  { id: 'subtle', label: 'dezent', hint: 'Zusammenhängende Flecken aus Nachbarblöcken, dunklerer Sockel, Dach dunkler zur Traufe' },
  { id: 'rich', label: 'kräftig', hint: 'Wie „dezent“, dazu Kontrast an Ecken und Fensterbänken und Dachstreifen; Streublöcke gegen gleichblockige Flächen' },
];

/** Stufe der Oberflächen-Textur der Sitzung (fehlt = aus). */
export const surfaceTextureOf = (s: Pick<Session, 'surroundings'>): 'off' | SurfaceTextureLevel => s.surroundings?.surfaceTexture ?? 'off';

/**
 * Oberflächen-Textur (TX-B) aus/dezent/kräftig: Blockmischung aus Schwesterblöcken in Flecken (60/25/15), Sockel und
 * Traufe dunkler, Dachverlauf, Kontrast an Ecken und Fensterlaibungen, Musterbruch – jede Änderung folgt einer benannten
 * Regel. Gespeichert in der Umgebung (Projektdatei `surroundings.surfaceTexture`, `off` = Feld fehlt); die Engine setzt sie
 * mit `project_style { surfaceTexture }` bzw. an den Aufrufen `building_generate`/`rooms_generate`. Wirkt auch ohne
 * Gelände; tauscht nur Blöcke.
 */
export function setSurfaceTexture(s: Session, level: 'off' | SurfaceTextureLevel): Session {
  const sur = current(s);
  if ((sur.surfaceTexture ?? 'off') === level) return s;
  const { surfaceTexture: _old, ...rest } = sur;
  return commit(s, level === 'off' ? rest : { ...rest, surfaceTexture: level });
}

/** Fehler des Gelände-Aggregats (SiteError) als fachlicher Fehler für die Statuszeile. */
function asDomainError(e: unknown): unknown {
  if (e instanceof Error && e.name === 'SiteError') return new DomainError((e as Error & { code?: string }).code ?? 'site', e.message);
  return e;
}

function newSiteEvents(s: Session, sur: SurroundingsState, styleId: string): readonly SiteEvent[] {
  const building = buildingFromShell(shellOf(s.project, shellStyle(s)));
  const site = Site.create({ id: 'site', projectId: s.project.state.id, seed: s.project.state.seed, styleId, plot: plotFor(building, sur.margin) });
  const events = [...site.history];
  rememberSiteState(events, site.state);
  return events;
}

interface SiteOptions {
  /** Ohne Gelände eines anlegen (Grundstück = Haus + Rand) statt abzulehnen. */
  readonly create?: boolean;
  /** Gelände dabei einschalten. */
  readonly enable?: boolean;
  readonly styleId?: string;
  /** Neuer Rand (App-Einstellung). */
  readonly margin?: number;
}

/**
 * Befehl auf dem Gelände-Aggregat. Ohne Gelände legt `create` eines an und schaltet es ein – Anlegen und Befehl sind
 * dann EIN Undo-Schritt. Keine Events und keine geänderte Einstellung → Sitzung unverändert.
 */
function onSite(s: Session, command: (site: Site) => unknown, opts: SiteOptions = {}): Session {
  const sur = current(s);
  let events = sur.site;
  if (events === undefined) {
    if (opts.create !== true) throw new DomainError('site.none', 'Noch kein Gelände – erst „Gelände“ einschalten');
    events = newSiteEvents(s, sur, opts.styleId ?? DEFAULT_TERRAIN_STYLE);
  }
  const site = Site.fromHistory(events);
  try {
    command(site);
  } catch (e) {
    throw asDomainError(e);
  }
  if (site.history.length !== events.length) {
    events = [...site.history];
    rememberSiteState(events, site.state);
  }
  const next: SurroundingsState = { ...sur, site: events, terrain: opts.enable === true ? true : sur.terrain, margin: opts.margin ?? sur.margin };
  if (next.site === sur.site && next.terrain === sur.terrain && next.margin === sur.margin) return s;
  return commit(s, next);
}

/** Grundstück setzen, falls es sich ändert (Zonen-Zellen außerhalb entfallen per Domain Event). */
const resizeTo = (plot: Plot) => (site: Site): void => {
  const p = site.state.plot;
  if (p.minX !== plot.minX || p.minZ !== plot.minZ || p.maxX !== plot.maxX || p.maxZ !== plot.maxZ) site.resizePlot(plot);
};

/**
 * Gelände an/aus. Beim ersten Einschalten entsteht das Gelände-Aggregat: Grundstück = Haus + Rand, Stil `styleId`,
 * Seed des Projekts. Aus behält Zonen und Terraforming (wieder an → alles wie vorher).
 */
export function setTerrainEnabled(s: Session, on: boolean, styleId = DEFAULT_TERRAIN_STYLE): Session {
  const sur = current(s);
  if (!on) return sur.terrain ? commit(s, { ...sur, terrain: false }) : s;
  return onSite(s, () => undefined, { create: true, enable: true, styleId });
}

export function setTerrainStyle(s: Session, styleId: string): Session {
  return onSite(s, (site) => site.setStyle(styleId));
}

/** Gelände neu würfeln (Relief, Wege, Vegetation); Zonen und Terraforming bleiben. */
export function rerollTerrain(s: Session): Session {
  return onSite(s, (site) => site.reroll());
}

/** Grundstück = Haus + Rand (`margin` Blöcke). Zonen-Zellen außerhalb entfallen (rückgängig machbar). */
export function fitPlot(s: Session, margin: number): Session {
  if (!Number.isInteger(margin) || margin < MARGIN_RANGE.min || margin > MARGIN_RANGE.max) {
    throw new DomainError('site.margin', `Rand ${margin} nicht erlaubt (${MARGIN_RANGE.min}–${MARGIN_RANGE.max})`);
  }
  const sur = current(s);
  if (sur.site === undefined) return sur.margin === margin ? s : commit(s, { ...sur, margin });
  const building = buildingFromShell(shellOf(s.project, shellStyle(s)));
  return onSite(s, resizeTo(plotFor(building, margin)), { margin });
}

/** Grundstück als Rechteck aufziehen (Werkzeug „Grundstück“). */
export function setPlot(s: Session, rect: Rect): Session {
  const plot: Plot = { minX: Math.min(rect.x1, rect.x2), minZ: Math.min(rect.z1, rect.z2), maxX: Math.max(rect.x1, rect.x2), maxZ: Math.max(rect.z1, rect.z2) };
  const { w, d } = plotSize(plot);
  if (w < PLOT_LIMITS.min || d < PLOT_LIMITS.min) throw new DomainError('plot.size', `Grundstück mindestens ${PLOT_LIMITS.min} × ${PLOT_LIMITS.min} Blöcke (aufgezogen: ${w} × ${d})`);
  return onSite(s, resizeTo(plot), { create: true, enable: true });
}

/** Bereich eines Werkzeugs: Rechteck (aufgezogen) oder Zellen eines Pinselstrichs (`brushCells`). */
export type Area = Rect | readonly Cell[];

const areaSet = (a: Area): CellSet =>
  'x1' in a ? CellSet.rect(Math.min(a.x1, a.x2), Math.min(a.z1, a.z2), Math.max(a.x1, a.x2), Math.max(a.z1, a.z2)) : CellSet.of(a);

/** Außenbereich malen (übermalt andere Zonen; Zellen außerhalb des Grundstücks entfallen). Legt bei Bedarf das Gelände an. */
export function paintZone(s: Session, kind: ZoneKind, area: Area): { session: Session; zoneId: ZoneId | undefined } {
  let zoneId: ZoneId | undefined;
  const session = onSite(
    s,
    (site) => {
      for (const e of site.paintZone(kind, areaSet(area))) if (e.type === 'ZonePainted') zoneId = e.zoneId;
    },
    { create: true, enable: true },
  );
  return { session, zoneId };
}

export function eraseZones(s: Session, area: Area): Session {
  if (current(s).site === undefined) return s;
  return onSite(s, (site) => site.eraseZones(areaSet(area)));
}

export function setZoneKind(s: Session, zoneId: ZoneId, kind: ZoneKind): Session {
  return onSite(s, (site) => site.setZoneKind(zoneId, kind));
}

export function removeZone(s: Session, zoneId: ZoneId): Session {
  return onSite(s, (site) => site.eraseZones(site.zone(zoneId).cells));
}

/** Terraforming auf einem Bereich: anheben/senken um `amount`, ebnen auf `level`, glätten, zurücksetzen. */
export function sculpt(s: Session, tool: SculptTool, area: Area, opts: { amount?: number; level?: number } = {}): Session {
  const cells = areaSet(area);
  if (tool === 'reset') return current(s).site === undefined ? s : onSite(s, (site) => site.resetTerrain(cells));
  return onSite(
    s,
    (site) => {
      if (tool === 'flatten') site.flatten(cells, opts.level ?? 0);
      else if (tool === 'smooth') site.smooth(cells);
      else site.sculpt(tool, cells, opts.amount ?? 1);
    },
    { create: true, enable: true },
  );
}

/** Rand einer Zone (Zaun, Hecke, offen); nur für Feld, Garten, Obstgarten, Koppel. */
export function setZoneEdge(s: Session, zoneId: ZoneId, edge: ZoneEdge): Session {
  return onSite(s, (site) => site.setZoneEdge(zoneId, edge));
}

/** Außenbeleuchtung des Grundstücks (keine, Wege, spawnsicher). */
export function setSiteLighting(s: Session, lighting: SiteLighting): Session {
  return onSite(s, (site) => site.setLighting(lighting));
}

/**
 * Grundstücks-Vorlage anwenden (Domäne: `Site.applyTemplate`, z. B. „Gehöft“): ersetzt alle Zonen, vergrößert das
 * Grundstück bei Bedarf, setzt Beleuchtung und Stil. Der Garten liegt an der Küchenseite (Küchen im untersten Geschoss).
 * `styleId`: Geländestil nach der Vorlage (fehlt er im Katalog, den bisherigen übergeben). Ein Undo-Schritt.
 */
export function applySiteTemplate(s: Session, template: SiteTemplateId, opts: { readonly styleId?: string } = {}): Session {
  const building = buildingFromShell(shellOf(s.project, shellStyle(s)));
  if (building.footprint.isEmpty) throw new DomainError('site.template', 'Vorlage: erst Räume malen – die Zonen richten sich nach Haustür und Küche');
  const st = s.project.state;
  const lowest = Math.min(...st.floors.map((f) => f.index));
  const kitchen = st.rooms.filter((r) => r.floorIndex === lowest && r.roomTypeId === 'kitchen').reduce((acc, r) => acc.union(r.cells), CellSet.empty());
  return onSite(
    s,
    (site) => site.applyTemplate(template, building, { ...(kitchen.isEmpty ? {} : { kitchen }), ...(opts.styleId !== undefined ? { styleId: opts.styleId } : {}) }),
    { create: true, enable: true, ...(opts.styleId !== undefined ? { styleId: opts.styleId } : {}) },
  );
}

/** Alles Terraforming verwerfen. */
export function resetAllTerrain(s: Session): Session {
  const site = siteOf(current(s));
  if (site === undefined || site.sculpt.size === 0) return s;
  const cells = CellSet.of([...site.sculpt.keys()].map((k): Cell => [Number(k.slice(0, k.indexOf(','))), Number(k.slice(k.indexOf(',') + 1))]));
  return onSite(s, (st) => st.resetTerrain(cells));
}

/** Vegetationsdichte (Bäume, Büsche, Bodenpflanzen) als Faktor 0–2 auf den Geländestil – Domain Event `VegetationChanged`. */
export function setVegetation(s: Session, patch: Partial<VegetationDensity>): Session {
  const now = vegetationOf(siteOf(current(s)));
  const next: VegetationDensity = { ...now, ...patch };
  if (next.trees === now.trees && next.bushes === now.bushes && next.ground === now.ground) return s;
  return onSite(s, (site) => site.setVegetation(next));
}

// ---------------------------------------------------------------------------------------------- Befehle: Bauwerke


function checkLevels(levels: number | undefined, what: string): void {
  if (levels !== undefined && (!Number.isInteger(levels) || levels < TOWER_LEVELS.min || levels > TOWER_LEVELS.max)) {
    throw new DomainError('structure.levels', `${what}: ${levels} Geschosse nicht erlaubt (${TOWER_LEVELS.min}–${TOWER_LEVELS.max})`);
  }
}

const ID_PREFIX: Readonly<Record<StructureKind, string>> = { wall: 'w', tower: 't', windmill: 'm', annex: 'a', parapet: 'p', silo: 's' };

function addItem(s: Session, kind: StructureKind, make: (id: string) => StructureItem): { session: Session; id: string } {
  const sur = current(s);
  const id = `${ID_PREFIX[kind]}${sur.seq}`;
  return { session: commit(s, { ...sur, structures: [...sur.structures, make(id)], seq: sur.seq + 1 }), id };
}

function replaceItem(s: Session, id: string, f: (item: StructureItem) => StructureItem): Session {
  const sur = current(s);
  const old = structureById(sur, id);
  if (old === undefined) throw new DomainError('structure.unknown', `Unbekanntes Bauwerk ${id}`);
  const next = f(old);
  if (JSON.stringify(next) === JSON.stringify(old)) return s;
  return commit(s, { ...sur, structures: sur.structures.map((i) => (i.id === id ? next : i)) });
}

/** Mauerzug anlegen (Tiny Glade: Punkte klicken, Doppelklick beendet, Klick auf den ersten Punkt schließt den Ring). */
export function addWall(s: Session, points: readonly Cell[], closed: boolean, choice: WallChoice = DEFAULT_WALL): { session: Session; id: string } {
  const pts = cleanPoints(points, closed);
  ensureWallClear(s, pts, closed, undefined, 'Der Mauerzug');
  return addItem(s, 'wall', (id) => ({
    kind: 'wall',
    id,
    plan: {
      points: pts,
      closed,
      profile: choice.profile,
      ...(choice.profile === 'fortress' && !choice.towers ? { towers: 'none' as const } : {}),
    },
  }));
}

/**
 * Rechteck des Hauses (Räume) mit einem Block Rand für die Außenwände; `undefined` ohne Räume.
 * Grundlage der Überbau-Prüfung unten (Nutzerreview 24.09.2026).
 */
export function houseRect(state: ProjectState, margin = 1): { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number } | undefined {
  const cells = state.rooms.flatMap((r) => r.cells.toArray());
  if (cells.length === 0) return undefined;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of cells) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  return { minX: minX - margin, minZ: minZ - margin, maxX: maxX + margin, maxZ: maxZ + margin };
}

/**
 * Freistehende Bauwerke dürfen das Haus nicht überbauen: Sonst treffen Bauwerkszellen (Schicht 5) auf Möbel
 * oder Wandzellen (Schicht 2), und die Materialisierung bricht mit einem Merge-Verstoß ab – im Nutzertest am
 * 24.09.2026 als „Turm auf dem Haus löscht die Welt“ reproduzierbar. Statt abzustürzen wird die Platzierung
 * jetzt abgelehnt, mit einem Satz in Nutzersprache.
 */
function ensureClearOfHouse(s: Session, center: Cell, radius: number, what: string): void {
  const rect = houseRect(s.project.state);
  if (rect === undefined) return;
  const overlaps = center[0] + radius >= rect.minX && center[0] - radius <= rect.maxX
    && center[1] + radius >= rect.minZ && center[1] - radius <= rect.maxZ;
  if (!overlaps) return;
  throw new DomainError(
    'structure.overlap',
    `${what} würde das Haus überbauen – bitte mit Abstand daneben setzen (mindestens ${radius + 1} Blöcke von der Außenwand).`,
  );
}

/**
 * Läuft ein Mauerzug durch das Haus? Geprüft wird der **Pfad** (nicht die Bounding-Box – ein Ring *um* das Haus
 * ist erlaubt und muss es bleiben): jeder Mauerpunkt darf nicht im Haus liegen, und der Weg darf die Hauskante
 * nicht schneiden. Review: „Mauer durch das Haus lässt die Welt verschwinden“ – derselbe Merge-Verstoß wie beim
 * Turm, nur über einen anderen Weg.
 */
function ensureWallClear(s: Session, points: readonly Cell[], closed: boolean, thickness: number | undefined, was: string): void {
  const house = houseRect(s.project.state);
  if (house === undefined) return;
  const half = (thickness ?? 3) / 2;
  const drin = (x: number, z: number): boolean => x >= house.minX && x <= house.maxX && z >= house.minZ && z <= house.maxZ;
  const trifft = (): boolean => {
    for (const [x, z] of points) if (drin(x, z)) return true;
    const line = new Polyline(points, closed);
    if (line.segments.length === 0) return false;
    for (let x = house.minX; x <= house.maxX; x++) {
      for (const z of [house.minZ, house.maxZ]) if (line.nearest(x, z).dist <= half) return true;
    }
    for (let z = house.minZ; z <= house.maxZ; z++) {
      for (const x of [house.minX, house.maxX]) if (line.nearest(x, z).dist <= half) return true;
    }
    return false;
  };
  if (!trifft()) return;
  throw new DomainError(
    'structure.overlap',
    `${was} würde durch das Haus laufen – bitte außen herum führen (ein Ring um das Haus bleibt erlaubt).`,
  );
}

/** Halbe Grundriss-Breite eines Turms (Außenmaß → Radius des Grundrisses). */
const towerRadius = (spec: TowerSpec): number => (towerSize(spec) - 1) / 2;

/** Freiraum, den die Windmühlenflügel brauchen (`@mcda/structures`: Flügellänge ab der Nabe, Standard 7). */
const WINDMILL_SAIL_CLEARANCE = 7;

/**
 * Review 3: „21 Türme stapelbar“ – freie Bauwerke dürfen sich nicht gegenseitig überbauen. Geprüft wird der
 * Abstand der Mitten (Tschebyschew, wie die quadratischen Turm-Footprints); Mauern und angedockte Türme
 * (`annex`) bleiben außen vor, die gehören zum Haus bzw. zum Mauerzug.
 */
function ensureClearOfStructures(s: Session, center: Cell, radius: number, what: string, selfId?: string): void {
  for (const item of current(s).structures) {
    if (item.id === selfId || (item.kind !== 'tower' && item.kind !== 'windmill')) continue;
    const other = item.spec.center;
    const otherRadius = item.kind === 'tower'
      ? towerRadius(item.spec)
      : Math.max(towerRadius({ ...item.spec, center: other }), WINDMILL_SAIL_CLEARANCE);
    const distance = Math.max(Math.abs(center[0] - other[0]), Math.abs(center[1] - other[1]));
    if (distance >= radius + otherRadius) continue;
    throw new DomainError(
      'structure.overlap',
      `${what} würde ${item.kind === 'tower' ? 'einen Turm' : 'eine Windmühle'} überbauen – bitte mit mindestens ${radius + otherRadius} Blöcken Abstand zwischen den Mitten setzen.`,
    );
  }
}

export function addTower(s: Session, center: Cell, choice: TowerChoice = DEFAULT_TOWER): { session: Session; id: string } {
  checkLevels(choice.levels, 'Turm');
  const c = checkCell(center, 'Turm');
  const spec = towerSpecOf(c, choice);
  ensureClearOfHouse(s, c, towerRadius(spec), 'Der Turm');
  ensureClearOfStructures(s, c, towerRadius(spec), 'Der Turm');
  return addItem(s, 'tower', (id) => ({ kind: 'tower', id, spec }));
}

export function addWindmill(s: Session, center: Cell, choice: WindmillChoice = DEFAULT_WINDMILL): { session: Session; id: string } {
  checkLevels(choice.levels, 'Windmühle');
  const c = checkCell(center, 'Windmühle');
  // Die Flügel reichen seitlich über den Turm hinaus (Standard 7 Blöcke ab der Nabe): freie Fläche verlangen,
  // sonst schneiden sie später ins Dach.
  const radius = Math.max(towerRadius({ center: c, ...choice }), WINDMILL_SAIL_CLEARANCE);
  ensureClearOfHouse(s, c, radius, 'Die Windmühle');
  ensureClearOfStructures(s, c, radius, 'Die Windmühle');
  return addItem(s, 'windmill', (id) => ({ kind: 'windmill', id, spec: { center: c, facing: choice.facing, levels: choice.levels } }));
}

/** Bauwerk entfernen; ein angedockter Turm ändert die Hülle (Türen weg) – dann richtet `catalog` die Räume neu ein. */
export function removeStructure(s: Session, id: string, catalog?: Catalog): Session {
  const sur = current(s);
  const item = structureById(sur, id);
  if (item === undefined) throw new DomainError('structure.unknown', `Unbekanntes Bauwerk ${id}`);
  const next: SurroundingsState = { ...sur, structures: sur.structures.filter((i) => i.id !== id) };
  return item.kind === 'annex' ? withShellStep(s, catalog, { surroundings: next }) : commit(s, next);
}

/** Bauwerk verschieben (alle Punkte bzw. die Mitte um dx/dz). Angedockte Türme hängen an der Hauswand: neu setzen. */
export function moveStructure(s: Session, id: string, dx: number, dz: number): Session {
  if (dx === 0 && dz === 0) return s;
  const move = (c: Cell): Cell => checkCell([c[0] + dx, c[1] + dz], 'Verschieben');
  return replaceItem(s, id, (item) => {
    if (item.kind === 'annex') throw new DomainError('annex.move', `${annexLabel(item.spec.kind)} ${id} hängt an der Hauswand – entfernen und neu setzen`);
    if (item.kind === 'wall') {
      const points = item.plan.points.map(move);
      ensureWallClear(s, points, item.plan.closed === true, item.plan.thickness, 'Der Mauerzug');
      return { ...item, plan: { ...item.plan, points, ...(item.plan.gates !== undefined ? { gates: item.plan.gates.map((g) => ({ ...g, at: move(g.at) })) } : {}) } };
    }
    if (item.kind === 'parapet') {
      throw new DomainError('parapet.move', `Wehrplatte ${id} hängt an Baukörper ${item.volumeId} und folgt dessen Flachdach – sie lässt sich nicht verschieben (nur entfernen)`);
    }
    if (item.kind === 'tower') {
      const center = move(item.spec.center);
      ensureClearOfHouse(s, center, towerRadius(item.spec), 'Der Turm');
      ensureClearOfStructures(s, center, towerRadius(item.spec), 'Der Turm', id);
      return { ...item, spec: { ...item.spec, center } };
    }
    const center = move(item.spec.center);
    const radius = Math.max(towerRadius({ ...item.spec, center }), WINDMILL_SAIL_CLEARANCE);
    ensureClearOfHouse(s, center, radius, 'Die Windmühle');
    ensureClearOfStructures(s, center, radius, 'Die Windmühle', id);
    return { ...item, spec: { ...item.spec, center } };
  });
}

export type WallPatch = Partial<Pick<WallPlan, 'points' | 'closed' | 'profile' | 'towers' | 'towerSpacing' | 'towerStyle' | 'height' | 'garden'>>;

/** Eigenschaften eines Mauerzugs ändern (Profil, Ring, Türme, Turmstil, Höhe …). */
export function updateWall(s: Session, id: string, patch: WallPatch): Session {
  return replaceItem(s, id, (item) => {
    if (item.kind !== 'wall') throw new DomainError('structure.kind', `${id} ist keine Mauer`);
    const plan: WallPlan = { ...item.plan, ...patch };
    const points = cleanPoints(plan.points, plan.closed === true);
    if (plan.towerSpacing !== undefined && (!Number.isInteger(plan.towerSpacing) || plan.towerSpacing < TOWER_SPACING_RANGE.min || plan.towerSpacing > TOWER_SPACING_RANGE.max)) {
      throw new DomainError('wall.spacing', `Turmabstand ${plan.towerSpacing} nicht erlaubt (${TOWER_SPACING_RANGE.min}–${TOWER_SPACING_RANGE.max})`);
    }
    if (plan.height !== undefined && (!Number.isInteger(plan.height) || plan.height < 2 || plan.height > 16)) throw new DomainError('wall.height', `Mauerhöhe ${plan.height} nicht erlaubt (2–16)`);
    const style = plan.towerStyle;
    const towerStyle = style === undefined ? undefined : { ...style, roofShape: fitRoofShape(style.shape ?? 'round', style.roofShape ?? 'cone') };
    return { ...item, plan: { ...plan, points, ...(towerStyle !== undefined ? { towerStyle } : {}) } };
  });
}

/** Gestalt eines freistehenden Turms setzen (Panel); Lage, Größe und Tür bleiben. */
export function setTowerChoice(s: Session, id: string, choice: TowerChoice): Session {
  checkLevels(choice.levels, 'Turm');
  return replaceItem(s, id, (item) => {
    if (item.kind !== 'tower') throw new DomainError('structure.kind', `${id} ist kein Turm`);
    const { finial: _finial, bell: _bell, hangingLanterns: _lanterns, ...rest } = item.spec;
    return { ...item, spec: { ...rest, ...towerSpecOf(item.spec.center, choice) } };
  });
}

export type TowerPatch = Partial<Omit<TowerSpec, 'id' | 'center'>>;

/** Turm ändern (Form, Abschluss, Dachform, Glockenfuß, Spitze, Geschosse). Die Dachform folgt der Grundform. */
export function updateTower(s: Session, id: string, patch: TowerPatch): Session {
  checkLevels(patch.levels, 'Turm');
  return replaceItem(s, id, (item) => {
    if (item.kind !== 'tower') throw new DomainError('structure.kind', `${id} ist kein Turm`);
    const spec: TowerSpec = { ...item.spec, ...patch };
    return { ...item, spec: { ...spec, roofShape: fitRoofShape(spec.shape ?? 'round', spec.roofShape ?? 'cone') } };
  });
}

export type WindmillPatch = Partial<Pick<WindmillSpec, 'facing' | 'levels' | 'sailLength' | 'door' | 'hangingLanterns'>>;

export function updateWindmill(s: Session, id: string, patch: WindmillPatch): Session {
  checkLevels(patch.levels, 'Windmühle');
  if (patch.sailLength !== undefined && (!Number.isInteger(patch.sailLength) || patch.sailLength < SAIL_RANGE.min || patch.sailLength > SAIL_RANGE.max)) {
    throw new DomainError('windmill.sail', `Flügellänge ${patch.sailLength} nicht erlaubt (${SAIL_RANGE.min}–${SAIL_RANGE.max})`);
  }
  if (patch.facing !== undefined && !HORIZONTAL.includes(patch.facing)) throw new DomainError('windmill.facing', `Unbekannte Richtung ${String(patch.facing)}`);
  return replaceItem(s, id, (item) => {
    if (item.kind !== 'windmill') throw new DomainError('structure.kind', `${id} ist keine Windmühle`);
    return { ...item, spec: { ...item.spec, ...patch } };
  });
}

/** Wie nah ein Klick an der Mauerlinie liegen muss, damit dort ein Tor entsteht. */
export const GATE_SNAP = 3;

/** Nächster Mauerzug zu einer Zelle (Abstand zur Linie). */
export function nearestWall(sur: SurroundingsState | undefined, cell: Cell): { readonly id: string; readonly dist: number } | undefined {
  let best: { id: string; dist: number } | undefined;
  for (const item of sur?.structures ?? []) {
    if (item.kind !== 'wall') continue;
    const line = new Polyline(item.plan.points, item.plan.closed === true);
    if (line.segments.length === 0) continue;
    const dist = line.nearest(cell[0], cell[1]).dist;
    if (best === undefined || dist < best.dist) best = { id: item.id, dist };
  }
  return best;
}

/** Tor per Klick auf ein Mauerstück (Tiny Glade): das Tor sitzt am nächsten Punkt der Linie. */
export function addGate(s: Session, at: Cell, choice: GateChoice = DEFAULT_GATE): { session: Session; wallId: string } {
  const cell = checkCell(at, 'Tor');
  const near = nearestWall(current(s), cell);
  if (near === undefined || near.dist > GATE_SNAP) throw new DomainError('gate.wall', 'Tor: bitte auf (oder direkt neben) eine Mauer klicken');
  if (!Number.isInteger(choice.width) || choice.width < 1 || choice.width > 7) throw new DomainError('gate.width', `Torbreite ${choice.width} nicht erlaubt (1–7)`);
  const session = replaceItem(s, near.id, (item) => {
    if (item.kind !== 'wall') return item;
    const gates = item.plan.gates ?? [];
    if (gates.some((g) => Math.hypot(g.at[0] - cell[0], g.at[1] - cell[1]) < Math.max(3, choice.width + 1))) {
      throw new DomainError('gate.duplicate', 'Hier ist schon ein Tor (Rechtsklick entfernt es)');
    }
    const gate: GateSpec = { at: cell, width: choice.width, ...(choice.gatehouse && item.plan.profile !== 'garden' ? { gatehouse: true } : {}) };
    return { ...item, plan: { ...item.plan, gates: [...gates, gate] } };
  });
  return { session, wallId: near.id };
}

/** Tor `index` eines Mauerzugs entfernen (Panel). */
export function removeGate(s: Session, wallId: string, index: number): Session {
  return replaceItem(s, wallId, (item) => {
    if (item.kind !== 'wall') throw new DomainError('structure.kind', `${wallId} ist keine Mauer`);
    const gates = (item.plan.gates ?? []).filter((_, j) => j !== index);
    const { gates: _gates, ...rest } = item.plan;
    return { ...item, plan: gates.length > 0 ? { ...rest, gates } : rest };
  });
}

/** Tor nahe einer Zelle entfernen; ohne Tor dort bleibt die Sitzung unverändert. */
export function removeGateAt(s: Session, at: Cell): Session {
  for (const item of current(s).structures) {
    if (item.kind !== 'wall') continue;
    const i = (item.plan.gates ?? []).findIndex((g) => Math.hypot(g.at[0] - at[0], g.at[1] - at[1]) <= GATE_SNAP);
    if (i >= 0) return removeGate(s, item.id, i);
  }
  return s;
}

/** Kennzahlen fürs Panel. */
export function siteSummary(site: SiteState): { readonly w: number; readonly d: number; readonly zones: number; readonly sculpted: number } {
  const { w, d } = plotSize(site.plot);
  return { w, d, zones: site.zones.length, sculpted: site.sculpt.size };
}
