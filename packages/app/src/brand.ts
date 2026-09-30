/**
 * Marke an einer Stelle (W1, Abnahme A6): Kopfzeile, Fenstertitel und Pflicht-Disclaimer lesen von hier.
 *
 * „Nookwright“ ist ein **Platzhalter** – der endgültige Produktname ist laut README noch offen. Wer ihn ändert,
 * ändert ihn hier (und im `<title>` von `index.html`, den `test/brand.test.ts` gegen diese Datei prüft).
 * Regeln aus HANDOFF §1: „Alchemist“ nie im Namen, „Minecraft“ nie vorne.
 */

/** Produktname (Platzhalter, Name offen laut README). */
export const PRODUCT_NAME = 'Nookwright';

/** Fenstertitel des Editors („Editor – Nookwright“). */
export const EDITOR_TITLE = `Editor – ${PRODUCT_NAME}`;

/** Pflicht-Disclaimer (HANDOFF §1): steht in der Statusleiste, im Export-Dialog und bei Ladefehlern. */
export const DISCLAIMER = 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';
