/**
 * Beleg-Bilder zu F1 (`plan/spikes/bilder/*.svg`): Außenansicht der ECHTEN materialisierten Welt (Beispielhaus,
 * Theme `timber`, Satteldach) mit F1-Deko gegen dieselbe Welt mit „Fachwerk-Deko aus“.
 *
 * Aufruf: `npx tsx packages/materialize/test/f1-bilder.ts` (oder aus dem Repo-Wurzelverzeichnis).
 * Reines SVG, keine Abhängigkeiten; die Zelle hinter einer Deko wird als kleiner Kern mitgezeichnet.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, sampleHouse } from '@mcda/pipeline';
import { nodeContext } from '../../pipeline/src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const base = { roof: 'gable' as const, facade: { plinthProfile: true, cornice: true, quoins: true, brackets: 3 } };
const on = generate(sampleHouse('1.21.11', 'timber'), ctx, { ...base, facade: { ...base.facade, decor: { panels: true, gableBraces: 3 } } });
const off = generate(sampleHouse('1.21.11', 'timber'), ctx, { ...base, facade: { ...base.facade, decor: { panels: false, gableBraces: 0 } } });

const C = { deko: '#ea580c', holz: '#6b4423', gefach: '#efe6d8', stein: '#9aa0a6', glas: '#7fb3d5', tuer: '#8d6e63', luft: '#0b0f14', dach: '#4b5563' };
/** Zellen der F1-Deko aus der Hülle (Rolle `beam`, Form Falltür/Treppe) – nicht Sockel, Gesims oder Konsolen. */
const dekoZellen = (w: typeof on): Set<string> =>
  new Set(w.shell.cells.filter((c) => c.kind === 'facade' && c.role === 'beam' && (c.shape === 'trapdoor' || c.shape === 'stairs')).map((c) => c.pos.join(',')));
const dekoOn = dekoZellen(on);
const dekoOff = dekoZellen(off);

const art = (n: string, deco: boolean): keyof typeof C => {
  if (deco) return 'deko';
  if (n.includes('glass') || n.endsWith('_pane')) return 'glas';
  if (n.endsWith('_door')) return 'tuer';
  if (n === 'calcite' || n === 'mushroom_stem' || n === 'white_terracotta') return 'gefach';
  if (n.startsWith('dark_oak')) return 'holz';
  if (n.includes('slate') || n.includes('deepslate') || n.includes('tuff') || n.includes('blackstone')) return 'dach';
  return 'stein';
};

interface Zelle { key: string; art: keyof typeof C }
/** Oberste Zelle einer Spalte innerhalb `ys`; über `ys` liegt der Innenraum bzw. das Dach, das nicht zur Wand gehört. */
function spalte(w: typeof on, x: number, z: number, ys: readonly number[]): Zelle {
  for (const y of [...ys].reverse()) {
    const n = w.materialized.volume.stateAt([x, y, z]).name;
    if (n === 'air') continue;
    const key = [x, y, z].join(',');
    return { key, art: art(n, dekoOn.has(key)) };
  }
  return { key: `luft|${x},${z}`, art: 'luft' };
}

/** Blickrichtung von der Fassade in die Wand: liegt die Deko vor der Wand, zeigt der Kern eine Zelle weiter innen. */
const INNEN: Readonly<Record<string, readonly [number, number]>> = { nord: [0, 1], sued: [0, -1], west: [1, 0], ost: [-1, 0] };

function bild(titel: string, unter: string, cols: ReadonlyArray<readonly [number, number]>, ys: readonly number[], innen: readonly [number, number], datei: string): void {
  const c = 24, pad = 16, kopf = 46, fuss = 28;
  const w = pad * 2 + cols.length * c, h = kopf + ys.length * c + fuss;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];
  out.push(`<rect width="${w}" height="${h}" fill="#0b0f14"/>`);
  out.push(`<text x="${pad}" y="20" fill="#e5e7eb" font-family="monospace" font-size="13">${titel}</text>`);
  out.push(`<text x="${pad}" y="36" fill="#9ca3af" font-family="monospace" font-size="10">${unter}</text>`);
  cols.forEach(([x, z], i) => {
    ys.forEach((y, j) => {
      const a = spalte(on, x, z, [y]);
      const b = spalte(off, x, z, [y]);
      const neu = a.key !== b.key;
      const px = pad + i * c, py = kopf + (ys.length - 1 - j) * c;
      out.push(`<rect x="${px}" y="${py}" width="${c - 2}" height="${c - 2}" fill="${C[a.art]}"${neu ? ' stroke="#fde047" stroke-width="3"' : ''}/>`);
      if (a.art === 'deko') {
        const wand = spalte(on, x + innen[0], z + innen[1], [y]);
        out.push(`<rect x="${px + 6}" y="${py + 6}" width="${c - 14}" height="${c - 14}" fill="${C[wand.art]}"/>`);
      }
    });
  });
  out.push(`<text x="${pad}" y="${h - 10}" fill="#9ca3af" font-family="monospace" font-size="10">orange = F1-Deko (kleiner Kern = Wandzelle dahinter, gelb umrandet = neu)  braun = Fachwerkholz  hell = Gefach  blau = Glas  grau = Stein</text>`);
  out.push('</svg>');
  writeFileSync(datei, out.join('\n'));
}

bild('Nordwand – Traufseite, Blick von außen', 'y = 0 … 4, Spalte z = -1; Falltür-Paneel je Fensterspalte auf y = 2', Array.from({ length: 24 }, (_, x) => [x, -1] as const), [0, 1, 2, 3, 4], INNEN['nord']!, 'plan/spikes/bilder/f1_nordwand.svg');
bild('Westgiebel – Streben als Treppe vor der Wand', 'y = 0 … 6, Spalte x = -1; Streben auf y = 5 im Takt 3', Array.from({ length: 12 }, (_, z) => [-1, z] as const), [0, 1, 2, 3, 4, 5, 6], INNEN['west']!, 'plan/spikes/bilder/f1_westgiebel.svg');
console.log('plan/spikes/bilder/f1_nordwand.svg und f1_westgiebel.svg geschrieben');
