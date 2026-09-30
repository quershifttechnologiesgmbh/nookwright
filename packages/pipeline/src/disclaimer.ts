/**
 * Pflicht-Hinweis im Export (HANDOFF §1: „Er muss in UI und Export stehen“). `toExport` setzt ihn in jedes
 * Export-Volumen – die eine Stelle, an der App (`exportProject`) und Engine-API (alle Generier-Operationen, Datei über
 * `encodeResult`/MCP) ihn gemeinsam einschalten. Die Writer von `@mcda/export` schreiben ihn nach `.litematic`
 * `Metadata.Description` und `.schem` `Metadata.Disclaimer`; `.nbt` hat kein Textfeld (plan/spikes/W1H_export_disclaimer.md).
 * Eigene Datei, damit `rules.ts` (parallel bearbeitet) unberührt bleibt; Wortlaut wie `DISCLAIMER` der App (`brand.ts`).
 */
export const EXPORT_DISCLAIMER = 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';

/**
 * Nutzungshinweis für Ausgaben (DR5 K10, research/08 §A.2 „Content“ und Checkliste: Exporte enthalten nur Block-IDs und
 * eigene bzw. nutzererzeugte Strukturen). **Entwurf** – nicht juristisch geprüft (research/08, Offene Fragen); steht in
 * Bauplan-Ausgaben (Markdown, `build_guide`) und in der Doku, nicht in den Schematic-Dateien (deren Bytes bleiben gleich).
 */
export const OUTPUT_LICENSE_DRAFT = 'Nutzungshinweis (Entwurf, nicht rechtlich geprüft): Dieser Bau wurde automatisch erzeugt und besteht nur aus '
  + 'Minecraft-Block-IDs in einer neuen Anordnung. Wir beanspruchen daran keine Rechte – nutzen, ändern und teilen ist ausdrücklich erwünscht. '
  + 'Minecraft, seine Blöcke und Texturen gehören Mojang/Microsoft.';
