/**
 * Ehrliche Hinweise zum Stil (W4-D): was die Hülle aus einer Wahl gemacht hat (Dach geteilt, Neigung gesenkt) und
 * welche Schalter beim gewählten Theme nichts bewirken (Eckquader an Holzwänden). Rein und testbar; die Regeln selbst
 * liegen in der Domäne (`Shell.roofFit`) bzw. der Materialisierung (`quoinOut`), hier steht nur die Lesart.
 */
import type { RoofPitch, RoofStyle, ShellRoofFit } from '@mcda/blueprint';
import { isWoodRole, type ResolvedTheme } from '@mcda/catalog';

const PITCH_NAME: Readonly<Record<RoofPitch, string>> = { low: 'flach', normal: 'normal', steep: 'steil' };

/** Dachformen, die die Domäne teilen kann (`RoofDetail.split`: Satteldach-Familie; nicht Walm, Mansarde, Pult, Flach). */
export const SPLIT_ROOFS: ReadonlySet<RoofStyle> = new Set<RoofStyle>(['gable', 'half_hip', 'dutch_gable', 'saltbox', 'gambrel']);

/**
 * Hinweis zur Dach-Einpassung aus `Shell.roofFit` (fehlt ohne automatische Dachhöhe, Teilung und Kniestock): „Dach geteilt“,
 * „Wand um 2 Reihen erhöht (Kniestock …)“ (W4-F), „Neigung gesenkt: steil → normal“. Ohne Befund `undefined`.
 */
export function roofFitNote(fits: readonly ShellRoofFit[] | undefined): string | undefined {
  if (fits === undefined || fits.length === 0) return undefined;
  const parts: string[] = [];
  const split = fits.filter((f) => f.split === true).length;
  if (split > 0) parts.push(split === 1 ? 'Dach geteilt (zu breit für ein Dach in dieser Neigung)' : `${split} Dächer geteilt (zu breit für ein Dach in dieser Neigung)`);
  // W4-F: Kniestock (D5 präzisiert) – die Wand wurde über der Decke erhöht, damit sie nicht niedriger ist als das Dach
  const knee = Math.max(0, ...fits.map((f) => f.knee ?? 0));
  if (knee > 0) parts.push(`Wand um ${knee} ${knee === 1 ? 'Reihe' : 'Reihen'} erhöht (Kniestock – sonst wäre das Dach höher als die Wand)`);
  const lowered = fits.filter((f) => f.pitch !== f.requested);
  if (lowered.length > 0) {
    // Hauptdach zuerst (größte Fläche), je Paar gewünscht → tatsächlich einmal
    const pairs = [...new Set([...lowered].sort((a, b) => b.area - a.area).map((f) => `${PITCH_NAME[f.requested]} → ${PITCH_NAME[f.pitch]}`))];
    parts.push(`Neigung gesenkt: ${pairs.join(', ')} (automatische Dachhöhe)`);
  }
  return parts.length === 0 ? undefined : `${parts.join(' · ')}.`;
}

/** Wirkung des Schalters „Eckquader“ beim Theme: überall, nur an manchen Wandfeldern oder gar nicht. */
export type QuoinEffect = 'full' | 'partial' | 'none';

/**
 * Wirken Eckquader beim Theme? Außerhalb des Fachwerks wird die Eckzelle an einem Holzfeld ein Eckstamm, im Fachwerk
 * ein Ständer (`quoinOut`/`timberOut` in `@mcda/materialize`) – der Quader bleibt nur an Stein-/Putzfeldern. Maßgeblich
 * ist das Grundfeld der Außenwand (erste Wandregel ohne Bedingung außer `exterior`, sonst `wall_primary`); bedingte
 * Regeln davor mit dem anderen Material (Putz ab lichter Höhe 5 an Holz, Fachwerk-Obergeschoss über Stein) machen die
 * Wirkung teilweise.
 */
export function quoinEffect(theme: Pick<ResolvedTheme, 'roles' | 'surfaces'> | undefined): QuoinEffect {
  if (theme === undefined) return 'full';
  const rules = (theme.surfaces.wall ?? []).filter((r) => r.when?.exterior !== false);
  const stone = (r: { readonly role: string; readonly timber?: unknown }): boolean => r.timber === undefined && !isWoodRole(theme, r.role);
  const base = rules.findIndex((r) => r.when === undefined || Object.keys(r.when).every((k) => k === 'exterior'));
  const baseStone = base < 0 ? stone({ role: 'wall_primary' }) : stone(rules[base]!);
  const conditional = base < 0 ? rules : rules.slice(0, base);
  // Stein-Grundfeld mit bedingtem Holz/Fachwerk (z. B. Fachwerk-Obergeschoss): nur teilweise; umgekehrt ebenso
  if (baseStone) return conditional.every(stone) ? 'full' : 'partial';
  return conditional.some(stone) ? 'partial' : 'none';
}
