# Nookwright

Kostenloser Open-Source-Generator und Editor für eingerichtete Minecraft-Java-Bauten. Räume zeichnen oder einen Bautyp wählen, Stil und Größe anpassen, bauen und als .litematic, .schem oder .nbt exportieren. Enthalten sind Quellcode, Kataloge, eigene Vorschautexturen, Tests und die Website mit 21 reproduzierbaren Galerie-Bauten.

## Lokal starten

Node.js >= 26 installieren. Im Repository: `npm ci`, `npm run web:build`, `npm run web`. Website und Editor laufen unter http://127.0.0.1:8080. Ohne Modellschlüssel ist lokale Beschreibungserkennung verfügbar. Optionale Konfiguration: `.env.example` nach `.env` kopieren, Schlüssel ausschließlich lokal eintragen.

Tests: `npm test`, `npm run typecheck`, `npm run typecheck:app`, `npm run typecheck:viewer`. Galerie: `npm run web:gallery` (Vorschaubilder brauchen zusätzlich playwright-core und Chromium; `-- --no-thumbs` überspringt diese).

## Umfang und Status

Kostenloser Generator mit .litematic/.schem/.nbt und Projektdateien. Keine Stripe-Integration in diesem Release. Cloud-Projekte, Teams und Community-Forks sind noch kein Bestandteil des Produkts. Clerk-Anmeldung, Profilverwaltung und Logout sind optional über die Kontoseite verfügbar, sobald der Betreiber einen öffentlichen Key setzt. Sie synchronisieren keine Projekte. Konfiguration: CLERK_PUBLISHABLE_KEY beim Build, CLERK_REQUIRE_PRODUCTION=1 verlangt einen Live-Key. Details in website/README.md.

Der Ordner tools/public-support enthält ausschließlich die zum Bauen notwendigen Font-/Rendering-Helfer. Private Recherche, Pläne, Kampagnen, Produkt-/Billing-Template, lokale Minecraft-JARs, Secrets und Git-Historie wurden ausgeschlossen. Historische Kommentare im Code verweisen teilweise auf interne Berichte, die nicht Teil dieses Exports sind.

## Lizenz und Veröffentlichung

Die mitgelieferte Lizenzdatei ist maßgeblich. Drittanbieter behalten ihre jeweiligen Lizenzen.

`private: true` in npm-Manifests verhindert versehentliches npm-Publishing. Es verhindert kein öffentliches Git-Repository. Eine npm-Veröffentlichung ist nicht vorgesehen. Eigene Galerie-Bauten und Vorschauen: CC BY 4.0, Attribution Nookwright / Quershift Technologies GmbH. Eigene erzeugte Bauten können privat und kommerziell genutzt werden; die AGPL verpflichtet nicht zur Veröffentlichung deiner Output-Dateien. Details in LICENSE_SCOPE.md.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.

Keine Mojang-Texturen/JARs enthalten. Für optionale Originaltexturvorschau kann der Nutzer lokal sein eigenes JAR einlesen. Fonts: SIL OFL, Lizenz unter tools/public-support/fonts/OFL.txt.

## Integrität

release-manifest.json nennt jede Datei mit SHA-256, Ursprung/Transformation und den Ausschlussregeln. Zum Prüfen: `node tools/verify-release.mjs`. Die Manifestprüfung ist eine Dateiintegritäts- und Musterprüfung, kein Beleg für ein bereits deployedes Produkt.
