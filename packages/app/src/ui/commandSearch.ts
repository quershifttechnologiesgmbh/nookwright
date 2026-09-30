/**
 * Befehlssuche (W7-G, Konzept W2UX §3 „Strg+K = Befehlssuche über alle Einstellungen“, U8): Einträge aus der
 * Heimat-Tabelle (`CONTROL_HOMES` – jede Einstellung und Aktion hat dort genau einen Ort) und den Tastenkürzeln
 * (`SHORTCUTS`). Ein Eintrag führt entweder einen Befehl direkt aus (`command`) oder springt an seinen Ort (`home`:
 * Auswahl/Panel öffnen, Bedienelement hervorheben). Rein, ohne DOM.
 *
 * Suche: jedes Wort der Eingabe muss vorkommen (Groß-/Kleinschreibung und Umlaute egal, „ae“ = „ä“), auch über
 * Wortgrenzen von Ort und Beschriftung hinweg („Dachüberstand“ findet „Überstand“ im Ort „Dach“). Rangfolge:
 * Beschriftung beginnt mit der Eingabe, Beschriftung enthält sie, sonst Ort/Stichwort; bei Gleichstand Tabellenordnung.
 */
import { CONTROL_HOMES, type ControlHome, type Home } from './controlHomes.js';
import { SHORTCUTS, type Command } from './shortcuts.js';

export interface CommandItem {
  /** Schlüssel der Heimat-Tabelle bzw. `key:<Befehl>` für reine Tastenkürzel. */
  readonly id: string;
  /** Anzeige-Beschriftung. */
  readonly label: string;
  /** Wo man es findet („Haus › Mehr“) bzw. „Tastatur“. */
  readonly path: string;
  readonly home?: Home;
  /** Direkt ausführbarer Befehl der Tastatur-Tabelle. */
  readonly command?: Command;
  /** Tastenkürzel zur Anzeige („Strg+Z“). */
  readonly keys?: string;
  /** Beschriftung, nach der die App das Bedienelement am Ort sucht (wörtlich im Quelltext, Heimat-Test). */
  readonly find?: string;
  /** Normalisierter Suchtext (Beschriftung, Ort, frühere Orte, Stichwörter). */
  readonly terms: string;
  /** Normalisierte Beschriftung (Rangfolge). */
  readonly key: string;
}

/** Anzeige für Einträge, deren Beschriftung in der Tabelle ein Quelltext-Stück ist. */
const DISPLAY: Readonly<Record<string, string>> = {
  'light.presets': 'Tageszeit: Mittag, Dämmerung, Nacht',
  'floorbar.select': 'Etage wählen',
  'exterior.groups': 'Außen-Deko-Gruppen',
  'exterior.reroll': 'Außen-Deko neu würfeln',
  'project.seed': 'Seed',
  'project.counts': 'Umfang: Räume und Möbel',
  'project.light': 'Licht-Pass',
  'room.furniture': 'Möbelliste des Raums',
  'room.warnings': 'Hinweise des Raums',
  'room.resize': 'Raum vergrößern/verkleinern (Kante ziehen)',
  'room.facts': 'Raum-Seed und Fläche',
  'room.furnitureLock': 'Möbel in der Liste sperren',
  'placement.move': 'Möbel verschieben (Pfeiltasten)',
  'view.layout': 'Grundriss daneben oder darüber',
  'view.planShown': 'Grundriss einblenden',
  'header.name': 'Projekt umbenennen',
  'tool.paint': 'Raum malen (Werkzeug Raum)',
  'tool.stairs': 'Treppe setzen (Werkzeug Treppe)',
  'room.reroll': 'Raum neu würfeln',
  // W11-B: Umgebung
  'site.zone': 'Zone malen (Feld, Garten, Hof, Teich …)',
  'site.sculpt': 'Gelände formen (Terraforming)',
  'site.plot': 'Grundstück aufziehen',
  'site.wall': 'Mauer ziehen',
  'site.gate': 'Tor in eine Mauer setzen',
  'site.tower': 'Turm setzen',
  'site.windmill': 'Windmühle setzen',
  'site.annex': 'Anbau-Turm am Haus',
  'site.terrain': 'Gelände an/aus',
  'site.decor': 'Grundstücks-Deko (Beete, Bank, Bannermasten …)',
};

/** Zusätzliche Stichwörter (Wörter, die Nutzer suchen, die aber nicht auf dem Bedienelement stehen). */
const KEYWORDS: Readonly<Record<string, string>> = {
  'project.theme': 'Theme Material Baustil',
  'project.palette': 'Palette Farben',
  'project.version': 'Version Minecraft Java',
  'header.export': 'litematic schematic mcstructure Download herunterladen',
  'header.new': 'neues Projekt Assistent Taverne Haus',
  'tool.paint': 'Raum malen zeichnen',
  'tool.erase': 'löschen radieren',
  'room.reroll': 'neu würfeln Zufall Variante',
  'room.block': 'Zone Rechteck Teil Ecke neu einrichten würfeln Rest behalten',
  'room.variant': 'Variante vorige nächste',
  'room.density': 'Dichte Möbel mehr weniger karg voll',
  'room.fix': 'fixieren behalten',
  'placement.drag': 'Maus verschieben ziehen',
  'placement.lock': 'sperren behalten',
  'placement.swap': 'tauschen ersetzen Alternative',
  'building.minAisle': 'Gang frei',
  'building.wallHeight': 'Deckenhöhe Raumhöhe',
  'walls.windows': 'Fenster',
  'material.ban': 'Blöcke sperren verbieten',
  'material.preset': 'farmbar Survival',
  'view.mode': 'Dach ab Wände ab Schnitt',
  'view.fit': 'Kamera zentrieren',
  'header.help': 'Hilfe Tasten Kürzel',
  'textures.jar': 'Texturen Resourcepack JAR',
  'exterior.fantasy': 'Fantasy Akzent voll Elfen Banner Giebelhorn Hörner Bogenlaterne Feuerschalen Vibe',
  'exterior.fantasyKit': 'Fantasy Art Kit elbisch zwergisch Elfen Zwerge',
  'exterior.facadeDetail': 'Fassaden-Details Tiefe Konsolen Falltüren Treppen Zahnschnitt Giebel Zapfen Banner Regal Auslage Fässer Holzstapel dezent reich',
  'building.loopDoors': 'Rundgang Rundgänge Zusatztür Zusatztüren Schleife Durchgang zweite Tür',
  'building.facadeRhythm': 'Fassadenrhythmus Fassade Fenster Fensterachsen Takt Rhythmus Gauben Dach Dachfläche flache Wände',
  'floorbar.autoStairs': 'Treppe Treppen automatisch auto Etagen verbinden Stockwerk Obergeschoss Keller erreichbar',
  'type.underground': 'Unterbau Keller Gewölbe Dungeon Verlies Kerker Weinkeller Schatzkammer Gänge Rundgang Katakomben Untergeschoss',
  'type.functionLevel': 'Funktionsgrad funktional Funktionsräume Anlagen Farm Farmen Lager Sortierer Schmelze Brauerei Redstone Werkstatt Tresor Räucherei Kornkammer Stall Spawner',
  // W11-B
  'view.eyeLevel': 'Kamera Spieler Blick Eingang Perspektive Ego Ich-Sicht',
  'mode.site': 'Außenbereich Grundstück Mauern Türme Gelände Garten',
  'site.zone': 'Feld Acker Garten Hof Teich Wiese Obstgarten Koppel Platz Anger Weide Weg Wege Pfad Straße',
  'site.sculpt': 'Terraforming anheben absenken ebnen glätten Hügel Relief',
  'site.plot': 'Fläche Größe Rand',
  'site.wall': 'Wehrmauer Mauerring Ringmauer Burgmauer Gartenmauer',
  'site.gate': 'Torhaus Durchgang Einfahrt',
  'site.tower': 'Türme Wachturm Eckturm Rundturm',
  'site.windmill': 'Mühle',
  'site.annex': 'Treppenturm Eckturm angedockt',
  'site.terrain': 'Landschaft Terrain Bäume Büsche Blumen Vegetation',
  'site.ensemble': 'Brücke Brücken Rundweg Steg Verbindung Anschluss',
  'site.decor': 'Dekoration Deko Grundstück Garten Bank Brunnen Lampen Bannermast Torbogen Holzstapel Pferch Bienen Gräber',
  'site.surfaceTexture': 'Oberflächen-Textur Blockmischung Flecken Sockel Traufe Dachverlauf Muster Kontrast Ecken Fensterbank Streublöcke Farbvariation',
  'site.weathering': 'Verwitterung verwittert Moos Schutt Sockel Regenspuren Alterung Patina Flechten Dachkehle',
  'site.landform': 'Hang Hügel hügelig bergig Berg Terrasse Stützmauer Teich Findling Findlinge Moos Landschaft Geländeform',
};

/**
 * W11-B: Einträge des Modus „Umgebung“ → Werkzeug der Umgebung (`SiteTool`). Die App schaltet in den Modus Umgebung,
 * wählt das Werkzeug und hebt das Bedienelement hervor (kein Tastenbefehl: der Haus-Modus deutet T/M/E anders).
 */
export const SITE_TOOL_OF: Readonly<Record<string, 'zone' | 'sculpt' | 'plot' | 'wall' | 'gate' | 'tower' | 'windmill' | 'annex'>> = {
  'site.zone': 'zone',
  'site.sculpt': 'sculpt',
  'site.plot': 'plot',
  'site.wall': 'wall',
  'site.gate': 'gate',
  'site.tower': 'tower',
  'site.windmill': 'windmill',
  'site.annex': 'annex',
};

/** Heimat-Einträge, die ein Tastenkürzel direkt ausführt (gleiche Wirkung wie die Taste). */
const COMMAND_OF: Readonly<Record<string, Command>> = {
  'header.undo': 'undo',
  'header.redo': 'redo',
  'header.save': 'save',
  'header.help': 'help',
  'tool.select': 'tool.select',
  'tool.paint': 'tool.paint',
  'tool.erase': 'tool.erase',
  'tool.stairs': 'tool.stairs',
  'room.reroll': 'room.reroll',
  'project.rerollAll': 'room.rerollAll',
  'placement.rotate': 'placement.rotate',
  'placement.lock': 'placement.lock',
  'view.fit': 'camera.fit',
};

/** Kürzel ohne eigenen Eintrag in der Heimat-Tabelle, die in der Suche nichts bringen (Richtungstasten, Esc). */
const SKIP_KEYS: ReadonlySet<Command> = new Set(['placement.left', 'placement.right', 'placement.up', 'placement.down', 'escape', 'palette']);

/** Kleinbuchstaben, Umlaute gefaltet (ä → a, auch „ae“ → a), ohne Leer- und Satzzeichen. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä|ae/g, 'a')
    .replace(/ö|oe/g, 'o')
    .replace(/ü|ue/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

const cleanLabel = (label: string): string => label.replace(/^'|'$/g, '').replace(/\s*\($/, '').replace(/…$/, '').trim();
const lastSegment = (home: string): string => home.split('›').pop()!.replace('▾', '').trim();

function keysOf(command: Command): string | undefined {
  const s = SHORTCUTS.find((x) => x.command === command);
  return s === undefined ? undefined : s.display.join('+');
}

/** Alle Einträge: Heimat-Tabelle (ohne Zusammenlegungen, deren frühere Orte als Stichwort beim Ziel) + Tastenkürzel. */
export function commandItems(): CommandItem[] {
  const merged = new Map<string, string[]>();
  for (const c of Object.values(CONTROL_HOMES)) if ('merged' in c) merged.set(c.merged, [...(merged.get(c.merged) ?? []), c.before]);
  const items: CommandItem[] = [];
  const covered = new Set<Command>();
  for (const [id, c] of Object.entries(CONTROL_HOMES) as Array<[string, ControlHome]>) {
    if (!('home' in c)) continue;
    const label = DISPLAY[id] ?? cleanLabel(c.label);
    const command = COMMAND_OF[id];
    if (command !== undefined) covered.add(command);
    const keys = command === undefined ? undefined : keysOf(command);
    const words = [label, c.home, `${lastSegment(c.home)}${label}`, c.before, ...(merged.get(id) ?? []), KEYWORDS[id] ?? ''];
    items.push({
      id, label, path: c.home, home: c.home, find: c.label,
      ...(command !== undefined ? { command } : {}),
      ...(keys !== undefined ? { keys } : {}),
      terms: words.map(normalizeText).join('|'),
      key: normalizeText(label),
    });
  }
  for (const s of SHORTCUTS) {
    if (covered.has(s.command) || SKIP_KEYS.has(s.command)) continue;
    covered.add(s.command);
    items.push({
      id: `key:${s.command}`, label: s.label, path: `Tastatur · ${s.group}`, command: s.command, keys: s.display.join('+'),
      terms: [s.label, s.group, s.display.join(' ')].map(normalizeText).join('|'), key: normalizeText(s.label),
    });
  }
  return items;
}

/** Häufige Einträge bei leerer Eingabe. */
const START = ['tool.paint', 'room.reroll', 'placement.drag', 'room.resize', 'roof.form', 'project.theme', 'material.ban', 'header.export', 'key:view.noRoof'];

/** Treffer für eine Eingabe, beste zuerst (höchstens `limit`). */
export function searchCommands(items: readonly CommandItem[], query: string, limit = 9): CommandItem[] {
  const words = query.split(/\s+/).map(normalizeText).filter((w) => w !== '');
  if (words.length === 0) return START.map((id) => items.find((i) => i.id === id)).filter((i): i is CommandItem => i !== undefined).slice(0, limit);
  const whole = words.join('');
  const hits: Array<{ item: CommandItem; rank: number; order: number }> = [];
  items.forEach((item, order) => {
    const all = item.terms.replace(/\|/g, '');
    if (!words.every((w) => item.terms.includes(w) || all.includes(w))) return;
    const rank = item.key.startsWith(whole) ? 0 : item.key.includes(whole) ? 1 : words.every((w) => item.key.includes(w)) ? 2 : 3;
    hits.push({ item, rank, order });
  });
  return hits.sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, limit).map((h) => h.item);
}
