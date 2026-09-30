/**
 * Zeilen der Paletten-Ansicht (Axiom-Vorbild, research/13 §8 #17/#19): die gemessene Palette des fertigen
 * Volumens wird nach Rollen gruppiert und je Rolle nach Anteil sortiert. Rein und testbar – die Darstellung
 * selbst steht in `PaletteSection.tsx`.
 */
import type { MaterialResolution, PaletteEntry } from '@mcda/materialize';

/** Block-ID ohne Namensraum (`minecraft:stone_bricks` → `stone_bricks`). */
export function shortBlockName(id: string): string {
  const i = id.indexOf(':');
  return i < 0 ? id : id.slice(i + 1);
}

export interface PaletteRow {
  readonly role: string;
  readonly block: string;
  readonly count: number;
  /** Anteil an der Rolle (0–1). */
  readonly share: number;
}

/** Klartext-Name der Gruppe „Material-Schichten der Möbel/Komponenten" (Review 3: „fence_plate", „podzol"). */
export const FURNITURE_GROUP = 'Möbel & Deko';
/** Technischer Schlüssel der Möbel-Gruppe (kollidiert mit keiner Theme-Rolle). */
const FURNITURE_KEY = '~mobiliar';

export interface PaletteGroup {
  readonly role: string;
  /** Anzeigename: Klartext-Rolle des Themes oder `Möbel & Deko` für Material-Schichten der Komponenten. */
  readonly label: string;
  readonly total: number;
  /** Zeilen der Rolle, absteigend nach Anzahl (höchstens `perRole`). */
  readonly rows: readonly PaletteRow[];
  /** Weitere Blöcke der Rolle, die nicht als Zeile erscheinen. */
  readonly rest: number;
}

/**
 * Palette nach Rollen gruppieren: Rollen absteigend nach Gesamtzahl, je Rolle die größten `perRole` Blöcke.
 * Zellen ohne Rolle landen in der Gruppe `—`.
 *
 * Mit `opts.themeRoles` (die Rollen des aktiven Themes) werden Material-Schichten der Möbel – also alles, was
 * **keine** Theme-Rolle ist (`fence_plate`, `podzol`, …) – in einer Gruppe „Möbel & Deko" zusammengefasst.
 * So stehen in der Palette keine internen Layer-IDs mehr (Review 3), die Theme-Rollen der Hülle bleiben sichtbar.
 */
export function paletteByRole(palette: readonly PaletteEntry[], perRole = 4, opts: { readonly themeRoles?: ReadonlySet<string> } = {}): readonly PaletteGroup[] {
  const roleOf = (e: PaletteEntry): { key: string; label: string } => {
    const role = e.role;
    if (role === undefined) return { key: '—', label: '—' };
    if (opts.themeRoles !== undefined && !opts.themeRoles.has(role)) return { key: FURNITURE_KEY, label: FURNITURE_GROUP };
    return { key: role, label: role };
  };
  const totals = new Map<string, { label: string; entries: PaletteEntry[] }>();
  for (const e of palette) {
    const { key, label } = roleOf(e);
    const list = totals.get(key);
    if (list === undefined) totals.set(key, { label, entries: [e] });
    else list.entries.push(e);
  }
  return [...totals.entries()]
    .map(([role, { label, entries }]) => {
      const sorted = [...entries].sort((a, b) => b.count - a.count || a.block.localeCompare(b.block));
      const total = sorted.reduce((n, e) => n + e.count, 0);
      const top = sorted.slice(0, perRole);
      return {
        role,
        label,
        total,
        rows: top.map((e) => ({ role: label, block: e.block, count: e.count, share: total > 0 ? e.count / total : 0 })),
        rest: sorted.length - top.length,
      };
    })
    .sort((a, b) => b.total - a.total || a.role.localeCompare(b.role));
}

/** Klartext einer Ersatz-Auflösung (`wall_primary.block → oak_planks · Versions-Fallback`). */
export function substitutionLabel(s: MaterialResolution, opts: { readonly themeRoles?: ReadonlySet<string> } = {}): string {
  const via = s.via === 'version_fallback' ? 'Versions-Fallback' : s.via === 'role_fallback' ? 'Ersatzfamilie' : s.via === 'platform_fallback' ? 'Plattform-Ersatz' : 'Ersatz';
  // Auch hier keine internen Layer-IDs: Material-Schichten der Möbel heißen „Möbel & Deko" (Review 3)
  const roh = opts.themeRoles !== undefined && !opts.themeRoles.has(s.role);
  return `${roh ? FURNITURE_GROUP : `${s.role}.${s.shape}`} → ${shortBlockName(s.block)} · ${via}`;
}

/** Anteil als ganze Prozent (0–100), für Beschriftungen. */
export function percent(share: number): number {
  return Math.round(share * 100);
}
