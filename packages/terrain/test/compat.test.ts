/**
 * Bitgleichheit (Auftrag T2): Ohne die neuen Optionen (Wegprofil, Zaunpfosten, Hecken, Licht, Deko, neue Zonen,
 * Vorlage) liefert der Generator exakt das Ergebnis von vor dem Gelände-Feinschliff. Die Prüfsummen stammen aus
 * dem Stand VOR T2 (SHA-1 über ein JSON aller Ergebnisfelder: Zellen, Höhen, Oberflächen, Wege, Felder, Bäume …).
 *
 * **Bewusst erneuert am 24.09.2026 (research/37/38):** Die fünf Katalog-Geländestile nutzen jetzt die
 * Streuungsregeln aus research/30 K6 – harte Schwellen (`threshold`, Blumen in Flecken, dichtere Waldkante),
 * echte Hügel (Amplitude 7 statt 5) und `keepFree` (Wege und Türvorfelder bleiben garantiert frei). Der
 * Testkörper (`test`, `plinth`, `structures`, `sculpted`) ist unverändert; neu erzeugt mit
 * `PRINT_TERRAIN_HASHES=1 npx vitest run packages/terrain/test/compat.test.ts`.
 *
 * **Erneut erneuert am 24.09.2026 (Nebenweg-Takt, research/44 §4.1):** `meadow`, `forest` und `hills` setzen den
 * Lampen-Takt jetzt **je Rang** (`every: { main: 8, side: 12 }`) – vorher lag der Nebenweg bei 7–16 Blöcken ohne
 * Laterne. Betroffen sind nur Stile mit Wege-Beleuchtung (`sculpted` nutzt `meadow`); `test`, `plinth`,
 * `structures`, `bare`, `farmland` bleiben unverändert. Neu erzeugt mit
 * `PRINT_TERRAIN_HASHES=1 npx vitest run packages/terrain/test/compat.test.ts`.
 *
 * **Q3 bewusst erneuert (research/58 §Q3, research/56 §3–4):** Die fünf Katalog-Geländestile streuen Bodenpflanzen
 * jetzt als **Flecken** (dichter Kern, ausgedünnter Rand, `ground.clusters`) und setzen in der freien Landschaft
 * **Katalog-Objekte** (`landscape`; Fels im Hügelland, Bäume am Waldrand, Blumen auf der Wiese). Gemessen wird
 * deshalb mit **Katalog** (die Katalog-Stile samt `sculpted` und `bare`); der synthetische Testkörper (`test`,
 * `plinth`, `structures`) bleibt **ohne** Katalog und ohne `clusters` und damit bitgleich – er belegt, dass die
 * neuen Felder additiv sind. Neu erzeugt mit
 * `PRINT_TERRAIN_HASHES=1 npx vitest run packages/terrain/test/compat.test.ts`.
 *
 * **Erneut erneuert am 24.09.2026 (Wegbeleuchtung, research/37/38):** `meadow`, `forest` und `hills` haben jetzt
 * `lighting: { mode: "paths", every: 8 }` – vorher stand der Hauptweg dort 29–43 Blöcke ohne Laterne. Der
 * synthetische Testkörper (`test`) bleibt **unverändert**, weil der Standard weiterhin `none` ist: die Änderung
 * hängt an den Katalogstilen, nicht am Generator.
 *
 * **W1-I (26.09.2026): Gelände entrümpelt (plan/spikes/W1E_ergebnisqualitaet.md M1, Bericht
 * plan/spikes/W1I_katalog_optik.md).** Katalog statt Generator: `meadow` ohne freie Landschaft (vorher Beet-Klötze
 * `outdoor/flower_cluster` mit Erdlage auf dem Gras), weniger und gruppierte Bäume, weniger Einzelbüsche, Vorplatz
 * vor der Tür 5 frei, Wegprofil (Zufahrt 2 breit); `hills` mit halb so vielen Steinen (0,60 → 0,25), Wegprofil und
 * Vorplatz. Dazu die Zonen-Pools: freistehende Tore (`fence_gate_*`), zufällige zweite Brunnen (`well_*`), Komposter
 * und Bienenstock-Beete im Hof sind nicht mehr in `yard`/`garden`/`plaza`/`paddock`, das Blumenbeet ist ein
 * eingefasstes Hochbeet nur noch im Garten. Weil der Testkörper (`fullSite`) Hof, Garten und Wiese als Zonen hat,
 * ändern sich deshalb auch `forest` und `farmland` (nur Zonen-Objekte, die Stile selbst sind unverändert); `bare` und
 * `sculpted` bauen auf `hills` bzw. `meadow` auf. `test`, `plinth` und `structures` (ohne Katalog) bleiben bitgleich.
 * Neu erzeugt mit `PRINT_TERRAIN_HASHES=1 npx vitest run packages/terrain/test/compat.test.ts`.
 *
 * **W3 (27.09.2026): Grundstücks-Module (Bericht plan/spikes/W3GA_grundstueck.md, Baustandard G1).** Neue, additive
 * Stil-Felder (`trees.groups`, `ground.near`, `landscape.near`, `paths.profile.bulge`, `fences.lanterns`/`street`,
 * `lighting.entry`, `decor.kits`) sind in `meadow` und `hills` (und `homestead`, ohne eigene Summe) eingeschaltet;
 * damit ändern sich `meadow`, `hills`, `sculpted` und `bare`. Bitgleich bleiben `test`, `plinth`, `structures` (ohne
 * die Felder) sowie `forest` und `farmland` (Stile ohne die Felder) – der Beleg, dass die Felder additiv sind.
 * Dazu (Übergabe W3-EN) eine Regel ohne Schalter: der Laufweg vor jeder Außentür wird nicht mehr als Traufstreifen
 * abgesenkt (Mulde vor der Stufe) – das ändert nur `plinth` (Testkörper mit Sockel).
 *
 * **W4 (27.09.2026): Zäune und Grundstück-Feinschliff (Bericht plan/spikes/W4A_zaeune.md).** Neue, additive
 * Stil-Felder (`fences.logEvery`, `fences.streetSpan`, `trees.groups.max`, `paths.profile.forecourt`,
 * `paths.profile.steppingAll`) sind in `meadow`, `hills`, `homestead` und dem neuen Stil `cottage` eingeschaltet; damit
 * ändern sich `meadow`, `hills` und `sculpted`. Bitgleich bleiben `test`, `plinth`, `structures`, `forest`, `farmland`
 * und `bare` (ohne Gebäude keine Tür, also kein Vorplatz).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CellSet, key3 } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateSite, type BuildingInfo, type SiteResult, type SiteState, type SiteStructures, type TerrainStyleDef } from '../src/index.js';
import { TEST_STYLE, fullSite, syntheticBuilding } from './fixtures.js';
import { DATA_VERSION_1_21_11, loadCatalog, loadStyles } from './helpers.js';

const styles = loadStyles();
/** Komponenten-Katalog für die Katalog-Stile (Q3): nur damit erscheinen die Gelände-Objekte der Außenzonen. */
const catalog = loadCatalog();
const withCatalog = { catalog, dataVersion: DATA_VERSION_1_21_11 };

function dump(r: SiteResult): string {
  return JSON.stringify({
    cells: r.cells, top: [...r.top], surface: r.surface, bottom: r.bottom, paths: r.paths.toArray(), doorExits: r.doorExits,
    fields: r.fields, trees: r.trees, bushes: r.bushes, groundPlants: r.groundPlants, warnings: r.warnings,
  });
}

const hash = (site: SiteState, style: TerrainStyleDef, building?: BuildingInfo, structures?: SiteStructures, options?: { catalog: typeof catalog; dataVersion: number }): string =>
  createHash('sha1').update(dump(generateSite(site, style, building, structures, options))).digest('hex');

function withPlinth(): BuildingInfo {
  const b = syntheticBuilding();
  const ring = CellSet.rect(-1, -1, 11, 9).difference(b.footprint).difference(CellSet.of([[5, -1]]));
  const occupied = new Set(b.occupied);
  for (const [x, z] of ring) occupied.add(key3([x, b.y0, z]));
  return { ...b, occupied, profile: ring, plinth: ring };
}

const EXPECTED: Readonly<Record<string, string>> = {
  test: 'af56ed37d136d7f61a7dbe7df329c57e90d79878',
  // W9-G3 (2026-09-27): Grund – Feld-Modul mit Komposter UND Heuhaufen, ab 160 Zellen Handkarren am Feldrand
  // (`ZONE_KITS.field`, Review R5 G3 Hof-Details; vorher W5 6e33d42a…)
  // W5 (27.09.2026): Eckpfosten der schlanken Zaunlinie aus Zaun 2 hoch statt Stumpf mit Stammfuß (Review W4-R N10)
  // (vorher W4 136e9ed3…: schlanke Zaunlinie `fences.logEvery`, Vorgartenzaun, Bäume je Grundstück, Vorplatz)
  meadow: 'fbf460561e18c6b580d0cd5762b535e65398d06c',
  // W2 (26.09.2026): Regel G1 – Landschaft 0,70 → 0,2, ohne tote Bäume (vorher W1-I: nur Zonen-Pools)
  forest: 'f1499b52c90a03732f6191db6d6de37308b9341e',
  // W4 (27.09.2026): Vorplatz als Pflaster aus einer Rolle (`profile.forecourt`, Review M3) (vorher W3 8466fdb8…)
  hills: '418c04ae8e579be3551135ac85f3f8037eabee27',
  // W1-I (26.09.2026): Stil unverändert, nur die Zonen-Pools (Tore, Brunnen, Beete, Komposter)
  farmland: '8514bd9a087924a90b5f74a5b875ef21677105d0',
  // W3 (27.09.2026, Übergabe W3-EN): Laufweg vor der Tür (bis padWidth + 1, je Spur bis zum Sockel) nicht abgesenkt, gepflastert – keine Mulde
  plinth: 'a3ecca34d69abdfb6e467431f6f19a0141fc531b',
  structures: '0ec20113dfab7ee647af46144d83bf211d481096',
  // W9-G3 (2026-09-27): Grund – wie meadow (Feld-Modul Heuhaufen/Handkarren; vorher W5 a97ebe94…)
  // W5 (27.09.2026): wie meadow (Eckpfosten aus Zaun; vorher W4 4db124bc…)
  sculpted: '904864966ce9fbd4318181beb568787b38105dcf',
  // W3 (27.09.2026): wie hills (Stil hills ohne Gebäude)
  bare: '46d5b5bc08dce6fc32f297e63534acfc9a4e369c',
};

function actual(): Record<string, string> {
  const b = syntheticBuilding();
  const out: Record<string, string> = { test: hash(fullSite().state, TEST_STYLE, b) };
  for (const id of ['meadow', 'forest', 'hills', 'farmland']) out[id] = hash(fullSite(7).state, styles.get(id)!, b, undefined, withCatalog);
  out['plinth'] = hash(fullSite().state, TEST_STYLE, withPlinth());
  const ring = CellSet.rect(-3, -3, 13, 11).difference(CellSet.rect(-1, -1, 11, 9));
  out['structures'] = hash(fullSite().state, TEST_STYLE, syntheticBuilding(0), { footprint: ring, passages: CellSet.rect(4, -3, 6, -1) });
  const s = fullSite(3);
  s.reroll();
  s.sculpt('raise', CellSet.rect(-19, 3, -17, 5), 6);
  s.flatten(CellSet.rect(0, 20, 4, 24), -5);
  out['sculpted'] = hash(s.state, styles.get('meadow')!, b, undefined, withCatalog);
  out['bare'] = hash(fullSite(9).state, styles.get('hills')!, undefined, undefined, withCatalog);
  return out;
}

describe('Bitgleichheit ohne neue Optionen (Stand vor T2)', () => {
  it('Testgelände, alle Katalog-Stile, Sockel, Bauwerke, Terraforming, ohne Gebäude', { timeout: HEAVY_TIMEOUT }, () => {
    const got = actual();
    if (process.env['PRINT_TERRAIN_HASHES'] !== undefined) console.log(JSON.stringify(got, null, 2));
    expect(got).toEqual(EXPECTED);
  });
});
