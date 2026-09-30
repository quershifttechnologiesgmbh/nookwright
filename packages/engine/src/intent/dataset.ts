/**
 * Synthetischer Trainingsdatensatz: Prompt (Deutsch/Englisch) → erwartete Engine-Anfrage. Aus dem Vokabular und
 * Satzbausteinen, deterministisch per Seed. Grundlage für das Feintuning eines eigenen Klassifizierungsmodells
 * (zusammen mit den echten Paaren aus dem Prompt-Log) und für Regressionstests des lokalen Klassifikators.
 */
import { Rng } from '@mcda/core';
import type { EngineRequest } from '../engine.js';
import type { Vocabulary } from '../vocabulary.js';

export interface DatasetRow {
  readonly prompt: string;
  readonly request: EngineRequest;
  readonly lang: 'de' | 'en';
}

type Words = Readonly<Record<string, readonly string[]>>;

const TYPE_WORDS: Readonly<Record<'de' | 'en', Words>> = {
  de: {
    hobbit: ['Hobbithöhle', 'Hobbithaus', 'Erdhaus im Hügel'], tavern: ['Taverne', 'Gasthaus', 'Wirtshaus'],
    castle_compact: ['Burg', 'Festung', 'Ritterburg'], watchtower: ['Wachturm', 'Aussichtsturm'],
    farmhouse: ['Bauernhof', 'Bauernhaus', 'Gehöft'], longhouse: ['Langhaus', 'Wikingerhaus'],
    townhouse: ['Stadthaus', 'Bürgerhaus'], townhouse_row: ['Reihenhäuser', 'Häuserzeile'],
    timber: ['Fachwerkhaus'], hall: ['Halle'], twostory: ['zweistöckiges Haus'], house: ['Haus', 'Hütte', 'Wohnhaus'],
  },
  en: {
    hobbit: ['hobbit hole', 'hobbit house'], tavern: ['tavern', 'inn', 'pub'], castle_compact: ['castle', 'fortress', 'keep'],
    watchtower: ['watchtower', 'lookout tower'], farmhouse: ['farmhouse', 'farm'], longhouse: ['longhouse', 'viking longhouse'],
    townhouse: ['townhouse'], townhouse_row: ['row houses'], timber: ['timber frame house'], hall: ['hall'],
    twostory: ['two story house'], house: ['house', 'cottage', 'hut'],
  },
};
const SIZE: Readonly<Record<'de' | 'en', Record<'S' | 'M' | 'L', readonly string[]>>> = {
  de: { S: ['kleine', 'winzige'], M: ['mittelgroße'], L: ['große', 'riesige'] },
  en: { S: ['small', 'tiny'], M: ['medium'], L: ['large', 'huge'] },
};
const THEME: Readonly<Record<'de' | 'en', Words>> = {
  de: { nordic: ['nordische', 'Wikinger-'], medieval: ['mittelalterliche'], rustic: ['rustikale'] },
  en: { nordic: ['nordic', 'viking'], medieval: ['medieval'], rustic: ['rustic'] },
};
/** Theme-Wörter, die mit dem Bautyp-Wort den Bautyp selbst benennen („Wikinger-Langhaus“, „viking longhouse“) – dort kein Theme. */
const TYPE_BOUND_THEME_WORDS: Readonly<Record<string, readonly string[]>> = { longhouse: ['Wikinger-', 'viking'] };
const ROOF: Readonly<Record<'de' | 'en', Words>> = {
  de: { flat: ['mit Flachdach'], hip: ['mit Walmdach'], gable: ['mit Satteldach'], shed: ['mit Pultdach'], mansard: ['mit Mansarddach'] },
  en: { flat: ['with a flat roof'], hip: ['with a hip roof'], gable: ['with a gable roof'], shed: ['with a shed roof'], mansard: ['with a mansard roof'] },
};
const DIR: Readonly<Record<'de' | 'en', Words>> = {
  de: { north: ['Eingang nach Norden'], east: ['Eingang nach Osten'], south: ['Eingang nach Süden'], west: ['Eingang nach Westen'] },
  en: { north: ['entrance facing north'], east: ['entrance facing east'], south: ['entrance facing south'], west: ['entrance facing west'] },
};
const FLOORS: Readonly<Record<'de' | 'en', readonly string[]>> = { de: ['', 'einer Etage', 'zwei Etagen', 'drei Etagen'], en: ['', 'one floor', 'two floors', 'three floors'] };
const OPENERS: Readonly<Record<'de' | 'en', readonly string[]>> = {
  de: ['Bau mir eine', 'Ich hätte gern eine', 'Erstelle eine', 'Generiere eine', 'Eine'],
  en: ['Build me a', 'I want a', 'Generate a', 'Create a', 'A'],
};

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(0, xs.length - 1)]!;

export function syntheticDataset(vocab: Vocabulary, n: number, seed = 1): DatasetRow[] {
  const rng = new Rng(seed);
  const types = vocab.buildingTypes.filter((b) => !b.draft);
  const themes = new Set(vocab.themes.map((t) => t.id));
  const rows: DatasetRow[] = [];
  while (rows.length < n) {
    const lang = rng.chance(0.6) ? 'de' as const : 'en' as const;
    const type = pick(rng, types);
    const typeWords = TYPE_WORDS[lang][type.id];
    if (typeWords === undefined) continue;
    const input: Record<string, unknown> = { buildingTypeId: type.id };
    const parts: string[] = [pick(rng, OPENERS[lang])];
    if (type.sizes.length > 1 && rng.chance(0.6)) {
      const s = pick(rng, type.sizes);
      input['size'] = s;
      parts.push(pick(rng, SIZE[lang][s]));
    }
    const themeIds = Object.keys(THEME[lang]).filter((t) => themes.has(t));
    if (rng.chance(0.5) && themeIds.length > 0) {
      const t = pick(rng, themeIds);
      const bound = TYPE_BOUND_THEME_WORDS[type.id] ?? [];
      const words = THEME[lang][t]!.filter((w) => !bound.includes(w));
      input['themeId'] = t;
      parts.push(pick(rng, words.length > 0 ? words : THEME[lang][t]!));
    }
    parts.push(pick(rng, typeWords));
    const extras: string[] = [];
    if (rng.chance(0.25)) {
      const f = rng.int(1, 3);
      input['floors'] = f;
      extras.push(`${lang === 'de' ? 'mit' : 'with'} ${FLOORS[lang][f]}`);
    }
    if (rng.chance(0.3)) {
      const r = pick(rng, Object.keys(ROOF[lang]));
      input['shell'] = { roof: r };
      extras.push(pick(rng, ROOF[lang][r]!));
    }
    if (rng.chance(0.3)) {
      const d = pick(rng, Object.keys(DIR[lang]));
      input['front'] = d;
      extras.push(pick(rng, DIR[lang][d]!));
    }
    if (rng.chance(0.15)) {
      input['surroundings'] = false;
      extras.push(lang === 'de' ? 'ohne Garten' : 'without garden');
    }
    const prompt = [parts.join(' ').replace(/- /g, '-'), extras.join(', ')].filter((x) => x !== '').join(', ');
    rows.push({ prompt, request: { op: 'building_generate', input }, lang });
  }
  return rows;
}
