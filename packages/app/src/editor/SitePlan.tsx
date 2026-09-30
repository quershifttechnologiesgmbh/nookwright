import type { ProjectState, Shell } from '@mcda/blueprint';
import type { Cell, HorizontalDir } from '@mcda/core';
import type { Surroundings } from '@mcda/pipeline';
import { brushCells, type SiteState, type Zone, type ZoneKind } from '@mcda/terrain';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SURFACE, css, roomTypeColor } from '../colors.js';
import {
  GATE_SNAP, SCULPT_OPTIONS, ZONE_OPTIONS, annexAt, nearestWall, siteOf, towerSize, zoneLabel,
  type AnnexChoice, type AnnexSpec, type SculptTool, type StructureItem, type SurroundingsState, type TowerChoice, type WindmillChoice,
} from '../surroundings.js';
import { outdoorColor } from '../surroundingsWorld.js';
import type { Rect } from '../usecases.js';
import { outline } from './grid.js';
import {
  CLOSE_SNAP, PATH_RANKS, RECT_TOOLS, draftClick, draftFinish, fitView, interpretSiteGesture, panView, planBounds, planColor, snapPoint, strokeCells, viewCell, zoomView,
  type SiteGesture, type SiteSelection, type SiteTool, type SiteView,
} from './siteGrid.js';

interface Props {
  readonly state: ProjectState;
  readonly shell: Shell;
  readonly sur: SurroundingsState | undefined;
  /** Zuletzt berechnete Umgebung (Draufsicht: Gelände, Pflanzen, Bauwerke); darf älter sein. */
  readonly around: Surroundings | undefined;
  readonly tool: SiteTool;
  readonly zoneKind: ZoneKind;
  readonly sculptTool: SculptTool;
  /** Radius des runden Pinsels, wenn das Werkzeug damit malt (Weg, Glätten); sonst Rechteck. */
  readonly brush: number | undefined;
  readonly tower: TowerChoice;
  readonly windmill: WindmillChoice;
  /** Werkzeug „Anbau-Turm“ (C4): Art und Gestalt für die Vorschau an der Außenwand. */
  readonly annex: AnnexChoice;
  readonly selected: SiteSelection | undefined;
  readonly onGesture: (g: SiteGesture) => void;
  readonly onWall: (points: readonly Cell[], closed: boolean) => void;
  /** Meldung für die Statuszeile (z. B. Hinweise beim Zeichnen). */
  readonly onHint?: (text: string) => void;
}

interface Drag {
  readonly start: Cell;
  readonly end: Cell;
  readonly button: 'left' | 'right';
}

interface Pan {
  readonly x: number;
  readonly y: number;
  readonly view: SiteView;
}

/** Pinselstrich in Arbeit: überstrichene Zellen (Schlüssel „x,z“) und die letzte Zelle. */
interface Stroke {
  readonly button: 'left' | 'right';
  readonly cells: ReadonlyMap<string, Cell>;
  readonly last: Cell;
}

const ZONE_COLOR = new Map(ZONE_OPTIONS.map((z) => [z.id, z.color]));
const DIR_XZ: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const SCULPT_COLOR: Readonly<Record<SculptTool, number>> = { raise: 0xe0913c, lower: 0x4f8fd9, flatten: 0xd8d0a0, smooth: 0x6fcfb8, reset: 0x9aa0a8 };

const NO_ZONES: readonly Zone[] = [];

function addCells(cells: ReadonlyMap<string, Cell>, add: Iterable<Cell>): Map<string, Cell> {
  const out = new Map(cells);
  for (const c of add) out.set(`${c[0]},${c[1]}`, [c[0], c[1]]);
  return out;
}

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;
}

/**
 * Plan-Karte der berechneten Umgebung, 1 Pixel je Spalte: die oberste Zelle (Farbe der Rolle, heller = höher), im
 * Grundstück nach `SiteResult.plan` Wege nach Rang und die Zonen der Berechnung getönt (`planColor`).
 */
interface TopView {
  readonly canvas: HTMLCanvasElement;
  readonly minX: number;
  readonly minZ: number;
  /** Wegränge, die in der Karte vorkommen (Legende). */
  readonly ranks: ReadonlySet<number>;
}

function topView(around: Surroundings | undefined, zones: readonly Zone[]): TopView | undefined {
  if (around === undefined || around.cells.length === 0) return undefined;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const c of around.cells) {
    if (c.pos[0] < minX) minX = c.pos[0];
    if (c.pos[0] > maxX) maxX = c.pos[0];
    if (c.pos[2] < minZ) minZ = c.pos[2];
    if (c.pos[2] > maxZ) maxZ = c.pos[2];
  }
  const w = maxX - minX + 1;
  const d = maxZ - minZ + 1;
  const topY = new Int32Array(w * d).fill(-1_000_000);
  const role: string[] = new Array<string>(w * d);
  for (const c of around.cells) {
    const i = (c.pos[2] - minZ) * w + (c.pos[0] - minX);
    if (c.pos[1] > topY[i]!) {
      topY[i] = c.pos[1];
      role[i] = c.role;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = d;
  const g = canvas.getContext('2d');
  if (g === null) return undefined;
  const site = around.site;
  const zoneColor = new Map(zones.map((z) => [z.id, ZONE_COLOR.get(z.kind)]));
  const ranks = new Set<number>();
  const img = g.createImageData(w, d);
  for (let i = 0; i < w * d; i++) {
    const r = role[i];
    if (r === undefined) continue;
    let col = outdoorColor(r);
    let y = topY[i]!;
    const j = site === undefined ? -1 : site.grid.at(minX + (i % w), minZ + Math.floor(i / w));
    if (j >= 0) {
      const rank = site!.plan.path[j]!;
      const zone = site!.plan.zone[j];
      if (rank > 0) {
        ranks.add(rank);
        y = site!.top[j]!; // Weg auf Bodenhöhe, auch unter Baumkronen
      }
      col = planColor(col, zone == null ? undefined : zoneColor.get(zone), rank);
    }
    const shade = Math.max(0.55, Math.min(1.35, 0.9 + y * 0.05));
    img.data[i * 4] = Math.min(255, ((col >> 16) & 255) * shade);
    img.data[i * 4 + 1] = Math.min(255, ((col >> 8) & 255) * shade);
    img.data[i * 4 + 2] = Math.min(255, (col & 255) * shade);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { canvas, minX, minZ, ranks };
}

/**
 * Plan „Umgebung“ (Canvas, Draufsicht): Grundstück, Zonen, Terraforming, Haus, Bauwerke und – sobald berechnet – das
 * erzeugte Gelände mit Wegen, Feldern, Bäumen. Zoom mit dem Mausrad, Verschieben mit der mittleren Maustaste
 * (oder Leertaste + Ziehen). Werkzeuge siehe `interpretSiteGesture`; Mauerzug: Punkte klicken, Doppelklick/Enter
 * beendet, Klick auf den ersten Punkt schließt den Ring, Rücktaste/Rechtsklick nimmt den letzten Punkt zurück,
 * Esc bricht ab, Umschalt rastet auf 45° ein.
 */
export function SitePlan(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | undefined>(undefined);
  const [view, setView] = useState<SiteView | undefined>(undefined);
  const [userView, setUserView] = useState(false);
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const [pan, setPan] = useState<Pan | undefined>(undefined);
  const [hover, setHover] = useState<Cell | undefined>(undefined);
  const [shift, setShift] = useState(false);
  const [draft, setDraft] = useState<readonly Cell[]>([]);
  const [stroke, setStroke] = useState<Stroke | undefined>(undefined);
  const spaceRef = useRef(false);

  const site = siteOf(props.sur);
  const structures = props.sur?.structures ?? [];
  const bounds = useMemo(() => planBounds(site?.plot, structures), [site?.plot, structures]);
  const boundsKey = `${bounds.minX},${bounds.minZ},${bounds.maxX},${bounds.maxZ}`;
  const zones = site?.zones ?? NO_ZONES;
  const top = useMemo(() => topView(props.around, zones), [props.around, zones]);

  // Größe der Fläche verfolgen
  useEffect(() => {
    const host = hostRef.current;
    if (host == null) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) }));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Einpassen: beim ersten Mal und wenn der Bereich wächst, solange nicht von Hand gezoomt/verschoben wurde
  useEffect(() => {
    if (size === undefined || userView) return;
    setView(fitView(bounds, size.w, size.h));
  }, [size, boundsKey, userView]); // `bounds` über seinen Schlüssel

  // Mausrad zoomt (nicht-passiv, damit die Seite nicht scrollt)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      setView((v) => (v === undefined ? v : zoomView(v, e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top)));
      setUserView(true);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Tastatur: Mauerzug beenden/zurücknehmen/abbrechen, Leertaste zum Verschieben, Umschalt rastet ein
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(() => {
    const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true);
      if (typing(e.target)) return;
      if (e.key === ' ') spaceRef.current = true;
      const pts = draftRef.current;
      if (pts.length === 0) return;
      if (e.key === 'Escape') setDraft([]);
      else if (e.key === 'Enter') {
        e.preventDefault();
        finish(pts);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setDraft(pts.slice(0, -1));
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false);
      if (e.key === ' ') spaceRef.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []); // liest nur Refs

  // Werkzeugwechsel verwirft einen angefangenen Mauerzug
  useEffect(() => {
    if (props.tool !== 'wall') setDraft([]);
  }, [props.tool]);

  const finish = (pts: readonly Cell[]): void => {
    const done = draftFinish(pts);
    if (done === undefined) {
      propsRef.current.onHint?.('Mauerzug: mindestens 2 Punkte setzen (Esc bricht ab)');
      return;
    }
    setDraft([]);
    propsRef.current.onWall(done, false);
  };

  // Zeichnen
  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (canvas == null || g == null || size === undefined || view === undefined) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(g, size.w, size.h, view, props, site, top, { drag, hover, draft, shift, stroke });
  });

  const cellOf = (e: ReactPointerEvent<HTMLCanvasElement>): Cell | undefined => {
    if (view === undefined) return undefined;
    const r = e.currentTarget.getBoundingClientRect();
    return viewCell(view, e.clientX - r.left, e.clientY - r.top);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (view === undefined) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      setPan({ x: e.clientX, y: e.clientY, view });
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const c = cellOf(e);
    if (c === undefined) return;
    const button = e.button === 2 ? 'right' : 'left';
    if (props.brush !== undefined) setStroke({ button, last: c, cells: addCells(new Map(), brushCells(c, props.brush)) });
    else setDrag({ start: c, end: c, button });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pan !== undefined) {
      setView(panView(pan.view, e.clientX - pan.x, e.clientY - pan.y));
      setUserView(true);
      return;
    }
    const c = cellOf(e);
    if (c !== undefined && (hover === undefined || c[0] !== hover[0] || c[1] !== hover[1])) setHover(c);
    if (drag !== undefined && c !== undefined && (c[0] !== drag.end[0] || c[1] !== drag.end[1])) setDrag({ ...drag, end: c });
    if (stroke !== undefined && c !== undefined && props.brush !== undefined && (c[0] !== stroke.last[0] || c[1] !== stroke.last[1])) {
      setStroke({ ...stroke, last: c, cells: addCells(stroke.cells, strokeCells(stroke.last, c, props.brush)) });
    }
    if (e.shiftKey !== shift) setShift(e.shiftKey);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pan !== undefined) {
      setPan(undefined);
      return;
    }
    if (stroke !== undefined) {
      setStroke(undefined);
      props.onGesture({ kind: 'brush', button: stroke.button, cells: [...stroke.cells.values()] });
      return;
    }
    if (drag === undefined) return;
    const end = cellOf(e) ?? drag.end;
    setDrag(undefined);
    const g = interpretSiteGesture(props.tool, drag.button, drag.start, end);
    if (g.kind === 'wallPoint') {
      const step = draftClick(draft, snapPoint(draft[draft.length - 1], g.cell, e.shiftKey));
      if (step.done === 'ring') {
        setDraft([]);
        props.onWall(step.points, true);
      } else setDraft(step.points);
      return;
    }
    if (g.kind === 'wallUndoPoint') {
      setDraft(draft.slice(0, -1));
      return;
    }
    props.onGesture(g);
  };

  const onDoubleClick = () => {
    if (props.tool === 'wall' && draft.length > 0) finish(draft);
  };

  const refit = () => {
    if (size === undefined) return;
    setUserView(false);
    setView(fitView(bounds, size.w, size.h));
  };
  const zoomBy = (f: number) => {
    if (size === undefined) return;
    setView((v) => (v === undefined ? v : zoomView(v, f, size.w / 2, size.h / 2)));
    setUserView(true);
  };

  const cursor = pan !== undefined ? 'grabbing' : props.tool === 'select' ? 'pointer' : props.tool === 'wall' || props.tool === 'gate' ? 'crosshair' : 'cell';
  return (
    <div className="siteplan-host" ref={hostRef}>
      <canvas
        ref={canvasRef}
        className="siteplan"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDrag(undefined);
          setPan(undefined);
          setStroke(undefined);
        }}
        onPointerLeave={() => setHover(undefined)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Plan Umgebung: Zonen malen, Gelände formen, Mauern ziehen, Türme und Windmühlen setzen. Mausrad zoomt, mittlere Maustaste verschiebt."
      />
      <div className="siteplan-zoom" role="group" aria-label="Plan zoomen">
        <button type="button" onClick={() => zoomBy(1.25)} title="Hineinzoomen (Mausrad)" aria-label="Hineinzoomen">
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} title="Herauszoomen (Mausrad)" aria-label="Herauszoomen">
          −
        </button>
        <button type="button" onClick={refit} title="Plan einpassen: Haus, Grundstück und alle Bauwerke" aria-label="Plan einpassen">
          ⤢
        </button>
      </div>
      {top !== undefined && top.ranks.size > 0 && (
        <div className="siteplan-legend" aria-label="Legende Wege">
          {PATH_RANKS.filter((r) => top.ranks.has(r.rank)).map((r) => (
            <span key={r.rank}>
              <i className="swatch" style={{ background: css(r.color) }} />
              {r.label}
            </span>
          ))}
        </div>
      )}
      {props.tool === 'wall' && draft.length > 0 && (
        <div className="siteplan-note" role="status">
          Mauerzug: {draft.length} {draft.length === 1 ? 'Punkt' : 'Punkte'} · Doppelklick/Enter beendet · Klick auf den ersten Punkt schließt den Ring · Rücktaste nimmt zurück · Esc bricht ab
        </div>
      )}
    </div>
  );
}

interface Ui {
  readonly drag: Drag | undefined;
  readonly hover: Cell | undefined;
  readonly draft: readonly Cell[];
  readonly shift: boolean;
  readonly stroke: Stroke | undefined;
}

function draw(g: CanvasRenderingContext2D, w: number, h: number, v: SiteView, p: Props, site: SiteState | undefined, top: TopView | undefined, ui: Ui): void {
  const c = v.cell;
  const X = (x: number): number => (x - v.x0) * c;
  const Z = (z: number): number => (z - v.z0) * c;
  const mid = (cell: Cell): [number, number] => [X(cell[0] + 0.5), Z(cell[1] + 0.5)];
  g.fillStyle = SURFACE.plan;
  g.fillRect(0, 0, w, h);

  // Grundstück (ohne Berechnung: schlichte Wiese) und berechnete Draufsicht
  const plot = site?.plot;
  const terrainOn = p.sur?.terrain === true && site !== undefined;
  if (plot !== undefined) {
    g.fillStyle = terrainOn ? 'rgba(90, 130, 60, 0.35)' : 'rgba(90, 130, 60, 0.12)';
    g.fillRect(X(plot.minX), Z(plot.minZ), (plot.maxX - plot.minX + 1) * c, (plot.maxZ - plot.minZ + 1) * c);
  }
  if (top !== undefined) {
    g.imageSmoothingEnabled = false;
    g.drawImage(top.canvas, X(top.minX), Z(top.minZ), top.canvas.width * c, top.canvas.height * c);
  }

  // Raster (nur wenn die Zellen groß genug sind)
  if (c >= 6) {
    const xa = Math.floor(v.x0);
    const xb = Math.ceil(v.x0 + w / c);
    const za = Math.floor(v.z0);
    const zb = Math.ceil(v.z0 + h / c);
    g.lineWidth = 1;
    g.beginPath();
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let x = xa; x <= xb; x++) {
      g.moveTo(Math.round(X(x)) + 0.5, 0);
      g.lineTo(Math.round(X(x)) + 0.5, h);
    }
    for (let z = za; z <= zb; z++) {
      g.moveTo(0, Math.round(Z(z)) + 0.5);
      g.lineTo(w, Math.round(Z(z)) + 0.5);
    }
    g.stroke();
  }

  // Terraforming: anheben orange, senken blau, ebnen hell, geglättet türkis (Deckkraft nach Stärke)
  if (site !== undefined) {
    for (const [k, s] of site.sculpt) {
      const i = k.indexOf(',');
      const x = Number(k.slice(0, i));
      const z = Number(k.slice(i + 1));
      const col =
        s.level !== undefined ? SCULPT_COLOR.flatten : s.delta > 0 ? SCULPT_COLOR.raise : s.delta < 0 ? SCULPT_COLOR.lower : s.smooth === true ? SCULPT_COLOR.smooth : SCULPT_COLOR.reset;
      g.fillStyle = rgba(col, Math.min(0.6, 0.18 + Math.abs(s.delta) * 0.06));
      g.fillRect(X(x), Z(z), c, c);
    }
  }

  // Zonen: Füllung zart (ohne Berechnung kräftiger), Umriss, Beschriftung
  g.font = '600 11px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const zone of site?.zones ?? []) {
    const col = ZONE_COLOR.get(zone.kind) ?? 0xffffff;
    const selected = p.selected?.kind === 'zone' && p.selected.id === zone.id;
    if (top === undefined || !terrainOn) {
      g.fillStyle = rgba(col, terrainOn ? 0.45 : 0.2);
      for (const [x, z] of zone.cells) g.fillRect(X(x), Z(z), c, c);
    }
    g.strokeStyle = selected ? '#ffd65a' : rgba(col, 0.95);
    g.lineWidth = selected ? 3 : 1.5;
    g.setLineDash(terrainOn ? [] : [4, 3]);
    g.beginPath();
    for (const [x1, z1, x2, z2] of outline(zone.cells)) {
      g.moveTo(X(x1), Z(z1));
      g.lineTo(X(x2), Z(z2));
    }
    g.stroke();
    g.setLineDash([]);
    const b = zone.cells.bounds();
    if (b !== undefined && (b.maxX - b.minX + 1) * c > 40) {
      const label = `${zoneLabel(zone.kind)} · ${zone.id}`;
      const cx = X((b.minX + b.maxX + 1) / 2);
      const cy = Z((b.minZ + b.maxZ + 1) / 2);
      const tw = g.measureText(label).width + 8;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(cx - tw / 2, cy - 7, tw, 14);
      g.fillStyle = '#f2f2f2';
      g.fillText(label, cx, cy);
    }
  }

  // Haus: Räume aller Etagen (Erdgeschoss in Raumfarbe), Außentüren
  const rooms = p.state.rooms;
  const lowest = Math.min(...p.state.floors.map((f) => f.index));
  for (const room of rooms) {
    g.fillStyle = room.floorIndex === lowest ? rgba(roomTypeColor(room.roomTypeId), 0.75) : 'rgba(80, 86, 95, 0.6)';
    for (const [x, z] of room.cells) g.fillRect(X(x), Z(z), c, c);
  }
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 1;
  g.beginPath();
  for (const room of rooms) {
    if (room.floorIndex !== lowest) continue;
    for (const [x1, z1, x2, z2] of outline(room.cells)) {
      g.moveTo(X(x1), Z(z1));
      g.lineTo(X(x2), Z(z2));
    }
  }
  g.stroke();
  g.fillStyle = '#7a5534';
  for (const cell of p.shell.cells) {
    if (cell.kind === 'door' && cell.exterior === true && cell.orient?.half === 'lower') g.fillRect(X(cell.pos[0]) + c * 0.15, Z(cell.pos[2]) + c * 0.15, c * 0.7, c * 0.7);
  }

  // Grundstücksgrenze
  if (plot !== undefined) {
    g.strokeStyle = terrainOn ? 'rgba(224, 180, 76, 0.9)' : 'rgba(224, 180, 76, 0.45)';
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    g.strokeRect(X(plot.minX), Z(plot.minZ), (plot.maxX - plot.minX + 1) * c, (plot.maxZ - plot.minZ + 1) * c);
    g.setLineDash([]);
  }

  // Bauwerke
  for (const item of p.sur?.structures ?? []) drawStructure(g, item, c, X, Z, mid, p.selected?.kind === 'structure' && p.selected.id === item.id);

  // Vorschau des Werkzeugs
  const { drag, hover, draft, stroke } = ui;
  const rectDrag = drag !== undefined && (RECT_TOOLS.has(p.tool) || (drag.button === 'right' && (p.tool === 'select' || p.tool === 'zone' || p.tool === 'plot'))) ? drag : undefined;
  if (p.brush !== undefined) {
    // Runder Pinsel (Weg, Glätten): Strich füllen, sonst den Pinsel unter dem Zeiger umranden
    const col = stroke?.button === 'right' ? 0xe5484d : p.tool === 'sculpt' ? SCULPT_COLOR[p.sculptTool] : (ZONE_COLOR.get(p.zoneKind) ?? 0xffffff);
    if (stroke !== undefined) {
      g.fillStyle = rgba(col, 0.55);
      for (const [x, z] of stroke.cells.values()) g.fillRect(X(x), Z(z), c, c);
    }
    if (hover !== undefined) {
      g.strokeStyle = css(col);
      g.lineWidth = 2;
      g.beginPath();
      for (const [x1, z1, x2, z2] of outline(brushCells(hover, p.brush))) {
        g.moveTo(X(x1), Z(z1));
        g.lineTo(X(x2), Z(z2));
      }
      g.stroke();
    }
  } else if (rectDrag !== undefined) {
    const d = rectDrag;
    const r: Rect = { x1: Math.min(d.start[0], d.end[0]), z1: Math.min(d.start[1], d.end[1]), x2: Math.max(d.start[0], d.end[0]), z2: Math.max(d.start[1], d.end[1]) };
    const erase = d.button === 'right';
    const click = d.start[0] === d.end[0] && d.start[1] === d.end[1];
    if (!click || p.tool === 'sculpt') {
      const col = erase ? 0xe5484d : p.tool === 'zone' ? (ZONE_COLOR.get(p.zoneKind) ?? 0xffffff) : p.tool === 'sculpt' ? SCULPT_COLOR[p.sculptTool] : 0xe0b44c;
      const x = X(r.x1);
      const z = Z(r.z1);
      const ww = (r.x2 - r.x1 + 1) * c;
      const hh = (r.z2 - r.z1 + 1) * c;
      g.fillStyle = rgba(col, erase ? 0.25 : 0.4);
      g.fillRect(x, z, ww, hh);
      g.strokeStyle = css(col);
      g.lineWidth = 2;
      g.setLineDash(erase || p.tool === 'plot' ? [5, 3] : []);
      g.strokeRect(x + 1, z + 1, ww - 2, hh - 2);
      g.setLineDash([]);
      const what = erase ? (p.tool === 'sculpt' ? 'natürlich' : 'radieren') : p.tool === 'zone' ? zoneLabel(p.zoneKind) : p.tool === 'sculpt' ? (SCULPT_OPTIONS.find((o) => o.id === p.sculptTool)?.label ?? '') : 'Grundstück';
      label(g, `${what} ${r.x2 - r.x1 + 1} × ${r.z2 - r.z1 + 1}`, x + ww / 2, z + hh / 2);
    }
  } else if (drag !== undefined && p.tool === 'select' && drag.button === 'left' && (drag.start[0] !== drag.end[0] || drag.start[1] !== drag.end[1])) {
    g.strokeStyle = 'rgba(255, 214, 90, 0.95)';
    g.lineWidth = 2;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(...mid(drag.start));
    g.lineTo(...mid(drag.end));
    g.stroke();
    g.setLineDash([]);
    label(g, `verschieben ${drag.end[0] - drag.start[0]}, ${drag.end[1] - drag.start[1]}`, ...mid(drag.end));
  } else if (p.tool === 'wall') {
    const next = hover === undefined ? undefined : snapPoint(draft[draft.length - 1], hover, ui.shift);
    const pts = next === undefined ? draft : [...draft, next];
    if (pts.length > 0) {
      g.strokeStyle = 'rgba(255, 214, 90, 0.95)';
      g.lineWidth = Math.max(2, c * 0.6);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      pts.forEach((pt, i) => (i === 0 ? g.moveTo(...mid(pt)) : g.lineTo(...mid(pt))));
      g.stroke();
      g.lineCap = 'butt';
      const first = draft[0];
      const closing = first !== undefined && next !== undefined && draft.length >= 3 && Math.max(Math.abs(next[0] - first[0]), Math.abs(next[1] - first[1])) <= CLOSE_SNAP;
      draft.forEach((pt, i) => {
        const [x, z] = mid(pt);
        g.fillStyle = i === 0 && closing ? '#6fdc8c' : '#ffd65a';
        g.beginPath();
        g.arc(x, z, Math.max(3, c * (i === 0 && closing ? 0.7 : 0.4)), 0, Math.PI * 2);
        g.fill();
      });
      if (closing) label(g, 'Ring schließen', ...mid(first));
    }
  } else if (hover !== undefined && (p.tool === 'tower' || p.tool === 'windmill')) {
    const size = p.tool === 'tower' ? towerSize(p.tower) : towerSize({ shape: 'round' });
    ghostTower(g, hover, size, p.tool === 'tower' ? p.tower.shape : 'round', c, X, Z);
    if (p.tool === 'windmill') sails(g, hover, size, p.windmill.facing, 7, c, mid, 'rgba(236, 228, 212, 0.8)');
  } else if (hover !== undefined && p.tool === 'annex') {
    // Vorschau: Lage an der nächsten Außenwand und die Türen je Etage (wie beim Setzen); sonst der Grund
    let spec: AnnexSpec | undefined;
    let why = '';
    try {
      spec = annexAt(p.state, p.shell, hover, p.annex);
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    if (spec !== undefined) {
      ghostTower(g, spec.center, towerSize(spec), spec.shape ?? 'square', c, X, Z);
      g.fillStyle = '#ffd65a';
      for (const o of spec.openings ?? []) g.fillRect(X(o.at[0]) + c * 0.2, Z(o.at[1]) + c * 0.2, c * 0.6, c * 0.6);
      label(g, `${spec.openings?.length ?? 0} Tür(en) ins Haus`, ...mid(spec.center));
    } else {
      g.strokeStyle = '#e5484d';
      g.lineWidth = 2;
      g.strokeRect(X(hover[0]) + 0.5, Z(hover[1]) + 0.5, c - 1, c - 1);
      label(g, why.replace(/^[^:]*: /, ''), ...mid(hover));
    }
  } else if (hover !== undefined && p.tool === 'gate') {
    const near = nearestWall(p.sur, hover);
    const ok = near !== undefined && near.dist <= GATE_SNAP;
    g.strokeStyle = ok ? '#6fdc8c' : '#e5484d';
    g.lineWidth = 2;
    g.strokeRect(X(hover[0] - 1), Z(hover[1] - 1), 3 * c, 3 * c);
    if (!ok) label(g, 'Tor: auf eine Mauer klicken', ...mid(hover));
  } else if (hover !== undefined && drag === undefined) {
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 1;
    g.strokeRect(X(hover[0]) + 0.5, Z(hover[1]) + 0.5, c - 1, c - 1);
  }
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  g.font = '600 11px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const tw = g.measureText(text).width + 10;
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(x - tw / 2, y - 8, tw, 16);
  g.fillStyle = '#ffffff';
  g.fillText(text, x, y);
}

function ghostTower(g: CanvasRenderingContext2D, center: Cell, size: number, shape: 'round' | 'square', c: number, X: (x: number) => number, Z: (z: number) => number): void {
  const r = (size - 1) / 2;
  g.fillStyle = 'rgba(200, 195, 185, 0.35)';
  g.strokeStyle = 'rgba(255, 214, 90, 0.9)';
  g.lineWidth = 2;
  if (shape === 'square') {
    g.fillRect(X(center[0] - r), Z(center[1] - r), size * c, size * c);
    g.strokeRect(X(center[0] - r), Z(center[1] - r), size * c, size * c);
  } else {
    g.beginPath();
    g.arc(X(center[0] + 0.5), Z(center[1] + 0.5), (r + 0.5) * c, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}

function sails(g: CanvasRenderingContext2D, center: Cell, size: number, facing: HorizontalDir, length: number, c: number, mid: (cell: Cell) => [number, number], color: string): void {
  const [fx, fz] = DIR_XZ[facing];
  const r = (size - 1) / 2;
  const hub: Cell = [center[0] + fx * (r + 2), center[1] + fz * (r + 2)];
  const a: Cell = [hub[0] - fz * length, hub[1] + fx * length];
  const b: Cell = [hub[0] + fz * length, hub[1] - fx * length];
  g.strokeStyle = color;
  g.lineWidth = Math.max(2, c * 0.8);
  g.beginPath();
  g.moveTo(...mid(a));
  g.lineTo(...mid(b));
  g.stroke();
}

function drawStructure(
  g: CanvasRenderingContext2D,
  item: StructureItem,
  c: number,
  X: (x: number) => number,
  Z: (z: number) => number,
  mid: (cell: Cell) => [number, number],
  selected: boolean,
): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (item.kind === 'wall') {
    const plan = item.plan;
    const pts = plan.closed === true ? [...plan.points, plan.points[0]!] : plan.points;
    const width = (plan.thickness ?? (plan.profile === 'garden' ? 1 : 3)) * c;
    const trace = (): void => {
      g.beginPath();
      pts.forEach((pt, i) => (i === 0 ? g.moveTo(...mid(pt)) : g.lineTo(...mid(pt))));
      g.stroke();
    };
    if (selected) {
      g.strokeStyle = 'rgba(255, 214, 90, 0.9)';
      g.lineWidth = width + 6;
      trace();
    }
    g.strokeStyle = plan.profile === 'garden' ? 'rgba(170, 200, 150, 0.85)' : 'rgba(205, 198, 184, 0.85)';
    g.lineWidth = Math.max(2, width);
    trace();
    g.fillStyle = selected ? '#ffd65a' : '#3a3f46';
    for (const pt of plan.points) {
      const [x, z] = mid(pt);
      g.fillRect(x - 3, z - 3, 6, 6);
    }
    for (const gate of plan.gates ?? []) {
      const [x, z] = mid(gate.at);
      const s = Math.max(8, (gate.width ?? 3) * c);
      g.fillStyle = '#e0b44c';
      g.strokeStyle = '#1b1609';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, z, s / 2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    const [lx, lz] = mid(plan.points[0]!);
    tag(g, item.id, lx, lz - Math.max(10, width));
  } else if (item.kind === 'parapet') {
    return; // Wehrplatte hängt am Baukörper (Spalten kennt nur die Hülle) – kein eigenes Symbol auf dem Plan
  } else {
    const spec = item.spec;
    const size = towerSize(spec);
    const shape = ('shape' in spec ? spec.shape : undefined) ?? 'round';
    const r = (size - 1) / 2;
    g.fillStyle = item.kind === 'windmill' ? 'rgba(190, 170, 140, 0.55)' : 'rgba(200, 195, 185, 0.55)';
    g.strokeStyle = selected ? '#ffd65a' : 'rgba(40, 40, 40, 0.9)';
    g.lineWidth = selected ? 3 : 1.5;
    if (shape === 'square') {
      g.fillRect(X(spec.center[0] - r), Z(spec.center[1] - r), size * c, size * c);
      g.strokeRect(X(spec.center[0] - r), Z(spec.center[1] - r), size * c, size * c);
    } else {
      g.beginPath();
      g.arc(X(spec.center[0] + 0.5), Z(spec.center[1] + 0.5), (r + 0.5) * c, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (item.kind === 'windmill') sails(g, spec.center, size, item.spec.facing ?? 'south', item.spec.sailLength ?? 7, c, mid, selected ? '#ffd65a' : 'rgba(236, 228, 212, 0.9)');
    const [x, z] = mid(spec.center);
    tag(g, item.id, x, z);
  }
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
}

function tag(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  g.font = '700 10px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const tw = g.measureText(text).width + 6;
  g.fillStyle = 'rgba(0,0,0,0.65)';
  g.fillRect(x - tw / 2, y - 7, tw, 14);
  g.fillStyle = '#ffe28a';
  g.fillText(text, x, y);
}
