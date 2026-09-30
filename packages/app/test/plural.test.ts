/** Zahlwörter in Beschriftungen (Nutzerreview: „1 Türen“). */
import { describe, expect, it } from 'vitest';
import { plural } from '../src/ui/plural.js';

describe('plural', () => {
  it('setzt den richtigen Numerus', () => {
    expect(plural(0, 'Tür', 'Türen')).toBe('0 Türen');
    expect(plural(1, 'Tür', 'Türen')).toBe('1 Tür');
    expect(plural(2, 'Tür', 'Türen')).toBe('2 Türen');
    expect(plural(1, 'Fenster', 'Fenster')).toBe('1 Fenster');
    expect(plural(3, 'Fenster', 'Fenster')).toBe('3 Fenster');
    expect(plural(-1, 'Tür', 'Türen')).toBe('-1 Türen');
  });
});
