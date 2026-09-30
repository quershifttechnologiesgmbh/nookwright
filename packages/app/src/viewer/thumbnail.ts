/**
 * Vorschaubild einer Hülle (Assistent „Neues Projekt aus Bautyp“, research/19 §7.7: „3D-Mini“ je Vorschlag): EIN
 * gemeinsamer WebGL-Renderer außerhalb des DOM zeichnet die Rollen-Quader (Flächenfarben wie die Vorschau „Rollen“)
 * schräg von vorn und liefert ein PNG als Data-URL. So braucht jede Karte nur ein <img>, keinen eigenen WebGL-Kontext.
 */
import type { Shell } from '@mcda/blueprint';
import type { World } from '@mcda/pipeline';
import { buildingFromShell, moundColumns } from '@mcda/terrain';
import * as THREE from 'three';
import { buildBlockVoxels } from './blocks.js';
import { buildPreviewVoxels, type PreviewVoxel } from './voxels.js';

/**
 * W8-D: Quader des Vorschaubilds. Mit materialisierter Welt (Theme, Palette, Außen-Deko wie beim Übernehmen) in den
 * echten Blockfarben der Vorschau „Blöcke“, sonst (Plattform-Daten noch nicht geladen) die Rollenfarben der Hülle.
 */
export function thumbnailVoxels(shell: Shell, world?: World, blocks?: readonly PreviewVoxel[]): PreviewVoxel[] {
  // W14: `blocks` = schon berechnete Quader derselben Welt (Blöcke-Worker), sonst hier aus der Welt
  const house = blocks !== undefined ? [...blocks] : world !== undefined ? buildBlockVoxels(world) : buildPreviewVoxels(shell, []);
  const mound = moundVoxels(shell);
  return mound.length === 0 ? house : [...house, ...mound];
}

/** Flächenfarben des Hügels im Vorschaubild: Gras oben, Moos an den Stufen (wie `ground_grass`/`ground_moss`). */
const MOUND_TOP = 0x6d9b43;
const MOUND_BODY = 0x59752c;

/**
 * W9-G4 (plan/spikes/W9G4_erdhaus.md, Review R5 G4 „Vorschaukarte ohne Hügel“): Erdhaus (Lage `buried`) – der Hügel
 * gehört zum Bild, sonst zeigt die Karte eine Holzkiste mit Grundrissmuster. Die Form kommt aus dem Gelände
 * (`moundColumns`, wie beim Überdecken auf ebenem Grund); je Spalte ein Quader für den Körper und einer für die Grasdecke.
 */
export function moundVoxels(shell: Shell): PreviewVoxel[] {
  if (!(shell.settings ?? []).some((s) => s.kind === 'buried')) return [];
  const out: PreviewVoxel[] = [];
  for (const c of moundColumns(buildingFromShell(shell))) {
    const body = c.top - c.from;
    if (body > 0) out.push({ center: [c.x + 0.5, c.from + body / 2, c.z + 0.5], size: [1, body, 1], color: MOUND_BODY, layer: 'wall' });
    out.push({ center: [c.x + 0.5, c.top + 0.5, c.z + 0.5], size: [1, 1, 1], color: MOUND_TOP, layer: 'wall' });
  }
  return out;
}

let shared: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; geometry: THREE.BoxGeometry; material: THREE.Material } | undefined;

function context() {
  if (shared !== undefined) return shared;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x3a332c, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-35, 70, 25);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.5);
  fill.position.set(40, 30, -30);
  scene.add(fill);
  shared = { renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, 0.1, 2000), geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshLambertMaterial({ color: 0xffffff }) };
  return shared;
}

/** Hülle → PNG (Data-URL), Blick von Südwesten schräg oben; `front`: Blickrichtung der Front (Kamera davor). */
export function renderThumbnail(
  shell: Shell, width: number, height: number, front: 'north' | 'east' | 'south' | 'west' = 'south', world?: World, blocks?: readonly PreviewVoxel[],
): string {
  const c = context();
  const voxels = thumbnailVoxels(shell, world, blocks);
  const mesh = new THREE.InstancedMesh(c.geometry, c.material, Math.max(1, voxels.length));
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();
  voxels.forEach((v, i) => {
    m4.makeScale(v.size[0], v.size[1], v.size[2]);
    m4.setPosition(v.center[0], v.center[1], v.center[2]);
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, color.setHex(v.color));
  });
  mesh.count = voxels.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  c.scene.add(mesh);
  try {
    const box = new THREE.Box3();
    for (const v of voxels) box.expandByPoint(new THREE.Vector3(...v.center));
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 10 : Math.max(4, box.getSize(new THREE.Vector3()).length() / 2);
    // Kamera vor der Front, etwas seitlich und oben (wie der Standardblick der 3D-Ansicht)
    const OUT: Readonly<Record<typeof front, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
    const [ox, oz] = OUT[front];
    // seitlich nach links vom Eingang aus gesehen (u = −oz, ox)
    const dir = new THREE.Vector3(ox - 0.55 * oz, 0.75, oz + 0.55 * ox).normalize();
    c.camera.aspect = width / height;
    const half = THREE.MathUtils.degToRad(c.camera.fov) / 2;
    const dist = (radius / Math.sin(Math.min(half, Math.atan(Math.tan(half) * c.camera.aspect)))) * 1.02;
    c.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    c.camera.lookAt(center);
    c.camera.updateProjectionMatrix();
    c.renderer.setSize(width, height, false);
    c.renderer.setClearColor(0x000000, 0);
    c.renderer.render(c.scene, c.camera);
    return c.renderer.domElement.toDataURL('image/png');
  } finally {
    c.scene.remove(mesh);
    mesh.dispose();
  }
}
