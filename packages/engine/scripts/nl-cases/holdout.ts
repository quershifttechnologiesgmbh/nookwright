/**
 * Test-Holdout (22 Prompts, handgeschrieben am 2026-09-25 VOR jeder Optimierung festgelegt). Bei der Arbeit an Fragen,
 * Option-Texten und Kombination NICHT ansehen oder auswerten; `nl-compare --holdout` nur für die Vorher-/Nachher-Zahl.
 * Nicht aus den Wortlisten des lokalen Klassifikators erzeugt. Nachträglich nicht ändern (sonst ist die Zahl wertlos).
 * Stand: am 2026-09-25 einmal vorher und einmal nachher ausgewertet (E1 „J2“), danach eingesehen – für weitere
 * Optimierung verbraucht.
 */
import type { NlCase } from './types.js';

export const HOLDOUT: readonly NlCase[] = [
  { prompt: 'Kleines Gasthaus im Fachwerkstil, zwei Etagen', want: { buildingTypeId: 'tavern', size: 'S', themeId: 'timber', floors: 2 } },
  { prompt: 'riesige burrg im schnee', want: { buildingTypeId: 'castle_compact', size: 'L', themeId: 'winter' } },
  { prompt: 'cozy hobbit home, medium size, entrance to the south, no garden please', want: { buildingTypeId: 'hobbit', size: 'M', front: 'south', surroundings: false } },
  { prompt: 'Wachturm auf Stelzen im Sumpf', want: { buildingTypeId: 'watchtower', setting: { kind: 'stilts' } } },
  { prompt: 'Ein Haus im Baum, elbisch', want: { buildingTypeId: 'house', setting: { kind: 'tree' }, themeId: 'elven' } },
  { prompt: 'Bauernhaus ohne Deko, Eingang West', want: { buildingTypeId: 'farmhouse', exterior: { enabled: false }, front: 'west' } },
  { prompt: 'large tavern with a mansard roof, medieval', want: { buildingTypeId: 'tavern', size: 'L', shell: { roof: 'mansard' }, themeId: 'medieval' } },
  { prompt: 'Stadthaus, vier Stockwerke, Walmdach', want: { buildingTypeId: 'townhouse', floors: 4, shell: { roof: 'hip' } } },
  { prompt: 'nordic watchtower facing east', want: { buildingTypeId: 'watchtower', themeId: 'nordic', front: 'east' } },
  { prompt: 'zwergenhalle unter der erde', want: { buildingTypeId: 'hall', themeId: 'dwarven', setting: { kind: 'buried' } } },
  { prompt: 'Langhaus für Wikinger, groß, mit Flachdach und ohne Garten', want: { buildingTypeId: 'longhouse', size: 'L', shell: { roof: 'flat' }, surroundings: false } },
  { prompt: 'Wüsten-Taverne, klein', want: { buildingTypeId: 'tavern', themeId: 'desert', size: 'S' } },
  { prompt: 'ein Fachwerkhaus, aber nicht rustikal', want: { buildingTypeId: 'timber' }, not: { themeId: 'rustic' } },
  { prompt: 'Haus am Hang mit Pultdach', want: { buildingTypeId: 'house', setting: { kind: 'cliff' }, shell: { roof: 'shed' } } },
  { prompt: 'Burg mit drei Stockwerken, tropisch', want: { buildingTypeId: 'castle_compact', floors: 3, themeId: 'tropical' } },
  { prompt: 'export as litematica: small farmhouse, gable roof', want: { buildingTypeId: 'farmhouse', size: 'S', shell: { roof: 'gable' }, format: 'litematic' } },
  { prompt: 'Unterwasser-Stadthaus', want: { buildingTypeId: 'townhouse', setting: { kind: 'underwater' } } },
  { prompt: 'Taverne am Fluss, Eingang Nord, schlicht ohne deko', want: { buildingTypeId: 'tavern', setting: { kind: 'water' }, front: 'north', exterior: { enabled: false } } },
  { prompt: 'ruined farmhouse, big', want: { buildingTypeId: 'farmhouse', themeId: 'ruin', size: 'L' } },
  { prompt: 'Hobbithaus mit Garten und viel Deko', want: { buildingTypeId: 'hobbit', exterior: { density: 2 } }, not: { surroundings: false } },
  { prompt: 'zweistöckiges Haus im Küstenstil, Flachdach', want: { buildingTypeId: 'twostory', themeId: 'harbor', shell: { roof: 'flat' } } },
  { prompt: 'mach mir irgendwas cooles', want: {} },
];
