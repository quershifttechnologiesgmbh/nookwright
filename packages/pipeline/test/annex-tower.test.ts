/**
 * C4 – angedockte Türme in der kompletten Base (research/18 T1/T3): Plan → Hülle (Türen, Aussparung) + Bauwerk
 * (Turm mit Wendel) + Gelände (Grundriss gehört zum Gebäude) in EINER Welt. Zweistöckiges Haus OHNE Innentreppe:
 * Das Obergeschoss ist nur über den Treppenturm erreichbar.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type RoofStyle } from '@mcda/blueprint';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import { annexContacts } from '@mcda/structures';
import { Site, buildingFromShell, plotAround } from '@mcda/terrain';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, shellFor, shellWithTowers, type AttachedTower, type BaseWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { Walker, standKey } from './walk.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const ROOFS: readonly RoofStyle[] = ['gable', 'hip', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox', 'flat'];

/** Zweistöckig, 15 × 9, keine Treppe im Haus (research/18 T3: „die Innenräume bleiben frei von Treppen“). */
function towerHouse(version: keyof typeof TARGET_VERSIONS = '1.21.11'): Project {
  const p = Project.create({ id: 't', name: 'Turmhaus', seed: 5, themeId: 'medieval', targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 14, 8), 'tavern');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 14, 8), 'bedroom');
  return p;
}
const opening = (x: number, z: number) => [{ floorIndex: 0, at: [x, z] as const }, { floorIndex: 1, at: [x, z] as const }];
/** T3 Treppenturm eckig 7 an der Ostwand, T1 Eckturm rund 9 an der Nordwand (ragt über die Hausecke hinaus). */
const STAIR: AttachedTower = { id: 'a1', kind: 'stair', center: [18, 4], side: 'west', openings: opening(14, 4) };
const CORNER: AttachedTower = { id: 'a2', kind: 'corner', center: [12, -5], side: 'south', hangingLanterns: true, openings: opening(10, 0) };

const hard = (w: BaseWorld): string[] => w.materialized.violations.filter((v) => v.kind !== 'spawn').map((v) => `${v.kind}@${v.pos?.join(',') ?? '-'}: ${v.message}`);
const troubles = (w: BaseWorld): string[] => w.warnings.filter((m) => /Bauwerke|Anbau|überschneiden|Turm|nicht erreichbar/.test(m));

/** Standplätze innen vor den Turmtüren je Etage (Raumsicht) und die im Turm (Bauwerk). */
function stands(w: BaseWorld, id: string): { house: Vec3[]; tower: Vec3[]; top: Vec3[] } {
  const info = w.shell.annexes!.find((a) => a.id === id)!;
  const house = info.doors.map((d): Vec3 => {
    const s: Record<string, [number, number]> = { east: [-1, 0], west: [1, 0], north: [0, 1], south: [0, -1] };
    return [d.at[0] + s[d.facing]![0], d.y, d.at[1] + s[d.facing]![1]];
  });
  const t = w.surroundings.structures!.towers.find((x) => x.id === `fort:${id}`)!;
  return { house, tower: [...t.annex!.passages], top: [...t.topStands] };
}

describe('Angedockte Türme in der Base (T1/T3)', () => {
  it('9 Dachformen × Treppen-/Eckturm: keine Kollision, 0 Verstöße, Wendel verbindet die Etagen', { timeout: HEAVY_TIMEOUT }, () => {
    for (const roof of ROOFS) {
      for (const tower of [STAIR, CORNER]) {
        const where = `${roof} · ${tower.kind}`;
        const w = generateBase(towerHouse(), ctx, { roof, attachedTowers: [tower], exterior: {}, lighting: false });
        expect(troubles(w), where).toEqual([]);
        expect(hard(w), where).toEqual([]);
        const info = w.shell.annexes!.find((a) => a.id === tower.id)!;
        expect(info.doors.length, where).toBe(2);
        // Hülle, Außen-Deko und Turm teilen sich keine Position; der Turm steht genau auf dem Anbau-Grundriss
        const shellAt = new Set(w.shell.cells.filter((c) => c.kind !== 'fort' && c.kind !== 'terrain' && c.kind !== 'plant').map((c) => key3(c.pos)));
        const fort = w.surroundings.structures!;
        expect(fort.cells.filter((c) => shellAt.has(key3(c.pos))).length, where).toBe(0);
        const ext = new Set((w.exterior ?? []).flatMap((p) => p.cells.map(key3)));
        expect(fort.cells.filter((c) => ext.has(key3(c.pos))).length, where).toBe(0);
        const base = fort.cells.filter((c) => c.pos[1] === info.doors[0]!.y - 1).map((c) => `${c.pos[0]},${c.pos[2]}`);
        expect(new Set(base), where).toEqual(new Set([...info.footprint].map(([x, z]) => `${x},${z}`)));
        // Wand bis zur Kontaktlinie: jede Randspalte an der Hauswand ist bis contactTop geschlossen (außer Durchgängen)
        const t = fort.towers.find((x) => x.id === `fort:${tower.id}`)!;
        expect(info.top, where).toBeGreaterThanOrEqual(info.contactTop);
        expect(t.topY, where).toBeGreaterThanOrEqual(info.doors[1]!.y - 1 + 3);
        // begehbar in der fertigen Welt: EG-Tür → Turm → OG-Tür → Obergeschoss und bis oben
        const s = stands(w, tower.id);
        const walker = new Walker(w.materialized.volume, ctx.platform('1.21.11'));
        const seen = walker.reach([s.house[0]!]);
        for (const p of [...s.tower, s.house[1]!]) expect(seen.has(standKey(p)), `${where}: ${p}`).toBe(true);
        expect(s.top.filter((p) => seen.has(standKey(p))).length, `${where}: oben`).toBeGreaterThan(0);
      }
    }
  });

  it('Gelände (Gehöft-Vorlage): Turm-Grundriss wie das Haus planiert, keine Wege in den Turm, erreichbar, 0 Verstöße', { timeout: HEAVY_TIMEOUT }, () => {
    for (const version of ['1.21.11', '26.3'] as const) {
      const p = towerHouse(version);
      const building = buildingFromShell(shellFor(p, { roof: 'gable' }));
      const site = Site.create({ id: 's', projectId: p.state.id, seed: 9, styleId: 'meadow', plot: plotAround(building, 14) });
      site.applyTemplate('homestead', building);
      const w = generateBase(p, ctx, { roof: 'gable', site: site.state, attachedTowers: [STAIR, CORNER], exterior: {}, lighting: false });
      expect(troubles(w), version).toEqual([]);
      expect(hard(w), version).toEqual([]);
      const foot = new Set(w.shell.annexes!.flatMap((a) => [...a.footprint].map(([x, z]) => `${x},${z}`)));
      // kein Gelände über der Bodenplatte im Turm, keine Pflanzen, kein Weg zu den Turmtüren
      const inTower = (w.surroundings.site?.cells ?? []).filter((c) => foot.has(`${c.pos[0]},${c.pos[2]}`) && c.pos[1] >= 0);
      expect(inTower.map((c) => `${c.role}@${c.pos.join(',')}`), version).toEqual([]);
      for (const id of ['a1', 'a2']) {
        const s = stands(w, id);
        const seen = new Walker(w.materialized.volume, ctx.platform(version)).reach([s.house[0]!]);
        expect([...s.tower, s.house[1]!].every((q) => seen.has(standKey(q))), `${version} ${id}`).toBe(true);
      }
    }
  });

  it('Öffnungen aus annexContacts, ungültiger Anbau → Hinweis statt Turm; ohne Türme bitgleich', { timeout: HEAVY_TIMEOUT }, () => {
    // jede Kontaktzelle auf der Hausseite, die eine gerade Hauswand trifft, wird zur Tür
    const contacts = annexContacts({ center: [18, 4], side: 'west' }).filter((c) => c.at[1] >= 1 && c.at[1] <= 7);
    expect(contacts.map((c) => c.at.join(','))).toEqual(['14,2', '14,3', '14,4', '14,5', '14,6']);
    // über Räumen: die Hülle verwirft den Anbau, der Turm entfällt mit Hinweis, sonst nichts
    const bad: AttachedTower = { ...STAIR, id: 'x', center: [12, 4] };
    const w = generateBase(towerHouse(), ctx, { roof: 'gable', attachedTowers: [bad], lighting: false });
    expect(w.warnings).toContain('Bauwerke: Turm x: kein gültiger Anbau am Haus (Grundriss über Räumen oder ohne Kontakt) – nicht gebaut');
    expect(w.surroundings.structures).toBeUndefined();
    // ohne Türme: dieselbe Hülle wie shellFor
    const p = towerHouse();
    expect(JSON.stringify(shellWithTowers(p, { roof: 'hip' }).cells)).toBe(JSON.stringify(shellFor(p, { roof: 'hip' }).cells));
  });
});
