/**
 * Design an die Website angeglichen (W1, A7): Schriften als eigene Dateien (kein Google-Fonts-Aufruf, Editor im
 * iframe eigenständig), Farbwelt als CSS-Variablen – und deren Textkontrast mindestens WCAG AA (4,5 : 1).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const CSS = readFileSync(join(SRC, 'styles.css'), 'utf8');
const HTML = readFileSync(join(SRC, '..', 'index.html'), 'utf8');

/** Variablen des ersten `:root`-Blocks. */
function tokens(): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  return Object.fromEntries([...root.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** Relative Leuchtdichte nach WCAG 2.x (nur #rrggbb). */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`keine Hex-Farbe: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe('Schriften', () => {
  it('Inter und JetBrains Mono als eigene Dateien, die es gibt; kein Google Fonts', () => {
    const urls = [...CSS.matchAll(/@font-face\s*\{[^}]*url\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(urls.map((u) => u.split('/').pop())).toEqual(['Inter-500.woff2', 'JetBrainsMono-600.woff2']);
    for (const u of urls) expect(existsSync(join(dirname(join(SRC, 'styles.css')), u)), u).toBe(true);
    expect(CSS + HTML).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(tokens()['font-body']).toMatch(/^'Inter'/);
    expect(tokens()['font-mono']).toMatch(/^'JetBrains Mono'/);
  });
});

describe('Farbwelt der Website', () => {
  const t = tokens();

  it('Nachtblau, Amber/Glut, Creme wie website/css/site.css', () => {
    expect(t['bg']).toBe('#0d1020');
    expect(t['line']).toBe('#2a3160');
    expect(t['text']).toBe('#fff6e8');
    expect(t['muted']).toBe('#b3badf');
    expect(t['accent']).toBe('#ffb547');
    expect(t['accent-2']).toBe('#ff8a3c');
  });

  it('Textkontrast ≥ 4,5 : 1 (WCAG AA) auf allen Flächen, auch Schrift auf Amber und Glut', () => {
    const surfaces = ['bg', 'panel', 'panel-2', 'panel-3', 'viewer-bg'];
    const texts = ['text', 'muted', 'accent', 'warn', 'danger', 'danger-text', 'ok', 'holo'];
    const low: string[] = [];
    for (const s of surfaces) {
      for (const x of texts) {
        const c = contrast(t[x]!, t[s]!);
        if (c < 4.5) low.push(`${x} auf ${s}: ${c.toFixed(2)}`);
      }
    }
    for (const fill of ['accent', 'accent-2']) {
      const c = contrast(t['accent-text']!, t[fill]!);
      if (c < 4.5) low.push(`accent-text auf ${fill}: ${c.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });

  it('W8-H: offene Werkzeug-Leiste (224 px + 6 px) verdeckt weder Etagen-Leiste noch Grundriss (im Browser geprüft)', () => {
    const px = (sel: string): number => {
      const i = CSS.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThanOrEqual(0);
      return Number(/left:\s*(\d+)px/.exec(CSS.slice(i, CSS.indexOf('}', i)))?.[1]);
    };
    const flyout = 224 + 6;
    const bar = px('.workbench:not(.layout-split) .stage.with-flyout .floor-bar');
    const plan = px('.stage.with-flyout .plan-overlay.plan-pane');
    expect(bar).toBeGreaterThan(flyout);
    expect(plan).toBeGreaterThanOrEqual(bar + 54); // Etagen-Leiste ~46 px breit, wie ohne Leiste (10 → 64)
  });
});
