/**
 * Zonenringe (research/18 Z1/Z3/Z4): Zaun mit Stammpfosten im Takt oder Hecke, Tor am Weg.
 *  - Z1: Pfosten (`fence_post`, 1 höher als der Zaun) an Ecken und neben Toren immer, dazwischen gleichmäßig
 *    verteilt mit höchstens `postEvery` Feldern Abstand; Kappe der Eck- und Torpfosten ist eine Laterne.
 *  - Z3: Hecke aus persistentem Laub, 1–2 hoch (wechselnd, Rauschen) oder 2 hoch im Rechteckschnitt.
 *  - Z4: Zauntor in der Ringlinie; im Heckenring stehen Pfosten neben dem Tor, beim Gartentor ein Laubbogen
 *    (3 hoch, Durchgang 2 hoch).
 *  - W4-A schlanke Zaunlinie (`logEvery`): Eckpfosten nur an Ecken und im großen Takt, dazwischen schlanke
 *    Zaunpfosten (Zaun 2 hoch) im Takt `postEvery`; die Torpfosten bleiben volle Stämme (2 hoch) mit Laterne.
 *  - W5-B (Review W4-R N10 „Zaunstümpfe mit Stammfuß wirken pfahlig“): der Eckpfosten ist kein Stumpf mit Stammfuß
 *    mehr (Stamm 1 hoch, Zaun darüber, Erde darunter), sondern ein Zaunpfosten 2 hoch wie die schlanken Pfosten, optional
 *    mit Laterne – „nur Ecken und Tor 1 höher“ (W4-A F2, P10; W5-B Feldzäune F3, F4). Volle Stämme bleiben am Tor.
 */
import { hashSeed, valueNoise2, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import type { Gen } from './gen.js';

export interface RingOptions {
  readonly edge: 'fence' | 'hedge';
  /** Z1: Pfosten spätestens nach so vielen Feldern; fehlt = ohne Pfosten (Zaunpfosten mit Laterne an Ecken). */
  readonly postEvery?: number;
  /** Laternen auf Eck- und Torpfosten. */
  readonly lanterns: boolean;
  /** W3-GA: Laternen nur auf den Torpfosten (`gate`) statt auf Eck- und Torpfosten (`anchors`, Standard). */
  readonly lanternsAt?: 'anchors' | 'gate';
  /** Laubbogen über dem Tor (Gartentor). */
  readonly arch?: boolean;
  /** Hecke durchgehend 2 hoch (Rechteckschnitt am Haus) statt 1–2. */
  readonly tall?: boolean;
  /** W4-A: schlanke Zaunlinie – Stammpfosten (Stumpf mit Zaunkopf) nur an Ecken und höchstens alle `logEvery` Felder. */
  readonly logEvery?: number;
}

/**
 * W4-A Pfosten-Takt einer Zaunstrecke der Länge `L` (Felder zwischen zwei Ankern, Anker bei 0 und L): `major` =
 * Stammpfosten im großen Takt (gleichmäßig, höchstens `logEvery` auseinander), `minor` = schlanker Zaunpfosten
 * (gleichmäßig zwischen den großen, höchstens `postEvery` auseinander), sonst kein Pfosten. Ohne `logEvery` gibt es
 * nur `minor` (gleichmäßig, höchstens `postEvery`).
 */
export function postKind(a: number, L: number, postEvery: number, logEvery?: number): 'major' | 'minor' | undefined {
  if (a <= 0 || a >= L) return undefined;
  let p = 0;
  let q = L;
  if (logEvery !== undefined) {
    const M = Math.ceil(L / logEvery);
    const majors: number[] = [];
    for (let j = 0; j <= M; j++) majors.push(Math.round((j * L) / M));
    if (majors.includes(a)) return 'major';
    for (let j = 1; j < majors.length; j++) {
      if (a < majors[j]!) {
        p = majors[j - 1]!;
        q = majors[j]!;
        break;
      }
    }
  }
  const len = q - p;
  const m = Math.ceil(len / postEvery);
  for (let k = 1; k < m; k++) if (p + Math.round((k * len) / m) === a) return 'minor';
  return undefined;
}

/**
 * Eckpfosten der schlanken Zaunlinie (Ecke, Linienende und großer Takt), optional mit Laterne obenauf. Liefert die
 * Laternenposition, wenn eine gesetzt wurde. W4-A: Stumpf mit Zaunkopf (Stamm 1 hoch, Zaun darüber); W5-B (Review W4-R
 * N10): Zaun 2 hoch ohne Stammfuß – 1 höher als die Linie wie die schlanken Pfosten, nicht mehr pfahlig.
 */
export function stubPost(g: Gen, x: number, y: number, z: number, lantern: boolean): Vec3 | undefined {
  slimPost(g, x, y, z);
  return lantern && g.emit([x, y + 3, z], 'plant', 'light_outdoor', 'lantern') ? [x, y + 3, z] : undefined;
}

/** W4-A schlanker Zaunpfosten: Zaun 2 hoch (1 höher als die Linie). */
export function slimPost(g: Gen, x: number, y: number, z: number): void {
  g.emit([x, y + 1, z], 'plant', 'fence_outdoor', 'fence');
  g.emit([x, y + 2, z], 'plant', 'fence_outdoor', 'fence');
}

export interface RingResult {
  readonly fence: Cell[];
  readonly posts: Cell[];
  /** W4-A: schlanke Zaunpfosten (Zaun 2 hoch) der schlanken Zaunlinie (nur mit `logEvery`). */
  readonly slim: Cell[];
  readonly hedge: Cell[];
  readonly lights: Vec3[];
}

export interface RingGate {
  readonly gate: number;
  readonly facing: HorizontalDir;
}

export function buildRing(g: Gen, ring: readonly number[], gate: RingGate | undefined, level: number, o: RingOptions, label: string): RingResult {
  const { grid, emit } = g;
  const set = new Set(ring);
  const nbs = (r: number): number[] => grid.n4(r).filter((j) => set.has(j));
  const straight = (r: number): boolean => {
    const nb = nbs(r);
    return nb.length === 2 && (grid.x(nb[0]!) === grid.x(nb[1]!) || grid.z(nb[0]!) === grid.z(nb[1]!));
  };
  const gateNb = new Set(gate !== undefined ? nbs(gate.gate) : []);
  const anchor = (r: number): boolean => !straight(r) || gateNb.has(r) || r === gate?.gate;
  const lit = (r: number): boolean => o.lanterns && (o.lanternsAt === 'gate' ? gateNb.has(r) : anchor(r));
  const postType = (r: number): 'gate' | 'corner' | 'major' | 'minor' | undefined => {
    if (o.postEvery === undefined || r === gate?.gate) return undefined;
    if (anchor(r)) return gateNb.has(r) ? 'gate' : 'corner';
    // Abstand zu den Ankern entlang der Linie; Pfosten gleichmäßig (höchstens postEvery Felder)
    const nb = nbs(r);
    const walk = (to: number): number => {
      let prev = r;
      let cur = to;
      let steps = 1;
      while (!anchor(cur)) {
        const next = nbs(cur).find((j) => j !== prev);
        if (next === undefined) break;
        prev = cur;
        cur = next;
        steps++;
      }
      return steps;
    };
    const a = walk(nb[0]!);
    const L = a + walk(nb[1]!);
    return postKind(a, L, o.postEvery, o.logEvery);
  };
  const res: RingResult = { fence: [], posts: [], slim: [], hedge: [], lights: [] };
  const noise = hashSeed(g.seed, 'hedge', label);
  for (const r of ring) {
    const x = grid.x(r);
    const z = grid.z(r);
    g.ring[r] = 1;
    g.surface[r] = 'ground_grass';
    if (gate !== undefined && r === gate.gate) {
      emit([x, level + 1, z], 'plant', 'fence_outdoor', 'fence_gate', { facing: gate.facing });
      if (o.arch === true) emit([x, level + 3, z], 'plant', 'hedge', 'block');
      continue;
    }
    if (o.edge === 'hedge') {
      if (gateNb.has(r)) {
        // Torpfosten: im Garten Zaunpfosten unter dem Laubbogen, sonst Stamm
        if (o.arch === true) {
          emit([x, level + 1, z], 'plant', 'fence_outdoor', 'fence');
          emit([x, level + 2, z], 'plant', 'fence_outdoor', 'fence');
          emit([x, level + 3, z], 'plant', 'hedge', 'block');
          res.fence.push([x, z]);
        } else {
          emit([x, level + 1, z], 'plant', 'fence_post', 'log', { axis: 'y' });
          emit([x, level + 2, z], 'plant', 'fence_post', 'log', { axis: 'y' });
          g.surface[r] = 'ground_dirt';
          res.posts.push([x, z]);
        }
        continue;
      }
      const h = o.tall === true || valueNoise2(noise, x, z, 3) > 0.45 ? 2 : 1;
      for (let dy = 1; dy <= h; dy++) emit([x, level + dy, z], 'plant', 'hedge', 'block');
      res.hedge.push([x, z]);
      continue;
    }
    const pt = postType(r);
    if (o.logEvery !== undefined && pt === 'minor') {
      slimPost(g, x, level, z);
      res.slim.push([x, z]);
      continue;
    }
    if (o.logEvery !== undefined && (pt === 'corner' || pt === 'major')) {
      // W5-B: Eckpfosten aus Zaun – ohne Erdfleck darunter (der gehörte zum Stammfuß)
      res.posts.push([x, z]);
      const l = stubPost(g, x, level, z, lit(r));
      if (l !== undefined) res.lights.push(l);
      continue;
    }
    if (pt !== undefined) {
      emit([x, level + 1, z], 'plant', 'fence_post', 'log', { axis: 'y' });
      emit([x, level + 2, z], 'plant', 'fence_post', 'log', { axis: 'y' });
      g.surface[r] = 'ground_dirt';
      res.posts.push([x, z]);
      if (lit(r) && emit([x, level + 3, z], 'plant', 'light_outdoor', 'lantern')) res.lights.push([x, level + 3, z]);
      continue;
    }
    emit([x, level + 1, z], 'plant', 'fence_outdoor', 'fence');
    res.fence.push([x, z]);
    if (o.postEvery === undefined && lit(r) && emit([x, level + 2, z], 'plant', 'light_outdoor', 'lantern')) res.lights.push([x, level + 2, z]);
  }
  return res;
}
