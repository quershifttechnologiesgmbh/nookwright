// Anbieter-neutrale Typen für Entscheidungsmodelle im Stil von System One (TypeSafe Jev, Kev, OpenJev).
// Man schickt einen Zustand (Text) und typisierte Fragen und bekommt Wahrscheinlichkeiten zurück.

/** Ja/Nein-Frage. Antwort: Wahrscheinlichkeit für „ja“. */
export interface NoulQuestion {
  readonly type: 'noul';
  readonly instructions: string;
  /** Optionale Beschreibungen, was „ja“ bzw. „nein“ bedeutet. */
  readonly criteria?: { readonly true?: string; readonly false?: string };
}

/** Eine Option aus einer festen Liste. Schlüssel = Optionsname, Wert = Beschreibung oder `null`. */
export interface ChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string | null>>;
}

/** Eine Stufe auf einer geordneten Skala (niedrigste zuerst). */
export interface ScoreQuestion {
  readonly type: 'score';
  readonly instructions: string;
  readonly criteria: readonly string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** Höchstzahl Optionen je `choice`-Frage bei Jev (Live-Befund 2026-09-24: „Must have at most 255 choices“). */
export const MAX_CHOICES = 255;

export interface DecisionRequest {
  /** Der zu bewertende Inhalt: Text oder JSON-Objekt mit zusammengehörigem Kontext (laut API-Referenz beides erlaubt). */
  readonly state: string | Readonly<Record<string, unknown>>;
  /** Fragen nach frei gewählter ID; das Modell sieht die ID nicht. */
  readonly questions: Readonly<Record<string, Question>>;
}

export interface NoulAnswer {
  readonly type: 'noul';
  /** Wahrscheinlichkeit für „ja“ (0..1). */
  readonly noul: number;
}

export interface ChoiceAnswer {
  readonly type: 'choice';
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ScoreAnswer {
  readonly type: 'score';
  /** Mittlerer Stufenindex, ab 0. */
  readonly score: number;
  readonly confidence: number;
  /** Wahrscheinlichkeit je Stufenindex ("0", "1", …). */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly legend: Readonly<Record<string, string>>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecisionResponse {
  readonly model: string;
  readonly answers: Readonly<Record<string, Answer>>;
  /** `cost` in US-Dollar, falls der Anbieter sie meldet (OpenRouter). */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly cost?: number };
  readonly latencyMs?: number;
}

/** Port: jeder Anbieter (Jev über OpenRouter, TypeSafe direkt, lokales Kev …) implementiert nur das. */
export interface DecisionProvider {
  readonly name: string;
  decide(request: DecisionRequest, options?: { readonly signal?: AbortSignal }): Promise<DecisionResponse>;
}
