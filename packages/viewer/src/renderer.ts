/**
 * Block-Renderer für den Browser: VoxelVolume (echte Blockzustände) → deepslate `StructureRenderer`
 * (WebGL 1) mit Vanilla-Blockmodellen, Orbit-Kamera und Rendern nur bei Bedarf.
 *
 * Bedienung: linke Maustaste drehen, rechte (oder Umschalt + links) verschieben, Rad zoomen,
 * Doppelklick = Ansicht zurücksetzen. Neuaufbau über `setVolume` (ganzes Volumen; bei MVP-Größen
 * wenige Millisekunden) oder `setCutaway` (Schnitthöhe).
 */
import { Identifier, Structure, StructureRenderer } from 'deepslate';
import { fitOrbit, orbitView, panOrbit, rotateOrbit, zoomOrbit, type Orbit } from './camera.js';
import type { AtlasImage, ViewerResources } from './port.js';
import { createDeepslateResources, type DeepslateResources } from './resources.js';
import { toStructure, type StructureOptions, type VoxelSource } from './structure.js';

export interface BlockRendererOptions {
  /** Hintergrund RGB 0..1 */
  readonly background?: readonly [number, number, number];
  /** Kantenlänge der Mesh-Chunks (deepslate; Standard 16) */
  readonly chunkSize?: number;
  /** Bodenraster und Umriss des Volumens zeichnen */
  readonly grid?: boolean;
}

export interface RenderStats {
  readonly blocks: number;
  /** Block-IDs ohne Blockstate in den Ressourcen (werden nicht gezeichnet) */
  readonly unknownBlocks: readonly string[];
  /** Zeit für Struktur + Meshes in ms */
  readonly buildMs: number;
}

export interface SetVolumeOptions extends StructureOptions {
  /** Kamera auf das Volumen einpassen (Standard: nur beim ersten Volumen) */
  readonly fit?: boolean;
}

export interface BlockRenderer {
  readonly resources: DeepslateResources;
  readonly stats: RenderStats;
  setVolume(src: VoxelSource, opts?: SetVolumeOptions): RenderStats;
  /** Schnitthöhe (Welt-y, inklusive) ändern; `undefined` = alles. Baut neu, wenn ein Volumen gesetzt ist. */
  setCutaway(maxY: number | undefined): RenderStats | undefined;
  getOrbit(): Orbit;
  setOrbit(o: Orbit): void;
  /** Kamera auf das aktuelle Volumen einpassen */
  fit(): void;
  setGrid(on: boolean): void;
  requestRender(): void;
  dispose(): void;
}

/** Atlas als echtes ImageData (WebGL `texImage2D` braucht eine TexImageSource). */
export function toImageData(a: AtlasImage): ImageData {
  if (typeof ImageData !== 'undefined' && a instanceof ImageData) return a;
  const data = a.data instanceof Uint8ClampedArray ? a.data : new Uint8ClampedArray(a.data.buffer, a.data.byteOffset, a.data.byteLength);
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, a.width, a.height);
}

const EMPTY_STATS: RenderStats = { blocks: 0, unknownBlocks: [], buildMs: 0 };

export function createBlockRenderer(canvas: HTMLCanvasElement, resources: ViewerResources, opts: BlockRendererOptions = {}): BlockRenderer {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (gl === null) throw new Error('WebGL ist in diesem Browser nicht verfügbar');
  const res = createDeepslateResources({ ...resources, atlas: toImageData(resources.atlas) });
  const renderer = new StructureRenderer(gl, new Structure([1, 1, 1]), res, {
    chunkSize: opts.chunkSize ?? 16,
    useInvisibleBlockBuffer: false,
  });
  const bg = opts.background ?? [0.62, 0.76, 0.9];
  let grid = opts.grid ?? false;
  let source: VoxelSource | undefined;
  let structureOpts: StructureOptions = {};
  let orbit: Orbit = fitOrbit([16, 16, 16]);
  let stats = EMPTY_STATS;
  let frame = 0;
  let disposed = false;

  const aspect = (): number => (canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1);

  const draw = (): void => {
    frame = 0;
    if (disposed) return;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const view = orbitView(orbit);
    if (grid) renderer.drawGrid(view);
    renderer.drawStructure(view);
  };
  const requestRender = (): void => {
    if (frame === 0 && !disposed) frame = requestAnimationFrame(draw);
  };

  const rebuild = (): RenderStats => {
    if (source === undefined) return stats;
    const t0 = performance.now();
    const result = toStructure(source, structureOpts);
    renderer.setStructure(result.structure);
    const unknownBlocks = result.blockIds.filter((id) => !res.hasBlock(Identifier.parse(id)));
    stats = { blocks: result.blocks, unknownBlocks, buildMs: Math.round(performance.now() - t0) };
    requestRender();
    return stats;
  };

  const fit = (): void => {
    if (source !== undefined) orbit = fitOrbit(source.size, aspect());
    requestRender();
  };

  // ---------------------------------------------------------------------------------- Bedienung
  let drag: { id: number; x: number; y: number; pan: boolean } | undefined;
  const onDown = (e: PointerEvent): void => {
    if (drag !== undefined) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent): void => {
    if (drag === undefined || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const h = Math.max(1, canvas.clientHeight);
    orbit = drag.pan ? panOrbit(orbit, dx / h, dy / h) : rotateOrbit(orbit, (dx / h) * Math.PI, (dy / h) * Math.PI);
    requestRender();
  };
  const onUp = (e: PointerEvent): void => {
    if (drag === undefined || e.pointerId !== drag.id) return;
    drag = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    orbit = zoomOrbit(orbit, Math.exp(dy * 0.0015));
    requestRender();
  };
  const onContext = (e: Event): void => e.preventDefault();
  const onDbl = (): void => fit();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('dblclick', onDbl);
  canvas.style.touchAction = 'none';

  const resize = (): void => {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    renderer.setViewport(0, 0, w, h);
    requestRender();
  };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
  observer?.observe(canvas);
  resize();

  return {
    resources: res,
    get stats() {
      return stats;
    },
    setVolume(src, o = {}) {
      const first = source === undefined;
      source = src;
      const { fit: doFit, ...rest } = o;
      structureOpts = rest;
      const s = rebuild();
      if (doFit ?? first) fit();
      return s;
    },
    setCutaway(maxY) {
      const { maxY: _old, ...rest } = structureOpts;
      structureOpts = maxY === undefined ? rest : { ...rest, maxY };
      return source === undefined ? undefined : rebuild();
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
    dispose() {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('dblclick', onDbl);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
