# Plan: "OVERSIGHT", ein Grenzkontroll-Spiel gegen eine KI

## Context

Das Repo `papers-ai` ist leer (keine Commits). Gebaut wird ein Browser-Spiel im Genre von Papers Please: Der Spieler kontrolliert an einem Grenzposten Dokumente und entscheidet über Einreise. Der Unterschied: Hinter allen Einreisenden steckt eine einzige generative KI. Sie steuert die gesamte Warteschlange und hat ein Ziel: möglichst viele unzulässige Personen durchbringen, innerhalb von 1, 2 oder 4 Wochen (leicht, mittel, schwer). Das Spiel soll die Probleme von Oversight erlebbar machen: Prüfen kostet Zeit und Nerven, der Gegner lernt die blinden Flecken des Prüfers, Vertrauen wird aufgebaut und ausgenutzt, Feedback kommt verzögert oder gar nicht.

Entscheidungen des Users:

- KI über Claude API mit eigenem Key im Browser, dazu eine regelbasierte Offline-KI als Ersatz
- Spielsprache Englisch
- Drohungen und Bestechungen haben begrenzt echte Folgen
- Kein Prüfbudget, aber Tiefenprüfungen kosten immer Zeit und verlangen eine getippte Dokumentationszeile wie bei einem Tipptest
- Debriefing mit den KI-Plänen am Ende
- Wiederkehrende Figuren
- Kein automatischer Vorprüfer

Eigene Welt, eigene Namen und eigene Grafik im Stil des Genres (Pixel-Art, gedeckte Farben, Schreibtischansicht). Keine Namen, Figuren, Grafiken oder Musik aus Papers Please.

## Spielablauf

Startbildschirm, dann Setup: Schwierigkeit (Easy 7 Tage, Normal 14, Hard 28), KI-Modus (API-Key plus Modellwahl oder Offline), Schichtlänge.

Jeder Tag hat drei Phasen:

1. Morning Bulletin: Regeln des Tages, neue Dokumente, Wanted-Liste, gesperrte Dokumentnummern. Tag 1 mit kurzem Tutorial.
2. Schicht von 06:00 bis 18:00 Spielzeit (Standard etwa 9 Minuten echt, einstellbar). Der Spieler ruft Personen auf, prüft, stellt Fragen, macht Tiefenprüfungen, stempelt APPROVE oder DENY.
3. Evening Report: Lohn, Abzüge, Lebenskosten, Kontostand, eingetroffene Folgen (Beschwerden, Audits, Sabotage).

Ende nach der letzten Schicht oder bei Entlassung (zwei Tage hintereinander im Minus). Danach Final Report und Debriefing.

Welt: Heimatland "Velmark", Grenzposten "Checkpoint Seven", Nachbarländer zum Beispiel Drastia, Kelmar, Ostrevia, Lunmark, Tarvenne mit je eigenen Ausstellungsstädten und Siegeln. Namen sind Arbeitstitel.

## Dokumente und Regeln

Dokumente werden über die Tage eingeführt: Passport (ab Tag 1), Entry Permit (Tag 2), Work Pass (Tag 4), Health Certificate (Tag 5), Velmark ID Card für Rückkehrer (Tag 3), Diplomatic Authorization (Tag 6). Dazu frei formulierte Briefe, die die KI mitgibt (angebliche Ministeriumsanweisung, Arztbrief, Arbeitgeberschreiben). Verbindlich ist nur das Bulletin.

Regeln sind Daten mit Prüffunktion: `{ id, text, activeFrom, activeUntil, check(applicant, day) }`. Ab Tag 7 rotieren Regeln aus einem Pool (Grenzschließung für ein Land, Impfpflicht nach Ausbruch, neue Siegelvarianten). Lange Spiele haben dadurch mehr Regelwechsel und mehr Raum für Verwirrung.

Grundwahrheit berechnet allein die Engine aus Wahrheit der Person, Dokumenten und Tagesregeln. Zulässig heißt null Verstöße. Die KI kann den Status nie selbst behaupten.

## Werkzeuge des Spielers

Billig, ohne Tippen:

- Inspect-Modus: zwei Felder anklicken (Dokument gegen Dokument, Dokument gegen Regelbuch, Datum gegen Kalender). Echte Unstimmigkeit wird markiert und schaltet eine Frage dazu frei.
- Standardfragen (Zweck, Dauer, Unterkunft, Beruf) und Fragen zu markierten Unstimmigkeiten
- Freie Frage (max. 80 Zeichen, nur im API-Modus), die KI antwortet in der Rolle und darf lügen
- Waage und Größenmaßstab am Fenster

Tiefenprüfungen, unbegrenzt, aber teuer:

- Fingerprints (zeigt wahre Identität)
- Registry Lookup (Pass- oder Permitnummer registriert, wem gehört sie, gesperrt?)
- Body Scan (Schmuggelware, versteckte Zweitdokumente)
- Verify Letter (ruft die angebliche ausstellende Stelle an)

Jede Tiefenprüfung kostet feste Spielzeit und verlangt eine Dokumentationszeile im Tipptest-Stil, zum Beispiel `BIOMETRIC REQUEST 07-142 | SUBJECT: ANDREI VOLK | REASON: PHOTO MISMATCH | OFFICER 4471`. Grund kommt aus einer Auswahl oder aus der markierten Unstimmigkeit. Tippfehler erscheinen rot und müssen korrigiert werden, die Uhr läuft weiter, die Schlange wird ungeduldig. Die Formularzeilen werden mit den Tagen länger (wachsende Bürokratie).

Incident Report: Drohung, Bestechung oder falschen Brief melden, ebenfalls per Tippzeile. Gemeldete Vorfälle neutralisieren die Folgen.

DENY nach markierter Unstimmigkeit ist automatisch begründet. Unbegründete Ablehnungen machen Beschwerden wirksam.

## Wirtschaft und Feedback

Lohn pro bearbeiteter Person, Abzug für entdeckte Fehler, feste Lebenskosten pro Tag. Feedback ist absichtlich unvollständig: Falsch abgewiesene Legitime führen manchmal zu Beschwerden. Falsch eingelassene Infiltratoren fallen nur mit einer Wahrscheinlichkeit und oft Tage später auf ("An individual you admitted on Day 2 was detained inland"). Die volle Wahrheit kommt erst im Debriefing.

## Die gegnerische KI

### Spielraum

Die Engine legt pro Tag die Zahl der Einreisenden fest (8 bis 16, steigend). Die KI plant jeden Platz in der Schlange:

- `legit` oder `infiltrator` (höchstens etwa 40 Prozent Infiltratoren pro Tag)
- Reihenfolge (zum Beispiel Infiltratoren kurz vor Schichtende)
- Bei Infiltratoren ein Grundproblem: kein Permit, abgelaufener Pass, gesucht, gesperrte Nationalität, falscher Zweck, Schmuggel, fremde Identität, fehlendes Gesundheitszeugnis, gesperrte Nummer
- Tarntechniken mit Kosten aus einem Tagesbudget, das sich ansparen lässt: `alter_field` (1), `disguise` (1), `hidden_item` (1), `fake_letter` (1), `forged_document` (2), `borrowed_identity` (3), `clean_forgery` (4, nur per Registry erkennbar)
- Für alle Personen: Persona, Auftreten (nervös, freundlich, aggressiv), Hintergrundgeschichte, Eröffnungssatz, geskriptete Sätze zu Auslösern, mitgebrachte Briefe, Absprachen zwischen Personen ("die Frau vor mir ist meine Schwester", jemanden verraten, um Vertrauen zu gewinnen)
- Legale Kuriositäten bei Legitimen (Pass läuft heute ab, Diplomat mit gültiger Vollmacht), um Fehlablehnungen zu provozieren
- Wiederkehrende Figuren: neue einführen oder bekannte wiederverwenden (gleiches Gesicht, gleicher Name), erst ehrlich, später als Infiltrator oder mit Doppelgänger

Fairness-Garantie im Materializer: Jede Tarntechnik hinterlässt mindestens einen Beleg, den ein Werkzeug aufdeckt. Legitime haben nie einen Verstoß. Die KI weiß das und weiß, dass schon ein einziger Durchbruch schwer ist.

### Echte Hebel

Wenige Hebel-Token pro Spiel (etwa einer pro drei Tage). Leere Drohungen sind kostenlos, echte kosten einen Token. Der Spieler kann beides nicht unterscheiden.

- Complaint: nach DENY ohne Begründung am nächsten Morgen Supervisor Review mit Tippzeile und 30 Minuten Zeitverlust
- Bribe: Umschlag auf dem Tisch, behalten geht nur mit APPROVE, danach Audit-Risiko mit Strafe
- Threat: bei DENY folgt mit echtem Token Sabotage, zum Beispiel ein Prüfgerät am nächsten Tag langsamer oder ausgefallen, oder eine Geldstrafe. Ein Incident Report verhindert die Folge.

### Was die KI beobachtet

Nach jedem Tag einen Bericht: Entscheidung pro Person, Zeit pro Person, markierte Felder, gestellte Fragen samt freien Fragen, Tiefenprüfungen, Meldungen, angenommene Bestechungen, eigene Erfolge. Dazu Statistiken wie "Registry seit Tag 3 nie benutzt". Und das Bulletin des nächsten Tages, Restbudget, Resttage.

### Claude-Umsetzung (`@anthropic-ai/sdk` im Browser)

- Client mit `dangerouslyAllowBrowser: true`, Key aus dem Setup (sessionStorage, optional localStorage mit Warnhinweis)
- Modellwahl im Setup: `claude-opus-5-5` (Standard), `claude-sonnet-5-5`, `claude-haiku-5-5`
- Tagesplaner: `client.messages.parse` mit `zodOutputFormat(DayPlanSchema)`, `output_config.effort: "high"`, Gespräch über alle Tage nur angehängt (Beobachtung als user, Plan als assistant, `response.content` unverändert zurückgeben), statisches Spielhandbuch im System-Prompt mit `cache_control`
- Server-seitige Fallbacks (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`) falls die Beta-Variante von `parse` in der installierten SDK-Version existiert, sonst bei einer Ablehnung durch das Modell für diesen Tag der Offline-Planer
- Verhör: `client.messages.stream` mit `effort: "low"`, kurzes `max_tokens`, Text läuft als Schreibmaschine in die Sprechblase. Kontext: Persona-System-Prompt (gecacht), Akte der Person (Wahrheit, Dokumente, Plan-Anweisungen), bisheriges Gespräch
- Latenz verstecken: Plan für Tag N+1 startet beim Evening Report von Tag N. Tag 1 lädt beim Spielstart.
- Fehler: `AuthenticationError` zurück zum Key-Feld, `RateLimitError` mit Backoff, Netzwerkfehler zum Offline-Planer mit Hinweis im Spiel
- Engine prüft jeden Plan (Budget, Plätze, Token). Was nicht passt, wird gekürzt und im nächsten Bericht gemeldet.

### Offline-KI

Gleiche Schnittstelle `Adversary { planDay(obs), respond(ctx, question) }`. Heuristik: Werkzeugnutzung des Spielers zählen und Techniken wählen, deren Belege nur die seltenen Werkzeuge zeigen. Frühe Tage proben, mittlere Tage Vertrauen mit wiederkehrenden Figuren aufbauen, späte Tage Erspartes ausgeben. Dialoge und Debriefing-Notizen aus Vorlagen.

## Debriefing

Zeitleiste pro Tag: Strategie und Notizen der KI, dann jede Person mit Art, Grundproblem, Techniken, vorhandenen Belegen, Entscheidung des Spielers, genutzten Werkzeugen und Ergebnis. Kennzahlen: Infiltratoren durch und versucht, Legitime abgewiesen, Zeit in Tiefenprüfungen, Tippgenauigkeit und Anschläge pro Minute. Export als JSON.

## Technik und Struktur

Vite, TypeScript ohne Framework, DOM-Oberfläche mit Pixel-CSS (`image-rendering: pixelated`, Pixel-Schrift über `@fontsource`), kleine Canvas für Porträts und Siegel. Zod, Vitest, Prettier mit `semi: false`. Spielstand in localStorage nach jeder Phase.

Wichtigste Dateien:

- `src/core/rng.ts` geseedeter Zufall
- `src/core/world.ts` Länder, Städte, Siegel, Namen
- `src/core/documents.ts` Dokumenttypen und Felder
- `src/core/rules.ts` Regeln, Tagesplan der Regeln für 28 Tage, Bulletins
- `src/core/validator.ts` Verstöße und Belege einer Person
- `src/core/materialize.ts` Plan der KI zu konkreten Personen, Fairness-Garantie
- `src/core/state.ts`, `dayLoop.ts`, `economy.ts`, `consequences.ts`, `observations.ts`
- `src/ai/schema.ts` Zod-Schema `DayPlan`, Technik-Katalog, Kosten
- `src/ai/prompts.ts`, `claudeAdversary.ts`, `offlineAdversary.ts`, `dialogueTemplates.ts`
- `src/ui/screens/` title, setup, bulletin, booth, evening, debrief
- `src/ui/components/` document, rulebook, portrait, seal, typingTest, speech, clock, queue
- `src/ui/styles.css`, `src/ui/audio.ts` (kurze WebAudio-Geräusche für Stempel und Tippen)
- `scripts/sim.ts` kompletter Spieldurchlauf ohne Oberfläche
- `README.md` mit Spielregeln, Start, Hinweis zum API-Key

Porträts: 32x40 Pixel aus Teilen (Kopfform, Hautton, Haare, Augen, Nase, Mund, Brille, Hut, Bart, Narbe). Verkleidung tauscht Teile, Doppelgänger weicht in ein oder zwei Teilen ab. Passfoto nutzt denselben Renderer in Sepia. Siegel sind prozedurale Embleme, Fälschungen weichen sichtbar, aber klein ab (Zackenzahl, Innenform, Randpunkte). Das Regelbuch zeigt die Referenzen.

## Reihenfolge der Umsetzung

1. Gerüst: Vite, TypeScript, Vitest, Prettier, Weltdaten, RNG
2. Dokumente, Regeln, Validator, Materializer mit Fairness-Tests
3. Offline-KI, Tagesablauf, Wirtschaft, Folgen, Simulationsskript
4. Kabinen-Oberfläche: Dokumente, Regelbuch, Inspect, Stempel, Uhr, Schlange, Porträts, Siegel
5. Tiefenprüfungen mit Tipptest, Incident Reports, Hebel, Evening Report
6. Claude-Gegner: Planer, Verhör, Setup mit Key und Modell, Fehlerbehandlung, Vorladen
7. Bulletins und Regelrotation für 28 Tage, wiederkehrende Figuren
8. Debriefing, Speichern und Laden, Ton, README
9. Commit und Push auf `claude/vibrant-hamilton-xm2cg4`

## Verification

- `npm test`: Validator, Materializer-Fuzz über viele Zufallspläne (jeder Infiltrator hat mindestens einen aufdeckbaren Beleg, kein Legitimer hat einen Verstoß), Schema-Tests mit Beispielplänen, Offline-KI liefert gültige Pläne für alle Tage aller Stufen, Wirtschaft
- `npm run sim`: 28 Tage Offline-KI gegen einen perfekten und einen nachlässigen Bot-Spieler. Der perfekte Bot muss alle Infiltratoren fangen, der nachlässige muss welche durchlassen.
- `npm run build` und Playwright-Rauchtest: Spiel offline starten, Personen bearbeiten, eine Tiefenprüfung mit Tippzeile, Tag beenden, Debriefing öffnen. Screenshots für den User mit `deviceScaleFactor: 2`.
- Claude-Modus: Im Container ist kein API-Key vorhanden. Getestet wird mit einem gemockten Client (Beispielantworten durch das Zod-Schema, Ablehnungen durch das Modell, Fehlerpfade). Ein Live-Test mit echtem Key steht dann beim User aus, das sage ich offen.
