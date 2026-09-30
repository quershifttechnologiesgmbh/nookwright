/**
 * 3D-Ansicht „Texturen“: ein Voxel-Volumen mit echten Blockmodellen, Texturatlas und Minecraft-Licht
 * (@mcda/viewer `createLitRenderer`, WebGL2: Block- und Himmelslicht, weiches Licht + AO, Lightmap je Tageszeit).
 * Lichtregeln aus @mcda/materialize (lightRules.ts) → dasselbe Blocklicht wie Licht-Pass und Spawn-Report.
 * Ohne WebGL2: unbeleuchteter Renderer (`createBlockRenderer`).
 *
 * Generisch über `ViewerScene` (Quelle, Schnitt, Spawn-Stellen, Herkunft je Block): Die Arbeitsfläche füttert das
 * materialisierte Projekt, die Dev-Galerie Testszenen – dieselbe Komponente, keine zweite Implementierung.
 *
 * Neubau nur, wenn sich Quelle oder Spawn-Stellen ändern; ein reiner Schnitt-Wechsel baut nur Geometrie
 * (`setCutaway`), Licht-Regler, Raster und Auswahlrahmen sind Uniforms bzw. Linien, die Kamera ändert nichts.
 * Per `React.lazy` geladen – deepslate ist nicht im Haupt-Chunk. Je Renderer ein eigenes Canvas: `dispose()` gibt den
 * WebGL-Kontext frei (StrictMode, Wechsel von Assets/Version). Bedienung: links drehen, rechts verschieben, Rad zoomen,
 * Doppelklick = einpassen, Klick ohne Ziehen = auswählen.
 */
import type { Vec3 } from '@mcda/core';
import type { PlatformView } from '@mcda/materialize';
import { attachFurnitureDrag, type FurnitureDrag } from '../editor/furnitureDrag.js';
import {
  DAY_TIME, clockOf, createBlockRenderer, createLitRenderer, fitOrbit, orbitRay, raycastGrid, toNdc, type BlockInfo, type BlockRenderer, type FrameStats,
  type LitBlockRenderer, type RenderStats, type VoxelSource,
} from '@mcda/viewer';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SURFACE } from '../colors.js';
import type { CellBox } from '../selection.js';
import { toViewerResources, type TextureAssets } from '../textures/assets.js';
import { materializeLightRules } from '../textures/lightRules.js';
import type { PreviewLighting } from '../ui/viewModel.js';
import { isClick, type FitBox, type PointerSample, type ViewportApi } from './viewport.js';

export interface ViewerScene {
  readonly source: VoxelSource;
  /** Schnitt (Welt-y, inklusive); `undefined` = alles */
  readonly maxY: number | undefined;
  /** Spawn-Stellen (Weltkoordinaten, Spawn-Report); `undefined` = Schätzung des Renderers */
  readonly spawnCells?: readonly Vec3[] | undefined;
  /** Hinweis unten links, z. B. wenn das Licht dieser Ansicht vom Spiel abweicht */
  readonly note?: string | undefined;
  /** Herkunft des sichtbaren Blocks an einer Weltposition (Auswahl per Klick); ohne: nicht klickbar */
  readonly ownerAt?: ((pos: Vec3) => string | undefined) | undefined;
  /** Wechselt der Wert (z. B. neues Projekt), passt die Kamera sich an; sonst bleibt sie, wo der Nutzer sie hat */
  readonly fitKey?: unknown;
  /** Einpassen auf diesen Quader (Weltkoordinaten; W2-ED U3: das Haus statt des ganzen Volumens mit Gelände) */
  readonly fitBox?: FitBox | undefined;
}

/** Kamera auf einen Weltquader: `fitOrbit` für seine Größe, Ziel in Strukturkoordinaten der Quelle verschoben. */
function fitRendererTo(r: BlockRenderer, source: VoxelSource, box: FitBox, aspect: number): void {
  const size: Vec3 = [box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1];
  const o = fitOrbit(size, aspect);
  const off = [box.min[0] - source.origin[0], box.min[1] - source.origin[1], box.min[2] - source.origin[2]] as const;
  const keep = r.getOrbit();
  r.setOrbit({ ...o, yaw: box.look?.yaw ?? keep.yaw, pitch: box.look?.pitch ?? keep.pitch, target: [o.target[0] + off[0], o.target[1] + off[1], o.target[2] + off[2]] });
}

export interface TextureViewerProps {
  readonly assets: TextureAssets;
  readonly blockInfo: ((name: string) => BlockInfo | undefined) | undefined;
  /** Plattform-Daten der Zielversion (Lichtregeln); ohne: Renderer wartet */
  readonly platform: PlatformView | undefined;
  readonly scene: ViewerScene | undefined;
  readonly lighting: PreviewLighting;
  readonly onLighting: (l: PreviewLighting) => void;
  readonly grid: boolean;
  readonly highlight?: CellBox | undefined;
  readonly onPick?: ((owner: string | undefined) => void) | undefined;
  readonly apiRef?: RefObject<ViewportApi | null> | undefined;
  readonly overlay?: string | undefined;
  /** Licht-Leiste unten zeigen (Standard ja; die Arbeitsfläche blendet sie über „Ansicht ▾“ ein, W2-ED U2). */
  readonly lightBar?: boolean | undefined;
  /** W7-G: gewähltes Möbel mit der Maus ziehen (Greifen nur auf dem Möbel; die Kamera dreht dabei nicht). */
  readonly furnitureDrag?: FurnitureDrag | undefined;
}

/** Hintergrund wie die übrigen Ansichten (`SURFACE.viewer`, Nachtblau), wenn das Licht aus ist. */
const BACKGROUND = [((SURFACE.viewer >> 16) & 255) / 255, ((SURFACE.viewer >> 8) & 255) / 255, (SURFACE.viewer & 255) / 255] as const;

const TIME_PRESETS: ReadonlyArray<{ readonly label: string; readonly ticks: number }> = [
  { label: 'Mittag', ticks: DAY_TIME.noon },
  { label: 'Dämmerung', ticks: 12600 },
  { label: 'Nacht', ticks: DAY_TIME.midnight },
];

/** Zeitraffer: ein Minecraft-Tag (24 000 Ticks) in 40 s. */
const TIMELAPSE_TICKS_PER_MS = 24000 / 40000;

const uniforms = (l: PreviewLighting) => ({ enabled: l.enabled, dayTime: l.dayTime, spawnHighlight: l.spawnHighlight, brightness: l.brightness, smooth: l.smooth, flicker: l.flicker });

export default function TextureViewer(p: TextureViewerProps) {
  const { assets, blockInfo, platform, scene, lighting, grid, highlight } = p;
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<{ r: BlockRenderer; lit: LitBlockRenderer | undefined; canvas: HTMLCanvasElement } | null>(null);
  const lightingRef = useRef(lighting);
  lightingRef.current = lighting;
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const pickRef = useRef(p.onPick);
  pickRef.current = p.onPick;
  const dragRef = useRef(p.furnitureDrag);
  dragRef.current = p.furnitureDrag;
  /** Zuletzt übergebene Quelle + Spawn-Stellen: gleich → nur Schnitt ändern. */
  const shown = useRef<{ source: VoxelSource; spawn: readonly Vec3[] | undefined; maxY: number | undefined; fitKey: unknown; blocks: number } | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [stats, setStats] = useState<RenderStats | undefined>(undefined);
  const [unlit, setUnlit] = useState<string | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const [timelapse, setTimelapse] = useState(false);
  const [lapseTime, setLapseTime] = useState<number | undefined>(undefined);
  const [fps, setFps] = useState<string | undefined>(undefined);
  const rules = useMemo(() => (platform === undefined ? undefined : materializeLightRules(platform)), [platform]);

  // Renderer je Assets/Regeln (neues Canvas, damit ein freigegebener WebGL-Kontext nicht wiederverwendet wird)
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || rules === undefined) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'texture-canvas';
    canvas.tabIndex = -1;
    host.prepend(canvas);
    const resources = toViewerResources(assets, blockInfo);
    let entry: { r: BlockRenderer; lit: LitBlockRenderer | undefined; canvas: HTMLCanvasElement };
    try {
      const lit = createLitRenderer(canvas, resources, { rules, grid: gridRef.current, background: BACKGROUND, lighting: uniforms(lightingRef.current) });
      entry = { r: lit, lit, canvas };
      setUnlit(undefined);
    } catch (e) {
      // Kein WebGL2 → einfacher Renderer ohne Licht (neues Canvas: der Kontexttyp ist pro Canvas fest)
      canvas.remove();
      const plain = document.createElement('canvas');
      plain.className = 'texture-canvas';
      host.prepend(plain);
      try {
        entry = { r: createBlockRenderer(plain, resources, { grid: gridRef.current, background: BACKGROUND }), lit: undefined, canvas: plain };
        setUnlit(`Ohne Licht: ${e instanceof Error ? e.message : String(e)}`);
      } catch (e2) {
        plain.remove();
        setFailure(`Texturvorschau nicht möglich: ${e2 instanceof Error ? e2.message : String(e2)}`);
        return;
      }
    }
    setFailure(undefined);
    rendererRef.current = entry;
    shown.current = undefined;
    const used = entry;
    const aspect = (): number => Math.max(0.1, (hostRef.current?.clientWidth ?? 1) / Math.max(1, hostRef.current?.clientHeight ?? 1));
    if (p.apiRef !== undefined) {
      p.apiRef.current = {
        fit: (box) => {
          const src = shown.current?.source;
          const want = box ?? sceneRef.current?.fitBox;
          if (want !== undefined && src !== undefined) fitRendererTo(used.r, src, want, aspect());
          else used.r.fit();
        },
        // W10 Augenhöhe: 70° wie im Spiel, ohne Shift (die Kamera bleibt waagerecht; Orbit mit Neigung 0)
        eyeLevel: (make) => {
          const src = shown.current?.source;
          if (src === undefined) return;
          const cam = make(aspect(), false);
          const o = src.origin;
          const lx = cam.target[0] - cam.position[0], lz = cam.target[2] - cam.position[2];
          const d = Math.max(4, Math.min(60, Math.hypot(lx, lz)));
          const k = d / (Math.hypot(lx, lz) || 1);
          used.r.setOrbit({
            target: [cam.position[0] + lx * k - o[0], cam.position[1] - o[1], cam.position[2] + lz * k - o[2]],
            yaw: Math.atan2(lx, -lz), pitch: 0, distance: d,
          });
        },
      };
    }

    // Klick ohne Ziehen → Strahl → erste sichtbare Zelle → Herkunft
    let down: PointerSample | undefined;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : undefined;
    };
    /** Sichtstrahl im Raster der Szene (Ursprung 0/0/0 = `source.origin`). */
    const rayOf = (e: PointerEvent) => {
      const r = used.canvas.getBoundingClientRect();
      const [nx, ny] = toNdc(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      return orbitRay(used.r.getOrbit(), nx, ny, r.width / Math.max(1, r.height));
    };
    const ownerOf = (e: PointerEvent): string | undefined => {
      const sc = sceneRef.current;
      if (sc?.ownerAt === undefined) return undefined;
      const o = sc.source.origin;
      const ownerAt = sc.ownerAt;
      let owner: string | undefined;
      raycastGrid(rayOf(e), sc.source.size, (x, y, z) => {
        owner = ownerAt([x + o[0], y + o[1], z + o[2]]);
        return owner !== undefined;
      });
      return owner;
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = undefined;
      const pick = pickRef.current;
      if (start === undefined || e.button !== 0 || pick === undefined || sceneRef.current?.ownerAt === undefined) return;
      if (!isClick(start, { x: e.clientX, y: e.clientY, t: performance.now() })) return;
      pick(ownerOf(e));
    };
    used.canvas.addEventListener('pointerdown', onDown);
    used.canvas.addEventListener('pointerup', onUp);
    // W7-G: Möbel ziehen – Strahl in Weltkoordinaten (Raster + Ursprung der Szene)
    const detachDrag = attachFurnitureDrag(host, {
      canvas: () => used.canvas,
      current: () => dragRef.current,
      pick: ownerOf,
      ray: (e) => {
        const sc = sceneRef.current;
        if (sc === undefined) return undefined;
        const ray = rayOf(e);
        const o = sc.source.origin;
        return { origin: [ray.origin[0] + o[0], ray.origin[1] + o[1], ray.origin[2] + o[2]], dir: ray.dir };
      },
    });
    setGeneration((g) => g + 1);
    return () => {
      detachDrag();
      used.canvas.removeEventListener('pointerdown', onDown);
      used.canvas.removeEventListener('pointerup', onUp);
      if (p.apiRef !== undefined) p.apiRef.current = null;
      used.r.dispose();
      host.querySelectorAll('canvas.texture-canvas').forEach((c) => c.remove());
      rendererRef.current = null;
    };
    // p.apiRef ist ein stabiles Ref-Objekt und gehört nicht in die Abhängigkeiten
  }, [assets, blockInfo, rules]);

  // Szene: Neubau nur bei neuer Quelle/Spawn-Stellen, sonst nur Schnitt
  useEffect(() => {
    const entry = rendererRef.current;
    if (entry === null || scene === undefined) return;
    try {
      const last = shown.current;
      let s: RenderStats | undefined;
      if (last !== undefined && last.source === scene.source && last.spawn === scene.spawnCells) {
        if (last.maxY === scene.maxY) return;
        s = entry.r.setCutaway(scene.maxY);
      } else {
        // Kamera nur einpassen: erstes Bild, vorher leer (erster Raum), anderes Projekt
        const fit = last === undefined || last.blocks === 0 || last.fitKey !== scene.fitKey;
        const opts = { fit, ...(scene.maxY !== undefined ? { maxY: scene.maxY } : {}) };
        s = entry.lit !== undefined
          ? entry.lit.setVolume(scene.source, { ...opts, ...(scene.spawnCells !== undefined ? { spawnCells: scene.spawnCells } : {}) })
          : entry.r.setVolume(scene.source, opts);
        const host = hostRef.current;
        if (fit && scene.fitBox !== undefined && host !== null) fitRendererTo(entry.r, scene.source, scene.fitBox, Math.max(0.1, host.clientWidth / Math.max(1, host.clientHeight)));
      }
      shown.current = { source: scene.source, spawn: scene.spawnCells, maxY: scene.maxY, fitKey: scene.fitKey, blocks: s?.blocks ?? last?.blocks ?? 0 };
      if (s !== undefined) setStats(s);
    } catch (e) {
      setFailure(`Texturvorschau fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [scene, generation]);

  // Licht-Regler: nur Uniforms (während des Zeitraffers treibt die Schleife unten die Tageszeit)
  useEffect(() => {
    if (!timelapse) rendererRef.current?.lit?.setLighting(uniforms(lighting));
  }, [lighting, generation, timelapse]);

  // Raster und Auswahlrahmen: nur Linien
  useEffect(() => {
    rendererRef.current?.r.setGrid(grid);
  }, [grid, generation]);
  useEffect(() => {
    rendererRef.current?.lit?.setHighlight(highlight);
  }, [highlight, generation]);

  // Zeitraffer: eigene Schleife direkt am Renderer (kein React-Zustand je Bild), Anzeige 4×/s, am Ende übernehmen
  useEffect(() => {
    if (!timelapse) return;
    let frame = 0;
    let last = 0;
    let shownAt = 0;
    let time = lightingRef.current.dayTime;
    const step = (now: number) => {
      const dt = last === 0 ? 0 : Math.min(100, now - last);
      last = now;
      time = (time + dt * TIMELAPSE_TICKS_PER_MS) % 24000;
      rendererRef.current?.lit?.setLighting({ ...uniforms(lightingRef.current), enabled: true, dayTime: time });
      if (now - shownAt > 250) {
        shownAt = now;
        setLapseTime(time);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setLapseTime(undefined);
      p.onLighting({ ...lightingRef.current, dayTime: Math.round(time / 50) * 50 });
    };
    // p.onLighting wird nur beim Beenden gebraucht (aktueller Wert über die Ref-Kette des Aufrufers)
  }, [timelapse]);

  const measure = () => {
    const lit = rendererRef.current?.lit;
    if (lit === undefined) return;
    setFps('misst …');
    lit.measureFrames(180).then(
      (f: FrameStats) => setFps(`${f.fps} fps · Zeichnen ⌀ ${f.drawMs} ms, p95 ${f.drawP95Ms} ms`),
      (e: unknown) => setFps(`Messung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`),
    );
  };

  const unknown = stats?.unknownBlocks ?? [];
  const spawnCount = scene?.spawnCells?.length;
  const set = (patch: Partial<PreviewLighting>) => p.onLighting({ ...lighting, ...patch });
  const noLight = unlit !== undefined;
  const dayTime = lapseTime ?? lighting.dayTime;
  return (
    <div className="viewer" ref={hostRef}>
      {failure !== undefined && <div className="viewer-failure">{failure}</div>}
      {p.overlay !== undefined && failure === undefined && (
        <div className="viewer-overlay" role="status" data-busy={p.overlay.endsWith('…')}>
          {p.overlay}
        </div>
      )}
      {failure === undefined && (unknown.length > 0 || unlit !== undefined || scene?.note !== undefined) && (
        <div className="viewer-note" title={unknown.join(', ')}>
          {[unlit, scene?.note, unknown.length > 0 ? `Ohne Blockmodell (${unknown.length}): ${unknown.slice(0, 4).join(', ')}${unknown.length > 4 ? ' …' : ''}` : undefined]
            .filter((x) => x !== undefined)
            .join(' · ')}
        </div>
      )}
      {p.lightBar !== false && (
      <div className="light-bar" role="group" aria-label="Licht">
        <label title="Minecraft-Licht (Block- und Himmelslicht, weiches Licht + AO)">
          <input type="checkbox" checked={lighting.enabled} onChange={(e) => set({ enabled: e.target.checked })} disabled={noLight} /> Licht
        </label>
        <label className="light-time" title="Minecraft-Tageszeit (Ticks) · Taste N: Tag/Nacht">
          <input
            type="range"
            min={0}
            max={24000}
            step={50}
            value={dayTime}
            onChange={(e) => set({ dayTime: Number(e.target.value) })}
            disabled={!lighting.enabled || noLight || timelapse}
            aria-label="Tageszeit"
          />
          <span className="mono">{clockOf(dayTime)}</span>
        </label>
        <span className="light-presets">
          {TIME_PRESETS.map((t) => (
            <button key={t.label} type="button" onClick={() => set({ dayTime: t.ticks })} disabled={!lighting.enabled || noLight || timelapse} className={lighting.dayTime === t.ticks ? 'active' : ''}>
              {t.label}
            </button>
          ))}
        </span>
        <label title="Begehbare Innenflächen mit Blocklicht 0 (Spawn-Report der Materialisierung) rot schraffieren">
          <input type="checkbox" checked={lighting.spawnHighlight} onChange={(e) => set({ spawnHighlight: e.target.checked })} disabled={noLight} /> Spawn-Stellen
          {spawnCount !== undefined ? ` (${spawnCount})` : ''}
        </label>
        <details className="light-more">
          <summary>Mehr</summary>
          <div className="light-more-body">
            <label title="Tageszeit läuft (ein Tag in 40 s, nur Uniforms)">
              <input type="checkbox" checked={timelapse} onChange={(e) => setTimelapse(e.target.checked)} disabled={noLight} /> Zeitraffer
            </label>
            <label title="Helligkeit wie die Spieloption">
              Helligkeit
              <input type="range" min={0} max={100} value={Math.round(lighting.brightness * 100)} onChange={(e) => set({ brightness: Number(e.target.value) / 100 })} disabled={!lighting.enabled || noLight} />
              <span className="mono">{Math.round(lighting.brightness * 100)} %</span>
            </label>
            <label title="Minecraft „Weiches Licht“: Mittelwert je Vertex + Umgebungsverdeckung">
              <input type="checkbox" checked={lighting.smooth} onChange={(e) => set({ smooth: e.target.checked })} disabled={noLight} /> Weiches Licht + AO
            </label>
            <label title="Blocklicht flackert leicht wie im Spiel">
              <input type="checkbox" checked={lighting.flicker} onChange={(e) => set({ flicker: e.target.checked })} disabled={!lighting.enabled || noLight} /> Flackern
            </label>
            <button type="button" onClick={measure} disabled={noLight} title="Kamera einmal im Kreis drehen und Bildrate messen">
              FPS messen
            </button>
            {fps !== undefined && <span className="mono small">{fps}</span>}
          </div>
        </details>
      </div>
      )}
    </div>
  );
}
