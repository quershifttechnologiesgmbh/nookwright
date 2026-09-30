/**
 * Heimat-Tabelle (W2-ED U2, Konzept W2UX §3 „Wohin wandert was“): JEDE Einstellung bzw. Aktion der Oberfläche vor dem
 * Umbau (Stand W2UX-Bestandsaufnahme, 138–228 sichtbare Elemente) hat GENAU EINEN neuen Ort – oder ist als Doppel mit
 * einem anderen Eintrag zusammengelegt (`merged`). Nichts wird gestrichen, nur verlegt.
 *
 * Geprüft in `test/controlHomes.test.ts`: Ziele der Zusammenlegungen existieren, kein Ort ist doppelt belegt, jede
 * Beschriftung steht wörtlich in einer Quelldatei ihres Orts, jedes Feld des Hüllen-Stils (`ShellStyle`) und jede
 * Nutzer-Funktion aus `APP_SURFACE` (usecases, buildingTypes) hat eine Heimat. Rein, ohne DOM.
 */

/** Orte der neuen Oberfläche. */
export type Home =
  | 'Kopf'
  | 'Kopf › Neu ▾'
  | 'Kopf › ⋯'
  | 'Werkzeug-Schiene'
  | 'Werkzeug-Schiene › Raum'
  | 'Werkzeug-Schiene › Treppe'
  | 'Bühne'
  | 'Bühne › Schnitt ▾'
  | 'Bühne › Ansicht ▾'
  | 'Bühne › Etagen-Leiste'
  | 'Bühne › Licht-Leiste'
  | 'Haus'
  | 'Haus › Mehr'
  | 'Haus › Bautyp anpassen'
  | 'Dach'
  | 'Grundriss'
  | 'Etage'
  | 'Raum'
  | 'Raum › Möbel'
  | 'Möbel'
  | 'Treppe'
  | 'Außen-Teil'
  | 'Material'
  | 'Umgebung'
  | '⋯ › Projekt-Info'
  | 'Export-Dialog';

/** Quelldateien je Ort (relativ zu `packages/app/src`), in denen die Beschriftung wörtlich stehen muss. */
export const HOME_SOURCES: Readonly<Record<Home, readonly string[]>> = {
  Kopf: ['ui/Header.tsx', 'ui/Sidebar.tsx'],
  'Kopf › Neu ▾': ['ui/Header.tsx'],
  'Kopf › ⋯': ['ui/Header.tsx'],
  'Werkzeug-Schiene': ['ui/Toolbar.tsx'],
  'Werkzeug-Schiene › Raum': ['ui/RoomTypePalette.tsx'],
  'Werkzeug-Schiene › Treppe': ['ui/Toolbar.tsx'],
  Bühne: ['ui/StageControls.tsx'],
  'Bühne › Schnitt ▾': ['ui/StageControls.tsx'],
  'Bühne › Ansicht ▾': ['ui/StageControls.tsx'],
  'Bühne › Etagen-Leiste': ['ui/FloorBar.tsx'],
  'Bühne › Licht-Leiste': ['viewer/TextureViewer.tsx'],
  Haus: ['ui/Inspector.tsx'],
  'Haus › Mehr': ['ui/Inspector.tsx', 'ui/ExteriorControls.tsx'],
  'Haus › Bautyp anpassen': ['ui/BuildingTypePanel.tsx'],
  Dach: ['ui/Inspector.tsx', 'ui/ExteriorControls.tsx'],
  Grundriss: ['editor/FloorPlan.tsx'],
  Etage: ['ui/Inspector.tsx'],
  Raum: ['ui/Sidebar.tsx'],
  'Raum › Möbel': ['ui/Sidebar.tsx'],
  Möbel: ['ui/Inspector.tsx'],
  Treppe: ['ui/BuildingPanel.tsx'],
  'Außen-Teil': ['ui/ExteriorControls.tsx'],
  Material: ['ui/PaletteSection.tsx', 'ui/MaterialPanel.tsx', 'ui/PaletteEditor.tsx'],
  Umgebung: ['ui/SiteToolbar.tsx', 'ui/SurroundingsPanel.tsx'],
  '⋯ › Projekt-Info': ['App.tsx', 'ui/Sidebar.tsx'],
  'Export-Dialog': ['ui/ExportDialog.tsx'],
};

export type ControlHome =
  /** Neuer Ort mit der Beschriftung, unter der man ihn dort findet. */
  | { readonly before: string; readonly home: Home; readonly label: string }
  /** Doppel: gleiche Fähigkeit wie `merged` (dessen Ort gilt). */
  | { readonly before: string; readonly merged: string };

const at = (before: string, home: Home, label: string): ControlHome => ({ before, home, label });
const same = (before: string, merged: string): ControlHome => ({ before, merged });

/** Frühere Bedienelemente (Schlüssel) → neuer Ort. `before` nennt den Ort vor dem Umbau. */
export const CONTROL_HOMES: Readonly<Record<string, ControlHome>> = {
  // ---- Kopfleiste
  'header.name': at('Kopf', 'Kopf', 'Projektname'),
  'header.undo': at('Kopf', 'Kopf', 'Rückgängig'),
  'header.redo': at('Kopf', 'Kopf', 'Wiederholen'),
  'header.new': at('Kopf „Neu …“', 'Kopf › Neu ▾', 'Beschreiben oder Bautyp …'),
  'header.save': at('Kopf „Speichern“', 'Kopf › ⋯', 'Im Browser speichern'),
  'header.export': at('Kopf „Exportieren …“', 'Kopf', 'Exportieren'),
  'header.help': at('Kopf „?“', 'Kopf › ⋯', 'Tastenkürzel'),
  // neu (W7-G, U8): Befehlssuche über diese Tabelle (Strg+K)
  'header.palette': at('– (neu, W7-G)', 'Kopf › ⋯', 'Befehlssuche'),
  // ---- Werkzeugleiste
  'mode.house': at('Werkzeugleiste „Haus“', 'Werkzeug-Schiene', 'Haus'),
  'mode.site': at('Werkzeugleiste „Umgebung“', 'Werkzeug-Schiene', 'Umgebung'),
  'tool.select': at('Werkzeugleiste', 'Werkzeug-Schiene', 'Auswählen'),
  'tool.paint': at('Werkzeugleiste „Malen“', 'Werkzeug-Schiene', 'Raum'),
  'tool.erase': at('Werkzeugleiste', 'Werkzeug-Schiene', 'Radieren'),
  'tool.stairs': at('Werkzeugleiste', 'Werkzeug-Schiene', 'Treppe'),
  'tool.roomTypes': at('Werkzeugleiste „Neuer Raum“ (immer sichtbar)', 'Werkzeug-Schiene › Raum', 'Neuer Raum'),
  'tool.stairType': at('Werkzeugleiste (Treppe)', 'Werkzeug-Schiene › Treppe', 'Treppenart'),
  'tool.stairRotate': at('Werkzeugleiste (Treppe)', 'Werkzeug-Schiene › Treppe', 'Drehen'),
  'tool.stairMirror': at('Werkzeugleiste (Treppe)', 'Werkzeug-Schiene › Treppe', 'Drehsinn spiegeln'),
  // ---- Leiste über der 3D-Ansicht
  'view.preview': at('Ansichtsleiste „Rollen/Blöcke/Texturen“', 'Bühne › Ansicht ▾', 'Darstellung'),
  'view.mode': at('Ansichtsleiste „Komplett/Dach ab/Wände ab“', 'Bühne › Schnitt ▾', 'Schnitt'),
  'view.cut': at('Ansichtsleiste „Schnitt“-Regler', 'Bühne › Schnitt ▾', 'Schnitthöhe'),
  'view.grid': at('Ansichtsleiste „Raster“', 'Bühne › Ansicht ▾', 'Raster'),
  'view.around': at('Ansichtsleiste „Umgebung“', 'Bühne › Ansicht ▾', 'Umgebung zeigen'),
  'view.fit': at('Ansichtsleiste „Einpassen“', 'Bühne', 'Einpassen'),
  'view.planShown': at('Ansichtsleiste „Nur 3D“', 'Bühne', 'Grundriss'),
  'view.layout': at('Ansichtsleiste „Geteilt/Überlagert“', 'Bühne › Ansicht ▾', 'Daneben'),
  'view.lightBar': at('Licht-Leiste immer sichtbar', 'Bühne › Ansicht ▾', 'Licht-Leiste'),
  // W11-B: Augenhöhe (W10) war über Strg+K nicht zu finden
  'view.eyeLevel': at('– (neu, W10)', 'Bühne', 'Augenhöhe'),
  'light.enabled': at('Licht-Leiste', 'Bühne › Licht-Leiste', 'Licht'),
  'light.time': at('Licht-Leiste', 'Bühne › Licht-Leiste', 'Tageszeit'),
  'light.presets': at('Licht-Leiste', 'Bühne › Licht-Leiste', 'TIME_PRESETS'),
  'light.spawn': at('Licht-Leiste', 'Bühne › Licht-Leiste', 'Spawn-Stellen'),
  'light.timelapse': at('Licht-Leiste › Mehr', 'Bühne › Licht-Leiste', 'Zeitraffer'),
  'light.brightness': at('Licht-Leiste › Mehr', 'Bühne › Licht-Leiste', 'Helligkeit'),
  'light.smooth': at('Licht-Leiste › Mehr', 'Bühne › Licht-Leiste', 'Weiches Licht + AO'),
  'light.flicker': at('Licht-Leiste › Mehr', 'Bühne › Licht-Leiste', 'Flackern'),
  'light.fps': at('Licht-Leiste › Mehr', 'Bühne › Licht-Leiste', 'FPS messen'),
  'floorbar.select': at('Etagen-Leiste', 'Bühne › Etagen-Leiste', 'aria-label="Etagen"'),
  'floorbar.add': at('Etagen-Leiste „+“', 'Bühne › Etagen-Leiste', 'Etage hinzufügen'),
  // neu (W11-A): Treppen automatisch aus den Räumen (Schalter unten in der Etagen-Leiste)
  'floorbar.autoStairs': at('– (neu, W11-A)', 'Bühne › Etagen-Leiste', 'Treppen automatisch'),
  // ---- Panel „Raum“
  'room.type': at('Raum', 'Raum', 'Raumtyp'),
  'room.density': at('Raum „Dichte“', 'Raum', 'Einrichtung'),
  'room.reroll': at('Raum', 'Raum', 'Neu würfeln'),
  'room.delete': at('Raum', 'Raum', 'Löschen'),
  'room.quality': at('Raum „Qualität“ + „Warum so?“', 'Raum', 'Qualität'),
  'room.facts': at('Raum: Fläche, Etage, Raum-Seed', 'Raum', 'Raum-Seed'),
  'room.lockAll': at('Raum „Alle sperren“', 'Raum › Möbel', 'Alle sperren'),
  'room.furniture': at('Raum: Möbelliste (immer offen)', 'Raum › Möbel', 'Möbel ('),
  'room.furnitureLock': at('Raum: Häkchen je Möbel', 'Raum › Möbel', 'Sperren: übersteht Neu-Würfeln'),
  'room.furnitureRemove': at('Raum: ✕ je Möbel', 'Raum › Möbel', 'Möbel entfernen (samt aufgesetzten Teilen)'),
  'room.warnings': at('Raum: Hinweise (immer offen)', 'Raum', 'Hinweise ('),
  // neu (W2-ED U4): Räume nachbearbeiten
  'room.variant': at('– (neu: vorher nur „Neu würfeln“ vorwärts)', 'Raum', 'Vorige Variante'),
  'room.fix': at('– (neu)', 'Raum', 'Raum fixieren'),
  // neu (F Bereich neu einrichten, WFC 3.2): Zone oder Rechteck neu, Rest eingefroren (hinter Schalter BLOCK_REFURNISH)
  'room.block': at('– (neu)', 'Raum', 'Bereich neu einrichten'),
  'room.resize': at('– (neu: vorher Übermalen = neuer Raum)', 'Grundriss', 'Anfasser'),
  // neu (W2-ED U5): Möbel bearbeiten
  'placement.move': at('– (neu: vorher nicht möglich)', 'Möbel', 'Verschieben: Pfeiltasten'),
  'placement.rotate': at('– (neu)', 'Möbel', '⟳ Drehen'),
  'placement.variant': at('– (neu)', 'Möbel', 'Nächste Möbel-Variante'),
  'placement.swap': at('– (neu)', 'Möbel', 'Tauschen gegen'),
  'placement.lock': at('Möbelliste (Häkchen)', 'Möbel', 'Sperren'),
  'placement.remove': at('Möbelliste (✕)', 'Möbel', 'Entfernen'),
  // neu (W7-G): Möbel mit der Maus ziehen (Grundriss und 3D; gleiche Passt-Prüfung wie die Pfeiltasten)
  'placement.drag': at('– (neu, W7-G: vorher nur Pfeiltasten)', 'Grundriss', 'Möbel ziehen'),
  // ---- Panel „Bautyp“
  'type.size': at('Bautyp', 'Haus › Bautyp anpassen', 'Größe'),
  'type.floors': at('Bautyp', 'Haus › Bautyp anpassen', 'Etagen'),
  'type.front': at('Bautyp', 'Haus › Bautyp anpassen', 'Front'),
  'type.apply': at('Bautyp „Parameter anwenden“', 'Haus › Bautyp anpassen', 'Neu bauen …'),
  'type.style': at('Bautyp „Nur Stil anwenden“', 'Haus › Bautyp anpassen', 'Nur Stil anwenden'),
  // neu (feat/underground): Unterbau-Schalter des Bautyps
  'type.underground': at('– (neu, feat/underground)', 'Haus › Bautyp anpassen', 'Keller & Gewölbe darunter'),
  // neu (W2-1): Funktionsgrad (aus / etwas / viel) des Bautyps
  'type.functionLevel': at('– (neu, W2-1)', 'Haus › Bautyp anpassen', 'Funktionsgrad'),
  'type.adjust': at('Panel „Bautyp“ (immer offen)', 'Haus', 'Bautyp anpassen …'),
  'type.reroll': at('Bautyp „Grundriss neu würfeln“', 'Haus', 'Grundriss neu würfeln'),
  'type.seed': at('Bautyp „Seed“', '⋯ › Projekt-Info', 'Plan-Seed'),
  'type.theme': same('Bautyp „Theme“ (warf alle Räume weg)', 'project.theme'),
  'type.exterior': same('Bautyp „Außenanlagen“', 'exterior.enabled'),
  'type.new': same('Bautyp „Anderer Bautyp …“', 'header.new'),
  // ---- Panel „Gebäude“: Etagen
  'building.floorPick': same('Gebäude: Etagen-Tabelle (Etage wählen)', 'floorbar.select'),
  'building.wallHeight': at('Gebäude: Wandhöhe je Etage', 'Etage', 'Wandhöhe'),
  'building.removeFloor': at('Gebäude: ✕ je Etage', 'Etage', 'Etage entfernen'),
  'building.addFloor': same('Gebäude „+ Etage oben“', 'floorbar.add'),
  'building.addCellar': at('Gebäude „+ Keller“', 'Etage', '+ Keller darunter'),
  'building.floorView': at('Gebäude „3D: Alle/Bis aktive/Nur aktive“', 'Bühne › Schnitt ▾', 'Etagen in 3D'),
  'building.access': at('Gebäude: Zugang (Hinweise)', 'Haus', 'Zugang'),
  'building.storyState': at('Gebäude › Nutzung „Zustand“', 'Haus › Mehr', 'Zustand'),
  'building.interiorDecor': at('Gebäude › Nutzung „Innen-Deko“', 'Haus › Mehr', 'Innen-Deko'),
  'building.mood': at('Gebäude › Nutzung „Stimmung“', 'Haus › Mehr', 'Stimmung'),
  'building.minAisle': at('Gebäude › Nutzung „Mittelgang“', 'Haus › Mehr', 'Mittelgang'),
  // neu (feat/underground): Zusatztüren für Rundgänge
  'building.loopDoors': at('– (neu, feat/underground)', 'Haus › Mehr', 'Rundgänge'),
  // neu (WS-Fassade): Fassadenrhythmus
  'building.facadeRhythm': at('– (neu, WS-Fassade)', 'Haus › Mehr', 'Fassadenrhythmus'),
  'building.shellWarnings': at('Gebäude „Hinweise der Hülle“', 'Haus › Mehr', 'Hinweise der Hülle'),
  // ---- Panel „Gebäude“: Dach
  'roof.form': at('Gebäude › Dach (Raster mit 9 Formen)', 'Dach', 'Dachform'),
  'roof.pitch': at('Gebäude › Dach', 'Dach', 'Neigung'),
  'roof.overhang': at('Gebäude › Dach', 'Dach', 'Überstand'),
  'roof.trim': at('Gebäude › Dach', 'Dach', 'Kante'),
  'roof.verge': at('Gebäude › Dach', 'Dach', 'Ortgang zu'),
  'roof.flare': at('Gebäude › Dach', 'Dach', 'Glockenfuß'),
  'roof.gableWindows': at('Gebäude › Dach', 'Dach', 'Giebelfenster'),
  'roof.halfHipRows': at('Gebäude › Dach', 'Dach', 'Walm-Reihen'),
  'roof.mansardBreak': at('Gebäude › Dach', 'Dach', 'Knick'),
  // neu (W4-D): Höhen-Budget und Dach-Teilung (vorher nur über die Engine-API)
  'roof.heightBudget': at('– (neu, W4-D)', 'Dach', 'automatische Dachhöhe'),
  'roof.split': at('– (neu, W4-D)', 'Dach', 'Dach teilen'),
  'roof.dormers': at('Gebäude › Dach', 'Dach', 'Gauben'),
  'roof.dormerWidth': at('Gebäude › Dach', 'Dach', 'Gaubenbreite'),
  'roof.dormerGap': at('Gebäude › Dach', 'Dach', 'Gaubenabstand'),
  // ---- Panel „Gebäude“: Außenwände
  'walls.windows': at('Gebäude › Außenwände', 'Haus › Mehr', 'Fenster an'),
  'walls.windowSpacing': at('Gebäude › Außenwände', 'Haus › Mehr', 'Fensterabstand'),
  'facade.quality': at('Gebäude › Außenwände', 'Haus › Mehr', 'Pflichtregeln'),
  'facade.plinth': at('Gebäude › Außenwände', 'Haus › Mehr', 'Sockel'),
  'facade.cornice': at('Gebäude › Außenwände', 'Haus › Mehr', 'Gesims'),
  'facade.quoins': at('Gebäude › Außenwände', 'Haus › Mehr', 'Eckquader'),
  'facade.pilasters': at('Gebäude › Außenwände', 'Haus › Mehr', 'Wandvorlagen'),
  'facade.brackets': at('Gebäude › Außenwände', 'Haus › Mehr', 'Balkenkonsolen'),
  'facade.decorate': at('Gebäude › Außenwände', 'Haus › Mehr', 'Fachwerk-Deko'),
  'facade.gableBraces': at('Gebäude › Außenwände', 'Haus › Mehr', 'Giebelstreben'),
  // ---- Panel „Gebäude“: Außen-Deko
  'exterior.enabled': at('Gebäude › Außen-Deko „an“', 'Haus', 'Außen-Deko an'),
  'exterior.reroll': at('Gebäude › Außen-Deko „⟳ Neu würfeln“', 'Haus', '⟳ neu'),
  'exterior.density': at('Gebäude › Außen-Deko', 'Haus › Mehr', 'Dichte der Außen-Deko'),
  'exterior.groups': at('Gebäude › Außen-Deko (11 Gruppen)', 'Haus › Mehr', 'EXTERIOR_ROWS'),
  // W7-K: Fantasy-Stufe und -Art (Felder `exterior.fantasy`/`.fantasyKit` der Engine-API); der W7-D-Schalter
  // „Stil › Fantasy-Akzente“ (Gruppe fantasyDecor) ist in der Stufe aufgegangen (voll = alle Module)
  'exterior.fantasy': at('– (neu, W7-K)', 'Haus › Mehr', 'Fantasy-Stufe'),
  'exterior.fantasyKit': at('– (neu, W7-K)', 'Haus › Mehr', 'Fantasy-Art'),
  'exterior.fantasyDecor': same('Außen-Deko „Stil › Fantasy-Akzente“ (W7-D)', 'exterior.fantasy'),
  // W15: Stufe der Fassaden-Details (Feld `exterior.facadeDetail` der Engine-API); die Gruppe `detailBlocks` ist darin
  // aufgegangen (dezent/reich schalten sie an)
  'exterior.facadeDetail': at('– (neu, W15)', 'Haus › Mehr', 'Fassaden-Details'),
  // ---- Panel „Projekt“
  'project.theme': at('Projekt „Theme“', 'Haus', 'Stil'),
  'project.palette': at('Projekt „Palette“', 'Haus › Mehr', 'Farbwelt'),
  'project.version': at('Projekt „Version“', 'Export-Dialog', 'Zielversion'),
  'project.rerollAll': at('Projekt „Alle neu würfeln“', 'Haus › Mehr', 'Alle Räume neu würfeln'),
  'project.new': same('Projekt „Neues Projekt …“', 'header.new'),
  'project.seed': at('Projekt „Seed“', '⋯ › Projekt-Info', "'Seed'"),
  'project.counts': at('Projekt „Räume / Möbel“', '⋯ › Projekt-Info', "'Umfang'"),
  'project.light': at('Projekt „Licht“', '⋯ › Projekt-Info', "'Licht'"),
  // ---- Abschnitte „Speichern, Laden, Export“, „Texturen“, „Palette“, „Katalog“
  'save.local': same('Speichern-Abschnitt „Speichern“', 'header.save'),
  'save.load': at('Speichern-Abschnitt „Laden“', 'Kopf › ⋯', 'Gespeicherten Stand laden'),
  'save.file': at('Speichern-Abschnitt „Als Datei …“', 'Kopf › ⋯', 'Als Datei speichern …'),
  // DR5 K2/K4 (MX-X): neu – Link teilen, Bauplan und Materialliste im Export-Dialog
  'save.share': at('neu (Teilen per URL)', 'Kopf › ⋯', 'Link teilen'),
  'export.guide': at('neu (Bauplan)', 'Export-Dialog', 'Bauplan (.md)'),
  'export.materialCsv': at('neu (Materialliste als Datei)', 'Export-Dialog', 'Materialliste (.csv)'),
  'save.open': at('Speichern-Abschnitt „Öffnen …“', 'Kopf › Neu ▾', 'Datei öffnen …'),
  'save.export': same('Speichern-Abschnitt „Exportieren …“', 'header.export'),
  'textures.jar': at('Abschnitt Texturen', '⋯ › Projekt-Info', 'Eigenes Minecraft-JAR …'),
  'textures.clear': at('Abschnitt Texturen', '⋯ › Projekt-Info', 'Cache löschen'),
  'palette.view': at('Abschnitt Palette (gemessen)', 'Material', 'Palette'),
  'catalog.info': at('Abschnitt Katalog', '⋯ › Projekt-Info', 'Katalog'),
  // ---- W3-BL: Tab „Material“ (neu: Materialliste, Blöcke sperren und ersetzen, Preset)
  'material.preset': at('– (neu, W3-BL)', 'Material', 'Nur leicht farmbare Blöcke'),
  'material.ban': at('– (neu, W3-BL)', 'Material', 'Block sperren'),
  'material.replace': at('– (neu, W3-BL)', 'Material', 'Ersatz: automatisch'),
  'material.search': at('– (neu, W3-BL)', 'Material', 'Block suchen'),
  'material.scope': at('– (neu, W3-BL)', 'Material', '+ Gelände'),
  'material.copy': at('– (neu, W3-BL)', 'Material', 'Liste kopieren'),
  // ---- W13-G: Blockpalette je Bauteil (auch im Assistenten, Schritt ②)
  'material.paletteEditor': at('– (neu, W13-G)', 'Material', 'Tauschen (überall, Verläufe bleiben)'),
  // ---- Treppe, Außen-Teil
  'stairs.type': at('Treppe', 'Treppe', 'Art'),
  'stairs.rotate': at('Treppe', 'Treppe', '⟳ Drehen'),
  'stairs.mirror': at('Treppe', 'Treppe', '⇋ Spiegeln'),
  'stairs.remove': at('Treppe', 'Treppe', 'Entfernen'),
  'exteriorPart.groupOff': at('Außen-Teil', 'Außen-Teil', 'Gruppe ausschalten'),
  // ---- W11-B: Modus „Umgebung“ in der Befehlssuche (vorher fand Strg+K weder Mauer noch Turm noch Brücken)
  'site.zone': at('Werkzeugleiste Umgebung', 'Umgebung', 'Zone'),
  'site.sculpt': at('Werkzeugleiste Umgebung', 'Umgebung', 'Formen'),
  'site.plot': at('Werkzeugleiste Umgebung', 'Umgebung', 'Grundstück'),
  'site.wall': at('Werkzeugleiste Umgebung', 'Umgebung', 'Mauer'),
  'site.gate': at('Werkzeugleiste Umgebung', 'Umgebung', 'Tor'),
  'site.tower': at('Werkzeugleiste Umgebung', 'Umgebung', 'Turm'),
  'site.windmill': at('Werkzeugleiste Umgebung', 'Umgebung', 'Windmühle'),
  'site.annex': at('Werkzeugleiste Umgebung', 'Umgebung', 'Anbau-Turm'),
  'site.terrain': at('Panel Umgebung', 'Umgebung', 'Gelände an'),
  'site.ensemble': at('Panel Umgebung (F-Ensemble)', 'Umgebung', 'Brücken und Rundwege'),
  'site.decor': at('Panel Umgebung', 'Umgebung', 'Grundstücks-Deko'),
  'site.weathering': at('– (neu, WS-Verwitterung)', 'Umgebung', 'Verwitterung'),
  'site.surfaceTexture': at('– (neu, TX-B Oberflächen-Textur)', 'Umgebung', 'Oberflächen-Textur'),
  'site.landform': at('– (neu, feat/gelaende)', 'Umgebung', 'Geländeform'),
};

/** Felder des Hüllen-Stils (`ShellStyle`, Pfade) → Bedienelement. Abgeleitete Felder: `null` mit Grund im Test. */
export const STYLE_CONTROLS: Readonly<Record<string, string | null>> = {
  roof: 'roof.form',
  overhang: 'roof.overhang',
  'windows.enabled': 'walls.windows',
  'windows.spacing': 'walls.windowSpacing',
  'roofDetail.pitch': 'roof.pitch',
  'roofDetail.trim': 'roof.trim',
  'roofDetail.verge': 'roof.verge',
  'roofDetail.flare': 'roof.flare',
  'roofDetail.gableWindows': 'roof.gableWindows',
  'roofDetail.halfHipRows': 'roof.halfHipRows',
  'roofDetail.mansardBreak': 'roof.mansardBreak',
  'roofDetail.heightBudget': 'roof.heightBudget',
  'roofDetail.split': 'roof.split',
  'dormers.kind': 'roof.dormers',
  'dormers.width': 'roof.dormerWidth',
  'dormers.minGap': 'roof.dormerGap',
  'facade.quality': 'facade.quality',
  'facade.plinthProfile': 'facade.plinth',
  'facade.cornice': 'facade.cornice',
  'facade.quoins': 'facade.quoins',
  'facade.pilasters': 'facade.pilasters',
  'facade.brackets': 'facade.brackets',
  'facade.decorate': 'facade.decorate',
  'facade.gableBraces': 'facade.gableBraces',
  // Pfeiler-Pflicht der Pflichtregeln folgt dem Theme (Fachwerk ohne Pfeiler, withoutPilastersForTheme) – nie ein Bedienelement
  'facade.piers': null,
  // W5-B: Rahmenrolle der Fensterrahmen kommt aus dem Bautyp (Burg, Wachturm: Stein) – wie Fenster-/Eingangsmodul kein Bedienelement
  'facade.frameRole': null,
  // W13-E: Wandkleid der Obergeschosse kommt aus dem Bautyp (Wohnbauten) – wie die Rahmenrolle kein Bedienelement
  'facade.upperFrame': null,
  // W16-B: Fenster-Pflicht je Raumtyp kommt aus dem Bautyp (Bauernhaus: Wohnküche) – kein Bedienelement
  'facade.lightRooms': null,
  'exterior.enabled': 'exterior.enabled',
  'exterior.variation': 'exterior.reroll',
  'exterior.density': 'exterior.density',
  'exterior.groups': 'exterior.groups',
  'exterior.fantasy': 'exterior.fantasy',
  'exterior.fantasyKit': 'exterior.fantasyKit',
  'exterior.facadeDetail': 'exterior.facadeDetail',
  // W12-C: Eingangsmodul des Bautyps (Bauernhaus: Cottage-Vordach in jedem Theme) – wie die Fensterrahmen-Rolle kein Bedienelement
  'exterior.entranceModule': null,
  paletteId: 'project.palette',
  // W3-BL: Block-Regeln (Tab „Material“)
  blockRules: 'material.ban',
  'blockRules.banned': 'material.ban',
  'blockRules.preset': 'material.preset',
  'blockRules.replace': 'material.replace',
  towers: null,
  corridorTypes: null,
  // Zusatztüren für Rundgänge (eigener Schalter, Review A3)
  loopDoors: 'building.loopDoors',
  // WS-Fassade: Schalter „Fassadenrhythmus“ (Haus › Mehr)
  facadeRhythm: 'building.facadeRhythm',
};

/**
 * Nutzer-Funktionen der App (`APP_SURFACE` usecases/buildingTypes mit Operation bzw. Befehl) → Bedienelement.
 * `null`: ohne eigenes Bedienelement (Tastatur, Datei, Assistent oder ein anderer Weg), Grund im Wert von `WITHOUT_CONTROL`.
 */
export const SURFACE_CONTROLS: Readonly<Record<string, string>> = {
  hasFunctionRooms: 'type.functionLevel',
  undo: 'header.undo',
  redo: 'header.redo',
  createSession: 'header.new',
  paintRect: 'tool.paint',
  eraseRect: 'tool.erase',
  deleteRoom: 'room.delete',
  assignRoomType: 'room.type',
  rerollRoom: 'room.reroll',
  rerollAll: 'project.rerollAll',
  setRoomDensity: 'room.density',
  setMinAisle: 'building.minAisle',
  setBlockRules: 'material.ban',
  toggleLock: 'placement.lock',
  setRoomLocked: 'room.lockAll',
  removePlacement: 'placement.remove',
  setTheme: 'project.theme',
  setPalette: 'project.palette',
  setTargetVersion: 'project.version',
  renameProject: 'header.name',
  setStoryState: 'building.storyState',
  setMood: 'building.mood',
  setInteriorDecor: 'building.interiorDecor',
  setPaletteOverrides: 'material.paletteEditor',
  addFloor: 'floorbar.add',
  removeFloor: 'building.removeFloor',
  setFloorHeight: 'building.wallHeight',
  placeStairs: 'tool.stairs',
  changeStairs: 'stairs.type',
  removeStairs: 'stairs.remove',
  stairsBlockedByFixed: 'tool.stairs',
  autoStairs: 'floorbar.autoStairs',
  setShellStyle: 'roof.form',
  setRoof: 'roof.form',
  shellOptions: 'roof.form',
  roofDetailOptions: 'roof.pitch',
  facadeOptions: 'facade.quality',
  dormerOptions: 'roof.dormers',
  exteriorOptions: 'exterior.enabled',
  typeSession: 'header.new',
  changeTypeParams: 'type.apply',
  applyTypeStyle: 'type.style',
  rerollType: 'type.reroll',
  proposal: 'header.new',
  proposalSeeds: 'header.new',
  proposalCandidates: 'header.new',
  proposalCount: 'header.new',
  proposalRound: 'header.new',
  // W8-E: Spielbarkeit der Vorschläge (Karte zeigt den Hinweis) – im Assistenten wie die übrigen Vorschlags-Funktionen
  proposalPlayability: 'header.new',
  playabilityNotice: 'header.new',
  playableCount: 'header.new',
  // feat/pareto-proposals: Häkchen „Vorschläge bewerten“ im Assistenten
  paretoSeeds: 'header.new',
  paretoCandidate: 'header.new',
  planFacts: 'header.new',
  typeSummary: 'header.new',
  sizesOf: 'type.size',
  defaultParams: 'header.new',
  styleFromBuild: 'save.file',
  withoutPilastersForTheme: 'header.new',
  sessionFromProject: 'save.open',
  setRoomVariant: 'room.variant',
  fixRoom: 'room.fix',
  refurnishBlock: 'room.block',
  roomZonesOf: 'room.block',
  resizeRoom: 'room.resize',
  nudgePlacement: 'placement.move',
  rotatePlacement: 'placement.rotate',
  swapPlacement: 'placement.swap',
  swapOptions: 'placement.swap',
  placementProblem: 'placement.move',
  nudgeProblem: 'placement.drag',
};
