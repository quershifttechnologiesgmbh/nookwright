/**
 * W11-B (Usability-Audit, plan/spikes/W11B_usability.md): Statuszeile ohne Jargon, Rückgängig nennt die Aktion,
 * Augenhöhe mit Dach, Befehlssuche findet Umgebung und Augenhöhe, Beschriftungen der Werkzeug-Schiene, Raumtyp-Suche
 * leert sich nach der Wahl, Farbwelten mit Umlauten.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_TOOL_OF, commandItems, searchCommands } from '../src/ui/commandSearch.js';
import { CONTROL_HOMES } from '../src/ui/controlHomes.js';
import { lightAddedText, stairsRemovedText, undoText } from '../src/ui/statusText.js';
import { eyeLevelCut } from '../src/ui/viewModel.js';
import { floorLabel } from '../src/usecases.js';

const src = (f: string): string => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

describe('Statuszeile in Nutzersprache', () => {
  it('„Licht +5“ → „5 Lichter ergänzt“', () => {
    expect(lightAddedText(5)).toBe('5 Lichter ergänzt');
    expect(lightAddedText(1)).toBe('1 Licht ergänzt');
    expect(lightAddedText(0)).toBe('');
    expect(src('App.tsx')).not.toMatch(/Licht \+\$\{/);
  });

  it('entfernte Treppen mit Etagen statt interner ID', () => {
    expect(stairsRemovedText([{ floorIndex: 0 }], floorLabel)).toBe('Treppe EG → 1. OG entfernt (passt nicht mehr – Rückgängig holt sie zurück)');
    expect(stairsRemovedText([{ floorIndex: 0 }, { floorIndex: 1 }], floorLabel)).toMatch(/^Treppen EG → 1\. OG, 1\. OG → 2\. OG entfernt/);
    expect(stairsRemovedText([], floorLabel)).toBe('');
    expect(src('App.tsx')).not.toMatch(/gone\.map\(\(l\) => l\.id\)/);
  });

  it('Rückgängig und Wiederholen nennen die Aktion, ohne erklärende Zusätze', () => {
    expect(undoText('Rückgängig', 'Raum gemalt und eingerichtet')).toBe('Rückgängig: Raum gemalt und eingerichtet');
    expect(undoText('Rückgängig', 'Neues Projekt: Taverne / Gasthaus (Rückgängig kehrt zurück)')).toBe('Rückgängig: Neues Projekt: Taverne / Gasthaus');
    expect(undoText('Wiederholt', 'Nutzungszustand: verlassen – wirkt auf Außenwände und Dach (Ansicht „Komplett“)')).toBe('Wiederholt: Nutzungszustand: verlassen');
    expect(undoText('Rückgängig', undefined)).toBe('Rückgängig');
    const app = src('App.tsx');
    expect(app).toMatch(/undoText\('Rückgängig',/);
    expect(app).toMatch(/undoText\('Wiederholt',/);
  });
});

describe('Augenhöhe zeigt das Dach (R6)', () => {
  it('Dach ab / Etagen bis aktive / Schnitt → komplett, alle Etagen, ohne Schnitt; zurück beim Verlassen', () => {
    const cut = { view: 'noRoof' as const, floors: 'upTo' as const, cut: 12 };
    expect(eyeLevelCut(cut)).toEqual({ show: { view: 'full', floors: 'all', cut: undefined }, restore: cut });
    // schon alles sichtbar: nichts zurückzustellen
    expect(eyeLevelCut({ view: 'full', floors: 'all', cut: undefined }).restore).toBeUndefined();
  });

  it('die App nutzt die Regel, und eigene Wahl (Taste 1/2/3, Schnitt, Etagen) hebt das Zurückstellen auf', () => {
    const app = src('App.tsx');
    expect(app).toMatch(/eyeLevelCut\(\{ view, floors: floorView, cut: cutValue \}\)/);
    expect(app).toMatch(/case 'view\.noRoof':\s*return chooseView\('noRoof'\)/);
    expect(app).toMatch(/onWheelCapture=\{[^}]*leaveEyeCut\(\)/);
  });
});

describe('Befehlssuche (Strg+K) findet Umgebung und Augenhöhe', () => {
  const items = commandItems();
  const first = (q: string): string | undefined => searchCommands(items, q)[0]?.id;

  it('Werkzeuge und Schalter der Umgebung', () => {
    expect(first('Mauer')).toBe('site.wall');
    expect(first('Turm')).toBe('site.tower');
    expect(first('Windmühle')).toBe('site.windmill');
    expect(first('Brücke')).toBe('site.ensemble');
    expect(first('Augenhöhe')).toBe('view.eyeLevel');
    expect(searchCommands(items, 'Tor').map((i) => i.id)).toContain('site.gate');
    expect(searchCommands(items, 'Teich').map((i) => i.id)).toContain('site.zone');
    expect(searchCommands(items, 'Terraforming').map((i) => i.id)).toContain('site.sculpt');
  });

  it('jeder Werkzeug-Eintrag der Umgebung hat ein Werkzeug; die App schaltet Modus und Werkzeug', () => {
    const site = Object.entries(CONTROL_HOMES).filter(([, c]) => 'home' in c && c.home === 'Umgebung').map(([id]) => id);
    expect(site.length).toBeGreaterThanOrEqual(10);
    for (const [id, tool] of Object.entries(SITE_TOOL_OF)) {
      expect(site, id).toContain(id);
      expect(src('ui/SiteToolbar.tsx'), tool).toContain(`id: '${tool}'`);
    }
    const app = src('App.tsx');
    expect(app).toMatch(/case 'Umgebung': \{\s*[^}]*setMode\('site'\)[^}]*siteMode\.chooseTool\(t\)/);
    expect(app).toMatch(/'view\.eyeLevel': onEyeLevel/);
  });
});

describe('Werkzeug-Schiene, Raumtyp-Suche, Farbwelten', () => {
  it('Symbole der Schiene haben eine sofort sichtbare Beschriftung (data-tip), auch „Umgebung“', () => {
    const rail = src('ui/Toolbar.tsx');
    expect(rail).toMatch(/aria-label="Umgebung" data-tip="Umgebung: Gelände, Mauern, Türme"/);
    expect(rail).toMatch(/data-tip=\{`\$\{t\.label\} \(\$\{shortcutHint\(t\.command\)\}\)`\}/);
    expect(src('styles.css')).toMatch(/\.rail \.tool\[data-tip\]:hover::after/);
  });

  it('die Raumtyp-Suche leert sich nach der Wahl (sonst blieb die Liste auf „Küche“ gefiltert)', () => {
    expect(src('ui/RoomTypePalette.tsx')).toMatch(/const pick = \(id: string\) => \{[\s\S]*?setQuery\(''\);\s*\};/);
  });

  it('Farbwelten heißen mit Umlauten (nicht „Fruehlingswiese Gruen“)', () => {
    const dir = new URL('../../../catalog/palettes/', import.meta.url);
    const names = readdirSync(dir).filter((f) => f.endsWith('.json5')).map((f) => /name:\s*"([^"]+)"/.exec(readFileSync(new URL(f, dir), 'utf8'))?.[1] ?? f);
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => /ae|oe|ue|Weiss\b/.test(n.replace(/Bauer|Mesa|Blue|Queue/g, '')))).toEqual([]);
    expect(names).toContain('Frühlingswiese Grün');
  });

  it('Assistent und Export sagen „Stil“ und „Farbwelt“ wie der Editor (nicht „Theme“/„Palette“)', () => {
    expect(src('ui/ExportDialog.tsx')).toContain('<dt>Stil</dt>');
    const wiz = src('ui/BuildingTypeWizard.tsx');
    expect(wiz).not.toContain('Ohne Palette (Themefarben)');
    expect(src('ui/Sidebar.tsx')).not.toContain('Ohne Palette (Themefarben)');
  });
});

describe('Hervorheben aus der Befehlssuche', () => {
  it('sichtbarer Text schlägt Tooltip: „Mauer“ trifft den Knopf „Mauer“, nicht „Tor“ (Tooltip „Klick auf eine Mauer …“)', async () => {
    const { flashControl } = await import('../src/ui/flashControl.js');
    const flashed: string[] = [];
    const el = (text: string, title: string) => ({
      tagName: 'BUTTON', textContent: text, parentElement: null,
      getAttribute: (a: string) => (a === 'title' ? title : null),
      matches: () => true, closest: () => null, getClientRects: () => [1],
      scrollIntoView: () => undefined, focus: () => undefined, querySelector: () => null,
      classList: { add: () => flashed.push(text), remove: () => undefined },
    });
    const root = { querySelectorAll: () => [el('Tor O', 'Tor (O) – Klick auf eine Mauer setzt ein Tor'), el('Mauer W', 'Mauer (W) – Mauerzug klicken')] };
    const g = globalThis as { window?: unknown };
    const had = 'window' in g;
    g.window ??= { setTimeout: () => 0 };
    try {
      expect(flashControl(root as unknown as ParentNode, 'Mauer')).toBe(true);
    } finally {
      if (!had) delete g.window;
    }
    expect(flashed).toEqual(['Mauer W']);
  });
});

describe('Export: Einbau-Hinweis bleibt nach dem Herunterladen', () => {
  it('die Statuszeile nennt nach dem Export den Einbau-Weg des Formats', () => {
    expect(src('App.tsx')).toMatch(/const place = placeHint\(format, state\.name, state\.targetVersion\.name\)[^\n]*\n\s*setStatus\(\{ text: `Exportiert: [^`]*– \$\{place\}`/);
  });
});

describe('Rückmeldung, solange die ersten Blöcke fehlen (R6: leeres 3D-Bild ohne Anzeige)', () => {
  it('die Lade-Meldung liegt unter der Knopfleiste und dreht sich; das leere Raster wird zur Rollen-Vorschau', () => {
    const css = src('styles.css');
    expect(css).toMatch(/\.viewer-overlay \{\s*position: absolute;\s*top: 56px;/);
    expect(css).toMatch(/\.viewer-overlay\[data-busy\]:not\(\[data-busy="false"\]\)::before/);
    expect(src('viewer/Viewer3D.tsx')).toContain(`data-busy={overlay.endsWith('…')}`);
    // W14: „noch in Arbeit“ kommt je nach Weg vom Blöcke-Worker oder von `useWorld` (`blocksBusy`)
    expect(src('App.tsx')).toMatch(/const blocksBusy = blocksInWorker \? preview\.busy : world\.busy;/);
    expect(src('App.tsx')).toMatch(/source === 'blocks' && !\(blockVoxels\.length === 0 && blocksBusy\) \? blockVoxels : roleVoxels/);
  });
});
