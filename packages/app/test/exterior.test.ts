/**
 * Dach-Details, Außenprofil und Raumtyp-Gruppen (U2a): Einstellungen der Sitzung, Undo/Redo, styleKey-Cache,
 * Projektdatei alt/neu, Vorschau = Export, Vorlage Fachwerkhaus, Gruppierung und Suche der Raumtypen.
 */
import { DomainError, FACADE_QUALITY_RULES, type ShellCell } from '@mcda/blueprint';
import { shellFor, type PipelineContext } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { exportReport, worldOf } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import { templateSession } from '../src/templates.js';
import { OTHER_GROUP, ROOM_TYPE_GROUPS, groupRoomTypes, normalizeSearch, roomTypeGroupOf, roomTypeInfos, type RoomTypeInfo } from '../src/ui/roomTypeGroups.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;

const PLAIN: Pick<uc.ShellStyle, 'roofDetail' | 'facade'> = { roofDetail: uc.PLAIN_ROOF_DETAIL, facade: uc.PLAIN_FACADE };
const FULL_FACADE: uc.FacadeChoice = { plinthProfile: true, cornice: true, quoins: true, pilasters: 4, brackets: 3, quality: true };

const cells = (s: uc.Session): readonly ShellCell[] => uc.shellOf(s.project, uc.shellStyle(s)).cells;
const ridge = (s: uc.Session): number => Math.max(...cells(s).filter((c) => c.kind === 'roof').map((c) => c.pos[1]));
const count = (s: uc.Session, f: (c: ShellCell) => boolean): number => cells(s).filter(f).length;
const detail = (s: uc.Session, patch: Partial<uc.RoofDetailChoice>): uc.Session =>
  uc.setShellStyle(s, { roofDetail: { ...uc.shellStyle(s).roofDetail, ...patch } }, catalog);
const facade = (s: uc.Session, patch: Partial<uc.FacadeChoice>): uc.Session => uc.setShellStyle(s, { facade: { ...uc.shellStyle(s).facade, ...patch } }, catalog);

function lit(s: uc.Session, ctx: PipelineContext): uc.Session {
  const r = lightSession(s, ctx);
  expect(r.session.light?.error).toBeUndefined();
  return r.session;
}

describe('Dach-Details und Außenprofil: Einstellungen der Sitzung', () => {
  it('neue Projekte: Satteldach 45° mit Kante, geschlossenem Ortgang, Giebelfenstern; Sockel, Gesims, Eckquader', () => {
    const s = sampleSession(catalog);
    expect(uc.shellStyle(s)).toEqual({
      roof: 'gable', overhang: uc.DEFAULT_OVERHANG, windows: uc.DEFAULT_WINDOWS, roofDetail: uc.DEFAULT_ROOF_DETAIL, dormers: uc.DEFAULT_DORMERS, facade: uc.DEFAULT_FACADE,
      exterior: uc.DEFAULT_EXTERIOR,
    });
    expect(uc.DEFAULT_ROOF_DETAIL).toEqual({ pitch: 'normal', trim: true, verge: 'closed', flare: false, gableWindows: true, halfHipRows: 0, mansardBreak: 0 });
    expect(count(s, (c) => c.kind === 'facade')).toBeGreaterThan(0); // Sockel
    expect(count(s, (c) => c.role === 'wall_quoin')).toBeGreaterThan(0);
    expect(count(s, (c) => c.role === 'roof_trim')).toBeGreaterThan(0);
    const ceiling = Math.max(...cells(s).filter((c) => c.kind === 'ceiling').map((c) => c.pos[1]));
    expect(count(s, (c) => c.kind === 'window' && c.pos[1] > ceiling)).toBeGreaterThan(0); // Giebelfenster
    // eine Dachform als Zeichenkette = Stil neuer Projekte mit dieser Form
    expect(uc.styleKey('gable')).toBe(uc.styleKey(uc.shellStyle(s)));
  });

  it('Neigung: steil hebt, niedrig senkt den First; je ein Undo-Schritt, Wiederholen, Einrichtung bleibt', () => {
    const s0 = sampleSession(catalog);
    const steep = detail(s0, { pitch: 'steep' });
    const low = detail(s0, { pitch: 'low' });
    expect(ridge(steep)).toBeGreaterThan(ridge(s0));
    expect(ridge(low)).toBeLessThan(ridge(s0));
    expect(steep.past).toHaveLength(s0.past.length + 1);
    expect(steep.project).toBe(s0.project); // Dach ändert keine Raumgeometrie → keine neue Einrichtung
    expect(steep.needsLight).toBe(true);
    const back = uc.undo(steep);
    expect(uc.shellStyle(back)).toEqual(uc.shellStyle(s0));
    expect(uc.shellStyle(uc.redo(back)).roofDetail.pitch).toBe('steep');
    // dieselbe Einstellung noch einmal: keine Aktion
    expect(detail(steep, { pitch: 'steep' })).toBe(steep);
  });

  it('Details: Kante, Ortgang, Glockenfuß, Giebelfenster wirken; Walm-Reihen/Knick nur bei ihrer Dachform', () => {
    const s0 = sampleSession(catalog);
    // Q2: die Pflichtregeln erzwingen die Dachkante – der Schalter „Kante“ wirkt nur ohne sie
    expect(count(detail(s0, { trim: false }), (c) => c.role === 'roof_trim')).toBeGreaterThan(0);
    const ohneRegeln = facade(s0, { quality: false });
    expect(count(detail(ohneRegeln, { trim: false }), (c) => c.role === 'roof_trim')).toBe(0);
    const topStairs = (s: uc.Session) => count(s, (c) => c.kind === 'roof' && c.shape === 'stairs' && c.orient?.half === 'top');
    expect(topStairs(detail(s0, { verge: 'plain' }))).toBeLessThan(topStairs(s0)); // umgedrehte Treppen unter dem Ortgang
    expect(uc.styleKey(uc.shellStyle(detail(s0, { flare: true })))).not.toBe(uc.styleKey(uc.shellStyle(s0)));
    const noGable = detail(s0, { gableWindows: false });
    expect(count(noGable, (c) => c.kind === 'window')).toBeLessThan(count(s0, (c) => c.kind === 'window'));
    // Walm-Reihen beim Satteldach: Hülle gleich → keine Aktion; beim Krüppelwalm ein Unterschied
    expect(detail(s0, { halfHipRows: 2 })).toBe(s0);
    const halfHip = uc.setShellStyle(s0, { roof: 'half_hip' }, catalog);
    const rows1 = detail(halfHip, { halfHipRows: 1 });
    const rows3 = detail(halfHip, { halfHipRows: 3 });
    expect(uc.styleKey(uc.shellStyle(rows1))).not.toBe(uc.styleKey(uc.shellStyle(rows3)));
    expect(cells(rows1)).not.toEqual(cells(rows3));
    expect(detail(s0, { mansardBreak: 2 })).toBe(s0);
    const gambrel = uc.setShellStyle(s0, { roof: 'gambrel' }, catalog);
    expect(ridge(detail(gambrel, { mansardBreak: 1 }))).not.toBe(ridge(detail(gambrel, { mansardBreak: 4 })));
    // ungültige Werte
    expect(() => detail(s0, { pitch: 'vertical' as never })).toThrow(DomainError);
    expect(() => detail(s0, { halfHipRows: 9 })).toThrow(/Walm-Reihen/);
    expect(() => detail(s0, { mansardBreak: -1 })).toThrow(/Knickhöhe/);
    expect(() => detail(s0, { verge: 'open' as never })).toThrow(/Ortgang/);
  });

  it('Außenprofil: Sockel, Gesims, Eckquader, Wandvorlagen, Konsolen; alles aus = kein Profil', () => {
    let s = uc.addFloor(sampleSession(catalog), catalog).session;
    s = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 14, z2: 11 }, 'library', 1).session;
    const none = uc.setShellStyle(s, { facade: uc.PLAIN_FACADE }, catalog);
    expect(count(none, (c) => c.kind === 'facade')).toBe(0);
    expect(count(none, (c) => c.role === 'wall_quoin')).toBe(0);
    const only = (patch: Partial<uc.FacadeChoice>) => facade(none, patch);
    expect(count(only({ plinthProfile: true }), (c) => c.kind === 'facade' && c.role === 'wall_plinth')).toBeGreaterThan(0);
    expect(count(only({ cornice: true }), (c) => c.kind === 'facade' && c.role === 'wall_cornice')).toBeGreaterThan(0);
    expect(count(only({ quoins: true }), (c) => c.role === 'wall_quoin')).toBeGreaterThan(0);
    expect(count(only({ pilasters: 4 }), (c) => c.kind === 'facade' && c.shape === 'log')).toBeGreaterThan(0);
    expect(count(only({ brackets: 3 }), (c) => c.kind === 'facade')).toBeGreaterThan(0);
    const dense = count(only({ pilasters: 3 }), (c) => c.kind === 'facade');
    expect(dense).toBeGreaterThan(count(only({ pilasters: 8 }), (c) => c.kind === 'facade'));
    expect(uc.undo(only({ quoins: true })).facade).toEqual(uc.PLAIN_FACADE);
    expect(() => facade(none, { pilasters: 2 })).toThrow(/Wandvorlagen/);
    expect(() => facade(none, { brackets: 7 })).toThrow(/Konsolen/);
    expect(() => facade(none, { cornice: 'ja' as never })).toThrow(DomainError);
  });

  it('schlicht = Hülle wie vor dem Dach-Paket; Fenster aus schaltet auch die Giebelfenster ab', () => {
    const s = sampleSession(catalog);
    const plain: uc.ShellStyle = { ...uc.shellStyle(s), ...PLAIN };
    const o = uc.shellOptions(plain);
    expect(o).toEqual({ roof: 'gable', overhang: uc.DEFAULT_OVERHANG, windows: { spacing: uc.DEFAULT_WINDOWS.spacing } });
    expect(uc.shellOf(s.project, plain).cells).toEqual(shellFor(s.project, { roof: 'gable', overhang: 1, windows: { spacing: uc.DEFAULT_WINDOWS.spacing } }).cells);
    const off = uc.setShellStyle(s, { windows: { enabled: false, spacing: 4 } }, catalog);
    expect(count(off, (c) => c.kind === 'window')).toBe(0);
    expect(uc.roofDetailOptions('gable', uc.DEFAULT_ROOF_DETAIL, false)?.gableWindows).toBe(false);
    expect(uc.roofDetailOptions('gable', uc.PLAIN_ROOF_DETAIL)).toBeUndefined();
    expect(uc.roofDetailOptions('hip', { ...uc.PLAIN_ROOF_DETAIL, halfHipRows: 2, mansardBreak: 2 })).toBeUndefined(); // nicht genutzt
    expect(uc.facadeOptions(uc.PLAIN_FACADE)).toBeUndefined();
    // Q2: `quality` übersetzt sich in die Pflichtregeln der Domäne
    expect(uc.facadeOptions(FULL_FACADE)).toEqual({ rules: FACADE_QUALITY_RULES, plinthProfile: true, cornice: true, quoins: true, pilasters: 4, brackets: 3 });
  });

  it('styleKey-Cache: gleicher Stil → dieselbe Hülle (auch als neues Objekt), Zurückschalten ohne Neuberechnung', () => {
    const s = sampleSession(catalog);
    const style = uc.shellStyle(s);
    const a = uc.shellOf(s.project, style);
    expect(uc.shellOf(s.project, { ...style, roofDetail: { ...style.roofDetail }, facade: { ...style.facade } })).toBe(a);
    const variants: uc.ShellStyle[] = [
      style,
      { ...style, roofDetail: { ...style.roofDetail, pitch: 'steep' } },
      { ...style, roofDetail: { ...style.roofDetail, trim: false } },
      { ...style, roofDetail: { ...style.roofDetail, verge: 'plain' } },
      { ...style, roofDetail: { ...style.roofDetail, flare: true } },
      { ...style, roofDetail: { ...style.roofDetail, gableWindows: false } },
      { ...style, facade: { ...style.facade, plinthProfile: false } },
      { ...style, facade: { ...style.facade, cornice: false } },
      { ...style, facade: { ...style.facade, quoins: false } },
      { ...style, facade: { ...style.facade, pilasters: 5 } },
      { ...style, facade: { ...style.facade, brackets: 3 } },
      { ...style, roof: 'half_hip', roofDetail: { ...style.roofDetail, halfHipRows: 2 } },
      { ...style, roof: 'half_hip' },
    ];
    expect(new Set(variants.map(uc.styleKey)).size).toBe(variants.length);
    const steep = uc.shellOf(s.project, variants[1]!);
    expect(steep).not.toBe(a);
    expect(uc.shellOf(s.project, style)).toBe(a); // zurück: aus dem Cache
    expect(uc.shellOf(s.project, variants[1]!)).toBe(steep);
    // Einstellungen ohne Wirkung ändern den Schlüssel nicht
    expect(uc.styleKey({ ...style, roofDetail: { ...style.roofDetail, halfHipRows: 3 } })).toBe(uc.styleKey(style));
    const off = { ...style, windows: { enabled: false, spacing: 4 } };
    expect(uc.styleKey({ ...off, roofDetail: { ...off.roofDetail, gableWindows: false } })).toBe(uc.styleKey(off));
  });

  it('Statuszeile nennt, was sich geändert hat', () => {
    const st = uc.shellStyle(sampleSession(catalog));
    expect(uc.styleChangeLabel(st, { roof: 'mansard' })).toBe('Dach: Mansarde');
    expect(uc.styleChangeLabel(st, { overhang: 2 })).toBe('Dachüberstand 2');
    expect(uc.styleChangeLabel(st, { roofDetail: { ...st.roofDetail, pitch: 'steep' } })).toBe('Dachneigung: Steil');
    expect(uc.styleChangeLabel(st, { roofDetail: { ...st.roofDetail, verge: 'plain' } })).toBe('Ortgang: offen');
    expect(uc.styleChangeLabel(st, { roofDetail: { ...st.roofDetail, mansardBreak: 0, halfHipRows: 2 } })).toBe('Walm-Reihen: 2');
    expect(uc.styleChangeLabel(st, { facade: { ...st.facade, pilasters: 5 } })).toBe('Wandvorlagen: 5');
    expect(uc.styleChangeLabel(st, { facade: { ...st.facade, quoins: false } })).toBe('Eckquader: aus');
    expect(uc.styleChangeLabel(st, { windows: { enabled: false, spacing: 4 } })).toBe('Fenster geändert');
  });
});

describe('Projektdatei: Dach-Details und Außenprofil', () => {
  it('Round-Trip: Neigung, Details und Außenprofil kommen zurück; gleiche Hülle', () => {
    let s = sampleSession(catalog);
    s = uc.setShellStyle(s, { roof: 'half_hip', roofDetail: { pitch: 'steep', trim: true, verge: 'closed', flare: true, gableWindows: false, halfHipRows: 2, mansardBreak: 3 }, facade: FULL_FACADE }, catalog);
    const text = serializeProject(s);
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data['roofDetail']).toEqual(uc.shellStyle(s).roofDetail);
    expect(data['facade']).toEqual(FULL_FACADE);
    const r = parseProjectFile(text, { catalog });
    if (!r.ok) throw new Error(r.error);
    expect(uc.settingsOf(r.session)).toEqual(uc.settingsOf(s));
    expect(uc.shellOf(r.session.project, uc.shellStyle(r.session)).cells).toEqual(cells(s));
  });

  it('ältere Dateien ohne die Felder laden schlicht (wie gespeichert); ungültige Felder einzeln auf schlicht', () => {
    const s = sampleSession(catalog);
    const data = JSON.parse(serializeProject(s)) as Record<string, unknown>;
    delete data['roofDetail'];
    delete data['facade'];
    const old = parseProjectFile(JSON.stringify({ ...data, roof: 'hip' }), { catalog });
    if (!old.ok) throw new Error(old.error);
    expect(uc.shellStyle(old.session)).toMatchObject({ roof: 'hip', ...PLAIN });
    expect(uc.shellOptions(uc.shellStyle(old.session))).toEqual({ roof: 'hip', overhang: 1, windows: { spacing: uc.DEFAULT_WINDOWS.spacing } }); // Hülle wie vor dem Paket
    const odd = parseProjectFile(
      JSON.stringify({ ...data, roofDetail: { pitch: 'steep', trim: 'ja', verge: 'zu', halfHipRows: 9, mansardBreak: 2, flare: true }, facade: { pilasters: 2, brackets: 4, quoins: true, cornice: 1 } }),
      { catalog },
    );
    if (!odd.ok) throw new Error(odd.error);
    expect(uc.shellStyle(odd.session).roofDetail).toEqual({ ...uc.PLAIN_ROOF_DETAIL, pitch: 'steep', flare: true, mansardBreak: 2 });
    expect(uc.shellStyle(odd.session).facade).toEqual({ ...uc.PLAIN_FACADE, quality: undefined, brackets: 4, quoins: true });
  });
});

describe('Vorschau = Export', () => {
  it('Blöcke enthalten Außenprofil und Dachkante; gleicher Stil → dieselbe Welt; 0 harte Verstöße', async () => {
    const ctx = await pipeline.ready('1.21.11');
    let s = sampleSession(catalog);
    s = uc.setShellStyle(s, { roofDetail: { ...uc.DEFAULT_ROOF_DETAIL, pitch: 'steep' }, facade: FULL_FACADE }, catalog);
    s = lit(s, ctx);
    const style = uc.shellStyle(s);
    const world = worldOf(s.project, ctx, style);
    expect(worldOf(s.project, ctx, { ...style, facade: { ...style.facade } })).toBe(world); // Cache über styleKey
    const vol = world.materialized.volume;
    const profile = cells(s).filter((c) => c.kind === 'facade');
    expect(profile.length).toBeGreaterThan(0);
    for (const c of profile) expect(vol.isEmpty(c.pos), `Profilzelle ${c.pos.join(',')} fehlt im Export`).toBe(false);
    for (const c of cells(s).filter((x) => x.kind === 'roof')) expect(vol.isEmpty(c.pos)).toBe(false);
    const report = exportReport(world);
    expect(report.errors, report.errors.map((v) => v.message).join('\n')).toEqual([]);
    expect(report.darkCells).toBe(0);
    // anderer Stil → andere Welt
    expect(worldOf(s.project, ctx, { ...style, ...PLAIN })).not.toBe(world);
  });
});

describe('Vorlage „Fachwerkhaus“', () => {
  it('Theme Fachwerk, zwei Etagen, Treppe, steiles Satteldach mit Details, Außenprofil ohne Wandvorlagen, weite Fenster, 0 harte Verstöße', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = lit(templateSession('timber', catalog, 7, 'medieval', { ...uc.shellStyle({ roof: 'hip' }), exterior: uc.PLAIN_EXTERIOR }), ctx);
    expect(s.past).toEqual([]);
    expect(s.project.state.themeId).toBe('timber');
    expect(s.project.state.floors).toHaveLength(2);
    expect(s.project.state.links).toHaveLength(1);
    const st = uc.shellStyle(s);
    expect(st.roof).toBe('gable');
    expect(st.roofDetail).toMatchObject({ pitch: 'steep', trim: true, verge: 'closed', gableWindows: true });
    // ohne Wandvorlagen und ohne die Pfeiler-Pflicht der Q2-Regeln (W1-G S4a: wie Engine und Galerie)
    // W13-E (2026-09-28): dazu das Wandkleid der Obergeschosse aus dem Bautyp (`upperFrame`)
    expect(st.facade).toEqual({ ...FULL_FACADE, pilasters: 0, piers: false, upperFrame: true });
    expect(st.windows).toEqual({ enabled: true, spacing: 6 });
    expect(st.exterior).toEqual(uc.DEFAULT_EXTERIOR); // Außen-Deko samt Läden an, auch wenn das bisherige Projekt sie aus hatte
    // W2 (26.09.2026): Regel F5/F6 (W2-FW) – das Fenstermodul „Fachwerk“ hat keine Läden (sie lägen vor den Ständern),
    // die Fenster tragen Blumenkasten bzw. Bank, Laternen hängen an den Pfosten
    const ext = uc.exteriorOf(s.project, catalog, st)!;
    expect(ext.counts.shutters).toBe(0);
    expect(ext.counts.flowerBoxes + ext.counts.sills).toBeGreaterThan(0);
    expect(ext.placements.some((p) => p.variantId === 'lantern')).toBe(true);
    expect(count(s, (c) => c.kind === 'facade' && c.role === 'wall_cornice')).toBeGreaterThan(0);
    expect(uc.shellOf(s.project, st).warnings).toEqual([]); // Treppenöffnung teilt keinen Raum
    expect([...s.warnings.values()].flat()).toEqual([]); // alle Pflichtobjekte passen
    const report = exportReport(worldOf(s.project, ctx, st));
    expect(report.errors, report.errors.map((v) => v.message).join('\n')).toEqual([]);
    expect(report.darkCells).toBe(0);
  });

  it('andere Vorlagen übernehmen den Stil des bisherigen Projekts (Dachform nur, wenn die Vorlage keine vorgibt)', () => {
    const style: uc.ShellStyle = { ...uc.shellStyle({ roof: 'mansard' }), roofDetail: { ...uc.DEFAULT_ROOF_DETAIL, pitch: 'low' }, facade: FULL_FACADE };
    const house = templateSession('house', catalog, 3, 'medieval', style);
    // W12-A (2026-09-28): das Beispielhaus gibt wie der Zweistöcker sein Außenprofil vor (Konsolen für die Auskragung des
    // Obergeschosses der zweigeschossigen Variante, ohne Wandvorlagen); Dachform und Rest erben weiter vom Projekt
    // W13-E (2026-09-28): dazu das Wandkleid der Obergeschosse (`upperFrame`, Fachwerk über dem Steingeschoss) – damit
    // entfällt wie beim Fachwerk-Theme die Pfeiler-Pflicht (vorher `{ ...FULL_FACADE, pilasters: 0 }`, ebenso Zweistöcker)
    // W13-A Runde 2 (2026-09-28): das Beispielhaus gibt dazu Gauben vor (Satteldach-Gauben, 3 breit); vorher ohne `dormers`
    expect(uc.shellStyle(house)).toEqual({ ...style, facade: { ...FULL_FACADE, pilasters: 0, piers: false, upperFrame: true }, dormers: { kind: 'gable', width: 3, minGap: 2 } });
    const two = templateSession('twostory', catalog, 3, 'medieval', style);
    // W9 (2026-09-27): W9-G1 gibt dem Zweistöcker ein eigenes Außenprofil (`shell.facade` mit Konsolen für die
    // Auskragung, ohne Wandvorlagen) – wie die Dachform gilt es dann aus der Vorlage; der Rest erbt weiter vom Projekt
    expect(uc.shellStyle(two)).toEqual({ ...style, roof: 'gable', facade: { ...FULL_FACADE, pilasters: 0, piers: false, upperFrame: true } });
    expect(uc.shellStyle(templateSession('empty', catalog, 3, 'medieval', 'flat')).roof).toBe('flat');
  });
});

describe('Raumtyp-Gruppen und Suche', () => {
  const types = roomTypeInfos(catalog);
  const ids = (gs: ReturnType<typeof groupRoomTypes>) => gs.flatMap((g) => g.items.map((t) => t.id));

  it('jeder Raumtyp des Katalogs genau einmal, bekannte in ihrer Gruppe, alphabetisch, keine leeren Gruppen', () => {
    const groups = groupRoomTypes(types);
    expect(ids(groups).sort()).toEqual([...catalog.roomTypeIds()].sort());
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
      expect(g.items.map((t) => t.name)).toEqual([...g.items.map((t) => t.name)].sort((a, b) => a.localeCompare(b, 'de')));
    }
    const order = [...ROOM_TYPE_GROUPS.map((g) => g.id), OTHER_GROUP.id];
    expect(groups.map((g) => order.indexOf(g.id))).toEqual([...groups.map((g) => order.indexOf(g.id))].sort((a, b) => a - b));
    expect(groups.find((g) => g.id === 'living')?.items.map((t) => t.id)).toContain('bedroom');
    expect(groups.find((g) => g.id === 'supply')?.items.map((t) => t.id)).toContain('kitchen');
    // Jede ID steht höchstens in einer Gruppe der Zuordnung
    const mapped = ROOM_TYPE_GROUPS.flatMap((g) => g.ids);
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it('unbekannte IDs: „Weitere“ (zuletzt), mit Stil-Pflicht nordic „Nordisch“; 45 Typen bleiben gruppiert', () => {
    const extra: RoomTypeInfo[] = [
      { id: 'zz_neu', name: 'Neuer Raum' },
      { id: 'jarl_hall', name: 'Jarlshalle', styleTags: { require: ['nordic'] } },
    ];
    const groups = groupRoomTypes([...types, ...extra]);
    expect(groups.at(-1)).toMatchObject({ id: OTHER_GROUP.id, label: 'Weitere' });
    expect(groups.at(-1)!.items.map((t) => t.id)).toContain('zz_neu');
    expect(roomTypeGroupOf(extra[1]!)).toBe('nordic');
    expect(roomTypeGroupOf({ id: 'bedroom', styleTags: { require: ['nordic'] } })).toBe('living'); // Zuordnung vor Stil
    const many: RoomTypeInfo[] = Array.from({ length: 45 }, (_, i) => types[i % types.length]!).map((t, i) => ({ ...t, id: i < types.length ? t.id : `${t.id}_${i}` }));
    const g45 = groupRoomTypes(many);
    expect(ids(g45)).toHaveLength(45);
    expect(g45.length).toBeLessThanOrEqual(ROOM_TYPE_GROUPS.length + 1);
  });

  it('Suche: Name, ID oder Gruppe, ohne Groß/klein und Umlaut-Punkte, alle Wörter müssen passen', () => {
    expect(normalizeSearch('  Große_Küche ')).toBe('grosse kuche');
    expect(ids(groupRoomTypes(types, 'küche'))).toContain('kitchen');
    expect(ids(groupRoomTypes(types, 'KUCHE'))).toContain('kitchen');
    expect(ids(groupRoomTypes(types, 'farm_room'))).toEqual(['farm_room']);
    const wehr = groupRoomTypes(types, 'wehr');
    expect(wehr.map((g) => g.id)).toEqual(['defense']);
    expect(ids(groupRoomTypes(types, 'schlaf zimmer'))).toEqual(['bedroom']);
    expect(groupRoomTypes(types, 'xyzzy')).toEqual([]);
    expect(ids(groupRoomTypes(types, ''))).toHaveLength(types.length);
  });
});
