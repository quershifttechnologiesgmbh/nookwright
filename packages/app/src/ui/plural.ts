/**
 * Zahlwort für Beschriftungen (Nutzerreview: „1 Türen“ statt „1 Tür“). Rein und testbar.
 * `plural(1, 'Tür', 'Türen')` → `'1 Tür'`, `plural(3, 'Tür', 'Türen')` → `'3 Türen'`.
 */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
