/**
 * Dekorateur „Ruine“ (additiv, research/50 C1): bricht die **Silhouette** eines Baus, indem er Zellen der Hülle
 * entfernt (Erosion). **Rein und deterministisch**: jede Entscheidung kommt aus `hashSeed`/`hash01`
 * (Projekt-Seed + Position), nie aus `Math.random` oder `Math.sin`.
 *
 * Entfernungsregel – physik-sicher per Konstruktion:
 *  1. Je Spalte (x, z) wird **von oben nach unten** gelaufen. Entfernt wird ein **Cap** erodierbarer Zellen; eine
 *     Zelle beendet den Cap, sobald sie nicht erodierbar ist (`NEVER`-Kind, Rolle nicht erlaubt, Dach unter
 *     `minRoofT`, Innenwand, gesperrter Komponententräger). **Dachtreppen** (`shape: stairs`) sind die sichtbare
 *     Dachhaut und werden nie entfernt; der Cap läuft unter ihnen weiter.
 *  2. Damit kann eine entfernte Zelle eine **selbsttragende** Zelle über sich behalten (Treppe, Stufe, Vollblock):
 *     alle erodierbaren Hüll-Kinds (wall/pillar/ceiling/roof/facade) tragen in den Plattform-Daten weder
 *     `needsSupport` noch `falls` – im Spiel bleibt der Block darüber stehen. Verwaist werden könnte nur, was
 *     wirklich Stütze braucht: Türen (Kind `door`, immer gesperrt), Pflanzen/Gelände (Kinds, immer gesperrt) und
 *     **Komponenten**. Deren Trägerzellen sind gesperrt (Punkt 3), also bricht keine Stütze.
 *  3. **Nie** entfernt werden Türen, Fenster, Sturz, Boden, Gelände, Pflanzen, Bauwerke, Treppen/Geländer
 *     (Innenerschließung) und Dachtreppen – und nur **Außenhaut** (Wände/Pfeiler/Fassade mit `exterior`), damit
 *     Innenwände stehen.
 *  4. Träger von **Komponenten** sind gesperrt: `protectedByComponents` sperrt die sechs Nachbarfelder jeder
 *     Komponentenzelle plus die Ziele ihrer Stützmasken. Jede Stützprüfung der Physik liest genau einen dieser
 *     Nachbarn – deshalb kann keine Stütz-/Luftmaske brechen. Gesperrte Zellen **beenden** den Cap, damit der
 *     Träger nicht von unten untergraben wird.
 *
 * Kein Schutt: die Lücke bleibt sauber (Luft). Das hält den Pass frei von neuen Katalog-Bausteinen und von
 * zusätzlichen Tragereien; „Schutt“ entsteht im Bild bereits über die Palette des Themes.
 *
 * Ohne `decor.ruin` im Theme ist der Pass aus (`undefined`) – andere Themes bleiben bitgleich.
 */
import type { Shell, ShellKind } from '@mcda/blueprint';
import type { ResolvedTheme } from '@mcda/catalog';
import { add, hash01, hashSeed, key3, resolveRelDir, transformLocal, type Vec3 } from '@mcda/core';
import { colKey, type CellContext } from './context.js';
import type { MaterializePlacement } from './types.js';
import { step } from './world.js';

/** Schalter/Übersteuerung in `MaterializeOptions.ruin` (Vorbild: `SnowCoverOption`). */
export type RuinOption = false | {
  readonly roles?: readonly string[];
  readonly chance?: number;
  readonly maxDrop?: number;
  readonly minRoofT?: number;
};

export interface RuinSettings {
  readonly roles: ReadonlySet<string>;
  /** Anteil der Spalten, die erodieren (0–1); 1 = jede Spalte. */
  readonly chance: number;
  /** Größte Erosionstiefe je Spalte in Zellen (1–8, von oben). */
  readonly maxDrop: number;
  /** Nur Dachzellen ab diesem `roof_t` (0 = Traufe, 1 = First); 0 = ganzes Dach. */
  readonly minRoofT: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Kinds, die nie erodieren (Türen/Fenster/Sturz/Boden/Gelände/Pflanzen/Bauwerke/Innenerschließung). */
const NEVER: ReadonlySet<ShellKind> = new Set<ShellKind>([
  'door', 'window', 'lintel', 'floor', 'terrain', 'plant', 'fort', 'stairs', 'railing',
]);

/** Wandartige Kinds, für die nur die Außenhaut (`exterior`) erodiert (Innenwände bleiben stehen). */
const EXTERIOR_ONLY: ReadonlySet<ShellKind> = new Set<ShellKind>(['wall', 'pillar', 'facade']);

/** Sechs Nachbarfelder (Stütze/Schwerkraft der Physik liest genau eines davon). */
const NEIGHBORS: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Einstellungen aus Theme (`decor.ruin`) und Option; `undefined` = Pass aus. Wie bei Schnee/Verwitterung genügt
 * die Option allein nicht: **ohne das Theme-Feld passiert nichts** (Vertrag „bitgleich“).
 */
export function ruinSettings(theme: ResolvedTheme, option?: RuinOption): RuinSettings | undefined {
  if (option === false) return undefined;
  const r = theme.decor.ruin;
  if (r === undefined) return undefined;
  const chance = clamp(option?.chance ?? r.chance ?? 0.5, 0, 1);
  if (chance <= 0) return undefined;
  return {
    roles: new Set(option?.roles ?? r.roles),
    chance,
    maxDrop: clamp(Math.round(option?.maxDrop ?? r.maxDrop ?? 2), 1, 8),
    minRoofT: clamp(option?.minRoofT ?? r.minRoofT ?? 0, 0, 1),
  };
}

/** Eine geplante Entfernung: Position, aufgelöste Rolle und Kind der Hüllzelle. */
export interface RuinRemoval {
  readonly pos: Vec3;
  readonly role: string;
  readonly kind: ShellKind;
}

export interface RuinPlanInput {
  readonly shell: Shell;
  /** Kontext je Hüllzelle (gleiche Reihenfolge wie `shell.cells`). */
  readonly contexts: readonly CellContext[];
  /** Aufgelöste Rolle je Hüllzelle (nach Flächen-Mustern/Rollen-Ersatz), gleiche Reihenfolge. */
  readonly roles: readonly string[];
  readonly settings: RuinSettings;
  readonly seed: number;
  /** Gesperrte Zellen (`key3`): Träger von Komponenten, nie entfernen. */
  readonly protected: ReadonlySet<string>;
}

/**
 * Sperrt alle Zellen, die eine platzierte Komponente tragen kann: die sechs Nachbarn jeder Komponentenzelle
 * (jede Stützprüfung liest genau einen Nachbarn), die Luft-Masken und die Ziele der Stützmasken.
 */
export function protectedByComponents(placements: readonly MaterializePlacement[]): Set<string> {
  const out = new Set<string>();
  const protect = (p: Vec3): void => {
    out.add(key3(p));
    for (const d of NEIGHBORS) out.add(key3([p[0] + d[0], p[1] + d[1], p[2] + d[2]]));
  };
  for (const pl of placements) {
    const { placed } = pl;
    for (const cell of placed.cells) protect(cell.pos);
    for (const a of placed.air) out.add(key3(a));
    for (const ent of placed.entities) protect(ent.pos);
    const pose = placed.pose;
    for (const m of placed.expanded.masks.support ?? []) {
      const at = add(pose.pos, transformLocal(m.at, placed.expanded.size, pose.rot, pose.mirror));
      out.add(key3(step(at, resolveRelDir(m.side, pose))));
    }
  }
  return out;
}

/**
 * Plant die Erosion (rein): je Spalte entscheidet der Hash, ob und wie tief erodiert wird; entfernt wird dann
 * ein zusammenhängender Cap von oben, solange die Zelle erodierbar, rollenerlaubt und nicht gesperrt ist.
 */
export function planRuin(input: RuinPlanInput): RuinRemoval[] {
  const { shell, contexts, roles, settings, seed, protected: blocked } = input;
  /** Spalten (x, z) → Zell-Indizes der Hülle. */
  const columns = new Map<number, number[]>();
  shell.cells.forEach((c, i) => {
    const k = colKey(c.pos[0], c.pos[2]);
    const arr = columns.get(k);
    if (arr === undefined) columns.set(k, [i]);
    else arr.push(i);
  });
  const out: RuinRemoval[] = [];
  for (const idxs of columns.values()) {
    // Von oben nach unten: der erste nicht entfernbare Stein beendet den Cap dieser Spalte.
    idxs.sort((a, b) => shell.cells[b]!.pos[1] - shell.cells[a]!.pos[1]);
    const [x, , z] = shell.cells[idxs[0]!]!.pos;
    if (hash01(hashSeed(seed, 'ruin-col', x, z), x, z) >= settings.chance) continue;
    const depth = 1 + Math.min(settings.maxDrop - 1, Math.floor(hash01(hashSeed(seed, 'ruin-depth', x, z), z, x) * settings.maxDrop));
    let removed = 0;
    for (const i of idxs) {
      if (removed >= depth) break;
      const cell = shell.cells[i]!;
      const ctx = contexts[i];
      const role = roles[i];
      if (ctx === undefined || role === undefined) break;
      // Dachtreppe = sichtbare Dachhaut: nie entfernen, aber den Cap darunter weiterlaufen lassen.
      if (cell.shape === 'stairs') continue;
      if (NEVER.has(cell.kind)) break;
      if (!settings.roles.has(role)) break;
      if (cell.kind === 'roof' && (ctx.t['roof_t'] ?? 1) < settings.minRoofT) break;
      if (EXTERIOR_ONLY.has(cell.kind) && ctx.exterior !== true) break;
      if (blocked.has(key3(cell.pos))) break;
      out.push({ pos: [cell.pos[0], cell.pos[1], cell.pos[2]], role, kind: cell.kind });
      removed++;
    }
  }
  return out;
}
