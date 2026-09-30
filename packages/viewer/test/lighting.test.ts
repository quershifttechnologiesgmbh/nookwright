/**
 * Licht der Vorschau: Lichtfeld (Blocklicht-BFS, Himmelslicht), AO-Fälle, Vertex-Glättung, Lightmap/Tageszeit.
 * Die Übereinstimmung mit dem Licht-Pass von @mcda/materialize prüft packages/app/test/viewerLight.test.ts:
 * Der Regel-Adapter gehört zur App, der Viewer hängt nicht von materialize ab.
 */
import { describe, expect, it } from 'vitest';
import {
  blockLightAt, cellIndex, computeLightField, estimateSpawnCells, lightInput, propagateLight, sameLightInput, skyLightAt,
  type LightRules,
} from '../src/lighting.js';
import { DAY_TIME, clockOf, dayLighting, lightmapColor, lightmapParams, skyDarken, sunGlow } from '../src/lightmap.js';
import { aoCorner, faceShade, vertexLight } from '../src/smooth-light.js';
import { TEST_RULES, voxels } from './light-helpers.js';

type Block = readonly [number, number, number, string, Record<string, string>?];

const CLOSED = { openSky: false, openSides: false } as const;

/** Ein geschlossener Kasten: Boden, Wände, Decke aus Stein, innen size−2. */
function box(size: readonly [number, number, number], roof = 'stone', extra: readonly Block[] = []): Block[] {
  const [w, h, l] = size;
  const out: Block[] = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < l; z++) {
    const shell = x === 0 || z === 0 || x === w - 1 || z === l - 1 || y === 0 || y === h - 1;
    if (!shell) continue;
    out.push([x, y, z, y === h - 1 ? roof : 'stone']);
  }
  const replaced = new Set(extra.map((b) => `${b[0]},${b[1]},${b[2]}`));
  return [...out.filter((b) => !replaced.has(`${b[0]},${b[1]},${b[2]}`)), ...extra];
}

describe('Lichtfeld: Blocklicht', () => {
  it('Quelle 15 fällt je Block um 1 (Manhattan-Abstand), außerhalb der Reichweite 0', () => {
    const f = computeLightField(voxels([40, 3, 3], [[5, 1, 1, 'lantern']]), TEST_RULES, CLOSED);
    for (let d = 0; d <= 16; d++) {
      const x = 5 + d;
      expect(blockLightAt(f, [x, 1, 1]), `Abstand ${d}`).toBe(Math.max(0, 15 - d));
    }
    expect(blockLightAt(f, [4, 2, 0])).toBe(15 - 3); // 1 + 1 + 1 Schritte
    expect(blockLightAt(f, [5, 1, 1])).toBe(15);
  });

  it('undurchsichtige Blöcke blocken, Licht geht nur außen herum', () => {
    // Gang 1 breit: Stein bei x = 8 trennt ganz
    const tunnel = voxels([20, 1, 1], [[4, 0, 0, 'lantern'], [8, 0, 0, 'stone']]);
    const f = computeLightField(tunnel, TEST_RULES, CLOSED);
    expect(blockLightAt(f, [7, 0, 0])).toBe(12);
    expect(blockLightAt(f, [8, 0, 0])).toBe(0);
    expect(blockLightAt(f, [9, 0, 0])).toBe(0);
    // Mauer mit Lücke daneben: Umweg über z = 1
    const wall = voxels([12, 1, 2], [[2, 0, 0, 'lantern'], [5, 0, 0, 'stone']]);
    const g = computeLightField(wall, TEST_RULES, CLOSED);
    expect(blockLightAt(g, [6, 0, 0])).toBe(15 - 6); // 2→6 über z=1: 4 + 2 Schritte
  });

  it('volle Fläche sperrt nur in ihrer Richtung, Blätter schwächen zusätzlich', () => {
    const f = computeLightField(voxels([3, 5, 1], [[1, 4, 0, 'lantern'], [1, 2, 0, 'slab'], [0, 0, 0, 'leaves']]), TEST_RULES, CLOSED);
    expect(blockLightAt(f, [1, 2, 0])).toBe(13); // Eintritt von oben geht
    expect(blockLightAt(f, [1, 1, 0])).toBe(15 - 5); // nicht durch die Unterseite: außen herum (x=0/2)
    expect(blockLightAt(f, [0, 0, 0])).toBe(15 - 5 - 1); // Blätter: −1 extra
  });

  it('Kerzen: 3 je Kerze', () => {
    const f = computeLightField(voxels([5, 1, 1], [[0, 0, 0, 'candle', { candles: '4' }]]), TEST_RULES, CLOSED);
    expect(blockLightAt(f, [0, 0, 0])).toBe(12);
    expect(blockLightAt(f, [4, 0, 0])).toBe(8);
  });
});

describe('Lichtfeld: Himmelslicht', () => {
  it('offen: 15 von oben bis zum Boden; Dach aus Stein blockt, der Raum ist dunkel', () => {
    const open = computeLightField(voxels([3, 4, 3], [[1, 0, 1, 'stone']]), TEST_RULES);
    expect(skyLightAt(open, [1, 1, 1])).toBe(15);
    expect(skyLightAt(open, [1, 0, 1])).toBe(0); // im Stein
    const closed = computeLightField(voxels([5, 5, 5], box([5, 5, 5])), TEST_RULES);
    expect(skyLightAt(closed, [2, 2, 2])).toBe(0);
    expect(skyLightAt(closed, [2, 5, 2])).toBe(15); // über dem Volumen
  });

  it('Glas im Dach lässt Himmelslicht ungeschwächt durch, daneben fällt es ab', () => {
    const f = computeLightField(voxels([7, 5, 7], box([7, 5, 7], 'stone', [[3, 4, 3, 'glass']])), TEST_RULES);
    expect(skyLightAt(f, [3, 3, 3])).toBe(15);
    expect(skyLightAt(f, [3, 1, 3])).toBe(15);
    expect(skyLightAt(f, [4, 1, 3])).toBe(14);
    expect(skyLightAt(f, [5, 1, 5])).toBe(11);
    // Glas-Dach komplett: überall 15
    const roof: Block[] = [];
    for (let x = 1; x < 6; x++) for (let z = 1; z < 6; z++) roof.push([x, 4, z, 'glass']);
    const g = computeLightField(voxels([7, 5, 7], box([7, 5, 7], 'stone', roof)), TEST_RULES);
    expect(skyLightAt(g, [5, 1, 5])).toBe(15);
  });

  it('seitlich durch eine Öffnung (Fenster/Tür): 14 am Rand, dann −1 je Block', () => {
    const f = computeLightField(voxels([7, 5, 7], box([7, 5, 7], 'stone', [[0, 2, 3, 'glass_pane']])), TEST_RULES);
    expect(skyLightAt(f, [0, 2, 3])).toBe(14);
    expect(skyLightAt(f, [1, 2, 3])).toBe(13);
    expect(skyLightAt(f, [3, 2, 3])).toBe(11);
    expect(skyLightAt(f, [5, 1, 5])).toBe(15 - 1 - 5 - 1 - 2); // Rand + 5 in x, 1 in y, 2 in z
  });

  it('skyBlocksFace: Türen können für Himmelslicht durchlässig sein, für Blocklicht nicht', () => {
    // Tür sperrt zur Raumseite (Osten); Himmelslicht kommt trotzdem von draußen herein
    const rules: LightRules = { ...TEST_RULES, blocksFace: (s, f) => s.name === 'door' && f === 'east', skyBlocksFace: () => false };
    const f = computeLightField(voxels([7, 5, 7], box([7, 5, 7], 'stone', [[0, 1, 3, 'door'], [0, 2, 3, 'door'], [6, 1, 3, 'torch'], [6, 2, 3, 'stone']])), rules);
    expect(skyLightAt(f, [1, 1, 3])).toBe(13);
    expect(blockLightAt(f, [1, 1, 3])).toBe(14 - 5); // Fackel in der gegenüberliegenden Wand
    expect(blockLightAt(f, [0, 1, 3])).toBe(0); // Blocklicht kommt nicht in die Tür
  });

  it('Eingabe unverändert → Feld wiederverwendbar (sameLightInput)', () => {
    const a = lightInput(voxels([5, 5, 5], box([5, 5, 5])), TEST_RULES);
    const b = lightInput(voxels([5, 5, 5], box([5, 5, 5])), TEST_RULES);
    expect(sameLightInput(a, b)).toBe(true);
    const c = lightInput(voxels([5, 5, 5], box([5, 5, 5], 'stone', [[2, 1, 2, 'torch']])), TEST_RULES);
    expect(sameLightInput(a, c)).toBe(false);
    expect(propagateLight(c).block[cellIndex([5, 5, 5], 2, 1, 2)]).toBe(14);
  });

  it('Spawn-Schätzung: dunkle, überdachte Bodenzellen', () => {
    const f = computeLightField(voxels([5, 5, 5], box([5, 5, 5])), TEST_RULES);
    expect(estimateSpawnCells(f)).toHaveLength(9); // 3×3 Boden, Kopfhöhe frei
    const lit = computeLightField(voxels([5, 5, 5], box([5, 5, 5], 'stone', [[2, 3, 2, 'lantern']])), TEST_RULES);
    expect(estimateSpawnCells(lit)).toHaveLength(0);
  });
});

describe('AO und Vertex-Glättung', () => {
  it('aoCorner: frei 1, Ecke 0,8, Kante 0,8, Kante + Ecke 0,6, Innenecke 0,4 (Diagonale egal)', () => {
    expect(aoCorner(false, false, false)).toBe(1);
    expect(aoCorner(false, false, true)).toBeCloseTo(0.8);
    expect(aoCorner(true, false, false)).toBeCloseTo(0.8);
    expect(aoCorner(true, false, true)).toBeCloseTo(0.6);
    expect(aoCorner(true, true, false)).toBeCloseTo(0.4);
    expect(aoCorner(true, true, true)).toBeCloseTo(0.4);
  });

  /** Oberseite des Bodenblocks (1,0,1): Vertex an der Ecke (2,1,2), Normale nach oben. */
  const topCorner = (blocks: Block[]): number =>
    vertexLight(computeLightField(voxels([4, 3, 4], [[1, 0, 1, 'stone'], ...blocks]), TEST_RULES), [1, 0, 1], [2, 1, 2], [0, 1, 0]).ao;

  it('AO am Vertex: frei, Kante (Block daneben), Ecke (nur diagonal), Innenecke (zwei Seiten)', () => {
    expect(topCorner([])).toBe(1);
    expect(topCorner([[2, 1, 1, 'stone']])).toBeCloseTo(0.8); // Kante
    expect(topCorner([[2, 1, 2, 'stone']])).toBeCloseTo(0.8); // Ecke (diagonal)
    expect(topCorner([[2, 1, 1, 'stone'], [2, 1, 2, 'stone']])).toBeCloseTo(0.6);
    expect(topCorner([[2, 1, 1, 'stone'], [1, 1, 2, 'stone']])).toBeCloseTo(0.4); // Innenecke
    // Glas verdeckt nicht (TEST_RULES.occludesAo)
    expect(topCorner([[2, 1, 1, 'glass']])).toBe(1);
    // Die gegenüberliegende Ecke (1,1,1) bleibt von der Kante bei x=2 unberührt
    const f = computeLightField(voxels([4, 3, 4], [[1, 0, 1, 'stone'], [2, 1, 1, 'stone']]), TEST_RULES);
    expect(vertexLight(f, [1, 0, 1], [1, 1, 1], [0, 1, 0]).ao).toBe(1);
  });

  it('Glättung: Eckwert = Mittel der vier Zellen, Flächenmitte = Mittel der Ecken, flach = Wert davor', () => {
    const f = computeLightField(voxels([9, 3, 9], [[4, 0, 4, 'stone'], [6, 1, 4, 'lantern']]), TEST_RULES, CLOSED);
    const bl = (x: number, z: number): number => blockLightAt(f, [x, 1, z]);
    const corner = vertexLight(f, [4, 0, 4], [5, 1, 5], [0, 1, 0]);
    expect(corner.block).toBeCloseTo((bl(4, 4) + bl(5, 4) + bl(4, 5) + bl(5, 5)) / 4);
    const corners = [[4, 4], [5, 4], [4, 5], [5, 5]].map(([x, z]) => vertexLight(f, [4, 0, 4], [x!, 1, z!], [0, 1, 0]).block);
    const mid = vertexLight(f, [4, 0, 4], [4.5, 1, 4.5], [0, 1, 0]);
    expect(mid.block).toBeCloseTo(corners.reduce((a, b) => a + b, 0) / 4);
    expect(vertexLight(f, [4, 0, 4], [4.5, 1, 4.5], [0, 1, 0], false)).toEqual({ block: bl(4, 4), sky: 0, ao: 1 });
    // Richtung zur Quelle heller
    expect(corners[1]!).toBeGreaterThan(corners[0]!);
  });

  it('Glättung: undurchsichtige Nachbarn (Licht 0) zählen wie die Mitte, nicht als dunkel', () => {
    const f = computeLightField(voxels([5, 3, 5], [[2, 0, 2, 'stone'], [3, 1, 2, 'stone'], [2, 2, 2, 'lantern']]), TEST_RULES, CLOSED);
    const v = vertexLight(f, [2, 0, 2], [3, 1, 2], [0, 1, 0]); // Ecke zwischen (2,1,1),(3,1,1),(2,1,2),(3,1,2)
    const c = blockLightAt(f, [2, 1, 2]);
    expect(v.block).toBeCloseTo((c + blockLightAt(f, [2, 1, 1]) + blockLightAt(f, [3, 1, 1]) + c) / 4);
    expect(v.ao).toBeCloseTo(0.8);
  });

  it('innere Flächen (Stufe) tasten die eigene Zelle ab, Grenzflächen den Nachbarn', () => {
    const f = computeLightField(voxels([3, 4, 3], [[1, 2, 1, 'torch'], [1, 0, 1, 'stone']]), TEST_RULES, CLOSED);
    // Oberseite einer unteren Stufe bei y = 0,5 im Block (1,1,1): Zelle (1,1,1)
    expect(vertexLight(f, [1, 1, 1], [1.5, 1.5, 1.5], [0, 1, 0], false).block).toBe(blockLightAt(f, [1, 1, 1]));
    // Oberseite des Steins bei y = 1: Nachbar darüber
    expect(vertexLight(f, [1, 0, 1], [1.5, 1, 1.5], [0, 1, 0], false).block).toBe(blockLightAt(f, [1, 1, 1]));
  });

  it('Flächenschattierung wie Minecraft', () => {
    expect(faceShade(0, 1, 0)).toBe(1);
    expect(faceShade(0, -1, 0)).toBe(0.5);
    expect(faceShade(0, 0, 1)).toBeCloseTo(0.8);
    expect(faceShade(1, 0, 0)).toBeCloseTo(0.6);
  });
});

describe('Tageszeit und Lightmap', () => {
  it('skyDarken wie Minecraft: Mittag 1, Mitternacht 0,2, Sonnenuntergang dazwischen', () => {
    expect(skyDarken(DAY_TIME.noon)).toBeCloseTo(1);
    expect(skyDarken(DAY_TIME.midnight)).toBeCloseTo(0.2);
    expect(skyDarken(DAY_TIME.sunset)).toBeGreaterThan(0.5);
    expect(skyDarken(DAY_TIME.night)).toBeLessThan(0.25);
    expect(sunGlow(DAY_TIME.noon)).toBe(0);
    expect(sunGlow(12500)).toBeGreaterThan(0.5);
    expect(clockOf(DAY_TIME.noon)).toBe('12:00');
    expect(clockOf(DAY_TIME.midnight)).toBe('00:00');
  });

  it('Nacht dunkler als Tag; Himmelslicht kühl, Blocklicht warm; Helligkeit hebt an', () => {
    const noon = lightmapParams(dayLighting(DAY_TIME.noon));
    const night = lightmapParams(dayLighting(DAY_TIME.midnight));
    const sumOf = (c: readonly number[]): number => c[0]! + c[1]! + c[2]!;
    expect(sumOf(lightmapColor(0, 15, night))).toBeLessThan(sumOf(lightmapColor(0, 15, noon)) * 0.5);
    const sky = lightmapColor(0, 15, noon);
    expect(sky[2]).toBeGreaterThan(sky[0]); // kühl
    const nightSky = lightmapColor(0, 15, night);
    expect(nightSky[2]).toBeGreaterThan(nightSky[0] * 1.3); // nachts bläulich
    for (const level of [8, 12, 15]) {
      const warm = lightmapColor(level, 0, night);
      expect(warm[0], `Stufe ${level}`).toBeGreaterThan(warm[2]); // warm
      expect(warm[0]).toBeGreaterThanOrEqual(warm[1]);
    }
    expect(sumOf(lightmapColor(4, 0, { ...night, brightness: 1 }))).toBeGreaterThan(sumOf(lightmapColor(4, 0, { ...night, brightness: 0 })));
    expect(sumOf(lightmapColor(0, 0, night))).toBeLessThan(0.3); // stockdunkel bleibt dunkel
  });
});
