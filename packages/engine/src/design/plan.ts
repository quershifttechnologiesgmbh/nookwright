/**
 * F-JEV-iterativ, Planer (`plan/spikes/F_jev_iterativ.md`): eine Bitte wird in zwei Runden zu einem Ensemble-Plan –
 * Hauptgebäude (Felder von `building_generate`) plus Teile (Mauer, freistehende Türme, Windmühle, Silo, Brücken) und
 * weitere Nutzungen (Raumtypen). Jede Frage hat eine lokale, deterministische Antwort (Schlüsselwörter), damit dieselbe
 * Schleife ohne Modell läuft. Rein und deterministisch; das Modell fragt `loop.ts` über einen Port.
 */
import type { MoodAxis, MoodVector } from '@mcda/core';
import type { TowerTop } from '@mcda/structures';
import type { DecisionAnswer, DecisionQuestion } from '../intent/decisions.js';
import { NOT_SPECIFIED } from '../intent/decisions.js';
import { classifyRoomTypeLocal } from '../intent/roomtype.js';
import { classifyLocal, normalize, withoutNegated } from '../intent/local.js';
import type { Vocabulary } from '../vocabulary.js';

/** Achsen der Stimmung (wie `@mcda/core` `MOOD_AXES`; hier als Liste, damit der Planer ohne Laufzeit-Import auskommt). */
export const DESIGN_MOOD_AXES: readonly MoodAxis[] = ['wear', 'richness', 'formality', 'organic'];
/** Pole je Achse (−1, +1), wie `MOOD_POLES`. */
export const POLES: Readonly<Record<MoodAxis, readonly [string, string]>> = {
  wear: ['ordentlich, gepflegt', 'verwittert, verfallen'],
  richness: ['karg, schlicht', 'üppig, prächtig'],
  formality: ['gemütlich, heimelig', 'repräsentativ, edel'],
  organic: ['symmetrisch, geordnet', 'organisch, verwinkelt'],
};

export type WallProfile = 'fortress' | 'garden';
export const TOWER_TOPS: readonly TowerTop[] = ['battlements', 'roof', 'lookout', 'belfry'];

/** Nebenteile des Ensembles (vorhandene Bauwerke der Engine). */
export interface DesignParts {
  readonly wall?: WallProfile;
  /** Freistehende Türme neben dem Hauptgebäude (0–3). */
  readonly towers: number;
  readonly towerTop?: TowerTop;
  /** Geschosse der Türme (klein 2, mittel 3, hoch 5). */
  readonly towerLevels?: number;
  readonly windmill: boolean;
  readonly silo: boolean;
  /** Brücken aus Obergeschossen zum Wehrgang bzw. Nachbarbau (F-Ensemble). */
  readonly bridge: boolean;
  /** Abstandszuschlag für die Nebenteile (Kritiker: Teil fehlt trotz Plan → weiter weg). */
  readonly shift: number;
}

/** Ensemble-Plan: Hauptgebäude (Eingabe von `building_generate`), Teile, weitere Nutzungen. */
export interface DesignPlan {
  readonly base: Readonly<Record<string, unknown>>;
  readonly parts: DesignParts;
  /** Weitere Nutzungen als Raumtyp-IDs, in Reihenfolge der Nennung. */
  readonly rooms: readonly string[];
  /** Felder, die die Bitte nennt (aus Planer-Antworten), für die Anforderungen des Kritikers. */
  readonly asked: readonly string[];
}

export const NO_PARTS: DesignParts = { towers: 0, windmill: false, silo: false, bridge: false, shift: 0 };

/** Vorspann jeder Planer-Frage. */
const CONTEXT = 'Die Bitte beschreibt eine Minecraft-Anlage: ein Hauptgebäude, eventuell mit weiteren Bauwerken und Räumen. ';

const has = (text: string, words: readonly string[]): boolean =>
  words.some((w) => text.includes(` ${w} `) || (w.length >= 5 && text.includes(` ${w}`)));
/** Frühester Treffer eines Worts (Position im normalisierten Text) oder -1. */
const firstAt = (text: string, words: readonly string[]): number => {
  let best = -1;
  for (const w of words) {
    const i = text.indexOf(` ${w}`);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
};

const WALL = ['mauer', 'mauern', 'ringmauer', 'stadtmauer', 'burgmauer', 'wehrmauer', 'palisade', 'umfriedung', 'befestigt', 'befestigung',
  'wall', 'walls', 'walled', 'curtain wall', 'rampart', 'fortified'];
const GARDEN_WALL = ['gartenmauer', 'garden wall', 'hecke', 'hedge', 'zaun', 'fence'];
const TOWER = ['wachturm', 'wachtuerme', 'turm', 'tuerme', 'tower', 'towers', 'watchtower', 'aussichtsturm', 'glockenturm', 'bell tower', 'lookout'];
const WINDMILL = ['windmuehle', 'windmill', 'muehle', 'mill'];
const SILO = ['silo', 'silos', 'kornspeicher', 'getreidesilo', 'grain silo'];
const BRIDGE = ['bruecke', 'bruecken', 'bridge', 'bridges', 'steg', 'uebergang', 'wehrgang', 'walkway', 'skywalk', 'verbunden', 'connected'];
const COUNT: ReadonlyArray<readonly [RegExp, number]> = [
  [/ (?:zwei|2|two|beiden|both|pair of|paar) (?:[a-z]+ )?(?:wachtuerme|tuerme|towers|watchtowers)/, 2],
  [/ (?:drei|3|three|vier|4|four) (?:[a-z]+ )?(?:wachtuerme|tuerme|towers|watchtowers)/, 3],
];
const MOOD_WORDS: Readonly<Record<MoodAxis, readonly [readonly string[], readonly string[]]>> = {
  wear: [['gepflegt', 'ordentlich', 'sauber', 'neu', 'neues', 'neue', 'tidy', 'pristine', 'clean', 'new', 'well kept'],
    ['verwittert', 'verfallen', 'verfallene', 'verfallenes', 'ruine', 'moosbewachsen', 'bemoost', 'ueberwuchert', 'alt', 'alte', 'altes', 'baufaellig',
      'verlassen', 'verlassene', 'verlassenes', 'weathered', 'ruined', 'abandoned', 'overgrown', 'mossy', 'old', 'crumbling', 'derelict']],
  richness: [['karg', 'schlicht', 'schlichte', 'schlichtes', 'einfach', 'einfache', 'einfaches', 'spartanisch', 'bescheiden', 'minimal', 'plain', 'simple', 'bare', 'humble', 'modest'],
    ['ueppig', 'prunkvoll', 'praechtig', 'prachtvoll', 'reich', 'reiche', 'luxurioes', 'opulent', 'verziert', 'lavish', 'rich', 'luxurious', 'ornate', 'grand', 'opulent']],
  formality: [['gemuetlich', 'gemuetliche', 'gemuetliches', 'heimelig', 'behaglich', 'urig', 'kuschelig', 'cozy', 'cosy', 'homely', 'snug'],
    ['repraesentativ', 'edel', 'edle', 'nobel', 'noble', 'majestaetisch', 'herrschaftlich', 'imposant', 'majestic', 'stately', 'imposing', 'elegant', 'formal']],
  organic: [['symmetrisch', 'symmetrische', 'streng', 'geordnet', 'symmetric', 'symmetrical', 'orderly', 'regular'],
    ['organisch', 'verwinkelt', 'chaotisch', 'wild', 'natuerlich', 'organic', 'messy', 'rambling', 'irregular', 'crooked']],
};
/** Bautyp-Wörter, die als Nebenteil gelten, wenn sie nicht das Hauptgebäude sind. */
const TYPE_AS_PART: Readonly<Record<string, { readonly room?: string; readonly tower?: true; readonly wall?: true; readonly silo?: true }>> = {
  watchtower: { tower: true },
  tavern: { room: 'tavern' },
  hall: { room: 'mead_hall' },
  longhouse: { room: 'mead_hall' },
  castle_compact: { wall: true },
};
/** Raumtypen, die der lokale Planer nicht als „weitere Nutzung“ nimmt (Teile oder zu allgemein). */
const ROOM_NOT_EXTRA: ReadonlySet<string> = new Set(['tower_room', 'wine_cellar', 'gallery', 'hallway', 'entrance_hall', 'storage', 'bedroom', 'kitchen', 'guest_room', 'solar']);
const MAX_ROOMS = 3;

/** Lokale Zerlegung einer Bitte (Schlüsselwörter, ohne Netz). */
export interface LocalDesign {
  readonly mainType?: string;
  readonly parts: DesignParts;
  readonly rooms: readonly string[];
  readonly mood: MoodVector;
}

/** Wörter je Bautyp (Katalog-ID, Name, Synonyme des lokalen Klassifikators über `classifyLocal` je Wort). */
function typePositions(text: string, vocab: Vocabulary): Array<{ id: string; at: number }> {
  const out: Array<{ id: string; at: number }> = [];
  const words = text.trim().split(' ');
  let pos = 1;
  for (const w of words) {
    const r = classifyLocal(w, vocab);
    if (r.confidence >= 0.8) {
      const id = (r.request.input as { buildingTypeId: string }).buildingTypeId;
      if (!out.some((o) => o.id === id)) out.push({ id, at: pos });
    }
    pos += w.length + 1;
  }
  return out;
}

export function localDesign(prompt: string, vocab: Vocabulary): LocalDesign {
  const text = withoutNegated(normalize(prompt));
  const types = typePositions(text, vocab);
  // Hauptgebäude: das zuerst genannte Bautyp-Wort (der lokale Klassifikator nimmt das längste – „Burg … Wachturm“ → Turm)
  const main = types[0]?.id;
  let towers = 0;
  let wall: WallProfile | undefined;
  let silo = has(text, SILO);
  const rooms: string[] = [];
  for (const t of types.slice(1)) {
    const p = TYPE_AS_PART[t.id];
    if (p?.tower === true) towers = Math.max(towers, 1);
    if (p?.wall === true) wall = 'fortress';
    if (p?.silo === true) silo = true;
    if (p?.room !== undefined && !rooms.includes(p.room)) rooms.push(p.room);
  }
  // Freistehender Turm: ein Turm-Wort, das nicht selbst das Hauptgebäude ist
  const towerAt = firstAt(text, TOWER);
  if (towerAt >= 0 && main !== 'watchtower') towers = Math.max(towers, 1);
  for (const [re, n] of COUNT) if (re.test(text)) towers = Math.max(towers, main === 'watchtower' ? n - 1 : n);
  // Gartenmauer-Wörter gehen vor („garden wall“ enthält „wall“), außer die Bitte nennt ausdrücklich eine Wehrmauer
  if (has(text, GARDEN_WALL) && !has(text, ['ringmauer', 'stadtmauer', 'burgmauer', 'wehrmauer', 'palisade', 'rampart', 'fortified', 'curtain wall'])) wall = 'garden';
  else if (has(text, WALL)) wall = 'fortress';
  // Weitere Nutzungen: Satzteile („mit Taverne, Schmiede und …“) einzeln dem Raumtyp-Klassifikator geben
  for (const chunk of prompt.split(/,|;|\bund\b|\band\b|\bmit\b|\bwith\b|\bsowie\b|\bplus\b/i)) {
    const g = classifyRoomTypeLocal(chunk, vocab);
    if (g.roomTypeId === null || g.confidence < 1 || ROOM_NOT_EXTRA.has(g.roomTypeId) || rooms.includes(g.roomTypeId)) continue;
    // Das Bautyp-Wort des Hauptgebäudes nennt keine weitere Nutzung („Taverne“ als Bautyp → Schankraum ist ohnehin da)
    if (main !== undefined && TYPE_AS_PART[main]?.room === g.roomTypeId) continue;
    rooms.push(g.roomTypeId);
  }
  const mood: Record<string, number> = {};
  for (const axis of DESIGN_MOOD_AXES) {
    const [neg, pos] = MOOD_WORDS[axis];
    const n = has(text, neg);
    const p = has(text, pos);
    if (n !== p) mood[axis] = p ? 1 : -1;
  }
  return {
    ...(main !== undefined ? { mainType: main } : {}),
    parts: { ...NO_PARTS, ...(wall !== undefined ? { wall } : {}), towers: Math.min(3, towers), windmill: has(text, WINDMILL), silo, bridge: has(text, BRIDGE) },
    rooms: rooms.slice(0, MAX_ROOMS),
    mood,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Runde 1: Zerlegung

type Q = Record<string, DecisionQuestion>;
type A = Record<string, DecisionAnswer>;
const yes = (p: boolean): DecisionAnswer => ({ type: 'noul', noul: p ? 0.9 : 0.1 });
const pick = (id: string): DecisionAnswer => ({ type: 'choice', choice: id, confidence: 0.9, probabilities: { [id]: 0.9 } });
const level = (i: number): DecisionAnswer => ({ type: 'score', score: i, confidence: 0.9, probabilities: { [String(i)]: 0.9 } });

/** Fragen der ersten Runde (Schlüssel `design.*`), dazu die lokalen Antworten. */
export function round1(vocab: Vocabulary, local: LocalDesign): { questions: Q; local: A } {
  const types = vocab.buildingTypes.filter((b) => !b.draft);
  const noul = (what: string): DecisionQuestion => ({
    type: 'noul', instructions: `${CONTEXT}Verlangt die Bitte ${what}?`,
    criteria: { true: 'Ja, die Bitte nennt das ausdrücklich oder eindeutig.', false: 'Nein, die Bitte sagt dazu nichts oder will es nicht.' },
  });
  const questions: Q = {
    'design.main': {
      type: 'choice',
      instructions: `${CONTEXT}Welche Gebäudeart ist das HAUPTgebäude (meist das zuerst genannte oder größte)? Weitere genannte Bauten (Wachturm, Mühle, Mauer, Taverne im Burghof) sind Nebenteile und zählen hier nicht. Nennt die Bitte keine Gebäudeart: ${NOT_SPECIFIED}.`,
      criteria: {
        ...Object.fromEntries(types.map((t) => [t.id, `${t.name}${t.description !== undefined ? ` – ${t.description}` : ''}`])),
        [NOT_SPECIFIED]: 'Die Bitte nennt keine Gebäudeart.',
      },
    },
    'design.wall': noul('eine Mauer (Ringmauer, Stadtmauer, Burgmauer, Palisade oder Gartenmauer) um die Anlage'),
    'design.towers': {
      type: 'choice',
      instructions: `${CONTEXT}Wie viele freistehende Türme (Wachturm, Aussichtsturm, Glockenturm) NEBEN dem Hauptgebäude verlangt die Bitte? Ist der Turm selbst das Hauptgebäude, zählt er nicht.`,
      criteria: { 0: 'keinen', 1: 'einen', 2: 'zwei', 3: 'drei oder mehr' },
    },
    'design.windmill': noul('eine Windmühle'),
    'design.silo': noul('ein Silo bzw. einen Kornspeicher'),
    'design.bridge': noul('eine Brücke, einen Steg oder einen Übergang zwischen Gebäudeteilen, zur Mauer oder zu einem Turm'),
    'design.rooms': noul('weitere Räume oder Nutzungen zusätzlich zur Gebäudeart (z. B. Schmiede, Bibliothek, Stall, Taverne im Hof)'),
  };
  const mainLocal = local.mainType ?? NOT_SPECIFIED;
  return {
    questions,
    local: {
      'design.main': pick(mainLocal),
      'design.wall': yes(local.parts.wall !== undefined),
      'design.towers': pick(String(local.parts.towers)),
      'design.windmill': yes(local.parts.windmill),
      'design.silo': yes(local.parts.silo),
      'design.bridge': yes(local.parts.bridge),
      'design.rooms': yes(local.rooms.length > 0),
    },
  };
}

/** Erkenntnisse aus Runde 1 (für den `state` von Runde 2 und für den Plan). */
export interface Round1 {
  readonly mainType?: string;
  readonly parts: DesignParts;
  readonly wantsRooms: boolean;
}

const pYes = (a: DecisionAnswer | undefined): number => (a?.type === 'noul' && Number.isFinite(a.noul) ? a.noul : 0);
const chosen = (a: DecisionAnswer | undefined, min: number): string | undefined => {
  if (a?.type !== 'choice' || a.choice === NOT_SPECIFIED) return undefined;
  const c = a.confidence ?? a.probabilities?.[a.choice] ?? 0;
  return c >= min ? a.choice : undefined;
};

/**
 * Antworten von Runde 1 lesen. Lokale Treffer bleiben (wie `local-first` beim Einmal-Weg): das Modell ergänzt, was die
 * Schlüsselwörter nicht finden, und entscheidet das Hauptgebäude, wenn es sicher ist.
 */
export function readRound1(answers: Readonly<Record<string, DecisionAnswer | undefined>>, local: LocalDesign, min: number): Round1 {
  const towersModel = Number(chosen(answers['design.towers'], min) ?? 0);
  const wall = pYes(answers['design.wall']) >= min ? (local.parts.wall ?? 'fortress') : local.parts.wall;
  const mainType = chosen(answers['design.main'], min) ?? local.mainType;
  return {
    ...(mainType !== undefined ? { mainType } : {}),
    parts: {
      ...NO_PARTS,
      // Die Burg bringt ihre Ringmauer mit: die Umsetzung ergänzt keine zweite, die Anforderung prüft den Ring
      ...(wall !== undefined ? { wall } : {}),
      towers: Math.min(3, Math.max(towersModel, local.parts.towers)),
      windmill: local.parts.windmill || pYes(answers['design.windmill']) >= min,
      silo: local.parts.silo || pYes(answers['design.silo']) >= min,
      bridge: local.parts.bridge || pYes(answers['design.bridge']) >= min,
    },
    wantsRooms: local.rooms.length > 0 || pYes(answers['design.rooms']) >= min,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Runde 2: Details je erkanntem Teil (state enthält Runde 1)

const ORDINAL = ['erste', 'zweite', 'dritte'];
const MOOD_LEVELS = (axis: MoodAxis): string[] => {
  const [neg, pos] = POLES[axis];
  return [`deutlich ${neg}`, `etwas ${neg}`, 'neutral bzw. keine Angabe', `etwas ${pos}`, `deutlich ${pos}`];
};
export const MOOD_VALUES = [-1, -0.5, 0, 0.5, 1] as const;

export function round2(vocab: Vocabulary, r1: Round1, local: LocalDesign): { questions: Q; local: A } {
  const questions: Q = {};
  const answers: A = {};
  const typeName = vocab.buildingTypes.find((t) => t.id === r1.mainType)?.name;
  if (r1.wantsRooms) {
    const criteria = {
      ...Object.fromEntries(vocab.roomTypes.map((r) => [r.id, `${r.name}${r.description !== undefined ? ` – ${r.description}` : ''}`])),
      [NOT_SPECIFIED]: 'Die Bitte nennt keine weitere Nutzung an dieser Stelle.',
    };
    for (let i = 0; i < MAX_ROOMS; i++) {
      questions[`design.room${i + 1}`] = {
        type: 'choice',
        instructions: `${CONTEXT}Welche weitere Nutzung bzw. welchen Raum nennt die Bitte an ${ORDINAL[i]} Stelle (in Reihenfolge der Nennung)? `
          + `Die Gebäudeart selbst${typeName !== undefined ? ` (${typeName})` : ''} und Bauwerke wie Mauer, Turm oder Mühle zählen nicht. Gibt es keine ${ORDINAL[i]}: ${NOT_SPECIFIED}.`,
        criteria,
      };
      answers[`design.room${i + 1}`] = pick(local.rooms[i] ?? NOT_SPECIFIED);
    }
  }
  for (const axis of DESIGN_MOOD_AXES) {
    const [neg, pos] = POLES[axis];
    questions[`design.mood.${axis}`] = { type: 'score', instructions: `${CONTEXT}Wie soll die Anlage wirken, von „${neg}“ bis „${pos}“?`, criteria: MOOD_LEVELS(axis) };
    questions[`design.mood.${axis}#given`] = {
      type: 'noul', instructions: `${CONTEXT}Sagt die Bitte ausdrücklich, ob die Anlage ${neg} oder ${pos} wirken soll (auch mit ähnlichen Worten)?`,
      criteria: { true: 'Ja, die Bitte nennt eine solche Wirkung.', false: 'Nein, dazu sagt die Bitte nichts.' },
    };
    const v = local.mood[axis];
    answers[`design.mood.${axis}`] = level(v === undefined ? 2 : v > 0 ? 4 : 0);
    answers[`design.mood.${axis}#given`] = yes(v !== undefined);
  }
  if (r1.parts.wall !== undefined) {
    questions['design.wallProfile'] = {
      type: 'choice', instructions: `${CONTEXT}Welche Art Mauer verlangt die Bitte?`,
      criteria: { fortress: 'Wehrmauer mit Zinnen, Wehrgang und Toren (Burg, Festung, Stadt)', garden: 'niedrige Gartenmauer oder Hecke mit Pfeilern (Hof, Garten)' },
    };
    answers['design.wallProfile'] = pick(local.parts.wall ?? 'fortress');
  }
  if (r1.parts.towers > 0) {
    questions['design.towerTop'] = {
      type: 'choice', instructions: `${CONTEXT}Welchen Abschluss sollen die freistehenden Türme haben? Sagt die Bitte nichts: ${NOT_SPECIFIED}.`,
      criteria: { battlements: 'Zinnen (Wehrturm, Wachturm)', roof: 'spitzes Dach (Kegel- oder Zeltdach)', lookout: 'Aussichtsstube mit Brüstung', belfry: 'Glockenstube (Glockenturm)', [NOT_SPECIFIED]: 'keine Angabe' },
    };
    questions['design.towerHeight'] = { type: 'score', instructions: `${CONTEXT}Wie hoch sollen die freistehenden Türme sein?`, criteria: ['niedrig', 'mittel', 'hoch'] };
    answers['design.towerTop'] = pick(NOT_SPECIFIED);
    answers['design.towerHeight'] = level(1);
  }
  return { questions, local: answers };
}

/** Plan aus Einmal-Anfrage (Felder von `building_generate`), Runde 1 und Runde 2. */
export function readRound2(
  base: Readonly<Record<string, unknown>>, asked: readonly string[], r1: Round1, answers: Readonly<Record<string, DecisionAnswer | undefined>>,
  local: LocalDesign, vocab: Vocabulary, min: number,
): DesignPlan {
  const b: Record<string, unknown> = { ...base };
  const fields = new Set(asked);
  if (r1.mainType !== undefined && vocab.buildingTypes.some((t) => t.id === r1.mainType)) {
    if (b['buildingTypeId'] !== r1.mainType) {
      b['buildingTypeId'] = r1.mainType;
      // Größe/Etagen gehören zum Bautyp: passt die Größe nicht, fällt sie weg (Standard des Bautyps)
      const t = vocab.buildingTypes.find((x) => x.id === r1.mainType)!;
      if (typeof b['size'] === 'string' && !t.sizes.includes(b['size'] as 'S' | 'M' | 'L')) delete b['size'];
    }
    fields.add('buildingTypeId');
  }
  const rooms: string[] = [...local.rooms];
  for (let i = 0; i < MAX_ROOMS; i++) {
    const id = chosen(answers[`design.room${i + 1}`], min);
    if (id !== undefined && vocab.roomTypes.some((r) => r.id === id) && !rooms.includes(id)) rooms.push(id);
  }
  const mood: Record<string, number> = { ...((b['mood'] as Record<string, number> | undefined) ?? {}) };
  for (const axis of DESIGN_MOOD_AXES) {
    const a = answers[`design.mood.${axis}`];
    const gate = pYes(answers[`design.mood.${axis}#given`]);
    const localV = local.mood[axis];
    if (localV !== undefined) mood[axis] = localV;
    else if (a?.type === 'score' && gate >= min) {
      const v = MOOD_VALUES[Math.max(0, Math.min(4, Math.round(a.score)))]!;
      if (v !== 0) mood[axis] = v;
    }
  }
  // Einmal-Weg fragt die Achsen nur als −1/0/1; 0 heißt dort „neutral“ → weglassen
  for (const axis of DESIGN_MOOD_AXES) if (mood[axis] === 0) delete mood[axis];
  if (Object.keys(mood).length > 0) {
    b['mood'] = mood;
    fields.add('mood');
  } else delete b['mood'];
  const wallProfile = chosen(answers['design.wallProfile'], 0.5) as WallProfile | undefined;
  const top = chosen(answers['design.towerTop'], min) as TowerTop | undefined;
  const h = answers['design.towerHeight'];
  const parts: DesignParts = {
    ...r1.parts,
    ...(r1.parts.wall !== undefined ? { wall: local.parts.wall ?? wallProfile ?? r1.parts.wall } : {}),
    ...(top !== undefined && TOWER_TOPS.includes(top) ? { towerTop: top } : {}),
    ...(r1.parts.towers > 0 && h?.type === 'score' && (h.confidence ?? 1) >= 0.5 ? { towerLevels: [2, 3, 5][Math.max(0, Math.min(2, Math.round(h.score)))]! } : {}),
  };
  if (parts.bridge) b['ensemble'] = true;
  return { base: b, parts, rooms: rooms.slice(0, MAX_ROOMS), asked: [...fields].sort() };
}
