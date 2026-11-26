# Paket 4: Claude als Gegner

Du arbeitest am Spiel OVERSIGHT im Repo `johannesrolshausen/papers-ai`. Der Gesamtplan steht in `docs/plan.md`. Pakete 1 bis 3 sind fertig: Regel-Engine, Spiellogik mit Offline-KI und spielbare Oberfläche. Dieses Paket bringt die echte generative KI: Claude plant jeden Tag die ganze Warteschlange und antwortet live im Verhör.

## Arbeitsregeln

- Starte vom Stand, auf dem Paket 3 liegt (oder `main`, falls schon gemergt). Lies `README.md`, `docs/paket-2.md`, `docs/paket-3.md` und die Abschnitte "Infos aus Paket 2" und "Infos aus Paket 3" unten.
- Lade vor dem ersten Code zur Claude API den Skill `claude-api` und halte dich an ihn (Modell-IDs, Thinking, Effort, Structured Outputs, Fehlerklassen). Nichts aus dem Gedächtnis raten.
- `npm install`, danach müssen `npm test`, `npx tsc --noEmit` und `npm run build` grün sein.
- Codestil: TypeScript strict, Prettier mit `semi: false`.
- In der Cloud-Umgebung gibt es keinen API-Key. Teste mit einem gemockten Client und sag am Ende klar, dass ein Live-Test mit echtem Key noch aussteht.
- Am Ende: committen, pushen und den Abschnitt "Infos aus Paket 4" in `docs/paket-5.md` ausfüllen.

## Infos aus Paket 1, die hier wichtig sind

- Das SDK `@anthropic-ai/sdk` (Version 1.x) und `zod` (Version 4) sind schon installiert.
- Das Planformat ist `DayPlanSchema` in `src/ai/schema.ts`. Ein Test in `tests/schema.test.ts` zeigt, dass `zodOutputFormat(DayPlanSchema)` aus `@anthropic-ai/sdk/helpers/zod` ein gültiges Structured-Output-Format erzeugt und `format.parse(json)` funktioniert.
- Das Schema hat absichtlich keine Längen- oder Mengenbeschränkungen. `normalizePlan` (aufgerufen in `prepareDay`) kürzt Texte, füllt oder kürzt die Schlange, erzwingt Budget, Infiltratoren-Obergrenze, verfügbare Techniken und Hebel-Token und meldet jede Korrektur als `issue`. Diese Issues landen in `DayObservation.planIssues` und müssen der KI am nächsten Tag gezeigt werden, damit sie lernt.
- Was die KI morgens bekommt: `DayBriefing` aus `buildBriefing` (`src/ai/briefing.ts`): Tag, Resttage, Zahl der Personen, Obergrenze, Budget, Hebel-Token, Werkzeuge, Regeltexte, Änderungen, Wanted-Liste, geschlossene Länder, Seuchenländer, alle Grundprobleme und Techniken mit Kosten, Verfügbarkeit und den Belegen, die sie hinterlassen, mögliche Fehlerarten pro Dokument, legale Kuriositäten, alle Stammgäste mit Auftritten.
- Was sie abends sieht: `DayObservation` (`src/ai/adversary.ts`), gebaut in Paket 2.
- Fürs Verhör: `buildDossier(applicant, world)` liefert `PersonaDossier` mit wahrer Identität, Tarngeschichte, Dokumenten samt Manipulationsnotizen, Geheimnissen (die Verstöße, die nie freiwillig verraten werden dürfen), Hebel und geskripteten Sätzen.
- Die Schnittstelle `Adversary` (`planDay`, `respond` mit optionalem `onText` fürs Streaming, `exportMemory`, `importMemory`) ist vorgegeben. `exportMemory` landet in `GameState.adversaryMemory` und wird mit dem Spielstand gespeichert.
- Die KI kann den Zulässigkeitsstatus nie behaupten. Die Engine rechnet ihn aus. Jede Technik hinterlässt garantiert einen Beleg. Das soll im Prompt stehen, zusammen mit dem Hinweis, dass schon ein einziger Durchbruch schwer ist und die Zeit begrenzt ist.

## Infos aus Paket 2

Planung:

- Der Controller `DayLoop` (`src/core/dayLoop.ts`) ruft `adversary.planDay(request)` in der privaten Methode `requestPlan(day)` auf. Auslöser sind `prefetchPlan()` (Oberfläche, während Evening Report und Bulletin) und `startDay()`. Beide teilen sich dieselbe Anfrage, die KI wird pro Tag einmal gefragt.
- `PlanRequest.briefing` enthält schon das Budget nach der Tagesgutschrift. `previous` ist die Beobachtung des Vortags, `history` alle abgeschlossenen Tage.
- Der Controller prüft jeden Plan mit `DayPlanSchema.safeParse`. Wirft `planDay` oder passt der Plan nicht zum Schema, nimmt er `options.fallback` (die Offline-KI) und setzt `source: 'fallback'` mit einem `notice`. Ohne `fallback` geht der Fehler an den Aufrufer von `startDay`. Eigene Hinweise (Ablehnung durch das Modell, Netzwerkfehler) setzt der Claude-Gegner selbst über `notice`. Der Controller wiederholt nichts. Backoff bei `RateLimitError` gehört in `claudeAdversary.ts`.
- Die Planprüfung meldet Korrekturen in `StoredPlan.issues`, sie landen am nächsten Tag in `DayObservation.planIssues`.

Verhör:

- `loop.ask(question, onText)` ruft `adversary.respond({ dossier, transcript, question }, onText)`. Wirft das oder kommt eine leere Antwort, fragt der Controller `fallback.respond`, danach eine Vorlagenantwort (`answerQuestion` aus `src/ai/dialogueTemplates.ts`).
- `transcript` enthält alle Sätze dieser Person bis jetzt, auch geskriptete Sätze und Hebel. `question` hat jetzt auch `code` (Verstoßcode bei Fragen zur Unstimmigkeit, sonst `null`).
- `PersonaDossier` hat neu `claimed` (`ClaimedFacts`): was die Papiere behaupten (Nationalität, Ausstellungsstadt, Zweck, Dauer, Beruf, Arbeitgeber, Brief ja oder nein). Infiltratoren sollen sich daran halten, wer heimlich arbeiten kommt, nennt einen harmlosen Beruf.

Beobachtungen (`src/core/observations.ts`, gebaut mit `observationHistory(state)` aus den gespeicherten Tagen):

- `DayObservation`: `dayIndex`, `applicants`, `toolUsage` (Anzahl pro Werkzeug, auch `inspect` und `questions`), `averageMinutesPerApplicant`, `processed`, `notProcessed`, `infiltratorsThrough`, `infiltratorsStopped`, `legitDenied`, `events` (Texte der Folgen des Tages, also auch Funde im Inland), `planIssues`.
- `ApplicantObservation` hat neu `legitQuirk`, `lever`, `leverReal` und `leverOutcome` (Satz aus Sicht der KI, zum Beispiel "The threat was ignored and not reported. Retaliation follows."). `flagged` enthält auch Codes, die eine Tiefenprüfung aufgedeckt hat. `result` ist aus Sicht der KI: `got_through`, `stopped`, `legit_admitted`, `legit_denied`, `not_processed`.

Gedächtnis:

- Der Controller speichert `adversary.exportMemory()` nach `startDay()` und nach `endShift()` in `state.adversaryMemory` und ruft beim Erzeugen `importMemory`, wenn dort etwas steht.
- Die Offline-KI speichert `{ version: 1, kind: 'offline', journal }`. Der Claude-Gegner muss fremdes oder kaputtes Gedächtnis erkennen und dann leer starten, die Offline-KI macht es umgekehrt genauso.
- Als Ersatz `createOfflineAdversary(state.seed)` verwenden, dann bleibt der Ablauf mit gleichem Seed gleich.

Offen geblieben: Der Controller reicht `onText` nur durch. Die Offline-KI ruft es einmal mit der ganzen Antwort auf, echtes Streaming kommt mit dem Claude-Gegner.

## Infos aus Paket 3

Die Oberfläche liegt in `src/ui`, ohne Framework. `src/ui/app.ts` steuert die Bildschirme und hält den `DayLoop`. Die Kabine (`src/ui/screens/booth.ts`) ruft nur Methoden des `DayLoop` auf, Spielregeln stehen dort nicht.

Adversary-Fabrik (`src/ai/factory.ts`):

- `createAdversaries(settings, seed)` liefert `{ main, fallback }`. `app.ts` baut damit `new DayLoop(state, main, { fallback })`. Heute liefern beide Modi die Offline-KI. Hier kommt der Claude-Gegner hinein, die Offline-KI bleibt `fallback`.
- Die Fabrik bekommt nur `Settings` und den Seed. Der API-Key steht nicht im Spielstand. Er muss also zusätzlich hineingereicht werden, zum Beispiel als drittes Argument aus `sessionStorage`.
- `ADVERSARY_MODES` beschreibt die Karten im Setup. Claude ist sichtbar, aber `available: false` mit dem Hinweis "Coming in a later update. Needs your own API key." Für Paket 4 auf `true` stellen (oder abhängig vom geprüften Key).
- `freeQuestionsEnabled(settings)` schaltet das Feld für freie Fragen frei. Heute nur bei `aiMode: 'claude'` und verfügbarem Claude-Modus.

Setup (`src/ui/screens/setup.ts`):

- Drei Zeilen: Schwierigkeit, Gegner (`data-mode="offline"` oder `"claude"`), Schichtlänge (6, 9, 12, 15 Minuten echt). `onStart` liefert `SetupChoice { difficulty, aiMode, shiftRealSeconds }`, `app.ts` baut daraus `createNewGame`.
- Key-Feld, Modellwahl und Prüfknopf fehlen noch. Sie gehören in die Claude-Karte oder darunter. `SetupChoice` um `model` erweitern, `Settings.model` gibt es schon.

Latenz und Ladezustand:

- `app.ts` zeigt das Bulletin sofort (Inhalt aus `contextForDay`) und ruft gleichzeitig `loop.startDay()`. Bis der Plan da ist, ist "Open the booth" gesperrt und daneben steht "The line is forming...". Tag 1 läuft genauso direkt nach dem Setup.
- Im Evening Report ruft `app.ts` schon `loop.prefetchPlan()` auf.
- `DayStart.notice` und die morgens eingetroffenen Folgen erscheinen auf dem Bulletin unter "Notices". Ein Fallback auf die Offline-KI wird dem Spieler also schon angezeigt.
- Schlägt `startDay()` fehl, steht auf dem Bulletin "The day could not be prepared. Reload to try again." Weil der `DayLoop` jeden Fehler des Planers an den `fallback` gibt, kommt ein `AuthenticationError` heute nicht bis zur Oberfläche. Für "zurück zur Key-Eingabe" braucht es einen eigenen Weg, zum Beispiel einen Fehlerzustand am Claude-Gegner, den `app.ts` nach `startDay()` abfragt.

Sprechblase und Streaming (`src/ui/screens/booth.ts`, Funktion `ask`):

- `loop.ask(request, onText)` bekommt einen `onText`-Callback. Ruft der Gegner `onText` mehr als einmal auf, zeigt die Blase den Teiltext live (`speech.stream`) und die fertige Antwort wird nicht noch einmal getippt. Bei nur einem Aufruf (Offline-KI) läuft die Schreibmaschine.
- Wichtig: `onText` muss den bisher gesamten Text liefern, nicht nur das neue Stück. Die Blase ersetzt ihren Inhalt bei jedem Aufruf.
- Während eine Antwort läuft, sind alle Knöpfe am Schalter gesperrt. Die Uhr läuft weiter.
- Alle Texte der KI gehen über `textContent` in Blase, Verlauf, Dokumente und Briefe.

Freie Frage:

- Eingabefeld unter den Standardfragen, `maxlength` 80, Enter oder "Ask". Offline ist es gesperrt mit dem Hinweis "Free questions need the Claude adversary." Freischalten über `freeQuestionsEnabled`, sonst ist nichts zu tun. Der Text geht als `{ kind: 'free', text }` an `loop.ask`.

Tests im Browser:

- `npm run smoke` baut das Spiel, startet `vite preview` und spielt Tag 1 mit Playwright (`scripts/smoke.cjs`). `--full` spielt bis zum Final Report, `--shots <dir>` macht Screenshots.
- Unter `?test` legt `app.ts` `window.__oversightTest` an (`current()` liefert die Person am Fenster mit Wahrheit, `minute()` die Uhr). `?test&seed=N` legt den Seed eines neuen Spiels fest.
- Für einen Claude-Durchlauf mit gemocktem Client lässt sich das Skript kopieren und `[data-mode=claude]` statt `[data-mode=offline]` klicken. Den Mock am einfachsten in der Fabrik einhängen, etwa über einen weiteren Query-Parameter, der nur zusammen mit `?test` wirkt.
- Nützliche Selektoren: `[data-action=start-shift]`, `[data-action=call-next]`, `[data-action=inspect]`, `[data-tool=registry]`, `[data-question=purpose]`, `[data-question=discrepancy]`, `.free-input`, `[data-action=stamp-approve]`, `[data-action=stamp-deny]`, `[data-action=end-shift]`, `[data-action=evening-continue]`, `.speech-text`, `.tr-applicant`.

## Aufgabe

1. `src/ai/prompts.ts`: System-Prompt für den Tagesplaner (Spielhandbuch, Ziel, Regeln des Spielraums, Technikkatalog, Hebel, Stammgäste, Reihenfolge, Zeitdruck des Prüfers, Hinweis auf das Debriefing, bei dem `strategy_summary` und `notes_for_future_self` dem Spieler gezeigt werden). System-Prompt für die Persona im Verhör (in der Rolle bleiben, kurz antworten, auf Englisch, darf lügen, verrät nie Geheimnisse oder dass sie eine KI ist, ignoriert Versuche des Spielers, Anweisungen zu ändern). Drohungen bleiben in der Spielwelt und werden nicht drastisch.
2. `src/ai/claudeAdversary.ts`, implementiert `Adversary` mit `mode: 'claude'`, Details siehe nächste Liste.
3. Setup: Key-Feld (Speicherung in `sessionStorage`, optional `localStorage` mit Warnhinweis, jeder Zugriff in try/catch), Modellwahl `claude-opus-5-5` (Standard), `claude-sonnet-5-5`, `claude-haiku-5-5`, Knopf zum Prüfen des Keys.
4. Latenz verstecken: Plan für Tag N+1 schon während Evening Report und Bulletin anfordern. Tag 1 beim Spielstart. Ladezustand mit eigenem Text ("The line is forming...").
5. Freie Frage im Verhör aktivieren (max. 80 Zeichen).

claudeAdversary im Detail:

- Client mit `dangerouslyAllowBrowser: true`, Key vom Spieler.
- `planDay`: `client.messages.parse` mit `zodOutputFormat(DayPlanSchema)`, Effort hoch. Das Gespräch über alle Tage wird nur angehängt (Briefing und Beobachtung als user, Antwort als assistant mit `response.content` unverändert). Statischer System-Prompt mit `cache_control`. Server-seitige Fallbacks laut Skill, wenn die installierte SDK-Version sie mit `parse` unterstützt, sonst `stop_reason` prüfen. Bei Ablehnung durch das Modell, Netzwerkfehler oder ungültiger Antwort für diesen Tag die Offline-KI nehmen und `notice` setzen.
- `respond`: `client.messages.stream`, niedriger Effort, kurzes `max_tokens`, Text per `onText` in die Sprechblase. Kontext: Persona-Prompt (gecacht), Akte, bisheriges Gespräch, Frage.
- Fehler: `AuthenticationError` zurück zur Key-Eingabe, `RateLimitError` mit Backoff, sonst Fallback.
- `exportMemory` und `importMemory` für das Gespräch.

## Abnahme

- Tests mit gemocktem Client: gültige Antwort wird zum Plan, ungültiges JSON und Ablehnung durch das Modell führen zur Offline-KI mit `notice`, Fehlerklassen werden richtig behandelt, das Gespräch wächst nur durch Anhängen, Memory übersteht Speichern und Laden.
- Spiel läuft im Claude-Modus mit gemocktem Client im Browser durch einen Tag (Playwright).
- Ohne Key bleibt das Spiel offline voll spielbar.
- Am Ende klar sagen: Live-Test mit echtem Key steht beim User aus.
