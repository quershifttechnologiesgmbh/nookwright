import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SURFACE } from '../colors.js';
import type { CellBox } from '../selection.js';
import { buildPixelAtlas, type PixelAtlas, type TileFace } from '../pixelTextures.js';
import { GRID } from '../usecases.js';
import { attachFurnitureDrag, type FurnitureDrag } from '../editor/furnitureDrag.js';
import { fitView, isClick, lookDirection, type FitBox, type ViewportApi } from './viewport.js';
import type { EyeCamera } from './eyeLevel.js';
import { LAYERS, layerVisible, type PreviewVoxel, type ViewMode, type VoxelLayer } from './voxels.js';

interface Ctx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly meshes: Map<VoxelLayer, { mesh: THREE.InstancedMesh; voxels: PreviewVoxel[] }>;
  readonly materials: Readonly<Record<VoxelLayer, THREE.Material>>;
  readonly geometry: THREE.BoxGeometry;
  readonly gridLines: THREE.LineSegments;
  readonly highlight: THREE.LineSegments;
  readonly render: () => void;
}

interface Props {
  readonly voxels: readonly PreviewVoxel[];
  readonly view: ViewMode;
  /** Hinweis über der Szene (z. B. „Blöcke werden berechnet …“); die letzte Szene bleibt sichtbar. */
  readonly overlay?: string | undefined;
  readonly grid?: boolean;
  /** Auswahlrahmen (Weltkoordinaten), immer sichtbar */
  readonly highlight?: CellBox | undefined;
  /** Klick (ohne Ziehen) auf einen Quader → Herkunft (`owner`), ins Leere → `undefined` */
  readonly onPick?: ((owner: string | undefined) => void) | undefined;
  readonly apiRef?: RefObject<ViewportApi | null> | undefined;
  /** Links verdeckte Breite in px (Etagen-Leiste über der Ansicht): Einpassen nutzt nur den Rest. */
  readonly fitInsetLeft?: number | undefined;
  /** Einpassen auf diesen Quader (W2-ED U3: das Haus statt des ganzen Grundstücks); fehlt = alle sichtbaren Quader. */
  readonly fitBox?: FitBox | undefined;
  /** W7-G: gewähltes Möbel mit der Maus ziehen (Greifen nur auf dem Möbel; die Kamera dreht dabei nicht). */
  readonly furnitureDrag?: FurnitureDrag | undefined;
}

/**
 * Texturierte Schicht-Ressourcen der Vorschau „Blöcke“. Geometrien je Datenstand neu (beim Umbau freigegeben); Atlas-
 * Textur nur neu, wenn sich der Atlas ändert. W14: Die zwei Materialien (beleuchtet, Licht) bleiben über Umbauten
 * erhalten – nur die Textur wird getauscht. Vorher entstanden sie je Umbau neu, und three.js übersetzte die Shader
 * jedes Mal neu (das Programm fiel mit dem letzten Material weg): 100–450 ms je Etagenwechsel, Undo, Malen.
 */
interface Textured {
  readonly atlas: PixelAtlas;
  readonly texture: THREE.DataTexture;
  readonly geometries: THREE.BufferGeometry[];
}

/**
 * Pixeltextur je Instanz: Der Shader wählt die Kachel nach Flächennormale (oben/seitlich/unten) und rechnet die
 * Textur-Koordinate aus der Lage im Block – eine Platte zeigt so die halbe Kachel wie im Spiel.
 */
function texturedMaterial(texture: THREE.Texture, light: boolean): THREE.Material {
  const opts = { map: texture, alphaTest: 0.5, side: THREE.DoubleSide };
  const mat = light ? new THREE.MeshBasicMaterial(opts) : new THREE.MeshLambertMaterial(opts);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aTileTop; attribute vec4 aTileSide; attribute vec4 aTileBottom;
        attribute vec3 aBoxMin; attribute vec3 aBoxSize;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 lp = aBoxMin + (position + 0.5) * aBoxSize;
        vec2 tuv; vec4 rect;
        if (abs(normal.y) > 0.5) { tuv = lp.xz; rect = normal.y > 0.0 ? aTileTop : aTileBottom; }
        else if (abs(normal.x) > 0.5) { tuv = vec2(normal.x > 0.0 ? 1.0 - lp.z : lp.z, 1.0 - lp.y); rect = aTileSide; }
        else { tuv = vec2(normal.z > 0.0 ? lp.x : 1.0 - lp.x, 1.0 - lp.y); rect = aTileSide; }
        vMapUv = mix(rect.xy, rect.zw, tuv);`);
  };
  mat.customProgramCacheKey = () => (light ? 'pixel-basic' : 'pixel-lambert');
  return mat;
}

function atlasTexture(atlas: PixelAtlas): THREE.DataTexture {
  const tex = new THREE.DataTexture(atlas.pixels, atlas.size, atlas.size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Instanz-Attribute für `texturedMaterial`: Kachel je Fläche und Teilquader im Block. */
function tileAttributes(geo: THREE.BufferGeometry, list: readonly PreviewVoxel[], atlas: PixelAtlas): void {
  const n = list.length;
  const faces: Record<TileFace, Float32Array> = { top: new Float32Array(n * 4), side: new Float32Array(n * 4), bottom: new Float32Array(n * 4) };
  const min = new Float32Array(n * 3), size = new Float32Array(n * 3);
  list.forEach((v, i) => {
    for (const face of ['top', 'side', 'bottom'] as const) {
      const r = v.block !== undefined ? atlas.rect(v.block, v.color, face) : undefined;
      if (r !== undefined) faces[face].set(r, i * 4);
    }
    for (let k = 0; k < 3; k++) {
      const lo = v.center[k]! - v.size[k]! / 2;
      min[i * 3 + k] = lo - Math.floor(lo + 1e-6);
      size[i * 3 + k] = v.size[k]!;
    }
  });
  geo.setAttribute('aTileTop', new THREE.InstancedBufferAttribute(faces.top, 4));
  geo.setAttribute('aTileSide', new THREE.InstancedBufferAttribute(faces.side, 4));
  geo.setAttribute('aTileBottom', new THREE.InstancedBufferAttribute(faces.bottom, 4));
  geo.setAttribute('aBoxMin', new THREE.InstancedBufferAttribute(min, 3));
  geo.setAttribute('aBoxSize', new THREE.InstancedBufferAttribute(size, 3));
}

const DEFAULT_TARGET = new THREE.Vector3(GRID.width / 2, 1, GRID.depth / 2);
const DEFAULT_EYE = new THREE.Vector3(GRID.width / 2 - 10, 30, GRID.depth + 14);

/**
 * 3D-Vorschau „Rollen“/„Blöcke“: ein InstancedMesh je Schicht (Boden, Wände, Decke, Möbel, Licht), Farbe je Instanz;
 * tragen die Quader Blocknamen („Blöcke“), bekommen sie eigene Pixeltexturen (pixelTextures.ts) statt Flächenfarben.
 * Neu gebaut wird nur, wenn sich `voxels` ändert (also das Projekt); Ansicht, Raster und Auswahlrahmen schalten nur
 * Sichtbarkeiten bzw. Linien. Gerendert wird nur bei Bedarf (Kamera, Größe, neue Daten) – kein Dauer-Loop.
 * Klick ohne Ziehen wählt: Raycast auf die sichtbaren Schichten, Instanz → Herkunft.
 */
function disposeTextured(ref: { current: Textured | null }, keep?: THREE.Texture): void {
  const t = ref.current;
  if (t === null) return;
  if (t.texture !== keep) t.texture.dispose();
  for (const g of t.geometries) g.dispose();
  ref.current = null;
}

/**
 * Pixel-Material je Schicht, einmal je Ansicht angelegt (Shader bleiben übersetzt; alle beleuchteten teilen ein Programm).
 * Eines je Schicht wie vorher: three.js sortiert undurchsichtige Objekte nach Material – dieselbe Reihenfolge, dieselben Pixel.
 */
type PixelMaterials = Readonly<Record<VoxelLayer, THREE.Material & { map: THREE.Texture | null }>>;

export function Viewer3D({ voxels, view, overlay, grid = true, highlight, onPick, apiRef, fitInsetLeft = 0, fitBox, furnitureDrag }: Props) {
  const insetRef = useRef(fitInsetLeft);
  insetRef.current = fitInsetLeft;
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const texturedRef = useRef<Textured | null>(null);
  const pixelMatsRef = useRef<PixelMaterials | null>(null);
  const viewRef = useRef(view);
  /**
   * Automatisch einpassen (Nutzerreview 24.09.2026): Nach dem ersten Raum war das Haus angeschnitten und lag
   * unter dem Etagen-Widget. `manualRef` merkt, ob der Nutzer die Kamera selbst bewegt hat – dann fasst die
   * Automatik nichts mehr an. Der Knopf „Einpassen“ setzt den Merker zurück und nimmt die Automatik wieder auf.
   */
  const manualRef = useRef(false);
  const fittedRef = useRef<string | undefined>(undefined);
  /** Aktuelle `fit`-Funktion der Montage (für die automatische Einpassung). */
  const fitNowRef = useRef<(() => void) | undefined>(undefined);
  const fitBoxRef = useRef<FitBox | undefined>(undefined);
  fitBoxRef.current = fitBox;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const dragRef = useRef(furnitureDrag);
  dragRef.current = furnitureDrag;
  const [failure, setFailure] = useState<string | undefined>(undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (host == null) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      setFailure(`WebGL nicht verfügbar: ${(e as Error).message}`);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SURFACE.viewer);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    camera.position.copy(DEFAULT_EYE);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(DEFAULT_TARGET);
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 4;
    controls.maxDistance = 200;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x3a332c, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-35, 70, 25);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.5);
    fill.position.set(40, 30, -30);
    scene.add(fill);

    // Bodenplatte des Rasters (knapp unter y = 0) + Rasterlinien
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID.width, GRID.depth), new THREE.MeshLambertMaterial({ color: SURFACE.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(GRID.width / 2, -0.01, GRID.depth / 2);
    scene.add(ground);
    const pts: number[] = [];
    for (let x = 0; x <= GRID.width; x++) pts.push(x, 0, 0, x, 0, GRID.depth);
    for (let z = 0; z <= GRID.depth; z++) pts.push(0, 0, z, GRID.width, 0, z);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: SURFACE.gridLine }));
    gridLines.position.y = -0.005;
    scene.add(gridLines);

    // Auswahlrahmen: Kanten eines Einheitswürfels, skaliert; ohne Tiefentest (auch hinter Wänden sichtbar)
    const hlGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const highlightLines = new THREE.LineSegments(hlGeo, new THREE.LineBasicMaterial({ color: 0xffd65a, depthTest: false, transparent: true }));
    highlightLines.renderOrder = 10;
    highlightLines.visible = false;
    scene.add(highlightLines);

    const lit = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const materials: Record<VoxelLayer, THREE.Material> = {
      floor: lit(),
      wall: lit(),
      ceiling: lit(),
      furniture: lit(),
      // Lichtquellen unbeleuchtet in voller Farbe → wirken leuchtend
      light: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    };
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Solange die Kamera automatisch ist, nach Größenänderung neu einpassen (R1-14: nach „Übernehmen“ änderte sich
      // das Layout – Assistent zu, Leerzustand weg – und die Einpassung galt noch für die alte Größe)
      if (!manualRef.current && fittedRef.current !== undefined) fitNowRef.current?.();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const ctx: Ctx = { renderer, scene, camera, controls, meshes: new Map(), materials, geometry, gridLines, highlight: highlightLines, render };
    ctxRef.current = ctx;

    // Kamera einpassen: auf die sichtbaren Quader (sonst das Raster). Die acht Ecken des Quaders müssen horizontal und
    // vertikal ins Bild – enger als die frühere Hüllkugel, die bei flachen, breiten Bauten (Gelände) viel Rand ließ.
    const fit = (want?: FitBox) => {
      const box = new THREE.Box3();
      const goal = want ?? fitBoxRef.current;
      if (goal !== undefined) box.set(new THREE.Vector3(goal.min[0], goal.min[1], goal.min[2]), new THREE.Vector3(goal.max[0] + 1, goal.max[1] + 1, goal.max[2] + 1));
      else for (const { mesh } of ctx.meshes.values()) if (mesh.visible && mesh.boundingSphere !== null) box.union(new THREE.Box3().setFromObject(mesh));
      if (box.isEmpty()) box.setFromCenterAndSize(DEFAULT_TARGET.clone(), new THREE.Vector3(GRID.width, 1, GRID.depth));
      const dir = goal?.look !== undefined ? new THREE.Vector3(...lookDirection(goal.look)) : camera.position.clone().sub(controls.target).normalize();
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      // Etagen-Leiste links: nutzbares Bild ab `left` (Bildkoordinaten −1 … 1), höchstens bis zur Mitte
      const left = Math.min(0, -1 + (2 * insetRef.current) / Math.max(1, host.clientWidth));
      const view = fitView(box.min.toArray(), box.max.toArray(), dir.toArray(), tanV, tanV * camera.aspect, 1.08, left);
      const target = new THREE.Vector3(...view.target);
      controls.target.copy(target);
      camera.position.copy(target.clone().add(dir.multiplyScalar(Math.min(controls.maxDistance, Math.max(controls.minDistance, view.distance)))));
      controls.update();
      render();
    };
    fitNowRef.current = () => fit();
    // Nutzer dreht/zoomt selbst → Automatik aus. `start` feuert nur bei echten Eingaben, nicht bei `update()`.
    // W10 Augenhöhe: Shift über setViewOffset (senkrechte Kanten bleiben senkrecht), längere Brennweite; der erste
    // eigene Dreh/Zoom nimmt beides zurück
    let eye = false;
    const leaveEye = (): void => {
      if (!eye) return;
      eye = false;
      camera.clearViewOffset();
      camera.fov = 40;
      camera.updateProjectionMatrix();
    };
    const eyeLevel = (make: (aspect: number, shift: boolean) => EyeCamera): void => {
      const cam = make(camera.aspect, true);
      manualRef.current = true;
      eye = true;
      camera.fov = cam.fov;
      camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
      const d = Math.hypot(cam.target[0] - cam.position[0], cam.target[2] - cam.position[2]) || 1;
      const k = Math.min(1, 10 / d); // Drehpunkt 10 Blöcke vor dem Auge (innerhalb der Zoom-Grenzen)
      controls.target.set(cam.position[0] + (cam.target[0] - cam.position[0]) * k, cam.position[1], cam.position[2] + (cam.target[2] - cam.position[2]) * k);
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      camera.setViewOffset(w, h, 0, -cam.shiftY * h, w, h);
      camera.updateProjectionMatrix();
      controls.update();
      render();
    };
    const onStart = (): void => {
      manualRef.current = true;
      leaveEye();
    };
    controls.addEventListener('start', onStart);
    if (apiRef !== undefined) apiRef.current = { fit: (b) => { manualRef.current = false; leaveEye(); fit(b); }, eyeLevel };

    // Klick ohne Ziehen → Auswahl
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number; t: number } | undefined;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : undefined;
    };
    const aim = (e: PointerEvent): void => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
      raycaster.setFromCamera(ndc, camera);
    };
    const ownerAt = (e: PointerEvent): string | undefined => {
      aim(e);
      const visible = [...ctx.meshes.values()].filter((m) => m.mesh.visible);
      const hit = raycaster.intersectObjects(visible.map((m) => m.mesh), false)[0];
      const entry = hit === undefined ? undefined : visible.find((m) => m.mesh === hit.object);
      return entry !== undefined && hit?.instanceId !== undefined ? entry.voxels[hit.instanceId]?.owner : undefined;
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = undefined;
      if (start === undefined || e.button !== 0 || !isClick(start, { x: e.clientX, y: e.clientY, t: performance.now() })) return;
      pickRef.current?.(ownerAt(e));
    };
    // W7-G: Möbel ziehen (Weltkoordinaten = Szenen-Koordinaten, ein Block = eine Einheit)
    const detachDrag = attachFurnitureDrag(host, {
      canvas: () => renderer.domElement,
      current: () => dragRef.current,
      pick: ownerAt,
      ray: (e) => {
        aim(e);
        const { origin: o, direction: d } = raycaster.ray;
        return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
      },
    });
    const onDbl = () => fit();
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('dblclick', onDbl);

    return () => {
      detachDrag();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('dblclick', onDbl);
      controls.removeEventListener('start', onStart);
      fitNowRef.current = undefined;
      if (apiRef !== undefined) apiRef.current = null;
      ro.disconnect();
      controls.dispose();
      for (const { mesh } of ctx.meshes.values()) mesh.dispose();
      for (const m of Object.values(materials)) m.dispose();
      disposeTextured(texturedRef);
      if (pixelMatsRef.current !== null) {
        for (const m of Object.values(pixelMatsRef.current)) m.dispose();
        pixelMatsRef.current = null;
      }
      geometry.dispose();
      gridGeo.dispose();
      gridLines.material.dispose();
      hlGeo.dispose();
      highlightLines.material.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ctxRef.current = null;
    };
  }, [apiRef]);

  // Neu bauen nur bei neuen Daten
  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx === null) return;
    for (const { mesh } of ctx.meshes.values()) {
      ctx.scene.remove(mesh);
      mesh.dispose();
    }
    ctx.meshes.clear();
    const pixel = voxels.some((v) => v.block !== undefined);
    const atlas = pixel ? buildPixelAtlas(new Map(voxels.flatMap((v) => (v.block !== undefined ? [[v.block, v.color] as const] : []))).entries()) : undefined;
    // gleicher Atlas (z. B. Etage zurück, Rückgängig) → gleiche Textur, kein neues Hochladen
    const prevTextured = texturedRef.current;
    const texture = atlas === undefined ? undefined : prevTextured !== null && prevTextured.atlas === atlas ? prevTextured.texture : atlasTexture(atlas);
    disposeTextured(texturedRef, texture);
    const textured: Textured | null = atlas !== undefined && texture !== undefined ? { atlas, texture, geometries: [] } : null;
    texturedRef.current = textured;
    let pixelMats = pixelMatsRef.current;
    if (textured !== null) {
      if (pixelMats === null) {
        const make = (layer: VoxelLayer) => texturedMaterial(textured.texture, layer === 'light') as PixelMaterials[VoxelLayer];
        pixelMats = Object.fromEntries(LAYERS.map((l) => [l, make(l)])) as PixelMaterials;
        pixelMatsRef.current = pixelMats;
      }
      for (const m of Object.values(pixelMats)) m.map = textured.texture;
    }
    const byLayer = new Map<VoxelLayer, PreviewVoxel[]>();
    for (const v of voxels) {
      const list = byLayer.get(v.layer);
      if (list === undefined) byLayer.set(v.layer, [v]);
      else list.push(v);
    }
    const m4 = new THREE.Matrix4();
    const color = new THREE.Color();
    for (const layer of LAYERS) {
      const list = byLayer.get(layer);
      if (list === undefined || list.length === 0) continue;
      let geometry: THREE.BufferGeometry = ctx.geometry;
      let material: THREE.Material = ctx.materials[layer];
      if (textured !== null && atlas !== undefined && pixelMats !== null) {
        geometry = ctx.geometry.clone();
        tileAttributes(geometry, list, atlas);
        material = pixelMats[layer];
        textured.geometries.push(geometry);
      }
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((v, i) => {
        m4.makeScale(v.size[0], v.size[1], v.size[2]);
        m4.setPosition(v.center[0], v.center[1], v.center[2]);
        mesh.setMatrixAt(i, m4);
        // texturiert: Farbe steckt in der Kachel, Instanzfarbe nur als leichte Variation
        mesh.setColorAt(i, textured !== null && v.block !== undefined ? color.setScalar(0.96 + ((i * 2654435761) >>> 24) / 255 * 0.08) : color.setHex(v.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      mesh.visible = layerVisible(layer, viewRef.current);
      ctx.scene.add(mesh);
      ctx.meshes.set(layer, { mesh, voxels: list });
    }
    ctx.render();
    // Inhalt geändert: einmal einpassen, solange der Nutzer die Kamera nicht selbst bewegt hat
    const key = `${voxels.length}|${voxels.length > 0 ? voxels[0]!.owner : ''}|${voxels.length > 0 ? voxels[voxels.length - 1]!.owner : ''}`;
    if (!manualRef.current && key !== fittedRef.current) {
      fittedRef.current = key;
      fitNowRef.current?.();
    }
  }, [voxels]);

  // Ansicht: nur Sichtbarkeit umschalten
  useEffect(() => {
    viewRef.current = view;
    const ctx = ctxRef.current;
    if (ctx === null) return;
    for (const [layer, { mesh }] of ctx.meshes) mesh.visible = layerVisible(layer, view);
    ctx.render();
  }, [view]);

  // Raster und Auswahlrahmen: nur Linien
  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx === null) return;
    ctx.gridLines.visible = grid;
    const h = ctx.highlight;
    if (highlight === undefined) h.visible = false;
    else {
      const pad = 0.06;
      const [x0, y0, z0] = highlight.min;
      const [x1, y1, z1] = highlight.max;
      h.scale.set(x1 - x0 + 1 + 2 * pad, y1 - y0 + 1 + 2 * pad, z1 - z0 + 1 + 2 * pad);
      h.position.set((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, (z0 + z1 + 1) / 2);
      h.visible = true;
    }
    ctx.render();
  }, [grid, highlight]);

  return (
    <div className="viewer" ref={hostRef}>
      {failure !== undefined && <div className="viewer-failure">{failure}</div>}
      {overlay !== undefined && failure === undefined && (
        <div className="viewer-overlay" role="status" data-busy={overlay.endsWith('…')}>
          {overlay}
        </div>
      )}
    </div>
  );
}
