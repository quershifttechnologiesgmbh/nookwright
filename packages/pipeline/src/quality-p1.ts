/**
 * Kennzahl **P1 – Wertkontrast Wand ↔ Dach ↔ Kante** (research/54 §1.1, research/58 §4).
 *
 * Aus der Distanz trägt der **Helligkeitsunterschied** (Wert) die Lesbarkeit eines Baus stärker als der Farbton –
 * so die Konstruktion der Kennzahl in research/54 §1.2 (Wertkontrast, 60/30/10; die Q0-Nachmessung hat die
 * Behauptung „value does more work than hue" als **nicht** im zitierten Artikel belegt zurückgewiesen, siehe
 * `research/referenzen_q0.md` §2.4). P1 misst den Wertunterschied zwischen den drei Flächen, die die
 * Silhouette tragen, in **OKLab-L** (wahrnehmungsnahe Helligkeit 0–1):
 *
 *   P1 = |L(Wand) − L(Dach)|        (dazu berichtet: |L(Dach) − L(Kante)| und |L(Wand) − L(Kante)|)
 *
 * Je größer P1, desto klarer hebt sich das Dach von der Wand ab; unter dem Mindestabstand (`P1_MIN_DISTANCE`)
 * verliert der Bau aus der Distanz seine Dachlinie. Gemessen wird **je Fläche** das gewichtete Mittel der Blöcke der
 * zugeordneten Theme-Rolle:
 * - `wall_primary` (Paletten-Rolle `wall_primary`),
 * - `roof_main` (Paletten-Rolle `roof`),
 * - `roof_trim` (Paletten-Rolle `roof_accent`; die Kante/der First).
 *
 * Die Blockfarbe kommt aus `blockLook` (dieselbe Heuristik wie die Block-Vorschau der App, research/08 §5 –
 * keine Mojang-Assets); daraus wird über sRGB → lineares Licht → LMS → OKLab die Helligkeit L gerechnet.
 * Rein und deterministisch: keine Zufallsquelle, kein I/O.
 *
 * **Vorher/Nachher (Q4):** „vorher“ ist das Theme ohne Palette, „nachher“ dasselbe Theme mit `applyPalette`;
 * beide misst `packages/pipeline/test/quality-p1.test.ts` („P1 vorher/nachher“), P1 des Themes druckt
 * `npm run quality`. Einen eigenen Q4-Bericht gibt es nicht (geplant in research/50 §J, nie geschrieben).
 */
import type { PaletteDef, ResolvedTheme, ThemeMixEntry } from '@mcda/catalog';
import { blockLook } from './blockColors.js';

/** sRGB-Anteil (0–1) → linearer Lichtanteil (IEC 61966-2-1). */
function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 24-Bit-RGB → OKLab-L (0 = Schwarz, 1 = Weiß), nach Björn Ottosson. */
export function oklabL(rgb: number): number {
  const r = linearize(((rgb >> 16) & 0xff) / 255);
  const g = linearize(((rgb >> 8) & 0xff) / 255);
  const b = linearize((rgb & 0xff) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** Helligkeit eines einzelnen Blocks (OKLab-L) – dieselbe Farbquelle wie die Block-Vorschau. */
export function blockLightness(blockId: string): number {
  return oklabL(blockLook(blockId).color);
}

/** Helligkeit einer gewichteten Blockliste (Gewichte werden normiert). */
export function mixLightness(blocks: ReadonlyArray<{ readonly block: string; readonly weight: number }>): number {
  const total = blocks.reduce((s, b) => s + b.weight, 0);
  if (total <= 0) return 0;
  return blocks.reduce((s, b) => s + blockLightness(b.block) * b.weight, 0) / total;
}

/**
 * Die drei Messflächen von P1: Theme-Rolle für Wand, Dach und Kante. Die Kantenrolle (`roof_trim`) trägt First,
 * Grat und Traufe (research/53 §1–3); fehlt sie in einem Theme, fällt sie auf die Dachrolle zurück.
 */
export const P1_ROLES = { wall: 'wall_primary', roof: 'roof_main', edge: 'roof_trim' } as const;

/**
 * Mindestabstand in OKLab-L (research/58 §4: „≥ Mindestabstand aus 54“). research/54 fordert einen sichtbaren
 * **Wert**sprung zwischen den drei tragenden Flächen, nennt aber keine Zahl; gewählt ist 0,05 L – das ist rund
 * ein Viertel des Unterschieds Stein (`stone` 0,53) ↔ Tiefenschiefer-Fliesen (`deepslate_tiles` 0,32) und liegt
 * unter dem, was die bestehenden Themes mit ihrer Wand-Dach-Kante-Trennung erreichen (siehe `quality-p1.test.ts`).
 */
export const P1_MIN_DISTANCE = 0.05;

/** Messwert einer Rolle: Helligkeit und die Blöcke, aus denen sie gemittelt wurde. */
export interface P1Surface {
  readonly role: string;
  readonly lightness: number;
  readonly blocks: ReadonlyArray<{ readonly block: string; readonly weight: number }>;
}

export interface P1Result {
  readonly wall: P1Surface;
  readonly roof: P1Surface;
  readonly edge: P1Surface;
  /** |Wand − Dach|, |Dach − Kante|, |Wand − Kante| in OKLab-L. */
  readonly contrasts: { readonly wallRoof: number; readonly roofEdge: number; readonly wallEdge: number };
  /** Die Kennzahl: |L(Wand) − L(Dach)| in OKLab-L (0–1). */
  readonly value: number;
  /** `value >= P1_MIN_DISTANCE`. */
  readonly ok: boolean;
}

/**
 * Theme-Mischungs-Eintrag → Blockname für die Farbmessung (nach der Namenskonvention des Materialisierers:
 * Familie + Variante, sonst `_planks`). Für den **Wertkontrast** zählt die Materialfamilie, nicht die Form.
 */
function measurementBlock(e: ThemeMixEntry): string {
  if (e.block !== undefined) return e.block;
  if (e.color !== undefined) return `minecraft:${e.color}_wool`;
  const family = e.family!;
  const name = family.startsWith('color:') ? family.slice('color:'.length) : family;
  if (e.variant === undefined) return `minecraft:${name}_planks`;
  // W12-D (28.09.2026): Stamm-Varianten heißen im Spiel `<familie>_log` bzw. `stripped_<familie>_log` – vorher
  // entstand `stripped_log_spruce`, ein unbekannter Name mit Ersatzfarbe (L ≈ 0,55 statt 0,52). Bis W12-D nutzte
  // keine P1-Rolle eine Stamm-Variante; die übrigen Varianten (`mossy`, `cracked`) bleiben `<variante>_<familie>`.
  const log = /^(stripped_)?(log|wood)$/.exec(e.variant);
  if (log !== null) return `minecraft:${log[1] ?? ''}${name}_${log[2]}`;
  return `minecraft:${e.variant}_${name}`;
}

/**
 * Blöcke einer Theme-Rolle als gewichtete Liste (Mischung oder Verlauf – beim Verlauf zählt jeder Stopp
 * gleich; die Geometrie des Verlaufs ist für den Flächen-Eindruck unerheblich).
 */
function resolvedBlocks(theme: ResolvedTheme, role: string): ReadonlyArray<{ readonly block: string; readonly weight: number }> {
  const spec = theme.roles[role];
  if (spec === undefined) return [];
  const entries = spec.mix ?? spec.gradient?.stops.flatMap((s) => s.mix) ?? [];
  return entries.map((e) => ({ block: measurementBlock(e), weight: e.weight }));
}

/**
 * Helligkeit einer Paletten-Rolle – direkt aus der Palette, ohne Theme (research/54 §2.3: die Palette nennt
 * Blöcke). Familien-Einträge werden wie im Theme benannt (`measurementBlock`); eine Rolle ohne Einträge liefert
 * `undefined`.
 */
export function paletteRoleLightness(palette: PaletteDef, role: 'wall_primary' | 'roof' | 'roof_accent'): number | undefined {
  const blocks = palette.roles[role]?.blocks;
  if (blocks === undefined || blocks.length === 0) return undefined;
  return mixLightness(blocks.map((b) => ({ block: b.block ?? measurementBlock({ ...b }), weight: b.weight })));
}

/**
 * P1 eines aufgelösten Themes (mit oder ohne angewandter Palette). Fehlt eine der drei Rollen, wird die Kante
 * durch das Dach ersetzt; fehlen Wand oder Dach, ist P1 nicht messbar (`undefined`) – das zählt nicht als
 * „bestanden“.
 */
export function P1(theme: ResolvedTheme): P1Result | undefined {
  const wall = resolvedBlocks(theme, P1_ROLES.wall);
  const roof = resolvedBlocks(theme, P1_ROLES.roof);
  if (wall.length === 0 || roof.length === 0) return undefined;
  // Kante: eigene Rolle, sonst das Dach (dann ist der Dach-Kante-Abstand 0 und P1 fällt auf den Rest zurück).
  const edgeOwn0 = resolvedBlocks(theme, P1_ROLES.edge);
  const edgeRole = edgeOwn0.length > 0 ? P1_ROLES.edge : P1_ROLES.roof;
  const edge = edgeOwn0.length > 0 ? edgeOwn0 : roof;
  const surfaces = {
    wall: { role: P1_ROLES.wall, lightness: mixLightness(wall), blocks: wall },
    roof: { role: P1_ROLES.roof, lightness: mixLightness(roof), blocks: roof },
    edge: { role: edgeRole, lightness: mixLightness(edge), blocks: edge },
  };
  const contrasts = {
    wallRoof: Math.abs(surfaces.wall.lightness - surfaces.roof.lightness),
    roofEdge: Math.abs(surfaces.roof.lightness - surfaces.edge.lightness),
    wallEdge: Math.abs(surfaces.wall.lightness - surfaces.edge.lightness),
  };
  // **Geprüft** wird die Wand ↔ Dach-Trennung: Sie trägt die Lesbarkeit aus der Distanz (Körper gegen Dach) und
  // ist in jeder Palette messbar. Die beiden Kantenabstände werden mitberichtet, aber nicht als Schwelle geführt:
  // Ein dunkler First auf dunklem Dach oder ein First im Wandwert ist eine zulässige Gestaltung (research/53 §1),
  // solange sich das Dach von der Wand abhebt.
  const value = contrasts.wallRoof;
  return { ...surfaces, contrasts, value, ok: value >= P1_MIN_DISTANCE };
}

/** P1 in Prozent des Mindestabstands (für Berichte: 100 % = gerade bestanden). */
export function P1Percent(theme: ResolvedTheme): number | undefined {
  const r = P1(theme);
  return r === undefined ? undefined : Math.round((r.value / P1_MIN_DISTANCE) * 100);
}

/** Kurztext für den Bericht, z. B. `P1 0,089 (=179 % des Mindestabstands 0,05) · Wand 0,71 / Dach 0,62 / Kante 0,41`. */
export function P1Text(theme: ResolvedTheme): string {
  const r = P1(theme);
  if (r === undefined) return 'P1 nicht messbar (Wand- oder Dachrolle fehlt)';
  const f = (x: number) => x.toFixed(3).replace('.', ',');
  return `P1 ${f(r.value)} (=${Math.round((r.value / P1_MIN_DISTANCE) * 100)} % des Mindestabstands ${f(P1_MIN_DISTANCE)})`
    + ` · Wand ${f(r.wall.lightness)} / Dach ${f(r.roof.lightness)} / Kante ${f(r.edge.lightness)}`
    + ` · Dach↔Kante ${f(r.contrasts.roofEdge)}${r.ok ? '' : ' · Wand↔Dach zu schwach'}`;
}
