/**
 * `palette_suggest` (W13-G): Blockpalette vor dem Generieren – je Rollengruppe die gültigen Familien der Zielversion mit
 * Vorschaufarbe und Harmonie gegen die übrigen Gruppen, dazu auf Wunsch ein neu gewürfelter Vorschlag (gesperrte Gruppen
 * bleiben). Dieselbe Regel wie die App (`paletteEditorView`, `rollPaletteOverrides` aus `@mcda/pipeline`). Das Ergebnis
 * geht als `paletteOverrides` an `building_generate` bzw. den Befehl `setPaletteOverrides`.
 */
import { z } from 'zod';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import type { PaletteOverrides } from '@mcda/core';
import { paletteFamilyLabel } from '@mcda/catalog';
import { paletteEditorView, paletteOverrideProblems, rollPaletteOverrides, swapTargets, type PaletteSwatch } from '@mcda/pipeline';
import { defineOperation } from '../operation.js';
import { PALETTE_GROUP_IDS, paletteOverridesOf, paletteOverridesSchema } from '../style.js';
import { VERSIONS, idsOf } from '../vocabulary.js';

const Int = z.number().int();
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const sw = (s: PaletteSwatch | undefined) => (s === undefined ? undefined : { family: s.family, name: paletteFamilyLabel(s.family), block: s.block, color: hex(s.color) });

/** Überschreibungen in der Form des API-Felds `paletteOverrides` (flach, JSON). */
function overridesJson(o: PaletteOverrides | undefined): Record<string, string | Array<{ from: string; to: string }>> {
  const out: Record<string, string | Array<{ from: string; to: string }>> = {};
  for (const g of PALETTE_GROUP_IDS) {
    const f = o?.groups?.[g];
    if (f !== undefined) out[g] = f;
  }
  if (o?.swaps !== undefined) out['swaps'] = o.swaps.map((x) => ({ from: x.from, to: x.to }));
  if (o?.colorHarmony === 'on') out['colorHarmony'] = 'on';
  if (o?.harmonyContrast !== undefined) out['harmonyContrast'] = o.harmonyContrast;
  if (o?.harmonySaturation !== undefined) out['harmonySaturation'] = o.harmonySaturation;
  return out;
}

export const paletteSuggest = defineOperation({
  id: 'palette_suggest',
  summary:
    'Blockpalette vor dem Generieren anpassen: listet je Gruppe (Wand, Rahmen, Dach, Sockel, Boden, Akzent, Innenholz) die '
    + 'gültigen Materialfamilien der Zielversion mit Farbe und ob sie zu den anderen Gruppen passen (Dach dunkler als Wand …); '
    + 'mit roll einen neu gewürfelten, harmonischen Vorschlag (lock hält Gruppen fest). Ergebnis als paletteOverrides an '
    + 'building_generate oder setPaletteOverrides geben.',
  input: (v) => z.object({
    themeId: z.enum(idsOf(v.themes)).describe('Material-Theme'),
    paletteId: z.enum(idsOf(v.palettes)).optional().describe('Farbpalette neben dem Theme; ohne Angabe keine'),
    targetVersion: z.enum(VERSIONS).default('1.21.11').describe('Minecraft-Java-Zielversion (nur Familien, die es dort gibt)'),
    paletteOverrides: paletteOverridesSchema.optional().describe('bisherige Überschreibungen (Ausgangspunkt); ohne Angabe Theme-Farben'),
    roll: z.boolean().default(false).describe('true = nicht gesperrte Gruppen neu würfeln (harmonisch zu den gesperrten)'),
    lock: z.array(z.enum(PALETTE_GROUP_IDS)).max(7).optional().describe('Gruppen, die beim Würfeln bleiben: wall, frame, roof, base, floor, accent, interior_wood'),
    seed: Int.min(0).max(2 ** 31 - 1).default(1).describe('Zufalls-Seed fürs Würfeln; gleicher Seed = gleicher Vorschlag'),
    swapFrom: z.string().regex(/^[a-z0-9_]+(:[a-z0-9_]+)?$/).optional().describe('zusätzlich die Tausch-Ziele für diese Familie auflisten (z. B. oak)'),
  }).strict(),
  cacheable: true,
  run(input, ctx) {
    const version = TARGET_VERSIONS[input.targetVersion].name;
    const data = ctx.platform(version).families;
    const current = paletteOverridesOf(input.paletteOverrides);
    const problems = paletteOverrideProblems(current, data);
    const overrides = input.roll ? rollPaletteOverrides(ctx, input.themeId, input.paletteId, current, data, input.seed, input.lock ?? []) : current;
    const view = paletteEditorView(ctx, input.themeId, input.paletteId, overrides, data);
    return {
      data: {
        paletteOverrides: overridesJson(overrides),
        problems: [...problems],
        groups: view.groups.map((g) => ({
          group: g.group,
          label: g.label,
          roles: [...g.roles],
          ...(g.theme !== undefined ? { theme: sw(g.theme)! } : {}),
          ...(g.effective !== undefined ? { effective: sw(g.effective)! } : {}),
          ...(g.current !== undefined ? { current: g.current } : {}),
          options: g.options.map((o) => ({ ...sw(o)!, fits: o.fits })),
        })),
        swapSources: view.swapSources.map((s) => ({ ...sw(s)!, roles: s.roles })),
        ...(input.swapFrom !== undefined ? { swapTargets: swapTargets(input.swapFrom, data).map((s) => sw(s)!) } : {}),
      },
    };
  },
});
