/**
 * Einträge der Website-Galerie – die eine Quelle für `build-gallery.ts` (erzeugt die Dateien) und
 * `website/test/gallery-current.test.ts` (prüft, dass die eingecheckte Galerie dem aktuellen Generator entspricht).
 * Jeder Eintrag baut mit festen Parametern und Seed; gleicher Stand → gleicher Bau.
 */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { Project } from '@mcda/blueprint';
import { exportFile } from '@mcda/export/node';
import {
  completeBase, generateBase, homesteadBase, projectFromBuildingType,
  type World,
} from '../../packages/pipeline/src/index.js';
import type { NodeContext } from '../../packages/pipeline/src/node-context.js';

type Size = 'S' | 'M' | 'L';
export interface GalleryEntry {
  readonly id: string;
  readonly title: string;
  /** Ein Satz für die Karte */
  readonly blurb: string;
  readonly kind: 'Bautyp' | 'Base' | 'Haus';
  readonly build: () => { project: Project; world: World };
  readonly seed: number;
  readonly size?: Size;
  readonly type?: string;
}

export function galleryEntries(ctx: NodeContext): GalleryEntry[] {
  const fromType = (type: string, theme: string, seed: number, size: Size = 'M') => () => {
    const res = projectFromBuildingType(ctx.buildingTypes.get(type), { size, themeId: theme, targetVersion: { name: '1.21.11', dataVersion: 4671 } }, seed, ctx);
    return { project: res.project, world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
  };
  const typeEntry = (id: string, type: string, theme: string, seed: number, blurb: string, size: Size = 'M'): GalleryEntry => ({
    id, title: ctx.buildingTypes.get(type).name, blurb, kind: 'Bautyp', build: fromType(type, theme, seed, size), seed, size, type,
  });
  // W16-A (Schaufenster): je Bautyp die Konfiguration aus der blinden Seed-Wahl (plan/spikes/W16A_galerie.md): Kandidaten
  // Seeds 2026, 1–5 (feste Vorlagen: 2026, 1–5) × Größe M/L, Vorauswahl nach Kennzahlen (Baukörper, Firsthöhen, Firste),
  // gewählt der Kandidat mit der höchsten Note eines blinden Prüfers (spikes/w16a/candidates.ts, cand_pick.py). Reproduzierbar
  // in der App: Bautyp, Theme, Größe und Seed wie hier.
  return [
    typeEntry('wohnhaus-eckturm', 'house', 'medieval', 2026, 'Wohnhaus mit Quergiebel, Werkstatt und Eckturm – gestaffelte Dächer.'),
    typeEntry('burg-steinwacht', 'castle_compact', 'medieval', 1, 'Mauerring, Ecktürme und ein Burghof mit Wohnhaus.'),
    typeEntry('taverne-zum-fass', 'tavern', 'timber', 2, 'Schankraum, Küche und Gästezimmer unter einem Fachwerkdach.'),
    typeEntry('erdhaus-am-huegel', 'hobbit', 'rustic', 2026, 'Halb im Hügel versteckt, mit Garten vor der runden Tür.', 'L'),
    typeEntry('wachturm-nord', 'watchtower', 'medieval', 2026, 'Stockwerk für Stockwerk nach oben, oben die Wachstube.'),
    typeEntry('langhaus-fjord', 'longhouse', 'nordic', 2026, 'Eine lange Halle aus dunklem Holz unter einem Torfdach.'),
    typeEntry('bauernhof-lindenhof', 'farmhouse', 'rustic', 2, 'Wohnhaus mit Anbau und Scheune, dazu Hof, Felder und Garten.'),
    typeEntry('fachwerkhaus-markt', 'timber', 'timber', 1, 'Klassisches Fachwerk mit Obergeschoss und Waschhaus.'),
    typeEntry('stadthaus-gasse', 'townhouse', 'medieval', 3, 'Schmal, hoch und mitten in der Stadt zu Hause.'),
    typeEntry('grosse-halle', 'hall', 'medieval', 2026, 'Eine Festhalle für Bankette und Versammlungen.'),
    typeEntry('taverne-mittelalter', 'tavern', 'medieval', 42, 'Dieselbe Taverne, neu gewürfelt und aus Stein.', 'L'),
    typeEntry('burg-nordwall', 'castle_compact', 'nordic', 5, 'Die Burg im nordischen Stil, mit neuem Grundriss.'),
    // Produktwelle 30.09.2026: vier bestehende Themes als reproduzierbare Downloads zeigen.
    // Bewusst dieselbe Pipeline wie Editor und Engine; keine erfundenen Bautypen oder externe Assets.
    { ...typeEntry('langhaus-winterlicht', 'longhouse', 'winter', 2026, 'Verschneites Langhaus mit dunkler Traufe und warmem Innenraum.'), title: 'Langhaus Winterlicht' },
    { ...typeEntry('burg-tiefenfels', 'castle_compact', 'dwarven', 1, 'Zwergenstil auf einer kompakten Burg: dunkler Stein, Mauerring und Burghof.'), title: 'Burg Tiefenfels' },
    { ...typeEntry('erdhaus-elbenhain', 'hobbit', 'elven', 2026, 'Ein großes Erdhaus im Elfenstil, halb verborgen im Hügel.', 'L'), title: 'Erdhaus Elbenhain' },
    { ...typeEntry('wachturm-verfallen', 'watchtower', 'ruin', 2026, 'Ein Wachturm mit Ruinen-Theme und erodierter Silhouette.'), title: 'Verfallener Wachturm' },
    {
      id: 'base-mauerring', title: 'Komplette Base', blurb: 'Taverne, Schmiede und Bibliothek hinter Mauern, mit Feld und Garten.', kind: 'Base', seed: 2026,
      build: () => { const b = completeBase('1.21.11', 'medieval'); return { project: b.project, world: generateBase(b.project, ctx, { ...b.options, exterior: {} }) }; },
    },
    {
      id: 'gehoeft-wiesental', title: 'Gehöft', blurb: 'Ein Wohnhaus mit Brunnenhof, Koppel, Obstgarten und Feld.', kind: 'Base', seed: 2026,
      build: () => { const b = homesteadBase('1.21.11', 'rustic'); return { project: b.project, world: generateBase(b.project, ctx, { ...b.options, exterior: {} }) }; },
    },
    // W16-A: Zweistöcker über den Bautyp `twostory` wie Golden und App (mit W13-A-Werkstatt), nicht mehr über die alte
    // Beispiel-Vorlage `twoStoryHouse`; Seed aus der Seed-Wahl (Theme medieval), die anderen Themes gleich
    ...(['medieval', 'nordic', 'timber'] as const).map((theme): GalleryEntry => ({
      ...typeEntry(`haus-${theme}`, 'twostory', theme, 2026, 'Taverne, Küche, Bibliothek und Alchemie auf zwei Etagen, dazu die Werkstatt.'),
      kind: 'Haus',
    })),
  ];
}

/**
 * Fingerabdruck eines Baus: sha256 über die **entpackte** `.nbt`-Struktur (Blöcke, Palette, Größe; ohne Datum und
 * ohne gzip-Kopf, also unabhängig von Uhrzeit und zlib-Version). Ändert sich ein Block, ändert sich der Wert.
 */
export function buildDigest(nbtGzip: Uint8Array): string {
  return createHash('sha256').update(gunzipSync(nbtGzip)).digest('hex').slice(0, 16);
}

/** `.nbt` eines Export-Volumens (wie die Galerie-Datei) – Grundlage von {@link buildDigest}. */
export const nbtOf = (ev: Parameters<typeof exportFile>[1]): Uint8Array => exportFile('nbt', ev);
