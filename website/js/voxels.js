// Baut aus einer Szene (scripts/dump-scenes.ts) ein animierbares three.js-Mesh.
// Jeder Block trägt Mittelpunkt, Kategorie, Erscheinzeit, Leuchten und Blocklicht als Vertex-Attribute;
// der Shader (voxelMaterial) blendet Kategorien ein (Fall + Skalierung), hebt sie an (Dach abheben) und schneidet
// entlang einer Ebene (Theme-Wischer).
import * as THREE from 'three';
import { buildAtlas, PLANT } from './textures.js';

export const CAT = { ground: 0, plant: 1, fort: 2, floor: 3, wall: 4, ceiling: 5, roof: 6, opening: 7, furniture: 8, exterior: 9 };
export const NCAT = 10;

const FACES = [
  // Normale, vier Ecken (Einheitswürfel 0..1)
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

function hash(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const srgb = new THREE.Color();
function rgb(c) {
  srgb.setHex(c, THREE.SRGBColorSpace);
  return [srgb.r, srgb.g, srgb.b];
}

/** W13-D (opts.vary): Farbfaktor je Block – Helligkeit 0,94–1,06, Rot/Blau gegenläufig ± 3 % (warm/kalt) */
function varyOf(x, y, z) {
  const k = 0.94 + hash(x, y * 7, z) * 0.12, w = (hash(z * 3 + 11, y, x * 5) - 0.5) * 0.06;
  return [k * (1 + w), k, k * (1 - w)];
}

/**
 * @param scene  JSON der Szene
 * @param opts   { cats?: Set<number> nur diese Kategorien, groundRadius?: Gelände auf Radius beschneiden,
 *                 skyShade?: Himmelslicht-Verdeckung je Fläche (W10, Foto-Look: unter Traufen, in Nischen und Lauben
 *                 dunkler; rein aus der Belegung, deterministisch; ohne die Option bitgleich zu vorher),
 *                 trueAlbedo?: Kachelhelligkeit = Palettenfarbe und Gras wie Golden (W10-D, Foto-Look; textures.js);
 *                 Standard = skyShade, damit alle Foto-Nutzer (Galerie, Spot) zum Boden-bis-Horizont von stage.js passen,
 *                 vary?: Farbvarianz je Block (W13-D, Galerie): Helligkeit ± 6 % und ein leichter Warm/Kalt-Stich je Block
 *                 statt ± 3 % grau – wie die Texturvarianz in Shader-Screenshots; deterministisch aus der Blocklage;
 *                 dazu lesbarere Dachziegel (textures.js `readable`); ohne die Option bitgleich }
 */
export function buildVoxelGeometry(scene, opts = {}) {
  const B = scene.blocks;
  const pal = scene.palette;
  const n = B.length / 5;
  // Schwerpunkt über Nicht-Gelände
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  let gMinY = Infinity;
  for (let i = 0; i < n; i++) {
    const x = B[i * 5], y = B[i * 5 + 1], z = B[i * 5 + 2], cat = B[i * 5 + 4];
    if (cat === CAT.ground || cat === CAT.plant) { gMinY = Math.min(gMinY, y); continue; }
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX + 1) / 2, cz = (minZ + maxZ + 1) / 2, cy = minY;
  const radius = Math.hypot(maxX - minX + 1, maxZ - minZ + 1, (maxY - minY + 1) * 0.9) / 2;

  // Belegung für Culling, Verbindungen und Licht
  // W14: Zahl statt Text als Schlüssel (Lage ±4096 je Achse; Ergebnis gleich, ~3× schneller auf der Startseite)
  const key = (x, y, z) => ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096);
  const occ = new Map();
  for (let i = 0; i < n; i++) occ.set(key(B[i * 5], B[i * 5 + 1], B[i * 5 + 2]), i);
  const shapeAt = (x, y, z) => { const i = occ.get(key(x, y, z)); return i === undefined ? undefined : pal[B[i * 5 + 3]][3]; };
  const isGlass = (pi) => /glass|leaves|ice/.test(pal[pi][0]);
  // W14: je Palettenfarbe einmal (vorher je Abfrage ein Regex – der größte Posten beim Aufbau der Startseite)
  const opaquePal = pal.map((p, pi) => p[3] === 'cube' && !isGlass(pi));
  const opaqueAt = (x, y, z) => {
    const i = occ.get(key(x, y, z));
    return i !== undefined && opaquePal[B[i * 5 + 3]];
  };
  const solidish = (x, y, z) => { const s = shapeAt(x, y, z); return s === 'cube' || s === 'pane' || s === 'post' || s === 'stairs'; };

  // Blocklicht (BFS, Stufe 15 an Lichtquellen, −1 je Schritt durch nicht-opake Zellen) für die Nachtszene
  const light = new Map();
  const queue = [];
  for (let i = 0; i < n; i++) {
    const p = pal[B[i * 5 + 3]];
    if (p[2]) { const k = key(B[i * 5], B[i * 5 + 1], B[i * 5 + 2]); light.set(k, 15); queue.push([B[i * 5], B[i * 5 + 1], B[i * 5 + 2], 15]); }
  }
  for (let q = 0; q < queue.length; q++) {
    const [x, y, z, l] = queue[q];
    if (l <= 1) continue;
    for (const f of FACES) {
      const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
      if (opaqueAt(nx, ny, nz)) continue;
      const k = key(nx, ny, nz);
      if ((light.get(k) ?? 0) >= l - 1) continue;
      light.set(k, l - 1);
      queue.push([nx, ny, nz, l - 1]);
    }
  }
  const lightAt = (x, y, z) => (light.get(key(x, y, z)) ?? 0) / 15;

  // Himmelslicht (opts.skyShade, Foto-Look): Minecraft-Himmelslicht je Luftzelle wie im Golden-Renderer
  // (packages/viewer, presentation.ts): 15 in Zellen mit freiem Himmel darüber, −1 je Schritt durch nicht-opake Zellen.
  // W10-D: Es dunkelt nur das Umgebungslicht ab (0,18 + 0,82·s²), nicht die Sonne – wie Golden. Vorher schätzte eine
  // Spaltenzählung (5 × 5) die Verdeckung und dunkelte Sonne und Himmel gemeinsam um bis zu 58 % ab: Wände vor dem
  // eigenen Bau lagen so pauschal ≈ 25 % unter Golden. Deterministisch, rein aus der Belegung.
  let skyAt = null;
  if (opts.skyShade) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, B[i * 5]); x1 = Math.max(x1, B[i * 5]); y0 = Math.min(y0, B[i * 5 + 1]); y1 = Math.max(y1, B[i * 5 + 1]);
      z0 = Math.min(z0, B[i * 5 + 2]); z1 = Math.max(z1, B[i * 5 + 2]);
    }
    x0--; x1++; y0--; y1++; z0--; z1++;
    const nx = x1 - x0 + 1, ny = y1 - y0 + 1, nz = z1 - z0 + 1;
    const lvl = new Uint8Array(nx * ny * nz);
    const solid = new Uint8Array(nx * ny * nz);
    const at = (x, y, z) => ((y - y0) * nz + (z - z0)) * nx + (x - x0);
    // nur Vollwürfel sperren (Treppen/Stufen mitzuzählen machte Wände unter Traufen 25–40 % dunkler als Golden)
    for (let i = 0; i < n; i++) if (opaqueAt(B[i * 5], B[i * 5 + 1], B[i * 5 + 2])) solid[at(B[i * 5], B[i * 5 + 1], B[i * 5 + 2])] = 1;
    const q = [];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      for (let y = y1; y >= y0; y--) { const k = at(x, y, z); if (solid[k]) break; lvl[k] = 15; q.push(k); }
    }
    const N6 = [1, -1, nx, -nx, nx * nz, -nx * nz];
    for (let h = 0; h < q.length; h++) {
      const k = q[h], l = lvl[k];
      if (l <= 1) continue;
      const x = k % nx, zz = Math.floor(k / nx) % nz, yy = Math.floor(k / (nx * nz));
      for (let d = 0; d < 6; d++) {
        if ((d === 0 && x === nx - 1) || (d === 1 && x === 0) || (d === 2 && zz === nz - 1) || (d === 3 && zz === 0) || (d === 4 && yy === ny - 1) || (d === 5 && yy === 0)) continue;
        const j = k + N6[d];
        if (solid[j] || lvl[j] >= l - 1) continue;
        lvl[j] = l - 1;
        q.push(j);
      }
    }
    skyAt = (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1 ? 1 : lvl[at(x, y, z)] / 15);
  }
  const shade = [];

  // Foto (skyShade): Außenseiten des Geländestücks unterhalb seines Randes weglassen. Die Bühne legt dort den Boden bis
  // zum Horizont hin (stage.js, Höhe = Randoberkante wie camera-rig.js `rimTop`); die Erdseiten des Stücks wären sonst
  // am Rand als gerade dunkle Naht zu sehen (W10-D). Hügel über dem Rand behalten ihre Seiten.
  let skirt = null;
  if (opts.skyShade) {
    const colKey = (x, z) => `${x},${z}`;
    const gcol = new Map();
    for (let i = 0; i < n; i++) {
      if (B[i * 5 + 4] !== CAT.ground) continue;
      const x = B[i * 5], z = B[i * 5 + 2];
      if (opts.groundRadius !== undefined && Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > opts.groundRadius) continue;
      const k = colKey(x, z);
      if ((gcol.get(k) ?? -Infinity) < B[i * 5 + 1]) gcol.set(k, B[i * 5 + 1]);
    }
    const rimCount = new Map();
    for (const [k, y] of gcol) {
      const [x, z] = k.split(',').map(Number);
      if (gcol.has(colKey(x + 1, z)) && gcol.has(colKey(x - 1, z)) && gcol.has(colKey(x, z + 1)) && gcol.has(colKey(x, z - 1))) continue;
      rimCount.set(y, (rimCount.get(y) ?? 0) + 1);
    }
    let rimTop;
    for (const [y, c] of [...rimCount].sort((p, q) => p[0] - q[0])) if (rimTop === undefined || c > rimCount.get(rimTop - 1)) rimTop = y + 1;
    if (rimTop !== undefined) skirt = (bx, by, bz, f) => f.n[1] === 0 && by < rimTop && !gcol.has(colKey(bx + f.n[0], bz + f.n[2]));
  }

  // Erscheinzeit je Kategorie: nach Höhe (Bau wächst), Gelände radial, Möbel zufällig
  const tRaw = new Float32Array(n);
  const catMin = new Array(NCAT).fill(Infinity), catMax = new Array(NCAT).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const x = B[i * 5], y = B[i * 5 + 1], z = B[i * 5 + 2], cat = B[i * 5 + 4];
    const r = hash(x, y, z);
    let t;
    if (cat === CAT.ground) t = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) + r * 3;
    else if (cat === CAT.plant) t = Math.hypot(x - cx, z - cz) * 0.5 + y * 0.6 + r * 4;
    else if (cat === CAT.furniture || cat === CAT.exterior) t = r * 10 + y * 0.8;
    else if (cat === CAT.fort) t = y * 2 + Math.atan2(z - cz, x - cx) * 1.2 + r * 1.5;
    else t = y + r * 0.9;
    tRaw[i] = t;
    catMin[cat] = Math.min(catMin[cat], t); catMax[cat] = Math.max(catMax[cat], t);
  }

  // Eigene Pixeltexturen (textures.js); opts.flat = true rendert wie früher nur Flächenfarben
  const textured = opts.flat !== true && typeof document !== 'undefined';
  const atlas = textured ? buildAtlas([...new Map(pal.map((p) => [p[0], p[1]])).entries()], { trueAlbedo: opts.trueAlbedo ?? opts.skyShade === true, readable: opts.vary === true }) : null;
  const pos = [], nor = [], col = [], ctr = [], info = [], idx = [], uvs = [];
  let v = 0;
  const AO = [0.5, 0.68, 0.84, 1];
  // Ecken-Verschattung wie im Spiel: pro Ecke die drei Nachbarn in der Ebene vor der Fläche
  const aoAt = (bx, by, bz, f, c4) => {
    const ax = [0, 1, 2].filter((k) => f.n[k] === 0);
    const s1 = [0, 0, 0], s2 = [0, 0, 0];
    s1[ax[0]] = c4[ax[0]] ? 1 : -1; s2[ax[1]] = c4[ax[1]] ? 1 : -1;
    const px = bx + f.n[0], py = by + f.n[1], pz = bz + f.n[2];
    const a = opaqueAt(px + s1[0], py + s1[1], pz + s1[2]) ? 1 : 0;
    const b = opaqueAt(px + s2[0], py + s2[1], pz + s2[2]) ? 1 : 0;
    const c = opaqueAt(px + s1[0] + s2[0], py + s1[1] + s2[1], pz + s1[2] + s2[2]) ? 1 : 0;
    return AO[a && b ? 0 : 3 - (a + b + c)];
  };
  // Gekreuzte Pflanzen-Sprites (zwei diagonale Flächen, beidseitig, mit Loch-Textur)
  const pushCross = (bx, by, bz, h, c, cat, t, name, hex) => {
    const tile = atlas.tile(name, hex, 'side');
    const cxb = bx + 0.5 - cx, cyb = by + 0.5 - cy, czb = bz + 0.5 - cz;
    const l = lightAt(bx, by, bz);
    const jit = 0.95 + hash(bx, by, bz) * 0.1;
    const jv = opts.vary ? varyOf(bx, by, bz) : [jit, jit, jit];
    const sky = skyAt ? skyAt(bx, by, bz) : 1;
    for (const [ax, az, bx2, bz2] of [[0.15, 0.15, 0.85, 0.85], [0.15, 0.85, 0.85, 0.15]]) {
      const quad = [[ax, 0, az, 0, 1], [bx2, 0, bz2, 1, 1], [bx2, h, bz2, 1, 1 - h], [ax, h, az, 0, 1 - h]];
      for (const [qx, qy, qz, tu, tv] of quad) {
        pos.push(bx + qx - cx, by + qy - cy, bz + qz - cz);
        nor.push(0, 1, 0);
        col.push(jv[0], jv[1], jv[2]);
        if (skyAt) shade.push(1, sky);
        ctr.push(cxb, cyb, czb);
        // Leuchten-Feld + 2 markiert Kreuz-Sprites (Shader: Licht von oben, beidseitig gleich)
        info.push(cat, t, 2, l);
        uvs.push(tile[0] + tu * (tile[2] - tile[0]), tile[1] + tv * (tile[3] - tile[1]));
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  };
  const pushBox = (bx, by, bz, x0, y0, z0, x1, y1, z1, c, cat, t, glow, i, cull, name, hex) => {
    const cxb = bx + 0.5 - cx, cyb = by + 0.5 - cy, czb = bz + 0.5 - cz;
    for (let fi = 0; fi < 6; fi++) {
      const f = FACES[fi];
      if (cull && opaqueAt(bx + f.n[0], by + f.n[1], bz + f.n[2])) continue;
      if (skirt && cat === CAT.ground && skirt(bx, by, bz, f)) continue;
      // Licht der Luftzelle vor der Fläche (bei Nicht-Würfeln: eigene Zelle)
      const l = cull ? lightAt(bx + f.n[0], by + f.n[1], bz + f.n[2]) : Math.max(lightAt(bx, by, bz), glow ? 1 : 0);
      // leichte Farbvariation je Block (lebendiger als Flächenfarbe)
      const jit = textured ? 0.97 + hash(bx, by * 7, bz) * 0.06 : 0.94 + hash(bx, by * 7, bz) * 0.12;
      const jv = opts.vary ? varyOf(bx, by, bz) : null;
      const tile = atlas ? atlas.tile(name, hex, f.n[1] > 0 ? 'top' : f.n[1] < 0 ? 'bottom' : 'side') : null;
      for (const c4 of f.v) {
        const lx = x0 + c4[0] * (x1 - x0), ly = y0 + c4[1] * (y1 - y0), lz = z0 + c4[2] * (z1 - z0);
        pos.push(bx + lx - cx, by + ly - cy, bz + lz - cz);
        nor.push(f.n[0], f.n[1], f.n[2]);
        const ao = cull ? aoAt(bx, by, bz, f, c4) : 1;
        // Foto (skyShade): Ecken-Verschattung und Himmelslicht wirken im Shader getrennt auf Sonne und Umgebung (aShade)
        const k = skyAt ? jit : jit * ao;
        if (skyAt) shade.push(ao, skyAt(bx + f.n[0], by + f.n[1], bz + f.n[2]));
        if (jv) { const a = skyAt ? 1 : ao, b = textured ? [1, 1, 1] : c; col.push(b[0] * jv[0] * a, b[1] * jv[1] * a, b[2] * jv[2] * a); }
        else if (textured) col.push(k, k, k); else col.push(c[0] * k, c[1] * k, c[2] * k);
        if (tile) {
          // Kachel-Koordinaten aus der Lage im Block (Platten zeigen die halbe Textur, wie im Spiel)
          let tu, tv;
          if (f.n[1] !== 0) { tu = lx; tv = lz; }
          else if (f.n[0] !== 0) { tu = f.n[0] > 0 ? 1 - lz : lz; tv = 1 - ly; }
          else { tu = f.n[2] > 0 ? lx : 1 - lx; tv = 1 - ly; }
          uvs.push(tile[0] + tu * (tile[2] - tile[0]), tile[1] + tv * (tile[3] - tile[1]));
        } else uvs.push(0, 0);
        ctr.push(cxb, cyb, czb);
        info.push(cat, t, glow, l);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  };

  for (let i = 0; i < n; i++) {
    const x = B[i * 5], y = B[i * 5 + 1], z = B[i * 5 + 2], pi = B[i * 5 + 3], cat = B[i * 5 + 4];
    if (opts.cats && !opts.cats.has(cat)) continue;
    if (opts.groundRadius !== undefined && (cat === CAT.ground || cat === CAT.plant)) {
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > opts.groundRadius) continue;
    }
    const [name, hex, glowF, shape, facing, half] = pal[pi];
    const c = rgb(hex);
    const glow = glowF ? 1 : 0;
    const t = catMax[cat] > catMin[cat] ? Math.min(1, Math.max(0.0005, (tRaw[i] - catMin[cat]) / (catMax[cat] - catMin[cat]))) : 0.0005;
    const box = (x0, y0, z0, x1, y1, z1, cull = false) => pushBox(x, y, z, x0, y0, z0, x1, y1, z1, c, cat, t, glow, i, cull, name, hex);
    if (atlas && PLANT.test(name)) { pushCross(x, y, z, /wheat|grass|fern|cane|bush/.test(name) ? 0.95 : 0.8, c, cat, t, name, hex); continue; }
    if (/petals|wildflowers|leaf_litter/.test(name)) { box(0, 0, 0, 1, 0.06, 1); continue; }
    // Lagerfeuer (W10-C): flach wie im Spiel (7/16), als Schornsteinkappe zwischen offenen Falltüren
    if (/campfire/.test(name)) { box(0, 0, 0, 1, 0.4375, 1); continue; }
    // Laterne wie im Spiel: Körper 6×7×6, Deckel 4×2×4 (Pixel); hängend 1 Pixel höher mit Kette bis zur Decke
    const lantern = (hang) => {
      const o = hang ? 0.0625 : 0;
      box(0.3125, o, 0.3125, 0.6875, 0.4375 + o, 0.6875);
      box(0.375, 0.4375 + o, 0.375, 0.625, 0.5625 + o, 0.625);
      if (hang) box(0.4688, 0.5625 + o, 0.4688, 0.5312, 1, 0.5312);
    };
    switch (shape) {
      case 'cube': box(0, 0, 0, 1, 1, 1, true); break;
      case 'slab_b': box(0, 0, 0, 1, 0.5, 1); break;
      case 'slab_t': box(0, 0.5, 0, 1, 1, 1); break;
      case 'carpet': box(0, 0, 0, 1, 0.07, 1); break;
      case 'stairs': {
        const top = half === 'top';
        box(0, top ? 0.5 : 0, 0, 1, top ? 1 : 0.5, 1);
        const d = DIRS[facing] ?? [0, -1];
        const x0 = d[0] === 1 ? 0.5 : 0, x1 = d[0] === -1 ? 0.5 : 1, z0 = d[1] === 1 ? 0.5 : 0, z1 = d[1] === -1 ? 0.5 : 1;
        box(x0, top ? 0 : 0.5, z0, x1, top ? 0.5 : 1, z1);
        break;
      }
      case 'door': case 'trap_open': {
        // Tür und offene Falltür: senkrechte Platte an der Seite gegenüber „facing“ (Falltür 3/16 dick)
        const d = DIRS[facing] ?? [0, -1];
        const w = shape === 'door' ? 0.19 : 0.1875;
        if (d[0] !== 0) box(d[0] === 1 ? 0 : 1 - w, 0, 0, d[0] === 1 ? w : 1, 1, 1);
        else box(0, 0, d[1] === 1 ? 0 : 1 - w, 1, 1, d[1] === 1 ? w : 1);
        break;
      }
      case 'lantern': lantern(false); break;
      case 'lantern_hang': lantern(true); break;
      case 'pane': {
        const ex = solidish(x - 1, y, z) || solidish(x + 1, y, z);
        const ez = solidish(x, y, z - 1) || solidish(x, y, z + 1);
        if (ex || !ez) box(0, 0, 0.44, 1, 1, 0.56);
        if (ez && !ex) box(0.44, 0, 0, 0.56, 1, 1);
        break;
      }
      case 'post': {
        const wall = /_wall$/.test(name);
        const w = wall ? 0.25 : 0.375;
        box(w, 0, w, 1 - w, 1, 1 - w);
        const arm = wall ? [0.31, 0.69, 0, 0.8] : [0.44, 0.56, 0.35, 0.85];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!solidish(x + dx, y, z + dz)) continue;
          if (dx !== 0) box(dx === 1 ? 1 - w : 0, arm[2], arm[0], dx === 1 ? 1 : w, arm[3], arm[1]);
          else box(arm[0], arm[2], dz === 1 ? 1 - w : 0, arm[1], arm[3], dz === 1 ? 1 : w);
        }
        break;
      }
      case 'small': {
        if (/torch/.test(name)) box(0.43, 0, 0.43, 0.57, 0.65, 0.57);
        else if (/lantern/.test(name)) lantern(false);
        else if (/ladder|sign|banner/.test(name)) {
          const d = DIRS[facing] ?? [0, -1];
          if (d[0] !== 0) box(d[0] === 1 ? 0 : 0.88, 0, 0.05, d[0] === 1 ? 0.12 : 1, 1, 0.95);
          else box(0.05, 0, d[1] === 1 ? 0 : 0.88, 0.95, 1, d[1] === 1 ? 0.12 : 1);
        } else if (/wheat|carrots|potatoes|beetroots|grass|fern|cane/.test(name)) box(0.15, 0, 0.15, 0.85, 0.75, 0.85);
        else box(0.3, 0, 0.3, 0.7, 0.45, 0.7);
        break;
      }
      default: box(0, 0, 0, 1, 1, 1, true);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(ctr, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (skyAt) g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 2));
  g.setIndex(v > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return { geometry: g, texture: atlas?.texture ?? null, shade: !!skyAt, radius, height: maxY - minY + 1, size: [maxX - minX + 1, maxZ - minZ + 1], center: [cx, cy, cz] };
}

// Gemeinsamer Shader-Einschub für Farb- und Tiefenmaterial
function patch(shader, u, withColor) {
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec3 aCenter; attribute vec4 aInfo; attribute vec2 aShade; varying vec2 vShade;
      uniform float uP[${NCAT}]; uniform float uLift[${NCAT}]; uniform float uDrop; uniform float uSpread;
      uniform float uYaw; uniform float uLayerY; uniform float uInvert;
      varying vec3 vWorld; varying float vGlow; varying float vLight; varying float vHide; varying float vCross;
      float easeOutBack(float x){ float c1=1.70158; float c3=c1+1.0; float y=x-1.0; return 1.0+c3*y*y*y+c1*y*y; }`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      int cat = int(aInfo.x + 0.5);
      float p = uP[cat];
      float local = clamp((p * (1.0 + uSpread) - aInfo.y) / uSpread, 0.0, 1.0);
      // Schicht-Modus (Nachbau wie mit einem Hologramm): Hausblöcke erscheinen Lage für Lage bis uLayerY
      if (uLayerY < 9999.0 && cat >= 3) local = clamp((uLayerY - aCenter.y) * 1.5, 0.0, 1.0);
      float s = local <= 0.0 ? 0.0 : easeOutBack(local);
      float fall = (1.0 - smoothstep(0.0, 1.0, local)) * uDrop;
      vHide = local <= 0.0 ? 1.0 : 0.0;
      // Umgekehrt (Hologramm): nur die Blöcke zeigen, die noch NICHT stehen
      if (uInvert > 0.5) { vHide = local > 0.0 ? 1.0 : 0.0; s = 1.0; fall = 0.0; }
      transformed = aCenter + (transformed - aCenter) * max(s, 0.0) + vec3(0.0, fall + uLift[cat], 0.0);
      vGlow = mod(aInfo.z, 2.0); vCross = step(1.5, aInfo.z); vLight = aInfo.w; vShade = aShade;`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  if (!shader.vertexShader.includes('vWorld = (modelMatrix')) {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  }
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform vec4 uClip; uniform float uNight; uniform vec3 uWarm; uniform float uGlowDay; uniform float uShade;
      varying vec2 vShade; varying vec3 vWorld; varying float vGlow; varying float vLight; varying float vHide; varying float vCross;`)
    .replace('void main() {', `void main() {
      if (vHide > 0.5) discard;
      if (dot(vec4(vWorld, 1.0), uClip) < 0.0) discard;`);
  if (withColor === 'ghost') {
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      // Hologramm: kühles Blau, Kanten heller (wie eine Schematic-Vorschau im Spiel)
      float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
      gl_FragColor = vec4(vec3(0.32, 0.78, 1.0) * (0.55 + lum * 0.9), 0.38);`);
    return;
  }
  if (withColor) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      // Kreuz-Sprites (Feldfrüchte, Gras, Blumen), W10-C: beide Seiten gleich beleuchten. Ohne das dreht DoubleSide die
      // Normale der Rückseite nach unten (nur Bodenlicht, keine Sonne) – die Pflanzen standen von einer Seite schwarz da.
      // Normale halb zwischen oben und Sonne (wie Laub in Shader-Packs: Halme fangen auch tiefe Abendsonne)
      if (vCross > 0.5) {
        normal = normalize(vNormal);
        #if NUM_DIR_LIGHTS > 0
        normal = normalize(normal + directionalLights[0].direction);
        #endif
      }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      // Foto (W10-D, wie Golden presentation.ts): Sonne × mix(0,35; 1; AO), Umgebung × AO × (0,18 + 0,82 · Himmelslicht²)
      if (uShade > 0.5) {
        reflectedLight.directDiffuse *= mix(0.35, 1.0, vShade.x);
        reflectedLight.indirectDiffuse *= vShade.x * (0.18 + 0.82 * vShade.y * vShade.y);
      }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      // Leuchtende Blöcke glühen (Bloom), Blocklicht wärmt die Nachtszene
      float bl = pow(vLight, 1.6);
      totalEmissiveRadiance += diffuseColor.rgb * uWarm * bl * uNight * 1.35;
      // W10-C: nur helle Texel leuchten (Glas der Laterne, Flamme) – Rahmen und Holz bleiben dunkel
      float lit = smoothstep(0.12, 0.45, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
      totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * vGlow * lit * (uGlowDay + uNight * 1.8);`);
  }
}

/** Material + Tiefenmaterial mit gemeinsamen Uniforms. */
export function voxelMaterial(ghost = false, texture = null) {
  const u = {
    uP: { value: new Array(NCAT).fill(1) },
    uLift: { value: new Array(NCAT).fill(0) },
    uDrop: { value: 6 },
    uSpread: { value: 0.18 },
    uYaw: { value: 0 },
    uClip: { value: new THREE.Vector4(0, 0, 0, 1) },
    uNight: { value: 0 },
    uWarm: { value: new THREE.Color(1.0, 0.62, 0.3) },
    // Leuchten der Lichtquellen am Tag (W10 Foto-Look: 0,3 – Laternen glühen erst am Abend; Standard wie vorher)
    uGlowDay: { value: 1.2 },
    uLayerY: { value: 1e5 },
    uInvert: { value: 0 },
    // W10-D: 1 = Geometrie mit aShade (skyShade, Foto-Look): AO und Himmelslicht getrennt für Sonne und Umgebung
    uShade: { value: 0 },
  };
  const tex = texture ? { map: texture, alphaTest: 0.5, side: THREE.DoubleSide } : {};
  const mat = ghost
    ? new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, ...(texture ? { map: texture } : {}) })
    : new THREE.MeshLambertMaterial({ vertexColors: true, ...tex });
  mat.onBeforeCompile = (s) => patch(s, u, ghost ? 'ghost' : true);
  mat.customProgramCacheKey = () => (ghost ? 'voxel-ghost' : 'voxel');
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, ...(texture && !ghost ? { map: texture, alphaTest: 0.5 } : {}) });
  depth.onBeforeCompile = (s) => patch(s, u, false);
  return { mat, depth, u };
}

export function makeVoxelMesh(scene, opts) {
  const built = buildVoxelGeometry(scene, opts);
  const ghost = opts?.ghost === true;
  const { mat, depth, u } = voxelMaterial(ghost, built.texture);
  u.uShade.value = built.shade ? 1 : 0;
  const mesh = new THREE.Mesh(built.geometry, mat);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = !ghost;
  mesh.receiveShadow = !ghost;
  if (ghost) { u.uInvert.value = 1; mesh.renderOrder = 5; }
  mesh.frustumCulled = false;
  return { mesh, u, ...built, scene };
}
