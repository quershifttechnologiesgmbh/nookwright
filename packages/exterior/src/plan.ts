/**
 * Außen-Solver (research/18 §14, §15.1 Punkte 3 und 5; plan/02 Stufe 9/10): regelbasierte, deterministische
 * Platzierung von Außen-Komponenten an den Ankern der Hülle (`Shell.anchors`).
 *
 * Reihenfolge = Vorrang (wer zuerst kommt, belegt): Freihalten (Laufwege vor Türen, Zellen vor Scheiben) →
 * Fenstermodule (W2-FW) → Eingang (E3, E1/E2, E4) → Fensterlaternen (W2-FW) → Schornsteine (D12) → Traufenlaternen
 * (D10) → Traufkonsolen (W3) → Firstschmuck (D13) → Fantasy-Module (W7-D) → Fassaden-Details (W15).
 * W2 (Baustandard F7): mit Fassadenraster (`Shell.facadeGrid`) hängen die Traufenlaternen an den Pfosten statt in
 * einem eigenen Takt (Ecken wie bisher), spiegelgleich und höchstens eine je Pfosten.
 * Jede Gruppe hat einen eigenen Zufallsstrom (Seed + Name): Schalter und Einrichtung ändern andere Gruppen nicht.
 * Ohne Feuerstellen (`placements`) entfallen nur die Schornsteine – alles in Bodennähe bleibt zellgleich (das
 * Gelände kann deshalb vor der Einrichtung mit dem Plan gekoppelt werden).
 */
import type { FacadeGridLine, Shell, ShellAnchor } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { Rng, hashSeed, type Vec3 } from '@mcda/core';
import { isMainDoor, mainDoorFronts, planEntrances } from './entrance.js';
import { planFantasy } from './fantasy.js';
import { planChimneys, planEaveBraces, planEaveLanterns, planRidgeDecor } from './roof.js';
import { ExteriorSite, OPP, alongOf, step, up } from './site.js';
import { planBarnDoors } from './barn.js';
import { planFacadeDetail, planFacadeFront, type FacadeDetailOptions } from './detail.js';
import { EXTERIOR_GROUPS, type ExteriorGroup, type ExteriorOptions, type ExteriorPlan, type ExteriorStyle } from './types.js';
import { paneHeight, planWindowLanterns, planWindows } from './windows.js';

export function planExterior(shell: Shell, catalog: Catalog, opts: ExteriorOptions): ExteriorPlan {
  const style = opts.style ?? {};
  const d = Math.max(0, Math.min(2, style.density ?? 1));
  const on = (g: ExteriorGroup): boolean => style[g] !== false;
  const seed = style.variation === undefined ? opts.seed : hashSeed(opts.seed, 'exterior-variation', style.variation);
  const site = new ExteriorSite(shell, catalog, seed);
  const warnings: string[] = [];
  const anchors = (shell.anchors ?? []).filter((a) => a.floorIndex >= 0);
  const doors = anchors.filter((a) => a.kind === 'door');
  const windows = anchors.filter((a) => a.kind === 'window');
  const rng = new Rng(hashSeed(seed, 'exterior'));

  // Freihalten: Laufweg vor jeder Außentür (Zelle + 1 davor, 2 hoch) und jede Zelle vor einer Scheibe
  for (const a of doors) for (const k of [0, 1]) for (const h of [0, 1]) site.reserve(up(step(a.pos, a.facing, k), h), 'walk');
  for (const a of windows) {
    const h = paneHeight(site, a);
    for (let k = 0; k < (a.span ?? 1); k++) {
      const col: Vec3 = a.facing === 'north' || a.facing === 'south' ? [a.pos[0] + k, a.pos[1], a.pos[2]] : [a.pos[0], a.pos[1], a.pos[2] + k];
      for (let y = 0; y < h; y++) if (site.at(step(up(col, y), OPP[a.facing]))?.kind === 'window') site.reserve(up(col, y), 'view');
    }
  }

  const mains = mainDoorFronts(shell);
  // W12-C (Review R6-4): Außengestaltung je Baukörper – Stil je Raum (abgeschaltete Gruppen, Scheunentor). Ohne
  // `roomExterior` genau ein Teil mit dem Stil des Gebäudes und denselben Zufallsströmen (bitgleich).
  const parts = styleParts(style, opts.roomExterior);
  const partOf = (a: { readonly roomId?: string }): StylePart => parts.byRoom.get(a.roomId ?? '') ?? parts.base;
  const byPart = <T extends { readonly roomId?: string }>(list: readonly T[], p: StylePart): T[] => list.filter((a) => partOf(a) === p);
  const onIn = (p: StylePart, g: ExteriorGroup): boolean => p.style[g] !== false;
  // Scheunentor zuerst (Vorrang vor Fenstermodulen und Eingang): Torflügel, Heuluke, Heubalken
  for (const p of parts.list) if (p.barn && d > 0 && onIn(p, 'barnDoors')) planBarnDoors(site, byPart(doors, p), d >= 0.5);
  // EXT: Balkon und Erker (Stufe `grand`) vor den Fenstermodulen: sie ersetzen Bank, Laden und Kasten des mittleren Fensters
  const detailOpts: FacadeDetailOptions = {
    ...(opts.themeId !== undefined ? { themeId: opts.themeId } : {}),
    ...(opts.roomTypes !== undefined ? { roomTypes: opts.roomTypes } : {}),
    ...(opts.dataVersion !== undefined ? { dataVersion: opts.dataVersion } : {}),
    on: (a) => onIn(partOf(a), 'detailBlocks'),
    isMain: (a) => isMainDoor(mains, a),
  };
  if (d > 0 && on('detailBlocks')) planFacadeFront(site, catalog, anchors, doors, style, detailOpts);
  for (const p of parts.list) {
    if (d > 0 && (onIn(p, 'shutters') || onIn(p, 'flowerBoxes') || onIn(p, 'sills') || onIn(p, 'hoods'))) {
      planWindows(site, catalog, byPart(windows, p), p.style, rng.fork(`windows${p.key}`), opts.themeId);
    }
  }
  for (const p of parts.list) planEntrances(site, catalog, byPart(doors, p), mains, p.style, d, rng.fork(`entrance${p.key}`), opts, warnings);
  // W2-FW: Laternen der Fenstermodule an den Pfosten (nach dem Eingang: dessen Laternen haben Vorrang)
  for (const p of parts.list) if (onIn(p, 'eaveLanterns') && d >= 0.5) planWindowLanterns(site, catalog, byPart(windows, p), doors, p.style, d, opts.themeId);
  if (on('chimneys') && opts.placements !== undefined) {
    const ends = new Set(anchors.filter((a) => a.kind === 'ridge_end').map((a) => `${a.pos[0]},${a.pos[2]}`));
    planChimneys(site, catalog, opts.placements, style, rng.fork('chimneys'), warnings, ends);
  }
  // Traufen-, Pfosten- und Firstanker nur in Räumen, deren Baukörper die Gruppe nicht abschaltet (Anker ohne Raum: Gebäude)
  const anchorsOn = (g: ExteriorGroup): ShellAnchor[] => (parts.list.length === 1 ? anchors : anchors.filter((a) => onIn(partOf(a), g)));
  if (on('eaveLanterns') && d > 0) {
    const grid = shell.facadeGrid;
    const lit = anchorsOn('eaveLanterns');
    if (grid === undefined) planEaveLanterns(site, lit, doors, d);
    else {
      // Ecken wie bisher (ohne Traufen-Anker: kein eigener Takt), dazu Laternen an den Rasterpfosten
      planEaveLanterns(site, lit.filter((a) => a.kind !== 'eave'), doors, d);
      if (d >= 1) planPostLanterns(site, grid, lit, doors, d);
    }
  }
  // W3: Traufkonsolen an den übrigen Pfosten (nach den Laternen, plan/spikes/W3RD_dachdetails.md); W4-D: eigene
  // Gruppe, ohne Angabe wie die Traufenlaternen (bitgleich zu vorher)
  if ((style.eaveBraces ?? style.eaveLanterns) !== false && d > 0) {
    planEaveBraces(site, shell.facadeGrid, parts.list.length === 1 ? anchors : anchors.filter((a) => (partOf(a).style.eaveBraces ?? partOf(a).style.eaveLanterns) !== false), doors);
  }
  if (on('ridgeDecor') && d >= 0.5) planRidgeDecor(site, anchorsOn('ridgeDecor'), d, rng.fork('ridge'), catalog, opts.themeId);
  // W7-D: Fantasy-Module an festen Ankern (plan/spikes/W7D_fantasy.md); ohne Fantasy-Stufe nichts (bitgleich)
  if (d > 0) planFantasy(site, catalog, anchors, doors, (a) => isMainDoor(mains, a), style, opts.themeId);
  // W15: Fassaden-Details aus Teilblöcken zuletzt (nur, was frei ist; plan/spikes/W15_fassaden_detailbloecke.md); ohne
  // Stufe (Standard `off`) nichts (bitgleich)
  if (d > 0 && on('detailBlocks')) planFacadeDetail(site, catalog, anchors, doors, style, detailOpts);

  const counts = Object.fromEntries(EXTERIOR_GROUPS.map((g) => [g, 0])) as Record<ExteriorGroup, number>;
  for (const p of site.placements) counts[p.group]++;
  return { placements: site.placements, warnings, counts };
}

/**
 * W2 (Baustandard F7, X2 §6.4): Traufenlaternen an den Pfosten des Fassadenrasters der untersten Traufen-Etage – je
 * Pfosten höchstens eine, von der Linienmitte aus spiegelgleich im Mindestabstand `round(8 / Dichte)` (≥ 3), nicht
 * neben Türen und nur, wo die Unterseite darüber trägt (sonst entfällt sie; eine Wandvorlage belegt den Platz).
 */
function planPostLanterns(site: ExteriorSite, grid: readonly FacadeGridLine[], anchors: readonly ShellAnchor[], doors: readonly ShellAnchor[], d: number): void {
  const eaves = anchors.filter((x) => x.kind === 'eave');
  if (eaves.length === 0) return;
  const lowest = Math.min(...eaves.map((x) => x.floorIndex));
  const gap = Math.max(3, Math.round(8 / d));
  for (const a of eaves.filter((x) => x.floorIndex === lowest)) {
    const along = alongOf(a.facing);
    const ns = a.facing === 'north' || a.facing === 'south';
    const start = ns ? a.pos[0] : a.pos[2];
    const span = a.span ?? 1;
    const wall = step(a.pos, OPP[a.facing]);
    const wallPlane = ns ? wall[2] : wall[0];
    const level = site.levelOf(a.floorIndex, a.pos);
    const line = grid.find((g) => g.out === a.facing && g.plane === wallPlane && (level === undefined || g.y0 === level.y0) && g.from <= start + span - 1 && g.to >= start);
    if (line === undefined) continue;
    // W2-FW: an Seiten mit Fensterlaternen kein zweiter Laternentakt unter der Traufe
    if (site.litSides.has(`${a.facing}|${wallPlane}`)) continue;
    const at = (k: number): Vec3 => [a.pos[0] + (along === 'east' ? k : 0), a.pos[1], a.pos[2] + (along === 'south' ? k : 0)];
    const nearDoor = (p: Vec3): boolean => doors.some((dr) => dr.facing === a.facing && Math.abs(dr.pos[0] - p[0]) + Math.abs(dr.pos[2] - p[2]) <= 2);
    const c2 = line.from + line.to;
    // W2-FW (F7): Pfosten mit einer Fensterlaterne bekommen keine zweite unter der Traufe
    // W7: im Fachwerk nur an Ständern (`studs`)
    const posts = (line.studs ?? line.posts).filter((p) => p >= start && p < start + span && !site.litPosts.has(`${a.facing}|${wallPlane}|${p}`))
      .sort((p, q) => Math.abs(2 * p - c2) - Math.abs(2 * q - c2) || p - q);
    const chosen: number[] = [];
    for (const p of posts) {
      const pair = [...new Set([p, c2 - p])].filter((q) => posts.includes(q));
      if (pair.some((q) => chosen.some((c) => Math.abs(c - q) < gap)) || (pair.length === 2 && Math.abs(pair[0]! - pair[1]!) < gap && pair[0] !== pair[1])) continue;
      const cells = pair.map((q) => at(q - start));
      if (cells.some((c) => nearDoor(c) || !site.hangsFrom(c))) continue;
      if (site.commit('eaveLanterns', 'eave', a.floorIndex, cells.map((c) => ({ componentId: 'exterior/eave_lantern', facing: a.facing, at: c }))).length > 0) chosen.push(...pair);
    }
  }
}

/** W12-C: Teil des Gebäudes mit eigenem Stil (Räume eines Baukörpers mit `exterior`). */
interface StylePart {
  /** Suffix der Zufallsströme ('' = Gebäude-Stil, bitgleich zu vorher). */
  readonly key: string;
  readonly style: ExteriorStyle;
  readonly barn: boolean;
}

/** Stil je Raum: Gebäude-Stil ohne die abgeschalteten Gruppen; Scheunentor ersetzt Portal, Vordach und Eingangsdeko. */
function styleParts(style: ExteriorStyle, rooms: ExteriorOptions['roomExterior']): { base: StylePart; list: StylePart[]; byRoom: Map<string, StylePart> } {
  const base: StylePart = { key: '', style, barn: false };
  const list: StylePart[] = [base];
  const byKey = new Map<string, StylePart>();
  const byRoom = new Map<string, StylePart>();
  for (const room of Object.keys(rooms ?? {}).sort()) {
    const e = rooms![room]!;
    const off = [...new Set([...(e.off ?? []), ...(e.barn === true ? (['portal', 'canopy', 'entranceDecor'] as const) : [])])].sort();
    if (off.length === 0 && e.barn !== true) continue;
    const key = `:${e.barn === true ? 'barn' : ''}:${off.join(',')}`;
    let part = byKey.get(key);
    if (part === undefined) {
      part = { key, style: { ...style, ...Object.fromEntries(off.map((g) => [g, false])) }, barn: e.barn === true };
      byKey.set(key, part);
      list.push(part);
    }
    byRoom.set(room, part);
  }
  return { base, list, byRoom };
}
