// Einbau-Hinweise je Exportformat für die Galerie-Detailseite – derselbe Wortlaut wie `placeHint` im Editor
// (packages/app/src/exporting.ts), damit Website und Editor dasselbe sagen (Review R2-07; Test in
// website/test/place-hints.test.ts). Rein, ohne DOM. `code` markiert, was in <code> gehört.

/** Name der Vanilla-Struktur wie `templateId` im Editor: klein, Umlaute umschrieben, sonst `_`. */
export function templateId(name) {
  // wie fileBaseName im Editor: verbotene Zeichen → `_`, Leerraum zusammenfassen, Punkte am Rand weg, höchstens 80
  const base = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 80);
  const id = (base.length > 0 ? base : 'projekt')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id === '' ? 'projekt' : id;
}

/**
 * Hinweis je Format als Teile `[{ text } | { code }]` (Markdown-Backticks des Editors = `code`).
 * @param {'litematic' | 'schem' | 'nbt'} format
 * @param {string} name     Dateiname ohne Endung (Galerie: die ID des Baus)
 * @param {string} version  Zielversion, z. B. '1.21.11' oder '26.3'
 * @returns {string}  Text mit Backticks wie im Editor
 */
export function placeHint(format, name, version) {
  if (format === 'litematic') return 'Datei in den Ordner `.minecraft/schematics` legen, in Litematica über „Load Schematics“ laden und als Hologramm platzieren';
  if (format === 'schem') return 'Datei in `config/worldedit/schematics` legen (Server: `plugins/WorldEdit/schematics`), dann `//schem load <Name>` und `//paste`';
  const id = templateId(name);
  const folder = version.startsWith('1.') ? 'structures' : 'structure';
  return `Datei als \`${id}.nbt\` in \`saves/<Welt>/generated/minecraft/${folder}\` legen, dann \`/place template minecraft:${id} ~ ~ ~ none none 1 0 strict\`. Der Strukturblock lädt höchstens 48 × 48 × 48 Blöcke`;
}

/** Backticks → <code>, Rest HTML-escaped. */
export function hintHtml(hint) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return hint.split('`').map((part, i) => (i % 2 === 1 ? `<code>${esc(part)}</code>` : esc(part))).join('');
}
