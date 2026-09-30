/**
 * W15 Fassaden-Details im Editor (plan/spikes/W15_fassaden_detailbloecke.md): Auswahl „Details: Standard / aus / dezent /
 * reich / prunkvoll“ im Außen-Panel. Rein und testbar.
 *
 * Die Regeln (welche Muster eine Stufe in welchem Theme bringt) liegen in der Domäne (`@mcda/exterior`
 * `facadeDetailActive`); hier stehen nur Beschriftungen und das Setzen des Feldes `ExteriorChoice.facadeDetail`
 * (dasselbe wie `exterior.facadeDetail` der Engine-API). Die Gruppe `detailBlocks` ist in der Auswahl aufgegangen:
 * dezent und reich schalten sie wieder an.
 */
import type { ExteriorPlan } from '@mcda/pipeline';
import type { ExteriorChoice } from '../usecases.js';

export type DetailLevel = NonNullable<ExteriorChoice['facadeDetail']>;
/** Wert der Auswahl: `''` = Standard (Feld fehlt, die Domäne entscheidet). */
export type DetailPick = DetailLevel | '';

const LEVEL: Readonly<Record<DetailLevel, { readonly label: string; readonly hint: string }>> = {
  off: { label: 'aus', hint: 'keine Fassaden-Details aus Teilblöcken' },
  subtle: { label: 'dezent', hint: 'Konsolen aus umgedrehten Treppen unter Auskragung, Gesims und Fensterbank, Hängezapfen im Giebel, Regal-Auslage am Laden' },
  rich: { label: 'reich', hint: 'dazu Zahnschnitt unter der Traufe, Laterne am Giebelzapfen, Giebelbanner, Fässer, Regentonnen und Holzstapel' },
  grand: { label: 'prunkvoll', hint: 'dazu Balkon und Erker am Obergeschoss, Geschossband, Verdachung über Fenstern, Strebepfeiler, Wetterfahne, Glockentürmchen, Rankgitter, Taubenschlag, Sockelabsatz, Wandpfeiler, Blindbögen und Regenfallrohr' },
};

export const DETAIL_LEVEL_OPTIONS: ReadonlyArray<{ readonly id: DetailPick; readonly label: string; readonly hint: string }> = [
  { id: '', label: 'Standard (dezent)', hint: 'Voreinstellung des Generators: dezent' },
  ...(['off', 'subtle', 'rich', 'grand'] as const satisfies readonly DetailLevel[]).map((id) => ({ id, ...LEVEL[id] })),
];

/** Anzeige für Statuszeile und Undo („Fassaden-Details: dezent“). */
export const detailLevelLabel = (v: DetailLevel | undefined): string => (v === undefined ? 'Standard (dezent)' : LEVEL[v].label);

/** Neue Außen-Deko mit dieser Stufe (ein Undo-Schritt); „Standard“ entfernt das Feld, dezent/reich schalten die Gruppe an. */
export function withDetailLevel(x: ExteriorChoice, pick: DetailPick): ExteriorChoice {
  const { facadeDetail: _, ...rest } = x;
  const groups = pick === 'subtle' || pick === 'rich' || pick === 'grand' ? { ...x.groups, detailBlocks: true } : x.groups;
  return { ...rest, groups, ...(pick !== '' ? { facadeDetail: pick } : {}) };
}

/** Gesetzte Detail-Teile im fertigen Plan (Zahl neben der Auswahl). */
export const detailParts = (plan: ExteriorPlan | undefined): number => (plan?.placements ?? []).filter((p) => p.group === 'detailBlocks').length;
