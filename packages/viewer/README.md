# @mcda/viewer – Vorschau mit echten Blockmodellen

3D-Vorschau eines Voxel-Volumens über deepslate (MIT): Blockmodelle, Texturatlas und Minecraft-Licht
(`createLitRenderer`). Mojang-Daten kommen nur über den Port `ViewerResources` von außen, aus `local/mc-assets/<version>/`
(erzeugt mit `npx tsx packages/viewer/scripts/extract-assets.ts` aus dem eigenen `local/mc-client/<version>/client.jar`).
Nichts davon wird eingecheckt oder verteilt (HANDOFF §1).

## Goldene Galerie (P0-A)

Werkzeug für die Sichtprüfung jeder Qualitätsänderung: Es rendert eine feste Menge Bauten mit echten Texturen aus
festen Kameras und vergleicht Läufe Bild für Bild. Bericht: `plan/spikes/P0A_goldene_galerie.md`.

```bash
# einmalig: playwright-core + Chromium (nicht im Repo), z. B. nach local/tools
npm i --prefix local/tools playwright-core && npx --prefix local/tools playwright-core install chromium

npm run golden -- --run vorher                  # goldene Menge mit dem aktuellen Generator
# … Änderung am Generator …
npm run golden -- --run nachher
npm run golden:compare -- vorher nachher        # → local/golden/compare-vorher-nachher/index.html

npm run golden -- --nbt local/golden-bisect/<commit>   # Welten eines alten Commits (.nbt)
npm run golden -- --only tavern,hall-nordic --views fassade,innen
```

- **Goldene Menge** (`golden/set.json5`): alle Bautypen des Katalogs in Größe M, Standard-Theme (`themes[0]`, feste
  Vorlagen `medieval`), Seed 2026, Gelände wie Assistent und Galerie (`projectFromBuildingType` + `generateBase`),
  dazu je Bautyp eine Theme-Variante. ID je Bau `<bautyp>-<theme>`; unter diesem Namen erwartet `--nbt` die Dateien.
  Ein Test prüft, dass jeder Bautyp des Katalogs darin steht.
- **Ein Weg für alle Quellen:** Der Generator-Weg schreibt die Welt als `.nbt` in den Lauf und rendert aus genau diesen
  Bytes – wie für Dateien alter Commits. Analyse und Kameras hängen nur von den Blöcken ab (`golden/lib/analyze.ts`),
  gleiche Welt → gleiche Bilder.
- **Ansichten je Bau:** `fassade-n|o|s|w` (parallel, frontal, nur der Bau), `hero-so|nw` (ganze Welt schräg),
  `nah-ecke` (Außenecke Südost), `nah-traufe` (Traufe/Ortgang Südwest), `nah-eingang` (Haupttür), je Etage
  `schnitt-k` (Draufsicht, Schnitt über der Etage, Tageslicht) und `innen-k` (Augenhöhe im größten beleuchteten Raum).
  Mittag, Helligkeit 50 %, klare Luft, 1280 × 800.
- **Ausgabe:** `local/golden/<lauf>/` (git-ignoriert, die Bilder enthalten Mojang-Texturen): `<id>/<ansicht>.png`,
  Miniaturen, `nbt/<id>.nbt`, `manifest.json` (Commit, Zeit, Parameter, Blockzahlen, Prüfsumme je Welt, Analyse,
  Kameras) und `index.html` (Kontaktbogen: je Bau eine Zeile, Klick → groß, Pfeiltasten blättern, Filter je Gruppe).
- **Vergleich:** Pixel verändert, wenn ein Kanal um mehr als 16/255 abweicht (`--threshold`); Seite sortiert nach
  größter Änderung, A/B/Differenz umschaltbar (Leertaste, 1/2/3).
- **Umgebung:** `PLAYWRIGHT_CORE` (Ordner von playwright-core, sonst `local/tools/node_modules/playwright-core`),
  `MCDA_LOCAL_DIR` (statt `local/`; in Git-Worktrees gilt sonst das `local/` des Haupt-Checkouts), `GOLDEN_GL`
  (`metal` Standard auf macOS, `swiftshader` für Software-Rendering). Server nur auf 127.0.0.1, Ports 5195–5199.
- **Code:** reine Teile in `golden/lib/` (Raster, Analyse, Kameras, Szene, Vergleich, HTML; Tests
  `test/golden-*.test.ts`), Node-Adapter in `golden/node/`, Browser-Seite `golden/browser/harness.ts` (mit esbuild
  gebündelt). Der Renderer bekam dafür additiv `setProjection` (Parallelprojektion, eigener Öffnungswinkel) und
  `renderNow`; ohne Aufruf bleibt er unverändert.
