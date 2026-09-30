import { evalCount, type Catalog, type RoomTypeDef } from '@mcda/catalog';
import { CellSet } from '@mcda/core';
import { analyzeRoom } from './analyze.js';
import { adaptVariant, expandComponent, fitsRoomHeight } from './expand.js';
import type { RoomGeometry } from './geometry.js';
import { Occupancy, connectivityOK, enumeratePoses } from './rules.js';

/**
 * W8-E (27.09.2026): Pflicht-Einträge eines Raumtyps, für die es schon im **leeren** Raum keine Pose gibt – mit den
 * harten Regeln (billige Regeln und Konnektivität) in der lockersten Stufe des Solvers: ohne Fenstersicht, Hauptweg,
 * Layout und Nutzungsseiten-Regel (wie der Rückfall `placeWithoutAccess`), mit allen Formen der Familie (wie der
 * Rückfall des Signatur-Tauschs). Nur Einträge mit Mindestzahl ≥ 1 zählen. Ein Treffer heißt: der Solver kann das
 * Pflichtobjekt in diesem Raum nie setzen (Raum ist nur Durchgang, Treppe nimmt die Wände …). Der Grundriss-Planer
 * nutzt das als Problem und würfelt einen anderen Versuch (`ArchetypeContext.furnishable`). Leer = alles hat Platz.
 * Rein, ohne Zufall.
 */
export function requiredWithoutPose(
  geom: RoomGeometry, rt: RoomTypeDef, catalog: Catalog, opts: { readonly dataVersion: number },
): string[] {
  const analysed = analyzeRoom(geom);
  const a = { ...analysed, windowView: CellSet.empty() };
  const occ = new Occupancy(geom.baseY);
  const area = geom.interior.difference(analysed.blocked).size;
  const out: string[] = [];
  for (const e of rt.required) {
    if (evalCount(Array.isArray(e.count) ? e.count : { ...e.count, max: e.count.min }, area)[0] < 1) continue;
    // alle Formen der Familie: auch der Signatur-Tausch (Y9) fällt auf sie zurück, wenn keine Form des Stils passt
    const defs = catalog.byTags(e.tags, opts.dataVersion);
    const all = defs.flatMap((def) => (def.variants?.map((v) => v.id) ?? [undefined]).map((base) => ({ def, base })));
    const fitting = all.filter(({ def, base }) => fitsRoomHeight(def, base, geom.height));
    const fits = (fitting.length > 0 ? fitting : all).some(({ def, base }) => {
      const exp = expandComponent(def, adaptVariant(def, base, geom.height));
      return enumeratePoses(def, exp, a, occ).some((p) => connectivityOK(p, a, occ, false));
    });
    if (!fits && defs.length > 0) out.push(e.tags.join('|'));
  }
  return out;
}
