/** `catalog_describe`: das Vokabular der Engine (Bautypen, Themes, Raumtypen, Stil-Werte) – zum Nachschlagen. */
import { z } from 'zod';
import { EASY_FARM_GROUPS } from '@mcda/pipeline';
import { defineOperation } from '../operation.js';
import { DORMER_KINDS, EXTERIOR_GROUP_IDS, ROOF_PITCHES } from '../style.js';
import { DIRECTIONS, EXPORT_FORMATS, ROOF_STYLES, SETTING_KINDS, SIZE_CLASSES, STAIR_TYPES, VERSIONS } from '../vocabulary.js';

export const catalogDescribe = defineOperation({
  id: 'catalog_describe',
  summary: 'Listet alle wählbaren Bautypen, Themes, Raumtypen und Stil-Werte. Nur wählen, wenn der Nutzer fragt, was es gibt.',
  input: () => z.object({}).strict(),
  cacheable: true,
  run: (_input, _ctx, v) => ({
    data: {
      buildingTypes: v.buildingTypes.map((b) => ({
        id: b.id, name: b.name, family: b.family, sizes: [...b.sizes], themes: [...b.themes], draft: b.draft,
        ...(b.description !== undefined ? { description: b.description } : {}),
      })),
      themes: v.themes.map((t) => ({ id: t.id, name: t.name })),
      roomTypes: v.roomTypes.map((r) => ({ id: r.id, name: r.name })),
      terrainStyles: v.terrainStyles.map((t) => ({ id: t.id, name: t.name })),
      roofStyles: [...ROOF_STYLES],
      roofPitches: [...ROOF_PITCHES],
      dormers: [...DORMER_KINDS],
      exteriorGroups: [...EXTERIOR_GROUP_IDS],
      stairTypes: [...STAIR_TYPES],
      settings: [...SETTING_KINDS],
      sizes: [...SIZE_CLASSES],
      directions: [...DIRECTIONS],
      versions: [...VERSIONS],
      formats: [...EXPORT_FORMATS],
      // W3-BL: Presets der Block-Regeln (blockRules.preset) mit Begründung je Gruppe
      blockPresets: { easy_farm: EASY_FARM_GROUPS.map((g) => ({ id: g.id, why: g.why, blocks: [...g.blocks] })) },
    },
  }),
});
