/**
 * Lokaler Klassifikator: Natural Language → `building_generate`-Anfrage ohne Modell, ohne Netz, in < 1 ms.
 * Regeln über Schlüsselwörter (Deutsch/Englisch) auf das Vokabular der Engine – Labels aus dem Katalog (IDs, Namen)
 * werden automatisch erkannt, die Synonym-Tabellen ergänzen Umgangssprache. Rein und deterministisch.
 *
 * Einsatz: Rückfall, wenn kein LLM erreichbar ist; Vorfilter für einfache Prompts (hohe `confidence` → kein
 * Modellaufruf nötig); Baseline, gegen die ein eigenes Modell gemessen wird (`test/intent.test.ts`).
 */
import type { EngineRequest } from '../engine.js';
import type { Vocabulary } from '../vocabulary.js';

export interface LocalIntent {
  readonly request: EngineRequest;
  /**
   * 0–1: {@link LOCAL_CONFIDENCE} – 1 = Bautyp ausdrücklich genannt, 0,8 = als Kopf eines Kompositums erkannt
   * („Zwergenfestung“ → Burg), 0,3 = Standard (Haus) angenommen.
   */
  readonly confidence: number;
  /** Erkannte Merkmale (für Log und Fehlersuche). */
  readonly matched: readonly string[];
  /**
   * W7-E: Stil-Akzent aus Stimmungswörtern („Fantasy“, „verwunschen“, „magisch“), steht in `matched` (`akzent:fantasy`).
   * W7-D: in der Anfrage als Fantasy-Stufe `exterior.fantasy: 'accent'` (Fantasy-Module), außer das Theme bringt sein
   * Kit ohnehin voll mit (elven, dwarven) oder die Außen-Deko ist aus.
   */
  readonly accent?: 'fantasy';
}

/**
 * Sicherheit des lokalen Klassifikators für den Bautyp. Kompositum (W1-G): Deutsche Zusammensetzungen tragen die Art
 * am Wortende („Leuchtturm“, „Zwergenfestung“). Das ist nur dann eine gute Spur, wenn das Bestimmungswort den Bau nicht
 * zu etwas anderem macht (Review R2-03: „Fernsehturm“, „Turnhalle“, „Hundehütte“ sind kein Wachturm, keine Halle, kein
 * Haus). Deshalb: bekanntes, unbedenkliches Bestimmungswort ({@link SAFE_MODIFIERS}) → `compound` (über der Schwelle),
 * jedes andere → `compoundUnknown` (unter der Schwelle: „Kein Bautyp sicher erkannt“, der Typ bleibt als Vorschlag im
 * Hintergrund). `typo` (W7-E): ein Wort ab 6 Buchstaben weicht um einen Buchstaben von einem Bautyp-Wort ab
 * („Tarverne“), gleicher Anfangsbuchstabe. `assumed`: nichts erkannt, Standard „Haus“.
 */
export const LOCAL_CONFIDENCE = { explicit: 1, compound: 0.8, typo: 0.7, compoundUnknown: 0.5, assumed: 0.3 } as const;

/**
 * Unbedenkliche Bestimmungswörter vor einer Gebäudeart (normalisiert, mit Fugenlaut): Völker/Stil, Material, Lage,
 * Größe und Zweck, die die Bauart nicht ändern („Zwergenfestung“ bleibt eine Burg, „Leuchtturm“ ein Turm, „Dorfschenke“
 * eine Taverne). Bewusst eine Liste statt einer Regel: Ein unbekanntes Bestimmungswort („Fernseh-“, „Wasser-“, „Turn-“,
 * „Schwimm-“, „Bahnhofs-“, „Hunde-“, „Glocken-“) macht den Treffer unsicher, nicht falsch sicher.
 */
export const SAFE_MODIFIERS: ReadonlySet<string> = new Set([
  // Völker und Stil
  'zwerg', 'zwergen', 'elfen', 'elben', 'ritter', 'raeuber', 'koenigs', 'wikinger', 'bauern', 'buerger', 'haendler', 'jaeger', 'mittelalter',
  // Material
  'stein', 'holz', 'fachwerk', 'lehm', 'backstein', 'ziegel', 'fels',
  // Lage
  'berg', 'wald', 'dorf', 'stadt', 'see', 'fluss', 'kuesten', 'hafen', 'grenz', 'wuesten', 'wiesen', 'hang',
  // Größe und Zweck, die die Bauart nicht ändern
  'gross', 'klein', 'alt', 'wach', 'wehr', 'leucht', 'fest', 'gast', 'land', 'herren', 'guts',
  // W7-E (Testsatz): Bauweise, Bewohner und Stimmung, die die Bauart nicht ändern („Blockhütte“, „Strandhütte“,
  // „Magierturm“, „Hexenhaus“, „Ferienhaus“, „Winterhütte“)
  'block', 'strand', 'magier', 'zauberer', 'hexen', 'fischer', 'jagd', 'ferien', 'sommer', 'winter', 'schnee', 'feen', 'maerchen', 'garten',
]);

/**
 * Schwelle „Bautyp sicher erkannt“ (W1-G, S2/R1-02) für alle, die eine Erkennung anzeigen: Editor-Assistent und Website
 * (KI-Architekt). Gilt für die Konfidenz des Felds `buildingTypeId` in der Antwort von `/v1/interpret` – von JEV oder,
 * bei lokaler Erkennung, vom Klassifikator ({@link LOCAL_CONFIDENCE}). Darunter wird kein Bautyp vorgeschlagen, sondern
 * um eine Wahl gebeten. Derselbe Wert wie die Übernahme-Schwelle für JEV-Felder (`DEFAULT_MIN_CONFIDENCE`).
 */
export const TYPE_CONFIDENCE_MIN = 0.6;

/** Kleinbuchstaben, Umlaute gefaltet, Satzzeichen weg. */
export const normalize = (s: string): string =>
  ` ${s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Synonyme je Bautyp-ID (nur wirksam, wenn der Bautyp im Katalog ist). Spezifischere Begriffe sind länger → gewinnen. */
const BUILDING_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  hobbit: ['hobbit', 'hobbithoehle', 'hobbithaus', 'erdhoehle', 'erdhaus', 'huegelhaus', 'im huegel', 'auenland', 'shire'],
  tavern: ['taverne', 'gasthaus', 'gasthof', 'wirtshaus', 'kneipe', 'schenke', 'inn', 'tavern', 'pub'],
  castle_compact: ['burg', 'schloss', 'festung', 'castle', 'fortress', 'keep', 'ritterburg', 'burgruine'],
  watchtower: ['wachturm', 'turm', 'watchtower', 'tower', 'aussichtsturm'],
  farmhouse: ['bauernhof', 'bauernhaus', 'gehoeft', 'farmhouse', 'farm', 'hof mit scheune', 'scheune'],
  longhouse: ['langhaus', 'wikingerhaus', 'longhouse', 'wikinger langhaus', 'viking longhouse'],
  townhouse: ['stadthaus', 'townhouse', 'buergerhaus', 'city house', 'town house'],
  townhouse_row: ['reihenhaus', 'reihenhaeuser', 'haeuserzeile', 'haeuserreihe', 'row houses', 'terraced'],
  timber: ['fachwerkhaus', 'fachwerk', 'timber frame', 'timbered'],
  hall: ['halle', 'hall', 'saal'],
  twostory: ['zweistoeckiges haus', 'two story house', 'two storey house'],
  house: ['haus', 'house', 'huette', 'hut', 'cottage', 'cabin', 'wohnhaus', 'home',
    // W7-E: Verkleinerungen und Hausarten ohne eigenen Bautyp („Landhaus“ ist kein Langhaus)
    'haeuschen', 'haeuslein', 'blockhaus', 'blockhuette', 'log cabin', 'landhaus', 'hexenhaus'],
};

const THEME_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  nordic: ['nordisch', 'wikinger', 'viking', 'nordic', 'skandinavisch'],
  medieval: ['mittelalter', 'mittelalterlich', 'medieval'],
  rustic: ['rustikal', 'laendlich', 'rustic', 'rural'],
  timber: ['fachwerk', 'timber'],
  // FN-Themes: Falurot-Haus, Gotik, Asien, Steampunk
  nordic_falu: ['falu', 'falurot', 'falun', 'schwedenhaus', 'schwedisch', 'swedish'],
  gothic: ['gotik', 'gotisch', 'gotische', 'gothic'],
  asian: ['asiatisch', 'asiatische', 'asian', 'japanisch', 'japanische', 'japanese', 'pagode', 'pagoda', 'chinesisch', 'chinese'],
  steampunk: ['steampunk', 'dampfmaschine', 'dampfbetrieben'],
  farmstead: ['farmstead', 'farmhouse'],
  // W1-G: Völker als Stil („Zwergenfestung“, „Elfen-Baumhaus“) – Wortanfang ab 6 Zeichen greift auch im Kompositum
  dwarven: ['zwerge', 'zwergen', 'zwergisch', 'zwergische', 'dwarf', 'dwarven', 'dwarvish'],
  elven: ['elfen', 'elfisch', 'elfische', 'elbisch', 'elbische', 'elven', 'elvish'],
};

/**
 * W7-E: Stimmungs- und Ortswörter → Theme (Nutzer-Feedback 26.09.: „gemütlich“, „verwunschen“, „düster“ … gingen
 * verloren, das Beispielhaus kam dann im ersten Theme des Katalogs). Ziele sind Theme-IDs des Engine-Vokabulars; ein
 * Eintrag wirkt nur, wenn das Theme im Katalog ist. Ein ausdrücklich genanntes Theme („nordisch“, „Fachwerk“) hat immer
 * Vorrang. Wörter ab 6 Zeichen gelten auch als Wortanfang („gemütliche“, „Fichtenholz“), Längeres gewinnt („dark
 * fantasy“ vor „fantasy“). Bewusst ohne „dunkel“/„dark“ allein (Material: „dunkle Eiche“, „dark oak“).
 */
export const MOOD_THEMES: Readonly<Record<string, readonly string[]>> = {
  rustic: ['gemuetlich', 'cozy', 'cosy', 'heimelig', 'behaglich', 'urig', 'urige', 'uriges', 'kuschelig', 'snug', 'homely'],
  elven: ['verwunschen', 'verzaubert', 'enchanted', 'maerchenhaft', 'fairytale', 'fairy tale', 'magisch', 'magical', 'mystisch', 'mystical',
    'fantasy', 'zauberhaft', 'whimsical'],
  dwarven: ['dark fantasy', 'duestere fantasy', 'unter dem berg', 'under the mountain'],
  ruin: ['duester', 'finster', 'unheimlich', 'gruselig', 'schaurig', 'spooky', 'creepy', 'haunted', 'spuk', 'spukhaus', 'geisterhaus', 'gloomy',
    'grim', 'sinister', 'halloween', 'verfallen', 'zerfallen', 'ruined', 'crumbling'],
  winter: ['winterlich', 'verschneit', 'schnee', 'snow', 'snowy', 'frostig', 'eisig', 'icy', 'frozen', 'wintry', 'weihnachtlich'],
  desert: ['orientalisch', 'oriental', 'arabisch', 'arabian', 'maurisch', 'aegyptisch', 'egyptian', 'sandstein', 'sandstone', 'oase', 'oasis'],
  tropical: ['dschungel', 'jungle', 'karibik', 'caribbean', 'palmen', 'bambus', 'bamboo'],
  harbor: ['meer', 'am see', 'strand', 'beach', 'seaside', 'coastal', 'hafen', 'harbour', 'fischer', 'maritim', 'maritime', 'lakeside'],
  nordic: ['skandinavisch', 'scandinavian', 'fichte', 'fichtenholz', 'spruce', 'norse'],
};

/** W7-E: Wörter für den Fantasy-Akzent (vorbereitet, siehe {@link LocalIntent.accent}). */
export const FANTASY_WORDS: readonly string[] = [
  'fantasy', 'verwunschen', 'verzaubert', 'enchanted', 'maerchenhaft', 'fairytale', 'magisch', 'magical', 'mystisch', 'mystical', 'zauberhaft',
  'magier', 'zauberer', 'wizard', 'drachen', 'dragon', 'feen', 'elfen', 'elven', 'zwergen', 'dwarven',
];

/**
 * W7-D: Themes mit eigenem Fantasy-Kit (Kit gleichen Namens, `@mcda/exterior` `FANTASY_KITS`; Test hält beide Listen
 * gleich) – dort ist die Fantasy-Stufe ohne Angabe schon `full`. Hier als Liste, damit der Browser-Einstieg
 * (`@mcda/engine/intent`) ohne die Domänenpakete auskommt.
 */
export const FANTASY_THEMES: readonly string[] = ['elven', 'dwarven'];

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Stil-Angaben („im Bauernhof-Stil“, „Bauernhofstil“, „im Stil eines Bauernhofs“, „farmhouse style“): Das Wort nennt
 * das Theme, nicht den Bautyp. Liefert den Text ohne diese Wörter für die Bautyp-Erkennung.
 */
function withoutStyleWords(text: string): string {
  return text
    .replace(/ [a-z0-9]+(?= (?:stil|style|look) )/g, ' ')
    .replace(/ (?:stil|style) (?:von|vom|eines|einer|des|der|of|of an?|of the) [a-z0-9]+(?= )/g, ' ')
    .replace(/ [a-z0-9]{3,}stil(?= )/g, ' ');
}

/**
 * Verneinte Angaben entfernen („nicht zu groß“, „bitte nicht mittelalterlich“, „kein Fachwerk“, „not too big“): das
 * verneinte Wort nennt keinen positiven Wert. Umgebung/Deko haben zusätzlich eigene Muster im Originaltext
 * („ohne Garten“), denn dort ist das Abschalten selbst ein unterstützter Wert.
 */
export const withoutNegated = (text: string): string =>
  text.replace(/ (?:nicht|not|kein|keine|keinen|no|ohne|without)(?: (?:zu|too|so|allzu|sehr|very|ganz|a|an|ein|eine|einen))* [a-z0-9]+(?= )/g, ' ');

const SIZE_WORDS: ReadonlyArray<readonly [string, 'S' | 'M' | 'L']> = [
  ['winzig', 'S'], ['winzige', 'S'], ['winziges', 'S'], ['klein', 'S'], ['kleine', 'S'], ['kleines', 'S'], ['kleiner', 'S'], ['small', 'S'], ['tiny', 'S'], ['little', 'S'],
  ['mittel', 'M'], ['mittelgross', 'M'], ['mittelgrosse', 'M'], ['mittelgrosses', 'M'], ['mittlere', 'M'], ['mittleres', 'M'], ['medium', 'M'],
  ['gross', 'L'], ['grosse', 'L'], ['grosses', 'L'], ['grosser', 'L'], ['riesig', 'L'], ['riesige', 'L'], ['riesiges', 'L'], ['large', 'L'], ['big', 'L'], ['huge', 'L'],
];

const ROOF_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['kruppelwalm', 'half_hip'], ['krueppelwalm', 'half_hip'], ['half hip', 'half_hip'], ['mansard', 'mansard'], ['gambrel', 'gambrel'],
  ['flachdach', 'flat'], ['flat roof', 'flat'], ['flaches dach', 'flat'], ['walmdach', 'hip'], ['hip roof', 'hip'],
  ['satteldach', 'gable'], ['gable roof', 'gable'], ['spitzdach', 'gable'], ['pultdach', 'shed'], ['shed roof', 'shed'], ['saltbox', 'saltbox'],
];

const DIRS: ReadonlyArray<readonly [string, 'north' | 'east' | 'south' | 'west']> = [
  ['norden', 'north'], ['nord', 'north'], ['north', 'north'], ['osten', 'east'], ['ost', 'east'], ['east', 'east'],
  ['sueden', 'south'], ['sued', 'south'], ['south', 'south'], ['westen', 'west'], ['west', 'west'],
];

const NUMBERS: Readonly<Record<string, number>> = { ein: 1, eine: 1, einer: 1, one: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fuenf: 5, five: 5 };

/** Ganzes Wort/ganze Wortfolge; mit `prefix` auch als Wortanfang ab 6 Zeichen (Komposita: „Hobbithöhle“, „Fachwerkhaus“). */
const has = (text: string, phrase: string, prefix: boolean): boolean =>
  text.includes(` ${phrase} `) || (prefix && phrase.length >= 6 && text.includes(` ${phrase}`));

/** Kompositum mit Kopf am Wortende: Kopf ≥ 4 Zeichen, davor ein Bestimmungswort ≥ 3 Buchstaben (nicht „shall“ → hall). */
const COMPOUND_HEAD = 4;
const COMPOUND_MODIFIER = 3;
/**
 * Bestimmungswort vor dem Kopf `phrase` (ganzes Wort = Bestimmungswort + Kopf), sonst `undefined`. Steht der Kopf in
 * mehreren Wörtern, gewinnt ein unbedenkliches Bestimmungswort.
 */
function headModifier(text: string, phrase: string): string | undefined {
  if (phrase.length < COMPOUND_HEAD || phrase.includes(' ')) return undefined;
  const found = [...text.matchAll(new RegExp(` ([a-z0-9]*[a-z]{${COMPOUND_MODIFIER}})${esc(phrase)}(?= )`, 'g'))].map((m) => m[1]!);
  return found.find((m) => SAFE_MODIFIERS.has(m)) ?? found[0];
}

/**
 * Bester Treffer: längster passender Begriff (spezifisch vor allgemein). Mit `head` zählen auch Wortenden
 * (Komposita, W1-G) – bei gleicher Länge verliert so ein Treffer gegen jedes ganze Wort bzw. jeden Wortanfang; bestehende
 * Treffer bleiben dadurch unverändert (Längenvorrang). Drittes Feld: Bestimmungswort, wenn der Treffer nur ein Wortende war.
 */
function bestMatch(text: string, candidates: ReadonlyArray<readonly [string, string]>, prefix = false, head = false): [string, string, string | undefined] | undefined {
  let best: [string, string, string | undefined] | undefined;
  let score = -1;
  for (const [phrase, id] of candidates) {
    const whole = has(text, phrase, prefix);
    const modifier = !whole && head ? headModifier(text, phrase) : undefined;
    if (!whole && modifier === undefined) continue;
    const s = phrase.length - (modifier !== undefined ? 0.5 : 0);
    if (s > score) {
      best = [phrase, id, modifier];
      score = s;
    }
  }
  return best;
}

/** Damerau-Levenshtein-Abstand ≤ 1 (ein Buchstabe mehr, weniger, anders oder zwei vertauscht). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const rest = (x: string, y: string): boolean => x === y;
  if (a.length === b.length) {
    return rest(a.slice(i + 1), b.slice(i + 1)) || (a[i] === b[i + 1] && a[i + 1] === b[i] && rest(a.slice(i + 2), b.slice(i + 2)));
  }
  return a.length > b.length ? rest(a.slice(i + 1), b.slice(i)) : rest(a.slice(i), b.slice(i + 1));
}

/** Tippfehler-Länge: Wort und Bautyp-Wort ab so vielen Buchstaben (kürzere Wörter sind zu oft andere Wörter). */
const TYPO_MIN = 6;
/**
 * W7-E: Bautyp-Wort mit einem Tippfehler („Tarverne“, „Schlos“), nur wenn sonst nichts erkannt ist: ganzes Wort und
 * Bautyp-Wort ≥ {@link TYPO_MIN} Buchstaben, gleicher Anfangsbuchstabe („cavern“ ist keine „tavern“).
 */
function typoMatch(text: string, candidates: ReadonlyArray<readonly [string, string]>): [string, string, string] | undefined {
  const words = text.trim().split(' ').filter((w) => w.length >= TYPO_MIN);
  for (const w of words) {
    for (const [phrase, id] of candidates) {
      if (phrase.length < TYPO_MIN || phrase.includes(' ') || phrase[0] !== w[0]) continue;
      if (withinOneEdit(w, phrase)) return [phrase, id, w];
    }
  }
  return undefined;
}

/**
 * W7-E: Lage aus der Beschreibung, alle Lagen des Vokabulars (`SETTING_KINDS`) – auch die, die die Domäne noch nicht
 * baut (`settingBuildable`, @mcda/pipeline): Die Erkennung nennt sie, die Engine meldet sie im Ergebnis als „noch nicht
 * baubar“ statt still ebenerdig zu bauen. Reihenfolge = Vorrang (spezifischer zuerst).
 */
const SETTING_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['buried', /(unterirdisch|unter der erde|underground|im huegel|in einem huegel|in den huegel)/],
  ['underwater', /(unter wasser|unterwasser|underwater|under water|meeresgrund)/],
  ['stilts', /(pfahlbau|pfahlhaus|auf stelzen|stelzen|stilts)/],
  ['tree', /(baumhaus|baumhaeuser|im baum|in einem baum|auf einem baum|in den baeumen|baumkrone|treehouse|tree house|in a tree|up a tree|in the trees)/],
  ['carved', /(in den (berg|fels|felsen) gehauen|in den fels|im fels|im berg|in einem berg|in den berg|carved|into the (mountain|rock|cliff)|in the mountain|inside a mountain|in the rock)/],
  ['cliff', /(am hang|an einem hang|am abhang|am berghang|hanglage|auf einem felsen|auf dem felsen|auf einer klippe|an der klippe|an einer klippe|steilhang|cliff|hillside|mountainside)/],
  ['water', /(am see|am wasser|am fluss|am ufer|am meer|am strand|am teich|am bach|by the (lake|river|sea|water)|on the (lake|river|water)|lakeside|riverside|waterfront|seaside)/],
];

/** W7-E: Nutzungszustand (`storyState`) aus der Beschreibung; Reihenfolge = Vorrang. */
const STORY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['belagert', /(belagert|besieged|under siege)/],
  ['verfallen', /(verfallen|zerfallen|baufaellig|ruine|ruined|in ruins|crumbling|dilapidated|derelict)/],
  ['verlassen', /(verlassen|abandoned|haunted|spukhaus|geisterhaus|verwaist|leerstehend)/],
  ['neu', /(brandneu|nagelneu|brand new|neu gebaut|frisch gebaut|newly built)/],
];

/**
 * W2-1: Funktionsgrad (`functionLevel`) aus der Beschreibung; Reihenfolge = Vorrang (`rich` zuerst). „Redstone-Haus“,
 * „voller Funktion“, „viele Anlagen“ → rich; „mit funktionalen Anlagen“, „Funktionsraum“, „mit Farm“ → some.
 */
const FUNCTION_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['rich', /(redstone haus|redstonehaus|redstone base|redstone basis|technikbasis|technik basis|voll funktional|voller funktion|volle funktion|fully functional|viele (funktionale |funktions)?(anlagen|funktionsraeume|farmen|maschinen)|reich(lich)? an anlagen|lots of (functional )?(rooms|machines|farms)|functional base|technische anlagen)/],
  ['some', /(funktionale?n? (anlage|anlagen|raeume|raum|zimmer|einrichtung)|funktionsraum|funktionsraeume|funktionsgrad|mit (einer |ein |etwas )?(farm|mikrofarm|schmelze|brauerei|produktion|lager mit sortierer|sortieranlage)|functional (rooms?|machines?|farms?)|with (a )?(farm|smelter|brewery))/],
];

/**
 * feat/gelaende: Geländeform (`landform`) aus der Beschreibung; Reihenfolge = Vorrang (`dramatic` zuerst). „am Hang“ bleibt
 * die Lage `cliff` (SETTING_PATTERNS) – hier nur die Landschaft rund ums Haus: hügelig, terrassiert, mit Teich, naturnah.
 */
const LANDFORM_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['dramatic', /(terrassen|terrassiert|terrassenlandschaft|stark huegelig|steiles gelaende|bergiges gelaende|gebirgig|dramatische landschaft|dramatic (terrain|landscape)|terraced|steep terrain)/],
  ['natural', /(huegelig|huegelland|huegel gelaende|welliges gelaende|naturnah|natuerliche(s|r|n)? (umgebung|gelaende|landschaft)|landschaftlich|mit (einem )?(teich|weiher)|mit findlingen|hilly|rolling (hills|terrain)|natural (terrain|landscape|surroundings)|with (a )?pond|landscaped)/],
];

export function classifyLocal(prompt: string, vocab: Vocabulary): LocalIntent {
  const text = normalize(prompt);
  const positive = withoutNegated(text);
  const matched: string[] = [];
  const input: Record<string, unknown> = {};

  // Bautyp: Katalog-Labels (ID, Name) + Synonyme, nur fertige Bautypen
  const types = vocab.buildingTypes.filter((b) => !b.draft);
  const typeCandidates = types.flatMap((b) => [
    [normalize(b.id).trim(), b.id], [normalize(b.name).trim(), b.id], ...(BUILDING_SYNONYMS[b.id] ?? []).map((w) => [w, b.id]),
  ] as [string, string][]).filter(([w]) => w.length >= 3);
  const bt = bestMatch(withoutStyleWords(positive), typeCandidates, true, true);
  const typo = bt === undefined ? typoMatch(withoutStyleWords(positive), typeCandidates) : undefined;
  const buildingTypeId = bt?.[1] ?? typo?.[1] ?? (types.some((b) => b.id === 'house') ? 'house' : types[0]?.id ?? 'house');
  input['buildingTypeId'] = buildingTypeId;
  if (bt !== undefined) matched.push(bt[2] !== undefined ? `bautyp:${bt[2]}…${bt[0]}` : `bautyp:${bt[0]}`);
  if (typo !== undefined) matched.push(`bautyp:${typo[2]}~${typo[0]}`);
  const type = types.find((b) => b.id === buildingTypeId);

  // Größe (nur wenn der Bautyp sie hat)
  const size = bestMatch(positive, SIZE_WORDS);
  if (size !== undefined && (type === undefined || type.sizes.includes(size[1] as 'S' | 'M' | 'L'))) {
    input['size'] = size[1];
    matched.push(`groesse:${size[0]}`);
  }

  // Etagen: „2 Etagen“, „drei Stockwerke“, „zweistöckig“. Das Bautyp-Wort zählt nicht mit („zweistöckiges Haus“ ist
  // der Bautyp twostory, keine Etagen-Angabe), und eine ausdrückliche Einheit (Etagen, Stockwerke, Geschosse, floors)
  // hat Vorrang vor „-stöckig“/„story“: „two story house, with three floors“ → 3.
  const rest = bt === undefined ? positive : positive.replace(` ${bt[0]}`, ' ');
  const num = '(\\d|ein|eine|einer|zwei|drei|vier|fuenf|one|two|three|four|five)';
  const fl = new RegExp(`\\b${num}\\s*[- ]?\\s*(etagen?|stockwerk(?:e|en)?|geschoss(?:e|en)?|floors?)\\b`).exec(rest)
    ?? new RegExp(`\\b${num}\\s*[- ]?\\s*(stoecke?|stor(?:e)?ys?)\\b`).exec(rest)
    ?? /\b(ein|zwei|drei|vier|fuenf)stoeckig/.exec(rest)
    ?? /\b(\d)\s*[- ]?\s*stoeckig/.exec(rest); // W7-E: „2-stöckig“
  if (fl !== null) {
    const n = /^\d$/.test(fl[1]!) ? Number(fl[1]) : NUMBERS[fl[1]!] ?? 1;
    input['floors'] = n;
    matched.push(`etagen:${n}`);
  }

  // Front/Eingang
  const dir = /(eingang|front|tuer|door|entrance|facing|blick|zeigt)\D{0,20}/.test(positive) || / nach (norden|osten|sueden|westen) /.test(positive)
    ? bestMatch(positive, DIRS) : undefined;
  if (dir !== undefined) {
    input['front'] = dir[1];
    matched.push(`front:${dir[0]}`);
  }

  // Theme: Katalog-Labels + Synonyme. Das Wort, das schon den Bautyp benennt, benennt nicht zusätzlich das Theme
  // („Bauernhof“ ist Bautyp farmhouse und Theme-Name von farmstead; „Wikingerhaus“/„Wikinger-Langhaus“ sind der Bautyp
  // longhouse – „Wikinger“ darin ist kein Theme). Ein weiteres Theme-Wort zählt („nordisches Langhaus“, „Wikinger-Burg“).
  const themeCandidates = vocab.themes.flatMap((t) => [
    [normalize(t.id).trim(), t.id], [normalize(t.name).trim(), t.id], ...(THEME_SYNONYMS[t.id] ?? []).map((w) => [w, t.id]),
  ] as [string, string][]).filter(([w]) => w.length >= 4);
  const themeText = bt === undefined ? positive : positive.replace(new RegExp(` ${esc(bt[0])}[a-z0-9]*(?= )`), ' ');
  const th = bestMatch(themeText, themeCandidates, true);
  if (th !== undefined && !(th[1] === 'timber' && buildingTypeId === 'timber')) {
    input['themeId'] = th[1];
    matched.push(`theme:${th[0]}`);
  } else if (th === undefined && bestMatch(positive, themeCandidates, true) === undefined) {
    // W7-E: Stimmung → Theme, nur ohne ausdrückliches Theme – auch keines im Bautyp-Wort („gemütliches nordisches
    // Langhaus“, „Wikinger-Langhaus“ behalten ihr Theme). Vokabular: nur Themes des Katalogs.
    const known = new Set(vocab.themes.map((t) => t.id));
    const moodCandidates = Object.entries(MOOD_THEMES).filter(([id]) => known.has(id)).flatMap(([id, ws]) => ws.map((w) => [w, id] as [string, string]));
    const mood = bestMatch(themeText, moodCandidates, true);
    if (mood !== undefined) {
      input['themeId'] = mood[1];
      matched.push(`stimmung:${mood[0]}`);
    }
  }
  const accent = FANTASY_WORDS.some((w) => has(positive, w, true)) ? 'fantasy' as const : undefined;
  if (accent !== undefined) matched.push(`akzent:${accent}`);

  // Dach: Form und Neigung („steiles Dach“, „steep roof“)
  const roof = bestMatch(positive, ROOF_WORDS, true); // Wortanfang: „Mansarddach“, „Krüppelwalmdach“
  const pitch = /(steile[mnrs]? (sattel|walm)?dach|steildach|steep (pitched )?roof|steeply pitched)/.test(positive) ? 'steep' : undefined;
  if (roof !== undefined || pitch !== undefined) {
    input['shell'] = { ...(roof !== undefined ? { roof: roof[1] } : {}), ...(pitch !== undefined ? { roofDetail: { pitch } } : {}) };
    if (roof !== undefined) matched.push(`dach:${roof[0]}`);
    if (pitch !== undefined) matched.push(`neigung:${pitch}`);
  }

  // Lage (der Hobbit liegt immer im Hügel: dort keine andere Lage)
  const setting = buildingTypeId === 'hobbit' ? undefined : SETTING_PATTERNS.find(([, re]) => re.test(positive));
  if (setting !== undefined) {
    input['setting'] = { kind: setting[0] };
    matched.push(`lage:${setting[0]}`);
  }

  // Nutzungszustand (W7-E)
  const story = STORY_PATTERNS.find(([, re]) => re.test(positive));
  if (story !== undefined) {
    input['storyState'] = story[0];
    matched.push(`zustand:${story[0]}`);
  }

  // Funktionsgrad (W2-1)
  const fn = FUNCTION_PATTERNS.find(([, re]) => re.test(positive));
  if (fn !== undefined) {
    input['functionLevel'] = fn[0];
    matched.push(`funktionsgrad:${fn[0]}`);
  }

  // Geländeform (feat/gelaende)
  const land = LANDFORM_PATTERNS.find(([, re]) => re.test(positive));
  if (land !== undefined) {
    input['landform'] = land[0];
    matched.push(`gelaende:${land[0]}`);
  }

  // Umgebung, Deko, Format, Seed, Zielversion
  if (/(ohne (garten|gelaende|umgebung|mauer)|keine?n? (garten|gelaende|umgebung)|nur (das )?haus|(without|no) (a )?(garden|terrain|surroundings)|house only)/.test(text)) {
    input['surroundings'] = false;
    matched.push('umgebung:aus');
  }
  if (/(ohne (deko|dekoration|aussendeko)|schlicht|no decor)/.test(text)) {
    input['exterior'] = { enabled: false };
    matched.push('deko:aus');
  } else if (/(viel deko|ueppig|reich verziert|verspielt|lots of decor|ornate)/.test(positive)) {
    input['exterior'] = { density: 2 };
    matched.push('deko:ueppig');
  }
  const fmt = / (litematic|litematica|schem|schematic|worldedit|nbt|structure block) /.exec(positive);
  if (fmt !== null) {
    input['format'] = fmt[1] === 'nbt' || fmt[1] === 'structure block' ? 'nbt' : fmt[1]!.startsWith('litematic') ? 'litematic' : 'schem';
    matched.push(`format:${String(input['format'])}`);
  }
  // W7-D: Fantasy-Akzent → Fantasy-Stufe `accent` der Außengestaltung (`exterior.fantasy`), außer das Theme bringt sein
  // Fantasy-Kit ohnehin voll mit (Kit gleichen Namens: elven, dwarven) oder die Außen-Deko ist aus
  const ext = input['exterior'] as { enabled?: boolean } | undefined;
  const themed = typeof input['themeId'] === 'string' && FANTASY_THEMES.includes(input['themeId']);
  if (accent !== undefined && ext?.enabled !== false && !themed) input['exterior'] = { ...(ext ?? {}), fantasy: 'accent' };
  const seed = /\bseed\s*(\d{1,9})\b/.exec(positive);
  if (seed !== null) input['seed'] = Number(seed[1]);
  if (/\b26 3\b/.test(positive)) input['targetVersion'] = '26.3';

  const confidence = bt === undefined ? (typo !== undefined ? LOCAL_CONFIDENCE.typo : LOCAL_CONFIDENCE.assumed)
    : bt[2] === undefined ? LOCAL_CONFIDENCE.explicit
      : SAFE_MODIFIERS.has(bt[2]) ? LOCAL_CONFIDENCE.compound : LOCAL_CONFIDENCE.compoundUnknown;
  return { request: { op: 'building_generate', input }, confidence, matched, ...(accent !== undefined ? { accent } : {}) };
}
