import { describe, expect, it } from 'vitest';
import { expectCpuBelow, expectCpuMsBelow, medianCpuMs, threadCpuMs, timeCpu } from './support/timing.js';

/** Rechnet, bis der Thread `ms` CPU-Zeit verbraucht hat (unabhängig von Fremdlast). */
function burn(ms: number): number {
  const end = threadCpuMs() + ms;
  let x = 0;
  while (threadCpuMs() < end) x++;
  return x;
}

describe('Test-Helfer Laufzeit (CPU-Zeit des Threads)', () => {
  it('Warten zählt nicht, Rechnen schon', () => {
    const idle = timeCpu(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100));
    expect(idle.result).toBe('timed-out');
    expect(idle.ms).toBeLessThan(50);
    expect(timeCpu(() => burn(30)).ms).toBeGreaterThanOrEqual(30);
  });

  it('Median nach Aufwärmlauf', () => {
    const runs: number[] = [];
    medianCpuMs((i) => runs.push(i), 3, 2);
    expect(runs).toEqual([-1, -2, 0, 1, 2]);
  });

  it('Überschreitung: Nachmessen, Minimum zählt; dauerhaft zu langsam bleibt rot', () => {
    const seq = [1e9, 1e8, 5];
    expect(expectCpuMsBelow(() => seq.shift()!, 100, 'Folge')).toBe(1e9);
    expect(seq).toEqual([]);
    expect(() => expectCpuMsBelow(() => 1e9, 100, 'dauerhaft')).toThrow(/dauerhaft: CPU 1000000000 ms/);
    expect(expectCpuBelow(() => 7, 1_000, 'schnell').result).toBe(7);
  });
});
