/**
 * `build_guide` (DR5 K2, DR1 Nr. 5): Bauplan zu einem Generier-Aufruf – Ebene für Ebene mit Palette und Zählung,
 * Materialliste mit Stapeln und Shulker-Kisten; als Markdown, CSV oder JSON. Führt die angegebene Generier-Operation
 * aus (gleiche Eingabe = gleicher Bau wie dort) und wertet ihr Export-Volumen mit `buildGuide` aus `@mcda/pipeline` aus –
 * dieselbe Funktion wie der Export „Bauplan“ der App. Schreibt keine Schematic.
 */
import { z } from 'zod';
import { OUTPUT_LICENSE_DRAFT, buildGuide, buildGuideCsv, buildGuideMarkdown } from '@mcda/pipeline';
import { defineOperation, enumOf, type Json, type OperationResult } from '../operation.js';
import type { Vocabulary } from '../vocabulary.js';
import { buildingGenerate, buildingGenerateInput } from './building.js';
import { projectGenerate } from './project.js';
import { roomsGenerate, roomsGenerateInput } from './rooms.js';

export type GuideSheet = 'markdown' | 'csv' | 'json';
export const GUIDE_SHEETS = enumOf<GuideSheet>()(['markdown', 'csv', 'json']);

const variant = <const O extends 'building_generate' | 'rooms_generate' | 'project_generate', S extends z.ZodType>(op: O, input: S, what: string) =>
  z.object({
    op: z.literal(op).describe(`Generier-Operation ${op}`),
    input: input.describe(`Eingabe wie ${op}`),
  }).strict().describe(what);

const sourceSchema = (v: Vocabulary) => z.discriminatedUnion('op', [
  variant('building_generate', buildingGenerateInput(v), 'Bau aus einem Bautyp'),
  variant('rooms_generate', roomsGenerateInput(v), 'Bau aus einer Raumliste'),
  variant('project_generate', projectGenerate.input(v), 'Offenes Projekt'),
]);

export const buildGuideInput = (v: Vocabulary) => z.object({
  source: sourceSchema(v).describe('Welcher Bau: Generier-Operation und ihre Eingabe (gleiche Eingabe = gleicher Bau wie dort)'),
  sheet: z.enum(GUIDE_SHEETS).default('markdown')
    .describe('Ausgabe: markdown = Anleitung zum Nachbauen (Maße, Materialliste, Ebenen), csv = Materialliste als Tabelle (Block, Anzahl, Stapel, Plätze, Shulker-Kisten), json = alles strukturiert'),
  grids: z.boolean().default(false)
    .describe('Raster je Ebene (Draufsicht, ein Zeichen je Block, Legende) mitliefern; nur bis 64 × 64 Grundfläche, sonst ausgelassen'),
}).strict();

type Input = z.output<ReturnType<typeof buildGuideInput>>;

export const buildGuideOp = defineOperation({
  id: 'build_guide',
  summary: 'Bauplan zum Nachbauen im Überlebensmodus: Materialliste mit Stapeln und Shulker-Kisten und Anleitung Ebene für Ebene '
    + '(Palette je Ebene, optional Raster), als Markdown, CSV oder JSON – zu einem Bau aus building_generate, rooms_generate oder project_generate.',
  input: buildGuideInput,
  // liest bei project_generate eine Session
  cacheable: false,
  run(input: Input, ctx, v, rt) {
    const s = input.source;
    const res: OperationResult = s.op === 'building_generate' ? buildingGenerate.run(s.input, ctx, v, rt)
      : s.op === 'rooms_generate' ? roomsGenerate.run(s.input, ctx, v, rt)
        : projectGenerate.run(s.input, ctx, v, rt);
    const volume = res.artifacts?.export;
    if (volume === undefined) throw new Error(`${s.op} lieferte kein Export-Volumen`);
    const guide = buildGuide(volume, { grids: input.grids });
    const head = {
      sheet: input.sheet, name: guide.name, size: [...guide.size], count: guide.count, layers: guide.layers.length,
      slots: guide.slots, shulkerBoxes: guide.shulkerBoxes, license: OUTPUT_LICENSE_DRAFT,
    };
    const data: Json = input.sheet === 'json'
      ? { ...head, guide: JSON.parse(JSON.stringify(guide)) as Json }
      : { ...head, text: input.sheet === 'csv' ? buildGuideCsv(guide) : buildGuideMarkdown(guide) };
    return { data };
  },
});
