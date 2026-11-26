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

(Wird vom Chat zu Paket 2 ausgefüllt: wo der Controller `planDay` und `respond` aufruft, Format der Beobachtungen, Fallback auf die Offline-KI.)

## Infos aus Paket 3

(Wird vom Chat zu Paket 3 ausgefüllt: Setup-Bildschirm, Adversary-Fabrik, Sprechblase mit Streaming, freie Frage.)

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
