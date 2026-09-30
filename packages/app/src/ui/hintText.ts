/**
 * Hinweistexte der Domäne in Nutzersprache (Nutzerreview: „Wunschraum ‚bedroom' entfiel“). Die Domäne kennt nur
 * IDs; die Oberfläche ersetzt sie durch die Klartextnamen aus dem Katalog. Rein und testbar.
 */
/**
 * W11-B (R6): Silhouetten-Werte des Planers (`QualityValue.id`, research/19 §9.1) in Nutzersprache. Vorher stand im
 * Fuß des Assistenten „Silhouette: roofToEave 2.4 außerhalb 0.4–1.5 (research/19 §9.1)“.
 */
const SILHOUETTE_LABELS: Readonly<Record<string, string>> = {
  ratio: 'Seitenverhältnis des Grundrisses',
  heightToWidth: 'Höhe im Verhältnis zur Breite',
  roofToEave: 'Dachhöhe im Verhältnis zur Wandhöhe',
  width: 'Breite',
  floors: 'Etagenzahl',
  partOverMain: 'Anbau im Verhältnis zum Hauptbau',
  massCount: 'Zahl der Baukörper',
  focusOverMain: 'Turm im Verhältnis zum Hauptbau',
  articulationPlan: 'Gliederung des Grundrisses',
  articulationFront: 'Gliederung der Frontansicht',
  facadeSymmetry: 'Unregelmäßigkeit der Fensterachsen',
  facadeEntropy: 'Vielfalt des Fensterrasters',
};

/** Zahl mit deutschem Komma, höchstens zwei Nachkommastellen („2.4“ → „2,4“). */
const num = (s: string): string => String(Math.round(Number(s) * 100) / 100).replace('.', ',');

/** Silhouetten-Hinweis → „Ungewöhnliche Form: Dachhöhe im Verhältnis zur Wandhöhe 2,4 (üblich 0,4–1,5) – nur ein Hinweis …“. */
function silhouetteHint(text: string): string | undefined {
  const m = /^Silhouette: (\w+) (-?[\d.]+) außerhalb (-?[\d.]+)–(-?[\d.]+)/.exec(text);
  if (m === null) return undefined;
  const tail = ' – nur ein Hinweis, gebaut wird trotzdem';
  // Flachdach (gewollt, z. B. „mit Flachdach“): kein Verhältnis „0“, sondern Klartext
  if (m[1] === 'roofToEave' && Number(m[2]) === 0) return `Ungewöhnliche Form: flaches Dach (üblich ist ein Dach von ${num(m[3]!)}–${num(m[4]!)} × Wandhöhe)${tail}`;
  const label = SILHOUETTE_LABELS[m[1]!] ?? 'Proportion';
  return `Ungewöhnliche Form: ${label} ${num(m[2]!)} (üblich ${num(m[3]!)}–${num(m[4]!)})${tail}`;
}

/** Entwickler-Quellen („(research/19 §9.1)“) haben in Nutzertexten nichts zu suchen. */
const withoutSource = (text: string): string => text.replace(/\s*\(research\/[^)]*\)/g, '');

/**
 * Hinweis der Domäne in Nutzersprache: `„id“` wird zum Anzeigenamen des Raumtyps (`roomTypeName`), Silhouetten-Werte
 * werden Klartext, Quellenangaben verschwinden; sonst bleibt der Text.
 */
export function translateHint(text: string, roomTypeName: (id: string) => string): string {
  const silhouette = silhouetteHint(text);
  if (silhouette !== undefined) return silhouette;
  return withoutSource(text).replace(/„([a-z0-9_]+)“/g, (ganz, id: string) => {
    const name = roomTypeName(id);
    return name === id ? ganz : `„${name}“`;
  });
}

/**
 * W11-B: Treppen-IDs in Domänenmeldungen („Treppe überschneidet sich mit Treppe s58 auf Etage 0“) → „mit der Treppe
 * EG → 1. OG“. Kam direkt nach dem Setzen einer Treppe, weil der Geist auf der eben gesetzten Treppe stand – mit
 * interner ID und Etagenzahl sah das wie ein Fehler aus. `stairsLabel(id)`: Anzeigename oder `undefined` (bleibt stehen).
 */
export function translateStairRefs(text: string, stairsLabel: (id: string) => string | undefined, floorName: (index: number) => string): string {
  return text
    .replace(/mit Treppe (s[0-9]+) auf Etage (-?\d+)/g, (ganz, id: string, floor: string) => {
      const name = stairsLabel(id);
      return name === undefined ? `mit einer Treppe auf ${floorName(Number(floor))}` : `mit der Treppe ${name}`;
    })
    .replace(/Treppe (s[0-9]+)\b/g, (ganz, id: string) => {
      const name = stairsLabel(id);
      return name === undefined ? ganz : `Treppe ${name}`;
    });
}

/** Alle Hinweise übersetzt (Reihenfolge und Länge bleiben). */
export function translateHints(hints: readonly string[], roomTypeName: (id: string) => string): string[] {
  return hints.map((h) => translateHint(h, roomTypeName));
}

/**
 * Anzeigename einer Komponenten-Variante (Nutzerreview: „Himmelbett · log_curtains“): Die Oberfläche zeigt
 * „Variante 2“, die technische ID steht nur im Tooltip.
 */
export function variantLabel(variants: readonly { readonly id: string }[] | undefined, variantId: string): string {
  const i = variants?.findIndex((v) => v.id === variantId) ?? -1;
  return i >= 0 ? `Variante ${i + 1}` : 'Variante';
}

/**
 * Tooltip eines Möbels mit Variante – **ohne** die technische Varianten-ID (Review 3: „Möbel-Roh-IDs
 * `fence_plate`, `podzol`“). Die Nummer genügt, um Varianten zu unterscheiden; die IDs stehen im Katalog.
 */
export function variantTitle(variants: readonly { readonly id: string }[] | undefined, variantId: string | undefined, name: string): string {
  if (variantId === undefined) return name;
  const i = variants?.findIndex((v) => v.id === variantId) ?? -1;
  return i < 0 ? `${name} · Variante` : `${name} · Variante ${i + 1} von ${variants!.length}`;
}

/**
 * Ersetzt Raum-IDs in einer Domänenmeldung durch Anzeigenamen (Auftrag 3: „Raum r296 (Baukörper v0) überschneidet
 * Raum r15" → „Raum „Wohnstube · 3 (1. OG)" …). `label(roomId)` liefert den Anzeigenamen oder `undefined`, wenn die
 * ID nicht zum Projekt gehört – dann bleibt sie stehen (nie eine falsche Zuordnung).
 */
export function translateRoomRefs(text: string, label: (roomId: string) => string | undefined): string {
  return text.replace(/Raum (r[0-9]+)/g, (ganz, id: string) => {
    const name = label(id);
    return name === undefined ? ganz : `Raum „${name}“`;
  });
}
