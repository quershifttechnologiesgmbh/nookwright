/** Hinweistexte in Nutzersprache (Nutzerreview: „Wunschraum ‚bedroom‘ entfiel“). */
import { describe, expect, it } from 'vitest';
import { variantTitle, translateHint, translateHints, translateRoomRefs, translateStairRefs, variantLabel } from '../src/ui/hintText.js';

const namen: Record<string, string> = { bedroom: 'Schlafzimmer', carpentry: 'Schreinerei' };
const name = (id: string): string => namen[id] ?? id;

describe('Hinweistexte übersetzen', () => {
  it('ersetzt Raumtyp-IDs durch Klartextnamen', () => {
    expect(translateHint('Wunschraum „bedroom“ entfiel (zu wenig Platz)', name)).toBe('Wunschraum „Schlafzimmer“ entfiel (zu wenig Platz)');
    expect(translateHint('Wunschraum „carpentry“ entfiel', name)).toBe('Wunschraum „Schreinerei“ entfiel');
  });

  it('lässt unbekannte IDs und Text ohne IDs unverändert', () => {
    expect(translateHint('Wunschraum „unbekannt“ entfiel', name)).toBe('Wunschraum „unbekannt“ entfiel');
    // Nur der Typname in Anführungszeichen wird getauscht, Zahlen und Rest bleiben
    expect(translateHint('Raum „bedroom“ ist 3 Zellen groß', name)).toBe('Raum „Schlafzimmer“ ist 3 Zellen groß');
  });

  it('Varianten-Label: „Variante 2“ statt der technischen ID', () => {
    const variants = [{ id: 'plain' }, { id: 'log_curtains' }, { id: 'canopy' }];
    expect(variantLabel(variants, 'log_curtains')).toBe('Variante 2');
    expect(variantLabel(variants, 'plain')).toBe('Variante 1');
    // unbekannte ID oder fehlende Liste: neutral bleiben, nie die ID zeigen
    expect(variantLabel(variants, 'gibtsnicht')).toBe('Variante');
    expect(variantLabel(undefined, 'x')).toBe('Variante');
  });

  it('Varianten-Tooltip nennt Klartext statt der ID (Review 3: „fence_plate“, „podzol“)', () => {
    const variants = [{ id: 'fence_plate' }, { id: 'slab_top' }];
    expect(variantTitle(variants, 'fence_plate', 'Kleiner Tisch')).toBe('Kleiner Tisch · Variante 1 von 2');
    expect(variantTitle(variants, 'slab_top', 'Kleiner Tisch')).toBe('Kleiner Tisch · Variante 2 von 2');
    expect(variantTitle([{ id: 'podzol' }, { id: 'mycelium' }], 'podzol', 'Pilzbeet')).not.toContain('podzol');
    // ohne Variante oder unbekannte ID: nur der Name bzw. neutral
    expect(variantTitle(variants, undefined, 'Kleiner Tisch')).toBe('Kleiner Tisch');
    expect(variantTitle(variants, 'weg', 'Kleiner Tisch')).toBe('Kleiner Tisch · Variante');
    expect(variantTitle(undefined, 'x', 'Tisch')).toBe('Tisch · Variante');
  });

  it('übersetzt Listen in Reihenfolge', () => {
    const out = translateHints(['„bedroom“ entfiel', '„carpentry“ entfiel', 'kein Hinweis'], name);
    expect(out).toEqual(['„Schlafzimmer“ entfiel', '„Schreinerei“ entfiel', 'kein Hinweis']);
  });
});

describe('Auftrag 3: Baukörper-Meldung in Nutzersprache', () => {
  const label = (id: string): string | undefined =>
    id === 'r296' ? 'Wohnstube · 3 (1. OG)' : id === 'r15' ? 'Thronsaal · 1 (EG)' : undefined;

  it('ersetzt Raum-IDs durch Anzeigenamen, lässt Unbekanntes stehen', () => {
    const text = 'Räume verschiedener Baukörper dürfen sich nicht überdecken: Raum r296 (Baukörper v1, Etage 1. OG, solar) '
      + 'überschneidet Raum r15 (Baukörper v0, Etage EG, throne_room) bei 3,3. Der Bergfried einer Burg ist ein eigener Baukörper – '
      + 'seine Räume dürfen den Palas nicht überdecken (und umgekehrt)';
    const out = translateRoomRefs(text, label);
    expect(out).toContain('Raum „Wohnstube · 3 (1. OG)“');
    expect(out).toContain('Raum „Thronsaal · 1 (EG)“');
    expect(out).not.toMatch(/Raum r\d/);
    // Der Rest der Meldung bleibt unverändert (Etagen, Baukörper, Hinweis)
    expect(out).toContain('Der Bergfried einer Burg ist ein eigener Baukörper');
    expect(out).toContain('Baukörper v1');
  });

  it('unbekannte ID bleibt stehen (nie eine falsche Zuordnung)', () => {
    expect(translateRoomRefs('Raum r999 überschneidet Raum r15', label)).toBe('Raum r999 überschneidet Raum „Thronsaal · 1 (EG)“');
  });
});

describe('W11-B: Planer- und Treppenmeldungen ohne internen Jargon', () => {
  it('Silhouetten-Werte in Klartext, ohne Kennung und Quellenangabe (R6)', () => {
    const out = translateHint('Silhouette: roofToEave 2.4 außerhalb 0.4–1.5 (research/19 §9.1)', name);
    expect(out).toBe('Ungewöhnliche Form: Dachhöhe im Verhältnis zur Wandhöhe 2,4 (üblich 0,4–1,5) – nur ein Hinweis, gebaut wird trotzdem');
    expect(translateHint('Silhouette: roofToEave 0 außerhalb 0.4–1.5 (research/19 §9.1)', name)).toBe('Ungewöhnliche Form: flaches Dach (üblich ist ein Dach von 0,4–1,5 × Wandhöhe) – nur ein Hinweis, gebaut wird trotzdem');
    expect(translateHint('Silhouette: massCount 1 außerhalb 2–4', name)).toBe('Ungewöhnliche Form: Zahl der Baukörper 1 (üblich 2–4) – nur ein Hinweis, gebaut wird trotzdem');
    // unbekannte Kennung: neutral, nie die Kennung zeigen
    expect(translateHint('Silhouette: fooBar 1.333 außerhalb 2–4', name)).toBe('Ungewöhnliche Form: Proportion 1,33 (üblich 2–4) – nur ein Hinweis, gebaut wird trotzdem');
    for (const id of ['ratio', 'heightToWidth', 'roofToEave', 'width', 'floors', 'partOverMain', 'massCount', 'focusOverMain']) {
      const t = translateHint('Silhouette: ' + id + ' 9 außerhalb 1–2 (research/19 §9.1)', name);
      expect(t, id).not.toMatch(/[a-z][A-Z]|research|Silhouette/);
      expect(t, id).not.toContain('Proportion');
    }
    expect(translateHint('Wunschraum „bedroom“ entfiel (research/22 §1)', name)).toBe('Wunschraum „Schlafzimmer“ entfiel');
  });

  it('Treppen-IDs werden zu „EG → 1. OG“', () => {
    const floor = (i: number): string => (i === 0 ? 'EG' : i + '. OG');
    const label = (id: string): string | undefined => (id === 's58' ? 'EG → 1. OG' : undefined);
    expect(translateStairRefs('Treppe überschneidet sich mit Treppe s58 auf Etage 0', label, floor)).toBe('Treppe überschneidet sich mit der Treppe EG → 1. OG');
    expect(translateStairRefs('Treppe überschneidet sich mit Treppe s9 auf Etage 1', label, floor)).toBe('Treppe überschneidet sich mit einer Treppe auf 1. OG');
    expect(translateStairRefs('Keine Treppe hier', label, floor)).toBe('Keine Treppe hier');
  });
});
