/**
 * Präsentations-Look (W10) für den beleuchteten Renderer: Bilder wie mit einem Shader-Pack (BSL/Complementary) –
 * Sonne mit weichen Schatten (Shadow-Map, PCF mit fester Poisson-Scheibe: kein Rauschen, keine Zeit, deterministisch),
 * Himmels- und Bodenlicht (Hemisphäre) mal Minecraft-Himmelslicht und AO je Vertex, warmes Blocklicht, Dunst mit
 * Luftperspektive, ACES-Tonwertkurve und Farbabstimmung (Split-Toning, Vignette), Himmelsverlauf mit Sonnenhof und ein
 * Boden bis zum Horizont.
 *
 * Nur zusätzlich: Ohne `setLook` zeichnet der Renderer wie bisher (Standbilder der Goldenen Galerie bleiben bitgleich).
 * Die Programme entstehen erst beim ersten Einschalten.
 */
import type { Vec3 } from './port.js';
import { LIT_OFFSETS, LIT_VERTEX_FLOATS } from './lit-mesh.js';

export interface PresentationLook {
  /** Richtung zur Sonne (Welt, wird normiert) */
  readonly sunDir: Vec3;
  /** 'tag' (Standard) oder 'abend' (tiefe, warme Sonne, Laternen glühen) */
  readonly mood?: 'tag' | 'abend';
  /** Bodenebene (Strukturkoordinaten, Oberkante) bis zum Horizont; ohne: keine */
  readonly groundY?: number;
  /** Abstand, ab dem der Dunst beginnt (Blöcke); Standard: Abstand der Kamera zum Ziel */
  readonly hazeFrom?: number;
}

export interface MoodColors {
  readonly sun: Vec3;
  readonly sky: Vec3;
  readonly ground: Vec3;
  readonly block: Vec3;
  readonly zenith: Vec3;
  readonly horizon: Vec3;
  readonly glow: Vec3;
  readonly land: Vec3;
  readonly exposure: number;
}

/** Farben linear (außer zenith/horizon/glow: Anzeige-Werte für den Himmel). */
export const MOODS: Readonly<Record<'tag' | 'abend', MoodColors>> = {
  tag: {
    sun: [2.2, 1.95, 1.6], sky: [0.3, 0.37, 0.5], ground: [0.17, 0.14, 0.1], block: [0.8, 0.5, 0.24],
    zenith: [0.25, 0.44, 0.74], horizon: [0.83, 0.88, 0.92], glow: [1.0, 0.94, 0.82], land: [0.1, 0.24, 0.05], exposure: 0.95,
  },
  abend: {
    sun: [2.6, 1.35, 0.55], sky: [0.2, 0.22, 0.34], ground: [0.14, 0.09, 0.06], block: [1.6, 0.95, 0.42],
    zenith: [0.2, 0.3, 0.56], horizon: [0.95, 0.72, 0.54], glow: [1.0, 0.66, 0.38], land: [0.07, 0.15, 0.04], exposure: 1.1,
  },
};

const BLOCK_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aTexLimit;
layout(location = 3) in vec3 aTint;
layout(location = 4) in vec4 aLight;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vPos;
out vec2 vUv;
out vec4 vTexLimit;
out vec3 vTint;
out vec4 vLight;
void main() {
  gl_Position = uProj * uView * vec4(aPos, 1.0);
  vPos = aPos; vUv = aUv; vTexLimit = aTexLimit; vTint = aTint; vLight = aLight;
}
`;

const COMMON_FS = `
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 grade(vec3 c, vec2 frag, vec2 size) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.1);
  c += vec3(-0.012, 0.0, 0.03) * (1.0 - smoothstep(0.0, 0.45, l)) + vec3(0.03, 0.012, -0.02) * smoothstep(0.45, 1.0, l);
  vec2 q = frag / size - 0.5;
  c *= 1.0 - dot(q, q) * 0.42;
  return clamp(c, 0.0, 1.0);
}
`;

const BLOCK_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPos;
in vec2 vUv;
in vec4 vTexLimit;
in vec3 vTint;
in vec4 vLight;
uniform sampler2D uAtlas;
uniform sampler2DShadow uShadow;
uniform float uPixelSize;
uniform mat4 uLightMat;
uniform vec2 uShadowTexel;
uniform vec3 uSunDir, uSunColor, uSkyColor, uGroundColor, uBlockColor, uFogColor, uCam, uFlatColor;
uniform float uFogNear, uFogFar, uExposure, uFlat;
uniform vec2 uViewport;
out vec4 outColor;
${COMMON_FS}
const vec2 DISK[12] = vec2[](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064),
  vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
float shadowAt(vec3 p, vec3 n) {
  vec4 s = uLightMat * vec4(p + n * 0.06, 1.0);
  vec3 c = s.xyz / s.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float sum = 0.0;
  for (int i = 0; i < 12; i++) sum += texture(uShadow, vec3(c.xy + DISK[i] * uShadowTexel * 2.2, c.z - 0.0007));
  return sum / 12.0;
}
void main() {
  vec4 tex;
  vec3 albedo;
  vec4 light = vLight;
  if (uFlat > 0.5) {
    tex = vec4(1.0);
    albedo = uFlatColor;
    light = vec4(0.0, 15.0, 1.0, 1.0);
  } else {
    vec2 lo = vTexLimit.xy + vec2(0.5 * uPixelSize);
    vec2 hi = vTexLimit.zw - vec2(0.5 * uPixelSize);
    tex = texture(uAtlas, clamp(vUv, lo, hi));
    if (tex.a < 0.01) discard;
    albedo = pow(tex.rgb * vTint, vec3(2.2));
  }
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (dot(n, uCam - vPos) < 0.0) n = -n;
  float sky = light.y / 15.0, blk = light.x / 15.0, ao = light.z;
  float ndl = max(dot(n, uSunDir), 0.0);
  float sh = ndl > 0.0 ? shadowAt(vPos, n) : 0.0;
  vec3 hemi = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
  vec3 amb = hemi * (0.18 + 0.82 * sky * sky) * ao;
  vec3 direct = uSunColor * ndl * sh * mix(0.35, 1.0, ao);
  vec3 bl = uBlockColor * pow(blk, 2.4) * mix(0.6, 1.0, ao);
  vec3 col = albedo * (amb + direct + bl);
  float d = length(vPos - uCam);
  float f = clamp((d - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, f * f * (3.0 - 2.0 * f) * 0.9);
  vec3 outc = pow(aces(col * uExposure), vec3(1.0 / 2.2));
  outColor = vec4(grade(outc, gl_FragCoord.xy, uViewport), tex.a);
}
`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec2 vUv;
in vec4 vTexLimit;
in vec3 vTint;
in vec4 vLight;
uniform sampler2D uAtlas;
uniform float uPixelSize;
uniform float uFlat;
out vec4 outColor;
void main() {
  if (uFlat < 0.5) {
    vec2 lo = vTexLimit.xy + vec2(0.5 * uPixelSize);
    vec2 hi = vTexLimit.zw - vec2(0.5 * uPixelSize);
    if (texture(uAtlas, clamp(vUv, lo, hi)).a < 0.5) discard;
  }
  outColor = vec4(1.0);
}
`;

const SKY_VS = `#version 300 es
const vec2 P[3] = vec2[](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vNdc;
void main() { vNdc = P[gl_VertexID]; gl_Position = vec4(P[gl_VertexID], 0.999, 1.0); }
`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uZenith, uHorizon, uGlow, uSunDir;
uniform vec2 uViewport;
out vec4 outColor;
${COMMON_FS}
void main() {
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float h = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.75, h), 0.7));
  float s = max(dot(d, uSunDir), 0.0);
  c += uGlow * (pow(s, 8.0) * 0.3 + pow(s, 64.0) * 0.5) * (1.0 - smoothstep(0.0, 0.6, h) * 0.5);
  outColor = vec4(grade(c, gl_FragCoord.xy, uViewport), 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Präsentations-Shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Präsentations-Programm: ${gl.getProgramInfoLog(p)}`);
  return p;
}

// ------------------------------------------------------------------------------------------ Mathe (rein)

type M4 = Float32Array;

export function multiply(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

export function invert(m: M4): M4 {
  const inv = new Float32Array(16);
  const a = Array.from(m);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  const id = det === 0 ? 0 : 1 / det;
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * id; inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * id;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * id; inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * id;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * id; inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * id;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * id; inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * id;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * id; inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * id;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * id; inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * id;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * id; inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * id;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * id; inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * id;
  return inv;
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Licht-Matrix (Parallelprojektion entlang der Sonne) um eine Kugel (Mitte, Radius). */
export function lightMatrix(sunDir: Vec3, center: Vec3, radius: number): M4 {
  const f = norm(sunDir);
  const up: Vec3 = Math.abs(f[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const r = norm([up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]]);
  const u: Vec3 = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const eye: Vec3 = [center[0] + f[0] * radius * 2, center[1] + f[1] * radius * 2, center[2] + f[2] * radius * 2];
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view = new Float32Array([r[0], u[0], f[0], 0, r[1], u[1], f[1], 0, r[2], u[2], f[2], 0, -dot(r, eye), -dot(u, eye), -dot(f, eye), 1]);
  const near = radius * 0.5, far = radius * 3.5, h = radius * 1.02;
  const proj = new Float32Array(16);
  proj[0] = 1 / h; proj[5] = 1 / h; proj[10] = -2 / (far - near); proj[14] = -(far + near) / (far - near); proj[15] = 1;
  return multiply(proj, view);
}

// ------------------------------------------------------------------------------------------ Zeichnen

export interface PresentationDraw {
  readonly view: M4;
  readonly proj: M4;
  readonly eye: Vec3;
  /** Abstand Kamera → Ziel (Dunst) */
  readonly distance: number;
  /** Volumen (Strukturkoordinaten 0 … size) */
  readonly size: Vec3;
  readonly meshes: ReadonlyArray<{ vao: WebGLVertexArrayObject; count: number }>;
  readonly atlas: WebGLTexture;
  readonly pixelSize: number;
  readonly width: number;
  readonly height: number;
}

export interface PresentationPass {
  draw(look: PresentationLook, d: PresentationDraw): void;
  dispose(): void;
}

const SHADOW_SIZE = 4096;

export function createPresentationPass(gl: WebGL2RenderingContext): PresentationPass {
  const block = compile(gl, BLOCK_VS, BLOCK_FS);
  const shadow = compile(gl, BLOCK_VS, SHADOW_FS);
  const sky = compile(gl, SKY_VS, SKY_FS);
  const loc = (p: WebGLProgram) => (n: string): WebGLUniformLocation | null => gl.getUniformLocation(p, n);
  const B = loc(block), S = loc(shadow), K = loc(sky);
  const depth = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, depth);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const skyVao = gl.createVertexArray()!;
  // Bodenebene: großes Quadrat, nur Position (übrige Attribute konstant)
  const planeVao = gl.createVertexArray()!;
  const planeVbo = gl.createBuffer()!;
  let planeY = Number.NaN;
  const setPlane = (y: number, size: Vec3): void => {
    if (y === planeY) return;
    planeY = y;
    const cx = size[0] / 2, cz = size[2] / 2, R = 3000;
    const v = new Float32Array(6 * LIT_VERTEX_FLOATS);
    const corners = [[-R, -R], [R, R], [R, -R], [-R, -R], [-R, R], [R, R]] as const;
    corners.forEach(([x, z], i) => {
      const o = i * LIT_VERTEX_FLOATS;
      v[o + LIT_OFFSETS.pos] = cx + x; v[o + LIT_OFFSETS.pos + 1] = y; v[o + LIT_OFFSETS.pos + 2] = cz + z;
      v[o + LIT_OFFSETS.light] = 0; v[o + LIT_OFFSETS.light + 1] = 15; v[o + LIT_OFFSETS.light + 2] = 1; v[o + LIT_OFFSETS.light + 3] = 1;
    });
    gl.bindVertexArray(planeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, planeVbo);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    const stride = LIT_VERTEX_FLOATS * 4;
    const attr = (l: number, n: number, off: number): void => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, stride, off * 4); };
    attr(0, 3, LIT_OFFSETS.pos); attr(1, 2, LIT_OFFSETS.uv); attr(2, 4, LIT_OFFSETS.texLimit); attr(3, 3, LIT_OFFSETS.tint); attr(4, 4, LIT_OFFSETS.light);
    gl.bindVertexArray(null);
  };

  return {
    draw(look, d) {
      const mood = MOODS[look.mood ?? 'tag'];
      const sunDir = norm(look.sunDir);
      const center: Vec3 = [d.size[0] / 2, d.size[1] / 2, d.size[2] / 2];
      const radius = Math.max(4, 0.5 * Math.hypot(d.size[0], d.size[1], d.size[2]));
      const lm = lightMatrix(sunDir, center, radius);
      const hasPlane = look.groundY !== undefined;
      if (hasPlane) setPlane(look.groundY!, d.size);

      // 1) Schatten
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE); // dünne Teile (Zäune, Scheiben, Pflanzen) werfen beidseitig Schatten
      gl.useProgram(shadow);
      gl.uniformMatrix4fv(S('uView'), false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
      gl.uniformMatrix4fv(S('uProj'), false, lm);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, d.atlas);
      gl.uniform1i(S('uAtlas'), 0);
      gl.uniform1f(S('uPixelSize'), d.pixelSize);
      gl.uniform1f(S('uFlat'), 0);
      for (const m of d.meshes) {
        if (m.count === 0) continue;
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, d.width, d.height);
      gl.enable(gl.CULL_FACE);

      // 2) Himmel
      gl.clearColor(mood.horizon[0], mood.horizon[1], mood.horizon[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(sky);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(K('uInvViewProj'), false, invert(multiply(d.proj, d.view)));
      gl.uniform3fv(K('uZenith'), mood.zenith);
      gl.uniform3fv(K('uHorizon'), mood.horizon);
      gl.uniform3fv(K('uGlow'), mood.glow);
      gl.uniform3fv(K('uSunDir'), sunDir);
      gl.uniform2f(K('uViewport'), d.width, d.height);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);

      // 3) Blöcke und Boden
      gl.useProgram(block);
      gl.uniformMatrix4fv(B('uView'), false, d.view);
      gl.uniformMatrix4fv(B('uProj'), false, d.proj);
      gl.uniformMatrix4fv(B('uLightMat'), false, lm);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, d.atlas);
      gl.uniform1i(B('uAtlas'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.uniform1i(B('uShadow'), 1);
      gl.uniform1f(B('uPixelSize'), d.pixelSize);
      gl.uniform2f(B('uShadowTexel'), 1 / SHADOW_SIZE, 1 / SHADOW_SIZE);
      gl.uniform3fv(B('uSunDir'), sunDir);
      gl.uniform3fv(B('uSunColor'), mood.sun);
      gl.uniform3fv(B('uSkyColor'), mood.sky);
      gl.uniform3fv(B('uGroundColor'), mood.ground);
      gl.uniform3fv(B('uBlockColor'), mood.block);
      // Dunstfarbe = Horizont (Anzeige-Wert → linear, damit er nach der Tonwertkurve wieder passt)
      gl.uniform3fv(B('uFogColor'), mood.horizon.map((c) => Math.pow(c, 2.2) * 0.9) as unknown as Vec3);
      gl.uniform3fv(B('uCam'), d.eye);
      gl.uniform1f(B('uFogNear'), (look.hazeFrom ?? d.distance) * 0.75);
      gl.uniform1f(B('uFogFar'), (look.hazeFrom ?? d.distance) * 7 + 120);
      gl.uniform1f(B('uExposure'), mood.exposure);
      gl.uniform2f(B('uViewport'), d.width, d.height);
      if (hasPlane) {
        gl.uniform1f(B('uFlat'), 1);
        gl.uniform3fv(B('uFlatColor'), mood.land);
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(planeVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.enable(gl.CULL_FACE);
      }
      gl.uniform1f(B('uFlat'), 0);
      for (const m of d.meshes) {
        if (m.count === 0) continue;
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteProgram(block); gl.deleteProgram(shadow); gl.deleteProgram(sky);
      gl.deleteTexture(depth); gl.deleteFramebuffer(fbo);
      gl.deleteVertexArray(skyVao); gl.deleteVertexArray(planeVao); gl.deleteBuffer(planeVbo);
    },
  };
}
