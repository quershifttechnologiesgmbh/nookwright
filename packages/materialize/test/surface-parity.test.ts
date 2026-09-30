/**
 * Bitgleichheit (F1): Prüfsummen der Hüllen-Materialisierung aller bestehenden Themes, angelegt VOR dem Fachwerk-Muster.
 * Neue Schema-Felder (Wandregeln mit `timber`, `storey`/`topStorey`, Wandfuß `along`) und neue Themes dürfen an
 * Themes ohne sie nichts ändern. Nur die Hülle (keine Einrichtung), damit Katalog-Änderungen anderer die Summen
 * nicht verschieben.
 *
 * **Bewusst erneuert am 24.09.2026 (research/30 K2, Blender-Recherche):** `decor.weathering.fade` (ausgefranste
 * Moos-/Rissränder) und `gradient.interpolate: "ease"` an `wall_primary`/`wall_secondary` ändern das Bild gewollt;
 * beide Sätze wurden erneut mit `PARITY_PRINT=1` erzeugt.
 *
 * **Bewusst erneuert am 24.09.2026 (research/30 K1, Blender-Recherche):** Die vier großen Stein-/Erdrollen
 * (`wall_primary`, `foundation`, `floor_stone`, `floor_earth`) nutzen jetzt `noise.type: "cells"` – Blender-Vorbild
 * Voronoi, Flecken mit **harter Kante** statt weicher `cluster`-Flecken. Das ändert das Bild gewollt; alle 78 Summen
 * wurden mit `PARITY_PRINT=1 npx vitest run packages/materialize/test/surface-parity.test.ts` neu erzeugt. Ohne
 * `cells` (also mit `cluster`) sind die alten Werte wieder gültig.
 *
 * **Bewusst erneuert am 26.09.2026 (W2, Baustandard):** Regeln W4/W5/W6/W7/D1/D3/W3/I1/I3 (W2-FC: Materialbudget,
 * Fassadenverlauf `facade_h`, Geschossband/Außenhaut, Sockel, Deckungsrezept in ganzen Ringen, Eckregel, keine
 * Verwitterung auf Wänden mit Raum, Decke ≠ Boden) und die K8-Reparatur (Rauschfeld je Fläche) ändern alle drei Themes
 * gewollt; zusammen mit W2-FB (Dach D2–D4/D6/D8: Traufanschluss, Windbrett am steilen Ortgang, Giebelrolle `wall_gable`,
 * Sohlbalken, Kappung, Flachdach-Gesims; Folgeauftrag: gewählte Neigung gilt genau) und W2-FA (Außenhaut `skin`,
 * Fassadenraster) alle Summen mit `PARITY_PRINT=1` neu erzeugt.
 *
 * **Bewusst erneuert am 27.09.2026 (W4, Review W3 S5/M4/M5/M6, `plan/spikes/W4G_material2.md`):** Fachwerk ohne
 * Schachbrett (Streben erst ab Feld 3 × 4, kein Doppelständer, Gaubenwangen machen keine Pfeilerspalten), Holzwände mit
 * dunklem Fuß nur als ganze Reihe (`quantize: "ring"`), nordisches Dach dunkle Eiche mit Eichen-Kante (D9), Dielen je
 * Brett (`noise.boards`), Lager im EG mit Dielen statt Lehm. Summen mit `PARITY_PRINT=1` neu erzeugt.
 * **Zusätzlich erneuert am 27.09.2026 (W4-F, plan/spikes/W4F_dachproportion.md; beim Merge mit W4-G/W4-E gemeinsam
 * neu gemessen):** 30 Summen des zweistöckigen
 * Fachwerkhauses (Satteldach-Familie ohne Walm/Mansarde): Ortgang-Unterseite endet über der Traufunterkante, Okulus-Ecken
 * Giebelwand statt Treppe, Fensterrahmen nie vor Glas (der Kniestock greift bei zwei Geschossen nicht). Beispielhaus und
 * Zweistöcker ohne Details unverändert. Neu erzeugt mit `PARITY_PRINT=1`.
 * **Erneuert am 27.09.2026 (W5, Review W4-R N1/N7, `plan/spikes/W5A_fassade.md`):** die 54 Summen des Fachwerkhauses
 * (alle 9 Dachformen × 3 Themes × 2 Versionen): Eckquader laufen bis zur Traufunterkante (Deckenring-Ecke als Quader-
 * Pfeiler, auch unter dem Flachdach) und D5 für Mehrgeschosser (Kniestock, wo das Dach höher als 1,5 × Wand wäre).
 * Beispielhaus und Zweistöcker (ohne Eckquader) unverändert. Neu erzeugt mit `PARITY_PRINT=1` (Konsole:
 * `--silent=false --disableConsoleIntercept`).
 * **Erneuert am 27.09.2026 (W5, Review W4-R N5, `plan/spikes/W5B_burg.md`; nach dem Merge mit W5-A gemeinsam gemessen):**
 * nordic – Dachkante Fichte statt Eiche (kein „gerahmtes Bild“), Krone aus Stämmen mit Rinde, Wehrgang/Plattform aus
 * Eiche (D9 Bauwerk). Nur nordic neu erzeugt (`PARITY_PRINT=1`), medieval und rustic wie W5-A.
 * W9-G3 (2026-09-27): Grund – rustic bekommt Typ-Identität fürs Bauernhaus (Review R5 G3, `plan/spikes/W9G3_bauernhaus.md`):
 * Dach dunkle Eiche statt Fichte (Wand/Dach-Abstand), Kante Fichte, Ständer/Balken Fichte, Giebelfeld Putz über die
 * Wandregeln (`wall_plaster`) statt `wall_gable` Fichte, Eckquader Fichtenstamm, unterste Außenwandreihe Bruchstein (Steinsockel). Nur rustic neu erzeugt
 * (`PARITY_PRINT=1 … -t rustic`), medieval und nordic unverändert.
 *
 * **Erneuert am 27.09.2026 (W9-G5, Review R5 G5 „Materialspiel“, `plan/spikes/W9G5_materialspiel.md`):** medieval –
 * stärkerer Wandverlauf (Bruch-Tiefenschiefer am Fuß, mehr Andesit oben), Dach in drei Ringtönen (Fliesen, Ziegel, am
 * First Bruch-Tiefenschiefer, 6 % Flecken des Nachbartons `gradient.patch`) und `roof_t` je zusammenhängender
 * Dachfläche. Nur medieval neu erzeugt (`PARITY_PRINT=1`);
 * nordic und rustic unverändert (eigene Wand- und Dachrollen, je eine Dachfläche).
 *
 * W12-D (2026-09-28): Grund – nordic wird Blockbau (Review R6-6 „einfarbiges Holz“, `plan/spikes/W12D_nordisch.md`):
 * Wandregeln (unterste Außenreihe Bruchstein, Schwellbalken dunkle Eiche, liegende entrindete Stämme in drei Tönen je
 * Stammstück), Giebel als senkrechte Bretter in drei Tönen (`noise.boardAxis: "b"`), Balken dunkle Eiche, Eckquader
 * Bruchstein, Fensterrahmen dunkle Eiche, Läden Fichte, Schlot Bruchstein, Dach Tiefenschieferfliesen mit geteertem
 * Traufdrittel in dunkler Eiche (ganze Ringe). Nur die 26 nordic-Summen neu erzeugt (`PARITY_PRINT=1 … -t nordic`);
 * medieval und rustic unverändert.
 *
 * W13-E (2026-09-28): Grund – das Giebelfenster „Okulus“ (Glas im Plus) las sich im blinden A/B-Test als Kreuz
 * (Projektregel: keine Kreuz-/Windradformen); jetzt Drillingsfenster 3 × 2 bzw. Band 3 × 1 (`roof-finish.ts`). Neu
 * erzeugt (`PARITY_PRINT=1`) nur die Summen mit Okulus-Giebel: 6 von 78, alle anderen unverändert.
 * W13-B (2026-09-28): Grund – nordic bekommt das Torfdach (`decor.turfRoof`, `plan/spikes/W13B_nordisch_dach.md`):
 * Gras-/Moossoden auf der Dachhaut, angehobene Ortgangtreppen, Firstplatte als Soden. Der Seed dieser Szenarien (2026)
 * wählt Torf (Anteil 0,75). Nur die 26 nordic-Summen neu erzeugt (`PARITY_PRINT=1 … -t nordic`), je Zeile „vorher X“;
 * mit `turfRoof: false` gelten die W12-D-Summen weiter. medieval und rustic unverändert.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type RoofStyle, type ShellOptions } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { materialize } from '../src/index.js';
import { VERSIONS, platformView, themes } from './fixtures.js';

type Layout = 'sample' | 'twostory' | 'timber';

function project(layout: Layout): Project {
  const p = Project.create({ id: 'p', name: 'P', seed: 2026, themeId: 'medieval', targetVersion: PROJECT_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
  const rect = (f: number, x1: number, z1: number, x2: number, z2: number, t: string): void => {
    p.paintRoom(f, CellSet.rect(x1, z1, x2, z2), t);
  };
  if (layout === 'timber') {
    // Vorlage „Fachwerkhaus“ der App (packages/app/src/templates.ts)
    p.addFloor();
    rect(0, 0, 0, 9, 6, 'solar');
    rect(0, 10, 0, 16, 6, 'kitchen');
    rect(0, 0, 7, 16, 11, 'storage');
    rect(1, 0, 0, 8, 6, 'bedroom');
    rect(1, 9, 0, 16, 6, 'study');
    rect(1, 0, 7, 16, 11, 'guest_room');
    p.placeStairs(0, [3, 10], 'east');
    return p;
  }
  rect(0, 0, 0, 8, 6, 'kitchen');
  rect(0, 9, 0, 14, 6, 'bedroom');
  rect(0, 0, 7, 14, 11, 'storage');
  rect(0, 15, 0, 22, 11, 'smithy');
  if (layout === 'twostory') {
    p.addFloor();
    rect(1, 0, 0, 8, 6, 'bedroom');
    rect(1, 9, 0, 14, 6, 'alchemy');
    rect(1, 0, 7, 14, 11, 'library');
    p.placeStairs(0, [3, 10], 'east');
  }
  return p;
}

const FULL: Omit<ShellOptions, 'roof'> = {
  overhang: 1,
  roofDetail: { pitch: 'steep', trim: true, verge: 'closed', gableWindows: true },
  facade: { plinthProfile: true, cornice: true, quoins: true, pilasters: 4, brackets: 3 },
};

const ROOFS: readonly RoofStyle[] = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];

/** Szenarien: Fachwerkhaus mit allen 9 Dachformen und vollem Außenprofil, Beispielhaus und Zweistöcker schlicht. */
export const PARITY_SCENARIOS: ReadonlyArray<{ readonly name: string; readonly layout: Layout; readonly options: ShellOptions }> = [
  ...ROOFS.map((roof) => ({ name: `timber/${roof}`, layout: 'timber' as const, options: { roof, ...FULL } })),
  ...(['hip', 'gable'] as const).flatMap((roof) => [
    { name: `sample/${roof}`, layout: 'sample' as const, options: { roof } },
    { name: `twostory/${roof}`, layout: 'twostory' as const, options: { roof } },
  ]),
];

/** FNV-1a über alle Blöcke (Position, Name, Properties) in Volumen-Reihenfolge. */
function checksum(text: Iterable<string>): string {
  let h = 0x811c9dc5;
  for (const line of text) {
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 10;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function paritySum(layout: Layout, options: ShellOptions, themeId: string, version: string): string {
  const p = project(layout);
  const shell = deriveShell(p.state, options);
  const r = materialize({
    shell, placements: [], theme: themes.get(themeId), platform: platformView(version), seed: 2026,
    roomTypes: Object.fromEntries(p.state.rooms.map((x) => [x.id, x.roomTypeId])),
  });
  return checksum((function* () {
    for (const c of r.volume.cells()) yield `${c.pos.join(',')}=${c.state.name}${JSON.stringify(c.state.properties)}`;
  })());
}

/**
 * Stand vor F1 (Themes medieval, nordic, rustic; beide Zielversionen).
 * W4 (27.09.2026): W4-E Dachraum-Licht (Laternen auf dem Dachboden aller geneigten Dächer) + W4-G (Fachwerk, Holzwand-Fuß,
 * nordisches Dach, Dielen je Brett, Lager-Boden; siehe Kopf) – zusammen gemessen mit `PARITY_PRINT=1`.
 */
const EXPECTED: Readonly<Record<string, string>> = {
  'medieval|1.21.11|timber/flat': 'b4cb6a5b',
  'medieval|1.21.11|timber/hip': '3802e714',
  'medieval|1.21.11|timber/gable': '330fb873',
  'medieval|1.21.11|timber/shed': '588d8803',
  'medieval|1.21.11|timber/half_hip': '7682f399',
  'medieval|1.21.11|timber/dutch_gable': '581893a6',
  'medieval|1.21.11|timber/mansard': '63825f46',
  'medieval|1.21.11|timber/gambrel': '2b0775cd',
  'medieval|1.21.11|timber/saltbox': '176dd4a6',
  'medieval|1.21.11|sample/hip': '0fe0803e',
  'medieval|1.21.11|twostory/hip': 'a4544bf8',
  'medieval|1.21.11|sample/gable': 'd69d4efd',
  'medieval|1.21.11|twostory/gable': 'fa5d2413',
  'nordic|1.21.11|timber/flat': '8eb41266', // W13-B (2026-09-28): Torfdach, vorher 106fb9d1
  'nordic|1.21.11|timber/hip': '4932b93c', // W13-B (2026-09-28): Torfdach, vorher 70dae127
  'nordic|1.21.11|timber/gable': '37e0afb3', // W13-B (2026-09-28): Torfdach, vorher 6d1802b4
  'nordic|1.21.11|timber/shed': 'fadc2265', // W13-B + W13-E Runde 2 (2026-09-28): Torfdach und Giebelfenster ohne Plus, vorher 75f72109
  'nordic|1.21.11|timber/half_hip': '7fbca1ee', // W13-B (2026-09-28): Torfdach, vorher 5692b5e4
  'nordic|1.21.11|timber/dutch_gable': 'c9d9986f', // W13-B (2026-09-28): Torfdach, vorher b47e4765
  'nordic|1.21.11|timber/mansard': '5e4d3a24', // W13-B (2026-09-28): Torfdach, vorher a70c5b32
  'nordic|1.21.11|timber/gambrel': 'f21edd33', // W13-B (2026-09-28): Torfdach, vorher 766afffc
  'nordic|1.21.11|timber/saltbox': '0e58fa90', // W13-B (2026-09-28): Torfdach, vorher c1b31d0c
  'nordic|1.21.11|sample/hip': '07e2fde4', // W13-B (2026-09-28): Torfdach, vorher 3f97f0d3
  'nordic|1.21.11|twostory/hip': 'b781f0e1', // W13-B (2026-09-28): Torfdach, vorher 527cd491
  'nordic|1.21.11|sample/gable': 'cb1d8234', // W13-B (2026-09-28): Torfdach, vorher 379a5eb1
  'nordic|1.21.11|twostory/gable': '1dce512d', // W13-B (2026-09-28): Torfdach, vorher e5d0048d
  'rustic|1.21.11|timber/flat': '4c91910c',
  'rustic|1.21.11|timber/hip': 'fe213704',
  'rustic|1.21.11|timber/gable': '637ef63e',
  'rustic|1.21.11|timber/shed': 'a75b4d2c',
  'rustic|1.21.11|timber/half_hip': '3e8dbc7c',
  'rustic|1.21.11|timber/dutch_gable': '19b23f97',
  'rustic|1.21.11|timber/mansard': '942c53a7',
  'rustic|1.21.11|timber/gambrel': '187a2113',
  'rustic|1.21.11|timber/saltbox': 'dca15fbd',
  'rustic|1.21.11|sample/hip': '53a5df2f',
  'rustic|1.21.11|twostory/hip': '403d7d89',
  'rustic|1.21.11|sample/gable': 'e2a6cea7',
  'rustic|1.21.11|twostory/gable': 'dca0d3ea',
  'medieval|26.3|timber/flat': 'b4cb6a5b',
  'medieval|26.3|timber/hip': '3802e714',
  'medieval|26.3|timber/gable': '330fb873',
  'medieval|26.3|timber/shed': '588d8803',
  'medieval|26.3|timber/half_hip': '7682f399',
  'medieval|26.3|timber/dutch_gable': '581893a6',
  'medieval|26.3|timber/mansard': '63825f46',
  'medieval|26.3|timber/gambrel': '2b0775cd',
  'medieval|26.3|timber/saltbox': '176dd4a6',
  'medieval|26.3|sample/hip': '0fe0803e',
  'medieval|26.3|twostory/hip': 'a4544bf8',
  'medieval|26.3|sample/gable': 'd69d4efd',
  'medieval|26.3|twostory/gable': 'fa5d2413',
  'nordic|26.3|timber/flat': '8eb41266', // W13-B (2026-09-28): Torfdach, vorher 106fb9d1
  'nordic|26.3|timber/hip': '4932b93c', // W13-B (2026-09-28): Torfdach, vorher 70dae127
  'nordic|26.3|timber/gable': '37e0afb3', // W13-B (2026-09-28): Torfdach, vorher 6d1802b4
  'nordic|26.3|timber/shed': 'fadc2265', // W13-B + W13-E Runde 2 (2026-09-28): Torfdach und Giebelfenster ohne Plus, vorher 75f72109
  'nordic|26.3|timber/half_hip': '7fbca1ee', // W13-B (2026-09-28): Torfdach, vorher 5692b5e4
  'nordic|26.3|timber/dutch_gable': 'c9d9986f', // W13-B (2026-09-28): Torfdach, vorher b47e4765
  'nordic|26.3|timber/mansard': '5e4d3a24', // W13-B (2026-09-28): Torfdach, vorher a70c5b32
  'nordic|26.3|timber/gambrel': 'f21edd33', // W13-B (2026-09-28): Torfdach, vorher 766afffc
  'nordic|26.3|timber/saltbox': '0e58fa90', // W13-B (2026-09-28): Torfdach, vorher c1b31d0c
  'nordic|26.3|sample/hip': '07e2fde4', // W13-B (2026-09-28): Torfdach, vorher 3f97f0d3
  'nordic|26.3|twostory/hip': 'b781f0e1', // W13-B (2026-09-28): Torfdach, vorher 527cd491
  'nordic|26.3|sample/gable': 'cb1d8234', // W13-B (2026-09-28): Torfdach, vorher 379a5eb1
  'nordic|26.3|twostory/gable': '1dce512d', // W13-B (2026-09-28): Torfdach, vorher e5d0048d
  'rustic|26.3|timber/flat': '4c91910c',
  'rustic|26.3|timber/hip': 'fe213704',
  'rustic|26.3|timber/gable': '637ef63e',
  'rustic|26.3|timber/shed': 'a75b4d2c',
  'rustic|26.3|timber/half_hip': '3e8dbc7c',
  'rustic|26.3|timber/dutch_gable': '19b23f97',
  'rustic|26.3|timber/mansard': '942c53a7',
  'rustic|26.3|timber/gambrel': '187a2113',
  'rustic|26.3|timber/saltbox': 'dca15fbd',
  'rustic|26.3|sample/hip': '53a5df2f',
  'rustic|26.3|twostory/hip': '403d7d89',
  'rustic|26.3|sample/gable': 'e2a6cea7',
  'rustic|26.3|twostory/gable': 'dca0d3ea',
};

const PARITY_THEMES = ['medieval', 'nordic', 'rustic'] as const;

describe('Bitgleichheit der bestehenden Themes (Prüfsummen vor F1)', () => {
  for (const version of VERSIONS) {
    for (const themeId of PARITY_THEMES) {
      it(`${themeId} / ${version}`, () => {
        const got: Record<string, string> = {};
        for (const s of PARITY_SCENARIOS) got[`${themeId}|${version}|${s.name}`] = paritySum(s.layout, s.options, themeId, version);
        if (process.env['PARITY_PRINT'] === '1') console.log(JSON.stringify(got, null, 2));
        else for (const [k, v] of Object.entries(got)) expect(v, k).toBe(EXPECTED[k]);
      }, HEAVY_TIMEOUT);
    }
  }
});
