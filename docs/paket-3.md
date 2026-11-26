# Paket 3: Oberfläche

Du arbeitest am Spiel OVERSIGHT im Repo `johannesrolshausen/papers-ai`. Der Gesamtplan steht in `docs/plan.md`. Paket 1 (Regel-Engine) und Paket 2 (Spiellogik, Offline-KI) sind fertig. Dieses Paket baut die spielbare Oberfläche im Browser, zunächst nur mit der Offline-KI.

## Arbeitsregeln

- Starte vom Stand, auf dem Paket 2 liegt (oder `main`, falls schon gemergt). Lies zuerst `README.md`, `docs/paket-2.md` und den Abschnitt "Infos aus Paket 2" unten.
- `npm install`, danach müssen `npm test`, `npx tsc --noEmit` und `npm run build` grün sein, vorher und nachher.
- Codestil: TypeScript strict, kein Framework (Vite und DOM), Prettier mit `semi: false`, `npx prettier --write .` vor dem Commit.
- Spieltexte auf Englisch.
- Spiellogik gehört in den Controller aus Paket 2, nicht in die Oberfläche. Fehlt dort etwas, dort ergänzen und testen.
- Texte der KI (Dialoge, Briefe, Namen) immer mit `textContent` einsetzen, nie mit `innerHTML`. Sie kommen in Paket 4 von einem Sprachmodell.
- Eigener Look im Genre-Stil: Pixel-Art, gedeckte Farben, Schreibtischansicht. Keine Namen, Grafiken, Layouts oder Musik, die eine bestehende Vorlage kopieren.
- Am Ende: committen, pushen und den Abschnitt "Infos aus Paket 3" in `docs/paket-4.md` und `docs/paket-5.md` ausfüllen.

## Infos aus Paket 1, die hier wichtig sind

- Inspect-Modus: Jedes anklickbare Element braucht einen Ref-Schlüssel (`src/core/refs.ts`): `doc:<docId>:<field>`, `person:<face|height|weight|luggage>`, `calendar`, `rule:<ruleId>`, `rulebook:<seals|cities|districts|vaccines>:<key>`, `bulletin:revoked`, `bulletin:rules`, `bulletin:wanted:<entryId>`. Für Siegel ist der Key im Regelbuch die Behörde (`AuthorityId`, zum Beispiel `ministry` oder `passport:drastia`), für Städte das Land (`drastia`), für Bezirke `velmark`. Ein Klick auf eine einzelne Regel (`rule:<ruleId>`) allein kann ein fehlendes Dokument aufdecken.
- Anklickbare Dokumentfelder und ihre Beschriftungen stehen in `DOC_FIELDS` (`src/core/documents.ts`), Titel in `DOC_TITLES`, Feldwerte über `fieldValue(doc, field)`, Datum im Dokumentformat über `formatDocDate`.
- Gesichter: `FaceSpec` in `src/core/faces.ts` mit den Teilen `skin`, `head`, `eyes`, `brows`, `nose`, `mouth`, `scar` (Kernmerkmale, bei echten Personen immer gleich) und `hair`, `hairColor`, `beard`, `glasses`, `hat` (Stil, darf abweichen). Wertebereiche in `FACE_RANGES`. Der Porträt-Renderer muss jedes Kernmerkmal sichtbar unterscheiden, sonst sind Doppelgänger nicht erkennbar. Passfotos (`photo`) mit demselben Renderer, aber in Sepia.
- Siegel: `SealSpec` in `src/core/seals.ts` mit `shape` (round, star, shield, hex), `points` (Zacken beim Stern), `glyph` (zehn Symbole), `ringDots` (0, 8, 12, 16), `color`. Fälschungen weichen in genau einem Merkmal ab, der Renderer muss jedes Merkmal klar zeigen. Gültige Siegel des Tages: `ctx.validSeals[authority]` (bei einer Siegelrotation zwei Tage lang zwei gültige).
- Regelbuch-Inhalte: `ctx.bulletin.rules` (Texte), `COUNTRIES[id].cities`, `VELMARK_DISTRICTS`, `REQUIRED_VACCINE` und `VACCINES` aus `src/core/world.ts`, Behördennamen in `AUTHORITY_NAMES`.
- Bulletin: `ctx.bulletin` mit `headline`, `changes`, `rules`, `wanted` (mit Gesicht und Grund), `revoked`, `newTools`, `newDocuments`.
- Person am Fenster: `applicant.appearance` mit `face`, `height` (Messlatte), `weight` (Waage), `luggage`.
- Tiefenprüfungs-Berichte haben fertige `lines` zum Ausdrucken.
- Werkzeuge erscheinen nach `TOOL_UNLOCK_DAY` in `src/config.ts`. Namen in `TOOL_NAMES`.
- `src/main.ts` und `src/dev/` sind die Entwickler-Ansicht. Sie bleibt erreichbar (zum Beispiel unter `?dev`), das Spiel wird der Standard.

## Infos aus Paket 2

(Wird vom Chat zu Paket 2 ausgefüllt: Controller-API, Ereignisse, Dokumentationszeilen, offene Punkte.)

## Aufgabe

Bildschirme in `src/ui/screens/`, Bausteine in `src/ui/components/`, Stil in `src/ui/styles.css`:

1. Titel: Spielname, kurze Prämisse ("Every person in this line is played by one AI..."), Weiter oder Neues Spiel.
2. Setup: Schwierigkeit (7, 14, 28 Tage mit Beschreibung aus `DIFFICULTIES`), KI-Modus (Offline auswählbar, Claude sichtbar aber deaktiviert mit Hinweis auf Paket 4, oder über eine Adversary-Fabrik vorbereitet), Schichtlänge.
3. Morning Bulletin: Schlagzeile, Änderungen, Regeln, Wanted-Liste mit Porträts, gesperrte Nummern, neue Werkzeuge und Dokumente. Tag 1 mit kurzem Tutorial.
4. Kabine (Hauptbildschirm), Bestandteile siehe nächste Liste.
5. Evening Report: Lohn, Abzüge, Lebenskosten, Kontostand, Ereignisse des Tages, Hinweis auf Entlassungsgefahr.
6. Game Over und Final Report als einfache Platzhalter (das Debriefing baut Paket 5).

Kabine im Detail:

- Kopfleiste mit Tag, Uhr, Geld, Länge der Schlange (kleine Pixel-Menge), Knopf für die nächste Person
- Fenster mit Porträt, Messlatte, Waage, Gepäck, Sprechblase mit Schreibmaschinen-Effekt, Gesprächsverlauf
- Schreibtisch mit verschiebbaren Dokumenten, Regelbuch mit Reitern (Regeln, Siegel, Städte, Bezirke, Impfstoffe), Bulletin, Kalender
- Inspect-Modus: Felder anklicken, Treffer hervorheben, gefundene Unstimmigkeit schaltet eine Frage frei
- Fragen: Standardfragen, Frage zur Unstimmigkeit, freie Frage (max. 80 Zeichen, nur im Claude-Modus aktiv)
- Tiefenprüfungen: Knopf, dann Tipptest-Maske mit der Dokumentationszeile (Fehler rot, Korrektur nötig, Uhr läuft weiter), dann ausgedruckter Bericht
- Incident Report (ebenfalls mit Tippzeile), Umschlag bei Bestechung (annehmen oder zurückgeben)
- Stempel APPROVE und DENY

Dazu:

- Pixel-Porträt-Renderer (etwa 32x40 Pixel, hochskaliert mit `image-rendering: pixelated`) und Siegel-Renderer auf Canvas.
- Pixel-Schrift über `@fontsource` (keine externe Schriftquelle zur Laufzeit).
- Echtzeit-Uhr: echte Sekunden in Spielminuten umrechnen nach `settings.shiftRealSeconds`, Pause-Taste.
- Desktop zuerst (ab 1024 px Breite, skaliert sauber auf größere Fenster).
- Spielstand nach jeder Phase speichern (`saveGame` aus `src/core/state.ts`), "Continue" auf dem Titel.

## Abnahme

- Ein komplettes Easy-Spiel ist offline im Browser spielbar, vom Titel bis zum Final Report.
- Playwright-Rauchtest (`require('playwright')` ist vorinstalliert, nicht neu installieren): Spiel offline starten, Bulletin wegklicken, drei Personen bearbeiten (einmal Inspect mit Treffer, einmal eine Tiefenprüfung mit getippter Zeile, einmal APPROVE und DENY), Tag beenden, Evening Report sehen, keine Konsolenfehler.
- Screenshots von Bulletin, Kabine und Evening Report.
