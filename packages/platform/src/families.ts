/**
 * Auflösung Familie + Form → Block-ID einer Version (Glossar: Rolle → Familie über das Theme, dann Form).
 * Rein, arbeitet auf data/families-<version>.json. Die Ableitung der Familien liegt in build/families.ts.
 *
 * Reihenfolge:
 *  1. Familie hat die Form direkt (z. B. `iron` + `chain` → `iron_chain`, in 1.21.1 → `chain`).
 *  2. Lücke mit Fallback-Kette (z. B. `calcite` + `stairs` → `quartz_stairs`).
 *  3. Familie fehlt in dieser Version → Versions-Fallback (z. B. `pale_oak` in 1.21.1 → ähnlichste Holzart).
 */
import type { FamilyData } from './types.js';

/** Die 16 Farbstoffe in Spiel-Reihenfolge. */
export const DYE_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;
export type DyeColor = (typeof DYE_COLORS)[number];

export interface ResolvedMaterial {
  readonly block: string;
  /** Familie, aus der der Block tatsächlich stammt */
  readonly family: string;
  /** Form, die tatsächlich verwendet wurde (bei Fallback innerhalb der Familie ggf. eine andere) */
  readonly shape: string;
  /** true: nicht die gewünschte Familie/Form, sondern ein Ersatz */
  readonly viaFallback: boolean;
}

/** Familie + Form → Block-ID. `undefined` = in dieser Version nicht auflösbar (Versions-Gating im Theme nötig). */
export function resolveMaterial(data: FamilyData, family: string, shape: string): ResolvedMaterial | undefined {
  const f = Object.hasOwn(data.families, family) ? data.families[family] : undefined;
  if (f === undefined) {
    for (const alt of data.versionFallbacks[family] ?? []) {
      if (!Object.hasOwn(data.families, alt)) continue;
      const r = resolveMaterial(data, alt, shape);
      if (r) return { ...r, viaFallback: true };
    }
    return undefined;
  }
  const direct = f.shapes[shape];
  if (direct !== undefined) return { block: direct, family, shape, viaFallback: false };
  const gap = data.gaps.find((g) => g.family === family && g.shape === shape);
  const step = gap?.fallback[0];
  if (step) return { block: step.block, family: step.family, shape: step.shape, viaFallback: true };
  return undefined;
}
