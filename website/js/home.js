// Startseite: 3D-Scroll-Story und Playground (aus der Landingpage übernommen).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAT, buildVoxelGeometry } from './voxels.js';
import {
  ROOM_COLORS, THEMES, clamp01, createStage, deg, ease, easeOut, easeOutBack, lerp, reduceMotion, resetMesh, seg, setAll, setP, voxelMesh,
} from './stage.js';

// ---------- Daten ----------
const SCENE_IDS = [...THEMES.map((t) => t[0]), 'base_medieval', 'homestead_rustic'];
const sceneData = Promise.all(SCENE_IDS.map((id) => fetch(`scenes/${id}.json`).then((r) => { if (!r.ok) throw new Error(id); return r.json(); })))
  .then((list) => Object.fromEntries(list.map((d) => [d.id, d])));
let geos = null;
/** Einmal gebaut, auch wenn Story und Playground gleichzeitig fragen (der Aufbau gibt zwischendurch ab). */
const geometries = () => (geos ??= buildGeometries());
async function buildGeometries() {
  const d = await sceneData;
  // W14: je Szene eine eigene Aufgabe (dazwischen darf der Browser zeichnen, scrollen, klicken) statt ~1,5 s am Stück
  const yieldTask = () => new Promise((ok) => setTimeout(ok, 0));
  const g = {};
  for (const id of SCENE_IDS) {
    g[id] = buildVoxelGeometry(d[id]);
    await yieldTask();
  }
  g.homeGhost = buildVoxelGeometry(d.homestead_rustic, { cats: new Set([CAT.floor, CAT.wall, CAT.ceiling, CAT.roof, CAT.opening, CAT.furniture, CAT.exterior]) });
  g.rooms = d.house_medieval.rooms;
  return g;
}

// =====================================================================
// Scroll-Story
// =====================================================================
async function story() {
  const canvas = document.getElementById('storyCanvas');
  const stageEl = document.getElementById('stage');
  const chapters = [...document.querySelectorAll('.chapter')];
  const rail = [...document.querySelectorAll('#rail i')];
  const railEl = document.getElementById('rail');
  const labelsEl = document.getElementById('stageLabels');
  const themeEl = document.getElementById('stageTheme');
  const dipEl = document.getElementById('stageDip');
  let st;
  try { st = createStage(canvas); } catch { stageEl.classList.add('no-gl'); return; }
  const G = await geometries();
  const M = {};
  for (const id of SCENE_IDS) M[id] = voxelMesh(G[id]);
  M.homeGhost = voxelMesh(G.homeGhost, true);
  for (const k of Object.keys(M)) st.scene.add(M[k].mesh);

  // Räume als bemalbare Flächen
  await document.fonts.ready;
  const [hcx, , hcz] = M.house_medieval.center;
  const rooms = G.rooms.map((r, i) => {
    const xs = r.cells.filter((_, k) => k % 2 === 0), zs = r.cells.filter((_, k) => k % 2 === 1);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, z0 = Math.min(...zs), z1 = Math.max(...zs) + 1;
    const color = ROOM_COLORS[r.type] ?? '#9aa7ff';
    const cvs = document.createElement('canvas');
    const px = 48;
    cvs.width = (x1 - x0) * px; cvs.height = (z1 - z0) * px;
    const g = cvs.getContext('2d');
    g.fillStyle = color; g.globalAlpha = 0.85; g.fillRect(0, 0, cvs.width, cvs.height);
    g.globalAlpha = 1; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 6; g.strokeRect(3, 3, cvs.width - 6, cvs.height - 6);
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
    for (let x = px; x < cvs.width; x += px) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cvs.height); g.stroke(); }
    for (let z = px; z < cvs.height; z += px) { g.beginPath(); g.moveTo(0, z); g.lineTo(cvs.width, z); g.stroke(); }
    const label = r.name.split(' / ')[0];
    let fs = 64;
    g.font = `800 ${fs}px Unbounded, sans-serif`;
    while (fs > 18 && g.measureText(label).width > cvs.width * 0.84) { fs -= 2; g.font = `800 ${fs}px Unbounded, sans-serif`; }
    g.fillStyle = '#10131f'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, cvs.width / 2, cvs.height / 2);
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    st.scene.add(mesh);
    return { ...r, mesh, x0: x0 - hcx, x1: x1 - hcx, z0: z0 - hcz, z1: z1 - hcz, cx: (x0 + x1) / 2 - hcx, cz: (z0 + z1) / 2 - hcz, color };
  });
  const grid = new THREE.GridHelper(64, 64, 0x6f7bb5, 0x39406a);
  grid.material.transparent = true;
  grid.position.set(0.5 - (hcx % 1), 0.03, 0.5 - (hcz % 1));
  st.scene.add(grid);
  const wipeLine = new THREE.Mesh(new THREE.BoxGeometry(0.25, 40, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 0.95, 0.5), toneMapped: false }));
  st.scene.add(wipeLine);

  const mobile = () => st.w < 760;
  const frame = (heroish) => {
    // Mobil: im Hero liegt die Base unter Text und Beschreibungsfeld (Lesbarkeit), danach wie gehabt
    st.framing = mobile() ? { x: 0, y: heroish ? 0.36 : -0.13 } : { x: 0.19, y: 0.02 };
  };

  // ---- Zustände je Kapitel: fn(u, t) mit u = Fortschritt im Kapitel, t = Zeit (für leichte Eigenbewegung)
  const H = M.house_medieval;
  const sway = (t, a = 3) => (reduceMotion ? 0 : Math.sin(t * 0.25) * a * deg);
  const STATES = [
    // 0 Hero: fertige Base in der Dämmerung, langsamer Umlauf
    (u, t) => {
      const m = M.base_medieval;
      frame(true);
      m.mesh.visible = true;
      st.floorDisc.visible = true; st.shadowCatcher.visible = false;
      st.look(0.42, 1); m.u.uNight.value = 0.42;
      st.setSun(m.radius * 1.6, 250 * deg, 22 * deg);
      const az = 58 * deg + (reduceMotion ? 0 : t * 0.05);
      st.orbit([2, 3, 6], az, lerp(30, 36, u) * deg, m.radius * 1.55, mobile() ? 1.25 : 1.45);
    },
    // 1 Die Idee: Räume malen (Draufsicht)
    (u, t) => {
      frame(false);
      H.mesh.visible = true; setAll(H, 0);
      grid.visible = true; grid.material.opacity = 0.9;
      st.shadowCatcher.visible = false;
      st.orbit([0, 0, 0], sway(t, 2), 89.5 * deg, H.radius * (mobile() ? 1.0 : 0.8), 1);
      const g0 = rooms.filter((r) => r.floor === 0);
      g0.forEach((r, i) => {
        const p = ease(seg(u, 0.08 + i * 0.2, 0.28 + i * 0.2));
        if (p <= 0) return;
        r.mesh.visible = true; r.mesh.material.opacity = 1;
        const sx = Math.max(0.001, p), sz = Math.max(0.001, clamp01(p * 1.6));
        r.mesh.scale.set(sx, sz, 1);
        r.mesh.position.set(r.x0 + (r.x1 - r.x0) * sx / 2, 0.06 + i * 0.001, r.z0 + (r.z1 - r.z0) * sz / 2);
      });
    },
    // 2 Es baut
    (u, t) => {
      frame(false);
      H.mesh.visible = true;
      st.shadowCatcher.visible = true;
      const k = ease(seg(u, 0, 0.45));
      st.orbit([0, lerp(0, 4, k), 0], lerp(sway(t, 2), -38 * deg, k), lerp(89.5 * deg, 34 * deg, k), H.radius * lerp(mobile() ? 1.0 : 0.8, 1, k), 1.02);
      st.setSun(H.radius);
      grid.visible = u < 0.45; grid.material.opacity = 0.9 * (1 - seg(u, 0.1, 0.4));
      for (const r of rooms) if (r.floor === 0) {
        r.mesh.visible = u < 0.35; r.mesh.material.opacity = 1 - seg(u, 0.1, 0.3);
        r.mesh.scale.set(1, 1, 1); r.mesh.position.set(r.cx, 0.06, r.cz);
      }
      setAll(H, 0); H.u.uDrop.value = 7;
      setP(H, CAT.floor, seg(u, 0.05, 0.25));
      setP(H, CAT.wall, seg(u, 0.15, 0.5));
      setP(H, CAT.opening, seg(u, 0.3, 0.55));
      setP(H, CAT.furniture, seg(u, 0.35, 0.72));
      setP(H, CAT.ceiling, seg(u, 0.66, 0.8));
      setP(H, CAT.roof, seg(u, 0.72, 0.9));
      setP(H, CAT.exterior, seg(u, 0.82, 0.95));
    },
    // 3 Jeder Raum: Dach löst sich, Obergeschoss mit Etiketten
    (u, t) => {
      frame(false);
      H.mesh.visible = true;
      st.setSun(H.radius);
      const off = seg(u, 0.05, 0.35);
      H.u.uDrop.value = 9;
      setP(H, CAT.roof, 1 - off); setP(H, CAT.ceiling, 1 - off);
      st.orbit([0, 4, 0], lerp(-38, -95, ease(u)) * deg + sway(t, 1.5), lerp(34, 56, ease(seg(u, 0, 0.5))) * deg, H.radius * 0.95, mobile() ? 1.0 : 0.92);
      const lo = easeOut(seg(u, 0.3, 0.45));
      labelsEl.style.opacity = String(lo);
      labelsEl.innerHTML = lo <= 0 ? '' : rooms.filter((r) => r.floor === 1).map((r, i) => {
        const [x, y] = st.toScreen(r.cx, 5.2, r.cz);
        const d = easeOutBack(seg(u, 0.3 + i * 0.06, 0.45 + i * 0.06));
        return `<span class="tag" style="left:${x}px;top:${y}px;transform:translate(-50%,-100%) scale(${d});--c:${r.color}"><i></i>${r.name}</span>`;
      }).join('');
    },
    // 4 Viele Welten: Licht-Wischer durch die Stile
    (u, t) => {
      frame(false);
      const order = THEMES.map((x) => M[x[0]]);
      const r = order[0].radius;
      st.setSun(r);
      const az = lerp(-95, -200, u) * deg;
      st.orbit([0, 4, 0], az, lerp(56, 30, ease(seg(u, 0, 0.25))) * deg, r, 1.08);
      const cuts = [0.2, 0.45, 0.7];
      let idx = 0;
      for (let i = 0; i < cuts.length; i++) if (u >= cuts[i] + 0.12) idx = i + 1;
      const cur = order[idx];
      cur.mesh.visible = true;
      if (idx === 0) { const back = seg(u, 0, 0.15); cur.u.uDrop.value = 9; setP(cur, CAT.roof, back); setP(cur, CAT.ceiling, back); }
      for (let i = 0; i < cuts.length; i++) {
        const w = seg(u, cuts[i], cuts[i] + 0.12);
        if (w > 0 && w < 1) {
          const A = order[i], B = order[i + 1];
          const dir = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
          const pos = lerp(-r * 1.1, r * 1.1, ease(w));
          A.mesh.visible = true; B.mesh.visible = true;
          A.u.uClip.value.set(dir.x, 0, dir.z, -pos);
          B.u.uClip.value.set(-dir.x, 0, -dir.z, pos);
          wipeLine.visible = true;
          wipeLine.position.set(dir.x * pos, 6, dir.z * pos);
          wipeLine.rotation.y = Math.atan2(-dir.z, dir.x);
          wipeLine.scale.set(1, 0.6, r * 0.06);
        }
      }
      const shown = cuts.reduce((n, c) => (u >= c + 0.06 ? n + 1 : n), 0);
      themeEl.style.opacity = String(easeOut(seg(u, 0.03, 0.15)));
      themeEl.innerHTML = THEMES.map((x, i) => `<span class="${i === shown ? 'on' : ''}">${x[1]}</span>`).join('');
    },
    // 5 Deine Base: alles wächst
    (u, t) => {
      frame(false);
      const m = M.base_medieval;
      m.mesh.visible = true;
      st.floorDisc.visible = true; st.shadowCatcher.visible = false;
      st.setSun(m.radius * 1.6);
      setAll(m, 0); m.u.uDrop.value = 10;
      setP(m, CAT.ground, ease(seg(u, 0.0, 0.3)));
      setP(m, CAT.plant, seg(u, 0.2, 0.55));
      setP(m, CAT.fort, seg(u, 0.25, 0.6));
      setP(m, CAT.floor, seg(u, 0.4, 0.55));
      setP(m, CAT.wall, seg(u, 0.45, 0.62));
      setP(m, CAT.opening, seg(u, 0.52, 0.66));
      setP(m, CAT.furniture, seg(u, 0.52, 0.66));
      setP(m, CAT.ceiling, seg(u, 0.58, 0.7));
      setP(m, CAT.roof, seg(u, 0.6, 0.78));
      setP(m, CAT.exterior, seg(u, 0.68, 0.85));
      st.orbit([0, 2, 4], lerp(20, 70, ease(u)) * deg + sway(t, 1.5), lerp(52, 36, ease(u)) * deg, m.radius * 1.55, lerp(1.0, 1.25, ease(u)));
    },
    // 6 Die erste Nacht
    (u, t) => {
      frame(false);
      const m = M.base_medieval;
      m.mesh.visible = true;
      st.floorDisc.visible = true; st.shadowCatcher.visible = false;
      st.setSun(m.radius * 1.6, 200 * deg, 40 * deg);
      const n = ease(seg(u, 0.0, 0.4));
      st.look(n); m.u.uNight.value = n;
      st.orbit([0, 2, 4], lerp(70, 100, ease(u)) * deg, lerp(36, 26, ease(u)) * deg, m.radius * 1.55, lerp(1.25, 2.2, ease(u)));
    },
    // 7 In deiner Welt: Hologramm → Lage für Lage echte Blöcke
    (u, t) => {
      frame(false);
      const m = M.homestead_rustic, g = M.homeGhost;
      m.mesh.visible = true;
      st.floorDisc.visible = true; st.shadowCatcher.visible = false;
      st.setSun(m.radius * 1.8, 215 * deg, 46 * deg);
      const top = m.height + 1;
      const holo = seg(u, 0.1, 0.25);
      const build = ease(seg(u, 0.3, 0.85));
      const layer = holo <= 0 ? -1 : lerp(-0.5, top, build);
      m.u.uLayerY.value = layer; g.u.uLayerY.value = layer;
      m.u.uDrop.value = 0.6;
      g.mesh.visible = holo > 0;
      g.u.uClip.value.set(0, -1, 0, lerp(-0.5, top + 2, easeOut(holo)));
      st.orbit([0, 3, 0], lerp(-30, 25, ease(u)) * deg + sway(t, 1.5), lerp(40, 32, ease(u)) * deg, m.radius * 1.35, mobile() ? 0.7 : lerp(0.62, 0.74, ease(u)));
    },
  ];
  // Szenenwechsel mit kurzem Abblenden (wo das Motiv wechselt)
  const DIPS = new Set([1, 5, 7]);

  let target = 0, cur = 0, last = performance.now(), visible = true, ready = false;
  const measure = () => {
    const vh = innerHeight, probe = vh * 0.55;
    let s = 0;
    chapters.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      if (r.top <= probe) s = i + clamp01((probe - r.top) / Math.max(1, r.height));
    });
    target = Math.min(s, STATES.length - 0.001);
  };
  addEventListener('scroll', measure, { passive: true });
  addEventListener('resize', measure);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '200px' }).observe(stageEl.parentElement);
  measure();
  cur = target;

  const loop = (now) => {
    requestAnimationFrame(loop);
    // rAF-Zeitstempel kann im ersten Frame vor performance.now() liegen: dt nie negativ (sonst schießt die Glättung über)
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (!visible) return;
    cur = reduceMotion ? target : cur + (target - cur) * (1 - Math.exp(-dt * 7));
    st.resize();
    const i = Math.max(0, Math.min(STATES.length - 1, Math.floor(cur)));
    const u = cur - i;
    for (const k of Object.keys(M)) resetMesh(M[k]);
    for (const r of rooms) r.mesh.visible = false;
    grid.visible = false; wipeLine.visible = false;
    st.floorDisc.visible = true; st.shadowCatcher.visible = true;
    st.look(0);
    labelsEl.style.opacity = '0'; themeEl.style.opacity = '0';
    STATES[i](u, now / 1000);
    // Abblenden an Motivwechseln
    let dip = 0;
    if (DIPS.has(i)) dip = Math.max(dip, 1 - seg(u, 0, 0.06));
    if (DIPS.has(i + 1)) dip = Math.max(dip, seg(u, 0.94, 1));
    dipEl.style.opacity = String(dip * 0.85);
    rail.forEach((el, k) => { el.classList.toggle('on', k <= i); el.classList.toggle('now', k === i); });
    // Mobil liegt im Hero das Beschreibungsfeld unten – dort keine Kapitel-Leiste darüber
    railEl.classList.toggle('off', mobile() && i === 0);
    st.render();
    if (!ready) { ready = true; stageEl.classList.add('live'); }
  };
  requestAnimationFrame(loop);
}

// =====================================================================
// Playground: selbst drehen, Stil wechseln, Dach ab, Nacht
// =====================================================================
async function playground() {
  const canvas = document.getElementById('playCanvas');
  const box = document.getElementById('play');
  let st;
  try { st = createStage(canvas, { shadowSize: 1024 }); } catch { box.classList.add('no-gl'); return; }
  const G = await geometries();
  const houses = THEMES.map(([id]) => voxelMesh(G[id]));
  for (const h of houses) st.scene.add(h.mesh);
  const r = houses[0].radius;
  st.setSun(r);
  const controls = new OrbitControls(st.camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = 15 * deg;
  controls.maxPolarAngle = 80 * deg;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.6;
  controls.target.set(0, 4, 0);
  st.resize();
  st.orbit([0, 4, 0], -40 * deg, 32 * deg, r, 1.05);
  const d0 = st.camera.position.distanceTo(controls.target);
  controls.minDistance = d0 * 0.55;
  controls.maxDistance = d0 * 1.6;
  controls.update();
  // nach jedem Drag bleibt die Ansicht zentriert (keine Verschiebung wie in der Story)
  const state = { theme: 0, from: 0, wipe: 1, roof: 1, roofT: 1, night: 0, nightT: 0, build: 1 };
  const buttons = [...box.querySelectorAll('[data-theme]')];
  const roofBtn = box.querySelector('#toggleRoof'), nightBtn = box.querySelector('#toggleNight'), buildBtn = box.querySelector('#rebuild');
  buttons.forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.theme);
    if (i === state.theme) return;
    state.from = state.theme; state.theme = i; state.wipe = 0;
    buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  roofBtn.addEventListener('click', () => { state.roofT = state.roofT ? 0 : 1; roofBtn.setAttribute('aria-pressed', String(!state.roofT)); });
  nightBtn.addEventListener('click', () => { state.nightT = state.nightT ? 0 : 1; nightBtn.setAttribute('aria-pressed', String(!!state.nightT)); });
  buildBtn.addEventListener('click', () => { state.build = 0; });

  let visible = false, last = performance.now();
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '100px' }).observe(box);
  const loop = (now) => {
    requestAnimationFrame(loop);
    // rAF-Zeitstempel kann im ersten Frame vor performance.now() liegen: dt nie negativ (sonst schießt die Glättung über)
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (!visible) return;
    st.resize();
    st.camera.clearViewOffset();
    const k = 1 - Math.exp(-dt * 5);
    state.roof += (state.roofT - state.roof) * k;
    state.night += (state.nightT - state.night) * k;
    state.wipe = Math.min(1, state.wipe + dt / 0.9);
    state.build = Math.min(1, state.build + dt / 2.6);
    for (const h of houses) resetMesh(h);
    st.look(state.night);
    const draw = (h) => {
      h.mesh.visible = true;
      h.u.uNight.value = state.night;
      h.u.uDrop.value = 7;
      const b = state.build;
      setP(h, CAT.floor, seg(b, 0, 0.2)); setP(h, CAT.wall, seg(b, 0.1, 0.45)); setP(h, CAT.opening, seg(b, 0.3, 0.5));
      setP(h, CAT.furniture, seg(b, 0.35, 0.7)); setP(h, CAT.exterior, seg(b, 0.8, 1));
      const roof = Math.min(seg(b, 0.65, 0.95), state.roof);
      setP(h, CAT.roof, roof); setP(h, CAT.ceiling, Math.min(seg(b, 0.6, 0.85), state.roof));
    };
    const B = houses[state.theme];
    draw(B);
    if (state.wipe < 1) {
      const A = houses[state.from];
      draw(A);
      const az = Math.atan2(st.camera.position.x, st.camera.position.z);
      const dir = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
      const pos = lerp(-r * 1.1, r * 1.1, ease(state.wipe));
      A.u.uClip.value.set(dir.x, 0, dir.z, -pos);
      B.u.uClip.value.set(-dir.x, 0, -dir.z, pos);
    }
    controls.update();
    st.render();
    box.classList.add('live');
  };
  requestAnimationFrame(loop);
}

/** Startseite: Story und Playground einmalig starten. */
let started = false;
export function startHome() {
  if (started) return;
  started = true;
  story().catch((e) => { console.error(e); document.getElementById('stage').classList.add('no-gl'); });
  playground().catch((e) => { console.error(e); document.getElementById('play').classList.add('no-gl'); });
}
