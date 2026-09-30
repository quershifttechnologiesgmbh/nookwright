/**
 * Lage `buried` (BT16 Hobbit-Erdhaus, research/19 §5 BT16, §7.5): Hülle eines eingegrabenen Baukörpers.
 *  - Dach `earth`: flache Decke (Dachform `flat`); die Erde darüber legt das Gelände („Überdecken“, @mcda/terrain) nach
 *    `Shell.settings` (Front, Erdlagen, Grundriss).
 *  - Nur die Front ist Fassade: Außentüren und Fenster nur in Wandzellen der FRONTEBENE (vorderste Reihe des Grundrisses in
 *    Richtung `front`, Außenseite `front`); Anker und Außenprofil nur davor (`moundZone`). Seiten- und Rückwände berühren Erde.
 *  - Front-Details als Außenprofil-Zellen (`kind: 'facade'`, in Außenluft vor der Front): Rundtür-Portal um jede Außentür,
 *    Rundfenster-Rahmen um jede Fensterspalte – beide spiegelsymmetrisch (keine Drehsymmetrie ohne Spiegelachse).
 *
 * Front-Ansicht (u quer zur Front, b = unterste Luftreihe, D Tür, □ Scheibe, | Stamm, ◢◣ umgedrehte Treppen, ▀▄ Stufen,
 * ▌ flache Falltür an der Wand). W9-G4 (27.09.2026, plan/spikes/W9G4_erdhaus.md): zuerst die große Rundtür, Rundfenster
 * mit Falltür-Wangen (Bogen, Bank und Sturz in `roof_trim`):
 *
 *   große Rundtür (7 breit)   Rundtür (5 breit)   schmal (3 breit)   Rundfenster (Scheiben + 2 breit)
 *   b+4   . . ▀ ▀ ▀ . .
 *   b+3   . ◢ . . . ◣ .       . ◢ ▀ ◣ .                                ◢ ▀ ◣   über der obersten Scheibe
 *   b+2   ◢ . . . . . ◣       ◢ . . . ◣           ◢ ▀ ◣                ▌ □ ▌   (Fensterband: ▌ □ □ ▌)
 *   b+1   | . . D . . |       | . D . |           | D |                ▌ □ ▌
 *   b     | . . D . . |       | . D . |           | D |                ◥ ▄ ◤   Brüstung (untere Treppen, untere Stufe)
 *
 * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): Ring lückenlos (Muster an `RINGS`), davor eine Laibung, die
 * Rundfenster mit Holzwangen statt Falltüren, Steinpfeiler mit Strebefuß an den Ecken und in einzelnen Lücken – die
 * Front hat drei Tiefenebenen. Die Skizze oben zeigt den Stand W9-G4.
 *
 * Steht neben einem Fenster schon die Rundtür, lehnt sich das Fenster an sie an (diese Wange entfällt).
 * Die kleineren Rundtüren gelten, wenn die größere ein Fenster verdecken würde (vor Scheiben bleibt es immer frei).
 * Treppen zeigen quer zur Front nach außen (vom Mittelpunkt weg) – alle Treppen eines Rings liegen auf derselben Achse,
 * die Vanilla-Form bleibt `straight`. Ein Ring entsteht ganz oder gar nicht (belegt, vor einer Tür, quer liegende Treppe
 * daneben → entfällt).
 */
import { HORIZONTAL, key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import type { RoomId, VolumeId } from '../model.js';
import { OPP, STEP, axisOf } from './grid.js';
import type { ShellCell, ShellOrient, ShellSetting } from './types.js';

/** Erdlagen über der Decke ohne Angabe (research/19 BT16: flache Decke plus 1–2 Erdlagen). */
export const BURIED_COVER = 2;

/**
 * W9-G4 (27.09.2026, plan/spikes/W9G4_erdhaus.md): Flanken neben der Front – der Hügel reicht dort 2 Blöcke vor die
 * Frontebene, die Front liegt als Nische dazwischen (Vorbilder: Torfhäuser mit Giebelfront zwischen Torfwänden,
 * Erdhäuser mit Stützmauern neben der Fassade).
 */
export const BURIED_WING = 2;

/**
 * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): halbe Breite der großen Rundtür (7 breit). Die Hülle plant in
 * der Frontwand keine Fenster so nah an der Haustür (sie lägen hinter dem Türblatt).
 */
export const BURIED_PORTAL_REACH = 3;

/**
 * W9-G4: Rolle des Rundtür-Rings – heller Stein aus einer Blockart (spiegelsymmetrisch), passend zur Stützmauer des
 * Hügels; Formen Block, Treppe, Stufe (`SHELL_ROLE_SHAPES.portal_stone`, Rückfall `wall_plinth`). W12-B: auch Laibung
 * und Pfeiler; die Fensterrahmen sind Holz. Im Blindvergleich (plan/spikes/W12B_erdhausfront.md §4) schnitt diese
 * Mischung besser ab als eine Front ganz aus Holz oder mit Stamm-Pfeilern.
 */
const RING_ROLE = 'portal_stone';
/**
 * W16-C (28.09.2026, plan/spikes/W16C_erdhaus.md): Höhe des Bogenbands im Scheitel über der Stirn (Reihen über der
 * obersten Wandreihe) – bei `cover` 2 liegt es auf Höhe der Grasnarbe dahinter.
 */
const BAND_LIFT = 2;
/** Vollblock-Form der Ring-Rolle. */
const RING_BLOCK = 'block';
/** W12-B (28.09.2026): Fensterrahmen und Strebefüße – Holz der Traufe. */
const FRAME_ROLE = 'roof_trim';

/** Koordinate in Richtung `dir` (größer = weiter vorn). */
export const forward = (dir: HorizontalDir, x: number, z: number): number => x * STEP[dir][0] + z * STEP[dir][1];

/** Frontebene: größte Vorwärts-Koordinate des Grundrisses. */
export function frontPlane(s: Pick<ShellSetting, 'front' | 'footprint'>): number {
  let f = -Infinity;
  for (const [x, z] of s.footprint) f = Math.max(f, forward(s.front ?? 'south', x, z));
  return f;
}

/**
 * W12-B (28.09.2026): Ausdehnung des Grundrisses quer zur Front (x bei Front Nord/Süd, sonst z), [min, max] – die
 * Frontmitte liegt bei (min + max) / 2.
 */
export function frontSpan(s: Pick<ShellSetting, 'front' | 'footprint'>): [number, number] {
  const b = s.footprint.bounds()!;
  return axisOf(s.front ?? 'south') === 'z' ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
}

/**
 * Hügel-Zone der Hülle: Spalte außerhalb aller Grundrisse, hinter bzw. auf Höhe der Frontebene eines eingegrabenen
 * Baukörpers und höchstens `reach` Blöcke neben seinem Grundriss (Rechteck) – dort liegt Erde, also weder Anker noch
 * Außenprofil.
 */
export function moundZone(settings: readonly ShellSetting[], reach = 3): (x: number, z: number) => boolean {
  const buried = settings.filter((s) => s.kind === 'buried').map((s) => ({ s, f: frontPlane(s), b: s.footprint.bounds()! }));
  // W9-G4: neben dem Grundriss (quer zur Front außerhalb) reicht die Zone um die Flanken (`wing`) vor die Frontebene
  const beside = (s: ShellSetting, b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number): boolean =>
    axisOf(s.front ?? 'south') === 'z' ? x < b.minX || x > b.maxX : z < b.minZ || z > b.maxZ;
  return (x, z) => !buried.some(({ s }) => s.footprint.has(x, z)) && buried.some(({ s, f, b }) =>
    forward(s.front ?? 'south', x, z) <= f + (beside(s, b, x, z) ? s.wing ?? 0 : 0)
    && x >= b.minX - reach && x <= b.maxX + reach && z >= b.minZ - reach && z <= b.maxZ + reach);
}

/**
 * Rundtür und Rundfenster vor der Front eingegrabener Baukörper: neue Zellen und das freizuhaltende Innere der Ringe
 * (key3; das Außenprofil setzt dort nichts). `volumeOfRoom` ordnet Hüllzellen über ihren Raum einem Baukörper zu;
 * `outside(p)` = Außenluft (keine Hüllzelle, nicht im Gebäude).
 */
export function buriedFrontDetails(
  cells: readonly ShellCell[], settings: readonly ShellSetting[], volumeOfRoom: (id: RoomId | undefined) => VolumeId | undefined, outside: (p: Vec3) => boolean,
): { readonly cells: ShellCell[]; readonly clear: ReadonlySet<string> } {
  const clear = new Set<string>();
  const byVolume = new Map(settings.filter((s) => s.kind === 'buried').map((s) => [s.volumeId, { s, f: frontPlane(s) }] as const));
  if (byVolume.size === 0) return { cells: [], clear };
  const at = new Map(cells.map((c) => [key3(c.pos), c] as const));
  const added = new Map<string, ShellCell>();
  // vor Außentüren: Türspalte und die Zelle davor von der Bodenplatte bis 2 hoch frei (wie facade.ts)
  const keep = new Set<string>();
  const doors: ShellCell[] = [];
  const panes = new Map<string, { col: ShellCell; lo: number; hi: number; front: HorizontalDir }>();
  for (const c of cells) {
    const v = volumeOfRoom(c.roomId);
    const b = v === undefined ? undefined : byVolume.get(v);
    if (b === undefined || forward(b.s.front!, c.pos[0], c.pos[2]) !== b.f) continue;
    const front = b.s.front!;
    if (c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower' && c.orient.facing === front) {
      doors.push(c);
      for (let y = c.pos[1] - 1; y <= c.pos[1] + 1; y++) for (const k of [1, 2]) keep.add(key3(step([c.pos[0], y, c.pos[2]], front, k)));
    }
    if (c.kind === 'window' && outside(step(c.pos, front))) {
      const k = `${c.pos[0]},${c.pos[2]}`;
      const p = panes.get(k);
      panes.set(k, p === undefined ? { col: c, lo: c.pos[1], hi: c.pos[1], front } : { ...p, lo: Math.min(p.lo, c.pos[1]), hi: Math.max(p.hi, c.pos[1]) });
    }
  }
  // vor jeder Scheibe frei
  for (const w of panes.values()) for (let y = w.lo; y <= w.hi; y++) keep.add(key3(step([w.col.pos[0], y, w.col.pos[2]], w.front)));
  const taken = (p: Vec3): boolean => !outside(p) || added.has(key3(p)) || keep.has(key3(p));
  /** Quer liegende Treppe daneben (würde die Vanilla-Form ändern). */
  const crossing = (p: Vec3, facing: HorizontalDir): boolean => HORIZONTAL.some((d) => {
    const n = step(p, d);
    const o = added.get(key3(n)) ?? at.get(key3(n));
    return o?.shape === 'stairs' && o.orient?.facing !== undefined && axisOf(o.orient.facing) !== axisOf(facing);
  });
  const commit = (ring: readonly ShellCell[]): boolean => {
    if (!ring.every((c) => !taken(c.pos) && (c.shape !== 'stairs' || !crossing(c.pos, c.orient!.facing!)))) return false;
    for (const c of ring) added.set(key3(c.pos), c);
    return true;
  };
  const along = (front: HorizontalDir): HorizontalDir => (axisOf(front) === 'z' ? 'east' : 'south');
  const make = (pos: Vec3, role: string, shape: string, orient: ShellOrient, roomId: RoomId | undefined): ShellCell => ({
    pos, kind: 'facade', role, shape, orient, ...(roomId !== undefined ? { roomId } : {}), exterior: true,
  });

  const reserve = (p: Vec3): void => { keep.add(key3(p)); clear.add(key3(p)); };
  /** W13-C: Ringradius je Haustür (für die Stämme im Stirnbogen). */
  const ringOf = new Map<string, number>();
  for (const d of doors.sort((a, b) => a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2])) {
    const front = d.orient!.facing!;
    const A = along(front);
    const b = d.pos[1];
    const o = step(d.pos, front);
    const P = (u: number, dy: number, k = 0): Vec3 => { const p = step(step(o, A, u), front, k); return [p[0], b + dy, p[2]]; };
    const side = (u: number): HorizontalDir => (u < 0 ? OPP[A] : A);
    /**
     * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): lückenloser Rundbogen. Jede Zelle des Rings teilt
     * eine Kante mit der nächsten (kein Stück hängt nur über Eck), zwischen Ring und Türblatt bleibt keine Luftzelle:
     * seitlich Pfosten aus vollen Blöcken, an den Kämpfern umgedrehte Treppen (nach außen, ihr offenes Viertel rundet die
     * Öffnung), im Scheitel eine obere Stufe, darüber der volle Bogenrücken; die Laternen stehen auf den äußeren Pfosten.
     * Vorbilder: „Treppen in die Ecken, Stufe in den Scheitel“ (Bogen-Anleitungen, Bericht §1). Die Tür liegt eine Ebene
     * hinter dem Ring (Nische).
     *
     *   r = 3 (7 breit)          r = 2 (5 breit)       r = 1 (3 breit)
     *   b+4  L ▄ █ █ █ ▄ L
     *   b+3  █ █ ◤ ▀ ◥ █ █       L █ █ █ L
     *   b+2  █ ◤ T T T ◥ █       █ ◤ ▀ ◥ █             L ▀ L
     *   b+1  █ T T D T T █       █ T D T █             █ D █
     *   b    █ T T D T T █       █ T D T █             █ D █
     */
    const arc = (u: number, dy: number, shape: 'stairs' | 'slab'): ShellCell =>
      make(P(u, dy), RING_ROLE, shape, shape === 'slab' ? { half: 'top' } : { facing: side(u), half: 'top' }, d.roomId);
    const block = (u: number, dy: number): ShellCell => make(P(u, dy), RING_ROLE, RING_BLOCK, {}, d.roomId);
    const low = (u: number, dy: number): ShellCell => make(P(u, dy), RING_ROLE, 'slab', { half: 'bottom' }, d.roomId);
    const RINGS: Readonly<Record<number, { cells: () => ShellCell[]; inner: ReadonlyArray<readonly [number, number]>; lamp: number }>> = {
      // inner: [halbe Breite des Inneren, Reihe]; lamp: Reihe der Laternen auf dem äußeren Pfosten
      3: {
        cells: () => [arc(0, 3, 'slab'), block(-1, 4), block(0, 4), block(1, 4), ...[-3, 3].flatMap((u) => {
          const i = -Math.sign(u);
          return [block(u, 0), block(u, 1), block(u, 2), block(u, 3), arc(u + i, 2, 'stairs'), block(u + i, 3), arc(u + 2 * i, 3, 'stairs'), low(u + i, 4)];
        })],
        inner: [[2, 0], [2, 1], [1, 2]], lamp: 4,
      },
      2: {
        cells: () => [arc(0, 2, 'slab'), block(-1, 3), block(0, 3), block(1, 3), ...[-2, 2].flatMap((u) => [block(u, 0), block(u, 1), block(u, 2), arc(u - Math.sign(u), 2, 'stairs')])],
        inner: [[1, 0], [1, 1]], lamp: 3,
      },
      1: { cells: () => [arc(0, 2, 'slab'), ...[-1, 1].flatMap((u) => [block(u, 0), block(u, 1), block(u, 2)])], inner: [[0, 0], [0, 1]], lamp: 3 },
    };
    const r = [3, 2, 1].find((k) => commit(RINGS[k]!.cells()));
    if (r === undefined) continue;
    ringOf.set(key3(d.pos), r);
    for (const [w, dy] of RINGS[r]!.inner) for (let u = -w; u <= w; u++) clear.add(key3(P(u, dy)));
    // Laternenplatz auf den äußeren Pfosten frei halten (Gelände-Modul earth_portal)
    for (const u of [-r, r]) reserve(P(u, RINGS[r]!.lamp));
    /**
     * W12-B: Laibung – vor den Ringpfosten eine zweite Ebene (2 hoch, oben eine Treppe zur Wand): die Tür liegt zwei
     * Blöcke tief in der Nische (Vorbilder: Tür 1–2 zurückgesetzt, der Bogen steht vor). Ganz oder gar nicht.
     */
    if (r >= 2) {
      commit([-r, r].flatMap((u) => [
        make(P(u, 0, 1), RING_ROLE, RING_BLOCK, {}, d.roomId), make(P(u, 1, 1), RING_ROLE, RING_BLOCK, {}, d.roomId),
        make(P(u, 2, 1), RING_ROLE, 'stairs', { facing: OPP[front], half: 'bottom' }, d.roomId),
      ]));
    }
  }
  // Nebeneinanderliegende Scheiben gleicher Höhe (Fensterband) bekommen einen gemeinsamen Rahmen
  const sorted = [...panes.values()].sort((a, b) => a.col.pos[0] - b.col.pos[0] || a.col.pos[2] - b.col.pos[2]);
  for (let k = 0; k < sorted.length; ) {
    const w = sorted[k]!;
    const A = along(w.front);
    let width = 1;
    for (; k + width < sorted.length; width++) {
      const next = sorted[k + width]!;
      const p = step(w.col.pos, A, width);
      if (next.col.pos[0] !== p[0] || next.col.pos[2] !== p[2] || next.lo !== w.lo || next.hi !== w.hi || next.front !== w.front) break;
    }
    k += width;
    const o = step(w.col.pos, w.front);
    const P = (u: number, y: number): Vec3 => { const p = step(o, A, u); return [p[0], y, p[2]]; };
    const r = w.col.roomId;
    const ring: ShellCell[] = [];
    /**
     * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): Rundfenster als geschlossener Holzrahmen vor der Wand –
     * Bank und Sturz aus Stufen, die Ecken aus Treppen (ihr offenes Viertel rundet die Öffnung), die Wangen aus vollen
     * Blöcken derselben Holzart statt flacher Falltüren (die ließen eine Luftzelle zwischen Ecke und Scheibe). Die Scheibe
     * liegt eine Ebene zurück. Steht neben dem Fenster schon ein Rahmen oder die Rundtür, lehnt es sich an sie an.
     */
    for (let u = 0; u < width; u++) {
      ring.push(make(P(u, w.lo - 1), FRAME_ROLE, 'slab', { half: 'bottom' }, r), make(P(u, w.hi + 1), FRAME_ROLE, 'slab', { half: 'top' }, r));
    }
    for (const [u, facing] of [[-1, OPP[A]], [width, A]] as const) {
      if (Array.from({ length: w.hi - w.lo + 3 }, (_, i) => P(u, w.lo - 1 + i)).some((q) => added.has(key3(q)))) continue;
      ring.push(make(P(u, w.lo - 1), FRAME_ROLE, 'stairs', { facing, half: 'bottom' }, r));
      for (let y = w.lo; y <= w.hi; y++) ring.push(make(P(u, y), FRAME_ROLE, 'block', {}, r));
      ring.push(make(P(u, w.hi + 1), FRAME_ROLE, 'stairs', { facing, half: 'top' }, r));
    }
    commit(ring);
  }
  /**
   * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): Felder – Steinpfeiler vor der Wand an den Ecken der Front
   * (Ende der Stützmauer) und in jeder einzelnen Lücke zwischen Fensterrahmen und Ring (Vorbilder: Pfeiler zwischen den
   * Bögen, Stützmauern neben der Front); davor als dritte Ebene ein Strebefuß (untere Treppe zur Wand). Breitere Lücken
   * bleiben Wand. Ganz oder gar nicht je Pfeiler; der Fuß entfällt allein, wenn davor kein Platz ist.
   */
  for (const d of doors) {
    const front = d.orient!.facing!;
    const b = byVolume.get(volumeOfRoom(d.roomId)!);
    if (b === undefined) continue;
    const [s0, s1] = frontSpan(b.s);
    const at = (u: number, dy: number, k = 1): Vec3 =>
      step(axisOf(front) === 'z' ? [u, d.pos[1] + dy, d.pos[2]] : [d.pos[0], d.pos[1] + dy, u], front, k);
    const free = (u: number): boolean => [0, 1, 2].every((dy) => !taken(at(u, dy)) && !clear.has(key3(at(u, dy))));
    const busy = (u: number): boolean => u < s0 || u > s1 || added.has(key3(at(u, 1)));
    for (let u = s0; u <= s1; u++) {
      if (!free(u) || !(u === s0 || u === s1 || (busy(u - 1) && busy(u + 1)))) continue;
      if (!commit([0, 1, 2].map((dy) => make(at(u, dy), RING_ROLE, RING_BLOCK, {}, d.roomId)))) continue;
      commit([make(at(u, 0, 2), RING_ROLE, 'stairs', { facing: OPP[front], half: 'bottom' }, d.roomId)]);
    }
  }
  /**
   * W13-C (28.09.2026, plan/spikes/W13C_erdhaus_huegel.md): Stirnbogen – über der Decke steigt die Front in der
   * Wandebene als flacher Stufenbogen an (Höhe `crownRise`: an den Ecken 0, je zwei Spalten eine Reihe, bis 2 Reihen), davor läuft ein
   * vorspringender Holzrahmen (Rolle `roof_trim`) der Bogenlinie nach: Treppen an den Stufen (hohe Seite zur Mitte),
   * sonst volle Blöcke. Der Rahmen liegt vor der ersten Erdlage, darüber nur noch die Grasnarbe (Vorbilder: gerundete
   * Stirn mit Holzbogen unter dem Hügel, Bericht §1). Die Erde legt das Gelände auf die neue Oberkante (`cover` bleibt).
   * Spiegelgleich zur Frontmitte; ganz oder gar nicht je Spalte.
   * W16-C (28.09.2026): Rahmen und Traufleiste ersetzt durch die Bogenfront (unten); die Wand steigt bis unter das Band.
   */
  const colTop = new Map<string, number>();
  /** W16-C: Haustüren mit Bogenband (ohne Traufleiste). */
  const banded = new Set<string>();
  for (const c of cells) {
    const k = `${c.pos[0]},${c.pos[2]}`;
    colTop.set(k, Math.max(colTop.get(k) ?? -Infinity, c.pos[1]));
  }
  for (const d of doors) {
    const front = d.orient!.facing!;
    const b = byVolume.get(volumeOfRoom(d.roomId)!);
    if (b === undefined) continue;
    const [s0, s1] = frontSpan(b.s);
    const A = along(front);
    const col = (u: number): readonly [number, number] => (axisOf(front) === 'z' ? [u, d.pos[2]] : [d.pos[0], u]);
    const topOf = (u: number): number | undefined => colTop.get(`${col(u)[0]},${col(u)[1]}`);
    const du = axisOf(front) === 'z' ? d.pos[0] : d.pos[2];
    const r = ringOf.get(key3(d.pos));
    const mid = Math.floor((s0 + s1) / 2);
    const tMid = topOf(mid);
    if (tMid === undefined || crownRise(mid, s0, s1) === 0) continue;
    /**
     * W16-C (28.09.2026, plan/spikes/W16C_erdhaus.md, Blindvergleich R7-3 „Holzdeckel“, „flach frontal“): Bogenfront.
     * Ein Bogenband läuft als Halbellipse über die ganze Frontbreite – im Scheitel `BAND_LIFT` über der Stirn, an den
     * Ecken auf den Pfeilern (Vorbild 1: gestufter Holzbogen, der in den Hang sinkt). Es weicht Rahmen, Ring und
     * Laternen nach oben aus und fällt von der Mitte nach außen nie an. Das Band ist zwei Reihen hoch: oben volle
     * Blöcke, darunter an den Stufen umgedrehte Treppen (ihr offenes Viertel rundet den Bogen), sonst obere Stufen.
     * Jede dritte Spalte ab der Mitte trägt eine Stirnholz-Scheibe (Stamm quer zur Front). Die Stirn dahinter steigt mit
     * (gekrümmte Frontwand bis unter das Band, mindestens `crownRise`) und besteht aus liegenden Stämmen (`beam`): ein
     * dunkles Feld unter dem hellen Band statt einer Bretterfläche („Holzdeckel“) bzw. hellem Stein (medieval). Die Erde
     * liegt darüber, die Moosnarbe über dem Band setzt das Gelände (`bandLip`). Spiegelgleich; einzelne Zellen entfallen,
     * wo etwas steht.
     */
    // Abstand zur Frontmitte in halben Blöcken (gerade Breiten: Mitte zwischen zwei Spalten)
    const span2 = s1 - s0;
    const lift = tMid + crownRise(mid, s0, s1) + BAND_LIFT - d.pos[1];
    const E = (u: number, y: number, k: number): Vec3 => { const [x, z] = col(u); return step([x, y, z], front, k); };
    const blocked = (p: Vec3): boolean => !outside(p) || added.has(key3(p)) || keep.has(key3(p));
    const cols = (k2: number): number[] => [...new Set([(s0 + s1 - k2) / 2, (s0 + s1 + k2) / 2])];
    const ks: number[] = [];
    for (let k2 = span2 % 2; k2 <= span2; k2 += 2) ks.push(k2);
    const B = ks.map((k2) => {
      let y = d.pos[1] + Math.round(lift * Math.sqrt(Math.max(0, 1 - (k2 / (span2 + 1)) ** 2)));
      for (const u of cols(k2)) {
        for (let yy = d.pos[1] - 1; yy <= d.pos[1] + lift + 2; yy++) if (blocked(E(u, yy, 1))) y = Math.max(y, yy + 2);
      }
      return y;
    });
    for (let i = B.length - 2; i >= 0; i--) B[i] = Math.max(B[i]!, B[i + 1]!);
    const bandAt = (u: number): number => B[ks.indexOf(Math.abs(2 * u - s0 - s1))]!;
    for (let u = s0; u <= s1; u++) {
      const t = topOf(u);
      if (t === undefined) continue;
      const rise = Math.max(crownRise(u, s0, s1), bandAt(u) - 1 - t);
      const [x, z] = col(u);
      // stehende Stämme über den Ringpfosten gliedern die Stirn (Vorbilder: Stammpfosten zwischen den Feldern), sonst
      // liegen die Stämme längs der Front
      const post = r !== undefined && Math.abs(u - du) === r;
      const axis = post ? 'y' : axisOf(front) === 'z' ? 'x' : 'z';
      commit(Array.from({ length: rise }, (_, i) => make([x, t + 1 + i, z], 'beam', 'log', { axis }, d.roomId)));
    }
    ks.forEach((k2, i) => {
      const y = B[i]!;
      const last = i === ks.length - 1;
      const next = last ? -Infinity : B[i + 1]!;
      for (const u of cols(k2)) {
        const inward: HorizontalDir = 2 * u < s0 + s1 ? A : OPP[A];
        const stepDown = next < y;
        // Stirnholz-Scheiben im Band (Vorbild 1: runde Holzscheiben im Bogen): Stamm quer zur Front, jede dritte Spalte
        // ab der Mitte (Abstand in ganzen Blöcken), spiegelgleich
        const disc = k2 % 6 === 0;
        commit([disc ? make(E(u, y, 1), 'beam', 'log', { axis: axisOf(front) === 'z' ? 'z' : 'x' }, d.roomId) : make(E(u, y, 1), FRAME_ROLE, 'block', {}, d.roomId)]);
        commit([stepDown ? make(E(u, y - 1, 1), FRAME_ROLE, 'stairs', { facing: OPP[inward], half: 'top' }, d.roomId) : make(E(u, y - 1, 1), FRAME_ROLE, 'slab', { half: 'top' }, d.roomId)]);
        // steiler als eine Reihe je Spalte: darunter senkrecht weiter bis zur nächsten Spalte
        for (let yy = y - 2; !last && yy > next - 1; yy--) commit([make(E(u, yy, 1), FRAME_ROLE, 'block', {}, d.roomId)]);
      }
    });
    banded.add(key3(d.pos));
  }
  // W9-G4 Traufleiste (Vorbilder: Vordach aus Treppen/Stufen über der Front 7/19): eine obere Stufe vor der obersten
  // Wandreihe über die ganze Front, wo frei (W12-B: auch neben der Rundtür; Ring, Laternenplatz und Rahmen bleiben).
  // Einzelne Zellen, ganz oder gar nicht je Zelle; Stufen ändern keine Treppenform.
  for (const d of doors) {
    const front = d.orient!.facing!;
    const b = byVolume.get(volumeOfRoom(d.roomId)!);
    if (b === undefined) continue;
    if (banded.has(key3(d.pos))) continue;
    const y = d.pos[1] + 3;
    for (const [x, z] of b.s.footprint) {
      if (forward(front, x, z) !== b.f) continue;
      const p = step([x, y, z], front);
      if (taken(p) || clear.has(key3(p))) continue;
      added.set(key3(p), make(p, 'roof_trim', 'slab', { half: 'top' }, d.roomId));
    }
  }
  return { cells: [...added.values()], clear };
}

/**
 * W13-C (28.09.2026): Höhe des Stirnbogens über der Decke an der Frontspalte `u` (Grundriss quer zur Front `s0 … s1`):
 * flacher Stufenbogen wie die Vorbilder – je zwei Spalten eine Reihe höher, an den Ecken 0, im Scheitel höchstens 2
 * (Runde 2: vorher 3, „schwerer Bretterbogen“);
 * spiegelgleich. Erst ab Frontbreite 11.
 */
export function crownRise(u: number, s0: number, s1: number): number {
  const half = (s1 - s0) / 2;
  if (half < 5 || u < s0 || u > s1) return 0;
  return Math.min(2, Math.floor((half + 1 - Math.abs(u - (s0 + s1) / 2)) / 2));
}

function step(p: Vec3, d: HorizontalDir, k = 1): Vec3 {
  return [p[0] + STEP[d][0] * k, p[1], p[2] + STEP[d][1] * k];
}
