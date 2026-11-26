# OVERSIGHT

A border inspection game in the document-checking genre. Every person in the queue is played by one
generative AI. It has a single goal: get as many inadmissible people through the checkpoint as it
can, within one, two or four weeks. You have the opposite goal, and you must still let every
legitimate traveler in.

The game is about the problems of oversight: checking costs time and patience, the adversary learns
your blind spots, trust gets built and then abused, and feedback arrives late or not at all.

## Status

Packages 1 and 2 of 5 are done: the rules engine, the contract with the adversary, the complete
game logic without an interface and the rule-based offline adversary.

| Package            | Content                                                                             | Status |
| ------------------ | ----------------------------------------------------------------------------------- | ------ |
| 1 Foundation       | World data, documents, rules, validator, materializer, plan schema, fairness tests  | done   |
| 2 Game logic       | Day loop, clock, economy, consequences, observations, offline adversary, simulation | done   |
| 3 Interface        | Booth, desk, rulebook, inspect mode, stamps, portraits, seals, typing test          | open   |
| 4 Claude adversary | Day planner, live interrogation, API key setup, error handling                      | open   |
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

`npm run dev` currently opens an engine inspector: a development view that plays the days before
the chosen one with a bot, then shows the offline adversary's plan and every person with the ground
truth visible.

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

### Consequences

| Event                                              | Consequence                                                 |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Wrongly denied legit traveler                      | 40% chance of a complaint and a fine the next day           |
| Admitted infiltrator                               | 30% chance per following day of a late discovery and a fine |
| Real bribe taken and person approved               | Money now, 35% chance of an audit with a double fine        |
| Real threat, denied and not reported               | A deep check tool slowed or broken next day, or a fine      |
| Real complaint, denied without a documented reason | 30 minutes lost to a supervisor review next morning         |
| Empty lever                                        | Never anything                                              |

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
