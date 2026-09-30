/**
 * Grundstücks-Deko (feat/site-decor, Hebel 8 „Umgebung ans Haus binden“ aus plan/spikes/LV_tiefe_detail.md): ein
 * zusätzlicher, **abschaltbarer** Platzierungsschritt für Beiwerk, das das Grundstück bewohnt und zum Haus gehörig
 * wirken lässt – Holzplatz, Kräuter- und Kürbisbeet, Feuerstelle, Bank am Weg, Bannermasten beiderseits des
 * Eingangs, Standbilder je Theme, Pferch, Gräber, Bienenhof, Marktstand, Torbogen über dem Weg u. a.
 *
 * Aufbau (kein zweiter Streu- oder Wegepfad):
 *  - Läuft **nach** `placeOutdoorProps` (Zonen-Objekte haben Vorrang) und nutzt dieselbe Mechanik (`tryPlace`):
 *    Auflage auf gleicher Höhe, Wege/Zugänge/Sperrflächen bleiben frei, belegte Spalten sind für Ackerland,
 *    Beete und Vegetation gesperrt.
 *  - Eine **Slot-Tabelle** (`SLOTS`) legt fest, was wo hin darf: Komponenten, Ort (Wand, freie Fläche, Wegrand, Flanken
 *    der Haustür, über dem Weg), Bedingungen (Stufe, Theme, Hinweise der Räume, Gebäudegröße) und Anzahl.
 *  - Ein **Budget** (Stufe `some`/`rich`, wächst mit der freien Fläche) begrenzt die Zahl; Mindestabstand zwischen
 *    den Stücken. Die Slots stehen nach Vorrang, das Budget kappt hinten.
 *  - Alle Komponenten tragen das Tag `sd_decor` und stehen in keinem Zonen-Pool: ohne Schalter erscheint nichts.
 *  - Keine Windrad-/Hakenkreuz-Formen: Paare (Banner, Laternen) stehen spiegelbildlich zur Türachse, Einzelstücke sind
 *    punktsymmetrisch bzw. spiegelsymmetrisch (Katalogtest).
 * Rein und deterministisch (Seed + Slot-ID).
 */
import type { Catalog, ComponentDef } from '@mcda/catalog';
import { HORIZONTAL, Rng, hashSeed, type HorizontalDir, type Pose } from '@mcda/core';
import { allowedRotations, pickVariant } from '@mcda/furnishing';
import { C, type Gen } from './gen.js';
import { DIR_OFFSET } from './grid.js';
import { borderDist, facadeBands, mainDoor } from './modules.js';
import { backAnchor, freeColumn, freeColumnOverPath, placeZoneProps, tryPlace, type OutdoorPlacement, type PropZone } from './props.js';

/** Stufe der Grundstücks-Deko: `off` = nichts (Standard, bitgleich), `some` = wenige Stücke, `rich` = dichter. */
export type SiteDecorLevel = 'off' | 'some' | 'rich';

/**
 * Hinweise aus dem Raumprogramm, an denen funktionale Außenbereiche andocken (ohne Abhängigkeit vom Funktionsgrad):
 * `bees` (Imkerei), `fish` (Fischzucht), `animals` (Stall, Hühnerhaus, Scheune), `graves` (Kapelle), `market`
 * (Handelsraum, Schenke, Bäckerei), `wood` (Werkstatt, Schmiede, Zimmerei), `garden` (Kräuter- und Gewächshaus).
 */
export const SITE_DECOR_HINTS = ['bees', 'fish', 'animals', 'graves', 'market', 'wood', 'garden'] as const;
export type SiteDecorHint = (typeof SITE_DECOR_HINTS)[number];

export interface SiteDecorOptions {
  readonly level: Exclude<SiteDecorLevel, 'off'>;
  readonly catalog: Catalog;
  readonly dataVersion?: number | undefined;
  /** Theme-ID (Statuen, Bannerfarbe, Auswahl); fehlt = neutral (Mittelalter). */
  readonly themeId?: string | undefined;
  readonly hints?: readonly SiteDecorHint[] | undefined;
  /** Schon gesetzte Objekte (Zonen-Pass): Slots, deren Komponente schon steht, entfallen (kein Doppelbrunnen). */
  readonly existing?: readonly OutdoorPlacement[] | undefined;
  /** Teichzonen (aus den Zonen-Objekten) für den Angelsteg. */
  readonly ponds?: readonly PropZone[] | undefined;
}

/** Theme → Familie der Deko (Statuen, Bannerfarbe). Unbekannte Themes gelten als `medieval`. */
const FAMILY: Readonly<Record<string, string>> = {
  medieval: 'medieval', timber: 'medieval', rustic: 'rustic', farmstead: 'rustic', harbor: 'rustic', tropical: 'rustic', desert: 'rustic',
  nordic: 'nordic', nordic_falu: 'nordic', winter: 'nordic', asian: 'asian', gothic: 'gothic', ruin: 'ruin', dwarven: 'dwarven',
  steampunk: 'dwarven', elven: 'elven',
};
/** Bannerfarbe je Familie (Variante von `sd_banner_pole`); fehlt = keine Bannermasten. */
const BANNER: Readonly<Record<string, string>> = { medieval: 'red', nordic: 'blue', gothic: 'black', dwarven: 'red', elven: 'green' };

/** Zustand, den die Slot-Bedingungen lesen. */
interface Ctx {
  readonly level: 'some' | 'rich';
  readonly family: string;
  readonly hints: ReadonlySet<string>;
  /** Grundfläche des Hauses in Zellen. */
  readonly footArea: number;
  /** Freie Fläche (Wiese + Sockelstreifen) in Zellen. */
  readonly roomy: number;
}

type Mode = 'wall' | 'free' | 'path' | 'flank' | 'arch';

interface Slot {
  /** Name (Seed, Berichte). */
  readonly id: string;
  /** Komponenten in Vorzugsreihenfolge; die erste, die in der Zielversion existiert, gilt. */
  readonly ids: readonly string[];
  readonly mode: Mode;
  /** Frühestens ab dieser Stufe. */
  readonly from: 'some' | 'rich';
  readonly when?: (c: Ctx) => boolean;
  /** Anzahl Exemplare (bei `flank` Paare). */
  readonly count: (c: Ctx) => number;
  /** Abstand zum Hausgrundriss (Chebyshev, Zellen) für die Ankerzelle. */
  readonly foot: readonly [number, number];
  /** Sichtband: `back` = nur hinter dem Haus, `side` = hinter oder neben dem Haus (nie vor der Hauptfassade), `any` = überall. */
  readonly band?: 'back' | 'side' | 'any';
  /** Fest gewählte Variante (sonst per Seed). */
  readonly variant?: (c: Ctx) => string | undefined;
  /** Rücken zum Haus (`house`), Front zum Haus (`front`), zufällig (`any`); nur bei `free`. */
  readonly facing?: 'back' | 'front' | 'any';
}

const isFarm = (c: Ctx): boolean => c.hints.has('animals') || c.hints.has('garden') || c.family === 'rustic';

/**
 * Slot-Tabelle nach Vorrang. Zahlen: `some` ≈ 3–5 Stücke, `rich` ≈ 8–12 (Budget siehe `budget`).
 * Vorbilder: Bauernhöfe/Dörfer der Builder-Serien (Holzplatz, Brunnen, Kürbisbeet, Zaunpferch), Burgen mit Bannermasten
 * am Tor, Gartenlaternen und Bänke am Weg (plan/spikes/FN_inspiration_gebaeude.md, LV_tiefe_detail.md Kap. 5).
 */
const SLOTS: readonly Slot[] = [
  // Am Haus: Holzplatz und Schuppen an der Rückwand, Gemüse/Kräuter daneben
  { id: 'woodyard', ids: ['outdoor/sd_woodyard'], mode: 'wall', from: 'some', when: (c) => c.family !== 'asian' && c.family !== 'elven', count: () => 1, foot: [1, 1], band: 'side' },
  { id: 'shed', ids: ['outdoor/sd_shed'], mode: 'wall', from: 'rich', when: (c) => isFarm(c) || c.hints.has('wood'), count: () => 1, foot: [1, 1], band: 'back' },
  { id: 'herbs', ids: ['outdoor/sd_herb_bed'], mode: 'free', from: 'some', count: () => 1, foot: [2, 6], band: 'side', facing: 'any' },
  { id: 'pumpkins', ids: ['outdoor/sd_pumpkin_patch'], mode: 'free', from: 'rich', when: (c) => c.family !== 'ruin' && c.family !== 'dwarven', count: () => 1, foot: [3, 8], band: 'side', facing: 'any' },
  { id: 'clothes', ids: ['outdoor/clothesline'], mode: 'free', from: 'rich', when: (c) => isFarm(c) && c.footArea < 150, count: () => 1, foot: [2, 6], band: 'back', facing: 'any' },
  // Funktionale Außenbereiche (Hinweise der Räume)
  { id: 'pen', ids: ['outdoor/sd_pen'], mode: 'free', from: 'some', when: (c) => c.hints.has('animals'), count: (c) => (c.level === 'rich' ? 2 : 1), foot: [3, 12], band: 'side', facing: 'back' },
  { id: 'bees', ids: ['outdoor/fn_bee_yard', 'outdoor/beehive_garden'], mode: 'free', from: 'some', when: (c) => c.hints.has('bees'), count: () => 1, foot: [3, 12], band: 'side', facing: 'any' },
  { id: 'graves', ids: ['outdoor/sd_graves'], mode: 'free', from: 'some', when: (c) => c.hints.has('graves') || (c.level === 'rich' && (c.family === 'ruin' || c.family === 'gothic')), count: () => 1, foot: [3, 12], band: 'back', facing: 'any' },
  { id: 'market', ids: ['outdoor/market_stall'], mode: 'path', from: 'some', when: (c) => c.hints.has('market'), count: (c) => (c.level === 'rich' ? 2 : 1), foot: [3, 14] },
  // Eingang: Bannermasten beiderseits, Torbogen über dem Weg, Bank und Laternen am Weg
  { id: 'banners', ids: ['outdoor/sd_banner_pole'], mode: 'flank', from: 'some', when: (c) => BANNER[c.family] !== undefined && c.footArea >= (c.level === 'rich' ? 90 : 150), count: () => 1, foot: [3, 6], variant: (c) => BANNER[c.family] },
  { id: 'arch', ids: ['outdoor/sd_arch'], mode: 'arch', from: 'rich', when: (c) => c.family !== 'ruin', count: () => 1, foot: [4, 12] },
  { id: 'bench', ids: ['outdoor/sd_bench'], mode: 'path', from: 'some', count: (c) => (c.level === 'rich' ? 2 : 1), foot: [3, 12] },
  { id: 'lantern', ids: ['outdoor/sd_stone_lantern'], mode: 'path', from: 'some', when: (c) => c.family === 'asian', count: (c) => (c.level === 'rich' ? 3 : 2), foot: [2, 14] },
  { id: 'lamps', ids: ['outdoor/lamp_post'], mode: 'path', from: 'rich', when: (c) => c.family !== 'asian' && c.family !== 'ruin', count: () => 2, foot: [3, 14] },
  // Standbilder und Zeichen je Theme
  { id: 'runestone', ids: ['outdoor/sd_runestone'], mode: 'free', from: 'some', when: (c) => c.family === 'nordic', count: (c) => (c.level === 'rich' ? 2 : 1), foot: [4, 10], band: 'side', facing: 'any' },
  { id: 'column', ids: ['outdoor/sd_column'], mode: 'free', from: 'some', when: (c) => c.family === 'gothic' || c.family === 'ruin', count: (c) => (c.level === 'rich' ? 2 : 1), foot: [4, 10], band: 'side', facing: 'any' },
  { id: 'brazier', ids: ['outdoor/sd_brazier'], mode: 'free', from: 'some', when: (c) => c.family === 'dwarven' || (c.family === 'gothic' && c.level === 'rich'), count: (c) => (c.level === 'rich' ? 2 : 1), foot: [3, 9], band: 'side', facing: 'any' },
  { id: 'firepit', ids: ['outdoor/sd_fire_pit'], mode: 'free', from: 'rich', when: (c) => c.family !== 'ruin', count: () => 1, foot: [5, 11], band: 'side', facing: 'any' },
  { id: 'well', ids: ['outdoor/well_small', 'outdoor/well'], mode: 'free', from: 'rich', when: (c) => c.family !== 'asian', count: () => 1, foot: [4, 10], band: 'side', facing: 'any' },
  { id: 'wagon', ids: ['outdoor/handcart', 'outdoor/ox_wagon'], mode: 'free', from: 'rich', when: (c) => isFarm(c) || c.hints.has('market'), count: () => 1, foot: [3, 10], band: 'side', facing: 'any' },
  { id: 'sign', ids: ['outdoor/signpost'], mode: 'path', from: 'rich', count: () => 1, foot: [8, 30] },
];

/** Budget: Höchstzahl gesetzter Stücke (wächst mit der freien Fläche). */
function budget(c: Ctx): number {
  return c.level === 'some' ? Math.min(6, 3 + Math.floor(c.roomy / 700)) : Math.min(16, 7 + Math.floor(c.roomy / 350));
}

const cheb = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const opp = (d: HorizontalDir): HorizontalDir => HORIZONTAL[(HORIZONTAL.indexOf(d) + 2) % 4]!;

/**
 * Setzt die Grundstücks-Deko. Liefert die Platzierungen (für die Materialisierung wie die Zonen-Objekte) und sperrt die
 * belegten Spalten. Ohne Haus (kein Grundriss) oder ohne freie Fläche entfällt alles.
 */
export function placeSiteDecor(g: Gen, o: SiteDecorOptions): OutdoorPlacement[] {
  const { grid } = g;
  const foot = g.building.footprint.bounds();
  if (foot === undefined) return [];
  const roomyCells: number[] = [];
  for (let i = 0; i < grid.size; i++) if ((g.cls[i] === C.meadow || g.cls[i] === C.pad) && freeColumn(g, i)) roomyCells.push(i);
  const ctx: Ctx = {
    level: o.level,
    family: FAMILY[o.themeId ?? 'medieval'] ?? 'medieval',
    hints: new Set(o.hints ?? []),
    footArea: g.building.footprint.size,
    roomy: roomyCells.length,
  };
  const bands = facadeBands(g, 3);
  const door = mainDoor(g);
  const center: readonly [number, number] = [(foot.minX + foot.maxX) / 2, (foot.minZ + foot.maxZ) / 2];
  const pathCells: number[] = [];
  for (let i = 0; i < grid.size; i++) if (g.path[i] === 1 || g.route[i] === 1) pathCells.push(i);
  const fromPath = grid.distance(pathCells, 4);
  const taken = new Set((o.existing ?? []).map((p) => p.componentId));
  const out: OutdoorPlacement[] = [];
  const spots: Array<readonly [number, number]> = [];
  const cap = budget(ctx);
  let used = 0;

  /** Erlaubte Spalten: Wiese und Sockelstreifen, frei; je nach Sichtband. */
  const allowedFor = (band: Slot['band'], overPath = false): Set<number> => {
    const set = new Set<number>();
    for (let i = 0; i < grid.size; i++) {
      if (g.cls[i] !== C.meadow && g.cls[i] !== C.pad) continue;
      if (!(overPath ? freeColumnOverPath(g, i) : freeColumn(g, i))) continue;
      if (band === 'back' && bands[i] !== 2) continue;
      if (band === 'side' && bands[i] === 1 && !sideOf(i)) continue;
      set.add(i);
    }
    return set;
  };
  /** Zelle seitlich des Hauses (nicht vor der Hauptfassade): Sichtband 1, aber nicht in der Türachse. */
  function sideOf(i: number): boolean {
    if (door === undefined) return true;
    const [fx, fz] = DIR_OFFSET[door.outward];
    const dx = grid.x(i) - door.cell[0];
    const dz = grid.z(i) - door.cell[1];
    return Math.abs(dx * fz - dz * fx) > 6 && dx * fx + dz * fz < 3;
  }
  const near = (i: number, lo: number, hi: number): boolean => g.footDist[i]! >= lo && g.footDist[i]! <= hi;
  const spaced = (c: readonly [number, number], min = 4): boolean => spots.every((s) => cheb(s, c) >= min);
  const toHouse = (i: number): HorizontalDir => {
    const dx = center[0] - grid.x(i);
    const dz = center[1] - grid.z(i);
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
  };
  const zoneFor = (slot: Slot): PropZone => ({ zoneId: `sd:${slot.id}`, kind: 'meadow', cells: [] });
  const pathDir = (i: number, reach: number): HorizontalDir | undefined => {
    for (const d of HORIZONTAL) {
      for (let s = 1; s <= reach; s++) {
        const j = grid.at(grid.x(i) + DIR_OFFSET[d][0] * s, grid.z(i) + DIR_OFFSET[d][1] * s);
        if (j < 0) break;
        if (g.path[j] === 1 || g.route[j] === 1) return d;
        if (!freeColumn(g, j)) break;
      }
    }
    return undefined;
  };

  const pool = new Map(o.catalog.byTags(['outdoor', 'sd_decor'], o.dataVersion).filter((d) => d.mount === 'floor').map((d) => [d.id, d] as const));
  const defOf = (slot: Slot): ComponentDef | undefined => slot.ids.map((id) => pool.get(id)).find((d) => d !== undefined);

  for (const slot of SLOTS) {
    if (used >= cap) break;
    if (slot.from === 'rich' && o.level !== 'rich') continue;
    if (slot.when !== undefined && !slot.when(ctx)) continue;
    const def = defOf(slot);
    if (def === undefined || taken.has(def.id)) continue;
    const rng = new Rng(hashSeed(g.seed, 'siteDecor', slot.id));
    const zone = zoneFor(slot);
    const allowed = allowedFor(slot.band, slot.mode === 'arch');
    const fixed = slot.variant?.(ctx);
    const variantId = fixed ?? pickVariant(def, rng)?.id;
    const rots = allowedRotations(def);
    let want = slot.count(ctx);
    if (slot.mode === 'flank') want = 1;

    if (slot.mode === 'flank') {
      // Paar beiderseits der Türachse, gleich weit weg: spiegelbildlich, nie eine Windradform. Vorab prüfen, dass beide
      // Stücke passen (Breite 3 quer zur Achse), sonst gar keines.
      if (door === undefined || used + 2 > cap) continue;
      const [fx, fz] = DIR_OFFSET[door.outward];
      const [lx, lz] = [-fz, fx];
      const rot: Pose['rot'] = fx === 0 ? 0 : 1;
      if (!rots.includes(rot)) continue;
      const fits = (c: number): boolean => [-1, 0, 1].every((k) => {
        const j = grid.at(grid.x(c) + lx * k, grid.z(c) + lz * k);
        return j >= 0 && allowed.has(j) && g.top[j] === g.top[c];
      });
      let done = false;
      for (const dist of [slot.foot[0], slot.foot[0] + 1, slot.foot[1]]) {
        for (const side of [4, 5, 3]) {
          const cells = [-1, 1].map((s) => grid.at(door.cell[0] + fx * dist + lx * side * s, door.cell[1] + fz * dist + lz * side * s));
          if (cells.some((c) => c < 0 || !fits(c) || !spaced([grid.x(c), grid.z(c)]))) continue;
          if (!cells.every((c) => tryPlace(g, zone, c, def, variantId, rot, allowed, out))) continue;
          for (const c of cells) spots.push([grid.x(c), grid.z(c)]);
          used += 2;
          done = true;
          break;
        }
        if (done) break;
      }
      continue;
    }

    if (slot.mode === 'arch') {
      // Torbogen quer über einem geraden Wegstück: Pfosten links und rechts der Wegzelle (Breite 3)
      const cand = pathCells.filter((i) => near(i, slot.foot[0], slot.foot[1]) && spaced([grid.x(i), grid.z(i)], 5));
      for (const c of rng.shuffle(cand)) {
        if (want <= 0) break;
        for (const rot of rng.shuffle([...rots])) {
          if (!rots.includes(rot)) continue;
          const alongX = rot % 2 === 0; // Breite 3 entlang x bei Drehung 0/2
          const a = grid.at(grid.x(c) + (alongX ? -1 : 0), grid.z(c) + (alongX ? 0 : -1));
          const b = grid.at(grid.x(c) + (alongX ? 1 : 0), grid.z(c) + (alongX ? 0 : 1));
          if (a < 0 || b < 0 || g.path[a] === 1 || g.path[b] === 1 || g.route[a] === 1 || g.route[b] === 1) continue;
          const ok = tryPlace(g, zone, c, def, variantId, rot, allowed, out, undefined, true);
          if (ok) {
            spots.push([grid.x(c), grid.z(c)]);
            used++;
            want--;
            break;
          }
        }
      }
      continue;
    }

    // wall / free / path: Kandidaten je Modus
    let cand: number[];
    if (slot.mode === 'wall') cand = [...allowed].filter((i) => g.footDist[i] === 1 && bands[i] !== 1 || (g.footDist[i] === 1 && slot.band === 'side' && bands[i] === 1 && sideOf(i)));
    else if (slot.mode === 'path') cand = [...allowed].filter((i) => near(i, slot.foot[0], slot.foot[1]) && fromPath[i]! >= 1 && fromPath[i]! <= 4);
    else cand = [...allowed].filter((i) => near(i, slot.foot[0], slot.foot[1]) && borderDist(g, i) >= 2 && fromPath[i]! >= 2);
    cand.sort((a, b) => a - b);
    for (const c of rng.shuffle(cand)) {
      if (want <= 0 || used >= cap) break;
      const at: readonly [number, number] = [grid.x(c), grid.z(c)];
      if (!spaced(at)) continue;
      let ok = false;
      if (slot.mode === 'wall') {
        const back = HORIZONTAL.find((d) => {
          const j = grid.at(at[0] + DIR_OFFSET[d][0], at[1] + DIR_OFFSET[d][1]);
          return j >= 0 && g.building.footprint.has(grid.x(j), grid.z(j));
        });
        if (back === undefined) continue;
        const rot = HORIZONTAL.indexOf(back) as Pose['rot'];
        if (!rots.includes(rot)) continue;
        ok = tryPlace(g, zone, c, def, variantId, rot, allowed, out, (w, d) => backAnchor(g, c, back, w, d));
      } else if (slot.mode === 'path') {
        const dir = pathDir(c, 4);
        if (dir === undefined) continue;
        const back = opp(dir);
        const rot = HORIZONTAL.indexOf(back) as Pose['rot'];
        if (!rots.includes(rot)) continue;
        ok = tryPlace(g, zone, c, def, variantId, rot, allowed, out, (w, d) => backAnchor(g, c, back, w, d));
      } else {
        const back = slot.facing === 'back' ? opp(toHouse(c)) : undefined;
        const rot = back !== undefined && rots.includes(HORIZONTAL.indexOf(back) as Pose['rot']) ? (HORIZONTAL.indexOf(back) as Pose['rot']) : rng.pick(rots);
        ok = tryPlace(g, zone, c, def, variantId, rot, allowed, out);
      }
      if (ok) {
        spots.push(at);
        used++;
        want--;
      }
    }
  }

  // Angelsteg am Teich (Hinweis „fish“): ein Steg je Teichzone
  if (ctx.hints.has('fish') && used < cap && !taken.has('outdoor/fn_fish_jetty')) {
    for (const p of o.ponds ?? []) {
      if (p.cells.length < 12) continue;
      const before = out.length;
      const exact = 10.4 / p.cells.length;
      const { kit: _kit, ...rest } = p;
      out.push(...placeZoneProps(g, { ...rest, zoneId: `sd:${p.zoneId}:jetty`, only: ['outdoor/fn_fish_jetty'], factor: exact, tags: ['fish_pond'] }, { catalog: o.catalog, ...(o.dataVersion !== undefined ? { dataVersion: o.dataVersion } : {}) }));
      if (out.length > before) break;
    }
  }
  return out;
}
