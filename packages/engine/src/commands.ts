/**
 * Befehlstabellen der Aggregate (ADR 12, DDD): Jede Befehlsmethode eines Aggregats – eine öffentliche Methode, die
 * Domain Events liefert – MUSS in der Tabelle stehen: als API-Befehl mit Schema oder begründet ausgeschlossen.
 *
 *   export const PROJECT_COMMANDS: CommandTable<Project, ProjectEvent, CommandEnv> = { paintRoom: {...}, ... };
 *
 * `CommandTable` ist ein Mapped Type über die Methoden des Aggregats. Bekommt `Project` eine neue Befehlsmethode
 * (z. B. `mirrorRoom(...)`: ProjectEvent[]), fehlt ihr Schlüssel in der Tabelle → `tsc` schlägt fehl. Unbekannte
 * Schlüssel sind ebenso ein Fehler (Objekt-Literal). Damit ist das Domänenmodell selbst der Vertrag der API.
 */
import { z } from 'zod';
import type { EngineContext } from './operation.js';
import type { ProjectSession } from './session.js';
import type { Vocabulary } from './vocabulary.js';

/** Schlüssel aller Befehlsmethoden von `A`: Methoden, deren Ergebnis ein Array von Events `E` ist. */
export type CommandKeys<A, E> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof A]-?: A[K] extends (...args: any[]) => readonly E[] ? K : never;
}[keyof A];

/** Umgebung eines Befehls: Kontext, Vokabular und die Session (für Befehle, die das Haus kennen müssen). */
export interface CommandEnv {
  readonly ctx: EngineContext;
  readonly vocab: Vocabulary;
  readonly session: ProjectSession;
}

export interface CommandSpec<A> {
  /** Ein Satz für Menschen und Modelle. */
  readonly summary: string;
  /** Felder des Befehls (ohne `command`); jedes mit `.describe()`. */
  readonly input: (v: Vocabulary) => z.ZodObject;
  /** Führt den Befehl am Aggregat aus (Invarianten prüft das Aggregat, Fehler werden zu API-Fehlern). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly apply: (agg: A, input: any, env: CommandEnv) => unknown;
}

/** Bewusst nicht als Befehl angeboten – Begründung Pflicht (und welche Operation es stattdessen abdeckt). */
export interface Excluded {
  readonly excluded: string;
}

export type CommandTable<A, E> = { readonly [K in CommandKeys<A, E>]: CommandSpec<A> | Excluded };

export const excluded = (why: string): Excluded => ({ excluded: why });
export const isCommand = <A>(e: CommandSpec<A> | Excluded): e is CommandSpec<A> => !('excluded' in e);

/** Hilfsfunktion mit Inferenz für die Eingabe eines Befehls. */
export const command = <A, S extends z.ZodObject>(spec: {
  readonly summary: string;
  readonly input: (v: Vocabulary) => S;
  readonly apply: (agg: A, input: z.output<S>, env: CommandEnv) => unknown;
}): CommandSpec<A> => spec as CommandSpec<A>;

/** Schema `{ command: '<name>', ...felder }` als Union über alle angebotenen Befehle. */
export function commandSchema<A, E>(table: CommandTable<A, E>, v: Vocabulary): z.ZodType {
  const variants = Object.entries(table as Record<string, CommandSpec<A> | Excluded>)
    .filter((e): e is [string, CommandSpec<A>] => isCommand(e[1]))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, spec]) => spec.input(v).extend({ command: z.literal(name) }).strict().describe(spec.summary));
  return variants.length === 1 ? variants[0]! : z.discriminatedUnion('command', variants as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]);
}

/** Befehl aus der Tabelle holen und ausführen (Eingabe ist bereits durch `commandSchema` geprüft). */
export function runCommand<A, E>(table: CommandTable<A, E>, agg: A, input: { command: string } & Record<string, unknown>, env: CommandEnv): unknown {
  const spec = (table as Record<string, CommandSpec<A> | Excluded>)[input.command];
  if (spec === undefined || !isCommand(spec)) throw new Error(`Befehl '${input.command}' wird nicht angeboten`);
  const { command: _, ...rest } = input;
  return spec.apply(agg, rest, env);
}
