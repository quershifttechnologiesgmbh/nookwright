# Zu Nookwright beitragen

Nookwright startet kostenlos mit offenem Quellcode unter AGPL-3.0-only. Willkommen sind nachvollziehbare Fehlerberichte, reproduzierbare Bau-Beispiele, Verbesserungen an Editor und Engine sowie eigene Katalogbauteile. Software-Lizenzumfang: `LICENSE_SCOPE.md`; Drittanbieter: `THIRD_PARTY_NOTICES.md`.

## Rechte und Herkunft

Beiträge an eigener Software werden unter AGPL-3.0-only eingereicht. Bitte füge fremdem Code oder Daten stets Original-Lizenz, Copyright-Hinweise und Herkunft bei; prüfe, dass die Nutzung zur vorgesehenen Distribution passt. Mit einem PR überträgst du nicht automatisch dein Urheberrecht und gewährst keine allgemeine proprietäre Relizenzierung. Für eine spätere kommerzielle Alternativlizenz können gesonderte Einwilligungen notwendig sein. Der Launch hat keinen verpflichtenden Contributor License Agreement.

Eigene Galerie-Bauten, generierte Szenen, Export-/Projektdateien und Vorschaubilder werden für die Veröffentlichung unter CC BY 4.0 eingereicht. Dokumentiere Autor, gewünschten Credit und Herkunft. Reiche fremde Bauten oder Bilder nur mit passenden Rechten und vollständigen Lizenzhinweisen ein. Eigene Katalogdefinitionen und Code zur Erzeugung von Bauten bleiben Softwarebeiträge unter AGPL-3.0-only.

Bitte bestätige für jeden Commit das [Developer Certificate of Origin 1.1](https://developercertificate.org/) mit einem Sign-off. `git commit -s` ergänzt die Zeile `Signed-off-by: Name <email>`. Verwende eine Adresse, die öffentlich sichtbar sein darf: Commit, Sign-off und PR können dauerhaft im öffentlichen Repository verbleiben. Der DCO bestätigt die Berechtigung zur Einreichung, ersetzt aber keine gesonderte Relizenzierungsvereinbarung.

Keine Schlüssel, `.env`-Dateien, Kundendaten, privaten Prompts oder Projekte einreichen. Ebenso keine Minecraft-JARs, offiziellen Texturen, Modelle, Sounds oder kopierten Creator-Bauten ohne passende Erlaubnis. Eigene Screenshots und Vorlagen benötigen nachvollziehbare Herkunft; die Code-Lizenz darf nicht pauschal auf fremde Inhalte übertragen werden.

## Änderungen umsetzen

- Dokumentation auf Deutsch, Code auf Englisch. Domänenpakete bleiben rein; Zufall entsteht aus Seeds.
- Verträge additiv erweitern. Bewusste Änderungen an generierten Ergebnissen erklären und erforderliche Prüfsummen entsprechend aktualisieren.
- Nutzerfähigkeiten zugleich über die Engine-API anbieten; App und Engine teilen Generierregeln und Projektdateiformat.
- Entscheidungsmodelle ausschließlich über `@mcda/classify` anbinden. Zugangsdaten bleiben lokal; das Produkt funktioniert auch ohne Modellschlüssel.
- Einen PR mit Problem, Ergebnis, verwendeten Reproduktionsschritten und geeigneter Validierung beschreiben. Neue Abhängigkeiten inklusive Lizenz und Verwendungszweck erklären.

Mit Node entsprechend `package.json` installieren: `npm ci`. Für Quellcodeänderungen die passenden Tests ausführen; vor einer Integrationsfreigabe `npm test`, `npm run typecheck`, `npm run typecheck:app` und `npm run typecheck:viewer`. Websiteänderungen zusätzlich mit `npm run web:build` bauen und im Browser prüfen. Geheimnisse oder nicht benötigte lokale Spielassets sind für diesen normalen Ablauf nicht erforderlich.

## Bugs und Sicherheit

Bei einem Fehler: gewünschtes und beobachtetes Verhalten, Zielversion, Seed/Parameter und ein minimales eigenes Beispiel angeben. Private Projekte und Kontaktdaten vor dem Teilen entfernen. Sicherheitsprobleme bitte privat an hello@quershift.com melden, mit Betreff „Nookwright security“. Keine Zugangsdaten oder öffentlich verwertbaren Geheimnisse in GitHub-Issues stellen.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
