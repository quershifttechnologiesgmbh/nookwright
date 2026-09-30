import type { MoodVector, PaletteOverrides, Pose } from '@mcda/core';
import type {
  BuildingTypeOrigin, CellList, Floor, LinkId, Placement, PlacementId, RoomId, TargetVersion, VerticalLink, Volume, VolumeId,
} from './model.js';
import type { InteriorDecor } from './interiorDecor.js';
import type { StoryState } from './story.js';

/** Domain Events des Projekt-Aggregats. Rein serialisierbar (für Undo, Speichern, Lernen). */
export type ProjectEvent =
  | {
      readonly type: 'ProjectCreated';
      readonly id: string;
      readonly name: string;
      readonly seed: number;
      readonly themeId: string;
      readonly targetVersion: TargetVersion;
      readonly floor: Floor;
    }
  | {
      readonly type: 'RoomPainted';
      readonly roomId: RoomId;
      readonly floorIndex: number;
      readonly cells: CellList;
      readonly roomTypeId: string;
      /** Additiv (Baukörper): fehlt = `DEFAULT_VOLUME`. */
      readonly volumeId?: VolumeId;
      /** Additiv (Bautyp): fehlt = vom Nutzer gemalt. */
      readonly origin?: 'type' | 'user';
    }
  | { readonly type: 'RoomCellsLost'; readonly roomId: RoomId; readonly cells: CellList }
  /**
   * Additiv (W2-ED U4): Der Raum wächst um diese Zellen und BEHÄLT seine ID, Sperren und Einrichtung (`resizeRoom`).
   * Nachbarn haben die Zellen vorher per `RoomCellsLost`/`RoomSplit`/`RoomRemoved` abgegeben.
   */
  | { readonly type: 'RoomCellsGained'; readonly roomId: RoomId; readonly cells: CellList }
  /** Additiv (W2-ED U4): Raum fixieren – ein Bautyp-Neubau ersetzt ihn nicht, „Alle neu würfeln“ lässt ihn stehen. */
  | { readonly type: 'RoomFixed'; readonly roomId: RoomId; readonly fixed: boolean }
  /** Die Zellen von `parts` wandern aus `roomId` in neue Räume (gleicher Raumtyp). */
  | { readonly type: 'RoomSplit'; readonly roomId: RoomId; readonly parts: ReadonlyArray<{ readonly roomId: RoomId; readonly cells: CellList }> }
  | { readonly type: 'RoomRemoved'; readonly roomId: RoomId }
  | { readonly type: 'RoomTypeAssigned'; readonly roomId: RoomId; readonly roomTypeId: string }
  | { readonly type: 'RoomRerolled'; readonly roomId: RoomId; readonly rerollCount: number }
  /** Ersetzt alle automatischen, nicht gesperrten Platzierungen des Raums. */
  | { readonly type: 'RoomFurnished'; readonly roomId: RoomId; readonly placements: readonly Placement[] }
  /** Ergänzt automatische Platzierungen (z. B. Licht-Pass), ohne bestehende zu ersetzen. */
  | { readonly type: 'FurnishingSupplemented'; readonly roomId: RoomId; readonly placements: readonly Placement[] }
  /**
   * Additiv (F „Bereich neu einrichten“, WFC 3.2 „Modifying in Blocks“): nur ein Teilbereich des Raums wird neu
   * eingerichtet. `removed` (samt aufgesetzter Teile) entfällt, `placements` kommt dazu; alle übrigen Platzierungen des
   * Raums bleiben unverändert (eingefroren). `block` ist der gewählte Bereich (Zellen), nur zur Nachvollziehbarkeit.
   */
  | { readonly type: 'RoomBlockRefurnished'; readonly roomId: RoomId; readonly block: CellList; readonly removed: readonly PlacementId[]; readonly placements: readonly Placement[] }
  | { readonly type: 'PlacementAdded'; readonly placement: Placement }
  | { readonly type: 'PlacementMoved'; readonly placementId: PlacementId; readonly pose: Pose }
  | { readonly type: 'PlacementRemoved'; readonly placementId: PlacementId }
  /**
   * Additiv (W2-ED U5): Möbel tauschen bzw. Variante wechseln – gleiche ID und Lage, andere Komponente/Variante. Die
   * Platzierung gilt danach als von Hand gesetzt (bleibt beim Neu-Einrichten); bei anderer Komponente entfallen
   * aufgesetzte Teile (Kinder), weil ihre Andockstellen nicht mehr passen.
   */
  | { readonly type: 'PlacementSwapped'; readonly placementId: PlacementId; readonly componentId: string; readonly variantId?: string }
  | { readonly type: 'PlacementLocked'; readonly placementId: PlacementId }
  | { readonly type: 'PlacementUnlocked'; readonly placementId: PlacementId }
  | { readonly type: 'ThemeChanged'; readonly themeId: string }
  /**
   * Additiv (Q4, research/54 §3.3): Farbpalette des Projekts wechseln (`undefined` = keine Palette). Die Palette
   * färbt das Theme um, ohne seine Bauweise (`surfaces`, `decor`) zu ändern.
   */
  | { readonly type: 'PaletteChanged'; readonly paletteId?: string }
  /**
   * Additiv (Q5/P15, research/55 §2): Nutzungszustand des Projekts wechseln (`undefined` = kein Zustand, wie
   * bisher). Ändert nur Materialspuren der Hüllzellen, nie die Geometrie.
   */
  | { readonly type: 'StoryStateChanged'; readonly storyState?: StoryState }
  /**
   * Additiv (feat/theme-moods): Stimmung des Projekts setzen (`{}` = Theme-Vorgabe) oder abschalten (`undefined`,
   * wie bisher). Ändert nur weiche Größen, nie harte Regeln.
   */
  | { readonly type: 'MoodChanged'; readonly mood?: MoodVector }
  /**
   * Additiv (feat/int-decor): Innen-Deko-Stufe setzen (`'some'` | `'rich'`) oder abschalten (`undefined`, wie bisher).
   * Ändert nur, ob der Deko-Pass nach der Einrichtung zusätzliche auto-Platzierungen ergänzt.
   */
  | { readonly type: 'InteriorDecorChanged'; readonly interiorDecor?: InteriorDecor }
  /**
   * Additiv (W13-G): Paletten-Überschreibungen setzen (Normalform) oder löschen (`undefined` = Theme bzw. Palette wie
   * bisher). Ändert nur Materialien, nie die Geometrie.
   */
  | { readonly type: 'PaletteOverridesChanged'; readonly paletteOverrides?: PaletteOverrides }
  | { readonly type: 'TargetVersionChanged'; readonly targetVersion: TargetVersion }
  // Additiv (Etagen, Treppen, Umbenennen). Alte Historien ohne diese Events laden unverändert.
  /** Ersetzt den Namen aus `ProjectCreated` (früher wurde dort umgeschrieben). */
  | { readonly type: 'ProjectRenamed'; readonly name: string }
  /** Neue Etage über der obersten oder unter der untersten (Etagenabstand = lichte Höhe + 1). */
  | { readonly type: 'FloorAdded'; readonly floor: Floor }
  /** Entfernt die oberste oder unterste Etage; ihre Räume und Treppen sind vorher per Event entfernt. */
  | { readonly type: 'FloorRemoved'; readonly index: number }
  /**
   * Lichte Höhe (= Wandhöhe) einer Etage geändert. Der Boden der Etage bleibt; Etagen darüber (bzw. bei
   * Kellern: darunter) verschieben sich mit ihren Platzierungen. Automatische, ungesperrte Platzierungen der
   * Etage selbst entfallen (Decke/Kopffreiheit ändern sich) und werden neu eingerichtet.
   */
  | { readonly type: 'FloorHeightChanged'; readonly index: number; readonly height: number }
  | { readonly type: 'StairsPlaced'; readonly link: VerticalLink }
  | { readonly type: 'StairsRemoved'; readonly linkId: LinkId }
  // Additiv (Baukörper und Bautypen, research/19 §7.4, §7.6). Alte Historien laden unverändert.
  /** Neuer Baukörper (ID vom Aggregat, `v<n>`). */
  | { readonly type: 'VolumeAdded'; readonly volume: Volume }
  /**
   * Ersetzt alle Eigenschaften eines Baukörpers (auch des Standard-Baukörpers). Platzierungen seiner Räume folgen dem
   * Boden; ändert sich die lichte Höhe eines Raums, entfallen dessen automatische, ungesperrte Platzierungen.
   */
  | { readonly type: 'VolumeChanged'; readonly volume: Volume }
  /** Entfernt einen leeren Baukörper (das Aggregat hängt seine Räume vorher per `RoomVolumeAssigned` um). */
  | { readonly type: 'VolumeRemoved'; readonly volumeId: VolumeId }
  /** Raum wechselt den Baukörper (`DEFAULT_VOLUME` = Standard); Platzierungen folgen wie bei `VolumeChanged`. */
  | { readonly type: 'RoomVolumeAssigned'; readonly roomId: RoomId; readonly volumeId: VolumeId }
  /** Herkunft eines Raums (Nutzer-Änderung an einem Bautyp-Raum setzt `user`; Neu-Würfeln lässt ihn dann stehen). */
  | { readonly type: 'RoomOriginSet'; readonly roomId: RoomId; readonly origin: 'type' | 'user' }
  /**
   * Bautyp angewandt: ein Undo-Schritt, der alle Raum-, Etagen-, Baukörper- und Treppen-Events des Schritts enthält
   * (`events`, in Reihenfolge angewandt) und danach die Herkunft des Projekts setzt.
   */
  | { readonly type: 'BuildingTypeApplied'; readonly origin: BuildingTypeOrigin; readonly events: readonly ProjectEvent[] }
  /** Grundriss neu gewürfelt (gleicher Bautyp, `rerollCount` + 1); Aufbau wie `BuildingTypeApplied`. */
  | { readonly type: 'BuildingTypeRerolled'; readonly origin: BuildingTypeOrigin; readonly events: readonly ProjectEvent[] };

export type ProjectEventType = ProjectEvent['type'];
