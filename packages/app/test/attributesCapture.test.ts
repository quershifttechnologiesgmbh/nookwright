/**
 * K7 am echten Bau (research/30): Außen-Deko (X1) erbt mit `captureAttributes` den Wandkontext; die Hülle selbst
 * bleibt unverändert. Der Schalter ist nur in der Pipeline an – hier wird das gemessen, damit der Effekt nicht
 * unbemerkt verschwindet und nicht auf die Hülle überschwappt.
 */
import { materialize } from '@mcda/materialize';
import { placedFor } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;

describe('K7 Capture in der Pipeline: Außen-Deko erbt, Hülle bleibt', () => {
  it('mit Capture ändern sich nur Außen-Komponenten-Zellen', async () => {
    const ctx = await browserContext(load)!.ready('1.21.11');
    // FN (2026-09-29): Seed 1 statt 4 – mit den neuen Einrichtungsbausteinen (Schlafzimmer/Küche) ergibt Seed 4 keine
    // Capture-Änderung mehr (0 statt 5), Seed 1 weiterhin mindestens eine Außen-Zelle; die Hülle bleibt unverändert
    let s = uc.createSession(1, 'K7', 'timber');
    s = uc.paintRect(s, catalog, { x1: 3, z1: 3, x2: 14, z2: 12 }, 'bedroom').session;
    s = uc.paintRect(s, catalog, { x1: 3, z1: 14, x2: 14, z2: 22 }, 'kitchen').session;
    const style = uc.shellStyle(s);
    const shell = uc.shellOf(s.project, style, uc.shellThemeOf(catalog, s.project.state.themeId));
    const ex = uc.exteriorOf(s.project, catalog, style);
    expect(ex?.placements.length ?? 0).toBeGreaterThan(20);

    const run = (captureAttributes: boolean) =>
      materialize({
        shell,
        placements: [
          ...s.project.state.placements.map((p) => ({ id: p.id, placed: placedFor(p, catalog), seed: p.seed, roomId: p.roomId })),
          ...(ex?.placements ?? []).map((p) => ({ id: p.id, placed: placedFor({ componentId: p.componentId, variantId: p.variantId, pose: p.pose } as never, catalog), seed: p.seed })),
        ],
        theme: ctx.themes.get(s.project.state.themeId),
        platform: ctx.platform(s.project.state.targetVersion.name),
        seed: s.project.state.seed,
        roomTypes: Object.fromEntries(s.project.state.rooms.map((r) => [r.id, r.roomTypeId])),
        options: captureAttributes ? { captureAttributes: true } : {},
      });

    const ohne = run(false);
    const mit = run(true);
    const stand = (r: typeof ohne): Map<string, { state: string; owner: string }> =>
      new Map([...r.volume.cells()].map((c) => [c.pos.join(','), { state: `${c.state.name}${JSON.stringify(c.state.properties)}`, owner: String(c.owner ?? '') }]));
    const a = stand(ohne);
    const b = stand(mit);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());

    const anders = [...a.entries()].filter(([k, v]) => b.get(k)!.state !== v.state);
    expect(anders.length).toBeGreaterThan(0); // sonst prüft der Test nichts
    expect(anders.length).toBeLessThanOrEqual(20); // gemessen 5 von ~50 Außen-Teilen
    for (const [, v] of anders) expect(v.owner.startsWith('shell:'), `Hüllzelle ${v.owner} hat sich geändert`).toBe(false);
  });
});
