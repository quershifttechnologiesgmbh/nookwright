/**
 * Außenprofil-Pass (research/18 §3 F2, F3a, F7 und D2; research/16 Tricks #1, #4, #8): Tiefe vor der Wand statt
 * flacher Fassaden. Rein und deterministisch; arbeitet nur auf der fertigen Hülle und ihren Ankern (anchors.ts),
 * also unabhängig vom Dach-Algorithmus. Neue Zellen haben `kind: 'facade'`, `exterior: true` und liegen immer in
 * Außenluft (nie in Wandebene, Innenraum, Dach oder Treppe); die Zelle vor einer Außentür bleibt von der
 * Bodenplatte an 2 hoch frei, dazu 1 Block Weg davor, und vor Fenstern liegt nie etwas (W2: auch keine F1-Paneele).
 *
 * Schnitt quer zur Traufwand (x < 0 außen), EG lichte Höhe 3, Walmdach mit Überstand 1:
 *
 *   y \ x   -1   0
 *     4      /   =      / Dachüberstand (Hülle), = Decke
 *     3      v   #      v Traufkonsole bzw. Kopf der Wandvorlage (beam, Treppe half=top, Rücken zur Wand)
 *     1..2   |   #      | Wandvorlage (beam, Stamm axis=y), nur vor fensterlosen Wandspalten
 *     0      /   =      / Sockelprofil (wall_plinth, Treppe half=bottom, Rücken zur Wand), = Bodenplatte
 *
 * Etagengrenze: Gesims (wall_cornice, Treppe half=top) vor der Bodenplatte der oberen Etage. Außenecken der
 * Bänder sind Eckstücke (outer_right, Vanilla-Regel ergibt dieselbe Form). Eckquader (F7, research/12 §3.6)
 * ändern nur Rollen: Eckpfeiler immer `wall_quoin`, das Wandfeld daneben wechselnd je Reihe (1/2 verzahnt).
 */
import { HORIZONTAL, distribute, distributeSymmetric, cellKey, key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import type { RoomId } from '../model.js';
import { alongOf, deriveAnchors, exteriorModel, runsOf, stepV, type ExtLevel, type ExteriorModel, type WallLine } from './anchors.js';
import { CCW, CW, OPP, STEP, axisOf } from './grid.js';
import type { FacadeGridLine, FacadeRules, FacadeStyle, Shell, ShellAnchor, ShellCell, ShellOrient } from './types.js';

/**
 * Standard-Pflichtregeln der Fassade (Q2, research/58 §Q2): Dachüberstand ≥ 1 mit Dachkante, Fensterrahmen mit
 * Rücksprung, Sockel in der Rolle `foundation`, Vorsprung ab 6 Blöcken Wandlänge, höchstens 3 gleiche Fensterachsen
 * in Folge, genau ein Fokuspunkt je Fassade. Bautypen und die App setzen sie als Vorgabe; ohne sie bleibt die Hülle
 * zellgleich zu vorher.
 *
 * W2 (26.09.2026, plan/baustandard.md): dazu Außenhaut (`skin`, W1/I2), Fassadenraster (`grid`, F1–F4/W2) und
 * Türlaibung (`jambs`, I4) als Standard. Mit Raster gilt „Hierarchie statt Bruch“: alle Fenstermodule einer Linie sind
 * gleich (`maxIdenticalAxes` bricht nichts mehr), der Fokus liegt nur im Mittelfeld einer Linie ohne Tür.
 *
 * W4-C (27.09.2026, plan/spikes/W4C_tueren.md): dazu Haustür im Mittelfeld (`centerDoor`, F3) und Doppeltür für
 * Eingänge in Säle (`doubleDoor`, `DOUBLE_DOOR_ROOM_TYPES`).
 */
export const FACADE_QUALITY_RULES: FacadeRules = {
  minOverhang: 1, roofEdge: true, windowFrame: true, foundationBase: true, pierFrom: 6, maxIdenticalAxes: 3, focus: true,
  skin: true, grid: true, jambs: true, centerDoor: true,
  doubleDoor: ['tavern', 'throne_room', 'mead_hall', 'dining_hall', 'trading_hall', 'chapel'],
};

/**
 * W4-C: Raumtypen mit Doppeltür als Haustür (Vorbilder: Doppeltür an Hallen, Burgen, Wirtshäusern und Kirchen – 7 von 28
 * Eingangs-Vorbildern in W3-EN, dazu die Doppeltür-Vorbilder in plan/spikes/W4C_tueren.md): Schankraum, Thronsaal,
 * Methalle, Speisesaal, Handelshalle, Kapelle.
 */
export const DOUBLE_DOOR_ROOM_TYPES: readonly string[] = FACADE_QUALITY_RULES.doubleDoor!;

/**
 * Hülle mit Außenprofil: Eckquader als Rollenwechsel bestehender Zellen, Profilzellen hinten angehängt.
 * Anker bleiben die der Hülle ohne Profil (Andockstellen für Komponenten).
 */
export function applyFacade(shell: Shell, style: FacadeStyle): Shell {
  const model = exteriorModel(shell);
  const anchors = shell.anchors ?? deriveAnchors(shell, model);
  const { added, replaced } = facadeCells(shell, model, anchors, style);
  // W13-E: Leseport für das Wandkleid der Obergeschosse (die Flächen-Regeln des Themes entscheiden das Material)
  const frame = style.upperFrame === true ? { upperFrame: true as const } : {};
  if (added.length === 0 && replaced.size === 0) return { ...shell, anchors, ...frame };
  return { ...shell, cells: [...shell.cells.map((c) => replaced.get(key3(c.pos)) ?? c), ...added], anchors, ...frame };
}

/**
 * Wandvorlagen einer Linie mit `length` Spalten (Enden = Ecken): so wenige wie möglich, gleichmäßig verteilt,
 * sodass kein flaches Stück länger als `max` bleibt. Nur Stellen mit `ok`; bei Gleichstand gewinnen Pfosten
 * (`post`), dann die Mitte (spiegelsymmetrisch). Geht es nicht auf, die Verteilung mit der kleinsten Lücke.
 * `minSlots` erzwingt mindestens so viele Vorlagen (Q2: ab einer Wandlänge ist ein Vorsprung Pflicht).
 */
export function pilasterSlots(
  length: number, max: number, ok: (i: number) => boolean, post: (i: number) => boolean = () => false, minSlots = 0,
): number[] {
  const inner = length - 2;
  if (max < 1 || (inner <= max && minSlots <= 0)) return [];
  const cands = [...Array(length).keys()].slice(1, -1).filter(ok);
  const gapOf = (slots: readonly number[]): number => {
    const pts = [0, ...slots, length - 1];
    return Math.max(...pts.slice(1).map((p, i) => p - pts[i]! - 1));
  };
  let best: number[] = [];
  let bestGap = Infinity;
  for (let k = Math.max(minSlots, Math.ceil((inner - max) / (max + 1))); k <= cands.length; k++) {
    const slots = distributeSymmetric(length, k, cands, post);
    const gap = gapOf(slots);
    if (gap <= max && slots.length >= minSlots) return slots;
    if (slots.length >= minSlots && gap < bestGap) [best, bestGap] = [slots, gap];
  }
  return best;
}

/** Innenstellen 1…span−2 im Takt `step`, mittig verteilt (Traufkonsolen). */
export function rhythm(span: number, step: number): number[] {
  return distribute(span, { step, ends: 'open' });
}

/** Stellen 0…len−1 mit Abstand ≤ `step`, beide Enden eingeschlossen (Konsolen unter einer Auskragung). */
function spread(len: number, step: number): number[] {
  return distribute(len, { step, ends: 'both' });
}

/**
 * W2: Rasterlinie (Fassadenraster der Hülle) zu einer Wandlinie des Außenmodells: gleiche Außenseite, Bodenplatte und
 * Wandebene, überlappende Spalten. `undefined` ohne Raster.
 */
function gridLineOf(shell: Shell, lvl: ExtLevel, line: WallLine): FacadeGridLine | undefined {
  if (shell.facadeGrid === undefined || line.cols.length === 0) return undefined;
  const ns = line.out === 'north' || line.out === 'south';
  const plane = ns ? line.cols[0]![1] : line.cols[0]![0];
  const a0 = ns ? line.cols[0]![0] : line.cols[0]![1];
  const a1 = a0 + line.cols.length - 1;
  return shell.facadeGrid.find((g) => g.out === line.out && g.y0 === lvl.y0 && g.plane === plane && g.from <= a1 && g.to >= a0);
}

function facadeCells(shell: Shell, m: ExteriorModel, anchors: readonly ShellAnchor[], style: FacadeStyle): { added: ShellCell[]; replaced: Map<string, ShellCell> } {
  const { at, isAir, levels, isGround } = m;
  const rules = style.rules;
  const gridded = shell.facadeGrid !== undefined;
  /** Entlang-Koordinate einer Spalte (x bei Nord/Süd, z bei Ost/West). */
  const alongCoord = (out: HorizontalDir, c: readonly [number, number]): number => (axisOf(out) === 'z' ? c[0] : c[1]);
  /** Wandebene einer Position (z bei Nord/Süd, x bei Ost/West). */
  const planeOfCol = (out: HorizontalDir, p: Vec3): number => (axisOf(out) === 'z' ? p[2] : p[0]);
  /** Etage eines Ankers; mit Baukörpern kann ein Index mehrere Etagen haben (Raum des Ankers, sonst Höhe). */
  const levelOf = (a: ShellAnchor): ExtLevel | undefined => {
    const cands = levels.filter((l) => l.index === a.floorIndex);
    if (cands.length <= 1) return cands[0];
    const own = m.levelOfRoom(a.roomId);
    return (own !== undefined && cands.includes(own) ? own : undefined) ?? cands.find((l) => a.pos[1] >= l.y0 - 1 && a.pos[1] <= l.topY + 2) ?? cands[0];
  };
  const below = (u: ExtLevel): ExtLevel | undefined => levels.find((l) => l.index === u.index - 1 && l.topY + 1 === u.y0);
  const added = new Map<string, ShellCell>();
  const replaced = new Map<string, ShellCell>();

  // Freihalten: vor Außentüren Zelle + Weg von der Bodenplatte bis 2 hoch; Luft neben jeder Fensterscheibe
  const keep = new Set<string>();
  for (const a of anchors) {
    if (a.kind !== 'door') continue;
    const y0 = levelOf(a)?.y0 ?? a.pos[1] - 1;
    for (let y = y0; y <= a.pos[1] + 1; y++) for (const k of [0, 1]) keep.add(key3(stepV([a.pos[0], y, a.pos[2]], a.facing, k)));
  }
  // W3 (27.09.2026): Eingang – mit Raster (F4 „Haustür ±1 frei“) bleibt vor der Haustür auch die Bodenplattenreihe der
  // Nachbarspalten frei: dort liegt die dreibreite Stufe des Eingangsmoduls (eigenes Material), nicht das Sockelprofil.
  if (gridded) {
    const mainFronts = new Set<string>();
    for (const r of shell.rooms.values()) {
      for (const d of r.doors) if (d.isMain) mainFronts.add(`${d.inside[0] + 2 * STEP[d.toward][0]},${d.inside[1] + 2 * STEP[d.toward][1]}|${d.toward}`);
    }
    for (const a of anchors) {
      if (a.kind !== 'door' || !mainFronts.has(`${a.pos[0]},${a.pos[2]}|${a.facing}`)) continue;
      const y0 = levelOf(a)?.y0 ?? a.pos[1] - 1;
      for (const s of [-1, 1]) keep.add(key3(stepV([a.pos[0], y0, a.pos[2]], alongOf(a.facing), s)));
    }
  }
  for (const c of shell.cells) if (c.kind === 'window') for (const d of HORIZONTAL) keep.add(key3(stepV(c.pos, d)));

  // W3-CA (K6/F8, Burg): keine Profilzelle über dem höchsten Dachblock ihrer Spalte – Gesims und Fensterrahmen eines
  // höheren Baukörpers (Bergfried) enden über dem Dach eines niedrigeren (Palas), statt auf ihm zu liegen
  const roofTop = new Map<string, number>();
  for (const c of shell.cells) {
    if (c.kind !== 'roof') continue;
    const k = `${c.pos[0]},${c.pos[2]}`;
    if ((roofTop.get(k) ?? -Infinity) < c.pos[1]) roofTop.set(k, c.pos[1]);
  }
  const overRoof = (p: Vec3): boolean => (roofTop.get(`${p[0]},${p[2]}`) ?? Infinity) < p[1];
  const free = (p: Vec3): boolean => isAir(p) && !added.has(key3(p)) && !keep.has(key3(p)) && !overRoof(p);
  const make = (pos: Vec3, role: string, shape: string, orient: ShellOrient, roomId: RoomId | undefined): ShellCell => ({
    pos, kind: 'facade', role, shape, orient, ...(roomId !== undefined ? { roomId } : {}), exterior: true,
  });
  const put = (c: ShellCell): boolean => {
    if (!free(c.pos)) return false;
    added.set(key3(c.pos), c);
    return true;
  };
  const stairs = (half: 'bottom' | 'top', facing: HorizontalDir, stairShape?: 'outer_right'): ShellOrient => ({ facing, half, ...(stairShape !== undefined ? { stairShape } : {}) });
  /** Raum der Wand hinter einer Außenzelle (Herkunft), gemessen auf der untersten Wandreihe. */
  const roomBehind = (p: Vec3, out: HorizontalDir, lvl: ExtLevel | undefined): RoomId | undefined =>
    at(stepV([p[0], lvl?.baseY ?? p[1], p[2]], OPP[out]))?.roomId;

  /** W2: Pfostenspalten der Rasterlinie vor der Wandzelle `wall` (Seite `out`, Bodenplatte `y0`); ohne Raster `undefined`. */
  const gridPostsAt = (out: HorizontalDir, wall: Vec3, y0: number): readonly number[] | undefined => {
    if (!gridded) return undefined;
    const a = alongCoord(out, [wall[0], wall[2]]);
    return shell.facadeGrid!.find((g) => g.out === out && g.y0 === y0 && g.plane === planeOfCol(out, wall) && g.from <= a && g.to >= a)?.posts ?? [];
  };
  /**
   * W2 (Hierarchie statt Bruch, X2 §6.4): Fokus einer Fensterlinie ist das Fenster im Mittelfeld ihrer Rasterlinie –
   * nur, wenn auf der Linie keine Tür liegt (dann ist die Tür der Akzent); sonst keiner.
   */
  const gridFocus = (axes: readonly ShellAnchor[]): ShellAnchor | undefined => {
    const a = axes[0]!;
    const lvl = levelOf(a);
    if (lvl === undefined) return undefined;
    const wall = stepV(a.pos, OPP[a.facing]);
    const at0 = alongCoord(a.facing, [wall[0], wall[2]]);
    const g = shell.facadeGrid!.find((l) => l.out === a.facing && l.y0 === lvl.y0 && l.plane === planeOfCol(a.facing, wall) && l.from <= at0 && l.to >= at0);
    if (g === undefined || g.bays.length % 2 === 0) return undefined;
    const hasDoor = anchors.some((d) => d.kind === 'door' && d.facing === g.out && levelOf(d)?.y0 === g.y0
      && planeOfCol(d.facing, stepV(d.pos, OPP[d.facing])) === g.plane && alongCoord(d.facing, [d.pos[0], d.pos[2]]) >= g.from && alongCoord(d.facing, [d.pos[0], d.pos[2]]) <= g.to);
    if (hasDoor) return undefined;
    const mid = g.bays[(g.bays.length - 1) / 2]!.axis;
    return axes.find((x) => alongCoord(x.facing, [x.pos[0], x.pos[2]]) === mid[0] && (x.span ?? 1) === mid.length && x.pos[1] <= lvl.topY);
  };

  // ---------------------------------------------------------------- F2 Sockelprofil, F7 Gesims (Bänder mit Eckstücken)
  const band = (kind: 'plinth' | 'storey_line', role: string, half: 'bottom' | 'top'): void => {
    for (const a of anchors) {
      if (a.kind !== kind) continue;
      const lvl = levelOf(a);
      for (let j = 0; j < (a.span ?? 1); j++) {
        const p = stepV(a.pos, alongOf(a.facing), j);
        put(make(p, role, 'stairs', stairs(half, OPP[a.facing]), roomBehind(p, a.facing, lvl)));
      }
    }
    for (const a of anchors) {
      const lvl = a.kind === 'corner' ? levelOf(a) : undefined;
      if (lvl === undefined || (kind === 'plinth') !== isGround(lvl)) continue;
      const d = a.facing;
      const diag: Vec3 = [a.pos[0], lvl.y0, a.pos[2]];
      // Eckstück nur, wenn beide Nachbarn quer zueinander laufen (sonst ergibt Vanilla `straight`, z. B. an einer Stufe im
      // Umriss, wo das Band der vorderen Wand die Ecke schon belegt)
      const sides = [stepV(diag, OPP[CW[d]]), stepV(diag, OPP[d])].map((p) => added.get(key3(p)));
      const facings = [OPP[d], OPP[CW[d]]];
      if (sides.every((s, k) => s?.role === role && s.orient?.half === half && s.orient.facing === facings[k])) {
        put(make(diag, role, 'stairs', stairs(half, OPP[d], 'outer_right'), a.roomId));
      }
    }
  };
  if (style.plinthProfile === true || rules?.foundationBase === true) {
    // Q2 (Hebel 3): der Sockel läuft in der Theme-Rolle `foundation` – dunkler und rauer als die Wand
    band('plinth', rules?.foundationBase === true ? 'foundation' : 'wall_plinth', 'bottom');
  }
  if (style.cornice === true) band('storey_line', 'wall_cornice', 'top');

  // ---------------------------------------------------------------- Wandvorlagen (Trick #1): Stamm +1 mit Fuß und Kopf
  // Q2 (Hebel 4): ab `pierFrom` Blöcken Wandlänge ist ein Vorsprung Pflicht; `pierFrom` begrenzt zugleich den
  // längsten flachen Lauf, `pilasters` darf ihn nur verkürzen (nie verlängern).
  const pierFrom = rules?.pierFrom !== undefined ? Math.max(1, Math.floor(rules.pierFrom)) : undefined;
  const maxRun = pierFrom === undefined ? Math.floor(style.pilasters ?? 0)
    : Math.min(pierFrom, style.pilasters !== undefined && style.pilasters > 0 ? Math.floor(style.pilasters) : pierFrom);
  /** Zellen einer Wandvorlage vor Spalte `i` der Linie (Fuß, Stamm, Kopf); `undefined`, wenn sie dort nicht passt. */
  const pilasterPlan = (lvl: ExtLevel, line: WallLine, i: number): ShellCell[] | undefined => {
    const d = line.out;
    const col = line.cols[i];
    if (col === undefined) return undefined; // Pfosten außerhalb dieser Linie (Geschoss kürzer als das Raster)
    for (let y = lvl.baseY; y <= lvl.topY; y++) {
      const k = at([col[0], y, col[1]])?.kind;
      if (k !== 'wall' && k !== 'pillar') return undefined; // nie vor Fenstern oder Türen
    }
    const o = (y: number): Vec3 => stepV([col[0], y, col[1]], d);
    const roomId = at([col[0], lvl.baseY, col[1]])?.roomId;
    const cells: ShellCell[] = [];
    // Fuß: Sockeltreppe (unterste Etage) bzw. Kragstein auf der Etagengrenze; ein vorhandenes Band trägt mit
    const have = added.get(key3(o(lvl.y0)));
    if (have === undefined) {
      if (!free(o(lvl.y0))) return undefined;
      cells.push(isGround(lvl)
        ? make(o(lvl.y0), 'wall_plinth', 'stairs', stairs('bottom', OPP[d]), roomId)
        : make(o(lvl.y0), 'beam', 'stairs', stairs('top', OPP[d]), roomId));
    } else if (have.shape !== 'stairs' || have.orient?.facing !== OPP[d]) return undefined;
    for (let y = lvl.baseY; y < lvl.topY; y++) {
      if (!free(o(y))) return undefined;
      cells.push(make(o(y), 'beam', 'log', { axis: 'y' }, roomId));
    }
    // Kopf: umgedrehte Treppe; liegt dort schon der Dachüberstand, endet der Stamm darunter
    if (free(o(lvl.topY))) cells.push(make(o(lvl.topY), 'beam', 'stairs', stairs('top', OPP[d]), roomId));
    else if (at(o(lvl.topY))?.kind !== 'roof') return undefined;
    return cells;
  };
  if (maxRun >= 1 && gridded) gridPilasters(maxRun, pierFrom);
  else if (maxRun >= 1) {
    for (const lvl of levels) {
      for (const line of lvl.lines) {
        const plan = (i: number): ShellCell[] | undefined => pilasterPlan(lvl, line, i);
        const post = (i: number): boolean => at([line.cols[i]![0], lvl.baseY, line.cols[i]![1]])?.kind === 'pillar';
        // Q2: „ab 6 Blöcken Wandlänge“ – jede Wandlinie ab `pierFrom` Zellen bekommt mindestens eine Wandvorlage.
        const force = pierFrom !== undefined && line.cols.length >= pierFrom ? 1 : 0;
        for (const i of pilasterSlots(line.cols.length, maxRun, (i) => plan(i) !== undefined, post, force)) for (const c of plan(i) ?? []) put(c);
      }
    }
  }

  /**
   * W2 (Baustandard W2/F4): Wandvorlagen nur auf Pfostenspalten des Fassadenrasters und für alle Geschosse einer
   * Rasterlinie gleich (fluchtend). Kandidat ist ein Pfosten, der auf jedem Geschoss passt, mindestens 1 Spalte
   * Abstand zu jeder Öffnung hat und nicht Pfosten des Haustür-Felds ist (dort stehen Portal/Vordach und das
   * Laternenpaar). Gewählt werden so wenige wie möglich (spiegelgleich), sodass kein flaches Stück – Spalten ohne
   * Öffnung ±1 und ohne Vorlage – länger als `maxRun` bleibt; eine ganz fensterlose Linie ab `pierFrom` bekommt
   * mindestens eine (Q2).
   */
  function gridPilasters(maxRun: number, pierFrom: number | undefined): void {
    const mainFronts = new Set<string>();
    for (const r of shell.rooms.values()) {
      for (const d of r.doors) if (d.isMain) mainFronts.add(`${d.inside[0] + 2 * STEP[d.toward][0]},${d.inside[1] + 2 * STEP[d.toward][1]}|${d.toward}`);
    }
    const mainDoors = anchors.filter((a) => a.kind === 'door' && mainFronts.has(`${a.pos[0]},${a.pos[2]}|${a.facing}`));
    type Member = { lvl: ExtLevel; line: WallLine; grid: FacadeGridLine; a0: number };
    const stacks: Member[][] = [];
    for (const lvl of levels) {
      for (const line of lvl.lines) {
        const grid = gridLineOf(shell, lvl, line);
        if (grid === undefined || grid.posts.length === 0 || line.cols.length < 3) continue;
        const member = { lvl, line, grid, a0: alongCoord(line.out, line.cols[0]!) };
        const key = grid.posts.join(',');
        const stack = stacks.find((st) => {
          const last = st[st.length - 1]!;
          return last.grid.out === grid.out && last.grid.posts.join(',') === key && Math.abs(last.grid.plane - grid.plane) <= 1;
        });
        if (stack !== undefined) stack.push(member);
        else stacks.push([member]);
      }
    }
    for (const stack of stacks) {
      const posts = stack[0]!.grid.posts;
      const openAt = (mb: Member, a: number): boolean => {
        const i = a - mb.a0;
        if (i < 0 || i >= mb.line.cols.length) return false;
        const col = mb.line.cols[i]!;
        for (let y = mb.lvl.baseY; y <= mb.lvl.topY; y++) {
          const k = at([col[0], y, col[1]])?.kind;
          if (k === 'window' || k === 'door') return true;
        }
        return false;
      };
      const nearOpening = (mb: Member, a: number): boolean => openAt(mb, a - 1) || openAt(mb, a) || openAt(mb, a + 1);
      /** Spalten der Haustüren dieser Rasterlinie (gleiche Seite, Wandebene und Bodenplatte). */
      const doorCols = stack.flatMap((mb) => mainDoors
        .filter((dr) => dr.facing === mb.line.out && m.levelOfRoom(dr.roomId)?.y0 === mb.lvl.y0
          && planeOfCol(dr.facing, stepV(dr.pos, OPP[dr.facing])) === planeOfCol(mb.line.out, [mb.line.cols[0]![0], 0, mb.line.cols[0]![1]]))
        .map((dr) => alongCoord(dr.facing, [dr.pos[0], dr.pos[2]])));
      const nearMainDoor = (a: number): boolean => doorCols.some((ad) => Math.abs(ad - a) <= 2);
      const cands = posts.filter((a) => !nearMainDoor(a) && stack.every((mb) => !nearOpening(mb, a) && pilasterPlan(mb.lvl, mb.line, a - mb.a0) !== undefined));
      const chosen = new Set<number>();
      /** Längstes flaches Stück über alle Geschosse: [Start, Länge] entlang, `undefined` wenn keins zu lang ist. */
      const flat = (skip: ReadonlySet<string>): { mb: Member; s: number; len: number } | undefined => {
        let best: { mb: Member; s: number; len: number } | undefined;
        for (const mb of stack) {
          const n = mb.line.cols.length;
          let s = -1;
          for (let i = 1; i <= n - 1; i++) {
            const a = mb.a0 + i;
            const quiet = i < n - 1 && !nearOpening(mb, a) && !chosen.has(a);
            if (quiet && s < 0) s = i;
            if (!quiet && s >= 0) {
              const len = i - s;
              if (len > maxRun && !skip.has(`${mb.lvl.y0}|${s}`) && (best === undefined || len > best.len)) best = { mb, s, len };
              s = -1;
            }
          }
        }
        return best;
      };
      const mirror = (a: number): number => stack[0]!.grid.from + stack[0]!.grid.to - a;
      const pick = (a: number): void => {
        chosen.add(a);
        if (cands.includes(mirror(a))) chosen.add(mirror(a));
      };
      const unsolvable = new Set<string>();
      for (let guard = 0; guard < 64; guard++) {
        const f = flat(unsolvable);
        if (f === undefined) break;
        const lo = f.mb.a0 + f.s;
        const hi = lo + f.len - 1;
        const mid2 = lo + hi;
        const inside = cands.filter((a) => a >= lo && a <= hi && !chosen.has(a))
          .sort((p, q) => Math.abs(2 * p - mid2) - Math.abs(2 * q - mid2) || Math.abs(2 * p - (stack[0]!.grid.from + stack[0]!.grid.to)) - Math.abs(2 * q - (stack[0]!.grid.from + stack[0]!.grid.to)) || p - q);
        if (inside.length === 0) unsolvable.add(`${f.mb.lvl.y0}|${f.s}`);
        else pick(inside[0]!);
      }
      // Q2: eine ganz fensterlose Linie ab `pierFrom` Spalten bekommt mindestens eine Vorlage (die mittigste)
      const blank = stack.some((mb) => mb.line.cols.length >= (pierFrom ?? Infinity) && mb.line.cols.every((_, i) => !openAt(mb, mb.a0 + i)));
      if (blank && chosen.size === 0 && cands.length > 0) {
        const c2 = stack[0]!.grid.from + stack[0]!.grid.to;
        pick([...cands].sort((p, q) => Math.abs(2 * p - c2) - Math.abs(2 * q - c2) || p - q)[0]!);
      }
      for (const mb of stack) for (const a of [...chosen].sort((p, q) => p - q)) for (const c of pilasterPlan(mb.lvl, mb.line, a - mb.a0) ?? []) put(c);
    }
  }

  // ---------------------------------------------------------------- D2 Traufkonsolen, F3a Konsolen unter der Auskragung
  const step = Math.floor(style.brackets ?? 0);
  if (step >= 1) {
    for (const a of anchors) {
      if (a.kind !== 'eave') continue;
      const lvl = levelOf(a);
      // W2: mit Fassadenraster nur auf Pfostenspalten (Konsole an jedem Pfosten), sonst im Takt
      const posts = lvl === undefined ? undefined : gridPostsAt(a.facing, stepV(a.pos, OPP[a.facing]), lvl.y0);
      const start = alongCoord(a.facing, [a.pos[0], a.pos[2]]);
      const slots = posts === undefined ? rhythm(a.span ?? 1, step) : posts.map((p) => p - start).filter((j) => j >= 0 && j < (a.span ?? 1));
      for (const j of slots) {
        const p = stepV(a.pos, alongOf(a.facing), j);
        const back = at(stepV(p, OPP[a.facing]))?.kind;
        // keine Doppelkonsole direkt neben dem Kopf einer Wandvorlage
        const beside = [CW[a.facing], CCW[a.facing]].some((s) => added.get(key3(stepV(p, s)))?.role === 'beam');
        if (!beside && (back === 'wall' || back === 'pillar' || back === 'lintel')) put(make(p, 'beam', 'stairs', stairs('top', OPP[a.facing]), roomBehind(p, a.facing, lvl)));
      }
    }
    // Gemalte Auskragung um genau 1 über einer Außenwand: Konsole unter der Wand der oberen Etage, an jedem Pfosten
    // und dazwischen im Takt (research/16 U2); weitere Auskragung bräuchte Stützen (offen)
    for (const up of levels) {
      const lo = below(up);
      if (lo === undefined) continue;
      for (const line of up.lines) {
        const d = line.out;
        const over = (i: number): boolean => {
          const [x, z] = line.cols[i]!;
          return !lo.footprint.has(cellKey(x, z)) && lo.footprint.has(cellKey(x - STEP[d][0], z - STEP[d][1]));
        };
        // W2: mit Fassadenraster an den Enden und auf den Pfosten, sonst an jedem Pfeiler und im Takt
        const grid = gridLineOf(shell, up, line);
        for (const [s, len] of runsOf(line.cols.length, over)) {
          const a0 = alongCoord(d, line.cols[s]!);
          const slots = grid !== undefined
            ? [0, len - 1, ...grid.posts.map((p) => p - a0).filter((j) => j >= 0 && j < len)]
            : [...spread(len, step), ...[...Array(len).keys()].filter((j) => at([line.cols[s + j]![0], up.baseY, line.cols[s + j]![1]])?.kind === 'pillar')];
          for (const j of [...new Set(slots)].sort((p, q) => p - q)) {
            const [x, z] = line.cols[s + j]!;
            put(make([x, up.y0 - 1, z], 'beam', 'stairs', stairs('top', OPP[d]), at([x, up.baseY, z])?.roomId));
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- Q2 Fensterrahmen (Hebel 2): Rücksprung + Rahmen
  // Rund um jede Scheibe liegt in Außenluft ein Rahmen: Fensterbank (Stufe) unten, Verdachung (Treppe) oben und
  // senkrechte Wangen (Stamm) seitlich. Die Scheibe liegt dadurch 1 Block hinter der Rahmenvorderkante. Die
  // Freihalte-Regel vor Scheiben gilt hier bewusst nicht (der Rahmen liegt NEBEN, nie vor dem Glas); belegte Zellen
  // (Sockel, Gesims, Konsole) bleiben unangetastet.
  if (rules?.windowFrame === true) {
    const up = (p: Vec3, k: number): Vec3 => [p[0], p[1] + k, p[2]];
    const frameRole = style.frameRole;
    const frameAs = frameRole ?? 'window_frame';
    const putFrame = (p: Vec3, role: string, shape: string, orient: ShellOrient, roomId: RoomId | undefined): boolean => {
      if (!isAir(p) || added.has(key3(p)) || overRoof(p)) return false;
      added.set(key3(p), make(p, role, shape, orient, roomId));
      return true;
    };
    /**
     * W2 (Baustandard F8, X3 K6 „Traufzone frei“): eine Rahmenzelle, unter der in ihrer Spalte schon Dach derselben
     * Etage liegt (ab ihrer untersten Wandreihe `fromY`) – Verdachung auf der Traufe, Rahmen einer Gaube auf der
     * Dachfläche –, entfällt. Dach einer tieferen Etage (Fenster über einem Anbau-Dach) stört nicht.
     */
    const belowEave = (p: Vec3, fromY: number): boolean => !(m.roofCols.get(cellKey(p[0], p[2])) ?? []).some((r) => r.pos[1] >= fromY && r.pos[1] < p[1]);
    // Fensterhöhe: zusammenhängende Fensterzellen über der Ankerzeile
    const heightOf = (a: ShellAnchor): number => {
      const cellPos = stepV(a.pos, OPP[a.facing]);
      let h = 0;
      while (at([cellPos[0], cellPos[1] + h, cellPos[2]])?.kind === 'window') h++;
      return Math.max(1, h);
    };
    // Achsen je Wandlinie: gleiche Etage, Richtung und Wandebene, in Laufrichtung sortiert
    const lineKey = (a: ShellAnchor): string => {
      const alongX = axisOf(a.facing) === 'z';
      return `${a.floorIndex}|${a.facing}|${alongX ? a.pos[2] : a.pos[0]}`;
    };
    const alongValue = (a: ShellAnchor): number => (axisOf(a.facing) === 'z' ? a.pos[0] : a.pos[2]);
    const axesOfLine = new Map<string, ShellAnchor[]>();
    for (const a of anchors) {
      if (a.kind !== 'window') continue;
      const k = lineKey(a);
      (axesOfLine.get(k) ?? axesOfLine.set(k, []).get(k)!).push(a);
    }
    const maxIdentical = rules.maxIdenticalAxes !== undefined ? Math.max(1, Math.floor(rules.maxIdenticalAxes)) : undefined;
    // Fokuspunkt: die Achse mit dem geringsten Abstand zur Haustür (Erdgeschoss) auf derselben Außenseite; ohne Tür
    // auf dieser Seite die erste Achse – genau eine Achse je Wandlinie bekommt die höchste Detaildichte.
    const groundDoors = anchors.filter((a) => a.kind === 'door' && a.floorIndex === 0);
    for (const list of axesOfLine.values()) {
      const axes = [...list].sort((p, q) => alongValue(p) - alongValue(q));
      const door = rules.focus === true
        ? [...groundDoors].sort((p, q) => Math.abs(alongValue(p) - alongValue(axes[0]!)) - Math.abs(alongValue(q) - alongValue(axes[0]!)))[0]
        : undefined;
      // W2 (Hierarchie statt Bruch): mit Raster trägt nur das Mittelfeld einer Linie ohne Tür den Fokus
      const focusAt = gridded ? gridFocus(axes) : door === undefined ? axes[0]! : axes.reduce((best, a) =>
        Math.abs(alongValue(a) - alongValue(door)) < Math.abs(alongValue(best) - alongValue(door)) ? a : best);
      for (const [index, a] of axes.entries()) {
        const d = a.facing;
        const along = alongOf(d);
        const back = OPP[d];
        const lvl = levelOf(a);
        const w = a.span ?? 1;
        const h = heightOf(a);
        const roomId = a.roomId;
        // Bruch der Wiederholung: jede (n+1)-te Achse bekommt eine flache Verdachung (Stufe) statt der Treppe
        const variant = !gridded && maxIdentical !== undefined && index % (maxIdentical + 1) === maxIdentical;
        // Rahmen an den beiden Seiten der Öffnung: Bank-Ecke (Stufe) unten, Verdachungs-Ecke oben. Die Zellen liegen
        // bewusst in den Nebenspalten und außerhalb der Scheibenreihen – die Außen-Deko
        // (X1: Läden, Blumenkasten, Bank, Verdachung) baut ihre Stücke in die Reihen und Spalten dazwischen und
        // bleibt so vollständig erhalten (research/53 §5: Rahmen-Sets, hier als Konsolen-Ecken).
        // W5-B (`FacadeStyle.frameRole`): mit eigener Rahmenrolle legt die Hülle Bank und Sturz über die ganze Breite
        // (Ecken und Mitte, ein Material); ohne sie nur die Ecken in `window_frame` (bitgleich)
        for (const side of frameRole !== undefined ? Array.from({ length: w + 2 }, (_, i) => i - 1) : gridded ? [] : [-1, w]) {
          const p = stepV(a.pos, along, side);
          // W4 (Baustandard F5, plan/spikes/W4F_dachproportion.md): nie vor Glas – beim Okulus (Glas im Plus) liegt
          // neben der Mittelreihe oben und unten eine Scheibe; dort entfallen Bank- bzw. Verdachungs-Ecke
          const glassBehind = (q: Vec3): boolean => at(stepV(q, back))?.kind === 'window';
          const room = lvl === undefined ? roomId : roomBehind(p, d, lvl) ?? roomId;
          const base = lvl?.baseY ?? a.pos[1];
          // W2-FW (26.09.2026): mit Raster ist die Bank-Ecke eine OBERE Stufe – sie liegt als Sims direkt unter der Scheibe
          // (Vorbilder: Bank aus Stufe unter dem Glas), nicht als Brett auf dem Sockel; das Fenstermodul setzt die Mitte gleich
          if (belowEave(up(p, -1), base) && !glassBehind(up(p, -1))) putFrame(up(p, -1), frameAs, 'slab', { half: gridded ? 'top' : 'bottom' }, room);
          if (!belowEave(up(p, h), base) || glassBehind(up(p, h))) continue;
          if (variant) putFrame(up(p, h), frameAs, 'slab', { half: 'bottom' }, room);
          else putFrame(up(p, h), frameAs, 'stairs', stairs('top', back), room);
        }
        // Fokuspunkt: genau eine Achse je Fassade bekommt die höchste Detaildichte (zweite Verdachung über der
        // Öffnung). Die Reihe über der Verdachung nutzt keine Außen-Deko-Zelle.
        // W7 (27.09.2026, plan/spikes/W7A_ruhe.md): nur auf einem Sturz derselben Etage – liegt die Sturzreihe schon im
        // Gesims/in der Deckenreihe (Fenster bis unter die Decke), säße die Verdachung in der Bankreihe des Obergeschosses
        // (Zweistöckig: das Obergeschoss-Fenster darüber verlor Bank und Sturz, mit F6 die ganze Seite)
        const lintelFree = !gridded || (lvl !== undefined && a.pos[1] + h <= lvl.topY
          && Array.from({ length: w }, (_, j) => up(stepV(a.pos, along, j), h)).every((p) => isAir(p) && !added.has(key3(p))));
        if (rules.focus === true && a === focusAt && lintelFree) {
          for (let j = 0; j < w; j++) {
            const p = up(stepV(a.pos, along, j), h + 1);
            if (belowEave(p, lvl?.baseY ?? a.pos[1])) putFrame(p, frameAs, 'stairs', stairs('bottom', back), roomId);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- F7 Eckquader: nur Rollenwechsel, keine neuen Zellen
  if (style.quoins === true) {
    // quoin(along, hRel) = along = 0 ∨ (along = 1 ∧ (hRel + s) mod 2 = 0); s nach Wandrichtung (Nord/Süd 0, Ost/West 1),
    // damit beide Ecken einer Fassade spiegelgleich verzahnt sind
    const s = (out: HorizontalDir): number => (axisOf(out) === 'z' ? 0 : 1);
    for (const a of anchors) {
      const lvl = a.kind === 'corner' ? levelOf(a) : undefined;
      if (lvl === undefined) continue;
      const d = a.facing;
      const k: Vec3 = stepV(stepV(a.pos, OPP[d]), OPP[CW[d]]);
      for (let y = lvl.baseY; y <= lvl.topY; y++) {
        const h = y - lvl.baseY;
        const spots: Array<readonly [Vec3, boolean]> = [[k, true], [stepV(k, CCW[d]), (h + s(d)) % 2 === 0], [stepV(k, OPP[d]), (h + s(CW[d])) % 2 === 0]];
        for (const [p, yes] of spots) {
          const c = yes ? at([p[0], y, p[2]]) : undefined;
          if (c === undefined || !(c.kind === 'pillar' || (c.kind === 'wall' && c.role === 'wall_primary'))) continue;
          replaced.set(key3(c.pos), {
            pos: c.pos, kind: c.kind, role: 'wall_quoin', shape: 'block',
            ...(c.roomId !== undefined ? { roomId: c.roomId } : {}), ...(c.exterior !== undefined ? { exterior: c.exterior } : {}),
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------- W5 Eckausbildung bis zur Traufunterkante
  // W5 (27.09.2026, Review W4-R N1, plan/spikes/W5A_fassade.md): über der obersten Wandreihe einer Etage (ohne Etage
  // darüber) läuft die Ecke durch die Deckenreihe (Rähm-Ecke) und den Kniestock bis unter das Dach – vorher endete sie
  // dort, darüber lagen Deckenring und Giebelwand-Material (Beispielhaus: 3 ungegliederte Reihen, helle Flecken). Nur
  // die Eckzelle, und nur mit Außenprofil (ein leerer Stil bleibt zellgleich): mit Eckquadern wird sie ein
  // Quader-Pfeiler (die verzahnten Nachbarn setzt das Theme ohnehin ins Wandfeld zurück; „Ecke nach Material“ –
  // Eckstamm im Holzfeld, Quader sonst – gilt wie darunter), ohne Eckquader setzt sich der Eckpfosten (`pillar`) mit
  // Rolle, Form und Ausrichtung fort. So bleiben Eckquader an/aus in Holz-Themes gleich (Eckstamm in beiden Fällen).
  const profile = style.quoins === true || style.plinthProfile === true || style.cornice === true
    || (style.brackets ?? 0) >= 1 || (style.pilasters ?? 0) >= 1 || rules !== undefined;
  for (const a of profile ? anchors : []) {
    const lvl = a.kind === 'corner' ? levelOf(a) : undefined;
    if (lvl === undefined) continue;
    const k: Vec3 = stepV(stepV(a.pos, OPP[a.facing]), OPP[CW[a.facing]]);
    if (levels.some((l) => l.y0 === lvl.topY + 1 && l.footprint.has(cellKey(k[0], k[2])))) continue;
    const head = style.quoins === true ? replaced.get(key3([k[0], lvl.topY, k[2]])) : at([k[0], lvl.topY, k[2]]);
    if (head === undefined || head.kind !== 'pillar') continue;
    for (let y = lvl.topY + 1; ; y++) {
      const c = at([k[0], y, k[2]]);
      const wallish = c !== undefined && (c.kind === 'ceiling' ? y === lvl.topY + 1 : c.kind === 'wall' && (c.role === 'wall_gable' || c.role === 'wall_primary'));
      if (!wallish || replaced.has(key3(c.pos))) break;
      replaced.set(key3(c.pos), {
        pos: c.pos, kind: 'pillar', role: head.role, shape: head.shape, ...(head.orient !== undefined ? { orient: head.orient } : {}),
        ...(c.roomId !== undefined ? { roomId: c.roomId } : {}), exterior: true,
      });
    }
  }

  // ---------------------------------------------------------------- F1 Deko (research/16 W4): Paneele und Giebelstreben
  const decor = style.decor;
  if (decor !== undefined) {
    const role = decor.role ?? 'beam';
    // Anbauteil flach vor der Wand: Rücken zur Wand, offen (Falltür) bzw. Fußstrebe (Treppe). `out` zeigt von der Wand weg.
    const orient = (shape: 'stairs' | 'trapdoor', out: HorizontalDir): ShellOrient =>
      shape === 'trapdoor' ? { facing: OPP[out], half: 'top', open: true } : { facing: OPP[out], half: 'bottom' };
    // Offene Falltür in der Brüstungsreihe unter jedem Fenster (research/16 W4). W2 (Baustandard F5 „nichts vor Glas“):
    // eine Reihe unter der untersten Scheibe vor der Brüstungswand – nie vor der Scheibe selbst.
    // W2-FW (26.09.2026): mit Fassadenraster gehört die Brüstungsreihe dem Fenstermodul (Blumenkasten bzw. Bank aus
    // @mcda/exterior, plan/spikes/W2FW_fenster.md) – dort entfällt das Paneel.
    if (decor.panels === true && !gridded) {
      for (const a of anchors) {
        if (a.kind !== 'window') continue;
        for (let j = 0; j < (a.span ?? 1); j++) {
          const p = stepV([a.pos[0], a.pos[1] - 1, a.pos[2]], alongOf(a.facing), j);
          const back = at(stepV(p, OPP[a.facing]))?.kind;
          if (back !== 'wall' && back !== 'pillar') continue;
          // W2 (F8): nicht auf der Dachfläche (Gaube) – Dach derselben Etage unter dem Paneel
          const base = levelOf(a)?.baseY ?? p[1];
          if ((m.roofCols.get(cellKey(p[0], p[2])) ?? []).some((r) => r.pos[1] >= base && r.pos[1] < p[1])) continue;
          put(make(p, role, 'trapdoor', orient('trapdoor', a.facing), a.roomId));
        }
      }
    }
    // Streben als Treppe vor der Giebelwand: Takt quer über die Giebelbasis, auf Höhe ihres ersten Riegels. Beim
    // Dreieckschnitt der Giebelstrebe (timber.ts) liegt ein Außenluft-Nachbar diagonal; die Treppe bekommt dann die
    // passende Eckform (`outer_right`), damit die Vanilla-Regel dieselbe Form ergibt.
    const braceStep = Math.floor(decor.gableBraces ?? 0);
    if (braceStep >= 1) {
      for (const a of anchors) {
        if (a.kind !== 'gable') continue;
        const along = alongOf(a.facing);
        const theCorner = [...HORIZONTAL].map((d) => stepV(stepV(a.pos, d), CW[d])).find((p) => !free(p));
        for (const j of rhythm(a.span ?? 1, braceStep)) {
          const p = stepV(a.pos, along, j);
          // Ein Kopf oder eine Konsole an derselben Stelle heißt schon „Rücken zur Wand und hoch“ – dort entfällt die Strebe
          if (added.get(key3(p))?.shape === 'stairs') continue;
          // W2 (F8 „Traufzone frei“): liegt in der Spalte schon Dach darunter (Ortgang/Traufe), ragte die Strebe darüber
          if ((m.roofCols.get(cellKey(p[0], p[2])) ?? []).some((r) => r.pos[1] < p[1])) continue;
          put(make(p, role, 'stairs', stairs('bottom', OPP[a.facing], p[0] === theCorner?.[0] && p[2] === theCorner?.[2] ? 'outer_right' : undefined), a.roomId));
        }
      }
    }
  }

  return { added: [...added.values()], replaced };
}
