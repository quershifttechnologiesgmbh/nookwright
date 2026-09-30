/** BT01: Schema-Felder für Ensemble-Teile (`parts`, `program[].part`, `sizes.*.parts`) und die Ringmauer (`structures.ring`). */
import { describe, expect, it } from 'vitest';
import { lintBuildingType, validateBuildingTypeDef, type BuildingTypeRefs } from '../src/index.js';

const base = {
  id: 'fort',
  name: 'Burg',
  family: 'fort',
  sizes: { S: { footprint: [[17, 11], [19, 13]], floors: 2, parts: ['keep'] } },
  massing: { generator: 'rect' },
  parts: {
    keep: { massing: 'tower', footprint: [[9, 9], [9, 9]], above: [3, 4], floorHeight: 3, anchor: { side: ['left', 'right'], gap: 0 }, roof: 'flat', parapet: 'crenel' },
  },
  program: [
    { room: 'storage', required: true },
    { room: 'storage', part: 'keep', floor: 'all', required: true },
  ],
  structures: { ring: { offset: [4, 6], towers: [{ shape: 'round', top: 'roof' }], gate: { gatehouse: 0.5 }, moat: { prob: 0.5 }, yard: 'yard' } },
};

const refs: BuildingTypeRefs = {
  roomTypes: new Set(['storage']), themes: new Set(['medieval']), roofs: new Set(['gable', 'flat']), siteTemplates: new Set(),
  terrainStyles: new Set(['meadow']), zoneKinds: new Set(['yard']),
};

const errors = (patch: (d: typeof base) => unknown): string[] => {
  const r = validateBuildingTypeDef(patch(structuredClone(base)));
  return r.ok ? [] : r.errors;
};

describe('Bautyp-Schema: Ensemble-Teile und Ringmauer', () => {
  it('gültige Burg-Definition, Lint findet Dachform und Hof-Zone', () => {
    const r = validateBuildingTypeDef(base);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(lintBuildingType(r.value, refs)).toEqual([]);
    const bad = validateBuildingTypeDef({ ...base, parts: { keep: { ...base.parts.keep, roof: 'dome', parapet: undefined } }, structures: { ring: { ...base.structures.ring, yard: 'bailey' } } });
    if (!bad.ok) throw new Error(bad.errors.join('\n'));
    expect(lintBuildingType(bad.value, refs)).toEqual(["fort: parts.keep.roof: unbekannte Dachform 'dome'", "fort: structures.ring.yard: unbekannte Zonenart 'bailey'"]);
  });

  it('Verweise und Pflichtfelder der Teile werden geprüft', () => {
    expect(errors((d) => ({ ...d, sizes: { S: { ...d.sizes.S, parts: ['tower'] } } }))).toEqual(["sizes.S.parts: unbekannter Teil 'tower'"]);
    expect(errors((d) => ({ ...d, program: [...d.program, { room: 'storage', part: 'bailey' }] }))).toEqual(["program.2.part: unbekannter Teil 'bailey'"]);
    expect(errors((d) => {
      const { above: _, ...keep } = d.parts.keep;
      return { ...d, parts: { keep } };
    })).toEqual(['parts.keep: Größe S ohne floors bzw. above']);
    expect(errors((d) => ({ ...d, parts: { keep: { ...d.parts.keep, roof: 'gable' } } }))).toEqual(['parts.keep.parapet: nur mit Flachdach (roof: flat)']);
    expect(errors((d) => ({ ...d, parts: { keep: { ...d.parts.keep, above: [4, 3] } } }))).toEqual(['parts.keep.above: min > max']);
    expect(errors((d) => ({ ...d, structures: { ring: { ...d.structures.ring, offset: [6, 4] } } }))).toEqual(['structures.ring.offset: min > max']);
    expect(errors((d) => ({ ...d, program: [{ room: 'storage', part: 'keep', wing: 'x' }] })).some((e) => e.includes('entweder wing oder part'))).toBe(true);
  });
});
