/** Node-Adapter lädt die Bautypen (U4): `nodeContext(dir).buildingTypes` = alle Dateien aus `catalog/buildingtypes`. */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectFromBuildingType } from '../src/index.js';
import { loadBuildingTypes, nodeContext } from '../src/node-context.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));

describe('nodeContext: Bautypen', () => {
  it('lädt jede Datei aus catalog/buildingtypes; fehlender Ordner = keine', () => {
    const ctx = nodeContext(ROOT);
    const files = readdirSync(join(ROOT, 'buildingtypes')).filter((f) => f.endsWith('.json5')).length;
    expect(ctx.buildingTypes.ids()).toHaveLength(files);
    expect(ctx.buildingTypes.ids()).toContain('tavern');
    expect(loadBuildingTypes(join(ROOT, 'gibt-es-nicht')).ids()).toEqual([]);
    const res = projectFromBuildingType(ctx.buildingTypes.get('house'), { surroundings: false }, 1, ctx);
    // W12-A (2026-09-28): vier Räume der Vorlage + Diele im Quergiebel (Seed 1: eingeschossig)
    // W13-A Runde 2 (2026-09-28): dazu der zweigeschossige Eckturm (Bibliothek, Turmstube); vorher 5
    expect(res.project.state.rooms).toHaveLength(7);
  });
});
