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

Die Spiellogik steckt im Controller `DayLoop` (`src/core/dayLoop.ts`). Er kennt kein DOM. Die Oberfläche ruft nur seine Methoden auf und zeigt, was zurückkommt.

Ablauf:

```ts
const adversary = createOfflineAdversary(state.seed) // src/ai/offlineAdversary.ts
const loop = new DayLoop(state, adversary, { fallback: createOfflineAdversary(state.seed) })
const morning = await loop.startDay() // Bulletin zeigen: morning.bulletin, morning.events, morning.reviews, morning.notice
loop.beginShift() // Uhr auf 06:00 plus Zeitverlust durch Supervisor Reviews
loop.advanceClock((realSeconds * 720) / state.settings.shiftRealSeconds) // aus dem Echtzeit-Takt der Oberfläche
const called = loop.callNext() // called.session, called.lines
// ... Aktionen, siehe unten ...
const report = loop.endShift() // EveningReport, danach state.phase: 'evening', 'final' oder 'gameover'
loop.prefetchPlan() // im Evening Report, damit der nächste Morgen schnell lädt
await loop.startDay() // nächster Tag
```

Rückgabewerte: Jede Spieleraktion liefert `{ ok: true, shiftOver, ... }` oder `{ ok: false, error, message }` (Typ `Rejection`). `message` ist ein fertiger englischer Satz für die Oberfläche. Fehlercodes stehen in `ActionError`, zum Beispiel `tool_down`, `typing_incomplete`, `shift_over`, `unknown_discrepancy`. Nur Programmierfehler werfen eine Exception (zum Beispiel `beginShift` in der falschen Phase).

Aktionen am Schalter:

- `inspect(keys)` kostet 1 Minute. Liefert `found` (Violation oder `null`), `evidence`, `isNew` und gesprochene Sätze `lines`. Gefundene Unstimmigkeiten sammeln sich in `session.discoveries` (`code`, `violation`, `via`). Daraus entstehen die Fragen zur Unstimmigkeit.
- `await ask(question, onText)` kostet 4 Minuten. `question` ist `{ kind: 'purpose' | 'duration' | 'stay' | 'occupation' | 'origin' }`, `{ kind: 'discrepancy', code }` oder `{ kind: 'free', text }` (höchstens `FREE_QUESTION_MAX_LENGTH` = 80 Zeichen). Fragetexte in `STANDARD_QUESTIONS`. `onText` bekommt Teiltext fürs Streaming. Während eine Antwort läuft, liefern weitere Aktionen `busy`. Die Offline-KI beantwortet auch freie Fragen aus Vorlagen. Ob das Feld offline aktiv ist, entscheidet die Oberfläche.
- Tiefenprüfung in zwei Schritten: `openForm(tool, { docId, code, reason })` liefert `form.line` zum Abtippen. Registry braucht ein nummeriertes Dokument (Standard: Pass), Verify Letter einen Brief (Standard: der erste). Als Grund dient eine entdeckte Unstimmigkeit (`code`, Text über `reasonFromCode`) oder ein Eintrag aus `REASON_CHOICES[tool]`. Während des Tippens zeigt `compareTyping(form.line, getippt)` pro Zeichen `correct`, `wrong`, `missing` oder `extra` und liefert `typos`, `correctPrefix`, `complete`. Fertig getippt: `deepCheck(form, { text, ms, typos })`. Der Text muss vollständig stimmen (Groß- und Kleinschreibung egal). Ergebnis: `check` (Werkzeug plus Bericht), `lines` zum Ausdrucken, `revealed` (dadurch aufgedeckte Verstöße, zählen als Begründung), `minutes`, `spoken`.
- Die Tippzeit rechnet die Oberfläche selbst über `advanceClock` ab. Der Controller zieht nur die festen Minuten aus `DEEP_CHECK_MINUTES` ab (bei einem verlangsamten Gerät doppelt).
- `toolStatus(tool)` liefert `ok`, `slow`, `down` oder `locked`. `deepCheckMinutes(tool)` und `minutesLeft` helfen bei einer Warnung kurz vor 18:00. Eine Aktion, die über 18:00 hinausgeht, läuft noch durch, danach ist die Schicht vorbei und die Person geht unbearbeitet.
- Incident Report: `openForm('incident', { incident: 'threat' | 'bribe' | 'letter' })`, dann `reportIncident(form, typing)`. Kostet 15 Minuten. Ein gemeldeter Umschlag gilt als zurückgegeben.
- Umschlag: Bei Bestechung liegt er ab dem Aufruf auf dem Tisch (`session.bribe` mit `amount`, Ereignis `bribe_offered`). `acceptBribe()` oder `refuseBribe()`, umentscheiden geht bis zum Stempel.
- Stempel: `decide('approve' | 'deny', { reason })`. Der erste Versuch kann `status: 'interrupted'` liefern, wenn die Person noch etwas sagt (Satz für `before_decision` oder eine noch nicht gezeigte Drohung oder Beschwerde). Dann die Sätze zeigen, der Spieler stempelt erneut. Bei `done` steht `documentedReason` im Ergebnis. Ohne `reason` nimmt der Controller die erste Entdeckung.

Gesprochene Sätze kommen als `SpokenLine { trigger, text }` in jeder Antwort und als Ereignis `speech`. Auslöser: `opening`, `arrival`, `first_question`, `discrepancy`, `deep_check`, `lever`, `answer`, `before_decision`, `after_approve`, `after_deny`. Alle Texte der KI per `textContent` einsetzen.

Ereignisse: `loop.on(listener)` gibt eine Abmeldefunktion zurück, `loop.log` enthält die Ereignisse des laufenden Tages. Typen in `LoopEvent`: `day_started`, `shift_started`, `clock`, `applicant_called`, `speech`, `bribe_offered`, `inspection`, `question`, `deep_check`, `incident_report`, `bribe`, `decision`, `applicant_left`, `shift_over`, `day_closed`. Bei `shift_over` die Meldung zeigen und `endShift()` aufrufen.

Wichtig: `session.applicant` enthält die Wahrheit (`violations`, `admissible`, `plan`). Die Oberfläche darf davon nur zeigen, was der Spieler sieht: Dokumente, Erscheinung, Gepäck, gesprochene Sätze, `session.discoveries` und Berichte.

Morgen und Abend:

- `DayStart.events`: eingetroffene Folgen mit `text`, `moneyDelta`, `minutesLost`, `sabotagedTool`, `sabotageMode`. `reviews`: Supervisor Reviews mit fertiger Tippzeile (die Zeit ist schon abgezogen, das Abtippen ist nur Atmosphäre). `notice`: Hinweis, wenn der Plan vom Ersatzplaner kam.
- `EveningReport` (`src/core/economy.ts`): `processed`, `notProcessed`, `ledger` des Tages, `income`, `expenses`, `net`, `money`, `daysInDebt`, `fired`, `lastDay`, `events`, `warning`. Beträge mit `formatMoney`.

Dokumentationszeilen (`src/core/docLines.ts`): Tag 1 bis 3 `BIOMETRIC REQUEST 07-142 | SUBJECT: VOLK, ANDREI | REASON: PHOTO MISMATCH | OFFICER 4471`. Ab Tag 4 Formularnummer, ab 8 Schalter, ab 12 Uhrzeit, ab 17 Dokumentnummer, ab 22 Kopie an eine Behörde (`DOC_LINE_STAGES`). Nur Großbuchstaben, Ziffern und einfache Zeichen.

Speichern: Nach jeder Phase `saveGame(state, localStorage)`. `new DayLoop(state, adversary)` holt das Gedächtnis der KI aus `state.adversaryMemory`. Beim Fortsetzen nach Phase: `bulletin` heißt `startDay()` liefert den schon vorbereiteten Tag, `evening` heißt Abendbericht über `eveningReport(state, state.days[state.days.length - 1])` zeigen, dann `startDay()`. Ein Stand aus der laufenden Schicht startet diese Schicht neu.

Entwickler-Ansicht: `src/main.ts` spielt die Tage vor dem gewählten Tag mit einem Bot (`src/dev/bots.ts`) und zeigt dann Plan, Strategie und Wahrheit. `src/dev/demoPlan.ts` ist gelöscht.

Offen geblieben:

- Pause: Der Controller hat keine. Die Oberfläche ruft während der Pause einfach kein `advanceClock` auf.
- Ein Incident Report über einen Brief hat keine mechanische Folge, er taucht nur in der Beobachtung der KI auf.
- Wer die Schicht vorzeitig beenden will: `endShift()` geht jederzeit, alle Wartenden zählen dann als nicht bearbeitet.

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
