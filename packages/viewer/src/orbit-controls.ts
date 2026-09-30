/**
 * Maus-/Touch-Bedienung einer Orbit-Kamera auf einem Canvas (DOM): linke Taste drehen, rechte/mittlere Taste
 * oder Umschalt + links verschieben, Rad zoomen, Doppelklick = einpassen. Gleiches Verhalten wie im
 * Block-Renderer (renderer.ts); als eigener Baustein für den beleuchteten Renderer.
 */
import { panOrbit, rotateOrbit, zoomOrbit, type Orbit } from './camera.js';

export interface OrbitControlTarget {
  getOrbit(): Orbit;
  setOrbit(o: Orbit): void;
  fit(): void;
}

/** Hängt die Bedienung an; Rückgabe entfernt sie wieder. */
export function attachOrbitControls(canvas: HTMLCanvasElement, target: OrbitControlTarget): () => void {
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
    const o = target.getOrbit();
    target.setOrbit(drag.pan ? panOrbit(o, dx / h, dy / h) : rotateOrbit(o, (dx / h) * Math.PI, (dy / h) * Math.PI));
  };
  const onUp = (e: PointerEvent): void => {
    if (drag === undefined || e.pointerId !== drag.id) return;
    drag = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    target.setOrbit(zoomOrbit(target.getOrbit(), Math.exp(dy * 0.0015)));
  };
  const onContext = (e: Event): void => e.preventDefault();
  const onDbl = (): void => target.fit();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('dblclick', onDbl);
  canvas.style.touchAction = 'none';

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContext);
    canvas.removeEventListener('dblclick', onDbl);
  };
}
