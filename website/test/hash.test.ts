/** Routing der Website: kaputte Prozent-Kodierung im Hash bricht nichts (Review R1-16). */
import { describe, expect, it } from 'vitest';
import { hashWord } from '../js/hash.js';

describe('hashWord', () => {
  it('liest normale Routen und kodierte Zeichen', () => {
    expect(hashWord('#ki')).toBe('ki');
    expect(hashWord('#bau-burg-steinwacht')).toBe('bau-burg-steinwacht');
    expect(hashWord('#%C3%BCber')).toBe('über');
    expect(hashWord('')).toBe('');
  });
  it('kaputte Kodierung → Startseite statt Fehler', () => {
    expect(hashWord('#%E0%A4%A')).toBe('');
    expect(hashWord('#%')).toBe('');
  });
});
