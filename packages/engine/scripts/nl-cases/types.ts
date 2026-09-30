/**
 * Prüffall für den NL-Vergleich (`scripts/nl-compare.ts`): Prompt, erwartete Felder (`want`, nur was die Bitte klar
 * sagt) und verbotene Werte (`not`, z. B. „nicht mittelalterlich“ → themeId ≠ medieval). Ein erwartetes Feld mit
 * anderem Wert oder ein verbotener Wert zählt als Falschsetzung (schlimmer als weggelassen); ein fehlendes Feld nur als
 * nicht getroffen.
 */
export interface NlCase {
  readonly prompt: string;
  readonly want: Readonly<Record<string, unknown>>;
  readonly not?: Readonly<Record<string, unknown>>;
}
