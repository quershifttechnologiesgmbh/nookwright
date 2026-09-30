/**
 * W12-C (Review R6-4 „Scheunentor und Heuluke“, plan/spikes/W12C_bauernhof_details.md): Außen-Deko der Scheune an
 * Baukörpern mit `Volume.exterior.barn` (die Hülle legt deren Außentür mittig in den Giebel weg vom Wohnhaus).
 *
 *   Giebel (Ansicht)                    Reihenfolge und Regeln
 *          B B  ← Heubalken + Laterne   1. Scheunentor (`exterior/barn_door`) um die Außentür: Torflügel 3 breit, heller
 *        H H H H H                         Rahmen 5 breit; Tür und Laufweg davor bleiben frei (Schlupftür im Tor).
 *        P L L L P  ← Heuluke           2. Heuluke (`exterior/hay_loft`) in der Giebelwand über dem Tor: unterste
 *        P L L L P                         Giebelreihe = Bank, zwei Reihen Flügel, Sturz; nur vor Wandzellen (Flügel).
 *        S S S S S                      3. Heubalken (`exterior/hay_hood`) in der obersten Wandreihe der Mittelachse,
 *    ─────────────── Deckenring            2 Blöcke hinaus, mit Kette und Laterne, sonst nur der Balken.
 *        H H H H H  ← Scheunentor       Alles spiegelsymmetrisch um die Türachse; läuft vor den Fenstermodulen (Vorrang).
 *        P L L L P
 *        P L D L P
 *        P L D L P
 */
import type { ShellAnchor } from '@mcda/blueprint';
import type { Vec3 } from '@mcda/core';
import { OPP, alongOf, step, up, type ExteriorSite, type Part } from './site.js';

const BARN_DOOR = 'exterior/barn_door';
const HAY_LOFT = 'exterior/hay_loft';
const HAY_HOOD = 'exterior/hay_hood';

/** Scheunentor, Heuluke und Heubalken an den Außentüren der Scheune (`doors`: nur Anker der Scheunen-Räume). */
export function planBarnDoors(site: ExteriorSite, doors: readonly ShellAnchor[], loft: boolean): void {
  for (const a of doors) {
    const f = a.facing;
    const gate: Part = { componentId: BARN_DOOR, variantId: 'gate', facing: f, local: [2, 0, 0], at: a.pos };
    const placed = site.commit('barnDoors', 'door', a.floorIndex, [gate]).length > 0
      || site.commit('barnDoors', 'door', a.floorIndex, [{ ...gate, variantId: 'gate_low' }]).length > 0;
    if (!placed || !loft) continue;
    const lvl = site.levelOf(a.floorIndex, a.pos);
    if (lvl === undefined) continue;
    // Giebelwand über dem Tor: Wandzellen in der Türebene oberhalb des Deckenrings
    const wall = (p: Vec3): Vec3 => step(p, OPP[f]);
    const along = alongOf(f);
    const col = (k: number, y: number): Vec3 => up(step([a.pos[0], lvl.baseY, a.pos[2]], along, k), y - lvl.baseY);
    const isWall = (k: number, y: number): boolean => site.at(wall(col(k, y)))?.kind === 'wall';
    let bottom: number | undefined;
    let top: number | undefined;
    for (let y = lvl.topY + 2; y <= lvl.topY + 24; y++) {
      if (!isWall(0, y)) {
        if (bottom !== undefined) break;
        continue;
      }
      bottom ??= y;
      top = y;
    }
    if (bottom === undefined || top === undefined) continue;
    const gb = bottom;
    // Heuluke: Flügel (Reihen gb+1, gb+2) nur vor Wandzellen, breit (3 Flügel) oder schmal (1 Flügel)
    for (const [variantId, half] of [['wide', 1], ['narrow', 0]] as const) {
      const leaves = (): boolean => {
        for (let k = -half; k <= half; k++) for (const y of [gb + 1, gb + 2]) if (!isWall(k, y)) return false;
        return true;
      };
      const part: Part = { componentId: HAY_LOFT, variantId, facing: f, local: [half + 1, 0, 0], at: col(0, gb) };
      if (site.commit('barnDoors', 'gable', a.floorIndex, [part], leaves).length > 0) break;
    }
    // Heubalken unter dem First: mit Kette und Laterne ab 3 freien Reihen über dem Sturz der Luke, sonst nur der Balken
    const hood: Part = { componentId: HAY_HOOD, variantId: 'hood', facing: f, local: [0, 2, 0], at: col(0, top) };
    if (top - 2 >= gb + 4 && site.commit('barnDoors', 'gable', a.floorIndex, [hood]).length > 0) continue;
    if (top >= gb + 4) site.commit('barnDoors', 'gable', a.floorIndex, [{ ...hood, variantId: 'beam', local: [0, 0, 0] }]);
  }
}
