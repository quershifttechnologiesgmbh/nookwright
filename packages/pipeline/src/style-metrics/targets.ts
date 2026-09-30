/**
 * Kennzahl-Definitionen der Stil-Kennzahlen: Zielwerte (Start-Ziele aus `plan/spikes/LV_builderstile.md` §5 und
 * `plan/spikes/LV_tiefe_detail.md` Kap. 5.4), Ampel-Toleranz und Verlässlichkeit der Messung. Reihenfolge = Berichts-Reihenfolge.
 */
import type { MetricDef, MetricTarget, Reliability, TargetOrigin } from './types.js';

const t = (text: string, o: { min?: number; max?: number; slack: number; origin?: TargetOrigin }): MetricTarget => ({
  text, slack: o.slack, origin: o.origin ?? 'plan', ...(o.min !== undefined ? { min: o.min } : {}), ...(o.max !== undefined ? { max: o.max } : {}),
});

const def = (
  id: string, rule: string, name: string, unit: string, target: MetricTarget, reliability: Reliability, note: string,
): MetricDef => ({ id, rule, name, unit, target, reliability, note });

export const METRIC_DEFS: readonly MetricDef[] = [
  // --- 5.1 Fassade und Tiefe ---
  def('LV-1a', 'LV-1', 'Reliefquote Frontseite', 'Anteil', t('>= 0,25', { min: 0.25, slack: 0.1 }), 'hoch',
    'Vorsprung (Zelle vor der Wandebene) oder Öffnung (Fenster/Tür); Fenster zählen als Rücksprung, obwohl die Scheibe bündig sitzt (Rahmen liegt davor).'),
  def('LV-1b', 'LV-1', 'Reliefquote Seiten und Rückseite', 'Anteil', t('>= 0,15', { min: 0.15, slack: 0.07 }), 'hoch',
    'wie LV-1a, über alle Seiten außer der Haustür-Seite, je Seite mit mindestens 6 Zellen Breite.'),
  def('LV-2', 'LV-2', 'Blöcke je sichtbarer Wandzelle (Tiefe <= 1)', 'Blöcke/Zelle', t('>= 1,3', { min: 1.3, slack: 0.2 }), 'hoch',
    'Wandzelle plus Vorsprungszelle davor plus ggf. zweite Wandschicht; Innenhaut und Möbel zählen nicht.'),
  def('LV-3', 'LV-3', 'Längste Wandstrecke ohne Tiefenwechsel', 'Zellen', t('<= 5 (Seiten bis 8 breit), <= 4 (ab 12 breit)', { max: 5, slack: 2 }), 'mittel',
    'breitestes ebenes Wandstück von mindestens 2 Zellen Höhe; Pfeiler in der Wandebene gelten nicht als Tiefenwechsel.'),
  def('LV-4a', 'LV-4', 'Seiten mit >= 3 Tiefenebenen', 'Anteil der Seiten', t('>= 0,60 (Seiten > 5x4)', { min: 0.6, slack: 0.2 }), 'mittel',
    'Ebenen: Rücksprung (Öffnung), Wandebene, Vorsprung 1, 2, 3; eine Ebene zählt ab 3 % der Fassadenzellen der Seite.'),
  def('LV-4b', 'LV-4', 'Seiten mit > 3 Tiefenebenen (unruhig)', 'Anteil der Seiten', t('<= 0,10', { max: 0.1, slack: 0.15, origin: 'own' }), 'niedrig',
    'Plan nennt nur „maximal 3“; der Höchstanteil ist eine eigene Setzung.'),
  def('LV-5a', 'LV-5', 'Ecken der Außenkontur (Grundfläche >= 10x10)', 'Ecken', t('>= 8', { min: 8, slack: 3 }), 'hoch',
    'Ecken der Kontur des Erdgeschoss-Grundrisses (Boden- und Wandspalten); nur Bauten mit Grundfläche >= 10x10.'),
  def('LV-5b', 'LV-5', 'Wandlänge, die mehr als 1 Block versetzt liegt', 'Anteil', t('>= 0,15', { min: 0.15, slack: 0.07 }), 'mittel',
    'Kontur-Kanten, die >= 2 Blöcke hinter der Umriss-Box der Grundfläche liegen, bezogen auf die Konturlänge.'),
  // --- 5.2 Material und Verlauf ---
  def('LV-6a', 'LV-6', 'Leitmaterial-Anteil je Fassadenseite', 'Anteil', t('0,45 bis 0,60', { min: 0.45, max: 0.6, slack: 0.1 }), 'mittel',
    'größte Materialfamilie (Holzart/Steinton/Farbe) der Wandblöcke einer Seite; Glas, Türen, Licht, Möbel ausgenommen.'),
  def('LV-6b', 'LV-6', 'Zweitmaterial-Anteil', 'Anteil', t('0,25 bis 0,35', { min: 0.25, max: 0.35, slack: 0.1 }), 'mittel', 'zweitgrößte Familie der Seite.'),
  def('LV-6c', 'LV-6', 'Akzent-Anteil (übrige Familien)', 'Anteil', t('0,05 bis 0,15', { min: 0.05, max: 0.15, slack: 0.05 }), 'mittel', 'alles außer Leit- und Zweitmaterial.'),
  def('LV-6d', 'LV-6', 'Blockarten je Wandseite (ohne Verwitterung)', 'Arten', t('3 bis 5', { min: 3, max: 5, slack: 2 }), 'hoch',
    'verschiedene Blockarten ohne bemoost/gerissen und ohne Treppe/Stufe/Mauer-Form, mit >= 2 % Anteil der Seite.'),
  def('LV-7a', 'LV-7', 'Leitstein-Anteil im Stein', 'Anteil', t('>= 0,45', { min: 0.45, slack: 0.15 }), 'mittel',
    'größter Steinton unter den Steinblöcken der Fassade (Stein, Andesit, Granit, Tuff, Kalzit, Bruchstein …); ab 20 Steinblöcken.'),
  def('LV-7b', 'LV-7', 'Nachbartöne im Stein (Anteil je >= 5 %)', 'Töne', t('2 bis 4', { min: 2, max: 4, slack: 1 }), 'mittel', 'Steintöne mit >= 5 % Anteil neben dem Leitstein.'),
  def('LV-7c', 'LV-7', 'Nachbartöne in Flecken (>= 2x2)', 'Anteil', t('>= 0,50', { min: 0.5, slack: 0.2, origin: 'own' }), 'niedrig',
    'Anteil der Nicht-Leitstein-Blöcke mit gleichartigem Nachbarn in der Wandebene; der Zielwert ist eine eigene Setzung.'),
  def('LV-8a', 'LV-8', 'Verwitterung Reihe 0-2', 'Anteil', t('>= 0,25', { min: 0.25, slack: 0.1 }), 'mittel',
    'Anteil bemooster/gerissener/berankter Wandblöcke; Reihen ab der tiefsten sichtbaren Fassadenzelle jedes Baus.'),
  def('LV-8b', 'LV-8', 'Verwitterung Reihe 3-5', 'Anteil', t('0,10 bis 0,15', { min: 0.1, max: 0.15, slack: 0.08 }), 'mittel', 'wie LV-8a.'),
  def('LV-8c', 'LV-8', 'Verwitterung ab Reihe 6', 'Anteil', t('<= 0,05', { max: 0.05, slack: 0.05 }), 'mittel', 'wie LV-8a.'),
  def('LV-8d', 'LV-8', 'Größter Sprung zwischen Nachbarreihen', 'Anteil', t('<= 0,15', { max: 0.15, slack: 0.1 }), 'niedrig',
    'Reihen mit >= 8 Fassadenzellen; kleine Stichproben rauschen, deshalb nur Näherung.'),
  def('LV-9a', 'LV-9', 'Hauptfamilie des Dachs', 'Anteil', t('0,60 bis 0,75', { min: 0.6, max: 0.75, slack: 0.1 }), 'mittel', 'Deckungsfamilie (Steinton, Holzart) der Dachzellen (Kind roof) je Bau.'),
  def('LV-9b', 'LV-9', 'Deckungsfamilien je Dach (>= 5 %)', 'Familien', t('>= 2', { min: 2, slack: 0.5 }), 'mittel', 'Ein Nachbarton in ganzen Ringen ist in LV-9c geprüft.'),
  def('LV-9c', 'LV-9', 'Rauschen innerhalb einer Dachreihe', 'Anteil', t('< 0,10', { max: 0.1, slack: 0.1 }), 'mittel',
    '1 minus Anteil der häufigsten Familie je Höhenreihe des Dachs, gewichtet; beide Dachseiten teilen sich eine Höhenreihe.'),
  def('LV-9d', 'LV-9', 'Holzarten auf Holzdächern', 'Arten', t('>= 2', { min: 2, slack: 0.5 }), 'mittel', 'nur Dächer, deren Hauptfamilie eine Holzart ist.'),
  def('LV-10a', 'LV-10', 'Kontrast Wand <-> Dach (OKLab-L)', 'L-Abstand', t('>= 0,10', { min: 0.1, slack: 0.05 }), 'hoch', 'Mittel der Blockhelligkeiten, gewichtet nach Zellzahl.'),
  def('LV-10b', 'LV-10', 'Kontrast Rahmen <-> Füllung (OKLab-L)', 'L-Abstand', t('>= 0,06', { min: 0.06, slack: 0.03 }), 'mittel',
    'Rahmen = Pfeilerzellen der Fassade, Füllung = Wandzellen; nur Bauten mit Pfeilern.'),
  def('LV-10c', 'LV-10', 'Harte Hell/Dunkel-Kanten (Delta-L > 0,35)', 'Anteil der Nachbarpaare', t('<= 0,05', { max: 0.05, slack: 0.05, origin: 'own' }), 'niedrig',
    'Nachbarpaare in der Wandebene; der Plan erlaubt harte Kanten nur an Akzenten, die Obergrenze ist eine eigene Setzung.'),
  // --- 5.3 Kanten, Formteile, Silhouette ---
  def('LV-11', 'LV-11', 'Nicht-Vollblock-Anteil der Fassade', 'Anteil', t('>= 0,25', { min: 0.25, slack: 0.1 }), 'hoch',
    'Wand- und Vorsprungszellen der sichtbaren Außenwand; Vollblock nach `isFullBlock` (wie F2).'),
  def('LV-12a', 'LV-12', 'Außenecken mit eigenem Eckelement', 'Anteil', t('= 1,0', { min: 1, slack: 0.3 }), 'mittel',
    'Außenecken-Zellen, deren Block vom Block der anliegenden Wandzellen abweicht (Quader, Stamm).'),
  def('LV-12b', 'LV-12', 'Traufe mit Überstand >= 1', 'Anteil', t('>= 0,90', { min: 0.9, slack: 0.3 }), 'mittel', 'unterste Dachreihe, deren Spalte außerhalb der Wandspalten liegt.'),
  def('LV-12c', 'LV-12', 'Sockel aus <= 2 Blockarten, abgesetzt', 'Anteil der Bauten', t('>= 0,80', { min: 0.8, slack: 0.3, origin: 'own' }), 'niedrig',
    'unterste 2 Reihen mit höchstens 2 Blockarten, anderes Leitmaterial als Reihe 2-4; der Anteil ist eine eigene Setzung.'),
  def('LV-13a', 'LV-13', 'Firsthöhen je Bau (Grundfläche >= 12x12)', 'Höhen', t('>= 3', { min: 3, slack: 1 }), 'mittel', 'Oberkanten getrennter Dachkörper und First-Anker; Stufen unter 1 Block werden zusammengefasst.'),
  def('LV-13b', 'LV-13', 'Traufhöhenklassen im Ensemble (ab 4 Bauten)', 'Klassen', t('>= 2', { min: 2, slack: 1 }), 'mittel', 'Klassen: Traufhöhen ab 2 Blöcken Abstand.'),
  def('LV-13c', 'LV-13', 'Dachformen im Ensemble (ab 4 Bauten)', 'Formen', t('>= 3', { min: 3, slack: 1 }), 'niedrig',
    'Dachform aus den Treppen-Blickrichtungen der Dachzellen geschätzt (flach, Pult, Sattel, Walm, sonstige).'),
  def('LV-13d', 'LV-13', 'Höchstes Element gegenüber Hauptkörper', 'Faktor', t('>= 1,25', { min: 1.25, slack: 0.15 }), 'mittel',
    'Höhe des höchsten Dach-/Turmkörpers über Geländeoberkante geteilt durch die Höhe des flächengrößten Dachs; Bauten >= 12x12.'),
  def('LV-14', 'LV-14', 'Größte ungeteilte Dachfläche', 'Zellen', t('<= 225 (15x15)', { max: 225, slack: 75 }), 'mittel',
    'zusammenhängende Dachspalten gleicher Neigungsrichtung (Höhenunterschied <= 1); ein Sattel hat zwei Flächen.'),
  // --- 5.4 Gelände und Umgebung ---
  def('LV-15a', 'LV-15', 'Sockelumfang mit Übergangsblock', 'Anteil', t('>= 0,60', { min: 0.6, slack: 0.2 }), 'mittel',
    'Boden 1-2 Blöcke außerhalb der untersten Wandreihe: Gras/Erde/Moos/Kies/Sand/Pfad zählt als Übergang; glatter Stein- oder Bretterring nicht.'),
  def('LV-15b', 'LV-15', 'Lufttaschen unter dem Sockel', 'Anteil der Wandspalten', t('= 0', { max: 0, slack: 0.03 }), 'hoch', 'Wandspalten der untersten Reihe (höchstens 1 über dem Baukörper-Boden; Auskragungen im Obergeschoss zählen nicht), unter denen ein Luftblock liegt.'),
  def('LV-15c', 'LV-15', 'Höhenunterschied des Geländes', 'Blöcke', t('>= 2', { min: 2, slack: 1 }), 'mittel', 'Spanne der Geländeoberkante über dem Grundstück, ohne Wasser; Extremwerte (1. und 99. Perzentil).'),
  def('LV-15d', 'LV-15', 'Erd-/Moos-/Grasanteil am Gesamtbau', 'Anteil', t('0,20 bis 0,35', { min: 0.2, max: 0.35, slack: 0.1, origin: 'ref' }), 'niedrig',
    'Grian-S8: ~30 % (eine Referenz); Nenner = Naturblöcke oberhalb Geländeoberkante + Bauteile, ohne tiefen Unterboden.'),
  def('LV-16a', 'LV-16', 'Bewuchs an der Fassade', 'Anteil', t('0,03 bis 0,08', { min: 0.03, max: 0.08, slack: 0.03 }), 'mittel',
    'Fassadenspalten mit Ranke, Flechte, Laub, Moosteppich davor oder bemoostem Wandblock.'),
  def('LV-16b', 'LV-16', 'Oberflächenblöcke des Bodens (>= 3 %)', 'Blockarten', t('>= 3', { min: 3, slack: 1 }), 'hoch', 'Blockarten der obersten Geländeschicht im Grundstück, ohne Wasser.'),
  def('LV-16c', 'LV-16', 'Rauschen der Bodenoberfläche', 'Anteil der Nachbarpaare', t('<= 0,35', { max: 0.35, slack: 0.2, origin: 'own' }), 'niedrig',
    'Anteil benachbarter Bodenspalten mit verschiedenem Block; Flecken statt Rauschen. Die Obergrenze ist eine eigene Setzung.'),
  def('LV-17', 'LV-17', 'Außentüren mit Wegverbindung', 'Anteil', t('= 1,0', { min: 1, slack: 0.2 }), 'niedrig', 'Prüfbericht der Weg-Planung (`pathAudit`), also die Selbstauskunft des Generators.'),
  def('LV-18a', 'LV-18', 'Reliefquote Rückseite / Front', 'Faktor', t('>= 0,60', { min: 0.6, slack: 0.2 }), 'mittel', 'Seite gegenüber der Haustür-Seite; nur Bauten mit beiden Seiten >= 6 Zellen.'),
  def('LV-18b', 'LV-18', 'Seiten mit ebenem Wandstück > 5x4', 'Anteil der Seiten', t('= 0', { max: 0, slack: 0.3 }), 'mittel', 'größtes Rechteck ohne Relief (Breite >= 6 und Höhe >= 5).'),
  // --- 5.5 Innenräume ---
  def('LV-19a', 'LV-19', 'Räume > 60 Zellen mit >= 2 Zonen', 'Anteil der Räume', t('= 1,0', { min: 1, slack: 0.3 }), 'niedrig',
    'Zonen aus den Möbelkategorien (Sitzen, Arbeiten, Lagern, Schlafen, Essen); Näherung über die Komponenten-Kennung.'),
  def('LV-19b', 'LV-19', 'Räume > 120 Zellen mit >= 3 Zonen oder Höhenstaffelung', 'Anteil der Räume', t('= 1,0', { min: 1, slack: 0.3 }), 'niedrig',
    'Höhenstaffelung = Treppe/Geländer/Balkendecke im Raum.'),
  def('LV-20a', 'LV-20', 'Räume >= 4 hoch mit Deckengliederung', 'Anteil der Räume', t('= 1,0', { min: 1, slack: 0.3 }), 'mittel', 'Balkenlinien (>= 2, Holzstämme) unter oder in der Decke.'),
  def('LV-20b', 'LV-20', 'Balkenabstand 3-5', 'Anteil der Abstände', t('>= 0,80', { min: 0.8, slack: 0.2, origin: 'own' }), 'niedrig', 'Abstände benachbarter Balkenlinien im Raum; Anteil ist eine eigene Setzung.'),
  def('LV-21a', 'LV-21', 'Hauptraum mit Blickfang und Achse', 'Anteil der Bauten', t('= 1,0', { min: 1, slack: 0.3 }), 'niedrig', 'Blickfang = Feuerstelle/Thron/Altar/Werkbank u. Ä.; Achse = Teppich/Läufer oder Pfeilerreihe.'),
  def('LV-21b', 'LV-21', 'Möbel in Wandnähe', 'Anteil', t('<= 0,70', { max: 0.7, slack: 0.1 }), 'mittel', 'Möbelanker höchstens 1 Zelle von der Wand.'),
  def('LV-22a', 'LV-22', 'Lichter an konkreten Trägern', 'Anteil', t('>= 0,80', { min: 0.8, slack: 0.2 }), 'mittel', 'alles außer Fackeln (freie und Wandfackeln) zählt als Träger-Licht.'),
  def('LV-22b', 'LV-22', 'Dunkle (spawnfähige) Zellen', 'Anteil der Begehzellen', t('= 0', { max: 0, slack: 0.02 }), 'hoch', 'Lichtbericht der Materialisierung.'),
  def('LV-23', 'LV-23', 'Möbel in Clustern (>= 2 Teile)', 'Anteil', t('>= 0,70', { min: 0.7, slack: 0.15 }), 'niedrig', 'Cluster: Möbel im selben Raum höchstens 2 Zellen auseinander; Einzelmöbel <= 15 % ist strenger.'),
  // --- Kohäsion (LV_tiefe_detail 5.4) ---
  def('KM1', 'KM1', 'Familien-Fokus (3 häufigste Familien)', 'Anteil', t('>= 0,85', { min: 0.85, slack: 0.1, origin: 'own' }), 'mittel', 'Bauteile inkl. Innenraum, ohne Gelände und Pflanzen; Ziel im Plan als Schätzung.'),
  def('KM3', 'KM3', 'Rastertreffer (Pfosten, Fensterachsen)', 'Anteil', t('>= 0,90', { min: 0.9, slack: 0.2, origin: 'own' }), 'niedrig', 'nur Baue mit Fassadenraster; Innenbalken und Regalachsen nicht gemessen.'),
  def('KM4', 'KM4', 'Farbton-Cluster gefärbter Blöcke', 'Cluster', t('<= 2', { max: 2, slack: 1, origin: 'own' }), 'mittel', 'OKLab-Farbton der Farbstoff-Blöcke, Cluster ab 40 Grad Lücke; Grautöne ohne Farbton.'),
  def('KM5', 'KM5', 'Innen-Außen-Schnitt der Holz-/Steinfamilien', 'Anteil', t('>= 0,80', { min: 0.8, slack: 0.2, origin: 'own' }), 'mittel', 'Innenfamilien (>= 2 %), die auch außen vorkommen.'),
  def('KM6a', 'KM6', 'Umgebungsmaterial in Gebäudefamilien', 'Anteil', t('>= 0,80', { min: 0.8, slack: 0.2, origin: 'own' }), 'niedrig', 'Zäune und Umgebungsteile (q-Props) sowie nicht natürliche Bodenblöcke der Umgebung.'),
  def('KM6b', 'KM6', 'Fundamentring enthält Wand-/Sockelfamilie', 'Anteil der Bauten', t('= 1,0', { min: 1, slack: 0.3, origin: 'own' }), 'niedrig', 'Ring von 3 Blöcken um das Fundament, Boden- und Außenteile.'),
];

/** Nicht messbare Regeln (brauchen Menschen, Generierungsläufe oder Anbau-Zuordnung), mit Begründung. */
export const UNMEASURABLE: readonly { readonly rule: string; readonly name: string; readonly why: string }[] = [
  { rule: 'KM2', name: 'Motiv-Wiederkehr', why: 'Das Leitmotiv ist im Voxelmodell nicht als Motiv erkennbar; nur über die Ableitungsdaten des Generators messbar.' },
  { rule: 'KM7', name: 'Anbau-Übergang', why: 'Braucht die Zuordnung Anbau <-> Haupthaus; ohne Anbau-Markierung im Volumen nicht ableitbar.' },
  { rule: 'KM8', name: 'Blind-A/B-Urteil', why: 'Menschliches Urteil (Likert), siehe spikes/r7/ab_score.py.' },
  { rule: 'KM9', name: 'Zufallskohärenz', why: 'Kontrolle über viele Seeds an Ableitungsregeln, nicht an einer einzelnen Ausgabe.' },
];

export const METRIC_BY_ID: ReadonlyMap<string, MetricDef> = new Map(METRIC_DEFS.map((d) => [d.id, d]));
