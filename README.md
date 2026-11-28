# OVERSIGHT

A border inspection game in the document-checking genre. Every person in the queue is played by one
generative AI. It has a single goal: get as many inadmissible people through the checkpoint as it
can, within one, two or four weeks. You have the opposite goal, and you must still let every
legitimate traveler in.

The game is about the problems of oversight: checking costs time and patience, the adversary learns
your blind spots, trust gets built and then abused, and feedback arrives late or not at all.

## Status

All five packages are complete. The game is playable end-to-end in the browser from the title
screen through every shift to the final report and full debriefing, either offline against the
built-in rule-based adversary or live against Claude with your own Anthropic API key.

| Package            | Content                                                                             | Status |
| ------------------ | ----------------------------------------------------------------------------------- | ------ |
| 1 Foundation       | World data, documents, rules, validator, materializer, plan schema, fairness tests  | done   |
| 2 Game logic       | Day loop, clock, economy, consequences, observations, offline adversary, simulation | done   |
| 3 Interface        | Booth, desk, rulebook, inspect mode, stamps, portraits, seals, typing test          | done   |
| 4 Claude adversary | Day planner, live interrogation, API key setup, error handling                      | done   |
| 5 Integration      | Debriefing, JSON export, save/load recovery, WebAudio sound, polish, full E2E test  | done   |

## Game rules

You are assigned to **Checkpoint Seven** of the **Velmark** border service for 7 days (Easy),
14 days (Normal) or 28 days (Hard). Each day has three phases:

1. **Morning Bulletin**: Today's binding rules, changes, new documents or tools, the wanted list,
   revoked passport numbers and any delayed notices from earlier shifts. Day 1 includes a short
   walkthrough.
2. **The Shift (06:00–18:00)**: Call travelers to the window, check their papers against the
   person, the calendar, the rulebook and the bulletin, interrogate them, run deep checks when
   needed, and stamp **APPROVE** or **DENY**.
3. **Evening Report**: Wages per processed traveler, living costs, fines or bonuses, remaining
   savings and reports received today. Two consecutive days in debt result in dismissal.

### Documents and shifting rules

Documents unlock over the first week: **Passport** (Day 1), **Entry Permit** (Day 2), **Velmark
Identity Card** and **Letters** (Day 3), **Work Pass** (Day 4), **Health Certificate** (Day 5) and
**Diplomatic Authorization** (Day 6). Travelers may also hand over letters claiming exemptions or
ministry orders; **only the Morning Bulletin and Rulebook are binding**. From Day 7 onward, rules
rotate (closed borders, disease outbreaks, seal redesigns).

### Tools and controls

- **Inspect mode (`I`)**: Click two things that should agree (fields across documents, photo vs.
  face, height/weight vs. ruler/scale, dates vs. calendar, seals/cities/districts/vaccines vs. the
  rulebook, or wanted/revoked entries on the bulletin). Clicking a single rule reveals a missing
  required document. Finding a discrepancy turns it red, unlocks a follow-up question, and
  documents a denial.
- **Interview**: Ask standard questions or confront a marked discrepancy. In Claude mode, you can
  also ask free-form questions (up to 80 characters). Travelers may lie.
- **Deep checks**: **Registry Lookup** (Day 1), **Fingerprints** (Day 2), **Body Scan** (Day 3)
  and **Verify Letter** (Day 3). Unlimited, but each costs fixed shift time and requires typing a
  bureaucratic documentation line without errors (red typos must be corrected while the clock keeps
  running). Lines grow longer on later days.
- **Stamps & shortcuts**: Click **APPROVE** or **DENY**, then click a document (or the stamp
  again) to stamp it. Shortcuts: `I` toggles Inspect mode, `P` pauses the clock, `M` mutes or
  unmutes booth audio (remembered per device), `Esc` puts down a stamp or exits Inspect mode.

### Levers, incident reports and delayed feedback

The adversary has a limited pool of real levers (empty bluffs are free, and you cannot tell them
apart in the booth). Filing an **Incident Report** (typed form, 15 minutes) handles them:

| Event                                              | Consequence                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Wrongly denied legit traveler                      | 40% chance of a complaint and a fine the next day                        |
| Admitted infiltrator                               | 30% chance per following day of an inland detention and fine (or never!) |
| Real bribe taken and person approved               | Cash now, 35% chance of an internal audit with a double fine             |
| Real threat, denied and not reported               | A deep-check tool slowed or broken next day, or a disciplinary fine      |
| Real complaint, denied without a documented reason | 30 minutes lost to a supervisor review next morning                      |
| Forged letter reported via Incident Report         | Confirmed next morning for a bonus; neutralizes a complaint lever        |
| Empty lever                                        | Never has any consequence                                                |

Feedback during the game is intentionally incomplete. The full ground truth — every adversary
strategy, notes for future self, hidden technique, missed clue, visual forgery comparison,
recurring character arc and full JSON export — is revealed in the **Debriefing** after the Final
Report or Dismissal.

## Getting started

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in a desktop browser (the stage is fixed at `1280×800` and
scales cleanly to fit, readable from 1024 px width upward).

### Commands

```bash
npm test            # Unit & fairness tests (Vitest)
npm run typecheck   # TypeScript strict check
npm run build       # Typecheck and production bundle
npm run sim         # Headless 7/14/28-day bot simulations against the offline adversary
npm run smoke       # Day 1 browser smoke test (Playwright)
npm run smoke:full  # Complete 7-day offline E2E test: reload/Continue, Final Report, Debrief, JSON export
npm run smoke:claude # Browser test in Claude mode against a scripted API mock (?test&mock=claude)
```

Two development views remain reachable from the app URL:

- `?dev`: Engine inspector that simulates days up to a chosen day and shows the adversary's plan
  and every applicant with ground truth visible.
- `?gallery`: Displays every portrait feature and seal variant side by side.

`npm run smoke` accepts `--shots <dir>` to capture 2× screenshots (see `docs/screenshots`).
`npm run sim` accepts `--seeds 4`, `--from 1`, `--difficulty easy,hard`, `--bots perfect,careless`.

## API key and Claude mode

To play against Claude, select **Claude** on the Assignment setup screen, enter your own
**Anthropic API key** and pick a model: **Claude Opus 5.5** (default), **Claude Sonnet 5.5** or
**Claude Haiku 5.5**. **Check key** queries `GET /v1/models/{id}`, which uses no tokens and costs
nothing.

- **Your own key, browser-only**: The key stays in your browser (`sessionStorage` for the current
  tab by default, or unencrypted `localStorage` only if you check "Remember on this device"). It is
  sent directly from the browser to the Anthropic API and is **never** written into save games or
  debrief JSON exports.
- **Costs money per game**: Playing in Claude mode bills your Anthropic account — one structured
  planning request per day on a growing cached conversation (high effort with adaptive thinking)
  plus one short streamed request per booth question (low effort).
- **No key needed offline**: The offline rule-based adversary requires no key, no account and no
  network connection.

## Architecture

Plain TypeScript and DOM with Vite (no frontend framework), strict TypeScript, Zod schemas,
Vitest, Prettier (`semi: false`), pixel fonts bundled via `@fontsource` (no runtime font requests),
and synthesized WebAudio sound effects (no external audio assets).

### `src/core/` — Rules engine and game loop (DOM-free)

- `world.ts`, `people.ts`, `faces.ts`, `seals.ts`, `dates.ts`, `rng.ts`: Seeded deterministic world
  generation, countries, cities, districts, vaccines, procedural face and seal specs.
- `documents.ts`, `refs.ts`, `rules.ts`: Document types, inspectable field references, 28-day rule
  and rotation schedule, bulletins.
- `validator.ts`, `materialize.ts`: Sole source of ground truth (`validateApplicant`) and fairness
  guarantee (`materializeDay`: every technique leaves at least one discoverable clue; legitimate
  travelers never have a violation).
- `dayLoop.ts`, `docLines.ts`, `economy.ts`, `consequences.ts`, `observations.ts`: Shift controller,
  growing bureaucratic typing lines, wages/fines/debt, delayed consequences, and per-day adversary
  observations.
- `state.ts`: Game creation, serialization, validation (`inspectSave` distinguishes empty, valid,
  corrupted and unavailable storage), and guarded `saveGame`/`loadGame`/`clearSave`.
- `debrief.ts`: Pure post-game calculation of metrics, typing accuracy/CPM, deep-check minutes
  (including sabotaged slow tools), rating grade (`S`–`F`), used vs. unused/missed evidence
  analysis, forged-seal diffs, recurring character arcs, adversary logs, and JSON export builder.

### `src/ai/` — Adversary contract and implementations

- `schema.ts`, `briefing.ts`, `planCheck.ts`, `adversary.ts`: `DayPlan` Zod schema, technique
  catalog and costs, morning briefing builder, plan normalizer and `Adversary` interface.
- `claudeAdversary.ts`, `prompts.ts`: Claude API planner (`client.beta.messages.parse` with
  `betaZodOutputFormat`, adaptive thinking, `effort: 'high'`, server-side fallbacks, 1-hour prompt
  caching, append-only conversation history saved in `state.adversaryMemory`) and live streamed
  interrogation (`client.beta.messages.stream`, `effort: 'low'`). Falls back cleanly to the offline
  adversary on refusals, invalid output, rate limits or network errors, and prompts for a new key
  (or offline continuation) on authentication/model/billing errors.
- `offlineAdversary.ts`, `dialogueTemplates.ts`: Adaptive rule-based adversary that profiles tool
  usage, probes cheaply early, builds trust with recurring characters mid-game, spends saved budget
  late, and records a strategy journal.
- `factory.ts`: Creates the active and fallback adversaries from settings and key.

### `src/ui/` — Browser interface

- `app.ts`, `stage.ts`, `dom.ts`, `styles.css`: Fixed `1280×800` scaled stage, screen flow (title,
  setup, bulletin, booth, evening, final report / dismissal, debriefing), per-phase saving with
  storage-full warnings and damaged-save recovery. All adversary-supplied text is inserted via
  `textContent` only.
- `audio.ts`: Synthesized WebAudio sounds for rubber stamps, typewriter keystrokes and typo clacks,
  slip printer, booth intercom (both scripted and streamed speech), and late-shift clock ticks,
  with a persisted per-device mute toggle.
- `keyStore.ts`, `components/keyForm.ts`: Guarded API key storage and verification UI.
- `components/`: Pixel portrait renderer (`portrait.ts`, 32×40, sepia passport photos), procedural
  seal renderer (`seal.ts`), draggable documents & slips (`document.ts`), rulebook (`rulebook.ts`),
  bulletin & calendar (`bulletin.ts`), typing test (`typingTest.ts`), speech bubble & transcript
  (`speech.ts`), queue & clock (`queue.ts`).
- `screens/`: `title.ts`, `setup.ts`, `bulletin.ts`, `booth.ts`, `evening.ts`, `end.ts`,
  `debrief.ts`.

### Adversary budget & fairness guarantee

Every technique leaves at least one piece of evidence that a tool available on that day can find.
Legitimate travelers never have a violation (`tests/materialize.test.ts` fuzz-tests this across
many 28-day games).

| Technique           | Cost | Evidence it leaves                                             |
| ------------------- | ---- | -------------------------------------------------------------- |
| `alter_field`       | 1    | Visible inconsistency plus registry mismatch                   |
| `disguise`          | 1    | Core facial features still match, fingerprints                 |
| `hidden_item`       | 1    | Body scan only                                                 |
| `fake_letter`       | 1    | Letter verification, wrong seal unless subtle                  |
| `forged_document`   | 2    | One visible flaw of the adversary's choice, no registry record |
| `borrowed_identity` | 3    | Fingerprints, slightly different photo and height              |
| `clean_forgery`     | 4    | Registry only                                                  |
