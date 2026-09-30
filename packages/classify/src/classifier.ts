import { DecisionError } from './transport.js';
import { MAX_CHOICES, type ChoiceAnswer, type DecisionProvider, type Question } from './types.js';

export interface LabelOption {
  readonly id: string;
  /** Beschreibung, die das Modell sieht (z. B. deutscher Name plus Stichworte). */
  readonly description?: string;
}

export interface Classification {
  readonly label: string;
  readonly confidence: number;
  /** Alle Optionen, nach Wahrscheinlichkeit absteigend. */
  readonly ranked: readonly { readonly label: string; readonly probability: number }[];
  readonly model: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly cost?: number };
}

const QUESTION_ID = 'label';
/** Zusatzoption je Teilfrage, wenn mehr als {@link MAX_CHOICES} Optionen aufgeteilt werden. */
export const NONE_OF_THESE = '__none__';

/**
 * Teilt eine Optionsliste in Stücke, die mit `reserved` Zusatzoptionen (z. B. „nicht angegeben“) unter die Grenze
 * {@link MAX_CHOICES} je `choice`-Frage passen. Eine Liste = keine Aufteilung.
 */
export function splitChoices<T>(items: readonly T[], max: number = MAX_CHOICES, reserved = 1): T[][] {
  const size = Math.max(1, max - reserved);
  const parts: T[][] = [];
  for (let i = 0; i < Math.max(1, items.length); i += size) parts.push(items.slice(i, i + size));
  return parts;
}

/**
 * Ein-Label-Klassifizierung über eine `choice`-Frage. Anbieter-unabhängig. Mehr als {@link MAX_CHOICES} Optionen:
 * mehrere Teilfragen (je mit „keine davon“) in EINER Anfrage; gewinnt die sicherste echte Wahl.
 */
export async function classify(
  provider: DecisionProvider,
  text: string | Readonly<Record<string, unknown>>,
  task: { readonly instructions: string; readonly options: readonly LabelOption[]; readonly maxChoices?: number },
  options: { readonly signal?: AbortSignal } = {},
): Promise<Classification> {
  if (task.options.length === 0) throw new Error('classify: keine Optionen');
  const ids = new Set<string>();
  for (const o of task.options) {
    if (ids.has(o.id)) throw new Error(`classify: Option "${o.id}" doppelt`);
    if (o.id === NONE_OF_THESE) throw new Error(`classify: Option-ID "${NONE_OF_THESE}" ist reserviert`);
    ids.add(o.id);
  }
  const max = task.maxChoices ?? MAX_CHOICES;
  const split = task.options.length > max;
  const parts = split ? splitChoices(task.options, max, 1) : [task.options];
  const questions: Record<string, Question> = {};
  parts.forEach((part, i) => {
    const criteria: Record<string, string | null> = Object.fromEntries(part.map((o) => [o.id, o.description ?? null]));
    if (split) criteria[NONE_OF_THESE] = 'Keine dieser Optionen passt.';
    questions[split ? `${QUESTION_ID}#${i + 1}` : QUESTION_ID] = { type: 'choice', instructions: task.instructions, criteria };
  });

  const res = await provider.decide({ state: text, questions }, options);
  let best: ChoiceAnswer | undefined;
  const probabilities: Record<string, number> = {};
  for (const key of Object.keys(questions)) {
    const a = res.answers[key];
    if (a === undefined) throw new DecisionError(`classify: ${provider.name} lieferte keine Antwort auf "${key}"`);
    if (a.type !== 'choice') throw new DecisionError(`classify: ${provider.name} lieferte ${a.type} statt choice`);
    if (a.choice !== NONE_OF_THESE && !ids.has(a.choice)) throw new DecisionError(`classify: ${provider.name} lieferte unbekannte Option "${a.choice}"`);
    for (const [id, p] of Object.entries(a.probabilities)) if (ids.has(id)) probabilities[id] = p;
    if (a.choice !== NONE_OF_THESE && (best === undefined || a.confidence > best.confidence)) best = a;
  }
  if (best === undefined) throw new DecisionError(`classify: ${provider.name} wählte in keiner Teilfrage eine Option`);

  const ranked = task.options
    .map((o) => ({ label: o.id, probability: probabilities[o.id] ?? 0 }))
    .sort((a, b) => b.probability - a.probability);
  return { label: best.choice, confidence: best.confidence, ranked, model: res.model, ...(res.usage !== undefined ? { usage: res.usage } : {}) };
}
