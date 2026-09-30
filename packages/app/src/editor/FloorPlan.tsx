import type { LinkId, PlacementId, ProjectState, RoomId, Shell, StairBlock } from '@mcda/blueprint';
import type { Cell, HorizontalDir } from '@mcda/core';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SURFACE, categoryColor, css, isLightMaterial, roomTypeColor } from '../colors.js';
import { linkLayout, type StairPreview } from '../stairs.js';
import { GRID, clampRect, floorLabel, type PlacedView, type Rect } from '../usecases.js';
import { roomDisplayNumbers, roomLabel } from '../ui/roomLabels.js';
import { CellSet } from '@mcda/core';
import { cellAt, edgeAt, interpretGesture, openingCell, outline, resizeByEdge, type PlanWindow, type RoomEdge, type Tool } from './grid.js';
import { labelFontPx, layoutLabels } from './labels.js';
import { dragOffset, groupIds, isMove, offsetText, placementAtCell } from './furnitureDrag.js';

const CELL = 16;
const W = GRID.width * CELL;
const H = GRID.depth * CELL;

interface Props {
  readonly state: ProjectState;
  readonly shell: Shell;
  readonly views: readonly PlacedView[];
  readonly selectedRoomId: RoomId | undefined;
  /** Gewählte Platzierung: Grundfläche gelb umrandet */
  readonly selectedPlacementId?: PlacementId | undefined;
  /** Angezeigte Etage: nur ihre Räume und Möbel */
  readonly floor: number;
  /** Etage, deren Räume gestrichelt darunter erscheinen (Geister-Overlay) */
  readonly ghostFloor?: number | undefined;
  readonly tool: Tool;
  readonly paintTypeId: string;
  readonly roomTypeName: (id: string) => string;
  readonly onPaint: (rect: Rect) => void;
  readonly onErase: (rect: Rect) => void;
  readonly onSelect: (cell: Cell) => void;
  /** Gewählte Treppe: gelb umrandet */
  readonly selectedLinkId?: LinkId | undefined;
  /** Treppen-Werkzeug: Vorschau („Geist“) an einer Zelle – grün gültig, rot mit Begründung */
  readonly previewStairs?: ((cell: Cell) => StairPreview) | undefined;
  readonly onPlaceStairs?: ((cell: Cell) => void) | undefined;
  readonly onRemoveStairs?: ((cell: Cell) => void) | undefined;
  /** Ausschnitt (W2-ED U3: aufs Haus eingepasst); fehlt = ganzes Raster. */
  readonly window?: PlanWindow | undefined;
  /**
   * Anfasser (W2-ED U4): Mit „Auswählen“ zieht man eine Kante des gewählten Raums – der Raum wird größer oder kleiner
   * und behält ID und Sperren. Fehlt = keine Anfasser.
   */
  readonly onResizeRoom?: ((roomId: RoomId, add: readonly Cell[], remove: readonly Cell[]) => void) | undefined;
  /**
   * Möbel ziehen (W7-G): Mit „Auswählen“ wählt ein Klick auf ein Möbel des gewählten Raums das Möbel, Ziehen verschiebt
   * es samt aufgesetzten Teilen (Vorschau grün bzw. rot mit Grund aus `movePreview`, Loslassen = `onMovePlacement`).
   */
  readonly onSelectPlacement?: ((id: PlacementId) => void) | undefined;
  readonly movePreview?: ((id: PlacementId, dx: number, dz: number) => string | undefined) | undefined;
  readonly onMovePlacement?: ((id: PlacementId, dx: number, dz: number) => void) | undefined;
  /**
   * F „Bereich neu einrichten“: Raum, in dem ein Rechteck gezogen wird (scharf geschaltet). Ziehen mit links zeigt den
   * Bereich (nur Zellen des Raums), Loslassen ruft `onBlock`. Fehlt = normales Werkzeug.
   */
  readonly blockRoomId?: RoomId | undefined;
  readonly onBlock?: ((rect: Rect) => void) | undefined;
  /** Hervorgehobener Bereich (Zone unter dem Zeiger bzw. zuletzt neu eingerichtet). */
  readonly blockHint?: CellSet | undefined;
}

/** Laufendes Ziehen eines Möbels (Zellen im Raster). */
interface Move {
  readonly id: PlacementId;
  readonly start: Cell;
  readonly end: Cell;
}

/** Vorschau des Ziehens: Grundfläche der Gruppe am neuen Ort, passt sie (sonst der Grund)? */
interface MovePreview {
  readonly cells: readonly Cell[];
  readonly problem: string | undefined;
  readonly text: string;
}

/** Laufende Größenänderung: Kante und neue äußerste Reihe. */
interface Resize {
  readonly roomId: RoomId;
  readonly edge: RoomEdge;
  readonly to: number;
}

/** Neue äußerste Reihe einer Kante aus der Zeigerposition (Zellkoordinaten mit Bruchteil). */
function edgeTarget(edge: RoomEdge, fx: number, fz: number): number {
  if (edge === 'east') return Math.round(fx) - 1;
  if (edge === 'west') return Math.round(fx);
  if (edge === 'south') return Math.round(fz) - 1;
  return Math.round(fz);
}

const EDGE_CURSOR: Readonly<Record<RoomEdge, string>> = { east: 'ew-resize', west: 'ew-resize', north: 'ns-resize', south: 'ns-resize' };

interface Drag {
  readonly start: Cell;
  readonly end: Cell;
  readonly button: 'left' | 'right';
}

/**
 * 2D-Grundriss (Canvas) einer Etage: Räume malen, radieren, auswählen. Zeichnet Räume, Wände, Türen und
 * Möbel-Grundflächen. Die Zeichenfläche hat feste Pixel (16 je Zelle) und wird per CSS eingepasst.
 */
export function FloorPlan(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const [hover, setHover] = useState<Cell | undefined>(undefined);
  const [resize, setResize] = useState<Resize | undefined>(undefined);
  const [hoverEdge, setHoverEdge] = useState<RoomEdge | undefined>(undefined);
  const [move, setMove] = useState<Move | undefined>(undefined);
  const [hoverMovable, setHoverMovable] = useState(false);
  /** Bodenhöhe je Raum der angezeigten Etage (Treffer auf Möbel wie gezeichnet). */
  const roomBase = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of props.state.rooms) if (r.floorIndex === props.floor) m.set(r.id, props.shell.rooms.get(r.id)?.baseY ?? 1);
    return m;
  }, [props.state.rooms, props.floor, props.shell]);
  /** Möbel unter dem Zeiger, das man ziehen darf: das gewählte oder eines im gewählten Raum. */
  const movableAt = (c: Cell | undefined): PlacementId | undefined => {
    if (c === undefined || props.onMovePlacement === undefined || props.tool !== 'select') return undefined;
    const id = placementAtCell(props.views, roomBase, c);
    if (id === undefined) return undefined;
    const roomId = props.views.find((v) => v.placement.id === id)?.placement.roomId;
    return id === props.selectedPlacementId || (roomId !== undefined && roomId === props.selectedRoomId) ? id : undefined;
  };
  const moveDx = move === undefined ? 0 : move.end[0] - move.start[0];
  const moveDz = move === undefined ? 0 : move.end[1] - move.start[1];
  const moveId = move?.id;
  const movePreview = useMemo((): MovePreview | undefined => {
    if (moveId === undefined) return undefined;
    const ids = groupIds(props.state, moveId);
    const cells: Cell[] = [];
    const seen = new Set<string>();
    for (const v of props.views) {
      if (!ids.has(v.placement.id)) continue;
      const baseY = roomBase.get(v.placement.roomId) ?? 1;
      for (const c of v.placed.cells) {
        if (c.pos[1] > baseY + 1) continue;
        const k = `${c.pos[0] + moveDx},${c.pos[2] + moveDz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        cells.push([c.pos[0] + moveDx, c.pos[2] + moveDz]);
      }
    }
    const off = [moveDx, moveDz] as const;
    const problem = isMove(off) ? props.movePreview?.(moveId, moveDx, moveDz) : undefined;
    const text = !isMove(off) ? 'Ziehen verschiebt · Esc bricht ab' : problem === undefined ? `${offsetText(off)} – loslassen verschiebt` : `passt nicht: ${problem}`;
    return { cells, problem, text };
    // Neu nur bei anderem Möbel oder anderer Verschiebung (die Passt-Prüfung leitet die Hülle ab)
  }, [moveId, moveDx, moveDz, props.state, props.views, roomBase, props.movePreview]);
  /** Raum mit Anfassern: gewählt, auf dieser Etage, Werkzeug „Auswählen“ und Größenänderung möglich. */
  const handleRoom =
    props.onResizeRoom !== undefined && props.tool === 'select' && props.selectedPlacementId === undefined && props.selectedRoomId !== undefined
      ? props.state.rooms.find((r) => r.id === props.selectedRoomId && r.floorIndex === props.floor)
      : undefined;
  const previewCells = (() => {
    if (resize === undefined) return undefined;
    const room = props.state.rooms.find((r) => r.id === resize.roomId);
    if (room === undefined) return undefined;
    const { add, remove } = resizeByEdge(room.cells, resize.edge, resize.to);
    return room.cells.union(CellSet.of(add)).difference(CellSet.of(remove));
  })();
  /** Angezeigte Breite / Zeichenbreite: die Schrift wächst, wenn der Grundriss klein dargestellt wird (R1-14). */
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    const measure = () => {
      if (canvas.clientWidth > 0) setScale(Math.round((canvas.clientWidth / W) * 20) / 20); // Stufen von 5 %: kein Neuzeichnen je Pixel
    };
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (canvas == null || g == null) return;
    // Auflösung folgt der Anzeige: klein dargestellt reichen die festen Pixel, groß (Hi-DPI) wird schärfer gezeichnet
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    // Ausschnitt: gleiche Zeichnung, nur vergrößert und verschoben (Seitenverhältnis wie das Raster)
    const win = props.window;
    const zoom = win === undefined ? 1 : GRID.width / win.w;
    const ox = win === undefined ? 0 : -win.x0 * CELL * zoom;
    const oz = win === undefined ? 0 : -win.z0 * CELL * zoom;
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * ox, dpr * oz);
    draw(g, props, drag, hover, scale * zoom, { handles: handleRoom !== undefined && move === undefined, preview: previewCells, move: movePreview });
  });

  const cellOf = (e: ReactPointerEvent<HTMLCanvasElement>): Cell | undefined => {
    const r = e.currentTarget.getBoundingClientRect();
    const win = props.window;
    if (win === undefined) return cellAt(e.clientX - r.left, e.clientY - r.top, r.width, r.height, GRID);
    const c = cellAt(e.clientX - r.left, e.clientY - r.top, r.width, r.height, { width: win.w, depth: win.d });
    return c === undefined ? undefined : [c[0] + win.x0, c[1] + win.z0];
  };

  /** Zeigerposition in Zellkoordinaten mit Bruchteil (für die Anfasser). */
  const cellF = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; z: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    const win = props.window ?? { x0: 0, z0: 0, w: GRID.width, d: GRID.depth };
    return { x: win.x0 + ((e.clientX - r.left) / Math.max(1, r.width)) * win.w, z: win.z0 + ((e.clientY - r.top) / Math.max(1, r.height)) * win.d };
  };
  const edgeUnder = (e: ReactPointerEvent<HTMLCanvasElement>): RoomEdge | undefined => {
    if (handleRoom === undefined) return undefined;
    const f = cellF(e);
    return edgeAt(handleRoom.cells, f.x, f.z);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    const edge = e.button === 0 ? edgeUnder(e) : undefined;
    if (edge !== undefined && handleRoom !== undefined) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const b = handleRoom.cells.bounds()!;
      setResize({ roomId: handleRoom.id, edge, to: edge === 'east' ? b.maxX : edge === 'west' ? b.minX : edge === 'south' ? b.maxZ : b.minZ });
      return;
    }
    const c = cellOf(e);
    if (c === undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (props.blockRoomId !== undefined && e.button === 0) {
      setDrag({ start: c, end: c, button: 'left' });
      return;
    }
    const movable = e.button === 0 ? movableAt(c) : undefined;
    if (movable !== undefined) {
      setMove({ id: movable, start: c, end: c });
      return;
    }
    setDrag({ start: c, end: c, button: e.button === 2 ? 'right' : 'left' });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (resize !== undefined) {
      const f = cellF(e);
      const to = edgeTarget(resize.edge, f.x, f.z);
      const lim = resize.edge === 'east' || resize.edge === 'west' ? GRID.width - 1 : GRID.depth - 1;
      const clamped = Math.max(0, Math.min(lim, to));
      if (clamped !== resize.to) setResize({ ...resize, to: clamped });
      return;
    }
    if (move !== undefined) {
      const c = cellOf(e);
      if (c !== undefined && (c[0] !== move.end[0] || c[1] !== move.end[1])) setMove({ ...move, end: c });
      return;
    }
    const he = drag === undefined ? edgeUnder(e) : undefined;
    if (he !== hoverEdge) setHoverEdge(he);
    const c = cellOf(e);
    setHover(c);
    const hm = drag === undefined && he === undefined && movableAt(c) !== undefined;
    if (hm !== hoverMovable) setHoverMovable(hm);
    if (drag !== undefined && c !== undefined && (c[0] !== drag.end[0] || c[1] !== drag.end[1])) setDrag({ ...drag, end: c });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (resize !== undefined) {
      const room = props.state.rooms.find((r) => r.id === resize.roomId);
      setResize(undefined);
      if (room === undefined) return;
      const { add, remove } = resizeByEdge(room.cells, resize.edge, resize.to);
      if (add.length > 0 || remove.length > 0) props.onResizeRoom?.(room.id, add, remove);
      return;
    }
    if (move !== undefined) {
      const end = cellOf(e) ?? move.end;
      setMove(undefined);
      const [dx, dz] = dragOffset(move.start, end);
      if (dx !== 0 || dz !== 0) props.onMovePlacement?.(move.id, dx, dz);
      else props.onSelectPlacement?.(move.id);
      return;
    }
    if (drag === undefined) return;
    const end = cellOf(e) ?? drag.end;
    setDrag(undefined);
    if (props.blockRoomId !== undefined && drag.button === 'left') {
      props.onBlock?.({ x1: drag.start[0], z1: drag.start[1], x2: end[0], z2: end[1] });
      return;
    }
    const gesture = interpretGesture(props.tool, drag.button, drag.start, end);
    if (gesture.kind === 'paint') props.onPaint(gesture.rect);
    else if (gesture.kind === 'erase') props.onErase(gesture.rect);
    else if (gesture.kind === 'select') props.onSelect(gesture.cell);
    else if (gesture.kind === 'placeStairs') props.onPlaceStairs?.(gesture.cell);
    else if (gesture.kind === 'removeStairs') props.onRemoveStairs?.(gesture.cell);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrag(undefined);
        setResize(undefined);
        setMove(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cursor = props.blockRoomId !== undefined ? 'crosshair' : (resize !== undefined ? EDGE_CURSOR[resize.edge] : hoverEdge !== undefined ? EDGE_CURSOR[hoverEdge] : move !== undefined ? 'grabbing' : hoverMovable ? 'grab' : undefined) ?? (props.tool === 'select' ? 'pointer' : props.tool === 'erase' ? 'not-allowed' : props.tool === 'stairs' ? 'copy' : 'crosshair');
  return (
    <canvas
      ref={canvasRef}
      className="floorplan"
      // Ausschnitt in Zellen (x0, z0, Breite, Tiefe) – für Bedienhilfen und Browser-Abläufe (Zelle ↔ Pixel)
      data-plan-window={props.window === undefined ? `0,0,${GRID.width},${GRID.depth}` : `${props.window.x0},${props.window.z0},${props.window.w},${props.window.d}`}
      style={{ aspectRatio: `${W} / ${H}`, cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDrag(undefined);
        setResize(undefined);
        setMove(undefined);
      }}
      onPointerLeave={() => setHover(undefined)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={
        props.blockRoomId !== undefined
          ? 'Grundriss-Editor, Bereich neu einrichten: Rechteck im gewählten Raum ziehen (Esc bricht ab)'
          : props.tool === 'stairs'
          ? 'Grundriss-Editor, Treppen-Werkzeug: Klick setzt die Treppe (R dreht, F spiegelt), Rechtsklick entfernt eine Treppe'
          : 'Grundriss-Editor: Ziehen malt einen Raum, Rechtsklick radiert, Klick wählt aus; im gewählten Raum wählt ein Klick das Möbel – Möbel ziehen verschiebt es'
      }
    />
  );
}

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;
}

function draw(
  g: CanvasRenderingContext2D, p: Props, drag: Drag | undefined, hover: Cell | undefined, scale: number,
  extra: { handles: boolean; preview: CellSet | undefined; move?: MovePreview | undefined } = { handles: false, preview: undefined },
): void {
  const fontPx = labelFontPx(scale);
  g.fillStyle = SURFACE.plan;
  g.fillRect(0, 0, W, H);

  // Raster
  g.lineWidth = 1;
  for (let x = 0; x <= GRID.width; x++) {
    g.strokeStyle = x % 5 === 0 ? SURFACE.gridMajor : SURFACE.gridMinor;
    g.beginPath();
    g.moveTo(x * CELL + 0.5, 0);
    g.lineTo(x * CELL + 0.5, H);
    g.stroke();
  }
  for (let z = 0; z <= GRID.depth; z++) {
    g.strokeStyle = z % 5 === 0 ? SURFACE.gridMajor : SURFACE.gridMinor;
    g.beginPath();
    g.moveTo(0, z * CELL + 0.5);
    g.lineTo(W, z * CELL + 0.5);
    g.stroke();
  }

  const rooms = p.state.rooms.filter((r) => r.floorIndex === p.floor);
  /** Fortlaufende Anzeige-Nummern je Etage (Nutzerreview: keine springenden R-IDs auf dem Grundriss) */
  const roomNos = roomDisplayNumbers(p.state.rooms, p.floor);
  const roomIds = new Set(rooms.map((r) => r.id));
  const views = p.views.filter((v) => roomIds.has(v.placement.roomId));

  // Geister-Overlay: Räume der Etage darunter (im Keller: darüber) gestrichelt, damit man passend malt
  if (p.ghostFloor !== undefined) drawGhostFloor(g, p.state, p.ghostFloor, labelFontPx(scale, 10));

  // Räume: Innenfläche zart, Wandring kräftig in der Raumtypfarbe
  for (const room of rooms) {
    const color = roomTypeColor(room.roomTypeId);
    const geom = p.shell.rooms.get(room.id);
    for (const [x, z] of room.cells) {
      const inner = geom?.interior.has(x, z) ?? false;
      g.fillStyle = inner ? rgba(color, 0.32) : rgba(color, 0.85);
      g.fillRect(x * CELL, z * CELL, CELL, CELL);
    }
  }

  // Möbel: Bodenzellen als Quadrate in Kategoriefarbe, Deckenlichter als Punkte
  for (const v of views) {
    const geom = p.shell.rooms.get(v.placement.roomId);
    const baseY = geom?.baseY ?? 1;
    for (const c of v.placed.cells) {
      const [x, y, z] = c.pos;
      if (y <= baseY + 1 && !isLightMaterial(c.mat)) {
        g.fillStyle = css(categoryColor(v.def.category));
        g.fillRect(x * CELL + 2, z * CELL + 2, CELL - 4, CELL - 4);
        g.strokeStyle = v.placement.locked ? '#ffffff' : 'rgba(0,0,0,0.55)';
        g.lineWidth = v.placement.locked ? 2 : 1;
        g.strokeRect(x * CELL + 2.5, z * CELL + 2.5, CELL - 5, CELL - 5);
      } else if (isLightMaterial(c.mat)) {
        g.fillStyle = '#ffd27a';
        g.beginPath();
        g.arc(x * CELL + CELL / 2, z * CELL + CELL / 2, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // Gewählte Platzierung: Grundfläche (alle Zellen in x/z) gelb umranden
  const picked = p.selectedPlacementId === undefined ? undefined : views.find((v) => v.placement.id === p.selectedPlacementId);
  if (picked !== undefined) {
    g.strokeStyle = '#ffd65a';
    g.lineWidth = 2;
    const seen = new Set<string>();
    for (const c of picked.placed.cells) {
      const key = `${c.pos[0]},${c.pos[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      g.strokeRect(c.pos[0] * CELL + 1, c.pos[2] * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  // Umriss und Beschriftung
  g.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const candidates = [];
  for (const room of rooms) {
    const selected = room.id === p.selectedRoomId;
    g.strokeStyle = selected ? '#ffe28a' : 'rgba(255,255,255,0.35)';
    g.lineWidth = selected ? 3 : 1;
    g.beginPath();
    for (const [x1, z1, x2, z2] of outline(room.cells)) {
      g.moveTo(x1 * CELL, z1 * CELL);
      g.lineTo(x2 * CELL, z2 * CELL);
    }
    g.stroke();
    // Beschriftung in der Raummitte: Türen und Fenster liegen in den Wänden, Möbel meist am Rand
    const b = room.cells.bounds();
    const no = roomNos.get(room.id);
    if (b !== undefined) {
      candidates.push({ key: room.id, ...b, texts: [roomLabel(p.roomTypeName(room.roomTypeId), no), ...(no !== undefined ? [String(no)] : [])] });
    }
  }
  // Lesbar oder gar nicht: Mindestgröße, passt in den Raum, keine Überdeckung (R1-14; vorher gestaucht und überlappend)
  for (const l of layoutLabels(candidates, CELL, fontPx, (t) => g.measureText(t).width)) {
    g.fillStyle = 'rgba(8, 10, 22, 0.78)';
    g.fillRect(l.cx - l.w / 2, l.cy - l.h / 2, l.w, l.h);
    g.fillStyle = '#fff6e8';
    g.fillText(l.text, l.cx, l.cy + fontPx * 0.05);
  }

  drawStairs(g, p.state, p.floor, p.selectedLinkId);

  // Anfasser des gewählten Raums (W2-ED U4) und Vorschau der neuen Fläche beim Ziehen
  const sel = p.selectedRoomId === undefined ? undefined : rooms.find((r) => r.id === p.selectedRoomId);
  if (extra.preview !== undefined) {
    g.save();
    g.fillStyle = 'rgba(255, 214, 90, 0.18)';
    for (const [x, z] of extra.preview) g.fillRect(x * CELL, z * CELL, CELL, CELL);
    g.setLineDash([5, 3]);
    g.strokeStyle = '#ffd65a';
    g.lineWidth = 2;
    g.beginPath();
    for (const [x1, z1, x2, z2] of outline(extra.preview)) {
      g.moveTo(x1 * CELL, z1 * CELL);
      g.lineTo(x2 * CELL, z2 * CELL);
    }
    g.stroke();
    g.restore();
  } else if (extra.handles && sel !== undefined) {
    const b = sel.cells.bounds();
    if (b !== undefined) {
      const mx = ((b.minX + b.maxX + 1) / 2) * CELL;
      const mz = ((b.minZ + b.maxZ + 1) / 2) * CELL;
      const pts: ReadonlyArray<readonly [number, number]> = [[mx, b.minZ * CELL], [mx, (b.maxZ + 1) * CELL], [b.minX * CELL, mz], [(b.maxX + 1) * CELL, mz]];
      for (const [hx, hz] of pts) {
        g.fillStyle = '#ffd65a';
        g.strokeStyle = 'rgba(8, 10, 22, 0.9)';
        g.lineWidth = 1.5;
        g.fillRect(hx - 5, hz - 5, 10, 10);
        g.strokeRect(hx - 5, hz - 5, 10, 10);
      }
    }
  }

  // Türen und Fenster
  for (const room of rooms) {
    const geom = p.shell.rooms.get(room.id);
    for (const d of geom?.doors ?? []) {
      const [x, z] = openingCell(d);
      g.fillStyle = '#7a5534';
      g.fillRect(x * CELL + 2, z * CELL + 2, CELL - 4, CELL - 4);
      g.strokeStyle = '#2b1d10';
      g.lineWidth = 1;
      g.strokeRect(x * CELL + 2.5, z * CELL + 2.5, CELL - 5, CELL - 5);
    }
    for (const w of geom?.windows ?? []) {
      const [x, z] = openingCell(w);
      g.fillStyle = '#a8d0e6';
      if (w.toward === 'north' || w.toward === 'south') g.fillRect(x * CELL + 1, z * CELL + 5, CELL - 2, CELL - 10);
      else g.fillRect(x * CELL + 5, z * CELL + 1, CELL - 10, CELL - 2);
    }
  }

  // Möbel ziehen (W7-G): Grundfläche am neuen Ort, grün passt, rot mit Grund
  // sichtbarer Ausschnitt in Zeichenpixeln (Hinweise dürfen nicht außerhalb des eingepassten Grundrisses liegen)
  const view = visibleArea(p);
  if (extra.move !== undefined) drawMoveGhost(g, extra.move, fontPx, view);

  // Hover (Treppen-Werkzeug: Geist der Treppe)
  if (hover !== undefined && p.tool === 'stairs' && p.previewStairs !== undefined) {
    drawStairGhost(g, p.previewStairs(hover), view);
  } else if (hover !== undefined && drag === undefined) {
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 1;
    g.strokeRect(hover[0] * CELL + 0.5, hover[1] * CELL + 0.5, CELL - 1, CELL - 1);
  }

  // F „Bereich neu einrichten“: hervorgehobene Zone bzw. gezogenes Rechteck (nur Zellen des Raums)
  const blockRoom = p.blockRoomId === undefined ? undefined : rooms.find((r) => r.id === p.blockRoomId);
  const blockCells = drag !== undefined && blockRoom !== undefined && drag.button === 'left'
    ? CellSet.rect(Math.min(drag.start[0], drag.end[0]), Math.min(drag.start[1], drag.end[1]), Math.max(drag.start[0], drag.end[0]), Math.max(drag.start[1], drag.end[1])).intersection(blockRoom.cells)
    : p.blockHint;
  if (blockCells !== undefined && !blockCells.isEmpty) {
    g.save();
    g.fillStyle = 'rgba(64, 214, 200, 0.28)';
    for (const [x, z] of blockCells) g.fillRect(x * CELL, z * CELL, CELL, CELL);
    g.setLineDash([5, 3]);
    g.strokeStyle = '#40d6c8';
    g.lineWidth = 2;
    g.beginPath();
    for (const [x1, z1, x2, z2] of outline(blockCells)) {
      g.moveTo(x1 * CELL, z1 * CELL);
      g.lineTo(x2 * CELL, z2 * CELL);
    }
    g.stroke();
    g.restore();
  }
  if (drag !== undefined && blockRoom !== undefined) return;

  // Drag-Vorschau
  if (drag !== undefined && p.tool !== 'stairs') {
    const gesture = interpretGesture(p.tool, drag.button, drag.start, drag.end);
    const r = gesture.kind === 'paint' || gesture.kind === 'erase' ? clampRect(gesture.rect) : undefined;
    if (r !== undefined) {
      const x = r.x1 * CELL;
      const z = r.z1 * CELL;
      const w = (r.x2 - r.x1 + 1) * CELL;
      const h = (r.z2 - r.z1 + 1) * CELL;
      const erase = gesture.kind === 'erase';
      const color = erase ? 0xe5484d : roomTypeColor(p.paintTypeId);
      g.fillStyle = rgba(color, erase ? 0.3 : 0.45);
      g.fillRect(x, z, w, h);
      g.strokeStyle = css(color);
      g.lineWidth = 2;
      g.setLineDash(erase ? [4, 3] : []);
      g.strokeRect(x + 1, z + 1, w - 2, h - 2);
      g.setLineDash([]);
      g.fillStyle = '#ffffff';
      g.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
      g.fillText(`${r.x2 - r.x1 + 1} × ${r.z2 - r.z1 + 1}`, x + w / 2, z + h / 2);
    }
  }
}

const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Kleiner Pfeil in Laufrichtung (bergauf) in der Zellmitte. */
function arrow(g: CanvasRenderingContext2D, cell: Cell, dir: HorizontalDir, color: string): void {
  const [dx, dz] = STEP[dir];
  const cx = cell[0] * CELL + CELL / 2;
  const cy = cell[1] * CELL + CELL / 2;
  const r = CELL * 0.3;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(cx + dx * r, cy + dz * r);
  g.lineTo(cx - dx * r * 0.6 - dz * r * 0.7, cy - dz * r * 0.6 + dx * r * 0.7);
  g.lineTo(cx - dx * r * 0.6 + dz * r * 0.7, cy - dz * r * 0.6 - dx * r * 0.7);
  g.closePath();
  g.fill();
}

/** Räume einer anderen Etage als gestrichelte Umrisse mit Namen (Geister-Overlay). */
function drawGhostFloor(g: CanvasRenderingContext2D, state: ProjectState, floor: number, fontPx: number): void {
  const ghosts = state.rooms.filter((r) => r.floorIndex === floor);
  if (ghosts.length === 0) return;
  g.save();
  g.fillStyle = 'rgba(200, 210, 225, 0.06)';
  for (const r of ghosts) for (const [x, z] of r.cells) g.fillRect(x * CELL, z * CELL, CELL, CELL);
  g.strokeStyle = 'rgba(200, 210, 225, 0.55)';
  g.lineWidth = 1.5;
  g.setLineDash([4, 3]);
  g.beginPath();
  for (const r of ghosts) {
    for (const [x1, z1, x2, z2] of outline(r.cells)) {
      g.moveTo(x1 * CELL, z1 * CELL);
      g.lineTo(x2 * CELL, z2 * CELL);
    }
  }
  g.stroke();
  g.setLineDash([]);
  g.font = `500 ${fontPx}px Inter, system-ui, sans-serif`;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillStyle = 'rgba(200, 210, 225, 0.75)';
  for (const r of ghosts) {
    const b = r.cells.bounds();
    const text = floorLabel(floor);
    // nur, wenn der Hinweis in den Raum passt (sonst läge er über Nachbarn und den Räumen dieser Etage)
    if (b !== undefined && g.measureText(text).width + 6 <= (b.maxX - b.minX + 1) * CELL && fontPx + 6 <= (b.maxZ - b.minZ + 1) * CELL) {
      g.fillText(text, b.minX * CELL + 3, b.minZ * CELL + 3);
    }
  }
  g.restore();
}

/** Je Spalte der oberste Block einer Treppe. */
function topPerColumn(blocks: readonly StairBlock[]): StairBlock[] {
  const top = new Map<string, StairBlock>();
  for (const b of blocks) {
    const k = `${b.cell[0]},${b.cell[1]}`;
    const o = top.get(k);
    if (o === undefined || b.dy > o.dy) top.set(k, b);
  }
  return [...top.values()];
}

/**
 * Treppen der Etage: unten Stufen (Holz, heller je höher) mit Pfeil bergauf, Podest, Pfosten, Leiter; oben die
 * Deckenöffnung (dunkel, Geländer-Rand) und die oberste Stufe. Die gewählte Treppe ist gelb umrandet.
 */
function drawStairs(g: CanvasRenderingContext2D, state: ProjectState, floor: number, selected: LinkId | undefined): void {
  for (const link of state.links) {
    const lower = link.floorIndex === floor;
    const upper = link.floorIndex + 1 === floor;
    if (!lower && !upper) continue;
    const layout = linkLayout(state, link);
    if (layout === undefined) continue;
    const rise = Math.max(1, ...layout.blocks.map((b) => b.dy));
    const mine: Cell[] = [];
    if (lower) {
      for (const b of topPerColumn(layout.blocks)) {
        const [x, z] = b.cell;
        mine.push(b.cell);
        if (b.part === 'post' || b.part === 'support') {
          g.fillStyle = '#4a3624';
          g.fillRect(x * CELL + 3, z * CELL + 3, CELL - 6, CELL - 6);
          continue;
        }
        const t = b.dy / rise;
        g.fillStyle = b.part === 'ladder' ? '#7a5a34' : `rgb(${Math.round(120 + 90 * t)}, ${Math.round(84 + 60 * t)}, ${Math.round(50 + 30 * t)})`;
        g.fillRect(x * CELL + 1, z * CELL + 1, CELL - 2, CELL - 2);
        if (b.part === 'ladder') {
          g.strokeStyle = '#3a2a18';
          g.lineWidth = 1;
          for (let i = 1; i <= 3; i++) {
            g.beginPath();
            g.moveTo(x * CELL + 3, z * CELL + (i * CELL) / 4);
            g.lineTo(x * CELL + CELL - 3, z * CELL + (i * CELL) / 4);
            g.stroke();
          }
        } else if (b.facing !== undefined) arrow(g, b.cell, b.facing, 'rgba(30, 20, 10, 0.8)');
      }
    }
    if (upper) {
      for (const c of layout.holes) {
        mine.push(c);
        g.fillStyle = '#07090b';
        g.fillRect(c[0] * CELL, c[1] * CELL, CELL, CELL);
        g.strokeStyle = '#b08850';
        g.lineWidth = 2;
        g.strokeRect(c[0] * CELL + 1, c[1] * CELL + 1, CELL - 2, CELL - 2);
      }
      for (const c of layout.top) {
        if (layout.holes.some((h) => h[0] === c[0] && h[1] === c[1])) continue;
        mine.push(c);
        g.fillStyle = 'rgb(210, 150, 85)';
        g.fillRect(c[0] * CELL + 1, c[1] * CELL + 1, CELL - 2, CELL - 2);
        const step = layout.blocks.find((b) => b.cell[0] === c[0] && b.cell[1] === c[1] && b.dy === rise);
        if (step?.facing !== undefined) arrow(g, c, step.facing, 'rgba(30, 20, 10, 0.8)');
      }
    }
    if (link.id === selected) {
      g.strokeStyle = '#ffd65a';
      g.lineWidth = 2;
      for (const [x, z] of mine) g.strokeRect(x * CELL + 1, z * CELL + 1, CELL - 2, CELL - 2);
    }
  }
}

/** Vorschau beim Ziehen eines Möbels: Zellen am Zielort, Hinweis darunter (Richtung bzw. Grund der Ablehnung). */
/** Sichtbarer Ausschnitt des Grundrisses in Zeichenpixeln (ganzes Raster ohne Ausschnitt). */
interface Area {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}
function visibleArea(p: Pick<Props, 'window'>): Area {
  const w = p.window;
  return w === undefined ? { x0: 0, z0: 0, x1: W, z1: H } : { x0: w.x0 * CELL, z0: w.z0 * CELL, x1: (w.x0 + w.w) * CELL, z1: (w.z0 + w.d) * CELL };
}

function drawMoveGhost(g: CanvasRenderingContext2D, mv: MovePreview, fontPx: number, view: Area): void {
  const [r, gr, b] = mv.problem === undefined ? [110, 220, 140] : [235, 80, 80];
  g.save();
  for (const [x, z] of mv.cells) {
    g.fillStyle = `rgba(${r}, ${gr}, ${b}, 0.45)`;
    g.fillRect(x * CELL + 1, z * CELL + 1, CELL - 2, CELL - 2);
    g.strokeStyle = `rgba(${r}, ${gr}, ${b}, 1)`;
    g.lineWidth = 1.5;
    g.strokeRect(x * CELL + 1.5, z * CELL + 1.5, CELL - 3, CELL - 3);
  }
  const bounds = mv.cells.reduce((a, [x, z]) => ({ minX: Math.min(a.minX, x), maxX: Math.max(a.maxX, x), maxZ: Math.max(a.maxZ, z) }), { minX: Infinity, maxX: -Infinity, maxZ: -Infinity });
  if (Number.isFinite(bounds.minX)) {
    g.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = Math.min(view.x1 - view.x0 - 8, g.measureText(mv.text).width + 12);
    const h = fontPx + 8;
    const cx = Math.max(view.x0 + w / 2 + 4, Math.min(view.x1 - w / 2 - 4, ((bounds.minX + bounds.maxX + 1) / 2) * CELL));
    const cy = Math.min(view.z1 - h / 2 - 2, (bounds.maxZ + 1) * CELL + h / 2 + 4);
    g.fillStyle = mv.problem === undefined ? 'rgba(8, 24, 14, 0.9)' : 'rgba(40, 8, 8, 0.92)';
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    g.fillStyle = mv.problem === undefined ? '#bff5cf' : '#ffb4b4';
    g.fillText(mv.text, cx, cy, w - 8);
  }
  g.restore();
}

/** Geist des Treppen-Werkzeugs: untere Zellen gefüllt, obere (Öffnung, Austritt) gestrichelt; rot + Grund, wenn ungültig. */
function drawStairGhost(g: CanvasRenderingContext2D, pv: StairPreview, view: Area = { x0: 0, z0: 0, x1: W, z1: H }): void {
  const [r, gr, b] = pv.valid ? [110, 220, 140] : [235, 80, 80];
  const fill = (a: number) => `rgba(${r}, ${gr}, ${b}, ${a})`;
  g.save();
  for (const [x, z] of pv.lower) {
    g.fillStyle = fill(0.35);
    g.fillRect(x * CELL, z * CELL, CELL, CELL);
  }
  for (const st of pv.steps) if (st.facing !== undefined && st.part !== 'fill') arrow(g, st.cell, st.facing, fill(0.95));
  g.strokeStyle = fill(0.95);
  g.lineWidth = 1.5;
  g.setLineDash([3, 2]);
  for (const [x, z] of pv.upper) g.strokeRect(x * CELL + 2, z * CELL + 2, CELL - 4, CELL - 4);
  g.setLineDash([]);
  if (pv.entry !== undefined) {
    g.strokeStyle = fill(1);
    g.lineWidth = 2;
    g.strokeRect(pv.entry[0] * CELL + 1, pv.entry[1] * CELL + 1, CELL - 2, CELL - 2);
  }
  if (!pv.valid && pv.reason !== undefined) {
    g.font = '600 11px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const w = Math.min(view.x1 - view.x0 - 8, g.measureText(pv.reason).width + 12);
    g.fillStyle = 'rgba(40, 8, 8, 0.92)';
    g.fillRect(view.x0 + 4, view.z1 - 22, w, 18);
    g.fillStyle = '#ffb4b4';
    g.fillText(pv.reason, view.x0 + 10, view.z1 - 13, w - 12);
  }
  g.restore();
}
