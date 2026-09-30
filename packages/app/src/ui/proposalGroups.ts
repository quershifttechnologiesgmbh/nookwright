/**
 * Assistent ohne Doppel (W1, Abnahme A8; Befund HANDOFF §6.3): Bei festen Vorlagen und manchen Bautypen ergeben
 * verschiedene Seeds **denselben Grundriss** – drei gleiche Karten sehen aus wie ein Fehler. Gleiche Vorschläge werden
 * über einen Fingerabdruck des Plans zusammengefasst und ehrlich benannt. Rein und testbar; Darstellung in
 * `BuildingTypeWizard.tsx`.
 *
 * Der Fingerabdruck deckt ab, was die Karte zeigt und was beim Übernehmen gebaut wird: Baukörper, Etagen, Räume
 * (Zellen und Raumtyp), Treppen, Hülle, Außen-Deko, Gelände-Vorlage, Bauwerke. Nicht darin: Seed, Unter-Seed, Name,
 * Bewertung und Hinweise – sie unterscheiden gleiche Grundrisse nicht.
 */
import type { BuildingPlan } from '@mcda/archetype';

/** Felder des Plans, die gleiche Grundrisse nicht unterscheiden. */
const VOLATILE: ReadonlySet<string> = new Set(['seed', 'attempt', 'name', 'quality', 'warnings', 'hints']);

/** Kanonische Form: Schlüssel sortiert, Zellmengen als sortierte Liste, `undefined` entfällt. */
function canon(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canon);
  const cells = v as { toArray?: () => unknown[] };
  if (typeof cells.toArray === 'function') return cells.toArray().map((c) => JSON.stringify(c)).sort();
  if (v instanceof Map) return [...v.entries()].map(([k, x]) => [String(k), canon(x)]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  if (v instanceof Set) return [...v].map((x) => JSON.stringify(canon(x))).sort();
  const o = v as Record<string, unknown>;
  return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, canon(o[k])]));
}

/** Fingerabdruck eines Plans: gleich ⇔ gleicher Grundriss samt Hülle und Umgebung (unabhängig vom Seed). */
export function planFingerprint(plan: BuildingPlan): string {
  const rest = Object.fromEntries(Object.entries(plan).filter(([k]) => !VOLATILE.has(k)));
  return JSON.stringify(canon(rest));
}

/** Eine Karte im Assistenten: der erste Vorschlag einer Gruppe gleicher Pläne und alle Seeds der Gruppe. */
export interface ProposalGroup {
  /** Index des angezeigten Vorschlags (erster der Gruppe) in der Liste des Assistenten. */
  readonly index: number;
  readonly seeds: readonly number[];
}

/**
 * Vorschläge zusammenfassen: gleiche Pläne (Fingerabdruck) bilden eine Karte, Reihenfolge wie berechnet. Noch nicht
 * berechnete oder fehlgeschlagene Vorschläge bleiben einzeln (sie verschwinden, sobald sie sich als Doppel zeigen).
 */
export function proposalGroups(slots: ReadonlyArray<{ readonly seed: number; readonly proposal?: { readonly plan: BuildingPlan } | undefined }>): ProposalGroup[] {
  const groups: Array<{ index: number; seeds: number[]; fp?: string }> = [];
  slots.forEach((s, index) => {
    const fp = s.proposal === undefined ? undefined : planFingerprint(s.proposal.plan);
    const same = fp === undefined ? undefined : groups.find((g) => g.fp === fp);
    if (same !== undefined) same.seeds.push(s.seed);
    else groups.push({ index, seeds: [s.seed], ...(fp !== undefined ? { fp } : {}) });
  });
  return groups.map(({ index, seeds }) => ({ index, seeds }));
}

/** Kopf der Vorschläge: Anzahl, Hinweis auf Doppel und Beschriftung des Würfel-Knopfs (`undefined` = ausblenden). */
export interface ProposalSummary {
  readonly heading: string;
  readonly note?: string;
  readonly reroll?: { readonly label: string; readonly title: string };
}

/**
 * Ehrliche Beschriftung (A8): feste Vorlage → „Feste Vorlage – eine Variante“, kein Würfeln; alle Vorschläge gleich →
 * „Nur eine Variante …“ und „↻ Neu würfeln“ statt „↻ 3 neue“; einzelne Doppel → „2 gleiche zusammengefasst“.
 * `done`: alle Vorschläge der Runde sind berechnet (vorher keine Aussage über Doppel).
 */
export function proposalSummary(fixed: boolean, groups: readonly ProposalGroup[], total: number, done: boolean): ProposalSummary {
  if (fixed) return { heading: 'Vorschlag', note: 'Feste Vorlage – eine Variante: dieser Bautyp hat einen festen Grundriss. Für Varianten einen Bautyp ohne „Vorlage“ wählen.' };
  const dupes = total - groups.length;
  const fresh = { label: `↻ ${total} neue`, title: `${total} neue Seeds würfeln` };
  if (!done || dupes === 0) return { heading: groups.length === 1 ? 'Vorschlag' : 'Vorschläge', reroll: fresh };
  if (groups.length === 1) {
    return {
      heading: 'Vorschlag',
      note: `Nur eine Variante: alle ${total} Seeds ergeben bei diesen Einstellungen denselben Grundriss.`,
      reroll: { label: '↻ Neu würfeln', title: 'Neue Seeds würfeln – bei diesen Einstellungen kamen bisher nur gleiche Grundrisse heraus; Größe oder Etagen ändern ergibt eher Varianten' },
    };
  }
  return { heading: 'Vorschläge', note: `${dupes + 1} gleiche Vorschläge zusammengefasst.`, reroll: fresh };
}

/**
 * W11-B: Fuß des Assistenten nennt den gewählten Vorschlag („Vorschlag 2: 24 × 20 · 3 Etagen + Keller · 15 Räume“).
 * Bei 1280 × 720 liegen die Karten unter dem Falz – ohne diese Zeile übernahm „Übernehmen“ einen ungesehenen Vorschlag.
 * `position`: Stelle der Karte (0 = erste); negativ = unbekannt.
 */
export function proposalFootLabel(
  position: number,
  facts: { readonly width: number; readonly depth: number; readonly floors: number; readonly cellar: boolean; readonly rooms: number },
): string {
  const name = position >= 0 ? `Vorschlag ${position + 1}` : 'Gewählter Vorschlag';
  const floors = `${facts.floors} ${facts.floors === 1 ? 'Etage' : 'Etagen'}${facts.cellar ? ' + Keller' : ''}`;
  return `${name}: ${facts.width} × ${facts.depth} · ${floors} · ${facts.rooms} ${facts.rooms === 1 ? 'Raum' : 'Räume'}`;
}
