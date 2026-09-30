/**
 * Gauben in der App (B2 §10): Einstellung als Teil des Stils von außen – Hülle, Undo/Redo, Statuszeile, Prüfung,
 * Hinweis „keine Gaube passt“, Projektdatei alt/neu, „Fenster aus“ über `WindowStyle.enabled`.
 */
import { DomainError } from '@mcda/blueprint';
import { shellFor } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { exportReport, worldOf } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;

const GABLE3: uc.DormerChoice = { kind: 'gable', width: 3, minGap: 2 };
const dormers = (s: uc.Session, patch: Partial<uc.DormerChoice>): uc.Session =>
  uc.setShellStyle(s, { dormers: { ...uc.shellStyle(s).dormers, ...patch } }, catalog);
const cellCount = (s: uc.Session): number => uc.shellOf(s.project, uc.shellStyle(s)).cells.length;

describe('Gauben: Einstellung der Sitzung', () => {
  it('neue Projekte ohne Gauben (Hülle wie bisher); Satteldach-Gauben → Hülle mit Gauben, ein Undo-Schritt, Wiederholen', () => {
    const s0 = sampleSession(catalog);
    expect(uc.shellStyle(s0).dormers).toEqual(uc.PLAIN_DORMERS);
    expect(uc.shellOptions(uc.shellStyle(s0)).dormers).toBeUndefined();
    expect(uc.dormerCount(s0.project, uc.shellStyle(s0))).toBe(0);

    const on = uc.setShellStyle(s0, { dormers: GABLE3 }, catalog);
    expect(on.dormers).toEqual(GABLE3);
    expect(uc.shellOptions(uc.shellStyle(on)).dormers).toEqual({ kind: 'gable', width: 3, minGap: 2 });
    expect(uc.shellKey(uc.shellStyle(on))).not.toBe(uc.shellKey(uc.shellStyle(s0)));
    expect(uc.dormerCount(on.project, uc.shellStyle(on))).toBe(6); // Beispielhaus 23 × 12: je Traufseite 3 (B2 §3)
    expect(cellCount(on)).toBeGreaterThan(cellCount(s0));
    expect(on.past).toHaveLength(s0.past.length + 1);
    expect(on.needsLight).toBe(true); // andere Hülle → Licht-Pass prüft nach

    const back = uc.undo(on);
    expect(uc.shellStyle(back).dormers).toEqual(uc.PLAIN_DORMERS);
    expect(uc.shellKey(uc.shellStyle(back))).toBe(uc.shellKey(uc.shellStyle(s0)));
    expect(uc.redo(back).dormers).toEqual(GABLE3);
  });

  it('Art, Breite, Abstand wirken; Walm, Schlepp, Blind; Abstand groß → weniger Gauben', () => {
    const on = uc.setShellStyle(sampleSession(catalog), { dormers: GABLE3 }, catalog);
    const n = (s: uc.Session): number => uc.dormerCount(s.project, uc.shellStyle(s));
    expect(n(dormers(on, { width: 1 }))).toBe(8);
    for (const kind of ['shed', 'hip', 'blind'] as const) expect(n(dormers(on, { kind })), kind).toBeGreaterThan(0);
    expect(n(dormers(on, { minGap: 8 }))).toBeLessThan(n(on));
    // gleicher Stil → dieselbe Hülle aus dem Zwischenspeicher
    const style = uc.shellStyle(on);
    expect(uc.shellOf(on.project, { ...style, dormers: { ...style.dormers } })).toBe(uc.shellOf(on.project, style));
  });

  it('keine Gaube passt: flache Neigung am 12 tiefen Haus → 0 (Hinweis in der UI); Flachdach → ohne Wirkung, keine Aktion', () => {
    const on = uc.setShellStyle(sampleSession(catalog), { dormers: GABLE3 }, catalog);
    const low = uc.setShellStyle(on, { roofDetail: { ...uc.shellStyle(on).roofDetail, pitch: 'low' } }, catalog);
    expect(uc.dormerCount(low.project, uc.shellStyle(low))).toBe(0);
    // Fenster aus: gezählt wird trotzdem (Gauben bleiben, nur ohne Scheiben)
    const dark = uc.setShellStyle(on, { windows: { ...uc.DEFAULT_WINDOWS, enabled: false } }, catalog);
    expect(uc.dormerCount(dark.project, uc.shellStyle(dark))).toBe(6);

    const flat = uc.setShellStyle(sampleSession(catalog), { roof: 'flat' }, catalog);
    expect(uc.dormerOptions('flat', GABLE3)).toBeUndefined();
    expect(uc.setShellStyle(flat, { dormers: GABLE3 }, catalog)).toBe(flat); // Hülle unverändert → keine Aktion
    // Gauben bleiben beim Wechsel aufs Flachdach gespeichert und kommen mit dem Satteldach zurück
    const flatOn = uc.setShellStyle(on, { roof: 'flat' }, catalog);
    expect(flatOn.dormers).toEqual(GABLE3);
    expect(uc.shellOptions(uc.shellStyle(flatOn)).dormers).toBeUndefined();
    expect(uc.dormerCount(uc.setShellStyle(flatOn, { roof: 'gable' }, catalog).project, uc.shellStyle(on))).toBe(6);
  });

  it('ungültige Gauben werfen einen DomainError mit Begründung', () => {
    const s = sampleSession(catalog);
    const bad = (d: unknown) => () => uc.setShellStyle(s, { dormers: d as uc.DormerChoice }, catalog);
    expect(bad({ ...GABLE3, kind: 'dach' })).toThrow(/Unbekannte Gaubenart/);
    expect(bad({ ...GABLE3, width: 2 })).toThrow(/Gaubenbreite 2/);
    expect(bad({ ...GABLE3, minGap: -1 })).toThrow(/Gaubenabstand -1/);
    expect(bad({ ...GABLE3, minGap: 1.5 })).toThrow(DomainError);
    expect(uc.dormerProblem(GABLE3)).toBeUndefined();
  });

  it('Statuszeile nennt die Änderung', () => {
    const st = { ...uc.shellStyle(sampleSession(catalog)), dormers: GABLE3 };
    expect(uc.styleChangeLabel(uc.shellStyle(sampleSession(catalog)), { dormers: { ...GABLE3, kind: 'shed' } })).toBe('Gauben: Schleppgaube');
    expect(uc.styleChangeLabel(st, { dormers: { ...GABLE3, width: 5 } })).toBe('Gaubenbreite 5');
    expect(uc.styleChangeLabel(st, { dormers: { ...GABLE3, minGap: 4 } })).toBe('Gaubenabstand 4');
    expect(uc.styleChangeLabel(st, { dormers: uc.PLAIN_DORMERS })).toBe('Gauben: aus');
    expect(uc.styleChangeLabel(st, { dormers: { kind: 'hip', width: 1, minGap: 2 } })).toBe('Gauben: Walmgaube, Gaubenbreite 1');
  });
});

describe('Gauben in der Projektdatei', () => {
  it('Round-Trip: Gauben kommen zurück, gleiche Hülle', () => {
    const s = uc.setShellStyle(sampleSession(catalog), { dormers: { kind: 'shed', width: 5, minGap: 3 } }, catalog);
    const text = serializeProject(s);
    expect((JSON.parse(text) as Record<string, unknown>)['dormers']).toEqual({ kind: 'shed', width: 5, minGap: 3 });
    const r = parseProjectFile(text, { catalog });
    if (!r.ok) throw new Error(r.error);
    expect(uc.settingsOf(r.session)).toEqual(uc.settingsOf(s));
    expect(uc.shellOf(r.session.project, uc.shellStyle(r.session)).cells).toEqual(uc.shellOf(s.project, uc.shellStyle(s)).cells);
  });

  it('ältere Datei ohne Feld → keine Gauben; kaputte Felder fallen einzeln zurück', () => {
    const s = uc.setShellStyle(sampleSession(catalog), { dormers: GABLE3 }, catalog);
    const data = JSON.parse(serializeProject(s)) as Record<string, unknown>;
    delete data['dormers'];
    const old = parseProjectFile(JSON.stringify(data), { catalog });
    if (!old.ok) throw new Error(old.error);
    expect(uc.shellStyle(old.session).dormers).toEqual(uc.PLAIN_DORMERS);
    expect(uc.shellOptions(uc.shellStyle(old.session)).dormers).toBeUndefined();
    const odd = parseProjectFile(JSON.stringify({ ...data, dormers: { kind: 'hip', width: 2, minGap: 'weit' } }), { catalog });
    if (!odd.ok) throw new Error(odd.error);
    expect(uc.shellStyle(odd.session).dormers).toEqual({ kind: 'hip', width: 3, minGap: 2 });
    const junk = parseProjectFile(JSON.stringify({ ...data, dormers: { kind: 'zwerchhaus', width: 5, minGap: 4 } }), { catalog });
    if (!junk.ok) throw new Error(junk.error);
    expect(uc.shellStyle(junk.session).dormers).toEqual({ kind: 'none', width: 5, minGap: 4 });
  });
});

describe('Gauben: Vorschau = Export', () => {
  it('Blöcke enthalten die Gauben (Scheiben über der Decke); gleicher Stil → dieselbe Welt; 0 harte Verstöße, 0 dunkle Zellen', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const r = lightSession(uc.setShellStyle(sampleSession(catalog), { dormers: GABLE3 }, catalog), ctx);
    expect(r.session.light?.error).toBeUndefined();
    const s = r.session;
    const style = uc.shellStyle(s);
    const world = worldOf(s.project, ctx, style);
    expect(worldOf(s.project, ctx, { ...style, dormers: { ...style.dormers } })).toBe(world);
    const shell = uc.shellOf(s.project, style);
    const ceiling = Math.max(...shell.cells.filter((c) => c.kind === 'ceiling').map((c) => c.pos[1]));
    const upper = (st: uc.ShellStyle) => uc.shellOf(s.project, st).cells.filter((c) => c.kind === 'window' && c.pos[1] > ceiling);
    const panes = upper(style);
    expect(panes.length).toBeGreaterThan(upper({ ...style, dormers: uc.PLAIN_DORMERS }).length); // Giebel- plus Gaubenfenster
    for (const c of panes) expect(world.materialized.volume.isEmpty(c.pos), `Gaubenscheibe ${c.pos.join(',')} fehlt`).toBe(false);
    const report = exportReport(world);
    expect(report.errors, report.errors.map((v) => v.message).join('\n')).toEqual([]);
    expect(report.darkCells).toBe(0);
    expect(worldOf(s.project, ctx, { ...style, dormers: uc.PLAIN_DORMERS })).not.toBe(world);
  });
});

describe('Fenster aus über WindowStyle.enabled (B2 §4)', () => {
  it('gleiche Hülle wie die alte Kodierung (Randabstand) – alle Dachformen, mit Gauben und Details', () => {
    const s = sampleSession(catalog);
    for (const { id: roof } of uc.ROOF_OPTIONS) {
      const style: uc.ShellStyle = { ...uc.shellStyle(s), roof, dormers: GABLE3, windows: { ...uc.DEFAULT_WINDOWS, enabled: false } };
      const opts = uc.shellOptions(style);
      expect(opts.windows, roof).toEqual({ enabled: false });
      const legacy = shellFor(s.project, { ...opts, windows: { margin: 1_000_000, blankFrom: Number.POSITIVE_INFINITY } });
      const now = shellFor(s.project, opts);
      expect(now.cells, roof).toEqual(legacy.cells);
      expect(now.anchors, roof).toEqual(legacy.anchors);
      expect(now.cells.some((c) => c.kind === 'window'), roof).toBe(false);
    }
  });
});
