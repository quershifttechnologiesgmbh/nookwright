/** Anker + Außenprofil-Pass (research/18 §1.1, §3 F2/F3a/F7, D2; research/16 Tricks #1, #4, #8). */
import { describe, expect, it } from 'vitest';
import { CellSet, HORIZONTAL, key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import {
  Project, TARGET_VERSIONS, applyFacade, deriveAnchors, deriveShell,
  type FacadeStyle, type RoofStyle, type Shell, type ShellAnchorKind, type ShellCell, type ShellOptions,
} from '../src/index.js';
import { exteriorModel } from '../src/shell/anchors.js';
import { pilasterSlots, rhythm } from '../src/shell/facade.js';
import { CCW, OPP, STEP, axisOf } from '../src/shell/grid.js';

const ALL: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };

function project(seed = 2026): Project {
  return Project.create({ id: 'p', name: 'Haus', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
}

/** Wie das Beispielhaus der Pipeline (eine Etage, 4 Räume). */
function oneStory(): Project {
  const p = project();
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  return p;
}

/** Zweistöckig, Schmiede eingeschossig (Pultdach an der OG-Wand). */
function twoStory(): Project {
  const p = oneStory();
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
  p.paintRoom(1, CellSet.rect(9, 0, 14, 6), 'alchemy');
  p.paintRoom(1, CellSet.rect(0, 7, 14, 11), 'library');
  p.placeStairs(0, [3, 10], 'east');
  return p;
}

/** L-Grundriss: Flur-Flügel (Nord-Süd) + Schankraum-Flügel (Ost), eine einspringende Ecke. */
function lShape(): Project {
  const p = project(7);
  p.paintRoom(0, CellSet.rect(0, 0, 8, 14), 'hallway');
  p.paintRoom(0, CellSet.rect(9, 8, 20, 14), 'tavern');
  return p;
}

/** Obergeschoss kragt nach Norden 1 Block über die EG-Wand (F3a). */
function jetty(): Project {
  const p = project(7);
  p.paintRoom(0, CellSet.rect(0, 1, 12, 9), 'kitchen');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 12, 9), 'bedroom');
  p.placeStairs(0, [3, 5], 'east');
  return p;
}

const FIXTURES: Record<string, () => Project> = { oneStory, twoStory, lShape, jetty };
const ROOFS: readonly RoofStyle[] = ['hip', 'gable', 'flat'];
const at = (p: Vec3, d: HorizontalDir, k = 1): Vec3 => [p[0] + STEP[d][0] * k, p[1], p[2] + STEP[d][1] * k];
const facadeOf = (s: Shell): ShellCell[] => s.cells.filter((c) => c.kind === 'facade');
const kinds = (s: Shell): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const a of s.anchors ?? []) out[a.kind] = (out[a.kind] ?? 0) + 1;
  return out;
};

describe('Anker', () => {
  it('deriveShell liefert immer Anker (auch leer)', () => {
    const empty = project();
    expect(deriveShell(empty.state, { roof: 'hip' }).anchors).toEqual([]);
    expect(deriveShell(oneStory().state, { roof: 'hip' }).anchors!.length).toBeGreaterThan(0);
  });

  it('Rechteckhaus mit Walmdach: Tür, Fenster, 4 Ecken, 4 Sockelläufe, 4 Traufen, First mit 2 Enden, 4 Flächen', () => {
    const s = deriveShell(oneStory().state, { roof: 'hip' });
    expect(kinds(s)).toMatchObject({ door: 1, corner: 4, plinth: 4, eave: 4, ridge: 1, ridge_end: 2, roof_face: 4 });
    // Fensteranker: nebeneinanderliegende Scheiben zusammengefasst, zusammen genau alle Fensterspalten
    const windowCols = new Set(s.cells.filter((c) => c.kind === 'window').map((c) => `${c.pos[0]},${c.pos[2]}`));
    expect(s.anchors!.filter((a) => a.kind === 'window').reduce((n, a) => n + a.span!, 0)).toBe(windowCols.size);
    // Traufen laufen die ganze Wand entlang, direkt unter dem Überstand
    const eaves = s.anchors!.filter((a) => a.kind === 'eave');
    expect(eaves.map((a) => a.span).sort((a, b) => a! - b!)).toEqual([12, 12, 23, 23]);
    for (const a of eaves) expect(s.cells.some((c) => c.kind === 'roof' && key3(c.pos) === key3([a.pos[0], a.pos[1] + 1, a.pos[2]]))).toBe(true);
  });

  it('Satteldach: 2 Giebel, 4 Ortgänge, 2 Flächen; Walmgrate zählen nicht als First', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 12, 6), 'storage');
    const gable = deriveShell(p.state, { roof: 'gable' });
    expect(kinds(gable)).toMatchObject({ gable: 2, verge: 4, ridge: 1, ridge_end: 2, roof_face: 2, eave: 2 });
    const ridge = gable.anchors!.find((a) => a.kind === 'ridge')!;
    expect(ridge.span).toBe(15); // 13 + 2 × Überstand
    for (const a of gable.anchors!.filter((x) => x.kind === 'gable')) expect(axisOf(a.facing)).toBe('x');
    const hip = deriveShell(p.state, { roof: 'hip' });
    expect(kinds(hip)).toMatchObject({ ridge: 1, roof_face: 4 });
    expect(kinds(hip)['verge']).toBeUndefined();
    expect(kinds(hip)['gable']).toBeUndefined();
  });

  it('Wand-Anker hängen nicht vom Dach-Algorithmus ab', () => {
    for (const make of Object.values(FIXTURES)) {
      const wallish = (roof: RoofStyle, of: readonly ShellAnchorKind[]): string[] =>
        deriveShell(make().state, { roof }).anchors!
          .filter((a) => of.includes(a.kind))
          .map((a) => `${a.kind}@${key3(a.pos)}/${a.facing}/${a.span}`);
      expect(wallish('gable', ['door', 'window', 'corner', 'plinth'])).toEqual(wallish('hip', ['door', 'window', 'corner', 'plinth']));
      // Flachdach: kein Pultdach verdeckt OG-Fenster über dem eingeschossigen Teil, dort gibt es also mehr Fenster
      expect(wallish('flat', ['door', 'corner', 'plinth'])).toEqual(wallish('hip', ['door', 'corner', 'plinth']));
    }
  });

  it('jede Ankerposition ist Außenluft; Tür- und Fensteranker zeigen nach außen', () => {
    for (const [name, make] of Object.entries(FIXTURES)) {
      for (const roof of ROOFS) {
        const s = deriveShell(make().state, { roof });
        const m = exteriorModel(s);
        for (const a of s.anchors!) expect(m.isAir(a.pos), `${name}/${roof} ${a.kind} ${a.pos}`).toBe(true);
        for (const a of s.anchors!.filter((x) => x.kind === 'door' || x.kind === 'window')) {
          const behind = m.at(at(a.pos, OPP[a.facing]));
          expect(behind?.kind, `${name}/${roof} ${a.kind} ${a.pos}`).toBe(a.kind);
        }
      }
    }
  });

  it('Zweistöckig: Etagengrenze nur, wo das OG auf der EG-Wand steht; Pultdach-Seiten sind Giebel', () => {
    const s = deriveShell(twoStory().state, { roof: 'gable' });
    const storey = s.anchors!.filter((a) => a.kind === 'storey_line');
    expect(storey.map((a) => a.facing).sort()).toEqual(['north', 'south', 'west']);
    for (const a of storey) expect(a.pos[1]).toBe(4);
    expect(s.anchors!.filter((a) => a.kind === 'gable' && a.floorIndex === 0).map((a) => a.facing).sort()).toEqual(['north', 'south']);
    // Auskragung: keine Etagengrenze an der auskragenden Seite
    const j = deriveShell(jetty().state, { roof: 'hip' });
    expect(j.anchors!.filter((a) => a.kind === 'storey_line').map((a) => a.facing).sort()).toEqual(['east', 'south', 'west']);
  });

  it('L-Grundriss: 5 Außenecken, 6 Sockelläufe; deterministisch', () => {
    const s = deriveShell(lShape().state, { roof: 'gable' });
    expect(kinds(s)).toMatchObject({ corner: 5, plinth: 6 });
    expect(deriveAnchors(s)).toEqual(s.anchors);
    expect(deriveShell(lShape().state, { roof: 'gable' }).anchors).toEqual(s.anchors);
  });
});

describe('Außenprofil', () => {
  it('ohne options.facade (oder mit leerem Stil) bleibt die Hülle wie bisher', () => {
    for (const make of Object.values(FIXTURES)) {
      for (const roof of ROOFS) {
        const plain = deriveShell(make().state, { roof });
        expect(facadeOf(plain)).toEqual([]);
        expect(plain.cells.some((c) => c.role === 'wall_quoin')).toBe(false);
        const empty = deriveShell(make().state, { roof, facade: {} });
        expect(empty.cells).toEqual(plain.cells);
        expect(empty.anchors).toEqual(plain.anchors);
        expect(applyFacade(plain, { brackets: 0, pilasters: 0 }).cells).toEqual(plain.cells);
      }
    }
  });

  it('hängt nur an: bestehende Zellen bleiben (Eckquader wechseln nur Rolle/Form), Profil hinten', () => {
    for (const make of Object.values(FIXTURES)) {
      for (const roof of ROOFS) {
        const plain = deriveShell(make().state, { roof });
        const full = deriveShell(make().state, { roof, facade: ALL });
        expect(full.cells.slice(0, plain.cells.length).map((c) => key3(c.pos))).toEqual(plain.cells.map((c) => key3(c.pos)));
        full.cells.slice(0, plain.cells.length).forEach((c, i) => {
          if (c.role !== 'wall_quoin') expect(c).toEqual(plain.cells[i]);
          else {
            expect(['pillar', 'wall']).toContain(c.kind);
            // W5 (27.09.2026, N1): über der obersten Wandreihe (Deckenring, Kniestock) wird die Eckzelle ein Pfeiler
            if (c.kind !== plain.cells[i]!.kind) expect([c.kind, plain.cells[i]!.kind]).toSatisfy(([k, p]: string[]) => k === 'pillar' && (p === 'wall' || p === 'ceiling'));
          }
        });
        expect(full.cells.slice(plain.cells.length).every((c) => c.kind === 'facade')).toBe(true);
        expect(full.anchors).toEqual(plain.anchors);
        // B2: die Auskragung um 1 (jetty) tragen Konsolen – die Warnung „ohne Unterbau“ entfällt, sonst gleich
        expect(full.warnings).toEqual(plain.warnings.filter((w) => !w.includes(' kragt mit ')));
        expect(deriveShell(make().state, { roof, facade: ALL })).toEqual(full); // deterministisch
      }
    }
  });

  it('Invarianten: Außenluft, kollisionsfrei, Türen frei, Fenster frei, angebunden, Vertragsrollen', () => {
    const SHAPES: Record<string, readonly string[]> = { wall_plinth: ['stairs'], wall_cornice: ['stairs'], beam: ['stairs', 'log'] };
    for (const [name, make] of Object.entries(FIXTURES)) {
      for (const roof of ROOFS) {
        const where = `${name}/${roof}`;
        const plain = deriveShell(make().state, { roof });
        const full = deriveShell(make().state, { roof, facade: ALL });
        const m = exteriorModel(plain);
        const fac = facadeOf(full);
        expect(fac.length, where).toBeGreaterThan(0);
        expect(new Set(fac.map((c) => key3(c.pos))).size, `${where}: doppelte Positionen`).toBe(fac.length);
        for (const c of fac) {
          expect(m.isAir(c.pos), `${where}: ${c.role} bei ${c.pos} nicht in Außenluft`).toBe(true);
          expect(c.exterior, where).toBe(true);
          expect(SHAPES[c.role], `${where}: Rolle ${c.role}`).toContain(c.shape);
        }
        const facAt = new Set(fac.map((c) => key3(c.pos)));
        // Türen: Zelle davor 2 hoch (ab Bodenplatte) und 1 Block Weg frei
        for (const a of plain.anchors!.filter((x) => x.kind === 'door')) {
          for (let y = a.pos[1] - 1; y <= a.pos[1] + 1; y++) {
            for (const k of [0, 1]) expect(facAt.has(key3(at([a.pos[0], y, a.pos[2]], a.facing, k))), `${where}: Tür ${a.pos} blockiert`).toBe(false);
          }
        }
        // Fenster: nichts direkt davor (Licht und Aussicht)
        for (const w of plain.cells.filter((c) => c.kind === 'window')) {
          for (const d of HORIZONTAL) expect(facAt.has(key3(at(w.pos, d))), `${where}: Fenster ${w.pos} verdeckt`).toBe(false);
        }
        // Angebunden: jede 6er-Komponente des Profils berührt die Hülle (nichts schwebt frei)
        const solid = new Set(plain.cells.map((c) => key3(c.pos)));
        const seen = new Set<string>();
        for (const c of fac) {
          if (seen.has(key3(c.pos))) continue;
          let touches = false;
          const stack = [c.pos];
          seen.add(key3(c.pos));
          while (stack.length > 0) {
            const p = stack.pop()!;
            for (const q of [...HORIZONTAL.map((d) => at(p, d)), [p[0], p[1] + 1, p[2]] as Vec3, [p[0], p[1] - 1, p[2]] as Vec3]) {
              if (solid.has(key3(q))) touches = true;
              if (facAt.has(key3(q)) && !seen.has(key3(q))) {
                seen.add(key3(q));
                stack.push(q);
              }
            }
          }
          expect(touches, `${where}: Profil bei ${c.pos} hängt frei`).toBe(true);
        }
      }
    }
  });

  it('Sockelprofil: Treppen mit Rücken zur Wand auf Bodenplattenhöhe, Außenecken outer_right, Lücke vor der Tür', () => {
    const s = deriveShell(oneStory().state, { roof: 'hip', facade: { plinthProfile: true } });
    const plinth = facadeOf(s);
    expect(plinth.every((c) => c.role === 'wall_plinth' && c.shape === 'stairs' && c.orient?.half === 'bottom' && c.pos[1] === 0)).toBe(true);
    // Umlauf (23 + 12) × 2 + 4 Ecken, minus Tür
    expect(plinth.length).toBe(2 * (23 + 12) + 4 - 1);
    const solid = new Set(s.cells.filter((c) => c.kind !== 'facade').map((c) => key3(c.pos)));
    for (const c of plinth.filter((x) => x.orient?.stairShape === undefined)) expect(solid.has(key3(at(c.pos, c.orient!.facing!))), `${c.pos}`).toBe(true);
    const corners = plinth.filter((c) => c.orient?.stairShape !== undefined);
    expect(corners.map((c) => `${c.pos[0]},${c.pos[2]}`).sort()).toEqual(['-1,-1', '-1,12', '23,-1', '23,12']);
    expect(corners.every((c) => c.orient!.stairShape === 'outer_right')).toBe(true);
    expect(vanillaShapes(s, corners)).toEqual(corners.map(() => 'outer_right'));
  });

  it('L-Grundriss: einspringende Ecke wird von der Vanilla-Regel zur Innenecke', () => {
    const s = deriveShell(lShape().state, { roof: 'gable', facade: { plinthProfile: true } });
    const plinth = facadeOf(s);
    // einspringende Ecke: Wand Flur Ost (x = 8) trifft Wand Schankraum Nord (z = 8) → gemeinsame Zelle (9, 0, 7)
    const inner = plinth.find((c) => key3(c.pos) === '9,0,7')!;
    expect(inner).toBeDefined();
    expect(vanillaShapes(s, [inner])[0]).toMatch(/^inner_/);
    expect(plinth.filter((c) => c.orient?.stairShape === 'outer_right')).toHaveLength(5);
  });

  it('Gesims: umgedrehte Treppen an der Etagengrenze, Ecken outer_right, nicht über dem Pultdach', () => {
    const s = deriveShell(twoStory().state, { roof: 'hip', facade: { cornice: true } });
    const band = facadeOf(s);
    expect(band.length).toBeGreaterThan(30);
    expect(band.every((c) => c.role === 'wall_cornice' && c.orient?.half === 'top' && c.pos[1] === 4)).toBe(true);
    expect(band.every((c) => c.pos[0] <= 15)).toBe(true); // OG endet bei x = 14, die Schmiede hat dort ihre Decke
    const corners = band.filter((c) => c.orient?.stairShape === 'outer_right');
    expect(corners.map((c) => `${c.pos[0]},${c.pos[2]}`).sort()).toEqual(['-1,-1', '-1,12']);
    expect(vanillaShapes(s, corners)).toEqual(['outer_right', 'outer_right']);
  });

  it('Eckquader: Eckpfeiler immer, daneben wechselnd verzahnt und je Fassade spiegelgleich', () => {
    const plain = deriveShell(oneStory().state, { roof: 'hip' });
    const s = deriveShell(oneStory().state, { roof: 'hip', facade: { quoins: true } });
    expect(facadeOf(s)).toEqual([]);
    expect(s.cells.length).toBe(plain.cells.length);
    const q = new Set(s.cells.filter((c) => c.role === 'wall_quoin').map((c) => key3(c.pos)));
    expect(s.cells.filter((c) => c.role === 'wall_quoin').every((c) => c.shape === 'block' && c.orient === undefined)).toBe(true);
    for (const [x, z] of [[0, 0], [22, 0], [0, 11], [22, 11]]) for (let y = 1; y <= 3; y++) expect(q.has(`${x},${y},${z}`), `Ecke ${x},${y},${z}`).toBe(true);
    // Nordfassade: links und rechts dieselben Reihen verzahnt (s = 0 für Nord/Süd)
    for (let y = 1; y <= 3; y++) expect(q.has(`1,${y},0`)).toBe(q.has(`21,${y},0`));
    expect([1, 2, 3].map((y) => q.has(`1,${y},0`))).toEqual([true, false, true]);
    expect([1, 2, 3].map((y) => q.has(`0,${y},1`))).toEqual([false, true, false]);
  });

  it('W5 (N1): Eckquader bzw. Eckpfosten bis zur Traufunterkante – Deckenring und Kniestock der Ecke, nie über eine Etage hinweg', () => {
    const detail = { trim: true, verge: 'closed', gableWindows: true } as const;
    const s = deriveShell(oneStory().state, { roof: 'gable', overhang: 1, roofDetail: detail, facade: { quoins: true } });
    expect(s.roofFit?.[0]?.knee ?? 0).toBeGreaterThanOrEqual(1); // Beispielhaus mit Kniestock: dort endeten die Quader
    const byKey = new Map(s.cells.map((c) => [key3(c.pos), c] as const));
    for (const [x, z] of [[0, 0], [22, 0], [0, 11], [22, 11]]) {
      let y = 1;
      for (; byKey.get(`${x},${y},${z}`) !== undefined && byKey.get(`${x},${y},${z}`)!.kind !== 'roof'; y++) {
        expect(byKey.get(`${x},${y},${z}`), `Ecke ${x},${y},${z}`).toMatchObject({ kind: 'pillar', role: 'wall_quoin' });
      }
      // über der Eckspalte liegt das Dach (Traufe/Ortgang) oder Luft – die Wand der Ecke ist ganz Quader
      expect(y, `Ecke ${x},${z}`).toBeGreaterThan(4 + (s.roofFit?.[0]?.knee ?? 0));
    }
    // Gegenprobe ohne Eckquader: Deckenring der Ecke bleibt Decke, Kniestock-Ecke Giebelwand
    const plain = deriveShell(oneStory().state, { roof: 'gable', overhang: 1, roofDetail: detail });
    expect(plain.cells.find((c) => key3(c.pos) === '0,4,0')?.kind).toBe('ceiling');
    expect(plain.cells.find((c) => key3(c.pos) === '0,5,0')?.role).toBe('wall_gable');
    // ohne Eckquader, aber mit Außenprofil (Langhaus: nur Sockel): der Eckpfosten läuft mit Rolle/Form/Achse durch
    const post = deriveShell(oneStory().state, { roof: 'gable', overhang: 1, roofDetail: detail, facade: { plinthProfile: true } });
    const byPost = new Map(post.cells.map((c) => [key3(c.pos), c] as const));
    const foot = byPost.get('0,1,0')!;
    expect(foot.kind).toBe('pillar');
    for (let y = 2; byPost.get(`0,${y},0`) !== undefined && byPost.get(`0,${y},0`)!.kind !== 'roof'; y++) {
      expect(byPost.get(`0,${y},0`), `Pfosten 0,${y},0`).toMatchObject({ kind: 'pillar', role: foot.role, shape: foot.shape });
    }
    // zweistöckig: die Bodenplatte des Obergeschosses an der Ecke bleibt Platte (Geschossband), kein Quader
    const two = deriveShell(twoStory().state, { roof: 'hip', facade: { quoins: true } });
    expect(two.cells.find((c) => key3(c.pos) === '0,4,0')?.role).not.toBe('wall_quoin');
    expect(two.cells.find((c) => key3(c.pos) === '0,5,0')?.role).toBe('wall_quoin');
  });

  it('Wandvorlagen: Stamm +1 mit Fuß und Kopf, nie vor Fenstern/Türen, kein flacher Lauf über dem Maximum', () => {
    const s = deriveShell(oneStory().state, { roof: 'hip', facade: { pilasters: 5 } });
    const logs = facadeOf(s).filter((c) => c.shape === 'log');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((c) => c.role === 'beam' && c.orient?.axis === 'y' && (c.pos[1] === 1 || c.pos[1] === 2))).toBe(true);
    const byKey = new Map(s.cells.map((c) => [key3(c.pos), c] as const));
    for (const l of logs.filter((c) => c.pos[1] === 1)) {
      const foot = byKey.get(key3([l.pos[0], 0, l.pos[2]]));
      const head = byKey.get(key3([l.pos[0], 3, l.pos[2]]));
      expect(foot?.kind === 'facade' && foot.shape === 'stairs' && foot.orient?.half === 'bottom', `Fuß ${l.pos}`).toBe(true);
      expect(head?.kind === 'facade' && head.shape === 'stairs' && head.orient?.half === 'top', `Kopf ${l.pos}`).toBe(true);
    }
    // Nordfassade (z = −1): Lücken zwischen Ecken und Vorlagen ≤ 5
    const xs = logs.filter((c) => c.pos[2] === -1 && c.pos[1] === 1).map((c) => c.pos[0]).sort((a, b) => a - b);
    const pts = [0, ...xs, 22];
    expect(Math.max(...pts.slice(1).map((p, i) => p - pts[i]! - 1))).toBeLessThanOrEqual(5);
    for (const x of xs) for (let y = 1; y <= 3; y++) expect(['wall', 'pillar']).toContain(byKey.get(`${x},${y},0`)!.kind);
  });

  it('Traufkonsolen unter dem Überstand im Takt; ohne Überstand (Flachdach) keine', () => {
    const s = deriveShell(oneStory().state, { roof: 'hip', facade: { brackets: 3 } });
    const br = facadeOf(s);
    expect(br.length).toBeGreaterThan(8);
    const byKey = new Map(s.cells.map((c) => [key3(c.pos), c] as const));
    for (const c of br) {
      expect(c.role === 'beam' && c.shape === 'stairs' && c.orient?.half === 'top' && c.pos[1] === 3).toBe(true);
      expect(byKey.get(key3([c.pos[0], 4, c.pos[2]]))?.kind, `Überstand über ${c.pos}`).toBe('roof');
      expect(['wall', 'pillar', 'lintel']).toContain(byKey.get(key3(at(c.pos, c.orient!.facing!)))?.kind);
    }
    const north = br.filter((c) => c.pos[2] === -1).map((c) => c.pos[0]);
    expect(north.every((x) => (x - 2) % 3 === 0)).toBe(true);
    expect(facadeOf(deriveShell(oneStory().state, { roof: 'flat', facade: { brackets: 3 } }))).toEqual([]);
    expect(facadeOf(deriveShell(oneStory().state, { roof: 'hip', overhang: 0, facade: { brackets: 3 } }))).toEqual([]);
  });

  it('F3a: Konsolen unter gemalter Auskragung um 1 (an den Pfosten, nicht vor Fenstern)', () => {
    const s = deriveShell(jetty().state, { roof: 'hip', facade: { brackets: 3 } });
    const under = facadeOf(s).filter((c) => c.pos[2] === 0 && c.pos[1] === 3);
    expect(under.map((c) => c.pos[0])).toEqual(expect.arrayContaining([0, 12]));
    expect(under.every((c) => c.role === 'beam' && c.orient?.facing === 'south' && c.orient.half === 'top')).toBe(true);
    const windows = new Set(s.cells.filter((c) => c.kind === 'window').map((c) => key3(c.pos)));
    for (const c of under) expect(windows.has(key3([c.pos[0], 3, 1]))).toBe(false);
  });

  it('Hilfsfunktionen: Vorlagen-Verteilung und Konsolentakt', () => {
    expect(pilasterSlots(9, 4, () => true)).toEqual([4]);
    expect(pilasterSlots(6, 4, () => true)).toEqual([]);
    expect(pilasterSlots(23, 5, () => true)).toEqual([6, 11, 16]);
    expect(pilasterSlots(23, 5, (i) => i !== 11)).toEqual([6, 10, 16]);
    // spiegelsymmetrisch bei Gleichstand
    const s = pilasterSlots(14, 4, () => true);
    expect(s.map((i) => 13 - i).reverse()).toEqual(s);
    expect(rhythm(23, 3)).toEqual([2, 5, 8, 11, 14, 17, 20]);
    expect(rhythm(2, 3)).toEqual([]);
  });
});

/** Vanilla-Treppenform (StairBlock#getStairsShape) für die gegebenen Zellen, Nachbarn aus allen Treppen der Hülle. */
function vanillaShapes(s: Shell, cells: readonly ShellCell[]): string[] {
  const stairs = new Map(s.cells.filter((c) => c.shape === 'stairs').map((c) => [key3(c.pos), c] as const));
  const info = (p: Vec3): { facing: HorizontalDir; half: string } | undefined => {
    const c = stairs.get(key3(p));
    return c === undefined ? undefined : { facing: c.orient!.facing!, half: c.orient!.half ?? 'bottom' };
  };
  return cells.map((c) => {
    const self = info(c.pos)!;
    const f = self.facing;
    const can = (side: HorizontalDir): boolean => {
      const n = info(at(c.pos, side));
      return n === undefined || n.facing !== f || n.half !== self.half;
    };
    const behind = info(at(c.pos, f));
    if (behind !== undefined && behind.half === self.half && axisOf(behind.facing) !== axisOf(f) && can(OPP[behind.facing])) return behind.facing === CCW[f] ? 'outer_left' : 'outer_right';
    const front = info(at(c.pos, OPP[f]));
    if (front !== undefined && front.half === self.half && axisOf(front.facing) !== axisOf(f) && can(front.facing)) return front.facing === CCW[f] ? 'inner_left' : 'inner_right';
    return 'straight';
  });
}
