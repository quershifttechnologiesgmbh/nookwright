/**
 * W7-E Testsatz „Beschreibung → Soll“ (50 Beschreibungen, handgeschrieben am 2026-09-27 VOR der Arbeit am
 * Klassifikator, Anlass: Nutzer-Feedback 26.09. „Der KI-Editor funktioniert fachlich fast gar nicht“). Deutsch und
 * Englisch, konkret, vage, Stimmung, Unsinn. Ein erster Entwurf lag zu nah an den Wortlisten des Klassifikators (38/50
 * schon vorher); neun Fälle wurden vor jeder Änderung am Klassifikator durch umgangssprachliche ersetzt. Dazu ein
 * Kontrollsatz ({@link DESCRIPTIONS_HOLDOUT}). Gemessen in `test/descriptions.test.ts` (Engine-Weg `interpret` im Modus
 * `local` = lokaler Klassifikator samt Bautyp-Sicherheit), dort stehen die Untergrenzen. Live mit JEV:
 * `nl-compare --sets descriptions,descriptions-holdout`.
 *
 * Soll je Feld (nur, wozu die Beschreibung etwas sagt; ein fehlendes Feld wird nicht bewertet):
 * - `type`: akzeptable Bautyp-IDs; `ASK` = eine Rückfrage („Kein Bautyp sicher erkannt“, Sicherheit unter
 *   `TYPE_CONFIDENCE_MIN`) ist richtig. Ein Bautyp zählt nur, wenn er sicher erkannt ist (sonst fragt die App nach).
 * - `theme`: akzeptable Theme-IDs des **gebauten** Ergebnisses (ohne Angabe baut die Engine das erste Theme des Bautyps).
 * - `size`, `roof`, `setting` (`setting.kind`, auch nicht baubare Lagen – die Erkennung soll sie nennen, die Engine meldet
 *   sie dann ehrlich), `floors`, `story` (Nutzungszustand `storyState`).
 * Feste Grundrisse (Beispielhaus, Halle, Zweistöckig, Fachwerkhaus) haben keine Größe: dort wird `size` nicht verlangt.
 */
import type { Vocabulary } from '../../src/vocabulary.js';
import type { NlCase } from './types.js';

/** Rückfrage statt Bautyp ist richtig. */
export const ASK = '?';

export interface DescriptionCase {
  readonly text: string;
  readonly type: readonly string[];
  readonly theme?: readonly string[];
  readonly size?: 'S' | 'M' | 'L';
  readonly roof?: string;
  readonly setting?: string;
  readonly floors?: number;
  readonly story?: string;
  /** Art der Beschreibung (für die Auswertung je Gruppe). */
  readonly kind: 'konkret' | 'vage' | 'stimmung' | 'unsinn';
  /** Begründung, wo das Soll nicht offensichtlich ist. */
  readonly note?: string;
}

const COZY = ['rustic', 'farmstead', 'timber'];

export const DESCRIPTIONS: readonly DescriptionCase[] = [
  // --- konkret, deutsch ---
  { kind: 'konkret', text: 'Kleine Taverne mit Flachdach am Marktplatz', type: ['tavern'], size: 'S', roof: 'flat' },
  { kind: 'konkret', text: 'ne richtig große ritterburg mit burggraben', type: ['castle_compact'], size: 'L' },
  { kind: 'konkret', text: 'Mittelalterliches Stadthaus mit drei Stockwerken und Walmdach', type: ['townhouse'], theme: ['medieval'], roof: 'hip', floors: 3 },
  { kind: 'konkret', text: 'Bau mir ein Wikinger-Langhaus mit steilem Dach', type: ['longhouse'], theme: ['nordic'] },
  { kind: 'konkret', text: 'Erdhaus im Hang wie bei Herr der Ringe', type: ['hobbit'] },
  { kind: 'konkret', text: 'Ein Bauernhof mit Scheune im Fachwerkstil', type: ['farmhouse'], theme: ['timber'] },
  { kind: 'konkret', text: 'Reihenhäuser für eine Stadtstraße, mittelgroß', type: ['townhouse', ASK], note: 'Häuserzeile ist Entwurf (nicht im Vokabular): Stadthaus oder Rückfrage' },
  { kind: 'konkret', text: 'zweistöckiges Fachwerkhaus mit Satteldach', type: ['timber', 'twostory'], theme: ['timber'], roof: 'gable' },
  { kind: 'konkret', text: 'Wachturm am Waldrand, klein, mit Spitzdach', type: ['watchtower'], size: 'S', roof: 'gable' },
  { kind: 'konkret', text: 'Gasthaus, 2-stöckig, Eingang Richtung Osten', type: ['tavern'], floors: 2 },
  { kind: 'konkret', text: 'Eine große Halle für Feste, nordisch', type: ['hall'], theme: ['nordic'] },
  { kind: 'konkret', text: 'Zwergenfestung tief im Berg', type: ['castle_compact'], theme: ['dwarven'], setting: 'carved', note: '„tief im Berg“ = in den Fels gehauen (noch nicht baubar)' },
  { kind: 'konkret', text: 'Pfahlbau am See', type: ['house', ASK], theme: ['harbor'], setting: 'stilts', note: 'Pfahlbau ist eine Lage, kein Bautyp: Haus oder Rückfrage' },
  { kind: 'konkret', text: 'Haus unter der Erde mit Flachdach', type: ['house'], roof: 'flat', setting: 'buried' },
  { kind: 'konkret', text: 'Pferdestall mit Heuboden', type: ['farmhouse', ASK], note: 'kein Bautyp Stall: Bauernhaus (Scheune) oder Rückfrage' },
  { kind: 'konkret', text: 'Leuchtturm an der Küste', type: ['watchtower'], theme: ['harbor'] },
  // --- konkret, englisch ---
  { kind: 'konkret', text: 'small medieval tavern with a gable roof, entrance facing east', type: ['tavern'], theme: ['medieval'], size: 'S', roof: 'gable' },
  { kind: 'konkret', text: 'Tarverne im Dorf, nicht zu groß', type: ['tavern'], note: 'Tippfehler' },
  { kind: 'konkret', text: 'nordic longhouse, large, with a steep roof', type: ['longhouse'], theme: ['nordic'], size: 'L' },
  { kind: 'konkret', text: 'Blockhütte aus Fichtenholz', type: ['house'], theme: ['nordic', 'rustic'], note: 'Fichtenbohlen: nordisch; rustikal vertretbar' },
  { kind: 'konkret', text: 'desert house with a flat roof', type: ['house', 'twostory'], theme: ['desert'], roof: 'flat' },
  { kind: 'konkret', text: 'tall narrow city house, 4 storeys', type: ['townhouse'], floors: 4 },
  { kind: 'konkret', text: 'watchtower on stilts in a swamp', type: ['watchtower'], setting: 'stilts' },
  { kind: 'konkret', text: 'mittelgroße Villa mit Mansarddach', type: ['house', 'twostory', 'townhouse', ASK], roof: 'mansard', note: 'kein Bautyp Villa: ein Wohnhaus oder Rückfrage' },
  { kind: 'konkret', text: 'elven house up in a tree', type: ['house', ASK], theme: ['elven'], setting: 'tree' },
  { kind: 'konkret', text: 'dwarven hall carved into the mountain', type: ['hall'], theme: ['dwarven'], setting: 'carved' },
  // --- vage ---
  { kind: 'vage', text: 'ein gemütliches Haus', type: ['house', 'twostory', 'timber'], theme: COZY },
  { kind: 'vage', text: 'Ich brauche was zum Wohnen für meinen Survival-Start', type: ['house', 'twostory', ASK] },
  { kind: 'vage', text: 'irgendwas Cooles', type: [ASK] },
  { kind: 'vage', text: 'build me something nice', type: [ASK] },
  { kind: 'vage', text: 'a base for me and my friends', type: ['house', 'twostory', ASK] },
  { kind: 'vage', text: 'Etwas Großes, Beeindruckendes', type: ['castle_compact', 'hall', ASK] },
  { kind: 'vage', text: 'ein Haus für einen Schmied', type: ['house'], note: 'Schmiede ist ein Raum des Beispielhauses' },
  { kind: 'vage', text: 'Magierturm aus dunklem Stein', type: ['watchtower'] },
  // --- Stimmung ---
  { kind: 'stimmung', text: 'verwunschenes Häuschen im Wald', type: ['house'], theme: ['elven'] },
  { kind: 'stimmung', text: 'Fantasy-Turm für einen Magier', type: ['watchtower'], theme: ['elven', 'dwarven'] },
  { kind: 'stimmung', text: 'düstere Burg auf einem Felsen', type: ['castle_compact'], theme: ['ruin', 'dwarven'], setting: 'cliff' },
  { kind: 'stimmung', text: 'Wikinger-Dorfhaus, rau und nordisch', type: ['house', 'longhouse'], theme: ['nordic'] },
  { kind: 'stimmung', text: 'orientalischer Palast', type: ['castle_compact', 'hall', ASK], theme: ['desert'] },
  { kind: 'stimmung', text: 'winterliche Hütte in den Bergen', type: ['house'], theme: ['winter'] },
  { kind: 'stimmung', text: 'cozy hobbit hole', type: ['hobbit'], theme: COZY },
  { kind: 'stimmung', text: 'spooky haunted house for halloween', type: ['house'], theme: ['ruin'], story: 'verlassen' },
  { kind: 'stimmung', text: 'verfallene Ruine eines Wachturms', type: ['watchtower'], theme: ['ruin'], story: 'verfallen' },
  { kind: 'stimmung', text: 'gemütliche Taverne mit warmem Licht', type: ['tavern'], theme: [...COZY, 'medieval'] },
  { kind: 'stimmung', text: 'tropische Strandhütte', type: ['house'], theme: ['tropical'] },
  { kind: 'stimmung', text: 'dark fantasy fortress', type: ['castle_compact'], theme: ['dwarven', 'ruin'] },
  // --- Unsinn und nicht Unterstütztes ---
  { kind: 'unsinn', text: 'asdf qwer zxcv', type: [ASK] },
  { kind: 'unsinn', text: 'Kirche mit Glockenturm', type: [ASK], note: 'kein Bautyp Kirche' },
  { kind: 'unsinn', text: 'ein Raumschiff aus Obsidian', type: [ASK] },
  { kind: 'unsinn', text: 'Mach mir eine Pizza', type: [ASK] },
];

/**
 * Kontrollsatz (25 Beschreibungen, geschrieben am 2026-09-27 NACH der ersten Überarbeitung des Klassifikators, bevor er
 * damit gemessen wurde): Der Hauptsatz war zugleich der Satz, an dem optimiert wurde; dieser zeigt, wie viel davon
 * übertragbar ist. Danach nicht mehr daran optimieren (nur Untergrenze im Test).
 */
export const DESCRIPTIONS_HOLDOUT: readonly DescriptionCase[] = [
  { kind: 'vage', text: 'Ich hätte gern ein kleines Häuschen mit Garten für den Anfang', type: ['house', 'twostory'] },
  { kind: 'konkret', text: 'mittelalterliche Schmiede im Dorf', type: ['house', ASK], theme: ['medieval'] },
  { kind: 'unsinn', text: 'baue eine elfenstadt im wald', type: [ASK], theme: ['elven'] },
  { kind: 'konkret', text: 'ein riesiges Schloss für den König', type: ['castle_compact'], size: 'L' },
  { kind: 'stimmung', text: 'Taverne im Schnee mit großem Kamin', type: ['tavern'], theme: ['winter'] },
  { kind: 'konkret', text: 'big viking hall for feasts', type: ['hall', 'longhouse'], theme: ['nordic'] },
  { kind: 'stimmung', text: 'small spooky tower', type: ['watchtower'], theme: ['ruin'], size: 'S' },
  { kind: 'konkret', text: 'Ein Wohnturm aus Bruchstein, drei Etagen', type: ['watchtower'], floors: 3 },
  { kind: 'konkret', text: 'Hütte am Fluss', type: ['house'], setting: 'water' },
  { kind: 'stimmung', text: 'cozy cottage in the mountains', type: ['house'], theme: COZY },
  { kind: 'konkret', text: 'Burg am Meer', type: ['castle_compact'], theme: ['harbor'], setting: 'water' },
  { kind: 'unsinn', text: 'Zwergenmine unter dem Berg', type: [ASK], theme: ['dwarven'] },
  { kind: 'konkret', text: 'house with a flat roof and three floors', type: ['house', 'twostory'], roof: 'flat', floors: 3 },
  { kind: 'konkret', text: 'Fachwerk-Gasthaus mit Walmdach', type: ['tavern'], theme: ['timber'], roof: 'hip' },
  { kind: 'konkret', text: 'Wüstenfestung', type: ['castle_compact'], theme: ['desert'] },
  { kind: 'stimmung', text: 'a haunted mansion', type: ['house', 'twostory', ASK], theme: ['ruin'], story: 'verlassen' },
  { kind: 'konkret', text: 'Bauernhaus, groß, mit Satteldach, Eingang nach Norden', type: ['farmhouse'], size: 'L', roof: 'gable' },
  { kind: 'unsinn', text: 'Pagode im japanischen Stil', type: [ASK] },
  { kind: 'stimmung', text: 'gemütliches Langhaus', type: ['longhouse'], theme: ['rustic', 'nordic'] },
  { kind: 'stimmung', text: 'Magic tower of a wizard', type: ['watchtower'], theme: ['elven'] },
  { kind: 'stimmung', text: 'verlassenes Bauernhaus', type: ['farmhouse'], story: 'verlassen' },
  { kind: 'konkret', text: 'Leuchtturm', type: ['watchtower'] },
  { kind: 'unsinn', text: 'Hochhaus mit 20 Etagen', type: [ASK] },
  { kind: 'konkret', text: 'desert tavern with a dome', type: ['tavern'], theme: ['desert'] },
  { kind: 'unsinn', text: 'kleine Kapelle', type: [ASK] },
];

/** Bewertete Felder in fester Reihenfolge. */
export const DESCRIPTION_FIELDS = ['type', 'theme', 'size', 'roof', 'setting', 'floors', 'story'] as const;
export type DescriptionField = (typeof DESCRIPTION_FIELDS)[number];

/** Was eine Erkennung liefert, auf die bewerteten Felder gebracht. */
export interface DescriptionGuess {
  /** Bautyp oder `ASK` (Sicherheit unter der Schwelle). */
  readonly type: string;
  /** Theme des gebauten Ergebnisses (angefragt oder erstes des Bautyps). */
  readonly theme: string;
  readonly size?: string;
  readonly roof?: string;
  readonly setting?: string;
  readonly floors?: number;
  readonly story?: string;
}

/** Treffer je Feld (nur Felder mit Soll): `true` = getroffen. */
export function scoreDescription(c: DescriptionCase, g: DescriptionGuess): Partial<Record<DescriptionField, boolean>> {
  const out: Partial<Record<DescriptionField, boolean>> = { type: c.type.includes(g.type) };
  if (c.theme !== undefined) out.theme = c.theme.includes(g.theme);
  if (c.size !== undefined) out.size = g.size === c.size;
  if (c.roof !== undefined) out.roof = g.roof === c.roof;
  if (c.setting !== undefined) out.setting = g.setting === c.setting;
  if (c.floors !== undefined) out.floors = g.floors === c.floors;
  if (c.story !== undefined) out.story = g.story === c.story;
  return out;
}

/** Für `nl-compare` (JEV live): nur eindeutige Erwartungen (ein Bautyp, ein Theme) als `want`. */
export const toNlCase = (c: DescriptionCase): NlCase => ({
  prompt: c.text,
  want: {
    ...(c.type.length === 1 && c.type[0] !== ASK ? { buildingTypeId: c.type[0] } : {}),
    ...(c.theme?.length === 1 ? { themeId: c.theme[0] } : {}),
    ...(c.size !== undefined ? { size: c.size } : {}),
    ...(c.roof !== undefined ? { shell: { roof: c.roof } } : {}),
    ...(c.setting !== undefined ? { setting: { kind: c.setting } } : {}),
    ...(c.floors !== undefined ? { floors: c.floors } : {}),
    ...(c.story !== undefined ? { storyState: c.story } : {}),
  },
});
export const DESCRIPTIONS_NL: readonly NlCase[] = DESCRIPTIONS.map(toNlCase);
export const DESCRIPTIONS_HOLDOUT_NL: readonly NlCase[] = DESCRIPTIONS_HOLDOUT.map(toNlCase);

/** Theme, das `projectFromBuildingType` baut: angefragt, sonst erstes des Bautyps, sonst `fallbackTheme`. */
export function builtTheme(input: Readonly<Record<string, unknown>>, vocab: Vocabulary, fallbackTheme: string): string {
  const known = new Set(vocab.themes.map((t) => t.id));
  const type = vocab.buildingTypes.find((b) => b.id === input['buildingTypeId']);
  return [input['themeId'] as string | undefined, ...(type?.themes ?? []), fallbackTheme].find((t) => t !== undefined && known.has(t)) ?? fallbackTheme;
}

/** Anfrage + Bautyp-Sicherheit → bewertete Felder (unter `minConfidence` gilt die Antwort als Rückfrage). */
export function guessOf(input: Readonly<Record<string, unknown>>, confidence: number | undefined, minConfidence: number, theme: string): DescriptionGuess {
  const shell = input['shell'] as { roof?: string } | undefined;
  const setting = input['setting'] as { kind?: string } | undefined;
  return {
    type: confidence !== undefined && confidence < minConfidence ? ASK : String(input['buildingTypeId']),
    theme,
    ...(input['size'] !== undefined ? { size: String(input['size']) } : {}),
    ...(shell?.roof !== undefined ? { roof: shell.roof } : {}),
    ...(setting?.kind !== undefined ? { setting: setting.kind } : {}),
    ...(input['floors'] !== undefined ? { floors: Number(input['floors']) } : {}),
    ...(input['storyState'] !== undefined ? { story: String(input['storyState']) } : {}),
  };
}

export interface DescriptionScore {
  /** Treffer je Feld: [getroffen, bewertet]. */
  readonly hits: Readonly<Record<DescriptionField, readonly [number, number]>>;
  /** Beschreibungen mit allen bewerteten Feldern getroffen. */
  readonly all: number;
  /** Markdown-Zeilen je Beschreibung (✓/✗, Felder, Fehlwert in Klammern). */
  readonly rows: readonly string[];
}

/** Satz auswerten: `guess` liefert je Beschreibung die bewerteten Felder. */
export function scoreDescriptions(cases: readonly DescriptionCase[], guess: (c: DescriptionCase) => DescriptionGuess): DescriptionScore {
  const hits = Object.fromEntries(DESCRIPTION_FIELDS.map((f) => [f, [0, 0]])) as Record<DescriptionField, [number, number]>;
  let all = 0;
  const rows: string[] = [];
  for (const c of cases) {
    const g = guess(c);
    const s = scoreDescription(c, g);
    for (const [f, ok] of Object.entries(s) as [DescriptionField, boolean][]) {
      hits[f][1]++;
      if (ok) hits[f][0]++;
    }
    const good = Object.values(s).every(Boolean);
    if (good) all++;
    const cells = Object.entries(s).map(([f, ok]) => (ok ? f : `${f}✗(${String(g[f as keyof DescriptionGuess] ?? '–')})`));
    rows.push(`| ${good ? '✓' : '✗'} | ${c.text} | ${cells.join(' ')} |`);
  }
  return { hits, all, rows };
}

/** Kurzfassung „type 44/50 · theme …“. */
export const scoreSummary = (s: DescriptionScore, n: number): string =>
  `${DESCRIPTION_FIELDS.map((f) => `${f} ${s.hits[f][0]}/${s.hits[f][1]}`).join(' · ')} · alle Felder ${s.all}/${n}`;
