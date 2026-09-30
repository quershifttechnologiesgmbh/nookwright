/**
 * F1-Deko über die Pipeline (research/16 W4): Theme-Vorgabe (`timber.decorate`) + Stil-Angabe → `FacadeStyle.decor`,
 * sichtbar als `dark_oak_trapdoor` (Paneele) und `dark_oak_stairs` (Giebelstreben). Ohne Theme-Vorgabe bleibt die
 * Hülle und damit die Welt zellgleich.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildWorld, decorFor, generate } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse, twoStoryHouse } from './helpers.js';
import type { GeneratedWorld, World } from '../src/index.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const theme = (id: string) => ctx.themes.get(id);

function count(w: World | GeneratedWorld, name: string): number {
  let n = 0;
  for (const c of w.materialized.volume.cells()) if (c.state.name === name) n++;
  return n;
}

describe('F1-Deko: Theme-Vorgabe und Stil', () => {
  it('Vorgabe: Fachwerk will Deko, die anderen Themes nicht', () => {
    expect(decorFor(theme('timber'), undefined)).toEqual({ panels: true, gableBraces: 3 });
    for (const id of ['medieval', 'nordic', 'rustic']) expect(decorFor(theme(id), undefined), id).toBeUndefined();
  });

  it('Stil übersteuert die Vorgabe feldweise und kann sie ganz ausschalten', () => {
    // ausdrücklich aus
    expect(decorFor(theme('timber'), { decor: { panels: false, gableBraces: 0 } })).toEqual({ panels: false, gableBraces: 0 });
    // eigener Takt, Paneele bleiben an
    expect(decorFor(theme('timber'), { decor: { gableBraces: 2 } })).toEqual({ panels: true, gableBraces: 2 });
    // ohne Theme-Vorgabe schaltet erst ein ausdrückliches Feld ein (sonst zellgleich)
    expect(decorFor(theme('medieval'), { plinthProfile: true })).toBeUndefined();
    expect(decorFor(theme('medieval'), { decor: {} })).toBeUndefined();
    expect(decorFor(theme('medieval'), { decor: { panels: true } })).toEqual({ panels: true, gableBraces: 3 });
  });

  it('Takt 0 ohne Theme-Vorgabe lässt die Paneele aus (die UI zeigt „Deko aus“)', () => {
    // Ohne Theme-Vorgabe gilt allein, was ausdrücklich dasteht: `gableBraces: 0` heißt „keine Giebelstreben“ und darf
    // nicht als Nebenwirkung die Paneele einschalten (Review-Befund 2).
    for (const id of ['medieval', 'nordic', 'rustic']) {
      expect(decorFor(theme(id), { decor: { gableBraces: 0 } }), id).toBeUndefined();
      expect(decorFor(theme(id), { decor: { gableBraces: 0, panels: false } }), id).toBeUndefined();
      expect(decorFor(theme(id), { decor: { panels: false } }), id).toBeUndefined();
      // Ein Takt > 0 oder `panels: true` schaltet ein; ein fehlender Takt bekommt dann den Standard 3
      expect(decorFor(theme(id), { decor: { gableBraces: 4 } }), id).toEqual({ panels: true, gableBraces: 4 });
      expect(decorFor(theme(id), { decor: { panels: true } }), id).toEqual({ panels: true, gableBraces: 3 });
      expect(decorFor(theme(id), { decor: { panels: true, gableBraces: 0 } }), id).toEqual({ panels: true, gableBraces: 0 });
    }
    // mit Theme-Vorgabe (Fachwerk) bleibt `gableBraces: 0` gültig: Paneele an, Streben aus
    expect(decorFor(theme('timber'), { decor: { gableBraces: 0 } })).toEqual({ panels: true, gableBraces: 0 });
  });

  it('Welt: Fachwerk bekommt Paneele und Giebelstreben, Fachwerk-Deko aus entfernt sie wieder', () => {
    const project = sampleHouse('1.21.11', 'timber');
    const on = generate(project, ctx, { roof: 'gable' });
    expect(count(on, 'dark_oak_trapdoor')).toBeGreaterThan(4);
    expect(count(on, 'dark_oak_stairs')).toBeGreaterThan(0);
    expect(on.materialized.violations, 'auch keine Spawn-Warnung: die Deko verdunkelt keine Zelle').toEqual([]);
    // Theme-Vorgabe aus: keine Deko-Zellen in der Hülle (die Außen-Deko des Hauses bleibt unberührt)
    const off = generate(project, ctx, { roof: 'gable', facade: { decor: { panels: false, gableBraces: 0 } } });
    expect(off.shell.cells.filter((c) => c.kind === 'facade' && c.role === 'beam')).toEqual([]);
    // ohne Räume im Theme keine Deko (Bestandsverhalten)
    const plain = generate(sampleHouse('1.21.11', 'medieval'), ctx, { roof: 'gable' });
    expect(plain.shell.cells.filter((c) => c.kind === 'facade' && c.role === 'beam' && (c.shape === 'trapdoor' || c.shape === 'stairs'))).toEqual([]);
  });

  it('beide Zielversionen, alle Dachformen, zweistöckig: Paneele sitzen, 0 harte Verstöße', () => {
    for (const version of ['1.21.11', '26.3'] as const) {
      for (const roof of ['gable', 'hip', 'flat'] as const) {
        const w = generate(twoStoryHouse(version, 'timber'), ctx, { roof });
        const where = `${version}/${roof}`;
        expect(count(w, 'dark_oak_trapdoor'), where).toBeGreaterThan(0);
        expect(w.materialized.violations, where).toEqual([]);
        const panels = w.shell.cells.filter((c) => c.kind === 'facade' && c.shape === 'trapdoor');
        expect(panels.every((c) => c.orient?.open === true && c.orient.half === 'top'), where).toBe(true);
      }
    }
  });
});
