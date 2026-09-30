/**
 * Kennzahlen der Fassade (research/58 §4, Q2): F1–F4 als reine Funktionen über Hülle und materialisierter Welt.
 * Zweck ist der objektive Vorher/Nachher-Vergleich der Fassaden-Pflichtregeln (research/58 §Q2); die Namen und
 * Zielbänder sind bewusst die der Vorlage:
 *
 * | # | Kennzahl | Zielband | Messung hier |
 * |---|---|---|---|
 * | F1 | Tiefenlagen je Fassadenzelle (Anteil Zellen mit Vor-/Rücksprung) | ≥ 25 % | Anteil Fassadenzellen, die an einer Tiefenstufe liegen (projizieren oder neben einem Vorsprung sitzen) |
 * | F2 | Nicht-Vollblock-Anteil an der Fassade | 20–35 % | Anteil Fassadenzellen mit einem Block, der keine volle Würfelform ist (Treppen, Stufen, Falltüren, Zäune, Scheiben …) |
 * | F3 | verschiedene Blöcke je 10×10-Fassadenfläche | 6–12 | Mittel der verschiedenen Blocknamen je 10×10-Kachel einer Wandfläche |
 * | F4 | größte Folge identischer Fensterachsen | ≤ 3 | längste Folge gleicher Achsen-Signatur (Breite + Rahmung) auf einer Wandlinie |
 *
 * „Fassadenzelle“ ist eine Hüllzelle der Arten `wall`, `pillar`, `window`, `door`, `lintel`, `facade`, die im
 * fertigen Volumen liegt und waagerecht an Außenluft grenzt. Rollen und Formen kommen aus dem Volumen, damit die
 * Kennzahl das Ergebnis misst, nicht die Absicht der Hülle. Rein und deterministisch: gleiche Welt, gleiche Zahlen.
 */
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { HORIZONTAL } from '@mcda/core';
import type { Shell, ShellAnchor, ShellCell } from '@mcda/blueprint';
import { isAir, type VoxelVolume } from '@mcda/voxel';

/** Zellarten, die die Fassade bilden. */
const FACADE_KINDS: ReadonlySet<ShellCell['kind']> = new Set(['wall', 'pillar', 'window', 'door', 'lintel', 'facade']);

const DIR_STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = {
  north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0],
};

/**
 * Blocknamen ohne volle Würfelform (F2). Suffixe: Treppen, Stufen, Falltüren, Zäune, Scheiben, Mauern, Türen, Ketten,
 * Stäbe, Schilder usw.; dazu Einzelnamen ohne Form-Suffix (Fackel, Laterne, Endstab). Alles andere gilt als Vollblock.
 */
const NOT_FULL_SUFFIX = [
  '_stairs', '_slab', '_trapdoor', '_fence', '_fence_gate', '_pane', '_bars', '_wall', '_door', '_carpet',
  '_button', '_chain', '_ladder', '_sign', '_candle', '_rail', '_pressure_plate', '_plate', '_head', '_banner',
  '_bed', '_campfire', '_cauldron', '_composter', '_lectern', '_anvil', '_brewing_stand', '_hopper', '_flower_pot',
  '_sculk_sensor', '_tripwire_hook', '_lever',
] as const;

/** Einzelnamen ohne Form-Suffix, die trotzdem keine volle Würfelform haben. */
const NOT_FULL_NAMES: ReadonlySet<string> = new Set([
  'lantern', 'soul_lantern', 'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch',
  'end_rod', 'lightning_rod',
]);

/** Volle Würfelform? (F2) */
export function isFullBlock(name: string): boolean {
  return !NOT_FULL_NAMES.has(name) && !NOT_FULL_SUFFIX.some((s) => name.endsWith(s));
}

export interface FacadeQuality {
  /** F1: Anteil Fassadenzellen mit Vor-/Rücksprung (0–1). */
  readonly f1: number;
  /** F2: Anteil Nicht-Vollblöcke an der Fassade (0–1). */
  readonly f2: number;
  /** F3: verschiedene Blöcke je 10×10-Fassadenfläche (Mittel über alle Kacheln). */
  readonly f3: number;
  /** F4: größte Folge identischer Fensterachsen auf einer Wandlinie. */
  readonly f4: number;
  /** Fassadenzellen der Messung (Nenner von F1/F2). */
  readonly facadeCells: number;
  /** Fensterachsen (Anker) der Messung. */
  readonly windowAxes: number;
  /** Verschiedene Blöcke an der ganzen Fassade (nur zur Information). */
  readonly distinctBlocks: number;
}

/** Waagerechte Nachbarn einer Zelle mit Blockzustand. */
function neighbours(pos: Vec3, volume: VoxelVolume): Array<{ readonly dir: HorizontalDir; readonly air: boolean; readonly occupied: boolean; readonly name: string }> {
  const out: Array<{ dir: HorizontalDir; air: boolean; occupied: boolean; name: string }> = [];
  for (const dir of HORIZONTAL) {
    const s = DIR_STEP[dir];
    const p: Vec3 = [pos[0] + s[0], pos[1], pos[2] + s[1]];
    if (!volume.contains(p)) continue;
    const state = volume.stateAt(p);
    // W2 (I1): die Innenhaut (Paneele vor der Wand, Besitzer `lining:…`) ist Innenluft, keine Fassade – die Kennzahlen
    // messen dieselben Wandzellen wie ohne Innenhaut
    const occupied = !volume.isEmpty(p) && !isAir(state) && !(volume.cell(p)?.owner.startsWith('lining:') ?? false);
    out.push({ dir, air: !occupied, occupied, name: state.name });
  }
  return out;
}

const perpendicular = (a: HorizontalDir, b: HorizontalDir): boolean => {
  const ax = a === 'east' || a === 'west';
  const bx = b === 'east' || b === 'west';
  return ax !== bx;
};

/** Fassadenzellen: Hüllzellen der Fassadenarten mit Außenluft daneben, die im Volumen stehen. */
function facadeCellsOf(shell: Shell, volume: VoxelVolume): Array<{ readonly cell: ShellCell; readonly pos: Vec3 }> {
  const out: Array<{ cell: ShellCell; pos: Vec3 }> = [];
  for (const cell of shell.cells) {
    if (!FACADE_KINDS.has(cell.kind)) continue;
    const { pos } = cell;
    if (!volume.contains(pos) || volume.isEmpty(pos)) continue;
    if (neighbours(pos, volume).some((n) => n.air)) out.push({ cell, pos });
  }
  return out;
}

/** Außenrichtung einer Fassadenzelle (erste Richtung mit Luft; feste Reihenfolge = deterministisch). */
function outwardOf(pos: Vec3, volume: VoxelVolume): HorizontalDir | undefined {
  return HORIZONTAL.find((d) => {
    const s = DIR_STEP[d];
    const p: Vec3 = [pos[0] + s[0], pos[1], pos[2] + s[1]];
    return volume.contains(p) && (volume.isEmpty(p) || isAir(volume.stateAt(p)) || (volume.cell(p)?.owner.startsWith('lining:') ?? false));
  });
}

/**
 * F1: Vor-/Rücksprung. Eine Zelle liegt an einer Tiefenstufe, wenn sie
 *  - selbst eine Profilzelle ist (`kind: facade` – Sockel, Gesims, Konsole, Rahmen, Wandvorlage), oder
 *  - in einer Richtung an Luft grenzt und schräg daneben ein Profil liegt (sie sitzt neben einem Vorsprung zurück).
 */
function depthCell(cell: ShellCell, pos: Vec3, volume: VoxelVolume): boolean {
  if (cell.kind === 'facade') return true;
  const d = outwardOf(pos, volume);
  if (d === undefined) return false;
  for (const e of HORIZONTAL) {
    if (!perpendicular(d, e)) continue;
    const s = DIR_STEP[e];
    const q: Vec3 = [pos[0] + s[0] + DIR_STEP[d][0], pos[1], pos[2] + s[1] + DIR_STEP[d][1]];
    if (!volume.contains(q) || volume.isEmpty(q) || isAir(volume.stateAt(q))) continue;
    return true;
  }
  return false;
}

/**
 * F3: verschiedene Blocknamen je 10×10-Kachel einer Wandfläche. Die Kachel liegt in der projizierten Fassadenebene
 * (Außenseite × Laufrichtung × Höhe, je 10 Blöcke); Profil- und Wandzellen derselben Seite zählen zusammen, damit
 * eine versetzte Wand (L-Grundriss, Flügel) nicht in viele winzige Kacheln zerfällt.
 */
function blocksPerPatch(cells: readonly { readonly cell: ShellCell; readonly pos: Vec3 }[], volume: VoxelVolume): number {
  const bins = new Map<string, Set<string>>();
  for (const { pos } of cells) {
    const out = outwardOf(pos, volume);
    if (out === undefined) continue;
    const alongX = out === 'north' || out === 'south';
    const along = alongX ? pos[0] : pos[2];
    const key = `${out}|${Math.floor(along / 10)}|${Math.floor(pos[1] / 10)}`;
    const set = bins.get(key) ?? new Set<string>();
    set.add(volume.stateAt(pos).name);
    bins.set(key, set);
  }
  const counts = [...bins.values()].map((s) => s.size);
  return counts.length === 0 ? 0 : counts.reduce((a, b) => a + b, 0) / counts.length;
}

/** Fensterachse mit Signatur (Breite + Rahmung) und Wandschlüssel für F4. */
interface Axis {
  readonly key: string;
  readonly along: number;
  readonly signature: string;
}

/**
 * F4: Fensterachsen aus den Ankern. Zwei Achsen sind „gleich“, wenn Breite UND Rahmung übereinstimmen; die Rahmung
 * ist der Ring aus Fassadenzellen in der Außenebene um die Öffnung (Bank unten, Verdachung oben, Wangen seitlich,
 * Fokuspunkt darüber). Gezählt wird die längste Folge gleicher Achsen auf derselben Wandlinie.
 */
function windowAxes(shell: Shell): Axis[] {
  const facade = new Map<string, ShellCell>();
  for (const c of shell.cells) if (c.kind === 'facade') facade.set(`${c.pos[0]},${c.pos[1]},${c.pos[2]}`, c);
  const anchors = (shell.anchors ?? []).filter((a): a is ShellAnchor => a.kind === 'window');
  const out: Axis[] = [];
  for (const a of anchors) {
    const alongX = a.facing === 'north' || a.facing === 'south';
    const plane = alongX ? a.pos[2] : a.pos[0];
    const along = alongX ? a.pos[0] : a.pos[2];
    const alongStep = DIR_STEP[alongX ? 'east' : 'south'];
    // Öffnung: die Zelle hinter dem Anker (Wandebene); Höhe aus den zusammenhängenden Fensterzellen
    const step = DIR_STEP[a.facing];
    const col: Vec3 = [a.pos[0] - step[0], a.pos[1], a.pos[2] - step[1]];
    let h = 0;
    while (shell.cells.some((c) => c.kind === 'window' && c.pos[0] === col[0] && c.pos[2] === col[2] && c.pos[1] === col[1] + h)) h++;
    if (h === 0) h = 1;
    const width = a.span ?? 1;
    // Rahmenring in der Außenebene (a.pos): seitliche Wangen, Bank, Verdachung und Fokuspunkt
    const ring: string[] = [];
    for (let j = -1; j <= width; j++) {
      const x = a.pos[0] + (alongX ? alongStep[0] * j : 0);
      const z = a.pos[2] + (alongX ? 0 : alongStep[1] * j);
      for (let dy = -1; dy <= h + 1; dy++) {
        if (j >= 0 && j < width && dy >= 0 && dy < h) continue; // die Öffnung selbst
        const c = facade.get(`${x},${a.pos[1] + dy},${z}`);
        if (c !== undefined) ring.push(`${j}:${dy}:${c.role}/${c.shape}`);
      }
    }
    ring.sort();
    out.push({ key: `${a.floorIndex}|${a.facing}|${plane}`, along, signature: `${width}|${ring.join(',')}` });
  }
  return out;
}

function longestIdenticalRun(axes: readonly Axis[]): { readonly run: number; readonly groups: number } {
  const byKey = new Map<string, Axis[]>();
  for (const a of axes) (byKey.get(a.key) ?? byKey.set(a.key, []).get(a.key)!).push(a);
  let best = 0;
  for (const list of byKey.values()) {
    const sorted = [...list].sort((p, q) => p.along - q.along);
    let run = 0;
    for (let i = 0; i < sorted.length; i++) {
      run = i > 0 && sorted[i]!.signature === sorted[i - 1]!.signature ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  return { run: best, groups: axes.length };
}

/** Außen-Zellen direkt vor einer Wandzelle der Hülle als Profilzellen (`kind: facade`) dazu. */
function withExteriorProfile(shell: Shell, exterior: readonly { readonly cells: readonly Vec3[] }[]): Shell {
  const WALLISH = new Set<ShellCell['kind']>(['wall', 'pillar', 'window', 'door', 'lintel']);
  const byPos = new Map<string, ShellCell>();
  for (const c of shell.cells) byPos.set(`${c.pos[0]},${c.pos[1]},${c.pos[2]}`, c);
  const extra: ShellCell[] = [];
  for (const pl of exterior) {
    for (const p of pl.cells) {
      const k = `${p[0]},${p[1]},${p[2]}`;
      if (byPos.has(k)) continue;
      const wall = HORIZONTAL.some((d) => WALLISH.has(byPos.get(`${p[0] + DIR_STEP[d][0]},${p[1]},${p[2] + DIR_STEP[d][1]}`)?.kind ?? 'floor'));
      if (!wall) continue;
      const c: ShellCell = { pos: p, kind: 'facade', role: 'exterior', shape: 'block', exterior: true };
      byPos.set(k, c);
      extra.push(c);
    }
  }
  return extra.length === 0 ? shell : { ...shell, cells: [...shell.cells, ...extra] };
}

/** F1–F4 einer fertigen Welt (Hülle + materialisiertes Volumen). */
export function facadeQuality(shell: Shell, volume: VoxelVolume, exterior?: readonly { readonly cells: readonly Vec3[] }[]): FacadeQuality {
  // W7-A (27.09.2026, plan/spikes/W7A_ruhe.md): mit Fassadenraster setzt das Fenstermodul (Außen-Deko) den ganzen Rahmen,
  // nicht mehr die Hülle die Ecken. Mit `exterior` zählen Außen-Zellen direkt vor einer Wand wie Profilzellen der Hülle –
  // gemessen wird das Ergebnis, nicht, wer es gesetzt hat. Ohne `exterior` wie bisher.
  if (exterior !== undefined) shell = withExteriorProfile(shell, exterior);
  const cells = facadeCellsOf(shell, volume);
  const depth = cells.filter(({ cell, pos }) => depthCell(cell, pos, volume)).length;
  const notFull = cells.filter(({ pos }) => !isFullBlock(volume.stateAt(pos).name)).length;
  const axes = windowAxes(shell);
  const f4 = longestIdenticalRun(axes);
  const names = new Set(cells.map(({ pos }) => volume.stateAt(pos).name));
  return {
    f1: cells.length === 0 ? 0 : depth / cells.length,
    f2: cells.length === 0 ? 0 : notFull / cells.length,
    f3: blocksPerPatch(cells, volume),
    f4: f4.run,
    facadeCells: cells.length,
    windowAxes: f4.groups,
    distinctBlocks: names.size,
  };
}

/** Zielbänder aus research/58 §4 (für Tests und Berichte). */
/** Ein Zielband (untere/obere Grenze; `Infinity` = nach oben offen). */
export interface FacadeBand {
  readonly min: number;
  readonly max: number;
}

/** Zielbänder der Fassadenkennzahlen F1–F4 (research/58 §4). */
export interface FacadeTargets {
  readonly f1: FacadeBand;
  readonly f2: FacadeBand;
  readonly f3: FacadeBand;
  readonly f4: FacadeBand;
}

export const FACADE_TARGETS: FacadeTargets = {
  f1: { min: 0.25, max: Infinity },
  f2: { min: 0.2, max: 0.35 },
  f3: { min: 6, max: 12 },
  f4: { min: 0, max: 3 },
};

/**
 * P12: **Stilabhängige Zielbänder.** Manche Bautypen können das generische Band bauartbedingt nicht erfüllen –
 * gemessen (25.09.2026, Theme `medieval`, Seed 7): `hobbit` F2 16,6 % (Erdhaus, wenig Vollblockfläche),
 * `watchtower` F2 16,9 % (schmaler Wehrturm), `townhouse` F2 37,6 % und `twostory` F2 41,0 % / F3 12,6
 * (Fachwerk-/Stadthaus mit Läden und Riegeln). Die Profile ändern **nur** die genannten Bänder; alles andere
 * bleibt wie `FACADE_TARGETS`.
 *
 * **Additiv:** Ohne Bautyp/Stil (`facadeTargetMisses(q)`) gilt unverändert die generische Tabelle – kein Profil
 * wirkt, das Ergebnis ist bitgleich. Ein Profil entschärft außerdem **nie** F1 (Tiefe) oder F4
 * (Fensterwiederholung): die bleiben in jedem Stil Pflicht, damit „ohne Regeln" weiter auffällt
 * (`watchtower` ohne Pflichtregeln: F1 18,9 % < 25 %).
 */
export const FACADE_STYLE_TARGETS: Readonly<Record<string, Partial<FacadeTargets>>> = {
  hobbit: { f2: { min: 0.12, max: 0.5 } },
  watchtower: { f2: { min: 0.12, max: 0.5 } },
  townhouse: { f2: { min: 0.2, max: 0.45 } },
  twostory: { f2: { min: 0.2, max: 0.45 }, f3: { min: 6, max: 14 } },
};

/** Zielbänder eines Bautyps (ohne Profil oder ohne Angabe: die generische Tabelle). */
export function facadeTargetsFor(typeId?: string): FacadeTargets {
  const profile = typeId === undefined ? undefined : FACADE_STYLE_TARGETS[typeId];
  return profile === undefined ? FACADE_TARGETS : { ...FACADE_TARGETS, ...profile };
}

/**
 * Verletzte Zielbänder als Klartext (leer = alle im Band). `typeId` wählt ein Stilprofil (P12); ohne Angabe
 * gelten die generischen Bänder wie bisher.
 */
export function facadeTargetMisses(q: FacadeQuality, typeId?: string): string[] {
  const t = facadeTargetsFor(typeId);
  const out: string[] = [];
  const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;
  if (q.f1 < t.f1.min) out.push(`F1 ${pct(q.f1)} < ${pct(t.f1.min)}`);
  if (q.f2 < t.f2.min || q.f2 > t.f2.max) out.push(`F2 ${pct(q.f2)} außerhalb ${pct(t.f2.min)}–${pct(t.f2.max)}`);
  if (q.f3 < t.f3.min || q.f3 > t.f3.max) out.push(`F3 ${q.f3.toFixed(1)} außerhalb ${t.f3.min}–${t.f3.max}`);
  if (q.f4 > t.f4.max) out.push(`F4 ${q.f4} > ${t.f4.max}`);
  return out;
}

/**
 * F4 allein aus der Hülle (ohne Volumen): längste Folge gleicher Fensterachsen auf einer Wandlinie. Dieselbe Rechnung
 * wie `facadeQuality(…).f4`; additiv für die Mehrziel-Vorschläge (`pareto.ts`), die nicht materialisieren.
 */
export function windowRhythm(shell: Shell): number {
  return longestIdenticalRun(windowAxes(shell)).run;
}
