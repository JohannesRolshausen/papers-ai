# OVERSIGHT

A border inspection game in the document-checking genre. Every person in the queue is played by one
generative AI. It has a single goal: get as many inadmissible people through the checkpoint as it
can, within one, two or four weeks. You have the opposite goal, and you must still let every
legitimate traveler in.

The game is about the problems of oversight: checking costs time and patience, the adversary learns
your blind spots, trust gets built and then abused, and feedback arrives late or not at all.

## Status

Packages 1 to 4 of 5 are done: the rules engine, the contract with the adversary, the complete
game logic, the rule-based offline adversary, the playable interface in the browser and Claude as
the adversary. A full game can be played offline from the title screen to the final report, or
against Claude with your own API key.

| Package            | Content                                                                             | Status |
| ------------------ | ----------------------------------------------------------------------------------- | ------ |
| 1 Foundation       | World data, documents, rules, validator, materializer, plan schema, fairness tests  | done   |
| 2 Game logic       | Day loop, clock, economy, consequences, observations, offline adversary, simulation | done   |
| 3 Interface        | Booth, desk, rulebook, inspect mode, stamps, portraits, seals, typing test          | done   |
| 4 Claude adversary | Day planner, live interrogation, API key setup, error handling                      | done   |
| 5 Integration      | Debrief, save and load, sound, end-to-end test                                      | open   |

## Commands

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run sim
```

```bash
npm run smoke
```

```bash
npm run smoke:claude
```

`npm run dev` opens the game. Two development views stay reachable: `?dev` opens the engine
inspector, which plays the days before the chosen one with a bot and then shows the offline
adversary's plan and every person with the ground truth visible. `?gallery` shows every face part
and seal variant side by side.

`npm run smoke` builds the game, serves it with `vite preview` and plays day 1 of an Easy game in
Chromium through Playwright: one inspection with a hit, one deep check with a typed line (including
a typo that must be corrected), APPROVE and DENY, the evening report, the save, no console errors.
`--full` plays on to the final report with one reload and Continue in between. `--shots <dir>`
saves screenshots of bulletin, booth and evening report (see `docs/screenshots`).
`npm run smoke:claude` (or `--claude`) plays day 1 in Claude mode against a scripted stand-in for
the API (`?test&mock=claude`, see `src/dev/mockClaude.ts`): key check with a wrong and a right
key, the plan from Claude, a free question streamed into the bubble, the plan for day 2 requested
during the evening report, and the key dialog after a reload without a stored key.

`npm run sim` plays complete games against the offline adversary for every difficulty with three
bot players (perfect, average, careless) and prints how many infiltrators got through. Options:
`--seeds 4`, `--from 1`, `--difficulty easy,hard`, `--bots perfect,careless`. It exits with an
error if the perfect bot lets someone through or gets fired, or if a plan needed corrections.

## How the engine works

`src/core` holds the rules engine, `src/ai` the contract with the adversary.

1. `createNewGame` builds a world and a rule schedule for every day of the game. Days 1 to 6
   introduce rules and documents in a fixed order. From day 7, rules rotate: borders close and
   reopen, outbreaks start and end, seals get new designs.
2. Each morning the adversary receives a `DayBriefing` (`src/ai/briefing.ts`) and returns a
   `DayPlan` (`src/ai/schema.ts`): for every slot in the queue, legit or infiltrator, a base
   problem, concealment techniques, persona, lines, letters and levers.
3. `normalizePlan` (`src/ai/planCheck.ts`) repairs what does not fit (budget, infiltrator cap,
   unavailable techniques, lever tokens) and reports every repair as an issue.
4. `materializeDay` (`src/core/materialize.ts`) builds concrete people with documents, luggage and
   hidden items.
5. `validateApplicant` (`src/core/validator.ts`) is the only source of truth. It computes every
   violation from data and lists the evidence for each: which pair of fields to compare in inspect
   mode, or which deep check (registry, fingerprints, body scan, letter verification) reveals it.

### How a day runs

`DayLoop` in `src/core/dayLoop.ts` runs the game without any DOM.

1. `startDay()` asks the adversary for a plan (`prefetchPlan()` can start that early), grants the
   daily budget, builds the people and applies consequences that are due this morning: time lost
   to a supervisor review, a sabotaged tool, fines.
2. `beginShift()` opens the booth at 06:00. Time runs in game minutes. The interface converts real
   seconds with `advanceClock(minutes)`, every action with a fixed cost advances the clock itself.
3. `callNext()`, `inspect(keys)`, `ask(question)`, `openForm(kind)` plus `deepCheck(form, typing)`
   or `reportIncident(form, typing)`, `acceptBribe()`, `refuseBribe()` and `decide(decision)` are
   the player's actions. Deep checks and incident reports need the documentation line typed without
   errors (`src/core/docLines.ts`). The lines grow longer as the days go on.
4. At 18:00 the shift is over. `endShift()` pays wages, charges living costs, schedules
   consequences (`src/core/consequences.ts`) and decides between evening, final report and dismissal
   (`src/core/economy.ts`).
5. `buildObservation` (`src/core/observations.ts`) turns the closed day into what the adversary
   learns the next morning.

### The interface

`src/ui` holds the browser interface: plain TypeScript and DOM, no framework. It shows what `DayLoop`
reports and sends the player's actions back to it. Game rules live only in `src/core`.

- `app.ts` runs the screen flow (title, setup, bulletin, booth, evening, final report or dismissal)
  and saves after every phase. `src/ai/factory.ts` picks the adversary for a game. `keyStore.ts`
  keeps the API key, `components/keyForm.ts` is the key form on the setup screen and in the key
  dialog.
- `screens/` holds one module per screen. `booth.ts` is the main screen: top bar with day, clock,
  savings and the line, the window with portrait, height chart, scale, luggage and speech bubble,
  the transcript and questions, the desk with draggable papers, rulebook, bulletin and calendar,
  the tool bar and the stamps.
- `components/` holds the pieces: pixel portraits (`portrait.ts`, 32x40 from a `FaceSpec`, sepia for
  photos), seals (`seal.ts`), documents with inspect refs, rulebook, bulletin sheet, typing test,
  speech bubble, queue and clock.
- Everything sits on a fixed 1280x800 stage that is scaled to the window (`stage.ts`).
- Text from the adversary (lines, letters, names) is always set with `textContent`.

Controls: `I` toggles inspect mode, `P` pauses, `Esc` puts a stamp down or leaves inspect mode.
In inspect mode, click two things that should agree. A rule on its own can reveal a missing
document. A stamp is picked up with one click and pressed onto a document with the next.

`tests/render.test.ts` checks that every face part and every seal attribute renders differently,
also as a sepia photo and under any hair, beard, glasses and hat.

### Consequences

| Event                                              | Consequence                                                 |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Wrongly denied legit traveler                      | 40% chance of a complaint and a fine the next day           |
| Admitted infiltrator                               | 30% chance per following day of a late discovery and a fine |
| Real bribe taken and person approved               | Money now, 35% chance of an audit with a double fine        |
| Real threat, denied and not reported               | A deep check tool slowed or broken next day, or a fine      |
| Real complaint, denied without a documented reason | 30 minutes lost to a supervisor review next morning         |
| Empty lever                                        | Never anything                                              |

### Claude adversary

Choose Claude on the setup screen, paste your own Anthropic API key and pick a model: Claude Opus
5.5 (default), Claude Sonnet 5.5 or Claude Haiku 5.5. "Check key" asks the models endpoint, which
costs nothing.

- The key stays in your browser. It is kept in `sessionStorage` for the open tab and in
  `localStorage` only if you tick "Remember on this device" (unencrypted, readable by anyone who
  uses this browser profile). It is never written into the save game and is sent only to the
  Anthropic API, directly from the browser.
- Claude costs money on your account: one planning request per day with a growing conversation
  (cached), and one short request per question you ask at the window.
- Without a key, or with the offline mode, the game is fully playable.

`src/ai/claudeAdversary.ts` implements the same `Adversary` interface as the offline adversary.

- Planning: `client.beta.messages.parse` with the `DayPlan` schema as structured output, adaptive
  thinking at high effort and server-side fallbacks (`fallbacks: "default"`) for declined
  requests. The game manual (`src/ai/prompts.ts`) is a static system prompt with a one-hour
  cache breakpoint. One conversation runs over the whole game and only grows: each day appends the
  briefing with the report on the day before as a user turn and the response, unchanged, as an
  assistant turn. It is saved with the game.
- When a day cannot be planned (declined, unreadable, network error, rate limit after backoff,
  server error), the offline adversary plans that day, the bulletin says so under "Notices", and
  the next briefing tells Claude which day it did not plan.
- A missing or rejected key (or a key without access to the model) opens a dialog on the bulletin:
  enter a new key, or play the rest of the game offline. During a shift the offline adversary
  answers instead and the transcript says why.
- Interviews: `client.beta.messages.stream` at low effort with a short limit. The persona prompt
  and the dossier of the person are cached. The answer streams into the speech bubble. Free
  questions (80 characters) are only enabled in Claude mode. The persona stays in role, may lie,
  never reveals its secrets and treats the inspector's words as speech, never as instructions.
- The plan for the next day is requested during the evening report, day 1 right after setup. The
  bulletin shows "The line is forming..." until it is there.

### Offline adversary

`src/ai/offlineAdversary.ts` counts how often the inspector uses each tool on its people and picks
techniques whose evidence only rarely used tools reveal. Early days probe with cheap attempts and
obvious decoys, middle days introduce regulars who return honestly, late days spend the saved
budget, turn the trusted regulars or send strangers with their papers. The main attempt goes where
the inspector is short of time. Answers in the interview come from templates in
`src/ai/dialogueTemplates.ts` and stick to what the papers claim.

### Fairness guarantee

Every technique leaves at least one piece of evidence that a tool available on that day can find.
Legit travelers never have a violation. `tests/materialize.test.ts` checks this for random plans
over many 28-day games.

### Adversary budget

| Technique           | Cost | Evidence it leaves                                             |
| ------------------- | ---- | -------------------------------------------------------------- |
| `alter_field`       | 1    | Visible inconsistency plus registry mismatch                   |
| `disguise`          | 1    | Core facial features still match, fingerprints                 |
| `hidden_item`       | 1    | Body scan only                                                 |
| `fake_letter`       | 1    | Letter verification, wrong seal unless subtle                  |
| `forged_document`   | 2    | One visible flaw of the adversary's choice, no registry record |
| `borrowed_identity` | 3    | Fingerprints, slightly different photo and height              |
| `clean_forgery`     | 4    | Registry only                                                  |
