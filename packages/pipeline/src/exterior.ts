/**
 * Anwendungsdienst „Außengestaltung“ (X1): verbindet den Kontext @mcda/exterior mit Projekt, Materialisierung und
 * Gelände. Die Außen-Platzierungen sind abgeleitet wie die Hülle (nicht im Projekt gespeichert) und gehören zu
 * keinem Raum: Materialisierung als Möbel-Schicht (nur Luft), Licht-Pass und Spawn-Bericht messen nur die Räume.
 *
 * Gelände-Kopplung (`exteriorBuilding`): Außen-Zellen gelten als belegt (das Gelände setzt dort nichts, Bauwerke
 * entfallen dort), ihre bodennahen Spalten sperren Pflanzen (wie das Außenprofil), und Hindernisse in Laufhöhe
 * (Pfosten, Bank, Kübel, Kasten) sperren Wege über die Sperrfläche der Bauwerke. Die Vortreppe liegt auf
 * Bodenplattenhöhe im Türausgang – sie ersetzt dort den obersten Geländeblock und bleibt begehbar.
 */
import { DEFAULT_VOLUME, type Project, type Shell, type ShellCell } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { CellSet, key3, type MoodVector, type Vec3 } from '@mcda/core';
import {
  DEFAULT_CHIMNEY_TAGS, EXTERIOR_GROUPS, planExterior, type ExteriorGroup, type ExteriorPlacement, type ExteriorPlan, type ExteriorStyle, type RoomExterior,
} from '@mcda/exterior';
import { expandComponent, placeComponent } from '@mcda/furnishing';
import type { MaterializePlacement } from '@mcda/materialize';
import type { BuildingInfo } from '@mcda/terrain';
import { placedFor } from './world.js';
import { moodExteriorDensity } from './mood.js';

/**
 * Außen-Komponenten für eine Hülle (rein, deterministisch): Projekt-Seed (+ `style.variation`), Raumtypen (Aushängeschild)
 * und Feuerstellen der Einrichtung (Schornsteine). Ohne Einrichtung entfallen nur die Schornsteine.
 */
export function exteriorFor(project: Project, shell: Shell, catalog: Catalog, style0: ExteriorStyle = {}, mood?: MoodVector): ExteriorPlan {
  const s = project.state;
  // feat/theme-moods: Achse `richness` skaliert die Außen-Deko-Dichte (ohne Stimmung dasselbe Objekt, bitgleich)
  const density = moodExteriorDensity(style0.density, mood);
  const style = density === style0.density ? style0 : { ...style0, ...(density !== undefined ? { density } : {}) };
  const tags = new Set(style.chimneyTags ?? DEFAULT_CHIMNEY_TAGS);
  // Feuerstellen im Unterbau (Etage ≤ −2, feat/underground) bekommen keinen Schornstein – dort liegt Erdreich darüber;
  // ohne Unterbau gibt es diese Etagen nicht (bitgleich)
  const vault = new Set(s.rooms.filter((r) => r.floorIndex <= -2).map((r) => r.id));
  const fires = s.placements.filter((p) => !vault.has(p.roomId) && catalog.find(p.componentId)?.tags.some((t) => tags.has(t)) === true);
  const plan = planExterior(withFlatTowers(project, shell), catalog, {
    seed: s.seed,
    style,
    placements: fires.map((p) => ({ componentId: p.componentId, roomId: p.roomId, cells: placedFor(p, catalog).cells.map((c) => c.pos) })),
    roomTypes: Object.fromEntries(s.rooms.map((r) => [r.id, r.roomTypeId])),
    // W2-FW: das Theme wählt das Fenstermodul (gleiche Regel für App und Engine, beide rufen `exteriorFor`)
    themeId: s.themeId,
    // W15: Zielversion für die Fassaden-Details (Regal erst ab 1.21.9, sonst Fass)
    dataVersion: s.targetVersion.dataVersion,
    ...roomExteriorOf(project),
  });
  return withoutAnnexes(plan, shell);
}

/**
 * W12-C (Review R6-4): Außengestaltung je Raum aus dem Baukörper des Raums (`Volume.exterior`: abgeschaltete Gruppen,
 * Scheunentor). Ohne Baukörper mit `exterior` kein Feld (bitgleich). Unbekannte Gruppen-Namen fallen weg.
 */
function roomExteriorOf(project: Project): { roomExterior?: Record<string, RoomExterior> } {
  const s = project.state;
  const byVolume = new Map<string, RoomExterior>();
  for (const v of s.volumes ?? []) {
    const e = v.exterior;
    if (e === undefined) continue;
    const off = (e.off ?? []).filter((g): g is ExteriorGroup => (EXTERIOR_GROUPS as readonly string[]).includes(g));
    if (off.length === 0 && e.barn !== true) continue;
    byVolume.set(v.id, { ...(off.length > 0 ? { off } : {}), ...(e.barn === true ? { barn: true } : {}) });
  }
  if (byVolume.size === 0) return {};
  const out: Record<string, RoomExterior> = {};
  for (const r of s.rooms) {
    const e = byVolume.get(r.volumeId ?? DEFAULT_VOLUME);
    if (e !== undefined) out[r.id] = e;
  }
  return Object.keys(out).length === 0 ? {} : { roomExterior: out };
}

/**
 * W3-CA (Burg): Nebenbaukörper mit Flachdach (Bergfried mit Wehrplatte) gelten für die Planung wie angedockte Türme
 * als Anbau-Grundriss – Schornsteine des Nachbarn halten Abstand ≥ 2 (Krone und Stapel träfen sonst den Zinnenkranz,
 * der erst als Bauwerk entsteht), und in ihren Spalten liegt kein Außen-Teil. Gilt nur für die Planung; die echten
 * Anbauten (`withoutAnnexes`) bleiben unberührt. Ohne solchen Baukörper unverändert.
 */
function withFlatTowers(project: Project, shell: Shell): Shell {
  const s = project.state;
  const flat = (s.volumes ?? []).filter((v) => v.id !== DEFAULT_VOLUME && v.roof === 'flat').map((v) => v.id);
  if (flat.length === 0) return shell;
  const extra = flat.flatMap((id) => {
    const footprint = s.rooms.filter((r) => r.volumeId === id).reduce((u, r) => u.union(r.cells), CellSet.empty());
    return footprint.isEmpty ? [] : [{ id: `flat-${id}`, footprint, top: 0, doors: [], contactTop: 0 }];
  });
  return extra.length === 0 ? shell : { ...shell, annexes: [...(shell.annexes ?? []), ...extra] };
}

/**
 * Vertrag B2 (C4): Anbau-Grundrisse (`Shell.annexes`, dort steht der angedockte Turm) sind für Außen-Teile belegt. Der
 * Außen-Planer prüft beim seitlichen Versatz an der Haustür (Laternen, Kübel, Bank, Aushängeschild) nur Hülle und
 * Innenraum – Teile, die in einen Anbau-Grundriss fielen, entfallen hier. Ohne Anbauten unverändert.
 */
function withoutAnnexes(plan: ExteriorPlan, shell: Shell): ExteriorPlan {
  const annexes = shell.annexes ?? [];
  if (annexes.length === 0) return plan;
  const inAnnex = (c: Vec3): boolean => annexes.some((a) => a.footprint.has(c[0], c[2]));
  const placements = plan.placements.filter((p) => !p.cells.some(inAnnex));
  if (placements.length === plan.placements.length) return plan;
  const counts = { ...plan.counts };
  for (const p of plan.placements) if (!placements.includes(p)) counts[p.group] -= 1;
  return { ...plan, placements, counts };
}

/** Außen-Platzierungen → Eingang der Materialisierung (Schicht aus der Montage: Möbel, nur Luft). */
export function exteriorMaterializePlacements(exterior: readonly ExteriorPlacement[], catalog: Catalog): MaterializePlacement[] {
  return exterior.map((p) => ({ id: p.id, placed: placeComponent(expandComponent(catalog.get(p.componentId), p.variantId), p.pose), seed: p.seed }));
}

/**
 * Außen-Komponenten, die mit Zellen anderer Kontexte (Gelände, Vegetation, Bauwerke) zusammenfallen, entfallen
 * (das Gelände gewinnt, wie Bauwerke gegen das Haus). Mit `exteriorBuilding` gekoppelt kommt das nicht vor.
 */
export function fitExterior(exterior: readonly ExteriorPlacement[], cells: readonly ShellCell[]): { readonly placements: ExteriorPlacement[]; readonly warnings: string[] } {
  if (cells.length === 0) return { placements: [...exterior], warnings: [] };
  const other = new Set(cells.map((c) => key3(c.pos)));
  const placements = exterior.filter((p) => !p.cells.some((c) => other.has(key3(c))));
  const lost = exterior.length - placements.length;
  return { placements, warnings: lost > 0 ? [`Außen: ${lost} Komponenten überschneiden Gelände/Bauwerke und entfallen`] : [] };
}

/**
 * Gebäude-Sicht des Geländes mit Außen-Komponenten: belegte Positionen, Pflanzen-Sperre für bodennahe Spalten
 * (`profile`), Hindernisse in Laufhöhe y0+1 … y0+2 (Sperrfläche für Wege, ohne Grundfläche).
 */
export function exteriorBuilding(building: BuildingInfo, exterior: readonly ExteriorPlacement[]): { readonly building: BuildingInfo; readonly obstacles: CellSet } {
  if (exterior.length === 0) return { building, obstacles: CellSet.empty() };
  const cells = exterior.flatMap((p) => p.cells);
  const y0 = building.y0;
  const near = CellSet.of(cells.filter((c) => c[1] <= y0 + 3).map((c) => [c[0], c[2]] as const)).difference(building.footprint);
  const obstacles = CellSet.of(cells.filter((c) => c[1] >= y0 + 1 && c[1] <= y0 + 2).map((c) => [c[0], c[2]] as const)).difference(building.footprint);
  return {
    building: {
      ...building,
      occupied: new Set([...building.occupied, ...cells.map(key3)]),
      profile: (building.profile ?? CellSet.empty()).union(near),
    },
    obstacles,
  };
}
