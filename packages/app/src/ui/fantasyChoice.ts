/**
 * W7-K Fantasy-Stufe im Editor (plan/spikes/W7K_fantasy_ui.md): Auswahl „Fantasy: nach Stil / aus / Akzent / voll“ und
 * „Art: nach Material / elbisch / zwergisch“ im Außen-Panel. Rein und testbar.
 *
 * Die Regeln (welche Module eine Stufe bringt, welches Kit ein Theme bekommt) liegen in der Domäne
 * (`@mcda/exterior` `fantasyLevelFor`/`fantasyKitFor`); hier stehen nur Beschriftungen, das Setzen der Felder
 * `ExteriorChoice.fantasy`/`.fantasyKit` (dieselben wie `exterior.fantasy`/`.fantasyKit` der Engine-API) und die Lesart
 * des fertigen Außen-Plans (welche Fantasy-Teile tatsächlich gesetzt sind).
 *
 * Zusammenlegung: Der frühere Schalter „Stil › Fantasy-Akzente“ (Gruppe `fantasyDecor`) ist in der Stufe aufgegangen –
 * „voll“ heißt alle Module des Kits, also auch Banner, Zier und Ranken; wer „voll“ oder „nach Stil“ wählt, schaltet die
 * Gruppe wieder an. Die Gruppe bleibt Teil des Stils (Projektdatei, API `exterior.off`) und lässt sich über ein
 * angeklicktes Außen-Teil („Gruppe ausschalten“) abschalten; dann zeigt die Stufe „voll (ohne Banner, Zier)“.
 */
import type { ExteriorPlan } from '@mcda/pipeline';
import type { ExteriorChoice } from '../usecases.js';

export type FantasyLevel = NonNullable<ExteriorChoice['fantasy']>;
export type FantasyKit = NonNullable<ExteriorChoice['fantasyKit']>;
/** Wert der Auswahl: `''` = nach Stil (Feld fehlt, die Domäne entscheidet nach Theme). */
export type FantasyPick = FantasyLevel | '';
export type FantasyKitPick = FantasyKit | '';

/** Beschriftung je Stufe (Record: ein neuer Domänen-Wert fehlt sonst im Typecheck). */
const LEVEL: Readonly<Record<FantasyLevel, { readonly label: string; readonly hint: string }>> = {
  off: { label: 'aus', hint: 'keine Fantasy-Module, auch nicht in den Themes Elbisch und Zwergisch' },
  accent: { label: 'Akzent', hint: 'nur Hängelaternen am Bogenarm und Giebelhörner – passt zu jedem Stil' },
  full: { label: 'voll', hint: 'alle Module der Art: Bogenarm-Laternen, Giebelhörner, Banner, Giebelzier, Laubranken bzw. Feuerschalen' },
};
const KIT: Readonly<Record<FantasyKit, { readonly label: string; readonly hint: string }>> = {
  elven: { label: 'elbisch', hint: 'geschwungene Hörner, grüne Banner, Amethyst, Laubranken' },
  dwarven: { label: 'zwergisch', hint: 'gerade Hörner, rote Banner, Runenstein, Feuerschalen am Eingang' },
};

/** Optionen der Stufe in Anzeige-Reihenfolge. */
export const FANTASY_LEVEL_OPTIONS: ReadonlyArray<{ readonly id: FantasyPick; readonly label: string; readonly hint: string }> = [
  { id: '', label: 'nach Stil', hint: 'wie das Theme: Elbisch und Zwergisch voll, sonst aus' },
  ...(['off', 'accent', 'full'] as const satisfies readonly FantasyLevel[]).map((id) => ({ id, ...LEVEL[id] })),
];
/** Optionen der Art (Kit) in Anzeige-Reihenfolge. */
export const FANTASY_KIT_OPTIONS: ReadonlyArray<{ readonly id: FantasyKitPick; readonly label: string; readonly hint: string }> = [
  { id: '', label: 'nach Material', hint: 'Theme Elbisch bzw. Zwergisch: seine Art; sonst Holzwände elbisch, Steinwände zwergisch' },
  ...(['elven', 'dwarven'] as const satisfies readonly FantasyKit[]).map((id) => ({ id, ...KIT[id] })),
];

/** Anzeige für Statuszeile und Undo („Fantasy: Akzent“). */
export const fantasyLevelLabel = (v: FantasyLevel | undefined): string => (v === undefined ? 'nach Stil' : LEVEL[v].label);
export const fantasyKitLabel = (v: FantasyKit | undefined): string => (v === undefined ? 'nach Material' : KIT[v].label);

/**
 * Neue Außen-Deko mit dieser Stufe (ein Undo-Schritt über `setShellStyle`). „nach Stil“ entfernt das Feld. „voll“ und
 * „nach Stil“ schalten die Gruppe `fantasyDecor` wieder an (voll = alle Module), aus/Akzent lassen sie, wie sie ist.
 */
export function withFantasyLevel(x: ExteriorChoice, pick: FantasyPick): ExteriorChoice {
  const { fantasy: _, ...rest } = x;
  const groups = pick === '' || pick === 'full' ? { ...x.groups, fantasyDecor: true } : x.groups;
  return { ...rest, groups, ...(pick !== '' ? { fantasy: pick } : {}) };
}

/** Neue Außen-Deko mit dieser Art; „nach Material“ entfernt das Feld. */
export function withFantasyKit(x: ExteriorChoice, pick: FantasyKitPick): ExteriorChoice {
  const { fantasyKit: _, ...rest } = x;
  return { ...rest, ...(pick !== '' ? { fantasyKit: pick } : {}) };
}

/** Katalog-Präfix der Fantasy-Module (`fantasyModuleComponent` der Domäne; Test hält es gleich). */
export const FANTASY_COMPONENT_PREFIX = 'exterior/fantasy_';
const KITS: ReadonlySet<string> = new Set(Object.keys(KIT));

/** Was der fertige Plan an Fantasy-Teilen enthält: Zahl und Art (aus der Kit-Variante, `<kit>` bzw. `<kit>_double`). */
export function fantasySeen(plan: ExteriorPlan | undefined): { readonly parts: number; readonly kit?: FantasyKit } {
  const mine = (plan?.placements ?? []).filter((p) => p.componentId.startsWith(FANTASY_COMPONENT_PREFIX));
  const kit = mine.map((p) => (p.variantId ?? '').replace(/_double$/, '')).find((k) => KITS.has(k)) as FantasyKit | undefined;
  return { parts: mine.length, ...(kit !== undefined ? { kit } : {}) };
}

/** Wert und Beschriftungen der beiden Auswahlfelder für den aktuellen Stil und Plan. */
export interface FantasyView {
  readonly level: FantasyPick;
  readonly kit: FantasyKitPick;
  /** Art-Auswahl zeigen: nur, wenn Fantasy nicht aus ist (gewählt Akzent/voll, oder nach Stil mit gesetzten Teilen). */
  readonly showKit: boolean;
  /** Gesetzte Fantasy-Teile (für die Zahl neben der Auswahl). */
  readonly parts: number;
  /** Beschriftung je Stufen-Option (mit dem, was „nach Stil“ gerade ergibt bzw. „voll“ ohne die Gruppe). */
  readonly levelText: (id: FantasyPick) => string;
  readonly kitText: (id: FantasyKitPick) => string;
}

export function fantasyView(x: ExteriorChoice, plan: ExteriorPlan | undefined): FantasyView {
  const seen = fantasySeen(plan);
  const level: FantasyPick = x.fantasy ?? '';
  const decorOff = !x.groups.fantasyDecor;
  const showKit = x.enabled && (level === 'accent' || level === 'full' || (level === '' && seen.parts > 0));
  return {
    level,
    kit: x.fantasyKit ?? '',
    showKit,
    parts: seen.parts,
    levelText: (id) => {
      const base = FANTASY_LEVEL_OPTIONS.find((o) => o.id === id)!.label;
      if (id === '' && level === '' && seen.parts > 0) return `${base} (${decorOff ? 'voll ohne Banner, Zier' : 'voll'})`;
      if (id === 'full' && decorOff) return `${base} (ohne Banner, Zier)`;
      return base;
    },
    kitText: (id) => {
      const base = FANTASY_KIT_OPTIONS.find((o) => o.id === id)!.label;
      return id === '' && x.fantasyKit === undefined && seen.kit !== undefined ? `${base} (${KIT[seen.kit].label})` : base;
    },
  };
}
