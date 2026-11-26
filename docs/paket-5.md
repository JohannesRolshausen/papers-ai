# Paket 5: Debriefing, Feinschliff und Gesamttest

Du arbeitest am Spiel OVERSIGHT im Repo `johannesrolshausen/papers-ai`. Der Gesamtplan steht in `docs/plan.md`. Pakete 1 bis 4 sind fertig. Dieses Paket schließt das Spiel ab: Debriefing, Speichern und Laden, Ton, Doku und ein Test über das ganze Spiel.

## Arbeitsregeln

- Starte vom Stand, auf dem Paket 4 liegt (oder `main`, falls schon gemergt). Lies `README.md`, `docs/paket-2.md` bis `docs/paket-4.md` und die Abschnitte "Infos aus Paket 3" und "Infos aus Paket 4" unten.
- `npm install`, danach müssen `npm test`, `npx tsc --noEmit` und `npm run build` grün sein.
- Codestil: TypeScript strict, Prettier mit `semi: false`. Spieltexte auf Englisch. KI-Texte nur mit `textContent` einsetzen.
- Am Ende: committen und pushen.

## Infos aus Paket 1, die hier wichtig sind

- Alles fürs Debriefing liegt in `GameState.days` (`DayRecord`): `context` (Regeln, Bulletin), `plan` (`StoredPlan` mit `strategy_summary`, `notes_for_future_self`, `issues`, `costSpent`, `source`), `applicants` und `outcomes`.
- Pro `Applicant`: `kind`, `baseProblem`, `techniques` (Typ, Kosten, Notiz in Klartext), `notes`, `violations` mit `evidence` (Werkzeug, Schwierigkeit easy, subtle oder hard, Beschreibung), `plan.private_intent`, `plan.coordination_note`, `plan.lever`, `characterId`. Dokumente haben `provenance` (genuine, altered, forged, support_forgery, borrowed) und `tamperNote`.
- Stammgäste: `GameState.world.characters` mit allen Auftritten (introduce, reuse, impersonate).
- Wahre Identität: `world.persons[applicant.personId]`.
- `saveGame`, `loadGame`, `clearSave` in `src/core/state.ts` kapseln den Speicher mit try/catch.

## Infos aus Paket 2

- Pro Person steht in `DayRecord.outcomes` die Entscheidung, `documentedReason`, `minutesSpent`, `bribeAccepted`, `reported`, `correct` und alle `actions`. Tiefenprüfungen und Incident Reports haben `chars`, `typedMs` und `typos`. Daraus kommen Tippgenauigkeit und Anschläge pro Minute (`charsPerMinute` in `src/core/docLines.ts`).
- `DayRecord.events` enthält morgens eingetroffene Folgen und abendliche Ereignisse (Umschläge). Folgen mit Fälligkeit nach dem letzten Tag werden gar nicht erst angelegt. Ob ein durchgelassener Infiltrator je aufgefallen wäre, zeigt also nur die Wahrheit im Debriefing.
- Die Offline-KI führt ein Tagebuch (`OfflineAdversary.journal`, gespeichert in `state.adversaryMemory`): Phase, Strategie, Notizen, Platz des Hauptversuchs, Ausgaben pro Tag. `strategy_summary` und `notes_for_future_self` stehen außerdem in jedem `StoredPlan`.
- `simulateGame(seed, difficulty, bot)` aus `src/dev/simulation.ts` spielt ein ganzes Spiel ohne Oberfläche und eignet sich als Grundlage für den Gesamttest.

## Infos aus Paket 3

Bildschirme und Ablauf:

- `src/ui/app.ts` steuert alles: Titel, Setup, Bulletin, Kabine, Evening Report, Endbildschirm. Es hält den `DayLoop` und speichert mit `saveGame`.
- Der Endbildschirm (`src/ui/screens/end.ts`) ist ein Platzhalter für Final Report und Entlassung (`kind: 'final' | 'gameover'`). Er zeigt Tage, bearbeitete Personen und Kontostand und den Satz "The full debrief with the adversary plans is not built yet." Das Debriefing gehört hierher oder direkt dahinter. Aufgerufen wird er in `App.end(kind)`.
- Wiederverwendbar fürs Debriefing: `portraitCanvas(face, scale, { sepia, background })` aus `src/ui/components/portrait.ts`, `sealCanvas(spec, scale)` aus `seal.ts` und `renderDocument(doc)` aus `document.ts`. Damit lassen sich gefälschte Dokumente, Doppelgänger und falsche Siegel neben den echten zeigen. Für Fotos `PHOTO_BG` als Hintergrund nehmen.

Speichern und Laden, wie es heute läuft:

- Gespeichert wird nach dem Anlegen eines Spiels, nach `startDay()` (Phase `bulletin` mit vorbereitetem Tag) und nach `endShift()` (Phase `evening`, `final` oder `gameover`).
- Der Titel zeigt "Continue", wenn `loadGame` einen Stand liefert, der nicht `final` oder `gameover` ist. Fortsetzen in Phase `evening` zeigt den Abendbericht über `eveningReport(state, letzterTag)`, sonst das Bulletin. Ein Stand aus der laufenden Schicht startet diese Schicht neu (macht der `DayLoop`).
- Nach dem Endbildschirm löscht "Back to title" den Stand mit `clearSave`.
- Ein beschädigter Stand führt heute nur dazu, dass "Continue" fehlt. Eine Meldung für den Spieler gibt es noch nicht.
- Das Gedächtnis der KI landet über den `DayLoop` in `state.adversaryMemory` und wird mitgespeichert.

Stellen für den Ton (es gibt noch kein `src/ui/audio.ts`):

- Stempel: `stamp()` in `src/ui/screens/booth.ts`, nachdem `loop.decide` mit `done` antwortet.
- Tippen: `input`-Ereignis in `src/ui/components/typingTest.ts`, ein falscher Anschlag lässt sich dort unterscheiden.
- Drucker: `addSlip()` in `booth.ts` legt den Bericht einer Tiefenprüfung auf den Tisch.
- Lautsprecher: `speak()` in `booth.ts` spielt jeden Satz der Person ab.
- Uhr kurz vor 18:00: `refreshTop()` in `booth.ts`, die Uhr wird ab `loop.minutesLeft <= 60` rot.
- Pause (`P`) hält nur die Uhr an. Ein Stummschalter passt in die Kopfleiste neben "Pause".

Gesamttest:

- `npm run smoke -- --full` spielt schon ein komplettes Easy-Spiel offline: Tag 1 mit Inspect-Treffer, Tiefenprüfung mit Tippfehler und Korrektur, APPROVE und DENY, dann alle weiteren Tage mit Entscheidungen nach der Wahrheit (`window.__oversightTest` unter `?test`), Neuladen nach Tag 2 mit "Continue", Supervisor Reviews vor der Schicht, Final Report, keine Konsolenfehler. Das Skript (`scripts/smoke.cjs`) ist die Grundlage für den Test mit Debriefing und Export.
- `--shots <dir>` macht Screenshots mit `deviceScaleFactor: 2`. Die aktuellen liegen in `docs/screenshots`.
- Die Schicht lässt sich für Tests nicht unter 6 Minuten echt verkürzen. Der Test kommt ohne aus, weil er die Schlange abarbeitet und dann "Close booth" drückt.

Offene Punkte und Feinschliff:

- Kein Layout für Handys. Die Bühne ist fest 1280x800 und wird skaliert, ab 1024 Pixel Breite gut lesbar.
- Regelbuch und Bulletin liegen an Tag 1 offen auf dem Tisch, danach weggeräumt. Die Knöpfe unten rechts holen sie nach vorn. Ob das so bleiben soll, wäre im Spieltest zu klären.
- Der Hinweisbalken im Inspect-Modus liegt unten über dem Schreibtisch und kann Papiere verdecken.
- Ein Incident Report über einen Brief hat keine mechanische Folge (offen aus Paket 2).
- Lange Zeilen der KI können die Sprechblase über das Gesicht schieben. Die Blase ist auf 250 Pixel Breite begrenzt.

## Infos aus Paket 4

Dateien:

- `src/ai/claudeAdversary.ts`: der Claude-Gegner (`ClaudeAdversary`, `mode: 'claude'`), Modellliste `CLAUDE_MODELS`, `verifyClaudeKey` (fragt `GET /v1/models/{id}`, kostet nichts), Fehlereinordnung `classifyError`.
- `src/ai/prompts.ts`: statisches Spielhandbuch für den Planer (`plannerSystemPrompt()`, nur aus Konstanten gebaut, daher cachebar), Persona-Prompt `PERSONA_SYSTEM_PROMPT`, Nachrichten aus Briefing, Beobachtung und Akte.
- `src/ai/factory.ts`: `createAdversaries(settings, seed, { apiKey, fetch })` liefert jetzt `{ main, fallback, claude }`. Im Claude-Modus ist `main` der Claude-Gegner und `fallback` die Offline-KI, die er auch selbst für ausgefallene Tage nimmt.
- `src/ui/keyStore.ts` (Key in `sessionStorage`, auf Wunsch in `localStorage`, jeder Zugriff in try/catch), `src/ui/components/keyForm.ts` (Key-Feld, Merken mit Warnhinweis, Modellwahl, Prüfknopf), Setup und Key-Dialog in `src/ui/app.ts`.
- `src/dev/mockClaude.ts`: Ersatz für `fetch`. Das echte SDK läuft mit, nur die Antworten sind gespielt. Für Unit-Tests und unter `?test&mock=claude` im Browser.

Was im Spielstand steht:

- Der API-Key steht nie im Spielstand. `settings.model` enthält das gewählte Modell.
- `state.adversaryMemory` im Claude-Modus: `{ version: 1, kind: 'claude', messages, reported, notes, log, offline }`. `messages` ist das ganze Planungsgespräch (Briefing plus Bericht als user, Antwort unverändert als assistant, Paare in Reihenfolge). `log` hat pro Tag `source` (`claude` oder `fallback`), das Modell, das geantwortet hat (kann nach einem Server-Fallback ein anderes sein), und den Grund eines Ausfalls (`refusal`, `invalid`, `network`, `rate_limit`, `api`). `offline` ist das Tagebuch der Offline-KI für die Tage, die sie übernommen hat.
- `StoredPlan.source` ist `claude` oder `fallback`, `strategy_summary` und `notes_for_future_self` stehen wie bisher im `StoredPlan`. Fürs Debriefing reicht also `GameState.days`, `log` ergänzt das Modell.
- Das Gespräch wächst mit jedem Tag. Bei 28 Tagen kann der Spielstand deutlich größer werden als offline (grob einige hundert KB). `saveGame` liefert `false`, wenn der Speicher voll ist. Das sollte Paket 5 dem Spieler melden.
- Fremdes oder kaputtes Gedächtnis erkennt der Claude-Gegner (`isClaudeMemory`) und startet leer. Tage, deren Bericht das Gespräch nicht kennt, bekommt er dann im nächsten Briefing nachgereicht.

Ablauf und Fehler:

- Planer: `client.beta.messages.parse` mit `betaZodOutputFormat(DayPlanSchema)`, adaptivem Thinking, `effort: 'high'`, `max_tokens: 20000`, Server-Fallbacks (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`), System-Prompt und Gesprächsende mit 1-Stunden-Cache. Ablehnung, ungültiges oder abgeschnittenes JSON, Netzwerk- und Serverfehler: Offline-KI für diesen Tag, `notice` im Bulletin unter "Notices", der unbeantwortete Tag kommt nicht ins Gespräch, und das nächste Briefing sagt Claude, welcher Tag offline geplant wurde. `RateLimitError`: bis zu drei Wiederholungen mit `retry-after` oder 2, 4, 8 Sekunden, danach Fallback.
- Fehlender oder abgelehnter Key, Key ohne Zugriff, Modell nicht verfügbar, Abrechnungsproblem: `planDay` wirft `AdversaryKeyError` (`src/ai/adversary.ts`). Der `DayLoop` gibt diesen Fehler als einzigen nicht an den Fallback, sondern an den Aufrufer. `app.ts` zeigt dann auf dem Bulletin den Dialog "CLAUDE NEEDS AN API KEY": neuen Key prüfen und weiter, oder "Play on offline" (setzt `settings.aiMode` auf `offline` und übernimmt das Offline-Gedächtnis).
- Verhör: `client.beta.messages.stream`, `effort: 'low'`, `max_tokens: 1024` (Thinking zählt mit), 25 Sekunden Zeitlimit, ohne SDK-Wiederholung. `onText` liefert den bisher gesamten, bereinigten Text. Wirft der Claude-Gegner, antwortet wie bisher die Offline-KI. Nach einem abgelehnten Key fragt er die API in dieser Schicht nicht mehr und meldet das einmal über `onNotice`. Die Kabine zeigt solche Hinweise im Verlauf (`BoothOptions.subscribeNotices`).
- Vorladen: Tag 1 startet direkt nach dem Setup, der nächste Tag im Evening Report (`prefetchPlan`, war schon da). Der Ladetext bleibt "The line is forming...".
- Der Titel zeigt bei einem Claude-Spiel "· Claude" hinter dem Spielstand.

Tests:

- `tests/claudeAdversary.test.ts` (20 Fälle mit gemocktem Client: gültige Antwort, ungültiges JSON, Schema-Fehler, Ablehnung, Netzwerk- und Serverfehler, Backoff, Key-Probleme, Gespräch wächst nur durch Anhängen, Speichern und Laden, fremdes Gedächtnis, Streaming, Fallback im Verhör, Key-Prüfung), `tests/keyStore.test.ts`, `tests/prompts.test.ts`.
- `npm run smoke:claude` spielt Tag 1 im Claude-Modus mit Mock im Browser, dazu Tag 2, Neuladen ohne Key und den Key-Dialog. `window.__oversightMock.calls()` listet unter `?test&mock=claude` alle Anfragen. Für den Gesamttest in Paket 5 lässt sich das mit `--full` nicht kombinieren, der Claude-Teil spielt eigene Tage.

Offen:

- Live-Test mit echtem Key steht aus (im Container gibt es keinen). Dabei prüfen: Reichen 20000 `max_tokens` bei `effort: 'high'` für 16 Personen? Wenn Pläne mit `max_tokens` abbrechen (im Spiel als "could not be read"), auf `client.beta.messages.stream` mit `finalMessage()` und höherem Limit umstellen. Wie lange dauert ein Plan, reicht das Vorladen? Wie schnell kommt die erste Silbe im Verhör? Greift der Cache (`usage.cache_read_input_tokens`)? Was kostet ein Spiel?
- Debriefing: das Planungsgespräch in `adversaryMemory.messages` enthält jeden vollständigen Plan, `log` zeigt Ausfälle und Server-Fallbacks. Beides kann ins Debriefing.
- Ton: der gestreamte Text läuft über `speech.stream` in `ask()` in `src/ui/screens/booth.ts`, nicht über `speak()`. Ein Lautsprecher-Geräusch für gestreamte Antworten gehört dorthin.

## Aufgabe

1. Debriefing-Bildschirm nach Final Report oder Game Over, Inhalte siehe nächste Liste.
2. Speichern und Laden durchgängig: nach jeder Phase speichern, "Continue" auf dem Titel, sauberer Umgang mit beschädigtem Spielstand, im Claude-Modus Memory der KI mitspeichern.
3. Ton: kurze WebAudio-Geräusche für Stempel, Tippen, Drucker, Lautsprecher, Uhr kurz vor 18:00. Stummschalter, gemerkt pro Gerät.
4. Feinschliff aus den vorherigen Paketen (offene Punkte aus den Infos-Abschnitten).
5. README: Spielregeln, Start, Hinweis zum API-Key (eigener Key, liegt nur im Browser, kostet Geld pro Spiel), Architektur auf aktuellen Stand.
6. Optional: GitHub-Actions-Workflow für GitHub Pages (nur wenn der User es will, vorher fragen).

Debriefing im Detail:

- Kennzahlen: Infiltratoren durch und versucht, Legitime abgewiesen, Zeit in Tiefenprüfungen, Tippgenauigkeit und Anschläge pro Minute, Geld, Bewertung.
- Zeitleiste pro Tag: Strategie und Notizen der KI, dann jede Person mit Art, Grundproblem, Techniken, vorhandenen Belegen, Entscheidung des Spielers, genutzten Werkzeugen und Ergebnis. Auffällig markieren, welche Belege da waren, aber nicht genutzt wurden.
- Bögen der Stammgäste über alle Auftritte.
- Export als JSON (Download-Datei).

## Abnahme

- Playwright-Test über ein komplettes Easy-Spiel offline (mit gezielten Eingaben, darf die Schichtlänge stark verkürzen): Titel, Setup, sieben Tage, Final Report, Debriefing mit sichtbarer KI-Strategie, Export klappt, keine Konsolenfehler.
- Neu laden mitten im Spiel und mit "Continue" weiterspielen.
- Screenshots vom Debriefing.
