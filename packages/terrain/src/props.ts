/**
 * Katalog-Objekte im Gelände (research/56 §4, Q3 Stufe B): Zonen fordern **Tags** an, ein Platzierungsschritt setzt
 * Komponenten aus dem Komponenten-Katalog über `expandComponent`/`placeComponent` (dieselbe Mechanik wie
 * `@mcda/furnishing` und `@mcda/exterior`). Kein zweiter Streu- oder Wegepfad: der Schritt läuft **nach** der
 * Wegführung und **vor** dem Anlegen der Außenbereiche, damit Ackerland, Beete, Obstbäume und Vegetation die
 * belegten Spalten einfach auslassen.
 *
 * Harte Randbedingungen (research/63 §4.8, Auftrag Q3):
 *  - **Auflage:** alle Spalten eines Objekts liegen auf derselben Geländehöhe `level` (die Zone ist geebnet); die
 *    Komponente steht auf `level + 1`. Nichts schwebt, nichts steckt im Boden.
 *  - **Freihaltung:** Wege (`path`/`route`), Zugänge (`doorDist ≥ 3`), Sperrflächen (`blocked`), Profile,
 *    tiefergelegte Traufstreifen, Wasser und Zonenringe sind tabu. Der Weg-Audit bleibt damit unberührt.
 *  - **Sichtlinie auf Feldern:** Feld-Objekte stehen am Feldrand; die Reihen in der Mitte bleiben frei. Dafür
 *    liefert `propCandidates` für `field` nur die äußere Randzone.
 *  - **Teich/Weg:** Objekte sitzen am **Rand** der Zone (das Wasser bzw. der Weg selbst bleibt frei).
 *  - **Determinismus:** nur Seed und Zonen-ID; kein `Math.random`, keine Zeit.
 *
 * Zonen → Tags, Dichte und Mindestabstand folgen research/56 §3–4; die Dichte ist dort ein Faktor 0–1 und wird
 * hier in eine Objektzahl übersetzt: `Ziel = Zonenfläche × Faktor / 10` (ein Objekt je 10 Zellen bei Faktor 1).
 */
import type { Catalog, ComponentDef } from '@mcda/catalog';
import { HORIZONTAL, Rng, hashSeed, key3, type Cell, type HorizontalDir, type Pose } from '@mcda/core';
import { allowedRotations, expandComponent, pickVariant, placeComponent } from '@mcda/furnishing';
import { C, ZONE_CLASS, type Gen } from './gen.js';
import { DIR_OFFSET } from './grid.js';
import type { ZoneKind } from './model.js';

/**
 * Tags, die eine Zone anfordert (research/56 §4). Die Antwort kommt über `Catalog.byTags`: alle Komponenten, die
 * **mindestens einen** der Tags tragen und in der Zielversion existieren.
 */
export const ZONE_PROP_TAGS: Readonly<Record<ZoneKind, readonly string[]>> = {
  yard: ['yard'],
  garden: ['garden'],
  field: ['field', 'farm'],
  paddock: ['paddock'],
  plaza: ['plaza', 'market'],
  orchard: ['orchard'],
  pond: ['pond'],
  path: ['path'],
  meadow: ['meadow'],
};

/** Dichtefaktor je Zone (research/56 §3, jeweils das untere Ende des Bandes – „belebt, aber begehbar“). */
export const ZONE_PROP_FACTOR: Readonly<Record<ZoneKind, number>> = {
  yard: 0.7,
  garden: 0.4,
  meadow: 0.4,
  field: 0.15,
  paddock: 0.15,
  plaza: 0.4,
  orchard: 0.15,
  path: 0.3,
  pond: 1,
};

/**
 * Ein Platz eines Zonen-Moduls (W3-GA, `decor.kits`): welche Komponente (erste passende der Liste), wo in der Zone
 * (Ecke oder Rand, Rücken zum Zonenrand) und wie viele Exemplare je Zonenfläche.
 */
export interface KitSlot {
  /** Komponenten in Vorzugsreihenfolge; die erste, die in der Zielversion existiert und Platz findet, gilt. */
  readonly ids: readonly string[];
  /** `corner` = Zonenecke (zwei Außenseiten), sonst Rand; `rim` = Zellen am Zonenrand. */
  readonly at: 'corner' | 'rim';
  /** Zonenfläche je Exemplar (fehlt = genau eines). */
  readonly per?: number;
  /** Höchstens so viele Exemplare (Standard 1). */
  readonly max?: number;
  /** Erst ab dieser Zonenfläche (Standard 0). */
  readonly minArea?: number;
}

/**
 * Zonen-Module (W3-GA, Vorbilder im Bericht plan/spikes/W3GA_grundstueck.md): wenige, feste Stücke an Ecken und
 * Rändern statt Dichte über die Fläche.
 *  - **Hofecke:** Holzstapel und Fässer in den Hofecken abseits der Wegachse, ab 90 Zellen ein Handkarren am Rand;
 *    je 160 Zellen Hof ein weiteres Paar (Burghof), höchstens drei.
 *  - **Gartenecke:** ein Bienenstock, ab 80 Zellen ein Komposter in der anderen Ecke.
 *  - **Platz:** eine Bank am Rand (je 40 Zellen, höchstens zwei) – Laternen hat der Platz an den Ecken selbst.
 *  - **Obstgarten:** ein Bienenstock am Rand. **Feld:** ab 120 Zellen ein Komposter und ein Heuhaufen in zwei Ecken,
 *    ab 160 Zellen ein Handkarren am Rand (W9-G3).
 *  - **Teich:** ein Steg bzw. Uferstück. Koppel, Weg und Wiese bekommen nichts (Tränke und Heu setzt die Koppel selbst).
 */
export const ZONE_KITS: Readonly<Record<ZoneKind, readonly KitSlot[]>> = {
  yard: [
    { ids: ['outdoor/woodpile_yard'], at: 'corner', per: 160, max: 3 },
    { ids: ['outdoor/barrel_cluster', 'outdoor/crate_cluster'], at: 'corner', per: 160, max: 3 },
    { ids: ['outdoor/handcart'], at: 'rim', minArea: 90, per: 320, max: 2 },
  ],
  garden: [
    { ids: ['outdoor/beehive_garden'], at: 'corner' },
    { ids: ['outdoor/composter_corner'], at: 'corner', minArea: 80 },
  ],
  plaza: [{ ids: ['outdoor/bench_planter'], at: 'rim', per: 40, max: 2 }],
  orchard: [{ ids: ['outdoor/beehive_garden'], at: 'rim' }],
  // W9-G3 (27.09.2026, Review R5 G3 „Hof-Details“): Komposter UND Heuhaufen in je einer Feldecke (vorher nur der
  // erste der Liste, der Heuhaufen kam nie), ab 160 Zellen ein Handkarren am Feldrand (Wagenschuppen/Karren am Feld,
  // Historic England „Farmstead character“; Minecraft-Hofdeko: Heu, Komposter, Karren – exitlag.com/blog/minecraft-barn)
  field: [
    { ids: ['outdoor/composter_corner'], at: 'corner', minArea: 120 },
    { ids: ['outdoor/hay_pile'], at: 'corner', minArea: 120 },
    { ids: ['outdoor/handcart'], at: 'rim', minArea: 160 },
  ],
  pond: [{ ids: ['outdoor/dock', 'outdoor/pond_edge'], at: 'rim' }],
  paddock: [],
  path: [],
  meadow: [],
};

/** Ein gesetztes Katalog-Objekt im Gelände (Platzierung für die Materialisierung). */
export interface OutdoorPlacement {
  readonly id: string;
  readonly componentId: string;
  readonly variantId?: string;
  readonly pose: Pose;
  readonly seed: number;
  readonly zoneId: string;
  readonly zoneKind: ZoneKind;
  /** Ankerspalte (Ecke der transformierten Box) – für Berichte und Prüfungen. */
  readonly cell: Cell;
}

export interface PropOptions {
  readonly catalog: Catalog;
  /** Zielversion als DataVersion (`availableIn`); fehlt sie, wird die Version nicht gefiltert. */
  readonly dataVersion?: number | undefined;
}

/** Eine Zone, für die Objekte gesetzt werden (aus `generateSite`: Zellmenge + geebnete Höhe). */
export interface PropZone {
  readonly zoneId: string;
  readonly kind: ZoneKind;
  readonly cells: readonly number[];
  /**
   * Spalten, die frei bleiben müssen, obwohl sie in der Zone liegen: Zaun-/Heckenring, Tordurchfahrt,
   * schon geplante Gartenwege. Sie werden weder belegt noch überbaut.
   */
  readonly keepOut?: readonly number[];
  /** Dichtefaktor (0–1) statt des Zonenstandards – für den Landschafts-Pass der freien Wiese. */
  readonly factor?: number;
  /** Tags der Katalog-Abfrage (fehlt = die Tags der Zonenart aus `ZONE_PROP_TAGS`). */
  readonly tags?: readonly string[];
  /** Nur diese Komponenten-IDs zulassen (Landschafts-Pass eines Stils); fehlt = alle zum Tag passenden. */
  readonly only?: readonly string[];
  /** Bevorzugte Tags im Pool (Gewicht 4 statt 1) – z. B. Fels im Hügelland, Blumen auf der Wiese. */
  readonly prefer?: readonly string[];
  /**
   * `cells` sind schon die Kandidatenfläche (freie Landschaft, kein Zonenbereich): die Prüfung auf die
   * Spaltenklasse der Zonenart entfällt.
   */
  readonly direct?: boolean;
  /**
   * Die Zonenfläche darf von der Komponente **überdeckt** werden (Anker bleibt der Rand). Für den Teich: Steg,
   * kleine Brücke und Teichrandstück liegen absichtlich auf dem Wasser; das Wasser entsteht erst danach.
   */
  readonly overZone?: boolean;
  /** Feste Module statt Dichte (W3-GA, `ZONE_KITS`); fehlt = Streuung nach Faktor wie bisher. */
  readonly kit?: readonly KitSlot[];
}

/** Laub (dämpft Licht) und Lichtquellen unter den Materialnamen der Komponenten. */
const LEAF_MATERIAL = /(^|_)(leaves|azalea_leaves)(_|$)|leaves_/;
const LIGHT_MATERIAL = /lantern|torch|campfire|glowstone|sea_lantern|shroomlight|light_hanging|light_outdoor|light_hidden/;

/** Spalte frei für ein Katalog-Objekt? (Wege, Zugänge, Sperrflächen, Profile bleiben frei.) */
export function freeColumn(g: Gen, i: number): boolean {
  return g.blocked[i] === 0 && g.path[i] === 0 && g.route[i] === 0 && g.plantCol[i] === 0 && g.struct[i] === 0
    && g.profile[i] === 0 && g.lowered[i] === 0 && g.water[i] === 0 && g.ring[i] === 0 && g.doorDist[i]! >= 3;
}

/** Wie `freeColumn`, aber Wegspalten sind erlaubt (Torbogen über dem Weg; Zugänge und Sperrflächen bleiben tabu). */
export function freeColumnOverPath(g: Gen, i: number): boolean {
  return g.blocked[i] === 0 && g.plantCol[i] === 0 && g.struct[i] === 0
    && g.profile[i] === 0 && g.lowered[i] === 0 && g.water[i] === 0 && g.ring[i] === 0 && g.doorDist[i]! >= 3;
}

/**
 * Kandidatenzellen einer Zone. Teich und Weg bekommen nur ihren **Rand** (das Wasser bzw. der Weg selbst bleibt
 * frei), das **Feld** nur seine äußere Randzone (Sichtlinie über die Reihen, research/56 §3), alle übrigen Zonen
 * ihre Fläche. Wege, Zugänge und Sperrflächen bleiben frei.
 */
export function propCandidates(g: Gen, z: PropZone): number[] {
  const out: number[] = [];
  const keep = new Set(z.keepOut ?? []);
  const inZone = new Set(z.cells);
  const free = (i: number): boolean => !keep.has(i) && freeColumn(g, i);
  const rim = z.kind === 'pond' || z.kind === 'path';
  if (rim) {
    const rim: number[] = [];
    for (const j of [...new Set(z.cells.flatMap((i) => g.grid.n4(i)))].sort((a, b) => a - b)) {
      if (inZone.has(j)) continue;
      if (g.cls[j] !== C.meadow && g.cls[j] !== C.pad) continue;
      if (free(j)) rim.push(j);
    }
    out.push(...rim);
    // Zweiter Ring: erst damit finden Uferstücke (3×1) und Stege (2×4) am schmalen Ufer Platz. Auf dem Wasser
    // bleibt alles frei – dort würde Sand fallen bzw. Stein schweben (X1).
    const seen = new Set(rim);
    for (const j of rim) {
      for (const k of g.grid.n4(j)) {
        if (inZone.has(k) || seen.has(k)) continue;
        if (g.cls[k] !== C.meadow && g.cls[k] !== C.pad) continue;
        if (free(k)) out.push(k);
      }
    }
    return out;
  }
  const cls = ZONE_CLASS[z.kind];
  const body = z.cells.filter((i) => free(i) && (z.direct === true || g.cls[i] === cls));
  if (z.kind !== 'field' || body.length === 0) return body;
  // Feld: nur die Randzone. Der Zaunring selbst ist tabu (dort setzt `buildRing` Pfosten und Tore), und die
  // Sicht über die Reihen bleibt frei (research/56 §3) – Kandidaten sind die zwei inneren Zellen am Feldrand.
  const part = new Set(z.cells);
  const isRing = (i: number): boolean => g.grid.n4(i).length < 4 || g.grid.n4(i).some((j) => !part.has(j));
  const interior = body.filter((i) => !isRing(i));
  if (interior.length < 2) return body; // zu klein für einen Ring (dann baut `fieldGeometry` auch keinen)
  const inner = new Set(interior);
  const edge = new Set(interior.filter((i) => g.grid.n4(i).some((j) => !inner.has(j))));
  const near = new Set(edge);
  for (const i of edge) for (const j of g.grid.n4(i)) if (inner.has(j)) near.add(j);
  return body.filter((i) => near.has(i));
}

/**
 * Setzt Katalog-Objekte einer Zone. Liefert die Platzierungen und sperrt die belegten Spalten (`blocked`,
 * `plantCol`, `propCol`), damit Wege, Ackerland, Beete und Vegetation sie auslassen.
 */
export function placeZoneProps(g: Gen, z: PropZone, options: PropOptions): OutdoorPlacement[] {
  if (z.kit !== undefined) return placeKit(g, z, z.kit, options);
  const pool = options.catalog.byTags(z.tags ?? ZONE_PROP_TAGS[z.kind], options.dataVersion).filter((d) => d.mount === 'floor');
  const defs = z.only === undefined ? pool : pool.filter((d) => z.only!.includes(d.id));
  if (defs.length === 0 || z.cells.length === 0) return [];
  // Zielzahl = Fläche × Faktor / 10. Der gebrochene Rest wird gewürfelt, damit auch kleine Zonen statistisch
  // richtig dicht sind (sonst erzwänge ein Mindestobjekt je Zone eine viel zu hohe Rate je 100 Zellen).
  const exact = (z.cells.length * (z.factor ?? ZONE_PROP_FACTOR[z.kind])) / 10;
  const target = Math.floor(exact) + (rngChance(g, z, exact - Math.floor(exact)) ? 1 : 0);
  const candidates = propCandidates(g, z);
  if (candidates.length === 0 || target <= 0) return [];
  const rng = new Rng(hashSeed(g.seed, 'props', z.zoneId, z.kind));
  const allowed = new Set(candidates);
  if (z.overZone === true) for (const i of z.cells) allowed.add(i);
  const weight = (d: ComponentDef): number => (z.prefer !== undefined && d.tags.some((t) => z.prefer!.includes(t)) ? 4 : 1);
  const out: OutdoorPlacement[] = [];
  for (const c of rng.shuffle(candidates)) {
    if (out.length >= target) break;
    if (!freeColumn(g, c)) continue;
    // Wenige Versuche je Kandidat: Art + Variante + Drehung werden gewürfelt, Fehlversuche kosten nichts.
    // Am schmalen Uferrand (Teich, Weg) werden alle erlaubten Drehungen durchprobiert – dort passt meist nur eine.
    const narrow = z.kind === 'pond' || z.kind === 'path';
    for (let attempt = 0; attempt < 4; attempt++) {
      const def = rng.weighted(defs, weight);
      const variantId = pickVariant(def, rng)?.id;
      const rots = narrow ? [...allowedRotations(def)] : [rng.pick(allowedRotations(def))];
      if (rots.some((rot) => tryPlace(g, z, c, def, variantId, rot, allowed, out))) break;
    }
  }
  return out;
}

/** Anker so legen, dass die Kandidatenzelle etwa die Mitte der Box ist (kein Zug zur Ecke). */
function centered(g: Gen, c: number, w: number, d: number): readonly [number, number] {
  return [g.grid.x(c) - Math.floor((w - 1) / 2), g.grid.z(c) - Math.floor((d - 1) / 2)];
}

/**
 * Ein Platzierungsversuch auf der Geländehöhe der Kandidatenzelle: Anker legen (Standard: Kandidat etwa in der Mitte
 * der Box), Zellen prüfen, Spalten sperren. Bei Erfolg hängt die Platzierung an `out`.
 */
export function tryPlace(
  g: Gen, z: PropZone, c: number, def: ComponentDef, variantId: string | undefined, rot: Pose['rot'], allowedSet: ReadonlySet<number>,
  out: OutdoorPlacement[], anchor: (w: number, d: number) => readonly [number, number] = (w, d) => centered(g, c, w, d),
  overPath = false,
): boolean {
  const level = g.top[c]!;
  const exp = expandComponent(def, variantId);
  const w = rot % 2 === 0 ? exp.size[0] : exp.size[2];
  const d = rot % 2 === 0 ? exp.size[2] : exp.size[0];
  const [x0, z0] = anchor(w, d);
  const pose: Pose = { pos: [x0, level + 1, z0], rot, mirror: 'none' };
  const placed = placeComponent(exp, pose);
  // Auflage: jede Spalte der Komponente steht auf derselben Geländehöhe; die Luft-Maske muss frei bleiben.
  for (const p of placed.air) {
    const i = g.grid.at(p[0], p[2]);
    if (i < 0 || g.top[i] !== level || g.out.has(key3(p)) || g.building.occupied.has(key3(p))) return false;
  }
  const cols = new Set<number>();
  for (const cell of placed.cells) {
    const i = g.grid.at(cell.pos[0], cell.pos[2]);
    if (i < 0 || !allowedSet.has(i) || !(overPath ? freeColumnOverPath(g, i) : freeColumn(g, i)) || g.top[i] !== level) return false;
    if (g.out.has(key3(cell.pos)) || g.building.occupied.has(key3(cell.pos))) return false;
    cols.add(i);
  }
  if (cols.size === 0) return false;
  for (const i of cols) {
    // Über dem Weg (Torbogen) bleibt die Wegspalte selbst unberührt: Weg, Audit und Bodenbelag laufen wie bisher
    if (overPath && (g.path[i] === 1 || g.route[i] === 1)) continue;
    g.blocked[i] = 1;
    g.plantCol[i] = 1;
    g.propCol[i] = 1;
  }
  // Licht-Pass (Q3): die Zellen des Objekts sind für das Gelände sonst unsichtbar – hier mit Opazität und
  // eigener Lichtabgabe eintragen, sonst hielte der Pass Stellen für beleuchtet, die das Objekt verschattet.
  const emitLight = def.light === 'auto' ? 15 : typeof def.light === 'number' ? def.light : 0;
  for (const cell of placed.cells) {
    const name = cell.mat.block ?? cell.mat.role ?? '';
    const op: 0 | 1 | 2 = LEAF_MATERIAL.test(name) ? 2 : 1;
    const light = emitLight > 0 && LIGHT_MATERIAL.test(name) ? emitLight : 0;
    const k = key3(cell.pos);
    const prev = g.propCells.get(k);
    if (prev === undefined || light > prev.light) g.propCells.set(k, { op: prev !== undefined && prev.op > op ? prev.op : op, light: Math.max(prev?.light ?? 0, light) });
  }
  const n = out.length;
  out.push({
    id: `q3:${z.zoneId}:${n}`,
    componentId: def.id,
    ...(variantId !== undefined ? { variantId } : {}),
    pose,
    seed: hashSeed(g.seed, 'prop', z.zoneId, n),
    zoneId: z.zoneId,
    zoneKind: z.kind,
    cell: [x0, z0],
  });
  return true;
}

/**
 * Zonen-Modul setzen (W3-GA): je Platz der Liste die geforderte Zahl Exemplare an Ecken bzw. am Rand der Zone,
 * **Rücken zum Zonenrand** (Hecke, Zaun, Hauswand oder offene Wiese), abseits des Weges (weiteste Randzelle zuerst),
 * Exemplare derselben Zone mindestens 5 auseinander. Deterministisch (Seed + Zonen-ID).
 */
function placeKit(g: Gen, z: PropZone, kit: readonly KitSlot[], options: PropOptions): OutdoorPlacement[] {
  const out: OutdoorPlacement[] = [];
  const candidates = propCandidates(g, z);
  if (candidates.length === 0) return out;
  const { grid } = g;
  const allowed = new Set(candidates);
  if (z.overZone === true) for (const i of z.cells) allowed.add(i);
  const zone = new Set(z.cells);
  const keep = new Set(z.keepOut ?? []);
  // Teich und Weg: Kandidaten liegen AUSSERHALB der Zone (Ufer, Wegrand) – der Rücken zeigt zur Wiese, weg vom Wasser
  const shore = z.kind === 'pond' || z.kind === 'path';
  /** Richtungen, in denen die Zone endet (Nachbar außerhalb, auf dem Ring oder am Grundstücksrand). */
  const outside = (i: number): HorizontalDir[] => HORIZONTAL.filter((dir) => {
    const j = grid.at(grid.x(i) + DIR_OFFSET[dir][0], grid.z(i) + DIR_OFFSET[dir][1]);
    if (shore) {
      const k = grid.at(grid.x(i) - DIR_OFFSET[dir][0], grid.z(i) - DIR_OFFSET[dir][1]);
      return k >= 0 && zone.has(k) && (j < 0 || !zone.has(j));
    }
    return j < 0 || !zone.has(j) || keep.has(j);
  });
  const pathCells: number[] = [];
  for (let i = 0; i < grid.size; i++) if (g.path[i] === 1 || g.route[i] === 1) pathCells.push(i);
  const fromPath = grid.distance(pathCells, 8);
  const rng = new Rng(hashSeed(g.seed, 'kit', z.zoneId, z.kind));
  const area = z.cells.length;
  const cheb = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  const spots: Array<readonly [number, number]> = [];
  const rim = candidates.filter((i) => outside(i).length >= 1).sort((a, b) => a - b);
  const isCorner = (i: number): boolean => {
    const o = outside(i);
    return o.some((a) => o.some((b) => (DIR_OFFSET[a][0] === 0) !== (DIR_OFFSET[b][0] === 0)));
  };
  for (const slot of kit) {
    if (area < (slot.minArea ?? 0)) continue;
    const want = Math.min(slot.max ?? 1, slot.per === undefined ? 1 : Math.max(1, Math.floor(area / slot.per)));
    const defs = options.catalog.byTags(['outdoor'], options.dataVersion).filter((d) => slot.ids.includes(d.id) && d.mount === 'floor')
      .sort((a, b) => slot.ids.indexOf(a.id) - slot.ids.indexOf(b.id));
    if (defs.length === 0) continue;
    // Ecken zuerst (beim Eckplatz), sonst weiteste Randzelle vom Weg; Gleichstand per Seed gemischt
    const order = rng.shuffle(rim).sort((a, b) => (slot.at === 'corner' ? Number(isCorner(b)) - Number(isCorner(a)) : 0) || fromPath[b]! - fromPath[a]!);
    let placedHere = 0;
    for (const c of order) {
      if (placedHere >= want) break;
      if (!freeColumn(g, c) || spots.some((s) => cheb(s, [grid.x(c), grid.z(c)]) < 5)) continue;
      let ok = false;
      // Ufer/Wegrand: Steg und Uferstück liegen quer zum Wasser – alle Drehungen um die Randzelle probieren (wie bisher)
      if (shore) {
        for (const def of defs) {
          const variantId = pickVariant(def, rng)?.id;
          ok = allowedRotations(def).some((rot) => tryPlace(g, z, c, def, variantId, rot, allowed, out));
          if (ok) break;
        }
      }
      for (const back of shore ? [] : outside(c)) {
        const rot = HORIZONTAL.indexOf(back) as Pose['rot'];
        for (const def of defs) {
          if (!allowedRotations(def).includes(rot)) continue;
          const variantId = pickVariant(def, rng)?.id;
          ok = tryPlace(g, z, c, def, variantId, rot, allowed, out, (w, d) => backAnchor(g, c, back, w, d));
          if (ok) break;
        }
        if (ok) break;
      }
      if (ok) {
        spots.push([grid.x(c), grid.z(c)]);
        placedHere++;
      }
    }
  }
  return out;
}

/** Box so legen, dass ihre Rückseite (`back`) auf der Zelle `c` liegt, quer mittig. */
export function backAnchor(g: Gen, c: number, back: HorizontalDir, w: number, d: number): readonly [number, number] {
  const cx = g.grid.x(c);
  const cz = g.grid.z(c);
  switch (back) {
    case 'north': return [cx - Math.floor((w - 1) / 2), cz];
    case 'south': return [cx - Math.floor((w - 1) / 2), cz - (d - 1)];
    case 'west': return [cx, cz - Math.floor((d - 1) / 2)];
    case 'east': return [cx - (w - 1), cz - Math.floor((d - 1) / 2)];
  }
}

/** Deterministischer Münzwurf für den gebrochenen Zielanteil einer Zone. */
function rngChance(g: Gen, z: PropZone, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return new Rng(hashSeed(g.seed, 'props-frac', z.zoneId, z.kind)).chance(p);
}

/** Alle Zonen abarbeiten (deterministisch nach Zonen-ID, dann nach erster Zelle). */
export function placeOutdoorProps(g: Gen, zones: readonly PropZone[], options: PropOptions): OutdoorPlacement[] {
  const out: OutdoorPlacement[] = [];
  for (const z of [...zones].sort((a, b) => a.zoneId.localeCompare(b.zoneId) || a.cells[0]! - b.cells[0]!)) {
    out.push(...placeZoneProps(g, z, options));
  }
  return out;
}
