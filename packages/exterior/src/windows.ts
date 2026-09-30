/**
 * Fenster (research/18 §7, research/16 F1/F2, research/12 §6.3; W2-FW plan/spikes/W2FW_fenster.md) am Anker `window`.
 *
 * W2-FW: Jedes Fenster bekommt ein **Fenstermodul** aus dem Katalog (`exterior/window_module_<id>`, eine Katalogeinheit
 * mit ihren Stücken als Varianten). Das Modul gilt für das ganze Gebäude (Stil `windowModule`, sonst das Modul, dessen
 * `styleTags` das Theme nennen, sonst `townhouse`); der Planer setzt die Stücke je Fenster (Breite `span`, Höhe `h`):
 *
 *   Ansicht (Fenster 1 × 2, Stadthaus)      Schnitt (x < 0 außen)
 *     . L L L .    L Sturz (lintel)           y+h   L .     alles 1 Block vor der Wand – das Glas in der Wandebene
 *     F J g J .    J Laden bzw. Wange (jamb)  y     o g     wirkt 1 Block zurückgesetzt (Laibung)
 *     o J g J o    F/o Laterne am Zaun-Arm    y−1   B #  t  o Blume vor der untersten Scheibe (durchsichtig)
 *     . S S S .    S Bank (sill) bzw. Kasten  B Kasten (Erde, Falltür t davor) bzw. Bank
 *
 * Regeln:
 *  - Die Ecken von Sturz und Bank (Spalten −1 und `span`) setzt die Hülle schon als Rahmen (`FacadeRules.windowFrame`,
 *    gleiche Rolle und Form); fehlen sie, setzt das Modul sie selbst („breit“), sonst nur die Mitte („schmal“).
 *  - Baustandard F6 „Deko-Kit je Seite“: Seite = Außenrichtung + Wandebene (ohne Geschoss). Jedes Stück wird für
 *    **alle** Fenster einer Linie gesetzt oder für keins; passt es an einem Fenster nicht, fällt die ganze Linie auf das
 *    nächstkleinere zurück (Kasten → Bank breit → Bank schmal → nichts; Sturz breit → schmal → nichts). Giebelfenster
 *    sind eine eigene Linie (Wangen, Sturz, Bank – kein Kasten). Pflanze des Kastens: je Seite eine.
 *  - Jede Seite bekommt ihr Modul, sobald die Dichte > 0 ist (Ziel: jedes Fenster, wo Platz ist; die Dichte steuert
 *    nur noch die Laternen).
 *  - Läden nur bei Fensterbreite 1–2 und nur vor Wand/Pfosten; Kasten nur, wenn alle Fenster der Seite im Erdgeschoss
 *    oder 1. OG liegen (sonst die Bank für die ganze Seite, W4: F6 „ein Kit je Seite“).
 *    Vor einer Scheibe steht nie ein Block außer der Kastenpflanze (Baustandard F5).
 *  - Baustandard F8 „Traufzone frei“: kein Stück, zwischen dem und der Fensterreihe Dach derselben Etage liegt.
 *  - Laternen (`planWindowLanterns`, nach dem Eingang): Zaun-Arm auf der Sturzreihe, Laterne darunter (liegt dort die
 *    Traufe: direkt unter dem Überstand; liegt dort ein Gesims: Zaun eine Reihe tiefer) – an den Rasterpfosten der
 *    untersten Fensterlinie jeder Seite (spiegelgleich von der Mitte aus: das innerste Paar bzw. der Mittelpfosten
 *    immer, weiter außen im Abstand ≥ round(8/Dichte)); ohne Pfosten links und rechts neben dem mittleren Fenster. Nie
 *    im Eingangsbereich (±2 um Türen – dort hängen die Eingangslaternen). Eine Aufhängung je Seite.
 *    W6 (Review W4-R R2): bleibt eine Seite mit Fenstern dabei ohne jede Laterne (Deko-Budget F7 voll, Pfosten belegt),
 *    bekommt sie ein Paar als Mindestlicht vor dem Budget (`planWindowLanterns`).
 */
import type { FacadeGridLine, ShellAnchor } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { Rng, key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import { fantasyPiece } from './fantasy.js';
import { chooseModule } from './modules.js';
import { OPP, alongOf, step, up, type ExteriorSite, type Part } from './site.js';
import { DEFAULT_WINDOW_MODULE, WINDOW_MODULES, type ExteriorGroup, type ExteriorStyle, type WindowModuleId } from './types.js';

/** Katalog-ID eines Fenstermoduls. */
export const windowModuleComponent = (id: WindowModuleId): string => `exterior/window_module_${id}`;

/**
 * Fenstermodul eines Gebäudes: Stil → Theme (`styleTags` des Moduls, Reihenfolge `WINDOW_MODULES`) → Standard; W5-B mit
 * `themeMaterial` nur, wenn das Modul des Stils zum Wandmaterial des Themes passt (`chooseModule`).
 */
export function windowModuleFor(catalog: Catalog, style: ExteriorStyle, themeId: string | undefined): WindowModuleId {
  return chooseModule(catalog, style.windowModule, style.themeMaterial, themeId, WINDOW_MODULES, DEFAULT_WINDOW_MODULE, windowModuleComponent);
}

/** Was ein Modul mitbringt (aus seinen Varianten gelesen). */
interface ModuleKit {
  readonly componentId: string;
  readonly lintel: boolean;
  readonly sill: boolean;
  /** Laden (Falltür, Gruppe `shutters`) bzw. Wange (Stamm/Stein, Gruppe `hoods`); fehlt = keine. */
  readonly jamb?: 'shutter' | 'frame';
  /** Kasten-Varianten `box_*` mit Gewicht. */
  readonly boxes: readonly (readonly [string, number])[];
  readonly lantern: boolean;
  /** W4: Akzent im Obergeschoss (Laterne an Kette neben dem Mittelfenster, Variante `chain_lantern`). */
  readonly accent: boolean;
  /**
   * W7: Rahmen passt sich dem Feld an (Katalog-Tag `frame_fit`): Bank, Sturz und Kasten nur so breit wie die Scheibe,
   * wenn neben dem breiten Modul keine Wand frei bliebe (Joch 3).
   */
  readonly fitFrame: boolean;
  /**
   * W9-G2 (27.09.2026, plan/spikes/W9G2_fensterrahmen.md): Rahmenwange (Variante `frame_jamb`) – wo die Läden keine
   * Luft haben (W7-A „Läden nur mit Luft“), schließt eine flache Wange im Holz der Läden Sturz und Bank zu einem Rahmen.
   */
  readonly frameJamb: boolean;
}

export function moduleKit(catalog: Catalog, id: WindowModuleId): ModuleKit | undefined {
  const componentId = windowModuleComponent(id);
  const def = catalog.find(componentId);
  if (def === undefined) return undefined;
  const vs = def.variants ?? [];
  const has = (v: string): boolean => vs.some((x) => x.id === v);
  const jamb = vs.find((x) => x.id === 'jamb');
  // Laden = Falltür (Gruppe `shutters`), sonst Wange/Rahmen (Stamm, Stein; Gruppe `hoods`)
  const jambShape = jamb === undefined ? undefined : Object.values(jamb.legend ?? {})[0]?.shape;
  return {
    componentId,
    lintel: has('lintel'),
    sill: has('sill'),
    ...(jamb !== undefined ? { jamb: jambShape === 'trapdoor' ? 'shutter' : 'frame' } : {}),
    boxes: vs.filter((x) => x.id.startsWith('box_')).map((x) => [x.id, x.weight ?? 1] as const),
    lantern: has('lantern'),
    accent: has('chain_lantern'),
    fitFrame: (def.tags ?? []).includes('frame_fit'),
    frameJamb: has('frame_jamb'),
  };
}

/** Scheibenhöhe eines Fensterankers (Fensterzellen übereinander in der Wand). */
export function paneHeight(site: ExteriorSite, a: ShellAnchor): number {
  const wall = step(a.pos, OPP[a.facing]);
  let h = 0;
  while (site.at(up(wall, h))?.kind === 'window') h++;
  return Math.max(1, h);
}

/** Wandebene einer Fassade (Koordinate quer zur Wand). */
export const planeOf = (a: Pick<ShellAnchor, 'pos' | 'facing'>): number => (a.facing === 'north' || a.facing === 'south' ? a.pos[2] : a.pos[0]);
export const facadeKey = (a: Pick<ShellAnchor, 'pos' | 'facing' | 'floorIndex'>): string => `${a.floorIndex}|${a.facing}|${planeOf(a)}`;
/** W2: Schlüssel einer Seite (ohne Geschoss) – ein Deko-Kit je Seite. */
export const sideKey = (a: Pick<ShellAnchor, 'pos' | 'facing'>): string => `${a.facing}|${planeOf(a)}`;

/** Ein Teil je Fenster einer Linie: Platzierungen und Zusatzbedingung (Wand dahinter …). */
interface Entry {
  readonly floorIndex: number;
  readonly parts: readonly Part[];
  readonly extra?: () => boolean;
}

/** Prüft alle Einträge gemeinsam (auch gegeneinander), ohne zu setzen. */
function fitsAll(site: ExteriorSite, entries: readonly Entry[]): boolean {
  const pending = new Set<string>();
  for (const e of entries) {
    if (e.parts.length === 0 || (e.extra !== undefined && !e.extra())) return false;
    for (const part of e.parts) {
      const p = site.placed(part);
      if (!site.fits(p, pending)) return false;
      for (const c of p.cells) pending.add(key3(c.pos));
    }
  }
  return true;
}

/** Alle oder keins (F6). Leere Liste = nichts zu tun (gilt als nicht gesetzt). */
function commitAll(site: ExteriorSite, group: ExteriorGroup, entries: readonly Entry[]): boolean {
  if (entries.length === 0 || !fitsAll(site, entries)) return false;
  for (const e of entries) site.commit(group, 'window', e.floorIndex, e.parts, e.extra);
  return true;
}

/** Erste Variante, die für alle Fenster passt (in der gegebenen Reihenfolge); `undefined` = keine. */
function firstFitting(site: ExteriorSite, group: ExteriorGroup, variants: readonly (readonly Entry[])[]): number | undefined {
  for (let k = 0; k < variants.length; k++) if (commitAll(site, group, variants[k]!)) return k;
  return undefined;
}

/** Geometrie eines Fensterankers: Spalten entlang der Wand (k = 0 … span−1 Glas, −1 und span daneben). */
function geo(site: ExteriorSite, a: ShellAnchor) {
  const span = a.span ?? 1;
  const h = paneHeight(site, a);
  const along = alongOf(a.facing);
  const col = (k: number, y = a.pos[1]): Vec3 => [a.pos[0] + (along === 'east' ? k : 0), y, a.pos[2] + (along === 'south' ? k : 0)];
  const cols = (from: number, to: number, y: number): Vec3[] => Array.from({ length: to - from + 1 }, (_, i) => col(from + i, y));
  const wallBehind = (p: Vec3): boolean => site.solidWall(step(p, OPP[a.facing]));
  const base = site.levelOf(a.floorIndex, a.pos)?.baseY ?? a.pos[1];
  return { span, h, col, cols, wallBehind, base };
}

/**
 * Rahmenecke: frei (das Modul setzt sie) oder schon ein Rahmen der Hülle derselben Form (`window_frame`) – dann bleibt
 * sie, wie sie ist. `undefined` = weder noch (die breite Form passt nicht).
 */
function corner(site: ExteriorSite, p: Vec3, shape: string): 'free' | 'frame' | undefined {
  const c = site.at(p);
  // Sturz (umgedrehte Treppe) und Bank (obere Stufe) liegen beide in der oberen Hälfte
  if (c !== undefined) return c.kind === 'facade' && c.role === 'window_frame' && c.shape === shape && c.orient?.half === 'top' ? 'frame' : undefined;
  return site.outside(p) && !site.isTaken(p) ? 'free' : undefined;
}

export function planWindows(
  site: ExteriorSite, catalog: Catalog, windows: readonly ShellAnchor[], style: ExteriorStyle, rng: Rng, themeId?: string,
): void {
  const on = (g: keyof ExteriorStyle): boolean => style[g] !== false;
  const kit = moduleKit(catalog, windowModuleFor(catalog, style, themeId));
  if (kit === undefined) return;
  const cid = kit.componentId;
  const piece = (variantId: string, facing: HorizontalDir, at: Vec3, stretch?: number): Part => ({
    componentId: cid, variantId, facing, at, ...(stretch !== undefined && stretch > 0 ? { stretch } : {}),
  });

  // Seiten in fester Reihenfolge; Giebelfenster (über der obersten Wandreihe) bilden je Seite eine eigene Linie
  const sides = new Map<string, { anchors: ShellAnchor[]; gable: ShellAnchor[] }>();
  const sorted = [...windows].sort((a, b) => sideKey(a).localeCompare(sideKey(b)) || a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2]);
  for (const a of sorted) {
    const level = site.levelOf(a.floorIndex, a.pos);
    if (level === undefined) continue;
    const s = sides.get(sideKey(a)) ?? sides.set(sideKey(a), { anchors: [], gable: [] }).get(sideKey(a))!;
    (a.pos[1] > level.topY ? s.gable : s.anchors).push(a);
  }

  for (const [key, side] of sides) {
    const fr = rng.fork(`side|${key}`);
    const box = kit.boxes.length > 0 ? fr.weighted(kit.boxes, (b) => b[1])[0] : undefined;

    for (const [line, gable] of [[side.anchors, false], [side.gable, true]] as const) {
      if (line.length === 0) continue;
      // W7: breites Modul (Rahmen-Ecken, Läden/Wangen in den Spalten neben der Scheibe) nur, wenn daneben Wand frei bleibt
      // W7 (27.09.2026, plan/spikes/W7A_ruhe.md, Vorbilder V1–V19): Läden nur mit Luft – daneben bleibt je Fenster der
      // Linie mindestens eine Spalte Wand bis zum Pfosten bzw. zur nächsten Öffnung; im engen Feld (Joch 3) entfallen sie
      // W13-E (28.09.2026, Nutzerbefund „Obergeschoss flach“): an Hüllen mit Wandkleid der Obergeschosse
      // (`Shell.upperFrame`) rahmt im Fachwerk nicht nur das Holz der Wand – Läden dürfen vor die Laibungsständer
      // klappen (Vorbilder: geöffnete Läden vor dem Ständer, reddit 1mqe6ho, YT 1XXpmsOBWpE), Bank und Sturz laufen über
      // die ganze Breite (Tiefe vor dem Ständer). Ohne `upperFrame` bitgleich.
      const upper = site.shell.upperFrame === true;
      const framedTimber = (a: ShellAnchor): boolean => upper && timberLine(site, a);
      const roomyLine = line.every((a) => roomy(site, a) || (framedTimber(a) && studJambs(site, a)));
      const shuttersFit = kit.jamb !== 'shutter' || roomyLine;

      // Laden bzw. Wange links und rechts, so hoch wie das Fenster, nur vor Wand/Pfosten
      const jambOf = (variant: string) => (a: ShellAnchor): Entry => {
        const { h, col, span, wallBehind, base } = geo(site, a);
        const at = [col(-1), col(span)];
        return {
          floorIndex: a.floorIndex,
          parts: at.map((p) => piece(variant, a.facing, p, h - 1)),
          // F8: nicht auf der Dachfläche (Gaube) – kein Dach derselben Etage unter dem Stück
          extra: () => at.every((s) => Array.from({ length: h }, (_, k) => up(s, k)).every(wallBehind) && belowEave(site, up(s, h - 1), base)),
        };
      };
      const jambOn = kit.jamb === 'shutter' ? on('shutters') : on('hoods');
      let jambed = false;
      if (shuttersFit && kit.jamb !== undefined && jambOn && !(kit.jamb === 'shutter' && line.some((a) => (a.span ?? 1) > 2))) {
        jambed = commitAll(site, kit.jamb === 'shutter' ? 'shutters' : 'hoods', line.map(jambOf('jamb')));
      }

      // Sturz über der obersten Scheibe: breit (mit Ecken, wo die Hülle keine setzt) → schmal → nichts
      // W9-G2 (27.09.2026): Fenster, deren Sturzreihe schon in der Traufe liegt (F8), deckt die Traufe – sie fallen aus
      // der Linie heraus, statt der ganzen Seite (auch dem Erdgeschoss) den Sturz zu nehmen (vorher: EG ohne Sturz, weil
      // das Obergeschoss direkt unter der Traufe liegt)
      const lintelOf = (a: ShellAnchor, wide: boolean): Entry => {
        const { span, h, col, cols, base } = geo(site, a);
        const y = a.pos[1] + h;
        const ends = wide ? [col(-1, y), col(span, y)].map((p) => [p, corner(site, p, 'stairs')] as const) : [];
        const range = [...cols(0, span - 1, y), ...ends.filter(([, c]) => c === 'free').map(([p]) => p)];
        return {
          floorIndex: a.floorIndex,
          parts: range.map((p) => piece('lintel', a.facing, p)),
          // F8: auch nicht über der Dachfläche (Gaube) – kein Dach derselben Etage unter dem Sturz
          extra: () => ends.every(([, c]) => c !== undefined) && cols(-1, span, y).every((p) => belowEave(site, p, base)),
        };
      };
      // Sturzreihe schon von der Hülle belegt (Traufe, Gesims, Geschossband) oder in der Traufzone: dort deckt die Hülle
      const lintelLine = line.filter((a) => {
        const { span, h, cols, base } = geo(site, a);
        const y = a.pos[1] + h;
        return cols(0, span - 1, y).every((p) => site.outside(p)) && cols(-1, span, y).every((p) => belowEave(site, p, base));
      });
      const lintels = kit.lintel && on('hoods');

      // W9-G2 (27.09.2026, plan/spikes/W9G2_fensterrahmen.md; Vorbilder: jedes Fenster ganz gerahmt aus Sturz, Bank und
      // Wangen): haben die Läden keine Luft (W7-A), schließt die Rahmenwange des Moduls (flache Falltür, Gruppe `hoods`)
      // Sturz und Bank zu einem Rahmen aus einem Guss. Je Fensterreihe der Seite ganz oder gar nicht (F6), nur vor
      // schlichter Wand (kein Rasterpfosten, keine Öffnung daneben) und nur, wenn der breite Sturz mitpasst (sonst bliebe
      // ein Kreuz aus schmalem Sturz, Bank und Wangen).
      //  - Fachwerk-Linien (`FacadeGridLine.studs`): dort rahmt das Fachwerk selbst – Laibungsständer neben jeder Öffnung,
      //    Riegel darüber und darunter (materialize `bayLayout`). Keine Wange, und Sturz/Bank/Kasten nur so breit wie die
      //    Scheibe (die Ecken lägen vor den Ständern und trügen nichts bei).
      //  - Module mit `frame_fit` (Cottage: Rahmenholz = Wandholz, enges Feld) rahmen nur die unterste Fensterreihe der
      //    Seite, dort steht der Betrachter; darüber bleibt das schmale, ruhige Modul (F7).
      const framed = new Set<ShellAnchor>();
      // Ohne Fassadenraster (alte Hüllen) bleibt alles wie bisher: dort ist weder Fachwerk noch Pfosten bekannt
      if (!jambed && kit.frameJamb && on('hoods') && site.shell.facadeGrid !== undefined) {
        const low = Math.min(...line.map((a) => a.pos[1]));
        const rows = [...new Set(line.map((a) => a.pos[1]))].filter((y) => !kit.fitFrame || y === low);
        for (const y of rows) {
          const row = line.filter((a) => a.pos[1] === y);
          if (!row.every((a) => (a.span ?? 1) <= 2 && !timberLine(site, a) && plainJambs(site, a))) continue;
          const ring = row.map(jambOf('frame_jamb'));
          const top = lintels ? lintelLine.filter((a) => row.includes(a)).map((a) => lintelOf(a, true)) : [];
          if (fitsAll(site, [...ring, ...top]) && commitAll(site, 'hoods', ring)) for (const a of row) framed.add(a);
        }
      }
      const wideFrame = !kit.fitFrame || roomyLine;
      const wide = (a: ShellAnchor): boolean => jambed || framed.has(a) || (wideFrame && (!timberLine(site, a) || framedTimber(a)));
      const anyWide = line.some(wide);

      // Rückfall: erst die gerahmten Fenster breit, die übrigen schmal – ein Rahmen verliert nie seine Ecken
      const framedWide = (a: ShellAnchor): boolean => jambed || framed.has(a);
      const widths = [...(anyWide ? [wide] : []), ...(framed.size > 0 ? [framedWide] : []), () => false];
      if (lintels) firstFitting(site, 'hoods', widths.map((w) => lintelLine.map((a) => lintelOf(a, w(a)))));

      // Kasten bzw. Bank eine Reihe unter der untersten Scheibe; Kasten nur EG und 1. OG (darüber Bank), nie am Giebel
      // F8: Bank und Kasten nie auf der Dachfläche (Gaube) – kein Dach derselben Etage darunter
      const sillOf = (a: ShellAnchor, wide: boolean): Entry => {
        const { span, col, cols, base } = geo(site, a);
        const y = a.pos[1] - 1;
        // W7: mit Fassadenraster ist „schmal“ wirklich schmal (nur unter der Scheibe) – ohne Raster wie bisher (schmal = die
        // Ecken der Hülle bleiben, freie Ecken setzt das Modul)
        const ends = wide || site.shell.facadeGrid === undefined ? [col(-1, y), col(span, y)].map((p) => [p, corner(site, p, 'slab')] as const) : [];
        const range = [...cols(0, span - 1, y), ...ends.filter(([, c]) => c === 'free').map(([p]) => p)];
        return {
          floorIndex: a.floorIndex,
          parts: range.map((p) => piece('sill', a.facing, p)),
          extra: () => ends.every(([, c]) => c !== undefined) && range.every((p) => belowEave(site, p, base)),
        };
      };
      const boxOf = (a: ShellAnchor): Entry => {
        const { span, col, cols, wallBehind, base } = geo(site, a);
        const y = a.pos[1] - 1;
        const ends = wide(a) ? [col(-1, y), col(span, y)].map((p) => [p, corner(site, p, 'slab')] as const) : [];
        return {
          floorIndex: a.floorIndex,
          parts: [...cols(0, span - 1, y).map((p) => piece(box!, a.facing, p)), ...ends.filter(([, c]) => c === 'free').map(([p]) => piece('sill', a.facing, p))],
          extra: () => cols(0, span - 1, y).every(wallBehind) && ends.every(([, c]) => c !== undefined) && cols(-1, span, y).every((p) => belowEave(site, p, base)),
        };
      };
      // W13-E: kein Bank-/Kasten-Stück direkt über dem Sturz bzw. Geschossband des Fensters darunter (Stadthaus: Sturz,
      // Schwelle und Bank lagen als Plattenbündel übereinander) – das Fenster darüber verzichtet auf seine Bank
      const sillLine = upper ? line.filter((a) => !stackedBelow(site, a)) : line;
      const boxes = box !== undefined && on('flowerBoxes') && !gable;
      const sills = kit.sill && on('sills');
      const tries: Array<{ entries: Entry[]; boxed: boolean }> = [];
      // W4 (27.09.2026, Review S4, Baustandard F6): ein Kit je Seite – Kästen nur, wenn alle Fenster der Seite im EG oder
      // 1. OG liegen; reicht die Seite höher, bekommt sie überall die Bank (vorher Kasten unten, Bank oben: gemischte Seite)
      if (boxes && line.every((a) => a.floorIndex <= 1)) tries.push({ entries: sillLine.map(boxOf), boxed: true });
      if (sills) tries.push(...widths.map((w) => ({ entries: sillLine.map((a) => sillOf(a, w(a))), boxed: false })));
      for (const t of tries) {
        if (!fitsAll(site, t.entries)) continue;
        // Kasten → flowerBoxes, Bank → sills (gemischt: Kasten unten, Bank ab dem 2. OG – gemeinsam geprüft)
        const isBox = (e: Entry): boolean => t.boxed && e.parts.some((p) => p.variantId?.startsWith('box_') === true);
        commitAll(site, 'flowerBoxes', t.entries.filter(isBox));
        commitAll(site, 'sills', t.entries.filter((e) => !isBox(e)));
        break;
      }
    }
  }
}

/**
 * Laternen der Fenstermodule (W2-FW, Baustandard F7): je Seite an der untersten Fensterlinie, Zaun-Arm auf der
 * Sturzreihe, Laterne darunter. Kandidaten: Rasterpfosten der Linie (sonst links/rechts neben dem mittleren Fenster);
 * das innerste Paar (bzw. der Mittelpfosten) zuerst, weiter außen spiegelgleich im Abstand ≥ `gap`. Nie im
 * Eingangsbereich (±2 um Türen derselben Seite), nur mit Wand hinter dem Zaun und unter der Traufe. Gesetzte Pfosten
 * stehen danach in `site.litPosts` (dort hängt keine zweite Laterne unter der Traufe, F7 „je Pfosten 1 Zubehör“).
 */
export function planWindowLanterns(
  site: ExteriorSite, catalog: Catalog, windows: readonly ShellAnchor[], doors: readonly ShellAnchor[], style: ExteriorStyle, d: number, themeId?: string,
): void {
  const kit = moduleKit(catalog, windowModuleFor(catalog, style, themeId));
  if (kit === undefined || !kit.lantern) return;
  // W7-D: mit Fantasy-Stufe hängt die Laterne am geschwungenen Arm (Kopfband + Zaun 2 vor) statt am geraden Zaun-Arm –
  // gleicher Ort, gleiche Aufhängung (Zaun auf der Sturzreihe, Laterne darunter)
  const arm = fantasyPiece(catalog, style, themeId, 'lantern_arm') ?? { componentId: kit.componentId, variantId: 'lantern' };
  const gap = Math.max(3, Math.round(8 / d));
  const grid = site.shell.facadeGrid ?? [];
  const bySide = new Map<string, ShellAnchor[]>();
  for (const a of [...windows].sort((p, q) => sideKey(p).localeCompare(sideKey(q)) || p.pos[1] - q.pos[1] || p.pos[0] - q.pos[0] || p.pos[2] - q.pos[2])) {
    const lvl = site.levelOf(a.floorIndex, a.pos);
    if (lvl === undefined || a.pos[1] > lvl.topY) continue; // Giebelfenster: keine Laterne
    (bySide.get(sideKey(a)) ?? bySide.set(sideKey(a), []).get(sideKey(a))!).push(a);
  }
  for (const [key, list] of bySide) {
    // unterste Fensterlinie der Seite (niedrigste Scheibe; mehrere Etagen-Indizes auf gleicher Höhe zählen zusammen)
    const lowY = Math.min(...list.map((a) => a.pos[1]));
    const line = list.filter((a) => a.pos[1] === lowY);
    const a0 = line[0]!;
    const out = a0.facing;
    const ns = out === 'north' || out === 'south';
    const coord = (p: Vec3): number => (ns ? p[0] : p[2]);
    const lvl = site.levelOf(a0.floorIndex, a0.pos);
    if (lvl === undefined) continue;
    const h = Math.min(...line.map((a) => paneHeight(site, a)));
    const at = (c: number, y: number): Vec3 => (ns ? [c, y, a0.pos[2]] : [a0.pos[0], y, c]);
    const wallPlane = planeOf({ pos: step(a0.pos, OPP[out]), facing: out });
    const nearDoor = (c: number): boolean => doors.some((dr) => dr.facing === out && planeOf(dr) === planeOf(a0) && Math.abs(coord(dr.pos) - c) <= 2 && Math.abs(dr.pos[1] - lowY) <= 3);
    // Arten der Aufhängung, eine je Seite: Zaun-Arm auf der Sturzreihe; liegt dort die Traufe, hängt die Laterne direkt
    // unter dem Überstand (wie die Traufenlaternen); liegt dort ein Gesims, Zaun-Arm eine Reihe tiefer
    type Mount = { readonly kind: 'fence' | 'eave'; readonly y: number };
    const mounts: Mount[] = [{ kind: 'fence', y: lowY + h }, { kind: 'eave', y: lowY + h - 1 }, ...(h >= 2 ? [{ kind: 'fence', y: lowY + h - 1 } as const] : [])];
    const ok = (c: number, m: Mount): boolean => {
      if (nearDoor(c) || site.litPosts.has(`${out}|${wallPlane}|${c}`)) return false;
      if (m.kind === 'eave') return site.hangsFrom(at(c, m.y));
      const fence = at(c, m.y);
      return site.solidWall(step(fence, OPP[out])) && belowEave(site, fence, lvl.baseY);
    };
    const gl = grid.find((g) => g.out === out && g.plane === wallPlane && g.y0 === lvl.y0 && line.some((a) => coord(a.pos) >= g.from && coord(a.pos) <= g.to));
    const lo = Math.min(...line.map((a) => coord(a.pos)));
    const hi = Math.max(...line.map((a) => coord(a.pos) + (a.span ?? 1) - 1));
    const c2 = gl !== undefined ? gl.from + gl.to : lo + hi;
    // Kandidaten als Paare (c, Spiegelung) von der Mitte nach außen
    // W7: im Fachwerk nur an Ständern (`studs`)
    const posts = gl !== undefined ? (gl.studs ?? gl.posts).filter((p) => p > lo - 3 && p < hi + 3) : [];
    const pairs: number[][] = [];
    const seen = new Set<number>();
    for (const p of [...posts].sort((x, y) => Math.abs(2 * x - c2) - Math.abs(2 * y - c2) || x - y)) {
      if (seen.has(p)) continue;
      const pair = [...new Set([p, c2 - p])].filter((q) => q === p || posts.includes(q));
      if (pair.length === 1 && 2 * p !== c2) continue; // ohne Spiegelpfosten: unsymmetrisch
      pair.forEach((q) => seen.add(q));
      pairs.push(pair.sort((x, y) => x - y));
    }
    // ohne Pfosten: neben dem mittleren Fenster (2 bzw. 3 Spalten neben der Scheibe, außerhalb des Moduls)
    const mid = [...line].sort((p, q) => Math.abs(2 * coord(p.pos) + (p.span ?? 1) - 1 - c2) - Math.abs(2 * coord(q.pos) + (q.span ?? 1) - 1 - c2))[0]!;
    const m0 = coord(mid.pos);
    const m1 = m0 + (mid.span ?? 1) - 1;
    const flank = [[m0 - 2, m1 + 2], [m0 - 3, m1 + 3]];
    const chosen: number[] = [];
    let any = false;
    let fixed: Mount | undefined;
    const free = (c: number): boolean => line.every((a) => c < coord(a.pos) - 1 || c > coord(a.pos) + (a.span ?? 1));
    /** W6: Spaltenpaare (c, Spiegelung) der Wand bis zu ihren Endspalten, von der Mitte nach außen. */
    const freePairs = (): number[][] => {
      const from = gl !== undefined ? gl.from : lo - 2;
      const to = gl !== undefined ? gl.to : hi + 2;
      const out: number[][] = [];
      for (let c = Math.floor(c2 / 2); c >= from; c--) {
        const pair = [...new Set([c, c2 - c])];
        // zwei Laternen dicht nebeneinander (gerade Mitte zwischen zwei Spalten) wären ein Klumpen, kein Paar
        if (pair.every((q) => q >= from && q <= to) && (pair.length === 1 || Math.abs(pair[0]! - pair[1]!) >= 3)) out.push(pair);
      }
      return out;
    };
    const place = (budget: boolean): void => {
      // Mindestlicht (ohne Budget): tragen die Pfosten nichts (Fachwerk: Ständer 1 vor der Wand; Konsolen am Pfostenkopf),
      // dann neben dem Mittelfenster, dann das innerste freie Spaltenpaar der Wand – nie in den Rahmenspalten eines
      // Fensters der Linie (Laterne am Nachbarfenster), spiegelgleich zur Mitte der Linie
      const extra = pairs.length === 0 ? flank : budget ? [] : [...flank, ...freePairs()].filter((pair) => pair.every(free));
      for (const pair of [...pairs, ...extra]) {
        if (any && (pairs.length === 0 || !budget)) break;
        if (chosen.length > 0 && pair.some((q) => chosen.some((c) => Math.abs(c - q) < gap))) continue;
        // W7 (27.09.2026, Review W4-R Runde 4): im Budget-Durchgang auch die beiden Laternen eines Paars im Abstand ≥ `gap`
        // – vorher hing am innersten Pfostenpaar immer je eine, bei Joch 3 bis 5 also an Nachbarpfosten (Langhaus,
        // Taverne: eine Laterne an jedem Pfosten der Mitte). Das Mindestlicht (ohne Budget) nimmt weiter das innerste Paar.
        if (budget && pairs.length > 0 && pair.length === 2 && pair[1]! - pair[0]! < gap) continue;
        // eine Aufhängung für die ganze Seite (die des ersten gesetzten Paars)
        for (const m of fixed !== undefined ? [fixed] : mounts) {
          if (!pair.every((c) => ok(c, m))) continue;
          const parts = pair.map((c): Part => (m.kind === 'fence'
            ? { ...arm, facing: out, at: at(c, m.y - 1) }
            : { componentId: 'exterior/eave_lantern', facing: out, at: at(c, m.y) }));
          if (site.commit('eaveLanterns', 'window', a0.floorIndex, parts, undefined, 'eaveLanterns', { budget }).length === 0) continue;
          chosen.push(...pair);
          any = true;
          fixed = m;
          for (const c of pair) site.litPosts.add(`${out}|${wallPlane}|${c}`);
          site.litSides.add(`${out}|${wallPlane}`);
          break;
        }
      }
    };
    place(true);
    // W6 (27.09.2026, Review W4-R R2 „jede Fassadenseite mit Fenstern ≥ 1 Außenlaterne“): Mindestlicht. Blieb die Seite
    // ohne Laterne, weil ihre Fenstermodule schon die Hälfte der Spalten belegen (Deko-Budget F7), und hängt vor ihr auch
    // keine Eingangslaterne, bekommt sie genau ein Paar (bzw. den Mittelpfosten) vor dem Budget – dieselben Kandidaten in
    // derselben Reihenfolge (innerstes Paar zuerst, spiegelgleich), je Pfosten höchstens eine Laterne (`litPosts`).
    // Vorher strich die N9-Regel an solchen Häusern auch die Ecklaternen: drei Seiten blieben nachts dunkel.
    const u0 = gl !== undefined ? gl.from : lo - 3;
    const u1 = gl !== undefined ? gl.to : hi + 3;
    if (!any && !site.lanternBefore(out, wallPlane, u0, u1)) place(false);
    void key;
  }
  if (kit.accent) planUpperAccent(site, kit, bySide, grid, doors);
}

/**
 * W4 (27.09.2026, plan/spikes/W4E_feinschliff.md; Vorbilder r12, r14, r02, r18, r22 aus W2-FW): **Akzent im
 * Obergeschoss** – nur Module mit `chain_lantern` (Fachwerk). Das Obergeschoss (erste Fensterlinie über der untersten
 * einer Seite) war ohne Läden schlicht; es bekommt genau einen Akzent in der Linienmitte (Baustandard F7 „je Linie
 * höchstens 1 Akzent“):
 *  - liegt ein Fenster mittig: je eine Laterne an einer Kette links und rechts davon, unter den Ecken des Sturzes (eine
 *    umgedrehte Treppe trägt keine hängende Laterne, die Kette schon – Faktencheck #3);
 *  - sonst am Rasterpfosten in der Mitte: eine Laterne am Zaun-Arm auf der Sturzreihe (wie die Fensterlaternen).
 * Beides nur vor Wand, unter der Traufe und mit Scheiben ≥ 2 hoch; ganz oder gar nicht.
 */
function planUpperAccent(
  site: ExteriorSite, kit: ModuleKit, bySide: ReadonlyMap<string, readonly ShellAnchor[]>, grid: readonly FacadeGridLine[], doors: readonly ShellAnchor[],
): void {
  for (const list of bySide.values()) {
    const ys = [...new Set(list.map((a) => a.pos[1]))].sort((p, q) => p - q);
    if (ys.length < 2) continue;
    const line = list.filter((a) => a.pos[1] === ys[1]);
    const a0 = line[0]!;
    const out = a0.facing;
    const ns = out === 'north' || out === 'south';
    const coord = (p: Vec3): number => (ns ? p[0] : p[2]);
    const lvl = site.levelOf(a0.floorIndex, a0.pos);
    if (lvl === undefined || doors.some((d) => d.facing === out && planeOf(d) === planeOf(a0) && Math.abs(d.pos[1] - a0.pos[1]) <= 3)) continue;
    const h = Math.min(...line.map((a) => paneHeight(site, a)));
    if (h < 2) continue;
    const at = (c: number, y: number): Vec3 => (ns ? [c, y, a0.pos[2]] : [a0.pos[0], y, c]);
    const wallPlane = planeOf({ pos: step(a0.pos, OPP[out]), facing: out });
    const gl = grid.find((g) => g.out === out && g.plane === wallPlane && g.y0 === lvl.y0 && line.some((a) => coord(a.pos) >= g.from && coord(a.pos) <= g.to));
    const lo = Math.min(...line.map((a) => coord(a.pos)));
    const hi = Math.max(...line.map((a) => coord(a.pos) + (a.span ?? 1) - 1));
    const c2 = gl !== undefined ? gl.from + gl.to : lo + hi;
    const y = a0.pos[1];
    const mid = line.find((a) => 2 * coord(a.pos) + (a.span ?? 1) - 1 === c2);
    const wall = (p: Vec3): boolean => site.solidWall(step(p, OPP[out]));
    if (mid !== undefined) {
      // Laterne (y + h − 2) an der Kette (y + h − 1) links und rechts des Mittelfensters, unter den Sturz-Ecken
      const cells = [coord(mid.pos) - 1, coord(mid.pos) + (mid.span ?? 1)].map((c) => at(c, y + h - 2));
      if (!cells.every((p) => wall(p) && wall(up(p)) && belowEave(site, up(p), lvl.baseY))) continue;
      // W5 (27.09.2026, Review W4-R N9, F7 „je Pfosten höchstens 1 Zubehör“): nicht über einer Spalte, an der schon eine
      // Laterne hängt (Eingangs-Laternenpaar darunter, Häuserzeile) – sonst zwei Laternen übereinander am selben Pfosten
      if (cells.some((p) => site.litPosts.has(`${out}|${wallPlane}|${coord(p)}`))) continue;
      if (site.commit('eaveLanterns', 'window', a0.floorIndex, cells.map((p): Part => ({ componentId: kit.componentId, variantId: 'chain_lantern', facing: out, at: p }))).length > 0) {
        for (const p of cells) site.litPosts.add(`${out}|${wallPlane}|${coord(p)}`);
      }
      continue;
    }
    const post = (gl?.studs ?? gl?.posts)?.find((p) => 2 * p === c2);
    if (post === undefined || site.litPosts.has(`${out}|${wallPlane}|${post}`)) continue;
    // Zaun-Arm auf der Sturzreihe (y + h), Laterne darunter – wie die Fensterlaternen; liegt dort schon die Traufe bzw.
    // eine Konsole, hängt die Laterne an einer Kette darunter (y + h − 1)
    const fence = at(post, y + h);
    const tries: Part[] = [
      ...(kit.lantern && wall(fence) && belowEave(site, fence, lvl.baseY) ? [{ componentId: kit.componentId, variantId: 'lantern', facing: out, at: at(post, y + h - 1) }] : []),
      ...(wall(at(post, y + h - 1)) && belowEave(site, at(post, y + h - 1), lvl.baseY) ? [{ componentId: kit.componentId, variantId: 'chain_lantern', facing: out, at: at(post, y + h - 2) }] : []),
    ];
    for (const part of tries) {
      if (site.commit('eaveLanterns', 'window', a0.floorIndex, [part]).length === 0) continue;
      site.litPosts.add(`${out}|${wallPlane}|${post}`);
      break;
    }
  }
}

/**
 * W7 (27.09.2026, plan/spikes/W7A_ruhe.md): passt das breite Modul (Rahmen-Ecken bzw. Läden/Wangen in den Spalten −1 und
 * `span` neben der Scheibe) so ins Feld, dass daneben Wand frei bleibt? Spalten −1/`span` und −2/`span`+1 sind Wand über
 * alle Scheibenreihen, die äußeren keine Rasterpfosten. Ohne Fassadenraster immer (bisheriges Verhalten).
 */
function roomy(site: ExteriorSite, a: ShellAnchor): boolean {
  const grid = site.shell.facadeGrid;
  if (grid === undefined) return true;
  const { span, h, col } = geo(site, a);
  const ns = a.facing === 'north' || a.facing === 'south';
  const wallPlane = planeOf({ pos: step(a.pos, OPP[a.facing]), facing: a.facing });
  const lvl = site.levelOf(a.floorIndex, a.pos);
  const c0 = ns ? a.pos[0] : a.pos[2];
  const gl = lvl === undefined || a.pos[1] > lvl.topY ? undefined
    : grid.find((g) => g.out === a.facing && g.plane === wallPlane && g.y0 === lvl.y0 && c0 >= g.from && c0 <= g.to);
  const wallCol = (k: number): boolean => Array.from({ length: h }, (_, y) => step(col(k, a.pos[1] + y), OPP[a.facing])).every((p) => site.at(p)?.kind === 'wall');
  const post = (k: number): boolean => gl !== undefined && (gl.posts.includes(c0 + k) || c0 + k <= gl.from || c0 + k >= gl.to);
  return [-1, span].every(wallCol) && [-2, span + 1].every((k) => wallCol(k) && !post(k));
}

/**
 * W9-G2 (27.09.2026): Fenster in einer Fachwerk-Linie (Rasterlinie mit `studs`, nur bei Fachwerk gesetzt, W7-A). Ein
 * Giebelfenster hat keine eigene Rasterlinie: es gilt als Fachwerk, wenn eine Wandlinie derselben Seite Fachwerk ist
 * (Giebel über dem Rähm rahmt das Fachwerk ebenso, materialize `timberPart`).
 */
function timberLine(site: ExteriorSite, a: ShellAnchor): boolean {
  const gl = gridLineOf(site, a);
  if (gl !== undefined) return gl.studs !== undefined;
  const lvl = site.levelOf(a.floorIndex, a.pos);
  if (lvl === undefined || a.pos[1] <= lvl.topY) return false;
  const wallPlane = planeOf({ pos: step(a.pos, OPP[a.facing]), facing: a.facing });
  return (site.shell.facadeGrid ?? []).some((g) => g.out === a.facing && g.plane === wallPlane && g.studs !== undefined);
}

/**
 * W13-E: Die Spalten −1 und `span` neben der Scheibe sind über alle Scheibenreihen Wandzellen (im Fachwerk: die
 * Laibungsständer) – dort liegt ein geöffneter Laden an.
 */
function studJambs(site: ExteriorSite, a: ShellAnchor): boolean {
  const { span, h, col } = geo(site, a);
  return [-1, span].every((k) => Array.from({ length: h }, (_, y) => step(col(k, a.pos[1] + y), OPP[a.facing])).every((p) => site.at(p)?.kind === 'wall'));
}

/**
 * W13-E: Unter der Bankreihe des Fensters (1–2 Reihen tiefer) liegt vor der Wand schon ein Stück der Außen-Deko (Sturz des
 * Fensters darunter) – eine Bank darauf läse sich als Plattenstapel. Gesimse der Hülle zählen nicht.
 */
function stackedBelow(site: ExteriorSite, a: ShellAnchor): boolean {
  const { span, cols } = geo(site, a);
  return [2, 3].some((d) => cols(0, span - 1, a.pos[1] - d).some((p) => site.isTaken(p)));
}

/** Rasterlinie der Wandreihen, vor der der Fensteranker liegt (Giebelfenster: keine). */
function gridLineOf(site: ExteriorSite, a: ShellAnchor): FacadeGridLine | undefined {
  const lvl = site.levelOf(a.floorIndex, a.pos);
  if (lvl === undefined || a.pos[1] > lvl.topY) return undefined;
  const ns = a.facing === 'north' || a.facing === 'south';
  const wallPlane = planeOf({ pos: step(a.pos, OPP[a.facing]), facing: a.facing });
  const c0 = ns ? a.pos[0] : a.pos[2];
  return site.shell.facadeGrid?.find((g) => g.out === a.facing && g.plane === wallPlane && g.y0 === lvl.y0 && c0 >= g.from && c0 <= g.to);
}

/**
 * W9-G2 (27.09.2026): Die Spalten −1 und `span` neben der Scheibe sind über alle Scheibenreihen schlichte Wand – kein
 * Rasterpfosten (auch kein Fachwerk-Ständer), keine Öffnung. Dort darf die Rahmenwange liegen.
 */
function plainJambs(site: ExteriorSite, a: ShellAnchor): boolean {
  const { span, h, col } = geo(site, a);
  const c0 = a.facing === 'north' || a.facing === 'south' ? a.pos[0] : a.pos[2];
  const gl = gridLineOf(site, a);
  return [-1, span].every((k) => (gl === undefined || !gl.posts.includes(c0 + k))
    && Array.from({ length: h }, (_, y) => step(col(k, a.pos[1] + y), OPP[a.facing])).every((p) => site.at(p)?.kind === 'wall'));
}

/** W2 (F8): zwischen `fromY` (unterste Scheibe bzw. unterste Wandreihe der Etage) und `p` liegt in der Spalte kein Dach. */
function belowEave(site: ExteriorSite, p: Vec3, fromY: number): boolean {
  for (let y = fromY; y <= p[1]; y++) if (site.at([p[0], y, p[2]])?.kind === 'roof') return false;
  return true;
}
