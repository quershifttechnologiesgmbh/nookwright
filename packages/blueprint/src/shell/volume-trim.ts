/**
 * W12-C (Review R6-4 „weißer Kantenrahmen der Scheune“): Kantenrolle je Baukörper (`Volume.exterior.trim`).
 *
 * Nach der fertigen Hülle (Wände, Dach, Außenprofil) wechseln bei Baukörpern mit eigener Kantenrolle nur Rollen, keine
 * Belegung:
 *  - Dachkante: jede Zelle in `roof_trim` (Ortgang, Traufe, First, Windbrett) und jede Dachzelle im Überstand jenseits
 *    der Giebelwände (Ortgang als ganzer Rand, First entlang der Langseite) → Kantenrolle; Form und Ausrichtung bleiben.
 *  - Außenecken: die Eckspalte jeder Außenecke (Anker `corner`) vom Erdgeschoss bis unter das Dach – Eckpfeiler,
 *    Eckquader und die Eckzellen von Deckenring und Kniestock – wird ein Vollblock in der Kantenrolle (Eckbrett des
 *    Rahmens, wie die weißen Eckbretter roter Scheunen).
 * Vorbilder: This Old House „Why barns are red“ (weiße Kanten an Ecken, Ortgang, Toren), PlanetMinecraft „Red Barn“
 * (Quarz/weiße Kanten an Giebel und Ecken); URLs in plan/spikes/W12C_bauernhof_details.md.
 * Ohne Baukörper mit `exterior.trim` gibt die Funktion die Hülle unverändert zurück (bitgleich).
 */
import { cellKey } from '@mcda/core';
import type { ProjectState, RoomId } from '../model.js';
import { allVolumes, volumeOf } from '../volumes.js';
import { CW, OPP, STEP } from './grid.js';
import type { Shell, ShellCell } from './types.js';

/** Zellarten der Eckspalte, die zur Ecke gehören (Wand, Pfeiler, Decken- und Kniestockring). */
/** Reichweite des Ortgang-Überstands (Blöcke jenseits der Giebelwand; Dachüberstand ≤ 2). */
const VERGE_REACH = 2;

const CORNER_KINDS: ReadonlySet<ShellCell['kind']> = new Set(['pillar', 'wall', 'ceiling']);

export function applyVolumeTrim(shell: Shell, state: Pick<ProjectState, 'rooms' | 'volumes'>): Shell {
  const trimOf = new Map<string, string>();
  for (const v of allVolumes(state)) if (v.exterior?.trim !== undefined) trimOf.set(v.id, v.exterior.trim);
  if (trimOf.size === 0) return shell;
  const roomTrim = new Map<RoomId, string>();
  for (const r of state.rooms) {
    const t = trimOf.get(volumeOf(r));
    if (t !== undefined) roomTrim.set(r.id, t);
  }
  if (roomTrim.size === 0) return shell;
  // Ortgang: Dachzellen jenseits der Giebelwände (Überstand in Firstrichtung; First entlang der Langseite des Rechtecks)
  // Die Überstandszellen des Ortgangs gehören zu keinem Raum (`roomId` fehlt): sie zählen zum Baukörper, wenn ihre Spalte
  // höchstens `VERGE_REACH` jenseits der Giebelwand und quer dazu innerhalb der Hülle ± `VERGE_REACH` liegt.
  const verge = new Map<string, (x: number, z: number) => boolean>();
  const loose: Array<{ role: string; at: (x: number, z: number) => boolean }> = [];
  for (const [v, role] of trimOf) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of state.rooms) {
      if (volumeOf(r) !== v) continue;
      for (const [x, z] of r.cells) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    }
    if (x0 > x1) continue;
    const R = VERGE_REACH;
    const alongX = x1 - x0 >= z1 - z0;
    verge.set(v, alongX ? (x) => x < x0 || x > x1 : (_x, z) => z < z0 || z > z1);
    loose.push({
      role,
      at: alongX
        ? (x, z) => ((x >= x0 - R && x < x0) || (x > x1 && x <= x1 + R)) && z >= z0 - R && z <= z1 + R
        : (x, z) => ((z >= z0 - R && z < z0) || (z > z1 && z <= z1 + R)) && x >= x0 - R && x <= x1 + R,
    });
  }
  const roomVerge = new Map<RoomId, (x: number, z: number) => boolean>();
  for (const r of state.rooms) {
    const f = verge.get(volumeOf(r));
    if (f !== undefined) roomVerge.set(r.id, f);
  }
  // Eckspalten je Kantenrolle: Spalte → unterste Reihe (Wandfuß der Ecke)
  const corners = new Map<string, { role: string; y: number }>();
  for (const a of shell.anchors ?? []) {
    if (a.kind !== 'corner' || a.roomId === undefined) continue;
    const role = roomTrim.get(a.roomId);
    if (role === undefined) continue;
    const d = a.facing;
    const x = a.pos[0] + STEP[OPP[d]][0] + STEP[OPP[CW[d]]][0];
    const z = a.pos[2] + STEP[OPP[d]][1] + STEP[OPP[CW[d]]][1];
    const k = cellKey(x, z);
    const had = corners.get(k);
    if (had === undefined || a.pos[1] < had.y) corners.set(k, { role, y: a.pos[1] });
  }
  let changed = false;
  const cells = shell.cells.map((c): ShellCell => {
    if (c.roomId === undefined) {
      if (c.kind !== 'roof' || (c.role !== 'roof_trim' && c.role !== 'roof_main')) return c;
      const hit = loose.filter((l) => l.at(c.pos[0], c.pos[2]));
      if (hit.length !== 1) return c;
      changed = true;
      return { ...c, role: hit[0]!.role };
    }
    const role = roomTrim.get(c.roomId);
    if (role === undefined) return c;
    if (c.role === 'roof_trim' || (c.kind === 'roof' && roomVerge.get(c.roomId!)?.(c.pos[0], c.pos[2]) === true)) {
      changed = true;
      return { ...c, role };
    }
    const corner = corners.get(cellKey(c.pos[0], c.pos[2]));
    if (corner !== undefined && corner.role === role && c.exterior === true && c.pos[1] >= corner.y && CORNER_KINDS.has(c.kind)) {
      changed = true;
      const { orient: _o, ...rest } = c;
      return { ...rest, kind: c.kind === 'ceiling' ? 'pillar' : c.kind, role, shape: 'block' };
    }
    return c;
  });
  return changed ? { ...shell, cells } : shell;
}

/** W16-B: Suchweite (Chebyshev) für Dachzellen ohne Raum (Überstand) zur nächsten Raumspalte. */
const ROOF_REACH = 3;

/**
 * W16-B (Review R7-2 „Dächer braun in braun“): Dachrolle je Baukörper (`Volume.exterior.roof`). Nach der fertigen Hülle
 * wechseln die Dachflächen-Zellen (`roof_main`) des Baukörpers die Rolle, Belegung, Form und Ausrichtung bleiben. Zellen
 * ohne Raum (Überstand an Traufe und Ortgang) gehören zum Baukörper der nächsten Raumspalte (Chebyshev ≤ 3, bei
 * Gleichstand zu keinem). Ohne Baukörper mit `exterior.roof` gibt die Funktion die Hülle unverändert zurück (bitgleich).
 */
export function applyVolumeRoof(shell: Shell, state: Pick<ProjectState, 'rooms' | 'volumes'>): Shell {
  const roofOf = new Map<string, string>();
  for (const v of allVolumes(state)) if (v.exterior?.roof !== undefined) roofOf.set(v.id, v.exterior.roof);
  if (roofOf.size === 0) return shell;
  const roomVol = new Map<RoomId, string>();
  const column = new Map<string, string>();
  for (const r of state.rooms) {
    const v = volumeOf(r);
    roomVol.set(r.id, v);
    for (const [x, z] of r.cells) {
      const k = cellKey(x, z);
      const had = column.get(k);
      column.set(k, had === undefined || had === v ? v : '');
    }
  }
  /** Baukörper der nächsten Raumspalte (Ring für Ring); mehrdeutig oder keiner: undefined. */
  const nearest = (x: number, z: number): string | undefined => {
    for (let d = 0; d <= ROOF_REACH; d++) {
      const found = new Set<string>();
      for (let dx = -d; dx <= d; dx++) {
        for (let dz = -d; dz <= d; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
          const v = column.get(cellKey(x + dx, z + dz));
          if (v !== undefined) found.add(v);
        }
      }
      if (found.size > 0) return found.size === 1 && !found.has('') ? [...found][0] : undefined;
    }
    return undefined;
  };
  let changed = false;
  const cells = shell.cells.map((c): ShellCell => {
    if (c.kind !== 'roof' || c.role !== 'roof_main') return c;
    const v = c.roomId !== undefined ? roomVol.get(c.roomId) : nearest(c.pos[0], c.pos[2]);
    const role = v === undefined ? undefined : roofOf.get(v);
    if (role === undefined) return c;
    changed = true;
    return { ...c, role };
  });
  return changed ? { ...shell, cells } : shell;
}
