/** Auflösung kompakt gespeicherter Block-Tags (Einträge: Block-ID oder `#tag`-Verweis). */

/** Löst einen Tag rekursiv auf; Ergebnis sortiert, ohne Duplikate. Wirft bei Zyklen. */
export function resolveTag(
  tags: Readonly<Record<string, readonly string[]>>,
  tag: string,
  seen: Set<string> = new Set(),
): string[] {
  if (seen.has(tag)) throw new Error(`Zyklischer Tag: ${tag}`);
  seen.add(tag);
  const acc = new Set<string>();
  for (const e of Object.hasOwn(tags, tag) ? (tags[tag] ?? []) : []) {
    if (e.startsWith('#')) for (const x of resolveTag(tags, e.slice(1), seen)) acc.add(x);
    else acc.add(e);
  }
  seen.delete(tag);
  return [...acc].sort();
}
