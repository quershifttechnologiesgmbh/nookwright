/**
 * Turmwindmühle (research/18 T6; Vorbilder R22/R23): Steinturm aus tower.ts mit Kappe (Dach, Standard Kegel
 * p = 1 mit Stange), Achse und 4 Flügeln in „+“-Stellung – im Raster sauber, keine Diagonalen.
 *
 * Die Flügelebene steht im Abstand r + 2 vor der Turmmitte (Achse bei r + 1, verankert in der Wand bei r),
 * die Nabe liegt bei hubY = topY + 2 (Dachgeschoss, unter der Traufe). Ebenen-Koordinaten: v hoch, u quer
 * (`facing` von oben gesehen im Uhrzeigersinn gedreht). Jeder Flügel: Rute (Stamm, Achse entlang des Flügels)
 * k = 1 … L, Bespannung (Rolle `sail`) ab k = max(2, ⌈W/2⌉ + 1) SPIEGELSYMMETRISCH beidseits der Rute (je Seite ⌈W/2⌉). Bewusst
 * nicht einseitig („Windrad-Symmetrie“): vier einseitig bespannte Flügel in „+“-Stellung ergeben von vorn eine
 * hakenkreuzähnliche Figur. So hat die Figur Spiegelachsen und keinen Drehsinn. L = 4, W = 2:
 *
 *   . . . s | s . . .     v = +4      s Bespannung, | und - Ruten, o Nabe (Stamm, Achse zur Front)
 *   . . . s | s . . .
 *   . . . s | s . . .
 *   s s s . | . s s s     v = +1
 *   - - - - o - - - -     v =  0
 *   s s s . | . s s s     v = −1
 *   . . . s | s . . .
 *   . . . s | s . . .
 *   . . . s | s . . .     v = −4     (u = −4 … +4 von links nach rechts)
 * Die untere Spitze liegt ≥ 2 Blöcke über dem Gelände; sonst (oder bei Kollision mit anderen Bauwerken)
 * werden die Flügel gekürzt (Hinweis). Die Spalten der Flügelebene zählen weich zur Grundfläche.
 */
import type { Vec3 } from '@mcda/core';
import { B, PRIO, log, type Block, type Site } from './canvas.js';
import { DIR_XZ } from './geometry.js';
import { buildTower, resolveStyle, towerBaseY } from './tower.js';
import type { TowerInfo, WindmillSpec } from './types.js';

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' } as const;

export function buildWindmillOn(site: Site, spec: WindmillSpec, index: number): TowerInfo {
  const id = `${site.prefix}:${spec.id ?? `m${index}`}`;
  const warn = (m: string): void => {
    site.warnings.push(m);
  };
  const style = resolveStyle({ ...spec, shape: spec.shape ?? 'round', top: 'roof', roofPitch: spec.roofPitch ?? 1, finial: spec.finial ?? 'pole' }, warn, id);
  const facing = spec.facing ?? 'south';
  const [fx, fz] = DIR_XZ[facing];
  const [px, pz] = DIR_XZ[spec.door ?? OPPOSITE[facing]];
  const baseY = towerBaseY(site, spec.center, style.shape, style.r);
  const topY = baseY + Math.max(1, spec.levels ?? 3) * style.levelHeight;
  const info = buildTower(site, {
    id, center: spec.center, style, baseY, topY, openings: [], doorPref: [px, pz],
    spire: false,
  });

  const r = style.r;
  const [cx, cz] = spec.center;
  const hubY = topY + 2;
  const lx = -fz;
  const lz = fx;
  const at = (d: number, u: number, v: number): Vec3 => [cx + fx * d + lx * u, hubY + v, cz + fz * d + lz * u];
  const across = lx !== 0 ? 'x' : 'z';
  const along = fx !== 0 ? 'x' : 'z';
  const W = Math.max(1, Math.round(spec.sailWidth ?? 2));
  /** Bespannung je Seite der Rute (symmetrisch, siehe oben): W = 1–2 → 1, W = 3–4 → 2 … */
  const perSide = Math.max(1, Math.ceil(W / 2));
  const wanted = Math.max(3, Math.round(spec.sailLength ?? 7));

  /** Achse (Stamm bei r + 1, Nabe bei r + 2) und Flügel der Länge L: Ruten und Bespannung in der Ebene d = r + 2. */
  const sails = (L: number): { pos: Vec3; block: Block }[] => {
    const out: { pos: Vec3; block: Block }[] = [{ pos: at(r + 1, 0, 0), block: log(along) }, { pos: at(r + 2, 0, 0), block: log(along) }];
    for (const [au, av] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
      const [qu, qv] = [-av, au];
      for (let k = 1; k <= L; k++) {
        out.push({ pos: at(r + 2, au * k, av * k), block: log(av !== 0 ? 'y' : across) });
        // Bespannung erst ab k > perSide: sonst überlappen sich die Tücher benachbarter Flügel an der Nabe
        if (k >= Math.max(2, perSide + 1)) {
          for (let j = 1; j <= perSide; j++) {
            for (const side of [1, -1]) out.push({ pos: at(r + 2, au * k + side * qu * j, av * k + side * qv * j), block: B.sail });
          }
        }
      }
    }
    return out;
  };
  const fits = (cells: readonly { pos: Vec3 }[]): boolean => cells.every(({ pos: [x, y, z] }) =>
    y >= site.groundY(x, z) + 3 && site.canvas.at([x, y, z]) === undefined && !site.canvas.isReserved([x, y, z]));
  let L = wanted;
  while (L >= 3 && !fits(sails(L))) L--;
  if (L < 3) {
    warn(`${id}: kein Platz für die Flügel (Gelände oder Bauwerke zu nah)`);
    return info;
  }
  if (L < wanted) warn(`${id}: Flügel auf ${L} gekürzt (untere Spitze ≥ 2 über dem Gelände, keine Kollision)`);

  // Anker in der Wand (ersetzt die Scharte), Achse, Nabe, Flügel; Spalten der Ebene weich belegen
  site.canvas.put(at(r, 0, 0), B.wall, id, PRIO.feature);
  for (const { pos, block } of sails(L)) {
    site.canvas.put(pos, block, id, PRIO.tower);
    site.mark(pos[0], pos[2]);
  }
  return { ...info, hub: at(r + 2, 0, 0) };
}
