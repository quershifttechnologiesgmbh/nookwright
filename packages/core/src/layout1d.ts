/**
 * 1D-Verteilung (research/30 K4, Vorbild `Resample Curve` + `Miter`): **eine** reine Funktion für „verteile
 * Dinge gleichmäßig auf eine Länge“, statt fünfmal eigener Sonderfälle.
 *
 * Zwei Modi, beide geschlossene Formeln und damit **bitgleich** zu den bisherigen Aufrufern:
 *  - `ends: 'both'`  – beide Enden belegt, Abstand ≤ `step` (Vorbild: `spread` für Konsolen unter einer Auskragung)
 *  - `ends: 'open'`  – nur Innenstellen, dichter Rhythmus auf der Innenlänge (Vorbild: `rhythm` für Balken)
 *
 * Dazu (W2) das Fassadenraster `bays` (Pfosten und Felder, kein Feld schmaler als die Feldbreite) mit `bayAxis`
 * (Fensterachse je Feld) und die spiegelsymmetrische Feldteilung `symmetricWidths`.
 *
 * **Nicht** hier drin: die Suche nach der kleinsten passenden Anzahl mit Kandidatenmaske (`pilasterSlots`) und
 * die Periodensuche mit halben Positionen (`beamPositions`) – beide sind keine geschlossenen Formeln, behalten
 * ihren eigenen Kern und werden nur über `distributeSymmetric` (Kandidatenwahl) bzw. unverändert genutzt.
 * Alles ganzzahlig, deterministisch, ohne Rauschen.
 */

/** Enden der Verteilung: beide belegt oder nur innen. */
export type DistributeEnds = 'both' | 'open';

export interface DistributeOptions {
  /** Höchstabstand zwischen zwei Stellen (≥ 1). */
  readonly step: number;
  readonly ends?: DistributeEnds;
}

/**
 * Stellen auf `len` Zellen (0…len−1).
 * - `both`: `count = ceil((len−1)/step) + 1`, Stellen `round(j·(len−1)/(count−1))` – Abstand ≤ `step`,
 *   beide Enden belegt (bei `len ≤ 1` genau `[0]` bzw. `[]`, vor der `step`-Prüfung).
 * - `open`: nur innen; `m = len−2`, `count = floor((m−1)/step) + 1`, Start mittig – Abstand exakt `step`,
 *   die Reste liegen an den Enden.
 */
export function distribute(len: number, o: DistributeOptions): number[] {
  const ends: DistributeEnds = o.ends ?? 'both';
  if (ends === 'both') {
    if (len <= 1) return len === 1 ? [0] : [];
    if (o.step < 1) return [];
    const count = Math.ceil((len - 1) / o.step) + 1;
    return Array.from({ length: count }, (_, j) => Math.round((j * (len - 1)) / (count - 1)));
  }
  if (len < 3 || o.step < 1) return [];
  const m = len - 2;
  const count = Math.floor((m - 1) / o.step) + 1;
  const start = 1 + Math.floor((m - 1 - (count - 1) * o.step) / 2);
  return Array.from({ length: count }, (_, i) => start + i * o.step);
}

/**
 * n Breiten ≥ 1 mit Summe `total`, spiegelsymmetrisch, den Rest von der Mitte aus verteilt; `undefined`, wenn es nicht
 * spiegelgleich aufgeht (gerades n, ungerader Rest). Kern aus `materialize/timber.ts` (`symmetricWidths`), hier rein.
 */
export function symmetricWidths(total: number, n: number): number[] | undefined {
  if (n < 1 || total < n) return undefined;
  const base = Math.floor(total / n);
  let rem = total - base * n;
  if (n % 2 === 0 && rem % 2 === 1) return undefined;
  const w = new Array<number>(n).fill(base);
  const odd = n % 2 === 1;
  if (odd && rem % 2 === 1) {
    w[(n - 1) / 2]!++;
    rem--;
  }
  for (let d = odd ? 1 : 0; rem > 0; d++, rem -= 2) {
    const i = odd ? (n - 1) / 2 - d : n / 2 - 1 - d;
    w[i]!++;
    w[n - 1 - i]!++;
  }
  return w;
}

/** Fassadenraster (`bays`): Pfostenspalten und Felder einer Linie mit `len` Spalten. */
export interface Bays {
  /** Pfostenspalten 0…len−1 aufsteigend, die Ecken 0 und len−1 eingeschlossen. */
  readonly posts: readonly number[];
  /** Felder zwischen zwei Pfosten als [erste, letzte Spalte], aufsteigend. */
  readonly fields: readonly (readonly [number, number])[];
}

/**
 * Fassadenraster (W2, Baustandard F1/W2, X2 §6.2): die Ecken 0 und len−1 sind Pfosten, die Innenlänge wird in
 * n = ⌊(len−1)/(field+1)⌋ Felder mit je einem Pfosten dazwischen geteilt. Abgerundet statt gerundet: **kein Feld ist
 * schmaler als `field`** (sonst entstehen Randfelder mit 2 Spalten). Der Rest wird spiegelsymmetrisch von der Mitte
 * aus verteilt; geht das nicht auf (gerade Feldzahl, ungerader Rest – bei gerader Länge liegt die Mitte zwischen zwei
 * Spalten), gibt es ein Feld weniger. Zu kurze Linien sind ein Feld (len ≥ 3) bzw. nur Ecken.
 * Rein, ganzzahlig, deterministisch; spiegelsymmetrisch: Pfosten p ⇔ len−1−p.
 */
export function bays(len: number, field: number): Bays {
  if (len < 3) return { posts: len <= 0 ? [] : len === 1 ? [0] : [0, 1], fields: [] };
  const f = Math.max(1, Math.floor(field));
  let n = Math.max(1, Math.floor((len - 1) / (f + 1)));
  let widths = symmetricWidths(len - 1 - n, n);
  while (widths === undefined && n > 1) widths = symmetricWidths(len - 1 - --n, n);
  const ws = widths ?? [len - 2];
  const posts = [0];
  const fields: Array<readonly [number, number]> = [];
  let at = 1;
  ws.forEach((w, i) => {
    fields.push([at, at + w - 1]);
    at += w;
    if (i < ws.length - 1) posts.push(at++);
  });
  posts.push(len - 1);
  return { posts, fields };
}

/**
 * Achse eines Felds [from, to] auf einer Linie mit der Mitte `(first + last) / 2`: ungerade Breite → die Mittelspalte;
 * gerade Breite → die Spalte zur Linienmitte hin (spiegelgleich), beim Feld genau in der Linienmitte beide
 * Mittelspalten (Doppelfenster – die einzige spiegelgleiche Belegung). `first`/`last` in denselben Koordinaten.
 */
export function bayAxis(from: number, to: number, first: number, last: number): number[] {
  if ((from + to) % 2 === 0) return [(from + to) / 2];
  const lo = (from + to - 1) / 2;
  const c2 = first + last;
  if (from + to === c2) return [lo, lo + 1];
  return [from + to < c2 ? lo + 1 : lo];
}

/**
 * `k` Stellen möglichst nahe an den Idealpunkten `j·(len−1)/(k+1)` (research/30 K4, aus `pilasterSlots`
 * herausgezogen – Vergleichsreihenfolge unverändert: Abstand, dann `post`, dann Mitte, dann Index).
 * Kandidaten, die schon belegt sind, fallen heraus; ist keiner mehr frei, bleiben die übrigen Idealpunkte leer.
 */
export function distributeSymmetric(len: number, k: number, cands: readonly number[], post: (i: number) => boolean = () => false): number[] {
  const slots: number[] = [];
  for (let j = 1; j <= k; j++) {
    // Abstand zum Idealpunkt j·(L−1)/(k+1), ganzzahlig skaliert (exakte Gleichstände)
    const dist = (i: number): number => Math.abs(i * (k + 1) - j * (len - 1));
    const pick = cands
      .filter((i) => !slots.includes(i))
      .sort((a, b) => dist(a) - dist(b) || Number(post(b)) - Number(post(a)) || Math.abs(2 * a - len + 1) - Math.abs(2 * b - len + 1) || a - b)[0];
    if (pick !== undefined) slots.push(pick);
  }
  return slots.sort((a, b) => a - b);
}
