/** W8-F: Enter in der Raumpalette wählt den besten Treffer (genau vor Anfang vor Teilwort vor Gruppe). */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { bestRoomTypeMatch, groupRoomTypes, roomTypeInfos, type RoomTypeInfo } from '../src/ui/roomTypeGroups.js';

const types = roomTypeInfos(loadBundledCatalog().catalog!);
const enter = (q: string, list: readonly RoomTypeInfo[] = types) => bestRoomTypeMatch(groupRoomTypes(list, q), q)?.id;

describe('W8-F: bester Treffer der Raumpalette', () => {
  it('„Küche“ wählt Küche, nicht Bäckerei (die Gruppe „Küche & Vorrat“ passt auch)', () => {
    const groups = groupRoomTypes(types, 'Küche');
    expect(groups[0]!.items[0]!.id).toBe('bakery'); // der alte Weg: erster Eintrag alphabetisch
    expect(enter('Küche')).toBe('kitchen');
    expect(enter('küche')).toBe('kitchen');
    expect(enter('kuche')).toBe('kitchen');
    expect(enter('  KÜCHE ')).toBe('kitchen');
  });

  it('genauer Name, dann Anfang, dann Wortanfang, dann Teilwort, dann ID; nur Gruppe zuletzt', () => {
    expect(enter('Schmiede')).toBe('smithy');
    expect(enter('Schm')).toBe('smithy');
    expect(enter('Kammer')).toBe('treasury'); // Teilwort in Schatz-/Waffenkammer: Gleichstand → alphabetisch
    expect(enter('kitchen')).toBe('kitchen'); // genaue ID
    expect(enter('Galerie')).toBe('gallery'); // Wortanfang in „Flur / Galerie“
    const onlyGroup = groupRoomTypes(types, 'Vorrat').flatMap((g) => g.items).map((t) => t.name).sort((a, b) => a.localeCompare(b, 'de'));
    expect(types.find((t) => t.id === enter('Vorrat'))?.name).toBe(onlyGroup[0]); // nur über die Gruppe: alphabetisch
  });

  it('eigener Treffer schlägt Gruppen-Treffer; Gleichstand alphabetisch; leer und ohne Treffer → undefined', () => {
    const list: RoomTypeInfo[] = [
      { id: 'bakery', name: 'Bäckerei' },
      { id: 'pantry', name: 'Speisekammer' },
      { id: 'kitchen', name: 'Küche' },
      { id: 'kitchen_small', name: 'Kleine Küche' },
    ];
    expect(enter('Küche', list)).toBe('kitchen');
    expect(enter('Kü', list)).toBe('kitchen'); // Anfang schlägt Wortanfang („Kleine Küche“)
    expect(enter('kammer', list)).toBe('pantry');
    expect(enter('', list)).toBeUndefined();
    expect(enter('zzz', list)).toBeUndefined();
  });
});
