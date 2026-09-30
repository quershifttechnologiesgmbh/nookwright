/**
 * Kleine, reine Hilfen des Paletten-Editors (W13-G): eine Gruppe setzen/zurücksetzen, einen Tausch setzen/entfernen,
 * Sperre umschalten. Die Normalform (`normalizePaletteOverrides`) liefert `undefined`, wenn nichts übrig bleibt – so
 * wird „alles zurück auf das Theme“ wieder bitgleich.
 */
import { normalizePaletteOverrides, type HarmonyContrastLevel, type PaletteGroup, type PaletteOverrides } from '@mcda/core';

/** Farbharmonie-Felder (WS-Farbe) bleiben beim Ändern von Gruppen und Tauschen erhalten. */
const harmonyOf = (o: PaletteOverrides | undefined): Pick<PaletteOverrides, 'colorHarmony' | 'harmonyContrast' | 'harmonySaturation'> => ({
  ...(o?.colorHarmony !== undefined ? { colorHarmony: o.colorHarmony } : {}),
  ...(o?.harmonyContrast !== undefined ? { harmonyContrast: o.harmonyContrast } : {}),
  ...(o?.harmonySaturation !== undefined ? { harmonySaturation: o.harmonySaturation } : {}),
});

/** Überschreibungen mit Familie `family` für `group` (`undefined` = Gruppe zurück auf das Theme). */
export function groupsWith(o: PaletteOverrides | undefined, group: PaletteGroup, family: string | undefined): PaletteOverrides | undefined {
  const groups: Partial<Record<PaletteGroup, string>> = { ...(o?.groups ?? {}) } as Partial<Record<PaletteGroup, string>>;
  if (family === undefined) delete groups[group];
  else groups[group] = family;
  return normalizePaletteOverrides({ groups, ...(o?.swaps !== undefined ? { swaps: o.swaps } : {}), ...harmonyOf(o) });
}

/** Überschreibungen mit Tausch `from → to` (`to` fehlt = Tausch entfernen); ein Tausch je Quelle. */
export function swapsWith(o: PaletteOverrides | undefined, from: string, to: string | undefined): PaletteOverrides | undefined {
  const swaps = (o?.swaps ?? []).filter((s) => s.from !== from);
  if (to !== undefined) swaps.push({ from, to });
  return normalizePaletteOverrides({ ...(o?.groups !== undefined ? { groups: o.groups } : {}), swaps, ...harmonyOf(o) });
}

/** Sperre einer Gruppe umschalten (Reihenfolge stabil). */
export function lockedToggle(locked: readonly PaletteGroup[], group: PaletteGroup): readonly PaletteGroup[] {
  return locked.includes(group) ? locked.filter((g) => g !== group) : [...locked, group];
}

/** Farbharmonie an/aus (mit Kontraststufe); `on = false` entfernt sie samt Feinstellung, der Rest bleibt. */
export function harmonyWith(o: PaletteOverrides | undefined, on: boolean, contrast?: HarmonyContrastLevel): PaletteOverrides | undefined {
  return normalizePaletteOverrides({
    ...(o?.groups !== undefined ? { groups: o.groups } : {}),
    ...(o?.swaps !== undefined ? { swaps: o.swaps } : {}),
    ...(on ? { colorHarmony: 'on' as const, ...(contrast !== undefined ? { harmonyContrast: contrast } : o?.harmonyContrast !== undefined ? { harmonyContrast: o.harmonyContrast } : {}) } : {}),
  });
}
