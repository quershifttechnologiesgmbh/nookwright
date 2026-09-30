/**
 * Anzeige des Qualitätswerts je Raum (rein, testbar): Prozent, Stufe, schwächster Teilwert als Kurzbegründung
 * („warum so?“) und die Teilwerte sortiert – schwächste zuerst. Grundlage ist `RoomQuality` aus dem Solver v2
 * (Q = 0,65 · Mittel + 0,35 · Minimum der Teilwerte). Die Notizen des Solvers (`RoomQuality.notes`) werden in
 * verständliche Sätze übersetzt (`explainNote`); was der Nutzer ändern kann (Theme, Wandhöhe), steht sichtbar oben.
 */
import type { QualityPart, RoomQuality } from '@mcda/furnishing';

export type QualityTone = 'good' | 'ok' | 'weak';

export interface QualityLine {
  readonly id: QualityPart['id'];
  readonly label: string;
  readonly percent: number;
  readonly detail?: string | undefined;
}

export interface QualitySummary {
  readonly percent: number;
  /** „sehr gut“, „gut“, „mittel“, „schwach“ */
  readonly grade: string;
  readonly tone: QualityTone;
  /** Ein Satz: was den Wert drückt (oder dass alles passt). */
  readonly why: string;
  /** Teilwerte, schwächste zuerst. */
  readonly lines: readonly QualityLine[];
  /** Wichtige Hinweise, sichtbar ohne Aufklappen: Raumtyp passt nicht zum Theme, Raum zu niedrig. */
  readonly alerts: readonly string[];
  /** Was der Solver abgewogen oder repariert hat (Layout gelockert, Backtracking …) und Vermerke der App. */
  readonly notes: readonly string[];
}

export interface QualityNote {
  readonly kind: 'style' | 'height' | 'layout' | 'repair' | 'other';
  readonly text: string;
}

/** Hinweise, die der Nutzer beheben kann (sichtbar oben im Kasten). */
const ALERT_KINDS: ReadonlySet<QualityNote['kind']> = new Set(['style', 'height']);

const NOTE_RULES: ReadonlyArray<{ readonly re: RegExp; readonly kind: QualityNote['kind']; readonly text: (m: RegExpMatchArray) => string }> = [
  {
    re: /^Raumtyp „(.+)“ passt nicht zum Stil (.+) \(styleTags\)$/,
    kind: 'style',
    text: (m) => `„${m[1]}“ passt nicht zum Stil des Themes (${m[2]!.split('/').join(' → ')}). Eingerichtet ist trotzdem; passender wäre ein anderes Theme oder ein anderer Raumtyp.`,
  },
  {
    re: /^lichte Höhe (\d+) unter der Mindesthöhe (\d+) für „(.+)“: Signatur in Kompaktform$/,
    kind: 'height',
    text: (m) => `Raum zu niedrig: Wandhöhe ${m[1]}, „${m[3]}“ braucht ${m[2]}. Das Hauptmöbel steht deshalb in Kompaktform – Wandhöhe der Etage erhöhen (Klick auf die aktive Etage in der Etagen-Leiste).`,
  },
  {
    re: /^Layout gelockert \((.+)\): Pflichtobjekt passte sonst nicht$/,
    kind: 'layout',
    text: (m) => `Layout gelockert (${m[1]}), sonst hätte ein Pflichtmöbel nicht gepasst. Ein größerer Raum lässt Gang bzw. Freifläche wie vorgesehen.`,
  },
  {
    re: /^ohne Mittelgang\/Freifläche eingerichtet: Pflichtobjekt passte sonst nicht$/,
    kind: 'layout',
    text: () => 'Ohne Mittelgang bzw. Freifläche eingerichtet, sonst hätte ein Pflichtmöbel nicht gepasst. Ein größerer Raum hilft.',
  },
  {
    // W8-B (27.09.2026): Rückfall der Regel `useAccess` (Nutzungsseite am begehbaren Netz)
    re: /^Nutzungsseite von (.+) in Engstelle oder Sackgasse: Pflichtobjekt passte sonst nicht$/,
    kind: 'layout',
    text: (m) => `Pflichtmöbel (${m[1]}) ist nur über eine Engstelle oder Sackgasse zu benutzen, sonst hätte es nicht gepasst. Ein größerer Raum hilft.`,
  },
  {
    // W5 (Weg `spare`) und W8-E: Stücke über der Mindestzahl (Flächenzahl) sind Wunsch, keine Pflicht
    re: /^(\d+) × (.+) über der Mindestzahl entfällt: (Hauptweg hat Vorrang|kein Platz im Raum)$/,
    kind: 'layout',
    text: (m) => `${m[1]} × ${m[2]} weniger als gewünscht (${m[3] === 'kein Platz im Raum' ? 'kein Platz mehr an Wand oder Boden' : 'der Hauptweg hat Vorrang'}); die Mindestzahl steht. Ein größerer Raum hilft.`,
  },
  {
    re: /^Pflichtobjekt (.+) per Backtracking platziert \((.+)\)$/,
    kind: 'repair',
    text: (m) => `Pflichtmöbel (${m[1]}) erst nach Umstellen untergebracht: ${m[2]}.`,
  },
];

/** Notiz des Solvers → verständlicher Satz und Art; Unbekanntes bleibt wörtlich (Art `other`). */
export function explainNote(note: string): QualityNote {
  for (const r of NOTE_RULES) {
    const m = note.match(r.re);
    if (m !== null) return { kind: r.kind, text: r.text(m) };
  }
  return { kind: 'other', text: note };
}

const pct = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 100);

/**
 * @param access Erreichbarkeit des Raums (Review 3: „Keller-Wertung 86 % · sehr gut“ trotz fehlender Tür/Treppe).
 *   Der Prozentwert bewertet weiterhin **nur die Einrichtung** – aber Stufe und Farbe sagen jetzt, dass der Raum
 *   gar nicht begehbar ist, und ein Hinweis steht ganz oben.
 */
export function qualitySummary(q: RoomQuality, access?: { readonly unreachable?: boolean }): QualitySummary {
  const percent = pct(q.score);
  const furnishing = q.score >= 0.85 ? 'sehr gut' : q.score >= 0.7 ? 'gut' : q.score >= 0.5 ? 'mittel' : 'schwach';
  const unreachable = access?.unreachable === true;
  const grade = unreachable ? `${furnishing}, kein Zugang` : furnishing;
  const tone: QualityTone = unreachable ? 'weak' : q.score >= 0.7 ? 'good' : q.score >= 0.5 ? 'ok' : 'weak';
  const lines = [...q.parts]
    .map((p): QualityLine => ({ id: p.id, label: p.label, percent: pct(p.value), detail: p.detail }))
    .sort((a, b) => a.percent - b.percent || a.label.localeCompare(b.label));
  const weakest = lines[0];
  const why =
    weakest === undefined || weakest.percent >= 95
      ? 'Alle Teilwerte erfüllt.'
      : `Am schwächsten: ${weakest.label} ${weakest.percent} %${weakest.detail !== undefined ? ` (${weakest.detail})` : ''}. Der Wert mischt Mittel (65 %) und schwächsten Teil (35 %).`;
  const explained = q.notes.map(explainNote);
  const accessAlert = unreachable
    ? ['Kein Zugang: Vom Eingang führt kein Weg in diesen Raum – es fehlt eine Tür oder eine Treppe. Die Einrichtung ist bewertet, der Raum im Spiel aber nicht erreichbar.']
    : [];
  return {
    percent,
    grade,
    tone,
    why,
    lines,
    alerts: [...accessAlert, ...explained.filter((n) => ALERT_KINDS.has(n.kind)).map((n) => n.text)],
    notes: explained.filter((n) => !ALERT_KINDS.has(n.kind)).map((n) => n.text),
  };
}

/** Anzeige der Dichte, z. B. „Standard“, „125 %“. */
export function densityLabel(d: number): string {
  return d === 1 ? 'Standard' : d === 0 ? 'nur Pflicht' : `${Math.round(d * 100)} %`;
}
