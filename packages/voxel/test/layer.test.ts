import { describe, expect, it } from 'vitest';
import {
  AIR, blockState, Layer, LAYER_RULES, LAYERS, MergeViolationError, overwriteConflict, VoxelVolume,
  type Layer as LayerT, type Permit,
} from '../src/index.js';

const stone = blockState('stone');
const wall = blockState('stone_bricks');
const door = blockState('oak_door', { facing: 'east', half: 'lower', hinge: 'right', open: 'false', powered: 'false' });
const at = [0, 0, 0] as const;

/** Volumen mit einer Zelle, die `owner` in `layer` beschrieben hat. */
function occupied(layer: LayerT, state = stone, owner = 'alt') {
  const v = VoxelVolume.create([1, 1, 1]);
  v.place(at, { state, owner, layer });
  return v;
}

describe('Merge-Regel (plan/01 §6.1)', () => {
  it('leere Zellen darf jede Schicht beschreiben', () => {
    for (const layer of LAYERS) {
      expect(() => VoxelVolume.create([1, 1, 1]).place(at, { state: stone, owner: 'neu', layer })).not.toThrow();
    }
  });

  it('Struktur überschreibt Terrain, Terrain nie Struktur', () => {
    expect(() => occupied(Layer.Terrain).place(at, { state: wall, owner: 'shell', layer: Layer.Structure })).not.toThrow();
    expect(() => occupied(Layer.Structure).place(at, { state: stone, owner: 'terrain', layer: Layer.Terrain })).toThrow(MergeViolationError);
  });

  it('gleiche Schicht, andere Herkunft: Überlappung ist ein Fehler', () => {
    const v = occupied(Layer.Furniture, blockState('crafting_table'), 'werkbank#1');
    expect(() => v.place(at, { state: blockState('barrel', { facing: 'up', open: 'false' }), owner: 'fass#2', layer: Layer.Furniture }))
      .toThrow(/Schicht 5 darf Schicht 5/);
  });

  it('dieselbe Herkunft darf ihre Zelle neu schreiben (gleiche oder höhere Schicht)', () => {
    const v = occupied(Layer.Architecture, AIR, 'tuer#1');
    expect(() => v.place(at, { state: door, owner: 'tuer#1', layer: Layer.Architecture })).not.toThrow();
    expect(() => v.place(at, { state: door, owner: 'tuer#1', layer: Layer.Structure })).toThrow(MergeViolationError);
  });

  it('Möbel nur in Luft: über Struktur-Luft ja, über Wand nein', () => {
    expect(() => occupied(Layer.Structure, AIR, 'shell').place(at, { state: stone, owner: 'moebel', layer: Layer.Furniture })).not.toThrow();
    expect(() => occupied(Layer.Structure, wall, 'shell').place(at, { state: stone, owner: 'moebel', layer: Layer.Furniture }))
      .toThrow(/nur Luft/);
  });

  it('Architektur ersetzt Struktur nur mit Freigabe carve', () => {
    const req = { state: door, owner: 'tuer#1', layer: Layer.Architecture } as const;
    expect(() => occupied(Layer.Structure, wall, 'shell').place(at, req)).toThrow(/Freigabe 'carve'/);
    expect(() => occupied(Layer.Structure, wall, 'shell').place(at, { ...req, permit: 'floor' })).toThrow(/Freigabe 'carve'/);
    expect(() => occupied(Layer.Structure, wall, 'shell').place(at, { ...req, permit: 'carve' })).not.toThrow();
    expect(() => occupied(Layer.Terrain).place(at, { ...req, permit: 'carve' })).toThrow(/nicht ersetzen/);
  });

  it('Boden-Overlay (floor), Anbauteil (thin), Dekorateur (variant)', () => {
    const wool = blockState('red_wool');
    expect(() => occupied(Layer.Structure, wall).place(at, { state: wool, owner: 'o', layer: Layer.FloorOverlay })).toThrow(MergeViolationError);
    expect(() => occupied(Layer.Structure, wall).place(at, { state: wool, owner: 'o', layer: Layer.FloorOverlay, permit: 'floor' })).not.toThrow();
    const torch = blockState('torch');
    expect(() => occupied(Layer.Furniture).place(at, { state: torch, owner: 'f', layer: Layer.Attachment })).toThrow(MergeViolationError);
    expect(() => occupied(Layer.Furniture).place(at, { state: torch, owner: 'f', layer: Layer.Attachment, permit: 'thin' })).not.toThrow();
    const mossy = blockState('mossy_stone_bricks');
    expect(() => occupied(Layer.Structure, wall).place(at, { state: mossy, owner: 'd', layer: Layer.Decorator })).toThrow(MergeViolationError);
    expect(() => occupied(Layer.Structure, wall).place(at, { state: mossy, owner: 'd', layer: Layer.Decorator, permit: 'variant' })).not.toThrow();
  });

  it('Verstoß: MergeViolationError mit Details, Volumen bleibt unverändert; conflict() prüft ohne Werfen', () => {
    const v = occupied(Layer.Structure, wall, 'shell');
    const req = { state: door, owner: 'tuer#1', layer: Layer.Architecture } as const;
    expect(v.conflict(at, req)).toMatch(/carve/);
    expect(v.conflict(at, { ...req, permit: 'carve' })).toBeUndefined();
    let err: unknown;
    try { v.place(at, req); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(MergeViolationError);
    const m = err as MergeViolationError;
    expect(m.pos).toEqual([0, 0, 0]);
    expect(m.existing).toMatchObject({ owner: 'shell', layer: Layer.Structure, state: wall });
    expect(m.incoming).toMatchObject({ owner: 'tuer#1', layer: Layer.Architecture });
    expect(m.message).toMatch(/Merge-Verstoß bei 0,0,0/);
    expect(v.cell(at)).toMatchObject({ owner: 'shell', state: wall });
  });

  it('vollständige Matrix: höhere Schicht über Nicht-Luft genau dann, wenn LAYER_RULES es erlauben', () => {
    const permits: (Permit | undefined)[] = [undefined, 'carve', 'floor', 'thin', 'variant'];
    for (const lower of LAYERS) {
      for (const upper of LAYERS) {
        for (const permit of permits) {
          const incoming = { layer: upper, owner: 'neu', ...(permit ? { permit } : {}) };
          const got = overwriteConflict({ layer: lower, owner: 'alt', air: false }, incoming) === undefined;
          const rule = LAYER_RULES[upper];
          const expected = upper > lower && rule.replaces.includes(lower) && (rule.permit === undefined || rule.permit === permit);
          expect(got, `${upper} über ${lower} (${permit ?? '-'})`).toBe(expected);
          // Luft einer niedrigeren Schicht ist immer frei
          const air = overwriteConflict({ layer: lower, owner: 'alt', air: true }, incoming) === undefined;
          expect(air, `${upper} über Luft von ${lower}`).toBe(upper > lower);
        }
      }
    }
  });

  it('ungültige Schicht wird abgelehnt', () => {
    expect(() => VoxelVolume.create([1, 1, 1]).place(at, { state: stone, owner: 'x', layer: 9 as LayerT })).toThrow(RangeError);
  });
});
