import { describe, expect, it } from 'vitest';
import { classifyBoxes, decodeStates, findAnalog } from '../src/build/physics.js';
import { hasFlag, physicsOfState } from '../src/index.js';
import { loadPhysics } from '../src/node.js';

describe('classifyBoxes', () => {
  it('Klassen nach Höhe', () => {
    expect(classifyBoxes([], true).cls).toBe('air');
    expect(classifyBoxes([]).cls).toBe('thin');
    expect(classifyBoxes([[0, 0, 0, 1, 0.0625, 1]])).toEqual({ cls: 'flat', h: 0.0625, topFull: false });
    expect(classifyBoxes([[0, 0, 0, 1, 0.125, 1]]).cls).toBe('flat'); // Grenze 1/8 inklusive
    expect(classifyBoxes([[0, 0, 0, 1, 0.5, 1]])).toEqual({ cls: 'half', h: 0.5, topFull: false });
    expect(classifyBoxes([[0, 0.5, 0, 1, 1, 1]])).toEqual({ cls: 'half', h: 1, topFull: true }); // obere Stufe
    expect(classifyBoxes([[0.375, 0, 0.375, 0.625, 1.5, 0.625]])).toEqual({ cls: 'tall', h: 1.5, topFull: false });
    expect(classifyBoxes([[0, 0, 0, 1, 1, 1]])).toEqual({ cls: 'full', h: 1, topFull: true });
  });

  it('zusammengesetzter Vollwürfel und Treppe', () => {
    expect(classifyBoxes([[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 1]]).cls).toBe('full');
    const stairs = classifyBoxes([[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]]);
    expect(stairs).toEqual({ cls: 'half', h: 1, topFull: false });
  });
});

describe('decodeStates (PrismarineJS-Reihenfolge)', () => {
  it('letzte Property variiert am schnellsten, bool: Index 0 = true', () => {
    const states = decodeStates({
      name: 'oak_slab', minStateId: 0, defaultState: 3,
      states: [
        { name: 'type', type: 'enum', num_values: 3, values: ['top', 'bottom', 'double'] },
        { name: 'waterlogged', type: 'bool', num_values: 2 },
      ],
    });
    expect(states).toHaveLength(6);
    expect(states[0]).toEqual({ type: 'top', waterlogged: 'true' });
    expect(states[3]).toEqual({ type: 'bottom', waterlogged: 'false' }); // = defaultState
  });
});

describe('findAnalog', () => {
  it('Namens-Suffix und manuelle Analogien', () => {
    const known = ['oak_stairs', 'stripped_oak_log', 'oak_log', 'pointed_dripstone', 'dandelion', 'potted_dandelion', 'iron_chain'];
    expect(findAnalog('poplar_stairs', known)?.block).toBe('oak_stairs');
    expect(findAnalog('stripped_poplar_log', known)?.block).toBe('stripped_oak_log');
    expect(findAnalog('potted_golden_dandelion', known)?.block).toBe('potted_dandelion');
    expect(findAnalog('sulfur_spike', known)?.block).toBe('pointed_dripstone');
    expect(findAnalog('chain', known)?.block).toBe('iron_chain');
    expect(findAnalog('cinnabar', known)).toBeUndefined();
  });
});

describe('Physik (generierte Daten)', () => {
  const p = loadPhysics('26.3');
  const b = (n: string) => {
    const x = p.blocks[n];
    if (!x) throw new Error(`fehlt: ${n}`);
    return x;
  };

  it('Beispiele aus Komponentenmodell §3.1', () => {
    expect(b('air').cls).toBe('air');
    expect(b('torch').cls).toBe('thin');
    expect(b('oak_sign').cls).toBe('thin');
    expect(b('white_carpet').cls).toBe('flat');
    expect(b('oak_slab').cls).toBe('half');
    expect(b('oak_stairs').cls).toBe('half');
    expect(b('white_bed').cls).toBe('half');
    expect(b('chest').cls).toBe('half');
    expect(b('oak_fence').cls).toBe('tall');
    expect(b('cobblestone_wall').cls).toBe('tall');
    expect(b('cobblestone_wall').classes).toEqual(['thin', 'tall']); // fachliche Reihenfolge
    expect(b('oak_fence_gate').cls).toBe('tall');
    expect(b('oak_planks').cls).toBe('full');
    expect(b('bookshelf').cls).toBe('full');
  });

  it('Zustandsabhängige Physik (by)', () => {
    expect(physicsOfState(b('oak_slab'), { type: 'top' })).toEqual({ cls: 'half', h: 1, topFull: true });
    expect(physicsOfState(b('oak_slab'), { type: 'double' }).cls).toBe('full');
    expect(physicsOfState(b('oak_fence_gate'), { open: 'true' }).cls).toBe('thin');
    expect(physicsOfState(b('oak_stairs'), { half: 'top' }).topFull).toBe(true);
  });

  it('FC 5: Schneeschicht 1 verhindert Spawn NICHT, 2–7 schon', () => {
    const snow = b('snow');
    expect(physicsOfState(snow, { layers: '1' }).cls).toBe('thin');
    expect(physicsOfState(snow, { layers: '2' }).cls).toBe('flat');
    expect(physicsOfState(snow, { layers: '7' }).cls).toBe('half');
    expect(snow.spawnBlocked).toBe(false); // Default layers=1
  });

  it('FC 5: Spawn-Blocker in der Zelle', () => {
    expect(b('white_carpet').spawnBlocked).toBe(true);
    expect(b('oak_pressure_plate').spawnBlocked).toBe(true);
    expect(b('oak_pressure_plate').flags).toContain('signalSource');
    expect(b('stone_button').spawnBlocked).toBe(true);
    expect(b('rail').spawnBlocked).toBe(true);
    expect(b('torch').spawnBlocked).toBe(false);
    expect(b('air').spawnBlocked).toBe(false);
  });

  it('FC 5: Spawn-Untergrund', () => {
    expect(b('stone').spawnFloor).toBe(true);
    expect(b('soul_sand').spawnFloor).toBe(true);
    expect(b('mud').spawnFloor).toBe(true);
    expect(b('glass').spawnFloor).toBe(false);
    expect(b('oak_leaves').spawnFloor).toBe(false);
    expect(b('ice').spawnFloor).toBe(false);
    expect(b('oak_slab').spawnFloor).toBe(false); // untere Stufe
  });

  it('FC 15: Schwerkraft und Stütze', () => {
    expect(b('sand').flags).toContain('falls');
    expect(b('white_concrete_powder').flags).toContain('falls');
    expect(b('sulfur_spike').flags).toEqual(expect.arrayContaining(['falls', 'hazard']));
    expect(b('flower_pot').flags).not.toContain('needsSupport');
    expect(b('potted_poppy').flags).not.toContain('needsSupport');
    expect(b('torch').flags).toContain('needsSupport');
    expect(b('oak_wall_hanging_sign').flags).not.toContain('needsSupport');
    expect(b('oak_hanging_sign').flags).toContain('needsSupport');
    expect(b('sea_lantern').flags).not.toContain('needsSupport');
    expect(hasFlag(b('lantern'), 'needsSupport')).toBe(true);
  });

  it('Flags climbable / liquid / hazard / waterloggable', () => {
    expect(b('ladder').flags).toContain('climbable');
    expect(b('scaffolding').flags).toContain('climbable');
    expect(b('water').flags).toContain('liquid');
    expect(b('lava').flags).toEqual(expect.arrayContaining(['liquid', 'hazard']));
    expect(b('campfire').flags).toContain('hazard');
    expect(b('magma_block').flags).toContain('hazard');
    expect(b('oak_stairs').flags).toContain('waterloggable');
  });

  it('26.3-Neuheiten ohne Kollisionsdaten sind heuristisch markiert', () => {
    expect(b('poplar_stairs').src).toBe('heuristic:oak_stairs');
    expect(b('white_wool_stairs').cls).toBe('half');
    expect(b('straw_bed').cls).toBe('half');
    expect(p.unknown.some((u) => u.block === 'poplar_planks')).toBe(true);
    expect(b('golden_dandelion').src).toBe('prismarine:26.1');
    expect(p.unknown.every((u) => b(u.block).src.startsWith('heuristic'))).toBe(true);
  });

  it('1.21.1: umbenannte Kette über Analogie', () => {
    const p1 = loadPhysics('1.21.1');
    expect(p1.blocks['chain']?.src).toBe('heuristic:iron_chain');
  });
});
