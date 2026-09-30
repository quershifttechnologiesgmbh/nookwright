/**
 * ADR 12 – Abdeckungszwang: Jede Fähigkeit des Anwendungsdienstes ist über die Engine-API erreichbar oder bewusst
 * eingeordnet. Schlägt dieser Test fehl, hat jemand der Pipeline einen Export gegeben, ohne ihn in
 * `src/registry.ts` (PIPELINE_SURFACE) einzutragen – in aller Regel gehört dazu eine Operation.
 */
import { describe, expect, it } from 'vitest';
import * as pipeline from '@mcda/pipeline';
import { OPERATIONS, OPERATION_ID, PIPELINE_SURFACE } from '../src/index.js';
import { engine } from './fixture.js';

describe('Engine-API deckt den Anwendungsdienst ab', () => {
  it('jeder Laufzeit-Export von @mcda/pipeline ist eingeordnet (op / internal / planned)', () => {
    const exported = Object.keys(pipeline).sort();
    const classified = Object.keys(PIPELINE_SURFACE).sort();
    expect(exported.filter((k) => !classified.includes(k)), 'neu in @mcda/pipeline, fehlt in PIPELINE_SURFACE').toEqual([]);
    expect(classified.filter((k) => !exported.includes(k)), 'in PIPELINE_SURFACE, aber nicht mehr exportiert').toEqual([]);
  });

  it('Verweise zeigen auf echte Operationen; „geplant“ nur, solange es die Operation noch nicht gibt', () => {
    const ids = OPERATIONS.map((o) => o.id);
    for (const [name, e] of Object.entries(PIPELINE_SURFACE)) {
      if ('op' in e) expect(ids, `${name} → ${e.op}`).toContain(e.op);
      if ('planned' in e) expect(ids, `${name}: ${e.planned} existiert – auf { op } umstellen`).not.toContain(e.planned);
      if ('internal' in e) expect(e.internal.length, `${name}: Begründung fehlt`).toBeGreaterThan(5);
    }
  });

  it('Operationen: eindeutige IDs im Tool-Namensformat, Beschreibung vorhanden', () => {
    const ids = OPERATIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of OPERATIONS) {
      expect(o.id).toMatch(OPERATION_ID);
      expect(o.summary.length, o.id).toBeGreaterThan(20);
    }
  });

  it('jedes Eingabefeld ist beschrieben – rekursiv, auch in Befehlen (das Modell sieht nur Schema + Beschreibung)', () => {
    type Node = { properties?: Record<string, Node>; items?: Node | Node[]; prefixItems?: Node[]; anyOf?: Node[]; oneOf?: Node[]; description?: string };
    const missing: string[] = [];
    const walk = (n: Node | undefined, path: string): void => {
      if (n === undefined) return;
      for (const [k, p] of Object.entries(n.properties ?? {})) {
        if (!p.description && k !== 'command') missing.push(`${path}.${k}`);
        walk(p, `${path}.${k}`);
      }
      for (const x of [...(Array.isArray(n.items) ? n.items : n.items !== undefined ? [n.items] : []), ...(n.prefixItems ?? [])]) walk(x, `${path}[]`);
      for (const x of [...(n.anyOf ?? []), ...(n.oneOf ?? [])]) walk(x, path);
    };
    for (const op of engine.operations) walk(engine.inputSchema(op) as Node, op);
    expect(missing).toEqual([]);
  });
});
