# Paket 2: Spiellogik und Offline-KI

Du arbeitest am Spiel OVERSIGHT im Repo `johannesrolshausen/papers-ai`. Der Gesamtplan steht in `docs/plan.md`. Paket 1 (Regel-Engine und Vertrag mit der KI) ist fertig. Dieses Paket baut die komplette Spiellogik ohne Oberfläche und die regelbasierte Offline-KI.

## Arbeitsregeln

- Starte vom Stand, auf dem Paket 1 liegt (Branch `claude/vibrant-hamilton-xm2cg4` oder `main`, falls schon gemergt). Lies zuerst `README.md` und überflieg `src/core/types.ts`, `src/ai/schema.ts`, `src/ai/adversary.ts`, `src/core/state.ts`.
- `npm install`, danach müssen `npm test`, `npx tsc --noEmit` und `npm run build` grün sein, vorher und nachher.
- Codestil: TypeScript strict, Prettier mit `semi: false` (keine Semikolons), `npx prettier --write .` vor dem Commit.
- Alle Texte im Spiel sind Englisch.
- Kein DOM in diesem Paket. Alles muss in Node und in Vitest laufen.
- Die Fairness-Tests aus Paket 1 (`tests/materialize.test.ts`) dürfen nicht abgeschwächt werden.
- Zufall nur über `rngFor(seed, ...labels)` aus `src/core/rng.ts`, damit Spiele mit gleichem Seed gleich ablaufen.
- Am Ende: committen, pushen und den Abschnitt "Infos aus Paket 2" in `docs/paket-3.md` und `docs/paket-4.md` ausfüllen (welche Funktionen die nächsten Pakete aufrufen, was offen blieb).

## Infos aus Paket 1

Ablauf eines Tages mit den vorhandenen Funktionen:

```ts
const state = createNewGame({ seed, difficulty: 'normal', settings: { aiMode: 'offline' } })
// Tag starten (ab Tag 2 vorher Budget gutschreiben, für Tag 1 nicht)
if (state.dayIndex > 1) grantDailyBudget(state)
const ctx = contextForDay(state) // Regeln, Bulletin, gültige Siegel, Werkzeuge, applicantCount, infiltratorCap
const briefing = buildBriefing(ctx, state.world, state.ai)
const { plan, source, notice } = await adversary.planDay({ briefing, previous, history })
const prepared = prepareDay(state, plan, source, ctx) // prüft Plan, zieht Budget und Hebel-Token ab, baut Personen
// prepared.applicants: Applicant[] in Warteschlangen-Reihenfolge
// prepared.plan: StoredPlan mit issues (Korrekturen der Planprüfung, gehen in die nächste Beobachtung)
```

Wichtige Fakten:

- `prepareDay` verändert `state.world` (neue Personen, Register, Stammgäste) und `state.ai`. Für jeden Tag genau einmal aufrufen.
- `Applicant.admissible` ist die Wahrheit für Bewertung und Lohn. `Applicant.kind` ist nur die Absicht der KI. Beide stimmen laut Tests immer überein, gewertet wird trotzdem `admissible`.
- `Applicant.violations[].evidence[]` sagt, womit ein Verstoß aufzudecken ist: `inspect` (mit `refs`), `fingerprints`, `registry`, `bodyScan`, `verifyLetter`, `interrogate`. `interrogate` ist unzuverlässig, die Person darf lügen.
- `Applicant.plan` ist der geprüfte Plan-Eintrag: `persona`, `opening_line`, `scripted_lines` (mit Auslösern wie `arrival`, `deep_check`, `before_decision`), `letter`, `lever` (`type`: none, bribe, threat, complaint, `real`: echte Folge ja oder nein, `amount` bei Bestechung 5 bis 100), `coordination_note`, `private_intent`.
- Inspect-Modus: Die Oberfläche schickt Ref-Schlüssel. `matchInspection(applicant.violations, keys)` liefert den gefundenen Verstoß oder `null`. Schlüsselformat aus `src/core/refs.ts`: `doc:<docId>:<field>`, `person:<face|height|weight|luggage>`, `calendar`, `rule:<ruleId>`, `rulebook:<seals|cities|districts|vaccines>:<key>`, `bulletin:revoked`, `bulletin:rules`, `bulletin:wanted:<entryId>`.
- Tiefenprüfungen liefern fertige Berichte: `fingerprintReport(applicant, ctx, world)`, `registryReport(doc, world)` (pro Dokument), `bodyScanReport(applicant)`, `verifyLetterReport(letter)`. Jeder Bericht hat `lines` zum Anzeigen.
- Werkzeuge pro Tag: `ctx.tools` (Tag 1 inspect, questions, registry, ab Tag 2 fingerprints, ab Tag 3 bodyScan und verifyLetter).
- `buildDossier(applicant, world)` in `src/ai/adversary.ts` erzeugt die Akte, aus der die KI im Verhör antwortet.
- Konstanten stehen in `src/config.ts`: `ECONOMY` (Startgeld 40, Lohn 6 pro Person, Fehlerstrafe 15, Lebenskosten 25, Entlassung nach 2 Tagen im Minus, Audit-Chance bei Bestechung 0.35, Complaint kostet 30 Minuten, späte Entdeckung 0.3 pro Tag, Beschwerde nach falscher Ablehnung 0.4), `DEEP_CHECK_MINUTES`, `QUESTION_MINUTES`, `INSPECT_MINUTES`, `INCIDENT_REPORT_MINUTES`, `SHIFT` (06:00 bis 18:00, Standard 540 echte Sekunden), `OFFICER_ID`, `AI_BUDGET`. Werte dürfen angepasst werden, wenn Simulationen es nahelegen.
- Schon vorhandene Typen, die dieses Paket befüllt (`src/core/types.ts`): `PlayerAction`, `ApplicantOutcome` (mit `documentedReason` = Code des Verstoßes, den der Spieler vor DENY markiert hat), `GameEvent`, `PendingConsequence`, `DayRecord`, `Economy`, `LedgerEntry`, `Phase`. In `src/ai/adversary.ts`: `DayObservation`, `ApplicantObservation`, `Adversary`, `PlanRequest`, `RespondRequest`, `InspectorQuestion`, `TranscriptLine`. Ergänzen ist erlaubt, Umbenennen nur mit gutem Grund und dann überall.
- `src/dev/demoPlan.ts` ist ein simpler Zufallsplan für die Entwickler-Ansicht, keine echte KI. Die Offline-KI ersetzt ihn dort.
- Einige Verstoßcodes (zum Beispiel `WRONG_VACCINE`, `INVALID_DISTRICT`, `DIPLOMATIC_ACCESS`) prüft der Validator, aber keine Technik erzeugt sie. Das ist so gewollt.
- Datumsvergleiche immer mit den Funktionen aus `src/core/dates.ts`. Für "genau 10 Jahre" gibt es `tenYearsApart` (Schaltjahre).

## Aufgabe

### 1. Schicht-Controller `src/core/dayLoop.ts`

Ein Controller ohne DOM, den Paket 3 an die Oberfläche hängt. Die Spielzeit läuft in Spielminuten. Echte Zeit in Spielzeit umzurechnen ist Aufgabe der Oberfläche, sie ruft dafür `advanceClock(minuten)` auf.

Er braucht mindestens:

- Tag starten: Budget gutschreiben, fällige `PendingConsequence` anwenden (Zeitverlust durch Complaint, Sabotage eines Prüfgeräts, Geldstrafen), Plan holen, `prepareDay`.
- Nächste Person aufrufen, aktuelle Person, Warteschlange, Uhr.
- Aktionen mit Zeitkosten: `inspect(keys)`, `ask(question)` (ruft `adversary.respond`, asynchron), `deepCheck(tool, docId?, typing)` (Bericht plus Zeit, sabotiertes Gerät dauert länger oder fällt aus), `reportIncident(kind)`, Bestechung annehmen oder ablehnen, `decide('approve' | 'deny')`.
- Geskriptete Sätze zum passenden Auslöser ausgeben (Ereignis oder Rückgabewert, den die Oberfläche anzeigt).
- Schichtende um 18:00: nicht bearbeitete Personen zählen, Tag abschließen.
- Ein Event-Log, das die Oberfläche abonnieren kann.

### 2. Dokumentationszeilen für Tiefenprüfungen

Funktion, die die Zeile zum Abtippen baut, etwa `BIOMETRIC REQUEST 07-142 | SUBJECT: VOLK, ANDREI | REASON: PHOTO MISMATCH | OFFICER 4471`. Grund aus markierter Unstimmigkeit oder einer festen Auswahl. Die Zeilen werden mit den Tagen länger (zusätzliche Felder wie Formularnummer, Schalter, Uhrzeit). Dazu eine Funktion, die getippten Text mit der Vorgabe vergleicht und Tippfehler zählt. Die Eingabemaske selbst baut Paket 3.

### 3. Folgen und Wirtschaft (`consequences.ts`, `economy.ts`)

- Lohn pro bearbeiteter Person, Lebenskosten pro Tag, Kontostand, Tage im Minus, Entlassung, letzter Tag führt zu `phase: 'final'`, Entlassung zu `'gameover'`.
- Feedback absichtlich unvollständig: Falsch abgewiesene Legitime erzeugen mit Wahrscheinlichkeit eine Beschwerde mit Strafe. Eingelassene Infiltratoren werden pro folgendem Tag mit Wahrscheinlichkeit entdeckt ("An individual you admitted on Day 2 was detained inland"), dann Strafe.
- Hebel der KI: Complaint (bei DENY ohne `documentedReason` und `real`: nächster Morgen Supervisor Review mit Zeitverlust). Bribe (Geld nur bei APPROVE behaltbar, danach Audit-Chance mit Strafe). Threat (bei DENY, `real` und ohne Incident Report: am nächsten Tag Sabotage eines Prüfgeräts oder Geldstrafe). Ein Incident Report neutralisiert die Folge. Leere Hebel (`real: false`) haben nie Folgen.

### 4. Beobachtungen `src/core/observations.ts`

`DayObservation` aus einem abgeschlossenen `DayRecord` bauen: Entscheidung, Ergebnis aus Sicht der KI, Zeit, markierte Codes, Fragen, Tiefenprüfungen, Meldungen, angenommene Bestechung, Ausgang der Hebel, Werkzeugnutzung, Durchschnittszeit, `planIssues`, Ereignisse.

### 5. Offline-KI `src/ai/offlineAdversary.ts` und `src/ai/dialogueTemplates.ts`

Implementiert `Adversary` vollständig mit `mode: 'offline'`.

- `planDay`: Werkzeugnutzung des Spielers aus der Historie zählen und Techniken wählen, deren Belege nur selten genutzte Werkzeuge zeigen (Daten dazu in `TECHNIQUES` und `BASE_PROBLEMS`, Werkzeuge in `briefing`). Frühe Tage proben billig, mittlere Tage Stammgäste einführen und ehrlich wiederkommen lassen, späte Tage Erspartes ausgeben, Stammgäste umdrehen oder imitieren. Reihenfolge nutzen (Infiltratoren nach Zeitdruck oder kurz vor Schichtende). Hebel sparsam, leere Drohungen öfter. Legale Kuriositäten bei Legitimen einstreuen. `strategy_summary` und `notes_for_future_self` aus Vorlagen schreiben, damit das Debriefing etwas zu zeigen hat. Nur gültige Pläne liefern (die Planprüfung sollte kaum etwas korrigieren müssen).
- `respond`: Antworten auf Standardfragen (`purpose`, `duration`, `stay`, `occupation`, `origin`), Fragen zu Unstimmigkeiten und freie Fragen aus Vorlagen, passend zur Akte und zum Auftreten. Infiltratoren lügen gemäß Tarngeschichte.
- `exportMemory` und `importMemory` für den Spielstand.

### 6. Simulation `scripts/sim.ts`

`npm run sim` (zum Beispiel mit `tsx` als Dev-Abhängigkeit) spielt komplette Spiele ohne Oberfläche gegen die Offline-KI mit Bot-Spielern:

- perfekter Bot: kennt die Wahrheit, entscheidet immer richtig, nutzt Werkzeuge wie ein sorgfältiger Prüfer
- nachlässiger Bot: nur einfache Inspect-Belege, keine Tiefenprüfungen
- Ausgabe: Infiltratoren durch und versucht, falsch Abgewiesene, Kontostand, Entlassung ja oder nein, pro Schwierigkeit

## Abnahme

- Neue Tests für Controller, Zeitkosten, Wirtschaft, Hebel, Beobachtungen, Dokumentationszeilen und Offline-KI. Die Offline-KI liefert für alle Tage aller Schwierigkeiten Pläne, die die Planprüfung ohne Korrekturen übersteht.
- `npm run sim` läuft für Easy, Normal und Hard ohne Fehler durch. Der perfekte Bot lässt keinen Infiltrator durch und wird nicht entlassen. Der nachlässige Bot lässt welche durch.
- Gleicher Seed ergibt gleiche Simulation.
- Die Entwickler-Ansicht (`src/main.ts`) nutzt die Offline-KI statt `demoPlan`.
