/**
 * Kennzahlen der Landschaft (research/58 §4, Q3): L1–L3 als **reine** Funktionen über Geländezellen,
 * Katalog-Platzierungen und Zonenflächen. Vorbild ist `packages/pipeline/src/quality-f.ts` (Q2): gleiche Welt,
 * gleiche Zahlen, keine Zufallszahlen, kein Theme- und kein Dateizugriff.
 *
 * | # | Kennzahl | Ziel | Messung hier |
 * |---|---|---|---|
 * | L1 | Cluster-Koeffizient der Blumen | ≥ 0,5 | Anteil der Blumen mit mindestens einem Nachbarn **derselben Art** im Chebyshev-Radius 1 (s. `L1_RADIUS`) |
 * | L2 | Katalog-Objekte je 100 Geländezellen, je Zone | Band je Zone (research/56 §3, s. `L2_TARGETS`) | Platzierungen ÷ Geländezellen der Zone × 100 |
 * | L3 | Unterschied der Geländestile | paarweise „deutlich verschieden“ | L1-Distanz der Anteilsvektoren (Fels/Wasser/Baum/Blume) je Stilpaar; Schwelle `L3_MIN_DISTANCE` |
 *
 * **Art einer Blume:** Im Gelände trägt jede Blume eine Theme-Rolle (`flower_wild`/`flower_warm`/`flower_cool`).
 * Die Rolle ist die *grobe* Art – ein Theme löst `flower_wild` je Zelle auf einen von mehreren Blöcken auf
 * (`mix`), und **Platzierungen** aus dem Katalog mischen je *Platzierung*, also je Blumencluster einheitlich.
 * Deshalb liefert `flowerSamples` die Rolle als Art (Gelände-Granularität), während der Mess-Spike
 * (`spikes/q3_landschaft.ts`) zusätzlich die aufgelösten **Blocknamen** als Art misst – das ist die Art, die der
 * Spieler sieht. Beide Werte gehen über dieselbe Funktion `flowerClusterCoefficient`.
 *
 * **Spalte der L3-Messung:** Gezählt wird je Geländespalte die *oberste* Klasse mit der Priorität
 * Wasser > Fels > Baum > Blume; „sonst“ (Gras, Wege, Erde, Gebäude) zählt nicht in den Zähler, aber in den Nenner
 * `columns`. So ist der Anteilsvektor ein Kartenanteil (Draufsicht), kein Volumenanteil – eine große Baumkrone
 * wiegt damit nicht schwerer als eine Blume.
 */
import type { ShellCell } from '@mcda/blueprint';
import { ZONE_KINDS, type ZoneKind } from './model.js';

// ------------------------------------------------------------------------------------------------ L1 Blumen-Cluster

/** Rollen, die im Gelände eine Blume sind (Blütenteppich `ground_cover` zählt nicht als Blume). */
export const FLOWER_ROLES: ReadonlySet<string> = new Set(['flower_wild', 'flower_warm', 'flower_cool']);

/**
 * Nachbarschaftsradius der L1-Messung in Zellen (Chebyshev). **Begründung der Wahl:** Radius 2 (die 24 Zellen
 * im 5×5-Fenster) ist die im Auftrag genannte Obergrenze, aber schon vor Q3 erfüllt – ein Theme löst
 * `flower_wild` je Zelle auf einen von acht Blöcken auf, und unter ~7 Blüten im Fenster ist die Chance auf eine
 * gleiche Art rechnerisch ~0,6 (gemessen 0,59–0,76, s. Bericht). Radius **1** (die acht unmittelbaren
 * Nachbarzellen) misst dagegen den „Fleck“ so, wie er gelesen wird – Blüten, die einander berühren; dort lag
 * der Vorher-Wert bei 0,41–0,52 und hat echte Aussagekraft. Der Mess-Spike gibt beide Radien aus.
 */
export const L1_RADIUS = 1;
/** Ziel aus research/58 §4: Anteil der Blumen mit mindestens einem Nachbarn derselben Art. */
export const L1_TARGET = 0.5;

/** Eine Blume für die L1-Messung: Spalte + Art (Rolle oder aufgelöster Blockname). */
export interface FlowerSample {
  readonly x: number;
  readonly z: number;
  readonly species: string;
}

/** Blumen eines Gelände-Ergebnisses; Art = Theme-Rolle (grobe Granularität, s. Modulkopf). */
export function flowerSamples(cells: readonly ShellCell[]): FlowerSample[] {
  const out: FlowerSample[] = [];
  for (const c of cells) {
    if (!FLOWER_ROLES.has(c.role)) continue;
    out.push({ x: c.pos[0], z: c.pos[2], species: c.role });
  }
  return out;
}

/**
 * L1: Anteil der Blumen, die im Chebyshev-Radius `radius` mindestens eine **andere** Blume derselben Art haben.
 * Auf derselben Spalte stehende Blumen (übereinander) zählen nicht als Nachbar. Ergebnis 0 … 1; ohne Blumen 0
 * („keine Blumen“ erfüllt das Ziel nicht und ist auch kein Cluster).
 */
export function flowerClusterCoefficient(flowers: readonly FlowerSample[], radius: number = L1_RADIUS): number {
  if (flowers.length === 0) return 0;
  const r = Math.max(1, Math.floor(radius));
  const speciesOf = new Map<string, string>();
  for (const f of flowers) speciesOf.set(`${f.x},${f.z}`, f.species);
  let clustered = 0;
  for (const f of flowers) {
    let hit = false;
    for (let dx = -r; dx <= r && !hit; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (speciesOf.get(`${f.x + dx},${f.z + dz}`) === f.species) {
          hit = true;
          break;
        }
      }
    }
    if (hit) clustered++;
  }
  return clustered / flowers.length;
}

// ------------------------------------------------------------------------------------------------ L2 Katalog-Objekte

/**
 * Zielbänder für L2 (Katalog-Objekte je 100 Geländezellen) je Zone. Herleitung aus research/56 §3
 * („Dichte-Obergrenze je Zonentyp“, dort als Faktor 0–1 wie `decor.props`):
 *
 *  - Der Faktor wird als **Anteil eines vollen Budgets von 10 Objekten je 100 Zellen** gelesen (1 Objekt je
 *    10 Zellen). Das ist die kleinste sinnvolle Außendichte: die kleinsten Katalog-Objekte sind 2×2 Zellen groß,
 *    mit Mindestabstand belegt ein Objekt also rund 4–9 Zellen – 10 Objekte je 100 Zellen sind damit die
 *    Obergrenze, bei der Begehbarkeit und Sichtlinien noch erhalten bleiben. Aus dem Faktor folgt die Rate
 *    direkt als `Faktor × 10`.
 *  - `plaza` gibt in research/56 §3 keine Rate, sondern „1 Fokusstück + 2–4 Randstücke“. Für die Bezugsgröße
 *    10 × 10 = 100 Zellen sind das 3–5 Objekte je 100 Zellen.
 *  - `orchard` und `field`/`paddock` sind Nutzflächen; der Obstgarten übernimmt deshalb deren Band (1–2).
 *  - `path`: research/56 nennt Wegweiser, Schrein, Bank und Laternenpfahl am Weg. Der Weg selbst bleibt frei,
 *    bepflanzt wird der Rand; abgeleitet daraus 2–4 Objekte je 100 Wegzellen (dichter als Feld, dünner als Garten).
 *  - `pond`: Uferstücke (Teichrand, Weide, Findling) sind häufig, aber klein; abgeleitet 3–6 Objekte je 100 Zellen.
 *  - `meadow` läuft in research/56 §3 mit `garden` zusammen (0,3–0,5) → 3–5 Objekte je 100 Zellen.
 */
export const L2_TARGETS: Readonly<Record<ZoneKind, { readonly min: number; readonly max: number }>> = {
  yard: { min: 6, max: 8 },
  garden: { min: 3, max: 5 },
  field: { min: 1, max: 2 },
  paddock: { min: 1, max: 2 },
  plaza: { min: 3, max: 5 },
  orchard: { min: 1, max: 2 },
  pond: { min: 3, max: 6 },
  path: { min: 2, max: 4 },
  meadow: { min: 3, max: 5 },
};

/** Geländezellen je Zone (Nenner) und Katalog-Objekte je Zone (Zähler). */
export interface ZoneCounts {
  /** Geländezellen (Spalten) der Zone, die das Gelände tatsächlich angelegt hat. */
  readonly cells: number;
  /** Katalog-Objekte (Platzierungen) in dieser Zone. */
  readonly objects: number;
}

/** L2-Ergebnis je Zone: Zähler, Nenner und Rate je 100 Zellen. */
export interface ZoneObjectRate extends ZoneCounts {
  readonly zoneId: string;
  readonly kind: ZoneKind;
  /** Objekte je 100 Geländezellen; ohne Zellen 0. */
  readonly per100: number;
}

/** L2: Rate je Zone aus Flächen und Objekten. Deterministische Reihenfolge (nach `zoneId`). */
export function catalogObjectRates(
  areas: readonly { readonly zoneId: string; readonly kind: ZoneKind; readonly cells: number }[],
  objects: readonly { readonly zoneId: string }[],
): ZoneObjectRate[] {
  const perZone = new Map<string, number>();
  for (const o of objects) perZone.set(o.zoneId, (perZone.get(o.zoneId) ?? 0) + 1);
  return areas
    .map((a) => ({
      zoneId: a.zoneId,
      kind: a.kind,
      cells: a.cells,
      objects: perZone.get(a.zoneId) ?? 0,
      per100: a.cells === 0 ? 0 : ((perZone.get(a.zoneId) ?? 0) / a.cells) * 100,
    }))
    .sort((a, b) => a.zoneId.localeCompare(b.zoneId));
}

/** Zonenarten mit einem Zielband (alle `ZONE_KINDS`; das Band ist je Art definiert). */
export const L2_ZONES: readonly ZoneKind[] = [...ZONE_KINDS];

/** L2 über **alle** Zonen einer Art zusammen: kleine Zonen mitteln sich, statt das Band zu sprengen. */
export function catalogObjectRatesByKind(rates: readonly ZoneObjectRate[]): Map<ZoneKind, ZoneObjectRate> {
  const sum = new Map<ZoneKind, { cells: number; objects: number; zones: number }>();
  for (const r of rates) {
    const s = sum.get(r.kind) ?? { cells: 0, objects: 0, zones: 0 };
    s.cells += r.cells;
    s.objects += r.objects;
    s.zones++;
    sum.set(r.kind, s);
  }
  const out = new Map<ZoneKind, ZoneObjectRate>();
  for (const [kind, s] of sum) {
    out.set(kind, { zoneId: `Σ ${kind} (${s.zones})`, kind, cells: s.cells, objects: s.objects, per100: s.cells === 0 ? 0 : (s.objects / s.cells) * 100 });
  }
  return out;
}

/** Verletzte L2-Bänder als Klartext (leer = alle im Band). `byKind` ist das Ergebnis von `catalogObjectRatesByKind`. */
export function l2Misses(byKind: ReadonlyMap<ZoneKind, ZoneObjectRate>): string[] {
  const out: string[] = [];
  for (const kind of L2_ZONES) {
    const r = byKind.get(kind);
    if (r === undefined) continue;
    const t = L2_TARGETS[kind];
    if (r.per100 < t.min || r.per100 > t.max) out.push(`${kind} ${r.per100.toFixed(2)}/100 außerhalb ${t.min}–${t.max}`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ L3 Stil-Unterschied

/** Klassen des Geländes für L3 (Reihenfolge = Priorität der Spaltenklassifikation). */
export const LANDSCAPE_CLASSES = ['water', 'rock', 'tree', 'flower'] as const;
export type LandscapeClass = (typeof LANDSCAPE_CLASSES)[number];

/** Blumen-Blöcke der Themes (Vanilla-Namen ohne Namespace). */
const FLOWER_BLOCKS: ReadonlySet<string> = new Set([
  'dandelion', 'poppy', 'cornflower', 'azure_bluet', 'oxeye_daisy', 'allium', 'lily_of_the_valley', 'torchflower',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'sunflower', 'lilac', 'rose_bush', 'peony',
  'pitcher_plant', 'closed_eyeblossom', 'open_eyeblossom', 'cactus_flower', 'wildflowers', 'pink_petals',
]);
/** Baum-/Busch-Blöcke: Stämme und Laub (auch Buschlaub und Hecke zählen zur Baum-Schicht). */
const TREE_BLOCK = /(^|_)(log|wood|leaves|roots|propagule)($|_)/;
/** Fels-Blöcke (research/51 §1.2): Naturstein und seine Formen, ohne bearbeitete Werksteine. */
const ROCK_BLOCK = /^(stone|cobblestone|mossy_cobblestone|andesite|diorite|granite|deepslate|cobbled_deepslate|tuff|gravel|dripstone_block|stone_bricks|mossy_stone_bricks|cobblestone_wall|stone_stairs|stone_slab|andesite_stairs|cobblestone_stairs|deepslate_tiles|cobbled_deepslate_wall|tuff_bricks)/;

const blockName = (name: string): string => (name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name);

/**
 * Klasse eines Namens (Gelände-Rolle **oder** Blockname): Fels, Wasser, Baum, Blume – sonst `undefined`.
 * Rollen und Blöcke teilen sich die Funktion, damit Gelände-Ergebnis und materialisierte Welt vergleichbar sind.
 */
export function classifyName(name: string): LandscapeClass | undefined {
  if (name === 'water') return 'water';
  if (FLOWER_ROLES.has(name)) return 'flower';
  if (name.startsWith('log_') || name.startsWith('leaves_')) return 'tree';
  if (name.startsWith('pond_plant')) return undefined;
  const b = blockName(name);
  if (b === 'water' || b === 'bubble_column' || b === 'seagrass' || b === 'kelp' || b === 'kelp_plant') return 'water';
  if (FLOWER_BLOCKS.has(b)) return 'flower';
  if (TREE_BLOCK.test(b)) return 'tree';
  if (ROCK_BLOCK.test(b)) return 'rock';
  return undefined;
}

/** Höchste Klasse einer Spalte nach Priorität Wasser > Fels > Baum > Blume; `undefined` = keine davon. */
export function columnClass(names: Iterable<string>): LandscapeClass | undefined {
  let best: LandscapeClass | undefined;
  const rank = (c: LandscapeClass | undefined): number => (c === undefined ? -1 : LANDSCAPE_CLASSES.length - LANDSCAPE_CLASSES.indexOf(c));
  for (const n of names) {
    const c = classifyName(n);
    if (c !== undefined && rank(c) > rank(best)) best = c;
  }
  return best;
}

/** Anteile der vier Klassen an allen Spalten (0 … 1). */
export interface LandscapeShares {
  /** Spalten der Messung (Nenner). */
  readonly columns: number;
  readonly water: number;
  readonly rock: number;
  readonly tree: number;
  readonly flower: number;
}

/** Anteilsvektor aus klassifizierten Spalten (je Spalte die Namen von unten nach oben). */
export function landscapeShares(columns: readonly (readonly string[])[]): LandscapeShares {
  const counts: Record<LandscapeClass, number> = { water: 0, rock: 0, tree: 0, flower: 0 };
  for (const names of columns) {
    const c = columnClass(names);
    if (c !== undefined) counts[c]++;
  }
  const n = columns.length;
  const share = (k: LandscapeClass): number => (n === 0 ? 0 : counts[k] / n);
  return { columns: n, water: share('water'), rock: share('rock'), tree: share('tree'), flower: share('flower') };
}

/** L1-Distanz zweier Anteilsvektoren (Summe der Beträge der vier Anteile) – berichtete Zusatzzahl. */
export function shareDistance(a: LandscapeShares, b: LandscapeShares): number {
  return LANDSCAPE_CLASSES.reduce((s, k) => s + Math.abs(a[k] - b[k]), 0);
}

/** Größter Unterschied einer einzelnen Klasse zwischen zwei Anteilsvektoren (Prozentpunkte). */
export function shareSpread(a: LandscapeShares, b: LandscapeShares): number {
  return LANDSCAPE_CLASSES.reduce((m, k) => Math.max(m, Math.abs(a[k] - b[k])), 0);
}

/**
 * Schwelle für „deutlich verschieden“ (L3): Der **größte Unterschied einer einzelnen Klasse** muss ≥ 0,10 sein –
 * mindestens eine der vier Klassen (Fels, Wasser, Baum, Blume) nimmt über die ganze Fläche um **mindestens
 * 10 Prozentpunkte** zu oder ab (eine von zehn Spalten wechselt dort die Klasse). Das ist das Kriterium, das zur
 * Abnahme „in einer unbeschrifteten Bildreihe unterscheidbar“ passt: ein einzelner, großer Unterschied einer
 * Klasse ist sichtbar, während sich viele kleine Unterschiede (je 1–3 Prozentpunkte) im Grasrauschen verlieren.
 *
 * Die **L1-Distanz** der Vektoren (Summe über alle vier Klassen) wird zusätzlich berichtet; sie ist strenger,
 * wenn sich vier mittlere Unterschiede summieren, und schwächer, wenn ein einzelner großer Unterschied von
 * kleinen Gegendifferenzen aufgehoben wird. `l3Misses` prüft das Klassenkriterium, nicht die Summe.
 */
export const L3_MIN_SPREAD = 0.1;

/** Abwärtskompatibler Name der L3-Schwelle (identisch zu `L3_MIN_SPREAD`). */
export const L3_MIN_DISTANCE = L3_MIN_SPREAD;

/** Alle Stilpaare mit L1-Distanz und größtem Klassenunterschied, sortiert (deterministisch). */
export function styleDistances(shares: ReadonlyMap<string, LandscapeShares>): Array<{ readonly a: string; readonly b: string; readonly distance: number; readonly spread: number }> {
  const ids = [...shares.keys()].sort();
  const out: Array<{ a: string; b: string; distance: number; spread: number }> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = shares.get(ids[i]!)!;
      const b = shares.get(ids[j]!)!;
      out.push({ a: ids[i]!, b: ids[j]!, distance: shareDistance(a, b), spread: shareSpread(a, b) });
    }
  }
  return out;
}

/** Paare unter der Schwelle als Klartext (leer = alle deutlich verschieden). */
export function l3Misses(pairs: readonly { readonly a: string; readonly b: string; readonly spread: number }[]): string[] {
  return pairs.filter((p) => p.spread < L3_MIN_SPREAD).map((p) => `${p.a} ↔ ${p.b}: größter Klassenunterschied ${p.spread.toFixed(3)} < ${L3_MIN_SPREAD}`);
}
