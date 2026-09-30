/**
 * Baukörper (research/19 §7.4): Nachschlagen, effektive Etagen und Invariante. Rein; geteilt von Aggregat, Reducer,
 * Treppen-Invariante und Hülle.
 *
 * Effektive Etagen: Die Projekt-Etagen geben Indizes, Böden und lichte Höhen vor. Ein Baukörper verschiebt alle
 * Bodenplatten um `baseOffset` und darf je Etage eine eigene lichte Höhe haben (`floorHeights`). Abweichende Höhen
 * verschieben – wie `FloorHeightChanged` – die Etagen darüber (ab dem Erdgeschoss) bzw. darunter (Keller):
 *
 *   y0_V(f) = y0(f) + baseOffset + Σ_{0 ≤ k < f} (h_V(k) − h(k))     f ≥ 0
 *   y0_V(f) = y0(f) + baseOffset − Σ_{f ≤ k < 0} (h_V(k) − h(k))     f < 0
 *
 * Ohne Angaben ist jede Etage exakt die Projekt-Etage (bitgleich).
 *
 * Invariante „Baukörper überschneiden sich nicht“: Zellen von Räumen verschiedener Baukörper liegen auf keiner Etage
 * in derselben Spalte. Jede Spalte gehört also höchstens einem Baukörper – Grenzen zwischen Baukörpern sind senkrecht
 * (Brandwand), ein Dach überdeckt nie einen fremden Baukörper.
 */
import { cellKey } from '@mcda/core';
import {
  DEFAULT_VOLUME, FLOOR_HEIGHT,
  type BuildingSetting, type Floor, type ProjectState, type Room, type RoomId, type SettingKind, type Volume, type VolumeId,
} from './model.js';

/** Eigenschaften eines Baukörpers ohne ID (Befehle). */
export type VolumeProps = Omit<Volume, 'id'>;

/** Zulässiger Versatz der Basishöhe (Blöcke). */
export const VOLUME_OFFSET = { min: -64, max: 64 } as const;

const SETTINGS: ReadonlySet<SettingKind> = new Set(['ground', 'buried', 'cliff', 'carved', 'stilts', 'tree', 'water', 'underwater']);

export const volumeOf = (room: Pick<Room, 'volumeId'>): VolumeId => room.volumeId ?? DEFAULT_VOLUME;

/** Baukörper nach ID; der Standard-Baukörper existiert immer (ohne Eintrag: keine Eigenschaften). */
export function volumeById(state: Pick<ProjectState, 'volumes'>, id: VolumeId): Volume | undefined {
  const v = state.volumes?.find((x) => x.id === id);
  if (v !== undefined) return v;
  return id === DEFAULT_VOLUME ? { id: DEFAULT_VOLUME } : undefined;
}

/** Alle Baukörper: der Standard-Baukörper zuerst, dann die übrigen in Anlage-Reihenfolge. */
export function allVolumes(state: Pick<ProjectState, 'volumes'>): Volume[] {
  return [volumeById(state, DEFAULT_VOLUME)!, ...(state.volumes ?? []).filter((v) => v.id !== DEFAULT_VOLUME)];
}

/** Effektive Etagen eines Baukörpers (nach Index aufsteigend, wie `state.floors`). */
export function volumeFloors(state: Pick<ProjectState, 'floors' | 'volumes'>, volume: Volume | VolumeId): Floor[] {
  const v = typeof volume === 'string' ? volumeById(state, volume) : volume;
  const floors = [...state.floors].sort((a, b) => a.index - b.index);
  const offset = v?.baseOffset ?? 0;
  const own = v?.floorHeights;
  if (offset === 0 && (own === undefined || Object.keys(own).length === 0)) return floors;
  const heightOf = (f: Floor): number => own?.[f.index] ?? f.height;
  const diff = (f: Floor): number => heightOf(f) - f.height;
  return floors.map((f) => {
    let shift = offset;
    for (const k of floors) {
      if (f.index >= 0 && k.index >= 0 && k.index < f.index) shift += diff(k);
      if (f.index < 0 && k.index >= f.index && k.index < 0) shift -= diff(k);
    }
    return { index: f.index, y0: f.y0 + shift, height: heightOf(f) };
  });
}

/** Effektive Etage eines Raums (Boden und lichte Höhe seines Baukörpers). */
export function roomFloor(state: Pick<ProjectState, 'floors' | 'volumes'>, room: Pick<Room, 'floorIndex' | 'volumeId'>): Floor | undefined {
  return volumeFloors(state, volumeOf(room)).find((f) => f.index === room.floorIndex);
}

/** Effektive Etage je Raum (für Reducer und Hülle). */
export function roomFloors(state: Pick<ProjectState, 'floors' | 'volumes' | 'rooms'>): Map<RoomId, Floor> {
  const byVolume = new Map<VolumeId, Map<number, Floor>>();
  const out = new Map<RoomId, Floor>();
  for (const r of state.rooms) {
    const v = volumeOf(r);
    let floors = byVolume.get(v);
    if (floors === undefined) byVolume.set(v, (floors = new Map(volumeFloors(state, v).map((f) => [f.index, f] as const))));
    const f = floors.get(r.floorIndex);
    if (f !== undefined) out.set(r.id, f);
  }
  return out;
}

/** Fachliche Prüfung der Eigenschaften; `undefined` = in Ordnung. */
export function checkVolume(p: VolumeProps): string | undefined {
  if (p.baseOffset !== undefined && (!Number.isInteger(p.baseOffset) || p.baseOffset < VOLUME_OFFSET.min || p.baseOffset > VOLUME_OFFSET.max)) {
    return `Basishöhe ${p.baseOffset} nicht erlaubt (ganzzahlig, ${VOLUME_OFFSET.min}–${VOLUME_OFFSET.max})`;
  }
  for (const [k, h] of Object.entries(p.floorHeights ?? {})) {
    if (!Number.isInteger(Number(k))) return `Etagenindex ${k} ist keine ganze Zahl`;
    if (!Number.isInteger(h) || h < FLOOR_HEIGHT.min || h > FLOOR_HEIGHT.max) return `Lichte Höhe ${h} (Etage ${k}) nicht erlaubt (${FLOOR_HEIGHT.min}–${FLOOR_HEIGHT.max})`;
  }
  const s: BuildingSetting | undefined = p.setting;
  if (s !== undefined && !SETTINGS.has(s.kind)) return `Unbekannte Lage ${String(s.kind)}`;
  return undefined;
}

/** Eigenschaften ohne leere Felder (serialisierbar, vergleichbar). */
export function cleanVolume(id: VolumeId, p: VolumeProps): Volume {
  const heights = p.floorHeights !== undefined && Object.keys(p.floorHeights).length > 0
    ? Object.fromEntries(Object.entries(p.floorHeights).sort((a, b) => Number(a[0]) - Number(b[0])))
    : undefined;
  return {
    id,
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.baseOffset !== undefined && p.baseOffset !== 0 ? { baseOffset: p.baseOffset } : {}),
    ...(heights !== undefined ? { floorHeights: heights } : {}),
    ...(p.roof !== undefined ? { roof: p.roof } : {}),
    ...(p.roofDetail !== undefined ? { roofDetail: p.roofDetail } : {}),
    ...(p.setting !== undefined ? { setting: p.setting } : {}),
    ...(p.exterior !== undefined ? { exterior: cleanExterior(p.exterior) } : {}),
  };
}

/** W12-C: Außengestaltung je Baukörper ohne leere Felder (Gruppen sortiert, doppelte entfernt). */
function cleanExterior(e: NonNullable<VolumeProps['exterior']>): NonNullable<Volume['exterior']> {
  const off = e.off === undefined ? [] : [...new Set(e.off)].sort();
  return {
    ...(e.trim !== undefined ? { trim: e.trim } : {}),
    ...(e.roof !== undefined ? { roof: e.roof } : {}),
    ...(off.length > 0 ? { off } : {}),
    ...(e.barn === true ? { barn: true } : {}),
  };
}

/** Gleiche Eigenschaften (nach `cleanVolume`). */
/** Etagenname wie in der Oberfläche (EG, 1. OG, 1. UG …) – die Domäne kennt nur den Index. */
const floorName = (index: number): string => (index === 0 ? 'EG' : index > 0 ? `${index}. OG` : `${-index}. UG`);

export const sameVolume = (a: Volume, b: Volume): boolean => JSON.stringify(cleanVolume(a.id, a)) === JSON.stringify(cleanVolume(b.id, b));

/**
 * Invariante: Räume verschiedener Baukörper teilen keine Spalte (auf keiner Etage). Geprüft werden nur Überschneidungen
 * mit den Räumen `of` (Standard: alle). Ergebnis: fachliche Begründung oder `undefined`.
 */
export function volumeClash(state: Pick<ProjectState, 'rooms'>, of?: ReadonlySet<RoomId>): string | undefined {
  const owner = new Map<string, Room>();
  for (const r of state.rooms) for (const [x, z] of r.cells) if (!owner.has(cellKey(x, z)) || of?.has(r.id) !== true) owner.set(cellKey(x, z), r);
  for (const r of state.rooms) {
    if (of !== undefined && !of.has(r.id)) continue;
    for (const [x, z] of r.cells) {
      const o = owner.get(cellKey(x, z))!;
      if (volumeOf(o) !== volumeOf(r)) {
        // Auftrag 3: lesbare Meldung – Etage und Raumtyp stehen im Zustand, die Anzeigenamen ergänzt die Oberfläche
        // (`translateHint` in der App ersetzt `Raum r296` durch „Wohnstube · 3 (1. OG)“).
        const a = volumeOf(r);
        const b = volumeOf(o);
        return `Räume verschiedener Baukörper dürfen sich nicht überdecken: Raum ${r.id} (Baukörper ${a}, Etage ${floorName(r.floorIndex)}, ${r.roomTypeId}) `
          + `überschneidet Raum ${o.id} (Baukörper ${b}, Etage ${floorName(o.floorIndex)}, ${o.roomTypeId}) bei ${x},${z}. `
          + `Der Bergfried einer Burg ist ein eigener Baukörper – seine Räume dürfen den Palas nicht überdecken (und umgekehrt)`;
      }
    }
  }
  return undefined;
}
