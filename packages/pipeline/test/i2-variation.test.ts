/**
 * Q1b-Abnahme, Kennzahl **I2** (research/58 §4, research/57 §4): Wie stark unterscheiden sich zwei **gleich große**
 * Räume desselben Raumtyps mit **verschiedenen Seeds**?
 *
 * Berichtet werden **zwei** Werte, weil die Auftragslage das verlangt (research/63):
 *  1. `gesamt` – alle platzierten Komponenten. Das ist eine **Diagnose**: Pflicht- und Signaturmöbel sind bewusst
 *     gleich (jeder Raumtyp braucht seinen Herd sein Regal), sie drücken den Wert also künstlich nach unten.
 *  2. `optional` – nur die Möbel, die **nicht** über einen Pflicht-Eintrag des Raumtyps hereinkommen. Das ist die
 *     eigentliche Variationsaussage.
 *
 * Geprüft wird die Schwelle „< 60 % Überschneidung" nur für `optional` und nur, wenn beide Räume **mindestens
 * `MIN_STICHPROBE`** optionale Komponenten haben (`Jaccard`-Überschneidung). Kleine Stichproben (2–3 Objekte)
 * schwanken zu stark, um daraus eine Aussage zu machen; sie werden als Diagnose mitgeführt, nicht als Abnahme.
 * Der Zielwert ist ein **gestalterisches Ziel**, kein Minecraft-Gesetz.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { generate } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const MIN_STICHPROBE = 5;
/** Abnahmeziel für optionale Möbel (research/58 §4: I2 < 60 % Überschneidung). */
const ZIEL = 0.6;

interface Ergebnis {
  readonly type: string;
  readonly size: string;
  readonly seeds: readonly [number, number];
  readonly gesamt: number;
  readonly optional: number;
  readonly n: readonly [number, number];
  /** Dieselbe Überschneidung, aber je Komponente **und Variante** – zwei Bücherschrank-Varianten sind für den
   * Spieler zwei verschiedene Möbel, für die ID-Zählung aber eines. */
  readonly optionalVariante: number;
  readonly warnungen: readonly string[];
}

function singleRoom(type: string, w: number, d: number, seed: number): Project {
  const p = Project.create({ id: 'i2', name: 'I2', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  return p;
}

/** Komponenten eines Raums, getrennt nach Pflicht (über `required` erreichbar) und optional. */
function teile(type: string, w: number, d: number, seed: number): Ergebnis & { readonly pflicht: Set<string>; readonly opt: Set<string>; readonly optVar: Set<string> } {
  const p = singleRoom(type, w, d, seed);
  const world = generate(p, ctx);
  const rt = ctx.catalog.roomType(type);
  const pflichtTags = new Set(rt.required.flatMap((e) => [...e.tags]));
  const pflicht = new Set<string>();
  const opt = new Set<string>();
  const optVar = new Set<string>();
  for (const pl of p.state.placements) {
    const tags = ctx.catalog.get(pl.componentId).tags;
    if (tags.some((t) => pflichtTags.has(t))) pflicht.add(pl.componentId);
    else {
      opt.add(pl.componentId);
      optVar.add(`${pl.componentId}#${pl.variantId ?? '-'}`);
    }
  }
  return {
    type,
    size: `${w}×${d}`,
    seeds: [seed, seed],
    gesamt: 0,
    optional: 0,
    n: [pflicht.size, opt.size],
    optionalVariante: 0,
    warnungen: world.warnings,
    pflicht,
    opt,
    optVar,
  };
}

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  const schnitt = [...a].filter((x) => b.has(x)).length;
  const vereinigung = new Set([...a, ...b]).size;
  return vereinigung === 0 ? 0 : schnitt / vereinigung;
};

/** Zwei Seeds vergleichen; liefert die Kennzahlen samt Stichprobengrößen. */
function vergleiche(type: string, w: number, d: number, s1: number, s2: number): Ergebnis {
  const a = teile(type, w, d, s1);
  const b = teile(type, w, d, s2);
  return {
    type,
    size: `${w}×${d}`,
    seeds: [s1, s2],
    gesamt: jaccard(a.pflicht, b.pflicht),
    optional: jaccard(a.opt, b.opt),
    optionalVariante: jaccard(a.optVar, b.optVar),
    n: [a.opt.size, b.opt.size],
    warnungen: [...a.warnungen, ...b.warnungen],
  };
}

const TYPEN = ['kitchen', 'library', 'smithy', 'storage'] as const;
const GROESSEN: readonly (readonly [number, number])[] = [[9, 8], [16, 12]];

describe('Q1b: I2 – Variation zwischen zwei Seeds', () => {
  it('erzeugt die Räume ohne Warnungen (sonst ist die Messung wertlos)', () => {
    const warnungen: string[] = [];
    for (const type of TYPEN) for (const [w, d] of GROESSEN) for (const seed of [1, 2]) warnungen.push(...teile(type, w, d, seed).warnungen.map((x) => `${type} ${w}×${d} seed ${seed}: ${x}`));
    expect(warnungen).toEqual([]);
  });

  it(`optionale Möbel unterscheiden sich bei ausreichender Stichprobe sichtbar (Ziel < ${ZIEL * 100} % je Variante)`, () => {
    const zeilen: string[] = [];
    const zuAehnlich: string[] = [];
    for (const type of TYPEN) {
      for (const [w, d] of GROESSEN) {
        const r = vergleiche(type, w, d, 1, 2);
        const gross = Math.min(...r.n) >= MIN_STICHPROBE;
        zeilen.push(`${r.type.padEnd(8)} ${r.size.padEnd(7)} seeds ${r.seeds.join('/')}: gesamt ${(r.gesamt * 100).toFixed(0)} % · optional ${(r.optional * 100).toFixed(0)} % · optional je Variante ${(r.optionalVariante * 100).toFixed(0)} % (n = ${r.n.join('/')}${gross ? '' : ', zu klein für die Abnahme'})`);
        if (gross && r.optionalVariante >= ZIEL) zuAehnlich.push(zeilen[zeilen.length - 1]!);
      }
    }
    const bericht = `I2 (Überschneidung zweier Seeds):\n${zeilen.join('\n')}`;
    expect(zuAehnlich, `zu ähnlich (Ziel < ${ZIEL * 100} %):\n${zuAehnlich.join('\n')}\n\n${bericht}`).toEqual([]);
  });

  /**
   * Vor der Ecken-Priorisierung lag die ID-genaue Überschneidung bei 63 %. Im gemeinsamen
   * Q1b-Stand sind es 52 % (20/18 optionale IDs). Das ursprüngliche Ziel bleibt unverändert;
   * der Test schützt jetzt die erreichte Verbesserung statt die frühere Lücke festzuschreiben.
   * FN-Integration (2026-09-29): Die Ecknischen der Bibliothek (`fn_corner`, Zahl [1, 2]) setzten in beiden Seeds dieselben
   * IDs (Ecknische + Schmiede-Ecke) → 74 % (17/16). Mit Zahl [0, 2] und drei Ecken-Bausteinen im Pool sind es 42 %
   * (10 gemeinsame von 24 IDs, Seeds 1/2).
   */
  it('große Bibliothek erfüllt das Variationsziel auch für Komponenten-IDs', () => {
    const r = vergleiche('library', 16, 12, 1, 2);
    expect(Math.min(...r.n)).toBeGreaterThanOrEqual(MIN_STICHPROBE);
    expect(r.optional, `library 16×12: ID-genau ${(r.optional * 100).toFixed(0)} % (${r.n.join('/')} optionale Möbel)`).toBeLessThan(ZIEL);
  });

  it('der Gesamtwert bleibt eine Diagnose – er wird berichtet, nicht abgenommen', () => {
    // Bewusst keine Schwelle: Pflicht- und Signaturmöbel sind in beiden Räumen gleich. Der Test hält die Zahl nur
    // fest (und schlägt fehl, wenn die Messung selbst kaputt ist: kein Raum ohne Möbel).
    for (const type of TYPEN) {
      for (const [w, d] of GROESSEN) {
        const r = vergleiche(type, w, d, 1, 2);
        expect(r.n[0] + r.n[1], `${type} ${w}×${d}: gar keine optionalen Möbel gemessen`).toBeGreaterThan(0);
      }
    }
  });
});
