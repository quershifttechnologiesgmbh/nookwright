/**
 * Eingang E1–E4 (research/18 §6, research/16 F4/W6/W7/F7) am Anker `door`.
 *
 * W3-EN (plan/spikes/W3EN_eingang.md): die Haustür bekommt ein **Eingangsmodul** aus dem Katalog
 * (`exterior/entrance_module_<id>`, eine Katalogeinheit mit ihren Stücken als Varianten, wie die Fenstermodule). Das
 * Modul gilt für das ganze Gebäude (Stil `entranceModule`, sonst das Modul, dessen `styleTags` das Theme nennen, sonst
 * `townhouse`). Jedes Stück ist spiegelsymmetrisch um die Türachse und wird an seiner Mittelspalte angesetzt, unterste
 * Schicht auf der Bodenplattenreihe, Rückseite an der Wand:
 *
 *   Ansicht Haustür (Stadthaus)              Schnitt
 *     F A K B F    F Zaun-Arm, A/B Bogen       y0+3  A .    Bogen bzw. Vordach 1 (bis 2) vor der Wand
 *     L Q . Q L    K Schlussstein, L Laterne   y0+2  Q D    Laufweg (Tür + 1 davor, 2 hoch) bleibt frei
 *     . Q D Q .    Q Gewände, D Tür            y0+1  Q D
 *     . s s s .    s Stufe (3 breit)           y0    s =    Stufe auf Bodenplattenhöhe, abgesetzt vom Sockelprofil
 *
 * Regeln:
 *  - E3 zuerst: Stufe(n) vor jeder Außentür, wenn die Tür über dem Gelände liegt (ohne Gelände: eben eine Lage unter
 *    der Bodenplatte → eine Stufe); an der Haustür 3 breit (Seiten nur paarweise; mit Fassadenraster lässt die Hülle das
 *    Sockelprofil dort frei), ab 2 Höhe Podest + Stufen, > 4 Hinweis. An der Haustür aus `step`/`block` des Moduls.
 *  - E1/E2 an der Haustür: Portal (`frame*`, erstes passendes; ein ausdrückliches `portalKind` setzt stattdessen
 *    `door_portal`), darauf das Vordach (`canopy*`, erstes passendes). Passt keins, bleibt die schmale Blende
 *    (`door_canopy`) – jede Haustür bekommt eine Fassung, wo Platz ist (F4). Nebentüren: nur Vordach/Blende.
 *  - E4 nur an der Haustür: Laternenpaar des Moduls (`lanterns*`, erstes passendes: Zaun-Arm mit Wand dahinter, unter
 *    dem Vordach/Rähm bzw. der Traufe mit tragender Unterseite, oder stehend auf einem Pfosten), sonst der alte Weg
 *    (Zaun-Arm/Traufe 2–3 neben der Tür); die Laternen-Spalten und ihre Nachbarn gelten danach als belegte Pfosten (F7:
 *    keine Fenster-/Traufenlaterne daneben). Kübelpaar neben der Tür, nie unter einer Laterne; Bank auf einer Seite
 *    (Wand dahinter); Aushängeschild bei Werkstätten/Wirtshaus auf der anderen Seite, eine Spalte Abstand zum
 *    Laternen-Arm. Nebentüren: eine Laterne. Alles paarweise symmetrisch, außer Bank und Schild.
 *  - W4-C Doppeltür (zwei Haustür-Anker nebeneinander): alles wie oben, nur eine Spalte breiter – Stücke `double_*` des
 *    Moduls (gerade breit, die zwei Mittelspalten auf den Flügeln), Stufe 4 breit, Paare links ab dem linken und rechts
 *    ab dem rechten Flügel gezählt. Rückfall ohne passendes Stück: Blende `double_blind`.
 */
import type { Shell, ShellAnchor } from '@mcda/blueprint';
import type { Catalog, MaterialSpec } from '@mcda/catalog';
import { Rng, cellKey, key3, rotateDir, type Vec3 } from '@mcda/core';
import { expandComponent } from '@mcda/furnishing';
import { fantasyPiece } from './fantasy.js';
import { chooseModule } from './modules.js';
import { OPP, STEP, alongOf, atDensity, rotFor, step, up, type ExteriorSite, type Part } from './site.js';
import {
  DEFAULT_ENTRANCE_MODULE, DEFAULT_SIGN_ROOM_TYPES, ENTRANCE_MODULES, type EntranceModuleId, type ExteriorOptions, type ExteriorStyle,
} from './types.js';

const PLANTERS: readonly (readonly [string, number])[] = [['azalea', 3], ['bush', 2], ['fern', 2], ['spruce', 1]];

/** Katalog-ID eines Eingangsmoduls. */
export const entranceModuleComponent = (id: EntranceModuleId): string => `exterior/entrance_module_${id}`;

/**
 * Eingangsmodul eines Gebäudes: Stil → Theme (`styleTags` des Moduls, Reihenfolge `ENTRANCE_MODULES`) → Standard; W5-B mit
 * `themeMaterial` nur, wenn das Modul des Stils zum Wandmaterial des Themes passt (`chooseModule`).
 */
export function entranceModuleFor(catalog: Catalog, style: ExteriorStyle, themeId: string | undefined): EntranceModuleId {
  return chooseModule(catalog, style.entranceModule, style.themeMaterial, themeId, ENTRANCE_MODULES, DEFAULT_ENTRANCE_MODULE, entranceModuleComponent);
}

/**
 * Ein Stück des Moduls: Variante, halbe Breite und Breite. Stücke der einfachen Tür sind ungerade breit und symmetrisch
 * um die Türachse; W4-C: Stücke der Doppeltür (`double_*`) sind gerade breit, symmetrisch um die Mitte der Flügel.
 */
interface Piece {
  readonly variantId: string;
  readonly half: number;
  readonly width: number;
  /** W7-D: Stück einer anderen Komponente (Fantasy-Modul, z. B. Feuerschalen); fehlt = das Eingangsmodul. */
  readonly componentId?: string;
}

/** Was ein Eingangsmodul mitbringt (aus seinen Varianten gelesen). */
export interface EntranceKit {
  readonly componentId: string;
  /** Portal: Gewände + Sturz (Gruppe `portal`), in Rückfall-Reihenfolge (`frame*`). */
  readonly frames: readonly Piece[];
  /** Vordach mit Trägern (Gruppe `canopy`), in Rückfall-Reihenfolge. */
  readonly canopies: readonly Piece[];
  /** Laternenpaar mit Aufhängung (Gruppe `entranceDecor`), in Rückfall-Reihenfolge. */
  readonly lanterns: readonly Piece[];
  /** Stufe (`step`) und Podest/Unterbau (`block`) der Vortreppe (Gruppe `stoop`). */
  readonly step: boolean;
  readonly block: boolean;
  /** W4-C: Stücke der Doppeltür (`double_frame*`, `double_canopy*`, `double_lanterns*`) und die Blende `double_blind`. */
  readonly double: {
    readonly frames: readonly Piece[];
    readonly canopies: readonly Piece[];
    readonly lanterns: readonly Piece[];
    readonly blind?: Piece;
  };
}

export function entranceKit(catalog: Catalog, id: EntranceModuleId): EntranceKit | undefined {
  const componentId = entranceModuleComponent(id);
  const def = catalog.find(componentId);
  if (def === undefined) return undefined;
  const ids = (def.variants ?? []).map((v) => v.id);
  const piece = (v: string): Piece => {
    const width = expandComponent(def, v).size[0];
    return { variantId: v, half: (width - 1) / 2, width };
  };
  return {
    componentId,
    frames: ids.filter((v) => v.startsWith('frame')).map(piece),
    canopies: ids.filter((v) => v.startsWith('canopy')).map(piece),
    lanterns: ids.filter((v) => v.startsWith('lanterns')).map(piece),
    step: ids.includes('step'),
    block: ids.includes('block'),
    double: {
      frames: ids.filter((v) => v.startsWith('double_frame')).map(piece),
      canopies: ids.filter((v) => v.startsWith('double_canopy')).map(piece),
      lanterns: ids.filter((v) => v.startsWith('double_lanterns')).map(piece),
      ...(ids.includes('double_blind') ? { blind: piece('double_blind') } : {}),
    },
  };
}

/**
 * Stück an der Tür: Mittelspalte des Stücks auf der Türachse, Rückseite an der Wand, unterste Schicht auf der
 * Bodenplattenreihe (eine Reihe unter der unteren Türhälfte – dort liegt die Stufe, dort stehen Pfosten).
 * W4-C: ein gerade breites Stück (Doppeltür) liegt mit seinen zwei Mittelspalten auf `col(0)` und `col(1)`.
 */
function pieceAt(kit: EntranceKit, p: Piece, a: ShellAnchor, col: (k: number, y?: number) => Vec3): Part {
  const componentId = p.componentId ?? kit.componentId;
  if (p.width % 2 === 1) return { componentId, variantId: p.variantId, facing: a.facing, local: [p.half, 0, 0], at: col(0, a.pos[1] - 1) };
  // lokales x läuft in Weltrichtung rotateDir(east, rot): zeigt es entlang der Wand, liegt die linke Mittelspalte auf col(0)
  const lo = p.width / 2 - 1;
  const local: Vec3 = rotateDir('east', rotFor(a.facing)) === alongOf(a.facing) ? [lo, 0, 0] : [lo + 1, 0, 0];
  return { componentId, variantId: p.variantId, facing: a.facing, local, at: col(0, a.pos[1] - 1) };
}

/** Zellen der gesetzten Eingangs-Stücke, an deren Unterseite eine Laterne hängen kann (Faktencheck #3). */
type Carriers = Set<string>;

/** Trägt die Unterseite dieser Zelle eine hängende Laterne? Volle Blöcke, untere Stufe/Treppe, Zaun, Mauer, Kette. */
function carries(mat: MaterialSpec): boolean {
  const s = mat.shape;
  if (s === 'stairs' || s === 'slab') return mat.orient?.upsideDown !== true;
  return s === 'block' || s === 'planks' || s === 'log' || s === 'wood' || s === 'fence' || s === 'wall' || s === 'chain';
}

/** Merkt sich die tragenden Zellen eines gesetzten Stücks. */
function remember(site: ExteriorSite, part: Part, carriers: Carriers): void {
  for (const c of site.placed(part).cells) if (carries(c.mat)) carriers.add(key3(c.pos));
}

/**
 * Zusatzbedingung eines Stücks: Zäune in der Reihe direkt vor der Wand (Arm) haben dahinter eine tragende Wandzelle,
 * und jede hängende Laterne hat darüber einen Träger – im Stück selbst, in einem schon gesetzten Eingangs-Stück
 * (Vordach, Rähm) oder in der Hülle (Traufe mit voller Unterseite).
 */
function pieceHolds(site: ExteriorSite, part: Part, a: ShellAnchor, carriers: Carriers): boolean {
  const placed = site.placed(part);
  const own = new Map(placed.cells.map((c) => [key3(c.pos), c.mat] as const));
  const plane = a.facing === 'north' || a.facing === 'south' ? a.pos[2] : a.pos[0];
  for (const c of placed.cells) {
    if (c.mat.shape === 'fence') {
      const q = a.facing === 'north' || a.facing === 'south' ? c.pos[2] : c.pos[0];
      if (q === plane && !site.solidWall(step(c.pos, OPP[a.facing]))) return false;
    }
    if (c.mat.shape === 'lantern' && c.mat.orient?.hanging === true) {
      const above = own.get(key3(up(c.pos)));
      if (above !== undefined ? !carries(above) : !carriers.has(key3(up(c.pos))) && !site.hangsFrom(c.pos)) return false;
    }
  }
  return true;
}

/**
 * W3-EN E1/E2 an der Haustür: Portal des Moduls (bzw. `door_portal` in der Form `portalKind`, wenn der Stil sie
 * nennt), darüber das Vordach (erstes passendes in Katalogreihenfolge). Passt keins von beiden, bleibt das schmale
 * Vordach aus Falltüren als Rückfall (F4: jede Haustür bekommt eine Fassung, wo Platz ist).
 */
function moduleFrame(site: ExteriorSite, a: ShellAnchor, kit: EntranceKit, style: ExteriorStyle, col: (k: number, y?: number) => Vec3, carriers: Carriers, wide = false): void {
  const on = (g: keyof ExteriorStyle): boolean => style[g] !== false;
  let framed = false;
  const set = wide ? kit.double : kit;
  if (on('portal')) {
    // W4-C: an der Doppeltür immer das Portal des Moduls (`door_portal` gibt es nur 3 breit)
    const parts: Part[] = style.portalKind !== undefined && !wide
      ? [{ componentId: 'exterior/door_portal', variantId: style.portalKind, facing: a.facing, local: [1, 0, 0], at: col(0) }]
      : set.frames.map((f) => pieceAt(kit, f, a, col));
    for (const part of parts) {
      if (site.commit('portal', 'door', a.floorIndex, [part]).length === 0) continue;
      remember(site, part, carriers);
      framed = true;
      break;
    }
  }
  if (on('canopy')) {
    for (const c of set.canopies) {
      const part = pieceAt(kit, c, a, col);
      if (site.commit('canopy', 'door', a.floorIndex, [part], () => pieceHolds(site, part, a, carriers)).length === 0) continue;
      remember(site, part, carriers);
      framed = true;
      break;
    }
    if (!framed && wide) {
      if (kit.double.blind !== undefined) site.commit('canopy', 'door', a.floorIndex, [pieceAt(kit, kit.double.blind, a, col)]);
    } else if (!framed) {
      for (const v of ['pent', 'trapdoor']) {
        if (site.commit('canopy', 'door', a.floorIndex, [{ componentId: 'exterior/door_canopy', variantId: v, facing: a.facing, local: [1, 0, 0], at: col(0) }]).length > 0) break;
      }
    }
  }
}

/**
 * W3-EN E4: Laternenpaar des Moduls – das erste passende Stück in Katalogreihenfolge (Aufhängung wie im Vorbild, Träger
 * geprüft). Liefert den Abstand der Laternen von der Türachse (0 = keins gesetzt).
 */
function moduleLanterns(
  site: ExteriorSite, a: ShellAnchor, kit: EntranceKit, col: (k: number, y?: number) => Vec3, carriers: Carriers, extra = 0, first: readonly Piece[] = [],
): number {
  // W7-D: zuerst die Stücke eines Fantasy-Moduls (Feuerschalen), dann die Laternen des Eingangsmoduls
  for (const l of [...first, ...(extra > 0 ? kit.double.lanterns : kit.lanterns)]) {
    const part = pieceAt(kit, l, a, col);
    const placed = site.commit('entranceDecor', 'door', a.floorIndex, [part], () => pieceHolds(site, part, a, carriers));
    if (placed.length === 0) continue;
    // Abstand der Laternen: äußerste Spalte des Stücks mit einer Laterne bzw. Feuerschale (Doppeltür: rechts ab dem
    // rechten Flügel gezählt)
    const along = alongOf(a.facing);
    const lamps = site.placed(part).cells.filter((c) => c.mat.shape === 'lantern' || c.mat.block === 'minecraft:campfire')
      .map((c) => along === 'east' ? c.pos[0] - a.pos[0] : c.pos[2] - a.pos[2])
      .map((t) => (t < 0 ? -t : Math.max(0, t - extra)));
    return Math.max(1, ...lamps);
  }
  return 0;
}

/** Spalten vor Haustüren (`cellKey` der Zelle vor der Tür + Richtung) aus der Raumsicht. */
export function mainDoorFronts(shell: Shell): Set<string> {
  const out = new Set<string>();
  for (const r of shell.rooms.values()) {
    for (const d of r.doors) {
      if (!d.isMain) continue;
      const [dx, dz] = STEP[d.toward];
      out.add(`${cellKey(d.inside[0] + 2 * dx, d.inside[1] + 2 * dz)}|${d.toward}`);
    }
  }
  return out;
}

/** W9-G4: Tür in der Front eines eingegrabenen Baukörpers (Lage `buried`) – dort steht die Rundtür der Hülle. */
function buriedFrontDoor(shell: Shell, a: ShellAnchor): boolean {
  const wall = step(a.pos, OPP[a.facing]);
  return (shell.settings ?? []).some((s) => s.kind === 'buried' && (s.front ?? 'south') === a.facing && s.footprint.has(wall[0], wall[2]));
}

function inBuriedFootprint(shell: Shell, p: Vec3): boolean {
  return (shell.settings ?? []).some((s) => s.kind === 'buried' && s.footprint.has(p[0], p[2]));
}

export const isMainDoor = (fronts: ReadonlySet<string>, a: ShellAnchor): boolean => fronts.has(`${cellKey(a.pos[0], a.pos[2])}|${a.facing}`);

export function planEntrances(
  site: ExteriorSite,
  catalog: Catalog,
  doors: readonly ShellAnchor[],
  mains: ReadonlySet<string>,
  style: ExteriorStyle,
  d: number,
  rng: Rng,
  opts: Pick<ExteriorOptions, 'ground' | 'roomTypes' | 'themeId'>,
  warnings: string[],
): void {
  const on = (g: keyof ExteriorStyle): boolean => style[g] !== false;
  const kr = rng.fork('entrance');
  const planter = kr.weighted(PLANTERS, (p) => p[1])[0];
  const signTypes = new Set(style.signRoomTypes ?? DEFAULT_SIGN_ROOM_TYPES);
  // W3-EN: ein Eingangsmodul je Gebäude (Stil → Theme → Standard); fehlt es im Katalog, gilt der alte Weg (X1)
  const kit = entranceKit(catalog, entranceModuleFor(catalog, style, opts.themeId));

  // W4-C Doppeltür: zwei Haustür-Anker nebeneinander (gleiche Richtung) sind ein Eingang; er hängt am Flügel mit der
  // kleineren Koordinate entlang der Wand, der zweite wird übersprungen
  const wideAt = new Set<ShellAnchor>();
  const second = new Set<ShellAnchor>();
  const mainAnchors = doors.filter((a) => isMainDoor(mains, a));
  for (const a of mainAnchors) {
    const next = key3(step(a.pos, alongOf(a.facing)));
    const b = mainAnchors.find((x) => x !== a && x.facing === a.facing && key3(x.pos) === next);
    if (b !== undefined && !second.has(a)) {
      wideAt.add(a);
      second.add(b);
    }
  }

  for (const a of doors) {
    if (second.has(a)) continue;
    const main = isMainDoor(mains, a);
    const along = alongOf(a.facing);
    const col = (k: number, y = a.pos[1]): Vec3 => [a.pos[0] + (along === 'east' ? k : 0), y, a.pos[2] + (along === 'south' ? k : 0)];
    // Spalte k neben der Tür auf der Seite s (Doppeltür: rechts ab dem rechten Flügel gezählt)
    const extra = wideAt.has(a) ? 1 : 0;
    const side = (s: number, k: number, y = a.pos[1]): Vec3 => col(s < 0 ? -k : k + extra, y);
    const baseY = a.pos[1];
    const behind = (p: Vec3): Vec3 => step(p, OPP[a.facing]);

    // E3 Vortreppe (an der Haustür aus den Stücken des Moduls)
    if (on('stoop')) stoop(site, a, main, col, opts.ground, warnings, main ? kit : undefined, extra);

    // E1/E2 Rahmen bzw. Vordach
    const carriers: Carriers = new Set();
    if (main && kit !== undefined) {
      moduleFrame(site, a, kit, style, col, carriers, extra > 0);
    } else if (extra > 0) {
      // Doppeltür ohne Eingangsmodul im Katalog: keine Fassung (die alten Portale sind 3 breit)
    } else {
      const cands: { id: string; variant?: string }[] = [];
      const canopy = [{ id: 'exterior/door_canopy', variant: 'pent' }, { id: 'exterior/door_canopy', variant: 'trapdoor' }];
      if (main) {
        const portalKind = style.portalKind ?? 'timber';
        const portal = [{ id: 'exterior/door_portal', variant: portalKind }, { id: 'exterior/door_portal', variant: portalKind === 'timber' ? 'arch' : 'timber' }];
        if (on('portal') && on('canopy')) cands.push(...portal, { id: 'exterior/door_porch' }, ...canopy);
        else if (on('portal')) cands.push(...portal);
        else if (on('canopy')) cands.push(...canopy);
      } else if (on('canopy') && d > 0) {
        cands.push(...(d >= 1.5 ? canopy : canopy.slice(1)));
      }
      for (const c of cands) {
        const part: Part = { componentId: c.id, ...(c.variant !== undefined ? { variantId: c.variant } : {}), facing: a.facing, local: [1, 0, 0], at: col(0) };
        if (site.commit(c.id === 'exterior/door_portal' ? 'portal' : 'canopy', 'door', a.floorIndex, [part]).length > 0) break;
      }
    }

    // E4 Ausstattung
    if (!on('entranceDecor') || d <= 0) continue;
    if (!main) {
      if (d >= 1) for (const s of [2, -2]) if (wallLantern(site, a, [col(s, baseY + 1)], behind).length > 0) break;
      continue;
    }
    // Laternenpaar: zuerst das des Moduls (Aufhängung wie im Vorbild), bevorzugt an den Pfosten des Türfelds; sonst
    // 2 neben der Tür am Zaun-Arm (Wandvorlagen dort: eine Spalte weiter) bzw. unter der Traufe. Kübel darunter.
    let off = 0;
    const posts = doorFieldPosts(site, a, extra);
    // W9-G4: an der Rundtür eines Erdhauses setzt das Gelände die Laternen auf den Ring (`exterior/earth_portal`)
    const earthDoor = buriedFrontDoor(site.shell, a);
    if (kit !== undefined && !earthDoor) {
      // W7-D: Feuerschalen (Fantasy-Modul) statt des Laternenpaars, wo die Fantasy-Stufe sie vorsieht
      const fire = fantasyPiece(catalog, style, opts.themeId, 'brazier', extra > 0);
      const first = fire === undefined ? [] : [(() => {
        const width = expandComponent(catalog.get(fire.componentId), fire.variantId).size[0];
        return { ...fire, half: (width - 1) / 2, width };
      })()];
      off = moduleLanterns(site, a, kit, col, carriers, extra, first);
    }
    if (off !== 0) {
      // F7 (je Pfosten 1 Zubehör, Laternen nicht gehäuft): die Spalten des Eingangs-Laternenpaars und die gleich daneben
      // gelten als belegte Pfosten – dort hängt keine Fenster- oder Traufenlaterne mehr
      const wall = step(a.pos, OPP[a.facing]);
      const plane = a.facing === 'north' || a.facing === 'south' ? wall[2] : wall[0];
      const c0 = a.facing === 'north' || a.facing === 'south' ? a.pos[0] : a.pos[2];
      for (const k of [off, off + 1]) for (const s of [-1, 1]) site.litPosts.add(`${a.facing}|${plane}|${s < 0 ? c0 - k : c0 + extra + k}`);
    }
    if (off === 0 && !earthDoor) {
      for (const k of [...new Set([...(posts !== undefined ? [posts] : []), 2, 3])]) {
        if (wallLantern(site, a, [side(-1, k, baseY + 1), side(1, k, baseY + 1)], behind).length > 0 || eaveLanterns(site, a, [side(-1, k), side(1, k)])) {
          off = k;
          break;
        }
      }
    }
    if (kr.chance(atDensity(0.7, d))) {
      // Kübelpaar (W3-EN, Vorbilder: Topf-/Buschpaar neben der Tür): direkt neben der Tür, wo kein Gewände steht, sonst
      // eine Spalte weiter; nie unter einer Laterne (die Laterne bleibt frei sichtbar)
      // W9-G4 (27.09.2026, plan/spikes/W9G4_erdhaus.md): an der Rundtür eines Erdhauses (Front einer Lage `buried`) füllen
      // Türblatt und Laternen den Ring (Gelände, `exterior/earth_portal`) – die Kübel stehen außen neben dem Ring
      const spots: readonly (readonly [number, number, number])[] = earthDoor ? [[1, 4, 0], [1, 5, 0]]
        : kit !== undefined ? [[1, 1, 0], [1, 2, 0]] : [[1, 2, 0], [1, 3, 0]];
      for (const [dd, k, y] of spots) {
        if (kit !== undefined && dd === 1 && k === off) continue;
        const parts = [side(-1, k, baseY + y), side(1, k, baseY + y)].map((p): Part => ({ componentId: 'exterior/planter', variantId: planter, facing: a.facing, at: step(p, a.facing, dd - 1) }));
        // Erdhaus: nur vor der Front, nie in den Flanken des Hügels daneben (dort liegt Erde)
        if (earthDoor && !parts.every((p) => inBuriedFootprint(site.shell, behind(p.at)))) continue;
        if (site.commit('entranceDecor', 'door', a.floorIndex, parts).length > 0) {
          if (dd === 1) off = Math.max(off, k);
          break;
        }
      }
    }
    let benchSide = 0;
    if (kr.chance(atDensity(0.5, d))) {
      const first = kr.chance(0.5) ? 1 : -1;
      const from = Math.max(3, off + 1);
      // lange Bank, sonst kurze; je Seite ab `from` oder eine Spalte weiter
      const tries = (['long', 'short'] as const).flatMap((v) => [first, -first].flatMap((s) => [0, 1].map((shift) => ({ v, s, shift }))));
      for (const { v, s, shift } of tries) {
        const w = v === 'long' ? 4 : 3;
        const cols = Array.from({ length: w }, (_, k) => side(s, from + shift + k));
        const lo = s > 0 ? cols[0]! : cols[w - 1]!;
        // lokales x läuft in Weltrichtung rotateDir(east, rot); Anker so, dass die Bank genau diese Spalten deckt
        const local: Vec3 = rotateDir('east', rotFor(a.facing)) === along ? [0, 0, 0] : [w - 1, 0, 0];
        const part: Part = { componentId: 'exterior/bench', variantId: v, facing: a.facing, local, at: lo };
        if (site.commit('entranceDecor', 'door', a.floorIndex, [part], () => cols.every((p) => site.solidWall(behind(p)))).length > 0) {
          benchSide = s;
          break;
        }
      }
    }
    const roomType = a.roomId !== undefined ? opts.roomTypes?.[a.roomId] : undefined;
    if (roomType !== undefined && signTypes.has(roomType)) {
      // W3-EN: mit Laternenpaar eine Spalte Abstand zum Laternen-Arm (sonst verschmelzen Arm und Schild zu einer Stange)
      const ks = off !== 0 && kit !== undefined ? [off + 2, off + 1] : [Math.max(3, off + 1)];
      search: for (const k of ks) {
        for (const s of benchSide !== 0 ? [-benchSide] : [1, -1]) {
          const at = side(s, k, baseY + 1);
          const arm = up(at);
          if (site.commit('entranceDecor', 'door', a.floorIndex, [{ componentId: 'exterior/shop_sign', facing: a.facing, at }], () => site.solidWall(behind(arm))).length > 0) break search;
        }
      }
    }
  }
}

/**
 * W2: Abstand der beiden Pfosten des Rasterfelds, in dem die Tür liegt (Tür mittig im Feld → beide gleich weit);
 * `undefined` ohne Raster, bei unsymmetrischem Feld oder Abstand < 2.
 */
function doorFieldPosts(site: ExteriorSite, a: ShellAnchor, extra = 0): number | undefined {
  const grid = site.shell.facadeGrid;
  if (grid === undefined) return undefined;
  const ns = a.facing === 'north' || a.facing === 'south';
  const wall = step(a.pos, OPP[a.facing]);
  const plane = ns ? wall[2] : wall[0];
  const col = ns ? a.pos[0] : a.pos[2];
  const y0 = site.levelOf(a.floorIndex, a.pos)?.y0;
  const line = grid.find((g) => g.out === a.facing && g.plane === plane && g.y0 === y0 && g.from <= col && g.to >= col);
  const bay = line?.bays.find((b) => b.from <= col && b.to >= col);
  if (bay === undefined) return undefined;
  const left = col - (bay.from - 1);
  const right = bay.to + 1 - (col + extra);
  return left === right && right >= 2 ? right : undefined;
}

/** Laterne(n) am Zaun-Arm: Laterne auf `at`, Zaun darüber an einer Wand/Pfosten. Alle oder keine. */
function wallLantern(site: ExteriorSite, a: ShellAnchor, ats: readonly Vec3[], behind: (p: Vec3) => Vec3) {
  return site.commit('entranceDecor', 'door', a.floorIndex, ats.map((at): Part => ({ componentId: 'exterior/wall_lantern', facing: a.facing, at })), () =>
    ats.every((at) => site.solidWall(behind(up(at)))));
}

/** Ersatz: Laternenpaar unter dem Dachüberstand über den Spalten `cols` (erste tragende Unterseite ab Kopfhöhe). */
function eaveLanterns(site: ExteriorSite, a: ShellAnchor, cols: readonly Vec3[]): boolean {
  const level = site.levelOf(a.floorIndex, a.pos);
  if (level === undefined) return false;
  const ats: Vec3[] = [];
  for (const c of cols) {
    let y = c[1] + 2;
    while (y <= level.topY + 1 && site.at(up([c[0], y, c[2]])) === undefined) y++;
    const at: Vec3 = [c[0], y, c[2]];
    if (y > level.topY + 1 || !site.hangsFrom(at)) return false;
    ats.push(at);
  }
  if (ats.some((p) => p[1] !== ats[0]![1])) return false;
  return site.commit('entranceDecor', 'door', a.floorIndex, ats.map((at): Part => ({ componentId: 'exterior/eave_lantern', facing: a.facing, at }))).length > 0;
}

/**
 * E3: Stufe bzw. Podest + Treppe vor der Tür, abhängig von der Geländehöhe. W3-EN: an der Haustür aus den Stücken
 * `step`/`block` des Eingangsmoduls (eigenes Material, abgesetzt vom Sockelprofil), sonst `exterior/stoop`.
 */
function stoop(
  site: ExteriorSite, a: ShellAnchor, main: boolean, col: (k: number, y?: number) => Vec3, ground: ExteriorOptions['ground'], warnings: string[],
  kit?: EntranceKit,
  extra = 0,
): void {
  const y0 = a.pos[1] - 1;
  const groundAt = (p: Vec3): number => ground?.(p[0], p[2]) ?? y0 - 1;
  const front = col(0, y0);
  // W4-C: vor einer Doppeltür liegen Stufe bzw. Podest vor beiden Flügeln
  const fronts = extra > 0 ? [front, col(1, y0)] : [front];
  const rise = y0 - groundAt(front);
  if (rise <= 0) return;
  const stepId = kit?.step === true ? kit.componentId : 'exterior/stoop';
  const blockId = kit?.block === true ? kit.componentId : 'exterior/stoop';
  const stepPart = (at: Vec3): Part => ({ componentId: stepId, variantId: 'step', facing: a.facing, at });
  const blockPart = (at: Vec3): Part => ({ componentId: blockId, variantId: 'block', facing: a.facing, at });
  if (rise === 1) {
    if (site.commit('stoop', 'door', a.floorIndex, fronts.map(stepPart)).length > 0 && main) {
      site.commit('stoop', 'door', a.floorIndex, [stepPart(col(-1, y0)), stepPart(col(1 + extra, y0))]);
    }
    return;
  }
  if (rise > 4) {
    warnings.push(`Vortreppe: Tür bei ${a.pos.join(',')} liegt ${rise} Blöcke über dem Gelände (höchstens 4) – Gelände anheben`);
    return;
  }
  // Podest vor der Tür, Stufen nach außen bis zum Boden, darunter Unterbau
  const parts: Part[] = [];
  const fill = (p: Vec3, g: number): void => {
    for (let y = g + 1; y < p[1]; y++) parts.push(blockPart([p[0], y, p[2]]));
  };
  const walk: Vec3[] = [];
  for (const f of fronts) {
    parts.push(blockPart(f));
    fill(f, groundAt(f));
    for (let k = 1; ; k++) {
      const p = step(f, a.facing, k);
      const at: Vec3 = [p[0], y0 - k, p[2]];
      const g = groundAt(at);
      if (at[1] <= g || k > 4) break;
      parts.push(stepPart(at));
      fill(at, g);
      walk.push(up(at), up(at, 2));
    }
  }
  if (site.commit('stoop', 'door', a.floorIndex, parts).length > 0) for (const w of walk) site.reserve(w, 'walk');
}

