/**
 * W8-D: `ENGINE_NL_LOG` gilt in Server und Skripten gleich (`promptLogTarget`): „off“ schaltet das Log ab, statt eine
 * Datei namens „off“ anzulegen (vorher in `scripts/prompt.ts`); leer oder fehlend = Standard.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { promptLogTarget } from '../src/node/index.js';

describe('W8-D: ENGINE_NL_LOG', () => {
  it('off/OFF/„ off “ → kein Log; leer/fehlend → Standard; sonst der Pfad; Standard „off“ bleibt aus', () => {
    for (const v of ['off', 'OFF', ' off ']) expect(promptLogTarget(v, 'out/prompts.jsonl'), v).toBeUndefined();
    for (const v of [undefined, '', '  ']) expect(promptLogTarget(v, 'out/prompts.jsonl'), String(v)).toBe('out/prompts.jsonl');
    expect(promptLogTarget('/tmp/x.jsonl', 'out/prompts.jsonl')).toBe('/tmp/x.jsonl');
    expect(promptLogTarget(undefined, 'off')).toBeUndefined();
    expect(promptLogTarget('/tmp/x.jsonl', 'off')).toBe('/tmp/x.jsonl');
  });

  it('Server und Skripte lesen ENGINE_NL_LOG nur über promptLogTarget (kein Pfad „off“)', () => {
    for (const f of ['../scripts/prompt.ts', '../scripts/dataset.ts', '../src/node/launch.ts']) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
      expect(src, f).toMatch(/promptLogTarget\(process\.env\['ENGINE_NL_LOG'\]|promptLogTarget\(env\['ENGINE_NL_LOG'\]/);
      expect(src.match(/\['ENGINE_NL_LOG'\]/g)?.length, f).toBe(1);
    }
  });
});
