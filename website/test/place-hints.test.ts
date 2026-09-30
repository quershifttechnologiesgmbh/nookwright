/** Einbau-Hinweise der Galerie = Wortlaut des Editors (`placeHint`, packages/app/src/exporting.ts) – Review R2-07. */
import { describe, expect, it } from 'vitest';
import { placeHint as editorHint, templateId as editorTemplateId } from '../../packages/app/src/exporting.js';
import { hintHtml, placeHint, templateId } from '../js/place-hints.js';

describe('Einbau-Hinweise', () => {
  it('gleich dem Editor für alle Formate und beide Zielversionen', () => {
    for (const version of ['1.21.11', '26.3']) {
      for (const f of ['litematic', 'schem', 'nbt'] as const) {
        for (const name of ['burg-steinwacht', 'Große Halle', '']) {
          expect(placeHint(f, name, version)).toBe(editorHint(f, name, version));
        }
      }
    }
    for (const name of ['Burg Steinwacht!', 'ÄÖÜ ß', '__a__']) expect(templateId(name)).toBe(editorTemplateId(name));
  });
  it('.nbt nennt /place template und die 48³-Grenze des Strukturblocks', () => {
    const h = placeHint('nbt', 'burg-steinwacht', '1.21.11');
    expect(h).toContain('/place template minecraft:burg-steinwacht');
    expect(h).toContain('generated/minecraft/structures');
    expect(h).toContain('höchstens 48 × 48 × 48');
    expect(placeHint('nbt', 'x', '26.3')).toContain('generated/minecraft/structure`');
  });
  it('Backticks → <code>, Rest escaped', () => {
    expect(hintHtml('dann `//schem load <Name>` und `//paste`')).toBe('dann <code>//schem load &lt;Name&gt;</code> und <code>//paste</code>');
  });
});
