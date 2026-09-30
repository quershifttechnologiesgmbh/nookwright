/**
 * Lageplan außen: was um das Gebäude belegt, frei oder freizuhalten ist, und das atomare Setzen von Komponenten.
 *
 * - Belegt: jede Hüllzelle (Wände, Dach, Außenprofil `facade` …) und jede schon gesetzte Außen-Komponente.
 * - Innen: Spalte eines Grundrisses von der tiefsten Bodenplatte bis zur obersten Hüllzelle (wie blueprint/anchors:
 *   Dachraum zählt mit, Luft unter Überstand/Auskragung nicht). Außen-Komponenten liegen nur in Außenluft.
 * - Freihalten: `walk` = Laufweg vor Außentüren (Zelle + 1 Block davor, 2 hoch) – dort nie ein Block;
 *   `view` = Zelle vor einer Fensterscheibe – dort höchstens eine niedrige, durchsichtige Pflanze ohne Kollision.
 * Eine Gruppe (`commit`) wird ganz oder gar nicht gesetzt (z. B. beide Läden eines Fensters).
 */
import type { RoomShellInfo, Shell, ShellAnchorKind, ShellCell } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { cellKey, hashSeed, key3, rotateDir, transformLocal, type Dir, type HorizontalDir, type Mirror, type Quarter, type Vec3 } from '@mcda/core';
import { expandComponent, formatVariantId, placeComponent, type PlacedComponent } from '@mcda/furnishing';
import type { ExteriorGroup, ExteriorPlacement } from './types.js';

export const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
export const OPP: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'south', south: 'north', east: 'west', west: 'east' };
/** Laufrichtung einer Wand mit Außenseite `out` (wie die Anker-Spannen: +x bzw. +z). */
export const alongOf = (out: HorizontalDir): HorizontalDir => (out === 'north' || out === 'south' ? 'east' : 'south');
export const step = (p: Vec3, d: HorizontalDir, k = 1): Vec3 => [p[0] + STEP[d][0] * k, p[1], p[2] + STEP[d][1] * k];
export const up = (p: Vec3, k = 1): Vec3 => [p[0], p[1] + k, p[2]];
/** Drehung, die die kanonische Front (Süden) nach `facing` bringt. */
export const rotFor = (facing: HorizontalDir): Quarter => ({ south: 0, west: 1, north: 2, east: 3 } as const)[facing];
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Wandartige Hüllzellen, an denen Läden, Zaun-Arme und Bänke anliegen. */
const SOLID_WALL: ReadonlySet<ShellCell['kind']> = new Set(['wall', 'pillar', 'lintel']);

/** W4 (F7): Zubehör im Deko-Budget der Fassadenlinie (`withinBudget`). */
const BUDGET_GROUPS: ReadonlySet<ExteriorGroup> = new Set<ExteriorGroup>(['eaveLanterns', 'eaveBraces']);
/**
 * W5 (27.09.2026, Review N3): Gruppen, deren Zellen in der **Traufzone** (direkt unter einer Dachzelle, also im
 * Schatten des Überstands) zur Dachkante gehören, nicht zu den Wandreihen – sie zählen dort weder zum Deko-Budget noch
 * belegen sie eine Spalte (`eaveZone`). Die Traufkonsole ist ein Zahn der Traufe, kein Wand-Zubehör.
 */
const EAVE_ZONE_GROUPS: ReadonlySet<ExteriorGroup> = new Set<ExteriorGroup>(['eaveBraces']);
/**
 * Außenleuchten (Laternen jeder Aufhängung; W7-D: auch die Feuerschalen am Eingang, `exterior/fantasy_brazier`) – für die
 * Regeln „keine zwei Leuchten übereinander“ und „jede Seite mit Fenstern hat Licht“ (`lanternInRow`, `lanternBefore`).
 */
const LIGHTS = /lantern|brazier/;
/** Bänder des Außenprofils (Sockel, Gesims) machen eine Spalte nicht unruhig (Kennzahl F7). */
const BANDS: ReadonlySet<string> = new Set(['wall_plinth', 'foundation', 'wall_cornice']);

/** Fassadenlinie des Rasters mit belegten Spalten (Deko-Budget, W4). */
interface BudgetLine {
  readonly out: HorizontalDir;
  readonly plane: number;
  readonly from: number;
  readonly to: number;
  readonly baseY: number;
  readonly topY: number;
  readonly busy: Set<number>;
}

/** W4 (F8): Gruppen, die auf dem Dach stehen dürfen. */
const ROOF_GROUPS: ReadonlySet<ExteriorGroup> = new Set<ExteriorGroup>(['chimneys', 'ridgeDecor']);

/** Niedrige Pflanzen ohne Kollision, die vor einer Scheibe stehen dürfen (Blumenkasten). */
const SEE_THROUGH = /^minecraft:(poppy|dandelion|cornflower|azure_bluet|allium|oxeye_daisy|lily_of_the_valley|(red|orange|white|pink)_tulip|fern|short_grass)$/;

export interface Level {
  readonly index: number;
  readonly y0: number;
  readonly baseY: number;
  readonly topY: number;
}

type Reservation = 'walk' | 'view';

/** Ein Teil einer Gruppe: Komponente, deren lokale Zelle `local` auf `at` liegt; Front = `facing`. */
export interface Part {
  readonly componentId: string;
  readonly variantId?: string;
  /** Dehnung (Varianten-ID `<variante>~n`). */
  readonly stretch?: number;
  readonly facing: HorizontalDir;
  readonly mirror?: Mirror;
  readonly local?: Vec3;
  readonly at: Vec3;
}

export class ExteriorSite {
  readonly levels: ReadonlyMap<number, Level>;
  /** Unterste Bodenplatte des Gebäudes (Grundhöhe). */
  readonly y0: number;
  private readonly byPos = new Map<string, ShellCell>();
  private readonly colTop = new Map<string, number>();
  private readonly bottom = new Map<string, number>();
  /** W4 (F8): unterste Dachzelle je Spalte – Außen-Deko darüber läge auf einem Dach. */
  private readonly roofLow = new Map<string, number>();
  private readonly taken = new Map<string, string>();
  private readonly reserved = new Map<string, Reservation>();
  readonly placements: ExteriorPlacement[] = [];
  /**
   * W2-FW (F7 „je Pfosten höchstens 1 Zubehör“): Pfosten mit einer Fensterlaterne, Schlüssel `<außen>|<wandebene>|<spalte>`
   * (Spalte = x bei Nord/Süd, z bei Ost/West) – dort hängt keine zweite Laterne unter der Traufe.
   */
  readonly litPosts = new Set<string>();
  /** W2-FW: Seiten (`<außen>|<wandebene>`) mit Fensterlaternen – dort entfällt der Traufenlaternen-Takt an den Pfosten. */
  readonly litSides = new Set<string>();
  /** Räume je Etagenindex (für `levelOf` mit Baukörpern). */
  private readonly roomsByFloor = new Map<number, RoomShellInfo[]>();
  /** W4 (F7): Fassadenlinien des Rasters mit ihren belegten Spalten (Deko-Budget). */
  private readonly lines: BudgetLine[] = [];
  /** Spalten der Anbau-Grundrisse (`Shell.annexes`, dort steht ein angedockter Turm): nie Außenluft. */
  private readonly annexCols = new Set<string>();

  constructor(
    readonly shell: Shell,
    private readonly catalog: Catalog,
    private readonly seed: number,
  ) {
    // Kellergeschosse zählen für „innen“ nur unter dem Grundriss darüber (feat/underground: ein Unterbau neben dem Haus
    // liegt im Erdreich – mit einem Dachüberstand darüber galt sonst die ganze Spalte vor der Haustür als Gebäude).
    // Heute liegt jeder Keller unter dem Erdgeschoss: bitgleich.
    const cellar = new Set([...shell.rooms.values()].filter((r) => r.floorIndex < 0).map((r) => r.roomId));
    // Maßgeblich ist das Erdgeschoss (tiefste Etage ≥ 0): unter einer Auskragung (W9-G1) liegt Außenluft (W9-Integration)
    const groundIndex = Math.min(...[...shell.rooms.values()].filter((r) => r.floorIndex >= 0).map((r) => r.floorIndex));
    const ground = new Set([...shell.rooms.values()].filter((r) => r.floorIndex === groundIndex).map((r) => r.roomId));
    const upper = new Set(shell.cells.filter((c) => c.kind === 'floor' && ground.has(c.roomId ?? '')).map((c) => cellKey(c.pos[0], c.pos[2])));
    for (const c of shell.cells) {
      const k = key3(c.pos);
      if (!this.byPos.has(k)) this.byPos.set(k, c);
      const ck = cellKey(c.pos[0], c.pos[2]);
      this.colTop.set(ck, Math.max(this.colTop.get(ck) ?? -Infinity, c.pos[1]));
      if (c.kind === 'floor' && (!cellar.has(c.roomId ?? '') || upper.has(ck))) this.bottom.set(ck, Math.min(this.bottom.get(ck) ?? Infinity, c.pos[1]));
      if (c.kind === 'roof') this.roofLow.set(ck, Math.min(this.roofLow.get(ck) ?? Infinity, c.pos[1]));
    }
    for (const a of shell.annexes ?? []) for (const [x, z] of a.footprint) this.annexCols.add(cellKey(x, z));
    const levels = new Map<number, Level>();
    for (const r of shell.rooms.values()) {
      const list = this.roomsByFloor.get(r.floorIndex);
      if (list === undefined) this.roomsByFloor.set(r.floorIndex, [r]);
      else list.push(r);
      if (!levels.has(r.floorIndex)) levels.set(r.floorIndex, { index: r.floorIndex, y0: r.baseY - 1, baseY: r.baseY, topY: r.baseY - 1 + r.height });
    }
    this.levels = levels;
    this.y0 = Math.min(...[...levels.values()].filter((l) => l.index >= 0).map((l) => l.y0), Infinity);
    // W4 (F7): Linien des Fassadenrasters mit Wandreihen; belegt ist eine Spalte, sobald vor ihr in einer Wandreihe etwas
    // steht (Außenprofil ohne Bänder, später jede Außen-Komponente) – wie die Kennzahl „ruhige Spalten“
    for (const g of shell.facadeGrid ?? []) {
      const rooms = [...shell.rooms.values()].filter((r) => r.baseY === g.y0 + 1);
      if (rooms.length === 0) continue;
      this.lines.push({ out: g.out, plane: g.plane, from: g.from, to: g.to, baseY: g.y0 + 1, topY: g.y0 + Math.max(...rooms.map((r) => r.height)), busy: new Set() });
    }
    for (const c of shell.cells) if (c.kind === 'facade' && !BANDS.has(c.role)) this.markBusy(c.pos);
  }

  at(p: Vec3): ShellCell | undefined {
    return this.byPos.get(key3(p));
  }

  /** Oberste Hüllzelle der Spalte (−∞ ohne Hülle). */
  top(x: number, z: number): number {
    return this.colTop.get(cellKey(x, z)) ?? -Infinity;
  }

  /** Außenluft: keine Hüllzelle, nicht im Gebäudeinneren und nicht im Grundriss eines Anbaus (Turm). */
  outside(p: Vec3): boolean {
    if (this.byPos.has(key3(p))) return false;
    const ck = cellKey(p[0], p[2]);
    if (this.annexCols.has(ck)) return false;
    const b = this.bottom.get(ck);
    return b === undefined || p[1] < b || p[1] > this.colTop.get(ck)!;
  }

  /**
   * W4 (27.09.2026, Baustandard F8, Review S4): liegt in der Spalte unter `p` eine Dachzelle (eigenes Dach oder das
   * eines anderen Baukörpers, z. B. Palasdach vor dem Bergfried)? Dort steht keine Außen-Deko außer Schornstein und
   * Firstschmuck (`ROOF_GROUPS`) – K6 galt bisher nur für Hüllzellen.
   */
  overRoof(p: Vec3): boolean {
    return (this.roofLow.get(cellKey(p[0], p[2])) ?? Infinity) < p[1];
  }

  /**
   * W5 (27.09.2026, Review N3): Traufzone – die Zelle liegt direkt unter einer Dachzelle (Überstand vor der Wand). Dort
   * zählen Stücke der Dachkante (`EAVE_ZONE_GROUPS`, Traufkonsolen) nicht als Zubehör der Wandreihen.
   */
  eaveZone(p: Vec3): boolean {
    return this.at(up(p))?.kind === 'roof';
  }

  /** Linien des Rasters, vor deren Wandreihen `p` liegt (Spalte = Laufkoordinate). */
  private linesAt(p: Vec3): { line: BudgetLine; col: number }[] {
    const out: { line: BudgetLine; col: number }[] = [];
    for (const line of this.lines) {
      const ns = line.out === 'north' || line.out === 'south';
      const front = line.plane + (ns ? STEP[line.out][1] : STEP[line.out][0]);
      const col = ns ? p[0] : p[2];
      if ((ns ? p[2] : p[0]) === front && col >= line.from && col <= line.to && p[1] >= line.baseY && p[1] <= line.topY) out.push({ line, col });
    }
    return out;
  }

  private markBusy(p: Vec3): void {
    for (const { line, col } of this.linesAt(p)) line.busy.add(col);
  }

  /**
   * W4 (27.09.2026, Review S4, Baustandard F7 „ruhige Spalten ≥ 50 %“): **Deko-Budget je Fassadenlinie.** Module
   * (ganze Linie, F6), Eingang und Außenprofil kommen zuerst; Zubehör (`BUDGET_GROUPS`: Fenster-, Pfosten- und
   * Traufenlaternen, Traufkonsolen, Akzente) nur, solange höchstens die Hälfte der Spalten einer Linie belegt ist. Die
   * Planer setzen Zubehör von der Mitte nach außen – das Budget streicht also außen zuerst; eine Linie, die schon durch
   * ihre Fenstermodule voll ist, bleibt ohne Laternen und Konsolen in den Wandreihen (ruhig statt überladen).
   * W5 (Review N3): Traufkonsolen in der Traufzone (`eaveZone`) übergibt `commit` nicht – sie zählen nicht.
   */
  withinBudget(cells: readonly Vec3[]): boolean {
    const extra = new Map<BudgetLine, Set<number>>();
    for (const c of cells) {
      for (const { line, col } of this.linesAt(c)) {
        if (line.busy.has(col)) continue;
        (extra.get(line) ?? extra.set(line, new Set()).get(line)!).add(col);
      }
    }
    for (const [line, cols] of extra) if (line.busy.size + cols.size > Math.floor((line.to - line.from + 1) / 2)) return false;
    return true;
  }

  /**
   * W5 (27.09.2026, Review W4-R N9, Baustandard F7 „je Pfosten höchstens 1 Zubehör“): hängt in der Fluchtreihe vor einer
   * Wand (Koordinate `axis` = `value`, also x = … vor einer West-/Ostwand, z = … vor einer Nord-/Südwand) zwischen `y0` und
   * `y1` schon eine Laterne, die nicht an einer Hausecke hängt (Fenster-, Eingangs-, Pfosten- oder Traufenlaterne)? In der
   * Ansicht der Nachbarfassade liegt diese Reihe auf der Gebäudekante – eine Ecklaterne dazu hinge optisch übereinander.
   */
  lanternInRow(axis: 0 | 2, value: number, y0: number, y1: number): boolean {
    return this.placements.some((pl) => pl.anchor !== 'corner' && LIGHTS.test(`${pl.componentId} ${pl.variantId ?? ''}`)
      && pl.cells.some((c) => c[axis] === value && c[1] >= y0 && c[1] <= y1));
  }

  /**
   * W6 (27.09.2026, Review W4-R R2 „jede Fassadenseite mit Fenstern ≥ 1 Außenlaterne“): hängt vor der Wand mit Außenseite
   * `out` in der Wandebene `plane` (1–2 Reihen davor, Laufkoordinate `from` … `to`) schon eine Laterne, die nicht an
   * einer Hausecke hängt (Eingangs-, Fenster-, Pfosten- oder Traufenlaterne)?
   */
  lanternBefore(out: HorizontalDir, plane: number, from: number, to: number): boolean {
    const ns = out === 'north' || out === 'south';
    const sgn = ns ? STEP[out][1] : STEP[out][0];
    return this.placements.some((pl) => pl.anchor !== 'corner' && LIGHTS.test(`${pl.componentId} ${pl.variantId ?? ''}`)
      && pl.cells.some((c) => {
        const d = ((ns ? c[2] : c[0]) - plane) * sgn;
        const u = ns ? c[0] : c[2];
        return d >= 1 && d <= 2 && u >= from && u <= to;
      }));
  }

  isTaken(p: Vec3): boolean {
    return this.taken.has(key3(p));
  }

  reservation(p: Vec3): Reservation | undefined {
    return this.reserved.get(key3(p));
  }

  reserve(p: Vec3, r: Reservation): void {
    if (this.reserved.get(key3(p)) !== 'walk') this.reserved.set(key3(p), r);
  }

  /** Wandartige Hüllzelle (Wand, Pfosten, Sturz) – kein Fenster, keine Tür. */
  solidWall(p: Vec3): boolean {
    const c = this.at(p);
    return c !== undefined && SOLID_WALL.has(c.kind);
  }

  /**
   * Unterseite der Hüllzelle über `p` trägt eine hängende Laterne (volle Fläche: Block, untere Treppe/Stufe; T5).
   * Obere Stufen/Treppen und Profilkonsolen tragen nicht.
   */
  hangsFrom(p: Vec3): boolean {
    const c = this.at(up(p));
    if (c === undefined || (c.kind !== 'roof' && c.kind !== 'ceiling')) return false;
    if (c.shape === 'stairs' || c.shape === 'slab') return c.orient?.half !== 'top';
    return c.shape === 'block' || c.shape === 'planks';
  }

  /**
   * Etage `floorIndex` – mit `near` die des nächstgelegenen Raums dieser Etage (Baukörper, V0: am Hang oder mit
   * eigenen lichten Höhen liegen gleiche Etagenindizes auf verschiedenen Höhen). Ohne Baukörper überall gleich.
   */
  levelOf(floorIndex: number, near?: Vec3): Level | undefined {
    const rooms = this.roomsByFloor.get(floorIndex);
    if (near === undefined || rooms === undefined || rooms.length < 2) return this.levels.get(floorIndex);
    let best: RoomShellInfo | undefined;
    let bestD = Infinity;
    for (const r of rooms) {
      const b = r.interior.bounds();
      if (b === undefined) continue;
      const d = Math.max(0, b.minX - near[0], near[0] - b.maxX) + Math.max(0, b.minZ - near[2], near[2] - b.maxZ);
      if (d < bestD) [best, bestD] = [r, d];
    }
    return best === undefined ? this.levels.get(floorIndex) : { index: floorIndex, y0: best.baseY - 1, baseY: best.baseY, topY: best.baseY - 1 + best.height };
  }

  /** Teil → platzierte Komponente (Pose so, dass `local` auf `at` liegt). */
  placed(part: Part): PlacedComponent {
    const def = this.catalog.get(part.componentId);
    const variantId = part.stretch !== undefined && part.stretch > 0 ? formatVariantId(part.variantId, part.stretch) : part.variantId;
    const exp = expandComponent(def, variantId);
    const rot = rotFor(part.facing);
    const mirror = part.mirror ?? 'none';
    const t = transformLocal(part.local ?? [0, 0, 0], exp.size, rot, mirror);
    return placeComponent(exp, { pos: [part.at[0] - t[0], part.at[1] - t[1], part.at[2] - t[2]], rot, mirror });
  }

  /**
   * Passt der Teil? Blockzellen in freier Außenluft (vor Scheiben nur durchsichtige Pflanzen), Luftmaske frei; W4 (F8):
   * nie über einer Dachzelle, außer `onRoof` (Schornstein, Firstschmuck).
   */
  fits(p: PlacedComponent, pending: ReadonlySet<string> = new Set(), onRoof = false, viewOk = false): boolean {
    for (const c of p.cells) {
      const k = key3(c.pos);
      if (!this.outside(c.pos) || this.taken.has(k) || pending.has(k)) return false;
      if (!onRoof && this.overRoof(c.pos)) return false;
      const r = this.reserved.get(k);
      if (r === 'walk') return false;
      if (r === 'view' && !viewOk && (c.mat.block === undefined || !SEE_THROUGH.test(c.mat.block))) return false;
    }
    for (const a of p.air) if (!this.outside(a) || this.taken.has(key3(a)) || pending.has(key3(a))) return false;
    return true;
  }

  /**
   * Setzt alle Teile oder keinen. `extra` prüft Zusatzbedingungen (Wand dahinter, Traufe darüber …).
   * Liefert die gesetzten Platzierungen (leer = nicht gesetzt).
   */
  /**
   * `idGroup`: Gruppe in der ID (Standard `group`) – nur für Gruppen, die aus einer anderen hervorgingen (W4-D).
   * W6 (27.09.2026, Review R2): `budget: false` setzt Zubehör vor dem Deko-Budget (nur das Mindestlicht einer Seite,
   * `planWindowLanterns`) – wie Module und Eingang belegt es seine Spalten, zählt aber nicht gegen die Hälfte.
   */
  commit(
    group: ExteriorGroup, anchor: ShellAnchorKind | 'hearth', floorIndex: number, parts: readonly Part[], extra: () => boolean = () => true, idGroup: ExteriorGroup = group,
    opts: { readonly budget?: boolean; readonly roof?: boolean; readonly viewOk?: boolean } = {},
  ): ExteriorPlacement[] {
    if (parts.length === 0 || !extra()) return [];
    const pending = new Set<string>();
    const placed: PlacedComponent[] = [];
    for (const part of parts) {
      const p = this.placed(part);
      // EXT: `roof` (Wetterfahne, Glockentürmchen auf dem First) und `viewOk` (Erker aus Glas vor der Scheibe) nur auf Anforderung
      if (!this.fits(p, pending, ROOF_GROUPS.has(group) || opts.roof === true, opts.viewOk === true)) return [];
      for (const c of p.cells) pending.add(key3(c.pos));
      placed.push(p);
    }
    // W5 (Review N3): Traufkonsolen in der Traufzone gehören zur Dachkante – nicht im Budget, keine belegte Spalte
    const wallRow = (c: Vec3): boolean => !EAVE_ZONE_GROUPS.has(group) || !this.eaveZone(c);
    if (BUDGET_GROUPS.has(group) && opts.budget !== false && !this.withinBudget(placed.flatMap((p) => p.cells.map((c) => c.pos)).filter(wallRow))) return [];
    const out = placed.map((p, i): ExteriorPlacement => {
      const part = parts[i]!;
      const id = `x1:${idGroup}:${part.componentId.slice(part.componentId.indexOf('/') + 1)}@${key3(part.at)}`;
      return {
        id,
        componentId: part.componentId,
        ...(p.expanded.variantId !== undefined ? { variantId: p.expanded.variantId } : {}),
        pose: p.pose,
        seed: hashSeed(this.seed, id),
        group,
        anchor,
        floorIndex,
        cells: p.cells.map((c) => c.pos),
      };
    });
    for (const pl of out) for (const c of pl.cells) {
      this.taken.set(key3(c), pl.id);
      if (wallRow(c)) this.markBusy(c);
    }
    this.placements.push(...out);
    return out;
  }
}

/** Spiegelung, mit der die kanonische Seitenrichtung `canonical` (east/west) unter `facing` nach `want` zeigt. */
export function mirrorFor(facing: HorizontalDir, canonical: 'east' | 'west', want: Dir): Mirror {
  return rotateDir(canonical, rotFor(facing)) === want ? 'none' : 'x';
}

/** Innenstellen 1 … span−2 im Takt `every`, mittig verteilt (spiegelsymmetrisch; wie die Traufkonsolen). */
export function rhythm(span: number, every: number): number[] {
  if (span < 3 || every < 1) return [];
  const m = span - 2;
  const count = Math.floor((m - 1) / every) + 1;
  const start = 1 + Math.floor((m - 1 - (count - 1) * every) / 2);
  return Array.from({ length: count }, (_, i) => start + i * every);
}

/** Wahrscheinlichkeit bei Dichte d: 0 → 0, 1 → base, 2 → 1 (linear dazwischen). */
export function atDensity(base: number, d: number): number {
  return clamp01(d <= 1 ? base * d : base + (1 - base) * (d - 1));
}
