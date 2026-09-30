/**
 * Hinweistext (Disclaimer) in Textfeldern der Metadaten (`ExportVolume.disclaimer`, additiv).
 *
 * NBT-Strings tragen ihre Länge als unsigned short: höchstens 65 535 Bytes in Modified UTF-8 (Java
 * `DataOutput.writeUTF`, so schreiben Minecraft, Litematica und WorldEdit). Der Disclaimer wird nie gekürzt – wird
 * es zu lang, kürzt `withDisclaimer` die vorhandene Beschreibung davor.
 */

/** Höchstlänge eines NBT-Strings in Bytes (Modified UTF-8). */
export const NBT_STRING_MAX_BYTES = 0xffff;

/** Trenner zwischen einer vorhandenen Beschreibung und dem Disclaimer. */
export const DISCLAIMER_SEPARATOR = '\n\n';

/** Markiert eine gekürzte Beschreibung. */
const ELLIPSIS = '…';

/** Länge einer UTF-16-Einheit in Modified UTF-8 (U+0000 → 2 Bytes, Surrogate je 3 Bytes). */
function unitBytes(c: number): number {
  if (c >= 0x0001 && c <= 0x007f) return 1;
  if (c <= 0x07ff) return 2;
  return 3;
}

/** Länge von `s` in Modified UTF-8 (wie `encodeMutf8(s).length`). */
export function mutf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n += unitBytes(s.charCodeAt(i));
  return n;
}

/** Längster Anfang von `s` mit höchstens `maxBytes` Bytes; ein Surrogat-Paar wird nie geteilt. */
function truncateMutf8(s: string, maxBytes: number): string {
  let n = 0;
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
    const pair = c >= 0xd800 && c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
    const len = pair ? 6 : unitBytes(c);
    if (n + len > maxBytes) break;
    n += len;
    i += pair ? 2 : 1;
  }
  return s.slice(0, i);
}

/**
 * Beschreibung + Disclaimer für ein NBT-Textfeld.
 * - Ohne Disclaimer (`undefined` oder leer): die Beschreibung unverändert (bitgleich).
 * - Leere Beschreibung: nur der Disclaimer.
 * - Beschreibung enthält den Disclaimer schon: unverändert (kein Doppel beim erneuten Export).
 * - Sonst `Beschreibung + "\n\n" + Disclaimer`; passt das nicht in 65 535 Bytes, wird die Beschreibung gekürzt
 *   (mit „…“), der Disclaimer bleibt vollständig. Ist der Disclaimer allein zu lang: `RangeError` (wie der Encoder).
 */
export function withDisclaimer(description: string, disclaimer: string | undefined): string {
  if (disclaimer === undefined || disclaimer === '') return description;
  const own = mutf8Length(disclaimer);
  if (own > NBT_STRING_MAX_BYTES) throw new RangeError(`Disclaimer zu lang (${own} Bytes > ${NBT_STRING_MAX_BYTES})`);
  if (description === '') return disclaimer;
  if (description.includes(disclaimer)) return description;
  const tail = DISCLAIMER_SEPARATOR + disclaimer;
  const room = NBT_STRING_MAX_BYTES - mutf8Length(tail);
  if (mutf8Length(description) <= room) return description + tail;
  const cut = truncateMutf8(description, room - mutf8Length(ELLIPSIS));
  // Kein Platz für einen Rest der Beschreibung (nur bei einem fast 64 KiB langen Disclaimer): der Disclaimer allein
  return cut === '' ? disclaimer : cut + ELLIPSIS + tail;
}
