/**
 * `design_iterate` (F-JEV-iterativ, `plan/spikes/F_jev_iterativ.md`): Bitte → Ensemble-Plan (Hauptgebäude, Mauer,
 * Türme, Windmühle, Silo, Brücken, weitere Nutzungen, Stimmung) → Welt über vorhandene Operationen → Kritik →
 * Änderung → neu, bis die Punktzahl nicht mehr steigt. Rein ausgeführt antworten Planer und Kritiker lokal
 * (Schlüsselwörter, Zählen im Zusammenfasser) – deterministisch und cachebar. Der HTTP-Server fragt mit
 * eingeschaltetem Schalter `ENGINE_NL_ITERATE` und konfiguriertem System-One-Modell (JEV) das Modell
 * (`src/node/design.ts`) und fällt je Runde auf diese lokalen Antworten zurück; die Antwort hat dieselbe Form.
 */
import { z } from 'zod';
import { createEngine, type Engine } from '../engine.js';
import { decisionPlan, type DecisionPlan } from '../intent/decisions.js';
import { defineOperation, type EngineContext } from '../operation.js';
import { EXPORT_FORMATS, VERSIONS } from '../vocabulary.js';
import { DEFAULT_MAX_ROUNDS, designLoop, designResult, runDesignLocal } from '../design/loop.js';
import { CRITIC_MODES } from '../design/measuredCritic.js';

export const DESIGN_ITERATE = 'design_iterate';

export const designIterateInput = () => z.object({
  prompt: z.string().trim().min(1).max(2000).describe('Bitte in Deutsch oder Englisch, z. B. „Burg auf dem Hügel mit Taverne, Schmiede und Mauer, Brücke zum Wachturm“'),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(1).describe('Zufalls-Seed; gleicher Seed = gleiches Ergebnis'),
  maxRounds: z.number().int().min(1).max(8).default(DEFAULT_MAX_ROUNDS).describe('Höchstzahl Kritiker-Runden (je Runde eine Generierung)'),
  candidates: z.number().int().min(1).max(4).default(1).describe('Kandidaten (Seeds) der besten Fassung, aus denen der Kritiker wählt; 1 = keine Wahl'),
  targetVersion: z.enum(VERSIONS).optional().describe('Minecraft-Java-Zielversion'),
  format: z.enum(EXPORT_FORMATS).default('litematic').describe('Exportformat der Datei: litematic = Litematica, schem = Schematic (WorldEdit, .schem), nbt = Strukturblock (NBT)'),
  critic: z.enum(CRITIC_MODES).optional().describe(
    'Kritiker (Feature-Schalter, Standard aus): requirements = nur der Anforderungs-Kritiker (wie ohne Angabe); measured = danach bis zu '
    + 'maxRounds gemessene Runden – je Runde genau ein verletzter Prüfwert des Hauptgebäudes (Etagen, Höhe zu Breite, Dach zu Traufe, '
    + 'Fokus über Hauptbau, Baukörperzahl, Seitenverhältnis, Frontbreite) nach fester Rangfolge, behoben über eine vorhandene Stellgröße '
    + '(Dachneigung, Etagen, Silhouette, neue Variante), neu gemessen und zurückgesetzt, wenn der Gesamtwert nicht steigt, eine harte '
    + 'Regel (Erreichbarkeit, Treppen) bricht oder eine Anforderung der Bitte verloren geht; von der Bitte genannte Felder bleiben. '
    + 'Antwort mit quality (vorher/nachher) und den Runden im Protokoll. Ohne Angabe wie bisher'),
}).strict();

export type DesignIterateInput = z.output<ReturnType<typeof designIterateInput>>;

const engines = new WeakMap<EngineContext, { engine: Engine; plan: DecisionPlan }>();
/** Engine für die Schritte der Schleife (eine je Kontext) und die Einmal-Fragen aus dem Schema von `building_generate`. */
export function designEngineOf(ctx: EngineContext): { engine: Engine; plan: DecisionPlan } {
  let e = engines.get(ctx);
  if (e === undefined) {
    const engine = createEngine(ctx);
    e = { engine, plan: decisionPlan(engine.inputSchema('building_generate'), engine.vocabulary) };
    engines.set(ctx, e);
  }
  return e;
}

export const designIterate = defineOperation({
  id: DESIGN_ITERATE,
  summary:
    'Plant aus einer Bitte eine Anlage aus mehreren Teilen (Hauptgebäude, Mauer, Türme, Windmühle, Silo, Brücken, weitere Räume, Stimmung), '
    + 'erzeugt sie, bewertet sie gegen die Bitte und verbessert sie in Runden. Für Bitten mit mehreren Bauten oder Anforderungen.',
  input: designIterateInput,
  cacheable: true,
  run(i: DesignIterateInput, ctx) {
    const { engine, plan } = designEngineOf(ctx);
    const gen = designLoop(engine, plan, {
      prompt: i.prompt, seed: i.seed, format: i.format, ...(i.targetVersion !== undefined ? { targetVersion: i.targetVersion } : {}),
      ...(i.critic !== undefined ? { critic: i.critic } : {}),
    }, { maxRounds: i.maxRounds, candidates: i.candidates });
    return designResult(runDesignLocal(gen), 'local');
  },
});
