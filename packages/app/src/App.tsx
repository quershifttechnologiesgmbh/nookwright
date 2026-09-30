import type { InteriorDecor, LinkId, PlacementId, RoomId, StoryState, VerticalLink } from '@mcda/blueprint';
import type { MoodVector, PaletteGroup, PaletteOverrides } from '@mcda/core';
import { timberDecor, type BuildingTypeDef, type Catalog } from '@mcda/catalog';
import { CellSet, type Cell, type Vec3 } from '@mcda/core';
import type { ExportFormat } from '@mcda/export';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LazyPipelineContext } from './adapters/browserContext.js';
import { downloadFile } from './adapters/download.js';
import { streamGzip, streamGzipAvailable } from './adapters/gzip.js';
import { browserStore } from './adapters/storage.js';
import type { CatalogLoad } from './catalogLoader.js';
import { FloorPlan } from './editor/FloorPlan.js';
import { clickNote, planWindow, type Tool } from './editor/grid.js';
import { bottomY, dragText, groupIds, offsetText, shiftBox, type FurnitureDrag, type Offset } from './editor/furnitureDrag.js';
import { hasShareFragment } from '@mcda/projectfile';
import { sessionFromShare, shareLosesEdits, shareUrlOf } from './shareLink.js';
import { DEFAULT_EXPORT_FORMAT, exportGuide, exportProject, exportReport, nothingToExport, placeHint, type GuideKind } from './exporting.js';
import { hasSurroundings } from './surroundings.js';
import { lightSession, lightStatus } from './lighting.js';
import { loadFromStore, parseProjectFile, projectFileName, saveToStore, serializeProject, storedInfo, type LoadResult } from './projectFile.js';
import {
  NO_SELECTION, ROOF_OWNER_PREFIX, exteriorPartInfo, exteriorPartText, houseBox, parentSelection, selectionBox, selectionFromOwner, selectionLevel, validSelection, type Selection,
} from './selection.js';
import { DEFAULT_STAIR_TOOL, rotateFacing, stairsAt, stairsPreview, type StairTool } from './stairs.js';
import { loadBundledTerrainStyles } from './adapters/terrainStyles.js';
import { DISCLAIMER, PRODUCT_NAME } from './brand.js';
import * as bt from './buildingTypes.js';
import { announceReady, announceRejected, embedOptions, receiveDescribe, type DescribeCommand, type EmbedOptions } from './embed.js';
import { BuildingTypePanel } from './ui/BuildingTypePanel.js';
import { Header } from './ui/Header.js';
import { quoinEffect } from './ui/styleNotes.js';
import { FloorPanel, HouseMorePanel, HousePanel, InspectorTabs, PlacementPanel, ProjectInfoDialog, RoofPanel, Crumb, type CrumbStep, type InspectorTab } from './ui/Inspector.js';
import { StageControls } from './ui/StageControls.js';
import { changeScope, scopeText, selectionChip } from './ui/changeScope.js';
import { BuildingTypeWizard, type DescribeRequest } from './ui/BuildingTypeWizard.js';
import { vocabularyOf } from '@mcda/engine/intent';
import { describeBuilding, designIterative, engineBaseUrl, withLocalConfidence } from './nlPrompt.js';
import { registryBlockInfo, textureMode, versionNote } from './textures/assets.js';
import { ownerAt, textureScene } from './textures/scene.js';
import { useTextures } from './textures/useTextures.js';
import { StairsPanel } from './ui/BuildingPanel.js';
import { ExteriorPartPanel } from './ui/ExteriorControls.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';
import { EmptyStart, SmallScreenHint } from './ui/EmptyStart.js';
import { ExportDialog } from './ui/ExportDialog.js';
import { HelpOverlay } from './ui/HelpOverlay.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { SITE_TOOL_OF, commandItems, type CommandItem } from './ui/commandSearch.js';
import { findText, flashControl, openMenu } from './ui/flashControl.js';
import { FOREIGN_SAVE_HINT, autosaveAction, autosaveLabel, floorRemovalText, hasContent, replaceConfirm, resumeLabel, resumeOffer, scheduleAutosave, shouldGuardUnload } from './ui/autosave.js';
import { ConfirmDialog } from './ui/ConfirmDialog.js';
import { FloorBar } from './ui/FloorBar.js';
import { circulation, hiddenVariants, paletteEditorView, rollPaletteOverrides, withBlockBanned, withBlockPreset, withBlockReplacement } from '@mcda/pipeline';
import { MaterialPanel } from './ui/MaterialPanel.js';
import { blockLabel } from './ui/materialRows.js';
import { paintNotes } from './ui/paintNotes.js';
import { translateRoomRefs, translateStairRefs } from './ui/hintText.js';
import { afterPaint } from './ui/afterPaint.js';
import { roomDisplayNumbers, roomLabel } from './ui/roomLabels.js';
import { accessHints, mergeAccessWarnings } from './ui/access.js';
import { durationTitle, lightAddedText, previewStatsText, stairsRemovedText, undoText } from './ui/statusText.js';
import { commandForKey, shortcutHint, shortcutSwallowed, type Command } from './ui/shortcuts.js';
import { BlockRefurnishRow, RoomPanel } from './ui/Sidebar.js';
import * as br from './blockRefurnish.js';
import { ModeSwitch, type EditMode } from './ui/SiteToolbar.js';
import { ToolRail } from './ui/Toolbar.js';
import { useSiteMode } from './ui/useSiteMode.js';
import {
  adjacentFloor, combineRange, effectivePreview, eyeLevelCut, floorItems, floorRange, ghostFloor, nextLayout, nextPreview, previewOptions,
  toggleDayNight, validFloor, viewSettingsFromQuery, type CutSettings, type FloorView, type PlanLayout, type PreviewLighting, type PreviewSource,
} from './ui/viewModel.js';
import * as uc from './usecases.js';
import * as pe from './placementEdit.js';
import { useWorld } from './useWorld.js';
import { sharedBlocksClient, type BlocksClient } from './adapters/blocksClient.js';
import { sharedPlayabilityClient } from './adapters/playabilityClient.js';
import { useBlockPreview } from './viewer/useBlockPreview.js';
import { buildBlockVoxels } from './viewer/blocks.js';
import type { ViewerScene } from './viewer/TextureViewer.js'; // nur Typ: deepslate bleibt im Lazy-Chunk
import { Viewer3D } from './viewer/Viewer3D.js';
import type { ViewportApi } from './viewer/viewport.js';
import { buildPreviewVoxels, countByLayer, cutFromSlider, cutRange, cutVoxels, type PreviewVoxel, type ViewMode } from './viewer/voxels.js';
import { eyeLevelCamera, mainDoorOf } from './viewer/eyeLevel.js';

/**
 * Beleuchteter Blockrenderer mit echten Modellen (deepslate) – eigener Chunk, erst in der Darstellung „Texturen“ geladen.
 * Assistent, Export und Hilfe bleiben bewusst im Hauptchunk: als Lazy-Chunks sparten sie nur 23 kB, und rolldown zog
 * die gemeinsamen Module in zusätzliche Start-Chunks – gleiche Startgröße, mehr Anfragen (Messung W1C_editor.md).
 */
const TextureViewer = lazy(() => import('./viewer/TextureViewer.js'));

/** Breite der Etagen-Leiste links über der 3D-Ansicht (Abstand 10 px + Leiste ≈ 56 px + Luft): Einpassen lässt sie frei. */
const FLOOR_BAR_INSET = 72;
const NO_VOXELS: readonly PreviewVoxel[] = [];

/** Browser-Adapter für einen frischen Projekt-Seed (die Domäne selbst würfelt nie). */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
};

/** Markenzeichen (isometrischer Block wie auf der Website, eigene Grafik). */
function BrandMark() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className="brand-mark">
      <polygon points="60,10 106,36 60,62 14,36" fill="#ffd27a" />
      <polygon points="14,36 60,62 60,112 14,86" fill="#ff9a3c" />
      <polygon points="106,36 60,62 60,112 106,86" fill="#c9562c" />
      <polygon points="72,80 88,71 88,94 72,103" fill="#2a1a12" />
      <polygon points="26,58 40,66 40,78 26,70" fill="#fff3d6" />
    </svg>
  );
}

export function App({ load, pipeline }: { load: CatalogLoad; pipeline: LazyPipelineContext | undefined }) {
  // Einbettung (W1): `?embed=1` im iframe der Website, `?describe=` als Deep-Link – einmal beim Start gelesen
  const embed = useMemo(() => embedOptions(location.search), []);
  return (
    <div className={`app${embed.embedded ? ' embedded' : ''}`}>
      {load.errors.length > 0 && (
        <div className="error-box" role="alert">
          <strong>Katalogfehler ({load.errors.length})</strong> – betroffene Dateien werden ignoriert:
          <ul>
            {load.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {load.catalog === undefined ? (
        <p className="fatal">Der Katalog konnte nicht geladen werden. {DISCLAIMER}</p>
      ) : (
        <Workbench catalog={load.catalog} load={load} pipeline={pipeline} embed={embed} />
      )}
    </div>
  );
}

interface Status {
  readonly text: string;
  readonly error: boolean;
}

function Workbench({ catalog, load, pipeline, embed }: { catalog: Catalog; load: CatalogLoad; pipeline: LazyPipelineContext | undefined; embed: EmbedOptions }) {
  // F-Ensemble: Kontext für die Hülle mit Brückentüren (`shellOf` löst den Verbindungsgraphen damit auf, wie die Engine)
  if (load.themeCatalog !== undefined) {
    uc.configureEnsemble({ catalog, themes: load.themeCatalog, ...(load.paletteCatalog !== undefined ? { palettes: load.paletteCatalog } : {}) }, loadBundledTerrainStyles().styles);
  }
  // Theme neuer Projekte: Standard-Theme, falls der ThemeCatalog es hat, sonst das erste
  const defaultTheme = load.themes.some((t) => t.id === uc.DEFAULT_THEME) ? uc.DEFAULT_THEME : (load.themes[0]?.id ?? uc.DEFAULT_THEME);
  const initial = useMemo(() => viewSettingsFromQuery(location.search), []);
  const [session, setSession] = useState<uc.Session>(() => uc.createSession(randomSeed(), 'Unbenannt', defaultTheme));
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  // W2-ED U2: Start mit „Auswählen“ – Malen ist ein bewusster Schritt (Raum-Werkzeug oder Leerzustand „Selbst malen“)
  const [tool, setTool] = useState<Tool>('select');
  const [paintType, setPaintType] = useState<string>(() => (catalog.roomTypeIds().includes(uc.DEFAULT_ROOM_TYPE) ? uc.DEFAULT_ROOM_TYPE : (catalog.roomTypeIds()[0] ?? uc.DEFAULT_ROOM_TYPE)));
  const [floorChoice, setFloor] = useState(uc.FLOOR_INDEX);
  const [floorView, setFloorView] = useState<FloorView>(initial.floors);
  const [stairTool, setStairTool] = useState<StairTool>(DEFAULT_STAIR_TOOL);
  const [view, setView] = useState<ViewMode>(initial.view);
  const [previewChoice, setPreviewChoice] = useState<PreviewSource | undefined>(initial.preview);
  const [layout, setLayout] = useState<PlanLayout>(initial.layout);
  /** Anordnung des eingeblendeten Grundrisses (neben bzw. über der 3D-Ansicht); „Grundriss“ blendet ihn so ein. */
  const [dock, setDock] = useState<Exclude<PlanLayout, '3d'>>(initial.layout === 'split' ? 'split' : 'overlay');
  /** Eigenschaftsspalte: Tab „Auswahl“ oder „Material“; „Mehr Haus-Optionen“ als eigene Ansicht. */
  const [inspTab, setInspTab] = useState<InspectorTab>('selection');
  const [houseMore, setHouseMore] = useState(false);
  const [typeDialog, setTypeDialog] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  /** Licht-Leiste der Darstellung „Texturen“ (über „Ansicht ▾“ einblendbar; Taste N wirkt immer). */
  const [lightBar, setLightBar] = useState(false);
  /** Rohwert des Schnitt-Reglers; `undefined` = ganz oben (kein Schnitt). */
  const [cutValue, setCutValue] = useState<number | undefined>(initial.cut);
  const [grid, setGrid] = useState(initial.grid);
  const [lighting, setLighting] = useState<PreviewLighting>(initial.lighting);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** W7-G (U8): Befehlssuche (Strg+K) über die Heimat-Tabelle. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  /** Beschreibung für den Assistenten von außen (Website `nookwright:describe`, Deep-Link `?describe=`). */
  const [describeRequest, setDescribeRequest] = useState<DescribeRequest | undefined>(undefined);
  const describeIdRef = useRef(0);
  /** Assistent aus dem Leerzustand geöffnet: Fokus ins Beschreibungsfeld. */
  const [focusDescribe, setFocusDescribe] = useState(false);
  /** Leerzustand „Wie willst du anfangen?“ weggeklickt („Selbst malen“). */
  const [startDismissed, setStartDismissed] = useState(false);
  const [format, setFormat] = useState<ExportFormat>(DEFAULT_EXPORT_FORMAT);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState<Status | undefined>(undefined);
  // F „Bereich neu einrichten“ (hinter Schalter `BLOCK_REFURNISH`, `?bereich=1`): Rechteck scharf, Hervorhebung, Rand
  const blockOn = useMemo(() => br.blockRefurnishEnabled(), []);
  const [blockRoom, setBlockRoom] = useState<RoomId | undefined>(undefined);
  const [blockHint, setBlockHint] = useState<{ readonly roomId: RoomId; readonly cells: CellSet } | undefined>(undefined);
  const [blockMargin, setBlockMargin] = useState<number>(br.BLOCK_MARGIN.standard);
  const store = useMemo(() => browserStore(), []);
  const [stored, setStored] = useState(() => storedInfo(store));
  /** W11-A „Treppen automatisch“ (Etagen-Leiste, Strg+K): Einstellung dieses Browsers, Standard an. */
  const [autoStairsOn, setAutoStairsOn] = useState(() => uc.autoStairsPref(store));
  const autoFlag = useMemo(() => ({ autoStairs: autoStairsOn }), [autoStairsOn]);
  /** Zeitpunkt/Fehler des letzten automatischen Speicherns (Nutzer-Review: Arbeit darf nicht verloren gehen). */
  const [autosave, setAutosave] = useState<{ readonly at?: number; readonly error?: string; readonly blocked?: string } | undefined>(undefined);
  /**
   * Zeitstempel (ISO), den **dieser Tab** zuletzt geschrieben oder geladen hat. Schreibt ein zweiter Tab
   * dazwischen, erkennt der Autosave das und überschreibt die neuere Arbeit nicht (Review 3: „Zwei Tabs“).
   */
  const saveBaseRef = useRef<string | undefined>(storedInfo(store)?.savedAt);
  /** Angebot, die zuletzt gespeicherte Sitzung fortzusetzen (nur wenn der Editor leer startet). */
  const [resumeDismissed, setResumeDismissed] = useState(false);
  /** Offene Rückfrage vor dem Ersetzen des Projekts (Bautyp-Assistent / leeres Projekt). */
  const [pendingReplace, setPendingReplace] = useState<{ readonly run: () => void; readonly title: string; readonly body: string; readonly confirmLabel?: string } | undefined>(undefined);
  /** Offene Rückfrage vor dem Löschen einer Etage mit Räumen. */
  const [pendingFloorRemove, setPendingFloorRemove] = useState<{ readonly index: number; readonly rooms: number; readonly run: () => void } | undefined>(undefined);
  /** Wurde seit dem Laden etwas geändert? Solange nicht, darf die gespeicherte Sitzung angeboten werden. */
  const [touched, setTouched] = useState(false);
  const viewportRef = useRef<ViewportApi | null>(null);
  /** Bearbeiten: Haus (Räume) oder Umgebung (Gelände, Bauwerke); Umgebung in Vorschau/Export zeigen. */
  const [mode, setMode] = useState<EditMode>('house');
  const [showAround, setShowAround] = useState(true);
  const runRef = useRef<(label: string, f: (s: uc.Session) => uc.Session) => uc.Session | undefined>(() => undefined);

  const project = session.project;
  const state = project.state;
  const version = state.targetVersion.name;
  const floor = validFloor(state, floorChoice);
  const styleKey = uc.styleKey(uc.shellStyle(session));
  // Stil über seinen Schlüssel merken: `shellStyle` liefert je Sitzung ein neues Objekt
  const style = useMemo(() => uc.shellStyle(session), [styleKey]);
  const theme = useMemo(
    () => uc.shellThemeOf(catalog, project.state.themeId, project.state.paletteId, project.state.paletteOverrides),
    [catalog, project.state.themeId, project.state.paletteId, project.state.paletteOverrides],
  );
  /** Rollen des Themes – die Palette gruppiert alles andere als „Möbel & Deko" (Review 3: keine Layer-IDs). */
  const themeRoles = useMemo(() => (theme === undefined ? undefined : new Set(Object.keys(theme.roles))), [theme]);
  const shell = useMemo(() => uc.shellOf(project, style, theme), [project, style, theme]);
  // Außen-Deko (X1): derselbe Plan für Panel, Rollen-Vorschau, Gelände, Blöcke und Export (zwischengespeichert)
  const exterior = useMemo(() => uc.exteriorOf(project, catalog, style), [project, catalog, style]);
  const groundExterior = useMemo(() => uc.groundExterior(exterior), [exterior]);
  const siteMode = useSiteMode({
    session,
    shell,
    active: mode === 'site',
    show: showAround,
    run: (l, f) => runRef.current(l, f),
    onStatus: (text, error = false) => setStatus({ text, error }),
    exterior: groundExterior,
    catalog,
  });
  const views = useMemo(() => uc.placedViews(state, catalog), [state, catalog]);
  const exteriorViews = useMemo(() => uc.exteriorViews(exterior, catalog), [exterior, catalog]);
  const lightIds = useMemo(() => uc.lightPlacementIds(project), [project]);
  const textures = useTextures(version);
  const texState = textures.state;
  const texMode = textureMode(texState, textures.canReadJar);
  const pipelineOk = pipeline !== undefined;
  const options = previewOptions(pipelineOk, texMode);
  const source = effectivePreview(previewChoice, texState, pipelineOk);
  // Blöcke nur bei Bedarf (Blöcke, Texturen oder Export-Dialog), entprellt und erst nach dem Licht-Pass
  // W3-BL: auch der Tab „Material“ braucht die Blöcke (Materialliste, Ersatz gesperrter Blöcke)
  // W14: „Vorschau: Blöcke“ rechnet ein Web Worker (gleiche Funktionen, Projektstand als Projektdatei) – der Haupt-Thread
  // blieb sonst nach jeder Änderung 0,4–0,9 s (schwacher Laptop: 2–3 s) stehen. Ohne Worker bzw. bei dessen Ausfall wie bisher.
  // Die Worker starten kurz nach dem Laden (nicht im kritischen Pfad: Hauptchunk und Plattform-Daten zuerst); bis dahin
  // und für leere Projekte rechnet der Haupt-Thread wie bisher. Der Spielbarkeits-Worker des Assistenten liest dabei
  // schon den Katalog, während der Nutzer den Leerzustand liest.
  const [blocksClient, setBlocksClient] = useState<BlocksClient | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      setBlocksClient(sharedBlocksClient());
      sharedPlayabilityClient();
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  // Export-Dialog und Tab „Material“ nutzen dieselbe Rechnung (Prüfbericht, Materialliste und Datei vom Worker)
  const preview = useBlockPreview(session, blocksClient, (source === 'blocks' || exportOpen || inspTab === 'material') && pipelineOk && !session.needsLight, styleKey, siteMode.world?.state);
  const blocksInWorker = blocksClient !== undefined && !preview.failed;
  const world = useWorld(project, pipeline, ((source !== 'roles' && !(source === 'blocks' && blocksInWorker)) || ((exportOpen || inspTab === 'material') && !blocksInWorker)) && !session.needsLight, style, 250, siteMode.world);
  const roleVoxels = useMemo(() => {
    const house = buildPreviewVoxels(shell, views, exteriorViews);
    return siteMode.voxels.length === 0 ? house : [...house, ...siteMode.voxels];
  }, [shell, views, exteriorViews, siteMode.voxels]);
  // Bis der Worker Quader zum aktuellen Stand liefert, gelten die des Haupt-Threads, wenn sie aktueller sind (Worker gerade
  // gestartet, Tab „Material“ eben geschlossen) – kein Flackern, kein Rücksprung auf einen älteren Stand
  const needMain = !blocksInWorker || preview.voxels === undefined || (!preview.current && world.current);
  const mainBlockVoxels = useMemo(() => (!needMain || world.world === undefined ? NO_VOXELS : buildBlockVoxels(world.world)), [world.world, needMain]);
  const blockVoxels = needMain && mainBlockVoxels.length > 0 ? mainBlockVoxels : blocksInWorker ? (preview.voxels ?? NO_VOXELS) : mainBlockVoxels;
  const blocksBusy = blocksInWorker ? preview.busy : world.busy;
  // W11-B (R6): solange die ersten Blöcke eines Projekts noch berechnet werden, zeigt die Ansicht die Rollen-Vorschau
  // (sofort da) statt eines leeren Rasters; danach bleiben während Updates die bisherigen Blöcke stehen (kein Flackern)
  const voxels = source === 'blocks' && !(blockVoxels.length === 0 && blocksBusy) ? blockVoxels : roleVoxels;
  const range = useMemo(() => cutRange(shell), [shell]);
  const cutY = cutValue === undefined ? undefined : cutFromSlider(cutValue, range);
  // Etagen-Ansicht: Schnitt folgt der aktiven Etage („bis aktive“ / „nur aktive“), der Regler schneidet zusätzlich
  const floorYs = useMemo(() => floorRange(state, floor, floorView), [state, floor, floorView]);
  const yRange = useMemo(() => combineRange(cutY, floorYs), [cutY, floorYs]);
  const activeFloorDef = uc.floorOf(state, floor);
  const ghost = ghostFloor(state, floor);
  const ceilingY = activeFloorDef === undefined ? undefined : activeFloorDef.y0 + activeFloorDef.height + 1;
  const visibleVoxels = useMemo(() => cutVoxels(voxels, yRange.maxY, yRange.minY), [voxels, yRange]);
  /** Statuszeile: Zeitpunkt des letzten automatischen Speicherns (oder Grund, warum nicht). */
  const autosaveText = autosaveLabel(autosave?.at, autosave?.error, store !== undefined, autosave?.blocked);
  // Erschließung (Laufwege, Treppenzugang) gehört in die Export-Prüfung: vorher meldete sie „Keine Fehler“,
  // obwohl OG und Keller ohne Treppe dastanden (Review 3). Zusammengeführt mit `accessHints` weiter unten.
  const circulationReport = useMemo(() => (shell.cells.length === 0 ? undefined : circulation(shell, project)), [shell, project]);
  const circulationWarnings = useMemo(() => circulationReport?.warnings ?? [], [circulationReport]);
  const themeName = load.themes.find((t) => t.id === state.themeId)?.name ?? state.themeId;
  // F1-Deko: das Theme (Fachwerk) schlägt sie vor; der Schalter im Panel übersteuert die Vorgabe
  // Unbekanntes Theme (z. B. Projektdatei aus einer neueren Version): NICHT ungeprüft auflösen – das ließ die
  // App mit einem schwarzen Bildschirm abstürzen (Review). `shellThemeOf` prüft die ID gegen den Katalog.
  const resolvedTheme = useMemo(() => uc.shellThemeOf(catalog, state.themeId, state.paletteId), [catalog, state.themeId, state.paletteId]);
  const themeDecorate = useMemo(() => resolvedTheme !== undefined && timberDecor(resolvedTheme) !== undefined, [resolvedTheme]);
  const quoins = useMemo(() => quoinEffect(resolvedTheme), [resolvedTheme]);
  // R1-15: leeres Projekt → „Exportieren …“ gesperrt mit Grund (statt eines Dialogs mit Rot und Grün zugleich)
  const exportBlocked = pipeline === undefined ? 'Export gesperrt: kein gültiges Theme im Katalog' : nothingToExport(state, hasSurroundings(session.surroundings));
  const sel = useMemo(() => validSelection(selection, state, exterior), [selection, state, exterior]);
  const exteriorPart = useMemo(() => exteriorPartInfo(sel, exterior, catalog), [sel, exterior, catalog]);
  // Gauben der Hülle (Hinweis „keine Gaube passt“); ohne Räume keine Aussage
  const dormerCount = useMemo(() => (project.state.rooms.length === 0 ? undefined : uc.dormerCount(project, style, catalog)), [project, style, catalog]);
  const selectedRoom = sel.roomId === undefined ? undefined : state.rooms.find((r) => r.id === sel.roomId);
  const selectedLink = sel.linkId === undefined ? undefined : state.links.find((l) => l.id === sel.linkId);
  // F „Bereich neu einrichten“: Zonen des gewählten Raums; andere Auswahl → Rechteck und Hervorhebung zurücksetzen
  const roomZones = useMemo(
    () => (blockOn && selectedRoom !== undefined ? br.roomZonesOf(session, catalog, selectedRoom.id) : []),
    [blockOn, session, catalog, selectedRoom],
  );
  useEffect(() => {
    setBlockRoom(undefined);
    setBlockHint(undefined);
  }, [sel.roomId, sel.placementId]);
  const highlight = useMemo(() => selectionBox(sel, state, views, exterior, shell), [sel, state, views, exterior, shell]);
  /** W7-G: laufendes Ziehen eines Möbels in 3D – der Auswahlrahmen zeigt die Zielposition. */
  const [dragShift, setDragShift] = useState<Offset | undefined>(undefined);
  const shownHighlight = useMemo(() => {
    // F: hervorgehobener Bereich (Zone unter dem Zeiger bzw. zuletzt neu eingerichtet) als Rahmen in 3D
    const info = blockHint === undefined ? undefined : shell.rooms.get(blockHint.roomId);
    const b = blockHint?.cells.bounds();
    if (info !== undefined && b !== undefined) return { min: [b.minX, info.baseY, b.minZ] as Vec3, max: [b.maxX, info.baseY + info.height - 1, b.maxZ] as Vec3 };
    return dragShift === undefined ? highlight : shiftBox(highlight, dragShift);
  }, [highlight, dragShift, blockHint, shell]);
  /** Tauschen gegen (W2-ED U5): bis zu drei passende Alternativen des gewählten Möbels (geprüft an derselben Stelle). */
  const swapChoices = useMemo(
    () => (sel.placementId === undefined || mode !== 'house' ? [] : pe.swapOptions(session, catalog, sel.placementId)),
    [session, catalog, sel.placementId, mode],
  );
  /** Einpassen aufs Haus (W2-ED U3): im Modus Haus der Quader der Hülle, im Modus Umgebung alles. */
  const house = useMemo(() => houseBox(shell), [shell]);
  const fitBox = mode === 'house' ? house : undefined;
  /** Dachzellen (Weltposition): ein Klick darauf wählt das Dach (die Materialisierung führt sie als `shell:<Raum>`). */
  const roofKeys = useMemo(() => new Set(shell.cells.filter((c) => c.kind === 'roof').map((c) => c.pos.join(','))), [shell]);
  /** Grundriss-Ausschnitt aufs Haus (alle Etagen, Rand zum Anbauen). */
  const planWin = useMemo(() => planWindow(state.rooms.flatMap((r) => r.cells.toArray()), uc.GRID), [state.rooms]);
  // Registry der Zielversion für fehlende Block-Properties im Texturrenderer (geladen, sobald Blöcke berechnet sind)
  const platform = world.world !== undefined ? pipeline?.loaded(version)?.platform(version) : undefined;
  const registry = platform?.registry;
  const blockInfo = useMemo(() => (registry === undefined ? undefined : registryBlockInfo(registry)), [registry]);
  /** Neues Projekt (Vorlage, Laden) = neuer Seed → die 3D-Ansicht passt die Kamera einmal an. */
  const seed = state.seed;
  const spawnCells = useMemo(() => world.world?.materialized.light.darkCells.map((d) => d.pos as Vec3), [world.world]);
  const texScene = useMemo((): ViewerScene | undefined => {
    const w = world.world;
    if (w === undefined) return undefined;
    const s = textureScene(w, view, yRange.maxY, { minY: yRange.minY, ceilingY });
    const pick = (pos: Vec3): string | undefined => {
      const o = ownerAt(w, view, s.maxY, pos, yRange.minY);
      return o !== undefined && o.startsWith('shell:') && roofKeys.has(pos.join(',')) ? `${ROOF_OWNER_PREFIX}${o.slice(6)}` : o;
    };
    return { ...s, spawnCells, ownerAt: pick, fitKey: seed, ...(fitBox !== undefined ? { fitBox } : {}) };
  }, [world.world, view, yRange, ceilingY, spawnCells, seed, roofKeys, fitBox]);

  // Aktionen laufen synchron; die Ref hält die aktuelle Sitzung für Tastatur- und Klick-Handler.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  /** Licht-Pass sofort, wenn die Plattform-Daten der Zielversion schon geladen sind (sonst per Effekt unten). */
  const lightNow = useCallback(
    (next: uc.Session): uc.Session => {
      if (!next.needsLight || pipeline === undefined) return next;
      const ctx = pipeline.loaded(next.project.state.targetVersion.name);
      return ctx === undefined ? next : lightSession(next, ctx).session;
    },
    [pipeline],
  );

  /** W11-B: Meldung je Undo-Schritt (Schlüssel: Eintrag in `past`), damit Rückgängig/Wiederholen sie nennen können. */
  const actionLabelsRef = useRef(new WeakMap<object, string>());
  const run = useCallback(
    (label: string, f: (s: uc.Session) => uc.Session, opts: { stairsNote?: boolean } = {}): uc.Session | undefined => {
      const t0 = performance.now();
      try {
        const prev = sessionRef.current;
        const raw = f(prev);
        if (raw === prev) {
          setStatus({ text: `${label}: keine Änderung`, error: false });
          return raw;
        }
        // Treppen, die die Aktion ungültig gemacht hat (Malen, Radieren, Wandhöhe), entfernt die Domäne mit. Nicht bei
        // Rückgängig/Wiederholen und Projektwechsel (R1-10); verglichen vor dem Licht-Pass (der setzt keine Treppen).
        const gone = opts.stairsNote === false ? [] : uc.stairsRemovedBy(prev, raw);
        const next = lightNow(raw);
        const ms = Math.round(performance.now() - t0);
        sessionRef.current = next;
        setSession(next);
        setTouched(true);
        // Schlüssel des Schritts: neuer Eintrag in `past` bzw. beim Projektwechsel die alte Sitzung (`previous`)
        const step = next.past.length > prev.past.length ? next.past[next.past.length - 1] : next.previous !== prev.previous ? next.previous : undefined;
        if (step !== undefined && !actionLabelsRef.current.has(step)) actionLabelsRef.current.set(step, label);
        const added = !next.needsLight && next.light !== undefined && next.light.added > 0 && next.light !== prev.light ? ` · ${lightAddedText(next.light.added)}` : '';
        const slow = ms > 1000 ? ' · große Räume brauchen beim Einrichten länger' : ''; // W8-F: ohne Laufzeit im Text
        const note = gone.length > 0 ? ` · ${stairsRemovedText(gone, uc.floorLabel)}` : '';
        // W11-A: automatisch gesetzte Treppen (bzw. keine Stelle) derselben Aktion – nicht bei Rückgängig/Wiederholen
        const auto = raw.autoStairsNote !== undefined && raw.project !== prev.project && !uc.historyOrSwitch(prev, raw) ? ` · ${raw.autoStairsNote}` : '';
        // W2-ED U4: Umfang statt Laufzeit – was neu gebaut wurde und was blieb (nicht bei Projektwechsel/Undo)
        const scope = opts.stairsNote === false || prev.project.state.id !== next.project.state.id ? '' : ` · ${scopeText(changeScope(prev.project.state, next.project.state), (id) => {
          const r = next.project.state.rooms.find((x) => x.id === id);
          if (r === undefined) return id;
          let name = r.roomTypeId;
          try {
            name = catalog.roomType(r.roomTypeId).name;
          } catch {
            // unbekannter Raumtyp: ID
          }
          return roomLabel(name, roomDisplayNumbers(next.project.state.rooms, r.floorIndex).get(id));
        })}`;
        setStatus({ text: `${label}${scope}${auto}${added}${note}${slow}`, error: gone.length > 0 || /Keine Treppe/.test(auto) });
        return next;
      } catch (e) {
        // Auftrag 3: Domänenmeldungen nennen Raum-IDs – hier werden daraus Anzeigenamen („Wohnstube · 3 (1. OG)“)
        setStatus({ text: roomRefsRef.current(uc.errorMessage(e)), error: true });
        return undefined;
      }
    },
    [lightNow, catalog],
  );
  runRef.current = run;
  /** Wandelt `Raum r7` in Domänenmeldungen in Nutzersprache um (Anzeigename + Etage). Wird unten gesetzt. */
  const roomRefsRef = useRef<(text: string) => string>((text) => text);
  // W11-B (R6): „Augenhöhe“ zeigt das Haus mit Dach; die erste eigene Kamerabewegung bzw. „Einpassen“ stellt den
  // vorherigen Schnitt wieder her. Stellt der Nutzer selbst Dach/Etagen/Schnitt ein, gilt seine Wahl (nichts zurück).
  const eyeRestoreRef = useRef<CutSettings | undefined>(undefined);
  const leaveEyeCut = (): void => {
    const r = eyeRestoreRef.current;
    if (r === undefined) return;
    eyeRestoreRef.current = undefined;
    setView(r.view);
    setFloorView(r.floors);
    setCutValue(r.cut);
  };
  const chooseView = (v: ViewMode): void => {
    eyeRestoreRef.current = undefined;
    setView(v);
  };

  // Plattform-Daten der Zielversion früh laden: Der Licht-Pass braucht sie nach jeder Aktion.
  useEffect(() => {
    void pipeline?.ready(version).catch((e: unknown) => setStatus({ text: `Plattform-Daten ${version} nicht ladbar: ${uc.errorMessage(e)}`, error: true }));
  }, [pipeline, version]);

  // Licht-Pass nachholen, wenn er bei der Aktion noch nicht laufen konnte (Daten luden noch, Projekt geladen, Undo …)
  useEffect(() => {
    if (!session.needsLight || pipeline === undefined) return;
    let cancelled = false;
    pipeline.ready(session.project.state.targetVersion.name).then(
      (ctx) => {
        if (cancelled || sessionRef.current !== session) return;
        const lit = lightSession(session, ctx).session;
        sessionRef.current = lit;
        setSession(lit);
        if (lit.light?.error !== undefined) setStatus({ text: `Licht-Pass fehlgeschlagen: ${lit.light.error}`, error: true });
        else if ((lit.light?.added ?? 0) > 0) setStatus({ text: `Licht ergänzt: +${lit.light!.added}`, error: false });
      },
      (e: unknown) => {
        if (cancelled || sessionRef.current !== session) return;
        const failed: uc.Session = { ...session, needsLight: false, light: { added: 0, darkCells: 0, warnings: [], notes: [], error: uc.errorMessage(e) } };
        sessionRef.current = failed;
        setSession(failed);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [session, pipeline]);

  // Darstellung „Texturen“: Assets beim ersten Öffnen laden
  const ensureTextures = textures.ensureLoaded;
  useEffect(() => {
    if (source === 'textures' && texState.kind === 'available') ensureTextures();
  }, [source, texState, ensureTextures]);

  // Unerwartete Fehler sichtbar machen (statt nur in der Konsole)
  useEffect(() => {
    const onError = (e: ErrorEvent) => setStatus({ text: `Unerwarteter Fehler: ${e.message}`, error: true });
    const onRejection = (e: PromiseRejectionEvent) => setStatus({ text: `Unerwarteter Fehler: ${uc.errorMessage(e.reason)}`, error: true });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // ------------------------------------------------------------------ Aktionen
  /** Werkzeug wählen; Zeichenwerkzeuge blenden den Grundriss ein (3D groß, Grundriss einblendbar – W2-ED U2). */
  const chooseTool = (t: Tool): void => {
    setTool(t);
    if (t !== 'select' && layout === '3d') setLayout(dock);
  };
  const onPaint = (rect: uc.Rect) => {
    const before = sessionRef.current.project.state;
    let roomId: RoomId | undefined;
    const next = run('Raum gemalt und eingerichtet', (s) => {
      const r = uc.paintRect(s, catalog, rect, paintType, floor, autoFlag);
      roomId = r.roomId;
      return r.session;
    });
    if (roomId !== undefined) setSelection({ roomId });
    // Review 3: Ein zu kleiner Raum bekam stillschweigend keine Möbel, ein übermaltes Rechteck schluckte den
    // alten Raum ohne Hinweis. Beides steht jetzt in der Statuszeile (Rückgängig holt den alten Raum zurück).
    if (next !== undefined && roomId !== undefined) {
      const notes = paintNotes(before, next.project.state, roomId, catalog);
      if (notes.length > 0) setStatus({ text: `Raum gemalt und eingerichtet · ${[...notes, ...(next.autoStairsNote !== undefined ? [next.autoStairsNote] : [])].join(' · ')}`, error: true });
    }
  };
  const onErase = (rect: uc.Rect) => run('Radiert', (s) => uc.eraseRect(s, catalog, rect, floor, autoFlag));
  const onSelectCell = (cell: Cell) => {
    const st = sessionRef.current.project.state;
    const link = stairsAt(st, floor, cell);
    if (link !== undefined) {
      setSelection({ linkId: link.id });
      return;
    }
    const room = uc.roomAt(st, cell[0], cell[1], floor);
    setSelection(room === undefined ? NO_SELECTION : { roomId: room.id });
    const hinweis = clickNote(tool, room !== undefined);
    if (hinweis !== undefined) setStatus({ text: hinweis, error: false });
  };
  const previewStairs = useCallback((cell: Cell) => {
    const pv = stairsPreview(state, catalog, { floor, origin: cell, ...stairTool });
    // W11-B: Grund des Geists in Nutzersprache (keine Treppen-ID, Etagenname statt Etagenzahl)
    return pv.reason === undefined ? pv : { ...pv, reason: roomRefsRef.current(pv.reason) };
  }, [state, catalog, floor, stairTool]);
  const onPlaceStairs = (cell: Cell) => {
    // Ohne Etage darüber meldete die Domäne „Treppe braucht die Etagen 1 und 2“ – die Vorschau sagt es in Etagennamen
    const st = sessionRef.current.project.state;
    if (!st.floors.some((f) => f.index === floor + 1)) {
      const why = stairsPreview(st, catalog, { floor, origin: cell, ...stairTool }).reason;
      if (why !== undefined) {
        setStatus({ text: why, error: true });
        return;
      }
    }
    let linkId: LinkId | undefined;
    const next = run(
      'Treppe gesetzt, Räume neu eingerichtet',
      (s) => {
        const r = uc.placeStairs(s, catalog, { floor, origin: cell, ...stairTool });
        linkId = r.linkId;
        return r.session;
      },
      { stairsNote: false },
    );
    if (next !== undefined && linkId !== undefined) setSelection({ linkId });
  };
  const onRemoveStairsAt = (cell: Cell) => {
    const link = stairsAt(sessionRef.current.project.state, floor, cell);
    if (link === undefined) setStatus({ text: 'Hier ist keine Treppe (Rechtsklick auf Stufen oder Deckenöffnung entfernt sie)', error: false });
    else onRemoveStairs(link.id);
  };
  const onRemoveStairs = (id: LinkId) => {
    run(`Treppe ${id} entfernt`, (s) => uc.removeStairs(s, catalog, id), { stairsNote: false });
  };
  const onChangeStairs = (link: VerticalLink, patch: Parameters<typeof uc.changeStairs>[3]) => {
    let linkId: LinkId | undefined;
    const next = run(
      'Treppe geändert',
      (s) => {
        const r = uc.changeStairs(s, catalog, link.id, patch);
        linkId = r.linkId;
        return r.session;
      },
      { stairsNote: false },
    );
    if (next !== undefined && linkId !== undefined) setSelection({ linkId });
  };
  const onAddFloor = (below: boolean) => {
    let index: number | undefined;
    const next = run(below ? 'Keller angelegt' : 'Etage angelegt', (s) => {
      const r = uc.addFloor(s, catalog, { below });
      index = r.floorIndex;
      return r.session;
    });
    if (next !== undefined && index !== undefined) {
      const newIndex = index;
      setFloor(newIndex);
      setSelection(NO_SELECTION);
      const ref = ghostFloor(next.project.state, newIndex);
      const stairsFrom = below ? newIndex : newIndex - 1;
      setStatus({
        text: `${uc.floorLabel(newIndex)} angelegt – jetzt dort Räume malen${ref !== undefined ? ` (gestrichelt: ${uc.floorLabel(ref)})` : ''}, dann auf ${uc.floorLabel(stairsFrom)} eine Treppe (${shortcutHint('tool.stairs')}) nach oben setzen`,
        error: false,
      });
    }
  };
  const onRemoveFloor = (index: number) => {
    const apply = (): void => {
      run(`${uc.floorLabel(index)} entfernt`, (s) => uc.removeFloor(s, catalog, index));
    };
    // Eine Etage mit Räumen wird nicht mit einem Klick gelöscht (Review 3: „löscht die Etage samt allen Räumen
    // mit einem Klick und ohne Rückfrage“). Leere Etagen verschwinden weiterhin direkt.
    const betroffen = state.rooms.filter((r) => r.floorIndex === index).length;
    if (betroffen === 0) apply();
    else setPendingFloorRemove({ index, rooms: betroffen, run: apply });
  };
  const onFloorHeight = (index: number, height: number) => run(`Wandhöhe ${uc.floorLabel(index)}: ${height}`, (s) => uc.setFloorHeight(s, catalog, index, height, autoFlag));
  const onStyle = (patch: Partial<uc.ShellStyle>) => {
    const what = uc.styleChangeLabel(uc.shellStyle(sessionRef.current), patch);
    run(what, (s) => uc.setShellStyle(s, patch, catalog));
  };
  const onDensity = (roomId: RoomId, d: number) => run(`Dichte ${Math.round(d * 100)} % – neu eingerichtet`, (s) => uc.setRoomDensity(s, catalog, roomId, d));
  // W3-BL: Blöcke sperren und ersetzen (Tab „Material“) – eine Einstellung wie das Dach, ein Undo-Schritt
  const rulesKey = session.blockRules === undefined ? '' : JSON.stringify(session.blockRules);
  const hiddenCount = useMemo(() => hiddenVariants(catalog, session.blockRules).length, [catalog, rulesKey]);
  const onPreset = (on: boolean) => {
    run(on ? 'Nur leicht farmbare Blöcke: schwer farmbare Blöcke gesperrt und ersetzt' : 'Nur leicht farmbare Blöcke aus', (s) => uc.setBlockRules(s, catalog, withBlockPreset(s.blockRules, 'easy_farm', on)));
  };
  const onBan = (block: string, banned: boolean) => {
    run(banned ? `${blockLabel(block)} gesperrt – der Generator ersetzt ihn` : `${blockLabel(block)} wieder erlaubt`, (s) => uc.setBlockRules(s, catalog, withBlockBanned(s.blockRules, block, banned)));
  };
  const onReplace = (block: string, to: string | undefined) => {
    run(to === undefined ? `${blockLabel(block)}: Ersatz automatisch` : `${blockLabel(block)} → ${blockLabel(to)}`, (s) => uc.setBlockRules(s, catalog, withBlockReplacement(s.blockRules, block, to)));
  };
  // W13-G: Blockpalette vor dem Generieren – Familie je Bauteil, Tausch, neu würfeln (ein Undo-Schritt je Änderung). Die
  // Vorschau wechselt dafür auf Blöcke (in der Rollen-Ansicht sähe man keine Blockfarben).
  const paletteCtx = useMemo(
    () => (load.themeCatalog === undefined ? undefined : { themes: load.themeCatalog, ...(load.paletteCatalog !== undefined ? { palettes: load.paletteCatalog } : {}) }),
    [load.themeCatalog, load.paletteCatalog],
  );
  const paletteFamilies = pipeline?.loaded(version)?.platform(version).families;
  const paletteView = useMemo(
    () => (paletteCtx === undefined || inspTab !== 'material' ? undefined : paletteEditorView(paletteCtx, state.themeId, state.paletteId, state.paletteOverrides, paletteFamilies)),
    [paletteCtx, inspTab, state.themeId, state.paletteId, state.paletteOverrides, paletteFamilies],
  );
  const showBlocks = () => {
    if (source === 'roles' && pipelineOk) setPreviewChoice('blocks');
  };
  const onPaletteOverrides = (next: PaletteOverrides | undefined, what: string) => {
    showBlocks();
    run(`Blockpalette: ${what}`, (s) => uc.setPaletteOverrides(s, catalog, next));
  };
  const onPaletteRoll = (locked: readonly PaletteGroup[], seed: number) => {
    if (paletteCtx === undefined) return;
    showBlocks();
    const st = sessionRef.current.project.state;
    const next = rollPaletteOverrides(paletteCtx, st.themeId, st.paletteId, st.paletteOverrides, paletteFamilies, seed, locked);
    run(`Blockpalette neu gewürfelt (Wurf ${seed}${locked.length > 0 ? `, ${locked.length} gesperrt` : ''})`, (s) => uc.setPaletteOverrides(s, catalog, next));
  };
  const onCopyMaterials = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setStatus({ text: 'Materialliste kopiert', error: false }),
      () => setStatus({ text: 'Kopieren nicht möglich (Zwischenablage gesperrt)', error: true }),
    );
  };

  // P07: verbindlicher Mittelgang – Einstellung wie die Dichte, wirkt auf alle Räume. Den Solverbefund
  // („Mittelgang verbindlich …“) zeigt die Statuszeile, sonst stünde er nur in den Hinweisen des Raums.
  const onMinAisle = (on: boolean) => {
    const label = on ? 'Mittelgang verbindlich – alle Räume neu eingerichtet' : 'Mittelgang nicht mehr verbindlich – alle Räume neu eingerichtet';
    const next = run(label, (s) => uc.setMinAisle(s, catalog, on));
    if (next === undefined) return;
    const findings = [...next.warnings.entries()].flatMap(([id, w]) => w.filter((x) => x.startsWith('Mittelgang verbindlich')).map((x) => `${id}: ${x}`));
    if (findings.length > 0) setStatus({ text: `${label} · ${findings.join(' · ')}`, error: true });
  };
  // Q5/P15: Nutzungszustand – dieselbe Geometrie, andere material-/ortsbezogene Spuren; „ohne“ wählt ab (bitgleich)
  // feat/theme-moods: Stimmung – aus = wie bisher; an = Theme-Vorgabe, Regler überschreiben je Achse
  // W8-H: ohne Wirkung (Theme ohne Stimmung, kein Regler verschoben) sagt die Statuszeile das, statt „geändert“
  const onMood = (mood: MoodVector | undefined) => run(uc.moodChangeLabel(catalog, sessionRef.current.project.state, mood), (s) => uc.setMood(s, catalog, mood));
  // W11-B: sagen, wo man den Zustand sieht (im Schnitt „Dach ab“ von oben änderte sich scheinbar nichts)
  const onInteriorDecor = (level: InteriorDecor | undefined) => run(`Innen-Deko: ${uc.interiorDecorLabel(level)}`, (s) => uc.setInteriorDecor(s, catalog, level));
  const onStoryState = (storyState: StoryState | undefined) => run(`Nutzungszustand: ${uc.storyStateLabel(storyState)}${storyState === undefined ? '' : ' – wirkt auf Außenwände und Dach (Ansicht „Komplett“)'}`, (s) => uc.setStoryState(s, catalog, storyState));
  const onRemovePlacement = (pid: PlacementId) => run('Möbel entfernt', (s) => uc.removePlacement(s, catalog, pid));
  // W7-G: Möbel mit der Maus ziehen (Grundriss und 3D) – dieselbe Passt-Prüfung wie die Pfeiltasten, ein Undo-Schritt
  const movePreview = useCallback((id: PlacementId, dx: number, dz: number) => pe.nudgeProblem(sessionRef.current, catalog, id, dx, dz), [catalog]);
  const onMovePlacement = useCallback(
    (id: PlacementId, dx: number, dz: number) => {
      const roomId = sessionRef.current.project.state.placements.find((p) => p.id === id)?.roomId;
      if (roomId !== undefined) setSelection({ roomId, placementId: id });
      run(`Möbel verschoben (${offsetText([dx, dz])})`, (s) => pe.nudgePlacement(s, catalog, id, dx, dz));
    },
    [run, catalog],
  );
  const selectedView = sel.placementId === undefined ? undefined : views.find((v) => v.placement.id === sel.placementId);
  const furnitureDrag = useMemo((): FurnitureDrag | undefined => {
    if (mode !== 'house' || selectedView === undefined) return undefined;
    const id = selectedView.placement.id;
    const name = selectedView.def.name ?? selectedView.def.id;
    return {
      placementId: id,
      grab: groupIds(state, id),
      y: bottomY(selectedView),
      onPreview: (off) => {
        setDragShift(off);
        if (off !== undefined) setStatus({ text: dragText(name, off, off[0] === 0 && off[1] === 0 ? undefined : movePreview(id, off[0], off[1])), error: false });
      },
      onDrop: (dx, dz) => onMovePlacement(id, dx, dz),
    };
  }, [mode, selectedView, state, movePreview, onMovePlacement]);
  const sitePick = siteMode.onPick;
  const onPick = useCallback(
    (owner: string | undefined) => {
      if (sitePick(owner)) setMode('site');
      else {
        const next = selectionFromOwner(owner, sessionRef.current.project.state);
        setSelection(next);
        // Außen-Teil: Info in der Statuszeile (Inspektor und markierte Gruppe folgen aus der Auswahl)
        const part = exteriorPartInfo(next, exterior, catalog);
        if (part !== undefined) setStatus({ text: exteriorPartText(part), error: false });
      }
    },
    [sitePick, exterior, catalog],
  );
  const onUndo = () => {
    const s = sessionRef.current;
    const step = s.past[s.past.length - 1] ?? s.previous;
    run(undoText('Rückgängig', step === undefined ? undefined : actionLabelsRef.current.get(step)), uc.undo);
  };
  const onRedo = () => {
    const next = sessionRef.current.future?.[0];
    const step = next === undefined ? undefined : (next.past[next.past.length - 1] ?? next.previous);
    run(undoText('Wiederholt', step === undefined ? undefined : actionLabelsRef.current.get(step)), uc.redo);
  };
  const onReroll = (id: RoomId) => run('Neu gewürfelt', (s) => uc.rerollRoom(s, catalog, id));
  const onRerollAll = () => run('Alle Räume neu gewürfelt', (s) => uc.rerollAll(s, catalog));
  /** F „Bereich neu einrichten“: ein Undo-Schritt; Statuszeile mit Umfang bzw. Grund (dann unverändert). */
  const onBlock = (roomId: RoomId, cells: CellSet) => {
    setBlockRoom(undefined);
    let report: ReturnType<typeof br.refurnishBlock>['report'] | undefined;
    try {
      run('Bereich neu eingerichtet', (s) => {
        const r = br.refurnishBlock(s, catalog, roomId, cells, { margin: blockMargin });
        report = r.report;
        return r.session;
      });
    } finally {
      if (report !== undefined) {
        setStatus({ text: br.blockRefurnishText(report), error: !report.ok });
        // tatsächlich bearbeitetes Gebiet: Bereich, Rand und Grundriss mitgenommener Möbel
        setBlockHint(report.ok && report.changed ? { roomId, cells: report.region } : undefined);
      }
    }
  };
  /** Strg+K „Bereich neu einrichten“: gewähltes Möbel → seine Zone; gewählter Raum → Rechteck scharf; sonst Hinweis. */
  const startBlock = () => {
    if (!blockOn) return;
    const st = sessionRef.current;
    if (sel.placementId !== undefined) {
      const z = br.zoneOfPlacement(st, catalog, sel.placementId);
      if (z !== undefined) return onBlock(z.roomId, z.cells);
    }
    const roomId = sel.roomId;
    if (roomId === undefined) return setStatus({ text: 'Bereich neu einrichten: erst einen Raum (oder ein Möbel in 3D) wählen', error: false });
    setBlockRoom(roomId);
    setStatus({ text: 'Bereich neu einrichten: Rechteck im Raum ziehen (Esc bricht ab) – oder im Raum-Panel eine Zone wählen', error: false });
  };
  const onDelete = (id: RoomId) => {
    run('Raum gelöscht', (s) => uc.deleteRoom(s, catalog, id, autoFlag));
    setSelection(NO_SELECTION);
  };
  const onToggleLock = (pid: PlacementId) => run('Sperre umgeschaltet', (s) => uc.toggleLock(s, catalog, pid));
  const onRename = (name: string) => run('Umbenannt', (s) => uc.renameProject(s, name));
  const onVersion = useCallback((name: string) => run(`Zielversion ${name}`, (s) => uc.setTargetVersion(s, catalog, name)), [run, catalog]);
  // ------------------------------------------------------------------ Bautyp (Assistent, Panel „Bautyp“)
  const typeCtx = useMemo<bt.TypeContext | undefined>(
    () => (load.themeCatalog === undefined ? undefined : { catalog, themes: load.themeCatalog, terrainStyles: loadBundledTerrainStyles().styles, ...(load.paletteCatalog !== undefined ? { palettes: load.paletteCatalog } : {}) }),
    [catalog, load.themeCatalog],
  );
  // „Beschreibe dein Gebäude“ (C3): Engine-Server über den Vite-Proxy bzw. VITE_ENGINE_URL, sonst lokal im Browser
  const vocabulary = useMemo(
    () => (typeCtx === undefined ? undefined : vocabularyOf({ ...typeCtx, buildingTypes: load.buildingTypes } as unknown as Parameters<typeof vocabularyOf>[0])),
    [typeCtx, load.buildingTypes],
  );
  const describe = useMemo(() => {
    if (vocabulary === undefined) return undefined;
    const baseUrl = engineBaseUrl(import.meta.env as { VITE_ENGINE_URL?: string });
    return (prompt: string) => describeBuilding(prompt, { baseUrl, vocabulary, fetch: window.fetch.bind(window) });
  }, [vocabulary]);
  // F-JEV-iterativ: „Planen & verbessern“ (nur sichtbar, wenn der Server den Schalter meldet)
  const design = useMemo(() => {
    if (vocabulary === undefined) return undefined;
    const baseUrl = engineBaseUrl(import.meta.env as { VITE_ENGINE_URL?: string });
    return (prompt: string) => designIterative(prompt, { baseUrl, vocabulary, fetch: window.fetch.bind(window) });
  }, [vocabulary]);
  const originDef = bt.originType(session, load.buildingTypes);
  const newProject = (label: string, make: (s: uc.Session) => uc.Session) => {
    const apply = (): void => {
      // stairsNote: Treppen des alten Projekts sind nicht „entfernt“, das Projekt ist ein anderes
      const next = run(`Neues Projekt: ${label} (Rückgängig kehrt zurück)`, (s) => uc.replaceSession(s, make(s)), { stairsNote: false });
      if (next === undefined) return;
      setWizardOpen(false);
      setSelection(NO_SELECTION);
      setHouseMore(false);
      setTool('select');
      // Neues Haus: 3D groß (Nutzerentscheidung); ein eingeblendeter Grundriss über der Ansicht geht wieder weg
      if (layout === 'overlay') setLayout('3d');
      setCutValue(undefined);
      setFloor(uc.FLOOR_INDEX);
      setMode('house');
      setResumeDismissed(true);
      // Bewusst neues Projekt: der aktuelle Speicherstand ist die neue Basis für den Autosave
      saveBaseRef.current = storedInfo(store)?.savedAt ?? saveBaseRef.current;
      setAutosave(undefined);
    };
    // Ein gefülltes Projekt wird nicht kommentarlos ersetzt (Nutzer-Review); der Inhalt ist zusätzlich
    // automatisch gespeichert und per Rückgängig erreichbar. Neu (W1): Liegt noch ein nicht fortgesetzter Stand im
    // Browser (Angebot „Fortsetzen“ offen), würde der Autosave ihn überschreiben – auch dann wird gefragt.
    const pendingStored = resumeOffer(stored, !touched) && !resumeDismissed ? stored : undefined;
    const ask = replaceConfirm(sessionRef.current.project.state, pendingStored, formatDate);
    if (ask !== undefined) setPendingReplace({ run: apply, ...ask });
    else apply();
  };
  /** Assistent mit Beschreibung öffnen (Website, Deep-Link); ersetzt nichts – Übernehmen fragt wie immer nach. */
  const openDescribe = useCallback((cmd: DescribeCommand) => {
    setExportOpen(false);
    setHelpOpen(false);
    setFocusDescribe(false);
    describeIdRef.current += 1;
    // S2: Erkennung der Website ohne Sicherheit zum Bautyp (Server ohne Modell) → lokale Sicherheit ergänzen
    const it = cmd.interpretation === undefined || vocabulary === undefined ? cmd.interpretation : withLocalConfidence(cmd.interpretation, cmd.prompt, vocabulary);
    setDescribeRequest({ id: describeIdRef.current, prompt: cmd.prompt, ...(it !== undefined ? { interpretation: it } : {}) });
    setWizardOpen(true);
  }, [vocabulary]);
  const openWizard = (focus: boolean) => {
    setDescribeRequest(undefined);
    setFocusDescribe(focus);
    setWizardOpen(true);
  };

  // Einbettungs-Protokoll (W1): Nachrichten der Website annehmen, danach „bereit“ melden; Deep-Link einmal ausführen
  const embedStartRef = useRef(false);
  useEffect(() => {
    if (typeCtx === undefined) return; // ohne Bautypen kein Assistent – dann auch nicht „bereit“
    const onMessage = (e: MessageEvent) => {
      const r = receiveDescribe(e, window);
      if (r.kind === 'accept') openDescribe(r.command);
      else if (r.kind === 'reject') announceRejected(window, r.reason); // R1-08: die Website zeigt einen Hinweis
    };
    window.addEventListener('message', onMessage);
    if (!embedStartRef.current) {
      embedStartRef.current = true; // StrictMode: Effekt läuft doppelt, gemeldet und ausgeführt wird einmal
      announceReady(window);
      if (embed.describe !== undefined) {
        openDescribe({ prompt: embed.describe });
        // Neu laden soll die Beschreibung nicht erneut erkennen lassen; `embed=1` bleibt
        const q = new URLSearchParams(location.search);
        q.delete('describe');
        const rest = q.toString();
        history.replaceState(history.state, '', `${location.pathname}${rest === '' ? '' : `?${rest}`}${location.hash}`);
      }
    }
    return () => window.removeEventListener('message', onMessage);
  }, [typeCtx, openDescribe, embed.describe]);
  const onAcceptType = (def: BuildingTypeDef, params: bt.TypeParams, seed: number) => {
    if (typeCtx === undefined) return;
    newProject(bt.typeLabel(def), (s) => bt.typeSession(def, params, seed, typeCtx, uc.shellStyle(s)).session);
    // W9-G4 (Review R5): ein Erdhaus zeigt sich von außen – „Dach ab“ schnitte den Hügel über der Decke ab
    if (def.setting?.kind === 'buried') setView('full');
  };
  // DR5 K4: Teilen per URL – Link mit Bautyp, Seed und Parameter im Fragment kopieren; beim Öffnen einmal einlesen
  const onShareLink = () => {
    const types = load.buildingTypes;
    try {
      const url = types === undefined ? undefined : shareUrlOf(sessionRef.current, types, location.href);
      if (url === undefined) {
        setStatus({ text: 'Teilen per Link geht nur für Projekte aus einem Bautyp – bitte als Datei speichern', error: true });
        return;
      }
      const note = shareLosesEdits(sessionRef.current) ? ' – enthält Bautyp, Seed und Parameter, nicht deine Änderungen danach' : '';
      void navigator.clipboard?.writeText(url).then(
        () => setStatus({ text: `Link kopiert${note}`, error: false }),
        () => setStatus({ text: `Link: ${url}${note}`, error: false }),
      );
    } catch (e) {
      setStatus({ text: uc.errorMessage(e), error: true });
    }
  };
  const shareStartRef = useRef(false);
  useEffect(() => {
    const types = load.buildingTypes;
    if (shareStartRef.current || typeCtx === undefined || types === undefined || !hasShareFragment(location.hash)) return;
    shareStartRef.current = true;
    const r = sessionFromShare(location.hash, { ...typeCtx, types });
    // Fragment weg, damit Neuladen nicht erneut ersetzt
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    if (!r.ok) setStatus({ text: r.error, error: true });
    else newProject(`${r.name} (geteilter Link)`, () => r.session);
  }, [typeCtx, load.buildingTypes]);
  const onEmptyProject = () => newProject('leer', (s) => uc.createSession(randomSeed(), 'Unbenannt', s.project.state.themeId, s.roof));
  /**
   * Bautyp-Neubau (W2-ED U1): vorher fragen, wie viele Räume ersetzt werden und was bleibt (eigene Räume, Räume mit
   * gesperrten Möbeln); danach nennt die Statuszeile den Umfang statt pauschal „eigene Räume bleiben“.
   */
  const typeRebuild = (what: string, question: string, f: (s: uc.Session) => uc.Session, replan: boolean) => {
    const apply = (): void => {
      const before = sessionRef.current;
      // stairsNote: der neue Plan ersetzt die Treppen des alten (keine „entfernte“ Treppe)
      const next = run(what, f, { stairsNote: false });
      if (next === undefined || next === before || !replan) return;
      setStatus({ text: bt.typeReplaceStatus(before, next, what), error: false });
      if (sel.roomId !== undefined && !next.project.state.rooms.some((r) => r.id === sel.roomId)) setSelection(NO_SELECTION);
    };
    const ask = replan ? bt.typeReplaceConfirm(sessionRef.current, question) : undefined;
    if (ask !== undefined) setPendingReplace({ run: apply, ...ask, confirmLabel: 'Neu bauen' });
    else apply();
  };
  const onTypeParams = (params: bt.TypeParams) => {
    if (originDef === undefined || typeCtx === undefined) return;
    const replan = bt.replansLayout(sessionRef.current, originDef, params);
    typeRebuild(replan ? 'Bautyp angepasst' : 'Bautyp: Stil übernommen', 'Bautyp anpassen', (s) => bt.changeTypeParams(s, originDef, params, typeCtx), replan);
  };
  const onTypeReroll = () => {
    if (originDef === undefined || typeCtx === undefined) return;
    typeRebuild('Grundriss neu gewürfelt', 'Grundriss neu würfeln', (s) => bt.rerollType(s, originDef, typeCtx), true);
  };
  const onTypeStyle = () => {
    if (originDef !== undefined) run(`Stil von „${bt.typeLabel(originDef)}“ angewandt`, (s) => bt.applyTypeStyle(s, originDef, catalog));
  };
  const onCloseExport = useCallback(() => setExportOpen(false), []);
  const onCloseHelp = useCallback(() => setHelpOpen(false), []);
  const onCloseWizard = useCallback(() => setWizardOpen(false), []);

  // ------------------------------------------------------------------ Automatisches Speichern (Nutzer-Review)
  // Nach jeder Änderung entprellt in den Browser-Speicher; die Statuszeile nennt Zeitpunkt oder Grund.
  // **Nicht speichern, solange der Nutzer nichts geändert hat** (`touched`): sonst überschreibt das leere
  // Startprojekt beim Laden nach 1,2 s den gespeicherten Stand und „Fortsetzen“/„Laden“ liefern ein leeres
  // Projekt (Regression aus dem Verlustschutz, gemeldet im Review). Auch das Fortsetzen selbst speichert
  // nicht – der geladene Stand liegt ja schon im Speicher.
  useEffect(() => {
    // Ablauf und Entscheidung stehen in `autosaveAction`/`scheduleAutosave` (beide getestet):
    // ohne Nutzeränderung wird nichts geschrieben, ein fremder Tab wird **sofort** gemeldet (Review 4).
    const id = scheduleAutosave({
      action: () => autosaveAction(touched, store !== undefined, saveBaseRef.current, storedInfo(store)?.savedAt),
      blocked: () => setAutosave({ blocked: FOREIGN_SAVE_HINT }),
      write: () => {
        const r = saveToStore(store, sessionRef.current);
        if (r.ok) saveBaseRef.current = r.savedAt;
        setStored(storedInfo(store));
        setAutosave(r.ok ? { at: Date.now() } : { error: r.error });
      },
    });
    return () => {
      if (id !== undefined) clearTimeout(id);
    };
  }, [store, session, touched]);

  // Nur warnen, wenn wirklich etwas verloren gehen kann: Inhalt da UND Speichern greift nicht.
  useEffect(() => {
    if (!shouldGuardUnload(store !== undefined, autosave?.error ?? autosave?.blocked, hasContent(state))) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store, autosave?.error, autosave?.blocked, state]);
  const onDownload = async () => {
    const w = world.world;
    const viaWorker = blocksInWorker && blocksClient !== undefined && preview.current;
    if (!viaWorker && (w === undefined || !world.current)) return;
    setDownloading(true);
    try {
      // W14: im Worker aus derselben Welt wie der Prüfbericht; sonst wie bisher hier
      const file = viaWorker
        ? await blocksClient.exportFile(serializeProject(session, { savedAt: new Date(0) }), siteMode.world?.state !== undefined, format)
        : await exportProject(project, w!, format, streamGzip);
      downloadFile(file);
      // W11-B: der Einbau-Hinweis des Dialogs verschwand mit dem Dialog – jetzt bleibt er in der Statuszeile stehen
      const place = placeHint(format, state.name, state.targetVersion.name).replace(/`/g, '');
      setStatus({ text: `Exportiert: ${file.name} (${Math.max(1, Math.round(file.bytes.length / 1024))} kB, Minecraft ${state.targetVersion.name}) – ${place}`, error: false });
      setExportOpen(false);
    } catch (e) {
      setStatus({ text: `Export fehlgeschlagen: ${uc.errorMessage(e)}`, error: true });
    } finally {
      setDownloading(false);
    }
  };

  // DR5 K2: Bauplan (Markdown) und Materialliste (CSV) derselben Welt wie der Export (App = Engine `build_guide`)
  const onGuide = async (kind: GuideKind) => {
    const w = world.world;
    const viaWorker = blocksInWorker && blocksClient !== undefined && preview.current;
    if (!viaWorker && (w === undefined || !world.current)) return;
    setDownloading(true);
    try {
      const file = viaWorker
        ? await blocksClient.guideFile(serializeProject(session, { savedAt: new Date(0) }), siteMode.world?.state !== undefined, kind)
        : exportGuide(project, w!, kind);
      downloadFile(file);
      setStatus({ text: `${kind === 'markdown' ? 'Bauplan' : 'Materialliste'}: ${file.name}`, error: false });
    } catch (e) {
      setStatus({ text: `Bauplan fehlgeschlagen: ${uc.errorMessage(e)}`, error: true });
    } finally {
      setDownloading(false);
    }
  };

  // ------------------------------------------------------------------ Speichern / Laden
  const refs = useMemo(() => ({ catalog, ...(load.themeCatalog !== undefined ? { themes: load.themeCatalog } : {}) }), [catalog, load.themeCatalog]);
  const applyLoaded = (r: LoadResult, label: string) => {
    if (!r.ok) {
      setStatus({ text: r.error, error: true });
      return;
    }
    const next = uc.replaceSession(sessionRef.current, lightNow(r.session));
    sessionRef.current = next;
    setSession(next);
    setSelection(NO_SELECTION);
    setCutValue(undefined);
    // Bewusst geladener Stand = neue Basis für den Autosave (sonst gilt der eigene Speicherstand als „fremd“)
    saveBaseRef.current = storedInfo(store)?.savedAt ?? saveBaseRef.current;
    setAutosave(undefined);
    const when = r.savedAt !== undefined && formatDate(r.savedAt) !== '' ? ` (gespeichert ${formatDate(r.savedAt)})` : '';
    setStatus({ text: `${label}: ${r.name}${when}${r.warnings.length > 0 ? ` · ${r.warnings.join(' · ')}` : ''}`, error: r.warnings.length > 0 });
  };
  const onSaveLocal = () => {
    const r = saveToStore(store, sessionRef.current);
    if (!r.ok) {
      setStatus({ text: r.error, error: true });
      return;
    }
    saveBaseRef.current = r.savedAt;
    setAutosave(undefined);
    setStored(storedInfo(store));
    setStatus({ text: `Im Browser gespeichert: ${sessionRef.current.project.state.name} (${Math.max(1, Math.round(r.bytes / 1024))} kB)`, error: false });
  };
  const onLoadLocal = () => {
    const r = loadFromStore(store, refs);
    if (r === undefined) setStatus({ text: 'Im Browser ist kein Projekt gespeichert', error: true });
    else applyLoaded(r, 'Geladen');
  };
  const onSaveFile = () => {
    const name = projectFileName(state.name);
    downloadFile({ name, bytes: new TextEncoder().encode(serializeProject(sessionRef.current, { pretty: true })), mime: 'application/json' });
    setStatus({ text: `Projektdatei: ${name}`, error: false });
  };
  const onOpenFile = (file: File) => {
    file.text().then(
      (text) => applyLoaded(parseProjectFile(text, refs), `Geöffnet (${file.name})`),
      (e: unknown) => setStatus({ text: `Datei nicht lesbar: ${uc.errorMessage(e)}`, error: true }),
    );
  };

  // ------------------------------------------------------------------ Tastatur (Tabelle in ui/shortcuts.ts)
  const choosePreview = (p: PreviewSource) => {
    setPreviewChoice(p);
    if (p === 'textures') textures.ensureLoaded();
  };
  const onCommand = (c: Command): void => {
    if (mode === 'site' && siteMode.onCommand(c)) return;
    switch (c) {
      case 'tool.paint':
        return chooseTool('paint');
      case 'tool.erase':
        return chooseTool('erase');
      case 'tool.select':
        return chooseTool('select');
      case 'tool.stairs':
        chooseTool('stairs');
        setStatus({ text: `Treppe: Geist folgt der Maus im Grundriss (${uc.floorLabel(floor)} → darüber). Klick setzt, R dreht, F spiegelt, Esc beendet`, error: false });
        return;
      case 'stairs.rotate':
        return setStairTool((t) => ({ ...t, facing: rotateFacing(t.facing) }));
      case 'stairs.mirror':
        return setStairTool((t) => ({ ...t, turn: t.turn === 'left' ? 'right' : 'left' }));
      case 'room.reroll':
        if (sel.roomId !== undefined) onReroll(sel.roomId);
        else setStatus({ text: 'Neu würfeln: erst einen Raum wählen (oder Umschalt+R für alle)', error: false });
        return;
      case 'room.rerollAll':
        onRerollAll();
        return;
      case 'room.delete':
        if (sel.linkId !== undefined) onRemoveStairs(sel.linkId);
        else if (sel.placementId !== undefined) onRemovePlacement(sel.placementId);
        else if (sel.roomId !== undefined) onDelete(sel.roomId);
        return;
      case 'placement.left':
      case 'placement.right':
      case 'placement.up':
      case 'placement.down': {
        if (sel.placementId === undefined) return;
        const [dx, dz] = c === 'placement.left' ? [-1, 0] : c === 'placement.right' ? [1, 0] : c === 'placement.up' ? [0, -1] : [0, 1];
        const id = sel.placementId;
        run('Möbel verschoben', (s) => pe.nudgePlacement(s, catalog, id, dx, dz));
        return;
      }
      case 'placement.rotate': {
        if (sel.placementId === undefined) return setStatus({ text: 'Q dreht ein gewähltes Möbel (Klick in 3D oder Möbelliste)', error: false });
        const id = sel.placementId;
        run('Möbel gedreht', (s) => pe.rotatePlacement(s, catalog, id));
        return;
      }
      case 'placement.lock': {
        if (sel.placementId !== undefined) onToggleLock(sel.placementId);
        else if (selectedRoom !== undefined) {
          const fixed = selectedRoom.fixed !== true;
          const id = selectedRoom.id;
          run(fixed ? 'Raum fixiert (bleibt bei Bautyp-Neubau)' : 'Fixierung gelöst', (s) => uc.fixRoom(s, catalog, id, fixed));
        } else setStatus({ text: 'L: erst ein Möbel (sperren) oder einen Raum (fixieren) wählen', error: false });
        return;
      }
      case 'undo':
        onUndo();
        return;
      case 'redo':
        onRedo();
        return;
      case 'save':
        return onSaveLocal();
      case 'view.full':
        return chooseView('full');
      case 'view.noRoof':
        return chooseView('noRoof');
      case 'view.floorOnly':
        return chooseView('floorOnly');
      case 'preview.cycle':
        return choosePreview(nextPreview(source, options));
      case 'layout.cycle':
        return setLayout(nextLayout(layout));
      case 'camera.fit':
        leaveEyeCut();
        return viewportRef.current?.fit(highlight);
      case 'light.dayNight':
        setLighting(toggleDayNight);
        if (source !== 'textures') setStatus({ text: 'Tag/Nacht wirkt in der Darstellung „Texturen“', error: false });
        return;
      case 'floor.up':
      case 'floor.down': {
        const next = adjacentFloor(state, floor, c === 'floor.up' ? 1 : -1);
        if (next === undefined) setStatus({ text: 'Keine weitere Etage – „+“ an der Etagen-Leiste legt eine an, „+ Keller darunter“ steht bei der untersten Etage (Klick auf die aktive Etage)', error: false });
        else setFloor(next);
        return;
      }
      case 'help':
        return setHelpOpen((h) => !h);
      case 'palette':
        return setPaletteOpen(true);
      case 'escape':
        // W2-ED U3: eine Ebene höher (Möbel → Raum → Etage → Haus); im Treppen-Werkzeug zurück zu „Auswählen“
        if (tool === 'stairs') return setTool('select');
        if (blockRoom !== undefined) return setBlockRoom(undefined);
        if (sel === NO_SELECTION || Object.keys(sel).length === 0) return setHouseMore(false);
        return setSelection(parentSelection(sel, state));
    }
  };
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;
  const placingRef = useRef(false);
  // R/F drehen bzw. spiegeln die Treppe nur im Modus Haus (im Modus Umgebung: Gelände neu würfeln, Einpassen)
  placingRef.current = mode === 'house' && tool === 'stairs';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = commandForKey(e, { placing: placingRef.current });
      const target = e.target as HTMLElement | null;
      if (cmd === undefined || shortcutSwallowed(cmd, e, target)) return;
      if ((cmd === 'floor.up' || cmd === 'floor.down') && target?.tagName === 'INPUT') return; // Bild↑/↓ bedient den Regler
      if (exportOpen || wizardOpen || paletteOpen || (helpOpen && cmd !== 'help')) return; // Dialoge schließen selbst mit Esc
      e.preventDefault();
      commandRef.current(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportOpen, helpOpen, wizardOpen, paletteOpen]);

  // ------------------------------------------------------------------ Befehlssuche (W7-G, U8)
  const paletteItems = useMemo(() => commandItems().filter((i) => blockOn || i.id !== 'room.block'), [blockOn]);
  /** Hinspringen: den Ort der Heimat-Tabelle herstellen (Auswahl, Panel, Menü), dann das Bedienelement hervorheben. */
  const goHome = (item: CommandItem): void => {
    const st = sessionRef.current.project.state;
    const onFloor = st.rooms.filter((r) => r.floorIndex === floor);
    const room = selectedRoom ?? onFloor[0] ?? st.rooms[0];
    let menu: string | undefined;
    const need = (what: string): void => setStatus({ text: `${item.label}: ${what}`, error: false });
    switch (item.home) {
      case undefined:
        return;
      case 'Kopf › Neu ▾':
        menu = 'Neu';
        break;
      case 'Kopf › ⋯':
        menu = 'Mehr';
        break;
      case 'Werkzeug-Schiene':
        setMode('house');
        break;
      case 'Werkzeug-Schiene › Raum':
        setMode('house');
        chooseTool('paint');
        break;
      case 'Werkzeug-Schiene › Treppe':
        setMode('house');
        chooseTool('stairs');
        break;
      case 'Bühne › Schnitt ▾':
        menu = 'Schnitt';
        break;
      case 'Bühne › Ansicht ▾':
        menu = 'Ansicht';
        break;
      case 'Bühne › Licht-Leiste':
        choosePreview('textures');
        setLightBar(true);
        break;
      case 'Haus':
      case 'Haus › Mehr':
        setMode('house');
        setInspTab('selection');
        setSelection(NO_SELECTION);
        setHouseMore(item.home === 'Haus › Mehr');
        break;
      case 'Haus › Bautyp anpassen':
        if (originDef === undefined) return need('nur für Häuser aus einem Bautyp (Neu ▾ › Beschreiben oder Bautyp)');
        setTypeDialog(true);
        break;
      case 'Dach':
        setMode('house');
        setInspTab('selection');
        setSelection({ roof: true });
        break;
      case 'Grundriss':
        setMode('house');
        if (layout === '3d') setLayout(dock);
        break;
      case 'Etage':
        setMode('house');
        setInspTab('selection');
        setSelection({ floorIndex: floor });
        break;
      case 'Raum':
      case 'Raum › Möbel':
        if (room === undefined) return need('erst einen Raum malen (Werkzeug Raum)');
        setMode('house');
        setInspTab('selection');
        setSelection({ roomId: room.id });
        break;
      case 'Möbel': {
        const pid = sel.placementId ?? st.placements.find((p) => p.roomId === room?.id && p.parentId === undefined)?.id ?? st.placements[0]?.id;
        if (pid === undefined) return need('erst einen Raum mit Möbeln anlegen');
        setMode('house');
        setInspTab('selection');
        setSelection({ roomId: st.placements.find((p) => p.id === pid)!.roomId, placementId: pid });
        break;
      }
      case 'Treppe': {
        const link = selectedLink ?? st.links[0];
        if (link === undefined) return need('noch keine Treppe – Werkzeug Treppe (T) setzt eine');
        setMode('house');
        setInspTab('selection');
        setSelection({ linkId: link.id });
        break;
      }
      case 'Außen-Teil':
        return need('Klick in 3D auf ein Außen-Teil (Laterne, Blumenkasten …) zeigt es');
      case 'Material':
        setInspTab('material');
        break;
      case 'Umgebung': {
        // W11-B: Modus Umgebung, Werkzeug wählen, dann das Bedienelement hervorheben
        setMode('site');
        const t = SITE_TOOL_OF[item.id];
        if (t !== undefined) siteMode.chooseTool(t);
        break;
      }
      case '⋯ › Projekt-Info':
        setInfoOpen(true);
        break;
      case 'Export-Dialog':
        if (exportBlocked !== undefined) return need(exportBlocked);
        setExportOpen(true);
        break;
      default:
        break;
    }
    const text = findText(item.find) ?? item.label;
    // nach dem Rendern des Orts (Panel, Dialog, Menü) suchen
    window.setTimeout(() => {
      if (menu !== undefined) openMenu(document, menu);
      window.setTimeout(() => {
        const found = flashControl(document, text);
        setStatus({ text: found ? `${item.label} · ${item.path}` : `${item.label}: zu finden unter ${item.path}`, error: false });
      }, 30);
    }, 30);
  };
  /** W10 Augenhöhe, W11-B mit Dach und allen Etagen (vorheriger Schnitt kommt beim Verlassen zurück). */
  const onEyeLevel = house === undefined ? undefined : (): void => {
    const { show, restore } = eyeLevelCut({ view, floors: floorView, cut: cutValue });
    eyeRestoreRef.current ??= restore;
    setView(show.view);
    setFloorView(show.floors);
    setCutValue(show.cut);
    // erst die Ansicht mit Dach zeichnen lassen, dann die Kamera setzen (sonst passt die Ansicht neu ein)
    afterPaint(() => viewportRef.current?.eyeLevel?.((aspect, shift) => eyeLevelCamera(house, mainDoorOf(shell), aspect, { shift })));
  };
  /** Direkte Aktionen der Menü-Einträge (Kopf › Neu ▾ / ⋯), sonst Tastenbefehl bzw. Hinspringen. */
  const paletteActions: Readonly<Record<string, () => void>> = {
    'header.new': () => openWizard(false),
    'save.load': onLoadLocal,
    'save.file': onSaveFile,
    'save.share': onShareLink,
    'header.export': () => (exportBlocked === undefined ? setExportOpen(true) : setStatus({ text: exportBlocked, error: true })),
    'header.palette': () => setPaletteOpen(true),
    'room.block': startBlock,
    // W11-A: Strg+K „Treppen automatisch“ schaltet direkt um (Meldung in der Statuszeile)
    'floorbar.autoStairs': () => onAutoStairs(),
    ...(onEyeLevel !== undefined ? { 'view.eyeLevel': onEyeLevel } : {}),
  };
  const onPaletteRun = (item: CommandItem): void => {
    setPaletteOpen(false);
    const direct = paletteActions[item.id];
    if (direct !== undefined) direct();
    else if (item.command !== undefined) {
      // Befehle ohne eigene Statusmeldung (Schnitt, Darstellung …) bestätigen sich hier; Aktionen überschreiben das
      setStatus({ text: `${item.label}${item.keys !== undefined ? ` (${item.keys})` : ''}`, error: false });
      commandRef.current(item.command);
    } else goHome(item);
  };

  const roomTypeName = useCallback(
    (id: string) => {
      try {
        return catalog.roomType(id).name;
      } catch {
        return id;
      }
    },
    [catalog],
  );
  // Auftrag 3: `Raum r7` in Domänenmeldungen → „Küche · 2 (EG)“; unbekannte IDs bleiben stehen.
  roomRefsRef.current = (text: string): string => {
    const st = sessionRef.current.project.state;
    const rooms = translateRoomRefs(text, (id) => {
      const room = st.rooms.find((r) => r.id === id);
      if (room === undefined) return undefined;
      const no = roomDisplayNumbers(st.rooms, room.floorIndex).get(room.id);
      return `${roomLabel(roomTypeName(room.roomTypeId), no)} (${uc.floorLabel(room.floorIndex)})`;
    });
    // W11-B: „Treppe s58 auf Etage 0“ → „der Treppe EG → 1. OG“
    return translateStairRefs(rooms, (id) => {
      const link = st.links.find((l) => l.id === id);
      return link === undefined ? undefined : `${uc.floorLabel(link.floorIndex)} → ${uc.floorLabel(link.floorIndex + 1)}`;
    }, uc.floorLabel);
  };
  // Erreichbarkeit (Red-Team-Review): Etagen ohne Treppe und Räume ohne Tür/Treppe in Nutzersprache, dazu die
  // Laufweg-Warnungen (`circulation`) mit Raumnamen statt interner IDs – eine Liste für Panel „Gebäude“ und Export
  const access = useMemo(() => {
    const roomName = (id: string): string => {
      const room = state.rooms.find((r) => r.id === id);
      return room === undefined ? id : roomLabel(roomTypeName(room.roomTypeId), roomDisplayNumbers(state.rooms, room.floorIndex).get(id));
    };
    const hints = accessHints(state, shell.rooms, uc.floorLabel, roomName);
    return mergeAccessWarnings(hints, circulationWarnings, state, roomName, uc.floorLabel);
  }, [state, shell, roomTypeName, circulationWarnings]);
  const workerReport = blocksInWorker ? preview.report : undefined;
  const report = useMemo(
    () => (workerReport !== undefined ? { ...workerReport, access } : world.current && world.world !== undefined ? exportReport(world.world, access) : undefined),
    [workerReport, world.current, world.world, access],
  );
  const counts = useMemo(() => countByLayer(visibleVoxels), [visibleVoxels]);
  const lightText = lightStatus(session.light, session.needsLight);
  const lightWarning = session.light !== undefined && (session.light.error !== undefined || session.light.darkCells > 0);
  const cutMax = range.max + 1;
  const cutLabel = cutY === undefined ? 'alles' : `y ≤ ${cutY}`;
  const texNote = texState.kind === 'ready' ? versionNote(texState.assets.version, version) : undefined;
  const floors = floorItems(state, floor);
  const activeFloor = floors.find((f) => f.active);
  const overlay = source === 'roles' ? undefined
    : blockOverlay(source === 'blocks' && blocksInWorker ? { busy: preview.busy, error: preview.error, has: preview.voxels !== undefined } : { busy: world.busy, error: world.error, has: world.world !== undefined }, session.needsLight);
  // Statuszeile: Kennzahlen der Blöcke (W14: im Modus „Blöcke“ vom Worker, sonst aus der Welt des Haupt-Threads)
  const stats = source === 'blocks' && blocksInWorker ? preview.stats : report;
  const statsMs = source === 'blocks' && blocksInWorker ? preview.ms : world.ms;
  const resumeVisible = resumeOffer(stored, !touched) && !resumeDismissed;
  // Leerzustand: keine Räume, keine Umgebung, Modus Haus – bis „Selbst malen“ gewählt oder etwas gebaut ist
  const showStart = mode === 'house' && !startDismissed && !wizardOpen && !hasContent(state) && session.surroundings === undefined;

  const plan = mode === 'site' ? (
    <div className="plan-host">{siteMode.plan}</div>
  ) : (
    <div className="plan-host">
      <FloorPlan
        state={state}
        shell={shell}
        views={views}
        selectedRoomId={sel.roomId}
        selectedPlacementId={sel.placementId}
        floor={floor}
        window={planWin}
        onResizeRoom={(roomId, add, remove) => run(add.length > 0 ? 'Raum vergrößert' : 'Raum verkleinert', (s) => uc.resizeRoom(s, catalog, roomId, add, remove, autoFlag))}
        onSelectPlacement={(id) => {
          const roomId = state.placements.find((p) => p.id === id)?.roomId;
          if (roomId !== undefined) setSelection({ roomId, placementId: id });
        }}
        movePreview={movePreview}
        onMovePlacement={onMovePlacement}
        ghostFloor={ghost}
        tool={tool}
        paintTypeId={paintType}
        roomTypeName={roomTypeName}
        onPaint={onPaint}
        onErase={onErase}
        onSelect={onSelectCell}
        selectedLinkId={sel.linkId}
        previewStairs={tool === 'stairs' ? previewStairs : undefined}
        onPlaceStairs={onPlaceStairs}
        onRemoveStairs={onRemoveStairsAt}
        blockRoomId={blockOn && blockRoom !== undefined && state.rooms.some((r) => r.id === blockRoom && r.floorIndex === floor) ? blockRoom : undefined}
        onBlock={(rect) => {
          const room = state.rooms.find((r) => r.id === blockRoom);
          // gegen das Rauminnere (ohne Wände und Treppen) – ein Rechteck nur auf der Wand ist eine Nutzereingabe
          const cells = room === undefined ? CellSet.empty() : br.blockCellsIn(sessionRef.current, catalog, room.id, uc.rectCells(rect));
          if (room === undefined || cells.isEmpty) {
            setBlockRoom(undefined);
            setStatus({ text: 'Bereich neu einrichten: das Rechteck liegt nicht im Rauminneren (nur Wand oder Treppe) – nichts geändert', error: true });
          } else onBlock(room.id, cells);
        }}
        blockHint={blockOn ? blockHint?.cells : undefined}
      />
    </div>
  );

  let viewer;
  if (source !== 'textures') {
    viewer = <Viewer3D voxels={visibleVoxels} view={view} overlay={overlay} grid={grid} highlight={shownHighlight} onPick={onPick} apiRef={viewportRef} fitInsetLeft={FLOOR_BAR_INSET} fitBox={fitBox} furnitureDrag={furnitureDrag} />;
  } else if (texState.kind === 'ready') {
    viewer = (
      <Suspense
        fallback={
          <div className="viewer">
            <div className="viewer-overlay" data-busy>Blockrenderer wird geladen …</div>
          </div>
        }
      >
        <TextureViewer
          assets={texState.assets}
          blockInfo={blockInfo}
          platform={platform}
          scene={texScene}
          lighting={lighting}
          onLighting={setLighting}
          grid={grid}
          highlight={shownHighlight}
          onPick={onPick}
          apiRef={viewportRef}
          overlay={overlay}
          lightBar={lightBar}
          furnitureDrag={furnitureDrag}
        />
      </Suspense>
    );
  } else {
    viewer = (
      <div className="viewer">
        <div className="viewer-failure">
          {texState.kind === 'loading' ? (
            <div>
              <p>{texState.message}</p>
              {texState.progress !== undefined && <progress className="progress" max={1} value={texState.progress} />}
            </div>
          ) : (
            texMode.hint
          )}
        </div>
      </div>
    );
  }

  const planShown = layout !== '3d';
  const planHead = (
    <div className="pane-head">
      <h2>{mode === 'site' ? 'Umgebung' : `Grundriss · ${activeFloor?.label ?? `Etage ${floor}`}`}</h2>
      <span className="muted small">
        {mode === 'site'
          ? siteMode.head
          : tool === 'stairs'
          ? `Treppe ${uc.floorLabel(floor)} → ${uc.floorLabel(floor + 1)} · Klick setzt · R dreht · F spiegelt · rechts entfernt`
          : `Klick wählt · Raum-Werkzeug zieht Räume auf · rechts radiert${ghost !== undefined ? ` · gestrichelt: ${uc.floorLabel(ghost)}` : ''}`}
      </span>
    </div>
  );
  /** W11-A: Schalter „Treppen automatisch“; beim Einschalten werden getrennte Etagen gleich verbunden (ein Undo-Schritt). */
  const onAutoStairs = (): void => {
    const on = !autoStairsOn;
    setAutoStairsOn(on);
    uc.saveAutoStairsPref(store, on);
    if (!on) return setStatus({ text: 'Treppen automatisch: aus – neue Etagen bekommen keine Treppe mehr von selbst (Werkzeug Treppe setzt sie von Hand)', error: false });
    const prev = sessionRef.current;
    const next = run('Treppen automatisch: an', (s) => uc.autoStairs(s, catalog));
    if (next === prev) setStatus({ text: 'Treppen automatisch: an – alle Etagen sind schon verbunden', error: false });
    // keine Stelle gefunden: das Projekt bleibt, die Meldung sagt warum
    else if (next !== undefined && next.project === prev.project && next.autoStairsNote !== undefined) setStatus({ text: `Treppen automatisch: an · ${next.autoStairsNote}`, error: true });
  };
  const onFloorBar = (index: number) => {
    // Klick auf die aktive Etage wählt sie (Wandhöhe, Keller, Entfernen); sonst wechselt die Etage
    if (mode === 'house' && (index === floor || sel.floorIndex !== undefined)) setSelection({ floorIndex: index });
    setFloor(index);
  };
  const roomName = (id: string): string => {
    const room = state.rooms.find((r) => r.id === id);
    return room === undefined ? id : roomLabel(roomTypeName(room.roomTypeId), roomDisplayNumbers(state.rooms, room.floorIndex).get(id));
  };
  /** Pfad „Haus · EG“ über dem Titel: jede Ebene klickbar (W2-ED U3). */
  const floorPath = (index: number): CrumbStep[] => [
    { label: 'Haus', onSelect: () => setSelection(NO_SELECTION) },
    { label: uc.floorLabel(index), onSelect: () => { setFloor(index); setSelection({ floorIndex: index }); } },
  ];
  const selectedFloor = sel.floorIndex === undefined ? undefined : state.floors.find((f) => f.index === sel.floorIndex);
  const floorsSorted = [...state.floors].sort((x, y) => x.index - y.index);
  /** Chip über der 3D-Ansicht: was Aktionen im Panel neu bauen (W2-ED U4, Regel „Umfang = Auswahl“). */
  const chipLabel = ((): string => {
    if (sel.placementId !== undefined && selectedRoom !== undefined) {
      const v = views.find((x) => x.placement.id === sel.placementId);
      return `${v?.def.name ?? 'Möbel'} in ${roomName(selectedRoom.id)}`;
    }
    if (selectedRoom !== undefined) return roomName(selectedRoom.id);
    if (selectedLink !== undefined) return `Treppe ${uc.floorLabel(selectedLink.floorIndex)} → ${uc.floorLabel(selectedLink.floorIndex + 1)}`;
    if (sel.floorIndex !== undefined) return uc.floorLabel(sel.floorIndex);
    if (exteriorPart !== undefined) return exteriorPart.name;
    return '';
  })();
  const chip = mode === 'house' ? selectionChip(selectionLevel(sel), chipLabel) : undefined;
  /** Variante ◀ ▶ eines Möbels (nur mit mehreren Varianten). */
  const variantControl = (v: uc.PlacedView) => {
    const variants = v.def.variants ?? [];
    if (variants.length < 2) return undefined;
    const i = Math.max(0, variants.findIndex((x) => x.id === v.placement.variantId));
    const go = (step: 1 | -1) => {
      const next = pe.nextVariant(catalog, v.placement, step);
      if (next !== undefined) run(`Möbel-Variante ${((i + step + variants.length) % variants.length) + 1}`, (s) => pe.swapPlacement(s, catalog, v.placement.id, v.placement.componentId, next));
    };
    return { label: `${i + 1} / ${variants.length}`, onPrev: () => go(-1), onNext: () => go(1) };
  };
  let selectionPanel: ReactNode;
  if (mode === 'site') selectionPanel = siteMode.panel;
  else if (exteriorPart !== undefined) {
    selectionPanel = (
      <ExteriorPartPanel
        info={exteriorPart}
        onGroupOff={() => onStyle({ exterior: { ...style.exterior, groups: { ...style.exterior.groups, [exteriorPart.group]: false } } })}
      />
    );
  } else if (selectedLink !== undefined) {
    selectionPanel = (
      <StairsPanel
        state={state}
        link={selectedLink}
        onChange={(patch) => onChangeStairs(selectedLink, patch)}
        onRemove={() => onRemoveStairs(selectedLink.id)}
        crumb={<Crumb path={floorPath(selectedLink.floorIndex)} />}
      />
    );
  } else if (sel.roof === true) {
    selectionPanel = <RoofPanel style={style} dormerCount={dormerCount} roofFit={shell.roofFit} onStyle={onStyle} onUp={() => setSelection(NO_SELECTION)} />;
  } else if (selectedFloor !== undefined) {
    const idx = floorsSorted.findIndex((f) => f.index === selectedFloor.index);
    selectionPanel = (
      <FloorPanel
        floor={selectedFloor}
        rooms={state.rooms.filter((r) => r.floorIndex === selectedFloor.index).length}
        bottom={idx === 0}
        removable={floorsSorted.length > 1 && (idx === 0 || idx === floorsSorted.length - 1)}
        onHeight={(h) => onFloorHeight(selectedFloor.index, h)}
        onAddBelow={() => onAddFloor(true)}
        onRemove={() => onRemoveFloor(selectedFloor.index)}
        onUp={() => setSelection(NO_SELECTION)}
      />
    );
  } else if (selectedView !== undefined && selectedRoom !== undefined) {
    selectionPanel = (
      <PlacementPanel
        view={selectedView}
        crumb={[...floorPath(selectedRoom.floorIndex), { label: roomName(selectedRoom.id), onSelect: () => setSelection({ roomId: selectedRoom.id }) }]}
        fromLight={lightIds.has(selectedView.placement.id)}
        onToggleLock={onToggleLock}
        onRemove={onRemovePlacement}
        onRotate={() => run('Möbel gedreht', (s) => pe.rotatePlacement(s, catalog, selectedView.placement.id))}
        variant={variantControl(selectedView)}
        swaps={swapChoices}
        onSwap={(componentId, variantId) => run('Möbel getauscht', (s) => pe.swapPlacement(s, catalog, selectedView.placement.id, componentId, variantId))}
      >
        {blockOn && (
          <div className="row">
            <button
              type="button"
              onClick={startBlock}
              onPointerEnter={() => setBlockHint(br.zoneOfPlacement(session, catalog, selectedView.placement.id))}
              onPointerLeave={() => setBlockHint(undefined)}
              title="Die Funktionszone um dieses Möbel neu einrichten – der Rest des Raums bleibt, wie er ist (ein Undo-Schritt)"
            >
              Zone um dieses Möbel neu einrichten
            </button>
          </div>
        )}
      </PlacementPanel>
    );
  } else if (selectedRoom !== undefined) {
    selectionPanel = (
      <RoomPanel
        catalog={catalog}
        room={selectedRoom}
        roomNo={roomDisplayNumbers(state.rooms, selectedRoom.floorIndex).get(selectedRoom.id)}
        geometry={shell.rooms.get(selectedRoom.id)}
        roomSeed={session.project.roomSeed(selectedRoom.id)}
        views={views.filter((v) => v.placement.roomId === selectedRoom.id)}
        warnings={session.warnings.get(selectedRoom.id) ?? []}
        lightIds={lightIds}
        selectedPlacement={sel.placementId}
        onType={(id) => run('Raumtyp geändert und neu eingerichtet', (s) => uc.assignRoomType(s, catalog, selectedRoom.id, id))}
        onReroll={() => onReroll(selectedRoom.id)}
        onDelete={() => onDelete(selectedRoom.id)}
        onToggleLock={onToggleLock}
        onLockAll={(locked) => run(locked ? 'Alle Möbel gesperrt' : 'Alle Möbel entsperrt', (s) => uc.setRoomLocked(s, catalog, selectedRoom.id, locked))}
        onSelectPlacement={(placementId) => setSelection({ roomId: selectedRoom.id, placementId })}
        floorHeight={uc.floorOf(state, selectedRoom.floorIndex)?.height}
        density={uc.roomDensity(session, selectedRoom.id)}
        onDensity={(d) => onDensity(selectedRoom.id, d)}
        quality={session.quality?.get(selectedRoom.id)}
        unreachable={circulationReport?.unreachable.includes(selectedRoom.id) === true}
        onRemovePlacement={onRemovePlacement}
        crumb={<Crumb path={floorPath(selectedRoom.floorIndex)} />}
        onVariant={(v) => run(`Variante ${v + 1}`, (s) => uc.setRoomVariant(s, catalog, selectedRoom.id, v))}
        onFix={(fixed) => run(fixed ? 'Raum fixiert (bleibt bei Bautyp-Neubau)' : 'Fixierung gelöst', (s) => uc.fixRoom(s, catalog, selectedRoom.id, fixed))}
        block={
          blockOn ? (
            <BlockRefurnishRow
              zones={roomZones.length}
              margin={blockMargin}
              marginRange={br.BLOCK_MARGIN}
              picking={blockRoom === selectedRoom.id}
              onZone={(i) => {
                const z = roomZones[i];
                if (z !== undefined) onBlock(selectedRoom.id, z);
              }}
              onHoverZone={(i) => setBlockHint(i === undefined ? undefined : { roomId: selectedRoom.id, cells: roomZones[i]! })}
              onPickRect={(on) => {
                setBlockRoom(on ? selectedRoom.id : undefined);
                if (on) setStatus({ text: 'Bereich neu einrichten: Rechteck im Raum ziehen (Esc bricht ab)', error: false });
              }}
              onMargin={setBlockMargin}
            />
          ) : undefined
        }
      />
    );
  } else if (houseMore) {
    selectionPanel = (
      <HouseMorePanel
        onBack={() => setHouseMore(false)}
        palettes={load.palettes ?? []}
        paletteId={state.paletteId}
        onPalette={(id) => run('Farbwelt gewählt', (s) => uc.setPalette(s, catalog, id))}
        storyState={state.storyState}
        onStoryState={onStoryState}
        mood={state.mood}
        themeMood={uc.shellThemeOf(catalog, state.themeId)?.mood}
        onMood={onMood}
        interiorDecor={state.interiorDecor}
        onInteriorDecor={onInteriorDecor}
        minAisle={session.minAisle === true}
        onMinAisle={onMinAisle}
        style={style}
        themeDecorate={themeDecorate}
        quoins={quoins}
        exterior={exterior}
        exteriorMark={exteriorPart}
        onStyle={onStyle}
        onRerollAll={onRerollAll}
        canRerollAll={state.rooms.length > 0}
        shellWarnings={shell.warnings}
      />
    );
  } else {
    const n = state.floors.filter((f) => f.index >= 0).length;
    const cellar = state.floors.length - n;
    selectionPanel = (
      <HousePanel
        title={originDef !== undefined ? bt.typeLabel(originDef) : state.name}
        meta={`${n} ${n === 1 ? 'Etage' : 'Etagen'}${cellar > 0 ? ' + Keller' : ''} · ${state.rooms.length} ${state.rooms.length === 1 ? 'Raum' : 'Räume'} · ${state.placements.length} Möbel`}
        themes={load.themes}
        themeId={state.themeId}
        onTheme={(id) => run('Stil gewählt', (s) => uc.setTheme(s, catalog, id))}
        roof={style.roof}
        onRoof={() => {
          // Dach wählen: in „Dach ab“/„Wände ab“ wäre es unsichtbar – Ansicht „Komplett“
          setSelection({ roof: true });
          if (view !== 'full') setView('full');
        }}
        exteriorOn={style.exterior.enabled}
        onExterior={(enabled) => onStyle({ exterior: { ...style.exterior, enabled } })}
        onExteriorReroll={() => onStyle({ exterior: { ...style.exterior, variation: style.exterior.variation + 1 } })}
        type={originDef === undefined || typeCtx === undefined ? undefined : { onReroll: onTypeReroll, onAdjust: () => setTypeDialog(true) }}
        accessHints={access}
        onMore={() => setHouseMore(true)}
        empty={!hasContent(state)}
      />
    );
  }

  return (
    <div className={`workbench layout-${layout}${mode === 'house' ? ' rail-mode' : ''}`}>
      <Header
        brand={
          <span className="brand" title={`${PRODUCT_NAME} – Editor (Name ist ein Platzhalter)`}>
            <BrandMark />
            <span className="brand-name">{PRODUCT_NAME}</span>
          </span>
        }
        name={state.name}
        onRename={onRename}
        canUndo={uc.canUndo(session)}
        canRedo={uc.canRedo(session)}
        onUndo={onUndo}
        onRedo={onRedo}
        canWizard={typeCtx !== undefined}
        onWizard={() => openWizard(false)}
        onNewEmpty={onEmptyProject}
        onOpenFile={onOpenFile}
        exportBlocked={exportBlocked}
        onExport={() => setExportOpen(true)}
        storeAvailable={store !== undefined}
        stored={stored === undefined ? undefined : `${stored.name}${formatDate(stored.savedAt) !== '' ? ` · ${formatDate(stored.savedAt)}` : ''}`}
        onSaveLocal={onSaveLocal}
        onLoadLocal={onLoadLocal}
        onSaveFile={onSaveFile}
        onShareLink={onShareLink}
        onHelp={() => setHelpOpen(true)}
        onInfo={() => setInfoOpen(true)}
        onPalette={() => setPaletteOpen(true)}
      >
        {/* Fortsetzen als Zeile in der Kopfleiste statt schwebend (R1-11/R1-17: überdeckte mobil Hinweis, Leerzustand
            und Werkzeuge; brach bei 1440 unschön um) */}
        {resumeVisible && stored !== undefined && (
          <div className="resume-offer" role="status">
            <span className="resume-text">{resumeLabel(stored)}</span>
            <span className="resume-actions">
              <button type="button" className="primary" onClick={() => { onLoadLocal(); setResumeDismissed(true); }}>
                Fortsetzen
              </button>
              <button type="button" onClick={() => setResumeDismissed(true)}>
                Neues Projekt
              </button>
            </span>
          </div>
        )}
        <SmallScreenHint />
      </Header>

      {mode === 'site' ? (
        siteMode.toolbar(<ModeSwitch mode={mode} onMode={setMode} />)
      ) : (
        <ToolRail
          catalog={catalog}
          mode={mode}
          onMode={setMode}
          tool={tool}
          onTool={chooseTool}
          paintType={paintType}
          onPaintType={setPaintType}
          stairTool={stairTool}
          onStairTool={setStairTool}
          fit={{ styles: uc.styleChain(catalog, state.themeId), themeName, height: activeFloorDef?.height, floorName: uc.floorLabel(floor) }}
        />
      )}

      {/* W8-D: offene Werkzeug-Leiste (Raumtypen, Treppe) schiebt den eingeblendeten Grundriss nach rechts */}
      <main className={`stage${mode === 'house' && (tool === 'paint' || tool === 'stairs') ? ' with-flyout' : ''}`}>
        {layout === 'split' && (
          <section className="plan-pane" aria-label="Grundriss">
            {planHead}
            {plan}
          </section>
        )}
        <section className="view-pane" aria-label="3D-Ansicht">
          <div
            className="view-body"
            onWheelCapture={(e) => { if ((e.target as Element).closest('.viewer') !== null) leaveEyeCut(); }}
            onPointerMoveCapture={(e) => { if (e.buttons !== 0 && (e.target as Element).closest('.viewer') !== null) leaveEyeCut(); }}
          >
            <ErrorBoundary label="3D-Ansicht" resetKey={source} onError={(text) => setStatus({ text, error: true })}>
              {viewer}
            </ErrorBoundary>
            <FloorBar items={floors} onSelect={onFloorBar} onAdd={() => onAddFloor(false)} autoStairs={autoStairsOn} onAutoStairs={onAutoStairs} />
            {chip !== undefined && (
              <div className="scope-chip" role="status">
                {chip}
              </div>
            )}
            {layout === 'overlay' && (
              <div className="plan-overlay plan-pane" aria-label="Grundriss">
                {planHead}
                {plan}
              </div>
            )}
            <StageControls
              planShown={planShown}
              onTogglePlan={() => setLayout(planShown ? '3d' : dock)}
              view={view}
              onView={chooseView}
              cut={{ min: range.min, max: cutMax, value: cutY ?? cutMax, label: cutLabel, onChange: (v) => { eyeRestoreRef.current = undefined; setCutValue(v); } }}
              floorView={floorView}
              onFloorView={(f) => { eyeRestoreRef.current = undefined; setFloorView(f); }}
              onFit={() => { leaveEyeCut(); viewportRef.current?.fit(highlight); }}
              onEyeLevel={onEyeLevel}
              options={options}
              source={source}
              onPreview={choosePreview}
              grid={grid}
              onGrid={setGrid}
              showAround={showAround}
              onShowAround={setShowAround}
              dock={dock}
              onDock={(d) => {
                setDock(d);
                setLayout(d);
              }}
              lightBar={source === 'textures' ? lightBar : undefined}
              onLightBar={setLightBar}
            />
          </div>
        </section>
        {showStart && (
          <EmptyStart
            canDescribe={typeCtx !== undefined}
            resumeName={resumeVisible ? stored?.name : undefined}
            onDescribe={() => openWizard(true)}
            onPaint={() => {
              setStartDismissed(true);
              chooseTool('paint');
              setStatus({ text: `Raum (${shortcutHint('tool.paint')}): Raumtyp links wählen, dann im Grundriss ein Rechteck aufziehen – der Raum wird sofort eingerichtet`, error: false });
            }}
          />
        )}
      </main>

      <aside className="inspector">
        <InspectorTabs tab={inspTab} onTab={setInspTab} />
        {inspTab === 'material' ? (
          <MaterialPanel
            world={blocksInWorker ? preview.material : world.current ? world.world : undefined}
            busy={blocksInWorker ? preview.busy : world.busy}
            version={state.targetVersion.name}
            rules={session.blockRules}
            hiddenVariants={hiddenCount}
            hasSurroundings={blocksInWorker ? preview.hasSurroundings : world.world?.surroundings !== undefined}
            themeRoles={themeRoles}
            onPreset={onPreset}
            onBan={onBan}
            onReplace={onReplace}
            onCopy={onCopyMaterials}
            palette={{ view: paletteView, overrides: state.paletteOverrides, families: paletteFamilies, onChange: onPaletteOverrides, onRoll: onPaletteRoll }}
          />
        ) : (
          selectionPanel
        )}
      </aside>

      <footer className="statusbar">
        <p className={status?.error === true ? 'status error' : 'status'} role={status?.error === true ? 'alert' : 'status'}>
          {status?.text ?? 'Bereit.'}
          {status?.error === true && (
            <button type="button" className="link" onClick={() => setStatus(undefined)} aria-label="Meldung schließen">
              ✕
            </button>
          )}
        </p>
        {autosaveText !== undefined && <span className={`muted small autosave${autosave?.error !== undefined || autosave?.blocked !== undefined || store === undefined ? ' warn' : ''}`}>{autosaveText}</span>}
        <span className="muted small stats" title={source !== 'roles' && stats !== undefined ? durationTitle('Dauer der Vorschau', statsMs) : undefined}>
          {source !== 'roles' && stats !== undefined
            ? previewStatsText({ blocks: stats.blocks, themeName, version: stats.version, darkCells: stats.darkCells })
            : `${visibleVoxels.length} Quader · Möbel ${counts.furniture} · Licht ${counts.light}`}
          {texNote !== undefined && source === 'textures' ? ` · ${texNote}` : ''}
        </span>
        <span className="disclaimer" title="Die App enthält keine Minecraft-Texturen; „Texturen“ nutzt nur dein eigenes JAR, lokal im Browser. Impressum und Kontakt folgen vor der Veröffentlichung.">
          {DISCLAIMER}
        </span>
      </footer>

      {exportOpen && (
        <ExportDialog
          state={state}
          themeName={themeName}
          format={format}
          onFormat={setFormat}
          onVersion={onVersion}
          world={blocksInWorker ? { world: undefined, current: preview.current, busy: preview.busy, error: preview.error, ms: preview.ms } : world}
          report={report}
          lighting={session.needsLight}
          blocked={exportBlocked ?? (streamGzipAvailable() ? undefined : 'Dieser Browser kann keine GZip-Dateien erzeugen (CompressionStream fehlt).')}
          downloading={downloading}
          onDownload={() => void onDownload()}
          onGuide={(kind) => void onGuide(kind)}
          onClose={onCloseExport}
        />
      )}
      {helpOpen && <HelpOverlay onClose={onCloseHelp} />}
      {paletteOpen && <CommandPalette items={paletteItems} onRun={onPaletteRun} onClose={() => setPaletteOpen(false)} />}
      {typeDialog && originDef !== undefined && (
        <BuildingTypePanel
          def={originDef}
          params={bt.originParams(session, originDef)}
          rooms={bt.roomOrigins(session)}
          onApply={(params) => {
            setTypeDialog(false);
            onTypeParams(params);
          }}
          onStyle={() => {
            setTypeDialog(false);
            onTypeStyle();
          }}
          onClose={() => setTypeDialog(false)}
        />
      )}
      {infoOpen && (
        <ProjectInfoDialog
          facts={[
            ['Seed', <span className="mono">{state.seed}</span>],
            ...(state.origin !== undefined && originDef !== undefined
              ? ([['Bautyp', `${bt.typeLabel(originDef)} · Plan-Seed ${state.origin.seed}${state.origin.rerollCount > 0 ? ` · ${state.origin.rerollCount}× neu gewürfelt` : ''}`]] as const)
              : []),
            ['Umfang', `${state.rooms.length} Räume · ${state.placements.length} Möbel · ${state.floors.length} ${state.floors.length === 1 ? 'Etage' : 'Etagen'} · ${state.links.length} ${state.links.length === 1 ? 'Treppe' : 'Treppen'}`],
            ['Licht', <span className={lightWarning ? 'warn-text' : undefined}>{lightText}{lightIds.size > 0 ? ` (${lightIds.size} vom Pass)` : ''}</span>],
            ['Zielversion', `Minecraft ${state.targetVersion.name} (wählbar im Export-Dialog)`],
          ]}
          texture={{
            state: texState,
            notice: textures.notice,
            cached: textures.cached,
            canReadJar: textures.canReadJar,
            onLoadJar: (file) => {
              textures.loadJar(file);
              setPreviewChoice('textures');
            },
            onClearCache: textures.clearCache,
          }}
          catalog={{
            summary: `${catalog.size} Komponenten, ${catalog.roomTypeIds().length} Raumtypen, ${load.themes.length} Themes aus ${load.files} Dateien · Hülle und Licht-Pass: @mcda/pipeline, Einrichtung: Solver v2 (@mcda/furnishing)`,
            warnings: load.warnings,
          }}
          onClose={() => setInfoOpen(false)}
        />
      )}
      {wizardOpen && typeCtx !== undefined && (
        <BuildingTypeWizard
          types={load.buildingTypes}
          ctx={typeCtx}
          themes={load.themes}
          palettes={load.palettes}
          currentTheme={state.themeId}
          currentPalette={state.paletteId}
          currentPaletteOverrides={state.paletteOverrides}
          currentStyle={style}
          randomSeed={randomSeed}
          roomTypeName={roomTypeName}
          onAccept={onAcceptType}
          describe={describe}
          designIterative={design}
          request={describeRequest}
          focusDescribe={focusDescribe}
          onEmpty={onEmptyProject}
          onClose={onCloseWizard}
          pipeline={pipeline}
        />
      )}
      {pendingFloorRemove !== undefined && (
        <ConfirmDialog
          title={`${uc.floorLabel(pendingFloorRemove.index)} entfernen?`}
          body={floorRemovalText(state, pendingFloorRemove.index, uc.floorLabel)}
          confirmLabel="Etage löschen"
          cancelLabel="Behalten"
          onConfirm={() => { const r = pendingFloorRemove.run; setPendingFloorRemove(undefined); r(); }}
          onCancel={() => setPendingFloorRemove(undefined)}
        />
      )}
      {pendingReplace !== undefined && (
        <ConfirmDialog
          title={pendingReplace.title}
          body={pendingReplace.body}
          confirmLabel={pendingReplace.confirmLabel ?? 'Ersetzen'}
          cancelLabel="Behalten"
          onConfirm={() => { const r = pendingReplace.run; setPendingReplace(undefined); r(); }}
          onCancel={() => setPendingReplace(undefined)}
        />
      )}
    </div>
  );
}

/** Hinweis über der Blockvorschau: Licht / wird berechnet / Fehler / nichts. */
function blockOverlay(w: { readonly busy: boolean; readonly error: string | undefined; readonly has: boolean }, lighting: boolean): string | undefined {
  if (lighting) return 'Lichter werden ergänzt …';
  if (w.error !== undefined) return `Materialisierung fehlgeschlagen: ${w.error}`;
  if (w.busy) return !w.has ? 'Blöcke werden berechnet (Plattform-Daten laden) …' : 'Blöcke werden aktualisiert …';
  return undefined;
}
