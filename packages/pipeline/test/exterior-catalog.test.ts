/**
 * X1 (Katalog-Parität der Außen-Komponenten): JEDE Komponente mit Außen-Montage – alle Varianten, gedehnte Formen
 * (0 und max), alle Themes – materialisiert in 1.21.11 und 26.3 fehlerfrei an einer synthetischen Fassade: vor der
 * Wand (`facade`), unter der Traufe (`eave`), auf dem Dach (`roof`, `roof_peak`). Keine Auflösungsfehler, keine
 * Physik-/Masken-Verstöße (Laternen hängen, Blumen stehen auf Erde, Schilder am Zaun), alle Zellen gesetzt.
 * Gegenstück zu catalog-components.test.ts (Innenraum), das Außen-Montagen auslässt.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import { CellSet, type Vec3 } from '@mcda/core';
import { EXTERIOR_MOUNTS, ExteriorSite, type Part } from '@mcda/exterior';
import { expandComponent, formatVariantId } from '@mcda/furnishing';
import { materialize } from '@mcda/materialize';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;

/**
 * Fassade nach dem Hüllen-Vertrag: Nordwand z = 0 (x 0…13, y 1…4) mit Eckpfosten, Boden y 0, Decke y 5 (Dach),
 * Traufe aus Dachtreppen vor der Wand auf y 5 (steigt zur Wand, volle Unterseite). Außen = z < 0.
 */
const roomId = 'r1';
const shell: Shell = (() => {
  const cells: ShellCell[] = [];
  for (let x = 0; x <= 13; x++) {
    for (let z = 0; z <= 4; z++) {
      cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId });
      cells.push({ pos: [x, 5, z], kind: 'ceiling', role: 'ceiling', shape: 'block', roomId, exterior: true });
    }
    for (let y = 1; y <= 4; y++) {
      const edge = x === 0 || x === 13;
      cells.push(edge
        ? { pos: [x, y, 0], kind: 'pillar', role: 'beam', shape: 'log', orient: { axis: 'y' }, roomId, exterior: true }
        : { pos: [x, y, 0], kind: 'wall', role: 'wall_primary', shape: 'block', roomId, exterior: true });
    }
    cells.push({ pos: [x, 5, -1], kind: 'roof', role: 'roof_main', shape: 'stairs', orient: { facing: 'south', half: 'bottom' }, roomId, exterior: true });
  }
  const info: RoomShellInfo = { roomId, floorIndex: 0, baseY: 1, height: 4, interior: CellSet.rect(1, 1, 12, 4), doors: [], windows: [] };
  return { cells, rooms: new Map([[roomId, info]]), warnings: [] };
})();
const site = new ExteriorSite(shell, ctx.catalog, 1);

/**
 * Andockstelle je Montage: vor der Wand, unter der Traufe, auf dem Dach, an der Außenecke.
 * `corner_out` fehlte hier (Q1a): die Montage stand schon in `EXTERIOR_MOUNTS`, aber kein Katalogstück nutzte sie,
 * deshalb lief der Test in einen TypeError. Die Ecke liegt bei [6,1,-1] in der freien Außenluft (alle Zellen der
 * Eckstücke liegen bei z ≤ -1 und damit außerhalb der Hülle).
 */
const AT: Readonly<Record<string, Vec3>> = { facade: [6, 1, -1], eave: [6, 4, -1], roof: [6, 6, 2], roof_peak: [6, 6, 2], corner_out: [6, 1, -1] };

const defs = ctx.catalog.all().filter((d) => EXTERIOR_MOUNTS.has(d.mount));
const cases = defs.flatMap((def) => (def.variants?.map((v) => v.id) ?? [undefined]).flatMap((v) => {
  const stretch = def.variants?.find((x) => x.id === v)?.stretch ?? def.stretch;
  // EXT2: die Testfassade ist 4 Zeilen hoch (Dach ab Zeile 5); hohe Dehnstücke (Wandpfeiler, Regenfallrohr) werden auf das
  // dort Passende gekürzt – im Einbau dehnt der Planer sie nur über freier Wand
  const room = def.mount === 'facade' ? 4 - expandComponent(def, v).size[1] : Infinity;
  const top = stretch === undefined ? 0 : Math.max(0, Math.min(stretch.max, room));
  return (top === 0 ? [0] : [0, top]).map((n) => ({ def, variantId: v, n }));
}));

describe('X1: jede Außen-Komponente materialisiert fehlerfrei an einer Fassade (alle Varianten, Themes, 1.21.11 + 26.3)', () => {
  it('der Außen-Katalog ist da (Fenster, Eingang, Dach)', () => {
    for (const id of ['exterior/shutter', 'exterior/flower_box', 'exterior/window_sill', 'exterior/window_hood', 'exterior/door_portal', 'exterior/door_porch',
      'exterior/door_canopy', 'exterior/stoop', 'exterior/wall_lantern', 'exterior/planter', 'exterior/bench', 'exterior/shop_sign', 'exterior/chimney',
      'exterior/eave_lantern', 'exterior/ridge_finial']) {
      expect(ctx.catalog.find(id), id).toBeDefined();
    }
  });

  for (const { def, variantId, n } of cases) {
    const label = `${def.id}${variantId !== undefined ? `#${variantId}` : ''}${n > 0 ? `~${n}` : ''}`;
    it(label, () => {
      // W3 (27.09.2026): Eingangsmodule setzt der Planer an der Mittelspalte an, Schicht 0 = Bodenplattenreihe. Hier
      // liegt die oberste Schicht des Stücks direkt unter der Traufe (y 4) – so hängen Laternen-Stücke ohne eigenen
      // Träger (Vordach/Rähm kommt im Planer aus einem anderen Stück) an der Traufe wie im echten Einbau.
      // W4 (27.09.2026): Stücke der Doppeltür (`double_*`) sind gerade breit – angesetzt an der linken Mittelspalte.
      const size = expandComponent(def, variantId).size;
      const module = def.id.startsWith('exterior/entrance_module_');
      // W7 (27.09.2026): das Laternenpaar des Erdhaus-Portals steht im Einbau auf den umgedrehten Treppen des Rundtür-Rings
      // (Hülle, Lage buried; das Gelände prüft die Unterlage) – hier steht es auf der Decke
      const standing = def.id === 'exterior/earth_portal' && variantId?.startsWith('lanterns') === true;
      const at: Vec3 = standing ? [6, 6, 2] : module ? [6, 4 - (size[1] - 1), -1] : AT[def.mount]!;
      const part: Part = {
        componentId: def.id, ...(variantId !== undefined ? { variantId } : {}), ...(n > 0 ? { stretch: n } : {}),
        facing: 'north', local: [def.id.startsWith('exterior/door_') ? 1 : module ? Math.floor((size[0] - 1) / 2) : 0, 0, 0], at,
      };
      const placed = site.placed(part);
      expect(placed.expanded.variantId).toBe(n > 0 ? formatVariantId(variantId, n) : variantId);
      expect(site.fits(placed), `${label}: passt nicht in die Außenluft der Testfassade`).toBe(true);
      for (const version of VERSIONS) {
        const platform = ctx.platform(version);
        for (const themeId of ctx.themes.ids()) {
          // W7: Ruine trägt die Decke der Testfassade ab (Unterlage der stehenden Laternen); im Einbau sind die Ring-Treppen
          // als Träger gesperrt – belegt in earth-portal.test.ts (Erdhaus in allen Themes, 0 harte Verstöße)
          if (standing && themeId === 'ruin') continue;
          const where = `${label} · ${themeId} · ${version}`;
          const r = materialize({ shell, placements: [{ id: 'c', placed }], theme: ctx.themes.get(themeId), platform, seed: 5 });
          const hard = r.violations.filter((v) => v.kind !== 'spawn');
          expect(hard, `${where}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
          expect(r.volume.cellsOf('c').length, where).toBe(placed.cells.length);
        }
      }
    });
  }
});
