import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

it('Q1a: jeder Raumtyp bietet mindestens 25 Komponenten aus required/optional an', () => {
  const ids = ctx.catalog.roomTypeIds();
  expect(ids.length).toBeGreaterThanOrEqual(45);
  for (const id of ids) {
    const rt = ctx.catalog.roomType(id);
    const tags = [...rt.required, ...rt.optional].flatMap((entry) => entry.tags);
    const available = ctx.catalog.byTags(tags);
    expect(available.length, `${id}: ${available.map((def) => def.id).join(', ')}`).toBeGreaterThanOrEqual(25);
  }
});
