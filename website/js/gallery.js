// Galerie: Karten aller generierten Bauten (#galerie) und Detailansicht mit 3D-Viewer und Downloads (#bau-<id>).
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAT, buildVoxelGeometry } from './voxels.js';
import { createStage, deg, loadScene, reduceMotion, resetMesh, seg, setP, voxelMesh } from './stage.js';
import { firstView, heroCamera, lowCamera, sceneAnchors, sunFor } from './camera-rig.js';
import { hintHtml, placeHint } from './place-hints.js';
import { saveFile, toast } from './site.js';

const FORMATS = [
  ['litematic', 'Litematica'],
  ['schem', 'WorldEdit'],
  ['nbt', 'Strukturblock'],
];
// ?thumb: Standbild ohne Aufbau-Animation und ohne Drehung (scripts/thumbs.mjs); ?cam=auge|schraeg|oben|alt und
// ?mood=tag|abend|nacht wählen Kamera und Stimmung (Vorher/Nachher-Bilder; „alt“ = Kamera und Bühne vor W10)
const params = new URLSearchParams(location.search);
const still = params.has('thumb');
const legacy = params.get('cam') === 'alt';
/** Stimmungen: Name, night, dusk, Beschriftung des Knopfs (nächste Stimmung) */
const MOODS = [['tag', 0, 0, 'Abend'], ['abend', 0, 1, 'Nacht'], ['nacht', 1, 0, 'Tag']];
let indexPromise;
const index = () => (indexPromise ??= fetch('gallery/index.json').then((r) => r.json()));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

/** Exportdatei laden (liegt als Binärdatei neben der Szene, siehe scripts/build-gallery.ts). */
async function exportBytes(id, fmt) {
  const res = await fetch(`gallery/files/${id}.${fmt}`);
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`${id}.${fmt}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------------------------- Raster

let filter = 'Alle';
export async function showGrid() {
  const items = await index();
  const grid = document.getElementById('galleryGrid');
  const bar = document.getElementById('galleryFilters');
  const kinds = ['Alle', 'Bautyp', 'Base', 'Haus'];
  const labels = { Alle: 'Alle', Bautyp: 'Bautypen', Base: 'Basen', Haus: 'Häuser' };
  bar.innerHTML = kinds.map((k) => `<button type="button" id="filter-${k}" data-kind="${k}" aria-pressed="${k === filter}">${labels[k]}</button>`).join('');
  bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.kind; showGrid(); }));
  grid.innerHTML = items.filter((it) => filter === 'Alle' || it.kind === filter).map((it) => `
    <a class="card" href="#bau-${esc(it.id)}">
      <div class="thumb"><img src="gallery/thumbs/${esc(it.id)}.jpg" alt="${esc(it.title)} im Stil ${esc(it.themeName)}" loading="lazy" onerror="this.remove()"></div>
      <div class="body">
        <div class="chips"><span class="chip theme">${esc(it.themeName)}</span><span class="chip kind">${esc(it.kind)}</span><span class="chip">${it.roomCount} ${it.roomCount === 1 ? 'Raum' : 'Räume'}</span></div>
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.blurb)}</p>
      </div>
    </a>`).join('');
}

// ---------------------------------------------------------------------------------------------- Detail

let viewer;
async function getViewer() {
  if (viewer) return viewer;
  const canvas = document.getElementById('detailCanvas');
  // W10: Foto-Bühne (Tageslicht, weiche Schatten, Dunst, Farbabstimmung) und Augenhöhe als erste Ansicht
  // W13-D: Qualität 'auto' (fällt auf schwacher Hardware zurück); Vorschaubilder immer 'high'; ?quality=high|medium|low
  const quality = still ? 'high' : ['high', 'medium', 'low'].includes(params.get('quality')) ? params.get('quality') : 'auto';
  const st = createStage(canvas, { shadowSize: 2048, look: legacy ? 'studio' : 'photo', quality });
  const controls = new OrbitControls(st.camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = 10 * deg;
  controls.maxPolarAngle = (legacy ? 82 : 88) * deg;
  controls.autoRotate = legacy && !reduceMotion && !still;
  controls.autoRotateSpeed = 0.5;
  const mood0 = Math.max(0, MOODS.findIndex((m) => m[0] === params.get('mood')));
  const state = {
    mesh: null, roof: 1, roofT: 1, night: MOODS[mood0][1], nightT: MOODS[mood0][1], dusk: MOODS[mood0][2], duskT: MOODS[mood0][2],
    mood: mood0, build: 1, visible: true, cam: 'auge', size: '',
  };
  // Augenhöhe und Schrägansicht sind Standbilder (W10-B: eingepasst aus camera-rig.js); beim ersten Ziehen/Scrollen
  // wird daraus eine freie Kamera um den Bau
  const framed = () => state.cam === 'auge' || (state.cam === 'schraeg' && !legacy);
  const release = () => {
    if (!framed() || !state.mesh) return;
    state.cam = 'frei';
    st.camera.clearViewOffset();
    st.camera.updateProjectionMatrix();
    controls.target.set(state.mesh.aimX, state.mesh.aimY, state.mesh.aimZ);
    const d = st.camera.position.distanceTo(controls.target);
    controls.minDistance = d * 0.25;
    controls.maxDistance = d * 1.8;
    controls.enabled = true;
    controls.update();
    markCam();
  };
  canvas.addEventListener('pointerdown', release, { capture: true });
  canvas.addEventListener('wheel', release, { capture: true, passive: true });
  const box = document.getElementById('detailViewer');
  new IntersectionObserver(([e]) => { state.visible = e.isIntersecting; }).observe(box);
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    // rAF-Zeitstempel kann im ersten Frame vor performance.now() liegen: dt nie negativ (sonst schießt die Glättung über)
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (!state.visible || !state.mesh || document.querySelector('[data-page="bau"]').hidden) return;
    st.frame(dt * 1000);
    st.resize();
    const k = 1 - Math.exp(-dt * 5);
    state.roof += (state.roofT - state.roof) * k;
    state.night += (state.nightT - state.night) * k;
    state.dusk += (state.duskT - state.dusk) * k;
    state.build = Math.min(1, state.build + dt / 3);
    const m = state.mesh;
    resetMesh(m);
    m.mesh.visible = true;
    st.look(state.night, legacy ? 0 : state.dusk);
    m.u.uNight.value = legacy ? state.night : st.glow;
    if (!legacy) m.u.uGlowDay.value = 0.3;
    if (!legacy) {
      const sun = sunFor(m.hero, state.dusk);
      st.setSun(m.sunRadius, sun.az, sun.el);
    }
    if (framed()) {
      // Bildformat geändert → Augenhöhe und Schrägansicht neu einpassen
      const size = `${st.w}x${st.h}`;
      if (size !== state.size) { state.size = size; frame(m, st.w / st.h); }
      st.eye(state.cam === 'auge' ? m.hero : m.low);
    } else st.camera.clearViewOffset();
    m.u.uDrop.value = 7;
    const b = state.build;
    setP(m, CAT.ground, seg(b, 0, 0.25)); setP(m, CAT.plant, seg(b, 0.15, 0.45)); setP(m, CAT.fort, seg(b, 0.2, 0.55));
    setP(m, CAT.floor, seg(b, 0.3, 0.45)); setP(m, CAT.wall, seg(b, 0.35, 0.6)); setP(m, CAT.opening, seg(b, 0.5, 0.65));
    setP(m, CAT.furniture, seg(b, 0.5, 0.7)); setP(m, CAT.exterior, seg(b, 0.8, 1));
    setP(m, CAT.ceiling, Math.min(seg(b, 0.6, 0.8), state.roof)); setP(m, CAT.roof, Math.min(seg(b, 0.65, 0.95), state.roof));
    if (!framed()) controls.update();
    st.render();
  };
  requestAnimationFrame(loop);
  const roofBtn = document.getElementById('detailRoof'), nightBtn = document.getElementById('detailNight');
  roofBtn.addEventListener('click', () => { state.roofT = state.roofT ? 0 : 1; roofBtn.setAttribute('aria-pressed', String(!state.roofT)); });
  const markMood = () => {
    nightBtn.textContent = MOODS[state.mood][3];
    nightBtn.setAttribute('aria-pressed', String(state.mood !== 0));
  };
  nightBtn.addEventListener('click', () => {
    if (legacy) { state.nightT = state.nightT ? 0 : 1; nightBtn.setAttribute('aria-pressed', String(!!state.nightT)); return; }
    state.mood = (state.mood + 1) % MOODS.length;
    state.nightT = MOODS[state.mood][1];
    state.duskT = MOODS[state.mood][2];
    markMood();
  });
  if (legacy) nightBtn.textContent = 'Nacht';
  else markMood();
  document.getElementById('detailBuild').addEventListener('click', () => { state.build = 0; });
  const cams = document.getElementById('detailCams');
  if (legacy) cams.hidden = true;
  const markCam = () => cams.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === state.cam)));
  cams.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { if (state.mesh) setCam(viewer, b.dataset.cam); }));
  viewer = { st, controls, state, markCam };
  return viewer;
}

/** Präsentationskameras einpassen (W10-B): Augenhöhe (mit Hof-Standpunkt) und tiefe Schrägansicht aus derselben Richtung. */
function frame(m, aspect) {
  m.hero = heroCamera(m.anchors, m.center, aspect, m.heroOpts);
  m.low = lowCamera(m.anchors, m.center, aspect, m.hero);
  // W13-D: Wiesenflecken ab dem Geländerand, Wolkenversatz je Bau (W16-A: ohne Baumreihe)
  viewer?.st.setBackdrop(Math.max(40, 1.9 * Math.max(m.hero.distance, m.low.distance, m.r)), viewer.st.land.position.y, m.r * 0.9, m.seed ?? 0);
}

/**
 * Kamera setzen (W10): „auge“ = Augenhöhe vor dem Eingang (Standbild mit Shift), „schraeg“ = tiefe 3/4-Ansicht (14°,
 * W10-B: eingepasstes Standbild wie die Golden-Ansicht `tief`), „oben“ = Draufsicht, „alt“ = Schrägansicht von vor W10
 * (−35°, 32°). Die Orbit-Ansichten bleiben frei drehbar; die Standbilder werden es beim ersten Ziehen.
 */
function setCam(v, cam) {
  const { st, controls, state } = v;
  const m = state.mesh;
  state.cam = cam;
  v.markCam();
  if (cam === 'auge' || (cam === 'schraeg' && !legacy)) {
    controls.enabled = false;
    state.size = '';
    return;
  }
  controls.enabled = true;
  st.camera.fov = 28;
  st.camera.aspect = st.w / st.h;
  const target = [m.aimX, m.aimY, m.aimZ];
  const az = cam === 'alt' ? -35 * deg : m.hero.azimuth;
  const el = cam === 'schraeg' ? 14 * deg : cam === 'oben' ? 89.5 * deg : 32 * deg;
  controls.minPolarAngle = cam === 'oben' ? 0 : 10 * deg;
  controls.maxPolarAngle = (legacy ? 82 : 88) * deg;
  controls.target.set(target[0], target[1], target[2]);
  st.orbit(target, az, el, m.r * (cam === 'schraeg' ? 0.8 : 0.9), 1);
  st.camera.clearViewOffset();
  const d = st.camera.position.distanceTo(controls.target);
  controls.minDistance = d * 0.3;
  controls.maxDistance = d * 1.8;
  controls.update();
}

let showing = '';
export async function showDetail(id) {
  const items = await index();
  const i = items.findIndex((it) => it.id === id);
  const it = items[i];
  const side = document.getElementById('detailSide');
  if (!it) { side.innerHTML = '<a class="back" href="#galerie">← Zur Galerie</a><h1>Nicht gefunden</h1><p class="blurb">Diesen Bau gibt es nicht (mehr).</p>'; return; }
  const prev = items[(i - 1 + items.length) % items.length], next = items[(i + 1) % items.length];
  side.innerHTML = `
    <a class="back" href="#galerie">← Zur Galerie</a>
    <div class="chips" style="display:flex;gap:6px;flex-wrap:wrap"><span class="chip theme">${esc(it.themeName)}</span><span class="chip kind">${esc(it.kind)}</span></div>
    <h1>${esc(it.title)}</h1>
    <p class="blurb">${esc(it.blurb)}</p>
    <dl class="facts-table">
      <dt>Etagen</dt><dd>${it.floors}</dd>
      <dt>Räume</dt><dd>${it.roomCount}</dd>
      <dt>Grundfläche</dt><dd>${it.footprint[0]} × ${it.footprint[1]} Blöcke</dd>
      <dt>Höhe</dt><dd>${it.height} Blöcke</dd>
      <dt>Blöcke</dt><dd>${it.blocks.toLocaleString('de-DE')}</dd>
      <dt>Seed</dt><dd>${it.seed}${it.size ? ` · Größe ${it.size}` : ''}</dd>
      <dt>Version</dt><dd>Java ${esc(it.version)}</dd>
    </dl>
    <div class="rooms">${it.rooms.map((r) => `<span class="chip">${esc(r)}</span>`).join('')}</div>
    <div class="downloads">
      <div class="row">${FORMATS.map(([f, tool]) => `<button type="button" class="dl" id="dl-${f}" data-fmt="${f}">.${f}<small>${tool} · ${kb(it.files[f])}</small></button>`).join('')}</div>
      <dl class="place-hints">${FORMATS.map(([f, tool]) => `<dt>.${f} · ${tool}</dt><dd>${hintHtml(placeHint(f, it.id, it.version))}.</dd>`).join('')}</dl>
      <p class="dl-note">.litematic und .schem tragen den Hinweis „NOT AN OFFICIAL MINECRAFT PRODUCT …“ in der Datei. Das .nbt-Format hat dafür kein Feld; die Datei bleibt dort unverändert, damit sie sicher im Spiel lädt.</p>
    </div>
    <a class="btn ghost" href="#editor">Eigenen Bau im Editor starten</a>
    <div class="pager"><a class="back" href="#bau-${esc(prev.id)}">← ${esc(prev.title)}</a><a class="back" href="#bau-${esc(next.id)}">${esc(next.title)} →</a></div>`;
  side.querySelectorAll('.dl').forEach((b) => b.addEventListener('click', async () => {
    const fmt = b.dataset.fmt;
    try {
      saveFile(`${it.id}.${fmt}`, await exportBytes(it.id, fmt));
    } catch { toast('Die Datei konnte nicht geladen werden.'); }
  }));
  if (showing === id) return;
  showing = id;
  const loading = document.getElementById('detailLoading');
  loading.hidden = false;
  let v;
  try { v = await getViewer(); } catch { loading.textContent = 'WebGL ist in diesem Browser nicht verfügbar.'; return; }
  const scene = await loadScene(`gallery/${id}.json`);
  if (showing !== id) return;
  if (v.state.mesh) {
    v.st.scene.remove(v.state.mesh.mesh);
    v.state.mesh.geometry.dispose();
    v.state.mesh.texture?.dispose();
    v.state.mesh.mesh.material.dispose();
  }
  const m = voxelMesh(buildVoxelGeometry(scene, { skyShade: !legacy, vary: !legacy }));
  v.st.scene.add(m.mesh);
  v.state.mesh = m;
  v.state.build = still || reduceMotion ? 1 : 0;
  // Kamera einpassen
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox;
  const cy = (bb.min.y + bb.max.y) / 2;
  m.r = Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) / 2;
  m.sunRadius = m.r * 1.2;
  v.st.setSun(m.sunRadius);
  v.st.framing = { x: 0, y: 0 };
  v.st.resize();
  // Präsentationsanker: Haupteingang und Bau-Quader; Erdhaus frontal (Front im Hügel), sonst 3/4
  m.anchors = sceneAnchors(scene);
  m.heroOpts = it.type === 'hobbit' ? { swing: 0 } : {};
  m.seed = [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261); // Wolken je Bau (W13-D)
  // Foto-Boden auf die Oberkante am Rand des Geländestücks (ohne Gelände: unter dem Bau)
  if (!legacy) v.st.land.position.y = (m.anchors.rimTop ?? m.center[1]) - m.center[1] - 0.03;
  frame(m, v.st.w / v.st.h);
  const bc = m.anchors.box;
  m.aimX = legacy ? 0 : (bc.min[0] + bc.max[0] + 1) / 2 - m.center[0];
  m.aimZ = legacy ? 0 : (bc.min[2] + bc.max[2] + 1) / 2 - m.center[2];
  m.aimY = legacy ? cy : Math.min(cy, (bc.max[1] + 1 - m.center[1]) * 0.4);
  v.state.size = '';
  const want = params.get('cam');
  // erste Ansicht (W10-B): Wehranlagen (Burg, Mauerring) tief schräg, sonst Augenhöhe
  const first = firstView(m.anchors) === 'tief' ? 'schraeg' : 'auge';
  setCam(v, legacy ? 'alt' : ['auge', 'schraeg', 'oben'].includes(want) ? want : first);
  loading.hidden = true;
}
