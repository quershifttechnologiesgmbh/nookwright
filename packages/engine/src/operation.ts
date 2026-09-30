/**
 * Vertrag einer Engine-Operation (ADR 12). Jede Fähigkeit des Generators, die ein Nutzer auslösen kann, ist eine
 * Operation: stabile ID, Kurzbeschreibung für Menschen und Modelle, zod-Eingabe (→ JSON Schema), reine Ausführung.
 *
 * Die Eingabe wird aus dem Vokabular gebaut (`input(vocab)`): Katalog-IDs (Bautypen, Themes, Raumtypen) landen als
 * `enum` im Schema. Ein Modell kann damit nur gültige Werte wählen – die Steuerung ist eine Klassifizierung über
 * bekannte Labels, keine freie Texterzeugung.
 */
import type { z } from 'zod';
import type { BuildingTypeCatalog } from '@mcda/catalog';
import type { ExportVolume } from '@mcda/export';
import type { PipelineContext } from '@mcda/pipeline';
import type { SessionStore } from './session.js';
import type { Vocabulary } from './vocabulary.js';

/** Kontext der Engine: Anwendungsdienst-Kontext samt Bautypen (wie `NodeContext` der Pipeline). */
export type EngineContext = PipelineContext & { readonly buildingTypes: BuildingTypeCatalog };

/** JSON-Wert: alles, was eine Operation als Antwort zurückgibt, muss ohne Verlust serialisierbar sein. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json };

/** Ergebnis: JSON-Antwort plus optionale Artefakte, die Adapter weiterverarbeiten (Datei schreiben, Vorschau). */
export interface OperationResult {
  readonly data: Json;
  readonly artifacts?: {
    /** Fertiges Export-Volumen; der Adapter kodiert es als `.litematic`/`.schem`/`.nbt`. */
    readonly export?: ExportVolume;
  };
}

/** Operations-IDs: snake_case mit Kontext-Präfix – gültig als Funktionsname bei OpenAI/OpenRouter-Tool-Calls. */
export type OperationId = `${string}_${string}`;
export const OPERATION_ID = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

/** Laufzeit-Zustand der Engine, den zustandsbehaftete Operationen brauchen (Projekt-Sessions). */
export interface Runtime {
  readonly sessions: SessionStore;
}

export interface Operation<S extends z.ZodType = z.ZodType> {
  readonly id: OperationId;
  /** Ein bis zwei Sätze: wofür, wann wählen. Geht wörtlich an das Modell (Tool-Beschreibung). */
  readonly summary: string;
  readonly input: (vocab: Vocabulary) => S;
  /**
   * Pflichtangabe: Ergebnis hängt nur von der Eingabe ab (→ Cache erlaubt). `false` für alles, was Sessions liest
   * oder ändert. Deterministisch sind alle Operationen – bei Sessions über die Befehlsfolge.
   */
  readonly cacheable: boolean;
  readonly run: (input: z.output<S>, ctx: EngineContext, vocab: Vocabulary, rt: Runtime) => OperationResult;
}

/** Hilfsfunktion mit Typ-Inferenz für die Eingabe. */
export const defineOperation = <S extends z.ZodType>(op: Operation<S>): Operation<S> => op;

/**
 * Erschöpfende Aufzählung eines Domänen-Unions (Compile-Zeit-Zwang). Bekommt die Domäne einen neuen Wert
 * (z. B. eine neue Dachform), schlägt `tsc` hier fehl, bis die API ihn kennt:
 *
 *   const ROOF_STYLES = enumOf<RoofStyle>()(['flat', 'hip', …]);   // fehlt 'dome' → Typfehler { missing: 'dome' }
 */
export const enumOf = <T extends string>() =>
  <const A extends readonly [T, ...T[]]>(values: A & ([T] extends [A[number]] ? unknown : { readonly missing: Exclude<T, A[number]> })): A =>
    values;

/**
 * Feld-Abdeckung eines Domänen-Typs (Compile-Zeit-Zwang). `Uncovered<Domain, Api, Internal>` muss `never` sein:
 * Jedes Feld der Domäne ist entweder in der API-Eingabe oder bewusst als intern/später markiert. Neue Parameter
 * in der Domäne brechen damit den Typecheck, bis sie in die API aufgenommen oder begründet ausgenommen sind.
 */
export type Uncovered<Domain, Api, Internal extends PropertyKey = never> = Exclude<keyof Domain, keyof Api | Internal>;
/** `const _: AssertCovered<Uncovered<…>> = true;` – Typfehler nennt die fehlenden Felder. */
export type AssertCovered<Missing> = [Missing] extends [never] ? true : { readonly uncovered: Missing };
