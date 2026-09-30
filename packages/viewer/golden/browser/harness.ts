/**
 * Goldene Galerie (P0-A), Browser-Seite: rendert Szenen mit dem beleuchteten Renderer der Vorschau
 * (`createLitRenderer`, echte Blockmodelle und Atlas aus `local/mc-assets`) und schickt die Bilder per PUT an den
 * Node-Server des Laufs. Wird von run.ts mit esbuild gebündelt und in Chromium (Playwright) geladen.
 *
 * Kein Zufall, keine Uhr im Bild: Tageszeit, Helligkeit und Kameras kommen aus der Szene.
 */
import { createLitRenderer, FACE_BIT, type LightBlockState, type LightFace, type LightRules, type LitBlockRenderer, type VoxelSource } from '../../src/index.js';
import type { AtlasIndex, BlockFlags } from '../../src/assets/extract.js';
import type { ScenePayload, VariantPayload, ViewPayload } from '../lib/payload.js';

interface AssetMeta {
  readonly version: string;
  readonly width: number;
  readonly height: number;
  readonly atlasIndex: AtlasIndex;
  readonly blockstates: Record<string, unknown>;
  readonly models: Record<string, unknown>;
  readonly blockFlags: Record<string, BlockFlags>;
}

export interface ViewResult {
  readonly view: string;
  readonly ms: number;
}

export interface SceneResult {
  readonly id: string;
  readonly views: ViewResult[];
  readonly variants: Array<{ key: string; blocks: number; buildMs: number; lightMs: number; quads: number; unknownBlocks: readonly string[]; meshErrors: readonly string[] }>;
  readonly ms: number;
}

type Row = readonly [number, number, number, number, number];
const ZERO: Row = [0, 0, 0, 0, 0];

const stateKey = (s: LightBlockState): string => {
  const keys = Object.keys(s.properties).sort();
  return keys.length === 0 ? s.name : `${s.name}[${keys.map((k) => `${k}=${s.properties[k]}`).join(',')}]`;
};

const rows = new Map<string, Row>();
const info = new Map<string, { properties: Record<string, readonly string[]>; default: Record<string, string> }>();
const row = (s: LightBlockState): Row => rows.get(stateKey(s)) ?? ZERO;
const rules: LightRules = {
  emission: (s) => row(s)[0],
  opaque: (s) => row(s)[1] === 1,
  blocksFace: (s, f: LightFace) => (row(s)[2] & FACE_BIT[f]) !== 0,
  attenuation: (s) => row(s)[3],
  occludesAo: (s) => row(s)[4] === 1,
};

let renderer: LitBlockRenderer | undefined;
let canvas: HTMLCanvasElement | undefined;
let thumbCanvas: HTMLCanvasElement | undefined;

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function init(width: number, height: number, thumbWidth: number): Promise<string> {
  const meta = await json<AssetMeta>('/assets/meta.json');
  const raw = new Uint8Array(await (await fetch('/assets/atlas.rgba')).arrayBuffer());
  canvas = document.createElement('canvas');
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.display = 'block';
  document.body.append(canvas);
  // Zeichenpuffer behalten: Bilder werden nach renderNow() gelesen
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (gl === null) throw new Error('WebGL2 fehlt');
  renderer = createLitRenderer(canvas, {
    version: meta.version,
    atlas: { width: meta.width, height: meta.height, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength) },
    atlasIndex: meta.atlasIndex,
    blockstates: meta.blockstates,
    models: meta.models,
    blockFlags: meta.blockFlags,
    blockInfo: (name) => info.get(name),
  }, { rules, grid: false, lighting: { enabled: true, dayTime: 6000, brightness: 0.5, smooth: true, flicker: false, spawnHighlight: false } });
  thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbWidth;
  thumbCanvas.height = Math.round((thumbWidth * height) / width);
  const info2 = gl.getExtension('WEBGL_debug_renderer_info');
  return info2 === null ? String(gl.getParameter(gl.RENDERER)) : String(gl.getParameter(info2.UNMASKED_RENDERER_WEBGL));
}

function sourceOf(scene: ScenePayload, v: VariantPayload): VoxelSource {
  const [x0, y0, z0] = v.box.min;
  const [x1, y1, z1] = v.box.max;
  const states = scene.palette;
  const cells = scene.cells;
  return {
    origin: [x0, y0, z0],
    size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1],
    *cells() {
      for (let i = 0; i < cells.length; i += 4) {
        const x = cells[i]!, y = cells[i + 1]!, z = cells[i + 2]!;
        if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue;
        yield { pos: [x, y, z] as const, state: states[cells[i + 3]!]! };
      }
    },
    entities() {
      return scene.frames
        .filter(([x, y, z]) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1)
        .map(([x, y, z, kind, facing]) => ({
          blockPos: [x, y, z] as const,
          nbt: { type: 'compound', value: { id: { type: 'string', value: `minecraft:${kind}` }, Facing: { type: 'byte', value: facing } } },
        }));
    },
  };
}

function blob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob((b) => (b === null ? fail(new Error('toBlob leer')) : ok(b)), type, quality));
}

async function put(path: string, body: Blob): Promise<void> {
  const r = await fetch(path, { method: 'PUT', body });
  if (!r.ok) throw new Error(`PUT ${path}: HTTP ${r.status}`);
}

async function renderScene(id: string): Promise<SceneResult> {
  if (renderer === undefined || canvas === undefined || thumbCanvas === undefined) throw new Error('init fehlt');
  const t0 = performance.now();
  const scene = await json<ScenePayload>(`/scene/${encodeURIComponent(id)}.json`);
  scene.palette.forEach((s, i) => rows.set(stateKey(s), scene.light[i] ?? ZERO));
  for (const [name, bi] of Object.entries(scene.blockInfo)) info.set(name, bi);
  renderer.setLighting({ dayTime: scene.lighting.dayTime, brightness: scene.lighting.brightness });
  const views: ViewResult[] = [];
  const variants: SceneResult['variants'] = [];
  const uploads: Promise<void>[] = [];
  const tctx = thumbCanvas.getContext('2d')!;
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'high';
  for (const v of scene.variants) {
    const mine = scene.views.filter((w: ViewPayload) => w.variant === v.key);
    if (mine.length === 0) continue;
    const s = renderer.setVolume(sourceOf(scene, v), { fit: false });
    variants.push({ key: v.key, blocks: s.blocks, buildMs: s.buildMs, lightMs: s.lightMs, quads: s.quads, unknownBlocks: s.unknownBlocks, meshErrors: s.meshErrors.slice(0, 20) });
    for (const w of mine) {
      const t1 = performance.now();
      const o = v.box.min;
      renderer.setProjection(w.projection);
      renderer.setOrbit({ ...w.orbit, target: [w.orbit.target[0] - o[0], w.orbit.target[1] - o[1], w.orbit.target[2] - o[2]] });
      // W10: Präsentations-Look nur für Ansichten, die ihn tragen (alle anderen bitgleich wie bisher)
      renderer.setLook(w.look === undefined ? undefined : { sunDir: w.look.sunDir, mood: w.look.mood, groundY: w.look.groundY - o[1], hazeFrom: w.look.hazeFrom });
      renderer.renderNow();
      const png = await blob(canvas, 'image/png');
      tctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const jpg = await blob(thumbCanvas, 'image/jpeg', 0.85);
      uploads.push(put(`/out/${encodeURIComponent(id)}/${w.name}.png`, png), put(`/out/${encodeURIComponent(id)}/thumb/${w.name}.jpg`, jpg));
      views.push({ view: w.name, ms: Math.round(performance.now() - t1) });
    }
  }
  await Promise.all(uploads);
  return { id, views, variants, ms: Math.round(performance.now() - t0) };
}

declare global {
  interface Window {
    golden: { ready: boolean; init: typeof init; renderScene: typeof renderScene };
  }
}

window.golden = { ready: true, init, renderScene };
