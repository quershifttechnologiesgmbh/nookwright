/**
 * Beleuchteter Block-Renderer (WebGL2): Texturen wie `createBlockRenderer`, dazu Minecraft-Licht –
 * Blocklicht und Himmelslicht je Zelle (lighting.ts), weiches Licht + AO je Vertex (smooth-light.ts),
 * Lightmap im Fragment-Shader (lightmap.ts). Tageszeit, Helligkeit, Licht an/aus, Spawn-Markierung und
 * Flackern sind Uniforms: kein Mesh-Neubau, kein neues Lichtfeld.
 *
 * Warum ein eigener Render-Pfad statt deepslates `StructureRenderer`: dessen Shader sind Modul-Konstanten,
 * `shaderProgram` ist `protected readonly`, `ChunkBuilder` privat, `Mesh.rebuild` kennt nur feste Attribute
 * (Position, Farbe, UV, Normale, blockPos) und `drawStructure` bindet davon eine feste Auswahl (WebGL 1,
 * 16-Bit-Indizes). Licht je Vertex ginge nur über Umdeuten von `blockPos` und Zugriff auf private Felder.
 * Deshalb: deepslate liefert weiter Modelle, Texturen, Spezialrenderer und Culling-Regeln (lit-mesh.ts), das
 * Zeichnen übernimmt dieser dünne WebGL2-Pfad (ein verschränkter Puffer je Durchgang, 32-Bit-Indizes).
 *
 * Schnittstelle wie `BlockRenderer` (austauschbar), erweitert um `setLighting`, `setSpawnCells`, `setHighlight`
 * (Auswahlrahmen, nur Linien – kein Neubau) und `measureFrames`.
 */
import { Identifier } from 'deepslate';
import { FOV_Y, fitOrbit, orbitEye, orbitView, type Orbit } from './camera.js';
import { createPresentationPass, type PresentationLook, type PresentationPass } from './presentation.js';
import {
  LightRuleCache, blockFlagLightRules, estimateSpawnCells, fieldIndex, lightInput, propagateLight, sameLightInput,
  type LightField, type LightFieldOptions, type LightRules,
} from './lighting.js';
import { LIGHTMAP_GLSL, dayLighting, flicker, lightmapParams, type Rgb } from './lightmap.js';
import { LIT_OFFSETS, LIT_VERTEX_FLOATS, LitMeshCache, buildLitGeometry, type LitBuffers } from './lit-mesh.js';
import { attachOrbitControls } from './orbit-controls.js';
import { boxLines, type CellBox } from './pick.js';
import type { Vec3, ViewerResources } from './port.js';
import { toImageData, type BlockRenderer, type BlockRendererOptions, type RenderStats, type SetVolumeOptions } from './renderer.js';
import { createDeepslateResources } from './resources.js';
import { toStructure, type StructureOptions, type VoxelSource } from './structure.js';

export interface LightingParams {
  /** Minecraft-Licht an (false: nur Flächenschattierung wie der einfache Renderer) */
  readonly enabled: boolean;
  /** Minecraft-Tageszeit in Ticks: 6000 Mittag, 12000–13500 Dämmerung, 18000 Mitternacht (siehe DAY_TIME) */
  readonly dayTime: number;
  /** Minecraft-Einstellung „Helligkeit“ 0 (düster) … 1 (hell) */
  readonly brightness: number;
  /** Spawn-gefährdete Stellen (Blocklicht 0 auf begehbaren Innenflächen) rot einfärben */
  readonly spawnHighlight: boolean;
  /** Blocklicht flackert leicht (zeichnet dann fortlaufend) */
  readonly flicker: boolean;
  /** Weiches Licht + AO (Umschalten baut die Meshes neu, das Lichtfeld bleibt) */
  readonly smooth: boolean;
}

export const DEFAULT_LIGHTING: LightingParams = { enabled: true, dayTime: 6000, brightness: 0.5, spawnHighlight: false, flicker: false, smooth: true };

export interface LitRendererOptions extends BlockRendererOptions {
  /** Lichtregeln (Emission, Undurchsichtigkeit, Flächen). Standard: nur Block-Flags, ohne Emission. */
  readonly rules?: LightRules;
  readonly lighting?: Partial<LightingParams>;
  readonly lightField?: LightFieldOptions;
}

export interface LitSetVolumeOptions extends SetVolumeOptions {
  /** Spawn-Stellen (Welt-Positionen, z. B. `darkCells` des Spawn-Reports); ohne: Schätzung aus dem Lichtfeld */
  readonly spawnCells?: Iterable<Vec3>;
}

export interface LitRenderStats extends RenderStats {
  /** Lichtfeld in ms (Zellen einlesen + Ausbreitung; bei `lightReused` nur Einlesen und Vergleich) */
  readonly lightMs: number;
  /** Lichtfeld unverändert übernommen (gleiche Lichteigenschaften aller Zellen) */
  readonly lightReused: boolean;
  /** Geometrie mit Licht je Vertex + Hochladen in ms (in `buildMs` enthalten) */
  readonly meshMs: number;
  readonly quads: number;
  readonly spawnCells: number;
  readonly spawnQuads: number;
  readonly meshErrors: readonly string[];
}

export interface FrameStats {
  readonly frames: number;
  /** Bilder je Sekunde über requestAnimationFrame (durch die Bildwiederholrate gedeckelt) */
  readonly fps: number;
  /** mittlere Zeichenzeit je Bild inkl. GPU (bis zum Abschluss per readPixels) in ms */
  readonly drawMs: number;
  readonly drawP95Ms: number;
  /** längster Abstand zweier Bilder in ms */
  readonly maxFrameMs: number;
}

/**
 * Projektion (additiv, P0-A „Goldene Galerie“): Standard ist die Perspektive wie deepslate (70°, 0,1 … 500).
 * `orthographic` zeigt Fassaden und Schnitte ohne Fluchtpunkte; `halfHeight` = halbe Bildhöhe in Blöcken.
 */
export type Projection =
  | {
    readonly kind: 'perspective';
    /** vertikaler Öffnungswinkel in Radiant (Standard FOV_Y) */
    readonly fovY?: number;
    /** W10: Bildverschiebung nach oben in Bildhöhen (Shift-Objektiv; Kamera bleibt waagerecht). Standard 0. */
    readonly shiftY?: number;
  }
  | { readonly kind: 'orthographic'; readonly halfHeight: number };

export const DEFAULT_PROJECTION: Projection = { kind: 'perspective' };

export interface LitBlockRenderer extends BlockRenderer {
  readonly stats: LitRenderStats;
  readonly lighting: LightingParams;
  /** aktuelles Lichtfeld (lokale Koordinaten des Volumens) */
  readonly lightField: LightField | undefined;
  setVolume(src: VoxelSource, opts?: LitSetVolumeOptions): LitRenderStats;
  setCutaway(maxY: number | undefined): LitRenderStats | undefined;
  /** Projektion wechseln (nur Matrix, kein Neubau). Additiv; ohne Aufruf bleibt alles wie bisher. */
  setProjection(p: Projection): void;
  /** Sofort zeichnen (synchron, ohne requestAnimationFrame) – für Standbilder; danach gilt der Zeichenpuffer. */
  renderNow(): void;
  /** Nur Uniforms (außer `smooth`) – sofort, ohne Neubau. */
  setLighting(p: Partial<LightingParams>): void;
  /** Spawn-Stellen setzen (`undefined` = Schätzung); baut die Meshes neu, das Lichtfeld bleibt. */
  setSpawnCells(cells: Iterable<Vec3> | undefined): LitRenderStats | undefined;
  /** Auswahlrahmen um einen Zellquader (Weltkoordinaten), immer sichtbar; `undefined` = keiner. Kein Neubau. */
  setHighlight(box: CellBox | undefined): void;
  /** Dreht die Kamera einmal im Kreis und misst die Bildrate. */
  measureFrames(frames?: number): Promise<FrameStats>;
  /**
   * W10: Präsentations-Look (Sonne mit weichen Schatten, Himmel, Dunst, Tonwertkurve; presentation.ts) oder
   * `undefined` = Minecraft-Licht wie bisher. Additiv: ohne Aufruf zeichnet der Renderer bitgleich zu vorher.
   */
  setLook(look: PresentationLook | undefined): void;
}

// ------------------------------------------------------------------------------------------ Shader

const BLOCK_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aTexLimit;
layout(location = 3) in vec3 aTint;
layout(location = 4) in vec4 aLight;
layout(location = 5) in float aFlags;
uniform mat4 uView;
uniform mat4 uProj;
out vec2 vUv;
out vec4 vTexLimit;
out vec3 vTint;
out vec4 vLight;
flat out int vFlags;
void main() {
  gl_Position = uProj * uView * vec4(aPos, 1.0);
  vUv = aUv;
  vTexLimit = aTexLimit;
  vTint = aTint;
  vLight = aLight;
  vFlags = int(aFlags + 0.5);
}
`;

const BLOCK_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vTexLimit;
in vec3 vTint;
in vec4 vLight; // Blocklicht, Himmelslicht (0..15), AO, Flächenschattierung
flat in int vFlags;
uniform sampler2D uAtlas;
uniform float uPixelSize;
uniform float uLit;
uniform float uSpawn;
${LIGHTMAP_GLSL}
out vec4 outColor;
void main() {
  vec2 lo = vTexLimit.xy + vec2(0.5 * uPixelSize);
  vec2 hi = vTexLimit.zw - vec2(0.5 * uPixelSize);
  vec4 tex = texture(uAtlas, clamp(vUv, lo, hi));
  if (tex.a < 0.01) discard;
  vec3 rgb = tex.rgb * vTint;
  if (uLit > 0.5) {
    rgb *= lightmap(vLight.x, vLight.y) * (vLight.z * vLight.w);
  } else {
    rgb *= vLight.w;
  }
  if (uSpawn > 0.5 && (vFlags & 1) != 0) {
    float stripe = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 16.0));
    rgb = mix(rgb, vec3(1.0, 0.1, 0.06), 0.45 + 0.25 * stripe);
  }
  outColor = vec4(rgb, tex.a);
}
`;

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vColor;
void main() {
  gl_Position = uProj * uView * vec4(aPos, 1.0);
  vColor = aColor;
}
`;

const LINE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
uniform float uDim;
out vec4 outColor;
void main() {
  outColor = vec4(vColor * uDim, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const shader = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type);
    if (s === null) throw new Error('Shader nicht anlegbar');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`${type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'}-Shader: ${log}`);
    }
    return s;
  };
  const p = gl.createProgram();
  const v = shader(gl.VERTEX_SHADER, vs), f = shader(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Shader-Programm: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** Perspektive wie deepslate (70°, 0,1 … 500), spaltenweise; `shiftY` verschiebt das Bild (Shift, W10). */
function perspective(aspect: number, fovY = FOV_Y, shiftY = 0): Float32Array {
  const near = 0.1, far = 500;
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
  if (shiftY !== 0) m[9] = 2 * shiftY;
  return m;
}

/** Parallelprojektion (spaltenweise); Tiefe −1000 … 1000 um das Auge, damit nichts vorne abgeschnitten wird. */
function orthographic(aspect: number, halfHeight: number): Float32Array {
  const near = -1000, far = 1000;
  const h = Math.max(1e-3, halfHeight), w = h * aspect;
  const m = new Float32Array(16);
  m[0] = 1 / w; m[5] = 1 / h; m[10] = -2 / (far - near); m[14] = -(far + near) / (far - near); m[15] = 1;
  return m;
}

/** Projektionsmatrix; der Standard ist bitgleich zur bisherigen Perspektive. */
export function projectionMatrix(p: Projection, aspect: number): Float32Array {
  return p.kind === 'orthographic' ? orthographic(aspect, p.halfHeight) : perspective(aspect, p.fovY ?? FOV_Y, p.shiftY ?? 0);
}

interface GpuMesh {
  readonly vao: WebGLVertexArrayObject;
  readonly vbo: WebGLBuffer;
  readonly ibo: WebGLBuffer;
  count: number;
}

function createGpuMesh(gl: WebGL2RenderingContext): GpuMesh {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const stride = LIT_VERTEX_FLOATS * 4;
  const attr = (loc: number, size: number, offset: number): void => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
  };
  attr(0, 3, LIT_OFFSETS.pos);
  attr(1, 2, LIT_OFFSETS.uv);
  attr(2, 4, LIT_OFFSETS.texLimit);
  attr(3, 3, LIT_OFFSETS.tint);
  attr(4, 4, LIT_OFFSETS.light);
  attr(5, 1, LIT_OFFSETS.flags);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, count: 0 };
}

function uploadMesh(gl: WebGL2RenderingContext, m: GpuMesh, b: LitBuffers): void {
  gl.bindVertexArray(m.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
  gl.bufferData(gl.ARRAY_BUFFER, b.vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  m.count = b.quads * 6;
}

/** Bodenraster + Umriss wie deepslates `drawGrid` (x rot, z blau, sonst grau). */
function gridLines(size: Vec3): Float32Array {
  const [X, Y, Z] = size;
  const out: number[] = [];
  const line = (a: Vec3, b: Vec3, c: Rgb): void => {
    out.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  const g: Rgb = [0.8, 0.8, 0.8];
  line([0, 0, 0], [X, 0, 0], [1, 0, 0]);
  line([0, 0, 0], [0, 0, Z], [0, 0, 1]);
  for (const [x, z] of [[0, 0], [X, 0], [0, Z], [X, Z]] as const) line([x, 0, z], [x, Y, z], g);
  line([0, Y, 0], [0, Y, Z], g); line([X, Y, 0], [X, Y, Z], g); line([0, Y, 0], [X, Y, 0], g); line([0, Y, Z], [X, Y, Z], g);
  for (let x = 1; x <= X; x++) line([x, 0, 0], [x, 0, Z], g);
  for (let z = 1; z <= Z; z++) line([0, 0, z], [X, 0, z], g);
  return new Float32Array(out);
}

/** Farbe des Auswahlrahmens (Akzentfarbe der App, warmes Gelb). */
const HIGHLIGHT_COLOR = [1, 0.84, 0.35] as const;

const EMPTY_STATS: LitRenderStats = {
  blocks: 0, unknownBlocks: [], buildMs: 0, lightMs: 0, lightReused: false, meshMs: 0, quads: 0, spawnCells: 0, spawnQuads: 0, meshErrors: [],
};

export function createLitRenderer(canvas: HTMLCanvasElement, resources: ViewerResources, opts: LitRendererOptions = {}): LitBlockRenderer {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (gl === null) throw new Error('WebGL2 ist in diesem Browser nicht verfügbar');
  const res = createDeepslateResources({ ...resources, atlas: toImageData(resources.atlas) });
  const ruleCache = new LightRuleCache(opts.rules ?? blockFlagLightRules(resources.blockFlags));
  const meshCache = new LitMeshCache(res, resources.models);
  const baseBg = opts.background ?? [0.62, 0.76, 0.9];
  let lighting: LightingParams = { ...DEFAULT_LIGHTING, ...opts.lighting };
  let grid = opts.grid ?? false;
  let source: VoxelSource | undefined;
  let structureOpts: StructureOptions = {};
  let field: LightField | undefined;
  let spawnWorld: Vec3[] | undefined;
  let spawnSet = new Set<number>();
  let orbit: Orbit = fitOrbit([16, 16, 16]);
  let stats: LitRenderStats = EMPTY_STATS;
  let projection: Projection = DEFAULT_PROJECTION;
  let proj = projectionMatrix(projection, 1);
  let frame = 0;
  let measuring = false;
  let disposed = false;
  let look: PresentationLook | undefined;
  let presentation: PresentationPass | undefined;

  // ---------------------------------------------------------------------------------- GL-Zustand
  const blockProgram = compile(gl, BLOCK_VS, BLOCK_FS);
  const lineProgram = compile(gl, LINE_VS, LINE_FS);
  const u = (p: WebGLProgram, name: string): WebGLUniformLocation | null => gl.getUniformLocation(p, name);
  const U = {
    view: u(blockProgram, 'uView'), proj: u(blockProgram, 'uProj'), atlas: u(blockProgram, 'uAtlas'), pixelSize: u(blockProgram, 'uPixelSize'),
    lit: u(blockProgram, 'uLit'), spawn: u(blockProgram, 'uSpawn'), skyFactor: u(blockProgram, 'uSkyFactor'), skyColor: u(blockProgram, 'uSkyColor'),
    blockFactor: u(blockProgram, 'uBlockFactor'), blockTint: u(blockProgram, 'uBlockTint'), brightness: u(blockProgram, 'uBrightness'),
    lineView: u(lineProgram, 'uView'), lineProj: u(lineProgram, 'uProj'), lineDim: u(lineProgram, 'uDim'),
  };
  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, toImageData(resources.atlas));
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  const pixelSize = res.getPixelSize?.() ?? 0;
  const opaqueMesh = createGpuMesh(gl);
  const transparentMesh = createGpuMesh(gl);
  const lineVao = gl.createVertexArray();
  const lineVbo = gl.createBuffer();
  let lineCount = 0;
  let lineSize = '';
  const hlVao = gl.createVertexArray();
  const hlVbo = gl.createBuffer();
  let hlCount = 0;
  let highlight: CellBox | undefined;
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(hlVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, hlVbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  const aspect = (): number => (canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1);

  // ---------------------------------------------------------------------------------- Zeichnen
  const drawNow = (now: number): void => {
    if (look !== undefined && source !== undefined) {
      presentation ??= createPresentationPass(gl);
      const eye = orbitEye(orbit);
      presentation.draw(look, {
        view: orbitView(orbit), proj, eye, distance: orbit.distance, size: source.size,
        meshes: [opaqueMesh, transparentMesh], atlas: atlas!, pixelSize, width: canvas.width, height: canvas.height,
      });
      gl.useProgram(null);
      return;
    }
    const day = dayLighting(lighting.dayTime);
    const lit = lighting.enabled;
    const lm = lightmapParams(day, lighting.brightness, lighting.flicker ? flicker(now / 1000) : 0);
    const bg = lit ? day.background : baseBg;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const view = orbitView(orbit);
    if (grid && lineCount > 0) {
      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(U.lineView, false, view);
      gl.uniformMatrix4fv(U.lineProj, false, proj);
      gl.uniform1f(U.lineDim, lit ? Math.max(0.35, day.skyDarken) : 1);
      gl.bindVertexArray(lineVao);
      gl.drawArrays(gl.LINES, 0, lineCount);
    }
    gl.useProgram(blockProgram);
    gl.uniformMatrix4fv(U.view, false, view);
    gl.uniformMatrix4fv(U.proj, false, proj);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.uniform1i(U.atlas, 0);
    gl.uniform1f(U.pixelSize, pixelSize);
    gl.uniform1f(U.lit, lit ? 1 : 0);
    gl.uniform1f(U.spawn, lighting.spawnHighlight ? 1 : 0);
    gl.uniform1f(U.skyFactor, lm.skyFactor);
    gl.uniform3f(U.skyColor, lm.skyColor[0], lm.skyColor[1], lm.skyColor[2]);
    gl.uniform1f(U.blockFactor, lm.blockFactor);
    gl.uniform3f(U.blockTint, lm.blockTint[0], lm.blockTint[1], lm.blockTint[2]);
    gl.uniform1f(U.brightness, lm.brightness);
    for (const m of [opaqueMesh, transparentMesh]) {
      if (m.count === 0) continue;
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    }
    if (hlCount > 0) {
      // Auswahlrahmen zuletzt und ohne Tiefentest: auch hinter Wänden sichtbar
      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(U.lineView, false, view);
      gl.uniformMatrix4fv(U.lineProj, false, proj);
      gl.uniform1f(U.lineDim, 1);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(hlVao);
      gl.drawArrays(gl.LINES, 0, hlCount);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.bindVertexArray(null);
  };
  const animating = (): boolean => lighting.enabled && lighting.flicker;
  const draw = (now: number): void => {
    frame = 0;
    if (disposed || measuring) return;
    drawNow(now);
    if (animating()) requestRender();
  };
  const requestRender = (): void => {
    if (frame === 0 && !disposed && !measuring) frame = requestAnimationFrame(draw);
  };

  // ---------------------------------------------------------------------------------- Aufbau
  /** Lichtfeld nur neu ausbreiten, wenn sich die Lichteigenschaften der Zellen geändert haben. */
  const updateLight = (src: VoxelSource): { ms: number; reused: boolean } => {
    const t0 = performance.now();
    const input = lightInput(src, ruleCache);
    const reused = field !== undefined && sameLightInput(field.input, input);
    if (!reused) field = propagateLight(input, opts.lightField);
    return { ms: performance.now() - t0, reused };
  };

  const updateSpawnSet = (): void => {
    spawnSet = new Set<number>();
    if (field === undefined) return;
    if (spawnWorld === undefined) {
      for (const i of estimateSpawnCells(field)) spawnSet.add(i);
      return;
    }
    for (const p of spawnWorld) {
      const i = fieldIndex(field, p);
      if (i >= 0) spawnSet.add(i);
    }
  };

  const rebuildMesh = (light: { ms: number; reused: boolean }): LitRenderStats => {
    if (source === undefined || field === undefined) return stats;
    const t0 = performance.now();
    const result = toStructure(source, structureOpts);
    const t1 = performance.now();
    const cutY = structureOpts.maxY === undefined ? undefined : structureOpts.maxY - source.origin[1];
    const geo = buildLitGeometry(result.structure, res, field, {
      spawnCells: spawnSet, smooth: lighting.smooth, cache: meshCache, ...(cutY !== undefined ? { cutY } : {}),
    });
    uploadMesh(gl, opaqueMesh, geo.opaque);
    uploadMesh(gl, transparentMesh, geo.transparent);
    const key = source.size.join(',');
    if (key !== lineSize) {
      const lines = gridLines(source.size);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
      gl.bufferData(gl.ARRAY_BUFFER, lines, gl.STATIC_DRAW);
      lineCount = lines.length / 6;
      lineSize = key;
    }
    const t2 = performance.now();
    const unknownBlocks = result.blockIds.filter((id) => !res.hasBlock(Identifier.parse(id)));
    stats = {
      blocks: result.blocks, unknownBlocks, buildMs: Math.round(t2 - t0),
      lightMs: Math.round(light.ms * 10) / 10, lightReused: light.reused, meshMs: Math.round(t2 - t1),
      quads: geo.quads, spawnCells: spawnSet.size, spawnQuads: geo.spawnQuads, meshErrors: geo.errors,
    };
    requestRender();
    return stats;
  };

  const fit = (): void => {
    if (source !== undefined) orbit = fitOrbit(source.size, aspect());
    requestRender();
  };

  /** Rahmen in Strukturkoordinaten hochladen (braucht den Ursprung der Quelle). */
  const uploadHighlight = (): void => {
    if (highlight === undefined || source === undefined) {
      hlCount = 0;
      return;
    }
    const o = source.origin;
    const local: CellBox = {
      min: [highlight.min[0] - o[0], highlight.min[1] - o[1], highlight.min[2] - o[2]],
      max: [highlight.max[0] - o[0], highlight.max[1] - o[1], highlight.max[2] - o[2]],
    };
    const lines = boxLines(local, HIGHLIGHT_COLOR);
    gl.bindBuffer(gl.ARRAY_BUFFER, hlVbo);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
    hlCount = lines.length / 6;
  };

  const detach = attachOrbitControls(canvas, {
    getOrbit: () => orbit,
    setOrbit: (o) => {
      orbit = o;
      requestRender();
    },
    fit,
  });

  const resize = (): void => {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    gl.viewport(0, 0, w, h);
    proj = projectionMatrix(projection, aspect());
    requestRender();
  };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
  observer?.observe(canvas);
  resize();

  const measureFrames = (frames = 120): Promise<FrameStats> => new Promise((resolve) => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    measuring = true;
    const start = orbit;
    const intervals: number[] = [];
    const draws: number[] = [];
    const pixel = new Uint8Array(4);
    let last = -1;
    let k = 0;
    const finish = (): void => {
      measuring = false;
      orbit = start;
      requestRender();
      const avg = (a: number[]): number => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);
      const sorted = [...draws].sort((a, b) => a - b);
      const round = (v: number): number => Math.round(v * 100) / 100;
      resolve({
        frames: draws.length,
        fps: round(intervals.length === 0 ? 0 : 1000 / avg(intervals)),
        drawMs: round(avg(draws)),
        drawP95Ms: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0),
        maxFrameMs: round(Math.max(0, ...intervals)),
      });
    };
    const step = (now: number): void => {
      if (disposed) {
        finish();
        return;
      }
      orbit = { ...start, yaw: start.yaw + (k / frames) * Math.PI * 2 };
      const t0 = performance.now();
      drawNow(now);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // wartet auf die GPU
      draws.push(performance.now() - t0);
      if (last >= 0) intervals.push(now - last);
      last = now;
      if (++k < frames) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  });

  const renderer: LitBlockRenderer = {
    resources: res,
    get stats() {
      return stats;
    },
    get lighting() {
      return lighting;
    },
    get lightField() {
      return field;
    },
    setVolume(src, o = {}) {
      const first = source === undefined;
      source = src;
      const { fit: doFit, spawnCells, ...rest } = o;
      structureOpts = rest;
      spawnWorld = spawnCells === undefined ? undefined : [...spawnCells];
      const light = updateLight(src);
      updateSpawnSet();
      const s = rebuildMesh(light);
      uploadHighlight();
      if (doFit ?? first) fit();
      return s;
    },
    setCutaway(maxY) {
      const { maxY: _old, ...rest } = structureOpts;
      structureOpts = maxY === undefined ? rest : { ...rest, maxY };
      return source === undefined ? undefined : rebuildMesh({ ms: 0, reused: true });
    },
    setSpawnCells(cells) {
      spawnWorld = cells === undefined ? undefined : [...cells];
      updateSpawnSet();
      return source === undefined ? undefined : rebuildMesh({ ms: 0, reused: true });
    },
    setHighlight(box) {
      highlight = box;
      uploadHighlight();
      requestRender();
    },
    setProjection(p) {
      projection = p;
      proj = projectionMatrix(projection, aspect());
      requestRender();
    },
    renderNow() {
      if (!disposed) drawNow(performance.now());
    },
    setLook(l) {
      look = l;
      requestRender();
    },
    setLighting(p) {
      const smoothChanged = p.smooth !== undefined && p.smooth !== lighting.smooth;
      lighting = { ...lighting, ...p };
      if (smoothChanged && source !== undefined) rebuildMesh({ ms: 0, reused: true });
      else requestRender();
    },
    getOrbit: () => orbit,
    setOrbit(o) {
      orbit = o;
      requestRender();
    },
    fit,
    setGrid(on) {
      grid = on;
      requestRender();
    },
    requestRender,
    measureFrames,
    dispose() {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      detach();
      for (const m of [opaqueMesh, transparentMesh]) {
        gl.deleteVertexArray(m.vao);
        gl.deleteBuffer(m.vbo);
        gl.deleteBuffer(m.ibo);
      }
      gl.deleteVertexArray(lineVao);
      gl.deleteBuffer(lineVbo);
      gl.deleteVertexArray(hlVao);
      gl.deleteBuffer(hlVbo);
      gl.deleteTexture(atlas);
      gl.deleteProgram(blockProgram);
      gl.deleteProgram(lineProgram);
      presentation?.dispose();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
  return renderer;
}
