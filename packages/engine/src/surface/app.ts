/**
 * Abdeckung der Web-App (ADR 12): JEDE exportierte Funktion der App-Module ist einer API-Operation (bzw. einem
 * Aggregat-Befehl) zugeordnet oder als reine UI-/Ansichts-Hilfe eingeordnet. `packages/app/test/engineSurface.test.ts`
 * vergleicht diese Liste mit den echten Exporten: Eine neue App-Funktion ohne Eintrag lässt den Test scheitern –
 * wer ein Feature in die App baut, muss sagen, wie die API es kann.
 */
import type { OperationId } from '../operation.js';

export type AppExposure =
  /** Über diese Operation erreichbar; bei project_command/site_command mit dem Befehl. */
  | { readonly op: OperationId; readonly command?: string }
  /** Kein Nutzer-Feature: Beschriftung, Ansicht, Cache, Editor-Raster, Datei-Adapter. Begründung Pflicht. */
  | { readonly internal: string };

const op = (id: OperationId): AppExposure => ({ op: id });
const cmd = (command: string): AppExposure => ({ op: 'project_command', command });
const site = (command: string): AppExposure => ({ op: 'site_command', command });
const ui = { internal: 'Beschriftung/Anzeige der App' } as const;
const view = { internal: 'Ansichtsmodell/abgeleitete Daten der App (API: project_get)' } as const;
const plumbing = { internal: 'Session-/Undo-Mechanik oder Cache der App' } as const;
const check = { internal: 'Eingabeprüfung der App (API: zod-Schema und Aggregat-Invarianten)' } as const;
const style = op('project_style');
const structures = op('project_structures');

/** Module der App, die Use Cases enthalten → Zuordnung je Export. */
export const APP_SURFACE: Readonly<Record<string, Readonly<Record<string, AppExposure>>>> = {
  usecases: {
    act: plumbing, withShellStep: plumbing, withUndoStep: plumbing, replaceSession: plumbing, canUndo: ui, canRedo: ui,
    undo: op('project_undo'), redo: op('project_redo'),
    createSession: op('project_create'), sessionFromProject: op('project_load'),
    paintRect: cmd('paintRoom'), eraseRect: cmd('eraseCells'), deleteRoom: cmd('eraseCells'),
    assignRoomType: cmd('assignRoomType'), rerollRoom: cmd('rerollRoom'), rerollAll: cmd('rerollRoom'),
    setRoomDensity: op('project_furnish'), roomDensity: view,
    setMinAisle: op('project_furnish'), // P07: Mittelgang verbindlich – dasselbe Feld wie in project_furnish
    // W3-BL: Blöcke sperren und ersetzen – project_style `blockRules` (auch building_generate/rooms_generate)
    setBlockRules: style,
    // F-Ensemble: Verbindungsgraph in der Hülle der App (Auflösung wie generateBase; Kontext-Registrierung ist Adapter-Sache)
    configureEnsemble: plumbing, ensembleOfSession: { internal: 'Hülle/Umgebung mit Verbindungsgraph (Regel: resolveEnsemble in @mcda/pipeline, in project_generate/building_generate über generateBase)' },
    ensembleCatalog: plumbing,
    selectionCatalog: { internal: 'Auswahl-Sicht der Block-Regeln für die App (Regel: blockRulesCatalog in @mcda/pipeline; die API wendet sie in project_furnish/project_generate an)' },
    toggleLock: cmd('lockPlacement'), setRoomLocked: cmd('lockPlacement'), removePlacement: cmd('removePlacement'),
    // W2-ED U4: Räume nachbearbeiten – Variante ◀ ▶, fixieren, Kante ziehen (Raum behält ID und Sperren)
    setRoomVariant: cmd('setRoomVariant'), fixRoom: cmd('fixRoom'), resizeRoom: cmd('resizeRoom'),
    setTheme: cmd('setTheme'), setPalette: cmd('setPalette'), setPaletteOverrides: cmd('setPaletteOverrides'), setTargetVersion: cmd('setTargetVersion'), renameProject: cmd('rename'), cleanName: check,
    setStoryState: cmd('setStoryState'), storyStateLabel: ui,
    setInteriorDecor: cmd('setInteriorDecor'), interiorDecorLabel: ui, // feat/int-decor: Projektfeld `interiorDecor`
    setMood: cmd('setMood'), moodFor: view, moodChangeLabel: ui, // feat/theme-moods: Projektfeld `mood` (auch building_generate/rooms_generate)
    addFloor: cmd('addFloor'), removeFloor: cmd('removeFloor'), setFloorHeight: cmd('setFloorHeight'),
    placeStairs: cmd('placeStairs'), changeStairs: cmd('placeStairs'), removeStairs: cmd('removeStairs'),
    stairsBlockedByFixed: cmd('placeStairs'), // gemeinsame Regel (@mcda/pipeline fixedFurnitureInStairs), auch im Befehl placeStairs
    removedStairs: view, specLink: view, stairsRemovedBy: view, historyOrSwitch: plumbing,
    // W11-A: Treppen automatisch aus den Räumen – project_auto_stairs (Regel planAutoStairs in @mcda/pipeline)
    autoStairs: op('project_auto_stairs'), disconnectedFloors: view,
    autoStairsPref: { internal: 'Browser-Einstellung „Treppen automatisch“ (API: project_auto_stairs bzw. rooms_generate.autoStairs)' },
    saveAutoStairsPref: { internal: 'Browser-Einstellung „Treppen automatisch“ (API: project_auto_stairs bzw. rooms_generate.autoStairs)' },
    setShellStyle: style, setRoof: style, shellOptions: style, roofDetailOptions: style, facadeOptions: style,
    dormerOptions: style, exteriorOptions: style, shellStyle: view, settingsOf: view,
    roofDetailProblem: check, facadeProblem: check, dormerProblem: check, exteriorProblem: check,
    dormerName: ui, dormerCount: view, exteriorDensityLabel: ui, styleChangeLabel: ui, usesHalfHipRows: ui, usesMansardBreak: ui,
    floorLabel: ui, errorMessage: ui, shellKey: plumbing, styleKey: plumbing, geometryKey: plumbing,
    shellOf: view, exteriorOf: view, exteriorViews: view, groundExterior: view, placedViews: view, lightPlacementIds: view,
    attachedTowersOf: view, floorOf: view, roomAt: view, styleChain: view,
    clampRect: { internal: 'Editor-Raster der App (API: Rechtecke in Weltblöcken)' },
    rectCells: { internal: 'Editor-Raster der App (API: Rechtecke in Weltblöcken)' },
    bindThemes: { internal: 'Katalog-Bindung beim Laden der App' },
    bindPalettes: { internal: 'Katalog-Bindung beim Laden der App (Paletten, Q4)' },
    palettesOf: { internal: 'Paletten des gebundenen Katalogs (Ansicht der App; API: catalog_list Art palette)' },
    shellThemeOf: { internal: 'Theme-Auflösung aus der Katalog-Bindung der App (API: Kontext löst das Theme selbst auf)' },
  },
  surroundings: {
    setSurfaceTexture: style, surfaceTextureOf: view, // TX-B: project_style { surfaceTexture } (auch building_generate/rooms_generate)
    setWeathering: style, weatheringOf: view, // WS-Verwitterung: project_style { weathering } (auch building_generate/rooms_generate)
    setSiteDecor: style, siteDecorOf: view, // feat/site-decor: project_style { siteDecor } (auch building_generate/rooms_generate)
    setEnsemble: style, ensembleOn: view, // F-Ensemble: project_style { ensemble } (auch building_generate/rooms_generate)
    setLandform: style, landformOf: view, // feat/gelaende: project_style { landform } (auch building_generate/rooms_generate)
    setTerrainEnabled: op('site_create'), applySiteTemplate: site('applyTemplate'), setTerrainStyle: site('setStyle'),
    setPlot: site('resizePlot'), fitPlot: site('resizePlot'), rerollTerrain: site('reroll'),
    paintZone: site('paintZone'), eraseZones: site('eraseZones'), removeZone: site('eraseZones'), setZoneKind: site('setZoneKind'),
    setZoneEdge: site('setZoneEdge'), sculpt: site('sculpt'), resetAllTerrain: site('resetTerrain'),
    setSiteLighting: site('setLighting'), setVegetation: site('setVegetation'),
    addWall: structures, updateWall: structures, addGate: structures, removeGate: structures, removeGateAt: structures,
    addTower: structures, updateTower: structures, setTowerChoice: structures, addWindmill: structures, updateWindmill: structures,
    addAnnexTower: structures, setAnnexChoice: structures, moveStructure: structures, removeStructure: structures,
    readSurroundings: op('project_load'),
    annexAt: view, annexChoiceOf: view, hasSurroundings: view, nearestWall: view, siteLighting: view, siteOf: view, siteStateOf: view,
    structureAt: view, structureById: view, structureDistance: view, structureIdFromOwner: view, styleLighting: view,
    towerChoiceOf: view, towerSize: view, towerSpecOf: view, towerStyleOf: view, vegetationOf: view, zoneAt: view, plotFor: view,
    annexLabel: ui, hasEdge: ui, lightingLabel: ui, lightingSummary: ui, parapetNotice: ui, siteSummary: ui, structureLabel: ui, topHasRoof: ui, zoneLabel: ui,
    cleanPoints: check, fitRoofShape: check, houseInPlot: check, houseRect: check,
  },
  buildingTypes: {
    typeSession: op('project_create'), changeTypeParams: cmd('applyBuildingType'), applyTypeStyle: cmd('applyBuildingType'),
    rerollType: cmd('rerollBuildingType'), proposal: op('building_propose'), proposalSeeds: op('building_propose'),
    planFacts: op('building_propose'), typeSummary: op('catalog_get'), sizesOf: op('catalog_describe'), defaultParams: op('catalog_get'),
    bindBuildingTypes: { internal: 'Katalog-Bindung beim Laden der App' }, boundTypes: plumbing,
    centerOffset: { internal: 'Editor-Raster der App (API: Lage frei in Weltblöcken)' },
    floorChoices: ui, galleryTabs: ui, typeLabel: ui, isDraft: view, isFixed: view, originParams: view, originType: view,
    placementOf: view, roomOrigins: view, typeBuildOptions: plumbing, typeStyle: plumbing, withSize: plumbing,
    styleFromBuild: op('project_save'), // @mcda/projectfile: Stil → Einstellungen (project_save format app)
    withoutPilastersForTheme: op('building_generate'), // gemeinsame Regel (@mcda/pipeline), auch project_create/applyBuildingType
    // W1-G (M2): Vorschläge ohne Doppel – Seeds mit Reserve, Auswahl über planLayoutKey/distinctPicks (@mcda/pipeline)
    proposalCandidates: op('building_propose'), proposalCount: op('building_propose'), proposalRound: op('building_propose'),
    // W8-E: spielbare Vorschläge – Prüfung (playabilityIssues), Hinweis und Zählung wie building_propose (playable, notice)
    proposalPlayability: op('building_propose'), playabilityNotice: op('building_propose'), playableCount: op('building_propose'),
    // feat/pareto-proposals: bewertete Vorschläge (building_propose mit pareto; Regel evaluateCandidate/pickProposals aus @mcda/pipeline)
    paretoSeeds: op('building_propose'), paretoCandidate: op('building_propose'),
    // W2-ED U1: Umfang eines Bautyp-Neubaus (Domäne `buildingTypeScope`; die Befehle applyBuildingType/rerollBuildingType
    // halten dieselben Räume – eigene und solche mit gesperrten/manuellen Möbeln), Rückfrage und Statuszeile
    // W2-1: Funktionsgrad – Auswahl im Panel/Assistenten; die API hat `functionLevel` in building_generate/_propose/project_create
    hasFunctionRooms: op('building_generate'),
    typeScope: view, replansLayout: view, typeReplaceConfirm: ui, typeReplaceStatus: ui,
    inheritedStyle: { internal: 'Anzeige des Assistenten (L4): was eine feste Vorlage vom bisherigen Projekt erbt – die API baut immer den ganzen Stil des Bautyps' },
  },
  exporting: {
    exportProject: op('project_generate'), exportReport: op('project_generate'),
    exportFileName: ui, fileBaseName: ui, volumeTooLarge: op('project_generate'), // gemeinsame Regel (@mcda/pipeline), alle Generier-Operationen
    placeHint: ui, templateId: ui, // Anleitung je Format im Export-Dialog (Ordner, Befehle)
    nothingToExport: check, // Knopf „Exportieren …“ gesperrt ohne Inhalt (API: project_generate meldet leere Projekte selbst)
    rememberWorld: plumbing, worldOf: plumbing,
    // DR5 K2: Bauplan (Markdown) und Materialliste (CSV) im Export-Dialog – dieselbe Funktion buildGuide wie build_guide
    exportGuide: op('build_guide'), guideFileName: ui,
  },
  projectFile: {
    serializeProject: op('project_save'), toProjectFile: op('project_save'), saveToStore: op('project_save'),
    parseProjectFile: op('project_load'), loadFromStore: op('project_load'), projectFileName: ui, storedInfo: ui,
    // Format, Version/Migration und Grenzen in @mcda/projectfile; project_load liest .projekt.json, project_save schreibt sie (format app)
  },
  nlPrompt: {
    describeBuilding: { internal: 'NL-Adapter der App: POST /v1/interpret des Engine-Servers, sonst lokaler Klassifikator (@mcda/engine/intent)' },
    suggestionFor: op('building_generate'), // Anfrage (building_generate/_propose/project_create) → Parameter des Bautyp-Assistenten
    engineBaseUrl: { internal: 'Konfiguration der App (Vite-Proxy /engine bzw. VITE_ENGINE_URL, auch relativ wie `..`)' },
    confidenceText: { internal: 'Darstellung der App (Tooltip: Konfidenz je Feld aus /v1/interpret, JEV)' },
    sourceText: { internal: 'Darstellung der App (Quelle der Erkennung in Nutzersprache: JEV, Server-lokal, Browser-lokal)' },
    describeOutcome: op('building_generate'), // Erkennung → Vorschlag oder Rückfrage (unter TYPE_CONFIDENCE_MIN); /v1/interpret liefert confidence.buildingTypeId
    typeConfidence: { internal: 'Darstellung der App (S2): Sicherheit des Bautyps aus /v1/interpret (JEV) bzw. classifyLocal für „Kein Bautyp sicher erkannt“' },
    withLocalConfidence: { internal: 'NL-Adapter der App (S2): lokale Sicherheit (classifyLocal, dasselbe Vokabular wie der Server) für Erkennungen ohne Bautyp-Konfidenz' },
    // F-JEV-iterativ: „Planen & verbessern“ – POST /v1/execute design_iterate (JEV als Planer und Kritiker, Schalter ENGINE_NL_ITERATE)
    designIterative: op('design_iterate'),
    designExtras: { internal: 'Darstellung der App: Nebenteile und weitere Nutzungen aus dem Plan von design_iterate in Worten' },
    designHistory: { internal: 'Darstellung der App: Verlauf der Runden von design_iterate (Planen, Prüfen, Wählen) in Zeilen' },
  },
  // Einbettungs-Protokoll Website ⇄ Editor (W1): transportiert nur, was /v1/interpret liefert – keine eigene Fähigkeit.
  embed: {
    acceptDescribe: { internal: 'Einbettung der App: postMessage nur vom eigenen Ursprung und Elternfenster (API: /v1/interpret liefert dieselbe Anfrage)' },
    announceReady: { internal: 'Einbettung der App: „bereit“ an die Website (postMessage)' },
    cleanPrompt: check,
    embedOptions: { internal: 'Einbettung der App: ?embed=1 und Deep-Link ?describe= (API: POST /v1/interpret mit dem Text)' },
    parseDescribe: check,
    parseInterpretation: check, // Form der Antwort von /v1/interpret, von der Website weitergereicht
    readyMessage: ui,
    receiveDescribe: check, // Absender und Form; falsche Form → nookwright:rejected (R1-08)
    rejectedMessage: ui,
    announceRejected: { internal: 'Einbettung der App: „abgelehnt“ mit Grund an die Website (postMessage)' },
  },
  stairs: { linkLayout: view, stairsAt: view, stairsPreview: view, rotateFacing: ui, stairsLabel: ui },
  // W2-ED U5: Möbel bearbeiten – Verschieben/Drehen = Befehl movePlacement, Tauschen/Variante = Befehl swapPlacement;
  // Alternativen = catalog_list nach Tags. W3-BL: Passt-Prüfung und „Aufliegendes folgt“ liegen in @mcda/pipeline
  // (placementRules) – die Befehle movePlacement (bewegt aufgesetzte Teile mit) und swapPlacement prüfen genauso
  placementEdit: {
    nudgePlacement: cmd('movePlacement'), rotatePlacement: cmd('movePlacement'), swapPlacement: cmd('swapPlacement'),
    swapOptions: op('catalog_list'), placementProblem: cmd('movePlacement'), nextVariant: ui,
    // W7-G: Ziehen mit der Maus – Vorschau mit derselben Prüfung, die movePlacement anwendet
    nudgeProblem: cmd('movePlacement'),
  },
  // F „Bereich neu einrichten“ (WFC 3.2): dieselbe Regel wie project_refurnish_block (@mcda/pipeline refurnishBlock)
  blockRefurnish: {
    refurnishBlock: op('project_refurnish_block'), roomZonesOf: op('project_refurnish_block'), // Zonen stehen im Ergebnis (zones)
    zoneOfPlacement: view, blockRefurnishText: ui, blockCellsIn: check,
    blockRefurnishEnabled: { internal: 'Schalter des Feature-Branches (Anzeige des Befehls in der App)' },
  },
  // DR5 K4: Teilen per URL – Bautyp, Seed und Parameter im Fragment (@mcda/projectfile); der Engine-Weg für denselben Bau
  // ist building_generate mit denselben Parametern
  shareLink: {
    shareBuildOf: op('building_generate'), sessionFromShare: op('building_generate'),
    shareUrlOf: { internal: 'Link-Adapter der App (Fragment an die Seiten-URL hängen)' }, shareLosesEdits: ui,
  },
  templates: { templateSession: op('project_create'), templateTypes: op('catalog_list') },
  lighting: { lightSession: op('project_generate'), lightStatus: ui, summarize: ui },
  selection: {
    exteriorPartInfo: view, exteriorPartText: ui, selectionBox: view, selectionFromOwner: view, validSelection: check,
    // W2-ED U3: Auswahl-Ebenen (Esc eine Ebene hoch) und Einpassen aufs Haus – Ansicht, keine Fähigkeit
    parentSelection: view, selectionLevel: ui, houseBox: view,
  },
  surroundingsWorld: {
    baseWorldOf: op('project_generate'), buildingKey: plumbing, cachedSurroundings: plumbing, exteriorKey: plumbing, outdoorColor: ui,
    structuresInput: plumbing, surroundingsInput: plumbing, surroundingsOf: plumbing, surroundingsVoxels: plumbing,
    volumeOf: plumbing, // Raum → Baukörper (BT01 Wehrplatten); die Regel selbst ist `parapetSpecsFor` in @mcda/pipeline
  },
};

/** App-Module ohne Use Cases (reine Darstellung, Adapter, React-Hooks) – mit Begründung. */
export const APP_MODULES_WITHOUT_USECASES: Readonly<Record<string, string>> = {
  blockColors: 'Vorschaufarben je Block (Darstellung)',
  brand: 'Produktname (Platzhalter) und Pflicht-Disclaimer (Beschriftung)',
  colors: 'Farbpalette der Oberfläche',
  pixelTextures: 'eigene Pixeltexturen der Vorschau „Blöcke“ (Darstellung)',
  catalogLoader: 'Adapter: lädt den Katalog im Browser (API: Node-Kontext)',
  useSurroundings: 'React-Hook (Zustand der Oberfläche)',
  useWorld: 'React-Hook (Zustand der Oberfläche)',
  main: 'Einstiegspunkt der Oberfläche',
  App: 'Oberfläche (React-Komponente); ruft die Use Cases oben auf',
};

/** Unterordner der App: Oberfläche und Adapter, keine Use Cases (die liegen in den Modulen oben). */
export const APP_UI_FOLDERS: Readonly<Record<string, string>> = {
  adapters: 'Browser-Adapter (Speicher, Download, Texturen, gzip)',
  dev: 'Entwickler-Galerie',
  editor: 'Zeichenflächen (Raster-Umrechnung, Maus)',
  textures: 'Texturen der 3D-Vorschau',
  ui: 'React-Panels und Ansichtsmodelle',
  viewer: '3D-Vorschau',
};
