// Prüfstand des öffentlichen Renderers: baut kleine feste Szenen (Feld mit Feldfrüchten und Kreuzpflanzen; Haus ohne
// Pflanzen), rendert sie im Foto-Look in Augenhöhe und gibt die Pixel des Bildes zurück (readPixels direkt nach dem
// Rendern). Kein Zufall, keine Uhr: gleiche Eingabe → gleiche Bytes (SwiftShader).
import { CAT, buildVoxelGeometry } from '../../js/voxels.js';
import { createStage, voxelMesh, resetMesh } from '../../js/stage.js';

const P = (name, hex, shape = 'cube', glow = 0, facing = '', half = '') => [name, hex, glow, shape, facing, half];

/** Feld: Grasboden, Ackerreihen mit Weizen, Karotten, Kartoffeln, Rote Bete; dazu Gras, Farn, Blumen, Setzling, Zuckerrohr, Beerenbusch. */
function cropScene() {
  const palette = [
    P('grass_block', 0x6d9b43), P('farmland', 0x8f6a43), P('wheat', 0x996593, 'small'), P('carrots', 0x996592, 'small'),
    P('potatoes', 0x99a266, 'small'), P('beetroots', 0x997566, 'small'), P('short_grass', 0x6a9a3c, 'small'),
    P('fern', 0x5f8e3a, 'small'), P('poppy', 0xc2252a, 'small'), P('dandelion', 0xf2d93a, 'small'),
    P('oak_sapling', 0x4f7a2a, 'small'), P('sugar_cane', 0x8fb65a, 'small'), P('sweet_berry_bush', 0x3f6a36, 'small'),
    P('oak_planks', 0xa4834f),
  ];
  const blocks = [];
  const put = (x, y, z, pi, cat) => blocks.push(x, y, z, pi, cat);
  for (let x = 0; x < 14; x++) for (let z = 0; z < 14; z++) {
    const row = z >= 3 && z <= 10 && x >= 2 && x <= 11;
    put(x, 0, z, row ? 1 : 0, CAT.ground);
    if (row) put(x, 1, z, 2 + ((z - 3) >> 1), CAT.plant);
    else if ((x * 7 + z * 3) % 5 === 0) put(x, 1, z, 6 + ((x + z) % 7), CAT.plant);
  }
  // ein Pfosten als Nicht-Pflanze (Schattenwurf, Bezug)
  put(0, 1, 0, 13, CAT.exterior); put(0, 2, 0, 13, CAT.exterior);
  return { blocks, palette };
}

/** Haus ohne Pflanzen: Steinsockel, Bretterwände, Glas, Treppendach, Laterne. */
function houseScene() {
  const palette = [
    P('grass_block', 0x6d9b43), P('cobblestone', 0x7a7a7a), P('oak_planks', 0xa4834f), P('glass_pane', 0xc8dce6, 'pane'),
    P('spruce_stairs', 0x755633, 'stairs', 0, 'south', 'bottom'), P('spruce_stairs', 0x755633, 'stairs', 0, 'north', 'bottom'),
    P('lantern', 0xe8b050, 'small', 1), P('oak_door', 0xa4834f, 'door', 0, 'south'), P('oak_log', 0x6b5033),
  ];
  const blocks = [];
  const put = (x, y, z, pi, cat) => blocks.push(x, y, z, pi, cat);
  for (let x = -3; x < 12; x++) for (let z = -3; z < 11; z++) put(x, 0, z, 0, CAT.ground);
  for (let x = 1; x <= 8; x++) for (let z = 1; z <= 6; z++) {
    const edge = x === 1 || x === 8 || z === 1 || z === 6;
    if (!edge) { put(x, 1, z, 2, CAT.floor); continue; }
    put(x, 1, z, 1, CAT.wall);
    for (let y = 2; y <= 4; y++) {
      const corner = (x === 1 || x === 8) && (z === 1 || z === 6);
      const door = z === 6 && x === 4 && y <= 3;
      const win = y === 3 && !corner && (x === 2 || x === 7 || z === 3 || z === 4);
      put(x, y, z, corner ? 8 : door ? 7 : win ? 3 : 2, door || win ? CAT.opening : CAT.wall);
    }
  }
  for (let k = 0; k < 4; k++) for (let x = 0; x <= 9; x++) {
    put(x, 5 + k, k, 5, CAT.roof); put(x, 5 + k, 7 - k, 4, CAT.roof);
  }
  put(5, 2, 7, 6, CAT.exterior);
  return { blocks, palette };
}

const canvas = document.getElementById('c');
const st = createStage(canvas, { shadowSize: 1024, look: 'photo' });
st.resize();
const gl = st.renderer.getContext();
const built = new Map();

function meshFor(name, noPlants) {
  const key = `${name}|${noPlants}`;
  if (!built.has(key)) {
    const scene = name === 'crops' ? cropScene() : houseScene();
    const cats = noPlants ? new Set(Object.values(CAT).filter((c) => c !== CAT.plant)) : undefined;
    built.set(key, voxelMesh(buildVoxelGeometry(scene, { skyShade: true, ...(cats ? { cats } : {}) })));
  }
  return built.get(key);
}

/**
 * @param o { scene: 'crops'|'house', dusk: 0|1, side: 1 (von Süden) | -1 (von Norden), noPlants?: boolean }
 * @returns Uint8Array RGBA (Zeilen von unten)
 */
function renderPixels(o) {
  for (const m of built.values()) m.mesh.visible = false;
  const m = meshFor(o.scene, o.noPlants === true);
  if (!m.mesh.parent) st.scene.add(m.mesh);
  resetMesh(m);
  m.mesh.visible = true;
  st.look(0, o.dusk);
  m.u.uNight.value = st.glow;
  m.u.uGlowDay.value = 0.3;
  st.setSun(o.scene === 'crops' ? 12 : m.radius * 1.2, (o.side > 0 ? 0 : Math.PI) + 0.45, ((32 - 23 * o.dusk) * Math.PI) / 180);
  // Blickpunkt relativ zur Mesh-Mitte (Boden-Oberkante = 0): Feld mittig, Haus mittig; Auge 1,7 über dem Boden
  const [fx, fz, d] = o.scene === 'crops' ? [7 - m.center[0], 7 - m.center[2], 13] : [0, 0, 24];
  st.eye({ fov: 32, position: [fx + d * 0.35 * o.side, 1.7, fz + d * o.side], target: [fx, 1.7, fz], shiftY: o.scene === 'crops' ? -0.3 : 0.1, distance: d });
  st.land.position.y = -0.03;
  st.render();
  const px = new Uint8Array(st.w * st.h * 4);
  gl.readPixels(0, 0, st.w, st.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
window.shotHash = async (o) => hex(await crypto.subtle.digest('SHA-1', renderPixels(o)));
/** Pflanzenpixel = Pixel, die sich gegenüber derselben Szene ohne Pflanzen ändern; mittlere Luminanz (0..1, sRGB-Bytes). */
window.plantLuminance = (o) => {
  const a = renderPixels({ ...o, noPlants: false }), b = renderPixels({ ...o, noPlants: true });
  let n = 0, sum = 0, dark = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 24) continue;
    const l = (0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]) / 255;
    n++; sum += l; if (l < 0.1) dark++;
  }
  return { n, mean: n ? sum / n : 0, dark: n ? dark / n : 0 };
};
window.__ready = true;
