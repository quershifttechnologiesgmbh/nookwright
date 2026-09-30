# Website

Die Produkt-Website als **eine App**: Startseite mit 3D-Scroll-Story und Beschreibungsfeld, **der echte Editor**
(`packages/app`) eingebettet im iframe, **KI-Architekt** (Beschreibung → Bauplan über das Entscheidungsmodell JEV),
**Galerie** generierter Bauten mit 3D-Viewer und Downloads, Roadmap und die üblichen Unterseiten (Über uns, Presse,
Kontakt, Impressum, Datenschutz, Nutzungsbedingungen).

## Bauen und starten

```bash
npm install                  # Repo-Wurzel
npm run web:build            # = node website/scripts/build.mjs → website/dist/
npm run web                  # ein Server für Seite + Editor + API + JEV, Standard http://127.0.0.1:8080
```

`npm run web` liefert `website/dist` und die Engine-API (`/v1/interpret`, `/healthz`) vom selben Ursprung aus. Mit einem
Modell-Schlüssel in `.env` (siehe `.env.example`) erkennt das Entscheidungsmodell JEV die Beschreibungen, ohne Schlüssel
der lokale Klassifikator des Servers.

**Statisches Hosting geht weiterhin:** `dist/` auf jedes Datei-Hosting legen (GitHub Pages, Netlify, eigener Webspace).
Dann gibt es keinen KI-Server: Der KI-Architekt sagt das ehrlich („KI-Server nicht erreichbar – der Editor erkennt deine
Beschreibung dann lokal im Browser“) und bietet „Im Editor versuchen“ an; der Editor erkennt die Beschreibung dann mit
dem lokalen Klassifikator im Browser.

Galerie neu erzeugen (eingecheckt; nach Änderungen an Pipeline, Hülle oder Export) – ein Befehl, immer dieselben Schritte:

```bash
PLAYWRIGHT_CORE=<pfad>/playwright-core npm run web:gallery   # = node website/scripts/gallery.mjs [--no-thumbs]
# optional CHROMIUM_PATH=<chromium>, falls der Playwright-Browser-Cache nicht zur playwright-core-Version passt
#  1. npx tsx website/scripts/build-gallery.ts   Szenen + Exporte aus der echten Pipeline → website/gallery/
#  2. node website/scripts/thumbs.mjs             Vorschaubilder → website/gallery/thumbs/
#  3. npx vitest run website/test/gallery-disclaimer.test.ts website/test/gallery-current.test.ts
#     jede .litematic/.schem trägt den Pflicht-Hinweis; Blockzahl + Fingerabdruck je Bau = aktueller Generator
```

Danach `npm run web:build` und `website/gallery/` committen.

**Pflicht-Hinweis in den Dateien:** `.litematic` (`Metadata.Description`) und `.schem` (`Metadata.Disclaimer`) tragen
„NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.“ (`toExport` in
`@mcda/pipeline`, Test über alle Galerie-Dateien). `.nbt` bleibt **bewusst ohne**: Das Vanilla-Strukturformat hat kein
Textfeld, und ob ein zusätzliches Tag in 1.21.11/26.3 sicher lädt, ist nicht belegt (`plan/spikes/W1H_export_disclaimer.md`).
Die Detailseite der Galerie sagt das auch den Nutzerinnen.

**Tests der Website** (`website/test/`, Teil von `npx vitest run`): Zustandsautomat und Übergabe des KI-Architekten
(`js/ki-model.js`, gegen den Prüfer des Editors), Einbettungs-Protokoll (`js/embed-model.js`), Galerie-Disclaimer,
Schrift-Lizenz, Routing bei kaputtem Hash, Einbau-Hinweise (= Editor).

**Galerie veraltet nie unbemerkt:** Die Einträge stehen in `scripts/gallery-entries.ts` (eine Quelle für Erzeugen und
Prüfen). `index.json` speichert je Bau Blockzahl und `digest` (sha256 der entpackten `.nbt`). `website/test/gallery-current.test.ts`
baut jeden Eintrag neu und schlägt fehl, sobald der Generator anders baut – dann `npm run web:gallery` und committen.

## Was der Build macht (`scripts/build.mjs`)

1. **Editor** (`packages/app`, Vite) mit relativen Pfaden nach `dist/editor/`, `editor/index.html` bleibt erhalten.
   Gebaut mit `VITE_ENGINE_URL=..`: unter `/editor/` ruft der Editor `../v1/interpret`, also den Server desselben
   Ursprungs.
2. **Seite** (`index.html`, `css/`, `js/`, `media/`, `scenes/`, `gallery/`) nach `dist/`.
3. **three.js selbst ausgeliefert:** nur die benutzten Module aus `node_modules/three` nach `dist/vendor/three/`
   (Abhängigkeiten werden aus den Importen ermittelt, MIT-Lizenz liegt bei), die Import-Map zeigt auf `./vendor/three/`.
   Kein CDN.
4. **Schriften selbst ausgeliefert:** Unbounded, Inter, JetBrains Mono (SIL OFL 1.1) aus `tools/public-support/fonts/`
   nach `dist/fonts/`, eingebunden per `@font-face` in `css/site.css`. Keine Anfrage an Google Fonts. Die Lizenz
   `OFL.txt` (Lizenztext mit den Copyright-Zeilen aller drei Familien aus den offiziellen Projekt-Repos) geht nach
   `dist/fonts/` **und** `dist/editor/assets/` (der Editor bündelt Inter und JetBrains Mono). Fehlt sie oder eine
   Copyright-Zeile, bricht der Build sofort ab (`scripts/fonts.mjs`).
5. **Vokabular des KI-Architekten** (`scripts/build-vocabulary.ts` → `dist/ki/vocabulary.json`): Bautyp-, Theme- und
   Palettennamen aus dem Katalog (`nodeContext`, wie `build-gallery.ts`) sowie Feldnamen und Optionstexte aus dem
   Eingabeschema von `building_generate` (dieselben Beschreibungen, aus denen die Engine JEV fragt). So zeigt die
   Plan-Karte „Taverne“, „Walmdach“, „nach Osten“ statt IDs; neue Katalogeinträge erscheinen ohne Änderung an der Seite.
   Dazu `typeConfidenceMin` = `TYPE_CONFIDENCE_MIN` aus `@mcda/engine/intent` (Schwelle für den Bautyp, wie im Editor).

Lokal ohne Server-Build: `node tools/public-support/scripts/serve.mjs 4173` und `http://localhost:4173/website/index.html`
öffnen. Die Quellseite lädt three.js dann aus `/node_modules/three/` (nur Entwicklung und `scripts/thumbs.mjs`); Schriften,
Editor und KI-Architekt gibt es nur im Build.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `index.html` | Alle Seiten; Hash-Routen `#editor`, `#galerie`, `#bau-<id>`, `#ki`, `#roadmap`, `#ueber-uns`, `#presse`, `#kontakt`, `#impressum`, `#datenschutz`, `#nutzungsbedingungen`; Anker der Startseite z. B. `#faq`, `#loslegen` |
| `js/site.js`, `js/hash.js` | Router (Editor ohne Neuladen, robust gegen kaputte Hashes), Navigation und Menü, Downloads |
| `js/editor.js`, `js/embed-model.js` | Editor im iframe (`editor/index.html?embed=1`); Einbettungs-Protokoll rein im Modell |
| `js/ki.js`, `js/ki-model.js` | KI-Architekt und Beschreibungsfeld der Startseite: Darstellung in `ki.js`, Logik (Zustände, genau eine Anfrage, 429-Sperre, Klemmen, Übergabe) rein in `ki-model.js` |
| `js/home.js`, `js/stage.js` | Scroll-Story, Playground; gemeinsame 3D-Bühne |
| `js/gallery.js` | Galerie-Raster und Detailansicht; Parameter `?quality=high\|medium\|low` (Standard `auto`: stuft auf langsamer Hardware herunter, `stage.js` `QUALITY`), `?thumb`, `?cam=`, `?mood=` |
| `js/voxels.js`, `js/textures.js` | Renderer mit eigenen Pixeltexturen (keine Mojang-Assets) |
| `gallery/`, `scenes/` | generiert: Szenen, Exportdateien (`files/`), Vorschaubilder (`thumbs/`), `index.json` |
| `scripts/` | `build.mjs` (Build), `fonts.mjs` (Schriften + Lizenz), `build-vocabulary.ts`, `gallery.mjs` (Galerie-Ablauf), `build-gallery.ts`, `thumbs.mjs` |
| `test/` | Vitest-Tests der Website (siehe oben) |

## Editor-Einbettung (Vertrag Website ⇄ Editor)

Der Editor läuft in einem iframe unter einer schmalen Leiste im Website-Design (Logo, „← Website“, „Galerie“,
„KI-Architekt“). Das iframe entsteht beim ersten Besuch von `#editor` und wird beim Verlassen nur versteckt: Projekt,
Ansicht und Undo bleiben erhalten, bis die Seite neu geladen wird. Nachrichten nur same-origin (`event.origin ===
location.origin` und `event.source` ist das Editor-iframe):

- Editor → Seite: `{ type: 'nookwright:ready' }`, sobald Beschreibungen angenommen werden.
- Seite → Editor: `{ type: 'nookwright:describe', prompt, interpretation? }`. `interpretation` ist die Antwort von
  `/v1/interpret` im Format `{ source: 'server', request: { op, input }, model?, confidence?, note? }`; der Editor übernimmt
  sie ohne zweiten Modellaufruf. Vor dem Senden wird geklemmt wie der Editor prüft (Sicherheit 0–1, höchstens 64 Felder,
  Modell ≤ 120, Hinweis ≤ 300, Text ≤ 500 Zeichen, gültige Operation – sonst nur der Text). Ohne `interpretation` erkennt
  der Editor die Beschreibung selbst (Server, sonst lokal).
- Editor → Seite: `{ type: 'nookwright:rejected', reason }`, wenn er eine Beschreibung nicht übernimmt → Hinweis auf der
  Seite statt still zu scheitern.
- Bis `ready` kommt, wartet die jeweils letzte Beschreibung. Kommt nach dem Laden 10 s kein `ready` (älterer Editor-Build),
  erscheint ein Hinweis, die Beschreibung im Editor einzufügen.

## KI-Architekt

`POST v1/interpret` (relativ zur Seite, `Content-Type: application/json`, Body `{ prompt }`, Zeitlimit 20 s, höchstens
500 Zeichen). Zustände: leer (mit Hinweis, ohne Anfrage), laden (abbrechbar, nach 6 s Hinweis auf den Editor; „JEV liest …“
nur, wenn zuvor JEV geantwortet hat, sonst neutral), Plan (Felder in Menschensprache, Sicherheit je Feld aus `confidence`,
nie über 100 %, Quelle als Badge „JEV · …“ oder „lokal erkannt“ mit Rückfall-Hinweis), kein Bautyp (andere Operation) bzw.
kein Bautyp **sicher** erkannt (`confidence.buildingTypeId` unter `typeConfidenceMin` – dann kein Primärknopf „Im Editor
bauen“), 429 (Wartezeit aus `Retry-After`; bis dahin erzeugt **kein** Einstieg eine Anfrage), nicht erreichbar
(404/405/401/403/Netz), gerade nicht verfügbar (5xx, z. B. 503), ungültig (400: Feld in Menschensprache, nie der rohe
Server-Text), Zeitlimit. Keine rohen HTTP-Codes in der Oberfläche. Das Beschreibungsfeld der Startseite nutzt dieselbe
Steuerung (eine Anfrage, Ergebnis auf `#ki`). Formulare werden nie nativ abgeschickt (kein GET mit der Beschreibung).

## Warum es keine `artifact.html` mehr gibt

Früher erzeugte der Build eine Variante ohne `<html>`-Gerüst für die claude.ai-Vorschau, dazu Base64-Kopien der
Exportdateien und ein globales Abfangen von Downloads. Mit dem Editor im iframe und dem KI-Architekten über
`/v1/interpret` funktioniert diese Variante nicht mehr sinnvoll: Die Vorschau läuft in einem Sandbox-Rahmen ohne eigenen
Ursprung, das Einbettungs-Protokoll prüft aber genau den Ursprung (`location.origin`), und einen `/v1/interpret`-Server
gibt es dort nicht. Deshalb sind `artifact.html`, die `.b64.txt`-Kopien und das Download-Abfangen entfernt; Downloads der
Galerie laufen direkt, Exporte des Editors lädt der Editor in seinem iframe selbst herunter.

## Kostenloser Open-Source-Launch und Clerk

Produktname: **Nookwright**. Der kostenlose Source-Release enthält Editor, Engine und Galerie, ohne Stripe oder Abo. Die Softwarelizenz ist AGPL-3.0-only; eigene Galerie-Bauten und Vorschauen sind CC BY 4.0. `LICENSE_SCOPE.md` grenzt Drittanbieter und Outputs ab.

Die optionale Route `#konto` lädt Clerk erst nach dem Öffnen. Sie bietet Registrierung/Anmeldung, Kontoverwaltung und Abmeldung. Ohne Konto funktioniert der Editor vollständig. Es gibt keine Cloud-Projekte oder kostenpflichtigen Berechtigungen.

Konfiguration für den Build: `CLERK_PUBLISHABLE_KEY` in der ignorierten `.env` oder in der Hosting-Umgebung. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` und `VITE_CLERK_PUBLISHABLE_KEY` sind ebenfalls unterstützt. Nur der öffentliche Key und der daraus validierte Frontend-Hostname landen in `dist/config/auth.json`; kein Clerk-Secret ist für diesen statischen Login nötig. `CLERK_REQUIRE_PRODUCTION=1` und Vercel-Production (`VERCEL_ENV=production`) verweigern fehlende Keys und `pk_test_` beim Live-Launch. Ein Source-Clone kann ohne Key bauen und zeigt ehrlich, dass Accounts nicht eingerichtet sind.

Clerk Core 3: offizielle UI- und JavaScript-CDN-Bundles (`@clerk/ui@1`, `@clerk/clerk-js@6`), https://clerk.com/docs/js-frontend/getting-started/quickstart. Für Production sind eine eigene Domain, Clerk-Produktionsinstanz und die zugehörigen DNS-Einträge erforderlich: https://clerk.com/docs/guides/development/deployment/production. Anmeldung, Profilverwaltung und Logout auf der echten Domain testen. Die Kontoseite enthält keine Autorisierung für private Backend-Endpunkte; spätere Konto-APIs müssen Tokens serverseitig prüfen.

## Offene Providerkonfiguration vor dem Website-Livegang

- **Rechtliches:** Anbieter ist die Quershift Technologies GmbH (Angaben aus dem Impressum von quershift.com). Offen und
  markiert (`[…]`): Geschäftsführung, HRB nach Eintragung, Verantwortliche:r nach § 18 MStV, Hosting, Lizenz, Haftung und
  der Abschnitt zum KI-Architekten im Datenschutz (Rechtsgrundlage, Sitz von TypeSafe und OpenRouter,
  Auftragsverarbeitung, Drittlandübermittlung). Vor dem Livegang ergänzen und rechtlich prüfen lassen.
- **Prompts im Log:** Der Datenschutztext sagt „Beschreibungen protokollieren wir standardmäßig nicht“. Das gilt nur, wenn
  der Server das NL-Log aus hat (`ENGINE_NL_LOG=off` bzw. Standard von `npm run web`).
- **Warteliste:** Es gibt keine. Die Seite sagt das ehrlich und nennt die Kontaktadresse; es gibt kein Formular und
  keinen Speicher. Eine echte Warteliste braucht einen Newsletter- oder Formular-Dienst und einen Absatz im Datenschutz.
- **Presse:** Material (Bilder, Produktfilm) gibt es auf Anfrage per E-Mail; ein öffentliches Media-Kit ist noch nicht
  veröffentlicht.
