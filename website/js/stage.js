// Gemeinsame 3D-Bühne der Website (Startseite, Playground, Galerie): Renderer, Himmel, Licht, Bloom, Kamera und
// Voxel-Meshes aus Pipeline-Szenen mit eigenen Pixeltexturen (textures.js). Keine Mojang-Assets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { NCAT, voxelMaterial } from './voxels.js';
import { grassTopTexture } from './textures.js';

// ---------- Hilfen ----------
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const seg = (t, a, b) => clamp01((t - a) / (b - a));
export const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x) => 1 - Math.pow(1 - x, 3);
export const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = Math.PI / 180;
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ROOM_COLORS = { kitchen: '#ffb547', bedroom: '#8fb8ff', storage: '#c9a27a', smithy: '#ff7a59', alchemy: '#b98cff', library: '#7fd6a4' };
export const THEMES = [['house_medieval', 'Mittelalter'], ['house_nordic', 'Nordisch'], ['house_rustic', 'Rustikal'], ['house_timber', 'Fachwerk']];

// ---------- Qualitätsstufen (W13-D) ----------
/**
 * Pixeldichte (Obergrenze), Schattenkarte (Anteil an shadowSize, mindestens 512), MSAA-Abtastungen, Bloom.
 * 'high' ist der Stand vor W13-D. Schwache Hardware fällt über quality 'auto' auf 'medium' bzw. 'low' zurück.
 */
export const QUALITY = {
  high: { pixelRatio: 1.75, shadow: 1, samples: 4, bloom: true },
  medium: { pixelRatio: 1.25, shadow: 0.5, samples: 2, bloom: true },
  low: { pixelRatio: 1, shadow: 0.25, samples: 0, bloom: false },
};
/** 'auto': Median der Bildzeit über so viele Bilder … */
export const AUTO_FRAMES = 45;
/** … über dieser Grenze (ms, ≈ 36 Bilder/s) eine Stufe herunter */
export const AUTO_SLOW_MS = 28;

// ---------- Fester Zufall (Wolkenversatz je Bau) ----------
function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// ---------- Bühne (Renderer, Himmel, Licht, Kamera) ----------
/**
 * @param look  'studio' (Standard: Nachtblau-Bühne der Startseite, unverändert) oder 'photo' (W10: Tageslicht wie ein
 *              Shader-Pack – heller Himmel, weiche Sonnenschatten, Dunst mit Luftperspektive, Farbabstimmung, Boden bis
 *              zum Horizont; Abend mit warmem Blocklicht und Bloom). Kein Zufall, keine Uhr im Bild.
 *              W13-D: 'photo' zusätzlich mit Wolken und Wiesen-Farbflecken; W16-A: Blockwolken, ohne Baumreihe.
 * @param quality  'high' (Standard, wie vorher), 'medium', 'low' oder 'auto' (W13-D: startet 'high' und stuft bei
 *              langsamen Bildern über `st.frame(dt)` herunter, siehe QUALITY)
 */
export function createStage(canvas, { shadowSize = 2048, look: preset = 'studio', quality = 'high' } = {}) {
  const photo = preset === 'photo';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Foto: Tonwertkurve wie der Golden-Renderer (packages/viewer/src/presentation.ts: ACES-Näherung nach Narkowicz,
  // danach Gamma 2,2) als eigener Pass; die ACES-Kurve von three.js drückt die Tiefen (Schattenseiten, dunkle Dächer)
  // fast auf Schwarz. Studio unverändert.
  renderer.toneMapping = photo ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 2000);

  const skyU = {
    top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, uExposure: { value: 1 },
    // W13-D (nur Foto): Wolkendecke und Wolkenfarbe (Tag weiß, Abend pfirsich, Nacht dunkles Blaugrau)
    uCloud: { value: 0 }, uCloudTint: { value: new THREE.Color(1, 1, 1) }, uCloudOff: { value: new THREE.Vector2(3.1, 7.4) },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: photo
      // Foto: Zenit → Horizont-Dunst (darunter Dunst), Sonnenhof um die Sonnenrichtung.
      // W10-D: wie der Golden-Himmel (presentation.ts SKY_FS) in Bildwerten gemischt und NICHT durch die Tonwertkurve
      // entsättigt: Der Himmel gibt den Wert aus, den der Tonwert-Pass (ACES nach Narkowicz, Gamma 2,2) genau auf die
      // Bildfarbe abbildet (Umkehrung der Kurve). Vorher mischte er linear und lief durch ACES: grau statt blau.
      ? `uniform vec3 top; uniform vec3 bottom; uniform vec3 glow; uniform vec3 sunDir; uniform float uExposure; varying vec3 vP;
      uniform float uCloud; uniform vec3 uCloudTint; uniform vec2 uCloudOff;
      vec3 toSrgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
      vec3 invAces(vec3 a){ vec3 qa = 2.51 - 2.43 * a, qb = 0.03 - 0.59 * a, qc = -0.14 * a;
        return (-qb + sqrt(qb * qb - 4.0 * qa * qc)) / (2.0 * qa); }
      // W13-D: Wolken als Wertrauschen (fBm) auf einer Ebene über der Szene; fester Versatz, keine Zeit – deterministisch
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){ vec3 d = normalize(vP); float h = max(d.y, 0.0);
        vec3 c = mix(toSrgb(bottom), toSrgb(top), pow(smoothstep(0.0, 0.75, h), 0.7));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += toSrgb(glow) * (pow(s, 8.0) * 0.3 + pow(s, 64.0) * 0.5) * (1.0 - smoothstep(0.0, 0.6, h) * 0.5);
        if (uCloud > 0.0 && d.y > 0.0) {
          // W16-A: blocky cloud layer (12 x 12 block cells, hard edges), faded towards the horizon
          vec2 wp = d.xz / d.y * 160.0 + uCloudOff * 40.0;
          vec2 cell = floor(wp / 12.0);
          float n = vnoise(cell * 0.11) * 0.85 + h21(cell) * 0.15;
          float cov = step(0.64, n) * smoothstep(0.06, 0.2, h) * uCloud;
          float lit = 0.9 + pow(s, 4.0) * 0.1;
          c = mix(c, toSrgb(uCloudTint) * lit, cov * 0.85);
        }
        vec3 a = pow(clamp(c, 0.0, 0.953), vec3(2.2));
        gl_FragColor = vec4(invAces(a) / uExposure, 1.0); }`
      : `uniform vec3 top; uniform vec3 bottom; uniform vec3 glow; varying vec3 vP;
      void main(){ float h = vP.y * 0.5 + 0.5; vec3 c = mix(bottom, top, smoothstep(0.25, 0.85, h));
        c += glow * pow(1.0 - abs(vP.y), 6.0) * 0.6; gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);

  const floorU = { color: { value: new THREE.Color() }, edge: { value: new THREE.Color() } };
  const floorDisc = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: floorU,
    vertexShader: 'varying vec2 vU; void main(){ vU = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 color; uniform vec3 edge; varying vec2 vU;
      void main(){ float r = length(vU) / 160.0; gl_FragColor = vec4(mix(color, edge, smoothstep(0.05, 0.6, r)), 1.0 - smoothstep(0.35, 1.0, r)); }`,
  }));
  floorDisc.rotation.x = -Math.PI / 2;
  floorDisc.position.y = -0.02;
  scene.add(floorDisc);
  // Foto: beleuchteter Boden bis zum Horizont (fängt Schatten, verschwindet im Dunst). W10-D: mit derselben Grastextur
  // wie die Grasblöcke der Szene, ein Texel = 1/16 Block wie dort – vorher einfarbig, am Rand des Geländestücks lief
  // eine gerade Naht (Helligkeit/Farbe sprangen). Höhe = Oberkante des Geländerands (gallery.js/Spot setzen sie).
  const landU = { uCalm: { value: 30 } };
  const land = new THREE.Mesh(new THREE.CircleGeometry(1400, 96), new THREE.MeshLambertMaterial(photo ? { map: grassTopTexture() } : { color: 0x5c9a34 }));
  if (photo) {
    land.material.map.repeat.set(2800, 2800);
    // Aufrufer setzen die Höhe 0,03 unter die Geländeoberkante; der Boden liegt genau auf ihr (Geometrie +0,03 nach oben,
    // lokal z = Welt y) und weicht per Polygon-Versatz den gleich hohen Grasflächen des Geländestücks – so verschwindet
    // der schmale Streifen der Seitenflächen am Rand, der als dunkle Linie zu sehen war (W10-D, Naht im Spot).
    land.geometry.translate(0, 0, 0.03);
    Object.assign(land.material, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
    // W13-D: Wiese mit großen Farbflecken (satter/trockener) wie Biom-Übergänge in Shader-Screenshots – erst außerhalb
    // des Geländestücks (uCalm = Radius), damit am Rand keine Naht entsteht; deterministisch aus der Weltlage
    land.material.onBeforeCompile = (s) => {
      s.uniforms.uCalm = landU.uCalm;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLand;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLand = position.xy;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uCalm; varying vec2 vLand;
        float lh(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
        float ln(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), f.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        float lg = ln(vLand * 0.045) * 0.6 + ln(vLand * 0.16 + 17.0) * 0.4;
        float lk = smoothstep(uCalm * 0.35, uCalm + 20.0, length(vLand));
        diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.74, 0.86, 0.74), vec3(1.14, 1.08, 0.82), smoothstep(0.2, 0.8, lg)), lk);
        // W16-A: brightness per block (+-7 %, some darker tufts) keeps the block grid readable far away
        float lb = lh(floor(vLand) + 0.5);
        diffuseColor.rgb *= (0.93 + 0.14 * lb) * (lh(floor(vLand) * 1.7 + 3.1) > 0.9 ? 0.82 : 1.0);`);
    };
    land.material.customProgramCacheKey = () => 'land-w16a';
  }
  land.rotation.x = -Math.PI / 2;
  land.position.y = -0.03;
  land.receiveShadow = true;
  land.visible = photo;
  scene.add(land);
  if (photo) floorDisc.visible = false;
  const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -0.01;
  shadowCatcher.receiveShadow = true;
  shadowCatcher.visible = !photo;
  scene.add(shadowCatcher);
  if (photo) scene.fog = new THREE.Fog(0xc9d8e4, 100, 800);
  // W16-A: keine Baumreihe mehr am Horizont (W13-D) – die blinden Prüfer lasen sie in R7 und W16-A als gemeinsames
  // Generator-Merkmal („flaches Band aus Pixelbäumen“); wie Golden reicht die Wiese mit Dunst bis zum Horizont
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x5a4632, 1.6);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  // Foto: weiche Schatten (PCF mit Radius; Vogel-Scheibe mit fester, pixelgebundener Drehung – deterministisch)
  if (photo) { sun.shadow.radius = 1; // W16-A: härter wie Shader-Pakete (vorher 2,5)
     sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; }
  scene.add(hemi, sun, sun.target);

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.55, 0.9);
  composer.addPass(bloom);
  const tone = photo ? new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uExposure: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // Ergebnis zurück in lineare Werte, damit die sRGB-Kodierung des OutputPass genau pow(x, 1/2,2) ergibt
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uExposure; varying vec2 vUv;
      vec3 toLin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
      void main(){ vec4 t = texture2D(tDiffuse, vUv); vec3 x = max(t.rgb, 0.0) * uExposure;
        vec3 a = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        gl_FragColor = vec4(toLin(pow(a, vec3(1.0 / 2.2))), t.a); }`,
  }) : null;
  if (tone) composer.addPass(tone);
  composer.addPass(new OutputPass());
  // Foto: Farbabstimmung nach der Tonwertkurve (Split-Toning: kühle Tiefen, warme Lichter; etwas Sättigung; Vignette)
  const grade = photo ? new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uWarm: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uWarm; varying vec2 vUv;
      void main(){ vec4 t = texture2D(tDiffuse, vUv); vec3 c = t.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.03); // W16-A: saturation 1.08 -> 1.03
        // W13-D: Lichter etwas kräftiger (obere Hälfte einer S-Kurve), Tiefen unverändert – dunkle Dächer nicht absaufen lassen;
        // dazu etwas kräftigeres Split-Toning
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.25 * smoothstep(0.35, 0.8, l));
        c += (vec3(-0.018, 0.0, 0.04) * (1.0 - smoothstep(0.0, 0.45, l)) + vec3(0.035, 0.015, -0.012) * smoothstep(0.45, 1.0, l)) * uWarm;
        vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.25; // W16-A: vignette 0.42 -> 0.25
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a); }`,
  }) : null;
  if (grade) composer.addPass(grade);

  // W13-D: Qualitätsstufen (QUALITY). 'high' = Zustand wie vorher (nichts wird umgestellt); 'auto' misst die Bildzeit
  // über st.frame(dt) und stuft bei langsamen Bildern einmalig je Schritt herunter (high → medium → low), nie hinauf.
  const auto = quality === 'auto';
  const frames = [];
  let warm = 0;
  function applyQuality(name) {
    const q = QUALITY[name];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
    const s = Math.max(512, Math.round(shadowSize * q.shadow));
    if (sun.shadow.mapSize.x !== s) { sun.shadow.mapSize.set(s, s); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== q.samples) { rt.samples = q.samples; rt.dispose(); }
    bloom.enabled = q.bloom;
    st.quality = name;
    canvas.dataset.quality = name;
    st.w = 0; // nächstes resize() setzt Größe und Pixeldichte neu
  }

  const st = {
    renderer, scene, camera, composer, bloom, floorDisc, shadowCatcher, hemi, sun, land, grade, photo, w: 1, h: 1,
    /** Foto: Blocklicht-Anteil der letzten Stimmung (für uNight der Meshes) */
    glow: 0,
    framing: { x: 0, y: 0 },
    resize() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w === st.w && h === st.h) return;
      st.w = w; st.h = h;
      renderer.setSize(w, h, false);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      camera.aspect = w / h;
    },
    orbit(target, az, el, radius, fill = 1) {
      const vf = camera.fov * deg;
      const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
      const shift = Math.abs(st.framing.x) * 2; // verschobenes Motiv: weniger nutzbare Breite
      const f = Math.min(vf, hf * (1 - shift));
      const dist = (radius / Math.sin(f / 2)) / fill;
      camera.position.set(target[0] + dist * Math.cos(el) * Math.sin(az), target[1] + dist * Math.sin(el), target[2] + dist * Math.cos(el) * Math.cos(az));
      camera.up.set(0, 1, 0);
      if (el > 88 * deg) camera.up.set(-Math.sin(az), 0, -Math.cos(az));
      camera.lookAt(target[0], target[1], target[2]);
      camera.setViewOffset(st.w, st.h, -st.framing.x * st.w, -st.framing.y * st.h, st.w, st.h);
      camera.near = Math.max(0.5, dist - radius * 4);
      camera.far = dist + 1200;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      st.haze(dist);
    },
    /** Luftperspektive: Dunst beginnt kurz vor dem Motiv und nimmt bis zum Horizont zu (nur 'photo'). */
    haze(dist) {
      if (!photo) return;
      scene.fog.near = dist * 0.75;
      scene.fog.far = dist * 7 + 120;
    },
    /**
     * Augenhöhe (W10, camera-rig.js heroCamera): waagerechter Blick, senkrechte Kanten bleiben senkrecht; das Bild wird
     * wie mit einem Shift-Objektiv verschoben (setViewOffset), statt die Kamera zu kippen.
     */
    eye(cam) {
      camera.fov = cam.fov;
      camera.aspect = st.w / st.h;
      camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
      camera.setViewOffset(st.w, st.h, -(cam.shiftX ?? 0) * st.w, -cam.shiftY * st.h, st.w, st.h);
      camera.near = 0.3;
      camera.far = cam.distance * 4 + 1500;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      st.haze(cam.distance);
    },
    setSun(radius, az = 35 * deg, el = 52 * deg) {
      const d = radius * 3;
      sun.position.set(Math.cos(el) * Math.sin(az) * d, Math.sin(el) * d, Math.cos(el) * Math.cos(az) * d);
      sun.target.position.set(0, 0, 0);
      skyU.sunDir.value.copy(sun.position).normalize();
      const s = sun.shadow.camera;
      s.left = -radius * 1.3; s.right = radius * 1.3; s.top = radius * 1.3; s.bottom = -radius * 1.3;
      s.near = 1; s.far = d * 2.5;
      s.updateProjectionMatrix();
    },
    look(night, dusk = 0) {
      if (photo) return lookPhoto(night, dusk);
      const DAY = { top: 0x2b3a78, bottom: 0x121629, glow: 0xffb070, floor: 0x2b3360, edge: 0x141830 };
      const NIGHT = { top: 0x070a1a, bottom: 0x02030a, glow: 0x3050a0, floor: 0x0b0f22, edge: 0x04050c };
      const a = new THREE.Color(), b = new THREE.Color();
      const mix = (x, y) => a.setHex(x, THREE.SRGBColorSpace).lerp(b.setHex(y, THREE.SRGBColorSpace), night).clone();
      skyU.top.value.copy(mix(DAY.top, NIGHT.top));
      skyU.bottom.value.copy(mix(DAY.bottom, NIGHT.bottom));
      skyU.glow.value.copy(mix(DAY.glow, NIGHT.glow));
      if (dusk > 0) skyU.glow.value.lerp(a.setHex(0xff9a50, THREE.SRGBColorSpace), dusk);
      floorU.color.value.copy(mix(DAY.floor, NIGHT.floor));
      floorU.edge.value.copy(mix(DAY.edge, NIGHT.edge));
      hemi.intensity = lerp(1.6, 0.45, night);
      hemi.color.setHex(0xdfe8ff).lerp(a.setHex(0x6d86d8), night);
      sun.intensity = lerp(2.6, 0.35, night);
      sun.color.setHex(0xfff0d8).lerp(a.setHex(0x8aa2ff), night);
      bloom.strength = lerp(0.3, 0.55, night);
      bloom.threshold = lerp(0.9, 0.8, night);
      renderer.toneMappingExposure = lerp(1.05, 1.25, night);
    },
    /** Aktuelle Qualitätsstufe (QUALITY) */
    quality: QUALITY[quality] ? quality : 'high',
    /**
     * Bildzeit melden (ms seit dem letzten Bild, z. B. aus requestAnimationFrame). Nur bei quality 'auto': nach einer
     * Anlaufphase Median über AUTO_FRAMES Bilder; liegt er über AUTO_SLOW_MS, eine Stufe herunter.
     */
    frame(dtMs) {
      if (!auto || st.quality === 'low' || !(dtMs > 0) || dtMs > 250) return;
      if (warm++ < 30) return;
      frames.push(dtMs);
      if (frames.length < AUTO_FRAMES) return;
      const med = frames.sort((a, b) => a - b)[frames.length >> 1];
      frames.length = 0;
      if (med > AUTO_SLOW_MS) { applyQuality(st.quality === 'high' ? 'medium' : 'low'); warm = 0; }
    },
    setQuality(name) { if (QUALITY[name] && name !== st.quality) applyQuality(name); },
    /**
     * Foto: Wiesen-Farbflecken erst ab `calm` (Radius des Geländestücks, W13-D); `seed` (ganze Zahl, z. B. aus der Bau-ID)
     * verschiebt die Wolken, damit nicht jedes Galeriebild denselben Himmel hat. `radius`/`y` sind seit W16-A (ohne
     * Baumreihe) ohne Wirkung und bleiben nur für die Aufrufer.
     */
    setBackdrop(radius, y, calm = radius * 0.5, seed = 0) {
      if (!photo) return;
      const rs = mulberry(seed);
      skyU.uCloudOff.value.set(3.1 + rs() * 40, 7.4 + rs() * 40);
      landU.uCalm.value = calm;
    },
    toScreen(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return [(v.x * 0.5 + 0.5) * st.w, (-v.y * 0.5 + 0.5) * st.h];
    },
    render() { composer.render(); },
  };
  // Foto-Stimmungen: Tag (warme Sonne, blauer Himmel mit Dunst), Abend (tiefe orange Sonne, warmer Horizont,
  // Laternen glühen mit Bloom), Nacht (kühl, Blocklicht warm)
  // W10-C/R6-1: Tag und Abend radiometrisch wie der Golden-Renderer (presentation.ts MOODS: Sonne, Himmels- und Bodenlicht,
  // Belichtung; three.js teilt Lambert durch π, daher Stärke = Golden × π / Farbanteil) – Dächer und Schattenseiten lesbar
  const PH = {
    day: { top: 0x4f82dc, bottom: 0xb4cdef, glow: 0xfff0d1, hemiSky: 0xb8d0ff, hemiGround: 0x9c8e7c, sun: 0xffe9c8, hemi: 2.0, sunI: 8.0, exp: 0.93, cloudTint: 0xfbfbfd, cloud: 1 },
    dusk: { top: 0x334d8f, bottom: 0xf2b88a, glow: 0xffa861, hemiSky: 0x9fb0d8, hemiGround: 0x917560, sun: 0xffbe80, hemi: 1.6, sunI: 8.2, exp: 1.1, cloudTint: 0xffc8a0, cloud: 0.9 },
    night: { top: 0x0a1030, bottom: 0x1b2440, glow: 0x3050a0, hemiSky: 0x5d74c0, hemiGround: 0x241c18, sun: 0x8aa2ff, hemi: 0.42, sunI: 0.35, exp: 1.2, cloudTint: 0x283250, cloud: 0.6 },
  };
  const SCALAR = new Set(['hemi', 'sunI', 'exp', 'cloud']);
  function lookPhoto(night, dusk) {
    const c2 = new THREE.Color();
    // Tag → Abend (dusk), dann → Nacht (night)
    const pick = (k) => {
      const d = PH.day[k], e = PH.dusk[k], n = PH.night[k];
      if (SCALAR.has(k)) return lerp(lerp(d, e, dusk), n, night);
      const c = new THREE.Color().setHex(d, THREE.SRGBColorSpace).lerp(c2.setHex(e, THREE.SRGBColorSpace), dusk);
      return c.lerp(c2.setHex(n, THREE.SRGBColorSpace), night);
    };
    skyU.top.value.copy(pick('top'));
    skyU.bottom.value.copy(pick('bottom'));
    skyU.glow.value.copy(pick('glow'));
    // Dunstfarbe wie Golden: Horizont (linear) × 0,9
    scene.fog.color.copy(pick('bottom')).multiplyScalar(0.9);
    hemi.color.copy(pick('hemiSky'));
    hemi.groundColor.copy(pick('hemiGround'));
    hemi.intensity = pick('hemi');
    sun.color.copy(pick('sun'));
    sun.intensity = pick('sunI');
    renderer.toneMappingExposure = pick('exp');
    tone.uniforms.uExposure.value = pick('exp');
    skyU.uExposure.value = pick('exp');
    skyU.uCloud.value = pick('cloud');
    skyU.uCloudTint.value.copy(pick('cloudTint'));
    // Abend/Nacht: Laternen und Blocklicht glühen (Bloom nur für wirklich helle Stellen)
    st.glow = Math.max(night, dusk * 0.6);
    bloom.strength = lerp(0.18, 0.6, st.glow);
    bloom.threshold = lerp(2.0, 0.78, st.glow);
    grade.uniforms.uWarm.value = 1 - night * 0.7;
  }
  if (st.quality !== 'high') applyQuality(st.quality);
  st.look(0);
  return st;
}

/** Voxel-Mesh aus einer (evtl. geteilten) Geometrie; jede Bühne braucht eigene Materialien. */
export function voxelMesh(built, ghost = false) {
  const { mat, depth, u } = voxelMaterial(ghost, built.texture);
  u.uShade.value = built.shade ? 1 : 0;
  const mesh = new THREE.Mesh(built.geometry, mat);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = !ghost;
  mesh.receiveShadow = !ghost;
  mesh.frustumCulled = false;
  mesh.visible = false;
  if (ghost) { u.uInvert.value = 1; mesh.renderOrder = 5; }
  return { mesh, u, ...built };
}
export function resetMesh(m) {
  m.mesh.visible = false;
  for (let i = 0; i < NCAT; i++) { m.u.uP.value[i] = 1; m.u.uLift.value[i] = 0; }
  m.u.uClip.value.set(0, 0, 0, 1);
  m.u.uNight.value = 0;
  m.u.uDrop.value = 6;
  m.u.uLayerY.value = 1e5;
}
export const setP = (m, cat, p) => { m.u.uP.value[cat] = p; };
export const setAll = (m, p) => { for (let i = 0; i < NCAT; i++) m.u.uP.value[i] = p; };


/** Szene laden (JSON aus scenes/ oder gallery/). */
export async function loadScene(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
