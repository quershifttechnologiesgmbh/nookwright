// Präsentations-Kameras (W10): Augenhöhe vor dem Eingang (3/4 wie in der Architekturfotografie), tiefe
// Schrägansicht und Draufsicht – rein und deterministisch aus der Szene (kein three.js, kein Zufall).
//
// Koordinaten: wie das Mesh aus voxels.js (Welt minus `center` = [cx, cy, cz] aus buildVoxelGeometry).
// Haupteingang wie die Goldene Galerie (packages/viewer/golden/lib/analyze.ts): Außentür = auf genau einer Seite
// freier Himmel; Wahl nach tiefster Lage, dann Süd, Ost, West, Nord, dann x, z.
const CAT_GROUND = 0, CAT_PLANT = 1, CAT_FORT = 2, CAT_FURNITURE = 8, CAT_EXTERIOR = 9;
const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const DIR_ORDER = ['south', 'east', 'west', 'north'];
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
const SOFT = /short_grass|tall_grass|fern|wheat|carrots|potatoes|beetroots|bush|sapling|sugar_cane|flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|lily|rose|peony|lilac|petals|wildflowers|leaf_litter/;
const THIN = new Set(['small', 'carpet', 'trap_open', 'lantern', 'lantern_hang']);
/** Augenhöhe über der Oberkante des Bodens (Minecraft: 1,62; „≈ 1,7 Blöcke“) */
export const EYE_HEIGHT = 1.7;
/** Hero: vertikaler Öffnungswinkel (längere Brennweite als die 70° im Spiel, weniger Verzerrung) */
export const HERO_FOV = 32;
/** Drehung der Hero-Kamera aus der Türachse (3/4-Ansicht), in Grad */
export const HERO_SWING = 38;
/** W16-A (wie Golden W13-A): Mindestgröße (Spalten) eines frei stehenden Nebenbaus (Scheune ja, Brunnen/Laube nein) */
export const NEBENBAU_COLUMNS = 60;
/** W16-A (wie Golden W13-A): Reichweite, in der ein Nebenbau vor einer Tür als „gegenüber“ zählt (Hoftür) */
const YARD_REACH = 12;
/** W16-A (wie Golden W13-A): so viele Blöcke niedriger muss das Ende des Eingangsflügels sein, damit die Augenhöhe zu ihm schwenkt */
export const LOW_END = 4;
/** Ab dieser Höhe über dem Türboden zählt eine Spalte als hoher Bau (Golden `TALL`) */
const TALL = 5;

/**
 * Anker der Szene: Haupttür, Bau-Quader und Geländehöhen (Weltkoordinaten).
 * `fortShare`: Anteil der Wehrblöcke am Bau (Burg, Mauerring-Basis) – entscheidet über die erste Ansicht (`firstView`).
 * @returns {{ door?: { pos: number[], outward: string }, box: { min: number[], max: number[] }, groundTop: (x: number, z: number) => number | undefined, fortShare: number }}
 */
export function sceneAnchors(scene) {
  const B = scene.blocks, pal = scene.palette, n = B.length / 5;
  const key = (x, z) => `${x},${z}`;
  const builtTop = new Map(); // höchster Bau-Block je Spalte (ohne Gelände/Pflanzen)
  const ground = new Map(); // höchster Geländeblock je Spalte
  // Sichtlinien: Kategorie je blockierender Zelle (ohne Kleinteile, Teppiche und Gräser/Blumen)
  const solid = new Map();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const hullTop = new Map(); // höchster Bau-Block je Spalte ohne Gartenanlagen (Umriss für die Augenhöhe, W16-A)
  const core = new Map(); // Spalten mit Bauwerk/Hülle/Dach/Öffnungen: [unterster, oberster] Block
  let built = 0, fort = 0; // Bau-Blöcke und davon Wehrblöcke (Mauerring, Türme)
  for (let i = 0; i < n; i++) {
    const x = B[i * 5], y = B[i * 5 + 1], z = B[i * 5 + 2], cat = B[i * 5 + 4];
    const p = pal[B[i * 5 + 3]];
    // dünne Formen verdecken nicht (W10-C: offene Falltür und Laternen hießen vorher 'carpet'/'small' – gleiche Sicht)
    if (!THIN.has(p[3]) && !SOFT.test(p[0])) solid.set(`${x},${y},${z}`, cat);
    if (cat === CAT_GROUND) {
      const k = key(x, z);
      if ((ground.get(k) ?? -Infinity) < y) ground.set(k, y);
      continue;
    }
    if (cat === CAT_PLANT) continue;
    const k = key(x, z);
    if ((builtTop.get(k) ?? -Infinity) < y) builtTop.set(k, y);
    // Bau-Quader: Bauwerk, Hülle und Außen-Deko (ohne Möbel/Gartenanlagen, cat 8)
    if (cat === CAT_FURNITURE) continue;
    if ((hullTop.get(k) ?? -Infinity) < y) hullTop.set(k, y);
    if (cat !== CAT_EXTERIOR) {
      const c = core.get(k);
      if (c === undefined) core.set(k, [y, y]); else { c[0] = Math.min(c[0], y); c[1] = Math.max(c[1], y); }
    }
    built++;
    if (cat === CAT_FORT) fort++;
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  }
  // Freier Himmel: Zelle leer und darüber (ab +2) kein Bau-Block – bis zu 3 Schritte nach außen
  const seesSky = (x, y, z, d, reach = 3) => {
    for (let s = 1; s <= reach; s++) {
      const cx = x + d[0] * (s - 1), cz = z + d[1] * (s - 1);
      const top = builtTop.get(key(cx, cz));
      if (top === undefined || top < y + 2) return true;
    }
    return false;
  };
  const doors = [];
  // W16-A: findet sich mit 3 Schritten keine Außentür (Laube oder Vorkragung 3 tief vor der Haustür, Taverne Seed 2), sucht
  // ein zweiter Lauf bis 5 Schritte weit – ohne Rückfall bleibt alles wie vorher
  for (const reach of [3, 5]) {
    for (let i = 0; i < n; i++) {
      const p = pal[B[i * 5 + 3]];
      if (p[3] !== 'door' || p[5] === 'upper') continue;
      const x = B[i * 5], y = B[i * 5 + 1], z = B[i * 5 + 2];
      const facing = STEP[p[4]] ? p[4] : 'north';
      const st = STEP[facing];
      const front = seesSky(x + st[0], y, z + st[1], st, reach);
      const back = seesSky(x - st[0], y, z - st[1], [-st[0], -st[1]], reach);
      if (front === back) continue;
      doors.push({ pos: [x, y, z], outward: front ? facing : OPPOSITE[facing] });
    }
    if (doors.length > 0) break;
  }
  doors.sort((a, b) => a.pos[1] - b.pos[1] || DIR_ORDER.indexOf(a.outward) - DIR_ORDER.indexOf(b.outward) || a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2]);
  // W16-A (Golden-Regel W13-A Runde 2, analyze.ts pickMainDoor): Baukörper = zusammenhängende Kern-Spalten. Eine Tür, die
  // innerhalb von YARD_REACH Blöcken auf einen großen fremden Baukörper zeigt (Hoftür zur Scheune), ist nicht die Haustür.
  const compOf = new Map(); // Spalte → Nummer des Baukörpers
  const compSize = [];
  for (const k0 of core.keys()) {
    if (compOf.has(k0)) continue;
    const id = compSize.length;
    let count = 0;
    const todo = [k0];
    compOf.set(k0, id);
    while (todo.length) {
      const [x, z] = todo.pop().split(',').map(Number);
      count++;
      for (const d of Object.values(STEP)) {
        const k = key(x + d[0], z + d[1]);
        if (core.has(k) && !compOf.has(k)) { compOf.set(k, id); todo.push(k); }
      }
    }
    compSize.push(count);
  }
  const compAt = (x, z) => compOf.get(key(x, z));
  const faces = (d) => {
    const own = compAt(d.pos[0], d.pos[2]) ?? compAt(d.pos[0] - STEP[d.outward][0], d.pos[2] - STEP[d.outward][1]);
    for (let s = 1; s <= YARD_REACH; s++) {
      const c = compAt(d.pos[0] + STEP[d.outward][0] * s, d.pos[2] + STEP[d.outward][1] * s);
      if (c !== undefined && c !== own && compSize[c] >= NEBENBAU_COLUMNS) return true;
    }
    return false;
  };
  const front = doors.findIndex((d) => !faces(d));
  if (front > 0) doors.unshift(...doors.splice(front, 1));
  // Gelände über dem Bau-Grundriss (Erdhaus: der Hügel gehört ins Bild)
  for (const [k, y] of ground) {
    const [x, z] = k.split(',').map(Number);
    if (x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2] && y > max[1]) max[1] = y;
  }
  // Rand des Geländestücks: häufigste Oberkante der Randspalten (die Foto-Bühne legt ihren Boden dorthin, damit die
  // Erdseiten des Geländestücks nicht als Sockel zu sehen sind)
  const rimCount = new Map();
  for (const [k, y] of ground) {
    const [x, z] = k.split(',').map(Number);
    if (ground.has(key(x + 1, z)) && ground.has(key(x - 1, z)) && ground.has(key(x, z + 1)) && ground.has(key(x, z - 1))) continue;
    rimCount.set(y, (rimCount.get(y) ?? 0) + 1);
  }
  let rimTop;
  for (const [y, c] of [...rimCount].sort((p, q) => p[0] - q[0])) if (rimTop === undefined || c > rimCount.get(rimTop - 1)) rimTop = y + 1;
  // Eingangsflügel (W10-B): zusammenhängende Bau-Spalten (Bauwerk, Hülle, Dach, Öffnungen) um die Haupttür – beim
  // Gehöft das Wohnhaus ohne die Scheune; die Sichtlinien zählen für ihn, eingepasst wird der ganze Bau
  let wing;
  if (doors[0]) {
    const seen = new Set([key(doors[0].pos[0], doors[0].pos[2])]);
    const todo = [[doors[0].pos[0], doors[0].pos[2]]];
    wing = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    while (todo.length) {
      const [x, z] = todo.pop();
      const c = core.get(key(x, z));
      if (c === undefined) continue;
      wing.min[0] = Math.min(wing.min[0], x); wing.max[0] = Math.max(wing.max[0], x);
      wing.min[2] = Math.min(wing.min[2], z); wing.max[2] = Math.max(wing.max[2], z);
      wing.min[1] = Math.min(wing.min[1], c[0]); wing.max[1] = Math.max(wing.max[1], c[1]);
      for (const d of Object.values(STEP)) {
        const k = key(x + d[0], z + d[1]);
        if (!seen.has(k)) { seen.add(k); todo.push([x + d[0], z + d[1]]); }
      }
    }
    if (wing.min[0] === Infinity) wing = undefined;
  }
  const groundTop = (x, z) => ground.get(key(Math.floor(x), Math.floor(z)));
  const catAt = (x, y, z) => solid.get(`${x},${y},${z}`);
  // W16-A: Umriss wie Golden (cameras.ts hullPoints): höchster Block je Spaltenecke im Bau-Quader (Bau ohne Gartenanlagen,
  // Gelände darüber zählt – Erdhaus-Hügel); die Augenhöhe passt diesen Umriss ein statt der Quaderecken
  const corner = new Map();
  const up = (x, z, y) => { const k = key(x, z); if ((corner.get(k) ?? -Infinity) < y) corner.set(k, y); };
  const colTop = (x, z) => Math.max(hullTop.get(key(x, z)) ?? -Infinity, ground.get(key(x, z)) ?? -Infinity);
  for (let x = min[0]; x <= max[0]; x++) for (let z = min[2]; z <= max[2]; z++) {
    const t = colTop(x, z);
    if (t === -Infinity) continue;
    up(x, z, t + 1); up(x + 1, z, t + 1); up(x, z + 1, t + 1); up(x + 1, z + 1, t + 1);
  }
  const hull = [...corner].map(([k, y]) => { const [x, z] = k.split(',').map(Number); return [x, y, z]; });
  // Baukörper des Eingangsflügels und große fremde Baukörper (Scheune) – für Sichtlinien und den Schwenk zum Anbau
  const wingComp = doors[0] ? (compAt(doors[0].pos[0], doors[0].pos[2]) ?? compAt(doors[0].pos[0] - STEP[doors[0].outward][0], doors[0].pos[2] - STEP[doors[0].outward][1])) : undefined;
  // Wehranlagen (erste Ansicht tief schräg) ausgenommen: dort ist der Mauerring vor dem Hof das Motiv, keine Verdeckung
  const fortShare = built ? fort / built : 0;
  const otherAt = fortShare >= FORT_SHARE_LOW ? undefined : (x, z) => { const c = compAt(x, z); return c !== undefined && c !== wingComp && compSize[c] >= NEBENBAU_COLUMNS; };
  const tops = wing ? [] : undefined;
  if (wing) for (let x = wing.min[0]; x <= wing.max[0]; x++) for (let z = wing.min[2]; z <= wing.max[2]; z++) {
    const c = core.get(key(x, z));
    if (c !== undefined && compAt(x, z) === wingComp) tops.push([x, z, c[1]]);
  }
  return { ...(doors[0] ? { door: doors[0] } : {}), box: { min, max }, groundTop, catAt, ...(wing ? { wing, wingTops: tops } : {}), doors: doors.length, fortShare, ...(rimTop !== undefined ? { rimTop } : {}), hull, ...(otherAt ? { otherAt } : {}) };
}

/** Umriss-Punkte des Baus (Quaderecken) in Mesh-Koordinaten. */
function boxPoints(box, center) {
  const out = [];
  for (const x of [box.min[0], box.max[0] + 1]) for (const y of [box.min[1], box.max[1] + 1]) for (const z of [box.min[2], box.max[2] + 1]) {
    out.push([x - center[0], y - center[1], z - center[2]]);
  }
  return out;
}

/** Größter Schwenk aus der Türachse: darüber ist der Eingang nicht mehr zu lesen (W10-B) */
export const MAX_SWING = 50;
/** Aufschlag für die Gegenseite: Ensembles zeigen den Eingangsflügel vorn, Nebengebäude (Scheune) dahinter (W10-B) */
const FLIP_PENALTY = 0.08;
/** Aufschlag für Standpunkte im Hof – zwischen Zaun/Hecke und Fassade (W10-B): lieber der ganze Bau von außen, wenn er
 * dort frei zu sehen ist; geprüft wird der Hof nur, wenn der beste Außen-Standpunkt schlechter abschneidet */
export const YARD_PENALTY = 0.04;
/** Hof-Standpunkt: größter Öffnungswinkel (kürzere Brennweite, wie ein Architektur-Weitwinkel) */
export const YARD_FOV_MAX = 56;

/**
 * Augenhöhe (W10): Kamera ≈ 1,7 Blöcke über dem Boden vor dem Eingang, waagerecht blickend (senkrechte Kanten bleiben
 * senkrecht), das Bild per Shift (wie ein Shift-Objektiv) verschoben, bis der Bau ganz im Bild ist. Unter festen
 * Kandidaten (Schwenk aus der Türachse bis 50°, Seite, Abstand) gewinnt der mit den wenigsten verdeckten Sichtlinien
 * (Hecken, Bäume, Zäune, Gelände vor dem Bau); bei Gleichstand der erste – die Reihenfolge ist fest, also deterministisch.
 * W10-B: Ist selbst der beste Standpunkt verdeckt (Gartenzaun, Torpfosten), prüft sie auch Standpunkte **im Hof**:
 * auf dem Strahl vor der Tür bis knapp vor das erste Hindernis, mit kürzerer Brennweite (bis 56°) und der Tür im
 * mittleren Bildbereich – passt der Bau dann nicht ganz ins Bild, bleibt die Tür das Motiv.
 * `swing`: bevorzugter Schwenk in Grad (0 = frontal, z. B. Erdhaus).
 * @returns {{ position: number[], yaw: number, shiftY: number, shiftX: number, fov: number, target: number[], distance: number,
 *   azimuth: number, frontAz: number, sign: number, aim: number[], swing: number, occluded: number, yard: boolean, cut: number }}
 */
export function heroCamera(anchors, center, aspect, opts = {}) {
  const swing = opts.swing ?? HERO_SWING;
  const swings = (swing === 0 ? [0, 10, 18, 28] : [swing, swing - 12, swing + 10, swing - 22, 0]).filter((s) => s >= 0 && s <= MAX_SWING);
  let best;
  const pick = (c) => { if (best === undefined || c.score < best.score - 1e-9) best = c; };
  const penalty = (sw, flip) => Math.abs(sw - swing) * 0.002 + (flip < 0 ? FLIP_PENALTY : 0);
  for (const sw of swings) {
    for (const flip of sw === 0 ? [1] : [1, -1]) {
      for (const far of [1, 1.2, 1.45, 1.8, 2.2]) {
        const c = heroCandidate(anchors, center, aspect, { ...opts, swing: sw, flip, far });
        // kleiner Aufschlag für Abweichungen vom Wunsch, damit er bei gleicher Sicht gewinnt
        c.score = c.occluded + penalty(sw, flip) + (far - 1) * 0.05;
        pick(c);
        if (best.score === 0) return best; // Wunsch-Kandidat ohne Verdeckung: fertig
      }
    }
  }
  if (!anchors.door || !anchors.catAt || best.score <= YARD_PENALTY) return best;
  // Hof: Standpunkt zwischen Hindernis und Fassade (kleiner Aufschlag: lieber der ganze Bau, wenn er frei zu sehen ist)
  for (const sw of swings) {
    for (const flip of sw === 0 ? [1] : [1, -1]) {
      const c = heroCandidate(anchors, center, aspect, { ...opts, swing: sw, flip, yard: true });
      if (c === undefined) continue;
      c.score = c.occluded + penalty(sw, flip) + YARD_PENALTY + c.cut * 0.4;
      pick(c);
    }
  }
  return best;
}

function heroCandidate(anchors, center, aspect, { swing, flip = 1, far = 1, fov = HERO_FOV, margin = 0.9, eye = EYE_HEIGHT, base = 0.78, yard = false }) {
  const { box, door } = anchors;
  // W16-A: Umriss wie Golden (Spaltenköpfe + Fußecken auf Türhöhe) statt der Quaderecken – der Quader reicht vom
  // tiefsten Fundament bis zur Turmspitze an jeder Ecke und ließ viel Himmel über dem Bau; ohne Umriss (alte Szenen) die Ecken
  // Fuß: Türboden, bei Sockel/Freitreppe tiefer die Geländeoberkante am Rand (der Sockel gehört ganz ins Bild)
  const foot = Math.min(door ? door.pos[1] : box.min[1], anchors.rimTop ?? Infinity);
  const pts = anchors.hull?.length ? [
    ...anchors.hull.map((p) => [p[0] - center[0], p[1] - center[1], p[2] - center[2]]),
    ...[box.min[0], box.max[0] + 1].flatMap((x) => [box.min[2], box.max[2] + 1].map((z) => [x - center[0], foot - center[1], z - center[2]])),
  ] : boxPoints(box, center);
  const bc = [(box.min[0] + box.max[0] + 1) / 2 - center[0], (box.min[2] + box.max[2] + 1) / 2 - center[2]];
  let out = [0, 1];
  let sign = 1;
  if (door) {
    out = STEP[door.outward];
    // zur Seite drehen, auf der die Tür liegt (Eingangsflügel vorn, Ecke und längere Fassade im Bild); flip = −1
    // prüft die Gegenseite
    const perp = [-out[1], out[0]];
    const lateral = (door.pos[0] + 0.5 - center[0] - bc[0]) * perp[0] + (door.pos[2] + 0.5 - center[2] - bc[1]) * perp[1];
    sign = lateral < -0.5 ? -1 : 1;
    const low = lowEndSide(anchors, perp);
    if (low !== 0) sign = low;
  }
  sign *= flip;
  const a = ((swing * Math.PI) / 180) * sign;
  const dir = [out[0] * Math.cos(a) - out[1] * Math.sin(a), out[0] * Math.sin(a) + out[1] * Math.cos(a)];
  const doorXZ = door ? [door.pos[0] + 0.5 - center[0], door.pos[2] + 0.5 - center[2]] : bc;
  // Blick auf den Bau: bei Tür auf die Mitte zwischen Tür und Bau-Mitte (Eingang im Bild), sonst Bau-Mitte; im Hof
  // steht die Kamera auf dem Strahl vor der Tür
  const aim = yard ? [doorXZ[0] + out[0] * 0.5, doorXZ[1] + out[1] * 0.5] : door ? [(doorXZ[0] + bc[0]) / 2, (doorXZ[1] + bc[1]) / 2] : bc;
  const doorFloor = door ? door.pos[1] - center[1] : 0; // Oberkante des Bodens vor der Tür (Mesh-y)
  const outside = anchors.rimTop === undefined ? doorFloor : anchors.rimTop - center[1];
  const fwd = [-dir[0], -dir[1]];
  const right = [-fwd[1], fwd[0]];
  const view = (dist) => {
    const px = aim[0] + dir[0] * dist, pz = aim[1] + dir[1] * dist;
    const g = anchors.groundTop(px + center[0], pz + center[2]);
    // Boden an der Kamera: Gelände (Oberkante = y + 1), außerhalb der Rand des Geländestücks; nie unter dem Türboden
    const floorY = Math.max(doorFloor, g === undefined ? outside : g + 1 - center[1]);
    const py = floorY + eye;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, behind = false;
    for (const p of pts) {
      const q = [p[0] - px, p[1] - py, p[2] - pz];
      const depth = q[0] * fwd[0] + q[2] * fwd[1];
      if (depth < 1) { behind = true; break; }
      const u = (q[0] * right[0] + q[2] * right[1]) / depth, v = q[1] / depth;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    // Tür in Bildkoordinaten (waagerecht)
    const dq = [doorXZ[0] - px, doorXZ[1] - pz];
    const du = (dq[0] * right[0] + dq[1] * right[1]) / Math.max(0.5, dq[0] * fwd[0] + dq[1] * fwd[1]);
    return { px, py, pz, u0, u1, v0, v1, du, behind };
  };
  const tanOf = (deg) => Math.tan((deg * Math.PI) / 360);
  const fits = (f, tv) => !f.behind && f.u1 - f.u0 <= 2 * tv * aspect * margin && f.v1 - f.v0 <= 2 * tv * margin;
  let dist, f, lens = fov, cut = 0;
  if (!yard) {
    const tv = tanOf(fov);
    // kleinster Abstand, bei dem der Bau ganz ins Bild passt (Bisektion, feste Schrittzahl), dann × far
    let lo = 2, hi = 8;
    while (!fits(view(hi), tv) && hi < 2000) hi *= 1.5;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (fits(view(mid), tv)) hi = mid; else lo = mid; }
    dist = hi * far;
    f = view(dist);
    // weiter weg mit längerer Brennweite (W10-B): der Bau bleibt gleich groß im Bild, nur der Standpunkt wechselt
    if (far > 1) {
      let a0 = tv / far / 1.5, a1 = tv;
      for (let k = 0; k < 30; k++) { const m = (a0 + a1) / 2; if (fits(f, m)) a1 = m; else a0 = m; }
      lens = (Math.atan(a1) * 360) / Math.PI;
    }
  } else {
    // Hof-Tiefe: erstes Hindernis (Zaun, Pfosten, Hecke, Hang) auf dem Strahl vor der Tür, vom Boden bis über Augenhöhe
    dist = yardDepth(anchors, door, dir) - 1.2;
    if (dist < 4) return undefined;
    f = view(dist);
    if (f.behind) return undefined;
    // kürzeste Brennweite, bei der der Bau ganz ins Bild passt; sonst die kürzeste erlaubte (die Tür bleibt Motiv)
    lens = YARD_FOV_MAX;
    for (let d = fov; d <= YARD_FOV_MAX; d += 2) if (fits(f, tanOf(d))) { lens = d; break; }
    const tv = tanOf(lens);
    const w = f.u1 - f.u0, h = f.v1 - f.v0;
    cut = Math.max(0, w - 2 * tv * aspect * margin) / w + Math.max(0, h - 2 * tv * margin) / h;
  }
  const tanV = tanOf(lens), tanH = tanV * aspect;
  // waagerecht mittig drehen – die Tür bleibt im mittleren Bildbereich (im Hof: mittleres Drittel, frontal: Mitte) –, senkrecht
  // verschieben (Shift statt Kippen); Fuß des Baus knapp über den unteren Rand (Vordergrund ≈ 11 %), der freie Rest geht
  // an den Himmel; passt der Bau im Hof nicht ganz ins Bild, bleibt der Fuß und das Dach wird angeschnitten
  let uc = (f.u0 + f.u1) / 2;
  const keep = tanH * (!yard ? 0.6 : swing === 0 ? 0.05 : 0.3); // frontal im Hof: Tür in der Bildmitte (Erdhaus)
  if (door) uc = Math.min(f.du + keep, Math.max(f.du - keep, uc));
  const yaw = Math.atan2(fwd[0], -fwd[1]) + Math.atan(uc);
  const fitsV = f.v1 - f.v0 <= 2 * tanV * margin;
  const vc = fitsV ? Math.max(f.v0 + tanV * base, f.v1 - tanV * margin) : f.v0 + tanV * base;
  const shiftY = vc / (2 * tanV);
  const look = [Math.sin(yaw), -Math.cos(yaw)];
  const eyePos = [f.px, f.py, f.pz];
  return {
    position: eyePos, yaw, shiftY, shiftX: 0, fov: lens, target: [f.px + look[0] * 10, f.py, f.pz + look[1] * 10], distance: dist,
    // Azimut der Kamera und der Türachse (wie stage.orbit/setSun: Richtung sin(az), cos(az) vom Motiv aus)
    azimuth: Math.atan2(dir[0], dir[1]), frontAz: Math.atan2(out[0], out[1]), sign, aim: [aim[0], doorFloor, aim[1]],
    swing, occluded: anchors.catAt ? occlusion(anchors, center, eyePos, anchors.wing ?? box, door) : 0, yard, cut,
  };
}

/**
 * W16-A (Golden W13-A Runde 2, cameras.ts lowEndSide): Seite (entlang `perp`, ±1) des Eingangsflügels, an deren Ende ein
 * deutlich niedrigerer Baukörper steht (Anbau, Werkstatt: höchster Block im äußeren Fünftel ≥ LOW_END unter dem der
 * Gegenseite), sonst 0. Die Augenhöhe schwenkt dann zu dieser Seite: Anbau vorn, Hauptbau dahinter – gestaffelte Dächer.
 */
function lowEndSide(anchors, perp) {
  if (!anchors.wingTops || !anchors.door) return 0;
  const cols = anchors.wingTops.filter((c) => c[2] >= anchors.door.pos[1] - 1 + TALL).map((c) => [c[0] * perp[0] + c[1] * perp[1], c[2]]);
  if (cols.length === 0) return 0;
  let lo = Infinity, hi = -Infinity;
  for (const c of cols) { lo = Math.min(lo, c[0]); hi = Math.max(hi, c[0]); }
  const slice = Math.max(3, Math.round((hi - lo + 1) / 5));
  const peak = (from, to) => cols.reduce((m, c) => (c[0] >= from && c[0] <= to ? Math.max(m, c[1]) : m), -Infinity);
  const minus = peak(lo, lo + slice - 1), plus = peak(hi - slice + 1, hi);
  return plus <= minus - LOW_END ? 1 : minus <= plus - LOW_END ? -1 : 0;
}

/**
 * Hof-Tiefe (W10-B): Abstand von der Tür bis zum ersten belegten Block auf dem Strahl `dir` (Weltraster) – in den Zellen
 * vom Türboden bis eine über Augenhöhe und je eine halbe Zelle links und rechts des Strahls (Platz für die Kamera).
 */
function yardDepth(anchors, door, dir) {
  const o = STEP[door.outward];
  const x0 = door.pos[0] + 0.5 + o[0] * 0.5, z0 = door.pos[2] + 0.5 + o[1] * 0.5;
  const side = [-dir[1] * 0.45, dir[0] * 0.45];
  for (let s = 1.5; s < 80; s += 0.25) {
    for (const k of [0, -1, 1]) {
      const x = Math.floor(x0 + dir[0] * s + side[0] * k), z = Math.floor(z0 + dir[1] * s + side[1] * k);
      for (let y = door.pos[1]; y <= door.pos[1] + 2; y++) if (anchors.catAt(x, y, z) !== undefined) return s;
    }
  }
  return 80;
}

/** Hindernisse näher als so viele Blöcke am Auge zählen voll, fernere anteilig (mindestens ein Fünftel) */
const NEAR = 10;

/** Kategorien, die als Teil des Baus zählen (Treffer = sichtbar): Bauwerk, Hülle, Öffnungen, Außen-Deko. */
const BUILT = new Set([2, 3, 4, 5, 6, 7, 9]);

/**
 * Anteil verdeckter Sichtlinien vom Auge zu festen Zielpunkten im Bau (Tür dreifach gewichtet). Verdeckt heißt: der
 * erste getroffene Block ist Gelände, Pflanze/Baum oder Gartenanlage (Kategorie 0/1/8) – oder das Auge steckt in einem Block.
 */
function occlusion(anchors, center, eye, box, door) {
  const w = (x, y, z) => [x - center[0], y - center[1], z - center[2]];
  const y0 = box.min[1], y1 = box.max[1] + 1, ym = y0 + Math.min(4, (y1 - y0) / 2);
  const cx = (box.min[0] + box.max[0] + 1) / 2, cz = (box.min[2] + box.max[2] + 1) / 2;
  const targets = [
    [w(cx, y0 + 1.5, cz), 1], [w(cx, ym + 2, cz), 1], [w(cx, (y0 + y1) / 2, cz), 1],
    [w(box.min[0] + 1.5, ym, box.min[2] + 1.5), 1], [w(box.max[0] - 0.5, ym, box.min[2] + 1.5), 1],
    [w(box.min[0] + 1.5, ym, box.max[2] - 0.5), 1], [w(box.max[0] - 0.5, ym, box.max[2] - 0.5), 1],
  ];
  // Raster über den ganzen Bau (Bäume und Büsche vor einem Teil der Fassade): 3 × 3 Spalten in zwei Höhen
  for (const fx of [0.15, 0.5, 0.85]) for (const fz of [0.15, 0.5, 0.85]) for (const fy of [0.25, 0.6]) {
    targets.push([w(box.min[0] + (box.max[0] + 1 - box.min[0]) * fx, y0 + (y1 - y0) * fy, box.min[2] + (box.max[2] + 1 - box.min[2]) * fz), 0.5]);
  }
  // Fuß der Fassade (Hecken, Zäune): Ecken knapp über dem Boden
  for (const [x, z] of [[box.min[0] + 1.5, box.min[2] + 1.5], [box.max[0] - 0.5, box.min[2] + 1.5], [box.min[0] + 1.5, box.max[2] - 0.5], [box.max[0] - 0.5, box.max[2] - 0.5]]) targets.push([w(x, y0 + 1.6, z), 0.5]);
  if (door) targets.push([w(door.pos[0] + 0.5, door.pos[1] + 1.2, door.pos[2] + 0.5), 3], [w(door.pos[0] + 0.5, door.pos[1] + 0.4, door.pos[2] + 0.5), 1]);
  const at = (p) => anchors.catAt(Math.floor(p[0] + center[0]), Math.floor(p[1] + center[1]), Math.floor(p[2] + center[2]));
  if (at(eye) !== undefined) return 1;
  let hidden = 0, total = 0;
  for (const [t, wt] of targets) {
    total += wt;
    const d = [t[0] - eye[0], t[1] - eye[1], t[2] - eye[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const steps = Math.ceil(len / 0.25);
    for (let k = 2; k < steps; k++) {
      const s = k / steps;
      const c = at([eye[0] + d[0] * s, eye[1] + d[1] * s, eye[2] + d[2] * s]);
      if (c === undefined) continue;
      // nahe Hindernisse füllen das Bild (Zaun vor der Linse), ferne verdecken nur einen schmalen Streifen (W10-B)
      // W16-A (Golden W13-A): ein großer, frei stehender Nebenbau (Scheune) vor dem Eingangsflügel verdeckt ihn
      const px = Math.floor(eye[0] + d[0] * s + center[0]), pz = Math.floor(eye[2] + d[2] * s + center[2]);
      if (!BUILT.has(c) || anchors.otherAt?.(px, pz)) hidden += wt * Math.min(1, Math.max(0.2, NEAR / (s * len)));
      break;
    }
  }
  return hidden / total;
}

/** Wehranlage: ab diesem Anteil Wehrblöcke (Mauerring, Türme) ist die tiefe Schrägansicht das erste Bild (W10-B) */
export const FORT_SHARE_LOW = 0.4;
/** Tiefe Schrägansicht: 14° von oben (wie die Golden-Ansicht `tief`), 36°-Objektiv */
export const LOW_PITCH = 14;
export const LOW_FOV = 36;

/**
 * Erste Ansicht (W10-B, gleiche Regel wie `packages/viewer/golden/lib/cameras.ts`): Wehranlagen (Burg, Basis mit
 * Mauerring) zeigen zuerst die tiefe Schrägansicht – in Augenhöhe ist die breite Anlage klein im Bild –, alle anderen
 * die Augenhöhe vor dem Eingang.
 * @returns {'auge' | 'tief'}
 */
export function firstView(anchors) {
  return (anchors.fortShare ?? 0) >= FORT_SHARE_LOW ? 'tief' : 'auge';
}

/**
 * Tiefe Schrägansicht (W10-B): aus der Richtung der Augenhöhe (3/4 von der Eingangsseite), 14° von oben, eng um den
 * Bau-Quader und mittig ins Bild gesetzt (wenige feste Runden, deterministisch). Gleiche Felder wie `heroCamera`, damit
 * `stage.eye` und `sunFor` sie nehmen (`target` liegt tiefer als das Auge: geneigter Blick, kein Shift).
 */
export function lowCamera(anchors, center, aspect, hero, { pitch = LOW_PITCH, fov = LOW_FOV, margin = 1.1 } = {}) {
  const pts = boxPoints(anchors.box, center);
  const az = hero.azimuth, el = (pitch * Math.PI) / 180;
  const back = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  const right = [Math.cos(az), 0, -Math.sin(az)];
  const up = [-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el)];
  const dot = (q, a) => q[0] * a[0] + q[1] * a[1] + q[2] * a[2];
  const tanV = Math.tan((fov * Math.PI) / 360), tanH = tanV * aspect;
  let t = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) t[k] += p[k] / pts.length;
  const distanceFor = (c) => {
    let d = 0;
    for (const p of pts) {
      const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      const z = dot(q, back);
      d = Math.max(d, z + Math.abs(dot(q, right)) / tanH, z + Math.abs(dot(q, up)) / tanV);
    }
    return d * margin;
  };
  for (let it = 0; it < 6; it++) {
    const d = distanceFor(t);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const q = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
      const w = Math.max(1e-3, d - dot(q, back));
      const u = dot(q, right) / w, v = dot(q, up) / w;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    t = [t[0] + (right[0] * uc + up[0] * vc) * d, t[1] + (right[1] * uc + up[1] * vc) * d, t[2] + (right[2] * uc + up[2] * vc) * d];
  }
  const distance = distanceFor(t);
  return {
    position: [t[0] + back[0] * distance, t[1] + back[1] * distance, t[2] + back[2] * distance], target: t, fov, shiftY: 0, shiftX: 0,
    distance, azimuth: az, frontAz: hero.frontAz, sign: hero.sign, pitch,
  };
}

/** Seitenwinkel der Sonne zur Eingangsfassade (Grad). W13-D: 25 → 38, mehr Streiflicht (Relief, Schatten unter Traufen) */
export const SUN_SIDE = 38;

/**
 * Sonne für eine Präsentationskamera: von der Gegenseite des Schwenks, damit die Eingangsfassade Licht bekommt und
 * die Seitenfassade im Streiflicht/Schatten liegt (3/4-Kontrast). Höhe 35° am Tag, 9° am Abend.
 */
export function sunFor(cam, dusk = 0) {
  return { az: cam.frontAz + cam.sign * (SUN_SIDE * Math.PI) / 180, el: ((32 - 23 * dusk) * Math.PI) / 180 };
}

