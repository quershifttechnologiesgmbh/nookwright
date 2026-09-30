import JSON5 from 'json5';

/**
 * JSON5-Text lesen, schneller Weg zuerst (W14): Ist der Text gültiges JSON (so liefert ihn der App-Build aus,
 * `compactJson5` in packages/app), liest `JSON.parse` ihn mit demselben Wert – ein Vielfaches schneller als der
 * zeichenweise JSON5-Parser (Start der App: ~110 ms von ~270 ms Katalog). Sonst (Kommentare, Dev-Server, Node)
 * `JSON5.parse` wie bisher, mit dessen Fehlermeldung.
 */
export function parseJson5Text(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return JSON5.parse(text) as unknown;
  }
}
